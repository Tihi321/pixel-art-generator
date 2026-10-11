// Palette import/export: .hex (Lospec), .gpl (GIMP), .pal (JASC), and PNG swatch strips.

import { type Palette, type PaletteColor, createId, normalizeHex, parseHexColor, rgbaToHex, unpackRgba } from '../model'
import { decodePng, encodePng, hasPngSignature } from './png'

export type PaletteFormat = 'hex' | 'gpl' | 'pal' | 'png'
export const PALETTE_FORMATS: readonly PaletteFormat[] = ['hex', 'gpl', 'pal', 'png']

const MAX_COLORS = 4096

function decodeText(input: string | Uint8Array): string {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return body.replace(/\r\n?/g, '\n')
}

function baseName(filename?: string): string | undefined {
  if (!filename) return undefined
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.trim() || undefined
}

function extOf(filename?: string): string {
  if (!filename) return ''
  const m = /\.([a-z0-9]+)$/i.exec(filename)
  return m ? m[1]!.toLowerCase() : ''
}

function make(name: string, colors: PaletteColor[]): Palette {
  if (colors.length === 0) throw new Error('No colors found in palette file.')
  if (colors.length > MAX_COLORS) throw new Error(`Palette has ${colors.length} colors; the maximum is ${MAX_COLORS}.`)
  return { id: createId('palette'), name, colors }
}

// ---------------------------------------------------------------- .hex

export function parseHexPalette(input: string | Uint8Array, name = 'Imported palette'): Palette {
  const colors: PaletteColor[] = []
  const lines = decodeText(input).split('\n')
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('//')) return
    if (line.startsWith('#') && parseHexColor(line.split(/[\s,;]+/)[0]!) === null) return // comment line
    const token = line.split(/[\s,;]+/)[0]!
    if (parseHexColor(token) === null) {
      throw new Error(`Line ${i + 1}: "${line}" is not a hex color. A .hex palette has one color per line, like "1a1c2c".`)
    }
    colors.push({ hex: normalizeHex(token) })
  })
  return make(name, colors)
}

export function exportHexPalette(palette: Palette): string {
  return palette.colors.map((c) => normalizeHex(c.hex).slice(1)).join('\n') + '\n'
}

// ---------------------------------------------------------------- .gpl

export function parseGplPalette(input: string | Uint8Array, name = 'Imported palette'): Palette {
  const lines = decodeText(input).split('\n')
  if (!/^GIMP Palette/i.test(lines[0]?.trim() ?? '')) throw new Error('Not a GIMP palette: first line must be "GIMP Palette".')
  let palName = name
  const colors: PaletteColor[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    const nm = /^Name:\s*(.*)$/i.exec(line)
    if (nm) {
      palName = nm[1]!.trim() || palName
      continue
    }
    if (/^Columns:/i.test(line) || line.startsWith('#')) continue
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(line)
    if (!m) throw new Error(`Line ${i + 1}: expected "R G B [name]" but found "${line}".`)
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (r > 255 || g > 255 || b > 255) throw new Error(`Line ${i + 1}: RGB values must be 0-255.`)
    const cname = m[4]?.trim()
    const color: PaletteColor = { hex: rgbToHex(r, g, b) }
    if (cname && !/^(untitled|index \d+)$/i.test(cname)) color.name = cname
    colors.push(color)
  }
  return make(palName, colors)
}

