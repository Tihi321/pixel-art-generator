import { describe, expect, it } from 'vitest'
import {
  type Raster,
  blendPixel,
  createAddLayerCommand,
  copyRegion,
  createDocument,
  createRaster,
  createPaintCommand,
  drawEllipse,
  drawLine,
  drawRect,
  flattenFrame,
  flipH,
  flipV,
  floodFill,
  getPixel,
  hexToRgba,
  mirrorDraw,
  outline,
  packRgba,
  replaceColor,
  rgbaToHex,
  rotate,
  setPixels,
  shift,
  stamp,
  unpackRgba,
  History
} from '../../src/core'
import { BLACK, BLUE, GREEN, RED } from './helpers'

/** Render a raster as rows of chars: '.' transparent, R/G/B/K for the test colors, '?' otherwise. */
function show(img: Raster): string[] {
  const m = new Map<number, string>([
    [0, '.'],
    [RED, 'R'],
    [GREEN, 'G'],
    [BLUE, 'B'],
    [BLACK, 'K']
  ])
  const rows: string[] = []
  for (let y = 0; y < img.height; y++) {
    let r = ''
    for (let x = 0; x < img.width; x++) r += m.get(img.data[y * img.width + x]!) ?? '?'
    rows.push(r)
  }
  return rows
}

describe('color utils', () => {
  it('round-trips hex <-> rgba and supports short/alpha forms', () => {
    expect(rgbaToHex(hexToRgba('#1a1c2c'))).toBe('#1a1c2c')
    expect(hexToRgba('#f00')).toBe(RED)
    expect(hexToRgba('#ff0000ff')).toBe(RED)
    expect(rgbaToHex(hexToRgba('#11223380'))).toBe('#11223380')
    expect(hexToRgba(null)).toBe(0)
    expect(hexToRgba('transparent')).toBe(0)
    expect(unpackRgba(packRgba(1, 2, 3, 4))).toEqual([1, 2, 3, 4])
    // 0xAABBGGRR layout
    expect(packRgba(0x11, 0x22, 0x33, 0x44)).toBe(0x44332211)
    expect(() => hexToRgba('#12')).toThrow(/Invalid color/)
  })
})

