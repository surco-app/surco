# Bloque 6g: las colas de cada programa en `index.ts` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la cola de escrituras pendientes de cada programa (la de rekordbox, la de cues de Engine, la de cues de Traktor) se monte con una sola fábrica probada, de modo que el cableado de `main/index.ts` sea una configuración por programa en un `Record<DjProgram, …>` y un cuarto programa no compile sin la suya, sin cambiar comportamiento.

**Architecture:** Hoy `main/index.ts` (~348-620) repite para cada programa: `createRekordboxQueue({ store, applyBatch, onChange })`, una función `announce*Applied`, un `watchRekordboxQueue({ queue, … })`, una función `apply*Quietly(serial)`, y las entradas de `queueChecks`/`verifyRegistry`. Un módulo nuevo `main/programQueue.ts` exporta `createProgramQueue(spec)` que devuelve `{ queue, watch, applyQuietly, announceApplied }` y contiene literalmente la parte común (lo que es idéntico en los tres). Lo que difiere va en `spec`: nombre del fichero de la cola, `applyBatch`, canales de difusión (`rekordbox:queueChanged`/`rekordbox:queueApplied`, `engine:cueQueueChanged`/`engine:cueQueueApplied`, `traktor:cueQueueChanged`/`traktor:cueQueueApplied`), `alwaysWatch` (solo rekordbox), extras propios (completar al cerrar, cues provisionales de rekordbox; el `applyTraktorCueQueueAsking`). `index.ts` construye `const programQueues: { [P in DjProgram]: … } = { rekordbox: createProgramQueue(…), traktor: …, engine: … }` y los nombres actuales (`rekordboxQueue`, `engineCueQueue`, `traktorCueQueue`, `applyRekordboxQueueQuietly`, …) pasan a ser lecturas de ese objeto para no tocar el resto de `index.ts`.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md` (6g).

## Global Constraints

- Refactor puro. El cableado de `index.ts` no tiene tests: por eso la lógica común pasa a `programQueue.ts` CON tests de caracterización escritos contra el comportamiento de hoy (los mismos pasos que hoy hace cada copia en `index.ts`). Antes de mover, copiar en el informe el texto de las tres copias y marcar línea a línea qué es común y qué difiere; lo que difiera aunque sea en un detalle (un `poke` de más, un orden distinto, `serial` por defecto) va en `spec`, no se unifica.
- Sin comentarios nuevos; los comentarios existentes se mueven con su código. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` para deshacer mutaciones con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
- Base: la cabeza de `serato` tras 6d-6f.

## Review Focus

- Aplicar en silencio: si tras aplicar la cola sigue esperando, se vuelve a vigilar (`poke`); si lanza, `queueChecks.settled(program, 'threw')`.
- Anunciar: difunde el aviso por el canal de ese programa y marca `queueChecks.settled(program, result)`.
- Vigilar: la cola de rekordbox se vigila también cuando completar-al-cerrar está activo o hay cues provisionales; las otras no.
- Cada programa abre su "momento" de copia (`moments.begin('queue', [program])`) al aplicar.

---

### Task 1: `createProgramQueue` con tests, y `index.ts` lo usa

**Files:**
- Create: `apps/desktop/src/main/programQueue.ts`, `apps/desktop/src/main/programQueue.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (~348-620)

- [ ] **Step 1:** Leer las tres copias y escribir en el informe la tabla común/distinto (sin tocar código).
- [ ] **Step 2: Tests (rojos: el módulo no existe)** que fijen la parte común con dependencias falsas: aplicar en silencio con resultado "sigue esperando" vuelve a vigilar; con resultado aplicado no; si `apply` lanza, se marca `'threw'`; anunciar difunde por el canal dado y marca el resultado; vigilar llama a `moments.begin('queue', [program])` antes de aplicar; `alwaysWatch` se respeta cuando se da.
- [ ] **Step 3:** Implementar `programQueue.ts` con la parte común literal; correr los tests: verdes.
- [ ] **Step 4:** `index.ts` usa la fábrica para los tres programas con su `spec`; los nombres de hoy siguen disponibles como lecturas del objeto por programa.
- [ ] **Step 5:** Suite, tres typecheck, biome.
- [ ] **Step 6: Mutación:** quitar el `poke` tras "sigue esperando" → falla un test; difundir siempre por el canal de rekordbox → falla un test. Deshacer editando.
- [ ] **Step 7: Commit** `git commit -m "Build each DJ program's pending-writes queue with one tested factory"`

### Task 2: Cierre

- [ ] Matriz completa igual que la base; sonda de Serato y mapa; prueba manual con el driver en perfil aislado y programas cerrados (guardar un cue en Engine y deshacerlo, comprobando el blob byte a byte, y lo mismo en Traktor restaurando el NML de una copia exacta) para ver las colas funcionando; `git merge main`, suite, `git merge --ff-only serato` en el main local.
