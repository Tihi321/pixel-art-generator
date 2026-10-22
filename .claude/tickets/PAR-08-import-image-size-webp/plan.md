# PAR-08: `import_image` goes up to 2048x2048 and reads WebP

Ticket folder: `.claude/tickets/PAR-08-import-image-size-webp/`. Branch: `PAR-07-13_roadmap` (one commit for this ticket).

Source: `ROADMAP.md` > "Documents and sessions", item 3: "`import_image` caps at 512x512 and reads no WebP."

## Goal

- `import_image` (and the converter `convertImage`/`resolveTargetSize`) accepts an output size up to 2048x2048 (was 512x512). A 1920x1080 or 960x540 pixel background can be imported directly.
- WebP (and the other formats Chromium decodes: GIF first frame, BMP, AVIF, ICO) can be imported in the app and in headless mode. `open_document` and `draw_sprite_from_reference` get the same decoder (they use `decodeImageFile`).

## Decisions

- `MAX_IMPORT_SIDE = 2048` in `src/core/convert.ts`. Check the cost: `medianCutPalette`, `remapToPalette` (floyd) and `cleanupOrphans` on 2048x2048 (4M px) must finish in a few seconds; add a test that converts a 2048x1152 synthetic image in under ~5 s (skip the timing assert in CI-ish slow runs: assert only that it completes, and log the time). If any step is quadratic, fix it.
- Also guard the SOURCE size: refuse a decoded image above 16384x16384 or 64M pixels with a readable error (protects memory).
- **WebP decoding in the Electron main process:** `nativeImage` reads PNG/JPEG only. Add a Chromium decoder fallback in `src/main/imageDecode.ts`: a lazily created hidden `BrowserWindow` (`show: false`, `webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true }`, loading `about:blank`), and `webContents.executeJavaScript` that turns the bytes (passed as base64) into a `Blob` -> `createImageBitmap` -> `OffscreenCanvas` -> `getImageData` with `premultiplyAlpha: 'none'` / `colorSpaceConversion: 'none'`, and returns `{width,height,base64}` of the RGBA bytes. Convert to packed `0xAABBGGRR` (alpha 0 -> 0). One decoder window, reused; calls serialized; closed on `before-quit`. Headless mode may create this hidden window (it is never shown; `window-all-closed` is already ignored there).
  - `decodeWithNativeImage` becomes `decodeImage` (async): try `nativeImage` first (fast, PNG/JPEG); when `isEmpty()`, use the Chromium decoder; if that fails too: "the image format is not supported (PNG, JPEG, WebP, GIF, BMP, AVIF)".
  - Keep the main-process glue thin and the pure conversion (`bgraToPacked`, `rgbaBytesToPacked`) in a testable function without Electron imports.
- `IMAGE_EXT` in `defs/studio.ts` (used by `open_document` to tell an image from a project) adds gif, bmp, avif.
- Error text in `decodeImageFile` for hosts without a decoder: unchanged meaning ("this host reads PNG files only").
- Descriptions: `import_image` and the guide say "PNG, JPEG, WebP (and GIF/BMP/AVIF) in the app and headless; PNG only in plain Node" and "Max 2048x2048".

## Checklist

- [x] 1. `src/core/convert.ts`: cap 2048, source-size guard, error texts; performance check.
  - Done: cap 2048, MAX_SOURCE_SIDE 16384 / MAX_SOURCE_PIXELS 64M guard in resolveTargetSize. 2048x1152 floyd conversion ~6 s in the test (median cut ~3.4 s on a synthetic image with ~2M distinct colours, remap 0.6 s, floyd 0.2 s, cleanup 0.3 s, resize 0.08 s); nothing quadratic, left as is.
- [x] 2. `src/main/imageDecode.ts`: async `decodeImage` with the Chromium fallback; pure pixel conversion helper (new small module, e.g. `src/main/pixelBytes.ts`, or exported from imageDecode without importing electron at module top - choose the clean split so tests can import the helper without Electron).
  - Done: src/main/pixelBytes.ts (bgraToPacked, rgbaBytesToPacked, no Electron) + async decodeImage in imageDecode.ts (nativeImage first, hidden offscreen BrowserWindow fallback, serialized, destroyed on before-quit).
- [x] 3. Wire the new decoder in `src/main/index.ts` (window services and headless services) and the IPC `fsDecodeImage` handler if it calls the old function (`src/main/services.ts`).
  - Done: index.ts passes decodeImage to the window and headless services; the IPC handler in services.ts already returns services.decodeImage(...) so it needed no change. Deviation: the decoder window is also disposed when the main window closes, else the hidden window would block window-all-closed.
- [x] 4. `src/tools/defs/studio.ts`: descriptions, `IMAGE_EXT`.
  - Done: descriptions, IMAGE_EXT (gif, bmp, avif).
- [x] 5. Tests: `tests/core/convert.test.ts` (2048 accepted, 2049 rejected with the message, big conversion completes), helper conversion test (BGRA/RGBA bytes -> packed, alpha 0 -> 0).
  - Done: convert.test.ts (2048 ok, 2049 refused, source guard, 2048x1152 completes), tests/main/pixelBytes.test.ts; tests/tools/studio.test.ts oversize PNG changed from 600 to 2100 px wide (600 is now allowed).
- [x] 6. Live check after `yarn build`: write a small WebP (e.g. with the Chromium decoder's inverse is not available - instead generate a WebP with a tiny script using an existing tool on the machine if one exists, or commit a tiny WebP test fixture as base64 in the test), start `yarn mcp --port 7599` and call `import_image` on it over MCP. Record the result in the changelog. If no WebP can be produced, say so.
  - Done: after yarn build ran electron . --mcp-only --port 7599 with PIXEL_STUDIO_HOME under .claude/temp/live. import_image on an ffmpeg lossless WebP gave byte-identical exported PNG to the PNG of the same source; lossy WebP imported; alpha WebP kept alpha (transparent at default threshold, opaque with alphaThreshold 10); a bogus .webp gave the 'format is not supported' error. Server stopped.
- [x] 7. Docs: `docs/llm-guide.md` (+ `yarn gen:guide`), `README.md` (the table row and "Image decoding" sentence), `ROADMAP.md` (remove the item).
  - Done: llm-guide (+ yarn gen:guide), README table and decoding sentence, ROADMAP item removed.
- [x] 8. Verify: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`.
  - Done: typecheck and lint clean; 41 test files / 379 tests passed; build ok.

## Acceptance

- `import_image {width:1920,height:1080}` works; 2049 is refused with a clear message.
- A WebP file imports in headless mode (`yarn mcp`) and in the window app.
- All checks pass.
