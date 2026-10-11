// EditorSession: the framework-free state container around a core Document + History.
//
// The renderer owns ONE session (the live document). UI components, the tool registry (chat agent and
// MCP calls arriving over the tool bridge) and tests all drive the same object, so manual edits and
// LLM edits share one undo history. No DOM, no Electron, no React: subscribe() + getVersion() are
// shaped for React's useSyncExternalStore:
//
//   const version = useSyncExternalStore(session.subscribe, session.getVersion)
//
// `session.doc` is a stable object for the lifetime of the session (new/open replace its contents in
// place, see replaceDocument), so always re-read from it when `version` changes.

import {
  type Command,
  type Document,
  type Frame,
  type HistoryEvent,
  type Layer,
  type Rect,
  History,
  clipRect,
  createDocument,
  createCompositeCommand,
  createReplaceDocumentCommand,
  findFrame,
  findLayer,
  frameIndex,
  layerIndex,
  normalizeHex,
  replaceDocumentInPlace
} from '../core'

export interface OnionSkinSettings {
  enabled: boolean
  /** How many previous frames to show. */
  before: number
  /** How many following frames to show. */
  after: number
  /** 0..1 opacity of the nearest onion frame (farther ones fade). */
  opacity: number
}

export interface EditorSessionOptions {
  /** Maximum undo steps kept (default 200). */
  maxUndoDepth?: number
}

export interface ReplaceDocumentOptions {
  /**
   * 'record' (default): the replacement is ONE undoable step, so undo brings the previous document back
   * (the right choice for LLM `new_document` / `open_project`). 'clear': drop all history (File > New).
   */
  history?: 'record' | 'clear'
  label?: string
}

export type SessionListener = () => void

interface TurnState {
  label: string
  /** Undo depth when the turn started: undo never goes below it while the turn runs. */
  startDepth: number
  /** Undo steps pushed during the turn (mirror of the tail of the undo stack). */
  steps: Command[]
  /** Nested beginTurn calls. */
  nesting: number
  /** False if the mirror could not be kept exact (then the turn is not merged). */
  mirrorValid: boolean
}

export class EditorSession {
  readonly history: History
  /** Stable document object (contents are replaced in place by replaceDocument). */
  readonly doc: Document

  activeLayerId = ''
  activeFrameId = ''
  /** Rectangular selection in document coordinates, or null. */
  selection: Rect | null = null
  /** Draw colors as hex strings ("#rrggbb" / "#rrggbbaa"). */
  primaryColor = '#000000'
  secondaryColor = '#ffffff'
  onion: OnionSkinSettings = { enabled: false, before: 1, after: 1, opacity: 0.35 }

  private _version = 0
  private listeners = new Set<SessionListener>()
  private lastLayerIndex = 0
  private lastFrameIndex = 0
  private lastDocId: string
  private turn: TurnState | null = null

  constructor(doc: Document = createDocument({ width: 32, height: 32, name: 'Untitled' }), opts: EditorSessionOptions = {}) {
    this.doc = doc
    this.history = new History(doc, { maxDepth: opts.maxUndoDepth })
    this.lastDocId = doc.id
    this.activeLayerId = doc.layers[doc.layers.length - 1]?.id ?? ''
    this.activeFrameId = doc.frames[0]?.id ?? ''
    this.normalize()
    this.history.subscribe((e) => this.onHistoryEvent(e))
  }

  // ------------------------------------------------------------ subscription

  /** Monotonically increasing; changes on every document, history or session-state change. */
  getVersion = (): number => this._version

  /** Subscribe to changes (arrow function so it can be passed straight to useSyncExternalStore). */
  subscribe = (listener: SessionListener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    this._version++
    for (const l of [...this.listeners]) l()
  }

  // ------------------------------------------------------------ editing

  /** Apply a command and record it (joins the open transaction, if any). */
  execute(cmd: Command): void {
    this.history.execute(cmd)
  }

  /** Run `fn` as one undo step; rolls everything back and rethrows if it throws. */
  transaction<T>(label: string, fn: () => T): T {
    return this.history.transaction(label, fn)
  }

