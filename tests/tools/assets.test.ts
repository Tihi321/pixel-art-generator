import { describe, expect, it } from 'vitest'
import { decodePng, deserializeProject, hasPngSignature, hexToRgba } from '../../src/core'
import { createDefaultRegistry, createMemoryToolServices, resultText } from '../../src/tools'
import type { ToolResult } from '../../src/tools'
import { jsonOf, setup } from './helpers'

const RED = '#ff0000'
const BLUE = '#0000ff'

/** A 6x6 document with a red 2x2 block at (1,1) on layer 1 and a blue pixel at (4,4) on layer "top". */
async function drawn(width = 6, height = 6) {
  const t = setup({ width, height })
  await t.ok('draw_grid', { rows: ['rr', 'rr'], legend: { r: RED }, x: 1, y: 1 })
  await t.ok('add_layer', { name: 'top' })
  await t.ok('draw_grid', { rows: ['b'], legend: { b: BLUE }, x: 4, y: 4 })
  return t
}

const images = (r: ToolResult): number => r.content.filter((c) => c.type === 'image').length

function pixel(t: { doc: ReturnType<typeof setup>['doc'] }, layerName: string, frame: number, x: number, y: number): number {
  const layer = t.doc.layers.find((l) => l.name === layerName)!
  const cel = t.doc.cels.get(`${layer.id}:${t.doc.frames[frame]!.id}`)
  if (!cel) return 0
  const lx = x - cel.x
  const ly = y - cel.y
  if (lx < 0 || ly < 0 || lx >= cel.w || ly >= cel.h) return 0
  return cel.data[ly * cel.w + lx]!
}

describe('save_as_asset', () => {
  it('saves the whole document with metadata, project text and a thumbnail', async () => {
    const t = await drawn()
    await t.ok('duplicate_frame')
    const r = await t.ok('save_as_asset', { name: 'Red Knight', kind: 'character', tags: ['Fantasy', 'fantasy', ' 6x6 '], notes: 'thick outline' })
    const meta = jsonOf(r)
    expect(meta).toMatchObject({ id: 'red-knight', name: 'Red Knight', kind: 'character', tags: ['fantasy', '6x6'], width: 6, height: 6, frames: 2, notes: 'thick outline' })
    const stored = t.services.assetStore.get('red-knight')!
    const adoc = deserializeProject(stored.data.project)
    expect([adoc.width, adoc.height, adoc.frames.length, adoc.layers.length]).toEqual([6, 6, 2, 2])
    expect(hasPngSignature(stored.thumbnail!)).toBe(true)
    // the source document is untouched and the save is not an undo step
    expect(t.session.history.undoDepth).toBe(4)
  })

  it('saves one layer, even a hidden one', async () => {
    const t = await drawn()
    await t.ok('update_layer', { layer: 'top', visible: false })
    await t.ok('save_as_asset', { name: 'dot', kind: 'prop', source: 'layer', layer: 'top', trim: true })
    const adoc = deserializeProject(t.services.assetStore.get('dot')!.data.project)
    expect([adoc.width, adoc.height, adoc.layers.length]).toEqual([1, 1, 1])
    expect(adoc.layers[0]!.visible).toBe(true)
    expect(adoc.cels.size).toBe(1)
  })

  it('saves a frame range and keeps the tags that overlap it', async () => {
    const t = await drawn()
    await t.ok('duplicate_frame')
    await t.ok('duplicate_frame')
    await t.ok('create_tag', { name: 'walk', from: 1, to: 2 })
    await t.ok('save_as_asset', { name: 'walk', kind: 'character', source: 'frames', frames: { from: 1, to: 2 } })
    const adoc = deserializeProject(t.services.assetStore.get('walk')!.data.project)
    expect(adoc.frames).toHaveLength(2)
    expect(adoc.tags.map((x) => [x.name, x.from, x.to])).toEqual([['walk', 0, 1]])
  })

  it('saves a region of the current frame, cropped', async () => {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'corner', kind: 'tile', source: 'region', region: { x: 1, y: 1, w: 4, h: 4 } })
    const asset = t.services.assetStore.get('corner')!.data
    expect([asset.width, asset.height, asset.frames]).toEqual([4, 4, 1])
    const adoc = deserializeProject(asset.project)
    const g = jsonOf(await t.ok('get_asset', { id: 'corner' })) as { grid: { rows: string[]; legend: Record<string, string> } }
    // red block at the asset's top-left, blue pixel at (3,3)
    expect(g.grid.rows).toHaveLength(4)
    const colors = g.grid.rows.map((row) => Array.from(row).map((c) => g.grid.legend[c] ?? null))
    expect(colors[0]![0]).toBe(RED)
    expect(colors[3]![3]).toBe(BLUE)
    expect(adoc.palette.colors.length).toBeGreaterThan(0)
  })

  it('overwrites an asset when given its id and makes unique ids otherwise', async () => {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'thing', kind: 'prop' })
    const second = jsonOf(await t.ok('save_as_asset', { name: 'thing', kind: 'prop' }))
    expect(second.id).toBe('thing-2')
    const over = jsonOf(await t.ok('save_as_asset', { name: 'thing renamed', kind: 'character', id: 'thing' }))
    expect(over.id).toBe('thing')
    expect(t.services.assetStore.size).toBe(2)
    expect(t.services.assetStore.get('thing')!.data.name).toBe('thing renamed')
  })

  it('reports readable errors', async () => {
    const t = await drawn()
    expect(resultText(await t.call('save_as_asset', { name: 'x', kind: 'prop', source: 'region' }))).toMatch(/region/)
    expect(resultText(await t.call('save_as_asset', { name: 'x', kind: 'prop', source: 'frames' }))).toMatch(/frames/)
    expect(resultText(await t.call('save_as_asset', { name: 'x', kind: 'prop', frames: { from: 0, to: 9 } }))).toMatch(/invalid/)
    expect(resultText(await t.call('save_as_asset', { name: 'x', kind: 'prop', source: 'region', region: { x: 0, y: 5, w: 1, h: 1 }, trim: true }))).toMatch(/no visible pixels/)
    expect(resultText(await t.call('save_as_asset', { name: 'x', kind: 'nope' }))).toMatch(/kind/)
    const empty = setup()
    expect(resultText(await empty.call('save_as_asset', { name: 'x', kind: 'prop' }))).toMatch(/no pixels/)
    expect(t.services.assetStore.size).toBe(0)
  })

  it('says so when the host has no asset library', async () => {
    const t = await drawn()
    const services = createMemoryToolServices()
    delete (services as { assets?: unknown }).assets
    const r = await createDefaultRegistry().execute('list_assets', {}, { session: t.session, services })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toMatch(/not available/)
  })
})

