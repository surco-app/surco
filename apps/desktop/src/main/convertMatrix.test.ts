import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { resolveJobFormat } from '../shared/format'
import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-convert-matrix-'))

const wav = join(dir, 'in.wav')
const flac = join(dir, 'in.flac')

const meta = (title: string): TrackMetadata => ({
  title,
  artist: 'ATB',
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
})

function probe(file: string): { formatName: string; codec: string; duration: number } {
  const out = execFileSync(PROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'format=format_name,duration',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'json',
    file,
  ]).toString()
  const json = JSON.parse(out)
  return {
    formatName: json.format.format_name,
    codec: json.streams[0].codec_name,
    duration: Number(json.format.duration),
  }
}

// ffprobe never sees TXXX/title tags on a WAV (repo-known limitation), so metadata is
// verified through TagLib's generic tag instead, matching writeTags's own reader.
function titleOf(file: string): string {
  const f = TagFile.createFromPath(file)
  try {
    return f.tag.title ?? ''
  } finally {
    f.dispose()
  }
}

// Integrated loudness via ffmpeg's own EBU R128 meter (it reports on stderr, which
// execFileSync doesn't return — spawnSync does). Mirrors convertDeclickNormalize.test.ts.
function loudnessOf(file: string): number {
  const run = spawnSync(FF, [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'ebur128',
    '-f',
    'null',
    '-',
  ])
  const all = [...run.stderr.toString().matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)]
  return Number(all.at(-1)?.[1])
}

beforeAll(() => {
  // Short (4s) tones so the ffmpeg round-trips below stay fast — plenty to tell a
  // trimmed/declicked/normalized duration or loudness from an untouched one.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4',
    '-c:a',
    'pcm_s16le',
    wav,
  ])
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', flac])
})

// "Same as source" resolves to a real encode (never the stream-copy shortcut) whenever
// a filter forces it — planConversion is told to skip copy when normalize/declick/trim
// is active. These three cases are the ones the audit flagged as missing real-ffmpeg
// coverage; the plain-copy and multi-format cases already live in
// convertSameAsSource.test.ts.
describe('convertAudio with "Same as source" under a filter', () => {
  it('trim on a .wav re-encodes: duration changes and the format stays wav', async () => {
    const format = resolveJobFormat('source', wav, 'aiff')
    expect(format).toBe('wav')
    const out = join(dir, 'trim-out.wav')
    const before = probe(wav)
    await convertAudio(
      wav,
      out,
      format,
      meta('Trimmed'),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 1, endSec: 3 },
    )
    expect(extname(out)).toBe('.wav')
    const after = probe(out)
    // 4 s in, 2 s out — a stream copy would have kept the full 4 s.
    expect(after.duration).toBeGreaterThan(1.9)
    expect(after.duration).toBeLessThan(2.1)
    expect(after.duration).toBeLessThan(before.duration - 1)
  }, 30000)

  it('declick on a .flac re-encodes and keeps the flac format', async () => {
    const format = resolveJobFormat('source', flac, 'aiff')
    expect(format).toBe('flac')
    const out = join(dir, 'declick-out.flac')
    const result = await convertAudio(
      flac,
      out,
      format,
      meta('Declicked'),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'standard',
    )
    expect(extname(out)).toBe('.flac')
    expect(probe(out).codec).toBe('flac')
    // adeclick ran over the real audio (a plain sine has nothing to repair, but the
    // filter still executes, which is what proves the copy shortcut was skipped —
    // a stream copy never reports a declick pass at all).
    expect(result.declickedSamples).toBeDefined()
  }, 30000)

  it('loudness normalize on a .wav re-encodes toward the target and keeps the wav format', async () => {
    const format = resolveJobFormat('source', wav, 'aiff')
    const out = join(dir, 'loudness-out.wav')
    const before = loudnessOf(wav)
    const result = await convertAudio(wav, out, format, meta('Louder'), undefined, {
      mode: 'loudness',
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
    })
    expect(extname(out)).toBe('.wav')
    expect(result.normalizeSkipped).toBe(false)
    expect(loudnessOf(out)).toBeCloseTo(-14, 0)
    // The source tone measures well off -14 LUFS, so the gain must have moved it —
    // a stream copy would report the source's own, unmoved loudness.
    expect(Math.abs(before - -14)).toBeGreaterThan(1)
  }, 30000)
})

// Beside-the-original with a matching format never touches the input (processTrack.ts's
// besideOriginal branch always targets dirname(input)), and for mp3/aiff (see
// preservesCuesInPlace) that target is written by copyFile, not an ffmpeg remux — a real
// byte-for-byte duplicate of the original plus a fresh tag pass. This exercises that exact
// path end to end, the one real-file case the matrix calls out for "beside".
describe('convertAudio beside the original, matching format', () => {
  it('produces a byte-identical copy of the source with fresh tags for a matching mp3', async () => {
    const mp3 = join(dir, 'beside-in.mp3')
    execFileSync(FF, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      mp3,
    ])
    // Mirrors uniqueOutputPath's "(2)" naming beside the original file.
    const out = join(dir, 'beside-in (2).mp3')
    await convertAudio(mp3, out, 'mp3', meta('Copied'))

    const before = probe(mp3)
    const after = probe(out)
    expect(after.codec).toBe(before.codec)
    expect(after.duration).toBeCloseTo(before.duration, 1)
    // The stream-copy shortcut for a same-format mp3 is copyFile (see
    // preservesCuesInPlace), so the audio payload is a verbatim byte duplicate —
    // only the tag block written after the copy can differ in size.
    expect(statSync(out).size).toBeGreaterThanOrEqual(statSync(mp3).size)
    expect(titleOf(out)).toBe('Copied')
  }, 30000)
})
