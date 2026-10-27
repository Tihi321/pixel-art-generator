import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAppSettings, writeAppSettings } from '../../src/main/appSettings'
import { LlmService, type KeyOps } from '../../src/main/llm'

const seedDir = fileURLToPath(new URL('../../seed/config', import.meta.url))

function fakeKeys(env: Record<string, string> = {}) {
  const store = new Map<string, string>()
  const ops: KeyOps = {
    env: (n) => env[n],
    getStored: (n) => store.get(n),
    set: (n, v) => void store.set(n, v),
    delete: (n) => store.delete(n),
    resolve: (n) => env[n] ?? store.get(n)
  }
  return { ops, store }
}

describe('LlmService', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ps-llm-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))
  const make = (keys: KeyOps) => new LlmService({ seedDir, configDir: path.join(dir, 'config'), dataDir: dir, keys, discover: false })

  it('lists providers and models with capabilities, key status and no key values', async () => {
    const { ops, store } = fakeKeys({ OPENAI_API_KEY: 'sk-env-secret' })
    store.set('ANTHROPIC_API_KEY', 'sk-stored-secret')
    const o = await make(ops).overview()
    expect(o.error).toBeUndefined()
    expect(o.dataDir).toBe(dir)
    const byId = Object.fromEntries(o.providers.map((p) => [p.id, p]))
    expect(byId.anthropic).toMatchObject({ keyStatus: 'stored', available: true, apiKeyEnv: 'ANTHROPIC_API_KEY' })
    expect(byId.openai).toMatchObject({ keyStatus: 'env' })
    expect(byId.deepseek).toMatchObject({ keyStatus: 'none', available: false })
    expect(byId.lmstudio).toMatchObject({ keyStatus: 'none', available: true, local: true })
    expect(byId.anthropic!.models).toContain('anthropic/claude-sonnet-5-5')
    const sonnet = o.models.find((m) => m.ref === 'anthropic/claude-sonnet-5-5')!
    expect(sonnet).toMatchObject({ tools: true, vision: true, local: false, available: true })
    expect(o.models.find((m) => m.ref === 'lmstudio/google/gemma-4-e4b')).toMatchObject({ tools: false, vision: true, local: true })
    expect(o.defaultModel).toBe('lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp')
    expect(JSON.stringify(o)).not.toMatch(/secret/)
  })

  it('the overview says what the dropdown shows; showModels and addModel persist in models.md and come back as a fresh overview', async () => {
    const { ops } = fakeKeys({ DEEPSEEK_API_KEY: 'k' })
    const svc = make(ops)
    const o = await svc.overview()
    expect(o.providers.find((p) => p.id === 'openrouter')).toMatchObject({ canList: true, discover: 'free' })
    expect(o.providers.find((p) => p.id === 'anthropic')).toMatchObject({ canList: false, discover: false })
    expect(o.models.find((m) => m.ref === 'deepseek/deepseek-flash')).toMatchObject({ shown: false, source: 'config', context: 1000000, free: false, priceIn: 0.3 })
    expect(o.models.find((m) => m.ref === 'lmstudio/google/gemma-4-e4b')).toMatchObject({ shown: false, free: true })
    // nothing is in the dropdown until ticked
    expect(o.models.some((m) => m.shown)).toBe(false)

    const ticked = await svc.showModels(['deepseek/deepseek-flash'], true)
    expect(ticked.error).toBeUndefined()
    expect(ticked.models.find((m) => m.ref === 'deepseek/deepseek-flash')).toMatchObject({ shown: true })
    expect(await readFile(path.join(dir, 'config', 'models.md'), 'utf8')).toContain('deepseek/deepseek-flash')

    const refused = await svc.showModels(['deepseek/unlisted'], true)
    expect(refused.error).toMatch(/not listed/)

    await expect(svc.addModel({ provider: 'deepseek', id: 'deepseek-x', priceIn: 1 })).rejects.toThrow(/needs its price/)
    const added = await svc.addModel({ provider: 'deepseek', id: 'deepseek-x', priceIn: 1, priceOut: 2, context: 64000 })
    expect(added.models.find((m) => m.ref === 'deepseek/deepseek-x')).toMatchObject({ shown: true, source: 'picked', priceOut: 2, context: 64000 })
    // a restart reads the same choices
    const again = await make(ops).overview()
    expect(again.models.find((m) => m.ref === 'deepseek/deepseek-x')).toMatchObject({ shown: true })
    expect(again.models.find((m) => m.ref === 'deepseek/deepseek-flash')).toMatchObject({ shown: true })
    // a provider without a key answers the catalog with an error, not a throw
    expect((await make(fakeKeys().ops).catalog('openrouter')).error).toMatch(/no key/)
  })

  it('stores and deletes keys by the provider api_key_env and refreshes availability', async () => {
    const { ops, store } = fakeKeys()
    const svc = make(ops)
    expect((await svc.overview()).providers.find((p) => p.id === 'deepseek')).toMatchObject({ available: false })
    const after = await svc.setKey('deepseek', '  sk-new  ')
    expect(store.get('DEEPSEEK_API_KEY')).toBe('sk-new')
    expect(after.providers.find((p) => p.id === 'deepseek')).toMatchObject({ available: true, keyStatus: 'stored' })
    expect(JSON.stringify(after)).not.toContain('sk-new')
    const gone = await svc.deleteKey('deepseek')
    expect(store.has('DEEPSEEK_API_KEY')).toBe(false)
    expect(gone.providers.find((p) => p.id === 'deepseek')).toMatchObject({ available: false, keyStatus: 'none' })
    await expect(svc.setKey('lmstudio', 'x')).rejects.toThrow(/no api_key_env/)
    await expect(svc.setKey('deepseek', '  ')).rejects.toThrow(/empty/)
  })

  it('persists the selected model and resolves it with its capabilities', async () => {
    const { ops } = fakeKeys({ ANTHROPIC_API_KEY: 'k' })
    const svc = make(ops)
    expect(await svc.selectedModel()).toBeNull()
    await svc.setSelectedModel('anthropic/claude-sonnet-5-5')
    expect((await svc.overview()).selectedModel).toBe('anthropic/claude-sonnet-5-5')
    expect(JSON.parse(await readFile(path.join(dir, 'config', 'app.json'), 'utf8'))).toEqual({ selectedModel: 'anthropic/claude-sonnet-5-5' })
    expect(await svc.resolveModel()).toMatchObject({ vision: true, ref: 'anthropic/claude-sonnet-5-5', source: { role: 'artist', modelRef: 'anthropic/claude-sonnet-5-5' } })
    // an explicit ref wins over the saved one
    expect(await svc.resolveModel('lmstudio/google/gemma-4-e4b')).toMatchObject({ vision: true, ref: 'lmstudio/google/gemma-4-e4b' })
    await svc.setSelectedModel(null)
    expect(await svc.resolveModel()).toMatchObject({ vision: true, ref: 'lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp' })
  })

  it('the context size from Settings is saved, applied to LM Studio loads and survives a restart', async () => {
    const { ops } = fakeKeys()
    const svc = make(ops)
    expect(await svc.overview()).toMatchObject({ contextSize: 131072, contextSizeSet: false })
    expect((await svc.overview()).providers.find((p) => p.id === 'lmstudio')).toMatchObject({ loadsModels: true })
    expect(await svc.setContextSize(65536)).toMatchObject({ contextSize: 65536, contextSizeSet: true })
    expect((await svc.get()).registry.loadConfigFor('lmstudio', 'nail-qwen3.6-35b-a3b-mtp').context).toBe(65536)
    await expect(svc.setContextSize(100)).rejects.toThrow(/2048/)
    const again = make(ops)
    expect((await again.get()).registry.loadConfigFor('lmstudio', 'nail-qwen3.6-35b-a3b-mtp').context).toBe(65536)
    expect(await again.setContextSize(null)).toMatchObject({ contextSize: 131072, contextSizeSet: false })
  })

  it('reload keeps working and reports an invalid config instead of throwing', async () => {
    const { ops } = fakeKeys()
    const svc = make(ops)
    await svc.overview()
    await writeFile(path.join(dir, 'config', 'roles.md'), '---\nkind: nope\n---\n', 'utf8')
    const o = await svc.reload()
    expect(o.error).toBeTruthy()
    expect(o.providers.length).toBeGreaterThan(0)
  })

  it('adds, edits and removes a custom provider without a restart, keeping its key out of providers.md', async () => {
    const { ops, store } = fakeKeys()
    const calls: { url: string; auth: string | null }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
      return String(url).endsWith('/v1/models') ? new Response(JSON.stringify({ data: [{ id: 'a/one' }, { id: 'a/two' }] })) : new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const svc = new LlmService({ seedDir, configDir: path.join(dir, 'config'), dataDir: dir, keys: ops, fetchImpl })
    expect((await svc.overview()).providers.find((p) => p.id === 'acp')).toMatchObject({ name: 'ACP proxy', custom: false, enabled: false, canList: true, concurrency: 2, jsonSchema: false })

    // reserved ids and a seed provider are refused, and nothing is written
    const providersFile = path.join(dir, 'config', 'providers.md')
    const before = await readFile(providersFile, 'utf8')
    await expect(svc.saveCustomProvider({ name: 'ACP', baseUrl: 'http://127.0.0.1:1/v1', free: true, jsonSchema: false, concurrency: 1, enabled: true })).rejects.toThrow(/built-in/)
    await expect(svc.saveCustomProvider({ id: 'deepseek', name: 'x', baseUrl: 'http://127.0.0.1:1/v1', free: true, jsonSchema: false, concurrency: 1, enabled: true })).rejects.toThrow(/not a custom/)
    await expect(svc.removeCustomProvider('lmstudio')).rejects.toThrow(/not a custom/)
    expect(await readFile(providersFile, 'utf8')).toBe(before)

    // test before saving
    expect(await svc.testCustomProvider({ baseUrl: 'http://127.0.0.1:9000/v1', apiKey: 'tk' })).toEqual({ ok: true, models: 2 })
    expect(calls.at(-1)).toEqual({ url: 'http://127.0.0.1:9000/v1/models', auth: 'Bearer tk' })
    expect(await svc.testCustomProvider({ baseUrl: 'ftp://x' })).toMatchObject({ ok: false })
    expect(await svc.testCustomProvider({ baseUrl: 'http://127.0.0.1:9000/nope' })).toMatchObject({ ok: false, error: expect.stringContaining('404') })

    // add: live at once, with its models discovered
    const added = await svc.saveCustomProvider({ name: 'Home Proxy', baseUrl: 'http://127.0.0.1:9000/v1', apiKey: ' secret-key ', free: true, jsonSchema: false, concurrency: 3, enabled: true })
    const home = added.providers.find((p) => p.id === 'home-proxy')!
    expect(home).toMatchObject({ name: 'Home Proxy', custom: true, available: true, concurrency: 3, apiKeyEnv: 'CUSTOM_HOME_PROXY_API_KEY', keyStatus: 'stored', models: ['home-proxy/a/one', 'home-proxy/a/two'] })
    expect(store.get('CUSTOM_HOME_PROXY_API_KEY')).toBe('secret-key')
    expect(await readFile(providersFile, 'utf8')).not.toContain('secret-key')
    expect(JSON.stringify(added)).not.toContain('secret-key')
    await expect(svc.saveCustomProvider({ name: 'home proxy', baseUrl: 'http://127.0.0.1:9000/v1', free: true, jsonSchema: false, concurrency: 1, enabled: true })).rejects.toThrow(/exists already/)

    // tick one of its models and select it, then edit: the key stays when the field is empty
    await svc.showModels(['home-proxy/a/one'], true)
    await svc.setSelectedModel('home-proxy/a/one')
    const edited = await svc.saveCustomProvider({ id: 'home-proxy', name: 'Home Proxy', baseUrl: 'http://127.0.0.1:9100/v1', free: true, jsonSchema: true, concurrency: 'auto', enabled: true })
    expect(edited.providers.find((p) => p.id === 'home-proxy')).toMatchObject({ baseUrl: 'http://127.0.0.1:9100/v1', jsonSchema: true, concurrencyAuto: true, keyStatus: 'stored' })
    expect(store.get('CUSTOM_HOME_PROXY_API_KEY')).toBe('secret-key')
    expect(await svc.testCustomProvider({ id: 'home-proxy', baseUrl: 'http://127.0.0.1:9000/v1' })).toEqual({ ok: true, models: 2 })
    expect(calls.at(-1)!.auth).toBe('Bearer secret-key')

    // a restart reads the same file
    expect((await make(ops).overview()).providers.some((p) => p.id === 'home-proxy' && p.custom)).toBe(true)

    // remove: entry, key, ticked model and selection are gone
    const removed = await svc.removeCustomProvider('home-proxy')
    expect(removed.providers.some((p) => p.id === 'home-proxy')).toBe(false)
    expect(removed.selectedModel).toBeNull()
    expect(removed.models.some((m) => m.provider === 'home-proxy')).toBe(false)
    expect(store.has('CUSTOM_HOME_PROXY_API_KEY')).toBe(false)
    expect(await readFile(providersFile, 'utf8')).not.toContain('home-proxy')
    expect(await readFile(path.join(dir, 'config', 'models.md'), 'utf8')).not.toContain('home-proxy')
  })
})

describe('appSettings', () => {
  it('reads defaults from a missing or broken file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ps-app-'))
    try {
      expect(await readAppSettings(dir)).toEqual({ selectedModel: null, contextSize: null })
      await writeAppSettings(dir, { selectedModel: 'a/b' })
      expect((await readAppSettings(dir)).selectedModel).toBe('a/b')
      await writeAppSettings(dir, { contextSize: 65536 })
      expect(await readAppSettings(dir)).toEqual({ selectedModel: 'a/b', contextSize: 65536 })
      await writeFile(path.join(dir, 'app.json'), JSON.stringify({ contextSize: 100 }), 'utf8')
      expect((await readAppSettings(dir)).contextSize).toBeNull()
      await writeFile(path.join(dir, 'app.json'), '{not json', 'utf8')
      expect(await readAppSettings(dir)).toEqual({ selectedModel: null, contextSize: null })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
