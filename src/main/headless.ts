// Headless mode (`--mcp-only`): the MCP server with no window.
//
// Decision (after reading toolBridge.ts): the tool bridge exists only because the renderer owns the live
// document. EditorSession, the tool registry and the core are pure TypeScript, and ToolServices has a Node
// implementation, so the tools run right here in the main process against a DocumentSet (several
// documents, each its own EditorSession). No hidden BrowserWindow, no IPC round trip, no readiness race.
// No Electron import: `startHeadless` is testable; src/main/index.ts supplies the services and the port.

import { McpHttpServer, type McpHost } from './mcp'
import { type NodeServices, createNodeServices } from './services'
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

export async function startHeadless(opts: HeadlessOptions): Promise<Headless> {
  const services = opts.services ?? createNodeServices()
  const { host, documents } = createHeadlessHost(services)
  const server = new McpHttpServer({ host, port: opts.port, token: opts.token ?? null, log: opts.log })
  const status = await server.start()
  return {
    server,
    documents,
    host,
    url: status.running ? status.url : null,
    error: status.error,
    stop: () => server.stop()
  }
}
