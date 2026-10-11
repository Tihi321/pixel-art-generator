# Pixel Studio — pixel-art editor with LLM agent + MCP

## Context
`pixel-art-generator` is empty (README only; remote github.com/Tihi321/pixel-art-generator). The goal is a desktop pixel-art studio, similar to Pixel Art Studio or Aseprite, with:
- layers, animation frames, color schemes (palettes) and sprite sheet export;
- a reference / asset library: finished characters and backgrounds can be reused directly or used as a style reference;
- a built-in LLM chat that edits the artwork through tools, using local and remote models (LM Studio, Strata, DeepSeek, any OpenAI-compatible endpoint, Anthropic, Gemini);
- the same tools exposed over **MCP**, so outside agents (Claude Code, Claude Desktop, etc.) can create and update art programmatically;
- a built-in guide, so any LLM knows how to drive the editor.

The LLM layer is **copied and extended** from `C:\projects\Personal\scriptorium`.

Scriptorium has streaming provider clients, a registry, a router with fallback, keyring keys and the `providers.md` config. It has **no tool calling and no MCP**, so both are new work here.

Decisions already made:
- **App type:** Electron desktop app, on the same stack as scriptorium.
- **LLM layer:** copy and extend it, rather than make a shared package.
- **MCP:** Streamable HTTP on localhost, served by the running app, plus a stdio shim.

Per the user's global CLAUDE.md:
- On implementation, copy this plan to `.claude/tickets/pixel-studio-llm-mcp/plan.md`.
- Run it through the `implement` skill.
- Put scratch files in `.claude/temp/`.

## Stack (mirrors scriptorium `package.json`)
- **Runtime and build:** Electron ^44 + electron-vite ^5 + electron-builder (NSIS x64).
- **Code:** TypeScript ~5.9, React 19, zustand 5, zod 4, yaml.
- **Packages and tests:** Yarn Berry (`nodeLinker: node-modules`), Vitest and Playwright.
- **New dependencies:**
  - `@modelcontextprotocol/sdk` (MCP server and test client)
  - `gifenc` (GIF export)
  - `@napi-rs/keyring` (already used by scriptorium)
- **Rendering:** plain Canvas2D. Phaser is not needed.

## Architecture
```
src/core/      pure TS, no DOM/Electron — document model, commands+undo, raster ops, palette ops, codecs (grid-text, png, gif, spritesheet)
src/tools/     ToolRegistry: zod-schema'd tool defs → handlers over core (single source for chat agent AND MCP)
src/llm/       copied scriptorium models layer + tool calling + agent loop + guide prompt
src/main/      Electron main: window, file IO, keyring, LLM agent runner, MCP HTTP server, tool bridge
src/preload/   contextBridge window.pixelStudio
src/renderer/  React UI: canvas, tool palette, layers, timeline, palette, assets, chat, settings
src/mcp-stdio/ tiny stdio→HTTP shim (separate vite build like scriptorium's vite.engine.config.ts)
seed/          providers.md, roles.md, built-in palettes (.hex), guide.md
docs/llm-guide.md  the "how to use Pixel Studio" guide (system prompt + MCP instructions + resource)
```

**Ownership of the document.**
- The renderer holds the live `Document` in a zustand store, which keeps drawing fast.
- Main never edits pixels itself. Tool calls from the chat agent (which runs in main, where keys live and there is no CORS) and from MCP clients go over an IPC **tool bridge**: `ipcMain` → `webContents` `executeTool(name, args)` → renderer runs the `ToolRegistry` handler on the store → returns a result.
- So the user sees every LLM edit happen live, and LLM edits and manual edits share one undo history.

