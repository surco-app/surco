import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { DJ_PROGRAMS, type DjProgram } from '../../../shared/djProgram'
import type { CollectionTrack } from '../../../shared/types'
import {
  type AppleMusicIndex,
  buildLibraryIndex,
  findLibraryEntry,
  SAME_RECORDING_SEC,
} from '../lib/appleMusicLibrary'
import { collectionCandidates } from '../lib/collectionCandidates'
import { DJ_REACH_SETTINGS } from '../lib/djReach'
import { pathKey } from '../lib/pathKey'
import { useAppSettings } from '../lib/settingsContext'
import { sourceCollectionOptions } from '../lib/sourcePrograms'
import type { TrackItem } from '../types'

export interface ProgramCopy {
  program: DjProgram
  path: string
  isThisFile: boolean
  durationSec?: number
}

interface Args {
  inputPath: string
  meta: { title: string; artist: string }
  durationSec?: number
  suggestedMeta?: { title: string; artist: string }
  enabled: boolean
}

interface CollectionLookup {
  index: AppleMusicIndex
  pathKeys: ReadonlySet<string>
}

const lookupByCollection = new WeakMap<CollectionTrack[], CollectionLookup>()

function lookupFor(tracks: CollectionTrack[]): CollectionLookup {
  const cached = lookupByCollection.get(tracks)
  if (cached) return cached
  const lookup = {
    index: buildLibraryIndex(collectionCandidates(tracks)),
    pathKeys: new Set(tracks.flatMap((track) => (track.path ? [pathKey(track.path)] : []))),
  }
  lookupByCollection.set(tracks, lookup)
  return lookup
}

// The collections of the programs Surco sends to, read only while enabled. A switched-off
// program shows no copy even when its collection is cached by its tab. Pending while an
// enabled program's collection is still being read; one that failed will not arrive.
function useActiveCollections(enabled: boolean): {
  collections: (CollectionTrack[] | undefined)[]
  pending: boolean
} {
  const settings = useAppSettings()
  const active = useMemo(
    () =>
      DJ_PROGRAMS.map(
        (program) =>
          settings[DJ_REACH_SETTINGS[program].sync] || settings[DJ_REACH_SETTINGS[program].add],
      ),
    [settings],
  )
  const { data, loading } = useQueries({
    queries: DJ_PROGRAMS.map((program, i) => ({
      ...sourceCollectionOptions(program),
      enabled: enabled && active[i],
    })),
    combine: (results) => ({
      data: results.map((result) => result.data),
      loading: results.map((result) => result.isPending),
    }),
  })
  const collections = useMemo(
    () => data.map((tracks, i) => (enabled && active[i] ? tracks : undefined)),
    [data, enabled, active],
  )
  return { collections, pending: enabled && loading.some((isPending, i) => isPending && active[i]) }
}

// A selected track has no audio comparison behind it, so only an entry of the same title,
// artist and length is taken as its copy. The match score alone lets an exact title and artist
// through at any length, and another edit of the track must not be filed in the DJ's set.
export function sameLengthCopyIn(
  tracks: CollectionTrack[],
  track: { inputPath: string; meta: { title: string; artist: string }; durationSec?: number },
): string | undefined {
  if (track.durationSec === undefined) return undefined
  const entry = findLibraryEntry(lookupFor(tracks).index, track.meta, track.durationSec)
  if (!entry?.path || entry.durationSec === undefined) return undefined
  if (Math.abs(entry.durationSec - track.durationSec) > SAME_RECORDING_SEC) return undefined
  return pathKey(entry.path) === pathKey(track.inputPath) ? undefined : entry.path
}

// The copy a conversion lands beside, for To review: the converted file itself when the program
// holds it, else an entry of its title and artist at any length, since every format change is
// reviewed (26/11) and the new file may not last as long as the copy it follows.
export function formerCopyIn(
  tracks: CollectionTrack[],
  track: { inputPath: string; meta: { title: string; artist: string } },
): string | undefined {
  const { index, pathKeys } = lookupFor(tracks)
  if (pathKeys.has(pathKey(track.inputPath))) return track.inputPath
  return findLibraryEntry(index, track.meta)?.path ?? undefined
}

const copiesByCollection = new WeakMap<CollectionTrack[], Map<string, string | undefined>>()

// During a conversion the selection comes back as a new array on every progress tick, and
// searching every collection for every selected track each time costs ~70 ms with 5,000 tracks
// in 5 programs. Each answer is kept per collection, keyed on all the lookup reads, so a tick
// only searches for the tracks that changed.
function cachedCopyIn(
  tracks: CollectionTrack[],
  track: { inputPath: string; meta: { title: string; artist: string }; durationSec?: number },
): string | undefined {
  let copies = copiesByCollection.get(tracks)
  if (!copies) {
    copies = new Map()
    copiesByCollection.set(tracks, copies)
  }
  const key = [track.inputPath, track.meta.title, track.meta.artist, track.durationSec].join('\0')
  if (copies.has(key)) return copies.get(key)
  const path = sameLengthCopyIn(tracks, track)
  copies.set(key, path)
  return path
}

export function useSelectionCopies(
  tracks: TrackItem[],
  enabled: boolean,
): Partial<Record<DjProgram, Record<string, string>>> {
  const { collections } = useActiveCollections(enabled)
  return useMemo(
    () =>
      Object.fromEntries(
        DJ_PROGRAMS.flatMap((program, i) => {
          const collection = collections[i]
          if (!collection) return []
          const copies = Object.fromEntries(
            tracks.flatMap((t) => {
              const path = cachedCopyIn(collection, {
                inputPath: t.inputPath,
                meta: t.meta,
                durationSec: t.duration,
              })
              return path ? [[t.id, path]] : []
            }),
          )
          return Object.keys(copies).length > 0 ? [[program, copies]] : []
        }),
      ),
    [collections, tracks],
  )
}

export function useProgramCopies({ inputPath, meta, durationSec, suggestedMeta, enabled }: Args): {
  copies: ProgramCopy[]
  pending: boolean
} {
  const { collections, pending } = useActiveCollections(enabled)
  const { title, artist } = meta
  const suggestedTitle = suggestedMeta?.title
  const suggestedArtist = suggestedMeta?.artist
  const thisKey = pathKey(inputPath)
  const copies = useMemo(
    () =>
      DJ_PROGRAMS.flatMap((program, i): ProgramCopy[] => {
        const tracks = collections[i]
        if (!tracks) return []
        const { index, pathKeys } = lookupFor(tracks)
        if (pathKeys.has(thisKey)) return [{ program, path: inputPath, isThisFile: true }]
        // Without the length as a last resort: a copy of another edit is still that title
        // in that library, and its row says so (another version) instead of hiding it.
        const entry =
          findLibraryEntry(index, { title, artist }, durationSec) ??
          (suggestedTitle !== undefined && suggestedArtist !== undefined
            ? findLibraryEntry(
                index,
                { title: suggestedTitle, artist: suggestedArtist },
                durationSec,
              )
            : null) ??
          findLibraryEntry(index, { title, artist })
        if (!entry?.path) return []
        return [
          {
            program,
            path: entry.path,
            isThisFile: pathKey(entry.path) === thisKey,
            durationSec: entry.durationSec,
          },
        ]
      }),
    [collections, title, artist, durationSec, suggestedTitle, suggestedArtist, inputPath, thisKey],
  )
  return { copies, pending }
}
