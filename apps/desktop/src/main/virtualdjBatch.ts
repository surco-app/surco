import type { BatchResult, QueueOp } from './rekordboxQueueOps'
import { applyVirtualdjCuesBatch } from './virtualdjCuesWrite'
import { applyVirtualdjListOps } from './virtualdjListsWrite'

export async function applyVirtualdjBatch(
  ops: QueueOp[],
  deps: Parameters<typeof applyVirtualdjCuesBatch>[1],
): Promise<BatchResult> {
  const lists = ops.filter((op) => op.kind === 'edit')
  const cues = ops.filter((op) => op.kind !== 'edit')
  let first: BatchResult = { ok: true, wrote: false, outcomes: [] }
  if (cues.length > 0) first = await applyVirtualdjCuesBatch(cues, deps)
  if (!first.ok || lists.length === 0) return first
  const second = await applyVirtualdjListOps(lists, deps)
  if (!second.ok) return second
  return {
    ok: true,
    wrote: first.wrote || second.wrote,
    outcomes: [...first.outcomes, ...second.outcomes],
  }
}
