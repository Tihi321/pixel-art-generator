# PAR-09 changelog

## 2026-10-22: engine.lock, a dialog when the window meets a headless engine, and take-over

Branch `PAR-07-13_roadmap`, one commit for this ticket.

### What happened before (reproduced from a HEAD build)

The window DID start next to a headless engine, with no dialog and no message: its MCP failed with "Port N is already in use." (only in the log and Settings > MCP), the headless engine kept serving its own documents, and a second `--mcp-only` exited with "Port N is already in use." without naming the holder.

### Files

- `src/main/engineLock.ts` (new): `engine.lock` in the data folder (`{pid, mode, port, url, startedAt, version}`): read, live check (dead pid = stale), acquire (refuses another live pid), release (own lock only), holder description.
- `src/main/takeover.ts` (new, no Electron): handover request (401 -> readable reason), wait for the port, `open_document` args for a handed-over document, `PIXEL_STUDIO_ENGINE_CHOICE=takeover|without-mcp|quit`.
- `src/main/mcp.ts`: optional extra POST `routes` with the same Host/Origin/token checks as `/mcp`.
- `src/main/headless.ts`: with `lockRoot`: refuses to start when a live lock exists (message names mode, pid, URL), writes the lock after binding, releases it on stop; `POST /engine/handover` writes every document (not the untouched blank) to `<root>/handover/<ts>/<n>.pxs`, answers the list, stops and calls `onHandover`.
- `src/main/index.ts`: window start: live headless lock -> dialog (or env choice). Take over: handover, wait for the port, open the documents as tabs (original project path, exportTo, unsaved stays unsaved, the engine's current one selected), then `--open`, then delete the handover folder; MCP on the engine's port. Without MCP: MCP blocked with the note. Quit: exit.
- `src/main/mcpApp.ts`, `src/main/mcpSettings.ts`: `startMcp(bridge, {blocked, port})`; the window writes/moves/releases its lock from the MCP status; any MCP error also goes to the status bar (new IPC `app:notice`, replayed when the page loads); `port` override forces enabled + that port for this run only (mcp.json untouched).
- `src/shared/ipc.ts`, `src/renderer/main.tsx`: `app:notice` -> status bar.
- `src/tools/documents.ts`, `src/renderer/state/actions.ts`: `add(..., {dirty})`; `DocumentSet.isUntouched`.
- `src/tools/defs/studio.ts`: `open_document` internal `handover {path?, dirty?}` option (marked "Internal, not for agents"; not in the guide).
- `README.md`: engine.lock, take-over, `PIXEL_STUDIO_ENGINE_CHOICE`. `ROADMAP.md`: item and the now-empty "Documents and sessions" heading removed.
- Tests: `tests/main/engineLock.test.ts` (3), `tests/main/handover.test.ts` (6), port override in `tests/mcp/settings.test.ts` (1).

### Deviations

- Handed-over documents go through the internal `open_document.handover` option instead of a dedicated IPC (one hidden arg in the LLM-visible schema).
- The window's lock follows the MCP status, so a port change in Settings moves the lock.
- A headless start refuses on any live lock in the same data folder, even when it would use another port (the message says who holds it).

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 43 files, 389 tests passed. `yarn build`: ok.
- Manual (temp `PIXEL_STUDIO_HOME`, port 7598): take-over with two documents (one saved, one unsaved): headless exited, window serves 7598, `list_documents` shows both with content, original path and unsaved flag, `save_document` writes the original path, handover folder removed; rerun with mcp.json `{"enabled":false,"port":7597}`: window still ends on 7598, mcp.json unchanged. Without MCP: Settings status and status bar show the headless note. Second headless start: named-holder message, exit 1. Stale lock from a killed window replaced.
- Not run: clicking the native dialog (only the env-var path), the `quit` choice, the 401 fallback in the real app, the lock release on a clean window quit.

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-09: engine.lock and taking over a running headless engine".
