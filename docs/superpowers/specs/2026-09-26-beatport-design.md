# Beatport como fuente de búsqueda

## Problema

Los DJs que etiquetan música electrónica consultan Beatport: es la tienda de
referencia y la única fuente que da BPM, tonalidad y nombre del mix por pista.
Un usuario lo ha pedido y ha señalado los scripts de mp3tag que lo hacen.
Surco tiene Discogs, Bandcamp y Deezer, y ninguno rellena esos campos.

## Qué se entrega

Beatport como cuarto proveedor de búsqueda (`SearchProviderId = 'beatport'`),
activable en Ajustes → Búsqueda junto a los demás. Requiere la cuenta de
Beatport del usuario (una gratuita basta, medido el 26/09).

Al aplicar una coincidencia de Beatport se rellenan, además de lo que ya
rellenan los otros proveedores, **BPM, tonalidad, mix e ISRC** de la pista.

Fuera de alcance: leer el HTML de beatport.com (Cloudflare devuelve 403),
quitar acentos (petición aparte del mismo usuario), un campo de enlace a
Beatport y cualquier otra tienda (Traxsource, SoundCloud).

## Cómo se accede (medido)

No hay API pública abierta. La API v4 que usa la propia web funciona con la
cuenta del usuario:

1. `GET https://api.beatport.com/v4/docs/` y sus scripts
   `/static/btprt/*.js` contienen `API_CLIENT_ID: '...'`.
2. `POST /v4/auth/login/` con `{username, password}` en JSON. Bien: 200 y
   cookie de sesión. Mal: **403** `"Incorrect username or password."`.
3. `GET /v4/auth/o/authorize/?response_type=code&client_id=…&redirect_uri=https://api.beatport.com/v4/auth/o/post-message/`
   con la cookie y sin seguir redirecciones: 302 con `code` en `Location`.
4. `POST /v4/auth/o/token/` (form) con `code`, `grant_type=authorization_code`,
   `redirect_uri`, `client_id`: `access_token` (36000 s) y `refresh_token`.
5. Con `Authorization: Bearer`:
   - `GET /v4/catalog/search/?q=…&type=tracks&per_page=N` → `tracks[]`
   - `GET /v4/catalog/releases/{id}/` → nombre, artistas, `label.name`,
     `catalog_number`, `new_release_date`, `image.uri`
   - `GET /v4/catalog/releases/{id}/tracks/?per_page=100` → `results[]` con
     `name`, `mix_name`, `bpm`, `key.name` ("G Major"), `isrc`, `length`
     ("2:37"), `artists`, `remixers`, `genre`, `sub_genre`. `number` llega a
     `null`: la posición es el orden de la lista.

La búsqueda no tolera acentos descompuestos ni ausentes: "Rosalia Despecha"
no encuentra el tema de ROSALÍA. Las consultas ya salen en NFC desde
`providers/index.ts` (adeae9eb) y se envían con sus acentos.

## Arquitectura

Mismo patrón que Deezer: cliente, limitador, caché y una entrada en
`main/providers/index.ts`. Lo nuevo es la sesión.

### `main/beatportSession.ts`: la sesión

- `getAccessToken(): Promise<string>`. Devuelve el token en memoria si le
  quedan más de 60 s. Si no, intenta `refresh_token`; si falla, rehace el login
  completo con las credenciales guardadas. Nunca pide nada al usuario.
- **Una sola operación en curso**: llamadas concurrentes esperan la misma
  promesa, y un rechazo la libera para el siguiente intento.
- `invalidate()`: lo llama el cliente al recibir un 401; la petición se
  repite una sola vez con un token nuevo.
- `client_id` se descubre en el primer login y se guarda en memoria. Si el
  token o el authorize fallan por `invalid_client`, se vuelve a descubrir una
  vez.
- `validate(username, password)`: el flujo 2 a 4 sin guardar nada. Lo usa el
  botón Conectar.
- Errores con `errorWithKey`: `beatportNotConnected` (no hay credenciales),
  `beatportBadCredentials` (403 en login), `beatportUnavailable` (red o 5xx).
  Un 403 en un relogin automático marca la sesión como rota:
  `beatportBadCredentials` hasta que el usuario vuelva a conectar.

### Credenciales

- Dos claves nuevas en `Settings`: `beatportUsername` y `beatportPassword`.
  La segunda guarda `safeStorage.encryptString(password)` en base64, nunca el
  texto.
- Ambas en `LOCAL_KEYS`: el cifrado solo sirve en esta máquina, así que no
  deben viajar a la carpeta sincronizada. Es una clave nueva, no un
  movimiento, así que no necesita migración.
- Fuera de Exportar ajustes y sin efecto al Importar: se omiten en
  `serializeSettingsForExport` y `applyImportedSettings` no las toca.
- La contraseña no llega al renderer: `settings:get` la devuelve vacía. Y el
  renderer no puede escribir ninguna de las dos: el guardado normal de ajustes
  (`sanitizeSettingsPatch`) las descarta, así que guardar Ajustes con la
  contraseña vacía no borra la cifrada. Solo el IPC de abajo las cambia.
