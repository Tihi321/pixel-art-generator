# PAR-08 changelog

## 2026-10-22: `import_image` up to 2048x2048, WebP/GIF/BMP/AVIF decoding

Branch `PAR-07-13_roadmap`, one commit for this ticket.

### Files

- `src/core/convert.ts`: `MAX_IMPORT_SIDE` 512 -> 2048; a source guard (`MAX_SOURCE_SIDE` 16384, `MAX_SOURCE_PIXELS` 64M) with a readable error.
- `src/main/pixelBytes.ts` (new, no Electron): `bgraToPacked`, `rgbaBytesToPacked` (alpha 0 -> 0).
- `src/main/imageDecode.ts`: async `decodeImage`: `nativeImage` first (PNG/JPEG), else a lazily created hidden offscreen `BrowserWindow` decodes with `createImageBitmap` + `OffscreenCanvas` (one call at a time; destroyed on quit). Unsupported files: "the image format is not supported (PNG, JPEG, WebP, GIF, BMP, AVIF)".
- `src/main/index.ts`: window and headless services use `decodeImage`; the main window's `closed` handler disposes the decoder window so `window-all-closed` still fires.
- `src/tools/defs/studio.ts`: `IMAGE_EXT` adds gif/bmp/avif; descriptions list the formats per host.
- `docs/llm-guide.md`, `src/tools/guideText.ts`, `README.md`, `ROADMAP.md`: updated; roadmap item removed.
- Tests: `tests/core/convert.test.ts` (2048 ok, 2049 refused, source guard, 2048x1152 floyd conversion completes, time logged), new `tests/main/pixelBytes.test.ts`, `tests/tools/studio.test.ts` (the "too large" case now 2100 px).

### Deviations

- `src/main/services.ts` unchanged (its `fsDecodeImage` handler already calls `services.decodeImage`).
- Decoder disposal on main-window close (not in the plan; needed so the app quits).
- Performance: a 2048x1152 floyd conversion of a noisy synthetic image takes ~6 s (median cut ~3.4 s with ~2M distinct colours). Nothing quadratic; left as is.

### Verification

- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 41 files, 379 tests passed. `yarn build`: ok.
- Live, headless (`electron . --mcp-only --port 7599`, temp `PIXEL_STUDIO_HOME`), `import_image` over MCP: lossless WebP 64x36 imported and its `export_png` was byte-identical to the same image imported from PNG; lossy WebP ok; alpha WebP read (alpha just under 128 -> transparent at the default threshold, opaque with `alphaThreshold: 10`); a bogus `.webp` gave the unsupported-format error.
- Not run: the window app (same decoder through the existing IPC path); GIF/BMP/AVIF live; the source guard applies after decoding, so it does not protect the decode itself.

### Commit status

Committed on `PAR-07-13_roadmap` as "PAR-08: import_image up to 2048x2048 and WebP decoding".
