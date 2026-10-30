import { type RefObject, useEffect } from 'react'
import type { Verification } from '../../../shared/verification'
import { bufferDroppedVerification, clearDroppedVerifications } from '../lib/verificationBuffer'
import type { TrackItem } from '../types'

interface Params {
  tracksRef: RefObject<TrackItem[]>
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
}

export function useVerificationUpdates({ tracksRef, updateTrack }: Params): void {
  useEffect(() => {
    const off = window.api.onVerifyUpdate((trackId: string, verification: Verification) => {
      const track = tracksRef.current.find((t) => t.id === trackId)
      if (!track) return
      const held = track.verification
      if (held && held.job !== verification.job) {
        bufferDroppedVerification(trackId, verification)
        return
      }
      if (held && (verification.seq ?? 0) <= (held.seq ?? 0)) return
      updateTrack(trackId, { verification })
    })
    return () => {
      off()
      clearDroppedVerifications()
    }
  }, [tracksRef, updateTrack])
}
