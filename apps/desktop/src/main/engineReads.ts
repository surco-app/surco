import { realpathSync, statSync } from 'node:fs'
import {
  type EngineDb,
  type EngineMembership,
  engineDatabasePath,
  engineMembership,
  engineMembershipOf,
  openEngineDb,
  readEnginePlaylist,
  readEngineRecentCount,
  readEngineTrackCount,
  readEngineTree,
} from './enginePlaylists'
import { pathKey } from './libraryPathKey'
import { threadLog } from './threadLog'

function withLibrary<T>(dir: string, read: (db: EngineDb) => T, empty: T): T {
  const db = openEngineDb(dir)
  if (!db) return empty
  try {
    return read(db)
  } catch (err) {
    threadLog.warn(`Engine DJ playlist read failed: ${String(err)}`)
    throw err
  } finally {
    db.close()
  }
}

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
  playlist: {
    empty: [],
    run: (dir: string, list: { id: string; artDir: string }) =>
      withLibrary(dir, (db) => readEnginePlaylist(db, dir, list.id, list.artDir), []),
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
