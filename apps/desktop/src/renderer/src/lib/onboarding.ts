import { autoMatchAvailable } from '../../../shared/autoMatch'
import type { OutputFormat, SearchProviderId, Settings } from '../../../shared/types'

export interface OnboardingChoices {
  discogsToken: string
  // The catalogs the editor search queries (Discogs and/or Bandcamp).
  searchProviders: SearchProviderId[]
  outputFormat: OutputFormat
  // When on, the output name is derived from the naming pattern automatically; off keeps
  // the source file name until the user presses "Regenerate" per track.
  autoApplyFilename: boolean
  grouping: string
  genre: string
  showSpectrum: boolean
  autoMatch: boolean
  // The editor fields the user wants shown (in order) and which of them are required.
  visibleFields: string[]
  requiredFields: string[]
  // The output destination, mirroring the Settings booleans (Apple Music is only offered
  // on macOS; Engine DJ and overwrite are offered everywhere).
  addToAppleMusic: boolean
  keepOutputCopy: boolean
  // Rewrites the source files in place instead of producing copies (destructive).
  overwriteOriginal: boolean
  // Registers converted tracks in the Engine DJ library; its folder and playlist keep
  // their defaults here, tunable later in Settings.
  addToEngineDj: boolean
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
    autoApplyFilename: choices.autoApplyFilename,
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
    overwriteOriginal: choices.overwriteOriginal,
    addToEngineDj: choices.addToEngineDj,
    hasSeenOnboarding: true,
  }
}
