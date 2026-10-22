# PAR-11: Built-in pixel fonts: `draw_text` and `measure_text`

Ticket folder: `.claude/tickets/PAR-11-pixel-font-text/`. Branch: `PAR-07-13_roadmap` (one commit for this ticket).

Source: `ROADMAP.md` > "Drawing" ("a tiny pixel font") and "Visual novel assets" ("No text ... support").

## Goal

Agents can write crisp pixel text (titles, signs, UI labels, the name in a name box) without drawing glyphs by hand.

## Decisions

- **Fonts in code** (`src/core/font.ts`, pure TS): two bitmap fonts covering printable ASCII 32..126, each glyph stored as rows of `#`/`.` strings (readable, reviewable) and compiled once to bit rows:
  - `"tiny"`: 3x5 cells (glyph width may vary 1..3 for `i`, `l`, `.`, `!` etc.; uppercase and lowercase may share forms where 3x5 cannot tell them apart, but lowercase must be distinguishable where possible), 1 px letter spacing, line height 6.
  - `"small"`: 5x7 cells (proportional: narrow glyphs 1..4 wide), real lowercase with descenders (line height 9, baseline at row 7, descenders for g j p q y go 2 rows below), 1 px letter spacing.
  - Unknown characters (non-ASCII) render as a hollow box glyph and are counted in the result (`unknownChars`), so the caller knows. Common accented Latin letters may map to their base letter (a small table: àáâä -> a, etc.); document it.
- **Layout** `layoutText(text, font, opts)` -> positioned glyphs + bounds: `\n` line breaks, `maxWidth` word wrap (breaks long words), `align` left/center/right within `maxWidth` (or the widest line), `letterSpacing` (default 1, may be 0..4), `lineSpacing` (extra px, default 0), `scale` (integer 1..8, each font pixel becomes scale x scale).
- **`draw_text {text, x, y, color, font?, align?, maxWidth?, letterSpacing?, lineSpacing?, scale?, outline?, shadow?}`** (drawing tool via `paintCel`, so `layer`/`frame`/`document` work): x/y is the top-left of the text box. `outline`: a color for a 1 px outline around the glyphs (drawn first, 8-connected so it reads on busy backgrounds); `shadow`: `{color, dx?=1, dy?=1}` drop shadow. Max 2000 characters. Result: touched rect, plus JSON-free text "Text box WxH at (x,y), N lines".
- **`measure_text {text, font?, maxWidth?, letterSpacing?, lineSpacing?, scale?}`** (readOnly): returns `{width, height, lines:[{text,width}]}` as JSON so callers can center text before drawing.
- `list_fonts` is not needed: the `font` enum and the guide describe both fonts (cell size, line height, which characters).

## Checklist

- [x] 1. `src/core/font.ts`: both glyph tables, compile, `layoutText`, `drawText` onto a Raster (with outline/shadow passes); export from `src/core/index.ts`.
- [x] 2. Glyph quality: render the full ASCII set of each font to a PNG under `.claude/temp/` with a tiny script (or a test that writes it when an env var is set) and look at it; fix unreadable glyphs. Lowercase in "small" must be clearly lowercase; digits 0/O and 1/l/I must differ in "small".
- [x] 3. Tools `draw_text`, `measure_text` in `src/tools/defs/drawing.ts` (or a new `defs/text.ts` registered in `defs/index.ts`).
- [x] 4. Tests (`tests/core/font.test.ts`, tool tests): every ASCII char has a glyph of the declared height; measure equals the drawn bounds; wrap at maxWidth; align center offsets; scale 2 doubles size; outline/shadow pixels only in the given colors; non-ASCII -> box + `unknownChars`.
- [x] 5. Docs: `docs/llm-guide.md` (+ `yarn gen:guide`), `ROADMAP.md`: remove the font from "Drawing" (the Drawing item is then fully done: remove it) and "text" from the VN item.
- [x] 6. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`.

## Acceptance

- `draw_text {"text":"Hello, world!","x":2,"y":2,"color":"#fff1e8","font":"small"}` writes readable text; `measure_text` predicts its box exactly.
- All checks pass.

## Results

- Steps 1-6 done. `yarn typecheck`, `yarn lint`, `yarn build` pass; `yarn test`: 46 files, 426 tests passed. Tools in new `src/tools/defs/text.ts` (registered in `defs/index.ts`), tool count 65 -> 67.

## Deviations

- "small" line height is 10 (not 9): glyphs are 9 rows (descenders on rows 7-8), plus a 1 px gap so descenders do not touch the next line's capitals. "tiny" is 6 as planned.
- `outline` is `scale` canvas pixels wide (1 font pixel) and the default shadow offset is `scale` (not 1), so both stay proportional at scale > 1. At scale 1 this is exactly the planned 1 px.
- Result text is the usual paintCel line plus a note "Text box WxH at (x,y), N lines." (and a note for unknown characters).
- Guide short section: to stay <= 1500 chars the "Big scenes" line lost "not line + flood_fill" and "whole" and gained "Text: `draw_text`, `measure_text`." (the full guide keeps the polygon bullet that says it).
- "tiny" has no lowercase of its own: a..z reuse the capital shapes (small caps, PICO-8 style), documented in the font comment, the `draw_text` description and the guide. This replaces the first tiny-lowercase design, which was not readable.
- Glyph review (after looking at the rendered sheets, twice): "small" needed no fixes. "tiny" capitals/symbols redrawn: `Q` (now distinct from O/0), `&`, `@`, `$`, `~`; `N`, `M`, `W`, `O`, `0`, `B`, `D`, `#`, `5`/`S`, `2`/`Z` kept (checked distinct, except 2/Z and 5/S differ by one pixel). Test: tiny 'a' === 'A' and N/H/M/U, Q/O/0, B/D/8, D/0/O, 0/O, 5/S differ.
