import type { PixelStudioApi } from '../shared/ipc'

declare global {
  interface Window {
    pixelStudio: PixelStudioApi
  }
}

export {}
