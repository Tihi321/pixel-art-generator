# PAR-13: UI elements (textbox, name box, buttons, panels) and 9-slice

Ticket folder: `.claude/tickets/PAR-13-ui-elements-nine-slice/`. Branch: `PAR-07-13_roadmap` (one commit for this ticket). Needs PAR-11 (pixel fonts) for button labels.

Source: `ROADMAP.md` > "Visual novel assets": "No text, 9-slice or UI-element support (textbox, buttons)." Text is PAR-11.

## Context

Ren'Py draws its textbox, name box, choice buttons and frames from PNGs, usually as 9-slice frames: `Frame("gui/textbox.png", left, top, right, bottom)` (borders keep their size, the middle stretches or tiles). VN Studio builds a Ren'Py game; a pixel-art book wants matching pixel UI.

## Goal

An agent can make a consistent pixel UI kit in a few calls: a textbox, a name box, choice buttons in idle/hover/pressed/disabled states and a panel, each exportable as a PNG with its 9-slice borders reported.

## Decisions

- **`draw_ui_element {kind, x, y, w, h, style?, state?, label?, font?, labelColor?, align?}`** (drawing tool via `paintCel`):
  - `kind`: `"panel"`, `"textbox"`, `"namebox"`, `"button"`, `"choice"` (a wide button), `"frame"` (border only, transparent middle).
  - `style`: `{fill, border, light?, dark?, shadow?, corner?: "square"|"round"|"cut", borderWidth?: 1..4, inset?: 0..4, pattern?: "none"|"dither"|"stripes"}`. Defaults derive from the document palette (darkest color = border, a mid color = fill, lightest = light) so a call with only `kind` and a rect already looks right in any palette.
  - Look: border of `borderWidth`; bevel (`light` top-left inner edge, `dark` bottom-right inner edge); 1 px drop `shadow` bottom/right when given; `round` = 1-2 px rounded corners (pixel-art corners, not antialiased), `cut` = 45-degree chamfer; textbox gets an inner 1 px line `inset` px inside the border; namebox is a small tab shape; `pattern` fills the middle with a 2-color ordered dither or stripes using `fill` and `dark`.
  - `state` (buttons/choice): `idle` (default), `hover` (lighter fill: the next lighter palette color, or `style.hoverFill`), `pressed` (fill darker, bevel inverted, label 1 px down), `disabled` (desaturated: palette color nearest to a grey of the fill, label in `dark`).
  - `label`: text centred (or `align` left/center/right) with PAR-11's `draw_text` layout; `font` tiny/small (default small), `labelColor` default the lightest palette color (darkest on light fills: choose by contrast).
  - Result text includes the **9-slice borders** for the element: `{left, top, right, bottom}` = the non-stretchable border thickness (border + bevel + corner + inset), and a Ren'Py snippet `Frame("<name>.png", left, top, right, bottom)`. Also returned as the last JSON item `{rect, nineSlice:{left,top,right,bottom}}`.
- **`draw_nine_slice {source, insets, x, y, w, h, center?, edges?}`** (drawing tool): copy a 9-slice from a source rectangle onto a target rectangle of any size.
  - `source`: `{x, y, w, h, layer?, frame?, document?}` (default: the target's document, the active layer/frame; `document` lets it read another document's art).
  - `insets`: one number or `{left, top, right, bottom}`; must fit inside the source and the target (readable error otherwise).
  - `center`/`edges`: `"stretch"` (nearest neighbour) or `"tile"` (default `"tile"`: repeats the pattern, the pixel-art friendly choice).
  - Transparent source pixels keep the target (`transparent: "skip"` default) or clear it (`"clear"`).
- Core algorithms in `src/core/ui.ts` (pure TS: `drawUiElement(raster, spec, palette)`, `nineSlice(src, dst, ...)`), tools in a new `src/tools/defs/ui.ts` registered in `defs/index.ts`, tool group `drawing`.

## Checklist

- [ ] 1. `src/core/ui.ts`: element drawing (all kinds, corners, bevel, shadow, patterns, states), 9-slice copy (stretch/tile), insets computation; export from core index.
- [ ] 2. `src/tools/defs/ui.ts`: `draw_ui_element`, `draw_nine_slice`; registered.
- [ ] 3. Visual check: a script or env-gated test renders a UI kit sheet (each kind x each state, 3 palettes: pico-8, db32, gameboy) to `.claude/temp/ui-kit.png`; look at it and fix ugly cases.
- [ ] 4. Tests (`tests/core/ui.test.ts`, tool tests): borders/corners exact on a small element, states change the fill as specified, label centred, 9-slice of a 9x9 source to 30x20 keeps the corners pixel-identical and tiles the edges, stretch vs tile differ, insets too big -> error, nineSlice in the result equals the drawn border.
- [ ] 5. Docs: `docs/llm-guide.md` section "UI for visual novels" (make a 64x24 document per element or one sheet; draw_ui_element; export_png; use the reported Frame() borders in Ren'Py; draw_nine_slice to resize a hand-drawn frame), `yarn gen:guide`; `README.md` VN tools table; `ROADMAP.md` remove the item (the "Visual novel assets" section is then empty: remove it, and update "Where it stands").
- [ ] 6. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`.

## Acceptance

- `draw_ui_element {"kind":"textbox","x":0,"y":0,"w":320,"h":64}` on a fresh document gives a good-looking textbox in that palette and reports its Frame() borders.
- A hand-drawn 16x16 frame resized with `draw_nine_slice` to 200x48 keeps crisp corners and tiled edges.
- All checks pass.

## Deviations

- Defaults beyond the plan: a textbox is flat (border plus a light inner line, `inset` 1) and has no bevel; `inset` counts the plain pixels between border (and bevel) and the line. Label defaults: wrapped top-left on textbox, panel and frame; centered on button, choice and namebox.
- `state` on kinds other than button/choice is ignored (the result says so) instead of an error.
- Rounded corners are a circle test of size 2/3/5 by element size (1 px notch on small elements); cut is a 45 degree chamfer of 2/3/4.
- The element's 9-slice borders are measured from a rendered element (the part that varies along the stretch axis) rather than computed from a formula, so they always match the drawing.