export function exportGplPalette(palette: Palette): string {
  const lines = ['GIMP Palette', `Name: ${palette.name}`, 'Columns: 8', '#']
  palette.colors.forEach((c, i) => {
    const [r, g, b] = unpackRgba(parseHexColor(c.hex) ?? 0)
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c.name ?? `Index ${i}`}`)
  })
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- .pal (JASC)

export function parseJascPalette(input: string | Uint8Array, name = 'Imported palette'): Palette {
  const lines = decodeText(input)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines[0] !== 'JASC-PAL') throw new Error('Not a JASC palette: first line must be "JASC-PAL".')
  if (lines[1] !== '0100') throw new Error(`Unsupported JASC-PAL version "${lines[1] ?? ''}" (expected 0100).`)
  const count = Number(lines[2])
  if (!Number.isInteger(count) || count < 0) throw new Error('JASC-PAL: the third line must be the color count.')
  const colors: PaletteColor[] = []
  for (let i = 0; i < count; i++) {
    const line = lines[3 + i]
    if (line === undefined) throw new Error(`JASC-PAL declares ${count} colors but only ${i} were found.`)
    const parts = line.split(/\s+/).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new Error(`JASC-PAL line ${4 + i}: expected "R G B" with values 0-255 but found "${line}".`)
    }
    colors.push({ hex: rgbToHex(parts[0]!, parts[1]!, parts[2]!) })
  }
  return make(name, colors)
}

export function exportJascPalette(palette: Palette): string {
  const lines = ['JASC-PAL', '0100', String(palette.colors.length)]
  for (const c of palette.colors) {
    const [r, g, b] = unpackRgba(parseHexColor(c.hex) ?? 0)
    lines.push(`${r} ${g} ${b}`)
  }
  return lines.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------- PNG swatches

/** Unique opaque colors of a PNG in scan order (swatch strip, or any image). */
export function parsePngPalette(bytes: Uint8Array, name = 'Imported palette'): Palette {
  const img = decodePng(bytes)
  const seen = new Set<number>()
  const colors: PaletteColor[] = []
  for (let i = 0; i < img.data.length; i++) {
    const c = img.data[i]!
    if (c >>> 24 < 128) continue
    const rgb = c & 0xffffff
    if (seen.has(rgb)) continue
    seen.add(rgb)
    colors.push({ hex: rgbaToHex(0xff000000 | rgb) })
    if (colors.length > MAX_COLORS) throw new Error(`Image has more than ${MAX_COLORS} unique colors; it does not look like a swatch strip.`)
  }
  return make(name, colors)
}

/** A one-row PNG with one swatch per color; `swatchSize` is the pixel size of each swatch. */
export function exportPngPalette(palette: Palette, swatchSize = 1): Uint8Array {
  const s = Math.max(1, Math.floor(swatchSize))
  const n = palette.colors.length
  const data = new Uint32Array(n)
  palette.colors.forEach((c, i) => {
    data[i] = parseHexColor(c.hex) ?? 0
  })
  return encodePng({ width: n, height: 1, data }, { scale: s })
}

// ---------------------------------------------------------------- auto-detect

function rgbToHex(r: number, g: number, b: number): string {
  return rgbaToHex(((255 << 24) | (b << 16) | (g << 8) | r) >>> 0)
}

export function detectPaletteFormat(input: string | Uint8Array, filename?: string): PaletteFormat {
  const ext = extOf(filename)
  if (ext === 'hex' || ext === 'gpl' || ext === 'pal' || ext === 'png') return ext
  if (typeof input !== 'string' && hasPngSignature(input)) return 'png'
  const head = decodeText(typeof input === 'string' ? input : input.subarray(0, 64)).trimStart()
  if (/^GIMP Palette/i.test(head)) return 'gpl'
  if (/^JASC-PAL/.test(head)) return 'pal'
  return 'hex'
}

/** Parse any supported palette file. `filename` (optional) provides the extension and default name. */
export function parsePalette(input: string | Uint8Array, filename?: string, name?: string): Palette {
  const format = detectPaletteFormat(input, filename)
  const nm = name ?? baseName(filename) ?? 'Imported palette'
  switch (format) {
    case 'gpl':
      return parseGplPalette(input, nm)
    case 'pal':
      return parseJascPalette(input, nm)
    case 'png': {
      if (typeof input === 'string') throw new Error('PNG palettes must be provided as binary data.')
      return parsePngPalette(input, nm)
    }
    default:
      return parseHexPalette(input, nm)
  }
}

export function exportPalette(palette: Palette, format: 'hex' | 'gpl' | 'pal'): string
export function exportPalette(palette: Palette, format: 'png', swatchSize?: number): Uint8Array
export function exportPalette(palette: Palette, format: PaletteFormat, swatchSize?: number): string | Uint8Array
export function exportPalette(palette: Palette, format: PaletteFormat, swatchSize = 1): string | Uint8Array {
  switch (format) {
    case 'gpl':
      return exportGplPalette(palette)
    case 'pal':
      return exportJascPalette(palette)
    case 'png':
      return exportPngPalette(palette, swatchSize)
    default:
      return exportHexPalette(palette)
  }
}
