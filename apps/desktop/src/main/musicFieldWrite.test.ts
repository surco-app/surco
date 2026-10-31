import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2PrivateFrame,
  Id3v2Settings,
  type Id3v2Tag,
  type InfoTag,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { encodeBase91 } from './base91'
import { readGenreFrame } from './genreFrame'
import { prepareTagRewrite, rewriteCueTree, rewriteTagFields } from './musicFieldWrite'
import { applyMusicFixes } from './musicReviewApply'
import { configureBackupDiscarder, configureOriginalKeeper, policyKeeper } from './originalKeeper'
import { diffSnapshots, snapshotTags } from './tagSnapshot'
import { readCueTree } from './tags'
import { readTraktorMarkers } from './traktor4'
import { buildTraktorTree, injectWavPriv, storedTree, traktorCue } from './traktor4Fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-field-write-'))
const FORMATS = [
  { ext: 'mp3', codec: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
  { ext: 'flac', codec: ['-c:a', 'flac'] },
  { ext: 'aiff', codec: ['-c:a', 'pcm_s16be'] },
  { ext: 'wav', codec: ['-c:a', 'pcm_s16le'] },
  { ext: 'm4a', codec: ['-c:a', 'alac'] },
] as const

function audioMd5(file: string): string {
  return execFileSync(FF, ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-'])
    .toString()
    .trim()
}

function make(ext: string, codec: readonly string[], artist: string): string {
  const file = join(dir, `${ext}-${Math.random().toString(36).slice(2)}.${ext}`)
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
  const f = TagFile.createFromPath(file)
  try {
    f.tag.title = 'Bleeding Love'
    f.tag.performers = [artist]
    f.tag.album = 'Bleeding Love'
    f.tag.genres = ['Electronic']
    f.tag.comment = 'A2S B1S - E6 F4'
    f.tag.beatsPerMinute = 128
    f.tag.initialKey = '8A'
    f.tag.grouping = 'Peak'
    if (ext === 'mp3') {
      const priv = Id3v2PrivateFrame.fromOwner('TRAKTOR4')
      priv.privateData = ByteVector.fromString('cue tree', StringType.Latin1)
      ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(priv)
      const serato = Id3v2PrivateFrame.fromOwner('Serato Markers2')
      serato.privateData = ByteVector.fromString('serato payload', StringType.Latin1)
      ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(serato)
    }
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

function diskTypes(file: string): number {
  const f = TagFile.createFromPath(file)
  try {
    return f.tagTypesOnDisk
  } finally {
    f.dispose()
  }
}

function riffChunks(file: string): string[] {
  const b = readFileSync(file)
  const ids: string[] = []
  for (let p = 12; p + 8 <= b.length; ) {
    const id = b.toString('latin1', p, p + 4)
    const size = b.readUInt32LE(p + 4)
    ids.push(id === 'LIST' ? `LIST:${b.toString('latin1', p + 8, p + 12)}` : id)
    p += 8 + size + (size & 1)
  }
  return ids
}

function makeId3OnlyWav(id3Artist: string, infoArtist: string | null): string {
  const file = join(dir, `id3-only-${Math.random().toString(36).slice(2)}.wav`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'pcm_s16le',
    '-fflags',
    '+bitexact',
    '-map_metadata',
    '-1',
    file,
  ])
  const f = TagFile.createFromPath(file)
  try {
    f.getTag(TagTypes.Id3v2, true).performers = [id3Artist]
    if (infoArtist) f.getTag(TagTypes.RiffInfo, true).performers = [infoArtist]
    f.removeTags(TagTypes.MovieId | TagTypes.DivX | (infoArtist ? 0 : TagTypes.RiffInfo))
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

function makeInfoOnlyWav(): string {
  const file = join(dir, `info-only-${Math.random().toString(36).slice(2)}.wav`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'pcm_s16le',
    '-fflags',
    '+bitexact',
    '-map_metadata',
    '-1',
    '-metadata',
    'title=Happiness ',
    '-metadata',
    'artist=Sound De-Zign',
    '-metadata',
    'album=Ultimate NRG - Best of 1996-2016 ',
    '-metadata',
    'genre=Electronic',
    file,
  ])
  return file
}

function ffTags(file: string): Record<string, string> {
  const out = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'ffmetadata', '-'])
    .toString()
    .split('\n')
    .filter((line) => /^(title|artist|album|genre)=/.test(line))
  return Object.fromEntries(
    out.map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1)]),
  )
}

