# Changelog PAR-14

## 2026-10-27 PAR-14: ACP proxy seed and custom OpenAI-compatible providers

Branch `PAR-14_acp-custom-providers` (from master). Committed locally, not pushed.

Files:
- `seed/config/providers.md`: `acp` provider, docs on `name`/`custom`, ACP and Add provider.
- `src/llm/config.ts`, `src/llm/registry.ts`: `name`, `custom` fields; `ModelRegistry.testEndpoint`.
- `src/llm/customProviders.ts` (new): add/edit/remove `custom: true` entries as a yaml round trip, reserved ids, key names.
- `src/llm/seedMigration.ts` (new), `src/llm/setup.ts`: copy seed providers a config folder lacks, once, tracked in `config/seed-state.json`.
- `src/main/llm.ts`, `src/main/agentIpc.ts`, `src/shared/agent.ts`, `src/renderer/lib/agentApi.ts`: save/remove/test custom provider (IPC), provider info gains name/custom/concurrency/jsonSchema; reload without restart.
- `src/renderer/components/ModelsTab.tsx`, `CustomProviderForm.tsx` (new): Add provider button, Edit/Remove, form with Test.
- `tests/llm/customProviders.test.ts` (new), `tests/main/agentLlm.test.ts`; `ROADMAP.md`.

Deviations: implemented directly by the orchestrator, no implementer child. Settings keys are not reached from a free-form "API key env" select: the form stores the key under `CUSTOM_<ID>_API_KEY` as in BTT-21. Providers tab (key rows) unchanged. No "discover" or model-list field in the form: models come from Detect models / Add by id in the same tab.

Verification: `vitest run` 516 passed (50 files); `tsc` node + web clean; `eslint .` clean; `yarn build` ok.
Not run: Electron/Playwright UI, live ACP proxy, the user's real config migration.
