import { useState } from 'react'
import { ASSET_KINDS } from '../../shared/assets'
import type { AssetKind } from '../../tools'
import { useSession } from '../hooks/useSession'
import { type SaveSource, saveAsAsset } from '../state/assetActions'
import { session } from '../state/session'
import { useUi } from '../state/ui'
import { Modal } from './Controls'

export function SaveAssetDialog() {
  useSession()
  const close = () => useUi.getState().openDialog(null)
  const sel = session.selection
  const [source, setSource] = useState<SaveSource>(sel ? 'selection' : 'document')
  const [name, setName] = useState(session.doc.name === 'Untitled' ? '' : session.doc.name)
  const [kind, setKind] = useState<AssetKind>('character')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [trim, setTrim] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const doc = session.doc
  return (
    <Modal title="Save as asset" onClose={close} testId="dialog-save-asset">
      <div className="form">
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value as SaveSource)} data-testid="asset-source">
            <option value="document">Whole document ({doc.frames.length} {doc.frames.length === 1 ? 'frame' : 'frames'})</option>
            <option value="layer">Active layer "{session.activeLayer.name}"</option>
            <option value="frame">Current frame ({session.activeFrameIndex})</option>
            <option value="selection" disabled={!sel}>
              Selection{sel ? ` (${sel.w}x${sel.h})` : ' (none)'}
            </option>
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="knight" data-testid="asset-name" autoFocus />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} data-testid="asset-kind-select">
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tags
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fantasy, 16x16 (comma separated)" data-testid="asset-tags" />
        </label>
        <label className="notes-field">
          Style notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Outline, shading, proportions, mood... The agent reads this when the asset is a style reference."
            data-testid="asset-notes"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
          Crop to the visible pixels
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!name.trim() || busy}
          data-testid="asset-save-confirm"
          onClick={() => {
            setBusy(true)
            setError('')
            void saveAsAsset({ source, name, kind, tags, notes, trim }).then((ok) => {
              setBusy(false)
              if (ok) close()
              else setError(useUi.getState().status)
            })
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}
