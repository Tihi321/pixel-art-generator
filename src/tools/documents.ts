// Documents: the set of open documents a tool call can address by `documentId`.
//
// `ToolContext.session` is always the CURRENT document, so every existing tool keeps working unchanged.
// A DocumentHost adds the multi-document part: list, pick by id, add (becomes current), remember the file
// a document was saved to, and the PNG the app should export on every save (the VN Studio round trip).
//
// Two hosts: `DocumentSet` (this file: headless mode in the main process, and tests) and an adapter over
// the renderer's tab workspace (src/renderer/state/actions.ts: window mode). No DOM, no Electron, no node:*.

import { type Document, createDocument, encodePng, frameIndex } from '../core'
import { frameImage } from '../core/convert'
import type { ToolContext } from './registry'
import { EditorSession } from './session'
import type { ToolServices } from './services'
import { withExtension } from './util'

export interface ExportTarget {
  /** Absolute path (a relative name goes to ~/PixelStudio/exports). */
  path: string
  /** Exact output size, nearest neighbour. */
  width?: number
  height?: number
}

export interface DocumentInfo {
  documentId: string
  name: string
  width: number
  height: number
  /** Where the native project was last saved or opened from; null until then. */
  path: string | null
  current: boolean
  dirty: boolean
}

export interface DocumentRef {
  documentId: string
  session: EditorSession
  path: string | null
  exportTo?: ExportTarget
}

export interface DocumentHost {
  list(): DocumentInfo[]
  /** The document with this id (default: the current one). Throws "Unknown document" otherwise. */
  resolve(documentId?: string): DocumentRef
  /** Adds a document and makes it current. Returns its id. `dirty` opens it with unsaved changes (even when it has a path). */
  add(doc: Document, opts?: { path?: string | null; exportTo?: ExportTarget; dirty?: boolean }): string
  /** The document with this native project path, if it is open. */
  findByPath(path: string): string | undefined
  /** Makes a document current. */
  activate(documentId: string): void
  setExportTarget(documentId: string, target: ExportTarget | undefined): void
  /** The document was saved to `path`: remember it and clear the dirty flag. */
  markSaved(documentId: string, path: string): void
  /**
   * Closes a document. A document with unsaved changes needs `force`. Closing the current one makes another
   * current; closing the last one leaves a fresh blank document. Throws when the document cannot be closed.
   */
  close(documentId: string, opts?: { force?: boolean }): void
}

export const UNSAVED_CLOSE_MESSAGE = (documentId: string, name: string): string =>
  `Document ${documentId} ("${name}") has unsaved changes. Call save_document first, or pass force=true to close it anyway.`

// ---------------------------------------------------------------- DocumentSet (headless)

interface Entry extends DocumentRef {
  edits: number
  savedEdits: number
  /** The blank document the set starts with: the first added document replaces it. */
  placeholder: boolean
}

export interface DocumentSetOptions {
  /** Oldest clean documents are dropped beyond this many (default 64). */
  maxDocuments?: number
  maxUndoDepth?: number
}

export class DocumentSet implements DocumentHost {
  private entries: Entry[] = []
  private currentIdValue = ''
  private seq = 0
  private readonly maxDocuments: number
  private readonly maxUndoDepth: number

  constructor(opts: DocumentSetOptions = {}) {
    this.maxDocuments = opts.maxDocuments ?? 64
    this.maxUndoDepth = opts.maxUndoDepth ?? 50
    this.addEntry(createDocument({ width: 32, height: 32, name: 'Untitled' }), null, undefined, true)
  }

  /** The current document's session (what `ToolContext.session` is for each call). */
  get session(): EditorSession {
    return this.current().session
  }

  private current(): Entry {
    return this.entries.find((e) => e.documentId === this.currentIdValue) ?? this.entries[this.entries.length - 1]!
  }

  private addEntry(doc: Document, path: string | null, exportTo: ExportTarget | undefined, placeholder: boolean): Entry {
    const session = new EditorSession(doc, { maxUndoDepth: this.maxUndoDepth })
    const entry: Entry = { documentId: `doc${++this.seq}`, session, path, exportTo, edits: 0, savedEdits: 0, placeholder }
    session.history.subscribe((e) => {
      if (e.type === 'execute' || e.type === 'undo' || e.type === 'redo' || e.type === 'clear' || e.type === 'transaction-commit') entry.edits++
    })
    this.entries.push(entry)
    this.currentIdValue = entry.documentId
    return entry
  }

  list(): DocumentInfo[] {
    const cur = this.current().documentId
    return this.entries.map((e) => ({
      documentId: e.documentId,
      name: e.session.doc.name,
      width: e.session.doc.width,
      height: e.session.doc.height,
      path: e.path,
      current: e.documentId === cur,
      dirty: e.edits !== e.savedEdits
    }))
  }

  resolve(documentId?: string): DocumentRef {
    if (documentId === undefined || documentId === '') return this.current()
    const e = this.entries.find((x) => x.documentId === documentId)
    if (!e) throw new Error(`Unknown document "${documentId}". Call list_documents to see the open documents.`)
    return e
  }

