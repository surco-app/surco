import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useStableCallback } from './useStableCallback'
import { rereadTrackFileQueries, trackCuesQuery } from './useTrackCues'
import { useWindowFocus } from './useWindowFocus'

export const ANALYSIS_LOOK_MS = 5000

// rekordbox analyses a track while it stays open and writes the result into its library at
// once, but the cue editor keeps its read for good, so a track shown with Surco's grid stayed
// so until a restart (26/11). While it waits, it looks again on opening, every few seconds and
// on coming back to Surco; once the analysis is there, everything read from the track follows.
// Never under unsaved cues: the draft is keyed on the read and would be dropped.
export function useAnalysisArrival(contentId: string, waiting: boolean): void {
  const client = useQueryClient()
  const look = useStableCallback(async () => {
    const read = await client
      .fetchQuery({ ...trackCuesQuery(contentId), staleTime: 0 })
      .catch(() => null)
    if (read?.analysed) await Promise.all(rereadTrackFileQueries(client))
  })
  useEffect(() => {
    if (!waiting) return
    void look()
    const timer = setInterval(() => void look(), ANALYSIS_LOOK_MS)
    return () => clearInterval(timer)
  }, [waiting, look])
  useWindowFocus((focused) => {
    if (focused && waiting) void look()
  })
}
