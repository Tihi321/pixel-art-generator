import { describe, expect, it } from 'vitest'
import { type Raster, type UiCorner, type UiKind, type UiStyle, UI_KINDS, UI_STATES, createRaster, drawUiElement, getFont, layoutText, nineSlice, packRgba, renderUiElement, toOklab, uiNineSlice } from '../../src/core'

const B = packRgba(10, 10, 10)
const F = packRgba(100, 100, 100)
const L = packRgba(200, 200, 200)
const D = packRgba(50, 50, 50)
const GREYS = [0, 51, 102, 153, 204, 255].map((v) => packRgba(v, v, v))
const KEY = new Map<number, string>([[B, 'B'], [F, 'F'], [L, 'L'], [D, 'D'], [0, '.']])

function rows(img: Raster, w: number, h: number): string[] {
  const out: string[] = []
  for (let y = 0; y < h; y++) {
    let s = ''
    for (let x = 0; x < w; x++) s += KEY.get(img.data[y * img.width + x]!) ?? '?'
    out.push(s)
  }
  return out
}

const flat: Partial<UiStyle> = { fill: F, border: B, light: L, dark: D, corner: 'square', borderWidth: 1, inset: 0 }

describe('drawUiElement', () => {
  it('draws border, bevel and fill exactly on a small square button', () => {
    const { raster } = renderUiElement({ kind: 'button', w: 8, h: 6, style: flat }, GREYS)
    expect(rows(raster, 8, 6)).toEqual(['BBBBBBBB', 'BLLLLLFB', 'BLFFFFDB', 'BLFFFFDB', 'BFDDDDDB', 'BBBBBBBB'])
    // nothing outside the rectangle
    expect(raster.data[6 * raster.width]).toBe(0)
    expect(raster.data[5 * raster.width + 8]).toBe(0)
  })

  it('round corners drop one pixel on small elements, cut corners chamfer, square keeps them', () => {
    const corner = (c: UiCorner) => rows(renderUiElement({ kind: 'button', w: 12, h: 8, style: { ...flat, corner: c } }, GREYS).raster, 12, 8)
    expect(corner('square')[0]!.slice(0, 3)).toBe('BBB')
    expect(corner('round')[0]!.slice(0, 3)).toBe('.BB')
    expect(corner('round')[1]![0]).toBe('B')
    expect(corner('cut')[0]!.slice(0, 3)).toBe('..B')
    expect(corner('cut')[1]!.slice(0, 2)).toBe('.B')
    // the right side mirrors the left
    expect(corner('cut')[0]!.slice(-3)).toBe('B..')
    expect(corner('round')[7]!.slice(-3)).toBe('BB.')
  })

  it('draws a 1 px drop shadow outside the rectangle only', () => {
    const SH = packRgba(1, 2, 3)
    const { raster } = renderUiElement({ kind: 'panel', w: 8, h: 6, style: { ...flat, shadow: SH } }, GREYS)
    expect(raster.data[8]).toBe(0) // not at (8,0)
    expect(raster.data[1 * raster.width + 8]).toBe(SH)
    expect(raster.data[6 * raster.width + 1]).toBe(SH)
    expect(raster.data[6 * raster.width + 8]).toBe(SH)
    expect(raster.data[5 * raster.width + 7]).toBe(B)
  })

  it('patterns alternate fill and dark', () => {
    const { raster } = renderUiElement({ kind: 'panel', w: 10, h: 8, style: { ...flat, pattern: 'dither' } }, GREYS)
    const a = raster.data[4 * raster.width + 4]
    const b = raster.data[4 * raster.width + 5]
    expect(new Set([a, b])).toEqual(new Set([F, D]))
    expect(raster.data[5 * raster.width + 5]).toBe(a)
  })

  it('a frame leaves its middle untouched; other kinds fill it', () => {
    const img = createRaster(20, 20)
    img.data.fill(L)
    drawUiElement(img, { kind: 'frame', x: 2, y: 2, w: 12, h: 12, style: { ...flat, fill: 0 } }, GREYS)
    expect(img.data[8 * 20 + 8]).toBe(L)
    expect(img.data[2 * 20 + 5]).toBe(B)
    drawUiElement(img, { kind: 'panel', x: 2, y: 2, w: 12, h: 12, style: flat }, GREYS)
    expect(img.data[8 * 20 + 8]).toBe(F)
  })

  it('textbox draws an inner line `inset` pixels inside the border', () => {
    const { raster } = renderUiElement({ kind: 'textbox', w: 14, h: 10, style: { ...flat, inset: 1 } }, GREYS)
    // border at 0, one fill pixel at 1, line (light) at 2
    expect(raster.data[5 * raster.width + 0]).toBe(B)
    expect(raster.data[5 * raster.width + 1]).toBe(F)
    expect(raster.data[5 * raster.width + 2]).toBe(L)
    expect(raster.data[5 * raster.width + 5]).toBe(F)
  })

  it('states change the fill: hover lighter, pressed darker with an inverted bevel, disabled flat', () => {
    const fillOf = (state: (typeof UI_STATES)[number], style: Partial<UiStyle> = {}) => {
      const { raster } = renderUiElement({ kind: 'button', w: 16, h: 12, state, style: { corner: 'square', ...style } }, GREYS)
      return { fill: raster.data[6 * raster.width + 8]!, topLeft: raster.data[1 * raster.width + 1]!, bottomRight: raster.data[10 * raster.width + 14]! }
    }
    const idle = fillOf('idle')
    const hover = fillOf('hover')
    const pressed = fillOf('pressed')
    const disabled = fillOf('disabled')
    const lum = (c: number) => toOklab(c)[0]
    expect(lum(hover.fill)).toBeGreaterThan(lum(idle.fill))
    expect(lum(pressed.fill)).toBeLessThan(lum(idle.fill))
    expect(GREYS).toContain(disabled.fill)
    // pressed swaps the bevel
    expect(pressed.topLeft).toBe(idle.bottomRight)
    expect(pressed.bottomRight).toBe(idle.topLeft)
    // disabled has no bevel
    expect(disabled.topLeft).toBe(disabled.fill)
    expect(disabled.bottomRight).toBe(disabled.fill)
    // an explicit hoverFill wins
    expect(fillOf('hover', { hoverFill: L }).fill).toBe(L)
  })

  it('states are ignored on kinds that are not buttons', () => {
    const a = renderUiElement({ kind: 'panel', w: 12, h: 10, state: 'pressed' }, GREYS)
    const b = renderUiElement({ kind: 'panel', w: 12, h: 10 }, GREYS)
    expect(a.result.state).toBe('idle')
    expect(Array.from(a.raster.data)).toEqual(Array.from(b.raster.data))
  })

  it('centres a button label and moves a pressed label one pixel down', () => {
    const font = getFont('small')
    const text = layoutText('Start', font)
    const idle = renderUiElement({ kind: 'button', w: 41, h: 16, label: 'Start', style: flat }, GREYS).result
    expect(idle.labelBox!.x).toBe(Math.floor((41 - text.width) / 2))
    expect(idle.labelBox!.y).toBe(Math.floor((16 - font.baseline) / 2))
    expect(idle.labelFits).toBe(true)
    const pressed = renderUiElement({ kind: 'button', w: 41, h: 16, label: 'Start', state: 'pressed', style: flat }, GREYS).result
    expect(pressed.labelBox!.y).toBe(idle.labelBox!.y + 1)
    expect(renderUiElement({ kind: 'button', w: 14, h: 12, label: 'Much too long', style: flat }, GREYS).result.labelFits).toBe(false)
  })

  it('label color defaults to whichever palette extreme contrasts with the fill', () => {
    const dark = renderUiElement({ kind: 'button', w: 30, h: 12, label: 'A', style: { ...flat, fill: GREYS[1]! } }, GREYS).raster
    const light = renderUiElement({ kind: 'button', w: 30, h: 12, label: 'A', style: { ...flat, fill: GREYS[4]! } }, GREYS).raster
    expect(Array.from(dark.data)).toContain(GREYS[5])
    expect(Array.from(light.data)).toContain(GREYS[0])
  })

  it('defaults work in any palette (two colors)', () => {
    for (const kind of UI_KINDS) {
      const { raster, result } = renderUiElement({ kind, w: 30, h: 20, label: 'Hi' }, [packRgba(0, 0, 0), packRgba(255, 255, 255)])
      expect(result.dirty).not.toBeNull()
      expect(raster.data.some((c) => c !== 0)).toBe(true)
    }
  })

  it('rejects an element smaller than its borders, naming the minimum', () => {
    const img = createRaster(40, 40)
    expect(() => drawUiElement(img, { kind: 'textbox', x: 0, y: 0, w: 6, h: 6, style: { inset: 2 } }, GREYS)).toThrow(/needs at least \d+x\d+ pixels/)
  })
})

