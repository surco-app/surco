# Una sola puerta para los programas de DJ (refactor previo a VirtualDJ)

## Por qué

Surco trabaja con rekordbox, Traktor, Engine DJ y Serato, y el siguiente es VirtualDJ para
cubrir los programas más usados. Con Serato (03/11) los cuatro pasaron a declararse en tablas
tipadas por programa (`Record<DjProgram, …>`, `programsInOrder`), y añadir `'virtualdj'` a
`DjProgram` hace que el compilador señale casi todo lo que hay que decidir. Pero tres cosas
siguen escritas a mano por programa, y son las que encarecen cada programa nuevo.

1. **La API entre procesos.** De los 240 métodos de `window.api`, 83 llevan el nombre de un
   programa (`seratoAvailable`, `loadSeratoTree`, `applySeratoCueQueue`…), con su canal
   (`serato:*`) y su handler. Serato añadió unos 26 métodos al preload.
2. **Los campos por programa en los tipos compartidos.** `fromRekordbox`, `fromEngine`,
   `fromTraktor`, `fromSerato` y los ocho `{rekordbox,traktor,engine,serato}Playlists(Base)` en
   `TrackItem`, `SessionEdit` (`shared/types.ts:617`) y el trabajo de conversión. Se guardan en
   la sesión.
3. **Lo que el compilador no ve**: comparaciones `=== 'serato'` sueltas (entre 4 y 9 por
   programa fuera de tests), el host de cues de `main/rekordboxCuesIpc.ts` con un sub-objeto
   opcional por programa, y el resto de la lista "añadidos a mano" de
   `docs/superpowers/plans/2026-11-03-serato-mapa.md`.

Decisiones del usuario (10/11): VirtualDJ tiene que "entrar limpio", así que este refactor va
antes; "todo con tests para no romper nada".

## Objetivo, y cómo se mide

Añadir un programa de DJ consiste en escribir su módulo en el proceso principal y rellenar sus
filas en las tablas por programa. Ni el preload ni `preload/api.ts` ganan métodos, y los tipos
de pista, sesión y trabajo de conversión (`TrackItem`, `SessionEdit`, el job) no ganan campos con
el nombre del programa.

Excepción, decisión mía: los ajustes guardados (`Settings` en `shared/types.ts`) sí ganan las
claves del programa nuevo (`addToX`, `syncX`, la ruta de su biblioteca), porque son datos del
usuario con nombre fijo, igual que las claves de traducción, y ya las exige una tabla
(`DJ_REACH_SETTINGS`, `DJ_COLLECTION_PATH`). Pasarlas a un ajuste indexado por programa solo
para los nuevos mezclaría dos convenciones.

**Prueba de fuego** al final (criterio de aceptación): en una rama que se tira, añadir
`'virtualdj'` a `DjProgram` con un módulo de lectura falso que devuelve un árbol fijo. Debe
compilar tocando solo el módulo, las filas de tabla que el compilador pida y las traducciones,
y la pestaña debe aparecer en la app. El resultado (ficheros tocados y líneas) se apunta en
este documento.

## Objetivos

1. Una llamada por operación que recibe el programa, en lugar de una por programa.
2. Los campos por programa de los tipos compartidos pasan a uno solo, indexado por programa.
3. Las comparaciones a mano y el host de cues pasan a tablas por programa.
4. Que nada de lo que hoy funciona en los cuatro programas cambie.

## No objetivos

- Añadir VirtualDJ. Tiene su propio documento, que se escribe con las medidas de su
  `database.xml` y sus `.vdjfolder`.
- Rellenar los huecos entre programas (Engine sin `collection` ni edición de playlists, Traktor
  sin USB propio, Serato sin `WritableProgram`). Siguen siendo capacidades opcionales.
- Cambiar las claves de los ajustes guardados (`addToSerato`, `traktorNmlPath`, `syncEngineDj`…)
  o las claves de traducción por programa. Ya las reparten tablas (`DJ_REACH_SETTINGS`,
  `DJ_COLLECTION_PATH`); cambiar su nombre obligaría a migrar ajustes sin ganar nada.
- Generalizar lo que es solo de rekordbox de verdad (completar al cerrar, aprender del usuario,
  la cola amplia de `rekordboxQueue`, `rekordboxCollection`).
- Los métodos de Apple Music.

## Antiobjetivos

- Un refactor que cambie comportamiento. Si un test tiene que cambiar lo que afirma, el bloque
  no es puro y se para.
