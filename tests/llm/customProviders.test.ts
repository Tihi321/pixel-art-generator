import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseMdWith } from '../../src/llm/md'
import { providersSchema } from '../../src/llm/config'
import { checkBaseUrl, keyNameOf, providerIdsOf, removeCustomProviderEntry, slugOf, upsertCustomProvider, type CustomProviderInput } from '../../src/llm/customProviders'
import { ModelRegistry } from '../../src/llm/registry'
import { migrateProviders, SEED_STATE_FILE } from '../../src/llm/seedMigration'
import { createLlm } from '../../src/llm/setup'

const seedDir = fileURLToPath(new URL('../../seed/config', import.meta.url))

const FILE =
  '---\nkind: providers\nproviders:\n  # my own note\n  - id: lmstudio\n    kind: openai-compat\n    local: true\n    base_url: http://localhost:1234/v1\n    models: []\n  - id: mock\n    kind: mock\n    enabled: false\n---\n# Body\n\nKept text.\n'

const input = (over: Partial<CustomProviderInput> = {}): CustomProviderInput => ({
  name: 'Home Proxy',
  baseUrl: 'http://127.0.0.1:9000/v1/',
  hasKey: false,
  free: true,
  jsonSchema: false,
  concurrency: 2,
  enabled: true,
  ...over
})

