import type { BackupPolicy } from './backupPolicy'
import type { CueFlow, FlowPhrase, PhraseSection } from './cueFlows'
import type { CueJumpBars } from './cueJump'
import type { CueQuantize } from './cueQuantize'
import type { StrongPart, WantedCue } from './cueRules'
import type { EditorSectionPref } from './editorSections'
import type { Chord } from './shortcuts'

export type ThemePref = 'system' | 'light' | 'dark'

// UI language: 'system' follows the OS locale (collapsed to a shipped locale, English
// as the catch-all), or pin one of them. Persisted so the choice survives restarts.
export type LanguagePref = 'system' | 'en' | 'es' | 'de' | 'fr' | 'pt-BR'

export type OutputFormat = 'aiff' | 'mp3' | 'wav' | 'flac' | 'alac'

// The Default format setting, which accepts one thing OutputFormat deliberately cannot:
// 'source' is a rule for picking a format per file, not a format. It stays on this side
// of the IPC — resolveJobFormat turns it into a real OutputFormat before a job is built,
// so the main process only ever sees formats it knows how to mux.
export type FormatSetting = OutputFormat | 'source'

// MP3 encoder quality: fixed CBR rates (320 the DJ-pool default, the lower steps for
// space-constrained USBs), or LAME's VBR presets — V0 ≈ 245 kbps transparent, V2 ≈ 190
// kbps — whose variable rate some old CDJ firmwares dislike.
export type Mp3Quality = '320' | '256' | '192' | '160' | '128' | 'v0' | 'v2'

// Output bit depth for the lossless targets: 'source' preserves the source's exact
// width — never silently widening it, and never narrowing it either — or the user
// pins 16/24. 'corrected' is a per-file policy, not a pin, and the bit-depth twin of
// the sample rate's: only files Surco proved to be 16-bit audio padded into a 24-bit
// container are written at their honest width, everything genuine keeps its own.
export type OutputBitDepth = 'source' | '16' | '24' | 'corrected'

// Output sample rate: 'source' (the default) never resamples; pinning 44.1/48 kHz
// unifies a library for gear that expects one rate. 'corrected' is a per-file
// policy, not a pin: only files Surco measured as upsampled from 44.1 kHz are
// written back at 44.1, everything genuine or unverified keeps its source rate.
export type OutputSampleRate = 'source' | '44100' | '48000' | 'corrected'

// FLAC -compression_level: a pure size/speed trade-off, the decoded audio is
// identical at every level.
type FlacCompression = '0' | '5' | '8'

// The quality knobs a conversion reads, bundled so the encode planner receives one
// coherent snapshot of the settings.
export interface ConversionQuality {
  mp3Quality: Mp3Quality
  bitDepth: OutputBitDepth
  sampleRate: OutputSampleRate
  flacCompression: FlacCompression
}

export type SearchProviderId = 'discogs' | 'bandcamp' | 'deezer' | 'beatport' | 'musicbrainz'

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
  // The file's album tag. Always sent by the renderer; the main process keeps it only
  // while "Search by album first" is on, so providers can try the release it names
  // before the track.
  album?: string
  // The user typed this album (with its artist) into the search box, which asks for the
  // album search whether or not "Search by album first" is on.
  albumTyped?: boolean
  // The year from the file's date tag. Discogs files hundreds of editions under one album
  // title, so the album search asks for this year's editions first.
  year?: string
  catalogNumber?: string
  // The recording's ISRC from the file's own tags (streaming rips carry it). Only the
  // Deezer provider consumes it: an exact-identity lookup that puts the original
  // release in the pool ahead of any fuzzy text match.
  isrc?: string
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
  // Subtract each channel's mean so a biased capture (a misaligned phono stage) is
  // centred. Applies to BOTH modes: centring is a correction of the signal, while the
  // mode only decides how the gain is then sized — a user fixing a vinyl rip and
  // normalizing to a loudness target needs the two together, which the peak-only
  // version below could not express.
  removeDcOffset?: boolean
  // 'peak' mode extras, matching Audacity's Normalize dialog. Optional so configs
  // saved before they existed stay valid; absent reads as off.
  // The peak-mode-only predecessor of removeDcOffset, kept so settings written by
  // earlier versions keep working: it still drives peakChannelFilter's combined
  // centre-and-scale expression, and getSettings migrates it forward.
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

// The vinyl section's whole setting: the click-repair intensity and the background-noise
// reduction, carried as one value because they are one stage of the filter chain and one
// choice in the editor — a track's override, the Settings default and a job all hold both.
export interface DeclickConfig {
  mode: DeclickMode
  noise: NoiseMode
}

// Background-noise reduction (surface hiss plus platter rumble), its own ladder beside the
// clicks: a different fault, so any intensity pairs with any click mode.
export type NoiseMode = 'off' | 'soft' | 'medium' | 'strong'

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

export interface ColumnShares {
  tree?: number
  list?: number
  results?: number
}

