import { type Document, createDocument, celKey, packRgba } from '../../src/core'

/** Deterministic, comparable snapshot of a document (cels as number arrays). */
export function snapshot(doc: Document): unknown {
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    palette: doc.palette,
    layers: doc.layers,
    frames: doc.frames,
    tags: doc.tags,
    references: doc.references,
    cels: [...doc.cels.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, c]) => [k, c.x, c.y, c.w, c.h, Array.from(c.data)])
  }
}

export const RED = packRgba(255, 0, 0)
export const GREEN = packRgba(0, 255, 0)
export const BLUE = packRgba(0, 0, 255)
export const BLACK = packRgba(0, 0, 0)

export function smallDoc(w = 8, h = 8): Document {
  return createDocument({ width: w, height: h, name: 'test' })
}

export function firstLayerId(doc: Document): string {
  return doc.layers[0]!.id
}
export function firstFrameId(doc: Document): string {
  return doc.frames[0]!.id
}
export function celAt(doc: Document, layerId: string, frameId: string): unknown {
  return doc.cels.get(celKey(layerId, frameId))
}
