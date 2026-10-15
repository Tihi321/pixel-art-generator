// ToolServices: the side-effecting capabilities tools need (files, user palettes, assets).
// Implemented in the renderer by calling main over IPC (src/renderer/toolBridgeClient.ts) and
// in memory for tests (src/tools/memoryServices.ts). No DOM, no Electron, no node:*.

import type { Palette } from '../core'
import type { UserPaletteInfo } from '../shared/ipc'

export type { UserPaletteInfo }

export type AssetKind = 'character' | 'background' | 'tile' | 'prop'

/** Metadata of a library asset (Phase 5 stores it in meta.md frontmatter). */
export interface AssetMeta {
  id: string
  name: string
  kind: AssetKind
  tags: string[]
  width: number
  height: number
  frames: number
  paletteId?: string
  /** Free-text style notes. */
  notes?: string
}

export interface AssetFilter {
  kind?: AssetKind
  /** Assets that have ALL of these tags. */
  tags?: string[]
}

export interface AssetData extends AssetMeta {
  /** The asset as .pxs project text. */
  project: string
}

export interface AssetSaveInput {
  meta: Omit<AssetMeta, 'id'> & { id?: string }
  /** The asset as .pxs project text. */
  project: string
  /** Thumbnail PNG bytes. */
  thumbnail?: Uint8Array
}

/** The asset library (~/PixelStudio/assets; see src/main/assets.ts). */
export interface AssetService {
  list(filter?: AssetFilter): Promise<AssetMeta[]>
  get(id: string): Promise<AssetData | null>
  /** Saves (a given `meta.id` overwrites that asset) and returns the stored metadata, with its id. */
  save(input: AssetSaveInput): Promise<AssetMeta>
  delete(id: string): Promise<boolean>
  /** Thumbnail PNG bytes, or null when the asset or its thumbnail does not exist. */
  thumbnail(id: string): Promise<Uint8Array | null>
}

export interface ToolServices {
  /** Write a file (creating parent folders). Text is UTF-8. Rejects when the path is not allowed. */
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  /** Read a file as bytes. */
  readFile(path: string): Promise<Uint8Array>
  /**
   * Absolute path for an export. An absolute `suggestedName` is used as is; a relative one is placed in
   * `dir` (default ~/PixelStudio/exports; a relative `dir` is relative to that default).
   */
  resolveExportPath(suggestedName: string, dir?: string): Promise<string>
  /** Like resolveExportPath, but the default folder is ~/PixelStudio/projects. */
  resolveProjectPath(suggestedName: string, dir?: string): Promise<string>
  /** Palettes the user saved (stored in ~/PixelStudio/palettes). */
  listUserPalettes(): Promise<UserPaletteInfo[]>
  /** Save a palette; returns its id (derived from the name). Overwrites a palette with the same id. */
  saveUserPalette(palette: Palette): Promise<UserPaletteInfo & { path?: string }>
  /** Load a user palette by id or name; null when unknown. */
  loadUserPalette(idOrName: string): Promise<Palette | null>
  /** Decode a non-PNG image (JPEG, WebP...) to RGBA. Undefined in hosts that cannot (then only PNG imports work). */
  decodeImage?(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint32Array }> | { width: number; height: number; data: Uint32Array }
  /** Asset library. Undefined in hosts without one (the asset tools then report that). */
  assets?: AssetService
}
