// Decode an image to packed RGBA in the Electron main process. PNG never comes here: the core decodes it
// in pure TypeScript. nativeImage reads PNG/JPEG; everything else Chromium decodes (WebP, GIF first frame,
// BMP, AVIF, ICO) goes through a hidden, never shown BrowserWindow. Needs the app to be ready.

import { app, BrowserWindow, nativeImage } from 'electron'
import { bgraToPacked, rgbaBytesToPacked } from './pixelBytes'

export interface DecodedImage {
  width: number
  height: number
  /** Packed 0xAABBGGRR pixels, row-major. */
  data: Uint32Array
}

const UNSUPPORTED = 'the image format is not supported (PNG, JPEG, WebP, GIF, BMP, AVIF)'

let decoder: BrowserWindow | null = null
let queue: Promise<unknown> = Promise.resolve()

async function getDecoder(): Promise<BrowserWindow> {
  if (decoder && !decoder.isDestroyed()) return decoder
  const win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.on('closed', () => {
    if (decoder === win) decoder = null
  })
  await win.loadURL('about:blank')
  decoder = win
  return win
}

/** Runs in the decoder page: bytes (base64) -> ImageBitmap -> canvas -> RGBA bytes (base64). */
const PAGE_SCRIPT = `(async (b64) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  let out = ''
  for (let i = 0; i < px.length; i += 0x8000) out += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000))
  return { width: bmp.width, height: bmp.height, base64: btoa(out) }
})`

async function decodeWithChromium(bytes: Uint8Array): Promise<DecodedImage> {
  const win = await getDecoder()
  const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  const r = (await win.webContents.executeJavaScript(`${PAGE_SCRIPT}(${JSON.stringify(b64)})`)) as { width: number; height: number; base64: string }
  const rgba = new Uint8Array(Buffer.from(r.base64, 'base64'))
  return { width: r.width, height: r.height, data: rgbaBytesToPacked(rgba, r.width, r.height) }
}

/** nativeImage first (fast, PNG/JPEG), then the Chromium decoder. Calls to the decoder window run one at a time. */
export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  if (!img.isEmpty()) {
    const { width, height } = img.getSize()
    return { width, height, data: bgraToPacked(img.toBitmap(), width, height) }
  }
  const run = queue.then(() => decodeWithChromium(bytes))
  queue = run.catch(() => undefined)
  try {
    return await run
  } catch {
    throw new Error(UNSUPPORTED)
  }
}

/** Closes the decoder window (on quit). */
export function disposeImageDecoder(): void {
  if (decoder && !decoder.isDestroyed()) decoder.destroy()
  decoder = null
}

app.on('before-quit', disposeImageDecoder)
