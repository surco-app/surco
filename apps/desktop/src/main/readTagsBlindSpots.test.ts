import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { readTags } from './ffmpeg'
import { readTagLibExtras } from './tags'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-readtags-blind-'))

// Tagged the way a TagLib-based tagger (mp3tag, Surco's own writeTags) leaves a file.
function tagged(ext: string, codec: string[]): string {
  const file = join(dir, `t.${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...codec,
    file,
  ])
  const f = TagFile.createFromPath(file)
  try {
    f.tag.title = 'Rave Till My Grave'
    f.tag.performers = ['Ashbreaker']
    f.tag.album = 'MQDRFREE015'
    f.tag.year = 2026
    f.tag.genres = ['HARDSTYLE']
    f.tag.comment = 'A2S B1S'
    f.tag.publisher = 'MQD Records'
    f.tag.beatsPerMinute = 150
    f.tag.initialKey = '11A'
    f.tag.grouping = 'Peak'
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

let aiff: string
let wav: string
let m4a: string
let flac: string

beforeAll(() => {
  aiff = tagged('aiff', ['-c:a', 'pcm_s16be'])
  wav = tagged('wav', ['-c:a', 'pcm_s16le'])
  m4a = tagged('m4a', ['-c:a', 'alac'])
  flac = tagged('flac', ['-c:a', 'flac'])
})

// Every field the probe cannot see is a field an update then erases: readTags feeds the
// editor, the editor's values are what the conversion writes, and a managed field written
// empty clears whatever the file had. Measured on the matrix behind convertUpdateContract
// (17/09/2026): an AIFF update lost its grouping and label, a WAV its artist and album,
// an M4A its BPM — all present on disk, all invisible to ffprobe.
describe('readTags on what ffprobe does not surface', () => {
  it('reads the grouping and label an AIFF keeps in TIT1 and TPUB', async () => {
    const tags = await readTags(aiff)
    expect(tags.grouping).toBe('Peak')
    expect(tags.publisher).toBe('MQD Records')
  })

  // TagLib's INFO chunk spells the album DIRC and the artist ISTR; ffmpeg reads IPRD and
  // IART. The same values sit in the ID3 chunk next to it.
  it('reads the artist and album of a WAV whose INFO chunk uses TagLib spellings', async () => {
    const tags = await readTags(wav)
    expect(tags.artist).toBe('Ashbreaker')
    expect(tags.album).toBe('MQDRFREE015')
  })

  it('reads the BPM an M4A keeps in tmpo', async () => {
    const tags = await readTags(m4a)
    expect(tags.bpm).toBe('150')
  })

  it('reads the BPM a FLAC keeps under TEMPO', async () => {
    const tags = await readTags(flac)
    expect(tags.bpm).toBe('150')
  })
})

// The whole mapping, field by field, on the container where ffprobe sees least. Mutation
// testing (17/09/2026) showed every line of it could be broken without a test noticing:
// the four-field check above only pinned the fields a user had reported losing.
describe('readTagLibExtras', () => {
  it('reads every core field and every TXXX extra a WAV keeps in its id3 chunk', () => {
    const file = join(dir, 'full.wav')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'pcm_s16le',
      file,
    ])
    const f = TagFile.createFromPath(file)
    try {
      f.tag.title = 'Rave Till My Grave'
      f.tag.performers = ['Ashbreaker', 'Guest']
      f.tag.album = 'MQDRFREE015'
      f.tag.albumArtists = ['Various']
      f.tag.year = 2026
      f.tag.genres = ['Hardstyle', 'Rawstyle']
      f.tag.grouping = 'Peak'
      f.tag.comment = 'A2S B1S'
      f.tag.track = 3
      f.tag.disc = 2
      f.tag.beatsPerMinute = 150
      f.tag.initialKey = '11A'
      f.tag.publisher = 'MQD Records'
      f.tag.remixedBy = 'Ashbreaker'
      f.tag.subtitle = 'Unofficial Edit'
      f.tag.composers = ['A. Writer', 'B. Writer']
      f.tag.isrc = 'ESA012600001'
      f.tag.conductor = 'B. Conductor'
      const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      for (const [id, value] of [
        [Id3v2FrameIdentifiers.TOPE, 'The Original Band'],
        [Id3v2FrameIdentifiers.TEXT, 'A. Lyricist'],
      ] as const) {
        const frame = Id3v2TextInformationFrame.fromIdentifier(id)
        frame.text = [value]
        id3.addFrame(frame)
      }
      for (const [desc, value] of [
        ['CATALOGNUMBER', 'MQDRFREE015'],
        ['DISCOGS_RELEASE_ID', '12345'],
        ['ENERGYLEVEL', '8'],
        ['STYLE', 'Rawstyle'],
        ['COUNTRY', 'Spain'],
        ['MEDIATYPE', 'File'],
        ['MOOD', 'Dark'],
      ]) {
        const frame = Id3v2UserTextInformationFrame.fromDescription(desc)
        frame.text = [value]
        id3.addFrame(frame)
      }
      f.save()
    } finally {
      f.dispose()
    }

    expect(readTagLibExtras(file)).toEqual({
      title: 'Rave Till My Grave',
      artist: 'Ashbreaker, Guest',
      album: 'MQDRFREE015',
      albumArtist: 'Various',
      year: '2026',
      genre: 'Hardstyle, Rawstyle',
      grouping: 'Peak',
      comment: 'A2S B1S',
      trackNumber: '3',
      discNumber: '2',
      bpm: '150',
      key: '11A',
      publisher: 'MQD Records',
      remixArtist: 'Ashbreaker',
      mixName: 'Unofficial Edit',
      composer: 'A. Writer, B. Writer',
      isrc: 'ESA012600001',
      originalArtist: 'The Original Band',
      lyricist: 'A. Lyricist',
      conductor: 'B. Conductor',
      trackTotal: '',
      discTotal: '',
      copyright: '',
      encodedBy: '',
      catalogNumber: 'MQDRFREE015',
      discogsReleaseId: '12345',
      energy: '8',
      style: 'Rawstyle',
      country: 'Spain',
      mediaType: 'File',
      mood: 'Dark',
    })
  })

  it('reads nothing but empty strings from a file with no tag, never throwing', () => {
    const file = join(dir, 'bare.flac')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'flac',
      file,
    ])
    const extras = readTagLibExtras(file)
    expect(Object.values(extras).every((v) => v === '')).toBe(true)
    expect(extras.catalogNumber).toBeUndefined()
  })
})
