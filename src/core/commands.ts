// Commands, undo/redo history and command factories. Pure TypeScript.
//
// Contract: a command factory inspects the document at creation time (it validates input and
// captures "before" state), so create a command and execute it right away, before building the
// next one. Factories throw an Error with a message suitable for showing to an LLM.

import {
  type AnimTag,
  type BlendMode,
  type Cel,
  type Document,
  type Frame,
  type Layer,
  type LayerKind,
  type Palette,
  type PaletteColor,
  type Rect,
  type RefLink,
  type TagDirection,
  BLEND_MODES,
  TAG_DIRECTIONS,
  assertDimensions,
  celKey,
  cloneCel,
  cloneFrame,
  cloneLayer,
  clonePalette,
  cloneTag,
  createFrame,
  createId,
  createLayer,
  frameIndex,
  layerIndex,
  normalizeHex,
  paletteToRgba,
  requireFrame,
  requireLayer,
  requireTag
} from './model'
import {
  type Raster,
  celToRaster,
  cloneRaster,
  compositeCel,
  isCelEmpty,
  rasterToCel
} from './raster'
import { createPaletteMatcher, type ColorSpace } from './color'

export interface Command {
  type: string
  label: string
  apply(doc: Document): void
  invert(doc: Document): void
}

/** A command that creates an entity; `createdId` is the id of the new layer/frame/tag. */
export type CreatingCommand = Command & { createdId: string }

// ================================================================= History

export type HistoryEventType = 'execute' | 'undo' | 'redo' | 'clear' | 'transaction-begin' | 'transaction-commit' | 'transaction-abort'

export interface HistoryEvent {
  type: HistoryEventType
  command?: Command
  /** True when the event happened while a transaction was open. */
  inTransaction: boolean
}

export interface HistoryOptions {
  /** Maximum undo steps kept (default 200). Oldest steps are dropped. */
  maxDepth?: number
}

interface TxFrame {
  label: string
  startIndex: number
}

export class History {
  readonly doc: Document
  private maxDepth: number
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private listeners = new Set<(e: HistoryEvent) => void>()
  private txCommands: Command[] = []
  private txStack: TxFrame[] = []
  /** Increments on every change to the document or the stacks. */
  version = 0

  constructor(doc: Document, opts: HistoryOptions = {}) {
    this.doc = doc
    this.maxDepth = Math.max(1, opts.maxDepth ?? 200)
  }

  subscribe(listener: (e: HistoryEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(type: HistoryEventType, command?: Command): void {
    this.version++
    const e: HistoryEvent = { type, command, inTransaction: this.txStack.length > 0 }
    for (const l of [...this.listeners]) l(e)
  }

  inTransaction(): boolean {
    return this.txStack.length > 0
  }

  canUndo(): boolean {
    return this.txStack.length === 0 && this.undoStack.length > 0
  }
  canRedo(): boolean {
    return this.txStack.length === 0 && this.redoStack.length > 0
  }
  undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label
  }
  redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label
  }
  get undoDepth(): number {
    return this.undoStack.length
  }
  get redoDepth(): number {
    return this.redoStack.length
  }

  /** Apply a command and record it (inside a transaction it joins the transaction). */
  execute(cmd: Command): void {
    cmd.apply(this.doc)
    this.redoStack = []
    if (this.txStack.length > 0) this.txCommands.push(cmd)
    else this.push(cmd)
    this.emit('execute', cmd)
  }

  private push(cmd: Command): void {
    this.undoStack.push(cmd)
    if (this.undoStack.length > this.maxDepth) this.undoStack.splice(0, this.undoStack.length - this.maxDepth)
  }

  undo(): boolean {
    if (!this.canUndo()) return false
    const cmd = this.undoStack.pop()!
    cmd.invert(this.doc)
    this.redoStack.push(cmd)
    this.emit('undo', cmd)
    return true
  }

  redo(): boolean {
    if (!this.canRedo()) return false
    const cmd = this.redoStack.pop()!
    cmd.apply(this.doc)
    this.undoStack.push(cmd)
    this.emit('redo', cmd)
    return true
  }

  /** Start grouping executed commands into one undo step. Nested calls are safe. */
  beginTransaction(label: string): void {
    this.txStack.push({ label, startIndex: this.txCommands.length })
    this.emit('transaction-begin')
  }

  /**
   * Finish the innermost transaction. The outermost commit pushes a single composite undo step
   * (nothing is pushed if no commands ran). Returns the composite when one was created.
   */
  commitTransaction(): Command | null {
    const frame = this.txStack.pop()
    if (!frame) throw new Error('commitTransaction() called without beginTransaction().')
    let composite: Command | null = null
    if (this.txStack.length === 0) {
      const cmds = this.txCommands
      this.txCommands = []
      if (cmds.length > 0) {
        composite = createCompositeCommand(frame.label, cmds)
        this.push(composite)
      }
    }
    this.emit('transaction-commit', composite ?? undefined)
    return composite
  }

