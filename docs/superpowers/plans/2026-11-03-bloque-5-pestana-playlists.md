# Bloque 5: pestaña y playlists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la pestaña de fuentes y sus playlists decidan por programa leyendo dos tablas exhaustivas del renderer (cómo se lee cada programa, y qué permite), de modo que añadir Serato a la pestaña consista en escribir su módulo de canales en el proceso principal y rellenar sus filas, forzado por el compilador, sin cambiar ningún comportamiento.

**Architecture:** En el proceso principal cada programa ya tiene su propio módulo de canales (`rekordboxPlaylistsIpc.ts`, `traktorPlaylistsIpc.ts`, `enginePlaylistsIpc.ts`, más membership y edición); no se tocan. En el renderer, `renderer/src/lib/sourcePrograms.ts` gana `SOURCE_READ: Record<DjProgram, SourceRead>` (funciones de `window.api` por programa) y `SOURCE_PROGRAMS: Record<DjProgram, SourceProgram>` (capacidades). Los ternarios y literales de `useSourceBrowser`, `useRekordboxPlaylists`, `useRekordboxEdits`, `playlistEdits`, `rekordboxPlaylists`, `PlaylistsField`, `useTrackLibrary`, `App.tsx`, `GeneralTab` pasan a leer de ahí. El orden del carril (rekordbox, engine, traktor) pasa por `programsInOrder`.

**Tech Stack:** TypeScript estricto, React 19, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 5). Inventario del 03/11 resumido en el propio plan.

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí importaciones, nombres o montaje). La forma de `window.api` NO cambia en este bloque (las tablas apuntan a los métodos que ya existen), así que los mocks de `window.api` de los tests no cambian.
- Sin comentarios nuevos (una `// @ts-expect-error` por test de compilación). Commits: título en inglés, sin cuerpo ni prefijos.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato` (comprobar antes de cada commit); `node_modules` enlazado. No usar `git checkout` para deshacer mutaciones con trabajo sin commitear.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Formato: `cd apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome check <ficheros>`.
- Base (03/11, `6d0f2dfca`): suite 14863 bien / 253 saltados; tres typecheck limpios; matriz 126 bien, 1 saltada, 4 fallos previos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey).
- Las claves de caché de TanStack (`['source-tree', src]`, `` `${library}-membership` ``, `['source-available', p]`, `['traktor-can-save', …]`) y los `data-testid` se conservan tal cual.
- El orden del carril y de ajustes/ocultas es appleMusic, rekordbox, engine, traktor (distinto de `DJ_PROGRAMS`); se conserva.

## Review Focus

- Rekordbox como "else" por defecto en `readRecentCount`/`readTrackCount` (`useSourceBrowser.ts:63-71`): con la tabla, cada programa lee su función; Apple Music no tiene recuentos (comprobar qué hace hoy para appleMusic y conservarlo). Test en la Tarea 1.
- Traktor: el recuento y la playlist de Recently added cuentan separadores, el de All tracks no (vive en main; no cambia). Nada que tocar, pero ningún cambio del renderer puede filtrar.
- Editable: rekordbox siempre, Traktor solo con colección confirmada, Engine nunca. Test en la Tarea 2.
- Traktor fijo: `HISTORY` bloqueado y `Preparation`/built-ins solo pistas en la raíz; los nodos bloqueados no salen como destino de menú. Test en la Tarea 2 (hueco 5 del inventario).
- Engine: sin bandera de librería en `useTrackLibrary` (no refresca vista previa) y solo rekordbox rellena BPM/tono/estrellas de filas ya cargadas. Test en la Tarea 2 (hueco 6).

---

### Task 1: `SOURCE_READ` y el orden del carril

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/sourcePrograms.ts`, `sourcePrograms.test.ts`
- Modify: `renderer/src/hooks/useSourceBrowser.ts` (37-43 `readTree`, 63-71 recuentos, 101-107 `readPlaylist`, 134-154 disponibilidad y orden del carril, 169 `hasRecent`, 251-253 invalidación de membership)
- Modify: `renderer/src/hooks/useRekordboxPlaylists.ts` (20-36 `READ` → `SOURCE_READ`; 38-42 `OFFERED` pasa a `Record<DjProgram, …>` explícito)
- Modify: `shared/hiddenSources.ts:3` y `renderer/src/components/settings/GeneralTab.tsx:18` (listas de fuentes derivadas de `['appleMusic', ...RAIL_PROGRAMS]`) y `GeneralTab.tsx:37-59` (disponibilidad por `SOURCE_READ`)

