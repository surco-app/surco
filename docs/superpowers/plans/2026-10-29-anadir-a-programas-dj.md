# Añadir a rekordbox, Traktor y Engine DJ al convertir — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engine DJ deja de ser un destino; cada programa de DJ (rekordbox, Traktor, Engine DJ) tiene un control de tres estados (No tocar / Actualizar las que ya están / Actualizar y añadir las nuevas) que puede dar de alta pistas nuevas sin elegir playlist.

**Architecture:** "Añadir" se guarda como un booleano por programa junto al `syncX` que ya existe (`addToRekordbox`, `addToTraktor`, y el `addToEngineDj` de hoy), y la interfaz los lee como un solo valor `DjReach`. El alta ya existe en los tres escritores cuando hay playlists; aquí se añade un `TrackOp.add` que la pide sin playlists. El radio de destino pierde `'engineDj'`.

**Tech Stack:** Electron + React 19 + TS, Vitest (`apps/desktop`), Biome, i18next (es, en, de, fr, pt-BR).

**Spec:** `docs/superpowers/specs/2026-10-29-anadir-a-programas-dj-design.md`

## Global Constraints

- Todos los comandos se ejecutan en `apps/desktop`. Tests: `npx vitest run <ruta>`. Lint: `npm run lint`. Tipos: `npx tsc --build`.
- No se añaden comentarios en el código (regla del usuario), aunque el código de alrededor tenga muchos.
- Cada texto nuevo va en los cinco idiomas: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`. Los textos que se retiran se quitan de los cinco.
- Selectores en tests: `data-testid`.
- Commits: solo título descriptivo en inglés, como los de `git log`, sin cuerpo ni prefijos.
- Los tres estados (spec, decisión 4): `'off'` = No tocar, `'update'` = Actualizar las que ya están, `'add'` = Actualizar y añadir las nuevas. `'add'` implica `syncX: true`.
- Un programa no detectado en este equipo no muestra control (las mismas condiciones que hoy deciden si su sección aparece).

## Review Focus

1. **Pista que ya está en rekordbox, en `'add'`, sin campo Playlists:** conserva todas sus playlists. `known` + `wanted: []` quitaría la pista de todas; se cubre en la Task 2.
2. **Pista que ya está en Traktor, en `'add'`, sin campo Playlists:** ni avisos `playlist-changed` ni filas quitadas. Task 3.
3. **Pista en un disco que Traktor no conoce, en `'add'`:** no se añade y el aviso `not-in-library` aparece. No puede fallar en silencio. Task 3.
4. **Programa abierto al convertir:** el alta sin playlist espera en la cola y se aplica al cerrarlo. No se descarta. Task 4.
5. **Usuario que venía del destino Engine DJ:** tras actualizar ve Carpeta de salida + Engine en `'add'`, sigue llegando a Engine sin tocar nada, y el botón dice "+ Engine DJ". Tasks 1, 5 y 8.

---

### Task 1: Ajustes `addToRekordbox` y `addToTraktor`, y migración del destino Engine

**Files:**
- Modify: `src/shared/types.ts` (`Settings`, junto a `addToEngineDj` en la línea 218)
- Modify: `src/main/settings.ts` (defaults, cerca de la línea 67; llamada a la migración en las líneas 444 y 462)
- Modify: `src/main/syncToggleMigration.ts`
- Test: `src/main/syncToggleMigration.test.ts`

**Interfaces:**
- Produces: `Settings.addToRekordbox: boolean`, `Settings.addToTraktor: boolean` (default `false`); `migratedSyncToggles(stored)` también devuelve `{ syncEngineDj: true }` cuando `stored.addToEngineDj === true` y `'syncEngineDj'` no está en `stored`, o cuando está a `false`.

- [ ] **Step 1: Tests que fallan** en `syncToggleMigration.test.ts`:
  - `'keeps a user of the Engine DJ destination reaching Engine'`: `migratedSyncToggles({ addToEngineDj: true, syncEngineDj: false })` contiene `syncEngineDj: true`.
  - `'leaves Engine alone for a user who never chose it'`: `migratedSyncToggles({ addToEngineDj: false })` no contiene `syncEngineDj`.
  - Los tests de Traktor que ya existen siguen pasando, y las dos reglas se combinan: `{ traktorNmlPath: '/x', addToEngineDj: true }` → `{ syncTraktor: true, syncEngineDj: true }`.
- [ ] **Step 2:** `npx vitest run src/main/syncToggleMigration.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. La regla de Engine no mira la presencia de la clave: `add` sin `sync` deja de ser un estado válido, así que cualquier `addToEngineDj: true` fuerza `syncEngineDj: true`. Añadir los dos defaults en `settings.ts` y los campos en `Settings`.
- [ ] **Step 4:** Los tests pasan, y también `npx tsc --build`.
- [ ] **Step 5:** Commit `Add per-program settings to register new tracks in rekordbox and Traktor, and keep Engine destination users syncing`.

