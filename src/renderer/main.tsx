import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { session } from './state/session'
import { createDefaultRegistry } from '../tools'
import { createIpcServices, startToolBridge } from './toolBridgeClient'
import './styles.css'

// The tool bridge drives the same EditorSession the UI edits, so LLM/MCP edits and manual edits
// share one undo history.
if (window.pixelStudio) startToolBridge(createDefaultRegistry(), session, createIpcServices())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
