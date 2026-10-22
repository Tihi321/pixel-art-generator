# PAR-11 changelog

## 2026-10-22: built-in pixel fonts, `draw_text` and `measure_text`

Branch `PAR-07-13_roadmap`, one commit for this ticket.

### Files

- `src/core/font.ts` (new, exported from `src/core/index.ts`): fonts "tiny" (3x5, line height 6, small caps: lowercase uses the capital shapes) and "small" (5x7 caps, real lowercase with descenders, line height 10), printable ASCII 32..126 as readable `#`/`.` rows; accented Latin letters draw as their base letter, any other character as a hollow box counted in `unknownChars`; `layoutText` (line breaks, `maxWidth` wrap with long-word breaking, align, letter/line spacing, integer scale) and `drawText` (shadow, outline, glyphs).
- `src/tools/defs/text.ts` (new, registered in `src/tools/defs/index.ts`): `draw_text` (through `paintCel`: layer/frame/document, one undo step; max 2000 chars; outline and shadow) and `measure_text` (readOnly, JSON `{width,height,lines,unknownChars}`).
- `docs/llm-guide.md`, `src/tools/guideText.ts`: "Text" section; short guide mentions both tools.
- `ROADMAP.md`: the "Drawing" section is gone (the font was its last item); "text" removed from the VN item.
- Tests: new `tests/core/font.test.ts` (coverage and heights, distinct look-alikes 0/O, 1/l/I, N/H/M/U, Q/O/0, B/D/8, 5/S; tiny small caps; descenders; accents and unknown chars; layout, wrap, align, scale; outline/shadow colours; clipping), 3 tool tests in `tests/tools/drawing.test.ts`; tool counts 65 -> 67.

### Deviations

- "small" line height is 10, not 9 (9-row glyphs plus a 1 px gap so descenders do not touch the next line).
- "tiny" draws small caps instead of its own lowercase (3x5 has no room for a readable lowercase; this is the PICO-8 approach). Decided at review after looking at the first render.
- Outline width and default shadow offset are `scale` canvas pixels (1 font pixel), so they stay proportional at scale > 1.
- `measure_text` has no `align` (the box is the widest line, or `maxWidth` when aligned with one).
- The short guide's "Big scenes" line was shortened to fit "Text: draw_text, measure_text" under 1500 chars; the full guide still says to prefer filled polygons over line + flood_fill.

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 46 files, 426 tests passed. `yarn build`: ok.
- Visual: full ASCII sheets of both fonts and sample sentences at scale 1 and 4 under `.claude/temp/par11-*.png`, reviewed by the implementer and the orchestrator. In "tiny", fixed `&`, `@`, `$`, `~`, `Q` and the lowercase (now small caps). `@` is the weakest glyph; `2`/`Z` and `5`/`S` differ by one pixel.

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-11: Built-in pixel fonts with draw_text and measure_text".
