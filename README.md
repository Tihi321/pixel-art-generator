# pixel-art-generator (Pixel Studio)

A pixel-art editor (layers, frames, palettes, asset library) with a built-in LLM agent and an MCP server. Electron + React + TypeScript.

```
yarn            # install
yarn dev        # the editor with hot reload
yarn build      # build the app and the stdio MCP shim
yarn test       # unit tests (vitest)
yarn typecheck && yarn lint
yarn gen:guide  # regenerate src/tools/guideText.ts after editing docs/llm-guide.md
```

## Building the .exe (Windows)

```
yarn dist            # both: installer + portable exe, in dist/
yarn dist:installer  # only dist/Pixel-Studio-Setup-<version>.exe
yarn dist:portable   # only dist/Pixel-Studio-<version>-portable.exe
yarn dist:dir        # only dist/win-unpacked/ (no packaging, fastest, for testing)
```

- **Installer** (`Pixel-Studio-Setup-<version>.exe`): one-click, per-user install (no admin), adds Start menu and desktop shortcuts, installs to `%LOCALAPPDATA%\Programs\Pixel Studio`. The best choice for MCP clients, since the stdio shim then has a stable path (`resources\app\out\mcp-stdio\index.js` next to the exe).
- **Portable** (`Pixel-Studio-<version>-portable.exe`): a single exe, nothing installed. It unpacks to a temp folder on every launch (a few seconds), so the stdio shim path changes between runs; use the HTTP MCP endpoint with it.
- `dist/win-unpacked/Pixel Studio.exe` runs as-is too.

The version comes from `package.json`. The icon is `build/icon.png` (`yarn gen:icon` redraws it from the sprite in `scripts/gen-icon.mjs`). Builds are not code-signed, so Windows SmartScreen shows "Windows protected your PC" on first run: click **More info > Run anyway**.

## MCP server

The app serves MCP (Streamable HTTP) at `http://127.0.0.1:7457/mcp` while its window is open (port and optional bearer token in Settings > MCP). A stdio shim for clients that only speak stdio is built to `out/mcp-stdio/index.js`. The tools are described in [docs/llm-guide.md](docs/llm-guide.md).

### Headless mode (no window)

```
yarn build
yarn mcp                          # = electron . --mcp-only            (port 7457)
yarn mcp --port 7500              # another port
<Pixel Studio.exe> --mcp-only     # packaged app
```

It prints `MCP listening on http://127.0.0.1:<port>/mcp` and serves every tool without a window. The tools run in the Electron main process against an in-memory set of documents (each `new_document`, `open_project`, `import_image`, `open_document` or `draw_sprite_from_reference` adds one and never replaces another; the newest is the current one; every tool that works on a document takes an optional `document` id, so several clients can draw at once; `select_document` and `close_document` switch and close). Nothing is saved until `save_document` / `export_png` is called. Headless mode does not take the single-instance lock, so it can run next to the window app.

Whichever engine serves MCP writes `engine.lock` (JSON: pid, mode, port, url, startedAt, version) in the data folder (`~/PixelStudio`, or `PIXEL_STUDIO_HOME`) and removes it on exit; a lock whose pid is gone is ignored. A headless start while another engine holds it exits with `Pixel Studio is already running (window, pid 1234) and serves MCP on http://127.0.0.1:7457/mcp. Use that one, or close it first.` Starting the window while the headless engine runs shows a dialog: **Take over** (the engine writes its documents to `handover/` in the data folder and exits; the window opens them as tabs with their project paths and export targets, unsaved ones stay unsaved, and serves MCP on the engine's port for this run, even if Settings says another port or MCP is off (mcp.json is not changed); clients see tab ids as document ids), **Open without MCP** (the window runs, Settings > MCP and the status bar say who serves MCP) or **Quit**. `PIXEL_STUDIO_ENGINE_CHOICE=takeover|without-mcp|quit` answers the dialog for scripted launches. If the window's own MCP port is taken it says so in the status bar as well as in Settings > MCP.

Set `PIXEL_STUDIO_MCP_PORT` for the port and `PIXEL_STUDIO_MCP_TOKEN` for a bearer token. Files go where the call says (absolute paths, parent folders are created); relative file names go to `~/PixelStudio/exports` (or `projects` for `.pxs`).

### Tools added for VN Studio

| Tool | What it does |
| --- | --- |
| `import_image` | PNG, JPEG, WebP (and GIF/BMP/AVIF in the app and headless mode) to clean pixel art in a new document: alpha-aware area downscale, alpha threshold, palette remap (`none`/`ordered`/`floyd` dithering, never on transparent pixels), orphan cleanup, optional outline, auto palette (median cut) when none is given. Max 2048x2048. |
| `export_png` | Now also `width`/`height` (exact nearest-neighbour size, any ratio: 320x180 to 1920x1080) and `document`. |
| `export_many` | Several PNGs in one call. |
| `draw_sprite_from_reference` | A new document with a hidden reference layer and drawing guidance, for an agent to draw a small sprite with `draw_grid`. |
| `make_expression_set` | Turns a drawn sprite document into an expression set: one frame per expression (a copy of the base pose), each tagged with the expression name, so `{"frame":"happy"}` works in every drawing tool. Returns what to change on the face per expression. One undo step. |
| `export_expression_set` | One transparent PNG per expression, `<dir>/<prefix>_<expression>.png`, all at the same (optionally exact) size. |
| `draw_ui_element` | Pixel UI for a visual novel: textbox, name box, button, choice, panel or frame, in the document palette by default (corners round/cut/square, bevel, shadow, dither, inner line). Buttons have idle/hover/pressed/disabled states and a label in the built-in fonts. Reports the 9-slice borders and a Ren'Py `Frame(...)` line. |
| `draw_nine_slice` | Resizes a hand-drawn frame or panel to any size: corners copied 1:1, edges and middle tiled (or stretched). |
| `list_documents`, `open_document`, `save_document`, `select_document`, `close_document` | Document handling and the round trip below. |

The new and changed tools end their result with one JSON text item (see `.claude/tickets/PAR-05-vn-studio-art/plan.md` and the VNO-02 contract). Image decoding: PNG always; JPEG, WebP, GIF (first frame), BMP and AVIF only through Electron (nativeImage, then a hidden Chromium decoder window; the app and headless mode), not in plain Node.

### Round trip from another app (window mode)

```
electron . --open C:\art\bg.png --export-to C:\art\bg-edited.png --export-width 1920 --export-height 1080
```

Opens the PNG (or a `.pxs` project) in a new tab of the running Pixel Studio window (a second launch forwards the path to the first one), and every Save (Ctrl+S) also exports the PNG to `--export-to`. The same is available as the `open_document` tool with `exportTo`.
