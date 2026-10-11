# Changelog

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
