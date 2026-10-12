import { describe, expect, it } from 'vitest'
import { shortcutFor, TOOL_KEYS } from '../../src/renderer/lib/keys'

const k = (key: string, o: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) =>
  shortcutFor({ key, ctrl: false, shift: false, alt: false, ...o })

describe('shortcuts', () => {
  it('maps tool keys', () => {
    expect(k('b')).toEqual({ type: 'tool', tool: 'pencil' })
    expect(k('E')).toEqual({ type: 'tool', tool: 'eraser' })
    expect(k('g')).toEqual({ type: 'tool', tool: 'fill' })
    expect(k('l')).toEqual({ type: 'tool', tool: 'line' })
    expect(k('r')).toEqual({ type: 'tool', tool: 'rect' })
    expect(k('o')).toEqual({ type: 'tool', tool: 'ellipse' })
    expect(k('i')).toEqual({ type: 'tool', tool: 'picker' })
    expect(k('m')).toEqual({ type: 'tool', tool: 'select' })
    expect(Object.keys(TOOL_KEYS)).toHaveLength(8)
  })

  it('maps undo / redo / swap / zoom', () => {
    expect(k('z', { ctrl: true })).toEqual({ type: 'undo' })
    expect(k('y', { ctrl: true })).toEqual({ type: 'redo' })
    expect(k('z', { ctrl: true, shift: true })).toEqual({ type: 'redo' })
    expect(k('Z', { ctrl: true, shift: true })).toEqual({ type: 'redo' })
    expect(k('x')).toEqual({ type: 'swap' })
    expect(k('+')).toEqual({ type: 'zoom', dir: 1 })
    expect(k('=')).toEqual({ type: 'zoom', dir: 1 })
    expect(k('-')).toEqual({ type: 'zoom', dir: -1 })
    expect(k('0')).toEqual({ type: 'fit' })
  })

  it('ignores unknown keys and alt chords', () => {
    expect(k('q')).toBeNull()
    expect(k('b', { alt: true })).toBeNull()
    expect(k('b', { ctrl: true })).toBeNull()
  })
})
