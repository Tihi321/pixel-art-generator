// Pixel-art UI elements (panel, textbox, name box, buttons, frame) and 9-slice copying. Pure TypeScript on
// Rasters, same conventions as raster.ts: mutate in place, return the bounding Rect of the written pixels
// (clipped) or null. Elements are built from three masks (outer shape, inner shape = outer eroded by the
// border width, and the rings of the inner shape) so every corner style, bevel and inset line follows
// the same outline, and the reported 9-slice borders are measured from a rendered element, not guessed.

import { createPaletteMatcher, toOklab } from './color'
import { type FontName, drawText, getFont, layoutText } from './font'
import { type Rect, TRANSPARENT } from './model'
import { type Raster, DirtyRect, createRaster } from './raster'

export type UiKind = 'panel' | 'textbox' | 'namebox' | 'button' | 'choice' | 'frame'
export const UI_KINDS: readonly UiKind[] = ['panel', 'textbox', 'namebox', 'button', 'choice', 'frame']
export type UiState = 'idle' | 'hover' | 'pressed' | 'disabled'
export const UI_STATES: readonly UiState[] = ['idle', 'hover', 'pressed', 'disabled']
export type UiCorner = 'square' | 'round' | 'cut'
export type UiPattern = 'none' | 'dither' | 'stripes'
export type UiAlign = 'left' | 'center' | 'right'

/** Resolved style: packed RGBA colors, a transparent `fill` leaves the middle untouched. */
export interface UiStyle {
  fill: number
  border: number
  /** Bevel on the top and left inner edge (and the inset line of a textbox). */
  light: number
  /** Bevel on the bottom and right inner edge, and the second color of a pattern. */
  dark: number
  /** 1 px drop shadow below and right of the element. */
  shadow?: number
  corner: UiCorner
  borderWidth: number
  /** Pixels of plain fill between the border and a 1 px inner line (0 = no line). */
  inset: number
  pattern: UiPattern
  /** Fill of a hovered button (default: the next lighter palette color). */
  hoverFill?: number
}

export interface UiSpec {
  kind: UiKind
  x: number
  y: number
  w: number
  h: number
  style?: Partial<UiStyle>
  state?: UiState
  label?: string
  font?: FontName
  labelColor?: number
  align?: UiAlign
}

export interface NineSliceBorders {
  left: number
  top: number
  right: number
  bottom: number
}

export interface UiResult {
  dirty: Rect | null
  nineSlice: NineSliceBorders
  style: UiStyle
  state: UiState
  /** The label's text box (canvas pixels) when a label was drawn. */
  labelBox?: Rect
  /** False when the label is wider or taller than the element's inside. */
  labelFits: boolean
}

// ---------------------------------------------------------------- palette-derived defaults

interface Entry {
  c: number
  lab: [number, number, number]
  chroma: number
}

function entriesOf(palette: number[]): Entry[] {
  const seen = new Set<number>()
  const out: Entry[] = []
  for (const raw of palette) {
    const c = (raw | 0) >>> 0
    if (c >>> 24 === 0) continue
    const key = c & 0xffffff
    if (seen.has(key)) continue
    seen.add(key)
    const lab = toOklab(c)
    out.push({ c: (c | 0xff000000) >>> 0, lab, chroma: Math.hypot(lab[1], lab[2]) })
  }
  if (out.length === 0) {
    for (const c of [0xff000000, 0xffffffff]) out.push({ c, lab: toOklab(c), chroma: 0 })
  }
  return out
}

function darkestOf(es: Entry[]): number {
  return es.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a)).c
}
function lightestOf(es: Entry[]): number {
  return es.reduce((a, b) => (b.lab[0] > a.lab[0] ? b : a)).c
}

