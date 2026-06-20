import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, OutputFormat, Settings } from '../../../shared/types'
import { removeAnalysisQueries } from '../lib/analysisQueries'
import {
  type BatchOutcome,
  type BatchSummary,
  eligibleForBatch,
  summarizeBatch,
} from '../lib/batch'
import { coverSourceOf } from '../lib/coverSource'
import { exportedPatch } from '../lib/export'
import { DEFAULT_REQUIRED_FIELDS, missingRequired } from '../lib/fields'
import { sanitizeMeta } from '../lib/hygiene'
import { renderOutputName } from '../lib/outputName'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

interface Params {
  tracks: TrackItem[]
  settings: Settings | null
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  // Surfaced when a track converted without the requested loudness normalization (its
  // measurement failed), so the skip doesn't pass silently. Receives the track's label.
  onNormalizeSkipped?: (name: string) => void
  // Fired once after a convert-all run that produced at least one conversion — the
  // moment of value the donate nudge rides. Fires per run, never per track, so a
  // thirty-track batch triggers one evaluation, not thirty.
  onConversion?: () => void
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
export function useTrackProcessing({
  tracks,
  settings,
  updateTrack,
  onNormalizeSkipped,
  onConversion,
}: Params): TrackProcessing {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const [batching, setBatching] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
  // Set by cancelBatch to break the convert-all loop between tracks.
  const cancelBatchRef = useRef(false)
  // The convert-all loop and the Apple Music sweep outlive the render that started
  // them, while the list stays editable — each track must be read at the moment it's
  // processed, not from the closure's snapshot, or mid-batch edits never reach disk.
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  // The batch summary is a transient confirmation, not a persistent banner — it
  // clears itself a few seconds after a run so it never lingers over later work.
  useEffect(() => {
    if (!batchSummary) return
    const id = setTimeout(() => setBatchSummary(null), 6000)
    return () => clearTimeout(id)
  }, [batchSummary])

  const processOne = useStableCallback(
    async (
      id: string,
      formatOverride?: OutputFormat,
      normalizeOverride?: NormalizeConfig,
    ): Promise<BatchOutcome> => {
      const track = tracksRef.current.find((t) => t.id === id)
      // A track removed after being queued was a user decision, not a failure — count
      // it as skipped so the summary never reports an error with no visible row.
      if (!track) return 'skipped'
      const missing = missingRequired(
        track.meta,
        settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS,
      )
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
      // musicPersistentId deliberately survives the reset: it is what turns that next
      // add (manual or automatic) into a sync of the existing library copy.
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
      // their filename. A metadata-derived name is used when the editor's "Regenerate from
      // metadata" button (or a manual edit) set track.outputName, or — with auto-apply on —
      // derived live from the pattern when no manual name was set. A manual edit still wins.
      // Overwrite mode pins the name to the original regardless of any stale outputName,
      // so the rewrite lands back on the source file the user means to replace.
      const autoName = settings?.autoApplyFilename
        ? renderOutputName(settings.filenameFormat, meta)
        : ''
      const outputName = settings?.overwriteOriginal
        ? track.fileName
        : track.outputName?.trim() || autoName || track.fileName
      try {
        const result = await window.api.processTrack({
          id: track.id,
          inputPath: track.inputPath,
          outputName,
          meta,
          ...coverSourceOf(track),
          removeCover: track.coverRemoved,
          format: formatOverride,
          normalize: normalizeOverride,
          previousOutputPath: track.outputPath,
          musicPersistentId: track.musicPersistentId,
        })
        // The user declined to overwrite a conflicting file: nothing was written, so
        // leave the track convertible (idle) rather than marking it done or failed.
        if (result.skipped) {
          updateTrack(id, { status: 'idle', stage: undefined })
          return 'skipped'
        }
        // Converted, but the requested loudness normalization couldn't be measured, so the
        // file went out at its original level — tell the user rather than letting it pass.
        if (result.normalizeSkipped) onNormalizeSkipped?.(track.listLabel)
        updateTrack(id, exportedPatch(track, result))
        // An in-place export rewrote the source file — re-encoded, normalized, re-tagged —
        // so any cached probe of it now describes the old bytes. Evict both paths (they
        // differ when the rewrite also renamed) so the readouts measure the new file.
        if (result.inPlace) {
          removeAnalysisQueries(queryClient, track.inputPath)
          removeAnalysisQueries(queryClient, result.outputPath)
        }
        return 'converted'
      } catch (e) {
        updateTrack(id, {
          status: 'error',
          error: e instanceof Error ? e.message : tr('editor.processError'),
          stage: undefined,
        })
        return 'failed'
      }
    },
  )

  // Pushes an already-converted track into Apple Music by hand, the escape hatch
  // for when the automatic add is off. A track whose previous add stored a
  // persistent ID is synced onto that library copy instead of imported again —
  // which also means it needs no output file, so the action works in "Apple Music
  // only" mode where the conversion kept none. The meta is sanitized exactly as
  // the conversion does so the library entry matches the file; musicStatus drives
  // the button's adding/added/error states without disturbing the track's own
  // status.
  const addTrackToAppleMusic = useStableCallback(async (id: string): Promise<void> => {
    const track = tracksRef.current.find((t) => t.id === id)
    if (!track || track.musicStatus === 'adding') return
    const { musicPersistentId, outputPath } = track
    if (!musicPersistentId && !outputPath) return
    updateTrack(id, { musicStatus: 'adding', musicError: undefined })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true,
    })
    try {
      let persistentId: string | undefined
      if (musicPersistentId) {
        persistentId = await window.api.updateAppleMusic({
          persistentId: musicPersistentId,
          outputPath,
          meta,
          ...coverSourceOf(track),
        })
        // The library copy was deleted in Music (update found nothing): re-add the file so
        // it lands back in the library, instead of falsely reporting "added" on a track
        // that's gone. Mirrors the automatic convert path's update-or-add fallback.
        if (!persistentId && outputPath) {
          persistentId = await window.api.addToAppleMusic({
            outputPath,
            meta,
            ...coverSourceOf(track),
          })
        }
      } else if (outputPath) {
        persistentId = await window.api.addToAppleMusic({
          outputPath,
          meta,
          ...coverSourceOf(track),
        })
      }
      updateTrack(id, {
        musicStatus: 'added',
        musicPersistentId: persistentId ?? musicPersistentId,
      })
    } catch (e) {
      updateTrack(id, {
        musicStatus: 'error',
        musicError: e instanceof Error ? e.message : tr('editor.appleMusicError'),
      })
    }
  })

  // Adds every selected track to Apple Music in turn — the multi-select counterpart of
  // the per-track button, reusing the same single-track add (which skips ones not yet
  // converted) so the two paths can never drift. Runs through the shared batch state:
  // the top bar shows its progress and the same cancel that stops a convert-all stops
  // it between adds (an in-flight AppleScript add still finishes, like a conversion).
  const addAllToAppleMusic = useStableCallback(async (ids: string[]): Promise<void> => {
    if (batching) return
    cancelBatchRef.current = false
    setBatching(true)
    // Drop any lingering convert summary so its banner doesn't overlap this sweep.
    setBatchSummary(null)
    setBatchProgress({ done: 0, total: ids.length })
    try {
      let done = 0
      for (const id of ids) {
        if (cancelBatchRef.current) break
        await addTrackToAppleMusic(id)
        done += 1
        setBatchProgress({ done, total: ids.length })
      }
    } finally {
      setBatching(false)
    }
  })

  const processAll = useStableCallback(
    async (
      targets: TrackItem[],
      formatOverride?: OutputFormat,
      normalizeOverride?: NormalizeConfig,
    ): Promise<void> => {
      if (batching) return
      // Same completeness gate as the count/button: incomplete tracks aren't attempted (and
      // so aren't marked failed) — they stay flagged in the list for the user to finish.
      const ids = eligibleForBatch(targets, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
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
      // After the summary, never mid-run: a run that converted nothing (all skipped or
      // failed) is no moment of value, so asking for support then would read as nagware.
      if (results.includes('converted')) onConversion?.()
    },
  )

  const cancelBatch = useStableCallback((): void => {
    cancelBatchRef.current = true
  })

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
