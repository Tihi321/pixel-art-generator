// Tool interaction logic (pencil, eraser, fill, shapes, picker, select/move), independent of the DOM.
//
// The canvas view feeds pointer events (already converted to integer document pixels) into a
// ToolController. While a gesture is in progress the document is NOT touched: the controller keeps a
// document-sized working raster and exposes it as `preview` for rendering. On release, ONE paint
// command is built (before/after diff) and executed through `session.execute`, so a whole stroke is a
// single undo step and shares the history with the LLM tools.

import {
  type Raster,
  type Rect,
  celToRaster,
  cloneRaster,
  copyRegion,
  createRasterDiffCommand,
  drawEllipse,
  drawLine,
  drawRect,
  flattenFrame,
  floodFill,
  getCel,
  hexToRgba,
  mirrorDraw,
  rgbaToHex,
  stamp,
  clearRaster
} from '../../core'
import type { EditorSession } from '../../tools/session'
import type { ToolId } from './keys'
import type { Point } from './viewport'

export interface ToolSettings {
  tool: ToolId
  brushSize: number
  mirrorX: boolean
  mirrorY: boolean
  shapeFilled: boolean
  fillContiguous: boolean
}

export interface Modifiers {
  alt: boolean
  shift: boolean
  ctrl: boolean
}

/** What the view should render instead of the stored cel while a gesture is running. */
export interface Preview {
  layerId: string
  frameId: string
  raster: Raster | null
  /** Selection rectangle override (while moving a selection). */
  selection?: Rect | null
}

// ------------------------------------------------------------------ pure helpers

/** Inclusive rectangle spanned by two corner pixels; `square` forces equal sides (follows the drag direction). */
export function normalizeShapeRect(a: Point, b: Point, square = false): Rect {
  let bx = b.x
  let by = b.y
  if (square) {
    const size = Math.max(Math.abs(bx - a.x), Math.abs(by - a.y))
    bx = a.x + (bx >= a.x ? size : -size)
    by = a.y + (by >= a.y ? size : -size)
  }
  const x = Math.min(a.x, bx)
  const y = Math.min(a.y, by)
  return { x, y, w: Math.abs(bx - a.x) + 1, h: Math.abs(by - a.y) + 1 }
}

/** Snap the end of a line to the nearest multiple of 45 degrees from the start. */
export function constrainLineEnd(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx === 0 && ady === 0) return { ...b }
  const angle = Math.atan2(ady, adx) // 0..PI/2
  const sx = dx < 0 ? -1 : 1
  const sy = dy < 0 ? -1 : 1
  if (angle < Math.PI / 8) return { x: b.x, y: a.y }
  if (angle > (3 * Math.PI) / 8) return { x: a.x, y: b.y }
  const d = Math.round((adx + ady) / 2)
  return { x: a.x + sx * d, y: a.y + sy * d }
}

export interface ShapeParams {
  thickness: number
  filled: boolean
  /** Shift held: square / circle / 45 degree line. */
  constrain: boolean
  mirrorX: boolean
  mirrorY: boolean
}

function withMirror(img: Raster, p: { mirrorX: boolean; mirrorY: boolean }, draw: (img: Raster) => unknown): void {
  if (p.mirrorX || p.mirrorY) mirrorDraw(img, { horizontal: p.mirrorX, vertical: p.mirrorY }, draw)
  else draw(img)
}

/** One segment of a freehand stroke (a single pixel when a == b). */
export function applyStrokeSegment(
  img: Raster,
  a: Point,
  b: Point,
  color: number,
  p: { thickness: number; mirrorX: boolean; mirrorY: boolean }
): void {
  withMirror(img, p, (r) => drawLine(r as Raster, a.x, a.y, b.x, b.y, color, { thickness: p.thickness }))
}

/** Draw a line / rectangle / ellipse dragged from `a` to `b`. */
export function applyShape(img: Raster, tool: 'line' | 'rect' | 'ellipse', a: Point, b: Point, color: number, p: ShapeParams): void {
  withMirror(img, p, (r) => {
    const t = { thickness: p.thickness }
    if (tool === 'line') {
      const end = p.constrain ? constrainLineEnd(a, b) : b
      drawLine(r as Raster, a.x, a.y, end.x, end.y, color, t)
    } else {
      const rc = normalizeShapeRect(a, b, p.constrain)
      if (tool === 'rect') drawRect(r as Raster, rc.x, rc.y, rc.w, rc.h, color, { ...t, filled: p.filled })
      else drawEllipse(r as Raster, rc.x, rc.y, rc.w, rc.h, color, { ...t, filled: p.filled })
    }
  })
}

