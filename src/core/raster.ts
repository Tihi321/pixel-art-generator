// Raster operations on a width*height Uint32Array of packed 0xAABBGGRR pixels, plus compositing.
// Pure TypeScript. Operations mutate the raster in place and return the bounding Rect of the
// pixels they wrote (clipped to the raster), or null when nothing was written.

import {
  type BlendMode,
  type Cel,
  type Document,
  type Layer,
  type Rect,
  TRANSPARENT,
  celKey
} from './model'

export interface Raster {
  width: number
  height: number
  data: Uint32Array
}

// ---------------------------------------------------------------- basics

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint32Array(width * height) }
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: r.data.slice() }
}

export function inBounds(img: Raster, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < img.width && y < img.height
}

export function getPixel(img: Raster, x: number, y: number): number {
  return inBounds(img, x, y) ? img.data[y * img.width + x]! : TRANSPARENT
}

/** Tracks the bounding box of touched pixels. */
export class DirtyRect {
  private minX = Infinity
  private minY = Infinity
  private maxX = -Infinity
  private maxY = -Infinity
  add(x: number, y: number): void {
    if (x < this.minX) this.minX = x
    if (y < this.minY) this.minY = y
    if (x > this.maxX) this.maxX = x
    if (y > this.maxY) this.maxY = y
  }
  addRect(r: Rect): void {
    if (r.w <= 0 || r.h <= 0) return
    this.add(r.x, r.y)
    this.add(r.x + r.w - 1, r.y + r.h - 1)
  }
  rect(): Rect | null {
    if (this.maxX < this.minX) return null
    return { x: this.minX, y: this.minY, w: this.maxX - this.minX + 1, h: this.maxY - this.minY + 1 }
  }
}

function norm(c: number): number {
  return c >>> 24 === 0 ? TRANSPARENT : c >>> 0
}

function put(img: Raster, x: number, y: number, c: number, dirty: DirtyRect): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  img.data[y * img.width + x] = c
  dirty.add(x, y)
}

export interface PixelWrite {
  x: number
  y: number
  color: number
}

export function setPixel(img: Raster, x: number, y: number, color: number): Rect | null {
  const d = new DirtyRect()
  put(img, x, y, norm(color), d)
  return d.rect()
}

export function setPixels(img: Raster, pixels: PixelWrite[]): Rect | null {
  const d = new DirtyRect()
  for (const p of pixels) put(img, p.x, p.y, norm(p.color), d)
  return d.rect()
}

export function clearRaster(img: Raster, region?: Rect): Rect | null {
  const r = clipRect(region ?? { x: 0, y: 0, w: img.width, h: img.height }, img)
  if (!r) return null
  for (let y = r.y; y < r.y + r.h; y++) img.data.fill(TRANSPARENT, y * img.width + r.x, y * img.width + r.x + r.w)
  return r
}

export function clipRect(r: Rect, img: { width: number; height: number }): Rect | null {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(img.width, r.x + r.w)
  const y1 = Math.min(img.height, r.y + r.h)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// ---------------------------------------------------------------- shapes

function stampBrush(img: Raster, x: number, y: number, thickness: number, c: number, d: DirtyRect): void {
  if (thickness <= 1) {
    put(img, x, y, c, d)
    return
  }
  const off = -Math.floor((thickness - 1) / 2)
  for (let j = 0; j < thickness; j++) for (let i = 0; i < thickness; i++) put(img, x + off + i, y + off + j, c, d)
}

export interface ShapeOptions {
  thickness?: number
}

/** Bresenham line (both end points inclusive). */
export function drawLine(
  img: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
  opts: ShapeOptions = {}
): Rect | null {
  const d = new DirtyRect()
  const c = norm(color)
  const t = Math.max(1, Math.floor(opts.thickness ?? 1))
  x0 = Math.round(x0)
  y0 = Math.round(y0)
  x1 = Math.round(x1)
  y1 = Math.round(y1)
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    stampBrush(img, x0, y0, t, c, d)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return d.rect()
}

export interface FillableShapeOptions extends ShapeOptions {
  filled?: boolean
}

/** Rectangle with top-left (x,y) and size w*h. */
export function drawRect(
  img: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  opts: FillableShapeOptions = {}
): Rect | null {
  if (w <= 0 || h <= 0) return null
  const d = new DirtyRect()
  const c = norm(color)
  const t = Math.max(1, Math.floor(opts.thickness ?? 1))
  const filled = opts.filled ?? false
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const edge = i < t || j < t || i >= w - t || j >= h - t
      if (filled || edge) put(img, x + i, y + j, c, d)
    }
  }
  return d.rect()
}

