import { useSession } from '../hooks/useSession'
import { TOOL_KEYS, TOOL_LABELS, TOOL_ORDER } from '../lib/keys'
import { session } from '../state/session'
import { useUi } from '../state/ui'
import { ToolIcon } from './Icons'

const keyOf = (tool: string): string => Object.entries(TOOL_KEYS).find(([, t]) => t === tool)?.[0]?.toUpperCase() ?? ''

export function Toolbar() {
  useSession()
  const tool = useUi((s) => s.tool)
  const setTool = useUi((s) => s.setTool)
  return (
    <div className="toolbar-inner">
      {TOOL_ORDER.map((t) => (
        <button
          key={t}
          className={`tool-btn${tool === t ? ' active' : ''}`}
          title={`${TOOL_LABELS[t]} (${keyOf(t)})`}
          data-testid={`tool-${t}`}
          aria-pressed={tool === t}
          onClick={() => setTool(t)}
        >
          <ToolIcon tool={t} />
        </button>
      ))}
      <div className="color-pair" title="Primary / secondary colour (X swaps)">
        <button className="swatch secondary" style={{ background: session.secondaryColor }} onClick={() => session.swapColors()} aria-label="Secondary colour" />
        <button
          className="swatch primary"
          style={{ background: session.primaryColor }}
          onClick={() => session.swapColors()}
          data-testid="primary-color"
          aria-label="Primary colour"
        />
      </div>
      <button className="mini-btn" title="Swap colours (X)" onClick={() => session.swapColors()}>
        X
      </button>
    </div>
  )
}
