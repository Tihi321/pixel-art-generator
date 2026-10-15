// The open documents (tabs): one EditorSession per tab, each with its own undo history. The app-wide
// `session` (state/session.ts) always stands for the active tab's session, so the UI, the shortcuts and
// the tool bridge (chat agent, MCP) all work on the tab that is shown. No React, no DOM: unit-tested.

import { createDocument } from '../../core'
import type { HistoryEvent } from '../../core'
import type { ExportTarget } from '../../tools/documents'
import { EditorSession } from '../../tools/session'
import type { Viewport } from '../lib/viewport'

export interface DocTab {
  id: string
  session: EditorSession
  /** Where the document was opened from or saved to; null until it is saved. */
  projectPath: string | null
  /** The view to come back to when the tab is shown again (kept while another tab is active). */
  viewport: Viewport | null
  /** The `doc.id:WxH` the view was last fitted to (the canvas fits once per document and size). */
  fitKey: string
  /** Undo-history changes so far, and their count at the last save or open. */
  edits: number
  savedEdits: number
  /** Set by `--open --export-to` / open_document exportTo: every save also writes this PNG. */
  exportTo?: ExportTarget
}

const EDIT_EVENTS: ReadonlySet<HistoryEvent['type']> = new Set(['execute', 'undo', 'redo', 'clear', 'transaction-commit'])

let tabSeq = 0

export class Workspace {
  tabs: DocTab[] = []
  activeId = ''
  private version = 0
  private listeners = new Set<() => void>()

  constructor(first: EditorSession = new EditorSession()) {
    this.add(first, null)
  }

  // ------------------------------------------------------------ subscription (useSyncExternalStore)

  /** Changes on every change of any tab's session, the tab list or the active tab. */
  getVersion = (): number => this.version

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    this.version++
    for (const l of [...this.listeners]) l()
  }

  // ------------------------------------------------------------ tabs

  get active(): DocTab {
    return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0]!
  }

  find(id: string): DocTab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  /** The tab that has `path` open (paths compared without case, as on Windows). */
  findByPath(path: string): DocTab | undefined {
    const p = path.toLowerCase()
    return this.tabs.find((t) => t.projectPath?.toLowerCase() === p)
  }

  isDirty(tab: DocTab = this.active): boolean {
    return tab.edits !== tab.savedEdits
  }

  /** An untitled tab nobody has drawn in: New and Open reuse it instead of adding a tab. */
  isPristine(tab: DocTab = this.active): boolean {
    return tab.projectPath === null && tab.edits === 0
  }

  /** Adds a tab (after the active one) and shows it. */
  add(session: EditorSession, projectPath: string | null): DocTab {
    const tab: DocTab = { id: `tab${++tabSeq}`, session, projectPath, viewport: null, fitKey: '', edits: 0, savedEdits: 0 }
    session.history.subscribe((e) => {
      if (EDIT_EVENTS.has(e.type)) tab.edits++
    })
    session.subscribe(() => this.notify())
    const at = this.tabs.findIndex((t) => t.id === this.activeId)
    this.tabs.splice(at < 0 ? this.tabs.length : at + 1, 0, tab)
    this.activeId = tab.id
    this.notify()
    return tab
  }

  /** A new tab with an empty 32x32 document. */
  addBlank(): DocTab {
    return this.add(new EditorSession(createDocument({ width: 32, height: 32, name: 'Untitled' })), null)
  }

  /** Throws while the agent works in the active tab: its tool calls must keep going to the same document. */
  assertCanLeave(): void {
    if (this.active.session.turnActive) throw new Error('The agent is working in this tab. Wait for it or stop it first.')
  }

  activate(id: string): void {
    if (id === this.activeId) return
    if (!this.find(id)) throw new Error(`No tab ${id}.`)
    this.assertCanLeave()
    this.activeId = id
    this.notify()
  }

  /** Shows the next (+1) or previous (-1) tab, wrapping around. */
  cycle(dir: 1 | -1): void {
    if (this.tabs.length < 2) return
    const i = this.tabs.findIndex((t) => t.id === this.activeId)
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]!.id)
  }

  /** Closes a tab; closing the last one leaves a fresh untitled tab. The neighbour on the right (else left) is shown. */
  close(id: string): void {
    const i = this.tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    if (this.tabs[i]!.session.turnActive) throw new Error('The agent is working in this tab. Wait for it or stop it first.')
    if (id === this.activeId) this.assertCanLeave()
    this.tabs.splice(i, 1)
    if (this.tabs.length === 0) {
      this.activeId = ''
      this.addBlank()
      return
    }
    if (id === this.activeId) this.activeId = (this.tabs[i] ?? this.tabs[i - 1]!).id
    this.notify()
  }

  /** The active tab's document was saved to (or opened from) `path`. */
  markSaved(path: string | null, tab: DocTab = this.active): void {
    tab.projectPath = path
    tab.savedEdits = tab.edits
    this.notify()
  }
}
