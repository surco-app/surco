import { useQueries } from '@tanstack/react-query'
import { type RefObject, useMemo } from 'react'
import type { BeatgridResult, SpectrumResult, WaveformResult } from '../../../shared/types'
import { type AppleMusicIndex, isInLibrary } from '../lib/appleMusicLibrary'
import { duplicateIds } from '../lib/duplicates'
import type { LibrarySource } from '../lib/librarySource'
import { analysisOptions } from '../lib/analysisQueries'
import { beatgridNeedsReview } from '../lib/beatgrid'
import { detectTrim } from '../lib/trim'
import type { TrackItem } from '../types'
import { useLibraryMembership } from './useLibraryMembership'
import { spectrogramOptions } from './useSpectrogram'
import { waveformOptions } from './useWaveform'

// One cache entry per track: the inputs the merged view was built from (track object,
// cached spectrum/wave, library snapshot) plus the view itself, so an unchanged track
// keeps the same view reference across renders.
export interface ViewCacheEntry {
  track: TrackItem
  spectrum: SpectrumResult | undefined
  wave: WaveformResult | null | undefined
  grid: BeatgridResult | null | undefined
  index: AppleMusicIndex | null
  dup: boolean
  view: TrackItem
}

// Merges each track's cached spectrum and destination-library "already owned" verdict
// onto it, preserving object identity so the memoized list rows only re-render when
// their own data lands. The identity cache is owned by App (so its track-removal
// callbacks can evict an entry) and threaded in.
export function useTracksView(
  tracks: TrackItem[],
  viewCache: RefObject<Map<string, ViewCacheEntry>>,
  librarySource: LibrarySource,
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
  // Each track's decoded wave, observed the same passive way: whatever the player,
  // the editor strips or the analyze sweep decoded feeds the attention filters'
  // silence/clipping facts — the list itself never spends a decode.
  const waves = useQueries({
    queries: tracks.map((t) => ({
      ...waveformOptions(t.inputPath),
      enabled: false,
    })),
    combine: (results) => results.map((r) => r.data),
  })
  // The beatgrid detections, observed just as passively: whatever the Grid
  // section probed feeds the "grid to review" fact; the list never probes.
  const grids = useQueries({
    queries: tracks.map((t) => ({
      ...analysisOptions('beatgrid', t.inputPath, () => window.api.beatgrid(t.inputPath)),
      enabled: false,
    })),
    combine: (results) => results.map((r) => r.data as BeatgridResult | null | undefined),
  })
  // The session snapshot of the destination's library (Apple Music or Engine DJ),
  // fetched once there are tracks to check, so each row's "already owned" verdict is a
  // local lookup rather than a process per track. Null until it lands or with no source.
  const libraryIndex = useLibraryMembership(tracks.length, librarySource)
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
  const tracksView = useMemo(() => {
    // Cross-track by nature (a duplicate needs a partner), so it can't live in the
    // per-track cache compare — it's an input to it instead.
    const dups = duplicateIds(tracks)
    return tracks.map((t, i) => {
        const { data: spectrum, fetching } = spectra[i]
        const wave = waves[i]
        const grid = grids[i]
        // inLibraryResolved is the verdict the editor/sweep already confirmed against
        // the canonical Discogs match — the raw tags can't reach it here, so OR it in so
        // the list and filter agree with the editor's badge instead of reading not-owned.
        // What "Surco itself added it" means depends on the source: an Apple Music
        // persistent ID only proves membership THERE, and an Engine add only there.
        const owned =
          librarySource === 'appleMusic'
            ? t.musicPersistentId || t.inLibraryResolved
            : t.engineDjAdded || t.inLibraryResolved
        const inLibrary = owned
          ? true
          : libraryIndex
            ? isInLibrary(libraryIndex, {
                title: t.meta.title,
                artist: t.meta.artist,
                durationSec: t.duration,
              })
            : undefined
        const dup = dups.has(t.id)
        if (!spectrum && fetching) {
          const view: TrackItem = { ...t, analyzing: true }
          // A hand-confirmed grid IS the review — only unconfirmed detections flag.
        if (grid && !t.beatgrid && beatgridNeedsReview(grid)) view.gridReview = true
        if (inLibrary !== undefined) view.inLibrary = inLibrary
          if (dup) view.duplicate = true
          return view
        }
        if (!spectrum && inLibrary === undefined && !dup && !wave && !grid) return t
        const cached = viewCache.current.get(t.id)
        if (
          cached &&
          cached.track === t &&
          cached.spectrum === spectrum &&
          cached.wave === wave &&
          cached.grid === grid &&
          cached.index === libraryIndex &&
          cached.dup === dup
        )
          return cached.view
        const view: TrackItem = { ...t }
        if (spectrum) view.spectrum = spectrum
        if (wave) {
          // The attention filters' facts, derived once per (track, wave) pair: a
          // staged trim clears the silence bucket — it's the "already retouched"
          // signal — while clipping follows the decoder's per-sample truth.
          view.audioIssues = {
            silence: !t.trim && detectTrim(wave) !== undefined,
            clipping: wave.clipped?.some(Boolean) ?? false,
          }
        }
        // A hand-confirmed grid IS the review — only unconfirmed detections flag.
        if (grid && !t.beatgrid && beatgridNeedsReview(grid)) view.gridReview = true
        if (inLibrary !== undefined) view.inLibrary = inLibrary
        if (dup) view.duplicate = true
        viewCache.current.set(t.id, {
          track: t,
          spectrum,
          wave,
          grid,
          index: libraryIndex,
          dup,
          view,
        })
        return view
      })
  }, [tracks, spectra, waves, grids, libraryIndex, librarySource])
  return { tracksView, libraryIndex }
}
