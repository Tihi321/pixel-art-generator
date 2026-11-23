---
status: done
request: creative-hub/REQ-0031
repos: [pixel-art-generator]
branch: PAR-25_repeat-guard-tool-set
updated: 2026-11-23
---

# PAR-25 The artist agent stops when a step redraws the same picture; an optional `no-files` tool set; Strata as a vision model only after the live round

Hub ticket: creative-hub HUB-44 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-44-pending-ideas\plan.md`, triage rows P-15, P-17), request REQ-0031. Checked on master 5778801 (2026-11-22). Line numbers are from that commit; find each place by its text.

The user decided on 2026-11-22: P-15 "Guard, then test" (the guard now; Strata's row becomes `vision: true` only if three live vision runs in a row finish in the hub's live round, as a separate, later change); P-17 "Build, default off" (`agentToolSet: 'all' | 'no-files'` in `config/app.json`, default `all`; the guide text must not contradict the mode).

## Rules for the worker

- Branch `PAR-25_repeat-guard-tool-set` cut from `master`. One commit for part A: `PAR-25: stop a run that redraws the same picture; optional no-files tool set`.
- Commands (from `package.json`; Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first; `fnm exec yarn` fails): `yarn test`, `yarn typecheck`, `yarn lint`. One file: `npx vitest run tests/llm/agent.test.ts`. No `yarn build` on the branch (Pixel runs from `out/` when it is up; the hub rebuilds after the merge with `hub.ps1 build pixel-studio`).
- Never touch `C:\Users\Infplane\PixelStudio` or any live data folder (the hub's live round does that).
- Regexes, backslashes and Windows paths go through the Edit tool, not Bash heredocs.
- Line endings: `core.autocrlf` is true; `seed/**` and `*.md` are LF in the tree (`.gitattributes`), `.ts` files CRLF. Keep each file as it is; `git diff --stat` must show no whole-file rewrites.
- Tests follow test-discipline: the few listed below, in existing files, no near-duplicates. Show each new test failing on the old code before the fix (run it, paste the failure into `changelog.md`).
- Do part B only when the hub's live round says so (see Part B).

## Part A (this build)

### A1. P-15 guard: a step that redraws the same picture ends the run

Facts (verified):
- JSON-action loop `src/llm/agent.ts:324-379`. The host's `fingerprint` (`:20-21`, FNV-1a over the document, `src/tools/defs/reading.ts:12`) is read once at the start (`startPrint`, `:315-323`) and by `resultRetry` (`:293-304`) only when the model ends the turn.
- HUB-43 K3 run 1 (`runs\hub-43-open-ideas.md:154,164` in the hub): `vision: true`, 25 steps to `max_steps`, about 18 steps of `clear_cel` + `draw_grid` + `render_preview` that redrew the same 16-row grid. The document after such a step equals the document after the step before.

What the K3 record shows about the grouping: "638 tokens a step (clear_cel + draw_grid + render_preview, each with an image)" (`runs\hub-43-open-ideas.md:154`, `:164`), so the three actions came in one step. That is read from steps 18-25 only (the events of steps 1-17 were dropped by the 200-event buffer). A model can also split `clear_cel` and `draw_grid` into separate steps; the fingerprints then alternate (blank, drawn, blank, drawn), and the blank one may equal the start. So the rule below also catches a picture the run returns to, not only a repeat of the step before.

New behaviour, in the JSON-action loop only (native mode unchanged):
- New state next to `startPrint` (`:316`): `let lastPrint: string | undefined` (the fingerprint a pixel-changing step last ended on) and `const ended = new Map<string, number>()` (for each fingerprint other than `startPrint`, how many pixel-changing steps have ended on it).
- New exported constant next to `MAX_RESULT_NUDGES` (`:100`):
  ```ts
  /** Said when a run ends because a step left a picture the run had already drawn (a redraw loop, creative-hub HUB-43 K3). */
  export const REPEAT_STOP_TEXT = 'Stopped: this step left a picture the run had already drawn, so the drawing is kept as it is.'
  ```
- In the actions loop (`:356-371`) track `let stepMutated = false` per step; set it to true after `runTool` when `opts.host.mutates?.(action.tool)` and the result is not an error.
- After the results message is pushed (`:375`) and before `if (aborted || signal.aborted) return finish('aborted')` (`:376`), add: when `!reply.done && !aborted && !signal.aborted && stepMutated && opts.host.fingerprint && opts.host.mutates && startPrint != null`, read `now = await opts.host.fingerprint(signal)` (a throw counts as null). If `now == null`: nothing. If `now === startPrint`: nothing is counted and `lastPrint` stays (an unchanged or blank-again canvas is left to `resultRetry`, as today). Otherwise, with `seen = ended.get(now) ?? 0`: stop when `now === lastPrint` (the step ended on the same picture as the pixel-changing step before it) OR `seen >= 2` (this is the third time a step ends on this picture): `emit({ type: 'text', text: REPEAT_STOP_TEXT })` and `return finish('completed')`. Else `ended.set(now, seen + 1)` and `lastPrint = now`.
- So: a step only counts when it changed pixels successfully; the start print is never counted (the existing result-check tests stay green: `tests/llm/agent.test.ts:377-440`); the first drawing step never stops a run; whole redraws in one step stop at the second such step; a loop that alternates through the start (blank, drawn, blank, drawn) or between two pictures stops when a step ends on a picture for the third time; a step that ends with `done: true` ends as before.
- The conversation then ends with the results message, as a `max_steps` end does today (`:375` then `:379`).
- Doc comment of `runAgent` (`:167-172`): add "or a step leaves the picture exactly as the step before it (JSON-action mode, ends `completed`)".

Test (one new `it` in the existing `describe('result check (action ran, document unchanged)')`, `tests/llm/agent.test.ts:363-441`, using its `printHost` pattern):
- A host whose `draw` sets `state.print = 'drawn'` (always the same value); the mock answers `draw` with `done: false` three times, then `done: true`. Expect `r.reason` `completed`, `mock.requests` length 2 (step 2 redrew the same picture: the run ended there), and an emitted `text` event equal to `REPEAT_STOP_TEXT`. On the old code the run makes 4 requests: show that failure.
- In the same `it`: a host whose `draw` sets `state.print = 'v' + n` (a new picture each step) with the same script makes 4 requests and emits no `REPEAT_STOP_TEXT` (the guard does not fire on progress).
- In the same `it`: an alternating host whose `draw` sets the prints `a, b, a, b, a` in turn, the mock answering `draw` with `done: false` six times, then `done: true`. Expect a stop on the fifth step (the third arrival on `a`): `mock.requests` length 5, `REPEAT_STOP_TEXT` emitted, reason `completed`. On the old code it makes 7 requests: show that failure. (A blank canvas equals the start print and is not counted, so the test uses two drawn prints to prove the third-arrival rule itself.)

### A2. P-17 optional tool set `agentToolSet: 'all' | 'no-files'`, default `all`

Facts (verified):
- `src/main/appSettings.ts:7-33`: `AppSettings` `{ selectedModel, contextSize }`, `readAppSettings` fills defaults and keeps unknown keys on write (`:35-46`).
- `src/main/llm.ts:64-70` `ResolvedModel { source, vision, ref? }`; `resolveModel` `:400-405` reads the selection through `selectedModel()` (`:212-214`).
- `src/main/agent.ts:92-95` `ResolvedAgentModel { source, vision }`; the runner builds the agent's host at `:250` (`withAutoPreview(bridge, model.vision)`) and the system prompt in `buildSystem` (`:335-360`: the guide, the document, the style context). Both the window and headless use this runner through `createAgent` (`src/main/agentMcp.ts:200-220`, `guide: GUIDE`).
- `runAgent` refuses a tool that is not in `host.tools()` (`src/llm/agent.ts:219-227`), so a filtered `tools()` is enough to hide a tool.
- The 10 tools that read or write files on disk (names verified in `src/tools/defs/*.ts`): `open_project`, `save_project` (`document.ts:141,169`), `export_png`, `export_spritesheet`, `export_gif` (`export.ts:48,89,140`), `import_image`, `export_many`, `export_expression_set`, `open_document`, `save_document` (`studio.ts:82,145,273,364,421`). HUB-43's estimate said "12 file and export tools, 17,349 characters"; its list was not recorded by name. This plan uses the 10 above (see Questions); the worker measures the real saving.

Changes:
- `src/main/appSettings.ts`: `export type AgentToolSet = 'all' | 'no-files'`; `AppSettings.agentToolSet: AgentToolSet` with the doc comment "Tools the artist agent gets: `all`, or `no-files` (without the 10 tools that open, save, import or export files; a smaller prompt for local models). Edit `config/app.json` by hand; no UI."; `DEFAULTS.agentToolSet = 'all'`; `readAppSettings` returns `agentToolSet: raw.agentToolSet === 'no-files' ? 'no-files' : 'all'`. The header comment (`:1-2`) names the new key.
- `src/main/llm.ts`: `ResolvedModel` gets `toolSet: AgentToolSet`; `resolveModel` reads the settings once (`const settings = await readAppSettings(this.configDir)`, `ref = modelRef ?? settings.selectedModel`) and returns `toolSet: settings.agentToolSet`.
- `src/main/agent.ts`:
  - `ResolvedAgentModel` gets `toolSet?: AgentToolSet` (absent = `all`, so the existing test doubles stay valid).
  - Exported `export const NO_FILES_TOOLS: ReadonlySet<string>` with the 10 names, and `export function withToolSet(host: ToolHost, toolSet: AgentToolSet | undefined): ToolHost` that returns `host` unchanged for `all`/undefined, else a host whose `tools()` drops `NO_FILES_TOOLS` and that passes `execute`, `mutates` and `fingerprint` through (same shape as `withAutoPreview`, `:40-61`).
  - `:250` becomes `withAutoPreview(withToolSet(bridge, model.toolSet), model.vision)`.
  - `buildSystem` takes the tool set: for `no-files` it appends, after the style context, the section
    `## Tools in this chat\n\nThe file tools are off in this Pixel Studio (config/app.json: "agentToolSet": "no-files"): ${[...NO_FILES_TOOLS].join(', ')}. Where the guide above names one of them, skip that step: draw in the open document; the user opens, saves and exports files.`
    This is how the guide stops contradicting the mode: the guide (`src/tools/guideText.ts`, also served as `pixel-studio://guide`) stays one text, and the system prompt says which of its tools are off and what to do instead. For `all` the system prompt is unchanged.
- `README.md`: one sentence where `config/app.json` is described (the worker finds it with `grep -n "app.json" README.md docs/*.md`): "`agentToolSet`: `all` (default) or `no-files`: the artist agent then works without the 10 file tools, a prompt about N characters smaller (local models in JSON-action mode)." with N measured (below).
- Measure: in a throwaway script or a test console line (not committed), `jsonModeInstructions(defs).length` for all tools minus the same for the filtered list; record both numbers and the difference in `changelog.md` and use the difference for N.

Tests:
- `tests/main/agentLlm.test.ts:216-229` (`describe('appSettings')`): the three `toEqual` objects (`:220`, `:224`, `:228`) gain `agentToolSet: 'all'`; add one line that `{"agentToolSet":"no-files"}` reads as `'no-files'` and `{"agentToolSet":"x"}` as `'all'`. The `no-files` line fails on the old code.
- `tests/main/agent.test.ts`, `describe('AgentRunner')` (`:60-`): one new `it`: `makeBridge(['get_document', 'draw_grid', 'export_png', 'save_project'])`, a runner whose `resolveModel` returns `toolSet: 'no-files'` (native mode, `tools: true`), one mock reply without tool calls; assert the tool names the model got in `mock.requests[0]` contain `draw_grid` and neither `export_png` nor `save_project`, and the system message contains `"agentToolSet": "no-files"`. The same runner with `toolSet` absent offers all four (one extra assertion in the same `it`). Fails on the old code.

### A3. ROADMAP

`ROADMAP.md`: a new bullet above line 10 (the PAR-24 bullet; newest first), in its style:
"- **PAR-25** (2026-11-22, branch `PAR-25_repeat-guard-tool-set`; creative-hub HUB-44, REQ-0031): the artist agent in JSON-action mode ends a run (`completed`) when a step leaves the picture exactly as the step before it (HUB-43 K3 redrew one grid about 18 times to the step limit); optional `agentToolSet: "no-files"` in `config/app.json` (default `all`) drops the 10 file tools and says so in the system prompt. Strata as Pixel's vision model waits for the hub's live round (part B). Live check UNTESTED (hub HUB-44 K5)."

## Part B (later, only on the hub's word): Strata's row becomes `vision: true`

Not part of the first build or its commit. The hub's live round step K5 runs three vision runs in a row; only if all three end `completed` and the user then says go, a worker does part B on a new branch `PAR-25_strata-vision` cut from the then master, one commit `PAR-25: Strata is the artist's vision model (seed and a migration)`. If K5 fails, part B is not done and the ticket records why.

- `seed/config/providers.md:137-141`, the `acp` row `strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`: add `vision: true` after `tools: false` (`:140`), with the comment `# sees the previews (creative-hub HUB-44 K5: three vision runs finished)`. The prose about vision models (`:284`, `:292`, and the Inkling comment `:158`) is checked for a sentence that says Pixel has no local vision model; such a sentence is changed to say Strata is the local vision model.
- `src/llm/seedMigration.ts`: a new migration modelled on `migrateAcpPort` (`:147-179`): `export const STRATA_VISION_MIGRATION = 'acp-strata-vision-v1'`; `migrateStrataVision(configDir)`: once (recorded in `seed-state.json` `migrations`), in `providers.md` provider `acp`, the `models` row whose `id` is exactly `strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` and that has no `vision` key gets `vision: true`; a row with any `vision` value (the user's choice), every other row and key stay; an unreadable `providers.md` is left with a warning and the migration is not recorded. Called in `src/llm/setup.ts` after `migrateAcpPort` (`:30`), with the same `.catch(() => undefined)`.
- Test: `tests/llm/customProviders.test.ts`, next to the `migrateAcpPort` case (`:265-273`), one `it`: the row without `vision` gets `vision: true` and the call returns `changed: ['providers.md']`; a second call changes nothing; a row with `vision: false` stays false. Fails before the migration exists.
- `ROADMAP.md`: append to the PAR-25 bullet "Part B (date): Strata row `vision: true` in the seed and by migration `acp-strata-vision-v1`."
- The live data folder `C:\Users\Infplane\PixelStudio` gets it from the migration at the next Pixel start after the hub's rebuild (no hand edit).

## Out of scope

- P-16 (steer the first step to a warm Strata slot): a design (hub plan, P-16 paragraph).
- P-18 (New chat aborts a running MCP run): unchanged, the director's default. P-19 (`before-quit` and the chat save): no change. P-20 (event buffer, extra Strata request): no change (hub triage).
- Any change to `guideText.ts` itself, to the MCP tool list (`pixel-studio://guide` and `tools/list` keep all tools), or to native mode.

## Tasks for workers

One worker for part A:
- Inputs: this plan; files `src/llm/agent.ts`, `src/main/appSettings.ts`, `src/main/llm.ts`, `src/main/agent.ts`, `README.md`, `ROADMAP.md`, `tests/llm/agent.test.ts`, `tests/main/agentLlm.test.ts`, `tests/main/agent.test.ts`.
- Order: A1 test (show it failing), A1 code; A2 tests (show them failing), A2 code, the measurement; A3; `yarn test`, `yarn typecheck`, `yarn lint`.
- Outputs: one commit on `PAR-25_repeat-guard-tool-set`; `.claude/tickets/PAR-25-repeat-guard-tool-set/changelog.md` with the failing-test output, the measured character counts, the test count, and every deviation from this plan.

Part B worker (later, only on the hub's go): inputs this plan's Part B and the hub's K5 record; outputs one commit on `PAR-25_strata-vision` and the changelog line.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| A-1 | a JSON-action step that ends on the same picture as the pixel-changing step before, or on a picture for the third time, ends the run `completed` with `REPEAT_STOP_TEXT`; progress, a picture equal to the start and `done: true` behave as before | the new agent test (failing first) and the existing result-check tests |
| A-2 | `agentToolSet` reads as `all` unless it is exactly `no-files` | the appSettings lines |
| A-3 | with `no-files` the agent gets no file tool and its system prompt says so; with `all` nothing changes | the AgentRunner test |
| A-4 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |
| B-1 | (part B) Strata's row is `vision: true` in the seed and, once, in an existing config | the migration test |

## UNTESTED

- The guard on a real run (hub K5); a loop whose steps differ by a pixel is not caught (the run can still reach `max_steps`).
- The `no-files` mode on a real run and its real token saving (hub K6).
- The Pixel window (no Electron run in this ticket).
- Part B until the hub's K5 and the user's go.

## Questions for the user

1. The `no-files` list is the 10 tools that open, save, import or export files (director's default, confirmed with the plan approval; the alternative was 13, adding `list_documents`, `select_document`, `close_document`).
