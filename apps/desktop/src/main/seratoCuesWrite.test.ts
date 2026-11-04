import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
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
vi.mock('./worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./worker')>()
  return { ...actual, runInWorker: vi.fn(actual.runInWorker) }
})

import {
  type SeratoCue,
  seratoArmored,
  seratoGeobBody,
  seratoPayloadOf,
  withSeratoCues,
} from '../shared/seratoMarkers'
import {
  SERATO_AIFF,
  SERATO_FLAC,
  SERATO_M4A,
  SERATO_MP3,
  SERATO_WAV,
} from '../shared/seratoMarkersFixture'
import { encodeBase91 } from './base91'
import { configureBackupDiscarder, configureOriginalKeeper } from './originalKeeper'
import { seratoLeadOfFile } from './seratoClock'
import { seratoCueSource } from './seratoCueSource'
import { writeSeratoCues } from './seratoCuesWrite'
import { readSeratoMarkers } from './seratoTags'
import { diffSnapshots, snapshotTags } from './tagSnapshot'
import { geobParts, readCueTree, setId3Date } from './tags'
import { runInWorker } from './worker'

const FF = ffmpegStatic as unknown as string
const TREE = Uint8Array.from([0x54, 0x52, 0x4d, 0x44, 1, 2, 3, 4])
const COVER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 0xff, 0xd9])
const OVERVIEW = Uint8Array.from([1, 5, 9, 9, 9, 7])
const V1 = Uint8Array.from([2, 5, 0, 0, 0, 1, 2, 3])
const SERATO_OVERVIEW_TEXT = 'b3ZlcnZpZXc='

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