- Un refactor a medias. Cada bloque queda terminado, verde y mergeable por sí solo. Durante el
  refactor pueden convivir métodos viejos y nuevos, pero ningún bloque deja un método nuevo sin
  usar ni uno viejo sin quitar dentro de su familia.
- Perder datos de una sesión guardada por la versión anterior.

## Diseño

### 1. Llamadas que reciben el programa

Las familias que hoy se repiten pasan a un espacio `window.api.dj` con el programa como primer
argumento, un canal `dj:<operación>` y un reparto en el proceso principal por una tabla
`Record<DjProgram, …>`. Si falta una fila, el compilador lo exige.

| Familia | Hoy | Después |
|---|---|---|
| Lectura (×4) | `xAvailable`, `loadXTree`, `xRecentCount`, `xTrackCount`, `loadXPlaylist`, `loadXCollection`, `xMembership` | `dj.available(p)`, `dj.tree(p)`, `dj.recentCount(p)`, `dj.trackCount(p)`, `dj.playlist(p, id)`, `dj.collection(p)`, `dj.membership(p, paths)` |
| Edición de playlists (×3) | `editXPlaylist`, `xHasSeparator` | `dj.editPlaylist(p, edit, label)`, `dj.hasSeparator(p)` |
| Cola de cues (×3) | `xCueQueue`, `applyXCueQueue`, `discardXCueQueue`, `xCueQueueReady`, `onXCueQueueChanged`, `onXCueQueueApplied` | `dj.cueQueue(p)`, `dj.applyCueQueue(p)`, `dj.discardCueQueue(p)`, `dj.cueQueueReady(p)`, `dj.onCueQueueChanged(p, cb)`, `dj.onCueQueueApplied(p, cb)` |
| Sueltos | `exportX` (×3), `pickXPath` (×3), `onXSyncIssue` (×2), `seratoRunning` | `dj.export(p, …)`, `dj.pickLibraryPath(p)`, `dj.onSyncIssue(p, cb)`, `dj.running(p)` |

- **Capacidades opcionales.** Un programa sin una operación (Engine sin `collection`) no tiene
  fila en la tabla de esa operación del proceso principal, y el renderer lo sabe sin preguntar
  por IPC: sigue decidiendo con sus tablas actuales (`SOURCE_READ`, `SOURCE_PROGRAMS`), que
  pasan a llamar a `window.api.dj`. Llamar a una operación que un programa no tiene rechaza con
  un error claro.
- **Eventos.** Un canal por evento (`dj:cueQueueChanged`) con el programa en el mensaje; el
  `on…(p, cb)` del preload filtra por programa y devuelve la función de baja como hoy.
- **Las familias que no se repiten** se quedan como están, con su nombre de programa:
  `traktorCollectionInUse`, `traktorCanSave`, `detectTraktorNmlPath`, `loadEngineLibrary`,
  `rekordboxCollection` y la cola amplia de rekordbox.

### 2. El editor de cues, con su nombre real

Los métodos `rekordbox*` del editor de cues (`rekordboxTrackCues`, `saveRekordboxCues`,
`rekordboxCueTwins`, `rekordboxCueWaveDetail`, `rekordboxQueuedCues`, `undoRekordboxCues`…)
ya sirven a los cuatro programas: su handler reparte con `programOf(contentId)`
(`main/rekordboxCuesIpc.ts:73`). Pasan a `window.api.cues.*` y canales `cues:*` sin cambiar su
forma. Antes de mover cada uno se comprueba que reparte por `programOf`; el que solo sirva a
rekordbox se queda con su nombre.

El host de `registerRekordboxCuesIpc` (sub-objetos `engine?`, `traktor?`, `serato?`) pasa a una
tabla por programa, para que un programa nuevo sea una fila y no un campo nuevo del host.

### 3. Un campo por programa en los tipos compartidos

- `fromRekordbox/fromEngine/fromTraktor/fromSerato` pasan a `programs?: DjProgram[]` (la
  pista llegó desde esos programas). Una función `isFrom(track, program)` sustituye las
  lecturas.
- Los ocho `xPlaylists`/`xPlaylistsBase` pasan a `playlists?: Partial<Record<LibraryProgram,
  { targets?: RekordboxPlaylistTarget[]; base?: string[] }>>`, con los dos opcionales por
  separado (decisión mía). Hoy cada uno se copia por su lado (`copyPlaylists` en
  `renderer/src/lib/trackPrograms.ts`), "sin `targets`" significa "no tocar las playlists"
  (`JOB_PLAYLISTS`, `main/processTrack.ts:520`) y en rekordbox un `base` ausente sigue ausente
  mientras los otros tres reciben `[]`. Cada uno de esos casos se fija con un test de
  caracterización antes de mover el campo y se conserva tal cual.
