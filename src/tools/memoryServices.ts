// In-memory ToolServices for tests (and for hosts without a filesystem).

import { type Palette, clonePalette } from '../core'
import type { ToolServices, UserPaletteInfo } from './services'

export interface MemoryToolServices extends ToolServices {
  /** Files written so far (path -> bytes). Tests can pre-seed entries to feed readFile. */
  files: Map<string, Uint8Array>
  userPalettes: Map<string, Palette>
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

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || p.startsWith('~') || /^[a-zA-Z]:/.test(p)
}

export function createMemoryToolServices(opts: { exportDir?: string; projectDir?: string } = {}): MemoryToolServices {
  const exportDir = opts.exportDir ?? '/mem/exports'
  const projectDir = opts.projectDir ?? '/mem/projects'
  const files = new Map<string, Uint8Array>()
  const userPalettes = new Map<string, Palette>()
  const join = (dir: string, name: string): string => `${dir.replace(/[/\\]+$/, '')}/${name.replace(/^[/\\]+/, '')}`
  const resolve = (base: string) => async (name: string, dir?: string): Promise<string> => {
    if (isAbsolute(name)) return name
    const d = dir ? (isAbsolute(dir) ? dir : join(base, dir)) : base
    return join(d, name)
  }
  return {
    files,
    userPalettes,
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
