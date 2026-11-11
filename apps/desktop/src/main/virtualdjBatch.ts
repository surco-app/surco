import type { BatchResult, OpOutcome, QueueOp, TrackOp } from './rekordboxQueueOps'
import { applyVirtualdjCueOp } from './virtualdjCuesWrite'
import { applyVirtualdjDraftOps, type VirtualdjCommitDeps } from './virtualdjLibraryWrite'
import { applyVirtualdjListOps } from './virtualdjListsWrite'
import { applyVirtualdjTrack } from './virtualdjTrackWrite'

type Deps = VirtualdjCommitDeps & {
  ensureClosed: () => Promise<boolean>
  stillQueued?: (id: string) => boolean
}

const withLists = (op: QueueOp, placed: OpOutcome | undefined): op is TrackOp =>
  op.kind === 'track' &&
  placed?.applied === true &&
  !placed.uncounted &&
  (op.wanted.length > 0 || op.known.length > 0)

function merged(first: OpOutcome, second: OpOutcome | undefined): OpOutcome {
  if (!second) return first
  return { ...first, notices: [...first.notices, ...second.notices] }
}

export async function applyVirtualdjBatch(ops: QueueOp[], deps: Deps): Promise<BatchResult> {
  const lists = ops.filter((op) => op.kind === 'edit')
  const database = ops.filter((op) => op.kind !== 'edit')
  let first: BatchResult = { ok: true, wrote: false, outcomes: [] }
  if (database.length > 0)
    first = await applyVirtualdjDraftOps(database, deps, (draft, op, roots) =>
      op.kind === 'track'
        ? applyVirtualdjTrack(draft, op, roots)
        : applyVirtualdjCueOp(draft, op, roots),
    )
  if (!first.ok) return first
  const placed = new Map(first.outcomes.map((o) => [o.id, o]))
  const rows = database.filter((op) => withLists(op, placed.get(op.id)))
  if (lists.length + rows.length === 0) return first
  const second = await applyVirtualdjListOps([...lists, ...rows], deps)
  if (!second.ok) return second
  const listed = new Map(second.outcomes.map((o) => [o.id, o]))
  return {
    ok: true,
    wrote: first.wrote || second.wrote,
    outcomes: [
      ...first.outcomes.map((o) => merged(o, listed.get(o.id))),
      ...second.outcomes.filter((o) => !placed.has(o.id)),
    ],
  }
}