  /** Like `transaction`, but `fn` may be async (used by tool calls that do file IO). */
  async transactionAsync<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
    this.history.beginTransaction(label)
    let result: T
    try {
      result = await fn()
    } catch (e) {
      this.history.abortTransaction()
      throw e
    }
    this.history.commitTransaction()
    return result
  }

  beginTransaction(label: string): void {
    this.history.beginTransaction(label)
  }
  commitTransaction(): void {
    this.history.commitTransaction()
  }
  abortTransaction(): void {
    this.history.abortTransaction()
  }

  canUndo(): boolean {
    if (!this.history.canUndo()) return false
    return !this.turn || this.history.undoDepth > this.turn.startDepth
  }
  canRedo(): boolean {
    return this.history.canRedo()
  }
  undoLabel(): string | undefined {
    return this.canUndo() ? this.history.undoLabel() : undefined
  }
  redoLabel(): string | undefined {
    return this.history.redoLabel()
  }

  /** Undo one step. While an agent turn runs this never goes below the turn's start. */
  undo(): boolean {
    if (!this.canUndo()) return false
    return this.history.undo()
  }
  redo(): boolean {
    return this.history.redo()
  }

  /**
   * Replace the whole document (new / open). The Document object stays the same, its contents are
   * swapped. `next` is consumed. Selection is cleared and the active layer/frame reset.
   */
  replaceDocument(next: Document, opts: ReplaceDocumentOptions = {}): void {
    const mode = opts.history ?? 'record'
    if (mode === 'clear') {
      if (this.history.inTransaction()) throw new Error('Cannot clear history while a transaction is open.')
      replaceDocumentInPlace(this.doc, next)
      this.history.clear()
    } else {
      this.history.execute(createReplaceDocumentCommand(this.doc, next, opts.label ?? 'Replace document'))
    }
    this.selection = null
    this.activeLayerId = this.doc.layers[this.doc.layers.length - 1]?.id ?? ''
    this.activeFrameId = this.doc.frames[0]?.id ?? ''
    this.lastDocId = this.doc.id
    this.normalize()
    this.notify()
  }

  // ------------------------------------------------------------ agent turns

  get turnActive(): boolean {
    return this.turn !== null
  }

  /**
   * Group everything executed until endTurn() into ONE undo step ("Undo agent turn"). Each tool call
   * is still its own transaction while the turn runs, so the undo tool works step by step inside the
   * turn; endTurn() merges them. Calls nest (the outermost endTurn merges).
   */
  beginTurn(label = 'Agent turn'): void {
    if (this.turn) {
      this.turn.nesting++
      return
    }
    if (this.history.inTransaction()) throw new Error('Cannot start an agent turn inside an open transaction.')
    this.turn = { label, startDepth: this.history.undoDepth, steps: [], nesting: 1, mirrorValid: true }
    this.notify()
  }

  endTurn(opts: { rollback?: boolean } = {}): void {
    const turn = this.turn
    if (!turn) return
    if (opts.rollback) turn.nesting = 1
    if (--turn.nesting > 0) return
    if (this.history.inTransaction()) throw new Error('Cannot end an agent turn while a transaction is open.')
    this.turn = null
    if (opts.rollback) {
      while (this.history.undoDepth > turn.startDepth && this.history.undo()) {
        /* keep undoing */
      }
    } else if (turn.mirrorValid && turn.steps.length > 1 && this.history.undoDepth - turn.startDepth === turn.steps.length) {
      const steps = [...turn.steps]
      for (let i = 0; i < steps.length; i++) this.history.undo()
      this.history.execute(createCompositeCommand(turn.label, steps))
    }
    this.notify()
  }

  private trackTurn(e: HistoryEvent): void {
    const turn = this.turn
    if (!turn) return
    switch (e.type) {
      case 'execute':
        if (!e.inTransaction && e.command) turn.steps.push(e.command)
        break
      case 'transaction-commit':
        if (e.command) turn.steps.push(e.command)
        break
      case 'undo':
        if (turn.steps[turn.steps.length - 1] === e.command) turn.steps.pop()
        else turn.mirrorValid = false
        break
      case 'redo':
        if (e.command) turn.steps.push(e.command)
        break
      case 'clear':
        turn.steps = []
        turn.startDepth = 0
        turn.mirrorValid = false
        break
      default:
        break
    }
  }

  // ------------------------------------------------------------ active layer / frame

  get activeLayer(): Layer {
    return findLayer(this.doc, this.activeLayerId) ?? this.doc.layers[this.doc.layers.length - 1]!
  }
  get activeFrame(): Frame {
    return findFrame(this.doc, this.activeFrameId) ?? this.doc.frames[0]!
  }
  get activeLayerIndex(): number {
    return layerIndex(this.doc, this.activeLayer.id)
  }
  get activeFrameIndex(): number {
    return frameIndex(this.doc, this.activeFrame.id)
  }

  /** Select a layer by id, name or index (0 = bottom). Throws when it does not exist. */
  setActiveLayer(ref: string | number): void {
    const layer = findLayer(this.doc, ref)
    if (!layer) throw new Error(`Layer ${JSON.stringify(ref)} not found.`)
    if (layer.id === this.activeLayerId) return
    this.activeLayerId = layer.id
    this.lastLayerIndex = layerIndex(this.doc, layer.id)
    this.notify()
  }

  /** Select a frame by id or index. Throws when it does not exist. */
  setActiveFrame(ref: string | number): void {
    const frame = findFrame(this.doc, ref)
    if (!frame) throw new Error(`Frame ${JSON.stringify(ref)} not found.`)
    if (frame.id === this.activeFrameId) return
    this.activeFrameId = frame.id
    this.lastFrameIndex = frameIndex(this.doc, frame.id)
    this.notify()
  }

  // ------------------------------------------------------------ selection, colors, onion skin

  /** Set the selection (clipped to the canvas); null or an empty rect clears it. */
  setSelection(rect: Rect | null): void {
    const next = rect ? clipRect(rect, this.doc) : null
    const cur = this.selection
    if (cur === next || (cur && next && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h)) return
    this.selection = next
    this.notify()
  }

  setPrimaryColor(hex: string): void {
    const c = normalizeHex(hex)
    if (c === this.primaryColor) return
    this.primaryColor = c
    this.notify()
  }
  setSecondaryColor(hex: string): void {
    const c = normalizeHex(hex)
    if (c === this.secondaryColor) return
    this.secondaryColor = c
    this.notify()
  }
  swapColors(): void {
    const p = this.primaryColor
    this.primaryColor = this.secondaryColor
    this.secondaryColor = p
    this.notify()
  }

  setOnionSkin(patch: Partial<OnionSkinSettings>): void {
    const next = { ...this.onion, ...patch }
    next.before = Math.max(0, Math.min(8, Math.floor(next.before)))
    next.after = Math.max(0, Math.min(8, Math.floor(next.after)))
    next.opacity = Math.max(0, Math.min(1, next.opacity))
    this.onion = next
    this.notify()
  }

  // ------------------------------------------------------------ internals

  private onHistoryEvent(e: HistoryEvent): void {
    this.trackTurn(e)
    this.normalize()
    this.notify()
  }

  /** Keep the active layer/frame and selection valid after any change to the document. */
  private normalize(): void {
    const d = this.doc
    if (d.id !== this.lastDocId) {
      // The document was swapped (e.g. undo/redo of a replace): start from the top layer / first frame.
      this.lastDocId = d.id
      this.activeLayerId = ''
      this.activeFrameId = ''
      this.lastLayerIndex = d.layers.length - 1
      this.lastFrameIndex = 0
    }
    let li = layerIndex(d, this.activeLayerId)
    if (li < 0) {
      li = Math.max(0, Math.min(d.layers.length - 1, this.lastLayerIndex))
      this.activeLayerId = d.layers[li]?.id ?? ''
    }
    this.lastLayerIndex = li
    let fi = frameIndex(d, this.activeFrameId)
    if (fi < 0) {
      fi = Math.max(0, Math.min(d.frames.length - 1, this.lastFrameIndex))
      this.activeFrameId = d.frames[fi]?.id ?? ''
    }
    this.lastFrameIndex = fi
    if (this.selection) {
      const clipped = clipRect(this.selection, d)
      this.selection = clipped
    }
  }
}