  /** Roll back every command executed since the innermost beginTransaction() and close it. */
  abortTransaction(): void {
    const frame = this.txStack.pop()
    if (!frame) throw new Error('abortTransaction() called without beginTransaction().')
    const undone = this.txCommands.splice(frame.startIndex)
    for (let i = undone.length - 1; i >= 0; i--) undone[i]!.invert(this.doc)
    this.emit('transaction-abort')
  }

  /** Run fn inside a transaction: commits on success, aborts (and rethrows) on error. */
  transaction<T>(label: string, fn: () => T): T {
    this.beginTransaction(label)
    let result: T
    try {
      result = fn()
    } catch (e) {
      this.abortTransaction()
      throw e
    }
    this.commitTransaction()
    return result
  }

  /** Forget all undo/redo steps (e.g. after opening a project). Aborts nothing. */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.emit('clear')
  }
}

export function createCompositeCommand(label: string, commands: Command[]): Command {
  const list = [...commands]
  return {
    type: 'composite',
    label,
    apply(doc) {
      for (const c of list) c.apply(doc)
    },
    invert(doc) {
      for (let i = list.length - 1; i >= 0; i--) list[i]!.invert(doc)
    }
  }
}

// ================================================================= Patch command (structural edits)

export interface DocFields {
  id: string
  name: string
  width: number
  height: number
  palette: Palette
  layers: Layer[]
  frames: Frame[]
  tags: AnimTag[]
  references: RefLink[]
}

export interface PatchSpec {
  /** New values for document fields. */
  fields?: Partial<DocFields>
  /** New state of individual cels (null deletes the cel). */
  cels?: Map<string, Cel | null>
  /** Replace the whole cel map (used when swapping documents). */
  allCels?: Map<string, Cel>
}

function cloneField<K extends keyof DocFields>(key: K, value: DocFields[K]): DocFields[K] {
  switch (key) {
    case 'palette':
      return clonePalette(value as Palette) as DocFields[K]
    case 'layers':
      return (value as Layer[]).map(cloneLayer) as DocFields[K]
    case 'frames':
      return (value as Frame[]).map(cloneFrame) as DocFields[K]
    case 'tags':
      return (value as AnimTag[]).map(cloneTag) as DocFields[K]
    case 'references':
      return (value as RefLink[]).map((r) => ({ ...r })) as DocFields[K]
    default:
      return value
  }
}

function cloneFields(f: Partial<DocFields>): Partial<DocFields> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(f) as Array<keyof DocFields>) out[k] = cloneField(k, f[k] as never)
  return out as Partial<DocFields>
}

function assignFields(doc: Document, f: Partial<DocFields>): void {
  const cloned = cloneFields(f) as Record<string, unknown>
  for (const k of Object.keys(cloned)) (doc as unknown as Record<string, unknown>)[k] = cloned[k]
}

/**
 * Generic reversible "set these document fields and cels" command. Captures the previous values
 * of exactly the fields/cels in the spec when created.
 */
export function createPatchCommand(type: string, label: string, doc: Document, spec: PatchSpec): Command {
  const afterFields = spec.fields ? cloneFields(spec.fields) : undefined
  const beforeFields: Partial<DocFields> | undefined = afterFields
    ? cloneFields(
        Object.fromEntries(
          (Object.keys(afterFields) as Array<keyof DocFields>).map((k) => [k, doc[k]])
        ) as Partial<DocFields>
      )
    : undefined
  let afterCels: Map<string, Cel | null> | undefined
  let beforeCels: Map<string, Cel | null> | undefined
  if (spec.cels) {
    afterCels = new Map()
    beforeCels = new Map()
    for (const [k, v] of spec.cels) {
      afterCels.set(k, v ? cloneCel(v) : null)
      const cur = doc.cels.get(k)
      beforeCels.set(k, cur ? cloneCel(cur) : null)
    }
  }
  const afterAll = spec.allCels
  const beforeAll = spec.allCels ? doc.cels : undefined

  const run = (
    d: Document,
    fields: Partial<DocFields> | undefined,
    cels: Map<string, Cel | null> | undefined,
    all: Map<string, Cel> | undefined
  ): void => {
    if (fields) assignFields(d, fields)
    if (all) d.cels = all
    if (cels) {
      for (const [k, v] of cels) {
        if (v) d.cels.set(k, cloneCel(v))
        else d.cels.delete(k)
      }
    }
  }
  return {
    type,
    label,
    apply: (d) => run(d, afterFields, afterCels, afterAll),
    invert: (d) => run(d, beforeFields, beforeCels, beforeAll)
  }
}

/** Replace (or delete, with null) specific cels. */
export function createCelsCommand(type: string, label: string, doc: Document, cels: Map<string, Cel | null>): Command {
  return createPatchCommand(type, label, doc, { cels })
}

// ================================================================= Pixel edit command

