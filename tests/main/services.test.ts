import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getBuiltinPalette } from '../../src/core'
import { createNodeServices, registerServices, resolveUnder } from '../../src/main/services'
import { IPC } from '../../src/shared/ipc'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixel-studio-test-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('resolveUnder', () => {
  const base = resolve('/base/exports')
  it('places relative names in the base folder', () => {
    expect(resolveUnder(base, 'a.png')).toBe(join(base, 'a.png'))
    expect(resolveUnder(base, 'a.png', 'sub')).toBe(join(base, 'sub', 'a.png'))
  })
  it('rejects traversal out of the folder', () => {
    expect(() => resolveUnder(base, '../x.png')).toThrow(/leaves/)
    expect(() => resolveUnder(base, 'a.png', '../other')).toThrow(/outside/)
    expect(() => resolveUnder(base, 'sub/../../x.png')).toThrow(/leaves/)
  })
  it('uses absolute paths as given', () => {
    const abs = resolve(root, 'elsewhere', 'a.png')
    expect(resolveUnder(base, abs)).toBe(abs)
  })
  it('rejects empty names', () => {
    expect(() => resolveUnder(base, '  ')).toThrow()
  })
})

describe('node services', () => {
  it('creates the folders and resolves export/project paths', async () => {
    const s = createNodeServices(join(root, 'a'))
    expect(await s.resolveExportPath('x.png')).toBe(join(root, 'a', 'exports', 'x.png'))
    expect(await s.resolveProjectPath('x.pxs')).toBe(join(root, 'a', 'projects', 'x.pxs'))
    await expect(s.resolveExportPath('../../evil.png')).rejects.toThrow()
  })

  it('writes (creating parents) and reads files', async () => {
    const s = createNodeServices(join(root, 'b'))
    const p = await s.resolveExportPath('deep.txt', 'one/two')
    await s.writeFile(p, 'hello')
    expect(await readFile(p, 'utf8')).toBe('hello')
    await s.writeFile(p, new Uint8Array([1, 2, 3]))
    expect(Array.from(await s.readFile(p))).toEqual([1, 2, 3])
  })

  it('stores user palettes as .hex and loads them back', async () => {
    const s = createNodeServices(join(root, 'c'))
    const pico = getBuiltinPalette('pico-8')!
    const info = await s.saveUserPalette({ ...pico, name: 'Moody Forest' })
    expect(info.path).toMatch(/Moody Forest\.hex$/)
    expect(info.id).toBe('moody-forest')
    expect((await s.listUserPalettes()).map((p) => [p.id, p.size])).toEqual([['moody-forest', 16]])
    const loaded = await s.loadUserPalette('moody-forest')
    expect(loaded?.colors.map((c) => c.hex.toLowerCase())).toEqual(pico.colors.map((c) => c.hex.toLowerCase()))
    expect((await s.loadUserPalette('Moody Forest'))?.name).toBe('Moody Forest')
    expect(await s.loadUserPalette('missing')).toBeNull()
  })

  it('registers a handler for every fs:* and palettes:* channel', async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    registerServices({ handle: (c, l) => void handlers.set(c, l) }, createNodeServices(join(root, 'd')))
    const channels = Object.values(IPC).filter((c) => c.startsWith('fs:') || c.startsWith('palettes:'))
    expect(channels.length).toBe(8)
    for (const c of channels) expect(handlers.has(c), c).toBe(true)
    const p = (await handlers.get(IPC.fsResolveExportPath)!({}, 'q.png')) as string
    await handlers.get(IPC.fsWriteFile)!({}, p, 'data')
    expect(await readFile(p, 'utf8')).toBe('data')
    expect(await handlers.get(IPC.palettesList)!({})).toEqual([])
  })
})