- **Sesiones guardadas.** Al leer una sesión, una función pura convierte los campos viejos a
  los nuevos. Un test fija la lectura de una sesión guardada por la versión actual, con los
  cuatro programas, campo a campo.
- **Volver a una versión anterior** (decisión mía, el usuario lo dejó a mi criterio): al
  escribir la sesión se guardan los campos nuevos y, además, los viejos de los cuatro programas
  actuales, derivados de los nuevos en una sola función. Así una versión anterior (salir de una
  beta, otro Mac sin actualizar) sigue viendo de qué programa viene cada pista y a qué playlists
  va. Sin esto, una pista de rekordbox abierta en la versión anterior se convertiría como
  fichero suelto y no se repuntaría en rekordbox. Un programa nuevo como VirtualDJ solo escribe
  los campos nuevos, porque ninguna versión anterior lo conoce. Dejar de escribir los viejos es
  un cambio aparte, en una versión posterior, que se apunta como issue al mergear.

### 4. Lo que el compilador no ve

Cada entrada de la lista "añadidos a mano" del mapa de Serato y cada comparación a mano con un
nombre de programa fuera de tests se convierte en fila de tabla por programa, o se apunta en
este documento con el motivo por el que se queda (por ejemplo, una regla que de verdad es de un
solo programa, como la de ruta de Traktor en `reachable`). `programOf` deja de tener un caso
por defecto silencioso a rekordbox si el compilador lo permite sin cambiar comportamiento.

## Cómo no romper nada

- **Antes de mover una familia**, inventariar los tests que la cubren en los cuatro programas
  y añadir tests de caracterización donde falten: fijan lo que hace hoy, también las rarezas.
- **Un test de contrato** por familia: para cada programa y cada operación declarada, el
  preload invoca el canal `dj:*` correcto con el programa, y el proceso principal tiene handler
  y lo reparte a la fila de ese programa. Otro test comprueba que el preload ya no expone los
  nombres viejos de esa familia.
- **Mutación a mano** de cada pieza nueva (el reparto, el filtro de eventos, la migración de la
  sesión): romperla a propósito, ver caer un test, deshacer. `npm run mutate` donde aplique.
- **Cada commit**: suite completa desde `apps/desktop` con salida 0 y sin `Errors`/`Unhandled`,
  los tres typecheck (`tsconfig.web.json`, `tsconfig.node.json`, `tsconfig.scenarios.json`) y
  Biome sin avisos. Los tests existentes solo cambian cómo llaman y cómo simulan `window.api`
  (con `vi.fn<Api['dj']['tree']>()` y similares), nunca lo que afirman.
- **Matriz** (`npm run matrix`) al final de cada bloque, comparada celda a celda con una base
  medida al empezar sobre la rama. Ninguna celda puede cambiar.
- **Prueba manual** al final de cada bloque, la hace Claude con el driver sin esperar al usuario
  (como se decidió con Serato), contra las bibliotecas reales de los cuatro programas, que están
  instalados en este Mac (rekordbox 7, Traktor Pro 4, Engine DJ, Serato DJ Pro), con los programas cerrados y con la copia de seguridad de Surco hecha antes
  de cualquier escritura: abrir cada pestaña, abrir una playlist, editar una playlist, abrir el
  editor de cues y guardar un cue, según lo que toque el bloque.

## Orden por bloques

1. Lectura (la familia más usada y la que más tests tiene).
2. Edición de playlists.
3. Cola de cues y sus eventos.
4. El editor de cues con su nombre real, y su host en tabla.
5. Sueltos: exportar, elegir ruta, avisos de sincronización, `running`.
6. Campos de los tipos compartidos y la migración de la sesión.
7. Lo que el compilador no ve.
8. Prueba de fuego con el programa falso, y el mapa actualizado con el resultado.

Cada bloque en el worktree `dj-interfaz`, mergeado a main local al terminar (sin push).

## Lo que queda al constructor

- Los nombres exactos de las operaciones y canales, siguiendo la tabla de arriba.
- La forma de la tabla del proceso principal (un objeto por programa con operaciones opcionales,
  o una tabla por familia), siempre que el compilador exija la fila de un programa nuevo.
- Dónde vive `isFrom` y la migración de la sesión.

