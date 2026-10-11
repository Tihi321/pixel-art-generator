import { describe, expect, it } from 'vitest'
import {
  type Document,
  History,
  buildSpriteSheet,
  createAddFrameCommand,
  createAddLayerCommand,
  createCreateTagCommand,
  createDocument,
  createPaintCommand,
  createSetFrameDurationCommand,
  decodePng,
  drawRect,
  encodePng,
  setPixels,
  sheetMetadata
} from '../../src/core'
import { BLUE, GREEN, RED } from './helpers'

/** 4x4 doc with 3 frames; frame i has a distinct colored pixel at (i, i). */
function animDoc(): { doc: Document; h: History } {
  const doc = createDocument({ width: 4, height: 4, name: 'hero walk' })
  const h = new History(doc)
  h.execute(createAddFrameCommand(doc))
  h.execute(createAddFrameCommand(doc))
  h.execute(createSetFrameDurationCommand(doc, 'all', 80))
  const colors = [RED, GREEN, BLUE]
  doc.frames.forEach((f, i) => {
    h.execute(
      createPaintCommand(doc, {
        layer: 0,
        frame: f.id,
        mutate: (img) => setPixels(img, [{ x: i, y: i, color: colors[i]! }])
      })!
    )
  })
  return { doc, h }
}

