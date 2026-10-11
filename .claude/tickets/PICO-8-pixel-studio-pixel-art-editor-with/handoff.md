# Handoff: Pixel Studio (pixel-art editor + LLM agent + MCP)

_Written 2026-10-11, end of session 1. Work was paused partway through Phase 3A at the user's request._

## Where things are
- **Repo:** `C:\projects\Personal\pixel-art-generator`
- **Branch:** `pixel-studio-editor-llm-mcp`, created from `origin/master` (a9b3a79). **Nothing is committed yet.** Every new file is untracked.
- **Plan:** `.claude/tickets/PICO-8-pixel-studio-pixel-art-editor-with/plan.md`. It is the authoritative plan; see its "Implementation tracking" and "### Verification log" sections.
  - The ticket folder's `PICO-8` prefix came from the plan-to-ticket hook. It is not a real ticket id.
- **Changelog:** `changelog.md` in the same folder.
- **How to resume:** run the `implement` skill with the plan path above. It orchestrates on Opus and delegates to Sonnet `implementer` agents.

## Status by phase
| Phase | Scope | State |
|---|---|---|
| 1 | M1 scaffold: Electron 44 + electron-vite 5 + React 19 + zustand + Vitest + Playwright, Yarn 4 | Done. typecheck, lint, test, build and test:electron all pass |
| 2A | M2 core `src/core/**`: model, History/commands, raster, codecs (gridText, png, gif, spritesheet, palette, project), built-in palettes | Done, with tests |
| 2B | M7a `src/llm/**`: scriptorium model layer copied, tool calling added for OpenAI-compat/Anthropic/Gemini/mock, `runAgent` with a JSON-action fallback, `createLlm`, seed config | Done, 48 tests |
| 3A | M6 ToolRegistry + tool bridge | **Partial**, details below |
| 3B | M3/M4/M5 editor UI (React) on top of `EditorSession` | Not started |
| 4 | M7b agent runner in main + chat/settings UI; M8 MCP server (Streamable HTTP 127.0.0.1:7457) + stdio shim + guide resources/prompts | Not started |
| 5 | M9 asset library + style references (`list_assets`, `get_asset`, `save_as_asset`, `place_asset`, `set_style_reference`, `get_style_context`) | Not started |

Last checks, run at the end of the session:
- `yarn typecheck`: pass
- `yarn lint`: pass
- `yarn test`: 12 files, 120 tests, all pass
- `yarn build`: last run in Phase 1, not re-run since Phase 3A started

## Phase 3A: what exists
- **Shared types:**
  - `src/shared/tools.ts` holds `ToolDef`, `ToolResult`, `ToolHost` and `TurnToolHost`. These are structurally the same as the `src/llm` types; they are duplicated because the web tsconfig can't import `src/llm`.
  - `src/shared/ipc.ts` holds the `IPC` channel constants (`tools:execute|turn|cancel|result|ready`, `fs:*`, `palettes:*`) and their payload types.
- **Editor state:** `src/tools/session.ts` defines `EditorSession`.
  - It holds the doc and its history, the active layer/frame, selection, colours and onion skin.
  - It supports `transaction`/`transactionAsync`, plus `beginTurn` and `endTurn`, which squash a whole agent turn into one undo step.
  - `subscribe` and `getVersion` are ready for `useSyncExternalStore`.
- **Registry:** `src/tools/registry.ts` provides `defineTool`, `ToolRegistry` (zod validation and `defs()` via `z.toJSONSchema`; it never throws) and `createToolHost(...)`, which returns a `TurnToolHost`.
- **Services:** `src/tools/services.ts` defines the `ToolServices` and `AssetService` interfaces. `src/tools/memoryServices.ts` is the in-memory implementation for tests.
- **Helpers:** `src/tools/render.ts` (`renderPreview`) and `src/tools/util.ts`.
- **Tool definitions:** `src/tools/defs/{document,layers,frames,drawing,reading,palette}.ts` hold 43 tools. The full list is in the plan's Verification log, under "Phase 3A (partial)".

