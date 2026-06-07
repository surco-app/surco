import type {
  LoudnessResult,
  OutputFormat,
  ProcessStage,
  SpectrumResult,
  TrackMetadata,
  TrackProperties,
} from '../../shared/types'

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
  // Set when the user clears the artwork, so the conversion strips the embedded
  // cover instead of preserving it. Cleared again the moment a new cover is set.
  coverRemoved?: boolean
  spectrum?: SpectrumResult
  // EBU R128 loudness, measured once per input alongside the spectrum and shown
  // read-only. null when the measurement failed; undefined before it has run.
  loudness?: LoudnessResult | null
  // Read-only technical facts (codec, bit depth, channels, bitrate, file size and
  // timestamps), probed once per input. null when the probe failed; undefined
  // before it has run.
  properties?: TrackProperties | null
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
