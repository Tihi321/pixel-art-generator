# Roadmap

What Pixel Studio still lacks, found while VN Studio and the creative hub (`C:\projects\Personal\creative-hub`) drove it over MCP (2026-10-20, the pixel-art book *The Soother That Fell into Dragon Land*). Moved here from the hub's `ROADMAP.md` on 2026-10-22. Most important first. Finished work is in `.claude/tickets/` (PAR-05 headless MCP, `import_image` and exact-size export for VN Studio). Fix items on a ticket branch (`PAR-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 52d9f51)

- Every item found in the 2026-10-20 run is done on branch `PAR-07-13_roadmap` (PAR-07 to PAR-13: a `document` id on every tool plus `select_document` / `close_document`, the 2048x2048 import and WebP, `engine.lock`, polygons, gradients and images, pixel fonts and `draw_text`, expression sets, UI elements and 9-slice). This file stays as the place for new findings.
- Headless MCP on `127.0.0.1:7457/mcp` (`--mcp-only`), used by VN Studio for pixel conversion and drawing. VN Studio's VNO-08 added a `grid` draw mode (one call per sprite), so the client provider can draw without a per-turn timeout.

## PAR-15 ACP live UI check (2026-10-27, branch `PAR-15_acp-live-ui-check`)

- Live Playwright spec `tests/e2e/acp-live.spec.ts` (run with `ACP_LIVE=1`, proxy on 7461): Settings > Models lists `acp` with prefixed ids only, the Add provider form (Test, detect, remove) and agent chat runs on `acp/codex/gpt-5.6-luna` and `acp/antigravity/gemini-3.8-flash` that draw a heart. It runs on an isolated home seeded with a copy of the real config.
- Fixes: providers.md edits are serialized (`LlmService`); JSON-action mode tells the model the actions are run by the app, nudges a first-step "I can't use tools" refusal twice, and repairs broken JSON twice.
- JSON-action mode also sends the model back (max 2) when it ends the turn while its last action failed. Reliability on the proxy (`ACP_REPEAT=3`): codex 3/3, gemini 3/3 (one codex run in an earlier batch 2/3). Before the fixes codex failed 3 of 5.

## PAR-14 ACP proxy and custom providers (2026-10-27, branch `PAR-14_acp-custom-providers`)

- Seeded `acp` provider (off, local, `http://127.0.0.1:7461/v1`, json_schema off, discover on) and an idempotent seed migration (`config/seed-state.json`) so existing `~/PixelStudio/config/providers.md` files get it once without losing edits.
- Settings > Models: **+ Add provider** / Edit / Remove for OpenAI-compatible providers (`custom: true` entries of providers.md, key in the credential store as `CUSTOM_<ID>_API_KEY`), Test button, no restart. Plan: `.claude/tickets/PAR-14-acp-custom-providers/plan.md`.
- Not checked live: the real proxy and the Electron UI (only unit tests with a fake `/v1/models`).
