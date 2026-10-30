import type { Verification } from '../../../shared/verification'

const dropped = new Map<string, Map<string, Verification>>()

export function bufferDroppedVerification(trackId: string, v: Verification): void {
  const byJob = dropped.get(trackId) ?? new Map<string, Verification>()
  const key = v.job ?? ''
  const held = byJob.get(key)
  if (!held || (v.seq ?? 0) > (held.seq ?? 0)) byJob.set(key, v)
  dropped.set(trackId, byJob)
}

export function clearDroppedVerifications(): void {
  dropped.clear()
}

export function settleVerification(
  trackId: string,
  returned: Verification | undefined,
  live: Verification | undefined,
): Verification | undefined {
  const buffered = dropped.get(trackId)?.get(returned?.job ?? '')
  dropped.delete(trackId)
  if (!returned) return returned
  let best = returned
  for (const candidate of [live, buffered]) {
    if (candidate && candidate.job === best.job && (candidate.seq ?? 0) > (best.seq ?? 0))
      best = candidate
  }
  return best
}
