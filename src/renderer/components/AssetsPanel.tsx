import { useMemo, useState } from 'react'
import { ASSET_KINDS } from '../../shared/assets'
import type { AssetKind, AssetMeta } from '../../tools'
import { useAssets } from '../hooks/useAssets'
import { useSession } from '../hooks/useSession'
import { uiServices } from '../lib/tools'
import { placeAsset, setReference } from '../state/assetActions'
import { session } from '../state/session'
import { useUi } from '../state/ui'

/** Drag payload type: the asset id. CanvasView accepts it. */
export const ASSET_DRAG_TYPE = 'application/x-pixel-studio-asset'

function matches(a: AssetMeta, kind: AssetKind | '', query: string): boolean {
  if (kind && a.kind !== kind) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  // every word must match the name or one of the tags (so "fantasy knight" works)
  return q.split(/\s+/).every((w) => a.name.toLowerCase().includes(w) || a.tags.some((t) => t.includes(w)))
}

function AssetCard({ asset, thumb, isRef, onDelete }: { asset: AssetMeta; thumb?: string; isRef: boolean; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="asset-card" data-testid="asset-card" data-asset-id={asset.id}>
      <div
        className="asset-thumb"
        draggable
        title="Drag onto the canvas to place it"
        onDragStart={(e) => {
          e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
          e.dataTransfer.setData('text/plain', asset.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
      >
        {thumb ? <img src={thumb} alt={asset.name} draggable={false} /> : <span className="hint">no preview</span>}
      </div>
      <div className="asset-info">
        <div className="asset-name" title={asset.name}>
          {asset.name}
        </div>
        <div className="asset-meta">
          <span className="badge">{asset.kind}</span>
          <span>
            {asset.width}x{asset.height}
            {asset.frames > 1 ? `, ${asset.frames}f` : ''}
          </span>
        </div>
        {asset.tags.length > 0 && <div className="asset-tags">{asset.tags.map((t) => `#${t}`).join(' ')}</div>}
        {asset.notes && (
          <div className="asset-notes" title={asset.notes}>
            {asset.notes}
          </div>
        )}
        <div className="asset-actions">
          <button title="Stamp the asset at 0,0 (see the options above)" onClick={() => void placeAsset(asset.id, 0, 0)} data-testid="asset-place">
            Place at 0,0
          </button>
          <label className="asset-ref" title="Use this asset as a style reference for the document and the agent">
            <input type="checkbox" checked={isRef} onChange={(e) => void setReference(asset.id, e.target.checked)} data-testid="asset-ref" />
            Style ref
          </label>
          {confirming ? (
            <span className="asset-confirm">
              Delete?{' '}
              <button
                className="danger"
                onClick={() => {
                  setConfirming(false)
                  onDelete(asset.id)
                }}
                data-testid="asset-delete-yes"
              >
                Yes
              </button>{' '}
              <button onClick={() => setConfirming(false)} data-testid="asset-delete-no">
                No
              </button>
            </span>
          ) : (
            <button title="Delete this asset from the library" onClick={() => setConfirming(true)} data-testid="asset-delete">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function AssetsPanel() {
  useSession()
  const { assets, thumbs, loading, error, reload } = useAssets()
  const [kind, setKind] = useState<AssetKind | ''>('')
  const [query, setQuery] = useState('')
  const newLayer = useUi((s) => s.assetNewLayer)
  const animation = useUi((s) => s.assetAnimation)
  const showRefLayer = useUi((s) => s.assetShowRefLayer)
  const setUi = useUi((s) => s.set)
  const refs = new Set(session.doc.references.map((r) => r.assetId))
  const shown = useMemo(() => assets.filter((a) => matches(a, kind, query)), [assets, kind, query])

  const remove = async (id: string): Promise<void> => {
    try {
      await uiServices().assets!.delete(id)
      useUi.getState().setStatus('Asset deleted')
    } catch (e) {
      useUi.getState().setStatus(e instanceof Error ? e.message : String(e))
    }
    reload()
  }

  return (
    <section className="panel assets-panel" data-testid="assets-panel">
      <header className="panel-head">
        <span className="label">Assets</span>
        <span className="spacer" />
        <button title="Save part of the document in the library" onClick={() => useUi.getState().openDialog('saveAsset')} data-testid="asset-save-open">
          Save as asset...
        </button>
      </header>
      <div className="asset-filters">
        <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind | '')} aria-label="Kind" data-testid="asset-kind">
          <option value="">All kinds</option>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search name or tag" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="asset-search" />
      </div>
      <div className="asset-options">
        <label title="Put placed assets on a new layer">
          <input type="checkbox" checked={newLayer} onChange={(e) => setUi({ assetNewLayer: e.target.checked })} /> New layer
        </label>
        <label title="Copy every animation frame of the asset onto consecutive frames (adds frames when needed)">
          <input type="checkbox" checked={animation} onChange={(e) => setUi({ assetAnimation: e.target.checked })} data-testid="asset-animation" /> Place animation
        </label>
        <label title="Also show style references as a dimmed, locked layer that is never exported">
          <input type="checkbox" checked={showRefLayer} onChange={(e) => setUi({ assetShowRefLayer: e.target.checked })} /> Ref as layer
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!error && loading && <p className="hint">Loading...</p>}
      {!error && !loading && assets.length === 0 && (
        <p className="hint" data-testid="asset-empty">
          The library is empty. Draw something and use "Save as asset...".
        </p>
      )}
      {!error && assets.length > 0 && shown.length === 0 && <p className="hint">No asset matches the filter.</p>}
      <div className="asset-grid" data-testid="asset-grid">
        {shown.map((a) => (
          <AssetCard key={a.id} asset={a} thumb={thumbs[a.id]} isRef={refs.has(a.id)} onDelete={(id) => void remove(id)} />
        ))}
      </div>
    </section>
  )
}
