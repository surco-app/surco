import { type RefObject, useEffect } from 'react'
import type { Verification } from '../../../shared/verification'
import type { TrackItem } from '../types'

interface Params {
  tracksRef: RefObject<TrackItem[]>
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
}

export function useVerificationUpdates({ tracksRef, updateTrack }: Params): void {
  useEffect(
    () =>
      window.api.onVerifyUpdate((trackId: string, verification: Verification) => {
        if (!tracksRef.current.some((t) => t.id === trackId)) return
        updateTrack(trackId, { verification })
      }),
    [tracksRef, updateTrack],
  )
}
