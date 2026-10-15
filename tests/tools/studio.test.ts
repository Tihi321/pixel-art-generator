import { describe, expect, it } from 'vitest'
import { celKey, createDocument, decodePng, encodePng, packRgba, serializeProject } from '../../src/core'
import { DocumentSet, EditorSession, createDefaultRegistry, createMemoryToolServices, resultText } from '../../src/tools'
import type { ToolResult } from '../../src/tools'

/** A registry + DocumentSet + memory services, the way headless mode wires them. */
function headlessSetup() {
  const documents = new DocumentSet()
  const services = createMemoryToolServices()
  const registry = createDefaultRegistry()
  const call = (name: string, args: unknown = {}): Promise<ToolResult> => registry.execute(name, args, { session: documents.session, services, documents })
  const ok = async (name: string, args: unknown = {}): Promise<ToolResult> => {
    const r = await call(name, args)
    if (r.isError) throw new Error(`${name} failed: ${resultText(r)}`)
    return r
  }
  return { documents, services, registry, call, ok }
}

/** The last content item parsed as the JSON object the contract promises. */
function lastJson(r: ToolResult): Record<string, unknown> {
  const last = r.content[r.content.length - 1]!
  expect(last.type).toBe('text')
  return JSON.parse((last as { text: string }).text) as Record<string, unknown>
}

function pngOf(w: number, h: number, fn: (x: number, y: number) => number): Uint8Array {
  const data = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y)
  return encodePng({ width: w, height: h, data })
}

describe('import_image + export_png', () => {
  it('imports a PNG as a new current document and exports it at an exact size', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/bg.png', pngOf(64, 36, (x, y) => packRgba(x * 4, y * 7, 120)))
    const imp = await t.ok('import_image', { path: '/in/bg.png', width: 32, height: 18, palette: 'pico-8', name: 'bg' })
    const j = lastJson(imp)
    expect(j).toMatchObject({ name: 'bg', width: 32, height: 18 })
    expect(typeof j['documentId']).toBe('string')
    expect(j['colors']).toBeLessThanOrEqual(16)
    expect(j['transparentPixels']).toBe(0)
    expect(t.documents.resolve().documentId).toBe(j['documentId'])

    const exp = await t.ok('export_png', { path: '/out/bg.png', width: 192, height: 108 })
    expect(lastJson(exp)).toEqual({ paths: ['/out/bg.png'], width: 192, height: 108 })
    const img = decodePng(t.services.files.get('/out/bg.png')!)
    expect([img.width, img.height]).toEqual([192, 108])
  })

  it('exports 320x180 at exactly 1920x1080 and keeps documents addressable by id', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/a.png', pngOf(320, 180, (x) => packRgba(x % 200, 60, 90)))
    t.services.files.set('/in/b.png', pngOf(16, 16, () => packRgba(200, 10, 10)))
    const a = lastJson(await t.ok('import_image', { path: '/in/a.png', width: 320, height: 180, maxColors: 8 }))
    const b = lastJson(await t.ok('import_image', { path: '/in/b.png' }))
    expect(a['documentId']).not.toBe(b['documentId'])
    const docs = lastJson(await t.ok('list_documents'))['documents'] as Array<{ documentId: string; current: boolean }>
    expect(docs.map((d) => d.documentId)).toEqual([a['documentId'], b['documentId']]) // the blank placeholder was replaced
    expect(docs.find((d) => d.current)!.documentId).toBe(b['documentId'])

    const r = lastJson(await t.ok('export_png', { document: a['documentId'], path: '/out/a.png', width: 1920, height: 1080 }))
    expect(r).toEqual({ paths: ['/out/a.png'], width: 1920, height: 1080 })
    const img = decodePng(t.services.files.get('/out/a.png')!)
    expect([img.width, img.height]).toEqual([1920, 1080])
    expect((await t.call('export_png', { document: 'nope', path: '/x.png' })).isError).toBe(true)
  })

  it('keeps alpha as transparent pixels and reports them', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/s.png', pngOf(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? packRgba(255, 0, 0) : 0)))
    const j = lastJson(await t.ok('import_image', { path: '/in/s.png', palette: ['#ff0000', '#000000'] }))
    expect(j['transparentPixels']).toBe(16 * 16 - 64)
    expect(j['colors']).toBe(1)
  })

  it('reports PNG-only hosts and bad arguments as errors', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/x.jpg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))
    expect(resultText(await t.call('import_image', { path: '/in/x.jpg' }))).toMatch(/PNG files only/)
    t.services.files.set('/in/big.png', pngOf(600, 8, () => packRgba(1, 2, 3)))
    expect(resultText(await t.call('import_image', { path: '/in/big.png' }))).toMatch(/too large/)
    expect((await t.call('import_image', { path: '/in/big.png', width: 8, palette: 'no-such' })).isError).toBe(true)
  })
})

