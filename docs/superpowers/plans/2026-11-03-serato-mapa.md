# Mapa de Serato: lo que el compilador obliga a decidir

Medido el 03/11 tras el bloque 8 añadiendo `'serato'` a `DjProgram` (y revirtiendo): errores de los tres `tsc`, `fichero:línea código`.

## Añadidos a mano (el compilador no los ve)

- `shared/djProgram.ts` `programOf`: el caso por defecto devuelve `'rekordbox'`. Primer cambio de Serato: reconocer `serato:`.
- `shared/verification.ts` `PLACE_ORDER`: lista que mezcla programas con 'file'/'appleMusic' (bloque 7).
- `renderer/src/components/CuesSection.tsx` `saveAllKey`: decide la etiqueta mixta mirando si hay Traktor; una mezcla Serato + rekordbox daría «rekordbox y Engine DJ». Y `collectionGate` usa consultas y ajustes con nombre de Traktor (`traktorCanSave`, `traktorNmlPath`): un segundo programa con colección que confirmar necesita los suyos.
- USB: `App.tsx` `useUsbVolumes(... === 'engine')` y la fuente del modal eligen el exportador (bloque 6/USB).
- Campos por programa escritos a mano (bloque 6): banderas `fromRekordbox/fromTraktor/fromEngine` de `TrackItem`/`SessionEdit`, los seis campos `{rekordbox,traktor,engine}Playlists(Base)` del trabajo de conversión, ajustes `*PlaylistsFieldOffered`, `useTrackLibrary` (bandera de filas nuevas), invalidaciones de membership en `useRekordboxQueue` y `useTrackProcessing`, `cuesOpen` en `App.tsx`.

- Claves de traducción por programa que el compilador no ve (se forman con plantillas): `sources.<programa>`, `sources.failed.<programa>`, `sources.notFound.<programa>`, `sources.hide.<programa>`, `settings.source<Programa>Unavailable`, y las de cues `editor.cues.<programa>.*`.
- Recordatorio para Serato (a): `cuesOpen` en `App.tsx` y la bandera de filas nuevas de `useTrackLibrary` siguen escritos a mano; sin ellos Serato no abriría el editor de cues.

- Vaciado tras convertir: `repointEngineQueued` renombra `engine-running` a `'rekordbox-running'` y `queueConversionRun` compara con `'rekordbox-running'`; el tipo `ConversionQueues` tiene claves fijas (el flusher de Serato exigirá su cola en la práctica).
- Añadir durante el trabajo (6d): solo Engine se añade a su biblioteca durante la conversión (`processTrack.ts` pasos de Engine, adaptador en `index.ts`, `isAppleMusicOnly`, `engineSizeFollow`); un programa que lo necesite añadirá su propio paso. Y `libraryFileUse.ts` `libraryGenresOf`: cadena de `if` por programa; el orden rekordbox, engine, traktor se ve en la lista de géneros.
- Renderer tras convertir (6h-6i), sitios dejados a propósito: las tres secciones de `DestinationTab` (cada una con su maquetación), `librarySourceOf` (ids compartidos con main, p. ej. `'engineDj'`), `unanalysedIn` de `triage.ts` (ids de filtros), los valores por defecto `'rekordbox'` de `PlaylistsField`, la lista de colas de `App.tsx` y la regla de ruta de Traktor en `reachable` del editor. Órdenes por sitio que hoy coinciden con `RAIL_PROGRAMS` pero son independientes a propósito: `FLAG_ORDER`, `QUEUE_PILL_ORDER`, orden de revisión, `LIBRARY_ORDER` del editor, `ORDER` de `djReach`. `SOURCE_PROGRAMS.trackFlag` y `TRACK_PROGRAMS.flag` se solapan (solo difieren en Engine).
- USB (6j), lo que sigue siendo de un solo programa: la memoria de Engine en `readVolumes` y el campo `UsbVolume.engine`, `usb:pickFolder(from?: 'engine')`, `usbAvailable` (solo rekordbox: píldora y avisos de conexión), los dos exportadores de `usbExportIpc` con sus dependencias, y los textos `USB_QUIT_DETAIL`/`ENGINE_USB_QUIT_DETAIL` en sus módulos. Un programa con USB nuevo entra en `UsbProgram` (y entonces el compilador exige su exportador, su vista del modal y `usb: true`).
- Comprobación y daños (7), lo que sigue siendo de un programa: el estado de Traktor en `verifyRegistry` (`neverWritten`, `traktorBefore`, `traktorCues`: la comprobación de Traktor se basa en parches, no en filas), la regla de `treeFile` de Traktor en `allowed` de `damageRepair`, y `snapshotLibraries` de `processTrack` (solo rekordbox y Engine). Los escaneos y reparaciones de daños por programa se declaran en tablas cuyo tipo sale de los destinos de `DamageScan`/`DamageRepair`.
- Ajustes y bienvenida (8), lo que sigue siendo de un programa: el asistente de bienvenida (`OnboardingWizard.tsx`: la ruta de Traktor al activarlo, el selector de carpeta de Engine), las secciones de `DestinationTab` y la migración de sincronización de Traktor (`syncToggleMigration.ts`). La ruta de cada biblioteca debe ser un ajuste local: lo exige un test contra `DJ_COLLECTION_PATH` (`shared/djSettings.ts`). Tres tablas `LIBRARY_NAME` iguales (`reviewLibraries`, `CuesSection`, `CuesBatchSection`), todas `Record` por programa.

