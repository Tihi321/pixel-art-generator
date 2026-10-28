# Changelog PAR-15

## Follow-up 2: failed-last-action guard

- `src/llm/agent.ts` JSON-action mode: `MAX_ERROR_NUDGES = 2`, `errorNudges`, `lastError` (null after a later success). When the model ends the turn (empty actions, or done: true) while its last action failed, it gets `Your last action failed and nothing after it succeeded:
<error>...` instead of the turn ending. Unit-tested (fires, not after a later success, capped). Existing test adjusted (its last action no longer fails).
- Spec: a failed call that the agent later corrected is fine, only a failing LAST call or an empty canvas fails; diagnostics when a model option is missing.
- Live `ACP_REPEAT=3`: codex 3/3, gemini 3/3 (once codex 2/3: a corrected-then-empty canvas; twice the gemini option was missing from the chat list right after a failed codex test, cause not found).

## Follow-up (checker): tighter refusal regex, ACP_REPEAT

- `NO_TOOLS_REFUSAL` now matches explicit refusals only (can't/cannot/unable to use|call|run tools, disallows tool, text-only, without using tools); unit test for matches and non-matches.
- Spec: `ACP_REPEAT=N` per model, failures collected with causes; settings closed after step a; tests no longer serial so a codex failure does not skip gemini; prompt ends "tell me when it is finished" (the model once took "say done" literally).
- Live `ACP_REPEAT=3`: codex 3/3 (10-20 s), gemini 2/3 (57-94 s; run 3: a draw_grid call failed, model claimed success). Earlier unrecorded try with the old prompt: codex 1/3 (one literal "done", one failed tool).

## 2026-10-27 PAR-15: ACP live UI check and fixes

Branch `PAR-15_acp-live-ui-check` (from master). Implemented directly by the orchestrator (no implementer child). Committed locally, not pushed.

Files:
- `src/main/llm.ts`: providers.md save/remove serialized through an in-process queue.
- `src/llm/agent.ts`: JSON-action prompt says the actions run in the app, not the model's host; a first-step "can't use tools / text-only" refusal is answered with up to two nudges.
- `src/llm/json.ts`: two repair retries instead of one, with a hint to escape strings.
- `tests/e2e/acp-live.spec.ts` (new, `ACP_LIVE=1`), `tests/e2e/launch.ts` (`seedConfigFrom`): live spec on an isolated home seeded with a copy of the real config.
- `tests/main/agentLlm.test.ts`, `tests/llm/agent.test.ts`: tests for the lock, the nudge, the two repairs. `ROADMAP.md`.

Live results (proxy 7461, prefixed ids only): a) 0.4-1.2 s, b) 0.5-0.7 s, c) codex 7-14 s, gemini 25-60 s per run. Before the fixes codex failed 3 of 5 runs (valid JSON saying "I can't use tools in this text-only request"). After: codex 4/4, gemini 6/6.

Verification: vitest 519 passed, tsc, eslint, build ok. ~/PixelStudio/config unchanged (diff -r against config.bak-par15 identical).
Not verified: the real config folder was never opened by the app (a copy was); keyring-stored key path; claude/anthropic models on the proxy; more than ~14 agent runs of reliability.

## Open follow-ups

- Agent run can end with a successful last call but an empty canvas: needs a result check (the failed-last-action guard does not catch it).
- Gemini model option sometimes missing from the chat model list right after a failed codex run (cause unknown; the spec logs options).
