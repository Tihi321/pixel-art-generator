// Chat store: the transcript (pure reducer in chatReducer.ts), the model list and the undo bookkeeping
// of the last agent turn. The conversation itself lives in main; this is only the view of it.

import { create } from 'zustand'
import type { LlmOverview } from '../../shared/agent'
import { agentApi, llmApi } from '../lib/agentApi'
import { session } from './session'
import { type ChatState, type TurnUndoInfo, addError, applyEvent, initialChat, resetChat } from './chatReducer'

export interface ChatStore extends ChatState {
  overview: LlmOverview | null
  overviewError: string | null
  /** The last agent turn's place in the undo history (see canUndoAgentTurn). */
  turn: TurnUndoInfo | null
  draft: string

  setDraft: (text: string) => void
  loadOverview: () => Promise<void>
  setOverview: (o: LlmOverview) => void
  selectModel: (ref: string | null) => Promise<void>
  send: (text: string) => Promise<void>
  stop: () => Promise<void>
  newChat: () => Promise<void>
  undoTurn: () => void
}

let startDepth = 0

export const useChat = create<ChatStore>((set, get) => ({
  ...initialChat(),
  overview: null,
  overviewError: null,
  turn: null,
  draft: '',

  setDraft: (draft) => set({ draft }),
  setOverview: (overview) => set({ overview, overviewError: overview.error ?? null }),

  async loadOverview() {
    try {
      get().setOverview(await llmApi.overview())
    } catch (e) {
      set({ overviewError: e instanceof Error ? e.message : String(e) })
    }
  },

  async selectModel(ref) {
    const prev = get().overview
    if (prev) set({ overview: { ...prev, selectedModel: ref } })
    try {
      await llmApi.setSelectedModel(ref)
    } catch (e) {
      set((s) => addError(s, e instanceof Error ? e.message : String(e)))
    }
  },

  async send(text) {
    const t = text.trim()
    if (!t || get().running) return
    set({ draft: '' })
    try {
      const r = await agentApi.send(t, get().overview?.selectedModel ?? null)
      if (!r.ok) set((s) => addError(s, r.error))
    } catch (e) {
      set((s) => addError(s, e instanceof Error ? e.message : String(e)))
    }
  },

  async stop() {
    try {
      await agentApi.stop()
    } catch {
      /* nothing running */
    }
  },

  async newChat() {
    try {
      await agentApi.reset()
    } catch {
      /* main not ready: still clear the view */
    }
    set({ ...resetChat(), turn: null })
  },

  undoTurn() {
    if (session.undo()) set({ turn: null })
  }
}))

let started = false

/** Subscribes to the agent's push events once. Call from the app root so events are kept while the Chat tab is hidden. */
export function initChat(): void {
  if (started) return
  started = true
  agentApi.onEvent((ev) => {
    if (ev.type === 'start') startDepth = session.history.undoDepth
    useChat.setState((s) => {
      const next = applyEvent(s, ev)
      if (ev.type === 'done' && ev.runId === s.runId) return { ...next, turn: { startDepth, endDepth: session.history.undoDepth } }
      if (ev.type === 'start') return { ...next, turn: null }
      return next
    })
  })
  void useChat.getState().loadOverview()
  void agentApi
    .getState()
    .then((st) => {
      if (st.running) useChat.setState({ running: true, runId: st.runId })
    })
    .catch(() => undefined)
}
