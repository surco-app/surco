import type { Chord } from './shortcuts'

export type ThemePref = 'system' | 'light' | 'dark'

// UI language: 'system' follows the OS locale (Spanish if it starts with "es", else
// English), or pin one of the shipped locales. Persisted so the choice survives restarts.
export type LanguagePref = 'system' | 'en' | 'es'

export type OutputFormat = 'aiff' | 'mp3' | 'wav' | 'flac'

export type SearchProviderId = 'discogs' | 'bandcamp'

// How a search request competes for the provider's rate-limited budget. 'high' is the track
// the user is actively looking at (the editor's own search); 'low' is background work
// (auto-match, hover prefetch) that must yield to it. Defaults to 'low' when omitted.
export type SearchPriority = 'high' | 'low'

// Structured fields a caller knows about the track, used to build relaxed fallback
// queries when the main one finds nothing: search by catalog number (near-unique on
// Discogs), by title alone (when the artist string is junk), or with artist/title
// swapped (when the file name had them backwards).
export interface SearchHints {
  artist?: string
  title?: string
  catalogNumber?: string
}

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

export type KeyNotation = 'camelot' | 'musical'

export interface Settings {
  theme: ThemePref
  // UI language; 'system' (the default) follows the OS locale.
  language: LanguagePref
  discogsToken: string
  // Restrict Discogs search results to these release-format buckets (from DISCOGS_FORMATS,
  // e.g. "Vinyl", "CD"). Empty (the default) shows every format. A single selection
  // filters server-side via the API's `format` param; several filter client-side.
  discogsFormats: string[]
  // How many search results the editor's results column shows. Lower trims the noise tail;
  // the auto-match probe scans the full set regardless, so this never changes which match
  // is suggested.
  discogsMaxResults: number
  // Which catalog sources the editor search queries. Discogs is the default; Bandcamp is
  // opt-in. Order is irrelevant — results are merged and re-ranked by match relevance.
  searchProviders: SearchProviderId[]
  outputDir: string
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  // Whether a converted file is kept in the output folder. Default true. When false
  // and the track is added to Apple Music, Surco drops the output-folder copy after a
  // successful add (Apple Music keeps its own), so "Apple Music only" leaves no clutter
  // behind. Always honored as true when nothing is added to Apple Music, so a
  // conversion can never end up with no copy at all.
  keepOutputCopy: boolean
  // When true, an export rewrites the source file in place (in its own folder, keeping
  // the original base name) instead of writing a copy to the output folder — even when
  // the format differs, in which case the old-extension original is removed. Mutually
  // exclusive with Apple Music: the file stays put, nothing is added to the library.
  overwriteOriginal: boolean
  filenameFormat: string
  // When on, the output name is derived from filenameFormat automatically as metadata
  // changes, so the user never has to press "Regenerate"; a manual edit still wins. Off
  // by default: "load and convert" keeps the source file name until the user opts in.
  autoApplyFilename: boolean
  groupingPresets: string[]
  genrePresets: string[]
  trimWhitespace: boolean
  zeroPadTrack: boolean
  visibleFields: string[]
  requiredFields: string[]
  coverMaxSize: number
  coverSquare: boolean
  // When on, applying a release replaces an existing embedded cover if it's low-res,
  // upgrading to the release's larger image. Off by default so a present cover (even a
  // small one) is never swapped for a possibly-wrong release image without the user asking.
  replaceLowResCover: boolean
  showSpectrum: boolean
  showLoudness: boolean
  // When on, the bottom player shows its waveform strip; off collapses it and skips the
  // full-file decode entirely. Persisted so the choice sticks across tracks and restarts.
  showWaveform: boolean
  // When on, dropping files runs a Discogs search per track and auto-applies the
  // metadata of any high-confidence release match, without waiting for a click.
  // Off by default since it spends the token's rate limit across the whole crate.
  autoMatch: boolean
  // When on, finishing a track auto-advances to the next one in the visible list
  // and plays it; at the end of the list playback stops. Off by default.
  continuousPlayback: boolean
  // Which notation the key suggestion chip offers. Camelot by default — it's
  // what DJ software sorts by; musical names stay available for users who read
  // Am rather than 8A.
  keyNotation: KeyNotation
  // Default normalization applied to every conversion; mode 'none' (the default)
  // means conversions never touch loudness unless overridden per-track.
  normalize: NormalizeConfig
  // Per-command keyboard shortcut overrides (command id → chord). Absent ids use the
  // default from SHORTCUT_DEFAULTS; an empty-array value unbinds the command.
  shortcutOverrides: Record<string, Chord>
  hasSeenOnboarding: boolean
  conversionCount: number
  // The occasional stats + donate modal: "don't show again" and the last time it
  // appeared (ISO date, '' = never), which lib/donateNudge gates on.
  donateNudgeDismissed: boolean
  donateNudgeLastShown: string
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
  // The later additions, optional like the extras above so older constructors and
  // persisted tracks stay valid. Frames: TCOM/COMPOSER, TSRC/ISRC, TIT3/SUBTITLE
  // (Traktor's "Mix" field), TORY-TDOR/ORIGINALYEAR (the Discogs master year, as
  // opposed to `year`, the year of the pressing in hand).
  composer?: string
  isrc?: string
  mixName?: string
  originalYear?: string
  // Boolean-ish: '1' when the album is a various-artists compilation, '' when
  // not. Kept a string like every other field; written as TCMP/COMPILATION,
  // which is what makes Apple Music group VA albums instead of splitting them.
  compilation?: string
}

