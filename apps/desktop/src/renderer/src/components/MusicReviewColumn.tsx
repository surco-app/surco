import type React from 'react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LibraryTagUpdate } from '../../../shared/types'
import {
  type MusicReview as Review,
  type ReviewFilter,
  useMusicReview,
} from '../hooks/useMusicReview'
import type { ReviewSource } from '../lib/reviewSource'
import {
  MusicReview,
  MusicReviewAction,
  MusicReviewProgress,
  type ReviewSort,
  visibleKeys,
} from './MusicReview'
import { MusicReviewDetail, type ReviewSync } from './MusicReviewDetail'

interface Shared {
  review: Review
  selectedKey: string | null
  select: (key: string) => void
  search: string
  setSearch: (value: string) => void
  sort: ReviewSort
  setSort: (sort: ReviewSort) => void
  confirming: boolean
  setConfirming: (open: boolean) => void
}

const ReviewContext = createContext<Shared | null>(null)

// When the selected group leaves the list (ignored, applied or filtered out) the user
// keeps their place: the group that followed it, or the one before when it was last.
function useSelection(review: Review | null, search: string, sort: ReviewSort) {
  const [picked, select] = useState<string | null>(null)
  const seen = useRef<string[]>([])
  const keys = review ? visibleKeys(review, search, sort) : []
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

export function useReviewSelection(review: Review, search: string, sort: ReviewSort) {
  return useSelection(review, search, sort)
}

interface Options {
  filter: ReviewFilter
  source?: ReviewSource
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
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ReviewSort>('default')
  const [confirming, setConfirming] = useState(false)
  const { selectedKey, select } = useSelection(review, search, sort)
  const closed = review === null
  useEffect(() => {
    if (!closed) return
    setSearch('')
    setSort('default')
    setConfirming(false)
  }, [closed])
  return (
    <ReviewContext.Provider
      value={
        review && {
          review,
          selectedKey,
          select,
          search,
          setSearch,
          sort,
          setSort,
          confirming,
          setConfirming,
        }
      }
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
      {open && <Owner key={options.source?.kind ?? 'music'} {...options} onChange={setReview} />}
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
      search={shared.search}
      onSearch={shared.setSearch}
      sort={shared.sort}
      onSort={shared.setSort}
      confirming={shared.confirming}
      onConfirming={shared.setConfirming}
    />
  )
}

export function MusicReviewDetailPane({ sync }: { sync: ReviewSync }) {
  const shared = useContext(ReviewContext)
  if (!shared) return <section data-testid="music-review-detail" className="h-full" />
  return <MusicReviewDetail review={shared.review} selectedKey={shared.selectedKey} sync={sync} />
}

export function MusicReviewToolbarAction({ busy }: { busy: boolean }) {
  const shared = useContext(ReviewContext)
  if (!shared) return null
  return (
    <MusicReviewAction
      review={shared.review}
      busy={busy}
      onConfirm={() => shared.setConfirming(true)}
    />
  )
}

export function MusicReviewTopProgress({ fallback }: { fallback: React.ReactNode }) {
  const shared = useContext(ReviewContext)
  return shared ? <MusicReviewProgress review={shared.review} fallback={fallback} /> : fallback
}
