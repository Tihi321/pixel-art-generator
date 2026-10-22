# PAR-10 changelog

## 2026-10-22: `draw_polygon`, `draw_gradient`, `draw_image`; `draw_grid` up to 256x256

Branch `PAR-07-13_roadmap`, one commit for this ticket.

### Files

- `src/core/fill.ts` (new, exported from `src/core/index.ts`): `drawPolygon` (pixel-centre even-odd fill plus the Bresenham outline through the vertices; `closed`, `thickness`, polylines) and `drawGradient` (vertical/horizontal/diagonal/radial/angle; dither none, ordered 4x4, ordered8, checker, smooth; masks all/opaque/transparent; only stop colours except `smooth`).
- `src/tools/defs/drawing.ts`: tools `draw_polygon`, `draw_gradient`, `draw_image` (base64 PNG or file path, exactly one; max `MAX_DIMENSION`; transparent skip/clear; alpha binary/keep; snap none/palette with dither; reports colours outside the palette), each one undo step through `paintCel`. `draw_grid` description points to the bulk tools.
- `src/tools/util.ts`: `MAX_GRID_SIDE` 64 -> 256 (`read_grid` stays at 128).
- `docs/llm-guide.md`, `src/tools/guideText.ts`: short guide line for big scenes (other short lines trimmed to stay under 1500 chars); new "Big scenes" section with a 320x180 example; closed shapes via `draw_polygon {filled:true}` instead of line + flood_fill.
- `ROADMAP.md`: the Drawing item now only lists the pixel font (PAR-11).
- Tests: new `tests/core/fill.test.ts` (11), new `tests/tools/drawing.test.ts` (9); tool counts 62 -> 65 in registry/toolBridge/server/stdio tests.

### Deviations

- The gradient angle is `direction` as a number (no separate `angle` arg); `w`/`h` default to the right/bottom edge.
- `draw_image` has `alpha: "binary" | "keep"` (the plan's "unless alpha keep").
- `checker` dither: hard bands whose first row/column alternates with the previous band's colour (stop colours only).
- Polygon vertices are pixel positions and the outline is included: the square (1,1)-(4,4) covers 4x4 pixels.
- Other "64x64" mentions (sprite advice in `draw_sprite_from_reference`, `mcpContent.ts`, `get_asset`) are not the grid cap and were left.

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 45 files, 409 tests passed. `yarn build`: ok.
- Visual: a 320x180 db32 scene (ordered-dither gradient sky, three overlapping filled hills, a polygon sharing their edges, a `draw_image` sun with semi-transparent pixels) exported at 4x: no gaps on shared edges, stable dither, semi-transparent pixels dropped, the out-of-palette count reported.

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-10: draw_polygon, draw_gradient, draw_image and a 256x256 draw_grid".