// A search hit normalized across providers. Discogs and Bandcamp fill what they
// carry and leave the rest empty (Bandcamp has no format/catalog), so the list and
// scoring stay provider-agnostic and a result only needs its `provider` to render
// the right pill and route its release fetch.
export interface SearchResult {
  provider: SearchProviderId
  id: number
  title: string
  year?: string
  thumb?: string
  cover_image?: string
  format?: string[]
  label?: string[]
  // The release's catalogue number (e.g. "DNA-2034"), the surest way to tell two pressings
  // apart in the results. Discogs returns it in the search JSON; absent for Bandcamp.
  catno?: string
  // Bandcamp releases are fetched by their page URL, not a numeric id; unset for
  // Discogs, which loads by `id`.
  releaseUrl?: string
  // Discogs' community stats (how many users have/want the release) — already in the
  // search JSON, used only as a ranking tie-break so the canonical pressing floats up
  // among equally-relevant rows. Absent for Bandcamp and sparse releases.
  community?: { have?: number; want?: number }
}

export interface ReleaseTrack {
  position: string
  title: string
  artists?: { name: string }[]
  // The track length as Discogs returns it, e.g. "5:47". Optional: some releases
  // (and many tracklist positions like headings) carry no duration.
  duration?: string
  // Per-track credits ("Written-By", "Producer", …) — the source of the composer field.
  extraartists?: { name: string; role: string }[]
}

export interface Release {
  provider: SearchProviderId
  id: number
  title: string
  artists: { name: string }[]
  year?: number
  genres?: string[]
  styles?: string[]
  labels?: { name: string; catno: string }[]
  images?: { uri: string; type: string; resource_url: string }[]
  tracklist: ReleaseTrack[]
  // Release-wide credits. `tracks` ("A1 to B2"), when present, scopes a credit to
  // part of the tracklist.
  extraartists?: { name: string; role: string; tracks?: string }[]
}

// What the import-time cover read hands the renderer: a bounded display thumbnail
// (kept for the whole session, so never the full-size picture) plus the art's
// original pixel size, which the low-res checks need — the thumbnail would lie.
export interface CoverRead {
  thumbUrl: string
  width: number
  height: number
}

