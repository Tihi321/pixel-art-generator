// MCP guide content: resources and prompts. No Electron, no SDK imports (pure data + host calls).

import type { ToolHost, ToolResult } from '../shared/tools'

/** What the MCP server needs from a tool host (the ToolBridge, or an in-memory host in tests). */
export type McpHost = Pick<ToolHost, 'tools'> & {
  execute(name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult>
}

export interface McpResourceInfo {
  uri: string
  name: string
  description: string
  mimeType: string
}

export const RESOURCES: McpResourceInfo[] = [
  { uri: 'pixel-studio://guide', name: 'guide', description: 'How to drive Pixel Studio: workflow, palettes, animation, export. Read this first.', mimeType: 'text/markdown' },
  { uri: 'pixel-studio://document', name: 'document', description: 'Summary of the open document (size, layers, frames, tags, palette).', mimeType: 'application/json' },
  { uri: 'pixel-studio://palettes', name: 'palettes', description: 'Built-in and saved palettes.', mimeType: 'application/json' },
  { uri: 'pixel-studio://assets', name: 'assets', description: 'The asset library (characters, backgrounds, tiles, props). Empty when none.', mimeType: 'application/json' }
]

function textOf(r: ToolResult): string {
  return r.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

/** Reads a resource; returns null for unknown URIs. */
export async function readResource(host: McpHost, guide: string, uri: string, signal?: AbortSignal): Promise<{ mimeType: string; text: string } | null> {
  const info = RESOURCES.find((r) => r.uri === uri)
  if (!info) return null
  if (uri === 'pixel-studio://guide') return { mimeType: info.mimeType, text: guide }
  const tool = uri.endsWith('document') ? 'get_document' : uri.endsWith('palettes') ? 'list_palettes' : 'list_assets'
  if (tool === 'list_assets' && !host.tools().some((t) => t.name === 'list_assets')) return { mimeType: info.mimeType, text: '[]' }
  const r = await host.execute(tool, {}, signal)
  return { mimeType: info.mimeType, text: textOf(r) }
}

// ---------------------------------------------------------------- prompts

export interface McpPromptArg {
  name: string
  description: string
  required: boolean
}
export interface McpPromptInfo {
  name: string
  description: string
  arguments: McpPromptArg[]
}

export const PROMPTS: McpPromptInfo[] = [
  {
    name: 'create_sprite',
    description: 'Create a new pixel-art sprite step by step.',
    arguments: [
      { name: 'subject', description: 'What to draw, e.g. "a knight with a red plume".', required: true },
      { name: 'size', description: 'Canvas size in pixels, e.g. "32" or "32x48". Default 32.', required: false },
      { name: 'palette', description: 'Palette name, e.g. "Endesga-32" or "PICO-8". Default: a fitting built-in palette.', required: false },
      { name: 'frames', description: 'Number of animation frames. Default 1 (still image).', required: false }
    ]
  },
  {
    name: 'animate_sprite',
    description: 'Animate the open sprite (idle, walk, attack, ...).',
    arguments: [
      { name: 'animation', description: 'Animation name, e.g. "walk", "idle", "attack".', required: true },
      { name: 'frames', description: 'Number of frames. Default: idle 4, walk 6, attack 4.', required: false }
    ]
  },
  {
    name: 'match_style',
    description: 'Draw something new in the style of a saved asset.',
    arguments: [
      { name: 'asset', description: 'Name or id of the reference asset.', required: true },
      { name: 'subject', description: 'What to draw in that style.', required: true }
    ]
  }
]

function parseSize(size: string | undefined): { w: number; h: number } {
  const m = /^\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*$/i.exec(size ?? '')
  if (!m) return { w: 32, h: 32 }
  const w = Math.min(512, Math.max(1, Number(m[1])))
  const h = m[2] ? Math.min(512, Math.max(1, Number(m[2]))) : w
  return { w, h }
}

/** Builds the prompt text, or null for an unknown prompt. Throws for a missing required argument. */
export function buildPrompt(name: string, args: Record<string, string | undefined> = {}): string | null {
  const info = PROMPTS.find((p) => p.name === name)
  if (!info) return null
  for (const a of info.arguments) if (a.required && !args[a.name]?.trim()) throw new Error(`Missing required argument "${a.name}" for prompt ${name}.`)
  switch (name) {
    case 'create_sprite': {
      const { w, h } = parseSize(args['size'])
      const frames = Math.max(1, Math.min(64, Number(args['frames']) || 1))
      const palette = args['palette']?.trim()
      return [
        `Create pixel art of: ${args['subject']!.trim()}.`,
        '',
        'Follow this workflow (read pixel-studio://guide if you have not yet):',
        `1. Call new_document with width ${w}, height ${h}${palette ? `, palette "${palette}"` : ''}.`,
        palette ? '2. Use only the colours of that palette (list_palettes shows what is available).' : '2. Call list_palettes and load_palette with a fitting built-in palette (for example endesga-32 or sweetie-16). Use only its colours.',
        '3. Call get_document to confirm the size, layers and palette.',
        '4. Sketch the silhouette with draw_grid (legend maps characters to palette colours, "." is transparent; keep each call at 64x64 pixels or less).',
        '5. Add shading with hue-shifted ramps (draw_grid or set_pixels), then add a 1px outline with the outline tool.',
        '6. Call render_preview (scale 8 or more) and look at the image. Fix proportions or stray pixels, then render again.',
        frames > 1
          ? `7. Make ${frames} frames: add_frame or duplicate_frame, edit only what changes, keep pixel counts stable, and name the loop with create_tag. Preview a few frames.`
          : '7. Keep it as a single frame.',
        '8. Finish with a short summary of what you made. Export with export_png or export_spritesheet only if asked.'
      ].join('\n')
    }
    case 'animate_sprite': {
      const anim = args['animation']!.trim()
      const defaults: Record<string, number> = { idle: 4, walk: 6, run: 6, attack: 4 }
      const frames = Math.max(2, Math.min(64, Number(args['frames']) || defaults[anim.toLowerCase()] || 4))
      return [
        `Animate the open sprite with a "${anim}" animation of ${frames} frames.`,
        '',
        '1. Call get_document and render_preview to see the current sprite, layers and frames.',
        `2. Use duplicate_frame until there are ${frames} frames (frame 0 is the base pose). Do not redraw whole frames; edit only the differences.`,
        '3. For each frame, change the pose with draw_grid on the affected region, or transform_cel (shift) for simple motion. Keep colours and pixel counts stable so the sprite does not flicker.',
        '4. Use set_frame_duration to set timing (about 100-150 ms per frame for walk, 200 ms for idle).',
        `5. Call create_tag with name "${anim}", from 0 to ${frames - 1}.`,
        '6. Check a few frames with render_preview, then summarise. Export with export_gif or export_spritesheet only if asked.'
      ].join('\n')
    }
    case 'match_style': {
      return [
        `Draw ${args['subject']!.trim()} in the style of the saved asset "${args['asset']!.trim()}".`,
        '',
        `1. Call get_style_context for "${args['asset']!.trim()}" first. It returns the reference palette, size, sample grids and style notes.`,
        '2. Call new_document with the reference size (unless the user asked for another), and set the reference palette exactly (set_palette or load_palette). Use only those colours.',
        '3. Match proportions, outline weight and shading from the sample grids. Sketch with draw_grid, shade, then outline.',
        '4. Call render_preview and compare it with the reference. Adjust, then summarise what you matched.'
      ].join('\n')
    }
  }
  return null
}
