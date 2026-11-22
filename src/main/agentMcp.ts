// The artist agent over MCP: four tools (start_agent_run, get_agent_run, stop_agent_run, list_models) that drive the
// same AgentRunner as the chat panel, and the in-memory log of runs they read. No Electron import: used by the window
// app (agentIpc.ts, index.ts) and by headless mode (headless.ts).

import { z } from 'zod'
import type { runAgent } from '../llm'
import type { AgentStopReason, AgentUiEvent, AgentUsage } from '../shared/agent'
import type { ToolDef, ToolResult, TurnToolHost } from '../shared/tools'
import { GUIDE } from '../tools'
import { formatZodError } from '../tools/registry'
import { AgentRunner } from './agent'
import type { ChatHistoryStore } from './chatHistory'
import type { LlmService } from './llm'
import type { McpHost } from './mcp'

/** What the MCP tools need from the LLM layer (a fake in tests). */
export type AgentLlm = Pick<LlmService, 'resolveModel' | 'overview' | 'checkAgentModel'>

export interface AgentHandles {
  runner: AgentRunner
  llm: AgentLlm
  runs: AgentRunLog
}

/** A run started over MCP is stopped after this long (runs started from the chat have no limit). */
export const AGENT_RUN_TIMEOUT_MS = 30 * 60_000
/** `stop_agent_run` waits at most this long for the run to end. */
export const STOP_WAIT_MS = 10_000

export const MAX_RUNS = 20
export const MAX_RUN_EVENTS = 50
const RETURNED_EVENTS = 20
const MAX_EVENT_TEXT = 2000
const MAX_ARGS_JSON = 300
const MAX_REPLY = 4000
const MAX_RUN_TEXT = 4000
const MAX_ERROR = 2000
const MORE = '…'

export type AgentRunState = 'running' | AgentStopReason
export type CompactEvent = Record<string, unknown> & { type: string }

/** The `get_agent_run` result. */
export interface AgentRunView {
  runId: string
  state: AgentRunState
  text: string
  startedBy: 'mcp' | 'chat'
  startedAt: string
  endedAt?: string
  steps?: number
  model?: string
  usage?: AgentUsage
  costUsd?: number
  reply?: string
  error?: string
  timedOut?: boolean
  stoppedBy?: 'mcp'
  events: CompactEvent[]
  droppedEvents: number
}

interface Entry {
  runId: string
  state: AgentRunState
  text: string
  startedBy: 'mcp' | 'chat'
  startedAt: number
  endedAt?: number
  steps?: number
  model?: string
  usage?: AgentUsage
  costUsd?: number
  reply?: string
  error?: string
  timedOut?: boolean
  stoppedBy?: 'mcp'
  events: CompactEvent[]
  droppedEvents: number
}

const cut = (s: string, n: number, more = ''): string => (s.length > n ? s.slice(0, n) + more : s)

/** The last runs of this process (chat and MCP), fed by the runner's events. In memory only. */
export class AgentRunLog {
  private readonly runs = new Map<string, Entry>()
  private readonly waiters = new Map<string, Array<() => void>>()

  private create(runId: string, text: string, startedBy: 'mcp' | 'chat'): Entry {
    if (this.runs.size >= MAX_RUNS) {
      for (const [id, e] of this.runs) {
        if (e.state !== 'running') {
          this.runs.delete(id)
          break
        }
      }
    }
    const e: Entry = { runId, state: 'running', text: cut(text, MAX_RUN_TEXT, MORE), startedBy, startedAt: Date.now(), events: [], droppedEvents: 0 }
    this.runs.set(runId, e)
    return e
  }

  /** Registers a run started over MCP (or marks one already seen from its `start` event as MCP's). */
  begin(runId: string, text: string, startedBy: 'mcp' | 'chat'): void {
    const e = this.runs.get(runId)
    if (e) e.startedBy = startedBy
    else this.create(runId, text, startedBy)
  }