// One import-time read of a file's tags, duration and cover together: the three used to
// be separate IPC calls that each re-probed the same file, so a big drop spawned four
// processes per track where two now suffice.
export interface MetaRead {
  tags: TrackMetadata
  duration: number | null
  cover: CoverRead | null
}

export interface ProcessJob {
  id: string
  inputPath: string
  outputName: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  // Take the art from this audio file's own embedded picture (full resolution,
  // extracted in main) — the renderer only holds a display thumbnail of it.
  coverFromFile?: string
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
  // The Apple Music persistent ID a previous add returned. When set, the automatic
  // Apple Music step updates that library copy in place instead of importing the
  // file again — re-converting an edited track must not duplicate it in Music.
  musicPersistentId?: string
}

export interface CoverExportJob {
  name: string
  coverUrl?: string
  coverPath?: string
  // Take the art from this audio file's own embedded picture (full resolution,
  // extracted in main) — the renderer only holds a display thumbnail of it.
  coverFromFile?: string
}

export interface AppleMusicAddJob {
  outputPath: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  // Take the art from this audio file's own embedded picture (full resolution,
  // extracted in main) — the renderer only holds a display thumbnail of it.
  coverFromFile?: string
}

// Syncs the editor's current metadata (and cover) onto the Apple Music library copy
// identified by persistentId. outputPath is the fallback when the user deleted that
// copy from Music — the file is imported afresh instead; it's absent in "Apple Music
// only" mode, where no converted file exists anymore, so a deleted copy fails loud.
export interface AppleMusicUpdateJob {
  persistentId: string
  outputPath?: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  // Take the art from this audio file's own embedded picture (full resolution,
  // extracted in main) — the renderer only holds a display thumbnail of it.
  coverFromFile?: string
}

// One artist/title pair to probe for in the Apple Music library. The lookup takes
// several — the live tags plus the Discogs-suggested track — so a song whose tags
// still hold the filename's rough spelling is found under its canonical name too.
export interface AppleMusicLookupCandidate {
  artist: string
  title: string
  // Length in seconds, when known. The library matcher uses it to tell different
  // versions of one title apart (a 6-minute mix vs an 8-minute one); absent on a row
  // Music reported no duration for, or on a Discogs-suggested candidate that carries none.
  durationSec?: number
}

export type ProcessStage = 'cover' | 'converting' | 'appleMusic'

export interface ProcessProgress {
  id: string
  stage: ProcessStage
}

// The kinds of background work the activity log surfaces. Each maps to a
// human-readable verb in the panel ("Buscando en Discogs", "Convirtiendo"…);
// kept as a closed union so the renderer can localize and icon them.
export type ActivityKind = 'discogs' | 'bandcamp' | 'cover' | 'convert' | 'analyze' | 'applemusic'

// Interpolation values for an activity i18n key (query text, a count, a title).
export type ActivityParams = Record<string, string | number>

// One step of background work, streamed main → renderer as it starts and ends.
// `id` correlates the start with its done/error so the panel updates the same
// row in place (same pattern as ProcessProgress' id).
//
// Text crosses the IPC boundary as i18n *keys*, not finished strings: the work
// originates in the main process, which has no renderer i18n, and the panel
// translates at render so the feed follows a language switch like the rest of the
// UI. `labelKey` titles the row (with `labelParams`); `detailKey`/`detailParams`
// is the translatable technical line ("12 resultados"); `detail` is a *raw* line
// for data that must not be translated — a request URL, a release title, a raw
// ffmpeg error. `ms` is the elapsed time, set on done/error.
//
// `group` collapses many noisy steps onto one row: an analyze sweep fires six
// probes per track, which as flat rows would bury everything else. Steps sharing
// a `group` (the track's file path) fold into a single row titled by `groupLabel`
// (a raw file name), with the individual probes as its expandable breakdown.
export interface ActivityEvent {
  id: string
  kind: ActivityKind
  phase: 'start' | 'done' | 'error'
  labelKey: string
  labelParams?: ActivityParams
  detail?: string
  detailKey?: string
  detailParams?: ActivityParams
  ms?: number
  group?: string
  groupLabel?: string
  // A web page this step points at (a Discogs/Bandcamp release), so the panel can
  // offer an "open in browser" affordance on the row. Set for release loads.
  url?: string
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
  // True when loudness normalization was requested but its measurement pass failed, so
  // the file was converted without it. The renderer surfaces a notice so the user knows
  // the loudness target wasn't applied, rather than the skip passing silently.
  normalizeSkipped?: boolean
  // True when the track went to Apple Music only and its output-folder copy was
  // removed, so outputPath is empty: the renderer marks the track added to Apple
  // Music instead of offering a "Show file" that points at nothing.
  addedToMusicOnly?: boolean
  // The persistent ID of the track's Apple Music library copy, set whenever the
  // conversion added or updated one. The renderer stores it so later syncs,
  // manual updates and reveals address this exact copy.
  musicPersistentId?: string
}

