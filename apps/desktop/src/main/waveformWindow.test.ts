import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { measureWaveformWindow } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-wavewin-'))
const src = join(dir, 'in.wav')

beforeAll(() => {
  // 2 s of silence then 2 s of tone: the two windows below must read apart.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(gte(t\\,2)\\,0.5*sin(2*PI*440*t)\\,0):s=44100:d=4',
    '-c:a',
    'pcm_s16le',
    src,
  ])
})

// The deep zoom's on-demand slice, through the real seek+decode: the peaks must
// describe the REQUESTED window, not the file's head — a broken -ss would return
// silence for a window that sits on the tone.
describe('measureWaveformWindow', () => {
  it('decodes exactly the requested slice at the requested resolution', async () => {
    const quiet = await measureWaveformWindow(src, 0, 2, 200)
    const loud = await measureWaveformWindow(src, 2, 2, 200)
    expect(quiet?.peaks.length).toBe(200)
    expect(loud?.peaks.length).toBe(200)
    expect(Math.max(...(quiet?.peaks ?? [1]))).toBeLessThan(0.01)
    expect(Math.max(...(loud?.peaks ?? [0]))).toBeGreaterThan(0.4)
  }, 30000)

  it('returns null past the end of the file', async () => {
    expect(await measureWaveformWindow(src, 60, 2, 200)).toBeNull()
  }, 30000)
})
