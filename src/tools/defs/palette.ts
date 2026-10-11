import { z } from 'zod'
import {
  PALETTE_FORMATS,
  clonePalette,
  createAddColorsCommand,
  createRemapToPaletteCommand,
  createRemoveColorsCommand,
  createSetPaletteCommand,
  exportPalette,
  listBuiltinPalettes,
  normalizeHex,
  parsePalette
} from '../../core'
import { defineTool, jsonResult } from '../registry'
import {
  type PaletteListing,
  baseName,
  findPalette,
  frameRef,
  layerRef,
  obj,
  ok,
  paletteNotFound,
  plural,
  safeFileName,
  summarizePaletteColors,
  withExtension
} from '../util'
import { LEGEND_POOL } from './drawing'

const colorEntry = z.union([
  z.string().describe('Hex color "#rrggbb".'),
  obj({ hex: z.string().describe('Hex color "#rrggbb".'), name: z.string().optional().describe('Optional color name.') })
])
const colorList = z.array(colorEntry).min(1).max(4096)

function checkHexes(colors: Array<string | { hex: string; name?: string }>): void {
  colors.forEach((c, i) => {
    const hex = typeof c === 'string' ? c : c.hex
    try {
      normalizeHex(hex)
    } catch (e) {
      throw new Error(`colors[${i}]: ${(e as Error).message}`, { cause: e })
    }
  })
}