function infoRaw(file: string, id: string): string[] {
  const f = TagFile.createFromPath(file)
  try {
    return (f.getTag(TagTypes.RiffInfo, false) as InfoTag).getValuesAsStrings(id)
  } finally {
    f.dispose()
  }
}

function makeMp3WithBrokenUfid(shape: 'empty-id' | 'extra-nulls'): string {
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  const frame = (id: string, data: Buffer) => {
    const head = Buffer.alloc(10)
    head.write(id, 0, 'latin1')
    head.writeUInt32BE(data.length, 4)
    return Buffer.concat([head, data])
  }
  const owner = Buffer.from('http://www.jhutveckling.se', 'latin1')
  const payload =
    shape === 'empty-id'
      ? Buffer.concat([owner, Buffer.from([0])])
      : Buffer.concat([owner, Buffer.from([0, 1, 0, 2, 0, 3])])
  const tit2 = frame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from('Old Title', 'latin1')]))
  const body = Buffer.concat([tit2, frame('UFID', payload)])
  const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length)])
  const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
  const file = join(dir, `ufid-${shape}.mp3`)
  writeFileSync(file, Buffer.concat([header, body, ...Array(20).fill(mpegFrame)]))
  return file
}

afterEach(() => {
  configureOriginalKeeper(null)
  configureBackupDiscarder(null)
})

describe.each(FORMATS)('rewriting the artist of a $ext', ({ ext, codec }) => {
  let file: string
  let before: string[]
  let md5: string

  beforeAll(() => {
    file = make(ext, codec, 'Dj Lara')
    before = snapshotTags(file)
    md5 = audioMd5(file)
  }, 60000)

  // The review promises one field and nothing else: BPM, key, comment, grouping, the
  // Traktor and Serato private frames and the audio itself come out as they went in.
  it('changes the artist and nothing else', async () => {
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(outcomes).toEqual(['written'])
    const { added, removed } = diffSnapshots(before, snapshotTags(file))
    expect(added.every((line) => line.includes('DJ Lara'))).toBe(true)
    expect(removed.every((line) => line.includes('Dj Lara'))).toBe(true)
    expect(added.length).toBeGreaterThan(0)
    expect(audioMd5(file)).toBe(md5)
  }, 60000)
})

