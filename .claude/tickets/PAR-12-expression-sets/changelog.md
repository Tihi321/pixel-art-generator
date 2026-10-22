# PAR-12 changelog

## 2026-10-22: expression sets for VN character sprites

Branch `PAR-07-13_roadmap`, one commit for this ticket.

### Files

- `src/tools/expressions.ts` (new): `applyExpressionSet` (base frame gets the first expression's tag; each other new name gets a copy of the base frame and a one-frame tag through the existing commands; existing expression tags kept, so repeat calls only add; a name that is a multi-frame tag throws), the `expressionNames` schema (1..24, `/^[a-z0-9]+$/`), `expressionTags`, `faceRegion`, `expressionGuidance` (a hint per default VN expression, a generic line otherwise).
- `src/tools/util.ts`: `resolveFrame` also accepts the name of a one-frame tag (after id and index); a multi-frame tag name gives a clear error. `FRAME_REF_DESC` says so.
- `src/tools/documents.ts`: `writeDocumentPng` uses `resolveFrame`, so `export_png`/`export_many` take `{"frame":"happy"}`.
- `src/tools/defs/studio.ts`: `make_expression_set {expressions, base?, face?}` (one undo step; guidance + JSON `{documentId, expressions:[{name,frame,frameId,tagId}], face}`), `export_expression_set {dir, prefix?, expressions?, scale?, width?, height?}` (one PNG per expression, same size, no reference/hidden layers; JSON `{files, width, height}`), `draw_sprite_from_reference` gains `expressions`.
- `docs/llm-guide.md`, `src/tools/guideText.ts`: "VN expression sets" section (full guide only). `README.md`: two rows in the VN table. `ROADMAP.md`: item removed.
- Tests: new `tests/tools/expressions.test.ts` (10); tool counts 67 -> 69.

### Deviations

- Both tools live in `defs/studio.ts` (no `defs/vn.ts`).
- With `draw_sprite_from_reference {expressions}` the set is applied before the document opens (not an undo step); the frames start as copies of the reference only, so the guidance says to draw the first frame and `copy_cel` it to the others.
- Extra: export tools accept expression names as frames (`writeDocumentPng` change).

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 47 files, 435 tests passed. `yarn build`: ok.
- End to end (in-process registry): 24x32 figure, `make_expression_set` neutral/happy/sad, a different mouth drawn with `draw_grid {frame:"happy"}` / `{frame:"sad"}`, `export_expression_set {prefix:"mara", scale:8}` wrote `mara_neutral.png`, `mara_happy.png`, `mara_sad.png` (192x256 each): same body, only the mouth differs, transparent background.
- Not run: VN Studio consuming the exported set (it imports sprites per expression through its own tools).

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-12: Expression sets for VN character sprites".
