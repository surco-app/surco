import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { analyzeBitsUsage } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-bits-'))
const src16 = join(dir, 'src16.flac')
const padded24 = join(dir, 'padded24.flac')
const true24 = join(dir, 'true24.flac')
const lossy = join(dir, 'lossy.mp3')
const silent24 = join(dir, 'silent24.flac')
// 16-bit audio padded to 24 with a short stretch that DOES use the low byte — the
// shape a real fade-out computed at a wider depth leaves behind (a user's album had
// two such tracks, at 0.0158% and 0.5021% over the whole track). It lands just above
// the padded threshold, the one band the other fixtures leave untested.
const mostlyPadded24 = join(dir, 'mostly-padded24.flac')

beforeAll(() => {
  // A 16-bit source, the same audio padded into a 24-bit FLAC (zero low bits by
  // construction), genuinely 24-bit noise (a float source fills every bit), and
  // an MP3 (no bit depth at all).
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'flac',
    '-sample_fmt',
    's16',
    src16,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-i',
    src16,
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    padded24,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=3:a=0.3',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    true24,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'libmp3lame',
    lossy,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=d=70',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    silent24,
  ])
  // 30s of padded 16-bit plus 0.2s of genuine 24-bit noise: a low single-digit
  // share of the scan's samples use the low byte, above the padded threshold and
  // far below full — the shape a fade computed at a wider depth leaves behind.
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=30:sample_rate=44100',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=0.2:a=0.3:r=44100',
    '-filter_complex',
    '[0:a]aformat=sample_fmts=s16,aformat=sample_fmts=s32,pan=stereo|c0=c0|c1=c0[a];[1:a]aformat=sample_fmts=s32,pan=stereo|c0=c0|c1=c0[b];[a][b]concat=n=2:v=0:a=1',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    mostlyPadded24,
  ])
}, 60000)

describe('analyzeBitsUsage', () => {
  it('proves 16-bit audio padded into a 24-bit container: every low byte is zero', async () => {
    const res = await analyzeBitsUsage(padded24)
    expect(res?.usage).toBe('padded16')
    expect(res?.lowBytePct).toBe(0)
  }, 30000)

  // The band between the two verdicts, which no other fixture covers and which a
  // real library does reach (a 24-bit WAV carrying gain-shifted 16-bit audio measured
  // 7.0%). A file whose low byte is used a little is not proven padding: converting
  // it to 16-bit would drop samples that carry signal, so it has to answer unknown
  // rather than earn the badge.
  it('refuses to call a file padded when its low byte is used at all', async () => {
    const res = await analyzeBitsUsage(mostlyPadded24)
    expect(res?.usage).toBe('unknown')
    expect(res?.lowBytePct).toBeGreaterThan(0.05)
    expect(res?.lowBytePct).toBeLessThan(50)
  }, 30000)

  it('confirms genuine 24-bit content: the low byte carries signal almost everywhere', async () => {
    const res = await analyzeBitsUsage(true24)
    expect(res?.usage).toBe('full')
    expect(res?.lowBytePct).toBeGreaterThan(50)
  }, 30000)

  // An eligible file the probe cannot judge must SAY so: silence is what made
  // the pre-0.92 resolution verdict indistinguishable from "never analysed",
  // and a user asked exactly this question about the bits line's absence.
  it('answers unknown, out loud, for a 24-bit file whose scan is all silence', async () => {
    const res = await analyzeBitsUsage(silent24)
    expect(res?.usage).toBe('unknown')
  }, 30000)

  it('makes no claim about files that declare 16 bits', async () => {
    expect(await analyzeBitsUsage(src16)).toBeNull()
  }, 30000)

  it('makes no claim about lossy files, which have no bit depth at all', async () => {
    expect(await analyzeBitsUsage(lossy)).toBeNull()
  }, 30000)
})
