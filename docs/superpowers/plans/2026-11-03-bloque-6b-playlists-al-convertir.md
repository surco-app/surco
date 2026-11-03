# Bloque 6b: playlists elegidas al convertir — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que leer del trabajo de conversión las playlists elegidas para cada programa, guardarlas en el acumulador de la conversión y leerlas de él al vaciarlo pase por tablas `Record<DjProgram, …>`, de modo que un cuarto programa no compile hasta decir dónde viven sus playlists, sin cambiar comportamiento ni la forma de los datos.

**Architecture:** Los datos no cambian de forma (`ProcessJob` sigue con `{rekordbox,traktor,engine}Playlists(Base)`; `RekordboxRepoint` sigue con `playlists`, `playlistsBase`, `traktorPlaylists`, `enginePlaylists`). Lo que cambia es quién decide: en `main/rekordboxBatch.ts`, una `attachPlaylists(to, program, choice)` con una tabla que sabe qué campos escribe cada programa, y una tabla que sabe leer la elección de un `RekordboxRepoint`; en `main/processTrack.ts`, una tabla que lee la elección del `ProcessJob` por programa y un bucle sobre `DJ_PROGRAMS`; `libraryTrackOps` (`main/rekordboxQueueFromRun.ts`) lee por la tabla en vez del ternario.

**Tech Stack:** TypeScript estricto, Electron main, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md` (6b).

## Global Constraints

- Refactor puro. Las afirmaciones de los tests no cambian, con una excepción decidida: los tests de `processTrack` que comprueban llamadas a `attachRekordboxPlaylists` / `attachLibraryPlaylists` se traducen 1:1 a `attachPlaylists(to, program, choice)` con los mismos valores (la dependencia cambia de forma; lo afirmado no).
- Sin comentarios nuevos. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` para deshacer mutaciones con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Formato: `cd apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome check <ficheros>`.
- Base (03/11, `caeddb277`): suite 14922 bien / 253 saltados; tres typecheck limpios; matriz 126 bien, 1 saltada, 4 fallos previos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey).

## Review Focus

- rekordbox guarda `playlistsBase` solo si el trabajo lo trae (`...(playlistsBase ? { playlistsBase } : {})`); Traktor y Engine guardan `base: job.xPlaylistsBase ?? []`. Esa diferencia se conserva en la tabla. Test en la Tarea 1.
- Orden de las llamadas al adjuntar: rekordbox, traktor, engine (el de hoy, que coincide con `DJ_PROGRAMS`).
- Sin repoint para el destino (`findIndex === -1`): no se adjunta nada, en los tres programas.

---

### Task 1: tablas de playlists por programa

**Files:**
- Modify: `apps/desktop/src/main/rekordboxBatch.ts` (`attachRekordboxPlaylists`, `attachLibraryPlaylists` ~151-170 → `attachPlaylists`; nueva lectura por programa)
- Modify: `apps/desktop/src/main/processTrack.ts` (deps ~136-145; llamadas ~781-792)
- Modify: `apps/desktop/src/main/rekordboxQueueFromRun.ts:82-110` (`libraryTrackOps`, ternario de la línea ~90)
- Modify: `apps/desktop/src/main/index.ts` (cableado de las deps de `processTrack`)
- Test: `rekordboxBatch.test.ts`, `processTrack.test.ts` (~233-286), `rekordboxQueueFromRun.test.ts`

**Interfaces:**
- Consumes: `DjProgram`, `DJ_PROGRAMS` (`shared/djProgram.ts`); tipos `RekordboxPlaylistTarget`, `LibraryPlaylistChoice`, `ProcessJob`.
- Produces:
  - `export interface PlaylistChoice { wanted: RekordboxPlaylistTarget[]; base?: string[] }` en `rekordboxBatch.ts`.
  - `export function attachPlaylists(to: string, program: DjProgram, choice: PlaylistChoice): void` — mismo comportamiento que hoy por programa: rekordbox escribe `playlists: wanted` y `playlistsBase` solo si `choice.base` existe; traktor/engine escriben `traktorPlaylists` / `enginePlaylists` como `{ wanted, base: choice.base ?? [] }`. Sin repoint para `to`, nada.
  - `export const REPOINT_PLAYLISTS: Record<DjProgram, (r: RekordboxRepoint) => PlaylistChoice | undefined>` — rekordbox `r.playlists ? { wanted: r.playlists, base: r.playlistsBase } : undefined`; traktor `r.traktorPlaylists`; engine `r.enginePlaylists`. `libraryTrackOps` lo usa en lugar del ternario.
  - En `processTrack.ts`: `export const JOB_PLAYLISTS: Record<DjProgram, (job: ProcessJob) => PlaylistChoice | undefined>` — rekordbox `job.rekordboxPlaylists ? { wanted: job.rekordboxPlaylists, base: job.rekordboxPlaylistsBase } : undefined`; traktor `job.traktorPlaylists ? { wanted, base: job.traktorPlaylistsBase ?? [] } : undefined`; engine igual. Las deps pasan a `attachPlaylists?: (to: string, program: DjProgram, choice: PlaylistChoice) => void`, y las llamadas a `for (const p of DJ_PROGRAMS) { const c = JOB_PLAYLISTS[p](job); if (c) deps.attachPlaylists?.(target, p, c) }`.

- [ ] **Step 1: Tests de caracterización (verdes con el código actual)**, solo los que falten: `attachRekordboxPlaylists` sin base no deja `playlistsBase` en el repoint y con base sí; `attachLibraryPlaylists('traktor', …)` escribe `traktorPlaylists` y no `enginePlaylists` (y al revés); sin repoint para el destino no cambia nada; `libraryTrackOps(…, 'engine')` usa `enginePlaylists` aunque haya `traktorPlaylists` (y al revés).
- [ ] **Step 2:** Correrlos contra el código actual: verdes.
- [ ] **Step 3:** Implementar; traducir 1:1 los tests de `processTrack` que comprueban llamadas de adjuntar (mismos valores) y adaptar los de caracterización del Step 1 que llamen a las funciones viejas a `attachPlaylists` con el mismo resultado afirmado.
- [ ] **Step 4:** Suite completa, tres typecheck, biome.
- [ ] **Step 5: Mutation check:** que rekordbox escriba `playlistsBase: choice.base ?? []` → falla el test "sin base"; intercambiar traktor/engine en `REPOINT_PLAYLISTS` → falla un test; que `JOB_PLAYLISTS.traktor` olvide `?? []` → falla un test de `processTrack` (si no, añadirlo). Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Attach and read the playlists a conversion chose through one table per DJ program"`

### Task 2: Cierre

- [ ] **Step 1:** Matriz completa: mismas 126 bien y los mismos 4 fallos.
- [ ] **Step 2: Sonda de Serato:** fallan también `REPOINT_PLAYLISTS` y `JOB_PLAYLISTS` (y `attachPlaylists` si su tabla interna es un `Record`). Revertir; actualizar `docs/superpowers/plans/2026-11-03-serato-mapa.md`.
- [ ] **Step 3:** `git merge main`, suite, `git merge --ff-only serato` en el main local (sin push).
