import { describe, expect, it } from 'vitest'
import { base64ToBytes, decodePng, hasPngSignature } from '../../src/core'
import { resultText } from '../../src/tools'
import { jsonOf, setup } from './helpers'

describe('draw_grid / read_grid', () => {
  it('round-trips a grid with a legend', async () => {
    const t = setup()
    const rows = ['..kk..', '.kssk.', '.kssk.', '..kk..']
    const legend = { '.': null, k: '#1a1c2c', s: '#f4b41b' } as Record<string, string | null>
    await t.ok('draw_grid', { rows, legend, x: 3, y: 2 })
    const r = jsonOf(await t.ok('read_grid', { x: 3, y: 2, w: 6, h: 4 }))
    const back = r.legend as Record<string, string | null>
    const colorsOf = (rs: string[], lg: Record<string, string | null>): Array<Array<string | null>> =>
      rs.map((row) => Array.from(row).map((c) => lg[c]?.toLowerCase() ?? null))
    expect(colorsOf(r.rows as string[], back)).toEqual(colorsOf(rows, legend))
    // feeding read_grid's output back changes nothing
    const before = [...t.doc.cels.values()].map((c) => Array.from(c.data))
    await t.ok('draw_grid', { rows: r.rows, legend: r.legend, x: 3, y: 2 })
    expect([...t.doc.cels.values()].map((c) => Array.from(c.data))).toEqual(before)
  })

  it('uses palette-index characters without a legend', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['0.8'] })
    const r = jsonOf(await t.ok('read_grid', { x: 0, y: 0, w: 3, h: 1 }))
    expect(r.rows).toEqual(['0.8'])
  })

  it('reports a readable error for an unknown legend character', async () => {
    const t = setup()
    const r = await t.call('draw_grid', { rows: ['xy'], legend: { x: '#fff' } })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toMatch(/y/)
  })
})

describe('frames, layers and tags', () => {
  it('adds frames, duplicates and tags them', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['0'] })
    await t.ok('duplicate_frame', {})
    await t.ok('add_frame', { durationMs: 250 })
    expect(t.doc.frames).toHaveLength(3)
    expect(t.doc.frames[2]!.durationMs).toBe(250)
    await t.ok('create_tag', { name: 'walk', from: 0, to: 1 })
    expect(t.doc.tags.map((x) => x.name)).toEqual(['walk'])
    expect(resultText(await t.ok('get_document'))).toContain('walk')
    await t.ok('delete_tag', { tag: 'walk' })
    expect(t.doc.tags).toHaveLength(0)
  })

  it('adds and updates layers', async () => {
    const t = setup()
    await t.ok('add_layer', { name: 'outline' })
    expect(t.doc.layers.map((l) => l.name)).toContain('outline')
    await t.ok('update_layer', { layer: 'outline', opacity: 0.5, visible: false })
    const l = t.doc.layers.find((x) => x.name === 'outline')!
    expect(l.opacity).toBe(0.5)
    expect(l.visible).toBe(false)
  })
})

describe('palette tools', () => {
  it('remaps art to another palette', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['aa'], legend: { a: '#fe0000' } })
    await t.ok('remap_to_palette', { palette: 'gameboy' })
    const gb = new Set(t.doc.palette.colors.map((c) => c.hex.toLowerCase()))
    expect(gb.size).toBeLessThanOrEqual(8)
    const px = [...t.doc.cels.values()][0]!.data[0]!
    const hex = '#' + [px & 255, (px >>> 8) & 255, (px >>> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('')
    expect(gb.has(hex)).toBe(true)
  })

  it('remap_to_palette resolves layer and frame like the other tools', async () => {
    const t = setup()
    await t.ok('add_layer', { name: 'top' })
    await t.ok('draw_grid', { rows: ['a'], legend: { a: '#fe0000' }, layer: 'top' })
    expect((await t.call('remap_to_palette', { layer: 'nope' })).isError).toBe(true)
    expect((await t.call('remap_to_palette', { frame: 9 })).isError).toBe(true)
    await t.ok('remap_to_palette', { palette: 'pico-8', layer: '1', frame: '0' })
  })

  it('sets and saves a custom palette', async () => {
    const t = setup()
    await t.ok('set_palette', { name: 'Forest', colors: ['#0b1d12', '#1f4d2b', '#3f8f3a'] })
    expect(t.doc.palette.colors).toHaveLength(3)
    await t.ok('save_palette', {})
    const list = jsonOf(await t.ok('list_palettes')) as unknown as { palettes: Array<{ id: string; source: string }> }
    expect(list.palettes.some((p) => p.source === 'user' && p.id === 'forest')).toBe(true)
  })
})

