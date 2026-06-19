import type { RefObject } from 'react'
import { moveIndex } from '../lib/keymap'
import { pageScrollTop } from '../lib/scroll'
import type { Selection } from '../lib/selection'
import type { TrackItem } from '../types'

interface Params {
  // The on-screen order (after the quality filter and search) the keyboard steps through.
  visibleTracks: TrackItem[]
  selectedId: string | null
  setSelection: (selection: Selection) => void
  continuousPlayback: boolean
  // The floating player reserves the list's bottom strip, so paging must account for it.
  playerVisible: boolean
  playerTrack: TrackItem | null
  closePlayer: () => void
  // Row buttons by track id, the scroll pane, and the sticky filter header — measured to
  // page the list ourselves rather than let the browser nudge a row flush to the margin.
  rowEls: RefObject<Map<string, HTMLButtonElement>>
  listScrollRef: RefObject<HTMLDivElement | null>
  qualityFilterRef: RefObject<HTMLDivElement | null>
}

export interface ListNavigation {
  moveSelection: (delta: number) => void
  onTrackEnded: () => void
}

// Keyboard/continuous-playback navigation over the visible list: move the selection by a
// step, follow it with DOM focus, and page the scroll pane to keep the row in view.
export function useListNavigation({
  visibleTracks,
  selectedId,
  setSelection,
  continuousPlayback,
  playerVisible,
  playerTrack,
  closePlayer,
  rowEls,
  listScrollRef,
  qualityFilterRef,
}: Params): ListNavigation {
  function moveSelection(delta: number): void {
    // Step through the rows the user can actually see (after the quality filter and the
    // search), so arrow/j-k navigation never lands on a track hidden by the current view —
    // and so the index lines up with the rendered rows queried below.
    const next = moveIndex(
      visibleTracks.length,
      visibleTracks.findIndex((t) => t.id === selectedId),
      delta,
    )
    if (next === -1) return
    setSelection({ ids: [visibleTracks[next].id], anchor: visibleTracks[next].id })
    // Move DOM focus with the selection so the native focus ring follows the
    // keyboard instead of staying on the last clicked row, which left two rows
    // looking highlighted at once. preventScroll: we page the list ourselves below
    // rather than let the browser nudge the row flush to the margin.
    const row = rowEls.current.get(visibleTracks[next].id)
    if (!row) return
    row.focus({ preventScroll: true })
    const container = listScrollRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const rRect = row.getBoundingClientRect()
    const header = qualityFilterRef.current
    const top = pageScrollTop({
      delta,
      rowTop: rRect.top - cRect.top,
      rowBottom: rRect.bottom - cRect.top,
      viewport: container.clientHeight,
      headerH: header?.offsetHeight ?? 0,
      // The floating player reserves the list's bottom 128px (pb-32 above).
      footerH: playerVisible && playerTrack ? 128 : 0,
      rowStep: rRect.height + 4, // row height + the gap-1 between rows
      scrollTop: container.scrollTop,
    })
    // Ease into the new page rather than snapping, so the eye can follow the jump.
    if (top !== null) container.scrollTo({ top, behavior: 'smooth' })
  }

  // When a track finishes: in continuous mode advance to the next visible track —
  // the selection-follows-playback effect plays it and moveSelection scrolls it
  // into view. Otherwise, or once the list runs out, close the player.
  function onTrackEnded(): void {
    const idx = visibleTracks.findIndex((t) => t.id === selectedId)
    if (continuousPlayback && idx >= 0 && idx + 1 < visibleTracks.length) {
      moveSelection(1)
    } else {
      closePlayer()
    }
  }

  return { moveSelection, onTrackEnded }
}
