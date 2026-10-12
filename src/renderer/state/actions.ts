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
import { decodeText, readFile, resolveProjectPath, writeFile } from '../lib/files'
import { session } from './session'
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

// ---------------------------------------------------------------- document

export function newDocument(opts: { name: string; width: number; height: number; paletteId?: string }): boolean {
  return attempt(() => {
    const palette = opts.paletteId ? getBuiltinPalette(opts.paletteId) : undefined
    const doc = createDocument({ width: opts.width, height: opts.height, name: opts.name || 'Untitled', palette })
    session.replaceDocument(doc, { history: 'clear', label: 'New document' })
    useUi.getState().set({ projectPath: null, playing: false })
    useUi.getState().setStatus(`New ${opts.width}x${opts.height} document`)
  })
}

export function resizeCanvas(width: number, height: number, anchor: Anchor): boolean {
  return exec((d) => createResizeCanvasCommand(d, width, height, anchor))
}

/** Load a .pxs project from text. The undo history is cleared (the previous document is not recoverable). */
export function openProjectText(text: string, path: string | null): boolean {
  return attempt(() => {
    const doc = deserializeProject(text)
    session.replaceDocument(doc, { history: 'clear', label: 'Open project' })
    useUi.getState().set({ projectPath: path, playing: false })
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
    let path = nameOrPath ? undefined : (ui.projectPath ?? undefined)
    if (!path) {
      const base = (nameOrPath || session.doc.name || 'Untitled').trim()
      path = await resolveProjectPath(/\.pxs$/i.test(base) ? base : `${base}.pxs`)
    }
    await writeFile(path, serializeProject(session.doc, { pretty: false }))
    ui.set({ projectPath: path })
    ui.setStatus(`Saved ${path}`)
    return true
  })
  return r === true
}
