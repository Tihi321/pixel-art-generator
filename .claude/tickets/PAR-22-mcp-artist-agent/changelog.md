# PAR-22 changelog

## 2026-11-22 PAR-22: the artist agent over MCP

The built-in chat agent (role `artist`) can be started, followed and stopped over MCP, and its models listed, in the window app and headless (`--mcp-only`).

Repo `pixel-art-generator`, branch `PAR-22_mcp-artist-agent` (from `PAR-21_vision-rows` 72d39f5).

Files:
- `src/main/agentMcp.ts` (new): `AgentRunLog` (last 20 runs, 50 compacted events per run, `timedOut` / `stoppedBy` flags), `createAgent`, `AGENT_TOOL_DEFS` (`start_agent_run`, `get_agent_run`, `stop_agent_run`, `list_models`), `withAgentTools` (busy check, model check, new conversation unless `continueChat`, 30-minute limit for MCP runs, stop that waits up to 10 s for the end).
- `src/main/llm.ts`: `checkAgentModel()` gives a clear error before a run starts when no model can run.
- `src/main/headless.ts`: optional agent with its own `LlmService`, saved chats, `mutates` / `fingerprint` for the result check; stop and handover stop the agent first; `createHeadlessHost` also returns the registry.
- `src/main/agentIpc.ts`, `src/main/mcpApp.ts`, `src/main/index.ts`: the window builds the agent first and serves `withAgentTools(toolBridge, agent)`; `startMcp` takes an `McpHost`; headless gets an agent with chats in `~/PixelStudio/chats`.
- `src/shared/agent.ts`, `src/main/agent.ts`: the `start` event carries `chatId`.
- `src/renderer/state/chat.ts`: a `start` with another `chatId` clears the chat view first (the draft stays).
- `src/tools/registry.ts`: a turn ends on the session it began on (stack of sessions).
- Tests: `tests/main/agentMcp.test.ts` (new, 3 tests), `tests/main/headless.test.ts` (+1), `tests/tools/registry.test.ts` (+1).
- `README.md` ("The artist agent over MCP"), `ROADMAP.md` (PAR-22 bullet).

Deviations:
- `AgentRunLog.begin` sets `startedBy` on an existing entry: `runner.send` emits `start` synchronously, so the entry exists (as `chat`) before `begin(..., 'mcp')`.
- `start_agent_run` re-checks busy after the awaited model check, so `reset()` never aborts a run that began meanwhile.
- `createHeadlessHost` returns `host: TurnToolHost` plus `registry`; `Headless.host` stays `McpHost`.
- A12 checked against `PAR-21_vision-rows` (the base) instead of `master`.

Verification:
- `yarn test` 51 files, 536 tests pass; `yarn typecheck`, `yarn lint`, `yarn build` exit 0 (implementer run); the three touched test files re-run by the orchestrator: 21/21.
- `git diff PAR-21_vision-rows -- src/llm` empty.
- Not run: the window app (Electron wiring, chat view sync), a real model, the real `checkAgentModel` (tests use a fake `AgentLlm`), a packaged headless build. Live check is hub HUB-41 K1.

Commit status: committed on `PAR-22_mcp-artist-agent` (see git log); not merged, not pushed.

## 2026-11-22 Polish 1 (deep-checker items)

1. (S2) `src/main/agentMcp.ts`: `AgentRunLog.runningId()` (an entry whose `done` is not recorded yet) and `AgentRunLog.ended(runId)` (resolves when its `done` is recorded). The busy check of `start_agent_run` (before and after the model check) is "the runner is running OR the log has a `running` entry"; the error names that run. `stop_agent_run` on a run whose loop ended but which is still saving waits for its `done` (capped at `STOP_WAIT_MS`) and returns its final state with `stopped: false`. `src/main/agent.ts` unchanged.
2. (S1) `withAgentTools` takes `closed?: () => boolean`; once true, `start_agent_run` answers `isError` "Pixel Studio is shutting down: no new agent run." (the other three tools keep working). `src/main/headless.ts`: `stopAgent` (used by `stopAll` and the handover) sets it closed first, then `runner.stop()`, then `await runner.whenIdle()`. The window never passes it.
3. (S4) The log stores the request `text` (entry and stored `start` event) cut to 4000 characters, `error` event messages and the `done` error cut to 2000, each with "…" when cut. Live events to the window unchanged.
4. (S3) `tests/main/agentMcp.test.ts`: the fake bridge's `draw_grid` returns an image part; test 1 asserts the stored `tool_result` has `hasImage: true` and no `image` key.
5. (T1) `tests/main/agentLlm.test.ts`: one test of the real `LlmService.checkAgentModel` (default ok, unknown ref, a role whose only model has no key).
6. (N2) `README.md`: New chat in the window ends a running run (`aborted`, no `stoppedBy`), MCP runs too.

Test 3 of `agentMcp.test.ts` also asserts the "shutting down" refusal (runner not running) and that a 10,000-character request is stored as 4000 characters plus "…".

Behaviour changes a caller can see:
- `start_agent_run` is refused as busy (naming the run) while the previous run has ended its loop but is still saving its chat (before its `done` event); `stop_agent_run` on such a run waits for it and returns its final state with `stopped: false`.
- Headless: during shutdown or a handover to the window, `start_agent_run` is refused with "Pixel Studio is shutting down: no new agent run."

Deviation: for the still-saving run, `stop_agent_run` waits on `runs.ended(runId)` rather than `runner.whenIdle()`: in that gap the runner's `current` is already null, so `whenIdle()` resolves at once and would not wait.

Verification: `yarn test` 51 files, 537 tests pass; `yarn typecheck`, `yarn lint`, `yarn build` exit 0; `git diff PAR-21_vision-rows -- src/llm` empty. A throwaway test (deleted, not committed) with a chat store whose save is held open confirmed: busy refusal naming the run during the save, then `stop_agent_run` returned `stopped: false, state: 'completed'`. Not run: the window app, headless shutdown end to end, a real model.
