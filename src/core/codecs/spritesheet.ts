// Sprite sheet packing and metadata (Aseprite array/hash JSON and TexturePacker JSON-hash).

import {
  type AnimTag,
  type Document,
  type Rect,
  type TagDirection,
  findTag,
  requireLayer
} from '../model'
import { type Raster, createRaster, flattenFrame, opaqueBounds, stamp } from '../raster'
import { type RgbaImage, scaleImage } from './png'

export type SheetLayout = 'horizontal' | 'vertical' | 'grid' | 'packed'
export type SheetMetaFormat = 'aseprite-array' | 'aseprite-hash' | 'texturepacker'

export interface SpriteSheetOptions {
  layout?: SheetLayout
  /** Column count for the 'grid' layout (default: ceil(sqrt(frameCount))). */
  columns?: number
  /** Integer nearest-neighbour upscale (default 1). */
  scale?: number
  /** Pixels between frames (default 0), in output pixels. */
  padding?: number
  /** Pixels around the whole sheet (default 0), in output pixels. */
  border?: number
  /** Only frames covered by these tag names/ids (union, ascending order). */
  tags?: string[]
  /** Only these frames: an inclusive index range or a list of 0-based indices. */
  frames?: { from: number; to: number } | number[]
  /** Only these layers (ids, names or indices). Default: all visible pixel layers. */
  layers?: Array<string | number>
  includeReference?: boolean
  /** Trim transparent borders from each frame. Default false, except for 'packed' (true). */
  trim?: boolean
  /** Round the sheet size up to powers of two. */
  powerOfTwo?: boolean
  /** Image file name written into the metadata (default "<doc name>.png"). */
  imageName?: string
}

export interface SheetFrame {
  /** Frame index in the document. */
  index: number
  frameId: string
  filename: string
  /** Position and size inside the sheet (output pixels). */
  rect: Rect
  trimmed: boolean
  /** Where the trimmed content sits inside the original (scaled) frame. */
  spriteSourceSize: Rect
  sourceSize: { w: number; h: number }
  durationMs: number
}

export interface SheetTag {
  name: string
  /** Inclusive indices into SpriteSheet.frames (not document frame indices). */
  from: number
  to: number
  direction: TagDirection
  loop: boolean
}

export interface SpriteSheet {
  width: number
  height: number
  /** Packed RGBA pixels of the sheet. */
  data: Uint32Array
  frames: SheetFrame[]
  tags: SheetTag[]
  layout: SheetLayout
  scale: number
  imageName: string
  docName: string
}

function selectFrameIndices(doc: Document, opts: SpriteSheetOptions): number[] {
  const n = doc.frames.length
  const set = new Set<number>()
  if (opts.tags && opts.tags.length > 0) {
    for (const ref of opts.tags) {
      const tag = findTag(doc, ref)
      if (!tag) {
        const avail = doc.tags.map((t) => `"${t.name}"`).join(', ') || '(none)'
        throw new Error(`Tag "${ref}" not found. Existing tags: ${avail}.`)
      }
      for (let i = tag.from; i <= tag.to; i++) set.add(i)
    }
  } else if (opts.frames) {
    const fr = opts.frames
    const list = Array.isArray(fr) ? fr : Array.from({ length: Math.max(0, fr.to - fr.from + 1) }, (_, i) => fr.from + i)
    for (const i of list) {
      if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`Frame index ${i} is out of range (document has ${n} frame(s), 0-based).`)
      set.add(i)
    }
  } else {
    for (let i = 0; i < n; i++) set.add(i)
  }
  const out = [...set].sort((a, b) => a - b)
  if (out.length === 0) throw new Error('No frames selected for the sprite sheet.')
  return out
}

function nextPow2(v: number): number {
  let p = 1
  while (p < v) p <<= 1
  return p
}

interface Cell {
  index: number
  image: RgbaImage
  trimmed: boolean
  sprite: Rect
  w: number
  h: number
  x: number
  y: number
}

