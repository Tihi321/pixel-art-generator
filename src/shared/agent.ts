// IPC contract of the built-in agent (chat) and the LLM settings. Shared by main (src/main/agent*.ts,
// src/main/llm*.ts) and the renderer (Chat panel, Settings dialog). Free of DOM, Node and Electron imports.

/** Renderer -> main use `invoke`; `event` is pushed by main (webContents.send). */
export const AGENT_IPC = {
  /** (AgentSendRequest) => AgentSendResponse. Starts a run. */
  send: 'agent:send',
  /** () => void. Aborts the running turn. */
  stop: 'agent:stop',
  /** () => AgentState. Clears the conversation (aborts a running turn first). */
  reset: 'agent:reset',
  /** () => AgentState */
  getState: 'agent:getState',
  /** main -> renderer push: AgentUiEvent */
  event: 'agent:event'
} as const

export const LLM_IPC = {
  /** () => LlmOverview. Providers, models, the selected model and key status. */
  overview: 'llm:overview',
  /** (modelRef: string | null) => void. The model the chat uses (null: the role's first available model). */
  setSelectedModel: 'llm:setSelectedModel',
  /** (providerId: string, key: string) => LlmOverview. The key is stored in the credential store and never read back. */
  setKey: 'llm:setKey',
  /** (providerId: string) => LlmOverview */
  deleteKey: 'llm:deleteKey',
  /** () => LlmOverview. Re-reads providers.md / roles.md and asks the providers for their models. */
  reload: 'llm:reload',
  /** () => string. Opens ~/PixelStudio/config in the file manager. Resolves to an error message or ''. */
  openConfigFolder: 'llm:openConfigFolder'
} as const

/** Prefix of the undo label of an agent turn (`Agent: <first words of the prompt>`). */
export const AGENT_TURN_LABEL_PREFIX = 'Agent: '

export interface AgentSendRequest {
  text: string
  /** `provider/model` or an alias. Default: the selected model, else the role's first available one. */
  modelRef?: string | null
}

export type AgentSendResponse = { ok: true; runId: string } | { ok: false; error: string }

export interface AgentState {
  running: boolean
  runId: string | null
  /** Messages in the conversation kept in main (user, assistant and tool messages). */
  messageCount: number
}

export interface AgentUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

export type AgentStopReason = 'completed' | 'max_steps' | 'aborted' | 'error'

/** What main pushes to the Chat panel. Every event carries the run it belongs to. */
export type AgentUiEvent = { runId: string } & (
  | { type: 'start'; label: string; text: string }
  | { type: 'step'; step: number; maxSteps: number; mode: 'native' | 'json' }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | {
      type: 'tool_result'
      id: string
      name: string
      isError: boolean
      /** The text of the result, cut to a short length. */
      summary: string
      /** A preview image (`data:image/png;base64,...`) when the tool returned one. */
      image?: string
    }
  | { type: 'usage'; usage: AgentUsage; costUsd: number; model?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; reason: AgentStopReason; steps: number; usage: AgentUsage; costUsd: number; model?: string; error?: string }
)

export interface LlmModelInfo {
  /** `provider/model`. */
  ref: string
  provider: string
  id: string
  label: string
  tools: boolean
  vision: boolean
  local: boolean
  available: boolean
  unavailableReason?: string
  /** USD per 1M tokens, when the config has a price. */
  priceIn?: number
  priceOut?: number
}

export type KeyStatus = 'none' | 'stored' | 'env'

export interface LlmProviderInfo {
  id: string
  kind: string
  enabled: boolean
  local: boolean
  baseUrl?: string
  /** The credential-store account / environment variable of the key; absent when the provider needs none. */
  apiKeyEnv?: string
  available: boolean
  unavailableReason?: string
  /** Where the key comes from. Never the key itself. */
  keyStatus: KeyStatus
  /** `provider/model` refs. */
  models: string[]
}

export interface LlmOverview {
  providers: LlmProviderInfo[]
  models: LlmModelInfo[]
  /** The model chosen for the chat, null for the role's default. */
  selectedModel: string | null
  /** What runs when `selectedModel` is null: the role's first available model. */
  defaultModel: string | null
  configDir: string
  dataDir: string
  /** Set when providers.md or roles.md could not be read. */
  error?: string
}