**Interfaces:**
- Consumes: `DjProgram`, `programsInOrder` (`shared/djProgram.ts`), `window.api` actual.
- Produces:
  - `export const RAIL_PROGRAMS = programsInOrder(['rekordbox', 'engine', 'traktor'])` en `shared/djProgram.ts` (lo usan `hiddenSources.ts` en shared y el renderer).
  - `export interface SourceRead { available(): Promise<boolean>; tree(): Promise<SourceNode[]>; recentCount(): Promise<number>; trackCount(): Promise<number>; playlist(id: string): Promise<SourcePlaylistEntry[]>; membership(paths: string[]): Promise<Record<string, string[]>> }`
  - `export const SOURCE_READ: Record<DjProgram, SourceRead>` con los métodos existentes (`rekordboxAvailable`, `loadRekordboxTree`, `rekordboxRecentCount`, `rekordboxTrackCount`, `loadRekordboxPlaylist`, `rekordboxMembership`; ídem `traktor*`, `engine*`). Cada entrada llama a `window.api` en el momento (funciones flecha), no guarda la referencia al cargar el módulo (los tests sustituyen `window.api`).

- [ ] **Step 1: Tests de caracterización (verdes con el código actual)**, solo los que falten en `useSourceBrowser.test.tsx` / `useRekordboxPlaylists.test.tsx` (buscar antes): recuentos de All tracks y Recently added de Traktor y de Engine piden SU método (spy) y no el de rekordbox; la playlist de Traktor y la de Engine llaman a su `load*Playlist`; abrir Apple Music no llama a ningún recuento de programa; el orden del carril es appleMusic, rekordbox, engine, traktor.
- [ ] **Step 2:** Correrlos contra el código actual: verdes.
- [ ] **Step 3:** `sourcePrograms.test.ts`: `SOURCE_READ.traktor.trackCount()` llama a `window.api.traktorTrackCount` (mock), etc. por programa y método (un `it.each` con lista literal), y `RAIL_PROGRAMS` es `['rekordbox','engine','traktor']`. Rojo.
- [ ] **Step 4:** Implementar y sustituir. Al terminar, `grep -nE "loadRekordboxTree|loadTraktorTree|loadEngineTree|(rekordbox|traktor|engine)(RecentCount|TrackCount|Available|Membership)\(|load(Rekordbox|Traktor|Engine)Playlist" src/renderer/src --include=*.ts --include=*.tsx | grep -v test | grep -v sourcePrograms.ts` solo puede devolver usos que no sean de pestaña/playlists (anotar cuáles en el informe).
- [ ] **Step 5:** Suite, tres typecheck, biome.
- [ ] **Step 6: Mutation check.** Intercambiar `trackCount` de traktor y engine en `SOURCE_READ`: falla un test. Poner `RAIL_PROGRAMS` en orden `DJ_PROGRAMS`: falla el test de orden. Deshacer editando.
- [ ] **Step 7: Commit** `git commit -m "Read each DJ program's tab through one table and keep the rail order in one place"`