export interface PixelEdit {
  layerId: string
  frameId: string
  /** Document coordinates of the changed area. */
  rect: Rect
  /** rect.w * rect.h pixels before / after the edit. */
  before: Uint32Array
  after: Uint32Array
}

function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function ensureCelCovers(doc: Document, key: string, rect: Rect): Cel {
  const existing = doc.cels.get(key)
  if (!existing) {
    const cel: Cel = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, data: new Uint32Array(rect.w * rect.h) }
    doc.cels.set(key, cel)
    return cel
  }
  const u = unionRect(existing, rect)
  if (u.x === existing.x && u.y === existing.y && u.w === existing.w && u.h === existing.h) return existing
  const data = new Uint32Array(u.w * u.h)
  for (let y = 0; y < existing.h; y++) {
    data.set(existing.data.subarray(y * existing.w, (y + 1) * existing.w), (existing.y - u.y + y) * u.w + (existing.x - u.x))
  }
  existing.x = u.x
  existing.y = u.y
  existing.w = u.w
  existing.h = u.h
  existing.data = data
  return existing
}

function cropCel(cel: Cel, geo: Rect): void {
  if (cel.x === geo.x && cel.y === geo.y && cel.w === geo.w && cel.h === geo.h) return
  const data = new Uint32Array(geo.w * geo.h)
  for (let y = 0; y < geo.h; y++) {
    const sy = geo.y - cel.y + y
    if (sy < 0 || sy >= cel.h) continue
    const sx = geo.x - cel.x
    data.set(cel.data.subarray(sy * cel.w + sx, sy * cel.w + sx + geo.w), y * geo.w)
  }
  cel.x = geo.x
  cel.y = geo.y
  cel.w = geo.w
  cel.h = geo.h
  cel.data = data
}

function writeRect(cel: Cel, rect: Rect, buf: Uint32Array): void {
  for (let y = 0; y < rect.h; y++) {
    const dst = (rect.y - cel.y + y) * cel.w + (rect.x - cel.x)
    cel.data.set(buf.subarray(y * rect.w, (y + 1) * rect.w), dst)
  }
}

/** Diff-based pixel edit: stores only the changed rectangle, before and after. */
export function createPixelEditCommand(edit: PixelEdit, label = 'Edit pixels'): Command {
  const key = celKey(edit.layerId, edit.frameId)
  const rect = { ...edit.rect }
  const before = edit.before.slice()
  const after = edit.after.slice()
  let geoBefore: Rect | null = null
  return {
    type: 'pixels',
    label,
    apply(doc) {
      const cur = doc.cels.get(key)
      geoBefore = cur ? { x: cur.x, y: cur.y, w: cur.w, h: cur.h } : null
      const cel = ensureCelCovers(doc, key, rect)
      writeRect(cel, rect, after)
      if (isCelEmpty(cel)) doc.cels.delete(key)
    },
    invert(doc) {
      const need = geoBefore ? unionRect(rect, geoBefore) : rect
      const cel = ensureCelCovers(doc, key, need)
      writeRect(cel, rect, before)
      if (geoBefore) cropCel(cel, geoBefore)
      else doc.cels.delete(key)
    }
  }
}

