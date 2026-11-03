# Bloque 4: cues, un objeto por programa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que todo lo que el proceso principal y el editor hacen con los cues de un programa venga del objeto de ese programa, de modo que añadir Serato a los cues consista en escribir su objeto y rellenar su fila de la tabla, sin tocar el reparto, y sin cambiar ningún comportamiento.

**Architecture:** En el proceso principal, una interfaz `CueSource` (leer cues, onda detallada, entrada de Auto mark, avance de escucha, rejilla de Surco, cues pedidos en cola, cola y aplicar) con una implementación por programa en su propio fichero; `registerRekordboxCuesIpc` construye `Record<DjProgram, CueSource | null>` y cada canal hace `sources[programOf(id)]`. En el renderer, `CUE_PROGRAMS` gana los campos que hoy son comprobaciones `=== 'traktor'` o identidad de objetos.

**Tech Stack:** TypeScript estricto, Electron main, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 4: "Cues. Leer, guardar, cola, entrada de Auto mark, onda, colores y botones disponibles … Saca el reparto por prefijo de `rekordboxCuesIpc.ts` y las tablas de `CuesSection.tsx` / `cueTwins.ts`"). Mapa de pendientes: `docs/superpowers/plans/2026-11-03-serato-mapa.md` ("Añadidos a mano").

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí importaciones, nombres o montaje). Los 43 tests de `main/rekordboxCuesIpc.test.ts` son la red de la Tarea 1 y no se tocan salvo importaciones.
- Sin comentarios nuevos (una `// @ts-expect-error` por test de compilación permitida). Commits: título en inglés, sin cuerpo ni prefijos.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato` (comprobar antes de cada commit); `node_modules` enlazado.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Formato: `cd apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome check <ficheros>`.
- Base (03/11, `5c947a654`): suite 14855 bien / 253 saltados; tres typecheck limpios; matriz 126 bien, 1 saltada, 4 fallos previos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey).
- Los `data-testid` existentes (`cues-traktor-calls`, `cues-engine-calls`, `cues-traktor-no-collection`, `cues-traktor-other-collection`, …) se conservan tal cual.

## Review Focus

- Un programa sin host cableado (`engine`/`traktor` ausentes en el host): cada canal responde "no disponible" como hoy (`null`, `0`, nada en cola). Lo cubren los tests existentes del bloque 1.
- `queuedCues` con un op de Traktor/Engine que solo trae `drops`: hoy `wanted: []` sin abrir rekordbox. Cubierto por test existente.
- `saveCues` con pistas de varios programas: orden de colas rekordbox, engine, traktor y una sola llamada a `beginMoment` con ese orden. Cubierto.
- Etiqueta de "Guardar todo" con mezclas (vacío, un programa, Traktor + otro, Engine + rekordbox): tests de `saveAllKey` del bloque 1.
- Pista de Traktor: sin selector de color, color fijo en los cues nuevos, nota de CALL de Traktor, guardado bloqueado sin colección. Pista de Engine: nota de CALL de Engine. Pista de rekordbox: ninguna nota. Tests en la Tarea 2.

---

### Task 1: `CueSource` por programa en el proceso principal

**Files:**
- Create: `apps/desktop/src/main/cueSource.ts` (interfaz y tipos compartidos: `CueQueue`, `CueSource`)
- Create: `apps/desktop/src/main/rekordboxCueSource.ts`, `apps/desktop/src/main/traktorCueSource.ts`, `apps/desktop/src/main/engineCueSource.ts`
- Modify: `apps/desktop/src/main/rekordboxCuesIpc.ts` (los cuerpos de cada `case` se mudan a su fichero; el registro queda como reparto)
- Test: `apps/desktop/src/main/rekordboxCuesIpc.test.ts` (sin cambios de afirmaciones)

**Interfaces:**
- Consumes: `programOf`, `programsInOrder`, `DjProgram` (`shared/djProgram.ts`); el `host` actual de `registerRekordboxCuesIpc` (su forma no cambia).
- Produces:
  - `export interface CueSource { trackCues(id: string): Promise<TrackCues | null>; waveDetail(id: string): Promise<Uint16Array | null>; dropInput(id: string): Promise<DropInput | null>; auditionLead(id: string): Promise<number>; surcoGrid(id: string): Promise<SurcoGrid | null>; queuedWanted(id: string, op: QueueOp-de-cues): Promise<CueMark[]>; queue: CueQueue; applyQuietly(win: BrowserWindow | null): void }` — tipos exactos de los que hoy devuelven los canales; `queuedWanted` es lo que hoy calcula la rama de `queuedCues` cuando el op no trae `wanted` (rekordbox lee la colección; Traktor y Engine devuelven `[]`).
  - `rekordboxCueSource(host): CueSource`, `traktorCueSource(traktor, collection: () => string): CueSource`, `engineCueSource(engine, collection: () => string): CueSource` — cada cuerpo copiado de su `case` actual sin cambios de lógica.
  - En `registerRekordboxCuesIpc`: `const sources: Record<DjProgram, CueSource | null> = { rekordbox: rekordboxCueSource(host), traktor: host.traktor ? traktorCueSource(host.traktor, host.collection) : null, engine: host.engine ? engineCueSource(host.engine, host.collection) : null }`. Cada canal: `const source = sources[programOf(id)]; return source ? source.<método>(id) : <lo de hoy para "no disponible">`. `saveCues` recorre `CUE_SAVE_ORDER` con `sources[program]`.

- [ ] **Step 1:** Correr `rekordboxCuesIpc.test.ts` y anotar el recuento (43) como base.
- [ ] **Step 2:** Crear `cueSource.ts` y los tres ficheros moviendo los cuerpos tal cual. Cambiar los canales al reparto por `sources`.
- [ ] **Step 3:** `rekordboxCuesIpc.test.ts`: los mismos 43 en verde sin tocar el fichero de test. Tres typecheck, biome.
- [ ] **Step 4: Mutation check.** En `registerRekordboxCuesIpc`, poner `traktor: rekordboxCueSource(host)`: deben fallar tests de Traktor. En `traktorCueSource`, que `auditionLead` abra la colección de rekordbox: debe fallar el test de avance de escucha. Restaurar.
- [ ] **Step 5:** Suite completa con el mismo recuento.
- [ ] **Step 6: Commit** `git commit -m "Give each DJ program its own cue source behind one interface"`

### Task 2: El editor de cues lee de la tabla lo que hoy decide `=== 'traktor'`

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/cuePrograms.ts`, `cuePrograms.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx` (líneas ~165-172 `saveAllKey`, ~505-520 `traktor`/`canSave`/`otherCollection`, ~600-603 y ~849-851 color fijo, ~1520 y ~1561 menús de color, ~1623-1640 notas de CALL incluido `copy === ENGINE_COPY`, ~1671 recolor, ~1850 ayuda de colores; localizar por contenido)
- Modify: `apps/desktop/src/renderer/src/components/CuesBatchSection.tsx` (~58, ~64)
- Test: `CuesSection.traktor.test.tsx`, `CuesSection.engine.test.tsx`, `CuesSection.test.tsx`, `CuesSection.saveAll.test.ts` (añadir lo que falte)

