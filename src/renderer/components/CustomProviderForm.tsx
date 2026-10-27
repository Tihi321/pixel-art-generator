import { useState } from 'react'
import type { LlmCustomProviderTestResult, LlmProviderInfo } from '../../shared/agent'
import { llmApi } from '../lib/agentApi'
import { useChat } from '../state/chat'

interface Props {
  /** The custom provider to edit. Missing: a new one. */
  provider?: LlmProviderInfo
  /** Called with the id of the saved provider, or nothing when cancelled. */
  onDone: (id?: string) => void
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const URL_OK = /^https?:\/\/\S+$/i

/** The Add provider / Edit provider form of Settings > Models: any OpenAI-compatible server, saved to config/providers.md. */
export function CustomProviderForm({ provider, onDone }: Props) {
  const setOverview = useChat((s) => s.setOverview)
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? 'http://127.0.0.1:')
  const [apiKey, setApiKey] = useState('')
  const [free, setFree] = useState(provider?.local ?? true)
  const [jsonSchema, setJsonSchema] = useState(provider?.jsonSchema ?? false)
  const [auto, setAuto] = useState(provider?.concurrencyAuto ?? false)
  const [parallel, setParallel] = useState(provider && !provider.concurrencyAuto ? provider.concurrency : 2)
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [test, setTest] = useState<LlmCustomProviderTestResult | 'running' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const valid = name.trim() !== '' && URL_OK.test(baseUrl.trim()) && (auto || (Number.isInteger(parallel) && parallel >= 1))

  const runTest = (): void => {
    setTest('running')
    llmApi
      .testCustomProvider({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, id: provider?.id })
      .then(setTest)
      .catch((e) => setTest({ ok: false, error: msg(e) }))
  }

  const save = (): void => {
    setSaving(true)
    setError('')
    llmApi
      .saveCustomProvider({ id: provider?.id, name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, free, jsonSchema, concurrency: auto ? 'auto' : parallel, enabled })
      .then((o) => {
        setOverview(o)
        onDone(provider?.id ?? o.providers.find((p) => p.custom && p.name === name.trim())?.id)
      })
      .catch((e) => setError(msg(e)))
      .finally(() => setSaving(false))
  }

  return (
    <div className="models-pane" data-testid="provider-form">
      <b>{provider ? `Edit ${provider.name}` : 'Add provider'}</b>
      <div className="hint">Any OpenAI-compatible server (the ACP proxy, llama.cpp, vLLM, a hosted API). Saved to config/providers.md; the key goes to the Windows credential store.</div>
      <div className="form">
        <label>
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ACP proxy (home)" data-testid="provider-form-name" />
        </label>
        <label>
          <span>Base URL</span>
          <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:7461/v1" data-testid="provider-form-url" />
        </label>
        <label>
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider?.keyStatus === 'stored' ? 'key set (type to replace it)' : 'optional'}
            data-testid="provider-form-key"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} data-testid="provider-form-free" />
          Free / local: no key needed, no prices. Unticked: a paid API, its models need prices.
        </label>
        <label className="check">
          <input type="checkbox" checked={jsonSchema} onChange={(e) => setJsonSchema(e.target.checked)} data-testid="provider-form-schema" />
          Send the JSON schema (off for servers that reject or ignore it)
        </label>
        <label>
          <span>Parallel requests</span>
          <span className="row-buttons">
            <input type="number" min={1} max={64} disabled={auto} value={parallel} onChange={(e) => setParallel(Number(e.target.value))} data-testid="provider-form-parallel" />
            <label className="check">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="provider-form-auto" />
              auto (the server's own slot count)
            </label>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="provider-form-enabled" />
          Use this provider
        </label>
      </div>
      <div className="row-buttons">
        <button disabled={!URL_OK.test(baseUrl.trim()) || test === 'running'} onClick={runTest} data-testid="provider-form-test">
          {test === 'running' ? 'Testing...' : 'Test'}
        </button>
        {test && test !== 'running' && (
          <span className={test.ok ? 'hint' : 'error'} data-testid="provider-form-test-result">
            {test.ok ? `reachable, ${test.models} model${test.models === 1 ? '' : 's'}` : `not reachable: ${test.error}`}
          </span>
        )}
        <span className="spacer" />
        <button onClick={() => onDone()} data-testid="provider-form-cancel">
          Cancel
        </button>
        <button className="primary" disabled={!valid || saving} onClick={save} data-testid="provider-form-save">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {error && <div className="error" data-testid="provider-form-error">{error}</div>}
    </div>
  )
}
