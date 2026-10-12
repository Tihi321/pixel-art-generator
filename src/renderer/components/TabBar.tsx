import { useSession } from '../hooks/useSession'
import { closeTab, switchTab } from '../state/actions'
import { useChat } from '../state/chat'
import { workspace } from '../state/session'
import { useUi } from '../state/ui'

/** The open documents: click to switch, x (or middle click) to close, + for a new document. */
export function TabBar() {
  useSession()
  const openDialog = useUi((s) => s.openDialog)
  const show = (id: string): void => {
    if (id === workspace.activeId) return
    switchTab(id)
    // "Undo agent turn" belongs to the tab the turn ran in
    if (workspace.activeId === id) useChat.setState({ turn: null })
  }
  return (
    <div className="doc-tabs" role="tablist" data-testid="doc-tabs">
      {workspace.tabs.map((t) => {
        const active = t.id === workspace.activeId
        const dirty = workspace.isDirty(t)
        const doc = t.session.doc
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            className={`doc-tab${active ? ' active' : ''}`}
            title={`${t.projectPath ?? `${doc.name} (not saved yet)`} - ${doc.width}x${doc.height}${t.session.turnActive ? ' - the agent is working here' : ''}`}
            onClick={() => show(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(t.id)
            }}
            data-testid="doc-tab"
          >
            <span className="doc-tab-name">{doc.name}</span>
            {dirty && <span className="doc-tab-dirty" title="Unsaved changes">●</span>}
            <button
              className="doc-tab-close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
              data-testid="doc-tab-close"
            >
              ×
            </button>
          </div>
        )
      })}
      <button className="doc-tab-new" title="New document" onClick={() => openDialog('new')} data-testid="doc-tab-new">
        +
      </button>
    </div>
  )
}