function boundsOfDiff(a: Uint32Array, b: Uint32Array, w: number, h: number): Rect | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (a[i] !== b[i]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function sub(data: Uint32Array, width: number, r: Rect): Uint32Array {
  const out = new Uint32Array(r.w * r.h)
  for (let y = 0; y < r.h; y++) out.set(data.subarray((r.y + y) * width + r.x, (r.y + y) * width + r.x + r.w), y * r.w)
  return out
}

/**
 * Build a pixel-edit command from two document-sized rasters (before/after). Returns null when
 * they are identical. Useful to commit an interactive stroke.
 */
export function createRasterDiffCommand(
  layerId: string,
  frameId: string,
  before: Raster,
  after: Raster,
  label = 'Edit pixels'
): Command | null {
  const rect = boundsOfDiff(before.data, after.data, before.width, before.height)
  if (!rect) return null
  return createPixelEditCommand(
    {
      layerId,
      frameId,
      rect,
      before: sub(before.data, before.width, rect),
      after: sub(after.data, after.width, rect)
    },
    label
  )
}

export interface PaintOptions {
  layer: string | number
  frame: string | number
  label?: string
  /** Mutate the document-sized raster. Return value is ignored (the diff is computed). */
  mutate: (img: Raster, doc: Document) => unknown
  /** Allow painting on a locked layer (default false: throws). */
  ignoreLock?: boolean
}

/**
 * The generic "paint" command: runs `mutate` on a document-sized copy of the cel and records
 * the changed rectangle as a diff. Returns null when nothing changed.
 */
export function createPaintCommand(doc: Document, opts: PaintOptions): Command | null {
  const layer = requireLayer(doc, opts.layer)
  const frame = requireFrame(doc, opts.frame)
  if (layer.locked && !opts.ignoreLock) {
    throw new Error(`Layer "${layer.name}" is locked. Unlock it first (update_layer locked=false).`)
  }
  const before = celToRaster(doc.cels.get(celKey(layer.id, frame.id)), doc.width, doc.height)
  const after = cloneRaster(before)
  opts.mutate(after, doc)
  return createRasterDiffCommand(layer.id, frame.id, before, after, opts.label ?? 'Paint')
}

// ================================================================= Layers

export interface AddLayerOptions {
  name?: string
  kind?: LayerKind
  /** Position in doc.layers (0 = bottom). Default: top. */
  index?: number
  visible?: boolean
  locked?: boolean
  opacity?: number
  blend?: BlendMode
}

function validateOpacity(o: number): number {
  if (typeof o !== 'number' || Number.isNaN(o) || o < 0 || o > 1) throw new Error(`Opacity must be between 0 and 1 (got ${o}).`)
  return o
}
function validateBlend(b: string): BlendMode {
  if (!BLEND_MODES.includes(b as BlendMode)) throw new Error(`Unknown blend mode "${b}". Use one of: ${BLEND_MODES.join(', ')}.`)
  return b as BlendMode
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function createAddLayerCommand(doc: Document, opts: AddLayerOptions = {}): CreatingCommand {
  const names = doc.layers.map((l) => l.name)
  const layer = createLayer({
    name: opts.name?.trim() ? opts.name.trim() : uniqueName(`Layer ${doc.layers.length + 1}`, names),
    kind: opts.kind ?? 'pixel',
    visible: opts.visible,
    locked: opts.locked,
    opacity: opts.opacity === undefined ? undefined : validateOpacity(opts.opacity),
    blend: opts.blend === undefined ? undefined : validateBlend(opts.blend)
  })
  const index = Math.max(0, Math.min(doc.layers.length, opts.index ?? doc.layers.length))
  const layers = doc.layers.map(cloneLayer)
  layers.splice(index, 0, layer)
  const cmd = createPatchCommand('layer.add', `Add layer "${layer.name}"`, doc, { fields: { layers } })
  return Object.assign(cmd, { createdId: layer.id })
}

export interface LayerPatch {
  name?: string
  visible?: boolean
  locked?: boolean
  opacity?: number
  blend?: BlendMode
}

export function createUpdateLayerCommand(doc: Document, layerRef: string | number, patch: LayerPatch): Command {
  const layer = requireLayer(doc, layerRef)
  const next: Layer = { ...layer }
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('Layer name cannot be empty.')
    next.name = patch.name.trim()
  }
  if (patch.visible !== undefined) next.visible = patch.visible
  if (patch.locked !== undefined) next.locked = patch.locked
  if (patch.opacity !== undefined) next.opacity = validateOpacity(patch.opacity)
  if (patch.blend !== undefined) next.blend = validateBlend(patch.blend)
  const layers = doc.layers.map((l) => (l.id === layer.id ? next : cloneLayer(l)))
  return createPatchCommand('layer.update', `Update layer "${layer.name}"`, doc, { fields: { layers } })
}

function celKeysForLayer(doc: Document, layerId: string): string[] {
  return doc.frames.map((f) => celKey(layerId, f.id)).filter((k) => doc.cels.has(k))
}

export function createDeleteLayerCommand(doc: Document, layerRef: string | number): Command {
  const layer = requireLayer(doc, layerRef)
  if (doc.layers.length <= 1) throw new Error('Cannot delete the last remaining layer.')
  const cels = new Map<string, Cel | null>()
  for (const k of celKeysForLayer(doc, layer.id)) cels.set(k, null)
  const layers = doc.layers.filter((l) => l.id !== layer.id).map(cloneLayer)
  return createPatchCommand('layer.delete', `Delete layer "${layer.name}"`, doc, { fields: { layers }, cels })
}

export function createMoveLayerCommand(doc: Document, layerRef: string | number, toIndex: number): Command {
  const layer = requireLayer(doc, layerRef)
  if (!Number.isInteger(toIndex)) throw new Error('Layer index must be an integer (0 = bottom).')
  const to = Math.max(0, Math.min(doc.layers.length - 1, toIndex))
  const layers = doc.layers.map(cloneLayer)
  const from = layerIndex(doc, layer.id)
  const [moved] = layers.splice(from, 1)
  layers.splice(to, 0, moved!)
  return createPatchCommand('layer.move', `Move layer "${layer.name}"`, doc, { fields: { layers } })
}

export function createDuplicateLayerCommand(doc: Document, layerRef: string | number, opts: { name?: string } = {}): CreatingCommand {
  const layer = requireLayer(doc, layerRef)
  const copy: Layer = {
    ...layer,
    id: createId('layer'),
    name: opts.name?.trim() ? opts.name.trim() : uniqueName(`${layer.name} copy`, doc.layers.map((l) => l.name))
  }
  const layers = doc.layers.map(cloneLayer)
  layers.splice(layerIndex(doc, layer.id) + 1, 0, copy)
  const cels = new Map<string, Cel | null>()
  for (const f of doc.frames) {
    const c = doc.cels.get(celKey(layer.id, f.id))
    if (c) cels.set(celKey(copy.id, f.id), c)
  }
  const cmd = createPatchCommand('layer.duplicate', `Duplicate layer "${layer.name}"`, doc, { fields: { layers }, cels })
  return Object.assign(cmd, { createdId: copy.id })
}

/** Merge a layer into the pixel layer directly below it (respecting the merged layer's blend and opacity). */
export function createMergeDownCommand(doc: Document, layerRef: string | number): Command {
  const top = requireLayer(doc, layerRef)
  const idx = layerIndex(doc, top.id)
  if (idx === 0) throw new Error(`Layer "${top.name}" is the bottom layer; there is nothing below to merge into.`)
  const below = doc.layers[idx - 1]!
  if (top.kind !== 'pixel' || below.kind !== 'pixel') throw new Error('merge_down only works between two pixel layers.')
  const cels = new Map<string, Cel | null>()
  for (const f of doc.frames) {
    const topCel = doc.cels.get(celKey(top.id, f.id))
    if (!topCel) continue
    cels.set(celKey(top.id, f.id), null)
    if (!top.visible) continue
    const raster = celToRaster(doc.cels.get(celKey(below.id, f.id)), doc.width, doc.height)
    compositeCel(raster, topCel, top)
    cels.set(celKey(below.id, f.id), rasterToCel(raster))
  }
  const layers = doc.layers.filter((l) => l.id !== top.id).map(cloneLayer)
  return createPatchCommand('layer.mergeDown', `Merge "${top.name}" down into "${below.name}"`, doc, { fields: { layers }, cels })
}

// ================================================================= Frames

function adjustTagsForInsert(tags: AnimTag[], at: number): AnimTag[] {
  return tags.map((t) => ({ ...t, from: t.from >= at ? t.from + 1 : t.from, to: t.to >= at ? t.to + 1 : t.to }))
}

function adjustTagsForDelete(tags: AnimTag[], at: number): AnimTag[] {
  const out: AnimTag[] = []
  for (const t of tags) {
    const from = t.from > at ? t.from - 1 : t.from
    const to = t.to >= at ? t.to - 1 : t.to
    if (to < from) continue
    out.push({ ...t, from, to })
  }
  return out
}

function adjustTagsForMove(tags: AnimTag[], from: number, to: number): AnimTag[] {
  const map = (i: number): number => {
    if (i === from) return to
    if (from < to && i > from && i <= to) return i - 1
    if (from > to && i >= to && i < from) return i + 1
    return i
  }
  return tags.map((t) => {
    const a = map(t.from)
    const b = map(t.to)
    return { ...t, from: Math.min(a, b), to: Math.max(a, b) }
  })
}

function validateDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms < 1 || ms > 60000) throw new Error(`Frame duration must be between 1 and 60000 ms (got ${ms}).`)
  return Math.round(ms)
}

