# Comprobación tras convertir (autocomprobación)

Fecha: 30/10/2026. Estado: diseño aprobado en boceto (https://claude.ai/artifact/LNeTcmgFnKxEjsKgKZQ1d3), pendiente de implementar.

## Por qué

El 30/10 una prueba real (AIFF→WAV desde la pestaña Music, v1.17.0) dijo «✓ Añadido a Apple Music» cuando
(a) no se había convertido nada, (b) rekordbox había perdido el análisis y (c) Music había borrado la pista.
12.000 tests verdes. Los fallos estaban en la composición y en mensajes de éxito que nadie verificaba.

Regla desde ahora: **Surco nunca dice «hecho» sin releer lo que escribió.** Un «✓» solo aparece cuando cada
sitio que Surco tocó (el fichero y cada biblioteca) se ha releído y cuadra con lo que se pretendía.

## Decisiones cerradas (vinculantes)

1. Mientras comprueba, la fila de hecho dice «Comprobando…» con spinner en lugar de la línea de éxito. La línea de
   éxito de siempre («✓ Añadido a Apple Music», «✓ Exportado como WAV», …) sale SOLO cuando todo cuadró. Al lado,
   un botón discreto con icono de escudo (`ShieldCheck`) abre «Qué se comprobó»: una línea por sitio tocado
   (Fichero / Apple Music / rekordbox / Engine DJ / Traktor) con un resultado corto. Los sitios no tocados no salen.
2. Identidad de audio COMPLETA siempre que la conversión debía conservar las muestras (`ConversionPlan.samplesKept`
   o `copiedVerbatim`): se decodifican origen y salida enteros y se comparan los md5 del PCM. Si las muestras cambian
   legítimamente (lossy, remuestreo, normalizar, recortar, declick) se comprueba que decodifica entero, la duración
   cuadra y formato/códec/tasa/bits son los planeados. Coste aceptado (~1-2 s por pista en NAS).
3. Si algo no cuadra: sin ✓, línea ámbar que dice qué y dónde («rekordbox sigue en el AIFF»), una sola acción
   «Reintentar». Sin «Deshacer» por ahora. El fichero sustituido nunca se ofrece para la papelera mientras alguna
   comprobación falle o algo lo siga usando.
4. Lotes: el resumen cuenta comprobadas («✓ 38 comprobadas · 2 no cuadran»), las filas que fallan llevan un punto ámbar
   (con `aria-label`) y hay un filtro «No cuadran» en el menú de filtros (eje de conversión, como «Sin guardar»).
5. Una escritura en biblioteca ENCOLADA porque el programa está abierto (colas de rekordbox, Engine, Traktor) no es un
   fallo: se lee como pendiente y se comprueba cuando la cola se aplica. Mientras haya algo pendiente la línea de hecho
   NO lleva ✓: «Añadido a Apple Music · rekordbox al cerrarlo», con un icono de pendiente (reloj, `Clock`) en vez del
   ✓; el escudo lista «◷ rekordbox · Pendiente, se aplica al cerrar rekordbox». El ✓ solo sale cuando todos los sitios
   están en ok (30/10).
6. Reintentar cuando falla el Fichero o Music: si el origen ya no existe (conversión en el sitio), Reintentar solo
   relee y la línea ámbar dice que el original ya no está, señalando Originales si se guardó copia allí; si el origen
   existe, relanza la conversión (30/10).

## Arquitectura

### Dónde corre

Todo en **main**. El renderer solo pinta un `Verification` que le llega por IPC. Razones: main es quien tiene ffmpeg,
TagLib, osascript y las bases de datos; y un error de comprobación tiene que viajar como clave traducible (el IPC solo
conserva `message`, ver memoria «Errores del main traducibles»), así que el detalle viaja como `{ key, params }`.

Módulos nuevos (planos en `src/main`, como el resto):

| Módulo | Qué hace | Puro / E/S |
|---|---|---|
| `shared/verification.ts` | Tipos, `verificationStatus(checks)`, `placesTouched` | puro |
| `main/verifyPcm.ts` | `pcmDigest(file)` vía `ffmpeg -map 0:a:0 -c:a pcm_s32le\|pcm_f32le -f md5 -` | ffmpeg |
| `main/verifyFile.ts` | `checkFile(expect, readers)` | ffmpeg + TagLib inyectados |
| `main/verifyMusic.ts` | `buildVerifyEntryScript`, `parseVerifyEntry`, `checkAppleMusic(expect, read)` | osascript inyectado |
| `main/verifyRekordbox.ts` | `snapshotRekordboxRow`, `checkRekordbox(db, expect)` | SQLCipher solo lectura |
| `main/verifyEngine.ts` | `snapshotEngineRow`, `checkEngine(db, expect)` | sql.js solo lectura |
| `main/verifyTraktor.ts` | `checkTraktor(nml, expect)` | puro sobre el texto del NML |
| `main/verifyRegistry.ts` | expectativas por pista, snapshots «antes», estado vivo | memoria |
| `main/verifyIpc.ts` | `verify:update` (evento), `verify:retry` (invoke) | IPC |

### Cuándo corre

1. **Antes de convertir** (al principio de `runProcessTrack`, tras las validaciones): si rekordbox / Engine van a
   tocarse, se toma una foto de solo lectura de la fila del origen (`snapshotRekordboxRow`: id, nº de cues de
   `djmdCue`, `AnalysisDataPath`, `Analysed`; `snapshotEngineRow`: id, sha1 de `quickCues`, `beatData`, `loops`).
   Sin foto no hay forma de afirmar «cues intactas».
2. **Dentro de `convertAudio`, antes del rename**, cuando `samplesKept || copiedVerbatim`: `pcmDigest(input)` en
   paralelo con el `assertDecodable(tmp)` que ya existe. Tiene que ser aquí porque en una conversión en el sitio el
   origen deja de existir tras el rename. `convertAudio` devuelve además `written: { samplesKept, sourcePcm?, plan }`.
3. **Al final de `runProcessTrack`, en línea** (stage nuevo `'verify'`): `checkFile` sobre la ruta final y
   `checkAppleMusic` si hubo paso de Music. Se hace dentro del trabajo, no en segundo plano: el hueco del lote limita la
   concurrencia de forma natural y nada (papelera, nueva edición) puede actuar sobre una pista a medio comprobar.
   El `ProcessResult` lleva `verification` con fichero y Music ya resueltos y las bibliotecas que se tocarán en
   `'checking'`.
4. **Tras el flush de fin de lote** (`flushConversionBatch` en `libraryFlushes.ts`): por cada pista registrada en el
   lote, se releen rekordbox, Engine y Traktor y se emite `verify:update`. Una biblioteca cuyo flush quedó en cola
   (`blocked` por programa abierto, unidad desenchufada) pasa a `'pending'`.
5. **Tras aplicar una cola** (`announceApplied`, `announceEngineApplied`, `announceTraktorApplied`): se recomprueban
   las pistas con ese sitio en `'pending'` y se emite `verify:update`.

### Forma del resultado

```ts
export type VerifyPlace = 'file' | 'appleMusic' | 'rekordbox' | 'engine' | 'traktor'
export type CheckState = 'checking' | 'ok' | 'mismatch' | 'pending' | 'unreadable'
export interface CheckDetail { key: string; params?: Record<string, string | number> }
export interface PlaceCheck { place: VerifyPlace; state: CheckState; detail: CheckDetail }
export interface Verification {
  status: 'checking' | 'ok' | 'mismatch' | 'pending'
  checks: PlaceCheck[]
}
```

`verificationStatus(checks)`: cualquier `mismatch` o `unreadable` → `'mismatch'` (gana a todo: el ámbar sale en
cuanto se sabe); si no, cualquier `checking` → `'checking'`; si no, cualquier `pending` → `'pending'`; si no `'ok'`.
`unreadable` (no se pudo leer: Music no responde, base bloqueada) no es ✓: se pinta en ámbar como «No se pudo comprobar
rekordbox» y Reintentar solo relee.

Ejemplos de `detail` (claves bajo `verify.detail.*` en los 6 idiomas):
- Fichero ok: `fileIdentical` {format: 'WAV'} → «WAV · audio idéntico al original»; `fileReencoded` {format, rate, bits}
  → «FLAC · 44,1 kHz · 24 bits · decodifica entero».
- Fichero mal: `fileMissing`, `fileWrongFormat` {expected, actual}, `fileTruncated`, `filePcmDiffers`,
  `fileTagDiffers` {field}, `fileNoCover`, `fileCoverKept`.
- Music ok: `musicOne` {playlists} → «Una sola entrada · en 24 y All»; mal: `musicMissing`, `musicWrongFile`
  {format} («Apple Music sigue en el AIFF»), `musicDuplicate` {count}, `musicTagDiffers` {field}, `musicNoArtwork`,
  `musicPlaylistLost` {playlist}.
- rekordbox ok: `rekordboxOk` {format, cues} → «Apunta al WAV · 13 cues · rejilla intacta»; mal: `rekordboxStillOld`
  {format}, `rekordboxCuesLost` {before, after}, `rekordboxAnalysisEmptied`, `rekordboxSizeDiffers`.
- Engine: `engineOk`, `engineStillOld`, `enginePerformanceChanged`.
- Traktor: `traktorOk`, `traktorStillOld`.
- `pending` {program} → «Pendiente, se aplica al cerrar rekordbox» (en el escudo, con `Clock` delante).
- `fileSourceGone` {kept} → «El original ya no está» / «El original ya no está, hay una copia en Originales» (con
  «Originales» como botón que abre ese panel).

Línea de hecho con algo pendiente (claves nuevas, sin ✓ porque las de siempre lo llevan dentro del texto):
`verify.pendingLine.addedToAppleMusic` «Añadido a Apple Music · {{programs}} al cerrarlo»,
`verify.pendingLine.exportedAs` «Exportado como {{format}} · {{programs}} al cerrarlo», y las variantes de lote
`verify.batchPending` «{{verified}} comprobadas · {{pending}} pendientes». `programs` se une con `Intl.ListFormat` del
idioma activo («rekordbox y Engine DJ»).

### Qué verifica cada comprobación

**Fichero** (`checkFile`). Ruta: la de `ProcessResult.outputPath`; en «Solo Apple Music» la ubicación que Music da para
la entrada (el temporal ya no existe).
- existe en la ruta (comparación NFC);
- extensión y códec (`probeAudio`) son los del plan; tasa y bits los planeados si el plan los fija;
- decodifica entero (`assertDecodable`, que ya distingue truncado de cola Lyrics3);
- si `samplesKept`: `pcmDigest(output) === written.sourcePcm`, misma tasa y canales;
- si no: duración decodificada dentro de tolerancia respecto al origen menos el recorte (±50 ms o 0,1 %, la mayor);
- etiquetas releídas con `snapshotTags` (no `readTags`: recorta espacios y es ciego en AIFF/WAV) iguales a lo escrito
  en los campos escritos: title, artist, album, albumArtist, genre, year, trackNumber, bpm, key, grouping, comment;
- carátula presente (`readEmbeddedCover !== null`) si se escribió una; ausente si se quitó.

**Apple Music** (`checkAppleMusic`, un único osascript `buildVerifyEntryScript(pid, oldPid?)` que devuelve location,
name, artist, album, nº de artworks, playlists normales de la entrada y, si hubo sustitución, si la vieja sigue).
- la entrada con el persistent ID devuelto existe;
- su location (NFC, y resolviendo el enlace `~/Music/Music`) es el fichero final;
- la extensión de la location es el formato pedido (la `kind` está traducida al idioma del sistema; no se usa);
- name/artist/album iguales a lo escrito (comparación NFC + trim, como `nameKey`);
- artworks > 0 si se puso carátula;
- exactamente UNA entrada apunta a ese fichero (`musicFileEntries` sobre la ruta final);
- si hubo sustitución: la entrada vieja no existe (salvo `oldMusicCopyKept`, que ya es fallo declarado) y las
  playlists normales que tenía la vieja (leídas ANTES de la sustitución en `replaceAppleMusicCopy`, devueltas en
  `ReplacedCopy.playlistsBefore`) contienen la nueva.
- Music sigue importando de forma asíncrona: si la location sale vacía o `missing value`, se reintenta hasta 3 veces
  con 1 s, 2 s, 4 s antes de dar `mismatch`.

**rekordbox** (`checkRekordbox`, tras el flush). Con la base abierta en solo lectura:
- `findTrackByPath(to)` encuentra UNA fila y es la misma `id` que la foto (o una nueva si se añadió);
- su FolderPath/FileType/FileSize cuadran con el fichero (`FILE_TYPES[ext]`, `stat().size`);
- si `from !== to`, `findTrackByPath(from)` ya no devuelve esa fila;
- nº de cues vivas (`liveCues`) igual al de la foto;
- si `samplesKept`: `AnalysisDataPath` no vacío y `Analysed` igual a la foto (el bug del 30/10).

**Engine DJ** (`checkEngine`): `Track.path` resuelve al fichero final y `fileType` es la extensión; si `samplesKept`,
sha1 de `quickCues`, `beatData` y `loops` iguales a la foto. Si las muestras cambiaron, solo que existen.

**Traktor** (`checkTraktor`): si se registró un patch con `newFile`, la entrada del NML cuyo `LOCATION` (volume, dir,
file) es la del fichero final existe, y ninguna sigue en el nombre viejo. Sin patch con `newFile`, Traktor no se lista.

### Cómo llega al renderer

- `ProcessResult.verification` (nuevo, opcional) en la respuesta de `process:track`.
- Evento `verify:update` `{ trackId: string; verification: Verification }` por `broadcast`, con
  `window.api.onVerifyUpdate(cb)` en el preload (como `onProcessProgress`).
- `TrackItem.verification?: Verification`; `exportedPatch` lo copia del resultado; un hook
  `useVerificationUpdates` aplica los eventos con `updateTrack`.
- El registro de main guarda la pista por `job.id` (que es `track.id`) con from/to, foto y expectativas. Vive en memoria:
  se limpia al empezar un lote nuevo para las pistas que ya están en `ok`.

### Reintentar

`verify:retry(trackId)` en main, según el peor sitio:
- `unreadable` en cualquier sitio: solo relee ese sitio.
- `mismatch` en rekordbox / Engine / Traktor: vuelve a encolar la reapuntación grabada para ESE sitio
  (`queue.enqueue([], [repoint])` + `applyQuietly`) y al aplicarse recomprueba. No toca el fichero ni Music.
- `mismatch` en Fichero o Apple Music, origen todavía en disco (y distinto de la salida): `retry` responde
  `'rerun-job'` y el renderer relanza el trabajo con el camino existente (`processOne`), que vuelve a comprobarlo todo.
- `mismatch` en Fichero o Apple Music, origen ya no existe (conversión en el sitio, `from === to`, o `!exists(from)`):
  NO se reconvierte, porque la única fuente sería el fichero sospechoso. `retry` solo relee Fichero y Music y responde
  `'rechecked'`; si sigue sin cuadrar, el check de Fichero lleva además `fileSourceGone` {kept}. `kept` sale de
  `convertAudio` (`written.originalKept`: `keepOriginal` guardó copia en Originales). La línea ámbar dice «El original
  ya no está, hay una copia en Originales» con «Originales» abriendo ese panel, o solo «El original ya no está».

### Papelera

`supersededFile(track)` y la oferta del original en `selectionStatus` exigen `track.verification?.status === 'ok'`.
`'pending'` tampoco ofrece: algo podría seguir apuntando al viejo hasta que se aplique la cola. Una fila sin
`verification` (conversiones de antes de esta versión, sesión restaurada) no ofrece la papelera: falla cerrado.

### Coste y concurrencia

- `pcmDigest` pasa por un limitador propio de 2 (`createConcurrencyLimiter(2)`), con `ANALYSIS_TIMEOUT_MS` y la señal
  de cancelación del trabajo. En NAS la lectura domina: un WAV de 60 MB son ~0,6 s a 1 Gb/s por pasada; con origen y
  salida, ~1-2 s por pista, como se aceptó.
- La foto del origen se hace una vez por pista; la relectura de rekordbox/Engine/Traktor es una apertura por lote,
  no por pista (`checkRekordbox` recibe la base abierta y la lista).
- Music: un osascript por pista dentro de `appleMusicLimiter` (serie, ya existe).

## Fuera de alcance

- «Deshacer».
- La matriz de resultados sobre copias de bibliotecas reales y los recorridos antes de release (siguientes pasos del
  plan de confianza, notas aparte).
- Comprobar otras escrituras que no son `process:track`: revisión de nombres (`library:syncTags`), duplicados, guardar
  cues desde el editor, exportar a USB.
- Persistir la verificación entre arranques: un `pending` que se aplica con Surco cerrado no se recomprueba.
- Playlists de rekordbox / Engine / Traktor (van por ID, no por ruta; la reapuntación no las toca).
- Windows: Music no existe; el resto aplica igual.

## Riesgos

- **Rutas NFD/NFC.** macOS y SMB devuelven NFD; Music, rekordbox y el NML guardan lo que les dieron. Toda comparación
  de rutas normaliza a NFC y pasa por `pathKey` (realpath). Un test por comprobación con «Café» en NFD.
- **El enlace `~/Music/Music`.** Apunta al volumen que la biblioteca también referencia directo: la misma pista con dos
  rutas. «Exactamente una entrada» compara por realpath, no por texto; la fila doble de rekordbox (`AmbiguousMatch`)
  cuenta como `mismatch` con su propio texto, no como ok.
- **Music importando en asíncrono.** Tras el `add` la location tarda; `set name` da -50 al principio. Reintentos con
  espera antes de afirmar nada. Riesgo residual: un falso ámbar en máquinas lentas, preferible a un falso ✓.
- **Duplicados en Music.** El `add` devuelve la entrada existente si coincide título+artista+álbum. La comprobación de
  «una sola entrada» y «la vieja ya no está» es exactamente la que habría cazado el borrado del 30/10.
- **Latencia del NAS.** La comprobación completa duplica las lecturas. Limitador de 2 y tiempo máximo; un tiempo agotado
  es `unreadable`, no ok.
- **rekordbox abierto.** Leer `master.db` con rekordbox abierto en solo lectura es seguro, pero la foto puede no ver lo
  último que rekordbox tiene en memoria. Con rekordbox abierto la reapuntación ya va a la cola: la comprobación espera
  a la cola (`pending`), no lee una base a medio escribir.
- **Fichero movido entre la escritura y la relectura** (el DJ lo arrastra en Finder): `fileMissing`, ámbar. Correcto.
- **Lyrics3 / cola rara en MP3**: el md5 de PCM se hace sobre lo decodificado, así que una cola copiada igual no
  rompe la igualdad; el decode completo usa la misma lógica acotada que `assertDecodable`.

## Decisiones tomadas el 30/10 tras el primer borrador

Las dos preguntas abiertas quedaron cerradas como se proponía (decisiones 5 y 6 de arriba): pendiente sin ✓ con icono
de reloj y el programa nombrado en la línea; Reintentar solo relee cuando el original ya no existe.
