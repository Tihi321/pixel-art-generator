import { z } from 'zod'
import {
  BLEND_MODES,
  createAddLayerCommand,
  createDeleteLayerCommand,
  createDuplicateLayerCommand,
  createMergeDownCommand,
  createMoveLayerCommand,
  createUpdateLayerCommand,
  layerIndex
} from '../../core'
import { defineTool } from '../registry'
import { LAYER_REF_DESC, describeLayer, layerRef, obj, ok, resolveLayer } from '../util'

const blendEnum = z.enum(BLEND_MODES as unknown as [string, ...string[]])

export const layerTools = [
  defineTool({
    name: 'add_layer',
    group: 'layers',
    description:
      'Add a new empty layer (on top by default) and make it the active layer. Use separate layers for outline, shading, background, effects. Example: {"name":"outline"}.',
    input: obj({
      name: z.string().optional().describe('Layer name. Default: "Layer N".'),
      index: z.number().int().min(0).optional().describe('Position, 0 = bottom. Default: on top of all layers.'),
      kind: z.enum(['pixel', 'reference']).optional().describe('"reference" layers are guides: shown in the editor but never exported. Default pixel.'),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional().describe('0..1, default 1.'),
      blend: blendEnum.optional().describe('Blend mode, default normal.')
    }),
    handler: (args, { session }) => {
      const cmd = createAddLayerCommand(session.doc, { ...args, blend: args.blend as never })
      session.execute(cmd)
      session.setActiveLayer(cmd.createdId)
      const l = session.activeLayer
      return ok(`Added ${describeLayer(session.doc, l)} and made it the active layer.`)
    }
  }),

  defineTool({
    name: 'update_layer',
    group: 'layers',
    description:
      'Change layer properties: name, visible, locked, opacity (0..1), blend mode. Only the properties you pass change. Locked layers cannot be drawn on. Example: {"layer":"shadow","opacity":0.5,"blend":"multiply"}.',
    input: obj({
      layer: layerRef(LAYER_REF_DESC),
      name: z.string().optional().describe('New name.'),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional(),
      blend: blendEnum.optional()
    }),
    handler: ({ layer, ...patch }, { session }) => {
      const l = resolveLayer(session, layer)
      const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined)
      if (changed.length === 0) throw new Error('Nothing to change: pass at least one of name, visible, locked, opacity, blend.')
      session.execute(createUpdateLayerCommand(session.doc, l.id, { ...patch, blend: patch.blend as never }))
      return ok(`Updated layer "${l.name}" (${changed.join(', ')}).`)
    }
  }),

  defineTool({
    name: 'delete_layer',
    group: 'layers',
    description: 'Delete a layer and all its pixels in every frame. The last remaining layer cannot be deleted. Undoable.',
    input: obj({ layer: layerRef(LAYER_REF_DESC) }),
    handler: ({ layer }, { session }) => {
      const l = resolveLayer(session, layer)
      session.execute(createDeleteLayerCommand(session.doc, l.id))
      return ok(`Deleted layer "${l.name}". ${session.doc.layers.length} layer(s) remain; the active layer is now "${session.activeLayer.name}".`)
    }
  }),

  defineTool({
    name: 'move_layer',
    group: 'layers',
    description: 'Move a layer to a new stacking position. Index 0 is the bottom, the highest index is the top (drawn last, in front).',
    input: obj({
      layer: layerRef(LAYER_REF_DESC),
      index: z.number().int().min(0).describe('Target position (0 = bottom). Clamped to the valid range.')
    }),
    handler: ({ layer, index }, { session }) => {
      const l = resolveLayer(session, layer)
      session.execute(createMoveLayerCommand(session.doc, l.id, index))
      return ok(`Moved layer "${l.name}" to index ${layerIndex(session.doc, l.id)} (of ${session.doc.layers.length}; 0 = bottom).`)
    }
  }),

  defineTool({
    name: 'duplicate_layer',
    group: 'layers',
    description: 'Duplicate a layer with all its pixels (in every frame); the copy is placed directly above the original.',
    input: obj({
      layer: layerRef(LAYER_REF_DESC),
      name: z.string().optional().describe('Name of the copy. Default: "<name> copy".')
    }),
    handler: ({ layer, name }, { session }) => {
      const l = resolveLayer(session, layer)
      const cmd = createDuplicateLayerCommand(session.doc, l.id, { name })
      session.execute(cmd)
      const copy = session.doc.layers.find((x) => x.id === cmd.createdId)!
      return ok(`Duplicated "${l.name}" as ${describeLayer(session.doc, copy)}.`)
    }
  }),

  defineTool({
    name: 'merge_down',
    group: 'layers',
    description:
      'Merge a layer into the pixel layer directly below it (respecting the upper layer\'s opacity and blend mode) in all frames. The upper layer disappears.',
    input: obj({ layer: layerRef(LAYER_REF_DESC) }),
    handler: ({ layer }, { session }) => {
      const l = resolveLayer(session, layer)
      const below = session.doc.layers[layerIndex(session.doc, l.id) - 1]
      session.execute(createMergeDownCommand(session.doc, l.id))
      return ok(`Merged "${l.name}" into "${below?.name ?? 'the layer below'}". ${session.doc.layers.length} layer(s) remain.`)
    }
  })
]
