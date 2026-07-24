# Fuente Deezer — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir Deezer como tercera fuente de búsqueda (con lookup exacto por ISRC) para que la música comercial encuentre su release original en vez de remixes de Discogs/Bandcamp.

**Architecture:** Un cliente `main/deezer.ts` que implementa el `SearchProvider` existente y se registra en `main/providers/index.ts`; el ISRC viaja como un `SearchHints.isrc` que solo Deezer consume; una migración aditiva de una sola vez activa la fuente en instalaciones existentes. El resto (checkbox, editor, auto-match, pills) funciona solo al ampliar `SearchProviderId`.

**Tech Stack:** Electron main process, TypeScript, Vitest, API pública de Deezer (sin credenciales).

**Spec:** `docs/superpowers/specs/2026-07-24-fuente-deezer-design.md`

## Global Constraints

- Repo con npm (NUNCA pnpm). Ejecutar todo desde la raíz del worktree.
- NO ejecutar `npm run check` (reformatea ~92 ficheros ajenos). Lint por fichero: `npx biome check <paths>` desde `apps/desktop/`.
- Comentarios en el estilo del repo: explican restricciones/porqués no obvios, en inglés, como los ficheros vecinos (`bandcamp.ts` es la referencia).
- Strings visibles al usuario SIEMPRE vía i18n, en los 5 locales (`de`, `en`, `es`, `fr`, `pt-BR`) — hay un test de paridad que falla si un locale se queda atrás, y otro (`usedKeys.test.ts`) si una clave no se usa.
- Mensajes de error del main process en español ("Deezer devolvió 500"), patrón `discogs.ts`.
- TDD: cada paso rojo→verde. Commits con título descriptivo, sin cuerpo, sin prefijos `feat:`/`fix:`.
- Tests de un fichero: `npm exec --workspace apps/desktop -- vitest run <ruta relativa a apps/desktop>`. Suite completa: `npm test`.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `apps/desktop/src/main/deezer.ts` (nuevo) | Cliente Deezer: search por texto + ISRC, getRelease, mapeos, cache, errores |
| `apps/desktop/src/main/deezerLimiter.ts` (nuevo) | Rate limiter propio (25 req/5s, mitad de la cuota oficial) |
| `apps/desktop/src/main/deezer.test.ts` (nuevo) | Tests del cliente |
| `apps/desktop/src/main/providers/index.ts` | Entrada `deezer` en el registro |
| `apps/desktop/src/shared/types.ts` | Uniones `SearchProviderId`/`ActivityKind`, `SearchHints.isrc`, `LifetimeStats.deezerMatches`, `Settings.deezerProviderMigrated` |
| `apps/desktop/src/shared/defaults.ts` | `SEARCH_PROVIDERS` con `'deezer'` |
| `apps/desktop/src/shared/metadata.ts` | `searchHintsOf` incluye `isrc` |
| `apps/desktop/src/main/settings.ts` | Default de stats/marca + `migrateProviderDefaults()` |
| `apps/desktop/src/main/index.ts` | Allowlist de stats + llamada a la migración en el arranque |
| `apps/desktop/src/renderer/src/lib/autoMatch.ts` | `PROVIDER_NAME.deezer` |
| `apps/desktop/src/renderer/src/lib/stats.ts` | `matchStatKey('deezer')` |
| `apps/desktop/src/renderer/src/lib/statsImage.ts` | `CELL_ORDER` con `deezerMatches` |
| `apps/desktop/src/renderer/src/components/ActivityPanel.tsx` | `KIND_ICON.deezer` |
| `apps/desktop/src/renderer/src/components/settings/StatsTab.tsx` | `CELLS` + `MatchSplit` generalizado a N fuentes |
| `apps/desktop/src/renderer/src/i18n/locales/*.json` (×5) | `settings.provider.deezer`, `activity.searchDeezer`, `activity.loadDeezerRelease`, `settings.stats.deezerMatches` |

Notas de arquitectura que el implementador debe conocer:

- El registro (`providers/index.ts`) es `Record<SearchProviderId, SearchProvider>`: ampliar la unión SIN añadir la entrada no compila. Por eso la Task 1 hace unión + cliente + entrada + ripple de `Record`s en un solo commit.
- El sweep de auto-match (`renderer/src/lib/autoMatch.ts:autoMatchRelease`) ya trata cualquier fuente no-Discogs como fallback: Discogs primero siempre, las demás solo si el track tiene duración, con suelo de confianza 0.92 y sin sugerencias de revisión. Deezer hereda esas reglas sin tocar nada — es exactamente el comportamiento que el spec pide.
- El editor (`useDiscogsBrowser`) y el sweep construyen hints con `searchHintsOf(meta)`; añadir `isrc` ahí lo propaga a ambos sin más cambios. `cleanHints` en el seam hace spread, así que `isrc` pasa intacto.
- API Deezer: los errores llegan como HTTP 200 con `{"error":{"code":N}}` en el body. Código 4 = cuota agotada (reintentar), 800 = "no data" (lookup vacío, no es error). ISRC: `GET /track/isrc:{isrc}`. Search: `GET /search?q=...` devuelve tracks (no álbumes) bajo `data`. Álbum: `GET /album/{id}` + tracklist paginado en `GET /album/{id}/tracks?limit=100` con puntero `next`.

---

### Task 1: Cliente Deezer + registro + checkbox