/** Reset every pixel of `after` outside `sel` back to `before` (painting is restricted to the selection). */
export function clipToSelection(before: Raster, after: Raster, sel: Rect | null): void {
  if (!sel) return
  const { width, height } = after
  for (let y = 0; y < height; y++) {
    const inY = y >= sel.y && y < sel.y + sel.h
    for (let x = 0; x < width; x++) {
      if (inY && x >= sel.x && x < sel.x + sel.w) continue
      const i = y * width + x
      after.data[i] = before.data[i]!
    }
  }
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return normalizeShapeRect(a, b, false)
}

// ------------------------------------------------------------------ controller

type Drag =
  | { kind: 'stroke'; layerId: string; frameId: string; before: Raster; work: Raster; last: Point; color: number; label: string }
  | { kind: 'shape'; tool: 'line' | 'rect' | 'ellipse'; layerId: string; frameId: string; before: Raster; work: Raster; start: Point; color: number }
  | { kind: 'picker'; button: number }
  | { kind: 'marquee'; start: Point; moved: boolean }
  | { kind: 'move'; layerId: string; frameId: string; before: Raster; lifted: Raster; sel: Rect; start: Point; work: Raster; rect: Rect }

export class ToolController {
  /** Live preview of the running gesture (null when idle). */
  preview: Preview | null = null
  /** Last user-facing problem ("Layer is locked"), cleared on the next successful gesture. */
  message: string | null = null
  private drag: Drag | null = null

  constructor(
    private readonly session: EditorSession,
    private readonly onChange: () => void = () => undefined
  ) {}

  get active(): boolean {
    return this.drag !== null
  }

  private setMessage(m: string | null): void {
    this.message = m
  }

  /** Checks that the active layer can be painted on; sets `message` when it cannot. */
  private paintTarget(): { layerId: string; frameId: string; before: Raster } | null {
    const layer = this.session.activeLayer
    const frame = this.session.activeFrame
    if (layer.locked) {
      this.setMessage(`Layer "${layer.name}" is locked.`)
      return null
    }
    if (layer.kind === 'reference') {
      this.setMessage(`Layer "${layer.name}" is a reference layer and cannot be painted.`)
      return null
    }
    const doc = this.session.doc
    return { layerId: layer.id, frameId: frame.id, before: celToRaster(getCel(doc, layer.id, frame.id), doc.width, doc.height) }
  }

  private colorFor(button: number, eraser: boolean): number {
    if (eraser) return 0
    return hexToRgba(button === 2 ? this.session.secondaryColor : this.session.primaryColor)
  }

  begin(p: Point, button: number, mods: Modifiers, s: ToolSettings): void {
    if (this.drag) return
    this.setMessage(null)
    const tool: ToolId = mods.alt && s.tool !== 'select' ? 'picker' : s.tool
    switch (tool) {
      case 'picker':
        this.drag = { kind: 'picker', button }
        this.pick(p, button)
        break
      case 'pencil':
      case 'eraser': {
        const t = this.paintTarget()
        if (!t) return
        const work = cloneRaster(t.before)
        const color = this.colorFor(button, tool === 'eraser')
        const drag: Drag = { kind: 'stroke', ...t, work, last: p, color, label: tool === 'eraser' ? 'Erase' : 'Pencil' }
        this.drag = drag
        applyStrokeSegment(work, p, p, color, { thickness: s.brushSize, mirrorX: s.mirrorX, mirrorY: s.mirrorY })
        this.updateStrokePreview(drag)
        break
      }
      case 'fill': {
        const t = this.paintTarget()
        if (!t) return
        const sel = this.session.selection
        if (sel && !pointInRect(p, sel)) return
        const work = cloneRaster(t.before)
        floodFill(work, p.x, p.y, this.colorFor(button, false), { contiguous: s.fillContiguous })
        this.commit(t.layerId, t.frameId, t.before, work, 'Fill')
        break
      }
      case 'line':
      case 'rect':
      case 'ellipse': {
        const t = this.paintTarget()
        if (!t) return
        const drag: Drag = { kind: 'shape', tool, ...t, work: cloneRaster(t.before), start: p, color: this.colorFor(button, false) }
        this.drag = drag
        this.updateShapePreview(drag, p, mods, s)
        break
      }
      case 'select': {
        const sel = this.session.selection
        if (sel && pointInRect(p, sel)) {
          const t = this.paintTarget()
          if (!t) return
          this.drag = { kind: 'move', ...t, lifted: copyRegion(t.before, sel), sel, start: p, work: cloneRaster(t.before), rect: sel }
        } else {
          this.drag = { kind: 'marquee', start: p, moved: false }
        }
        break
      }
    }
    this.onChange()
  }

