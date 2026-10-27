import { isMap, isSeq, parseDocument } from 'yaml'
import type { Document, YAMLMap, YAMLSeq } from 'yaml'
import { providersSchema } from './config'
import { splitFrontmatter } from './md'

/**
 * Providers added in Settings > Models > Add provider: entries of config/providers.md with `custom: true`. Only those are ever added,
 * changed or removed here; the rest of the file (seed providers, comments, the text below) stays as it is. No Electron.
 */

/** Ids the form never hands out: every provider of the seed and the test provider. */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set(['lmstudio', 'strata', 'deepseek', 'openrouter', 'ollama', 'acp', 'openai', 'anthropic', 'gemini', 'mock'])

export interface CustomProviderInput {
  /** Set when editing: the id of the custom provider to change. */
  id?: string
  name: string
  baseUrl: string
  /** A key is stored for the provider (so `api_key_env` is written). */
  hasKey: boolean
  /** Local / free: no key needed, no prices. */
  free: boolean
  jsonSchema: boolean
  concurrency: number | 'auto'
  enabled: boolean
  /** Ask the server for its models (default true). */
  discover?: boolean
}

/** `ACP proxy (home)` -> `acp-proxy-home`. Empty when the name has no letter or digit. */
export function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The credential-store name of a custom provider's key: `acp-home` -> `CUSTOM_ACP_HOME_API_KEY`. */
export function keyNameOf(id: string): string {
  return `CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** The URL as stored (no trailing slash), or an error text when it is not an http(s) address. */
export function checkBaseUrl(raw: string): { url: string } | { error: string } {
  const text = raw.trim()
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return { error: 'the base URL is not a valid address (for example http://127.0.0.1:7461/v1)' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'the base URL must start with http:// or https://' }
  return { url: text.replace(/\/+$/, '') }
}

interface Parsed {
  doc: Document
  providers: YAMLSeq
  eol: string
  body: string
}

function parseProviders(text: string): Parsed {
  const { frontmatter, body } = splitFrontmatter(text)
  if (frontmatter === null) throw new Error('config/providers.md has no frontmatter')
  const doc = parseDocument(frontmatter)
  if (doc.errors.length > 0) throw new Error(`config/providers.md: ${doc.errors[0]!.message}`)
  let providers = doc.get('providers', true)
  if (!isSeq(providers)) {
    doc.set('providers', doc.createNode([]))
    providers = doc.get('providers', true)
  }
  return { doc, providers: providers as YAMLSeq, eol: text.includes('\r\n') ? '\r\n' : '\n', body }
}

function render(p: Parsed): string {
  const fm = p.doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, p.eol)
  const check = providersSchema.safeParse(p.doc.toJS())
  if (!check.success) throw new Error(`providers.md would be invalid: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return `---${p.eol}${fm}---${p.eol}${p.body}`
}

const idOf = (m: YAMLMap): string => String(m.get('id') ?? '')

/** The ids of every provider in a providers.md text, and which of them are custom. */
export function providerIdsOf(text: string): { all: string[]; custom: string[] } {
  const maps = parseProviders(text).providers.items.filter(isMap)
  return { all: maps.map(idOf), custom: maps.filter((m) => m.get('custom') === true).map(idOf) }
}

/**
 * Adds a custom provider to the providers.md text (before `mock`), or changes the custom provider `input.id`. Returns the new text and the id.
 * Throws a short message when the name gives no id, the id is taken (or a built-in id), or the id is not a custom provider.
 */
export function upsertCustomProvider(text: string, input: CustomProviderInput): { text: string; id: string } {
  const p = parseProviders(text)
  const url = checkBaseUrl(input.baseUrl)
  if ('error' in url) throw new Error(url.error)
  const name = input.name.trim()
  if (!name) throw new Error('give the provider a name')
  const c = input.concurrency
  if (c !== 'auto' && !(Number.isInteger(c) && c >= 1)) throw new Error('parallel must be a whole number of at least 1, or auto')
  const maps = p.providers.items.filter(isMap)
  if (input.id) {
    const entry = maps.find((m) => idOf(m) === input.id)
    if (!entry || entry.get('custom') !== true) throw new Error(`"${input.id}" is not a custom provider: edit config/providers.md for it`)
    entry.set('name', name)
    entry.set('enabled', input.enabled)
    entry.set('local', input.free)
    entry.set('base_url', url.url)
    entry.set('json_schema', input.jsonSchema)
    entry.set('concurrency', c)
    if (input.discover !== undefined) entry.set('discover', input.discover)
    if ((input.hasKey || !input.free) && !entry.has('api_key_env')) entry.set('api_key_env', keyNameOf(input.id))
    return { text: render(p), id: input.id }
  }
  const id = slugOf(name)
  if (!id) throw new Error('the name needs at least one letter or digit')
  if (RESERVED_PROVIDER_IDS.has(id)) throw new Error(`"${id}" is the name of a built-in provider: pick another name`)
  if (maps.some((m) => idOf(m) === id)) throw new Error(`a provider "${id}" exists already: pick another name`)
  const entry: Record<string, unknown> = { id, name, custom: true, kind: 'openai-compat', enabled: input.enabled, base_url: url.url }
  if (input.hasKey || !input.free) entry.api_key_env = keyNameOf(id)
  Object.assign(entry, { local: input.free, json_schema: input.jsonSchema, concurrency: c, discover: input.discover ?? true, models: [] })
  const node = p.doc.createNode(entry)
  const mock = p.providers.items.findIndex((m) => isMap(m) && idOf(m) === 'mock')
  if (mock === -1) p.providers.add(node)
  else p.providers.items.splice(mock, 0, node)
  return { text: render(p), id }
}

/** Removes the custom provider `id` from the providers.md text. Throws when there is no such custom provider. */
export function removeCustomProviderEntry(text: string, id: string): { text: string; keyEnv?: string } {
  const p = parseProviders(text)
  const i = p.providers.items.findIndex((m) => isMap(m) && idOf(m) === id)
  const entry = i >= 0 ? (p.providers.items[i] as YAMLMap) : undefined
  if (!entry || entry.get('custom') !== true) throw new Error(`"${id}" is not a custom provider`)
  const keyEnv = entry.get('api_key_env')
  p.providers.items.splice(i, 1)
  return { text: render(p), keyEnv: typeof keyEnv === 'string' ? keyEnv : undefined }
}
