// Helpers shared by the tool definitions: argument schemas, target/color resolution, result text.

import { z } from 'zod'
import {
  type Document,
  type Frame,
  type Layer,
  type Palette,
  type Raster,
  type Rect,
  TRANSPARENT,
  createPaintCommand,
  findFrame,
  findLayer,
  frameIndex,
  getBuiltinPalette,
  hexToRgba,
  layerIndex,
  parseHexColor,
  rgbaToHex,
  requireFrame,
  requireLayer
} from '../core'
import type { ToolResult } from '../shared/tools'
import type { ToolContext } from './registry'
import { textResult } from './registry'
import type { EditorSession } from './session'

// ---------------------------------------------------------------- schemas

/** Strict object: unknown argument names are reported instead of silently ignored. */
export const obj = z.strictObject

/** The `document` argument every document tool accepts. */
export const DOCUMENT_DESC = 'documentId (see list_documents). Default: the current document.'
export const LAYER_REF_DESC = 'Layer id, exact name, or 0-based index (0 = bottom layer).'
export const FRAME_REF_DESC = 'Frame id or 0-based index (0 = first frame).'
export const COLOR_DESC =
  'Color: hex "#rrggbb" (or "#rgb"/"#rrggbbaa"), a palette index like 8 or "p8", a palette color name, or "transparent".'

export function layerRef(desc: string = LAYER_REF_DESC) {
  return z.union([z.string(), z.number().int()]).describe(desc)
}
export function frameRef(desc: string = FRAME_REF_DESC) {
  return z.union([z.string(), z.number().int()]).describe(desc)
}
export function colorArg(desc: string = COLOR_DESC) {
  return z.union([z.string(), z.number().int().nonnegative()]).describe(desc)
}

/** The `layer` / `frame` arguments every drawing tool accepts (default: the active layer/frame). */
export const targetShape = {
  layer: layerRef(`${LAYER_REF_DESC} Default: the active layer.`).optional(),
  frame: frameRef(`${FRAME_REF_DESC} Default: the active frame.`).optional()
}

export const rectShape = {
  x: z.number().int().describe('Left edge (pixels, 0 = left of the canvas).'),
  y: z.number().int().describe('Top edge (pixels, 0 = top of the canvas).'),
  w: z.number().int().min(1).describe('Width in pixels.'),
  h: z.number().int().min(1).describe('Height in pixels.')
}
export const regionSchema = z.strictObject(rectShape)

export const MAX_GRID_SIDE = 256

// ---------------------------------------------------------------- results

export function ok(text: string): ToolResult {
  return textResult(text)
}

