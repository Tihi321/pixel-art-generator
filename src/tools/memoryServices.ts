// In-memory ToolServices for tests (and for hosts without a filesystem).

import { type Palette, clonePalette } from '../core'
import type { AssetData, AssetMeta, AssetService, ToolServices, UserPaletteInfo } from './services'

export interface MemoryToolServices extends ToolServices {
  /** Files written so far (path -> bytes). Tests can pre-seed entries to feed readFile. */
  files: Map<string, Uint8Array>
  userPalettes: Map<string, Palette>
  /** The in-memory asset library (id -> asset data and thumbnail). */
  assetStore: Map<string, { data: AssetData; thumbnail?: Uint8Array }>
  assets: AssetService
  /** Convenience: decoded text of a written file. */
  readText(path: string): string
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'palette'
  )
}

function assetSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'asset'
  )
}

function createMemoryAssets(store: Map<string, { data: AssetData; thumbnail?: Uint8Array }>): AssetService {
  const metaOf = (d: AssetData): AssetMeta => {
    const { project: _project, ...meta } = d
    void _project
    return { ...meta, tags: [...meta.tags] }
  }
  return {
    async list(filter) {
      const want = (filter?.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)
      return [...store.values()]
        .map((e) => metaOf(e.data))
        .filter((m) => (!filter?.kind || m.kind === filter.kind) && want.every((t) => m.tags.includes(t)))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async get(id) {
      const e = store.get(id)
      return e ? { ...e.data, tags: [...e.data.tags] } : null
    },
    async save(input) {
      let id = input.meta.id
      if (!id) {
        const base = assetSlug(input.meta.name)
        id = base
        for (let n = 2; store.has(id); n++) id = `${base}-${n}`
      }
      const tags = [...new Set(input.meta.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
      const data: AssetData = { ...input.meta, id, tags, project: input.project }
      const prev = store.get(id)
      store.set(id, { data, thumbnail: input.thumbnail ? input.thumbnail.slice() : prev?.thumbnail })
      return metaOf(data)
    },
    async delete(id) {
      return store.delete(id)
    },
    async thumbnail(id) {
      return store.get(id)?.thumbnail?.slice() ?? null
    }
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || p.startsWith('~') || /^[a-zA-Z]:/.test(p)
}

export function createMemoryToolServices(opts: { exportDir?: string; projectDir?: string } = {}): MemoryToolServices {
  const exportDir = opts.exportDir ?? '/mem/exports'
  const projectDir = opts.projectDir ?? '/mem/projects'
  const files = new Map<string, Uint8Array>()
  const userPalettes = new Map<string, Palette>()
  const assetStore = new Map<string, { data: AssetData; thumbnail?: Uint8Array }>()
  const join = (dir: string, name: string): string => `${dir.replace(/[/\\]+$/, '')}/${name.replace(/^[/\\]+/, '')}`
  const resolve = (base: string) => async (name: string, dir?: string): Promise<string> => {
    if (isAbsolute(name)) return name
    const d = dir ? (isAbsolute(dir) ? dir : join(base, dir)) : base
    return join(d, name)
  }
  return {
    files,
    userPalettes,
    assetStore,
    assets: createMemoryAssets(assetStore),
    readText: (path) => {
      const b = files.get(path)
      if (!b) throw new Error(`No file ${path}`)
      return new TextDecoder().decode(b)
    },
    async writeFile(path, data) {
      files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data.slice())
    },
    async readFile(path) {
      const b = files.get(path)
      if (!b) throw new Error(`File not found: ${path}`)
      return b.slice()
    },
    resolveExportPath: resolve(exportDir),
    resolveProjectPath: resolve(projectDir),
    async listUserPalettes(): Promise<UserPaletteInfo[]> {
      return [...userPalettes.entries()].map(([id, p]) => ({ id, name: p.name, size: p.colors.length }))
    },
    async saveUserPalette(palette) {
      const id = slug(palette.name)
      userPalettes.set(id, { ...clonePalette(palette), id })
      return { id, name: palette.name, size: palette.colors.length, path: `/mem/palettes/${id}.json` }
    },
    async loadUserPalette(idOrName) {
      const key = idOrName.trim().toLowerCase()
      for (const [id, p] of userPalettes) {
        if (id === key || slug(p.name) === slug(idOrName) || p.name.toLowerCase() === key) return clonePalette(p)
      }
      return null
    }
  }
}