describe('rewriteTagFields', () => {
  // A WAV's own tags can disagree with Music (Music keeps its own copy for WAV). The
  // review only ever saw Music's value, so a file that says something else is left alone.
  it('leaves the file untouched when its value is not the one Music had', async () => {
    const file = make('wav', ['-c:a', 'pcm_s16le'], 'Someone Else')
    const before = snapshotTags(file)
    const { outcomes, backup } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(outcomes).toEqual(['unchanged'])
    expect(backup).toBeUndefined()
    expect(snapshotTags(file)).toEqual(before)
  }, 60000)

  it('matches a composed accent against a decomposed one and writes the new value', async () => {
    const file = join(dir, `nfd-${Math.random().toString(36).slice(2)}.mp3`)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:a',
      'libmp3lame',
      '-id3v2_version',
      '3',
      '-write_id3v1',
      '0',
      '-metadata',
      'artist=Christian Milla\u0301n',
      file,
    ])
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Christian Millán', to: 'Cristian Millán' },
    ])
    expect(outcomes).toEqual(['written'])
    const f = TagFile.createFromPath(file)
    try {
      expect(f.tag.performers).toEqual(['Cristian Millán'])
    } finally {
      f.dispose()
    }
  }, 60000)

  // ID3v1 is a lossy Latin-1 mirror cut to 30 characters; judging the file by it would skip
  // most MP3s that TagLib itself tagged. The ID3v2 value is the one Music read.
  it.each([
    [
      'composed in the file, decomposed in Music',
      'Christian Mill\u00e1n',
      'Christian Milla\u0301n',
    ],
    [
      'decomposed in the file, composed in Music',
      'Christian Milla\u0301n',
      'Christian Mill\u00e1n',
    ],
  ])(
    'writes an MP3 with an ID3v1 mirror when the accent is %s',
    async (_name, inFile, inMusic) => {
      const file = make('mp3', ['-c:a', 'libmp3lame'], inFile)
      expect(diskTypes(file) & TagTypes.Id3v1).not.toBe(0)
      const { outcomes } = await rewriteTagFields(file, [
        { field: 'artist', from: inMusic, to: 'Cristian Millan' },
      ])
      expect(outcomes).toEqual(['written'])
      expect(diskTypes(file) & TagTypes.Id3v1).not.toBe(0)
    },
    60000,
  )

  it('writes an MP3 whose long title ID3v1 only holds truncated', async () => {
    const longTitle = 'A Very Long Title That Runs Well Past Thirty Characters'
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const f = TagFile.createFromPath(file)
    try {
      f.tag.title = longTitle
      f.save()
    } finally {
      f.dispose()
    }
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'title', from: longTitle, to: 'Short' },
    ])
    expect(outcomes).toEqual(['written'])
  }, 60000)

  // A tag the file never had must not appear: TagLib's combined setter creates every type
  // the format could carry. An ID3v1 ghost on an MP3 was the v0.99.6 bug. No TagLib in the
  // fixture, so what is on disk is exactly what ffmpeg wrote.
  it('adds no ID3v1 to an MP3 that only ffmpeg tagged', async () => {
    const file = join(dir, `ffmpeg-only-${Math.random().toString(36).slice(2)}.mp3`)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:a',
      'libmp3lame',
      '-id3v2_version',
      '3',
      '-write_id3v1',
      '0',
      '-metadata',
      'artist=Dj Lara',
      '-metadata',
      'title=Bleeding Love',
      file,
    ])
    const before = snapshotTags(file)
    const typesBefore = diskTypes(file)
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(outcomes).toEqual(['written'])
    expect(diskTypes(file)).toBe(typesBefore)
    const { added, removed } = diffSnapshots(before, snapshotTags(file))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((line) => line.includes('DJ Lara'))).toBe(true)
    expect(removed.every((line) => line.includes('Dj Lara'))).toBe(true)
    expect(added.some((line) => line.startsWith('id3v1'))).toBe(false)
  }, 60000)

  it('adds no INFO, MID or IDVX chunks to a WAV that only has an ID3 chunk', async () => {
    const file = makeId3OnlyWav('Dj Lara', null)
    const chunksBefore = riffChunks(file)
    expect(chunksBefore).not.toContain('LIST:INFO')
    const before = snapshotTags(file)
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(outcomes).toEqual(['written'])
    expect(riffChunks(file)).toEqual(chunksBefore)
    const { added, removed } = diffSnapshots(before, snapshotTags(file))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((line) => line.includes('DJ Lara'))).toBe(true)
    expect(removed.every((line) => line.includes('Dj Lara'))).toBe(true)
  }, 60000)

  // The combined view reads the first tag with a value, so it would pass on the ID3 and
  // then overwrite an INFO list that says something Music never saw.
  it('leaves a WAV untouched when its ID3 and INFO disagree', async () => {
    const file = makeId3OnlyWav('Dj Lara', 'Someone')
    const before = snapshotTags(file)
    const bytes = readFileSync(file)
    const { outcomes, backup } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(outcomes).toEqual(['unchanged'])
    expect(backup).toBeUndefined()
    expect(snapshotTags(file)).toEqual(before)
    expect(readFileSync(file).equals(bytes)).toBe(true)
  }, 60000)

  // rekordbox, Music and ffmpeg read a WAV's INFO list by INAM, IART, IPRD and IGNR, each
  // value ending in a NUL. TagLib reads album from DIRC and artist from ISTR, so an
  // INFO-only WAV looked empty, or NUL-padded, and every review fix on it was refused.
  describe('a WAV whose only tag is RIFF INFO', () => {
    it('confirms the fixture is INFO-only with NUL-terminated values', () => {
      const file = makeInfoOnlyWav()
      expect(diskTypes(file)).toBe(TagTypes.RiffInfo)
      expect(infoRaw(file, 'IPRD')).toEqual(['Ultimate NRG - Best of 1996-2016 \u0000'])
    })

    it.each([
      ['album', 'IPRD', 'Ultimate NRG - Best of 1996-2016 ', 'Ultimate NRG - Best of 1996-2016'],
      ['title', 'INAM', 'Happiness ', 'Happiness'],
      ['artist', 'IART', 'Sound De-Zign', 'Sound De Zign'],
      ['genre', 'IGNR', 'Electronic', 'Trance'],
    ] as const)(
      'writes the %s ffmpeg reads into %s and keeps the audio',
      async (field, id, from, to) => {
        const file = makeInfoOnlyWav()
        const before = snapshotTags(file)
        const md5 = audioMd5(file)
        const chunks = riffChunks(file)
        const tagsBefore = ffTags(file)
        const { outcomes } = await rewriteTagFields(file, [{ field, from, to }])
        expect(outcomes).toEqual(['written'])
        expect(ffTags(file)).toEqual({ ...tagsBefore, [field]: to })
        expect(audioMd5(file)).toBe(md5)
        // A shorter INFO list leaves TagLib's padding behind as a JUNK chunk, which every
        // RIFF reader skips by definition.
        expect(riffChunks(file).filter((chunk) => chunk !== 'JUNK')).toEqual(chunks)
        expect(diskTypes(file)).toBe(TagTypes.RiffInfo)
        // TagLib opens a WAV with an in-memory ID3 copied from INFO, so only the riff lines
        // are what the disk holds.
        const riff = (lines: string[]) => lines.filter((line) => line.startsWith('riff '))
        expect(diffSnapshots(riff(before), riff(snapshotTags(file))).added).toEqual([
          `riff ${id}=${to}`,
        ])
        expect(infoRaw(file, id)).toEqual([`${to}\u0000`])
      },
      60000,
    )

    it('refuses an INFO value that is not the one Music had', async () => {
      const file = makeInfoOnlyWav()
      const bytes = readFileSync(file)
      const { outcomes } = await rewriteTagFields(file, [
        { field: 'album', from: 'Another Album', to: 'Ultimate NRG' },
      ])
      expect(outcomes).toEqual(['unchanged'])
      expect(readFileSync(file).equals(bytes)).toBe(true)
    }, 60000)

    // TagLib spells album artist IART, the id every other reader takes as the artist, so
    // writing it there would overwrite the artist rekordbox and Music show.
    it('never writes an album artist into the IART that holds the artist', async () => {
      const file = makeInfoOnlyWav()
      const bytes = readFileSync(file)
      const { outcomes } = await rewriteTagFields(file, [
        { field: 'albumArtist', from: '', to: 'Various Artists' },
      ])
      expect(outcomes).toEqual(['unchanged'])
      expect(readFileSync(file).equals(bytes)).toBe(true)
    }, 60000)
  })

  it('leaves a file alone when Music saw a value the file does not hold at all', async () => {
    const file = makeId3OnlyWav('Dj Lara', null)
    const bytes = readFileSync(file)
    const { outcomes } = await rewriteTagFields(file, [
      { field: 'title', from: 'Old Title', to: 'New Title' },
    ])
    expect(outcomes).toEqual(['unchanged'])
    expect(readFileSync(file).equals(bytes)).toBe(true)
  }, 60000)

  // A malformed UFID makes TagLib throw when it renders the ID3, so the save would fail
  // on 12 of 14 UFID-carrying MP3s in a real library. The broken frame goes, as in writeTags.
  it.each(['empty-id', 'extra-nulls'] as const)(
    'writes the title of an MP3 carrying a malformed UFID (%s)',
    async (shape) => {
      const file = makeMp3WithBrokenUfid(shape)
      const { outcomes } = await rewriteTagFields(file, [
        { field: 'title', from: 'Old Title', to: 'New Title' },
      ])
      expect(outcomes).toEqual(['written'])
      const f = TagFile.createFromPath(file)
      try {
        expect(f.tag.title).toBe('New Title')
      } finally {
        f.dispose()
      }
    },
    60000,
  )

  // A crash between the copy and the rename would leave the temp beside the user's file;
  // the manifest is what lets the next launch sweep it.
  it('tracks its temp and releases it once the rename has landed', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const track = vi.fn()
    const untrack = vi.fn()
    await rewriteTagFields(file, [{ field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }], {
      track,
      untrack,
    })
    expect(track).toHaveBeenCalledTimes(1)
    expect(untrack).toHaveBeenCalledWith(track.mock.calls[0][0])
    expect(existsSync(track.mock.calls[0][0])).toBe(false)
  }, 60000)

  // Engine DJ records each file's size, so a fix written over the file reaches its row with
  // the size the row still holds, and only when the file really changed.
  it('tells Engine DJ the size the file had before the fix was written', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const size = statSync(file).size
    const rewritten = vi.fn()
    await rewriteTagFields(
      file,
      [
        {
          field: 'artist',
          from: 'Dj Lara',
          to: `DJ Lara ${'and The Long Named Band '.repeat(200)}`,
        },
      ],
      undefined,
      rewritten,
    )
    expect(statSync(file).size).not.toBe(size)
    expect(rewritten).toHaveBeenCalledWith(file, size)
  }, 60000)

  it('tells Engine DJ nothing when the fix wrote nothing', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Someone Else')
    const rewritten = vi.fn()
    await rewriteTagFields(
      file,
      [{ field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      undefined,
      rewritten,
    )
    expect(rewritten).not.toHaveBeenCalled()
  }, 60000)

  it('writes several fields in one pass with one backup', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const keeper = vi.fn().mockResolvedValue({ id: 'b1' })
    configureOriginalKeeper(keeper)
    const { outcomes, backup } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
      { field: 'genre', from: 'Electronic', to: 'House' },
    ])
    expect(outcomes).toEqual(['written', 'written'])
    expect(keeper).toHaveBeenCalledTimes(1)
    expect(keeper).toHaveBeenCalledWith(file, 'replaced', file, {
      reencodes: false,
      regardlessOfPolicy: true,
    })
    expect(backup).toEqual({ id: 'b1' })
  }, 60000)

  // The Originals budget can refuse a file. Writing anyway would leave a change with no
  // way back, while the review promises a backup of every file it touches.
  it('leaves the file untouched and fails when the backup was refused', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const before = snapshotTags(file)
    const track = vi.fn()
    const untrack = vi.fn()
    configureOriginalKeeper(vi.fn().mockResolvedValue(null))
    await expect(
      rewriteTagFields(file, [{ field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }], {
        track,
        untrack,
      }),
    ).rejects.toThrow('SURCO_ERR:noBackup')
    expect(snapshotTags(file)).toEqual(before)
    expect(untrack).toHaveBeenCalledWith(track.mock.calls[0][0])
    expect(existsSync(track.mock.calls[0][0])).toBe(false)
  }, 60000)

  // Electron hands the renderer only the message, so the refusal travels as a key the review
  // can say in the DJ's language instead of a bare "no-backup".
  it('refuses with a translatable key when the backup taken before Music was refused', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    configureOriginalKeeper(vi.fn().mockResolvedValue(null))
    await expect(prepareTagRewrite(file)).rejects.toThrow('SURCO_ERR:noBackup')
  }, 60000)

  // The review's Undo restores these copies, so "Never" in Settings cannot be allowed to
  // turn a review fix into a write with no way back, nor into a refusal to write at all.
  it('still writes the fix with a backup when the setting says never', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    configureOriginalKeeper(
      policyKeeper(
        () => 'never',
        async (path, reason) => ({
          id: 'kept',
          name: 'x',
          originalPath: path,
          storedPath: '',
          bytes: 0,
          trashedAt: 0,
          reason,
        }),
      ),
    )
    const { outcomes, backup } = await rewriteTagFields(file, [
      { field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(outcomes).toEqual(['written'])
    expect(backup?.id).toBe('kept')
    expect(snapshotTags(file).join('\n')).toContain('DJ Lara')
  }, 60000)
})