describe('reported 9-slice borders', () => {
  const kinds: UiKind[] = [...UI_KINDS]
  for (const kind of kinds) {
    for (const corner of ['square', 'round', 'cut'] as const) {
      for (const bw of [1, 2]) {
        it(`${kind} ${corner} borderWidth ${bw}: nothing beyond the borders varies along the stretch axis`, () => {
          const style: Partial<UiStyle> = { corner, borderWidth: bw, inset: kind === 'textbox' ? 1 : 0 }
          const w = 70
          const h = 50
          const { raster, result } = renderUiElement({ kind, w, h, style }, GREYS)
          const n = result.nineSlice
          const at = (x: number, y: number) => raster.data[y * raster.width + x]!
          for (let y = 0; y < h; y++) for (let x = n.left; x < w - n.right; x++) expect(at(x, y), `${x},${y}`).toBe(at(n.left, y))
          for (let x = 0; x < w; x++) for (let y = n.top; y < h - n.bottom; y++) expect(at(x, y), `${x},${y}`).toBe(at(x, n.top))
          // and the borders are as thin as they can be: the last border column differs from the middle somewhere
          let leftTight = false
          for (let y = 0; y < h; y++) if (at(n.left - 1, y) !== at(n.left, y)) leftTight = true
          expect(leftTight).toBe(true)
          expect(n).toEqual(uiNineSlice(kind, result.style, w, h))
        })
      }
    }
  }

  it('a flat button reports border + bevel, a textbox adds its inner line', () => {
    const btn = renderUiElement({ kind: 'button', w: 30, h: 20, style: flat }, GREYS).result.nineSlice
    expect(btn).toEqual({ left: 2, top: 2, right: 2, bottom: 2 })
    const box = renderUiElement({ kind: 'textbox', w: 60, h: 30, style: { ...flat, borderWidth: 2, inset: 1 } }, GREYS).result.nineSlice
    expect(box).toEqual({ left: 4, top: 4, right: 4, bottom: 4 })
  })

  it('a name box has square bottom corners, so its bottom border is thinner than its top', () => {
    const n = renderUiElement({ kind: 'namebox', w: 40, h: 20, style: { ...flat, corner: 'cut', borderWidth: 1 } }, GREYS).result.nineSlice
    expect(n.bottom).toBeLessThan(n.top)
  })
})

