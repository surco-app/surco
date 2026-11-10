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

## Después de este refactor

1. El diseño de VirtualDJ con sus medidas, completo como los demás programas: pestaña con
   biblioteca y playlists, editor de cues que guarda, edición de playlists, pegar un tracklist,
   sesión automática, añadir lo convertido, sincronizar etiquetas, repuntar y USB.
2. Una skill en `.claude/skills/` del repo para añadir un programa de DJ nuevo, escrita al
   terminar VirtualDJ con lo aprendido en los dos programas.
