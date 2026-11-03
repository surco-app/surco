# Bloque 6j: USB por programa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la exportación a USB elija su exportador por programa desde un `Partial<Record<DjProgram, UsbExporter>>` en lugar de "rekordbox o Engine" por posición y por `source === 'engine'`, de modo que añadir el USB de un programa consista en registrar su exportador, sin cambiar comportamiento.

**Architecture:** `main/usbExportRoute.ts` `routeUsbExports(rekordbox, engine)` pasa a `routeUsbExports(exporters: Partial<Record<DjProgram, UsbExporter>>)`: elige por el programa de la petición, y `cancel`/`stop`/`busy` recorren los exportadores registrados (hoy: cada uno rechaza mientras "el otro" está ocupado; se conserva como "mientras cualquier otro registrado está ocupado"). El programa de la petición sale de una función `usbProgramOf(req: UsbExportRequest): DjProgram` que conserva el formato de hoy (`source?: 'engine'`; ausente = rekordbox), para no cambiar lo que viaja por IPC. `main/usbExportIpc.ts` (hoy sin tests) gana tests de caracterización antes de tocarlo; sus opciones por programa (`collection`/`engineLibrary`, dos `ensure*Closed` con clave de texto, dos ficheros de memoria) se agrupan en un registro por programa si el cambio es literal; si alguna pieza es intrínsecamente de un programa (la memoria de Engine en `readVolumes`, `usb:pickFolder(from?: 'engine')`), se queda y se anota. En el renderer, `App.tsx` (`useUsbVolumes(... === 'engine')`, `source={usbModal.source === 'engine' ? …}`, `openUsbExport`/`usbSource` con `'rekordbox'` por defecto) lee el programa del modal y una tabla de lo que cada exportador necesita; `UsbExportModal.tsx` (ramas `engine`) pasa a recibir el programa y leer sus diferencias de una tabla `USB_PROGRAMS: Partial<Record<DjProgram, …>>` si son datos (textos, campos), dejando como están las ramas que son flujo distinto.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md` (6j, sección 5).

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí montaje). El formato de `UsbExportRequest` y `UsbVolume` que viaja por IPC no cambia. Sin comentarios nuevos. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
- No se exporta a ningún USB real en las pruebas.

---

### Task 1: rutas y canales del USB en el proceso principal

- [ ] **Step 1: Caracterización (verde con el código actual):** tests nuevos de `usbExportIpc.ts` (hueco del inventario): cada canal (`usb:*`) llama al exportador del programa de la petición; con un exportador ocupado el otro rechaza; `cancel`/`stop` llegan al que está ocupado; el cierre del programa se pide con su texto de USB (`rekordboxQuitDetailUsb` / `engineQuitDetailUsb`). Más lo que falte en `usbExportRoute.test.ts`.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** `routeUsbExports` por registro, `usbProgramOf`, y `usbExportIpc` agrupado por programa donde sea literal; `index.ts` cablea el registro.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación:** elegir siempre el exportador de rekordbox → falla un test; que "ocupado" mire solo el propio → falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Route each USB export to its DJ program's exporter from one registry"`

### Task 2: el USB en el renderer

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte:** desde la pestaña Engine el modal se abre con Engine y lee los volúmenes con la memoria de Engine; desde rekordbox, con rekordbox; los textos/campos que cambian por programa en `UsbExportModal`.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** `App.tsx` y `UsbExportModal.tsx` leen el programa y una tabla; ramas de flujo distinto se quedan (anotarlas).
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación** por tabla nueva.
- [ ] **Step 6: Commit** `git commit -m "Open the USB export for the tab's DJ program and read its differences from a table"`

### Task 3: Cierre

- [ ] Matriz completa igual que la base (incluye `scenarios/usb.test.tsx` en la suite normal); sonda de Serato y mapa (quitar lo de USB de "Añadidos a mano" si queda resuelto); `git merge main`, suite, `git merge --ff-only serato` en el main local.
