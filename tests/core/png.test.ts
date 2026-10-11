import { describe, expect, it } from 'vitest'
import { zlibSync } from 'fflate'
import { base64ToBytes, bytesToBase64, decodePng, encodePng, hasPngSignature, packRgba, scaleImage } from '../../src/core'

function randomImage(w: number, h: number): { width: number; height: number; data: Uint32Array } {
  const data = new Uint32Array(w * h)
  let seed = 12345
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    data[i] = seed % 5 === 0 ? 0 : packRgba(seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, seed % 3 === 0 ? 128 : 255)
  }
  return { width: w, height: h, data }
}

describe('png', () => {
  it('encodes a valid PNG that decodes back identically', () => {
    const img = randomImage(13, 7)
    const bytes = encodePng(img)
    expect(hasPngSignature(bytes)).toBe(true)
    const back = decodePng(bytes)
    expect([back.width, back.height]).toEqual([13, 7])
    expect(Array.from(back.data)).toEqual(Array.from(img.data))
  })

  it('scales with nearest neighbour', () => {
    const img = { width: 2, height: 1, data: Uint32Array.of(packRgba(255, 0, 0), packRgba(0, 0, 255)) }
    const scaled = scaleImage(img, 3)
    expect([scaled.width, scaled.height]).toEqual([6, 3])
    expect(Array.from(scaled.data.subarray(0, 6))).toEqual([img.data[0], img.data[0], img.data[0], img.data[1], img.data[1], img.data[1]])
    const back = decodePng(encodePng(img, { scale: 3 }))
    expect(Array.from(back.data)).toEqual(Array.from(scaled.data))
  })

  it('decodes RGB (type 2) and indexed (type 3) PNGs with filters', () => {
    // Build raw PNGs by hand: 2x2, using filter types Sub (1) and Up (2) to exercise unfiltering.
    const makePng = (ihdrTail: number[], idatRaw: number[], extra: Array<[string, number[]]> = []): Uint8Array => {
      const chunk = (type: string, body: number[]): number[] => {
        const len = body.length
        const typeBytes = Array.from(type).map((c) => c.charCodeAt(0))
        // CRC is not verified by the decoder, but write zeros.
        return [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...typeBytes, ...body, 0, 0, 0, 0]
      }
      const ihdr = [0, 0, 0, 2, 0, 0, 0, 2, ...ihdrTail]
      const idat = Array.from(zlibSync(Uint8Array.from(idatRaw)))
      return Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10,
        ...chunk('IHDR', ihdr),
        ...extra.flatMap(([t, b]) => chunk(t, b)),
        ...chunk('IDAT', idat),
        ...chunk('IEND', [])
      ])
    }
    // RGB: row0 filter Sub: pixels (10,20,30) then (+1,+2,+3) => (11,22,33); row1 filter Up: adds row0.
    const rgb = decodePng(makePng([8, 2, 0, 0, 0], [1, 10, 20, 30, 1, 2, 3, 2, 5, 5, 5, 0, 0, 0]))
    expect(Array.from(rgb.data)).toEqual([
      packRgba(10, 20, 30),
      packRgba(11, 22, 33),
      packRgba(15, 25, 35),
      packRgba(11, 22, 33)
    ])
    // Indexed 2-bit: palette of 3, tRNS makes index 2 transparent. Rows: indices [0,1] and [2,1].
    const idx = decodePng(
      makePng(
        [2, 3, 0, 0, 0],
        [0, 0b00010000, 0, 0b10010000],
        [
          ['PLTE', [255, 0, 0, 0, 255, 0, 0, 0, 255]],
          ['tRNS', [255, 255, 0]]
        ]
      )
    )
    expect(Array.from(idx.data)).toEqual([packRgba(255, 0, 0), packRgba(0, 255, 0), 0, packRgba(0, 255, 0)])
  })

  it('rejects bad input with clear messages', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/Not a PNG/)
    const png = encodePng(randomImage(2, 2))
    png[8 + 8 + 8 + 4] = 1 // IHDR interlace? byte offset 12 within IHDR body -> set interlace
    expect(() => decodePng(png)).toThrow(/Interlaced/)
  })

  it('round-trips base64 without Buffer, for all remainder lengths', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 257]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)
      const text = bytesToBase64(bytes)
      expect(text).toBe(Buffer.from(bytes).toString('base64'))
      expect(Array.from(base64ToBytes(text))).toEqual(Array.from(bytes))
    }
    expect(Array.from(base64ToBytes('data:image/png;base64,AQID'))).toEqual([1, 2, 3])
    expect(() => base64ToBytes('@@@')).toThrow(/Invalid base64/)
  })
})
