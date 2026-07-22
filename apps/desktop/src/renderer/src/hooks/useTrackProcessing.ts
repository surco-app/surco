import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hasFormatEquivalent, resolveJobFormat } from '../../../shared/format'
import type { DeclickMode, FormatSetting, NormalizeConfig, Settings } from '../../../shared/types'
import { removeAnalysisQueries } from '../lib/analysisQueries'
import {
  type BatchOutcome,
  type BatchSummary,
  eligibleForBatch,
  summarizeBatch,
} from '../lib/batch'
import { mapWithConcurrency } from '../lib/concurrency'
import { coverSourceOf } from '../lib/coverSource'
import { type Destination, fromDestination } from '../lib/destination'
import { exportedPatch } from '../lib/export'
import { DEFAULT_REQUIRED_FIELDS, missingRequired } from '../lib/fields'
import { sanitizeMeta } from '../lib/hygiene'
import { cleanIpcError } from '../lib/ipcError'
import { renderOutputName } from '../lib/outputName'
import { declickForJob, normalizeForJob } from '../lib/reapply'
import type { TrackItem } from '../types'
import { useStableCallback } from './useStableCallback'

// How many tracks convert at once in a bulk run. All logical cores but one (min 2): the
// audio encoders ffmpeg uses (lame, flac, alac, pcm) are single-threaded, so each
// conversion occupies about one core, and every ffmpeg child is spawned below-normal
// priority (see niceDecode in main/ffmpeg.ts) so the scheduler hands the UI and the
// surco:// audio stream their cores the moment they compete — the spare core is for
// them when everything is saturated. Chosen automatically rather than exposed as a
// setting — the real ceiling on a bulk run is Apple Music's serialized import, not the
// ffmpeg count, so a knob here would suggest more control than it delivers.
const CONVERT_CONCURRENCY = Math.max(2, (navigator.hardwareConcurrency || 4) - 1)

interface Params {
  tracks: TrackItem[]
  settings: Settings | null
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  // Surfaced when a track converted without the requested loudness normalization (its
  // measurement failed), so the skip doesn't pass silently. Receives the track's label.
  onNormalizeSkipped?: (name: string) => void
  // Surfaced when the click repair interpolated samples, with the count — the user's
  // confirmation that the pass did real work. Not fired on a clean track (0 repaired).
  onDeclicked?: (name: string, count: number) => void
  // Fired once after a convert-all run that produced at least one conversion — the
  // moment of value the donate nudge rides. Fires per run, never per track, so a
  // thirty-track batch triggers one evaluation, not thirty.
  onConversion?: () => void
  // Raised with the (IPC-prefix-free) message when a conversion fails, so the app can
  // toast it — the footer's one-line error row truncates anything long.
  onProcessError?: (message: string) => void
  // How many conversions overlap in a bulk run. Defaults to CONVERT_CONCURRENCY (all cores
  // but one); only overridden in tests, which pin it to make the concurrency deterministic.
  concurrency?: number
}

