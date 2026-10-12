import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type LaunchedApp, launchApp } from './launch'

const root = path.resolve(__dirname, '../..')

let launched: LaunchedApp | undefined
let page: Page

test.beforeAll(async () => {
  test.skip(!existsSync(path.join(root, 'out/main/index.js')), 'run `yarn build` first')
  launched = await launchApp()
  page = launched.page
})

test.afterAll(async () => {
  await launched?.close()
})

test('the built app opens a window titled Pixel Studio with the layout shell', async () => {
  await expect(page).toHaveTitle('Pixel Studio')
  for (const id of ['toolbar', 'canvas', 'panels', 'timeline']) {
    await expect(page.getByTestId(id)).toBeVisible()
  }
  const bridge = await page.evaluate<string>('typeof window.pixelStudio?.invoke')
  expect(bridge).toBe('function')
})

const evalPage = <T>(expr: string): Promise<T> => page.evaluate<T>(expr)

test('draws with the pencil in one undo step, adds a frame and exports a sprite sheet', async () => {
  await expect.poll(() => evalPage<boolean>('!!window.__pixelStudio')).toBe(true)
  await expect(page.getByTestId('canvas-surface')).toBeVisible()

  // Pencil (B), draw a horizontal stroke from pixel (2,2) to (6,2).
  await page.keyboard.press('b')
  const from = await evalPage<{ x: number; y: number }>('window.__pixelStudio.pixelToPage(2, 2)')
  const to = await evalPage<{ x: number; y: number }>('window.__pixelStudio.pixelToPage(6, 2)')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, from.y)
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()

  const painted = await evalPage<number>(
    '(() => { const s = window.__pixelStudio.session; const cel = s.doc.cels.get(s.activeLayer.id + ":" + s.activeFrame.id); if (!cel) return 0; return Array.from(cel.data).filter((v) => (v >>> 24) !== 0).length })()'
  )
  expect(painted).toBe(5)
  expect(await evalPage<number>('window.__pixelStudio.session.history.undoDepth')).toBe(1)
  await expect(page.getByTestId('history-indicator')).toContainText('1 / 0')

  // Add a frame, then undo / redo it with the keyboard.
  await page.getByTestId('frame-add').click()
  await expect(page.getByTestId('frame-count')).toContainText('2 total')
  expect(await evalPage<number>('window.__pixelStudio.session.doc.frames.length')).toBe(2)
  await page.keyboard.press('Control+z')
  expect(await evalPage<number>('window.__pixelStudio.session.doc.frames.length')).toBe(1)
  await page.keyboard.press('Control+y')
  expect(await evalPage<number>('window.__pixelStudio.session.doc.frames.length')).toBe(2)

  // Export a sprite sheet (needs the main-process fs handlers).
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'pixel-studio-export-'))
  try {
    await page.getByTestId('btn-export').click()
    await expect(page.getByTestId('dialog-export')).toBeVisible()
    await page.getByTestId('export-tab-sheet').click()
    await page.getByTestId('export-name').fill('e2e-sheet')
    await page.getByPlaceholder('default: ~/PixelStudio/exports').fill(outDir)
    await page.getByTestId('export-run').click()
    await expect(page.getByTestId('export-result')).toContainText('Exported', { timeout: 10000 })

    const png = await readFile(path.join(outDir, 'e2e-sheet.png'))
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const meta = JSON.parse(await readFile(path.join(outDir, 'e2e-sheet.json'), 'utf8')) as { frames: unknown[] }
    expect(meta.frames).toHaveLength(2)
  } finally {
    await page.keyboard.press('Escape')
    await rm(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
  }
})

test('the Chat tab renders and typing in it does not trigger editor shortcuts', async () => {
  await page.getByTestId('tab-chat').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()
  await expect(page.getByTestId('chat-model')).toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeDisabled()
  const toolBefore = await evalPage<string>('window.__pixelStudio.ui.getState().tool')
  await page.getByTestId('chat-input').click()
  await page.keyboard.type('eg')
  await expect(page.getByTestId('chat-input')).toHaveValue('eg')
  expect(await evalPage<string>('window.__pixelStudio.ui.getState().tool')).toBe(toolBefore)
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await page.getByTestId('tab-edit').click()
  await expect(page.getByTestId('layers-panel')).toBeVisible()
})

test('Settings opens from the menu and with Ctrl+, and shows the Providers and MCP tabs', async () => {
  await page.getByTestId('btn-settings').click()
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await expect(page.getByTestId('settings-providers')).toBeVisible()
  await expect(page.getByTestId('provider-anthropic')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('key-input-anthropic')).toHaveAttribute('type', 'password')
  await expect(page.getByTestId('settings-data-dir')).toContainText('PixelStudio')
  await page.getByTestId('settings-tab-mcp').click()
  // Either the live state or a graceful "unavailable" message, never a crash.
  await expect(page.getByTestId('settings-mcp')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await page.keyboard.press('Control+,')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
})
