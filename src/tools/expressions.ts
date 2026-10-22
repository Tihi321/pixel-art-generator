// Expression sets for visual-novel character sprites (PAR-12): one document, one frame per expression,
// each frame tagged with the expression name (a one-frame tag). The body is drawn once; the agent only
// redraws the face per frame. VN Studio expects one transparent PNG per expression, all the same size.

import { z } from 'zod'
import { type AnimTag, type Command, type Document, createCreateTagCommand, createDuplicateFrameCommand, findTag, frameIndex, requireFrame } from '../core'
import { plural, regionSchema } from './util'

/** Expression names are lowercase letters and digits (the VN Studio rule). */
export const EXPRESSION_NAME = /^[a-z0-9]+$/
export const MAX_EXPRESSIONS = 24

export const expressionNames = z
  .array(z.string().regex(EXPRESSION_NAME, 'Expression names are lowercase letters and digits only, e.g. "happy" or "smirk2".'))
  .min(1)
  .max(MAX_EXPRESSIONS)

export const faceRegion = regionSchema
export type FaceRegion = z.infer<typeof faceRegion>

/** What to change on the face for the VN Studio default expressions. */
const HINTS: Record<string, string> = {
  neutral: 'relaxed brows, eyes open, mouth a flat or slightly curved line',
  happy: 'brows slightly raised, eyes bright or curved up, mouth a smile',
  sad: 'brows tilted up in the middle, eyes lowered, mouth corners down',
  angry: 'brows low and slanted down toward the nose, eyes narrowed, mouth a tight line or a frown',
  surprised: 'brows up, eyes round and wide, mouth a small o',
  worried: 'brows raised and tilted up in the middle, eyes glancing aside, mouth a small wavy or flat line',
  scared: 'brows high, eyes wide with small pupils, mouth open and tense',
  thinking: 'one brow raised, eyes looking up or aside, mouth small and closed'
}

export interface ExpressionEntry {
  name: string
  /** 0-based frame index of the expression. */
  frame: number
  frameId: string
  tagId: string
  /** False when the expression already existed and was kept. */
  created: boolean
}

/** The one-frame tags that look like expressions, in frame order. */
export function expressionTags(doc: Document): AnimTag[] {
  return doc.tags.filter((t) => t.from === t.to && EXPRESSION_NAME.test(t.name)).sort((a, b) => a.from - b.from)
}

/**
 * Add the missing expressions to `doc`: the base frame gets the first expression's tag if it has no tag,
 * every other new expression gets a copy of the base frame (appended) and its own tag. Existing expression
 * tags are kept. `exec` runs each command (session.execute, or cmd.apply on a document nobody has open yet).
 */
export function applyExpressionSet(doc: Document, opts: { expressions: string[]; base?: string; exec: (cmd: Command) => void }): ExpressionEntry[] {
  const names = [...new Set(opts.expressions)]
  const baseId = (opts.base === undefined ? doc.frames[0]! : requireFrame(doc, opts.base)).id
  const entries: Array<Omit<ExpressionEntry, 'frame'>> = []
  for (const [i, name] of names.entries()) {
    const existing = findTag(doc, name)
    if (existing) {
      if (existing.from !== existing.to) {
        throw new Error(`Tag "${name}" already exists as an animation of ${plural(existing.to - existing.from + 1, 'frame')}. Pick another expression name or delete_tag it first.`)
      }
      entries.push({ name, frameId: doc.frames[existing.from]!.id, tagId: existing.id, created: false })
      continue
    }
    let frameId = baseId
    const baseIdx = frameIndex(doc, baseId)
    const baseTagged = doc.tags.some((t) => t.from <= baseIdx && baseIdx <= t.to)
    if (i > 0 || baseTagged) {
      const dup = createDuplicateFrameCommand(doc, baseId, { index: doc.frames.length })
      opts.exec(dup)
      frameId = dup.createdId
    }
    const idx = frameIndex(doc, frameId)
    const tag = createCreateTagCommand(doc, { name, from: idx, to: idx })
    opts.exec(tag)
    entries.push({ name, frameId, tagId: tag.createdId, created: true })
  }
  return entries.map((e) => ({ ...e, frame: frameIndex(doc, e.frameId) }))
}

/** Drawing instructions for the agent, one line per expression. */
export function expressionGuidance(entries: ExpressionEntry[], face?: FaceRegion, opts: { undrawn?: boolean } = {}): string {
  const lines = entries.map((e) => `- ${e.name} (frame "${e.name}", index ${e.frame}): ${e.created ? '' : '(already existed) '}${HINTS[e.name] ?? 'decide what changes: brows, eyes, mouth, head tilt'}`)
  return [
    `Expression set: ${plural(entries.length, 'frame')}, one per expression, each addressable by its name ({"frame":"happy"}). ${
      opts.undrawn
        ? `Nothing is drawn yet: draw the whole figure on frame "${entries[0]!.name}", then copy it to the other frames (copy_cel {"from_frame":"${entries[0]!.name}","to_frame":"<name>"}, once per layer you drew on) so the body is identical, and redraw only the faces.`
        : 'Every frame starts as a copy of the finished base pose, so the body is identical.'
    }`,
    face ? `The face is at x=${face.x}, y=${face.y}, w=${face.w}, h=${face.h}: redraw only that region on each frame.` : 'Redraw only the face (brows, eyes, mouth, head tilt) and leave the body alone.',
    'Per expression: render_preview with frame:"<name>", then draw_grid on the face region with frame:"<name>" (cover the old brows, eyes and mouth with the skin color, then draw the new ones; "." cells keep what is there unless transparent="clear"). Keep the sprite bottom-aligned and the size unchanged.',
    ...lines,
    'When done: export_expression_set {dir, prefix} writes <prefix>_<expression>.png for every expression, all the same size.'
  ].join('\n')
}
