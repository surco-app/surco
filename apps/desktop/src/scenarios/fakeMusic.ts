import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  ByteVector,
  Id3v2FrameIdentifier,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  Picture,
  PictureType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { vi } from 'vitest'
import type { MusicEntryFacts, MusicSetResult } from '../main/applemusic'
import { coverThumbUrlForBytes } from '../main/coverThumbs'
import { errorWithKey } from '../shared/errorKeys'
import type { MusicReviewField, TrackMetadata } from '../shared/types'

type AppleMusic = typeof import('../main/applemusic')
type Playlists = typeof import('../main/appleMusicPlaylists')
type Artwork = typeof import('../main/appleMusicArtwork')
type Run = AppleMusic['runOsascript']

export interface MusicEntry {
  persistentId: string
  location: string | null
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  grouping: string
  comment: string
  year: number
  trackNumber: number
  discNumber: number
  bpm: number
  rating: number
  ratingKind: 'user' | 'computed'
  durationSec: number
  dateAdded: string
  artwork?: Buffer
}

export interface MusicPlaylist {
  persistentId: string
  name: string
  folder?: string
  smart: boolean
  entries: string[]
}

export type SeedEntry = Partial<Omit<MusicEntry, 'artwork'>> & { artwork?: string }
export type SeedPlaylist = Partial<MusicPlaylist> & { name: string }

const RS = '\u001e'
const FS = '\u001f'
const TAHOE_NO_ADD =
  'execution error: Música no importó el archivo y no dio ningún error: es un fallo conocido de macOS 26 (Tahoe). Reinicia la app Música (o el Mac) y vuelve a intentarlo. (-2700)'
const REVEAL_GONE = 'execution error: La pista ya no está en tu biblioteca de Apple Music. (-2700)'

function freshState() {
  return {
    entries: [] as MusicEntry[],
    playlists: [] as MusicPlaylist[],
    running: true,
    mediaFolder: null as string | null,
    changeNextLocationsRead: false,
    nextId: 0,
    added: [] as { path: string; meta: TrackMetadata; coverPath?: string; persistentId: string }[],
    updated: [] as { persistentId: string; meta: TrackMetadata; coverPath?: string }[],
    deleted: [] as { persistentId: string; location: string }[],
    transfers: [] as { from: string; to: string; answer: string }[],
    fieldsSet: [] as { persistentId: string; field: MusicReviewField; from: string; to: string }[],
    revealed: [] as string[],
  }
}

function newId(): string {
  state.nextId += 1
  return (0xa000 + state.nextId).toString(16).toUpperCase().padStart(16, '0')
}

let state = freshState()

export const music = {
  get state() {
    return state
  },
  reset() {
    state = freshState()
  },
  addEntry(seed: SeedEntry): MusicEntry {
    const { artwork, ...fields } = seed
    const entry: MusicEntry = {
      persistentId: newId(),
      location: null,
      title: '',
      artist: '',
      albumArtist: '',
      album: '',
      genre: '',
      grouping: '',
      comment: '',
      year: 0,
      trackNumber: 0,
      discNumber: 0,
      bpm: 0,
      rating: 0,
      ratingKind: 'computed',
      durationSec: 0,
      dateAdded: secondsOnly(new Date()),
      ...fields,
      ...(artwork && { artwork: readFileSync(artwork) }),
    }
    state.entries.push(entry)
    return entry
  },
  addPlaylist(seed: SeedPlaylist): MusicPlaylist {
    const playlist: MusicPlaylist = { persistentId: newId(), smart: false, entries: [], ...seed }
    state.playlists.push(playlist)
    return playlist
  },
  entry(persistentId: string): MusicEntry | undefined {
    return state.entries.find((e) => e.persistentId === persistentId)
  },
  playlist(persistentId: string): MusicPlaylist | undefined {
    return state.playlists.find((p) => p.persistentId === persistentId)
  },
  add(filePath: string, meta: TrackMetadata): string {
    const entry = importFile(filePath, meta)
    retag(entry, meta, false)
    return entry.persistentId
  },
  tag(persistentId: string, fields: Partial<Pick<MusicEntry, 'grouping'>>): void {
    const entry = live(persistentId)
    if (!entry) throw new Error(`scenario: no Music entry ${persistentId}`)
    Object.assign(entry, fields)
    rewriteFile(entry)
  },
}

