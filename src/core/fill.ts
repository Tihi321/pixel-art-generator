// Bulk fills: filled polygons and gradients (with ordered dithering). Same conventions as raster.ts:
// mutate in place, return the bounding Rect of the written pixels (clipped) or null.

import { type Rect, TRANSPARENT } from './model'
import { type Raster, DirtyRect, clipRect, drawLine } from './raster'

function norm(c: number): number {
  return c >>> 24 === 0 ? TRANSPARENT : c >>> 0
}

// ---------------------------------------------------------------- polygons

export interface Point {
  x: number
  y: number
}

export interface PolygonOptions {
  /** Fill the inside (default false = outline only). */
  filled?: boolean
  /** Outline thickness in pixels (default 1). */
  thickness?: number
  /** Connect the last point back to the first (default true). false + not filled = polyline. */
  closed?: boolean
}

/**
 * Polygon through the given pixel positions. Filled: a pixel is inside when its centre (x+0.5, y+0.5)
 * is inside (even-odd rule, so self-intersections leave holes), and the outline is drawn on top with
 * Bresenham lines, so the vertices themselves are covered and polygons sharing an edge leave no gap.
 */
export function drawPolygon(img: Raster, points: Point[], color: number, opts: PolygonOptions = {}): Rect | null {
  if (points.length === 0) return null
  const d = new DirtyRect()
  const c = norm(color)
  const pts = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
  const closed = opts.closed ?? true
  const filled = (opts.filled ?? false) && pts.length >= 3
  if (filled) {
    let minY = Infinity
    let maxY = -Infinity
    for (const p of pts) {
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    const y0 = Math.max(0, minY)
    const y1 = Math.min(img.height - 1, maxY)
    const xs: number[] = []
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5
      xs.length = 0
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!
        const b = pts[(i + 1) % pts.length]!
        if (a.y === b.y) continue
        const lo = a.y < b.y ? a : b
        const hi = a.y < b.y ? b : a
        if (yc < lo.y || yc >= hi.y) continue
        xs.push(lo.x + ((yc - lo.y) / (hi.y - lo.y)) * (hi.x - lo.x))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]! - 0.5))
        const xb = Math.min(img.width - 1, Math.ceil(xs[k + 1]! - 0.5) - 1)
        if (xb < xa) continue
        img.data.fill(c, y * img.width + xa, y * img.width + xb + 1)
        d.add(xa, y)
        d.add(xb, y)
      }
    }
  }
  const edges = closed && pts.length > 1 ? pts.length : pts.length - 1
  if (pts.length === 1) {
    const r = drawLine(img, pts[0]!.x, pts[0]!.y, pts[0]!.x, pts[0]!.y, c, { thickness: opts.thickness })
    if (r) d.addRect(r)
  }
  for (let i = 0; i < edges; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    const r = drawLine(img, a.x, a.y, b.x, b.y, c, { thickness: opts.thickness })
    if (r) d.addRect(r)
  }
  return d.rect()
}

// ---------------------------------------------------------------- gradients

export interface GradientStop {
  /** Position 0..1. Omitted = evenly spaced: index / (stops - 1). */
  at?: number
  /** Packed RGBA. */
  color: number
}

export type GradientDirection = 'vertical' | 'horizontal' | 'diagonal' | 'radial' | number
export type GradientDither = 'none' | 'ordered' | 'ordered8' | 'checker' | 'smooth'
export type GradientMask = 'all' | 'opaque' | 'transparent'

export interface GradientOptions {
  /** Gradient area (default the whole raster). Writes are clipped to the raster. */
  region?: Rect
  /** Default 'vertical'. A number is an angle in degrees: 0 = left to right, 90 = top to bottom. */
  direction?: GradientDirection
  /** Default 'ordered'. */
  dither?: GradientDither
  /** Which existing pixels may be painted (default 'all'). */
  mask?: GradientMask
}

/** n x n Bayer threshold matrix (n a power of two), values 0..n*n-1. */
function bayerMatrix(n: number): number[] {
  let m = [0]
  for (let size = 1; size < n; size *= 2) {
    const s2 = size * 2
    const next = new Array<number>(s2 * s2)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y * size + x]! * 4
        next[y * s2 + x] = v
        next[y * s2 + x + size] = v + 2
        next[(y + size) * s2 + x] = v + 3
        next[(y + size) * s2 + x + size] = v + 1
      }
    }
    m = next
  }
  return m
}
const BAYER4 = bayerMatrix(4)
const BAYER8 = bayerMatrix(8)