## Tarea 5: Serato en `DjProgram`, la escritura en `WritableProgram`

`WritableProgram = Exclude<DjProgram, 'serato'>` (`shared/djProgram.ts`), con `WRITABLE_PROGRAMS` y `writableInOrder` (misma comprobación de completitud que `programsInOrder`). Cada tabla, orden o tipo de esta lista pasó de `DjProgram` a `WritableProgram` sin cambiar valores ni órdenes; al quitar el `Exclude` en las fases de escritura, el compilador volverá a exigir a Serato en todos ellos:

- Vaciado tras convertir y colas: `libraryFlushes.ts` (`Sessions`, `SYNC_BLOCKED_KEY`, `SYNC_ISSUE_CHANNEL`, `FLUSH_ORDER`, `flushers`, `ConversionFlusher`), `programQueue.ts`, cola y pastillas de `App.tsx` (`QUEUE_PILL_ORDER`, `SYNC_ISSUES`, `queues`, `playlistLibraries`), `PROGRAM_QUEUES` de `useRekordboxQueue.ts`, `satisfies` de `programQueues` en `index.ts`.
- Copias y momentos: `copiesIpc.ts`, `moments.ts`, `ProgramCopies.program`, `LibraryCopyInfo`, `restoreCopy` (preload), `CopiesScreen.tsx`.
- Comprobación y daños: `VerifyPlace`/`PLACE_PROGRAMS` (`shared/verification.ts`), `verifyRegistry.ts`, `verifyIpc.ts`, `processTrack.ts` (`library`), `damageIpc.ts`, `damageRepair.ts`, `damageScan.ts`, `GenreSource` (`genreDamage.ts`).
- USB: `UsbProgram = Exclude<WritableProgram, 'traktor'>`, `UsbExporters` y `routeUsbExports` (`usbExportRoute.ts`).
- Etiquetas, duplicados y uso de ficheros: `libraryTagSync.ts`, `LibraryTagSyncReport`, `LibraryStatus`, `duplicateReplace.ts`, `DuplicateReplaceOutcome`, `KEEPS_REPLACED`, `libraryFileUse.ts` (`SyncedLibraries`, `holds`, `COPY_INFO`, `TRACK_OF`), `REVIEW_LIBRARIES` y `ReviewSync`.
- Playlists al convertir: `PlaylistLibrary`, `JOB_PLAYLISTS` y `attachPlaylists` (`processTrack.ts`, `rekordboxBatch.ts`), `OFFERED` y `useOfferPlaylistFields`, `copyPlaylists`/`jobPlaylists` y la firma de `dirty.ts`, `rereadMovedSources` de `useTrackProcessing.ts`.
- Ajustes: `DJ_REACH_SETTINGS`, `DJ_COLLECTION_PATH` (`shared/djSettings.ts`), `DjLibraryId` (`djLibraries.ts`), `djReach.ts`, órdenes y consultas de `Editor.tsx` (`LIBRARY_ORDER`, `COLLECTION_PATH_ORDER`).
- Cierre del programa: `QUIT_REASONS`, `QUIT_TEXT`, `QUIT_PROMPT_SHARING`, `createEnsureClosed` (`djProcesses.ts`). `DJ_PROCESSES` tiene fila de Serato solo con `isRunning`; `quit` existe solo para `WritableProgram`.
- Cues hacia otros programas: `FLOW_TO`, `TwinPlan.library` y las bibliotecas de `cueTwins.ts`, `foundBy` y la lista de `CuesTab.tsx`, `CUE_SAVE_ORDER` y `beginMoment` (`rekordboxCuesIpc.ts`), `LIBRARIES` de `CuesBatchSection.tsx`. La tabla `LIBRARY_NAME` de `CuesSection.tsx` va por `TwinPlan['library']`, así que tampoco lleva a Serato.
- Matriz de escenarios: `harness.tsx`, `matrix/cells.ts`, `matrix/libraries.ts`, `matrix/oracle.ts`.
- `TRACK_PROGRAMS`: la fila de Serato solo tiene `flag` (`fromSerato`); `playlists`, `playlistsBase`, `signatureTag` y `rereadAfterMove` son solo de `WritableProgram`.

