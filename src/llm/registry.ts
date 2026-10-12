import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AnthropicClient } from './anthropic'
import { providersSchema, rolesSchema } from './config'
import type { ProviderEntry, RolesConfig } from './config'
import { GeminiClient } from './gemini'
import { resolveKey } from './keys'
import type { KeyResolver } from './keys'
import { parseMdWith } from './md'
import { MockProvider } from './mock'
import { OpenAiCompatClient } from './openaiCompat'
import { computeCost } from './pricing'
import type { ProviderClient } from './types'

export { computeCost } from './pricing'

export interface ProviderInfo {
  id: string
  kind: ProviderEntry['kind']
  enabled: boolean
  local: boolean
  baseUrl?: string
  apiKeyEnv?: string
  concurrency: number
  /** `concurrency: auto`: `concurrency` follows the server's own slot count (see `syncServerSlots`). */
  concurrencyAuto: boolean
  rpm?: number
  discover: boolean
  /** Send the JSON schema as `response_format` (`openai-compat`). */
  jsonSchema: boolean
  /** LM Studio: the registry loads a model that isn't loaded yet. */
  loadModels: boolean
  /** Enabled and (local, mock or has a key). */
  available: boolean
  unavailableReason?: string
  client?: ProviderClient
}

export interface ModelInfo {
  /** `provider/model`. */
  ref: string
  provider: ProviderInfo
  id: string
  family: string
  context?: number
  maxOutput?: number
  /** USD per 1M tokens (display only). */
  priceIn: number
  priceOut: number
  priceCachedIn: number
  /** Native tool calling. */
  tools: boolean
  /** Accepts images. */
  vision: boolean
  extraBody: Record<string, unknown> | null
  discovered: boolean
  /** LM Studio: this model's own load settings (`load_context`, `load_parallel`), over the provider defaults. */
  loadContext?: number
  loadParallel?: number
}

export interface RegistryOptions {
  keys?: KeyResolver
  fetchImpl?: typeof fetch
  /** Reuse a mock provider so tests can script it. */
  mock?: MockProvider
  /** LM Studio's `lms` command line, used to load models. Default: `~/.lmstudio/bin/lms(.exe)` when it exists. `null`: use the REST API. */
  lmsPath?: string | null
}

export interface LmLoadSettings {
  parallel: number
  context: number
  ttlMinutes: number
}

/** The default config folder: `~/PixelStudio/config` (or `$PIXEL_STUDIO_HOME/config` when that variable is set). */
export function defaultConfigDir(): string {
  const override = process.env['PIXEL_STUDIO_HOME']?.trim()
  return path.join(override ? path.resolve(override) : path.join(os.homedir(), 'PixelStudio'), 'config')
}

export const CONFIG_FILES = ['providers.md', 'roles.md'] as const

/** Creates `configDir` and copies the seed config files that are missing there. Existing files are never overwritten. Returns the files it wrote. */
export async function ensureConfigDir(configDir: string, seedDir?: string): Promise<string[]> {
  await fs.mkdir(configDir, { recursive: true })
  const written: string[] = []
  for (const name of CONFIG_FILES) {
    const dest = path.join(configDir, name)
    if (existsSync(dest)) continue
    if (!seedDir) throw new Error(`${dest} is missing and no seed config folder was given`)
    await fs.copyFile(path.join(seedDir, name), dest)
    written.push(name)
  }
  return written
}

function defaultLmsPath(): string | undefined {
  const p = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms')
  return existsSync(p) ? p : undefined
}

/** A model that costs money: not local and with a price. */
export function isPaidModel(m: ModelInfo): boolean {
  return !m.provider.local && (m.priceIn > 0 || m.priceOut > 0 || m.priceCachedIn > 0)
}

export class ModelRegistry {
  providers = new Map<string, ProviderInfo>()
  models = new Map<string, ModelInfo>()
  roles: RolesConfig = { kind: 'roles', aliases: {}, roles: {} }
  readonly mock: MockProvider
  /** The slot counts servers reported for `concurrency: auto` providers, kept across config reloads. */
  private serverSlots = new Map<string, number>()
  private lmLoad: LmLoadSettings = { parallel: 1, context: 32768, ttlMinutes: 60 }

  /** `configDir` holds providers.md and roles.md (see `ensureConfigDir`). */
  constructor(
    readonly configDir: string,
    private readonly opts: RegistryOptions = {}
  ) {
    this.mock = opts.mock ?? new MockProvider('mock')
  }