describe('list_assets and get_asset', () => {
  it('filters by kind and tags', async () => {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'a', kind: 'character', tags: ['x', 'y'] })
    await t.ok('save_as_asset', { name: 'b', kind: 'background', tags: ['x'] })
    const ids = async (args: unknown): Promise<string[]> => (JSON.parse(resultText(await t.ok('list_assets', args)).split('\n')[1]!) as Array<{ id: string }>).map((a) => a.id)
    expect(await ids({})).toEqual(['a', 'b'])
    expect(await ids({ kind: 'background' })).toEqual(['b'])
    expect(await ids({ tags: ['x'] })).toEqual(['a', 'b'])
    expect(await ids({ tags: ['x', 'y'] })).toEqual(['a'])
    expect(await ids({ kind: 'background', tags: ['y'] })).toEqual([])
  })

  it('returns metadata, palette, a grid and a preview image', async () => {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'knight', kind: 'character', notes: 'chunky' })
    const r = await t.ok('get_asset', { id: 'knight' })
    expect(images(r)).toBe(1)
    const body = jsonOf(r) as { name: string; notes: string; palette: string[]; grid: { rect: { w: number; h: number }; rows: string[] } }
    expect(body).toMatchObject({ name: 'knight', notes: 'chunky' })
    expect(body.palette).toHaveLength(16)
    expect(body.grid.rect).toMatchObject({ w: 6, h: 6 })
    expect(body.grid.rows[1]).toMatch(/^\.[^.]{2}/)
    const preview = r.content.find((c) => c.type === 'image') as { data: string }
    expect(hasPngSignature(Uint8Array.from(atob(preview.data), (c) => c.charCodeAt(0)))).toBe(true)
  })

  it('finds an asset by name and explains a miss', async () => {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'Big Tree', kind: 'prop' })
    expect(jsonOf(await t.ok('get_asset', { id: 'big tree' })).id).toBe('big-tree')
    const miss = await t.call('get_asset', { id: 'nope' })
    expect(miss.isError).toBe(true)
    expect(resultText(miss)).toMatch(/big-tree/)
  })

  it('crops the grid of a big asset and reads a region on request', async () => {
    const t = setup({ width: 80, height: 80 })
    await t.ok('draw_grid', { rows: ['rrrr'], legend: { r: RED }, x: 70, y: 70 })
    await t.ok('save_as_asset', { name: 'big', kind: 'background' })
    const whole = await t.ok('get_asset', { id: 'big' })
    const wholeBody = jsonOf(whole)
    const crop = (wholeBody as { grid: { rect: { x: number; y: number; w: number; h: number }; note: string; rows: string[] } }).grid
    expect(crop.rect.w).toBeLessThanOrEqual(64)
    expect(crop.note).toMatch(/crop.*region/)
    expect(crop.rows.some((row) => /[^.]/.test(row))).toBe(true)
    expect(images(whole)).toBe(1)
    const part = jsonOf(await t.ok('get_asset', { id: 'big', region: { x: 68, y: 68, w: 8, h: 4 } })) as { grid: { rows: string[] } }
    expect(part.grid.rows.map((row) => row.replace(/[^.]/g, 'r'))).toEqual(['........', '........', '..rrrr..', '........'])
    expect((await t.call('get_asset', { id: 'big', frame: 3 })).isError).toBe(true)
    const tooBig = jsonOf(await t.ok('get_asset', { id: 'big', region: { x: 0, y: 0, w: 70, h: 70 } }))
    expect(String(tooBig.gridNote)).toMatch(/larger than 64/)
  })
})

