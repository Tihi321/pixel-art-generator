import { describe, expect, it } from 'vitest'
import { celKey, celToRaster, getPixel, hexToRgba } from '../../src/core'
import { resultText } from '../../src/tools'
import { jsonOf, setup } from './helpers'

function pixel(t: ReturnType<typeof setup>, x: number, y: number, layer = 0): number {
  const doc = t.doc
  const img = celToRaster(doc.cels.get(celKey(doc.layers[layer]!.id, doc.frames[0]!.id)), doc.width, doc.height)
  return getPixel(img, x, y)
}

describe('draw_ui_element', () => {
  it('draws a textbox on a fresh document and reports the Ren\'Py Frame borders as JSON', async () => {
    const t = setup({ width: 320, height: 80 })
    const d0 = t.session.history.undoDepth
    const r = await t.ok('draw_ui_element', { kind: 'textbox', x: 0, y: 0, w: 320, h: 64, label: 'Hello there.' })
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    const json = jsonOf(r) as { rect: unknown; nineSlice: { left: number; top: number; right: number; bottom: number }; renpy: string; kind: string }
    expect(json.rect).toEqual({ x: 0, y: 0, w: 320, h: 64 })
    expect(json.kind).toBe('textbox')
    const n = json.nineSlice
    expect(n.left).toBeGreaterThanOrEqual(2)
    expect(json.renpy).toBe(`Frame("textbox.png", ${n.left}, ${n.top}, ${n.right}, ${n.bottom})`)
    expect(resultText(r)).toContain(json.renpy)
    // the middle is painted, and the borders really are the non-varying part
    expect(pixel(t, 160, 32)).not.toBe(0)
    for (let x = n.left; x < 320 - n.right; x++) expect(pixel(t, x, 30)).toBe(pixel(t, n.left, 30))
    await t.ok('undo')
    expect(pixel(t, 160, 32)).toBe(0)
  })

  it('applies style colors and state, and names the state in the Frame snippet', async () => {
    const t = setup({ width: 64, height: 32 })
    const r = await t.ok('draw_ui_element', {
      kind: 'button', x: 4, y: 4, w: 40, h: 16, state: 'hover', label: 'Go',
      style: { fill: '#336699', border: '#000000', light: '#ffffff', dark: '#111111', hoverFill: '#6699cc', corner: 'square', borderWidth: 1 }
    })
    expect(pixel(t, 24, 8)).toBe(hexToRgba('#6699cc'))
    expect(pixel(t, 4, 4)).toBe(hexToRgba('#000000'))
    expect((jsonOf(r) as { renpy: string }).renpy).toMatch(/^Frame\("button_hover\.png", 2, 2, 2, 2\)$/)
  })

  it('draws on a chosen layer and frame', async () => {
    const t = setup({ width: 32, height: 24 })
    await t.ok('add_layer', { name: 'UI' })
    await t.ok('draw_ui_element', { kind: 'panel', x: 2, y: 2, w: 20, h: 16, layer: 'UI' })
    expect(pixel(t, 10, 10, 1)).not.toBe(0)
    expect(pixel(t, 10, 10, 0)).toBe(0)
  })

  it('notes that state only applies to buttons and that an oversized label does not fit', async () => {
    const t = setup({ width: 64, height: 32 })
    const a = await t.ok('draw_ui_element', { kind: 'panel', x: 0, y: 0, w: 30, h: 20, state: 'pressed' })
    expect(resultText(a)).toContain('state only applies to buttons')
    const b = await t.ok('draw_ui_element', { kind: 'button', x: 0, y: 0, w: 20, h: 12, label: 'A very long label' })
    expect(resultText(b)).toContain('label is larger')
    expect((jsonOf(b) as { labelFits: boolean }).labelFits).toBe(false)
  })

  it('errors readably when too small and rejects unknown kinds', async () => {
    const t = setup()
    const small = await t.call('draw_ui_element', { kind: 'textbox', x: 0, y: 0, w: 5, h: 5, style: { inset: 3 } })
    expect(small.isError).toBe(true)
    expect(resultText(small)).toMatch(/needs at least/)
    const bad = await t.call('draw_ui_element', { kind: 'toolbar', x: 0, y: 0, w: 20, h: 10 })
    expect(bad.isError).toBe(true)
  })
})

