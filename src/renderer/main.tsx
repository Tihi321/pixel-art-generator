import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { workspaceDocuments } from './state/actions'
import { session } from './state/session'
import { createDefaultRegistry } from '../tools'
import { useUi } from './state/ui'
import { IPC } from '../shared/ipc'
import { createIpcServices, startToolBridge } from './toolBridgeClient'
import './styles.css'

// The tool bridge drives the same EditorSession the UI edits, so LLM/MCP edits and manual edits
// share one undo history.
if (window.pixelStudio) startToolBridge(createDefaultRegistry(), session, createIpcServices(), undefined, workspaceDocuments)

// Notices from main (the MCP server is off, and why) show in the status bar.
window.pixelStudio?.on(IPC.appNotice, (text) => useUi.getState().setStatus(String(text)))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
