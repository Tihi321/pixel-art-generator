import { createDocument } from '../../src/core'
import { McpHttpServer, type McpHttpServerOptions } from '../../src/main/mcp'
import { EditorSession, createDefaultRegistry, createMemoryToolServices, createToolHost } from '../../src/tools'

export function memoryHost() {
  const session = new EditorSession(createDocument({ width: 16, height: 16, name: 'test' }))
  const services = createMemoryToolServices()
  const host = createToolHost(createDefaultRegistry(), () => ({ session, services }))
  return { session, services, host }
}

export async function startServer(opts: Partial<McpHttpServerOptions> = {}) {
  const mem = memoryHost()
  const server = new McpHttpServer({ host: mem.host, port: 0, ...opts })
  const status = await server.start()
  if (!status.running) throw new Error(`server did not start: ${status.error}`)
  return { ...mem, server, url: new URL(status.url!), port: Number(new URL(status.url!).port) }
}
