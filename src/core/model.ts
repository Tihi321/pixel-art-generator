// Core document model. Pure TypeScript: no DOM, no Electron, no node:* APIs.
//
// Conventions
//  - Origin is the top-left pixel; x grows right, y grows down.
//  - `doc.layers` is ordered bottom -> top (index 0 is drawn first / lowest).
//  - `doc.frames` is ordered in playback order. Tags and "frame index" refer to positions in it.
//  - Cels are sparse: a cel exists only where something was drawn. A cel has its own bounds
//    (x, y, w, h) in document coordinates; `data` is row-major, packed 0xAABBGGRR.

import { getBuiltinPalette } from './palettes'
import { hexToRgba, normalizeHex } from './color'

export * from './color'

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay'
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen', 'add', 'overlay']

export type LayerKind = 'pixel' | 'reference'
export type TagDirection = 'forward' | 'reverse' | 'pingpong'
export const TAG_DIRECTIONS: readonly TagDirection[] = ['forward', 'reverse', 'pingpong']

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  /** 0..1 */
  opacity: number
  blend: BlendMode
}

export interface Frame {
  id: string
  durationMs: number
}

export interface AnimTag {
  id: string
  name: string
  /** Inclusive frame index range into doc.frames. */
  from: number
  to: number
  direction: TagDirection
  /** Defaults to true when undefined. */
  loop?: boolean
}

export interface Cel {
  x: number
  y: number
  w: number
  h: number
  data: Uint32Array
}

export interface PaletteColor {
  hex: string
  name?: string
}

export interface Palette {
  id: string
  name: string
  colors: PaletteColor[]
}

export interface RefLink {
  assetId: string
  note?: string
}

export interface Document {
  id: string
  name: string
  width: number
  height: number
  palette: Palette
  layers: Layer[]
  frames: Frame[]
  cels: Map<string, Cel>
  tags: AnimTag[]
  references: RefLink[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const DEFAULT_FRAME_DURATION_MS = 100
export const MAX_DIMENSION = 4096

// ---------------------------------------------------------------- ids

let idCounter = 0
/** Short unique id such as "layer_k3j9x2". */
export function createId(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616
  const rand = Math.floor(Math.random() * 1679616)
  const a = (rand ^ (idCounter * 7919)) & 0xfffff
  return `${prefix}_${a.toString(36).padStart(4, '0')}${idCounter.toString(36).padStart(2, '0')}`
}

// ---------------------------------------------------------------- cels

export function celKey(layerId: string, frameId: string): string {
  return `${layerId}:${frameId}`
}

export function getCel(doc: Document, layerId: string, frameId: string): Cel | undefined {
  return doc.cels.get(celKey(layerId, frameId))
}

export function cloneCel(cel: Cel): Cel {
  return { x: cel.x, y: cel.y, w: cel.w, h: cel.h, data: cel.data.slice() }
}

export function cloneLayer(layer: Layer): Layer {
  return { ...layer }
}
export function cloneFrame(frame: Frame): Frame {
  return { ...frame }
}
export function cloneTag(tag: AnimTag): AnimTag {
  return { ...tag }
}
export function clonePalette(p: Palette): Palette {
  return { id: p.id, name: p.name, colors: p.colors.map((c) => ({ ...c })) }
}

export function cloneDocument(doc: Document): Document {
  const cels = new Map<string, Cel>()
  for (const [k, v] of doc.cels) cels.set(k, cloneCel(v))
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    palette: clonePalette(doc.palette),
    layers: doc.layers.map(cloneLayer),
    frames: doc.frames.map(cloneFrame),
    cels,
    tags: doc.tags.map(cloneTag),
    references: doc.references.map((r) => ({ ...r }))
  }
}

// ---------------------------------------------------------------- factories

export function createLayer(partial: Partial<Layer> = {}): Layer {
  return {
    id: partial.id ?? createId('layer'),
    name: partial.name ?? 'Layer',
    kind: partial.kind ?? 'pixel',
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    opacity: partial.opacity ?? 1,
    blend: partial.blend ?? 'normal'
  }
}

export function createFrame(partial: Partial<Frame> = {}): Frame {
  return { id: partial.id ?? createId('frame'), durationMs: partial.durationMs ?? DEFAULT_FRAME_DURATION_MS }
}

export function createPalette(name: string, hexes: string[], id?: string): Palette {
  return {
    id: id ?? createId('palette'),
    name,
    colors: hexes.map((h) => ({ hex: normalizeHex(h) }))
  }
}

export interface CreateDocumentOptions {
  width: number
  height: number
  name?: string
  palette?: Palette
}

export function createDocument(opts: CreateDocumentOptions): Document {
  const { width, height } = opts
  assertDimensions(width, height)
  const palette = opts.palette ? clonePalette(opts.palette) : clonePalette(getBuiltinPalette('pico-8')!)
  return {
    id: createId('doc'),
    name: opts.name ?? 'Untitled',
    width,
    height,
    palette,
    layers: [createLayer({ name: 'Layer 1' })],
    frames: [createFrame()],
    cels: new Map(),
    tags: [],
    references: []
  }
}

export function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid canvas size ${width}x${height}: width and height must be positive integers.`)
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Canvas size ${width}x${height} is too large (max ${MAX_DIMENSION}x${MAX_DIMENSION}).`)
  }
}

