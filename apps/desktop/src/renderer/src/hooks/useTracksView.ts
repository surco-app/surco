import { useQueryClient } from '@tanstack/react-query'
import { type RefObject, useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type { BeatgridResult, SpectrumResult, WaveformResult } from '../../../shared/types'
import { type AppleMusicIndex, isInLibrary } from '../lib/appleMusicLibrary'
import { duplicateIds } from '../lib/duplicates'
import type { LibrarySource } from '../lib/librarySource'
import { beatgridNeedsReview } from '../lib/beatgrid'
import { detectTrim } from '../lib/trim'
import type { TrackItem } from '../types'
import { beatgridOptions } from './useBeatgrid'
import { useLibraryMembership } from './useLibraryMembership'
import { spectrogramOptions } from './useSpectrogram'
import { waveformOptions } from './useWaveform'

// The three probe families the list reads, one entry per track, positionally aligned with
// `tracks`. Spectrum carries `fetching` too: a row with an analysis in flight shows a
// placeholder where its verdict dot will land, which the other two have no equivalent of.
interface CacheSnapshot {
  spectra: { data: SpectrumResult | undefined; fetching: boolean }[]
  waves: (WaveformResult | null | undefined)[]
  grids: (BeatgridResult | null | undefined)[]
}

// Cheap positional compare so an unchanged cache hands back the same snapshot object.
// Query results are replaced wholesale (never mutated), so reference equality is the
// right test for "this probe's result changed".
function sameSnapshot(a: CacheSnapshot, b: CacheSnapshot): boolean {
  return (
    a.spectra.length === b.spectra.length &&
    a.waves.length === b.waves.length &&
    a.grids.length === b.grids.length &&
    a.spectra.every((s, i) => s.data === b.spectra[i].data && s.fetching === b.spectra[i].fetching) &&
    a.waves.every((w, i) => w === b.waves[i]) &&
    a.grids.every((g, i) => g === b.grids[i])
  )
}

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
  // The probe results the list displays, READ from the shared query cache the hover
  // prefetch, the analyze sweep and the editor all fill — never fetched here; the list
  // shows what others decoded and spends no analysis of its own.
  //
  // Read through a single cache subscription rather than a per-track useQueries. Two
  // reasons, and the second is the load-bearing one:
  //   · One observer instead of 3N. The old form also rebuilt 3N options objects on every
  //     App render (every keystroke, every progress tick) just to observe.
  //   · React Query only starts a query's gcTime countdown once its LAST observer goes
  //     away. An observer per track per family therefore pinned every analysed track's
  //     payload for the whole session — and the two heavy families are ~0.5 MB a track
  //     (8192 peaks + flags; a 1000x320 PNG as a base64 string). Rendering the list was
  //     what kept the memory alive, so no gcTime could ever collect it. Reading without
  //     observing is what lets HEAVY_PROBE_GC_MS actually fire.
  const client = useQueryClient()
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  )
  // useSyncExternalStore calls this on every render and demands the SAME reference back
  // when nothing changed, or it re-renders forever. So the snapshot is cached and only
  // re-minted when a value it holds actually differs — which is also exactly what keeps
  // the tracksView memo below from re-running the whole triage pipeline on every tick.
  const snapRef = useRef<CacheSnapshot | null>(null)
  const getSnapshot = useCallback((): CacheSnapshot => {
    const next: CacheSnapshot = {
      spectra: tracks.map((t) => {
        const q = client.getQueryCache().find({ queryKey: spectrogramOptions(t.inputPath).queryKey })
        return { data: q?.state.data as SpectrumResult | undefined, fetching: q?.state.fetchStatus === 'fetching' }
      }),
      waves: tracks.map(
        (t) =>
          client.getQueryData(waveformOptions(t.inputPath).queryKey) as
            | WaveformResult
            | null
            | undefined,
      ),
      grids: tracks.map(
        (t) =>
          client.getQueryData(beatgridOptions(t.inputPath).queryKey) as
            | BeatgridResult
            | null
            | undefined,
      ),
    }
    const prev = snapRef.current
    if (prev && sameSnapshot(prev, next)) return prev
    snapRef.current = next
    return next
  }, [client, tracks])
  const { spectra, waves, grids } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
