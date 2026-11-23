import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { DJ_PROGRAMS, type DjProgram } from '../../../shared/djProgram'
import type { CollectionTrack } from '../../../shared/types'
import { type AppleMusicIndex, buildLibraryIndex, findLibraryEntry } from '../lib/appleMusicLibrary'
import { collectionCandidates } from '../lib/collectionCandidates'
import { DJ_REACH_SETTINGS } from '../lib/djReach'
import { pathKey } from '../lib/pathKey'
import { useAppSettings } from '../lib/settingsContext'
import { sourceCollectionOptions } from '../lib/sourcePrograms'

export interface ProgramCopy {
  program: DjProgram
  path: string
  isThisFile: boolean
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

export function useProgramCopies({
  inputPath,
  meta,
  durationSec,
  suggestedMeta,
  enabled,
}: Args): ProgramCopy[] {
  const settings = useAppSettings()
  const active = useMemo(
    () =>
      DJ_PROGRAMS.map(
        (program) =>
          settings[DJ_REACH_SETTINGS[program].sync] || settings[DJ_REACH_SETTINGS[program].add],
      ),
    [settings],
  )
  const collections = useQueries({
    queries: DJ_PROGRAMS.map((program, i) => ({
      ...sourceCollectionOptions(program),
      enabled: enabled && active[i],
    })),
    combine: (results) => results.map((result) => result.data),
  })
  const { title, artist } = meta
  const suggestedTitle = suggestedMeta?.title
  const suggestedArtist = suggestedMeta?.artist
  const thisKey = pathKey(inputPath)
  return useMemo(
    () =>
      DJ_PROGRAMS.flatMap((program, i) => {
        const tracks = collections[i]
        if (!enabled || !active[i] || !tracks) return []
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
        return [{ program, path: entry.path, isThisFile: pathKey(entry.path) === thisKey }]
      }),
    [
      enabled,
      collections,
      active,
      title,
      artist,
      durationSec,
      suggestedTitle,
      suggestedArtist,
      inputPath,
      thisKey,
    ],
  )
}
