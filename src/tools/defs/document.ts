import { z } from 'zod'
import {
  ANCHORS,
  MAX_DIMENSION,
  createDocument,
  createResizeCanvasCommand,
  deserializeProject,
  serializeProject
} from '../../core'
import { addDocument, resolveDocument } from '../documents'
import { defineTool, jsonResult } from '../registry'
import { withJson } from './studio'
import type { EditorSession } from '../session'
import {
  FRAME_REF_DESC,
  LAYER_REF_DESC,
  frameRef,
  layerRef,
  obj,
  ok,
  findPalette,
  paletteNotFound,
  resolveFrame,
  resolveLayer,
  safeFileName,
  summarizePaletteColors,
  withExtension
} from '../util'

/** Compact JSON-able summary of the document (also used for the agent's system context). */
export function summarizeDocument(session: EditorSession, documentId?: string): Record<string, unknown> {
  const doc = session.doc
  const celCount = (layerId: string): number => doc.frames.filter((f) => doc.cels.has(`${layerId}:${f.id}`)).length
  return {
    name: doc.name,
    id: doc.id,
    ...(documentId ? { documentId } : {}),
    width: doc.width,
    height: doc.height,
    palette: { id: doc.palette.id, name: doc.palette.name, size: doc.palette.colors.length, colors: summarizePaletteColors(doc.palette) },
    layers: doc.layers.map((l, index) => ({
      index,
      id: l.id,
      name: l.name,
      kind: l.kind,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blend: l.blend,
      filledFrames: celCount(l.id)
    })),
    frames: doc.frames.map((f, index) => ({ index, id: f.id, durationMs: f.durationMs })),
    tags: doc.tags.map((t) => ({ id: t.id, name: t.name, from: t.from, to: t.to, direction: t.direction, loop: t.loop ?? true })),
    active: {
      layer: { index: session.activeLayerIndex, id: session.activeLayer.id, name: session.activeLayer.name },
      frame: { index: session.activeFrameIndex, id: session.activeFrame.id }
    },
    references: doc.references,
    canUndo: session.canUndo(),
    canRedo: session.canRedo(),
    note: 'Layers are listed bottom to top (index 0 = bottom). Frames are in playback order. Coordinates: x right, y down, origin top-left.'
  }
}