/** Ellipse inscribed in the bounding box (x,y,w,h). Midpoint/Zingl algorithm, exact for any w,h. */
export function drawEllipse(
  img: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  opts: FillableShapeOptions = {}
): Rect | null {
  if (w <= 0 || h <= 0) return null
  const c = norm(color)
  const filled = opts.filled ?? false
  const t = Math.max(1, Math.floor(opts.thickness ?? 1))
  const d = new DirtyRect()

  // Collect the outline per row so it can be filled (or thickened by concentric shrinking).
  const rows = new Map<number, [number, number]>()
  const outline: Array<[number, number]> = []
  const plot = (px: number, py: number): void => {
    outline.push([px, py])
    const r = rows.get(py)
    if (!r) rows.set(py, [px, px])
    else {
      if (px < r[0]) r[0] = px
      if (px > r[1]) r[1] = px
    }
  }
  ellipseOutline(x, y, x + w - 1, y + h - 1, plot)

  if (filled) {
    for (const [py, [a, b]] of rows) for (let px = a; px <= b; px++) put(img, px, py, c, d)
  } else {
    for (const [px, py] of outline) put(img, px, py, c, d)
    // Extra thickness: draw inner concentric ellipses.
    for (let k = 1; k < t; k++) {
      const iw = w - 2 * k
      const ih = h - 2 * k
      if (iw <= 0 || ih <= 0) break
      ellipseOutline(x + k, y + k, x + k + iw - 1, y + k + ih - 1, (px, py) => put(img, px, py, c, d))
    }
  }
  return d.rect()
}

function ellipseOutline(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void
): void {
  let a = Math.abs(x1 - x0)
  const b = Math.abs(y1 - y0)
  const b1 = b & 1
  let dx = 4 * (1 - a) * b * b
  let dy = 4 * (b1 + 1) * a * a
  let err = dx + dy + b1 * a * a
  if (x0 > x1) {
    x0 = x1
    x1 += a
  }
  if (y0 > y1) y0 = y1
  y0 += Math.floor((b + 1) / 2)
  y1 = y0 - b1
  a *= 8 * a
  const bb = 8 * b * b
  do {
    plot(x1, y0)
    plot(x0, y0)
    plot(x0, y1)
    plot(x1, y1)
    const e2 = 2 * err
    if (e2 <= dy) {
      y0++
      y1--
      dy += a
      err += dy
    }
    if (e2 >= dx || 2 * err > dy) {
      x0++
      x1--
      dx += bb
      err += dx
    }
  } while (x0 <= x1)
  while (y0 - y1 < b) {
    plot(x0 - 1, y0)
    plot(x1 + 1, y0++)
    plot(x0 - 1, y1)
    plot(x1 + 1, y1--)
  }
}

// ---------------------------------------------------------------- fill / replace

export interface FloodFillOptions {
  /** true (default): 4-connected region from the seed. false: every pixel with the seed color. */
  contiguous?: boolean
}

export function floodFill(img: Raster, x: number, y: number, color: number, opts: FloodFillOptions = {}): Rect | null {
  if (!inBounds(img, x, y)) return null
  const c = norm(color)
  const target = img.data[y * img.width + x]!
  if (target === c) return null
  const d = new DirtyRect()
  const { width: w, height: h, data } = img
  if (opts.contiguous === false) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] === target) {
        data[i] = c
        d.add(i % w, Math.floor(i / w))
      }
    }
    return d.rect()
  }
  const stack: number[] = [x, y]
  while (stack.length) {
    const sy = stack.pop()!
    let sx = stack.pop()!
    if (data[sy * w + sx] !== target) continue
    let lx = sx
    while (lx > 0 && data[sy * w + lx - 1] === target) lx--
    let rx = sx
    while (rx < w - 1 && data[sy * w + rx + 1] === target) rx++
    for (sx = lx; sx <= rx; sx++) {
      data[sy * w + sx] = c
      d.add(sx, sy)
    }
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue
      let inSpan = false
      for (let px = lx; px <= rx; px++) {
        const match = data[ny * w + px] === target
        if (match && !inSpan) {
          stack.push(px, ny)
          inSpan = true
        } else if (!match) inSpan = false
      }
    }
  }
  return d.rect()
}

