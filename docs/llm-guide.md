# Pixel Studio: guide for LLM agents

You are driving Pixel Studio, a pixel-art editor with layers, animation frames, palettes and export. You edit the artwork through tools. The user watches every edit happen live and can undo it. Each tool call is one undo step, and a whole agent turn is one undo step in total.

<!-- short:start -->
Pixel Studio quick guide
- Canvas: origin (0,0) is top-left, x goes right, y goes down. Layers and frames are addressed by id, name or 0-based index. Edits go to the active layer and frame unless `layer` / `frame` are given.
- Workflow: `get_document` -> pick a palette (`list_palettes`, `load_palette`, or `set_palette` for your own) -> sketch the silhouette with `draw_grid` -> shade -> outline -> `render_preview` to check -> fix -> export.
- `draw_grid`: rows of text, one character per pixel, plus a legend {char: "#hex" | palette index | null}. Max 64x64 per call; use x,y to place it. `read_grid` returns pixels in the same format.
- Use only palette colours and hue-shifted ramps (shadows cooler, highlights warmer). Keep sprites small (16-64 px).
- Animation: `duplicate_frame`, then edit only the differences; keep pixel counts stable; name loops with `create_tag` (idle 2-4 frames, walk 4-8, attack 3-6); `set_frame_duration` in ms.
- References: if `get_document` lists `references`, call `get_style_context` first and use exactly its palette. Library: `list_assets`, `place_asset`, `save_as_asset`.
- Export: `export_png` (`width`+`height` = exact size), `export_spritesheet`, `export_gif`. `undo` / `redo` fix mistakes.
- Images: `import_image` makes pixel art from a PNG in a new document. Several documents: every tool takes an optional `document` id (`list_documents`); `new_document` adds one.
- Errors come back as text: read them and correct the call.
<!-- short:end -->

## Coordinates and layers

- The canvas is `width` x `height` pixels. The origin (0,0) is the top-left pixel. x grows to the right, y grows downward.
- A document has layers (bottom to top) and frames (time). A pixel image of a layer in a frame is called a cel. Cels are sparse: an empty cel costs nothing.
- Layers are addressed by id, exact name or 0-based index (0 = bottom layer). Frames by id or 0-based index.
- Most drawing tools take optional `layer` and `frame`; the default is the active layer and active frame. Use `set_active` to change them, and `add_layer` / `add_frame` make the new one active.
- Use separate layers for outline, shading, background and effects so you can fix one thing without touching the rest. `update_layer` changes name, visibility, opacity, blend mode and lock; `move_layer`, `duplicate_layer`, `delete_layer` and `merge_down` do what they say.

## Workflow for a new sprite

1. `get_document` to see the size, layers, frames, tags and palette. If the user wants a fresh canvas, call `new_document` with a size and a palette id, for example `{"width":32,"height":32,"name":"knight","palette":"endesga-32"}`.
2. Choose colours. `list_palettes` shows built-in palettes (PICO-8, DB32, Endesga 32/64, Sweetie 16, Game Boy, NES, CGA and more) and the user's saved ones. `load_palette` applies one. For a custom scheme ("moody 12-colour forest") call `set_palette` with your own list, and `save_palette` to keep it. `add_colors` and `remove_colors` adjust a palette.
3. Sketch the silhouette in one flat colour with `draw_grid`. Get the proportions right first (head, torso, limbs).
4. Add the base colours, then shading and highlights.
5. Add the outline, on its own layer if you like. `outline` can generate one around existing pixels.
6. Call `render_preview` to look at the result. Zoom into details with its `region` option. Fix what you see.
7. Export when asked (see below).

## Drawing with draw_grid

`draw_grid` is the main primitive. You send rows of characters and a legend:

```json
{
  "rows": ["..kk..", ".kssk.", ".kssk.", "..kk.."],
  "legend": {".": null, "k": "#1a1c2c", "s": "#f4b41b"},
  "x": 10,
  "y": 4
}
```