## Phase 3A: still to do (in this order)
1. `src/tools/defs/export.ts`: `export_png`, `export_spritesheet` (writes .png + .json, using `buildSpriteSheet` + `sheetMetadata`) and `export_gif`.
2. `src/tools/defs/history.ts`: `undo` and `redo`, with `noTransaction: true`.
3. `src/tools/defs/index.ts` + `createDefaultRegistry()` + re-exports from `src/tools/index.ts`. **None of the defs are registered anywhere yet.**
4. The guide. Write `docs/llm-guide.md` by hand. `scripts/gen-guide.mjs` turns it into `src/tools/guideText.ts`, which exports `GUIDE` and `GUIDE_SHORT` (≤1500 chars). Add a test that the two stay in sync. Content follows the plan's "LLM guide" section.
5. `src/main/toolBridge.ts`: `ToolBridge implements ToolHost`.
   - It sends `tools:execute` and correlates results by requestId, with a 60 s timeout and abort support.
   - It also provides `beginTurn`/`endTurn` via `tools:turn`.
   - The renderer replies with `invoke('tools:result')`, so register that channel with `ipcMain.handle`.
6. `src/main/services.ts`: `ipcMain.handle` handlers for fs read/write, export/project path resolution (`~/PixelStudio/{exports,projects,palettes}`) and user palettes. Wire them into `src/main/index.ts`. The preload has no allowlist, so it needs no change.
7. `src/renderer/toolBridgeClient.ts`: `startToolBridge(registry, session, services)` and an IPC-backed `ToolServices`.
8. `tests/tools/**`, as listed in the plan:
   - draw_grid ↔ read_grid round trip
   - frames and tags
   - palette remap
   - render_preview PNG validity
   - export_spritesheet output
   - one undo step per call
   - zod error messages
   - def schema validity
   - ToolBridge correlation
9. Re-run `yarn typecheck`, `yarn lint`, `yarn test` and `yarn build`.

Known nits in the existing Phase 3A code:
- `reading.ts`: `render_preview` has a redundant `|| hexToRgba(...)` in its background parsing.
- `palette.ts`: `remap_to_palette` resolves the layer/frame ad hoc instead of using `resolveLayer`/`resolveFrame`.

## Decisions made (do not revisit)
- **App and reuse:** an Electron desktop app; the LLM layer is copied from scriptorium and extended there, not shared as a package.
- **MCP:** Streamable HTTP on localhost, served by the running app, plus a stdio shim.
- **Ownership:** the renderer owns the live document. Main runs the agent (keys, no CORS) and the MCP server, and executes tools through the IPC tool bridge, so edits appear live and share one undo history.
- **Undo granularity:** each tool call is one undo step, and a whole agent turn is squashed to one step via `beginTurn`/`endTurn`.
- **Requirements the user added mid-planning:** colour schemes/palettes, and references (reuse finished characters and backgrounds directly, or as style references). Both are covered in the plan.

## Key APIs to build on
These are summarised from the agent reports in the plan's Verification log. Check the source before relying on them.
- **`src/core`:**
  - `createDocument`
  - the `History` class
  - the `create*Command` factories
  - `createPaintCommand(doc, {layer, frame, mutate})`
  - raster ops returning dirty rects
  - `flattenFrame`
  - `applyGrid` / `readGrid`
  - `encodePng` / `decodePng`
  - `encodeGif`
  - `buildSpriteSheet` + `sheetMetadata`
  - `parsePalette` / `exportPalette`
  - `getBuiltinPalette`
  - `serializeProject` / `deserializeProject`
- **`src/llm`:**
  - `createLlm({configDir?, seedDir})` returns `{registry, router}`
  - `runAgent({router, role:'artist' | chat+capabilities, system, history, userMessage, host, maxSteps, signal, onEvent})`
    - It never throws; the last event is always `done`.
  - `chatJson(chatFn, messages, zodSchema)`
  - Config lives in `~/PixelStudio/config/{providers,roles}.md` and is seeded from `seed/config`.

## Open items / risks
- Several built-in palettes were typed from memory: NES (approximate), DB16/DB32, Endesga-64, Resurrect-64, CGA and GameBoy. PICO-8, Sweetie-16 and Endesga-32 were spot-checked and are correct. Check the others against Lospec.
- Nothing has been tested against real LM Studio, Strata or cloud endpoints, only fake SSE servers and the mock provider.
- `yarn dist` (packaging) has never been run.
