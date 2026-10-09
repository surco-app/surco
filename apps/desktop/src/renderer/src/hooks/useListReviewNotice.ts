import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import type { AppStore } from '../lib/appStore'
import { listReviewEntries } from '../lib/listReviewEntries'
import { dismissToast, pushToast } from '../lib/toastQueue'
import type { TrackItem } from '../types'
import { pendingGroups } from './useMusicReview'
import { useStableCallback } from './useStableCallback'

const NOTICE_TIMEOUT_MS = 8_000

// Counted once the drop or the pick has handed over every path and every tag read has
// landed: a count taken mid-read misses the files still loading and is not taken again.
export function useListReviewNotice({
  store,
  tr,
  tracksRef,
  settled,
  ignored,
  openListReview,
}: {
  store: AppStore
  tr: TFunction
  tracksRef: { readonly current: TrackItem[] }
  settled: boolean
  ignored: () => readonly string[]
  openListReview: () => void
}) {
  const load = useRef<{ paths: Set<string>; running: number } | null>(null)
  const [handedOver, setHandedOver] = useState(0)

  const watchLoad = useStableCallback(async (run: () => Promise<void>): Promise<void> => {
    load.current ??= { paths: new Set(), running: 0 }
    const current = load.current
    current.running += 1
    try {
      await run()
    } finally {
      current.running -= 1
      if (current.running === 0 && current.paths.size === 0 && load.current === current)
        load.current = null
      setHandedOver((n) => n + 1)
    }
  })

  const onPathsAdded = useStableCallback((paths: string[]) => {
    for (const path of paths) load.current?.paths.add(path)
  })

  useEffect(() => {
    void handedOver
    const current = load.current
    if (!current || current.running > 0 || !settled) return
    load.current = null
    const rows = tracksRef.current
    const loaded = rows.filter((t) => current.paths.has(t.inputPath)).length
    const { duplicates, spelling } = pendingGroups(
      listReviewEntries(rows).entries,
      ignored(),
      current.paths,
    )
    if (loaded === 0 || duplicates + spelling === 0) return
    const parts = [
      duplicates > 0 && tr('listReview.notice.duplicates', { count: duplicates }),
      spelling > 0 && tr('listReview.notice.spellings', { count: spelling }),
    ].filter((p): p is string => !!p)
    const id = pushToast(store, {
      key: 'list-review-notice',
      tone: 'neutral',
      testid: 'list-review-notice',
      message: tr('listReview.notice.found', {
        loaded: tr('listReview.notice.loaded', { count: loaded }),
        issues:
          parts.length === 2
            ? tr('listReview.notice.both', { duplicates: parts[0], spellings: parts[1] })
            : parts[0],
      }),
      action: {
        label: { key: 'listReview.notice.review' },
        onAction: () => {
          dismissToast(store, id)
          openListReview()
        },
      },
      duration: NOTICE_TIMEOUT_MS,
    })
  }, [handedOver, settled, tracksRef, ignored, tr, store, openListReview])

  return { watchLoad, onPathsAdded }
}
