import { useEffect, useMemo, useRef, useState } from 'react'
import { type SheetLayout, type SheetMetaFormat, buildSpriteSheet } from '../../core'
import { useSession } from '../hooks/useSession'
import { DEFAULT_EXPORT, type ExportKind, type ExportSettings, planExport } from '../lib/exporter'
import { writeExportFiles } from '../lib/files'
import { session } from '../state/session'
import { useUi } from '../state/ui'
import { Modal } from './Controls'

const LAYOUTS: SheetLayout[] = ['horizontal', 'vertical', 'grid', 'packed']
const META: Array<{ id: SheetMetaFormat; label: string }> = [
  { id: 'aseprite-array', label: 'Aseprite (array)' },
  { id: 'aseprite-hash', label: 'Aseprite (hash)' },
  { id: 'texturepacker', label: 'TexturePacker (hash)' }
]

function SheetPreview({ settings }: { settings: ExportSettings }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const info = useMemo(() => {
    try {
      const sheet = buildSpriteSheet(session.doc, {
        layout: settings.layout,
        columns: settings.layout === 'grid' && settings.columns > 0 ? settings.columns : undefined,
        scale: Math.max(1, Math.floor(settings.scale) || 1),
        padding: Math.max(0, Math.floor(settings.padding) || 0),
        tags: settings.tag ? [settings.tag] : undefined
      })
      return { sheet, error: null as string | null }
    } catch (e) {
      return { sheet: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [settings.layout, settings.columns, settings.scale, settings.padding, settings.tag])

  useEffect(() => {
    const c = ref.current
    const sheet = info.sheet
    if (!c || !sheet) return
    c.width = sheet.width
    c.height = sheet.height
    const ctx = c.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(sheet.data.buffer as ArrayBuffer, sheet.data.byteOffset, sheet.data.byteLength), sheet.width, sheet.height), 0, 0)
  }, [info])

  if (info.error) return <p className="error">{info.error}</p>
  return (
    <div className="sheet-preview">
      <div className="hint" data-testid="sheet-info">
        {info.sheet!.width} x {info.sheet!.height} px, {info.sheet!.frames.length} frame(s)
      </div>
      <div className="preview-box">
        <canvas ref={ref} />
      </div>
    </div>
  )
}

export function ExportDialog() {
  useSession()
  const close = () => useUi.getState().openDialog(null)
  const doc = session.doc
  const [s, setS] = useState<ExportSettings>({ ...DEFAULT_EXPORT, baseName: doc.name })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const patch = (p: Partial<ExportSettings>): void => {
    setS((cur) => ({ ...cur, ...p }))
    setResult(null)
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const files = planExport(session.doc, s, session.activeFrameIndex)
      const paths = await writeExportFiles(files, s.dir)
      setResult({ ok: true, text: `Exported:\n${paths.join('\n')}` })
      useUi.getState().setStatus(`Exported ${paths.length} file(s)`)
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const tagSelect = (
    <label>
      Tag
      <select value={s.tag} onChange={(e) => patch({ tag: e.target.value })} data-testid="export-tag">
        <option value="">All frames</option>
        {doc.tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.from}-{t.to})
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <Modal title="Export" onClose={close} testId="dialog-export" wide>
      <div className="tabs" role="tablist">
        {(['sheet', 'png', 'gif'] as ExportKind[]).map((k) => (
          <button key={k} role="tab" aria-selected={s.kind === k} className={s.kind === k ? 'active' : ''} onClick={() => patch({ kind: k })} data-testid={`export-tab-${k}`}>
            {k === 'sheet' ? 'Sprite sheet' : k.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="export-body">
        <div className="form">
          <label>
            File name
            <input value={s.baseName} onChange={(e) => patch({ baseName: e.target.value })} data-testid="export-name" />
          </label>
          <label>
            Folder
            <input value={s.dir} onChange={(e) => patch({ dir: e.target.value })} placeholder="default: ~/PixelStudio/exports" />
          </label>
          <label>
            Scale
            <input type="number" min={1} max={64} value={s.scale} onChange={(e) => patch({ scale: Number(e.target.value) || 1 })} data-testid="export-scale" />
          </label>
          {s.kind === 'png' && (
            <label>
              Frames
              <select value={s.pngScope} onChange={(e) => patch({ pngScope: e.target.value as 'current' | 'all' })} data-testid="export-png-scope">
                <option value="current">Current frame</option>
                <option value="all">All frames (one file each)</option>
              </select>
            </label>
          )}
          {s.kind === 'sheet' && (
            <>
              <label>
                Layout
                <select value={s.layout} onChange={(e) => patch({ layout: e.target.value as SheetLayout })} data-testid="export-layout">
                  {LAYOUTS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {s.layout === 'grid' && (
                <label>
                  Columns (0 = auto)
                  <input type="number" min={0} max={256} value={s.columns} onChange={(e) => patch({ columns: Number(e.target.value) || 0 })} />
                </label>
              )}
              <label>
                Padding
                <input type="number" min={0} max={256} value={s.padding} onChange={(e) => patch({ padding: Number(e.target.value) || 0 })} />
              </label>
              {tagSelect}
              <label>
                Metadata
                <select value={s.metaFormat} onChange={(e) => patch({ metaFormat: e.target.value as SheetMetaFormat })} data-testid="export-meta">
                  {META.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {s.kind === 'gif' && (
            <>
              {tagSelect}
              <label className="check">
                <input type="checkbox" checked={s.gifLoop} onChange={(e) => patch({ gifLoop: e.target.checked })} />
                Loop forever
              </label>
            </>
          )}
        </div>
        {s.kind === 'sheet' && <SheetPreview settings={s} />}
      </div>
      {result && (
        <pre className={result.ok ? 'result ok' : 'result error'} data-testid="export-result">
          {result.text}
        </pre>
      )}
      <div className="modal-actions">
        <button onClick={close}>Close</button>
        <button className="primary" disabled={busy} onClick={() => void run()} data-testid="export-run">
          {busy ? 'Exporting...' : 'Export'}
        </button>
      </div>
    </Modal>
  )
}
