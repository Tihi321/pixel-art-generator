// Main-process implementation of ToolServices: file IO, export/project path resolution and the user
// palette library, exposed to the renderer through ipcMain.handle (see IPC.fs* / IPC.palettes*).
// No Electron import: `registerServices` receives an ipcMain-like object, so this is testable.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { type Palette, exportPalette, parsePalette } from '../core'
import { IPC, type UserPaletteInfo } from '../shared/ipc'
import type { BridgeIpc } from './toolBridge'

export interface PixelStudioPaths {
  root: string
  exports: string
  projects: string
  palettes: string
}

/** `~/PixelStudio`, or the folder in the PIXEL_STUDIO_HOME environment variable (used by tests / e2e runs). */
export function defaultRoot(): string {
  const override = process.env['PIXEL_STUDIO_HOME']?.trim()
  return override ? resolve(override) : join(homedir(), 'PixelStudio')
}

export function pixelStudioPaths(root: string = defaultRoot()): PixelStudioPaths {
  return { root, exports: join(root, 'exports'), projects: join(root, 'projects'), palettes: join(root, 'palettes') }
}

async function ensureDirs(paths: PixelStudioPaths): Promise<void> {
  await Promise.all([paths.exports, paths.projects, paths.palettes].map((d) => mkdir(d, { recursive: true })))
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/** True when `target` is `base` or inside it. */
function isInside(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolve a file name for an export/project: an absolute `name` is used as is; a relative one goes into
 * `dir` (default `base`; a relative `dir` is relative to `base`; an absolute `dir` is used as is). A
 * relative name or dir that escapes `base` (e.g. "../x") is rejected.
 */
export function resolveUnder(base: string, name: string, dir?: string): string {
  const n = expandHome(name.trim())
  if (!n) throw new Error('The file name is empty.')
  if (isAbsolute(n)) return resolve(n)
  let folder = base
  if (dir && dir.trim()) {
    const d = expandHome(dir.trim())
    if (isAbsolute(d)) folder = resolve(d)
    else {
      folder = resolve(base, d)
      if (!isInside(base, folder)) throw new Error(`The folder "${dir}" is outside ${base}. Use a path inside it or an absolute path.`)
    }
  }
  const full = resolve(folder, n)
  if (!isInside(folder, full)) throw new Error(`The file name "${name}" leaves the output folder ${folder}. Use a plain file name or an absolute path.`)
  return full
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

function paletteFileStem(name: string): string {
  const printable = Array.from(name)
    .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
    .join('')
  return printable.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'palette'
}

export interface NodeServices {
  paths: PixelStudioPaths
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  resolveExportPath(name: string, dir?: string): Promise<string>
  resolveProjectPath(name: string, dir?: string): Promise<string>
  listUserPalettes(): Promise<UserPaletteInfo[]>
  saveUserPalette(palette: Palette): Promise<UserPaletteInfo & { path: string }>
  loadUserPalette(idOrName: string): Promise<Palette | null>
  decodeImage?(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint32Array }> | { width: number; height: number; data: Uint32Array }
}

export function createNodeServices(root: string = defaultRoot()): NodeServices {
  const paths = pixelStudioPaths(root)

  const userPaletteFiles = async (): Promise<Array<{ id: string; name: string; file: string }>> => {
    await ensureDirs(paths)
    const entries = await readdir(paths.palettes)
    return entries
      .filter((f) => extname(f).toLowerCase() === '.hex')
      .map((f) => {
        const name = basename(f, extname(f))
        return { id: slug(name), name, file: join(paths.palettes, f) }
      })
  }

  const load = async (file: string, name: string, id: string): Promise<Palette> => {
    const p = parsePalette(await readFile(file), file, name)
    return { ...p, id, name }
  }

  return {
    paths,
    async writeFile(path, data) {
      const full = resolve(expandHome(path))
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, data)
    },
    async readFile(path) {
      const buf = await readFile(resolve(expandHome(path)))
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    },
    async resolveExportPath(name, dir) {
      await ensureDirs(paths)
      return resolveUnder(paths.exports, name, dir)
    },
    async resolveProjectPath(name, dir) {
      await ensureDirs(paths)
      return resolveUnder(paths.projects, name, dir)
    },
    async listUserPalettes() {
      const files = await userPaletteFiles()
      const out: UserPaletteInfo[] = []
      for (const f of files) {
        try {
          out.push({ id: f.id, name: f.name, size: (await load(f.file, f.name, f.id)).colors.length })
        } catch {
          /* skip unreadable files */
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    },
    async saveUserPalette(palette) {
      await ensureDirs(paths)
      const stem = paletteFileStem(palette.name)
      const file = join(paths.palettes, `${stem}.hex`)
      await writeFile(file, exportPalette({ ...palette, name: stem }, 'hex'))
      return { id: slug(stem), name: stem, size: palette.colors.length, path: file }
    },
    async loadUserPalette(idOrName) {
      const key = slug(idOrName)
      const hit = (await userPaletteFiles()).find((f) => f.id === key || f.name.toLowerCase() === idOrName.trim().toLowerCase())
      return hit ? load(hit.file, hit.name, hit.id) : null
    }
  }
}

/** Register the fs:* and palettes:* handlers. */
export function registerServices(ipc: BridgeIpc, services: NodeServices = createNodeServices()): NodeServices {
  ipc.handle(IPC.fsWriteFile, (_e, path, data) => services.writeFile(String(path), data as Uint8Array | string))
  ipc.handle(IPC.fsReadFile, (_e, path) => services.readFile(String(path)))
  ipc.handle(IPC.fsDecodeImage, (_e, bytes) => {
    if (!services.decodeImage) throw new Error('This app cannot decode images other than PNG.')
    return services.decodeImage(bytes as Uint8Array)
  })
  ipc.handle(IPC.fsResolveExportPath, (_e, name, dir) => services.resolveExportPath(String(name), typeof dir === 'string' ? dir : undefined))
  ipc.handle(IPC.fsResolveProjectPath, (_e, name, dir) => services.resolveProjectPath(String(name), typeof dir === 'string' ? dir : undefined))
  ipc.handle(IPC.palettesList, () => services.listUserPalettes())
  ipc.handle(IPC.palettesSave, (_e, palette) => services.saveUserPalette(palette as Palette))
  ipc.handle(IPC.palettesLoad, (_e, idOrName) => services.loadUserPalette(String(idOrName)))
  return services
}
