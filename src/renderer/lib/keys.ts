// Keyboard shortcut mapping. Pure functions, no DOM.

export type ToolId = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse' | 'picker' | 'select'

export const TOOL_KEYS: Readonly<Record<string, ToolId>> = {
  b: 'pencil',
  e: 'eraser',
  g: 'fill',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  i: 'picker',
  m: 'select'
}

export const TOOL_LABELS: Readonly<Record<ToolId, string>> = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  fill: 'Fill',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  picker: 'Color picker',
  select: 'Select / move'
}

export const TOOL_ORDER: readonly ToolId[] = ['pencil', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'picker', 'select']

export type ShortcutAction =
  | { type: 'tool'; tool: ToolId }
  | { type: 'swap' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'zoom'; dir: 1 | -1 }
  | { type: 'fit' }
  | { type: 'brush'; delta: 1 | -1 }
  | { type: 'deselect' }
  | { type: 'clearSelection' }
  | { type: 'selectAll' }

export interface KeyInfo {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

/** Map a key press to an editor action, or null. */
export function shortcutFor(k: KeyInfo): ShortcutAction | null {
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key
  if (k.ctrl) {
    if (key === 'z') return k.shift ? { type: 'redo' } : { type: 'undo' }
    if (key === 'y') return { type: 'redo' }
    if (key === 'a') return { type: 'selectAll' }
    if (key === 'd') return { type: 'deselect' }
    return null
  }
  if (k.alt) return null
  const tool = TOOL_KEYS[key]
  if (tool) return { type: 'tool', tool }
  switch (key) {
    case 'x':
      return { type: 'swap' }
    case '+':
    case '=':
      return { type: 'zoom', dir: 1 }
    case '-':
    case '_':
      return { type: 'zoom', dir: -1 }
    case '0':
    case 'f':
      return { type: 'fit' }
    case ']':
      return { type: 'brush', delta: 1 }
    case '[':
      return { type: 'brush', delta: -1 }
    case 'Escape':
      return { type: 'deselect' }
    case 'Delete':
    case 'Backspace':
      return { type: 'clearSelection' }
    default:
      return null
  }
}