export const documentTools = [
  defineTool({
    name: 'get_document',
    group: 'document',
    readOnly: true,
    description:
      'Summary of the document as JSON: documentId, canvas size, palette (with indices), layers (index, id, name, visible/locked/opacity/blend, how many frames have pixels), frames (index, id, duration), animation tags, the active layer/frame, style references. Call this first, and again whenever you are unsure of the current state.',
    input: obj({}),
    handler: (_args, { session, documentId }) => jsonResult(summarizeDocument(session, documentId))
  }),

  defineTool({
    name: 'new_document',
    group: 'document',
    document: false,
    readOnly: true,
    description: `Create a new empty document (1 transparent layer, 1 frame) and make it the current document. The other open documents stay open (see list_documents, select_document, close_document). Returns text and JSON {documentId,name,width,height,palette}. Example: {"width":32,"height":32,"name":"knight","palette":"endesga-32"}. Max size ${MAX_DIMENSION}x${MAX_DIMENSION}, but 16x16 to 64x64 is the sweet spot for pixel art.`,
    input: obj({
      width: z.number().int().min(1).max(MAX_DIMENSION).describe('Canvas width in pixels.'),
      height: z.number().int().min(1).max(MAX_DIMENSION).describe('Canvas height in pixels.'),
      name: z.string().min(1).optional().describe('Document name (also the default export file name).'),
      palette: z
        .string()
        .optional()
        .describe('Palette id or name: a built-in (pico-8, sweetie-16, db32, endesga-32, endesga-64, gameboy, ...) or a saved palette. Default: pico-8. See list_palettes.')
    }),
    handler: async (args, ctx) => {
      const palette = args.palette ? await findPalette(ctx, args.palette) : undefined
      if (args.palette && !palette) throw paletteNotFound(args.palette)
      const doc = createDocument({ width: args.width, height: args.height, name: args.name, palette: palette ?? undefined })
      const documentId = addDocument(ctx, doc)
      const d = resolveDocument(ctx, documentId).session.doc
      return withJson(
        `Created document "${d.name}" ${d.width}x${d.height} (id ${documentId}, now current) with palette "${d.palette.name}" (${d.palette.colors.length} colors), 1 layer "${d.layers[0]!.name}" (id ${d.layers[0]!.id}) and 1 frame (id ${d.frames[0]!.id}).`,
        { documentId, name: d.name, width: d.width, height: d.height, palette: d.palette.colors.map((c) => c.hex) }
      )
    }
  }),

  defineTool({
    name: 'resize_canvas',
    group: 'document',
    description:
      'Change the canvas size. Existing pixels keep their size and are placed according to `anchor` (default top-left); pixels outside the new canvas are cut off. This does NOT scale the artwork.',
    input: obj({
      width: z.number().int().min(1).max(MAX_DIMENSION).describe('New width in pixels.'),
      height: z.number().int().min(1).max(MAX_DIMENSION).describe('New height in pixels.'),
      anchor: z.enum(ANCHORS as unknown as [string, ...string[]]).optional().describe('Where the old content sits in the new canvas. Default top-left.')
    }),
    handler: ({ width, height, anchor }, { session }) => {
      const doc = session.doc
      const before = `${doc.width}x${doc.height}`
      session.execute(createResizeCanvasCommand(doc, width, height, anchor as never))
      return ok(`Canvas resized from ${before} to ${width}x${height} (anchor ${anchor ?? 'top-left'}).`)
    }
  }),

  defineTool({
    name: 'set_active',
    group: 'document',
    readOnly: true,
    description:
      'Select the active layer and/or frame. Drawing tools use these when you do not pass `layer`/`frame`, and the user sees the selection in the editor. Not an undo step.',
    input: obj({
      layer: layerRef(LAYER_REF_DESC).optional(),
      frame: frameRef(FRAME_REF_DESC).optional()
    }),
    handler: ({ layer, frame }, { session }) => {
      if (layer === undefined && frame === undefined) throw new Error('Pass `layer` and/or `frame`.')
      if (layer !== undefined) session.setActiveLayer(resolveLayer(session, layer).id)
      if (frame !== undefined) session.setActiveFrame(resolveFrame(session, frame).id)
      return ok(`Active layer: "${session.activeLayer.name}" (index ${session.activeLayerIndex}); active frame: ${session.activeFrameIndex}.`)
    }
  }),

  defineTool({
    name: 'open_project',
    group: 'document',
    document: false,
    readOnly: true,
    description:
      'Open a Pixel Studio project file (.pxs) as a new document and make it the current document; the other open documents stay open (a project that is already open is just made current). Give an absolute path, or a file name inside ~/PixelStudio/projects. Returns text and JSON {documentId,name,width,height,path}.',
    input: obj({ path: z.string().min(1).describe('Path of the .pxs file (absolute, or relative to ~/PixelStudio/projects).') }),
    handler: async ({ path }, ctx) => {
      const full = await ctx.services.resolveProjectPath(withExtension(path, 'pxs'))
      const open = ctx.documents?.findByPath(full)
      let documentId: string
      if (open && ctx.documents) {
        ctx.documents.activate(open)
        documentId = open
      } else {
        const bytes = await ctx.services.readFile(full)
        const doc = deserializeProject(new TextDecoder().decode(bytes))
        documentId = addDocument(ctx, doc, { path: full })
      }
      const d = resolveDocument(ctx, documentId).session.doc
      return withJson(
        `Opened "${d.name}" ${d.width}x${d.height} from ${full} as document ${documentId} (now current): ${d.layers.length} layer(s), ${d.frames.length} frame(s), ${d.tags.length} tag(s).`,
        { documentId, name: d.name, width: d.width, height: d.height, path: full }
      )
    }
  }),

  defineTool({
    name: 'save_project',
    group: 'document',
    readOnly: true,
    description:
      'Save the document as a Pixel Studio project (.pxs: layers, frames, tags and palette, lossless). Default location: ~/PixelStudio/projects/<document name>.pxs. Use export_png / export_spritesheet / export_gif for game-ready images.',
    input: obj({
      path: z.string().min(1).optional().describe('Absolute path or file name (".pxs" is added if missing). Default: the document name.')
    }),
    handler: async ({ path }, { session, services }) => {
      const doc = session.doc
      const full = await services.resolveProjectPath(withExtension(path ?? safeFileName(doc.name), 'pxs'))
      await services.writeFile(full, serializeProject(doc))
      return ok(`Saved project to ${full}.`)
    }
  })
]
