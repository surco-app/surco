import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  type ActivityRow,
  applyActivity,
  type LocalActivityReport,
  reportRow,
} from '../lib/activityLog'

// The feed's rows, held outside React state so that whoever hosts the log re-renders only
// for what it reads: App reads whether anything is running, the panel reads the rows.
export interface ActivityStore {
  subscribe: (onChange: () => void) => () => void
  getRows: () => ActivityRow[]
}

function createActivityStore(): ActivityStore & {
  update: (next: (rows: ActivityRow[]) => ActivityRow[]) => void
} {
  let rows: ActivityRow[] = []
  const listeners = new Set<() => void>()
  return {
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    getRows: () => rows,
    update(next) {
      const updated = next(rows)
      if (updated === rows) return
      rows = updated
      for (const listener of listeners) listener()
    },
  }
}

// Subscribes to the main-process activity feed and folds it into the panel's row
// list. Kept always-on (cheap: it only accumulates when something is happening),
// so opening the panel shows recent work already in place rather than an empty box
// that fills only from the next event onward.
//
// `report` is the renderer-side entrance to the same feed: work that decides in the
// renderer (the auto-match sweep) drops its finished verdicts here directly instead of
// round-tripping through the main process it never touched. Ids get their own `local-`
// space so they can never collide with the main emitter's counter.
//
// An "analyze all" streams a start and a done for every probe, several per track, so the
// host (App) reads only `running` and re-renders when that flips, not on every event.
export function useActivityLog(): {
  store: ActivityStore
  running: boolean
  clear: () => void
  report: (r: LocalActivityReport) => void
} {
  const [store] = useState(createActivityStore)
  const nextLocalId = useRef(0)

  useEffect(
    () => window.api.onActivity((event) => store.update((prev) => applyActivity(prev, event))),
    [store],
  )

  const running = useSyncExternalStore(store.subscribe, () =>
    store.getRows().some((r) => r.status === 'running'),
  )

  const report = useCallback(
    (r: LocalActivityReport): void => {
      store.update((prev) => reportRow(prev, `local-${nextLocalId.current++}`, r))
    },
    [store],
  )

  const clear = useCallback(() => store.update(() => []), [store])

  return { store, running, clear, report }
}

// The rows themselves, for the panel: subscribed only while it is mounted.
export function useActivityRows(store: ActivityStore): ActivityRow[] {
  return useSyncExternalStore(store.subscribe, store.getRows)
}