  record(ev: AgentUiEvent): void {
    let e = this.runs.get(ev.runId)
    if (!e) {
      if (ev.type !== 'start') return
      e = this.create(ev.runId, ev.text, 'chat')
    }
    if (ev.type === 'done') {
      e.state = ev.reason
      if (ev.reason !== 'aborted') {
        delete e.stoppedBy
        delete e.timedOut
      }
      e.endedAt = Date.now()
      e.steps = ev.steps
      e.usage = ev.usage
      e.costUsd = ev.costUsd
      if (ev.model) e.model = ev.model
      if (ev.error) e.error = cut(ev.error, MAX_ERROR, MORE)
      for (const resolve of this.waiters.get(ev.runId) ?? []) resolve()
      this.waiters.delete(ev.runId)
    } else if (ev.type === 'usage' && ev.model && !e.model) {
      e.model = ev.model
    }
    let c: CompactEvent
    switch (ev.type) {
      case 'text': {
        const last = e.events[e.events.length - 1]
        if (last?.type === 'text') {
          last['text'] = cut(String(last['text']) + ev.text, MAX_EVENT_TEXT)
          e.reply = cut((e.reply ?? '') + ev.text, MAX_REPLY)
          return
        }
        e.reply = cut(ev.text, MAX_REPLY)
        c = { type: 'text', text: cut(ev.text, MAX_EVENT_TEXT) }
        break
      }
      case 'tool_call':
        c = { type: 'tool_call', id: ev.id, name: ev.name, argsJson: cut(JSON.stringify(ev.args) ?? '', MAX_ARGS_JSON) }
        break
      case 'tool_result': {
        const { image, ...r } = ev
        c = { ...r, type: 'tool_result', ...(image ? { hasImage: true } : {}) } as CompactEvent
        delete c['runId']
        break
      }
      default:
        c = { ...ev } as CompactEvent
        delete c['runId']
        if (ev.type === 'start') c['text'] = e.text
        else if (ev.type === 'error') c['message'] = cut(ev.message, MAX_ERROR, MORE)
        else if (ev.type === 'done' && ev.error) c['error'] = e.error
    }
    e.events.push(c)
    if (e.events.length > MAX_RUN_EVENTS) {
      e.events.shift()
      e.droppedEvents++
    }
  }

  /** The run whose `done` event has not been recorded yet, if any (a run still saving its chat counts). */
  runningId(): string | undefined {
    for (const e of this.runs.values()) if (e.state === 'running') return e.runId
    return undefined
  }

  /** Resolves when the run's `done` event is recorded (at once when it is unknown or has ended). */
  ended(runId: string): Promise<void> {
    if (this.runs.get(runId)?.state !== 'running') return Promise.resolve()
    return new Promise((resolve) => this.waiters.set(runId, [...(this.waiters.get(runId) ?? []), resolve]))
  }

  markTimedOut(runId: string): void {
    const e = this.runs.get(runId)
    if (e) e.timedOut = true
  }

  markStopped(runId: string): void {
    const e = this.runs.get(runId)
    if (e) e.stoppedBy = 'mcp'
  }

  get(runId: string): AgentRunView | undefined {
    const e = this.runs.get(runId)
    if (!e) return undefined
    const { startedAt, endedAt, events, ...rest } = e
    return { ...rest, startedAt: new Date(startedAt).toISOString(), ...(endedAt ? { endedAt: new Date(endedAt).toISOString() } : {}), events: events.slice(-RETURNED_EVENTS).map((x) => ({ ...x })) }
  }
}

/** Builds the runner and the log. Every event goes to the log first, then to `emit`. */
export function createAgent(o: {
  bridge: TurnToolHost
  llm: AgentLlm
  emit?: (ev: AgentUiEvent) => void
  chats?: ChatHistoryStore
  run?: typeof runAgent
}): AgentHandles {
  const runs = new AgentRunLog()
  const runner = new AgentRunner({
    bridge: o.bridge,
    guide: GUIDE,
    emit: (ev) => {
      runs.record(ev)
      o.emit?.(ev)
    },
    resolveModel: (ref) => o.llm.resolveModel(ref),
    chats: o.chats,
    run: o.run
  })
  return { runner, llm: o.llm, runs }
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  ...(required.length ? { required } : {}),
  properties
})

const RUN_ID_PARAM = { type: 'string', description: 'The id start_agent_run returned.' }

export const AGENT_TOOL_DEFS: ToolDef[] = [
  {
    name: 'start_agent_run',
    description:
      'Start the built-in artist agent (the chat agent of Pixel Studio) on a request and return at once with a run id. It draws on the current document with the same tools, as one undo step; follow it with get_agent_run, stop it with stop_agent_run. Each request starts a new conversation unless continueChat is true. One run at a time, shared with the chat panel. Local models run in JSON-action mode and take minutes.',
    parameters: obj(
      {
        text: { type: 'string', minLength: 1, description: 'The request, as typed in the chat, e.g. "Draw a 16x16 red mushroom with white spots".' },
        model: { type: 'string', description: "provider/model or an alias of roles.md (list_models shows them). Default: the model picked in the chat, else the artist role's first available model." },
        continueChat: {
          type: 'boolean',
          description: 'Continue the current conversation, as the chat panel does (the agent sees the earlier messages). Default false: start a new conversation first; the earlier one stays saved in the chat history.'
        }
      },
      ['text']
    )
  },
  {
    name: 'get_agent_run',
    description: 'The state of an agent run: running or how it ended, the last events (steps, tool calls, results, errors), the reply, usage and cost. Runs are kept in memory (the last 20 of this Pixel Studio process).',
    parameters: obj({ runId: RUN_ID_PARAM }, ['runId'])
  },
  {
    name: 'stop_agent_run',
    description:
      'Stop an agent run and return its final state (as get_agent_run, plus stopped). What it drew so far is kept as one undo step, as with the Stop button of the chat. Works on a run started from the chat panel too. A run that has already ended is returned as it is, with stopped false.',
    parameters: obj({ runId: { type: 'string', description: 'The id start_agent_run (or get_agent_run) gave.' } }, ['runId'])
  },
  {
    name: 'list_models',
    description: "The models the artist agent can use: default and selected model, and each model's ref, label, tools, vision, local and free flags. A model with tools false runs in JSON-action mode.",
    parameters: obj({})
  }
]

