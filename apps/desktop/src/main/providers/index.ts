import { createRateLimiter } from '../../shared/rateLimiter'
import type {
  DiscogsRelease,
  DiscogsSearchResult,
  SearchPriority,
  SearchProviderId,
} from '../../shared/types'
import * as discogs from '../discogs'
import { buildSearchCandidates } from '../searchQuery'
import { getSettings } from '../settings'

// Search dispatch seam: the IPC layer talks to a provider by id instead of
// calling Discogs directly, so adding a source later is a new entry here rather
// than a change at the call site. Discogs is the only provider today, so results
// keep the Discogs shape end-to-end; when a second provider lands these become a
// normalized result/release type that each provider maps onto.
export interface SearchProvider {
  search(query: string, priority?: SearchPriority): Promise<DiscogsSearchResult[]>
  getRelease(id: number, priority?: SearchPriority): Promise<DiscogsRelease>
}

// Discogs allows ~60 requests/min per token. Pace every Discogs call through one shared bucket
// so auto-match, the editor's search and hover prefetch can't collectively burst past it and
// earn 429s. A small burst keeps single interactive searches instant; the sustained rate stays
// well under the cap to leave headroom. The editor's own searches acquire at 'high' priority so
// they jump ahead of the background auto-match sweep.
const DISCOGS_BURST = 5
const DISCOGS_WINDOW_MS = 6000 // 5 tokens / 6s ≈ 50 requests/min sustained
const discogsLimiter = createRateLimiter(DISCOGS_BURST, DISCOGS_WINDOW_MS)

const providers: Record<SearchProviderId, SearchProvider> = {
  discogs: {
    // The raw query carries download-filename noise that throws Discogs' free-text
    // search off, so try cleaned candidates in turn (cleaned → no parenthetical) and
    // keep the first that returns anything. Each candidate is paced and cached on its
    // own key, so a clean query still makes exactly one call.
    search: async (query, priority) => {
      const token = getSettings().discogsToken
      let results: DiscogsSearchResult[] = []
      for (const candidate of buildSearchCandidates(query)) {
        if (!discogs.hasCachedSearch(candidate)) await discogsLimiter.acquire(priority)
        results = await discogs.search(candidate, token)
        if (results.length) break
      }
      return results
    },
    getRelease: async (id, priority) => {
      if (!discogs.hasCachedRelease(id)) await discogsLimiter.acquire(priority)
      return discogs.getRelease(id, getSettings().discogsToken)
    },
  },
}

export const DEFAULT_PROVIDER: SearchProviderId = 'discogs'

// Falls back to the default for an unknown id because the value crosses IPC from
// the renderer and a bad one must not take down the search handler.
export function getProvider(id?: SearchProviderId): SearchProvider {
  return providers[id ?? DEFAULT_PROVIDER] ?? providers[DEFAULT_PROVIDER]
}
