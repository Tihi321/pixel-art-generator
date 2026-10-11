// .pxs project format: a JSON manifest with a base64 PNG per cel.

import {
  type AnimTag,
  type BlendMode,
  type Cel,
  type Document,
  type Frame,
  type Layer,
  type Palette,
  type RefLink,
  type TagDirection,
  BLEND_MODES,
  TAG_DIRECTIONS,
  assertDimensions,
  celKey,
  createId,
  normalizeHex
} from '../model'
import { base64ToBytes, bytesToBase64, decodePng, encodePng } from './png'

export const PROJECT_FORMAT = 'pixel-studio'
export const PROJECT_VERSION = 1

export interface ProjectCel {
  layer: string
  frame: string
  x: number
  y: number
  w: number
  h: number
  /** base64 PNG (no data: prefix). */
  png: string
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  doc: { id: string; name: string; width: number; height: number }
  palette: Palette
  layers: Layer[]
  frames: Frame[]
  tags: AnimTag[]
  references: RefLink[]
  cels: ProjectCel[]
}

export function projectToObject(doc: Document): ProjectFile {
  const cels: ProjectCel[] = []
  for (const layer of doc.layers) {
    for (const frame of doc.frames) {
      const cel = doc.cels.get(celKey(layer.id, frame.id))
      if (!cel) continue
      cels.push({
        layer: layer.id,
        frame: frame.id,
        x: cel.x,
        y: cel.y,
        w: cel.w,
        h: cel.h,
        png: bytesToBase64(encodePng({ width: cel.w, height: cel.h, data: cel.data }))
      })
    }
  }
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    doc: { id: doc.id, name: doc.name, width: doc.width, height: doc.height },
    palette: { id: doc.palette.id, name: doc.palette.name, colors: doc.palette.colors.map((c) => ({ ...c })) },
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({ ...f })),
    tags: doc.tags.map((t) => ({ ...t })),
    references: doc.references.map((r) => ({ ...r })),
    cels
  }
}

/** Serialize a document to .pxs text. */
export function serializeProject(doc: Document, opts: { pretty?: boolean } = {}): string {
  return JSON.stringify(projectToObject(doc), null, opts.pretty ? 2 : undefined)
}

function fail(msg: string): never {
  throw new Error(`Invalid Pixel Studio project: ${msg}`)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, what: string, fallback?: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (fallback !== undefined && v === undefined) return fallback
  return fail(`${what} must be a number.`)
}

function str(v: unknown, what: string, fallback?: string): string {
  if (typeof v === 'string') return v
  if (fallback !== undefined && v === undefined) return fallback
  return fail(`${what} must be a string.`)
}

