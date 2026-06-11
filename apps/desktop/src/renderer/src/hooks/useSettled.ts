import { useEffect, useState } from 'react'

// How long the selection must rest on a track before its expensive probes fire.
// Apple Music's lookup uses its own slightly longer debounce (it spawns osascript
// per query); this covers the worker DSP jobs and ffmpeg passes.
export const SELECTION_SETTLE_MS = 400

// True once the component has been mounted for `ms`. The editor remounts per track,
// so inside it this reads as "the selection has rested on this track": browsing a
// crate with j/k must not enqueue a serial DSP job (bpm/key) and an ffmpeg loudness
// pass for every row the user merely passed through. Cached results still render
// immediately — a disabled query keeps returning its cached data.
export function useSettled(ms: number): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), ms)
    return () => clearTimeout(id)
  }, [ms])
  return settled
}
