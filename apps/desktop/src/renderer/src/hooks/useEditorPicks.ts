import type React from 'react'
import { useRef } from 'react'
import type { DeclickMode, NormalizeConfig, OutputFormat, Settings } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { useStableCallback } from './useStableCallback'

export interface EditorPicks {
  formatRef: React.RefObject<OutputFormat | null>
  destinationRef: React.RefObject<Destination | null>
  normalizeRef: React.RefObject<NormalizeConfig | null>
  declickRef: React.RefObject<DeclickMode | null>
  onFormatChange: (format: OutputFormat) => void
  onDestinationChange: (destination: Destination) => void
  onNormalizeChange: (n: NormalizeConfig) => void
  onDeclickChange: (d: DeclickMode) => void
  // Called when the selection empties: the picks belong to the track that was open, and a
  // stale one would silently apply to whatever is opened next.
  reset: () => void
}

// What the editor's split-button currently says: the format, destination, normalization and
// click-repair the open track will convert with. One-shot per track by design — the editor
// remounts on `key={selected.id}` and reports its freshly seeded values back on mount — so
// these live in refs, read at conversion time rather than driving a render.
//
// Gathered here because they were four refs, four writers and a reset smeared across App,
// and because one of those writers is not what it looks like: onNormalizeChange also
// PERSISTS the normalize values (the peak/loudness inputs and the two checkboxes) back
// to the global default, so the next track inherits them. Deliberate — they are lasting
// preferences, unlike the per-track mode — but as a hidden write inside a ref-mirror it
// was the last place a reader would think to look for a settings save.
export function useEditorPicks(
  settings: Settings | null,
  saveSettings: (patch: Partial<Settings>) => void,
): EditorPicks {
  // The format picked in the editor's split-button menu, for THIS track only.
  const formatRef = useRef<OutputFormat | null>(null)
  const destinationRef = useRef<Destination | null>(null)
  const normalizeRef = useRef<NormalizeConfig | null>(null)
  const declickRef = useRef<DeclickMode | null>(null)

  const onFormatChange = useStableCallback((format: OutputFormat) => {
    formatRef.current = format
  })
  const onDestinationChange = useStableCallback((destination: Destination) => {
    destinationRef.current = destination
  })
  const onNormalizeChange = useStableCallback((n: NormalizeConfig) => {
    normalizeRef.current = n
    // The values — the peak/loudness inputs AND the two checkboxes — are lasting
    // preferences (user feedback: the next track, and a relaunch, must find them as
    // they were left), so an editor edit writes them back to the global default. The
    // MODE is the exception: it stays one-shot per track (a track switching to peak
    // must not flip the global), so we keep the stored `mode` untouched. The mount
    // report arrives with the Settings-seeded values, so the guard skips its write.
    const cur = settings?.normalize
    if (!cur) return
    const next: NormalizeConfig = {
      mode: cur.mode,
      targetLufs: n.targetLufs,
      truePeakDb: n.truePeakDb,
      peakDb: n.peakDb,
      peakRemoveDc: n.peakRemoveDc === true,
      peakPerChannel: n.peakPerChannel === true,
    }
    if (
      cur.targetLufs !== next.targetLufs ||
      cur.truePeakDb !== next.truePeakDb ||
      cur.peakDb !== next.peakDb ||
      (cur.peakRemoveDc === true) !== next.peakRemoveDc ||
      (cur.peakPerChannel === true) !== next.peakPerChannel
    )
      saveSettings({ normalize: next })
  })
  const onDeclickChange = useStableCallback((d: DeclickMode) => {
    declickRef.current = d
  })

  const reset = useStableCallback(() => {
    formatRef.current = null
    destinationRef.current = null
    normalizeRef.current = null
    declickRef.current = null
  })

  return {
    formatRef,
    destinationRef,
    normalizeRef,
    declickRef,
    onFormatChange,
    onDestinationChange,
    onNormalizeChange,
    onDeclickChange,
    reset,
  }
}
