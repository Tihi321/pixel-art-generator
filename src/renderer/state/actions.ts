// UI actions: thin wrappers that build core commands and run them through the session.
// Errors thrown by command factories (locked layer, last frame, bad tag range...) become status messages.

import {
  type Anchor,
  type Command,
  type CreatingCommand,
  type Document,
  type LayerPatch,
  type Palette,
  type TagSpec,
  createAddColorsCommand,
  createAddFrameCommand,
  createAddLayerCommand,
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
  createRemapToPaletteCommand,
  createRemoveColorsCommand,
  createResizeCanvasCommand,
  createSetFrameDurationCommand,
  createSetPaletteCommand,
  createUpdateLayerCommand,
  createUpdateTagCommand,
  deserializeProject,
  getBuiltinPalette,
  serializeProject
} from '../../core'
import { type DocumentHost, type ExportTarget, exportToTarget } from '../../tools/documents'
import { EditorSession } from '../../tools/session'
import { decodeText, readFile, resolveProjectPath, writeFile } from '../lib/files'
import { createIpcServices } from '../toolBridgeClient'
import { session, workspace } from './session'
import { useUi } from './ui'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Run fn; show any error in the status bar. Returns true on success. */
export function attempt(fn: () => void): boolean {
  try {
    fn()
    return true
  } catch (e) {
    useUi.getState().setStatus(message(e))
    return false
  }
}

async function attemptAsync<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    useUi.getState().setStatus(message(e))
    return undefined
  }
}

function exec(make: (doc: Document) => Command): boolean {
  return attempt(() => session.execute(make(session.doc)))
}

function execCreating(make: (doc: Document) => CreatingCommand): string | undefined {
  let id: string | undefined
  attempt(() => {
    const cmd = make(session.doc)
    session.execute(cmd)
    id = cmd.createdId
  })
  return id
}

// ---------------------------------------------------------------- history

export function undo(): void {
  session.undo()
}
export function redo(): void {
  session.redo()
}

// ---------------------------------------------------------------- layers

export function addLayer(): void {
  const index = session.activeLayerIndex + 1
  const id = execCreating((d) => createAddLayerCommand(d, { index }))
  if (id) session.setActiveLayer(id)
}
export function deleteLayer(id: string): void {
  exec((d) => createDeleteLayerCommand(d, id))
}
export function duplicateLayer(id: string): void {
  const newId = execCreating((d) => createDuplicateLayerCommand(d, id))
  if (newId) session.setActiveLayer(newId)
}
export function mergeLayerDown(id: string): void {
  exec((d) => createMergeDownCommand(d, id))
}
export function updateLayer(id: string, patch: LayerPatch): void {
  exec((d) => createUpdateLayerCommand(d, id, patch))
}
export function moveLayer(id: string, toIndex: number): void {
  exec((d) => createMoveLayerCommand(d, id, toIndex))
}

// ---------------------------------------------------------------- frames

export function addFrame(): void {
  const id = execCreating((d) => createAddFrameCommand(d, { index: session.activeFrameIndex + 1 }))
  if (id) session.setActiveFrame(id)
}
export function duplicateFrame(id: string = session.activeFrame.id): void {
  const newId = execCreating((d) => createDuplicateFrameCommand(d, id))
  if (newId) session.setActiveFrame(newId)
}
export function deleteFrame(id: string = session.activeFrame.id): void {
  exec((d) => createDeleteFrameCommand(d, id))
}
export function moveFrame(id: string, toIndex: number): void {
  exec((d) => createMoveFrameCommand(d, id, toIndex))
}
export function setFrameDuration(id: string, ms: number): void {
  exec((d) => createSetFrameDurationCommand(d, id, ms))
}

// ---------------------------------------------------------------- tags

export function createTag(spec: TagSpec): string | undefined {
  return execCreating((d) => createCreateTagCommand(d, spec))
}
export function updateTag(id: string, patch: Partial<TagSpec>): void {
  exec((d) => createUpdateTagCommand(d, id, patch))
}
export function deleteTag(id: string): void {
  exec((d) => createDeleteTagCommand(d, id))
}

// ---------------------------------------------------------------- palette

