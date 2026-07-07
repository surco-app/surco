import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ActivityRow,
  applyActivity,
  type LocalActivityReport,
  reportRow,
} from '../lib/activityLog'

// Subscribes to the main-process activity feed and folds it into the panel's row
// list. Kept always-on (cheap: it only accumulates when something is happening),
// so opening the panel shows recent work already in place rather than an empty box
// that fills only from the next event onward.
//
// `report` is the renderer-side entrance to the same feed: work that decides in the
// renderer (the auto-match sweep) drops its finished verdicts here directly instead of
// round-tripping through the main process it never touched. Ids get their own `local-`
// space so they can never collide with the main emitter's counter.
export function useActivityLog(): {
  rows: ActivityRow[]
  clear: () => void
  report: (r: LocalActivityReport) => void
} {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const nextLocalId = useRef(0)

  useEffect(
    () => window.api.onActivity((event) => setRows((prev) => applyActivity(prev, event))),
    [],
  )

  const report = useCallback((r: LocalActivityReport): void => {
    setRows((prev) => reportRow(prev, `local-${nextLocalId.current++}`, r))
  }, [])

  return { rows, clear: () => setRows([]), report }
}
