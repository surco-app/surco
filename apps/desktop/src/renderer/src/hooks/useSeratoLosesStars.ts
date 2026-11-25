import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { pathKey } from '../lib/pathKey'
import { useAppSettings } from '../lib/settingsContext'
import { sourceCollectionOptions } from '../lib/sourcePrograms'

// Serato is repointed to a replacement when it follows replacements or adds tracks, and only
// for a file its library holds. Serato re-imports a repointed track as a new one, so it loses
// the stars that live in master.sqlite. Several tracks replace several files, and one Serato
// holds is enough to lose stars.
export function useSeratoLosesStars(...replacedPaths: string[]): boolean {
  return useSeratoStarsLoss(...replacedPaths) === true
}

// The same answer, undefined while Serato's collection is still unread: a caller that must not
// replace blind tells that apart from a known no.
export function useSeratoStarsLoss(...replacedPaths: string[]): boolean | undefined {
  const settings = useAppSettings()
  const repoints = settings.syncSerato || settings.addToSerato
  const { data } = useQuery({
    ...sourceCollectionOptions('serato'),
    enabled: repoints && replacedPaths.some(Boolean),
  })
  const heldKeys = useMemo(
    () => new Set((data ?? []).flatMap((track) => (track.path ? [pathKey(track.path)] : []))),
    [data],
  )
  if (!repoints || !replacedPaths.some(Boolean)) return false
  if (data === undefined) return undefined
  return replacedPaths.some((path) => !!path && heldKeys.has(pathKey(path)))
}
