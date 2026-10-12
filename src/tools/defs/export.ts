import { z } from 'zod'
import {
  type Document,
  type GifFrame,
  type SheetLayout,
  type SheetMetaFormat,
  type SpriteSheetOptions,
  buildSpriteSheet,
  encodeGif,
  encodePng,
  flattenFrame,
  frameIndex,
  requireLayer,
  requireTag,
  scaleImage,
  sheetMetadata
} from '../../core'
import { defineTool } from '../registry'
import { FRAME_REF_DESC, LAYER_REF_DESC, baseName, frameRef, layerRef, obj, ok, plural, resolveFrame, safeFileName, withExtension } from '../util'

const PATH_DESC =
  'Output path. A file name is placed in ~/PixelStudio/exports; an absolute path is used as is. The right extension is added if missing. Default: the document name.'

const layersArg = z
  .array(layerRef(LAYER_REF_DESC))
  .min(1)
  .optional()
  .describe('Only include these layers (even hidden ones). Default: all visible pixel layers.')

function flattenOptions(doc: Document, layers?: Array<string | number>) {
  if (!layers || layers.length === 0) return {}
  return { layerIds: layers.map((l) => requireLayer(doc, l).id), includeHidden: true, includeReference: true }
}

/** Frame indices of a tag in playback order (reverse / pingpong applied). */
function tagPlayback(doc: Document, tagRef: string): number[] {
  const tag = requireTag(doc, tagRef)
  const forward: number[] = []
  for (let i = tag.from; i <= tag.to; i++) forward.push(i)
  if (tag.direction === 'reverse') return forward.reverse()
  if (tag.direction === 'pingpong' && forward.length > 2) return [...forward, ...forward.slice(1, -1).reverse()]
  return forward
}

