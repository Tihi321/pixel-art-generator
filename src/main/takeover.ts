// Window start next to a running headless engine: ask it to hand its documents over (POST /engine/handover),
// wait for its port, and turn the answer into open_document calls. No Electron import (the dialog is in index.ts).

import { createServer } from 'node:net'
import { dirname } from 'node:path'
import type { EngineLock } from './engineLock'
import type { HandoverDocument } from './headless'

export type EngineChoice = 'takeover' | 'without-mcp' | 'quit'

/** PIXEL_STUDIO_ENGINE_CHOICE answers the dialog (scripted launches and tests). */
export function choiceFromEnv(env: NodeJS.ProcessEnv = process.env): EngineChoice | null {
  const v = env['PIXEL_STUDIO_ENGINE_CHOICE']?.trim().toLowerCase()
  return v === 'takeover' || v === 'without-mcp' || v === 'quit' ? v : null
}

export function handoverUrl(lock: EngineLock): string {
  return new URL('/engine/handover', lock.url).toString()
}

export type HandoverResult = { ok: true; documents: HandoverDocument[] } | { ok: false; reason: string }

/** Asks the headless engine to write its documents to disk and exit. */
export async function requestHandover(lock: EngineLock, token: string | null): Promise<HandoverResult> {
  try {
    const res = await fetch(handoverUrl(lock), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: '{}'
    })
    if (res.status === 401) return { ok: false, reason: 'the engine wants a bearer token (set PIXEL_STUDIO_MCP_TOKEN to the one it runs with)' }
    if (!res.ok) return { ok: false, reason: `the engine answered ${res.status}` }
    const body = (await res.json()) as { documents?: HandoverDocument[] }
    return { ok: true, documents: body.documents ?? [] }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Polls until nothing listens on 127.0.0.1:port any more (the old engine is shutting down). */
export async function waitForPortFree(port: number, timeoutMs = 5000): Promise<boolean> {
  const free = (): Promise<boolean> =>
    new Promise((resolve) => {
      const s = createServer()
      s.once('error', () => resolve(false))
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
    })
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await free()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return free()
}

/** The open_document arguments (with the internal `handover` option) that restore one handed-over document. */
export function openArgsFor(d: HandoverDocument): Record<string, unknown> {
  return {
    path: d.file,
    ...(d.exportTo ? { exportTo: d.exportTo.path, exportWidth: d.exportTo.width, exportHeight: d.exportTo.height } : {}),
    handover: { ...(d.path ? { path: d.path } : {}), dirty: d.dirty }
  }
}

/** The folder the handover files are in (deleted once the tabs are open). */
export function handoverDir(docs: HandoverDocument[]): string | null {
  return docs[0] ? dirname(docs[0].file) : null
}
