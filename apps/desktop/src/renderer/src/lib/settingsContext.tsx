import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { DEFAULT_DECLICK, normalizeDeclick } from '../../../shared/declick'
import { DEFAULT_DISCOGS_MAX_RESULTS } from '../../../shared/defaults'
import {
  DEFAULT_EDITOR_SECTIONS,
  type EditorSectionPref,
  normalizeEditorSections,
} from '../../../shared/editorSections'
import type {
  DeclickMode,
  FormatSetting,
  KeyNotation,
  NormalizeConfig,
  OutputBitDepth,
  OutputSampleRate,
  SearchProviderId,
  Settings,
} from '../../../shared/types'
import { seedEditorSections } from '../hooks/useEditorSections'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from './fields'

// The slice of Settings the editor tree reads, resolved: settings arrive null for the
// first frames, so every field carries its default here — in ONE place, instead of a
// `?? fallback` per prop at every consumer (the 17-prop wall App used to pass Editor).
export interface ResolvedSettings {
  discogsToken: string
  // Whether the background sweep auto-matches on import. The editor reads it so opening a
  // track only auto-applies a confident match when the user left auto-match on — off means
  // no metadata is written without a deliberate click.
  autoMatch: boolean
  outputFormat: FormatSetting
  // The quality pins, read by the editor's "re-encode this one" offer: a same-format
  // source that doesn't meet them gets the explicit action instead of a silent re-encode.
  outputBitDepth: OutputBitDepth
  outputSampleRate: OutputSampleRate
  addToAppleMusic: boolean
  addToEngineDj: boolean
  overwriteOriginal: boolean
  convertBesideOriginal: boolean
  replaceLowResCover: boolean
  autoApplyFilename: boolean
  filenameFormat: string
  titleFormat: string
  groupingPresets: string[]
  genrePresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  discogsFormats: string[]
  discogsMaxResults: number
  searchProviders: SearchProviderId[]
  searchIgnoreWords: string[]
  showSpectrum: boolean
  showLoudness: boolean
  keyNotation: KeyNotation
  normalize: NormalizeConfig
  declick: DeclickMode
  // Always complete and form-first, whatever an older settings.json stored.
  editorSections: EditorSectionPref[]
  // The results column's persisted width; null until the user first drags it.
  resultsWidth: number | null
}

// One frozen default per field (not fresh objects per call): the provider memoizes on
// the settings identity, so consumers' memoization only breaks when settings change.
const DEFAULTS: ResolvedSettings = {
  discogsToken: '',
  autoMatch: false,
  outputFormat: 'aiff',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  addToAppleMusic: false,
  addToEngineDj: false,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  replaceLowResCover: false,
  autoApplyFilename: false,
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  groupingPresets: [],
  genrePresets: [],
  visibleFields: DEFAULT_FIELDS,
  requiredFields: DEFAULT_REQUIRED_FIELDS,
  discogsFormats: [],
  discogsMaxResults: DEFAULT_DISCOGS_MAX_RESULTS,
  searchProviders: ['discogs'],
  searchIgnoreWords: ['vinyl', 'rip'],
  showSpectrum: true,
  showLoudness: true,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: DEFAULT_DECLICK,
  editorSections: DEFAULT_EDITOR_SECTIONS,
  resultsWidth: null,
}

export function resolveSettings(settings: Partial<Settings> | null): ResolvedSettings {
  if (!settings) return DEFAULTS
  return {
    discogsToken: settings.discogsToken ?? DEFAULTS.discogsToken,
    autoMatch: settings.autoMatch ?? DEFAULTS.autoMatch,
    outputFormat: settings.outputFormat ?? DEFAULTS.outputFormat,
    outputBitDepth: settings.outputBitDepth ?? DEFAULTS.outputBitDepth,
    outputSampleRate: settings.outputSampleRate ?? DEFAULTS.outputSampleRate,
    addToAppleMusic: settings.addToAppleMusic ?? DEFAULTS.addToAppleMusic,
    addToEngineDj: settings.addToEngineDj ?? DEFAULTS.addToEngineDj,
    overwriteOriginal: settings.overwriteOriginal ?? DEFAULTS.overwriteOriginal,
    convertBesideOriginal: settings.convertBesideOriginal ?? DEFAULTS.convertBesideOriginal,
    replaceLowResCover: settings.replaceLowResCover ?? DEFAULTS.replaceLowResCover,
    autoApplyFilename: settings.autoApplyFilename ?? DEFAULTS.autoApplyFilename,
    filenameFormat: settings.filenameFormat ?? DEFAULTS.filenameFormat,
    titleFormat: settings.titleFormat ?? DEFAULTS.titleFormat,
    groupingPresets: settings.groupingPresets ?? DEFAULTS.groupingPresets,
    genrePresets: settings.genrePresets ?? DEFAULTS.genrePresets,
    visibleFields: settings.visibleFields ?? DEFAULTS.visibleFields,
    requiredFields: settings.requiredFields ?? DEFAULTS.requiredFields,
    discogsFormats: settings.discogsFormats ?? DEFAULTS.discogsFormats,
    discogsMaxResults: settings.discogsMaxResults ?? DEFAULTS.discogsMaxResults,
    searchProviders: settings.searchProviders ?? DEFAULTS.searchProviders,
    searchIgnoreWords: settings.searchIgnoreWords ?? DEFAULTS.searchIgnoreWords,
    showSpectrum: settings.showSpectrum ?? DEFAULTS.showSpectrum,
    showLoudness: settings.showLoudness ?? DEFAULTS.showLoudness,
    keyNotation: settings.keyNotation ?? DEFAULTS.keyNotation,
    normalize: settings.normalize ?? DEFAULTS.normalize,
    declick: normalizeDeclick(settings.declick),
    editorSections: normalizeEditorSections(settings.editorSections),
    resultsWidth: settings.resultsWidth ?? DEFAULTS.resultsWidth,
  }
}

// Default value = plain defaults, so a component rendered without a provider (tests
// that don't care about settings) still reads sane values instead of throwing.
const SettingsContext = createContext<ResolvedSettings>(DEFAULTS)

// App mounts one provider around its tree; the value is memoized on the settings
// identity so consumers re-render exactly when the settings object App holds changes —
// the same cadence the old per-prop plumbing had.
export function SettingsProvider({
  settings,
  children,
}: {
  settings: Partial<Settings> | null
  children: React.ReactNode
}): React.JSX.Element {
  const value = useMemo(() => resolveSettings(settings), [settings])
  // Push the user's per-section fold defaults into the editor-sections store — for
  // editors already mounted when settings finish loading, and again when the user
  // edits them in Settings. Keyed to the list's content, not the settings identity:
  // every save replaces the whole settings object, and reseeding on unrelated saves
  // would wipe the session's ad-hoc folds.
  const sectionsKey = JSON.stringify(value.editorSections)
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (seeded.current === sectionsKey) return
    seeded.current = sectionsKey
    seedEditorSections(value.editorSections)
  }, [sectionsKey, value.editorSections])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useAppSettings(): ResolvedSettings {
  return useContext(SettingsContext)
}