export const exportTools = [
  defineTool({
    name: 'export_png',
    group: 'export',
    readOnly: true,
    description:
      'Export the artwork as PNG file(s): the current (or given) frame, or every frame ("all": one file per frame, named <name>_0.png, <name>_1.png, ...). Layers are flattened (hidden layers skipped) and optionally upscaled with nearest-neighbour. Returns the written path(s). For game sprite sheets use export_spritesheet instead.',
    input: obj({
      path: z.string().min(1).optional().describe(PATH_DESC),
      frames: z.enum(['current', 'all']).optional().describe('"current" (default): one frame. "all": every frame as a separate file.'),
      frame: frameRef(`${FRAME_REF_DESC} Used when frames is "current". Default: the active frame.`).optional(),
      scale: z.number().int().min(1).max(32).optional().describe('Integer upscale factor (default 1).'),
      layers: layersArg
    }),
    handler: async (args, { session, services }) => {
      const doc = session.doc
      const scale = args.scale ?? 1
      const fo = flattenOptions(doc, args.layers)
      const render = (frameId: string): Uint8Array => {
        const img = scaleImage({ width: doc.width, height: doc.height, data: flattenFrame(doc, frameId, fo) }, scale)
        return encodePng(img)
      }
      const name = withExtension(args.path ?? safeFileName(doc.name), 'png')
      if (args.frames === 'all') {
        const written: string[] = []
        const stem = name.replace(/\.png$/i, '')
        for (let i = 0; i < doc.frames.length; i++) {
          const full = await services.resolveExportPath(`${stem}_${i}.png`)
          await services.writeFile(full, render(doc.frames[i]!.id))
          written.push(full)
        }
        return ok(`Exported ${plural(written.length, 'frame')} as PNG (${doc.width * scale}x${doc.height * scale} px each):\n${written.join('\n')}`)
      }
      const frame = resolveFrame(session, args.frame)
      const full = await services.resolveExportPath(name)
      await services.writeFile(full, render(frame.id))
      return ok(`Exported frame ${frameIndex(doc, frame.id)} as PNG (${doc.width * scale}x${doc.height * scale} px) to ${full}.`)
    }
  }),

  defineTool({
    name: 'export_spritesheet',
    group: 'export',
    readOnly: true,
    description:
      'Export all frames (or a tag / frame range) as ONE sprite-sheet PNG plus a JSON metadata file next to it (<name>.png + <name>.json): frame rectangles, durations and animation tags, for game engines. layout: "horizontal" (default), "vertical", "grid" (use columns) or "packed" (trimmed, tightly packed). format: "aseprite-array" (default), "aseprite-hash" or "texturepacker". Example: {"path":"knight","layout":"grid","columns":4,"scale":2,"padding":1}. Returns both written paths.',
    input: obj({
      path: z.string().min(1).optional().describe(`${PATH_DESC} Give the .png name; the JSON gets the same name with .json.`),
      layout: z.enum(['horizontal', 'vertical', 'grid', 'packed']).optional().describe('Frame arrangement (default horizontal).'),
      columns: z.number().int().min(1).optional().describe('Column count for layout "grid" (default: about the square root of the frame count).'),
      scale: z.number().int().min(1).max(32).optional().describe('Integer upscale factor (default 1).'),
      padding: z.number().int().min(0).max(64).optional().describe('Pixels between frames (default 0).'),
      border: z.number().int().min(0).max(64).optional().describe('Pixels around the whole sheet (default 0).'),
      trim: z.boolean().optional().describe('Trim transparent borders of each frame (default false; true for "packed").'),
      powerOfTwo: z.boolean().optional().describe('Round the sheet size up to powers of two (default false).'),
      tags: z.array(z.string()).min(1).optional().describe('Only the frames of these animation tags (names). Default: all frames.'),
      frames: z
        .union([z.array(z.number().int().min(0)).min(1), obj({ from: z.number().int().min(0), to: z.number().int().min(0) })])
        .optional()
        .describe('Only these frames: a list of 0-based indices or {from, to}. Ignored when tags is given.'),
      layers: layersArg,
      format: z.enum(['aseprite-array', 'aseprite-hash', 'texturepacker']).optional().describe('JSON metadata format (default aseprite-array).')
    }),
    handler: async (args, { session, services }) => {
      const doc = session.doc
      const name = withExtension(args.path ?? safeFileName(doc.name), 'png')
      const pngPath = await services.resolveExportPath(name)
      const jsonPath = pngPath.replace(/\.png$/i, '') + '.json'
      const opts: SpriteSheetOptions = {
        layout: args.layout as SheetLayout | undefined,
        columns: args.columns,
        scale: args.scale,
        padding: args.padding,
        border: args.border,
        trim: args.trim,
        powerOfTwo: args.powerOfTwo,
        tags: args.tags,
        frames: args.frames,
        layers: args.layers,
        imageName: baseName(pngPath)
      }
      const sheet = buildSpriteSheet(doc, opts)
      const meta = sheetMetadata(sheet, (args.format ?? 'aseprite-array') as SheetMetaFormat)
      await services.writeFile(pngPath, encodePng({ width: sheet.width, height: sheet.height, data: sheet.data }))
      await services.writeFile(jsonPath, JSON.stringify(meta, null, 2))
      return ok(
        `Exported sprite sheet ${sheet.width}x${sheet.height} px with ${plural(sheet.frames.length, 'frame')}${sheet.tags.length ? ` and ${plural(sheet.tags.length, 'tag')}` : ''} (${sheet.layout} layout).\nImage: ${pngPath}\nMetadata: ${jsonPath}`
      )
    }
  }),

  defineTool({
    name: 'export_gif',
    group: 'export',
    readOnly: true,
    description:
      "Export the animation as an animated GIF using each frame's duration. Optionally only one animation tag (its direction, e.g. pingpong, is honoured) or a frame range. Transparent pixels stay transparent. Returns the written path.",
    input: obj({
      path: z.string().min(1).optional().describe(PATH_DESC),
      tag: z.string().optional().describe('Export only this animation tag (name).'),
      frames: obj({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional().describe('Export only frames from..to (0-based, inclusive). Ignored when tag is given.'),
      scale: z.number().int().min(1).max(32).optional().describe('Integer upscale factor (default 1).'),
      loop: z.boolean().optional().describe('Loop forever (default true); false plays once.'),
      layers: layersArg
    }),
    handler: async (args, { session, services }) => {
      const doc = session.doc
      let order: number[]
      if (args.tag) order = tagPlayback(doc, args.tag)
      else if (args.frames) {
        const { from, to } = args.frames
        if (to < from || to >= doc.frames.length) {
          throw new Error(`Frame range ${from}..${to} is invalid: the document has ${plural(doc.frames.length, 'frame')} (0-${doc.frames.length - 1}).`)
        }
        order = []
        for (let i = from; i <= to; i++) order.push(i)
      } else order = doc.frames.map((_, i) => i)
      const fo = flattenOptions(doc, args.layers)
      const frames: GifFrame[] = order.map((i) => {
        const f = doc.frames[i]!
        return { data: flattenFrame(doc, f.id, fo), delayMs: f.durationMs }
      })
      const scale = args.scale ?? 1
      const res = encodeGif({ width: doc.width, height: doc.height, frames, scale, loop: args.loop ?? true, palette: doc.palette.colors.map((c) => c.hex) })
      const base = args.path ?? (args.tag ? `${safeFileName(doc.name)}_${safeFileName(args.tag)}` : safeFileName(doc.name))
      const full = await services.resolveExportPath(withExtension(base, 'gif'))
      await services.writeFile(full, res.bytes)
      return ok(`Exported GIF with ${plural(frames.length, 'frame')} (${doc.width * scale}x${doc.height * scale} px${res.quantized ? ', colors were quantized' : ''}) to ${full}.`)
    }
  })
]