describe('raster ops', () => {
  it('draws a Bresenham line including both endpoints', () => {
    const img = createRaster(5, 5)
    drawLine(img, 0, 0, 4, 2, RED)
    expect(show(img)).toEqual(['R....', '.RR..', '...RR', '.....', '.....'])
    const diag = createRaster(4, 4)
    drawLine(diag, 3, 0, 0, 3, RED)
    expect(show(diag)).toEqual(['...R', '..R.', '.R..', 'R...'])
  })

  it('draws a line with thickness', () => {
    const img = createRaster(6, 6)
    drawLine(img, 1, 1, 4, 1, RED, { thickness: 2 })
    // 2px brush covers (x, y) and (x+1,y+1)? offset = -0 -> covers x..x+1, y..y+1
    expect(getPixel(img, 1, 1)).toBe(RED)
    expect(getPixel(img, 2, 2)).toBe(RED)
    expect(getPixel(img, 5, 2)).toBe(RED)
  })

  it('draws rect outline and filled', () => {
    const img = createRaster(6, 5)
    drawRect(img, 1, 1, 4, 3, GREEN)
    expect(show(img)).toEqual(['......', '.GGGG.', '.G..G.', '.GGGG.', '......'])
    const f = createRaster(4, 3)
    const dirty = drawRect(f, 1, 0, 2, 2, BLUE, { filled: true })
    expect(show(f)).toEqual(['.BB.', '.BB.', '....'])
    expect(dirty).toEqual({ x: 1, y: 0, w: 2, h: 2 })
  })

  it('clips shapes at the raster edge', () => {
    const img = createRaster(3, 3)
    const d = drawRect(img, -1, -1, 3, 3, RED, { filled: true })
    expect(d).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })

  it('draws ellipses (outline symmetrical, filled has no holes)', () => {
    const img = createRaster(7, 5)
    drawEllipse(img, 0, 0, 7, 5, RED)
    const rows = show(img)
    // symmetric both axes
    expect(rows.map((r) => r.split('').reverse().join(''))).toEqual(rows)
    expect([...rows].reverse()).toEqual(rows)
    // touches all four bounding box sides
    expect(rows[0]!.includes('R')).toBe(true)
    expect(rows[4]!.includes('R')).toBe(true)
    expect(rows.some((r) => r[0] === 'R')).toBe(true)
    expect(rows.some((r) => r[6] === 'R')).toBe(true)

    const filled = createRaster(8, 8)
    drawEllipse(filled, 0, 0, 8, 8, RED, { filled: true })
    const fr = show(filled)
    // center is filled, corners are not
    expect(fr[3]![3]).toBe('R')
    expect(fr[0]![0]).toBe('.')
    expect(fr[7]![7]).toBe('.')
    for (const row of fr) {
      const first = row.indexOf('R')
      const last = row.lastIndexOf('R')
      expect(row.slice(first, last + 1)).not.toContain('.')
    }
  })

  it('flood fills contiguous (4-connected) and global', () => {
    const img = createRaster(4, 3)
    setPixels(img, [
      { x: 1, y: 0, color: BLACK },
      { x: 1, y: 1, color: BLACK },
      { x: 1, y: 2, color: BLACK },
      { x: 2, y: 1, color: BLACK }
    ])
    floodFill(img, 0, 0, RED)
    expect(show(img)).toEqual(['RK..', 'RKK.', 'RK..'])
    const diagonal = createRaster(3, 3)
    setPixels(diagonal, [
      { x: 1, y: 0, color: BLACK },
      { x: 0, y: 1, color: BLACK },
      { x: 2, y: 1, color: BLACK },
      { x: 1, y: 2, color: BLACK },
      { x: 1, y: 1, color: BLACK }
    ])
    floodFill(diagonal, 0, 0, GREEN)
    // 4-connected: corner (0,0) is isolated by the plus shape
    expect(show(diagonal)).toEqual(['GK.', 'KKK', '.K.'])
    const g = createRaster(3, 1)
    setPixels(g, [{ x: 1, y: 0, color: BLACK }])
    floodFill(g, 0, 0, BLUE, { contiguous: false })
    expect(show(g)).toEqual(['BKB'])
    expect(floodFill(g, 1, 0, BLACK)).toBeNull()
  })

  it('replaces colors', () => {
    const img = createRaster(3, 1)
    setPixels(img, [
      { x: 0, y: 0, color: RED },
      { x: 2, y: 0, color: RED }
    ])
    const d = replaceColor(img, RED, BLUE)
    expect(show(img)).toEqual(['B.B'])
    expect(d).toEqual({ x: 0, y: 0, w: 3, h: 1 })
  })

  it('flips', () => {
    const img = createRaster(3, 2)
    setPixels(img, [
      { x: 0, y: 0, color: RED },
      { x: 2, y: 1, color: BLUE }
    ])
    flipH(img)
    expect(show(img)).toEqual(['..R', 'B..'])
    flipV(img)
    expect(show(img)).toEqual(['B..', '..R'])
  })

  it('rotates square rasters losslessly', () => {
    const img = createRaster(3, 3)
    setPixels(img, [
      { x: 0, y: 0, color: RED },
      { x: 2, y: 0, color: GREEN },
      { x: 2, y: 2, color: BLUE }
    ])
    const orig = img.data.slice()
    rotate(img, 90)
    // clockwise: top-left goes to top-right
    expect(getPixel(img, 2, 0)).toBe(RED)
    expect(getPixel(img, 2, 2)).toBe(GREEN)
    expect(getPixel(img, 0, 2)).toBe(BLUE)
    rotate(img, 270)
    expect(Array.from(img.data)).toEqual(Array.from(orig))
    rotate(img, 180)
    expect(getPixel(img, 2, 2)).toBe(RED)
    expect(getPixel(img, 0, 2)).toBe(GREEN)
    expect(getPixel(img, 0, 0)).toBe(BLUE)
  })

  it('rotates non-square rasters with clipping to the same size', () => {
    const img = createRaster(4, 2)
    setPixels(img, [
      { x: 1, y: 1, color: RED },
      { x: 3, y: 0, color: BLUE } // falls outside the rotated 2x4 content window and is clipped
    ])
    rotate(img, 90)
    expect(img.width).toBe(4)
    expect(img.height).toBe(2)
    expect(show(img)).toEqual(['.R..', '....'])
  })

  it('shifts with wrap and without', () => {
    const img = createRaster(4, 1)
    setPixels(img, [{ x: 3, y: 0, color: RED }])
    shift(img, 1, 0)
    expect(show(img)).toEqual(['R...'])
    shift(img, -1, 0, { wrap: false })
    expect(show(img)).toEqual(['....'])
    const v = createRaster(1, 3)
    setPixels(v, [{ x: 0, y: 0, color: GREEN }])
    shift(v, 0, -1)
    expect(show(v)).toEqual(['.', '.', 'G'])
  })

  it('outlines outside and inside', () => {
    const img = createRaster(5, 5)
    setPixels(img, [{ x: 2, y: 2, color: RED }])
    outline(img, BLACK)
    expect(show(img)).toEqual(['.....', '..K..', '.KRK.', '..K..', '.....'])
    const diag = createRaster(5, 5)
    setPixels(diag, [{ x: 2, y: 2, color: RED }])
    outline(diag, BLACK, { diagonal: true })
    expect(show(diag)[1]).toBe('.KKK.')

    const sq = createRaster(5, 5)
    drawRect(sq, 1, 1, 3, 3, RED, { filled: true })
    outline(sq, BLACK, { mode: 'inside' })
    expect(show(sq)).toEqual(['.....', '.KKK.', '.KRK.', '.KKK.', '.....'])
  })

  it('copies regions and stamps with alpha / replace', () => {
    const src = createRaster(3, 3)
    setPixels(src, [
      { x: 1, y: 1, color: RED },
      { x: 2, y: 2, color: BLUE }
    ])
    const part = copyRegion(src, { x: 1, y: 1, w: 2, h: 2 })
    expect(show(part)).toEqual(['R.', '.B'])

    const dst = createRaster(4, 4)
    drawRect(dst, 0, 0, 4, 4, GREEN, { filled: true })
    stamp(dst, part, 1, 1)
    expect(show(dst)).toEqual(['GGGG', 'GRGG', 'GGBG', 'GGGG'])
    stamp(dst, part, 2, 0, { replace: true })
    expect(show(dst)).toEqual(['GGR.', 'GR.B', 'GGBG', 'GGGG'])
    // out-of-range stamping is clipped
    expect(stamp(dst, part, 3, 3)).toEqual({ x: 3, y: 3, w: 1, h: 1 })
  })

  it('mirrors drawing', () => {
    const img = createRaster(5, 3)
    mirrorDraw(img, { horizontal: true }, (r) => setPixels(r, [{ x: 0, y: 0, color: RED }]))
    expect(show(img)).toEqual(['R...R', '.....', '.....'])
    const both = createRaster(4, 4)
    mirrorDraw(both, { horizontal: true, vertical: true }, (r) => setPixels(r, [{ x: 0, y: 0, color: RED }]))
    expect(show(both)).toEqual(['R..R', '....', '....', 'R..R'])
  })
})

