# Changelog PAR-26

## 2026-11-22 PAR-26: extra Pixel ideas (picture-tool names tested, abort in the guard's read tested, app.json documented, repeatStop flagged, JSON retries counted)

Repo pixel-art-generator, branch `PAR-26_extra-ideas` (from master 5b63ec0).

Files:
- `src/tools/defs/reading.ts`: `PICTURE_TOOLS` exported (typed `ReadonlySet<string>`).
- `src/llm/agent.ts`: `AgentResult.repeatStop?: true`; `finish` takes `extra`; the repeat guard's stop returns `repeatStop: true`.
- `src/shared/agent.ts`, `src/main/agent.ts`: the `done` event carries `repeatStop`.
- `src/main/agentMcp.ts`: `AgentRunView` and `Entry` have `repeatStop`; set on `done`; `get_agent_run` description mentions it. `state` stays `completed`.
- `src/llm/json.ts`: `chatJson` sums the usage of every attempt that answered and returns it on `chat.usage`.
- `README.md`: `repeatStop` sentence; new "App settings (`config/app.json`)" subsection (checked against `src/main/appSettings.ts`).
- `ROADMAP.md`: PAR-26 bullet above PAR-25.
- Tests: `tests/tools/registry.test.ts` (1 new it), `tests/llm/agent.test.ts` (2 extended), `tests/main/agentMcp.test.ts` (1 extended).

Failing first:
- repeatStop (agent test): `AssertionError: expected undefined to be true` on unchanged code.
- usage (repair retries test): `expected { inputTokens: 30, ... } to deeply equal { inputTokens: 60, ... }` on unchanged code.
- MCP repeatStop: `expected { ...(11) } to match object { state, repeatStop }` on unchanged code.
- registry guard, mutation `'merge_down'` -> `'merge_dwn'`: `merge_dwn: expected undefined to be defined`.
- registry guard, mutation add `'render_preview'`: `render_preview: expected false to be true`.
- abort in the guard's read, mutation delete `if (signal.aborted) return finish('aborted')` (agent.ts:399): `expected 'completed' to be 'aborted'`.
All mutations restored (diff of the touched files shows only the intended changes).

Deviations: the plan's second mutation names `'preview'`, which is not a registered tool (the test fails earlier with "expected undefined to be defined"); the read-only case was proven with `'render_preview'`.

Verification: `yarn test` 52 files, 543 tests passed; `yarn typecheck` exit 0; `yarn lint` exit 0. PAR-25 part B's four files untouched.

UNTESTED: `get_agent_run` of a real looping run in the running app; chat token totals of a real model needing a repair retry.

Commit status: committed on PAR-26_extra-ideas (not pushed, not merged).
