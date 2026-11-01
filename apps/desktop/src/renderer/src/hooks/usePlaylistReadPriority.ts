import { useEffect, useRef } from 'react'
import type { TrackItem } from '../types'

// The open playlist's unread rows go to the front of the read queue once per opening, in
// list order. The rows on screen still jump ahead of them as they are reported visible.
export function usePlaylistReadPriority(
  playlistId: string | null,
  rows: readonly TrackItem[],
  prioritizeReads: (ids: string[]) => void,
): void {
  const moved = useRef<string | null>(null)
  useEffect(() => {
    if (playlistId === null || moved.current === playlistId || rows.length === 0) return
    moved.current = playlistId
    prioritizeReads(rows.filter((t) => t.loadingMeta).map((t) => t.id))
  }, [playlistId, rows, prioritizeReads])
}