describe('nineSlice', () => {
  /** A 9x9 source: unique pixel values so every copied pixel can be traced. */
  function source(): Raster {
    const s = createRaster(9, 9)
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) s.data[y * 9 + x] = packRgba(10 + x * 20, 10 + y * 20, 7)
    return s
  }
  const px = (r: Raster, x: number, y: number) => r.data[y * r.width + x]!

  it('keeps the corners pixel-identical and tiles the edges and middle', () => {
    const src = source()
    const dst = createRaster(40, 30)
    const dirty = nineSlice(dst, src, { x: 5, y: 3, w: 30, h: 20 }, 3)
    expect(dirty).toEqual({ x: 5, y: 3, w: 30, h: 20 })
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        expect(px(dst, 5 + i, 3 + j)).toBe(px(src, i, j))
        expect(px(dst, 5 + 29 - i, 3 + j)).toBe(px(src, 8 - i, j))
        expect(px(dst, 5 + i, 3 + 19 - j)).toBe(px(src, i, 8 - j))
        expect(px(dst, 5 + 29 - i, 3 + 19 - j)).toBe(px(src, 8 - i, 8 - j))
      }
    }
    // top edge repeats the 3 px wide middle strip of the source's top rows
    for (let i = 3; i < 27; i++) expect(px(dst, 5 + i, 3 + 1)).toBe(px(src, 3 + ((i - 3) % 3), 1))
    // middle repeats in both directions
    expect(px(dst, 5 + 3 + 4, 3 + 3 + 5)).toBe(px(src, 3 + (4 % 3), 3 + (5 % 3)))
  })

  it('stretch differs from tile', () => {
    const a = createRaster(40, 30)
    const b = createRaster(40, 30)
    nineSlice(a, source(), { x: 0, y: 0, w: 30, h: 20 }, 3, { center: 'tile', edges: 'tile' })
    nineSlice(b, source(), { x: 0, y: 0, w: 30, h: 20 }, 3, { center: 'stretch', edges: 'stretch' })
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
    // corners are the same in both
    expect(px(a, 1, 1)).toBe(px(b, 1, 1))
    expect(px(a, 28, 18)).toBe(px(b, 28, 18))
    // stretch: nearest neighbour, first and last middle columns come from the first and last middle source columns
    expect(px(b, 3, 8)).toBe(px(source(), 3, 4))
    expect(px(b, 26, 8)).toBe(px(source(), 5, 4))
  })

  it('supports per-side insets and a target as small as the borders', () => {
    const dst = createRaster(20, 20)
    nineSlice(dst, source(), { x: 0, y: 0, w: 5, h: 4 }, { left: 3, top: 1, right: 2, bottom: 3 })
    expect(px(dst, 0, 0)).toBe(px(source(), 0, 0))
    expect(px(dst, 4, 3)).toBe(px(source(), 8, 8))
  })

  it('transparent source pixels keep the target or clear it', () => {
    const src = source()
    src.data[4 * 9 + 4] = 0
    const keep = createRaster(20, 20)
    keep.data.fill(packRgba(1, 2, 3))
    const clear = createRaster(20, 20)
    clear.data.fill(packRgba(1, 2, 3))
    nineSlice(keep, src, { x: 0, y: 0, w: 9, h: 9 }, 3)
    nineSlice(clear, src, { x: 0, y: 0, w: 9, h: 9 }, 3, { transparent: 'clear' })
    expect(px(keep, 4, 4)).toBe(packRgba(1, 2, 3))
    expect(px(clear, 4, 4)).toBe(0)
  })

  it('rejects insets that do not fit the source or the target', () => {
    const dst = createRaster(40, 40)
    expect(() => nineSlice(dst, source(), { x: 0, y: 0, w: 30, h: 20 }, 5)).toThrow(/leave no middle/)
    expect(() => nineSlice(dst, source(), { x: 0, y: 0, w: 5, h: 20 }, 3)).toThrow(/smaller than the borders/)
    expect(() => nineSlice(dst, source(), { x: 0, y: 0, w: 30, h: 20 }, { left: -1, top: 1, right: 1, bottom: 1 })).toThrow(/whole number/)
  })

  it('clips a target that runs off the canvas', () => {
    const dst = createRaster(10, 10)
    const dirty = nineSlice(dst, source(), { x: 6, y: 6, w: 20, h: 20 }, 3)
    expect(dirty).toEqual({ x: 6, y: 6, w: 4, h: 4 })
  })
})
