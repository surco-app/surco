# Búsqueda en Apple Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un proveedor de búsqueda más en Catálogos, «Apple Music», sobre la API pública de iTunes (sin clave), calcado del proveedor Deezer.

**Architecture:** `main/itunes.ts` + `main/itunesLimiter.ts`, mismo patrón que `main/deezer.ts` (limitador, `lookupCacheStore`, `searchCandidates`, `activity.track`). Id interno `'itunes'` (porque `'applemusic'` ya es un `ActivityKind` de la integración con la app Music); nombre visible «Apple Music». Se cablea en todos los sitios donde aparece `deezer` como proveedor.

**Caso real que motiva esto:** `~/Desktop/Not So Bad (Radio Edit).flac`, sin etiquetas, 243,2 s. Es Revive DJs, «Not So Bad (Radio Edit)», EP «Not So Bad» (collectionId 6797715483), ℗ 2026 Plus Records. Deezer no lo tiene. Con `term=Not So Bad Radio Edit&country=ES&limit=200` sale en la posición 154 (Apple ordena por popularidad: Guetta, Bad Bunny…). Quedándose solo con los hits cuyo `artistName + trackName + collectionName` contiene todas las palabras de la consulta, quedan 5 y él es el tercero.

## Global Constraints

- Todo en el worktree `/Users/vicent/code/surco-wt-apple-music-search`, rama `busqueda-apple-music`. vitest siempre desde `apps/desktop` (`npx vitest run <ruta>`).
- Cero comentarios nuevos en código. Commits con título solo, sin cuerpo ni prefijo. TDD: ver el test fallar antes de implementar.
- Antes de cada commit, desde `apps/desktop`: `npm run lint`, `npx biome check src`, `npx tsc --build`; y la suite entera `npm test; echo exit=$?` (exit 0). Desde la raíz del worktree también `npm run lint -w apps/web`.
- Textos de UI: tuteo, sin guion largo ni dos puntos de explicación. «Apple Music» no se traduce.

## API de iTunes (medido 22/11/2026)

- Búsqueda: `https://itunes.apple.com/search?term=<q>&entity=song&limit=200&country=<CC>`. Respuesta `{ resultCount, results: Hit[] }`. Hit: `artistName, trackName, collectionId, collectionName, artworkUrl100, trackTimeMillis, releaseDate, primaryGenreName`.
- Álbum: `https://itunes.apple.com/lookup?id=<collectionId>&entity=song&country=<CC>`. `results[0]` es la colección (`wrapperType: "collection"`, `artistName, collectionName, copyright: "℗ 2026 Plus Records", releaseDate: "2026-09-11T07:00:00Z", primaryGenreName, artworkUrl100, collectionViewUrl`), y el resto son las pistas (`wrapperType: "track"`, `trackNumber, discNumber, discCount, trackName, artistName, trackTimeMillis`).
- Carátula: `artworkUrl100` termina en `/100x100bb.jpg`; cambiar a `/250x250bb.jpg` para `thumb` y `/3000x3000bb.jpg` para `cover_image` e `images` (el embed ya reduce a `coverMaxSize`).
- Límite unas 20 peticiones por minuto por IP. Si se pasa, responde 403 (o 429). Limitador `createRateLimiter(3, 9000)`.
- País: `app.getLocaleCountryCode()` de Electron, en mayúsculas; si viene vacío, `US`. Pásalo como dependencia o léelo en una función pequeña para que los tests lo puedan fijar con el mock de `electron`.
- La búsqueda por ISRC no existe en la API pública: sin ISRC.

---

### Task 1: Cliente `main/itunes.ts`

**Files:** Create `main/itunes.ts`, `main/itunesLimiter.ts`, `main/itunes.test.ts`. Modify `shared/types.ts` (`SearchProviderId` y `ActivityKind` ganan `'itunes'`), `shared/errorKeys.ts` (`itunesUnavailable`, `itunesRateLimit`, junto a los de Deezer, más sus textos en los 8 locales bajo la misma clave que los de Deezer).

Modelo: `main/deezer.ts` y `main/deezer.test.ts` (mismo mock de limitador, de `electron` con carpeta temporal y de `fetch`).