## Resultado de la prueba de fuego

Hecha el 11/11 (Tarea 13) en la rama desechable `dj-interfaz-prueba`, desde `474b6891c`. VirtualDJ entra solo como lectura. No es `WritableProgram`, no tiene edición, ni cola de cues, ni exportar, ni USB. El módulo falso devuelve una playlist «Pruebas» con dos pistas reales (`~/Music/VirtualDJ Pruebas/Pray.mp3` y `Pray.flac`).

### Qué se tocó

`git diff --stat dj-interfaz`, 68 ficheros, 333 líneas añadidas y 91 quitadas. Por grupos.

| Grupo | Ficheros | Líneas (+/-) |
|---|---|---|
| Módulo (`main/virtualdjPlaylistsIpc.ts`, `shared/virtualdjContent.ts`, el icono en `SourceIcons.tsx`) | 3 | +52 |
| Filas de tabla que pidió el compilador (código de la app, sin tests) | 33 | +125 / -17 |
| Traducciones (7 claves en los 6 idiomas) | 6 | +72 / -30 (las 30 son la coma que gana la línea anterior) |
| Tests y `test/api.ts` (fixtures con la fila nueva) | 26 | +84 / -44 |

Dentro de las filas pedidas hay tres cosas que no son una fila, y conviene saberlas antes de VirtualDJ de verdad.

- **Cuatro ajustes guardados nuevos** en `Settings` (`addToVirtualdj`, `syncVirtualdj`, `cueFlowToVirtualdj`, `virtualdjPlaylistsFieldOffered`), con sus valores por defecto en `main/settings.ts`, `settingsContext.tsx`, `settingsDraft.ts` y `test/api.ts`. Los exigen `DJ_REACH_SETTINGS`, `FLOW_TO` y `OFFERED`/`PLAYLISTS_FIELD_OFFERED`, que están tipadas sobre `DjProgram`/`LibraryProgram` y no sobre `WritableProgram`. La spec ya contaba con `addToX` y `syncX`; un programa de solo lectura los arrastra igual.
- **`UsbProgram` estrechado** (`Exclude<DjProgram, 'virtualdj'>` en `shared/types.ts`). `UsbProgram = DjProgram` y `SOURCE_PROGRAMS.usb` es `P extends UsbProgram ? true : false`, así que sin tocar el tipo la fila obliga a `usb: true` y a una vista en `USB_PROGRAM_VIEW`. Es una línea de tipo, no una fila.
- **Filas de escritura y de cola sin hueco para «no tiene»**, rellenadas con objetos inertes porque el tipo no admite `null`. Cola de cues en main (`programQueues.virtualdj = { program: 'virtualdj' }`, por `CueProgram = DjProgram`), la píldora de la cola en `App.tsx` (estado vacío y funciones que no hacen nada), `PROGRAM_QUEUES.virtualdj` (una `queueSource` con las palabras de Serato prestadas), `CUE_PROGRAMS.virtualdj` y `COPY.virtualdj` en `CuesSection.tsx` (textos de Serato prestados), `DJ_PROCESSES.virtualdj` (`isRunning` que siempre da `false`), `JOB_PLAYLISTS`, `REPOINT_PLAYLISTS` y `ATTACH_PLAYLISTS` (devuelven `undefined` o el repunte tal cual), el vaciado de etiquetas de `syncTagsInLibraries` (`nothing`) y `libraryStatus` (`enabled: false, found: false`).

### Errores del compilador

Primera pasada, con `'virtualdj'` solo en `DjProgram` (y fuera de `WritableProgram`) salen 134 errores únicos, 52 en código de la app y 82 en tests. Los 52 de la app.

