# Changelog

## 2026-10-12: session 2 (Phases 3A rest, 3B, 4, 5 and final verification)
**Summary:** Pixel Studio is feature-complete per the plan:
- an editor UI with layers, timeline, palettes and export;
- 54 LLM tools, served over an IPC tool bridge to the live document;
- a built-in chat agent with a Settings dialog;
- an MCP server on 127.0.0.1:7457 plus a stdio shim;
- an asset library with style references.

All automated checks pass. **Status: uncommitted**, on branch `pixel-studio-tools-ui-mcp`, cut from `origin/master` 3fa11b0, which already contains session 1 via PR #1.

### Changes (repo `pixel-art-generator`)

**Tools and bridge (finishing Phase 3A)**
- `src/tools/defs/export.ts`:
  - `export_png` exports the current frame, a given frame, or all frames.
  - `export_spritesheet` writes a `.png` and a `.json` in all four layouts, in Aseprite array/hash or TexturePacker format.
  - `export_gif` exports a tag or a frame range, honouring reverse and pingpong.
- `src/tools/defs/history.ts`: `undo` and `redo`.
- `src/tools/defs/index.ts`: `createDefaultRegistry()`, re-exported from `src/tools/index.ts` along with the session, registry, host, services and guide.
- Nits fixed:
  - `src/tools/defs/reading.ts`: the redundant background fallback is gone.
  - `src/tools/defs/palette.ts`: `remap_to_palette` now resolves the layer and frame through the shared helpers.
- Guide:
  - `docs/llm-guide.md` is the hand-written guide. Its short section sits between `<!-- short:start/end -->` markers and must be 1500 chars or fewer.
  - `scripts/gen-guide.mjs` (`yarn gen:guide`) generates `src/tools/guideText.ts`, which exports `GUIDE` and `GUIDE_SHORT`.
- `src/main/toolBridge.ts`: `ToolBridge` is a `TurnToolHost` that forwards tool calls to the renderer.
  - Replies are matched by requestId.
  - A call times out after 60 s and can be aborted (which sends `tools:cancel`).
  - Calls wait until the renderer reports ready.
  - `beginTurn`/`endTurn` go over `tools:turn`.
- `src/main/services.ts`: IPC handlers for files, path resolution and user palettes.
  - Paths resolve under `~/PixelStudio/{exports,projects,palettes}`, and path traversal outside them is rejected.
  - User palettes are stored as `.hex` files.
- `src/renderer/toolBridgeClient.ts`: `startToolBridge(registry, session, services)` and `createIpcServices()`. The orchestrator wired them in `src/renderer/main.tsx`, so LLM, MCP and manual edits share one undo history.

**Editor UI (Phase 3B)**
- Shell: `src/renderer/App.tsx`, `styles.css` (dark, Aseprite-like) and `components/*`:
  - `CanvasView` with zoom and pan, grid, checkerboard, onion skin, mirror drawing and the selection marquee.
  - Pencil, eraser, fill, line, rect, ellipse, picker and select/move tools, each with a shortcut.
  - Layers panel, Timeline (cel grid, tags, playback) and Palette panel (presets, import/export, remap).
  - Export dialog, plus New, Open, Save and Resize dialogs.
- State:
  - `state/session.ts` holds the single `EditorSession`.
  - `state/ui.ts` is the zustand store for UI-only state.
  - `state/actions.ts` holds the command wrappers.
- `hooks/*`: session subscription, shortcuts and playback.
- Pure, unit-tested logic in `lib/*`: viewport, keys, playback, tool controller, composition, export plan and file helpers.
- Each brush stroke is executed as one undo step on pointer-up.

**MCP (Phase 4, M8)**
- Shared contract: `src/shared/mcp.ts`.
- Server (`src/main/mcp.ts`, `mcpContent.ts`, `mcpSettings.ts`, `mcpApp.ts`):
  - It uses the low-level SDK `Server` over Streamable HTTP, binds to 127.0.0.1 only and serves `/mcp`.
  - An optional bearer token is checked in constant time, and DNS-rebinding protection is on.
  - `instructions` is set to `GUIDE_SHORT`.
  - Resources: `pixel-studio://{guide,document,palettes,assets}`. Prompts: `create_sprite`, `animate_sprite`, `match_style`.
  - Settings are kept in `~/PixelStudio/config/mcp.json`. The `mcp:*` IPC channels handle them, and the module builds the connect snippets.
- `src/mcp-stdio/{index,relay}.ts`: the stdio-to-HTTP relay.
  - It reads `PIXEL_STUDIO_MCP_URL` and `PIXEL_STUDIO_MCP_TOKEN`.
  - It returns a clear JSON-RPC error when the app is not running.
  - `package.json` gains `bin: pixel-studio-mcp`.

