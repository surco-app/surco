import type {
  Release,
  SearchResult,
  SearchHints,
  SearchPriority,
  SearchProviderId,
} from '../../shared/types'
import * as discogs from '../discogs'
import { getSettings } from '../settings'

// Search dispatch seam: the IPC layer talks to a provider by id instead of
// calling Discogs directly, so adding a source later is a new entry here rather
// than a change at the call site. Each provider owns its own search strategy,
// pacing and credentials — this layer only picks one and injects its token.
// Discogs is the only provider today, so results keep the Discogs shape end-to-end;
// when a second provider lands these become a normalized type each provider maps onto.
export interface SearchProvider {
  search(
    query: string,
    priority?: SearchPriority,
    hints?: SearchHints,
  ): Promise<SearchResult[]>
  getRelease(id: number, priority?: SearchPriority): Promise<Release>
}

const providers: Record<SearchProviderId, SearchProvider> = {
  discogs: {
    search: (query, priority, hints) => {
      const s = getSettings()
      // Defensive: a hand-edited or older settings.json could carry a non-array here,
      // which would make `formats.length` throw deep in the search.
      const formats = Array.isArray(s.discogsFormats) ? s.discogsFormats : []
      return discogs.search(query, s.discogsToken, priority, hints, formats)
    },
    getRelease: (id, priority) => discogs.getRelease(id, getSettings().discogsToken, priority),
  },
}

export const DEFAULT_PROVIDER: SearchProviderId = 'discogs'

// Falls back to the default for an unknown id because the value crosses IPC from
// the renderer and a bad one must not take down the search handler.
export function getProvider(id?: SearchProviderId): SearchProvider {
  return providers[id ?? DEFAULT_PROVIDER] ?? providers[DEFAULT_PROVIDER]
}