Filas provisionales del lado de cues que la Tarea 6 sustituye: `sources.serato: null` en `rekordboxCuesIpc.ts`, `CUE_PROGRAMS.serato` (`saveAllKey` provisional `editor.cues.saveAllMixed`) y `COPY.serato = REKORDBOX_COPY` en `CuesSection.tsx`.

## Pendiente para la fase (b) de Serato (revisión final de la fase (a), 03/11)

Hecho en la fase (b) (04/11):

- Rechazo en el proceso principal de ids `serato:` en `runProcessTrack`.
- Serato en `usedByLibrary`, y si no se puede leer `_Serato_` cuenta como usado.
- Convertir lleva los cues de Serato (`carrySeratoCues`) en el reloj de salida y con el desplazamiento de la conversión.
- Caché por mtime y tamaño de las lecturas de `_Serato_`.
- `isSeratoRunning`: `pgrep` con salida 1 es cerrado; cualquier otro error cuenta como abierto a propósito (nunca escribir con Serato abierto).
- Rejilla leída del `Serato Tempo Map`: cues sobre la onda, pegar al golpe y Auto mark.

Sigue pendiente (fase c):

- Marcar `fromSerato` de forma determinista con `serato:membership` (hoy se marca al abrir un crate de Serato que lista la pista y se queda en la sesión).
- Nombre del proceso de Serato en Windows sin medir.
- Un crate con subcrates se ve como carpeta; sus pistas propias solo por All tracks. Una pista en dos bases de datos cuenta doble.

## Tras el refactor del 10/11

Medido el 11/11 (Tarea 12) con `grep -rnE "(===|!==) '(rekordbox|traktor|engine|serato)'|case '(rekordbox|traktor|engine|serato)'"`, las comparaciones con `programOf(`, `isFrom(x, '<programa>')` y las listas literales de programas, fuera de tests. Cada sitio es (a) una capacidad que otro programa podría tener, y pasa a fila de tabla, o (b) de verdad de un solo programa, y se queda con el motivo.

### Comparaciones a mano

