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
// PERSISTS the two peak checkboxes to Settings. That is deliberate (they are lasting
// preferences, unlike the mode and targets), but as a hidden write inside a ref-mirror it
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
    // The two peak checkboxes are lasting preferences (user feedback: a relaunch must
    // find them as they were left), unlike mode/targets which stay one-shot per track —
    // so an editor toggle writes just those flags back to Settings. The mount report
    // arrives with the Settings-seeded value, so it never writes.
    const cur = settings?.normalize
    if (!cur) return
    const removeDc = n.peakRemoveDc === true
    const perChannel = n.peakPerChannel === true
    if ((cur.peakRemoveDc === true) !== removeDc || (cur.peakPerChannel === true) !== perChannel)
      saveSettings({ normalize: { ...cur, peakRemoveDc: removeDc, peakPerChannel: perChannel } })
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
