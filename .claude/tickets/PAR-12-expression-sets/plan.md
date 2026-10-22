# PAR-12: Expression sets for VN character sprites

Ticket folder: `.claude/tickets/PAR-12-expression-sets/`. Branch: `PAR-07-13_roadmap` (one commit for this ticket).

Source: `ROADMAP.md` > "Visual novel assets": "No expression-set tool (VN Studio has expression sets per book and character since VNO-08)."

## Context

VN Studio (see `C:\projects\Personal\visual-novels-orchestrator\docs\mcp-guide.md`, "Expressions") keeps, per book and character, a list of expression names (default: neutral, happy, sad, angry, surprised, worried, scared, thinking; custom names are lowercase letters and digits). Each character needs one sprite per expression it uses: a transparent PNG, bottom-aligned, same size for all expressions. Today an agent must make one document per expression with `draw_sprite_from_reference` and redraw the whole body each time.

## Goal

One document holds a character's whole expression set: the base pose once, one frame per expression, the face redrawn per frame; one call exports every expression as `<prefix>_<expression>.png`.

## Decisions

- **Frames + tags.** `make_expression_set` turns a sprite document into an expression set: frame per expression, each frame tagged with the expression name (a one-frame tag, `from = to`). Frames keep all layers (the reference layer too), so the body stays identical and the agent only edits the face.
- **Frame references by tag name.** `resolveFrame` (src/tools/util.ts) also accepts the name of a one-frame tag, so `{"frame":"happy"}` works in every drawing tool, `render_preview`, `export_png`, `set_active`. An id or index still wins over a tag name. Document it in `FRAME_REF_DESC`.
- **`make_expression_set {expressions, base?, face?, document?}`** (changes the document, one undo step):
  - `expressions`: 1..24 names (`/^[a-z0-9]+$/`, deduplicated). `base`: the frame with the finished pose (default the active frame).
  - The base frame gets the first expression's tag if it has none (usually "neutral"); a frame is duplicated from the base for each other expression that has no tag yet (existing expression tags are kept, so the call can be repeated to add expressions).
  - `face`: optional `{x,y,w,h}` region where the face is; stored on the document? No new document field: return it in the guidance and JSON only (keep the model unchanged).
  - Result: guidance text (per expression: what to change - brows, eyes, mouth, head tilt - with one line per default expression name, e.g. "surprised: brows up, eyes round and wide, mouth a small o") plus JSON `{documentId, expressions:[{name, frame, frameId, tagId}], face}`.
- **`export_expression_set {dir, prefix?, width?, height?, scale?, expressions?, document?}`** (readOnly): writes one PNG per expression tag (all one-frame tags that `make_expression_set` made, or the listed `expressions`) as `<dir>/<prefix>_<name>.png` (prefix default: safe document name), same size for all, nearest scaling as `export_png`. Returns text plus JSON `{files:[{expression, path}], width, height}`. Reference layers and hidden layers are not exported (as export_png).
- `draw_sprite_from_reference` gains optional `expressions: string[]`: after creating the document it calls the same core logic so the set exists from the start (guidance lists the expressions). Its existing single `expression` arg stays.
- Pure logic in `src/tools/expressions.ts` (or core if it needs no tool helpers): add frames/tags via existing commands (`createDuplicateFrameCommand`, `createCreateTagCommand`), so undo works.

## Checklist

- [x] 1. `resolveFrame` accepts a one-frame tag name; tests (id/index precedence, multi-frame tag is not a frame ref).
- [x] 2. `src/tools/expressions.ts` + tools `make_expression_set`, `export_expression_set` (new `defs/vn.ts` group `documents`, or in `defs/studio.ts`); `draw_sprite_from_reference` `expressions`.
- [x] 3. Tests: set of 3 from a drawn base (frames identical to base, tags named), repeat call adds only new ones, draw on `frame:"happy"` changes only that frame, export writes 3 equally sized PNGs with the right names (memory services), invalid names rejected, undo removes the whole set step.
- [x] 4. Docs: `docs/llm-guide.md` section "VN expression sets" with the workflow (draw base -> make_expression_set -> per expression: render_preview frame, draw_grid on the face region with frame:"<name>" -> export_expression_set), `yarn gen:guide`; `README.md` VN tools table rows; `ROADMAP.md` remove the item.
- [x] 5. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`.

Notes (done): step 1 resolveFrame (src/tools/util.ts; order id, index/numeric string, one-frame tag name; multi-frame tag gives an explicit error); writeDocumentPng now uses resolveFrame, so export_many/export tools accept tag names too. Step 2 src/tools/expressions.ts (applyExpressionSet, expressionGuidance, expressionTags, expressionNames) + tools in src/tools/defs/studio.ts (make_expression_set group documents, export_expression_set group export). Step 3 tests/tools/expressions.test.ts (10 tests); tool-count assertions 67 -> 69. Step 4 llm-guide.md "VN expression sets" (full guide only; short section untouched), README rows, ROADMAP item removed, yarn gen:guide. Step 5 typecheck, lint, test (47 files, 435 tests), build pass.

## Deviations

- No `defs/vn.ts`: both tools live in `defs/studio.ts` next to draw_sprite_from_reference.
- `draw_sprite_from_reference expressions`: the set is applied to the new document before it is opened (cmd.apply), so it is not an undo step; frames are empty copies, the guidance tells the agent to draw on the first frame and copy_cel to the others.
- Extra: writeDocumentPng resolves frames via resolveFrame; `face` is validated to fit the canvas; copies are appended at the end of the frame list.

## Acceptance

- One document, one frame per expression, addressable by name; one call exports `mara_neutral.png`, `mara_happy.png`, ... at one size.
- All checks pass.
