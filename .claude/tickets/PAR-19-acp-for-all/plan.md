---
status: done
request: creative-hub/REQ-0030
repos: [pixel-art-generator]
branch: PAR-19_acp-for-all
updated: 2026-11-21
---

# PAR-19 ACP for all: the artist and palette run on the local model through the ACP proxy (JSON-action mode); port 8787

Part of creative-hub HUB-38 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-38-acp-for-all\plan.md`). The user's decision: every app reaches every LLM, local ones included, through the ACP proxy (provider `acp`, `http://127.0.0.1:8787/v1`), which serves `gufo/*`, `strata/*`, `llama/*`. The `strata` provider stays in the code, switched off ("disable, keep code"). **Pixel's vision rows keep their current provider**: LM Studio stays enabled with its rows (`ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp` tools+vision, `google/gemma-4-e4b` vision) for a chat with an attached image picked in the model picker; no role or default names it any more.

The proxy answers a request with `tools` to a local model with 400 `model_not_capable`, so local acp rows are `tools: false` and the agent uses its JSON-action mode (`src/llm/agent.ts:25,79,306`), as the existing acp cloud rows already do. The seed ships acp disabled on the stale port 7461 (`seed/config/providers.md:122-131,238`). Code and seed only; the user's `~\PixelStudio` is changed by the hub (HUB-38 L5).

## Contracts (copied from HUB-38; keep identical)

LOCAL = `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`. Defaults never name `gufo/*` or `llama/*`.

C1, the `acp` provider (seed), with Pixel's `tools: false` on every row; cloud rows unchanged, local rows appended:

```yaml
  - id: acp
    name: ACP proxy
    kind: openai-compat
    enabled: true
    local: true
    base_url: http://127.0.0.1:8787/v1
    concurrency: 4
    json_schema: false
    discover: true
    discover_skip: [ qwen-image, nomic-embed ]
    models:
      # ... existing cloud rows (tools: false) unchanged ...
      # Local models through the proxy (HUB-38). One local model is loaded at a time across gufo, strata and llama;
      # a request for another one waits until the proxy has switched (minutes). LOCAL is the strata row.
      # The proxy refuses tools for local models: JSON-action mode.
      - id: strata/qwen3.8-flash-next-unsloth-ud-iq4_xs
        family: qwen
        context: 131072
        tools: false
        extra_body: { reasoning_effort: none }
      - id: gufo/Qwen3.8-27B
        family: qwen
        context: 32768
        tools: false
        extra_body: { reasoning_effort: none }
      - id: gufo/deepseek4
        family: deepseek
        context: 16384
        tools: false
        extra_body: { reasoning_effort: none }
      - id: gufo/flash-next-q4
        family: qwen
        context: 32768
        tools: false
        vision: true
        extra_body: { reasoning_effort: none }
      - id: llama/inkling-2-mini
        family: inkling
        context: 32768
        tools: false
        vision: true
      - id: llama/inkling-2-mini-dspark
        family: inkling
        context: 32768
        tools: false
        vision: true
```

C5: migration `acp-port-8787-v1` (recorded in `seed-state.json` `migrations`, like `strata-loaded-v1`) rewrites only the exact value `http://127.0.0.1:7461/v1` of the `acp` row's `base_url` in `config/providers.md` to `http://127.0.0.1:8787/v1`; a file it cannot parse is left alone with a warning and the migration is not recorded.

## Scope

1. Seed `seed/config/providers.md`: acp = C1 (`enabled: true`, 8787); `strata` row `enabled: false` (rows, `loaded`, profiles kept); `lmstudio` unchanged. Prose line 238: acp on at 8787, the route to every model including the local ones; local acp rows run the agent in JSON-action mode; drop the obsolete `PROXY_IGNORE_SAMPLING=1` sentence (the proxy drops sampling fields itself since AAP-28); LM Studio is for the vision rows only; one local model on the GPU at a time and a switch takes minutes. Strata comment: runs under the proxy.
2. Seed `seed/config/roles.md`: aliases `local: acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`, `lmstudio: lmstudio/ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp` (vision, for the picker), `cloud`, `claude` unchanged; remove `strata`, `strata-low`; `artist: [local]`, `palette: [local]`. Prose: the artist runs on the local model in JSON-action mode by default; a tool-calling model (cloud) can be picked in the chat.
3. Migration `acp-port-8787-v1` (C5) in `src/llm/seedMigration.ts`, next to `migrateStrataLoaded`, called where that one is called. It changes nothing else.
4. Port strings: `src/llm/customProviders.ts:52`, `src/renderer/components/CustomProviderForm.tsx:65`, `tests/e2e/acp-live.spec.ts:1,13,19` (gated by `ACP_LIVE=1`; also pick LOCAL as one of its models only if the spec lists models: otherwise leave its models), `tests/llm/customProviders.test.ts:38,116,133,145` (sample addresses: 8787 where they stand for the proxy).
5. Read `src/llm/seedMigration.ts` merge of missing seed providers (`seed-state.json` offered ids): confirm it does not re-enable `strata` or re-add removed aliases; `STRATA_RENAMES` stays.
6. Docs: `docs/llm-guide.md`, `README.md`/`CLAUDE.md` where they name LM Studio/Strata as the agent's model.
7. `ROADMAP.md` row.

## Out of scope

Native tool calls for local models (a proxy feature); moving the vision rows to the proxy; removing LM Studio/Strata code; `src/main/appSettings.ts` (its default `selectedModel` is `null`: unchanged); the user's data folder.

## Files

`seed/config/providers.md`, `seed/config/roles.md`, `src/llm/seedMigration.ts`, `src/llm/customProviders.ts`, `src/renderer/components/CustomProviderForm.tsx`, `tests/e2e/acp-live.spec.ts`, `tests/llm/customProviders.test.ts`, the seed-migration test in `tests/llm/`, docs, `ROADMAP.md`.

## Acceptance and tests

- A1 An existing folder with acp on 7461 gets 8787 once; a different value is kept. Test: one table case (7461 rewritten, 9999 kept) in the existing seed-migration test file.
- A2 A fresh folder: acp on at 8787 with the six local rows all `tools: false`, `strata` off, `artist` and `palette` resolve to LOCAL and run in JSON-action mode. Check: extend the existing agent-mode test (`tests/main/agentLlm.test.ts` or the registry test) with one assertion that a `tools: false` acp row picks JSON-action mode, only if no test covers that already; else none.
- A3 `yarn test`, `yarn typecheck`, `yarn build` pass (fnm default alias dir on PATH).
- Live (hub HUB-38 C7; GPU: Strata through the proxy; the user's go-ahead): one artist request on LOCAL changes the artwork; the proxy log has no 400 `model_not_capable`.

## ROADMAP row

`- **PAR-19** (2026-11-21, branch \`PAR-19_acp-for-all\`; creative-hub HUB-38, REQ-0030): the artist and palette run on LOCAL = \`acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs\` through the ACP proxy in JSON-action mode; seed acp on at 8787 with the gufo/strata/llama rows (Inkling listed, not default), migration \`acp-port-8787-v1\`, \`strata\` off (code kept), LM Studio kept for the vision rows. Live check UNTESTED.`
