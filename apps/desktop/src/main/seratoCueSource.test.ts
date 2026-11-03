import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Tag,
  type Mpeg4AppleTag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import { HOT_KINDS } from '../shared/cueRules'
import { gridFingerprint } from '../shared/gridEdit'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { SERATO_M4A, SERATO_MP3, SERATO_WAV } from '../shared/seratoMarkersFixture'
import { seratoCueSource } from './seratoCueSource'

function mp3(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-cues-')), 'track.mp3')
  execFileSync(ffmpegStatic as unknown as string, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100',
    '-t',
    '2',
    '-write_xing',
    '0',
    file,
    '-y',
  ])
  return file
}

function withMarkers(file: string): string {
  const f = TagFile.createFromPath(file)
  try {
    const picture = Picture.fromFullData(
      ByteVector.fromByteArray(Buffer.from(SERATO_MP3, 'base64')),
      PictureType.NotAPicture,
      'application/octet-stream',
      'Serato Markers2',
    )
    picture.filename = ''
    const frame = Id3v2AttachmentFrame.fromPicture(picture)
    frame.textEncoding = StringType.Latin1
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(frame)
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

function geob(file: string, description: string, payload: Uint8Array): void {
  const f = TagFile.createFromPath(file)
  try {
    const picture = Picture.fromFullData(
      ByteVector.fromByteArray(payload),
      PictureType.NotAPicture,
      'application/octet-stream',
      description,
    )
    picture.filename = ''
    const frame = Id3v2AttachmentFrame.fromPicture(picture)
    frame.textEncoding = StringType.Latin1
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(frame)
    f.save()
  } finally {
    f.dispose()
  }
}

function tempoMap(firstBeatSeconds: number, bpm: number): Uint8Array {
  const data = Buffer.alloc(40)
  data.writeUInt16BE(0x0200, 0)
  data.writeUInt16BE(1, 2)
  data.writeDoubleBE(firstBeatSeconds, 4)
  data.writeUInt32BE(1, 12)
  data.writeDoubleBE(bpm, 24)
  data.writeUInt32BE(1, 36)
  return data
}

function audio(ext: string, seconds = 4): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-grid-')), `track.${ext}`)
  execFileSync(ffmpegStatic as unknown as string, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100',
    '-t',
    String(seconds),
    file,
    '-y',
  ])
  return file
}

function lameMp3(): string {
  const plain = audio('mp3')
  const frame = Buffer.alloc(417)
  Buffer.from([0xff, 0xfb, 0x90, 0x44]).copy(frame, 0)
  frame.write('Info', 36, 'latin1')
  frame.write('LAME3.100', 44, 'latin1')
  frame[44 + 21] = 576 >> 4
  frame[44 + 22] = (576 & 0x0f) << 4
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-lame-')), 'track.mp3')
  writeFileSync(file, Buffer.concat([frame, readFileSync(plain)]))
  return file
}

const source = (words = vi.fn(async (_file: string) => new Uint16Array([3, 9]))) =>
  seratoCueSource({ words })

