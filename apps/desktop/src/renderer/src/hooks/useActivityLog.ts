import { useEffect, useState } from 'react'
import { type ActivityRow, applyActivity } from '../lib/activityLog'

// Subscribes to the main-process activity feed and folds it into the panel's row
// list. Kept always-on (cheap: it only accumulates when something is happening),
// so opening the panel shows recent work already in place rather than an empty box
// that fills only from the next event onward.
export function useActivityLog(): { rows: ActivityRow[]; clear: () => void } {
  const [rows, setRows] = useState<ActivityRow[]>([])

  useEffect(
    () => window.api.onActivity((event) => setRows((prev) => applyActivity(prev, event))),
    [],
  )

  return { rows, clear: () => setRows([]) }
}
