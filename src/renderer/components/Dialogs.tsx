import { useState } from 'react'
import { ANCHORS, type Anchor, MAX_DIMENSION, listBuiltinPalettes } from '../../core'
import { useSession } from '../hooks/useSession'
import { newDocument, openProjectFromPath, openProjectText, resizeCanvas, saveProject } from '../state/actions'
import { session } from '../state/session'
import { useUi } from '../state/ui'
import { Modal } from './Controls'

function dim(v: string): number {
  return Math.max(1, Math.min(MAX_DIMENSION, Math.floor(Number(v)) || 1))
}

export function NewDocumentDialog() {
  const close = () => useUi.getState().openDialog(null)
  const [name, setName] = useState('Untitled')
  const [w, setW] = useState('32')
  const [h, setH] = useState('32')
  const [pal, setPal] = useState('pico-8')
  const presets = listBuiltinPalettes()
  return (
    <Modal title="New document" onClose={close} testId="dialog-new">
      <div className="form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="new-name" />
        </label>
        <label>
          Width
          <input type="number" min={1} max={MAX_DIMENSION} value={w} onChange={(e) => setW(e.target.value)} data-testid="new-width" />
        </label>
        <label>
          Height
          <input type="number" min={1} max={MAX_DIMENSION} value={h} onChange={(e) => setH(e.target.value)} data-testid="new-height" />
        </label>
        <label>
          Palette
          <select value={pal} onChange={(e) => setPal(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.size})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">The current document and its undo history are discarded.</p>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          data-testid="new-create"
          onClick={() => {
            if (newDocument({ name: name.trim() || 'Untitled', width: dim(w), height: dim(h), paletteId: pal })) close()
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  )
}

export function OpenDialog() {
  const close = () => useUi.getState().openDialog(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Open project" onClose={close} testId="dialog-open">
      <div className="form">
        <label className="file-btn block">
          Browse for a .pxs file...
          <input
            type="file"
            accept=".pxs,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              void f.text().then((text) => {
                if (openProjectText(text, null)) close()
              })
            }}
          />
        </label>
        <label>
          Or file name / full path
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-sprite.pxs (looked up in ~/PixelStudio/projects)" data-testid="open-name" />
        </label>
      </div>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!name.trim() || busy}
          onClick={() => {
            setBusy(true)
            void openProjectFromPath(name.trim()).then((ok) => {
              setBusy(false)
              if (ok) close()
            })
          }}
        >
          Open
        </button>
      </div>
    </Modal>
  )
}

export function SaveDialog() {
  useSession()
  const close = () => useUi.getState().openDialog(null)
  const [name, setName] = useState(session.doc.name)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Save project" onClose={close} testId="dialog-save">
      <div className="form">
        <label>
          File name / full path
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="save-name" />
        </label>
      </div>
      <p className="hint">Relative names are saved in ~/PixelStudio/projects as .pxs.</p>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={!name.trim() || busy}
          data-testid="save-confirm"
          onClick={() => {
            setBusy(true)
            void saveProject(name.trim()).then((ok) => {
              setBusy(false)
              if (ok) close()
            })
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}

export function ResizeDialog() {
  const close = () => useUi.getState().openDialog(null)
  const doc = session.doc
  const [w, setW] = useState(String(doc.width))
  const [h, setH] = useState(String(doc.height))
  const [anchor, setAnchor] = useState<Anchor>('top-left')
  return (
    <Modal title="Resize canvas" onClose={close} testId="dialog-resize">
      <div className="form">
        <label>
          Width
          <input type="number" min={1} max={MAX_DIMENSION} value={w} onChange={(e) => setW(e.target.value)} data-testid="resize-width" />
        </label>
        <label>
          Height
          <input type="number" min={1} max={MAX_DIMENSION} value={h} onChange={(e) => setH(e.target.value)} data-testid="resize-height" />
        </label>
        <div className="anchor-field">
          <span>Anchor</span>
          <div className="anchor-grid">
            {ANCHORS.map((a) => (
              <button key={a} className={a === anchor ? 'active' : ''} title={a} onClick={() => setAnchor(a)} aria-pressed={a === anchor} />
            ))}
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          data-testid="resize-confirm"
          onClick={() => {
            if (resizeCanvas(dim(w), dim(h), anchor)) close()
          }}
        >
          Resize
        </button>
      </div>
    </Modal>
  )
}
