import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { ebur128MeasureArgs, parseEbur128Measured } from './normalize'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-loudness-equiv-'))
const src = join(dir, 'in.flac')

// Both passes report on stderr and exit 0, so the text has to be captured, not raised.
function stderrOf(args: string[]): string {
  return spawnSync(FF, args, { encoding: 'utf8' }).stderr
}

beforeAll(() => {
  // Thirty seconds of noise with a fade in and out: the shape of a track's ends, which is
  // where the two gates can disagree at all (a flat signal agrees to 0.04 at any length).
  // Not a jingle: measured across 6/15/30/60 s, a 6 s clip with a fast level swing put
  // the two 1.3 LU apart, and a DJ track is minutes long.
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=c=pink:a=0.3:d=30:r=44100:s=7',
    '-af',
    'afade=t=in:d=5,afade=t=out:st=25:d=5',
    '-c:a',
    'flac',
    src,
  ])
})

// The normalization used to measure with loudnorm's own print_format=json pass, at 4.5
// times the cost of ebur128 for the same EBU R128 figures (5.9 s against 1.3 s on a 6:23
// FLAC). This pins that the cheaper pass reads the same numbers, so the swap changes
// nothing about where a normalized track lands. Measured on six real tracks: integrated
// loudness, true peak and gate agree to the 0.1 ebur128 prints, and the output reached
// −14.0 for a −14 target either way. On synthetic extremes (a 30 s fade, an 8 dB level
// swing) the gates part by up to 0.3 LU, which is the tolerance here. The loudness range
// is not compared: the two window it differently on a fade (4 LU apart on this fixture,
// 0.4 on real tracks), and it only sets the linear/dynamic gate, which loudnormFilter
// derives from this same reading.
describe('ebur128 as the measurement pass', () => {
  it('reads the same four figures loudnorm measures', () => {
    const ln = stderrOf([
      '-hide_banner',
      '-nostats',
      '-i',
      src,
      '-af',
      'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ])
    const json = JSON.parse(ln.slice(ln.lastIndexOf('{'), ln.lastIndexOf('}') + 1))
    const eb = parseEbur128Measured(stderrOf(ebur128MeasureArgs(src)))
    expect(eb).not.toBeNull()
    const m = eb as { inputI: number; inputTp: number; inputThresh: number }
    expect(Math.abs(m.inputI - Number(json.input_i))).toBeLessThanOrEqual(0.3)
    expect(Math.abs(m.inputTp - Number(json.input_tp))).toBeLessThanOrEqual(0.1)
    expect(Math.abs(m.inputThresh - Number(json.input_thresh))).toBeLessThanOrEqual(0.5)
  })
})
