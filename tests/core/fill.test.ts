import { describe, expect, it } from 'vitest'
import { type Raster, createRaster, drawGradient, drawPolygon, getPixel } from '../../src/core'
import { BLACK, BLUE, GREEN, RED } from './helpers'

function rows(img: Raster, ch = '#'): string[] {
  const out: string[] = []
  for (let y = 0; y < img.height; y++) {
    let s = ''
    for (let x = 0; x < img.width; x++) s += img.data[y * img.width + x] ? ch : '.'
    out.push(s)
  }
  return out
}

describe('drawPolygon', () => {
  it('fills a square exactly, vertices included', () => {
    const img = createRaster(6, 6)
    const r = drawPolygon(img, [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }], RED, { filled: true })
    expect(r).toEqual({ x: 1, y: 1, w: 4, h: 4 })
    expect(rows(img)).toEqual(['......', '.####.', '.####.', '.####.', '.####.', '......'])
  })

  it('draws only the outline when not filled', () => {
    const img = createRaster(5, 5)
    drawPolygon(img, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], RED)
    expect(rows(img)).toEqual(['#####', '#...#', '#...#', '#...#', '#####'])
  })

  it('draws every edge pixel of a filled triangle and leaves the outside empty', () => {
    const img = createRaster(10, 10)
    const pts = [{ x: 1, y: 8 }, { x: 8, y: 8 }, { x: 4, y: 1 }]
    drawPolygon(img, pts, RED, { filled: true })
    const line = createRaster(10, 10)
    drawPolygon(line, pts, RED)
    for (let i = 0; i < line.data.length; i++) if (line.data[i]) expect(img.data[i]).toBe(RED)
    expect(getPixel(img, 4, 5)).toBe(RED)
    expect(getPixel(img, 0, 0)).toBe(0)
    expect(getPixel(img, 9, 9)).toBe(0)
  })

  it('leaves no gap between two polygons that share an edge', () => {
    const img = createRaster(20, 12)
    // the shared edge runs (10,3) -> (5,11); everything between the outer edges must be painted
    drawPolygon(img, [{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 5, y: 11 }, { x: 0, y: 11 }], RED, { filled: true })
    drawPolygon(img, [{ x: 10, y: 3 }, { x: 19, y: 0 }, { x: 19, y: 11 }, { x: 5, y: 11 }], GREEN, { filled: true })
    for (let y = 3; y < 12; y++) for (let x = 0; x < 20; x++) expect(img.data[y * 20 + x], `${x},${y}`).not.toBe(0)
  })

  it('uses the even-odd rule for self-crossing outlines', () => {
    const img = createRaster(12, 12)
    // a big square and a smaller one inside it drawn as one path: the inside stays empty
    const pts = [{ x: 0, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 11 }, { x: 0, y: 11 }, { x: 0, y: 0 }, { x: 3, y: 3 }, { x: 8, y: 3 }, { x: 8, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 3 }]
    drawPolygon(img, pts, RED, { filled: true })
    expect(getPixel(img, 5, 5)).toBe(0)
    expect(getPixel(img, 1, 5)).toBe(RED)
  })

  it('draws a polyline when closed=false, clips to the canvas, and supports thickness', () => {
    const img = createRaster(8, 8)
    drawPolygon(img, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], RED, { closed: false })
    expect(getPixel(img, 3, 3)).toBe(0)
    expect(getPixel(img, 5, 3)).toBe(RED)
    const big = createRaster(8, 8)
    expect(drawPolygon(big, [{ x: -20, y: -20 }, { x: 30, y: -20 }, { x: 30, y: 30 }, { x: -20, y: 30 }], BLUE, { filled: true })).toEqual({ x: 0, y: 0, w: 8, h: 8 })
    expect(big.data.every((c) => c === BLUE)).toBe(true)
    const thick = createRaster(8, 8)
    drawPolygon(thick, [{ x: 1, y: 1 }, { x: 6, y: 1 }], RED, { closed: false, thickness: 2 })
    expect(rows(thick).slice(0, 4)).toEqual(['........', '.#######', '.#######', '........'])
  })
})

