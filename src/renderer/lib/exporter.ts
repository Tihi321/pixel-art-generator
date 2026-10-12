// Export planning: turns the document + dialog settings into files (name + bytes/text). Pure, no IO.

import {
  type Document,
  type SheetLayout,
  type SheetMetaFormat,
  buildSpriteSheet,
  encodeGif,
  encodePng,
  findTag,
  flattenFrame,
  sheetMetadata
} from '../../core'
import { buildSequence } from './playback'

export type ExportKind = 'png' | 'sheet' | 'gif'

export interface ExportSettings {
  kind: ExportKind
  /** File name without extension. */
  baseName: string
  /** Optional output folder (relative to ~/PixelStudio/exports, or absolute). */
  dir: string
  scale: number
  pngScope: 'current' | 'all'
  layout: SheetLayout
  /** Grid layout columns (0 = automatic). */
  columns: number
  padding: number
  /** Tag name or id; '' means all frames. */
  tag: string
  metaFormat: SheetMetaFormat
  gifLoop: boolean
}

export const DEFAULT_EXPORT: ExportSettings = {
  kind: 'sheet',
  baseName: '',
  dir: '',
  scale: 1,
  pngScope: 'current',
  layout: 'horizontal',
  columns: 0,
  padding: 0,
  tag: '',
  metaFormat: 'aseprite-array',
  gifLoop: true
}

export interface ExportFile {
  name: string
  data: Uint8Array | string
}

/** Make a safe file base name (no path separators or reserved characters). */
export function sanitizeBaseName(name: string, fallback = 'sprite'): string {
  const s = name
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
  return s || fallback
}

function clampInt(v: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback
}

/** Build the files an export would write. Throws readable errors (bad tag etc.). */
export function planExport(doc: Document, settings: ExportSettings, activeFrameIndex: number): ExportFile[] {
  const base = sanitizeBaseName(settings.baseName || doc.name)
  const scale = clampInt(settings.scale, 1, 64, 1)
  switch (settings.kind) {
    case 'png': {
      const indices = settings.pngScope === 'all' ? doc.frames.map((_, i) => i) : [Math.max(0, Math.min(doc.frames.length - 1, activeFrameIndex))]
      const pad = String(doc.frames.length - 1).length
      return indices.map((i) => ({
        name: settings.pngScope === 'all' ? `${base}_${String(i).padStart(pad, '0')}.png` : `${base}.png`,
        data: encodePng({ width: doc.width, height: doc.height, data: flattenFrame(doc, doc.frames[i]!.id) }, { scale })
      }))
    }
    case 'sheet': {
      const sheet = buildSpriteSheet(doc, {
        layout: settings.layout,
        columns: settings.layout === 'grid' && settings.columns > 0 ? clampInt(settings.columns, 1, 256, 1) : undefined,
        scale,
        padding: clampInt(settings.padding, 0, 256, 0),
        tags: settings.tag ? [settings.tag] : undefined,
        imageName: `${base}.png`
      })
      const png = encodePng({ width: sheet.width, height: sheet.height, data: sheet.data })
      const json = JSON.stringify(sheetMetadata(sheet, settings.metaFormat), null, 2)
      return [
        { name: `${base}.png`, data: png },
        { name: `${base}.json`, data: json }
      ]
    }
    case 'gif': {
      const tag = settings.tag ? findTag(doc, settings.tag) : undefined
      if (settings.tag && !tag) throw new Error(`Tag "${settings.tag}" not found.`)
      const seq = buildSequence(doc.frames.length, tag ?? null)
      const { bytes } = encodeGif({
        width: doc.width,
        height: doc.height,
        scale,
        loop: settings.gifLoop,
        frames: seq.map((i) => ({ data: flattenFrame(doc, doc.frames[i]!.id), delayMs: doc.frames[i]!.durationMs }))
      })
      return [{ name: `${base}.gif`, data: bytes }]
    }
  }
}
