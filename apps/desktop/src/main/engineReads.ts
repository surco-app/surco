import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { engineTrackId } from '../shared/engineContent'
import type { LiveCues } from '../shared/types'
import { readEngineTrackCues } from './engineCues'
import {
  type EngineDb,
  type EngineMembership,
  engineDatabasePath,
  engineMembership,
  engineMembershipOf,
  openEngineDb,
  readEngineCollection,
  readEnginePlaylist,
  readEngineRecentCount,
  readEngineTrackCount,
  readEngineTree,
} from './enginePlaylists'
import { pathKey } from './libraryPathKey'
import { threadLog } from './threadLog'

const stampOf = (dir: string): string =>
  [engineDatabasePath(dir), `${engineDatabasePath(dir)}-wal`]
    .map((file) => {
      try {
        const { mtimeMs, size } = statSync(file)
        return `${mtimeMs}:${size}`
      } catch {
        return ''
      }
    })
    .join('|')

let inMemory: { dir: string; stamp: string; db: EngineDb } | null = null

function libraryDb(dir: string): { db: EngineDb; kept: boolean } | null {
  const stamp = stampOf(dir)
  if (inMemory?.dir === dir && inMemory.stamp === stamp) return { db: inMemory.db, kept: true }
  inMemory?.db.close()
  inMemory = null
  const db = openEngineDb(dir)
  if (!db) return null
  if (!db.memory) return { db, kept: false }
  inMemory = { dir, stamp, db }
  return { db, kept: true }
}

function withLibrary<T>(dir: string, read: (db: EngineDb) => T, empty: T): T {
  const open = libraryDb(dir)
  if (!open) return empty
  try {
    return read(open.db)
  } catch (err) {
    threadLog.warn(`Engine DJ playlist read failed: ${String(err)}`)
    throw err
  } finally {
    if (!open.kept) open.db.close()
  }
}

let held: { dir: string; stamp: string; membership: EngineMembership } | null = null

function membershipOf(dir: string): EngineMembership | null {
  const stamp = stampOf(dir)
  if (held?.dir === dir && held.stamp === stamp) return held.membership
  held = null
  const membership = withLibrary<EngineMembership | null>(
    dir,
    (db) => engineMembership(db, dir),
    null,
  )
  if (membership) held = { dir, stamp, membership }
  return membership
}

const READS = {
  tree: { empty: [], run: (dir: string, _arg: undefined) => withLibrary(dir, readEngineTree, []) },
  recentCount: {
    empty: 0,
    run: (dir: string, _arg: undefined) => withLibrary(dir, (db) => readEngineRecentCount(db), 0),
  },
  trackCount: {
    empty: 0,
    run: (dir: string, _arg: undefined) => withLibrary(dir, readEngineTrackCount, 0),
  },
  collection: {
    empty: [],
    run: (dir: string, _arg: undefined) =>
      withLibrary(dir, (db) => readEngineCollection(db, dir), []),
  },
  playlist: {
    empty: [],
    run: (dir: string, list: { id: string; artDir: string }) =>
      withLibrary(dir, (db) => readEnginePlaylist(db, dir, list.id, list.artDir), []),
  },
  liveCues: {
    empty: {},
    run: (dir: string, contentIds: string[]) =>
      withLibrary(
        dir,
        (db) => {
          const out: Record<string, LiveCues> = {}
          for (const contentId of contentIds) {
            const read = readEngineTrackCues(db, contentId, { wave: false })
            if (read) out[contentId] = { cues: read.cues, fingerprint: read.fingerprint }
          }
          return out
        },
        {},
      ),
  },
  trackCues: {
    empty: null,
    run: (dir: string, contentId: string) =>
      withLibrary(dir, (db) => readEngineTrackCues(db, contentId), null),
  },
  file: {
    empty: null,
    run: (dir: string, contentId: string): string | null => {
      const id = engineTrackId(contentId)
      if (id === null) return null
      const path = withLibrary(
        dir,
        (db) =>
          (
            db.prepare('SELECT path FROM Track WHERE id = ?').get(id) as
              | { path: string | null }
              | undefined
          )?.path ?? null,
        null,
      )
      return path ? resolve(dir, path) : null
    },
  },
  membership: {
    empty: {},
    run: (dir: string, paths: string[]) => {
      const membership = membershipOf(dir)
      return membership
        ? engineMembershipOf(
            membership,
            paths,
            pathKey({ realPath: (p: string) => realpathSync(p) }),
          )
        : {}
    },
  },
}

export type EngineReadName = keyof typeof READS
export type EngineReadArg<N extends EngineReadName> = Parameters<(typeof READS)[N]['run']>[1]
export type EngineReadAnswer<N extends EngineReadName> = ReturnType<(typeof READS)[N]['run']>

export function emptyEngineRead<N extends EngineReadName>(name: N): EngineReadAnswer<N> {
  return READS[name].empty as EngineReadAnswer<N>
}

export function runEngineRead<N extends EngineReadName>(
  dir: string,
  name: N,
  arg: EngineReadArg<N>,
): EngineReadAnswer<N> {
  const run = READS[name].run as (dir: string, arg: EngineReadArg<N>) => EngineReadAnswer<N>
  return run(dir, arg)
}
