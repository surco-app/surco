import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { measureResolution } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-resolution-'))
const whole = join(dir, 'whole.flac')
const trimmed = join(dir, 'trimmed.flac')

beforeAll(() => {
  // A 48 kHz track whose content above the 22.05 kHz wall comes in short bursts, the
  // way cymbals and transients do on a real master: steady pink noise walled at
  // 22.5 kHz, plus 250 ms of quiet white noise every 3 s. The bursts sit at the tail of
  // each 3 s cell so that a 0.75 s probe window opening at the cell start catches one
  // whole and a window opening a few tenths earlier catches only part of it. Levels
  // are computed, not tuned: the burst is 22.3 dB under the base so the two probe
  // bands read ~9 dB apart when every burst is caught and ~14 dB when most are missed.
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    "anoisesrc=d=40:c=pink:r=48000:a=0.5:seed=1,firequalizer=gain='if(lt(f,22500),0,-120)'",
    '-f',
    'lavfi',
    '-i',
    "anoisesrc=d=40:c=white:r=48000:a=0.5:seed=2,volume=-22.3dB,volume='if(between(mod(t-2,3),0.5,0.75),1,0)':eval=frame",
    '-filter_complex',
    'amix=inputs=2:normalize=0',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    whole,
  ])
  // The same audio with half a second of tail cut off, as trimming trailing silence
  // does. Nothing the probes read has changed; only where they land.
  execFileSync(FF, ['-y', '-v', 'error', '-i', whole, '-t', '39.5', '-c:a', 'flac', '-sample_fmt', 's32', trimmed])
}, 60000)

// A user's 48 kHz file graded "upsampled" and its own copy, trimmed and normalised by
// Surco, graded "hires". Measured off both, every probe band read the same audio at the
// same instant: the verdicts differed because the probe windows are placed as a
// fraction of the duration, so a 651 ms trim slid each one a few tenths of a second,
// and ultrasonic content is bursty enough that a few tenths move a 0.75 s reading by
// up to 9.5 dB. On the untrimmed file alone, sliding the grid under one second swung
// the wall reading 3.7 to 17.5 dB across the 12 dB threshold. Twelve windows of 0.75 s
// measure a codec wall fine, because a codec wall is in every frame; they do not
// measure content that is only there some of the time.
describe('measureResolution', () => {
  it('gives a track and its trimmed copy the same verdict', async () => {
    const [a, b] = await Promise.all([measureResolution(whole, 48000), measureResolution(trimmed, 48000)])
    expect(a).not.toBe('unknown')
    expect(b).toBe(a)
  }, 60000)
})
