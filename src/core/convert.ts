// Image to pixel-art conversion and exact-size export. Pure TypeScript: no DOM, no Electron, no node:*.
//
// Pipeline (convertImage): alpha-aware area downscale -> alpha threshold -> palette (given, or median-cut
// from the image) -> remap with optional dithering (never on transparent pixels) -> orphan cleanup ->
// optional 1 px outline.

import { type Document, TRANSPARENT, createPaletteMatcher, packRgba, unpackRgba } from './model'
import { type RgbaImage } from './codecs/png'
import { type Raster, createRaster, flattenFrame, outline as outlineRaster } from './raster'

export const MAX_IMPORT_SIDE = 2048
/** Source images above these limits are refused (memory): either side, or the pixel count. */
export const MAX_SOURCE_SIDE = 16384
export const MAX_SOURCE_PIXELS = 64 * 1024 * 1024
export const MAX_EXPORT_SIDE = 8192

export type DitherMode = 'none' | 'ordered' | 'floyd'

// ---------------------------------------------------------------- sizes

export interface TargetSizeOptions {
  width?: number
  height?: number
  /** Downscale divisor (alternative to width/height). */
  scale?: number
}

/**
 * Output size of an import. Both width and height: exactly those. One of them: the other follows the
 * aspect ratio. `scale`: source size divided by it. Nothing: the source size. Throws above 2048x2048,
 * and for a source above 16384 px a side or 64M pixels.
 */
export function resolveTargetSize(srcW: number, srcH: number, o: TargetSizeOptions = {}): { width: number; height: number } {
  if (srcW > MAX_SOURCE_SIDE || srcH > MAX_SOURCE_SIDE || srcW * srcH > MAX_SOURCE_PIXELS) {
    throw new Error(`The source image is too large (${srcW}x${srcH}; max ${MAX_SOURCE_SIDE} px a side and ${MAX_SOURCE_PIXELS / 1024 / 1024} megapixels). Downscale it first.`)
  }
  let w: number
  let h: number
  if (o.width !== undefined && o.height !== undefined) {
    w = o.width
    h = o.height
  } else if (o.width !== undefined) {
    w = o.width
    h = (srcH * o.width) / srcW
  } else if (o.height !== undefined) {
    h = o.height
    w = (srcW * o.height) / srcH
  } else if (o.scale !== undefined) {
    if (!(o.scale > 0)) throw new Error(`scale must be greater than 0 (got ${o.scale}).`)
    w = srcW / o.scale
    h = srcH / o.scale
  } else {
    w = srcW
    h = srcH
  }
  w = Math.max(1, Math.round(w))
  h = Math.max(1, Math.round(h))
  if (w > MAX_IMPORT_SIDE || h > MAX_IMPORT_SIDE) {
    throw new Error(`The converted size ${w}x${h} is too large (max ${MAX_IMPORT_SIDE}x${MAX_IMPORT_SIDE}). The source is ${srcW}x${srcH}: pass width/height (for example width 1920, height 1080) or a larger scale.`)
  }
  return { width: w, height: h }
}

// ---------------------------------------------------------------- downscale

interface Span {
  start: number
  weights: Float64Array
}

/** For each destination index, the source indices it covers and their overlap weights (box filter). */
function spans(srcN: number, dstN: number): Span[] {
  const out: Span[] = []
  const ratio = srcN / dstN
  for (let d = 0; d < dstN; d++) {
    const a = d * ratio
    const b = (d + 1) * ratio
    const start = Math.floor(a)
    const end = Math.min(srcN, Math.ceil(b))
    const weights = new Float64Array(Math.max(1, end - start))
    for (let s = start; s < end; s++) weights[s - start] = Math.min(b, s + 1) - Math.max(a, s)
    out.push({ start, weights })
  }
  return out
}

/**
 * Area-average resize that respects transparency: colours are averaged weighted by alpha (premultiplied),
 * so a transparent background never bleeds into the sprite edge. Output alpha is the average alpha
 * (0..255); colour is un-premultiplied. Works for up- and downscaling.
 */