export interface Settings {
  theme: ThemePref
  // UI language; 'system' (the default) follows the OS locale.
  language: LanguagePref
  discogsToken: string
  beatportUsername: string
  beatportPassword: string
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
  // Search the tagged album (with the artist) before the track, falling back to the
  // track when it finds nothing. Off by default: a single's album tag is often junk,
  // and the track search is what every user had before.
  searchByAlbumFirst: boolean
  outputDir: string
  outputFormat: FormatSetting
  // When the export format is lossless, keep .mp3 sources as MP3 instead of
  // transcoding them: upconverting lossy audio can't restore quality and only grows
  // the file. Like any same-format export this edits the original in place (tags
  // rewritten where the file lives, no output-folder copy). Off by default.
  keepMp3Sources: boolean
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
  // How much of an in-place rewrite Surco keeps a copy of before replacing the file.
  // Only the overwrite destination reaches it: every other destination writes a new
  // file and leaves the source alone. See backupPolicy.ts for what the levels mean.
  backupPolicy: BackupPolicy
  // How long an original is kept before the sweep drops it, and how much room the whole
  // store may take. Sanitized on save (see backupPolicy.ts): they come from text fields.
  backupRetentionDays: number
  backupMaxGb: number
  // When true, a successful conversion is also registered in the Engine DJ library
  // database at engineLibraryDir. Engine references the file where it lives (it never
  // imports a copy), so the output-folder copy is always kept in this mode.
  addToEngineDj: boolean
  // The Engine DJ library folder whose Database2/m.db conversions are registered in.
  // Machine-local like outputDir — a filesystem path means nothing on another machine.
  engineLibraryDir: string
  // Traktor's collection.nml path. Machine-local — the folder doesn't exist on another Mac.
  // Empty by default: the feature is off until the user points Surco at their collection.
  traktorNmlPath: string
  // Whether a conversion writes back into each DJ collection. Separate from the paths
  // below: a path says WHERE the collection is, never whether to touch it.
  syncTraktor: boolean
  syncRekordbox: boolean
  completeCuesOnClose: boolean
  cueFlows: CueFlow[]
  activeCueFlow: string
  cueJumpBars: CueJumpBars
  cueQuantize: CueQuantize
  cueLettersByTime: boolean
  // Where a flow placed in one program's cue editor is placed too, on the same file.
  cueFlowToRekordbox: boolean
  cueFlowToTraktor: boolean
  cueFlowToEngine: boolean
  hiddenSources: PlaylistSource[]
  rekordboxPlaylistsFieldOffered: boolean
  syncEngineDj: boolean
  // Override for the rekordbox collection; empty means the standard location is used.
  rekordboxDbPath: string
  // Milliseconds every carried cue is nudged by, on top of the route calibration
  // (see cueCalibration.ts). Zero by default and expected to stay there: the conversion
  // already lands cues where they were. It exists for the DJ whose cues consistently feel
  // early or late in Traktor, which is about their ears and their rig rather than the
  // file — so unlike traktorNmlPath it is NOT machine-local, it follows the person.
  traktorCueOffsetMs: number
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
  // What joins several tags in the one Genre or Grouping text: ", " by default, "; " for
  // Plex, which splits a genre only there. Reading splits on it and nothing else.
  genreSeparator: string
  groupingSeparator: string
  trimWhitespace: boolean
  zeroPadTrack: boolean
  // Year holds the whole release date ("2020-12-01") when a source gives one, instead
  // of the year alone. Off by default: most DJ software shows and sorts by the year.
  fullReleaseDate: boolean
  asciiFileNames: boolean
  visibleFields: string[]
  // The user's own fields (Settings → Fields). Optional so settings saved before they
  // existed load unchanged; absent reads as none.
  customFields?: CustomField[]
  requiredFields: string[]
  // Which fields applying a Discogs release is allowed to fill. Separate from
  // visibleFields on purpose: hiding an input is about the form, not about whether a
  // release may overwrite the tag, and folding the two together would make hiding a
  // field quietly stop it being tagged. A field left out keeps whatever the file had.
  // Optional because every settings.json written before this existed lacks the key, and
  // absent has to keep meaning "import everything" — see normalizeImportFields.
  importFields?: string[]
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
  // The one-line teaching copy under the editor controls (what each normalization
  // mode does, what the peak ceiling is). On for newcomers; a user who knows the
  // section by heart turns it off here without losing the per-track plan card.
  showEditorHints: boolean
  // Where the floating activity panel was last parked and its size, in window pixels.
  // Machine-local (screen-dependent), null until the user first moves or resizes it.
  activityPanel: { x: number; y: number; width: number; height: number } | null
  // The search-results column's width in the editor, in pixels. No longer read: columnShares
  // replaced it. Kept so settings files that carry it stay valid.
  resultsWidth: number | null
  columnShares?: ColumnShares
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
  // When on, a finished load stages the extra spaces and invisible characters the list review
  // flags as cleaned values, and the second also the casing a clear majority of the list uses.
  autoCleanSpacing: boolean
  autoCleanCase: boolean
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
  declick: DeclickConfig
  // The editor's sections in display order, each with its default fold state.
  // Read through normalizeEditorSections so files from older versions stay valid.
  editorSections: EditorSectionPref[]
  // Per-command keyboard shortcut overrides (command id → chord). Absent ids use the
  // default from SHORTCUT_DEFAULTS; an empty-array value unbinds the command.
  shortcutOverrides: Record<string, Chord>
  hasSeenOnboarding: boolean
  // One-shot marker for the additive searchProviders migration that introduced Deezer.
  // Without it, "add if missing" would resurrect the source on every launch for a user
  // who deliberately unticked it. Synced, so a second Mac doesn't redo the migration.
  deezerProviderMigrated: boolean
  // The same one-shot marker for the addition that introduced MusicBrainz.
  musicbrainzProviderMigrated: boolean
  // One-shot marker for moving the old 'always' default onto 'audioChanges' (settings.ts).
  backupPolicyMigrated: boolean
  // One-shot marker for moving the old 30 days and 10 GB defaults onto 7 and 2 (settings.ts).
  backupLimitsMigrated: boolean
  trackImportFieldsMigrated: boolean
  mixInBarsMigrated?: boolean
  conversionCount: number
  // Lifetime activity tally behind the Stats tab, next to conversionCount. Bumped
  // only in the main process (stats:record fire-and-forget), so near-simultaneous
  // events from the renderer can't clobber each other's read-modify-write.
  stats: LifetimeStats
  // How many times each command palette entry has been run (command id → count), so the
  // palette can float a user's most-used commands to the top of a filtered list.
  commandUsage: Record<string, number>
  // Keys of the Music review groups (spelling and duplicates) the user chose to ignore.
  musicReviewIgnored: string[]
  listReviewIgnored: string[]
  // The occasional stats + donate modal: "don't show again" and the last time it
  // appeared (ISO date, '' = never), which lib/donateNudge gates on.
  donateNudgeDismissed: boolean
  donateNudgeLastShown: string
  // The app version whose changelog the user last saw ('' = never stamped), which
  // lib/whatsNew gates the post-update "what's new" popup on.
  lastSeenChangelogVersion: string
  // Takes prerelease builds on this machine. Machine-bound on purpose: a tester runs
  // betas on the laptop he tries them on and stable on the one he plays gigs from.
  betaUpdates: boolean
}

