import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

let traktorCueOffsetMs = 0
vi.mock('./settings', () => ({
  getSettings: () => ({ traktorNmlPath: '', traktorCueOffsetMs }),
}))

import type {
  ConversionQuality,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
} from '../shared/types'
import { convertAudio } from './ffmpeg'
import { readCueTree } from './tags'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-keep-audio-'))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const meta: TrackMetadata = {
  title: 'New Title',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '128',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

// The settings that rewrite a same-format file: Corrected caps a 32-bit float file at the
// 24 bits CDJs load, and a pinned rate resamples a 48 kHz one.
const pins: Partial<ConversionQuality> = { bitDepth: 'corrected', sampleRate: '44100' }

let n = 0
function copyOf(ext: string, codecArgs: string[]): string {
  const path = join(dir, `copy${n++}${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-ar',
    '48000',
    ...codecArgs,
    path,
  ])
  return path
}

const floatCopy = () => copyOf('.wav', ['-c:a', 'pcm_f32le'])

function streamOf(file: string): { codec: string; rate: number } {
  const s = JSON.parse(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_rate',
      '-of',
      'json',
      file,
    ]).toString(),
  ).streams[0]
  return { codec: s.codec_name, rate: Number(s.sample_rate) }
}

// The decoded samples, so a tag rewrite that moves bytes around still compares equal
// while any change to the audio itself does not.
function audioHash(file: string): string {
  return execFileSync(FF, ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-']).toString()
}

function retag(
  file: string,
  quality: Partial<ConversionQuality>,
  keepAudio: boolean,
  opts: { format?: OutputFormat; normalize?: NormalizeConfig; onTmp?: (p: string) => void } = {},
) {
  return convertAudio(
    file,
    file,
    opts.format ?? 'wav',
    meta,
    undefined,
    opts.normalize,
    undefined,
    quality,
    undefined,
    opts.onTmp,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    keepAudio,
  )
}

// Update on a library copy promises its audio stays: the DJ programs' cues, grids and
// analysis were made on those samples, so the quality pins must not reach them.
describe('convertAudio keeping the audio of a library copy', () => {
  it('rewrites a 32-bit float copy the pins would change, so the pins do reach a plain export', async () => {
    const file = floatCopy()
    await retag(file, pins, false)

    expect(streamOf(file)).not.toEqual({ codec: 'pcm_f32le', rate: 48000 })
  })

  it('stream-copies a 32-bit float 48 kHz copy whatever the pins say', async () => {
    const file = floatCopy()
    const { written } = await retag(file, pins, true)

    expect(streamOf(file)).toEqual({ codec: 'pcm_f32le', rate: 48000 })
    expect(written.plan.codec).toBe('copy')
  })

  it.each([
    ['FLAC', '.flac', 'flac', ['-c:a', 'flac', '-sample_fmt', 's32']],
    ['AIFF', '.aiff', 'aiff', ['-c:a', 'pcm_s32be']],
    ['AIF', '.aif', 'aiff', ['-c:a', 'pcm_s32be']],
    ['MP3', '.mp3', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
    ['ALAC', '.m4a', 'alac', ['-c:a', 'alac', '-sample_fmt', 's32p']],
    ['AAC', '.m4a', 'alac', ['-c:a', 'aac', '-b:a', '192k']],
  ] as const)(
    'keeps the samples of a %s copy whatever the pins say',
    async (_, ext, format, args) => {
      const file = copyOf(ext, [...args])
      const before = audioHash(file)
      const { written } = await retag(file, pins, true, { format })

      expect(written.plan.codec).toBe('copy')
      expect(audioHash(file)).toBe(before)
      expect(streamOf(file).rate).toBe(48000)
    },
  )

  // A DJ program holds the .aif by that name: the temp it is rendered into still has to be
  // unique per call and hidden, and its ID3 tag the v2.3 mp3tag and the players read.
  it('retags an .aif copy through its own unique temp and pins its tag to ID3 v2.3', async () => {
    const file = copyOf('.aif', ['-c:a', 'pcm_s16be'])
    const temps: string[] = []
    await retag(file, {}, true, { format: 'aiff', onTmp: (p) => temps.push(p) })

    expect(basename(temps[0])).toMatch(/^\.copy\d+\.tmp-[0-9a-f]{8}\.aif$/)
    expect(readdirSync(dir).filter((f) => f.startsWith(`.${basename(file, '.aif')}`))).toEqual([])
    const bytes = readFileSync(file)
    const chunk = bytes.indexOf(Buffer.from('ID3 ', 'latin1'))
    expect(bytes.subarray(chunk + 8, chunk + 11).toString('latin1')).toBe('ID3')
    expect(bytes[chunk + 11]).toBe(3)
  })

  // The DJ's own cue offset moves cues when audio goes through Surco. A retag of the copy
  // the program already plays moves no audio, and applied to the file's own cues it would
  // shift them again on every Update.
  it("leaves an MP3 copy's Traktor cues where they are under the DJ's cue offset", async () => {
    const file = copyOf('.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k'])
    writeFileSync(
      file,
      Buffer.concat([
        id3WithCue(buildTraktorTree([traktorCue('C', 0, 1000, 1)])),
        readFileSync(file),
      ]),
    )
    traktorCueOffsetMs = -51
    try {
      await retag(file, {}, true, { format: 'mp3' })
    } finally {
      traktorCueOffsetMs = 0
    }

    expect(readTraktorCueStart(readCueTree(file) as Uint8Array, 0)).toBeCloseTo(1000, 0)
  })

  it('fails and leaves the copy as it was rather than re-encode it', async () => {
    const file = floatCopy()
    const before = createHash('sha1').update(readFileSync(file)).digest('hex')
    await expect(
      retag(file, {}, true, {
        normalize: { mode: 'peak', targetLufs: -9, truePeakDb: -1, peakDb: -1 },
      }),
    ).rejects.toThrow('libraryCopyAudioWouldChange')

    expect(createHash('sha1').update(readFileSync(file)).digest('hex')).toBe(before)
  })
})

function id3WithCue(tree: Uint8Array): Buffer {
  const owner = Buffer.from('TRAKTOR4\0', 'latin1')
  const body = Buffer.concat([owner, Buffer.from(tree)])
  const head = Buffer.alloc(10)
  head.write('PRIV', 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  const frames = Buffer.concat([head, body])
  const tag = Buffer.alloc(10)
  tag.write('ID3', 0, 'latin1')
  tag[3] = 3
  const size = frames.length
  tag[6] = (size >> 21) & 0x7f
  tag[7] = (size >> 14) & 0x7f
  tag[8] = (size >> 7) & 0x7f
  tag[9] = size & 0x7f
  return Buffer.concat([tag, frames])
}
