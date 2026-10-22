import { describe, expect, it } from 'vitest'
import { type Raster, createRaster, drawText, getFont, glyphFor, layoutText } from '../../src/core'
import { BLUE, RED } from './helpers'

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))

function rows(img: Raster, ch = '#'): string[] {
  const out: string[] = []
  for (let y = 0; y < img.height; y++) {
    let s = ''
    for (let x = 0; x < img.width; x++) s += img.data[y * img.width + x] ? ch : '.'
    out.push(s)
  }
  return out
}

describe('fonts', () => {
  for (const name of ['tiny', 'small'] as const) {
    it(`${name}: every printable ASCII character has a glyph of the declared height`, () => {
      const font = getFont(name)
      for (const ch of ASCII) {
        const g = glyphFor(font, ch)
        expect(g, `${name} "${ch}"`).not.toBeNull()
        expect(g!.rows).toHaveLength(font.glyphRows)
        expect(g!.w).toBeGreaterThanOrEqual(1)
        expect(g!.w).toBeLessThanOrEqual(name === 'tiny' ? 3 : 5)
        for (const r of g!.rows) expect(r >> g!.w).toBe(0)
      }
    })
  }

  it('tiny: lowercase is small caps (same bitmap as the capital)', () => {
    const tiny = getFont('tiny')
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(glyphFor(tiny, c.toLowerCase()), c).toBe(glyphFor(tiny, c))
    const key = (c: string): string => glyphFor(tiny, c)!.rows.join(',')
    expect(key('a')).toBe(key('A'))
    for (const [a, b] of ['NH', 'NM', 'NU', 'QO', 'Q0', 'BD', 'B8', 'D0', 'DO', '0O', '5S']) expect(key(a!), a! + b!).not.toBe(key(b!))
  })

  it('small: digits and look-alike letters differ, lowercase has descenders', () => {
    const small = getFont('small')
    const key = (c: string): string => glyphFor(small, c)!.rows.join(',')
    expect(key('0')).not.toBe(key('O'))
    expect(key('1')).not.toBe(key('l'))
    expect(key('1')).not.toBe(key('I'))
    expect(key('l')).not.toBe(key('I'))
    for (const c of 'gjpqy') expect(glyphFor(small, c)!.rows[8], c).not.toBe(0)
    for (const c of 'abcdehiklmnorstuvwxz') expect(glyphFor(small, c)!.rows[8], c).toBe(0)
  })

  it('accented letters use their base letter, other characters the unknown box', () => {
    const small = getFont('small')
    expect(glyphFor(small, 'é')).toBe(glyphFor(small, 'e'))
    expect(glyphFor(small, 'Ä')).toBe(glyphFor(small, 'A'))
    expect(glyphFor(small, '€')).toBeNull()
    const l = layoutText('é€日', small)
    expect(l.unknownChars).toBe(2)
    expect(l.glyphs[1]!.glyph).toBe(small.unknown)
  })
})

describe('layoutText', () => {
  const tiny = getFont('tiny')

  it('measures width and height from glyph widths, spacing and line height', () => {
    const l = layoutText('H!', tiny) // H = 3, ! = 1, one px between
    expect(l.width).toBe(5)
    expect(l.height).toBe(5)
    expect(layoutText('H!', tiny, { letterSpacing: 0 }).width).toBe(4)
    const two = layoutText('A\nB', tiny, { lineSpacing: 2 })
    expect(two.lines.map((x) => x.text)).toEqual(['A', 'B'])
    expect(two.height).toBe(6 + 2 + 5)
    expect(two.glyphs[1]!.y).toBe(8)
  })

  it('scale multiplies everything', () => {
    const a = layoutText('Hello', tiny)
    const b = layoutText('Hello', tiny, { scale: 2 })
    expect(b.width).toBe(a.width * 2)
    expect(b.height).toBe(a.height * 2)
  })

  it('wraps at spaces within maxWidth and breaks long words', () => {
    const l = layoutText('aaa bbb ccc', tiny, { maxWidth: 12 }) // "aaa bbb" = 3+3+2+3+3+... too wide for 12
    expect(l.lines.map((x) => x.text)).toEqual(['aaa', 'bbb', 'ccc'])
    for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(12)
    const long = layoutText('abcdefghij', tiny, { maxWidth: 12 })
    expect(long.lines.length).toBeGreaterThan(1)
    expect(long.lines.map((x) => x.text).join('')).toBe('abcdefghij')
    for (const line of long.lines) expect(line.width).toBeLessThanOrEqual(12)
    expect(layoutText('a b', tiny, { maxWidth: 40 }).lines).toHaveLength(1)
  })

  it('aligns lines inside maxWidth', () => {
    const left = layoutText('A\nAAA', tiny, { maxWidth: 20 })
    const center = layoutText('A\nAAA', tiny, { maxWidth: 20, align: 'center' })
    const right = layoutText('A\nAAA', tiny, { maxWidth: 20, align: 'right' })
    expect(center.width).toBe(20)
    expect(left.glyphs[0]!.x).toBe(0)
    expect(center.glyphs[0]!.x).toBe(Math.floor((20 - 3) / 2))
    expect(right.glyphs[0]!.x).toBe(17)
    // without maxWidth the box is the widest line
    expect(layoutText('A\nAAA', tiny, { align: 'center' }).glyphs[0]!.x).toBe(Math.floor((11 - 3) / 2))
  })
})

