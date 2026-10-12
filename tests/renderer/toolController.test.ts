import { describe, expect, it } from 'vitest'
import {
  type Modifiers,
  type ToolSettings,
  ToolController,
  applyShape,
  applyStrokeSegment,
  clipToSelection,
  constrainLineEnd,
  normalizeShapeRect
} from '../../src/renderer/lib/toolController'
import { type Raster, celToRaster, createAddLayerCommand, createDocument, createRaster, getCel, hexToRgba } from '../../src/core'
import { EditorSession } from '../../src/tools/session'
import { RED } from '../core/helpers'

const NO_MODS: Modifiers = { alt: false, shift: false, ctrl: false }
const base: ToolSettings = { tool: 'pencil', brushSize: 1, mirrorX: false, mirrorY: false, shapeFilled: false, fillContiguous: true }
const px = (r: Raster, x: number, y: number): number => r.data[y * r.width + x]!
const count = (r: Raster): number => r.data.filter((v) => v !== 0).length

function newSession(w = 8, h = 8): EditorSession {
  const s = new EditorSession(createDocument({ width: w, height: h, name: 'test' }))
  s.setPrimaryColor('#ff0000')
  s.setSecondaryColor('#0000ff')
  return s
}

function layerRaster(s: EditorSession): Raster {
  const d = s.doc
  return celToRaster(getCel(d, s.activeLayer.id, s.activeFrame.id), d.width, d.height)
}