describe('place_asset', () => {
  async function withAsset() {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'guy', kind: 'character', source: 'region', region: { x: 1, y: 1, w: 2, h: 2 } })
    return t
  }

  it('stamps the first frame at x,y on the active layer as one undo step', async () => {
    const t = await withAsset()
    await t.ok('add_layer', { name: 'scene' })
    const before = t.session.history.undoDepth
    await t.ok('place_asset', { id: 'guy', x: 3, y: 0 })
    expect(t.session.history.undoDepth).toBe(before + 1)
    expect(pixel(t, 'scene', 0, 3, 0)).toBe(hexToRgba(RED))
    expect(pixel(t, 'scene', 0, 4, 1)).toBe(hexToRgba(RED))
    expect(pixel(t, 'scene', 0, 2, 0)).toBe(0)
    expect(t.session.undo()).toBe(true)
    expect(pixel(t, 'scene', 0, 3, 0)).toBe(0)
  })

  it('places onto a new layer and a named layer', async () => {
    const t = await withAsset()
    await t.ok('place_asset', { id: 'guy', newLayer: true, x: 0, y: 4 })
    expect(t.doc.layers.map((l) => l.name)).toContain('guy')
    expect(t.session.activeLayer.name).toBe('guy')
    expect(pixel(t, 'guy', 0, 0, 4)).toBe(hexToRgba(RED))
    await t.ok('place_asset', { id: 'guy', layer: 'Layer 1', x: 4, y: 0 })
    expect(pixel(t, 'Layer 1', 0, 4, 0)).toBe(hexToRgba(RED))
    // new layer + stamp = one undo step
    const layers = t.doc.layers.length
    await t.ok('place_asset', { id: 'guy', newLayer: true })
    expect(t.doc.layers).toHaveLength(layers + 1)
    t.session.undo()
    expect(t.doc.layers).toHaveLength(layers)
  })

  it('copies all animation frames, adding frames when needed, in one undo step', async () => {
    const t = setup({ width: 6, height: 6 })
    await t.ok('draw_grid', { rows: ['r'], legend: { r: RED }, x: 0, y: 0 })
    await t.ok('duplicate_frame')
    await t.ok('set_frame_duration', { frames: 1, durationMs: 250 })
    await t.ok('clear_cel', { frame: 1 })
    await t.ok('draw_grid', { rows: ['b'], legend: { b: BLUE }, x: 1, y: 0, frame: 1 })
    await t.ok('save_as_asset', { name: 'blink', kind: 'prop', trim: true })
    await t.ok('new_document', { width: 8, height: 8 })
    expect(t.doc.frames).toHaveLength(1)
    const depth = t.session.history.undoDepth
    const r = await t.ok('place_asset', { id: 'blink', frames: 'all', x: 2, y: 3 })
    expect(resultText(r)).toMatch(/Added 1 frame/)
    expect(t.doc.frames).toHaveLength(2)
    expect(t.doc.frames[1]!.durationMs).toBe(250)
    expect(t.session.history.undoDepth).toBe(depth + 1)
    const layer = t.session.activeLayer.name
    expect(pixel(t, layer, 0, 2, 3)).toBe(hexToRgba(RED))
    expect(pixel(t, layer, 1, 3, 3)).toBe(hexToRgba(BLUE))
    t.session.undo()
    expect(t.doc.frames).toHaveLength(1)
    expect(pixel(t, layer, 0, 2, 3)).toBe(0)
  })

  it('stamps the asset frame given by assetFrame onto the given frame', async () => {
    const t = setup({ width: 4, height: 4 })
    await t.ok('draw_grid', { rows: ['r'], legend: { r: RED } })
    await t.ok('duplicate_frame')
    await t.ok('draw_grid', { rows: ['b'], legend: { b: BLUE }, x: 1, frame: 1 })
    await t.ok('save_as_asset', { name: 'two', kind: 'prop' })
    await t.ok('place_asset', { id: 'two', assetFrame: 1, frame: 0, x: 0, y: 2, newLayer: true })
    expect(pixel(t, 'two', 0, 1, 2)).toBe(hexToRgba(BLUE))
    expect(pixel(t, 'two', 0, 0, 2)).toBe(hexToRgba(RED))
  })

  it('notes colors outside the document palette and clipping', async () => {
    const t = await withAsset()
    await t.ok('set_palette', { colors: ['#000000', '#ffffff'] })
    const r = await t.ok('place_asset', { id: 'guy', x: 5, y: 5, newLayer: true })
    expect(resultText(r)).toMatch(/not in the document palette/)
    expect(resultText(r)).toMatch(/clipped/)
  })

  it('fails readably and leaves the document unchanged', async () => {
    const t = await withAsset()
    const depth = t.session.history.undoDepth
    const outside = await t.call('place_asset', { id: 'guy', x: 50, y: 50, newLayer: true })
    expect(resultText(outside)).toMatch(/outside/)
    expect(t.session.history.undoDepth).toBe(depth)
    expect(t.doc.layers.map((l) => l.name)).not.toContain('guy')
    await t.ok('update_layer', { layer: 'Layer 1', locked: true })
    expect(resultText(await t.call('place_asset', { id: 'guy', layer: 'Layer 1' }))).toMatch(/locked/)
    expect(resultText(await t.call('place_asset', { id: 'missing' }))).toMatch(/not found/)
  })
})

