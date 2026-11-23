---
status: done
request: creative-hub/REQ-0031
repos: [pixel-art-generator]
branch: PAR-26_extra-ideas
updated: 2026-11-23
---

# PAR-26 Extra Pixel ideas: picture-tool names checked, abort during the guard's read tested, config/app.json documented, the repeat guard's stop flagged in the run view, JSON retries counted in usage

Hub ticket: creative-hub HUB-44, request REQ-0031 (the extra ideas the PAR-25 check left; the user said 2026-11-22 "use all recommendation, add all possible extras"). Every line number below was checked on master 5b63ec0 (2026-11-22).

## Rules for every worker

- Branch `PAR-26_extra-ideas`, cut from master 5b63ec0. The worker does not commit. The orchestrator makes **one commit** after the checks: subject `PAR-26: picture-tool names tested, abort during the guard's read tested, app.json documented, repeatStop in the run view, JSON retries counted` (Bash heredoc `git commit -F - <<'EOF'`, blank line after the subject, last line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`). No push, no merge.
- Pixel Studio may be running from `out/` during the hub's live round: no `yarn build`, no `yarn dev`, no Electron start, nothing under `out/` or `dist/` touched. Never read or touch `C:\Users\Infplane\PixelStudio`.
- Commands (from `package.json`). In Bash, first: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` (`fnm exec yarn` fails). Run from `C:\projects\Personal\pixel-art-generator`:
  - all tests: `yarn test` (`vitest run`); one file: `yarn test tests/<dir>/<file>.test.ts`
  - `yarn typecheck`, `yarn lint`
- Line endings: `.ts` files are CRLF in the tree; `seed/**` and `*.md` (`README.md`, `ROADMAP.md`) are LF. Keep each file's endings. Write regexes and backslashes with the Edit tool, not through a Bash heredoc.
- **Disjoint from PAR-25 part B** (Strata row `vision: true` in `seed/config/providers.md`, a migration in `src/llm/seedMigration.ts` and `src/llm/setup.ts`, a test in `tests/llm/customProviders.test.ts`), which may land on master before or after this ticket: do not touch those four files. If part B is already on master when the branch is cut and it added a `ROADMAP.md` row, put this ticket's row above it.
- Tests follow the global `test-discipline` skill: only the assertions listed under Tests, in the files named there. Each is first **shown failing** (on the unchanged code, or by the mutation named for it), and the failing line goes into `changelog.md`.

## Scope (item, decision, verified cause)

| item | decision | cause, verified on 5b63ec0 |
|---|---|---|
| a. every `PICTURE_TOOLS` name is a registered, mutating tool | IN (guard test) | `PICTURE_TOOLS` is a private set of 28 names (`src/tools/defs/reading.ts:61-68`) read only through `changesPicture(name)` (`:72-74`); a misspelt name just returns false, so the repeat guard silently never counts that tool (`src/llm/agent.ts:378`). No test lists the set (`tests/llm/agent.test.ts:431-432` checks two names). Today every name is defined (checked by grep: each `name: '<tool>'` exists in `src/tools/defs/*.ts` and none sets `readOnly` or `noTransaction`), so the test only guards; it is proven by mutation. |
| b. abort during the guard's fingerprint read | IN (guard test) | `src/llm/agent.ts:392-397`: the guard awaits `opts.host.fingerprint(signal)`, then `if (signal.aborted) return finish('aborted')`. Without that line an abort that lands during the read on a repeated picture ends the run `completed` with the stop text (`:401-405`); the loop's own abort check comes only after (`:411`). No test covers it. |
| c. document `config/app.json` | IN | `src/main/appSettings.ts:10-17` has three keys: `selectedModel` (`provider/model` of the chat; null = the role's first available model; written by the chat's model choice, `src/main/llm.ts:201`), `contextSize` (tokens LM Studio loads models with, an integer 2048 to 1,048,576, else null = `lmstudio_context` / `load_context` in providers.md; `:13`, `:20-21`, `:32`; written by Settings, `llm.ts:209`), `agentToolSet` (`all` or `no-files`, by hand, no UI; `:15`). Unknown keys are kept and a broken file reads as the defaults (`:2`, `:36-38`, `:41-49`). `README.md:52` names only `agentToolSet`. |
| d. the repeat guard's stop flagged in the MCP run view | IN | The guard ends the run with `emit({ type: 'text', text: REPEAT_STOP_TEXT }); return finish('completed')` (`src/llm/agent.ts:403-405`); `AgentResult` (`:46-56`) and the UI `done` event (`src/shared/agent.ts:116`) carry only `reason`, so `get_agent_run` (`src/main/agentMcp.ts:44-60`, `:115-130`) shows `state: 'completed'` for both "the model said done" and "the guard stopped it"; only the reply text differs. Fix: an optional `repeatStop: true` from `AgentResult` through the runner's `done` event (`src/main/agent.ts:305-313`) to the run log and its view. `state` stays `completed` (clients and the chat panel, `src/renderer/state/chatReducer.ts:108-115`, read it). |
| e. `chatJson` counts only the last reply's usage | IN | `chatJson` sums `cost` over every attempt (`src/llm/json.ts:42-48`) but returns `chat: reply` / `chat: last`, the last reply only (`:65`, `:79`); the agent adds `r.chat.usage` (`src/llm/agent.ts:341`), so a schema retry (`:51-56`) or a repair attempt (`:69-80`) is never counted in tokens while its cost is. Fix: sum the usage of every attempt that answered and return it on the returned `chat`. An attempt that threw (schema refused) has no usage to add. |

## Out of scope

- Usage and cost of a `chatJson` call that fails after two repair attempts (it throws; the caller gets no result at all, `json.ts:81`): would need the error to carry usage; listed as an extra idea.
- Any UI for `config/app.json`; any change to `state` values.

## Files to touch (verified)

One worker (all items are small).

**`src/tools/defs/reading.ts`** (a), `:61`: `const PICTURE_TOOLS = new Set([` becomes `export const PICTURE_TOOLS: ReadonlySet<string> = new Set([`. Nothing else.

**`src/llm/agent.ts`** (d):
- `AgentResult` (`:46-56`), after `steps`: `/** True when the repeat guard ended the run (reason 'completed'): a step left a picture the run had already drawn; the model did not say it was done. */ repeatStop?: true`.
- `finish` (`:196-200`) gains a third parameter `extra: { repeatStop?: true } = {}` and returns `{ reason, messages: convo, steps, usage, costUsd, model, ...(error ? { error } : {}), ...extra }`. The `done` event it emits is unchanged.
- `:405`: `return finish('completed', undefined, { repeatStop: true })`.

**`src/shared/agent.ts:116`** (d): the `done` event gains `repeatStop?: true` (after `error?: string`), with the comment `/** The repeat guard ended the run (see AgentResult.repeatStop). */`.

**`src/main/agent.ts:305-313`** (d): add `...(result.repeatStop ? { repeatStop: true as const } : {})` to the sent `done` event.

**`src/main/agentMcp.ts`** (d):
- `AgentRunView` (`:44-60`) and `Entry` (`:63-80`), after `stoppedBy`: `/** The repeat guard ended the run (state 'completed'): not the model's own "done". */ repeatStop?: true`.
- `record`, done branch (`:116-128`), after `e.steps = ev.steps`: `if (ev.repeatStop) e.repeatStop = true`.
- `get_agent_run` description (`:250`): append " `repeatStop: true` with state `completed` means the repeat guard ended the run (a drawing step left a picture the run had already drawn), not the model."

**`src/llm/json.ts`** (e):
- import `Usage` with the other types (`:4`: `import type { ChatFn, ChatMessage, ChatResult, Usage } from './types'`).
- In `chatJson`, beside `let cost = 0` (`:42`): `let usage: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }`; in `ask` after `cost += r.costUsd`: `usage = { inputTokens: usage.inputTokens + r.usage.inputTokens, cachedInputTokens: usage.cachedInputTokens + r.usage.cachedInputTokens, outputTokens: usage.outputTokens + r.usage.outputTokens }`.
- `:65` returns `{ value: parsed.value, chat: { ...reply, usage }, cost }` and `:79` `{ value: parsed.value, chat: { ...last, usage }, cost }`.
- Doc comment (`:31-35`) gains: "The returned `chat.usage` and `cost` add up every attempt that answered (the schema retry and the repair attempts included)."

**`README.md`** (c, d; LF):
- `:52`, after "...or ends on one picture for the third time.": " `get_agent_run` then says `repeatStop: true` beside `state: completed`."
- A new subsection after the `### The artist agent over MCP` section (before `### Tools added for VN Studio`, `:54`):
  ```
  ### App settings (`config/app.json`)

  `~/PixelStudio/config/app.json` holds what is not provider config. `selectedModel`: the `provider/model` the chat uses (set by the chat's model choice; `null` = the first available model of the role). `contextSize`: the context window in tokens LM Studio loads models with, an integer from 2048 to 1048576 (set in Settings; `null` = `lmstudio_context` / `load_context` in `providers.md`). `agentToolSet`: `all` (default) or `no-files` (see above; edited by hand, no UI). Unknown keys are kept; a file that does not parse reads as the defaults.
  ```

**`ROADMAP.md`** (LF), a new bullet above `:10` (the PAR-25 bullet), in its style:
"- **PAR-26** (2026-11-22, branch `PAR-26_extra-ideas`; creative-hub HUB-44, REQ-0031): a test checks that every picture tool the repeat guard counts is a registered, mutating tool, and one that an abort during the guard's fingerprint read ends the run `aborted`; `config/app.json` is documented in the README; `get_agent_run` says `repeatStop: true` when the repeat guard ended a run; a JSON-action step counts the tokens of its schema retry and repair attempts. Live check UNTESTED."

**`.claude/tickets/PAR-26-extra-ideas/changelog.md`** (new): files, deviations, failing-first evidence of each test, test counts, UNTESTED list.

## Tests (test-discipline: one new `it`, the rest extend existing tests)

1. **`tests/tools/registry.test.ts`** (a), in `describe('createDefaultRegistry')` (`:20`), one new `it('every picture tool the repeat guard counts is a registered, mutating tool', ...)` (no existing test is about the guard's set): import `PICTURE_TOOLS` and `isMutatingTool` from `'../../src/tools/defs/reading'`; for each name `const tool = registry.get(name)`; `expect(tool, name).toBeDefined()`; `expect(isMutatingTool(tool!), name).toBe(true)`. Guard test: **prove it by mutation**: change `'merge_down'` to `'merge_dwn'` in `reading.ts` and see the test fail; then add `'preview'` (a read-only tool) and see it fail; restore both.
2. **`tests/llm/agent.test.ts`**, extend the repeat-guard test at `:429` ("repeat guard: ends the run when ..."):
   - (d) after `:459` (`expect(stopTexts(a.events)).toBe(1)`): `expect(a.r.repeatStop).toBe(true)`; after `:466` (the `progress` case): `expect(b.r.repeatStop).toBeUndefined()`. **Fails on the old code** (`repeatStop` undefined).
   - (b) at the end of the test: `const ac = new AbortController()`; `const base = seqHost(['drawn'])`; `let reads = 0`; a host `{ ...base, fingerprint: async (s: AbortSignal) => { reads++; const p = await base.fingerprint!(s); if (reads === 3) ac.abort(); return p } } as ToolHost` (read 1 is the start print, read 2 the guard after step 1, read 3 the guard after step 2, which sees the same picture); a `MockProvider('mock', { chunkDelayMs: 1 })` scripted with `script(3)`; `runAgent({ chat: mockChat(mock), ...jsonOpts, system: 's', userMessage: 'go', host, signal: ac.signal, onEvent: (e) => events.push(e) })`; expect `reason` `'aborted'`, `stopTexts(events)` 0 and `repeatStop` undefined. Guard test: **prove it by mutation**: delete `if (signal.aborted) return finish('aborted')` at `agent.ts:397`, see `reason` be `'completed'`, restore.
3. **`tests/llm/agent.test.ts`** (e), extend the test at `:539` ("takes two repair retries ..."): script the three replies as objects with usage, `{ text: '{"say": "a', usage: { inputTokens: 10, outputTokens: 1 } }`, `{ text: '{"actions": [', usage: { inputTokens: 20, outputTokens: 2 } }`, `{ text: JSON.stringify({ say: 'ok', actions: [], done: true }), usage: { inputTokens: 30, outputTokens: 3 } }`; after `:544`: `expect(res.usage).toEqual({ inputTokens: 60, cachedInputTokens: 0, outputTokens: 6 })`. **Fails on the old code** (`{ inputTokens: 30, cachedInputTokens: 0, outputTokens: 3 }`).
4. **`tests/main/agentMcp.test.ts`** (d), extend the test at `:141` ("an MCP run stops at its time limit ..."), at its end:
   - through the runner: `const looped = createAgent({ bridge, llm: fakeLlm(new MockProvider('mock')), run: async () => ({ reason: 'completed', repeatStop: true, messages: [], steps: 2, usage: zero, costUsd: 0 }) })`; `const h = withAgentTools(baseHost, looped)`; start a run with `start_agent_run { text: 'loop' }`, `await looped.runner.whenIdle()`, and expect `get_agent_run` to match `{ state: 'completed', repeatStop: true }`. **Fails on the old code** (no `repeatStop`).
   - after `:185`: `expect(log.get('c')!.repeatStop).toBeUndefined()` (a completed run without the guard carries no flag; passes on both, kept as the contrast).
5. No test for c (prose): proof by reading against `appSettings.ts`.

## Tasks for workers

| worker | files (only these) | outputs |
|---|---|---|
| A | `src/tools/defs/reading.ts`, `src/llm/agent.ts`, `src/llm/json.ts`, `src/shared/agent.ts`, `src/main/agent.ts`, `src/main/agentMcp.ts`, `tests/tools/registry.test.ts`, `tests/llm/agent.test.ts`, `tests/main/agentMcp.test.ts`, `README.md`, `ROADMAP.md`, `.claude/tickets/PAR-26-extra-ideas/changelog.md` | items a to e; docs; changelog |

Order: write tests 2 (d), 3 and 4 first and paste their failures on the unchanged code; then make the code changes; then tests 1 and 2 (b) with their mutations. Then `yarn test`, `yarn typecheck`, `yarn lint`. Report: files changed, each failing-first line, final pass counts, deviations. The orchestrator reruns the three commands and commits once.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| P1 | a misspelt or read-only name in `PICTURE_TOOLS` fails a test | test 1 and its two mutations |
| P2 | an abort during the guard's fingerprint read ends the run `aborted`, with no stop text | test 2 (b) and its mutation |
| P3 | `config/app.json` and its three keys are documented as the code reads them | README subsection; review against `appSettings.ts` |
| P4 | a run the repeat guard ended has `repeatStop: true` in `AgentResult` and in `get_agent_run`; other runs have none; `state` is still `completed` | tests 2 (d) and 4 |
| P5 | a JSON-action step's usage adds up every attempt that answered | test 3 |
| P6 | nothing else breaks; PAR-25 part B's four files untouched | `yarn test`, `yarn typecheck`, `yarn lint` exit 0; `git diff --stat master` lists none of them |

## UNTESTED

- `get_agent_run` of a real looping run over MCP in the running app (needs a rebuild and a local model run; the hub's live round).
- The token totals shown in the chat for a real model that needed a repair retry.