**Agent, chat and settings (Phase 4, M7b)**
- `src/shared/agent.ts` defines the `agent:*` and `llm:*` channels.
- Main process:
  - `src/main/agent.ts` (`AgentRunner`, `withAutoPreview`):
    - The system prompt is built from GUIDE, the document summary and the style context.
    - Each run is one undo step via `beginTurn('Agent: …')`, and a run that ends in an error is rolled back.
    - One run at a time; stop aborts the run.
    - Vision models get auto-previews after drawing tools, and reference images.
  - `src/main/llm.ts`: providers and models overview, keyring keys (key values never reach the renderer), reload and discover.
  - `src/main/appSettings.ts`: remembers the selected model.
  - `src/main/agentIpc.ts`: registers the IPC handlers.
- Renderer:
  - `components/ChatPanel.tsx` with `state/chat.ts` and `chatReducer.ts`: model picker, streamed text, tool cards with previews, stop, cost, new chat, and "Undo agent turn".
  - `components/SettingsDialog.tsx`: a Providers tab and an MCP tab with live status, token controls and copy snippets.
- `seed/config/{providers,roles}.md`: Anthropic models are now `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`, and the `claude` alias points to Sonnet 5.5. No prices are set for them.

**Assets and style references (Phase 5, M9)**
- Store:
  - `src/main/assets.ts` (`AssetStore`) keeps each asset in `~/PixelStudio/assets/<slug>/{asset.pxs,thumb.png,meta.md}`.
  - `src/main/assetsApp.ts` watches the folder with chokidar and pushes `assets:changed`.
  - `src/shared/assets.ts` defines the channels.
- Tools (`src/tools/defs/assets.ts`, `src/tools/assetOps.ts`): `list_assets`, `get_asset`, `save_as_asset`, `place_asset`, `set_style_reference`, `get_style_context`. That brings the total to **54 tools**.
- `AssetService.thumbnail` is added, and both the memory and the IPC services implement it.
- Renderer:
  - `components/AssetsPanel.tsx`: grid, filter and search, drag onto the canvas to place, "Place at 0,0", style-ref toggle, and delete with an inline confirm.
  - `components/SaveAssetDialog.tsx`, `hooks/useAssets.ts` and `state/assetActions.ts`.
  - `lib/tools.ts` (`runUiTool`) makes the UI use the same tool handlers as the LLM.
- Env overrides:
  - `PIXEL_STUDIO_HOME` replaces `~/PixelStudio`. It is honoured in `src/main/services.ts`, `src/main/llm.ts` and `src/llm/registry.ts`.
  - `PIXEL_STUDIO_MCP_PORT` is applied in memory and never written to `mcp.json`.

**Tests added**
- `tests/tools/**`: tools, registry, guide sync, bridge client and assets.
- `tests/main/**`: toolBridge, services, agent, agentLlm and assets.
- `tests/mcp/**`: server integration, settings, stdio relay and the assets resource.
- `tests/renderer/**`: viewport, keys, playback, toolController, compose, exporter and chatReducer.
- `tests/e2e/{launch.ts,integration.spec.ts}`, with `smoke.spec.ts` extended. The e2e runs are isolated through the env overrides.

### Deviations from the plan
- **Dialogs:** there are no native open/save dialogs. Filename/path inputs resolve through `fs:resolve*Path`, and Open and palette import also offer a browser file picker.
- **Settings:** the data folder is shown read-only in Settings.
- **Chat transcript:** it lives only in the renderer, so a reload loses it. The conversation history stays in main.
- **MCP undo:** an MCP call is not wrapped in `beginTurn`, because the registry already makes each call one undo step. Agent runs do use turns.
- **Agent rollback:** a run that ends in an error is rolled back. Aborted, max-steps and completed runs keep their work as one undo step.
- **Assets:**
  - `save_as_asset` writes to the library, not the document, so it is marked read-only and creates no undo step.
  - Asset tools accept an asset's exact name as well as its id.
  - There is no `delete_asset` tool; deleting is a UI-only action.
- **Additions beyond the plan:**
  - Shift constrains shapes, brush size, painting with the secondary colour, painting clipped to the selection, and a 9-point anchor for resize.
  - The `PIXEL_STUDIO_HOME` and `PIXEL_STUDIO_MCP_PORT` overrides.
- **Not built:** copy and paste, drag to reorder frames (there are move buttons instead), and a native menu bar.

### Verification
**Passing:**
- `yarn gen:guide`: pass
- `yarn typecheck`: pass
- `yarn lint`: pass
- `yarn build`: pass
- `yarn test`: 33 files, 310 tests, all pass
- `yarn test:electron`: 6 passed, 0 skipped, covering:
  - shell layout
  - a pencil stroke as one undo step, plus frames and a sprite-sheet export from the UI
  - the Chat tab without shortcut leakage
  - the Settings tabs
  - MCP edits showing live in the renderer, with one undo reverting one call
  - assets round-tripping through MCP, disk and the Assets panel
- Built stdio shim: returns the "not running" error with no app running.

**Not run:**
- manual end-to-end with a real LM Studio, Strata or cloud model
- `claude mcp add` against the running app
- `yarn dist` packaging