export interface AddFrameOptions {
  /** Insert position (0..frames.length). Default: append at the end. */
  index?: number
  durationMs?: number
}

export function createAddFrameCommand(doc: Document, opts: AddFrameOptions = {}): CreatingCommand {
  const frame = createFrame({ durationMs: opts.durationMs === undefined ? undefined : validateDuration(opts.durationMs) })
  const at = Math.max(0, Math.min(doc.frames.length, opts.index ?? doc.frames.length))
  const frames = doc.frames.map(cloneFrame)
  frames.splice(at, 0, frame)
  const cmd = createPatchCommand('frame.add', `Add frame ${at}`, doc, {
    fields: { frames, tags: adjustTagsForInsert(doc.tags, at) }
  })
  return Object.assign(cmd, { createdId: frame.id })
}

export function createDuplicateFrameCommand(doc: Document, frameRef: string | number, opts: { index?: number } = {}): CreatingCommand {
  const src = requireFrame(doc, frameRef)
  const srcIdx = frameIndex(doc, src.id)
  const at = Math.max(0, Math.min(doc.frames.length, opts.index ?? srcIdx + 1))
  const copy: Frame = { id: createId('frame'), durationMs: src.durationMs }
  const frames = doc.frames.map(cloneFrame)
  frames.splice(at, 0, copy)
  const cels = new Map<string, Cel | null>()
  for (const l of doc.layers) {
    const c = doc.cels.get(celKey(l.id, src.id))
    if (c) cels.set(celKey(l.id, copy.id), c)
  }
  const cmd = createPatchCommand('frame.duplicate', `Duplicate frame ${srcIdx}`, doc, {
    fields: { frames, tags: adjustTagsForInsert(doc.tags, at) },
    cels
  })
  return Object.assign(cmd, { createdId: copy.id })
}

