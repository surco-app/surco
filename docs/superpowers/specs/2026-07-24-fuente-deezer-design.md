# Fuente Deezer para música comercial — diseño

Fecha: 2026-07-24
Estado: aprobado (conversación 2026-07-24)

## Problema

Surco busca en Discogs y Bandcamp, catálogos excelentes para electrónica pero pobres
en música comercial. Para un single mainstream (ej. "pa ti toa <3" de Ana Mena &
Lola Indigo) el single original a menudo no existe en ninguno de los dos; lo que sí
existe son remixes y bootlegs con título parecido, que puntúan razonablemente en el
scoring por tokens y acaban ganando el auto-match. El resultado: el track se taguea
con la versión equivocada.

Dato relevante: los ficheros comerciales que llegan por Soulseek suelen ser rips de
streaming con tags completos, incluido ISRC (surco ya lo lee: campo `isrc` de
`TrackMetadata`, vía `main/tags.ts`). Pero no está garantizado — también llegan
ficheros sin tags, así que el diseño no puede depender solo del ISRC.

## Objetivo

Que la música comercial encuentre su release original: añadir Deezer como tercera
fuente de búsqueda, con lookup exacto por ISRC cuando el fichero lo trae. El flujo
de electrónica (Discogs/Bandcamp) no debe cambiar de comportamiento.

## Por qué Deezer

Verificado con el track real (2026-07-24):

- Sin credenciales ni token — nada nuevo que configurar ni que gestionar (a
  diferencia de Spotify/Apple Music API).
- Lookup directo por ISRC: `GET /track/isrc:{isrc}` → identidad exacta de la
  grabación.
- Búsqueda por texto (`GET /search`) con buena cobertura comercial, incluida la
  española.
- Devuelve todo lo que `Release` necesita: título, artistas, fecha, tracklist,
  portada 1000px (`cover_xl`).

MusicBrainz se descartó como fuente principal: sus carátulas (Cover Art Archive)
tardan en aparecer para singles comerciales recién publicados — justo el caso de
uso. iTunes Search se descartó por no ofrecer lookup por ISRC sin token de
developer.

## Alcance

- Nueva fuente `deezer` en el registro de proveedores, con checkbox propio.
- ISRC como hint de búsqueda que solo Deezer consume.
- Migración aditiva de `searchProviders` para usuarios existentes.
- Fuera de alcance: penalizar remixes en el scoring (rompería el caso electrónico,
  donde el remix es a menudo el objetivo legítimo), Spotify/Apple Music API,
  bypass del scoring para hits de ISRC (ver decisión abajo).

## Diseño

### Fuente Deezer (`main/deezer.ts` + registro)

- Implementa `SearchProvider` y se registra en `main/providers/index.ts` como
  entrada `deezer` — el seam existente: la IPC no cambia.
- `search(query, priority, hints)`:
  1. Si `hints.isrc` está presente: `GET https://api.deezer.com/track/isrc:{isrc}`.
     Un hit se mapea a `SearchResult` (el álbum del track) y encabeza los
     resultados.
  2. Búsqueda por texto: `GET https://api.deezer.com/search?q={query}` con la
     query ya limpiada por el seam (`stripIgnoredWords`, como las demás fuentes).
     Resultados de track se agrupan por álbum (un `SearchResult` por álbum, no por
     track) y se capa el total como hace Bandcamp.
- `getRelease(ref)`: `ref` es el id numérico de álbum (encaja en `id: number`,
  como Discogs). `GET /album/{id}` + `GET /album/{id}/tracks` →
  `Release` con `artists` (incluye colaboraciones: "Ana Mena & Lola Indigo"),
  `year` (de `release_date`), `genres` (de `genres.data`), `images` (`cover_xl`),
  `tracklist` con `position` (`track_position`), `duration` (segundos → "m:ss",
  el formato que el scoring ya compara). Sin `labels`/`styles`/`extraartists` —
  Deezer no los da; `SearchResult`/`Release` ya toleran campos vacíos (Bandcamp).
- Rate limit: Deezer permite 50 req/5s por IP. Limiter propio
  (`deezerLimiter.ts`) sobre la utilidad compartida `rateLimiter`, patrón
  Bandcamp. La cuota agotada llega como HTTP 200 con `{"error":{"code":4}}` en el
  body — se detecta y reintenta con backoff, patrón del retry de Discogs, con
  mensaje de error propio si se agota.

