import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { headOffsetMs } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-head-offset-'))

function music(path: string, seed: number): void {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:seed=${seed}:d=12:r=44100:a=0.3`,
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='if(lt(mod(t,0.437),0.002),0.8,0)':s=44100:d=12",
    '-filter_complex',
    'amix=inputs=2:normalize=0',
    path,
  ])
}

function cut(from: string, to: string, extra: string[] = []): void {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-i',
    from,
    '-af',
    'atrim=start=1.234,asetpts=PTS-STARTPTS',
    ...extra,
    to,
  ])
}

// Engine DJ's positions are counted from the first sample. When a trim took the lead-in and
// only the backup still holds it, the repair moves every cue by exactly where the current
// audio starts inside that backup, so it has to be measured to the sample.
describe('headOffsetMs', () => {
  const original = join(dir, 'original.wav')
  music(original, 7)

  it('finds where a trimmed copy starts inside its original', async () => {
    const trimmed = join(dir, 'trimmed.wav')
    cut(original, trimmed)
    const ms = (await headOffsetMs(original, trimmed, 3)) ?? Number.NaN
    expect(Math.abs(ms - 1234)).toBeLessThanOrEqual(0.05)
  }, 30000)

  it('finds it the same after a resample to 48 kHz', async () => {
    const trimmed = join(dir, 'trimmed-48k.wav')
    cut(original, trimmed, ['-ar', '48000'])
    const ms = (await headOffsetMs(original, trimmed, 3)) ?? Number.NaN
    expect(Math.abs(ms - 1234)).toBeLessThanOrEqual(0.05)
  }, 30000)

  it('is null for an unrelated file', async () => {
    const other = join(dir, 'other.wav')
    music(other, 99)
    expect(await headOffsetMs(original, other, 3)).toBeNull()
  }, 30000)

  it('is null for a silent file', async () => {
    const silent = join(dir, 'silent.wav')
    execFileSync(FF, ['-y', '-v', 'error', '-i', original, '-af', 'volume=0', silent])
    expect(await headOffsetMs(original, silent, 3)).toBeNull()
  }, 30000)
})
