import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in ffmpeg child: an EventEmitter carrying a stdout stream and a recorded kill,
// so a test can leave a scan mid-decode and assert what happens to the process.
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  return child
}

const spawned: ReturnType<typeof fakeChild>[] = []

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = fakeChild()
    spawned.push(child)
    return child
  },
}))

// setPriority takes a real pid; the fake one would throw EPERM/ESRCH on a live system.
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  setPriority: vi.fn(),
}))

import { activeScanCount, killActiveScans, runChannelScan } from './channelScan'

beforeEach(() => {
  spawned.length = 0
})

// The scan spawns ffmpeg from inside the DSP worker thread, where the main process's
// activeConversions registry can't see it: quitting Surco mid-scan left a native decode
// of a long mix — gigabytes of f32, the most expensive probe there is — running on with
// nothing left to stop it. The `timeout` option caps it at two minutes, but that is a
// ceiling, not a cancellation: the user closes the app and the fan keeps going.
describe('killActiveScans', () => {
  it('kills a scan still decoding', () => {
    const scan = runChannelScan('/in.flac', '/bin/ffmpeg', 2, 120_000)
    scan.catch(() => {})
    killActiveScans()
    expect(spawned[0].kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('kills every scan the pool has in flight, not just the first', () => {
    for (const input of ['/a.flac', '/b.flac', '/c.flac']) {
      runChannelScan(input, '/bin/ffmpeg', 2, 120_000).catch(() => {})
    }
    killActiveScans()
    expect(spawned).toHaveLength(3)
    for (const child of spawned) expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  // A finished scan has already released its process. Killing by pid after the fact could
  // signal an unrelated process the OS has since given that pid to.
  it('does not kill a scan that already finished', () => {
    const scan = runChannelScan('/in.flac', '/bin/ffmpeg', 2, 120_000)
    scan.catch(() => {})
    spawned[0].emit('close', 0)
    killActiveScans()
    expect(spawned[0].kill).not.toHaveBeenCalled()
  })

  it('forgets a scan that failed, so a later quit cannot signal it', () => {
    const scan = runChannelScan('/in.flac', '/bin/ffmpeg', 2, 120_000)
    scan.catch(() => {})
    spawned[0].emit('error', new Error('spawn failed'))
    killActiveScans()
    expect(spawned[0].kill).not.toHaveBeenCalled()
  })

  it('is a no-op when nothing is scanning', () => {
    expect(() => killActiveScans()).not.toThrow()
  })

  // A folder sweep runs this probe over every track in the crate. If the registry only
  // ever grew, holding a reference to each finished child, it would be a leak the size of
  // the library — worse than the orphan it exists to prevent.
  it('empties itself as scans settle, so a sweep leaves nothing behind', () => {
    for (const input of ['/a.flac', '/b.flac', '/c.flac']) {
      runChannelScan(input, '/bin/ffmpeg', 2, 120_000).catch(() => {})
    }
    expect(activeScanCount()).toBe(3)
    spawned[0].emit('close', 0)
    spawned[1].emit('error', new Error('spawn failed'))
    spawned[2].emit('close', 1)
    expect(activeScanCount()).toBe(0)
  })
})
