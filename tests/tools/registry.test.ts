import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, createDefaultRegistry, createToolHost, defineTool, resultText } from '../../src/tools'
import { setup } from './helpers'

const EXPECTED = [
  'get_document', 'new_document', 'resize_canvas', 'set_active', 'open_project', 'save_project',
  'add_layer', 'update_layer', 'delete_layer', 'move_layer', 'duplicate_layer', 'merge_down',
  'add_frame', 'duplicate_frame', 'delete_frame', 'move_frame', 'set_frame_duration', 'create_tag', 'update_tag', 'delete_tag', 'copy_cel',
  'draw_grid', 'set_pixels', 'draw_line', 'draw_rect', 'draw_ellipse', 'flood_fill', 'replace_color', 'clear_cel', 'transform_cel', 'outline',
  'read_grid', 'render_preview',
  'get_palette', 'set_palette', 'add_colors', 'remove_colors', 'list_palettes', 'load_palette', 'import_palette', 'export_palette', 'remap_to_palette', 'save_palette',
  'list_assets', 'get_asset', 'save_as_asset', 'place_asset', 'set_style_reference', 'get_style_context',
  'export_png', 'export_spritesheet', 'export_gif',
  'import_image', 'export_many', 'draw_sprite_from_reference', 'list_documents', 'open_document', 'save_document', 'select_document', 'close_document',
  'undo', 'redo'
]

describe('createDefaultRegistry', () => {
  const registry = createDefaultRegistry()

  it('contains all 62 tools', () => {
    expect(registry.list()).toHaveLength(62)
    expect(registry.list().map((t) => t.name).sort()).toEqual([...EXPECTED].sort())
  })

  it('has valid, unique, documented defs with object JSON schemas', () => {
    const defs = registry.defs()
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length)
    for (const d of defs) {
      expect(d.name).toMatch(/^[a-z_]+$/)
      expect(d.description.trim().length, d.name).toBeGreaterThan(20)
      expect(d.parameters['type'], d.name).toBe('object')
      expect(() => JSON.stringify(d.parameters), d.name).not.toThrow()
      expect(d.parameters['$schema']).toBeUndefined()
    }
  })

  it('undo and redo skip the transaction wrapper', () => {
    expect(registry.get('undo')!.noTransaction).toBe(true)
    expect(registry.get('redo')!.noTransaction).toBe(true)
  })

  it('rejects duplicate registrations', () => {
    const r = new ToolRegistry()
    const tool = defineTool({ name: 'x', group: 'document', description: 'x', input: z.object({}), handler: () => ({ content: [] }) })
    r.register(tool)
    expect(() => r.register(tool)).toThrow(/already registered/)
  })
})

describe('registry error handling', () => {
  it('never throws, and explains bad arguments', async () => {
    const t = setup()
    const cases: Array<[string, unknown]> = [
      ['draw_grid', {}],
      ['draw_grid', { rows: 'nope' }],
      ['draw_grid', { rows: ['0'], colour: 1 }],
      ['draw_line', { x0: 'a' }],
      ['add_layer', { opacity: 5 }],
      ['no_such_tool', {}],
      ['draw_grid', '{not json'],
      ['set_palette', { colors: ['#12'] }]
    ]
    for (const [name, args] of cases) {
      const r = await t.call(name, args)
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true)
    }
    expect((await t.call('get_document', null)).isError).toBeFalsy()
  })

  it('error text names the tool and argument', async () => {
    const t = setup()
    const a = resultText(await t.call('draw_grid', {}))
    expect(a).toContain('Invalid arguments for draw_grid')
    expect(a).toContain('rows')
    expect(a).toMatch(/missing/)
    const b = resultText(await t.call('draw_grid', { rows: ['0'], colour: 1 }))
    expect(b).toMatch(/Unrecognized argument "colour"/)
    const c = resultText(await t.call('draw_gird', {}))
    expect(c).toMatch(/Unknown tool "draw_gird"/)
  })

  it('accepts JSON-string arguments', async () => {
    const t = setup()
    const r = await t.call('draw_grid', JSON.stringify({ rows: ['0'] }))
    expect(r.isError).toBeFalsy()
  })

  it('returns an error for an already aborted signal', async () => {
    const t = setup()
    const c = new AbortController()
    c.abort()
    expect((await t.call('draw_grid', { rows: ['0'] }, c.signal)).isError).toBe(true)
  })
})

describe('createToolHost', () => {
  it('lists defs, serializes calls and groups turns', async () => {
    const t = setup()
    const host = createToolHost(t.registry, () => ({ session: t.session, services: t.services }))
    expect(host.tools()).toHaveLength(62)
    const sig = new AbortController().signal
    const d0 = t.session.history.undoDepth
    host.beginTurn('Test turn')
    await Promise.all([
      host.execute('draw_grid', { rows: ['0'] }, sig),
      host.execute('add_frame', {}, sig),
      host.execute('draw_grid', { rows: ['1'] }, sig)
    ])
    await host.endTurn()
    expect(t.session.history.undoDepth).toBe(d0 + 1)
    await host.beginTurn()
    await host.execute('add_frame', {}, sig)
    await host.endTurn({ rollback: true })
    expect(t.doc.frames).toHaveLength(2)
  })
})
