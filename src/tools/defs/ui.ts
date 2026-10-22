import { z } from 'zod'
import { type FontName, type Insets, type UiAlign, type UiCorner, type UiKind, type UiPattern, type UiState, type UiStyle, UI_KINDS, celToRaster, copyRegion, drawUiElement, getCel, hexToRgba, nineSlice, normalizeInsets } from '../../core'
import { resolveDocument } from '../documents'
import { defineTool } from '../registry'
import { colorArg, frameRef, layerRef, obj, paintCel, parseColor, resolveFrame, resolveLayer, safeFileName, targetShape } from '../util'
import { withJson } from './studio'

const styleShape = obj({
  fill: colorArg('Middle color. Default: a neutral mid color of the palette ("transparent" leaves the middle untouched).').optional(),
  border: colorArg("Outline color. Default: the palette's darkest color.").optional(),
  light: colorArg('Bevel on the top/left inner edge, and the inner line of a textbox. Default: the next lighter palette color than the fill.').optional(),
  dark: colorArg('Bevel on the bottom/right inner edge and the second color of a pattern. Default: the next darker palette color than the fill.').optional(),
  shadow: colorArg('1 px drop shadow below and right of the element (outside the rectangle). Default: none.').optional(),
  hoverFill: colorArg('Fill of the hover state. Default: the next lighter palette color.').optional(),
  corner: z.enum(['square', 'round', 'cut']).optional().describe('"round" (default; pixel-art corners, not antialiased), "cut" (45-degree chamfer) or "square".'),
  borderWidth: z.number().int().min(1).max(4).optional().describe('Outline thickness (default 1, or 2 for elements 40 px or more on the short side).'),
  inset: z.number().int().min(0).max(4).optional().describe('Pixels between the border and a 1 px inner line (0 = no line). Default 1 for a textbox, else 0.'),
  pattern: z.enum(['none', 'dither', 'stripes']).optional().describe('Fill the middle with a checkerboard or horizontal stripes of fill and dark (default none).')
})

const insetsShape = z.union([
  z.number().int().min(0),
  obj({ left: z.number().int().min(0), top: z.number().int().min(0), right: z.number().int().min(0), bottom: z.number().int().min(0) })
])

interface DrawInfo {
  nine: Insets
  state: UiState
  labelFits: boolean
  hasLabel: boolean
}