export function createDeleteFrameCommand(doc: Document, frameRef: string | number): Command {
  const frame = requireFrame(doc, frameRef)
  if (doc.frames.length <= 1) throw new Error('Cannot delete the last remaining frame.')
  const idx = frameIndex(doc, frame.id)
  const cels = new Map<string, Cel | null>()
  for (const l of doc.layers) {
    const k = celKey(l.id, frame.id)
    if (doc.cels.has(k)) cels.set(k, null)
  }
  return createPatchCommand('frame.delete', `Delete frame ${idx}`, doc, {
    fields: { frames: doc.frames.filter((f) => f.id !== frame.id).map(cloneFrame), tags: adjustTagsForDelete(doc.tags, idx) },
    cels
  })
}

export function createMoveFrameCommand(doc: Document, frameRef: string | number, toIndex: number): Command {
  const frame = requireFrame(doc, frameRef)
  if (!Number.isInteger(toIndex)) throw new Error('Frame index must be an integer.')
  const from = frameIndex(doc, frame.id)
  const to = Math.max(0, Math.min(doc.frames.length - 1, toIndex))
  const frames = doc.frames.map(cloneFrame)
  const [moved] = frames.splice(from, 1)
  frames.splice(to, 0, moved!)
  return createPatchCommand('frame.move', `Move frame ${from} to ${to}`, doc, {
    fields: { frames, tags: adjustTagsForMove(doc.tags, from, to) }
  })
}

/** Set the duration of one frame, several frames, or all frames ('all'). */
export function createSetFrameDurationCommand(
  doc: Document,
  frames: string | number | Array<string | number>,
  durationMs: number
): Command {
  const ms = validateDuration(durationMs)
  const ids =
    frames === 'all'
      ? new Set(doc.frames.map((f) => f.id))
      : new Set((Array.isArray(frames) ? frames : [frames]).map((r) => requireFrame(doc, r).id))
  const next = doc.frames.map((f) => (ids.has(f.id) ? { ...f, durationMs: ms } : cloneFrame(f)))
  return createPatchCommand('frame.duration', `Set frame duration to ${ms}ms`, doc, { fields: { frames: next } })
}

// ================================================================= Tags

export interface TagSpec {
  name: string
  from: number
  to: number
  direction?: TagDirection
  loop?: boolean
}

function validateTagRange(doc: Document, from: number, to: number): void {
  const n = doc.frames.length
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= n) {
    throw new Error(`Tag range ${from}..${to} is invalid. Frame indices are 0-based, from <= to, and the document has ${n} frame(s) (0..${n - 1}).`)
  }
}

function validateDirection(d: string): TagDirection {
  if (!TAG_DIRECTIONS.includes(d as TagDirection)) throw new Error(`Unknown tag direction "${d}". Use one of: ${TAG_DIRECTIONS.join(', ')}.`)
  return d as TagDirection
}

export function createCreateTagCommand(doc: Document, spec: TagSpec): CreatingCommand {
  const name = spec.name?.trim()
  if (!name) throw new Error('Tag name cannot be empty.')
  if (doc.tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A tag named "${name}" already exists. Use update_tag to change it or pick another name.`)
  }
  validateTagRange(doc, spec.from, spec.to)
  const tag: AnimTag = {
    id: createId('tag'),
    name,
    from: spec.from,
    to: spec.to,
    direction: spec.direction ? validateDirection(spec.direction) : 'forward',
    ...(spec.loop === undefined ? {} : { loop: spec.loop })
  }
  const cmd = createPatchCommand('tag.create', `Create tag "${name}"`, doc, { fields: { tags: [...doc.tags.map(cloneTag), tag] } })
  return Object.assign(cmd, { createdId: tag.id })
}

export function createUpdateTagCommand(doc: Document, tagRef: string, patch: Partial<TagSpec>): Command {
  const tag = requireTag(doc, tagRef)
  const next: AnimTag = { ...tag }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('Tag name cannot be empty.')
    if (doc.tags.some((t) => t.id !== tag.id && t.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A tag named "${name}" already exists.`)
    }
    next.name = name
  }
  if (patch.from !== undefined) next.from = patch.from
  if (patch.to !== undefined) next.to = patch.to
  validateTagRange(doc, next.from, next.to)
  if (patch.direction !== undefined) next.direction = validateDirection(patch.direction)
  if (patch.loop !== undefined) next.loop = patch.loop
  const tags = doc.tags.map((t) => (t.id === tag.id ? next : cloneTag(t)))
  return createPatchCommand('tag.update', `Update tag "${tag.name}"`, doc, { fields: { tags } })
}

export function createDeleteTagCommand(doc: Document, tagRef: string): Command {
  const tag = requireTag(doc, tagRef)
  return createPatchCommand('tag.delete', `Delete tag "${tag.name}"`, doc, {
    fields: { tags: doc.tags.filter((t) => t.id !== tag.id).map(cloneTag) }
  })
}

// ================================================================= Cels

export interface CopyCelOptions {
  fromLayer: string | number
  fromFrame: string | number
  toLayer: string | number
  toFrame: string | number
}

