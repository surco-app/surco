import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Frame,
  Id3v2PrivateFrame,
  type Id3v2Tag,
  type Mpeg4AppleTag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { type SeratoCue, seratoPayloadOf, withSeratoCues } from '../shared/seratoMarkers'
import {
  SERATO_AIFF,
  SERATO_FLAC,
  SERATO_M4A,
  SERATO_MP3,
  SERATO_WAV,
} from '../shared/seratoMarkersFixture'
import { encodeBase91 } from './base91'
import { configureOriginalKeeper } from './originalKeeper'
import { seratoLeadOfFile } from './seratoClock'
import { seratoCueSource } from './seratoCueSource'
import { writeSeratoCues } from './seratoCuesWrite'
import { readSeratoMarkers } from './seratoTags'
import { geobParts, readCueTree } from './tags'

const FF = ffmpegStatic as unknown as string
const TREE = Uint8Array.from([0x54, 0x52, 0x4d, 0x44, 1, 2, 3, 4])
const COVER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 0xff, 0xd9])
const OVERVIEW = Uint8Array.from([1, 5, 9, 9, 9, 7])
const V1 = Uint8Array.from([2, 5, 0, 0, 0, 1, 2, 3])

const FORMATS = [
  { ext: 'mp3', codec: ['-c:a', 'libmp3lame', '-b:a', '320k'], markers: SERATO_MP3 },
  { ext: 'aiff', codec: ['-c:a', 'pcm_s16be'], markers: SERATO_AIFF },
  { ext: 'wav', codec: ['-c:a', 'pcm_s16le'], markers: SERATO_WAV },
  { ext: 'flac', codec: ['-c:a', 'flac'], markers: SERATO_FLAC },
  { ext: 'm4a', codec: ['-c:a', 'alac'], markers: SERATO_M4A },
] as const

const isId3 = (ext: string) => ext === 'mp3' || ext === 'aiff' || ext === 'wav'

function audioMd5(file: string): string {
  return execFileSync(FF, ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-'])
    .toString()
    .trim()
}

function edit(file: string, write: (f: TagFile) => void): void {
  const f = TagFile.createFromPath(file)
  try {
    write(f)
    f.save()
  } finally {
    f.dispose()
  }
}

function geob(description: string, body: Uint8Array): Id3v2AttachmentFrame {
  const picture = Picture.fromFullData(
    ByteVector.fromByteArray(body),
    PictureType.NotAPicture,
    'application/octet-stream',
    description,
  )
  picture.filename = ''
  const frame = Id3v2AttachmentFrame.fromPicture(picture)
  frame.textEncoding = StringType.Latin1
  return frame
}

function track(format: (typeof FORMATS)[number]): string {
  const { ext, codec, markers } = format
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-write-')), `track.${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    ...codec,
    file,
  ])
  edit(file, (f) => {
    f.tag.title = 'Bleeding Love'
    f.tag.pictures = [
      Picture.fromFullData(
        ByteVector.fromByteArray(COVER),
        PictureType.FrontCover,
        'image/jpeg',
        'cover',
      ),
    ]
  })
  edit(file, (f) => {
    if (isId3(ext)) {
      const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      id3.addFrame(geob('Serato Overview', OVERVIEW))
      id3.addFrame(geob('Serato Markers_', V1))
      id3.addFrame(geob('Serato Markers2', Buffer.from(markers, 'base64')))
      const priv = Id3v2PrivateFrame.fromOwner('TRAKTOR4')
      priv.privateData = ByteVector.fromByteArray(TREE)
      id3.addFrame(priv)
    } else if (ext === 'flac') {
      const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
      xiph.setFieldAsStrings('SERATO_MARKERS_V2', markers)
      xiph.setFieldAsStrings('TRAKTOR4', encodeBase91(TREE))
    } else {
      const apple = f.tag as Mpeg4AppleTag
      apple.setItunesStrings('com.serato.dj', 'markersv2', markers)
      apple.setItunesStrings('com.serato.dj', 'markers', 'djEgYmxvY2s=')
    }
  })
  return file
}