- [ ] Tests que fallan (cada uno dice por qué importa):
  - `groupByAlbum` agrupa hits por `collectionId` en orden de aparición; fila `{ provider: 'itunes', id: collectionId, title: 'Artista - Álbum', thumb (250), cover_image (3000), year (4 primeros de releaseDate) }`.
  - Filtro de palabras: con la consulta `Not So Bad Radio Edit` y hits de Guetta «Bad (feat. Vassy) [Radio Edit]», Michael Jackson «Bad» y Revive DJs «Not So Bad (Radio Edit)», solo queda Revive DJs. Comparación sin mayúsculas ni acentos y por palabras (`\p{L}\p{N}`), contra artista + pista + álbum. Si el filtro deja cero, se devuelve vacío (un vacío lleva al siguiente peldaño de `searchCandidates`).
  - `search` pide `entity=song`, `limit=200` y `country=<CC>` del sistema; con país vacío usa `US`.
  - 403 o 429 → reintenta con espera como Deezer, y tras `MAX_RETRIES` lanza `itunesRateLimit`. Otro no-ok o fallo de red → `itunesUnavailable`.
  - `mapRelease` con el lookup de Revive DJs: `title 'Not So Bad - EP'`, `artists [{name:'Revive DJs'}]`, `year 2026`, `released '2026-09-11'`, `genres ['Dance']`, `labels [{ name: 'Plus Records', catno: '' }]` (quita `℗`, `©`, año y espacios del principio del copyright; sin copyright, sin labels), tracklist ordenada por disco y número, `position` `'1'..'4'` (con más de un disco `'1-1'`, `'2-3'`), duraciones `'5:48'`, `'4:03'`…, artista por pista.
  - `getRelease` cachea por id y pone `url` de actividad = `collectionViewUrl`.
- [ ] Verlos fallar, implementar, verlos pasar, comprobaciones globales.
- [ ] Commit `Add an Apple Music catalog search client`

### Task 2: Cablear el proveedor

Cada sitio donde `deezer` aparece como proveedor gana `itunes` detrás de `musicbrainz` (búscalos con `grep -rn -i deezer apps/desktop/src`). Como mínimo:

- `main/providers/index.ts` (+ test): como Deezer, solo palabras ignoradas, sin token.
- `shared/defaults.ts` `SEARCH_PROVIDERS` y los proveedores por defecto en `main/settings.ts` (activado por defecto; actualizar `settings.test.ts`).
- Migración: `itunesProviderMigrated` en `shared/types.ts`, defaults y `migrateProviderDefaults` (añade `itunes` una vez a instalaciones existentes), con test como el de Deezer. Añadirlo también a `renderer/src/test/api.ts`.
- `renderer/src/lib/release.ts` `PROVIDER_RANK` (`itunes: 5`).
- Estadísticas: `itunesMatches` en tipos, defaults, relleno de stats viejas, `main/index.ts:1288`, `renderer/src/lib/stats.ts`, `StatsTab.tsx`, `statsImage.ts`, con sus tests.
- `ActivityPanel.tsx` icono (lucide `Music`), `renderer/src/lib/autoMatch.ts:495` (`itunes: 'Apple Music'`).
- CSP: `https://*.mzstatic.com` en los dos img-src (`main/index.ts:2572` y el meta del HTML) y en la lista de `main/csp.test.ts`.
- i18n en los 8 locales: `settings.provider.itunes` «Apple Music», `settings.providerDescription.itunes` (es: «Catálogo de Apple, carátula grande»), `activity.searchItunes` / `activity.loadItunesRelease`, `stats` «Encontradas en Apple Music», y añadir Apple Music a las frases que enumeran los proveedores (`searchProvidersHint`, `fullReleaseDateHint`, `metadataBody`, FAQ de Windows). En la FAQ de Windows, la búsqueda en el catálogo de Apple Music sí funciona en Windows; la frase de que la integración con la app Music no existe se queda tal cual.
- [ ] Tests que fallan primero donde haya lógica (providers, migración, stats, csp).
- [ ] Comprobaciones globales y commit `Offer Apple Music as a catalog search source`
