import { stripIgnoredWords } from '../../shared/searchClean'
import type {
  Release,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  SearchResult,
} from '../../shared/types'
import * as bandcamp from '../bandcamp'
import * as beatport from '../beatport'
import { beatportKey } from '../beatportKey'
import * as deezer from '../deezer'
import * as discogs from '../discogs'
import * as musicbrainz from '../musicbrainz'
import { getSettings } from '../settings'

// The user's junk phrases (Settings → Search), stripped from the query and hints at
// this seam — the one place every search crosses — so the sweep, the editor and every
// provider see the same cleaned text. Defensive on the array like discogsFormats below:
// a hand-edited settings.json must not crash the search handler.
function ignoreWordsOf(words: unknown): string[] {
  return Array.isArray(words) ? (words as string[]) : []
}

function cleanQuery(query: string, words: string[]): string {
  return stripIgnoredWords(query.normalize('NFC'), words)
}

// The album hint is dropped here unless "Search by album first" is on, so with the
// setting off every provider receives exactly the hints it always did. Also dropped when
// blank or when it just repeats the title (a single's album tag): the track search
// already tries that, and it must not jump ahead of it.
export function cleanHints(
  hints: SearchHints | undefined,
  words: string[],
  albumFirst: boolean,
): SearchHints | undefined {
  if (!hints) return hints
  const { album, ...rest } = hints
  const cleaned: SearchHints = {
    ...rest,
    title: hints.title === undefined ? undefined : cleanQuery(hints.title, words),
    artist: hints.artist === undefined ? undefined : cleanQuery(hints.artist, words),
  }
  const albumText = albumFirst && album ? cleanQuery(album, words).trim() : ''
  const repeatsTitle = albumText.toLowerCase() === cleaned.title?.trim().toLowerCase()
  return albumText && !repeatsTitle ? { ...cleaned, album: albumText } : cleaned
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
        cleanQuery(query, words),
        s.discogsToken,
        priority,
        cleanHints(hints, words, s.searchByAlbumFirst === true),
        formats,
        // How many the panel will show, so the page is never smaller than the list it
        // has to fill. Defensive like formats above: a hand-edited settings.json must
        // not send NaN into the page size.
        Number(s.discogsMaxResults) || 0,
      )
    },
    getRelease: (ref, priority) =>
      discogs.getRelease(ref as number, getSettings().discogsToken, priority),
  },
  bandcamp: {
    // Bandcamp's autocomplete takes no token and no format filter, so only the ignore
    // words are threaded here; the formats the Discogs path uses are not.
    search: (query, priority, hints) => {
      const s = getSettings()
      const words = ignoreWordsOf(s.searchIgnoreWords)
      return bandcamp.search(
        cleanQuery(query, words),
        priority,
        cleanHints(hints, words, s.searchByAlbumFirst === true),
      )
    },
    getRelease: (ref, priority) => bandcamp.getRelease(ref as string, priority),
  },
  deezer: {
    // Deezer takes no token and no format filter — like Bandcamp, only the ignore
    // words are threaded here.
    search: (query, priority, hints) => {
      const s = getSettings()
      const words = ignoreWordsOf(s.searchIgnoreWords)
      return deezer.search(
        cleanQuery(query, words),
        priority,
        cleanHints(hints, words, s.searchByAlbumFirst === true),
      )
    },
    getRelease: (ref, priority) => deezer.getRelease(ref as number, priority),
  },
  beatport: {
    search: (query, priority, hints) => {
      const s = getSettings()
      const words = ignoreWordsOf(s.searchIgnoreWords)
      return beatport.search(
        cleanQuery(query, words),
        priority,
        cleanHints(hints, words, s.searchByAlbumFirst === true),
      )
    },
    getRelease: async (ref, priority) => {
      const release = await beatport.getRelease(ref as number, priority)
      const notation = getSettings().keyNotation
      return {
        ...release,
        tracklist: release.tracklist.map((t) => ({
          ...t,
          key: beatportKey(t.key, notation) || undefined,
        })),
      }
    },
  },
  musicbrainz: {
    // No token and no format filter either; a release is addressed by the page URL its
    // search row carries, since MusicBrainz ids are UUIDs.
    search: (query, priority, hints) => {
      const s = getSettings()
      const words = ignoreWordsOf(s.searchIgnoreWords)
      return musicbrainz.search(
        cleanQuery(query, words),
        priority,
        cleanHints(hints, words, s.searchByAlbumFirst === true),
      )
    },
    getRelease: (ref, priority) => musicbrainz.getRelease(ref as string, priority),
  },
}

export const DEFAULT_PROVIDER: SearchProviderId = 'discogs'

// Falls back to the default for an unknown id because the value crosses IPC from
// the renderer and a bad one must not take down the search handler.
export function getProvider(id?: SearchProviderId): SearchProvider {
  return providers[id ?? DEFAULT_PROVIDER] ?? providers[DEFAULT_PROVIDER]
}