### Follow-ups / known limitations
- Check the built-in palettes that were typed from memory against Lospec: NES, DB16/DB32, Endesga-64, Resurrect-64, CGA and GameBoy.
- Prices for the Claude 5.5 models are not set in `seed/config/providers.md`, so their cost shows as $0. One entry there, `anthropic/claude-sonnet-4.5` under another provider, still uses an old id.
- The renderer bundle is about 500 kB. Vite warns about the chunk size; it does no harm.
- Early e2e runs, before isolation was added, left `~/PixelStudio/projects/e2e-chk-*.pxs` and seeded `~/PixelStudio/config`. The seeded config matches the current seed.

## 2026-10-11: session 1 (partial; paused during Phase 3A)
**Summary:** scaffolded the Electron app, built the pure-TS pixel-art core and the LLM layer with tool calling, and partly built the ToolRegistry. **Status: uncommitted**, on branch `pixel-studio-editor-llm-mcp` (from `origin/master` a9b3a79).

### Changes (repo `pixel-art-generator`)
- **Scaffold.** The app is an Electron 44 / electron-vite 5 / React 19 desktop app named "Pixel Studio", with a dark layout shell. Files:
  - `package.json`, `.yarnrc.yml`, `.gitignore`, `.gitattributes`, `eslint.config.mjs`
  - `tsconfig*.json`: node and web configs. The node config covers core/tools/shared/main/llm; the web config covers renderer/core/tools/shared.
  - `electron.vite.config.ts`, `vite.mcp.config.ts` (builds the stdio shim to `out/mcp-stdio`), `vitest.config.ts`, `playwright.electron.config.ts`, `electron-builder.yml`
  - `src/main/index.ts`, `src/preload/index.ts` (`window.pixelStudio.invoke/on`), `src/renderer/*`, `src/mcp-stdio/index.ts` (placeholder)
  - `tests/sanity.test.ts`, `tests/e2e/smoke.spec.ts`
- **Core (`src/core/**`).** Pure TS: no DOM, Electron or Node.
  - Document model: layers, frames, sparse RGBA cels, tags, palette, references.
  - Command/History system with transactions and diff-based pixel commands.
  - Raster ops: line, rect, ellipse, fill, replace, flip, rotate, shift, outline, stamp, flatten with blend modes.
  - Codecs:
    - LLM grid-text format (legend + rows)
    - PNG encode and decode, using `fflate`
    - GIF, using `gifenc`
    - sprite sheets: horizontal/vertical/grid/packed layouts, with Aseprite array/hash and TexturePacker JSON metadata
    - palette files: .hex, .gpl, .pal, PNG
    - `.pxs` project files
  - Ten built-in palettes, plus `seed/palettes/*.hex`.
- **LLM (`src/llm/**`).** Copied from scriptorium `src/engine/models`, without budget, RAG or the scheduler.
  - **Tool calling added.** `ChatMessage` gains tool/image parts, `ChatRequest` gains `tools`/`toolChoice`, and `ChatEvent` gains `tool_call` and `finish`. It is implemented in the OpenAI-compatible (LM Studio/Strata/DeepSeek/…), Anthropic, Gemini and mock clients.
  - **Model flags.** Each model has `tools` and `vision` flags.
  - **Agent loop.** `agent.ts` provides `runAgent`, a native tool loop with a JSON-action fallback for models without tool support. It handles abort and max steps, and strips images for models without vision.
  - **Setup.** `setup.ts` provides `createLlm`; `seed/config/providers.md` and `seed/config/roles.md` (role `artist`, role `palette`) hold the defaults.
- **Tools (`src/tools/**`, `src/shared/{tools,ipc}.ts`).** Partial:
  - `EditorSession`, `ToolRegistry`/`defineTool`/`createToolHost`, the `ToolServices` interface plus an in-memory implementation, and `renderPreview`.
  - 43 tool definitions (document, layers, frames/tags, drawing, reading, palette). They are **not registered or tested yet**.
- New dependency: `fflate` ^0.8.3.

### Deviations from the plan
- `runAgent` takes an `onEvent` callback and returns a promise, rather than being an async generator (the plan allowed either).
- Scriptorium's `settings.md` aliases moved to `roles.md`, and its LM Studio load settings moved into the `providers.md` frontmatter.
- The tool types are duplicated in `src/shared/tools.ts`, because the web tsconfig can't import `src/llm`.
- Tools added beyond the plan: `set_active`, plus a `resolveProjectPath` service.
- The guide will be authored in `docs/llm-guide.md`, and a TS constant will be generated from it.

### Verification
**Passing:**
- `yarn typecheck`: pass
- `yarn lint`: pass
- `yarn test`: 12 files, 120 tests, all pass
  - core: 8 files
  - llm: 3 files, 48 tests, run against fake SSE servers and the mock provider
- `yarn build` and `yarn test:electron`: pass, as of Phase 1

**Not run:**
- `yarn build` since Phase 3A started
- tool tests (none written yet)
- tests against real LM Studio, Strata or cloud endpoints
- `yarn dist`
- manual QA

### Follow-ups
- Finish Phase 3A (see `handoff.md`), then Phases 3B, 4 and 5.
- Check the built-in palettes that were typed from memory against Lospec.