  /** (Re)reads providers.md and roles.md. Throws, and keeps the previous state, if a file is invalid. */
  async load(): Promise<void> {
    const provFile = path.join(this.configDir, 'providers.md')
    const rolesFile = path.join(this.configDir, 'roles.md')
    const prov = parseMdWith(await fs.readFile(provFile, 'utf8'), providersSchema, provFile)
    const roles = parseMdWith(await fs.readFile(rolesFile, 'utf8'), rolesSchema, rolesFile)
    const keys = this.opts.keys ?? resolveKey
    const discoveredBefore = [...this.models.values()].filter((m) => m.discovered)
    this.lmLoad = { parallel: prov.data.lmstudio_parallel, context: prov.data.lmstudio_context, ttlMinutes: prov.data.lmstudio_ttl_minutes }

    const providers = new Map<string, ProviderInfo>()
    const models = new Map<string, ModelInfo>()
    for (const p of prov.data.providers) {
      const info: ProviderInfo = {
        id: p.id,
        kind: p.kind,
        enabled: p.enabled,
        local: p.local,
        baseUrl: p.base_url,
        apiKeyEnv: p.api_key_env,
        concurrency: p.concurrency === 'auto' ? (this.serverSlots.get(p.id) ?? 1) : p.concurrency,
        concurrencyAuto: p.concurrency === 'auto',
        rpm: p.rpm,
        discover: p.discover,
        jsonSchema: p.json_schema,
        loadModels: p.load_models,
        available: false
      }
      this.setupClient(info, keys)
      providers.set(p.id, info)
      for (const m of p.models) {
        const ref = `${p.id}/${m.id}`
        models.set(ref, {
          ref,
          provider: info,
          id: m.id,
          family: m.family,
          // a model the registry loads itself gets the context window it loads it with
          context: p.load_models ? Math.min(m.context ?? Infinity, m.load_context ?? this.lmLoad.context) : m.context,
          loadContext: m.load_context,
          loadParallel: m.load_parallel,
          maxOutput: m.max_output,
          priceIn: m.price_in,
          priceOut: m.price_out,
          priceCachedIn: m.price_cached_in ?? m.price_in,
          tools: m.tools ?? !p.local,
          vision: m.vision,
          extraBody: m.extra_body ?? null,
          discovered: false
        })
      }
    }
    this.providers = providers
    this.models = models
    this.roles = roles.data
    // Keep what discovery found earlier, so a config reload does not forget it.
    for (const d of discoveredBefore) {
      const prov = this.providers.get(d.provider.id)
      if (prov && !this.models.has(d.ref)) this.models.set(d.ref, { ...d, provider: prov })
    }
  }

  private setupClient(info: ProviderInfo, keys: KeyResolver): void {
    if (!info.enabled) {
      info.unavailableReason = 'disabled in config/providers.md'
      return
    }
    if (info.kind === 'mock') {
      info.client = this.mock
      info.available = true
      return
    }
    let apiKey: string | undefined
    if (info.apiKeyEnv) {
      apiKey = keys(info.apiKeyEnv)
      if (!apiKey && !info.local) {
        info.unavailableReason = `no key (set ${info.apiKeyEnv} or enter it in Settings)`
        return
      }
    }
    const fetchImpl = this.opts.fetchImpl
    if (info.kind === 'openai-compat') {
      if (!info.baseUrl) {
        info.unavailableReason = 'no base_url'
        return
      }
      info.client = new OpenAiCompatClient({
        id: info.id,
        baseUrl: info.baseUrl,
        apiKey,
        fetchImpl,
        jsonSchema: info.jsonSchema,
        loadConfig: info.loadModels ? (model) => this.loadConfigFor(info.id, model) : undefined,
        lmsPath: info.loadModels ? (this.opts.lmsPath === null ? undefined : (this.opts.lmsPath ?? defaultLmsPath())) : undefined
      })
    } else if (info.kind === 'anthropic') {
      info.client = new AnthropicClient({ id: info.id, baseUrl: info.baseUrl, apiKey: apiKey ?? '', fetchImpl })
    } else if (info.kind === 'gemini') {
      info.client = new GeminiClient({ id: info.id, baseUrl: info.baseUrl, apiKey: apiKey ?? '', fetchImpl })
    }
    info.available = true
  }