describe('drawGradient', () => {
  const stops = [{ color: RED }, { color: GREEN }, { color: BLUE }]
  const colorsOf = (img: Raster): Set<number> => new Set(img.data)

  it('only uses stop colors unless smooth', () => {
    for (const dither of ['none', 'ordered', 'ordered8', 'checker'] as const) {
      for (const direction of ['vertical', 'horizontal', 'diagonal', 'radial', 30] as const) {
        const img = createRaster(40, 30)
        expect(drawGradient(img, stops, { dither, direction })).toEqual({ x: 0, y: 0, w: 40, h: 30 })
        for (const c of colorsOf(img)) expect([RED, GREEN, BLUE], `${dither} ${direction}`).toContain(c)
      }
    }
    const smooth = createRaster(40, 30)
    drawGradient(smooth, stops, { dither: 'smooth' })
    expect(colorsOf(smooth).size).toBeGreaterThan(3)
  })

  it('runs top to bottom with hard bands and respects stop positions', () => {
    const img = createRaster(2, 10)
    drawGradient(img, [{ at: 0, color: RED }, { at: 0.5, color: GREEN }, { at: 1, color: BLUE }], { dither: 'none' })
    expect(getPixel(img, 0, 0)).toBe(RED)
    expect(getPixel(img, 0, 4)).toBe(GREEN)
    expect(getPixel(img, 1, 9)).toBe(BLUE)
    const h = createRaster(10, 2)
    drawGradient(h, [{ color: RED }, { color: BLUE }], { dither: 'none', direction: 'horizontal' })
    expect([getPixel(h, 0, 1), getPixel(h, 9, 0)]).toEqual([RED, BLUE])
    const a = createRaster(10, 10)
    drawGradient(a, [{ color: RED }, { color: BLUE }], { dither: 'none', direction: 90 })
    expect([getPixel(a, 3, 0), getPixel(a, 3, 9)]).toEqual([RED, BLUE])
    const rad = createRaster(21, 21)
    drawGradient(rad, [{ color: RED }, { color: BLUE }], { dither: 'none', direction: 'radial' })
    expect([getPixel(rad, 10, 10), getPixel(rad, 0, 10)]).toEqual([RED, BLUE])
  })

  it('has a stable ordered pattern that mixes the two colors', () => {
    const a = createRaster(8, 8)
    drawGradient(a, [{ color: RED }, { color: BLUE }], { dither: 'ordered', direction: 'horizontal' })
    const b = createRaster(8, 8)
    drawGradient(b, [{ color: RED }, { color: BLUE }], { dither: 'ordered', direction: 'horizontal' })
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
    expect(colorsOf(a).size).toBe(2)
    // inside a band between two stops the 4x4 Bayer pattern repeats every 4 pixels
    const flat = createRaster(8, 4)
    drawGradient(flat, [{ at: 0, color: RED }, { at: 1, color: BLUE }], { dither: 'ordered', direction: 'vertical', region: { x: 0, y: 0, w: 8, h: 40 } })
    expect(getPixel(flat, 0, 0)).toBe(getPixel(flat, 4, 0))
    expect(getPixel(flat, 1, 2)).toBe(getPixel(flat, 5, 2))
  })

  it('limits the region and honours masks', () => {
    const img = createRaster(6, 6)
    img.data[0] = BLACK
    expect(drawGradient(img, [{ color: RED }, { color: BLUE }], { region: { x: 1, y: 1, w: 3, h: 3 }, dither: 'none' })).toEqual({ x: 1, y: 1, w: 3, h: 3 })
    expect(getPixel(img, 0, 0)).toBe(BLACK)
    expect(getPixel(img, 4, 4)).toBe(0)

    const opaque = createRaster(4, 4)
    opaque.data[5] = BLACK
    expect(drawGradient(opaque, [{ color: RED }, { color: BLUE }], { mask: 'opaque', dither: 'none' })).toEqual({ x: 1, y: 1, w: 1, h: 1 })
    expect(Array.from(opaque.data).filter((c) => c !== 0)).toHaveLength(1)
    expect(opaque.data[5]).not.toBe(BLACK)

    const empty = createRaster(4, 4)
    empty.data[5] = BLACK
    drawGradient(empty, [{ color: RED }, { color: BLUE }], { mask: 'transparent', dither: 'none' })
    expect(empty.data[5]).toBe(BLACK)
    expect(empty.data.filter((c) => c === 0)).toHaveLength(0)
  })

  it('needs two stops and is clipped away when the region is off canvas', () => {
    expect(() => drawGradient(createRaster(2, 2), [{ color: RED }])).toThrow(/2 stops/)
    expect(drawGradient(createRaster(2, 2), stops, { region: { x: 5, y: 5, w: 2, h: 2 } })).toBeNull()
  })
})
