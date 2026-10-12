// App-level settings that are not provider config: `~/PixelStudio/config/app.json`.
// Today: the model chosen for the chat. Unknown keys are kept, a broken file reads as defaults.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AppSettings {
  /** `provider/model` the chat uses; null for the role's first available model. */
  selectedModel: string | null
}

export const APP_SETTINGS_FILE = 'app.json'

const DEFAULTS: AppSettings = { selectedModel: null }

export async function readAppSettings(configDir: string): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(join(configDir, APP_SETTINGS_FILE), 'utf8')) as Record<string, unknown>
    return { ...DEFAULTS, selectedModel: typeof raw.selectedModel === 'string' && raw.selectedModel ? raw.selectedModel : null }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeAppSettings(configDir: string, patch: Partial<AppSettings>): Promise<AppSettings> {
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await readFile(join(configDir, APP_SETTINGS_FILE), 'utf8')) as Record<string, unknown>
  } catch {
    /* new or unreadable file */
  }
  const next = { ...existing, ...patch }
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, APP_SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return readAppSettings(configDir)
}