| Sitio | | Motivo | Tabla o por qué se queda |
|---|---|---|---|
| `App.tsx` `cuesOpen` (`engine \|\| traktor \|\| serato`) | a | Abrir el editor de cues desde la playlist abierta de una pestaña. rekordbox ya entraba por `editableOpen`, así que la lista equivale a «cualquier programa». | `CUE_PROGRAMS` (`cuePrograms.ts`) es `Record<DjProgram, …>`: todo programa tiene editor de cues. La condición pasa a `sourceProgram !== null`. |
| `App.tsx` consulta `serato-running` y aviso del árbol (`browser.source === 'serato' && seratoRunning`) | a | La pestaña avisa mientras el programa está abierto, porque sus cambios esperan a que se cierre. | `CUE_PROGRAMS.runningNote` (misma fila que el editor de cues: el aviso es el mismo texto). |
| `CuesSection.tsx` consulta `running('serato')` y aviso `cues-serato-waiting` | a | El editor de cues avisa mientras el programa está abierto. | `CUE_PROGRAMS.runningNote` `{ key, testId }`, como `callsNote`. |
| `CuesSection.tsx` `collectionGate === 'traktor'` (`blocked`, `traktorCollectionInUse`) | a, ya hecha | Programa con colección que confirmar antes de guardar. | Ya es fila (`CUE_PROGRAMS.collectionGate`, bloque 4). La comparación es con la clase de puerta, no con el programa: sus consultas (`traktorCanSave`, `traktorCollectionInUse`, `traktorNmlPath`) son de Traktor y no se generalizan (restricción global). Un segundo programa con colección añade su valor a la unión y sus consultas. |
| `CuesSection.tsx` `rekordboxGrid = programOf(…) === 'rekordbox'` | b | La rejilla propia de rekordbox: sus cues no necesitan `clockLeadMs` medido y sus zonas no cuentan como rejilla variable. | Regla de un solo programa. |
| `CuesSection.tsx` `saveAllKey`, `rekordboxAndEngine` | b | El resto de la etiqueta ya sale de `CUE_PROGRAMS.saveAllKey`; queda el texto `editor.cues.saveAllBoth`, que nombra exactamente la pareja «rekordbox y Engine DJ». Cualquier otra mezcla (también con Serato) da `saveAllMixed`. | Clave de traducción con dos programas en el texto. |
| `App.tsx` `gridEntries` (`programOf === 'rekordbox'`, Traktor y `.mp3`) | b | Qué pistas tienen rejilla que comparar: la de rekordbox, y la regla de reloj de Traktor en MP3. | Reglas medidas por programa (rejilla de rekordbox, reloj de Traktor). |
| `App.tsx` `useUsbVolumes(usbAvailable \|\| usbModal.source !== 'rekordbox')` | b | `usbAvailable` es solo de rekordbox (píldora y avisos de conexión, ver USB 6j); el resto pide volúmenes solo con el modal abierto. | Atado a `usbAvailable`. |
| `Editor.tsx` `reachable` (`id !== 'traktor' \|\| traktorNmlPath !== ''`) | b | La regla de ruta de Traktor. | Regla de un solo programa. |
| `OnboardingWizard.tsx` ruta de Traktor al activarlo y al adoptar carpeta, `PRESELECTED` | b | Solo Traktor rellena su ruta desde la detección; los preseleccionados son una decisión de producto (un programa ausente queda sin preseleccionar, que es lo seguro). | Asistente de bienvenida (ver Ajustes 8). |
| `OnboardingWizard.tsx` `library.id === 'engine'` | b | Selector de carpeta de Engine (`EngineLibraryFields`). | Asistente de bienvenida. |
| `RowWave.tsx` `unanalyzed === 'engine'` | b | Elige el texto de `unanalysedIn`, que solo devuelve `'rekordbox' \| 'engine'`. | Sigue a `unanalysedIn`. |
| `triage.ts` `unanalysedIn`, `attentionOffered`, `matches`, recuento | b | Señales de análisis de cada programa (rekordbox sin `analysisPath`, Engine con `unanalysed`); los ids de filtro `unanalysedRekordbox`/`unanalysedEngine` son de ajustes guardados. | Ids de ajustes guardados. |
| `revealCue.ts` `revealStep` (`view.source !== 'rekordbox'`) | b | Revela por `contentId` de rekordbox (sin prefijo) en su Recently Added; los demás programas usan `revealTrackStep`, que ya recibe el programa. | Ids de rekordbox. |
| `main/damageRepair.ts` `allowed` (`target !== 'traktor'`) | b | La regla de `treeFile` de Traktor (ver 7). | Ya apuntada. |
| `main/verifyRegistry.ts` `neverWritten` (`place === 'traktor'`) | b | La comprobación de Traktor se basa en parches (ver 7). | Ya apuntada. |
| `main/usbExport.ts` `holder.by === 'rekordbox'` | b | Aviso `rekordboxExport`: el USB lo exportó rekordbox mismo. | Aviso de un solo programa. |
| `main/usbExportIpc.ts` `from === 'engine'` | b | La memoria de Engine en `usb:pickFolder` (ver USB 6j). | Ya apuntada. |
| `isFrom(x, 'serato')` en `processTrack.ts`, `useTrackProcessing.ts`, `batch.ts`, `listReviewSource.ts`, `Editor.tsx` | b | Serato no convierte (`seratoBlocked`, recuento `serato` de `batch.ts`). | Consecuencia de `WritableProgram = Exclude<DjProgram, 'serato'>`, hueco que la spec deja fuera («Serato sin `WritableProgram`»). Se van al escribir Serato. |
| `scenarios/` (`harness.tsx`, `matrix/oracle.ts`, `matrix/run.ts`) | b | El arnés lee la base real de cada programa para comprobar. | Código de pruebas, no de la app. |
| `main/libraryFlushes.ts` `SYNC_ISSUE_PROGRAMS` (`new Set(['rekordbox', 'engine'])`) | b, apunte | Lista de quién emite avisos de sincronización (bloque 5). El compilador no la exige, pero su ausencia es lo seguro (sin evento); la tabla del renderer (`SYNC_ISSUES` de `App.tsx`) sí es `Record`. | Fuera del inventario de esta tarea. |

Hecho (11/11): `CUE_PROGRAMS.runningNote` lo leen el editor de cues (`463a2a76f`) y el aviso del árbol de `App.tsx` (`0afaf4862`); `cuesOpen` ya no nombra programas (`73c3f2404`). Tests de caracterización nuevos: un track de rekordbox, Traktor o Engine DJ no avisa ni pregunta `running` con su programa abierto (`CuesSection.serato.test.tsx`), y la pestaña de Traktor tampoco (`App.test.tsx`). Mutaciones: dar `runningNote` a rekordbox o a Traktor, quitárselo a Serato, o sacar cualquiera de los cuatro programas de `cuesOpen`, hace caer tests. Resultado: 3 sitios (a) pasados a tabla, 1 (a) ya era fila (`collectionGate`), 17 (b) se quedan (más `programOf`, Paso 3).

Las demás listas literales de programas pasan por `programsInOrder`/`writableInOrder`, que exigen a todos. `LEGACY_PLAYLIST_ORDER` (`sessionLegacy.ts`) es la forma antigua, congelada a propósito.

### `programOf` (Paso 3)

Se queda el caso por defecto a `'rekordbox'`: los ids de rekordbox no llevan prefijo, así que quitarlo exigiría reconocerlos por forma o devolver `undefined`, y cualquier id sin prefijo (también uno raro) cambiaría de resultado. Un programa nuevo añade su `is<Programa>Content` antes del caso por defecto.

