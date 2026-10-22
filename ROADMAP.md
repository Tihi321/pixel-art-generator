# Roadmap

What Pixel Studio still lacks, found while VN Studio and the creative hub (`C:\projects\Personal\creative-hub`) drove it over MCP (2026-10-20, the pixel-art book *The Soother That Fell into Dragon Land*). Moved here from the hub's `ROADMAP.md` on 2026-10-22. Most important first. Finished work is in `.claude/tickets/` (PAR-05 headless MCP, `import_image` and exact-size export for VN Studio). Fix items on a ticket branch (`PAR-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 52d9f51)

- Headless MCP on `127.0.0.1:7457/mcp` (`--mcp-only`), used by VN Studio for pixel conversion and drawing. VN Studio's VNO-08 added a `grid` draw mode (one call per sprite), so the client provider can draw without a per-turn timeout.

## Documents and sessions

- **One current document, shared by every client.** `render_preview` and every drawing tool act on it, so two agents drawing at once overwrite each other (the hub's `scripts/pxcanvas.py` takes a file lock). Tools should take a `document` id the way `export_png` does.
- `new_document` replaces the current document, and no tool switches the current document.
- `import_image` caps at 512x512 and reads no WebP.
- **Opening the app while the headless engine runs** (VN Studio's "Open in Pixel Studio", or a double-click) can fail with no message while the headless studio holds `engine.lock` (found while planning hub HUB-08, 2026-10-22). It should say so, or attach to the running engine.

## Drawing

- **A full background is slow to draw by hand.** `draw_grid` is capped at 64x64; there is no polygon, gradient/dither or bitmap-text tool; and line + `flood_fill` leaks or leaves gaps. The hub works around it with `scripts/pxcanvas.py`, which composes the picture in code and sends it as `draw_grid` tiles. Wanted: `draw_polygon`, `draw_gradient {stops, dither}`, a bulk `draw_image` / `set_layer_pixels` that takes a whole layer, and a tiny pixel font.

## Visual novel assets

- No expression-set tool (VN Studio has expression sets per book and character since VNO-08).
- No text, 9-slice or UI-element support (textbox, buttons).
