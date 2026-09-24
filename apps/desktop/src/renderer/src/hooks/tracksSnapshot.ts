import { hashKey, type Query, type QueryClient } from '@tanstack/react-query'
import type { SpectrumResult, WaveformResult, WaveformScan } from '../../../shared/types'
import type { TrackItem } from '../types'
import { spectrogramOptions } from './useSpectrogram'
import { waveformOptions, waveformScanOptions } from './useWaveform'

// The three probe families the list reads, one entry per track, positionally aligned with
// `tracks`. Spectrum carries `fetching` too: a row with an analysis in flight shows a
// placeholder where its verdict dot will land, which the other two have no equivalent of.
export interface CacheSnapshot {
  spectra: { data: SpectrumResult | undefined; fetching: boolean }[]
  waves: (WaveformResult | null | undefined)[]
  // The clip/channel scan lives in its own probe since the split, so the clipping
  // attention fact reads from here rather than off the peaks wave.
  scans: (WaveformScan | null | undefined)[]
}

// The query-family names, in one place so the build, the per-track slot read and the
// incremental patch all agree on which name feeds which snapshot field.
export const SNAPSHOT_FAMILIES = ['spectrogram', 'waveform', 'waveformScan'] as const

// A cache lookup by key hash straight into the cache's own hash map, O(1) per key. find()
// scans the cache linearly, and indexing the whole cache per call costs a pass over it on
// every probe event, which over a sweep of a big library is quadratic.
export function cacheLookup(client: QueryClient): (key: readonly unknown[]) => Query | undefined {
  const cache = client.getQueryCache()
  return (queryKey) => cache.get(hashKey(queryKey)) as Query | undefined
}

// Reads one track's slot across all three families out of the cache index. Shared by the full
// build and the single-slot patch so a rebuilt slot is byte-for-byte identical to a patched
// one. Lives here (not inline in the hook) so a test can count slot reads: a full build reads
// N, a probe patch reads 1 — the assertion that a sweep tick doesn't walk the whole list.
function readSlot(inputPath: string, at: (key: readonly unknown[]) => Query | undefined) {
  const q = at(spectrogramOptions(inputPath).queryKey)
  return {
    spectrum: {
      data: q?.state.data as SpectrumResult | undefined,
      fetching: q?.state.fetchStatus === 'fetching',
    },
    wave: at(waveformOptions(inputPath).queryKey)?.state.data as WaveformResult | null | undefined,
    scan: at(waveformScanOptions(inputPath).queryKey)?.state.data as
      | WaveformScan
      | null
      | undefined,
  }
}

// The full positional snapshot: one pass over every track, three cache lookups each. The O(N)
// work that must run only when the track set changes — a probe event patches a single slot
// (patchSnapshot) instead.
export function buildCacheSnapshot(
  tracks: TrackItem[],
  at: (key: readonly unknown[]) => Query | undefined,
): CacheSnapshot {
  const spectra: CacheSnapshot['spectra'] = []
  const waves: CacheSnapshot['waves'] = []
  const scans: CacheSnapshot['scans'] = []
  for (const t of tracks) {
    const slot = readSlot(t.inputPath, at)
    spectra.push(slot.spectrum)
    waves.push(slot.wave)
    scans.push(slot.scan)
  }
  return { spectra, waves, scans }
}

// Re-reads one track's slot and, if any family's result actually changed, returns a new
// snapshot that reuses the unchanged family arrays by reference and swaps one entry in
// the changed one (a shallow copy). Returns the same snapshot untouched when nothing moved,
// so a spurious event (a query updating to the same reference) never re-renders the list.
export function patchSnapshot(
  prev: CacheSnapshot,
  index: number,
  inputPath: string,
  at: (key: readonly unknown[]) => Query | undefined,
): CacheSnapshot {
  const slot = readSlot(inputPath, at)
  const s = prev.spectra[index]
  const spectrumChanged = s.data !== slot.spectrum.data || s.fetching !== slot.spectrum.fetching
  const waveChanged = prev.waves[index] !== slot.wave
  const scanChanged = prev.scans[index] !== slot.scan
  if (!spectrumChanged && !waveChanged && !scanChanged) return prev
  // Reuse each unchanged family's array by reference; copy only the one that moved and swap
  // its one entry — so the merge's per-family memo sees a new identity for the changed family
  // alone, and the ~0.5 MB heavy arrays aren't reallocated for a probe that didn't touch them.
  const spectra = spectrumChanged ? prev.spectra.slice() : prev.spectra
  const waves = waveChanged ? prev.waves.slice() : prev.waves
  const scans = scanChanged ? prev.scans.slice() : prev.scans
  if (spectrumChanged) spectra[index] = slot.spectrum
  if (waveChanged) waves[index] = slot.wave
  if (scanChanged) scans[index] = slot.scan
  return { spectra, waves, scans }
}