export function buildSpriteSheet(doc: Document, opts: SpriteSheetOptions = {}): SpriteSheet {
  const layout = opts.layout ?? 'horizontal'
  const scale = Math.max(1, Math.floor(opts.scale ?? 1))
  const padding = Math.max(0, Math.floor(opts.padding ?? 0))
  const border = Math.max(0, Math.floor(opts.border ?? 0))
  const trim = opts.trim ?? layout === 'packed'
  const indices = selectFrameIndices(doc, opts)

  const layerIds = opts.layers && opts.layers.length > 0 ? opts.layers.map((r) => requireLayer(doc, r).id) : undefined
  const flattenOpts = layerIds
    ? { layerIds, includeHidden: true, includeReference: true }
    : { includeReference: opts.includeReference ?? false }

  const cells: Cell[] = indices.map((index) => {
    const frame = doc.frames[index]!
    const full: Raster = { width: doc.width, height: doc.height, data: flattenFrame(doc, frame.id, flattenOpts) }
    let bounds: Rect = { x: 0, y: 0, w: doc.width, h: doc.height }
    let trimmed = false
    if (trim) {
      const b = opaqueBounds(full) ?? { x: 0, y: 0, w: 1, h: 1 }
      trimmed = b.w !== doc.width || b.h !== doc.height
      bounds = b
    }
    const cropped = createRaster(bounds.w, bounds.h)
    for (let y = 0; y < bounds.h; y++) {
      const s = (bounds.y + y) * doc.width + bounds.x
      cropped.data.set(full.data.subarray(s, s + bounds.w), y * bounds.w)
    }
    const image = scaleImage(cropped, scale)
    return {
      index,
      image,
      trimmed,
      sprite: { x: bounds.x * scale, y: bounds.y * scale, w: image.width, h: image.height },
      w: image.width,
      h: image.height,
      x: 0,
      y: 0
    }
  })

  // ---- layout
  let innerW = 0
  let innerH = 0
  const n = cells.length
  if (layout === 'horizontal') {
    let x = 0
    for (const c of cells) {
      c.x = x
      x += c.w + padding
      innerH = Math.max(innerH, c.h)
    }
    innerW = x - padding
  } else if (layout === 'vertical') {
    let y = 0
    for (const c of cells) {
      c.y = y
      y += c.h + padding
      innerW = Math.max(innerW, c.w)
    }
    innerH = y - padding
  } else if (layout === 'grid') {
    const cols = Math.max(1, Math.min(n, Math.floor(opts.columns ?? Math.ceil(Math.sqrt(n)))))
    const rows = Math.ceil(n / cols)
    const cw = Math.max(...cells.map((c) => c.w))
    const ch = Math.max(...cells.map((c) => c.h))
    cells.forEach((c, i) => {
      c.x = (i % cols) * (cw + padding)
      c.y = Math.floor(i / cols) * (ch + padding)
    })
    innerW = cols * cw + (cols - 1) * padding
    innerH = rows * ch + (rows - 1) * padding
  } else {
    const maxW = Math.max(...cells.map((c) => c.w))
    const area = cells.reduce((s, c) => s + (c.w + padding) * (c.h + padding), 0)
    const targetW = Math.max(maxW, Math.ceil(Math.sqrt(area)))
    const order = [...cells].sort((a, b) => b.h - a.h || a.index - b.index)
    let x = 0
    let y = 0
    let shelfH = 0
    for (const c of order) {
      if (x > 0 && x + c.w > targetW) {
        x = 0
        y += shelfH + padding
        shelfH = 0
      }
      c.x = x
      c.y = y
      x += c.w + padding
      shelfH = Math.max(shelfH, c.h)
      innerW = Math.max(innerW, c.x + c.w)
      innerH = Math.max(innerH, c.y + c.h)
    }
  }

  let width = innerW + border * 2
  let height = innerH + border * 2
  if (opts.powerOfTwo) {
    width = nextPow2(width)
    height = nextPow2(height)
  }
  const sheet = createRaster(width, height)
  for (const c of cells) stamp(sheet, { ...c.image }, c.x + border, c.y + border, { replace: true })

  const frames: SheetFrame[] = cells.map((c) => ({
    index: c.index,
    frameId: doc.frames[c.index]!.id,
    filename: `${doc.name.trim().replace(/\s+/g, '_') || 'sprite'}_${c.index}`,
    rect: { x: c.x + border, y: c.y + border, w: c.w, h: c.h },
    trimmed: c.trimmed,
    spriteSourceSize: c.sprite,
    sourceSize: { w: doc.width * scale, h: doc.height * scale },
    durationMs: doc.frames[c.index]!.durationMs
  }))

  // ---- tags mapped to sheet frame positions
  const tagSource: AnimTag[] =
    opts.tags && opts.tags.length > 0 ? opts.tags.map((r) => findTag(doc, r)!) : doc.tags
  const tags: SheetTag[] = []
  for (const t of tagSource) {
    const inRange = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.index >= t.from && f.index <= t.to)
    if (inRange.length === 0) continue
    tags.push({
      name: t.name,
      from: inRange[0]!.i,
      to: inRange[inRange.length - 1]!.i,
      direction: t.direction,
      loop: t.loop ?? true
    })
  }

  return {
    width,
    height,
    data: sheet.data,
    frames,
    tags,
    layout,
    scale,
    imageName: opts.imageName ?? `${doc.name.trim() || 'sprite'}.png`,
    docName: doc.name
  }
}

