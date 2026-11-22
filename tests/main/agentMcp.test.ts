import { describe, expect, it, vi } from 'vitest'
import { MockProvider } from '../../src/llm/mock'
import type { MockReply } from '../../src/llm/mock'
import { collect } from '../../src/llm/types'
import type { ChatFn } from '../../src/llm/types'
import { AgentRunLog, MAX_RUNS, MAX_RUN_EVENTS, type AgentHandles, type AgentLlm, createAgent, withAgentTools } from '../../src/main/agentMcp'
import type { ChatHistoryStore } from '../../src/main/chatHistory'
import type { McpHost } from '../../src/main/mcp'
import type { LlmOverview } from '../../src/shared/agent'
import type { ToolDef, ToolResult, TurnToolHost } from '../../src/shared/tools'

const def = (name: string): ToolDef => ({ name, description: name, parameters: { type: 'object', properties: {} } })
const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })
const zero = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }

const bridge: TurnToolHost = {
  tools: () => ['get_document', 'draw_grid'].map(def),
  async execute(name) {
    if (name === 'draw_grid') return { content: [{ type: 'text', text: 'draw_grid ok' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] }
    return text(name === 'get_document' ? 'DOC 16x16' : `${name} ok`)
  },
  beginTurn: () => undefined,
  endTurn: () => undefined
}
const baseHost: McpHost = { tools: () => [def('draw_grid')], execute: async () => text('base') }

function mockChat(mock: MockProvider): ChatFn {
  return async (messages, o = {}) => ({ ...(await collect(mock.chat({ model: 'mock', messages, tools: o.tools, toolChoice: o.toolChoice, schema: o.schema, signal: o.signal }), o.onDelta)), costUsd: 0 })
}

const reply = (o: object, chunkDelayMs = 1): MockReply => ({ text: JSON.stringify(o), chunkDelayMs })

/** A fake LlmService: every run is a JSON-action run on the mock provider, no real model. */
function fakeLlm(mock: MockProvider, check: Awaited<ReturnType<AgentLlm['checkAgentModel']>> = { ok: true, ref: 'mock/m' }, overview: Partial<LlmOverview> = {}): AgentLlm {
  return {
    resolveModel: async () => ({ source: { chat: mockChat(mock), capabilities: { tools: false, vision: false } }, vision: false, ref: 'mock/m' }),
    checkAgentModel: async () => check,
    overview: async () => overview as LlmOverview
  }
}

const parse = (r: ToolResult): Record<string, unknown> => JSON.parse((r.content[0] as { text: string }).text)
const errText = (r: ToolResult): string => (r.content[0] as { text: string }).text

function setup(llm: AgentLlm, o: { timeoutMs?: number } = {}): { agent: AgentHandles; host: McpHost } {
  const agent = createAgent({ bridge, llm })
  return { agent, host: withAgentTools(baseHost, agent, o) }
}
const sig = new AbortController().signal

describe('artist agent over MCP', () => {
  it('start_agent_run returns a run id at once and get_agent_run follows it to the reply; a second start while it runs is refused; the next start begins a new conversation', async () => {
    const mock = new MockProvider('mock')
    mock.script([
      reply({ say: 'Drawing', actions: [{ tool: 'draw_grid', args: {} }], done: false }, 60),
      reply({ say: 'Done: a red square', actions: [], done: true }),
      reply({ say: 'ok', actions: [], done: true })
    ])
    const models = [
      { ref: 'a/x', label: 'X', tools: false, vision: false, local: true, available: true, free: true, shown: true },
      { ref: 'b/y', label: 'Y', tools: true, vision: true, local: false, available: false, free: false, shown: false }
    ]
    const { agent, host } = setup(fakeLlm(mock, undefined, { defaultModel: 'a/x', selectedModel: null, models: models as LlmOverview['models'] }))
    expect(host.tools().map((t) => t.name)).toEqual(['draw_grid', 'start_agent_run', 'get_agent_run', 'stop_agent_run', 'list_models'])

    const started = parse(await host.execute('start_agent_run', { text: 'Draw a red square' }, sig))
    expect(started['model']).toBe('mock/m')
    const runId = started['runId'] as string
    expect(agent.runner.getState()).toMatchObject({ running: true, runId })
    expect(parse(await host.execute('get_agent_run', { runId }, sig))['state']).toBe('running')

    const second = await host.execute('start_agent_run', { text: 'another' }, sig)
    expect(second.isError).toBe(true)
    expect(errText(second)).toContain(runId)

    await agent.runner.whenIdle()
    const run = parse(await host.execute('get_agent_run', { runId }, sig))
    expect(run).toMatchObject({ state: 'completed', reply: 'Done: a red square', startedBy: 'mcp', text: 'Draw a red square' })
    const events = run['events'] as Array<Record<string, unknown>>
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'draw_grid')).toBe(true)
    const drawn = events.find((e) => e.type === 'tool_result' && e.name === 'draw_grid')
    expect(drawn).toMatchObject({ hasImage: true })
    expect(drawn).not.toHaveProperty('image')

    const chatBefore = agent.runner.getState().chatId
    expect((await host.execute('start_agent_run', { text: 'again' }, sig)).isError).toBeFalsy()
    await agent.runner.whenIdle()
    expect(agent.runner.getState().chatId).not.toBe(chatBefore)
    const roles = mock.requests.at(-1)!.messages.map((m) => m.role)
    expect(roles.filter((r) => r === 'user')).toHaveLength(1)
    expect(roles).not.toContain('assistant')

    const listed = parse(await host.execute('list_models', {}, sig))
    expect(listed).toMatchObject({ defaultModel: 'a/x', selectedModel: null, unavailable: 1 })
    expect(listed['models']).toEqual([{ ref: 'a/x', label: 'X', tools: false, vision: false, local: true, free: true, shown: true }])
  })

  it('a start while the last run is still saving its chat is refused, and works once the save settles', async () => {
    const mock = new MockProvider('mock')
    mock.script([reply({ say: 'one', actions: [], done: true }), reply({ say: 'two', actions: [], done: true })])
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    let saveCalled!: () => void
    const saving = new Promise<void>((r) => (saveCalled = r))
    const chats = { save: async () => (saveCalled(), gate) } as unknown as ChatHistoryStore
    const agent = createAgent({ bridge, llm: fakeLlm(mock), chats })
    const host = withAgentTools(baseHost, agent)
    const runId = parse(await host.execute('start_agent_run', { text: 'first' }, sig))['runId'] as string
    await saving
    expect(parse(await host.execute('get_agent_run', { runId }, sig))['state']).toBe('running')
    const busy = await host.execute('start_agent_run', { text: 'second' }, sig)
    expect(busy.isError).toBe(true)
    expect(errText(busy)).toContain(runId)
    open()
    await agent.runner.whenIdle()
    expect(parse(await host.execute('get_agent_run', { runId }, sig))['state']).toBe('completed')
    expect((await host.execute('start_agent_run', { text: 'second' }, sig)).isError).toBeFalsy()
    await agent.runner.whenIdle()
  })

  it('no model: an error at once and nothing runs; an unknown run id is an error', async () => {
    const mock = new MockProvider('mock')
    const llm = fakeLlm(mock, { ok: false, error: 'No model is available for the artist: check config/providers.md.' })
    const { agent, host } = setup(llm)
    const r = await host.execute('start_agent_run', { text: 'draw' }, sig)
    expect(r.isError).toBe(true)
    expect(errText(r)).toContain('No model is available')
    const spy = vi.spyOn(llm, 'checkAgentModel')
    await host.execute('start_agent_run', { text: 'x', model: '' }, sig)
    await host.execute('start_agent_run', { text: 'x', model: '  ' }, sig)
    expect(spy.mock.calls).toEqual([[undefined], [undefined]])
    expect(agent.runner.getState().running).toBe(false)
    expect(mock.requests).toHaveLength(0)
    const get = await host.execute('get_agent_run', { runId: 'nope' }, sig)
    const stop = await host.execute('stop_agent_run', { runId: 'nope' }, sig)
    expect(get.isError).toBe(true)
    expect(stop.isError).toBe(true)
    expect(errText(get)).toBe(errText(stop))
  })

  it('an MCP run stops at its time limit or with stop_agent_run, and the log keeps its bounds', async () => {
    const mock = new MockProvider('mock')
    mock.onAny({ text: '{"say":"slow","actions":[],"done":true}', chunkDelayMs: 5000 })
    const { agent, host } = setup(fakeLlm(mock), { timeoutMs: 30 })
    const id1 = parse(await host.execute('start_agent_run', { text: 'slow one' }, sig))['runId'] as string
    await agent.runner.whenIdle()
    expect(parse(await host.execute('get_agent_run', { runId: id1 }, sig))).toMatchObject({ state: 'aborted', timedOut: true })

    const host2 = withAgentTools(baseHost, agent)
    const id2 = parse(await host2.execute('start_agent_run', { text: 'slow two' }, sig))['runId'] as string
    const stopped = parse(await host2.execute('stop_agent_run', { runId: id2 }, sig))
    expect(stopped).toMatchObject({ stopped: true, state: 'aborted', stoppedBy: 'mcp' })
    expect(stopped['timedOut']).toBeUndefined()
    expect(agent.runner.getState().running).toBe(false)
    const again = await host2.execute('stop_agent_run', { runId: id2 }, sig)
    expect(again.isError).toBeFalsy()
    expect(parse(again)).toMatchObject({ stopped: false, state: 'aborted' })

    const id3 = parse(await host2.execute('start_agent_run', { text: 'x'.repeat(10_000) }, sig))['runId'] as string
    await host2.execute('stop_agent_run', { runId: id3 }, sig)
    expect(parse(await host2.execute('get_agent_run', { runId: id3 }, sig))['text']).toBe(`${'x'.repeat(4000)}…`)
    // a run the repeat guard ended is flagged, its state stays completed
    const looped = createAgent({ bridge, llm: fakeLlm(new MockProvider('mock')), run: async () => ({ reason: 'completed', repeatStop: true, messages: [], steps: 2, usage: zero, costUsd: 0 }) })
    const host4 = withAgentTools(baseHost, looped)
    const id4 = parse(await host4.execute('start_agent_run', { text: 'loop' }, sig))['runId'] as string
    await looped.runner.whenIdle()
    expect(parse(await host4.execute('get_agent_run', { runId: id4 }, sig))).toMatchObject({ state: 'completed', repeatStop: true })
    let closed = false
    const host3 = withAgentTools(baseHost, agent, { closed: () => closed })
    closed = true
    const refused = await host3.execute('start_agent_run', { text: 'after shutdown' }, sig)
    expect(refused.isError).toBe(true)
    expect(errText(refused)).toContain('shutting down')
    expect(agent.runner.getState().running).toBe(false)

    const log = new AgentRunLog()
    log.begin('r', 't', 'mcp')
    for (let i = 1; i <= MAX_RUN_EVENTS + 10; i++) log.record({ runId: 'r', type: 'step', step: i, maxSteps: 99, mode: 'json' })
    expect(log.get('r')).toMatchObject({ droppedEvents: 10 })
    expect(log.get('r')!.events).toHaveLength(20)
    for (let i = 0; i <= MAX_RUNS; i++) {
      log.begin(`f${i}`, 't', 'mcp')
      log.record({ runId: `f${i}`, type: 'done', reason: 'completed', steps: 1, usage: zero, costUsd: 0 })
    }
    const done = (id: string, reason: 'completed' | 'aborted'): void => log.record({ runId: id, type: 'done', reason, steps: 1, usage: zero, costUsd: 0 })
    log.begin('c', 't', 'mcp')
    log.markStopped('c')
    log.markTimedOut('c')
    done('c', 'completed')
    expect(log.get('c')!.stoppedBy).toBeUndefined()
    expect(log.get('c')!.timedOut).toBeUndefined()
    expect(log.get('c')!.repeatStop).toBeUndefined()
    log.begin('a', 't', 'mcp')
    log.markStopped('a')
    log.markTimedOut('a')
    done('a', 'aborted')
    expect(log.get('a')).toMatchObject({ state: 'aborted', stoppedBy: 'mcp', timedOut: true })
    expect(log.get('f0')).toBeUndefined()
    expect(log.get(`f${MAX_RUNS}`)).toBeDefined()
  })
})
