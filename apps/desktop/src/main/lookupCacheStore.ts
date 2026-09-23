import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Bounds the persisted file: a release payload (tracklist, images, genres) can run
// tens of KB, so an unbounded cache would grow disk use and the JSON re-parse cost
// without limit over a long-lived install. 300 of each keeps the file in the low
// megabytes even at the largest real entries, while still covering a full session's
// worth of repeat lookups.
const DEFAULT_SEARCH_CAP = 300
const DEFAULT_RELEASE_CAP = 300

// A burst of keystrokes each trigger a search; writing on every one would thrash the
// disk for no benefit since only the final state after the burst matters. Coalesce
// into one write a few seconds after the last mutation.
export const SAVE_DEBOUNCE_MS = 3000

// How long a search that found nothing is remembered in memory. Long enough to cover the
// background sweep asking first and the editor asking again when the track is opened;
// short enough that a transient empty (a drifted payload, a rate limit's empty body) is
// retried within the same session.
export const EMPTY_SEARCH_TTL_MS = 10 * 60 * 1000

interface Options {
  searchCap?: number
  releaseCap?: number
}

export interface LookupCacheStore<S, R> {
  hasSearch(key: string): boolean
  getSearch(key: string): S | undefined
  setSearch(key: string, value: S): void
  rememberEmptySearch(key: string): void
  hasEmptySearch(key: string): boolean
  hasRelease(key: string | number): boolean
  getRelease(key: string | number): R | undefined
  setRelease(key: string | number, value: R): void
}

interface Persisted<S, R> {
  search: [string, S][]
  release: [string, R][]
}

// Stores a search result only when it carries something. An empty list is not a fact
// about the query, it is the one answer the providers cannot tell apart from a failure:
// a 200 whose payload shape drifted, a rate limit answered with an empty body, or every
// hit rejected by the mapper all arrive here as []. Pinning that meant the query never
// reached the network again — not on retry, not after a relaunch, since this cache is on
// disk — and the track stayed permanently unmatchable with no way for the user to force
// a retry. A genuine "nothing found" costs one request the next time it is asked, which
// is the cheap side of that trade.
//
// Kept beside the store rather than in it because the store is generic over S: only the
// caller knows the shape it persists, and only these three persist a list.
//
// The miss is still remembered briefly in memory (never on disk), so the same ladder
// asked again within minutes does not go back out for every empty rung.
export function cacheIfUsable<S, R>(
  store: LookupCacheStore<S[], R>,
  key: string,
  results: S[],
): void {
  if (results.length === 0) store.rememberEmptySearch(key)
  else store.setSearch(key, results)
}

// The read side of cacheIfUsable: a stored answer, a recently remembered miss as [], or
// undefined when the network has to be asked.
export function cachedSearch<S, R>(store: LookupCacheStore<S[], R>, key: string): S[] | undefined {
  return store.getSearch(key) ?? (store.hasEmptySearch(key) ? [] : undefined)
}

// A future shape change to the persisted SearchResult/Release entries is handled by
// bumping the store's file name (e.g. `-v2`), the same convention analysisCache.ts's
// namespaces use — old files are simply orphaned, never migrated in place.
function cachePath(name: string): string {
  return join(app.getPath('userData'), `${name}.json`)
}

// Loading is lazy — the file is only read the first time this store's caller actually
// touches a cache, never eagerly at import/startup — so a cold app launch pays no I/O
// for lookups it may never make this session. Corrupt or missing files degrade to
// empty maps, same contract as every other on-disk cache in this codebase.
function load<S, R>(name: string): { search: Map<string, S>; release: Map<string, R> } {
  try {
    const raw = JSON.parse(readFileSync(cachePath(name), 'utf-8')) as Persisted<S, R>
    if (!Array.isArray(raw.search) || !Array.isArray(raw.release)) {
      return { search: new Map(), release: new Map() }
    }
    return { search: new Map(raw.search), release: new Map(raw.release) }
  } catch {
    return { search: new Map(), release: new Map() }
  }
}

// Write-then-rename so a crash mid-write leaves the previous file intact, never a
// truncated one — same pattern as appleMusicLibraryCache.ts. Best-effort: a failed
// write must not disturb the in-memory cache the session is still serving from.
function save<S, R>(name: string, search: Map<string, S>, release: Map<string, R>): void {
  try {
    const payload: Persisted<S, R> = {
      search: [...search.entries()],
      release: [...release.entries()],
    }
    const tmp = `${cachePath(name)}.tmp`
    writeFileSync(tmp, JSON.stringify(payload))
    renameSync(tmp, cachePath(name))
  } catch {
    return
  }
}

// Inserting past the cap evicts the oldest entry (insertion order — a Map iterates in
// the order keys were first set). Re-setting an existing key must not count as growth
// or reset its place in that order to "newest"; deleting it first and re-inserting
// would do the latter, so an existing key is updated in place instead.
function capacityAwareSet<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  if (!map.has(key) && map.size >= cap) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

// Backs Discogs/Bandcamp's search and release lookup caches with a userData JSON file
// so repeat lookups skip the rate limiter across app restarts, not just within one
// session. The in-memory Maps stay the source of truth for the synchronous hot path
// (search()/getRelease() read them directly, unchanged); this store only adds lazy
// disk hydration on first use and a debounced disk write after mutations.
export function createLookupCacheStore<S, R>(
  name: string,
  opts: Options = {},
): LookupCacheStore<S, R> {
  const searchCap = opts.searchCap ?? DEFAULT_SEARCH_CAP
  const releaseCap = opts.releaseCap ?? DEFAULT_RELEASE_CAP

  let loaded: { search: Map<string, S>; release: Map<string, R> } | null = null
  const ensureLoaded = (): { search: Map<string, S>; release: Map<string, R> } => {
    if (!loaded) loaded = load<S, R>(name)
    return loaded
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (!loaded) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    save(name, loaded.search, loaded.release)
  }
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS)
  }

  // A pending debounced write must not be lost if the app quits before the timer
  // fires — flush synchronously on the way out, same intent as index.ts's other
  // before-quit/will-quit cleanup.
  app.on('before-quit', flush)

  const releaseKey = (key: string | number): string => String(key)

  const emptySearchExpiry = new Map<string, number>()

  return {
    hasSearch: (key) => ensureLoaded().search.has(key),
    getSearch: (key) => ensureLoaded().search.get(key),
    setSearch: (key, value) => {
      capacityAwareSet(ensureLoaded().search, key, value, searchCap)
      scheduleSave()
    },
    rememberEmptySearch: (key) => {
      emptySearchExpiry.set(key, Date.now() + EMPTY_SEARCH_TTL_MS)
    },
    hasEmptySearch: (key) => {
      const expiry = emptySearchExpiry.get(key)
      if (expiry === undefined) return false
      if (Date.now() < expiry) return true
      emptySearchExpiry.delete(key)
      return false
    },
    hasRelease: (key) => ensureLoaded().release.has(releaseKey(key)),
    getRelease: (key) => ensureLoaded().release.get(releaseKey(key)),
    setRelease: (key, value) => {
      capacityAwareSet(ensureLoaded().release, releaseKey(key), value, releaseCap)
      scheduleSave()
    },
  }
}
