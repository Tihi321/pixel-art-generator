import { useEffect } from 'react'
import { CanvasView } from './components/CanvasView'
import { NewDocumentDialog, OpenDialog, ResizeDialog, SaveDialog } from './components/Dialogs'
import { AssetsPanel } from './components/AssetsPanel'
import { ChatPanel } from './components/ChatPanel'
import { ExportDialog } from './components/ExportDialog'
import { LayersPanel } from './components/LayersPanel'
import { MenuBar } from './components/MenuBar'
import { OptionsBar } from './components/OptionsBar'
import { PalettePanel } from './components/PalettePanel'
import { SaveAssetDialog } from './components/SaveAssetDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { TabBar } from './components/TabBar'
import { Timeline } from './components/Timeline'
import { Toolbar } from './components/Toolbar'
import { usePlayback } from './hooks/usePlayback'
import { useShortcuts } from './hooks/useShortcuts'
import { initChat, useChat } from './state/chat'
import { useUi } from './state/ui'

export function App() {
  useShortcuts()
  usePlayback()
  const dialog = useUi((s) => s.dialog)
  const panelTab = useUi((s) => s.panelTab)
  const setUi = useUi((s) => s.set)
  const chatRunning = useChat((s) => s.running)
  useEffect(() => initChat(), [])
  return (
    <div className="shell">
      <header className="region menu">
        <MenuBar />
      </header>
      <div className="region options">
        <OptionsBar />
      </div>
      <aside className="region toolbar" data-testid="toolbar">
        <Toolbar />
      </aside>
      <div className="region tabs">
        <TabBar />
      </div>
      <main className="region canvas" data-testid="canvas">
        <CanvasView />
      </main>
      <aside className="region panels" data-testid="panels">
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected={panelTab === 'edit'} className={panelTab === 'edit' ? 'active' : ''} onClick={() => setUi({ panelTab: 'edit' })} data-testid="tab-edit">
            Palette / Layers
          </button>
          <button role="tab" aria-selected={panelTab === 'assets'} className={panelTab === 'assets' ? 'active' : ''} onClick={() => setUi({ panelTab: 'assets' })} data-testid="tab-assets">
            Assets
          </button>
          <button role="tab" aria-selected={panelTab === 'chat'} className={panelTab === 'chat' ? 'active' : ''} onClick={() => setUi({ panelTab: 'chat' })} data-testid="tab-chat">
            Chat{chatRunning ? ' ...' : ''}
          </button>
        </div>
        {/* both stay mounted (hidden) so the chat keeps its state and events while the other tab is shown */}
        <div className="panel-body" hidden={panelTab !== 'edit'}>
          <PalettePanel />
          <LayersPanel />
        </div>
        <div className="panel-body" hidden={panelTab !== 'assets'}>
          <AssetsPanel />
        </div>
        <div className="panel-body" hidden={panelTab !== 'chat'}>
          <ChatPanel />
        </div>
      </aside>
      <footer className="region timeline" data-testid="timeline">
        <Timeline />
      </footer>
      {dialog === 'new' && <NewDocumentDialog />}
      {dialog === 'open' && <OpenDialog />}
      {dialog === 'save' && <SaveDialog />}
      {dialog === 'resize' && <ResizeDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'saveAsset' && <SaveAssetDialog />}
    </div>
  )
}
