import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, OutputFormat, Settings } from '../../../shared/types'
import {
  type BatchOutcome,
  type BatchSummary,
  eligibleForBatch,
  summarizeBatch,
} from '../lib/batch'
import { exportedPatch } from '../lib/export'
import { DEFAULT_REQUIRED_FIELDS, missingRequired } from '../lib/fields'
import { sanitizeMeta } from '../lib/hygiene'
import type { TrackItem } from '../types'

interface Params {
  tracks: TrackItem[]
  settings: Settings | null
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
}

export interface TrackProcessing {
  processOne: (
    id: string,
    formatOverride?: OutputFormat,
    normalizeOverride?: NormalizeConfig,
  ) => Promise<BatchOutcome>
  processAll: (
    targets: TrackItem[],
    formatOverride?: OutputFormat,
    normalizeOverride?: NormalizeConfig,
  ) => Promise<void>
  addTrackToAppleMusic: (id: string) => Promise<void>
  addAllToAppleMusic: (ids: string[]) => Promise<void>
  batching: boolean
  batchProgress: { done: number; total: number }
  batchSummary: BatchSummary | null
  cancelBatch: () => void
}

// The conversion pipeline: convert a single track or a whole selection (with cancel and
// progress), and add converted tracks to Apple Music by hand. Owns the batch state so
// App doesn't carry it; reads the live tracks/settings and writes results back through
// updateTrack, exactly as the inline App functions did.
export function useTrackProcessing({ tracks, settings, updateTrack }: Params): TrackProcessing {
  const { t: tr } = useTranslation()
  const [batching, setBatching] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
  // Set by cancelBatch to break the convert-all loop between tracks.
  const cancelBatchRef = useRef(false)

  // The batch summary is a transient confirmation, not a persistent banner — it
  // clears itself a few seconds after a run so it never lingers over later work.
  useEffect(() => {
    if (!batchSummary) return
    const id = setTimeout(() => setBatchSummary(null), 6000)
    return () => clearTimeout(id)
  }, [batchSummary])

  async function processOne(
    id: string,
    formatOverride?: OutputFormat,
    normalizeOverride?: NormalizeConfig,
  ): Promise<BatchOutcome> {
    const track = tracks.find((t) => t.id === id)
    if (!track) return 'failed'
    const missing = missingRequired(track.meta, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
    if (missing.length) {
      const names = missing.map((k) => tr(`fields.${k}`)).join(', ')
      updateTrack(id, {
        status: 'error',
        error: tr('editor.missingRequired', { fields: names }),
        stage: undefined,
      })
      return 'failed'
    }
    // Re-processing an edited (stale) track resets the Apple Music state too, since
    // the file it referred to is being rewritten — the user may want to add it again.
    updateTrack(id, {
      status: 'processing',
      error: undefined,
      stage: undefined,
      format: formatOverride ?? settings?.outputFormat ?? 'aiff',
      musicStatus: undefined,
      musicError: undefined,
    })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true,
    })
    // Default to the source file's own name: users expect "load and convert" to keep
    // their filename. A metadata-derived name is only used when the editor's
    // "Regenerate from metadata" button (or a manual edit) set track.outputName.
    // Overwrite mode pins the name to the original regardless of any stale outputName,
    // so the rewrite lands back on the source file the user means to replace.
    const outputName = settings?.overwriteOriginal
      ? track.fileName
      : track.outputName?.trim() || track.fileName
    try {
      const result = await window.api.processTrack({
        id: track.id,
        inputPath: track.inputPath,
        outputName,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath,
        removeCover: track.coverRemoved,
        format: formatOverride,
        normalize: normalizeOverride,
        previousOutputPath: track.outputPath,
      })
      // The user declined to overwrite a conflicting file: nothing was written, so
      // leave the track convertible (idle) rather than marking it done or failed.
      if (result.skipped) {
        updateTrack(id, { status: 'idle', stage: undefined })
        return 'skipped'
      }
      updateTrack(id, exportedPatch(track, result))
      return 'converted'
    } catch (e) {
      updateTrack(id, {
        status: 'error',
        error: e instanceof Error ? e.message : tr('editor.processError'),
        stage: undefined,
      })
      return 'failed'
    }
  }

  // Pushes an already-converted track into Apple Music by hand, the escape hatch
  // for when the automatic add is off. The meta is sanitized exactly as the
  // conversion does so the library entry matches the file; musicStatus drives the
  // button's adding/added/error states without disturbing the track's own status.
  async function addTrackToAppleMusic(id: string): Promise<void> {
    const track = tracks.find((t) => t.id === id)
    if (!track?.outputPath || track.musicStatus === 'adding') return
    updateTrack(id, { musicStatus: 'adding', musicError: undefined })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true,
    })
    try {
      await window.api.addToAppleMusic({
        outputPath: track.outputPath,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath,
      })
      updateTrack(id, { musicStatus: 'added' })
    } catch (e) {
      updateTrack(id, {
        musicStatus: 'error',
        musicError: e instanceof Error ? e.message : tr('editor.appleMusicError'),
      })
    }
  }

  // Adds every selected track to Apple Music in turn — the multi-select counterpart of
  // the per-track button, reusing the same single-track add (which skips ones not yet
  // converted) so the two paths can never drift.
  async function addAllToAppleMusic(ids: string[]): Promise<void> {
    for (const id of ids) await addTrackToAppleMusic(id)
  }

  async function processAll(
    targets: TrackItem[],
    formatOverride?: OutputFormat,
    normalizeOverride?: NormalizeConfig,
  ): Promise<void> {
    if (batching) return
    const ids = eligibleForBatch(targets)
    cancelBatchRef.current = false
    setBatching(true)
    setBatchSummary(null)
    setBatchProgress({ done: 0, total: ids.length })
    const results: BatchOutcome[] = []
    try {
      for (const id of ids) {
        // Cancel stops the loop before the next track; the one already converting
        // in the main process can't be aborted, so it finishes and is counted.
        if (cancelBatchRef.current) break
        results.push(await processOne(id, formatOverride, normalizeOverride))
        setBatchProgress({ done: results.length, total: ids.length })
      }
    } finally {
      setBatching(false)
      setBatchSummary(summarizeBatch(results))
    }
  }

  function cancelBatch(): void {
    cancelBatchRef.current = true
  }

  return {
    processOne,
    processAll,
    addTrackToAppleMusic,
    addAllToAppleMusic,
    batching,
    batchProgress,
    batchSummary,
    cancelBatch,
  }
}
