# PAR-14 ACP proxy and custom OpenAI-compatible providers

Branch `PAR-14_acp-custom-providers` from master. References (read only): Scriptorium SCP-44, Book Translator BTT-21 (`migrate.ts`, `CustomProviderForm.tsx`), VN Studio `models/customProviders.ts`.

## Goal
Pixel Studio can use the ACP proxy (`http://127.0.0.1:7461/v1`, ids like `codex/gpt-5.6-luna`) and the user can add / edit / remove OpenAI-compatible providers in Settings, saved to `config/providers.md`.

## Design
1. Seed `acp` provider in `seed/config/providers.md` (openai-compat, enabled false, local true, base_url, concurrency 2, json_schema false, discover true, models []) + docs note in the body.
2. `src/llm/customProviders.ts` (pure, no Electron): `RESERVED_PROVIDER_IDS` (all seed ids incl. `acp`, `mock`), `slugOf`, `keyNameOf` (`CUSTOM_<ID>_API_KEY`), `checkBaseUrl`, `upsertCustomProvider(text, input)`, `removeCustomProviderEntry(text, id)`. Uses the `yaml` document round trip so comments and hand edits survive; only entries with `custom: true` are touched; new entries go before `mock`; result is validated with `providersSchema`.
3. `src/llm/seedMigration.ts`: `migrateProviders(configDir, seedDir, {fresh})`. Copies seed providers a newer seed has into an existing providers.md as text, once each, before `mock`; `config/seed-state.json` records the ids the seed has offered, so a deleted one is not re-added and a user edit is never overwritten. No state file = legacy: offered = legacy seed ids + the ids already in the file. Invalid result: left alone with a warning. Called from `createLlm` after `ensureConfigDir`.
4. Schema/registry: `name`, `custom` on `providerEntrySchema`; `ProviderInfo.name/custom/jsonSchema` etc. exposed.
5. `LlmService` (main): `saveCustomProvider`, `removeCustomProvider` (also drops the stored key, models.md refs, and a selectedModel on it), `testCustomProvider` (GET /models). IPC channels `llm:saveCustomProvider|removeCustomProvider|testCustomProvider`, `llmApi` wrappers, `LlmProviderInfo` gains `name`, `custom`, `concurrency`, `concurrencyAuto`, `jsonSchema`. Save = write file, `registry.load()`, discover + slots: no restart.
6. UI: Settings > Models gets "+ Add provider" under the provider list, Edit / Remove on custom providers, `CustomProviderForm` (name, base URL, API key, free/local, send JSON schema, parallel/auto, enabled, Test). Providers tab shows the provider name. Model list for a provider comes from Detect models (/v1/models), model ids with slashes work.
7. Discovery for acp: covered by a test with a fake `/v1/models` returning `codex/gpt-5.6-luna` and `antigravity/gemini-3.8-flash` (ref `acp/codex/gpt-5.6-luna`).
8. Docs: ROADMAP.md PAR-14 row, providers.md body (custom providers + ACP notes).

## Tests
`tests/llm/customProviders.test.ts`, `tests/llm/seedMigration.test.ts`, additions to `tests/main/agentLlm.test.ts` (save/remove/test, reload without restart, reserved ids, acp discovery). Run `yarn test`, `yarn typecheck`, `yarn build`.

## Out of scope
Editing the live `~/PixelStudio/config`; live check against the real proxy; pushing/PR.