describe('draw_nine_slice', () => {
  async function frame16(t: ReturnType<typeof setup>): Promise<void> {
    // a 16x16 hand-drawn-ish frame at (0,0): 4 px corners/edges, distinct colors per position
    await t.ok('draw_ui_element', { kind: 'frame', x: 0, y: 0, w: 16, h: 16, style: { corner: 'square', borderWidth: 2, inset: 1, border: '#000000', light: '#ffffff', dark: '#808080' } })
    // a dash rhythm along the top edge so that tiling and stretching differ
    await t.ok('draw_grid', { x: 4, y: 0, rows: ['a.a.a.a.', 'a.a.a.a.'], legend: { a: '#ff0000', '.': '#00ff00' } })
  }

  it('resizes a 16x16 frame to 200x48 keeping the corners and tiling the edges', async () => {
    const t = setup({ width: 220, height: 90 })
    await frame16(t)
    const before = Array.from({ length: 16 }, (_, i) => Array.from({ length: 16 }, (_, j) => pixel(t, j, i)))
    const d0 = t.session.history.undoDepth
    const r = await t.ok('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16 }, insets: 4, x: 10, y: 30, w: 200, h: 48 })
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    expect(resultText(r)).toContain('200x48')
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        expect(pixel(t, 10 + i, 30 + j)).toBe(before[j]![i])
        expect(pixel(t, 10 + 199 - i, 30 + 47 - j)).toBe(before[15 - j]![15 - i])
      }
    }
    // tiled top edge repeats the 8 px wide middle of the source
    for (let i = 4; i < 196; i++) expect(pixel(t, 10 + i, 30 + 1)).toBe(before[1]![4 + ((i - 4) % 8)])
    await t.ok('undo')
    expect(pixel(t, 100, 30)).toBe(0)
  })

  it('stretch gives a different result than tile', async () => {
    const t = setup({ width: 100, height: 40 })
    await frame16(t)
    await t.ok('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16 }, insets: 4, x: 20, y: 0, w: 60, h: 30, edges: 'tile', center: 'tile' })
    const tile = Array.from({ length: 60 }, (_, i) => pixel(t, 20 + i, 1))
    await t.ok('clear_cel')
    await frame16(t)
    await t.ok('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16 }, insets: { left: 4, top: 4, right: 4, bottom: 4 }, x: 20, y: 0, w: 60, h: 30, edges: 'stretch', center: 'stretch' })
    const stretch = Array.from({ length: 60 }, (_, i) => pixel(t, 20 + i, 1))
    expect(stretch).not.toEqual(tile)
  })

  it('reads the source from another layer or document', async () => {
    const t = setup({ width: 40, height: 40 })
    await frame16(t)
    await t.ok('add_layer', { name: 'Out' })
    await t.ok('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16, layer: 0 }, insets: 4, x: 0, y: 20, w: 30, h: 20, layer: 'Out' })
    expect(pixel(t, 0, 20, 1)).toBe(pixel(t, 0, 0, 0))
    const bad = await t.call('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16, document: 'nope' }, insets: 4, x: 0, y: 20, w: 30, h: 20 })
    expect(bad.isError).toBe(true)
  })

  it('errors when the insets are too big for the source or the target, or the source is off canvas', async () => {
    const t = setup({ width: 40, height: 40 })
    await frame16(t)
    const a = await t.call('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16 }, insets: 8, x: 0, y: 20, w: 30, h: 20 })
    expect(a.isError).toBe(true)
    expect(resultText(a)).toMatch(/leave no middle/)
    const b = await t.call('draw_nine_slice', { source: { x: 0, y: 0, w: 16, h: 16 }, insets: 4, x: 0, y: 20, w: 6, h: 20 })
    expect(b.isError).toBe(true)
    expect(resultText(b)).toMatch(/smaller than the borders/)
    const c = await t.call('draw_nine_slice', { source: { x: 30, y: 30, w: 16, h: 16 }, insets: 4, x: 0, y: 20, w: 30, h: 20 })
    expect(c.isError).toBe(true)
    expect(resultText(c)).toMatch(/not inside/)
  })

  it('draws the 9-slice of an element at its reported borders', async () => {
    const t = setup({ width: 120, height: 60 })
    const r = await t.ok('draw_ui_element', { kind: 'panel', x: 0, y: 0, w: 24, h: 20 })
    const n = (jsonOf(r) as { nineSlice: { left: number; top: number; right: number; bottom: number } }).nineSlice
    await t.ok('draw_nine_slice', { source: { x: 0, y: 0, w: 24, h: 20 }, insets: n, x: 30, y: 0, w: 80, h: 50 })
    // the reported borders are exactly what survives: the 24x20 panel's corners reappear on the 80x50 one
    for (let j = 0; j < n.top; j++) {
      for (let i = 0; i < n.left; i++) {
        expect(pixel(t, 30 + i, j)).toBe(pixel(t, i, j))
        expect(pixel(t, 30 + 79 - i, 49 - j)).toBe(pixel(t, 23 - i, 19 - j))
      }
    }
  })
})
