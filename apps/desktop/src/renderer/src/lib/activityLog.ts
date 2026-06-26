import type { ActivityEvent, ActivityParams } from '../../../shared/types'

// One row in the activity panel: a single unit of background work, folding its
// start and its later done/error into one entry the user watches resolve in
// place. `status` drives the row's spinner/checkmark/error mark.
//
// Text is held untranslated: `labelKey`/`labelParams` and `detailKey`/`detailParams`
// are i18n keys the panel resolves at render (so a language switch retranslates the
// whole feed); `label` and `detail` are raw strings for data that must not be keyed —
// a group's file name, a release title, a URL, a raw error. The panel prefers the key
// when present and falls back to the raw value.
//
// A grouped row (analyze sweep) carries `children`: the per-probe steps, each a plain
// row, with the parent's `status` derived from them — running while any child runs,
// error if any failed, done once all finished. `children` is undefined on a plain row.
export interface ActivityRow {
  id: string
  kind: ActivityEvent['kind']
  labelKey?: string
  labelParams?: ActivityParams
  label?: string
  status: 'running' | 'done' | 'error'
  detail?: string
  detailKey?: string
  detailParams?: ActivityParams
  ms?: number
  children?: ActivityRow[]
  // A web page the row links to (a release page), shown as an open-in-browser button.
  url?: string
}

// The label/detail fields shared by a row and its events, lifted into a helper so the
// start/done builders stay in sync as the i18n shape grows.
function textOf(
  event: ActivityEvent,
): Pick<ActivityRow, 'labelKey' | 'labelParams' | 'detail' | 'detailKey' | 'detailParams'> {
  return {
    labelKey: event.labelKey,
    labelParams: event.labelParams,
    detail: event.detail,
    detailKey: event.detailKey,
    detailParams: event.detailParams,
  }
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
      status: 'running',
      url: event.url,
      ...textOf(event),
    }
    return [row, ...rows].slice(0, MAX_ROWS)
  }
  const status = statusOf(event.phase)
  let matched = false
  const next = rows.map((row) => {
    if (row.id !== event.id) return row
    matched = true
    // The done/error event carries the resolved detail (a result count, a title, the
    // error), so its text replaces the start's; ms stamps the elapsed time.
    return { ...row, status, ms: event.ms, ...textOf(event) }
  })
  return matched ? next : rows
}

function applyGrouped(rows: ActivityRow[], event: ActivityEvent): ActivityRow[] {
  const groupId = `group:${event.group}`
  const child: ActivityRow = {
    id: event.id,
    kind: event.kind,
    status: statusOf(event.phase),
    ms: event.ms,
    ...textOf(event),
  }
  const existing = rows.find((r) => r.id === groupId)

  if (!existing) {
    // A terminal event with no group row means its start was evicted — drop it.
    if (event.phase !== 'start') return rows
    const group: ActivityRow = {
      id: groupId,
      kind: event.kind,
      // The group's title is the raw file name, not a key.
      label: event.groupLabel ?? event.group,
      status: 'running',
      children: [child],
    }
    return [group, ...rows].slice(0, MAX_ROWS)
  }

  const children =
    event.phase === 'start'
      ? [...(existing.children ?? []), child]
      : (existing.children ?? []).map((c) =>
          c.id === event.id ? { ...c, status: child.status, ms: event.ms, ...textOf(event) } : c,
        )
  const updated: ActivityRow = { ...existing, children, status: groupStatus(children) }
  return rows.map((r) => (r.id === groupId ? updated : r))
}