## Core document model (`src/core/model.ts`)
- `Document { id, name, width, height, palette: Palette, layers: Layer[], frames: Frame[], cels: Map<"layerId:frameId", Cel>, tags: AnimTag[], references: RefLink[] }`
- `Layer { id, name, visible, locked, opacity, blend: 'normal'|'multiply'|'add'|..., kind: 'pixel'|'reference' }`
- `Frame { id, durationMs }`, `AnimTag { name, from, to, direction: 'forward'|'reverse'|'pingpong', loop }` (named animations: idle, walk, …)
- `Cel { w, h, x, y, data: Uint32Array /* RGBA */ }` — empty cels are absent (sparse).
- `Palette { id, name, colors: { hex, name? }[] }`. Art is RGBA, and the palette drives the UI swatches. `remapToPalette` quantizes art onto a palette, which turns colour schemes into a real operation.

**Commands and undo** (`src/core/commands.ts`):
- Every mutation is a `Command { type, apply(doc), invert(doc) }`. Pixel commands store diffs as a dirty rect plus before and after buffers.
- `History` supports `begin/commitTransaction` so that a whole LLM agent turn, or one MCP call, is a single undo step.

**Raster ops** (`src/core/raster.ts`): setPixels, line (Bresenham), rect, ellipse, flood fill, replace color, flip, rotate 90, shift/wrap, outline, copy and paste region, stamp (blit with alpha).

**Codecs** (`src/core/codecs/`):
- `gridText.ts`: the LLM-friendly ASCII grid. A legend maps characters to colours, for example `{".": null, "k": "#1a1c2c", "s": "#f4b41b"}`, and `rows: string[]` gives the pixels. It works both ways: you can draw from a grid, or read a region back as a grid.
- `png.ts` (canvas or `UPNG` in main as needed), `gif.ts` (gifenc), `spritesheet.ts`:
  - layouts: horizontal, vertical, grid with N columns, packed
  - options: scale, padding, which tags or layers to include
  - JSON metadata: Aseprite array or hash format and TexturePacker format
- `palette.ts`: import and export `.hex` (Lospec), `.gpl` (GIMP), `.pal` (JASC), and PNG swatch strips.
- `project.ts`: the `.pxs` save format, a JSON manifest with base64 PNG for each cel.

## Tool registry (`src/tools/`) — one definition, three consumers
Each tool has a name, a description, a zod input schema (converted with `z.toJSONSchema` for the LLM and MCP), and a handler. The three consumers are the built-in chat, MCP, and the stdio shim through MCP. The tool groups are:

- **document**: `get_document` (summary: size, layers, frames, tags, palette), `new_document`, `resize_canvas`, `open_project`, `save_project`
- **layers**: `add_layer`, `update_layer` (name, visible, opacity, blend, lock), `delete_layer`, `move_layer`, `duplicate_layer`, `merge_down`
- **frames and animation**: `add_frame`, `duplicate_frame`, `delete_frame`, `move_frame`, `set_frame_duration`, `create_tag`, `update_tag`, `delete_tag`, `copy_cel`
- **drawing** (target: layer + frame):
  - `draw_grid`: the main LLM primitive, built on gridText
  - `set_pixels`, `draw_line`, `draw_rect`, `draw_ellipse`, `flood_fill`, `replace_color`
  - `clear_cel`, `transform_cel` (flip, rotate, shift), `outline`
- **reading**:
  - `read_grid`: returns a region as gridText
  - `render_preview`: returns PNG image content (MCP `image` content; for vision models in the built-in chat), upscaled
- **palette and colour schemes**: `get_palette`, `set_palette`, `add_colors`, `remove_colors`, `list_palettes` (built-in: PICO-8, DB32, Endesga-32, Sweetie-16, GB…), `load_palette`, `import_palette`, `export_palette`, `remap_to_palette`, `save_palette`
- **references and assets**:
  - `list_assets` (filter by kind and tags)
  - `get_asset`: metadata, palette, gridText, and a preview image
  - `save_as_asset`: from the document, a layer, a frame range or a region, with kind (character, background, tile, prop), tags and style notes
  - `place_asset`: stamps it into a layer or frames at x,y, and can copy its animation frames
  - `set_style_reference`: attaches assets to the document as style references
  - `get_style_context`: returns the reference palette, the size, sample grids and notes, for matching a style
