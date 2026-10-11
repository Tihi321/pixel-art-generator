import { describe, expect, it } from 'vitest'
import {
  type Grid,
  GridError,
  applyGrid,
  createRaster,
  getBuiltinPalette,
  hexToRgba,
  packRgba,
  parseGrid,
  readGrid,
  setPixels,
  validateGrid
} from '../../src/core'

const grid: Grid = {
  legend: { '.': null, k: '#1a1c2c', s: '#f4b41b' },
  rows: ['..kk..', '.kssk.', '..kk..']
}

describe('gridText', () => {
  it('parses a grid into packed pixels', () => {
    const p = parseGrid(grid)
    expect([p.width, p.height]).toEqual([6, 3])
    expect(p.pixels[2]).toBe(hexToRgba('#1a1c2c'))
    expect(p.pixels[0]).toBe(0)
    expect(p.opaque[2]).toBe(1)
    expect(p.opaque[0]).toBe(0)
  })

  it('treats "." and space as transparent without a legend entry', () => {
    const p = parseGrid({ legend: { a: '#fff' }, rows: ['a. a'] })
    expect(Array.from(p.opaque)).toEqual([1, 0, 0, 1])
  })

  it('applies to a raster at an offset, with skip vs clear semantics and clipping', () => {
    const img = createRaster(8, 4)
    const red = packRgba(255, 0, 0)
    setPixels(img, [{ x: 2, y: 1, color: red }])
    const r1 = applyGrid(img, grid, 1, 0)
    expect(r1.dirty).toEqual({ x: 2, y: 0, w: 4, h: 3 })
    expect(img.data[0 * 8 + 3]).toBe(hexToRgba('#1a1c2c'))
    const img2 = createRaster(8, 4)
    setPixels(img2, [{ x: 1, y: 0, color: red }])
    applyGrid(img2, grid, 1, 0, { transparent: 'skip' })
    expect(img2.data[1]).toBe(red)
    applyGrid(img2, grid, 1, 0, { transparent: 'clear' })
    expect(img2.data[1]).toBe(0)

    const img3 = createRaster(4, 3)
    const clipped = applyGrid(img3, grid, 2, 0)
    expect(clipped.clipped).toBeGreaterThan(0)
  })

  it('round-trips write -> read -> write', () => {
    const img = createRaster(6, 3)
    applyGrid(img, grid, 0, 0)
    const read = readGrid(img, { x: 0, y: 0, w: 6, h: 3 })
    expect(read.rows[0]).toBe('..00..')
    expect(read.rows[1]![0]).toBe('.')
    const img2 = createRaster(6, 3)
    applyGrid(img2, { legend: read.legend, rows: read.rows }, 0, 0)
    expect(Array.from(img2.data)).toEqual(Array.from(img.data))
    expect(read.legend['.']).toBeNull()
    expect(Object.values(read.legend).filter((v) => v !== null).sort()).toEqual(['#1a1c2c', '#f4b41b'])
  })

  it('prefers stable palette-index characters and exposes color names', () => {
    const pico = getBuiltinPalette('pico-8')!
    const img = createRaster(3, 1)
    setPixels(img, [
      { x: 0, y: 0, color: hexToRgba('#ff004d') }, // pico red, index 8
      { x: 1, y: 0, color: hexToRgba('#010203') }, // not in palette
      { x: 2, y: 0, color: hexToRgba('#000000') } // pico black, index 0
    ])
    const r = readGrid(img, { x: 0, y: 0, w: 3, h: 1 }, { palette: pico })
    expect(r.rows[0]![0]).toBe('8')
    expect(r.rows[0]![2]).toBe('0')
    expect(r.names['8']).toBe('red')
    expect(r.rows[0]![1]).not.toBe('8')
    expect(r.rows[0]![1]).not.toBe('0')
  })

  it('keeps characters from a provided legend', () => {
    const img = createRaster(2, 1)
    setPixels(img, [{ x: 0, y: 0, color: hexToRgba('#112233') }, { x: 1, y: 0, color: hexToRgba('#445566') }])
    const r = readGrid(img, { x: 0, y: 0, w: 2, h: 1 }, { legend: { z: '#445566' } })
    expect(r.rows[0]![1]).toBe('z')
  })

  it('errors when a region has more than 62 colors', () => {
    const img = createRaster(64, 1)
    setPixels(img, Array.from({ length: 64 }, (_, i) => ({ x: i, y: 0, color: packRgba(i * 3, 10, 10) })))
    expect(() => readGrid(img, { x: 0, y: 0, w: 64, h: 1 })).toThrow(/64 distinct colors.*at most 62/)
    expect(readGrid(img, { x: 0, y: 0, w: 62, h: 1 }).rows[0]).toHaveLength(62)
  })

  it('reports line/col errors that help an LLM fix the input', () => {
    const bad: Grid = { legend: { k: '#000', s: 'red' }, rows: ['kk.', 'kqk.', 'k'] }
    const issues = validateGrid(bad)
    const text = issues.map((i) => i.message).join('\n')
    expect(text).toMatch(/Legend "s" has invalid color "red"/)
    expect(issues.find((i) => i.row === 2 && i.col === 2)?.message).toMatch(/"q" \(x=1, y=1\) is not in the legend.*"k", "s"/)
    expect(issues.find((i) => i.row === 2 && i.col === undefined)?.message).toMatch(/4 characters but row 1 has 3/)
    expect(issues.find((i) => i.row === 3 && i.col === undefined)?.message).toMatch(/1 characters but row 1 has 3/)
    try {
      parseGrid(bad)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(GridError)
      expect((e as Error).message).toMatch(/Row 2, col 2/)
    }
    expect(validateGrid({ legend: {}, rows: [] })[0]!.message).toMatch(/non-empty array/)
    expect(validateGrid({ legend: { ab: '#000' }, rows: ['.'] })[0]!.message).toMatch(/exactly one character/)
  })
})