  /** `GET /models` on every provider with `discover: true`. Adds unknown models, family guessed from the id. LM Studio also reports tool and vision support. */
  async discover(signal?: AbortSignal): Promise<{ provider: string; found: number; error?: string }[]> {
    const out: { provider: string; found: number; error?: string }[] = []
    for (const p of this.providers.values()) {
      if (!p.discover || !p.available || !(p.client instanceof OpenAiCompatClient)) continue
      try {
        const ids = await p.client.listModels(signal)
        const info = await p.client.localModelInfo(signal)
        for (const id of ids) {
          const ref = `${p.id}/${id}`
          if (this.models.has(ref)) continue
          const li = info.get(id)
          this.models.set(ref, {
            ref,
            provider: p,
            id,
            family: guessFamily(id),
            priceIn: 0,
            priceOut: 0,
            priceCachedIn: 0,
            tools: li?.tools ?? !p.local,
            vision: li?.vision ?? false,
            extraBody: null,
            discovered: true
          })
        }
        // the context the model is loaded with, unless providers.md says otherwise (a model already loaded counts as it is)
        for (const [id, li] of info) {
          const m = this.models.get(`${p.id}/${id}`)
          if (m && li.loadedContext && (m.context === undefined || p.loadModels)) m.context = li.loadedContext
        }
        out.push({ provider: p.id, found: ids.length })
      } catch (err) {
        out.push({ provider: p.id, found: 0, error: (err as Error).message })
      }
    }
    return out
  }

  /**
   * Asks every `concurrency: auto` provider how many requests it serves at once and sets its `concurrency`:
   * Strata reports it as `concurrency.serving` of `GET <base_url>/status`; for LM Studio it is the sum of `parallel`
   * over the loaded chat models (`GET /api/v1/models`). A server that can't be asked counts as 1.
   * Returns the providers whose concurrency changed.
   */
  async syncServerSlots(signal?: AbortSignal): Promise<{ provider: ProviderInfo; from: number; to: number }[]> {
    const changed: { provider: ProviderInfo; from: number; to: number }[] = []
    for (const p of this.providers.values()) {
      if (!p.concurrencyAuto || !p.available || !p.baseUrl) continue
      const base = p.baseUrl.replace(/\/+$/, '')
      const get = async (url: string) => {
        const res = await (this.opts.fetchImpl ?? fetch)(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) })
        return res.ok ? ((await res.json()) as Record<string, unknown>) : null
      }
      let slots = 1
      try {
        const status = await get(`${base}/status`).catch(() => null)
        const n = Number((status?.concurrency as { serving?: unknown } | undefined)?.serving)
        if (Number.isInteger(n) && n >= 1) slots = Math.min(n, 16)
        else {
          // LM Studio: its native API sits next to the OpenAI-compatible /v1
          const lm = await get(`${base.replace(/\/v1$/, '')}/api/v1/models`)
          const models = (lm?.models ?? []) as { type?: string; loaded_instances?: { config?: { parallel?: unknown } }[] }[]
          let sum = 0
          for (const m of models) {
            if (m.type !== 'llm') continue
            for (const i of m.loaded_instances ?? []) {
              const par = Number(i.config?.parallel)
              sum += Number.isInteger(par) && par >= 1 ? par : 1
            }
          }
          if (sum >= 1) slots = Math.min(sum, 16)
        }
      } catch {
        /* the server is down or restarting: one at a time until it answers */
      }
      this.serverSlots.set(p.id, slots)
      if (p.concurrency !== slots) {
        changed.push({ provider: p, from: p.concurrency, to: slots })
        p.concurrency = slots
      }
    }
    return changed
  }

  getModel(ref: string): ModelInfo | undefined {
    return this.models.get(this.resolve(ref))
  }

  /** The chat models (all models here: there are no embedding models), available ones first. */
  listModels(): ModelInfo[] {
    return [...this.models.values()].sort((a, b) => Number(b.provider.available) - Number(a.provider.available))
  }

  /** How a `load_models` provider loads `model`: the provider defaults, with the model's own `load_context` / `load_parallel` over them. */
  loadConfigFor(provider: string, model: string): LmLoadSettings {
    const m = this.models.get(`${provider}/${model}`)
    return { parallel: m?.loadParallel ?? this.lmLoad.parallel, context: m?.loadContext ?? this.lmLoad.context, ttlMinutes: this.lmLoad.ttlMinutes }
  }

  /** A `provider/model`, or an alias from roles.md resolved to its model. */
  resolve(ref: string): string {
    return this.roles.aliases[ref] ?? ref
  }

  /** Model refs in the roles file for a role, in order, with aliases resolved. */
  roleModelRefs(role: string): string[] {
    return (this.roles.roles[role]?.models ?? []).map((r) => this.resolve(r))
  }
}

export function guessFamily(id: string): string {
  const s = id.toLowerCase()
  for (const f of ['qwen', 'nemotron', 'deepseek', 'llama', 'mistral', 'gemma', 'glm', 'kimi', 'claude', 'gemini', 'gpt']) {
    if (s.includes(f)) return f
  }
  return 'unknown'
}

/** Cost of a usage on a model in USD, 0 for local models. For display. */
export function costOf(m: ModelInfo, usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number }): number {
  return isPaidModel(m) ? computeCost(m, usage) : 0
}
