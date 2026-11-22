# Changelog PAR-24

## 2026-11-22 PAR-24: three agent run edges

Outcome: an empty `model` means the chat's selection, stop flags only on aborted runs, `openChat` refused when a run started during the load.

Repo pixel-art-generator, branch `PAR-24_agent-run-edges`:
- `src/main/agentMcp.ts`: `start_agent_run` trims `model`; empty or whitespace is treated as none. `AgentRunLog.record` drops `stoppedBy`/`timedOut` when `done` is not `aborted`.
- `src/main/agent.ts`: `openChat` re-checks `this.current` after the load and throws the same "still working" error.
- `tests/main/agentMcp.test.ts`, `tests/main/agent.test.ts`: three existing tests extended (no new file or `it`).
- `ROADMAP.md`: PAR-24 row.

Deviations: none.

Verification: `yarn test` 52 files, 540 tests pass; `yarn typecheck` exit 0; `yarn lint` exit 0; the three extended tests fail with `src/main` reverted. Not run: the window or MCP live (UNTESTED; hub K4 with `model: ""`), `yarn build` (not in this ticket).

Commit: see git log on the branch (not merged, not pushed).
