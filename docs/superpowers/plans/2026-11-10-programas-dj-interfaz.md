# Una sola puerta para los programas de DJ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que añadir un programa de DJ sea escribir su módulo en el proceso principal y rellenar filas de tabla, sin métodos nuevos en el preload ni campos con su nombre en pistas, sesión o trabajo de conversión, sin cambiar nada de lo que hacen hoy rekordbox, Traktor, Engine DJ y Serato.

**Architecture:** Un espacio `window.api.dj` con el programa como primer argumento sobre canales `dj:<operación>`, repartido en el proceso principal por una tabla `Record<DjProgram, DjMainProgram>` con capacidades opcionales. Los métodos del editor de cues que ya reparten por `programOf` pasan a `window.api.cues`, con sus fuentes en una tabla que construye `index.ts`. Los campos `fromX` y `xPlaylists(Base)` pasan a `programs` y `playlists` indexados por programa, y la sesión se sigue escribiendo también en la forma antigua.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-10-programas-dj-interfaz-design.md`

## Global Constraints

- Worktree `/Users/vicent/code/surco/.claude/worktrees/dj-interfaz`, rama `dj-interfaz`. Código en `apps/desktop/src`. Todos los comandos desde `apps/desktop`.
  - Suite: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`). Nunca filtrar por ruta desde la raíz del repo.
  - Un fichero: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/<fichero>.test.ts`.
  - Tipos: `for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Biome: `/Users/vicent/code/surco/node_modules/.bin/biome check src`.
  - Matriz: `SURCO_MATRIX=1 node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx`, comparada celda a celda con la base de la Tarea 0.
- Refactor puro. Los tests existentes solo cambian cómo llaman y cómo simulan `window.api` o `ipcMain`, nunca lo que afirman. Si un test necesita cambiar su afirmación, parar y avisar.
- TDD rojo-verde en cada pieza nueva. Mutación a mano en cada pieza nueva (reparto, filtro de eventos, migración de sesión, escritura de la forma antigua): romperla, ver caer un test, deshacer editando.
- Cero comentarios en el código nuevo. Sin `--no-verify`. Commits con título en inglés de una línea, sin prefijo ni cuerpo. No usar `git checkout`/`git stash` con trabajo sin commitear.
- Mocks de `window.api` con `vi.fn<Api['dj']['tree']>()` y similares. Selectores `data-testid`.
- No cambiar claves de ajustes guardados ni claves de traducción.
- No generalizar lo que es solo de rekordbox o solo de Traktor: `traktorCollectionInUse`, `traktorCanSave`, `detectTraktorNmlPath`, `loadEngineLibrary`, `rekordboxCollection`, `rekordboxCountCompletable`, `djAppRunning`.
- Al final de cada bloque (marcado **Cierre de bloque**): suite, tipos, Biome, matriz igual a la base, prueba manual con el driver (skill `run`) contra las bibliotecas reales de los cuatro programas, con los programas cerrados y la copia de seguridad de Surco hecha antes de escribir, y merge a main local sin push.

## Rulings

Decisiones que el código obliga a tomar y la spec deja al constructor.

- **Ruling:** la cola de rekordbox (`rekordboxQueue`, `applyRekordboxQueue`, `discardRekordboxQueue`, `rekordboxQueueReady`, `onRekordboxQueueChanged`, `onRekordboxQueueApplied`) tiene la misma forma que las colas de cues de los otros tres (`RekordboxQueueState`, `RekordboxQueueApplied`) y ya es la fila `rekordbox` de `PROGRAM_QUEUES`. Entra en la familia de la cola de cues como un programa más. Lo que guarda dentro no cambia.
- **Ruling:** los eventos viajan como `{ program: DjProgram; value: T }` por un canal `dj:<evento>`, para no cambiar la firma de `broadcast(channel, payload)` de `main/index.ts`.
- **Ruling:** el reparto del proceso principal es un solo objeto por programa (`DjMainProgram`) con una sección por familia, opcional donde la capacidad es opcional. Llamar a una operación ausente o a un programa desconocido rechaza con `Error('<program> has no <op>')` o `Error('unknown DJ program <program>')`.
- **Ruling:** los ficheros `*PlaylistsIpc.ts`, `*CueQueueIpc.ts`, `*PlaylistEditIpc.ts` y `rekordboxQueueIpc.ts` dejan de registrar canales y exportan la sección de su programa (`seratoRead(host): DjReadMain`, etc.). Se quedan con su nombre de fichero. `rekordboxCuesIpc.ts` pasa a `cuesIpc.ts` con `git mv`, y su test igual.
- **Ruling:** el host de `registerCuesIpc` recibe `sources: Record<CueProgram, CueSource | null>` ya construidas por `index.ts`, en lugar de los sub-objetos `engine?`, `traktor?`, `serato?`.
- **Ruling:** `isFrom` y `withPrograms` viven en `shared/trackOrigin.ts`. La migración de la sesión y la escritura de la forma antigua viven en `shared/sessionLegacy.ts`.

## Review Focus

- **Una sesión guardada por la versión actual, con pistas de los cuatro programas y playlists pendientes, se reabre igual.** Test en la Tarea 11 con una sesión literal de la versión actual.
- **Una sesión escrita por la versión nueva, leída por la antigua, conserva de qué programa viene cada pista y sus playlists.** Test en la Tarea 11 que pasa la salida por los lectores viejos (`copyFlags`/`copyPlaylists` de hoy, copiados al test como oráculo).
- **Un evento de cola de un programa no llega a los oyentes de otro.** Test en la Tarea 6: con oyentes de `serato` y `engine`, un `cueQueueChanged` de `engine` solo llama al de `engine`.
- **Un programa desconocido o una capacidad ausente desde el renderer no cuelga el handler.** Tests en la Tarea 1.
- **Una pista de Serato sigue sin poder convertirse** (`seratoBlocked` de `main/processTrack.ts:545`). Test de caracterización en la Tarea 9 antes de mover `fromSerato`.

---

