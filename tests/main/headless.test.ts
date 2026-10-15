import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { decodePng, encodePng, packRgba } from '../../src/core'
import { openDocumentArgs, parseCli } from '../../src/main/cli'
import { startHeadless } from '../../src/main/headless'
import { createNodeServices } from '../../src/main/services'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixel-studio-headless-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('headless MCP', () => {
  it('answers tools/list and tools/call with no window and several documents', async () => {
    const h = await startHeadless({ port: 0, services: createNodeServices(join(root, 'home')) })
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(h.url!)))
    try {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      for (const n of ['import_image', 'export_png', 'export_many', 'draw_sprite_from_reference', 'list_documents', 'open_document', 'save_document', 'draw_grid']) {
        expect(names).toContain(n)
      }

      const src = join(root, 'src.png')
      const data = new Uint32Array(64 * 36)
      for (let i = 0; i < data.length; i++) data[i] = packRgba((i * 3) % 256, (i * 5) % 256, 90)
      await writeFile(src, encodePng({ width: 64, height: 36, data }))

      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args })
        expect(r.isError).toBeFalsy()
        const content = r.content as Array<{ type: string; text: string }>
        return JSON.parse(content[content.length - 1]!.text) as Record<string, unknown>
      }
      const a = await call('import_image', { path: src, width: 32, height: 18, palette: 'pico-8', dither: 'ordered' })
      const b = await call('import_image', { path: src, width: 16, height: 9, name: 'small' })
      expect(a['documentId']).not.toBe(b['documentId'])
      const out = join(root, 'deep', 'dir', 'a.png')
      expect(await call('export_png', { document: a['documentId'], path: out, width: 192, height: 108 })).toEqual({ paths: [out], width: 192, height: 108 })
      const png = decodePng(new Uint8Array(await readFile(out)))
      expect([png.width, png.height]).toEqual([192, 108])
      // an existing tool works on the current document (b)
      const r = await client.callTool({ name: 'get_document', arguments: {} })
      expect(JSON.stringify(r.content)).toContain('small')
      const list = await call('list_documents', {})
      expect((list['documents'] as unknown[]).length).toBe(2)
    } finally {
      await client.close().catch(() => undefined)
      await h.stop()
    }
  })

  it('reports a port that is taken instead of throwing', async () => {
    const first = await startHeadless({ port: 0, services: createNodeServices(join(root, 'h2')) })
    const port = Number(new URL(first.url!).port)
    const second = await startHeadless({ port, services: createNodeServices(join(root, 'h3')) })
    expect(second.url).toBeNull()
    expect(second.error).toMatch(/already in use/)
    await first.stop()
  })
})

describe('command line', () => {
  it('parses --mcp-only and --port', () => {
    expect(parseCli(['--mcp-only', '--port', '7500'], '/w')).toMatchObject({ mcpOnly: true, port: 7500 })
    expect(parseCli(['--mcp-only', '--port=7501'], '/w').port).toBe(7501)
    expect(parseCli(['--mcp-only', '--port', 'abc'], '/w').port).toBeUndefined()
    expect(parseCli([], '/w').mcpOnly).toBe(false)
  })

  it('parses the round-trip flags and builds the open_document arguments', () => {
    const cli = parseCli(['--open', 'C:\\art\\bg.png', '--export-to', 'C:\\art\\out.png', '--export-width', '1920', '--export-height', '1080'], 'C:\\w')
    expect(cli).toMatchObject({ open: 'C:\\art\\bg.png', exportTo: 'C:\\art\\out.png', exportWidth: 1920, exportHeight: 1080 })
    expect(openDocumentArgs(cli)).toEqual({ path: 'C:\\art\\bg.png', exportTo: 'C:\\art\\out.png', exportWidth: 1920, exportHeight: 1080 })
    expect(openDocumentArgs(parseCli(['--mcp-only']))).toBeUndefined()
  })

  it('reads values when Chromium moved the switches in front of the positional arguments (second-instance)', () => {
    const argv = ['electron.exe', '--user-data-dir=/u', '--open', '--export-to', '--export-width', '--export-height', '--allow-file-access-from-files', 'out/main/index.js', '/art/bg.png', '/art/o.png', '1920', '1080']
    expect(parseCli(argv, '/w')).toMatchObject({ open: '/art/bg.png', exportTo: '/art/o.png', exportWidth: 1920, exportHeight: 1080 })
    expect(parseCli(['electron.exe', '--open=/art/x.png', 'out/main/index.js'], '/w').open).toBe('/art/x.png')
  })
})
