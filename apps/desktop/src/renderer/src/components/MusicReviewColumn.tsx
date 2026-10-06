import { useEffect } from 'react'
import type { LibraryTagUpdate } from '../../../shared/types'
import { type ReviewFilter, useMusicReview } from '../hooks/useMusicReview'
import { MusicReview } from './MusicReview'

export function MusicReviewColumn({
  filter,
  ignored,
  saveIgnored,
  onFilesChanged,
  onClose,
}: {
  filter: ReviewFilter
  ignored: string[]
  saveIgnored: (keys: string[]) => void
  onFilesChanged: (updates: LibraryTagUpdate[]) => void
  onClose: () => void
}) {
  const review = useMusicReview({ initialFilter: filter, ignored, saveIgnored, onFilesChanged })
  const { setFilter } = review
  useEffect(() => setFilter(filter), [filter, setFilter])
  return <MusicReview review={review} onClose={onClose} />
}
