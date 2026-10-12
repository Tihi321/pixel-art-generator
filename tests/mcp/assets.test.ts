import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer } from './helpers'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

const text = (c: unknown): string => String((c as { text?: string }).text)

describe('MCP asset library', () => {
  it('lists saved assets as a resource and serves the style tools', async () => {
    const s = await startServer()
    cleanup.push(() => s.server.stop())
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(s.url))
    cleanup.push(() => client.close().catch(() => undefined))

    // empty library
    const empty = await client.readResource({ uri: 'pixel-studio://assets' })
    expect(JSON.parse(text(empty.contents[0]).split('\n').pop()!)).toEqual([])

    await client.callTool({ name: 'draw_grid', arguments: { rows: ['rr', 'rr'], legend: { r: '#ff0000' }, x: 2, y: 2 } })
    const saved = await client.callTool({ name: 'save_as_asset', arguments: { name: 'Red Block', kind: 'prop', tags: ['test'], notes: 'flat red' } })
    expect(saved.isError).toBeFalsy()
    expect(s.services.assetStore.has('red-block')).toBe(true)

    const res = await client.readResource({ uri: 'pixel-studio://assets' })
    const list = JSON.parse(text(res.contents[0]).split('\n').pop()!) as Array<{ id: string; name: string; kind: string; tags: string[] }>
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'red-block', name: 'Red Block', kind: 'prop', tags: ['test'] })

    // reference it and read the style context over MCP (text + preview image)
    const ref = await client.callTool({ name: 'set_style_reference', arguments: { ids: ['red-block'] } })
    expect(ref.isError).toBeFalsy()
    const ctx = (await client.callTool({ name: 'get_style_context', arguments: {} })) as { content: Array<{ type: string; text?: string; mimeType?: string }> }
    expect(ctx.content.find((c) => c.type === 'text')!.text).toContain('red-block')
    expect(ctx.content.some((c) => c.type === 'image' && c.mimeType === 'image/png')).toBe(true)

    const prompt = await client.getPrompt({ name: 'match_style', arguments: { asset: 'red-block', subject: 'a tree' } })
    expect(JSON.stringify(prompt.messages[0]!.content)).toContain('get_style_context')
  })
})
