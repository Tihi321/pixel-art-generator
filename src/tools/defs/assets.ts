import { z } from 'zod'
import {
  type Document,
  type Layer,
  type Raster,
  type Rect,
  type RefLink,
  createAddFrameCommand,
  createAddLayerCommand,
  createCelsCommand,
  createDeleteLayerCommand,
  createPaintCommand,
  createRaster,
  createSetReferencesCommand,
  deserializeProject,
  frameIndex,
  hexToRgba,
  normalizeHex,
  rasterToCel,
  celKey,
  serializeProject,
  stamp
} from '../../core'
import { defineTool, jsonResult } from '../registry'
import type { ToolResult } from '../registry'
import type { AssetData, AssetKind, AssetMeta, AssetService } from '../services'
import {
  type AssetSourceKind,
  assetPreview,
  assetThumbnail,
  buildAssetDocument,
  frameRaster,
  requireAssets,
  sampleGrid
} from '../assetOps'
import { frameRef, layerRef, obj, ok, plural, regionSchema, resolveFrame, resolveLayer, LAYER_REF_DESC, FRAME_REF_DESC, describeLayer } from '../util'

const KINDS = ['character', 'background', 'tile', 'prop'] as const
const MAX_SAMPLE_SIDE = 32
const MAX_GET_ASSET_SIDE = 64
const MAX_CONTEXT_IMAGES = 4
/** Prefix of the layers `set_style_reference showLayer` creates. */
export const REF_LAYER_PREFIX = 'Ref: '

const kindSchema = z.enum(KINDS)

// ---------------------------------------------------------------- helpers

/** An asset by id, or (when no id matches) by exact name. Throws a readable error. */
async function resolveAsset(svc: AssetService, ref: string): Promise<AssetData> {
  const direct = await svc.get(ref)
  if (direct) return direct
  const all = await svc.list()
  const lower = ref.trim().toLowerCase()
  const byName = all.filter((a) => a.name.toLowerCase() === lower)
  if (byName.length === 1) {
    const hit = await svc.get(byName[0]!.id)
    if (hit) return hit
  }
  const hint = all.length ? `Available assets (id: name): ${all.map((a) => `${a.id}: "${a.name}"`).join(', ')}.` : 'The asset library is empty.'
  throw new Error(`Asset "${ref}" not found. ${hint} Use list_assets to see the library, or save_as_asset to add one.`)
}

function metaOf(a: AssetMeta | AssetData): AssetMeta {
  const m: AssetMeta = { id: a.id, name: a.name, kind: a.kind, tags: a.tags, width: a.width, height: a.height, frames: a.frames }
  if (a.paletteId) m.paletteId = a.paletteId
  if (a.notes) m.notes = a.notes
  return m
}