describe('custom provider entries', () => {
  it('slugs and key names', () => {
    expect(slugOf('ACP proxy (home)')).toBe('acp-proxy-home')
    expect(slugOf('  Čaj!  ')).toBe('caj')
    expect(slugOf('!!!')).toBe('')
    expect(keyNameOf('acp-home')).toBe('CUSTOM_ACP_HOME_API_KEY')
  })

  it('checks the base URL', () => {
    expect(checkBaseUrl(' http://127.0.0.1:7461/v1/ ')).toEqual({ url: 'http://127.0.0.1:7461/v1' })
    expect(checkBaseUrl('ftp://x')).toHaveProperty('error')
    expect(checkBaseUrl('nope')).toHaveProperty('error')
  })

  it('adds an entry before mock, keeps comments and the body, and the result is a valid providers file', () => {
    const { text, id } = upsertCustomProvider(FILE, input({ hasKey: true }))
    expect(id).toBe('home-proxy')
    expect(text).toContain('# my own note')
    expect(text.endsWith('---\n# Body\n\nKept text.\n')).toBe(true)
    const data = parseMdWith(text, providersSchema).data
    expect(data.providers.map((p) => p.id)).toEqual(['lmstudio', 'home-proxy', 'mock'])
    expect(data.providers[1]).toMatchObject({
      name: 'Home Proxy',
      custom: true,
      kind: 'openai-compat',
      local: true,
      base_url: 'http://127.0.0.1:9000/v1',
      api_key_env: 'CUSTOM_HOME_PROXY_API_KEY',
      json_schema: false,
      concurrency: 2,
      discover: true,
      enabled: true
    })
    expect(providerIdsOf(text)).toEqual({ all: ['lmstudio', 'home-proxy', 'mock'], custom: ['home-proxy'] })
  })

  it('a paid provider gets a key name even without a key yet; a free one without a key has none', () => {
    const paid = parseMdWith(upsertCustomProvider(FILE, input({ free: false })).text, providersSchema).data.providers.find((p) => p.id === 'home-proxy')
    expect(paid).toMatchObject({ local: false, api_key_env: 'CUSTOM_HOME_PROXY_API_KEY' })
    const free = parseMdWith(upsertCustomProvider(FILE, input()).text, providersSchema).data.providers.find((p) => p.id === 'home-proxy')
    expect(free?.api_key_env).toBeUndefined()
  })

  it('refuses reserved ids, duplicates, bad names and bad values', () => {
    expect(() => upsertCustomProvider(FILE, input({ name: 'ACP' }))).toThrow(/built-in/)
    expect(() => upsertCustomProvider(FILE, input({ name: 'DeepSeek' }))).toThrow(/built-in/)
    expect(() => upsertCustomProvider(FILE, input({ name: 'Mock' }))).toThrow(/built-in/)
    expect(() => upsertCustomProvider(FILE, input({ name: '???' }))).toThrow(/letter or digit/)
    expect(() => upsertCustomProvider(FILE, input({ name: ' ' }))).toThrow(/name/)
    expect(() => upsertCustomProvider(FILE, input({ baseUrl: 'ws://x' }))).toThrow(/http/)
    expect(() => upsertCustomProvider(FILE, input({ concurrency: 0 }))).toThrow(/parallel/)
    const once = upsertCustomProvider(FILE, input()).text
    expect(() => upsertCustomProvider(once, input())).toThrow(/exists already/)
  })

  it('edits only custom entries', () => {
    const once = upsertCustomProvider(FILE, input()).text
    const edited = upsertCustomProvider(once, input({ id: 'home-proxy', name: 'Home Proxy 2', baseUrl: 'http://127.0.0.1:9100/v1', free: false, concurrency: 'auto', jsonSchema: true, hasKey: true, enabled: false })).text
    const p = parseMdWith(edited, providersSchema).data.providers.find((x) => x.id === 'home-proxy')
    expect(p).toMatchObject({ name: 'Home Proxy 2', base_url: 'http://127.0.0.1:9100/v1', local: false, concurrency: 'auto', json_schema: true, enabled: false, api_key_env: 'CUSTOM_HOME_PROXY_API_KEY' })
    expect(() => upsertCustomProvider(once, input({ id: 'lmstudio' }))).toThrow(/not a custom provider/)
    expect(() => upsertCustomProvider(once, input({ id: 'ghost' }))).toThrow(/not a custom provider/)
  })

  it('removes a custom entry and reports its key name; seed entries cannot be removed', () => {
    const once = upsertCustomProvider(FILE, input({ hasKey: true })).text
    const { text, keyEnv } = removeCustomProviderEntry(once, 'home-proxy')
    expect(keyEnv).toBe('CUSTOM_HOME_PROXY_API_KEY')
    expect(providerIdsOf(text).all).toEqual(['lmstudio', 'mock'])
    expect(() => removeCustomProviderEntry(once, 'lmstudio')).toThrow(/not a custom provider/)
  })

  it('keeps CRLF line endings', () => {
    const crlf = FILE.replace(/\n/g, '\r\n')
    const { text } = upsertCustomProvider(crlf, input())
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('the seed acp provider', () => {
  it('is off, local, on the proxy port, without JSON schema, and discovers its models', async () => {
    const data = parseMdWith(await readFile(path.join(seedDir, 'providers.md'), 'utf8'), providersSchema).data
    expect(data.providers.find((p) => p.id === 'acp')).toMatchObject({
      kind: 'openai-compat',
      name: 'ACP proxy',
      enabled: false,
      local: true,
      base_url: 'http://127.0.0.1:7461/v1',
      concurrency: 2,
      json_schema: false,
      discover: true,
      models: []
    })
  })

  it('discovers slash ids from /v1/models when enabled', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ps-acp-'))
    try {
      const seed = (await readFile(path.join(seedDir, 'providers.md'), 'utf8')).replace(/(id: acp[\s\S]*?enabled: )false/, '$1true')
      await writeFile(path.join(dir, 'providers.md'), seed)
      await writeFile(path.join(dir, 'roles.md'), await readFile(path.join(seedDir, 'roles.md'), 'utf8'))
      const calls: string[] = []
      const fetchImpl = (async (url: string) => {
        calls.push(String(url))
        return String(url) === 'http://127.0.0.1:7461/v1/models'
          ? new Response(JSON.stringify({ data: [{ id: 'codex/gpt-5.6-luna' }, { id: 'antigravity/gemini-3.8-flash' }] }))
          : new Response('', { status: 404 })
      }) as unknown as typeof fetch
      const registry = new ModelRegistry(dir, { fetchImpl })
      await registry.load()
      const out = await registry.discover()
      expect(out.find((o) => o.provider === 'acp')).toEqual({ provider: 'acp', found: 2 })
      expect(registry.getModel('acp/codex/gpt-5.6-luna')).toMatchObject({ id: 'codex/gpt-5.6-luna', source: 'discovered', tools: false, priceIn: 0 })
      expect(registry.getModel('acp/antigravity/gemini-3.8-flash')).toMatchObject({ family: 'gemini', shown: false })
      expect(registry.providers.get('acp')).toMatchObject({ local: true, jsonSchema: false, concurrency: 2, name: 'ACP proxy' })
      expect((await registry.catalog('acp')).map((m) => m.id)).toEqual(['codex/gpt-5.6-luna', 'antigravity/gemini-3.8-flash'])
      expect(await registry.testEndpoint('http://127.0.0.1:7461/v1')).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('seed migration', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ps-mig-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))
  const file = () => path.join(dir, 'providers.md')
  const state = async () => JSON.parse(await readFile(path.join(dir, SEED_STATE_FILE), 'utf8')) as { providers: string[] }

  /** An older user file: the seed's providers without acp, with an edit and a comment. */
  async function oldFile(): Promise<string> {
    const seed = await readFile(path.join(seedDir, 'providers.md'), 'utf8')
    const text = seed.replace(/ {2}- id: acp[\s\S]*? {4}models: \[\]\r?\n/, '').replace('concurrency: 8', 'concurrency: 3 # my edit')
    expect(text).not.toContain('id: acp')
    await writeFile(file(), text)
    return text
  }

  it('adds acp once to an old file without touching the user edits, and is idempotent', async () => {
    const before = await oldFile()
    const r = await migrateProviders(dir, seedDir, { fresh: false })
    expect(r).toEqual({ added: ['acp'], warnings: [] })
    const after = await readFile(file(), 'utf8')
    expect(after).toContain('concurrency: 3 # my edit')
    expect(after.replace(/ {2}# ACP[\s\S]*/, '')).toBeTruthy()
    const data = parseMdWith(after, providersSchema).data
    expect(data.providers.map((p) => p.id)).toEqual(['lmstudio', 'strata', 'deepseek', 'openrouter', 'ollama', 'openai', 'anthropic', 'gemini', 'acp', 'mock'])
    expect(data.providers.find((p) => p.id === 'acp')).toMatchObject({ enabled: false, local: true, base_url: 'http://127.0.0.1:7461/v1' })
    // everything else is byte for byte what it was
    expect(after.replace(/ {2}- id: acp[\s\S]*? {4}models: \[\]\r?\n/, '')).toBe(before)
    expect((await state()).providers).toContain('acp')
    // a second run changes nothing
    expect(await migrateProviders(dir, seedDir, { fresh: false })).toEqual({ added: [], warnings: [] })
    expect(await readFile(file(), 'utf8')).toBe(after)
  })

  it('does not add acp back after the user removed it, nor overwrite an edited acp', async () => {
    await oldFile()
    await migrateProviders(dir, seedDir, { fresh: false })
    const withAcp = await readFile(file(), 'utf8')
    const edited = withAcp.replace('enabled: false                # switch on', 'enabled: true                 # switch on').replace('concurrency: 2', 'concurrency: 5')
    expect(edited).not.toBe(withAcp)
    await writeFile(file(), edited)
    expect(await migrateProviders(dir, seedDir, { fresh: false })).toEqual({ added: [], warnings: [] })
    expect(await readFile(file(), 'utf8')).toBe(edited)
    await writeFile(file(), edited.replace(/ {2}- id: acp[\s\S]*? {4}models: \[\]\r?\n/, ''))
    expect((await migrateProviders(dir, seedDir, { fresh: false })).added).toEqual([])
    expect(await readFile(file(), 'utf8')).not.toContain('id: acp')
  })

  it('a fresh file only records the state; an unreadable file is left alone with a warning', async () => {
    await writeFile(file(), await readFile(path.join(seedDir, 'providers.md'), 'utf8'))
    expect(await migrateProviders(dir, seedDir, { fresh: true })).toEqual({ added: [], warnings: [] })
    expect((await state()).providers).toContain('acp')
    await rm(path.join(dir, SEED_STATE_FILE))
    await writeFile(file(), '---\nkind: providers\nproviders: [oops\n---\n')
    const r = await migrateProviders(dir, seedDir, { fresh: false })
    expect(r.added).toEqual([])
    expect(r.warnings[0]).toMatch(/not valid YAML/)
    expect(await readFile(file(), 'utf8')).toBe('---\nkind: providers\nproviders: [oops\n---\n')
  })

  it('createLlm migrates an existing config folder on start, and seeds a fresh one with acp', async () => {
    await oldFile()
    await writeFile(path.join(dir, 'roles.md'), await readFile(path.join(seedDir, 'roles.md'), 'utf8'))
    const { registry } = await createLlm({ configDir: dir, seedDir, discover: false })
    expect(registry.providers.get('acp')).toMatchObject({ enabled: false, local: true })
    const fresh = await mkdtemp(path.join(os.tmpdir(), 'ps-mig-fresh-'))
    try {
      const { registry: r2 } = await createLlm({ configDir: path.join(fresh, 'config'), seedDir, discover: false })
      expect(r2.providers.get('acp')).toBeDefined()
      expect(JSON.parse(await readFile(path.join(fresh, 'config', SEED_STATE_FILE), 'utf8')).providers).toContain('acp')
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})
