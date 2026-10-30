import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const spawned: { args: string[]; signal?: AbortSignal }[] = []
let probeOut: string | undefined
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const real = promisify(actual.execFile)
  const execFile = Object.assign(actual.execFile.bind(actual), {
    [promisify.custom]: (file: string, args: string[], opts: never) => {
      spawned.push({ ...(opts as object), args } as (typeof spawned)[number])
      if (probeOut !== undefined && args.includes('-show_entries'))
        return Promise.resolve({ stdout: probeOut, stderr: '' })
      return real(file, args, opts)
    },
  })
  return { ...actual, execFile }
})

import { assertDecodable, probeAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-decodereads-'))

beforeEach(() => {
  spawned.length = 0
  probeOut = undefined
})

describe('verify decode reads', () => {
  // A copy of a damaged source is judged by how much it delivers next to the source: those
  // decodes hold the source open too, so the cancel has to reach them as well.
  it('the decodes that compare a damaged copy with its source carry the signal', async () => {
    const clean = join(dir, 'clean.mp3')
    execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=6', clean])
    const bytes = readFileSync(clean)
    const mid = Math.floor(bytes.length / 2)
    const damaged = join(dir, 'damaged.mp3')
    writeFileSync(
      damaged,
      Buffer.concat([bytes.subarray(0, mid), Buffer.alloc(3000, 0xff), bytes.subarray(mid)]),
    )
    const signal = new AbortController().signal
    await assertDecodable(damaged, damaged, { signal }).catch(() => null)
    const decodes = spawned.filter((s) => s.args.includes('null'))
    expect(decodes.length).toBeGreaterThan(2)
    expect(decodes.every((s) => s.signal === signal)).toBe(true)
  })

  it('a stream duration of N/A falls back to the format duration', async () => {
    probeOut = JSON.stringify({
      streams: [{ codec_name: 'flac', sample_rate: '44100', duration: 'N/A' }],
      format: { duration: '12.5' },
    })
    expect((await probeAudio(join(dir, 'any.flac'))).headerSeconds).toBe(12.5)
  })
})
