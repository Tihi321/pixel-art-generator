# PAR-25 part A changelog

Branch `PAR-25_repeat-guard-tool-set`, one commit. Part B (Strata `vision: true`) not built.

## Failing first (old code)

A1, `tests/llm/agent.test.ts` "repeat guard: ..." (the same-picture block):

```
AssertionError: expected [ { model: 'mock', ... }, ... ] to have a length of 2 but got 4
 > tests/llm/agent.test.ts:453  expect(same.requests).toHaveLength(2)
```

A1, alternating block (the first block's assertions were stubbed out in a throwaway copy to reach it):

```
AssertionError: expected [ ... ] to have a length of 5 but got 7
```

A2, `tests/main/agentLlm.test.ts` appSettings (`agentToolSet` key missing from the read object):

```
AssertionError: expected { selectedModel: null, ... } to deeply equal { selectedModel: null, ... }
```

A2, `tests/main/agent.test.ts` no-files tool set:

```
AssertionError: expected [ 'get_document', 'draw_grid', ... ] to not include 'export_png'
```

All four pass after the code.

## Measured (`jsonModeInstructions`, throwaway test, not committed)

71 tools from `createDefaultRegistry().defs()`; all 10 `NO_FILES_TOOLS` names exist.

- all tools: 99,843 characters
- no-files: 84,101 characters
- difference: 15,742 characters (README says "about 15,700")

## Results

- `yarn test`: 52 files, 542 tests passed. `yarn typecheck`: exit 0. `yarn lint`: exit 0.
- New tests: 3 `it` (1 in tests/llm/agent.test.ts with three scenarios, 1 in tests/main/agent.test.ts, plus extra lines in the existing appSettings `it`).

## Deviations

1. `ResolvedModel.toolSet` in `src/main/llm.ts` is optional (`toolSet?: AgentToolSet`), not required as the plan says: the test doubles of `tests/main/agentMcp.test.ts` and `tests/main/headless.test.ts` return a `ResolvedModel` without it and failed typecheck. `resolveModel` always sets it.
2. README: `config/app.json` is not described anywhere in README.md or docs, so the `agentToolSet` paragraph is added at the end of "The artist agent over MCP", with the file list and one sentence on the repeat guard.
3. The alternating-host scenario sits in the same `it` as the plan says; to show its old-code failure (7 requests) the first scenario was bypassed in a throwaway copy of the test file (deleted).

## Polish 1 (checker FAILED A-1: three findings)

1. The guard counted any successful `mutates()` tool, but the fingerprint covers only doc id, size, layers, frame ids and cels. New exported `changesPicture(toolName)` in `src/tools/defs/reading.ts` (the set `PICTURE_TOOLS`), exposed as the optional host method `drawsPicture?` (`ToolHost` in `src/llm/agent.ts` and `src/shared/tools.ts`, `ToolBridge`, the headless bridge, passed through by `withAutoPreview` and `withToolSet`). The guard runs only when the host has `fingerprint` and `drawsPicture`, and a step counts only when a successful tool of it has `drawsPicture` true.
2. A counted step that ends on the start print now sets `lastPrint` to it, is never counted in `ended` and never stops. So a, start, a does not stop; the third arrival on a does.
3. `signal.aborted` is checked again after the fingerprint await: an abort during it ends `aborted`.

README: one word (`a step` -> `a drawing step`).

### Classification of every non-read-only tool (tool -> counts?)

Counts: `draw_grid`, `set_pixels`, `draw_line`, `draw_rect`, `draw_ellipse`, `draw_polygon`, `draw_gradient`, `draw_image`, `flood_fill`, `replace_color`, `clear_cel`, `transform_cel`, `outline`, `draw_text`, `draw_ui_element`, `draw_nine_slice`, `place_asset`, `copy_cel`, `remap_to_palette` (cels); `resize_canvas`, `add_frame`, `duplicate_frame`, `delete_frame`, `move_frame`, `add_layer`, `delete_layer`, `move_layer`, `duplicate_layer`, `merge_down` (size, frames, layers).

Does not count: `set_palette`, `add_colors`, `remove_colors`, `load_palette` (cels only with `remap`, args-dependent), `import_palette`, `set_frame_duration`, `create_tag`, `update_tag`, `delete_tag`, `set_style_reference` (references; the layer only with `showLayer`), `make_expression_set` (may only add tags), `update_layer` (may change only `locked`, which the fingerprint does not cover), `import_image` and `draw_sprite_from_reference` (open another document), `undo`/`redo` (not mutating). Read-only and file tools (`new_document`, `open_*`, `save_*`, `export_*`, `render_preview`, `read_grid`, ...) do not count.

### Failing first (on f5aaddf, new expectations in the existing guard `it`)

- (a) draw, a non-picture tool step, draw: `AssertionError: expected [ { model: 'mock', …(5) }, …(1) ] to have a length of 4 but got 2` (tests/llm/agent.test.ts, the `tagged` case: the old guard stopped at the tag step).
- (b) a, start, a, start, a: `AssertionError: expected [ { model: 'mock', …(5) }, …(2) ] to have a length of 5 but got 3` (the `back` case: the old guard stopped at the second arrival on a). Shown with the (a) expectations temporarily inverted in a throwaway edit, restored.
- Finding 3 has no test (the brief asked for (a) and (b) only).

### Results

`yarn test`: 52 files, 542 tests passed (no new `it`: two scenarios added to the existing guard `it`). `yarn typecheck`: exit 0. `yarn lint`: exit 0.

## Polish 2

User words: "fix this small issue on pixel note". `remap_to_palette` removed from `PICTURE_TOOLS` in `src/tools/defs/reading.ts`: with a `palette` argument it may change only the document palette and leave every cel as it is, so a step made of it alone could end on the same fingerprint and the guard would stop a real run. Rule of the set: a tool whose effect on fingerprinted state is not certain does not count. It is now in the "not in it" comment list. The classification above is superseded for this one tool.

Test: no new `it`. `changesPicture('draw_grid')` true and `changesPicture('remap_to_palette')` false added at the start of the existing guard `it` in `tests/llm/agent.test.ts` (no test touched `changesPicture` directly).

Failing first on 3685e83 (fix not yet applied): `AssertionError: expected true to be false // Object.is equality` (tests/llm/agent.test.ts, the `remap_to_palette` expectation).

## Part B (2026-11-23)

Strata is the artist's vision model. Branch `PAR-25_strata-vision` (cut from master 820f2e9), one commit `PAR-25: Strata is the artist's vision model (seed and a migration)`. Condition met: creative-hub HUB-44 K5 ran three vision runs on Strata on 2026-11-22 (b1055f66, d73c4e53, 9dbc81fd), all `completed` (two by the repeat guard, one by the model's done), all three mushrooms.

Files:
- `seed/config/providers.md`: the `acp` row `strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` gets `vision: true` (comment: sees the previews, HUB-44 K5). Prose in the provider notes: "Its models are text only" now says text only unless a row says `vision: true` (the Strata row does); "Pixel Studio has no local vision model: ..." now says Strata through the proxy is the local vision model and that Inkling stays unusable for the artist (32768 context smaller than the artist's prompt). README had no such sentence.
- `src/llm/seedMigration.ts`: `STRATA_VISION_MIGRATION = 'acp-strata-vision-v1'` and `migrateStrataVision(configDir)`: once; only the `acp` row with that exact id and no `vision` key gets `vision: true` (inserted after `tools`); any `vision` value, other rows and keys stay; an unreadable providers.md leaves a warning and is not recorded.
- `src/llm/setup.ts`: calls it after `migrateAcpPort`, same `.catch(() => undefined)`.
- `tests/llm/customProviders.test.ts`: one new `it` (row gets vision once, changed `['providers.md']`; second call nothing; `vision: false` stays; unreadable file warns and is not recorded).
- `tests/main/agentLlm.test.ts`: one expectation changed, the seed's Strata default now resolves `vision: true` (it asserted false).
- `ROADMAP.md`: Part B sentence appended to the PAR-25 bullet.

Failing first (before the migration existed): `TypeError: migrateStrataVision is not a function` at `tests/llm/customProviders.test.ts:295` (1 failed, 17 passed).

Verification: `yarn test` 52 files, 544 tests passed (the `agentLlm` expectation failed once until updated, see above); `yarn typecheck` and `yarn lint` exit 0.

Not run: Pixel Studio (no start, no `yarn build`); the live folder `C:\Users\Infplane\PixelStudio` is untouched and gets the change from the migration at the next start. A vision run on the changed config is not made.

Deviation: `tests/main/agentLlm.test.ts` changed (not named in the plan), a consequence of the seed row.
Commit: see git log of `PAR-25_strata-vision`; not pushed or merged.