function track(format: (typeof FORMATS)[number], payload?: Uint8Array): string {
  const { ext, codec } = format
  const markers = payload
    ? isId3(ext)
      ? Buffer.from(seratoGeobBody(payload)).toString('base64')
      : seratoArmored(payload)
    : format.markers
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
    if (isId3(ext)) (f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).version = 3
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
      xiph.setFieldAsStrings('SERATO_OVERVIEW', SERATO_OVERVIEW_TEXT)
    } else {
      const apple = f.tag as Mpeg4AppleTag
      apple.setItunesStrings('com.serato.dj', 'markersv2', markers)
      apple.setItunesStrings('com.serato.dj', 'markers', 'djEgYmxvY2s=')
      apple.setItunesStrings('com.serato.dj', 'overview', SERATO_OVERVIEW_TEXT)
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

function entry(name: string, body: number[]): Buffer {
  const head = Buffer.alloc(name.length + 5)
  head.write(name, 0, 'latin1')
  head.writeUInt32BE(body.length, name.length + 1)
  return Buffer.concat([head, Buffer.from(body)])
}

const FLIP = entry('FLIP', [0, 0, 1, 0x46, 0x6c, 0x69, 0x70, 0, 0, 0, 0, 2, 9, 9, 9, 9])
const NAMED_LOOP = entry(
  'LOOP',
  [
    0, 0, 0, 0, 0x03, 0xe8, 0, 0, 0x07, 0xd0, 0xff, 0xff, 0xff, 0xff, 0, 0x27, 0xaa, 0xe1, 0, 0,
    0x42, 0x75, 0x69, 0x6c, 0x64, 0,
  ],
)
const BPM_LOCKED = entry('BPMLOCK', [1])
const FOREIGN_PAYLOAD = Uint8Array.from(
  Buffer.concat([
    Buffer.from([1, 1]),
    entry('COLOR', [0, 0xff, 0xff, 0xff]),
    entry('CUE', [0, 0, 0, 0, 0x0b, 0xb8, 0, 0xcc, 0, 0, 0, 0, 0]),
    NAMED_LOOP,
    FLIP,
    BPM_LOCKED,
  ]),
)

function replaceMarkers(file: string, ext: string, payload: Uint8Array): void {
  edit(file, (f) => {
    if (isId3(ext)) {
      const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      for (const frame of id3.frames.slice())
        if (frame.frameId.toString() === 'GEOB') {
          const parts = geobParts(frame.render(4).toByteArray())
          if (parts?.description === 'Serato Markers2') id3.removeFrame(frame)
        }
      id3.addFrame(geob('Serato Markers2', seratoGeobBody(payload)))
    } else if (ext === 'flac')
      (f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
        'SERATO_MARKERS_V2',
        seratoArmored(payload),
      )
    else
      (f.tag as Mpeg4AppleTag).setItunesStrings(
        'com.serato.dj',
        'markersv2',
        seratoArmored(payload),
      )
  })
}

async function fingerprintOf(file: string): Promise<string> {
  const seen = await seratoCueSource(
    {
      words: async () => null,
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
    },
    () => '',
  ).trackCues(`serato:${file}`)
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
    if (ext === 'mp3') expect(lead).not.toBe(0)
    if (ext === 'm4a') expect(lead).toBe(0)
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
    if (ext === 'flac')
      expect(
        read(file, (f) =>
          (f.getTag(TagTypes.Xiph, false) as XiphComment).getField('SERATO_OVERVIEW'),
        ),
      ).toEqual([SERATO_OVERVIEW_TEXT])
    if (ext === 'm4a')
      expect(
        read(file, (f) => (f.tag as Mpeg4AppleTag).getItunesStrings('com.serato.dj', 'overview')),
      ).toEqual([SERATO_OVERVIEW_TEXT])
  }, 60000)

  it('carries a flip, a named loop and a locked BPM through the container untouched', async () => {
    const file = track(format, FOREIGN_PAYLOAD)
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const loops = readSeratoMarkers(file)?.loops
    expect(loops?.map((l) => l.name)).toEqual(['Build'])
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
    const after = Buffer.from(rawPayload(file, ext) ?? [])
    for (const kept of [FLIP, NAMED_LOOP, BPM_LOCKED])
      expect(after.indexOf(kept)).toBeGreaterThan(0)
    expect(readSeratoMarkers(file)?.loops).toEqual(loops)
  }, 60000)

  it('changes nothing when Serato saves the cues while the write is starting', async () => {
    const file = track(format)
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const seen = await fingerprintOf(file)
    const serato = withSeratoCues(rawPayload(file, ext), [
      { index: 5, ms: 900, color: 0x0000cc, name: 'Serato' },
    ])
    const seratoSaves = {
      track: () => replaceMarkers(file, ext, serato),
      untrack: () => undefined,
    }
    expect(await writeSeratoCues(file, WANTED, seen, { tracking: seratoSaves })).toBe('changed')
    expect(rawPayload(file, ext)).toEqual(serato)
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

const MIK_BEATGRID_GZIP =
  'H4sIAAAAAAAC/y2T3Y6bMBSEc83LlB8j9ZbGKPWKYyuKSUvvsmTFYtLdVQky9tN3TsIFQuus53xnZthdvr5uY3+5j58f39z8+bHb/Xi73A//xuvuLbzE1+Icurwdzfhyv/x+v/053JZLfi7V6Mfr4XzvD99H4+qU9sKTrFIdyZNTqXZVqfd+7H6tH8lr8fJ1PbzflftcCRe7v+f3608azW32jRtyspMw9iggsGpJhZGtaGS9kJu8tm2pZY/3kCYku8Kc/Nq4fjW2DriEy3VGsc8weaZRQKDPjZ1SbeuCHKVadmUj1aJtn5PrIHYMCZQjWcop+Ni4yms5RIhFYho3BG27mYJIKVJKckpZiKLKyLZ8LrSrSx0nENkj9laB5DE28rghHzEFXlhQyinq4NONGA+VIEshJEAz69OTOOF/xN4F1gk6qrSR7YbclliPqbyxXYB/+UaM9SnXbshgC8jUrEcBokhYBVNtD+wqgmRtZLcY2WF6B7Fjgd+ZuoSXReNUSbLFHWKAzDC17edEBwGaacX+8AVvBx/kkDdyWLB2oV0PMfjgJghMhT550bgW5yqFGO6p3MheJJyMOXE/EDHIELOgOKArPcimBZGDeSh5iObfLNYZfblVA0SK7xUQGjJMWVE27F5luMBeZTAQD5Kx1aJBBBqIdUj4UYEMXUJlagzsUA2VwaMOEeLyHmInge7A2Ii/0Q1En7OZeBZutJFVyfEbrEOxChALjUNVIhUJ1HCBI8XEEWLj1g05BeLmujY3PCRsxBbnnFZsuRZ8zh57jp9dh2mt1xDS+2cvIIwO4Y3UeHWcP2nZqzgwMYo5gbZ90MIjkNhOGMklUwVwsw0Xu9cwk9j8laejfA9aCGDYhC0IXeoh1i3Js8nYHQ3XVkVOAmL5s8kVOlTjjL0ZxEMsbMSSq1KjmAgmtjM+kX5rMiah3TAzcDoQE88m9/j6a88N5yEcitk/vj2UePJcTKSaJ1qq+T+6Ol0isAQAAA=='

const syncsafe = (n: number) =>
  Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

function rawFrame(id: string, data: Buffer): Buffer {
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  head.writeUInt32BE(data.length, 4)
  return Buffer.concat([head, data])
}

function rawMp3(version: number, frames: Buffer[]): string {
  const body = Buffer.concat(frames)
  const header = Buffer.concat([
    Buffer.from('ID3'),
    Buffer.from([version, 0, 0]),
    syncsafe(body.length),
  ])
  const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-raw-')), 'track.mp3')
  writeFileSync(file, Buffer.concat([header, body, ...Array(20).fill(mpegFrame)]))
  return file
}

function bare(ext: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-write-')), `bare.${ext}`)
  const noId3 = ext === 'mp3' ? ['-id3v2_version', '0', '-write_xing', '0'] : []
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=2',
    ...noId3,
    file,
  ])
  return file
}

