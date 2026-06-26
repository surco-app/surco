import type { ActivityEvent } from '../../../shared/types'

// One row in the activity panel: a single unit of background work, folding its
// start and its later done/error into one entry the user watches resolve in
// place. `status` drives the row's spinner/checkmark/error mark; `detail` holds
// the technical line (URL, result count, raw error) shown when expanded.
export interface ActivityRow {
  id: string
  kind: ActivityEvent['kind']
  label: string
  status: 'running' | 'done' | 'error'
  detail?: string
  ms?: number
}

// Newest-first, and capped: the panel is a live tail, not a full history, and an
// unbounded list would grow without limit across a long session. 200 rows is far
// more than fits on screen while staying cheap to render.
export const MAX_ROWS = 200

// Folds an incoming event into the row list. A `start` prepends a new running row;
// a `done`/`error` updates the matching row in place (by id) to its terminal
// state. A terminal event with no matching start (the start scrolled past the cap)
// is dropped rather than shown as a statusless orphan.
export function applyActivity(rows: ActivityRow[], event: ActivityEvent): ActivityRow[] {
  if (event.phase === 'start') {
    const row: ActivityRow = {
      id: event.id,
      kind: event.kind,
      label: event.label,
      status: 'running',
      detail: event.detail,
    }
    return [row, ...rows].slice(0, MAX_ROWS)
  }
  const status: ActivityRow['status'] = event.phase === 'done' ? 'done' : 'error'
  let matched = false
  const next = rows.map((row) => {
    if (row.id !== event.id) return row
    matched = true
    return { ...row, status, detail: event.detail ?? row.detail, ms: event.ms }
  })
  return matched ? next : rows
}
