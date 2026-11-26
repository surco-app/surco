import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { measureCueWaveFine } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cue-fine-measure-'))
const stereo32k = join(dir, 'stereo32k.mp3')
const mono = join(dir, 'mono.wav')
const quiet = join(dir, 'quiet.wav')

function tone(out: string, args: string[]): void {
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', ...args, out])
}

beforeAll(() => {
  tone(stereo32k, ['-i', 'sine=frequency=80:duration=3', '-ac', '2', '-ar', '32000'])
  tone(mono, ['-i', 'aevalsrc=0.9*sin(2*PI*80*t):d=2:s=44100'])
  tone(quiet, ['-i', 'aevalsrc=0.3*sin(2*PI*80*t):d=2:s=44100'])
}, 30_000)

// The editor draws the fine wave at 1000 levels a second against the cue times; a level
// count off the file's real duration would slide every transient away from its cue.
describe('measureCueWaveFine', () => {
  it('reads the file rate itself, so a 32 kHz track still gets 1000 levels a second', async () => {
    const levels = await measureCueWaveFine(stereo32k)
    expect(levels?.length).toBeGreaterThanOrEqual(2990)
    expect(levels?.length).toBeLessThanOrEqual(3060)
  }, 30_000)

  // A mono file has no second channel to fold in; decoding it as stereo would fail and the
  // DJ would lose the wave on every mono rip.
  it('reads a mono file with its own channel count', async () => {
    const levels = await measureCueWaveFine(mono)
    expect(levels?.length).toBeGreaterThanOrEqual(1990)
    expect(levels?.length).toBeLessThanOrEqual(2010)
  }, 30_000)

  // The height is what shows the DJ where the track hits; a wave that drew a whisper as
  // tall as a full-scale tone would hide every drop.
  it('draws a quieter take lower than a loud one', async () => {
    const loud = (await measureCueWaveFine(mono)) ?? new Uint8Array()
    const soft = (await measureCueWaveFine(quiet)) ?? new Uint8Array()
    const middle = (levels: Uint8Array) => Math.max(...levels.slice(500, 1500))
    expect(middle(loud)).toBeGreaterThan(100)
    expect(middle(soft)).toBeLessThan(middle(loud) / 4)
  }, 30_000)

  it('answers null for a file it cannot read, so the editor falls back to the program wave', async () => {
    expect(await measureCueWaveFine(join(dir, 'missing.mp3'))).toBeNull()
  }, 30_000)
})
