import { realpathSync } from 'node:fs'
import { collectionMemo, withCollection } from './rekordboxCollection'
import {
  type AmbiguousMatch,
  type FindOptions,
  type openRekordboxDb,
  type RekordboxTrack,
  rekordboxShareDir,
  trackFinder,
} from './rekordboxDb'
import { readMatchingPairs, readPlayedSequences } from './rekordboxMatching'
import { membershipFrom, membershipSnapshot } from './rekordboxMembership'
import { separatorContent } from './rekordboxPlaylistEdit'
import {
  readRecentlyAddedCount,
  readRekordboxCollection,
  readRekordboxPlaylistWithPreview,
  readRekordboxTrackCount,
  readRekordboxTree,
} from './rekordboxPlaylists'

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

export const markedIds = (db: Db): string[] =>
  (
    db
      .prepare(
        'SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0 AND Kind = 0',
      )
      .all() as { ContentID: string }[]
  ).map((r) => String(r.ContentID))

const membership = collectionMemo(membershipSnapshot)
const marked = collectionMemo((db) => markedIds(db).length)

const finder = collectionMemo(trackFinder)

export function trackOfCollection(
  path: string,
  key: string | undefined,
  file: string,
  options: FindOptions,
): RekordboxTrack | AmbiguousMatch | null {
  return finder(path, key)?.(file, options) ?? null
}

export interface TrackLookup {
  file: string
  resolve: boolean
  homeMusicDir?: string
  quiet?: boolean
}

const fresh =
  <A, T>(read: (db: Db, arg: A, path: string) => T) =>
  (path: string, key: string | undefined, arg: A): T =>
    withCollection(path, (db) => read(db, arg, path), undefined as T, key)

const READS = {
  tree: { empty: [], run: fresh((db, _arg: undefined) => readRekordboxTree(db)) },
  recentCount: { empty: 0, run: fresh((db, _arg: undefined) => readRecentlyAddedCount(db)) },
  trackCount: { empty: 0, run: fresh((db, _arg: undefined) => readRekordboxTrackCount(db)) },
  collection: { empty: [], run: fresh((db, _arg: undefined) => readRekordboxCollection(db)) },
  matching: { empty: [], run: fresh((db, _arg: undefined) => readMatchingPairs(db)) },
  playedTogether: {
    empty: [],
    run: fresh((db, playlistIds: string[]) => readPlayedSequences(db, playlistIds)),
  },
  playlist: {
    empty: [],
    run: fresh((db, id: string, path) =>
      readRekordboxPlaylistWithPreview(db, rekordboxShareDir(path), id),
    ),
  },
  hasSeparator: {
    empty: false,
    run: fresh((db, _arg: undefined) => separatorContent(db) !== null),
  },
  membership: {
    empty: {},
    run: (path: string, key: string | undefined, paths: string[]) => {
      const snapshot = membership(path, key)
      return snapshot
        ? membershipFrom(snapshot, paths, { realPath: (p: string) => realpathSync(p) })
        : {}
    },
  },
  track: {
    empty: null,
    run: (path: string, key: string | undefined, lookup: TrackLookup) =>
      trackOfCollection(path, key, lookup.file, {
        ...(lookup.resolve ? { realPath: (p: string) => realpathSync(p) } : {}),
        homeMusicDir: lookup.homeMusicDir,
        quiet: lookup.quiet,
      }),
  },
  marked: {
    empty: 0,
    run: (path: string, key: string | undefined, _arg: undefined) => marked(path, key) ?? 0,
  },
}

export type RekordboxReadName = keyof typeof READS
export type RekordboxReadArg<N extends RekordboxReadName> = Parameters<(typeof READS)[N]['run']>[2]
export type RekordboxReadAnswer<N extends RekordboxReadName> = ReturnType<(typeof READS)[N]['run']>

export function emptyRekordboxRead<N extends RekordboxReadName>(name: N): RekordboxReadAnswer<N> {
  return READS[name].empty as RekordboxReadAnswer<N>
}

export function runRekordboxRead<N extends RekordboxReadName>(
  path: string,
  key: string | undefined,
  name: N,
  arg: RekordboxReadArg<N>,
): RekordboxReadAnswer<N> {
  const run = READS[name].run as (
    path: string,
    key: string | undefined,
    arg: RekordboxReadArg<N>,
  ) => RekordboxReadAnswer<N>
  return run(path, key, arg)
}
