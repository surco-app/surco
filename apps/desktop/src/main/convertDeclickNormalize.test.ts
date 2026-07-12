import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, describe, expect, it, vi } from 'vitest'

// The declick × normalize matrix exercises the measurement cache (the gain must be
// sized on the declick-prefiltered measurement, and modes must not share entries),
// so point Electron at a throwaway userData and run the real disk round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-declick-norm-cache-'))
  return { app: { isPackaged: false, getPath: () => dir } }
})

import { app } from 'electron'
import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-declick-norm-'))
afterAll(() => {
  rmSync(app.getPath('userData'), { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

const meta: TrackMetadata = {
  title: 'Crackle',
  artist: 'Dust',
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

// A clicky lavfi source: `expr` per channel (pipe-separated for stereo), with a
// ~2-sample near-full-scale impulse train riding the first channel.
function makeSource(name: string, expr: string, seconds = 6): string {
  const path = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${expr}:s=44100:d=${seconds}`,
    '-c:a',
    'pcm_s16le',
    path,
  ])
  return path
}

const CLICKS = 'if(lt(mod(t\\,0.5)\\,0.00004)\\,0.9\\,0)'

function decode(file: string): Float32Array {
  const raw = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'f32le', '-'], {
    maxBuffer: 1024 * 1024 * 64,
  })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
}

function peakOf(file: string): number {
  const s = decode(file)
  let max = 0
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i])
    if (a > max) max = a
  }
  return max
}

// Per-channel mean (DC) and max-abs of an interleaved stereo decode.
function channelStats(file: string): { dc: number; max: number }[] {
  const s = decode(file)
  const out = [
    { sum: 0, max: 0, n: 0 },
    { sum: 0, max: 0, n: 0 },
  ]
  for (let i = 0; i < s.length; i++) {
    const c = out[i % 2]
    c.sum += s[i]
    c.n++
    const a = Math.abs(s[i])
    if (a > c.max) c.max = a
  }
  return out.map((c) => ({ dc: c.sum / c.n, max: c.max }))
}

// Integrated loudness via ffmpeg's own EBU R128 meter (it reports on stderr, which
// execFileSync doesn't return — spawnSync does).
function loudnessOf(file: string): number {
  const run = spawnSync(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'])
  // The meter logs a progressive I: per frame before the summary — the last one is
  // the integrated figure.
  const all = [...run.stderr.toString().matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)]
  return Number(all.at(-1)?.[1])
}

// The share of samples living near full scale — the signature that tells a boosted
// sine (lots of them) from a lone surviving click (a handful), where a bare peak
// reading can't: both sit at the same -1 dBFS after a peak normalize.
function loudShare(file: string): number {
  const s = decode(file)
  let loud = 0
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > 0.5) loud++
  return loud / s.length
}

function probeOut(file: string): { rate: number; fmt: string } {
  const out = execFileSync(PROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,sample_fmt',
    '-of',
    'json',
    file,
  ]).toString()
  const s = JSON.parse(out).streams[0]
  return { rate: Number(s.sample_rate), fmt: s.sample_fmt }
}

// The full declick × normalize matrix through the real convertAudio and the bundled
// ffmpeg: each case pins one interaction that unit tests can't see — filter order,
// prefiltered measurements, the 192 kHz loudnorm round-trip, per-mode cache entries.
describe('convertAudio declick × normalize', () => {
  it('loudness (linear) with declick lands on target, clicks gone, format preserved', async () => {
    const src = makeSource('linear.wav', `0.25*sin(2*PI*440*t)+${CLICKS}|0.25*sin(2*PI*440*t)`)
    const out = join(dir, 'linear-out.wav')
    await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'standard',
    )
    // Clicks repaired, then the linear gain: the 0.9 impulses would have survived
    // as ~0.9×gain — anything near that means the chain ran out of order.
    expect(loudnessOf(out)).toBeCloseTo(-14, 0)
    expect(peakOf(out)).toBeLessThan(0.5)
    // loudnorm emits 192 kHz internally; the aresample must restore the source rate,
    // and the 16-bit source must stay 16-bit (dithered), not widen to 24.
    expect(probeOut(out)).toEqual({ rate: 44100, fmt: 's16' })
  }, 30000)

  it('loudness (limited) with strong declick caps the peaks and still repairs', async () => {
    const src = makeSource('limited.wav', `0.7*sin(2*PI*440*t)+${CLICKS}|0.7*sin(2*PI*440*t)`)
    const out = join(dir, 'limited-out.wav')
    const result = await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      // A target the measured audio cannot reach linearly (the gain would push the
      // true peak past the ceiling), so the volume+alimiter path runs.
      { mode: 'loudness', targetLufs: -3, truePeakDb: -1, peakDb: -1 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'strong',
    )
    expect(result.declickedSamples).toBeGreaterThan(0)
    // The limiter holds the ceiling (-1 dBFS ≈ 0.891) while the gain pushes toward
    // the target. A full-scale sine is the limiter's worst case — no crest factor,
    // so it rides the ceiling all cycle and gives back ~2 LU (real music only has
    // its peaks touched) — hence the tolerance below the -3 target.
    expect(peakOf(out)).toBeLessThanOrEqual(0.9)
    expect(loudnessOf(out)).toBeGreaterThan(-5.5)
  }, 30000)

  it('Audacity-style peak (DC removal, per channel) measures through the repair', async () => {
    // Channel 0: DC-biased quiet sine carrying the clicks; channel 1: louder clean
    // sine. Per-channel gains must come from astats of the REPAIRED audio — the
    // click would otherwise anchor channel 0's extent and leave it several dB short.
    const src = makeSource(
      'channels.wav',
      `0.1+0.3*sin(2*PI*440*t)+${CLICKS}|0.6*sin(2*PI*554*t)`,
    )
    const out = join(dir, 'channels-out.wav')
    await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      {
        mode: 'peak',
        targetLufs: -14,
        truePeakDb: -1,
        peakDb: -1,
        peakRemoveDc: true,
        peakPerChannel: true,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'standard',
    )
    const [left, right] = channelStats(out)
    // Each channel lands its own peak on -1 dBFS (0.891), centered on zero — and
    // nothing overshoots it, which is also the proof the clicks were repaired
    // before the ~3× channel-0 gain (an unrepaired 0.9 impulse would sit at 1.0).
    expect(Math.abs(left.dc)).toBeLessThan(0.02)
    expect(left.max).toBeGreaterThan(0.8)
    expect(left.max).toBeLessThanOrEqual(0.92)
    expect(right.max).toBeGreaterThan(0.8)
    expect(right.max).toBeLessThanOrEqual(0.92)
  }, 30000)

  it('keeps per-mode measurement cache entries apart for the same file', async () => {
    const src = makeSource('cache.wav', `0.25*sin(2*PI*440*t)+${CLICKS}`)
    const peak = { mode: 'peak' as const, targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    const noDeclick = join(dir, 'cache-off.wav')
    const declicked = join(dir, 'cache-std.wav')
    const declickedAgain = join(dir, 'cache-std-2.wav')
    // Declick off first, so its click-anchored measurement lands in the cache…
    await convertAudio(src, noDeclick, 'wav', meta, undefined, peak)
    // …then declick on: its gain must come from its own (repaired) measurement, and
    // a repeat run must read the same entry back — three ways a shared namespace
    // would corrupt the result.
    for (const out of [declicked, declickedAgain]) {
      await convertAudio(
        src,
        out,
        'wav',
        meta,
        undefined,
        peak,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'standard',
      )
    }
    // Click-anchored: gain ≈ −1 dB, the sine stays near 0.22 and only the surviving
    // clicks sit near the ceiling. Repaired: the sine itself rides at ~0.89, so a
    // large share of samples lives up there. A shared cache entry would collapse
    // the two onto one gain.
    expect(loudShare(noDeclick)).toBeLessThan(0.001)
    expect(loudShare(declicked)).toBeGreaterThan(0.1)
    expect(loudShare(declickedAgain)).toBeCloseTo(loudShare(declicked), 3)
  }, 60000)
})
