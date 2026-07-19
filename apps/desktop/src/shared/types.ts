import type { EditorSectionPref } from './editorSections'
import type { Chord } from './shortcuts'

export type ThemePref = 'system' | 'light' | 'dark'

// UI language: 'system' follows the OS locale (collapsed to a shipped locale, English
// as the catch-all), or pin one of them. Persisted so the choice survives restarts.
export type LanguagePref = 'system' | 'en' | 'es' | 'de' | 'fr' | 'pt-BR'

export type OutputFormat = 'aiff' | 'mp3' | 'wav' | 'flac' | 'alac'

// MP3 encoder quality: fixed CBR rates (320 the DJ-pool default, the lower steps for
// space-constrained USBs), or LAME's VBR presets — V0 ≈ 245 kbps transparent, V2 ≈ 190
// kbps — whose variable rate some old CDJ firmwares dislike.
export type Mp3Quality = '320' | '256' | '192' | '160' | '128' | 'v0' | 'v2'

// Output bit depth for the lossless targets: 'source' (the default) preserves the
// source's exact width — never silently widening it — or the user pins 16/24.
export type OutputBitDepth = 'source' | '16' | '24'

// Output sample rate: 'source' (the default) never resamples; pinning 44.1/48 kHz
// unifies a library for gear that expects one rate.
export type OutputSampleRate = 'source' | '44100' | '48000'

// FLAC -compression_level: a pure size/speed trade-off, the decoded audio is
// identical at every level.
export type FlacCompression = '0' | '5' | '8'

// The quality knobs a conversion reads, bundled so the encode planner receives one
// coherent snapshot of the settings.
export interface ConversionQuality {
  mp3Quality: Mp3Quality
  bitDepth: OutputBitDepth
  sampleRate: OutputSampleRate
  flacCompression: FlacCompression
}

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
  // 'peak' mode extras, matching Audacity's Normalize dialog. Optional so configs
  // saved before they existed stay valid; absent reads as off.
  // Subtract each channel's mean before sizing the gain, reclaiming the headroom
  // a biased capture (a misaligned phono stage) wastes.
  peakRemoveDc?: boolean
  // Give each channel its own gain to the target instead of one shared gain —
  // trades the stereo image for both channels peaking at the same level.
  peakPerChannel?: boolean
}

// Optional vinyl click/pop repair applied during conversion (ffmpeg's adeclick,
// autoregressive interpolation of impulsive noise). 'off' is the default so audio
// is never altered unless the user opts in. 'standard' uses the filter's defaults,
// which fully repair typical 1-2 sample stylus clicks; 'strong' adds the minimal
// burst fusion that also repairs long pops. Applied before any normalization
// filter, so a gain calculation is never anchored to a click's false peak. Forces
// a re-encode, like normalization.
export type DeclickMode = 'off' | 'soft' | 'standard' | 'strong'

