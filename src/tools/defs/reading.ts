import { z } from 'zod'
import { type Document, type Raster, celToRaster, celKey, flattenFrame, frameIndex, layerIndex, readGrid } from '../../core'
import { defineTool, imageResult, jsonResult } from '../registry'
import { renderPreview } from '../render'
import { LAYER_REF_DESC, colorArg, describeFrame, frameRef, layerRef, obj, parseColor, resolveFrame, resolveLayer, targetShape } from '../util'

const MAX_READ_SIDE = 128

/** Tools that change the document although they are marked readOnly (they manage their own undo steps). */
const MUTATING_READONLY = new Set(['import_image', 'draw_sprite_from_reference', 'make_expression_set'])

/** FNV-1a over the document's structure and every cel: equal fingerprints mean equal content. */
export function documentFingerprint(doc: Document): { hash: string; empty: boolean } {
  let h = 0x811c9dc5
  const mix = (n: number): void => {
    h = Math.imul(h ^ (n | 0), 0x01000193)
  }
  const mixStr = (s: string): void => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i))
    mix(0)
  }
  mixStr(doc.id)
  mix(doc.width)
  mix(doc.height)
  for (const l of doc.layers) {
    mixStr(l.id)
    mixStr(l.name)
    mix(l.visible ? 1 : 0)
    mix(Math.round(l.opacity * 1000))
    mixStr(String(l.blend))
  }
  for (const f of doc.frames) mixStr(f.id)
  let empty = true
  for (const key of [...doc.cels.keys()].sort()) {
    const cel = doc.cels.get(key)!
    mixStr(key)
    mix(cel.x)
    mix(cel.y)
    mix(cel.w)
    mix(cel.h)
    for (let i = 0; i < cel.data.length; i++) {
      const v = cel.data[i]!
      mix(v)
      if (empty && v >>> 24 !== 0) empty = false
    }
  }
  return { hash: (h >>> 0).toString(16), empty }
}

export function isMutatingTool(tool: { name: string; readOnly: boolean; noTransaction: boolean }): boolean {
  return MUTATING_READONLY.has(tool.name) || (!tool.readOnly && !tool.noTransaction)
}