// ---------------------------------------------------------------- lookups

export function layerIndex(doc: Document, layerId: string): number {
  return doc.layers.findIndex((l) => l.id === layerId)
}
export function frameIndex(doc: Document, frameId: string): number {
  return doc.frames.findIndex((f) => f.id === frameId)
}

/** Resolve a layer by id, exact name (case-insensitive) or numeric index (0 = bottom). */
export function findLayer(doc: Document, ref: string | number): Layer | undefined {
  if (typeof ref === 'number') return doc.layers[ref]
  const byId = doc.layers.find((l) => l.id === ref)
  if (byId) return byId
  const lower = ref.toLowerCase()
  return doc.layers.find((l) => l.name.toLowerCase() === lower)
}

export function requireLayer(doc: Document, ref: string | number): Layer {
  const l = findLayer(doc, ref)
  if (!l) {
    const avail = doc.layers.map((x, i) => `${i}:"${x.name}" (${x.id})`).join(', ')
    throw new Error(`Layer ${JSON.stringify(ref)} not found. Available layers (index:name): ${avail}.`)
  }
  return l
}

/** Resolve a frame by id or numeric index (0-based). */
export function findFrame(doc: Document, ref: string | number): Frame | undefined {
  if (typeof ref === 'number') return doc.frames[ref]
  return doc.frames.find((f) => f.id === ref)
}

export function requireFrame(doc: Document, ref: string | number): Frame {
  const f = findFrame(doc, ref)
  if (!f) {
    throw new Error(
      `Frame ${JSON.stringify(ref)} not found. Document has ${doc.frames.length} frame(s): use a 0-based index 0..${doc.frames.length - 1} or a frame id.`
    )
  }
  return f
}

/** Resolve a tag by id or name (case-insensitive). */
export function findTag(doc: Document, ref: string): AnimTag | undefined {
  const byId = doc.tags.find((t) => t.id === ref)
  if (byId) return byId
  const lower = ref.toLowerCase()
  return doc.tags.find((t) => t.name.toLowerCase() === lower)
}

export function requireTag(doc: Document, ref: string): AnimTag {
  const t = findTag(doc, ref)
  if (!t) {
    const avail = doc.tags.map((x) => `"${x.name}"`).join(', ') || '(none)'
    throw new Error(`Tag "${ref}" not found. Existing tags: ${avail}.`)
  }
  return t
}

/** Palette colors as packed RGBA. */
export function paletteToRgba(palette: Palette): number[] {
  return palette.colors.map((c) => hexToRgba(c.hex))
}

export function docRect(doc: Document): Rect {
  return { x: 0, y: 0, w: doc.width, h: doc.height }
}
