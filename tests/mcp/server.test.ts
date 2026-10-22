import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { decodePng } from '../../src/core'
import { McpHttpServer } from '../../src/main/mcp'
import { GUIDE, GUIDE_SHORT } from '../../src/tools'
import { startServer } from './helpers'

type Started = Awaited<ReturnType<typeof startServer>>
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function connect(s: Started, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(s.url, { requestInit: headers ? { headers } : undefined })
  await client.connect(transport)
  cleanup.push(async () => {
    await client.close().catch(() => undefined)
  })
  return client
}

async function start(opts: Parameters<typeof startServer>[0] = {}): Promise<Started> {
  const s = await startServer(opts)
  cleanup.push(() => s.server.stop())
  return s
}

function raw(port: number, opts: { path?: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: opts.path ?? '/mcp', method: opts.method ?? 'POST', headers: opts.headers }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end(opts.body)
  })
}

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '1' } }
})
const text = (c: unknown): string => String((c as { text?: string }).text)
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }

describe('MCP HTTP server', () => {
  it('serves instructions, tools, resources, prompts and runs the tools end to end', async () => {
    const s = await start()
    const client = await connect(s)
    expect(client.getInstructions()).toBe(GUIDE_SHORT)
    expect(s.server.sessionCount()).toBe(1)

    const { tools } = await client.listTools()
    expect(tools).toHaveLength(67)
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description).toBeTruthy()
    }
    const drawGrid = tools.find((t) => t.name === 'draw_grid')!
    expect(drawGrid.inputSchema.properties).toHaveProperty('rows')

    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri).sort()).toEqual(['pixel-studio://assets', 'pixel-studio://document', 'pixel-studio://guide', 'pixel-studio://palettes'])
    const guide = await client.readResource({ uri: 'pixel-studio://guide' })
    expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown', text: GUIDE })
    const docText = text((await client.readResource({ uri: 'pixel-studio://document' })).contents[0])
    expect(JSON.parse(docText.slice(docText.indexOf('{')))).toBeTruthy()
    const pal = await client.readResource({ uri: 'pixel-studio://palettes' })
    expect(text(pal.contents[0]).toLowerCase()).toContain('pico-8')
    const assets = await client.readResource({ uri: 'pixel-studio://assets' })
    expect(text(assets.contents[0])).toContain('[')

    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name).sort()).toEqual(['animate_sprite', 'create_sprite', 'match_style'])
    const p = await client.getPrompt({ name: 'create_sprite', arguments: { subject: 'a red slime', size: '16', frames: '2' } })
    const msg = p.messages[0]!
    expect(msg.role).toBe('user')
    expect(JSON.stringify(msg.content)).toContain('new_document')
    expect(JSON.stringify(msg.content)).toContain('red slime')
    const ms = await client.getPrompt({ name: 'match_style', arguments: { asset: 'knight', subject: 'a mage' } })
    expect(JSON.stringify(ms.messages[0]!.content)).toContain('get_style_context')

    // Tool calls
    const nd = await client.callTool({ name: 'new_document', arguments: { width: 8, height: 8, name: 'mcp' } })
    expect(nd.isError).toBeFalsy()
    const dg = await client.callTool({
      name: 'draw_grid',
      arguments: { rows: ['kk', 'kk'], legend: { k: '#ff0000' }, x: 1, y: 1 }
    })
    expect(dg.isError).toBeFalsy()
    expect(s.session.doc.width).toBe(8)

    const prev = (await client.callTool({ name: 'render_preview', arguments: { scale: 4 } })) as { content: Array<{ type: string; data?: string; mimeType?: string }> }
    const img = prev.content.find((c) => c.type === 'image')!
    expect(img.mimeType).toBe('image/png')
    expect(decodePng(Buffer.from(img.data!, 'base64'))).toMatchObject({ width: 32, height: 32 })

    const ex = await client.callTool({ name: 'export_spritesheet', arguments: { path: 'sheet', scale: 2 } })
    expect(ex.isError).toBeFalsy()
    const png = [...s.services.files.entries()].find(([k]) => k.endsWith('sheet.png'))!
    expect(decodePng(png[1])).toMatchObject({ width: 16, height: 16 })
    const meta = JSON.parse(s.services.readText(png[0].replace(/\.png$/, '.json'))) as { frames: unknown[] }
    expect(meta.frames).toHaveLength(1)

    // Errors pass through as isError results
    expect((await client.callTool({ name: 'draw_grid', arguments: {} })).isError).toBe(true)
    expect((await client.callTool({ name: 'nope', arguments: {} })).isError).toBe(true)

    // One MCP call = one undo step
    const before = s.session.doc.name
    await client.callTool({ name: 'new_document', arguments: { width: 4, height: 4, name: 'second' } })
    expect(s.session.doc.name).toBe('second')
    await client.callTool({ name: 'undo', arguments: {} })
    expect(s.session.doc.name).toBe(before)
  })

  it('closes sessions and reports the count', async () => {
    const s = await start()
    const t = new StreamableHTTPClientTransport(s.url)
    const a = new Client({ name: 'a', version: '1' })
    await a.connect(t)
    await connect(s)
    expect(s.server.getStatus().sessions).toBe(2)
    await t.terminateSession()
    await a.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(s.server.getStatus().sessions).toBe(1)
  })

  it('returns 404 for other paths', async () => {
    const s = await start()
    expect((await raw(s.port, { path: '/other', method: 'GET' })).status).toBe(404)
  })

  it('enforces the bearer token', async () => {
    const s = await start({ token: 'secret-token' })
    expect((await raw(s.port, { headers: JSON_HEADERS, body: INIT })).status).toBe(401)
    expect((await raw(s.port, { headers: { ...JSON_HEADERS, Authorization: 'Bearer wrong' }, body: INIT })).status).toBe(401)
    const client = await connect(s, { Authorization: 'Bearer secret-token' })
    expect((await client.listTools()).tools.length).toBe(67)
    await expect(connect(s)).rejects.toThrow()
  })

  it('rejects a bad Host or Origin header (DNS rebinding)', async () => {
    const s = await start()
    expect((await raw(s.port, { headers: { ...JSON_HEADERS, Host: 'evil.example.com' }, body: INIT })).status).toBe(403)
    expect((await raw(s.port, { headers: { ...JSON_HEADERS, Origin: 'https://evil.example.com' }, body: INIT })).status).toBe(403)
    expect((await raw(s.port, { headers: { ...JSON_HEADERS, Host: `localhost:${s.port}` }, body: INIT })).status).toBe(200)
  })

  it('reports EADDRINUSE as status.error without throwing', async () => {
    const s = await start()
    const second = new McpHttpServer({ host: s.host, port: s.port })
    const st = await second.start()
    expect(st.running).toBe(false)
    expect(st.error).toMatch(/in use/)
    await second.stop()
  })

  it('stop() closes the server and sessions, and start() works again', async () => {
    const s = await start()
    await connect(s)
    await s.server.stop()
    expect(s.server.getStatus()).toMatchObject({ running: false, url: null, sessions: 0 })
    expect((await s.server.start()).running).toBe(true)
  })

  it('maps a throwing host to an isError result', async () => {
    const s = await start({
      host: {
        tools: () => [{ name: 'boom', description: 'x', parameters: { type: 'object', properties: {} } }],
        execute: () => Promise.reject(new Error('kaput'))
      }
    })
    const client = await connect(s)
    const r = (await client.callTool({ name: 'boom', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> }
    expect(r.isError).toBe(true)
    expect(r.content[0]!.text).toContain('kaput')
  })
})
