import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { traktorContentId } from '../shared/traktorContent'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { traktorCoverFile, traktorCoverUrl } from './traktorCoverFiles'
import { findEntries, type NmlEntry } from './traktorNml'
import {
  readTraktorCollection,
  readTraktorPlayedTogether,
  readTraktorPlaylist,
  readTraktorRecentCount,
  readTraktorTrackCount,
  readTraktorTree,
  traktorFileOf,
  traktorMembershipOf,
  traktorSeparatorKey,
} from './traktorPlaylists'

interface Collection {
  file: string
  bootVolume: string
  nml: string
}

interface Held {
  file: string
  stamp: string
  nml: string
  entries?: NmlEntry[]
  filesByName?: Map<string, string[]>
  playlistsOf?: { bootVolume: string; of: (path: string) => string[] | undefined }
}

let held: Held | null = null

function heldCollection(file: string): Held {
  const { mtimeMs, size } = statSync(file)
  const stamp = `${mtimeMs}:${size}`
  if (held?.file !== file || held.stamp !== stamp)
    held = { file, stamp, nml: readFileSync(file, 'utf8') }
  return held
}

const entriesOf = (c: Held): NmlEntry[] => {
  c.entries ??= findEntries(c.nml)
  return c.entries
}

function filesByNameOf(c: Held): Map<string, string[]> {
  if (c.filesByName) return c.filesByName
  const byName = new Map<string, string[]>()
  for (const entry of entriesOf(c)) {
    if (!entry.file) continue
    const block = c.nml.slice(entry.start, entry.end)
    const name = entry.file.normalize('NFC').toLowerCase()
    const spellings = [traktorFileOf(block, entry.volume), traktorFileOf(block, '')]
    byName.set(name, [...(byName.get(name) ?? []), ...new Set(spellings)])
  }
  c.filesByName = byName
  return byName
}

export function traktorHolds(file: string, path: string, options: PathMatchOptions): boolean {
  const key = pathKey(options)
  const nfc = path.normalize('NFC')
  const sameName = filesByNameOf(heldCollection(file)).get(basename(nfc).toLowerCase())
  if (!sameName) return false
  const target = key(nfc)
  return sameName.some((held) => key(held) === target)
}

export interface TraktorLocation {
  dir: string
  file: string
  volume: string
}

export interface TraktorFileLookup {
  path: string
  resolve: boolean
  homeMusicDir?: string
}

const sameText = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

type Read = Collection & { held: Held }

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
    run: (c: Read, paths: string[]) => {
      if (c.held.playlistsOf?.bootVolume !== c.bootVolume)
        c.held.playlistsOf = {
          bootVolume: c.bootVolume,
          of: traktorMembershipOf(c.nml, c.bootVolume),
        }
      const out: Record<string, string[]> = {}
      for (const path of paths) {
        const playlists = c.held.playlistsOf.of(path)
        if (playlists) out[path] = playlists
      }
      return out
    },
  },
  hasSeparator: {
    empty: false,
    run: (c: Read, _arg: undefined) => traktorSeparatorKey(c.nml) !== null,
  },
  holdsFile: {
    empty: false,
    run: (c: Read, lookup: TraktorFileLookup) =>
      traktorHolds(c.file, lookup.path, {
        ...(lookup.resolve ? { realPath: (p: string) => realpathSync(p) } : {}),
        homeMusicDir: lookup.homeMusicDir,
      }),
  },
  trackOf: {
    empty: undefined as string | undefined,
    run: (c: Read, at: TraktorLocation): string | undefined => {
      const found = entriesOf(c.held).filter(
        (e) =>
          sameText(e.dir, at.dir) &&
          sameText(e.file, at.file) &&
          (!at.volume || sameText(e.volume, at.volume)),
      )
      return found.length === 1
        ? traktorContentId(`${found[0].volume}${found[0].dir}${found[0].file}`)
        : undefined
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
  const run = READS[name].run as (c: Read, arg: TraktorReadArg<N>) => TraktorReadAnswer<N>
  const collection = heldCollection(file)
  return run({ file, bootVolume, nml: collection.nml, held: collection }, arg)
}