### Task 2: rekordbox da de alta sin playlists

**Files:**
- Modify: `src/main/rekordboxQueueOps.ts:23` (`TrackOp`)
- Modify: `src/main/rekordboxQueueFromRun.ts:19` (`trackOpsFromRun`)
- Modify: `src/main/rekordboxPlaylistWrite.ts:232` (`planTrack`)
- Test: `src/main/rekordboxQueueFromRun.test.ts`, `src/main/rekordboxPlaylistWrite.test.ts`

**Interfaces:**
- Produces: `TrackOp.add?: true`; en `trackOpsFromRun` el parámetro `opts` gana `addNew?: boolean`.

- [ ] **Step 1: Tests que fallan.**
  - `trackOpsFromRun`, `'asks rekordbox to register a converted track that is in no playlist when adding new tracks'`: un repoint sin `playlists`, que no está en la colección, con `addNew: true` → un op con `add: true` y `wanted: []`.
  - `'leaves a track rekordbox already has alone when only adding new tracks'`: el mismo repoint, pero la ruta ya está en la colección → ningún op (Review Focus 1).
  - `'does nothing new with adding off'`: repoint sin `playlists`, con `addNew` sin pasar → `[]`.
  - `planTrack` (a través del escritor público que ya prueba `rekordboxPlaylistWrite.test.ts`), `'registers an add op with no playlists'`: un op con `add: true`, `wanted: []`, `facts` válidos y fichero existente → la fila nueva está en `djmdContent` y la pista no está en ninguna playlist.
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3:** Implementar. En `trackOpsFromRun`, incluir los repoints con `r.playlists` o con `opts.addNew`. Para los que solo están por `addNew`, emitir el op solo si `contentId` sale `undefined`, con `add: true`. En `planTrack`, la salida temprana `!entry && op.wanted.length === 0` no se aplica cuando `op.add`.
- [ ] **Step 4:** Los tests pasan.
- [ ] **Step 5:** Commit `Register a converted track in rekordbox without playlists when the DJ asks for new tracks`.

### Task 3: Traktor da de alta sin playlists

**Files:**
- Modify: `src/main/rekordboxQueueFromRun.ts:74` (`libraryTrackOps`)
- Modify: `src/main/traktorPlaylistEdit.ts:209` (`applyTrack`)
- Test: `src/main/rekordboxQueueFromRun.test.ts`, `src/main/traktorPlaylistEdit.test.ts`

**Interfaces:**
- Consumes: `TrackOp.add` (Task 2).
- Produces: `libraryTrackOps(repoints, library, newId = randomUUID, addNew = false)`.

- [ ] **Step 1: Tests que fallan.**
  - `libraryTrackOps`, `'asks Traktor to register a track with no playlist choice when adding new tracks'`: repoint con `meta` y sin `traktorPlaylists`, `addNew: true` → op con `add: true`, `wanted: []`, `known: []`, `meta`.
  - `'needs track tags to register in Traktor'`: el mismo sin `meta` → `[]`, porque `withCollectionEntry` necesita `meta`.
  - `applyTraktorEdits`, `'adds a new ENTRY for an add op with no playlists'`: NML de fixture con otra pista en el mismo volumen → `<COLLECTION ENTRIES>` sube 1 y outcome `applied: true` sin avisos.
  - `'leaves a track Traktor already has untouched for an add op'`: la pista ya está y en dos playlists → el NML no cambia y no hay avisos (Review Focus 2).
  - `'says the track was not added when Traktor does not know its disk'`: volumen desconocido → `applied: false` con aviso `not-in-library` (Review Focus 3).
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3:** Implementar. En `libraryTrackOps`, sin elección de playlists y con `addNew && r.meta`, emitir el op de alta. Para `'engine'` no se emiten ops de alta, porque Engine se da de alta en `processTrack` (stage `engineDj`). En `applyTrack`, después de resolver `key`, un op con `add` y `wanted` vacío devuelve `applied: true` sin tocar playlists.
- [ ] **Step 4:** Los tests pasan.
- [ ] **Step 5:** Commit `Register a converted track in Traktor without playlists when the DJ asks for new tracks`.

