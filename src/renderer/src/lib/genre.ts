import type { DiscogsRelease } from '../../../shared/types'

export function genrePresets(release: DiscogsRelease | null): string[] {
  if (!release) return []
  const all = [...(release.genres ?? []), ...(release.styles ?? [])]
  return Array.from(new Set(all))
}
