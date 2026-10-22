import { describe, expect, it } from 'vitest'
import { celKey, decodePng, encodePng, packRgba } from '../../src/core'
import { DocumentSet, createDefaultRegistry, createMemoryToolServices, resultText } from '../../src/tools'
import type { ToolResult } from '../../src/tools'
import { jsonOf, setup } from './helpers'

function lastJson(r: ToolResult): Record<string, unknown> {
  const last = r.content[r.content.length - 1]!
  return JSON.parse((last as { text: string }).text) as Record<string, unknown>
}

/** A drawn base figure (a 6x8 body) and a first mouth, ready for make_expression_set. */
async function drawnBase() {
  const t = setup({ width: 16, height: 16 })
  await t.ok('draw_rect', { x: 4, y: 6, w: 8, h: 10, color: '#ff0000', filled: true })
  await t.ok('draw_rect', { x: 6, y: 8, w: 4, h: 1, color: '#000000', filled: true })
  return t
}

function celData(t: Awaited<ReturnType<typeof drawnBase>>, frameIdx: number): number[] {
  const doc = t.session.doc
  const cel = doc.cels.get(celKey(doc.layers[0]!.id, doc.frames[frameIdx]!.id))
  return cel ? [...cel.data] : []
}

describe('make_expression_set', () => {
  it('makes one tagged frame per expression, identical to the base', async () => {
    const t = await drawnBase()
    const r = await t.ok('make_expression_set', { expressions: ['neutral', 'happy', 'sad'], face: { x: 5, y: 6, w: 6, h: 5 } })
    const j = lastJson(r)
    const exps = j['expressions'] as Array<{ name: string; frame: number; frameId: string; tagId: string }>
    expect(exps.map((e) => [e.name, e.frame])).toEqual([['neutral', 0], ['happy', 1], ['sad', 2]])
    expect(j['face']).toEqual({ x: 5, y: 6, w: 6, h: 5 })
    const doc = t.session.doc
    expect(doc.frames).toHaveLength(3)
    expect(doc.tags.map((x) => [x.name, x.from, x.to])).toEqual([['neutral', 0, 0], ['happy', 1, 1], ['sad', 2, 2]])
    expect(exps.map((e) => e.frameId)).toEqual(doc.frames.map((f) => f.id))
    expect(celData(t, 1)).toEqual(celData(t, 0))
    expect(celData(t, 2)).toEqual(celData(t, 0))
    expect(celData(t, 0).some((p) => p !== 0)).toBe(true)
    expect(resultText(r)).toContain('mouth a smile')
    expect(resultText(r)).toContain('x=5, y=6, w=6, h=5')
  })

  it('adds only the new expressions when called again', async () => {
    const t = await drawnBase()
    await t.ok('make_expression_set', { expressions: ['neutral', 'happy'] })
    const second = lastJson(await t.ok('make_expression_set', { expressions: ['neutral', 'happy', 'surprised'] }))
    const exps = second['expressions'] as Array<{ name: string; frame: number }>
    expect(exps.map((e) => e.name)).toEqual(['neutral', 'happy', 'surprised'])
    expect(t.session.doc.frames).toHaveLength(3)
    expect(t.session.doc.tags).toHaveLength(3)
    expect(resultText(await t.ok('make_expression_set', { expressions: ['happy'] }))).toContain('No new expressions')
    expect(t.session.doc.frames).toHaveLength(3)
  })

  it('draws on a frame addressed by its expression name and leaves the others alone', async () => {
    const t = await drawnBase()
    await t.ok('make_expression_set', { expressions: ['neutral', 'happy', 'sad'] })
    const before = celData(t, 0)
    await t.ok('draw_grid', { frame: 'happy', rows: ['kkkk'], legend: { k: '#00ff00' }, x: 6, y: 9 })
    expect(celData(t, 1)).not.toEqual(before)
    expect(celData(t, 0)).toEqual(before)
    expect(celData(t, 2)).toEqual(before)
    // an index or an id still wins over a tag name; a numeric string is an index
    await t.ok('set_active', { frame: 'sad' })
    expect(t.session.activeFrameIndex).toBe(2)
    await t.ok('set_active', { frame: '1' })
    expect(t.session.activeFrameIndex).toBe(1)
  })

  it('keeps animation tags out of frame references', async () => {
    const t = setup()
    await t.ok('add_frame')
    await t.ok('create_tag', { name: 'walk', from: 0, to: 1 })
    const r = await t.call('set_active', { frame: 'walk' })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toContain('animation tag')
    const e = await t.call('make_expression_set', { expressions: ['walk'] })
    expect(e.isError).toBe(true)
  })

  it('rejects invalid names', async () => {
    const t = await drawnBase()
    for (const bad of [['Happy'], ['very happy'], ['sad!'], [], ['a'.repeat(3)].concat(Array.from({ length: 24 }, (_, i) => `e${i}`))]) {
      expect((await t.call('make_expression_set', { expressions: bad })).isError).toBe(true)
    }
    expect((await t.call('make_expression_set', { expressions: ['happy'], face: { x: 10, y: 10, w: 20, h: 4 } })).isError).toBe(true)
    expect(t.session.doc.frames).toHaveLength(1)
    expect(t.session.doc.tags).toHaveLength(0)
  })

  it('is a single undo step', async () => {
    const t = await drawnBase()
    await t.ok('make_expression_set', { expressions: ['neutral', 'happy', 'sad'] })
    await t.ok('undo')
    expect(t.session.doc.frames).toHaveLength(1)
    expect(t.session.doc.tags).toHaveLength(0)
    expect(celData(t, 0).some((p) => p !== 0)).toBe(true)
  })
})

