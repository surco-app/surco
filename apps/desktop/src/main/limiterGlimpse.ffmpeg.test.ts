import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { limiterGlimpse } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-glimpse-'))
const open = join(dir, 'open.wav')
const limited = join(dir, 'limited.wav')

beforeAll(() => {
  const beat =
    'aevalsrc=(0.2+0.8*exp(-30*mod(t\\,0.5)))*(0.5*sin(2*PI*110*t)+0.3*sin(2*PI*1234.5*t)):d=6'
  const src = ['-v', 'error', '-y', '-f', 'lavfi', '-i', beat]
  execFileSync(FF, [...src, '-af', 'volume=0.3', '-c:a', 'pcm_s16le', open])
  execFileSync(FF, [
    ...src,
    '-af',
    'volume=2,alimiter=limit=0.5:level=false',
    '-c:a',
    'pcm_s16le',
    limited,
  ])
})

const peak = (pairs: number[]): number => Math.max(...pairs.map(Math.abs))

describe('limiterGlimpse', () => {
  // The picture has to show what the limiter removed: with the open copy brought to the
  // limited copy's level, its hits rise well past where the limited copy stops.
  it('draws the open copy rising past the limited one at the same loudness', async () => {
    const g = await limiterGlimpse(limited, open, 44100)
    expect(g).not.toBeNull()
    expect(g?.worse.length).toBe(g?.better.length)
    expect(peak(g?.better ?? [])).toBeGreaterThan(peak(g?.worse ?? []) * 1.2)
  })

  it('gives nothing for a file it cannot decode', async () => {
    expect(await limiterGlimpse(join(dir, 'missing.wav'), open, 44100)).toBeNull()
  })
})