- **export**: `export_png` (current frame or all frames), `export_spritesheet`, `export_gif`
- **history**: `undo`, `redo`

## Asset library and references (`src/main/assets.ts`)
- **Storage:** a folder at `~/PixelStudio/assets/<slug>/` with `asset.pxs`, `thumb.png` and `meta.md`. `meta.md` has YAML frontmatter (kind, tags, palette id, size, frames) and a free-text style description. This matches scriptorium's markdown-plus-frontmatter convention, and the folder is watched with chokidar.
- **Direct reuse:** an asset can be dragged from the Assets panel into the canvas, or placed with the `place_asset` tool.
- **Style reference:**
  - The document's `references[]` lists linked assets, which can also show as a dimmed, non-exported `reference` layer.
  - When the agent runs, the guide plus `get_style_context` gives the model:
    - the reference palette, to use exactly;
    - the dimensions and silhouette conventions, with sample grids;
    - the user's style notes;
    - for vision-capable models (`vision: true` per model in `providers.md`), the rendered reference images.

## LLM layer (`src/llm/`) — copied from scriptorium then extended
**Copy as-is (adjusting imports):**
- from `scriptorium/src/engine/models/`: `types.ts`, `openaiCompat.ts`, `anthropic.ts`, `gemini.ts`, `mock.ts`, `sse.ts`, `keys.ts` (keyring service name `pixel-studio`), `registry.ts`, `router.ts`, `limiter.ts`
- `pipeline/llm.ts` `chatJson` / `extractJson`
- the provider and model zod schemas from `src/shared/schemas.ts:25-83`
- `seed/config/providers.md` and `roles.md`, with the LM Studio, Strata and DeepSeek entries kept

Drop budget and RAG for now; keep `computeCost` for the cost display.

**Extend the copied layer with tool calling** (scriptorium has none):
- **Types** (`types.ts`):
  - `ChatMessage` gets the `tool` role, `toolCalls`, `toolCallId`, and image parts.
  - `ChatRequest` gets `tools?: ToolDef[]` and `toolChoice`.
  - `ChatEvent` adds `{type:'tool_call', id, name, args}`.
- **Clients:**
  - `openaiCompat.ts`: send `tools` and accumulate streamed `delta.tool_calls[i].function.arguments` by index.
  - `anthropic.ts`: handle `tool_use` and `input_json_delta` blocks, and `tool_result` messages.
  - `gemini.ts`: handle `functionCall` and `functionResponse`.
- **Model capabilities:** new per-model fields `tools: true|false` and `vision: true|false` in `providers.md`.
- **Fallback for models without tool support** (common with small LM Studio models): JSON-action mode. It uses `chatJson` with the schema `{ say?: string, actions: {tool, args}[] , done: boolean }`, built from the same registry.
- **`agent.ts`** runs the loop: `system = guide + doc summary + style context` → model → tool calls → bridge → results back → repeat.
  - It stops after max 25 steps, honours abort, and wraps the turn in one undo transaction.
  - It streams text, tool-call events and previews to the chat panel.
  - It sends a `render_preview` image after drawing steps when the model has vision, so the model can check its own work.
- **Palette from a prompt:** handled by the agent ("make a moody 12-colour forest palette"). It uses `set_palette` and `save_palette`, so no special code path is needed.

## MCP (`src/main/mcp.ts`, `src/mcp-stdio/`)
- **Server:** `@modelcontextprotocol/sdk` `McpServer` over `StreamableHTTPServerTransport`.
  - It binds to `127.0.0.1:<port>` (default 7457, set in Settings), with an optional bearer token.
  - Its tools are generated from the ToolRegistry, and every call goes through the same tool bridge.
- **Guiding outside LLMs:**
  - `instructions` in `initialize`: a short version of the guide
  - a resource `pixel-studio://guide` (the full `docs/llm-guide.md`)
  - resources `pixel-studio://document`, `pixel-studio://palettes`, `pixel-studio://assets`
  - prompts `create_sprite`, `animate_sprite`, `match_style`
