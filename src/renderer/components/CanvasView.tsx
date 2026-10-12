import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useSession } from '../hooks/useSession'
import { composeFrame, renderOnion } from '../lib/compose'
import { ToolController, type Modifiers, type ToolSettings } from '../lib/toolController'
import {
  type Viewport,
  docToScreen,
  fitViewport,
  gridVisible,
  panBy,
  screenToPixel,
  stepZoom,
  zoomAt
} from '../lib/viewport'
import { placeAsset } from '../state/assetActions'
import { input } from '../state/input'
import { session } from '../state/session'
import { useUi } from '../state/ui'
import { ASSET_DRAG_TYPE } from './AssetsPanel'

function settingsFromUi(): ToolSettings {
  const s = useUi.getState()
  return {
    tool: s.tool,
    brushSize: s.brushSize,
    mirrorX: s.mirrorX,
    mirrorY: s.mirrorY,
    shapeFilled: s.shapeFilled,
    fillContiguous: s.fillContiguous
  }
}

function modsOf(e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean }): Modifiers {
  return { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey }
}

function makeChecker(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#3a3d48'
  g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#2e313b'
  g.fillRect(0, 0, 8, 8)
  g.fillRect(8, 8, 8, 8)
  return c
}

function toImageData(data: Uint32Array, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), w, h)
}

