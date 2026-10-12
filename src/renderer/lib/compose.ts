// Frame composition for the canvas view (live preview aware) and onion skins. Pure, no DOM.

import { type Cel, type Document, celKey, compositeCel, createRaster, frameIndex } from '../../core'
import type { OnionSkinSettings } from '../../tools/session'
import type { Preview } from './toolController'

/** Composite one frame of visible layers; the layer being edited uses the gesture preview when given. */
export function composeFrame(doc: Document, frameId: string, preview: Preview | null = null): Uint32Array {
  const out = createRaster(doc.width, doc.height)
  for (const layer of doc.layers) {
    if (!layer.visible) continue
    let cel: Cel | undefined
    if (preview?.raster && preview.layerId === layer.id && preview.frameId === frameId) {
      cel = { x: 0, y: 0, w: doc.width, h: doc.height, data: preview.raster.data }
    } else {
      cel = doc.cels.get(celKey(layer.id, frameId))
    }
    if (cel) compositeCel(out, cel, layer)
  }
  return out.data
}

export interface OnionFrame {
  frameIndex: number
  /** -1 for frames before the active one, +1 for frames after. */
  side: -1 | 1
  /** 1 for the nearest onion frame, 2 for the next one, ... */
  distance: number
  alpha: number
}

/** Which neighbouring frames to draw as onion skin and how opaque each one is. */
export function onionFrames(frameCount: number, active: number, onion: OnionSkinSettings): OnionFrame[] {
  if (!onion.enabled) return []
  const out: OnionFrame[] = []
  for (let d = onion.before; d >= 1; d--) {
    const i = active - d
    if (i >= 0) out.push({ frameIndex: i, side: -1, distance: d, alpha: onion.opacity / d })
  }
  for (let d = 1; d <= onion.after; d++) {
    const i = active + d
    if (i < frameCount) out.push({ frameIndex: i, side: 1, distance: d, alpha: onion.opacity / d })
  }
  return out
}

/** Mix opaque pixel colours toward `tint` (0xRRGGBB as r,g,b) by `amount`, keeping alpha. Returns a new array. */
export function tintImage(data: Uint32Array, tint: [number, number, number], amount = 0.5): Uint32Array {
  const out = new Uint32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!
    const a = c >>> 24
    if (a === 0) continue
    const r = Math.round((c & 255) * (1 - amount) + tint[0] * amount)
    const g = Math.round(((c >>> 8) & 255) * (1 - amount) + tint[1] * amount)
    const b = Math.round(((c >>> 16) & 255) * (1 - amount) + tint[2] * amount)
    out[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
  }
  return out
}

export const ONION_TINT_BEFORE: [number, number, number] = [255, 80, 80]
export const ONION_TINT_AFTER: [number, number, number] = [80, 140, 255]

/** Tinted flattened images for the onion frames of the active frame. */
export function renderOnion(doc: Document, activeFrameId: string, onion: OnionSkinSettings): Array<{ data: Uint32Array; alpha: number }> {
  const active = frameIndex(doc, activeFrameId)
  return onionFrames(doc.frames.length, active, onion).map((o) => ({
    data: tintImage(composeFrame(doc, doc.frames[o.frameIndex]!.id), o.side < 0 ? ONION_TINT_BEFORE : ONION_TINT_AFTER),
    alpha: o.alpha
  }))
}
