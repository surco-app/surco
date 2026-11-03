# Bloque 7: comprobación tras convertir y daños — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la comprobación de lo que quedó en cada biblioteca tras convertir y el escaneo/reparación de daños decidan por programa desde tablas `Record<DjProgram, …>` (o `Partial<Record<…>>` cuando un programa no tiene la capacidad, de forma explícita), sin cambiar comportamiento.

**Architecture:**
- **Comprobación** (`main/verifyRegistry.ts`, `main/verifyIpc.ts`, `shared/verification.ts`): hoy hay cadenas `place === 'rekordbox' / 'engine' / 'traktor'` para "¿esta entrada está en esa biblioteca?" (~124-126), "cómo se comprueba esa biblioteca" (~220-226, Traktor con `checkTraktor`, rekordbox/Engine con `deps.readRekordbox`/`readEngine`), el caso especial de Traktor en ~144, ~258, ~274, el de Engine `engineStep` en ~327, y `verifyIpc.ts:196`. Pasan a una tabla `PLACE_CHECKS: Record<DjProgram, { listed(e): boolean; check(...): … }>` (nombres según el código) con los cuerpos movidos literalmente. `PLACE_ORDER` (`shared/verification.ts:93`) mezcla `'file'`, `'appleMusic'` y programas: se construye como `['file', 'appleMusic', ...PLACE_PROGRAMS]` con `PLACE_PROGRAMS = programsInOrder(['rekordbox', 'engine', 'traktor'])` para que un programa nuevo no pueda faltar.
- **Daños** (`main/damageScan.ts`, `main/damageRepair.ts`, `main/damageIpc.ts`, `main/damageWiring.ts`, `main/genreDamage.ts`): solo Traktor y Engine se escanean (rekordbox no tiene escaneo propio). Se expresa con `DAMAGE_TARGETS: Partial<Record<DjProgram, …>>` o con un `Record<DjProgram, … | null>` (rekordbox `null`) para que un programa nuevo tenga que declarar si se escanea; los cuerpos por destino (`library('traktor', …)`, repararTraktor/Engine, `r?.target === 'engine'` en IPC) se mueven literalmente.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 7).

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí montaje). Los resultados que viajan al renderer (`Verification`, `DamageScan`, reparaciones) no cambian de forma ni de orden. Sin comentarios nuevos (los existentes se mueven con su código). Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
- La matriz completa (`SURCO_MATRIX=1 …/full.test.tsx`) ejerce la comprobación de punta a punta y, con sus 4 fallos previos (3 "puntos ciegos" del verificador y K08), es la red de este bloque: debe dar exactamente las mismas celdas.

---

### Task 1: comprobación por programa

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte** en `verifyRegistry.test.ts` / `verifyIpc.test.ts`: para cada programa, una entrada cuenta como "en la biblioteca" por su regla (rekordbox/Engine no `'absent'`, Engine también con `engineStep`, Traktor con `traktorPatch`); Traktor se comprueba con su lector y rekordbox/Engine con el suyo (espías); el orden de los lugares en el resultado.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** Tabla y `PLACE_ORDER` derivado; cuerpos movidos literalmente.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación:** intercambiar los lectores de rekordbox y Engine en la tabla → falla un test; quitar `engineStep` de la regla de Engine → falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Check each DJ library after converting through one per-program table"`

### Task 2: daños por programa

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte** en `damageScan.test.ts` / `damageRepair.test.ts` / `damageIpc.test.ts`: rekordbox no se escanea; Traktor y Engine sí, cada uno con su lector y su reparación; el IPC enruta por destino.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** Tabla(s) y cuerpos movidos.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación** por tabla nueva (p. ej. dar a rekordbox un escáner → falla el test "rekordbox no se escanea").
- [ ] **Step 6: Commit** `git commit -m "Scan and repair DJ library damage through one per-program table"`

### Task 3: Cierre

- [ ] Matriz completa igual que la base; sonda de Serato y mapa (quitar `PLACE_ORDER` de "Añadidos a mano"); `git merge main`, suite, `git merge --ff-only serato` en el main local.