export interface TrackProcessing {
  processOne: (
    id: string,
    formatOverride?: FormatSetting,
    normalizeOverride?: NormalizeConfig,
    overwriteOverride?: boolean,
    forceReencode?: boolean,
    destinationOverride?: Destination,
    declickOverride?: DeclickMode,
  ) => Promise<BatchOutcome>
  processAll: (
    targets: TrackItem[],
    formatOverride?: FormatSetting,
    normalizeOverride?: NormalizeConfig,
    destinationOverride?: Destination,
    declickOverride?: DeclickMode,
  ) => Promise<void>
  addTrackToAppleMusic: (id: string) => Promise<void>
  addAllToAppleMusic: (ids: string[]) => Promise<void>
  batching: boolean
  batchProgress: { done: number; total: number }
  batchSummary: BatchSummary | null
  cancelBatch: () => void
  cancelOne: (id: string) => void
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
  onDeclicked,
  onConversion,
  onProcessError,
  concurrency = CONVERT_CONCURRENCY,
}: Params): TrackProcessing {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const [batching, setBatching] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
  // Set by cancelBatch to break the convert-all loop between tracks.
  const cancelBatchRef = useRef(false)
  // The ids the current run started with — cancelBatch also asks main to kill any
  // of these whose encode is already in flight, since the flag above only stops
  // ones not yet started (see main/activeConversions.ts).
  const runningIdsRef = useRef<string[]>([])
  // The convert-all loop and the Apple Music sweep outlive the render that started
  // them, while the list stays editable — each track must be read at the moment it's
  // processed, not from the closure's snapshot, or mid-batch edits never reach disk.
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks

  // The batch summary is a transient confirmation, not a persistent banner — it clears
  // itself a few seconds after a run so it never lingers over later work. A run that had
  // failures is the exception: its "N failed" count is worth reading after the fact, so it
  // stays until the next run replaces it rather than vanishing on the timer.
  useEffect(() => {
    if (!batchSummary || batchSummary.failed > 0) return
    const id = setTimeout(() => setBatchSummary(null), 6000)
    return () => clearTimeout(id)
  }, [batchSummary])

  const processOne = useStableCallback(
    async (
      id: string,
      formatOverride?: FormatSetting,
      normalizeOverride?: NormalizeConfig,
      overwriteOverride?: boolean,
      forceReencode?: boolean,
      destinationOverride?: Destination,
      declickOverride?: DeclickMode,
    ): Promise<BatchOutcome> => {
      const track = tracksRef.current.find((t) => t.id === id)
      // A track removed after being queued was a user decision, not a failure — count
      // it as skipped so the summary never reports an error with no visible row.
      if (!track) return 'skipped'
      // Already mid-conversion: the user hand-converted (or ⌘⏎'d) a still-idle track a
      // running batch had queued, or vice versa. A second job would write the same
      // output path at the same time — whoever started first owns the conversion.
      if (track.status === 'processing') return 'skipped'
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
      const pickedFormat = formatOverride ?? settings?.outputFormat ?? 'aiff'
      // 'source' promises to keep each file in its own format; a file whose format
      // resolveJobFormat can't express (Surco imports .opus/.ogg/.oga/.aac/.m4a/.mp4,
      // none of which have an OutputFormat) has nothing to keep it as. Converting it
      // anyway would fall back to a fixed format and, under overwrite, delete the
      // original once the fallback landed in its place — the opposite of what 'source'
      // means. Skipping is the only way to honor the promise: if the format can't be
      // kept, the file isn't touched. A concrete format pick is a deliberate override,
      // so it still converts normally.
      if (pickedFormat === 'source' && !hasFormatEquivalent(track.inputPath)) {
        updateTrack(id, { status: 'idle', stage: undefined })
        return 'skipped'
      }
      // The single point where the Default format setting becomes a real format. It has
      // to happen here, per track: 'source' is meaningless to the main process, and
      // sending `undefined` would make it read the setting itself and see 'source' too.
      const jobFormat = resolveJobFormat(pickedFormat, track.inputPath, 'aiff')
      // Re-processing an edited (stale) track resets the Apple Music state too, since
      // the file it referred to is being rewritten — the user may want to add it again.
      // musicPersistentId deliberately survives the reset: it is what turns that next
      // add (manual or automatic) into a sync of the existing library copy.
      updateTrack(id, {
        status: 'processing',
        error: undefined,
        stage: undefined,
        format: jobFormat,
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
      // A destination override expands to the full facet set: main falls back to
      // Settings per facet, so sending only the changed flag would mix the pick with
      // whatever the settings say for the rest. The explicit overwrite pin still wins
      // (a batch pinned it before the destination existed as an override).
      const destination = destinationOverride ? fromDestination(destinationOverride) : undefined
      const overwriteOriginal =
        overwriteOverride ?? destination?.overwriteOriginal ?? settings?.overwriteOriginal
      const outputName = overwriteOriginal
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
          clearExtras: track.metaCleared,
          foreignRemoved: track.foreignRemoved,
          format: jobFormat,
          normalize: normalizeForJob(track, normalizeOverride),
          declick: declickForJob(track, declickOverride),
          trim: track.trim,
          overwriteOriginal: overwriteOverride ?? destination?.overwriteOriginal,
          addToAppleMusic: destination?.addToAppleMusic,
          keepOutputCopy: destination?.keepOutputCopy,
          addToEngineDj: destination?.addToEngineDj,
          convertBesideOriginal: destination?.convertBesideOriginal,
          forceReencode,
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
        // Repaired clicks are the feature's visible proof-of-work, so the count is
        // surfaced; a clean track stays quiet (see onDeclicked's contract).
        if (result.declickedSamples) onDeclicked?.(track.listLabel, result.declickedSamples)
        // Record the config main actually applied — same fallback processTrack uses
        // when the job carries none — so the stale check compares against reality.
        updateTrack(
          id,
          exportedPatch(
            track,
            result,
            normalizeOverride ?? settings?.normalize,
            declickOverride ?? settings?.declick,
          ),
        )
        // Every conversion replaces the file at the output path, so probes cached for
        // it (the before/after comparison's waveform/loudness of a previous export)
        // describe bytes that no longer exist — without eviction a re-export keeps
        // showing the old output as "after". An in-place export additionally rewrote
        // the source, so its (possibly different, when renamed) path is evicted too.
        removeAnalysisQueries(queryClient, result.outputPath)
        if (result.inPlace) removeAnalysisQueries(queryClient, track.inputPath)
        return 'converted'
      } catch (e) {
        const message = e instanceof Error ? cleanIpcError(e.message) : tr('editor.processError')
        updateTrack(id, {
          status: 'error',
          error: message,
          stage: undefined,
        })
        onProcessError?.(message)
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
      // Back to zero, not left at {N,N}: the done/total pools into the top bar with the
      // other sweeps, and a finished batch must stop contributing to that fraction.
      setBatchProgress({ done: 0, total: 0 })
    }
  })

  const processAll = useStableCallback(
    async (
      targets: TrackItem[],
      formatOverride?: FormatSetting,
      normalizeOverride?: NormalizeConfig,
      destinationOverride?: Destination,
      declickOverride?: DeclickMode,
    ): Promise<void> => {
      if (batching) return
      // Same completeness gate as the count/button: incomplete tracks aren't attempted (and
      // so aren't marked failed) — they stay flagged in the list for the user to finish.
      const ids = eligibleForBatch(targets, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
      // Pin the settings that decide what a conversion DOES to the user's files: every
      // queued track converts under the settings the run started with, so a Settings
      // change mid-batch can't fork the run into another format or into unconfirmed
      // in-place rewrites. The rest (covers, destinations) stays live-read.
      const pinnedFormat: FormatSetting | undefined = formatOverride ?? settings?.outputFormat
      // A destination override IS the overwrite decision for the whole run (its facet
      // set includes overwriteOriginal), so the setting-derived pin only applies when
      // no destination was picked.
      const pinnedOverwrite = destinationOverride ? undefined : settings?.overwriteOriginal
      cancelBatchRef.current = false
      runningIdsRef.current = ids
      // A fresh run: let main forget any "apply to the rest" conflict choice the last batch
      // left, so this one starts asking again rather than reusing a stale decision.
      window.api.beginConversionBatch()
      setBatching(true)
      setBatchSummary(null)
      setBatchProgress({ done: 0, total: ids.length })
      let done = 0
      let results: BatchOutcome[] = []
      try {
        // Convert several tracks at once instead of one-at-a-time: ffmpeg spawns an
        // independent child per track, so a bulk run overlaps them up to CONVERT_CONCURRENCY.
        // The Apple Music add stays serialized in the main process (Music imports one file at
        // a time anyway), so this speeds up the ffmpeg-bound work without piling osascripts on
        // Music. Cancel is checked per task rather than breaking a loop: an already-running
        // conversion can't be aborted, but every not-yet-started one bails as 'skipped'.
        results = await mapWithConcurrency(ids, concurrency, async (id) => {
          if (cancelBatchRef.current) return 'skipped'
          const outcome = await processOne(
            id,
            pinnedFormat,
            normalizeOverride,
            pinnedOverwrite,
            undefined,
            destinationOverride,
            declickOverride,
          )
          done += 1
          setBatchProgress({ done, total: ids.length })
          return outcome
        })
      } finally {
        setBatching(false)
        runningIdsRef.current = []
        // Same zeroing as addAllToAppleMusic: a finished batch must leave the pooled
        // top-bar fraction, or the bar sticks at 100% and skews every later sweep.
        setBatchProgress({ done: 0, total: 0 })
        setBatchSummary(summarizeBatch(results))
      }
      // After the summary, never mid-run: a run that converted nothing (all skipped or
      // failed) is no moment of value, so asking for support then would read as nagware.
      if (results.includes('converted')) onConversion?.()
    },
  )

  const cancelBatch = useStableCallback((): void => {
    cancelBatchRef.current = true
    // Killing a job that already finished is a documented no-op in main, so this
    // can fire for every id the run started with without checking which are done.
    for (const id of runningIdsRef.current) window.api.cancelJob(id)
  })

  // Cancel a single in-flight conversion — the editor's convert button uses this so a
  // long single convert has the escape a batch always had. The job is keyed by track id
  // (processTrack passes id: track.id), and killing a finished job is a main-side no-op,
  // so the caller can fire this without racing the completion.
  const cancelOne = useStableCallback((id: string): void => {
    window.api.cancelJob(id)
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
    cancelOne,
  }
}
