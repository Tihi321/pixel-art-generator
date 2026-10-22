import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { deserializeProject } from '../../src/core'
import { acquireLock, readLock } from '../../src/main/engineLock'
import { type HandoverDocument, startHeadless } from '../../src/main/headless'
import { createNodeServices } from '../../src/main/services'
import { choiceFromEnv, openArgsFor, requestHandover, waitForPortFree } from '../../src/main/takeover'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixel-studio-handover-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function waitUntil(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20))
  expect(cond()).toBe(true)
}

describe('engine lock and handover (headless)', () => {
  it('writes engine.lock once bound and removes it on stop', async () => {
    const dir = join(root, 'lock')
    const h = await startHeadless({ port: 0, services: createNodeServices(join(root, 'home-lock')), lockRoot: dir, version: '9.9.9' })
    expect(readLock(dir)).toMatchObject({ pid: process.pid, mode: 'headless', url: h.url, version: '9.9.9', port: Number(new URL(h.url!).port) })
    await h.stop()
    expect(readLock(dir)).toBeNull()
  })

  it('refuses to start next to a live engine and names it', async () => {
    const dir = join(root, 'refuse')
    acquireLock(dir, { pid: process.ppid, mode: 'window', port: 7457, url: 'http://127.0.0.1:7457/mcp', startedAt: '', version: '' })
    const h = await startHeadless({ port: 0, services: createNodeServices(join(root, 'home-refuse')), lockRoot: dir })
    expect(h.url).toBeNull()
    expect(h.error).toBe(`Pixel Studio is already running (window, pid ${process.ppid}) and serves MCP on http://127.0.0.1:7457/mcp. Use that one, or close it first.`)
    expect(readLock(dir)?.pid).toBe(process.ppid) // the holder's lock stays
  })

  it('hands its documents over: files, answer, lock released, server stopped, onHandover called', async () => {
    const dir = join(root, 'handover')
    let handedOver = 0
    const h = await startHeadless({ port: 0, services: createNodeServices(join(root, 'home-h')), lockRoot: dir, token: 's3cret', onHandover: () => void handedOver++ })
    const base = new URL(h.url!)
    const lock = readLock(dir)!
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(base, { requestInit: { headers: { Authorization: 'Bearer s3cret' } } }))
    for (const [name, args] of [
      ['new_document', { width: 8, height: 8, name: 'one' }],
      ['save_document', { path: join(root, 'saved.pxs') }],
      ['new_document', { width: 4, height: 4, name: 'two' }],
      ['draw_rect', { x: 0, y: 0, w: 2, h: 2, color: '#ff0000', filled: true }]
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError).toBeFalsy()
    }
    await client.close().catch(() => undefined)

    // without the token: refused, nothing handed over, still running
    expect(await requestHandover(lock, null)).toMatchObject({ ok: false })
    expect(handedOver).toBe(0)
    expect(readLock(dir)).not.toBeNull()

    const r = await requestHandover(lock, 's3cret')
    expect(r.ok).toBe(true)
    const docs = (r as { documents: HandoverDocument[] }).documents
    expect(docs.map((d) => [d.name, d.path, d.dirty, d.current])).toEqual([
      ['one', join(root, 'saved.pxs'), false, false],
      ['two', null, true, true]
    ])
    expect(deserializeProject(await readFile(docs[1]!.file, 'utf8')).name).toBe('two')
    expect(deserializeProject(await readFile(docs[0]!.file, 'utf8')).width).toBe(8)
    expect(openArgsFor(docs[0]!)).toEqual({ path: docs[0]!.file, handover: { path: join(root, 'saved.pxs'), dirty: false } })
    expect(openArgsFor(docs[1]!)).toEqual({ path: docs[1]!.file, handover: { dirty: true } })

    expect(readLock(dir)).toBeNull()
    await waitUntil(() => handedOver === 1)
    expect(await waitForPortFree(Number(base.port), 3000)).toBe(true)
    await stat(docs[0]!.file) // the files stay until the window has opened them
  })

  it('open_document with the internal handover option keeps the project path, export target and unsaved state', async () => {
    const h = await startHeadless({ port: 0, services: createNodeServices(join(root, 'home-o')) })
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(h.url!)))
    try {
      expect((await client.callTool({ name: 'new_document', arguments: { width: 4, height: 4, name: 'src' } })).isError).toBeFalsy()
      const file = join(root, 'o.pxs')
      expect((await client.callTool({ name: 'save_document', arguments: { path: file } })).isError).toBeFalsy()
      const open = async (handover: Record<string, unknown>) => {
        const r = await client.callTool({ name: 'open_document', arguments: { path: file, exportTo: join(root, 'o.png'), handover } })
        expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
      }
      await open({ path: join(root, 'orig.pxs'), dirty: true })
      await open({ dirty: false })
      const docs = h.documents.list()
      expect(docs.slice(-2).map((d) => [d.path, d.dirty])).toEqual([
        [join(root, 'orig.pxs'), true],
        [null, false]
      ])
      expect(h.documents.resolve(docs[docs.length - 2]!.documentId).exportTo).toEqual({ path: join(root, 'o.png'), width: undefined, height: undefined })
    } finally {
      await client.close().catch(() => undefined)
      await h.stop()
    }
  })

  it('has no handover route without a data folder', async () => {
    const h = await startHeadless({ port: 0, services: createNodeServices(join(root, 'home-n')) })
    const res = await fetch(new URL('/engine/handover', h.url!), { method: 'POST', body: '{}' })
    expect(res.status).toBe(404)
    await h.stop()
  })
})

describe('PIXEL_STUDIO_ENGINE_CHOICE', () => {
  it('accepts the three answers only', () => {
    expect(choiceFromEnv({ PIXEL_STUDIO_ENGINE_CHOICE: 'takeover' })).toBe('takeover')
    expect(choiceFromEnv({ PIXEL_STUDIO_ENGINE_CHOICE: ' Without-MCP ' })).toBe('without-mcp')
    expect(choiceFromEnv({ PIXEL_STUDIO_ENGINE_CHOICE: 'quit' })).toBe('quit')
    expect(choiceFromEnv({ PIXEL_STUDIO_ENGINE_CHOICE: 'x' })).toBeNull()
    expect(choiceFromEnv({})).toBeNull()
  })
})