export function replaceColor(img: Raster, from: number, to: number, region?: Rect): Rect | null {
  const f = norm(from)
  const t = norm(to)
  if (f === t) return null
  const r = clipRect(region ?? { x: 0, y: 0, w: img.width, h: img.height }, img)
  if (!r) return null
  const d = new DirtyRect()
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * img.width + x
      if (img.data[i] === f) {
        img.data[i] = t
        d.add(x, y)
      }
    }
  }
  return d.rect()
}

// ---------------------------------------------------------------- regions

/** Copy a region out into a new raster. Out-of-bounds parts are transparent. */
export function copyRegion(img: Raster, r: Rect): Raster {
  const out = createRaster(Math.max(0, r.w), Math.max(0, r.h))
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      out.data[y * out.width + x] = getPixel(img, r.x + x, r.y + y)
    }
  }
  return out
}

export interface StampOptions {
  /** true: overwrite destination pixels (including with transparent). false (default): alpha blend over. */
  replace?: boolean
  blend?: BlendMode
  opacity?: number
}

/** Blit `src` onto `dst` at (x,y), clipped to dst. */
export function stamp(dst: Raster, src: Raster, x: number, y: number, opts: StampOptions = {}): Rect | null {
  const d = new DirtyRect()
  const mode = opts.blend ?? 'normal'
  const opacity = opts.opacity ?? 1
  for (let j = 0; j < src.height; j++) {
    const dy = y + j
    if (dy < 0 || dy >= dst.height) continue
    for (let i = 0; i < src.width; i++) {
      const dx = x + i
      if (dx < 0 || dx >= dst.width) continue
      const s = src.data[j * src.width + i]!
      const idx = dy * dst.width + dx
      if (opts.replace) {
        dst.data[idx] = s
        d.add(dx, dy)
      } else if (s >>> 24 !== 0) {
        dst.data[idx] = blendPixel(dst.data[idx]!, s, mode, opacity)
        d.add(dx, dy)
      }
    }
  }
  return d.rect()
}

// ---------------------------------------------------------------- transforms

function regionOf(img: Raster, region?: Rect): Rect | null {
  return clipRect(region ?? { x: 0, y: 0, w: img.width, h: img.height }, img)
}

export function flipH(img: Raster, region?: Rect): Rect | null {
  const r = regionOf(img, region)
  if (!r) return null
  for (let y = r.y; y < r.y + r.h; y++) {
    let a = y * img.width + r.x
    let b = a + r.w - 1
    while (a < b) {
      const t = img.data[a]!
      img.data[a++] = img.data[b]!
      img.data[b--] = t
    }
  }
  return r
}

export function flipV(img: Raster, region?: Rect): Rect | null {
  const r = regionOf(img, region)
  if (!r) return null
  for (let k = 0; k < Math.floor(r.h / 2); k++) {
    const ya = (r.y + k) * img.width + r.x
    const yb = (r.y + r.h - 1 - k) * img.width + r.x
    for (let i = 0; i < r.w; i++) {
      const t = img.data[ya + i]!
      img.data[ya + i] = img.data[yb + i]!
      img.data[yb + i] = t
    }
  }
  return r
}

/**
 * Rotate clockwise by 90, 180 or 270 degrees (clockwise). The region (default: whole raster) is
 * rotated about its center and clipped to the same region, so non-square regions lose the parts
 * that no longer fit; square regions rotate losslessly.
 */
export function rotate(img: Raster, degrees: 90 | 180 | 270, region?: Rect): Rect | null {
  const r = regionOf(img, region)
  if (!r) return null
  const W = r.w
  const H = r.h
  const src = copyRegion(img, r)
  const out = createRaster(W, H)
  if (degrees === 180) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.data[y * W + x] = src.data[(H - 1 - y) * W + (W - 1 - x)]!
  } else {
    const ox = Math.floor((W - H) / 2)
    const oy = Math.floor((H - W) / 2)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const rx = x - ox
        const ry = y - oy
        if (rx < 0 || ry < 0 || rx >= H || ry >= W) continue
        let sx: number
        let sy: number
        if (degrees === 90) {
          sy = H - 1 - rx
          sx = ry
        } else {
          sx = W - 1 - ry
          sy = rx
        }
        out.data[y * W + x] = src.data[sy * W + sx]!
      }
    }
  }
  stamp(img, out, r.x, r.y, { replace: true })
  return r
}

