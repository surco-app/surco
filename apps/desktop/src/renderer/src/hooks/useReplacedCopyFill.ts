import { useEffect } from 'react'
import type { TrackMetadata } from '../../../shared/types'
import { copyCoverWins, fillFromCopy, groupingFromCopy } from '../lib/fillFromCopy'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  item: TrackItem
  copyPath: string
  // The copy is another version of the track: it lends only its grouping and its cover.
  anotherVersion?: boolean
  onChange: (patch: Partial<TrackItem>) => void
  onRecordUndo?: (ids: string[], opts: { cover: boolean }) => void
}

export function useReplacedCopyFill({
  item,
  copyPath,
  anotherVersion = false,
  onChange,
  onRecordUndo,
}: Params): void {
  const apply = useStableCallback((copy: TrackMetadata, cover: string | null) => {
    const meta = anotherVersion ? groupingFromCopy(item.meta, copy) : fillFromCopy(item.meta, copy)
    const coverUrl = cover && copyCoverWins(item, cover) ? cover : null
    if (!meta && !coverUrl) {
      onChange({ copyFilled: true })
      return
    }
    onRecordUndo?.([item.id], { cover: !!coverUrl })
    onChange({
      ...(meta ? { meta } : {}),
      ...(coverUrl ? { coverUrl, coverPath: undefined } : {}),
      copyFilled: true,
    })
  })
  const ready =
    !item.loadingMeta && !item.metaPartial && !item.copyFilled && !item.metaCleared && !!copyPath
  const needsCover = !item.coverRemoved
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