// ---------------------------------------------------------------- metadata

interface AseFrame {
  filename: string
  frame: Rect
  rotated: boolean
  trimmed: boolean
  spriteSourceSize: Rect
  sourceSize: { w: number; h: number }
  duration: number
}

function aseFrame(f: SheetFrame): AseFrame {
  return {
    filename: f.filename,
    frame: { ...f.rect },
    rotated: false,
    trimmed: f.trimmed,
    spriteSourceSize: { ...f.spriteSourceSize },
    sourceSize: { ...f.sourceSize },
    duration: f.durationMs
  }
}

function frameTags(sheet: SpriteSheet): Array<{ name: string; from: number; to: number; direction: TagDirection; repeat?: string }> {
  return sheet.tags.map((t) => ({
    name: t.name,
    from: t.from,
    to: t.to,
    direction: t.direction,
    ...(t.loop ? {} : { repeat: '1' })
  }))
}

function baseMeta(sheet: SpriteSheet): Record<string, unknown> {
  return {
    app: 'Pixel Studio',
    version: '1.0',
    image: sheet.imageName,
    format: 'RGBA8888',
    size: { w: sheet.width, h: sheet.height },
    scale: String(sheet.scale),
    frameTags: frameTags(sheet)
  }
}

/** Aseprite "array" JSON: frames is an array; includes frameTags and per-frame duration. */
export function asepriteArrayMeta(sheet: SpriteSheet): Record<string, unknown> {
  return { frames: sheet.frames.map(aseFrame), meta: baseMeta(sheet) }
}

/** Aseprite "hash" JSON: frames is an object keyed by frame name. */
export function asepriteHashMeta(sheet: SpriteSheet): Record<string, unknown> {
  const frames: Record<string, Omit<AseFrame, 'filename'>> = {}
  for (const f of sheet.frames) {
    const { filename, ...rest } = aseFrame(f)
    frames[filename] = rest
  }
  return { frames, meta: baseMeta(sheet) }
}

/** TexturePacker "JSON (Hash)" with pivot, plus duration/frameTags extensions for animation data. */
export function texturePackerMeta(sheet: SpriteSheet): Record<string, unknown> {
  const frames: Record<string, unknown> = {}
  for (const f of sheet.frames) {
    frames[f.filename] = {
      frame: { ...f.rect },
      rotated: false,
      trimmed: f.trimmed,
      spriteSourceSize: { ...f.spriteSourceSize },
      sourceSize: { ...f.sourceSize },
      pivot: { x: 0.5, y: 0.5 },
      duration: f.durationMs
    }
  }
  return {
    frames,
    meta: {
      app: 'Pixel Studio',
      version: '1.0',
      image: sheet.imageName,
      format: 'RGBA8888',
      size: { w: sheet.width, h: sheet.height },
      scale: String(sheet.scale),
      frameTags: frameTags(sheet)
    }
  }
}

export function sheetMetadata(sheet: SpriteSheet, format: SheetMetaFormat = 'aseprite-array'): Record<string, unknown> {
  switch (format) {
    case 'aseprite-hash':
      return asepriteHashMeta(sheet)
    case 'texturepacker':
      return texturePackerMeta(sheet)
    default:
      return asepriteArrayMeta(sheet)
  }
}