### Task 4: Conectar los ajustes al final de la tanda

**Files:**
- Modify: `src/main/libraryFlushes.ts:172` y `:198`
- Test: un escenario nuevo en `src/scenarios/` (seguir la receta de rekordbox que ya existe con `rekordboxFixture.ts`)

**Interfaces:**
- Consumes: `addNew` de las Tasks 2 y 3; `Settings.addToRekordbox` y `Settings.addToTraktor` de la Task 1.

- [ ] **Step 1: Tests que fallan** (escenario):
  - `'a converted track reaches rekordbox with no playlist chosen'`: con `addToRekordbox: true` y `syncRekordbox: true`, convertir una pista que no está en la colección del fixture → sale una fila nueva en `djmdContent` con la ruta de salida.
  - `'the add waits while rekordbox is open'`: con rekordbox en marcha (el `held` del escenario) → el op queda en la cola, y al liberar se aplica (Review Focus 4).
  - `'nothing is registered with rekordbox on update only'`: `addToRekordbox: false` → ninguna fila nueva.
- [ ] **Step 2:** El escenario falla.
- [ ] **Step 3:** Pasar `addNew: getSettings().addToRekordbox` a `trackOpsFromRun`, y `getSettings().addToTraktor` como cuarto argumento a `libraryTrackOps(repoints, 'traktor', …)`. Antes de implementar, confirmar que `endRekordboxBatch()` recoge el repoint de una pista convertida aunque `syncRekordbox` y `syncTraktor` estén apagados. Si no lo hace, el escenario lo saca a la luz y hay que registrarlo también cuando `addTo*` esté activo.
- [ ] **Step 4:** El escenario pasa, y `npx vitest run src/main` queda en verde.
- [ ] **Step 5:** Commit `Send new tracks to rekordbox and Traktor at the end of a convert run when the DJ asks for them`.

### Task 5: Quitar `'engineDj'` del destino y añadir `DjReach`

**Files:**
- Create: `src/renderer/src/lib/djReach.ts`
- Test: `src/renderer/src/lib/djReach.test.ts`
- Modify: `src/renderer/src/lib/destination.ts` (+ su test)
- Modify, para que compilen los consumidores: `components/Editor.tsx`, `components/OnboardingWizard.tsx`, `components/settings/DestinationTab.tsx`, `hooks/useTrackProcessing.ts`
- Modify: `src/shared/types.ts:733` y `src/main/processTrack.ts:282` (quitar `job.addToEngineDj`, que queda sin uso)

**Interfaces:**
- Produces:
  ```ts
  export type DjReach = 'off' | 'update' | 'add'
  export const DJ_REACH_SETTINGS: Record<DjLibraryId, { sync: 'syncRekordbox' | 'syncTraktor' | 'syncEngineDj'; add: 'addToRekordbox' | 'addToTraktor' | 'addToEngineDj' }>
  export function toDjReach(sync: boolean, add: boolean): DjReach
  export function fromDjReach(r: DjReach): { sync: boolean; add: boolean }
  export function reachedPrograms(s: Pick<Settings, 'addToRekordbox' | 'addToTraktor' | 'addToEngineDj'>): DjLibraryId[]
  ```
  `Destination = 'folder' | 'appleMusic' | 'beside' | 'overwrite'`; `toDestination(addToAppleMusic, flac, overwriteOriginal, convertBesideOriginal = false)`; `fromDestination` ya no devuelve `addToEngineDj`.