function lerpColor(a: number, b: number, f: number): number {
  const ch = (shift: number): number => Math.round(((a >>> shift) & 255) * (1 - f) + ((b >>> shift) & 255) * f)
  return norm(((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0)
}

/** Stops sorted by position, with missing positions filled in as index / (n-1). */
function resolveStops(stops: GradientStop[]): Array<{ at: number; color: number }> {
  if (stops.length < 2) throw new Error('A gradient needs at least 2 stops.')
  return stops
    .map((s, i) => ({ at: Math.min(1, Math.max(0, s.at ?? i / (stops.length - 1))), color: norm(s.color), i }))
    .sort((p, q) => p.at - q.at || p.i - q.i)
}

/**
 * Gradient between color stops. Dithering picks one of the two stops around a pixel's position (so only
 * stop colors appear) with a Bayer matrix anchored at the raster origin, so neighbouring calls tile.
 * 'smooth' blends true colors instead (adds colors). Returns the pixels written.
 */
export function drawGradient(img: Raster, stops: GradientStop[], opts: GradientOptions = {}): Rect | null {
  const st = resolveStops(stops)
  const region = opts.region ?? { x: 0, y: 0, w: img.width, h: img.height }
  const clip = clipRect(region, img)
  if (!clip) return null
  const direction = opts.direction ?? 'vertical'
  const dither = opts.dither ?? 'ordered'
  const mask = opts.mask ?? 'all'
  const { w, h } = region
  const cx = region.x + w / 2
  const cy = region.y + h / 2

  let tAt: (x: number, y: number) => number
  if (typeof direction === 'number') {
    const rad = (direction * Math.PI) / 180
    const dx = Math.cos(rad)
    const dy = Math.sin(rad)
    const half = (w * Math.abs(dx) + h * Math.abs(dy)) / 2
    tAt = (x, y) => (half === 0 ? 0 : 0.5 + ((x + 0.5 - cx) * dx + (y + 0.5 - cy) * dy) / (2 * half))
  } else if (direction === 'horizontal') tAt = (x) => (x + 0.5 - region.x) / w
  else if (direction === 'diagonal') tAt = (x, y) => ((x + 0.5 - region.x) / w + (y + 0.5 - region.y) / h) / 2
  else if (direction === 'radial') {
    const radius = Math.max(w, h) / 2
    tAt = (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
  } else tAt = (_x, y) => (y + 0.5 - region.y) / h

  /** Segment index and fraction (0..1) of position t. */
  const locate = (t: number): { i: number; f: number } => {
    if (t <= st[0]!.at) return { i: 0, f: 0 }
    const last = st.length - 1
    if (t >= st[last]!.at) return { i: last - 1, f: 1 }
    let i = 0
    while (st[i + 1]!.at < t) i++
    const span = st[i + 1]!.at - st[i]!.at
    return { i, f: span === 0 ? 0 : (t - st[i]!.at) / span }
  }
  const hard = (x: number, y: number): number => {
    const { i, f } = locate(tAt(x, y))
    return st[f < 0.5 ? i : i + 1]!.color
  }

  const d = new DirtyRect()
  const x1 = clip.x + clip.w
  const y1 = clip.y + clip.h
  const allowed = (cur: number): boolean => mask === 'all' || (mask === 'opaque') === (cur >>> 24 !== 0)

  if (dither === 'checker') {
    // hard bands; the first row/column of each new band alternates with the previous band's color
    const base = new Uint32Array(clip.w * clip.h)
    for (let y = clip.y; y < y1; y++) for (let x = clip.x; x < x1; x++) base[(y - clip.y) * clip.w + x - clip.x] = hard(x, y)
    for (let y = clip.y; y < y1; y++) {
      for (let x = clip.x; x < x1; x++) {
        const o = (y - clip.y) * clip.w + x - clip.x
        let c = base[o]!
        if (((x + y) & 1) === 1) {
          const up = y > clip.y ? base[o - clip.w]! : c
          const left = x > clip.x ? base[o - 1]! : c
          if (up !== c) c = up
          else if (left !== c) c = left
        }
        const idx = y * img.width + x
        if (!allowed(img.data[idx]!)) continue
        img.data[idx] = c
        d.add(x, y)
      }
    }
    return d.rect()
  }

  for (let y = clip.y; y < y1; y++) {
    for (let x = clip.x; x < x1; x++) {
      const idx = y * img.width + x
      if (!allowed(img.data[idx]!)) continue
      let c: number
      if (dither === 'none') c = hard(x, y)
      else {
        const { i, f } = locate(tAt(x, y))
        const a = st[i]!.color
        const b = st[i + 1]!.color
        if (dither === 'smooth') c = lerpColor(a, b, f)
        else if (dither === 'ordered8') c = f > (BAYER8[(y & 7) * 8 + (x & 7)]! + 0.5) / 64 ? b : a
        else c = f > (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 ? b : a
      }
      img.data[idx] = c
      d.add(x, y)
    }
  }
  return d.rect()
}