describe('sprite sheet', () => {
  it('lays out horizontally with padding and border', () => {
    const { doc } = animDoc()
    const s = buildSpriteSheet(doc, { layout: 'horizontal', padding: 1, border: 2 })
    expect([s.width, s.height]).toEqual([4 * 3 + 2 + 4, 4 + 4])
    expect(s.frames.map((f) => f.rect)).toEqual([
      { x: 2, y: 2, w: 4, h: 4 },
      { x: 7, y: 2, w: 4, h: 4 },
      { x: 12, y: 2, w: 4, h: 4 }
    ])
    // pixel content landed at the right offsets
    expect(s.data[(2 + 0) * s.width + 2 + 0]).toBe(RED)
    expect(s.data[(2 + 1) * s.width + 7 + 1]).toBe(GREEN)
    expect(s.data[(2 + 2) * s.width + 12 + 2]).toBe(BLUE)
    expect(s.data[0]).toBe(0)
    expect(s.frames[0]).toMatchObject({ durationMs: 80, trimmed: false, sourceSize: { w: 4, h: 4 } })
  })

  it('lays out vertically and in a grid', () => {
    const { doc } = animDoc()
    const v = buildSpriteSheet(doc, { layout: 'vertical' })
    expect([v.width, v.height]).toEqual([4, 12])
    expect(v.frames.map((f) => f.rect.y)).toEqual([0, 4, 8])
    const g = buildSpriteSheet(doc, { layout: 'grid', columns: 2, padding: 2 })
    expect([g.width, g.height]).toEqual([10, 10])
    expect(g.frames.map((f) => [f.rect.x, f.rect.y])).toEqual([
      [0, 0],
      [6, 0],
      [0, 6]
    ])
    const auto = buildSpriteSheet(doc, { layout: 'grid' })
    expect([auto.width, auto.height]).toEqual([8, 8]) // ceil(sqrt(3)) = 2 columns
  })

  it('scales output and metadata together', () => {
    const { doc } = animDoc()
    const s = buildSpriteSheet(doc, { scale: 3 })
    expect([s.width, s.height]).toEqual([36, 12])
    expect(s.frames[1]!.rect).toEqual({ x: 12, y: 0, w: 12, h: 12 })
    expect(s.frames[0]!.sourceSize).toEqual({ w: 12, h: 12 })
    expect(s.data[0]).toBe(RED)
    expect(s.data[2 * s.width + 2]).toBe(RED) // the 3x3 block of pixel (0,0)
    expect(s.data[3 * s.width + 3]).toBe(0)
  })

  it('packs trimmed frames with a shelf packer without overlap', () => {
    const doc = createDocument({ width: 16, height: 16, name: 'pack' })
    const h = new History(doc)
    const sizes: Array<[number, number]> = [[8, 2], [3, 6], [5, 5], [2, 2]]
    sizes.forEach(([w, hh], i) => {
      if (i > 0) h.execute(createAddFrameCommand(doc))
      h.execute(
        createPaintCommand(doc, {
          layer: 0,
          frame: i,
          mutate: (img) => drawRect(img, 3 + i, 4, w, hh, RED, { filled: true })
        })!
      )
    })
    const s = buildSpriteSheet(doc, { layout: 'packed', padding: 1 })
    expect(s.frames.map((f) => [f.rect.w, f.rect.h])).toEqual(sizes)
    expect(s.frames.every((f) => f.trimmed)).toBe(true)
    expect(s.frames[0]!.spriteSourceSize).toEqual({ x: 3, y: 4, w: 8, h: 2 })
    // no overlaps, all inside the sheet
    for (let i = 0; i < s.frames.length; i++) {
      const a = s.frames[i]!.rect
      expect(a.x + a.w).toBeLessThanOrEqual(s.width)
      expect(a.y + a.h).toBeLessThanOrEqual(s.height)
      for (let j = i + 1; j < s.frames.length; j++) {
        const b = s.frames[j]!.rect
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap, `frames ${i} and ${j} overlap`).toBe(false)
      }
    }
    // every frame's pixels are fully red in its rect
    for (const f of s.frames) {
      for (let y = 0; y < f.rect.h; y++) for (let x = 0; x < f.rect.w; x++) expect(s.data[(f.rect.y + y) * s.width + f.rect.x + x]).toBe(RED)
    }
    // packed is smaller than the untrimmed horizontal strip
    expect(s.width * s.height).toBeLessThan(16 * 16 * 4)
  })

  it('selects frames by tag, range and layers; remaps tags to sheet positions', () => {
    const { doc, h } = animDoc()
    h.execute(createCreateTagCommand(doc, { name: 'a', from: 0, to: 0 }))
    h.execute(createCreateTagCommand(doc, { name: 'walk', from: 1, to: 2, direction: 'reverse' }))
    const byTag = buildSpriteSheet(doc, { tags: ['walk'] })
    expect(byTag.frames.map((f) => f.index)).toEqual([1, 2])
    expect(byTag.tags).toEqual([{ name: 'walk', from: 0, to: 1, direction: 'reverse', loop: true }])
    const range = buildSpriteSheet(doc, { frames: { from: 1, to: 2 } })
    expect(range.frames.map((f) => f.index)).toEqual([1, 2])
    expect(range.tags.map((t) => [t.name, t.from, t.to])).toEqual([['walk', 0, 1]])
    expect(buildSpriteSheet(doc, { frames: [2, 0] }).frames.map((f) => f.index)).toEqual([0, 2])
    expect(() => buildSpriteSheet(doc, { tags: ['nope'] })).toThrow(/Tag "nope" not found/)
    expect(() => buildSpriteSheet(doc, { frames: [9] })).toThrow(/out of range/)

    // layer filter: a second layer with a marker pixel
    const add = createAddLayerCommand(doc, { name: 'Marker' })
    h.execute(add)
    h.execute(
      createPaintCommand(doc, { layer: add.createdId, frame: 0, mutate: (img) => setPixels(img, [{ x: 3, y: 3, color: BLUE }]) })!
    )
    const all = buildSpriteSheet(doc, { frames: [0] })
    expect(all.data[3 * 4 + 3]).toBe(BLUE)
    const onlyBase = buildSpriteSheet(doc, { frames: [0], layers: [0] })
    expect(onlyBase.data[3 * 4 + 3]).toBe(0)
    expect(onlyBase.data[0]).toBe(RED)
  })

  it('emits Aseprite array/hash and TexturePacker metadata with tags and durations', () => {
    const { doc, h } = animDoc()
    h.execute(createCreateTagCommand(doc, { name: 'walk', from: 0, to: 2, direction: 'pingpong', loop: false }))
    const sheet = buildSpriteSheet(doc, { imageName: 'hero.png' })

    const arr = sheetMetadata(sheet, 'aseprite-array') as {
      frames: Array<{ filename: string; frame: unknown; duration: number }>
      meta: { image: string; size: unknown; format: string; frameTags: unknown[] }
    }
    expect(Array.isArray(arr.frames)).toBe(true)
    expect(arr.frames).toHaveLength(3)
    expect(arr.frames[0]).toMatchObject({ filename: 'hero_walk_0', frame: { x: 0, y: 0, w: 4, h: 4 }, duration: 80, rotated: false, trimmed: false })
    expect(arr.meta).toMatchObject({ image: 'hero.png', size: { w: 12, h: 4 }, format: 'RGBA8888', scale: '1' })
    expect(arr.meta.frameTags).toEqual([{ name: 'walk', from: 0, to: 2, direction: 'pingpong', repeat: '1' }])

    const hash = sheetMetadata(sheet, 'aseprite-hash') as { frames: Record<string, { frame: unknown; duration: number }>; meta: unknown }
    expect(Object.keys(hash.frames)).toEqual(['hero_walk_0', 'hero_walk_1', 'hero_walk_2'])
    expect(hash.frames.hero_walk_1).toMatchObject({ frame: { x: 4, y: 0, w: 4, h: 4 }, duration: 80 })

    const tp = sheetMetadata(sheet, 'texturepacker') as { frames: Record<string, { pivot: unknown; spriteSourceSize: unknown }>; meta: { app: string } }
    expect(tp.frames.hero_walk_2).toMatchObject({ pivot: { x: 0.5, y: 0.5 }, spriteSourceSize: { x: 0, y: 0, w: 4, h: 4 } })
    expect(tp.meta.app).toBe('Pixel Studio')
    // JSON-serializable
    expect(() => JSON.stringify(arr)).not.toThrow()
  })

  it('produces a PNG that decodes to the sheet', () => {
    const { doc } = animDoc()
    const s = buildSpriteSheet(doc, { layout: 'horizontal' })
    const png = decodePng(encodePng({ width: s.width, height: s.height, data: s.data }))
    expect(Array.from(png.data)).toEqual(Array.from(s.data))
  })

  it('rounds to powers of two on request', () => {
    const { doc } = animDoc()
    const s = buildSpriteSheet(doc, { powerOfTwo: true })
    expect([s.width, s.height]).toEqual([16, 4])
  })
})
