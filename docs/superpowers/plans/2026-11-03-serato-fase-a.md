# Serato fase (a): solo lectura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serato DJ Pro aparece como cuarto programa en Surco en solo lectura: su pestaña con crates y pistas (de `~/Music/_Serato_` y de cada disco con `_Serato_`), y sus hot cues y loops visibles en el editor de cues, sin que Surco escriba nada en Serato.

**Architecture:** Lectores puros de los formatos de Serato (`Serato Markers2` en el fichero de audio; `database V2` y `.crate` en `_Serato_`), un módulo de biblioteca y canales `serato:*` con la misma forma que los de Traktor, y `'serato'` en `DjProgram`. Todo lo que escribe en una biblioteca pasa a indexarse por `WritableProgram = Exclude<DjProgram, 'serato'>`: así "Serato no lo soporta todavía" lo expresa el tipo, y en la fase de escritura basta con quitar ese `Exclude` para que el compilador vuelva a señalar cada sitio. Las tablas de lectura (pestaña, carril, cues) ganan su fila de Serato.

**Tech Stack:** TypeScript estricto, Electron, React 19, TanStack Query, node-taglib-sharp (ya en el proyecto), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (secciones "Lo que sabemos de Serato 5" y "Serato fase (a): solo lectura"). Mapa: `docs/superpowers/plans/2026-11-03-serato-mapa.md` (errores del compilador y "Añadidos a mano").

## Global Constraints

- Surco no escribe nada en Serato en esta fase: ni ficheros de audio, ni `_Serato_`, ni su SQLite. Ninguna ruta que escribe puede recibir una pista de Serato.
- Formatos medidos (Serato DJ Pro 5.0.0, 03/11):
  - `Serato Markers2` en MP3, AIFF (chunk `ID3 `) y WAV (chunk `id3 `): GEOB con descripción `Serato Markers2`, datos `01 01` + base64 del payload (con saltos de línea, puede acabar en NUL). FLAC: Vorbis `SERATO_MARKERS_V2` = base64 de (`application/octet-stream\0\0Serato Markers2\0` + datos GEOB). M4A: átomo `----:com.serato.dj:markersv2`, mismo armado que FLAC.
  - Payload: `01 01` y entradas `nombre\0` + longitud u32 BE + cuerpo, hasta un nombre vacío. `CUE`: byte 1 índice, bytes 2-5 posición en ms (u32 BE), bytes 7-9 color RGB, nombre UTF-8 terminado en NUL desde el byte 12. `LOOP`: byte 1 índice, 2-5 inicio ms, 6-9 fin ms, nombre desde el byte 20. `COLOR` y `BPMLOCK` (1 byte) se leen pero no se muestran.
  - `database V2` y `.crate`: TLV de 4 bytes de etiqueta + longitud u32 BE; textos en UTF-16 BE; `otrk` contiene `pfil` (ruta relativa a la raíz del volumen, sin barra inicial) y `tsng`, `tart`, `talb`, `tgen`, `tbpm`, `tkey`, `tadd` (segundos epoch, en texto); en `.crate`, `otrk` contiene `ptrk`. Subcrates: `Subcrates/Padre%%Hijo.crate`.
  - Raíz de rutas: la biblioteca de `~/Music/_Serato_` usa la raíz del disco de arranque (`/` + `pfil`); la de `/Volumes/<Disco>/_Serato_` usa `/Volumes/<Disco>/` + `pfil`. En Windows, la letra de unidad (la lógica de `volumeRoot` de `shared/serato.ts`); Windows queda sin medir y se anota.