describe('set_style_reference', () => {
  async function withTwo() {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'knight', kind: 'character', notes: 'thick black outline' })
    await t.ok('save_as_asset', { name: 'forest', kind: 'background', source: 'layer', layer: 'top', trim: true })
    return t
  }

  it('adds, removes, sets and clears references in one undo step each', async () => {
    const t = await withTwo()
    const depth = t.session.history.undoDepth
    await t.ok('set_style_reference', { ids: ['knight'], note: 'match this' })
    expect(t.doc.references).toEqual([{ assetId: 'knight', note: 'match this' }])
    expect(t.session.history.undoDepth).toBe(depth + 1)
    await t.ok('set_style_reference', { ids: ['forest'] })
    expect(t.doc.references.map((r) => r.assetId)).toEqual(['knight', 'forest'])
    await t.ok('set_style_reference', { ids: ['forest'], action: 'remove' })
    expect(t.doc.references.map((r) => r.assetId)).toEqual(['knight'])
    await t.ok('set_style_reference', { ids: ['forest'], action: 'set' })
    expect(t.doc.references.map((r) => r.assetId)).toEqual(['forest'])
    await t.ok('set_style_reference', { action: 'clear' })
    expect(t.doc.references).toEqual([])
    expect(resultText(await t.call('set_style_reference', { ids: ['nope'] }))).toMatch(/not found/)
    expect(resultText(await t.call('set_style_reference', {}))).toMatch(/needs `ids`/)
    expect(resultText(await t.ok('get_document'))).toContain('references')
  })

  it('showLayer adds a dimmed, locked reference layer that exports never include', async () => {
    const t = await withTwo()
    const depth = t.session.history.undoDepth
    await t.ok('set_style_reference', { ids: ['knight'], showLayer: true })
    expect(t.session.history.undoDepth).toBe(depth + 1)
    const layer = t.doc.layers.find((l) => l.name === 'Ref: knight')!
    expect(layer).toMatchObject({ kind: 'reference', locked: true, opacity: 0.4, visible: true })
    expect(t.doc.layers[0]).toBe(layer)
    expect(t.doc.cels.get(`${layer.id}:${t.doc.frames[0]!.id}`)).toBeTruthy()
    // calling again does not duplicate the layer
    await t.ok('set_style_reference', { ids: ['knight'], showLayer: true })
    expect(t.doc.layers.filter((l) => l.kind === 'reference')).toHaveLength(1)

    // exports skip it: with only a reference layer visible the PNG is empty
    for (const l of t.doc.layers) if (l.kind === 'pixel') await t.ok('update_layer', { layer: l.id, visible: false })
    await t.ok('export_png', { path: 'ref' })
    const png = decodePng(t.services.files.get('/mem/exports/ref.png')!)
    expect(Array.from(png.data).every((c) => c >>> 24 === 0)).toBe(true)
    await t.ok('export_spritesheet', { path: 'sheet' })
    const sheet = decodePng(t.services.files.get('/mem/exports/sheet.png')!)
    expect(Array.from(sheet.data).every((c) => c >>> 24 === 0)).toBe(true)
    await t.ok('export_gif', { path: 'ref' })
    // while render_preview of the visible pixel layers is empty too, the editor composite still shows it
    const edit = t.doc.layers.find((l) => l.kind === 'reference')!
    expect(edit.visible).toBe(true)

    // removing the reference removes its layer
    await t.ok('set_style_reference', { ids: ['knight'], action: 'remove' })
    expect(t.doc.layers.some((l) => l.kind === 'reference')).toBe(false)
    t.session.undo()
    expect(t.doc.layers.some((l) => l.name === 'Ref: knight')).toBe(true)
    expect(t.doc.references).toHaveLength(1)
  })
})

