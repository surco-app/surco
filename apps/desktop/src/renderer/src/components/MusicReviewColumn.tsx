import type React from 'react'
import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'
import type { LibraryTagUpdate } from '../../../shared/types'
import {
  type MusicReview as Review,
  type ReviewFilter,
  useMusicReview,
} from '../hooks/useMusicReview'
import { MusicReview } from './MusicReview'
import { MusicReviewDetail, type ReviewSync } from './MusicReviewDetail'

interface Shared {
  review: Review
  selectedKey: string | null
  select: (key: string) => void
}

const ReviewContext = createContext<Shared | null>(null)

function validKey(review: Review, picked: string | null): string | null {
  const keys = [
    ...(review.filter === 'duplicates' ? [] : review.spelling.map((g) => g.key)),
    ...(review.filter === 'spelling' ? [] : review.duplicates.map((c) => c.group.key)),
  ]
  return picked !== null && keys.includes(picked) ? picked : (keys[0] ?? null)
}

export function useReviewSelection(review: Review) {
  const [picked, select] = useState<string | null>(null)
  return { selectedKey: validKey(review, picked), select }
}

interface Options {
  filter: ReviewFilter
  ignored: string[]
  saveIgnored: (keys: string[]) => void
  onFilesChanged: (updates: LibraryTagUpdate[]) => void
}

function Owner({
  onChange,
  filter,
  ...options
}: Options & { onChange: (r: Review | null) => void }) {
  const review = useMusicReview({ initialFilter: filter, ...options })
  const { setFilter } = review
  useEffect(() => setFilter(filter), [filter, setFilter])
  useLayoutEffect(() => onChange(review), [review, onChange])
  useLayoutEffect(() => () => onChange(null), [onChange])
  return null
}

function Gate({ review, children }: { review: Review | null; children: React.ReactNode }) {
  const [picked, select] = useState<string | null>(null)
  useEffect(() => {
    if (!review) select(null)
  }, [review])
  return (
    <ReviewContext.Provider
      value={review && { review, selectedKey: validKey(review, picked), select }}
    >
      {children}
    </ReviewContext.Provider>
  )
}

// The list column and the main pane both show the review, so one hook instance has to
// sit above them. It lives in a sibling that reports up instead of wrapping the panes:
// wrapping only while open would remount the player and everything else in them.
export function MusicReviewProvider({
  open,
  children,
  ...options
}: Options & { open: boolean; children: React.ReactNode }) {
  const [review, setReview] = useState<Review | null>(null)
  return (
    <>
      {open && <Owner {...options} onChange={setReview} />}
      <Gate review={open ? review : null}>{children}</Gate>
    </>
  )
}

export function MusicReviewColumn({ onClose, busy }: { onClose: () => void; busy: boolean }) {
  const shared = useContext(ReviewContext)
  if (!shared) return null
  return (
    <MusicReview
      review={shared.review}
      selectedKey={shared.selectedKey}
      onSelect={shared.select}
      onClose={onClose}
      busy={busy}
    />
  )
}

export function MusicReviewDetailPane({ sync }: { sync: ReviewSync }) {
  const shared = useContext(ReviewContext)
  if (!shared) return <section data-testid="music-review-detail" className="h-full" />
  return <MusicReviewDetail review={shared.review} selectedKey={shared.selectedKey} sync={sync} />
}
