import type { ActivityEvent } from '../../../shared/types'

// One row in the activity panel: a single unit of background work, folding its
// start and its later done/error into one entry the user watches resolve in
// place. `status` drives the row's spinner/checkmark/error mark; `detail` holds
// the technical line (URL, result count, raw error) shown when expanded.
//
// A grouped row (analyze sweep) carries `children`: the per-probe steps, each a
// plain row, with the parent's `status` derived from them — running while any
// child runs, error if any failed, done once all finished. Its `label` is the
// track title; `children` is undefined on a plain (ungrouped) row.
export interface ActivityRow {
  id: string
  kind: ActivityEvent['kind']
  label: string
  status: 'running' | 'done' | 'error'
  detail?: string
  ms?: number
  children?: ActivityRow[]
  // A web page the row links to (a release page), shown as an open-in-browser button.
  url?: string
}

// Newest-first, and capped: the panel is a live tail, not a full history, and an
// unbounded list would grow without limit across a long session. 200 rows is far
// more than fits on screen while staying cheap to render.
export const MAX_ROWS = 200

// A child step's own status from its phase. Used both for the leaf row and to roll
// the parent group's status up from its children.
function statusOf(phase: ActivityEvent['phase']): ActivityRow['status'] {
  return phase === 'start' ? 'running' : phase === 'done' ? 'done' : 'error'
}

// A group's status rolls up from its probes: error wins (a failed probe must show),
// else running while any is in flight, else done once all finished.
function groupStatus(children: ActivityRow[]): ActivityRow['status'] {
  if (children.some((c) => c.status === 'error')) return 'error'
  if (children.some((c) => c.status === 'running')) return 'running'
  return 'done'
}

// Folds an incoming event into the row list. A grouped event (one carrying `group`)
// collapses onto a single row keyed by its group, with the individual steps as
// children; a plain event is one row. A `start` prepends a new running row (or a
// child under its group row); a `done`/`error` updates the matching row in place
// (by id) to its terminal state. A terminal event with no matching start (the start
// scrolled past the cap) is dropped rather than shown as a statusless orphan.
export function applyActivity(rows: ActivityRow[], event: ActivityEvent): ActivityRow[] {
  if (event.group) return applyGrouped(rows, event)
  if (event.phase === 'start') {
    const row: ActivityRow = {
      id: event.id,
      kind: event.kind,
      label: event.label,
      status: 'running',
      detail: event.detail,
      url: event.url,
    }
    return [row, ...rows].slice(0, MAX_ROWS)
  }
  const status = statusOf(event.phase)
  let matched = false
  const next = rows.map((row) => {
    if (row.id !== event.id) return row
    matched = true
    return { ...row, status, detail: event.detail ?? row.detail, ms: event.ms }
  })
  return matched ? next : rows
}

function applyGrouped(rows: ActivityRow[], event: ActivityEvent): ActivityRow[] {
  const groupId = `group:${event.group}`
  const child: ActivityRow = {
    id: event.id,
    kind: event.kind,
    label: event.label,
    status: statusOf(event.phase),
    detail: event.detail,
    ms: event.ms,
  }
  const existing = rows.find((r) => r.id === groupId)

  if (!existing) {
    // A terminal event with no group row means its start was evicted — drop it.
    if (event.phase !== 'start') return rows
    const group: ActivityRow = {
      id: groupId,
      kind: event.kind,
      label: event.groupLabel ?? event.group ?? event.label,
      status: 'running',
      children: [child],
    }
    return [group, ...rows].slice(0, MAX_ROWS)
  }

  const children =
    event.phase === 'start'
      ? [...(existing.children ?? []), child]
      : (existing.children ?? []).map((c) =>
          c.id === event.id
            ? { ...c, status: child.status, detail: event.detail ?? c.detail, ms: event.ms }
            : c,
        )
  const updated: ActivityRow = { ...existing, children, status: groupStatus(children) }
  return rows.map((r) => (r.id === groupId ? updated : r))
}