function dated(ext: string, version: number): string {
  const file = bare(ext)
  edit(file, (f) => {
    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    id3.version = version
    setId3Date(id3, '2019-05-17')
  })
  return file
}

const dateFrames = (file: string) =>
  read(file, (f) => {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    return {
      version: id3.version,
      dates: id3.frames
        .filter((fr) => ['TYER', 'TDAT', 'TDRC'].includes(fr.frameId.toString()))
        .map((fr) => `${fr.frameId.toString()}=${fr.toString()}`),
    }
  })

function tconText(file: string): string {
  const bytes = readFileSync(file)
  const at = bytes.indexOf('TCON')
  const body = bytes.subarray(at + 10, at + 10 + bytes.readUInt32BE(at + 4))
  const text =
    body[0] === 1 ? body.subarray(3).toString('utf16le') : body.subarray(1).toString('latin1')
  return text.replace(/\0+$/, '')
}

describe('the ID3 tag Serato reads', () => {
  it.each(['mp3', 'aiff', 'wav'].flatMap((ext) => [[ext, 3] as const, [ext, 4] as const]))(
    'keeps a %s tag at ID3v2.%i, and its full date with it',
    async (ext, version) => {
      const file = dated(ext, version)
      configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
      const before = dateFrames(file)
      expect(before.dates.length).toBeGreaterThan(0)
      expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
      expect(dateFrames(file)).toEqual(before)
    },
    60000,
  )

  it.each(['mp3', 'aiff', 'wav'])(
    'gives a %s with no ID3 tag a v2.3 one, as every tag Surco writes',
    async (ext) => {
      const file = bare(ext)
      configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
      expect(read(file, (f) => f.tagTypesOnDisk & TagTypes.Id3v2)).toBe(0)
      expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
      expect(read(file, (f) => (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).version)).toBe(3)
    },
    60000,
  )

  it.each(['House; Deep House', 'Techno (Peak Time / Driving)'])(
    'leaves the v2.3 genre "%s" as it was written',
    async (genre) => {
      const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-genre-')), 'track.mp3')
      execFileSync(FF, [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=d=2',
        '-id3v2_version',
        '3',
        '-metadata',
        `genre=${genre}`,
        file,
      ])
      configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
      expect(tconText(file)).toBe(genre)
      expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
      expect(tconText(file)).toBe(genre)
    },
    60000,
  )

  it('writes past a malformed UFID by dropping it, as every other Surco tag write does', async () => {
    const owner = Buffer.from('http://www.jhutveckling.se', 'latin1')
    const file = rawMp3(3, [
      rawFrame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from('Old Title', 'latin1')])),
      rawFrame('UFID', Buffer.concat([owner, Buffer.from([0])])),
    ])
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
    expect(readSeratoMarkers(file)?.cues.map((c) => c.index)).toEqual([0, 3])
    expect(read(file, (f) => f.tag.title)).toBe('Old Title')
  }, 60000)

  it('writes next to the Mixed In Key object that breaks cloned saves, and keeps it', async () => {
    const body = gunzipSync(Buffer.from(MIK_BEATGRID_GZIP, 'base64'))
    const file = rawMp3(4, [rawFrame('GEOB', body)])
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
    expect(readSeratoMarkers(file)?.cues.map((c) => c.index)).toEqual([0, 3])
    expect(geobs(file).has('BeatGrid')).toBe(true)
  }, 60000)

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