/** Shift content by (dx,dy). With wrap=true (default) pixels wrap around the region edges. */
export function shift(img: Raster, dx: number, dy: number, opts: { wrap?: boolean; region?: Rect } = {}): Rect | null {
  const r = regionOf(img, opts.region)
  if (!r) return null
  dx = Math.round(dx)
  dy = Math.round(dy)
  if (dx === 0 && dy === 0) return null
  const wrap = opts.wrap ?? true
  const src = copyRegion(img, r)
  const out = createRaster(r.w, r.h)
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      let nx = x + dx
      let ny = y + dy
      if (wrap) {
        nx = ((nx % r.w) + r.w) % r.w
        ny = ((ny % r.h) + r.h) % r.h
      } else if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue
      out.data[ny * r.w + nx] = src.data[y * r.w + x]!
    }
  }
  stamp(img, out, r.x, r.y, { replace: true })
  return r
}

export interface OutlineOptions {
  /** 'outside' (default) adds the outline on transparent pixels next to opaque ones; 'inside' recolors the opaque edge pixels. */
  mode?: 'outside' | 'inside'
  /** Also consider diagonal neighbours (8-connected). Default false (4-connected). */
  diagonal?: boolean
  region?: Rect
}

export function outline(img: Raster, color: number, opts: OutlineOptions = {}): Rect | null {
  const r = regionOf(img, opts.region)
  if (!r) return null
  const c = norm(color)
  const mode = opts.mode ?? 'outside'
  const src = img.data.slice()
  const { width: w, height: h } = img
  const neigh: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]
  if (opts.diagonal) neigh.push([1, 1], [-1, 1], [1, -1], [-1, -1])
  const opaqueAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && src[y * w + x]! >>> 24 !== 0
  const d = new DirtyRect()
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const self = opaqueAt(x, y)
      if (mode === 'outside') {
        if (self) continue
        if (neigh.some(([ox, oy]) => opaqueAt(x + ox, y + oy))) {
          img.data[y * w + x] = c
          d.add(x, y)
        }
      } else {
        if (!self) continue
        if (neigh.some(([ox, oy]) => !opaqueAt(x + ox, y + oy))) {
          img.data[y * w + x] = c
          d.add(x, y)
        }
      }
    }
  }
  return d.rect()
}

// ---------------------------------------------------------------- mirror

export interface MirrorAxes {
  /** Mirror across the vertical center line (left <-> right). */
  horizontal?: boolean
  /** Mirror across the horizontal center line (top <-> bottom). */
  vertical?: boolean
}

