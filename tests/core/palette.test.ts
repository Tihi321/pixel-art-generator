import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PALETTES,
  type Palette,
  builtinPaletteHexText,
  detectPaletteFormat,
  encodePng,
  exportPalette,
  getBuiltinPalette,
  hexToRgba,
  listBuiltinPalettes,
  parsePalette
} from '../../src/core'

const sample: Palette = {
  id: 'p',
  name: 'Sample',
  colors: [{ hex: '#1a1c2c' }, { hex: '#f4b41b', name: 'Gold' }, { hex: '#ffffff' }]
}
const hexes = (p: Palette): string[] => p.colors.map((c) => c.hex)

describe('palette codecs', () => {
  it('round-trips .hex (Lospec)', () => {
    const text = exportPalette(sample, 'hex')
    expect(text).toBe('1a1c2c\nf4b41b\nffffff\n')
    const back = parsePalette(text, 'sample.hex')
    expect(hexes(back)).toEqual(hexes(sample))
    expect(back.name).toBe('sample')
    // tolerant of CRLF, '#', comments, blank lines and a BOM
    const messy = String.fromCharCode(0xfeff) + '; comment\r\n#1A1C2C\r\n\r\nf4b41b\r\n'
    expect(hexes(parsePalette(messy, 'x.hex'))).toEqual(['#1a1c2c', '#f4b41b'])
    expect(() => parsePalette('1a1c2c\nnothex', 'bad.hex')).toThrow(/Line 2/)
  })

  it('round-trips .gpl (GIMP) including names', () => {
    const text = exportPalette(sample, 'gpl')
    expect(text.startsWith('GIMP Palette\nName: Sample\n')).toBe(true)
    const back = parsePalette(text, 'whatever.gpl')
    expect(hexes(back)).toEqual(hexes(sample))
    expect(back.name).toBe('Sample')
    expect(back.colors[1]!.name).toBe('Gold')
    expect(back.colors[0]!.name).toBeUndefined() // "Index 0" placeholder names are dropped
    expect(() => parsePalette('GIMP Palette\nnonsense', 'x.gpl')).toThrow(/Line 2/)
  })

  it('round-trips .pal (JASC)', () => {
    const text = exportPalette(sample, 'pal')
    expect(text.split('\r\n').slice(0, 3)).toEqual(['JASC-PAL', '0100', '3'])
    const back = parsePalette(text, 'a.pal')
    expect(hexes(back)).toEqual(hexes(sample))
    expect(() => parsePalette('JASC-PAL\n0100\n2\n1 2 3', 'x.pal')).toThrow(/declares 2 colors/)
  })

  it('round-trips PNG swatch strips (scaled swatches too) and auto-detects without extension', () => {
    const png1 = exportPalette(sample, 'png', 1)
    expect(hexes(parsePalette(png1, 'strip.png'))).toEqual(hexes(sample))
    const png4 = exportPalette(sample, 'png', 4)
    expect(hexes(parsePalette(png4))).toEqual(hexes(sample))
    expect(detectPaletteFormat(png4)).toBe('png')
    expect(detectPaletteFormat(exportPalette(sample, 'gpl'))).toBe('gpl')
    expect(detectPaletteFormat(exportPalette(sample, 'pal'))).toBe('pal')
    expect(detectPaletteFormat('1a1c2c\n')).toBe('hex')
    // arbitrary image: unique opaque colors in scan order, transparent ignored
    const img = encodePng({ width: 3, height: 1, data: Uint32Array.of(hexToRgba('#112233'), 0, hexToRgba('#112233')) })
    expect(hexes(parsePalette(img, 'x.png'))).toEqual(['#112233'])
  })
})

describe('built-in palettes', () => {
  it('has the expected set with sane sizes and unique valid colors', () => {
    const sizes = Object.fromEntries(listBuiltinPalettes().map((p) => [p.id, p.size]))
    expect(sizes).toMatchObject({ 'pico-8': 16, 'sweetie-16': 16, db16: 16, db32: 32, 'endesga-32': 32, 'endesga-64': 64, gameboy: 4, 'resurrect-64': 64, cga: 16 })
    expect(sizes.nes).toBeGreaterThan(50)
    for (const p of BUILTIN_PALETTES) {
      const seen = new Set(hexes(p))
      expect(seen.size, `${p.id} has duplicate colors`).toBe(p.colors.length)
      for (const c of p.colors) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(getBuiltinPalette('PICO-8')!.colors[8]).toEqual({ hex: '#ff004d', name: 'red' })
    expect(getBuiltinPalette('Endesga 32')!.id).toBe('endesga-32')
    expect(getBuiltinPalette('nope')).toBeUndefined()
    // lookups return copies
    getBuiltinPalette('pico-8')!.colors.pop()
    expect(getBuiltinPalette('pico-8')!.colors).toHaveLength(16)
  })

  it('keeps seed/palettes/*.hex in sync with the embedded data', () => {
    for (const p of BUILTIN_PALETTES) {
      const file = readFileSync(join(__dirname, '..', '..', 'seed', 'palettes', `${p.id}.hex`), 'utf8')
      expect(file.replace(/\r\n/g, '\n')).toBe(builtinPaletteHexText(p.id))
      expect(hexes(parsePalette(file, `${p.id}.hex`))).toEqual(hexes(p))
    }
  })
})
