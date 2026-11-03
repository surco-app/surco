# Bloque 6a: host y dependencias de biblioteca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el `LibraryHost` y los tipos de sesiones y bibliotecas sincronizadas que usa el flujo "tras convertir" se indexen por programa, de modo que un cuarto programa no compile hasta declarar cómo se cierra, qué aviso de bloqueo muestra, por qué canal informa y dónde vive, sin cambiar comportamiento.

**Architecture:** En `main/libraryFlushes.ts`, `LibraryHost` cambia sus tres `ensure*Closed` por `ensureClosed(program: DjProgram)`, `showBlockedDialog(key)` por `showBlockedDialog(program)` con una tabla `SYNC_BLOCKED_KEY: Record<DjProgram, SyncBlockedKey>`, y `reportIssue(channel, issue)` por `reportIssue(program, issue)` con `SYNC_ISSUE_CHANNEL: Record<DjProgram, 'rekordbox:sync-issue' | 'engine:sync-issue' | null>` (Traktor `null`, como hoy: no tiene canal). `Sessions` pasa a `Record<DjProgram, SessionBackup>` y `SyncedLibraries` (`main/libraryFileUse.ts`) a `Record<DjProgram, string>`. Las fábricas `traktorFlushDeps`/`rekordboxFlushDeps`/`engineFlushDeps` siguen existiendo con su forma (su unificación es del 6c) y leen del host nuevo. Los módulos aguas abajo que reciben `ensureTraktorClosed` por nombre (`traktorSyncFlush`, `duplicateReplace`, `damageWiring`, `usbExport*`) no cambian.

**Tech Stack:** TypeScript estricto, Electron main, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md`.

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí importaciones, nombres o montaje de hosts falsos, p. ej. en `scenarios/harness.tsx` y `libraryFlushes.test.ts`).
- Sin comentarios nuevos. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` para deshacer mutaciones con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Formato: `cd apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome check <ficheros>`.
- Base (03/11, `eb5cd2e80` + docs): suite 14919 bien / 253 saltados; tres typecheck limpios; matriz 126 bien, 1 saltada, 4 fallos previos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey).

## Review Focus

- Cada fábrica de dependencias cierra el mismo programa, muestra la misma clave de bloqueo y informa por el mismo canal que hoy (Traktor sin canal). Test en la Tarea 1.
- `hostFor` en `index.ts` sigue cerrando con el motivo por defecto (`convert`) y enviando por `sender` solo si no está destruido.
- `rekordboxHeld` no cambia (es del 6c).

---

### Task 1: `LibraryHost`, `Sessions` y `SyncedLibraries` por programa

**Files:**
- Modify: `apps/desktop/src/main/libraryFlushes.ts` (`SyncBlockedKey`, `LibraryHost` ~50-63, `Sessions` ~65-66, fábricas ~142-192, usos en `duplicateLibraryDeps` ~536-616)
- Modify: `apps/desktop/src/main/libraryFileUse.ts:16-20` (`SyncedLibraries`)
- Modify: `apps/desktop/src/main/index.ts` (`hostFor` ~1497-1506, `sessions` ~317-321)
- Modify: `apps/desktop/src/scenarios/harness.tsx` (~388-395 host falso), y cualquier test que construya un `LibraryHost` (solo montaje)
- Test: `apps/desktop/src/main/libraryFlushes.test.ts`

**Interfaces:**
- Consumes: `DjProgram`, `DJ_PROGRAMS` (`shared/djProgram.ts`).
- Produces:
  - `export const SYNC_BLOCKED_KEY: Record<DjProgram, SyncBlockedKey>` = rekordbox `'rekordboxSyncBlocked'`, traktor `'traktorSyncBlocked'`, engine `'engineSyncBlocked'`.
  - `export const SYNC_ISSUE_CHANNEL: Record<DjProgram, 'rekordbox:sync-issue' | 'engine:sync-issue' | null>` = rekordbox `'rekordbox:sync-issue'`, traktor `null`, engine `'engine:sync-issue'`.
  - `export interface LibraryHost { ensureClosed: (program: DjProgram) => Promise<boolean>; showBlockedDialog: (program: DjProgram) => void; reportIssue: (program: DjProgram, issue: RekordboxSyncIssue) => void; rekordboxHeld: () => boolean }` — en `hostFor`, `showBlockedDialog: (p) => showSyncBlockedDialog(win, SYNC_BLOCKED_KEY[p])` y `reportIssue: (p, issue) => { const channel = SYNC_ISSUE_CHANNEL[p]; if (channel && !sender.isDestroyed()) sender.send(channel, issue) }`.
  - `export type Sessions = Record<DjProgram, SessionBackup>`; `export type SyncedLibraries = Record<DjProgram, string>`.

- [ ] **Step 1: Tests de caracterización (verdes con el código actual)** en `libraryFlushes.test.ts`, solo los que falten (buscar antes): con un host falso que registra llamadas, `traktorFlushDeps(host, s).ensureTraktorClosed()` llama al cierre de Traktor y no al de los otros; `rekordboxFlushDeps(host).ensureClosed()` al de rekordbox; `engineFlushDeps(host).ensureClosed()` al de Engine; cada `showBlockedDialog()` pide su clave (`traktorSyncBlocked`, `rekordboxSyncBlocked`, `engineSyncBlocked`); `rekordboxFlushDeps(host).reportIssue(i)` usa `'rekordbox:sync-issue'` y `engineFlushDeps` `'engine:sync-issue'`. Escribirlos de modo que sobrevivan al cambio de forma del host (el host falso se construye con una función de ayuda del test que se adapta en el Step 4 sin tocar las afirmaciones).
- [ ] **Step 2:** Correrlos contra el código actual: verdes.
- [ ] **Step 3:** Implementar las tablas y los tipos, adaptar fábricas, `hostFor`, `sessions` y los hosts falsos (solo montaje).
- [ ] **Step 4:** Tests verdes; suite completa; tres typecheck; biome.
- [ ] **Step 5: Mutation check.** Intercambiar en `SYNC_BLOCKED_KEY` rekordbox y engine: falla un test. Poner `traktor: 'engine:sync-issue'` en `SYNC_ISSUE_CHANNEL`… (no observable por las fábricas de hoy porque Traktor no informa; en su lugar) hacer que `engineFlushDeps` cierre `'rekordbox'`: falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Key the library host, its sessions and the synced libraries by DJ program"`

### Task 2: Cierre

- [ ] **Step 1:** Matriz completa: mismas 126 bien y los mismos 4 fallos.
- [ ] **Step 2: Sonda de Serato:** los tres `tsc` deben fallar también en `SYNC_BLOCKED_KEY`, `SYNC_ISSUE_CHANNEL`, `sessions` de `index.ts` y donde se construya un `SyncedLibraries`. Revertir; actualizar `docs/superpowers/plans/2026-11-03-serato-mapa.md`.
- [ ] **Step 3:** `git merge main`, suite, `git merge --ff-only serato` en el main local (sin push).
