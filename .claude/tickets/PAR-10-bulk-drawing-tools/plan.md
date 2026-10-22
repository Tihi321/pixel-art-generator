# PAR-10: Fast full-scene drawing: `draw_polygon`, `draw_gradient`, `draw_image`, bigger `draw_grid`

Ticket folder: `.claude/tickets/PAR-10-bulk-drawing-tools/`. Branch: `PAR-07-13_roadmap` (one commit for this ticket).

Source: `ROADMAP.md` > "Drawing": "A full background is slow to draw by hand. `draw_grid` is capped at 64x64; there is no polygon, gradient/dither or bitmap-text tool; and line + `flood_fill` leaks or leaves gaps. ... Wanted: `draw_polygon`, `draw_gradient {stops, dither}`, a bulk `draw_image` / `set_layer_pixels` that takes a whole layer, and a tiny pixel font." The pixel font is PAR-11.

## Goal

An agent (or the hub's `scripts/pxcanvas.py`) can paint a 320x180 background in a handful of calls: sky gradient with dither, hills as filled polygons, and a whole precomposed layer in one call.

## Decisions

All new tools are in `src/tools/defs/drawing.ts`, use `paintCel` (one undo step, `layer`/`frame`/`document` targets), and the raster algorithms go to `src/core/raster.ts` (or a new `src/core/fill.ts` if raster.ts gets too long) with unit tests.

- **`draw_polygon {points, color, filled?, thickness?, closed?}`**
  - `points`: 2..1024 items, each `[x, y]` or `{x, y}` (integers).
  - Filled: scanline fill with pixel-centre sampling (a pixel is inside when its centre (x+0.5, y+0.5) is inside, even-odd rule), PLUS the outline drawn with the same Bresenham `drawLine` so filled shapes have no gaps along the edges and adjacent polygons sharing an edge meet without holes. `closed` defaults to true; `closed:false` with `filled:false` is a polyline.
  - Self-intersecting polygons follow even-odd (document it).
- **`draw_gradient {stops, x?, y?, w?, h?, direction?, dither?, mask?}`**
  - `stops`: 2..16 `{at: 0..1, color}` (sorted by `at`; `at` optional = evenly spaced), colors are any color arg (hex, palette index, name).
  - Region: x/y/w/h (default the whole canvas).
  - `direction`: `"vertical"` (default, top to bottom), `"horizontal"`, `"diagonal"` (top-left to bottom-right), `"radial"` (centre of the region outwards), or `angle` in degrees (0 = left to right, 90 = top to bottom) as a number.
  - `dither`: `"none"` (hard bands, each pixel takes the nearest stop on the gradient), `"ordered"` (default: 4x4 Bayer between the two neighbouring stops, so only stop colors are used - pixel-art friendly), `"ordered8"` (8x8 Bayer, finer), `"checker"` (2-level 50% only at the band border, one row wide), `"smooth"` (true color blend; documented as not pixel-art, adds colors).
  - `mask`: `"all"` (default), `"opaque"` (only pixels that already have color: shade existing art), `"transparent"` (only empty pixels: a sky behind drawn hills).
  - Output colors are exactly the stop colors except for `"smooth"`; a test asserts it.
- **`draw_image {png? | path?, x?, y?, transparent?, snap?, dither?}`**: the bulk tool (covers "set_layer_pixels").
  - `png`: base64 PNG (optionally with a `data:image/png;base64,` prefix). `path`: an image file (decoded with `decodeImageFile`, so PNG always, JPEG/WebP where the host can). Exactly one of them.
  - Placed with its top-left at x/y (default 0,0), clipped to the canvas. Max decoded size `MAX_DIMENSION` per side.
  - `transparent`: `"skip"` (default: transparent pixels keep what is there) or `"clear"` (the image rectangle replaces the cel, like draw_grid's clear). Semi-transparent pixels: alpha >= 128 becomes opaque, below becomes transparent (pixel art is binary alpha) unless `alpha: "keep"`.
  - `snap`: `"none"` (default: colors as given) or `"palette"` (remap to the document palette, `dither` none/ordered/floyd from `remapToPalette`).
  - Result: the usual touched rect plus the number of colors not in the palette when `snap` is none (a hint to call `remap_to_palette`).
  - MCP body limit is 64 MB already; a 4096x4096 PNG fits.
- **`draw_grid` limit 64 -> 256 per side** (`MAX_GRID_SIDE`, used by the schema, the width check and the descriptions). `read_grid` keeps its 128 max (it is about reply size). VN Studio's tiling at 64 keeps working.
- No change to `flood_fill`; the guide says to use `draw_polygon {filled:true}` instead of line + fill for closed shapes.

## Checklist

- [x] 1. Core: `fillPolygon`/`drawPolygon`, `drawGradient` (with Bayer 4 and 8 matrices, angle/radial parameterisation, masks), tests in `tests/core/raster.test.ts` (or a new `tests/core/fill.test.ts`): square polygon fills exactly its pixels; two polygons sharing an edge leave no gap; triangle edge pixels are drawn; gradient uses only stop colors; ordered dither pattern is stable; masks respected.
- [x] 2. Tools `draw_polygon`, `draw_gradient`, `draw_image`; `MAX_GRID_SIDE = 256`.
- [x] 3. Tool tests in `tests/tools/tools.test.ts` (or a new `tests/tools/drawing.test.ts`): each tool through `registry.execute`, one undo step each, `draw_image` with base64 and with a file in memory services, `snap: "palette"`, bad base64 -> readable error, both `png` and `path` -> error, a 200x100 `draw_grid` works.
- [x] 4. Docs: `docs/llm-guide.md` (short guide: mention the three tools and the new grid cap within the 1500-char limit; drawing section: "Big scenes" paragraph with an example sequence for a 320x180 background), `yarn gen:guide`; `README.md` if it lists tools; `ROADMAP.md`: shrink the "Drawing" item to what is left (the pixel font, until PAR-11).
- [x] 5. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`.

Notes (implementation): new `src/core/fill.ts` (`drawPolygon`, `drawGradient`, exported from core), tests in `tests/core/fill.test.ts` (11) and `tests/tools/drawing.test.ts` (9); tool-count assertions 62 -> 65 in registry, toolBridge, mcp server and stdio tests. Verified: `yarn typecheck`, `yarn lint`, `yarn test` (45 files, 409 tests), `yarn build` all pass. Visual check: 320x180 scene (ordered-dither sky, three overlapping filled hills, a polygon sharing an edge, draw_image sun) exported at 4x showed no gaps or artifacts. README.md lists no drawing tools, so unchanged. The guide's short section was trimmed (workflow, animation, images, errors lines) to fit 1500 chars.

## Deviations

- `draw_gradient`: the angle is the `direction` argument given as a number (there is no separate `angle` argument).
- `draw_gradient` region defaults: `w`/`h` default to the distance from x/y to the right/bottom edge.
- `draw_image`: added an `alpha: "binary" | "keep"` argument for the documented alpha behaviour. Inputs larger than `MAX_DIMENSION` per side are rejected.
- `checker` dither: hard bands whose first row/column alternates with the previous band's color (so only stop colors are used).
- A filled polygon's vertices are pixel positions and the outline is included, so the square (1,1)-(4,4) covers 4x4 pixels.

## Acceptance

- A 320x180 background (gradient sky, 3 polygon hills, a precomposed foreground via `draw_image`) can be made in under 10 calls, with no gaps between shapes.
- `draw_grid` accepts up to 256x256.
- All checks pass.