### La lista «Añadidos a mano», entrada por entrada

| Entrada | Estado |
|---|---|
| `programOf` caso por defecto | Se queda (Paso 3). |
| `PLACE_ORDER` | Resuelta: `['file', 'appleMusic', ...PLACE_PROGRAMS]` con `writableInOrder`. |
| `saveAllKey` | Resuelta salvo la pareja `saveAllBoth` (b, arriba). |
| `collectionGate` con consultas de Traktor | Fila de tabla; las consultas se quedan (restricción global). |
| USB `useUsbVolumes(... === 'engine')` | Hoy `!== 'rekordbox'`, atada a `usbAvailable` (b, arriba). La fuente del modal ya va por `UsbProgram`. |
| Banderas `from*`, campos `*Playlists(Base)` | Resueltas en el bloque 6 (`programs`/`playlists`, `isFrom`); la forma antigua solo vive en `sessionLegacy.ts`. |
| Ajustes `*PlaylistsFieldOffered` | Claves guardadas (no se renombran); las reparten `OFFERED` y `PLAYLISTS_FIELD_OFFERED` con `satisfies Record<LibraryProgram, …>`. |
| `useTrackLibrary` bandera de filas nuevas | Resuelta: `SOURCE_PROGRAMS.marksOrigin`. |
| Invalidaciones de membership | Resueltas: `SOURCE_PROGRAMS.membershipKey`. Las claves `rekordbox-track-cues`/`rekordbox-queued-cues` son de las cues de todos los programas (nombre heredado). |
| `cuesOpen` en `App.tsx` | Resuelta en esta tarea (a, arriba). |
| Claves de traducción por plantilla | Se quedan (no objetivo de la spec). `keys.test.ts` compara es/en; una clave que falte para un programa nuevo solo se ve en pantalla. |
| `repointEngineQueued` y `'rekordbox-running'` | `repointEngineQueued` ya no existe; cada vaciado declara su `runningReason` (`libraryRepointFlush.ts`). `'rekordbox-running'` sigue siendo un motivo de rechazo compartido con nombre heredado (`traktorCuesWrite.ts` traduce `traktor-running` a él). |
| `ConversionQueues` con claves fijas | Se queda: `traktor?`, `engine?`, `serato?` son opcionales y el compilador no exige al programa nuevo. Es escritura al convertir, hueco que la spec deja fuera. |
| Añadir durante el trabajo (solo Engine), `libraryGenresOf` | Se quedan (escritura al convertir; un programa que lo necesite añade su paso). |
| Renderer tras convertir (6h-6i), USB (6j), Comprobación (7), Ajustes (8) | Sin cambios: siguen siendo de un programa por los motivos ya escritos; los sitios que el grep vuelve a encontrar están en la tabla de arriba. |

## Errores del compilador

