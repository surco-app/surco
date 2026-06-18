import type { Release } from '../../../shared/types'

export function genrePresets(release: Release | null): string[] {
  if (!release) return []
  const all = [...(release.genres ?? []), ...(release.styles ?? [])]
  return Array.from(new Set(all))
}