describe('export_expression_set', () => {
  it('writes one equally sized PNG per expression', async () => {
    const t = await drawnBase()
    await t.ok('make_expression_set', { expressions: ['neutral', 'happy', 'sad'] })
    await t.ok('draw_grid', { frame: 'happy', rows: ['kkkk'], legend: { k: '#00ff00' }, x: 6, y: 9 })
    const j = jsonOf(await t.ok('export_expression_set', { dir: '/out/mara/', prefix: 'mara', scale: 2 }))
    expect(j['width']).toBe(32)
    expect(j['height']).toBe(32)
    const files = j['files'] as Array<{ expression: string; path: string }>
    expect(files.map((f) => f.path)).toEqual(['/out/mara/mara_neutral.png', '/out/mara/mara_happy.png', '/out/mara/mara_sad.png'])
    const imgs = files.map((f) => decodePng(t.services.files.get(f.path)!))
    for (const img of imgs) expect([img.width, img.height]).toEqual([32, 32])
    expect([...imgs[1]!.data]).not.toEqual([...imgs[0]!.data])
    expect([...imgs[2]!.data]).toEqual([...imgs[0]!.data])
    // the corner is transparent: a sprite, not a filled rectangle
    expect(imgs[0]!.data[0]! >>> 24).toBe(0)
  })

  it('exports only the listed expressions, defaults the prefix and errors without a set', async () => {
    const t = await drawnBase()
    const none = await t.call('export_expression_set', { dir: '/out' })
    expect(none.isError).toBe(true)
    expect(resultText(none)).toContain('make_expression_set')
    await t.ok('make_expression_set', { expressions: ['neutral', 'happy'] })
    const j = jsonOf(await t.ok('export_expression_set', { dir: '/out', expressions: ['happy'], width: 32, height: 48 }))
    expect((j['files'] as Array<{ path: string }>).map((f) => f.path)).toEqual(['/out/test_happy.png'])
    expect([j['width'], j['height']]).toEqual([32, 48])
    expect((await t.call('export_expression_set', { dir: '/out', expressions: ['sad'] })).isError).toBe(true)
  })
})

describe('draw_sprite_from_reference expressions', () => {
  it('creates the set with the document, not as an undo step', async () => {
    const documents = new DocumentSet()
    const services = createMemoryToolServices()
    const registry = createDefaultRegistry()
    const data = new Uint32Array(64).fill(packRgba(200, 30, 30))
    services.files.set('/in/ref.png', encodePng({ width: 8, height: 8, data }))
    const r = await registry.execute(
      'draw_sprite_from_reference',
      { reference: '/in/ref.png', width: 24, height: 32, palette: 'pico-8', expressions: ['neutral', 'happy', 'sad'] },
      { session: documents.session, services, documents }
    )
    expect(r.isError).toBeFalsy()
    const j = lastJson(r)
    expect((j['expressions'] as Array<{ name: string }>).map((e) => e.name)).toEqual(['neutral', 'happy', 'sad'])
    expect(resultText(r)).toContain('copy_cel')
    const doc = documents.session.doc
    expect(doc.frames).toHaveLength(3)
    expect(doc.tags.map((x) => x.name)).toEqual(['neutral', 'happy', 'sad'])
    expect(documents.session.undo()).toBe(false)
  })
})