## Bloque 0. Base

### Task 0: Medir la base

**Files:**
- Modify: `docs/superpowers/plans/2026-11-10-programas-dj-interfaz.md` (sección "Base medida" al final)

- [ ] **Step 1:** Instalar dependencias si faltan en el worktree (`ls node_modules` en la raíz del repo principal; los comandos usan `/Users/vicent/code/surco/node_modules`).
- [ ] **Step 2:** Correr suite, tipos y Biome. Apuntar pasan, saltados y fallos.
- [ ] **Step 3:** Correr la matriz y guardar el resultado celda a celda en el scratchpad (`matriz-base.txt`). Apuntar en el plan el resumen y la ruta.
- [ ] **Step 4:** Commit `Record the baseline the DJ program refactor must keep`.

## Bloque 1. Lectura

### Task 1: El reparto `dj:*` en el proceso principal

**Files:**
- Create: `shared/djApi.ts`, `main/djIpc.ts`, `main/djIpc.test.ts`

**Interfaces:**
- Produces (`shared/djApi.ts`):
  ```ts
  type Awaitable<T> = T | Promise<T>
  export interface DjReadMain {
    available(): Awaitable<boolean>
    tree(): Awaitable<SourceNode[]>
    recentCount(): Awaitable<number>
    trackCount(): Awaitable<number>
    playlist(id: string): Awaitable<SourcePlaylistEntry[]>
    membership(paths: string[]): Awaitable<Record<string, string[]>>
    collection?(): Awaitable<CollectionTrack[]>
  }
  export interface DjMainProgram { read: DjReadMain }
  export type DjMainTable = Record<DjProgram, DjMainProgram>
  export interface DjEvent<T> { program: DjProgram; value: T }
  export interface DjApi {
    available(p: DjProgram): Promise<boolean>
    tree(p: DjProgram): Promise<SourceNode[]>
    recentCount(p: DjProgram): Promise<number>
    trackCount(p: DjProgram): Promise<number>
    playlist(p: DjProgram, id: string): Promise<SourcePlaylistEntry[]>
    membership(p: DjProgram, paths: string[]): Promise<Record<string, string[]>>
    collection(p: DjProgram): Promise<CollectionTrack[]>
  }
  ```
- Produces (`main/djIpc.ts`): `registerDjIpc(table: DjMainTable): void`, que registra `dj:available`, `dj:tree`, `dj:recentCount`, `dj:trackCount`, `dj:playlist`, `dj:membership`, `dj:collection`. Las tareas siguientes añaden secciones a `DjMainProgram`, operaciones a `DjApi` y canales a `registerDjIpc`.

- [ ] **Step 1: Tests rojos** en `main/djIpc.test.ts`, con el patrón `vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))` y `handler(channel)` de `main/seratoPlaylistsIpc.test.ts`:
  - `dispatches each read to the row of the program it names`: tabla con cuatro filas cuyo `tree()` devuelve `[{ id: '<programa>' }]`; `await handler('dj:tree')({}, 'serato')` es `[{ id: 'serato' }]`, y lo mismo para `rekordbox`.
  - `passes the arguments after the program through`: `handler('dj:playlist')({}, 'traktor', 'p1')` llama al `playlist` de traktor con `'p1'`; `dj:membership` con `['/a']`.
  - `rejects an operation the program does not have`: fila `engine` sin `collection`; `handler('dj:collection')({}, 'engine')` rechaza con `engine has no collection`.
  - `rejects a program it does not know`: `handler('dj:tree')({}, 'virtualdj')` rechaza con `unknown DJ program virtualdj`.
- [ ] **Step 2:** Correr `src/main/djIpc.test.ts`. Esperado: FALLA porque `./djIpc` no existe.
- [ ] **Step 3:** Implementar `shared/djApi.ts` y `registerDjIpc` en `main/djIpc.ts`.
- [ ] **Step 4:** Correr el test. Esperado: PASA. Mutar el reparto (devolver siempre la fila `rekordbox`) y ver caer el primer test; deshacer.
- [ ] **Step 5:** Commit `Dispatch DJ library reads by program over one set of channels`.

### Task 2: Los cuatro programas sirven su lectura por `dj:*`

**Files:**
- Modify: `main/rekordboxPlaylistsIpc.ts`, `main/enginePlaylistsIpc.ts`, `main/traktorPlaylistsIpc.ts`, `main/seratoPlaylistsIpc.ts`, `main/rekordboxQueueIpc.ts` (su `rekordbox:membership`), `main/index.ts:1387-1410`
- Modify tests: `main/rekordboxPlaylistsIpc.test.ts`, `main/enginePlaylistsIpc.test.ts`, `main/traktorPlaylistsIpc.test.ts`, `main/seratoPlaylistsIpc.test.ts`, `main/rekordboxQueueIpc.test.ts`

**Interfaces:**
- Consumes: `DjReadMain`, `DjMainTable`, `registerDjIpc` (Task 1).
- Produces: `rekordboxRead(...)`, `engineRead(...)`, `traktorRead(...)`, `seratoRead(host: SeratoPlaylistsHost): DjReadMain`, con los mismos argumentos que hoy recibe cada `register*PlaylistsIpc`. Lo que esos `register*` registran fuera de la lectura (`rekordbox:edit`, `rekordbox:hasSeparator`, `serato:running`, `rekordbox:collection`…) sigue registrado por la función de hoy, que se queda solo con eso.

- [ ] **Step 1:** Inventario: listar en el commit los tests que cubren cada handler de lectura de los cuatro programas. Donde un handler de lectura no tenga test (por ejemplo `serato:collectionTracks`, 0 tests en el renderer), añadir uno de caracterización contra la función de hoy, correrlo en verde y commitear `Pin what each DJ program's library read returns today`.
- [ ] **Step 2:** Cambiar cada test de lectura para que llame a la sección (`seratoRead(host).tree()`) en vez de a `handler('serato:tree')()`. Correr: FALLA porque `seratoRead` no existe.
- [ ] **Step 3:** Implementar las cuatro secciones y construir en `index.ts` la tabla `DjMainTable` con `registerDjIpc`. Quitar los `ipcMain.handle` de lectura viejos.
- [ ] **Step 4:** Correr los cinco tests y la suite de `src/main`. Esperado: PASA.
- [ ] **Step 5:** Commit `Serve every DJ program's library read through the shared channels`.

