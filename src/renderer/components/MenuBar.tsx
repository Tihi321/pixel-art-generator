import { useSession } from '../hooks/useSession'
import { redo, saveProject, undo } from '../state/actions'
import { session } from '../state/session'
import { useUi } from '../state/ui'

/** File menu as a toolbar row plus the undo history indicator. */
export function MenuBar() {
  useSession()
  const openDialog = useUi((s) => s.openDialog)
  const projectPath = useUi((s) => s.projectPath)
  const status = useUi((s) => s.status)
  const h = session.history
  const doc = session.doc
  return (
    <div className="menubar" data-testid="menubar">
      <span className="app-name">Pixel Studio</span>
      <div className="group">
        <button onClick={() => openDialog('new')} data-testid="btn-new">New</button>
        <button onClick={() => openDialog('open')} data-testid="btn-open">Open</button>
        <button
          onClick={() => (projectPath ? void saveProject() : openDialog('save'))}
          title={projectPath ?? 'Save as .pxs'}
          data-testid="btn-save"
        >
          Save
        </button>
        <button onClick={() => openDialog('save')}>Save As</button>
        <button onClick={() => openDialog('export')} data-testid="btn-export">Export</button>
        <button onClick={() => openDialog('resize')}>Resize</button>
        <button onClick={() => openDialog('settings')} title="Providers, API keys and MCP server (Ctrl+,)" data-testid="btn-settings">Settings...</button>
      </div>
      <div className="group">
        <button onClick={undo} disabled={!session.canUndo()} title={session.undoLabel() ? `Undo ${session.undoLabel()} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} data-testid="btn-undo">
          Undo
        </button>
        <button onClick={redo} disabled={!session.canRedo()} title={session.redoLabel() ? `Redo ${session.redoLabel()} (Ctrl+Y)` : 'Redo (Ctrl+Y)'} data-testid="btn-redo">
          Redo
        </button>
        <span className="history-indicator" data-testid="history-indicator" title="Undo steps / redo steps">
          {h.undoDepth} / {h.redoDepth}
          {session.undoLabel() ? ` - ${session.undoLabel()}` : ''}
        </span>
      </div>
      <span className="doc-info" data-testid="doc-info">
        {doc.name} {doc.width}x{doc.height}
        {projectPath ? '' : ' (unsaved)'}
      </span>
      <span className="status" data-testid="status">{status}</span>
    </div>
  )
}
