// ToolRegistry: zod-schema'd tool definitions over core. No DOM, no Electron.
export const TOOLS_VERSION = 1

export { EditorSession } from './session'
export { ToolRegistry, defineTool, createToolHost, textResult, errorResult, jsonResult, imageResult, resultText, formatZodError } from './registry'
export type { ToolContext, ToolDefinition, RegisteredTool, ToolGroup, ToolDef, ToolHost, ToolResult, TurnToolHost } from './registry'
export type { ToolServices, AssetService, AssetMeta, AssetKind, AssetFilter, AssetData, AssetSaveInput, UserPaletteInfo } from './services'
export { createMemoryToolServices } from './memoryServices'
export type { MemoryToolServices } from './memoryServices'
export { renderPreview } from './render'
export { allTools, createDefaultRegistry } from './defs'
export { GUIDE, GUIDE_SHORT } from './guideText'
export { DocumentSet, resolveDocument, writeDocumentPng, exportToTarget } from './documents'
export type { DocumentHost, DocumentInfo, DocumentRef, ExportTarget } from './documents'