/** Copy a cel (an empty source clears the destination). */
export function createCopyCelCommand(doc: Document, o: CopyCelOptions): Command {
  const fl = requireLayer(doc, o.fromLayer)
  const ff = requireFrame(doc, o.fromFrame)
  const tl = requireLayer(doc, o.toLayer)
  const tf = requireFrame(doc, o.toFrame)
  if (tl.locked) throw new Error(`Layer "${tl.name}" is locked.`)
  const src = doc.cels.get(celKey(fl.id, ff.id))
  const cels = new Map<string, Cel | null>([[celKey(tl.id, tf.id), src ?? null]])
  return createCelsCommand('cel.copy', `Copy cel to "${tl.name}" frame ${frameIndex(doc, tf.id)}`, doc, cels)
}

export function createClearCelCommand(doc: Document, layerRef: string | number, frameRef: string | number): Command {
  const l = requireLayer(doc, layerRef)
  const f = requireFrame(doc, frameRef)
  if (l.locked) throw new Error(`Layer "${l.name}" is locked.`)
  return createCelsCommand('cel.clear', `Clear cel on "${l.name}"`, doc, new Map([[celKey(l.id, f.id), null]]))
}

/** Set a cel to explicit content (null clears). */
export function createSetCelCommand(
  doc: Document,
  layerRef: string | number,
  frameRef: string | number,
  cel: Cel | null,
  label = 'Set cel'
): Command {
  const l = requireLayer(doc, layerRef)
  const f = requireFrame(doc, frameRef)
  return createCelsCommand('cel.set', label, doc, new Map([[celKey(l.id, f.id), cel]]))
}

// ================================================================= Canvas

export type Anchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

export const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
]

export function anchorOffset(anchor: Anchor, oldW: number, oldH: number, newW: number, newH: number): { dx: number; dy: number } {
  const dw = newW - oldW
  const dh = newH - oldH
  const h = anchor.includes('left') ? 0 : anchor.includes('right') ? dw : Math.floor(dw / 2)
  const v = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? dh : Math.floor(dh / 2)
  return { dx: h, dy: v }
}

export function createResizeCanvasCommand(doc: Document, width: number, height: number, anchor: Anchor = 'top-left'): Command {
  assertDimensions(width, height)
  if (!ANCHORS.includes(anchor)) throw new Error(`Unknown anchor "${anchor}". Use one of: ${ANCHORS.join(', ')}.`)
  const { dx, dy } = anchorOffset(anchor, doc.width, doc.height, width, height)
  const cels = new Map<string, Cel | null>()
  for (const [k, cel] of doc.cels) {
    const nx0 = Math.max(0, cel.x + dx)
    const ny0 = Math.max(0, cel.y + dy)
    const nx1 = Math.min(width, cel.x + dx + cel.w)
    const ny1 = Math.min(height, cel.y + dy + cel.h)
    if (nx1 <= nx0 || ny1 <= ny0) {
      cels.set(k, null)
      continue
    }
    const w = nx1 - nx0
    const h = ny1 - ny0
    const data = new Uint32Array(w * h)
    for (let y = 0; y < h; y++) {
      const sy = ny0 + y - (cel.y + dy)
      const sx = nx0 - (cel.x + dx)
      data.set(cel.data.subarray(sy * cel.w + sx, sy * cel.w + sx + w), y * w)
    }
    const next: Cel = { x: nx0, y: ny0, w, h, data }
    cels.set(k, isCelEmpty(next) ? null : next)
  }
  return createPatchCommand('canvas.resize', `Resize canvas to ${width}x${height}`, doc, { fields: { width, height }, cels })
}

// ================================================================= Palette

function normalizeColors(colors: Array<string | PaletteColor>): PaletteColor[] {
  return colors.map((c) => {
    const src = typeof c === 'string' ? { hex: c } : c
    const hex = normalizeHex(src.hex)
    return src.name ? { hex, name: src.name } : { hex }
  })
}

export interface PaletteInput {
  id?: string
  name?: string
  colors: Array<string | PaletteColor>
}

export function createSetPaletteCommand(doc: Document, input: PaletteInput | Palette): Command {
  if (!input.colors || input.colors.length === 0) throw new Error('A palette needs at least one color.')
  if (input.colors.length > 4096) throw new Error('A palette can have at most 4096 colors.')
  const palette: Palette = {
    id: input.id ?? createId('palette'),
    name: input.name?.trim() || 'Custom',
    colors: normalizeColors(input.colors)
  }
  return createPatchCommand('palette.set', `Set palette "${palette.name}"`, doc, { fields: { palette } })
}

export function createAddColorsCommand(doc: Document, colors: Array<string | PaletteColor>, opts: { dedupe?: boolean } = {}): Command {
  const add = normalizeColors(colors)
  const have = new Set(doc.palette.colors.map((c) => c.hex))
  const colorsOut = doc.palette.colors.map((c) => ({ ...c }))
  for (const c of add) {
    if ((opts.dedupe ?? true) && have.has(c.hex)) continue
    have.add(c.hex)
    colorsOut.push(c)
  }
  return createPatchCommand('palette.add', `Add ${add.length} color(s)`, doc, {
    fields: { palette: { ...doc.palette, colors: colorsOut } }
  })
}

