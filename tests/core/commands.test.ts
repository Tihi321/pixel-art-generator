import { describe, expect, it } from 'vitest'
import {
  type Command,
  type Document,
  History,
  celKey,
  createAddColorsCommand,
  createAddFrameCommand,
  createAddLayerCommand,
  createClearCelCommand,
  createCopyCelCommand,
  createCreateTagCommand,
  createDeleteFrameCommand,
  createDeleteLayerCommand,
  createDeleteTagCommand,
  createDocument,
  createDuplicateFrameCommand,
  createDuplicateLayerCommand,
  createMergeDownCommand,
  createMoveFrameCommand,
  createMoveLayerCommand,
  createPaintCommand,
  createRemapToPaletteCommand,
  createRemoveColorsCommand,
  createReplaceDocumentCommand,
  createResizeCanvasCommand,
  createSetFrameDurationCommand,
  createSetPaletteCommand,
  createSetReferencesCommand,
  createUpdateLayerCommand,
  createUpdateTagCommand,
  drawRect,
  hexToRgba,
  packRgba,
  setPixels,
  getBuiltinPalette,
  celToRaster
} from '../../src/core'
import { BLACK, BLUE, GREEN, RED, firstFrameId, firstLayerId, smallDoc, snapshot } from './helpers'

/** Execute, then verify undo restores the exact snapshot and redo reproduces the after state. */
function roundTrip(doc: Document, history: History, cmd: Command): void {
  const before = snapshot(doc)
  history.execute(cmd)
  const after = snapshot(doc)
  expect(after).not.toEqual(before)
  expect(history.undo()).toBe(true)
  expect(snapshot(doc)).toEqual(before)
  expect(history.redo()).toBe(true)
  expect(snapshot(doc)).toEqual(after)
}

function paintPixels(doc: Document, layer: string, frame: string, pts: Array<[number, number, number]>): Command {
  const cmd = createPaintCommand(doc, {
    layer,
    frame,
    mutate: (img) => setPixels(img, pts.map(([x, y, color]) => ({ x, y, color })))
  })
  if (!cmd) throw new Error('no-op paint')
  return cmd
}

describe('pixel edit commands', () => {
  it('creates, grows, shrinks and removes cels through undo/redo', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)

    roundTrip(doc, h, paintPixels(doc, l, f, [[2, 2, RED]]))
    expect(doc.cels.get(celKey(l, f))).toMatchObject({ x: 2, y: 2, w: 1, h: 1 })

    // Paint far away: the cel grows to cover both pixels.
    roundTrip(doc, h, paintPixels(doc, l, f, [[5, 6, GREEN]]))
    expect(doc.cels.get(celKey(l, f))).toMatchObject({ x: 2, y: 2, w: 4, h: 5 })

    // Undo twice -> cel gone entirely.
    h.undo()
    h.undo()
    expect(doc.cels.size).toBe(0)
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(true)
  })

  it('erasing the last pixel removes the cel and undo brings it back', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)
    h.execute(paintPixels(doc, l, f, [[1, 1, RED]]))
    roundTrip(doc, h, paintPixels(doc, l, f, [[1, 1, 0]]))
    expect(doc.cels.size).toBe(0) // erased cel is removed
    expect(h.undo()).toBe(true)
    expect(doc.cels.get(celKey(l, f))?.data[0]).toBe(RED)
  })

  it('returns null for no-op paints and rejects locked layers', () => {
    const doc = smallDoc()
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)
    expect(createPaintCommand(doc, { layer: l, frame: f, mutate: () => undefined })).toBeNull()
    const h = new History(doc)
    h.execute(createUpdateLayerCommand(doc, l, { locked: true }))
    expect(() => paintPixels(doc, l, f, [[0, 0, RED]])).toThrow(/locked/)
  })

  it('stores a diff rectangle only', () => {
    const doc = smallDoc(64, 64)
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)
    const cmd = createPaintCommand(doc, {
      layer: l,
      frame: f,
      mutate: (img) => drawRect(img, 10, 10, 3, 3, RED, { filled: true })
    })!
    new History(doc).execute(cmd)
    expect(doc.cels.get(celKey(l, f))).toMatchObject({ x: 10, y: 10, w: 3, h: 3 })
  })
})

