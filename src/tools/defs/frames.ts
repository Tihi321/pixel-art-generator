import { z } from 'zod'
import {
  TAG_DIRECTIONS,
  createAddFrameCommand,
  createCopyCelCommand,
  createCreateTagCommand,
  createDeleteFrameCommand,
  createDeleteTagCommand,
  createDuplicateFrameCommand,
  createMoveFrameCommand,
  createSetFrameDurationCommand,
  createUpdateTagCommand,
  frameIndex,
  requireTag
} from '../../core'
import { defineTool } from '../registry'
import { FRAME_REF_DESC, LAYER_REF_DESC, describeFrame, frameRef, layerRef, obj, ok, plural, resolveFrame, resolveLayer } from '../util'

const directionEnum = z.enum(TAG_DIRECTIONS as unknown as [string, ...string[]])
const duration = z.number().int().min(1).max(60000).describe('Duration in milliseconds (100 = 10 fps).')

export const frameTools = [
  defineTool({
    name: 'add_frame',
    group: 'frames',
    description:
      'Add a new EMPTY frame (appended at the end by default) and make it the active frame. To start from an existing pose use duplicate_frame instead.',
    input: obj({
      index: z.number().int().min(0).optional().describe('Insert position (0 = first). Default: append at the end.'),
      durationMs: duration.optional().describe('Frame duration in ms. Default 100.')
    }),
    handler: ({ index, durationMs }, { session }) => {
      const cmd = createAddFrameCommand(session.doc, { index, durationMs })
      session.execute(cmd)
      session.setActiveFrame(cmd.createdId)
      return ok(`Added empty ${describeFrame(session.doc, session.activeFrame)}; the document now has ${plural(session.doc.frames.length, 'frame')}. It is the active frame.`)
    }
  }),

  defineTool({
    name: 'duplicate_frame',
    group: 'frames',
    description:
      'Duplicate a frame with all its layers\' pixels; the copy goes directly after the original by default and becomes the active frame. This is the way to start an animation: duplicate the base pose, then edit only the differences.',
    input: obj({
      frame: frameRef(`${FRAME_REF_DESC} Default: the active frame.`).optional(),
      index: z.number().int().min(0).optional().describe('Where to insert the copy. Default: right after the original.')
    }),
    handler: ({ frame, index }, { session }) => {
      const f = resolveFrame(session, frame)
      const cmd = createDuplicateFrameCommand(session.doc, f.id, { index })
      session.execute(cmd)
      session.setActiveFrame(cmd.createdId)
      return ok(
        `Duplicated frame ${frameIndex(session.doc, f.id)} as ${describeFrame(session.doc, session.activeFrame)}; the document now has ${plural(session.doc.frames.length, 'frame')}. The copy is the active frame.`
      )
    }
  }),

  defineTool({
    name: 'delete_frame',
    group: 'frames',
    description: 'Delete a frame and its pixels in every layer. Animation tags are adjusted. The last remaining frame cannot be deleted.',
    input: obj({ frame: frameRef() }),
    handler: ({ frame }, { session }) => {
      const f = resolveFrame(session, frame)
      const idx = frameIndex(session.doc, f.id)
      session.execute(createDeleteFrameCommand(session.doc, f.id))
      return ok(`Deleted frame ${idx}. ${plural(session.doc.frames.length, 'frame')} remain; the active frame is now ${session.activeFrameIndex}.`)
    }
  }),

  defineTool({
    name: 'move_frame',
    group: 'frames',
    description: 'Move a frame to a new position in the animation order (0 = first). Animation tags follow.',
    input: obj({ frame: frameRef(), index: z.number().int().min(0).describe('Target position (clamped).') }),
    handler: ({ frame, index }, { session }) => {
      const f = resolveFrame(session, frame)
      const from = frameIndex(session.doc, f.id)
      session.execute(createMoveFrameCommand(session.doc, f.id, index))
      return ok(`Moved frame ${from} to position ${frameIndex(session.doc, f.id)}.`)
    }
  }),

  defineTool({
    name: 'set_frame_duration',
    group: 'frames',
    description:
      'Set how long frames are shown, in milliseconds. `frames` can be one frame, a list, or "all" (default). 100 ms = 10 fps; typical: 80-150 ms for walk cycles, 150-300 ms for idle. Example: {"durationMs":120,"frames":[0,1,2]}.',
    input: obj({
      durationMs: duration,
      frames: z
        .union([z.literal('all'), z.string(), z.number().int(), z.array(z.union([z.string(), z.number().int()]))])
        .optional()
        .describe('Frame id/index, a list of them, or "all". Default "all".')
    }),
    handler: ({ durationMs, frames }, { session }) => {
      const refs = frames === undefined || frames === 'all' ? null : Array.isArray(frames) ? frames : [frames]
      const ids = refs ? refs.map((r) => resolveFrame(session, r).id) : session.doc.frames.map((f) => f.id)
      session.execute(createSetFrameDurationCommand(session.doc, ids, durationMs))
      return ok(`Set the duration of ${plural(ids.length, 'frame')} to ${durationMs} ms.`)
    }
  }),

  defineTool({
    name: 'create_tag',
    group: 'frames',
    description:
      'Name an animation: a tag covers frames from..to (inclusive, 0-based indices). Tags are exported in sprite-sheet/GIF metadata. Example: {"name":"walk","from":0,"to":3,"direction":"forward"}.',
    input: obj({
      name: z.string().min(1).describe('Tag name, e.g. "idle", "walk", "attack". Unique in the document.'),
      from: z.number().int().min(0).describe('First frame index.'),
      to: z.number().int().min(0).describe('Last frame index (>= from).'),
      direction: directionEnum.optional().describe('forward (default), reverse or pingpong.'),
      loop: z.boolean().optional().describe('Loop the animation (default true).')
    }),
    handler: (args, { session }) => {
      session.execute(createCreateTagCommand(session.doc, { ...args, direction: args.direction as never }))
      return ok(`Created tag "${args.name}" covering frames ${args.from}..${args.to} (${args.direction ?? 'forward'}).`)
    }
  }),

  defineTool({
    name: 'update_tag',
    group: 'frames',
    description: 'Change an animation tag (rename, change its frame range, direction or loop). Only the properties you pass change.',
    input: obj({
      tag: z.string().describe('Tag name or id.'),
      name: z.string().min(1).optional().describe('New name.'),
      from: z.number().int().min(0).optional(),
      to: z.number().int().min(0).optional(),
      direction: directionEnum.optional(),
      loop: z.boolean().optional()
    }),
    handler: ({ tag, ...patch }, { session }) => {
      const t = requireTag(session.doc, tag)
      session.execute(createUpdateTagCommand(session.doc, t.id, { ...patch, direction: patch.direction as never }))
      const n = requireTag(session.doc, t.id)
      return ok(`Updated tag "${n.name}": frames ${n.from}..${n.to}, ${n.direction}, loop ${n.loop ?? true}.`)
    }
  }),

  defineTool({
    name: 'delete_tag',
    group: 'frames',
    description: 'Delete an animation tag (the frames are kept).',
    input: obj({ tag: z.string().describe('Tag name or id.') }),
    handler: ({ tag }, { session }) => {
      const t = requireTag(session.doc, tag)
      session.execute(createDeleteTagCommand(session.doc, t.id))
      return ok(`Deleted tag "${t.name}".`)
    }
  }),

  defineTool({
    name: 'copy_cel',
    group: 'frames',
    description:
      'Copy the pixels of one layer in one frame (a "cel") to another layer/frame, replacing the destination. An empty source clears the destination. Useful to reuse a part (e.g. the body) across animation frames. Example: {"from_frame":0,"to_frame":2}.',
    input: obj({
      from_layer: layerRef(`${LAYER_REF_DESC} Default: the active layer.`).optional(),
      from_frame: frameRef(`${FRAME_REF_DESC} Default: the active frame.`).optional(),
      to_layer: layerRef(`${LAYER_REF_DESC} Default: same as from_layer.`).optional(),
      to_frame: frameRef(FRAME_REF_DESC)
    }),
    handler: (args, { session }) => {
      const fl = resolveLayer(session, args.from_layer)
      const ff = resolveFrame(session, args.from_frame)
      const tl = resolveLayer(session, args.to_layer ?? fl.id)
      const tf = resolveFrame(session, args.to_frame)
      session.execute(createCopyCelCommand(session.doc, { fromLayer: fl.id, fromFrame: ff.id, toLayer: tl.id, toFrame: tf.id }))
      return ok(
        `Copied "${fl.name}" frame ${frameIndex(session.doc, ff.id)} to "${tl.name}" frame ${frameIndex(session.doc, tf.id)}.`
      )
    }
  })
]
