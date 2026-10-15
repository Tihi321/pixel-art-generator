// Decode JPEG/WebP (anything Chromium's image decoder reads) to RGBA with Electron's nativeImage.
// PNG never comes here: the core decodes it in pure TypeScript. Needs the Electron main process.

import { nativeImage } from 'electron'

export interface DecodedImage {
  width: number
  height: number
  /** Packed 0xAABBGGRR pixels, row-major. */
  data: Uint32Array
}

export function decodeWithNativeImage(bytes: Uint8Array): DecodedImage {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  if (img.isEmpty()) throw new Error('the image format is not supported (use PNG or JPEG)')
  const { width, height } = img.getSize()
  const bgra = img.toBitmap()
  const data = new Uint32Array(width * height)
  for (let i = 0; i < data.length; i++) {
    const b = bgra[i * 4]!
    const g = bgra[i * 4 + 1]!
    const r = bgra[i * 4 + 2]!
    const a = bgra[i * 4 + 3]!
    data[i] = a === 0 ? 0 : ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
  }
  return { width, height, data }
}