/** The palette color near lightness `t` (0 = darkest, 1 = lightest), preferring neutral colors; never `not`. */
function pickByLightness(es: Entry[], t: number, not: number[], chromaWeight = 1.5): number {
  const lo = Math.min(...es.map((e) => e.lab[0]))
  const hi = Math.max(...es.map((e) => e.lab[0]))
  const target = lo + t * (hi - lo)
  let best: Entry | null = null
  let bestScore = Infinity
  for (const e of es) {
    if (not.includes(e.c)) continue
    const score = Math.abs(e.lab[0] - target) + chromaWeight * e.chroma
    if (score < bestScore) {
      bestScore = score
      best = e
    }
  }
  return (best ?? es[0]!).c
}

/** The closest palette color (in OKLab) that is clearly lighter (dir 1) or darker (dir -1) than `c`, or null. */
function stepFrom(es: Entry[], c: number, dir: 1 | -1): number | null {
  const lab = toOklab(c)
  let best: number | null = null
  let bestD = Infinity
  for (const e of es) {
    if ((e.lab[0] - lab[0]) * dir < 0.03) continue
    const d = (e.lab[0] - lab[0]) ** 2 + 4 * ((e.lab[1] - lab[1]) ** 2 + (e.lab[2] - lab[2]) ** 2) + 40 * Math.max(0, e.chroma - Math.hypot(lab[1], lab[2])) ** 2 // hue changes and gaining color count more than lightness steps
    if (d < bestD) {
      bestD = d
      best = e.c
    }
  }
  return best
}

/** The lightest or the darkest palette color, whichever contrasts more with `bg`. */
function contrastColor(es: Entry[], bg: number): number {
  const L = toOklab(bg)[0]
  const lightest = lightestOf(es)
  const darkest = darkestOf(es)
  return Math.abs(toOklab(lightest)[0] - L) >= Math.abs(toOklab(darkest)[0] - L) ? lightest : darkest
}

const BEVEL_KINDS: readonly UiKind[] = ['panel', 'namebox', 'button', 'choice', 'frame']

/** Style defaults for a kind, derived from the palette: darkest = border, a neutral mid color = fill, lighter/darker neighbors = bevel. */
export function defaultUiStyle(kind: UiKind, palette: number[], w: number, h: number): UiStyle {
  const es = entriesOf(palette)
  const border = darkestOf(es)
  const t = kind === 'textbox' ? 0.18 : kind === 'namebox' ? 0.32 : kind === 'panel' ? 0.4 : 0.45
  const fill = pickByLightness(es, t, [border])
  let light = stepFrom(es, fill, 1) ?? lightestOf(es)
  if (kind === 'textbox') light = pickByLightness(es, 0.55, [border, fill])
  const dark = stepFrom(es, fill, -1) ?? border
  const small = Math.min(w, h) < 14
  return {
    fill: kind === 'frame' ? TRANSPARENT : fill,
    border,
    light,
    dark,
    corner: 'round',
    borderWidth: Math.min(w, h) >= 40 ? 2 : 1,
    inset: kind === 'textbox' && !small ? 1 : 0,
    pattern: 'none'
  }
}

// ---------------------------------------------------------------- shapes

/** Size of the corner treatment in pixels: round removes a circle's outside, cut a 45-degree chamfer. */
function cornerSize(corner: UiCorner, w: number, h: number): number {
  if (corner === 'square') return 0
  const m = Math.min(w, h)
  if (corner === 'round') return m < 14 ? 2 : m < 40 ? 3 : 5
  return m < 14 ? 2 : m < 40 ? 3 : 4
}

/** True when the pixel `i` columns and `j` rows from a corner is cut away. */
function cornerCuts(corner: UiCorner, size: number, i: number, j: number): boolean {
  if (size <= 0 || i >= size || j >= size) return false
  if (corner === 'cut') return i + j < size
  const a = size - i - 0.5
  const b = size - j - 0.5
  return a * a + b * b > size * size
}

/** Mask of a w x h rounded/cut rectangle; `bottomCorners` false keeps the bottom corners square (a tab). */
function shapeMask(w: number, h: number, corner: UiCorner, size: number, bottomCorners: boolean): Uint8Array {
  const m = new Uint8Array(Math.max(0, w) * Math.max(0, h))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const top = y < h / 2
      const cut = (top || bottomCorners) && cornerCuts(corner, size, Math.min(x, w - 1 - x), top ? y : h - 1 - y)
      m[y * w + x] = cut ? 0 : 1
    }
  }
  return m
}