const isWav = (path: string) => extname(path).toLowerCase() === '.wav'
const sameTags = (a: MusicEntry, b: Pick<MusicEntry, 'title' | 'artist' | 'album'>) =>
  sameIgnoringCase(a.title, b.title) &&
  sameIgnoringCase(a.artist, b.artist) &&
  sameIgnoringCase(a.album, b.album)

function importFile(filePath: string, meta: TrackMetadata): MusicEntry {
  if (!existsSync(filePath) || filePath.toLowerCase().endsWith('.flac'))
    throw new Error(TAHOE_NO_ADD)
  const read = isWav(filePath)
    ? { title: basename(filePath, extname(filePath)), artist: '', album: '' }
    : { title: meta.title, artist: meta.artist, album: meta.album }
  const existing = fileTracks().find((e) => sameTags(e, read))
  if (existing) return existing
  const entry = music.addEntry({ location: landing(filePath) })
  if (isWav(filePath)) entry.title = read.title
  else writeTags(entry, meta, false)
  return entry
}

function landing(filePath: string): string {
  const media = state.mediaFolder
  if (!media || filePath.normalize('NFC').startsWith(`${media.normalize('NFC')}/`)) return filePath
  const folder = isWav(filePath) ? join(media, 'Music', 'Unknown Artist', 'Unknown Album') : media
  mkdirSync(folder, { recursive: true })
  const location = join(folder, basename(filePath))
  copyFileSync(filePath, location)
  return location
}

const GRP1 = new Id3v2FrameIdentifier('GRP1', 'GRP1', 'GP1')
const ID3_FILES = new Set(['.mp3', '.aiff', '.aif'])

function rewriteFile(entry: MusicEntry): void {
  const path = fileOf(entry)
  if (!path || isWav(path)) return
  const file = TagFile.createFromPath(path)
  try {
    const id3 = ID3_FILES.has(extname(path).toLowerCase())
    const tag = id3 ? (file.getTag(TagTypes.Id3v2, true) as Id3v2Tag) : file.tag
    tag.title = entry.title
    tag.performers = entry.artist ? [entry.artist] : []
    tag.albumArtists = entry.albumArtist ? [entry.albumArtist] : []
    tag.album = entry.album
    tag.genres = entry.genre ? [entry.genre] : []
    tag.comment = entry.comment
    tag.year = entry.year
    tag.track = entry.trackNumber
    tag.disc = entry.discNumber
    tag.beatsPerMinute = entry.bpm
    if (id3) {
      const frames = tag as Id3v2Tag
      for (const fr of frames.frames.filter((f) => f.frameId.toString() === 'GRP1'))
        frames.removeFrame(fr)
      if (entry.grouping) {
        const grp1 = Id3v2TextInformationFrame.fromIdentifier(GRP1)
        grp1.text = [entry.grouping]
        frames.addFrame(grp1)
      }
    } else tag.grouping = entry.grouping
    if (entry.artwork) {
      const picture = Picture.fromData(ByteVector.fromByteArray(entry.artwork))
      picture.type = PictureType.FrontCover
      tag.pictures = [picture]
    }
    file.save()
  } finally {
    file.dispose()
  }
}

function retag(entry: MusicEntry, meta: TrackMetadata, clear: boolean, coverPath?: string) {
  writeTags(entry, meta, clear, coverPath)
  rewriteFile(entry)
}

