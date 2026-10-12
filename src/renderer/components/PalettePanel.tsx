import { useEffect, useState } from 'react'
import { type PaletteFormat, PALETTE_FORMATS, exportPalette, listBuiltinPalettes, normalizeHex, parsePalette, parseHexColor, rgbaToHex } from '../../core'
import { useSession } from '../hooks/useSession'
import { readFile, resolveExportPath, writeFile } from '../lib/files'
import {
  addPaletteColor,
  attempt,
  loadPresetPalette,
  remapActiveLayer,
  remapDocument,
  removePaletteColor,
  replacePaletteColor,
  setPalette
} from '../state/actions'
import { session } from '../state/session'
import { useUi } from '../state/ui'

/** "#rrggbb" for <input type=color> (drops alpha). */
function colorInputValue(hex: string): string {
  return hex.length >= 7 ? hex.slice(0, 7) : '#000000'
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'palette'
}

export function PalettePanel() {
  useSession()
  const doc = session.doc
  const pal = doc.palette
  const selected = useUi((s) => s.selectedSwatch)
  const setStatus = useUi((s) => s.setStatus)
  const [hexText, setHexText] = useState(session.primaryColor)
  const [format, setFormat] = useState<PaletteFormat>('hex')
  const [ioName, setIoName] = useState('')
  const presets = listBuiltinPalettes()

  // Keep the text box in sync with the primary colour.
  useEffect(() => setHexText(session.primaryColor), [session.primaryColor])

  const commitHex = (text: string): void => {
    const parsed = parseHexColor(text)
    if (parsed === null) {
      setHexText(session.primaryColor)
      setStatus(`"${text}" is not a valid colour (use #rrggbb).`)
      return
    }
    session.setPrimaryColor(rgbaToHex(parsed))
  }

  const currentPreset = presets.find((p) => p.id === pal.id)?.id ?? ''

  const doImport = (text: string | Uint8Array, filename: string): void => {
    attempt(() => {
      const p = parsePalette(text, filename)
      setPalette(p)
      setStatus(`Imported palette "${p.name}" (${p.colors.length} colours)`)
    })
  }

  return (
    <section className="panel palette-panel" data-testid="palette-panel">
      <header className="panel-head">
        <span className="label">Palette</span>
        <span className="pal-name" title={pal.name}>{pal.name} ({pal.colors.length})</span>
        <span className="spacer" />
        <select
          value={currentPreset}
          onChange={(e) => e.target.value && loadPresetPalette(e.target.value)}
          title="Load a built-in palette"
          data-testid="palette-preset"
        >
          <option value="">Preset...</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.size})
            </option>
          ))}
        </select>
      </header>
      <div className="swatches" data-testid="swatches">
        {pal.colors.map((c, i) => (
          <button
            key={`${i}-${c.hex}`}
            className={`swatch cell${selected === i ? ' selected' : ''}${c.hex === session.primaryColor ? ' primary' : ''}${c.hex === session.secondaryColor ? ' secondary-mark' : ''}`}
            style={{ background: c.hex }}
            title={`${c.name ?? c.hex}  (left: primary, right: secondary)`}
            data-testid="swatch"
            onClick={() => {
              useUi.getState().set({ selectedSwatch: i })
              session.setPrimaryColor(c.hex)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              useUi.getState().set({ selectedSwatch: i })
              session.setSecondaryColor(c.hex)
            }}
          />
        ))}
      </div>
      <div className="color-editor">
        <div className="color-pair big">
          <button className="swatch secondary" style={{ background: session.secondaryColor }} onClick={() => session.swapColors()} title="Secondary (click to swap)" />
          <button className="swatch primary" style={{ background: session.primaryColor }} onClick={() => session.swapColors()} title="Primary (click to swap)" />
        </div>
        <input
          type="color"
          value={colorInputValue(session.primaryColor)}
          onChange={(e) => session.setPrimaryColor(e.target.value)}
          title="Pick colour"
          data-testid="color-input"
        />
        <input
          type="text"
          className="hex"
          value={hexText}
          spellCheck={false}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid="hex-input"
        />
      </div>
      <div className="row-buttons">
        <button onClick={() => addPaletteColor(session.primaryColor)} title="Add the primary colour to the palette" data-testid="palette-add">
          Add
        </button>
        <button
          disabled={selected < 0 || selected >= pal.colors.length}
          onClick={() => replacePaletteColor(selected, normalizeHex(session.primaryColor))}
          title="Replace the selected swatch with the primary colour"
        >
          Update
        </button>
        <button
          disabled={selected < 0 || selected >= pal.colors.length}
          onClick={() => {
            removePaletteColor(selected)
            useUi.getState().set({ selectedSwatch: -1 })
          }}
          title="Remove the selected swatch"
        >
          Remove
        </button>
        <button onClick={remapActiveLayer} title="Snap the active layer's pixels to the palette" data-testid="remap-layer">
          Remap layer
        </button>
        <button onClick={remapDocument} title="Snap every layer and frame to the palette" data-testid="remap-doc">
          Remap all
        </button>
      </div>
      <details className="io">
        <summary>Import / export</summary>
        <div className="row-buttons">
          <label className="file-btn">
            Import file...
            <input
              type="file"
              accept=".hex,.gpl,.pal,.png"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                void f.arrayBuffer().then((buf) => doImport(new Uint8Array(buf), f.name))
              }}
            />
          </label>
        </div>
        <div className="row-buttons">
          <input
            type="text"
            placeholder="file name or full path"
            value={ioName}
            onChange={(e) => setIoName(e.target.value)}
            data-testid="palette-io-name"
          />
        </div>
        <div className="row-buttons">
          <button
            disabled={!ioName.trim()}
            onClick={() =>
              void (async () => {
                try {
                  const path = await resolveExportPath(ioName.trim())
                  doImport(await readFile(path), path)
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e))
                }
              })()
            }
          >
            Import
          </button>
          <select value={format} onChange={(e) => setFormat(e.target.value as PaletteFormat)}>
            {PALETTE_FORMATS.map((f) => (
              <option key={f} value={f}>
                .{f}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              void (async () => {
                try {
                  const name = ioName.trim() || safeName(pal.name)
                  const file = /\.[a-z]{3}$/i.test(name) ? name : `${name}.${format}`
                  const path = await resolveExportPath(file)
                  await writeFile(path, exportPalette(pal, format, format === 'png' ? 8 : 1))
                  setStatus(`Exported palette to ${path}`)
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : String(e))
                }
              })()
            }
            data-testid="palette-export"
          >
            Export
          </button>
        </div>
      </details>
    </section>
  )
}
