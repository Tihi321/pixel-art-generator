import { type Document, createDocument } from '../../src/core'
import { EditorSession, createDefaultRegistry, createMemoryToolServices, resultText } from '../../src/tools'
import type { ToolResult } from '../../src/tools'

export function setup(opts: { width?: number; height?: number } = {}) {
  const doc: Document = createDocument({ width: opts.width ?? 16, height: opts.height ?? 16, name: 'test' })
  const session = new EditorSession(doc)
  const services = createMemoryToolServices()
  const registry = createDefaultRegistry()
  const call = (name: string, args: unknown = {}, signal?: AbortSignal): Promise<ToolResult> =>
    registry.execute(name, args, { session, services, signal })
  /** Call and fail the test if the tool returned an error. */
  const ok = async (name: string, args: unknown = {}): Promise<ToolResult> => {
    const r = await call(name, args)
    if (r.isError) throw new Error(`${name} failed: ${resultText(r)}`)
    return r
  }
  return { doc, session, services, registry, call, ok }
}

/** First JSON object in a result text (tools print a sentence, then JSON on the next line). */
export function jsonOf(r: ToolResult): Record<string, unknown> {
  const text = resultText(r)
  const start = text.indexOf('{')
  return JSON.parse(text.slice(start)) as Record<string, unknown>
}