### Task 3: El preload y el renderer leen por `window.api.dj`

**Files:**
- Modify: `preload/index.ts:234-264,313-320`, `preload/api.ts`, `renderer/src/test/api.ts`, `renderer/src/lib/sourcePrograms.ts:23-57`, `renderer/src/components/OnboardingWizard.tsx`, `renderer/src/components/settings/DestinationTab.tsx`, `renderer/src/components/settings/CuesTab.tsx`, `scenarios/harness.tsx`, y cada test que simula `rekordboxAvailable`, `loadXTree`, `xRecentCount`, `xTrackCount`, `loadXPlaylist`, `loadXCollection` o `xMembership` (`grep -rlwE` de los 27 nombres).
- Create: `preload/dj.ts`, `preload/dj.test.ts`

**Interfaces:**
- Consumes: `DjApi` (Task 1).
- Produces: `Api['dj']: DjApi`; `createDjApi(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>): DjApi` en `preload/dj.ts`, usado por `preload/index.ts` como `dj: createDjApi(ipcRenderer)`. En el renderer, `SOURCE_READ` queda como tabla construida por `sourceRead(p: DjProgram, has: { collection: boolean }): SourceRead`, con `collection: true` en rekordbox, traktor y serato.

- [ ] **Step 1: Tests rojos** en `preload/dj.test.ts` con un `ipc` falso:
  - `invokes the shared channel with the program first`: `createDjApi(ipc).playlist('serato', 'p1')` llama a `invoke('dj:playlist', 'serato', 'p1')`; lo mismo para las siete operaciones.
  - `no longer exposes the per-program read methods`: `Object.keys(api)` de `preload/index.ts` (importado con `electron` simulado, capturando lo que se pasa a `exposeInMainWorld`) no contiene ninguno de los 27 nombres viejos de lectura.
- [ ] **Step 2:** Correr. Esperado: FALLA.
- [ ] **Step 3:** Implementar `createDjApi`, añadir `dj` al `Api`, quitar los 27 métodos viejos, pasar `SOURCE_READ` y los tres componentes a `window.api.dj`, y cambiar mocks (`renderer/src/test/api.ts`, `scenarios/harness.tsx`, tests) a `dj: { available: vi.fn<Api['dj']['available']>(), … }`.
- [ ] **Step 4:** Suite, tipos y Biome. Esperado: todo verde, mismas cuentas que la base más los tests nuevos.
- [ ] **Step 5:** Commit `Read every DJ program's library through window.api.dj`.
- [ ] **Cierre de bloque:** matriz igual a la base. Driver: abrir las cuatro pestañas, contar pistas, abrir una playlist en cada una, pegar un tracklist en una playlist de Serato (usa `collection`) sin aplicar. Merge a main local.

## Bloque 2. Edición de playlists

### Task 4: `dj.editPlaylist` y `dj.hasSeparator`

**Files:**
- Modify: `shared/djApi.ts`, `main/djIpc.ts`, `main/djIpc.test.ts`, `main/rekordboxPlaylistsIpc.ts`, `main/traktorPlaylistEditIpc.ts`, `main/seratoPlaylistEditIpc.ts`, `main/index.ts:1485-1500`, `preload/dj.ts`, `preload/dj.test.ts`, `preload/index.ts`, `preload/api.ts`, `renderer/src/lib/sourcePrograms.ts` (`SourceEdit.save`, `separator`), `renderer/src/test/api.ts`, `scenarios/harness.tsx`, tests de los tres `*PlaylistEditIpc`/`rekordboxPlaylistsIpc` y los que simulan `editXPlaylist`/`xHasSeparator`.

**Interfaces:**
- Produces: `DjMainProgram.edit?: { save(edit: RekordboxPlaylistEdit, label?: string): Promise<RekordboxEditResult>; hasSeparator?(): Awaitable<boolean> }`; `DjApi.editPlaylist(p, edit, label?)`, `DjApi.hasSeparator(p)`; canales `dj:editPlaylist`, `dj:hasSeparator`. Filas: rekordbox (save + separator), traktor (save + separator), serato (save), engine sin `edit`.

- [ ] **Step 1:** Tests rojos: en `main/djIpc.test.ts`, `dispatches a playlist edit with its label to the program it names` y `rejects an edit for a program that cannot edit` (`engine`). En `preload/dj.test.ts`, el canal y la ausencia de `editRekordboxPlaylist`, `editTraktorPlaylist`, `editSeratoPlaylist`, `rekordboxHasSeparator`, `traktorHasSeparator`.
- [ ] **Step 2:** Correr: FALLA.
- [ ] **Step 3:** Implementar siguiendo el patrón de las Tareas 2 y 3 (los tests de los `*PlaylistEditIpc` pasan a llamar a la sección).
- [ ] **Step 4:** Suite, tipos, Biome: verde.
- [ ] **Step 5:** Commit `Edit DJ playlists through window.api.dj`.
- [ ] **Cierre de bloque:** matriz. Driver con copia hecha: crear, renombrar y borrar una playlist de prueba en rekordbox, Traktor y Serato; comprobar en el programa que aparece y desaparece. Merge.

## Bloque 3. Cola de cues

### Task 5: Las colas en el proceso principal por `dj:*`

**Files:**
- Modify: `shared/djApi.ts`, `main/djIpc.ts`, `main/djIpc.test.ts`, `main/rekordboxQueueIpc.ts`, `main/engineCueQueueIpc.ts`, `main/traktorCueQueueIpc.ts`, `main/seratoCueQueueIpc.ts`, `main/index.ts:450-560,1411-1485`, y sus cuatro tests.