- IPC nuevo: `beatport:connect(username, password)` valida, cifra y guarda (o
  rechaza sin guardar nada). `beatport:disconnect()` borra ambas claves y la
  sesión en memoria.
- Sin `safeStorage.isEncryptionAvailable()` no se guarda nada:
  `beatportNoSecureStorage`.

### `main/beatport.ts`: el cliente

- `search(query, priority, hints)`: consulta de artista y título (reutiliza
  `buildSearchCandidates` como Deezer), `type=tracks`. Los resultados se
  agrupan en una fila por lanzamiento (`groupByRelease`, como
  `groupByAlbum`), con `id` del lanzamiento, título "Artista - Lanzamiento",
  `label`, `catno`, `year` y carátula.
- `getRelease(id)`: lanzamiento más sus pistas, en dos peticiones, mapeado a
  `Release`: `labels[0] = {name, catno}`, `released` y `year` de
  `new_release_date`, `genres` del género de la primera pista y `styles` de
  los subgéneros, `images` con la carátula, `uri` a la página pública.
- `main/beatportLimiter.ts` con `createRateLimiter`. Beatport no publica
  límites: 10 peticiones por 2 s, como Deezer, y reintento con espera en 429.
- Caché con `createLookupCacheStore` y `cachedSearch`, como Deezer.

### Tipos

- `SearchProviderId` añade `'beatport'`, `SEARCH_PROVIDERS` también.
- `ReleaseTrack` gana `bpm?`, `key?`, `mixName?` e `isrc?`. Beatport los
  rellena; el resto de proveedores no cambian.
- `stats.beatportMatches`, igual que los otros tres.

## Aplicar una coincidencia

En `buildReleaseMeta`, con la regla de siempre (el dato de la fuente gana; si
no hay dato, se conserva el actual; los campos fuera de la lista de
importación no se tocan):

- `bpm`: el número tal cual ("130").
- `key`: de "G Major" / "Eb Minor" a la notación elegida en `keyNotation`:
  Camelot ("9B", "2A") o musical con la convención de Mixed In Key que ya usa
  `musicalKey.ts` ("G", "Ebm"). Una tonalidad que no se reconozca no se
  aplica.
- `mixName`: el `mix_name` tal cual, incluido "Original Mix".
- `isrc`: tal cual.
- `title`: el `name` de la pista, sin el mix.

Los datos del lanzamiento van por los campos existentes: álbum, artista del
álbum, sello, número de catálogo, año o fecha completa, género, estilo y
carátula.

### Elegir la pista dentro del lanzamiento

Un lanzamiento de Beatport suele traer varias versiones con el mismo título
(DESPECHÁ trae 4: Clean, Intro - Clean, Intro, Instrumental). Comparar solo el
título empata. Para puntuar, una pista de Beatport se compara como
`título (mix)`, que es como suelen nombrarse los ficheros; la duración, que
ya se usa, desempata el resto.

## Ajustes

- Ajustes → Búsqueda: casilla "Beatport" en la lista de fuentes (sale sola
  en el asistente inicial, que usa el mismo control).
- Sección Beatport debajo, deshabilitada si la casilla está apagada (como la
  de Discogs; siempre visible, nunca aparece ni desaparece):
  - Sin conectar: usuario, contraseña y botón **Conectar**. Mientras valida,
    el botón se deshabilita. Un error se muestra bajo el campo.
  - Conectado: "Conectado como usuario" y botón **Desconectar**.
- Si Beatport está activado y no conectado, la búsqueda de Beatport falla con
  `beatportNotConnected` ("Conecta tu cuenta de Beatport en Ajustes") y las
  demás fuentes siguen. `autoMatchAvailable` no cuenta Beatport sin conexión,
  igual que Discogs sin token.
- Textos en todos los locales que ya existen.

## Pruebas

- Sesión: validar (200 y 403), token en memoria, renovación, relogin cuando
  falla la renovación, una sola operación ante llamadas concurrentes, 401 que
  repite una vez, 403 en relogin que marca la sesión rota. `fetch` simulado.
- Credenciales: se guardan cifradas y nunca en claro, no salen al renderer,
  ni en Exportar, ni se pisan al Importar ni al guardar Ajustes, y se quedan
  en el fichero local.
- Cliente: agrupar por lanzamiento, mapear a `Release` con las respuestas
  reales guardadas como fixtures (las de la prueba del 26/09).
- Aplicar: BPM, tonalidad en las dos notaciones, mix e ISRC; una
  tonalidad desconocida no pisa la actual; campo fuera de la lista no se toca.
- Puntuación: con el fichero "DESPECHÁ (Intro)" gana la versión Intro.
- Ajustes: Conectar, error de credenciales, Desconectar, sección deshabilitada
  con la casilla apagada.
- Prueba real al final con la cuenta del llavero (`surco-beatport`), fuera de
  la suite.

## Riesgos

- El `client_id` no es nuestro. Si Beatport lo cambia se redescubre; si deja
  de publicarlo, Beatport deja de funcionar para todos a la vez y el resto de
  fuentes sigue.
- Guardamos una contraseña, cifrada y solo en local.
- Los límites de peticiones son una suposición prudente, no un dato.
