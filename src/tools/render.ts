// Preview rendering used by render_preview (and handy for the UI): flatten a frame, optionally with
// onion skin, crop, nearest-neighbour upscale, checkerboard background and pixel grid. Pure TS.

import {
  type Document,
  type Raster,
  type Rect,
  bytesToBase64,
  blendPixel,
  copyRegion,
  createRaster,
  encodePng,
  flattenFrame,
  frameIndex,
  packRgba,
  scaleImage
} from '../core'

export interface PreviewOptions {
  frameId: string
  /** Render only this layer (even when hidden). Default: all visible pixel layers. */
  layerId?: string
  /** Crop to this region of the canvas before scaling. */
  region?: Rect
  /** Integer upscale. Default: auto so the longer side is ~256-512 px. */
  scale?: number
  /** 'checker' (default), 'none' (transparent) or a packed RGBA color. */
  background?: 'checker' | 'none' | number
  /** Draw the pixel grid (only when scale >= 6). */
  grid?: boolean
  /** Show the neighbouring frames faintly under the current one. */
  onion?: { before: number; after: number; opacity: number }
}

export interface PreviewResult {
  png: Uint8Array
  base64: string
  width: number
  height: number
  scale: number
}

/** Smallest integer scale that makes the longer side >= 256 px, but never beyond 512 px (min 1). */
export function autoScale(width: number, height: number): number {
  const longer = Math.max(width, height)
  let s = Math.ceil(256 / longer)
  if (longer * s > 512) s = Math.floor(512 / longer)
  return Math.max(1, s)
}

const MAX_SIDE = 2048

function flatten(doc: Document, frameId: string, layerId?: string): Raster {
  const data = layerId
    ? flattenFrame(doc, frameId, { layerIds: [layerId], includeHidden: true, includeReference: true })
    : flattenFrame(doc, frameId)
  return { width: doc.width, height: doc.height, data }
}

export function renderPreview(doc: Document, opts: PreviewOptions): PreviewResult {
  let img = flatten(doc, opts.frameId, opts.layerId)
  if (opts.onion) {
    const idx = frameIndex(doc, opts.frameId)
    const under = createRaster(doc.width, doc.height)
    const add = (k: number, falloff: number): void => {
      const f = doc.frames[idx + k]
      if (!f) return
      const o = flatten(doc, f.id, opts.layerId)
      const op = opts.onion!.opacity * falloff
      for (let i = 0; i < o.data.length; i++) under.data[i] = blendPixel(under.data[i]!, o.data[i]!, 'normal', op)
    }
    for (let k = opts.onion.before; k >= 1; k--) add(-k, 1 / k)
    for (let k = opts.onion.after; k >= 1; k--) add(k, 1 / k)
    for (let i = 0; i < under.data.length; i++) under.data[i] = blendPixel(under.data[i]!, img.data[i]!)
    img = under
  }
  if (opts.region) {
    const r = {
      x: Math.max(0, opts.region.x),
      y: Math.max(0, opts.region.y),
      w: Math.min(doc.width, opts.region.x + opts.region.w) - Math.max(0, opts.region.x),
      h: Math.min(doc.height, opts.region.y + opts.region.h) - Math.max(0, opts.region.y)
    }
    if (r.w < 1 || r.h < 1) throw new Error(`Region is outside the ${doc.width}x${doc.height} canvas.`)
    img = copyRegion(img, r)
  }
  let scale = Math.max(1, Math.floor(opts.scale ?? autoScale(img.width, img.height)))
  while (scale > 1 && Math.max(img.width, img.height) * scale > MAX_SIDE) scale--
  const scaled = scaleImage(img, scale)
  const { width, height } = scaled
  const data = scaled.data === img.data ? scaled.data.slice() : scaled.data
  const bg = opts.background ?? 'checker'
  const cell = Math.max(4, scale)
  const light = packRgba(224, 224, 224)
  const dark = packRgba(190, 190, 190)
  const gridColor = packRgba(128, 128, 128, 90)
  const drawGrid = !!opts.grid && scale >= 6
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let c = data[i]!
      if (bg !== 'none') {
        const base = bg === 'checker' ? (((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0 ? light : dark) : bg
        c = blendPixel(base, c)
      }
      if (drawGrid && (x % scale === 0 || y % scale === 0)) c = blendPixel(c, gridColor)
      data[i] = c
    }
  }
  const png = encodePng({ width, height, data })
  return { png, base64: bytesToBase64(png), width, height, scale }
}
