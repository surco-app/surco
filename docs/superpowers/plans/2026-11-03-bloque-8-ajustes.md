# Bloque 8: ajustes y bienvenida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los ajustes por programa que quedan escritos a mano (la ruta de cada biblioteca como ajuste local de la máquina, y la lista de destinos de los flujos de cues en Ajustes > Cues) salgan de tablas por programa, de modo que un cuarto programa no pueda quedar fuera, sin cambiar comportamiento ni los ajustes guardados.

**Architecture:**
- `DJ_REACH_SETTINGS` y `DJ_COLLECTION_PATH` (hoy en `renderer/src/lib/djReach.ts`) se mueven a `shared/` (p. ej. `shared/djSettings.ts`) para que el proceso principal los use; `djReach.ts` los reexporta para no tocar sus importadores.
- `main/settings.ts` `LOCAL_KEYS`: se queda como está (sus comentarios por clave explican por qué cada una es local), y un test nuevo exige que cada valor de `DJ_COLLECTION_PATH` esté en `LOCAL_KEYS`: con un cuarto programa, el test falla hasta que su ruta se declare local (la ruta de una biblioteca no existe en otro Mac).
- `renderer/src/components/settings/CuesTab.tsx` (~363-365): la lista literal `[programa, nombre, clave cueFlowTo*, encontrado]` pasa a recorrer `DJ_PROGRAMS` (orden actual: rekordbox, traktor, engine) leyendo el nombre de la tabla de nombres por programa que ya exista (`LIBRARY_NAME` del editor de cues, si es la misma) y la clave de `FLOW_TO` (`renderer/src/lib/cueTwins.ts`); el "encontrado" por programa se monta en un `Record<DjProgram, boolean>` con las tres condiciones de hoy (rekordbox `rekordboxCollection !== ''`, traktor `traktorFound`, engine `engineFound`).
- Se dejan, y se anotan en el mapa: el asistente de bienvenida (`OnboardingWizard.tsx`: la ruta de Traktor al activarlo, el selector de carpeta de Engine), las secciones de `DestinationTab` y `syncToggleMigration.ts` (migración solo de Traktor): son flujos propios de cada programa.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 8).

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí importaciones). `settings.json` no cambia. Los `data-testid` (`settings-cue-flow-to-${library}`) y el texto visible no cambian. Sin comentarios nuevos. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.

---

### Task 1: tablas de ajustes en `shared` y el test de rutas locales

- [ ] **Step 1:** Test nuevo en `main/settings.test.ts` (o el fichero de tests de settings que exista): cada valor de `DJ_COLLECTION_PATH` está en las claves locales (exportar `LOCAL_KEYS` o consultar el comportamiento observable que las usa, lo que sea más natural en el fichero). Rojo hasta mover la tabla a `shared` (no se puede importar desde main).
- [ ] **Step 2:** Mover `DJ_REACH_SETTINGS` y `DJ_COLLECTION_PATH` a `shared/`, reexportar desde `djReach.ts`. Test verde.
- [ ] **Step 3: Mutación:** quitar `'traktorNmlPath'` de `LOCAL_KEYS` → falla el test. Deshacer editando.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Commit** `git commit -m "Keep every DJ library path a per-machine setting, checked against the per-program table"`

### Task 2: destinos de los flujos de cues

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte** en el test de `CuesTab`: las tres casillas salen en orden rekordbox, Traktor, Engine DJ con sus nombres; una biblioteca no encontrada deja su casilla sin marcar; marcar la de Traktor escribe `cueFlowToTraktor`.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** Recorrer `DJ_PROGRAMS` con las tablas.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación:** intercambiar en el `Record` de "encontrado" traktor y engine → falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "List the cue-flow targets in settings from the per-program tables"`

### Task 3: Cierre

- [ ] Matriz completa igual que la base; sonda de Serato y mapa (bienvenida, `DestinationTab`, migración de Traktor); `git merge main`, suite, `git merge --ff-only serato` en el main local.
