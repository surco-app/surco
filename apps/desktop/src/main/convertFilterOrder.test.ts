import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-order-'))
// Two seconds of full-scale tone in front of six very quiet ones. The gap between
// what a measurement sees with and without that head is ~33 LU, far wider than any
// tolerance, so the output level alone tells the two filter orders apart.
const headThenQuiet = join(dir, 'head-then-quiet.wav')
// A 24-bit tone at -98 dBFS: comfortably resolved at 24 bits, down at the 16-bit
// LSB. It needs ~89 dB of gain to reach the peak target, which is the lever that
// makes the dither stage's position visible. A wide source depth is also what puts
// a requantization in the chain at all.
const faint24 = join(dir, 'faint-24bit.wav')

const meta: TrackMetadata = {
  title: 'Order',
  artist: 'Test',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function peakDbOf(path: string): number {
  const res = spawnSync(
    FF,
    ['-v', 'info', '-i', path, '-af', 'astats=measure_overall=Peak_level', '-f', 'null', '-'],
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 16 },
  ).stderr
  const peak = res.match(/Peak level dB:\s+(-?[\d.]+)/)
  if (!peak) throw new Error(`no astats peak level in ffmpeg output for ${path}`)
  return Number.parseFloat(peak[1])
}

function loudnessOf(path: string): number {
  // ebur128 writes its summary to stderr, which is where execFileSync leaves it only
  // when the child's output is captured rather than inherited.
  const res = spawnSync(FF, ['-v', 'info', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 16,
  }).stderr
  const summary = res.slice(res.lastIndexOf('Integrated loudness:'))
  const match = summary.match(/I:\s+(-?[\d.]+)\s+LUFS/)
  if (!match) throw new Error(`no integrated loudness in ffmpeg output for ${path}`)
  return Number.parseFloat(match[1])
}

beforeAll(() => {
  const loud = join(dir, 'loud.wav')
  const quiet = join(dir, 'quiet.wav')
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'pcm_s16le',
    loud,
  ])
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=6',
    '-af',
    'volume=0.02',
    '-c:a',
    'pcm_s16le',
    quiet,
  ])
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-i',
    loud,
    '-i',
    quiet,
    '-filter_complex',
    '[0][1]concat=n=2:v=0:a=1',
    '-c:a',
    'pcm_s16le',
    headThenQuiet,
  ])
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:duration=4',
    '-af',
    'volume=-80dB',
    '-c:a',
    'pcm_s24le',
    faint24,
  ])
})

// The encode chain's order is declared in a comment above the filter array and was
// never asserted: reversing the whole array left every conversion test green, because
// they all check final state on material where the stages nearly commute. These
// measure the output on material where they emphatically do not — one case pinning
// the first stage (trim), one the last (dither).
describe('encode filter chain order', () => {
  it('starts from a file whose head dominates its own measurement', () => {
    expect(loudnessOf(headThenQuiet)).toBeGreaterThan(-30)
  })

  // Trim must run before the gain is measured. Normalizing first would size the gain
  // against the loud head and then throw that head away, leaving the kept audio tens
  // of LU under the target the user asked for.
  it('measures the gain on the kept audio, not on the trimmed-away head', async () => {
    const out = join(dir, 'trim-then-normalize.wav')
    await convertAudio(
      headThenQuiet,
      out,
      'wav',
      meta,
      undefined,
      { mode: 'loudness', targetLufs: -14, peakDb: -1, truePeakDb: -1 },
      undefined, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      { startSec: 2, endSec: 8 },
    )
    // Trim first: the quiet tail measures ~-55.7 LUFS and is lifted to the target.
    // Normalize first would measure ~-22.1 and land the tail near -48.
    expect(loudnessOf(out)).toBeGreaterThan(-25)
  })

  it('starts from a tone far below the 16-bit floor', () => {
    expect(peakDbOf(faint24)).toBeLessThan(-90)
  })

  // Dither must be the last stage. Requantizing to 16 bits before an 89 dB lift
  // amplifies the dither noise along with the signal and drives the result into the
  // ceiling: the output peaks at 0 dBFS instead of the -1 the user asked for. The
  // 16-bit pin is what puts a dither stage in the chain at all — without it the
  // 24-bit source stays 24-bit and there is no requantization to order.
  it('quantizes after the gain, not before it', async () => {
    const out = join(dir, 'gain-then-dither.wav')
    await convertAudio(
      faint24,
      out,
      'wav',
      meta,
      undefined,
      { mode: 'peak', targetLufs: -14, peakDb: -1, truePeakDb: -1 },
      undefined, // removeCover
      { bitDepth: '16' },
    )
    // Peak mode targets -1 dBFS. Dither-first clips at 0.0; the correct order lands
    // the faint tone well under the ceiling.
    expect(peakDbOf(out)).toBeLessThan(-1)
  })
})
