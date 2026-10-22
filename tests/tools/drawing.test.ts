import { describe, expect, it } from 'vitest'
import { bytesToBase64, celKey, createRaster, encodePng, getPixel, hexToRgba, packRgba } from '../../src/core'
import { resultText } from '../../src/tools'
import { setup } from './helpers'

function pngOf(w: number, h: number, fn: (x: number, y: number) => number): Uint8Array {
  const data = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y)
  return encodePng({ width: w, height: h, data })
}

/** Pixel of the first layer's cel in the first frame. */
function px(t: ReturnType<typeof setup>, x: number, y: number): number {
  const cel = t.doc.cels.get(celKey(t.doc.layers[0]!.id, t.doc.frames[0]!.id))
  if (!cel) return 0
  const img = createRaster(t.doc.width, t.doc.height)
  for (let j = 0; j < cel.h; j++) {
    for (let i = 0; i < cel.w; i++) {
      const X = cel.x + i
      const Y = cel.y + j
      if (X >= 0 && Y >= 0 && X < img.width && Y < img.height) img.data[Y * img.width + X] = cel.data[j * cel.w + i]!
    }
  }
  return getPixel(img, x, y)
}

const RED = hexToRgba('#ff0000')
const BLUE = hexToRgba('#0000ff')
const GREEN = hexToRgba('#00ff00')

describe('draw_polygon', () => {
  it('fills a polygon in one undo step', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    await t.ok('draw_polygon', { points: [[2, 2], [9, 2], { x: 9, y: 9 }, [2, 9]], color: '#ff0000', filled: true })
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    expect(px(t, 5, 5)).toBe(RED)
    expect(px(t, 9, 9)).toBe(RED)
    expect(px(t, 10, 10)).toBe(0)
    await t.ok('undo')
    expect(px(t, 5, 5)).toBe(0)
  })

  it('rejects fewer than 2 points', async () => {
    const t = setup()
    const r = await t.call('draw_polygon', { points: [[1, 1]], color: 1 })
    expect(r.isError).toBe(true)
  })
})

describe('draw_gradient', () => {
  it('paints the whole canvas with stop colors in one undo step', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    await t.ok('draw_gradient', { stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }], dither: 'none' })
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    expect(px(t, 3, 0)).toBe(RED)
    expect(px(t, 3, 15)).toBe(BLUE)
  })

  it('mask "transparent" keeps drawn pixels', async () => {
    const t = setup()
    await t.ok('draw_rect', { x: 0, y: 0, w: 4, h: 4, color: '#00ff00', filled: true })
    await t.ok('draw_gradient', { stops: [{ color: '#ff0000' }, { color: '#0000ff' }], mask: 'transparent', dither: 'none' })
    expect(px(t, 1, 1)).toBe(GREEN)
    expect(px(t, 8, 0)).toBe(RED)
  })
})

describe('draw_image', () => {
  const colors = (x: number, y: number): number => (x < 2 ? packRgba(255, 0, 0) : y < 2 ? packRgba(0, 0, 255) : 0)

  it('draws a base64 PNG (with data URL prefix) in one undo step and reports colors outside the palette', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    const b64 = bytesToBase64(pngOf(4, 4, colors))
    const r = await t.ok('draw_image', { png: `data:image/png;base64,${b64}`, x: 3, y: 5 })
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    expect(px(t, 3, 5)).toBe(RED)
    expect(px(t, 5, 5)).toBe(BLUE)
    expect(px(t, 5, 7)).toBe(0)
    expect(resultText(r)).toMatch(/2 color\(s\) are not in the document palette/)
    await t.ok('undo')
    expect(px(t, 3, 5)).toBe(0)
  })

  it('draws a file from the memory services; transparent pixels skip or clear', async () => {
    const t = setup()
    t.services.files.set('/in/fg.png', pngOf(4, 4, colors))
    await t.ok('draw_rect', { x: 0, y: 0, w: 16, h: 16, color: '#00ff00', filled: true })
    await t.ok('draw_image', { path: '/in/fg.png' })
    expect(px(t, 0, 0)).toBe(RED)
    expect(px(t, 3, 3)).toBe(GREEN)
    await t.ok('draw_image', { path: '/in/fg.png', transparent: 'clear' })
    expect(px(t, 3, 3)).toBe(0)
    expect(px(t, 8, 8)).toBe(GREEN)
  })

  it('uses binary alpha by default and snap "palette" uses only palette colors', async () => {
    const t = setup()
    t.services.files.set('/in/a.png', pngOf(2, 1, (x) => (x === 0 ? packRgba(250, 10, 10, 200) : packRgba(250, 10, 10, 50))))
    const r = await t.ok('draw_image', { path: '/in/a.png', snap: 'palette' })
    expect(resultText(r)).not.toMatch(/not in the document palette/)
    const first = px(t, 0, 0)
    expect(first >>> 24).toBe(255)
    expect(t.doc.palette.colors.map((c) => hexToRgba(c.hex))).toContain(first)
    expect(px(t, 1, 0)).toBe(0)
  })

  it('reports readable errors', async () => {
    const t = setup()
    const both = await t.call('draw_image', { png: 'AAAA', path: '/x.png' })
    expect(both.isError).toBe(true)
    expect(resultText(both)).toMatch(/exactly one of "png"/)
    expect((await t.call('draw_image', {})).isError).toBe(true)
    const bad = await t.call('draw_image', { png: '!!!not base64!!!' })
    expect(bad.isError).toBe(true)
    expect(resultText(bad)).toMatch(/not a valid base64-encoded PNG/)
    const notPng = await t.call('draw_image', { png: bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])) })
    expect(notPng.isError).toBe(true)
    expect(resultText(notPng)).toMatch(/not a valid base64-encoded PNG/)
    expect((await t.call('draw_image', { path: '/missing.png' })).isError).toBe(true)
  })
})

describe('draw_grid limit', () => {
  it('accepts a 200x100 grid and rejects more than 256 columns or rows', async () => {
    const t = setup({ width: 300, height: 300 })
    await t.ok('draw_grid', { rows: Array.from({ length: 100 }, () => '1'.repeat(200)) })
    expect(px(t, 199, 99)).not.toBe(0)
    expect(px(t, 200, 99)).toBe(0)
    expect((await t.call('draw_grid', { rows: ['1'.repeat(257)] })).isError).toBe(true)
    expect((await t.call('draw_grid', { rows: Array.from({ length: 257 }, () => '1') })).isError).toBe(true)
  })
})
