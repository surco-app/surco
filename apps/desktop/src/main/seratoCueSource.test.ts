import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Tag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import { HOT_KINDS } from '../shared/cueRules'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { SERATO_MP3 } from '../shared/seratoMarkersFixture'
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

  it('offers no beat grid, since Serato keeps its own and Surco reads none in this phase', async () => {
    const read = await source().trackCues(`serato:${withMarkers(mp3())}`)
    expect(read?.analysed).toBe(false)
    expect(read?.grid).toEqual([])
    expect(read?.durationMs).toBeGreaterThan(1900)
    expect(read?.durationMs).toBeLessThan(2200)
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