function read<T>(file: string, from: (f: TagFile) => T): T {
  const f = TagFile.createFromPath(file)
  try {
    return from(f)
  } finally {
    f.dispose()
  }
}

function geobs(file: string): Map<string, Uint8Array> {
  return read(file, (f) => {
    const found = new Map<string, Uint8Array>()
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    for (const frame of (id3?.frames ?? []) as Id3v2Frame[]) {
      if (frame.frameId.toString() !== 'GEOB') continue
      const parts = geobParts(frame.render(4).toByteArray())
      if (parts) found.set(parts.description, Uint8Array.from(parts.payload))
    }
    return found
  })
}

function rawPayload(file: string, ext: string): Uint8Array | null {
  if (isId3(ext)) {
    const body = geobs(file).get('Serato Markers2')
    return body ? seratoPayloadOf(body) : null
  }
  const armored = read(file, (f) =>
    ext === 'flac'
      ? (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField('SERATO_MARKERS_V2')?.[0]
      : (f.tag as Mpeg4AppleTag).getItunesStrings('com.serato.dj', 'markersv2')[0],
  )
  return armored ? seratoPayloadOf(armored) : null
}

async function fingerprintOf(file: string): Promise<string> {
  const seen = await seratoCueSource({ words: async () => null }).trackCues(`serato:${file}`)
  if (!seen) throw new Error(`no Serato cues read from ${file}`)
  return seen.fingerprint
}

const WANTED: SeratoCue[] = [
  { index: 0, ms: 1000, color: 0xcc0000, name: 'Drop' },
  { index: 3, ms: 1500.4, color: 0x00cc00, name: '' },
]

afterEach(() => {
  configureOriginalKeeper(null)
})

describe.each(FORMATS)('writing Serato cues into a $ext', (format) => {
  const { ext } = format

  it("leaves Serato reading Surco's cues at the same beat, on its own clock", async () => {
    const file = track(format)
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const lead = await seratoLeadOfFile(file, 44100)
    if (ext === 'mp3' || ext === 'm4a') expect(lead).not.toBe(0)
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
    expect(readSeratoMarkers(file)?.cues).toEqual(
      WANTED.map((c) => ({ ...c, ms: Math.round(c.ms + lead) })),
    )
  }, 60000)

  it('keeps every entry Serato wrote that is not a hot cue, byte for byte', async () => {
    const file = track(format)
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const before = rawPayload(file, ext)
    const lead = await seratoLeadOfFile(file, 44100)
    await writeSeratoCues(file, WANTED, await fingerprintOf(file))
    expect(rawPayload(file, ext)).toEqual(
      withSeratoCues(
        before,
        WANTED.map((c) => ({ ...c, ms: Math.round(c.ms + lead) })),
      ),
    )
  }, 60000)

  it('leaves the audio, the title, the cover and the Traktor cues as they were', async () => {
    const file = track(format)
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const md5 = audioMd5(file)
    const tree = readCueTree(file)
    await writeSeratoCues(file, WANTED, await fingerprintOf(file))
    expect(audioMd5(file)).toBe(md5)
    expect(readCueTree(file)).toEqual(tree)
    expect(read(file, (f) => f.tag.title)).toBe('Bleeding Love')
    expect(read(file, (f) => Uint8Array.from(f.tag.pictures[0].data.toByteArray()))).toEqual(COVER)
    if (isId3(ext)) expect(geobs(file).get('Serato Overview')).toEqual(OVERVIEW)
  }, 60000)

  it('changes nothing when Serato moved the cues after the editor read them', async () => {
    const file = track(format)
    const keeper = vi.fn(async () => ({ id: 'b1' }) as never)
    configureOriginalKeeper(keeper)
    const stale = await fingerprintOf(file)
    await writeSeratoCues(file, [{ index: 1, ms: 700, color: 0x0000cc, name: '' }], stale)
    const bytes = readFileSync(file)
    expect(await writeSeratoCues(file, WANTED, stale)).toBe('changed')
    expect(readFileSync(file)).toEqual(bytes)
    expect(keeper).toHaveBeenCalledTimes(1)
  }, 60000)
})

describe('the old Serato block that would win over the new cues', () => {
  it.each(['mp3', 'aiff', 'wav'])(
    'drops the Serato Markers_ GEOB from a %s',
    async (ext) => {
      const file = track(FORMATS.find((f) => f.ext === ext) as (typeof FORMATS)[number])
      configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
      expect(geobs(file).has('Serato Markers_')).toBe(true)
      await writeSeratoCues(file, WANTED, await fingerprintOf(file))
      expect(geobs(file).has('Serato Markers_')).toBe(false)
    },
    60000,
  )

  it('drops the com.serato.dj markers atom from an m4a', async () => {
    const file = track(FORMATS[4])
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const v1 = () =>
      read(file, (f) => (f.tag as Mpeg4AppleTag).getItunesStrings('com.serato.dj', 'markers'))
    expect(v1()).toHaveLength(1)
    await writeSeratoCues(file, WANTED, await fingerprintOf(file))
    expect(v1()).toEqual([])
  }, 60000)
})

describe('the ID3 tag Serato reads', () => {
  it.each([
    ['mp3', 3],
    ['aiff', 4],
    ['wav', 4],
  ])(
    'writes a %s tag as ID3v2.%i',
    async (ext, version) => {
      const file = track(FORMATS.find((f) => f.ext === ext) as (typeof FORMATS)[number])
      configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
      await writeSeratoCues(file, WANTED, await fingerprintOf(file))
      expect(read(file, (f) => (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).version)).toBe(version)
    },
    60000,
  )

  it('gives a file Serato never touched a Markers2 frame of its own', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-write-')), 'bare.mp3')
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=2', file])
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const lead = await seratoLeadOfFile(file, 44100)
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
    expect(readSeratoMarkers(file)?.cues.map((c) => c.ms)).toEqual(
      WANTED.map((c) => Math.round(c.ms + lead)),
    )
  }, 60000)
})

