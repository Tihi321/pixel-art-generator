import { z } from 'zod'
import {
  GridError,
  MAX_DIMENSION,
  type Raster,
  applyGrid,
  base64ToBytes,
  clearRaster,
  decodePng,
  drawEllipse,
  drawGradient,
  drawLine,
  drawPolygon,
  drawRect,
  flipH,
  flipV,
  floodFill,
  hasPngSignature,
  outline,
  paletteToRgba,
  remapToPalette,
  replaceColor,
  rotate,
  setPixels,
  shift,
  stamp
} from '../../core'
import { defineTool } from '../registry'
import { MAX_GRID_SIDE, colorArg, colorToLegendHex, obj, paintCel, parseColor, rectShape, regionSchema, targetShape } from '../util'
import { decodeImageFile } from './studio'

/** Characters of the default palette legend: palette index i -> pool[i] (same as read_grid output). */
export const LEGEND_POOL = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

const thickness = z.number().int().min(1).max(32).optional().describe('Line thickness in pixels (default 1).')
const filled = z.boolean().optional().describe('Fill the shape (default false = outline only).')

const MAX_SET_PIXELS = 4096
const MAX_POLYGON_POINTS = 1024
const MAX_GRADIENT_STOPS = 16

const pointArg = z.union([z.tuple([z.number().int(), z.number().int()]), obj({ x: z.number().int(), y: z.number().int() })])

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
      `Limit: ${MAX_GRID_SIDE}x${MAX_GRID_SIDE} per call; for a full background use draw_gradient, draw_polygon and draw_image, or several grids with different x/y. Draws on the active layer/frame unless layer/frame are given. ` +
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
    name: 'draw_polygon',
    group: 'drawing',
    description:
      `Draw a polygon (or an open polyline with closed=false) through the given points, up to ${MAX_POLYGON_POINTS}. Use filled=true for hills, mountains, roofs and other closed shapes instead of draw_line + flood_fill (which leaks or leaves gaps). ` +
      'Points are pixel positions, each [x, y] or {x, y}; the outline is drawn through them (Bresenham, vertices included) and a filled polygon covers every pixel whose centre is inside, so two polygons that share an edge leave no gap. Self-crossing outlines follow the even-odd rule (the overlap stays empty). Points may lie outside the canvas; it is clipped. ' +
      'Example: {"points":[[0,60],[40,30],[90,55],[130,25],[160,60]],"color":"#3b5d38","filled":true}.',
    input: obj({
      points: z.array(pointArg).min(2).max(MAX_POLYGON_POINTS).describe('Vertices in order, each [x, y] or {x, y} (integers).'),
      color: colorArg(),
      filled,
      thickness,
      closed: z.boolean().optional().describe('Connect the last point to the first (default true). false with filled=false draws a polyline.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const c = parseColor(ctx.session.doc, args.color)
      const points = args.points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p))
      return paintCel(ctx, args, `Draw polygon (${points.length} points)`, (img) =>
        drawPolygon(img, points, c, { filled: args.filled, thickness: args.thickness, closed: args.closed })
      )
    }
  }),

  defineTool({
    name: 'draw_gradient',
    group: 'drawing',
    description:
      'Fill a rectangle (default: the whole canvas) with a gradient between 2-16 color stops, e.g. a sky. ' +
      '"stops" are {at: 0..1, color} (at is optional: stops are then spaced evenly). "direction": "vertical" (default, top to bottom), "horizontal", "diagonal", "radial" (centre outwards) or an angle in degrees (0 = left to right, 90 = top to bottom). ' +
      '"dither" controls the transition: "ordered" (default; 4x4 Bayer pattern between neighbouring stops, only stop colors are used), "ordered8" (finer 8x8 pattern), "checker" (hard bands with a one-pixel checkered border), "none" (hard bands), "smooth" (true color blend: NOT pixel art, adds many colors). ' +
      '"mask": "all" (default), "opaque" (only paint pixels that already have color: shade existing art) or "transparent" (only empty pixels: a sky behind drawn hills). ' +
      'Example: {"stops":[{"at":0,"color":"#29adff"},{"at":1,"color":"#ffccaa"}],"direction":"vertical","dither":"ordered"}.',
    input: obj({
      stops: z
        .array(obj({ at: z.number().min(0).max(1).optional().describe('Position along the gradient, 0 = start, 1 = end.'), color: colorArg() }))
        .min(2)
        .max(MAX_GRADIENT_STOPS)
        .describe('Color stops; sorted by "at".'),
      x: z.number().int().optional().describe('Left edge of the area (default 0).'),
      y: z.number().int().optional().describe('Top edge of the area (default 0).'),
      w: z.number().int().min(1).optional().describe('Width of the area (default: to the right edge).'),
      h: z.number().int().min(1).optional().describe('Height of the area (default: to the bottom edge).'),
      direction: z.union([z.enum(['vertical', 'horizontal', 'diagonal', 'radial']), z.number()]).optional().describe('Default "vertical". A number is an angle in degrees (0 = left to right, 90 = top to bottom).'),
      dither: z.enum(['none', 'ordered', 'ordered8', 'checker', 'smooth']).optional(),
      mask: z.enum(['all', 'opaque', 'transparent']).optional(),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const doc = ctx.session.doc
      const stops = args.stops.map((s) => ({ at: s.at, color: parseColor(doc, s.color) }))
      const x = args.x ?? 0
      const y = args.y ?? 0
      const region = { x, y, w: args.w ?? doc.width - x, h: args.h ?? doc.height - y }
      if (region.w < 1 || region.h < 1) throw new Error(`The gradient area is empty: x=${x}, y=${y} leave no room on a ${doc.width}x${doc.height} canvas.`)
      return paintCel(ctx, args, 'Draw gradient', (img) => drawGradient(img, stops, { region, direction: args.direction, dither: args.dither, mask: args.mask }))
    }
  }),

  defineTool({
    name: 'draw_image',
    group: 'drawing',
    description:
      `Paint a whole bitmap onto a layer in one call: a precomposed background or foreground, made in code, as a base64 PNG ("png") or an image file ("path": PNG, and JPEG/WebP where the host can decode them). Give exactly one of them. ` +
      `The image's top-left lands at (x, y) (default 0,0), clipped to the canvas; up to ${MAX_DIMENSION}x${MAX_DIMENSION}. ` +
      'Pixel art has binary alpha: pixels with alpha >= 128 become opaque, the rest transparent (alpha="keep" keeps partial alpha and blends). ' +
      'Transparent pixels leave existing pixels alone unless transparent="clear" (the image rectangle then replaces the cel). ' +
      'snap="palette" remaps the colors to the document palette (dither "none", "ordered" or "floyd"); with the default snap="none" the result says how many colors are outside the palette (remap_to_palette fixes that). ' +
      'This is not a downscaler: use import_image to convert a photo into pixel art. Example: {"path":"C:/art/foreground.png","x":0,"y":120,"snap":"palette"}.',
    input: obj({
      png: z.string().min(1).optional().describe('Base64-encoded PNG (a data:image/png;base64, prefix is fine).'),
      path: z.string().min(1).optional().describe('Image file to draw.'),
      x: z.number().int().optional().describe('Canvas x of the image\'s left edge (default 0).'),
      y: z.number().int().optional().describe('Canvas y of the image\'s top edge (default 0).'),
      transparent: z.enum(['skip', 'clear']).optional().describe('"skip" (default): transparent pixels keep existing pixels. "clear": they erase.'),
      alpha: z.enum(['binary', 'keep']).optional().describe('"binary" (default): alpha >= 128 is opaque, otherwise transparent. "keep": partial alpha is kept and blended.'),
      snap: z.enum(['none', 'palette']).optional().describe('"palette": remap the colors to the document palette.'),
      dither: z.enum(['none', 'ordered', 'floyd']).optional().describe('Dithering for snap="palette" (default none).'),
      ...targetShape
    }),
    handler: async (args, ctx) => {
      const doc = ctx.session.doc
      if ((args.png === undefined) === (args.path === undefined)) throw new Error('Give exactly one of "png" (base64 PNG) or "path" (an image file).')
      let src: Raster
      if (args.png !== undefined) {
        try {
          const bytes = base64ToBytes(args.png.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''))
          if (!hasPngSignature(bytes)) throw new Error('the data is not a PNG')
          src = decodePng(bytes)
        } catch (e) {
          throw new Error(`"png" is not a valid base64-encoded PNG: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
        }
      } else src = await decodeImageFile(ctx, args.path!)
      if (src.width > MAX_DIMENSION || src.height > MAX_DIMENSION) {
        throw new Error(`The image is ${src.width}x${src.height}; the limit is ${MAX_DIMENSION}x${MAX_DIMENSION}.`)
      }
      const img: Raster = { width: src.width, height: src.height, data: src.data.slice() }
      if (args.alpha !== 'keep') {
        for (let i = 0; i < img.data.length; i++) {
          const c = img.data[i]!
          img.data[i] = c >>> 24 >= 128 ? (c | 0xff000000) >>> 0 : 0
        }
      }
      const paletteColors = paletteToRgba(doc.palette).map((c) => (c | 0xff000000) >>> 0)
      let note: string | undefined
      if (args.snap === 'palette') {
        if (paletteColors.length === 0) throw new Error('The document palette is empty, so there is nothing to snap to.')
        remapToPalette(img, paletteColors, args.dither ?? 'none')
      } else {
        const known = new Set(paletteColors)
        const unknown = new Set<number>()
        for (const c of img.data) if (c >>> 24 !== 0 && !known.has((c | 0xff000000) >>> 0)) unknown.add((c | 0xff000000) >>> 0)
        if (unknown.size > 0) note = `${unknown.size} color(s) are not in the document palette; call remap_to_palette to snap them.`
      }
      const x = args.x ?? 0
      const y = args.y ?? 0
      return paintCel(ctx, args, `Draw image ${img.width}x${img.height} at (${x},${y})`, (cel) => ({
        dirty: stamp(cel, img, x, y, { replace: args.transparent === 'clear' }),
        note
      }))
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
