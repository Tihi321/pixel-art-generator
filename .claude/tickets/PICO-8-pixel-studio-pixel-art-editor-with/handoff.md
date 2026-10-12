# Handoff: Pixel Studio (pixel-art editor + LLM agent + MCP)

_Updated 2026-10-12, end of session 2. Every plan phase is implemented and the automated checks pass. Nothing from session 2 is committed._

## Where things are
- **Repo:** `C:\projects\Personal\pixel-art-generator`
- **Branches:**
  - Session 1 was on `pixel-studio-editor-llm-mcp`, merged to `master` via PR #1 (3fa11b0).
  - Session 2 is on **`pixel-studio-tools-ui-mcp`**, cut from `origin/master` 3fa11b0. All of its changes are uncommitted in the working tree.
- **Ticket files:** `.claude/tickets/PICO-8-pixel-studio-pixel-art-editor-with/`. The `PICO-8` prefix came from the plan-to-ticket hook; it is not a ticket id.
  - [plan.md](plan.md): every checklist item is ticked, and the Verification log has an entry for each phase.
  - [changelog.md](changelog.md): the session 2 entry is at the top.

## Status
| Phase | Scope | State |
|---|---|---|
| 1, 2A, 2B | Scaffold, core, LLM layer | Done (session 1, merged) |
| 3A | ToolRegistry (48 tools at the time), guide, main ToolBridge + services, renderer bridge client | Done |
| 3B | Editor UI: canvas, tools, layers, timeline, palette, export and file dialogs | Done |
| 4 | MCP server + stdio shim + resources and prompts; agent runner + Chat panel + Settings | Done |
| 5 | Asset library + 6 asset and style tools (54 in total) + Assets panel; env overrides for isolation | Done |
| Final verification | typecheck, vitest, Electron e2e | Done |

The last checks, all run by the orchestrator on 2026-10-12, passed:
- `yarn gen:guide`, `yarn typecheck`, `yarn lint` and `yarn build`.
- `yarn test`: 33 files, 310 tests.
- `yarn test:electron`: 6 tests, 0 skipped. The e2e runs include MCP driving the live app.

## Next steps
1. **Commit and open a PR.** The user has not asked for this yet. Review `git status` first: there are about 50 changed or new files.
2. **Manual end-to-end** (plan → Verification → Manual):
   - With LM Studio running a tool-capable model, ask the chat for "32×32 knight, 4-frame walk, Endesga-32, export sprite sheet".
   - Run `claude mcp add --transport http pixel-studio http://127.0.0.1:7457/mcp` and ask for art in the style of a saved asset.
3. **Packaging:** run `yarn dist`, then check that the seed `extraResources` and the shim path (`out/mcp-stdio/index.js`, `asar: false`) work in the packaged app.
4. **Follow-ups:**
   - Check the palettes typed from memory against Lospec.
   - Add Claude 5.5 prices to the seed `providers.md`.
   - Fix the stale `anthropic/claude-sonnet-4.5` entry in the seed `providers.md`.
   - Optionally build copy/paste, drag to reorder frames, and native file dialogs.

## Key entry points
- **Main** (`src/main/index.ts`) registers, in order: `registerServices`, `toolBridge.registerIpc`, `startMcp(toolBridge)`, `registerAgentIpc(ipcMain, toolBridge)` and `startAssets()`.
- **Renderer:** `src/renderer/main.tsx` calls `startToolBridge(createDefaultRegistry(), session, createIpcServices())`. `src/renderer/state/session.ts` is the single live `EditorSession`.
- **Tools:** `src/tools/defs/*`, registered by `createDefaultRegistry()`.
- **Guide:** edit `docs/llm-guide.md`, then run `yarn gen:guide`. A test fails if the two drift apart.
- **IPC contracts:** `src/shared/{ipc,mcp,agent,assets}.ts`.
- **Env overrides:** `PIXEL_STUDIO_HOME` (data root, default `~/PixelStudio`) and `PIXEL_STUDIO_MCP_PORT`. The e2e tests use both, through `tests/e2e/launch.ts`.

## Decisions (do not revisit)
- **Ownership:** the renderer owns the document. Main runs the agent and the MCP server, and executes tools through the IPC tool bridge. Every edit therefore shows live and shares one undo history.
- **Undo granularity:**
  - One tool call is one undo step; the registry does this through a transaction.
  - An agent run is one undo step, via `beginTurn`/`endTurn`, and it is rolled back when the run ends in an error.
  - MCP calls are not wrapped in a turn.
- **MCP:** Streamable HTTP on 127.0.0.1:7457, an optional bearer token, DNS-rebinding protection, plus a stdio relay shim.
- **LLM layer:** copied from scriptorium and extended there, not shared as a package.
- **UI:** the UI runs the same tool handlers as the LLM (`runUiTool`) for asset actions, and core commands through `session.execute` for drawing.

## Open risks
- None of this has been tested against real LLM endpoints yet; only fake SSE servers and the mock provider.
- Packaging (`yarn dist`) has never been run.
- Leftovers from early e2e runs on this machine: `~/PixelStudio/projects/e2e-chk-*.pxs` and the seeded `~/PixelStudio/config`, which is identical to the current seed. They do no harm.
