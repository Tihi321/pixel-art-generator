import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractGuide, renderGuideModule } from '../../scripts/gen-guide.mjs'
import { GUIDE, GUIDE_SHORT, createDefaultRegistry } from '../../src/tools'

const md = readFileSync(resolve(__dirname, '../../docs/llm-guide.md'), 'utf8')

describe('LLM guide', () => {
  it('guideText.ts is in sync with docs/llm-guide.md (run `yarn gen:guide`)', () => {
    const expected = renderGuideModule(md).replace(/\r\n/g, '\n')
    const actual = readFileSync(resolve(__dirname, '../../src/tools/guideText.ts'), 'utf8').replace(/\r\n/g, '\n')
    expect(actual).toBe(expected)
    const { guide, short } = extractGuide(md)
    expect(GUIDE).toBe(guide)
    expect(GUIDE_SHORT).toBe(short)
  })

  it('the short guide is at most 1500 characters and contains the essentials', () => {
    expect(GUIDE_SHORT.length).toBeLessThanOrEqual(1500)
    expect(GUIDE_SHORT).toContain('draw_grid')
    expect(GUIDE_SHORT).toContain('render_preview')
    expect(GUIDE).toContain(GUIDE_SHORT)
  })

  it('every tool-like name in backticks is a registered tool', () => {
    const names = new Set(createDefaultRegistry().list().map((t) => t.name))
    const mentioned = new Set<string>()
    for (const m of GUIDE.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) mentioned.add(m[1]!)
    expect(mentioned.size).toBeGreaterThan(20)
    const unknown = [...mentioned].filter((n) => !names.has(n))
    expect(unknown).toEqual([])
  })

  it('mentions the core workflow tools', () => {
    for (const n of ['get_document', 'draw_grid', 'read_grid', 'render_preview', 'export_spritesheet', 'export_gif', 'export_png', 'create_tag', 'duplicate_frame', 'remap_to_palette']) {
      expect(GUIDE).toContain('`' + n + '`')
    }
  })

  it('the generator rejects a missing marker or an overlong short guide', () => {
    expect(() => extractGuide('# no markers')).toThrow(/short:start/)
    expect(() => extractGuide(`<!-- short:start -->${'x'.repeat(1501)}<!-- short:end -->`)).toThrow(/1500/)
  })
})
