import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { pathKey } from '../lib/pathKey'
import { useAppSettings } from '../lib/settingsContext'
import { sourceCollectionOptions } from '../lib/sourcePrograms'

// Serato is repointed to a replacement when it follows replacements or adds tracks, and only
// for a file its library holds. Serato re-imports a repointed track as a new one, so it loses
// the stars that live in master.sqlite.
export function useSeratoLosesStars(replacedPath: string): boolean {
  const settings = useAppSettings()
  const repoints = settings.syncSerato || settings.addToSerato
  const { data } = useQuery({
    ...sourceCollectionOptions('serato'),
    enabled: repoints && !!replacedPath,
  })
  const heldKeys = useMemo(
    () => new Set((data ?? []).flatMap((track) => (track.path ? [pathKey(track.path)] : []))),
    [data],
  )
  return repoints && !!replacedPath && heldKeys.has(pathKey(replacedPath))
}
