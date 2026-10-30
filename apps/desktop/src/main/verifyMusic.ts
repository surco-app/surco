import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { extname } from 'node:path'
import type { TrackMetadata } from '../shared/types'
import type { PlaceCheck } from '../shared/verification'
import { appleMusicLimiter, musicFileEntries, readMusicEntryFacts } from './applemusic'
import { pathAliasesOf, pathKey } from './libraryPathKey'
import { formatOf } from './verifyFile'

export interface MusicExpect {
  pid: string
  file: string
  ext: string
  meta: Pick<TrackMetadata, 'title' | 'artist' | 'album'>
  coverSet: boolean
  // null when the old entry's playlists could not be read before the add.
  replaced?: { oldPid: string; playlistsBefore: string[] | null }
}

export interface MusicReaders {
  entry: typeof readMusicEntryFacts
  // Persistent IDs of every entry playing the file, under any spelling of its path.
  // Rejects when Music could not be asked.
  entriesForFile: (path: string, titles: string[]) => Promise<string[]>
  realPath: (p: string) => string
  wait: (ms: number) => Promise<void>
}

export const musicReaders: MusicReaders = {
  entry: readMusicEntryFacts,
  async entriesForFile(path, titles) {
    const spellings = await pathAliasesOf([path], { realPath: (p) => realpath(p) })
    const { consulted, entries } = await appleMusicLimiter.run(() =>
      musicFileEntries(
        spellings.flatMap((p) => titles.map((title) => ({ path: p, title }))),
        true,
      ),
    )
    if (!consulted) throw new Error('Music could not say which entries play the file')
    return [...new Set(spellings.flatMap((p) => (entries[p] ?? []).map((e) => e.persistentId)))]
  },
  realPath: (p) => realpathSync(p),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

// Music fills the location of a fresh add asynchronously.
const EMPTY_LOCATION_WAITS_MS = [1000, 2000, 4000]

const check = (
  state: PlaceCheck['state'],
  key: string,
  params?: Record<string, string | number>,
): PlaceCheck => ({ place: 'appleMusic', state, detail: params ? { key, params } : { key } })

const nameKey = (text: string) => text.normalize('NFC').trim().toLowerCase()

const TAG_FIELDS = [
  ['title', 'name'],
  ['artist', 'artist'],
  ['album', 'album'],
] as const

export async function checkAppleMusic(e: MusicExpect, r: MusicReaders): Promise<PlaceCheck> {
  try {
    return await judge(e, r)
  } catch {
    return check('unreadable', 'musicUnreadable')
  }
}

async function judge(e: MusicExpect, r: MusicReaders): Promise<PlaceCheck> {
  const read = () => r.entry(e.pid, e.replaced?.oldPid, { withPlaylists: e.replaced !== undefined })
  let facts = await read()
  for (const ms of EMPTY_LOCATION_WAITS_MS) {
    if (facts === 'missing' || facts.location !== '') break
    await r.wait(ms)
    facts = await read()
  }
  if (facts === 'missing') return check('mismatch', 'musicMissing')
  if (facts.location === null) return check('unreadable', 'musicUnreadable')
  if (facts.location === '') return check('mismatch', 'musicNoFile')

  const key = pathKey({ realPath: r.realPath })
  const same = (a: string, b: string) =>
    key(a.normalize('NFC')).normalize('NFC') === key(b.normalize('NFC')).normalize('NFC')
  if (!same(facts.location, e.file)) {
    const ext = extname(facts.location).toLowerCase()
    return ext === e.ext.toLowerCase()
      ? check('mismatch', 'musicOtherFile')
      : check('mismatch', 'musicWrongFile', { format: formatOf(ext) })
  }

  if (facts.oldExists === true) return check('mismatch', 'musicDuplicate', { count: 2 })
  const titles = [facts.name, e.meta.title].filter((t) => t.trim() !== '')
  const pids = await r.entriesForFile(e.file, [...new Set(titles)])
  if (!pids.includes(e.pid)) return check('unreadable', 'musicUnreadable')
  if (pids.length > 1) return check('mismatch', 'musicDuplicate', { count: pids.length })

  for (const [field, stored] of TAG_FIELDS) {
    const want = e.meta[field]
    if (nameKey(want) !== '' && nameKey(want) !== nameKey(facts[stored]))
      return check('mismatch', 'musicTagDiffers', { field })
  }
  if (e.coverSet && facts.artworks === 0) return check('mismatch', 'musicNoArtwork')

  if (e.replaced) {
    if (e.replaced.playlistsBefore === null) return check('unreadable', 'musicUnreadable')
    const now = new Set(facts.playlists.map((p) => p.normalize('NFC')))
    const lost = e.replaced.playlistsBefore.find((p) => !now.has(p.normalize('NFC')))
    if (lost !== undefined) return check('mismatch', 'musicPlaylistLost', { playlist: lost })
  }

  return check('ok', 'musicOne', {
    playlists: facts.playlists.join(', '),
    count: facts.playlists.length,
  })
}
