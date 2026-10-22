# PAR-09: Opening the window while the headless engine runs says so, and can take over

Ticket folder: `.claude/tickets/PAR-09-engine-lock-window-attach/`. Branch: `PAR-07-13_roadmap` (one commit for this ticket).

Source: `ROADMAP.md` > "Documents and sessions", item 4: "Opening the app while the headless engine runs (VN Studio's 'Open in Pixel Studio', or a double-click) can fail with no message while the headless studio holds `engine.lock`. It should say so, or attach to the running engine."

## What happens today (from the code)

- Pixel Studio has no `engine.lock` file yet (the hub's README assumes one per data folder). Headless (`--mcp-only`) skips the single-instance lock and uses a separate Chromium user-data folder, so a window CAN start next to it.
- But the window's MCP server then fails to bind its port (EADDRINUSE). The error only shows in Settings > MCP. VN Studio and the hub keep talking to the headless engine on that port, while the user edits in the window: the two hold different documents and nothing says so. A second headless start fails with "Port 7457 is already in use." and no hint who holds it.
- First step of the implementation: reproduce it (`yarn build`, `yarn mcp`, then `yarn electron . --open <png>` with a test home `PIXEL_STUDIO_HOME`) and write down what actually happens in the changelog. If the window really fails to start, find out why and fix that too.

## Goal

1. Each running engine (window or headless) that serves MCP writes `engine.lock` in the data folder (`~/PixelStudio/engine.lock`, or `PIXEL_STUDIO_HOME`): JSON `{pid, mode: "window"|"headless", port, url, startedAt, version}`. Removed on a clean exit. A lock whose pid is not alive is stale and is replaced.
2. **Window start while a live headless engine holds the lock:** a native dialog explains it and offers:
   - **Take over (recommended):** the headless engine hands its open documents to the window and exits; the window opens them as tabs (same project paths and `exportTo` round-trip targets, the current one active, unsaved ones stay unsaved) and then serves MCP on the same port, so clients keep working (their documentIds change: they are tab ids now; `list_documents` shows them).
   - **Open without MCP:** the window runs, its MCP stays off, and the status bar plus Settings > MCP say that the headless engine (pid, url) serves MCP.
   - **Quit.**
   With `--open` (VN Studio's "Open in Pixel Studio") the document still opens in the window after the choice.
3. **Headless start while another engine holds the lock or the port:** exit 1 with a message that names it: "Pixel Studio is already running (window, pid 1234) and serves MCP on http://127.0.0.1:7457/mcp. Use that one, or close it first." (exit code unchanged).
4. **Window MCP bind failure for any reason** shows in the status bar as well as in Settings > MCP.

## Decisions

- **Lock module** `src/main/engineLock.ts` (no Electron import, testable): `readLock(root)`, `acquireLock(root, info)` (stale-pid check with `process.kill(pid, 0)`), `releaseLock(root, pid)` (only deletes its own lock). Written after the MCP server bound (the lock means "this process serves MCP here"); a window whose MCP is off or failed does not write it.
- **Handover endpoint** on the headless MCP HTTP server only: `POST /engine/handover` (same bearer token check as `/mcp`, 127.0.0.1 only, JSON body `{}`).
  - `McpHttpServer` gets an optional `routes?: Record<string, (req, res) => Promise<void>>` option (exact path match, checked before `/mcp`, token-checked the same way). Keep the change small.
  - The headless handler: serializes every document of the `DocumentSet` (skip the untouched placeholder) to `<root>/handover/<timestamp>/<n>.pxs`, writes nothing else, answers `{documents:[{file, name, path, exportTo, dirty, current}]}`, then stops the server, releases the lock and exits (`app.exit(0)` through an injected `onHandover` callback so the module stays testable).
- **Window side** (`src/main/index.ts` + a small `src/main/takeover.ts`): before `startMcp`, read the lock. If a live headless lock exists, show `dialog.showMessageBox` (buttons above, default Take over, cancelId Quit). Take over: POST the handover (token from `PIXEL_STUDIO_MCP_TOKEN` or the window's mcp.json token; if the engine answers 401, say so in the dialog result and fall back to "without MCP"), wait until the port is free (poll up to 5 s), then start MCP and open the handed-over files through the tool bridge (`open_document` for each with `exportTo`; restore the project `path` with a new tool-bridge call or by passing it - if `open_document` cannot keep a project path for a handover file, add an internal IPC/tool option `projectPath` on `open_document` that is not documented for LLMs, or open the `.pxs` and then call `markSaved` through a dedicated IPC; pick the simplest that keeps Ctrl+S going to the original path and leaves unsaved docs dirty). Delete the handover folder after the tabs are open.
- "Without MCP": the window does not start its MCP server this run; `registerMcp` status reports `error: "Pixel Studio headless (pid N) serves MCP on <url>"` so Settings shows it, and a status-bar message says the same.
- The renderer status-bar message: main sends it over an existing or one new IPC channel (`app:notice`), shown with `useUi.setStatus`.
- Tests for the lock module, the handover route (start headless on port 0, add two docs, POST handover, check files and exit callback), and the headless refusal message. The dialog flow itself is verified by hand (record what was run).

## Checklist

- [x] 1. Reproduce and record current behaviour. Built HEAD (`yarn build`), `PIXEL_STUDIO_HOME`=temp, `PIXEL_STUDIO_MCP_PORT=7598`: headless with two documents (one saved, one unsaved), then `electron .` (window): the window opened normally (no dialog, no message), its MCP failed with `[mcp] Port 7598 is already in use.` (log and Settings > MCP only); `list_documents` on 7598 still answered with the headless documents (doc2, doc3 [unsaved]) while the window held its own blank tab. A second `electron . --mcp-only` printed `MCP server could not start: Port 7598 is already in use.` and exited 1 (no holder named). The window does start (nothing to fix there).
- [x] 2. `src/main/engineLock.ts` + `tests/main/engineLock.test.ts` (3 tests: own lock, stale replaced / live of another pid refused, release only own + garbage).
- [x] 3. `McpHttpServer` `routes` option; `startHeadless` (`lockRoot`, `version`, `onHandover`): lock written after bind and released on stop, `POST /engine/handover` (`writeHandover`), refusal naming the holder. `tests/main/handover.test.ts` (lock, refusal message, handover with/without token, open_document handover option, no route without lockRoot, env choice).
- [x] 4. Window: `takeover.ts` (request, port wait, open args, env choice), dialog + take over + without-MCP in `index.ts`, lock sync and status-bar notice in `mcpApp.ts` (`app:notice`, replayed on `did-finish-load`), `blocked` option in `registerMcp`.
- [x] 5. Docs: `README.md` (headless section: engine.lock, taking over, `PIXEL_STUDIO_ENGINE_CHOICE`), `ROADMAP.md` (item and the then-empty "Documents and sessions" heading removed). `docs/llm-guide.md` unchanged (the new `open_document.handover` is internal and not documented there).
- [x] 6. Verify: `yarn typecheck`, `yarn lint`, `yarn test` (388 passed in 43 files; 9 of them new: 3 lock + 6 handover, open_document option and choice), `yarn build` all pass. Manual runs (port 7598, `PIXEL_STUDIO_HOME` under `.claude/temp/par09`):
  - headless (two docs) + window `PIXEL_STUDIO_ENGINE_CHOICE=takeover`: headless exited (no mcp-only process left), lock now `mode: window` with the same port, `list_documents` on 7598 shows tab1 "one" with its original project path (clean) and tab2 "two" [unsaved]; `read_grid` shows the pixels of both; `save_document {document: tab1}` wrote to the original path; the `handover/` files are removed after the tabs open.
  - headless + window `without-mcp`: via DevTools protocol, Settings state `{"running":false,"error":"Pixel Studio headless (pid N) serves MCP on http://127.0.0.1:7598/mcp"}` and the status bar showed `MCP is off: Pixel Studio headless (pid N) serves MCP on ...`; the headless lock and documents untouched.
  - headless running, headless again: `MCP server could not start: Pixel Studio is already running (headless, pid N) and serves MCP on http://127.0.0.1:7598/mcp. Use that one, or close it first.`, exit 1. A stale lock (window killed with Stop-Process) was replaced by the next headless start.
  - Not run by hand: the native dialog itself, `quit` choice, 401 fallback in the real app (the 401 request is unit-tested), a clean window quit releasing the lock (force-killed runs leave a stale lock, which is ignored).

## Deviations

- Handover documents reach the window through an internal `handover: {path?, dirty?}` option of `open_document` (hidden from agents by its description) plus `dirty` on `DocumentHost.add`, instead of a dedicated IPC.
- The window takes the lock from the MCP status callback (`mcpApp.ts`), so a port change in Settings moves the lock too; the lock is only written while the server runs.
- `src/main/headless.ts` only uses lock and handover when `lockRoot` is given (index.ts passes `defaultRoot()`), so tests never touch the real data folder.

## Acceptance

- Starting the window while headless runs never leaves the user guessing: a dialog says what runs and offers take over / without MCP / quit.
- Take over keeps the engine's documents (as tabs) and the MCP URL.
- A headless start next to a running engine prints who holds it.
- All checks pass.
