// Renderer side of the tool bridge: runs the tool calls that main forwards (chat agent, MCP) on the live
// EditorSession, and provides the ToolServices backed by main over IPC. Imports nothing from src/llm
// or Node, so it typechecks under tsconfig.web.json.

import type { Palette } from '../core'
import { IPC, type PixelStudioApi, type ToolCancelRequest, type ToolExecuteRequest, type ToolResultPayload, type ToolTurnRequest, type Unsubscribe } from '../shared/ipc'
import type { EditorSession } from '../tools/session'
import { type ToolRegistry, createToolHost } from '../tools/registry'
import { ASSETS_IPC } from '../shared/assets'
import type { AssetData, AssetFilter, AssetMeta, AssetSaveInput, ToolServices, UserPaletteInfo } from '../tools/services'

function defaultApi(): PixelStudioApi {
  return (globalThis as unknown as { pixelStudio: PixelStudioApi }).pixelStudio
}

/** ToolServices that call the main process (src/main/services.ts) through `window.pixelStudio.invoke`. */
export function createIpcServices(api: PixelStudioApi = defaultApi()): ToolServices {
  return {
    writeFile: (path, data) => api.invoke<void>(IPC.fsWriteFile, path, data),
    readFile: async (path) => {
      const r = await api.invoke<Uint8Array | ArrayBuffer>(IPC.fsReadFile, path)
      return r instanceof Uint8Array ? r : new Uint8Array(r)
    },
    resolveExportPath: (name, dir) => api.invoke<string>(IPC.fsResolveExportPath, name, dir),
    resolveProjectPath: (name, dir) => api.invoke<string>(IPC.fsResolveProjectPath, name, dir),
    listUserPalettes: () => api.invoke<UserPaletteInfo[]>(IPC.palettesList),
    saveUserPalette: (palette: Palette) => api.invoke<UserPaletteInfo & { path?: string }>(IPC.palettesSave, palette),
    loadUserPalette: (idOrName) => api.invoke<Palette | null>(IPC.palettesLoad, idOrName),
    assets: {
      list: (filter?: AssetFilter) => api.invoke<AssetMeta[]>(ASSETS_IPC.list, filter ?? null),
      get: (id: string) => api.invoke<AssetData | null>(ASSETS_IPC.get, id),
      save: (input: AssetSaveInput) => api.invoke<AssetMeta>(ASSETS_IPC.save, input),
      delete: (id: string) => api.invoke<boolean>(ASSETS_IPC.delete, id),
      thumbnail: async (id: string) => {
        const r = await api.invoke<Uint8Array | ArrayBuffer | null>(ASSETS_IPC.thumbnail, id)
        if (!r) return null
        return r instanceof Uint8Array ? r : new Uint8Array(r)
      }
    }
  }
}

/**
 * Start answering `tools:execute` / `tools:turn` / `tools:cancel` from main, then announce `tools:ready`.
 * Returns a function that stops listening. Call it once, after the registry and session exist.
 */
export function startToolBridge(registry: ToolRegistry, session: EditorSession, services: ToolServices, api: PixelStudioApi = defaultApi()): () => void {
  const host = createToolHost(registry, () => ({ session, services }))
  const inFlight = new Map<string, AbortController>()
  const unsubs: Unsubscribe[] = []

  const reply = (payload: ToolResultPayload): void => {
    void api.invoke(IPC.toolsResult, payload).catch(() => undefined)
  }
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  unsubs.push(
    api.on(IPC.toolsExecute, (raw) => {
      const req = raw as ToolExecuteRequest
      const controller = new AbortController()
      inFlight.set(req.requestId, controller)
      host
        .execute(req.name, req.args, controller.signal)
        .then((result) => reply({ requestId: req.requestId, result }))
        .catch((e: unknown) => reply({ requestId: req.requestId, error: message(e) }))
        .finally(() => inFlight.delete(req.requestId))
    })
  )

  unsubs.push(
    api.on(IPC.toolsTurn, (raw) => {
      const req = raw as ToolTurnRequest
      Promise.resolve()
        .then(() => {
          if (req.action === 'begin') return host.beginTurn(req.label)
          return host.endTurn({ rollback: req.action === 'rollback' })
        })
        .then(() => reply({ requestId: req.requestId }))
        .catch((e: unknown) => reply({ requestId: req.requestId, error: message(e) }))
    })
  )

  unsubs.push(
    api.on(IPC.toolsCancel, (raw) => {
      const req = raw as ToolCancelRequest
      inFlight.get(req.requestId)?.abort()
    })
  )

  void api.invoke(IPC.toolsReady).catch(() => undefined)

  return () => {
    for (const u of unsubs) u()
    for (const c of inFlight.values()) c.abort()
    inFlight.clear()
  }
}
