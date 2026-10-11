import { z } from 'zod'
import {
  GridError,
  applyGrid,
  clearRaster,
  drawEllipse,
  drawLine,
  drawRect,
  flipH,
  flipV,
  floodFill,
  outline,
  replaceColor,
  rotate,
  setPixels,
  shift
} from '../../core'
import { defineTool } from '../registry'
import { MAX_GRID_SIDE, colorArg, colorToLegendHex, obj, paintCel, parseColor, rectShape, regionSchema, targetShape } from '../util'

/** Characters of the default palette legend: palette index i -> pool[i] (same as read_grid output). */
export const LEGEND_POOL = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

const thickness = z.number().int().min(1).max(32).optional().describe('Line thickness in pixels (default 1).')
const filled = z.boolean().optional().describe('Fill the shape (default false = outline only).')

const MAX_SET_PIXELS = 4096

export const drawingTools = [
  defineTool({
    name: 'draw_grid',
    group: 'drawing',
    description:
      `The main drawing tool: paint a rectangle of pixels from rows of text, one character per pixel. ` +
      `"legend" maps each character to a color: a hex string, a palette index, or null/"transparent" (e.g. {".":null,"k":"#1a1c2c","s":"#f4b41b","r":8}). ` +
      `"." and " " are transparent unless the legend says otherwise. Without a legend, characters map to PALETTE INDICES: 0-9, a-z, A-Z = palette colors 0..61 and "." = transparent (the same characters read_grid prints), so with PICO-8 "8" is red. ` +
      `With a legend, every non-"." character must appear in it. ` +
      `All rows must have the same length. The grid's top-left lands at (x, y) (default 0,0); parts outside the canvas are clipped. ` +
      `Transparent cells leave existing pixels alone unless transparent="clear" (then the grid fully replaces its rectangle, erasing). ` +
      `Limit: ${MAX_GRID_SIDE}x${MAX_GRID_SIDE} per call; for bigger art draw several grids with different x/y. Draws on the active layer/frame unless layer/frame are given. ` +
      `Example: {"rows":["..kk..",".kssk.","..kk.."],"legend":{".":null,"k":"#1a1c2c","s":"#f4b41b"},"x":10,"y":4}.`,
    input: obj({
      rows: z
        .array(z.string())
        .min(1)
        .max(MAX_GRID_SIDE)
        .describe(`Pixel rows, top to bottom; one character per pixel; all the same length (max ${MAX_GRID_SIDE}).`),
      legend: z
        .record(z.string(), z.union([z.string(), z.number().int().nonnegative(), z.null()]))
        .optional()
        .describe('Character -> color. Keys are single characters; values are hex strings, palette indices or null (transparent). Omit to use palette-index characters.'),
      x: z.number().int().optional().describe('Canvas x of the grid\'s left edge (default 0).'),
      y: z.number().int().optional().describe('Canvas y of the grid\'s top edge (default 0).'),
      transparent: z.enum(['skip', 'clear']).optional().describe('"skip" (default): transparent cells keep existing pixels. "clear": they erase.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const doc = ctx.session.doc
      const widest = Math.max(...args.rows.map((r) => Array.from(r).length))
      if (widest > MAX_GRID_SIDE) {
        throw new Error(`The grid is ${widest} characters wide; the limit is ${MAX_GRID_SIDE} per call. Split it into several draw_grid calls using different x/y.`)
      }
      let legend: Record<string, string | null>
      const usedDefault = args.legend === undefined
      if (args.legend) {
        legend = {}
        for (const [k, v] of Object.entries(args.legend)) legend[k] = colorToLegendHex(doc, v)
      } else {
        legend = { '.': null }
        doc.palette.colors.slice(0, LEGEND_POOL.length).forEach((c, i) => {
          legend[LEGEND_POOL[i]!] = c.hex
        })
      }
      const x = args.x ?? 0
      const y = args.y ?? 0
      return paintCel(ctx, args, `Draw grid ${widest}x${args.rows.length} at (${x},${y})`, (img) => {
        try {
          const r = applyGrid(img, { legend, rows: args.rows }, x, y, { transparent: args.transparent })
          return {
            dirty: r.dirty,
            note: r.clipped > 0 ? `${r.clipped} pixel(s) fell outside the ${doc.width}x${doc.height} canvas and were clipped.` : undefined
          }
        } catch (e) {
          if (usedDefault && e instanceof GridError) {
            throw new Error(
              `${e.message}\nNo legend was given, so characters mean palette indices (0-9, a-z, A-Z for colors 0..${Math.min(doc.palette.colors.length, LEGEND_POOL.length) - 1}, "." transparent). Pass a "legend" to use other characters.`,
              { cause: e }
            )
          }
          throw e
        }
      })
    }
  }),

  defineTool({
    name: 'set_pixels',
    group: 'drawing',
    description:
      `Set individual pixels from a list of {x, y, color}. Good for small touch-ups (highlights, eyes); use draw_grid for anything bigger. Up to ${MAX_SET_PIXELS} pixels per call; out-of-canvas pixels are ignored. Use color "transparent" to erase. Example: {"pixels":[{"x":3,"y":2,"color":"#ffffff"},{"x":4,"y":2,"color":8}]}.`,
    input: obj({
      pixels: z
        .array(obj({ x: z.number().int(), y: z.number().int(), color: colorArg() }))
        .min(1)
        .max(MAX_SET_PIXELS)
        .describe('Pixels to set.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const doc = ctx.session.doc
      const writes = args.pixels.map((p) => ({ x: p.x, y: p.y, color: parseColor(doc, p.color) }))
      return paintCel(ctx, args, `Set ${writes.length} pixel(s)`, (img) => setPixels(img, writes))
    }
  }),

  defineTool({
    name: 'draw_line',
    group: 'drawing',
    description: 'Draw a straight line (Bresenham, both end points included). Example: {"x0":2,"y0":2,"x1":13,"y1":9,"color":"#ff004d"}.',
    input: obj({
      x0: z.number().int(),
      y0: z.number().int(),
      x1: z.number().int(),
      y1: z.number().int(),
      color: colorArg(),
      thickness,
      ...targetShape
    }),
    handler: (args, ctx) => {
      const c = parseColor(ctx.session.doc, args.color)
      return paintCel(ctx, args, 'Draw line', (img) => drawLine(img, args.x0, args.y0, args.x1, args.y1, c, { thickness: args.thickness }))
    }
  }),

  defineTool({
    name: 'draw_rect',
    group: 'drawing',
    description:
      'Draw a rectangle with top-left (x, y) and size w x h. Outline only unless filled=true. Example: {"x":4,"y":4,"w":8,"h":6,"color":"#29adff","filled":true}.',
    input: obj({ ...rectShape, color: colorArg(), filled, thickness, ...targetShape }),
    handler: (args, ctx) => {
      const c = parseColor(ctx.session.doc, args.color)
      return paintCel(ctx, args, 'Draw rectangle', (img) => drawRect(img, args.x, args.y, args.w, args.h, c, { filled: args.filled, thickness: args.thickness }))
    }
  }),

  defineTool({
    name: 'draw_ellipse',
    group: 'drawing',
    description:
      'Draw an ellipse (or circle when w = h) inscribed in the bounding box with top-left (x, y) and size w x h. Outline only unless filled=true. Example: {"x":2,"y":2,"w":12,"h":12,"color":"#ffec27","filled":true}.',
    input: obj({ ...rectShape, color: colorArg(), filled, thickness, ...targetShape }),
    handler: (args, ctx) => {
      const c = parseColor(ctx.session.doc, args.color)
      return paintCel(ctx, args, 'Draw ellipse', (img) => drawEllipse(img, args.x, args.y, args.w, args.h, c, { filled: args.filled, thickness: args.thickness }))
    }
  }),

  defineTool({
    name: 'flood_fill',
    group: 'drawing',
    description:
      'Bucket fill: recolor the connected region (4-connected) of same-colored pixels around (x, y). Transparent areas count as a color too, so filling an empty area fills it up to the nearest pixels. contiguous=false recolors every pixel of that color on the cel.',
    input: obj({
      x: z.number().int(),
      y: z.number().int(),
      color: colorArg(),
      contiguous: z.boolean().optional().describe('Default true. false = replace all pixels with the seed color.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const c = parseColor(ctx.session.doc, args.color)
      return paintCel(ctx, args, 'Flood fill', (img) => floodFill(img, args.x, args.y, c, { contiguous: args.contiguous }))
    }
  }),

  defineTool({
    name: 'replace_color',
    group: 'drawing',
    description:
      'Replace every pixel of one exact color by another (in the whole cel or a region). Use "transparent" as `to` to erase a color. Example: {"from":"#ff004d","to":"#ab5236"}.',
    input: obj({
      from: colorArg('Color to find (exact match).'),
      to: colorArg('Replacement color.'),
      region: regionSchema.optional().describe('Limit to this rectangle {x,y,w,h}. Default: the whole cel.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const doc = ctx.session.doc
      const from = parseColor(doc, args.from)
      const to = parseColor(doc, args.to)
      return paintCel(ctx, args, 'Replace color', (img) => replaceColor(img, from, to, args.region))
    }
  }),

  defineTool({
    name: 'clear_cel',
    group: 'drawing',
    description: 'Erase pixels (make them transparent) on a layer/frame: the whole cel, or only a region {x,y,w,h}.',
    input: obj({
      region: regionSchema.optional().describe('Limit to this rectangle. Default: the whole cel.'),
      ...targetShape
    }),
    handler: (args, ctx) => paintCel(ctx, args, 'Clear', (img) => clearRaster(img, args.region))
  }),

  defineTool({
    name: 'transform_cel',
    group: 'drawing',
    description:
      'Transform the pixels of a layer/frame (or a region): op "flip_horizontal", "flip_vertical", "rotate" (degrees 90|180|270 clockwise; non-square regions lose what no longer fits) or "shift" (move by dx,dy; wrap=true by default so pixels wrap around the edges). Example: {"op":"shift","dx":1,"dy":0} nudges the art one pixel right.',
    input: obj({
      op: z.enum(['flip_horizontal', 'flip_vertical', 'rotate', 'shift']),
      degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]).optional().describe('For rotate: clockwise degrees.'),
      dx: z.number().int().optional().describe('For shift: pixels to the right (negative = left).'),
      dy: z.number().int().optional().describe('For shift: pixels down (negative = up).'),
      wrap: z.boolean().optional().describe('For shift: wrap around the edges (default true) or drop pixels that leave.'),
      region: regionSchema.optional().describe('Limit to this rectangle. Default: the whole canvas.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      if (args.op === 'rotate' && args.degrees === undefined) throw new Error('op "rotate" needs `degrees` (90, 180 or 270).')
      if (args.op === 'shift' && args.dx === undefined && args.dy === undefined) throw new Error('op "shift" needs `dx` and/or `dy`.')
      return paintCel(ctx, args, `Transform (${args.op})`, (img) => {
        switch (args.op) {
          case 'flip_horizontal':
            return flipH(img, args.region)
          case 'flip_vertical':
            return flipV(img, args.region)
          case 'rotate':
            return rotate(img, args.degrees!, args.region)
          default:
            return shift(img, args.dx ?? 0, args.dy ?? 0, { wrap: args.wrap, region: args.region })
        }
      })
    }
  }),

  defineTool({
    name: 'outline',
    group: 'drawing',
    description:
      'Add a 1-pixel outline around the opaque pixels of a layer/frame. mode "outside" (default) paints the transparent pixels next to the art; "inside" recolors the art\'s edge pixels. diagonal=true also outlines diagonal neighbours (thicker, rounder corners). Typical: draw the sprite on its own layer, then outline it with a dark palette color. Example: {"color":0}.',
    input: obj({
      color: colorArg('Outline color.'),
      mode: z.enum(['outside', 'inside']).optional(),
      diagonal: z.boolean().optional().describe('8-connected (default false = 4-connected).'),
      region: regionSchema.optional().describe('Limit to this rectangle. Default: the whole canvas.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const c = parseColor(ctx.session.doc, args.color)
      return paintCel(ctx, args, 'Outline', (img) => outline(img, c, { mode: args.mode, diagonal: args.diagonal, region: args.region }))
    }
  })
]