**Interfaces:**
- Produces: `DjMainProgram.cueQueue?: { read(): Awaitable<RekordboxQueueState>; apply(): Promise<RekordboxQueueApplied | null>; discard(): Promise<void>; ready(): Awaitable<void> }`; canales `dj:cueQueue`, `dj:applyCueQueue`, `dj:discardCueQueue`, `dj:cueQueueReady`; eventos `dj:cueQueueChanged` y `dj:cueQueueApplied` con `DjEvent<RekordboxQueueState>` y `DjEvent<RekordboxQueueApplied>`. Los `onChange`/`appliedChannel` de `index.ts:454-553` pasan a `broadcast('dj:cueQueueChanged', { program, value: state })` y equivalente.

- [ ] **Step 1:** Inventario de tests de las cuatro colas; caracterizar `queueReady` y `discard` donde falte.
- [ ] **Step 2:** Tests rojos en `main/djIpc.test.ts` para el reparto de las cuatro operaciones, y en el test de la cola de `index.ts` (o en el de `programQueue.ts` si ahí vive `appliedChannel`) que `applied` sale por `dj:cueQueueApplied` con `{ program: 'engine', value }`.
- [ ] **Step 3:** Implementar. Correr: verde.
- [ ] **Step 4:** Commit `Serve the four DJ cue queues through the shared channels`.

### Task 6: El renderer escucha las colas por programa

**Files:**
- Modify: `preload/dj.ts`, `preload/dj.test.ts`, `preload/index.ts`, `preload/api.ts`, `renderer/src/hooks/useRekordboxQueue.ts` (`REKORDBOX_QUEUE`, `ENGINE_CUE_QUEUE`, `TRAKTOR_CUE_QUEUE`, `SERATO_CUE_QUEUE`), `renderer/src/hooks/useCopies.ts`, `renderer/src/App.tsx`, `renderer/src/components/RekordboxQueuePill.tsx`, `renderer/src/lib/rekordboxQueueText.ts`, `renderer/src/test/api.ts`, `scenarios/harness.tsx`, tests que simulan los 24 métodos viejos.

**Interfaces:**
- Produces: `DjApi.cueQueue(p)`, `applyCueQueue(p)`, `discardCueQueue(p)`, `cueQueueReady(p)`, `onCueQueueChanged(p, cb: (s: RekordboxQueueState) => void): () => void`, `onCueQueueApplied(p, cb: (a: RekordboxQueueApplied) => void): () => void`. Las cuatro `QueueSource` pasan a construirse con `queueSource(p: CueProgram, name: string): QueueSource`.

- [ ] **Step 1: Tests rojos** en `preload/dj.test.ts`:
  - `delivers a queue event only to listeners of its program`: oyentes de `serato` y `engine`; emitir en `dj:cueQueueChanged` `{ program: 'engine', value: s }`; solo el de engine recibe `s`.
  - `stops delivering after the returned unsubscribe`: tras llamar a la baja, `removeListener` recibe el mismo listener y un nuevo evento no llega.
  - ausencia de los 24 nombres viejos.
- [ ] **Step 2:** Correr: FALLA.
- [ ] **Step 3:** Implementar. Mutar el filtro (quitar la comparación de programa) y ver caer el primer test; deshacer.
- [ ] **Step 4:** Suite, tipos, Biome: verde.
- [ ] **Step 5:** Commit `Listen to each DJ cue queue through window.api.dj`.
- [ ] **Cierre de bloque:** matriz. Driver con copia: con cada programa abierto, guardar un cue de prueba en una pista suya y ver la pastilla de cola; cerrar el programa y ver que se aplica y la pastilla desaparece; deshacer el cue. Merge.

## Bloque 4. Editor de cues

### Task 7: `window.api.cues` y `cuesIpc.ts`

**Files:**
- Rename: `main/rekordboxCuesIpc.ts` → `main/cuesIpc.ts`, `main/rekordboxCuesIpc.test.ts` → `main/cuesIpc.test.ts` (`git mv`)
- Modify: `main/index.ts` (llamada al registro), `preload/index.ts:281-311`, `preload/api.ts`, `renderer/src/hooks/useTrackCues.ts`, `renderer/src/components/CuesSection.tsx`, `renderer/src/components/CuesBatchSection.tsx`, `renderer/src/test/api.ts`, `scenarios/harness.tsx`, y los tests que simulan los métodos movidos.
- Create: `preload/cues.ts`, `preload/cues.test.ts`

**Interfaces:**
- Produces: `registerCuesIpc(host)` con `host.sources: Record<CueProgram, CueSource | null>` en lugar de `engine?`, `traktor?`, `serato?` y de la construcción de `writers` (que pasa a `index.ts`); canales `cues:trackCues`, `cues:waveDetail`, `cues:waveFine`, `cues:dropInput`, `cues:twins`, `cues:auditionLead`, `cues:surcoGrid`, `cues:gridFit`, `cues:gridVerdict`, `cues:queued`, `cues:undo`, `cues:save`; `Api['cues']` con `trackCues`, `waveDetail`, `waveFine`, `dropInput`, `twins`, `auditionLead`, `surcoGrid`, `gridFit`, `gridVerdict`, `queued`, `undo`, `save`, mismas firmas que los `rekordbox*` de hoy. Los `cueProfile`/`learnCueProfile`/`recordCueEdit`/`onCueProfileChanged` y `rekordboxCountCompletable` no se tocan.

- [ ] **Step 1:** Comprobar en `cuesIpc.ts` que cada uno de los doce handlers reparte por `sourceOf(contentId)` o `host.twins`. El que no, se queda con su nombre `rekordbox*`, sale de la lista y se apunta en el commit.
- [ ] **Step 2:** Tests rojos en `preload/cues.test.ts` (canal `cues:*` por método, ausencia de los nombres `rekordbox*` movidos) y en `main/cuesIpc.test.ts` cambiar el host a `sources` y los canales a `cues:*`.
- [ ] **Step 3:** Implementar. Suite, tipos, Biome: verde.
- [ ] **Step 4:** Commit `Name the cue editor's calls for what they serve, every DJ program`.
- [ ] **Cierre de bloque:** matriz. Driver: abrir el editor de cues en una pista de cada programa, ver onda y cues, guardar y deshacer un cue en cada uno con copia hecha. Merge.

