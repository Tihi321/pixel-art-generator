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
