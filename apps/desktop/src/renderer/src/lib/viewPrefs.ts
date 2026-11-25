import { usableProviders } from '../../../shared/autoMatch'
import { normalizeImportFields } from '../../../shared/defaults'
import type {
  CustomField,
  MetaTextKey,
  PlaylistSource,
  SearchProviderId,
  Settings,
} from '../../../shared/types'

export const NO_HIDDEN_SOURCES: PlaylistSource[] = []

// Stable fallback while settings load, so the memoized Editor doesn't see a new array
// each render. Mirrors the persisted default (Discogs only).
export const DEFAULT_SEARCH_PROVIDERS: SearchProviderId[] = ['discogs']

export type ViewPrefs = {
  showSpectrum: boolean
  showWaveform: boolean
  hasToken: boolean
  searchProviders: SearchProviderId[]
  importFields: MetaTextKey[]
  genrePresets: string[]
  fullReleaseDate: boolean
  replaceLowResCover: boolean
  hiddenSources: PlaylistSource[]
  showSidebar: boolean
  showRailNames: boolean
  showListPositions: boolean
  continuousPlayback: boolean
  filenameFormat: string
  customFields: CustomField[]
  sessionsMade: string[]
  matchingDismissed: string[]
  suggestionsOpen: boolean
  showListWaves: boolean
}

export function viewPrefsOf(settings: Settings | null): ViewPrefs {
  return {
    showSpectrum: settings?.showSpectrum ?? true,
    showWaveform: settings?.showWaveform ?? true,
    hasToken: !!settings?.discogsToken,
    searchProviders: settings ? usableProviders(settings) : DEFAULT_SEARCH_PROVIDERS,
    importFields: normalizeImportFields(settings?.importFields),
    genrePresets: settings?.genrePresets ?? [],
    fullReleaseDate: settings?.fullReleaseDate ?? false,
    replaceLowResCover: settings?.replaceLowResCover ?? false,
    hiddenSources: settings?.hiddenSources ?? NO_HIDDEN_SOURCES,
    showSidebar: settings?.showSidebar ?? true,
    showRailNames: settings?.showRailNames ?? true,
    showListPositions: settings?.showListPositions ?? true,
    continuousPlayback: settings?.continuousPlayback ?? false,
    filenameFormat: settings?.filenameFormat ?? '{artist} - {title}',
    customFields: settings?.customFields ?? [],
    sessionsMade: settings?.sessionsMade ?? [],
    matchingDismissed: settings?.matchingDismissed ?? [],
    suggestionsOpen: settings?.matchingSuggestionsOpen ?? true,
    showListWaves: settings?.showListWaves ?? true,
  }
}
