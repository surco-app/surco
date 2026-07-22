import type { RefObject } from 'react'
import { jumpIndex, moveIndex, pageSize } from '../lib/keymap'
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

interface ListNavigation {
  moveSelection: (delta: number) => void
  // Home/End — jump to the first or last visible row.
  jumpSelection: (to: 'first' | 'last') => void
  // PageUp/PageDown — step by a viewport's worth of rows.
  pageSelection: (dir: -1 | 1) => void
  // Jump straight to a track by id (the command palette), selecting it and paging it
  // into view. No-op if the id isn't in the current visible list.
  revealSelection: (id: string) => void
  // Scroll the already-selected row back into view without changing the selection or
  // needing a travel direction — the "scroll to selected" button, usable when the row
  // has been scrolled far off-screen.
  scrollToSelected: () => void
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
  // Select the row at `next`, follow it with DOM focus, and page the scroll pane to keep
  // it in view. `delta` is the travel direction (sign) so paging eases toward the row from
  // the right edge. Shared by step (arrows/j-k), jump (Home/End) and page (PageUp/Down).
  function selectIndex(next: number, delta: number): void {
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

  function moveSelection(delta: number): void {
    // Step through the rows the user can actually see (after the quality filter and the
    // search), so arrow/j-k navigation never lands on a track hidden by the current view —
    // and so the index lines up with the rendered rows queried below.
    const current = visibleTracks.findIndex((t) => t.id === selectedId)
    selectIndex(moveIndex(visibleTracks.length, current, delta), delta)
  }

  function jumpSelection(to: 'first' | 'last'): void {
    selectIndex(jumpIndex(visibleTracks.length, to), to === 'first' ? -1 : 1)
  }

  function pageSelection(dir: -1 | 1): void {
    // A page is the rows that fit in the scroll pane; measure a real row (the selected one,
    // or the first rendered) so it tracks the row height instead of a guessed constant.
    const sample = rowEls.current.get(selectedId ?? visibleTracks[0]?.id ?? '')
    const rowStep = sample ? sample.getBoundingClientRect().height + 4 : 0
    const viewport = listScrollRef.current?.clientHeight ?? 0
    moveSelection(dir * pageSize(viewport, rowStep))
  }

  function revealSelection(id: string): void {
    const idx = visibleTracks.findIndex((t) => t.id === id)
    if (idx === -1) return
    // Page toward the target from wherever the selection sits, so a far jump scrolls the
    // row into view rather than leaving it off-screen behind the (now-closing) palette.
    const current = visibleTracks.findIndex((t) => t.id === selectedId)
    selectIndex(idx, current === -1 ? 1 : idx - current)
  }

  // Reveal the selected row unconditionally. Unlike revealSelection (which pages with a
  // travel direction), the row here is usually already the selection, so delta would be 0
  // and pageScrollTop would no-op. Instead centre the row in the visible band between the
  // sticky header and the floating player, and only scroll if it isn't already in view.
  function scrollToSelected(): void {
    if (!selectedId) return
    const row = rowEls.current.get(selectedId)
    const container = listScrollRef.current
    if (!row || !container) return
    const cRect = container.getBoundingClientRect()
    const rRect = row.getBoundingClientRect()
    const headerH = qualityFilterRef.current?.offsetHeight ?? 0
    const footerH = playerVisible && playerTrack ? 128 : 0
    const rowTop = rRect.top - cRect.top
    const rowBottom = rRect.bottom - cRect.top
    const visibleBottom = container.clientHeight - footerH
    // Already comfortably in the visible band — nothing to do.
    if (rowTop >= headerH && rowBottom <= visibleBottom) return
    const band = visibleBottom - headerH
    const top = container.scrollTop + rowTop - headerH - Math.max(0, (band - rRect.height) / 2)
    container.scrollTo({ top, behavior: 'smooth' })
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

  return {
    moveSelection,
    jumpSelection,
    pageSelection,
    revealSelection,
    scrollToSelected,
    onTrackEnded,
  }
}
