import type { Release } from '../../../shared/types'

export function genrePresets(release: Release | null): string[] {
  if (!release) return []
  const all = [...(release.genres ?? []), ...(release.styles ?? [])]
  return Array.from(new Set(all))
}

// The genre quick-pick chips: the user's presets first, then the release's genres/styles.
// Deduped case-insensitively so a preset ("Electronic") and a provider genre ("electronic")
// don't both show — the user's list comes first, so their casing is the one that survives.
export function genreChips(userPresets: string[], release: Release | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const genre of [...userPresets, ...genrePresets(release)]) {
    const key = genre.trim().toLowerCase()
    if (key && !seen.has(key)) {
      seen.add(key)
      out.push(genre)
    }
  }
  return out
}
