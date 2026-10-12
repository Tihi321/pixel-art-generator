// Viewport math for the canvas view. Pure functions, no DOM.
//
// A viewport maps document pixels to screen (CSS) pixels: screen = pan + doc * zoom, where
// (panX, panY) is the screen position of the document's top-left corner inside the canvas element.

export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 128
/** Zoom ladder used by the + / - keys and the wheel. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128]

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

/** Next ladder step above (dir > 0) or below (dir < 0) the current zoom. */
export function stepZoom(zoom: number, dir: number): number {
  if (dir > 0) {
    for (const s of ZOOM_STEPS) if (s > zoom + 1e-9) return s
    return ZOOM_STEPS[ZOOM_STEPS.length - 1]!
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const s = ZOOM_STEPS[i]!
    if (s < zoom - 1e-9) return s
  }
  return ZOOM_STEPS[0]!
}

/** Document coordinates (fractional) under a screen point. */
export function screenToDoc(vp: Viewport, sx: number, sy: number): Point {
  return { x: (sx - vp.panX) / vp.zoom, y: (sy - vp.panY) / vp.zoom }
}

/** Integer document pixel under a screen point (may be outside the canvas). */
export function screenToPixel(vp: Viewport, sx: number, sy: number): Point {
  const p = screenToDoc(vp, sx, sy)
  return { x: Math.floor(p.x), y: Math.floor(p.y) }
}

/** Screen position of the top-left corner of a document pixel. */
export function docToScreen(vp: Viewport, x: number, y: number): Point {
  return { x: vp.panX + x * vp.zoom, y: vp.panY + y * vp.zoom }
}

/** Change zoom while keeping the document point under (sx, sy) fixed on screen. */
export function zoomAt(vp: Viewport, newZoom: number, sx: number, sy: number): Viewport {
  const zoom = clampZoom(newZoom)
  const d = screenToDoc(vp, sx, sy)
  return { zoom, panX: sx - d.x * zoom, panY: sy - d.y * zoom }
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, panX: vp.panX + dx, panY: vp.panY + dy }
}

/** Centre the document in a view of the given size at the given zoom. */
export function centerViewport(zoom: number, viewW: number, viewH: number, docW: number, docH: number): Viewport {
  return { zoom, panX: Math.round((viewW - docW * zoom) / 2), panY: Math.round((viewH - docH * zoom) / 2) }
}

/** Zoom that fits the whole document in the view (integer when >= 1) leaving `margin` px around it. */
export function fitZoom(viewW: number, viewH: number, docW: number, docH: number, margin = 24): number {
  const aw = Math.max(1, viewW - margin * 2)
  const ah = Math.max(1, viewH - margin * 2)
  const z = Math.min(aw / docW, ah / docH)
  return clampZoom(z >= 1 ? Math.floor(z) : z)
}

export function fitViewport(viewW: number, viewH: number, docW: number, docH: number, margin = 24): Viewport {
  return centerViewport(fitZoom(viewW, viewH, docW, docH, margin), viewW, viewH, docW, docH)
}

/** Whether pixel grid lines should be drawn at this zoom. */
export function gridVisible(zoom: number): boolean {
  return zoom >= 8
}
