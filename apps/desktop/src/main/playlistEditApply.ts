import type { RekordboxEditResult } from '../shared/types'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { editResultOfOutcome, type QueueOp } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'

export interface PlaylistEditHost {
  isRunning: () => Promise<boolean>
  queue: Pick<RekordboxQueue, 'applyNew' | 'drop' | 'outcomeOf'>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  beginLoose?: (collectionPath: string) => void
}

export async function applyEditOps(
  host: PlaylistEditHost,
  ops: QueueOp[],
  loosePath?: string,
): Promise<RekordboxEditResult[]> {
  if (loosePath !== undefined) host.beginLoose?.(loosePath)
  const result = await host.queue.applyNew(ops, async () => !(await host.isRunning()))
  if (result.status === 'applied') {
    const others = ops.reduce((rest, op) => withoutOp(rest, op.id), result)
    if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0)
      host.onApplied?.(others)
  }
  if (stillWaiting(result)) {
    host.onWaiting?.()
    return ops.map((op) => ({ applied: false, queued: true, opId: op.id }))
  }
  if (result.status === 'refused') {
    for (const op of ops) host.queue.drop(op.id)
    return ops.map(() => ({ applied: false, reason: result.reason }))
  }
  return ops.map((op) => {
    const written = host.queue.outcomeOf(op.id)
    const outcome =
      result.status === 'applied' ? result.outcomes.find((o) => o.id === op.id) : undefined
    return editResultOfOutcome(outcome ?? written)
  })
}
