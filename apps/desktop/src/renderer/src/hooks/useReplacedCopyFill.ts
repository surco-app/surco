import { useEffect } from 'react'
import type { TrackMetadata } from '../../../shared/types'
import { fillFromCopy } from '../lib/fillFromCopy'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  item: TrackItem
  copyPath: string
  onChange: (patch: Partial<TrackItem>) => void
  onRecordUndo?: (ids: string[]) => void
}

export function useReplacedCopyFill({ item, copyPath, onChange, onRecordUndo }: Params): void {
  const apply = useStableCallback((copy: TrackMetadata) => {
    const meta = fillFromCopy(item.meta, copy)
    if (!meta) {
      onChange({ copyFilled: true })
      return
    }
    onRecordUndo?.([item.id])
    onChange({ meta, copyFilled: true })
  })
  const ready = !item.loadingMeta && !item.copyFilled && !item.metaCleared && !!copyPath
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track, the copy and readiness; apply reads the live row when the tags arrive.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    window.api
      .readTags(copyPath)
      .then((copy) => {
        if (!cancelled) apply(copy)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item.id, copyPath, ready])
}