export function plural(n: number, word: string, pluralForm = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralForm}`
}

export function fmtRect(r: Rect | null): string {
  return r ? `x=${r.x}, y=${r.y}, w=${r.w}, h=${r.h}` : 'nothing'
}

// ---------------------------------------------------------------- resolving layers, frames, colors

function numericString(ref: string): number | null {
  return /^\d+$/.test(ref.trim()) ? Number(ref.trim()) : null
}

export function resolveLayer(session: EditorSession, ref?: string | number): Layer {
  if (ref === undefined) return session.activeLayer
  const doc = session.doc
  if (typeof ref === 'string' && !findLayer(doc, ref)) {
    const n = numericString(ref)
    if (n !== null) return requireLayer(doc, n)
  }
  return requireLayer(doc, ref)
}

export function resolveFrame(session: EditorSession, ref?: string | number): Frame {
  if (ref === undefined) return session.activeFrame
  const doc = session.doc
  if (typeof ref === 'string' && !findFrame(doc, ref)) {
    const n = numericString(ref)
    if (n !== null) return requireFrame(doc, n)
  }
  return requireFrame(doc, ref)
}

export function describeLayer(doc: Document, layer: Layer): string {
  return `layer "${layer.name}" (index ${layerIndex(doc, layer.id)}, id ${layer.id})`
}
export function describeFrame(doc: Document, frame: Frame): string {
  return `frame ${frameIndex(doc, frame.id)} (id ${frame.id})`
}

/** Packed RGBA for a color argument (see COLOR_DESC). Throws an LLM-readable Error. */
export function parseColor(doc: Document, value: unknown): number {
  if (value === null || value === undefined) return TRANSPARENT
  const byIndex = (i: number): number => {
    const n = doc.palette.colors.length
    if (!Number.isInteger(i) || i < 0 || i >= n) {
      throw new Error(`Palette index ${i} is out of range: the document palette has ${n} color(s) (indices 0-${n - 1}). Use get_palette to see them.`)
    }
    return hexToRgba(doc.palette.colors[i]!.hex)
  }
  if (typeof value === 'number') return byIndex(value)
  if (typeof value !== 'string') throw new Error(`Invalid color ${JSON.stringify(value)}. ${COLOR_DESC}`)
  const s = value.trim()
  const lower = s.toLowerCase()
  if (lower === '' || lower === 'transparent' || lower === 'none' || lower === 'clear') return TRANSPARENT
  const p = /^p(\d+)$/i.exec(s)
  if (p) return byIndex(Number(p[1]))
  if (/^\d{1,2}$/.test(s)) return byIndex(Number(s))
  if (s.startsWith('#')) {
    const c = parseHexColor(s)
    if (c === null) throw new Error(`Invalid color "${value}". Use "#rrggbb", a palette index (8 or "p8") or a palette color name.`)
    return c
  }
  const named = doc.palette.colors.findIndex((c) => c.name && c.name.toLowerCase() === lower)
  if (named >= 0) return hexToRgba(doc.palette.colors[named]!.hex)
  const c = parseHexColor(s)
  if (c === null) {
    throw new Error(`Invalid color "${value}". Use "#rrggbb", a palette index (8 or "p8"), a palette color name or "transparent".`)
  }
  return c
}

/** Color argument as a hex string for grid legends ("transparent" -> null). */
export function colorToLegendHex(doc: Document, value: unknown): string | null {
  const c = parseColor(doc, value)
  return c >>> 24 === 0 ? null : rgbaToHex(c)
}

// ---------------------------------------------------------------- painting

export interface PaintOutcome {
  /** Pixels touched by the operation (clipped to the canvas), or null if nothing was drawn. */
  dirty: Rect | null
  /** Extra sentence for the result text. */
  note?: string
}

/**
 * Shared flow of every drawing tool: resolve layer/frame (default active), run `mutate` on a
 * canvas-sized copy of the cel, record the diff as one command, and build a short result text.
 */
export function paintCel(
  ctx: ToolContext,
  target: { layer?: string | number; frame?: string | number },
  label: string,
  mutate: (img: Raster, doc: Document) => Rect | null | PaintOutcome
): ToolResult {
  const { session } = ctx
  const doc = session.doc
  const layer = resolveLayer(session, target.layer)
  const frame = resolveFrame(session, target.frame)
  let outcome: PaintOutcome = { dirty: null }
  const cmd = createPaintCommand(doc, {
    layer: layer.id,
    frame: frame.id,
    label,
    mutate: (img, d) => {
      const r = mutate(img, d)
      outcome = r !== null && typeof r === 'object' && 'dirty' in r ? r : { dirty: r as Rect | null }
    }
  })
  const where = `${describeLayer(doc, layer)}, ${describeFrame(doc, frame)}`
  const notes: string[] = []
  if (outcome.note) notes.push(outcome.note)
  if (!layer.visible) notes.push('Note: this layer is hidden, so the change will not show in previews/exports until it is made visible.')
  if (!cmd) return ok([`${label}: no pixels changed on ${where} (everything drawn matched what was already there, or fell outside the canvas ${doc.width}x${doc.height}).`, ...notes].join(' '))
  session.execute(cmd)
  return ok([`${label}: touched ${fmtRect(outcome.dirty)} on ${where}.`, ...notes].join(' '))
}

// ---------------------------------------------------------------- palettes

export interface PaletteListing {
  id: string
  name: string
  size: number
  source: 'builtin' | 'user'
  description?: string
}

export async function findPalette(ctx: ToolContext, ref: string): Promise<Palette | null> {
  const builtin = getBuiltinPalette(ref)
  if (builtin) return builtin
  const user = await ctx.services.loadUserPalette(ref)
  if (user) return user
  return null
}

export function paletteNotFound(ref: string): Error {
  return new Error(`Palette "${ref}" not found. Call list_palettes to see built-in and saved palettes.`)
}

export function summarizePaletteColors(p: Palette): Array<{ index: number; hex: string; name?: string }> {
  return p.colors.map((c, index) => (c.name ? { index, hex: c.hex, name: c.name } : { index, hex: c.hex }))
}

/** File stem without folder or extension. */
export function pathStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Replace the extension (or add one) so that `name` ends with `.ext`. */
export function withExtension(name: string, ext: string): string {
  const re = new RegExp(`\\.${ext}$`, 'i')
  if (re.test(name)) return name
  const stripped = name.replace(/\.[a-z0-9]{1,5}$/i, '')
  return `${stripped}.${ext}`
}

/** A file-name-safe version of a document name. */
export function safeFileName(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'sprite'
}