## Bloque 5. Sueltos

### Task 8: Exportar, elegir ruta, avisos de sincronización y `running`

**Files:**
- Modify: `shared/djApi.ts`, `main/djIpc.ts`, `main/djIpc.test.ts`, `main/index.ts` (handlers de `dialog:exportRekordbox|Traktor|Serato`, `dialog:pickEngineLibraryDir|TraktorNmlPath|RekordboxDbPath`, `serato:running`, `SYNC_ISSUE_CHANNEL` en `:1572`), `main/libraryFlushes.ts:68`, `main/seratoPlaylistsIpc.ts`, `preload/dj.ts`, `preload/dj.test.ts`, `preload/index.ts`, `preload/api.ts`, `renderer/src/components/ExportModal.tsx`, `renderer/src/components/SettingsModal.tsx`, `renderer/src/components/CuesSection.tsx`, `renderer/src/App.tsx`, `scenarios/app.tsx`, `renderer/src/test/api.ts`, `scenarios/harness.tsx`.

**Interfaces:**
- Produces:
  ```ts
  export interface DjExportPayload {
    rekordbox: string
    traktor: string
    serato: { inputPath: string; outputPath?: string }[]
  }
  export type ExportProgram = keyof DjExportPayload
  ```
  `DjMainProgram.exportCollection?(payload): Promise<string | null>`, `pickLibraryPath?(): Promise<string | null>`, `running?(): Promise<boolean>`; `DjApi.exportCollection<P extends ExportProgram>(p: P, payload: DjExportPayload[P])`, `pickLibraryPath(p)`, `running(p)`, `onSyncIssue(p, cb: (issue: RekordboxSyncIssue) => void): () => void` sobre `dj:syncIssue` con `DjEvent`. Filas: export en rekordbox, traktor, serato; ruta en rekordbox, traktor, engine; `running` en serato; aviso de sincronización en rekordbox y engine (las claves de `SYNC_ISSUE_CHANNEL`).

- [ ] **Step 1:** Tests rojos de reparto y de ausencia de `exportRekordbox`, `exportTraktor`, `exportSerato`, `pickEngineLibraryDir`, `pickTraktorNmlPath`, `pickRekordboxDbPath`, `seratoRunning`, `onRekordboxSyncIssue`, `onEngineSyncIssue`; test de que un aviso de engine solo llega a oyentes de engine.
- [ ] **Step 2:** Implementar. Suite, tipos, Biome: verde.
- [ ] **Step 3:** Commit `Export, pick a library and hear sync issues through window.api.dj`.
- [ ] **Cierre de bloque:** matriz. Driver: exportar una colección de prueba a rekordbox, Traktor y Serato a una carpeta temporal; abrir Ajustes y cancelar el selector de cada ruta; ver el aviso de Serato abierto en su pestaña. Merge.

## Bloque 6. Campos por programa

### Task 9: Fijar lo que hacen hoy las banderas y las playlists

**Files:**
- Create: `renderer/src/lib/trackPrograms.characterization.test.ts`, `main/processTrack.seratoBlocked.test.ts` si no existe ya un test de `seratoBlocked` (buscar con `grep -rn seratoBlocked src/main/*.test.ts`)

- [ ] **Step 1:** Tests de caracterización, verdes desde el principio, de `copyFlags`, `copyPlaylists`, `jobPlaylists` y de `JOB_PLAYLISTS`/`attachPlaylists` (`main/processTrack.ts:520`): `base` sin `targets` se copia; sin `targets` no se tocan las playlists; en rekordbox un `base` ausente sigue ausente y en los otros tres llega `[]`; `fromSerato` en el job rechaza con `seratoBlocked`.
- [ ] **Step 2:** Mutar cada función bajo test y ver caer su test; deshacer.
- [ ] **Step 3:** Commit `Pin how track origin and staged playlists travel today`.

### Task 10: `programs` y `playlists`

**Files:**
- Create: `shared/trackOrigin.ts`, `shared/trackOrigin.test.ts`
- Modify: `shared/types.ts:617-650,856-864`, `renderer/src/types.ts:226-243`, `renderer/src/lib/trackPrograms.ts`, y cada lectura o escritura de `fromX`/`xPlaylists(Base)` (`grep -rnE "\bfrom(Rekordbox|Engine|Traktor|Serato)\b|\b(rekordbox|traktor|engine|serato)Playlists(Base)?\b"`, unos 40 ficheros; ignorar las coincidencias que no son estos campos, como variables locales `fromRekordbox` de `main/*DropInput.ts` o nombres de módulo).

**Interfaces:**
- Produces (`shared/trackOrigin.ts`):
  ```ts
  export interface TrackOrigin {
    programs?: DjProgram[]
    playlists?: Partial<Record<LibraryProgram, { targets?: RekordboxPlaylistTarget[]; base?: string[] }>>
  }
  export function isFrom(t: TrackOrigin, p: DjProgram): boolean
  export function withPrograms(t: TrackOrigin, ps: readonly DjProgram[]): DjProgram[]
  ```
  `TrackItem`, `SessionEdit` y el job de conversión extienden `TrackOrigin` y pierden los doce campos viejos. `TRACK_PROGRAMS` pierde `flag`, `playlists`, `playlistsBase`; `TrackFlag`/`PlaylistKey` desaparecen y `SourceProgram.trackFlag` pasa a `marksOrigin: boolean`.

