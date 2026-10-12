// End-to-end proof of the real main <-> renderer tool bridge: an MCP client talks to the MCP server inside the
// running app, and the renderer's LIVE session reflects what it did (and one undo reverts one tool call).
// Also covers the asset library through MCP, the filesystem and the Assets panel.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { type LaunchedApp, launchApp, projectRoot } from './launch'

let launched: LaunchedApp
let page: Page
let client: Client

test.beforeAll(async () => {
  test.skip(!existsSync(path.join(projectRoot, 'out/main/index.js')), 'run `yarn build` first')
  launched = await launchApp()
  page = launched.page
  await expect.poll(() => page.evaluate<boolean>('!!window.__pixelStudio'), { timeout: 20000 }).toBe(true)

  // The MCP server starts a moment after launch: retry until it accepts the connection.
  const deadline = Date.now() + 20000
  for (;;) {
    const c = new Client({ name: 'e2e', version: '1.0.0' })
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(launched.mcpUrl)))
      client = c
      break
    } catch (e) {
      await c.close().catch(() => undefined)
      if (Date.now() > deadline) throw e
      await new Promise((r) => setTimeout(r, 300))
    }
  }
})

test.afterAll(async () => {
  await client?.close().catch(() => undefined)
  await launched?.close()
})

const evalPage = <T>(expr: string): Promise<T> => page.evaluate<T>(expr)
const text = (r: unknown): string =>
  ((r as { content: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')

/** Packed RGBA of a pixel of the active layer's cel in the active frame (0 when empty). */
const pixelExpr = (x: number, y: number): string =>
  `(() => { const s = window.__pixelStudio.session; const cel = s.doc.cels.get(s.activeLayer.id + ":" + s.activeFrame.id); if (!cel) return 0; const lx = ${x} - cel.x, ly = ${y} - cel.y; if (lx < 0 || ly < 0 || lx >= cel.w || ly >= cel.h) return 0; return cel.data[ly * cel.w + lx] })()`

test('MCP tool calls change the live renderer session, and one undo reverts one call', async () => {
  const tools = (await client.listTools()).tools
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['new_document', 'draw_grid', 'save_as_asset', 'place_asset', 'get_style_context']))

  const nd = await client.callTool({ name: 'new_document', arguments: { width: 16, height: 16, name: 'e2e-mcp' } })
  expect(nd.isError, text(nd)).toBeFalsy()
  expect(await evalPage<string>('window.__pixelStudio.session.doc.name')).toBe('e2e-mcp')
  expect(await evalPage<number>('window.__pixelStudio.session.doc.width')).toBe(16)

  const depthBefore = await evalPage<number>('window.__pixelStudio.session.history.undoDepth')
  expect(await evalPage<number>(pixelExpr(3, 4))).toBe(0)
  const dg = await client.callTool({ name: 'draw_grid', arguments: { rows: ['rr', 'rr'], legend: { r: '#ff0000' }, x: 3, y: 4 } })
  expect(dg.isError, text(dg)).toBeFalsy()

  // 0xAABBGGRR for #ff0000 (opaque red)
  const red = 0xff0000ff
  expect(await evalPage<number>(pixelExpr(3, 4))).toBe(red)
  expect(await evalPage<number>(pixelExpr(4, 5))).toBe(red)
  expect(await evalPage<number>('window.__pixelStudio.session.history.undoDepth')).toBe(depthBefore + 1)
  // the editor (not just the model) shows it: the status/history indicator follows the session
  await expect(page.getByTestId('history-indicator')).toContainText(`${depthBefore + 1} /`)

  // one undo in the renderer reverts exactly the draw_grid
  expect(await evalPage<boolean>('window.__pixelStudio.session.undo()')).toBe(true)
  expect(await evalPage<number>(pixelExpr(3, 4))).toBe(0)
  expect(await evalPage<number>(pixelExpr(4, 5))).toBe(0)
  expect(await evalPage<number>('window.__pixelStudio.session.history.undoDepth')).toBe(depthBefore)
  expect(await evalPage<string>('window.__pixelStudio.session.doc.name')).toBe('e2e-mcp')

  // and redo brings it back; the MCP side sees the same document
  expect(await evalPage<boolean>('window.__pixelStudio.session.redo()')).toBe(true)
  expect(await evalPage<number>(pixelExpr(3, 4))).toBe(red)
  const grid = await client.callTool({ name: 'read_grid', arguments: { x: 3, y: 4, w: 2, h: 2 } })
  expect(text(grid)).toContain('"rows"')
})

test('assets: saved through MCP, stored under PIXEL_STUDIO_HOME, listed live in the Assets panel, placed and deleted from the UI', async () => {
  // keep this test independent of the previous one
  await client.callTool({ name: 'new_document', arguments: { width: 16, height: 16, name: 'e2e-assets' } })
  await client.callTool({ name: 'draw_grid', arguments: { rows: ['rr', 'rr'], legend: { r: '#ff0000' }, x: 3, y: 4 } })

  await page.getByTestId('tab-assets').click()
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('asset-empty')).toBeVisible()

  const saved = await client.callTool({
    name: 'save_as_asset',
    arguments: { name: 'Red Block', kind: 'prop', tags: ['e2e'], notes: 'flat red block', source: 'region', region: { x: 3, y: 4, w: 2, h: 2 } }
  })
  expect(saved.isError, text(saved)).toBeFalsy()

  // the folder layout on disk
  const dir = path.join(launched.home, 'assets', 'red-block')
  expect((await readdir(dir)).sort()).toEqual(['asset.pxs', 'meta.md', 'thumb.png'])
  const meta = await readFile(path.join(dir, 'meta.md'), 'utf8')
  expect(meta).toMatch(/^---\n/)
  expect(meta).toContain('kind: prop')
  expect(meta).toContain('flat red block')
  expect([...(await readFile(path.join(dir, 'thumb.png'))).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  // live refresh: the card appears without reloading (assets:changed)
  await expect(page.getByTestId('asset-card')).toHaveCount(1, { timeout: 10000 })
  await expect(page.getByTestId('asset-card')).toContainText('Red Block')
  await expect(page.getByTestId('asset-card').locator('img')).toBeVisible()

  // the MCP resource lists it too
  const res = await client.readResource({ uri: 'pixel-studio://assets' })
  expect(String((res.contents[0] as { text?: string }).text)).toContain('red-block')

  // kind filter and search
  await page.getByTestId('asset-kind').selectOption('character')
  await expect(page.getByTestId('asset-card')).toHaveCount(0)
  await page.getByTestId('asset-kind').selectOption('')
  await page.getByTestId('asset-search').fill('zzz')
  await expect(page.getByTestId('asset-card')).toHaveCount(0)
  await page.getByTestId('asset-search').fill('e2e')
  await expect(page.getByTestId('asset-card')).toHaveCount(1)

  // Place at 0,0 from the panel (new layer): one undo step
  const depth = await evalPage<number>('window.__pixelStudio.session.history.undoDepth')
  await page.getByTestId('asset-place').click()
  await expect.poll(() => evalPage<number>('window.__pixelStudio.session.history.undoDepth')).toBe(depth + 1)
  expect(await evalPage<string>('window.__pixelStudio.session.activeLayer.name')).toBe('Red Block')
  expect(await evalPage<number>(pixelExpr(0, 0))).toBe(0xff0000ff)
  expect(await evalPage<number>(pixelExpr(1, 1))).toBe(0xff0000ff)
  await evalPage('window.__pixelStudio.session.undo()')
  expect(await evalPage<number>('window.__pixelStudio.session.doc.layers.length')).toBe(1)

  // Drag the thumbnail onto the canvas: it lands on the pixel under the drop point
  const target = await evalPage<{ x: number; y: number }>('window.__pixelStudio.pixelToPage(9, 8)')
  await page.getByTestId('asset-card').locator('.asset-thumb').dragTo(page.getByTestId('canvas-surface'), {
    targetPosition: await page.getByTestId('canvas-surface').evaluate((el, t) => {
      const r = el.getBoundingClientRect()
      return { x: t.x - r.left, y: t.y - r.top }
    }, target)
  })
  await expect.poll(() => evalPage<number>('window.__pixelStudio.session.doc.layers.length')).toBe(2)
  expect(await evalPage<number>(pixelExpr(9, 8))).toBe(0xff0000ff)
  expect(await evalPage<number>(pixelExpr(10, 9))).toBe(0xff0000ff)
  expect(await evalPage<number>(pixelExpr(8, 8))).toBe(0)

  // style reference toggle reflects doc.references
  await page.getByTestId('asset-ref').check()
  await expect.poll(() => evalPage<string>('JSON.stringify(window.__pixelStudio.session.doc.references.map((r) => r.assetId))')).toBe('["red-block"]')
  const ctx = await client.callTool({ name: 'get_style_context', arguments: {} })
  expect(text(ctx)).toContain('red-block')
  await page.getByTestId('asset-ref').uncheck()
  await expect.poll(() => evalPage<number>('window.__pixelStudio.session.doc.references.length')).toBe(0)

  // Save as asset dialog (selection source is disabled without a selection)
  await page.getByTestId('asset-save-open').click()
  await expect(page.getByTestId('dialog-save-asset')).toBeVisible()
  await page.getByTestId('asset-name').fill('From dialog')
  await page.getByTestId('asset-kind-select').selectOption('tile')
  await page.getByTestId('asset-tags').fill('ui, e2e')
  await page.getByTestId('asset-save-confirm').click()
  await expect(page.getByTestId('dialog-save-asset')).toHaveCount(0)
  await expect(page.getByTestId('asset-card')).toHaveCount(2, { timeout: 10000 })
  expect(existsSync(path.join(launched.home, 'assets', 'from-dialog', 'asset.pxs'))).toBe(true)

  // delete with an inline confirmation (no window.confirm)
  const card = page.locator('[data-asset-id="from-dialog"]')
  await card.getByTestId('asset-delete').click()
  await expect(card.getByTestId('asset-delete-yes')).toBeVisible()
  await card.getByTestId('asset-delete-no').click()
  await expect(page.getByTestId('asset-card')).toHaveCount(2)
  await card.getByTestId('asset-delete').click()
  await card.getByTestId('asset-delete-yes').click()
  await expect(page.getByTestId('asset-card')).toHaveCount(1, { timeout: 10000 })
  expect(existsSync(path.join(launched.home, 'assets', 'from-dialog'))).toBe(false)
})
