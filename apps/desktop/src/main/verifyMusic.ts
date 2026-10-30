import { realpathSync } from 'node:fs'
import { extname } from 'node:path'
import { errorWithKey } from '../shared/errorKeys'
import type { TrackMetadata } from '../shared/types'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import {
  appleMusicLimiter,
  musicFileEntries,
  readMusicEntryFacts,
  runOsascript,
} from './applemusic'
import { pathKey } from './libraryPathKey'
import { formatOf } from './verifyFile'

export interface MusicExpect {
  pid: string
  file: string
  ext: string
  meta: Pick<TrackMetadata, 'title' | 'artist' | 'album'>
  coverSet: boolean
  // playlistsBefore is null when the old entry's playlists could not be read before the
  // add; oldKept when the replace already reported keeping the old entry on purpose.
  replaced?: { oldPid: string; playlistsBefore: string[] | null; oldKept?: true }
}

export interface MusicReaders {
  entry: typeof readMusicEntryFacts
  // Persistent IDs of every entry playing the file, under any spelling of its path.
  // Rejects when Music could not be asked.
  entriesForFile: (path: string, titles: string[]) => Promise<string[]>
  realPath: (p: string) => string
  // Rejects as soon as the signal aborts.
  wait: (ms: number, signal?: AbortSignal) => Promise<void>
}

// Compares by where a path really lands, not by how Music spelled it: the library holds the
// same volume both directly and through the ~/Music/Music link, in NFD or NFC, in any case.
const comparablePath = (options: { realPath: (p: string) => string; homeMusicDir?: string }) => {
  const key = pathKey(options)
  return (p: string) => key(p.normalize('NFC')).normalize('NFC')
}

export function musicEntriesForFile(options: {
  run: typeof runOsascript
  realPath: (p: string) => string
  homeMusicDir?: string
}): MusicReaders['entriesForFile'] {
  const keyOf = comparablePath(options)
  return async (path, titles) => {
    const { consulted, entries } = await appleMusicLimiter.run(() =>
      musicFileEntries(
        titles.map((title) => ({ path, title })),
        true,
        options.run,
        keyOf,
      ),
    )
    if (!consulted) throw new Error('Music could not say which entries play the file')
    return [...new Set((entries[path] ?? []).map((e) => e.persistentId))]
  }
}

const realPath = (p: string) => realpathSync(p)

export const musicReaders: MusicReaders = {
  entry: readMusicEntryFacts,
  entriesForFile: musicEntriesForFile({ run: runOsascript, realPath }),
  realPath,
  wait: (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason)
      })
    }),
}

// Music fills the location of a fresh add asynchronously, and may refuse it meanwhile.
const EMPTY_LOCATION_WAITS_MS = [1000, 2000, 4000]

const check = (
  state: PlaceCheck['state'],
  key: VerifyDetailKey,
  params?: Record<string, string | number | string[]>,
): PlaceCheck => ({ place: 'appleMusic', state, detail: params ? { key, params } : { key } })

const nameKey = (text: string) => text.normalize('NFC').trim().toLowerCase()

const TAG_FIELDS = [
  ['title', 'name'],
  ['artist', 'artist'],
  ['album', 'album'],
] as const

// A cancel is not a read that failed: it rejects with conversionCancelled.
export async function checkAppleMusic(
  e: MusicExpect,
  r: MusicReaders,
  opts: { signal?: AbortSignal } = {},
): Promise<PlaceCheck> {
  try {
    const result = await judge(e, r, opts.signal)
    opts.signal?.throwIfAborted()
    return result
  } catch {
    if (opts.signal?.aborted) throw errorWithKey('conversionCancelled')
    return check('unreadable', 'musicUnreadable')
  }
}

async function judge(e: MusicExpect, r: MusicReaders, signal?: AbortSignal): Promise<PlaceCheck> {
  const read = () => r.entry(e.pid, e.replaced?.oldPid, { withPlaylists: e.replaced !== undefined })
  let facts = await read()
  for (const ms of EMPTY_LOCATION_WAITS_MS) {
    if (facts === 'missing' || (facts.location !== '' && facts.location !== null)) break
    await r.wait(ms, signal)
    facts = await read()
  }
  if (facts === 'missing') return check('mismatch', 'musicMissing')
  if (facts.location === null) return check('unreadable', 'musicUnreadable')
  if (facts.location === '') return check('mismatch', 'musicNoFile')

  const key = comparablePath({ realPath: r.realPath })
  if (key(facts.location) !== key(e.file)) {
    const ext = extname(facts.location).toLowerCase()
    return ext === e.ext.toLowerCase()
      ? check('mismatch', 'musicOtherFile')
      : check('mismatch', 'musicWrongFile', { format: formatOf(ext) })
  }

  if (facts.oldExists === true && !e.replaced?.oldKept)
    return check('mismatch', 'musicDuplicate', { count: 2 })
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

  return facts.playlists.length === 0
    ? check('ok', 'musicOneNoPlaylists')
    : check('ok', 'musicOne', { playlists: facts.playlists })
}