/** 1 for pixels in the mask that touch (8-connected) a pixel outside it, 2 for the next ring in, and so on. */
function ringIndex(mask: Uint8Array, w: number, h: number, maxRing: number): Uint8Array {
  const dist = new Uint8Array(mask.length)
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1 && dist[y * w + x] === 0
  for (let ring = 1; ring <= maxRing; ring++) {
    const found: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (mask[i] !== 1 || dist[i] !== 0) continue
        let edge = false
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!inside(x + dx, y + dy)) edge = true
        if (edge) found.push(i)
      }
    }
    for (const i of found) dist[i] = ring
  }
  return dist
}

// ---------------------------------------------------------------- element

interface Prepared {
  style: UiStyle
  /** Pixels of the element as color per cell (0 = untouched); `w` x `h` of the element. */
  pixels: Uint32Array
  shadowPixels: Uint32Array
  shadowW: number
  shadowH: number
}

function hasBevel(kind: UiKind): boolean {
  return BEVEL_KINDS.includes(kind)
}

function resolveStyle(spec: UiSpec, palette: number[]): { style: UiStyle; state: UiState; pressed: boolean } {
  const kind = spec.kind
  const base = defaultUiStyle(kind, palette, spec.w, spec.h)
  const given = spec.style ?? {}
  const style: UiStyle = { ...base }
  for (const [k, v] of Object.entries(given)) if (v !== undefined) (style as unknown as Record<string, unknown>)[k] = v
  style.borderWidth = Math.max(1, Math.min(4, Math.round(style.borderWidth)))
  style.inset = Math.max(0, Math.min(4, Math.round(style.inset)))
  const stateful = kind === 'button' || kind === 'choice'
  const state: UiState = stateful ? (spec.state ?? 'idle') : 'idle'
  const es = entriesOf(palette)
  if (state === 'hover') {
    const before = style.fill
    const hovered = style.hoverFill ?? stepFrom(es, before, 1)
    if (hovered !== null && hovered !== undefined) {
      style.fill = hovered
      if (given.light === undefined) style.light = stepFrom(es, hovered, 1) ?? hovered
      if (given.dark === undefined) style.dark = before
    }
  } else if (state === 'pressed') {
    const darker = stepFrom(es, style.fill, -1)
    if (darker !== null && darker !== style.border) style.fill = darker
    ;[style.light, style.dark] = [style.dark, style.light]
  } else if (state === 'disabled') {
    const [r, g, b] = [style.fill & 255, (style.fill >>> 8) & 255, (style.fill >>> 16) & 255]
    const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    const matched = createPaletteMatcher(es.map((e) => e.c))(((255 << 24) | (grey << 16) | (grey << 8) | grey) >>> 0)
    const c = es[matched]!.c
    if (c !== style.border) style.fill = c
    style.light = style.fill
    style.dark = style.fill
  }
  return { style, state, pressed: state === 'pressed' }
}

