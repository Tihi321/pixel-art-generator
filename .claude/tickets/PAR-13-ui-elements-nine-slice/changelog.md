# PAR-13 changelog

## 2026-10-22: `draw_ui_element` and `draw_nine_slice` for visual-novel UI

Branch `PAR-07-13_roadmap`, one commit for this ticket.

### Files

- `src/core/ui.ts` (new, exported from `src/core/index.ts`): `drawUiElement` (panel, textbox, namebox tab, button, choice, frame; square/round/cut corners, bevel, 1 px shadow, dither/stripes patterns, textbox inner line, labels with the PAR-11 fonts, idle/hover/pressed/disabled), `defaultUiStyle` (colours from the palette: darkest border, a neutral mid fill, neighbouring lighter/darker bevel; steps penalise hue change and extra chroma so hover/pressed stay in family), `uiNineSlice` (borders measured from the rendered element), `nineSlice` (tile/stretch edges and middle, transparent skip/clear), `normalizeInsets`/`validateInsets`.
- `src/tools/defs/ui.ts` (new, registered in `src/tools/defs/index.ts`): `draw_ui_element` (one undo step; text with the 9-slice borders and a Ren'Py `Frame(...)` line; JSON `{rect, nineSlice, kind, state, renpy, labelFits}`; errors when the element is too small for its style; notes an ignored state or a label that does not fit) and `draw_nine_slice` (source from another layer/frame/document, snapshotted first so overlaps are safe; readable inset errors).
- `docs/llm-guide.md`, `src/tools/guideText.ts`: "UI for visual novels" section (full guide). `README.md`: two VN table rows. `ROADMAP.md`: the VN UI item and the empty "Visual novel assets" section removed; "Where it stands" says every item from the 2026-10-20 run is done on `PAR-07-13_roadmap`.
- Tests: new `tests/core/ui.test.ts` (56) and `tests/tools/ui.test.ts` (10); tool counts 69 -> 71.

### Deviations

- The textbox is flat (border plus a light inner line, `inset` 1), not bevelled.
- `inset` = plain pixels between border/bevel and the inner line.
- `state` on non-button kinds is ignored with a note instead of an error.
- Round corners scale with the element (2/3/5 circle test); cut chamfer 2/3/4.
- Gameboy (4 colours): disabled has the idle fill and differs by the missing bevel and a muted label.
- 9-slice borders are measured from a rendered element instead of a formula, so they always match the drawing.

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 49 files, 501 tests passed. `yarn build`: ok.
- Visual (4x renders under `.claude/temp/`): `ui-kit-pico-8.png`, `ui-kit-db32.png`, `ui-kit-gameboy.png` (buttons and choices in 4 states, tiny-font buttons, namebox on a textbox, panels, frames) and `nine-slice.png` (16x16 frame to 200x48 with tile and stretch: crisp corners; tile keeps the dash rhythm). Reviewed by the implementer and the orchestrator.
- Not run: the 320x64 acceptance textbox rendered at full size (borders and Frame output are unit-tested; the kit's 200x48 textbox shows the look); Ren'Py using the exported PNGs.

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-13: UI elements and 9-slice for visual-novel UI".