describe('render_preview', () => {
  it('returns a valid PNG image', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['0123'] })
    const r = await t.ok('render_preview', { scale: 4, background: '#000000' })
    const img = r.content.find((c) => c.type === 'image')
    expect(img).toBeDefined()
    if (img?.type !== 'image') throw new Error('no image')
    expect(img.mimeType).toBe('image/png')
    const bytes = base64ToBytes(img.data)
    expect(hasPngSignature(bytes)).toBe(true)
    const png = decodePng(bytes)
    expect(png.width).toBe(64)
    expect(png.height).toBe(64)
  })

  it('accepts transparent and checker backgrounds', async () => {
    const t = setup()
    expect((await t.call('render_preview', { background: 'transparent' })).isError).toBeFalsy()
    expect((await t.call('render_preview', { background: 'checker' })).isError).toBeFalsy()
    expect((await t.call('render_preview', { background: 'not a color' })).isError).toBe(true)
  })
})

describe('export tools', () => {
  it('export_png writes the current frame and all frames', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['0'] })
    await t.ok('duplicate_frame')
    const one = resultText(await t.ok('export_png', { path: 'one', scale: 2 }))
    expect(one).toContain('/mem/exports/one.png')
    const png = decodePng(t.services.files.get('/mem/exports/one.png')!)
    expect(png.width).toBe(32)
    await t.ok('export_png', { path: 'all', frames: 'all' })
    expect(t.services.files.has('/mem/exports/all_0.png')).toBe(true)
    expect(t.services.files.has('/mem/exports/all_1.png')).toBe(true)
  })

  it('export_spritesheet writes png and json with correct metadata', async () => {
    const t = setup({ width: 8, height: 8 })
    await t.ok('draw_grid', { rows: ['0'] })
    await t.ok('duplicate_frame')
    await t.ok('duplicate_frame')
    await t.ok('set_frame_duration', { frames: 1, durationMs: 200 })
    await t.ok('create_tag', { name: 'idle', from: 0, to: 2 })
    const r = await t.ok('export_spritesheet', { path: 'hero', scale: 2, padding: 1 })
    const text = resultText(r)
    expect(text).toContain('/mem/exports/hero.png')
    expect(text).toContain('/mem/exports/hero.json')
    const png = decodePng(t.services.files.get('/mem/exports/hero.png')!)
    expect(png.width).toBe(16 * 3 + 2)
    expect(png.height).toBe(16)
    const meta = JSON.parse(t.services.readText('/mem/exports/hero.json')) as {
      frames: Array<{ filename: string; frame: { x: number; y: number; w: number; h: number }; duration: number }>
      meta: { image: string; size: { w: number; h: number }; frameTags: Array<{ name: string; from: number; to: number }> }
    }
    expect(meta.frames).toHaveLength(3)
    expect(meta.frames[1]!.duration).toBe(200)
    expect(meta.frames[1]!.frame).toMatchObject({ x: 17, y: 0, w: 16, h: 16 })
    expect(meta.meta.image).toBe('hero.png')
    expect(meta.meta.size).toEqual({ w: 50, h: 16 })
    expect(meta.meta.frameTags).toEqual([expect.objectContaining({ name: 'idle', from: 0, to: 2 })])
  })

  it('export_spritesheet supports other layouts and formats', async () => {
    const t = setup({ width: 4, height: 4 })
    await t.ok('duplicate_frame')
    await t.ok('duplicate_frame')
    await t.ok('duplicate_frame')
    await t.ok('export_spritesheet', { path: 'g', layout: 'grid', columns: 2, format: 'texturepacker' })
    const png = decodePng(t.services.files.get('/mem/exports/g.png')!)
    expect([png.width, png.height]).toEqual([8, 8])
    expect(JSON.parse(t.services.readText('/mem/exports/g.json'))).toHaveProperty('frames')
  })

  it('export_gif writes a GIF', async () => {
    const t = setup({ width: 4, height: 4 })
    await t.ok('draw_grid', { rows: ['0'] })
    await t.ok('duplicate_frame')
    await t.ok('create_tag', { name: 'a', from: 0, to: 1, direction: 'pingpong' })
    const r = await t.ok('export_gif', { path: 'anim', tag: 'a' })
    expect(resultText(r)).toContain('/mem/exports/anim.gif')
    const bytes = t.services.files.get('/mem/exports/anim.gif')!
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a')
  })

  it('reports unknown tags readably', async () => {
    const t = setup()
    const r = await t.call('export_spritesheet', { tags: ['nope'] })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toMatch(/nope/)
  })
})

