import type { OutputFormat, Settings } from '../../../shared/types'

export interface OnboardingChoices {
  discogsToken: string
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
    // Auto-match needs the user's own token; without one it can't be turned on, so never persist
    // it as enabled even if the checkbox was somehow left ticked.
    autoMatch: discogsToken !== '' && choices.autoMatch,
    visibleFields: choices.visibleFields,
    requiredFields: choices.requiredFields,
    addToAppleMusic: choices.addToAppleMusic,
    keepOutputCopy: choices.keepOutputCopy,
    hasSeenOnboarding: true,
  }
}