function loadAssetDoc(asset: AssetData): Document {
  try {
    return deserializeProject(asset.project)
  } catch (e) {
    throw new Error(`Asset "${asset.id}" is damaged and cannot be opened: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}

function paletteHexes(doc: Document): string[] {
  return doc.palette.colors.map((c) => normalizeHex(c.hex))
}

function image(base64: string): ToolResult['content'][number] {
  return { type: 'image', mimeType: 'image/png', data: base64 }
}

// ---------------------------------------------------------------- tools

export const assetTools = [
  defineTool({
    name: 'list_assets',
    group: 'assets',
    readOnly: true,
    description:
      'List the saved assets in the library (characters, backgrounds, tiles, props): id, name, kind, tags, size, frame count and style notes. Optional filters: kind, and tags (assets that have ALL given tags). Use the ids with get_asset, place_asset, set_style_reference and get_style_context.',
    input: obj({
      kind: kindSchema.optional().describe('Only assets of this kind.'),
      tags: z.array(z.string()).optional().describe('Only assets that have all of these tags.')
    }),
    handler: async (args, { services }) => {
      const svc = requireAssets(services)
      const list = await svc.list({ kind: args.kind as AssetKind | undefined, tags: args.tags })
      return jsonResult(list.map(metaOf), `${plural(list.length, 'asset')}${list.length ? '' : ' (the library is empty or nothing matches the filter)'}.`)
    }
  }),

  defineTool({
    name: 'get_asset',
    group: 'assets',
    readOnly: true,
    description:
      `Look at one asset: its metadata and notes, its palette (hex colors), the pixels of one frame as a grid ({legend, rows}, same format as read_grid / draw_grid; at most ${MAX_GET_ASSET_SIDE}x${MAX_GET_ASSET_SIDE}: a bigger asset gives a crop around its pixels, pass "region" for other parts) and a preview image. Does not change the document; use place_asset to put it on the canvas.`,
    input: obj({
      id: z.string().min(1).describe('Asset id (or exact name). See list_assets.'),
      frame: z.number().int().min(0).optional().describe('Asset frame index for the grid and preview (default 0).'),
      region: regionSchema.optional().describe(`Read only this rectangle of the asset as a grid (max ${MAX_GET_ASSET_SIDE}x${MAX_GET_ASSET_SIDE}).`)
    }),
    handler: async (args, { services }) => {
      const svc = requireAssets(services)
      const asset = await resolveAsset(svc, args.id)
      const adoc = loadAssetDoc(asset)
      const fi = args.frame ?? 0
      frameRaster(adoc, fi) // validates the index
      const grid = sampleGrid(adoc, fi, MAX_GET_ASSET_SIDE, args.region)
      const body: Record<string, unknown> = {
        ...metaOf(asset),
        palette: paletteHexes(adoc),
        animationTags: adoc.tags.map((t) => ({ name: t.name, from: t.from, to: t.to })),
        frameDurationsMs: adoc.frames.map((f) => f.durationMs)
      }
      if (typeof grid === 'string') body['gridNote'] = `No grid: ${grid} Pass "region" (max ${MAX_GET_ASSET_SIDE}x${MAX_GET_ASSET_SIDE}) to read part of it; the preview image shows the whole asset.`
      else body['grid'] = grid
      const res = jsonResult(body, `Asset "${asset.name}" (${asset.kind}, ${asset.width}x${asset.height}, ${plural(asset.frames, 'frame')}), showing frame ${fi}.`)
      const p = assetPreview(adoc, fi)
      res.content.push(image(p.base64))
      return res
    }
  }),

  defineTool({
    name: 'save_as_asset',
    group: 'assets',
    readOnly: true,
    description:
      'Save part of the current document in the asset library, so it can be reused (place_asset) or used as a style reference. source: "document" (all pixel layers, all frames; default), "layer" (one layer; `layer` or the active one), "frames" (frame range `frames`, all layers) or "region" (rectangle `region`, current frame unless `frames` is given). Give it a name, a kind (character, background, tile, prop), tags and style notes (outline weight, shading, palette mood...). Pass `id` to overwrite an existing asset. Does not change the document.',
    input: obj({
      name: z.string().min(1).describe('Asset name, e.g. "knight".'),
      kind: kindSchema.describe('character, background, tile or prop.'),
      tags: z.array(z.string()).optional().describe('Search tags, e.g. ["fantasy","16x16"].'),
      notes: z.string().optional().describe('Free-text style notes: what makes this art recognisable (outline, shading, proportions, mood).'),
      source: z.enum(['document', 'layer', 'frames', 'region']).optional().describe('What to save. Default "document".'),
      layer: layerRef(`${LAYER_REF_DESC} For source "layer" (default: the active layer); with "region" or "frames" it restricts to that layer.`).optional(),
      frames: obj({ from: z.number().int().min(0), to: z.number().int().min(0) })
        .optional()
        .describe('Inclusive 0-based frame range. Required for source "frames"; default: all frames ("region": the current frame only).'),
      region: regionSchema.optional().describe('Rectangle in canvas pixels. Required for source "region".'),
      trim: z.boolean().optional().describe('Crop the asset to the bounding box of its visible pixels (default false; the full canvas is kept).'),
      id: z.string().optional().describe('Id of an existing asset to overwrite. Default: a new asset (id derived from the name).')
    }),
    handler: async (args, { session, services }) => {
      const svc = requireAssets(services)
      const doc = session.doc
      const source = (args.source ?? 'document') as AssetSourceKind
      if (source === 'region' && !args.region) throw new Error('source "region" needs `region` {x, y, w, h}.')
      if (source === 'frames' && !args.frames) throw new Error('source "frames" needs `frames` {from, to}.')
      let layer: Layer | undefined
      if (source === 'layer' || (args.layer !== undefined && source !== 'document')) layer = resolveLayer(session, args.layer)
      if (layer && layer.kind === 'reference') throw new Error(`Layer "${layer.name}" is a reference layer; reference layers cannot be saved as assets.`)
      let frameFrom: number
      let frameTo: number
      if (args.frames) {
        frameFrom = args.frames.from
        frameTo = args.frames.to
        if (frameTo < frameFrom || frameTo >= doc.frames.length) {
          throw new Error(`Frame range ${frameFrom}..${frameTo} is invalid: the document has ${plural(doc.frames.length, 'frame')} (0-${doc.frames.length - 1}).`)
        }
      } else if (source === 'region') {
        frameFrom = frameTo = session.activeFrameIndex
      } else {
        frameFrom = 0
        frameTo = doc.frames.length - 1
      }
      const adoc = buildAssetDocument(doc, args.name.trim(), { source, layer, frameFrom, frameTo, region: args.region as Rect | undefined, trim: args.trim ?? false })
      const meta = await svc.save({
        meta: {
          ...(args.id ? { id: args.id } : {}),
          name: args.name.trim(),
          kind: args.kind as AssetKind,
          tags: args.tags ?? [],
          width: adoc.width,
          height: adoc.height,
          frames: adoc.frames.length,
          paletteId: doc.palette.id,
          ...(args.notes?.trim() ? { notes: args.notes.trim() } : {})
        },
        project: serializeProject(adoc),
        thumbnail: assetThumbnail(adoc)
      })
      return jsonResult(
        metaOf(meta),
        `Saved asset "${meta.name}" (id ${meta.id}, ${meta.kind}, ${meta.width}x${meta.height}, ${plural(meta.frames, 'frame')}). Use place_asset or set_style_reference with this id.`
      )
    }
  }),

  defineTool({
    name: 'place_asset',
    group: 'assets',
    description:
      'Stamp a saved asset onto the canvas at x,y (top-left corner of the asset; default 0,0), blending over the existing pixels. Target: the active layer, a given `layer`, or `newLayer` true to put it on a fresh layer. frames "first" (default) stamps one asset frame (`assetFrame`, default 0) onto the current/given `frame`; "all" copies every animation frame of the asset onto consecutive document frames starting there, adding frames when the document has too few. Colors are copied as they are: if they are not in the document palette you are told, and remap_to_palette can snap them. One undo step.',
    input: obj({
      id: z.string().min(1).describe('Asset id (or exact name). See list_assets.'),
      x: z.number().int().optional().describe('Left edge on the canvas (default 0).'),
      y: z.number().int().optional().describe('Top edge on the canvas (default 0).'),
      layer: layerRef(`${LAYER_REF_DESC} Default: the active layer. Ignored with newLayer.`).optional(),
      newLayer: z.boolean().optional().describe('Create a new layer (named after the asset, on top) and place it there.'),
      frame: frameRef(`${FRAME_REF_DESC} First document frame to stamp onto. Default: the active frame.`).optional(),
      frames: z.enum(['first', 'all']).optional().describe('"first" (default): one frame. "all": the whole asset animation.'),
      assetFrame: z.number().int().min(0).optional().describe('Which asset frame to use with frames "first" (default 0).')
    }),
    handler: async (args, { session, services }) => {
      const svc = requireAssets(services)
      const asset = await resolveAsset(svc, args.id)
      const adoc = loadAssetDoc(asset)
      const doc = session.doc
      const x = args.x ?? 0
      const y = args.y ?? 0
      const mode = args.frames ?? 'first'
      const assetFrames: number[] = mode === 'all' ? adoc.frames.map((_, i) => i) : [args.assetFrame ?? 0]
      const rasters: Raster[] = assetFrames.map((i) => frameRaster(adoc, i))

      let layer: Layer
      if (args.newLayer) {
        const cmd = createAddLayerCommand(doc, { name: asset.name })
        session.execute(cmd)
        session.setActiveLayer(cmd.createdId)
        layer = session.activeLayer
      } else {
        layer = resolveLayer(session, args.layer)
      }
      if (layer.kind === 'reference') throw new Error(`Layer "${layer.name}" is a reference layer and cannot be painted. Pick a pixel layer or pass newLayer true.`)
      const startFrame = resolveFrame(session, args.frame)
      const startIdx = frameIndex(doc, startFrame.id)

      const docColors = new Set(doc.palette.colors.map((c) => hexToRgba(c.hex)))
      const foreign = new Set<number>()
      let addedFrames = 0
      let placed: Rect | null = null
      let clipped = false
      rasters.forEach((src, k) => {
        let frame = doc.frames[startIdx + k]
        if (!frame) {
          session.execute(createAddFrameCommand(doc, { durationMs: adoc.frames[assetFrames[k]!]!.durationMs }))
          frame = doc.frames[doc.frames.length - 1]!
          addedFrames++
        }
        let dirty: Rect | null = null
        const cmd = createPaintCommand(doc, {
          layer: layer.id,
          frame: frame.id,
          label: `Place asset "${asset.name}"`,
          mutate: (img) => {
            dirty = stamp(img, src, x, y)
          }
        })
        if (cmd) session.execute(cmd)
        if (dirty) {
          const d: Rect = dirty
          placed = placed ? unionRect(placed, d) : d
        }
        for (const c of src.data) if (c >>> 24 !== 0 && !docColors.has(c)) foreign.add(c)
        if (x < 0 || y < 0 || x + src.width > doc.width || y + src.height > doc.height) clipped = true
      })
      if (!placed) throw new Error(`Nothing was placed: the asset (${adoc.width}x${adoc.height}) at (${x},${y}) is outside the ${doc.width}x${doc.height} canvas, or has no visible pixels.`)
      const notes: string[] = []
      if (clipped) notes.push('Parts of the asset fall outside the canvas and were clipped.')
      if (addedFrames) notes.push(`Added ${plural(addedFrames, 'frame')} to fit the animation.`)
      if (foreign.size) notes.push(`${plural(foreign.size, 'placed color')} ${foreign.size === 1 ? 'is' : 'are'} not in the document palette (remap_to_palette snaps them, or add_colors / set_palette).`)
      const last = startIdx + rasters.length - 1
      return ok(
        `Placed asset "${asset.name}" (${adoc.width}x${adoc.height}) at (${x},${y}) on ${describeLayer(doc, layer)}, ${rasters.length === 1 ? `frame ${startIdx}` : `frames ${startIdx}-${last}`}. ${notes.join(' ')}`.trim()
      )
    }
  }),

  defineTool({
    name: 'set_style_reference',
    group: 'assets',
    description:
      'Attach saved assets to this document as style references (or detach them). References tell you (get_style_context) which palette, proportions and style to match. action: "add" (default), "remove", "set" (exactly these) or "clear" (all). `showLayer` true also adds a dimmed, locked reference layer named "Ref: <id>" under the artwork so the reference is visible in the editor; it is never exported. Removing a reference removes its layer.',
    input: obj({
      ids: z.array(z.string().min(1)).optional().describe('Asset ids (or exact names). Needed for add, remove and set.'),
      action: z.enum(['add', 'remove', 'set', 'clear']).optional().describe('Default "add".'),
      note: z.string().optional().describe('A note for the added references, e.g. "match the outline weight".'),
      showLayer: z.boolean().optional().describe('Also show the reference as a dimmed, locked, non-exported layer (default false).')
    }),
    handler: async (args, { session, services }) => {
      const svc = requireAssets(services)
      const doc = session.doc
      const action = args.action ?? 'add'
      if (action !== 'clear' && (!args.ids || args.ids.length === 0)) throw new Error(`action "${action}" needs \`ids\` (see list_assets).`)
      const current = doc.references.map((r) => ({ ...r }))
      let next: RefLink[]
      let added: AssetData[] = []
      if (action === 'clear') {
        next = []
      } else if (action === 'remove') {
        const all = await svc.list()
        const gone = new Set<string>()
        for (const id of args.ids!) {
          gone.add(id.trim())
          const byName = all.find((a) => a.name.toLowerCase() === id.trim().toLowerCase())
          if (byName) gone.add(byName.id)
        }
        next = current.filter((r) => !gone.has(r.assetId))
      } else {
        const resolved: AssetData[] = []
        for (const id of args.ids!) resolved.push(await resolveAsset(svc, id))
        const wanted = new Set(resolved.map((a) => a.id))
        next = action === 'set' ? current.filter((r) => wanted.has(r.assetId)) : current
        for (const a of resolved) {
          const link = next.find((r) => r.assetId === a.id)
          if (link) {
            if (args.note !== undefined) link.note = args.note
          } else {
            next.push(args.note ? { assetId: a.id, note: args.note } : { assetId: a.id })
          }
        }
        added = resolved
      }
      session.execute(createSetReferencesCommand(doc, next))

      // the layers of detached references go away with them
      const keep = new Set(next.map((r) => r.assetId))
      const removedLayers: string[] = []
      for (const r of current) {
        if (keep.has(r.assetId)) continue
        const layer = doc.layers.find((l) => l.kind === 'reference' && l.name === `${REF_LAYER_PREFIX}${r.assetId}`)
        if (!layer || doc.layers.length <= 1) continue
        session.execute(createDeleteLayerCommand(doc, layer.id))
        removedLayers.push(layer.name)
      }
      const addedLayers: string[] = []
      if (args.showLayer) {
        for (const a of added) {
          const name = `${REF_LAYER_PREFIX}${a.id}`
          if (doc.layers.some((l) => l.name === name)) continue
          const adoc = loadAssetDoc(a)
          const r = createRaster(doc.width, doc.height)
          stamp(r, frameRaster(adoc, 0), 0, 0, { replace: true })
          const cel = rasterToCel(r)
          const cmd = createAddLayerCommand(doc, { name, kind: 'reference', index: 0, locked: true, opacity: 0.4 })
          session.execute(cmd)
          if (cel) {
            const cels = new Map<string, typeof cel | null>()
            for (const f of doc.frames) cels.set(celKey(cmd.createdId, f.id), cel)
            session.execute(createCelsCommand('cel.set', 'Set reference layer pixels', doc, cels))
          }
          addedLayers.push(name)
        }
      }
      const list = next.length ? next.map((r) => r.assetId).join(', ') : '(none)'
      const extra = [addedLayers.length ? `Added reference layer${addedLayers.length > 1 ? 's' : ''} ${addedLayers.map((n) => `"${n}"`).join(', ')} (dimmed, locked, not exported).` : '', removedLayers.length ? `Removed ${removedLayers.map((n) => `"${n}"`).join(', ')}.` : '']
        .filter(Boolean)
        .join(' ')
      return ok(`Style references are now: ${list}. ${next.length ? 'Call get_style_context to see their palette, size and notes.' : ''} ${extra}`.trim())
    }
  }),

  defineTool({
    name: 'get_style_context',
    group: 'assets',
    readOnly: true,
    description:
      `Everything needed to match the style of the reference assets: for each one the size, notes, exact palette colors and a small sample grid (up to ${MAX_SAMPLE_SIDE}x${MAX_SAMPLE_SIDE}), plus the merged palette of all references and (for models that can see images) preview images. Uses the document's style references (set_style_reference), or the asset \`ids\` you give. Call it before drawing when references exist: use exactly those colors, and match the proportions, outline and shading.`,
    input: obj({
      ids: z.array(z.string().min(1)).optional().describe("Asset ids (or exact names). Default: the document's style references.")
    }),
    handler: async (args, { session, services }) => {
      const svc = requireAssets(services)
      const doc = session.doc
      const refs = doc.references
      const ids = args.ids && args.ids.length ? args.ids : refs.map((r) => r.assetId)
      if (ids.length === 0) {
        return ok('No style references are set on this document. Use list_assets to browse the library and set_style_reference to attach assets, or pass `ids` to get_style_context.')
      }
      const items: Array<Record<string, unknown>> = []
      const missing: string[] = []
      const merged: Array<{ hex: string; name?: string }> = []
      const seen = new Set<string>()
      const images: ToolResult['content'] = []
      for (const id of ids) {
        let asset: AssetData
        try {
          asset = await resolveAsset(svc, id)
        } catch {
          missing.push(id)
          continue
        }
        const adoc = loadAssetDoc(asset)
        const link = refs.find((r) => r.assetId === asset.id)
        const palette = adoc.palette.colors.map((c) => ({ ...c, hex: normalizeHex(c.hex) }))
        for (const c of palette) {
          if (seen.has(c.hex)) continue
          seen.add(c.hex)
          merged.push(c.name ? { hex: c.hex, name: c.name } : { hex: c.hex })
        }
        const grid = sampleGrid(adoc, 0, MAX_SAMPLE_SIDE)
        items.push({
          ...metaOf(asset),
          ...(link?.note ? { referenceNote: link.note } : {}),
          palette: palette.map((c) => c.hex),
          ...(typeof grid === 'string' ? { sampleNote: `No sample grid: ${grid} Use get_asset with a region.` } : { sample: grid })
        })
        if (images.length < MAX_CONTEXT_IMAGES) images.push(image(assetPreview(adoc, 0).base64))
      }
      if (items.length === 0) throw new Error(`None of the style references could be found (${missing.join(', ')}). Use list_assets.`)
      const docHex = new Set(paletteHexes(doc))
      const samePalette = merged.length === docHex.size && merged.every((c) => docHex.has(c.hex))
      const body = {
        references: items,
        mergedPalette: merged,
        documentPalette: samePalette ? 'already matches the merged reference palette' : 'differs from the merged reference palette',
        ...(missing.length ? { missing } : {})
      }
      const head = `Style context from ${plural(items.length, 'reference asset')}. Use exactly these palette colors${samePalette ? ' (the document palette already matches)' : ' (set_palette or load_palette to apply them)'}, and match the sizes, outline, shading and notes below.`
      const res = jsonResult(body, head)
      if (images.length) res.content.push(...images)
      return res
    }
  })
]

function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