- Ids de pista: `serato:` + ruta absoluta del fichero. `programOf` los reconoce.
- Recently added de Serato: 30 días, como Traktor (`RECENT_DAYS` de `main/traktorPlaylists.ts`), por `tadd`.
- Orden del carril: appleMusic, rekordbox, engine, traktor, serato.
- Textos nuevos en los seis idiomas (`es`, `en`, `de`, `fr`, `pt-BR`, `ja`), sin guion largo (—) ni dos puntos de explicación. Nombre visible: "Serato".
- Crates inteligentes (`SmartCrates/*.scrate`): fuera de esta fase.
- Sin comentarios nuevos en el código. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` para deshacer cambios con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
- Fixtures: los tests no leen `~/Music`. Los payloads reales se copian como base64 en los tests (son de unos cientos de bytes); los ficheros de audio de prueba se generan en el directorio temporal de los tests con el ffmpeg del proyecto.

## Review Focus

- Una pista de Serato cuyo fichero no existe o no lleva `Serato Markers2`: el editor la abre sin cues, sin error. Test en la Tarea 2.
- Un `database V2` o `.crate` truncado o con una etiqueta desconocida: se ignora lo que no se entiende y se leen las pistas válidas, sin lanzar. Test en la Tarea 3.
- Un disco con `_Serato_` desmontado: sus pistas y crates no aparecen; los de los demás sí. Test en la Tarea 4.
- Serato abierto: la pestaña y el editor avisan de que los cues pueden no estar al día (los vuelca al cerrar). Test en la Tarea 6.
- Convertir o sustituir una pista abierta desde la pestaña Serato: deshabilitado con el motivo visible. Test en la Tarea 6.

---

### Task 1: leer `Serato Markers2`

**Files:**
- Create: `apps/desktop/src/shared/seratoMarkers.ts`, `apps/desktop/src/shared/seratoMarkers.test.ts`

**Interfaces:**
- Produces:
  - `export interface SeratoCue { index: number; ms: number; color: number; name: string }` (`color` como `0xRRGGBB`).
  - `export interface SeratoLoop { index: number; startMs: number; endMs: number; name: string }`.
  - `export interface SeratoMarkers { cues: SeratoCue[]; loops: SeratoLoop[] }`.
  - `export function markersFromGeob(data: Uint8Array): SeratoMarkers | null` — datos de un GEOB `Serato Markers2` (`01 01` + base64).
  - `export function markersFromArmored(value: string): SeratoMarkers | null` — valor de FLAC/M4A (base64 del GEOB completo).
  - Ambas devuelven `null` ante datos que no se reconocen; nunca lanzan.

- [ ] **Step 1: Tests (rojos)** con los cinco payloads reales copiados en base64 (extraerlos una vez de `~/Music/Serato Pruebas/Pray.{mp3,aiff,wav,flac,m4a}` y pegarlos como constantes en el test):
  - MP3 (`markersFromGeob`): 8 cues `{0,57606,0xcc0000,'A'}`, `{1,71553,0xcc8800,''}`, `{2,77329,0x0000cc,''}`, `{3,82467,0xcccc00,''}`, `{4,88003,0x00cc00,''}`, `{5,93439,0xcc00cc,''}`, `{6,102387,0x00cccc,''}`, `{7,109558,0x8800cc,''}` y 2 loops `{0,57612,71941,''}`, `{1,64777,79105,''}`.
  - AIFF: cues en 45012, 49974, 54874; WAV: 3834, 9192, 16367 (los dos con `markersFromGeob`); FLAC: 3838, 9204, 14567; M4A: 7444, 12756, 19019 (los dos con `markersFromArmored`); colores `0xcc0000`, `0xcc8800`, `0x0000cc`.
  - Datos basura, payload vacío y base64 truncado devuelven `null` o lo leído hasta el corte, sin lanzar.
- [ ] **Step 2:** Rojo (módulo inexistente).
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Verde; tres typecheck; biome.
- [ ] **Step 5: Commit** `git commit -m "Read Serato's hot cues and loops from its Markers2 tag"`

### Task 2: sacar `Serato Markers2` de un fichero de audio

**Files:**
- Create: `apps/desktop/src/main/seratoTags.ts`, `apps/desktop/src/main/seratoTags.test.ts`
- Modify: `apps/desktop/src/main/tags.ts` (exportar `geobParts` si hace falta, sin cambiar su comportamiento)

**Interfaces:**
- Consumes: `markersFromGeob`, `markersFromArmored` (Tarea 1).
- Produces: `export function readSeratoMarkers(file: string): SeratoMarkers | null` — por extensión: MP3/AIFF/WAV leen el ID3v2 con TagLib y buscan el GEOB `Serato Markers2`; FLAC el campo Xiph `SERATO_MARKERS_V2`; M4A el freeform `com.serato.dj` / `markersv2`. Fichero ausente, ilegible o sin la etiqueta: `null`, sin lanzar.

- [ ] **Step 1: Tests (rojos):** para cada formato, generar un audio corto con el ffmpeg del proyecto en el temporal de tests, escribirle con TagLib la etiqueta tal y como la escribe Serato (usando el payload real de la Tarea 1) y comprobar que `readSeratoMarkers` devuelve los cues esperados. Más: fichero inexistente → `null`; MP3 sin la etiqueta → `null`; MP3 con un GEOB de otro programa delante (p. ej. Mixed In Key `CuePoints`) y el de Serato detrás → lee el de Serato.
- [ ] **Step 2:** Rojo.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Verde; tres typecheck; biome. Comprobación manual en el informe: `readSeratoMarkers` sobre los cinco `~/Music/Serato Pruebas/Pray.*` devuelve lo de la Tarea 1 (script de un solo uso, no un test).
- [ ] **Step 5: Commit** `git commit -m "Find Serato's Markers2 tag in MP3, AIFF, WAV, FLAC and M4A files"`

### Task 3: leer `database V2` y `.crate`

**Files:**
- Create: `apps/desktop/src/main/seratoDatabase.ts`, `apps/desktop/src/main/seratoDatabase.test.ts`

**Interfaces:**
- Produces:
  - `export interface SeratoTrack { path: string; title: string; artist: string; album: string; genre: string; bpm: string; key: string; addedAt: number | null }` (`path` relativa a la raíz del volumen, tal cual `pfil`).
  - `export function parseSeratoDatabase(bytes: Uint8Array): SeratoTrack[]`
  - `export function parseSeratoCrate(bytes: Uint8Array): string[]` (las `ptrk`, en orden).
  - `export function crateTree(fileNames: string[]): { id: string; name: string; children: … }[]` — de los nombres de `Subcrates/*.crate` a un árbol por `%%`; `id` = nombre de fichero sin `.crate`; orden alfabético sin distinguir mayúsculas, como Serato.

- [ ] **Step 1: Tests (rojos):** un `database V2` construido en el test con un codificador TLV de ayuda (dos pistas, una con todos los campos y otra solo con `pfil`), y otro con el contenido real de la base de datos de pruebas pegado en base64 (5 pistas `Users/vicent/Music/Serato Pruebas/Pray.*`, `tadd` 1793688116); un `.crate` real (`Serato Pruebas.crate`: mp3, aiff, m4a, flac en ese orden); `crateTree(['A.crate','A%%B.crate','c.crate'])` anida B bajo A; bytes truncados o con una etiqueta desconocida dentro de `otrk` leen el resto sin lanzar.
- [ ] **Step 2:** Rojo.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Verde; tres typecheck; biome.
- [ ] **Step 5: Commit** `git commit -m "Read Serato's track database and crates"`

### Task 4: biblioteca de Serato y canales `serato:*`

**Files:**
- Create: `apps/desktop/src/main/seratoLibrary.ts`, `apps/desktop/src/main/seratoLibrary.test.ts`, `apps/desktop/src/main/seratoPlaylistsIpc.ts`, `apps/desktop/src/main/seratoPlaylistsIpc.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (registrar los canales), `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: Tarea 3; `ALL_TRACKS_ID`, `RECENTLY_ADDED_ID`; `SourceNode`, `SourcePlaylistEntry` (`shared/types.ts`).
- Produces:
  - `export interface SeratoLibraryRoot { dir: string; root: string }` y `export function seratoLibraryRoots(home: string, volumes: string[]): SeratoLibraryRoot[]` — `~/Music/_Serato_` con raíz `/` y cada `/Volumes/<X>/_Serato_` existente con raíz `/Volumes/<X>`.
  - `export function readSeratoLibrary(roots: SeratoLibraryRoot[]): { tracks: (SeratoTrack & { file: string })[]; crates: Map<string, string[]> }` (`file` absoluta; crates con rutas absolutas; los crates de distintos volúmenes con el mismo nombre se juntan como hace Serato). Una raíz ilegible se salta.
  - Funciones de la pestaña con la misma forma que Traktor: `seratoTree`, `seratoRecentCount(now)`, `seratoTrackCount`, `seratoPlaylist(id, now)` (devuelve `SourcePlaylistEntry` con `contentId: 'serato:' + file`, `meta` de título/artista/álbum/género, sin `linkId` ni separadores), `seratoMembership(paths)`.
  - `registerSeratoPlaylistsIpc(host: { roots: () => SeratoLibraryRoot[]; allowMedia?: (paths: string[]) => void })` con `serato:available`, `serato:tree`, `serato:recentCount`, `serato:trackCount`, `serato:playlist`, `serato:membership`.
  - Preload: `seratoAvailable()`, `loadSeratoTree()`, `seratoRecentCount()`, `seratoTrackCount()`, `loadSeratoPlaylist(id)`, `seratoMembership(paths)`.

- [ ] **Step 1: Tests (rojos)** con carpetas `_Serato_` creadas en el temporal (bases de datos y crates construidos con el codificador de la Tarea 3): dos raíces (casa y un volumen) se juntan; un volumen sin `_Serato_` no aporta nada; All tracks cuenta las pistas de ambas; Recently added solo las de los últimos 30 días por `tadd`; un crate da sus pistas en orden; membership devuelve los ids de crate de cada ruta; `serato:playlist` concede acceso a las rutas (`allowMedia`).
- [ ] **Step 2:** Rojo. **Step 3:** Implementar y registrar. **Step 4:** Verde; tres typecheck; biome.
- [ ] **Step 5: Commit** `git commit -m "Serve Serato's crates and tracks from the home and drive libraries"`

### Task 5: `'serato'` en `DjProgram`, escritura solo para `WritableProgram`, y la pestaña

**Files (guía; el compilador da la lista exacta al añadir `'serato'`):**
- `apps/desktop/src/shared/djProgram.ts`: `DjProgram` con `'serato'`; `programOf` reconoce `serato:`; `export type WritableProgram = Exclude<DjProgram, 'serato'>`, `WRITABLE_PROGRAMS` y un `writableInOrder` con la misma comprobación de completitud que `programsInOrder` sobre `WritableProgram`; `RAIL_PROGRAMS` con `'serato'` al final.
- Lado de escritura (vaciado tras convertir, colas, sesiones de copia, comprobación, daños, USB, etiquetas, duplicados, uso de ficheros, playlists al convertir, ajustes `sync*`/`addTo*`/rutas, cierre del programa y sus textos, flujos de cues hacia otros programas, cues gemelos, matriz de escenarios): sus tablas, órdenes y tipos pasan de `DjProgram` a `WritableProgram` sin cambiar valores ni órdenes.
- Lado de lectura, con fila de Serato:
  - `SOURCE_READ.serato` (preload de la Tarea 4); `SOURCE_PROGRAMS.serato`: sin separador, sin edición, sin nodos fijos, `usb: false`, sin comprobación de biblioteca ausente, bandera de pista `fromSerato` (campo opcional nuevo de `TrackItem`/`SessionEdit`, sin tocar los existentes), sin rellenar filas cargadas, sin añadir pistas fuera de la colección.
  - `DJ_PROCESSES.serato.isRunning` (proceso `Serato DJ Pro` en macOS, `Serato DJ Pro.exe` en Windows, con la misma técnica que `engineProcess.ts`); `quit` y los textos de cierre son del lado de escritura (no hay fila de Serato).
  - Icono en `SourceIcons.tsx` / `SourceRail.tsx`; nombre en las tablas `LIBRARY_NAME` ("Serato"); textos `sources.serato`, `sources.failed.serato`, `sources.notFound.serato`, `sources.hide.serato`, `settings.sourceSeratoUnavailable` en los seis idiomas.
- `docs/superpowers/plans/2026-11-03-serato-mapa.md`: anotar que cada tabla del lado de escritura volverá a exigir a Serato al quitar el `Exclude`.

- [ ] **Step 1: Tests (rojos)** en `djProgram.test.ts` (`programOf('serato:/Users/x/a.mp3') === 'serato'`; `RAIL_PROGRAMS` acaba en `'serato'`; `WRITABLE_PROGRAMS` no lo contiene), `sourcePrograms.test.ts` (fila de Serato) y `useSourceBrowser.test.tsx` (con Serato disponible, el carril muestra la pestaña tras Traktor y su árbol y recuentos llaman a los métodos `serato*`; sin Serato, no aparece).
- [ ] **Step 2:** Rojo.
- [ ] **Step 3:** Implementar. Ningún valor ni orden de las tablas de escritura cambia; donde una tabla de escritura no pueda pasar a `WritableProgram` sin cambiar su forma, parar y anotarlo en el informe.
- [ ] **Step 4:** Verde; suite completa con el recuento de antes más los nuevos; tres typecheck; biome; matriz completa igual que la base (126 bien, 1 saltada, 4 fallos previos).
- [ ] **Step 5: Commit** `git commit -m "Add Serato as a read-only DJ program with its own tab"`

### Task 6: cues de Serato en el editor, solo lectura

**Files:**
- Create: `apps/desktop/src/main/seratoCueSource.ts`, `seratoCueSource.test.ts`
- Modify: `apps/desktop/src/main/cueSource.ts` (si la interfaz necesita admitir una fuente sin cola), `apps/desktop/src/main/rekordboxCuesIpc.ts` (registro `sources.serato`), `apps/desktop/src/renderer/src/lib/cuePrograms.ts` (fila de Serato y campo nuevo `readOnly: boolean`, `false` en los otros tres), `CuesSection.tsx` / `CuesBatchSection.tsx` (si `readOnly`, sin Auto mark, sin guardar ni editar, con la nota "Serato es de solo lectura en Surco"), `App.tsx` (`cuesOpen` para pistas de Serato), `renderer/src/hooks/useTrackLibrary.ts` (bandera `fromSerato` en filas nuevas), el control que convierte y el que sustituye en su sitio (deshabilitados para pistas con `fromSerato`, con el motivo "Serato perdería la pista y sus cues"), textos nuevos en los seis idiomas.

**Interfaces:**
- Consumes: `readSeratoMarkers` (Tarea 2), `programOf`, `DJ_PROCESSES.serato.isRunning` (Tarea 5).
- Produces: `seratoCueSource(host: { words: (file: string) => Promise<Uint16Array | null> }): CueSource` — `trackCues(id)`: lee el fichero de `id` (`serato:` + ruta) y devuelve los hot cues como cues del editor (posición, color, nombre; índice 0-7 como letra A-H) y sin rejilla (`analysed: false`, sin `grid`); `waveDetail`: onda calculada del audio (`words`, como Traktor); `dropInput`: `null`; `auditionLead`: 0; `surcoGrid`: `null`; sin cola (no se puede guardar). Los loops se leen pero en esta fase no se pintan.
- `CUE_PROGRAMS.serato`: 8 ranuras sin CALL, `readsAudio: true`, `surcoGrid: false`, `writesCalls: false`, `fixedColour: null`, `colourHelp: null`, `collectionGate: null`, `callsNote: null`, su `saveAllKey`, `readOnly: true`.

- [ ] **Step 1: Tests (rojos):** `seratoCueSource.trackCues` sobre un audio de prueba con el payload real de MP3 devuelve los 8 cues con su color y la letra A en el primero; fichero sin etiqueta → sin cues y sin error; en `CuesSection`, una pista `serato:` muestra los cues, no ofrece guardar ni Auto mark y muestra la nota de solo lectura; con Serato abierto, la nota avisa de que los cues pueden no estar al día; en la lista, convertir y sustituir están deshabilitados para una pista de Serato con su motivo, y no para una de rekordbox.
- [ ] **Step 2:** Rojo. **Step 3:** Implementar. **Step 4:** Verde; suite; tres typecheck; biome.
- [ ] **Step 5: Commit** `git commit -m "Show Serato's hot cues read-only in the cue editor and keep its tracks from being converted"`

### Task 7: Cierre

- [ ] Matriz completa igual que la base.
- [ ] Sonda: ya no es una sonda (Serato está en el tipo); quitar `'serato'` de `WritableProgram` temporalmente debe hacer fallar el compilador en las tablas de escritura. Revertir y actualizar el mapa (qué falta para las fases b y c).
- [ ] Prueba manual con el driver en perfil aislado: la pestaña Serato aparece tras Traktor; el crate `Serato Pruebas` lista sus 4 pistas y All tracks las 5; abrir `Pray.mp3` muestra los 8 cues con sus colores y "A" con nombre; abrir `Pray.flac` y `Pray.m4a` muestra sus 3 cues; convertir está deshabilitado con el motivo; con Serato abierto, sale el aviso. Verificar que ningún fichero de `~/Music/Serato Pruebas` ni de `~/Music/_Serato_` cambia (hashes antes y después).
- [ ] `git merge main`, suite, `git merge --ff-only serato` en el main local (sin push).
