import type { Settings } from '../../../shared/types'

// The synced staged fields in their editable forms (presets as comma text, the cover cap
// as a string), derived from Settings in one place so the modal's seeding and the
// config-dir re-seed can never disagree on the field list.
export interface SyncedDraft {
  theme: Settings['theme']
  language: Settings['language']
  outputFormat: Settings['outputFormat']
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  overwriteOriginal: boolean
  convertBesideOriginal: boolean
  addToEngineDj: boolean
  engineDjPlaylist: string
  filenameFormat: string
  titleFormat: string
  autoApplyFilename: boolean
  grouping: string
  genre: string
  trimWhitespace: boolean
  zeroPadTrack: boolean
  visibleFields: string[]
  requiredFields: string[]
  coverMaxSize: string
  coverSquare: boolean
  coverUpscale: boolean
  replaceLowResCover: boolean
  mp3Quality: Settings['mp3Quality']
  outputBitDepth: Settings['outputBitDepth']
  outputSampleRate: Settings['outputSampleRate']
  flacCompression: Settings['flacCompression']
  showSpectrum: boolean
  showLoudness: boolean
  autoAnalyze: boolean
  keyNotation: Settings['keyNotation']
  normalize: Settings['normalize']
  shortcutOverrides: Settings['shortcutOverrides']
  discogsFormats: string[]
  discogsMaxResults: number
  searchProviders: Settings['searchProviders']
  searchIgnoreWords: string
}

// Machine-local staged fields. A config-dir switch may adopt another machine's synced
// prefs, but these stay put, so they live apart from SyncedDraft and survive a re-seed.
export interface LocalDraft {
  token: string
  outputDir: string
  engineLibraryDir: string
  autoMatch: boolean
}

export function pickSynced(s: Settings): SyncedDraft {
  return {
    theme: s.theme,
    language: s.language,
    outputFormat: s.outputFormat,
    discogsFormats: s.discogsFormats,
    discogsMaxResults: s.discogsMaxResults,
    searchProviders: s.searchProviders,
    searchIgnoreWords: s.searchIgnoreWords.join(', '),
    addToAppleMusic: s.addToAppleMusic,
    keepOutputCopy: s.keepOutputCopy,
    overwriteOriginal: s.overwriteOriginal,
    convertBesideOriginal: s.convertBesideOriginal,
    addToEngineDj: s.addToEngineDj,
    engineDjPlaylist: s.engineDjPlaylist,
    filenameFormat: s.filenameFormat,
    titleFormat: s.titleFormat,
    autoApplyFilename: s.autoApplyFilename,
    grouping: s.groupingPresets.join(', '),
    genre: s.genrePresets.join(', '),
    trimWhitespace: s.trimWhitespace,
    zeroPadTrack: s.zeroPadTrack,
    visibleFields: s.visibleFields,
    requiredFields: s.requiredFields,
    coverMaxSize: String(s.coverMaxSize),
    coverSquare: s.coverSquare,
    coverUpscale: s.coverUpscale,
    replaceLowResCover: s.replaceLowResCover,
    mp3Quality: s.mp3Quality,
    outputBitDepth: s.outputBitDepth,
    outputSampleRate: s.outputSampleRate,
    flacCompression: s.flacCompression,
    showSpectrum: s.showSpectrum,
    showLoudness: s.showLoudness,
    autoAnalyze: s.autoAnalyze,
    keyNotation: s.keyNotation,
    normalize: s.normalize,
    shortcutOverrides: s.shortcutOverrides,
  }
}

// The default applied when the filename format is left blank — every output would collide
// on one name without at least the artist and title.
const DEFAULT_FILENAME_FORMAT = '{artist} - {title}'
// The playlist restored when the Engine DJ field is left blank — a nameless playlist
// can't be created, and losing the inbox silently would defeat its purpose.
const DEFAULT_ENGINE_DJ_PLAYLIST = 'Surco'
// The cover cap restored when the field can't be parsed as a non-negative number.
const DEFAULT_COVER_MAX_SIZE = 1200

// Serializes the staged draft into the Settings patch to persist: presets parsed from
// comma text into trimmed arrays, the cover cap clamped to a non-negative number (the
// default when unparseable), the filename format trimmed with the default restored when
// blank, and auto-match forced off when there's no token to run it. Pure so these
// parse/clamp/gate rules are tested directly rather than only through the modal's Save.
export function buildSettingsPatch(synced: SyncedDraft, local: LocalDraft): Partial<Settings> {
  const {
    grouping,
    genre,
    coverMaxSize,
    filenameFormat,
    engineDjPlaylist,
    searchIgnoreWords,
    ...rest
  } = synced
  const max = parseInt(coverMaxSize, 10)
  const token = local.token.trim()
  return {
    ...rest,
    discogsToken: token,
    outputDir: local.outputDir,
    engineLibraryDir: local.engineLibraryDir,
    engineDjPlaylist: engineDjPlaylist.trim() || DEFAULT_ENGINE_DJ_PLAYLIST,
    filenameFormat: filenameFormat.trim() || DEFAULT_FILENAME_FORMAT,
    groupingPresets: splitPresets(grouping),
    genrePresets: splitPresets(genre),
    searchIgnoreWords: splitPresets(searchIgnoreWords),
    coverMaxSize: Number.isFinite(max) && max >= 0 ? max : DEFAULT_COVER_MAX_SIZE,
    // Auto-match needs a token to run, so a token-less save can't leave it enabled.
    autoMatch: token !== '' && local.autoMatch,
  }
}

function splitPresets(text: string): string[] {
  return text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}
