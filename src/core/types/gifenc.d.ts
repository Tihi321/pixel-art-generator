// Minimal typings for gifenc (the package ships none).
declare module 'gifenc' {
  export type RgbColor = [number, number, number]
  export type RgbaColor = [number, number, number, number]

  export interface WriteFrameOptions {
    palette?: Array<RgbColor | RgbaColor>
    delay?: number
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    colorDepth?: number
    dispose?: number
    first?: boolean
  }

  export interface GifEncoderInstance {
    reset(): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    writeHeader(): void
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoderInstance

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444'
      clearAlpha?: boolean
      clearAlphaColor?: number
      clearAlphaThreshold?: number
      oneBitAlpha?: boolean | number
      useSqrt?: boolean
    }
  ): Array<RgbColor | RgbaColor>

  const defaultExport: typeof GIFEncoder
  export default defaultExport
}