export function areaResize(src: RgbaImage, dw: number, dh: number): RgbaImage {
  const { width: sw, height: sh } = src
  const xs = spans(sw, dw)
  const ys = spans(sh, dh)
  // horizontal pass: dw x sh, 4 floats per pixel (premultiplied r, g, b and alpha)
  const mid = new Float64Array(dw * sh * 4)
  for (let y = 0; y < sh; y++) {
    const row = y * sw
    for (let x = 0; x < dw; x++) {
      const sp = xs[x]!
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (let i = 0; i < sp.weights.length; i++) {
        const wgt = sp.weights[i]!
        const c = src.data[row + sp.start + i]!
        const ca = c >>> 24
        wsum += wgt
        a += wgt * ca
        r += wgt * ca * (c & 255)
        g += wgt * ca * ((c >>> 8) & 255)
        b += wgt * ca * ((c >>> 16) & 255)
      }
      const o = (y * dw + x) * 4
      mid[o] = r / wsum
      mid[o + 1] = g / wsum
      mid[o + 2] = b / wsum
      mid[o + 3] = a / wsum
    }
  }
  const data = new Uint32Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const sp = ys[y]!
    for (let x = 0; x < dw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (let i = 0; i < sp.weights.length; i++) {
        const wgt = sp.weights[i]!
        const o = ((sp.start + i) * dw + x) * 4
        wsum += wgt
        r += wgt * mid[o]!
        g += wgt * mid[o + 1]!
        b += wgt * mid[o + 2]!
        a += wgt * mid[o + 3]!
      }
      r /= wsum
      g /= wsum
      b /= wsum
      a /= wsum
      if (a < 0.5) {
        data[y * dw + x] = TRANSPARENT
        continue
      }
      // r, g, b are alpha-premultiplied sums; divide by the average alpha to get the colour back
      data[y * dw + x] = packRgba(r / a, g / a, b / a, a)
    }
  }
  return { width: dw, height: dh, data }
}

/** Nearest-neighbour resize to an exact size (any ratio, not only integer multiples). */
export function resizeNearest(img: RgbaImage, width: number, height: number): RgbaImage {
  if (width === img.width && height === img.height) return img
  const data = new Uint32Array(width * height)
  const xmap = new Int32Array(width)
  for (let x = 0; x < width; x++) xmap[x] = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / width))
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / height))
    const srow = sy * img.width
    const drow = y * width
    for (let x = 0; x < width; x++) data[drow + x] = img.data[srow + xmap[x]!]!
  }
  return { width, height, data }
}

// ---------------------------------------------------------------- palette (median cut)

/**
 * Median-cut quantisation of the opaque pixels to at most `maxColors` opaque colours. Images with fewer
 * distinct colours keep them all.
 */
export function medianCutPalette(data: Uint32Array, maxColors: number): number[] {
  const counts = new Map<number, number>()
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!
    if (c >>> 24 === 0) continue
    const k = c & 0xffffff
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const n = Math.max(1, Math.floor(maxColors))
  interface Entry {
    rgb: number
    count: number
  }
  const all: Entry[] = [...counts].map(([rgb, count]) => ({ rgb, count }))
  if (all.length <= n) return all.map((e) => packRgba(e.rgb & 255, (e.rgb >>> 8) & 255, (e.rgb >>> 16) & 255)).sort((a, b) => a - b)

  const chan = (rgb: number, ch: number): number => (rgb >>> (ch * 8)) & 255
  const rangeOf = (box: Entry[]): { ch: number; range: number } => {
    let best = { ch: 0, range: -1 }
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255
      let hi = 0
      for (const e of box) {
        const v = chan(e.rgb, ch)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo > best.range) best = { ch, range: hi - lo }
    }
    return best
  }
  const boxes: Entry[][] = [all]
  while (boxes.length < n) {
    // split the box with the largest colour range (among those that can be split)
    let pick = -1
    let pickScore = -1
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!
      if (box.length < 2) continue
      const score = rangeOf(box).range * Math.sqrt(box.reduce((s, e) => s + e.count, 0))
      if (score > pickScore) {
        pickScore = score
        pick = i
      }
    }
    if (pick < 0 || pickScore <= 0) break
    const box = boxes[pick]!
    const { ch } = rangeOf(box)
    box.sort((a, b) => chan(a.rgb, ch) - chan(b.rgb, ch) || a.rgb - b.rgb)
    const total = box.reduce((s, e) => s + e.count, 0)
    let acc = 0
    let cut = 1
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i]!.count
      cut = i + 1
      if (acc >= total / 2) break
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut))
  }
  const colors = new Set<number>()
  for (const box of boxes) {
    let r = 0
    let g = 0
    let b = 0
    let total = 0
    for (const e of box) {
      r += chan(e.rgb, 0) * e.count
      g += chan(e.rgb, 1) * e.count
      b += chan(e.rgb, 2) * e.count
      total += e.count
    }
    colors.add(packRgba(r / total, g / total, b / total))
  }
  return [...colors].sort((a, b) => a - b)
}

