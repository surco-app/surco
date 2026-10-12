import type React from 'react'
import { useRef } from 'react'
import type {
  DeclickMode,
  FormatSetting,
  NormalizeConfig,
  OutputFormat,
  Settings,
} from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { useStableCallback } from './useStableCallback'

// What the user picked by hand in one track's split-button menu, kept for the session so
// returning to the track finds the button as it was left.
export interface RememberedPick {
  format?: OutputFormat
  destination?: Destination
}

interface EditorPicks {
  formatRef: React.RefObject<FormatSetting | null>
  destinationRef: React.RefObject<Destination | null>
  destinationPickRef: React.RefObject<Destination | null>
  normalizeRef: React.RefObject<NormalizeConfig | null>
  declickRef: React.RefObject<DeclickMode | null>
  onFormatChange: (format: FormatSetting | null) => void
  onDestinationChange: (destination: Destination, byHand?: boolean) => void
  onNormalizeChange: (n: NormalizeConfig) => void
  onDeclickChange: (d: DeclickMode) => void
  rememberedPick: (trackId: string) => RememberedPick | undefined
  // Called when the selection empties: the picks belong to the track that was open, and a
  // stale one would silently apply to whatever is opened next.
  reset: () => void
}

// What the editor's split-button currently says: the format, destination, normalization and
// click-repair the open track will convert with. Per track by design — the editor remounts
// on `key={selected.id}` and reports its seeded values back on mount — so these live in
// refs, read at conversion time rather than driving a render. A format or destination
// picked by hand is also remembered against the open track (openTrackId, null while
// several are selected) for the rest of the session, and seeds its editor next time.
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
  openTrackId: string | null,
): EditorPicks {
  const remembered = useRef(new Map<string, RememberedPick>())
  const openId = useRef(openTrackId)
  openId.current = openTrackId
  const remember = (patch: RememberedPick): void => {
    const id = openId.current
    if (id === null) return
    const next = { ...remembered.current.get(id), ...patch }
    if (next.format === undefined && next.destination === undefined) remembered.current.delete(id)
    else remembered.current.set(id, next)
  }
  // The format picked in the editor's split-button menu, for THIS track only.
  const formatRef = useRef<FormatSetting | null>(null)
  const destinationRef = useRef<Destination | null>(null)
  // The destination only when the user picked it in the menu. A seeded one is resolved
  // against the open track alone (a FLAC pins it to the folder), so a batch reads this.
  const destinationPickRef = useRef<Destination | null>(null)
  const normalizeRef = useRef<NormalizeConfig | null>(null)
  const declickRef = useRef<DeclickMode | null>(null)

  const onFormatChange = useStableCallback((format: FormatSetting | null) => {
    formatRef.current = format
    remember({ format: format === null || format === 'source' ? undefined : format })
  })
  const onDestinationChange = useStableCallback((destination: Destination, byHand = false) => {
    destinationRef.current = destination
    destinationPickRef.current = byHand ? destination : null
    remember({ destination: byHand ? destination : undefined })
  })
  const rememberedPick = useStableCallback((trackId: string) => remembered.current.get(trackId))
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
      // Centring applies to both modes now, so it persists like the rest of the dials.
      removeDcOffset: n.removeDcOffset === true,
      peakRemoveDc: n.peakRemoveDc === true,
      peakPerChannel: n.peakPerChannel === true,
    }
    if (
      cur.targetLufs !== next.targetLufs ||
      cur.truePeakDb !== next.truePeakDb ||
      cur.peakDb !== next.peakDb ||
      (cur.removeDcOffset === true) !== next.removeDcOffset ||
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
    destinationPickRef.current = null
    normalizeRef.current = null
    declickRef.current = null
  })

  return {
    formatRef,
    destinationRef,
    destinationPickRef,
    normalizeRef,
    declickRef,
    onFormatChange,
    onDestinationChange,
    onNormalizeChange,
    onDeclickChange,
    rememberedPick,
    reset,
  }
}
