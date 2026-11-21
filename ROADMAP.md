# Roadmap

What Pixel Studio still lacks, found while VN Studio and the creative hub (`C:\projects\Personal\creative-hub`) drove it over MCP (2026-10-20, the pixel-art book *The Soother That Fell into Dragon Land*). Moved here from the hub's `ROADMAP.md` on 2026-10-22. Most important first. Finished work is in `.claude/tickets/` (PAR-05 headless MCP, `import_image` and exact-size export for VN Studio). Fix items on a ticket branch (`PAR-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 52d9f51)

- Every item found in the 2026-10-20 run is done on branch `PAR-07-13_roadmap` (PAR-07 to PAR-13: a `document` id on every tool plus `select_document` / `close_document`, the 2048x2048 import and WebP, `engine.lock`, polygons, gradients and images, pixel fonts and `draw_text`, expression sets, UI elements and 9-slice). This file stays as the place for new findings.
- Headless MCP on `127.0.0.1:7457/mcp` (`--mcp-only`), used by VN Studio for pixel conversion and drawing. VN Studio's VNO-08 added a `grid` draw mode (one call per sprite), so the client provider can draw without a per-turn timeout.

- **PAR-19** (2026-11-21, branch `PAR-19_acp-for-all`; creative-hub HUB-38, REQ-0030): the artist and palette run on LOCAL = `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` through the ACP proxy in JSON-action mode; seed acp on at 8787 with the gufo/strata/llama rows (Inkling listed, not default), migration `acp-port-8787-v1`, `strata` off (code kept), LM Studio kept for the vision rows. Live check UNTESTED.

## PAR-18 Strata docs, drop the removed IQ3_S launchers (2026-11-04, branch `PAR-18_strata-iq3s-removal`)

- Done. The IQ3_S, IQ2_XS and coder IQ1_M models and their `run-*.bat` files are gone from `D:\Strata`; the seed `providers.md`, the README or CLAUDE.md now name the four that remain (`run-unsloth-ud-iq4_xs-parallel.bat`, `run-unsloth-ud-iq4_xs.bat` and the two DeepSeek V4.1 Flash ones). Docs only, no code change; plan `.claude/tickets/PAR-18_strata-iq3s-removal/plan.md`.

## PAR-17 Strata model discovery (2026-11-04, branch `PAR-17_strata-model-discovery`, hub HUB-26)

- Done in code and unit tests. The Strata provider has two `loaded` rows, `strata/default` (thinking off) and `strata/default-low`, that follow whichever model Strata runs: the registry asks `/v1/models` and `/v1/status`, and takes family, context, `extra_body`, `tools`, `vision` and `json_schema` from the `profiles` entry of that model (id prefix match). Roles name only `strata` / `strata-low`; the old `strata/qwen3.8-flash-next(-low)` refs resolve through `aliases`. The chat and Settings > Models show `Strata: <model>`. Seed migration `strata-loaded-v1` (`seed-state.json`) moves an existing config folder, including `models.md` `shown` and `app.json` `selectedModel`. Plan: `.claude/tickets/PAR-17-strata-model-discovery/plan.md`.
- Not checked live: a real Strata (Qwen, then DeepSeek) and a model switch while the app runs (hub live checks L4/L5). Strata down keeps the last served model but the provider is not marked down (Pixel Studio has no down state; concurrency drops to 1).

## PAR-16 Agent result check and the missing gemini option (2026-10-28, branch `PAR-16_agent-result-check`)

- Done (both PAR-15 follow-ups). JSON-action mode now checks the result: when the model ends the turn after a mutating action and the document fingerprint (internal tool `canvas_fingerprint`, hidden from models and MCP) equals the one from the start of the run, it is sent back (max `MAX_RESULT_NUDGES` = 2, after the error guard). Plan: `.claude/tickets/PAR-16-agent-result-check/plan.md`.
- The missing gemini option was not an app bug: when a live test fails, Playwright restarts the worker and `beforeAll` relaunches the app on a fresh copy of the real config, where the acp models are not ticked, so the next test saw no acp options at all. The spec now ticks its two models in `beforeAll`.
- Left: the result check covers JSON-action mode only (native tool calling is not checked); the refusal nudge also recognizes `tool use was disabled` / `not to use tools`.

## PAR-15 ACP live UI check (2026-10-27, branch `PAR-15_acp-live-ui-check`)

- Live Playwright spec `tests/e2e/acp-live.spec.ts` (run with `ACP_LIVE=1`, proxy on 7461): Settings > Models lists `acp` with prefixed ids only, the Add provider form (Test, detect, remove) and agent chat runs on `acp/codex/gpt-5.6-luna` and `acp/antigravity/gemini-3.8-flash` that draw a heart. It runs on an isolated home seeded with a copy of the real config.
- Fixes: providers.md edits are serialized (`LlmService`); JSON-action mode tells the model the actions are run by the app, nudges a first-step "I can't use tools" refusal twice, and repairs broken JSON twice.
- JSON-action mode also sends the model back (max 2) when it ends the turn while its last action failed. Reliability on the proxy (`ACP_REPEAT=3`): codex 3/3, gemini 3/3 (one codex run in an earlier batch 2/3). Before the fixes codex failed 3 of 5.
- Open follow-ups: an agent run can end with a successful last call but an empty canvas (needs a result check, the failed-last-action guard does not catch it); the gemini model option is sometimes missing from the chat model list right after a failed codex run (cause unknown; the spec logs the options).

## PAR-14 ACP proxy and custom providers (2026-10-27, branch `PAR-14_acp-custom-providers`)

- Seeded `acp` provider (off, local, `http://127.0.0.1:7461/v1`, json_schema off, discover on) and an idempotent seed migration (`config/seed-state.json`) so existing `~/PixelStudio/config/providers.md` files get it once without losing edits.
- Settings > Models: **+ Add provider** / Edit / Remove for OpenAI-compatible providers (`custom: true` entries of providers.md, key in the credential store as `CUSTOM_<ID>_API_KEY`), Test button, no restart. Plan: `.claude/tickets/PAR-14-acp-custom-providers/plan.md`.
- Not checked live: the real proxy and the Electron UI (only unit tests with a fake `/v1/models`).
