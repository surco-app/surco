import { useEffect } from 'react'
import { appleMusicFillPatch } from '../lib/appleMusicFill'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  item: TrackItem
  // The Music entries the library match names for this track. More than one when the
  // library holds near-identical entries; main keeps only the one whose file this is.
  candidates: string[]
  onChange: (patch: Partial<TrackItem>) => void
}

// A file loaded on its own gets what Music holds for it, the way a playlist import does.
// Reported 30/09: a WAV in the Music library showed the "Apple Music" badge in the editor
// but an empty grouping and no cover, because a WAV carries neither and only the import
// asked Music for them.
//
// Once per track: the match reruns on every keystroke in title or artist, and each ask is
// an osascript. The answer is applied to the row as it is when Music replies, so a field
// typed meanwhile is kept.
export function useAppleMusicFill({ item, candidates, onChange }: Params): void {
  const apply = useStableCallback((from: Parameters<typeof appleMusicFillPatch>[1]) => {
    const patch = appleMusicFillPatch(item, from)
    if (patch) onChange(patch)
  })
  const ready = !item.loadingMeta && !item.fromAppleMusic && candidates.length > 0
  const path = item.inputPath
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track and on whether it is ready, not on the candidate list, which is a fresh array each render.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    window.api
      .appleMusicEntryMeta(path, candidates)
      .then((from) => {
        if (!cancelled && from) apply(from)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item.id, path, ready])
}
