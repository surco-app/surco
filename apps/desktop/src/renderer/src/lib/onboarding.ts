import { autoMatchAvailable } from '../../../shared/autoMatch'
import type { OutputFormat, SearchProviderId, Settings } from '../../../shared/types'

export interface OnboardingChoices {
  discogsToken: string
  // The catalogs the editor search queries (Discogs and/or Bandcamp).
  searchProviders: SearchProviderId[]
  outputFormat: OutputFormat
  grouping: string
  genre: string
  showSpectrum: boolean
  autoMatch: boolean
  // The editor fields the user wants shown (in order) and which of them are required.
  visibleFields: string[]
  requiredFields: string[]
  // The output destination, only chosen on macOS (where Apple Music exists); on other
  // platforms these stay at their defaults since the wizard never offers the choice.
  addToAppleMusic: boolean
  keepOutputCopy: boolean
}

export function shouldShowOnboarding(settings: Pick<Settings, 'hasSeenOnboarding'>): boolean {
  return !settings.hasSeenOnboarding
}

// Passing null means the user skipped: we only flag the wizard as seen so it
// never reappears, leaving the existing (default) settings untouched.
export function buildOnboardingPatch(choices: OnboardingChoices | null): Partial<Settings> {
  if (!choices) return { hasSeenOnboarding: true }
  const discogsToken = choices.discogsToken.trim()
  return {
    discogsToken,
    searchProviders: choices.searchProviders,
    outputFormat: choices.outputFormat,
    groupingPresets: choices.grouping
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean),
    genrePresets: choices.genre
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean),
    showSpectrum: choices.showSpectrum,
    // Auto-match can only persist as on when its prerequisites are met (a source, plus a
    // Discogs token whenever Discogs is one), never just because the checkbox was left ticked.
    autoMatch:
      choices.autoMatch &&
      autoMatchAvailable({ searchProviders: choices.searchProviders, discogsToken }),
    visibleFields: choices.visibleFields,
    requiredFields: choices.requiredFields,
    addToAppleMusic: choices.addToAppleMusic,
    keepOutputCopy: choices.keepOutputCopy,
    hasSeenOnboarding: true,
  }
}
