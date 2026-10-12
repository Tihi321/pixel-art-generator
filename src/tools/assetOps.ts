// Shared logic of the asset tools: building an asset document from a source selection, reading grid
// samples and previews of an asset. Pure TS (no DOM, no Electron).

import {
  type Cel,
  type Document,
  type Layer,
  type Raster,
  type Rect,
  celKey,
  celToRaster,
  clonePalette,
  copyRegion,
  createId,
  flattenFrame,
  opaqueBounds,
  rasterToCel,
  readGrid
} from '../core'
import { renderPreview } from './render'
import type { AssetService } from './services'

export type AssetSourceKind = 'document' | 'layer' | 'frames' | 'region'

export interface AssetSourceSpec {
  source: AssetSourceKind
  /** Layer to take (source "layer"; also narrows "region" and "frames"). Reference layers are never taken. */
  layer?: Layer
  /** Inclusive frame index range. */
  frameFrom: number
  frameTo: number
  region?: Rect
  /** Crop to the bounding box of the visible pixels. */
  trim: boolean
}

/** Requested region clipped to the canvas, or an error that says what is wrong. */
export function clipToCanvas(doc: Document, r: Rect): Rect {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(doc.width, r.x + r.w)
  const y1 = Math.min(doc.height, r.y + r.h)
  if (x1 <= x0 || y1 <= y0) throw new Error(`The region (${r.x},${r.y} ${r.w}x${r.h}) is outside the ${doc.width}x${doc.height} canvas.`)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Build a stand-alone document from part of `doc`: the chosen layers x frames, cropped to a region or to the
 * visible pixels. The result keeps the layer structure, durations and the (clipped) animation tags.
 */
export function buildAssetDocument(doc: Document, name: string, spec: AssetSourceSpec): Document {
  const frames = doc.frames.slice(spec.frameFrom, spec.frameTo + 1).map((f) => ({ ...f }))
  if (frames.length === 0) throw new Error('The frame range is empty.')
  const layers: Layer[] = spec.layer
    ? [{ ...spec.layer, visible: true, locked: false, kind: 'pixel' as const }]
    : doc.layers.filter((l) => l.kind === 'pixel').map((l) => ({ ...l }))
  if (layers.length === 0) throw new Error('The document has no pixel layers to save.')
  const only = layers.map((l) => l.id)

  let rect: Rect = spec.region ? clipToCanvas(doc, spec.region) : { x: 0, y: 0, w: doc.width, h: doc.height }
  if (spec.trim) {
    let bounds: Rect | null = null
    for (const f of frames) {
      const data = flattenFrame(doc, f.id, { layerIds: only, includeHidden: !!spec.layer })
      const b = opaqueBounds({ width: doc.width, height: doc.height, data: maskToRect(data, doc.width, doc.height, rect) })
      if (b) bounds = bounds ? union(bounds, b) : b
    }
    if (!bounds) throw new Error('Nothing to save: the selected source has no visible pixels.')
    rect = bounds
  }

  const cels = new Map<string, Cel>()
  for (const layer of layers) {
    for (const f of frames) {
      const cel = doc.cels.get(celKey(layer.id, f.id))
      if (!cel) continue
      const sub = rasterToCel(copyRegion(celToRaster(cel, doc.width, doc.height), rect))
      if (sub) cels.set(celKey(layer.id, f.id), sub)
    }
  }
  if (cels.size === 0) throw new Error('Nothing to save: the selected source has no pixels.')

  const tags = doc.tags
    .filter((t) => t.to >= spec.frameFrom && t.from <= spec.frameTo)
    .map((t) => ({ ...t, id: createId('tag'), from: Math.max(t.from, spec.frameFrom) - spec.frameFrom, to: Math.min(t.to, spec.frameTo) - spec.frameFrom }))

  return {
    id: createId('doc'),
    name,
    width: rect.w,
    height: rect.h,
    palette: clonePalette(doc.palette),
    layers,
    frames,
    cels,
    tags,
    references: []
  }
}

function union(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Copy of `data` where everything outside `rect` is transparent. */
function maskToRect(data: Uint32Array, width: number, height: number, rect: Rect): Uint32Array {
  if (rect.x === 0 && rect.y === 0 && rect.w === width && rect.h === height) return data
  const out = new Uint32Array(data.length)
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const s = y * width + rect.x
    out.set(data.subarray(s, s + rect.w), s)
  }
  return out
}

/** The flattened picture of one frame of an (asset) document. */
export function frameRaster(doc: Document, frameIndex: number): Raster {
  const frame = doc.frames[frameIndex]
  if (!frame) throw new Error(`The asset has ${doc.frames.length} frame(s); frame ${frameIndex} does not exist (use 0-${doc.frames.length - 1}).`)
  return { width: doc.width, height: doc.height, data: flattenFrame(doc, frame.id) }
}

export interface GridSample {
  frame: number
  rect: Rect
  legend: Record<string, string | null>
  rows: string[]
  /** Set when the sample is only part of the frame. */
  note?: string
}

/**
 * Read a grid sample of one frame (flattened). With no `region` the whole frame is read when it fits in
 * `maxSide` x `maxSide`, otherwise a `maxSide` window starting at the first visible pixel. Returns a
 * string (the reason) when no grid can be given.
 */
export function sampleGrid(doc: Document, frameIndex: number, maxSide: number, region?: Rect): GridSample | string {
  const img = frameRaster(doc, frameIndex)
  let rect: Rect
  let note: string | undefined
  if (region) {
    rect = clipToCanvas(doc, region)
    if (rect.w > maxSide || rect.h > maxSide) return `The region ${rect.w}x${rect.h} is larger than ${maxSide}x${maxSide}. Ask for a smaller region.`
  } else if (doc.width <= maxSide && doc.height <= maxSide) {
    rect = { x: 0, y: 0, w: doc.width, h: doc.height }
  } else {
    const b = opaqueBounds(img) ?? { x: 0, y: 0, w: doc.width, h: doc.height }
    const x = Math.min(b.x, Math.max(0, doc.width - maxSide))
    const y = Math.min(b.y, Math.max(0, doc.height - maxSide))
    rect = { x, y, w: Math.min(maxSide, doc.width - x), h: Math.min(maxSide, doc.height - y) }
    note = `The asset is ${doc.width}x${doc.height}; this is a ${rect.w}x${rect.h} crop at (${rect.x},${rect.y}). Pass "region" to read other parts.`
  }
  try {
    const g = readGrid(img, rect, { palette: doc.palette })
    return { frame: frameIndex, rect, legend: g.legend, rows: g.rows, ...(note ? { note } : {}) }
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Preview PNG (base64) of one frame of an asset document. */
export function assetPreview(doc: Document, frameIndex = 0, background: 'checker' | 'none' = 'checker'): { base64: string; width: number; height: number; scale: number } {
  const frame = doc.frames[frameIndex] ?? doc.frames[0]!
  return renderPreview(doc, { frameId: frame.id, background })
}

/** Small thumbnail PNG for the library panel. */
export function assetThumbnail(doc: Document): Uint8Array {
  const longer = Math.max(doc.width, doc.height)
  const scale = Math.max(1, Math.min(8, Math.floor(128 / longer)))
  return renderPreview(doc, { frameId: doc.frames[0]!.id, scale, background: 'none' }).png
}

export function noAssetLibrary(): Error {
  return new Error('The asset library is not available in this host.')
}

export function requireAssets(services: { assets?: AssetService }): AssetService {
  if (!services.assets) throw noAssetLibrary()
  return services.assets
}
