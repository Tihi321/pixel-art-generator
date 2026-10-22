// Tools added for VN Studio (VNO-02): import_image, export_many, draw_sprite_from_reference and the
// document tools (list_documents, open_document, save_document). Each of them ends with a JSON text item
// (see the VNO-02 contracts): the text before it is for humans and LLMs, the last item is for programs.

import { z } from 'zod'
import {
  type Document,
  type Palette,
  type RgbaImage,
  areaResize,
  celKey,
  convertImage,
  createDocument,
  createLayer,
  createPalette,
  decodePng,
  deserializeProject,
  hasPngSignature,
  hexToRgba,
  medianCutPalette,
  packRgba,
  paletteToRgba,
  parseHexColor,
  rasterToCel,
  rgbaToHex,
  serializeProject,
  MAX_IMPORT_SIDE
} from '../../core'
import type { ToolResult } from '../../shared/tools'
import { type ExportTarget, addDocument, exportToTarget, resolveDocument, writeDocumentPng } from '../documents'
import { type ToolContext, defineTool, textResult } from '../registry'
import { DOCUMENT_DESC, findPalette, obj, paletteNotFound, pathStem, plural, safeFileName, withExtension } from '../util'

/** Human text first, then one JSON object as the LAST content item (the VN Studio contract). */
export function withJson(text: string, json: Record<string, unknown>): ToolResult {
  const r = textResult(text)
  r.content.push({ type: 'text', text: JSON.stringify(json) })
  return r
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i

/** PNG natively; JPEG/WebP/GIF/BMP/AVIF through `services.decodeImage` when the host has one. */
export async function decodeImageFile(ctx: ToolContext, path: string): Promise<RgbaImage> {
  const bytes = await ctx.services.readFile(path)
  if (hasPngSignature(bytes)) return decodePng(bytes)
  if (ctx.services.decodeImage) {
    try {
      return await ctx.services.decodeImage(bytes)
    } catch (e) {
      throw new Error(`Cannot decode ${path}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
  }
  throw new Error(`Cannot decode ${path}: this host reads PNG files only. Convert the image to PNG first.`)
}

/** A palette argument: a palette id/name, a comma/space separated hex list, or an array of hex colors. */
export async function resolvePaletteArg(ctx: ToolContext, value: string | string[]): Promise<Palette> {
  if (Array.isArray(value)) return hexPalette(value)
  const named = await findPalette(ctx, value)
  if (named) return named
  if (value.includes('#') || /^[0-9a-f]{6}([\s,;]+[0-9a-f]{6})*$/i.test(value.trim())) return hexPalette(value.split(/[\s,;]+/).filter(Boolean))
  throw paletteNotFound(value)
}

function hexPalette(hexes: string[]): Palette {
  if (hexes.length === 0) throw new Error('The palette list is empty.')
  for (const h of hexes) if (parseHexColor(h) === null) throw new Error(`Invalid palette color "${h}". Use "#rrggbb".`)
  return createPalette('Custom', hexes)
}

function describeSize(doc: Document): string {
  return `${doc.width}x${doc.height}`
}

const pngSafeName = (name: string): string => safeFileName(name)

export const studioTools = [
  defineTool({
    name: 'import_image',
    group: 'documents',
    document: false,
    readOnly: true,
    description:
      `Turn an image file (PNG always; JPEG, WebP and GIF/BMP/AVIF in the app and in headless mode, not in plain Node) into a pixel-art document: area-average downscale (alpha-aware, so transparent backgrounds do not bleed into the edges) -> alpha threshold -> remap to a palette with optional dithering (transparent pixels are never dithered) -> orphan-pixel cleanup -> optional 1 px outline. The result is a NEW document with one pixel layer, and it becomes the current document. Max ${MAX_IMPORT_SIDE}x${MAX_IMPORT_SIDE}. ` +
      'Give width and height (or only one: the aspect ratio is kept) or scale (a divisor). Use `palette` (a palette id/name such as "endesga-32", or a list of hex colors) to force the colors; without it maxColors colors are derived from the image (median cut). ' +
      'A 1920x1080 background can be imported directly; or import 320x180 and export_png with width/height 1920x1080. Example: {"path":"C:/art/bg.png","width":320,"height":180,"palette":"db32","dither":"ordered"}. ' +
      'Returns a sentence and a JSON object {documentId,name,width,height,colors,transparentPixels}.',
    input: obj({
      path: z.string().min(1).describe('Absolute path of the image file (PNG; JPEG, WebP, GIF, BMP, AVIF in the app and headless mode).'),
      name: z.string().min(1).optional().describe('Document name. Default: the file name.'),
      width: z.number().int().min(1).max(MAX_IMPORT_SIDE).optional().describe('Output width in pixels.'),
      height: z.number().int().min(1).max(MAX_IMPORT_SIDE).optional().describe('Output height in pixels.'),
      scale: z.number().positive().optional().describe('Downscale divisor (4 = a quarter of the size). Alternative to width/height.'),
      palette: z.union([z.string(), z.array(z.string()).min(1)]).optional().describe('Palette id/name (see list_palettes) or hex colors. Default: derive maxColors colors from the image.'),
      maxColors: z.number().int().min(2).max(256).optional().describe('Colors of the derived palette when no palette is given (default 32).'),
      dither: z.enum(['none', 'ordered', 'floyd']).optional().describe('Dithering when snapping to the palette (default none). Never applied to transparent pixels.'),
      outline: z.union([z.boolean(), z.string()]).optional().describe('1 px outline around opaque regions: true = the darkest palette color, or a hex color.'),
      cleanup: z.boolean().optional().describe('Remove orphan single pixels (default true). With dithering only isolated opaque pixels are removed.'),
      alphaThreshold: z.number().int().min(0).max(255).optional().describe('Pixels with alpha below this become fully transparent, the rest fully opaque (default 128).')
    }),
    handler: async (args, ctx) => {
      const src = await decodeImageFile(ctx, args.path)
      const palette = args.palette !== undefined ? await resolvePaletteArg(ctx, args.palette) : undefined
      let outline: boolean | number | undefined
      if (typeof args.outline === 'string') {
        const c = parseHexColor(args.outline)
        if (c === null) throw new Error(`Invalid outline color "${args.outline}". Use "#rrggbb" or true.`)
        outline = c
      } else outline = args.outline
      const res = convertImage(src, {
        width: args.width,
        height: args.height,
        scale: args.scale,
        palette: palette ? paletteToRgba(palette) : undefined,
        maxColors: args.maxColors,
        dither: args.dither,
        outline,
        cleanup: args.cleanup,
        alphaThreshold: args.alphaThreshold
      })
      const { raster } = res
      let docPalette: Palette
      if (palette) {
        docPalette = palette
        // an outline color outside the palette is added so the document stays consistent
        const extra = res.palette.filter((c) => !paletteToRgba(palette).includes(c))
        if (extra.length) docPalette = { ...palette, colors: [...palette.colors, ...extra.map((c) => ({ hex: rgbaToHex(c) }))] }
      } else docPalette = createPalette('Imported', res.palette.map((c) => rgbaToHex(c)))
      const name = args.name ?? pathStem(args.path)
      const doc = createDocument({ width: raster.width, height: raster.height, name, palette: docPalette })
      const cel = rasterToCel(raster)
      if (cel) doc.cels.set(celKey(doc.layers[0]!.id, doc.frames[0]!.id), cel)
      const documentId = addDocument(ctx, doc)
      return withJson(
        `Imported ${args.path} as "${name}" ${describeSize(doc)} with ${plural(res.colors, 'color')} (palette "${docPalette.name}", ${plural(docPalette.colors.length, 'palette color')}), ${plural(res.transparentPixels, 'transparent pixel')}${res.cleaned ? `, ${plural(res.cleaned, 'orphan pixel')} cleaned` : ''}. It is the current document (id ${documentId}). Export it with export_png (width/height for an exact size).`,
        { documentId, name, width: raster.width, height: raster.height, colors: res.colors, transparentPixels: res.transparentPixels }
      )
    }
  }),

  defineTool({
    name: 'export_many',
    group: 'export',
    document: false,
    readOnly: true,
    description:
      'Export several PNGs in one call. Each item: {document?, path, width?, height?, scale?, frame?}: the document (default current), the output path (absolute, or a file name for ~/PixelStudio/exports), an exact size (width and height, nearest neighbour, any ratio) or an integer scale, and the frame (default active). Returns the written paths as text and as JSON {paths}. Example: {"items":[{"document":"doc2","path":"C:/out/bg.png","width":1920,"height":1080}]}.',
    input: obj({
      items: z
        .array(
          obj({
            document: z.string().optional().describe(DOCUMENT_DESC),
            path: z.string().min(1).describe('Output path.'),
            width: z.number().int().min(1).optional().describe('Exact output width in pixels.'),
            height: z.number().int().min(1).optional().describe('Exact output height in pixels.'),
            scale: z.number().int().min(1).max(32).optional().describe('Integer upscale factor (ignored when width and height are given).'),
            frame: z.union([z.string(), z.number().int()]).optional().describe('Frame id or 0-based index (default: the active frame).')
          })
        )
        .min(1)
        .max(200)
    }),
    handler: async ({ items }, ctx) => {
      const paths: string[] = []
      for (const [i, it] of items.entries()) {
        try {
          const ref = resolveDocument(ctx, it.document)
          const r = await writeDocumentPng(ref.session, ctx.services, it.path, { width: it.width, height: it.height, scale: it.scale, frame: it.frame })
          paths.push(r.path)
        } catch (e) {
          throw new Error(`items[${i}] (${it.path}): ${e instanceof Error ? e.message : String(e)}`, { cause: e })
        }
      }
      return withJson(`Exported ${plural(paths.length, 'PNG file')}:\n${paths.join('\n')}`, { paths })
    }
  }),

  defineTool({
    name: 'draw_sprite_from_reference',
    group: 'documents',
    document: false,
    readOnly: true,
    description:
      'Prepare a small sprite (up to 128x128, typically 64x96) that YOU then draw from a reference image: creates a new document of that size with the given palette, adds the reference downscaled to fit as a dimmed, locked REFERENCE layer (never exported), and returns drawing guidance. Draw on the "Sprite" layer with draw_grid (max 64x64 per call), look with render_preview, then export_png. The new document becomes current. Returns text plus JSON {documentId,name,width,height,palette,referenceLayerId}.',
    input: obj({
      reference: z.string().min(1).describe('Absolute path of the reference image.'),
      width: z.number().int().min(1).max(128).describe('Sprite width in pixels (max 128).'),
      height: z.number().int().min(1).max(128).describe('Sprite height in pixels (max 128).'),
      palette: z.union([z.string(), z.array(z.string()).min(1)]).describe('Palette id/name (see list_palettes) or hex colors. Use only these colors.'),
      expression: z.string().optional().describe('Facial expression or pose to draw, e.g. "smiling", "worried", "surprised".'),
      name: z.string().min(1).optional().describe('Document name. Default: the reference file name.')
    }),
    handler: async (args, ctx) => {
      const palette = await resolvePaletteArg(ctx, args.palette)
      const src = await decodeImageFile(ctx, args.reference)
      const fit = Math.min(args.width / src.width, args.height / src.height)
      const rw = Math.max(1, Math.min(args.width, Math.round(src.width * fit)))
      const rh = Math.max(1, Math.min(args.height, Math.round(src.height * fit)))
      const small = areaResize(src, rw, rh)
      const name = args.name ?? `${pathStem(args.reference)} sprite`
      const doc = createDocument({ width: args.width, height: args.height, name, palette })
      const ref = createLayer({ name: 'Reference', kind: 'reference', locked: true, opacity: 0.45 })
      const sprite = createLayer({ name: 'Sprite' })
      doc.layers = [ref, sprite]
      const data = new Uint32Array(rw * rh)
      for (let i = 0; i < data.length; i++) data[i] = small.data[i]!
      doc.cels.set(celKey(ref.id, doc.frames[0]!.id), { x: Math.floor((args.width - rw) / 2), y: Math.floor((args.height - rh) / 2), w: rw, h: rh, data })
      const documentId = addDocument(ctx, doc)
      const hexes = palette.colors.map((c) => c.hex)
      const expression = args.expression?.trim()
      const guide = [
        `Created "${name}" ${args.width}x${args.height} (document ${documentId}, now current) with palette "${palette.name}" (${plural(hexes.length, 'color')}): ${hexes.join(' ')}.`,
        `The reference (${src.width}x${src.height}) is on the locked, dimmed layer "Reference" (id ${ref.id}) at ${rw}x${rh}; it is NOT exported. Draw on the layer "Sprite" (id ${sprite.id}, the active layer).`,
        'How to draw: call render_preview to see the reference, read the silhouette, then paint with draw_grid (rows of characters + a legend of palette colors; max 64x64 per call, use x/y for the rest). Block in the silhouette in one color first, then base colors, shading, highlights, and finally a 1 px outline (the outline tool can do it). Use only the palette colors, hue-shifted shadows (cooler) and highlights (warmer). Keep it clean: no stray single pixels.',
        expression ? `Expression: ${expression}. Keep the body and outfit of the reference and change only what shows the expression (eyes, brows, mouth, head tilt). Redraw the face at the pixel level instead of blurring it.` : 'Expression: copy the one in the reference.',
        'When done: render_preview to compare with the reference, fix differences, then export_png (width/height for an exact size).'
      ].join('\n')
      return withJson(guide, { documentId, name, width: args.width, height: args.height, palette: hexes, referenceLayerId: ref.id })
    }
  }),

  defineTool({
    name: 'list_documents',
    group: 'documents',
    document: false,
    readOnly: true,
    description: 'List the open documents: documentId, name, size, the project path (null until saved), whether it is the current one and whether it has unsaved changes. Returns text and JSON {documents}.',
    input: obj({}),
    handler: (_args, ctx) => {
      const documents = ctx.documents
        ? ctx.documents.list()
        : [{ documentId: ctx.session.doc.id, name: ctx.session.doc.name, width: ctx.session.doc.width, height: ctx.session.doc.height, path: null, current: true, dirty: false }]
      const lines = documents.map((d) => `${d.current ? '*' : ' '} ${d.documentId}: "${d.name}" ${d.width}x${d.height}${d.path ? ` (${d.path})` : ''}${d.dirty ? ' [unsaved]' : ''}`)
      return withJson(`${plural(documents.length, 'open document')} (* = current):\n${lines.join('\n')}`, { documents })
    }
  }),

  defineTool({
    name: 'select_document',
    group: 'documents',
    readOnly: true,
    description: 'Make a document the current one (the default target of every tool call without `document`; in the window app its tab comes to the front). Returns text and JSON {documentId,name,width,height}.',
    input: obj({ document: z.string().min(1).describe('documentId (see list_documents).') }),
    handler: (args, ctx) => {
      const documentId = ctx.documentId ?? args.document
      ctx.documents?.activate(documentId)
      const d = ctx.session.doc
      return withJson(`Document ${documentId} ("${d.name}" ${describeSize(d)}) is now the current document.`, { documentId, name: d.name, width: d.width, height: d.height })
    }
  }),

  defineTool({
    name: 'close_document',
    group: 'documents',
    readOnly: true,
    description:
      'Close a document. A document with unsaved changes is refused unless force=true: save_document it first to keep it. If it was the current one, the most recently added remaining document becomes current; closing the last one leaves a blank 32x32 document. Returns text and JSON {documentId,closed,current} (current = the documentId that is current now).',
    input: obj({
      document: z.string().min(1).describe('documentId (see list_documents).'),
      force: z.boolean().optional().describe('Close even with unsaved changes (they are lost). Default false.')
    }),
    handler: (args, ctx) => {
      if (!ctx.documents) throw new Error('This host has a single document, it cannot be closed.')
      const documentId = ctx.documentId ?? args.document
      ctx.documents.close(documentId, { force: args.force })
      const current = ctx.documents.list().find((d) => d.current)?.documentId ?? null
      return withJson(`Closed document ${documentId}. Current document: ${current ?? 'none'}.`, { documentId, closed: true, current })
    }
  }),

  defineTool({
    name: 'open_document',
    group: 'documents',
    document: false,
    readOnly: true,
    description:
      'Open a Pixel Studio project (.pxs) or an image (PNG; a PNG opens as a new one-layer document at its pixel size) and make it the current document. With exportTo, the app writes a PNG there (optionally scaled to exportWidth x exportHeight, nearest neighbour) every time the document is saved (save_document, Ctrl+S): that is how an edit in the editor flows back to VN Studio. In the window app the document shows in a new tab. Returns text and JSON {documentId,name,width,height,path}.',
    input: obj({
      path: z.string().min(1).describe('Absolute path of a .pxs project or a PNG.'),
      exportTo: z.string().min(1).optional().describe('Absolute path of the PNG to write on every save.'),
      exportWidth: z.number().int().min(1).optional().describe('Exact export width (use with exportHeight).'),
      exportHeight: z.number().int().min(1).optional().describe('Exact export height (use with exportWidth).')
    }),
    handler: async (args, ctx) => {
      const exportTo: ExportTarget | undefined = args.exportTo ? { path: args.exportTo, width: args.exportWidth, height: args.exportHeight } : undefined
      const isImage = IMAGE_EXT.test(args.path)
      let nativePath: string | null = null
      let documentId: string
      if (isImage) {
        const img = await decodeImageFile(ctx, args.path)
        const distinct = new Set<number>()
        for (let i = 0; i < img.data.length && distinct.size <= 64; i++) if (img.data[i]! >>> 24 !== 0) distinct.add(img.data[i]! & 0xffffff)
        const colors = distinct.size <= 64 ? [...distinct].map((rgb) => packRgba(rgb & 255, (rgb >>> 8) & 255, (rgb >>> 16) & 255)) : medianCutPalette(img.data, 64)
        const hexes = (colors.length ? colors : [hexToRgba('#000000')]).map((c) => rgbaToHex(c))
        const doc = createDocument({ width: img.width, height: img.height, name: pathStem(args.path), palette: createPalette('Imported', hexes) })
        const r = { width: img.width, height: img.height, data: img.data.slice() }
        const cel = rasterToCel(r)
        if (cel) doc.cels.set(celKey(doc.layers[0]!.id, doc.frames[0]!.id), cel)
        documentId = addDocument(ctx, doc, { path: null, exportTo })
      } else {
        const full = await ctx.services.resolveProjectPath(withExtension(args.path, 'pxs'))
        nativePath = full
        const open = ctx.documents?.findByPath(full)
        if (open && ctx.documents) {
          ctx.documents.activate(open)
          ctx.documents.setExportTarget(open, exportTo)
          documentId = open
        } else {
          const doc = deserializeProject(new TextDecoder().decode(await ctx.services.readFile(full)))
          documentId = addDocument(ctx, doc, { path: full, exportTo })
        }
      }
      const info = resolveDocument(ctx, documentId).session.doc
      return withJson(
        `Opened "${info.name}" ${describeSize(info)} as document ${documentId} (the current document)${exportTo ? `; saving exports a PNG to ${exportTo.path}` : ''}.`,
        { documentId, name: info.name, width: info.width, height: info.height, path: nativePath ?? args.path }
      )
    }
  }),

  defineTool({
    name: 'save_document',
    group: 'documents',
    readOnly: true,
    description:
      'Save a document as a Pixel Studio project (.pxs). Defaults: the current document, and the path it was opened from or last saved to (else ~/PixelStudio/projects/<name>.pxs). When the document was opened with exportTo, the PNG is exported there too. Returns text and JSON {documentId,path,exported?}.',
    input: obj({
      document: z.string().optional().describe(DOCUMENT_DESC),
      path: z.string().min(1).optional().describe('Absolute path or file name (".pxs" is added if missing).')
    }),
    handler: async (args, ctx) => {
      const ref = resolveDocument(ctx, args.document)
      const doc = ref.session.doc
      const full = await ctx.services.resolveProjectPath(withExtension(args.path ?? ref.path ?? pngSafeName(doc.name), 'pxs'))
      await ctx.services.writeFile(full, serializeProject(doc))
      ctx.documents?.markSaved(ref.documentId, full)
      const exported = await exportToTarget(ctx.documents ? ctx.documents.resolve(ref.documentId) : ref, ctx.services)
      return withJson(`Saved "${doc.name}" to ${full}${exported ? ` and exported ${exported}` : ''}.`, {
        documentId: ref.documentId,
        path: full,
        ...(exported ? { exported } : {})
      })
    }
  })
]

