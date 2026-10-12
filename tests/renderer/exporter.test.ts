import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT, planExport, sanitizeBaseName, type ExportSettings } from '../../src/renderer/lib/exporter'
import { type Cel, celKey, createAddFrameCommand, createCreateTagCommand, decodePng, hasPngSignature } from '../../src/core'
import { EditorSession } from '../../src/tools/session'
import { RED } from '../core/helpers'

function sessionWithFrames(n: number): EditorSession {
  const s = new EditorSession()
  for (let i = 1; i < n; i++) s.execute(createAddFrameCommand(s.doc))
  const cel: Cel = { x: 0, y: 0, w: 1, h: 1, data: Uint32Array.of(RED) }
  s.doc.cels.set(celKey(s.doc.layers[0]!.id, s.doc.frames[0]!.id), cel)
  return s
}

const settings = (p: Partial<ExportSettings>): ExportSettings => ({ ...DEFAULT_EXPORT, baseName: 'hero', ...p })

describe('planExport', () => {
  it('sanitizes file names', () => {
    expect(sanitizeBaseName('a/b:c')).toBe('a_b_c')
    expect(sanitizeBaseName('  ')).toBe('sprite')
  })

  it('exports the current frame as a PNG', () => {
    const s = sessionWithFrames(2)
    const files = planExport(s.doc, settings({ kind: 'png', scale: 2 }), 0)
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('hero.png')
    const png = files[0]!.data as Uint8Array
    expect(hasPngSignature(png)).toBe(true)
    const img = decodePng(png)
    expect([img.width, img.height]).toEqual([s.doc.width * 2, s.doc.height * 2])
    expect(img.data[0]).toBe(RED)
  })

  it('exports all frames as numbered PNGs', () => {
    const s = sessionWithFrames(3)
    const files = planExport(s.doc, settings({ kind: 'png', pngScope: 'all' }), 0)
    expect(files.map((f) => f.name)).toEqual(['hero_0.png', 'hero_1.png', 'hero_2.png'])
  })

  it('exports a sprite sheet with metadata JSON', () => {
    const s = sessionWithFrames(3)
    const files = planExport(s.doc, settings({ kind: 'sheet', layout: 'horizontal', metaFormat: 'aseprite-hash' }), 0)
    expect(files.map((f) => f.name)).toEqual(['hero.png', 'hero.json'])
    const img = decodePng(files[0]!.data as Uint8Array)
    expect(img.width).toBe(s.doc.width * 3)
    const meta = JSON.parse(files[1]!.data as string)
    expect(Object.keys(meta.frames)).toHaveLength(3)
    expect(meta.meta.image).toBe('hero.png')
  })

  it('limits a sheet to a tag and supports the other metadata formats', () => {
    const s = sessionWithFrames(4)
    s.execute(createCreateTagCommand(s.doc, { name: 'walk', from: 1, to: 2 }))
    const files = planExport(s.doc, settings({ kind: 'sheet', tag: 'walk', metaFormat: 'aseprite-array' }), 0)
    const meta = JSON.parse(files[1]!.data as string)
    expect(meta.frames).toHaveLength(2)
    const tp = JSON.parse(planExport(s.doc, settings({ kind: 'sheet', metaFormat: 'texturepacker' }), 0)[1]!.data as string)
    expect(Object.keys(tp.frames)).toHaveLength(4)
    expect(() => planExport(s.doc, settings({ kind: 'sheet', tag: 'nope' }), 0)).toThrow(/Tag/)
  })

  it('exports a GIF', () => {
    const s = sessionWithFrames(2)
    const files = planExport(s.doc, settings({ kind: 'gif' }), 0)
    expect(files[0]!.name).toBe('hero.gif')
    const bytes = files[0]!.data as Uint8Array
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a')
  })
})
