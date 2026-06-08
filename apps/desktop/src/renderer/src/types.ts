import type { OutputFormat, ProcessStage, SpectrumResult, TrackMetadata } from '../../shared/types'

export type TrackStatus = 'idle' | 'processing' | 'done' | 'error'

export interface TrackItem {
  id: string
  inputPath: string
  fileName: string
  query: string
  meta: TrackMetadata
  // Total length in seconds, probed when the file is added. Undefined when the
  // probe failed or has not run yet, so the row simply omits the time.
  duration?: number
  coverUrl?: string
  coverPath?: string
  // The artwork embedded in the file itself, captured once when the file is added
  // and never overwritten by a release match. The cover picker offers it as a
  // choice distinct from the release's images; a file with no embedded art has
  // none, so it contributes no slot. Undefined when the file carries no cover.
  embeddedCover?: string
  // Set when the user clears the artwork, so the conversion strips the embedded
  // cover instead of preserving it. Cleared again the moment a new cover is set.
  coverRemoved?: boolean
  // The spectrogram/cutoff verdict, not stored on the canonical track but merged in
  // from the React Query cache at the App boundary so the quality triage and the list
  // can read each track's verdict. Undefined until its analysis lands in the cache.
  spectrum?: SpectrumResult
  // Set when a Discogs match was applied automatically (auto-match on import or the
  // toolbar sweep) rather than by the user clicking a suggestion, so the row can flag
  // it and the list can filter for the auto-filled tracks to spot-check them.
  autoMatched?: boolean
  outputName?: string
  status: TrackStatus
  stage?: ProcessStage
  // The format this track is being / was last converted to, captured when the
  // run starts so the progress label reflects the user's pick rather than the
  // Settings default.
  format?: OutputFormat
  outputPath?: string
  // Snapshot of the editor (via trackSignature) taken when the track last
  // finished, so later edits flip it "stale" and bring back the convert button.
  processedSignature?: string
  error?: string
  // Tracks a manual "add to Apple Music" run, independent of status so the track
  // stays 'done' while it adds. 'error' carries the reason in musicError.
  musicStatus?: 'adding' | 'added' | 'error'
  musicError?: string
  // Set once the user trashes the source file after a real conversion, so the
  // "delete original" action disappears — the converted output and this row stay.
  originalTrashed?: boolean
}