// ---------------------------------------------------------------- remap and dithering

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * Snap every opaque pixel to the nearest palette colour (perceptual distance). Transparent pixels are
 * left alone and are never dithered (no pattern on them, and no error is carried into or out of them).
 * `img` is changed in place.
 */
export function remapToPalette(img: Raster, palette: number[], dither: DitherMode = 'none'): void {
  if (palette.length === 0) throw new Error('The palette is empty.')
  const match = createPaletteMatcher(palette, 'perceptual')
  const { width: w, height: h, data } = img
  const pick = (r: number, g: number, b: number): number => palette[match(packRgba(r, g, b))]!
  if (dither === 'none' || palette.length === 1) {
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!
      if (c >>> 24 !== 0) data[i] = palette[match(c)]!
    }
    return
  }
  if (dither === 'ordered') {
    const spread = Math.max(16, Math.min(96, (255 / Math.cbrt(palette.length)) * 0.6))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = data[i]!
        if (c >>> 24 === 0) continue
        const t = (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5
        const [r, g, b] = unpackRgba(c)
        data[i] = pick(clampByte(r + t * spread), clampByte(g + t * spread), clampByte(b + t * spread))
      }
    }
    return
  }
  // floyd-steinberg, serpentine
  const err = new Float64Array(w * h * 3)
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x]! >>> 24 !== 0
  const spill = (x: number, y: number, k: number, er: number, eg: number, eb: number): void => {
    if (!opaque(x, y)) return
    const o = (y * w + x) * 3
    err[o]! += er * k
    err[o + 1]! += eg * k
    err[o + 2]! += eb * k
  }
  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0
    for (let step = 0; step < w; step++) {
      const x = ltr ? step : w - 1 - step
      const i = y * w + x
      const c = data[i]!
      if (c >>> 24 === 0) continue
      const o = i * 3
      const [r0, g0, b0] = unpackRgba(c)
      const r = clampByte(r0 + err[o]!)
      const g = clampByte(g0 + err[o + 1]!)
      const b = clampByte(b0 + err[o + 2]!)
      const chosen = pick(r, g, b)
      data[i] = chosen
      const [cr, cg, cb] = unpackRgba(chosen)
      const er = r - cr
      const eg = g - cg
      const eb = b - cb
      const dir = ltr ? 1 : -1
      spill(x + dir, y, 7 / 16, er, eg, eb)
      spill(x - dir, y + 1, 3 / 16, er, eg, eb)
      spill(x, y + 1, 5 / 16, er, eg, eb)
      spill(x + dir, y + 1, 1 / 16, er, eg, eb)
    }
  }
}

// ---------------------------------------------------------------- cleanup

/**
 * Remove orphan single pixels: an opaque pixel with no opaque neighbour (8-connected) becomes transparent;
 * an opaque pixel that shares its colour with none of its neighbours takes the most common neighbour
 * colour. Returns the number of changed pixels. Diagonal 1 px lines survive (the diagonal neighbours
 * count).
 */
export function cleanupOrphans(img: Raster, opts: { colors?: boolean } = {}): number {
  const { width: w, height: h } = img
  const src = img.data.slice()
  let changed = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = src[y * w + x]!
      if (c >>> 24 === 0) continue
      let opaqueN = 0
      let same = 0
      const tally = new Map<number, number>()
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const n = src[ny * w + nx]!
          if (n >>> 24 === 0) continue
          opaqueN++
          if (n === c) same++
          tally.set(n, (tally.get(n) ?? 0) + 1)
        }
      }
      if (opaqueN === 0) {
        img.data[y * w + x] = TRANSPARENT
        changed++
      } else if (opts.colors !== false && same === 0) {
        let best = c
        let bestN = 0
        for (const [col, n] of tally) {
          if (n > bestN) {
            best = col
            bestN = n
          }
        }
        img.data[y * w + x] = best
        changed++
      }
    }
  }
  return changed
}

// ---------------------------------------------------------------- the pipeline

