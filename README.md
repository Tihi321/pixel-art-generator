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

It prints `MCP listening on http://127.0.0.1:<port>/mcp` and serves every tool without a window. The tools run in the Electron main process against an in-memory set of documents (each `new_document`, `open_project`, `import_image`, `open_document` or `draw_sprite_from_reference` adds one and never replaces another; the newest is the current one; every tool that works on a document takes an optional `document` id, so several clients can draw at once; `select_document` and `close_document` switch and close). Nothing is saved until `save_document` / `export_png` is called. Headless mode does not take the single-instance lock, so it can run next to the window app. If the port is taken it exits with an error; the window app instead opens and shows the bind error in Settings > MCP.

Set `PIXEL_STUDIO_MCP_PORT` for the port and `PIXEL_STUDIO_MCP_TOKEN` for a bearer token. Files go where the call says (absolute paths, parent folders are created); relative file names go to `~/PixelStudio/exports` (or `projects` for `.pxs`).

### Tools added for VN Studio

| Tool | What it does |
| --- | --- |
| `import_image` | PNG (JPEG too in the app) to clean pixel art in a new document: alpha-aware area downscale, alpha threshold, palette remap (`none`/`ordered`/`floyd` dithering, never on transparent pixels), orphan cleanup, optional outline, auto palette (median cut) when none is given. Max 512x512. |
| `export_png` | Now also `width`/`height` (exact nearest-neighbour size, any ratio: 320x180 to 1920x1080) and `document`. |
| `export_many` | Several PNGs in one call. |
| `draw_sprite_from_reference` | A new document with a hidden reference layer and drawing guidance, for an agent to draw a small sprite with `draw_grid`. |
| `list_documents`, `open_document`, `save_document`, `select_document`, `close_document` | Document handling and the round trip below. |

The new and changed tools end their result with one JSON text item (see `.claude/tickets/PAR-05-vn-studio-art/plan.md` and the VNO-02 contract). Image decoding: PNG always; JPEG/WebP only through Electron's decoder (the app and headless mode), not in plain Node.

### Round trip from another app (window mode)

```
electron . --open C:\art\bg.png --export-to C:\art\bg-edited.png --export-width 1920 --export-height 1080
```

Opens the PNG (or a `.pxs` project) in a new tab of the running Pixel Studio window (a second launch forwards the path to the first one), and every Save (Ctrl+S) also exports the PNG to `--export-to`. The same is available as the `open_document` tool with `exportTo`.