/** Remove colors by palette index (number) or hex string. */
export function createRemoveColorsCommand(doc: Document, selectors: Array<number | string>): Command {
  const drop = new Set<number>()
  for (const s of selectors) {
    if (typeof s === 'number') {
      if (!Number.isInteger(s) || s < 0 || s >= doc.palette.colors.length) {
        throw new Error(`Palette index ${s} is out of range (palette has ${doc.palette.colors.length} colors, 0-based).`)
      }
      drop.add(s)
    } else {
      const hex = normalizeHex(s)
      const i = doc.palette.colors.findIndex((c) => c.hex === hex)
      if (i < 0) throw new Error(`Color ${hex} is not in the palette.`)
      drop.add(i)
    }
  }
  const colors = doc.palette.colors.filter((_, i) => !drop.has(i)).map((c) => ({ ...c }))
  return createPatchCommand('palette.remove', `Remove ${drop.size} color(s)`, doc, {
    fields: { palette: { ...doc.palette, colors } }
  })
}

export interface RemapOptions {
  /** Target palette (default: the document palette). */
  palette?: Palette
  /** Only remap this layer (default: all pixel layers). */
  layer?: string | number
  /** Only remap this frame (default: all frames). */
  frame?: string | number
  mode?: ColorSpace
  /** Also make `palette` the document palette (default true when a palette is given). */
  setDocumentPalette?: boolean
}

/** Snap every pixel to its nearest palette color (alpha is preserved). */
export function createRemapToPaletteCommand(doc: Document, opts: RemapOptions = {}): Command {
  const palette = opts.palette ?? doc.palette
  if (palette.colors.length === 0) throw new Error('Cannot remap to an empty palette.')
  const matcher = createPaletteMatcher(
    paletteToRgba(palette).map((c) => c | 0xff000000),
    opts.mode ?? 'perceptual'
  )
  const target = paletteToRgba(palette)
  const layerId = opts.layer === undefined ? undefined : requireLayer(doc, opts.layer).id
  const frameId = opts.frame === undefined ? undefined : requireFrame(doc, opts.frame).id
  const cels = new Map<string, Cel | null>()
  for (const l of doc.layers) {
    if (layerId ? l.id !== layerId : l.kind !== 'pixel') continue
    for (const f of doc.frames) {
      if (frameId && f.id !== frameId) continue
      const k = celKey(l.id, f.id)
      const cel = doc.cels.get(k)
      if (!cel) continue
      const next = cloneCel(cel)
      let changed = false
      for (let i = 0; i < next.data.length; i++) {
        const c = next.data[i]!
        const a = c >>> 24
        if (a === 0) continue
        const mapped = target[matcher(c)]! & 0xffffff
        const nc = ((a << 24) | mapped) >>> 0
        if (nc !== c) {
          next.data[i] = nc
          changed = true
        }
      }
      if (changed) cels.set(k, next)
    }
  }
  const fields: Partial<DocFields> = {}
  if (opts.setDocumentPalette ?? opts.palette !== undefined) fields.palette = clonePalette(palette)
  return createPatchCommand('palette.remap', `Remap to palette "${palette.name}"`, doc, { fields, cels })
}

// ================================================================= Document level

export function createSetReferencesCommand(doc: Document, references: RefLink[]): Command {
  return createPatchCommand('doc.references', 'Set style references', doc, {
    fields: { references: references.map((r) => ({ ...r })) }
  })
}

export function createRenameDocumentCommand(doc: Document, name: string): Command {
  if (!name.trim()) throw new Error('Document name cannot be empty.')
  return createPatchCommand('doc.rename', `Rename document to "${name.trim()}"`, doc, { fields: { name: name.trim() } })
}

/**
 * Swap the whole document contents in place (new / open). The History keeps referring to the
 * same Document object; `next` is consumed (its arrays and cel map become the live ones).
 */
export function createReplaceDocumentCommand(doc: Document, next: Document, label = 'Replace document'): Command {
  return createPatchCommand('doc.replace', label, doc, {
    fields: {
      id: next.id,
      name: next.name,
      width: next.width,
      height: next.height,
      palette: next.palette,
      layers: next.layers,
      frames: next.frames,
      tags: next.tags,
      references: next.references
    },
    allCels: next.cels
  })
}

/** In-place replacement without history (e.g. to load a project into a fresh store). */
export function replaceDocumentInPlace(doc: Document, next: Document): void {
  doc.id = next.id
  doc.name = next.name
  doc.width = next.width
  doc.height = next.height
  doc.palette = next.palette
  doc.layers = next.layers
  doc.frames = next.frames
  doc.tags = next.tags
  doc.references = next.references
  doc.cels = next.cels
}