describe('History', () => {
  it('supports transactions as a single undo step, nested-safe', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)
    const before = snapshot(doc)
    h.beginTransaction('Agent turn')
    h.execute(paintPixels(doc, l, f, [[0, 0, RED]]))
    h.beginTransaction('inner')
    h.execute(paintPixels(doc, l, f, [[1, 0, GREEN]]))
    h.commitTransaction()
    expect(h.inTransaction()).toBe(true)
    h.execute(createAddFrameCommand(doc))
    h.commitTransaction()
    expect(h.undoDepth).toBe(1)
    expect(h.undoLabel()).toBe('Agent turn')
    const after = snapshot(doc)
    h.undo()
    expect(snapshot(doc)).toEqual(before)
    h.redo()
    expect(snapshot(doc)).toEqual(after)
  })

  it('abortTransaction rolls back only the innermost transaction', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)
    h.beginTransaction('outer')
    h.execute(paintPixels(doc, l, f, [[0, 0, RED]]))
    const mid = snapshot(doc)
    h.beginTransaction('inner')
    h.execute(paintPixels(doc, l, f, [[3, 3, BLUE]]))
    h.abortTransaction()
    expect(snapshot(doc)).toEqual(mid)
    h.commitTransaction()
    expect(h.undoDepth).toBe(1)
    h.undo()
    expect(doc.cels.size).toBe(0)
  })

  it('transaction() helper aborts and rethrows on error; empty transactions push nothing', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const before = snapshot(doc)
    expect(() =>
      h.transaction('boom', () => {
        h.execute(createAddFrameCommand(doc))
        throw new Error('fail')
      })
    ).toThrow('fail')
    expect(snapshot(doc)).toEqual(before)
    expect(h.inTransaction()).toBe(false)
    h.transaction('empty', () => undefined)
    expect(h.undoDepth).toBe(0)
    expect(() => h.commitTransaction()).toThrow()
  })

  it('blocks undo/redo during a transaction, clears redo on new edits, honours maxDepth, notifies listeners', () => {
    const doc = smallDoc()
    const h = new History(doc, { maxDepth: 3 })
    const events: string[] = []
    const off = h.subscribe((e) => events.push(e.type))
    for (let i = 0; i < 5; i++) h.execute(createAddFrameCommand(doc))
    expect(h.undoDepth).toBe(3)
    expect(doc.frames.length).toBe(6)
    h.undo()
    expect(h.canRedo()).toBe(true)
    h.beginTransaction('t')
    expect(h.canUndo()).toBe(false)
    expect(h.undo()).toBe(false)
    h.execute(createAddFrameCommand(doc))
    expect(h.canRedo()).toBe(false)
    h.commitTransaction()
    off()
    h.undo()
    expect(events).toContain('execute')
    expect(events).toContain('undo')
    expect(events).toContain('transaction-commit')
    expect(events.filter((e) => e === 'undo').length).toBe(1) // listener removed before the last undo
  })
})

