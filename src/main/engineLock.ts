// engine.lock: the engine (window or headless) that serves MCP for a data folder says so in
// `<root>/engine.lock`, so a second start can name it instead of failing on the port. No Electron import.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface EngineLock {
  pid: number
  mode: 'window' | 'headless'
  port: number
  url: string
  startedAt: string
  version: string
}

export function lockPath(root: string): string {
  return join(root, 'engine.lock')
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: the process exists but belongs to someone else
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The lock as written (alive or not), or null when there is none or it is unreadable. */
export function readLock(root: string): EngineLock | null {
  try {
    const v = JSON.parse(readFileSync(lockPath(root), 'utf8')) as Partial<EngineLock>
    if (typeof v.pid !== 'number' || (v.mode !== 'window' && v.mode !== 'headless') || typeof v.port !== 'number' || typeof v.url !== 'string') return null
    return { pid: v.pid, mode: v.mode, port: v.port, url: v.url, startedAt: String(v.startedAt ?? ''), version: String(v.version ?? '') }
  } catch {
    return null
  }
}

/** The lock when its process is still running; a stale lock (dead pid) is null. */
export function readLiveLock(root: string): EngineLock | null {
  const lock = readLock(root)
  return lock && isAlive(lock.pid) ? lock : null
}

/** Writes the lock. Returns the other live holder instead when there is one (a lock of this pid is replaced). */
export function acquireLock(root: string, info: EngineLock): { ok: true } | { ok: false; holder: EngineLock } {
  const held = readLiveLock(root)
  if (held && held.pid !== info.pid) return { ok: false, holder: held }
  mkdirSync(root, { recursive: true })
  writeFileSync(lockPath(root), JSON.stringify(info, null, 2) + '\n', 'utf8')
  return { ok: true }
}

/** Deletes the lock, but only when `pid` wrote it. */
export function releaseLock(root: string, pid: number): void {
  if (readLock(root)?.pid !== pid) return
  try {
    rmSync(lockPath(root), { force: true })
  } catch {
    // a lock that stays behind is stale (dead pid) and replaced by the next start
  }
}

/** "window, pid 1234" style description plus the URL, for messages. */
export function describeHolder(lock: EngineLock): string {
  return `Pixel Studio is already running (${lock.mode}, pid ${lock.pid}) and serves MCP on ${lock.url}.`
}