  add(doc: Document, opts: { path?: string | null; exportTo?: ExportTarget; dirty?: boolean } = {}): string {
    const prev = this.current()
    const entry = this.addEntry(doc, opts.path ?? null, opts.exportTo, false)
    if (opts.dirty) entry.edits = 1 // unsaved work handed over by another engine (savedEdits stays 0)
    if (prev.placeholder && prev.edits === 0 && !prev.session.turnActive) this.entries = this.entries.filter((e) => e !== prev)
    // keep memory bounded: drop the oldest clean document that is not the current one
    while (this.entries.length > this.maxDocuments) {
      const victim = this.entries.find((e) => e !== entry && e.edits === e.savedEdits)
      if (!victim) break
      this.entries = this.entries.filter((e) => e !== victim)
    }
    return entry.documentId
  }

  /** The blank starting document nobody touched: nothing to hand over. */
  isUntouched(documentId: string): boolean {
    const e = this.resolve(documentId) as Entry
    return e.placeholder && e.edits === 0
  }

  findByPath(path: string): string | undefined {
    const p = path.toLowerCase()
    return this.entries.find((e) => e.path?.toLowerCase() === p)?.documentId
  }

  activate(documentId: string): void {
    this.currentIdValue = this.resolve(documentId).documentId
  }

  setExportTarget(documentId: string, target: ExportTarget | undefined): void {
    this.resolve(documentId).exportTo = target
  }

  markSaved(documentId: string, path: string): void {
    const e = this.resolve(documentId) as Entry
    e.path = path
    e.savedEdits = e.edits
  }

  close(documentId: string, opts: { force?: boolean } = {}): void {
    const e = this.resolve(documentId) as Entry
    if (e.edits !== e.savedEdits && !opts.force) throw new Error(UNSAVED_CLOSE_MESSAGE(e.documentId, e.session.doc.name))
    if (e.session.turnActive) throw new Error(`Document ${e.documentId} is in use by an agent turn and cannot be closed now.`)
    const wasCurrent = e === this.current()
    this.entries = this.entries.filter((x) => x !== e)
    // the most recently added remaining document becomes current; the last one leaves a blank placeholder
    if (this.entries.length === 0) this.addEntry(createDocument({ width: 32, height: 32, name: 'Untitled' }), null, undefined, true)
    else if (wasCurrent) this.currentIdValue = this.entries[this.entries.length - 1]!.documentId
  }
}

// ---------------------------------------------------------------- helpers used by the tools

/** Adds a document to the host (it becomes current); without a host it replaces the single document. */
export function addDocument(ctx: ToolContext, doc: Document, opts: { path?: string | null; exportTo?: ExportTarget; dirty?: boolean } = {}): string {
  if (ctx.documents) return ctx.documents.add(doc, opts)
  ctx.session.replaceDocument(doc, { label: `Open ${doc.name}` })
  return ctx.session.doc.id
}

/** The document a tool call addresses: `documentId`, else the current one. Works without a host too. */
export function resolveDocument(ctx: ToolContext, documentId?: string): DocumentRef {
  if (ctx.documents) return ctx.documents.resolve(documentId)
  if (documentId !== undefined && documentId !== '' && documentId !== ctx.session.doc.id) {
    throw new Error(`Unknown document "${documentId}": this host has a single document (id ${ctx.session.doc.id}).`)
  }
  return { documentId: ctx.session.doc.id, session: ctx.session, path: null }
}

export interface WritePngOptions {
  width?: number
  height?: number
  scale?: number
  /** Frame id or index (default: the active frame). */
  frame?: string | number
  layerIds?: string[]
  includeHidden?: boolean
  includeReference?: boolean
}

/** Flatten the visible layers of a frame, scale it (exact size or integer factor) and write the PNG. */
export async function writeDocumentPng(
  session: EditorSession,
  services: ToolServices,
  target: string,
  opts: WritePngOptions = {}
): Promise<{ path: string; width: number; height: number; frame: number }> {
  const doc = session.doc
  const frame = opts.frame === undefined ? session.activeFrame : (doc.frames.find((f) => f.id === opts.frame) ?? doc.frames[Number(opts.frame)])
  if (!frame) throw new Error(`Frame ${JSON.stringify(opts.frame)} not found.`)
  const img = frameImage(doc, frame.id, opts)
  const full = await services.resolveExportPath(withExtension(target, 'png'))
  await services.writeFile(full, encodePng(img))
  return { path: full, width: img.width, height: img.height, frame: frameIndex(doc, frame.id) }
}

/** Write the PNG a document was opened with `exportTo` for (called after every save). */
export async function exportToTarget(ref: DocumentRef, services: ToolServices): Promise<string | undefined> {
  if (!ref.exportTo) return undefined
  const r = await writeDocumentPng(ref.session, services, ref.exportTo.path, { width: ref.exportTo.width, height: ref.exportTo.height })
  return r.path
}