describe('compositing', () => {
  it('blends normal/multiply/screen/add/overlay', () => {
    const white = packRgba(255, 255, 255)
    const gray = packRgba(128, 128, 128)
    expect(blendPixel(0, RED)).toBe(RED)
    expect(blendPixel(RED, BLUE)).toBe(BLUE)
    expect(blendPixel(white, gray, 'multiply')).toBe(gray)
    expect(blendPixel(RED, GREEN, 'multiply')).toBe(BLACK)
    expect(blendPixel(RED, GREEN, 'add')).toBe(packRgba(255, 255, 0))
    expect(blendPixel(BLACK, gray, 'screen')).toBe(gray)
    expect(blendPixel(packRgba(100, 100, 100), BLACK, 'overlay')).toBe(BLACK)
    // 50% opacity over opaque
    const half = blendPixel(BLACK, white, 'normal', 0.5)
    expect(unpackRgba(half)[0]).toBe(128)
    expect(unpackRgba(half)[3]).toBe(255)
    // opacity over transparent scales alpha
    expect(unpackRgba(blendPixel(0, RED, 'normal', 0.5))[3]).toBe(128)
  })

  it('flattens visible pixel layers only (reference excluded unless asked)', () => {
    const doc = createDocument({ width: 2, height: 1 })
    const frame = doc.frames[0]!.id
    const l0 = doc.layers[0]!
    const history = new History(doc)
    const addTop = (name: string, kind: 'pixel' | 'reference'): string => {
      const cmd = createAddLayerCommand(doc, { name, kind })
      history.execute(cmd)
      return cmd.createdId
    }
    const paint = (layer: string, x: number, color: number): void => {
      const cmd = createPaintCommand(doc, {
        layer,
        frame,
        mutate: (img) => setPixels(img, [{ x, y: 0, color }])
      })
      history.execute(cmd!)
    }
    paint(l0.id, 0, RED)
    const top = addTop('Top', 'pixel')
    const ref = addTop('Ref', 'reference')
    paint(top, 1, GREEN)
    paint(ref, 0, BLUE)
    expect(Array.from(flattenFrame(doc, frame))).toEqual([RED, GREEN])
    expect(Array.from(flattenFrame(doc, frame, { includeReference: true }))).toEqual([BLUE, GREEN])
    doc.layers.find((l) => l.id === top)!.visible = false
    expect(Array.from(flattenFrame(doc, frame))).toEqual([RED, 0])
  })
})
