// Color utilities. Pixels are packed RGBA as 0xAABBGGRR (little-endian RGBA byte order),
// which matches a Uint32Array view over canvas ImageData on little-endian machines.
// All conversions here use explicit shifts, so they are platform independent.

export const TRANSPARENT = 0

export function packRgba(r: number, g: number, b: number, a = 255): number {
  const cr = clampByte(r)
  const cg = clampByte(g)
  const cb = clampByte(b)
  const ca = clampByte(a)
  if (ca === 0) return TRANSPARENT
  return ((ca << 24) | (cb << 16) | (cg << 8) | cr) >>> 0
}

export function unpackRgba(c: number): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24]
}

export function alphaOf(c: number): number {
  return c >>> 24
}

function clampByte(v: number): number {
  v = Math.round(v)
  return v < 0 ? 0 : v > 255 ? 255 : v
}

const HEX_RE = /^[0-9a-f]+$/i

/** Parse "#rgb", "#rgba", "#rrggbb", "#rrggbbaa" (the '#' is optional). Returns null when invalid. */
export function parseHexColor(input: string): number | null {
  let s = input.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (!HEX_RE.test(s)) return null
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  if (s.length !== 6 && s.length !== 8) return null
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255
  return packRgba(r, g, b, a)
}

/** Hex string (or null/'transparent'/'none') to a packed color. Throws on invalid input. */
export function hexToRgba(input: string | null | undefined): number {
  if (input === null || input === undefined) return TRANSPARENT
  const lower = input.trim().toLowerCase()
  if (lower === 'transparent' || lower === 'none') return TRANSPARENT
  const c = parseHexColor(input)
  if (c === null) {
    throw new Error(`Invalid color "${input}". Use #rgb, #rrggbb or #rrggbbaa (or null for transparent).`)
  }
  return c
}

const HEX_DIGITS = '0123456789abcdef'
function hex2(v: number): string {
  return HEX_DIGITS[(v >> 4) & 15]! + HEX_DIGITS[v & 15]!
}

/** Packed color to "#rrggbb" (opaque) or "#rrggbbaa" (any other alpha). */
export function rgbaToHex(c: number): string {
  const [r, g, b, a] = unpackRgba(c)
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 255 ? '' : hex2(a)}`
}

/** Canonical lowercase hex form. Throws on invalid input; 'transparent' stays '#00000000'. */
export function normalizeHex(input: string): string {
  return rgbaToHex(hexToRgba(input))
}

export type ColorSpace = 'rgb' | 'perceptual'

function srgbToLinear(v: number): number {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** Convert a packed color to OKLab [L, a, b] (alpha ignored). */
export function toOklab(c: number): [number, number, number] {
  const r = srgbToLinear(c & 255)
  const g = srgbToLinear((c >>> 8) & 255)
  const b = srgbToLinear((c >>> 16) & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

/**
 * Build a nearest-color lookup over a list of packed colors. Returns the index of the closest
 * palette entry (ties resolve to the lowest index). Results are cached per input color.
 */
export function createPaletteMatcher(colors: number[], mode: ColorSpace = 'perceptual'): (c: number) => number {
  if (colors.length === 0) throw new Error('Cannot match against an empty palette.')
  const cache = new Map<number, number>()
  const keyed =
    mode === 'rgb'
      ? colors.map((c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255] as [number, number, number])
      : colors.map((c) => toOklab(c))
  return (c: number): number => {
    const key = c & 0xffffff
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const q: [number, number, number] =
      mode === 'rgb' ? [c & 255, (c >>> 8) & 255, (c >>> 16) & 255] : toOklab(c)
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < keyed.length; i++) {
      const k = keyed[i]!
      const d0 = k[0] - q[0]
      const d1 = k[1] - q[1]
      const d2 = k[2] - q[2]
      const d = d0 * d0 + d1 * d1 + d2 * d2
      if (d < bestD) {
        bestD = d
        best = i
        if (d === 0) break
      }
    }
    cache.set(key, best)
    return best
  }
}