**Files:**
- Create: `apps/desktop/src/main/deezerLimiter.ts`
- Create: `apps/desktop/src/main/deezer.ts`
- Create: `apps/desktop/src/main/deezer.test.ts`
- Modify: `apps/desktop/src/shared/types.ts:44` (SearchProviderId), `:539` (ActivityKind)
- Modify: `apps/desktop/src/shared/defaults.ts:28` (SEARCH_PROVIDERS)
- Modify: `apps/desktop/src/main/providers/index.ts`
- Modify: `apps/desktop/src/renderer/src/lib/autoMatch.ts:359` (PROVIDER_NAME)
- Modify: `apps/desktop/src/renderer/src/components/ActivityPanel.tsx:56` (KIND_ICON)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{de,en,es,fr,pt-BR}.json`

**Interfaces:**
- Consumes: `SearchProvider` (providers/index.ts), `createRateLimiter(burst, windowMs)` (shared/rateLimiter.ts), `createLookupCacheStore<S,R>(name)` (main/lookupCacheStore.ts), `buildSearchCandidates(query, hints, {includeCatalog})` (main/searchQuery.ts), `activity.track(kind, labelKey, fn, opts)` (main/activity.ts), `REQUEST_TIMEOUT_MS`/`USER_AGENT` (main/http.ts)
- Produces: `deezer.search(query: string, priority?: SearchPriority, hints?: SearchHints): Promise<SearchResult[]>`, `deezer.getRelease(id: number, priority?: SearchPriority): Promise<Release>`, `deezer.groupByAlbum(hits)` y `deezer.mapRelease(album, tracks)` exportadas para test. La Task 3 añade el camino ISRC a `search`; la Task 4 depende de `SEARCH_PROVIDERS` ya ampliado.

- [ ] **Step 1: Ampliar las uniones y el default** (sin test propio: lo cubre el typecheck y los tests de los pasos siguientes)

En `apps/desktop/src/shared/types.ts`:

```ts
export type SearchProviderId = 'discogs' | 'bandcamp' | 'deezer'
```

y en la unión `ActivityKind`, tras `| 'bandcamp'`:

```ts
  | 'deezer'
```

En `apps/desktop/src/shared/defaults.ts`:

```ts
export const SEARCH_PROVIDERS: readonly SearchProviderId[] = ['discogs', 'bandcamp', 'deezer']
```

Nota: a partir de aquí `apps/desktop` NO compila (los `Record<SearchProviderId, …>` exigen la clave `deezer`) hasta completar los pasos 2–6 de esta task. Es el ripple esperado; no committear hasta el step 9.

- [ ] **Step 2: Crear el limiter**

`apps/desktop/src/main/deezerLimiter.ts`:

```ts
import { createRateLimiter } from '../shared/rateLimiter'

// Deezer's public API allows 50 requests per 5 seconds per IP. Half that budget keeps
// Surco a good citizen while a burst still makes an interactive search feel instant.
// Its own module (like the Discogs and Bandcamp ones) so the client owns its pacing
// and tests can mock it to run without real timers.
const DEEZER_BURST = 10
const DEEZER_WINDOW_MS = 2000 // 10 tokens / 2s = 25 req/5s sustained

export const deezerLimiter = createRateLimiter(DEEZER_BURST, DEEZER_WINDOW_MS)
```

- [ ] **Step 3: Test rojo — mapeo de búsqueda agrupada por álbum**

`apps/desktop/src/main/deezer.test.ts` (el andamiaje de mocks calca `bandcamp.test.ts`):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

// Every call paces through the shared limiter; mock it to a no-op so these unit tests
// don't wait on real timers between requests.
vi.mock('./deezerLimiter', () => ({ deezerLimiter: { acquire: vi.fn() } }))

// The search/release caches persist through lookupCacheStore, which reads
// app.getPath('userData'); point it at a throwaway temp dir so these unit tests
// never touch a real user profile.
const { deezerCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { deezerCacheDir: mkdtempSync(join(tmpdir(), 'surco-deezer-cache-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => deezerCacheDir, on: () => {} } }))

import { getRelease, groupByAlbum, mapRelease, search } from './deezer'

// Deezer answers every endpoint with JSON bodies; errors ride a 200 with an `error`
// object, so the mock always responds ok and the body drives each scenario.
function mockFetch(bodies: unknown[]): ReturnType<typeof vi.fn> {
  let call = 0
  const fn = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => bodies[Math.min(call++, bodies.length - 1)],
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('groupByAlbum', () => {
  // The search endpoint returns one hit per TRACK; the results column lists releases,
  // so two tracks of the same album must collapse into one row, keeping Deezer's
  // relevance order by first appearance.
  it('collapses track hits into one result per album, keeping order', () => {
    const hits = [
      {
        id: 1,
        title: 'pa ti toa <3',
        artist: { name: 'Ana Mena' },
        album: { id: 10, title: 'pa ti toa <3', cover_medium: 'm10', cover_xl: 'xl10' },
      },
      {
        id: 2,
        title: 'pa ti toa <3 (acústico)',
        artist: { name: 'Ana Mena' },
        album: { id: 10, title: 'pa ti toa <3', cover_medium: 'm10', cover_xl: 'xl10' },
      },
      {
        id: 3,
        title: 'pa ti toa remix',
        artist: { name: 'Otro' },
        album: { id: 20, title: 'Remixes', cover_medium: 'm20', cover_xl: 'xl20' },
      },
    ]
    expect(groupByAlbum(hits)).toEqual([
      {
        provider: 'deezer',
        id: 10,
        title: 'Ana Mena - pa ti toa <3',
        thumb: 'm10',
        cover_image: 'xl10',
      },
      { provider: 'deezer', id: 20, title: 'Otro - Remixes', thumb: 'm20', cover_image: 'xl20' },
    ])
  })

  it('drops hits without album data, which name nothing fetchable', () => {
    expect(groupByAlbum([{ id: 1, title: 'huérfano' }])).toEqual([])
  })
})
```

Run: `npm exec --workspace apps/desktop -- vitest run src/main/deezer.test.ts`
Expected: FAIL — `Cannot find module './deezer'`.

- [ ] **Step 4: Implementación mínima — `deezer.ts` con búsqueda por texto**

`apps/desktop/src/main/deezer.ts`:

```ts
import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { deezerLimiter } from './deezerLimiter'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { createLookupCacheStore } from './lookupCacheStore'
import { buildSearchCandidates } from './searchQuery'

const BASE = 'https://api.deezer.com'

// Deezer signals problems inside a 200 body: quota exhaustion is `error.code` 4 and an
// empty lookup (an ISRC it doesn't carry) is 800 — the latter is a miss, not a failure.
const QUOTA_CODE = 4
const NO_DATA_CODE = 800
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface DeezerErrorBody {
  error?: { code?: number }
}

// One paced request. Quota retries take a fresh limiter token each attempt — a retry is
// another request, and skipping the limiter would hammer Deezer exactly when it is
// already signalling overload (the same reasoning as the Discogs client's 429 path).
async function api<T>(url: string, priority?: SearchPriority): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await deezerLimiter.acquire(priority)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Deezer devolvió ${res.status}`)
    const data = (await res.json()) as T & DeezerErrorBody
    const code = data.error?.code
    if (code === QUOTA_CODE) {
      if (attempt >= MAX_RETRIES)
        throw new Error('Límite de peticiones de Deezer alcanzado. Espera un momento.')
      await sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS))
      continue
    }
    if (code !== undefined && code !== NO_DATA_CODE) throw new Error(`Deezer devolvió error ${code}`)
    return data
  }
}

interface DeezerAlbumRef {
  id: number
  title: string
  cover_medium?: string
  cover_xl?: string
}

interface DeezerTrackHit {
  id: number
  title: string
  artist?: { name?: string }
  album?: DeezerAlbumRef
}

// The search endpoint returns tracks; the results column lists releases, so hits are
// grouped into one row per album, keeping Deezer's relevance order by first appearance.
// A hit without album data names nothing fetchable and is dropped.
export function groupByAlbum(hits: DeezerTrackHit[]): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<number>()
  for (const hit of hits) {
    const album = hit.album
    if (!album || seen.has(album.id)) continue
    seen.add(album.id)
    out.push({
      provider: 'deezer',
      id: album.id,
      title: hit.artist?.name ? `${hit.artist.name} - ${album.title}` : album.title,
      thumb: album.cover_medium,
      cover_image: album.cover_xl,
    })
  }
  return out
}

// Backed by userData/deezer-lookup-cache.json so a search or release already fetched
// in a previous session skips the network call on the next launch (same pattern as
// the Bandcamp client).
const cacheStore = createLookupCacheStore<SearchResult[], Release>('deezer-lookup-cache')

async function searchOnce(text: string, priority?: SearchPriority): Promise<SearchResult[]> {
  const key = text.trim().toLowerCase()
  const cached = cacheStore.getSearch(key)
  if (cached) return cached
  const data = await api<{ data?: DeezerTrackHit[] }>(
    `${BASE}/search?q=${encodeURIComponent(text)}&limit=25`,
    priority,
  )
  const results = groupByAlbum(data.data ?? [])
  cacheStore.setSearch(key, results)
  return results
}

// Deezer's search is as brittle with download-filename noise as Bandcamp's, so it rides
// the same cleaned-then-relaxed candidate ladder, keeping the first candidate that
// returns anything. No catalog-number candidate: like Bandcamp, Deezer has no catalog
// index and the code would match unrelated releases.
export async function search(
  query: string,
  priority?: SearchPriority,
  hints: SearchHints = {},
): Promise<SearchResult[]> {
  return activity.track(
    'deezer',
    'activity.searchDeezer',
    async () => {
      let results: SearchResult[] = []
      for (const candidate of buildSearchCandidates(query, hints, { includeCatalog: false })) {
        results = await searchOnce(candidate, priority)
        if (results.length) break
      }
      return results
    },
    {
      labelParams: { query },
      summary: (r) => ({ detailKey: 'activity.resultCount', detailParams: { count: r.length } }),
    },
  )
}

interface DeezerAlbumTrack {
  id: number
  title: string
  duration?: number
  track_position?: number
  artist?: { name?: string }
}

interface DeezerAlbum {
  id: number
  title: string
  artist?: { name?: string }
  contributors?: { name?: string; role?: string }[]
  release_date?: string
  genres?: { data?: { name?: string }[] }
  cover_medium?: string
  cover_xl?: string
}

// Track lengths arrive as integer seconds; the scorer compares against "m:ss", so
// convert. Zero/absent durations carry none.
function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// Dates read "YYYY-MM-DD"; only the year survives into Release.
function parseYear(date: string | undefined): number | undefined {
  const m = date?.match(/^(\d{4})/)
  return m ? Number(m[1]) : undefined
}

// Main-role contributors carry a collaboration's full credit ("Ana Mena" AND
// "Lola Indigo") where `artist` names only the lead act; take them when present so the
// release credits every main artist, falling back to the lead for solo albums.
function albumArtists(album: DeezerAlbum): { name: string }[] {
  const main = (album.contributors ?? []).filter(
    (c): c is { name: string; role?: string } =>
      typeof c.name === 'string' && (c.role === undefined || c.role === 'Main'),
  )
  if (main.length) return main.map((c) => ({ name: c.name }))
  return album.artist?.name ? [{ name: album.artist.name }] : []
}

export function mapRelease(album: DeezerAlbum, tracks: DeezerAlbumTrack[]): Release {
  const cover = album.cover_xl ?? album.cover_medium
  const genres = (album.genres?.data ?? [])
    .map((g) => g.name)
    .filter((n): n is string => typeof n === 'string' && n !== '')
  return {
    provider: 'deezer',
    id: album.id,
    title: album.title,
    artists: albumArtists(album),
    year: parseYear(album.release_date),
    genres: genres.length ? genres : undefined,
    images: cover ? [{ uri: cover, type: 'primary', resource_url: cover }] : undefined,
    tracklist: tracks.map((t, i) => ({
      position: String(t.track_position ?? i + 1),
      // A compilation names each track's own artist here; expose it so the editor's
      // Artist fills from the track, mirroring the Bandcamp mapping.
      artists: t.artist?.name ? [{ name: t.artist.name }] : undefined,
      title: t.title,
      duration: formatDuration(t.duration),
    })),
  }
}

// How many tracklist pages to follow at most: Deezer pages via `next` and 10 pages of
// 100 covers any real release; the bound keeps a malformed `next` loop from spinning.
const MAX_TRACK_PAGES = 10

