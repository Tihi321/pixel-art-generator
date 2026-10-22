import { describe, expect, it } from 'vitest'
import { DocumentSet, createDefaultRegistry, createMemoryToolServices, resultText } from '../../src/tools'
import type { ToolResult } from '../../src/tools'
import { setup } from './helpers'

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
  const json = (r: ToolResult): Record<string, unknown> => JSON.parse((r.content[r.content.length - 1] as { text: string }).text) as Record<string, unknown>
  const newDoc = async (name: string, size = 8): Promise<string> => json(await ok('new_document', { width: size, height: size, name }))['documentId'] as string
  const cels = (id: string): number => documents.resolve(id).session.doc.cels.size
  const currentId = (): string => documents.list().find((d) => d.current)!.documentId
  return { documents, services, registry, call, ok, json, newDoc, cels, currentId }
}

const OPT_OUT = ['list_documents', 'open_document', 'import_image', 'draw_sprite_from_reference', 'new_document', 'open_project', 'export_many', 'list_palettes', 'list_assets', 'get_asset']

describe('document argument', () => {
  it('is in the JSON schema of every tool except the opt-outs', () => {
    const registry = createDefaultRegistry()
    for (const d of registry.defs()) {
      const props = (d.parameters as { properties?: Record<string, { type?: string }> }).properties ?? {}
      if (OPT_OUT.includes(d.name)) expect(props, d.name).not.toHaveProperty('document')
      else expect(props['document']?.type, d.name).toBe('string')
    }
  })

  it('keeps the input strict: unknown arguments are still errors', async () => {
    const t = setup()
    const r = await t.call('draw_rect', { x: 0, y: 0, w: 1, h: 1, color: '#fff', bogus: 1 })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toMatch(/Unrecognized argument "bogus"/)
    // and document itself is accepted
    expect((await t.call('get_document', { document: t.doc.id })).isError).toBeFalsy()
  })

  it('draws, previews and undoes in the addressed document only', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    const b = await t.newDoc('B') // b is current
    await t.ok('draw_rect', { document: a, x: 0, y: 0, w: 2, h: 2, color: '#ff0000', filled: true })
    expect(t.cels(a)).toBe(1)
    expect(t.cels(b)).toBe(0)
    await t.ok('draw_rect', { document: b, x: 1, y: 1, w: 3, h: 3, color: '#00ff00', filled: true })
    expect(t.cels(b)).toBe(1)
    const celA = t.documents.resolve(a).session.doc.cels.values().next().value!
    expect([celA.w, celA.h]).toEqual([2, 2])

    const pa = await t.ok('render_preview', { document: a })
    expect(pa.content.some((c) => c.type === 'image')).toBe(true)

    // undo with `document` undoes in that document only, whichever is current
    await t.ok('undo', { document: a })
    expect(t.cels(a)).toBe(0)
    expect(t.cels(b)).toBe(1)
    expect(t.currentId()).toBe(b)
  })

  it('an unknown document is an error and changes nothing', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    const r = await t.call('draw_rect', { document: 'nope', x: 0, y: 0, w: 2, h: 2, color: '#ff0000' })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toMatch(/Unknown document "nope".*list_documents/)
    expect(t.cels(a)).toBe(0)
  })

  it('get_document reports the documentId', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    expect(JSON.parse(resultText(await t.ok('get_document')))['documentId']).toBe(a)
    expect(JSON.parse(resultText(await t.ok('get_document', { document: a })))['documentId']).toBe(a)
  })
})

describe('new_document / open_project add', () => {
  it('new_document keeps the previous document and returns JSON with documentId', async () => {
    const t = headlessSetup()
    const first = await t.newDoc('first', 8)
    const j = t.json(await t.ok('new_document', { width: 4, height: 6, name: 'second', palette: 'pico-8' }))
    expect(j).toMatchObject({ name: 'second', width: 4, height: 6 })
    expect(typeof j['documentId']).toBe('string')
    expect((j['palette'] as string[]).length).toBe(16)
    expect(t.documents.list().map((d) => d.documentId)).toEqual([first, j['documentId']])
    expect(t.currentId()).toBe(j['documentId'])
  })

  it('open_project adds a document, and an open path just becomes current', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    await t.ok('save_document', { path: 'p' })
    const pxs = [...t.services.files.keys()].find((k) => k.endsWith('p.pxs'))!
    const b = await t.newDoc('B')
    const opened = t.json(await t.ok('open_project', { path: pxs }))
    expect(opened['documentId']).toBe(a) // already open: activated, not duplicated
    expect(t.documents.list().map((d) => d.documentId)).toEqual([a, b])
    expect(t.currentId()).toBe(a)
    t.documents.close(a, { force: true })
    const again = t.json(await t.ok('open_project', { path: pxs }))
    expect(again['documentId']).not.toBe(a)
    expect(t.documents.list()).toHaveLength(2)
  })

  it('without a host new_document still replaces the single document', async () => {
    const t = setup()
    await t.ok('new_document', { width: 4, height: 4 })
    expect(t.session.doc.width).toBe(4)
  })
})

describe('select_document / close_document', () => {
  it('select_document changes the current document', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    const b = await t.newDoc('B')
    expect(t.currentId()).toBe(b)
    const j = t.json(await t.ok('select_document', { document: a }))
    expect(j).toMatchObject({ documentId: a, name: 'A', width: 8, height: 8 })
    expect(t.currentId()).toBe(a)
    expect((await t.call('select_document', { document: 'zzz' })).isError).toBe(true)
    expect((await t.call('select_document', {})).isError).toBe(true)
  })

  it('close_document refuses unsaved work without force, closes with force, leaves a placeholder for the last', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    const b = await t.newDoc('B')
    await t.ok('draw_rect', { document: b, x: 0, y: 0, w: 2, h: 2, color: '#ff0000' })
    const refused = await t.call('close_document', { document: b })
    expect(refused.isError).toBe(true)
    expect(resultText(refused)).toMatch(/save_document.*force/)
    expect(t.documents.list().map((d) => d.documentId)).toEqual([a, b])

    const j = t.json(await t.ok('close_document', { document: b, force: true }))
    expect(j).toEqual({ documentId: b, closed: true, current: a })
    expect(t.documents.list().map((d) => d.documentId)).toEqual([a])

    // a clean document closes without force; the last one leaves a fresh 32x32 "Untitled"
    const last = t.json(await t.ok('close_document', { document: a }))
    expect(last['closed']).toBe(true)
    const rest = t.documents.list()
    expect(rest).toHaveLength(1)
    expect(rest[0]).toMatchObject({ name: 'Untitled', width: 32, height: 32, current: true })
    expect(last['current']).toBe(rest[0]!.documentId)
  })

  it('a saved document closes without force', async () => {
    const t = headlessSetup()
    const a = await t.newDoc('A')
    await t.ok('draw_rect', { x: 0, y: 0, w: 2, h: 2, color: '#ff0000' })
    await t.ok('save_document', { path: 'a' })
    expect((await t.call('close_document', { document: a })).isError).toBeFalsy()
  })
})