export interface LifetimeStats {
  imported: number
  listened: number
  analyzed: number
  discogsMatches: number
  bandcampMatches: number
  deezerMatches: number
  beatportMatches: number
  musicbrainzMatches: number
}

// An entry in Surco's own trash (main/surcoTrash.ts): a file a conversion replaced or
// renamed away, or one the user deleted on a volume with no OS Trash, kept for a while
// so a bad write is a restore rather than a loss.
export type TrashReason = 'replaced' | 'renamed' | 'deleted' | 'restored-over'

export interface TrashEntry {
  id: string
  name: string
  originalPath: string
  storedPath: string
  bytes: number
  trashedAt: number
  reason: TrashReason
  // The file that took the original's place, when a conversion caused the stash.
  outputPath?: string
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
  // The credits TagScanner and mp3tag edit that Surco only carried through untouched:
  // TOPE/ORIGARTIST, TEXT/LYRICIST, TPE3/CONDUCTOR. Hidden in the editor by default.
  originalArtist?: string
  lyricist?: string
  conductor?: string
  // The "of N" halves of the track and disc numbers: inside TRCK/TPOS ("3/12") on ID3,
  // TRACKTOTAL/DISCTOTAL on Vorbis, trkn/disk on MP4. Hidden in the editor by default.
  trackTotal?: string
  discTotal?: string
  // TCOP/COPYRIGHT and TENC/ENCODEDBY. Hidden by default, and while hidden the editor sends
  // them empty, which clears the previous owner's values on conversion.
  copyright?: string
  encodedBy?: string
  // The user's own fields (Settings → Fields), by key: vinylCondition → "VG+". Written to
  // the file as VINYLCONDITION: TXXX on ID3, a Vorbis comment, an iTunes freeform atom.
  custom?: Record<string, string>
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
  // What a collector normalizes a library by, all four straight off the Discogs release
  // and none of them with a standard frame — they ride TXXX/Vorbis under the names
  // mp3tag writes, so a collection tagged with that tool and one tagged here agree.
  // Style is Discogs' sub-classification ("Deep House") as opposed to the genre
  // ("Electronic"); the two used to be crushed into `genre`, style winning.
  style?: string
  // The pressing's country of release, e.g. "Spain".
  country?: string
  // What it was pressed on, flattened from Discogs' format list: "Vinyl, 12\", 33 ⅓ RPM".
  mediaType?: string
  // The release page the track was matched against — the way to re-check a doubtful
  // match months later without searching for it again.
  discogsUrl?: string
}

// The metadata fields that hold one text value each: every field but the user's own,
// which ride together in `custom`. Code that reads or writes a field as a string names
// its key with this.
export type MetaTextKey = Exclude<keyof TrackMetadata, 'custom'>

// What the last release applied to a track wrote over what it found, field by field, so
// the next release can take back what nobody touched since instead of leaving the first
// one's label, catalog number or Discogs id behind. Only the fields it changed are kept.
export interface AppliedRelease {
  before: Partial<Record<MetaTextKey, string>>
  wrote: Partial<Record<MetaTextKey, string>>
  cover?: { before: { url?: string; path?: string }; wrote: { url?: string; path?: string } }
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
  // The library copy this track belongs to, and whether it arrived from a playlist
  // import. Restored so a reopened row still offers to update that copy instead of adding
  // a second one, and still keeps the source's own format.
  musicPersistentId?: string
  fromAppleMusic?: boolean
  fromRekordbox?: boolean
  fromEngine?: boolean
  fromTraktor?: boolean
  // Rides along so a restored "cleared" track still wipes its rating on convert.
  metaCleared?: boolean
  // The per-tag inspector deletes, so a restored track still drops them on convert.
  foreignRemoved?: string[]
  // The match flags ride along so the auto-match sweep doesn't re-probe a restored
  // track and overwrite the very metadata the restore just brought back.
  matched?: boolean
  autoMatched?: boolean
  matchConfidence?: number
  matchProvider?: SearchProviderId
  // What the last applied release wrote, so the next one can still take it back after a
  // relaunch instead of leaving the wrong release's label and Discogs id behind.
  appliedRelease?: AppliedRelease
  // The staged silence trim — seconds the user confirmed on the waveform but
  // hadn't converted yet, exactly the kind of edit this store exists to save.
  trim?: TrimRange
  // The loudness and click repair dialled for this track, which the batch honours per
  // track: without them a reopened session converted with the Settings defaults.
  normalize?: NormalizeConfig
  declick?: DeclickConfig
  rekordboxPlaylists?: RekordboxPlaylistTarget[]
  rekordboxPlaylistsBase?: string[]
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
  // Where the release was pressed (e.g. "UK", "Europe") — with the format, what separates a
  // repress from the original in a list of near-identical results. Like catno, Discogs sends
  // it in the search JSON, so showing it costs no extra request; absent for Bandcamp/Deezer.
  country?: string
  // Bandcamp releases are fetched by their page URL, not a numeric id; unset for
  // Discogs, which loads by `id`.
  releaseUrl?: string
  // Discogs' community stats (how many users have/want the release) — already in the
  // search JSON, used only as a ranking tie-break so the canonical pressing floats up
  // among equally-relevant rows. Absent for Bandcamp and sparse releases.
  community?: { have?: number; want?: number }
  // This row names the file's exact recording, resolved by identity (Deezer's ISRC
  // lookup), not text search. The cross-provider re-rank keys on it: an album-titled
  // row loses any text-overlap contest against bootlegs echoing the track's own name,
  // and identity must survive that merge.
  exact?: boolean
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
  bpm?: string
  key?: string
  mixName?: string
  isrc?: string
}

