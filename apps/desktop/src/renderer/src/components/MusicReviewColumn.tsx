import type React from 'react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const keysOf = (review: Review) => [
  ...(review.filter === 'duplicates' ? [] : review.spelling.map((g) => g.key)),
  ...(review.filter === 'spelling' ? [] : review.duplicates.map((c) => c.group.key)),
]

// When the selected group leaves the list (ignored, applied or filtered out) the user
// keeps their place: the group that followed it, or the one before when it was last.
function useSelection(review: Review | null) {
  const [picked, select] = useState<string | null>(null)
  const seen = useRef<string[]>([])
  const keys = review ? keysOf(review) : []
  let selectedKey: string | null = keys[0] ?? null
  if (picked !== null && keys.includes(picked)) selectedKey = picked
  else if (picked !== null) {
    const at = seen.current.indexOf(picked)
    const live = new Set(keys)
    const after = seen.current.slice(at + 1).find((k) => live.has(k))
    const before = seen.current
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((k) => live.has(k))
    if (at >= 0) selectedKey = after ?? before ?? selectedKey
  }
  useEffect(() => {
    seen.current = keys
    if (review && selectedKey !== picked) select(selectedKey)
    if (!review && picked !== null) select(null)
  })
  return { selectedKey, select }
}

export function useReviewSelection(review: Review) {
  return useSelection(review)
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
  const { selectedKey, select } = useSelection(review)
  return (
    <ReviewContext.Provider value={review && { review, selectedKey, select }}>
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
