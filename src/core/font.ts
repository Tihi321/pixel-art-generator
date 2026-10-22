// Built-in bitmap fonts for printable ASCII (32..126): "tiny" (3x5, capitals only) and "small" (5x7 caps, real
// lowercase with descenders). Glyphs are written as '#'/'.' rows, compiled once to bit rows, laid out
// into lines (wrap, align, spacing, integer scale) and drawn onto a Raster. Same conventions as
// raster.ts: mutate in place, return the bounding Rect of the written pixels (clipped) or null.

import { type Rect, TRANSPARENT } from './model'
import { type Raster, DirtyRect } from './raster'

export type FontName = 'tiny' | 'small'
export const FONT_NAMES: readonly FontName[] = ['tiny', 'small']

export interface Glyph {
  /** Width in font pixels. */
  w: number
  /** One entry per font row (top to bottom); bit x (0 = left) is set where the glyph has a pixel. */
  rows: number[]
}

export interface Font {
  name: FontName
  /** Rows of every glyph (including descenders): the height of one line of text in font pixels. */
  glyphRows: number
  /** Distance from the top of one line to the top of the next, in font pixels (before lineSpacing). */
  lineHeight: number
  /** Row index of the first row below the capital letters (descenders start here). */
  baseline: number
  glyphs: Map<string, Glyph>
  /** Hollow box drawn for characters the font does not have. */
  unknown: Glyph
}

// ---------------------------------------------------------------- glyph tables

type Rows = string[]

