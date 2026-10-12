import { describe, expect, it } from 'vitest'
import { composeFrame, onionFrames, tintImage } from '../../src/renderer/lib/compose'
import { type Cel, celKey, createAddFrameCommand, createRaster, createUpdateLayerCommand } from '../../src/core'
import { EditorSession } from '../../src/tools/session'
import { BLUE, RED } from '../core/helpers'

function celOf(color: number): Cel {
  return { x: 0, y: 0, w: 1, h: 1, data: Uint32Array.of(color) }
}

describe('composeFrame', () => {
  it('composites visible layers and honours the live preview', () => {
    const s = new EditorSession()
    const d = s.doc
    const lid = d.layers[0]!.id
    const fid = d.frames[0]!.id
    d.cels.set(celKey(lid, fid), celOf(RED))
    expect(composeFrame(d, fid)[0]).toBe(RED)
    const raster = createRaster(d.width, d.height)
    raster.data[0] = BLUE
    expect(composeFrame(d, fid, { layerId: lid, frameId: fid, raster })[0]).toBe(BLUE)
    s.execute(createUpdateLayerCommand(d, lid, { visible: false }))
    expect(composeFrame(d, fid)[0]).toBe(0)
  })
})

describe('onion skin', () => {
  const onion = { enabled: true, before: 2, after: 1, opacity: 0.6 }

  it('lists neighbouring frames with fading alpha', () => {
    const f = onionFrames(5, 2, onion)
    expect(f.map((o) => o.frameIndex)).toEqual([0, 1, 3])
    expect(f.map((o) => o.side)).toEqual([-1, -1, 1])
    expect(f[1]!.alpha).toBeCloseTo(0.6)
    expect(f[0]!.alpha).toBeCloseTo(0.3)
  })

  it('clips at the ends and respects the enabled flag', () => {
    expect(onionFrames(3, 0, onion).map((o) => o.frameIndex)).toEqual([1])
    expect(onionFrames(3, 2, onion).map((o) => o.frameIndex)).toEqual([0, 1])
    expect(onionFrames(3, 1, { ...onion, enabled: false })).toEqual([])
  })

  it('tints opaque pixels only', () => {
    const out = tintImage(Uint32Array.of(0, RED), [0, 0, 255], 1)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(BLUE)
  })

  it('works with real session frames', () => {
    const s = new EditorSession()
    s.execute(createAddFrameCommand(s.doc))
    expect(onionFrames(s.doc.frames.length, 0, onion)).toHaveLength(1)
  })
})