export function loadPresetPalette(id: string): void {
  const p = getBuiltinPalette(id)
  if (p) exec((d) => createSetPaletteCommand(d, p))
}
export function setPalette(p: Palette): void {
  exec((d) => createSetPaletteCommand(d, p))
}
export function addPaletteColor(hex: string): void {
  exec((d) => createAddColorsCommand(d, [hex]))
}
export function removePaletteColor(index: number): void {
  exec((d) => createRemoveColorsCommand(d, [index]))
}
export function replacePaletteColor(index: number, hex: string): void {
  attempt(() => {
    const pal = session.doc.palette
    if (index < 0 || index >= pal.colors.length) throw new Error('Select a swatch first.')
    const colors = pal.colors.map((c, i) => (i === index ? { ...c, hex } : { ...c }))
    session.execute(createSetPaletteCommand(session.doc, { id: pal.id, name: pal.name, colors }))
  })
}
export function remapActiveLayer(): void {
  exec((d) => createRemapToPaletteCommand(d, { layer: session.activeLayer.id }))
}
export function remapDocument(): void {
  exec((d) => createRemapToPaletteCommand(d, {}))
}

// ---------------------------------------------------------------- tabs

/** Keeps the active tab's view for when it is shown again. */
function stashActiveTab(): void {
  workspace.active.viewport = useUi.getState().viewport
}

/** Puts the active tab's path and view into the UI state. */
function showActiveTab(): void {
  const tab = workspace.active
  useUi.getState().set({ projectPath: tab.projectPath, playing: false, selectedTagId: '', ...(tab.viewport ? { viewport: tab.viewport } : {}) })
}

export function switchTab(id: string): void {
  if (id === workspace.activeId) return
  attempt(() => {
    stashActiveTab()
    workspace.activate(id)
    showActiveTab()
  })
}

/** Ctrl+Tab / Ctrl+Shift+Tab. */
export function cycleTab(dir: 1 | -1): void {
  attempt(() => {
    stashActiveTab()
    workspace.cycle(dir)
    showActiveTab()
  })
}

/** Closes a tab; one with unsaved changes asks first. */
export function closeTab(id: string, confirm: (message: string) => boolean = (m) => window.confirm(m)): void {
  const tab = workspace.find(id)
  if (!tab) return
  if (workspace.isDirty(tab) && !confirm(`${tab.session.doc.name} has unsaved changes. Close it anyway?`)) return
  attempt(() => {
    const wasActive = id === workspace.activeId
    workspace.close(id)
    if (wasActive) showActiveTab()
  })
}

/**
 * Shows `doc` in a new tab, or in the active tab when `reuse` says so (an untitled tab nobody drew in).
 * The new tab gets its own undo history.
 */
function openInTab(doc: Document, path: string | null, label: string, reuse: boolean): void {
  if (reuse) {
    session.replaceDocument(doc, { history: 'clear', label })
    workspace.markSaved(path)
  } else {
    workspace.assertCanLeave()
    stashActiveTab()
    workspace.add(new EditorSession(doc), path)
  }
  showActiveTab()
}

// ---------------------------------------------------------------- document

/** A new document in a new tab (or in the first, untouched tab). */
export function newDocument(opts: { name: string; width: number; height: number; paletteId?: string }): boolean {
  return attempt(() => {
    const palette = opts.paletteId ? getBuiltinPalette(opts.paletteId) : undefined
    const doc = createDocument({ width: opts.width, height: opts.height, name: opts.name || 'Untitled', palette })
    openInTab(doc, null, 'New document', workspace.isPristine())
    useUi.getState().setStatus(`New ${opts.width}x${opts.height} document`)
  })
}

export function resizeCanvas(width: number, height: number, anchor: Anchor): boolean {
  return exec((d) => createResizeCanvasCommand(d, width, height, anchor))
}

/**
 * Opens a .pxs project from text in a new tab (an untitled tab without unsaved changes is reused).
 * A file that is open already is shown instead of being opened twice.
 */
export function openProjectText(text: string, path: string | null): boolean {
  return attempt(() => {
    const open = path ? workspace.findByPath(path) : undefined
    if (open) {
      stashActiveTab()
      workspace.activate(open.id)
      showActiveTab()
      useUi.getState().setStatus(`${open.session.doc.name} is open already`)
      return
    }
    const doc = deserializeProject(text)
    const active = workspace.active
    openInTab(doc, path, 'Open project', active.projectPath === null && !workspace.isDirty(active))
    useUi.getState().setStatus(`Opened ${doc.name}`)
  })
}