export async function getRelease(id: number, priority?: SearchPriority): Promise<Release> {
  const cacheKey = String(id)
  const cached = cacheStore.getRelease(cacheKey)
  if (cached) return cached
  return activity.track(
    'deezer',
    'activity.loadDeezerRelease',
    async () => {
      const album = await api<DeezerAlbum>(`${BASE}/album/${id}`, priority)
      // The album payload embeds only the first slice of a long tracklist; the tracks
      // endpoint pages through the rest via its `next` pointer.
      const tracks: DeezerAlbumTrack[] = []
      let url: string | undefined = `${BASE}/album/${id}/tracks?limit=100`
      for (let page = 0; url && page < MAX_TRACK_PAGES; page++) {
        const chunk = await api<{ data?: DeezerAlbumTrack[]; next?: string }>(url, priority)
        tracks.push(...(chunk.data ?? []))
        url = chunk.next
      }
      const release = mapRelease(album, tracks)
      cacheStore.setRelease(cacheKey, release)
      return release
    },
    { detail: String(id), summary: (r) => ({ detail: r.title }), url: `https://www.deezer.com/album/${id}` },
  )
}
```

Run: `npm exec --workspace apps/desktop -- vitest run src/main/deezer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Test rojo — getRelease, cuota y cache**

Añadir a `deezer.test.ts`:

```ts
describe('getRelease', () => {
  const album = {
    id: 10,
    title: 'pa ti toa <3',
    artist: { name: 'Ana Mena' },
    contributors: [
      { name: 'Ana Mena', role: 'Main' },
      { name: 'Lola Indigo', role: 'Main' },
      { name: 'Productor X', role: 'Featured' },
    ],
    release_date: '2026-06-12',
    genres: { data: [{ name: 'Pop' }] },
    cover_xl: 'xl10',
  }
  const tracksPage = {
    data: [
      { id: 1, title: 'pa ti toa <3', duration: 213, track_position: 1, artist: { name: 'Ana Mena' } },
    ],
  }

  // The scorer compares durations as "m:ss" and credits every Main contributor — a
  // collaboration single must not lose its second act to the lead-only `artist` field.
  it('maps album + paged tracks to a Release with m:ss durations and all main artists', async () => {
    mockFetch([album, tracksPage])
    const rel = await getRelease(10)
    expect(rel).toMatchObject({
      provider: 'deezer',
      id: 10,
      title: 'pa ti toa <3',
      artists: [{ name: 'Ana Mena' }, { name: 'Lola Indigo' }],
      year: 2026,
      genres: ['Pop'],
      images: [{ uri: 'xl10', type: 'primary', resource_url: 'xl10' }],
    })
    expect(rel.tracklist).toEqual([
      { position: '1', artists: [{ name: 'Ana Mena' }], title: 'pa ti toa <3', duration: '3:33' },
    ])
  })

  // Quota exhaustion arrives as HTTP 200 with error.code 4 — it must retry, not map an
  // empty release from the error body.
  it('retries a quota body and succeeds on the next attempt', async () => {
    vi.useFakeTimers()
    try {
      mockFetch([{ error: { code: 4 } }, { ...album, id: 11 }, tracksPage])
      const p = getRelease(11)
      await vi.runAllTimersAsync()
      const rel = await p
      expect(rel.title).toBe('pa ti toa <3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('serves a repeated release from the cache without refetching', async () => {
    const fn = mockFetch([{ ...album, id: 12 }, tracksPage])
    await getRelease(12)
    const calls = fn.mock.calls.length
    await getRelease(12)
    expect(fn.mock.calls.length).toBe(calls)
  })
})

describe('search', () => {
  // The raw file-derived query often finds nothing where a relaxed candidate would; the
  // ladder must fall through to the next candidate instead of returning the empty set.
  it('falls through empty candidates until one returns results', async () => {
    const hit = {
      id: 1,
      title: 'pa ti toa <3',
      artist: { name: 'Ana Mena' },
      album: { id: 10, title: 'pa ti toa <3', cover_medium: 'm', cover_xl: 'xl' },
    }
    mockFetch([{ data: [] }, { data: [hit] }])
    const results = await search('01 pa ti toa (vinyl rip)', 'high', {
      artist: 'Ana Mena',
      title: 'pa ti toa',
    })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(10)
  })
})
```

Nota: `getRelease` cachea por id, así que cada test usa un id distinto (10/11/12) para no servirse resultados entre sí del cache persistente del temp dir.

Run: `npm exec --workspace apps/desktop -- vitest run src/main/deezer.test.ts`
Expected: PASS si el Step 4 quedó completo (estos tests validan lo ya escrito; si algo falla, corregir `deezer.ts` hasta verde). El test de actividad requiere que `activity.track` funcione bajo mock de electron — `activity.ts` no toca electron en import, no necesita mock extra.

- [ ] **Step 6: Ripple de compilación — registro, PROVIDER_NAME, KIND_ICON**

`apps/desktop/src/main/providers/index.ts` — añadir import y entrada tras `bandcamp`:

```ts
import * as deezer from '../deezer'
```

```ts
  deezer: {
    // Deezer takes no token and no format filter — like Bandcamp, only the ignore
    // words are threaded here.
    search: (query, priority, hints) => {
      const words = ignoreWordsOf(getSettings().searchIgnoreWords)
      return deezer.search(stripIgnoredWords(query, words), priority, cleanHints(hints, words))
    },
    getRelease: (ref, priority) => deezer.getRelease(ref as number, priority),
  },
```

`apps/desktop/src/renderer/src/lib/autoMatch.ts` (PROVIDER_NAME, ~línea 359):

```ts
const PROVIDER_NAME: Record<SearchProviderId, string> = {
  discogs: 'Discogs',
  bandcamp: 'Bandcamp',
  deezer: 'Deezer',
}
```

`apps/desktop/src/renderer/src/components/ActivityPanel.tsx` — añadir `Radio` al import de `lucide-react` y la entrada:

```ts
  deezer: Radio,
```

- [ ] **Step 7: Test del seam — `providers/index.test.ts`**

IMPRESCINDIBLE aunque no se añadiera test: ese fichero mockea `../discogs` y `../bandcamp` por módulo completo; al importar ahora `providers/index.ts` también `../deezer`, sin su mock cargaría el cliente real (que arrastra `electron` vía `lookupCacheStore`) y el test moriría en el import.

