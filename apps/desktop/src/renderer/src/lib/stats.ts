// Surco automates what would otherwise be a manual chore per track — exporting
// from an audio editor, fetching and embedding the cover, typing the tags. We
// credit a deliberately conservative 4 minutes of saved work per conversion so
// the headline figure stays believable rather than inflated.
export const MANUAL_SECONDS_PER_CONVERSION = 4 * 60

export function timeSavedSeconds(conversionCount: number): number {
  return Math.max(0, Math.floor(conversionCount)) * MANUAL_SECONDS_PER_CONVERSION
}

// A humanized "9 h 28 min" for the Stats readout, distinct from the player's
// m:ss clock. "h" and "min" are the same abbreviations in both shipped locales
// (English and Spanish), so they live here rather than in the translation files.
export function formatTimeSaved(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h} h ${m} min`
  if (h > 0) return `${h} h`
  return `${m} min`
}

// The conversion-count goals the Stats tab's progress bar aims at. Sparse on purpose:
// a target that moves every session stops feeling like a milestone.
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]

// Strictly above the count, so reaching a milestone immediately aims at the next one;
// null past the last — better no bar than an invented target.
export function nextMilestone(count: number): number | null {
  return MILESTONES.find((m) => m > count) ?? null
}

// Which lifetime tally a match apply bumps, keyed by the release's provider.
export function matchStatKey(provider: string): 'discogsMatches' | 'bandcampMatches' {
  return provider === 'bandcamp' ? 'bandcampMatches' : 'discogsMatches'
}