- [ ] **Step 1:** Tests rojos en `shared/trackOrigin.test.ts`: `isFrom` verdadero solo para los programas de la lista; `withPrograms` no duplica y conserva el orden de llegada.
- [ ] **Step 2:** Implementar `trackOrigin.ts`, cambiar tipos y usos. Los tests de caracterización de la Tarea 9 cambian solo cómo construyen la pista (`{ programs: ['serato'] }` en vez de `{ fromSerato: true }`), no lo que afirman.
- [ ] **Step 3:** Tipos verdes. Sin commit: la restauración de sesiones viejas aún no está migrada, así que los tests que restauran una sesión vieja deben fallar aquí. Si ninguno falla, la Tarea 11 no tiene test que la proteja y se escribe antes de seguir. Las Tareas 10 y 11 cierran en un solo commit (Tarea 11, Step 5).

### Task 11: La sesión se lee de las dos formas y se escribe de las dos

**Files:**
- Create: `shared/sessionLegacy.ts`, `shared/sessionLegacy.test.ts`
- Modify: `renderer/src/lib/sessionEdits.ts:18-60`, `renderer/src/hooks/useTrackLibrary.ts:515-535`, `main/session.ts` si valida campos.

**Interfaces:**
- Produces:
  ```ts
  export function fromLegacy(edit: SessionEdit & LegacyOrigin): SessionEdit
  export function withLegacy(edit: SessionEdit): SessionEdit & LegacyOrigin
  ```
  `LegacyOrigin` declara los doce campos viejos, solo para rekordbox, traktor, engine y serato, en `shared/sessionLegacy.ts` y en ningún otro sitio. `sessionEdits()` aplica `withLegacy` al escribir; la restauración aplica `fromLegacy` al leer. `fromLegacy` da prioridad a los campos nuevos si están los dos.

- [ ] **Step 1: Tests rojos** en `shared/sessionLegacy.test.ts`:
  - `reads a session saved by the current version`: sesión literal con una pista por programa, `fromSerato: true`, `rekordboxPlaylists` con un destino y `traktorPlaylistsBase: []`; `fromLegacy` da `programs` y `playlists` equivalentes campo a campo.
  - `writes what an older version reads`: `withLegacy(fromLegacy(x))` pasada por copias literales de `copyFlags`/`copyPlaylists` de hoy (oráculo dentro del test) da lo mismo que pasar `x`.
  - `keeps a lone base and a missing base as they are`: los tres casos de la Tarea 9.
- [ ] **Step 2:** Correr: FALLA.
- [ ] **Step 3:** Implementar y enchufar en `sessionEdits.ts` y `useTrackLibrary.ts`. Mutar `withLegacy` (no escribir `fromSerato`) y ver caer el segundo test; deshacer.
- [ ] **Step 4:** Suite, tipos, Biome: verde.
- [ ] **Step 5:** Commit `Keep track origin and staged playlists in one field per program, readable both ways`.
- [ ] **Cierre de bloque:** matriz. Driver: con la versión de main antes del bloque, abrir pistas desde las cuatro pestañas con playlists pendientes y cerrar Surco; abrir con la rama y comprobar que siguen marcadas y con sus playlists; cerrar; volver a abrir con la versión de main y comprobar lo mismo. Abrir una issue en GitHub "Stop writing the legacy session fields" y apuntar su número en el plan. Merge.

## Bloque 7. Lo que el compilador no ve

### Task 12: Comparaciones a mano y lista del mapa

**Files:**
- Modify: según el inventario de abajo.
- Modify: `docs/superpowers/plans/2026-11-03-serato-mapa.md` (sección nueva "Tras el refactor del 10/11")

Inventario de partida (`grep -rnE "(===|!==) '(rekordbox|traktor|engine|serato)'|case '(rekordbox|traktor|engine|serato)'"` fuera de tests):
`main/damageRepair.ts:267`, `main/usbExport.ts:304`, `main/verifyRegistry.ts:168`, `main/usbExportIpc.ts:327`, `renderer/src/App.tsx:997,2108,2110,2765,2771,3750`, `renderer/src/components/CuesSection.tsx:515,612,616,621`, `renderer/src/components/Editor.tsx:396`, `renderer/src/components/OnboardingWizard.tsx:207,215,601`, `renderer/src/components/RowWave.tsx:45`, `renderer/src/lib/triage.ts:155,156,253,254,644,645`, `renderer/src/lib/revealCue.ts:23`, y la lista "Añadidos a mano" del mapa de Serato.

- [ ] **Step 1:** Clasificar cada entrada en el mapa: (a) es una capacidad que otro programa podría tener (por ejemplo `App.tsx:2765` "programas cuya pestaña avisa", `App.tsx:2771`/`CuesSection.tsx:621` "programa con `running`", `CuesSection.tsx:612` "programa con colección que confirmar") y pasa a fila de tabla; o (b) es de verdad de un solo programa (regla de ruta de Traktor, rejilla de rekordbox, filtros `unanalysedRekordbox`/`unanalysedEngine` cuyos ids son de ajustes guardados) y se queda, con el motivo en el mapa.
- [ ] **Step 2:** Para cada entrada (a): test de caracterización en verde si no lo hay, pasar a la tabla del sitio (`SOURCE_PROGRAMS`, `CUE_PROGRAMS` o `TRACK_PROGRAMS`), suite verde, commit por sitio con título que diga qué capacidad se nombra.
- [ ] **Step 3:** `programOf` (`shared/djProgram.ts:59`): dejar el caso por defecto como está si quitarlo cambia el resultado de algún id real (los de rekordbox no llevan prefijo); apuntarlo en el mapa.
- [ ] **Step 4:** Commit del mapa `Map what still names a DJ program after the refactor`.
- [ ] **Cierre de bloque:** matriz, driver por los sitios tocados. Merge.

## Bloque 8. Prueba de fuego

### Task 13: Un VirtualDJ falso

**Files:**
- Rama desechable `dj-interfaz-prueba` desde `dj-interfaz`. Nada de esta tarea se mergea salvo la sección del plan.
- Modify (solo en `dj-interfaz`): este plan, sección "Resultado de la prueba de fuego"; `docs/superpowers/specs/2026-11-10-programas-dj-interfaz-design.md`, misma sección.