describe('get_style_context', () => {
  it('says so when there are no references', async () => {
    const t = await drawn()
    const r = await t.ok('get_style_context')
    expect(resultText(r)).toMatch(/^No style references/)
    expect(images(r)).toBe(0)
  })

  it('returns the merged palette, sizes, sample grids, notes and previews', async () => {
    const t = await drawn()
    await t.ok('set_palette', { colors: ['#ff0000', '#0000ff', '#112233'], name: 'a' })
    await t.ok('save_as_asset', { name: 'knight', kind: 'character', notes: 'thick black outline' })
    await t.ok('set_palette', { colors: ['#0000ff', '#abcdef'], name: 'b' })
    await t.ok('save_as_asset', { name: 'forest', kind: 'background' })
    await t.ok('set_style_reference', { ids: ['knight', 'forest'], note: 'palette first' })
    const r = await t.ok('get_style_context')
    expect(images(r)).toBe(2)
    const body = jsonOf(r) as {
      references: Array<{ id: string; width: number; notes?: string; referenceNote?: string; palette: string[]; sample: { rows: string[] } }>
      mergedPalette: Array<{ hex: string }>
    }
    expect(body.references.map((x) => x.id)).toEqual(['knight', 'forest'])
    expect(body.references[0]).toMatchObject({ width: 6, notes: 'thick black outline', referenceNote: 'palette first' })
    expect(body.references[0]!.sample.rows).toHaveLength(6)
    expect(body.mergedPalette.map((c) => c.hex)).toEqual(['#ff0000', '#0000ff', '#112233', '#abcdef'])
    expect(resultText(r)).toMatch(/exactly these palette colors/)
  })

  it('accepts explicit ids without references and reports unknown ones', async () => {
    const t = await drawn()
    await t.ok('save_as_asset', { name: 'knight', kind: 'character' })
    const r = await t.ok('get_style_context', { ids: ['knight', 'ghost'] })
    const body = jsonOf(r) as { references: unknown[]; missing: string[] }
    expect(body.references).toHaveLength(1)
    expect(body.missing).toEqual(['ghost'])
    expect((await t.call('get_style_context', { ids: ['ghost'] })).isError).toBe(true)
  })

  it('crops a big reference to a small sample', async () => {
    const t = setup({ width: 64, height: 64 })
    await t.ok('draw_grid', { rows: ['rr', 'rr'], legend: { r: RED }, x: 40, y: 50 })
    await t.ok('save_as_asset', { name: 'bg', kind: 'background' })
    const body = jsonOf(await t.ok('get_style_context', { ids: ['bg'] })) as { references: Array<{ sample: { rect: { x: number; y: number; w: number; h: number }; note: string; rows: string[] } }> }
    const s = body.references[0]!.sample
    expect(s.rect.w).toBeLessThanOrEqual(32)
    expect(s.rows.some((row) => row.includes('0') || /[^.]/.test(row))).toBe(true)
    expect(s.note).toMatch(/crop/)
  })
})
