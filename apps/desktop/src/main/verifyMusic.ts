import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { errorWithKey } from '../shared/errorKeys'
import type { TrackMetadata } from '../shared/types'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import {
  appleMusicLimiter,
  buildMusicRunningScript,
  type FileLike,
  musicFileEntries,
  musicFileLocations,
  readMusicEntryFacts,
  runOsascript,
} from './applemusic'
import { probeDuration } from './ffmpeg'
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
  // Rejects when Music could not be asked. With the file's length and size, also finds an
  // entry whose name no longer matches any title.
  entriesForFile: (
    path: string,
    titles: string[],
    like?: Omit<FileLike, 'path'>,
  ) => Promise<string[]>
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
  launch?: boolean
}): MusicReaders['entriesForFile'] {
  const keyOf = comparablePath(options)
  const launch = options.launch ?? true
  return async (path, titles, like) => {
    const { consulted, entries } = await appleMusicLimiter.run(() =>
      musicFileEntries(
        titles.map((title) => ({ path, title })),
        launch,
        options.run,
        keyOf,
        like && { path, ...like },
      ),
    )
    if (!consulted && !launch) return []
    if (!consulted) throw new Error('Music could not say which entries play the file')
    return [...new Set((entries[path] ?? []).map((e) => e.persistentId))]
  }
}

const realPath = (p: string) => realpathSync(p)

// What entriesForFile matches an entry renamed inside Music by; null when the length
// cannot be read.
export async function fileLikeForMusic(path: string): Promise<Omit<FileLike, 'path'> | null> {
  const [durationSec, { size }] = await Promise.all([probeDuration(path), stat(path)])
  return durationSec === null ? null : { durationSec, size }
}

// Whether any entry plays the file, read from every location in Music: a file with no
// title gives no name to narrow by, and its stored length and size are no guide (a tag
// rewrite leaves the size stale, a VBR MP3 without a header is seconds off). Measured
// 09/10 at 47 s for 2045 tracks on SMB; past the bound it rejects, which keeps the file.
const ALL_LOCATIONS_TIMEOUT_MS = 120_000

export function musicFileHolder(options: {
  run: typeof runOsascript
  realPath: (p: string) => string
  homeMusicDir?: string
}): (path: string) => Promise<boolean> {
  const keyOf = comparablePath(options)
  return async (path) => {
    const rows = await appleMusicLimiter.run(() =>
      musicFileLocations((script, opts) =>
        options.run(script, { ...opts, timeout: ALL_LOCATIONS_TIMEOUT_MS }),
      ),
    )
    const key = keyOf(path)
    return rows.some((r) => keyOf(r.path) === key)
  }
}

export const musicHoldsFile = musicFileHolder({ run: runOsascript, realPath })

export const musicEntriesIfOpen = musicEntriesForFile({
  run: runOsascript,
  realPath,
  launch: false,
})

export async function musicIsOpen(run: typeof runOsascript = runOsascript): Promise<boolean> {
  return (await run(buildMusicRunningScript()).catch(() => 'false')).trim() === 'true'
}

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
