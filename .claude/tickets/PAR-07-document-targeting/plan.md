# PAR-07: Every tool takes a `document` id; documents can be added, switched and closed

Ticket folder: `.claude/tickets/PAR-07-document-targeting/`. Branch: `PAR-07-13_roadmap` (one branch for the ROADMAP.md tickets PAR-07 to PAR-13, one commit per ticket), cut from `origin/master` @ 877dc8c.

Source: `ROADMAP.md` > "Documents and sessions", items 1 and 2.

## Goal

Two MCP clients (VN Studio, the creative hub, an agent) can draw at the same time without overwriting each other. Today `render_preview` and every drawing tool act on the one current document, `new_document` replaces the current document, and no tool switches the current document. After this ticket:

- Every tool that works on a document accepts an optional `document` (a documentId from `list_documents`). Without it the current document is used, so existing clients keep working.
- `new_document` and `open_project` ADD a document (it becomes current) and return its documentId; they no longer replace the current one.
- `select_document` makes a document current; `close_document` closes one.

## Decisions

- **Central, not per tool.** `defineTool` adds `document: z.string().optional()` to every object input schema unless the tool opts out (`document: false` on the definition) or already declares `document` itself (export_png, save_document, export_many items). `ToolRegistry.execute` resolves `parsed.data.document` through `resolveDocument(ctx, id)` and runs the handler (and its undo transaction) with `ctx.session` = that document's session and `ctx.documentId` = its id. Handlers stay unchanged.
  - Check that `strictObject().extend()` keeps strictness in zod v4 (unknown keys still rejected); add a test.
  - Opt out (`document: false`): the tools that create or list documents and do not act on one: `list_documents`, `open_document`, `import_image`, `draw_sprite_from_reference`, `new_document`, `open_project`, and the palette/asset library tools that never touch a document (`list_palettes`, `save_palette` only if it reads no document - check each in `defs/palette.ts` and `defs/assets.ts`; when unsure keep the arg, it is harmless).
  - The JSON schema of every tool then shows `document` with the description "documentId (see list_documents). Default: the current document." The description text is one shared constant in `util.ts`.
- **ToolContext gains `documentId?: string`**, set by the registry (the resolved id, also when the call had no `document`). `get_document` adds `documentId` to its summary when known (the headless id `docN` / the window tab id differ from `doc.id`, which confused clients).
- **`addDocument(ctx, doc, opts)` moves from `defs/studio.ts` to `documents.ts`** (exported) and is used by `new_document`, `open_project`, and the existing studio tools. Without a host (single-document tests) it still replaces the session's document.
- **`new_document`** returns the human sentence plus the JSON item `{documentId,name,width,height,palette}` (`withJson`, the VN Studio contract). `open_project` returns `{documentId,name,width,height,path}`; when that path is already open it activates it (same as `open_document`).
- **DocumentHost gains `close(documentId, opts?: { force?: boolean })`.**
  - `DocumentSet`: a dirty document needs `force: true` (error text says to `save_document` first or pass force). Closing the current one makes the most recently added remaining one current. Closing the last one leaves a fresh placeholder (32x32 "Untitled"), as at start.
  - Window adapter (`src/renderer/state/actions.ts` `workspaceDocuments`): same rule (dirty needs force, no confirm dialog from a tool), then `workspace.close(id)` + `showActiveTab()` when it was active. A tab the agent is working in cannot be closed (workspace already throws).
- **`select_document {document}`** calls `ctx.documents.activate`; in the window it switches tabs (errors while the agent works in another tab, from `workspace.assertCanLeave`). Without a host: only the single document's id is accepted.
- Both new tools are `readOnly` (no undo step), group `documents`, and end with the JSON item: `select_document` -> `{documentId,name,width,height}`, `close_document` -> `{documentId,closed:true,current}` (current = the id that is current now).
- Serialization stays as is: `createToolHost` runs calls one at a time, so two clients with different `document` ids no longer interfere. Agent turns (`beginTurn`/`endTurn`) stay on the current document.

