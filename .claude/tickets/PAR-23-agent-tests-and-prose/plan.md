---
status: done
request: creative-hub/REQ-0030
repos: [pixel-art-generator]
branch: PAR-23_agent-tests-and-prose
updated: 2026-11-22
---

# PAR-23 The artist agent waits for its last chat save before it is idle; two agent tests; the prompt-size sentence

Hub ticket: creative-hub HUB-42 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-42-pending-ideas-and-proxy-monitor\plan.md`, triage rows P1, P12, P13, P14; P15 dropped), request REQ-0030. Checked on master 2e0d3fc (PAR-21 and PAR-22 merged), 2026-11-22.

Commands (Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first; `fnm exec yarn` fails): test `yarn test` (vitest, `environment: 'node'`); typecheck `yarn typecheck`; lint `yarn lint`; build `yarn build`. Do not start Pixel Studio; do not touch `C:\Users\Infplane\PixelStudio` (the hub's L4 updates the live copy of the prose after the merge).

## Scope

1. **P13, a bug.** `AgentRunner`'s run ends with `finally { this.current = null; await this.save(convo); if (done) deliver(done) }` (`src/main/agent.ts:282-286`), and `whenIdle()` (`:194`) waits only while `this.current` is set. So `whenIdle()` resolves before the chat is saved and `done` is delivered, and the headless `stopAgent` (`src/main/headless.ts:127-131`: `runner.stop()`, `await runner.whenIdle()`) can let `stopAll` and the process exit cut the last chat save short. Fix in the runner: keep the settle step (save, then deliver) as a promise; `whenIdle()` also waits for it. `current = null` stays where it is (the busy guard over MCP uses `runs.runningId()`, `src/main/agentMcp.ts:165-168`, which already counts a saving run as running). Bound the headless wait: `stopAgent` waits at most 10 s for `whenIdle()` (a hung save must not keep the process alive), then goes on.
2. **P12, a test.** "Busy while a run is saving": a second `start_agent_run` while the first run's chat save is pending is refused, and works once the save settles.
3. **P14, a test.** The window's view sync (`src/renderer/state/chat.ts:186`, a `start` event with a new `chatId` resets the transcript; `:195-198`, the `getState` sync) with a fake `window.pixelStudio`.
4. **P1, prose.** `seed/config/providers.md:296` says "In LM Studio load the model with a context of at least 32768: the guide, the document summary and the tool list take about 8000 tokens before the conversation starts." HUB-41 K1 measured 34,292 tokens on the first step (Strata, JSON-action mode); `:275` already says 32768 is too small for the artist.

## Out of scope

- P15 (a test of the second busy check, `agentMcp.ts:305`): dropped by test-discipline, the same guard family as P12.
- P2 (slimmer tool list), P3 (old previews), any vision change, the prompt order (hub Question 4).
- A seed migration for the prose (no existing user copy is migrated; the hub's L4 edits the one live copy).

## Files to touch (verified)

**`src/main/agent.ts`** (`AgentRunner`):
- a field `private settling: Promise<void> | null = null`;
- the `finally` at `:282-286` becomes: `this.current = null`, then `const settle = (async () => { await this.save(convo); if (done) deliver(done) })()`, `this.settling = settle`, `await settle`, `if (this.settling === settle) this.settling = null` (the existing `save` already swallows nothing new; keep its behaviour);
- `whenIdle()` (`:194`): loop while `this.current || this.settling`, awaiting `this.current?.done` or `this.settling`. Doc comment: "Resolves when no run is going and the last run's chat save and `done` event have settled."

**`src/main/headless.ts:127-131`** `stopAgent`: `await Promise.race([agent?.runner.whenIdle(), new Promise((r) => setTimeout(r, 10_000))])`; comment: "at most 10 s for the last run's chat save".

**`seed/config/providers.md:296`**, the whole line. New: "Tool calling works best with models that were trained for it (Qwen3 / Qwen3-Coder, Llama 3.x, Mistral, GPT-OSS, Gemma 3+). Load the model with a context of at least 65536 (Strata has 131072): the guide, the document summary and the tool list take about 34,000 tokens before the conversation starts (34,292 measured on the first step in JSON-action mode, creative-hub HUB-41)."

**`ROADMAP.md`**, a new entry at the top (newest first, the style of `ROADMAP.md:10`): "- **PAR-23** (2026-11-22, branch `PAR-23_agent-tests-and-prose`; creative-hub HUB-42, REQ-0030): the artist agent counts as idle only after its last chat save and `done` (a headless stop waits up to 10 s for them); tests for a start while a run saves and for the window following an MCP run's new chat; the seed's prompt-size sentence says about 34,000 tokens and a 65536 context. Live check UNTESTED (the window)."

## Tests (test-discipline: three tests, existing fakes; P15 dropped)

- `tests/main/agentMcp.test.ts` (reuse `setup(fakeLlm(...))`, `reply()`, `:33,45`), one test: a `chats` fake whose `save` waits on a gate; run 1 replies; while the gate is closed, `get_agent_run` shows `running` and `start_agent_run` is refused as busy; open the gate; run 1 shows `completed`; `start_agent_run` now starts run 2. (P12)
- `tests/main/agent.test.ts` (reuse `makeBridge`, `:25`, and its chats fake), one test: with the save gated, `runner.whenIdle()` is still pending after the reply; it resolves after the gate opens, and the `done` event was delivered before it resolved. (P13)
- `tests/renderer/chatSync.test.ts` (new, about 30 lines): `globalThis.window = { pixelStudio: { on: (channel, cb) => { handlers[channel] = cb; return () => {} }, invoke: async () => ({ running: false, runId: null, messageCount: 0, chatId: 'c1' }) } }`; `vi.resetModules()`, import `initChat` and `useChat` from `src/renderer/state/chat.ts`, `initChat()`; fire the agent event channel `agentApi.onEvent` listens on (`src/renderer/lib/agentApi.ts:20`; the worker reads the channel name there) with `{ type: 'start', chatId: 'c2', ... }`; expect `useChat.getState().chatId === 'c2'` and an empty transcript. (P14)

## Tasks for workers

One worker: the runner and headless change with their test, the two other tests, the prose, ROADMAP; then `yarn test`, `yarn typecheck`, `yarn lint`. Output: one commit on `PAR-23_agent-tests-and-prose` (`PAR-23: agent idle after its chat save, two agent tests, prompt-size prose`), `changelog.md` with the test count.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| R1 | `whenIdle()` waits for the last chat save and `done`; a headless stop waits at most 10 s | the agent test; code review of `headless.ts` |
| R2 | a start while a run saves is refused, and works after | the agentMcp test |
| R3 | the window follows an MCP run into its new chat | the chatSync test |
| R4 | the seed says about 34,000 tokens and 65536 | `grep -n "34,000 tokens" seed/config/providers.md` prints line 296; `grep -rn "8000 tokens" seed src README.md` prints nothing |
| R5 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

- The Pixel window with a real MCP run (the chatSync test fakes the bridge).
- A real headless stop while a chat is saving (timing; the test gates the save).
