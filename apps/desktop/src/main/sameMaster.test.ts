import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { comparePair } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-pair-'))
const base = join(dir, 'base.wav')
const shifted = join(dir, 'shifted.wav')
const limited = join(dir, 'limited.wav')
const other = join(dir, 'other.wav')

const mix = (f1: number, f2: number, f3: number): string =>
  `aevalsrc=0.3*sin(2*PI*${f1}*t)+0.2*sin(2*PI*${f2}*t)+0.2*sin(2*PI*${f3}*t):d=20:s=11025`

beforeAll(() => {
  const q = ['-v', 'error', '-y']
  execFileSync(FF, [...q, '-f', 'lavfi', '-i', mix(440, 1234.5, 3170.3), '-c:a', 'pcm_s16le', base])
  execFileSync(FF, [...q, '-i', base, '-af', 'adelay=6S:all=1', '-c:a', 'pcm_s16le', shifted])
  execFileSync(FF, [
    ...q,
    '-i',
    base,
    '-af',
    'volume=4,alimiter=limit=0.5:level=false',
    '-c:a',
    'pcm_s16le',
    limited,
  ])
  execFileSync(FF, [
    ...q,
    '-f',
    'lavfi',
    '-i',
    mix(523.3, 1801.7, 4410.9),
    '-c:a',
    'pcm_s16le',
    other,
  ])
})

describe('comparePair', () => {
  // Two rips of one master rarely start on the same sample; the probe has to line them up
  // before it can say they are the same audio.
  it('finds a copy shifted by a few samples to be the same audio', async () => {
    const p = await comparePair(base, shifted)
    expect(p?.correlation).toBeGreaterThan(0.999)
    expect(p?.residualDb).toBeLessThan(-60)
  })

  // Netzwerk's two copies: same master, one pushed through a limiter.
  it('keeps a limited copy of the same master above the same-master line', async () => {
    const p = await comparePair(base, limited)
    expect(p?.correlation).toBeGreaterThanOrEqual(0.98)
    expect(p?.residualDb).toBeGreaterThan(-60)
  })

  // Across different sources peak count and crest vary as much as within a master, so a
  // different recording must never pass for the same one.
  it('puts a different recording far below the same-master line', async () => {
    expect((await comparePair(base, other))?.correlation ?? 1).toBeLessThan(0.9)
  })

  it('has nothing to say about a file it cannot decode', async () => {
    expect(await comparePair(base, join(dir, 'missing.wav'))).toBeNull()
  })
})
