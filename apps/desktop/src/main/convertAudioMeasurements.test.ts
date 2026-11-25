import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2CommentsFrame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { NormalizeConfig, OutputFormat, TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-measurements-'))
let n = 0

const MEASUREMENTS = [
  'iTunNORM',
  'iTunSMPB',
  'REPLAYGAIN_TRACK_GAIN',
  'REPLAYGAIN_TRACK_PEAK',
  'replaygain_album_gain',
  'REPLAYGAIN_ALBUM_PEAK',
  'R128_TRACK_GAIN',
  'MP3GAIN_MINMAX',
  'MP3GAIN_UNDO',
]
const OTHERS = ['iTunPGAP', 'VINYL_SIDE']
const ALL = [...MEASUREMENTS, ...OTHERS]

type Source = 'mp3' | 'aiff' | 'wav' | 'flac' | 'm4a'

// iTunes keeps Sound Check and the gapless counts in COMM frames on an MP3; ReplayGain and
// MP3Gain scanners write TXXX. ffmpeg reads both under the same name.
function tagged(ext: Source, itunesComments = false): string {
  if (ext === 'm4a') {
    const path = join(dir, `src${n++}.m4a`)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=d=2',
      '-c:a',
      'aac',
      path,
    ])
    const f = TagFile.createFromPath(path)
    for (const name of ALL)
      (f.tag as Mpeg4AppleTag).setItunesStrings('com.apple.iTunes', name, `${name} value`)
    f.save()
    f.dispose()
    return path
  }
  const path = encodeSine(dir, `src${n++}`, ext)
  const f = TagFile.createFromPath(path)
  if (ext === 'flac') {
    const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
    for (const name of ALL) xiph.setFieldAsStrings(name, `${name} value`)
  } else {
    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    id3.version = 3
    for (const name of ALL) {
      if (itunesComments && name.startsWith('iTun')) {
        const comm = Id3v2CommentsFrame.fromDescription(name, 'eng')
        comm.text = `${name} value`
        id3.addFrame(comm)
      } else {
        const txxx = Id3v2UserTextInformationFrame.fromDescription(name)
        txxx.text = [`${name} value`]
        id3.addFrame(txxx)
      }
    }
  }
  f.save()
  f.dispose()
  return path
}

function tagsOf(path: string): string[] {
  return String(execFileSync(FF, ['-loglevel', 'error', '-i', path, '-f', 'ffmetadata', '-']))
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).toLowerCase())
}

const PEAK: NormalizeConfig = { mode: 'peak', targetLufs: -14, peakDb: -1, truePeakDb: -1 }

async function convert(src: string, target: OutputFormat, normalize?: NormalizeConfig) {
  const out = join(dir, `out${n++}.${target === 'alac' ? 'm4a' : target}`)
  const meta: TrackMetadata = {
    ...emptyMetadata(),
    ...(await readMeta(src)).tags,
    title: 'New title',
  }
  await convertAudio(src, out, target, meta, undefined, normalize)
  return tagsOf(out)
}

const lower = (names: string[]) => names.map((name) => name.toLowerCase())

// Sound Check, ReplayGain, R128 and MP3Gain measured the loudness and peaks of the audio
// they came with, and iTunSMPB counts that stream's encoder priming and padding: carried
// onto audio Surco re-encoded, normalized or changed, a player turned the new file up or
// down by the old file's figures and cut its start and end by the old encoder's counts.
describe('a conversion that changes the audio', () => {
  it.each([
    ['mp3', 'wav'],
    ['mp3', 'aiff'],
    ['mp3', 'flac'],
    ['mp3', 'alac'],
    ['wav', 'mp3'],
    ['aiff', 'mp3'],
    ['flac', 'mp3'],
    ['m4a', 'mp3'],
    ['m4a', 'flac'],
  ] as [Source, OutputFormat][])('drops the old measurements from %s to %s', async (from, to) => {
    const tags = await convert(tagged(from, true), to)
    expect(tags.filter((name) => lower(MEASUREMENTS).includes(name))).toEqual([])
    for (const name of lower(OTHERS)) expect(tags, name).toContain(name)
  })

  it.each([
    ['mp3', 'mp3'],
    ['wav', 'wav'],
    ['aiff', 'aiff'],
    ['flac', 'flac'],
    ['wav', 'alac'],
  ] as [Source, OutputFormat][])('drops them normalizing %s to %s', async (from, to) => {
    const tags = await convert(tagged(from), to, PEAK)
    expect(tags.filter((name) => lower(MEASUREMENTS).includes(name))).toEqual([])
    for (const name of lower(OTHERS)) expect(tags, name).toContain(name)
  })
})

// The same samples come out, so the figures still describe them.
describe('a conversion that keeps the samples', () => {
  it.each([
    ['mp3', 'mp3'],
    ['wav', 'wav'],
    ['flac', 'flac'],
    ['m4a', 'alac'],
    ['wav', 'flac'],
    ['aiff', 'wav'],
    ['flac', 'aiff'],
  ] as [Source, OutputFormat][])('keeps them from %s to %s', async (from, to) => {
    const tags = await convert(tagged(from), to)
    for (const name of lower(ALL)) expect(tags, name).toContain(name)
  })
})
