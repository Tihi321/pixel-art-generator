import { ToolRegistry } from '../registry'
import { assetTools } from './assets'
import { documentTools } from './document'
import { drawingTools } from './drawing'
import { exportTools } from './export'
import { frameTools } from './frames'
import { historyTools } from './history'
import { layerTools } from './layers'
import { paletteTools } from './palette'
import { readingTools } from './reading'
import { studioTools } from './studio'
import { textTools } from './text'
import { uiTools } from './ui'

export { assetTools, documentTools, drawingTools, exportTools, frameTools, historyTools, layerTools, paletteTools, readingTools, studioTools, textTools, uiTools }

export const allTools = [
  ...documentTools,
  ...layerTools,
  ...frameTools,
  ...drawingTools,
  ...textTools,
  ...uiTools,
  ...readingTools,
  ...paletteTools,
  ...assetTools,
  ...exportTools,
  ...studioTools,
  ...historyTools
]

/** A registry with every tool registered. */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry(allTools)
}