/** Parse .pxs text (or an already-parsed object) into a Document. */
export function deserializeProject(input: string | unknown): Document {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch (e) {
      throw new Error(`Invalid Pixel Studio project: not valid JSON (${(e as Error).message}).`, { cause: e })
    }
  }
  if (!isObj(raw)) return fail('top level must be an object.')
  if (raw.format !== PROJECT_FORMAT) fail(`"format" must be "${PROJECT_FORMAT}" (found ${JSON.stringify(raw.format)}).`)
  const version = num(raw.version, 'version')
  if (version > PROJECT_VERSION) fail(`project version ${version} is newer than this app supports (${PROJECT_VERSION}).`)
  if (!isObj(raw.doc)) return fail('"doc" metadata is missing.')
  const width = num(raw.doc.width, 'doc.width')
  const height = num(raw.doc.height, 'doc.height')
  try {
    assertDimensions(width, height)
  } catch (e) {
    return fail((e as Error).message)
  }

  if (!isObj(raw.palette) || !Array.isArray(raw.palette.colors)) return fail('"palette" must have a colors array.')
  const palette: Palette = {
    id: str(raw.palette.id, 'palette.id', createId('palette')),
    name: str(raw.palette.name, 'palette.name', 'Palette'),
    colors: raw.palette.colors.map((c, i) => {
      if (!isObj(c)) return fail(`palette.colors[${i}] must be an object {hex, name?}.`)
      const hex = normalizeHex(str(c.hex, `palette.colors[${i}].hex`))
      return typeof c.name === 'string' && c.name ? { hex, name: c.name } : { hex }
    })
  }

  if (!Array.isArray(raw.layers) || raw.layers.length === 0) return fail('"layers" must be a non-empty array.')
  const layers: Layer[] = raw.layers.map((l, i) => {
    if (!isObj(l)) return fail(`layers[${i}] must be an object.`)
    const blend = str(l.blend, `layers[${i}].blend`, 'normal')
    const kind = str(l.kind, `layers[${i}].kind`, 'pixel')
    return {
      id: str(l.id, `layers[${i}].id`),
      name: str(l.name, `layers[${i}].name`, `Layer ${i + 1}`),
      kind: kind === 'reference' ? 'reference' : 'pixel',
      visible: l.visible !== false,
      locked: l.locked === true,
      opacity: Math.max(0, Math.min(1, num(l.opacity, `layers[${i}].opacity`, 1))),
      blend: (BLEND_MODES.includes(blend as BlendMode) ? blend : 'normal') as BlendMode
    }
  })

  if (!Array.isArray(raw.frames) || raw.frames.length === 0) return fail('"frames" must be a non-empty array.')
  const frames: Frame[] = raw.frames.map((f, i) => {
    if (!isObj(f)) return fail(`frames[${i}] must be an object.`)
    return { id: str(f.id, `frames[${i}].id`), durationMs: Math.max(1, num(f.durationMs, `frames[${i}].durationMs`, 100)) }
  })

  const tagsRaw: unknown[] = Array.isArray(raw.tags) ? raw.tags : []
  const tags: AnimTag[] = tagsRaw.map((t, i) => {
    if (!isObj(t)) return fail(`tags[${i}] must be an object.`)
    const dir = str(t.direction, `tags[${i}].direction`, 'forward')
    const tag: AnimTag = {
      id: str(t.id, `tags[${i}].id`, createId('tag')),
      name: str(t.name, `tags[${i}].name`),
      from: num(t.from, `tags[${i}].from`),
      to: num(t.to, `tags[${i}].to`),
      direction: (TAG_DIRECTIONS.includes(dir as TagDirection) ? dir : 'forward') as TagDirection
    }
    if (typeof t.loop === 'boolean') tag.loop = t.loop
    return tag
  })

  const refsRaw: unknown[] = Array.isArray(raw.references) ? raw.references : []
  const references: RefLink[] = refsRaw.map((r, i) => {
    if (!isObj(r)) return fail(`references[${i}] must be an object.`)
    const link: RefLink = { assetId: str(r.assetId, `references[${i}].assetId`) }
    if (typeof r.note === 'string') link.note = r.note
    return link
  })

  const layerIds = new Set(layers.map((l) => l.id))
  const frameIds = new Set(frames.map((f) => f.id))
  const cels = new Map<string, Cel>()
  const celsRaw: unknown[] = Array.isArray(raw.cels) ? raw.cels : []
  celsRaw.forEach((c, i) => {
    if (!isObj(c)) return fail(`cels[${i}] must be an object.`)
    const layer = str(c.layer, `cels[${i}].layer`)
    const frame = str(c.frame, `cels[${i}].frame`)
    if (!layerIds.has(layer)) fail(`cels[${i}] refers to unknown layer "${layer}".`)
    if (!frameIds.has(frame)) fail(`cels[${i}] refers to unknown frame "${frame}".`)
    const img = decodePng(base64ToBytes(str(c.png, `cels[${i}].png`)))
    cels.set(celKey(layer, frame), {
      x: num(c.x, `cels[${i}].x`),
      y: num(c.y, `cels[${i}].y`),
      w: img.width,
      h: img.height,
      data: img.data
    })
  })

  return {
    id: str(raw.doc.id, 'doc.id', createId('doc')),
    name: str(raw.doc.name, 'doc.name', 'Untitled'),
    width,
    height,
    palette,
    layers,
    frames,
    cels,
    tags,
    references
  }
}
