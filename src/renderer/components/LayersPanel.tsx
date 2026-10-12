import { useState } from 'react'
import { BLEND_MODES, type BlendMode } from '../../core'
import { useSession } from '../hooks/useSession'
import { addLayer, deleteLayer, duplicateLayer, mergeLayerDown, moveLayer, updateLayer } from '../state/actions'
import { session } from '../state/session'
import { CommitSlider } from './Controls'

export function LayersPanel() {
  useSession()
  const doc = session.doc
  const active = session.activeLayer
  const activeIdx = session.activeLayerIndex
  const [editing, setEditing] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const rows = [...doc.layers].reverse()

  return (
    <section className="panel layers-panel" data-testid="layers-panel">
      <header className="panel-head">
        <span className="label">Layers</span>
        <span className="spacer" />
        <button title="Add layer" onClick={addLayer} data-testid="layer-add">+</button>
        <button title="Duplicate layer" onClick={() => duplicateLayer(active.id)}>Dup</button>
        <button title="Merge down" disabled={activeIdx === 0} onClick={() => mergeLayerDown(active.id)}>Merge</button>
        <button title="Move up" disabled={activeIdx >= doc.layers.length - 1} onClick={() => moveLayer(active.id, activeIdx + 1)}>Up</button>
        <button title="Move down" disabled={activeIdx === 0} onClick={() => moveLayer(active.id, activeIdx - 1)}>Down</button>
        <button title="Delete layer" disabled={doc.layers.length <= 1} onClick={() => deleteLayer(active.id)} data-testid="layer-delete">Del</button>
      </header>
      <div className="layer-list">
        {rows.map((l) => {
          const index = doc.layers.indexOf(l)
          return (
            <div
              key={l.id}
              className={`layer-row${l.id === active.id ? ' active' : ''}${overId === l.id && dragId !== l.id ? ' drop' : ''}`}
              data-testid="layer-row"
              draggable={editing !== l.id}
              onDragStart={(e) => {
                setDragId(l.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', l.id)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                setOverId(l.id)
              }}
              onDragLeave={() => setOverId((o) => (o === l.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== l.id) moveLayer(dragId, index)
                setDragId(null)
                setOverId(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onClick={() => session.setActiveLayer(l.id)}
            >
              <button
                className={`icon-toggle${l.visible ? ' on' : ''}`}
                title={l.visible ? 'Hide layer' : 'Show layer'}
                aria-pressed={l.visible}
                onClick={(e) => {
                  e.stopPropagation()
                  updateLayer(l.id, { visible: !l.visible })
                }}
              >
                {l.visible ? 'V' : '-'}
              </button>
              <button
                className={`icon-toggle${l.locked ? ' on lock' : ''}`}
                title={l.locked ? 'Unlock layer' : 'Lock layer'}
                aria-pressed={l.locked}
                onClick={(e) => {
                  e.stopPropagation()
                  updateLayer(l.id, { locked: !l.locked })
                }}
              >
                {l.locked ? 'L' : '-'}
              </button>
              {editing === l.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    setEditing(null)
                    if (v && v !== l.name) updateLayer(l.id, { name: v })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <span className="layer-name" onDoubleClick={() => setEditing(l.id)} title="Double-click to rename">
                  {l.name}
                </span>
              )}
              {l.kind === 'reference' && <span className="badge">ref</span>}
            </div>
          )
        })}
      </div>
      <div className="layer-props">
        <label>
          Opacity
          <CommitSlider
            label="Layer opacity"
            testId="layer-opacity"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onCommit={(v) => updateLayer(active.id, { opacity: v / 100 })}
          />
          <span className="val">{Math.round(active.opacity * 100)}</span>
        </label>
        <label>
          Blend
          <select value={active.blend} onChange={(e) => updateLayer(active.id, { blend: e.target.value as BlendMode })} data-testid="layer-blend">
            {BLEND_MODES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