/** All positions a point maps to under mirroring (includes the original, no duplicates). */
export function mirrorPoints(
  width: number,
  height: number,
  x: number,
  y: number,
  axes: MirrorAxes
): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x, y]]
  if (axes.horizontal) pts.push([width - 1 - x, y])
  if (axes.vertical) pts.push([x, height - 1 - y])
  if (axes.horizontal && axes.vertical) pts.push([width - 1 - x, height - 1 - y])
  const seen = new Set<string>()
  return pts.filter(([px, py]) => {
    const k = `${px},${py}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Run a drawing function, then replicate every pixel it changed to the mirrored positions.
 * Returns the bounding rect of all changed pixels.
 */
export function mirrorDraw(img: Raster, axes: MirrorAxes, draw: (img: Raster) => unknown): Rect | null {
  const before = img.data.slice()
  draw(img)
  const d = new DirtyRect()
  const changed: Array<[number, number, number]> = []
  for (let i = 0; i < img.data.length; i++) {
    if (img.data[i] !== before[i]) changed.push([i % img.width, Math.floor(i / img.width), img.data[i]!])
  }
  for (const [x, y, c] of changed) {
    d.add(x, y)
    for (const [mx, my] of mirrorPoints(img.width, img.height, x, y, axes)) {
      img.data[my * img.width + mx] = c
      d.add(mx, my)
    }
  }
  return d.rect()
}

// ---------------------------------------------------------------- blending / compositing

function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply':
      return cb * cs
    case 'screen':
      return cb + cs - cb * cs
    case 'add':
      return Math.min(1, cb + cs)
    case 'overlay':
      return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs)
    default:
      return cs
  }
}

/** Composite `src` over `dst` (straight alpha) with a blend mode and layer opacity (0..1). */
export function blendPixel(dst: number, src: number, mode: BlendMode = 'normal', opacity = 1): number {
  const sa8 = src >>> 24
  if (sa8 === 0 || opacity <= 0) return dst
  const da8 = dst >>> 24
  if (mode === 'normal' && opacity >= 1) {
    if (sa8 === 255 || da8 === 0) return src
  } else if (da8 === 0 && mode === 'normal') {
    const a = Math.round(sa8 * opacity)
    return a === 0 ? dst : (((a << 24) | (src & 0xffffff)) >>> 0)
  }
  const sa = (sa8 / 255) * Math.min(1, opacity)
  const da = da8 / 255
  const ra = sa + da * (1 - sa)
  if (ra <= 0) return TRANSPARENT
  const out = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const sh = k * 8
    const cs = ((src >>> sh) & 255) / 255
    const cb = ((dst >>> sh) & 255) / 255
    const b = da8 === 0 ? cs : blendChannel(mode, cb, cs)
    const c = ((1 - sa) * da * cb + sa * ((1 - da) * cs + da * b)) / ra
    out[k] = Math.max(0, Math.min(255, Math.round(c * 255)))
  }
  const a = Math.max(0, Math.min(255, Math.round(ra * 255)))
  if (a === 0) return TRANSPARENT
  return ((a << 24) | (out[2]! << 16) | (out[1]! << 8) | out[0]!) >>> 0
}

/** A doc-sized raster containing the cel at its position (clipped to the document). */
export function celToRaster(cel: Cel | undefined, width: number, height: number): Raster {
  const out = createRaster(width, height)
  if (!cel) return out
  for (let y = 0; y < cel.h; y++) {
    const dy = cel.y + y
    if (dy < 0 || dy >= height) continue
    for (let x = 0; x < cel.w; x++) {
      const dx = cel.x + x
      if (dx < 0 || dx >= width) continue
      out.data[dy * width + dx] = cel.data[y * cel.w + x]!
    }
  }
  return out
}

/** Trim a raster to its non-transparent bounding box and return it as a cel, or null if empty. */
export function rasterToCel(img: Raster): Cel | null {
  const bounds = opaqueBounds(img)
  if (!bounds) return null
  const data = new Uint32Array(bounds.w * bounds.h)
  for (let y = 0; y < bounds.h; y++) {
    const s = (bounds.y + y) * img.width + bounds.x
    data.set(img.data.subarray(s, s + bounds.w), y * bounds.w)
  }
  return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, data }
}

/** Bounding box of pixels with alpha > 0, or null. */
export function opaqueBounds(img: { width: number; height: number; data: Uint32Array }): Rect | null {
  const d = new DirtyRect()
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[y * img.width + x]! >>> 24 !== 0) d.add(x, y)
    }
  }
  return d.rect()
}

export function isCelEmpty(cel: Cel): boolean {
  for (let i = 0; i < cel.data.length; i++) if (cel.data[i]! >>> 24 !== 0) return false
  return true
}

/** Composite a cel (positioned in doc space) onto `dst` using the layer's blend mode and opacity. */
export function compositeCel(dst: Raster, cel: Cel, layer: Pick<Layer, 'blend' | 'opacity'>): void {
  for (let y = 0; y < cel.h; y++) {
    const dy = cel.y + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < cel.w; x++) {
      const dx = cel.x + x
      if (dx < 0 || dx >= dst.width) continue
      const s = cel.data[y * cel.w + x]!
      if (s >>> 24 === 0) continue
      const i = dy * dst.width + dx
      dst.data[i] = blendPixel(dst.data[i]!, s, layer.blend, layer.opacity)
    }
  }
}

export interface FlattenOptions {
  /** Restrict to these layer ids (still subject to visibility unless includeHidden). */
  layerIds?: string[]
  /** Include reference layers (default false). */
  includeReference?: boolean
  /** Include layers with visible=false (default false). */
  includeHidden?: boolean
}

/** Flatten one frame into a doc-sized Uint32Array (width*height). */
export function flattenFrame(doc: Document, frameId: string, opts: FlattenOptions = {}): Uint32Array {
  const out = createRaster(doc.width, doc.height)
  const only = opts.layerIds ? new Set(opts.layerIds) : null
  for (const layer of doc.layers) {
    if (only && !only.has(layer.id)) continue
    if (layer.kind === 'reference' && !opts.includeReference) continue
    if (!layer.visible && !opts.includeHidden) continue
    const cel = doc.cels.get(celKey(layer.id, frameId))
    if (cel) compositeCel(out, cel, layer)
  }
  return out.data
}
