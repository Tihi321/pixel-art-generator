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

test.describe.configure({ mode: 'default' })
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
  // PAR-16: a failing test makes Playwright restart the worker, so this hook runs again on a FRESH home copied from the real config, where the
  // acp models are not ticked: the next test then saw no acp options in the chat list (it looked like the app dropped them). Tick the two
  // models the chat runs use here, so every test starts from the same state, whatever ran before.
  await page.evaluate(`window.pixelStudio.invoke('llm:showModels', ${JSON.stringify(CHAT_MODELS)}, true)`)
})

test.afterAll(async () => {
  await launched?.close()
})

const CHAT_MODELS = ['acp/codex/gpt-5.6-luna', 'acp/antigravity/gemini-3.8-flash']

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
  await closeSettings()
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

// Reliability: ACP_REPEAT=N runs each model N times (default 1), each in a new chat. Failures are collected with their cause and reported;
// the test fails when any run failed, and the log says how many passed.
const REPEAT = Number(process.env.ACP_REPEAT ?? 1)

async function drawHeartOnce(ref: string, n: number): Promise<string | null> {
  await page.getByTestId('chat-new').click()
  await modelSelect().focus() // the list refreshes when the select gets focus
  try {
    await expect(modelSelect().locator(`option[value="${ref}"]`)).toHaveCount(1, { timeout: 15000 })
  } catch (e) {
    const opts = await modelSelect().locator('option').evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value))
    console.log(`[acp-live] model option ${ref} missing; acp options: ${JSON.stringify(opts.filter((o) => o.startsWith('acp')))}; total ${opts.length}`)
    throw e
  }
  await modelSelect().selectOption(ref)
  await page.getByTestId('chat-input').fill('Make a new 16x16 document and draw a 16x16 red heart sprite on it. Use your tools, then tell me when it is finished.')
  const t0 = Date.now()
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 7 * 60_000 }) // Stop turns back into Send
  const secs = Math.round((Date.now() - t0) / 1000)
  await page.screenshot({ path: path.join(shots, `c-${ref.replace(/[^a-z0-9.]+/gi, '_')}-${n}.png`) })
  const errors = await page.getByTestId('chat-error').allTextContents()
  const cards = await page.getByTestId('tool-card').count()
  const cardStates = await page.getByTestId('tool-card').evaluateAll((els) => els.map((e) => e.classList.contains('error')))
  const failedCards = cardStates.filter(Boolean).length // failed calls the agent then corrected are fine; the LAST call must have worked
  const lastFailed = cardStates.length > 0 && cardStates[cardStates.length - 1] === true
  const answer = (await page.getByTestId('chat-assistant').allTextContents()).join(' | ')
  const pixels = await filledPixels()
  console.log(`[acp-live] ${ref} #${n}: ${secs}s, ${cards} tool cards (${failedCards} failed), ${pixels} pixels, answer: ${answer.slice(0, 200)}`)
  if (errors.length) return `chat error: ${errors.join(' / ')}`
  if (cards === 0) return `no tool call, answer: ${answer.slice(0, 200)}`
  if (lastFailed) return `the last tool call failed (${failedCards} failed in all)`
  if (pixels === 0) return 'canvas still empty'
  if ((await page.evaluate<number>('window.__pixelStudio.session.history.undoDepth')) === 0) return 'no undo step recorded'
  return null
}

for (const ref of CHAT_MODELS) {
  test(`c) the agent chat draws a heart with ${ref}`, async () => {
    test.setTimeout(Math.max(1, REPEAT) * 8 * 60_000)
    const failures: string[] = []
    for (let n = 1; n <= REPEAT; n++) {
      const why = await drawHeartOnce(ref, n)
      if (why) failures.push(`#${n}: ${why}`)
    }
    console.log(`[acp-live] ${ref}: ${REPEAT - failures.length}/${REPEAT} passed${failures.length ? `; ${failures.join('; ')}` : ''}`)
    expect(failures, `${ref}: ${REPEAT - failures.length}/${REPEAT} passed`).toEqual([])
  })
}
