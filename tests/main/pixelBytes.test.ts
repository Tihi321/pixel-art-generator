import { describe, expect, it } from 'vitest'
import { bgraToPacked, rgbaBytesToPacked } from '../../src/main/pixelBytes'

describe('pixelBytes', () => {
  it('turns BGRA bytes into packed 0xAABBGGRR, alpha 0 into 0', () => {
    const bgra = Uint8Array.from([30, 20, 10, 255, 99, 99, 99, 0, 3, 2, 1, 128])
    const out = bgraToPacked(bgra, 3, 1)
    expect(out[0]).toBe(((255 << 24) | (30 << 16) | (20 << 8) | 10) >>> 0)
    expect(out[1]).toBe(0)
    expect(out[2]).toBe(((128 << 24) | (3 << 16) | (2 << 8) | 1) >>> 0)
  })
  it('turns RGBA bytes into packed 0xAABBGGRR, alpha 0 into 0', () => {
    const rgba = Uint8Array.from([10, 20, 30, 255, 7, 7, 7, 0])
    const out = rgbaBytesToPacked(rgba, 2, 1)
    expect(out[0]).toBe(((255 << 24) | (30 << 16) | (20 << 8) | 10) >>> 0)
    expect(out[1]).toBe(0)
  })
})
