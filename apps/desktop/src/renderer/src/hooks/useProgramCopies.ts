import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { DJ_PROGRAMS, type DjProgram } from '../../../shared/djProgram'
import { buildLibraryIndex, findLibraryEntry } from '../lib/appleMusicLibrary'
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
  const indexes = useMemo(
    () =>
      collections.map((tracks) =>
        tracks ? buildLibraryIndex(collectionCandidates(tracks)) : null,
      ),
    [collections],
  )
  const { title, artist } = meta
  const suggestedTitle = suggestedMeta?.title
  const suggestedArtist = suggestedMeta?.artist
  return useMemo(
    () =>
      DJ_PROGRAMS.flatMap((program, i) => {
        const index = indexes[i]
        if (!active[i] || !index) return []
        const entry =
          findLibraryEntry(index, { title, artist }, durationSec) ??
          (suggestedTitle !== undefined && suggestedArtist !== undefined
            ? findLibraryEntry(
                index,
                { title: suggestedTitle, artist: suggestedArtist },
                durationSec,
              )
            : null)
        if (!entry?.path) return []
        return [
          { program, path: entry.path, isThisFile: pathKey(entry.path) === pathKey(inputPath) },
        ]
      }),
    [indexes, active, title, artist, durationSec, suggestedTitle, suggestedArtist, inputPath],
  )
}
