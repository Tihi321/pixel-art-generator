# Changelog

## 2026-10-13: PAR-04 correction, every model is opt-in

The user saw every providers.md model in the dropdown and asked that only picked models appear.

- **`src/llm/registry.ts`:** providers.md models are now shown only when ticked (`shown` in models.md). Picked models are still always shown.
- **`src/llm/modelChoices.ts`:**
  - Ticking adds a known model (from providers.md or discovered) to `shown`.
  - Unticking removes it from `shown` and `picked`.
  - `hidden` is no longer written, and an old `hidden` key is dropped on the next write.
- **`src/llm/config.ts`:** `hidden` stays in the models.md schema only so old files still parse.
- **Docs:** `seed/config/models.md` and the `seed/config/providers.md` docs body now say every model is opt-in. The live `~/PixelStudio/config/providers.md` is unchanged.
- **Tests:** `tests/llm/registry.test.ts`, `tests/llm/modelChoices.test.ts` and `tests/main/agentLlm.test.ts` are updated.

The dropdown always keeps the "Default (...)" option, which resolves through `roles.md`, and the currently selected model.

**Verification:**
- `yarn typecheck`: OK.
- `yarn lint`: OK.
- `yarn test`: 338 passed. The orchestrator re-ran this.
- `yarn test:electron`: 7 passed. The implementer ran this.

**Commit status:** uncommitted.

## 2026-10-13 — PAR-04: OpenRouter free models, DeepSeek update, Models picker

The chat model dropdown now shows only the models you pick in Settings > Models. Free OpenRouter models are listed automatically, LM Studio models can be ticked, and DeepSeek works with thinking plus tools. Nothing is committed yet.

**Repo:** pixel-art-generator. **Branch:** `PAR-04_openrouter_model_picker`, cut from `origin/master` @ 9d681dc.

### Files changed

#### Provider config and client
- **`src/llm/config.ts`**
  - `discover` accepts `true | false | 'free'`.
  - New `discover_skip`.
  - New `modelsSchema` for `config/models.md`, with `shown`, `hidden` and `picked`.
- **`src/llm/openaiCompat.ts`**
  - `listModelInfo()` reads each model's context, max output, price per 1M tokens, text-only flag, and tool and vision support. Tool support comes from `supported_parameters`; vision comes from `input_modalities`.
  - New `extraHeaders` option.
  - DeepSeek's `reasoning_content` (or OpenRouter's `reasoning`) is collected. It is attached to the first tool call's `providerMeta` and sent back as `reasoning_content` on that assistant turn.
- **`src/llm/gemini.ts`:** only a string `thoughtSignature` is taken from `providerMeta`. Another provider's meta can't leak into Gemini requests after a fallback.

#### Registry, model choices and IPC
- **`src/llm/registry.ts`**
  - `models.md` is a seed config file. A missing file means no choices.
  - `ModelInfo` gains `source` and `shown`. Models from `providers.md` are shown unless `hidden`; discovered ones only when ticked; picked ones always.
  - Picked models are loaded.
  - `discover: 'free'` adds OpenRouter's price-0 text models. It never drops configured models, and it drops discovered models OpenRouter no longer lists.
  - New `catalog()` and `listedModels()`.
  - OpenRouter attribution headers.
  - `guessFamily` falls back to the maker prefix.
- **`src/llm/modelChoices.ts`** (new): reads and edits `models.md`, plus `showModels` and `addModel`. A paid model with no price is refused.
- **`src/llm/index.ts`:** exports the new pieces.
- **`src/shared/agent.ts`, `src/main/llm.ts`, `src/main/agentIpc.ts`, `src/renderer/lib/agentApi.ts`:**
  - New fields on `LlmModelInfo` and `LlmProviderInfo`.
  - New types `LlmCatalogModel`, `LlmCatalog` and `LlmAddModel`.
  - New IPC calls `llm:catalog`, `llm:showModels` and `llm:addModel`. Concurrent catalog requests for one provider share a single fetch.

#### UI
- **`src/renderer/components/ModelsTab.tsx`** (new): the Settings > Models tab.
  - Provider list with a count of ticked models.
  - Filter box and a Detect models button.
  - "free only" and "ticked only" filters, and Tick all / Untick all.
  - Rows show context, price, tool and vision badges, and source.
  - Add-by-id form.
  - Hints for a missing key and for refused ticks.
- **`src/renderer/components/Badges.tsx`** (new): `Badges`, moved out of ChatPanel and reusable.
- **`src/renderer/components/SettingsDialog.tsx`:** third tab "Models", opened on the tab the UI store asks for.
- **`src/renderer/components/ChatPanel.tsx`:** the dropdown shows ticked models plus the selected one, grouped by provider with `<optgroup>`. A "Models..." button opens Settings on the Models tab.
- **`src/renderer/state/chat.ts`:** `catalogs`, plus `detect`, `showModels` and `addModel`.
- **`src/renderer/state/ui.ts`:** `settingsTab` and `openSettings(tab)`.
- **`src/renderer/state/modelOptions.ts`** (new): pure grouping function for the dropdown.
- **`src/renderer/styles.css`:** Models tab styles and the chat model row.

#### Config
- **`seed/config/providers.md`**
  - DeepSeek: `json_schema: false`, and comments naming the models.
  - OpenRouter: `rpm: 20`, `discover: free`, `discover_skip: [content-safety]`, `json_schema: false`.
  - The docs body is extended.
- **`seed/config/models.md`** (new): empty lists and a short explanation.
- **`~/PixelStudio/config/providers.md`** (outside the repo): only the DeepSeek and OpenRouter blocks were patched, with the same edits as the seed. The app creates `models.md` on start.

#### Tests
- `tests/llm/clients.test.ts`, `tests/llm/registry.test.ts` and `tests/main/agentLlm.test.ts` updated.
- `tests/llm/modelChoices.test.ts` and `tests/renderer/modelOptions.test.ts` added.
- `tests/e2e/smoke.spec.ts` now opens the Models tab.

### Deviations from the plan
- A refused tick comes back in `overview.error` (shown in the tab) instead of rejecting the call.
- Picked models are always shown; there is no lookup in `shown`.
- `discover: free` also removes stale free models.
- `discover_skip` applies to `discover: true` providers and to the catalog as well.
- Only the two provider blocks were patched in the live `providers.md`. The docs-body changes are in the seed only.
- The "Models..." button sits in a row under the select, next to the badges.

### Verification
- `yarn typecheck`: OK.
- `yarn lint`: OK.
- `yarn test`: 36 files, 338 tests passed. The orchestrator re-ran this.
- `yarn test:electron`: 7 passed, including the Models tab check. This was run by the UI implementer.

**Not run.** These need keys or a live LM Studio:
- Detect and tick against live OpenRouter.
- Ticking an LM Studio model and chatting with it.
- `deepseek/deepseek-v4-pro` tool calls with thinking on.
- Ticks persisting across a restart.

### Follow-ups and known limitations
- OpenRouter's free tier also caps requests per day (50/day without credits). That daily limit is not handled (rpd was deliberately not ported).
- DeepSeek's `/models` list has no prices. Its new models go in through Add by id.
- A hidden model can still be named in `roles.md` and used by the Default option or a fallback. The router is unchanged, as decided.

### Commit status
Uncommitted on `PAR-04_openrouter_model_picker`.
