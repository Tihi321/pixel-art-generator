import { useEffect } from 'react'
import { buildSequence, frameDelay, nextPosition, startPosition } from '../lib/playback'
import { session } from '../state/session'
import { useUi } from '../state/ui'

/** Runs animation playback while `ui.playing` is true (respects frame durations / FPS, tag, direction and loop). */
export function usePlayback(): void {
  const playing = useUi((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let timer = 0
    let pos = -1
    const stop = (): void => useUi.getState().set({ playing: false })

    const sequence = (): number[] => {
      const ui = useUi.getState()
      const tag = ui.playTagId ? (session.doc.tags.find((t) => t.id === ui.playTagId) ?? null) : null
      return buildSequence(session.doc.frames.length, tag)
    }
    const loopEnabled = (): boolean => {
      const ui = useUi.getState()
      const tag = ui.playTagId ? session.doc.tags.find((t) => t.id === ui.playTagId) : undefined
      return ui.loop && (tag?.loop ?? true)
    }
    const show = (seq: number[]): void => {
      try {
        session.setActiveFrame(seq[pos]!)
      } catch {
        stop()
      }
    }
    const tick = (): void => {
      const seq = sequence()
      if (pos < 0 || pos >= seq.length) pos = 0
      const ui = useUi.getState()
      const delay = frameDelay(session.doc, seq[pos]!, { useFrameDurations: ui.useFrameDurations, fps: ui.fps })
      timer = window.setTimeout(() => {
        const s = sequence()
        const next = nextPosition(s, Math.min(pos, s.length - 1), loopEnabled())
        if (next === null) {
          stop()
          return
        }
        pos = next
        show(s)
        tick()
      }, delay)
    }

    const seq = sequence()
    pos = startPosition(seq, session.activeFrameIndex)
    show(seq)
    tick()
    return () => window.clearTimeout(timer)
  }, [playing])
}
