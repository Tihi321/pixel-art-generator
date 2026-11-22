/// <reference lib="dom" />
import type {} from '../../src/renderer/pixelStudio'
import { describe, expect, it, vi } from 'vitest'
import { AGENT_IPC } from '../../src/shared/agent'
import type { AgentUiEvent } from '../../src/shared/agent'

describe('the Chat view follows the conversation in main', () => {
  it('a run that starts in a new chat (an MCP run) resets the transcript to that chat', async () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    ;(globalThis as { window?: unknown }).window = {
      pixelStudio: {
        on: (channel: string, cb: (payload: unknown) => void) => {
          handlers[channel] = cb
          return () => undefined
        },
        invoke: async () => ({ running: false, runId: null, messageCount: 0, chatId: 'c1' })
      }
    }
    vi.resetModules()
    const { initChat, useChat } = await import('../../src/renderer/state/chat')
    initChat()
    await vi.waitFor(() => expect(useChat.getState().chatId).toBe('c1'))

    const fire = (ev: AgentUiEvent): void => handlers[AGENT_IPC.event]!(ev)
    fire({ runId: 'r1', type: 'start', label: 'Agent: old', text: 'old question', chatId: 'c1' })
    expect(useChat.getState().items).toHaveLength(1)

    fire({ runId: 'r2', type: 'start', label: 'Agent: new', text: 'new question', chatId: 'c2' })
    const s = useChat.getState()
    expect(s.chatId).toBe('c2')
    expect(s.items).toMatchObject([{ kind: 'user', text: 'new question' }])
  })
})
