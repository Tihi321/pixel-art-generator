// Headless mode (`--mcp-only`): the MCP server with no window.
//
// Decision (after reading toolBridge.ts): the tool bridge exists only because the renderer owns the live
// document. EditorSession, the tool registry and the core are pure TypeScript, and ToolServices has a Node
// implementation, so the tools run right here in the main process against a DocumentSet (several
// documents, each its own EditorSession). No hidden BrowserWindow, no IPC round trip, no readiness race.
// No Electron import: `startHeadless` is testable; src/main/index.ts supplies the services and the port.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type EngineLock, acquireLock, describeHolder, readLiveLock, releaseLock } from './engineLock'
import { McpHttpServer, type McpHost } from './mcp'
import { type NodeServices, createNodeServices } from './services'
import { serializeProject } from '../core'
import { DocumentSet } from '../tools/documents'
import { createDefaultRegistry } from '../tools/defs'
import { createToolHost } from '../tools/registry'
import type { ToolServices } from '../tools/services'

export interface HeadlessOptions {
  port: number
  /** Default: Node services over ~/PixelStudio (no asset library). */
  services?: ToolServices | NodeServices
  /** Bearer token (default: none). */
  token?: string | null
  log?: (msg: string) => void
  /**
   * The data folder (~/PixelStudio): enables engine.lock (written once the server is bound, removed on stop; a
   * live lock of another engine stops the start with a message naming it) and `POST /engine/handover`.
   */
  lockRoot?: string
  version?: string
  /** Called after a window took the documents over and this server stopped: the process should exit. */
  onHandover?: () => void
}

/** One document of the handover answer: `file` is a .pxs with the content, `path` the project path it came from. */
export interface HandoverDocument {
  file: string
  name: string
  path: string | null
  exportTo?: { path: string; width?: number; height?: number }
  dirty: boolean
  current: boolean
}

export interface Headless {
  server: McpHttpServer
  documents: DocumentSet
  host: McpHost
  /** The URL the server listens on, or null when it could not bind (see `error`). */
  url: string | null
  error?: string
  stop(): Promise<void>
}

/** The tool host of headless mode: every call runs on the DocumentSet's current document. */
export function createHeadlessHost(services: ToolServices, documents: DocumentSet = new DocumentSet()): { host: McpHost; documents: DocumentSet } {
  const registry = createDefaultRegistry()
  const host = createToolHost(registry, () => ({ session: documents.session, services, documents }))
  return { host, documents }
}

/** Writes every document (not the untouched blank one) as a .pxs under `dir`, in list order. */
export async function writeHandover(documents: DocumentSet, dir: string): Promise<HandoverDocument[]> {
  await mkdir(dir, { recursive: true })
  const out: HandoverDocument[] = []
  for (const d of documents.list()) {
    if (documents.isUntouched(d.documentId)) continue
    const ref = documents.resolve(d.documentId)
    const file = join(dir, `${out.length + 1}.pxs`)
    await writeFile(file, serializeProject(ref.session.doc), 'utf8')
    out.push({ file, name: d.name, path: d.path, ...(ref.exportTo ? { exportTo: ref.exportTo } : {}), dirty: d.dirty, current: d.current })
  }
  return out
}

export async function startHeadless(opts: HeadlessOptions): Promise<Headless> {
  const services = opts.services ?? createNodeServices()
  const { host, documents } = createHeadlessHost(services)
  const root = opts.lockRoot
  let stopped = false
  const stopAll = async (): Promise<void> => {
    stopped = true
    await server.stop()
    if (root) releaseLock(root, process.pid)
  }
  const handover = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    await new Promise<void>((resolve) => req.once('end', resolve).resume()) // the body is `{}` and not used
    const list = await writeHandover(documents, join(root!, 'handover', String(Date.now())))
    if (root) releaseLock(root, process.pid) // before the answer: the window may start its own server right away
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ documents: list }))
    // stop after the answer went out; the process exits through onHandover
    res.once('close', () => void stopAll().finally(() => opts.onHandover?.()))
  }
  const server = new McpHttpServer({ host, port: opts.port, token: opts.token ?? null, log: opts.log, routes: root ? { '/engine/handover': handover } : undefined })
  const holder = root ? readLiveLock(root) : null
  if (holder) {
    const error = `${describeHolder(holder)} Use that one, or close it first.`
    return { server, documents, host, url: null, error, stop: async () => undefined }
  }
  const status = await server.start()
  if (root && status.running && status.url) {
    const lock: EngineLock = { pid: process.pid, mode: 'headless', port: Number(new URL(status.url).port), url: status.url, startedAt: new Date().toISOString(), version: opts.version ?? '' }
    acquireLock(root, lock)
  }
  return {
    server,
    documents,
    host,
    url: status.running ? status.url : null,
    error: status.error,
    stop: () => (stopped ? Promise.resolve() : stopAll())
  }
}