describe('seratoCueSource', () => {
  it('shows the eight hot cues Serato saved in the file, on the A to H buttons with their colours', async () => {
    const file = withMarkers(mp3())
    const read = await source().trackCues(`serato:${file}`)
    expect(read?.cues.map((c) => c.kind)).toEqual(HOT_KINDS)
    expect(read?.cues.map((c) => c.ms)).toEqual([
      57606, 71553, 77329, 82467, 88003, 93439, 102387, 109558,
    ])
    expect(read?.cues[0]).toEqual({
      id: '0',
      ms: 57606,
      kind: HOT_KINDS[0],
      color: nearestHotCueColor(0xffcc0000),
      name: 'A',
    })
    expect(read?.contentId).toBe(`serato:${file}`)
  })

  it('reads the loops Serato saved beside the hot cues, with their start and end', async () => {
    const read = await source().trackCues(`serato:${withMarkers(mp3())}`)
    expect(read?.loops?.map((l) => [l.startMs, l.endMs])).toEqual([
      [57612, 71941],
      [64777, 79105],
    ])
  })

  it('offers no beat grid when Serato saved no Tempo Map', async () => {
    const read = await source().trackCues(`serato:${withMarkers(mp3())}`)
    expect(read?.analysed).toBe(false)
    expect(read?.grid).toEqual([])
    expect(read?.durationMs).toBeGreaterThan(1900)
    expect(read?.durationMs).toBeLessThan(2200)
  })

  it('moves cues and loops onto Surco clock on an MP3 with a LAME Info frame, since Serato plays 51.18 ms more', async () => {
    const file = lameMp3()
    const cue = Buffer.from(SERATO_MP3, 'base64')
    geob(file, 'Serato Markers2', cue)
    const read = await source().trackCues(`serato:${file}`)
    expect(read?.cues[0].ms).toBeCloseTo(57606 - 51.18, 1)
    expect(read?.loops?.[0].startMs).toBeCloseTo(57612 - 51.18, 1)
  })

  it('leaves cues where Serato saved them on a WAV, which both programs decode alike', async () => {
    const file = audio('wav')
    geob(file, 'Serato Markers2', Buffer.from(SERATO_WAV, 'base64'))
    const read = await source().trackCues(`serato:${file}`)
    expect(read?.cues.map((c) => c.ms)).toEqual([3834, 9192, 16367])
  })

  it('builds the beat grid from the Tempo Map with the first beat as beat 1 of the bar, in both directions', async () => {
    const file = audio('wav')
    geob(file, 'Serato Tempo Map', tempoMap(1, 120))
    const read = await source().trackCues(`serato:${file}`)
    expect(read?.analysed).toBe(true)
    const grid = read?.grid ?? []
    expect(grid.slice(0, 6).map((b) => b.ms)).toEqual([0, 500, 1000, 1500, 2000, 2500])
    expect(grid.slice(0, 6).map((b) => b.beat)).toEqual([3, 4, 1, 2, 3, 4])
    expect(grid.at(-1)?.ms).toBeLessThanOrEqual(read?.durationMs ?? 0)
    expect((read?.durationMs ?? 0) - (grid.at(-1)?.ms ?? 0)).toBeLessThan(500)
    expect(read?.gridFingerprint).toBe(gridFingerprint(grid))
  })

  it('never starts the grid before zero when the first beat sits a float step off a multiple of the period', async () => {
    const file = audio('wav', 40)
    geob(file, 'Serato Tempo Map', tempoMap(28.28571428571428, 70))
    const read = await source().trackCues(`serato:${file}`)
    expect(Math.min(...(read?.grid ?? []).map((b) => b.ms))).toBeGreaterThanOrEqual(0)
  })

  it('moves M4A cues 1024 samples later onto Surco clock, the opposite way from an MP3', async () => {
    const file = audio('m4a')
    const f = TagFile.createFromPath(file)
    try {
      ;(f.tag as Mpeg4AppleTag).setItunesStrings('com.serato.dj', 'markersv2', SERATO_M4A)
      f.save()
    } finally {
      f.dispose()
    }
    const read = await source().trackCues(`serato:${file}`)
    expect(read?.cues[0].ms).toBeCloseTo(7444 + 23.22, 1)
  })

  it('reads the armored Tempo Map of a FLAC and builds its grid', async () => {
    const file = audio('flac')
    const armored = Buffer.concat([
      Buffer.from('application/octet-stream\0\0Serato Tempo Map\0', 'latin1'),
      tempoMap(1, 120),
    ]).toString('base64')
    const f = TagFile.createFromPath(file)
    try {
      ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings('SERATO_TEMPO_MAP', armored)
      f.save()
    } finally {
      f.dispose()
    }
    const read = await source().trackCues(`serato:${file}`)
    expect(read?.grid.slice(0, 3).map((b) => [b.ms, b.beat])).toEqual([
      [0, 3],
      [500, 4],
      [1000, 1],
    ])
  })

  it('shifts the grid by the same lead as the cues', async () => {
    const file = lameMp3()
    geob(file, 'Serato Tempo Map', tempoMap(1, 120))
    const read = await source().trackCues(`serato:${file}`)
    const first = read?.grid.find((b) => b.beat === 1)
    expect(first?.ms).toBeCloseTo(1000 - 51.18, 1)
  })

  it('opens a file Serato never marked with no cues and no error', async () => {
    const read = await source().trackCues(`serato:${mp3()}`)
    expect(read?.cues).toEqual([])
  })

  it('answers nothing for a file that is gone, without throwing', async () => {
    await expect(
      source().trackCues(`serato:${join(tmpdir(), 'surco-serato-gone', 'gone.mp3')}`),
    ).resolves.toBeNull()
  })

  it('draws the zoomed wave from the audio of the file, like Traktor', async () => {
    const words = vi.fn(async (_file: string) => new Uint16Array([3, 9]))
    expect([...((await source(words).waveDetail('serato:/Music/a.mp3')) ?? [])]).toEqual([3, 9])
    expect(words).toHaveBeenCalledWith('/Music/a.mp3')
  })

  it('has nothing to save to, so a Serato track can never be written', () => {
    const reader = source()
    expect('queue' in reader).toBe(false)
    expect('applyQuietly' in reader).toBe(false)
  })

  it('never changes the file it reads', async () => {
    const file = withMarkers(mp3())
    const before = readFileSync(file)
    await source().trackCues(`serato:${file}`)
    expect(readFileSync(file).equals(before)).toBe(true)
  })
})
