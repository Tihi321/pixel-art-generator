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
