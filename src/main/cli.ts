// Command line of the app. No Electron import, so it is unit-testable.
//
//   --mcp-only [--port N]   headless: the MCP server with no window (yarn mcp)
//   --open <path> [--export-to <path>] [--export-width W --export-height H]
//                           window mode: open a project/PNG; every save also exports a PNG (VN Studio round trip)

import { isAbsolute, resolve } from 'node:path'

export interface CliArgs {
  mcpOnly: boolean
  /** --port N (headless MCP port). */
  port?: number
  /** --open <path>, absolute. */
  open?: string
  /** --export-to <path>, absolute. */
  exportTo?: string
  exportWidth?: number
  exportHeight?: number
}

const VALUE_FLAGS = ['--open', '--export-to', '--export-width', '--export-height', '--port']

/**
 * Flag values. `--flag=value` is read as is. For `--flag value` the value is a separate argument; but
 * Electron rebuilds a second instance's command line the way Chromium does (all `--switches` first, then
 * the positional arguments in their original order), so the values of the space-separated flags are the
 * LAST positional arguments, assigned in the order their flags appear.
 */
function flagValues(argv: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const spaced: string[] = []
  const positionals: string[] = []
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) out.set(a.slice(0, eq), a.slice(eq + 1))
      else if (VALUE_FLAGS.includes(a)) spaced.push(a)
    } else positionals.push(a)
  }
  const values = positionals.slice(Math.max(0, positionals.length - spaced.length))
  if (values.length === spaced.length) spaced.forEach((flag, i) => out.set(flag, values[i]!))
  return out
}

function intValue(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function absolute(p: string | undefined, cwd: string): string | undefined {
  if (!p) return undefined
  return isAbsolute(p) ? p : resolve(cwd, p)
}

/** Parse Electron's argv (or a `second-instance` command line). Relative paths are resolved against `cwd`. */
export function parseCli(argv: string[], cwd: string = process.cwd()): CliArgs {
  const flags = flagValues(argv)
  const port = intValue(flags.get('--port'))
  return {
    mcpOnly: argv.includes('--mcp-only'),
    ...(port !== undefined && port <= 65535 ? { port } : {}),
    open: absolute(flags.get('--open'), cwd),
    exportTo: absolute(flags.get('--export-to'), cwd),
    exportWidth: intValue(flags.get('--export-width')),
    exportHeight: intValue(flags.get('--export-height'))
  }
}

/** The arguments of the `open_document` tool for a parsed command line (undefined without --open). */
export function openDocumentArgs(cli: CliArgs): Record<string, unknown> | undefined {
  if (!cli.open) return undefined
  return {
    path: cli.open,
    ...(cli.exportTo ? { exportTo: cli.exportTo } : {}),
    ...(cli.exportTo && cli.exportWidth && cli.exportHeight ? { exportWidth: cli.exportWidth, exportHeight: cli.exportHeight } : {})
  }
}
