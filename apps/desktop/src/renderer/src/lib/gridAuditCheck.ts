import { checkOfAudit, type GridCheck } from '../../../shared/gridAudit'

export async function auditCheckOf(
  contentId: string,
  beats: number[],
  priority: 'high' | 'low',
): Promise<GridCheck | null> {
  const audit = await window.api.cues.gridAudit(contentId, beats, priority).catch(() => null)
  if (!audit) return null
  const check = checkOfAudit(audit)
  return check.kind === 'unmeasured' ? null : check
}

export function beatsKey(beats: number[]): string {
  let hash = 2166136261
  for (const beat of beats) {
    hash ^= Math.round(beat * 10)
    hash = Math.imul(hash, 16777619)
  }
  return `${beats.length}:${hash >>> 0}`
}
