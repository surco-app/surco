# Bloques 6d, 6e y 6f: añadir durante el trabajo, etiquetas, duplicados y uso de ficheros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que sincronizar etiquetas, sustituir duplicados en las bibliotecas y saber si una biblioteca usa un fichero decidan por programa desde tablas `Record<DjProgram, …>`, sin cambiar comportamiento.

**Architecture:** Solo proceso principal y tipos compartidos. Sin cambiar la forma de las funciones que escriben en cada biblioteca.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md` (6d, 6e, 6f).

## Decisión sobre el 6d (añadir a Engine durante el trabajo)

Solo Engine se añade durante la conversión (`processTrack.ts:573-644, 1038-1075`, `index.ts` adaptador, `isAppleMusicOnly`, `engineSizeFollow`). Generalizarlo crearía una abstracción con un solo usuario (regla del usuario: nada de abstracciones para código de un solo uso). Se deja como está y se anota en el mapa de Serato: un programa que necesite añadirse durante el trabajo tendrá que añadir su propio paso.

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí montaje y nombres). Sin comentarios nuevos. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` para deshacer mutaciones con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
- Base: `316cb4c6c`, suite 14928 bien / 253 saltados; matriz 126 bien, 1 saltada, 4 fallos previos.
- Los órdenes de recorrido actuales se conservan: etiquetas traktor, rekordbox, engine (`LIBRARY_ORDER` de `libraryTagSync.ts`); uso de ficheros rekordbox, engine, traktor (orden de `djLibraryFileUse`); duplicados el `LIBRARY_ORDER` de `duplicateReplace.ts`.

---

### Task 1: etiquetas y duplicados por programa

**Files:**
- `main/libraryTagSync.ts` (`LibraryTagFlushers`): las tres claves pasan a un tipo mapeado `Record<DjProgram, () => Promise<LibraryTagSync>>` junto a `warn` y `begin?`.
- `main/duplicateReplace.ts`: `SKIPPED` deriva sus motivos "programa abierto" de una tabla `RUNNING_REASON: Record<DjProgram, string>` (`'rekordbox-running'`, `'traktor-running'`, `'engine-running'`) más los motivos genéricos de hoy; `keptFate.stillHeld` deja de nombrar rekordbox/engine y lee `KEEPS_REPLACED: Record<DjProgram, boolean>` (rekordbox `true`, engine `true`, traktor `false`), recorriendo los programas.
- `shared/types.ts` `DuplicateReplaceOutcome`: las tres claves opcionales pasan a `Partial<Record<DjProgram, LibraryReplaceOutcome>>` combinado con el resto de campos (mismo JSON).
- Tests: `libraryTagSync.test.ts`, `duplicateReplace.test.ts`.

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte:** un duplicado sustituido (`'replaced'`) en rekordbox o en Engine deja el fichero como `'used'`; uno sustituido solo en Traktor no lo retiene por sí mismo; un resultado con motivo `'traktor-running'` / `'engine-running'` / `'rekordbox-running'` cuenta como `'skipped'`; la sincronización de etiquetas recorre traktor, rekordbox, engine en ese orden y un fallo en uno no impide los demás.
- [ ] **Step 2:** Correrlos con el código actual: verdes.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación:** `KEEPS_REPLACED.engine = false` → falla un test; quitar `'traktor-running'` de la tabla → falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Decide tag sync and duplicate outcomes from per-program tables"`

### Task 2: uso de ficheros por programa

**Files:**
- `main/libraryFileUse.ts`: `djLibraryFileUse` (~35-69), `libraryCopyInfo` (~154-184) y `libraryTracksOf` (~276) dejan las cadenas de `if` por programa y recorren un orden fijo (`programsInOrder(['rekordbox', 'engine', 'traktor'])`) con una tabla `Record<DjProgram, …>` de lectores por programa que contienen literalmente el cuerpo de cada `if` (incluidas las cachés perezosas `rekordboxKey`, `engineRows`, `nmlFiles` y el error "collection unreadable" de rekordbox). Si `libraryCopyInfo` o `libraryTracksOf` tienen otro orden hoy, se conserva el suyo con otra constante.
- `main/libraryFlushes.ts` `usedByAnyLibrary` (~90-125) y la llamada de `index.ts` (~2044): construir el objeto de bibliotecas desde una tabla/registro por programa si hoy está escrito a mano clave por clave.
- Tests: `libraryFileUse.test.ts`.

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte:** el orden en que se consulta cada biblioteca (rekordbox antes que Engine antes que Traktor: con las tres conteniendo el fichero, solo se abre rekordbox; con rekordbox ilegible, el error se lanza antes de mirar Engine); una biblioteca vacía (`''`) no se consulta.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación:** invertir el orden → falla un test; que Engine se consulte aunque su ruta sea `''` → falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Look for a file in each DJ library through one reader per program in the same order"`

### Task 3: Cierre

- [ ] Matriz completa igual que la base; sonda de Serato y mapa (añadir la decisión del 6d); `git merge main`, suite, `git merge --ff-only serato` en el main local.
