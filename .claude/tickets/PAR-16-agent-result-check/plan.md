# PAR-16 Agent result check + missing gemini option

## Fix 1: end-of-run result check (JSON-action mode, src/llm/agent.ts)
- `ToolHost` (llm + shared) gets two optional members: `mutates?(name): boolean` and `fingerprint?(signal): Promise<string | null>`.
- New internal read-only tool `canvas_fingerprint` (hidden from `defs()`): hash of the active document's structure and every cel + `empty` flag.
- `ToolBridge` implements both (mutates = registry tool not readOnly/noTransaction, plus import_image and draw_sprite_from_reference). `withAutoPreview` passes them through.
- `runAgent`: fingerprint at run start (JSON mode only); `MAX_RESULT_NUDGES = 2`, `resultNudges`, `resultRetry()`. When the model ends the turn, the run ran a mutating action, and the fingerprint is equal to the start's -> corrective message. Error guard first (errorRetry), then resultRetry. Never for Q&A, never when changed, never when the host has no fingerprint.
- Unit tests in tests/llm/agent.test.ts.

## Fix 2: gemini option missing from chat model list
- Trace the list build (registry, discovery, modelChoices, renderer), find root cause, fix with unit test. Keep last known models when discovery returns empty.

## Verify
vitest, tsc, eslint, build; live ACP_LIVE=1 ACP_REPEAT=3 with temp home; real config diff.
