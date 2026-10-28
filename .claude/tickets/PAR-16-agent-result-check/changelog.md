# PAR-16 changelog

## 2026-10-28 - agent result check, missing gemini option explained
Branch `PAR-16_agent-result-check` (pixel-art-generator), committed locally, not pushed.

- `src/llm/agent.ts`: `MAX_RESULT_NUDGES = 2`, `resultNudges`, `resultRetry()`. JSON-action mode snapshots `host.fingerprint()` at the start; if the model ends the turn (empty actions or done:true) after a mutating action and the fingerprint is unchanged, it gets a corrective message. Error guard (`errorRetry`) first. Off without `fingerprint`/`mutates` on the host, for Q&A runs and when the document changed. `NO_TOOLS_REFUSAL` also matches "tool use was disabled" and "not to use tools".
- `src/shared/tools.ts`, `src/llm/agent.ts`: optional `ToolHost.mutates` and `ToolHost.fingerprint`.
- `src/tools/defs/reading.ts`, `src/tools/registry.ts`: internal tool `canvas_fingerprint` (FNV hash of document structure and every cel, plus `empty`), hidden from `defs()`; `isMutatingTool`.
- `src/main/toolBridge.ts`, `src/main/agent.ts`: bridge implements both; `withAutoPreview` passes them on.
- `tests/e2e/acp-live.spec.ts`: ticks its two chat models in `beforeAll` (root cause of the missing option), focuses the select before waiting for the option.
- Tests: `tests/llm/agent.test.ts` (fires on unchanged, not on Q&A / changed / no fingerprint / read-only action, cap, precedence), `tests/tools/registry.test.ts` (fingerprint, hidden tool).
- Deviation: a registry-side "keep last known list" hardening was written and then reverted: evidence showed the cause was the test harness, and the proxy list was stable (polled 57 times around runs).
- Verified: vitest 526 pass, tsc node+web, eslint, build. Live `ACP_REPEAT=3`: codex 3/3, gemini 3/3.
- Not verified: native tool-calling mode has no result check.
