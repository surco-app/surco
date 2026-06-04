import type { DiscogsRelease, DiscogsSearchResult, SearchProviderId } from '../../shared/types'
import * as discogs from '../discogs'
import { getSettings } from '../settings'

// Search dispatch seam: the IPC layer talks to a provider by id instead of
// calling Discogs directly, so adding a source later is a new entry here rather
// than a change at the call site. Discogs is the only provider today, so results
// keep the Discogs shape end-to-end; when a second provider lands these become a
// normalized result/release type that each provider maps onto.
export interface SearchProvider {
  search(query: string): Promise<DiscogsSearchResult[]>
  getRelease(id: number): Promise<DiscogsRelease>
}

const providers: Record<SearchProviderId, SearchProvider> = {
  discogs: {
    search: (query) => discogs.search(query, getSettings().discogsToken),
    getRelease: (id) => discogs.getRelease(id, getSettings().discogsToken),
  },
}

export const DEFAULT_PROVIDER: SearchProviderId = 'discogs'

// Falls back to the default for an unknown id because the value crosses IPC from
// the renderer and a bad one must not take down the search handler.
export function getProvider(id?: SearchProviderId): SearchProvider {
  return providers[id ?? DEFAULT_PROVIDER] ?? providers[DEFAULT_PROVIDER]
}