- [ ] **Step 1:** En la rama desechable, añadir `'virtualdj'` a `DjProgram` y a los órdenes, y una sección `read` falsa en `main/` que devuelve un árbol con una playlist y dos pistas.
- [ ] **Step 2:** Resolver lo que pidan los tres `tsc` con filas mínimas (`null`, `false`, capacidades ausentes) y las traducciones de `sources.virtualdj`.
- [ ] **Step 3:** Comprobar con el driver que la casilla aparece en Ajustes, Sidebar y que la pestaña muestra la playlist.
- [ ] **Step 4:** Apuntar con `git diff --stat dj-interfaz` los ficheros y líneas tocados. Criterio: ningún cambio en `preload/index.ts`, `preload/api.ts`, `TrackItem`, `SessionEdit` ni el job. Si alguno cambia, abrir una tarea para ese sitio antes de cerrar.
- [ ] **Step 5:** En `dj-interfaz`, commit del resultado `Record what adding a fifth DJ program touches after the refactor`. Borrar la rama desechable. Merge a main local.

## Base medida

Medida el 10/11 sobre `6b32bcc33` (main local `7ff5994be`).

- Suite: 17686 pasan, 262 saltados, 1 fallo por tiempo (`App.test.tsx` "tells main which tracks hold unsaved cues…", 5009 ms bajo carga; el fichero solo pasa 445/445). Se trata como intermitente: si vuelve a fallar en una tarea, se repite el fichero solo.
- Tipos: web, node y scenarios limpios.
- Biome 2.6.3: 28 errores ya presentes en main (formato y orden de imports en 20 ficheros que este refactor no crea). Puerta de cada tarea: `biome check` sobre los ficheros que toca, sin errores nuevos.
- Matriz: 131 pasan, 1 saltada, 4 fallos conocidos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey). Celda a celda en `.superpowers/sdd/2026-11-10-programas-dj-interfaz/matriz-base.txt` (no versionado).

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

Dentro de las filas pedidas hay dos cosas que no son una fila y un grupo de filas sin hueco para «no tiene», y conviene saberlas antes de VirtualDJ de verdad.

- **Cuatro ajustes guardados nuevos** en `Settings` (`addToVirtualdj`, `syncVirtualdj`, `cueFlowToVirtualdj`, `virtualdjPlaylistsFieldOffered`), con sus valores por defecto en `main/settings.ts`, `settingsContext.tsx`, `settingsDraft.ts` y `test/api.ts`. Los exigen `DJ_REACH_SETTINGS`, `FLOW_TO` y `OFFERED`/`PLAYLISTS_FIELD_OFFERED`, que están tipadas sobre `DjProgram`/`LibraryProgram` y no sobre `WritableProgram`. La excepción de la spec nombra `addToX` y `syncX`. `cueFlowToVirtualdj` y `virtualdjPlaylistsFieldOffered` entran en su espíritu (datos del usuario con nombre fijo) pero la spec no los nombra. La clave de la ruta de la biblioteca no se ejercitó, porque el programa falso no tiene `virtualdjPath` (`DJ_COLLECTION_PATH` es de `WritableProgram`). Un programa de solo lectura arrastra igualmente las cuatro claves.
- **`UsbProgram` estrechado** (`Exclude<DjProgram, 'virtualdj'>` en `shared/types.ts`). `UsbProgram = DjProgram` y `SOURCE_PROGRAMS.usb` es `P extends UsbProgram ? true : false`, así que sin tocar el tipo la fila obliga a `usb: true` y a una vista en `USB_PROGRAM_VIEW`. Es una línea de tipo, no una fila, y es una desviación de la spec, porque nombra un programa dentro de un tipo compartido y la excepción de los ajustes no la cubre. La alternativa es derivar `UsbProgram` de una tabla de capacidades (una fila `usb: true | false` por programa), de modo que añadir un programa nunca edite el tipo.
- **Filas de escritura y de cola sin hueco para «no tiene»**, rellenadas con objetos inertes porque el tipo no admite `null`. Cola de cues en main (`programQueues.virtualdj = { program: 'virtualdj' }`, por `CueProgram = DjProgram`), la píldora de la cola en `App.tsx` (estado vacío y funciones que no hacen nada), `PROGRAM_QUEUES.virtualdj` (una `queueSource` con las palabras de Serato prestadas), `CUE_PROGRAMS.virtualdj` y `COPY.virtualdj` en `CuesSection.tsx` (textos de Serato prestados), `DJ_PROCESSES.virtualdj` (`isRunning` que siempre da `false`), `JOB_PLAYLISTS`, `REPOINT_PLAYLISTS` y `ATTACH_PLAYLISTS` (devuelven `undefined` o el repunte tal cual), el vaciado de etiquetas de `syncTagsInLibraries` (`nothing`) y `libraryStatus` (`enabled: false, found: false`).

### Errores del compilador

Primera pasada, con `'virtualdj'` solo en `DjProgram` (y fuera de `WritableProgram`) salen 134 errores únicos, 52 en código de la app y 82 en tests. Estos son los 52 de la app.

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

