# Bloque 1: un solo tipo de programa y `programOf` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el programa de DJ de una pista se decida en un solo sitio (`programOf`) y que toda lista o tabla por programa sea exhaustiva, de modo que añadir `'serato'` a `DjProgram` haga fallar la compilación en cada punto que tenga que decidir algo, sin cambiar ningún comportamiento actual.

**Architecture:** Un módulo `shared/djProgram.ts` con la unión `DjProgram`, el orden canónico, un constructor de órdenes exhaustivos comprobado por tipos y `programOf(contentId)`. Las uniones literales repetidas pasan a `DjProgram`; las listas ordenadas pasan por el constructor exhaustivo conservando su orden; los repartos por prefijo pasan a `programOf` con `switch` exhaustivos o `Record<DjProgram, …>`.

**Tech Stack:** TypeScript estricto, Electron (main/preload/renderer), React 19, TanStack Query, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (sección "Bloques, en orden", bloque 1, y "Cómo no romper nada").

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma. Solo pueden cambiar importaciones, nombres o cómo se monta el host.
- Sin comentarios nuevos en el código (regla del usuario).
- Commits: solo título descriptivo en inglés, sin cuerpo ni prefijos (`feat:` etc.), como el historial.
- Trabajo en el worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`. Comprobar `git branch --show-current` = `serato` antes de cada commit.
- El worktree no tiene `node_modules`: usar los binarios del repo principal.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (código de salida 0, y la salida sin `Errors` ni `Unhandled`; ver `setup` > 0 ms).
  - Un fichero: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/ruta/al.test.ts` (desde `apps/desktop`, nunca desde la raíz).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done` (los tres; `tsc` pelado no comprueba nada).
  - Formato: `/Users/vicent/code/surco/node_modules/.bin/biome check <ficheros tocados>` sin avisos.
- Base de referencia (03/11, `9d54c37dd`): suite 14787 bien / 254 saltados; tres typecheck limpios; matriz `SURCO_MATRIX=1 … run src/scenarios/matrix/full.test.tsx` 126 bien, 1 saltada, 4 fallos ya existentes (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey). Al final del bloque la matriz debe dar exactamente esas mismas celdas.
- Los órdenes de programas existentes son comportamiento (orden en pantalla y orden de escritura) y se conservan tal cual en cada sitio.

## Review Focus

- Un id de Engine con el host de Engine ausente: hoy cae en rekordbox (solo pasa en tests; `index.ts` siempre pasa `engine` y `traktor`). Tras el bloque no debe llegar nunca a la cola de rekordbox. Test en la Tarea 4.
- `rekordbox:auditionLead` y `rekordbox:surcoGrid` con ids de Traktor y Engine: hoy dan `0` y `null`. Tests en la Tarea 4.
- `rekordbox:queuedCues` con un op de Traktor o Engine sin `wanted`: hoy consulta la colección de rekordbox con el id ajeno y devuelve `wanted: []`. Test en la Tarea 4.
- `wantsSurcoGrid` pide la rejilla de Surco también para pistas de Traktor (solo excluye Engine). Se conserva; test en la Tarea 5.
- `saveAllKey` con mezclas (solo Traktor, Traktor + rekordbox, solo Engine, Engine + rekordbox, vacío). Hoy sin test. Test en la Tarea 5.

---

### Task 1: `shared/djProgram.ts`

**Files:**
- Create: `apps/desktop/src/shared/djProgram.ts`
- Create: `apps/desktop/src/shared/djProgram.test.ts`
- Modify: `apps/desktop/src/shared/types.ts:1938` (la definición de `DjProgram` pasa a re-exportarse desde `djProgram.ts`: `export type { DjProgram } from './djProgram'`)

**Interfaces:**
- Produces:
  - `export type DjProgram = 'rekordbox' | 'traktor' | 'engine'`
  - `export const DJ_PROGRAMS: readonly DjProgram[]` = `['rekordbox', 'traktor', 'engine']`
  - `export function programsInOrder<const T extends readonly DjProgram[]>(order: T & AllOf<T>): readonly DjProgram[]` donde `AllOf<T>` hace que la llamada no compile si falta algún `DjProgram` en `order`. Devuelve `order` tal cual.
  - `export function programOf(contentId: string): DjProgram` — `'traktor'` si `isTraktorContent`, `'engine'` si `isEngineContent`, si no `'rekordbox'` (reutiliza las funciones de `traktorContent.ts` y `engineContent.ts`; no duplica los prefijos).

- [ ] **Step 1: Write the failing test** `shared/djProgram.test.ts`

```ts
describe('programOf', () => {
  it('reads Traktor and Engine ids by their prefix and everything else as rekordbox', () => {
    expect(programOf('traktor:HD/:Music/:t.aiff')).toBe('traktor')
    expect(programOf('engine:4')).toBe('engine')
    expect(programOf('engine:')).toBe('engine')
    expect(programOf('123456')).toBe('rekordbox')
    expect(programOf('')).toBe('rekordbox')
  })
})
describe('programsInOrder', () => {
  it('keeps the order it is given', () => {
    expect(programsInOrder(['traktor', 'rekordbox', 'engine'])).toEqual(['traktor', 'rekordbox', 'engine'])
  })
  it('refuses at compile time an order that leaves a program out', () => {
    // @ts-expect-error
    programsInOrder(['rekordbox', 'traktor'])
    expect(DJ_PROGRAMS).toEqual(['rekordbox', 'traktor', 'engine'])
  })
})
```

La línea `// @ts-expect-error` es la prueba de tipos (los tres `tsc` incluyen `src/shared/**`): si `AllOf` no rechaza el orden incompleto, `tsc` falla con "Unused '@ts-expect-error' directive". Es la única excepción a "sin comentarios" porque es una directiva del compilador.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/djProgram.test.ts`
Expected: FAIL, no se puede resolver `./djProgram`.

