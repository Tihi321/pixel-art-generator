import { describe, expect, it } from 'vitest'
import { buildSequence, frameDelay, nextPosition, startPosition } from '../../src/renderer/lib/playback'

describe('playback sequencing', () => {
  it('plays all frames forward without a tag', () => {
    expect(buildSequence(4, null)).toEqual([0, 1, 2, 3])
  })

  it('respects tag ranges and directions', () => {
    expect(buildSequence(8, { from: 2, to: 5, direction: 'forward' })).toEqual([2, 3, 4, 5])
    expect(buildSequence(8, { from: 2, to: 5, direction: 'reverse' })).toEqual([5, 4, 3, 2])
    expect(buildSequence(8, { from: 2, to: 5, direction: 'pingpong' })).toEqual([2, 3, 4, 5, 4, 3])
    expect(buildSequence(8, { from: 3, to: 3, direction: 'pingpong' })).toEqual([3])
    expect(buildSequence(3, { from: 1, to: 9, direction: 'forward' })).toEqual([1, 2])
  })

  it('steps with and without looping', () => {
    const seq = [0, 1, 2]
    expect(nextPosition(seq, 0, false)).toBe(1)
    expect(nextPosition(seq, 2, false)).toBeNull()
    expect(nextPosition(seq, 2, true)).toBe(0)
    expect(nextPosition([], 0, true)).toBeNull()
  })

  it('starts at the active frame when it is part of the sequence', () => {
    expect(startPosition([2, 3, 4], 3)).toBe(1)
    expect(startPosition([2, 3, 4], 0)).toBe(0)
  })

  it('uses per-frame durations or a fixed fps', () => {
    const doc = {
      frames: [
        { id: 'a', durationMs: 50 },
        { id: 'b', durationMs: 400 }
      ]
    }
    expect(frameDelay(doc, 0, { useFrameDurations: true, fps: 10 })).toBe(50)
    expect(frameDelay(doc, 1, { useFrameDurations: true, fps: 10 })).toBe(400)
    expect(frameDelay(doc, 1, { useFrameDurations: false, fps: 10 })).toBe(100)
    expect(frameDelay(doc, 1, { useFrameDurations: false, fps: 1000 })).toBe(17)
  })
})