- **stdio shim:** the `pixel-studio-mcp` script proxies stdio to the local HTTP endpoint, for clients that only support stdio. It returns a clear error if the app is not running.
- **Connect instructions** (Settings → MCP shows ready-to-copy snippets): for Claude Code, `claude mcp add --transport http pixel-studio http://127.0.0.1:7457/mcp`, plus the stdio JSON block for Claude Desktop.

## LLM guide (`docs/llm-guide.md`, bundled into seed)
It is the single source for the built-in agent's system prompt, the MCP instructions and the guide resource. It covers:
- **Coordinates:** origin top-left, cels are sparse.
- **Workflow:** `get_document` → choose or create a palette → sketch the silhouette with `draw_grid` → shade → outline → `render_preview` to check.
- **Animation:**
  - duplicate frames, then edit the differences;
  - keep pixel counts stable;
  - typical frame counts: idle 2–4, walk 4–8, attack 3–6;
  - durations;
  - use tags to name animations.
- **Palette rules:** use only palette colours, use hue-shifted ramps.
- **References:** call `get_style_context` first and match its palette and proportions.
- **Export recipes**, and limits (keep `draw_grid` payloads at 64×64 or less per call).

## UI (`src/renderer/`)
- **Canvas view:** zoom and pan, pixel grid, checkerboard background, onion skin (previous and next frame, adjustable), mirror drawing.
- **Tools:** pencil, eraser, fill, line, rect, ellipse, picker, rectangle select and move, with shortcuts.
- **Panels:**
  - Layers: visibility, lock, opacity, blend mode, drag to reorder
  - Timeline: frames × layers cel grid, tags, playback with FPS and loop, per-frame duration
  - Palette: swatches, editor, preset dropdown, import and export, remap
  - Assets: library grid, save selection as asset, drag to place, mark as reference
  - Chat: model picker, streamed messages, tool-call cards, a stop button, "Undo agent turn"
- **Settings:** providers and keys, reusing the pattern of scriptorium's `src/renderer/ui/Settings.tsx` (keyring `setSecret`); MCP port and token; data folder.
- **Export dialog:** PNG, sprite sheet or GIF, with layout, scale, padding, tags and metadata format.

## Milestones (each independently testable)
1. **Scaffold:** electron-vite, React, zustand, Vitest and Playwright, set up like scriptorium.
2. **Core:** model, commands and undo, raster ops, gridText, unit tests.
3. **Editor UI:** canvas, tools, layers, timeline, onion skin, playback, `.pxs` save and load.
4. **Palettes:** presets, import and export, remap, palette panel.
5. **Export:** PNG, sprite sheet and JSON, GIF.
6. **ToolRegistry and the main↔renderer tool bridge.**
7. **LLM layer:** copy, add tool calling for the three client kinds, JSON-action fallback, agent loop, chat panel, settings.
8. **MCP:** HTTP server, resources and prompts, stdio shim, connect snippets.
9. **Asset library and style references:** library, tools, prompt context.

## Verification
- **Vitest:**
  - core commands: apply, invert and undo round-trips; raster ops; gridText round-trip; palette codecs; sprite sheet layout and JSON
  - tool handlers run against an in-memory store
- **LLM clients:** adapt scriptorium's fake SSE server tests (`scriptorium/tests/models.test.ts:285+`) to streamed tool calls for OpenAI, Anthropic and Gemini. Test the agent loop with the `mock` provider scripted to emit tool calls, and the JSON-action fallback.
- **MCP integration test:** start the server with the bridge pointed at an in-memory registry, connect with the SDK `Client`, list tools and resources, call `new_document`, `draw_grid` and `export_spritesheet`, and check the output PNG and JSON.
- **Playwright Electron smoke test:** launch the app, draw, add a frame, export a sprite sheet.
- **Manual end-to-end:**
  1. With LM Studio running a tool-capable model, ask in chat: *"Create a 32×32 knight, 4-frame walk cycle, using the Endesga-32 palette, export as a sprite sheet"*. Watch it draw live, play the animation, check the exported PNG and JSON, and undo the agent turn with one undo.
  2. Run `claude mcp add --transport http pixel-studio http://127.0.0.1:7457/mcp`. Ask Claude Code to make a background in the style of a saved asset, and check that it uses `get_style_context` and the reference palette.