- [ ] **Step 1: Tests que fallan.**
  - `toDjReach(false, false) === 'off'`, `toDjReach(true, false) === 'update'`, `toDjReach(true, true) === 'add'`, y `toDjReach(false, true) === 'add'` (estado viejo, que se lee como lo que hace).
  - `fromDjReach('add')` → `{ sync: true, add: true }`.
  - `reachedPrograms` devuelve en orden `rekordbox`, `engine`, `traktor` los que tienen `add`.
  - En `destination.test.ts`, `'picking a destination never turns Engine off'`: ningún resultado de `fromDestination` tiene la clave `addToEngineDj`.
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3:** Implementar. Quitar `'engineDj'` de `DESTINATIONS` y arreglar los consumidores hasta que `npx tsc --build` pase. Sus cambios de interfaz van en las Tasks 6, 7 y 8; aquí solo se deja de pasar o escribir `addToEngineDj` a través del destino.
- [ ] **Step 4:** `npx vitest run src/renderer/src/lib` y `npx tsc --build` en verde.
- [ ] **Step 5:** Commit `Take Engine DJ out of the destination choice and read each DJ program as off, update or add`.

### Task 6: Ajustes › Destino con un control por programa

**Files:**
- Modify: `src/renderer/src/components/settings/DestinationTab.tsx` (los `CheckboxRow` de las líneas 281 y 446 y el de Engine; `EngineLibraryFields` pasa a la sección de Engine)
- Modify: `locales/*.json`
- Test: `src/renderer/src/components/settings/DestinationTab.test.tsx`

**Interfaces:**
- Consumes: `toDjReach`, `fromDjReach`, `DJ_REACH_SETTINGS` (Task 5); `SegmentedControl` (`components/SegmentedControl.tsx`).
- Produces: testids `settings-reach-rekordbox`, `settings-reach-traktor`, `settings-reach-engine`, con prefijo de segmento `…-off`, `…-update`, `…-add`.

- [ ] **Step 1: Tests que fallan.**
  - `'shows no Engine DJ option in the destination radio'`.
  - `'turning rekordbox to add saves both switches'`: clic en `settings-reach-rekordbox-add` → patch `syncRekordbox: true, addToRekordbox: true`.
  - `'turning a program off clears both switches'`.
  - `'Traktor stays disabled until a collection is chosen'`: sin `traktorNmlPath`, el control está deshabilitado, igual que el checkbox de hoy.
  - `'a user from the Engine destination sees Engine on add'`: settings `{ addToEngineDj: true, syncEngineDj: true }` → segmento `add` seleccionado (Review Focus 5).
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3:** Implementar. Cada sección de programa (Colección de rekordbox, Colección de Traktor, Biblioteca de Engine DJ) sustituye su `CheckboxRow` por el `SegmentedControl` y mantiene su pista de ayuda y sus campos de ruta. Las tres secciones van justo debajo del radio.
  - Textos nuevos (es): `settings.djReach.off` "No tocar", `settings.djReach.update` "Actualizar", `settings.djReach.add` "Actualizar y añadir"; `settings.djReachAddHint` "Además da de alta las pistas que no tenía, sin análisis: el programa las analiza al abrirlas."
  - Se retiran `settings.destinations.engineDj` y `settings.destinationEngineDjHint`.
  - Las etiquetas `settings.syncRekordbox`, `settings.syncTraktor` y `settings.syncEngineDj` pasan a ser la `label` del control.
- [ ] **Step 4:** Los tests de `DestinationTab` y `SettingsModal` pasan.
- [ ] **Step 5:** Commit `Choose per DJ program whether a conversion leaves it alone, updates it or adds new tracks`.

### Task 7: Quitar la playlist fija de Engine

**Files:**
- Modify: `src/main/engineLibrary.ts:155` (`addToEngineLibrary` pierde `playlist`), `src/main/index.ts:1631`
- Modify: `src/shared/types.ts:255`, `src/main/settings.ts:103` (quitar `engineDjPlaylist`)
- Modify: `src/renderer/src/components/EngineLibraryFields.tsx`, `OnboardingWizard.tsx:264`
- Modify: `locales/*.json` (quitar `settings.engineDjPlaylist` y `settings.engineDjPlaylistHint`)
- Test: `src/main/engineLibrary.test.ts`

**Interfaces:**
- Produces: `addToEngineLibrary(libraryDir, filePath, meta, coverPath?, replaces?, sessionBackup?)`.

- [ ] **Step 1: Test que falla**, `'registers a track in the collection without putting it in any playlist'`: tras `addToEngineLibrary` la pista está en `Track` y no hay ninguna fila suya en `PlaylistEntity`. Los tests que esperaban la playlist "Surco" se cambian a esta expectativa.
- [ ] **Step 2:** El test falla.
- [ ] **Step 3:** Quitar el parámetro y lo que alimentaba. `rootListId` y `appendToList` se mantienen si `engineTrackPlaylists.ts` u otro módulo los usa; si no, se quitan.
- [ ] **Step 4:** `npx vitest run src/main/engineLibrary.test.ts` y `npx tsc --build` en verde.
- [ ] **Step 5:** Commit `Stop putting every track converted for Engine DJ into a fixed playlist now that the Playlists field picks them`.

