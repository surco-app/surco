import { type BatchResult, type OpOutcome, opRank, type QueueOp } from './rekordboxQueueOps'
import { applySeratoEdit } from './seratoCrateEdits'
import { applySeratoCuesBatch } from './seratoCuesWrite'
import { commitSeratoDraft, createSeratoDraft, type SeratoCommitDeps } from './seratoLibraryWrite'

export async function applySeratoLibraryOps(
  ops: QueueOp[],
  deps: SeratoCommitDeps & {
    ensureClosed: () => Promise<boolean>
    stillQueued?: (id: string) => boolean
  },
): Promise<BatchResult> {
  if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
  const draft = createSeratoDraft()
  const roots = deps.roots()
  const outcomes = new Map<string, OpOutcome>()
  const rank = (op: QueueOp): number => (op.kind === 'edit' ? -1 : opRank(op))
  for (const op of [...ops].sort((a, b) => rank(a) - rank(b))) {
    if (deps.stillQueued && !deps.stillQueued(op.id))
      outcomes.set(op.id, { id: op.id, applied: false, reason: 'cancelled', notices: [] })
    else if (op.kind === 'edit') outcomes.set(op.id, applySeratoEdit(draft, op, roots))
    else outcomes.set(op.id, { id: op.id, applied: false, reason: 'write-failed', notices: [] })
  }
  const written = await commitSeratoDraft(draft, deps)
  if (written !== 'written' && written !== 'nothing') return { ok: false, reason: written }
  return {
    ok: true,
    wrote: written === 'written',
    outcomes: ops.map((op) => outcomes.get(op.id) as OpOutcome),
  }
}

export async function applySeratoBatch(
  ops: QueueOp[],
  deps: SeratoCommitDeps & Parameters<typeof applySeratoCuesBatch>[1],
): Promise<BatchResult> {
  const library = ops.filter((op) => op.kind !== 'cues')
  const cues = ops.filter((op) => op.kind === 'cues')
  let first: BatchResult = { ok: true, wrote: false, outcomes: [] }
  if (cues.length > 0) first = await applySeratoCuesBatch(cues, deps)
  if (!first.ok || library.length === 0) return first
  const second = await applySeratoLibraryOps(library, deps)
  if (!second.ok) return second
  return {
    ok: true,
    wrote: first.wrote || second.wrote,
    outcomes: [...first.outcomes, ...second.outcomes],
  }
}
