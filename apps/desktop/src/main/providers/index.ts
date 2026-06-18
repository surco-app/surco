import type {
  Release,
  SearchResult,
  SearchHints,
  SearchPriority,
  SearchProviderId,
} from '../../shared/types'
import * as bandcamp from '../bandcamp'
import * as discogs from '../discogs'
import { getSettings } from '../settings'

// Search dispatch seam: the IPC layer talks to a provider by id instead of calling a
// client directly, so adding a source is a new entry here rather than a change at the
// call site. Each provider owns its own search strategy, pacing and credentials — this
// layer only picks one and injects its token. Results are the normalized SearchResult/
// Release shape, which each client maps its own API onto. A release is addressed by
// whatever reference its provider needs: Discogs by numeric id, Bandcamp by page URL
// (it has no public id-addressable release), so the ref is `number | string`.
export interface SearchProvider {
  search(query: string, priority?: SearchPriority, hints?: SearchHints): Promise<SearchResult[]>
  getRelease(ref: number | string, priority?: SearchPriority): Promise<Release>
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
    getRelease: (ref, priority) =>
      discogs.getRelease(ref as number, getSettings().discogsToken, priority),
  },
  bandcamp: {
    // Bandcamp's autocomplete takes no token and no format filter, so the hints/formats
    // the Discogs path uses are simply not threaded here.
    search: (query, priority, hints) => bandcamp.search(query, priority, hints),
    getRelease: (ref, priority) => bandcamp.getRelease(ref as string, priority),
  },
}

export const DEFAULT_PROVIDER: SearchProviderId = 'discogs'

// Falls back to the default for an unknown id because the value crosses IPC from
// the renderer and a bad one must not take down the search handler.
export function getProvider(id?: SearchProviderId): SearchProvider {
  return providers[id ?? DEFAULT_PROVIDER] ?? providers[DEFAULT_PROVIDER]
}