- [ ] **Step 3: Implement `shared/djProgram.ts`** con las firmas de Interfaces y mover `DjProgram` desde `types.ts` (re-export para no tocar sus ~importadores).

- [ ] **Step 4: Run test and the three typechecks**

Expected: PASS y los tres `tsc` limpios.

- [ ] **Step 5: Mutation check.** Cambiar `AllOf<T>` para que acepte cualquier array: `tsc -p tsconfig.node.json` debe fallar por la directiva sin usar. Cambiar `programOf` para que devuelva `'rekordbox'` con `engine:`: el test debe fallar. Restaurar y `git status` limpio salvo los ficheros de la tarea.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/djProgram.ts apps/desktop/src/shared/djProgram.test.ts apps/desktop/src/shared/types.ts
git commit -m "Decide a track's DJ program in one place and check program orders are complete"
```

### Task 2: Las uniones literales de los tres programas pasan a `DjProgram`

Cambio solo de tipos. Lo prueba el compilador: si un sitio dependía de una unión distinta, uno de los tres `tsc` falla.

**Files (Modify), cada `'rekordbox' | 'engine' | 'traktor'` en cualquier orden que represente "los tres programas":**
- `shared/types.ts`: 937 (`Record<…, LibraryCopyPresence>`), 940 (`CueLibrary = DjProgram`), 1155 (`PlaylistSource = 'appleMusic' | DjProgram`), 1645, 1655 (`LibraryTagSyncReport = Record<DjProgram, LibraryTagSync>`), 1819 (`PlaylistLibrary = DjProgram`)
- `shared/verification.ts:1` (`VerifyPlace = 'file' | 'appleMusic' | DjProgram`)
- `main/genreDamage.ts:3` (`GenreSource = DjProgram | 'info'`), `main/verifyRegistry.ts:18`, `main/verifyIpc.ts:166`, `main/duplicateReplace.ts:23`, `main/libraryFileUse.ts:186`, `main/processTrack.ts:1153`
- `renderer/src/lib/djLibraries.ts:7` (`DjLibraryId = DjProgram`)
- `scenarios/harness.tsx:156`, `scenarios/matrix/libraries.ts:55-56,61` (`Program = DjProgram | 'music'`), `scenarios/matrix/oracle.ts:1073,1081`, `scenarios/matrix/cells.ts:16,359`

**No se tocan** las uniones que son subconjuntos a propósito (`'rekordbox' | 'engine'` en `App.tsx:887,893`, `RowWave.tsx:25`, `triage.ts:225`; `'rekordbox' | 'traktor'` en `useRekordboxEdits.ts:17`, `playlistEdits.ts:81`; `'traktor' | 'engine'` en `types.ts:474`, `processTrack.ts:142`, `rekordboxBatch.ts:163`, `rekordboxQueueFromRun.ts:84`, `damageScan.ts:220`): son capacidades que solo tienen esos programas y Serato tendrá que decidir entrar en ellas.

**Interfaces:**
- Consumes: `DjProgram` (Task 1).
- Produces: los alias `CueLibrary`, `PlaylistLibrary`, `DjLibraryId` siguen existiendo como `= DjProgram`.

- [ ] **Step 1:** Sustituir las uniones listadas.
- [ ] **Step 2:** Tres typecheck limpios.
- [ ] **Step 3:** Suite completa: mismo recuento que la base (14787 + los tests nuevos de la Tarea 1).
- [ ] **Step 4: Commit** `git commit -m "Name the three DJ programs with one type wherever all of them are meant"`

### Task 3: Las listas ordenadas de programas pasan por `programsInOrder`

**Files (Modify), conservando cada orden exacto:**
- Orden `rekordbox, traktor, engine` → `DJ_PROGRAMS`: `main/copiesIpc.ts:25`, `main/moments.ts:4`, `renderer/src/components/CopiesScreen.tsx:52`, `renderer/src/components/CuesBatchSection.tsx:26`, `renderer/src/lib/cueTwins.ts:52`, `renderer/src/App.tsx:403`, `renderer/src/hooks/useRekordboxPlaylists.ts:102`
- Orden `rekordbox, engine, traktor` → `programsInOrder(['rekordbox', 'engine', 'traktor'])` (una constante con nombre por fichero): `renderer/src/lib/djLibraries.ts:15`, `renderer/src/lib/djReach.ts:18`, `renderer/src/components/Editor.tsx:384`, `main/verifyRegistry.ts:91`, `scenarios/matrix/libraries.ts:64`, `scenarios/matrix/oracle.ts:1110,1117`
- Orden `traktor, rekordbox, engine` → `programsInOrder(['traktor', 'rekordbox', 'engine'])`: `main/duplicateReplace.ts:149`, `main/libraryTagSync.ts:37`

Donde hoy hay `as const` y se usa el tipo literal del elemento, el resultado de `programsInOrder` (`readonly DjProgram[]`) basta; si algún `tsc` exige el tupla literal, se para y se informa en vez de forzar un cast.

**Interfaces:**
- Consumes: `DJ_PROGRAMS`, `programsInOrder` (Task 1).

- [ ] **Step 1:** Sustituir las 15 listas.
- [ ] **Step 2:** Tres typecheck limpios y suite completa en verde con el mismo recuento.
- [ ] **Step 3: Mutation check.** Quitar `'engine'` de una de las listas convertidas: algún `tsc` debe fallar. Restaurar.
- [ ] **Step 4: Commit** `git commit -m "Make every ordered list of DJ programs fail to compile when a program is missing"`

### Task 4: El reparto de cues en el proceso principal usa `programOf`

**Files:**
- Test: `apps/desktop/src/main/rekordboxCuesIpc.test.ts` (añadir tests, sin cambiar los existentes)
- Modify: `apps/desktop/src/main/rekordboxCuesIpc.ts:70-73` y cada handler que usa `engineOf`/`traktorOf` (`rekordbox:trackCues`, `cueWaveDetail`, `cueDropInput`, `surcoGrid`, `queuedCues`, `undoCues`, `saveCues`) más `auditionLead`

**Interfaces:**
- Consumes: `programOf` (Task 1).
- Produces: nada nuevo hacia fuera; la forma de `registerRekordboxCuesIpc(host)` no cambia (`engine?` y `traktor?` siguen opcionales).

Hoy los tests cubren Engine en `trackCues`, `cueWaveDetail`, `cueDropInput`, `undoCues`, `saveCues`, y Traktor solo en `saveCues`. Primero se fijan los huecos con tests de caracterización contra el código actual (deben pasar en verde ANTES de refactorizar; si alguno falla, el test está mal escrito, no el código).

- [ ] **Step 1: Characterization tests (verdes contra el código actual)**, con el host completo (rekordbox + `engine` + `traktor`, como en `index.ts`), reutilizando los montajes existentes del fichero (`collectionFile`, `queue()`, el NML de la línea ~705):
  - `it('reads a Traktor track's cues from the NML, not from rekordbox')`: `handler('rekordbox:trackCues')({}, 'traktor:HD/:Music/:t.aiff')` devuelve lo mismo que `readTraktorTrackCues(nml, id)`.
  - `it('draws a Traktor track's detailed wave from its file')`: `cueWaveDetail` con el id de Traktor llama a `traktor.words` con el fichero de la entrada.
  - `it('gives a rekordbox track no drop input')`: `cueDropInput` con `'123'` devuelve `null`.
  - `it('leads no audition for a Traktor or Engine track')`: `auditionLead` con `'traktor:…'` y `'engine:4'` devuelve `0`.
  - `it('builds no Surco grid for a Traktor or Engine track')`: `surcoGrid` con ambos devuelve `null` y no llama a `host.beatGrid`.
  - `it('answers a queued Traktor or Engine op without wanted cues with an empty list')`: con un op en la cola de Traktor (y otro en la de Engine) con `drops` y sin `wanted`, `queuedCues` devuelve `{ wanted: [], fingerprint }`.
  - `it('undoes a Traktor track's cues on the Traktor queue')`: `undoCues` llama a `traktor.drop(op.id)` y no a `host.queue.drop`.
- [ ] **Step 2:** Correr el fichero: todos verdes contra el código actual.
- [ ] **Step 3: New guarantee test (rojo):** `it('never queues an Engine track's cues on rekordbox when Engine is not wired')`: host SIN `engine`, `saveCues([{ contentId: 'engine:4', … }])` no llama a `host.queue.enqueue`. Hoy falla (cae en rekordbox). Es la única diferencia de comportamiento del bloque y solo alcanza a una configuración que `index.ts` no usa (pasa siempre `engine` y `traktor`); la pide el antiobjetivo del diseño ("ningún id desconocido como rekordbox").
- [ ] **Step 4: Refactor** `rekordboxCuesIpc.ts`: cada handler decide con `switch (programOf(contentId))` exhaustivo (sin `default`, de modo que añadir un programa a `DjProgram` no compile). Un programa cuyo host falta se trata como "no disponible": `null` en lecturas, `0` en `auditionLead`, nada encolado en `saveCues`, nada en `undoCues`.
- [ ] **Step 5:** Fichero completo verde (los existentes sin tocar, los de caracterización y el nuevo), tres typecheck limpios.
- [ ] **Step 6: Mutation check.** En el `switch` de `trackCues`, intercambiar los casos `traktor` y `engine`: deben fallar tests. Hacer que `saveCues` mande los ids de Engine a `host.queue` cuando falta `host.engine`: debe fallar el test del Step 3. Restaurar.
- [ ] **Step 7: Commit** `git commit -m "Route every cue channel by the track's program and never hand an unwired program's track to rekordbox"`

### Task 5: Los repartos por prefijo del renderer usan `programOf` y una tabla por programa

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/cuePrograms.ts`
- Create: `apps/desktop/src/renderer/src/lib/cuePrograms.test.ts`
- Modify: `renderer/src/components/CuesSection.tsx` (líneas 158-171, 438, 503-511, 1708, 1841), `renderer/src/components/CuesBatchSection.tsx:58,64`, `renderer/src/lib/cueTwins.ts:54-57`, `renderer/src/lib/cueTasteEdits.ts:11`, `renderer/src/lib/cueAutoMark.ts:63,134`
- Test: `renderer/src/components/CuesSection.test.tsx` (añadir) o un `CuesSection.saveAll.test.ts` nuevo para `saveAllKey`

**Interfaces:**
- Consumes: `programOf`, `DjProgram` (Task 1).
- Produces:
  - `export interface CueProgram { slots: CueSlots; readsAudio: boolean; surcoGrid: boolean }`
  - `export const CUE_PROGRAMS: Record<DjProgram, CueProgram>` con exactamente lo que codifican hoy los prefijos:
    - `rekordbox: { slots: ALL_SLOTS, readsAudio: false, surcoGrid: true }`
    - `traktor: { slots: TRAKTOR_SLOTS, readsAudio: true, surcoGrid: true }`
    - `engine: { slots: ALL_SLOTS, readsAudio: true, surcoGrid: false }`
  - `export const cueProgramOf = (contentId: string): CueProgram => CUE_PROGRAMS[programOf(contentId)]`
  - `libraryOf` de `cueTwins.ts` pasa a ser `programOf` (se borra `libraryOf` y sus importadores usan `programOf`).

Qué sustituye a qué:
- `isTraktorContent(id) ? TRAKTOR_SLOTS : ALL_SLOTS` (CuesSection 438, cueAutoMark 134) → `cueProgramOf(id).slots`.
- `isEngineContent(id) || isTraktorContent(id)` (cueTasteEdits 11, cueAutoMark 63) y `const engine = isEngineContent(id) || traktor` (CuesSection 504) → `cueProgramOf(id).readsAudio`.
- `!isEngineContent(cue.contentId)` en `wantsSurcoGrid` (CuesSection 1708) → `cueProgramOf(cue.contentId).surcoGrid`.
- `copyOf` (CuesSection 158) → `const COPY: Record<DjProgram, …> = { rekordbox: REKORDBOX_COPY, traktor: TRAKTOR_COPY, engine: ENGINE_COPY }` indexado por `programOf`.
- Las comprobaciones que significan "es Traktor" (CuesSection 503, 509, 511, 1841; CuesBatchSection 58, 64; `saveAllKey` 166) → `programOf(id) === 'traktor'`; la de Engine en `saveAllKey` (169) → `programOf(id) === 'engine'`.

- [ ] **Step 1: Characterization test for `saveAllKey`** (verde contra el código actual), un `it` por caso:
  - vacío → `'editor.cues.saveAll'`
  - `{'123'}` → `'editor.cues.saveAll'`
  - `{'traktor:a'}` → `'editor.cues.traktor.saveAll'`
  - `{'traktor:a', '123'}` → `'editor.cues.saveAllMixed'`
  - `{'traktor:a', 'engine:1'}` → `'editor.cues.saveAllMixed'`
  - `{'engine:1'}` → `'editor.cues.engine.saveAll'`
  - `{'engine:1', '123'}` → `'editor.cues.saveAllBoth'`
- [ ] **Step 2: Characterization test for the Surco grid on Traktor** (verde contra el código actual) en `CuesSection.traktor.test.tsx`: con una pista de Traktor sin analizar (`read.analysed === false`), la sección llama a `window.api.rekordboxSurcoGrid` (`hooks/useTrackCues.ts:76`); con una de Engine sin analizar, no lo llama. Se afirma la llamada (spy), no un valor que ya tuviera de partida.
- [ ] **Step 3:** `cuePrograms.test.ts`: `CUE_PROGRAMS` tiene exactamente los valores de Interfaces y `cueProgramOf('traktor:x').slots === TRAKTOR_SLOTS`, `cueProgramOf('engine:1').readsAudio === true`, `cueProgramOf('1').readsAudio === false`. Rojo (no existe el módulo).
- [ ] **Step 4:** Crear `cuePrograms.ts` y hacer las sustituciones de la lista. Borrar las importaciones de `isTraktorContent`/`isEngineContent` que queden sin uso.
- [ ] **Step 5:** Sin usos fuera de `shared/`: `grep -rn "isTraktorContent\|isEngineContent" apps/desktop/src --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -v 'shared/'` no devuelve nada salvo `shared/djProgram.ts`.
- [ ] **Step 6:** Suite completa en verde (mismo recuento + nuevos), tres typecheck, biome limpio.
- [ ] **Step 7: Mutation check.** Poner `traktor.surcoGrid: false`: debe fallar el test del Step 2. Poner `engine.readsAudio: false`: debe fallar algún test de `cueAutoMark.test.ts` / `CuesSection.engine.test.tsx`. Poner `traktor.slots: ALL_SLOTS`: debe fallar `CuesSection.traktor.test.tsx` o `cueAutoMark.test.ts`. Si alguna mutación no hace fallar nada, añadir el test que la detecte antes de seguir. Restaurar.
- [ ] **Step 8: Commit** `git commit -m "Read what the cue editor does per program from one table keyed by the track's program"`

### Task 6: Cierre del bloque

- [ ] **Step 1:** Suite completa (código de salida 0, sin `Errors`/`Unhandled`), tres typecheck, biome sobre todos los ficheros tocados.
- [ ] **Step 2:** Matriz completa: `cd apps/desktop && SURCO_MATRIX=1 node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx`. Expected: 126 bien, 1 saltada, y fallan exactamente K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey.
- [ ] **Step 3: Prueba de que el bloque cumple su objetivo.** En un cambio temporal sin commitear, añadir `'serato'` a `DjProgram`: los tres `tsc` deben fallar en `DJ_PROGRAMS`, en cada `programsInOrder`, en `CUE_PROGRAMS`, en `COPY` y en los `switch` de `rekordboxCuesIpc.ts`. Anotar la lista de errores (es el mapa de trabajo para Serato) y revertir (`git checkout -- .`, `git status` limpio).
- [ ] **Step 4: Prueba manual con el driver** (decisión del usuario: la hace Claude), con rekordbox, Traktor y Engine cerrados y la copia de Surco hecha: abrir el editor de cues en una pista de cada pestaña (rekordbox, Traktor, Engine) y comprobar que se ven los cues, la onda y que Auto mark propone; guardar un cambio de cue en cada programa y comprobar en el programa que aparece; deshacerlo después.
- [ ] **Step 5:** Mergear `serato` en `main` local solo si el usuario lo pide (el bloque es mergeable, pero el usuario decide cuándo).