// A fixed-length envelope of max-abs peaks (each 0..1) for drawing the track's
// waveform strip. durationSec comes from the decoded sample count, so peak
// index ↔ seconds mapping is exact even when the container's duration lies.
export interface WaveformResult {
  peaks: number[]
  durationSec: number
}

export interface SpectrumResult {
  image: string
  // null when the cutoff analysis failed (e.g. ffmpeg errored) but the image
  // still rendered — the UI then hides the quality verdict instead of inventing one.
  cutoffHz: number | null
  sampleRateHz: number
  // True when the spectrum shows regenerated highs (an "enhancer"/upscaler
  // hump); cutoffHz then carries the source's real ceiling under the gloss.
  processed: boolean
  // True only when a sustained knee (a real codec lowpass) was found. When false,
  // cutoffHz is just how far a genuine smooth taper extends, so the verdict treats
  // it as good rather than grading the extent on the codec scale. Optional for
  // older cached/analyses without the field; the verdict then assumes a knee.
  hasKnee?: boolean
  // True when a >44.1 kHz file walls off at 22.05 kHz — a 44.1→48/96 upsample
  // (fake hi-res). Independent of the codec verdict; surfaced as a separate note.
  // Optional: undefined on older cached analyses and on native 44.1 kHz files.
  upsampled?: boolean
}

// One track in an Engine DJ export request. The renderer ships this serializable shape
// across IPC; the main process resolves it to an absolute path on disk (for the relative
// path Engine stores and the file size) before writing the SQLite library.
export interface EngineExportTrack {
  // The file Engine should reference — the converted output when there is one, else the source.
  path: string
  title: string
  artist: string
  album: string
  genre: string
  comment: string
  // Tags are strings in Surco; the main process parses bpm/year to the integers Engine wants.
  bpm: string
  year: string
  // Length in seconds, undefined when the probe never ran.
  durationSec?: number
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

// Tempo detected from the audio itself (onset-envelope autocorrelation in
// main). Surfaced as an editable suggestion next to the bpm field — never
// written to tags unattended, because detection can land on the wrong
// half/double-time octave and a silently wrong BPM is worse for a DJ than
// none. confidence (0–1) is the normalized autocorrelation peak.
export interface BpmResult {
  bpm: number
  confidence: number
}

// Musical key detected from the audio (chromagram × Krumhansl profiles in
// main). Like BpmResult, surfaced only as an editable suggestion: algorithmic
// key detection is materially less reliable than tempo, and a wrong key
// silently trusted ruins a harmonic mix. Both notations are returned so the
// UI can honour the user's key-notation setting.
export interface KeyResult {
  // Camelot wheel position, e.g. '8A'.
  camelot: string
  // Musical name in Mixed In Key's display convention, e.g. 'Am'.
  name: string
  confidence: number
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

// PNG data URLs the renderer rasterizes from the icon SVG: main cycles `frames`
// in the Dock while audio plays and restores `resting` when it stops.
export interface DockIconFrames {
  resting: string
  frames: string[]
}