export interface Release {
  provider: SearchProviderId
  id: number
  title: string
  artists: { name: string }[]
  year?: number
  // The release date as the source gives it: "1997-01-20", or Discogs' zeroed
  // "1997-01-00" / "1997-00-00" for the parts it does not know.
  released?: string
  genres?: string[]
  styles?: string[]
  labels?: { name: string; catno: string }[]
  // Where the release was pressed, what it was pressed on, and its public page. All
  // three come back in the same /releases response the rest of this shape is read from,
  // so surfacing them costs no extra request.
  country?: string
  formats?: { name: string; descriptions?: string[] }[]
  uri?: string
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
// A field the user added in Settings → Fields: the name shown in the editor and the key
// that names it everywhere else ({vinylCondition} in a filename pattern) and, upper-cased,
// in the file.
export interface CustomField {
  key: string
  label: string
}

export interface ForeignTag {
  name: string
  value: string
}

export interface MetaRead {
  tags: TrackMetadata
  duration: number | null
  cover: CoverRead | null
  foreignTags: ForeignTag[]
  // The review fields as the file spells them, only where that differs from the trimmed
  // tags: the list review looks for the stray spaces every other read trims away.
  reviewRaw?: ReviewRawFields
  // The probe failed and these fields are a fallback, not the file's contents. readMeta
  // degrades rather than rejecting (a transient failure must not cost the row), which
  // left a degraded read indistinguishable from a file that simply carries no tags —
  // so an unreadable one sat in the list saying nothing. Absent on a successful read.
  failed?: true
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
  // True when `meta` never came from the file: the import's tag read failed and the row
  // holds a name-parsed title and artist and nothing else. Main refuses such a job — a
  // read that failed must never become a write, or every managed field lands empty over
  // a file that still has them. The renderer re-reads a flagged row before sending it.
  metaUnread?: boolean
  format?: OutputFormat
  // Per-track normalization override; falls back to the Settings default when
  // undefined. Captured when the conversion starts, like format.
  normalize?: NormalizeConfig
  // Per-track click-repair override; falls back to the Settings default when
  // undefined. Captured when the conversion starts, like normalize.
  declick?: DeclickConfig
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
  // Where this track's last conversion landed, so re-exporting it overwrites its
  // own file silently while a collision with an unrelated file still prompts.
  previousOutputPath?: string
  // The identity (see inplace.ts fileIdentity) the file at previousOutputPath had when this
  // track wrote it. Only while the file there still has it is it this track's own.
  previousOutputIdentity?: string
  // The Apple Music persistent ID a previous add returned. When set, the automatic
  // Apple Music step updates that library copy in place instead of importing the
  // file again — re-converting an edited track must not duplicate it in Music.
  musicPersistentId?: string
  // The file this conversion supersedes, when it replaces a copy already in the library.
  // rekordbox indexes THAT path, not the one being converted: a FLAC downloaded into some
  // folder has never been in the collection, so without this the entry stayed on the old
  // MP3 while the library got a second copy.
  replacesPath?: string
  // The "artist - title" Music showed for that copy when it was offered. Retiring it is
  // checked against this name, never against the new tags: the copy was matched by score,
  // so the two rarely spell the same.
  replacesLabel?: string
  rekordboxPlaylists?: RekordboxPlaylistTarget[]
  rekordboxPlaylistsBase?: string[]
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

export type MusicReviewField = 'title' | 'artist' | 'albumArtist' | 'album' | 'genre'

export type ReviewRawFields = Partial<Record<MusicReviewField, string>>

export interface TagChange {
  from: string
  to: string
}

export interface LibraryTagUpdate {
  path: string
  fields: Partial<Record<MusicReviewField, TagChange>>
}

export interface MusicReviewEntry {
  persistentId: string
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  durationSec?: number
  dateAdded?: string
}

export interface MusicFieldFix {
  persistentId: string
  field: MusicReviewField
  from: string
  to: string
}

export interface RemoveCopyResult {
  outcome: 'removed' | 'missing' | 'mismatch' | 'playlist-failed' | 'failed'
  playlists: number
  fileTrashed: boolean
  // The file stayed on disk because rekordbox, Engine DJ or Traktor still uses it.
  keptForLibrary?: boolean
  // The removed copy's file and the kept copy's, when the removed entry had a file.
  pair?: DuplicatePair & { shared: boolean }
}

// A removed duplicate's file and the kept copy's file, for the DJ libraries to follow.
export interface DuplicatePair {
  from: string
  to: string
}

// What a DJ library holds for one copy: null when that copy is not in it.
export type LibraryCopyPresence = { cues?: number; playlists?: number } | null

// Only the libraries with their sync on that could be read.
export type LibraryCopyInfo = Partial<
  Record<'rekordbox' | 'engine' | 'traktor', LibraryCopyPresence>
>

export type CueLibrary = 'rekordbox' | 'engine' | 'traktor'

export type LibraryTracks = Partial<Record<CueLibrary, string>>

export type LibraryReplaceOutcome = 'repointed' | 'replaced' | 'none' | 'skipped' | 'failed'

export interface DuplicateReplaceOutcome {
  from: string
  rekordbox?: LibraryReplaceOutcome
  engine?: LibraryReplaceOutcome
  traktor?: LibraryReplaceOutcome
  fileTrashed: boolean
  keptForLibrary: boolean
  music?: ListMusicStep
  // Playlists in Music that now hold the kept copy instead.
  musicPlaylists?: number
  // The confirmed entry left Music even though the file stayed ('held': another entry has it).
  musicEntryRemoved?: true
  // The file stayed on disk because Apple Music still holds it.
  keptForMusic?: boolean
  // Nothing held the file any more and the Trash still refused it.
  trashFailed?: boolean
  // Trashed into Surco's backups, on a disk with no Trash of its own.
  inBackups?: true
  // Left alone: the list review could not rule out that the kept audio lives in this file.
  keptShared?: true
}

// A copy the list review removes: its file, the kept copy's file and its Apple Music entries.
export interface ListMusicRef {
  removePid: string
  label: string
  // The kept copy's entry; absent when the kept file is not in Music (or is there twice).
  keep?: { persistentId: string; label: string }
}
export interface ListRemoval {
  from: string
  to: string
  // The title the list showed, for the copy's Activity row.
  label: string
  // Absent when the renderer found no entry or could not ask: main reads Music itself.
  music?: ListMusicRef | 'ambiguous'
}
export type ListMusicStep =
  | 'none'
  | 'removed'
  | 'kept-no-entry'
  | 'ambiguous'
  // Music holds the file under an entry the renderer never found, so the file stays.
  | 'held'
  // Music's own read of its files failed (Automation denied, Music missing): nothing was
  // taken out of it and the file stays.
  | 'unchecked'
  | 'mismatch'
  | 'failed'

export interface ListMusicOutcome {
  step: ListMusicStep
  playlists?: number
  entryRemoved?: true
}

export type MusicFieldOutcome = 'set' | 'missing' | 'mismatch' | 'failed'

// `current` is the 1-based track being worked on; `done` counts the finished ones.
export interface MusicFixProgress {
  done: number
  total: number
  current: number
}

export interface MusicFixOutcome {
  persistentId: string
  path?: string
  fixes: MusicFieldFix[]
  music: MusicFieldOutcome[]
  file: 'written' | 'unchanged' | 'missing' | 'failed' | 'skipped'
  // The fields that reached the file; what the libraries follow.
  written: MusicReviewField[]
  backupId?: string
  error?: string
}

// One track as the review sees it: `id` is the Music persistent ID for the library review
// and the file path for the list review.
export interface ReviewEntry {
  id: string
  title: string
  artist: string
  albumArtist: string
  album: string
  genre: string
  durationSec?: number
  dateAdded?: string
}

export interface ReviewFix {
  id: string
  field: MusicReviewField
  from: string
  to: string
}

export interface ListFixRequest {
  fixes: ReviewFix[]
  // Path → the one Music entry on that file. A path with none or several is left out.
  music: Record<string, string>
  // Path → the title the list showed, for the Activity rows.
  titles: Record<string, string>
}

export interface MusicFileEntry {
  persistentId: string
  // "artist - name" exactly as Music holds it: what the delete and transfer scripts check.
  label: string
  dateAdded?: string
}

export interface MusicFileLookup {
  consulted: boolean
  entries: Record<string, MusicFileEntry[]>
}

// `music` runs parallel to `fixes`; 'none' is a field Music was never asked about.
export interface ReviewOutcome {
  id: string
  musicId?: string
  path?: string
  fixes: ReviewFix[]
  music: (MusicFieldOutcome | 'none')[]
  file: MusicFixOutcome['file']
  written: MusicReviewField[]
  backupId?: string
  error?: string
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

// One of the user's own Apple Music playlists, offered as a source of tracks to work on.
export interface AppleMusicPlaylist {
  // The folder this playlist lives in, absent at the root. Seven of the user's 22 playlist
  // names are repeated — four of them "95" — so the folder is the only thing telling two
  // rows apart in the picker.
  folder?: string
  name: string
  // What Music reports the playlist holds, streaming rows included: it is the number the
  // user sees in Music, and the only one they can check this list against.
  count: number
  persistentId: string
}

// What one playlist yields when imported: the files it references, and how many of its
// tracks have none (Apple Music streaming rows, iCloud tracks not downloaded). The count
// travels so the app can say why fewer rows arrived than the playlist claims.
// What the Music database knows about a track that its file may not. Measured on a real
// library: an untagged WAV carries title/artist/album/year/genre and nothing else, while
// Music holds the grouping, the artwork and the stars the user set. Every field is
// optional — absent means Music had nothing, and the file's own tag stands.
export interface AppleMusicTrackMeta {
  grouping?: string
  year?: string
  comment?: string
  trackNumber?: string
  discNumber?: string
  bpm?: string
  // The musical key, as the source spells it ("4B", "Am"). Only rekordbox supplies one:
  // Music has no key field.
  key?: string
  // 0-100 as Music scales it, and only when the user set it: Music also reports a rating
  // it computed itself (`rating kind: computed`), which is not an opinion to write into
  // anyone's files.
  rating?: number
  // The cover Music holds for this track, for a file that carries none of its own.
  // Measured on a real library: 53% of the tracks are in that state, almost all of them
  // WAVs, and they imported with an empty cover slot even though Music had the picture.
  // Absent when the file already carries its own art, which is what gets shown then.
  //
  // Both halves travel, like every other cover source in the app: the path is what a
  // conversion embeds, and the URL (to its copy in the thumbnail store) is what the
  // sandboxed renderer can actually display — it cannot load a file:// image.
  coverPath?: string
  coverUrl?: string
}

export interface AppleMusicPlaylistTracks {
  paths: string[]
  // Each imported file keyed to the persistent ID of the Music entry it came from, so a
  // later conversion updates THAT library copy instead of adding a second one. A track
  // Music reported no ID for simply has no key.
  persistentIds: Record<string, string>
  // What Music knows, keyed by file path. Fills the gaps the file leaves; where both hold
  // a value the file wins, because the file is what the user's other tools read.
  meta: Record<string, AppleMusicTrackMeta>
  missing: number
}

// Where a crate of playlists comes from. Every DJ library hands its playlists over in the
// same shapes.
export type PlaylistSource = 'appleMusic' | 'rekordbox' | 'engine' | 'traktor'

// One row of a source's playlist tree. A playlist counts its real tracks, separators left
// out, because that is the number the user sees in the list; a folder counts its direct
// children, as rekordbox's own tree does.
export interface SourceNode {
  id: string
  name: string
  kind: 'folder' | 'playlist'
  count: number
  children?: SourceNode[]
}

export interface RowCue {
  ms: number
  kind: number
  color: number | null
}

export interface SourcePreview {
  title: string
  artist: string
  durationSec: number
  coverUrl?: string
  analysisPath?: string
  unanalysed?: true
  cues: RowCue[]
}

export interface RowWaveRequest {
  path: string
  analysisPath?: string
}

// One row of a playlist, in the playlist's own order. A separator is a placeholder file the
// DJ drops between blocks (measured: one blank 1 s MP3 linked 345 times), kept so the list
// can draw the break but never loaded as a track. A null path is a row with no file
// (streaming), counted but not loadable.
export interface SourcePlaylistEntry {
  path: string | null
  separator: boolean
  // What the source knows that the file may not. Same shape and scale as Music's (rating
  // 0-100), so one fill rule serves every source.
  meta: AppleMusicTrackMeta
  musicPersistentId?: string
  // rekordbox only: the playlist row (djmdSongPlaylist.ID) and the collection entry
  // (djmdContent.ID) behind this entry. Edits name the row; copying to another playlist
  // names the entry, which keeps the symlinked twins apart without guessing by path.
  linkId?: string
  contentId?: string
  preview?: SourcePreview
}

// A track to put in a rekordbox playlist: the collection entry when Surco already knows it
// (a row read from an open rekordbox playlist), and the paths to look it up by otherwise
// (the source file, and the converted one when a conversion moved the collection entry).
export interface PlaylistTrackRef {
  contentId?: string
  paths: string[]
}

// One organising action on rekordbox, as the user made it: one drop, one menu choice, one
// name typed. Each is written on its own, so the dialog asking to close rekordbox comes at
// most once per gesture and every gesture has its own backup.
export type RekordboxPlaylistEdit =
  | { kind: 'add'; playlistId: string; tracks: PlaylistTrackRef[] }
  // beforeLinkId null moves the rows to the end.
  | { kind: 'move'; playlistId: string; linkIds: string[]; beforeLinkId: string | null }
  | { kind: 'remove'; playlistId: string; linkIds: string[] }
  | { kind: 'insertSeparator'; playlistId: string; beforeLinkId: string }
  // parentId 'root' is the top of the tree, as rekordbox spells it.
  | { kind: 'create'; parentId: string; name: string; folder: boolean }
  | { kind: 'rename'; playlistId: string; name: string }
  | { kind: 'delete'; playlistId: string }

// Why an edit was not written. Every one leaves the collection exactly as it was.
export type RekordboxEditRefusal =
  | 'cancelled'
  | 'rekordbox-running'
  | 'unreadable'
  | 'backup-failed'
  | 'write-failed'
  // The one exception to the line above: the write failed, its rollback too, and the
  // backup could not be copied back, so the collection's state is not known.
  | 'write-unknown'
  | 'read-only'
  | 'stale'
  | 'no-separator'
  | 'nothing-to-add'
  | 'other-collection'

// What an add did with each track it was given.
export interface PlaylistAddReport {
  added: number
  already: number
  notInCollection: number
  ambiguous: number
}

export type RekordboxEditResult =
  | { applied: true; createdId?: string; report?: PlaylistAddReport }
  | { applied: false; reason: RekordboxEditRefusal; report?: PlaylistAddReport }

export type RekordboxQueueNotice =
  | {
      code:
        | 'ambiguous'
        | 'file-missing'
        | 'not-added'
        | 'cues-changed'
        | 'cues-too-many'
        | 'cues-invalid'
        | 'cues-slot-dropped'
      track: string
    }
  | { code: 'playlist-changed' | 'playlist-gone'; track: string; playlist: string }
  | { code: 'edit-changed'; playlist: string }
  | { code: 'cues-calls-dropped'; track: string; calls: number[] }
  | { code: 'cues-adjusted'; track: string; moved: number; maxMs: number }
  | { code: 'cues-unfit'; track: string; count: number; contentId: string; ms: number }

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
  | 'deezer'
  | 'beatport'
  | 'musicbrainz'
  | 'cover'
  | 'convert'
  | 'analyze'
  | 'applemusic'
  // The list review: tag fixes and duplicate removals on the list's files, Music or not.
  | 'review'
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
  // 'warn' ends a step that finished without doing all it set out to (a file left as it
  // was); 'error' also ends one that reported its own failure rather than throwing.
  phase: 'start' | 'done' | 'warn' | 'error'
  labelKey: string
  labelParams?: ActivityParams
  detail?: string
  detailKey?: string
  detailParams?: ActivityParams
  ms?: number
  group?: string
  groupLabel?: string
  // A translatable title for the group, preferred over the raw groupLabel.
  groupLabelKey?: string
  groupLabelParams?: ActivityParams
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
  // The Engine DJ registration's error when it failed after the file landed: the job is
  // failed, but outputPath still says where the file now is.
  engineDjError?: string
  // The written file's identity (see inplace.ts fileIdentity), handed back on the next
  // export as previousOutputIdentity.
  outputIdentity?: string
  // Set when the conversion replaced a library copy and the new entry went in but the old
  // one could not be retired, so Music holds both. 'mismatch' means Music refused because
  // the live entry no longer carries the offered name; 'error' that the delete failed;
  // 'carry' that its playlists, play count and rating could not be copied, so it stayed.
  oldMusicCopyKept?: 'mismatch' | 'error' | 'carry'
  appleMusicFailed?: true
  // Set when the converted file landed but the original it replaced in a format change
  // could not be retired, so both are in the folder.
  originalKept?: true
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

// Everything the list reads off a channel scan: whether any bucket clipped. The lanes
// behind it are ~400 KB a track and only the compare strip draws them, so the list's
// clipping flag rides this apart and outlives the scan.
export interface ScanVerdict {
  clipping: boolean
}

export interface WaveVerdict {
  silence: boolean
}

export interface SpectrumResult {
  image: string
  // null when the cutoff analysis failed (e.g. ffmpeg errored) but the image
  // still rendered — the UI then hides the quality verdict instead of inventing one.
  cutoffHz: number | null
  sampleRateHz: number
  // The stream's codec ("aac", "alac"), so an .m4a is graded as what it holds. Absent
  // from analyses cached before it was kept.
  codec?: string
  // The frequency at the top edge of the image. A hi-res file is drawn to a 24 kHz cap
  // instead of its own Nyquist (96 kHz at 192 kHz), which would squash the audible band
  // into the bottom fifth of the panel, so the kHz marks, the cutoff line and the hover
  // crosshair all scale against this rather than the sample rate. Optional: analyses cached
  // before the cap existed were drawn to Nyquist and keep reading that way.
  imageTopHz?: number
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
  // What the sample rate is worth, stated on every file: 'native' (44.1 kHz, no hi-res claim
  // to check), 'hires' (content really carries above 22.05 kHz), 'upsampled' (it does not),
  // or 'unknown' (the probe could not read it). The boolean above can only accuse, so a
  // genuine hi-res file used to get no statement at all — indistinguishable from an analysis
  // that never ran. Optional: undefined on analyses cached before this existed.
  resolution?: 'native' | 'hires' | 'upsampled' | 'unknown'
  // Measured evidence behind the verdict, so the caption argues with numbers
  // instead of asserting. All optional: analyses cached before these fields
  // existed fall back to the un-numbered captions.
  // Steepest fall across two consecutive fine bands (one kilohertz), in dB.
  // Enormous for a codec wall, a few dB for a genuine fade.
  fineStepDb?: number
  // The Reprocessed saw-tooth: how many separate fine-band rises, spanning
  // teethFromHz to teethToHz.
  teethCount?: number
  teethFromHz?: number
  teethToHz?: number
  // Where a synthetic hump crests above the valley at cutoffHz.
  humpPeakHz?: number
  // True when the flat-shelf probe (not the codec pass) produced the processed
  // verdict.
  flatShelf?: boolean
  // The bit-depth verdict for lossless files declaring 24 bits: 'full' when the
  // lowest byte carries signal (a real 24-bit pipeline fills it), 'padded16'
  // when it is zero in every content sample, which is arithmetic proof of
  // 16-bit audio in a 24-bit container, and 'unknown' when the file qualifies
  // but the scan could not make a clean call (a silence-dominated minute, or a
  // reading between the two clear bands) — said out loud so it never looks like
  // a file the probe skipped. Absent when not applicable (lossy, 16-bit, float)
  // or on analyses cached before the probe existed.
  bitsUsage?: 'full' | 'padded16' | 'unknown'
  // Share of content samples whose lowest byte is non-zero, 0-100.
  bitsLowPct?: number
}

// Everything the list reads off a spectrum: the whole result but the ~300 KB image,
// which only the editor draws. Kept apart so the list's quality dot can outlive the
// image and a reopened library never ships the images across IPC.
export type SpectrumVerdict = Omit<SpectrumResult, 'image'>

// One track in an Engine DJ export request. The renderer ships this serializable shape
// across IPC; the main process resolves it to an absolute path on disk (for the relative
// path Engine stores and the file size) before writing the SQLite library.

// Whether two copies come from the same master: both aligned on the lag that best matches
// them, then compared sample by sample. Peak count and crest only rank copies inside one
// master, so the best-copy verdict reads this first. residualDb is what is left of a once b
// is scaled by gainDb (-Infinity when nothing is left). The probe gives no PairFacts at
// all when the best fit is inverted or unrelated (gain <= 0), so gainDb is always finite.
export interface PairFacts {
  correlation: number
  residualDb: number
  gainDb: number
}

// A short stretch of two copies of one master where the worse copy pins the most samples
// to its ceiling, the better one lined up and scaled to the same loudness. Each side is
// min/max per column, flattened as lo, hi pairs, so whatever of the better copy rises past
// the worse one is what the limiter took away.
export interface LimiterGlimpse {
  worse: number[]
  better: number[]
}

// Read-only audio analysis shown beside the spectrum, measured in one ffmpeg pass
// (astats + ebur128). Integrated loudness and true peak can read -Infinity for
// digital silence, which the UI renders as "−∞" rather than a misleading number.
export interface LoudnessResult {
  integratedLufs: number
  truePeakDb: number
  lra: number
  // The integrated-loudness gate ebur128 reports, which loudnorm's linear pass takes as
  // measured_thresh: it lets the conversion normalize from this same reading instead of
  // measuring again. Optional because entries cached before it existed lack it.
  threshold?: number
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
  // Samples sitting at the file's own peak: a limiter pins many to its ceiling, an open
  // master touches it a few times. Optional because entries cached before it existed lack it.
  peakCount?: number | null
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

// What a rekordbox repoint could not do in a run, told to the user once it ends: the
// collection-wide reason that stopped it (rekordbox being open has its own dialog), and
// the converted files whose track the collection holds under more than one entry.
export interface RekordboxSyncIssue {
  blocked?: 'backup-failed' | 'read-only' | 'unreadable' | 'write-failed'
  ambiguous: string[]
}

// Per DJ library: whether its sync is on, and whether the collection it points at is
// there. A library can be on and not found, which the review has to say out loud.
export type LibraryStatus = Record<
  'rekordbox' | 'engine' | 'traktor',
  { enabled: boolean; found: boolean }
>

// What one library did with a review's tag changes, so the done sheet can say it per
// library instead of claiming every change landed: how many tracks it updated, or why none.
export type LibraryTagSync =
  | { outcome: 'updated'; count: number }
  | { outcome: 'nothing' | 'open' | 'missing' | 'failed' }

export type LibraryTagSyncReport = Record<'rekordbox' | 'engine' | 'traktor', LibraryTagSync>

// The USB export (docs/superpowers/specs/2026-10-16-export-usb-design.md). A stick is
// always named by a stable volume identifier (macOS VolumeUUID, Windows volume GUID), never
// by its name or drive letter: two sticks may share a name ("Vicent" and "Vicent").
export type UsbFilesystem = 'fat32' | 'exfat' | 'hfs' | 'apfs' | 'ntfs' | 'other'

export interface UsbHolder {
  by: 'rekordbox' | 'surco' | 'other' | 'empty'
  // export.pdb's modification time, when there is one.
  at: number | null
}

// What Surco exported to this stick last time, so the next time is one press of Exportar.
export interface UsbRemembered {
  playlistIds: string[]
  prune: boolean
  settings: boolean
  at: number
}

export interface UsbVolume {
  uuid: string
  name: string
  // /Volumes/Vicent on macOS, E:\ on Windows.
  mountPoint: string
  filesystem: UsbFilesystem
  partitionScheme: 'mbr' | 'gpt' | 'other'
  totalBytes: number
  freeBytes: number
  holder: UsbHolder
  remembered: UsbRemembered | null
  // Master IDs of the playlists the stick's playlists3.sync ticks; null without one.
  stickPlaylists: string[] | null
  engine?: { holder: UsbHolder; remembered: UsbRemembered | null }
}

export type UsbTarget = { kind: 'volume'; uuid: string } | { kind: 'folder'; path: string }

export interface UsbVolumeList {
  volumes: UsbVolume[]
  // targetKey of the last export, to preselect it.
  lastKey: string | null
}

export interface UsbPlanTrack {
  id: string
  title: string
  artist: string
  size: number
  // baken's size check, what is left to copy.
  onStick: boolean
  separator: boolean
  cover: string | null
  wave: number[] | null
}

export type UsbUnexportableReason = 'missing-file' | 'streaming' | 'skipped'

export type UsbWarning =
  | { kind: 'rekordboxExport' }
  | { kind: 'exfat' }
  | { kind: 'gpt' }
  | { kind: 'ntfs' }
  | { kind: 'notVolumeRoot' }
  | { kind: 'cdj2000'; titles: string[] }
  | { kind: 'unexportable'; tracks: { title: string; reason: UsbUnexportableReason }[] }
  | { kind: 'noSpace'; neededBytes: number; freeBytes: number }
  // The volume's name (/Volumes/<name>, or E: and \\server\share on Windows) and how many
  // selected tracks are on it.
  | { kind: 'sourcesUnreachable'; volume: string; tracks: number }
  | { kind: 'rekordboxOpen' }
  | { kind: 'emptyPlaylist'; names: string[] }
  | { kind: 'engineOpen' }

export interface UsbPlan {
  tracks: UsbPlanTrack[]
  // Without separators, as the tree counts.
  trackCount: number
  newCount: number
  newBytes: number
  keptCount: number
  removedSinceLast: number | null
  warnings: UsbWarning[]
}

export interface UsbExportRequest {
  playlistIds: string[]
  target: UsbTarget
  prune: boolean
  settings: boolean
  source?: 'engine'
}

export type UsbFailure =
  | 'unsupported'
  | 'no-collection'
  | 'unreadable'
  | 'nothing-selected'
  | 'volume-gone'
  | 'volume-changed'
  | 'not-removable'
  | 'not-volume-root'
  | 'no-baken'
  | 'refused'
  | 'baken-failed'
  | 'device-write'
  | 'no-space'
  | 'busy'
  | 'rekordbox-open'
  | 'sources-unreachable'
  | 'playlist-empty'
  | 'source-lost'
  // Never a refusal: the done notice's code when finished carries syncFiles false.
  | 'sync-files'
  // The stick's playlists3.sync already uses the last playlist id a new one could take.
  | 'stick-ids-full'
  | 'engine-missing'
  | 'engine-unreadable'
  | 'engine-open'
  | 'engine-foreign'
  | 'engine-schema'

export type UsbPlanResult = { ok: true; plan: UsbPlan } | { ok: false; reason: UsbFailure }

export type UsbStartResult =
  | { ok: true }
  | { ok: false; reason: UsbFailure; neededBytes?: number; freeBytes?: number }

export interface UsbFolderPick {
  path: string
  remembered: UsbRemembered | null
}

// baken's English failure text mapped to something the UI translates; the raw text goes to
// the log.
export type UsbTrackFailure = 'missing-file' | 'unreadable' | 'device'

export type UsbExportEvent =
  | { type: 'started'; tracks: UsbPlanTrack[]; targetName: string; startedAt: number }
  // Bytes of the track being copied, polled from the stick.
  | { type: 'progress'; index: number; bytes: number }
  | { type: 'track'; index: number; state: 'done' | 'kept' }
  | { type: 'failed'; index: number; reason: UsbTrackFailure }
  | { type: 'cancelling' }
  | { type: 'database' }
  // syncFiles false: the library on the stick is new, but rekordbox's playlists3.sync and
  // playlists3Plus.sync could not be written.
  | {
      type: 'finished'
      outcome: 'done'
      tracks: number
      failed: number
      ms: number
      syncFiles: boolean
    }
  | { type: 'finished'; outcome: 'cancelled' }
  | { type: 'finished'; outcome: 'error'; reason: UsbFailure }

export interface RekordboxPlaylistTarget {
  id?: string
  name: string
}

export type RekordboxQueuePart =
  | { kind: 'repoint' }
  | { kind: 'collection' }
  | { kind: 'playlists'; names: string[] }
  | { kind: 'tree'; edit: RekordboxPlaylistEdit['kind'] }
  | { kind: 'cues' }

export interface RekordboxQueueItem {
  key: string
  label: string
  parts: RekordboxQueuePart[]
}

export interface RekordboxQueueState {
  tracks: number
  changes: number
  items: RekordboxQueueItem[]
  halted?: true
  elsewhere?: true
}

export interface RekordboxQueueWritten {
  path: string
  wanted: RekordboxPlaylistTarget[]
}

export type RekordboxQueueApplied =
  | {
      tracks: number
      changes: number
      notices: RekordboxQueueNotice[]
      written: RekordboxQueueWritten[]
    }
  | { refused: RekordboxEditRefusal }

export interface CueWaveColumn {
  h: number
  rgb: [number, number, number] | null
}

export interface TrackCueRow {
  id: string
  ms: number
  kind: number
  color: number | null
  loop?: boolean
}

export interface TrackCues {
  contentId: string
  analysed: boolean
  grid: { ms: number; beat: number }[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
  sections?: PhraseSection[]
  cues: TrackCueRow[]
  wave: CueWaveColumn[] | null
  durationMs: number
  fingerprint: string
}

export interface SurcoGrid {
  bpm: number
  grid: { ms: number; beat: number }[]
  words: Uint16Array | null
}

export interface QueuedCues {
  wanted: WantedCue[]
  fingerprint: string
}

export type SaveCuesOutcome =
  | 'queued'
  | 'other-collection'
  | { queued: string[]; refused: CueLibrary[] }

export interface SaveCuesRequest {
  contentId: string
  path: string
  label: string
  wanted: WantedCue[]
  fingerprint: string
  provisional?: true
}