function prepare(spec: UiSpec, style: UiStyle, cornerPx = cornerSize(style.corner, spec.w, spec.h)): Prepared {
  const { w, h, kind } = spec
  const size = cornerPx
  const bottomCorners = kind !== 'namebox'
  const bw = style.borderWidth
  const outer = shapeMask(w, h, style.corner, size, bottomCorners)
  const iw = w - 2 * bw
  const ih = h - 2 * bw
  const innerSize = style.corner === 'square' ? 0 : Math.max(0, size - bw)
  const innerLocal = iw > 0 && ih > 0 ? shapeMask(iw, ih, style.corner, innerSize, bottomCorners) : new Uint8Array(0)
  const inner = new Uint8Array(w * h)
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) inner[(y + bw) * w + x + bw] = innerLocal[y * iw + x]!
  const at = (m: Uint8Array, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1

  const px = new Uint32Array(w * h)
  const fillOn = style.fill >>> 24 !== 0
  for (let i = 0; i < px.length; i++) {
    if (outer[i] === 1 && inner[i] === 0) px[i] = style.border
    else if (inner[i] === 1 && fillOn) {
      const x = i % w
      const y = (i / w) | 0
      const alt = style.pattern === 'dither' ? (x + y) & 1 : style.pattern === 'stripes' ? y & 1 : 0
      px[i] = alt === 1 ? style.dark : style.fill
    }
  }
  if (hasBevel(kind)) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!at(inner, x, y)) continue
        const tl = !at(inner, x, y - 1) || !at(inner, x - 1, y)
        const br = !at(inner, x, y + 1) || !at(inner, x + 1, y)
        if (tl !== br) px[y * w + x] = tl ? style.light : style.dark
      }
    }
  }
  if (style.inset > 0) {
    const ring = ringIndex(inner, w, h, style.inset + 1)
    for (let i = 0; i < px.length; i++) if (ring[i] === style.inset + 1) px[i] = style.light
  }
  // drop shadow: the outline shifted one pixel right and down, outside the element only
  const sw = w + 1
  const sh = h + 1
  const shadow = new Uint32Array(sw * sh)
  if (style.shadow !== undefined && style.shadow >>> 24 !== 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (outer[y * w + x] !== 1) continue
        const sx = x + 1
        const sy = y + 1
        if (sx < w && sy < h && outer[sy * w + sx] === 1) continue
        shadow[sy * sw + sx] = style.shadow
      }
    }
  }
  return { style, pixels: px, shadowPixels: shadow, shadowW: sw, shadowH: sh }
}

const sliceCache = new Map<string, NineSliceBorders>()

/**
 * The 9-slice borders of an element style: how many pixels on each side keep their size when it is resized.
 * Measured on a rendered 64x64 element with the corner size of a w x h one: the last column/row (from each side) that differs from the stretchable middle.
 */
export function uiNineSlice(kind: UiKind, style: UiStyle, w: number, h: number): NineSliceBorders {
  const cornerPx = cornerSize(style.corner, w, h)
  const key = `${kind}|${style.corner}|${cornerPx}|${style.borderWidth}|${style.inset}|${hasBevel(kind) ? 1 : 0}|${style.fill >>> 24 === 0 ? 0 : 1}`
  const hit = sliceCache.get(key)
  if (hit) return { ...hit }
  const S = 64
  // distinct colors so that every layer of the element is told apart
  const probe: UiStyle = { ...style, fill: style.fill >>> 24 === 0 ? TRANSPARENT : 0xff202020, border: 0xff0000ff, light: 0xff00ff00, dark: 0xffff0000, shadow: undefined, pattern: 'none' }
  const p = prepare({ kind, x: 0, y: 0, w: S, h: S }, probe, cornerPx).pixels
  const get = (x: number, y: number): number => p[y * S + x]!
  const mid = S >> 1
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < mid; x++) if (get(x, y) !== get(mid, y)) left = Math.max(left, x + 1)
    for (let x = S - 1; x >= mid; x--) if (get(x, y) !== get(mid, y)) right = Math.max(right, S - x)
  }
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < mid; y++) if (get(x, y) !== get(x, mid)) top = Math.max(top, y + 1)
    for (let y = S - 1; y >= mid; y--) if (get(x, y) !== get(x, mid)) bottom = Math.max(bottom, S - y)
  }
  const out = { left, top, right, bottom }
  sliceCache.set(key, out)
  return { ...out }
}

/**
 * Draw a UI element with its top-left at (x, y). The label (if any) is centered (buttons, choices, name
 * boxes) or placed top-left with padding and wrapped (textbox, panel, frame) unless `align` says otherwise;
 * a pressed button's label moves one pixel down. Throws an LLM-readable Error when the element is too small.
 */