export async function openProjectFromPath(nameOrPath: string): Promise<boolean> {
  const r = await attemptAsync(async () => {
    const name = /\.pxs$/i.test(nameOrPath) ? nameOrPath : `${nameOrPath}.pxs`
    const path = await resolveProjectPath(name)
    const text = decodeText(await readFile(path))
    return openProjectText(text, path)
  })
  return r === true
}

export async function saveProject(nameOrPath?: string): Promise<boolean> {
  const r = await attemptAsync(async () => {
    const ui = useUi.getState()
    // the tab and its contents as they are now: switching tabs while the file is written doesn't change what is saved where
    const tab = workspace.active
    const data = serializeProject(tab.session.doc, { pretty: false })
    const edits = tab.edits
    let path = nameOrPath ? undefined : (tab.projectPath ?? undefined)
    if (!path) {
      const base = (nameOrPath || tab.session.doc.name || 'Untitled').trim()
      path = await resolveProjectPath(/\.pxs$/i.test(base) ? base : `${base}.pxs`)
    }
    await writeFile(path, data)
    workspace.markSaved(path, tab)
    tab.savedEdits = edits
    if (workspace.activeId === tab.id) ui.set({ projectPath: path })
    ui.setStatus(`Saved ${path}`)
    // VN Studio round trip: a document opened with exportTo also writes its PNG on every save
    if (tab.exportTo) {
      try {
        const exported = await exportToTarget({ documentId: tab.id, session: tab.session, path, exportTo: tab.exportTo }, createIpcServices())
        ui.setStatus(`Saved ${path} and exported ${exported}`)
      } catch (e) {
        ui.setStatus(`Saved ${path}, but the PNG export failed: ${message(e)}`)
      }
    }
    return true
  })
  return r === true
}

// ---------------------------------------------------------------- documents for the tools (MCP / chat agent)

/**
 * The tool registry's view of the tabs: a document id is a tab id. A document a tool adds (import_image,
 * open_document, draw_sprite_from_reference) opens in a new tab and becomes the active one; while the
 * agent works in the active tab it replaces that tab's document instead (undoable), because the agent's
 * tool calls must keep going to the same tab.
 */
export const workspaceDocuments: DocumentHost = {
  list: () =>
    workspace.tabs.map((t) => ({
      documentId: t.id,
      name: t.session.doc.name,
      width: t.session.doc.width,
      height: t.session.doc.height,
      path: t.projectPath,
      current: t.id === workspace.activeId,
      dirty: workspace.isDirty(t)
    })),
  resolve(documentId) {
    const tab = documentId ? workspace.find(documentId) : workspace.active
    if (!tab) throw new Error(`Unknown document "${documentId}". Call list_documents to see the open documents.`)
    return { documentId: tab.id, session: tab.session, path: tab.projectPath, exportTo: tab.exportTo }
  },
  add(doc: Document, opts: { path?: string | null; exportTo?: ExportTarget } = {}) {
    const path = opts.path ?? null
    const active = workspace.active
    if (active.session.turnActive) {
      active.session.replaceDocument(doc, { label: `Open ${doc.name}` })
      active.exportTo = opts.exportTo
      showActiveTab()
      return active.id
    }
    openInTab(doc, path, `Open ${doc.name}`, workspace.isPristine())
    const tab = workspace.active
    tab.exportTo = opts.exportTo
    // a document that exists only in memory is unsaved work: it is not "pristine" and closing it asks first
    if (path === null) {
      tab.edits = Math.max(tab.edits, 1)
      tab.savedEdits = 0
    }
    return tab.id
  },
  findByPath: (path) => workspace.findByPath(path)?.id,
  activate(documentId) {
    if (!workspace.find(documentId)) throw new Error(`Unknown document "${documentId}".`)
    stashActiveTab()
    workspace.activate(documentId)
    showActiveTab()
  },
  setExportTarget(documentId, target) {
    const tab = workspace.find(documentId)
    if (tab) tab.exportTo = target
  },
  markSaved(documentId, path) {
    const tab = workspace.find(documentId)
    if (!tab) return
    workspace.markSaved(path, tab)
    if (workspace.activeId === tab.id) useUi.getState().set({ projectPath: path })
  }
}