export const paletteTools = [
  defineTool({
    name: 'get_palette',
    group: 'palette',
    readOnly: true,
    description:
      'The document palette: every color with its index, hex and optional name. Palette indices can be used as colors anywhere (e.g. color 8 or "p8"), and are the default draw_grid characters (index 0-9 -> "0"-"9", 10-35 -> "a"-"z", 36-61 -> "A"-"Z").',
    input: obj({}),
    handler: (_a, { session }) => {
      const p = session.doc.palette
      return jsonResult(
        {
          id: p.id,
          name: p.name,
          size: p.colors.length,
          colors: summarizePaletteColors(p).map((c) => ({ ...c, char: LEGEND_POOL[c.index] })),
          note: 'char = the default draw_grid/read_grid character for this color (only the first 62 colors have one).'
        }
      )
    }
  }),

  defineTool({
    name: 'set_palette',
    group: 'palette',
    description:
      'Replace the document palette with your own list of colors (e.g. a custom 12-color forest palette). Existing pixels are NOT recolored; use remap_to_palette for that. Order matters: index 0 is the first color. Tip: put the darkest color first and build hue-shifted ramps. Example: {"name":"Forest","colors":["#0b1d12","#1f4d2b",{"hex":"#3f8f3a","name":"leaf"},"#9bd35a"]}. Use save_palette afterwards to keep it for other documents.',
    input: obj({
      name: z.string().optional().describe('Palette name. Default "Custom".'),
      colors: colorList.describe('Colors as hex strings or {hex, name}.')
    }),
    handler: ({ name, colors }, { session }) => {
      checkHexes(colors)
      session.execute(createSetPaletteCommand(session.doc, { name, colors }))
      return ok(`Document palette is now "${session.doc.palette.name}" with ${plural(session.doc.palette.colors.length, 'color')}.`)
    }
  }),

  defineTool({
    name: 'add_colors',
    group: 'palette',
    description: 'Append colors to the document palette (colors already in it are skipped). Existing indices do not change.',
    input: obj({ colors: colorList.describe('Colors as hex strings or {hex, name}.') }),
    handler: ({ colors }, { session }) => {
      checkHexes(colors)
      const before = session.doc.palette.colors.length
      session.execute(createAddColorsCommand(session.doc, colors))
      const n = session.doc.palette.colors.length
      return ok(`Palette now has ${plural(n, 'color')} (${n - before} added; indices ${before}..${n - 1} are new).`)
    }
  }),

  defineTool({
    name: 'remove_colors',
    group: 'palette',
    description:
      'Remove colors from the document palette, by index (number) or hex string. Note: later indices shift down. Pixels already drawn keep their color; only the palette entries go.',
    input: obj({
      colors: z.array(z.union([z.number().int().min(0), z.string()])).min(1).describe('Palette indices or hex strings to remove.')
    }),
    handler: ({ colors }, { session }) => {
      session.execute(createRemoveColorsCommand(session.doc, colors))
      return ok(`Removed ${plural(colors.length, 'color')}. The palette now has ${plural(session.doc.palette.colors.length, 'color')} (indices were renumbered).`)
    }
  }),

  defineTool({
    name: 'list_palettes',
    group: 'palette',
    readOnly: true,
    description:
      'List the palettes you can load: built-ins (PICO-8, DB32, Endesga 32/64, Sweetie 16, Game Boy, NES, CGA, ...) and palettes the user saved. Each has an id, name and size. Use load_palette / new_document / remap_to_palette with the id or name.',
    input: obj({}),
    handler: async (_a, { services }) => {
      const list: PaletteListing[] = listBuiltinPalettes().map((p) => ({ id: p.id, name: p.name, size: p.size, source: 'builtin', description: p.description }))
      for (const u of await services.listUserPalettes()) list.push({ id: u.id, name: u.name, size: u.size, source: 'user' })
      return jsonResult({ palettes: list })
    }
  }),

  defineTool({
    name: 'load_palette',
    group: 'palette',
    description:
      'Make a built-in or saved palette the document palette. By default existing pixels keep their colors; pass remap=true to also snap all pixels to the nearest color of the new palette (a real colour-scheme change). Example: {"palette":"sweetie-16","remap":true}.',
    input: obj({
      palette: z.string().describe('Palette id or name (see list_palettes).'),
      remap: z.boolean().optional().describe('Also recolor existing art to the new palette (default false).')
    }),
    handler: async ({ palette, remap }, ctx) => {
      const p = await findPalette(ctx, palette)
      if (!p) throw paletteNotFound(palette)
      const doc = ctx.session.doc
      if (remap) ctx.session.execute(createRemapToPaletteCommand(doc, { palette: p, setDocumentPalette: true }))
      else ctx.session.execute(createSetPaletteCommand(doc, p))
      return ok(`Loaded palette "${p.name}" (${plural(p.colors.length, 'color')})${remap ? ' and remapped the artwork to it' : ''}.`)
    }
  }),

  defineTool({
    name: 'import_palette',
    group: 'palette',
    description:
      'Import a palette file (.hex Lospec, .gpl GIMP, .pal JASC, or a PNG swatch strip/image) and make it the document palette. Optionally also save it for later use.',
    input: obj({
      path: z.string().min(1).describe('Absolute path of the palette file.'),
      name: z.string().optional().describe('Palette name. Default: the file name.'),
      apply: z.boolean().optional().describe('Make it the document palette (default true).'),
      save: z.boolean().optional().describe('Also save it to the user palette library (default false).')
    }),
    handler: async ({ path, name, apply, save }, { session, services }) => {
      const bytes = await services.readFile(path)
      const palette = parsePalette(bytes, path, name)
      if (apply ?? true) session.execute(createSetPaletteCommand(session.doc, palette))
      let saved = ''
      if (save) {
        const info = await services.saveUserPalette(palette)
        saved = ` Saved as "${info.id}".`
      }
      return ok(`Imported palette "${palette.name}" with ${plural(palette.colors.length, 'color')} from ${baseName(path)}${(apply ?? true) ? ' and applied it to the document' : ''}.${saved}`)
    }
  }),

  defineTool({
    name: 'export_palette',
    group: 'palette',
    readOnly: true,
    description:
      'Write a palette to a file: .hex (Lospec, one hex per line), .gpl (GIMP), .pal (JASC) or a .png swatch strip. Exports the document palette unless `palette` names another. Default folder: ~/PixelStudio/exports.',
    input: obj({
      format: z.enum(PALETTE_FORMATS as unknown as [string, ...string[]]).describe('File format.'),
      path: z.string().optional().describe('File name or absolute path. Default: <palette name>.<format>.'),
      palette: z.string().optional().describe('Palette id/name to export instead of the document palette.'),
      swatchSize: z.number().int().min(1).max(64).optional().describe('png only: pixel size of each swatch (default 1).')
    }),
    handler: async ({ format, path, palette, swatchSize }, ctx) => {
      const p = palette ? await findPalette(ctx, palette) : ctx.session.doc.palette
      if (!p) throw paletteNotFound(palette!)
      const full = await ctx.services.resolveExportPath(withExtension(path ?? safeFileName(p.name), format))
      const data = exportPalette(p, format as never, swatchSize)
      await ctx.services.writeFile(full, data)
      return ok(`Exported palette "${p.name}" (${plural(p.colors.length, 'color')}) to ${full}.`)
    }
  }),

  defineTool({
    name: 'remap_to_palette',
    group: 'palette',
    description:
      'Snap every pixel to the nearest color of a palette (alpha is kept): converts existing art to a colour scheme. Without `palette` it snaps to the current document palette (cleans up stray off-palette colors). With `palette` (id/name) the document palette is switched too (unless set_palette=false). By default affects all pixel layers and all frames; pass layer and/or frame to limit it.',
    input: obj({
      palette: z.string().optional().describe('Target palette id or name. Default: the document palette.'),
      layer: layerRef('Limit to this layer. Default: all pixel layers.').optional(),
      frame: frameRef('Limit to this frame. Default: all frames.').optional(),
      mode: z.enum(['perceptual', 'rgb']).optional().describe('Color distance: perceptual (OKLab, default) or plain rgb.'),
      set_palette: z.boolean().optional().describe('Also make the target palette the document palette (default true when `palette` is given).')
    }),
    handler: async ({ palette, layer, frame, mode, set_palette }, ctx) => {
      const doc = ctx.session.doc
      const target = palette ? await findPalette(ctx, palette) : null
      if (palette && !target) throw paletteNotFound(palette)
      const layerObj = layer === undefined ? undefined : doc.layers.find((l) => l.id === layer || l.name.toLowerCase() === String(layer).toLowerCase()) ?? (typeof layer === 'number' ? doc.layers[layer] : /^\d+$/.test(String(layer)) ? doc.layers[Number(layer)] : undefined)
      if (layer !== undefined && !layerObj) throw new Error(`Layer ${JSON.stringify(layer)} not found.`)
      const frameObj = frame === undefined ? undefined : doc.frames.find((f) => f.id === frame) ?? (typeof frame === 'number' ? doc.frames[frame] : /^\d+$/.test(String(frame)) ? doc.frames[Number(frame)] : undefined)
      if (frame !== undefined && !frameObj) throw new Error(`Frame ${JSON.stringify(frame)} not found.`)
      const used = target ?? clonePalette(doc.palette)
      ctx.session.execute(
        createRemapToPaletteCommand(doc, {
          palette: target ?? undefined,
          layer: layerObj?.id,
          frame: frameObj?.id,
          mode,
          setDocumentPalette: target ? (set_palette ?? true) : false
        })
      )
      return ok(
        `Remapped ${layerObj ? `layer "${layerObj.name}"` : 'all pixel layers'}, ${frameObj ? `frame ${doc.frames.indexOf(frameObj)}` : 'all frames'} to palette "${used.name}" (${plural(used.colors.length, 'color')}).`
      )
    }
  }),

  defineTool({
    name: 'save_palette',
    group: 'palette',
    readOnly: true,
    description:
      'Save a palette to the user\'s palette library (~/PixelStudio/palettes) so it can be reused in other documents via list_palettes / load_palette. Saves the document palette unless `colors` is given. Saving under an existing name overwrites it.',
    input: obj({
      name: z.string().min(1).optional().describe('Name to save under. Default: the document palette name.'),
      colors: colorList.optional().describe('Save these colors instead of the document palette.')
    }),
    handler: async ({ name, colors }, { session, services }) => {
      const doc = session.doc
      if (colors) checkHexes(colors)
      const base = colors
        ? { id: 'custom', name: name ?? 'Custom', colors: colors.map((c) => (typeof c === 'string' ? { hex: normalizeHex(c) } : { hex: normalizeHex(c.hex), ...(c.name ? { name: c.name } : {}) })) }
        : { ...clonePalette(doc.palette), name: name ?? doc.palette.name }
      const info = await services.saveUserPalette(base)
      return ok(`Saved palette "${info.name}" (${plural(info.size, 'color')}) to the library as "${info.id}"${info.path ? ` (${info.path})` : ''}.`)
    }
  })
]
