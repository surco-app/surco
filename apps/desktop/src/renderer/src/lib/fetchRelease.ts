import type { Release, SearchPriority, SearchResult } from '../../../shared/types'

// Loads the full release a search result points at. A result is addressed by its page URL
// when it carries one (Bandcamp, whose parsed release id can differ from the autocomplete
// id, so only the URL reliably re-fetches it) and by its id otherwise (Discogs). This is
// the one place that fallback lives, so the editor browser and the auto-match sweep
// resolve a result to its release identically — a drift here would fetch the wrong
// release for one of them.
export function fetchRelease(result: SearchResult, priority: SearchPriority): Promise<Release> {
  return window.api.getRelease(result.releaseUrl ?? result.id, result.provider, priority)
}