**Interfaces:**
- Consumes: `CUE_PROGRAMS`, `cueProgramOf` (bloque 1), `programOf`.
- Produces: `CueProgram` gana:
  - `fixedColour: number | null` — rekordbox `null`, engine `null`, traktor `TRAKTOR_CUE_COLOR`. Sustituye al color fijo y a "¿se puede elegir color?" (`fixedColour === null`): menús de color, recolor y el texto de ayuda `editor.cues.traktor.colours`. El texto de ayuda pasa a `colourHelp: string | null` (traktor `'editor.cues.traktor.colours'`, resto `null`) si el componente lo necesita por separado.
  - `collectionGate: boolean` — traktor `true`, resto `false`. Sustituye a las consultas `traktorCanSave` / `traktorCollectionInUse`, `blocked` y `savable` en `CuesSection` y `CuesBatchSection`.
  - `callsNote: { key: string; testId: string } | null` — traktor `{ key: 'editor.cues.traktor.calls', testId: 'cues-traktor-calls' }`, engine `{ key: 'editor.cues.engine.calls', testId: 'cues-engine-calls' }`, rekordbox `null`. Sustituye a las dos notas (la de Engine hoy por `copy === ENGINE_COPY`). Mantener la condición de hoy de cuándo se muestra cada una (comprobar en el código: CALLs en el borrador).
  - `saveAllKey: string` — rekordbox `'editor.cues.saveAll'`, traktor `'editor.cues.traktor.saveAll'`, engine `'editor.cues.engine.saveAll'`. `saveAllKey(unsaved)` pasa a: vacío → `CUE_PROGRAMS.rekordbox.saveAllKey`; todos del mismo programa → su `saveAllKey`; si hay alguno de Traktor → `'editor.cues.saveAllMixed'`; si no → `'editor.cues.saveAllBoth'` (equivale a hoy; lo fijan los 7 tests del bloque 1).
