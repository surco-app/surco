import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2PrivateFrame,
  type Id3v2Tag,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { rewriteTagFields } from './musicFieldWrite'
import { configureOriginalKeeper } from './originalKeeper'
import { diffSnapshots, snapshotTags } from './tagSnapshot'

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

afterEach(() => configureOriginalKeeper(null))

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
    expect(keeper).toHaveBeenCalledWith(file, 'replaced', file, { reencodes: false })
    expect(backup).toEqual({ id: 'b1' })
  }, 60000)
})