## Checklist

- [x] 1. `src/tools/registry.ts`: `ToolDefinition.document?: false`, schema extension in `defineTool`, resolution in `execute` (before the transaction; an unknown id is an `isError` result with the "Call list_documents" hint), `ToolContext.documentId`. _Done: registry.ts: `document?: false`, `targetsDocument`, extend with `document` (strict kept, tested), resolution before the transaction, `ctx.documentId`._
- [x] 2. `src/tools/documents.ts`: `close` on `DocumentHost` + `DocumentSet`; exported `addDocument`; `resolveDocument` unchanged. _Done: `close` on DocumentHost + DocumentSet, `UNSAVED_CLOSE_MESSAGE`, exported `addDocument`._
- [x] 3. `src/tools/defs/document.ts`: `new_document` and `open_project` add instead of replace (+ JSON); `get_document` includes `documentId`; new `select_document`, `close_document` (in `document.ts` or `studio.ts` next to `list_documents` - pick `studio.ts`, group `documents`). _Done: new_document/open_project add (+JSON, readOnly, open path is activated); get_document has documentId; select_document/close_document in studio.ts._
- [x] 4. Opt-outs on the tools listed above; `defs/studio.ts` uses the moved `addDocument`. _Done: Opt-outs: list_documents, open_document, import_image, draw_sprite_from_reference, new_document, open_project, export_many, list_palettes, list_assets, get_asset._
- [x] 5. Window adapter `close` in `src/renderer/state/actions.ts`. _Done: `workspaceDocuments.close` (dirty needs force, then workspace.close + showActiveTab). Not run in a real window._
- [x] 6. Tests (`tests/tools/`, `tests/main/headless.test.ts`): _Done: tests/tools/documents.test.ts (11 tests) + headless two-client test; counts 60 -> 62 updated. No existing test needed an undo change._
  - every tool's JSON schema has `document` except the opt-outs; strictness kept (an unknown arg is still an error);
  - two documents in a `DocumentSet`: `draw_rect {document: A}` and `draw_rect {document: B}` change only their own document; `render_preview {document}` renders that one; undo with `document` undoes in that document only;
  - `new_document` keeps the previous document (list_documents shows both) and returns JSON with documentId;
  - `select_document` changes `current`; `close_document` refuses a dirty document without force, closes with force, closing the last leaves a placeholder;
  - unknown `document` -> error result, document untouched;
  - headless MCP: two `new_document` calls, draws to each by id, `export_many` both.
  - Update existing tests that assumed `new_document`/`open_project` replace the document (undo of new_document).
- [x] 7. Docs: `docs/llm-guide.md` (short guide line: "every tool takes `document`"; the "Several documents" section rewritten: documents are independent, pass `document` when several clients work at once; new_document adds; select/close), then `yarn gen:guide`; `README.md` headless paragraph; `ROADMAP.md`: remove the two items this ticket fixes. _Done: llm-guide (short line + section), gen:guide, README, ROADMAP (2 items removed)._
- [x] 8. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`. _Done: typecheck, lint clean; test 40 files / 375 tests pass; build ok._

## Acceptance

- `tools/list` over MCP: every document tool shows an optional `document` string.
- Two clients drawing in parallel on two documents (by id) do not change each other's document; previews and exports are per document.
- `new_document` never discards an existing document; `select_document` and `close_document` exist and work headless and in the window.
- All checks pass.

## Deviations

- `export_many` is also opted out of the top-level `document` (its items carry their own), so it is not in the plan's opt-out list but is in the code and test.
- Opt-outs also include `list_assets` and `get_asset` (never touch a document); `list_palettes` only of the palette tools (the others read the document palette).
- `new_document` and `open_project` are `readOnly` (like `import_image`): they add via the host, so no undo transaction. Without a host they still replace the session document.
- `DocumentSet.close` also refuses a document with an active agent turn (same rule as the window).
- `select_document` / `close_document` declare a required `document` themselves (central resolution still applies).
