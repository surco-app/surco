import type { Settings } from './types'

// Whether the auto-match sweep can run at all (independent of the on/off toggle). It needs
// at least one search source, and — because Discogs is rate-limited on a key shared across
// all users — a personal token whenever Discogs is one of those sources, so a whole-import
// sweep doesn't exhaust the shared budget. Bandcamp-only auto-match needs no token. The
// single source of truth shared by the settings store, the App sweep gate and the UI.
export function autoMatchAvailable(
  s: Pick<Settings, 'searchProviders' | 'discogsToken'> & { beatportUsername?: string },
): boolean {
  const usable = s.beatportUsername
    ? s.searchProviders
    : s.searchProviders.filter((p) => p !== 'beatport')
  if (usable.length === 0) return false
  return !usable.includes('discogs') || s.discogsToken.trim() !== ''
}