describe('undo granularity', () => {
  it('one tool call is one undo step', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    await t.ok('draw_grid', { rows: ['0000'] })
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    await t.ok('draw_line', { x0: 0, y0: 0, x1: 5, y1: 5, color: 1 })
    expect(t.session.history.undoDepth).toBe(d0 + 2)
    await t.ok('undo')
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    await t.ok('redo')
    expect(t.session.history.undoDepth).toBe(d0 + 2)
  })

  it('failed calls leave no undo step', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    const bad = await t.call('draw_grid', { rows: ['0', '00'] })
    expect(bad.isError).toBe(true)
    expect(t.session.history.undoDepth).toBe(d0)
  })

  it('read-only tools and export create no undo step', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    await t.ok('get_document')
    await t.ok('render_preview')
    await t.ok('export_png', {})
    expect(t.session.history.undoDepth).toBe(d0)
  })

  it('a turn is squashed to one undo step', async () => {
    const t = setup()
    const d0 = t.session.history.undoDepth
    t.session.beginTurn('Agent turn')
    await t.ok('draw_grid', { rows: ['0'] })
    await t.ok('add_frame')
    await t.ok('draw_grid', { rows: ['1'], x: 1 })
    expect(t.session.history.undoDepth).toBe(d0 + 3)
    t.session.endTurn()
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    expect(t.doc.frames).toHaveLength(2)
    await t.ok('undo')
    expect(t.doc.frames).toHaveLength(1)
    expect(t.doc.cels.size).toBe(0)
    expect(t.session.history.undoDepth).toBe(d0)
  })

  it('undo inside a turn never goes before the turn', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['0'] })
    t.session.beginTurn()
    const r = await t.ok('undo')
    expect(resultText(r)).toMatch(/Nothing to undo/)
    expect(t.doc.cels.size).toBe(1)
    t.session.endTurn()
  })

  it('undo and redo report when there is nothing to do', async () => {
    const t = setup()
    expect(resultText(await t.ok('undo'))).toMatch(/Nothing to undo/)
    expect(resultText(await t.ok('redo'))).toMatch(/Nothing to redo/)
  })
})

describe('project tools', () => {
  it('saves and re-opens a project through services', async () => {
    const t = setup()
    await t.ok('draw_grid', { rows: ['0'] })
    await t.ok('save_project', { path: 'p' })
    expect(t.services.files.has('/mem/projects/p.pxs')).toBe(true)
    await t.ok('new_document', { width: 4, height: 4 })
    expect(t.doc.width).toBe(4)
    await t.ok('open_project', { path: '/mem/projects/p.pxs' })
    expect(t.doc.width).toBe(16)
    expect(t.doc.cels.size).toBe(1)
  })
})
