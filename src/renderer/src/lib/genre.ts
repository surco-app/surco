import type { DiscogsRelease } from '../../../shared/types'

// Discogs splits broad genres ("Electronic") from specific styles ("House",
// "Techno"). We surface both as pickable chips, de-duped and in Discogs' order,
// so the DJ tags from what the release actually is instead of a fixed guess.
export function genrePresets(release: DiscogsRelease | null): string[] {
  if (!release) return []
  const all = [...(release.genres ?? []), ...(release.styles ?? [])]
  return Array.from(new Set(all))
}