- Ninguna comparación `programOf(…) === 'traktor'` ni `=== ENGINE_COPY` queda en `CuesSection.tsx` / `CuesBatchSection.tsx` salvo el recuento por programa de `CuesBatchSection` (~83, compara con la variable `library` del bucle, no con un literal).

- [ ] **Step 1: Tests de caracterización (verdes contra el código actual)**, solo los que no existan ya (buscar antes en los ficheros de test):
  - Traktor: no se ofrece cambiar de color en el menú de un cue (`queryByTestId` del selector/menú de color null), un cue añadido lleva `TRAKTOR_CUE_COLOR`, aparece `cues-traktor-calls` con un CALL en el borrador, y sin colección elegida aparece `cues-traktor-no-collection` y Guardar está deshabilitado.
  - Engine: aparece `cues-engine-calls` con un CALL en el borrador; no aparece `cues-traktor-calls`; se ofrece el color.
  - rekordbox: con un CALL no aparece ninguna de las dos notas.
- [ ] **Step 2:** Correrlos contra el código actual: verdes.
- [ ] **Step 3:** `cuePrograms.test.ts` fija los valores nuevos de los tres programas (rojo: no existen).
- [ ] **Step 4:** Añadir los campos y hacer las sustituciones.
- [ ] **Step 5:** `grep -n "=== 'traktor'\|=== 'engine'\|=== ENGINE_COPY\|TRAKTOR_CUE_COLOR" src/renderer/src/components/CuesSection.tsx src/renderer/src/components/CuesBatchSection.tsx`: vacío.
- [ ] **Step 6:** Suite completa, tres typecheck, biome.
- [ ] **Step 7: Mutation check.** `traktor.fixedColour: null` → falla un test de Traktor; `engine.callsNote: null` → falla el de Engine; `traktor.collectionGate: false` → falla el de colección; `rekordbox.callsNote` = la de Engine → falla el de rekordbox. Restaurar.
- [ ] **Step 7b:** Renombrar la variable local `engine` de `CuesSection` (hoy significa "lee el audio", es `readsAudio`) a `readsAudio` en el mismo commit.
- [ ] **Step 8: Commit** `git commit -m "Read colour choice, collection gate, CALL notes and the save-all label from the per-program cue table"`

### Task 3: Cierre del bloque

- [ ] **Step 1:** Suite, tres typecheck, biome y matriz completa: mismas 126 bien y los mismos 4 fallos.
- [ ] **Step 2: Sonda de Serato:** añadir `'serato'` temporalmente; los tres `tsc` deben fallar en `sources` de `registerRekordboxCuesIpc` y en `CUE_PROGRAMS`. Revertir. Actualizar `docs/superpowers/plans/2026-11-03-serato-mapa.md` (errores y quitar de "Añadidos a mano" lo de `CuesSection`/`CuesBatchSection` que ya resuelve la tabla).
- [ ] **Step 3: Prueba manual con el driver** (perfil aislado, programas cerrados, copias exactas de `master.db`, `collection.nml`, `m.db`): en cada programa abrir una pista, ver cues y onda, Auto mark, guardar y restaurar; en Traktor comprobar que no hay selector de color y que la nota de CALL sale.
- [ ] **Step 4:** `git merge main` en la rama, suite, `git merge --ff-only serato` en el main local (sin push).