- One character is one pixel. All rows must have the same length. The grid's top-left lands at (x, y).
- The legend maps a character to a hex colour, a palette index, or null for transparent. Without a legend, characters are palette indices: 0-9, then a-z, then A-Z, and "." is transparent. These are the same characters `read_grid` prints.
- Transparent cells leave existing pixels alone. Pass `"transparent": "clear"` when the grid should replace its rectangle completely (erasing as well).
- Keep each call at 64x64 characters or smaller. For bigger art send several grids with different x and y.
- Edit existing art with `read_grid` (it returns `legend` and `rows`), change a few characters, and send it back with `draw_grid` using `"transparent":"clear"`.
- For small touch-ups use `set_pixels`. Other tools: `draw_line`, `draw_rect`, `draw_ellipse`, `flood_fill`, `replace_color`, `clear_cel`, and `transform_cel` (flip, rotate, shift).

## Palette and colour rules

- Use only colours from the document palette. A colour can be given as a hex string, a palette index (`8` or `"p8"`), a palette colour name or "transparent".
- Build ramps of 3-5 colours per material with a hue shift: shadows move toward blue/purple and get darker, highlights move toward yellow/orange and get lighter. Avoid pure black and pure white.
- Limit the number of colours: a small sprite usually needs 8-16.
- `remap_to_palette` snaps existing art to the nearest colours of another palette, which turns the artwork into a new colour scheme. `load_palette` with `remap` does the same while switching palettes.
- `import_palette` and `export_palette` read and write .hex, .gpl and .pal files.

## Animation

- Start from a finished base pose. `duplicate_frame` copies a frame with all its layers, then edit only the differences with `draw_grid` / `set_pixels`.
- Keep pixel counts and volume stable between frames so the character does not seem to grow or shrink. Move limbs by a pixel or two per frame.
- Typical frame counts: idle 2-4, walk 4-8, run 6-8, attack 3-6, jump 4-6.
- Frame duration is in milliseconds (100 ms = 10 fps). `set_frame_duration` changes it for a frame; hold keyframes longer than in-betweens.
- Name animations with `create_tag`, for example `{"name":"walk","from":0,"to":3}`. Tags end up in the exported metadata. `update_tag` and `delete_tag` change them; `move_frame`, `delete_frame` and `copy_cel` rearrange frames.
- Check animations by rendering several frames with `render_preview` (the `frame` option, and `onion` to see neighbours).

## References and assets

The asset library holds finished art (kinds: character, background, tile, prop), each with tags, style notes, a palette and a preview. An asset can be reused directly or used as a style reference.

- `list_assets` shows the library (filter by `kind` and `tags`). `get_asset` shows one asset: metadata, palette, a grid of one frame (up to 64x64, pass `region` for a part of a bigger one) and a preview image.
- **Style references:** when `get_document` lists `references` (or the user mentions a reference or "this style"), call `get_style_context` BEFORE drawing. It returns, for each reference, the exact palette colors, size, a small sample grid, the user's style notes and preview images, plus the merged palette of all references. Then:
  1. Set the document palette to those colors (`set_palette` or `load_palette`) and use only them.
  2. Match the size and proportions (head-to-body ratio, silhouette), the outline (colour, thickness, whether there is one), and the amount of shading and highlight.
  3. Follow the style notes literally.
  4. After drawing, `render_preview` and compare with the reference; fix differences.
- `set_style_reference` attaches assets to the document (`ids`, `action` add/remove/set/clear). With `showLayer` true a dimmed, locked reference layer is added so the user can see it in the editor; reference layers are never exported.
- **Reuse:** `place_asset` stamps an asset at `x`,`y` on the active layer, a given `layer`, or a new layer (`newLayer`). With `frames: "all"` it copies the asset's whole animation onto consecutive frames and adds frames when needed. Placed colors are not changed; if they are not in the document palette you are told, and `remap_to_palette` snaps them. Edit the result afterwards like any other art.
- **Saving:** `save_as_asset` stores part of the document: `source` "document", "layer", "frames" (a range) or "region" (a rectangle). Give a clear `name`, a `kind`, a few `tags` and `notes` that describe the style (outline, shading, palette mood), because those notes are what the next artist reads. Pass `id` to update an existing asset. Only save art the user asked to keep.