```
src/main/djProcesses.ts:27 TS2741
src/main/index.ts:566 TS2741          programQueues (CueProgram)
src/main/index.ts:1384 TS2741         la tabla DjMainTable
src/main/index.ts:1503 TS2741         sources de registerCuesIpc
src/main/libraryFlushes.ts:712 TS2741
src/main/libraryStatus.ts:27 TS2741
src/main/libraryTagSync.ts:6 TS2345   programsInOrder
src/main/processTrack.ts:525 TS2741
src/main/rekordboxBatch.ts:168 TS2741
src/main/rekordboxBatch.ts:178 TS2741
src/main/usbExportIpc.ts:327 TS7053
src/renderer/src/App.tsx:464 TS7053
src/renderer/src/App.tsx:468 TS2741
src/renderer/src/App.tsx:942 TS2741
src/renderer/src/App.tsx:3981 TS2741
src/renderer/src/components/CuesBatchSection.tsx:27 TS2345
src/renderer/src/components/CuesBatchSection.tsx:28 TS2741
src/renderer/src/components/CuesSection.tsx:191 TS2741
src/renderer/src/components/Editor.tsx:1180 TS2741
src/renderer/src/components/settings/CuesTab.tsx:87 TS2741
src/renderer/src/components/settings/DestinationTab.tsx:643 TS2345
src/renderer/src/components/settings/GeneralTab.tsx:44 TS2741
src/renderer/src/components/settings/GeneralTab.tsx:51 TS2741
src/renderer/src/components/SourceIcons.tsx:92 TS2741
src/renderer/src/components/SourceRail.tsx:11 TS2741
src/renderer/src/components/UsbExportModal.tsx:95 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.ts:26 TS2741 (+4 TS7053 en 92 y 98)
src/renderer/src/hooks/useRekordboxQueue.ts:53 TS2741
src/renderer/src/hooks/useSourceBrowser.ts:140 TS2741
src/renderer/src/lib/cuePrograms.ts:19 TS2741
src/renderer/src/lib/cueTwins.ts:55 TS2741
src/renderer/src/lib/djLibraries.ts:17 TS2345
src/renderer/src/lib/fields.ts:156 TS2741
src/renderer/src/lib/onboarding.ts:172 TS2741 (+1 TS7053 en 184)
src/renderer/src/lib/reviewLibraries.ts:3 TS2741
src/renderer/src/lib/reviewLibraries.ts:14 TS2345
src/renderer/src/lib/sourcePrograms.ts:35 TS2741
src/renderer/src/lib/sourcePrograms.ts:77 TS2741
src/renderer/src/lib/trackPrograms.ts:11 TS2741
src/renderer/src/test/api.ts:311 TS2322
src/renderer/src/test/api.ts:316 TS2322
src/shared/djProgram.ts:13, 15, 24, 26 TS2345 (DJ_PROGRAMS, LIBRARY_PROGRAMS, RAIL_PROGRAMS, CUE_PROGRAMS)
src/shared/djProgram.ts:59 TS2741      CONTENT_OF
src/shared/djSettings.ts:3 TS2741
```

Segunda y tercera pasada, al añadir las cuatro claves de `Settings`, piden filas `main/settings.ts:38`, `settingsContext.tsx:130` y `:193`, `settingsDraft.ts:115`, `CuesTab.tsx:450-451` (`SyncedDraft`), `cueTwins.ts:70` (`TwinSettings`), `CuesBatchSection.tsx:80, 138` y `CuesSection.tsx:755, 761` (`ResolvedSettings` sin `cueFlowToVirtualdj`), `test/api.ts:24`. Los tests piden la misma fila en sus fixtures (82 sitios al principio, sobre todo `MusicReview.test.tsx` con 41, `cueTwins.test.ts` con 22 y `useMusicReview.test.tsx` con 11). Al final los tres `tsc` (web, node, scenarios) quedan limpios.

### Lo que el compilador no pidió

