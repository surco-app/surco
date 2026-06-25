import { useQueries } from '@tanstack/react-query'
import { type RefObject, useMemo } from 'react'
import type { SpectrumResult } from '../../../shared/types'
import { type AppleMusicIndex, isInLibrary } from '../lib/appleMusicLibrary'
import type { TrackItem } from '../types'
import { useAppleMusicLibrary } from './useAppleMusicLibrary'
import { spectrogramOptions } from './useSpectrogram'

// One cache entry per track: the inputs the merged view was built from (track object,
// cached spectrum, library snapshot) plus the view itself, so an unchanged track keeps
// the same view reference across renders.
export interface ViewCacheEntry {
  track: TrackItem
  spectrum: SpectrumResult | undefined
  index: AppleMusicIndex | null
  view: TrackItem
}

// Merges each track's cached spectrum and Apple Music "already owned" verdict onto it,
// preserving object identity so the memoized list rows only re-render when their own
// data lands. The identity cache is owned by App (so its track-removal callbacks can
// evict an entry) and threaded in.
export function useTracksView(
  tracks: TrackItem[],
  viewCache: RefObject<Map<string, ViewCacheEntry>>,
): { tracksView: TrackItem[]; libraryIndex: AppleMusicIndex | null } {
  // Each track's spectrum, read from the shared React Query cache the hover prefetch,
  // the analyze sweep and the editor all fill. enabled:false so the list only observes —
  // it never triggers an analysis itself. combine matters: its output is cached by the
  // observer until an underlying result changes, so this hook keeps a stable identity
  // across unrelated renders — without it, useQueries returns a fresh array per render,
  // which broke the tracksView memo below and re-ran the whole triage pipeline on every
  // keystroke and progress tick.
  const spectra = useQueries({
    queries: tracks.map((t) => ({
      ...spectrogramOptions(t.inputPath),
      enabled: false,
    })),
    combine: (results) => results.map((r) => ({ data: r.data, fetching: r.isFetching })),
  })
  // The session snapshot of the Apple Music library, fetched once there are tracks to
  // check, so each row's "already owned" verdict is a local lookup rather than an
  // osascript per track. Null until it lands / off macOS.
  const libraryIndex = useAppleMusicLibrary(tracks.length)
  // Merge each cached spectrum and the Apple Music verdict onto its track for the quality
  // triage and the list, preserving object identity (via viewCache, now keyed on the
  // library snapshot too) so memoized rows don't all re-render. Memoized so a progress
  // tick during an analyze/convert/match sweep doesn't rebuild the whole list (and re-run
  // the quality/auto-match scans below) on every re-render. A row whose analysis is still
  // in flight gets a transient `analyzing` view so the list can show a placeholder where
  // the verdict dot will land; it is minted per recompute (not cached) because it only
  // exists for the duration of the fetch. A track Surco itself added (musicPersistentId
  // set) is owned by definition, so it reads in-library even before the snapshot loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewCache is a stable ref passed in; its .get/.set are deliberately out of the deps so the merge recomputes only on its real inputs (a useRef created here would be auto-excluded, a param ref is not).
  const tracksView = useMemo(
    () =>
      tracks.map((t, i) => {
        const { data: spectrum, fetching } = spectra[i]
        // inAppleMusicResolved is the verdict the editor/sweep already confirmed against
        // the canonical Discogs match — the raw tags can't reach it here, so OR it in so
        // the list and filter agree with the editor's badge instead of reading not-owned.
        const inAppleMusic =
          t.musicPersistentId || t.inAppleMusicResolved
            ? true
            : libraryIndex
              ? isInLibrary(libraryIndex, t.meta)
              : undefined
        if (!spectrum && fetching)
          return inAppleMusic === undefined
            ? { ...t, analyzing: true }
            : { ...t, analyzing: true, inAppleMusic }
        if (!spectrum && inAppleMusic === undefined) return t
        const cached = viewCache.current.get(t.id)
        if (
          cached &&
          cached.track === t &&
          cached.spectrum === spectrum &&
          cached.index === libraryIndex
        )
          return cached.view
        const view: TrackItem = { ...t }
        if (spectrum) view.spectrum = spectrum
        if (inAppleMusic !== undefined) view.inAppleMusic = inAppleMusic
        viewCache.current.set(t.id, { track: t, spectrum, index: libraryIndex, view })
        return view
      }),
    [tracks, spectra, libraryIndex],
  )
  return { tracksView, libraryIndex }
}
