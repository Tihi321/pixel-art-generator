import { describe, expect, it } from 'vitest'
import {
  History,
  PROJECT_FORMAT,
  createAddFrameCommand,
  createAddLayerCommand,
  createCreateTagCommand,
  createDocument,
  createPaintCommand,
  createSetReferencesCommand,
  createUpdateLayerCommand,
  deserializeProject,
  drawEllipse,
  projectToObject,
  serializeProject,
  setPixels
} from '../../src/core'
import { BLUE, RED, snapshot } from './helpers'

describe('project (.pxs)', () => {
  it('round-trips a full document', () => {
    const doc = createDocument({ width: 12, height: 9, name: 'Knight' })
    const h = new History(doc)
    const add = createAddLayerCommand(doc, { name: 'Shade', kind: 'pixel', opacity: 0.6, blend: 'multiply' })
    h.execute(add)
    h.execute(createUpdateLayerCommand(doc, add.createdId, { locked: true }))
    h.execute(createAddFrameCommand(doc, { durationMs: 333 }))
    h.execute(createCreateTagCommand(doc, { name: 'idle', from: 0, to: 1, direction: 'pingpong', loop: false }))
    h.execute(createSetReferencesCommand(doc, [{ assetId: 'hero', note: 'palette' }]))
    h.execute(createPaintCommand(doc, { layer: 0, frame: 0, mutate: (img) => drawEllipse(img, 1, 1, 8, 6, RED, { filled: true }) })!)
    h.execute(
      createPaintCommand(doc, { layer: 0, frame: 1, mutate: (img) => setPixels(img, [{ x: 11, y: 8, color: BLUE }, { x: 0, y: 0, color: 0x80010203 }]) })!
    )

    const text = serializeProject(doc)
    const parsed = JSON.parse(text)
    expect(parsed.format).toBe(PROJECT_FORMAT)
    expect(parsed.version).toBe(1)
    expect(parsed.cels).toHaveLength(2)
    expect(parsed.cels[0].png).toMatch(/^iVBORw0KGgo/)
    const back = deserializeProject(text)
    expect(snapshot(back)).toEqual(snapshot(doc))
    // pretty output parses identically
    expect(snapshot(deserializeProject(serializeProject(doc, { pretty: true })))).toEqual(snapshot(doc))
    expect(deserializeProject(projectToObject(doc)).name).toBe('Knight')
  })

  it('gives clear errors for invalid projects', () => {
    expect(() => deserializeProject('{nope')).toThrow(/not valid JSON/)
    expect(() => deserializeProject('{"format":"other"}')).toThrow(/"format" must be "pixel-studio"/)
    const good = projectToObject(createDocument({ width: 2, height: 2 }))
    expect(() => deserializeProject({ ...good, version: 99 })).toThrow(/newer/)
    expect(() => deserializeProject({ ...good, doc: { ...good.doc, width: 0 } })).toThrow(/Invalid canvas size/)
    expect(() => deserializeProject({ ...good, layers: [] })).toThrow(/layers/)
    expect(() =>
      deserializeProject({ ...good, cels: [{ layer: 'x', frame: good.frames[0]!.id, x: 0, y: 0, w: 1, h: 1, png: '' }] })
    ).toThrow(/unknown layer/)
  })
})