// Optional leading/trailing silence trim ("top and tail"), applied during
// conversion ahead of click repair and normalization. Absolute seconds into the
// source: audio before startSec and after endSec is cut. Either bound alone is
// valid — an absent startSec keeps the head, an absent endSec keeps the tail.
// The user confirms the exact seconds in the editor (the auto-detection only
// suggests), so the conversion cuts deterministically instead of re-detecting.
// Forces a re-encode, like normalization.
export interface TrimRange {
  startSec?: number
  endSec?: number
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
  // Junk phrases (rip-crew stamps, pool watermarks) stripped from titles and queries
  // before searching and scoring — no release ever carries them, so left in they sink
  // both. User-curated in Settings → Search, edited as comma-separated text.
  searchIgnoreWords: string[]
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
  // When true, the conversion lands as a fresh file in the source's own folder and the
  // original is never touched — the non-destructive sibling of overwriteOriginal. A
  // same-format export takes a "(n)" name (like keep-both) instead of prompting or
  // rewriting the source. Mutually exclusive with the other destinations (one radio).
  convertBesideOriginal: boolean
  // When true, a successful conversion is also registered in the Engine DJ library
  // database at engineLibraryDir. Engine references the file where it lives (it never
  // imports a copy), so the output-folder copy is always kept in this mode.
  addToEngineDj: boolean
  // The Engine DJ library folder whose Database2/m.db conversions are registered in.
  // Machine-local like outputDir — a filesystem path means nothing on another machine.
  engineLibraryDir: string
  // The root playlist Engine DJ conversions land in (the "what Surco just converted"
  // inbox), created on first use. 'Surco' by default; a blank save restores it.
  engineDjPlaylist: string
  filenameFormat: string
  // Pattern for rebuilding the title tag from other fields (e.g. "({trackNumber}) {title}").
  // Empty = the feature is hidden. Applied only on demand, never automatically: the
  // pattern references the title itself, so an automatic pass would stack prefixes.
  titleFormat: string
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
  // When on, covers smaller than coverMaxSize are scaled up to it on embed, so the
  // library art lands uniform (with coverSquare: exactly coverMaxSize squared).
  // Off by default: enlarging can't add real detail, so it's the user's call.
  coverUpscale: boolean
  // When on, applying a release replaces an existing embedded cover if it's low-res,
  // upgrading to the release's larger image. Off by default so a present cover (even a
  // small one) is never swapped for a possibly-wrong release image without the user asking.
  replaceLowResCover: boolean
  // macOS-only: prepend an ID3v2 header to FLAC outputs so Finder/QuickLook show the
  // cover (they never read FLAC's own PICTURE block). Off by default — the header is
  // technically off-spec, so it stays the user's call (see flacFinderCover.ts).
  flacFinderCovers: boolean
  // Encoder choice for MP3 exports. '320' (CBR) is the default: it's the de-facto
  // DJ-pool standard and every player seeks it reliably; the lower rates and the VBR
  // presets trade size. A source already in MP3 always stream-copies regardless —
  // re-encoding lossy-to-lossy only degrades it.
  mp3Quality: Mp3Quality
  // Bit depth for the lossless targets. 'source' (the default, max fidelity) preserves
  // the source's exact width; applies to re-encodes only — a file already in the output
  // format keeps its audio untouched.
  outputBitDepth: OutputBitDepth
  // Sample rate for every re-encode; 'source' (the default) never resamples.
  outputSampleRate: OutputSampleRate
  // FLAC encoder effort (size/speed only, the audio is identical); '5' is ffmpeg's own
  // default.
  flacCompression: FlacCompression
  showSpectrum: boolean
  showLoudness: boolean
  // Where the floating activity panel was last parked and its size, in window pixels.
  // Machine-local (screen-dependent), null until the user first moves or resizes it.
  activityPanel: { x: number; y: number; width: number; height: number } | null
  // The search-results column's width in the editor, in pixels. Machine-local
  // (screen-dependent), null until the user first drags its divider — the drag
  // used to reset on every track switch because the width lived in the panel.
  resultsWidth: number | null
  // When on, every imported track queues its quality analysis in the background (low
  // priority, same shared cache as the sweep), so suspect rips surface on their own
  // without pressing Analyze. Off by default: it spends an ffmpeg decode per drop.
  autoAnalyze: boolean
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
  // Default vinyl click repair applied to every conversion; 'off' (the default)
  // means conversions never touch the audio unless overridden per-track.
  declick: DeclickMode
  // The editor's sections in display order, each with its default fold state.
  // Read through normalizeEditorSections so files from older versions stay valid.
  editorSections: EditorSectionPref[]
  // Per-command keyboard shortcut overrides (command id → chord). Absent ids use the
  // default from SHORTCUT_DEFAULTS; an empty-array value unbinds the command.
  shortcutOverrides: Record<string, Chord>
  hasSeenOnboarding: boolean
  conversionCount: number
  // Lifetime activity tally behind the Stats tab, next to conversionCount. Bumped
  // only in the main process (stats:record fire-and-forget), so near-simultaneous
  // events from the renderer can't clobber each other's read-modify-write.
  stats: LifetimeStats
  // How many times each command palette entry has been run (command id → count), so the
  // palette can float a user's most-used commands to the top of a filtered list.
  commandUsage: Record<string, number>
  // The occasional stats + donate modal: "don't show again" and the last time it
  // appeared (ISO date, '' = never), which lib/donateNudge gates on.
  donateNudgeDismissed: boolean
  donateNudgeLastShown: string
  // The app version whose changelog the user last saw ('' = never stamped), which
  // lib/whatsNew gates the post-update "what's new" popup on.
  lastSeenChangelogVersion: string
}