describe('layer commands', () => {
  it('adds, updates, moves, duplicates, merges and deletes layers (each undoable)', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l0 = firstLayerId(doc)
    const f = firstFrameId(doc)
    h.execute(paintPixels(doc, l0, f, [[0, 0, RED]]))

    const add = createAddLayerCommand(doc, { name: 'Top' })
    roundTrip(doc, h, add)
    const top = add.createdId
    expect(doc.layers.map((l) => l.name)).toEqual(['Layer 1', 'Top'])

    roundTrip(doc, h, createUpdateLayerCommand(doc, top, { name: 'Renamed', opacity: 0.5, blend: 'multiply', visible: false, locked: true }))
    expect(doc.layers[1]).toMatchObject({ name: 'Renamed', opacity: 0.5, blend: 'multiply', visible: false, locked: true })
    expect(() => createUpdateLayerCommand(doc, top, { opacity: 2 })).toThrow(/Opacity/)
    expect(() => createUpdateLayerCommand(doc, top, { blend: 'bogus' as never })).toThrow(/blend mode/)
    h.execute(createUpdateLayerCommand(doc, top, { visible: true, locked: false, opacity: 1, blend: 'normal', name: 'Top' }))

    roundTrip(doc, h, createMoveLayerCommand(doc, top, 0))
    expect(doc.layers[0]!.id).toBe(top)
    h.execute(createMoveLayerCommand(doc, top, 1))

    const dup = createDuplicateLayerCommand(doc, l0)
    roundTrip(doc, h, dup)
    expect(doc.layers[1]!.id).toBe(dup.createdId)
    expect(doc.cels.get(celKey(dup.createdId, f))?.data[0]).toBe(RED)
    // duplicate is independent of the original
    h.execute(paintPixels(doc, dup.createdId, f, [[0, 0, GREEN]]))
    expect(doc.cels.get(celKey(l0, f))?.data[0]).toBe(RED)

    // merge the duplicate (green) down onto the original layer
    roundTrip(doc, h, createMergeDownCommand(doc, dup.createdId))
    expect(doc.layers.find((l) => l.id === dup.createdId)).toBeUndefined()
    expect(celToRaster(doc.cels.get(celKey(l0, f)), 8, 8).data[0]).toBe(GREEN)

    roundTrip(doc, h, createDeleteLayerCommand(doc, l0))
    expect(doc.cels.has(celKey(l0, f))).toBe(false)
    // cannot delete the last layer
    expect(doc.layers.map((l) => l.id)).toEqual([top])
    expect(() => createDeleteLayerCommand(doc, top)).toThrow(/last/)
  })

  it('merge down respects the merged layer opacity', () => {
    const doc = smallDoc(2, 1)
    const h = new History(doc)
    const l0 = firstLayerId(doc)
    const f = firstFrameId(doc)
    h.execute(paintPixels(doc, l0, f, [[0, 0, BLACK]]))
    const add = createAddLayerCommand(doc, { opacity: 0.5 })
    h.execute(add)
    h.execute(paintPixels(doc, add.createdId, f, [[0, 0, packRgba(255, 255, 255)]]))
    h.execute(createMergeDownCommand(doc, add.createdId))
    const px = doc.cels.get(celKey(l0, f))!.data[0]!
    expect(px & 255).toBe(128)
    expect(px >>> 24).toBe(255)
  })

  it('gives helpful errors for unknown layers', () => {
    const doc = smallDoc()
    expect(() => createDeleteLayerCommand(doc, 'nope')).toThrow(/not found.*Available layers/)
  })
})

describe('frame and tag commands', () => {
  it('adds, duplicates, moves, sets duration and deletes frames; tags follow', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f0 = firstFrameId(doc)
    h.execute(paintPixels(doc, l, f0, [[0, 0, RED]]))

    const add = createAddFrameCommand(doc, { durationMs: 250 })
    roundTrip(doc, h, add)
    expect(doc.frames[1]).toMatchObject({ id: add.createdId, durationMs: 250 })

    const dup = createDuplicateFrameCommand(doc, 0)
    roundTrip(doc, h, dup)
    expect(doc.frames.map((f) => f.id)).toEqual([f0, dup.createdId, add.createdId])
    expect(doc.cels.get(celKey(l, dup.createdId))?.data[0]).toBe(RED)

    const tag = createCreateTagCommand(doc, { name: 'idle', from: 0, to: 1, direction: 'pingpong', loop: false })
    roundTrip(doc, h, tag)
    expect(doc.tags[0]).toMatchObject({ name: 'idle', from: 0, to: 1, direction: 'pingpong', loop: false })

    // inserting a frame at the front shifts the tag
    const front = createAddFrameCommand(doc, { index: 0 })
    roundTrip(doc, h, front)
    expect(doc.tags[0]).toMatchObject({ from: 1, to: 2 })

    roundTrip(doc, h, createMoveFrameCommand(doc, front.createdId, 3))
    expect(doc.frames[3]!.id).toBe(front.createdId)
    expect(doc.tags[0]).toMatchObject({ from: 0, to: 1 })

    roundTrip(doc, h, createSetFrameDurationCommand(doc, 'all', 40))
    expect(doc.frames.every((f) => f.durationMs === 40)).toBe(true)
    expect(() => createSetFrameDurationCommand(doc, 0, 0)).toThrow(/duration/)

    // deleting a frame inside a tag shrinks it; removing the only frame of a tag deletes the tag
    roundTrip(doc, h, createDeleteFrameCommand(doc, dup.createdId))
    expect(doc.cels.has(celKey(l, dup.createdId))).toBe(false)
    expect(doc.tags[0]).toMatchObject({ from: 0, to: 0 })
    roundTrip(doc, h, createDeleteFrameCommand(doc, 0))
    expect(doc.tags).toHaveLength(0)
  })

  it('cannot delete the last frame; validates tags', () => {
    const doc = smallDoc()
    expect(() => createDeleteFrameCommand(doc, 0)).toThrow(/last/)
    expect(() => createCreateTagCommand(doc, { name: 'x', from: 0, to: 3 })).toThrow(/range/)
    expect(() => createCreateTagCommand(doc, { name: ' ', from: 0, to: 0 })).toThrow(/empty/)
    const h = new History(doc)
    h.execute(createCreateTagCommand(doc, { name: 'walk', from: 0, to: 0 }))
    expect(() => createCreateTagCommand(doc, { name: 'WALK', from: 0, to: 0 })).toThrow(/already exists/)
    expect(() => createUpdateTagCommand(doc, 'missing', {})).toThrow(/not found/)
  })

  it('updates and deletes tags', () => {
    const doc = smallDoc()
    const h = new History(doc)
    h.execute(createAddFrameCommand(doc))
    h.execute(createAddFrameCommand(doc))
    h.execute(createCreateTagCommand(doc, { name: 'a', from: 0, to: 0 }))
    roundTrip(doc, h, createUpdateTagCommand(doc, 'a', { name: 'b', to: 2, direction: 'reverse' }))
    expect(doc.tags[0]).toMatchObject({ name: 'b', from: 0, to: 2, direction: 'reverse' })
    roundTrip(doc, h, createDeleteTagCommand(doc, 'b'))
    expect(doc.tags).toHaveLength(0)
  })
})

