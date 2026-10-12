import type { ReactNode } from 'react'
import type { ToolId } from '../lib/keys'

const common = { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'square' as const }

const PATHS: Record<ToolId, ReactNode> = {
  pencil: <path d="M2.5 13.5 3 10.5 10.5 3 13 5.5 5.5 13z M9 4.5l2.5 2.5" />,
  eraser: <path d="M3 10.5 9 4.5 13 8.5 9 12.5H5.5z M7 12.5h6" />,
  fill: <path d="M3 8 7.5 3.5 12 8 7.5 12.5z M13.5 10.5c.8 1 .8 2 0 2.5-.8-.5-.8-1.500 0-2.500z" />,
  line: <path d="M3 13 13 3" />,
  rect: <rect x="3" y="4" width="10" height="8" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.500" ry="4" />,
  picker: <path d="M12.500 3.500l-2 2 M11 2.500l2.500 2.500-2 2L9 4.500z M9 6.500 3.500 12 3 13l1-.5L9.500 7" />,
  select: <rect x="3" y="3" width="10" height="10" strokeDasharray="2 2" />
}

export function ToolIcon({ tool }: { tool: ToolId }) {
  return <svg {...common}>{PATHS[tool]}</svg>
}
