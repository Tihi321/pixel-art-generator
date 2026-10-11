// LLM-friendly ASCII grid format.
//
//   { legend: { ".": null, "k": "#1a1c2c", "s": "#f4b41b" }, rows: ["..kk..", ".kssk.", "..kk.."] }
//
// Each legend key is a single character, each value a hex color or null (transparent).
// '.' and ' ' are transparent unless the legend defines them explicitly.

import { type Palette, type Rect, hexToRgba, parseHexColor, rgbaToHex, TRANSPARENT } from '../model'
import { type Raster, DirtyRect, getPixel, inBounds } from '../raster'

export interface Grid {
  legend: Record<string, string | null>
  rows: string[]
}

export interface GridIssue {
  /** 1-based row number in the input, if applicable. */
  row?: number
  /** 1-based column in the row, if applicable. */
  col?: number
  message: string
}

export class GridError extends Error {
  readonly issues: GridIssue[]
  constructor(issues: GridIssue[]) {
    super(formatIssues(issues))
    this.name = 'GridError'
    this.issues = issues
  }
}

const MAX_REPORTED = 12

function formatIssues(issues: GridIssue[]): string {
  const lines = issues.slice(0, MAX_REPORTED).map((i) => {
    const where = i.row !== undefined ? (i.col !== undefined ? `Row ${i.row}, col ${i.col}: ` : `Row ${i.row}: `) : ''
    return `- ${where}${i.message}`
  })
  const more = issues.length > MAX_REPORTED ? `\n- ...and ${issues.length - MAX_REPORTED} more problem(s).` : ''
  return `Invalid grid (${issues.length} problem${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}${more}`
}

function chars(s: string): string[] {
  return Array.from(s)
}

export interface ParsedGrid {
  width: number
  height: number
  /** Packed RGBA per cell (0 for transparent). */
  pixels: Uint32Array
  /** 1 where the grid specifies a pixel color, 0 where it is transparent/unspecified. */
  opaque: Uint8Array
}

/** Validate a grid; returns every problem found (empty array = valid). */
export function validateGrid(grid: Grid): GridIssue[] {
  const issues: GridIssue[] = []
  if (!grid || typeof grid !== 'object') return [{ message: 'Grid must be an object {legend, rows}.' }]
  if (!Array.isArray(grid.rows) || grid.rows.length === 0) {
    return [{ message: '"rows" must be a non-empty array of strings, one string per pixel row.' }]
  }
  const legend = grid.legend ?? {}
  const keys = Object.keys(legend)
  for (const k of keys) {
    if (chars(k).length !== 1) {
      issues.push({ message: `Legend key ${JSON.stringify(k)} must be exactly one character.` })
      continue
    }
    const v = legend[k]
    if (v !== null && (typeof v !== 'string' || (v.trim().toLowerCase() !== 'transparent' && parseHexColor(v) === null))) {
      issues.push({
        message: `Legend "${k}" has invalid color ${JSON.stringify(v)}. Use "#rrggbb", "#rgb", "#rrggbbaa" or null for transparent.`
      })
    }
  }
  const firstLen = typeof grid.rows[0] === 'string' ? chars(grid.rows[0]).length : 0
  grid.rows.forEach((row, ri) => {
    if (typeof row !== 'string') {
      issues.push({ row: ri + 1, message: 'Row must be a string.' })
      return
    }
    const cs = chars(row)
    if (cs.length !== firstLen) {
      issues.push({
        row: ri + 1,
        message: `Row has ${cs.length} characters but row 1 has ${firstLen}. All rows must be the same width (pad with '.' for transparent).`
      })
    }
    cs.forEach((ch, ci) => {
      if (Object.prototype.hasOwnProperty.call(legend, ch)) return
      if (ch === '.' || ch === ' ') return
      issues.push({
        row: ri + 1,
        col: ci + 1,
        message: `Character ${JSON.stringify(ch)} (x=${ci}, y=${ri}) is not in the legend. Legend characters: ${
          keys.length ? keys.map((k) => JSON.stringify(k)).join(', ') : '(empty)'
        }. Add it to the legend or replace it.`
      })
    })
  })
  return issues
}

/** Parse a grid into packed pixels. Throws GridError with LLM-readable messages. */
export function parseGrid(grid: Grid): ParsedGrid {
  const issues = validateGrid(grid)
  if (issues.length) throw new GridError(issues)
  const legend = grid.legend ?? {}
  const colors = new Map<string, number>()
  for (const [k, v] of Object.entries(legend)) colors.set(k, v === null ? TRANSPARENT : hexToRgba(v))
  const height = grid.rows.length
  const width = chars(grid.rows[0]!).length
  const pixels = new Uint32Array(width * height)
  const opaque = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const cs = chars(grid.rows[y]!)
    for (let x = 0; x < width; x++) {
      const ch = cs[x]!
      const c = colors.has(ch) ? colors.get(ch)! : TRANSPARENT
      pixels[y * width + x] = c
      opaque[y * width + x] = c >>> 24 !== 0 ? 1 : 0
    }
  }
  return { width, height, pixels, opaque }
}