1. **Las traducciones por plantilla.** `sources.virtualdj`, `sources.hide.virtualdj`, `sources.failed.virtualdj`, `sources.notFound.virtualdj`, `sources.gone.virtualdj`, `settings.source.virtualdj` y `settings.sourceVirtualdjUnavailable`, en los 6 idiomas. Se leen con ``tr(`sources.${p}`)`` y similares; sin ellas la pestaña y la casilla salen con la clave en crudo.
2. **La consulta de disponibilidad de la pestaña (`useSourceBrowser.ts`).** El compilador pide la fila de `found`, pero el valor mínimo (`undefined` o `false`) esconde la pestaña. Hizo falta escribir a mano otra `useQuery` como las de Engine, Traktor y Serato.
3. **La sonda de `CuesTab.tsx`.** Igual que la anterior. La sonda va en `foundBy` de `CuesTab.tsx`; su fila se rellenó con `false` y la lista de destinos de las cues muestra «VirtualDJ» como no encontrado; un programa real necesita su `useState`/`useEffect` escrito a mano.
4. **`playlistLibrariesFound` en `App.tsx`.** Pide la fila, pero cada programa llama a `useLibraryAvailable` a mano; con `false` VirtualDJ no ofrece el campo de playlists (correcto para solo lectura, un programa que escriba tiene que añadir la llamada).
5. **El panel de Ajustes, Programas de DJ (`DestinationTab.tsx`).** `PROGRAM_TABS` exige el programa y aparece el botón «VirtualDJ», pero cada panel es un `<div {...panel('traktor')}>` escrito a mano y el de VirtualDJ no existe, así que el botón abre un panel vacío (comprobado con el driver).
6. **El asistente de bienvenida (`renderer/src/components/OnboardingWizard.tsx`).** Detecta las bibliotecas con un `Promise.all` de cuatro sondas fijas y un objeto `Partial`; VirtualDJ no aparece. No se tocó.
7. **Qué ficheros usa cada biblioteca (`djLibraryFileUse` en `main/libraryFileUse.ts`, `librariesKeepingOriginal` en `main/libraryFlushes.ts`, `usedByAnyLibrary` llamado desde `main/index.ts`).** Es lo que impide reemplazar, mover a la papelera o dejar sin original un fichero que una biblioteca de DJ referencia. `SyncedLibraries` es `Record<WritableProgram, string>` y Serato entra como clave opcional escrita a mano (`serato?: SeratoLibraryRoot[]`), así que un programa de solo lectura no está protegido y el compilador calla. Es el hueco más serio para VirtualDJ real. No se tocó.
8. **Las gemelas de cues (`libraryTracksOf` en `main/libraryFileUse.ts`, cableada en `registerCuesIpc` de `main/index.ts`)**, los duplicados (`duplicateLibraryDeps` en `main/libraryFlushes.ts`) y la revisión de listas (`listReviewDeps` en `main/listReviewWiring.ts`). Reciben `seratoRoots` por argumento propio; VirtualDJ no entra. No se tocó.
9. **El editor de cues de una pista de VirtualDJ.** `cuesOpen` es `sourceProgram !== null` y `CUE_PROGRAMS` tiene fila, así que el editor se abre, pero la fuente de cues es `null` y la cola no existe. Guardar cues en una pista de VirtualDJ queda SIN COMPROBAR. No se tocó.
10. **Tests que afirman la lista de programas.** Con `tsc` limpio la suite da 17874 pasan, 261 saltados y 16 fallos en 12 ficheros, todos por una lista fija de programas en la afirmación, nunca por un fallo de la app. Órdenes y listas (`djProgram.test.ts` tres, `sourcePrograms.test.ts`, `GeneralTab.test.tsx`, `CuesTab.test.tsx`, `libraryTagSync.test.ts` dos, `libraryStatus.test.ts`, `djReach.test.ts`, `onboarding.test.ts` dos, `OnboardingWizard.test.tsx`), y tres que usan `'virtualdj'` como ejemplo de programa desconocido (`djIpc.test.ts`, `settings.test.ts` y `hiddenSources.test.ts`). Un VirtualDJ real cambia esas afirmaciones y, en los tres últimos, el ejemplo de programa inventado. No se tocaron.

### Criterio

**(a) Se cumple** para «ningún cambio en `preload/index.ts`, `preload/api.ts`, `TrackItem`, `SessionEdit` ni el job». `git diff dj-interfaz` no toca `preload/index.ts` ni `preload/api.ts`, y `TrackItem` (`renderer/src/types.ts`), `SessionEdit` y `ProcessJob` (`shared/types.ts`) no ganan campos; los cambios de `shared/types.ts` son las cuatro claves de `Settings` (la excepción de la spec) y el estrechamiento de `UsbProgram`. El origen de una pista de VirtualDJ viaja en `programs` y `playlists` de `TrackOrigin`, que crecen solos con `DjProgram`; la forma antigua de la sesión (`sessionLegacy.ts`) lo ignora a propósito.

**(b) Se cumple solo en parte** para el criterio más estricto de la spec, «compila tocando solo el módulo, las filas de tabla que el compilador pida y las traducciones». Hubo cambios que no son ni módulo, ni fila, ni traducción.

- La `useQuery` escrita a mano en `useSourceBrowser.ts`, sin la cual la pestaña no aparece.
- La sonda de `CuesTab.tsx` (`foundBy`), que falta escribir a mano; se dejó en `false` y la lista de destinos dice que VirtualDJ no está.
- El estrechamiento de `UsbProgram` en `shared/types.ts`, una desviación de la spec (ver arriba).
- Los objetos inertes donde el tipo no tiene hueco para «no tiene» (cola de cues en main y en `App.tsx`, `PROGRAM_QUEUES`, `CUE_PROGRAMS`, `COPY`, `DJ_PROCESSES`, `JOB_PLAYLISTS`, `REPOINT_PLAYLISTS`, `ATTACH_PLAYLISTS`, el vaciado de etiquetas y `libraryStatus`). Son filas que pidió el compilador, pero su contenido es un apaño y no una capacidad ausente.

Con el driver (build de la rama desechable, perfil del driver, ningún programa de DJ abierto), la casilla «VirtualDJ» sale en Ajustes, General, Barra lateral (`settings-source-virtualdj`), la pestaña aparece en la barra (`source-rail-virtualdj`), y al abrir «Pruebas» la lista muestra las dos pistas (Pray MP3 y Pray FLAC). Capturas `task13-settings-sidebar.png` y `task13-virtualdj-tab.png` en `.superpowers/sdd/2026-11-10-programas-dj-interfaz/` (no versionado).

Para VirtualDJ real queda estrechar a `WritableProgram` las tablas de escritura que hoy son de `DjProgram` (o aceptar que un programa de solo lectura las rellene en vacío), dar a `CueProgram` un hueco para «sin cola», y pasar a tabla las sondas de disponibilidad (puntos 2 a 4) y el uso de ficheros por biblioteca (punto 7).
