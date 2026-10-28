# PAR-15 ACP live UI check

Goal: Pixel Studio passes fully on the ACP proxy through the real Electron app (settings form + agent chat loop), plus fixes.

## Part A
1. Serialize providers.md read-modify-write in `LlmService.saveCustomProvider` / `removeCustomProvider` (`src/main/llm.ts`) with an in-process queue. Test in `tests/main/agentLlm.test.ts` (done).
2. Fix anything else found in the PAR-14 code during Part B.

## Part B
- Wait for proxy `GET /v1/models` to list only prefixed ids (poll 30 s, max 30 min). Do not start/stop the proxy.
- Back up `~/PixelStudio/config` to `config.bak-par15`; the spec runs on an isolated home seeded with a COPY of the real config (also exercises the real config migration), so the real folder is never written. Diff at the end.
- `tests/e2e/acp-live.spec.ts`, skipped unless `ACP_LIVE=1`: (a) Settings > Models shows `acp` and its models, no unprefixed duplicates; (b) add custom provider `acp-e2e` via the form, Test, Detect models, Remove; (c) agent chat with `acp/codex/gpt-5.6-luna` then `acp/antigravity/gemini-3.8-flash`: "draw a 16x16 red heart sprite", assert canvas change and no error.
- At most ~6 LLM runs. Agent failures: root-cause in code, unit test, rerun.
- Verify: vitest, typecheck, lint, build. ROADMAP.md PAR-15. Commit locally, no push.