export interface ApplyGridOptions {
  /**
   * What transparent grid cells do: 'skip' (default) leaves existing pixels untouched,
   * 'clear' erases them (the grid fully replaces its rectangle).
   */
  transparent?: 'skip' | 'clear'
}

export interface ApplyGridResult {
  dirty: Rect | null
  /** Number of grid cells that fell outside the raster and were dropped. */
  clipped: number
  width: number
  height: number
}

/** Draw a grid onto a raster with its top-left at (x, y). */
export function applyGrid(img: Raster, grid: Grid, x: number, y: number, opts: ApplyGridOptions = {}): ApplyGridResult {
  const parsed = parseGrid(grid)
  const clear = opts.transparent === 'clear'
  const d = new DirtyRect()
  let clipped = 0
  for (let j = 0; j < parsed.height; j++) {
    for (let i = 0; i < parsed.width; i++) {
      const tx = x + i
      const ty = y + j
      const c = parsed.pixels[j * parsed.width + i]!
      if (!inBounds(img, tx, ty)) {
        if (c !== 0 || clear) clipped++
        continue
      }
      if (c === TRANSPARENT && !clear) continue
      img.data[ty * img.width + tx] = c
      d.add(tx, ty)
    }
  }
  return { dirty: d.rect(), clipped, width: parsed.width, height: parsed.height }
}

// ---------------------------------------------------------------- reading

const LEGEND_POOL = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const MAX_GRID_COLORS = LEGEND_POOL.length

export interface ReadGridOptions {
  /** Prefer stable characters for these palette colors (palette index i -> pool[i]). */
  palette?: Palette
  /** Existing legend to stay consistent with: colors it already contains keep their characters. */
  legend?: Record<string, string | null>
}

export interface ReadGridResult extends Grid {
  width: number
  height: number
  /** Palette color names (or palette indices) for legend characters, when known. */
  names: Record<string, string>
  /** Region actually read (clipped to the raster). */
  rect: Rect
}

/** Read a region back as a grid with an auto-generated legend. Errors if more than 62 colors are present. */
export function readGrid(img: Raster, region: Rect, opts: ReadGridOptions = {}): ReadGridResult {
  const rect = { x: region.x, y: region.y, w: region.w, h: region.h }
  if (rect.w < 1 || rect.h < 1) throw new Error(`Region ${rect.w}x${rect.h} is empty.`)
  // Collect unique colors in scan order.
  const unique: number[] = []
  const seen = new Set<number>()
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const c = getPixel(img, rect.x + x, rect.y + y)
      if (c >>> 24 === 0 || seen.has(c)) continue
      seen.add(c)
      unique.push(c)
    }
  }
  if (unique.length > MAX_GRID_COLORS) {
    throw new Error(
      `The region contains ${unique.length} distinct colors but a grid legend supports at most ${MAX_GRID_COLORS}. Read a smaller region, or remap the art to a palette first (remap_to_palette).`
    )
  }
  const charOf = new Map<number, string>()
  const used = new Set<string>(['.'])
  const assign = (c: number, ch: string): void => {
    charOf.set(c, ch)
    used.add(ch)
  }
  // 1. Characters from a provided legend.
  if (opts.legend) {
    for (const [k, v] of Object.entries(opts.legend)) {
      if (v === null || Array.from(k).length !== 1 || k === '.' || k === ' ') continue
      const c = parseHexColor(v)
      if (c !== null && seen.has(c) && !charOf.has(c) && !used.has(k)) assign(c, k)
    }
  }
  // 2. Stable characters for palette colors.
  const names: Record<string, string> = {}
  const paletteIndex = new Map<number, number>()
  if (opts.palette) {
    opts.palette.colors.forEach((pc, i) => {
      const c = parseHexColor(pc.hex)
      if (c !== null && !paletteIndex.has(c)) paletteIndex.set(c, i)
    })
    for (const c of unique) {
      const idx = paletteIndex.get(c)
      if (idx === undefined || charOf.has(c)) continue
      const ch = LEGEND_POOL[idx]
      if (ch !== undefined && !used.has(ch)) assign(c, ch)
    }
  }
  // 3. Everything else gets the next free pool character.
  let next = 0
  for (const c of unique) {
    if (charOf.has(c)) continue
    while (used.has(LEGEND_POOL[next]!)) next++
    assign(c, LEGEND_POOL[next]!)
  }
  const legend: Record<string, string | null> = { '.': null }
  for (const c of unique) {
    const ch = charOf.get(c)!
    legend[ch] = rgbaToHex(c)
    const idx = paletteIndex.get(c)
    if (idx !== undefined) names[ch] = opts.palette!.colors[idx]!.name ?? `palette[${idx}]`
  }
  const rows: string[] = []
  for (let y = 0; y < rect.h; y++) {
    let row = ''
    for (let x = 0; x < rect.w; x++) {
      const c = getPixel(img, rect.x + x, rect.y + y)
      row += c >>> 24 === 0 ? '.' : charOf.get(c)!
    }
    rows.push(row)
  }
  return { legend, rows, width: rect.w, height: rect.h, names, rect }
}
