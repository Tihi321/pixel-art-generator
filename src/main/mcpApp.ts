// Electron glue for the MCP server: registers the MCP IPC handlers, starts the server with the ToolBridge
// as host, and pushes status to the windows. Kept out of index.ts so that file only gets one call.
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { McpStatus } from '../shared/mcp'
import { acquireLock, releaseLock } from './engineLock'
import { defaultRoot } from './services'
import type { ToolBridge } from './toolBridge'
import { type McpController, registerMcp } from './mcpSettings'

/** Absolute path of the stdio shim (the build output next to the app; no asar, see electron-builder.yml). */
export function shimPath(): string {
  return join(app.getAppPath(), 'out', 'mcp-stdio', 'index.js')
}

let lastNotice: string | null = null

/** A line for the renderer's status bar (kept, so a window that loads later gets it too: see replayNotice). */
function notice(text: string): void {
  lastNotice = text
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.appNotice, text)
}

export function replayNotice(win: BrowserWindow): void {
  if (lastNotice) win.webContents.send(IPC.appNotice, lastNotice)
}

/**
 * Starts the MCP server. `blocked` keeps it off this run (another engine serves MCP: see index.ts); `port` forces the port for this run (take-over). While it runs
 * this process owns engine.lock; a bind failure (or the blocked note) also goes to the status bar.
 */
export function startMcp(bridge: ToolBridge, opts: { blocked?: string; port?: number } = {}): McpController {
  let lockedUrl: string | null = null
  let lastError: string | undefined
  const syncStatus = (st: McpStatus): void => {
    if (st.running && st.url) {
      if (lockedUrl !== st.url) {
        const r = acquireLock(defaultRoot(), { pid: process.pid, mode: 'window', port: Number(new URL(st.url).port), url: st.url, startedAt: new Date().toISOString(), version: app.getVersion() })
        if (r.ok) lockedUrl = st.url
      }
    } else if (lockedUrl) {
      releaseLock(defaultRoot(), process.pid)
      lockedUrl = null
    }
    if (st.error !== lastError) {
      lastError = st.error
      if (st.error) notice(`MCP is off: ${st.error}`)
    }
  }
  const controller = registerMcp(ipcMain, bridge, {
    shimPath: shimPath(),
    blocked: opts.blocked,
    port: opts.port,
    send: (channel, state) => {
      syncStatus(state.status)
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, state)
    },
    log: (m) => console.warn(`[mcp] ${m}`)
  })
  void controller.start()
  app.on('before-quit', () => {
    void controller.stop()
    releaseLock(defaultRoot(), process.pid)
  })
  return controller
}