En `apps/desktop/src/main/providers/index.test.ts`, añadir `dzSearch` al `vi.hoisted` (junto a `bcSearch`):

```ts
  dzSearch: vi.fn(),
```

(y extraerlo en la desestructuración de la izquierda), más el mock del módulo junto al de bandcamp:

```ts
vi.mock('../deezer', () => ({ search: dzSearch, getRelease: vi.fn() }))
```

Y el test del seam, calcando el de Bandcamp:

```ts
  it('strips the saved ignore words for Deezer too', async () => {
    getSettings.mockReturnValueOnce({
      discogsToken: 'tok',
      discogsFormats: [] as string[],
      searchIgnoreWords: ['rip djotas good'],
    })
    dzSearch.mockResolvedValue([])
    await getProvider('deezer').search('Song rip djotas good', 'low', {
      title: 'Song rip djotas good',
    })
    expect(dzSearch).toHaveBeenCalledWith('Song', 'low', { title: 'Song' })
  })
```

Run: `npm exec --workspace apps/desktop -- vitest run src/main/providers/index.test.ts`
Expected: PASS (los 7 previos + el nuevo).

- [ ] **Step 8: Claves i18n en los 5 locales**

En cada `apps/desktop/src/renderer/src/i18n/locales/{de,en,es,fr,pt-BR}.json`, junto a sus hermanas existentes (buscar `searchBandcamp` y `"provider"` en cada fichero para el anclaje exacto):

- `settings.provider.deezer`: `"Deezer"` (marca, idéntica en los 5).
- `activity.searchDeezer` — calcar la fórmula de `searchBandcamp` de ese locale. es: `"Buscando en Deezer: {{query}}"`, en: `"Searching Deezer: {{query}}"`, y para de/fr/pt-BR sustituir "Bandcamp" por "Deezer" en su propia cadena `searchBandcamp`.
- `activity.loadDeezerRelease` — calcar `loadBandcampRelease`. es: `"Cargando release de Deezer"`, en: `"Loading Deezer release"`, resto por sustitución igual.

- [ ] **Step 9: Verificación de la task**

```bash
npm exec --workspace apps/desktop -- tsc --noEmit
npm exec --workspace apps/desktop -- vitest run src/main/deezer.test.ts src/main/providers/index.test.ts src/renderer/src/i18n src/renderer/src/components/SettingsModal.test.tsx
cd apps/desktop && npx biome check src/main/deezer.ts src/main/deezerLimiter.ts src/main/deezer.test.ts src/main/providers/index.ts src/renderer/src/lib/autoMatch.ts src/renderer/src/components/ActivityPanel.tsx && cd ../..
```

(Si `tsc --noEmit` no existe como binario directo, usar el script del workspace: `npm run typecheck --workspace apps/desktop` si está definido en su package.json; comprobar con `grep typecheck apps/desktop/package.json`.)

Expected: typecheck limpio; tests verdes — el test del wizard/SettingsModal puede fallar si enumera checkboxes: actualizarlo para incluir `settings-provider-deezer` (el checkbox nuevo es comportamiento deseado, no regresión). El test de paridad/uso de i18n valida las claves nuevas.

- [ ] **Step 10: Commit**

```bash
git add -A apps/desktop/src docs
git commit -m "Add Deezer as a search provider"
```

---

