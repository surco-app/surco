import type { OutputFormat, Settings } from '../../../shared/types'

export interface OnboardingChoices {
  discogsToken: string
  outputFormat: OutputFormat
  grouping: string
  genre: string
  showSpectrum: boolean
  requiredFields: string[]
}

export function shouldShowOnboarding(settings: Pick<Settings, 'hasSeenOnboarding'>): boolean {
  return !settings.hasSeenOnboarding
}

// Passing null means the user skipped: we only flag the wizard as seen so it
// never reappears, leaving the existing (default) settings untouched.
export function buildOnboardingPatch(choices: OnboardingChoices | null): Partial<Settings> {
  if (!choices) return { hasSeenOnboarding: true }
  return {
    discogsToken: choices.discogsToken.trim(),
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
    requiredFields: choices.requiredFields,
    hasSeenOnboarding: true,
  }
}
