// UI-only state (current tool, viewport, brush settings, panels, playback). The document itself lives in
// the EditorSession (state/session.ts), never here.

import { create } from 'zustand'
import type { ToolId } from '../lib/keys'
import { type Viewport, MAX_ZOOM, MIN_ZOOM } from '../lib/viewport'

export type DialogId = null | 'new' | 'open' | 'save' | 'export' | 'resize' | 'settings' | 'saveAsset'
export type PanelTab = 'edit' | 'assets' | 'chat'

export interface UiState {
  tool: ToolId
  brushSize: number
  mirrorX: boolean
  mirrorY: boolean
  shapeFilled: boolean
  fillContiguous: boolean
  showGrid: boolean

  viewport: Viewport
  /** Set by the canvas view; used to fit/centre. */
  viewSize: { w: number; h: number }

  // playback
  playing: boolean
  fps: number
  useFrameDurations: boolean
  loop: boolean
  /** Tag id being played/looped, '' for the whole animation. */
  playTagId: string

  // palette / timeline selection
  selectedSwatch: number
  selectedTagId: string

  /** Right column: the Palette/Layers panels, the asset library or the agent chat. */
  panelTab: PanelTab
  // asset placement options (Assets panel: Place buttons and drag onto the canvas)
  assetNewLayer: boolean
  assetAnimation: boolean
  assetShowRefLayer: boolean
  dialog: DialogId
  projectPath: string | null
  status: string

  set: (patch: Partial<Omit<UiState, 'set'>>) => void
  setTool: (tool: ToolId) => void
  setViewport: (vp: Viewport) => void
  setStatus: (msg: string) => void
  openDialog: (d: DialogId) => void
}

export const useUi = create<UiState>((set) => ({
  tool: 'pencil',
  brushSize: 1,
  mirrorX: false,
  mirrorY: false,
  shapeFilled: false,
  fillContiguous: true,
  showGrid: true,

  viewport: { zoom: 8, panX: 0, panY: 0 },
  viewSize: { w: 0, h: 0 },

  playing: false,
  fps: 12,
  useFrameDurations: true,
  loop: true,
  playTagId: '',

  selectedSwatch: -1,
  selectedTagId: '',

  panelTab: 'edit',
  assetNewLayer: true,
  assetAnimation: false,
  assetShowRefLayer: false,
  dialog: null,
  projectPath: null,
  status: '',

  set: (patch) => set(patch),
  setTool: (tool) => set({ tool }),
  setViewport: (vp) => set({ viewport: { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom)), panX: vp.panX, panY: vp.panY } }),
  setStatus: (status) => set({ status }),
  openDialog: (dialog) => set({ dialog })
}))