describe('cel and canvas commands', () => {
  it('copies and clears cels', () => {
    const doc = smallDoc()
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f0 = firstFrameId(doc)
    h.execute(paintPixels(doc, l, f0, [[1, 1, RED]]))
    const add = createAddFrameCommand(doc)
    h.execute(add)
    roundTrip(doc, h, createCopyCelCommand(doc, { fromLayer: l, fromFrame: f0, toLayer: l, toFrame: add.createdId }))
    expect(doc.cels.get(celKey(l, add.createdId))?.data[0]).toBe(RED)
    // the copy is independent
    h.execute(paintPixels(doc, l, add.createdId, [[1, 1, BLUE]]))
    expect(doc.cels.get(celKey(l, f0))?.data[0]).toBe(RED)
    roundTrip(doc, h, createClearCelCommand(doc, l, f0))
    expect(doc.cels.has(celKey(l, f0))).toBe(false)
  })

  it('resizes the canvas with anchors, cropping and padding', () => {
    const doc = smallDoc(4, 4)
    const h = new History(doc)
    const l = firstLayerId(doc)
    const f = firstFrameId(doc)
    h.execute(paintPixels(doc, l, f, [[0, 0, RED], [3, 3, BLUE]]))

    roundTrip(doc, h, createResizeCanvasCommand(doc, 8, 8, 'center'))
    expect([doc.width, doc.height]).toEqual([8, 8])
    let r = celToRaster(doc.cels.get(celKey(l, f)), 8, 8)
    expect(r.data[2 * 8 + 2]).toBe(RED)
    expect(r.data[5 * 8 + 5]).toBe(BLUE)
    h.undo()

    roundTrip(doc, h, createResizeCanvasCommand(doc, 2, 2, 'top-left'))
    r = celToRaster(doc.cels.get(celKey(l, f)), 2, 2)
    expect(r.data[0]).toBe(RED)
    expect(doc.cels.get(celKey(l, f))).toMatchObject({ w: 2, h: 2 }) // clipped to the new canvas; the blue pixel is gone
    h.undo()

    h.execute(createResizeCanvasCommand(doc, 2, 2, 'bottom-right'))
    r = celToRaster(doc.cels.get(celKey(l, f)), 2, 2)
    expect(r.data[3]).toBe(BLUE)
    expect(() => createResizeCanvasCommand(doc, 0, 5)).toThrow(/Invalid canvas size/)
  })
})

