import { sameAudioFormat } from '../../../shared/format'
import type { TrackItem } from '../types'

// What becomes of the file a format change superseded: retired once its checks are ok, or
// kept with the reason, which goes to the log (Do it.aiff stayed behind on 01/11 and nothing
// said why). Null while there is nothing to decide yet, or never anything to retire.
export type RetireDecision = { retire: string } | { keep: string; reason: string } | null

export function retireDecision(track: TrackItem): RetireDecision {
  const old = track.replacesPath ?? track.supersededPath
  const now = track.outputPath ?? track.inputPath
  if (track.status !== 'done' || !old || old === now || sameAudioFormat(old, now)) return null
  if (track.supersededTrashed || track.supersededKept) return null
  if (old === track.inputPath && track.originalTrashed) return null
  const check = track.verification
  if (!check || check.status === 'checking' || check.status === 'pending') return null
  if (check.status !== 'ok') {
    const failed = check.checks
      .filter((c) => c.state !== 'ok')
      .map((c) => `${c.place} ${c.detail.key}`)
    return { keep: old, reason: `the check came back ${check.status}: ${failed.join(', ')}` }
  }
  if (track.musicStatus === 'error') return { keep: old, reason: 'the Apple Music step failed' }
  if (track.oldMusicCopyKept)
    return { keep: old, reason: `Apple Music kept the old entry (${track.oldMusicCopyKept})` }
  if (
    track.musicPersistentId &&
    !check.checks.some((c) => c.place === 'appleMusic' && c.state === 'ok')
  )
    return { keep: old, reason: 'no Apple Music check came back ok' }
  return { retire: old }
}

export function autoRetiredFile(track: TrackItem): string | null {
  const decision = retireDecision(track)
  return decision && 'retire' in decision ? decision.retire : null
}
