# PAR-17 changelog

## 2026-11-04 PAR-17 (HUB-26 T5): Pixel Studio follows whichever model Strata runs

Branch `PAR-17_strata-model-discovery`. Committed on the branch, not merged or pushed.

### C1 rule -> file:line

| C1 rule | where |
|---|---|
| C1.1 schema: model `loaded`, `aliases`, `json_schema`; provider `profiles` | `src/llm/config.ts` (`providerModelSchema`, `providerProfileSchema`, `providerEntrySchema.profiles`) |
| C1.1 seed block (+ `tools: true`), docs text (T7) | `seed/config/providers.md` strata entry and "Strata" section |
| C1.2.1 loaded id L from `/status` `model` and `/v1/models` first entry without `alias_of`; empty/no answer keeps L | `src/llm/registry.ts` `syncServerSlots` (:515-530), `discover` (:385-390), `setServed` (:318); `src/llm/openaiCompat.ts` `aliasOf`, `nCtx` |
| C1.2.2 profile K (exact, else longest prefix) | `registry.ts` `findProfile` (:604) |
| C1.2.3 servedId, family, context, jsonSchema, extraBody, tools, vision; L unknown = row values | `registry.ts` `applyServed` (:300) |
| C1.2.4 `-low` is just another loaded row | seed rows; no code |
| C1.2.5 aliases `strata`, `strata-low` | `seed/config/roles.md` |
| C1.2.6 legacy refs via row `aliases`, not listed | `registry.ts` `legacyRefs` (:154, :276), `resolve` (:594) |
| C1.2.7 discovery adds no models; picked skipped; `dropMissing` exempts loaded rows; catalog of such a provider is empty | `registry.ts` :253, :291, :490 |
| C1.2.8 switch re-applies in place, `syncServerSlots` returns `{ slots, served }`, logged | `registry.ts` `setServed`; `src/main/llm.ts` `logServed` (`console.info`) |
| C1.2.9 Strata down keeps L | `registry.ts` (`setServed` only on an answer); concurrency drops to 1 as before |
| C1.2.10 display `served`, label `Strata: <L>[, thinking low]` | `src/shared/agent.ts`, `src/main/llm.ts` `modelLabel`/`modelInfo`, `ChatPanel.tsx`, `ModelsTab.tsx` |
| C1.2.11 per-model json_schema | `src/llm/types.ts` `ChatRequest.jsonSchema`, `router.ts:128`, `openaiCompat.ts:141` |
| C1.3 neutral refs | `seed/config/roles.md` |
| C1.4 migration `strata-loaded-v1` (providers block, roles/models/app.json renames, recorded in `seed-state.json` `migrations`) | `src/llm/seedMigration.ts` `migrateStrataLoaded` (:181); called from `src/llm/setup.ts` |

### Deviations
- Pixel Studio has no "provider down" state (plan AC-1 / rule 9 assume the engine family's): Strata down keeps L and its settings, concurrency becomes 1, the provider is not flagged and the UI shows no `not running (last: L)` text.
- No engine event exists here; a served change is logged with `console.info` and shows in the next overview (the chat refreshes models when its picker opens).
- `syncServerSlots` now also runs for a non-`auto` provider that has loaded rows (it only reads `model` then).
- Label capitalizes the provider id (`strata` -> `Strata`) since the seed has no `name`.
- `tests/llm/registry.test.ts:76` expectation changed from the old ref to `strata/default-low` (the old ref now resolves to the loaded row; that is the legacy-alias behaviour).
- Second small migration test (strata provider deleted) beside the main AC-3 test.

### Verification
- `tsc --noEmit` node and web projects: clean. `vitest run`: 50 files, 530 tests passed (3 new).
- Not run: the Electron app, a real Strata, a model switch live (HUB-26 L4/L5); `yarn test:electron`.
