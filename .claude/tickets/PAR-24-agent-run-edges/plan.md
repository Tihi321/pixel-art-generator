---
status: in-progress
request: creative-hub/REQ-0030
repos: [pixel-art-generator]
branch: PAR-24_agent-run-edges
updated: 2026-11-22
---

# PAR-24 Three edges of the artist agent over MCP: an empty model, a stop that lost the race, opening a chat while a run starts

Hub ticket: creative-hub HUB-43 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-43-open-ideas\plan.md`, triage item 11), request REQ-0030. The user said on 2026-11-22: "Ok build open idea first". Follows PAR-22 (contracts C1-C4, `.claude/tickets/PAR-22-mcp-artist-agent/plan.md`) and PAR-23. Checked on master 9429022 (read-only research notes: `C:\projects\Personal\creative-hub\.claude\temp\hub43-pixel-research.md`).

Notes for workers:
- Pixel Studio runs from this repo's `out/` (hub `pixel-studio`, `electron . --mcp-only`, `package.json` `main` `./out/main/index.js`). It is down today, but no `yarn build` on this branch: tests, typecheck and lint only. Hub R3 builds after the merge.
- Do not touch `C:\Users\Infplane\PixelStudio` (live data; another worker edits its config today).
- Commands (Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first): test `yarn test` (`vitest run`; one file: `npx vitest run <file>`); typecheck `yarn typecheck`; lint `yarn lint`; build `yarn build` (NOT in this ticket). Baseline after PAR-23: 52 files, 540 tests.

## Scope (the three real, reachable notes)

1. **`model: ""`** (`src/main/agentMcp.ts:299`): `const { text, model, continueChat } = p.data` passes `""` on; `checkAgentModel("")` and `resolveModel` (`src/main/llm.ts:400, 408-425`) use `??`, so `""` skips the chat's saved selection and the role default is used, against C1 ("Default: the model picked in the chat"). Fix: `const { text, continueChat } = p.data; const model = p.data.model?.trim() || undefined`. Everything below already uses `model` (`:303`, `:308` `model ?? null`).
2. **`stoppedBy`/`timedOut` on a run that ends `completed`** (`AgentRunLog`, `src/main/agentMcp.ts:116-125`): `markStopped` and `markTimedOut` (`:177-185`) set the flags before `runner.stop()`; when the run's `done` with `reason: 'completed'` was already on its way (the stop landed during the final `endTurn`), the entry reads `{state: 'completed', stoppedBy: 'mcp'}`, which contradicts C2 ("so the entry carries it when the `aborted` `done` arrives"). Fix: in the `done` branch, `if (ev.reason !== 'aborted') { delete e.stoppedBy; delete e.timedOut }`. `stop_agent_run`'s own `stopped: true` stays (that call did ask for the stop).
3. **`openChat` racing a run's start** (`src/main/agent.ts:177-182`): it checks `this.current` (`:179`), then awaits `this.opts.chats.load(id)` (`:180`), then sets `this.convo` (`:181`). An MCP `start_agent_run` that lands during the load starts its run in the old conversation, and the window then shows the opened chat while the run goes on elsewhere. Fix: after the `await`, check again: `if (this.current) throw new Error('The agent is still working. Stop it or wait, then open the chat.')` (the same message as `:179`).

## Out of scope (with the reason; see the hub triage)

- The window's New chat aborts an MCP run: by design and documented in the README (line 50); a change is a user decision (hub question 3).
- Local paths in MCP results: not a new exposure (localhost server with a Host/Origin check, `src/main/mcp.ts:103,155-175`; `export_png`, `open_document`, `save_document` already return paths).
- The stale turn-stack entry after a nested rollback, and `send()` assigning `current` after `execute`: not reachable (one run at a time, `beginTurn`/`endTurn` once per run, `agent.ts:243,267,285`; `execute`'s first `await` precedes any re-entry).
- `whenIdle()` returning during run 1's save: fixed by PAR-23 (`agent.ts:195-201, 287-296`, test `tests/main/agent.test.ts:274`).
- `before-quit` not waiting for the chat save: real but window-only, low value, and only testable in Electron.
- The duplicate `if (opts.turnError) throw` in a test: already gone.
- The slimmer tool list for JSON-action mode (hub question 2).

## Files and modules to touch

| file | change |
|---|---|
| `src/main/agentMcp.ts` | fixes 1 and 2 (about 3 lines) |
| `src/main/agent.ts` | fix 3 (1 line) |
| `tests/main/agentMcp.test.ts` | extend two tests (below) |
| `tests/main/agent.test.ts` | extend one test (below) |
| `ROADMAP.md` | the row below, above the PAR-23 row (line 10; newest first, blank line between rows) |

ROADMAP row: `- **PAR-24** (2026-11-22, branch \`PAR-24_agent-run-edges\`; creative-hub HUB-43, REQ-0030): \`start_agent_run\` with an empty \`model\` uses the chat's selected model; a run that ends \`completed\` no longer carries \`stoppedBy\` or \`timedOut\`; opening a saved chat is refused when a run started while the chat was loading. Live check UNTESTED (hub K4 runs one start with \`model: ""\`).`

## Contracts

- C1 of PAR-22 holds for `model: ""` and whitespace-only: treated as no model.
- C2: `stoppedBy` and `timedOut` appear only on an entry whose `state` is `aborted`.
- `AgentRunner.openChat` throws the "still working" error whenever a run holds the runner after the load, as it does before it.

## Tasks for workers

1. One worker: the three fixes and their test extensions, ROADMAP, `changelog.md` in this folder (test count, UNTESTED). One commit `PAR-24: empty model, stop flags on completed runs, openChat race` on `PAR-24_agent-run-edges`.

## Tests (test-discipline: extend three existing tests, no new file)

- `tests/main/agentMcp.test.ts` "no model: an error at once and nothing runs; ..." (`:121`): with `vi.spyOn` on the fake LLM's `checkAgentModel` (and `resolveModel` if the fake exposes it), `start_agent_run {text: 'x', model: ''}` calls `checkAgentModel` with `undefined`, not `''`.
- `tests/main/agentMcp.test.ts` "an MCP run stops at its time limit or with stop_agent_run, and the log keeps its bounds" (`:136`), in its direct `AgentRunLog` part: `begin('x', 't', 'mcp')`, `markStopped('x')`, `markTimedOut('x')`, `record({ runId: 'x', type: 'done', reason: 'completed', ... })` -> `get('x')` has neither `stoppedBy` nor `timedOut`; the same with `reason: 'aborted'` keeps both.
- `tests/main/agent.test.ts` "skips files that are not chats, and refuses to open one while a turn runs" (`:342`): a chats fake whose `load` waits on a gate; `const opening = runner.openChat(id)`; `runner.send({ text })`; open the gate; `await expect(opening).rejects.toThrow(/still working/)`; `runner.getState().chatId` unchanged; then `runner.stop()` and `await runner.whenIdle()`.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| P1 | an empty model means the chat's selection | extended `:121` test |
| P2 | stop flags only on aborted runs | extended `:136` test |
| P3 | `openChat` cannot swap the conversation under a run | extended `:342` test |
| P4 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

- In the window app (no Electron harness): the `openChat` race from the history list. Over MCP after hub R3: K4's second run with `model: ""`.