export interface LifetimeStats {
  imported: number
  listened: number
  analyzed: number
  discogsMatches: number
  bandcampMatches: number
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
  // The DJ's own judgement of the track, which no provider can supply: the mood
  // (TMOO/MOOD) and the energy "1"–"5", "" for none. Energy has no standard frame,
  // so it rides TXXX "ENERGY", the key Mixed In Key writes and Traktor reads.
  // Kept strings like every other field.
  mood?: string
  energy?: string
}

// One track's editable state, persisted alongside the session paths so a crash or
// forced quit never loses metadata the user staged but hadn't converted yet. Keyed
// by the track's source path in the session file and overlaid onto the fresh file
// read when the next launch reopens the session.
export interface SessionEdit {
  meta: TrackMetadata
  outputName?: string
  // Only display URLs that survive a relaunch are stored: https release art. blob:
  // previews die with the renderer and the embedded-art data: thumb re-derives from
  // the file itself (persisting it would balloon the session file); blob-covered
  // tracks keep their coverPath and get a fresh preview minted at load.
  coverUrl?: string
  coverPath?: string
  coverRemoved?: boolean
  // Rides along so a restored "cleared" track still wipes its rating on convert.
  metaCleared?: boolean
  // The match flags ride along so the auto-match sweep doesn't re-probe a restored
  // track and overwrite the very metadata the restore just brought back.
  matched?: boolean
  autoMatched?: boolean
  matchConfidence?: number
  matchProvider?: SearchProviderId
  // The staged silence trim — seconds the user confirmed on the waveform but
  // hadn't converted yet, exactly the kind of edit this store exists to save.
  trim?: TrimRange
}