const AGENT_TOOL_NAMES = new Set(AGENT_TOOL_DEFS.map((t) => t.name))

const startSchema = z.strictObject({ text: z.string().min(1), model: z.string().optional(), continueChat: z.boolean().optional() })
const runIdSchema = z.strictObject({ runId: z.string() })
const noArgs = z.strictObject({})

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const fail = (message: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: message }] })
const unknownRun = (id: string): ToolResult => fail(`Unknown run id ${id}. Runs are kept in memory for the last ${MAX_RUNS} runs of this Pixel Studio process.`)

/** The host plus the four agent tools. The agent itself never sees them (its host is the bridge, not this one). */
export function withAgentTools(host: McpHost, agent: AgentHandles, opts: { timeoutMs?: number; stopWaitMs?: number; closed?: () => boolean } = {}): McpHost {
  const { runner, runs, llm } = agent
  const timeoutMs = opts.timeoutMs ?? AGENT_RUN_TIMEOUT_MS
  const stopWaitMs = opts.stopWaitMs ?? STOP_WAIT_MS
  /** A closed host (headless shutdown or handover) starts no run; a run still saving (no `done` yet) counts as busy. */
  const busy = (): ToolResult | null => {
    if (opts.closed?.()) return fail('Pixel Studio is shutting down: no new agent run.')
    const st = runner.getState()
    const id = st.running ? st.runId : runs.runningId()
    return id ? fail(`The agent is busy with run ${id}. Wait for it with get_agent_run, or stop it with stop_agent_run.`) : null
  }
  const capped = async (p: Promise<unknown>): Promise<void> => {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      p,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, stopWaitMs)
        timer.unref()
      })
    ])
    clearTimeout(timer)
  }

  const start = async (args: unknown): Promise<ToolResult> => {
    const p = startSchema.safeParse(args ?? {})
    if (!p.success) return fail(formatZodError('start_agent_run', p.error))
    const { text, continueChat } = p.data
    const model = p.data.model?.trim() || undefined
    if (!text.trim()) return fail('start_agent_run: text must not be empty.')
    const b = busy()
    if (b) return b
    const check = await llm.checkAgentModel(model)
    if (!check.ok) return fail(check.error)
    const b2 = busy() // the check awaited: do not reset a run that began meanwhile
    if (b2) return b2
    if (!continueChat) runner.reset()
    const sent = runner.send({ text, modelRef: model ?? null })
    if (!sent.ok) return fail(sent.error)
    const runId = sent.runId
    runs.begin(runId, text, 'mcp')
    const timer = setTimeout(() => {
      if (runner.getState().runId === runId) {
        runs.markTimedOut(runId)
        runner.stop()
      }
    }, timeoutMs)
    timer.unref()
    void runner.whenIdle().then(() => clearTimeout(timer))
    return json({ runId, model: check.ref })
  }

  const stop = async (args: unknown): Promise<ToolResult> => {
    const p = runIdSchema.safeParse(args ?? {})
    if (!p.success) return fail(formatZodError('stop_agent_run', p.error))
    const { runId } = p.data
    const view = runs.get(runId)
    if (!view) return unknownRun(runId)
    if (view.state !== 'running') return json({ stopped: false, ...view })
    if (runner.getState().runId !== runId) {
      // its loop has ended and it is saving its chat: this call did not stop it, wait for its `done`
      await capped(runs.ended(runId))
      return json({ stopped: false, ...runs.get(runId) })
    }
    runs.markStopped(runId)
    runner.stop()
    await capped(runner.whenIdle())
    return json({ stopped: true, ...runs.get(runId) })
  }

  return {
    tools: () => [...host.tools(), ...AGENT_TOOL_DEFS],
    async execute(name, args, signal) {
      if (!AGENT_TOOL_NAMES.has(name)) return host.execute(name, args, signal)
      switch (name) {
        case 'start_agent_run':
          return start(args)
        case 'get_agent_run': {
          const p = runIdSchema.safeParse(args ?? {})
          if (!p.success) return fail(formatZodError(name, p.error))
          const view = runs.get(p.data.runId)
          return view ? json(view) : unknownRun(p.data.runId)
        }
        case 'stop_agent_run':
          return stop(args)
        default: {
          const p = noArgs.safeParse(args ?? {})
          if (!p.success) return fail(formatZodError(name, p.error))
          const o = await llm.overview()
          const models = o.models.filter((m) => m.available)
          return json({
            defaultModel: o.defaultModel,
            selectedModel: o.selectedModel,
            models: models.map((m) => ({ ref: m.ref, label: m.label, tools: m.tools, vision: m.vision, local: m.local, free: m.free, shown: m.shown })),
            unavailable: o.models.length - models.length,
            ...(o.error ? { error: o.error } : {})
          })
        }
      }
    }
  }
}
