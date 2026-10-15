import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { measureLoudness } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-peakcount-'))
const open = join(dir, 'open.wav')
const limited = join(dir, 'limited.wav')

beforeAll(() => {
  const mix = 'aevalsrc=0.3*sin(2*PI*440*t)+0.2*sin(2*PI*1234.5*t)+0.2*sin(2*PI*3170.3*t):d=4'
  const sine = ['-v', 'error', '-y', '-f', 'lavfi', '-i', mix]
  execFileSync(FF, [...sine, '-af', 'volume=0.9', '-c:a', 'pcm_s16le', open])
  execFileSync(FF, [
    ...sine,
    '-af',
    'volume=4,alimiter=limit=0.5:level=false',
    '-c:a',
    'pcm_s16le',
    limited,
  ])
})

describe('peak count', () => {
  // A limiter pins many samples to its ceiling; an untouched tone touches its peak a few
  // times per cycle at most. This is the number that told Netzwerk's two copies apart.
  it('counts far more samples at the peak on a limited copy than on an open one', async () => {
    const a = await measureLoudness(open)
    const b = await measureLoudness(limited)
    expect(a?.peakCount).not.toBeNull()
    expect(b?.peakCount ?? 0).toBeGreaterThan((a?.peakCount ?? 0) * 10)
  })
})