## Implementation tracking
- Branch: `pixel-studio-editor-llm-mcp` (from `origin/master`). There is no ticket id. The `PICO-8` prefix on the folder came from the plan-to-ticket hook and is not a ticket.
- Execution phases (orchestrator):
  - [x] Phase 1: M1 scaffold, with every dependency in the plan installed
  - [x] Phase 2: M2 core (+ the core codecs for M4/M5), in parallel with M7a (LLM layer copy + tool calling in the clients, `src/llm/**` only)
  - [~] Phase 3 (3A partial; see handoff.md): M6 ToolRegistry + M3/M4/M5 editor UI + tool bridge
  - [ ] Phase 4: M7b agent loop + chat/settings UI, and M8 MCP server + stdio shim + guide
  - [ ] Phase 5: M9 asset library + style references
  - [ ] Final verification: typecheck, vitest, Electron smoke test

### Verification log

#### Phase 1 (M1 scaffold) — 2026-10-11
- `yarn install` (Yarn 4.13.0, nodeLinker node-modules; postinstall `install-electron` ran): pass
- `yarn typecheck` (tsc node + web configs): pass
- `yarn lint` (eslint): pass
- `yarn test` (vitest run, tests/sanity.test.ts): pass, 1 test
- `yarn build` (build:mcp -> out/mcp-stdio/index.js, then electron-vite build): pass
- `yarn test:electron` (build + Playwright Electron smoke tests/e2e/smoke.spec.ts, checks window title "Pixel Studio", layout regions, window.pixelStudio.invoke): pass, 1 test, not skipped
- Note: `@napi-rs/keyring` is ^2.1.0 (same as scriptorium); `@modelcontextprotocol/sdk` ^1.32.1; `gifenc` ^1.0.3. `yarn dist` not run.

#### Phase 2B (M7a LLM layer: copy + tool calling + agent loop) — 2026-10-11
- Files: `src/llm/**` (types, sse, openaiCompat, anthropic, gemini, mock, keys, config, md, pricing, registry, router, limiter, json, agent, setup, index), `tests/llm/{clients,registry,agent}.test.ts`, `seed/config/{providers,roles}.md`
- `npx vitest run tests/llm`: pass, 48 tests (fake SSE servers for OpenAI/Anthropic/Gemini streamed tool calls + request mapping, registry/seed config, router retry+fallback, limiter, keyring round-trip, agent native loop / JSON fallback / maxSteps / abort / tool errors / image stripping)
- `yarn lint`: pass. `yarn test`: pass (49 tests incl. sanity)
- `yarn typecheck`: no errors in `src/llm` or `tests/llm`; one error remains in the parallel core agent's `src/core/codecs/spritesheet.ts(93,107)` (not edited by this phase)
- Deviations: scriptorium's embeddings/RAG, search providers, budget/spend, `settings.md` dropped. LM Studio load settings moved into `providers.md` frontmatter (`lmstudio_*`), model aliases into `roles.md` (`aliases:`). `runAgent` is callback-based (`onEvent`) and resolves to an `AgentResult` rather than being an async generator. Model `tools` flag defaults to true for remote and false for local providers (LM Studio discovery reads `tool_use`/`vlm` from `/api/v0/models`).