  move(p: Point, mods: Modifiers, s: ToolSettings): void {
    const d = this.drag
    if (!d) return
    switch (d.kind) {
      case 'picker':
        this.pick(p, d.button)
        break
      case 'stroke':
        if (p.x === d.last.x && p.y === d.last.y) return
        applyStrokeSegment(d.work, d.last, p, d.color, { thickness: s.brushSize, mirrorX: s.mirrorX, mirrorY: s.mirrorY })
        d.last = p
        this.updateStrokePreview(d)
        break
      case 'shape':
        this.updateShapePreview(d, p, mods, s)
        break
      case 'marquee':
        if (p.x !== d.start.x || p.y !== d.start.y) d.moved = true
        if (d.moved) this.session.setSelection(rectFromPoints(d.start, p))
        break
      case 'move': {
        const dx = p.x - d.start.x
        const dy = p.y - d.start.y
        d.rect = { x: d.sel.x + dx, y: d.sel.y + dy, w: d.sel.w, h: d.sel.h }
        const work = cloneRaster(d.before)
        clearRaster(work, d.sel)
        stamp(work, d.lifted, d.rect.x, d.rect.y)
        d.work = work
        this.preview = { layerId: d.layerId, frameId: d.frameId, raster: work, selection: d.rect }
        break
      }
    }
    this.onChange()
  }

  end(p: Point, mods: Modifiers, s: ToolSettings): void {
    const d = this.drag
    if (!d) return
    if (d.kind === 'shape') this.updateShapePreview(d, p, mods, s)
    this.drag = null
    this.preview = null
    switch (d.kind) {
      case 'stroke':
        this.commit(d.layerId, d.frameId, d.before, d.work, d.label)
        break
      case 'shape':
        this.commit(d.layerId, d.frameId, d.before, d.work, d.tool === 'line' ? 'Line' : d.tool === 'rect' ? 'Rectangle' : 'Ellipse')
        break
      case 'marquee':
        if (!d.moved) this.session.setSelection(null)
        break
      case 'move':
        if (d.rect.x !== d.sel.x || d.rect.y !== d.sel.y) {
          this.commit(d.layerId, d.frameId, d.before, d.work, 'Move selection', false)
          this.session.setSelection(d.rect)
        }
        break
      default:
        break
    }
    this.onChange()
  }

  cancel(): void {
    if (!this.drag) return
    this.drag = null
    this.preview = null
    this.onChange()
  }

  /** Delete the pixels inside the selection on the active cel (Delete key). */
  clearSelectionPixels(): void {
    const sel = this.session.selection
    if (!sel) return
    const t = this.paintTarget()
    if (!t) return
    const work = cloneRaster(t.before)
    clearRaster(work, sel)
    this.commit(t.layerId, t.frameId, t.before, work, 'Clear selection', false)
  }

  // ---------------------------------------------------------------- internals

  private pick(p: Point, button: number): void {
    const doc = this.session.doc
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return
    const px = flattenFrame(doc, this.session.activeFrame.id)[p.y * doc.width + p.x]!
    if (px >>> 24 === 0) return
    const hex = rgbaToHex(px)
    if (button === 2) this.session.setSecondaryColor(hex)
    else this.session.setPrimaryColor(hex)
  }

  private updateStrokePreview(d: Extract<Drag, { kind: 'stroke' }>): void {
    clipToSelection(d.before, d.work, this.session.selection)
    this.preview = { layerId: d.layerId, frameId: d.frameId, raster: d.work }
  }

  private updateShapePreview(d: Extract<Drag, { kind: 'shape' }>, p: Point, mods: Modifiers, s: ToolSettings): void {
    const work = cloneRaster(d.before)
    applyShape(work, d.tool, d.start, p, d.color, {
      thickness: s.brushSize,
      filled: s.shapeFilled,
      constrain: mods.shift,
      mirrorX: s.mirrorX,
      mirrorY: s.mirrorY
    })
    clipToSelection(d.before, work, this.session.selection)
    d.work = work
    this.preview = { layerId: d.layerId, frameId: d.frameId, raster: work }
  }

  private commit(layerId: string, frameId: string, before: Raster, after: Raster, label: string, clip = true): void {
    if (clip) clipToSelection(before, after, this.session.selection)
    const cmd = createRasterDiffCommand(layerId, frameId, before, after, label)
    if (cmd) this.session.execute(cmd)
  }
}
