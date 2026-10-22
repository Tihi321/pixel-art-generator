import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type EngineLock, acquireLock, describeHolder, lockPath, readLiveLock, readLock, releaseLock } from '../../src/main/engineLock'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixel-studio-lock-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const info = (pid: number, mode: EngineLock['mode'] = 'headless'): EngineLock => ({
  pid,
  mode,
  port: 7457,
  url: 'http://127.0.0.1:7457/mcp',
  startedAt: '2026-10-22T10:00:00.000Z',
  version: '0.0.1'
})

// a pid that is not running: above the range Windows and Linux hand out
const DEAD_PID = 2 ** 22 + 12345

describe('engine.lock', () => {
  it('writes, reads and releases its own lock', async () => {
    const dir = join(root, 'a')
    expect(readLock(dir)).toBeNull()
    expect(acquireLock(dir, info(process.pid))).toEqual({ ok: true })
    expect(JSON.parse(await readFile(lockPath(dir), 'utf8'))).toMatchObject({ pid: process.pid, mode: 'headless', port: 7457, url: 'http://127.0.0.1:7457/mcp' })
    expect(readLiveLock(dir)?.pid).toBe(process.pid)
    releaseLock(dir, process.pid)
    expect(readLock(dir)).toBeNull()
  })

  it('replaces a stale lock and refuses a live one of another process', async () => {
    const dir = join(root, 'b')
    acquireLock(dir, info(DEAD_PID))
    expect(readLock(dir)?.pid).toBe(DEAD_PID)
    expect(readLiveLock(dir)).toBeNull()
    expect(acquireLock(dir, info(process.pid, 'window'))).toEqual({ ok: true })
    expect(readLock(dir)).toMatchObject({ pid: process.pid, mode: 'window' })
    // the parent process is alive and is not us
    await writeFile(lockPath(dir), JSON.stringify(info(process.ppid)), 'utf8')
    const r = acquireLock(dir, info(process.pid))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(describeHolder(r.holder)).toBe(`Pixel Studio is already running (headless, pid ${process.ppid}) and serves MCP on http://127.0.0.1:7457/mcp.`)
  })

  it('does not delete a lock another process wrote, and ignores garbage', async () => {
    const dir = join(root, 'c')
    acquireLock(dir, info(DEAD_PID))
    releaseLock(dir, process.pid)
    expect(readLock(dir)?.pid).toBe(DEAD_PID)
    await writeFile(lockPath(dir), 'not json', 'utf8')
    expect(readLock(dir)).toBeNull()
  })
})