// A damaged genre is repaired through the same copy, check, backup and rename as any review
// fix, so Undo can hand back the file exactly as the scan found it.
describe('rewriteTagFields with the raw genre frame job', () => {
  it('backs up the damaged file before writing the genre back', async () => {
    const file = join(dir, `damaged-${Math.random().toString(36).slice(2)}.mp3`)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=1',
      '-id3v2_version',
      '3',
      '-metadata',
      'genre=House; Deep House',
      file,
    ])
    Id3v2Settings.useNonStandardV2V3GenreSeparators = true
    const f = TagFile.createFromPath(file)
    try {
      void f.tag.genres
      f.tag.comment = 'cue pass'
      f.save()
    } finally {
      f.dispose()
      Id3v2Settings.useNonStandardV2V3GenreSeparators = false
    }
    const damagedBytes = readFileSync(file)
    let kept: Buffer | null = null
    configureOriginalKeeper(async (path) => {
      kept = readFileSync(path)
      return { id: 'b1' } as never
    })
    const { outcomes, backup } = await rewriteTagFields(
      file,
      [{ field: 'genre', from: '(35) Deep House', to: 'House; Deep House' }],
      undefined,
      undefined,
      'setGenreFrame',
    )
    expect(outcomes).toEqual(['written'])
    expect(backup).toEqual({ id: 'b1' })
    expect(kept).toEqual(damagedBytes)
    expect(readGenreFrame(file)?.raw).toBe('House; Deep House')
  }, 60000)
})