## Several documents, images and VN Studio

Pixel Studio can hold several documents at once (tabs in the window, an in-memory set when it runs headless). Every document has a `documentId`; `list_documents` shows them. Documents are independent: `new_document`, `open_project`, `open_document`, `import_image` and `draw_sprite_from_reference` ADD a document (it becomes the current one) and never replace another. **Every tool that works on a document takes an optional `document` id** (default: the current document). When several clients or agents work at once, pass `document` on every call, because another client may have made a different document current in the meantime. `select_document {document}` makes a document current; `close_document {document, force?}` closes one (a document with unsaved changes needs `force` or a `save_document` first; closing the last one leaves a blank 32x32 document). `new_document` returns the `documentId` in its JSON item.

- `import_image {path, width, height, palette, dither, outline, cleanup}`: converts a PNG, JPEG, WebP (and GIF/BMP/AVIF) image (PNG only in plain Node; the app and headless mode read the rest) to clean pixel art in a new document: area-average downscale that respects transparency, alpha threshold, snap to the palette (`none`, `ordered` or `floyd` dithering; transparent pixels are never dithered), removal of orphan single pixels, optional 1 px `outline` (`true` = the darkest palette colour, or a hex colour). Without `palette`, `maxColors` (default 32) colours are picked from the image. Max 2048x2048 (a 1920x1080 background imports directly). Example: `{"path":"C:/art/bg.png","width":320,"height":180,"palette":"db32","dither":"ordered"}`.
- `export_png {width, height}`: an exact output size with nearest-neighbour scaling, not only integer factors. A 320x180 document exported at `1920x1080` is a clean 6x. `export_many {items:[{document, path, width, height, frame}]}` writes several files in one call.
- `draw_sprite_from_reference {reference, width, height, palette, expression}`: for chibi or retro sprites up to 128x128. It makes a new document with the reference as a dimmed, locked, never-exported reference layer. You then paint the layer "Sprite" with `draw_grid`, compare with `render_preview`, and export.
- `open_document {path, exportTo, exportWidth, exportHeight}` opens a `.pxs` project or a PNG. With `exportTo` every `save_document` (and Ctrl+S in the window) also writes the PNG there, so edits flow back to the app that asked for them. `save_document {document, path}` saves the project.
- The new and changed tools end their result with one JSON object (documentId, size, paths, ...) after the readable text.
- **Headless:** `yarn mcp` (`electron . --mcp-only [--port N]`, after `yarn build`) serves the same tools at `http://127.0.0.1:7457/mcp` with no window. In the window app, `--open <path> [--export-to <path>] [--export-width W --export-height H]` opens a document in the running or a new window.

## Export

- `export_png`: the current frame, or all frames as separate files (`"frames":"all"`). Supports `scale`, or an exact `width` x `height`.
- `export_spritesheet`: one PNG with all frames plus a JSON file next to it. Options: `layout` (horizontal, vertical, grid with `columns`, packed), `scale`, `padding`, `border`, `tags`, `layers`, and the JSON `format` (aseprite-array, aseprite-hash, texturepacker). Example: `{"path":"knight","layout":"grid","columns":4,"scale":2,"padding":1}`.
- `export_gif`: an animated GIF, optionally of one tag.
- All three return the written file paths. Relative names go to `~/PixelStudio/exports`. Tell the user where the files are.
- `save_project` writes a lossless `.pxs` project; `open_project` loads one.

## Limits and good habits

- Work small: 16x16 to 64x64 is the sweet spot. The maximum canvas is 4096x4096.
- Do one thing per call so that each step can be undone on its own. `undo` and `redo` are tools too, but only undo your own mistakes.
- If a call returns an error, the document was left unchanged. Read the message; it says what to fix.
- Do not paste the full image back as text unless asked. Describe what you did in a sentence or two.