### ISRC como `SearchHints.isrc`

- `SearchHints` gana `isrc?: string`. Quien construye hints (auto-match y editor)
  lo rellena desde los tags del track cuando existe.
- Solo el proveedor Deezer lo consume; Discogs/Bandcamp lo ignoran. Deezer
  desactivado = ningún uso del ISRC. El checkbox significa "surco habla con
  Deezer o no", sin excepciones.
- **Decisión: el hit por ISRC no salta el scoring.** Entra al pool como un
  candidato más y el probe lo puntúa igual que a todos. Razón: si el fichero trae
  ISRC trae también título/artista de la misma fuente, así que el original puntúa
  arriba por sí solo; un bypass añadiría un camino de aceptación nuevo que
  mantener y auditar. El valor del ISRC es de *recall* (meter el original en el
  pool), no de arbitraje.

### Auto-match

- Deezer compite en igualdad: sus candidatos se puntúan con el mismo scoring que
  Discogs/Bandcamp. La apuesta verificada: el original con título exacto puntúa
  por encima de un "(X Remix)" con tokens sobrantes — no hace falta penalización,
  basta con que el original esté por fin en el pool.
- Desempate a scores iguales: orden actual de proveedores con Discogs primero,
  para que en electrónica (donde Discogs aporta sello/catálogo que Deezer no
  tiene) el ganador no cambie por la nueva fuente.
- `autoMatchAvailable` no cambia: solo Discogs exige token; Deezer es tokenless
  como Bandcamp.

### Settings y migración

- `SearchProviderId` gana `'deezer'`; `SEARCH_PROVIDERS` pasa a
  `['discogs', 'bandcamp', 'deezer']`. El checkbox aparece automáticamente en
  Settings→Búsqueda y en el wizard (ambos renderizan `SearchProvidersControl`
  desde esa constante). Nueva clave i18n `settings.provider.deezer` en todos los
  locales.
- **Migración aditiva con marca de una sola vez.** El array persistido de
  usuarios existentes no contiene `'deezer'` y sin migración la fuente nacería
  apagada justo para quien más la necesita. En la carga de settings
  (`main/settings.ts`): si la marca persistida `deezerProviderMigrated` no es
  `true`, añadir `'deezer'` a `searchProviders` (si es array y no lo contiene) y
  persistir la marca. La marca es imprescindible: un "añadir si falta" sin marca
  re-activaría la fuente en cada arranque a quien la desmarcó a propósito.

### Superficies acompañantes (patrón por fuente existente)

- `ActivityKind` gana `'deezer'` → "Buscando en Deezer" en el panel de actividad.
- Stats por fuente: `deezerMatches` junto a `discogsMatches`/`bandcampMatches`.
- Pill de proveedor en resultados y `matchProvider` funcionan solos: ya están
  tipados sobre `SearchProviderId`.

## Manejo de errores

- Timeout y User-Agent compartidos (`main/http.ts`), como las demás fuentes.
- Cuota (código 4 en body): reintento con backoff acotado; agotado → error
  legible ("Límite de peticiones de Deezer alcanzado…"), patrón Discogs.
- ISRC sin hit en Deezer: no es error; se sigue con la búsqueda por texto.
- Respuesta con `error` en body para cualquier otro código: error con el código,
  patrón "Discogs devolvió {status}".

## Testing

TDD por unidad, siguiendo los tests de `bandcamp.test.ts`/`discogs.test.ts`:

- `deezer.test.ts`: mapeo search→`SearchResult` (agrupado por álbum),
  álbum→`Release` (duración a "m:ss", artistas colaborativos), camino ISRC
  (hit encabeza, miss cae a texto), detección de cuota en body 200 y reintento.
- `providers/index.test.ts`: la entrada `deezer` limpia query/hints en el seam
  como las demás.
- `settings`: la migración añade `'deezer'` una sola vez; con la marca puesta y
  la fuente desmarcada, no se re-añade.
- Auto-match: `hints.isrc` se rellena desde los tags y llega al proveedor;
  ausencia de ISRC no cambia el flujo actual (candidatos idénticos a hoy con
  Deezer desactivado).

## Observado, fuera de alcance

- `settingsContext.tsx:86`: el fallback del renderer declara
  `searchProviders: ['discogs']` mientras el default real del main incluye ambas
  fuentes — resto de antes de Bandcamp. No se toca en esta feature.