// A file converted with the old MP3 calibration keeps its own Traktor cues off by what the
// rule missed. Only the tree moves, through the same copy, check, backup and rename.
describe('rewriteCueTree', () => {
  const tree = buildTraktorTree([
    traktorCue('Intro', 0, 10000, 0),
    traktorCue('Break', 0, 15000, 1),
  ])
  const starts = (file: string) =>
    readTraktorMarkers(readCueTree(file) ?? new Uint8Array()).map((m) => m.startMs)

  function wavWithTree(): string {
    const file = join(dir, `tree-${Math.random().toString(36).slice(2)}.wav`)
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=20', file])
    injectWavPriv(file, tree)
    return file
  }

  function flacWithTree(): string {
    const file = join(dir, `tree-${Math.random().toString(36).slice(2)}.flac`)
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=20',
      '-metadata',
      `TRAKTOR4=${encodeBase91(tree)}`,
      file,
    ])
    return file
  }

  it.each([
    ['wav', wavWithTree],
    ['flac', flacWithTree],
  ])(
    'moves every cue of a %s by the ms it missed and keeps the old tree in the backup',
    async (_ext, make) => {
      const file = make()
      const md5 = audioMd5(file)
      const old = storedTree(file)
      let kept: Uint8Array | null = null
      configureOriginalKeeper(async (path) => {
        kept = storedTree(path)
        return { id: 'b1' } as never
      })
      const { written, backup } = await rewriteCueTree(file, -51.18, [10000, 15000])
      expect(written).toBe(true)
      expect(backup).toEqual({ id: 'b1' })
      expect(starts(file).map((ms) => ms.toFixed(2))).toEqual(['9948.82', '14948.82'])
      expect(kept).toEqual(old)
      expect(audioMd5(file)).toBe(md5)
    },
    60000,
  )

  it('writes nothing to a file with no tree', async () => {
    const file = join(dir, `bare-${Math.random().toString(36).slice(2)}.wav`)
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=2', file])
    const keeper = vi.fn()
    configureOriginalKeeper(keeper)
    expect(await rewriteCueTree(file, -51.18, [10000])).toEqual({ written: false })
    expect(keeper).not.toHaveBeenCalled()
  }, 60000)

  it('writes nothing when the tree is no longer what the scan read', async () => {
    const file = wavWithTree()
    const before = readFileSync(file)
    configureOriginalKeeper(vi.fn())
    expect(await rewriteCueTree(file, -51.18, [9948.82, 14948.82])).toEqual({ written: false })
    expect(readFileSync(file)).toEqual(before)
  }, 60000)
})