### Task 2: `SOURCE_PROGRAMS`, lo que cada programa permite en la pestaña

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/sourcePrograms.ts`, `sourcePrograms.test.ts`
- Modify: `renderer/src/hooks/useSourceBrowser.ts` (226-232 separador, 270 `libraryMissing`), `renderer/src/hooks/useRekordboxEdits.ts` (17, 36-38, 46-47), `renderer/src/lib/playlistEdits.ts:81-84`, `renderer/src/lib/rekordboxPlaylists.ts:169`, `renderer/src/components/PlaylistsField.tsx:17-18`, `renderer/src/hooks/useTrackLibrary.ts:915-916, 953`, `renderer/src/App.tsx` (792-803 `editableSource`, 2502-2510 `traktorFixed`, 2565 filtro de destinos, 3252-3259 props del árbol, 879-917 fuente del USB), `renderer/src/hooks/useRekordboxPlaylists.ts:135-144` (`usePlaylistsSpec`)
- Test: los ficheros de test de cada uno (añadir lo que falte)

**Interfaces:**
- Consumes: `SOURCE_READ`, `programOf`, `DjProgram`.
- Produces: `export interface SourceProgram` y `export const SOURCE_PROGRAMS: Record<DjProgram, SourceProgram>` con exactamente lo que codifican hoy los literales:
  - `separator: (() => Promise<boolean>) | null` — rekordbox `rekordboxHasSeparator`, traktor `traktorHasSeparator`, engine `null`.
  - `edit: { save: (edit, label?) => Promise<RekordboxEditResult>; messagePrefix: string; gate: 'none' | 'traktorCollection' } | null` — rekordbox `{ editRekordboxPlaylist, 'sources.edit.', 'none' }`, traktor `{ editTraktorPlaylist, 'sources.editTraktor.', 'traktorCollection' }`, engine `null`. Sustituye `editableSource`, el ternario de `useRekordboxEdits`, el prefijo de `editMessage` y el `disabled: 'unconfirmed'` de `usePlaylistsSpec`.
  - `fixedNode: ((node, depth) => 'locked' | 'tracks-only' | null) | null` — traktor la lógica actual de `traktorFixed` (`TRAKTOR_BUILT_IN` / `TRAKTOR_HISTORY` en la raíz), resto `null`. Sustituye `fixed={source==='traktor' ? …}` y el filtro de destinos de menú (2565).
  - `usb: boolean` — rekordbox `true`, engine `true`, traktor `false` (conservar las condiciones extra de hoy: rekordbox cuando está en las fuentes, Engine cuando no falta la librería).
  - `missingLibraryCheck: boolean` — engine `true`, resto `false` (`libraryMissing`).
  - `trackFlag: 'fromRekordbox' | 'fromTraktor' | 'fromEngine' | null` y `refreshesPreview: boolean` / `fillsLoaded: boolean` según hoy (`libraryFlag` es null para Engine; solo rekordbox rellena lo ya cargado) — usar los nombres de campo reales del código.
  - `addsUncollected: boolean` — rekordbox `true`, resto `false` (`withTarget`).
  - `fieldTestIdPrefix: string` — rekordbox `''`, traktor y engine lo que hoy produce el ternario de `PlaylistsField`.
  - `membershipKey: string` — `` `${program}-membership` `` (lo que hoy se invalida a mano; las invalidaciones de foco y de edición pasan a recorrer los programas que hoy invalidan: foco los tres, edición rekordbox y traktor — conservar esa diferencia con un campo `invalidatesOnEdit` o equivalente).
- Ninguna comparación `=== 'traktor'`, `=== 'engine'`, `=== 'rekordbox'` ni ternario por programa queda en los sitios listados (anotar en el informe cualquier sitio de la lista que no encaje y por qué).

- [ ] **Step 1: Tests de caracterización (verdes con el código actual)**, solo los que falten: mensaje de rechazo de una edición de Traktor usa el prefijo `sources.editTraktor.`; una edición en Traktor no invalida `engine-membership`; en App, `HISTORY` de Traktor no admite cambios y `Preparation` solo pistas, y un nodo bloqueado no sale como destino; Engine no ofrece editar el árbol; la pestaña Engine sin librería muestra el aviso y las demás no; un track abierto desde Engine no marca bandera de librería ni refresca vista previa, y solo rekordbox rellena BPM/tono/estrellas de filas ya cargadas.
- [ ] **Step 2:** Correrlos contra el código actual: verdes.
- [ ] **Step 3:** `sourcePrograms.test.ts` fija los valores de `SOURCE_PROGRAMS` por programa (lista literal). Rojo.
- [ ] **Step 4:** Implementar y sustituir, sitio por sitio.
- [ ] **Step 5:** Suite, tres typecheck, biome.
- [ ] **Step 6: Mutation check:** `engine.edit` = el de rekordbox → falla el test de "Engine no edita"; `traktor.fixedNode = null` → falla el de HISTORY; `traktor.edit.messagePrefix = 'sources.edit.'` → falla el de mensaje; `engine.missingLibraryCheck = false` → falla el aviso; `engine.trackFlag` = `fromEngine` → falla el de bandera. Si alguno no falla, añadir el test. Deshacer editando.
- [ ] **Step 7: Commit** `git commit -m "Read what each DJ program allows in the source tab from one table"`

### Task 3: Cierre del bloque

- [ ] **Step 1:** Suite, tres typecheck, biome y matriz completa: mismas 126 bien y los mismos 4 fallos.
- [ ] **Step 2: Sonda de Serato:** añadir `'serato'` temporalmente; los tres `tsc` deben fallar en `SOURCE_READ`, `SOURCE_PROGRAMS`, `RAIL_PROGRAMS` y `OFFERED`. Revertir. Actualizar `docs/superpowers/plans/2026-11-03-serato-mapa.md` (errores; quitar de "Añadidos a mano" lo resuelto: `hiddenSources`, `GeneralTab`, `playlistEdits`, comprobaciones de `browser.source` de pestaña; dejar las de USB si quedan; añadir los campos por programa de `TrackItem`/`SessionEdit`/ajustes `*PlaylistsFieldOffered` y los seis campos de playlists del trabajo de conversión, que siguen a mano y son del bloque 6).
- [ ] **Step 3: Prueba manual con el driver** (perfil aislado, programas cerrados, solo lectura): en cada programa abrir la pestaña, ver árbol, All tracks / Recently added con sus recuentos, abrir una playlist; en Traktor ver `HISTORY` bloqueado; en Engine que no se ofrece editar.
- [ ] **Step 4:** `git merge main` en la rama, suite, `git merge --ff-only serato` en el main local (sin push).
