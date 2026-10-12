// The app-wide EditorSession: the live document, its undo history, active layer/frame, selection,
// colours and onion skin. UI components edit it only through session.execute(command) / transactions,
// and the LLM tool bridge drives the very same object, so both share one undo history.
//
// With several documents open (tabs, see workspace.ts) `session` stands for the active tab's session:
// every property read or method call goes to it, and subscribe/getVersion follow the whole workspace,
// so a component re-renders when the active tab changes too.

import { EditorSession } from '../../tools/session'
import { Workspace } from './workspace'

export const workspace = new Workspace()

export const session: EditorSession = new Proxy({} as EditorSession, {
  get(_target, prop) {
    if (prop === 'subscribe') return workspace.subscribe
    if (prop === 'getVersion') return workspace.getVersion
    const s = workspace.active.session
    const value = Reflect.get(s, prop, s) as unknown
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(s) : value
  },
  set(_target, prop, value) {
    return Reflect.set(workspace.active.session, prop, value)
  },
  has(_target, prop) {
    return prop in workspace.active.session
  },
  getPrototypeOf() {
    return EditorSession.prototype
  }
})
