import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerViewport,
  clampZoom,
  docToScreen,
  fitViewport,
  fitZoom,
  gridVisible,
  panBy,
  screenToDoc,
  screenToPixel,
  stepZoom,
  zoomAt
} from '../../src/renderer/lib/viewport'

describe('viewport math', () => {
  const vp = { zoom: 8, panX: 100, panY: 50 }

  it('converts between screen and document coordinates', () => {
    expect(screenToDoc(vp, 100, 50)).toEqual({ x: 0, y: 0 })
    expect(screenToDoc(vp, 140, 66)).toEqual({ x: 5, y: 2 })
    expect(screenToPixel(vp, 147.9, 66.1)).toEqual({ x: 5, y: 2 })
    expect(screenToPixel(vp, 99, 49)).toEqual({ x: -1, y: -1 })
    expect(docToScreen(vp, 5, 2)).toEqual({ x: 140, y: 66 })
  })

  it('round-trips pixels', () => {
    for (const [x, y] of [
      [0, 0],
      [3, 7],
      [31, 31]
    ] as const) {
      const s = docToScreen(vp, x + 0.5, y + 0.5)
      expect(screenToPixel(vp, s.x, s.y)).toEqual({ x, y })
    }
  })

  it('zooms around the cursor keeping the point fixed', () => {
    const before = screenToDoc(vp, 200, 120)
    const next = zoomAt(vp, 16, 200, 120)
    expect(next.zoom).toBe(16)
    const after = screenToDoc(next, 200, 120)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps zoom and steps along the ladder', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(9999)).toBe(MAX_ZOOM)
    expect(stepZoom(8, 1)).toBe(12)
    expect(stepZoom(8, -1)).toBe(6)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
    expect(stepZoom(5, 1)).toBe(6)
    expect(stepZoom(5, -1)).toBe(4)
  })

  it('pans', () => {
    expect(panBy(vp, 5, -5)).toEqual({ zoom: 8, panX: 105, panY: 45 })
  })

  it('fits and centres a document', () => {
    expect(fitZoom(800, 600, 32, 32, 0)).toBe(18)
    const f = fitViewport(800, 600, 32, 32, 24)
    expect(f.zoom).toBe(17)
    expect(f.panX).toBe(Math.round((800 - 32 * 17) / 2))
    expect(f.panY).toBe(Math.round((600 - 32 * 17) / 2))
    expect(fitZoom(100, 100, 1000, 1000, 0)).toBeCloseTo(0.25)
    expect(centerViewport(2, 100, 100, 10, 10)).toEqual({ zoom: 2, panX: 40, panY: 40 })
  })

  it('shows the grid only when zoomed in', () => {
    expect(gridVisible(4)).toBe(false)
    expect(gridVisible(8)).toBe(true)
  })
})
