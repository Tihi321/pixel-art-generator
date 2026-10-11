import { describe, expect, it } from 'vitest'
import { encodeGif, packRgba } from '../../src/core'

const RED = packRgba(255, 0, 0)
const BLUE = packRgba(0, 0, 255)

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + len))
}

/** Count graphic control extensions (0x21 0xF9) to count frames, roughly. */
function countFrames(bytes: Uint8Array): number {
  let n = 0
  for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4) n++
  return n
}

describe('gif', () => {
  it('writes a GIF89a with the right size, frames, loop extension and trailer', () => {
    const w = 3
    const h = 2
    const a = new Uint32Array(w * h).fill(RED)
    const b = new Uint32Array(w * h).fill(BLUE)
    const res = encodeGif({ width: w, height: h, frames: [{ data: a, delayMs: 100 }, { data: b, delayMs: 200 }] })
    const bytes = res.bytes
    expect(ascii(bytes, 0, 6)).toBe('GIF89a')
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(w)
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(h)
    expect(bytes[bytes.length - 1]).toBe(0x3b)
    expect(countFrames(bytes)).toBe(2)
    expect(ascii(bytes, 0, bytes.length)).toContain('NETSCAPE2.0')
    expect(res.quantized).toBe(false)
    expect(res.hasTransparency).toBe(false)
  })

  it('applies scale, per-frame delay and transparency', () => {
    const data = Uint32Array.of(RED, 0, 0, BLUE)
    const res = encodeGif({ width: 2, height: 2, scale: 4, frames: [{ data, delayMs: 120 }], loop: false })
    const bytes = res.bytes
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(8)
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(8)
    expect(res.hasTransparency).toBe(true)
    expect(res.paletteSize).toBe(3) // transparent slot + 2 colors
    expect(ascii(bytes, 0, bytes.length)).not.toContain('NETSCAPE2.0') // play once: no loop extension
    // find the GCE: flags have the transparency bit, delay is 12 (1/100 s)
    const i = bytes.findIndex((v, k) => v === 0x21 && bytes[k + 1] === 0xf9)
    expect(bytes[i + 3]! & 1).toBe(1)
    expect(bytes[i + 4]! | (bytes[i + 5]! << 8)).toBe(12)
  })

  it('quantizes art with more than 256 colors', () => {
    const w = 64
    const h = 64
    const data = new Uint32Array(w * h)
    for (let i = 0; i < data.length; i++) data[i] = packRgba(i & 255, (i >> 8) * 16, (i * 5) & 255)
    const res = encodeGif({ width: w, height: h, frames: [{ data, delayMs: 50 }] })
    expect(res.quantized).toBe(true)
    expect(res.paletteSize).toBeLessThanOrEqual(256)
    expect(ascii(res.bytes, 0, 6)).toBe('GIF89a')
    expect(res.bytes[res.bytes.length - 1]).toBe(0x3b)
  })

  it('validates input', () => {
    expect(() => encodeGif({ width: 1, height: 1, frames: [] })).toThrow(/at least one frame/)
    expect(() => encodeGif({ width: 2, height: 2, frames: [{ data: new Uint32Array(3), delayMs: 10 }] })).toThrow(/size/)
  })
})
