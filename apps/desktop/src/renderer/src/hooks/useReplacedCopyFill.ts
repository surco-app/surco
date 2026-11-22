import { useEffect } from 'react'
import type { TrackMetadata } from '../../../shared/types'
import { fillFromCopy } from '../lib/fillFromCopy'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  item: TrackItem
  copyPath: string
  onChange: (patch: Partial<TrackItem>) => void
  onRecordUndo?: (ids: string[], opts: { cover: boolean }) => void
}

const wantsCover = (item: TrackItem): boolean => !item.coverUrl && !item.coverRemoved

export function useReplacedCopyFill({ item, copyPath, onChange, onRecordUndo }: Params): void {
  const apply = useStableCallback((copy: TrackMetadata, cover: string | null) => {
    const meta = fillFromCopy(item.meta, copy)
    const coverUrl = cover && wantsCover(item) ? cover : null
    if (!meta && !coverUrl) {
      onChange({ copyFilled: true })
      return
    }
    onRecordUndo?.([item.id], { cover: !!coverUrl })
    onChange({
      ...(meta ? { meta } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      copyFilled: true,
    })
  })
  const ready = !item.loadingMeta && !item.copyFilled && !item.metaCleared && !!copyPath
  const needsCover = wantsCover(item)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track, the copy and readiness; apply reads the live row when the tags arrive.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const cover = needsCover
      ? window.api.readCoverFull(copyPath).catch(() => null)
      : Promise.resolve(null)
    Promise.all([window.api.readTags(copyPath), cover])
      .then(([copy, art]) => {
        if (!cancelled) apply(copy, art)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item.id, copyPath, ready])
}