1. **Las traducciones por plantilla.** `sources.virtualdj`, `sources.hide.virtualdj`, `sources.failed.virtualdj`, `sources.notFound.virtualdj`, `sources.gone.virtualdj`, `settings.source.virtualdj` y `settings.sourceVirtualdjUnavailable`, en los 6 idiomas. Se leen con `tr(\`sources.${p}\`)` y similares; sin ellas la pestaña y la casilla salen con la clave en crudo.
2. **La consulta de disponibilidad de la pestaña (`useSourceBrowser.ts`).** El compilador pide la fila de `found`, pero el valor mínimo (`undefined` o `false`) esconde la pestaña. Hizo falta escribir a mano otra `useQuery` como las de Engine, Traktor y Serato.
3. **La sonda de `CuesTab.tsx`.** Igual que la anterior. La fila de `foundBy` se rellenó con `false` y la lista de destinos de las cues muestra «VirtualDJ» como no encontrado; un programa real necesita su `useState`/`useEffect` escrito a mano.
4. **`playlistLibrariesFound` en `App.tsx`.** Pide la fila, pero cada programa llama a `useLibraryAvailable` a mano; con `false` VirtualDJ no ofrece el campo de playlists (correcto para solo lectura, un programa que escriba tiene que añadir la llamada).
5. **El panel de Ajustes, Programas de DJ (`DestinationTab.tsx`).** `PROGRAM_TABS` exige el programa y aparece el botón «VirtualDJ», pero cada panel es un `<div {...panel('traktor')}>` escrito a mano y el de VirtualDJ no existe, así que el botón abre un panel vacío (comprobado con el driver).
6. **El asistente de bienvenida (`OnboardingWizard.tsx`).** Detecta las bibliotecas con un `Promise.all` de cuatro sondas fijas y un objeto `Partial`; VirtualDJ no aparece. No se tocó.
7. **Qué ficheros usa cada biblioteca (`libraryFileUse.ts`, `librariesKeepingOriginal`, `usedByAnyLibrary` en `index.ts`).** Es lo que impide reemplazar, mover a la papelera o dejar sin original un fichero que una biblioteca de DJ referencia. `SyncedLibraries` es `Record<WritableProgram, string>` y Serato entra como clave opcional escrita a mano (`serato?: SeratoLibraryRoot[]`), así que un programa de solo lectura no está protegido y el compilador calla. Es el hueco más serio para VirtualDJ real. No se tocó.
8. **Las gemelas de cues (`libraryTracksOf` en `registerCuesIpc`)**, los duplicados (`duplicateLibraryDeps`) y la revisión de listas (`listReviewDeps`). Reciben `seratoRoots` por argumento propio; VirtualDJ no entra. No se tocó.
9. **El editor de cues de una pista de VirtualDJ.** `cuesOpen` es `sourceProgram !== null` y `CUE_PROGRAMS` tiene fila, así que el editor se abre, pero la fuente de cues es `null` y la cola no existe. No se probó qué pasa al guardar. No se tocó.
10. **Tests que afirman la lista de programas.** Con `tsc` limpio la suite da 17874 pasan, 261 saltados y 16 fallos en 12 ficheros, todos por una lista fija de programas en la afirmación, nunca por un fallo de la app. Órdenes y listas (`djProgram.test.ts` tres, `sourcePrograms.test.ts`, `GeneralTab.test.tsx`, `CuesTab.test.tsx`, `libraryTagSync.test.ts` dos, `libraryStatus.test.ts`, `djReach.test.ts`, `onboarding.test.ts` dos, `OnboardingWizard.test.tsx`), y tres que usan `'virtualdj'` como ejemplo de programa desconocido (`djIpc.test.ts`, `settings.test.ts` y `hiddenSources.test.ts`). Un VirtualDJ real cambia esas afirmaciones y, en los tres últimos, el ejemplo de programa inventado. No se tocaron.

### Criterio

Se cumple. `git diff dj-interfaz` no toca `preload/index.ts` ni `preload/api.ts`, y `TrackItem` (`renderer/src/types.ts`), `SessionEdit` y `ProcessJob` (`shared/types.ts`) no ganan campos; los cambios de `shared/types.ts` son las cuatro claves de `Settings` (la excepción de la spec) y el estrechamiento de `UsbProgram`. El origen de una pista de VirtualDJ viaja en `programs` y `playlists` de `TrackOrigin`, que crecen solos con `DjProgram`; la forma antigua de la sesión (`sessionLegacy.ts`) lo ignora a propósito.

Con el driver (build de la rama desechable, perfil del driver, ningún programa de DJ abierto), la casilla «VirtualDJ» sale en Ajustes, General, Barra lateral (`settings-source-virtualdj`), la pestaña aparece en la barra (`source-rail-virtualdj`), y al abrir «Pruebas» la lista muestra las dos pistas (Pray MP3 y Pray FLAC). Capturas `task13-settings-sidebar.png` y `task13-virtualdj-tab.png` en `.superpowers/sdd/2026-11-10-programas-dj-interfaz/` (no versionado).

Para VirtualDJ real queda estrechar a `WritableProgram` las tablas de escritura que hoy son de `DjProgram` (o aceptar que un programa de solo lectura las rellene en vacío), dar a `CueProgram` un hueco para «sin cola», y pasar a tabla las sondas de disponibilidad (puntos 2 a 4) y el uso de ficheros por biblioteca (punto 7).

## Después de este refactor

1. El diseño de VirtualDJ con sus medidas, completo como los demás programas: pestaña con
   biblioteca y playlists, editor de cues que guarda, edición de playlists, pegar un tracklist,
   sesión automática, añadir lo convertido, sincronizar etiquetas, repuntar y USB.
2. Una skill en `.claude/skills/` del repo para añadir un programa de DJ nuevo, escrita al
   terminar VirtualDJ con lo aprendido en los dos programas.
