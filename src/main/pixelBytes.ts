// Pixel byte layouts to the packed 0xAABBGGRR pixels of the core. No Electron import, so tests can use it.

/** Packed pixel from channels; a fully transparent pixel is always 0 (the core's TRANSPARENT). */
function pack(r: number, g: number, b: number, a: number): number {
  return a === 0 ? 0 : ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/** nativeImage.toBitmap() bytes: B, G, R, A per pixel. */
export function bgraToPacked(bgra: Uint8Array, width: number, height: number): Uint32Array {
  const data = new Uint32Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = pack(bgra[i * 4 + 2]!, bgra[i * 4 + 1]!, bgra[i * 4]!, bgra[i * 4 + 3]!)
  return data
}

/** Canvas getImageData bytes: R, G, B, A per pixel (not premultiplied). */
export function rgbaBytesToPacked(rgba: Uint8Array, width: number, height: number): Uint32Array {
  const data = new Uint32Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = pack(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!, rgba[i * 4 + 3]!)
  return data
}