describe('drawText', () => {
  const tiny = getFont('tiny')

  it('draws glyph pixels where the table says, and returns the box', () => {
    const img = createRaster(8, 7)
    const r = drawText(img, 'T', 1, 1, RED, tiny)
    expect(r.dirty).toEqual({ x: 1, y: 1, w: 3, h: 5 })
    expect(rows(img)).toEqual(['........', '.###....', '..#.....', '..#.....', '..#.....', '..#.....', '........'])
  })

  it('scale 2 doubles every pixel', () => {
    const img = createRaster(10, 12)
    const r = drawText(img, 'T', 0, 0, RED, tiny, { scale: 2 })
    expect(r.dirty).toEqual({ x: 0, y: 0, w: 6, h: 10 })
    expect(rows(img).slice(0, 3)).toEqual(['######....', '######....', '..##......'])
  })

  it('drawn bounds equal the measured box for every ASCII glyph row of text', () => {
    for (const font of ['tiny', 'small'] as const) {
      const f = getFont(font)
      const text = 'Hello, World! gjpqy'
      const l = layoutText(text, f)
      const img = createRaster(200, 40)
      const r = drawText(img, text, 3, 4, RED, f)
      expect(r.dirty!.x).toBe(3)
      expect(r.dirty!.y).toBe(4)
      expect(r.dirty!.w).toBeLessThanOrEqual(l.width)
      expect(r.dirty!.h).toBeLessThanOrEqual(l.height)
      expect(r.dirty!.x + r.dirty!.w).toBeLessThanOrEqual(3 + l.width)
    }
  })

  it('outline and shadow only use their own colors and surround the glyphs', () => {
    const img = createRaster(12, 12)
    drawText(img, 'I', 3, 3, RED, tiny, { outline: BLUE })
    const colors = new Set(img.data)
    expect(colors).toEqual(new Set([0, RED >>> 0, BLUE >>> 0]))
    // 8-connected: the diagonal corner pixel of the glyph's top-left is outlined
    expect(img.data[2 * 12 + 2]).toBe(BLUE >>> 0)
    expect(img.data[3 * 12 + 3]).toBe(RED >>> 0)

    const sh = createRaster(12, 12)
    drawText(sh, 'I', 3, 3, RED, tiny, { shadow: { color: BLUE } })
    expect(new Set(sh.data)).toEqual(new Set([0, RED >>> 0, BLUE >>> 0]))
    expect(sh.data[4 * 12 + 4]).toBe(RED >>> 0) // glyph wins over its own shadow
    expect(sh.data[8 * 12 + 4]).toBe(BLUE >>> 0) // below the glyph's last row (7), shifted by 1
  })

  it('clips to the raster', () => {
    const img = createRaster(4, 4)
    const r = drawText(img, 'HHH', -2, -1, RED, tiny)
    expect(r!.dirty!.x).toBe(0)
    expect(r!.dirty!.y).toBe(0)
    expect(r!.dirty!.w).toBeLessThanOrEqual(4)
    expect(drawText(createRaster(4, 4), 'H', 50, 50, RED, tiny).dirty).toBeNull()
  })
})
