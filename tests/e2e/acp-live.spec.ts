// Live check of the real app against the ACP proxy (http://127.0.0.1:7461). Skipped unless ACP_LIVE=1.
// The app runs on an isolated home seeded with a COPY of ~/PixelStudio/config, so the real folder is never written.
// Spends model quota: two agent runs.
import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type LaunchedApp, launchApp, projectRoot } from './launch'

const live = process.env.ACP_LIVE === '1'
const shots = path.join(projectRoot, '.claude/temp/par15-shots')
const PROXY = 'http://127.0.0.1:7461/v1'

let launched: LaunchedApp
let page: Page

test.describe.configure({ mode: 'serial' })
test.skip(!live, 'set ACP_LIVE=1 (needs the ACP proxy on 127.0.0.1:7461)')

test.beforeAll(async () => {
  test.skip(!existsSync(path.join(projectRoot, 'out/main/index.js')), 'run `yarn build` first')
  await mkdir(shots, { recursive: true })
  const real = process.env.ACP_CONFIG_FROM ?? path.join(os.homedir(), 'PixelStudio', 'config')
  launched = await launchApp({ seedConfigFrom: real })
  page = launched.page
  await page.setViewportSize({ width: 1500, height: 950 }).catch(() => undefined)
  await page.getByTestId('tab-chat').click()
  await expect.poll(() => page.evaluate<boolean>('!!window.__pixelStudio'), { timeout: 30000 }).toBe(true)
})

test.afterAll(async () => {
  await launched?.close()
})

const modelSelect = () => page.getByTestId('chat-model')

async function openModelsTab(): Promise<void> {
  if (!(await page.getByTestId('settings-dialog').isVisible().catch(() => false))) await page.getByTestId('chat-models-settings').click()
  await page.getByTestId('settings-tab-models').click()
  await expect(page.getByTestId('settings-models')).toBeVisible()
}

async function closeSettings(): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toBeHidden()
}

test('a) Settings > Models lists the acp provider and its prefixed models, no unprefixed duplicates', async () => {
  await openModelsTab()
  const acp = page.getByTestId('models-provider-acp')
  await expect(acp).toBeVisible()
  await acp.click()
  await page.getByTestId('models-detect').click().catch(() => undefined)
  const ids = ['codex/gpt-5.6-luna', 'antigravity/gemini-3.8-flash']
  for (const id of ids) await expect(page.getByTestId(`models-row-acp/${id}`)).toBeVisible({ timeout: 30000 })
  const rows = await page.locator('[data-testid^="models-row-acp/"] .model-id').allTextContents()
  expect(rows.length).toBeGreaterThan(0)
  for (const r of rows) expect(r, `unprefixed model id ${r}`).toMatch(/^(codex|antigravity)\//)
  expect(new Set(rows).size).toBe(rows.length)
  // Tick the two models the chat runs use.
  for (const id of ids) {
    const row = page.getByTestId(`models-row-acp/${id}`)
    if (!(await row.locator('input').isChecked())) await row.locator('input').click()
    await expect(row.locator('input')).toBeChecked() // saved through IPC: the box follows
  }
  await page.screenshot({ path: path.join(shots, 'a-models.png') })
})

test('b) add a custom provider through the form, Test, detect models, remove it', async () => {
  await openModelsTab()
  await page.getByTestId('models-add-provider').click()
  await page.getByTestId('provider-form-name').fill('acp-e2e')
  await page.getByTestId('provider-form-url').fill(PROXY)
  await page.getByTestId('provider-form-schema').uncheck()
  await page.getByTestId('provider-form-test').click()
  await expect(page.getByTestId('provider-form-test-result')).toContainText('reachable,', { timeout: 30000 })
  await expect(page.getByTestId('provider-form-test-result')).not.toContainText('not reachable')
  await page.screenshot({ path: path.join(shots, 'b-form.png') })
  await page.getByTestId('provider-form-save').click()
  await expect(page.getByTestId('provider-form')).toBeHidden({ timeout: 15000 })
  await expect(page.getByTestId('models-provider-acp-e2e')).toBeVisible()
  await page.getByTestId('models-detect').click().catch(() => undefined)
  await expect(page.locator('[data-testid^="models-row-acp-e2e/"]').first()).toBeVisible({ timeout: 30000 })
  await page.screenshot({ path: path.join(shots, 'b-detected.png') })
  page.once('dialog', (d) => void d.accept())
  await page.getByTestId('models-remove-provider').click()
  await expect(page.getByTestId('models-provider-acp-e2e')).toBeHidden({ timeout: 15000 })
  await closeSettings()
})

const filledPixels = (): Promise<number> =>
  page.evaluate<number>(
    '(() => { const s = window.__pixelStudio.session; let n = 0; for (const c of s.doc.cels.values()) for (const v of c.data) if ((v >>> 24) !== 0) n++; return n })()'
  )

for (const ref of ['acp/codex/gpt-5.6-luna', 'acp/antigravity/gemini-3.8-flash']) {
  test(`c) the agent chat draws a heart with ${ref}`, async () => {
    test.setTimeout(8 * 60_000)
    await page.getByTestId('chat-new').click()
    await expect(modelSelect().locator(`option[value="${ref}"]`)).toHaveCount(1)
    await modelSelect().selectOption(ref)
    const before = await filledPixels()
    await page.getByTestId('chat-input').fill('Make a new 16x16 document and draw a 16x16 red heart sprite on it. Use your tools, then say done.')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 7 * 60_000 }) // Stop turns back into Send
    const tag = ref.replace(/[^a-z0-9.]+/gi, '_')
    await page.screenshot({ path: path.join(shots, `c-${tag}.png`) })
    const errors = await page.getByTestId('chat-error').allTextContents()
    const cards = await page.getByTestId('tool-card').count()
    const answer = (await page.getByTestId('chat-assistant').allTextContents()).join(' | ')
    console.log(`[acp-live] ${ref}: ${cards} tool cards, answer: ${answer.slice(0, 300)}`)
    const dump = await page.getByTestId('tool-card').evaluateAll((els) => els.map((e) => `${e.className}: ${(e.textContent ?? '').slice(0, 400)}`))
    console.log(`[acp-live] cards: ${JSON.stringify(dump)}`)
    expect(errors, `chat errors: ${errors.join(' / ')}`).toEqual([])
    expect(cards).toBeGreaterThan(0)
    expect(await page.getByTestId('tool-card').evaluateAll((els) => els.filter((e) => e.classList.contains('error')).length)).toBe(0)
    const after = await filledPixels()
    expect(after, `pixels before ${before}, after ${after}`).toBeGreaterThan(0)
    expect(await page.evaluate<number>('window.__pixelStudio.session.history.undoDepth')).toBeGreaterThan(0)
  })
}
