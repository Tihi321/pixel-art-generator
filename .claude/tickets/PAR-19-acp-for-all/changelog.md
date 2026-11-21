# PAR-19 changelog

## 2026-11-21 - PAR-19 ACP for all: artist and palette on LOCAL through the ACP proxy (uncommitted)

Repo pixel-art-generator, branch `PAR-19_acp-for-all` (from master).

Files and behaviour:
- `seed/config/providers.md`: acp on, `http://127.0.0.1:8787/v1`, concurrency 4, `discover_skip`, six local rows (strata LOCAL, gufo x3, llama x2), all `tools: false`; `strata` `enabled: false` (rows, `loaded`, profiles kept); `lmstudio` unchanged; prose for acp rewritten (no `PROXY_IGNORE_SAMPLING`, JSON-action mode, one GPU model at a time, LM Studio for vision rows).
- `seed/config/roles.md`: alias `local` = LOCAL, `lmstudio` kept, `strata`/`strata-low` removed; `artist` and `palette` = `[local]`; prose updated.
- `src/llm/seedMigration.ts` + `src/llm/setup.ts`: `migrateAcpPort` (`acp-port-8787-v1`), run after `migrateStrataLoaded`; rewrites only the exact `7461` base_url of the `acp` row, records itself in `seed-state.json` `migrations`; an unparseable providers.md is left alone with a warning and not recorded.
- `src/llm/customProviders.ts`, `src/renderer/components/CustomProviderForm.tsx`: example address 8787.
- `tests/e2e/acp-live.spec.ts`: port 8787; the spec lists models, so LOCAL was added to `CHAT_MODELS` / the ticked ids and the prefix regex (not run: `ACP_LIVE` gated).
- `tests/llm/customProviders.test.ts`: seed-acp test (on, 8787, six rows `tools: false`, strata off, roles resolve to `local`); new table-ish test for `acp-port-8787-v1` (7461 rewritten, once, 9999 kept); migration tests adapted to the new seed (acp now has rows, enabled).
- `tests/llm/registry.test.ts`, `tests/main/agentLlm.test.ts`: defaults now LOCAL (tools false, no vision); strata off; `requireTools` leaves only the cloud model; acp row assertions (4, enabled). Removed the old-strata-ref-resolves assertion (strata is off; ref rename itself still tested in registry.test.ts strata block and the strata-loaded-v1 test).

Read and confirm (plan task 5): `migrateProviders` only appends providers absent from both the file and `seed-state.json` offered ids; it never edits an existing provider's `enabled` or touches roles.md, so `strata` is not re-enabled and removed aliases are not re-added (existing folders keep their roles.md until the hub's HUB-38 L5). `STRATA_RENAMES` and `migrateStrataLoaded` untouched. Note: `migrateStrataLoaded` still rewrites `strata/qwen3.8-flash-next` refs in an old roles.md on its one run: unchanged.

Docs (task 6): `docs/llm-guide.md` and `README.md` do not name LM Studio/Strata as the agent's model (grep found no match; CLAUDE.md does not exist in the repo): no change. `ROADMAP.md`: PAR-19 row added above PAR-18.

A2: the JSON-action choice follows `tools: false` (`src/llm/agent.ts:203-218`, native only when the first candidate has tools); covered by the registry test asserting LOCAL `tools: false` and that `requireTools` excludes it; no extra test.

Deviations: none from the plan beyond adding LOCAL to the live spec (plan allowed it since the spec lists models).

Verification (fnm default alias dir on PATH): `yarn test` 50 files, 531 tests passed; `yarn typecheck` no errors; `yarn build` built. Not run: live e2e (`ACP_LIVE=1`), live artist request on LOCAL, proxy log check for 400 `model_not_capable` (UNTESTED, GPU and user go-ahead needed).

Commit status: uncommitted.
