import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetStore, defaultAssetsDir, matchesFilter, parseMetaFile, registerAssetIpc, serializeMetaFile, slugify } from '../../src/main/assets'
import { defaultRoot } from '../../src/main/services'
import { ASSETS_IPC } from '../../src/shared/assets'
import type { AssetMeta } from '../../src/tools/services'

const dirs: string[] = []
async function tempRoot(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'pixel-studio-assets-'))
  dirs.push(d)
  return join(d, 'assets')
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const meta = (over: Partial<Omit<AssetMeta, 'id'>> & { id?: string } = {}): Omit<AssetMeta, 'id'> & { id?: string } => ({
  name: 'Knight',
  kind: 'character',
  tags: ['fantasy'],
  width: 16,
  height: 24,
  frames: 4,
  paletteId: 'endesga-32',
  notes: 'Thick outline.\nTwo-tone shading.',
  ...over
})

describe('slugify', () => {
  it('makes folder-safe slugs', () => {
    expect(slugify('Red Knight!')).toBe('red-knight')
    expect(slugify('  --Ünïcode & spaces--  ')).toBe('n-code-spaces')
    expect(slugify('***')).toBe('asset')
    expect(slugify('a'.repeat(100)).length).toBe(48)
  })
})

describe('meta.md', () => {
  it('round-trips frontmatter and notes', () => {
    const m: AssetMeta = { id: 'knight', ...meta() } as AssetMeta
    const text = serializeMetaFile(m)
    expect(text.startsWith('---\n')).toBe(true)
    expect(text).toMatch(/\nkind: character\n/)
    expect(text).toMatch(/\nwidth: 16\n/)
    expect(text.endsWith('---\nThick outline.\nTwo-tone shading.\n')).toBe(true)
    expect(parseMetaFile('knight', text)).toEqual(m)
  })

  it('is lenient about missing or wrong fields and takes the id from the folder', () => {
    expect(parseMetaFile('x', '---\nid: other\nkind: banana\ntags: [A, a, b]\n---\n')).toEqual({ id: 'x', name: 'x', kind: 'prop', tags: ['a', 'b'], width: 0, height: 0, frames: 1 })
    expect(parseMetaFile('y', 'no frontmatter')).toMatchObject({ id: 'y', name: 'y' })
    expect(parseMetaFile('z', '---\n: : bad: [\n---\n')).toBeNull()
  })

  it('filters by kind and all tags', () => {
    const m = { id: 'a', ...meta({ tags: ['x', 'y'] }) } as AssetMeta
    expect(matchesFilter(m)).toBe(true)
    expect(matchesFilter(m, { kind: 'character', tags: ['X'] })).toBe(true)
    expect(matchesFilter(m, { kind: 'tile' })).toBe(false)
    expect(matchesFilter(m, { tags: ['x', 'z'] })).toBe(false)
  })
})

