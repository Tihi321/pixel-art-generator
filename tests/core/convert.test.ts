import { describe, expect, it } from 'vitest'
import {
  type RgbaImage,
  areaResize,
  cleanupOrphans,
  convertImage,
  createDocument,
  createRaster,
  frameImage,
  hexToRgba,
  medianCutPalette,
  packRgba,
  resizeNearest,
  resolveTargetSize,
  celKey
} from '../../src/core'

const PALETTE = ['#101020', '#d04040', '#40b040', '#4040d0', '#f0f0a0'].map((h) => hexToRgba(h))

/** A 120x90 test picture: a smooth gradient, a transparent border and a semi-transparent halo. */
function picture(): RgbaImage {
  const w = 120
  const h = 90
  const data = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x < 12 || y < 9 || x >= w - 12 || y >= h - 9
      if (edge) continue // transparent
      const halo = x < 18 || y < 15 || x >= w - 18 || y >= h - 15
      data[y * w + x] = packRgba(Math.round((x / w) * 255), Math.round((y / h) * 255), 140 + ((x * 7 + y * 3) % 40), halo ? 100 : 255)
    }
  }
  return { width: w, height: h, data }
}

describe('resolveTargetSize', () => {
  it('keeps the aspect ratio when only one side is given', () => {
    expect(resolveTargetSize(1920, 1080, { width: 320 })).toEqual({ width: 320, height: 180 })
    expect(resolveTargetSize(1920, 1080, { height: 90 })).toEqual({ width: 160, height: 90 })
  })
  it('uses scale and explicit sizes, and rejects more than 2048', () => {
    expect(resolveTargetSize(640, 360, { scale: 2 })).toEqual({ width: 320, height: 180 })
    expect(resolveTargetSize(100, 100, { width: 64, height: 96 })).toEqual({ width: 64, height: 96 })
    expect(resolveTargetSize(1920, 1080, {})).toEqual({ width: 1920, height: 1080 })
    expect(resolveTargetSize(4000, 2000, { width: 2048, height: 1024 })).toEqual({ width: 2048, height: 1024 })
    expect(() => resolveTargetSize(4000, 3000, {})).toThrow(/max 2048x2048/)
    expect(() => resolveTargetSize(100, 100, { width: 2049, height: 10 })).toThrow(/max 2048x2048/)
  })
  it('refuses a source above 16384 px a side or 64 megapixels', () => {
    expect(() => resolveTargetSize(16385, 100, { width: 10 })).toThrow(/source image is too large/)
    expect(() => resolveTargetSize(9000, 9000, { width: 10 })).toThrow(/source image is too large/)
    expect(resolveTargetSize(8000, 8000, { width: 10 })).toEqual({ width: 10, height: 10 })
  })
})

describe('large imports', () => {
  it('converts a 2048x1152 image at full size', () => {
    const w = 2048
    const h = 1152
    const data = new Uint32Array(w * h)
    for (let i = 0; i < data.length; i++) {
      const x = i % w
      const y = (i / w) | 0
      data[i] = packRgba((x * 255) / w, (y * 255) / h, (x * 3 + y * 5) % 256)
    }
    const t0 = Date.now()
    const res = convertImage({ width: w, height: h, data }, { width: w, height: h, maxColors: 32, dither: 'floyd' })
    console.log(`convertImage 2048x1152 floyd: ${Date.now() - t0} ms`)
    expect(res.raster.width).toBe(w)
    expect(res.raster.height).toBe(h)
    expect(res.colors).toBeLessThanOrEqual(32)
  }, 60_000)
})

describe('areaResize', () => {
  it('averages colours weighted by alpha, so transparent pixels do not darken the edge', () => {
    const img: RgbaImage = { width: 2, height: 1, data: Uint32Array.from([packRgba(255, 0, 0, 255), 0]) }
    const out = areaResize(img, 1, 1)
    const c = out.data[0]!
    expect(c & 255).toBe(255) // still pure red
    expect(c >>> 24).toBe(128) // half covered
  })
})

