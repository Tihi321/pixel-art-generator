import { describe, expect, it } from 'vitest'
import { createAddLayerCommand, createDocument } from '../../src/core'
import { session, workspace } from '../../src/renderer/state/session'
import { Workspace } from '../../src/renderer/state/workspace'
import { EditorSession } from '../../src/tools/session'

const addLayer = (s: EditorSession) => s.execute(createAddLayerCommand(s.doc, {}))

describe('Workspace', () => {
  it('keeps one session and undo history per tab, and tracks unsaved changes', () => {
    const ws = new Workspace()
    const first = ws.active
    expect(ws.isPristine()).toBe(true)
    addLayer(first.session)
    expect(ws.isDirty()).toBe(true)
    expect(ws.isPristine()).toBe(false)

    const second = ws.add(new EditorSession(createDocument({ width: 8, height: 8, name: 'B' })), 'C:/p/b.pxs')
    expect(ws.activeId).toBe(second.id)
    expect(ws.isDirty()).toBe(false)
    expect(second.session.canUndo()).toBe(false)
    ws.activate(first.id)
    expect(ws.active.session.canUndo()).toBe(true)
    ws.markSaved('C:/p/a.pxs')
    expect(ws.isDirty(first)).toBe(false)
    expect(ws.findByPath('c:/P/B.pxs')?.id).toBe(second.id)
  })

  it('notifies on any tab change, cycles, and closing the last tab leaves a blank one', () => {
    const ws = new Workspace()
    let calls = 0
    ws.subscribe(() => calls++)
    const b = ws.addBlank()
    const c = ws.addBlank()
    expect(ws.tabs.map((t) => t.id)).toEqual([ws.tabs[0]!.id, b.id, c.id])
    ws.cycle(1)
    expect(ws.activeId).toBe(ws.tabs[0]!.id)
    ws.cycle(-1)
    expect(ws.activeId).toBe(c.id)
    addLayer(c.session)
    expect(calls).toBeGreaterThan(4)
    // closing the active tab shows its right neighbour, else the left one
    ws.activate(b.id)
    ws.close(b.id)
    expect(ws.activeId).toBe(c.id)
    ws.close(c.id)
    ws.close(ws.activeId)
    expect(ws.tabs).toHaveLength(1)
    expect(ws.isPristine()).toBe(true)
  })

  it('does not leave or close a tab while the agent works in it', () => {
    const ws = new Workspace()
    const other = ws.addBlank()
    ws.activate(ws.tabs[0]!.id)
    ws.active.session.beginTurn('Agent: go')
    expect(() => ws.activate(other.id)).toThrow(/agent is working/)
    expect(() => ws.close(ws.activeId)).toThrow(/agent is working/)
    ws.close(other.id) // another tab can still be closed
    ws.active.session.endTurn()
    expect(ws.tabs).toHaveLength(1)
  })
})

describe('session', () => {
  it('stands for the active tab: reads, calls and subscriptions follow the tab that is shown', () => {
    const first = workspace.active
    const second = workspace.add(new EditorSession(createDocument({ width: 8, height: 8, name: 'Second' })), null)
    let calls = 0
    const off = session.subscribe(() => calls++)
    expect(session.doc).toBe(second.session.doc)
    expect(session instanceof EditorSession).toBe(true)
    addLayer(session)
    expect(second.session.history.undoDepth).toBe(1)
    expect(first.session.history.undoDepth).toBe(0)
    const v = session.getVersion()
    workspace.activate(first.id)
    expect(session.getVersion()).toBeGreaterThan(v)
    expect(session.doc.name).toBe('Untitled')
    expect(session.canUndo()).toBe(false)
    session.activeFrameId = session.doc.frames[0]!.id
    expect(first.session.activeFrameId).toBe(session.doc.frames[0]!.id)
    expect(calls).toBeGreaterThan(1)
    off()
    workspace.close(second.id)
  })
})