### Task 2: Stats por fuente — `deezerMatches`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`LifetimeStats`, ~línea 258–262)
- Modify: `apps/desktop/src/main/settings.ts:87` (defaults.stats)
- Modify: `apps/desktop/src/main/index.ts:563` (allowlist `stats:record`)
- Modify: `apps/desktop/src/renderer/src/lib/stats.ts:34` (`matchStatKey`)
- Modify: `apps/desktop/src/renderer/src/lib/statsImage.ts:20` (`CELL_ORDER`)
- Modify: `apps/desktop/src/renderer/src/components/settings/StatsTab.tsx` (`CELLS`, `MatchSplit`)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/*.json` (×5, `settings.stats.deezerMatches`)
- Test: `apps/desktop/src/renderer/src/lib/stats.test.ts`, `apps/desktop/src/main/settings.test.ts` (ya existen; ampliar)

**Interfaces:**
- Consumes: `matchStatKey(provider)` es lo que `useAutoMatch.ts:195` y el apply del editor bumpean tras un match.
- Produces: `LifetimeStats.deezerMatches: number`; `matchStatKey('deezer') === 'deezerMatches'`. `MatchSplit` pasa a recibir `sources: { key: string; label: string; count: number; swatch: string }[]`.

- [ ] **Step 1: Test rojo — `matchStatKey`**

En `apps/desktop/src/renderer/src/lib/stats.test.ts`, junto a los tests existentes de `matchStatKey` (si no hay describe propio, crearlo):

```ts
it('routes a Deezer match to its own tally', () => {
  expect(matchStatKey('deezer')).toBe('deezerMatches')
})
```

Run: `npm exec --workspace apps/desktop -- vitest run src/renderer/src/lib/stats.test.ts`
Expected: FAIL — devuelve `'discogsMatches'` (el fallback actual) y el tipo de retorno ni contiene `'deezerMatches'`.

- [ ] **Step 2: Implementación — tipo, default, allowlist, `matchStatKey`**

`types.ts`, en `LifetimeStats` tras `bandcampMatches: number`:

```ts
  deezerMatches: number
```

`main/settings.ts` defaults:

```ts
  stats: {
    imported: 0,
    listened: 0,
    analyzed: 0,
    discogsMatches: 0,
    bandcampMatches: 0,
    deezerMatches: 0,
  },
```

`main/index.ts` allowlist de `stats:record`: añadir `'deezerMatches'` tras `'bandcampMatches'`.

`renderer/src/lib/stats.ts`:

```ts
// Which lifetime tally a match apply bumps, keyed by the release's provider.
export function matchStatKey(
  provider: string,
): 'discogsMatches' | 'bandcampMatches' | 'deezerMatches' {
  if (provider === 'bandcamp') return 'bandcampMatches'
  if (provider === 'deezer') return 'deezerMatches'
  return 'discogsMatches'
}
```

Run: `npm exec --workspace apps/desktop -- vitest run src/renderer/src/lib/stats.test.ts`
Expected: PASS.

- [ ] **Step 3: Test rojo — un settings.json viejo se cura solo**

En `apps/desktop/src/main/settings.test.ts`, dentro del describe `nested settings from an older install` ya existente (seguir el patrón del test `fills a stats key an older settings.json never wrote`):

```ts
it('fills deezerMatches for a stats object written before the Deezer source existed', () => {
  writeFileSync(
    join(app.getPath('userData'), 'settings.json'),
    JSON.stringify({
      stats: { imported: 3, listened: 1, analyzed: 2, discogsMatches: 4, bandcampMatches: 1 },
    }),
  )
  expect(getSettings().stats.deezerMatches).toBe(0)
})
```

Run: `npm exec --workspace apps/desktop -- vitest run src/main/settings.test.ts`
Expected: PASS directamente (el spread-merge de `mergeSettings` ya cura stats) — si falla, algo se rompió en el Step 2. Este test encode el porqué: un fichero antiguo no debe dejar `undefined` que `recordStat` corrompa a NaN.

- [ ] **Step 4: UI — `CELLS`, `MatchSplit` a N fuentes, `CELL_ORDER`, i18n**

`StatsTab.tsx` — `CELLS` (el icono `Radio` viene de `lucide-react`, añadir al import):

```ts
const CELLS: { key: keyof LifetimeStats; icon: typeof FolderDown }[] = [
  ...ACTIVITY_CELLS,
  { key: 'discogsMatches', icon: Disc3 },
  { key: 'bandcampMatches', icon: Store },
  { key: 'deezerMatches', icon: Radio },
]
```

`MatchSplit` completo (reemplaza al actual; los data-testid existentes — `stats-match-split`, `stats-match-discogs`, `stats-discogsMatches`, `stats-bandcampMatches` — se conservan por construcción):

```tsx
// Matches by source as one proportional bar, a segment per source with the raw counts
// beside their swatches. When no match has landed yet the bar stays flat and empty
// rather than dividing by zero.
function MatchSplit({
  heading,
  sources,
}: {
  heading: string
  sources: { key: string; label: string; count: number; swatch: string }[]
}): React.JSX.Element {
  const total = sources.reduce((sum, s) => sum + s.count, 0)
  return (
    <div
      data-testid="stats-match-split"
      className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] px-4 py-3 text-left"
    >
      <p className="text-xs font-medium text-fg-muted">{heading}</p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--color-field)]">
        {sources.map((s) => (
          <div
            key={s.key}
            data-testid={`stats-match-${s.key}`}
            className={`h-full ${s.swatch}`}
            style={{ width: total > 0 ? `${(s.count / total) * 100}%` : '0%' }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        {sources.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-fg-muted">
            <span className={`h-2 w-2 rounded-full ${s.swatch}`} aria-hidden="true" />
            {s.label}
            <span
              data-testid={`stats-${s.key}Matches`}
              className="font-semibold tabular-nums text-fg"
            >
              {s.count}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
```

Call site:

```tsx
          <MatchSplit
            heading={tr('settings.stats.matchSources')}
            sources={[
              {
                key: 'discogs',
                label: tr('settings.stats.discogsMatches'),
                count: stats.discogsMatches,
                swatch: 'bg-[var(--color-accent)]',
              },
              {
                key: 'bandcamp',
                label: tr('settings.stats.bandcampMatches'),
                count: stats.bandcampMatches,
                swatch: 'bg-[var(--color-fg-dim)]/70',
              },
              {
                key: 'deezer',
                label: tr('settings.stats.deezerMatches'),
                count: stats.deezerMatches,
                swatch: 'bg-[var(--color-good)]',
              },
            ]}
          />
```

`statsImage.ts` `CELL_ORDER`: añadir `'deezerMatches'` al final.

i18n ×5, junto a `bandcampMatches` de cada locale: es `"Encontradas en Deezer"`, en `"Found on Deezer"`, y de/fr/pt-BR por sustitución de "Bandcamp"→"Deezer" en su propia cadena.

- [ ] **Step 5: Verificación de la task**

```bash
npm exec --workspace apps/desktop -- tsc --noEmit
npm exec --workspace apps/desktop -- vitest run src/renderer/src/lib/stats.test.ts src/renderer/src/lib/statsImage.test.ts src/main/settings.test.ts src/renderer/src/components/SettingsModal.test.tsx src/renderer/src/i18n
```

Expected: verde. `statsImage.test.ts` y los tests de `MatchSplit`/StatsTab (buscar con `grep -rn "stats-match" apps/desktop/src`) pueden enumerar celdas — actualizarlos añadiendo `deezerMatches`, no relajarlos.

- [ ] **Step 6: Commit**

```bash
git add -A apps/desktop/src
git commit -m "Track Deezer matches in the lifetime stats"
```

---

### Task 3: Camino ISRC — `SearchHints.isrc`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (interface `SearchHints`, ~línea 53)
- Modify: `apps/desktop/src/shared/metadata.ts:51` (`searchHintsOf`)
- Modify: `apps/desktop/src/main/deezer.ts` (`search` + `trackByIsrc`)
- Test: `apps/desktop/src/main/deezer.test.ts`, `apps/desktop/src/shared/metadata.test.ts`

**Interfaces:**
- Consumes: `deezer.search`/`groupByAlbum`/`api` de la Task 1. `searchHintsOf` alimenta tanto `useAutoMatch.ts:137` como `useDiscogsBrowser.ts:205`, así que NO hay cambios de renderer: el hint llega solo.
- Produces: `SearchHints.isrc?: string`. Solo el proveedor Deezer lo consume; `cleanHints` (providers/index.ts) lo deja pasar por el spread.

- [ ] **Step 1: Test rojo — searchHintsOf propaga el ISRC**

En `apps/desktop/src/shared/metadata.test.ts` (hay tests de `searchHintsOf`; añadir junto a ellos):

```ts
it('carries the tag ISRC so the Deezer provider can resolve the exact recording', () => {
  const hints = searchHintsOf({ ...base, isrc: 'ES5022600597' })
  expect(hints.isrc).toBe('ES5022600597')
})
```

(`base` es la metadata de fixture que ese fichero ya use para los tests vecinos de `searchHintsOf` — reutilizarla con el nombre que tenga; si los vecinos construyen el objeto inline, hacer lo mismo.)

Run: `npm exec --workspace apps/desktop -- vitest run src/shared/metadata.test.ts`
Expected: FAIL — `hints.isrc` es `undefined` (y TS marca la propiedad inexistente en `SearchHints`).

- [ ] **Step 2: Implementación — tipo + hint**

`types.ts`, en `SearchHints` tras `catalogNumber?: string`:

```ts
  // The recording's ISRC from the file's own tags (streaming rips carry it). Only the
  // Deezer provider consumes it: an exact-identity lookup that puts the original
  // release in the pool ahead of any fuzzy text match.
  isrc?: string
```

`metadata.ts`:

```ts
export function searchHintsOf(meta: TrackMetadata): SearchHints {
  return {
    artist: meta.artist,
    title: meta.title,
    catalogNumber: meta.catalogNumber,
    isrc: meta.isrc,
  }
}
```

Run: `npm exec --workspace apps/desktop -- vitest run src/shared/metadata.test.ts`
Expected: PASS.

- [ ] **Step 3: Test rojo — el hit por ISRC encabeza; el miss cae a texto**

En `deezer.test.ts`:

```ts
describe('search with an ISRC hint', () => {
  const isrcTrack = {
    id: 99,
    title: 'pa ti toa <3',
    artist: { name: 'Ana Mena' },
    album: { id: 50, title: 'pa ti toa <3', cover_medium: 'm50', cover_xl: 'xl50' },
  }
  const remixHit = {
    id: 7,
    title: 'pa ti toa (X Remix)',
    artist: { name: 'X' },
    album: { id: 60, title: 'Remixes', cover_medium: 'm60', cover_xl: 'xl60' },
  }

  // The whole point of the ISRC: the exact recording's album must lead the pool so the
  // probe scores the original before any lookalike, without deduping it twice.
  it('puts the ISRC album first and appends text results minus the duplicate', async () => {
    mockFetch([isrcTrack, { data: [remixHit, isrcTrack] }])
    const results = await search('ana mena pa ti toa', 'high', { isrc: 'ES5022600597' })
    expect(results.map((r) => r.id)).toEqual([50, 60])
  })

  // Deezer answers an unknown ISRC with a 200 "no data" body (code 800) — a miss, not
  // an error: the text ladder must still run.
  it('falls back to the text search when the ISRC is unknown to Deezer', async () => {
    mockFetch([{ error: { code: 800 } }, { data: [remixHit] }])
    const results = await search('cancion desconocida xyz', 'high', { isrc: 'XX0000000000' })
    expect(results.map((r) => r.id)).toEqual([60])
  })
})
```

Nota: ni los ISRC ni las queries de texto pueden repetirse entre tests del fichero — el cache de `lookupCacheStore` persiste en el temp dir durante todo el run, así que una query repetida serviría los resultados cacheados del test anterior en vez de pasar por el mock de fetch.

Run: `npm exec --workspace apps/desktop -- vitest run src/main/deezer.test.ts`
Expected: FAIL — `search` ignora `hints.isrc`.

- [ ] **Step 4: Implementación — `trackByIsrc` + integración en `search`**

En `deezer.ts`, junto a `searchOnce`:

```ts
// Resolves the exact recording an ISRC names, to its album's search row. Cached under
// its own namespaced key so a text search for the literal string can never collide. A
// miss (Deezer's code-800 body has no album) caches as empty and reads back as such.
async function trackByIsrc(
  isrc: string,
  priority?: SearchPriority,
): Promise<SearchResult | undefined> {
  const key = `isrc:${isrc.toLowerCase()}`
  const cached = cacheStore.getSearch(key)
  if (cached) return cached[0]
  const data = await api<DeezerTrackHit>(
    `${BASE}/track/isrc:${encodeURIComponent(isrc)}`,
    priority,
  )
  const results = groupByAlbum(data.album ? [data] : [])
  cacheStore.setSearch(key, results)
  return results[0]
}
```

Y el cuerpo del `activity.track` de `search` pasa a:

```ts
    async () => {
      // An ISRC from the file's tags names the exact recording — resolve it first so
      // the original release leads the pool, with the text results as alternatives.
      const isrc = hints.isrc?.trim()
      const exact = isrc ? await trackByIsrc(isrc, priority) : undefined
      let results: SearchResult[] = []
      for (const candidate of buildSearchCandidates(query, hints, { includeCatalog: false })) {
        results = await searchOnce(candidate, priority)
        if (results.length) break
      }
      if (!exact) return results
      return [exact, ...results.filter((r) => r.id !== exact.id)]
    },
```

Run: `npm exec --workspace apps/desktop -- vitest run src/main/deezer.test.ts src/shared/metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificación + commit**

```bash
npm exec --workspace apps/desktop -- tsc --noEmit
cd apps/desktop && npx biome check src/main/deezer.ts src/shared/metadata.ts src/shared/types.ts && cd ../..
git add -A apps/desktop/src
git commit -m "Resolve exact Deezer matches from the file's ISRC tag"
```

---

### Task 4: Migración aditiva de `searchProviders`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (interface `Settings`)
- Modify: `apps/desktop/src/main/settings.ts` (default + `migrateProviderDefaults`)
- Modify: `apps/desktop/src/main/index.ts` (llamada en el arranque)
- Test: `apps/desktop/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `getSettings`/`saveSettings` (settings.ts), `SEARCH_PROVIDERS` ya con `'deezer'` (Task 1).
- Produces: `Settings.deezerProviderMigrated: boolean`; `migrateProviderDefaults(): void` exportada de settings.ts y llamada una vez al arrancar el main process.

- [ ] **Step 1: Tests rojos — las tres conductas de la migración**

En `settings.test.ts`, nuevo describe (importar `migrateProviderDefaults` en el import de `./settings`, y `beforeEach` en el de `vitest`):

```ts
describe('migrateProviderDefaults', () => {
  // Earlier describes persist settings (and setConfigDir tests may leave a pointer
  // file); each case here must start from a genuinely clean profile or the
  // fresh-install assertions read another test's leftovers.
  const wipe = (): void => {
    rmSync(join(app.getPath('userData'), 'settings.json'), { force: true })
    rmSync(join(app.getPath('userData'), 'config-dir.json'), { force: true })
  }
  beforeEach(wipe)
  afterEach(wipe)

  // An existing install persisted its searchProviders before Deezer existed; without
  // this one-shot addition the new source would stay invisible exactly for the users
  // the feature was built for.
  it('adds deezer once to a pre-deezer providers array and sets the marker', () => {
    writeFileSync(
      join(app.getPath('userData'), 'settings.json'),
      JSON.stringify({ searchProviders: ['discogs', 'bandcamp'] }),
    )
    migrateProviderDefaults()
    const s = getSettings()
    expect(s.searchProviders).toEqual(['discogs', 'bandcamp', 'deezer'])
    expect(s.deezerProviderMigrated).toBe(true)
  })

  // The marker is what keeps the migration from resurrecting the source on every
  // launch for a user who deliberately unticked it.
  it('does not re-add deezer after the user unticked it post-migration', () => {
    writeFileSync(
      join(app.getPath('userData'), 'settings.json'),
      JSON.stringify({ searchProviders: ['discogs'], deezerProviderMigrated: true }),
    )
    migrateProviderDefaults()
    expect(getSettings().searchProviders).toEqual(['discogs'])
  })

  it('never duplicates deezer on a fresh install whose defaults already carry it', () => {
    migrateProviderDefaults()
    const s = getSettings()
    expect(s.searchProviders.filter((p) => p === 'deezer')).toHaveLength(1)
    expect(s.deezerProviderMigrated).toBe(true)
  })
})
```

Run: `npm exec --workspace apps/desktop -- vitest run src/main/settings.test.ts`
Expected: FAIL — `migrateProviderDefaults` no existe.

- [ ] **Step 2: Implementación**

`types.ts`, en `Settings` junto a `hasSeenOnboarding`:

```ts
  // One-shot marker for the additive searchProviders migration that introduced Deezer.
  // Without it, "add if missing" would resurrect the source on every launch for a user
  // who deliberately unticked it. Synced, so a second Mac doesn't redo the migration.
  deezerProviderMigrated: boolean
```

`main/settings.ts` — default:

```ts
  deezerProviderMigrated: false,
```

y al final del fichero:

```ts
// Deezer shipped after existing installs persisted their searchProviders array, so
// they would never see the new source without this one-shot addition at startup. The
// marker (synced) keeps a later launch — or the user's other Mac — from re-adding the
// source once it has run.
export function migrateProviderDefaults(): void {
  const cur = getSettings()
  if (cur.deezerProviderMigrated) return
  const searchProviders = cur.searchProviders.includes('deezer')
    ? cur.searchProviders
    : [...cur.searchProviders, 'deezer' as const]
  saveSettings({ searchProviders, deezerProviderMigrated: true })
}
```

`main/index.ts` — localizar el arranque con `grep -n "whenReady" apps/desktop/src/main/index.ts` y, dentro del callback de `app.whenReady()`, ANTES de crear la ventana, añadir:

```ts
  migrateProviderDefaults()
```

(con `migrateProviderDefaults` añadido al import existente de `./settings`).

Run: `npm exec --workspace apps/desktop -- vitest run src/main/settings.test.ts`
Expected: PASS (los 3 nuevos y todos los previos — la migración no debe romper `defaults for a fresh install`; si el test `searches both Discogs and Bandcamp by default` asserta el array exacto, actualizarlo a las tres fuentes: el default nuevo ES con Deezer).

- [ ] **Step 3: Verificación + commit**

```bash
npm exec --workspace apps/desktop -- tsc --noEmit
npm exec --workspace apps/desktop -- vitest run src/main/settings.test.ts src/main/exportSettings.test.ts src/main/importSettings.test.ts
cd apps/desktop && npx biome check src/main/settings.ts src/main/index.ts src/shared/types.ts && cd ../..
git add -A apps/desktop/src
git commit -m "Enable Deezer once for existing installs"
```

---

### Task 5: Verificación final

- [ ] **Step 1: Suite completa + typecheck**

```bash
npm test
npm exec --workspace apps/desktop -- tsc --noEmit
```

Expected: todo verde, cero warnings nuevos. Cualquier test tocado por la ampliación (enumeraciones de providers/stats) debe haberse actualizado en su task — si algo aparece aquí, arreglarlo antes de seguir.

- [ ] **Step 2: Smoke contra la API real** (el track del spec, sin app)

```bash
curl -s "https://api.deezer.com/track/isrc:ES5022600597" | head -c 300
curl -s "https://api.deezer.com/search?q=ana%20mena%20pa%20ti%20toa&limit=5" | head -c 300
curl -s "https://api.deezer.com/album/$(curl -s 'https://api.deezer.com/track/isrc:ES5022600597' | sed -n 's/.*"album":{"id":\([0-9]*\).*/\1/p')" | head -c 300
```

Expected: JSON con `"title":"pa ti toa <3"` en los tres — confirma que los shapes que mapeamos siguen vigentes.

- [ ] **Step 3: Verificación en la app real** (opcional pero recomendada)

Usar el skill `run-desktop` (ojo a sus gotchas: userData aislado pero log compartido). Importar el FLAC de Ana Mena (`/Users/vicent/Soulseek Downloads/complete/smuks-aef771/pa ti toa _3/pa ti toa _3.flac`), comprobar: el checkbox Deezer en Settings→Búsqueda, resultados con pill Deezer en el editor, y que el auto-match del track resuelve al single original (no a un remix).

- [ ] **Step 4: Cierre**

Invocar `superpowers:finishing-a-development-branch`. Convención del repo: merge local a `main` + limpieza del worktree; el push lo decide el usuario.
