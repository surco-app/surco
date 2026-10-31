import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { type Id3v2Tag, type Id3v2UnknownFrame, File as TagFile, TagTypes } from 'node-taglib-sharp'
import { expect } from 'vitest'
import { id3TextOf } from '../main/tags'
import { emptyMetadata } from '../shared/metadata'
import type { TrackMetadata } from '../shared/types'
import { makeTrack } from './fixtures'

export interface MusicUnderTest {
  add: (path: string, meta: TrackMetadata) => Promise<string>
  markReplacing: (pid: string, label: string) => Promise<string>
  location: (pid: string) => Promise<string>
  tagGrouping: (pid: string, grouping: string) => Promise<void>
  tagArtist: (pid: string, artist: string) => Promise<void>
  relocate: (pid: string, path: string) => Promise<void>
  mediaFolder: () => Promise<string | null>
}

interface Song {
  meta: TrackMetadata
  label: string
  file: (folder: string, ext: string, grouping?: string) => string
}

function song(dir: string, name: string): Song {
  const prefix = basename(dir)
  const meta = {
    ...emptyMetadata(),
    title: `${prefix} ${name}`,
    artist: `${prefix} Artist`,
    album: `${prefix} Album`,
  }
  return {
    meta,
    label: `${meta.artist} - ${meta.title}`,
    file: (folder, ext, grouping) =>
      makeTrack(join(folder, `${meta.title}.${ext}`), {
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        grouping,
        signal: 'kick',
      }),
  }
}

async function mediaOf(m: MusicUnderTest): Promise<string> {
  const media = await m.mediaFolder()
  if (!media) throw new Error('Music copies nothing into a media folder here')
  return media
}

function artistOf(path: string): string {
  const file = TagFile.createFromPath(path)
  try {
    return file.tag.performers.join('/')
  } finally {
    file.dispose()
  }
}

const nfc = (p: string) => p.normalize('NFC')
const sha1 = (p: string) => createHash('sha1').update(readFileSync(p)).digest('hex')

function groupingFrames(path: string): { grp1: string | null; tit1: string } {
  const file = TagFile.createFromPath(path)
  try {
    const id3 = file.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const grp1 = id3?.frames.find((fr) => fr.frameId.toString() === 'GRP1')
    return {
      grp1: grp1 ? id3TextOf((grp1 as Id3v2UnknownFrame).data.toByteArray()) : null,
      tit1: id3?.grouping ?? '',
    }
  } finally {
    file.dispose()
  }
}

export const MUSIC_FACTS: {
  name: string
  check: (m: MusicUnderTest, dir: string) => Promise<void>
}[] = [
  {
    name: 'add of a same-named track in another format hands back the existing entry',
    check: async (m, dir) => {
      const s = song(dir, 'Dedupe')
      const wav = await m.add(s.file(dir, 'wav'), s.meta)
      expect(await m.add(s.file(dir, 'aiff'), s.meta)).toBe(wav)
    },
  },
  {
    name: 'marking the old entry replacing lets the add create a new one',
    check: async (m, dir) => {
      const s = song(dir, 'Marked')
      const wav = await m.add(s.file(dir, 'wav'), s.meta)
      expect(await m.markReplacing(wav, s.label)).toBe('set')
      expect(await m.add(s.file(dir, 'aiff'), s.meta)).not.toBe(wav)
    },
  },
  {
    name: 'a WAV copied into the media folder lands under Unknown Artist/Unknown Album',
    check: async (m, dir) => {
      const media = await mediaOf(m)
      const s = song(dir, 'Untagged')
      const pid = await m.add(s.file(dir, 'wav'), s.meta)
      expect(nfc(dirname(await m.location(pid)))).toBe(
        nfc(join(media, 'Music', 'Unknown Artist', 'Unknown Album')),
      )
    },
  },
  {
    name: 'a file already inside the media folder is added where it is',
    check: async (m, dir) => {
      const media = await mediaOf(m)
      const s = song(dir, 'Inside')
      const file = s.file(join(media, 'Music', basename(dir)), 'aiff')
      const pid = await m.add(file, s.meta)
      expect(nfc(await m.location(pid))).toBe(nfc(file))
    },
  },
  {
    name: "tagging rewrites Music's own copy",
    check: async (m, dir) => {
      await mediaOf(m)
      const s = song(dir, 'Retag')
      const source = s.file(dir, 'aiff')
      const sourceBefore = sha1(source)
      const pid = await m.add(source, s.meta)
      const copy = await m.location(pid)
      const copyBefore = sha1(copy)
      await m.tagGrouping(pid, 'Peak')
      expect(nfc(copy)).not.toBe(nfc(source))
      expect(sha1(copy)).not.toBe(copyBefore)
      expect(sha1(source)).toBe(sourceBefore)
    },
  },
  {
    name: 'editing grouping of an MP3 writes GRP1 and leaves TIT1',
    check: async (m, dir) => {
      const s = song(dir, 'Grouping')
      const pid = await m.add(s.file(dir, 'mp3', 'Warmup'), s.meta)
      await m.tagGrouping(pid, 'Peak')
      expect(groupingFrames(await m.location(pid))).toEqual({ grp1: 'Peak', tit1: 'Warmup' })
    },
  },
  {
    name: 'setting the artist of an entry whose file lives outside the media folder rewrites that file',
    check: async (m, dir) => {
      const s = song(dir, 'Outside')
      const pid = await m.add(s.file(dir, 'aiff'), s.meta)
      const outside = s.file(join(dir, 'outside'), 'aiff')
      await m.relocate(pid, outside)
      const before = sha1(outside)
      await m.tagArtist(pid, `${s.meta.artist} Retagged`)
      expect(nfc(await m.location(pid))).toBe(nfc(realpathSync(outside)))
      expect(sha1(outside)).not.toBe(before)
      expect(artistOf(outside)).toBe(`${s.meta.artist} Retagged`)
    },
  },
  {
    name: 'setting a tag on a WAV entry leaves the WAV file as it was',
    check: async (m, dir) => {
      const s = song(dir, 'Wave')
      const pid = await m.add(s.file(dir, 'wav'), s.meta)
      const file = await m.location(pid)
      const before = sha1(file)
      await m.tagArtist(pid, `${s.meta.artist} Retagged`)
      await m.tagGrouping(pid, 'Peak')
      expect(nfc(await m.location(pid))).toBe(nfc(file))
      expect(sha1(file)).toBe(before)
    },
  },
  {
    name: 'adding a WAV when a tagged AIFF of the same song exists creates a new entry',
    check: async (m, dir) => {
      const s = song(dir, 'Second')
      const aiff = await m.add(s.file(dir, 'aiff'), s.meta)
      const wav = await m.add(s.file(dir, 'wav'), s.meta)
      expect(wav).not.toBe(aiff)
      expect(await m.location(wav)).toMatch(/\.wav$/i)
      expect(await m.location(aiff)).toMatch(/\.aiff?$/i)
    },
  },
]
