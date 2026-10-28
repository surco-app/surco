import { useEffect, useRef } from 'react'
import { appleMusicFillPatch } from '../lib/appleMusicFill'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

const BATCH = 10

export const lacksMusicCover = (t: TrackItem): boolean =>
  !!t.fromAppleMusic &&
  !!t.musicPersistentId &&
  !t.loadingMeta &&
  !t.coverUrl &&
  !t.embeddedCover &&
  !t.coverRemoved

interface Params {
  tracks: TrackItem[]
  inScope: (t: TrackItem) => boolean
  onScreen: (id: string) => boolean
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
}

export function useAppleMusicArtwork({ tracks, inScope, onScreen, updateTrack }: Params): void {
  const asked = useRef(new Set<string>())
  const running = useRef(false)
  const latest = useRef({ tracks, inScope })
  latest.current = { tracks, inScope }
  const pump = useStableCallback(async (): Promise<void> => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const wanting = latest.current.tracks.filter(
          (t) => lacksMusicCover(t) && !asked.current.has(t.id) && latest.current.inScope(t),
        )
        if (wanting.length === 0) return
        const batch = [
          ...wanting.filter((t) => onScreen(t.id)),
          ...wanting.filter((t) => !onScreen(t.id)),
        ].slice(0, BATCH)
        for (const t of batch) asked.current.add(t.id)
        const covers = await window.api
          .appleMusicArtwork(batch.map((t) => t.musicPersistentId as string))
          .catch(() => ({}) as Awaited<ReturnType<typeof window.api.appleMusicArtwork>>)
        for (const t of batch) {
          const cover = covers[t.musicPersistentId as string]
          const now = latest.current.tracks.find((x) => x.id === t.id)
          const patch = cover && now ? appleMusicFillPatch(now, cover) : null
          if (patch) updateTrack(t.id, patch)
        }
      }
    } finally {
      running.current = false
    }
  })
  useEffect(() => {
    if (tracks.some((t) => lacksMusicCover(t) && inScope(t))) void pump()
  }, [tracks, inScope, pump])
}

export async function withMusicCover(
  track: TrackItem,
  updateTrack: (id: string, patch: Partial<TrackItem>) => void,
): Promise<TrackItem> {
  if (!lacksMusicCover(track)) return track
  const pid = track.musicPersistentId as string
  const cover = (await window.api.appleMusicArtwork([pid]).catch(() => null))?.[pid]
  const patch = cover ? appleMusicFillPatch(track, cover) : null
  if (!patch) return track
  updateTrack(track.id, patch)
  return { ...track, ...patch }
}