function entryFacts(
  persistentId: string,
  oldPersistentId?: string,
  withPlaylists = false,
): MusicEntryFacts | 'missing' {
  const entry = live(persistentId)
  if (!entry) return 'missing'
  const facts: MusicEntryFacts = {
    location: fileOf(entry),
    name: entry.title,
    artist: entry.artist,
    album: entry.album,
    artworks: entry.artwork ? 1 : 0,
    playlists: withPlaylists
      ? state.playlists
          .filter((p) => !p.smart && p.entries.includes(persistentId))
          .map((p) => p.name)
      : [],
  }
  if (oldPersistentId !== undefined) facts.oldExists = live(oldPersistentId) !== undefined
  return facts
}

function secondsOnly(date: Date): string {
  date.setMilliseconds(0)
  return date.toISOString()
}

function fileOf(entry: MusicEntry): string {
  return entry.location !== null && existsSync(entry.location) ? entry.location : ''
}

const fileTracks = () => state.entries.filter((e) => e.location !== null)
const label = (e: MusicEntry) => `${e.artist} - ${e.title}`
const sameIgnoringCase = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')
const printed = (rows: string[], separator: string) => `${rows.join(separator)}\n`

function wallClock(iso: string): string {
  const d = new Date(iso)
  const secs =
    (Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
    ) -
      Date.UTC(2001, 0, 1)) /
    1000
  return `${Math.floor(secs / 86400)}:${secs % 86400}`
}