describe('AssetStore', () => {
  let store: AssetStore
  beforeEach(async () => {
    store = new AssetStore(await tempRoot())
  })

  it('saves, lists, gets and deletes', async () => {
    expect(await store.list()).toEqual([])
    const saved = await store.save({ meta: meta(), project: '{"pxs":1}', thumbnail: PNG })
    expect(saved).toMatchObject({ id: 'knight', name: 'Knight', kind: 'character', tags: ['fantasy'], frames: 4, notes: 'Thick outline.\nTwo-tone shading.' })
    // the folder layout
    expect(await readFile(join(store.root, 'knight', 'asset.pxs'), 'utf8')).toBe('{"pxs":1}')
    expect(Array.from(await readFile(join(store.root, 'knight', 'thumb.png')))).toEqual(Array.from(PNG))
    expect(await readFile(join(store.root, 'knight', 'meta.md'), 'utf8')).toMatch(/^---\nid: knight\nname: Knight\n/)

    expect(await store.list()).toEqual([saved])
    const got = await store.get('knight')
    expect(got).toEqual({ ...saved, project: '{"pxs":1}' })
    expect(Array.from((await store.thumbnail('knight'))!)).toEqual(Array.from(PNG))
    expect(await store.get('nope')).toBeNull()
    expect(await store.thumbnail('nope')).toBeNull()

    expect(await store.delete('knight')).toBe(true)
    expect(await store.delete('knight')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('gives unique slugs and overwrites when the id is given', async () => {
    const a = await store.save({ meta: meta(), project: 'a' })
    const b = await store.save({ meta: meta(), project: 'b' })
    const c = await store.save({ meta: meta({ name: 'Knight!' }), project: 'c' })
    expect([a.id, b.id, c.id]).toEqual(['knight', 'knight-2', 'knight-3'])
    const over = await store.save({ meta: meta({ id: 'knight', name: 'Renamed', tags: ['x'], notes: undefined }), project: 'new' })
    expect(over).toMatchObject({ id: 'knight', name: 'Renamed', tags: ['x'] })
    expect(over.notes).toBeUndefined()
    expect((await store.get('knight'))!.project).toBe('new')
    expect(await store.list()).toHaveLength(3)
  })

  it('keeps the old thumbnail when an overwrite has none', async () => {
    await store.save({ meta: meta(), project: 'a', thumbnail: PNG })
    await store.save({ meta: meta({ id: 'knight' }), project: 'b' })
    expect(await store.thumbnail('knight')).not.toBeNull()
  })

  it('filters the listing by kind and tags and sorts by name', async () => {
    await store.save({ meta: meta({ name: 'Zed', tags: ['a', 'b'] }), project: '' })
    await store.save({ meta: meta({ name: 'Amy', kind: 'background', tags: ['a'] }), project: '' })
    await store.save({ meta: meta({ name: 'Mid', kind: 'tile', tags: [] }), project: '' })
    expect((await store.list()).map((m) => m.name)).toEqual(['Amy', 'Mid', 'Zed'])
    expect((await store.list({ kind: 'background' })).map((m) => m.name)).toEqual(['Amy'])
    expect((await store.list({ tags: ['a'] })).map((m) => m.name)).toEqual(['Amy', 'Zed'])
    expect((await store.list({ tags: ['a', 'b'] })).map((m) => m.name)).toEqual(['Zed'])
  })

  it('rejects bad input and ignores stray folders', async () => {
    await expect(store.save({ meta: meta({ name: '  ' }), project: '' })).rejects.toThrow(/name/)
    await expect(store.save({ meta: meta({ id: '../evil' }), project: '' })).rejects.toThrow(/Invalid asset id/)
    expect(await store.get('../evil')).toBeNull()
    expect(await store.delete('../evil')).toBe(false)
    await mkdir(join(store.root, 'stray'), { recursive: true })
    await writeFile(join(store.root, 'stray', 'readme.txt'), 'x')
    await writeFile(join(store.root, 'file.txt'), 'x')
    await mkdir(join(store.root, 'Not Valid'), { recursive: true })
    expect(await store.list()).toEqual([])
  })

  it('picks up a hand-edited meta.md', async () => {
    await store.save({ meta: meta(), project: 'a' })
    await writeFile(join(store.root, 'knight', 'meta.md'), '---\nname: Hand edited\nkind: prop\ntags: [one]\nwidth: 1\nheight: 2\nframes: 3\n---\nNew notes\n')
    expect(await store.get('knight')).toMatchObject({ name: 'Hand edited', kind: 'prop', tags: ['one'], notes: 'New notes', frames: 3 })
  })

  it('watch() reports changes in the folder (debounced)', async () => {
    const onChange = vi.fn()
    const stop = await store.watch(onChange, 50)
    try {
      await store.save({ meta: meta(), project: 'a', thumbnail: PNG })
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 8000, interval: 50 })
    } finally {
      await stop()
    }
  })
})

describe('registerAssetIpc', () => {
  it('serves the assets:* channels and notifies after changes', async () => {
    const store = new AssetStore(await tempRoot())
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    const notify = vi.fn()
    registerAssetIpc({ handle: (c, l) => void handlers.set(c, l) }, store, notify)
    const call = (c: string, ...a: unknown[]): Promise<unknown> => Promise.resolve(handlers.get(c)!({}, ...a))
    const saved = (await call(ASSETS_IPC.save, { meta: meta(), project: 'p', thumbnail: PNG })) as AssetMeta
    expect(saved.id).toBe('knight')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(((await call(ASSETS_IPC.list, null)) as AssetMeta[]).map((m) => m.id)).toEqual(['knight'])
    expect(((await call(ASSETS_IPC.list, { kind: 'tile' })) as AssetMeta[])).toEqual([])
    expect(((await call(ASSETS_IPC.get, 'knight')) as { project: string }).project).toBe('p')
    expect(Array.from((await call(ASSETS_IPC.thumbnail, 'knight')) as Uint8Array)).toEqual(Array.from(PNG))
    expect(await call(ASSETS_IPC.delete, 'knight')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(await call(ASSETS_IPC.delete, 'knight')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)
  })
})

describe('PIXEL_STUDIO_HOME', () => {
  it('moves the data root (and so the assets folder)', () => {
    const prev = process.env['PIXEL_STUDIO_HOME']
    try {
      process.env['PIXEL_STUDIO_HOME'] = join(tmpdir(), 'ps-home-override')
      expect(defaultRoot()).toBe(join(tmpdir(), 'ps-home-override'))
      expect(defaultAssetsDir()).toBe(join(tmpdir(), 'ps-home-override', 'assets'))
      delete process.env['PIXEL_STUDIO_HOME']
      expect(defaultRoot()).toMatch(/PixelStudio$/)
    } finally {
      if (prev === undefined) delete process.env['PIXEL_STUDIO_HOME']
      else process.env['PIXEL_STUDIO_HOME'] = prev
    }
  })
})