/** 3x5 capitals. There is no tiny lowercase: a..z reuse the capital shapes (small caps, as in PICO-8). */
const TINY: Record<string, Rows> = {
  ' ': ['..', '..', '..', '..', '..'],
  '!': ['#', '#', '#', '.', '#'],
  '"': ['#.#', '#.#', '...', '...', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '$': ['.#.', '.##', '##.', '.##', '.#.'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
  "'": ['#', '#', '.', '.', '.'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  '*': ['...', '#.#', '.#.', '#.#', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  ',': ['..', '..', '..', '.#', '#.'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['.', '.', '.', '.', '#'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ':': ['.', '#', '.', '#', '.'],
  ';': ['..', '.#', '..', '.#', '#.'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '=': ['...', '###', '...', '###', '...'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '@': ['.#.', '#.#', '###', '#..', '.##'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '[': ['##', '#.', '#.', '#.', '##'],
  '\\': ['#..', '#..', '.#.', '..#', '..#'],
  ']': ['##', '.#', '.#', '.#', '##'],
  '^': ['.#.', '#.#', '...', '...', '...'],
  _: ['...', '...', '...', '...', '###'],
  '`': ['#.', '.#', '..', '..', '..'],
  '{': ['.##', '.#.', '##.', '.#.', '.##'],
  '|': ['#', '#', '#', '#', '#'],
  '}': ['##.', '.#.', '.##', '.#.', '##.'],
  '~': ['...', '##.', '.##', '...', '...']
}

/** 5x7 caps on rows 0..6, baseline row 7; lowercase x-height 5 (rows 2..6); g j p q y and , ; descend to row 8. */
const SMALL: Record<string, Rows> = {
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '"': ['#.#', '#.#'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['#', '#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ',': ['..', '..', '..', '..', '.#', '.#', '.#', '#.'],
  '-': ['...', '...', '...', '###'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '.', '.', '#', '.', '.', '#'],
  ';': ['..', '..', '..', '.#', '..', '.#', '.#', '#.'],
  '<': ['...', '..#', '.#.', '#..', '.#.', '..#'],
  '=': ['....', '....', '####', '....', '####'],
  '>': ['...', '#..', '.#.', '..#', '.#.', '#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  '\\': ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#'],
  ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '^': ['..#..', '.#.#.', '#...#'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '`': ['#.', '.#'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['.....', '.....', '.###.', '#...#', '#....', '#...#', '.###.'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  f: ['..##', '.#..', '.#..', '###.', '.#..', '.#..', '.#..'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  i: ['.#.', '...', '##.', '.#.', '.#.', '.#.', '.##'],
  j: ['..#', '...', '..#', '..#', '..#', '..#', '..#', '#.#', '.#.'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  l: ['##.', '.#.', '.#.', '.#.', '.#.', '.#.', '.##'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#...#', '#...#'],
  n: ['.....', '.....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#..', '.#..', '###.', '.#..', '.#..', '.#..', '..##'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  '{': ['..##', '.#..', '.#..', '#...', '.#..', '.#..', '..##'],
  '|': ['#', '#', '#', '#', '#', '#', '#', '#', '#'],
  '}': ['##..', '..#.', '..#.', '...#', '..#.', '..#.', '##..'],
  '~': ['.....', '.....', '.....', '.##.#', '#.##.']
}

const TINY_UNKNOWN: Rows = ['###', '#.#', '#.#', '#.#', '###']
const SMALL_UNKNOWN: Rows = ['####', '#..#', '#..#', '#..#', '#..#', '#..#', '####']

/**
 * Accented Latin letters that render as their base letter. Anything else outside 32..126 renders as
 * the hollow box and is counted in `unknownChars`.
 */
const ACCENT_GROUPS: Record<string, string> = {
  a: 'àáâãäåā', A: 'ÀÁÂÃÄÅĀ', c: 'çćč', C: 'ÇĆČ', e: 'èéêëēě', E: 'ÈÉÊËĒĚ', i: 'ìíîïī', I: 'ÌÍÎÏĪ',
  n: 'ñń', N: 'ÑŃ', o: 'òóôõöøō', O: 'ÒÓÔÕÖØŌ', s: 'śš', S: 'ŚŠ', u: 'ùúûüū', U: 'ÙÚÛÜŪ',
  y: 'ýÿ', Y: 'Ý', z: 'źżž', Z: 'ŹŻŽ'
}
const ACCENT_BASE = new Map<string, string>()
for (const [base, chars] of Object.entries(ACCENT_GROUPS)) for (const ch of chars) ACCENT_BASE.set(ch, base)

// ---------------------------------------------------------------- compile

function compileGlyph(rows: Rows, glyphRows: number, label: string): Glyph {
  const w = rows[0]!.length
  if (rows.length > glyphRows) throw new Error(`Font glyph ${label} has ${rows.length} rows; the font has ${glyphRows}.`)
  const out: number[] = []
  for (const row of rows) {
    if (row.length !== w || !/^[#.]+$/.test(row)) throw new Error(`Font glyph ${label} has a malformed row "${row}".`)
    let bits = 0
    for (let x = 0; x < w; x++) if (row[x] === '#') bits |= 1 << x
    out.push(bits)
  }
  while (out.length < glyphRows) out.push(0)
  return { w, rows: out }
}

function compileFont(name: FontName, table: Record<string, Rows>, unknown: Rows, glyphRows: number, lineHeight: number, baseline: number): Font {
  const glyphs = new Map<string, Glyph>()
  for (const [ch, rows] of Object.entries(table)) glyphs.set(ch, compileGlyph(rows, glyphRows, `${name} "${ch}"`))
  return { name, glyphRows, lineHeight, baseline, glyphs, unknown: compileGlyph(unknown, glyphRows, `${name} unknown`) }
}

const FONTS: Record<FontName, Font> = {
  tiny: compileFont('tiny', TINY, TINY_UNKNOWN, 5, 6, 5),
  small: compileFont('small', SMALL, SMALL_UNKNOWN, 9, 10, 7)
}

// tiny has no lowercase of its own: a..z are the capitals
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') FONTS.tiny.glyphs.set(c.toLowerCase(), FONTS.tiny.glyphs.get(c)!)

export function getFont(name: FontName): Font {
  return FONTS[name]
}

/** Glyph for a character, or null when the font has none (it would render as the unknown box). */
export function glyphFor(font: Font, ch: string): Glyph | null {
  return font.glyphs.get(ch) ?? font.glyphs.get(ACCENT_BASE.get(ch) ?? '') ?? null
}

// ---------------------------------------------------------------- layout

export type TextAlign = 'left' | 'center' | 'right'

export interface TextLayoutOptions {
  /** Wrap lines wider than this many canvas pixels at spaces (long words are broken). Default: no wrapping. */
  maxWidth?: number
  /** Alignment of the lines inside the box (default 'left'); center/right need maxWidth to mean anything beyond the widest line. */
  align?: TextAlign
  /** Extra space between letters, in font pixels (default 1). */
  letterSpacing?: number
  /** Extra space between lines, in font pixels (default 0). */
  lineSpacing?: number
  /** Integer size factor, each font pixel becomes scale x scale (default 1). */
  scale?: number
}

export interface PlacedGlyph {
  glyph: Glyph
  /** Offsets from the top-left of the text box, in canvas pixels. */
  x: number
  y: number
}

export interface TextLine {
  text: string
  /** Width in canvas pixels. */
  width: number
}

export interface TextLayout {
  glyphs: PlacedGlyph[]
  lines: TextLine[]
  /** Text box size in canvas pixels. */
  width: number
  height: number
  scale: number
  /** Characters that rendered as the unknown box. */
  unknownChars: number
}

function glyphOrBox(font: Font, ch: string): Glyph {
  return glyphFor(font, ch) ?? font.unknown
}

/** Width in font pixels of a string. */
function textUnits(font: Font, s: string, spacing: number): number {
  let w = 0
  let n = 0
  for (const ch of s) {
    w += glyphOrBox(font, ch).w
    n++
  }
  return n === 0 ? 0 : w + spacing * (n - 1)
}

/** Split one paragraph into lines no wider than `limit` font pixels (0 = never wrap). */
function wrapParagraph(font: Font, para: string, spacing: number, limit: number): string[] {
  if (limit <= 0 || textUnits(font, para, spacing) <= limit) return [para]
  const lines: string[] = []
  let cur = ''
  const push = (): void => {
    lines.push(cur)
    cur = ''
  }
  for (const word of para.split(' ')) {
    if (word === '') continue
    if (cur !== '' && textUnits(font, `${cur} ${word}`, spacing) <= limit) {
      cur = `${cur} ${word}`
      continue
    }
    if (cur !== '') push()
    if (textUnits(font, word, spacing) <= limit) {
      cur = word
      continue
    }
    // a word wider than a whole line: break it between letters
    for (const ch of word) {
      if (cur !== '' && textUnits(font, cur + ch, spacing) > limit) push()
      cur += ch
    }
  }
  if (cur !== '' || lines.length === 0) push()
  return lines
}

/** Lay text out: positioned glyphs, per-line widths and the box size. See TextLayoutOptions. */
export function layoutText(text: string, font: Font, opts: TextLayoutOptions = {}): TextLayout {
  const scale = Math.max(1, Math.round(opts.scale ?? 1))
  const spacing = Math.max(0, Math.round(opts.letterSpacing ?? 1))
  const lineGap = Math.round(opts.lineSpacing ?? 0)
  const align = opts.align ?? 'left'
  const limit = opts.maxWidth === undefined ? 0 : Math.max(1, Math.floor(opts.maxWidth / scale))
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')

  const lineTexts: string[] = []
  for (const para of clean.split('\n')) lineTexts.push(...wrapParagraph(font, para, spacing, limit))
  const lines: TextLine[] = lineTexts.map((t) => ({ text: t, width: textUnits(font, t, spacing) * scale }))
  const widest = Math.max(0, ...lines.map((l) => l.width))
  const width = opts.maxWidth !== undefined && align !== 'left' ? Math.max(opts.maxWidth, widest) : widest
  const pitch = (font.lineHeight + lineGap) * scale
  const height = Math.max(0, (lines.length - 1) * pitch + font.glyphRows * scale)

  const glyphs: PlacedGlyph[] = []
  let unknownChars = 0
  lines.forEach((line, li) => {
    let x = align === 'center' ? Math.floor((width - line.width) / 2) : align === 'right' ? width - line.width : 0
    for (const ch of line.text) {
      const g = glyphFor(font, ch)
      if (!g) unknownChars++
      const glyph = g ?? font.unknown
      glyphs.push({ glyph, x, y: li * pitch })
      x += (glyph.w + spacing) * scale
    }
  })
  return { glyphs, lines, width, height, scale, unknownChars }
}

// ---------------------------------------------------------------- drawing

export interface DrawTextOptions extends TextLayoutOptions {
  /** Outline color, drawn `scale` canvas pixels wide around the glyphs (8-connected). */
  outline?: number
  /** Drop shadow (of the glyphs and their outline); dx/dy are canvas pixels, default 1 font pixel (= scale). */
  shadow?: { color: number; dx?: number; dy?: number }
}

export interface DrawTextResult {
  /** Pixels written (clipped to the raster), or null. */
  dirty: Rect | null
  layout: TextLayout
}

function norm(c: number): number {
  return c >>> 24 === 0 ? TRANSPARENT : c >>> 0
}

/** Draw text with its text box's top-left at (x, y). */
export function drawText(img: Raster, text: string, x: number, y: number, color: number, font: Font, opts: DrawTextOptions = {}): DrawTextResult {
  const layout = layoutText(text, font, opts)
  const d = new DirtyRect()
  const scale = layout.scale
  const fill = norm(color)
  const put = (px: number, py: number, c: number): void => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return
    img.data[py * img.width + px] = c
    d.add(px, py)
  }
  const forEachGlyphPixel = (fn: (px: number, py: number) => void): void => {
    for (const g of layout.glyphs) {
      for (let r = 0; r < g.glyph.rows.length; r++) {
        const bits = g.glyph.rows[r]!
        if (bits === 0) continue
        for (let c = 0; c < g.glyph.w; c++) {
          if ((bits & (1 << c)) === 0) continue
          fn(g.x + c * scale, g.y + r * scale)
        }
      }
    }
  }

  if (opts.outline !== undefined || opts.shadow) {
    const m = opts.outline !== undefined ? scale : 0
    const sdx = opts.shadow ? Math.round(opts.shadow.dx ?? scale) : 0
    const sdy = opts.shadow ? Math.round(opts.shadow.dy ?? scale) : 0
    const pad = m + Math.max(Math.abs(sdx), Math.abs(sdy))
    const mw = layout.width + 2 * pad
    const mh = layout.height + 2 * pad
    const glyphMask = new Uint8Array(mw * mh)
    forEachGlyphPixel((px, py) => {
      for (let j = 0; j < scale; j++) glyphMask.fill(1, (py + j + pad) * mw + px + pad, (py + j + pad) * mw + px + pad + scale)
    })
    // glyphs grown by m pixels in every direction (a horizontal, then a vertical box pass)
    const grown = new Uint8Array(mw * mh)
    if (m > 0) {
      const horiz = new Uint8Array(mw * mh)
      for (let j = 0; j < mh; j++) {
        for (let i = 0; i < mw; i++) {
          if (glyphMask[j * mw + i] === 0) continue
          horiz.fill(1, j * mw + Math.max(0, i - m), j * mw + Math.min(mw, i + m + 1))
        }
      }
      for (let j = 0; j < mh; j++) {
        for (let i = 0; i < mw; i++) {
          if (horiz[j * mw + i] === 0) continue
          for (let k = Math.max(0, j - m); k <= Math.min(mh - 1, j + m); k++) grown[k * mw + i] = 1
        }
      }
    } else grown.set(glyphMask)
    const paint = (c: number, ox: number, oy: number): void => {
      for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) if (grown[j * mw + i] !== 0) put(x + i - pad + ox, y + j - pad + oy, c)
    }
    if (opts.shadow) paint(norm(opts.shadow.color), sdx, sdy)
    if (opts.outline !== undefined) paint(norm(opts.outline), 0, 0)
  }
  forEachGlyphPixel((px, py) => {
    for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) put(x + px + i, y + py + j, fill)
  })
  return { dirty: d.rect(), layout }
}