describe('palette commands', () => {
  it('sets, adds and removes colors', () => {
    const doc = smallDoc()
    const h = new History(doc)
    roundTrip(doc, h, createSetPaletteCommand(doc, { name: 'Mine', colors: ['#F00', { hex: '#00ff00', name: 'green' }] }))
    expect(doc.palette.colors).toEqual([{ hex: '#ff0000' }, { hex: '#00ff00', name: 'green' }])
    roundTrip(doc, h, createAddColorsCommand(doc, ['#0000ff', '#ff0000']))
    expect(doc.palette.colors.map((c) => c.hex)).toEqual(['#ff0000', '#00ff00', '#0000ff'])
    roundTrip(doc, h, createRemoveColorsCommand(doc, [0, '#0000FF']))
    expect(doc.palette.colors.map((c) => c.hex)).toEqual(['#00ff00'])
    expect(() => createRemoveColorsCommand(doc, [9])).toThrow(/out of range/)
    expect(() => createSetPaletteCommand(doc, { colors: [] })).toThrow(/at least one/)
  })

  it('remaps pixels to the nearest palette color (all layers, or one layer/frame)', () => {
    const doc = smallDoc(3, 1)
    const h = new History(doc)
    const l0 = firstLayerId(doc)
    const f = firstFrameId(doc)
    const add = createAddLayerCommand(doc, {})
    h.execute(add)
    const near = (r: number, g: number, b: number): number => packRgba(r, g, b)
    h.execute(paintPixels(doc, l0, f, [[0, 0, near(250, 10, 10)], [1, 0, near(10, 240, 20)], [2, 0, packRgba(12, 12, 250, 128)]]))
    h.execute(paintPixels(doc, add.createdId, f, [[0, 0, near(240, 20, 20)]]))
    h.execute(createSetPaletteCommand(doc, { colors: ['#ff0000', '#00ff00', '#0000ff'] }))

    const only = createRemapToPaletteCommand(doc, { layer: add.createdId, mode: 'rgb' })
    roundTrip(doc, h, only)
    expect(doc.cels.get(celKey(add.createdId, f))!.data[0]).toBe(RED)
    expect(doc.cels.get(celKey(l0, f))!.data[0]).not.toBe(RED) // other layer untouched
    h.undo()

    roundTrip(doc, h, createRemapToPaletteCommand(doc, { mode: 'perceptual' }))
    const d = doc.cels.get(celKey(l0, f))!.data
    expect(Array.from(d.subarray(0, 2))).toEqual([RED, GREEN])
    expect(d[2]! >>> 24).toBe(128) // alpha preserved
    expect(d[2]! & 0xffffff).toBe(hexToRgba('#0000ff') & 0xffffff)
  })

  it('remaps to a builtin palette and optionally adopts it', () => {
    const doc = smallDoc(1, 1)
    const h = new History(doc)
    h.execute(paintPixels(doc, firstLayerId(doc), firstFrameId(doc), [[0, 0, packRgba(200, 200, 200)]]))
    const gb = getBuiltinPalette('gameboy')!
    roundTrip(doc, h, createRemapToPaletteCommand(doc, { palette: gb }))
    expect(doc.palette.id).toBe('gameboy')
    const px = doc.cels.get(celKey(firstLayerId(doc), firstFrameId(doc)))!.data[0]!
    expect(px).toBe(hexToRgba('#9bbc0f'))
  })
})

describe('document level commands', () => {
  it('sets references', () => {
    const doc = smallDoc()
    const h = new History(doc)
    roundTrip(doc, h, createSetReferencesCommand(doc, [{ assetId: 'knight', note: 'match palette' }]))
  })

  it('replaces the whole document in place and undoes it', () => {
    const doc = smallDoc(8, 8)
    const h = new History(doc)
    h.execute(paintPixels(doc, firstLayerId(doc), firstFrameId(doc), [[1, 1, RED]]))
    const next = createDocument({ width: 16, height: 4, name: 'other' })
    const nextLayer = next.layers[0]!.id
    const nextFrame = next.frames[0]!.id
    next.cels.set(celKey(nextLayer, nextFrame), { x: 0, y: 0, w: 1, h: 1, data: Uint32Array.of(BLUE) })
    const ref = doc
    roundTrip(doc, h, createReplaceDocumentCommand(doc, next))
    expect(doc).toBe(ref)
    expect(doc).toMatchObject({ name: 'other', width: 16, height: 4 })
    expect(doc.cels.get(celKey(nextLayer, nextFrame))?.data[0]).toBe(BLUE)
    h.undo()
    expect(doc.name).toBe('test')
    expect(doc.cels.size).toBe(1)
  })
})
