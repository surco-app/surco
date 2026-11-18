import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const decodes: string[] = []
let failNextDecode = false

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out?: { stdout: Buffer; stderr: string }) => void,
  ) => {
    decodes.push(args[args.indexOf('-i') + 1])
    if (failNextDecode) {
      failNextDecode = false
      cb(new Error('share went away'))
      return
    }
    cb(null, { stdout: Buffer.alloc(16), stderr: '' })
  },
}))

vi.mock('./worker', () => ({
  runInWorker: async (job: { type: string }) => (job.type === 'bpm' ? { bpm: 128 } : { key: '8A' }),
  signalWorkers: () => undefined,
}))

import { measureBpm, measureKey } from './ffmpeg'

const dir = mkdtempSync(join(tmpdir(), 'surco-tempo-key-'))
let made = 0
function track(): string {
  const path = join(dir, `track-${made++}.flac`)
  writeFileSync(path, 'audio')
  return path
}

beforeEach(() => {
  decodes.length = 0
})

describe('tempo and key share one decode of a track', () => {
  it('reads the file once when the key is asked after the tempo has finished', async () => {
    const path = track()

    expect(await measureBpm(path)).toEqual({ bpm: 128 })
    expect(await measureKey(path)).toEqual({ key: '8A' })

    expect(decodes).toEqual([path])
  })

  it('reads the file once when the tempo is asked after the key has finished', async () => {
    const path = track()

    expect(await measureKey(path)).toEqual({ key: '8A' })
    expect(await measureBpm(path)).toEqual({ bpm: 128 })

    expect(decodes).toEqual([path])
  })

  it('reads the file again once its audio has been rewritten', async () => {
    const path = track()

    await measureBpm(path)
    writeFileSync(path, 'audio after a trim')
    await measureKey(path)

    expect(decodes).toEqual([path, path])
  })

  it('reads the file again after a decode that failed', async () => {
    const path = track()
    failNextDecode = true

    await expect(measureBpm(path)).rejects.toThrow()
    expect(await measureKey(path)).toEqual({ key: '8A' })

    expect(decodes).toEqual([path, path])
  })

  it('stops remembering a track once many others have been measured since', async () => {
    const first = track()
    await measureBpm(first)
    for (let i = 0; i < 64; i++) await measureBpm(track())
    decodes.length = 0

    await measureKey(first)

    expect(decodes).toEqual([first])
  })
})
