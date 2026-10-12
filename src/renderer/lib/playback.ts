// Animation playback sequencing and timing. Pure functions, no DOM.

import type { AnimTag, Document } from '../../core'

/** Frame indices of one playback cycle for a tag (or all frames when no tag). */
export function buildSequence(frameCount: number, tag: Pick<AnimTag, 'from' | 'to' | 'direction'> | null): number[] {
  const from = tag ? Math.max(0, Math.min(frameCount - 1, tag.from)) : 0
  const to = tag ? Math.max(from, Math.min(frameCount - 1, tag.to)) : Math.max(0, frameCount - 1)
  const fwd: number[] = []
  for (let i = from; i <= to; i++) fwd.push(i)
  const dir = tag?.direction ?? 'forward'
  if (dir === 'reverse') return fwd.reverse()
  if (dir === 'pingpong') {
    const back: number[] = []
    for (let i = to - 1; i > from; i--) back.push(i)
    return [...fwd, ...back]
  }
  return fwd
}

/** Position in the sequence to start from when the active frame is `frameIndex` (0 if it is not in it). */
export function startPosition(sequence: number[], frameIndex: number): number {
  const i = sequence.indexOf(frameIndex)
  return i < 0 ? 0 : i
}

/** Next position in the sequence, or null when playback should stop (end reached and not looping). */
export function nextPosition(sequence: number[], pos: number, loop: boolean): number | null {
  if (sequence.length === 0) return null
  if (pos + 1 < sequence.length) return pos + 1
  return loop ? 0 : null
}

export interface DelayOptions {
  /** When true, use each frame's own duration; otherwise a fixed rate. */
  useFrameDurations: boolean
  fps: number
}

/** Milliseconds to show the given frame for. */
export function frameDelay(doc: Pick<Document, 'frames'>, frameIndex: number, opts: DelayOptions): number {
  if (opts.useFrameDurations) return Math.max(10, doc.frames[frameIndex]?.durationMs ?? 100)
  return Math.max(10, Math.round(1000 / Math.max(1, Math.min(60, opts.fps))))
}
