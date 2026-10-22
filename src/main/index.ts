import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { type NodeServices, createNodeServices, registerServices } from './services'
import { ToolBridge } from './toolBridge'
import { startMcp } from './mcpApp'
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

/** Headless: the MCP server with no window; the tools run in this process. */
async function runHeadless(): Promise<void> {
  const port = cli.port ?? (Number(process.env['PIXEL_STUDIO_MCP_PORT']) || DEFAULT_MCP_PORT)
  const base = createNodeServices()
  const headlessServices: ToolServices = { ...base, assets: new AssetStore(), decodeImage }
  const h = await startHeadless({
    port,
    services: headlessServices,
    token: process.env['PIXEL_STUDIO_MCP_TOKEN']?.trim() || null,
    log: (m) => console.warn(`[mcp] ${m}`)
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

    void app.whenReady().then(() => {
      services = registerServices(ipcMain, { ...createNodeServices(), decodeImage })
      toolBridge.registerIpc(ipcMain)
      startMcp(toolBridge)
      registerAgentIpc(ipcMain, toolBridge)
      startAssets()
      createWindow()
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