export const readingTools = [
  defineTool({
    name: 'canvas_fingerprint',
    group: 'reading',
    readOnly: true,
    internal: true,
    description: 'Internal: a fingerprint of the active document (used by the agent to check that a run changed something).',
    input: obj({}),
    handler: (_args, { session }) => {
      const { hash, empty } = documentFingerprint(session.doc)
      return jsonResult({ hash, empty })
    }
  }),

  defineTool({
    name: 'read_grid',
    group: 'reading',
    readOnly: true,
    description:
      `Read pixels back as text, in exactly the format draw_grid takes: {legend, rows}. Colors in the palette get stable characters (palette index i -> 0-9, a-z, A-Z), "." is transparent. ` +
      `Reads the active layer/frame (or the given layer/frame) over the region x,y,w,h (default: the whole canvas; max ${MAX_READ_SIDE}x${MAX_READ_SIDE}). ` +
      `Set flattened=true to read the composite of all visible layers instead of one layer. Use it to inspect your work or to edit existing art (read, change a few characters, draw_grid back with transparent="clear").`,
    input: obj({
      x: z.number().int().optional().describe('Left edge of the region (default 0).'),
      y: z.number().int().optional().describe('Top edge of the region (default 0).'),
      w: z.number().int().min(1).optional().describe('Region width (default: to the right edge).'),
      h: z.number().int().min(1).optional().describe('Region height (default: to the bottom edge).'),
      flattened: z.boolean().optional().describe('Read the composite of all visible layers (default false = one layer).'),
      ...targetShape
    }),
    handler: (args, { session }) => {
      const doc = session.doc
      const frame = resolveFrame(session, args.frame)
      const x = Math.max(0, args.x ?? 0)
      const y = Math.max(0, args.y ?? 0)
      const w = Math.min(doc.width - x, args.w ?? doc.width - x)
      const h = Math.min(doc.height - y, args.h ?? doc.height - y)
      if (w < 1 || h < 1) throw new Error(`The region is outside the ${doc.width}x${doc.height} canvas.`)
      if (w > MAX_READ_SIDE || h > MAX_READ_SIDE) {
        throw new Error(`Region ${w}x${h} is too large to read as text (max ${MAX_READ_SIDE}x${MAX_READ_SIDE}). Pass x, y, w, h to read part of the canvas.`)
      }
      let source: Raster
      let what: string
      if (args.flattened) {
        source = { width: doc.width, height: doc.height, data: flattenFrame(doc, frame.id) }
        what = 'flattened composite of all visible layers'
      } else {
        const layer = resolveLayer(session, args.layer)
        source = celToRaster(doc.cels.get(celKey(layer.id, frame.id)), doc.width, doc.height)
        what = `layer "${layer.name}" (index ${layerIndex(doc, layer.id)})`
      }
      const g = readGrid(source, { x, y, w, h }, { palette: doc.palette })
      const opaque = g.rows.some((r) => /[^.]/.test(r))
      return jsonResult(
        {
          source: what,
          frame: frameIndex(doc, frame.id),
          rect: { x, y, w, h },
          empty: !opaque,
          legend: g.legend,
          names: Object.keys(g.names).length ? g.names : undefined,
          rows: g.rows
        },
        `Region ${w}x${h} at (${x},${y}) of ${what}, ${describeFrame(doc, frame)}. legend+rows can be passed to draw_grid (x=${x}, y=${y}).`
      )
    }
  }),

  defineTool({
    name: 'render_preview',
    group: 'reading',
    readOnly: true,
    description:
      'Render the artwork as a PNG image so you can look at it: one frame, flattened over all visible layers (or just one layer), scaled up with nearest-neighbour so small sprites are clearly visible (default: longer side about 256-512 px) on a checkerboard background. Optional: crop to a region to zoom into details, show the pixel grid, show onion skin (neighbouring frames faintly), pick a background color. Call it after drawing to check your work.',
    input: obj({
      frame: frameRef(`${'Frame id or 0-based index.'} Default: the active frame.`).optional(),
      layer: layerRef(`${LAYER_REF_DESC} Render only this layer (even if hidden). Default: all visible layers.`).optional(),
      region: obj({
        x: z.number().int(),
        y: z.number().int(),
        w: z.number().int().min(1),
        h: z.number().int().min(1)
      })
        .optional()
        .describe('Crop to this canvas rectangle before scaling (zoom into details).'),
      scale: z.number().int().min(1).max(64).optional().describe('Integer upscale factor. Default: automatic (longer side ~256-512 px).'),
      grid: z.boolean().optional().describe('Draw pixel grid lines (needs scale >= 6). Default false.'),
      onion: z.boolean().optional().describe('Show previous/next frame faintly underneath. Default false.'),
      background: colorArg('Background: "checker" (default), "transparent", or a color (hex / palette index).').optional()
    }),
    handler: (args, { session }) => {
      const doc = session.doc
      const frame = resolveFrame(session, args.frame)
      const layer = args.layer === undefined ? undefined : resolveLayer(session, args.layer)
      let background: 'checker' | 'none' | number = 'checker'
      if (args.background !== undefined) {
        const b = typeof args.background === 'string' ? args.background.trim().toLowerCase() : ''
        if (b === 'checker' || b === 'checkerboard') background = 'checker'
        else if (b === 'transparent' || b === 'none') background = 'none'
        else background = parseColor(doc, args.background)
      }
      const onionOn = args.onion ? { before: Math.max(1, session.onion.before), after: Math.max(1, session.onion.after), opacity: session.onion.opacity } : undefined
      const r = renderPreview(doc, {
        frameId: frame.id,
        layerId: layer?.id,
        region: args.region,
        scale: args.scale,
        background,
        grid: args.grid,
        onion: onionOn
      })
      const regionText = args.region ? ` region (${args.region.x},${args.region.y} ${args.region.w}x${args.region.h})` : ` whole canvas ${doc.width}x${doc.height}`
      return imageResult(
        r.base64,
        `Preview of ${describeFrame(doc, frame)}, ${layer ? `layer "${layer.name}"` : 'all visible layers'},${regionText}, shown at ${r.scale}x (${r.width}x${r.height} px).`
      )
    }
  })
]