// Measured against the real app on 30/10: Music rewrites its own copy of the file the
// moment a tag is set on the entry, before Surco has written or backed up anything.
describe('the library review against a Music that rewrites the file', () => {
  function musicThatRewrites(file: string) {
    return async (_pid: string, _field: string, _from: string, to: string) => {
      const f = TagFile.createFromPath(file)
      try {
        f.tag.performers = [to]
        f.save()
      } finally {
        f.dispose()
      }
      return 'set' as const
    }
  }

  function copyingKeeper() {
    const stored = new Map<string, Buffer>()
    configureOriginalKeeper(async (path, reason) => {
      const id = `b${stored.size + 1}`
      stored.set(id, readFileSync(path))
      return { id, name: id, originalPath: path, storedPath: '', bytes: 0, trashedAt: 0, reason }
    })
    configureBackupDiscarder(async (entry) => {
      stored.delete(entry.id)
    })
    return stored
  }

  it('backs up the original bytes, so Undo has the file as it was', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Dj Lara')
    const original = readFileSync(file)
    const stored = copyingKeeper()
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: musicThatRewrites(file),
        locate: async () => file,
        exists: async () => true,
        prepare: (path) => prepareTagRewrite(path),
      },
    )
    expect(out.backupId).toBeDefined()
    expect(stored.get(out.backupId ?? '')?.equals(original)).toBe(true)
  }, 60000)

  it('leaves no copy and no backup behind when the fix is abandoned', async () => {
    const file = make('mp3', ['-c:a', 'libmp3lame'], 'Dj Lara')
    const before = snapshotTags(file)
    const discarded = vi.fn().mockResolvedValue(undefined)
    configureBackupDiscarder(discarded)
    configureOriginalKeeper(vi.fn().mockResolvedValue({ id: 'b1' }))
    const track = vi.fn()
    const untrack = vi.fn()
    const prepared = await prepareTagRewrite(file, { track, untrack })
    await prepared.abandon()
    expect(discarded).toHaveBeenCalledWith({ id: 'b1' })
    expect(existsSync(track.mock.calls[0][0])).toBe(false)
    expect(untrack).toHaveBeenCalledWith(track.mock.calls[0][0])
    expect(snapshotTags(file)).toEqual(before)
    configureBackupDiscarder(null)
  }, 60000)

  // Music has already changed the file, so the copy is the only way back to it.
  it('keeps the backup when its own write fails after Music changed the file', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Dj Lara')
    const original = readFileSync(file)
    const stored = copyingKeeper()
    const temps: string[] = []
    const music = musicThatRewrites(file)
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: async (pid, field, from, to) => {
          writeFileSync(temps[0], 'not audio')
          return music(pid, field, from, to)
        },
        locate: async () => file,
        exists: async () => true,
        prepare: (path) =>
          prepareTagRewrite(path, { track: (tmp) => temps.push(tmp), untrack: () => {} }),
      },
    )
    expect(out.file).toBe('failed')
    expect(stored.get(out.backupId ?? '')?.equals(original)).toBe(true)
  }, 60000)

  // A file that held another value than Music is left alone by Surco, but Music has
  // rewritten it all the same: it carries the fix now, and the libraries follow it.
  it('keeps the backup and reports written when Music changed a file that held another value', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Someone Else')
    const original = readFileSync(file)
    const stored = copyingKeeper()
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: musicThatRewrites(file),
        locate: async () => file,
        exists: async () => true,
        prepare: (path) => prepareTagRewrite(path),
      },
    )
    expect(out).toMatchObject({ file: 'written', written: ['artist'] })
    expect(stored.get(out.backupId ?? '')?.equals(original)).toBe(true)
  }, 60000)

  // A case-only fix keeps the size, and HFS+ or FAT round the mtime to a second or two, so
  // neither tells whether Music has written yet. Music accepting the field is what does.
  it('keeps the backup once Music accepted, though size and mtime look untouched', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Dj Lara')
    const second = 1_700_000_000
    utimesSync(file, second, second)
    const original = readFileSync(file)
    const stored = copyingKeeper()
    const temps: string[] = []
    const music = musicThatRewrites(file)
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: async (pid, field, from, to) => {
          writeFileSync(temps[0], 'not audio')
          const answer = await music(pid, field, from, to)
          utimesSync(file, second, second)
          return answer
        },
        locate: async () => file,
        exists: async () => true,
        prepare: (path) =>
          prepareTagRewrite(path, { track: (tmp) => temps.push(tmp), untrack: () => {} }),
      },
    )
    expect(statSync(file).size).toBe(original.length)
    expect(out.file).toBe('failed')
    expect(stored.get(out.backupId ?? '')?.equals(original)).toBe(true)
  }, 60000)

  it('reports unchanged when what Music wrote is not the fix', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Someone Else')
    copyingKeeper()
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: async () => {
          const f = TagFile.createFromPath(file)
          try {
            f.tag.genres = ['House']
            f.save()
          } finally {
            f.dispose()
          }
          return 'set'
        },
        locate: async () => file,
        exists: async () => true,
        prepare: (path) => prepareTagRewrite(path),
      },
    )
    expect(out).toMatchObject({ file: 'unchanged', written: [] })
  }, 60000)

  it('keeps the backup when Music wrote the file and then did not answer', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Dj Lara')
    const original = readFileSync(file)
    const stored = copyingKeeper()
    const music = musicThatRewrites(file)
    const temps: string[] = []
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: async (pid, field, from, to) => {
          await music(pid, field, from, to)
          throw new Error('AppleEvent timed out (-1712)')
        },
        locate: async () => file,
        exists: async () => true,
        prepare: (path) =>
          prepareTagRewrite(path, { track: (tmp) => temps.push(tmp), untrack: () => {} }),
      },
    )
    expect(stored.get(out.backupId ?? '')?.equals(original)).toBe(true)
    expect(existsSync(temps[0])).toBe(false)
  }, 60000)

  // Music rewrote the file as it took the field, whatever Surco's own write did after: Engine
  // DJ is told the size from before Music, once the file is as it stays.
  it.each([
    ['Surco wrote the fix', 'Dj Lara', false],
    ['the file held another value', 'Someone Else', false],
    ['Music did not answer', 'Dj Lara', true],
  ])(
    'tells Engine DJ the size from before Music when %s',
    async (_, artist, silent) => {
      const file = make('aiff', ['-c:a', 'pcm_s16be'], artist)
      const size = statSync(file).size
      copyingKeeper()
      const music = musicThatRewrites(file)
      const rewritten = vi.fn()
      await applyMusicFixes(
        [
          {
            persistentId: 'A',
            field: 'artist',
            from: 'Dj Lara',
            to: `DJ Lara ${'and The Long Band '.repeat(200)}`,
          },
        ],
        {
          setField: async (pid, field, from, to) => {
            const answer = await music(pid, field, from, to)
            if (silent) throw new Error('AppleEvent timed out (-1712)')
            return answer
          },
          locate: async () => file,
          exists: async () => true,
          prepare: (path) => prepareTagRewrite(path, undefined, rewritten),
        },
      )
      expect(statSync(file).size).not.toBe(size)
      expect(rewritten).toHaveBeenCalledTimes(1)
      expect(rewritten).toHaveBeenCalledWith(file, size)
    },
    60000,
  )

  it('tells Engine DJ nothing when Music refused the fix', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Dj Lara')
    copyingKeeper()
    const rewritten = vi.fn()
    await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: async () => 'mismatch',
        locate: async () => file,
        exists: async () => true,
        prepare: (path) => prepareTagRewrite(path, undefined, rewritten),
      },
    )
    expect(rewritten).not.toHaveBeenCalled()
  }, 60000)

  it('reports the field as written, not as a file that differs', async () => {
    const file = make('aiff', ['-c:a', 'pcm_s16be'], 'Dj Lara')
    copyingKeeper()
    const [out] = await applyMusicFixes(
      [{ persistentId: 'A', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      {
        setField: musicThatRewrites(file),
        locate: async () => file,
        exists: async () => true,
        prepare: (path) => prepareTagRewrite(path),
      },
    )
    expect(out).toMatchObject({ file: 'written', written: ['artist'] })
    expect(snapshotTags(file).join('\n')).toContain('DJ Lara')
  }, 60000)
})