export const uiTools = [
  defineTool({
    name: 'draw_ui_element',
    group: 'drawing',
    description:
      'Draw a pixel-art UI element for a visual novel: kind "textbox" (dark, inner line), "namebox" (tab, top corners only), "button", "choice" (a wide button), "panel" or "frame" (border only, the middle stays untouched). ' +
      'With only kind and a rectangle it already looks right in the document palette (darkest color = border, neutral mid color = fill, neighbouring colors = bevel). ' +
      'Buttons and choices take a state: "idle", "hover" (lighter fill), "pressed" (darker fill, bevel inverted, label 1 px down) or "disabled" (grey fill, no bevel); draw one per state, same size. ' +
      'A label is drawn with the built-in pixel fonts (centered on buttons, choices and name boxes; top-left and wrapped on a textbox, panel or frame unless align is given). ' +
      "The result reports the element's 9-slice borders {left, top, right, bottom} (the part that must not stretch) with a Ren'Py Frame(\"name.png\", left, top, right, bottom) line, and also returns JSON {rect, nineSlice, kind, state, renpy, labelFits}. " +
      'Drawn at (x, y) with size w x h; a shadow adds 1 px right and below. A size too small for the style is an error that says the minimum. ' +
      'Example: {"kind":"button","x":0,"y":0,"w":96,"h":24,"label":"Start","state":"hover","style":{"corner":"cut"}}.',
    input: obj({
      kind: z.enum(UI_KINDS as unknown as [UiKind, ...UiKind[]]).describe('panel, textbox, namebox, button, choice or frame.'),
      x: z.number().int().describe('Left edge.'),
      y: z.number().int().describe('Top edge.'),
      w: z.number().int().min(3).describe('Width in pixels.'),
      h: z.number().int().min(3).describe('Height in pixels.'),
      style: styleShape.optional().describe('Colors and look; every field is optional and defaults from the palette.'),
      state: z.enum(['idle', 'hover', 'pressed', 'disabled']).optional().describe('Buttons and choices only (default idle).'),
      label: z.string().max(400).optional().describe('Text to draw inside the element ("\\n" starts a new line).'),
      font: z.enum(['tiny', 'small']).optional().describe('"small" (default, 5x7) or "tiny" (3x5 capitals).'),
      labelColor: colorArg('Label color. Default: the lightest or darkest palette color, whichever contrasts more with the fill.').optional(),
      align: z.enum(['left', 'center', 'right']).optional().describe('Label alignment (default: center for buttons, choices and name boxes, else left).'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const doc = ctx.session.doc
      const palette = doc.palette.colors.map((c) => hexToRgba(c.hex))
      const style: Partial<UiStyle> = {}
      const s = args.style
      if (s) {
        if (s.fill !== undefined) style.fill = parseColor(doc, s.fill)
        if (s.border !== undefined) style.border = parseColor(doc, s.border)
        if (s.light !== undefined) style.light = parseColor(doc, s.light)
        if (s.dark !== undefined) style.dark = parseColor(doc, s.dark)
        if (s.shadow !== undefined) style.shadow = parseColor(doc, s.shadow)
        if (s.hoverFill !== undefined) style.hoverFill = parseColor(doc, s.hoverFill)
        if (s.corner !== undefined) style.corner = s.corner as UiCorner
        if (s.borderWidth !== undefined) style.borderWidth = s.borderWidth
        if (s.inset !== undefined) style.inset = s.inset
        if (s.pattern !== undefined) style.pattern = s.pattern as UiPattern
      }
      const labelColor = args.labelColor === undefined ? undefined : parseColor(doc, args.labelColor)
      const box: { info: DrawInfo | null } = { info: null }
      const r = paintCel(ctx, args, `Draw ${args.kind}`, (img) => {
        const res = drawUiElement(
          img,
          {
            kind: args.kind,
            x: args.x,
            y: args.y,
            w: args.w,
            h: args.h,
            style,
            state: args.state as UiState | undefined,
            label: args.label,
            font: args.font as FontName | undefined,
            labelColor,
            align: args.align as UiAlign | undefined
          },
          palette
        )
        box.info = { nine: res.nineSlice, state: res.state, labelFits: res.labelFits, hasLabel: !!args.label }
        return res.dirty
      })
      const info = box.info
      const first = r.content[0]
      if (!info || !first || first.type !== 'text') return r
      const n = info.nine
      const name = safeFileName(info.state === 'idle' ? args.kind : `${args.kind}_${info.state}`)
      const renpy = `Frame("${name}.png", ${n.left}, ${n.top}, ${n.right}, ${n.bottom})`
      const notes = [`9-slice borders: left ${n.left}, top ${n.top}, right ${n.right}, bottom ${n.bottom}. Ren'Py: ${renpy}`]
      if (args.state && args.kind !== 'button' && args.kind !== 'choice') notes.push(`Note: state only applies to buttons and choices; this ${args.kind} was drawn idle.`)
      if (info.hasLabel && !info.labelFits) notes.push('Note: the label is larger than the inside of the element; make it bigger, use font "tiny" or shorten the label.')
      const json = { rect: { x: args.x, y: args.y, w: args.w, h: args.h }, nineSlice: n, kind: args.kind, state: info.state, renpy, labelFits: info.labelFits }
      return withJson(`${first.text} ${notes.join(' ')}`, json)
    }
  }),

  defineTool({
    name: 'draw_nine_slice',
    group: 'drawing',
    description:
      'Resize a hand-drawn frame, button or panel to any size with the 9-slice technique: copies the source rectangle onto the target rectangle so the four corners stay pixel-identical (never scaled), the four edges repeat or stretch between them and the middle fills the rest. ' +
      '"insets" is the border thickness that must not stretch: one number or {left, top, right, bottom}; it must leave at least 1 px of middle in the source and fit inside the target. ' +
      '"tile" (default) repeats the source pattern, the crisp pixel-art choice; "stretch" scales by nearest neighbour. Transparent source pixels keep what is under the target ("skip", default) or erase it ("clear"). ' +
      "The source can be on another layer, frame or document (it is copied before drawing, so source and target may overlap). For kits made with draw_ui_element use its reported 9-slice borders as insets. " +
      'Example: {"source":{"x":0,"y":0,"w":16,"h":16},"insets":4,"x":20,"y":0,"w":200,"h":48,"center":"tile","edges":"tile"}.',
    input: obj({
      source: obj({
        x: z.number().int().describe('Left edge of the source rectangle.'),
        y: z.number().int().describe('Top edge of the source rectangle.'),
        w: z.number().int().min(1).describe('Width of the source rectangle.'),
        h: z.number().int().min(1).describe('Height of the source rectangle.'),
        layer: layerRef('Source layer. Default: the target layer.').optional(),
        frame: frameRef('Source frame. Default: the target frame.').optional(),
        document: z.string().optional().describe('Source documentId (see list_documents). Default: the target document.')
      }),
      insets: insetsShape.describe('Border thickness in source pixels: one number or {left, top, right, bottom}.'),
      x: z.number().int().describe('Left edge of the target rectangle.'),
      y: z.number().int().describe('Top edge of the target rectangle.'),
      w: z.number().int().min(1).describe('Target width.'),
      h: z.number().int().min(1).describe('Target height.'),
      center: z.enum(['tile', 'stretch']).optional().describe('How the middle is filled (default tile).'),
      edges: z.enum(['tile', 'stretch']).optional().describe('How the four edges are filled (default tile).'),
      transparent: z.enum(['skip', 'clear']).optional().describe('Transparent source pixels: "skip" keeps the target pixel (default), "clear" erases it.'),
      ...targetShape
    }),
    handler: (args, ctx) => {
      const src = args.source
      const srcSession = src.document === undefined ? ctx.session : resolveDocument(ctx, src.document).session
      const srcDoc = srcSession.doc
      const srcLayer = resolveLayer(srcSession, src.layer ?? (src.document === undefined ? args.layer : undefined))
      const srcFrame = resolveFrame(srcSession, src.frame ?? (src.document === undefined ? args.frame : undefined))
      if (src.x < 0 || src.y < 0 || src.x + src.w > srcDoc.width || src.y + src.h > srcDoc.height) {
        throw new Error(`The source rectangle x=${src.x}, y=${src.y}, ${src.w}x${src.h} is not inside the ${srcDoc.width}x${srcDoc.height} source canvas.`)
      }
      const ins = normalizeInsets(args.insets)
      // a snapshot, so a source that overlaps the target is read before anything is drawn
      const snapshot = copyRegion(celToRaster(getCel(srcDoc, srcLayer.id, srcFrame.id), srcDoc.width, srcDoc.height), src)
      return paintCel(ctx, args, 'Draw nine-slice', (img) => {
        const dirty = nineSlice(img, snapshot, { x: args.x, y: args.y, w: args.w, h: args.h }, ins, { center: args.center, edges: args.edges, transparent: args.transparent })
        return {
          dirty,
          note: `Copied the ${src.w}x${src.h} source (insets ${ins.left}/${ins.top}/${ins.right}/${ins.bottom}) to ${args.w}x${args.h} at (${args.x},${args.y}): corners 1:1, edges ${args.edges ?? 'tile'}, middle ${args.center ?? 'tile'}.`
        }
      })
    }
  })
]
