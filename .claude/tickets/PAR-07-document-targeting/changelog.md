# PAR-07 changelog

## 2026-10-22: every tool takes `document`; documents are added, selected and closed

Branch `PAR-07-13_roadmap` (from `origin/master` @ 877dc8c), one commit for this ticket.

### Files

- `src/tools/registry.ts`: `defineTool` adds an optional `document` string to every object input schema (strictness kept), unless the tool sets `document: false` or declares `document` itself. `execute` resolves it before the undo transaction and runs the handler with that document's session; `ToolContext.documentId` is the resolved id. Unknown id: an error result, nothing touched.
- `src/tools/util.ts`: shared `DOCUMENT_DESC`.
- `src/tools/documents.ts`: `DocumentHost.close(id, {force})`; `DocumentSet.close` (dirty needs force, not during an agent turn, the newest remaining becomes current, the last leaves a blank placeholder); `addDocument` moved here.
- `src/tools/defs/document.ts`: `new_document` and `open_project` add a document (readOnly, JSON result; an open project path is just activated); `get_document` reports `documentId`.
- `src/tools/defs/studio.ts`: new `select_document`, `close_document`; opt-outs on the tools that create/list documents and `export_many`.
- `src/tools/defs/palette.ts`, `src/tools/defs/assets.ts`: opt-outs for `list_palettes`, `list_assets`, `get_asset`.
- `src/renderer/state/actions.ts`: window adapter `close` (dirty tab needs force, no confirm dialog).
- `docs/llm-guide.md`, `src/tools/guideText.ts`, `README.md`, `ROADMAP.md`: documented; the two roadmap items removed.
- Tests: new `tests/tools/documents.test.ts` (11 tests), a two-client headless MCP test in `tests/main/headless.test.ts`, tool counts 60 -> 62 in registry/toolBridge/server/stdio tests.

### Deviations from the plan

- `export_many` opts out of the top-level `document` (its items carry one); `list_assets`/`get_asset` opt out too.
- `new_document`/`open_project` are `readOnly` like `import_image`: with a host no undo step (the old document stays open); without a host they still replace (undoable).
- `DocumentSet.close` also refuses a document in an agent turn (same rule as the window).

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 40 files, 375 tests passed (363 before). `yarn build`: ok.
- Not run: the window adapter's `close` in a real window (typecheck/build only).

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-07: Every tool takes a document id; add select_document and close_document".