#### Phase 2A (M2 core + core codecs) — 2026-10-11
- Files: `src/core/{color,model,palettes,raster,commands,index}.ts`, `src/core/codecs/{gridText,png,gif,spritesheet,palette,project}.ts`, `src/core/types/gifenc.d.ts`, `seed/palettes/*.hex` (10 files), `tests/core/{helpers,raster,commands,gridText,png,palette,spritesheet,gif,project}*.ts`. New dependency: `fflate` ^0.8.3 (zlib for PNG).
- `yarn typecheck` (node + web configs): pass (exit 0; the spritesheet.ts(93,107) error mentioned in 2B was fixed afterwards)
- `yarn lint`: pass (exit 0)
- `yarn test`: pass, 12 files / 120 tests (tests/core: raster 17, commands 21, gridText 8, png 5, palette 6, spritesheet 8, gif 4, project 2; plus tests/llm and sanity)
- Deviations: `Document` gets lookups/helpers beyond the plan (`findLayer/findFrame/findTag`, accept id, name or index). `AnimTag` also has `id`. Cels are NOT auto-trimmed after cropping (kept at the clipped bounds; fully empty cels are deleted). NES palette has 55 unique colors (approximation). GIF delays are clamped to >= 20 ms.

#### Phase 3A (partial) — 2026-10-11 (stopped early on coordinator instruction)
- DONE (all compile, typecheck clean; NOT yet exercised by any test):
  - `src/shared/tools.ts` (ToolDef/ToolResult/ToolHost/TurnToolHost, structurally identical to src/llm so a host is assignable to the agent), `src/shared/ipc.ts` (adds `IPC` channel names, ToolExecuteRequest/ToolTurnRequest/ToolCancelRequest/ToolResultPayload, UserPaletteInfo)
  - `src/tools/session.ts` (EditorSession: doc/history, execute, transaction, transactionAsync, undo/redo with turn guard, replaceDocument record|clear, beginTurn/endTurn merging a turn into one undo step, active layer/frame kept valid, selection, colors, onion, subscribe/getVersion for useSyncExternalStore)
  - `src/tools/registry.ts` (defineTool, ToolRegistry list/get/defs/execute with zod validation + readable errors + per-call transaction with rollback on error, createToolHost with serialization and beginTurn/endTurn), `src/tools/services.ts` (ToolServices + AssetService interfaces), `src/tools/memoryServices.ts`, `src/tools/util.ts`, `src/tools/render.ts` (renderPreview)
  - tool defs: `src/tools/defs/{document,layers,frames,drawing,reading,palette}.ts` = get_document, new_document, resize_canvas, set_active, open_project, save_project, add_layer, update_layer, delete_layer, move_layer, duplicate_layer, merge_down, add_frame, duplicate_frame, delete_frame, move_frame, set_frame_duration, create_tag, update_tag, delete_tag, copy_cel, draw_grid, set_pixels, draw_line, draw_rect, draw_ellipse, flood_fill, replace_color, clear_cel, transform_cel, outline, read_grid, render_preview, get_palette, set_palette, add_colors, remove_colors, list_palettes, load_palette, import_palette, export_palette, remap_to_palette, save_palette
- NOT DONE: `src/tools/defs/export.ts` (export_png, export_spritesheet, export_gif), `src/tools/defs/history.ts` (undo, redo), `src/tools/defs/index.ts` + `createDefaultRegistry()` and re-exports in `src/tools/index.ts` (the defs arrays are not registered anywhere yet), `docs/llm-guide.md` + `src/tools/guide.ts` (GUIDE, GUIDE_SHORT), `src/main/toolBridge.ts`, `src/main/services.ts`, `src/main/index.ts` wiring, `src/renderer/toolBridgeClient.ts` (+ renderer IPC ToolServices), all of `tests/tools/**`
- Status: `yarn typecheck` pass (exit 0), `yarn lint` pass, `yarn test` pass (12 files / 120 tests; no new tests). `yarn build` not run.
- Known nits: reading.ts render_preview background parsing has a redundant `|| hexToRgba(...)`; palette.ts remap_to_palette resolves layer/frame ad hoc instead of via resolveLayer/resolveFrame.
