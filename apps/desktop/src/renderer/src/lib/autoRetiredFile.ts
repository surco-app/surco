import { sameAudioFormat } from '../../../shared/format'
import type { TrackItem } from '../types'

export function autoRetiredFile(track: TrackItem): string | null {
  if (track.status !== 'done' || track.verification?.status !== 'ok') return null
  if (track.musicStatus === 'error' || track.oldMusicCopyKept) return null
  if (
    track.musicPersistentId &&
    !track.verification.checks.some((c) => c.place === 'appleMusic' && c.state === 'ok')
  )
    return null
  const old = track.replacesPath ?? track.supersededPath
  const now = track.outputPath ?? track.inputPath
  if (!old || old === now || sameAudioFormat(old, now)) return null
  if (track.supersededTrashed || track.supersededKept) return null
  if (old === track.inputPath && track.originalTrashed) return null
  return old
}
