import { useEffect } from 'react'
import { getToolController } from '../components/CanvasView'
import { shortcutFor } from '../lib/keys'
import { fitViewport, stepZoom, zoomAt } from '../lib/viewport'
import { redo, undo } from '../state/actions'
import { input } from '../state/input'
import { session } from '../state/session'
import { useUi } from '../state/ui'

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'range', 'color'].includes(type)
  }
  return false
}

/** Global keyboard shortcuts: tools, colours, undo/redo, zoom, selection. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        useUi.getState().openDialog(useUi.getState().dialog ? null : 'settings')
        return
      }
      if (isTyping(e.target)) return
      if (useUi.getState().dialog) return
      if (e.code === 'Space') {
        input.space = true
        e.preventDefault()
        return
      }
      const action = shortcutFor({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })
      if (!action) return
      e.preventDefault()
      const ui = useUi.getState()
      switch (action.type) {
        case 'tool':
          ui.setTool(action.tool)
          break
        case 'swap':
          session.swapColors()
          break
        case 'undo':
          undo()
          break
        case 'redo':
          redo()
          break
        case 'zoom': {
          const { w, h } = ui.viewSize
          ui.setViewport(zoomAt(ui.viewport, stepZoom(ui.viewport.zoom, action.dir), w / 2, h / 2))
          break
        }
        case 'fit':
          ui.setViewport(fitViewport(ui.viewSize.w, ui.viewSize.h, session.doc.width, session.doc.height))
          break
        case 'brush':
          ui.set({ brushSize: Math.max(1, Math.min(32, ui.brushSize + action.delta)) })
          break
        case 'deselect':
          session.setSelection(null)
          break
        case 'selectAll':
          session.setSelection({ x: 0, y: 0, w: session.doc.width, h: session.doc.height })
          break
        case 'clearSelection':
          getToolController()?.clearSelectionPixels()
          break
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') input.space = false
    }
    const onBlur = (): void => {
      input.space = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