describe('a cue on the first sample of an m4a', () => {
  it('lands on the start in Serato instead of wrapping to the end of time', async () => {
    const file = track(FORMATS[4])
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    await writeSeratoCues(
      file,
      [{ index: 0, ms: 0, color: 0xcc0000, name: '' }],
      await fingerprintOf(file),
    )
    expect(readSeratoMarkers(file)?.cues.map((c) => c.ms)).toEqual([0])
  }, 60000)
})

describe('a write that cannot keep a way back', () => {
  it('keeps the original whatever the backup setting says, and tells Engine the old size', async () => {
    const file = track(FORMATS[0])
    const before = readFileSync(file)
    const size = statSync(file).size
    let kept: Buffer | null = null
    const keeper = vi.fn(async (path: string) => {
      kept = readFileSync(path)
      return { id: 'b1' } as never
    })
    configureOriginalKeeper(keeper)
    const rewritten = vi.fn()
    await writeSeratoCues(file, WANTED, await fingerprintOf(file), { rewritten })
    expect(kept).toEqual(before)
    expect(keeper).toHaveBeenCalledWith(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    expect(rewritten).toHaveBeenCalledWith(file, size)
  }, 60000)

  it('fails and leaves the file as it was when the backup was refused', async () => {
    const file = track(FORMATS[0])
    const before = readFileSync(file)
    configureOriginalKeeper(vi.fn().mockResolvedValue(null))
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('failed')
    expect(readFileSync(file)).toEqual(before)
  }, 60000)

  it('fails on a file that is gone, and leaves no temp copy tracked', async () => {
    const track = { track: vi.fn(), untrack: vi.fn() }
    expect(
      await writeSeratoCues(join(tmpdir(), 'surco-serato-gone', 'x.mp3'), WANTED, '', {
        tracking: track,
      }),
    ).toBe('failed')
    expect(track.track.mock.calls.length).toBe(track.untrack.mock.calls.length)
  })
})
