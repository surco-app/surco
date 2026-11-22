import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { PairFacts } from '../shared/types'
import { comparePair } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-pair-'))
const base = join(dir, 'base.wav')
const shifted = join(dir, 'shifted.wav')
const shiftedOdd = join(dir, 'shifted-odd.wav')
const limited = join(dir, 'limited.wav')
const other = join(dir, 'other.wav')
const silence = join(dir, 'silence.wav')
const headed = join(dir, 'headed.wav')
const trimmed = join(dir, 'trimmed.wav')
const inverted = join(dir, 'inverted.wav')
const otherShort = join(dir, 'other-short.wav')
const noise = join(dir, 'noise.wav')
const farHead = join(dir, 'far-head.wav')

const mix = (f1: number, f2: number, f3: number): string =>
  `aevalsrc=0.3*sin(2*PI*${f1}*t)+0.2*sin(2*PI*${f2}*t)+0.2*sin(2*PI*${f3}*t):d=20`

beforeAll(() => {
  const q = ['-v', 'error', '-y']
  execFileSync(FF, [...q, '-f', 'lavfi', '-i', mix(440, 1234.5, 3170.3), '-c:a', 'pcm_s16le', base])
  execFileSync(FF, [...q, '-i', base, '-af', 'adelay=6S:all=1', '-c:a', 'pcm_s16le', shifted])
  execFileSync(FF, [...q, '-i', base, '-af', 'adelay=7S:all=1', '-c:a', 'pcm_s16le', shiftedOdd])
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
  execFileSync(FF, [...q, '-f', 'lavfi', '-i', 'anullsrc=d=20', '-c:a', 'pcm_s16le', silence])
  execFileSync(FF, [...q, '-i', base, '-af', 'adelay=5s:all=1', '-c:a', 'pcm_s16le', headed])
  execFileSync(FF, [...q, '-i', base, '-af', 'atrim=start=3', '-c:a', 'pcm_s16le', trimmed])
  execFileSync(FF, [
    ...q,
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=20:c=pink:seed=7:a=0.3',
    '-c:a',
    'pcm_s16le',
    noise,
  ])
  execFileSync(FF, [
    ...q,
    '-i',
    noise,
    '-af',
    'volume=-1,adelay=4s:all=1',
    '-c:a',
    'pcm_s16le',
    inverted,
  ])
  execFileSync(FF, [...q, '-i', other, '-af', 'atrim=end=15', '-c:a', 'pcm_s16le', otherShort])
  execFileSync(FF, [...q, '-i', base, '-af', 'adelay=60s:all=1', '-c:a', 'pcm_s16le', farHead])
})

describe('comparePair', () => {
  // Two rips of one master rarely start on the same sample; the probe has to line them up
  // before it can say they are the same audio.
  // Offsets that are not a multiple of 4 samples at 44.1 kHz fall between the samples of
  // an 11025 Hz decode, so identical copies only cancel when aligned at full rate.
  it.each([
    ['6', shifted],
    ['7', shiftedOdd],
  ])('finds a copy shifted by %s samples to be the same audio', async (_n, copy) => {
    const p = (await comparePair(base, copy)) as PairFacts | null
    expect(p?.correlation).toBeGreaterThan(0.999)
    expect(p?.residualDb).toBeLessThan(-60)
    expect(Math.abs(p?.gainDb ?? 1)).toBeLessThan(0.01)
  })

  // Netzwerk's two copies: same master, one pushed through a limiter.
  it('keeps a limited copy of the same master above the same-master line', async () => {
    const p = (await comparePair(base, limited)) as PairFacts | null
    expect(p?.correlation).toBeGreaterThanOrEqual(0.98)
    expect(p?.residualDb).toBeGreaterThan(-60)
  })

  // Across different sources peak count and crest vary as much as within a master, so a
  // different recording must never pass for the same one.
  it('puts a different recording far below the same-master line', async () => {
    const p = (await comparePair(base, other)) as PairFacts | null
    expect(p?.correlation ?? 1).toBeLessThan(0.9)
  })

  // Silence aligns with anything at any lag; a verdict on it would be a guess.
  it('has nothing to say about a silent file', async () => {
    expect(await comparePair(base, silence)).toBeNull()
    expect(await comparePair(silence, base)).toBeNull()
  })

  it('has nothing to say about a file it cannot decode', async () => {
    expect(await comparePair(base, join(dir, 'missing.wav'))).toBeNull()
  })

  // The ±1 s probe misses a copy of one master whose head was trimmed or padded (a pregap, a
  // damaged start): its length differs by exactly that shift. Searching as far as the length
  // gap finds it again, whichever way its polarity runs, so it is never another version.
  it.each([
    ['five seconds of silence at the head', base, headed],
    ['three seconds trimmed from the head', base, trimmed],
    ['four seconds later with its polarity reversed', noise, inverted],
  ])('finds the same master with %s', async (_what, reference, copy) => {
    const p = await comparePair(reference, copy, true)
    expect(p?.versionCorrelation).toBeGreaterThan(0.9)
  })

  // Only the library copy row names another version; duplicate groups and triage compare
  // pairs too, and must not pay for the wider search or the length probes it needs.
  it('runs the wider search only when asked for it', async () => {
    expect((await comparePair(base, headed))?.versionCorrelation).toBeUndefined()
  })

  // The wider search is bounded to the size of the probe's own FFT so it never holds the main
  // process; a gap past that reach is not searched and nothing is claimed.
  it('searches no further than its bounded reach', async () => {
    expect((await comparePair(base, farHead, true))?.versionCorrelation).toBeUndefined()
  })

  it('finds no match for a different recording of another length', async () => {
    const p = await comparePair(base, otherShort, true)
    expect(p).not.toBeNull()
    expect(p?.versionCorrelation).toBeLessThan(0.5)
  })

  // Copies of one length need no wider search: another version is never claimed for them.
  it('searches no further for copies of the same length', async () => {
    expect((await comparePair(base, limited, true))?.versionCorrelation).toBeUndefined()
  })
})
