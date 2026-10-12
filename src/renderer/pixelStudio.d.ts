import type { PixelStudioApi } from '../shared/ipc'
import type { EditorSession } from '../tools/session'
import type { useUi } from './state/ui'

declare global {
  interface Window {
    pixelStudio: PixelStudioApi
    /** Debug / test hook: the live session, UI store and a doc-pixel -> page coordinate helper. */
    __pixelStudio?: {
      session: EditorSession
      ui: typeof useUi
      pixelToPage: (x: number, y: number) => { x: number; y: number }
    }
  }
}

export {}
