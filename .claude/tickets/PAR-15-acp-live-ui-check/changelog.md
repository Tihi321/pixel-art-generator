# Changelog PAR-15

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
