# Bloque 2: programa abierto o cerrado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que saber si un programa de DJ está abierto y pedir al usuario que lo cierre se decida en un solo módulo con una entrada por programa, de modo que añadir `'serato'` a `DjProgram` no compile hasta que Serato diga cómo se detecta, cómo se cierra y con qué textos se pide, sin cambiar ningún comportamiento.

**Architecture:** Un módulo `main/djProcesses.ts` con `DJ_PROCESSES: Record<DjProgram, …>` (detectar y cerrar, reutilizando `rekordboxProcess.ts`, `traktorProcess.ts`, `engineProcess.ts`) y una fábrica `createEnsureClosed(deps)` que hoy está triplicada en `main/index.ts` (`ensureEngineDjClosed`, `ensureTraktorClosed`, `ensureRekordboxClosed` + `rekordboxQuitPrompt`). `index.ts` pasa a cablear los mismos dependientes desde ahí. Los módulos que reciben `ensureRekordboxClosed` etc. como dependencia no cambian (su forma es del bloque 6).

**Tech Stack:** TypeScript estricto, Electron main, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 2: "Programa abierto o cerrado. `isRunning` y `ensureClosed` (hoy `ensure*Closed` en `index.ts`) en el objeto del programa").

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma. Solo pueden cambiar importaciones, nombres o cómo se monta el host.
- Sin comentarios nuevos en el código. Commits: solo título en inglés, sin cuerpo ni prefijos.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato` (comprobar antes de cada commit). Tiene `node_modules` enlazado al repo principal.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Formato: `cd apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome check <ficheros>`.
- Base (03/11, `2d47456ec`): suite 14821 bien / 253 saltados; tres typecheck limpios; matriz 126 bien, 1 saltada, 4 fallos previos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey).
- Los textos de los diálogos son las claves existentes de `main/i18n.ts` (`{engine,traktor,rekordbox}Quit{Message,Detail*,Confirm,Cancel}`); no se crean ni renombran claves.

## Review Focus

- Dos peticiones de cierre de Traktor (o de Engine) a la vez con motivos distintos: hoy salen en UN diálogo con el texto de la primera, y las dos reciben la misma respuesta. Test en la Tarea 1.
- Dos peticiones de cierre de rekordbox a la vez con motivos distintos: hoy salen DOS diálogos seguidos, cada uno con su texto; la segunda espera a la primera y vuelve a comprobar si sigue abierto. Test en la Tarea 1.
- Programa cerrado: devuelve `true` sin diálogo ni intento de cerrar. Test en la Tarea 1.
- Usuario rechaza: `false` y no se intenta cerrar. Usuario acepta: devuelve lo que devuelva cerrar (que puede ser `false` si no se cierra). Tests en la Tarea 1.
- Sin ventana (`win` null): el diálogo se abre sin padre. Test en la Tarea 1.

---

### Task 1: `main/djProcesses.ts`

**Files:**
- Create: `apps/desktop/src/main/djProcesses.ts`
- Create: `apps/desktop/src/main/djProcesses.test.ts`

**Interfaces:**
- Consumes: `DjProgram` (`shared/djProgram.ts`), `sharedPrompt` (`main/sharedPrompt.ts`), `isRekordboxRunning`/`quitRekordbox`, `isTraktorRunning`/`quitTraktor`, `isEngineDjRunning`/`quitEngineDj`, `MenuStrings` (claves) y `createMenuT` de `main/i18n.ts`.
- Produces:
  - `export type QuitReason = 'convert' | 'cues' | 'playlists' | 'usb' | 'restore'`
  - `export const QUIT_REASONS: { [P in DjProgram]: readonly QuitReason[] }` — los motivos que cada programa tiene hoy: rekordbox `convert, playlists, usb, restore`; traktor `convert, cues, playlists, restore`; engine `convert, cues, usb, restore`.
  - `export type ReasonOf<P extends DjProgram>` = el motivo de `QUIT_REASONS[P]`, para que pedir `ensureClosed('rekordbox', win, 'cues')` no compile (hoy no existe esa clave).
  - `export const DJ_PROCESSES: Record<DjProgram, { isRunning: () => Promise<boolean>; quit: () => Promise<boolean> }>` (rekordbox llama a `quitRekordbox()` sin opciones, como hoy).
  - `export interface QuitText { message: keyof MenuStrings; confirm: keyof MenuStrings; cancel: keyof MenuStrings; detail: Record<QuitReason-del-programa, keyof MenuStrings> }` y `export const QUIT_TEXT: { [P in DjProgram]: … }` con las claves de hoy (`convert` → `…QuitDetail`, `cues` → `…QuitDetailCues`, `playlists` → `…QuitDetailPlaylists`, `usb` → `…QuitDetailUsb`, `restore` → `…QuitDetailRestore`).
  - `export const QUIT_PROMPT_SHARING: Record<DjProgram, 'once' | 'perReason'>` = rekordbox `'perReason'`, traktor `'once'`, engine `'once'` (lo que hacen hoy: `sharedPrompt` por clave de detalle en rekordbox, un único `??=` en Traktor y Engine).
  - `export function createEnsureClosed(deps: { processes: typeof DJ_PROCESSES; ask: (win: BrowserWindow | null, opts: MessageBoxOptions) => Promise<number>; t: (key: keyof MenuStrings) => string }): <P extends DjProgram>(program: P, win: BrowserWindow | null, reason?: ReasonOf<P>) => Promise<boolean>` — `reason` por defecto `'convert'`. Un `sharedPrompt` por programa; la clave es el motivo (`perReason`) o una constante (`once`). Dentro: si no está abierto, `true`; si no, diálogo `{ type: 'warning', message, detail, buttons: [confirm, cancel], defaultId: 0, cancelId: 1 }`; respuesta distinta de 0 → `false`; si no, `quit()`.

- [ ] **Step 1: Tests (rojos, el módulo no existe)** en `djProcesses.test.ts`, con `processes` falsos (`vi.fn`) y `ask` falso que resuelve cuando el test quiere:
  - `it('lets a write through without asking when the program is closed')`: `isRunning` → false; `true`, `ask` y `quit` no llamados.
  - `it('refuses the write and leaves the program open when the user declines')`: running, `ask` → 1; `false`, `quit` no llamado.
  - `it('closes the program when the user accepts and reports whether it closed')`: running, `ask` → 0, `quit` → false; resultado `false` y `quit` llamado una vez. Repetir con `quit` → true.
  - `it('asks Traktor once for two writes that arrive together, in the first one's words')`: dos llamadas simultáneas `('traktor', w, 'cues')` y `('traktor', w, 'playlists')`; `ask` una sola vez con `detail === t('traktorQuitDetailCues')`; ambas reciben la misma respuesta. Igual para Engine con `'cues'` y `'usb'`.
  - `it('asks rekordbox again in its own words for a second write of another kind')`: `('rekordbox', w, 'convert')` y `('rekordbox', w, 'playlists')` simultáneas; `ask` dos veces, la segunda solo después de que la primera resuelva, con `detail` `rekordboxQuitDetail` y luego `rekordboxQuitDetailPlaylists`; `isRunning` consultado de nuevo antes del segundo diálogo.
  - `it('asks rekordbox once for two writes of the same kind')`.
  - `it('uses each program's own words')`: un `it.each` sobre `QUIT_REASONS` que comprueba message/confirm/cancel/detail con las claves de hoy (lista literal en el test, no derivada de `QUIT_TEXT`).
  - `it('opens the dialog without a parent when there is no window')`: `ask` recibe `null`.
  - Un `// @ts-expect-error` en una línea `ensureClosed('rekordbox', null, 'cues')` dentro de un `it('refuses at compile time a reason the program has no words for')` (única directiva permitida).
- [ ] **Step 2:** Correr el fichero: falla por módulo inexistente.
- [ ] **Step 3:** Implementar `djProcesses.ts` con las firmas de Interfaces.
- [ ] **Step 4:** Fichero verde, tres typecheck limpios.
- [ ] **Step 5: Mutation check.** Poner `traktor: 'perReason'`: debe fallar el test de Traktor una vez. Poner `rekordbox: 'once'`: debe fallar el de rekordbox dos veces. Quitar la comprobación de `isRunning` antes del diálogo: debe fallar el primero. Restaurar.
- [ ] **Step 6: Commit** `git commit -m "Ask to close any DJ program from one place, with each program's words and prompt sharing"`

### Task 2: `index.ts` usa `createEnsureClosed` y `DJ_PROCESSES`

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (borrar `engineQuitPrompt`, `ensureEngineDjClosed`, `traktorQuitPrompt`, `ensureTraktorClosed`, `rekordboxQuitPrompt`, `ensureRekordboxClosed` — hoy ~líneas 690-818 — y cambiar cada llamada: las 3 funciones y las `is*Running()` sueltas, ~35 sitios; localizar por contenido)

**Interfaces:**
- Consumes: `createEnsureClosed`, `DJ_PROCESSES` (Task 1).
- Produces: dentro de `index.ts`, `const ensureClosed = createEnsureClosed({ processes: DJ_PROCESSES, ask: (win, opts) => (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).then((r) => r.response), t: (key) => createMenuT(menuLocale())(key) })`. El `t` se crea en cada pregunta (hoy `createMenuT(menuLocale())` se llama dentro de cada diálogo para seguir el idioma actual).

Traducción de llamadas (mismo comportamiento):
- `ensureEngineDjClosed(win)` → `ensureClosed('engine', win)`; `ensureEngineDjClosed(win, 'engineQuitDetailCues')` → `ensureClosed('engine', win, 'cues')`; `…DetailUsb` → `'usb'`; `…DetailRestore` → `'restore'`. Igual con Traktor (`cues`, `playlists`, `restore`) y rekordbox (`playlists`, `usb`, `restore`).
- Las dependencias que otros módulos reciben con el nombre viejo (`ensureRekordboxClosed`, `ensureEngineDjClosed`, `ensureTraktorClosed` en `libraryFlushes`, `damageWiring`, `duplicateReplace`, `traktorSyncFlush`, `usbExport`, `usbExportIpc`, harness) conservan su nombre y firma: se cablean con una flecha a `ensureClosed(program, win, reason)` con el mismo motivo que hoy. Si alguno recibe hoy la función con un parámetro `detail` y le pasa una clave, convertir esa clave al motivo en el cableado; si la clave viaja más lejos como valor, parar y reportar.
- `isRekordboxRunning()` / `isTraktorRunning()` / `isEngineDjRunning()` en `index.ts` → `DJ_PROCESSES.rekordbox.isRunning()` etc.
- Borrar importaciones que queden sin uso.

- [ ] **Step 1:** Hacer el cambio. No debe quedar en `index.ts` ninguna mención de `QuitDetail` ni `QuitMessage` (comprobar con `grep -n "Quit\(Detail\|Message\|Confirm\|Cancel\)" src/main/index.ts`: vacío).
- [ ] **Step 2:** Tres typecheck limpios; suite completa (mismo recuento + los de la Tarea 1); biome.
- [ ] **Step 3: Mutation check.** En el cableado, cambiar el motivo de las ediciones de playlist de Traktor a `'cues'`: algún test existente debe fallar (si ninguno lo detecta, anotar el sitio como no cubierto en el informe; no añadir tests de `index.ts`). Restaurar.
- [ ] **Step 4: Commit** `git commit -m "Wire every close-the-program prompt in the main process through the shared one"`

### Task 3: Cierre del bloque

- [ ] **Step 1:** Suite, tres typecheck, biome, y matriz completa (`SURCO_MATRIX=1 … run src/scenarios/matrix/full.test.tsx`): mismas 126 bien y los mismos 4 fallos.
- [ ] **Step 2: Sonda de Serato.** Añadir temporalmente `'serato'` a `DjProgram`: los tres `tsc` deben fallar también en `DJ_PROCESSES`, `QUIT_REASONS`, `QUIT_TEXT` y `QUIT_PROMPT_SHARING`. Revertir y actualizar `docs/superpowers/plans/2026-11-03-serato-mapa.md` con la lista nueva de errores.
- [ ] **Step 3: Prueba manual con el driver** en perfil aislado (`--user-data-dir` con copia de `~/Library/Application Support/surco/settings.json`), con rekordbox, Traktor y Engine cerrados: guardar un cue en Engine y deshacerlo (como en el bloque 1, con copia de `m.db` y comprobación byte a byte) para ver que el camino "programa cerrado → escribe sin preguntar" sigue igual.
- [ ] **Step 4:** `git merge main` en la rama, suite, y `git merge --ff-only serato` en el main local (sin push).