describe('convertImage', () => {
  it('outputs only palette colours, at the exact size, with thresholded alpha', () => {
    const r = convertImage(picture(), { width: 40, height: 30, palette: PALETTE, alphaThreshold: 128 })
    expect(r.raster.width).toBe(40)
    expect(r.raster.height).toBe(30)
    const allowed = new Set(PALETTE)
    let transparent = 0
    for (const c of r.raster.data) {
      if (c >>> 24 === 0) transparent++
      else {
        expect(c >>> 24).toBe(255)
        expect(allowed.has(c)).toBe(true)
      }
    }
    expect(transparent).toBe(r.transparentPixels)
    expect(transparent).toBeGreaterThan(0)
    expect(r.raster.data[0]).toBe(0) // the transparent border stays transparent
    expect(r.colors).toBeLessThanOrEqual(PALETTE.length)
    // the semi-transparent halo (alpha 100) falls under the threshold, the core stays
    expect(r.raster.data[15 * 40 + 20]! >>> 24).toBe(255)
  })

  it('never dithers transparent pixels and still only uses palette colours', () => {
    for (const dither of ['ordered', 'floyd'] as const) {
      const r = convertImage(picture(), { width: 60, height: 45, palette: PALETTE, dither })
      const none = convertImage(picture(), { width: 60, height: 45, palette: PALETTE, dither: 'none' })
      const allowed = new Set(PALETTE)
      for (let i = 0; i < r.raster.data.length; i++) {
        const c = r.raster.data[i]!
        // the same pixels are transparent with and without dithering
        expect(c >>> 24 === 0).toBe(none.raster.data[i]! >>> 24 === 0)
        if (c >>> 24 !== 0) expect(allowed.has(c)).toBe(true)
      }
      expect(Array.from(r.raster.data)).not.toEqual(Array.from(none.raster.data))
    }
  })

  it('derives a palette of at most maxColors when none is given', () => {
    const r = convertImage(picture(), { width: 60, height: 45, maxColors: 6 })
    expect(r.palette.length).toBeLessThanOrEqual(6)
    expect(r.colors).toBeLessThanOrEqual(6)
    expect(r.colors).toBeGreaterThan(1)
    expect(medianCutPalette(picture().data, 4).length).toBeLessThanOrEqual(4)
  })

  it('cleans up orphan pixels', () => {
    // a 9x9 image: a green block with one red speck inside and one opaque speck outside, on transparent
    const w = 9
    const data = new Uint32Array(w * w)
    const green = PALETTE[2]!
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) data[y * w + x] = green
    data[3 * w + 3] = PALETTE[1]! // colour speck inside
    data[8 * w + 8] = PALETTE[3]! // isolated opaque pixel
    const img: RgbaImage = { width: w, height: w, data }
    const kept = convertImage(img, { width: w, height: w, palette: PALETTE, cleanup: false })
    expect(kept.raster.data[3 * w + 3]).toBe(PALETTE[1])
    expect(kept.raster.data[8 * w + 8]).toBe(PALETTE[3])
    const clean = convertImage(img, { width: w, height: w, palette: PALETTE })
    expect(clean.raster.data[3 * w + 3]).toBe(green)
    expect(clean.raster.data[8 * w + 8]! >>> 24).toBe(0)
    expect(clean.cleaned).toBe(2)
    // a 1 px diagonal line is not orphan pixels
    const line = createRaster(6, 6)
    for (let i = 0; i < 6; i++) line.data[i * 6 + i] = green
    expect(cleanupOrphans(line)).toBe(0)
  })

  it('adds a 1 px outline in the darkest palette colour, or a given colour', () => {
    const w = 8
    const data = new Uint32Array(w * w)
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) data[y * w + x] = PALETTE[4]!
    const img: RgbaImage = { width: w, height: w, data }
    const r = convertImage(img, { width: w, height: w, palette: PALETTE, outline: true })
    expect(r.raster.data[1 * w + 3]).toBe(PALETTE[0]) // above the block
    expect(r.raster.data[3 * w + 1]).toBe(PALETTE[0]) // left of it
    expect(r.raster.data[3 * w + 3]).toBe(PALETTE[4]) // inside is untouched
    expect(r.raster.data[0]! >>> 24).toBe(0) // two pixels away: nothing
    const custom = convertImage(img, { width: w, height: w, palette: PALETTE, outline: hexToRgba('#ff00ff') })
    expect(custom.raster.data[1 * w + 3]).toBe(hexToRgba('#ff00ff'))
    expect(custom.palette).toContain(hexToRgba('#ff00ff'))
  })
})

describe('exact-size export', () => {
  it('scales 320x180 to exactly 1920x1080 with nearest neighbour', () => {
    const doc = createDocument({ width: 320, height: 180, name: 'bg' })
    const data = new Uint32Array(320 * 180)
    for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) data[y * 320 + x] = packRgba(x % 256, y, 7)
    doc.cels.set(celKey(doc.layers[0]!.id, doc.frames[0]!.id), { x: 0, y: 0, w: 320, h: 180, data })
    const img = frameImage(doc, doc.frames[0]!.id, { width: 1920, height: 1080 })
    expect(img.width).toBe(1920)
    expect(img.height).toBe(1080)
    // 6x: every 6x6 block is one source pixel
    expect(img.data[0]).toBe(data[0])
    expect(img.data[5 * 1920 + 5]).toBe(data[0])
    expect(img.data[6]).toBe(data[1])
    expect(img.data[1079 * 1920 + 1919]).toBe(data[179 * 320 + 319])
  })

  it('allows non-integer ratios', () => {
    const img: RgbaImage = { width: 3, height: 1, data: Uint32Array.from([1, 2, 3].map((v) => packRgba(v, 0, 0))) }
    const out = resizeNearest(img, 5, 2)
    expect(out.width).toBe(5)
    expect(out.height).toBe(2)
    expect(Array.from(out.data.slice(0, 5)).map((c) => c & 255)).toEqual([1, 1, 2, 3, 3])
  })

  it('keeps the aspect ratio with only a width and rejects bad sizes', () => {
    const doc = createDocument({ width: 16, height: 9, name: 'x' })
    expect(frameImage(doc, doc.frames[0]!.id, { width: 160 }).height).toBe(90)
    expect(() => frameImage(doc, doc.frames[0]!.id, { width: 100, height: 100000 })).toThrow(/Invalid export size/)
  })
})
