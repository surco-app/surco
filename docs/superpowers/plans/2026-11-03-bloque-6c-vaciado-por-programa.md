# Bloque 6c: vaciar la conversión por programa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `flushConversionBatch` deje de ser una secuencia escrita a mano y recorra un objeto por programa con dos pasos, de modo que un cuarto programa no compile hasta aportar su vaciado y su resultado, sin cambiar ningún efecto ni su orden.

**Architecture:** En `main/libraryFlushes.ts`, una interfaz `ConversionFlusher<P extends DjProgram>` con `before(): Promise<void>` (lo que ocurre antes de recoger los repuntes de la conversión) y `after(run: ConversionRun): Promise<FlushOutcome[P]>` (lo que ocurre con ellos y el resultado). Tres fábricas que mueven literalmente los trozos de hoy: `traktorConversionFlusher` (`before` = la sincronización del NML y el cálculo de su resultado; `after` = las operaciones de añadir/playlists de Traktor y devolver el resultado), `rekordboxConversionFlusher` (`before` vacío; `after` = `queueConversionRun` y su resultado), `engineConversionFlusher` (`before` vacío; `after` = repuntar, encolar, operaciones y resultado). `flushConversionBatch` construye `Record<DjProgram, ConversionFlusher>` y ejecuta: todos los `before` en `FLUSH_ORDER`, después `endRekordboxBatch()` / `rekordboxBatchOpen()` / `addable` una sola vez, después todos los `after` en `FLUSH_ORDER`, y arma el `FlushOutcome`. `FLUSH_ORDER = programsInOrder(['traktor', 'rekordbox', 'engine'])`. Las colas dejan de ir por posición: `flushConversionBatch(host, sessions, queues: ConversionQueues)` con `ConversionQueues` un tipo mapeado por programa (rekordbox obligatoria, traktor y engine opcionales, con sus tipos de hoy).

**Tech Stack:** TypeScript estricto, Electron main, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md` (6c).

## Global Constraints

- Refactor puro: los 45 tests de `main/libraryFlushes.test.ts` y los escenarios son la red; sus afirmaciones no cambian. Solo cambia cómo se llama a `flushConversionBatch` (las colas como objeto en vez de por posición), en tests, harness e `index.ts`.
- Cada trozo se mueve literalmente: mismas llamadas, mismos argumentos, mismo orden de efectos (sincronizar NML de Traktor → recoger repuntes → operaciones de Traktor → rekordbox → Engine repuntar → Engine operaciones), mismos `logLibraryFlush`.
- No se toca en este subbloque: el renombrado `engine-running` → `'rekordbox-running'` de `repointEngineQueued` ni la comparación con `'rekordbox-running'` de `queueConversionRun` (anotados en el mapa), `trackOpsFromRun`, los textos de bloqueo.
- Sin comentarios nuevos; los comentarios existentes que acompañan a un trozo se mueven con él. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` para deshacer mutaciones con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Formato: `cd apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome check <ficheros>`.
- Base: la cabeza de `serato` tras el 6b; suite y matriz como en el 6b (matriz 126 bien, 1 saltada, 4 fallos previos).

## Review Focus

- Orden de efectos: un test que registre el orden de llamadas (sincronizar NML, encolar Traktor, encolar rekordbox, repuntar Engine, encolar Engine) en una conversión que toque los tres. Tarea 1.
- Los repuntes se recogen una sola vez (`endRekordboxBatch`) aunque los usen tres programas. Tarea 1.
- Lote anidado (`later`): Traktor `'later'` por su propio lote NML; rekordbox y Engine por `rekordboxBatchOpen()`. Ya cubierto (`libraryFlushes.test.ts` ~658-910); comprobar que sigue.
- Sin cola de Traktor o de Engine (parámetro ausente): mismo comportamiento que hoy.

---

### Task 1: `ConversionFlusher` por programa

**Files:**
- Modify: `apps/desktop/src/main/libraryFlushes.ts` (`flushConversionBatch` ~218-376 y lo que use)
- Modify: `apps/desktop/src/main/index.ts` (`process:batch-end` ~1514-1542: llamada con `{ rekordbox, traktor, engine }`)
- Modify: `apps/desktop/src/scenarios/harness.tsx` (llamada, solo montaje)
- Test: `apps/desktop/src/main/libraryFlushes.test.ts`

**Interfaces:**
- Consumes: `DjProgram`, `programsInOrder` (`shared/djProgram.ts`); `LibraryHost`, `Sessions` (6a); `REPOINT_PLAYLISTS` / `libraryTrackOps` (6b).
- Produces:
  - `export interface ConversionRun { repoints: RekordboxRepoint[]; later: boolean; addable: boolean }`
  - `export interface ConversionFlusher<P extends DjProgram> { before(): Promise<void>; after(run: ConversionRun): Promise<FlushOutcome[P]> }`
  - `export type ConversionQueues = { rekordbox: …tipo de hoy…; traktor?: Parameters<typeof holdInQueue>[0]; engine?: …tipo de hoy… }`
  - `export const FLUSH_ORDER = programsInOrder(['traktor', 'rekordbox', 'engine'])`
  - `flushConversionBatch(host: LibraryHost, sessions: Sessions, queues: ConversionQueues): Promise<FlushOutcome>`; dentro, `const flushers: { [P in DjProgram]: ConversionFlusher<P> } = { … }`.

- [ ] **Step 1: Test de caracterización del orden (verde con el código actual)** en `libraryFlushes.test.ts`, si no existe: una conversión con repuntes para los tres programas, con las dependencias falsas registrando en una lista el orden de: `syncCollection` de Traktor, `enqueue` de la cola de Traktor, `enqueue` de la de rekordbox, `repointTracks` de Engine, `enqueue` de la de Engine; afirmar la lista exacta. Y que `endRekordboxBatch` se llama una vez (espía o efecto observable).
- [ ] **Step 2:** Correrlo contra el código actual: verde.
- [ ] **Step 3:** Implementar moviendo los trozos; cambiar las llamadas a `flushConversionBatch` (tests, harness, `index.ts`) al objeto de colas.
- [ ] **Step 4:** `libraryFlushes.test.ts` completo verde (afirmaciones intactas); suite completa; tres typecheck; biome.
- [ ] **Step 5: Mutation check:** poner `FLUSH_ORDER` en `['rekordbox', 'traktor', 'engine']` → falla el test de orden; hacer que el flusher de Engine recoja los repuntes por su cuenta (`endRekordboxBatch()` dentro de su `after`) → falla un test (Engine recibiría una lista vacía). Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Flush a conversion through one two-step flusher per DJ program in the same order"`

### Task 2: Cierre

- [ ] **Step 1:** Matriz completa: mismas 126 bien y los mismos 4 fallos.
- [ ] **Step 2: Sonda de Serato:** fallan también `FLUSH_ORDER`, el objeto `flushers` y `ConversionQueues`. Revertir; actualizar `docs/superpowers/plans/2026-11-03-serato-mapa.md`.
- [ ] **Step 3: Prueba manual con el driver** (perfil aislado, programas cerrados, copias exactas de `master.db`, `collection.nml`, `m.db`): convertir una pista de prueba de `~/Music/Serato Pruebas` que esté en alguna biblioteca no es viable sin tocar la biblioteca real; en su lugar, comprobar que `process:batch-end` corre sin error tras convertir una pista suelta de prueba con las sincronizaciones activas, y restaurar las copias.
- [ ] **Step 4:** `git merge main`, suite, `git merge --ff-only serato` en el main local (sin push).