export function drawUiElement(img: Raster, spec: UiSpec, palette: number[]): UiResult {
  const { w, h, kind } = spec
  const { style, state, pressed } = resolveStyle(spec, palette)
  const nine = uiNineSlice(kind, style, w, h)
  if (nine.left + nine.right >= w || nine.top + nine.bottom >= h) {
    throw new Error(
      `A ${kind} with this style needs at least ${nine.left + nine.right + 1}x${nine.top + nine.bottom + 1} pixels (its borders take ${nine.left}+${nine.right} columns and ${nine.top}+${nine.bottom} rows); got ${w}x${h}. Make it bigger or use a thinner borderWidth, corner "square" or inset 0.`
    )
  }
  const prep = prepare(spec, style)
  const dirty = new DirtyRect()
  const put = (px: number, py: number, c: number): void => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return
    img.data[py * img.width + px] = c
    dirty.add(px, py)
  }
  for (let j = 0; j < prep.shadowH; j++) for (let i = 0; i < prep.shadowW; i++) if (prep.shadowPixels[j * prep.shadowW + i]) put(spec.x + i, spec.y + j, prep.shadowPixels[j * prep.shadowW + i]!)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (prep.pixels[j * w + i]) put(spec.x + i, spec.y + j, prep.pixels[j * w + i]!)

  let labelBox: Rect | undefined
  let labelFits = true
  if (spec.label !== undefined && spec.label !== '') {
    const es = entriesOf(palette)
    const font = getFont(spec.font ?? 'small')
    const centered = kind === 'button' || kind === 'choice' || kind === 'namebox'
    const align = spec.align ?? (centered ? 'center' : 'left')
    const hasFill = style.fill >>> 24 !== 0
    let color = spec.labelColor
    if (color === undefined) {
      color = hasFill ? contrastColor(es, style.fill) : lightestOf(es)
      if (state === 'disabled' && hasFill) {
        // muted: a neutral color part of the way from the fill towards the contrasting color
        const L = toOklab(style.fill)[0]
        const hi = toOklab(color)[0]
        const lo = Math.min(...es.map((e) => e.lab[0]))
        const range = Math.max(...es.map((e) => e.lab[0])) - lo || 1
        color = pickByLightness(es, (L + 0.5 * (hi - L) - lo) / range, [style.fill], 4)
      }
    }
    const padX = Math.max(nine.left, nine.right) + 2
    const padY = nine.top + 2
    const wrap = !centered
    const innerW = w - 2 * (centered ? Math.max(nine.left, nine.right) : padX)
    const layout = layoutText(spec.label, font, { align, maxWidth: wrap ? innerW : undefined })
    const lines = layout.lines.length
    const ink = lines === 1 ? font.baseline : layout.height
    let tx: number
    if (centered) tx = spec.x + Math.floor((w - layout.width) / 2)
    else tx = align === 'right' ? spec.x + w - padX - layout.width : align === 'center' ? spec.x + Math.floor((w - layout.width) / 2) : spec.x + padX
    let ty = centered ? spec.y + Math.floor((h - ink) / 2) : spec.y + padY
    if (pressed) ty += 1
    const r = drawText(img, spec.label, tx, ty, color, font, { align, maxWidth: wrap ? innerW : undefined })
    if (r.dirty) dirty.addRect(r.dirty)
    labelBox = { x: tx, y: ty, w: layout.width, h: ink }
    labelFits = layout.width <= w - 2 * nine.left && ink <= h - nine.top - nine.bottom
  }
  return { dirty: dirty.rect(), nineSlice: nine, style, state, labelBox, labelFits }
}

// ---------------------------------------------------------------- 9-slice copy

export type SliceMode = 'tile' | 'stretch'

export interface Insets {
  left: number
  top: number
  right: number
  bottom: number
}

export interface NineSliceOptions {
  /** How the middle is filled (default 'tile'). */
  center?: SliceMode
  /** How the four edges are filled (default 'tile'). */
  edges?: SliceMode
  /** What a transparent source pixel does: 'skip' keeps the target pixel (default), 'clear' erases it. */
  transparent?: 'skip' | 'clear'
}