describe('shape helpers', () => {
  it('normalizes inclusive rects, optionally square', () => {
    expect(normalizeShapeRect({ x: 5, y: 5 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3, w: 4, h: 3 })
    expect(normalizeShapeRect({ x: 2, y: 2 }, { x: 5, y: 3 }, true)).toEqual({ x: 2, y: 2, w: 4, h: 4 })
    expect(normalizeShapeRect({ x: 5, y: 5 }, { x: 3, y: 4 }, true)).toEqual({ x: 3, y: 3, w: 3, h: 3 })
  })

  it('constrains lines to 45 degree steps', () => {
    expect(constrainLineEnd({ x: 0, y: 0 }, { x: 10, y: 2 })).toEqual({ x: 10, y: 0 })
    expect(constrainLineEnd({ x: 0, y: 0 }, { x: 2, y: 10 })).toEqual({ x: 0, y: 10 })
    expect(constrainLineEnd({ x: 0, y: 0 }, { x: 6, y: 5 })).toEqual({ x: 6, y: 6 })
    expect(constrainLineEnd({ x: 4, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 1 })
  })

  it('mirrors strokes across both axes', () => {
    const r = createRaster(8, 8)
    applyStrokeSegment(r, { x: 1, y: 1 }, { x: 1, y: 1 }, RED, { thickness: 1, mirrorX: true, mirrorY: true })
    expect([px(r, 1, 1), px(r, 6, 1), px(r, 1, 6), px(r, 6, 6)]).toEqual([RED, RED, RED, RED])
    expect(count(r)).toBe(4)
  })

  it('draws outlined and filled rectangles', () => {
    const p = { thickness: 1, filled: false, constrain: false, mirrorX: false, mirrorY: false }
    const r = createRaster(8, 8)
    applyShape(r, 'rect', { x: 1, y: 1 }, { x: 4, y: 4 }, RED, p)
    expect(px(r, 1, 1)).toBe(RED)
    expect(px(r, 2, 2)).toBe(0)
    expect(count(r)).toBe(12)
    const f = createRaster(8, 8)
    applyShape(f, 'rect', { x: 1, y: 1 }, { x: 4, y: 4 }, RED, { ...p, filled: true })
    expect(count(f)).toBe(16)
  })

  it('clips results to a selection', () => {
    const before = createRaster(4, 4)
    const after = createRaster(4, 4)
    after.data.fill(RED)
    clipToSelection(before, after, { x: 1, y: 1, w: 2, h: 2 })
    expect(count(after)).toBe(4)
    expect(px(after, 0, 0)).toBe(0)
    expect(px(after, 1, 1)).toBe(RED)
  })
})

describe('ToolController', () => {
  it('records a whole pencil stroke as ONE undo step and previews while dragging', () => {
    const s = newSession()
    const c = new ToolController(s)
    const depth = s.history.undoDepth
    c.begin({ x: 0, y: 0 }, 0, NO_MODS, base)
    expect(s.history.undoDepth).toBe(depth)
    c.move({ x: 3, y: 0 }, NO_MODS, base)
    expect(px(c.preview!.raster!, 2, 0)).toBe(RED)
    expect(getCel(s.doc, s.activeLayer.id, s.activeFrame.id)).toBeUndefined()
    c.end({ x: 3, y: 0 }, NO_MODS, base)
    expect(c.preview).toBeNull()
    expect(s.history.undoDepth).toBe(depth + 1)
    expect(count(layerRaster(s))).toBe(4)
    s.undo()
    expect(count(layerRaster(s))).toBe(0)
    s.redo()
    expect(count(layerRaster(s))).toBe(4)
  })

  it('uses the secondary colour for the right button and the eraser clears', () => {
    const s = newSession()
    const c = new ToolController(s)
    c.begin({ x: 1, y: 1 }, 2, NO_MODS, base)
    c.end({ x: 1, y: 1 }, NO_MODS, base)
    expect(px(layerRaster(s), 1, 1)).toBe(hexToRgba('#0000ff'))
    const eraser = { ...base, tool: 'eraser' as const }
    c.begin({ x: 1, y: 1 }, 0, NO_MODS, eraser)
    c.end({ x: 1, y: 1 }, NO_MODS, eraser)
    expect(px(layerRaster(s), 1, 1)).toBe(0)
  })

  it('flood fills in one step', () => {
    const s = newSession()
    const c = new ToolController(s)
    c.begin({ x: 2, y: 2 }, 0, NO_MODS, { ...base, tool: 'fill' })
    expect(s.history.undoLabel()).toBe('Fill')
    expect(layerRaster(s).data.every((v) => v === RED)).toBe(true)
  })

  it('previews shapes while dragging and commits on release', () => {
    const s = newSession()
    const c = new ToolController(s)
    const line = { ...base, tool: 'line' as const }
    c.begin({ x: 0, y: 0 }, 0, NO_MODS, line)
    c.move({ x: 5, y: 0 }, NO_MODS, line)
    expect(count(c.preview!.raster!)).toBe(6)
    c.move({ x: 2, y: 0 }, NO_MODS, line)
    expect(count(c.preview!.raster!)).toBe(3)
    c.end({ x: 2, y: 0 }, NO_MODS, line)
    expect(count(layerRaster(s))).toBe(3)
    expect(s.history.undoLabel()).toBe('Line')
  })

  it('alt temporarily picks a colour without editing the document', () => {
    const s = newSession()
    const c = new ToolController(s)
    c.begin({ x: 0, y: 0 }, 0, NO_MODS, base)
    c.end({ x: 0, y: 0 }, NO_MODS, base)
    s.setPrimaryColor('#00ff00')
    const depth = s.history.undoDepth
    const alt = { ...NO_MODS, alt: true }
    c.begin({ x: 0, y: 0 }, 0, alt, base)
    c.end({ x: 0, y: 0 }, alt, base)
    expect(s.primaryColor).toBe('#ff0000')
    expect(s.history.undoDepth).toBe(depth)
  })

  it('refuses to paint on a locked layer', () => {
    const s = newSession()
    s.activeLayer.locked = true
    const c = new ToolController(s)
    c.begin({ x: 0, y: 0 }, 0, NO_MODS, base)
    expect(c.active).toBe(false)
    expect(c.message).toMatch(/locked/)
    expect(s.history.undoDepth).toBe(0)
  })

  it('draws on the active layer only', () => {
    const s = newSession()
    const cmd = createAddLayerCommand(s.doc, {})
    s.execute(cmd)
    s.setActiveLayer(cmd.createdId)
    const c = new ToolController(s)
    c.begin({ x: 2, y: 2 }, 0, NO_MODS, base)
    c.end({ x: 2, y: 2 }, NO_MODS, base)
    expect(getCel(s.doc, cmd.createdId, s.activeFrame.id)).toBeTruthy()
    expect(getCel(s.doc, s.doc.layers[0]!.id, s.activeFrame.id)).toBeUndefined()
  })

  it('selects with a marquee and moves the selection contents in one step', () => {
    const s = newSession()
    const c = new ToolController(s)
    c.begin({ x: 1, y: 1 }, 0, NO_MODS, base)
    c.end({ x: 1, y: 1 }, NO_MODS, base)
    const sel = { ...base, tool: 'select' as const }
    c.begin({ x: 0, y: 0 }, 0, NO_MODS, sel)
    c.move({ x: 2, y: 2 }, NO_MODS, sel)
    c.end({ x: 2, y: 2 }, NO_MODS, sel)
    expect(s.selection).toEqual({ x: 0, y: 0, w: 3, h: 3 })
    const depth = s.history.undoDepth
    c.begin({ x: 1, y: 1 }, 0, NO_MODS, sel)
    c.move({ x: 4, y: 3 }, NO_MODS, sel)
    expect(c.preview?.selection).toEqual({ x: 3, y: 2, w: 3, h: 3 })
    c.end({ x: 4, y: 3 }, NO_MODS, sel)
    expect(s.history.undoDepth).toBe(depth + 1)
    const r = layerRaster(s)
    expect(px(r, 1, 1)).toBe(0)
    expect(px(r, 4, 3)).toBe(RED)
    expect(s.selection).toEqual({ x: 3, y: 2, w: 3, h: 3 })
    // a click outside clears the selection
    c.begin({ x: 7, y: 7 }, 0, NO_MODS, sel)
    c.end({ x: 7, y: 7 }, NO_MODS, sel)
    expect(s.selection).toBeNull()
  })

  it('restricts painting to the selection', () => {
    const s = newSession()
    s.setSelection({ x: 0, y: 0, w: 2, h: 2 })
    const c = new ToolController(s)
    c.begin({ x: 0, y: 0 }, 0, NO_MODS, base)
    c.move({ x: 5, y: 0 }, NO_MODS, base)
    c.end({ x: 5, y: 0 }, NO_MODS, base)
    expect(count(layerRaster(s))).toBe(2)
  })
})
