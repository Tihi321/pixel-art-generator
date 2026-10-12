// The built-in agent runner (main process). It owns the conversation between turns, builds the system
// prompt, wraps each run in one agent turn on the live document (one undo step), forwards events to the
// Chat panel and supports stop. No Electron import: the pieces it needs are injected, so it is unit-testable.
//
// Turn policy: the whole run is ONE undo step ("Agent: <first words>"). Completed, max-steps and
// aborted runs keep their work (Stop leaves what was drawn so far, undoable as one step). A run that
// ENDS IN AN ERROR is rolled back and its messages are not added to the conversation, so a failed turn
// leaves no half-finished artwork and no broken history.

import { randomUUID } from 'node:crypto'
import { runAgent } from '../llm'
import type { AgentEvent, AgentModelSource, AgentResult, ChatMessage, ToolHost as LlmToolHost, ToolResult as LlmToolResult } from '../llm'
import { AGENT_TURN_LABEL_PREFIX, type AgentSendResponse, type AgentState, type AgentUiEvent, type AgentUsage } from '../shared/agent'
import type { ToolHost, ToolResult, TurnToolHost } from '../shared/tools'

export const MAX_AGENT_STEPS = 25

/** Start of the get_style_context text when the document has no references. */
const NO_STYLE_REFERENCES = 'No style references'

type ImagePart = { type: 'image'; mimeType: string; data: string }

/** An event without its run id (the runner adds it). */
type UiBody = AgentUiEvent extends infer E ? (E extends { runId: string } ? Omit<E, 'runId'> : never) : never

/** Tools that change pixels: the model gets a `render_preview` after them when it can see images. */
const DRAWING_TOOL_NAMES = new Set(['set_pixels', 'flood_fill', 'replace_color', 'outline', 'transform_cel', 'clear_cel', 'copy_cel', 'remap_to_palette'])

export function isDrawingTool(name: string): boolean {
  return name.startsWith('draw_') || DRAWING_TOOL_NAMES.has(name)
}

/**
 * Wraps a host so that after a successful drawing tool the result also carries a `render_preview` image
 * (a vision model can check its own work). Off (`enabled` false) it returns the host unchanged. The
 * preview is skipped when the host has no `render_preview`, the draw failed, the call was aborted, or the
 * preview fails (the draw result is returned as it was).
 */
export function withAutoPreview(host: ToolHost, enabled: boolean): ToolHost {
  if (!enabled) return host
  return {
    tools: () => host.tools(),
    async execute(name, args, signal) {
      const result = await host.execute(name, args, signal)
      if (!isDrawingTool(name) || result.isError || signal.aborted) return result
      if (!host.tools().some((t) => t.name === 'render_preview')) return result
      if (result.content.some((c) => c.type === 'image')) return result
      try {
        const preview = await host.execute('render_preview', {}, signal)
        const images = preview.isError ? [] : preview.content.filter((c) => c.type === 'image')
        if (!images.length) return result
        return { ...result, content: [...result.content, { type: 'text', text: 'Preview of the artwork after this change:' }, ...images] }
      } catch {
        return result
      }
    }
  }
}

/** `Agent: <first words of the prompt>`, the undo label of a turn. */
export function turnLabel(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
  const short = words.length > 40 ? `${words.slice(0, 39)}…` : words
  return `${AGENT_TURN_LABEL_PREFIX}${short || 'turn'}`
}

function textOf(result: ToolResult | LlmToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).filter(Boolean).join('\n')
}

const SUMMARY_CHARS = 600
const MAX_IMAGE_CHARS = 3_000_000

