import { z } from 'zod'
import { type FontName, drawText, getFont, layoutText } from '../../core'
import { defineTool, jsonResult } from '../registry'
import { colorArg, obj, paintCel, parseColor, plural, targetShape } from '../util'

const MAX_TEXT_CHARS = 2000

const layoutShape = {
  text: z.string().min(1).max(MAX_TEXT_CHARS).describe(`The text (max ${MAX_TEXT_CHARS} characters); "\\n" starts a new line.`),
  font: z.enum(['tiny', 'small']).optional().describe('"small" (default, 5x7 letters with lowercase and descenders, line height 10) or "tiny" (3x5 capitals only: lowercase draws as small caps, line height 6).'),
  maxWidth: z.number().int().min(1).optional().describe('Wrap lines wider than this many canvas pixels at spaces (very long words are broken). Default: no wrapping.'),
  letterSpacing: z.number().int().min(0).max(4).optional().describe('Extra pixels between letters (default 1).'),
  lineSpacing: z.number().int().min(0).max(16).optional().describe('Extra pixels between lines (default 0).'),
  scale: z.number().int().min(1).max(8).optional().describe('Integer size factor: every font pixel becomes scale x scale pixels (default 1). Spacing scales too.')
}

const FONT_NOTE =
  'Fonts cover printable ASCII; accented Latin letters draw as their base letter (e -> e), anything else as a hollow box (counted in the result).'

export const textTools = [
  defineTool({
    name: 'draw_text',
    group: 'drawing',
    description:
      'Draw text with a built-in pixel font, crisp and palette-exact: titles, signs, UI labels, a name box. (x, y) is the top-left of the text box. ' +
      `${FONT_NOTE} ` +
      '"align" (left, center, right) positions lines inside maxWidth (or the widest line); use measure_text to center a title on the canvas. ' +
      '"outline" is a color for a one-font-pixel outline (so it reads on busy backgrounds); "shadow" is {color, dx, dy} (default one font pixel right and down). Parts outside the canvas are clipped. ' +
      'Example: {"text":"Hello, world!","x":2,"y":2,"color":"#fff1e8","font":"small","outline":"#1a1c2c"}.',
    input: obj({
      ...layoutShape,
      x: z.number().int().describe('Left edge of the text box.'),
      y: z.number().int().describe('Top edge of the text box.'),
      color: colorArg(),
      align: z.enum(['left', 'center', 'right']).optional().describe('Line alignment inside the box (default left).'),
      outline: colorArg('Outline color (default: no outline).').optional(),
      shadow: obj({
        color: colorArg(),
        dx: z.number().int().min(-16).max(16).optional().describe('Pixels to the right (default: one font pixel = scale).'),
        dy: z.number().int().min(-16).max(16).optional().describe('Pixels down (default: one font pixel = scale).')
      })
        .optional()
        .describe('Drop shadow.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const doc = ctx.session.doc
      const color = parseColor(doc, args.color)
      const outline = args.outline === undefined ? undefined : parseColor(doc, args.outline)
      const shadow = args.shadow ? { color: parseColor(doc, args.shadow.color), dx: args.shadow.dx, dy: args.shadow.dy } : undefined
      const font = getFont((args.font ?? 'small') as FontName)
      const preview = args.text.length > 24 ? `${args.text.slice(0, 24)}...` : args.text
      return paintCel(ctx, args, `Draw text "${preview.replace(/\s+/g, ' ')}"`, (img) => {
        const r = drawText(img, args.text, args.x, args.y, color, font, {
          maxWidth: args.maxWidth,
          align: args.align,
          letterSpacing: args.letterSpacing,
          lineSpacing: args.lineSpacing,
          scale: args.scale,
          outline,
          shadow
        })
        const l = r.layout
        const notes = [`Text box ${l.width}x${l.height} at (${args.x},${args.y}), ${plural(l.lines.length, 'line')}.`]
        if (l.unknownChars > 0) notes.push(`${plural(l.unknownChars, 'character')} not in the font drew as a hollow box.`)
        return { dirty: r.dirty, note: notes.join(' ') }
      })
    }
  }),

  defineTool({
    name: 'measure_text',
    group: 'drawing',
    readOnly: true,
    description:
      'Measure text without drawing it: returns {width, height, lines:[{text,width}], unknownChars} for the text box draw_text would produce with the same text, font, maxWidth, letterSpacing, lineSpacing and scale (align is not needed: the box is the widest line). ' +
      'Use it to center text: x = (canvas width - width) / 2, or to size a panel or name box around a label and to see how wrapping breaks lines. ' +
      `${FONT_NOTE} Example: {"text":"Chapter 1","font":"small","scale":2}.`,
    input: obj({ ...layoutShape }),
    handler: (args) => {
      const l = layoutText(args.text, getFont((args.font ?? 'small') as FontName), {
        maxWidth: args.maxWidth,
        letterSpacing: args.letterSpacing,
        lineSpacing: args.lineSpacing,
        scale: args.scale
      })
      return jsonResult(
        { width: l.width, height: l.height, lines: l.lines, unknownChars: l.unknownChars },
        `Text box ${l.width}x${l.height}, ${plural(l.lines.length, 'line')}.`
      )
    }
  })
]