export function CanvasView() {
  const version = useSession()
  const viewport = useUi((s) => s.viewport)
  const showGrid = useUi((s) => s.showGrid)
  const mirrorX = useUi((s) => s.mirrorX)
  const mirrorY = useUi((s) => s.mirrorY)
  const tool = useUi((s) => s.tool)
  const brushSize = useUi((s) => s.brushSize)
  const viewSize = useUi((s) => s.viewSize)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const onionRef = useRef<HTMLCanvasElement | null>(null)
  const checkerRef = useRef<HTMLCanvasElement | null>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; vp: Viewport } | null>(null)
  const rafRef = useRef(0)
  const drawRef = useRef<() => void>(() => undefined)
  const fitKeyRef = useRef('')

  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      drawRef.current()
    })
  }, [])

  const controller = useMemo(() => new ToolController(session, schedule), [schedule])

  // ---- drawing -----------------------------------------------------------------------------

  drawRef.current = () => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = wrap.clientWidth
    const H = wrap.clientHeight
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#14161c'
    ctx.fillRect(0, 0, W, H)

    const ui = useUi.getState()
    const vp = ui.viewport
    const doc = session.doc
    const x0 = vp.panX
    const y0 = vp.panY
    const w = doc.width * vp.zoom
    const h = doc.height * vp.zoom

    // checkerboard transparency
    if (!checkerRef.current) checkerRef.current = makeChecker()
    const pattern = ctx.createPattern(checkerRef.current, 'repeat')
    if (pattern) {
      ctx.save()
      ctx.translate(x0, y0)
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }

    // onion skin (under the current frame)
    if (session.onion.enabled) {
      if (!onionRef.current) onionRef.current = document.createElement('canvas')
      const oc = onionRef.current
      oc.width = doc.width
      oc.height = doc.height
      const octx = oc.getContext('2d')!
      for (const o of renderOnion(doc, session.activeFrame.id, session.onion)) {
        octx.clearRect(0, 0, oc.width, oc.height)
        octx.putImageData(toImageData(o.data, doc.width, doc.height), 0, 0)
        ctx.globalAlpha = o.alpha
        ctx.drawImage(oc, x0, y0, w, h)
      }
      ctx.globalAlpha = 1
    }

    // composited current frame (with the live gesture preview)
    if (!offRef.current) offRef.current = document.createElement('canvas')
    const off = offRef.current
    off.width = doc.width
    off.height = doc.height
    const data = composeFrame(doc, session.activeFrame.id, controller.preview)
    off.getContext('2d')!.putImageData(toImageData(data, doc.width, doc.height), 0, 0)
    ctx.drawImage(off, x0, y0, w, h)

    // pixel grid
    if (ui.showGrid && gridVisible(vp.zoom)) {
      ctx.strokeStyle = 'rgba(190,198,220,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      const i0 = Math.max(0, Math.floor(-x0 / vp.zoom))
      const i1 = Math.min(doc.width, Math.ceil((W - x0) / vp.zoom))
      for (let i = i0; i <= i1; i++) {
        const x = Math.round(x0 + i * vp.zoom) + 0.5
        ctx.moveTo(x, Math.max(0, y0))
        ctx.lineTo(x, Math.min(H, y0 + h))
      }
      const j0 = Math.max(0, Math.floor(-y0 / vp.zoom))
      const j1 = Math.min(doc.height, Math.ceil((H - y0) / vp.zoom))
      for (let j = j0; j <= j1; j++) {
        const y = Math.round(y0 + j * vp.zoom) + 0.5
        ctx.moveTo(Math.max(0, x0), y)
        ctx.lineTo(Math.min(W, x0 + w), y)
      }
      ctx.stroke()
    }

    // document border
    ctx.strokeStyle = '#5a6074'
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x0) - 0.5, Math.round(y0) - 0.5, w + 1, h + 1)

    // mirror axes
    ctx.strokeStyle = 'rgba(80,220,220,0.8)'
    ctx.setLineDash([4, 4])
    if (ui.mirrorX) {
      ctx.beginPath()
      ctx.moveTo(x0 + w / 2, y0 - 6)
      ctx.lineTo(x0 + w / 2, y0 + h + 6)
      ctx.stroke()
    }
    if (ui.mirrorY) {
      ctx.beginPath()
      ctx.moveTo(x0 - 6, y0 + h / 2)
      ctx.lineTo(x0 + w + 6, y0 + h / 2)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // selection marquee
    const sel = controller.preview?.selection ?? session.selection
    if (sel) {
      const p = docToScreen(vp, sel.x, sel.y)
      const rx = Math.round(p.x) + 0.5
      const ry = Math.round(p.y) + 0.5
      const rw = Math.round(sel.w * vp.zoom)
      const rh = Math.round(sel.h * vp.zoom)
      ctx.lineWidth = 1
      ctx.strokeStyle = '#000'
      ctx.setLineDash([])
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.strokeStyle = '#fff'
      ctx.setLineDash([4, 4])
      ctx.lineDashOffset = (performance.now() / 120) % 8
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
    }

    // brush cursor
    const hv = hoverRef.current
    if (hv && !panRef.current && !input.space) {
      const size = ui.tool === 'pencil' || ui.tool === 'eraser' ? ui.brushSize : 1
      const off0 = -Math.floor((size - 1) / 2)
      const p = docToScreen(vp, hv.x + off0, hv.y + off0)
      ctx.save()
      ctx.globalCompositeOperation = 'difference'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.max(1, size * vp.zoom - 1), Math.max(1, size * vp.zoom - 1))
      ctx.restore()
    }
  }

  // Redraw whenever the document/session or any visual setting changes.
  useEffect(() => {
    schedule()
  }, [schedule, version, viewport, showGrid, mirrorX, mirrorY, tool, brushSize, viewSize])

  // Keep the marching ants alive while a selection exists.
  useEffect(() => {
    if (!session.selection) return
    const t = window.setInterval(schedule, 160)
    return () => window.clearInterval(t)
  }, [schedule, version])

  // ---- size tracking and fit -------------------------------------------------------------------

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const update = (): void => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const cur = useUi.getState().viewSize
      if (cur.w !== w || cur.h !== h) useUi.getState().set({ viewSize: { w, h } })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // Fit when the view size first becomes known and whenever the document is replaced or resized.
  const docKey = `${session.doc.id}:${session.doc.width}x${session.doc.height}`
  useEffect(() => {
    if (viewSize.w < 10 || viewSize.h < 10) return
    if (fitKeyRef.current === docKey) return
    fitKeyRef.current = docKey
    useUi.getState().setViewport(fitViewport(viewSize.w, viewSize.h, session.doc.width, session.doc.height))
  }, [docKey, viewSize])

  // ---- debug hook (read-only access for tests) -------------------------------------------------

  useEffect(() => {
    window.__pixelStudio = {
      session,
      ui: useUi,
      pixelToPage: (x, y) => {
        const rect = canvasRef.current!.getBoundingClientRect()
        const vp = useUi.getState().viewport
        const p = docToScreen(vp, x + 0.5, y + 0.5)
        return { x: rect.left + p.x, y: rect.top + p.y }
      }
    }
  }, [])

  // ---- wheel zoom (needs a non-passive listener) -----------------------------------------------

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const ui = useUi.getState()
      const dir = e.deltaY < 0 ? 1 : -1
      ui.setViewport(zoomAt(ui.viewport, stepZoom(ui.viewport.zoom, dir), e.clientX - rect.left, e.clientY - rect.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- pointer handling ------------------------------------------------------------------------

  const localPoint = (e: React.PointerEvent): { sx: number; sy: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }

  const dragPoint = (e: React.DragEvent): { sx: number; sy: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const el = e.currentTarget
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const { sx, sy } = localPoint(e)
    if (e.button === 1 || (e.button === 0 && input.space)) {
      e.preventDefault()
      panRef.current = { sx: e.clientX, sy: e.clientY, vp: useUi.getState().viewport }
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
      return
    }
    if (e.button !== 0 && e.button !== 2) return
    el.setPointerCapture(e.pointerId)
    const p = screenToPixel(useUi.getState().viewport, sx, sy)
    controller.begin(p, e.button, modsOf(e), settingsFromUi())
    if (controller.message) useUi.getState().setStatus(controller.message)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const el = e.currentTarget
    const { sx, sy } = localPoint(e)
    const ui = useUi.getState()
    const pan = panRef.current
    if (pan) {
      ui.setViewport(panBy(pan.vp, e.clientX - pan.sx, e.clientY - pan.sy))
      return
    }
    el.style.cursor = input.space ? 'grab' : 'crosshair'
    const p = screenToPixel(ui.viewport, sx, sy)
    const prev = hoverRef.current
    if (!prev || prev.x !== p.x || prev.y !== p.y) {
      hoverRef.current = p
      schedule()
    }
    if (controller.active) controller.move(p, modsOf(e), settingsFromUi())
  }

  const finish = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const el = e.currentTarget
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (panRef.current) {
      panRef.current = null
      el.style.cursor = input.space ? 'grab' : 'crosshair'
      return
    }
    if (!controller.active) return
    const { sx, sy } = localPoint(e)
    controller.end(screenToPixel(useUi.getState().viewport, sx, sy), modsOf(e), settingsFromUi())
  }

  // Expose the controller so keyboard actions (Delete = clear selection) can reach it.
  useEffect(() => {
    activeController = controller
    return () => {
      if (activeController === controller) activeController = null
    }
  }, [controller])

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        data-testid="canvas-surface"
        className="canvas-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={(e) => {
          controller.cancel()
          finish(e)
        }}
        onPointerLeave={() => {
          hoverRef.current = null
          schedule()
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          const { sx, sy } = dragPoint(e)
          const p = screenToPixel(useUi.getState().viewport, sx, sy)
          const prev = hoverRef.current
          if (!prev || prev.x !== p.x || prev.y !== p.y) {
            hoverRef.current = p
            schedule()
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(ASSET_DRAG_TYPE)
          if (!id) return
          e.preventDefault()
          const { sx, sy } = dragPoint(e)
          const p = screenToPixel(useUi.getState().viewport, sx, sy)
          void placeAsset(id, p.x, p.y)
        }}
      />
    </div>
  )
}

let activeController: ToolController | null = null

/** The canvas's tool controller (used by keyboard shortcuts for "clear selection"). */
export function getToolController(): ToolController | null {
  return activeController
}