function summarize(result: ToolResult | LlmToolResult): { summary: string; image?: string } {
  const text = textOf(result)
  const summary = text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}… (+${text.length - SUMMARY_CHARS} chars)` : text
  const img = result.content.find((c) => c.type === 'image')
  const image = img && img.type === 'image' && img.data.length <= MAX_IMAGE_CHARS ? `data:${img.mimeType};base64,${img.data}` : undefined
  return { summary: summary || (img ? '(image)' : '(no output)'), ...(image ? { image } : {}) }
}

export interface ResolvedAgentModel {
  source: AgentModelSource
  vision: boolean
}

export interface AgentRunnerOptions {
  /** The live document (the ToolBridge). */
  bridge: TurnToolHost
  /** The guide text (GUIDE), first part of the system prompt. */
  guide: string
  /** Receives every UI event. */
  emit: (ev: AgentUiEvent) => void
  /** Picks the model for a run. */
  resolveModel: (modelRef: string | null | undefined) => Promise<ResolvedAgentModel>
  maxSteps?: number
  /** Replace the loop (tests). */
  run?: typeof runAgent
}

export class AgentRunner {
  private history: ChatMessage[] = []
  private current: { runId: string; abort: AbortController; done: Promise<void> } | null = null
  private resetAfterRun = false

  constructor(private readonly opts: AgentRunnerOptions) {}

  getState(): AgentState {
    return { running: this.current !== null, runId: this.current?.runId ?? null, messageCount: this.history.length }
  }

  /** The conversation kept between turns (a copy). */
  messages(): ChatMessage[] {
    return [...this.history]
  }

  /** Starts a run and returns right away; events stream through `emit`. Only one run at a time. */
  send(req: { text: string; modelRef?: string | null }): AgentSendResponse {
    const text = (req.text ?? '').trim()
    if (!text) return { ok: false, error: 'Write a message first.' }
    if (this.current) return { ok: false, error: 'The agent is still working on the previous message. Stop it or wait.' }
    const runId = randomUUID()
    const abort = new AbortController()
    const done = this.execute(runId, text, req.modelRef, abort).catch(() => undefined)
    this.current = { runId, abort, done }
    return { ok: true, runId }
  }

  /** Aborts the running turn (no-op when idle). */
  stop(): void {
    this.current?.abort.abort()
  }

  /** Starts a new conversation. A running turn is aborted first; its messages are dropped when it ends. */
  reset(): AgentState {
    if (this.current) {
      this.resetAfterRun = true
      this.current.abort.abort()
    } else this.history = []
    return this.getState()
  }

  /** Resolves when the current run (if any) has finished. */
  async whenIdle(): Promise<void> {
    while (this.current) await this.current.done
  }

  private async execute(runId: string, text: string, modelRef: string | null | undefined, abort: AbortController): Promise<void> {
    const { bridge, emit } = this.opts
    const send = (ev: UiBody): void => {
      try {
        emit({ ...ev, runId } as AgentUiEvent)
      } catch {
        /* a listener must not break the run */
      }
    }
    const label = turnLabel(text)
    send({ type: 'start', label, text })
    const zero: AgentUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
    const fail = (message: string): void => {
      send({ type: 'error', message })
      send({ type: 'done', reason: 'error', steps: 0, usage: zero, costUsd: 0, error: message })
    }

    let turnOpen = false
    try {
      let model: ResolvedAgentModel
      try {
        model = await this.opts.resolveModel(modelRef)
      } catch (err) {
        return fail(`Could not set up the language models: ${err instanceof Error ? err.message : String(err)}`)
      }
      const { system, styleImages } = await this.buildSystem(abort.signal)
      if (abort.signal.aborted) {
        send({ type: 'done', reason: 'aborted', steps: 0, usage: zero, costUsd: 0 })
        return
      }
      try {
        await bridge.beginTurn(label)
        turnOpen = true
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }

      const host: LlmToolHost = withAutoPreview(bridge, model.vision)
      const result: AgentResult = await (this.opts.run ?? runAgent)({
        ...model.source,
        system,
        history: this.history,
        // Vision models see the style reference images once, with the first message of a conversation.
        userMessage:
          model.vision && styleImages.length > 0 && this.history.length === 0
            ? [{ type: 'text', text }, { type: 'text', text: 'Preview images of the style reference assets (same order as in the style context):' }, ...styleImages]
            : text,
        host,
        maxSteps: this.opts.maxSteps ?? MAX_AGENT_STEPS,
        signal: abort.signal,
        onEvent: (ev) => this.forward(ev, send)
      })

      let endError: string | undefined
      try {
        await bridge.endTurn({ rollback: result.reason === 'error' })
      } catch (err) {
        endError = `Could not close the agent turn: ${err instanceof Error ? err.message : String(err)}`
      }
      turnOpen = false
      if (result.reason !== 'error') this.history = result.messages
      const error = result.error?.message ?? endError
      send({
        type: 'done',
        reason: result.reason,
        steps: result.steps,
        usage: result.usage,
        costUsd: result.costUsd,
        ...(result.model ? { model: result.model } : {}),
        ...(error ? { error } : {})
      })
    } catch (err) {
      // Not expected: runAgent never throws. Keep the document consistent anyway.
      if (turnOpen) await Promise.resolve(bridge.endTurn({ rollback: true })).catch(() => undefined)
      fail(err instanceof Error ? err.message : String(err))
    } finally {
      this.current = null
      if (this.resetAfterRun) {
        this.history = []
        this.resetAfterRun = false
      }
    }
  }

  private forward(ev: AgentEvent, send: (ev: UiBody) => void): void {
    switch (ev.type) {
      case 'step':
        send({ type: 'step', step: ev.step, maxSteps: ev.maxSteps, mode: ev.mode })
        break
      case 'text':
        send({ type: 'text', text: ev.text })
        break
      case 'tool_call':
        send({ type: 'tool_call', id: ev.id, name: ev.name, args: ev.args })
        break
      case 'tool_result':
        send({ type: 'tool_result', id: ev.id, name: ev.name, isError: ev.isError, ...summarize(ev.result) })
        break
      case 'usage':
        send({ type: 'usage', usage: ev.usage, costUsd: ev.costUsd, ...(ev.model ? { model: ev.model } : {}) })
        break
      case 'error':
        send({ type: 'error', message: ev.error.message })
        break
      case 'done':
        break // main sends its own `done` after the turn is closed
    }
  }

  /** GUIDE + the current document (get_document) + style context (get_style_context, when references exist). */
  private async buildSystem(signal: AbortSignal): Promise<{ system: string; styleImages: ImagePart[] }> {
    const { bridge, guide } = this.opts
    const parts = [guide]
    const call = async (name: string): Promise<ToolResult | null> => {
      try {
        const r = await bridge.execute(name, {}, signal)
        return r.isError ? null : r
      } catch {
        return null
      }
    }
    const doc = await call('get_document')
    const docText = doc ? textOf(doc) : ''
    parts.push(docText ? `## Current document\n\n${docText}` : '## Current document\n\n(not available: call get_document yourself)')
    let styleImages: ImagePart[] = []
    if (bridge.tools().some((t) => t.name === 'get_style_context')) {
      const style = await call('get_style_context')
      const styleText = style ? textOf(style) : ''
      // "No style references are set ..." is not worth the tokens.
      if (style && styleText && !styleText.startsWith(NO_STYLE_REFERENCES)) {
        parts.push(`## Style context\n\n${styleText}`)
        styleImages = style.content.filter((c): c is ImagePart => c.type === 'image').slice(0, 4)
      }
    }
    return { system: parts.join('\n\n'), styleImages }
  }
}
