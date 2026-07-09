import { stripIgnoredWords } from '../../shared/searchClean'
import type {
  Release,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  SearchResult,
} from '../../shared/types'
import * as bandcamp from '../bandcamp'
import * as discogs from '../discogs'
import { getSettings } from '../settings'

// The user's junk phrases (Settings → Search), stripped from the query and hints at
// this seam — the one place every search crosses — so the sweep, the editor and every
// provider see the same cleaned text. Defensive on the array like discogsFormats below:
// a hand-edited settings.json must not crash the search handler.
function ignoreWordsOf(words: unknown): string[] {
  return Array.isArray(words) ? (words as string[]) : []
}

function cleanHints(hints: SearchHints | undefined, words: string[]): SearchHints | undefined {
  if (!hints || words.length === 0) return hints
  return {
    ...hints,
    title: hints.title === undefined ? undefined : stripIgnoredWords(hints.title, words),
    artist: hints.artist === undefined ? undefined : stripIgnoredWords(hints.artist, words),
  }
}

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
      const words = ignoreWordsOf(s.searchIgnoreWords)
      return discogs.search(
        stripIgnoredWords(query, words),
        s.discogsToken,
        priority,
        cleanHints(hints, words),
        formats,
      )
    },
    getRelease: (ref, priority) =>
      discogs.getRelease(ref as number, getSettings().discogsToken, priority),
  },
  bandcamp: {
    // Bandcamp's autocomplete takes no token and no format filter, so only the ignore
    // words are threaded here; the formats the Discogs path uses are not.
    search: (query, priority, hints) => {
      const words = ignoreWordsOf(getSettings().searchIgnoreWords)
      return bandcamp.search(stripIgnoredWords(query, words), priority, cleanHints(hints, words))
    },
    getRelease: (ref, priority) => bandcamp.getRelease(ref as string, priority),
  },
}

export const DEFAULT_PROVIDER: SearchProviderId = 'discogs'

// Falls back to the default for an unknown id because the value crosses IPC from
// the renderer and a bad one must not take down the search handler.
export function getProvider(id?: SearchProviderId): SearchProvider {
  return providers[id ?? DEFAULT_PROVIDER] ?? providers[DEFAULT_PROVIDER]
}
