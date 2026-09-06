import { useEffect, useRef } from 'react'
import { growToSpare } from '../lib/resize'

// How much of the window the editor keeps for itself. The spectrum, the loudness table and
// the two-column metadata form are what the app is for; a track list wide enough to read is
// worth less than an editor that still works, so the columns only ever take what is left
// over once the editor has this much.
export const EDITOR_MIN_WIDTH = 560

export type GrowTarget = {
  // Current width of the column, in px.
  width: number
  // Largest px a row is clipped by, measured from the DOM (negative when every row fits).
  deficit: () => number
  max: number
  // Parks the column at a width without committing it, exactly as syncTo does: this is the
  // window resizing, not a gesture, so it must not overwrite the width the user chose.
  apply: (width: number) => void
}

// Widening the window handed every new pixel to the editor, because the two left columns
// are sized in px and the editor is the flex child — so a maximised window still showed
// "Turn the Spastik Florida (RC Re…". This gives the surplus to the columns that are
// actually clipped, in order, and only while the editor keeps EDITOR_MIN_WIDTH.
//
// Growth only. Narrowing the window is already the editor's problem, and pulling width back
// off a column mid-read is a change the user did not ask for.
export function useGrowColumnsOnResize(
  targets: GrowTarget[],
  enabled: boolean,
  // Total px everything left of the editor holds right now. Not derivable from `targets`:
  // the Discogs column occupies the row whether or not it is reported as growable, and a
  // budget blind to it hands the editor width that is already spoken for.
  occupied: () => number,
): void {
  // Read through a ref so the observer stays subscribed across the width updates it causes
  // — re-subscribing on every frame of a drag would thrash it.
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const occupiedRef = useRef(occupied)
  occupiedRef.current = occupied
  const lastWidth = useRef(0)

  useEffect(() => {
    if (!enabled) return
    if (typeof ResizeObserver === 'undefined') return

    lastWidth.current = window.innerWidth

    const grow = (): void => {
      const width = window.innerWidth
      const grew = width > lastWidth.current
      lastWidth.current = width
      if (!grew) return

      // What the columns may take: the window, less the editor's floor, less every column
      // that already holds width — the track list AND the Discogs column, which sits in the
      // same row. Counting only the growable ones left the editor with 560px on paper while
      // Discogs quietly took 470 of them, and the metadata form collapsed into one column.
      let spare = width - EDITOR_MIN_WIDTH - occupiedRef.current()
      if (spare <= 0) return

      for (const target of targetsRef.current) {
        const next = growToSpare({ width: target.width, deficit: target.deficit(), max: target.max }, spare)
        if (next === target.width) continue
        spare -= next - target.width
        target.apply(next)
        if (spare <= 0) return
      }
    }

    const observer = new ResizeObserver(grow)
    observer.observe(document.documentElement)
    return () => observer.disconnect()
  }, [enabled])
}