### Task 8: El botón nombra los programas y el asistente pregunta con qué pinchas

**Files:**
- Modify: `src/renderer/src/lib/exportLabel.ts` (`withEngineDj` → `djTargets: DjLibraryId[]`), `components/ExportButton.tsx:38`, `components/ConvertFooter.tsx:56,405`, `components/DoneMenu.tsx:62`
- Modify: `components/OnboardingWizard.tsx:30` (`SYNC_SETTING` → `DJ_REACH_SETTINGS`)
- Modify: `locales/*.json`
- Test: `src/renderer/src/lib/exportLabel.test.ts`, `components/OnboardingWizard.test.tsx`

**Interfaces:**
- Consumes: `reachedPrograms`, `DJ_REACH_SETTINGS` (Task 5).

- [ ] **Step 1: Tests que fallan.**
  - `exportButtonLabel({ …, withAppleMusic: false, djTargets: ['rekordbox', 'traktor'], format: 'AIFF' })` → `{ key: 'editor.convertTo', options: { format: 'AIFF', programs: 'rekordbox + Traktor' } }`.
  - Lo mismo con `count: 3` → `editor.convertAllTo`.
  - Con `withAppleMusic: true` y `djTargets: ['engine']` → `programs: 'Apple Music + Engine DJ'`.
  - Con `djTargets: []` y sin Apple Music, el comportamiento de hoy no cambia (`editor.convertNoMusic` y los sufijos de lugar).
  - Asistente: marcar `onboarding-sync-rekordbox` → el patch final lleva `syncRekordbox: true, addToRekordbox: true`. La opción de destino `engineDj` y el campo de playlist de Engine ya no existen.
  - Asistente, `'tells a DJ where the files will live'`: en el paso `djLibraries`, con un programa marcado y destino `folder`, `onboarding-dj-folder` muestra la ruta de `outputDir` y un botón `onboarding-dj-folder-change` que la cambia (patch `outputDir`). Sin ningún programa marcado, o con destino Apple Music o Junto al original, la línea no aparece.
  - Asistente, `'asks for the Engine library under Engine'`: con Engine marcado, `onboarding-engine-library` (de `EngineLibraryFields`) aparece bajo su casilla en el paso `djLibraries`.
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3:** Implementar. Los nombres salen de `settings.source.*` (que ya existen); `programs` se une con `' + '`.
  - Asistente: `EngineLibraryFields` sale de los `details` del radio (la entrada `engineDj`) y pasa bajo la casilla de Engine en `djLibraries`. Bajo las casillas va la línea de la carpeta (spec, decisión 5), con el selector de carpeta que ya usa `OutputFolderField`. Texto (es): `onboarding.djFolder` "Los archivos se guardan en {{folder}}", `onboarding.djFolderChange` "Cambiar".
  - Textos (es): `editor.convertTo` "Convertir a {{format}} + {{programs}}", `editor.convertAllTo` "Convertir ({{count}}) · {{format}} + {{programs}}".
  - Se retiran `editor.convertEngine` y `editor.convertAllEngine`.
- [ ] **Step 4:** Los tests pasan.
- [ ] **Step 5:** Commit `Name every DJ program a conversion adds to on the convert button and ask for them in onboarding`.

### Task 9: Comprobación final y prueba en Traktor real

- [ ] **Step 1:** `npm test`, `npm run lint` y `npx tsc --build` en verde, sin tests saltados salvo los `skipIf` de plataforma que ya existen.
- [ ] **Step 2:** Actualizar `docs/funcionalidades.md` (Destino y Programas de DJ). Commit `Describe the per-program DJ choice in the feature inventory`.
- [ ] **Step 3 (Vicent):** Con una copia de `collection.nml`, Traktor en `'add'` y sin playlist, convertir un AIFF, un MP3 y un FLAC. Abrir Traktor y comprobar que aparecen, se analizan y siguen ahí tras cerrar y volver a abrir. Hasta que no se haga, no se publica.
