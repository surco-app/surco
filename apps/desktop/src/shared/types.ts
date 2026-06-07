import type { Chord } from './shortcuts'

export type ThemePref = 'system' | 'light' | 'dark'

export type OutputFormat = 'aiff' | 'mp3' | 'wav' | 'flac'

export type SearchProviderId = 'discogs'

// Optional loudness normalization applied during conversion. 'none' is the default
// so nothing is ever normalized unless the user opts in (globally in Settings or
// per-track in the editor). 'loudness' targets an integrated LUFS with a true-peak
// ceiling (two-pass loudnorm); 'peak' simply scales so the loudest sample hits a
// target dBFS. Both re-encode the audio, so they drop the source's Traktor cues.
export type NormalizeMode = 'none' | 'loudness' | 'peak'

export interface NormalizeConfig {
  mode: NormalizeMode
  // 'loudness' mode: integrated target and true-peak ceiling.
  targetLufs: number
  truePeakDb: number
  // 'peak' mode: the dBFS the loudest sample is scaled to.
  peakDb: number
}

export interface Settings {
  theme: ThemePref
  discogsToken: string
  outputDir: string
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  filenameFormat: string
  groupingPresets: string[]
  genrePresets: string[]
  trimWhitespace: boolean
  zeroPadTrack: boolean
  visibleFields: string[]
  requiredFields: string[]
  coverMaxSize: number
  coverSquare: boolean
  showSpectrum: boolean
  showLoudness: boolean
  // Default normalization applied to every conversion; mode 'none' (the default)
  // means conversions never touch loudness unless overridden per-track.
  normalize: NormalizeConfig
  // Per-command keyboard shortcut overrides (command id → chord). Absent ids use the
  // default from SHORTCUT_DEFAULTS; an empty-array value unbinds the command.
  shortcutOverrides: Record<string, Chord>
  hasSeenOnboarding: boolean
  conversionCount: number
}

export interface TrackMetadata {
  title: string
  artist: string
  album: string
  albumArtist: string
  year: string
  genre: string
  grouping: string
  comment: string
  trackNumber: string
  discNumber: string
  bpm: string
  key: string
  publisher: string
  catalogNumber: string
  remixArtist: string
  // The Discogs release this track was tagged from. Optional because most tracks
  // never carry it; auto-filled when a release is applied and writable as a tag.
  discogsReleaseId?: string
  // Star rating "1"–"5" (or "" for none) — written as the Traktor POPM byte on
  // ID3 and the Vorbis RATING comment on FLAC. Optional like the other extras.
  rating?: string
}

export interface DiscogsSearchResult {
  id: number
  title: string
  year?: string
  thumb?: string
  cover_image?: string
  format?: string[]
  label?: string[]
}

export interface DiscogsTrack {
  position: string
  title: string
  artists?: { name: string }[]
  // The track length as Discogs returns it, e.g. "5:47". Optional: some releases
  // (and many tracklist positions like headings) carry no duration.
  duration?: string
}

export interface DiscogsRelease {
  id: number
  title: string
  artists: { name: string }[]
  year?: number
  genres?: string[]
  styles?: string[]
  labels?: { name: string; catno: string }[]
  images?: { uri: string; type: string; resource_url: string }[]
  tracklist: DiscogsTrack[]
}

export interface ProcessJob {
  id: string
  inputPath: string
  outputName: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  // Strips any embedded artwork with no replacement, for when the user cleared
  // the cover. Only meaningful when no coverUrl/coverPath is supplied — a cover
  // source always wins over removal.
  removeCover?: boolean
  format?: OutputFormat
  // Per-track normalization override; falls back to the Settings default when
  // undefined. Captured when the conversion starts, like format.
  normalize?: NormalizeConfig
  // Where this track's last conversion landed, so re-exporting it overwrites its
  // own file silently while a collision with an unrelated file still prompts.
  previousOutputPath?: string
}

export interface CoverExportJob {
  name: string
  coverUrl?: string
  coverPath?: string
}

export interface AppleMusicAddJob {
  outputPath: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
}

export type ProcessStage = 'cover' | 'converting' | 'appleMusic'

export interface ProcessProgress {
  id: string
  stage: ProcessStage
}

export interface ProcessResult {
  outputPath: string
  // True when the export matched the source format and rewrote the original file
  // (tags + rename) instead of writing a copy to the output folder. The renderer
  // then repoints the track at outputPath, since the original it loaded is gone.
  inPlace: boolean
  // True when the user chose to skip a conflicting export: nothing was written, so
  // the renderer leaves the track untouched rather than marking it done.
  skipped?: boolean
}

export interface SpectrumResult {
  image: string
  // null when the cutoff analysis failed (e.g. ffmpeg errored) but the image
  // still rendered — the UI then hides the quality verdict instead of inventing one.
  cutoffHz: number | null
  sampleRateHz: number
}

// Read-only audio analysis shown beside the spectrum, measured in one ffmpeg pass
// (astats + ebur128). Integrated loudness and true peak can read -Infinity for
// digital silence, which the UI renders as "−∞" rather than a misleading number.
export interface LoudnessResult {
  integratedLufs: number
  truePeakDb: number
  lra: number
  // The astats-derived checks are each null when not measurable (mono, a silent
  // channel reading -inf, or ffmpeg printing nan) so the UI hides that pill rather
  // than showing "−∞ dB" / "NaN%".
  // |L − R| RMS difference in dB; null for mono or a dead channel. A large gap
  // means a channel imbalance (e.g. a misaligned phono cartridge on the rip).
  channelBalanceDb: number | null
  // |DC offset| of the Overall mix (0..1 of full scale). A biased capture wastes
  // headroom and adds clicks.
  dcOffset: number | null
  // Crest factor in dB (peak − RMS): the transient punch. Low means squashed.
  crestDb: number | null
  // Estimated noise floor in dB; lower is cleaner.
  noiseFloorDb: number | null
}

// Read-only technical facts about the source file, shown in the Properties panel.
// Probed once per file via ffprobe (stream + container) plus an fs.stat for the
// on-disk size and timestamps that the container doesn't carry.
export interface TrackProperties {
  // ffprobe codec_name, e.g. 'pcm_s16le', 'flac', 'mp3' — the encoded form.
  codec: string
  // The container's primary short name (first of ffprobe's comma-joined list).
  container: string
  sampleRateHz: number
  // Sample size in bits; null for lossy codecs that have no fixed bit depth, so
  // the UI hides the row instead of showing "0 Bit".
  bitDepth: number | null
  channels: number
  // Overall bitrate in kbps; null when neither the container nor the stream reports
  // one (the UI then omits it).
  bitrateKbps: number | null
  sizeBytes: number
  // Filesystem timestamps in epoch milliseconds; null when the platform can't read
  // a birth time.
  createdMs: number | null
  modifiedMs: number | null
  // Metadata containers sniffed from the file structure (e.g. ['ID3v2.3', 'INFO']),
  // since ffprobe reports tag values but not their envelope. Empty when none were
  // recognized.
  tagFormats: string[]
}