describe('the tags a Serato write leaves on disk', () => {
  it.each(['mp3', 'wav', 'aiff'])(
    'adds only the Markers2 frame to a %s, never an ID3v1 or a RIFF tag it did not have',
    async (ext) => {
      const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-kinds-')), `plain.${ext}`)
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=2', file])
      configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
      const before = snapshotTags(file)
      const kinds = read(file, (f) => f.tagTypesOnDisk)
      expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('written')
      const { added, removed } = diffSnapshots(before, snapshotTags(file))
      expect(removed).toEqual([])
      expect(added).toContainEqual(expect.stringMatching(/^id3 GEOB.*Serato Markers2/))
      expect(added.filter((l) => !/Serato Markers2|^picture type=255/.test(l))).toEqual([])
      expect(read(file, (f) => f.tagTypesOnDisk)).toBe(kinds | TagTypes.Id3v2)
    },
    60000,
  )
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

  it('leaves the file, its temp copy and its backup alone when Serato opens before the file is replaced', async () => {
    const file = track(FORMATS[0])
    const before = readFileSync(file)
    configureOriginalKeeper(async () => ({ id: 'b1' }) as never)
    const discarder = vi.fn(async () => undefined)
    configureBackupDiscarder(discarder)
    const tracking = { track: vi.fn(), untrack: vi.fn() }
    const seratoOpen = vi.fn(async () => true)
    try {
      expect(
        await writeSeratoCues(file, WANTED, await fingerprintOf(file), { tracking, seratoOpen }),
      ).toBe('cancelled')
    } finally {
      configureBackupDiscarder(null)
    }
    const [tmp] = tracking.track.mock.calls[0]
    expect(existsSync(tmp)).toBe(false)
    expect(readFileSync(file)).toEqual(before)
    expect(discarder).toHaveBeenCalledWith({ id: 'b1' })
    expect(seratoOpen).toHaveBeenCalledTimes(1)
  }, 60000)

  it('fails and leaves the file as it was when the backup was refused', async () => {
    const file = track(FORMATS[0])
    const before = readFileSync(file)
    configureOriginalKeeper(vi.fn().mockResolvedValue(null))
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file))).toBe('failed')
    expect(readFileSync(file)).toEqual(before)
  }, 60000)

  it('fails without touching the file and sweeps its temp copy when the tag write dies', async () => {
    const file = track(FORMATS[0])
    const before = readFileSync(file)
    const keeper = vi.fn(async () => ({ id: 'b1' }) as never)
    configureOriginalKeeper(keeper)
    const tracking = { track: vi.fn(), untrack: vi.fn() }
    vi.mocked(runInWorker).mockRejectedValueOnce(new Error('worker died'))
    expect(await writeSeratoCues(file, WANTED, await fingerprintOf(file), { tracking })).toBe(
      'failed',
    )
    const [tmp] = tracking.track.mock.calls[0]
    expect(tracking.untrack).toHaveBeenCalledWith(tmp)
    expect(existsSync(tmp)).toBe(false)
    expect(readFileSync(file)).toEqual(before)
    expect(keeper).not.toHaveBeenCalled()
  }, 60000)
})
