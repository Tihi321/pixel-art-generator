# Roadmap

What Pixel Studio still lacks, found while VN Studio and the creative hub (`C:\projects\Personal\creative-hub`) drove it over MCP (2026-10-20, the pixel-art book *The Soother That Fell into Dragon Land*). Moved here from the hub's `ROADMAP.md` on 2026-10-22. Most important first. Finished work is in `.claude/tickets/` (PAR-05 headless MCP, `import_image` and exact-size export for VN Studio). Fix items on a ticket branch (`PAR-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 52d9f51)

- Every item found in the 2026-10-20 run is done on branch `PAR-07-13_roadmap` (PAR-07 to PAR-13: a `document` id on every tool plus `select_document` / `close_document`, the 2048x2048 import and WebP, `engine.lock`, polygons, gradients and images, pixel fonts and `draw_text`, expression sets, UI elements and 9-slice). This file stays as the place for new findings.
- Headless MCP on `127.0.0.1:7457/mcp` (`--mcp-only`), used by VN Studio for pixel conversion and drawing. VN Studio's VNO-08 added a `grid` draw mode (one call per sprite), so the client provider can draw without a per-turn timeout.
