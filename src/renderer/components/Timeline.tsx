import { useState } from 'react'
import { TAG_DIRECTIONS, type AnimTag, type TagDirection, getCel } from '../../core'
import { useSession } from '../hooks/useSession'
import {
  addFrame,
  createTag,
  deleteFrame,
  deleteTag,
  duplicateFrame,
  moveFrame,
  setFrameDuration,
  updateTag
} from '../state/actions'
import { session } from '../state/session'
import { useUi } from '../state/ui'
import { NumberField } from './Controls'

const FRAME_W = 58
const LABEL_W = 132

const TAG_COLORS = ['#e0645c', '#e0a45c', '#c7c95a', '#5cc77f', '#5cb5c7', '#5c7fe0', '#a05ce0', '#e05cb0']

function TagEditor({ tag }: { tag: AnimTag }) {
  const frameCount = session.doc.frames.length
  const [name, setName] = useState(tag.name)
  const ui = useUi()
  return (
    <div className="tag-editor" data-testid="tag-editor">
      <label>
        Tag
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== tag.name && updateTag(tag.id, { name })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid="tag-name"
        />
      </label>
      <label>
        From
        <NumberField value={tag.from} min={0} max={frameCount - 1} width={40} onCommit={(v) => updateTag(tag.id, { from: v, to: Math.max(v, tag.to) })} />
      </label>
      <label>
        To
        <NumberField value={tag.to} min={0} max={frameCount - 1} width={40} onCommit={(v) => updateTag(tag.id, { to: v, from: Math.min(v, tag.from) })} />
      </label>
      <label>
        Direction
        <select value={tag.direction} onChange={(e) => updateTag(tag.id, { direction: e.target.value as TagDirection })}>
          {TAG_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={tag.loop !== false} onChange={(e) => updateTag(tag.id, { loop: e.target.checked })} />
        Loop
      </label>
      <button
        onClick={() => {
          deleteTag(tag.id)
          ui.set({ selectedTagId: '', playTagId: ui.playTagId === tag.id ? '' : ui.playTagId })
        }}
        data-testid="tag-delete"
      >
        Delete tag
      </button>
      <button onClick={() => ui.set({ selectedTagId: '' })}>Done</button>
    </div>
  )
}

export function Timeline() {
  useSession()
  const ui = useUi()
  const doc = session.doc
  const activeLayerId = session.activeLayer.id
  const activeFrameIdx = session.activeFrameIndex
  const layers = [...doc.layers].reverse()
  const selectedTag = doc.tags.find((t) => t.id === ui.selectedTagId)
  const headRow = doc.tags.length + 1
  const cols = `${LABEL_W}px repeat(${doc.frames.length}, ${FRAME_W}px)`

  return (
    <div className="timeline-inner">
      <div className="timeline-bar">
        <span className="label">Timeline</span>
        <button
          className={ui.playing ? 'active' : ''}
          onClick={() => ui.set({ playing: !ui.playing })}
          title="Play / stop"
          data-testid="play"
        >
          {ui.playing ? 'Stop' : 'Play'}
        </button>
        <label className="opt" title="Tag to play (empty: all frames)">
          Tag
          <select value={ui.playTagId} onChange={(e) => ui.set({ playTagId: e.target.value })} data-testid="play-tag">
            <option value="">All frames</option>
            {doc.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="opt" title="Playback rate when frame durations are not used">
          FPS
          <input
            type="number"
            min={1}
            max={60}
            value={ui.fps}
            disabled={ui.useFrameDurations}
            onChange={(e) => ui.set({ fps: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
          />
        </label>
        <label className="opt" title="Use each frame's own duration">
          <input type="checkbox" checked={ui.useFrameDurations} onChange={(e) => ui.set({ useFrameDurations: e.target.checked })} />
          Frame durations
        </label>
        <label className="opt">
          <input type="checkbox" checked={ui.loop} onChange={(e) => ui.set({ loop: e.target.checked })} />
          Loop
        </label>
        <span className="sep" />
        <button onClick={addFrame} title="Add frame after the current one" data-testid="frame-add">+ Frame</button>
        <button onClick={() => duplicateFrame()} title="Duplicate frame" data-testid="frame-dup">Dup</button>
        <button onClick={() => deleteFrame()} disabled={doc.frames.length <= 1} title="Delete frame" data-testid="frame-delete">Del</button>
        <button onClick={() => moveFrame(session.activeFrame.id, activeFrameIdx - 1)} disabled={activeFrameIdx === 0} title="Move frame left">&larr;</button>
        <button
          onClick={() => moveFrame(session.activeFrame.id, activeFrameIdx + 1)}
          disabled={activeFrameIdx >= doc.frames.length - 1}
          title="Move frame right"
        >
          &rarr;
        </button>
        <span className="sep" />
        <button
          onClick={() => {
            const id = createTag({ name: `Tag ${doc.tags.length + 1}`, from: activeFrameIdx, to: activeFrameIdx })
            if (id) ui.set({ selectedTagId: id })
          }}
          title="Create a tag starting at the current frame"
          data-testid="tag-add"
        >
          + Tag
        </button>
        <span className="spacer" />
        <span className="frame-count" data-testid="frame-count">
          Frame {activeFrameIdx} / {doc.frames.length - 1} ({doc.frames.length} total)
        </span>
      </div>
      {selectedTag && <TagEditor key={selectedTag.id} tag={selectedTag} />}
      <div className="timeline-scroll">
        <div className="tl-grid" style={{ gridTemplateColumns: cols }} data-testid="cel-grid">
          {doc.tags.map((t, ti) => (
            <div key={t.id} style={{ display: 'contents' }}>
              <div className="tl-label tag-label" style={{ gridRow: ti + 1, gridColumn: 1 }}>
                {t.name}
              </div>
              <button
                className={`tag-bar${t.id === ui.selectedTagId ? ' selected' : ''}`}
                style={{ gridRow: ti + 1, gridColumn: `${t.from + 2} / ${t.to + 3}`, background: TAG_COLORS[ti % TAG_COLORS.length] }}
                title={`${t.name}: ${t.from}-${t.to} ${t.direction}${t.loop === false ? ' (no loop)' : ''}`}
                data-testid="tag-bar"
                onClick={() => ui.set({ selectedTagId: t.id === ui.selectedTagId ? '' : t.id, playTagId: t.id })}
              >
                {t.name}
              </button>
            </div>
          ))}
          <div className="tl-label head" style={{ gridRow: headRow, gridColumn: 1 }}>
            Frames
          </div>
          {doc.frames.map((f, i) => (
            <div
              key={f.id}
              className={`frame-head${i === activeFrameIdx ? ' active' : ''}`}
              style={{ gridRow: headRow, gridColumn: i + 2 }}
              data-testid="frame-head"
              onClick={() => session.setActiveFrame(f.id)}
            >
              <span className="idx">{i}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <NumberField
                  value={f.durationMs}
                  min={1}
                  max={60000}
                  width={FRAME_W - 24}
                  title="Frame duration (ms)"
                  onCommit={(v) => setFrameDuration(f.id, v)}
                />
              </span>
            </div>
          ))}
          {layers.map((l, li) => (
            <div key={l.id} style={{ display: 'contents' }}>
              <div
                style={{ gridRow: headRow + 1 + li, gridColumn: 1 }}
                className={`tl-label${l.id === activeLayerId ? ' active' : ''}${l.visible ? '' : ' hidden'}`}
                onClick={() => session.setActiveLayer(l.id)}
                title={l.name}
              >
                {l.name}
              </div>
              {doc.frames.map((f, i) => {
                const has = !!getCel(doc, l.id, f.id)
                const isActive = l.id === activeLayerId && i === activeFrameIdx
                return (
                  <div
                    key={f.id}
                    style={{ gridRow: headRow + 1 + li, gridColumn: i + 2 }}
                    className={`cel${isActive ? ' active' : ''}${i === activeFrameIdx ? ' col-active' : ''}`}
                    data-testid="cel"
                    data-has={has ? '1' : '0'}
                    onClick={() => {
                      session.setActiveLayer(l.id)
                      session.setActiveFrame(f.id)
                    }}
                  >
                    {has && <span className="dot" />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