// What the session store round-trips: the loaded source paths (the reopen offer)
// plus each track's staged edits.
export interface SessionData {
  paths: string[]
  edits: Record<string, SessionEdit>
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
// Un tag que el fichero lleva pero que la app no gestiona (SERATO_MARKERS_V2, TRAKTOR4,
// MUSICBRAINZ_*, REPLAYGAIN_*…). El inspector los muestra y permite borrarlos. El valor
// puede venir truncado por ffprobe en blobs enormes; se muestra tal cual (solo lectura).
export interface ForeignTag {
  name: string
  value: string
}

export interface MetaRead {
  tags: TrackMetadata
  duration: number | null
  cover: CoverRead | null
  foreignTags: ForeignTag[]
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
  // The "clear metadata" action wiped every field, so the rating (which a normal
  // convert preserves-on-empty) must go too. Set alongside removeCover so a cleared
  // record keeps none of the tags the app manages. See writeTags.
  clearExtras?: boolean
  // Los tags de terceros que el usuario marcó para borrar en el inspector. Se aplican al
  // exportar tanto en la ruta ffmpeg (convertArgs) como en la TagLib (writeTags).
  foreignRemoved?: string[]
  format?: OutputFormat
  // Per-track normalization override; falls back to the Settings default when
  // undefined. Captured when the conversion starts, like format.
  normalize?: NormalizeConfig
  // Per-track click-repair override; falls back to the Settings default when
  // undefined. Captured when the conversion starts, like normalize.
  declick?: DeclickMode
  // The silence trim the user confirmed in the editor. No Settings fallback —
  // the exact seconds only exist per track, so it rides the job or not at all.
  trim?: TrimRange
  // Overwrite-original pinned when the batch started; falls back to the live setting
  // when undefined (single converts read it at click time). Pinned so a Settings flip
  // mid-batch can't turn the remaining queued tracks into unconfirmed in-place rewrites.
  overwriteOriginal?: boolean
  // The remaining destination facets, set together when the editor's split-button
  // overrides where this conversion goes (a one-shot pick, never persisted to
  // Settings). Each falls back to the live setting when undefined, like the
  // overwriteOriginal pin above.
  addToAppleMusic?: boolean
  keepOutputCopy?: boolean
  addToEngineDj?: boolean
  convertBesideOriginal?: boolean
  // The editor's explicit "Re-encode" action: render a same-format source again
  // (applying the pinned bit depth/sample rate) into the output folder instead of
  // the metadata-only in-place update. Never set by bulk conversions.
  forceReencode?: boolean
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
  // The Music persistent ID of the library row, so a matched entry can later be acted
  // on (deleted when the user replaces an old copy), not just detected. Absent on
  // probe candidates and on Engine DJ library rows, which have no Music identity.
  persistentId?: string
}

export type ProcessStage = 'cover' | 'converting' | 'appleMusic' | 'engineDj'

export interface ProcessProgress {
  id: string
  stage: ProcessStage
}

// The kinds of background work the activity log surfaces. Each maps to a
// human-readable verb in the panel ("Buscando en Discogs", "Convirtiendo"…);
// kept as a closed union so the renderer can localize and icon them.
export type ActivityKind =
  | 'discogs'
  | 'bandcamp'
  | 'cover'
  | 'convert'
  | 'analyze'
  | 'applemusic'
  | 'import'
  | 'export'
  // The auto-match sweep's verdicts. Unlike the rest, reported from the renderer (where
  // the probe decides), not the main process.
  | 'match'

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
  // How many audio samples the click repair interpolated, parsed from adeclick's
  // end-of-stream report. Absent when declick was off (a stream copy can't run it);
  // 0 means the filter ran and found the track already clean.
  declickedSamples?: number
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
  // True when the conversion registered the track in the Engine DJ library, so the
  // renderer can mark it owned there without waiting for a library snapshot refresh.
  addedToEngineDj?: boolean
}

// A fixed-length envelope of max-abs peaks (each 0..1) for drawing the track's
// waveform strip. durationSec comes from the decoded sample count, so peak
// index ↔ seconds mapping is exact even when the container's duration lies.
// rms carries each bucket's RMS body for the Audacity-style two-layer draw
// (peak outline + solid core); same grid as peaks, always rms[i] ≤ peaks[i].
export interface WaveformResult {
  peaks: number[]
  rms: number[]
  durationSec: number
}

// The native-rate scan the player/compare strip fetches on top of the peaks: true clip
// flags and the split L/R lanes. A separate probe (audio:waveform-scan) so the editor
// sections that draw only the envelope never pay for its heavy native decode. Every field
// aligns to the same WAVEFORM_BUCKETS grid as WaveformResult.peaks, so the renderer indexes
// clip flags straight by peak bucket.
export interface WaveformScan {
  // Per-bucket true digital clipping (a native-rate sample pinned at full scale,
  // Audacity's MAX_AUDIO line) — the peaks alone can't tell clipping from loud, so
  // the red marks read this. The probe resolves null when the scan failed: no marks.
  clipped: boolean[]
  // The same buckets per channel — envelope and clip flags — for the Audacity-style
  // split L/R view. Present only for stereo files (mono has nothing to split).
  channels?: { peaks: number[]; clipped: boolean[] }[]
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