export interface ConvertOptions extends TargetSizeOptions {
  /** Packed opaque colours to use. Without it a palette of at most `maxColors` is derived (median cut). */
  palette?: number[]
  /** Colours of the derived palette (default 32). */
  maxColors?: number
  dither?: DitherMode
  /** true: the darkest palette colour; a packed colour: that colour. */
  outline?: boolean | number
  /** Remove orphan pixels (default true). Colour specks are only fixed when dither is 'none'. */
  cleanup?: boolean
  /** Pixels with alpha below this (0..255) become fully transparent, the rest fully opaque (default 128). */
  alphaThreshold?: number
}

export interface ConvertResult {
  raster: Raster
  /** The palette used (given or derived), plus the outline colour when it was not in it. */
  palette: number[]
  /** Distinct opaque colours in the result. */
  colors: number
  transparentPixels: number
  /** Pixels changed by the cleanup. */
  cleaned: number
}

function luminance(c: number): number {
  const [r, g, b] = unpackRgba(c)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function convertImage(src: RgbaImage, opts: ConvertOptions = {}): ConvertResult {
  const { width, height } = resolveTargetSize(src.width, src.height, opts)
  const small = areaResize(src, width, height)
  const threshold = opts.alphaThreshold ?? 128
  for (let i = 0; i < small.data.length; i++) {
    const c = small.data[i]!
    const a = c >>> 24
    small.data[i] = a < threshold || a === 0 ? TRANSPARENT : (c | 0xff000000) >>> 0
  }
  const raster: Raster = { width, height, data: small.data }

  let palette: number[]
  if (opts.palette && opts.palette.length > 0) palette = opts.palette.map((c) => (c | 0xff000000) >>> 0)
  else palette = medianCutPalette(raster.data, opts.maxColors ?? 32)
  if (palette.length === 0) palette = [packRgba(0, 0, 0)] // fully transparent image: nothing will be mapped

  const dither = opts.dither ?? 'none'
  remapToPalette(raster, palette, dither)

  let cleaned = 0
  if (opts.cleanup !== false) cleaned = cleanupOrphans(raster, { colors: dither === 'none' })

  if (opts.outline) {
    let color: number
    if (typeof opts.outline === 'number') color = (opts.outline | 0xff000000) >>> 0
    else color = palette.reduce((best, c) => (luminance(c) < luminance(best) ? c : best), palette[0]!)
    outlineRaster(raster, color)
    if (!palette.includes(color)) palette = [...palette, color]
  }

  const used = new Set<number>()
  let transparentPixels = 0
  for (let i = 0; i < raster.data.length; i++) {
    const c = raster.data[i]!
    if (c >>> 24 === 0) transparentPixels++
    else used.add(c)
  }
  return { raster, palette, colors: used.size, transparentPixels, cleaned }
}

// ---------------------------------------------------------------- export

export interface FrameImageOptions {
  /** Exact output size (nearest neighbour). Both given: they override `scale`. */
  width?: number
  height?: number
  /** Integer upscale factor (default 1). */
  scale?: number
  layerIds?: string[]
  includeHidden?: boolean
  includeReference?: boolean
}

/** The frame with the visible layers flattened (reference layers excluded), at the requested size. */
export function frameImage(doc: Document, frameId: string, opts: FrameImageOptions = {}): RgbaImage {
  const flat: RgbaImage = {
    width: doc.width,
    height: doc.height,
    data: flattenFrame(doc, frameId, { layerIds: opts.layerIds, includeHidden: opts.includeHidden, includeReference: opts.includeReference })
  }
  let w: number
  let h: number
  if (opts.width !== undefined && opts.height !== undefined) {
    w = opts.width
    h = opts.height
  } else if (opts.width !== undefined) {
    w = opts.width
    h = Math.round((doc.height * opts.width) / doc.width)
  } else if (opts.height !== undefined) {
    h = opts.height
    w = Math.round((doc.width * opts.height) / doc.height)
  } else {
    const s = Math.max(1, Math.floor(opts.scale ?? 1))
    w = doc.width * s
    h = doc.height * s
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_EXPORT_SIDE || h > MAX_EXPORT_SIDE) {
    throw new Error(`Invalid export size ${w}x${h}: width and height must be whole numbers from 1 to ${MAX_EXPORT_SIDE}.`)
  }
  return resizeNearest(flat, w, h)
}

/** Raster of a whole image, for tests and tools. */
export function rasterOf(img: RgbaImage): Raster {
  const r = createRaster(img.width, img.height)
  r.data.set(img.data)
  return r
}

