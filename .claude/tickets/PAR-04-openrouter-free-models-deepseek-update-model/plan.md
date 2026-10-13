# PAR-04: OpenRouter free models, DeepSeek update, model picker (ported from scriptorium)

Ticket folder: `.claude/tickets/PAR-04-openrouter-free-models-deepseek-update-model/`. Branch: `PAR-04_openrouter_model_picker` (created from `origin/master` @ 9d681dc).

## Context

Pixel Studio's LLM layer (`src/llm/`) was copied from scriptorium (`C:\projects\Personal\scriptorium\src\engine\models\`). Since then scriptorium gained:
- OpenRouter `discover: free` (lists OpenRouter's price-0 models, with context/price from `/api/v1/models`),
- DeepSeek `json_schema: false` (DeepSeek answers `response_format: json_schema` with HTTP 400),
- a Models dialog where you tick which models appear in the model dropdowns (`config/models.md`).

Goal: in Pixel Studio, pick OpenRouter free models, chosen LM Studio models, DeepSeek etc. from one place and have only those in the chat's model dropdown.

Decisions (from the user):
- **Not ported:** scriptorium's fallback-order / alias-default UI, per-provider limits UI, rpd/daily-quota logic, LM Studio parallel controls. Pixel's existing router fallback (`router.ts`, `roles.md`) stays as is.
- **Opt-in dropdown:** models listed in `providers.md` show by default (untick = hide); *discovered* models (OpenRouter free list, LM Studio models not in providers.md) only show once ticked.
- **Live config:** also patch `~/PixelStudio/config/providers.md` (DeepSeek + OpenRouter blocks only); `models.md` reaches it automatically because `ensureConfigDir` copies missing seed files.

## Changes

### 1. Config schema — `src/llm/config.ts`
- `providerEntrySchema.discover`: `z.union([z.boolean(), z.literal('free')]).default(false)`.
- Add `discover_skip: z.array(z.string()).default([])` (case-insensitive substring filter on ids).
- New `modelsSchema` (`kind: models`), file `config/models.md`:
  ```yaml
  kind: models
  shown: []    # discovered refs ticked into the dropdown
  hidden: []   # providers.md refs unticked out of the dropdown
  picked: []   # {provider, id, family, context?, max_output?, price_in, price_out, price_cached_in?, tools?, vision?}: models added from a catalog or by id
  ```
- Export from `src/llm/index.ts`.

### 2. OpenAI-compat client — `src/llm/openaiCompat.ts`
- Port scriptorium's `listModelInfo()` / `ListedModel` / `listedModel()` (scriptorium `openaiCompat.ts:208-250`), plus two Pixel-specific fields from OpenRouter's entry:
  - `tools`: `supported_parameters` includes `'tools'` (undefined when the field is absent),
  - `vision`: `architecture.input_modalities` includes `'image'`.
  `listModels()` becomes `listModelInfo().map(m => m.id)`. Timeout 15 s (OpenRouter's list is large).
- OpenRouter attribution: optional `extraHeaders` option merged into `headers()`; registry sets `HTTP-Referer: https://github.com/Tihi321/pixel-art-generator` and `X-Title: Pixel Studio` when the base URL host is `openrouter.ai`.
- **DeepSeek thinking + tools:** accumulate `delta.reasoning_content` (DeepSeek) / `delta.reasoning` (OpenRouter) during the stream; attach it as `providerMeta: { reasoningContent }` on the first emitted `tool_call` (the existing providerMeta path in `types.ts:135` / `router.ts:175` already carries it into the assistant message). In `toOpenAiMessages`, set `reasoning_content` on an assistant message whose tool call carries it. Needed so `deepseek-v4-pro` (thinking on) doesn't 400 mid tool loop. Text output stays unchanged (reasoning is not shown).

### 3. Registry — `src/llm/registry.ts`
- `CONFIG_FILES` += `'models.md'`; `load()` reads it (missing file = empty choices, so old setups and tests keep working).
- `ModelInfo` gains `source: 'config' | 'discovered' | 'picked'` and `shown: boolean`:
  - config → `!hidden.has(ref)`; discovered/picked → `shown.has(ref)` (picked models are added with `shown` set on pick, so effectively shown).
  - `picked` entries are added in `load()` unless providers.md already lists the ref (providers.md wins).
- `discover()`:
  - `discover: true` (LM Studio, Ollama): as today, but take `tools`/`vision` from `ListedModel` when LM Studio's info lacks it; apply `discover_skip`.
  - `discover: 'free'` (OpenRouter): add only text-only models with price 0/0 (scriptorium rule), `tools`/`vision`/`context` from the listing, family via `guessFamily`.
  - `dropMissing` only for `discover === true` (a `free` provider never drops its configured/picked paid models).
- New `catalog(providerId, signal)`: full `listModelInfo()` of an openai-compat provider (text-only, no `/embed/i`, no `discover_skip`), cached in a `Map` on the registry so a later pick knows the price.
- `guessFamily`: when no keyword matches, use the maker prefix before `/` (scriptorium `registry.ts:492-499`).
- `listModels()` unchanged (router/`resolveModel` still see every model, hidden or not).

### 4. Model choices service — new `src/llm/modelChoices.ts` (no Electron)
Port of scriptorium `engine.ts:367-425` without fallback/limits:
- `readModelChoices(configDir)`, `editModelChoices(configDir, fn)` (read → mutate → `serializeMd` → write, keeping the body text).
- `showModels(registry, refs, shown)`:
  - untick: drop from `picked`/`shown`; config refs go into `hidden`.
  - tick: drop from `hidden`; discovered → into `shown`; catalog-only → into `picked` with listed price/context/tools/vision; a paid catalog model with no listed price is refused.
- `addModel({provider, id, priceIn, priceOut, context, tools, vision})`: non-local needs both prices (for DeepSeek models not in providers.md, OpenRouter paid models).
After each edit `LlmService` calls `registry.load()` so the overview updates.

### 5. Main process + IPC
- `src/shared/agent.ts`:
  - `LlmModelInfo` += `shown`, `source`, `context?`, `free?` (local or price 0).
  - `LlmProviderInfo` += `canList` (openai-compat), `discover: boolean | 'free'`.
  - New `LlmCatalogModel { id, ref, context?, priceIn?, priceOut?, tools?, vision?, pickable }`.
  - `LLM_IPC` += `catalog`, `showModels`, `addModel`.
- `src/main/llm.ts`: `modelInfo()` fills the new fields; add `catalog(provider)`, `showModels(refs, shown)`, `addModel(...)` returning a fresh `LlmOverview`. Keep the `refreshing` de-dup pattern for catalog calls.
- `src/main/agentIpc.ts`, `src/preload`, `src/renderer/lib/agentApi.ts`: wire the three channels like the existing `setKey`/`reload` ones.

### 6. UI
- **Settings → new "Models" tab** (`src/renderer/components/SettingsDialog.tsx`, new `ModelsTab` in its own file `ModelsTab.tsx`). Trimmed port of scriptorium `ModelsDialog.tsx` (skip l.39-45, 155-253 and the limits/LM Studio load rows):
  - Provider list on the left with "N ticked" or the short unavailable reason ("no key", "off").
  - Right pane: filter box, **Detect models** (calls `catalog`), "free only" and "ticked only" checkboxes, Tick all / Untick all for the filtered rows.
  - Rows: checkbox, id, context (`128k`, `1M`), price (`free` / `local` / `$in / $out` / `no price`), tools/vision badges (reuse `Badges` from `ChatPanel.tsx`), source. A paid row without a price is disabled.
  - "Add by id" row: id, $ in, $ out, context.
  - "No key: store it in the Providers tab" hint when a provider lacks a key.
- **Chat dropdown** (`src/renderer/components/ChatPanel.tsx:136-154`): only `shown` models plus the currently selected ref (scriptorium `roles.ts:24-28` `modelOptions`), grouped by provider with `<optgroup>`, label = model id. Add a small "Models…" button next to it that opens Settings on the Models tab (Settings dialog gets an optional initial tab).
- State: `src/renderer/state/chat.ts` keeps holding `LlmOverview`; add `catalogs: Record<provider, {models, error?, loading}>` and actions `detect`, `showModels`, `addModel`.

### 7. Config files
- `seed/config/providers.md`:
  - DeepSeek: add `json_schema: false  # DeepSeek answers response_format json_schema with HTTP 400 (checked 2026-10-12)`; comments `deepseek-flash` = DeepSeek-V4.1-Flash, `deepseek-v4-pro` = V4-Pro (ids/prices already match scriptorium's 2026-10-11 update). Keep `tools: true`.
  - OpenRouter: `rpm: 20`, `discover: free`, `discover_skip: [content-safety]`, `json_schema: false`; keep the two example paid models.
  - Docs body: describe `discover: free`, `discover_skip`, `models.md` and the Models tab.
- New `seed/config/models.md` (empty lists + short doc body).
- Patch the user's `~/PixelStudio/config/providers.md` DeepSeek and OpenRouter blocks the same way (only those blocks).

### 8. Tests (vitest, follow existing fake-server style in `tests/llm/clients.test.ts`)
- `clients.test.ts`: `listModelInfo` parsing an OpenRouter-shaped `/models` (prices per token → per 1M, negative = no price, `supported_parameters`, modalities); OpenRouter headers; `reasoning_content` round-trip into `toOpenAiMessages`.
- `registry.test.ts`: seed loads with `models.md`; `discover: free` keeps only free text models and keeps configured paid ones; `discover_skip`; opt-in `shown` logic; picked models loaded; update DeepSeek expectations (`jsonSchema false`).
- New `tests/llm/modelChoices.test.ts`: tick/untick/add round-trips through a temp config dir.
- `tests/main/agentLlm.test.ts`: overview exposes `shown/source`; `showModels` persists.
- `tests/e2e/smoke.spec.ts`: Settings shows a Models tab.

## Verification
1. `yarn typecheck && yarn lint && yarn test`.
2. `yarn dev`, store an `OPENROUTER_API_KEY` in Settings → Providers.
3. Settings → Models → OpenRouter → Detect models: free models list with context/`free`; tick two → they appear in the chat dropdown under an "openrouter" group; untick → gone.
4. LM Studio running: Models → lmstudio shows installed models; tick one not in providers.md → appears in dropdown; send a chat message and confirm it loads and answers.
5. Select `deepseek/deepseek-v4-pro`, ask the agent to draw something (tool calls with thinking on) — no HTTP 400; `deepseek-flash` still works.
6. Restart the app: ticks persist (`~/PixelStudio/config/models.md`).
7. `yarn test:electron` for the smoke spec.

## Implementation status

Backend (sections 1-5, 7, 8; UI section 6 and the e2e smoke spec are not part of this slice).

- [x] 1. Config schema: `discover: boolean | 'free'`, `discover_skip`, `modelsSchema`, exported from `src/llm/index.ts`.
- [x] 2. OpenAI-compat client: `listModelInfo`/`ListedModel` (+ `tools`, `vision`), `extraHeaders`, 15 s list timeout, reasoning round-trip via tool-call `providerMeta.reasoningContent` -> `reasoning_content`. Gemini now spreads only a string `thoughtSignature` of `providerMeta`.
- [x] 3. Registry: `models.md` in `CONFIG_FILES` (missing file tolerated by `load()`), `source`/`shown` on `ModelInfo`, picked models, `discover: free`, `discover_skip`, `dropMissing` only for `discover === true`, `catalog()` + `listedModels()`, OpenRouter attribution headers, `guessFamily` maker prefix.
- [x] 4. `src/llm/modelChoices.ts`: `readModelChoices`, `editModelChoices`, `showModels` (returns refusal messages), `addModel` (throws on a bad command).
- [x] 5. Shared types, `LLM_IPC.catalog/showModels/addModel`, `LlmService.catalog/showModels/addModel`, `agentIpc.ts` handlers, `agentApi.ts` wrappers. `src/preload` needed no change (generic `invoke`).
- [x] 7. `seed/config/providers.md` (DeepSeek, OpenRouter, docs body), new `seed/config/models.md`, live `~/PixelStudio/config/providers.md` (DeepSeek + OpenRouter blocks only; it was identical to the old seed).
- [x] 8. Tests: `tests/llm/clients.test.ts`, `tests/llm/registry.test.ts`, new `tests/llm/modelChoices.test.ts`, `tests/main/agentLlm.test.ts`. (`tests/e2e/smoke.spec.ts` left for the UI step.)

Verification: `yarn typecheck` clean, `yarn lint` clean, `yarn test` 35 files / 335 tests passed.

Deviations:
- `showModels` refusals (paid model without a listed price, not yet detected, unknown provider) come back in `LlmOverview.error` of the fresh overview, joined by newlines; `addModel` rejects instead.
- Picked models are always `shown: true` (not looked up in `shown`), as the opt-in rule says picked models are shown; untick removes them.
- `discover: free` also removes previously discovered free models that OpenRouter no longer lists.
- `discover_skip` also applies to `discover: true` providers (and `catalog`).
- Seed docs body of providers.md gained a "Which models the chat offers" section; the live file only got the two provider blocks.

### UI (section 6) + e2e (section 8)

- [x] 6. `ModelsTab.tsx` (new), `Badges.tsx` (moved out of ChatPanel), `SettingsDialog.tsx` third tab "Models" opening on `ui.settingsTab` (`useUi.openSettings(tab)`; `openDialog('settings')` resets it to providers), `ChatPanel.tsx` dropdown via `state/modelOptions.ts` (shown + selected, `<optgroup>` per provider, option text = id) and a "Models..." button (`chat-models-settings`), `state/chat.ts` `catalogs` + `detect`/`showModels`/`addModel`, CSS appended to `styles.css`.
- [x] 8 (e2e). `tests/e2e/smoke.spec.ts` Settings test opens the Models tab and checks `settings-models`. New `tests/renderer/modelOptions.test.ts` (3 tests).

Verification: `yarn typecheck` clean, `yarn lint` clean, `yarn test` 338 passed, `yarn test:electron` 7 passed.

Deviations: `Badges` takes `Pick<LlmModelInfo,'tools'|'vision'|'local'>` plus a `compact` flag (no local/remote badge in rows). The "Models..." button sits beside the badges row under the select, not beside the select. `showModels` store action reports errors in `overviewError`; `addModel` rejects and ModelsTab shows the message. Not exercised manually: Detect/tick against a real provider.

### Correction (user): every model is opt-in

The chat dropdown shows ONLY ticked models; providers.md models are no longer shown by default.
- [x] `registry.load()`: config models get `shown: shown.has(ref)`; picked stay always shown; discovered unchanged. `ModelInfo.shown` JSDoc updated.
- [x] `modelChoices.ts`: `hidden` is no longer used or written (an old `hidden` key is read tolerantly by `modelsSchema` and dropped on the next write). Untick removes the ref from `picked` and `shown`; tick adds any known (config/discovered) model to `shown`, otherwise picks it from the catalog; `addModel` on a known model adds it to `shown`. `MODELS_MD_BODY` rewritten.
- [x] `config.ts` schema comments, `seed/config/models.md` (no `hidden`), `seed/config/providers.md` docs body updated. `~/PixelStudio/config/providers.md` not touched.
- [x] `ModelsTab.tsx` wording checked: nothing says providers.md models are shown by default, no change needed.
- [x] Tests updated: `tests/llm/registry.test.ts`, `tests/llm/modelChoices.test.ts`, `tests/main/agentLlm.test.ts` (`tests/renderer/modelOptions.test.ts` unaffected).
- Verification: `yarn typecheck` clean, `yarn lint` clean, `yarn test` 338 passed, `yarn test:electron` 7 passed.
