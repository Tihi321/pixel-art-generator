# PAR-05: Pixel Studio for VN Studio (headless MCP, import_image, exact-size export, round trip)

Ticket folder: `.claude/tickets/PAR-05-vn-studio-art/`. Branch: `PAR-05_vn-studio-art` (from `origin/master` @ 3f2cf19).

This is **Section B** of the cross-repo ticket VNO-02 (`C:\projects\Personal\visual-novels-orchestrator\.claude\tickets\VNO-02-chiptune-and-pixel-studio\plan.md`). The authoritative tool names, inputs and result JSON are in that ticket's `contracts.md` ("Common rules" and "Pixel Studio"). Deviations are listed at the end of this file and in the changelog.

## Goal

VN Studio (Scriptorium books to Ren'Py) needs Pixel Studio as an unattended art tool: convert ComfyUI images to clean pixel art, export them at an exact size, optionally let an agent draw small sprites, and open an asset in the editor and get the saved result back.

## Decisions

- **Headless architecture: tools run in the Electron main process (Node), no hidden window.**
  - `src/main/toolBridge.ts` forwards every call to the renderer because the renderer owns the live `EditorSession`. But `EditorSession`, the registry and the whole core are pure TS (no DOM), and `ToolServices` already has a Node implementation (`createNodeServices`, `AssetStore`). So headless mode builds a `DocumentSet` (several `EditorSession`s) in main and runs `createToolHost(registry, ...)` directly against it. A hidden window would add a renderer boot, IPC hops and a readiness race for no gain.
- **Multiple documents.** A new `DocumentHost` interface (`src/tools/documents.ts`) is passed in `ToolContext.documents`. Headless implements it with `DocumentSet`; the window implements it over the renderer `Workspace` (one tab = one document). `ctx.session` is always the current document, so existing tools are untouched.
- **Document tools are `readOnly`** (no undo transaction): they create or switch documents instead of editing the current one.
- **Image formats.** `import_image` decodes PNG in pure TS (`decodePng`). JPEG/WebP: decoded through an optional `ToolServices.decodeImage` that the Electron main process implements with `nativeImage` (PNG/JPEG); WebP is not guaranteed. Without it, only PNG works and the error says so.
- **Window round trip** reuses the MCP tools: main parses `--open` and calls `open_document` through the tool bridge (first launch and `second-instance`).

## Checklist

- [x] 1. Core conversion pipeline `src/core/convert.ts` (area downscale, alpha threshold, median-cut, remap + none/ordered/floyd dither, cleanup, outline, exact nearest resize, frame export image)
- [x] 2. `DocumentHost` + `DocumentSet` (`src/tools/documents.ts`), `ToolContext.documents`
- [x] 3. Tools: `import_image`, `export_png` (width/height/document + JSON), `export_many`, `draw_sprite_from_reference`, `list_documents`, `open_document`, `save_document`
- [x] 4. Headless `--mcp-only [--port N]` + `yarn mcp`; single-instance lock only in window mode; bind failure does not crash
- [x] 5. Window mode: `--open <path> [--export-to] [--export-width/--export-height]`, `second-instance` forwarding, auto-export on save, `DocumentHost` over `Workspace`
- [x] 6. Docs: `docs/llm-guide.md` (+ `yarn gen:guide`), `README.md`
- [x] 7. Tests: pipeline, export size, tools, headless MCP `tools/list` + `tools/call`
- [x] 8. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`, live `yarn mcp` run with `import_image` + `export_png`
- [x] 9. `changelog.md`

## Deviations from the contract

See `changelog.md` ("Deviations from the contract"): formats (JPEG yes via Electron, WebP no), documentId shapes, headless bind failure exits 1, headless ignores mcp.json, export_png accepts width or height alone.