```
src/main/copiesIpc.test.ts:110 TS2741
src/main/copiesIpc.test.ts:119 TS2741
src/main/copiesIpc.test.ts:140 TS2741
src/main/copiesIpc.test.ts:164 TS2741
src/main/copiesIpc.test.ts:181 TS2741
src/main/copiesIpc.test.ts:196 TS2741
src/main/copiesIpc.test.ts:218 TS2741
src/main/copiesIpc.test.ts:250 TS2741
src/main/copiesIpc.test.ts:262 TS2741
src/main/copiesIpc.test.ts:283 TS2741
src/main/copiesIpc.test.ts:310 TS2741
src/main/copiesIpc.test.ts:342 TS2741
src/main/copiesIpc.test.ts:356 TS2741
src/main/copiesIpc.test.ts:381 TS2741
src/main/copiesIpc.test.ts:99 TS2741
src/main/damageIpc.ts:32 TS2322
src/main/damageRepair.ts:237 TS2322
src/main/damageRepair.ts:244 TS2345
src/main/damageScan.ts:20 TS2741
src/main/damageScan.ts:223 TS2741
src/main/damageWiring.ts:63 TS2741
src/main/djProcesses.test.ts:172 TS7053
src/main/djProcesses.test.ts:35 TS2741
src/main/djProcesses.test.ts:38 TS2741
src/main/djProcesses.ts:131 TS2741
src/main/djProcesses.ts:142 TS2322
src/main/djProcesses.ts:17 TS2741
src/main/djProcesses.ts:19 TS2536
src/main/djProcesses.ts:21 TS2741
src/main/djProcesses.ts:34 TS2344
src/main/djProcesses.ts:37 TS2741
src/main/djProcesses.ts:76 TS2344
src/main/djProcesses.ts:77 TS2536
src/main/djProcesses.ts:82 TS2741
src/main/duplicateReplace.ts:18 TS2345
src/main/duplicateReplace.ts:67 TS2741
src/main/index.ts:1326 TS2741
src/main/index.ts:1463 TS2741
src/main/index.ts:1494 TS2741
src/main/index.ts:1505 TS2741
src/main/index.ts:1519 TS2741
src/main/index.ts:1551 TS2741
src/main/index.ts:1564 TS2741
src/main/index.ts:1997 TS2741
src/main/index.ts:325 TS2741
src/main/index.ts:474 TS2741
src/main/libraryFileUse.test.ts:104 TS2741
src/main/libraryFileUse.test.ts:105 TS2741
src/main/libraryFileUse.test.ts:120 TS2741
src/main/libraryFileUse.test.ts:123 TS2741
src/main/libraryFileUse.test.ts:131 TS2741
src/main/libraryFileUse.test.ts:132 TS2741
src/main/libraryFileUse.test.ts:139 TS2741
src/main/libraryFileUse.test.ts:149 TS2741
src/main/libraryFileUse.test.ts:174 TS2345
src/main/libraryFileUse.test.ts:177 TS2741
src/main/libraryFileUse.test.ts:183 TS2741
src/main/libraryFileUse.test.ts:196 TS2741
src/main/libraryFileUse.test.ts:222 TS2741
src/main/libraryFileUse.test.ts:230 TS2741
src/main/libraryFileUse.test.ts:235 TS2741
src/main/libraryFileUse.test.ts:240 TS2741
src/main/libraryFileUse.test.ts:253 TS2741
src/main/libraryFileUse.test.ts:258 TS2741
src/main/libraryFileUse.test.ts:266 TS2741
src/main/libraryFileUse.test.ts:268 TS2741
src/main/libraryFileUse.test.ts:271 TS2741
src/main/libraryFileUse.test.ts:312 TS2741
src/main/libraryFileUse.test.ts:338 TS2741
src/main/libraryFileUse.test.ts:354 TS2741
src/main/libraryFileUse.test.ts:368 TS2741
src/main/libraryFileUse.test.ts:381 TS2741
src/main/libraryFileUse.test.ts:396 TS2741
src/main/libraryFileUse.test.ts:408 TS2741
src/main/libraryFileUse.test.ts:419 TS2741
src/main/libraryFileUse.test.ts:425 TS2741
src/main/libraryFileUse.test.ts:482 TS2741
src/main/libraryFileUse.test.ts:497 TS2741
src/main/libraryFileUse.test.ts:506 TS2741
src/main/libraryFileUse.test.ts:84 TS2741
src/main/libraryFileUse.test.ts:89 TS2741
src/main/libraryFileUse.test.ts:90 TS2741
src/main/libraryFileUse.test.ts:96 TS2741
src/main/libraryFileUse.ts:155 TS2741
src/main/libraryFileUse.ts:19 TS2345
src/main/libraryFileUse.ts:279 TS2741
src/main/libraryFileUse.ts:42 TS2741
src/main/libraryFlushes.test.ts:1010 TS2741
src/main/libraryFlushes.test.ts:129 TS7053
src/main/libraryFlushes.test.ts:176 TS2741
src/main/libraryFlushes.test.ts:189 TS2741
src/main/libraryFlushes.test.ts:203 TS2741
src/main/libraryFlushes.test.ts:242 TS2741
src/main/libraryFlushes.test.ts:263 TS2741
src/main/libraryFlushes.test.ts:279 TS2741
src/main/libraryFlushes.test.ts:294 TS2741
src/main/libraryFlushes.test.ts:312 TS2741
src/main/libraryFlushes.test.ts:346 TS2741
src/main/libraryFlushes.test.ts:353 TS2741
src/main/libraryFlushes.test.ts:365 TS2741
src/main/libraryFlushes.test.ts:374 TS2741
src/main/libraryFlushes.test.ts:381 TS2741
src/main/libraryFlushes.test.ts:392 TS2741
src/main/libraryFlushes.test.ts:400 TS2741
src/main/libraryFlushes.test.ts:416 TS2741
src/main/libraryFlushes.test.ts:439 TS2741
src/main/libraryFlushes.test.ts:472 TS2741
src/main/libraryFlushes.test.ts:588 TS2741
src/main/libraryFlushes.test.ts:700 TS2741
src/main/libraryFlushes.test.ts:706 TS2741
src/main/libraryFlushes.test.ts:715 TS2741
src/main/libraryFlushes.test.ts:722 TS2741
src/main/libraryFlushes.test.ts:734 TS2741
src/main/libraryFlushes.test.ts:738 TS2741
src/main/libraryFlushes.test.ts:756 TS2741
src/main/libraryFlushes.test.ts:783 TS2741
src/main/libraryFlushes.test.ts:810 TS2741
src/main/libraryFlushes.test.ts:849 TS2741
src/main/libraryFlushes.test.ts:875 TS2741
src/main/libraryFlushes.test.ts:920 TS2741
src/main/libraryFlushes.test.ts:942 TS2741
src/main/libraryFlushes.test.ts:955 TS2741
src/main/libraryFlushes.test.ts:965 TS2741
src/main/libraryFlushes.ts:120 TS2741
src/main/libraryFlushes.ts:228 TS2536
src/main/libraryFlushes.ts:237 TS2345
src/main/libraryFlushes.ts:253 TS2741
src/main/libraryFlushes.ts:278 TS2536
src/main/libraryFlushes.ts:53 TS2741
src/main/libraryFlushes.ts:576 TS2741
src/main/libraryFlushes.ts:59 TS2741
src/main/libraryFlushes.ts:692 TS2741
src/main/libraryStatus.ts:22 TS2741
src/main/libraryTagSync.test.ts:16 TS2741
src/main/libraryTagSync.test.ts:47 TS2741
src/main/libraryTagSync.test.ts:64 TS2741
src/main/libraryTagSync.test.ts:81 TS2741
src/main/libraryTagSync.ts:6 TS2345
src/main/moments.test.ts:20 TS2741
src/main/moments.test.ts:33 TS2741
src/main/processTrack.ts:1154 TS2322
src/main/processTrack.ts:503 TS2741
src/main/programQueue.test.ts:42 TS2741
src/main/programQueue.test.ts:57 TS2345
src/main/rekordboxBatch.ts:157 TS2741
src/main/rekordboxBatch.ts:166 TS2741
src/main/rekordboxCuesIpc.ts:26 TS2345
src/main/rekordboxCuesIpc.ts:55 TS2741
src/main/retireSuperseded.test.ts:16 TS2741
src/main/usbExportIpc.ts:193 TS2345
src/main/usbExportRoute.test.ts:25 TS2345
src/main/usbExportRoute.test.ts:35 TS2345
src/main/usbExportRoute.test.ts:39 TS2345
src/main/usbExportRoute.test.ts:46 TS2345
src/main/verifyIpc.ts:210 TS2741
src/main/verifyIpc.ts:234 TS7053
src/main/verifyIpc.ts:235 TS7053
src/main/verifyRegistry.ts:112 TS2322
src/main/verifyRegistry.ts:116 TS2741
src/main/verifyRegistry.ts:163 TS2741
src/main/verifyRegistry.ts:171 TS2741
src/main/verifyRegistry.ts:292 TS2741
src/main/verifyRegistry.ts:336 TS7053
src/main/verifyRegistry.ts:350 TS7053
src/main/verifyRegistry.ts:93 TS2741
src/renderer/src/App.tsx:231 TS2345
src/renderer/src/App.tsx:232 TS2741
src/renderer/src/App.tsx:3485 TS2741
src/renderer/src/App.tsx:419 TS7053
src/renderer/src/App.tsx:423 TS2741
src/renderer/src/App.tsx:858 TS2741
src/renderer/src/components/CuesBatchSection.tsx:28 TS2741
src/renderer/src/components/CuesSection.tsx:175 TS2741
src/renderer/src/components/CuesSection.tsx:309 TS2741
src/renderer/src/components/Editor.test.tsx:839 TS2741
src/renderer/src/components/Editor.test.tsx:885 TS2741
src/renderer/src/components/Editor.test.tsx:894 TS2741
src/renderer/src/components/Editor.test.tsx:900 TS2741
src/renderer/src/components/Editor.test.tsx:908 TS2741
src/renderer/src/components/Editor.test.tsx:919 TS2741
src/renderer/src/components/Editor.test.tsx:928 TS2741
src/renderer/src/components/Editor.tsx:1127 TS2741
src/renderer/src/components/Editor.tsx:129 TS2345
src/renderer/src/components/Editor.tsx:130 TS2345
src/renderer/src/components/MusicReview.test.tsx:1100 TS2741
src/renderer/src/components/MusicReview.test.tsx:119 TS2741
src/renderer/src/components/MusicReview.test.tsx:1250 TS2741
src/renderer/src/components/MusicReview.test.tsx:1275 TS2741
src/renderer/src/components/MusicReview.test.tsx:1293 TS2741
src/renderer/src/components/MusicReview.test.tsx:1300 TS2741
src/renderer/src/components/MusicReview.test.tsx:1310 TS2741
src/renderer/src/components/MusicReview.test.tsx:1311 TS2741
src/renderer/src/components/MusicReview.test.tsx:1338 TS2741
src/renderer/src/components/MusicReview.test.tsx:1369 TS2741
src/renderer/src/components/MusicReview.test.tsx:1380 TS2741
src/renderer/src/components/MusicReview.test.tsx:1443 TS2741
src/renderer/src/components/MusicReview.test.tsx:1782 TS2741
src/renderer/src/components/MusicReview.test.tsx:1811 TS2741
src/renderer/src/components/MusicReview.test.tsx:1834 TS2741
src/renderer/src/components/MusicReview.test.tsx:1857 TS2741
src/renderer/src/components/MusicReview.test.tsx:2596 TS2741
src/renderer/src/components/MusicReview.test.tsx:2610 TS2741
src/renderer/src/components/MusicReview.test.tsx:2622 TS2741
src/renderer/src/components/MusicReview.test.tsx:2643 TS2741
src/renderer/src/components/MusicReview.test.tsx:2696 TS2741
src/renderer/src/components/MusicReview.test.tsx:677 TS2741
src/renderer/src/components/MusicReview.test.tsx:688 TS2741
src/renderer/src/components/MusicReview.test.tsx:699 TS2741
src/renderer/src/components/MusicReview.test.tsx:716 TS2741
src/renderer/src/components/MusicReview.test.tsx:741 TS2741
src/renderer/src/components/MusicReview.test.tsx:815 TS2741
src/renderer/src/components/MusicReview.test.tsx:831 TS2322
src/renderer/src/components/MusicReview.test.tsx:858 TS2741
src/renderer/src/components/MusicReview.test.tsx:879 TS2741
src/renderer/src/components/MusicReview.test.tsx:900 TS2741
src/renderer/src/components/MusicReview.test.tsx:923 TS2741
src/renderer/src/components/MusicReview.test.tsx:937 TS2741
src/renderer/src/components/MusicReview.test.tsx:959 TS2741
src/renderer/src/components/MusicReview.test.tsx:975 TS2741
src/renderer/src/components/MusicReview.test.tsx:989 TS2741
src/renderer/src/components/settings/CuesTab.tsx:77 TS2741
src/renderer/src/components/settings/GeneralTab.tsx:44 TS2741
src/renderer/src/components/settings/GeneralTab.tsx:50 TS2741
src/renderer/src/components/SourceIcons.tsx:73 TS2741
src/renderer/src/components/SourceRail.tsx:11 TS2741
src/renderer/src/components/UsbExportModal.tsx:63 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1066 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1067 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1080 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1081 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1099 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1100 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1101 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1116 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1117 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:54 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:66 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:101 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:113 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:153 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:173 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:91 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.ts:25 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.ts:91 TS7053
src/renderer/src/hooks/useRekordboxPlaylists.ts:97 TS7053
src/renderer/src/hooks/useRekordboxQueue.ts:65 TS2741
src/renderer/src/hooks/useSourceBrowser.ts:134 TS2741
src/renderer/src/lib/cuePrograms.ts:17 TS2741
src/renderer/src/lib/cueTwins.ts:54 TS2741
src/renderer/src/lib/djLibraries.ts:18 TS2345
src/renderer/src/lib/djReach.ts:13 TS2345
src/renderer/src/lib/fields.ts:147 TS2741
src/renderer/src/lib/reviewLibraries.ts:3 TS2741
src/renderer/src/lib/reviewLibraries.ts:9 TS2345
src/renderer/src/lib/sourcePrograms.ts:21 TS2741
src/renderer/src/lib/sourcePrograms.ts:72 TS2741
src/renderer/src/lib/trackPrograms.ts:15 TS2741
src/renderer/src/lib/trackPrograms.ts:41 TS2345
src/renderer/src/test/api.ts:186 TS2322
src/renderer/src/test/api.ts:191 TS2322
src/scenarios/harness.tsx:517 TS2741
src/scenarios/harness.tsx:523 TS2741
src/scenarios/harness.tsx:530 TS7053
src/scenarios/harness.tsx:551 TS7053
src/scenarios/harness.tsx:772 TS2741
src/scenarios/harness.tsx:801 TS2741
src/scenarios/harness.tsx:829 TS2741
src/scenarios/harness.tsx:950 TS2741
src/scenarios/harness.tsx:959 TS2741
src/scenarios/matrix/cells.ts:360 TS2741
src/scenarios/matrix/cells.ts:91 TS2741
src/scenarios/matrix/libraries.ts:26 TS2345
src/scenarios/matrix/libraries.ts:384 TS2741
src/scenarios/matrix/oracle.ts:1077 TS2741
src/scenarios/matrix/oracle.ts:569 TS2741
src/scenarios/matrix/oracle.ts:66 TS2345
src/scenarios/matrix/realLibraries.ts:753 TS2741
src/scenarios/matrix/report.ts:72 TS2741
src/shared/djProgram.test.ts:16 TS2345
src/shared/djProgram.ts:6 TS2345
src/shared/djProgram.ts:8 TS2345
src/shared/djSettings.ts:15 TS2741
src/shared/djSettings.ts:3 TS2741
src/shared/keepsReplaced.ts:3 TS2741
src/shared/verification.ts:93 TS2345
```
