import { readFileSync, statSync } from 'node:fs'
import { traktorCoverFile, traktorCoverUrl } from './traktorCoverFiles'
import {
  readTraktorCollection,
  readTraktorPlayedTogether,
  readTraktorPlaylist,
  readTraktorRecentCount,
  readTraktorTrackCount,
  readTraktorTree,
  traktorMembershipOf,
} from './traktorPlaylists'

interface Collection {
  file: string
  bootVolume: string
  nml: string
}

interface Held extends Collection {
  stamp: string
  playlistsOf?: (path: string) => string[] | undefined
}

let held: Held | null = null

function collectionOf(file: string, bootVolume: string): Held {
  const { mtimeMs, size } = statSync(file)
  const stamp = `${mtimeMs}:${size}`
  if (held?.file !== file || held.stamp !== stamp || held.bootVolume !== bootVolume)
    held = { file, bootVolume, stamp, nml: readFileSync(file, 'utf8') }
  return held
}

const READS = {
  tree: { empty: [], run: (c: Collection, _arg: undefined) => readTraktorTree(c.nml) },
  recentCount: { empty: 0, run: (c: Collection, _arg: undefined) => readTraktorRecentCount(c.nml) },
  trackCount: { empty: 0, run: (c: Collection, _arg: undefined) => readTraktorTrackCount(c.nml) },
  collection: {
    empty: [],
    run: (c: Collection, _arg: undefined) => readTraktorCollection(c.nml, c.bootVolume),
  },
  playlist: {
    empty: [],
    run: (c: Collection, id: string) =>
      readTraktorPlaylist(c.nml, id, c.bootVolume, undefined, (coverId) =>
        traktorCoverFile(c.file, coverId) ? traktorCoverUrl(coverId) : undefined,
      ),
  },
  membership: {
    empty: {},
    run: (c: Held, paths: string[]) => {
      c.playlistsOf ??= traktorMembershipOf(c.nml, c.bootVolume)
      const out: Record<string, string[]> = {}
      for (const path of paths) {
        const playlists = c.playlistsOf(path)
        if (playlists) out[path] = playlists
      }
      return out
    },
  },
  playedTogether: {
    empty: [],
    run: (c: Collection, ids: string[]) => readTraktorPlayedTogether(c.nml, ids, c.bootVolume),
  },
}

export type TraktorReadName = keyof typeof READS
export type TraktorReadArg<N extends TraktorReadName> = Parameters<(typeof READS)[N]['run']>[1]
export type TraktorReadAnswer<N extends TraktorReadName> = ReturnType<(typeof READS)[N]['run']>

export function emptyTraktorRead<N extends TraktorReadName>(name: N): TraktorReadAnswer<N> {
  return READS[name].empty as TraktorReadAnswer<N>
}

export function runTraktorRead<N extends TraktorReadName>(
  file: string,
  bootVolume: string,
  name: N,
  arg: TraktorReadArg<N>,
): TraktorReadAnswer<N> {
  const run = READS[name].run as (c: Held, arg: TraktorReadArg<N>) => TraktorReadAnswer<N>
  return run(collectionOf(file, bootVolume), arg)
}
