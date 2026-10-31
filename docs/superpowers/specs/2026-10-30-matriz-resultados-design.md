# Matriz de resultados con bibliotecas reales — diseño

Fecha: 30/10/2026. Rama `matriz-resultados` (desde main local 4242dcc6c). Paso 2 del plan
aprobado el 30/10 ("las cosas básicas deben funcionar sí o sí; un error en uno de sus ficheros,
a un DJ, es catastrófico"). El paso 1 (autocomprobación tras convertir) está mergeado.

## 1. Objetivo

Una matriz de pruebas que ejecuta el **pipeline real** de Surco (renderer `useTrackProcessing`
→ `window.api.processTrack` → `runProcessTrack` → `convertAudio` → `flushConversionBatch` →
colas → registro de verificación) sobre **copias** de bibliotecas con forma real, y afirma
**invariantes del resultado** leídos con instrumentos independientes. Nunca llamadas a mocks.

Dos preguntas por celda:

1. **¿El resultado es correcto?** Formato, PCM, a qué fichero apunta cada programa, cues,
   playlists, tags, carátula, duplicados, daños colaterales.
2. **¿La autocomprobación dice la verdad?** El veredicto (`ProcessResult.verification` más las
   actualizaciones del registro tras el flush y las colas) es `ok` **exactamente** cuando los
   invariantes se cumplen. Un `ok` con un invariante roto es el peor fallo posible (el "✓
   Añadido" sin mirar que el paso 1 quiso eliminar); un `mismatch` con todo bien es una falsa
   alarma.

Lo que ya hay no cubre esto: `processTrackMatrix.test.ts` usa mocks de todos los deps;
`convertMatrix`/`cueMatrix`/`convertUpdateContract` prueban `convertAudio` solo, sin bibliotecas
ni renderer; los escenarios (`src/scenarios/`) recorren el pipeline real pero con el registro
de verificación sin cablear (`onVerifyUpdate` es un no-op y `verifyMusic` devuelve `ok` fijo en
`harness.tsx`) y una sola celda cada uno. Los bugs del 30/10 (cambio de formato que solo
reetiquetaba, análisis de rekordbox borrado, pista de Music borrada, grouping/track/disc) vivían
en la composición de esas piezas.

## 2. Dónde vive

**Dentro del arnés de escenarios**, no un segundo arnés. `src/scenarios/` ya hace casi todo:
`openSurco` monta los hooks reales del renderer sobre el main real (`runProcessTrack`,
`convertAudio`, `flushConversionBatch`, colas en memoria de rekordbox y Engine), Electron
falseado con `electronFake`, Music con `fakeMusic`, raíz temporal por `scenarioRoot`, audio
real con ffmpeg-static, rekordbox cifrado real con `rekordboxFixture.ts`.

Carpeta nueva `apps/desktop/src/scenarios/matrix/`:

| Fichero | Qué es |
|---|---|
| `cells.ts` | Ejes, lista de celdas y covering array fijo (puro, sin E/S) |
| `cells.test.ts` | Demuestra la cobertura: todo par de valores aparece, IDs únicos, cada sabotaje tiene su clave de detalle |
| `sources.ts` | Fabrica cada origen (WAV, AIF, AIFF, FLAC, ALAC, AAC, MP3 con/sin Xing, MP3 con basura delante) con marcador, tags difíciles y carátula |
| `libraries.ts` | Construye el juego de bibliotecas de un grupo (rekordbox, Engine, Traktor, Music falso) a partir de las pistas |
| `oracle.ts` | Lectores independientes y evaluación de invariantes, devuelve la lista de invariantes rotos |
| `sabotage.ts` | Catálogo de averías inyectadas para la comprobación cruzada |
| `run.ts` | Ejecuta un grupo de celdas sobre `openSurco` y devuelve `CellResult[]` |
| `report.ts` | Tabla legible (markdown) de resultados |
| `core.test.tsx` | Subconjunto que corre siempre |
| `full.test.tsx` | Matriz completa, opt-in `SURCO_MATRIX=1` |
| `music.test.tsx` | Celdas de Music contra la app real, opt-in `SURCO_REAL_MUSIC=1` |
| `realLibraries.ts` + `real.test.tsx` | Copias de las colecciones reales del usuario, opt-in `SURCO_MATRIX_REAL=1` |

Cambios fuera de esa carpeta, todos pequeños y en su propia tarea:

- `verifyIpc.ts`: extraer la construcción del registro que hoy está en `index.ts`
  (`createVerifyRegistry` + `libraryReaders` + `libraryRequeue` + `samePath` + `exists`) a una
  función `appVerifyRegistry(...)` que usan `index.ts` y el arnés. Refactor sin cambio de
  conducta. Sin esto el arnés tendría su propio cableado, que se desviaría del de producción, y
  la matriz probaría un registro que no es el que corre en la app.
- `harness.tsx`: opción `verify: true` que cablea ese registro sobre las rutas de los fixtures,
  conecta `onVerifyUpdate`, llama a `afterFlush` tras cada flush y a `queueVerification` en las
  colas en memoria; cola de Traktor en memoria (hoy `flushConversionBatch` recibe `undefined`);
  `verifyMusic` real (`checkAppleMusic`) cuando Music es el falso; dos costuras de sabotaje
  (`afterConvert`, `beforeLibraryCheck`); `Scenario.verification(nombre)` y `Scenario.retry(nombre)`.
- `fakeMusic.ts`: los hechos medidos que hoy no modela (§6.4).

## 3. Ejes

| Eje | Valores |
|---|---|
| Origen (10) | `wav16` (16/44.1), `wav24` (24/96), `aif` (extensión .aif), `aiff`, `flac` (16/44.1), `alac` (m4a), `aac` (m4a), `mp3x` (con cabecera Xing/LAME), `mp3n` (sin Xing), `mp3j` (Lyrics3/basura delante del primer frame) |
| Destino de formato (5) | `aiff`, `wav`, `flac`, `alac`, `mp3` |
| Destino del fichero (5) | `folder`, `beside`, `overwrite`, `appleMusic` (solo Music), `appleMusicCopy` (Music y copia en la carpeta, `keepOutputCopy` antiguo) |
| Programas (5) | `rekordbox`, `engine`, `traktor`, `music`, `all` (los tres DJ; Music se suma cuando el destino es de Music) |
| Estado (3) | `closed`; `open` (cerrado tras el flush: queued → pending → applied); `retry` (la primera lectura falla y Reintentar la arregla) |
| Calidad (5) | `source`; `rate48` (`outputSampleRate: '48000'`); `bits16` (`outputBitDepth: '16'`); `normalize`; `trim` (silencio inicial de 2 s recortado) |
| Tags | Un juego difícil fijo en todas las celdas (§5.6) |

Restricciones: FLAC no va a Music (`toDestination` lo fija a `folder`); `music` solo con
destinos `appleMusic*`; `overwrite` a ALAC lo resuelve `resolveJobFormat` (se toma lo que dice,
no se fuerza); MP3 origen con `keepMp3Sources: false` salvo en la celda que prueba que con `true`
no se toca.

## 4. Estrategia de cobertura: 131 celdas

El producto cruzado completo (10 × 5 × 5 × 5 × 3 × 5 = 18 750) no tiene sentido. Cuatro capas
más una de comprobación cruzada, todas generadas por `cells.ts` y fijas (nada aleatorio, una
celda roja hoy es la misma mañana).

### Capa C — conversión, origen × formato (50 celdas)

Los 10 orígenes × 5 formatos, destino `folder`, programas `all` (cada pista está en rekordbox,
Engine y Traktor con cues, análisis y 2 playlists), estado `closed`, calidad `source`. Se agrupan
en **5 tandas** (una por formato destino, 10 pistas por tanda): una sola arrancada de
`openSurco` por tanda, que además es como lo usa un DJ (un lote, un flush).

### Capa D — destino × programas × estado (28 celdas, pairwise)

Factores: destino (5) × programas (5) × estado (3) × clase de conversión (3: `keep` AIFF→WAV
mismas muestras; `toLossy` FLAC→MP3; `fromLossy` MP3n→AIFF). Covering array de fuerza 2
escrito a mano en `cells.ts` (28 filas tras las restricciones), y `cells.test.ts` comprueba que
cada par de valores de dos factores cualesquiera aparece al menos una vez.

### Capa Q — calidad que cambia muestras (12 celdas)

4 ajustes (`rate48`, `bits16`, `normalize`, `trim`) × 3 orígenes (`wav24`→AIFF, `flac`→FLAC mismo
formato, `mp3n`→WAV), destino `folder`, programas `all`, `closed`. Aquí PCM no se compara;
se exige que los cues se muevan **exactamente** lo que se movió el audio (§5.4).

### Capa K — regresiones dirigidas (14 celdas)

Cada una nombra el bug o la medida que la justifica:

| Celda | Por qué |
|---|---|
| `K01` AIFF→WAV con destino Music, entrada con mismo título/artista/álbum | Music deduplica el add y devolvía la entrada vieja; se borró una pista real (music-add-deduplica) |
| `K02` WAV→AIFF con destino Music | Sentido inverso del mismo bug |
| `K03` WAV con destino Music y carpeta multimedia | Music archiva WAV en Unknown Artist/Unknown Album |
| `K04` AIFF→WAV que conserva muestras, rekordbox con análisis | Análisis borrado el 30/10 (`rekordboxAnalysisEmptied`) |
| `K05` MP3/AIFF/WAV con grouping | TIT1/GRP1 según formato; WAV solo TIT1 (da33c8d9c) |
| `K06` track `3/12`, disco `1/2` | Se escribían 312 y 0 |
| `K07` fila rekordbox con nombre NFD | `findTrackByPath` no la encuentra (pendiente conocido) |
| `K08` dos filas rekordbox para el mismo fichero por `~/Music/Music` → NAS | Gemelas: no escribir y avisar (`rekordboxAmbiguous`) |
| `K09` MP3x→FLAC y MP3n→FLAC con cues | 0 ms con cabecera, 25,06 ms sin ella (cues-mp3-flac-xing-medido) |
| `K10` `trim` + Reintentar | El reintento no desplaza los cues dos veces |
| `K11` `overwrite` mismo formato (FLAC→FLAC) | El fichero es su propio origen; el digest debe tomarse antes del rename |
| `K12` `beside` con nombre que ya existe | El "(2)": todos los programas apuntan al "(2)", no al otro |
| `K13` MP3 origen con `keepMp3Sources: true` | El MP3 sigue siendo MP3 en su sitio, sin reconvertir el audio, pero se reescriben sus etiquetas (`resolveJobFormat` deja el trabajo en MP3, como MP3→MP3); las bibliotecas siguen apuntando a él |
| `K14` rekordbox abierto todo el lote, se cierra, se aplica | queued → pending → applied sin ✓ intermedio |

### Capa S — comprobación cruzada del verificador (27 celdas)

Una conversión correcta a la que se le inyecta una avería **después** de que Surco escriba y
**antes** de que relea (costuras `afterConvert` y `beforeLibraryCheck` del arnés). Se exige que
el oráculo vea el invariante roto **y** que el veredicto sea `mismatch` con la clave de detalle
esperada. Una avería por cada clave alcanzable de `VERIFY_DETAIL_KEYS`:

- Fichero (6): borrar (`fileMissing`), cambiar a otro contenedor (`fileWrongFormat`), truncar a
  la mitad (`fileTruncated`), cambiar una muestra (`filePcmDiffers`), cambiar el título
  (`fileTagDiffers`), quitar la carátula (`fileNoCover`).
- Music (5): borrar la entrada nueva (`musicMissing`), apuntarla a otro fichero
  (`musicWrongFile`), segunda entrada para el mismo fichero (`musicDuplicate`), otro título
  (`musicTagDiffers`), sacarla de una playlist normal (`musicPlaylistLost`).
- rekordbox (6): devolver `FolderPath` al viejo (`rekordboxStillOld`), borrar la fila
  (`rekordboxMissing`), duplicarla (`rekordboxAmbiguous`), `FileSize` erróneo
  (`rekordboxSizeDiffers`), borrar un cue (`rekordboxCuesLost`), vaciar `AnalysisDataPath`
  (`rekordboxAnalysisEmptied`).
- Engine (4): `path` al viejo (`engineStillOld`), borrar (`engineMissing`), `fileBytes` erróneo
  (`engineSizeDiffers`), tocar `quickCues` (`enginePerformanceChanged`).
- Traktor (3): `FILE` al viejo (`traktorStillOld`), borrar la entrada (`traktorMissing`),
  duplicarla (`traktorAmbiguous`).
- **Puntos ciegos conocidos (3)**: mover un cue de rekordbox 500 ms sin cambiar cuántos hay;
  borrar un enlace `djmdSongPlaylist`; romper un `PRIMARYKEY` de playlist de Traktor. Hoy el
  verificador cuenta cues y no mira playlists de los programas DJ, así que estas tres celdas
  **saldrán rojas** como "el verificador no lo ve". Es información para decidir (§10), no un
  fallo del arnés.

Total: 50 + 28 + 12 + 14 + 27 = **131 celdas**.

### Qué corre siempre y qué es opt-in

| Conjunto | Celdas | Cuándo | Tiempo estimado |
|---|---|---|---|
| `core.test.tsx` | 20 (abajo) | Siempre, en `npm test` | ≤ 25 s de pared (medido en la tarea que lo crea; si pasa de 30 s se recorta) |
| `full.test.tsx` | 131 | `SURCO_MATRIX=1` (`npm run matrix`), antes de cada release y tras tocar conversión, bibliotecas o verificación | 3–6 min (los escenarios actuales convierten 4 pistas en ~1 s; 131 celdas en ~30 tandas) |
| `music.test.tsx` | 8 (K01–K03 y las 5 S de Music) | `SURCO_REAL_MUSIC=1`, Mac con Music, pistas desechables | ~2 min |
| `real.test.tsx` | Capa C y D sobre muestras de sus colecciones | `SURCO_MATRIX_REAL=1`, a mano antes de release | 10–20 min según NAS |

Núcleo (20): un origen representativo por formato destino (FLAC→AIFF, AIFF→WAV, WAV→FLAC,
AIFF→ALAC, FLAC→MP3); MP3n→AIFF; los destinos `beside`, `overwrite`, `appleMusic`,
`appleMusicCopy`; K04 (análisis); K14 (abierto → aplicado); K10 (trim + reintento); y 6
sabotajes (`filePcmDiffers`, `fileTagDiffers`, `rekordboxStillOld`, `engineSizeDiffers`,
`traktorStillOld`, `musicDuplicate`). Todas con el juego de tags difíciles. Ninguna celda con un
bug abierto conocido entra en el núcleo (la suite normal no puede quedar roja; §10).

## 5. Invariantes

Cada invariante devuelve `{ invariant, ok, detail }`; `detail` es una frase para la tabla
("rekordbox: 2 cues movidos 25 ms, se esperaba 0"). **Instrumentos independientes del
verificador**: el oráculo no importa nada de `verify*.ts`, `tagChanges.ts` ni `libraryPathKey.ts`,
y los valores esperados salen de la definición de la celda, no de `job.meta` ni de `FileExpect`.
Donde se comparte biblioteca (ffmpeg, TagLib, SQLCipher, sql.js) se comparte el decodificador,
no la lógica de comparación.

### 5.1 Formato (`format`)

`ffprobe -show_entries format=format_name:stream=codec_name,sample_rate,bits_per_raw_sample`
del fichero final más su extensión. Tabla esperada por destino: aiff → `aiff`/`pcm_s*be`, .aiff;
wav → `wav`/`pcm_s*le`, .wav; flac → `flac`/`flac`; alac → `mov,mp4…`/`alac`, .m4a; mp3 →
`mp3`/`mp3`. Con calidad `source`, tasa y profundidad iguales al origen (MP3 sin profundidad;
mp3-no-tiene-bit-depth); con `rate48` 48000; con `bits16` 16. "Solo reetiquetó" (el bug del
30/10) falla aquí: el contenedor sigue siendo el del origen.

Dos reglas de producción que el oráculo codifica como esperadas, no como fallo:

- Origen AAC a destino `alac` sigue siendo AAC en `.m4a`. `planConversion` (ffmpeg.ts, rama
  `alac`) copia o recodifica el AAC a propósito, porque decodificar un lossy a ALAC solo hace
  el fichero más grande sin ganar calidad.
- La tasa de un MP3 de salida sin tasa fijada es min(origen, 48000). libmp3lame no admite más
  de 48 kHz y ffmpeg negocia la tasa admitida más cercana (medido, un origen de 96 kHz sale a
  48000), así que `wav24` a MP3 espera 48000.

### 5.2 PCM (`pcm`)

Solo cuando origen y destino son lossless y la calidad no cambia muestras. ffmpeg decodifica
ambos a `-f s32le -ac <canales>` crudo, se hace sha1 en Node y se compara. Distinto camino que
`pcmDigest` (que usa `-f md5`, `forcedInputArgs` y el limitador). En el resto de celdas se exige
solo que el fichero decodifique entero (`-xerror -f null`) y que la duración sea la del origen
menos el recorte, a ±1 frame del códec.

### 5.3 Programas apuntan al nuevo (`points`)

Por programa sincronizado, leyendo la copia de la biblioteca **después** del flush y de las
colas:

- rekordbox: la fila con el ID original tiene `FolderPath` = ruta final (comparada NFC y por
  realpath), `FileNameL` = basename, `FileType` = código del formato (wav 11, aiff 12, mp3 1, m4a
  4, flac 5), `FileSize` = `stat` del fichero. Ninguna fila viva queda en la ruta vieja si el
  viejo ya no existe.
- Engine: `Track.path` relativo a la carpeta de la biblioteca resuelve a la ruta final,
  `fileType`, `fileBytes` = `stat`, mismo `id`.
- Traktor: la entrada (por `AUDIO_ID` o, si no, por título+artista sembrados) tiene
  `LOCATION VOLUME/DIR/FILE` = ubicación final con la regla de `toNmlLocation` reimplementada en
  el oráculo como tabla de casos (no se importa).
- Music: la entrada que vive (pid nuevo o reubicado) reproduce la ruta final; la vieja ya no
  existe salvo regla declarada (`oldMusicCopyKept`).

Limitaciones de producto declaradas en la celda (por ejemplo, Traktor no sigue un fichero que
cambia de carpeta) cuentan como invariante roto **esperado**: la celda pasa solo si el oráculo
lo ve roto y el veredicto también.

### 5.4 Cues, rejilla y análisis (`cues`)

El origen lleva un **marcador**: un clic de 1 muestra a 0,8 FS en `t = 10,000 s` sobre el tono.
El oráculo decodifica origen y resultado a PCM y localiza el clic en ambos; `lag` = diferencia en
ms (cubre trim, retardo del encoder MP3, Xing). Esperado por programa:

- rekordbox `djmdCue.InMsec`: cada cue = el sembrado + `lag`, ±1 ms. Si las muestras se
  conservan, `lag` es 0 y además `AnalysisDataPath` y `Analysed` iguales a los sembrados.
- Engine `PerformanceData`: `quickCues` y `beatData` decodificados con los lectores de
  `engineBlobs.ts` (son el formato, no la verificación); con muestras conservadas, blobs
  idénticos byte a byte; si no, cues desplazados `lag` y rejilla no vacía.
- Traktor: `CUE_V2 START` = sembrado + `lag` ±1 ms; en el fichero, el árbol TRAKTOR4 (PRIV/
  Vorbis) con `readTraktorCueStart` idem.

"Exactamente una vez": un desplazamiento doble da `2·lag` y falla. Con `lag = 0` y un cue movido,
también.

### 5.5 Playlists (`playlists`)

Conjunto de playlists de la pista antes y después, por ID de pista: rekordbox
`djmdSongPlaylist(PlaylistID)` por `ContentID`; Engine `PlaylistEntity.listId` por `trackId`;
Traktor, cada `PRIMARYKEY KEY` de `PLAYLISTS` que nombraba la pista nombra ahora la ubicación
nueva y resuelve a una entrada de `COLLECTION`; Music, las playlists normales (no smart) que
contenían la entrada contienen la que vive. Mismo orden de posición en Music y Engine.

### 5.6 Tags y carátula (`tags`, `cover`)

Juego difícil sembrado y exigido en cada celda: artista `AC/DC` (no se parte en dos
intérpretes), género `House; Deep House` (multivalor con el separador elegido), grouping
`Peak Time` (MP3/AIFF: TIT1 **y** GRP1; WAV: solo TIT1; FLAC: `GROUPING`; M4A: `©grp`), track
`3/12` (TRCK `3/12`, Vorbis `TRACKNUMBER=3` + `TRACKTOTAL=12`), disco `1/2`, posición de vinilo
`A2` en la celda K06, título con acento en NFD en el nombre de fichero y NFC en el tag
(`Café Olé`), emoji en el comentario (`🔥 promo`), BPM `124`, key `8A`, sello y catálogo.

Lectura: TagLib a nivel de frame/átomo/campo (`Id3v2Tag.getFramesByIdentifier`,
`XiphComment.getField`, átomos Apple), escrito en el oráculo, más ffprobe para
título/artista/álbum/track/disco donde lo ve bien (no ve GRP1 ni TXXX de WAV:
itunes-grp1-grouping, ffprobe-wav-txxx-limitation). Carátula: sha1 de los bytes de la imagen
frontal igual al que Surco preparó (`prepareProcessedCover` sobre la misma fuente, calculado en
el oráculo) o ausencia si la celda la quita. Music: título/artista/álbum/grouping y carátula de la
entrada del falso.

### 5.7 Sin duplicados ni huérfanas (`unique`)

rekordbox: exactamente una fila viva para la ruta final, y ninguna nueva sin playlists (el ID
original es el que se movió, no se creó otro). Engine: idem por `path`. Traktor: una entrada por
ubicación. Music: una entrada por fichero (bajo cualquier grafía), ninguna entrada sin fichero
creada por el lote. Disco: el temporal no queda; en `folder` el original sigue; en `overwrite`
el original está en la papelera de Surco solo si el veredicto es `ok` (puerta del paso 1).

### 5.8 Sin daños colaterales (`collateral`)

Programas no sincronizados en la celda: su fichero de biblioteca byte-idéntico (sha1). Pistas
del lote que no son la de la celda: filas, cues y playlists sin cambios. Copia de seguridad de
sesión creada antes de la primera escritura en cada biblioteca escrita.

### 5.9 Veredicto (`verdict`)

Se espera a que el registro emita el estado final de cada pista (`ok`, `mismatch` o, en `open`,
`pending` y luego `ok` tras cerrar). Regla de la celda:

```
oráculoOk = todos los invariantes aplicables ok (o rotos exactamente como declara la celda)
veredictoOk = verification.status === 'ok'
celda verde ⇔ oráculoOk && veredictoOk, o (!oráculoOk && !veredictoOk && la clave esperada está entre los checks)
```

En `open` se exige además que mientras el programa está abierto el estado sea `pending` (nunca
`ok`) y que no haya ✓ en la fila. En `retry`, que `retry()` devuelva `rechecked` y que el segundo
veredicto sea `ok` sin segundo desplazamiento de cues.

## 6. Fixtures

### 6.1 Audio (`sources.ts`)

Generados con ffmpeg-static en `scenarioDir`, mismos flags que producción (lección de
matriz-cues-origen-destino: un fixture que contradice al binario es sospechoso primero). Señal:
`kick` de `fixtures.ts` (no un seno puro: fixture-sintetico-onda) de 20 s con el clic marcador y,
en `trim`, 2 s de silencio delante. `mp3x` con `-write_xing 1`, `mp3n` con `-write_xing 0`,
`mp3j` con un bloque Lyrics3 + 512 ceros antes del primer frame (lyrics3-cola-mp3-xerror,
priv-traktor-padding-512). `aif` es AIFF con extensión `.aif`. `alac`/`aac` en `.m4a`. Cues
TRAKTOR4 embebidos con los helpers de `traktor4Fixture.ts` como hace `makeTrack`. Tags con
TagLib. Cada origen tiene su test de forma (§7, tarea 7): un fixture que no es lo que dice
invalida la celda entera.

### 6.2 Bibliotecas sintéticas (`libraries.ts`)

Para cada tanda, una carpeta con:

- rekordbox: `makeRekordbox` ampliado con `FileSize` real, `AnalysisDataPath`/`Analysed`,
  cues con posición y 2 playlists por pista, más una pista ajena con cues y playlists
  (colateral) y, en K07/K08, filas NFD y gemelas.
- Engine: `writeEngineLibraryFixture` + `analysedTrack` (rejilla, quickCues, overview) y
  playlists con entidades.
- Traktor: `collection.nml` con `COLLECTION` (entrada por pista con `CUE_V2`, `TEMPO`,
  `AUDIO_ID`) y `PLAYLISTS` con `PRIMARYKEY` por ubicación, construido con `toNmlLocation`
  **solo para sembrar** (el oráculo no lo usa para leer).
- Music: el falso con entrada por pista (si la celda es de Music) y una playlist normal y una
  smart.

Ajustes de la tanda: `syncRekordbox`/`rekordboxDbPath`, `syncEngineDj`/`engineLibraryDir`,
`syncTraktor`/`traktorNmlPath`, `traktorCueOffsetMs: 0`, destino y calidad de la celda.

### 6.3 "Programa abierto"

`isRekordboxRunning`, `isEngineDjRunning`, `isTraktorRunning` son `vi.fn` (ya lo hacen los
escenarios); la celda `open` los pone a `true` antes de convertir y a `false` después del flush,
y llama a `rekordboxClosed()`/`engineClosed()`/`traktorClosed()` del arnés, que aplican la cola
como lo hace el vigilante en producción.

### 6.4 Music: falso fiel, real opt-in

El falso (`fakeMusic.ts`) gana los hechos medidos el 30/10 que hoy no modela, cada uno con su
test que cita la medida:

1. `add` deduplica por título+artista+álbum y devuelve la entrada existente aunque sea otro
   formato; renombrar antes (`markAppleMusicReplacing`, hoy fijado a `'missing'` en el arnés)
   hace que cree la nueva.
2. Un WAV copiado a la carpeta multimedia acaba en `Unknown Artist/Unknown Album`.
3. Un fichero que ya está dentro de la carpeta multimedia se añade en su sitio.
4. Etiquetar reescribe la copia de Music (el tamaño cambia).
5. En MP3, editar grouping toca GRP1 y deja TIT1.
6. `readMusicEntryFacts` y `musicFileEntries` responden desde el estado del falso, para que
   `checkAppleMusic` corra tal cual.

Paridad: los hechos 1–5 se escriben una vez como aserciones compartidas y se ejecutan contra el
falso siempre y contra la app real con `SURCO_REAL_MUSIC=1` (pistas desechables con prefijo
aleatorio, como `applemusicReal.test.ts`). Si el falso y la app discrepan, manda la app y el
falso se corrige.

### 6.5 Copias de las colecciones reales (`realLibraries.ts`)

Los originales nunca se abren en escritura ni se convierten. Con `SURCO_MATRIX_REAL=1` y rutas
por variables (`SURCO_MATRIX_REKORDBOX_DB`, `SURCO_MATRIX_ENGINE_DIR`, `SURCO_MATRIX_TRAKTOR_NML`;
por defecto las detectadas por `rekordboxPath`/`engineLibrary`/`traktorNmlPath`):

1. Copiar la base a la raíz temporal con la API de backup de SQLite (abierta `readonly`), no con
   `cp` (WAL); NML con `copyFile`. `chmod 644` a la copia (rekordbox-pyrekordbox-via: la copia
   heredó 444 y todo fallaba como `write-failed`).
2. Elegir muestras de la copia: por formato hasta 3 pistas con fichero existente, ≥1 cue y ≥1
   playlist; 2 filas gemelas `~/Music/Music`↔NAS; 2 nombres NFD; excluir streaming
   (`FileType 25`).
3. Copiar esos ficheros de audio a un espejo `raiz/espejo/<ruta original>`, nombres byte a byte
   (NFD incluido), y recrear el enlace `~/Music/Music` dentro del espejo para las gemelas.
4. Reescribir en la **copia** de cada biblioteca solo el prefijo de esas rutas al espejo
   (rekordbox `FolderPath`; Engine no hace falta si el espejo conserva la ruta relativa a la
   biblioteca; Traktor `VOLUME`/`DIR`). Es preparación del fixture, registrada en el informe.
5. Antes y después: sha1 + mtime de cada original (bases y audio de la muestra). Si cambia
   cualquiera, el test falla primero y en rojo.

Music real no se copia (no hay forma): solo las celdas de `music.test.tsx` con pistas
desechables.

## 7. Cómo informa una celda

Cada celda es un `it` con nombre legible, por ejemplo
`C·flac→aiff · carpeta · rekordbox+Engine+Traktor · cerrado`. Su fallo lista en castellano los
invariantes rotos y el veredicto:

```
FLAC → AIFF · carpeta · todos · cerrado
  ✗ cues      rekordbox: 2 de 2 cues movidos +25 ms, se esperaba 0
  ✗ veredicto ok, pero el resultado no cuadra (el verificador no lo vio)
```

Al terminar, `report.ts` escribe `matriz-<fecha>.md` en la raíz temporal (o en
`SURCO_MATRIX_REPORT`) y su ruta sale por consola:

| Celda | Conversión | Fichero | Programas | Estado | Formato | PCM | Apuntan | Cues | Playlists | Tags | Carátula | Únicos | Colateral | Veredicto | Coincide |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C17 | FLAC→AIFF | carpeta | todos | cerrado | ✓ | ✓ | ✓ | ✗¹ | ✓ | ✓ | ✓ | ✓ | ✓ | ok | ✗ |

¹ rekordbox: 2 de 2 cues movidos +25 ms, se esperaba 0.

Columna "Coincide": ✓ si oráculo y veredicto dicen lo mismo. Resumen arriba: celdas verdes,
"Surco se equivoca y lo dice" (bug real, verificador honesto), "Surco se equivoca y dice ✓"
(lo peor), "falsa alarma". `–` donde el invariante no aplica.

## 8. Fuera de alcance

- Arreglar lo que la matriz encuentre. Cada celda roja se clasifica (fixture / pipeline /
  verificador) y se lleva al usuario; los arreglos van en sus propias ramas con test rojo.
- El paso 3 (recorridos reales con el driver antes de release) y el 4 (caza con agentes).
- Windows/Linux: la matriz corre en macOS (Music, rutas NFD, enlaces). Las celdas sin Music
  podrían correr en otros SO, no se garantiza.
- Rendimiento en NAS (lo mide el paso 1 en lote real).
- Edición de tags sin conversión (`syncTagsInLibraries`, revisión de Music): tiene su contrato
  (`convertUpdateContract`).
- Copias de rekordbox en USB / exportación.

## 9. Riesgos

1. **El fixture describe la biblioteca que imagino, no la suya** (lección de rekordbox 12/09).
   Mitigación: capa real (§6.5) y que cada fixture tenga su test de forma.
2. **Oráculo con el mismo fallo que el verificador.** Mitigación: sin imports de `verify*`, valores
   esperados de la celda, y la capa S demuestra que el oráculo ve cada avería. Antes de dar un
   invariante por bueno, mutarlo (test-mutacion-instrumentar).
3. **Desvío del cableado del arnés respecto a `index.ts`.** Mitigación: la extracción
   `appVerifyRegistry` de la tarea 1; lo que no se extrae (vigilantes de cola, IPC) queda listado
   en el arnés como diferencia conocida.
4. **Tiempo de la suite normal.** Mitigación: núcleo de 20 celdas con presupuesto medido; el
   resto opt-in.
5. **Flakiness** por esperas del registro y colas. Mitigación: esperar eventos (`onVerifyUpdate`
   hasta estado final), nunca `setTimeout`; spies de `vi.mock` limpiados entre tandas
   (suite-flaky-fichero-entero).
6. **Falso de Music infiel.** Mitigación: paridad §6.4 contra la app real.
7. **Copias reales grandes.** master.db 56 MB, WAV de 50–100 MB: muestra de ~30 pistas, 2–3 GB
   en tmp. Se borra al acabar salvo `SURCO_MATRIX_KEEP=1`.
8. **Celdas rojas por bugs abiertos** (K07 NFD, grouping MP3 por Music, los 3 puntos ciegos):
   no entran en el núcleo; en la completa salen rojas y en el informe. Decisión en §10.

## 10. Decisiones abiertas para Vicent

1. **Núcleo en la suite normal (~20 s más)** o todo opt-in. Propuesta: núcleo siempre.
2. **Celdas con bug abierto conocido** (K07, grouping MP3 en Music, 3 puntos ciegos): dejarlas
   rojas en la completa hasta arreglarlas (propuesta; nada de `skip` ni `it.fails`), o arreglar
   los bugs antes de cerrar esta rama.
3. **Puntos ciegos del verificador** (posición de cues en rekordbox, playlists de los programas
   DJ): ampliar el paso 1 para que los mire, o aceptarlos y que solo la matriz los vigile.
4. **¿La matriz completa bloquea el release?** (`npm run matrix` dentro de `/release`), o solo se
   corre a mano.
