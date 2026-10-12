import { useSession } from '../hooks/useSession'
import { TOOL_LABELS } from '../lib/keys'
import { fitViewport, stepZoom, zoomAt } from '../lib/viewport'
import { session } from '../state/session'
import { useUi } from '../state/ui'

/** Tool options: brush, mirror, fill/contiguous, grid, zoom and onion skin settings. */
export function OptionsBar() {
  useSession()
  const ui = useUi()
  const onion = session.onion
  const zoomBy = (dir: 1 | -1): void => {
    const { w, h } = ui.viewSize
    ui.setViewport(zoomAt(ui.viewport, stepZoom(ui.viewport.zoom, dir), w / 2, h / 2))
  }
  const sizeTool = ui.tool === 'pencil' || ui.tool === 'eraser' || ui.tool === 'line' || ui.tool === 'rect' || ui.tool === 'ellipse'
  return (
    <div className="optionsbar" data-testid="optionsbar">
      <span className="tool-name">{TOOL_LABELS[ui.tool]}</span>
      {sizeTool && (
        <label className="opt">
          Size
          <input
            type="number"
            min={1}
            max={32}
            value={ui.brushSize}
            onChange={(e) => ui.set({ brushSize: Math.max(1, Math.min(32, Math.floor(Number(e.target.value)) || 1)) })}
          />
        </label>
      )}
      {(ui.tool === 'rect' || ui.tool === 'ellipse') && (
        <label className="opt">
          <input type="checkbox" checked={ui.shapeFilled} onChange={(e) => ui.set({ shapeFilled: e.target.checked })} />
          Filled
        </label>
      )}
      {ui.tool === 'fill' && (
        <label className="opt">
          <input type="checkbox" checked={ui.fillContiguous} onChange={(e) => ui.set({ fillContiguous: e.target.checked })} />
          Contiguous
        </label>
      )}
      <span className="sep" />
      <label className="opt" title="Mirror left/right">
        <input type="checkbox" checked={ui.mirrorX} onChange={(e) => ui.set({ mirrorX: e.target.checked })} data-testid="mirror-x" />
        Mirror X
      </label>
      <label className="opt" title="Mirror top/bottom">
        <input type="checkbox" checked={ui.mirrorY} onChange={(e) => ui.set({ mirrorY: e.target.checked })} data-testid="mirror-y" />
        Mirror Y
      </label>
      <label className="opt">
        <input type="checkbox" checked={ui.showGrid} onChange={(e) => ui.set({ showGrid: e.target.checked })} />
        Grid
      </label>
      <span className="sep" />
      <label className="opt" title="Onion skin: show neighbouring frames">
        <input type="checkbox" checked={onion.enabled} onChange={(e) => session.setOnionSkin({ enabled: e.target.checked })} data-testid="onion-toggle" />
        Onion
      </label>
      {onion.enabled && (
        <>
          <label className="opt" title="Previous frames shown">
            Prev
            <input type="number" min={0} max={8} value={onion.before} onChange={(e) => session.setOnionSkin({ before: Number(e.target.value) })} />
          </label>
          <label className="opt" title="Next frames shown">
            Next
            <input type="number" min={0} max={8} value={onion.after} onChange={(e) => session.setOnionSkin({ after: Number(e.target.value) })} />
          </label>
          <label className="opt" title="Onion opacity">
            Opacity
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(onion.opacity * 100)}
              onChange={(e) => session.setOnionSkin({ opacity: Number(e.target.value) / 100 })}
            />
          </label>
        </>
      )}
      <span className="spacer" />
      <div className="group">
        <button onClick={() => zoomBy(-1)} title="Zoom out (-)">-</button>
        <span className="zoom-readout" data-testid="zoom-readout">{Math.round(ui.viewport.zoom * 100)}%</span>
        <button onClick={() => zoomBy(1)} title="Zoom in (+)">+</button>
        <button
          onClick={() => ui.setViewport(fitViewport(ui.viewSize.w, ui.viewSize.h, session.doc.width, session.doc.height))}
          title="Fit to window (0)"
        >
          Fit
        </button>
      </div>
    </div>
  )
}
