// Animated GIF encoding on top of gifenc. Pure JS; no DOM.

import { GIFEncoder, quantize } from 'gifenc'
import { scaleImage } from './png'

export interface GifFrame {
  /** Packed 0xAABBGGRR, width*height. */
  data: Uint32Array
  delayMs: number
}

export interface EncodeGifOptions {
  width: number
  height: number
  frames: GifFrame[]
  /** Integer nearest-neighbour upscale (default 1). */
  scale?: number
  /** true/undefined: loop forever, false: play once, number: that many extra repeats. */
  loop?: boolean | number
  /** Alpha below this value (0..255) becomes transparent (default 128). */
  alphaThreshold?: number
  /** Optional fixed palette (hex strings or packed RGBA). Used only if every color fits; otherwise art is quantized. */
  palette?: Array<string | number>
}

export interface EncodeGifResult {
  bytes: Uint8Array
  /** Number of colors in the GIF palette (including the transparent slot when used). */
  paletteSize: number
  quantized: boolean
  hasTransparency: boolean
}

const MIN_DELAY_MS = 20

/** Encode frames as an animated GIF89a. Exact palette when <= 255/256 colors, otherwise quantized. */
export function encodeGif(opts: EncodeGifOptions): EncodeGifResult {
  const { width, height } = opts
  if (opts.frames.length === 0) throw new Error('GIF needs at least one frame.')
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))
  const threshold = opts.alphaThreshold ?? 128
  const frames = opts.frames.map((f) => {
    if (f.data.length !== width * height) throw new Error('GIF frame size does not match width*height.')
    return { img: scaleImage({ width, height, data: f.data }, scale), delayMs: f.delayMs }
  })
  const W = width * scale
  const H = height * scale
  if (W > 65535 || H > 65535) throw new Error('GIF dimensions are too large.')

  // Gather unique opaque colors (RGB only) and detect transparency.
  const unique = new Set<number>()
  let hasTransparency = false
  for (const f of frames) {
    const d = f.img.data
    for (let i = 0; i < d.length; i++) {
      const c = d[i]!
      if (c >>> 24 < threshold) hasTransparency = true
      else unique.add(c & 0xffffff)
      if (unique.size > 100000) break
    }
  }
  const slots = hasTransparency ? 255 : 256
  const colorList: number[] = []
  let quantized = false
  let palette: Array<[number, number, number]>
  if (unique.size <= slots) {
    // Preserve a requested palette ordering where possible.
    const ordered: number[] = []
    const left = new Set(unique)
    for (const p of opts.palette ?? []) {
      const c = typeof p === 'number' ? p & 0xffffff : hexToRgb24(p)
      if (c !== null && left.delete(c)) ordered.push(c)
    }
    for (const c of left) ordered.push(c)
    colorList.push(...ordered)
    palette = colorList.map((c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255])
  } else {
    quantized = true
    const sampleMax = 400000
    const all: number[] = []
    for (const f of frames) for (let i = 0; i < f.img.data.length; i++) if (f.img.data[i]! >>> 24 >= threshold) all.push(f.img.data[i]!)
    const step = Math.max(1, Math.floor(all.length / sampleMax))
    const sample = new Uint8Array(Math.ceil(all.length / step) * 4)
    let o = 0
    for (let i = 0; i < all.length; i += step) {
      const c = all[i]!
      sample[o++] = c & 255
      sample[o++] = (c >>> 8) & 255
      sample[o++] = (c >>> 16) & 255
      sample[o++] = 255
    }
    palette = quantize(sample.subarray(0, o), slots, { format: 'rgb565' }).map((c) => [c[0], c[1], c[2]])
  }
  const offset = hasTransparency ? 1 : 0
  const fullPalette: Array<[number, number, number]> = hasTransparency ? [[0, 0, 0], ...palette] : palette
  if (fullPalette.length === 0) fullPalette.push([0, 0, 0])
  if (fullPalette.length === 1) fullPalette.push([0, 0, 0])

  const exact = new Map<number, number>()
  if (!quantized) colorList.forEach((c, i) => exact.set(c, i + offset))
  const nearestCache = new Map<number, number>()
  const indexOf = (c: number): number => {
    const rgb = c & 0xffffff
    const hit = exact.get(rgb) ?? nearestCache.get(rgb)
    if (hit !== undefined) return hit
    const r = rgb & 255
    const g = (rgb >>> 8) & 255
    const b = (rgb >>> 16) & 255
    let best = offset
    let bestD = Infinity
    for (let i = offset; i < fullPalette.length; i++) {
      const p = fullPalette[i]!
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    nearestCache.set(rgb, best)
    return best
  }

  const gif = GIFEncoder()
  const repeat = opts.loop === false ? -1 : typeof opts.loop === 'number' ? opts.loop : 0
  frames.forEach((f, fi) => {
    const index = new Uint8Array(W * H)
    for (let i = 0; i < index.length; i++) {
      const c = f.img.data[i]!
      index[i] = c >>> 24 < threshold ? 0 : indexOf(c)
    }
    gif.writeFrame(index, W, H, {
      palette: fi === 0 ? fullPalette : undefined,
      delay: Math.max(MIN_DELAY_MS, f.delayMs),
      repeat,
      transparent: hasTransparency,
      transparentIndex: 0
    })
  })
  gif.finish()
  return { bytes: gif.bytes(), paletteSize: fullPalette.length, quantized, hasTransparency }
}

function hexToRgb24(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim())
  if (!m) return null
  const v = parseInt(m[1]!, 16)
  return ((v & 255) << 16) | (v & 0xff00) | (v >>> 16)
}
