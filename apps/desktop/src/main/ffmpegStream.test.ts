import { spawn } from 'node:child_process'
import { constants as osConstants, setPriority } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => ({ pid: 4242 as number | undefined }))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ pid: spawned.pid })),
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  setPriority: vi.fn(),
}))

import { f32Chunks, floatsFrom, spawnBackgroundDecode } from './ffmpegStream'

function f32le(values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => {
    out.writeFloatLE(v, i * 4)
  })
  return out
}

function atOffset(bytes: Buffer, offset: number): Buffer {
  const pool = Buffer.alloc(bytes.length + offset)
  bytes.copy(pool, offset)
  return pool.subarray(offset)
}

describe('floatsFrom', () => {
  it('reads floats out of a buffer that does not start on a 4-byte boundary, as Node pool slices often do', () => {
    expect(Array.from(floatsFrom(atOffset(f32le([0.5, -0.25]), 1)))).toEqual([0.5, -0.25])
  })

  it('drops a trailing partial sample instead of throwing on a cut-off decode', () => {
    const bytes = Buffer.concat([f32le([0.5]), Buffer.from([1, 2, 3])])
    expect(Array.from(floatsFrom(bytes))).toEqual([0.5])
  })
})

describe('f32Chunks', () => {
  it('rejoins a sample split across stdout chunks, since a pipe cuts at any byte', () => {
    const bytes = f32le([0.5, -0.25, 0.125])
    const pushed: number[] = []
    const onData = f32Chunks((floats) => pushed.push(...floats))
    onData(atOffset(bytes.subarray(0, 3), 1))
    onData(atOffset(bytes.subarray(3, 9), 3))
    onData(bytes.subarray(9))
    expect(pushed).toEqual([0.5, -0.25, 0.125])
  })

  it('pushes nothing for a chunk too short to hold a whole sample', () => {
    const calls: Float32Array[] = []
    f32Chunks((floats) => calls.push(floats))(Buffer.from([1, 2]))
    expect(calls).toEqual([])
  })
})

describe('spawnBackgroundDecode', () => {
  it('reads only stdout and gives up after the timeout, so an unread stderr or a hung ffmpeg never stalls a background sweep', () => {
    spawnBackgroundDecode('/bin/ffmpeg', ['-i', '/in.flac'], 1000)
    expect(spawn).toHaveBeenLastCalledWith('/bin/ffmpeg', ['-i', '/in.flac'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    })
  })

  it('lowers the decode below normal priority, so a background sweep never stutters the app', () => {
    spawned.pid = 4242
    spawnBackgroundDecode('/bin/ffmpeg', ['-i', '/in.flac'], 1000)
    expect(setPriority).toHaveBeenCalledWith(4242, osConstants.priority.PRIORITY_BELOW_NORMAL)
  })

  it('still hands back the decode when the system refuses to lower it, since priority is only an optimization', () => {
    spawned.pid = 4242
    vi.mocked(setPriority).mockImplementationOnce(() => {
      throw new Error('EPERM')
    })
    expect(spawnBackgroundDecode('/bin/ffmpeg', [], 1000).pid).toBe(4242)
  })
})