/** Where target offset `d` (0..dstLen-1) reads from on one axis; the middle repeats or stretches. */
function sliceSource(d: number, dstLen: number, srcLen: number, a: number, b: number, mode: SliceMode): number {
  if (d < a) return d
  if (d >= dstLen - b) return srcLen - (dstLen - d)
  const midSrc = srcLen - a - b
  const midDst = dstLen - a - b
  const k = d - a
  return a + (mode === 'tile' ? k % midSrc : Math.min(midSrc - 1, Math.floor(((k + 0.5) * midSrc) / midDst)))
}

/** One number for all four sides, or per-side insets. */
export function normalizeInsets(ins: number | Insets): Insets {
  return typeof ins === 'number' ? { left: ins, top: ins, right: ins, bottom: ins } : { left: ins.left, top: ins.top, right: ins.right, bottom: ins.bottom }
}

/** Check that the insets fit the source and target rectangles; throws an LLM-readable Error. */
export function validateInsets(ins: Insets, src: { w: number; h: number }, dst: { w: number; h: number }): void {
  for (const [k, v] of Object.entries(ins)) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`Inset ${k} must be a whole number >= 0 (got ${v}).`)
  }
  if (ins.left + ins.right >= src.w || ins.top + ins.bottom >= src.h) {
    throw new Error(
      `The insets (left ${ins.left} + right ${ins.right}, top ${ins.top} + bottom ${ins.bottom}) leave no middle in the ${src.w}x${src.h} source: left+right must be less than ${src.w} and top+bottom less than ${src.h}.`
    )
  }
  if (ins.left + ins.right > dst.w || ins.top + ins.bottom > dst.h) {
    throw new Error(
      `The target ${dst.w}x${dst.h} is smaller than the borders (left+right ${ins.left + ins.right}, top+bottom ${ins.top + ins.bottom}). Use a bigger target or smaller insets.`
    )
  }
}

/**
 * Copy a 9-slice: `src` (a standalone raster holding exactly the source rectangle) onto `dst` at the target
 * rectangle. Corners copy 1:1, edges and the middle tile or stretch (nearest neighbour). The source must be a
 * snapshot, not a view of `dst`, so overlapping areas are safe.
 */
export function nineSlice(dst: Raster, src: Raster, target: Rect, insets: number | Insets, opts: NineSliceOptions = {}): Rect | null {
  const ins = normalizeInsets(insets)
  validateInsets(ins, { w: src.width, h: src.height }, target)
  const centerMode = opts.center ?? 'tile'
  const edgeMode = opts.edges ?? 'tile'
  const clear = opts.transparent === 'clear'
  const d = new DirtyRect()
  for (let j = 0; j < target.h; j++) {
    const y = target.y + j
    if (y < 0 || y >= dst.height) continue
    const midY = j >= ins.top && j < target.h - ins.bottom
    for (let i = 0; i < target.w; i++) {
      const x = target.x + i
      if (x < 0 || x >= dst.width) continue
      const midX = i >= ins.left && i < target.w - ins.right
      const mode = midX && midY ? centerMode : edgeMode
      const sx = sliceSource(i, target.w, src.width, ins.left, ins.right, mode)
      const sy = sliceSource(j, target.h, src.height, ins.top, ins.bottom, mode)
      const c = src.data[sy * src.width + sx]!
      if (c >>> 24 === 0) {
        if (!clear) continue
        dst.data[y * dst.width + x] = TRANSPARENT
      } else {
        dst.data[y * dst.width + x] = c
      }
      d.add(x, y)
    }
  }
  return d.rect()
}

/** Small helper for tests and previews: an element drawn on its own transparent raster. */
export function renderUiElement(spec: Omit<UiSpec, 'x' | 'y'>, palette: number[]): { raster: Raster; result: UiResult } {
  const raster = createRaster(spec.w + 1, spec.h + 1)
  const result = drawUiElement(raster, { ...spec, x: 0, y: 0 }, palette)
  return { raster, result }
}