describe('export_many', () => {
  it('writes several files and returns the paths', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/a.png', pngOf(8, 8, () => packRgba(9, 9, 9)))
    const a = lastJson(await t.ok('import_image', { path: '/in/a.png' }))
    await t.ok('new_document', { width: 4, height: 4 })
    const r = lastJson(
      await t.ok('export_many', { items: [{ document: a['documentId'], path: '/out/1.png', width: 80, height: 80 }, { path: '/out/2.png', scale: 2 }] })
    )
    expect(r).toEqual({ paths: ['/out/1.png', '/out/2.png'] })
    expect(decodePng(t.services.files.get('/out/1.png')!).width).toBe(80)
    expect(decodePng(t.services.files.get('/out/2.png')!).width).toBe(8)
  })
})

describe('draw_sprite_from_reference', () => {
  it('creates a sized document with a hidden reference layer and drawing guidance', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/ref.png', pngOf(40, 60, () => packRgba(200, 100, 50)))
    const r = await t.ok('draw_sprite_from_reference', { reference: '/in/ref.png', width: 64, height: 96, palette: 'db16', expression: 'smiling' })
    const j = lastJson(r)
    expect(j).toMatchObject({ width: 64, height: 96 })
    expect((j['palette'] as string[]).length).toBe(16)
    expect(resultText(r)).toMatch(/draw_grid/)
    expect(resultText(r)).toMatch(/smiling/)
    const doc = t.documents.session.doc
    const ref = doc.layers.find((l) => l.id === j['referenceLayerId'])!
    expect(ref.kind).toBe('reference')
    expect(doc.cels.has(celKey(ref.id, doc.frames[0]!.id))).toBe(true)
    // the reference layer is not exported
    await t.ok('draw_grid', { rows: ['aa'], legend: { a: '#ff0000' } })
    await t.ok('export_png', { path: '/out/s.png' })
    const png = decodePng(t.services.files.get('/out/s.png')!)
    expect(png.data.filter((c) => c >>> 24 !== 0).length).toBe(2)
    expect((await t.call('draw_sprite_from_reference', { reference: '/in/ref.png', width: 200, height: 8, palette: 'db16' })).isError).toBe(true)
  })
})

describe('open_document / save_document round trip', () => {
  it('opens a PNG, exports on save, and reopens the saved project', async () => {
    const t = headlessSetup()
    t.services.files.set('/in/pic.png', pngOf(10, 5, (x) => packRgba(x * 20, 0, 0)))
    const o = lastJson(await t.ok('open_document', { path: '/in/pic.png', exportTo: '/out/pic.png', exportWidth: 100, exportHeight: 50 }))
    expect(o).toMatchObject({ name: 'pic', width: 10, height: 5, path: '/in/pic.png' })
    await t.ok('set_pixels', { pixels: [{ x: 0, y: 0, color: '#00ff00' }] })
    expect(t.documents.list().find((d) => d.documentId === o['documentId'])!.dirty).toBe(true)

    const s = lastJson(await t.ok('save_document', { path: '/proj/pic.pxs' }))
    expect(s).toEqual({ documentId: o['documentId'], path: '/proj/pic.pxs', exported: '/out/pic.png' })
    const png = decodePng(t.services.files.get('/out/pic.png')!)
    expect([png.width, png.height]).toEqual([100, 50])
    expect(png.data[0]! & 0xffffff).toBe(0x00ff00)
    expect(t.documents.list().find((d) => d.documentId === o['documentId'])).toMatchObject({ dirty: false, path: '/proj/pic.pxs' })

    // reopening the same native file switches to the open document instead of adding another
    const again = lastJson(await t.ok('open_document', { path: '/proj/pic.pxs' }))
    expect(again['documentId']).toBe(o['documentId'])
    expect(t.documents.list()).toHaveLength(1)
  })

  it('opens a native project file', async () => {
    const t = headlessSetup()
    const doc = createDocument({ width: 6, height: 7, name: 'native' })
    t.services.files.set('/proj/native.pxs', new TextEncoder().encode(serializeProject(doc)))
    const o = lastJson(await t.ok('open_document', { path: '/proj/native.pxs' }))
    expect(o).toMatchObject({ name: 'native', width: 6, height: 7, path: '/proj/native.pxs' })
  })
})

describe('without a document host', () => {
  it('import_image replaces the single document and ids default to it', async () => {
    const session = new EditorSession()
    const services = createMemoryToolServices()
    services.files.set('/in/a.png', pngOf(8, 8, () => packRgba(1, 2, 3)))
    const registry = createDefaultRegistry()
    const r = await registry.execute('import_image', { path: '/in/a.png' }, { session, services })
    expect(r.isError).toBeFalsy()
    expect(session.doc.width).toBe(8)
    expect(lastJson(r)['documentId']).toBe(session.doc.id)
    const l = lastJson(await registry.execute('list_documents', {}, { session, services }))
    expect((l['documents'] as unknown[]).length).toBe(1)
  })
})
