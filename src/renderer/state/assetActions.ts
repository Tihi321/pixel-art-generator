// UI actions of the asset library. Every one runs the matching tool (save_as_asset, place_asset,
// set_style_reference) through lib/tools.ts, so the UI and the LLM behave identically (one undo step each).

import { type AssetKind } from '../../tools'
import { runUiTool } from '../lib/tools'
import { session } from './session'
import { useUi } from './ui'

export type SaveSource = 'document' | 'layer' | 'frame' | 'selection'

export interface SaveAssetForm {
  source: SaveSource
  name: string
  kind: AssetKind
  /** Comma separated. */
  tags: string
  notes: string
  trim: boolean
}

export function parseTags(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Tool arguments of save_as_asset for the dialog's source choice. */
export function saveArgs(form: SaveAssetForm): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: form.name.trim(),
    kind: form.kind,
    tags: parseTags(form.tags),
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    trim: form.trim
  }
  switch (form.source) {
    case 'layer':
      return { ...base, source: 'layer', layer: session.activeLayer.id }
    case 'frame': {
      const i = session.activeFrameIndex
      return { ...base, source: 'frames', frames: { from: i, to: i } }
    }
    case 'selection': {
      const sel = session.selection
      if (!sel) throw new Error('Select a region on the canvas first (rectangle select tool).')
      return { ...base, source: 'region', region: { x: sel.x, y: sel.y, w: sel.w, h: sel.h } }
    }
    default:
      return { ...base, source: 'document' }
  }
}

function report(message: string): void {
  useUi.getState().setStatus(message)
}

export async function saveAsAsset(form: SaveAssetForm): Promise<boolean> {
  let args: Record<string, unknown>
  try {
    args = saveArgs(form)
  } catch (e) {
    report(e instanceof Error ? e.message : String(e))
    return false
  }
  const r = await runUiTool('save_as_asset', args)
  report(r.ok ? `Saved asset "${form.name.trim()}"` : r.message)
  return r.ok
}

/** Place an asset (options from the Assets panel: new layer, whole animation). */
export async function placeAsset(id: string, x: number, y: number): Promise<boolean> {
  const ui = useUi.getState()
  const r = await runUiTool('place_asset', { id, x, y, newLayer: ui.assetNewLayer, frames: ui.assetAnimation ? 'all' : 'first' })
  report(r.message)
  return r.ok
}

export async function setReference(id: string, on: boolean): Promise<boolean> {
  const r = on
    ? await runUiTool('set_style_reference', { ids: [id], action: 'add', showLayer: useUi.getState().assetShowRefLayer })
    : await runUiTool('set_style_reference', { ids: [id], action: 'remove' })
  report(r.message)
  return r.ok
}
