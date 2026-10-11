import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  test.skip(!existsSync(path.join(root, 'out/main/index.js')), 'run `yarn build` first')
  userData = await mkdtemp(path.join(os.tmpdir(), 'pixel-studio-user-'))
  app = await electron.launch({
    args: [path.join(root, 'out/main/index.js'), `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...process.env, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  if (userData) await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
})

test('the built app opens a window titled Pixel Studio with the layout shell', async () => {
  await expect(page).toHaveTitle('Pixel Studio')
  for (const id of ['toolbar', 'canvas', 'panels', 'timeline']) {
    await expect(page.getByTestId(id)).toBeVisible()
  }
  const bridge = await page.evaluate<string>('typeof window.pixelStudio?.invoke')
  expect(bridge).toBe('function')
})
