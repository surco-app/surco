import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
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
const dir = mkdtempSync(join(tmpdir(), 'surco-same-as-source-'))

const wav = join(dir, 'in.wav')
const flac = join(dir, 'in.flac')
const mp3 = join(dir, 'in.mp3')

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
// verified through TagLib's generic tag instead, which is what writeTags itself uses —
// the same reader convertCues.test.ts and tags.test.ts already rely on.
function titleOf(file: string): string {
  const f = TagFile.createFromPath(file)
  try {
    return f.tag.title ?? ''
  } finally {
    f.dispose()
  }
}

beforeAll(() => {
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav])
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', flac])
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', mp3])
})

// "Same as source" resolves per file via resolveJobFormat, exactly like
// runProcessTrack does when settings.outputFormat is 'source' — this exercises the
// same real ffmpeg pipeline runProcessTrack hands off to.
describe('convertAudio with "Same as source" on a mixed batch', () => {
  it('keeps each format and codec untouched and writes fresh metadata, with filters off', async () => {
    const before = {
      wav: probe(wav),
      flac: probe(flac),
      mp3: probe(mp3),
    }

    const outputs = await Promise.all(
      [wav, flac, mp3].map(async (input) => {
        const format = resolveJobFormat('source', input, 'aiff')
        const out = join(dir, `same-${format}${extname(input)}`)
        await convertAudio(input, out, format, meta(`Tagged ${format}`))
        return { input, out, format }
      }),
    )

    for (const { input, out, format } of outputs) {
      // Every file resolves to its own format — a mixed batch never collapses to one.
      expect(extname(out)).toBe(extname(input))

      const after = probe(out)
      const originalProbe = before[format as 'wav' | 'flac' | 'mp3']
      expect(after.codec).toBe(originalProbe.codec)
      expect(after.duration).toBeCloseTo(originalProbe.duration, 1)

      expect(titleOf(out)).toBe(`Tagged ${format}`)
    }
  }, 30000)

  it('still recodes under normalize, but each file keeps its own original format', async () => {
    const normalize = {
      mode: 'peak' as const,
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
    }

    const outputs = await Promise.all(
      [wav, flac, mp3].map(async (input) => {
        const format = resolveJobFormat('source', input, 'aiff')
        const out = join(dir, `normalized-${format}${extname(input)}`)
        const result = await convertAudio(
          input,
          out,
          format,
          meta(`Normalized ${format}`),
          undefined,
          normalize,
        )
        return { input, out, format, result }
      }),
    )

    for (const { input, out, result } of outputs) {
      // Each file still lands on its own original format under normalize...
      expect(extname(out)).toBe(extname(input))
      // ...but this time the gain filter actually ran (a real recode, not the
      // stream-copy shortcut "same as source" uses with filters off).
      expect(result.normalizeSkipped).toBe(false)
    }
  }, 30000)
})
