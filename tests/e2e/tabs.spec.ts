import { expect, test, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
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

const evalPage = <T>(expr: string): Promise<T> => page.evaluate<T>(expr)
const docName = () => evalPage<string>('window.__pixelStudio.session.doc.name')
const undoDepth = () => evalPage<number>('window.__pixelStudio.session.history.undoDepth')

async function newDoc(name: string, w: number, h: number): Promise<void> {
  await page.getByTestId('doc-tab-new').click()
  await page.getByTestId('new-name').fill(name)
  await page.getByTestId('new-width').fill(String(w))
  await page.getByTestId('new-height').fill(String(h))
  await page.getByTestId('new-create').click()
}

test('documents open in tabs, each with its own undo history, path and unsaved marker', async () => {
  await expect.poll(() => evalPage<boolean>('!!window.__pixelStudio')).toBe(true)
  const tabs = page.getByTestId('doc-tab')
  await expect(tabs).toHaveCount(1)

  // the untouched first tab is reused, the next document gets its own tab
  await newDoc('Alpha', 16, 16)
  await expect(tabs).toHaveCount(1)
  await newDoc('Beta', 8, 8)
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  expect(await docName()).toBe('Beta')

  // an edit in Beta marks it unsaved and stays in Beta's history
  await page.getByTestId('frame-add').click()
  expect(await undoDepth()).toBe(1)
  await expect(tabs.nth(1).locator('.doc-tab-dirty')).toBeVisible()

  await tabs.nth(0).click()
  expect(await docName()).toBe('Alpha')
  expect(await undoDepth()).toBe(0)
  await expect(page.getByTestId('doc-info')).toContainText('Alpha 16x16')
  await page.keyboard.press('Control+Tab')
  expect(await docName()).toBe('Beta')
  expect(await evalPage<number>('window.__pixelStudio.session.doc.frames.length')).toBe(2)

  // saving clears the marker; opening the saved file again shows its tab instead of a second copy
  await page.getByTestId('btn-save').click()
  await page.getByTestId('save-name').fill('beta-e2e')
  await page.getByTestId('save-confirm').click()
  await expect(tabs.nth(1).locator('.doc-tab-dirty')).toHaveCount(0)
  await tabs.nth(0).click()
  await page.getByTestId('btn-open').click()
  await page.getByTestId('open-name').fill('beta-e2e')
  await page.getByTestId('open-confirm').click()
  await expect(tabs).toHaveCount(2)
  expect(await docName()).toBe('Beta')

  // closing a saved tab needs no confirmation and shows the neighbour
  await tabs.nth(1).getByTestId('doc-tab-close').click()
  await expect(tabs).toHaveCount(1)
  expect(await docName()).toBe('Alpha')
})