function number(value: string): number {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function libraryDump(): string {
  if (state.entries.length === 0) return '\n'
  return printed(
    state.entries.map((e) => [e.title, e.artist, String(e.durationSec), e.persistentId].join('\t')),
    '\n',
  )
}

function reviewDump(): string {
  const tracks = fileTracks()
  if (tracks.length === 0) return '\n'
  return printed(
    tracks.map((e) =>
      [
        e.persistentId,
        e.title,
        e.artist,
        e.albumArtist,
        e.album,
        e.genre,
        String(e.durationSec),
        wallClock(e.dateAdded),
      ].join(FS),
    ),
    RS,
  )
}

function fileNames(): string {
  const tracks = fileTracks()
  if (tracks.length === 0) return '\n'
  return printed(
    tracks.map((e) => [e.persistentId, e.artist, e.title, wallClock(e.dateAdded)].join(FS)),
    RS,
  )
}

function fileLocations(wanted?: string[]): string {
  return printed(
    fileTracks()
      .filter((e) => fileOf(e) && (!wanted || wanted.includes(e.persistentId)))
      .map((e) => `${e.persistentId}${FS}${fileOf(e)}`),
    RS,
  )
}

function trackRows(entries: MusicEntry[]): string {
  return printed(
    entries.map((e) =>
      [
        fileOf(e),
        e.persistentId,
        e.grouping,
        String(e.year),
        e.comment,
        String(e.trackNumber),
        String(e.discNumber),
        String(e.bpm),
        String(e.rating),
        e.ratingKind,
      ].join(FS),
    ),
    RS,
  )
}

function osascript(real: AppleMusic): Run {
  return async (script) => {
    if (script === real.buildMusicRunningScript()) return `${state.running}\n`
    state.running = true
    if (script === real.buildFileNamesScript()) return fileNames()
    if (script === real.buildFileLocationsAllScript()) {
      if (!state.changeNextLocationsRead) return fileLocations()
      state.changeNextLocationsRead = false
      return 'changed\n'
    }
    const wanted = /^set wanted to \{(.*)\}\n/.exec(script)
    const ids: string[] = wanted ? JSON.parse(`[${wanted[1]}]`) : []
    if (wanted && script === real.buildFileLocationsScript(ids)) return fileLocations(ids)
    throw new Error(`scenario: unexpected osascript\n${script}`)
  }
}

function writeTags(entry: MusicEntry, meta: TrackMetadata, clear: boolean, coverPath?: string) {
  const text = clear ? (v: string) => v.trim() : (v: string) => v
  const textFields = [
    'title',
    'artist',
    'albumArtist',
    'album',
    'genre',
    'grouping',
    'comment',
  ] as const
  for (const field of textFields) {
    if (clear || meta[field].trim()) entry[field] = text(meta[field])
  }
  for (const field of ['year', 'trackNumber', 'discNumber', 'bpm'] as const) {
    const n = number(meta[field])
    if (clear || n > 0) entry[field] = n
  }
  if (coverPath?.trim()) entry.artwork = readFileSync(coverPath)
}

function live(persistentId: string): MusicEntry | undefined {
  return music.entry(persistentId)
}

export function appleMusicModule(real: AppleMusic): AppleMusic {
  const run = osascript(real)
  return {
    ...real,
    runOsascript: async (script) => {
      throw new Error(`scenario: unexpected osascript\n${script}`)
    },
    addToAppleMusic: async (filePath, meta, coverPath) => {
      const name = basename(filePath, extname(filePath))
      const preexisting = state.entries
        .filter(
          (e) =>
            (sameIgnoringCase(e.title, meta.title) && sameIgnoringCase(e.artist, meta.artist)) ||
            sameIgnoringCase(e.title, name),
        )
        .map((e) => e.persistentId)
      const entry = importFile(filePath, meta)
      if (preexisting.includes(entry.persistentId))
        throw errorWithKey('appleMusicAddReturnedOld', filePath)
      retag(entry, meta, false, coverPath)
      state.added.push({ path: filePath, meta, coverPath, persistentId: entry.persistentId })
      return entry.persistentId
    },
    updateInAppleMusic: async (persistentId, meta, coverPath) => {
      const entry = live(persistentId)
      if (!entry) return null
      retag(entry, meta, true, coverPath)
      state.updated.push({ persistentId, meta, coverPath })
      return entry.persistentId
    },
    appleMusicEntryLocation: async (persistentId) => {
      const entry = live(persistentId)
      return entry ? fileOf(entry) : ''
    },
    appleMusicEntry: async (persistentId) => {
      const entry = live(persistentId)
      return entry ? { label: label(entry), path: fileOf(entry) } : { label: '', path: '' }
    },
    appleMusicMediaFolder: async () => state.mediaFolder ?? undefined,
    readMusicEntryFacts: async (persistentId, oldPersistentId, options) =>
      entryFacts(persistentId, oldPersistentId, options?.withPlaylists),
    markAppleMusicReplacing: async (persistentId, expectedLabel, marked) => {
      const entry = live(persistentId)
      if (!entry) return 'missing'
      const mark = real.REPLACING_MARK
      if (!sameIgnoringCase(label(entry), marked ? expectedLabel : `${expectedLabel}${mark}`))
        return 'mismatch'
      entry.title = marked ? `${entry.title}${mark}` : entry.title.slice(0, -mark.length)
      return 'set'
    },
    revealInAppleMusic: async (persistentId) => {
      if (!live(persistentId)) throw new Error(REVEAL_GONE)
      state.revealed.push(persistentId)
    },
    deleteFromAppleMusic: async (persistentId, expectedLabel, location) => {
      const entry = live(persistentId)
      if (!entry) return null
      if (!sameIgnoringCase(label(entry), expectedLabel))
        throw new Error('applemusic-delete-mismatch')
      const loc = fileOf(entry)
      if (location !== undefined && !same(loc, location))
        throw new Error('applemusic-delete-mismatch')
      state.entries = state.entries.filter((e) => e !== entry)
      for (const p of state.playlists) p.entries = p.entries.filter((id) => id !== persistentId)
      state.deleted.push({ persistentId, location: loc })
      return loc
    },
    transferPlaylists: async (fromPid, toPid, expectedLabel, keepLabel, locations) => {
      const answer = transfer(fromPid, toPid, expectedLabel, keepLabel, locations)
      state.transfers.push({ from: fromPid, to: toPid, answer })
      return answer
    },
    carryOverToAppleMusicCopy: async (fromPid, toPid, expectedLabel) => {
      const src = live(fromPid)
      const dst = live(toPid)
      if (!src) return 'missing'
      if (!sameIgnoringCase(label(src), expectedLabel)) return 'mismatch'
      if (!dst) throw new Error('Can’t get item 1 of {}. (-1728)')
      if (src.ratingKind === 'user') Object.assign(dst, { rating: src.rating, ratingKind: 'user' })
      for (const p of state.playlists)
        if (!p.smart && p.entries.includes(fromPid) && !p.entries.includes(toPid))
          p.entries.push(toPid)
      return 'carried'
    },
    dumpAppleMusicLibrary: async () => real.parseLibraryDump(libraryDump()),
    dumpMusicReview: async () => real.parseReviewDump(reviewDump()),
    musicFileEntries: (candidates, launch, _run, keyOf) =>
      real.musicFileEntries(candidates, launch, run, keyOf),
    musicFileLocations: () => real.musicFileLocations(run),
    setAppleMusicField: async (
      persistentId,
      field,
      from,
      to,
      location,
    ): Promise<MusicSetResult> => {
      const entry = live(persistentId)
      if (!entry) return 'missing'
      if (location !== undefined && !same(fileOf(entry), location)) return 'mismatch'
      if (!same(entry[field], from)) return 'mismatch'
      entry[field] = to
      rewriteFile(entry)
      state.fieldsSet.push({ persistentId, field, from, to })
      return 'set'
    },
  }
}

function transfer(
  fromPid: string,
  toPid: string,
  expectedLabel: string,
  keepLabel: string,
  locations?: { from: string; to: string },
): string {
  const src = live(fromPid)
  const dst = live(toPid)
  if (!src || !dst) return 'missing'
  if (!sameIgnoringCase(label(src), expectedLabel)) return 'mismatch'
  if (!sameIgnoringCase(label(dst), keepLabel)) return 'mismatch'
  if (locations && (!same(fileOf(src), locations.from) || !same(fileOf(dst), locations.to)))
    return 'mismatch'
  let moved = 0
  for (const p of state.playlists) {
    if (p.smart || !p.entries.includes(fromPid) || p.entries.includes(toPid)) continue
    p.entries.push(toPid)
    moved += 1
  }
  return `${moved}\t0`
}

export async function playlistsModule(): Promise<Playlists> {
  const real = await vi.importActual<Playlists>('../main/appleMusicPlaylists')
  const entriesOf = (ids: string[]) => ids.flatMap((id) => live(id) ?? [])
  return {
    ...real,
    dumpAppleMusicPlaylists: async () =>
      real.parsePlaylistDump(
        state.playlists.length === 0
          ? '\n'
          : printed(
              state.playlists.map((p) =>
                [p.name, String(p.entries.length), p.persistentId, p.folder ?? ''].join('\t'),
              ),
              '\n',
            ),
      ),
    readAppleMusicPlaylist: async (persistentId) => {
      const playlist = music.playlist(persistentId)
      const tracks = playlist ? entriesOf(playlist.entries) : []
      return real.parsePlaylistTracks(tracks.length === 0 ? '\n' : trackRows(tracks))
    },
    readAppleMusicEntry: async (path, persistentIds) =>
      real.entryForFile(real.parsePlaylistTracks(trackRows(entriesOf(persistentIds))), path),
  }
}

export function artworkModule(real: Artwork): Artwork {
  return {
    ...real,
    fetchAppleMusicArtwork: async (jobs) => {
      for (const { persistentId, outPath } of jobs) {
        const artwork = live(persistentId)?.artwork
        if (artwork) await writeFile(outPath, artwork).catch(() => {})
      }
      const landed = await Promise.all(
        jobs.map(async ({ outPath }) => {
          try {
            if ((await stat(outPath)).size === 0) return null
            return { path: outPath, url: await coverThumbUrlForBytes(await readFile(outPath)) }
          } catch {
            return null
          }
        }),
      )
      return landed.filter((cover): cover is { path: string; url: string } => cover !== null)
    },
  }
}
