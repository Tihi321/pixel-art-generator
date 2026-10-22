import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type NodeServices, createNodeServices, defaultRoot, registerServices } from './services'
import { ToolBridge } from './toolBridge'
import { replayNotice, startMcp } from './mcpApp'
import { type EngineLock, readLiveLock } from './engineLock'
import { type EngineChoice, choiceFromEnv, handoverDir, openArgsFor, requestHandover, waitForPortFree } from './takeover'
import { loadMcpSettings } from './mcpSettings'
import { registerAgentIpc } from './agentIpc'
import { AssetStore } from './assets'
import { startAssets } from './assetsApp'
import { type CliArgs, openDocumentArgs, parseCli } from './cli'
import { startHeadless } from './headless'
import { decodeImage, disposeImageDecoder } from './imageDecode'
import { DEFAULT_MCP_PORT } from '../shared/mcp'
import type { ToolServices } from '../tools/services'

const cli: CliArgs = parseCli(process.argv.slice(1))

/** The tool bridge to the renderer's live document. Phase 4 (agent runner, MCP server) uses it as its ToolHost. */
const toolBridge = new ToolBridge()
let services: NodeServices | null = null
let mainWindow: BrowserWindow | null = null

export function getToolBridge(): ToolBridge {
  return toolBridge
}

export function getServices(): NodeServices | null {
  return services
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Pixel Studio',
    backgroundColor: '#14161c',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => replayNotice(win))

  // The renderer reports `tools:ready` again after every (re)load; until then calls wait.
  toolBridge.setTarget(win.webContents)
  win.webContents.on('did-start-loading', () => toolBridge.setTarget(win.webContents))
  win.on('closed', () => {
    toolBridge.setTarget(null)
    disposeImageDecoder() // the hidden decoder window would keep the app from seeing window-all-closed
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  mainWindow = win
  return win
}

/** `--open <path>`: opens the document through the same tool as MCP's open_document (a new tab). */
function openInWindow(args: CliArgs): void {
  const toolArgs = openDocumentArgs(args)
  if (!toolArgs) return
  void toolBridge.execute('open_document', toolArgs).then((r) => {
    if (r.isError) console.warn(`[open] ${r.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ')}`)
  })
}

/** The text of a tool result (for logs). */
const resultText = (r: { content: Array<{ type: string; text?: string }> }): string => r.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ')

/** Opens what a headless engine handed over as tabs (same project paths, export targets, unsaved ones stay unsaved). */
async function openHandedOver(docs: Array<Parameters<typeof openArgsFor>[0]>): Promise<void> {
  let currentId: string | null = null
  let failed = false
  for (const d of docs) {
    const r = await toolBridge.execute('open_document', openArgsFor(d))
    if (r.isError) {
      failed = true
      console.warn(`[takeover] ${resultText(r)}`)
      continue
    }
    if (d.current) {
      const last = r.content[r.content.length - 1]
      try {
        currentId = (JSON.parse(last?.type === 'text' ? last.text : '{}') as { documentId?: string }).documentId ?? null
      } catch {
        currentId = null
      }
    }
  }
  if (currentId) await toolBridge.execute('select_document', { document: currentId })
  const dir = handoverDir(docs)
  if (dir && !failed) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await rmdir(dirname(dir)).catch(() => undefined) // the handover folder itself, when nothing else is in it
  }
}

/** Which way to go when the headless engine already serves MCP: the dialog, or PIXEL_STUDIO_ENGINE_CHOICE. */
async function askEngineChoice(lock: EngineLock): Promise<EngineChoice> {
  const preset = choiceFromEnv()
  if (preset) return preset
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Pixel Studio',
    message: `The headless engine (pid ${lock.pid}) is already running and serves MCP on ${lock.url}.`,
    detail:
      'Take over: the engine hands its open documents to this window and exits; this window then serves MCP on the same address (clients keep working, document ids become tab ids).\n\n' +
      'Open without MCP: this window runs, MCP stays with the headless engine.',
    buttons: ['Take over (recommended)', 'Open without MCP', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return response === 0 ? 'takeover' : response === 1 ? 'without-mcp' : 'quit'
}

interface EngineStart {
  /** Set: MCP stays off this run and Settings shows this. */
  blocked?: string
  handed?: Parameters<typeof openArgsFor>[0][]
  /** Take over: serve MCP on the old engine's port this run. */
  port?: number
  quit?: boolean
}

/** A live headless engine holds engine.lock: let the user decide before the window's MCP tries the same port. */
async function resolveHeadlessEngine(): Promise<EngineStart> {
  const lock = readLiveLock(defaultRoot())
  if (!lock || lock.mode !== 'headless') return {}
  const without = (why = ''): EngineStart => ({ blocked: `Pixel Studio headless (pid ${lock.pid}) serves MCP on ${lock.url}${why}` })
  const choice = await askEngineChoice(lock)
  if (choice === 'quit') return { quit: true }
  if (choice === 'without-mcp') return without()
  const token = process.env['PIXEL_STUDIO_MCP_TOKEN']?.trim() || (await loadMcpSettings()).token
  const r = await requestHandover(lock, token)
  if (!r.ok) return without(` (taking over failed: ${r.reason})`)
  await waitForPortFree(lock.port)
  return { handed: r.documents, port: lock.port }
}

/** Headless: the MCP server with no window; the tools run in this process. */
async function runHeadless(): Promise<void> {
  const port = cli.port ?? (Number(process.env['PIXEL_STUDIO_MCP_PORT']) || DEFAULT_MCP_PORT)
  const base = createNodeServices()
  const headlessServices: ToolServices = { ...base, assets: new AssetStore(), decodeImage }
  const h = await startHeadless({
    port,
    services: headlessServices,
    token: process.env['PIXEL_STUDIO_MCP_TOKEN']?.trim() || null,
    log: (m) => console.warn(`[mcp] ${m}`),
    lockRoot: defaultRoot(),
    version: app.getVersion(),
    onHandover: () => app.exit(0) // a window took the documents over
  })
  if (!h.url) {
    console.error(`MCP server could not start: ${h.error ?? 'unknown error'}`)
    app.exit(1)
    return
  }
  console.log(`MCP listening on ${h.url}`)
  const shutdown = (): void => {
    void h.stop().finally(() => app.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  app.on('before-quit', () => void h.stop())
}

if (cli.mcpOnly) {
  // No single-instance lock and no window. A separate user-data folder keeps Chromium's caches apart
  // from a window instance that may run at the same time.
  app.setPath('userData', `${app.getPath('userData')}-headless`)
  app.on('window-all-closed', () => undefined)
  void app.whenReady().then(() => runHeadless())
} else {
  if (!app.requestSingleInstanceLock()) {
    // Another window instance is running: it receives our command line (second-instance) and opens --open.
    app.quit()
  } else {
    app.on('second-instance', (_e, argv, workingDirectory) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
      openInWindow(parseCli(argv.slice(1), workingDirectory))
    })

    void app.whenReady().then(async () => {
      services = registerServices(ipcMain, { ...createNodeServices(), decodeImage })
      toolBridge.registerIpc(ipcMain)
      const engine = await resolveHeadlessEngine()
      if (engine.quit) {
        app.quit()
        return
      }
      startMcp(toolBridge, { blocked: engine.blocked, port: engine.port })
      registerAgentIpc(ipcMain, toolBridge)
      startAssets()
      createWindow()
      if (engine.handed?.length) await openHandedOver(engine.handed)
      openInWindow(cli)
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })

    app.on('before-quit', () => toolBridge.dispose())

    app.on('window-all-closed', () => {
      app.quit()
    })
  }
}
