# Bloques 6h y 6i: el renderer tras convertir — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el estado de cada pista y las superficies del renderer relacionadas con las bibliotecas tras convertir decidan por programa desde tablas `Record<DjProgram, …>`, sin cambiar la forma de los datos guardados (sesión, ajustes, trabajo de conversión) ni el comportamiento.

**Architecture:** Los campos de datos con nombre por programa se quedan (`fromRekordbox`/`fromTraktor`/`fromEngine`, `{rekordbox,traktor,engine}Playlists(Base)`, ajustes `sync*`/`addTo*`/`*PlaylistsFieldOffered`): cambiarlos rompería sesiones y ajustes guardados de los usuarios. Lo que pasa a tablas es quién los lee y escribe: una tabla `TRACK_FIELDS: Record<DjProgram, { flag: keyof TrackItem; playlists: keyof TrackItem; playlistsBase: keyof TrackItem }>` (o equivalente con los nombres reales) en el renderer, y una tabla por programa con las claves de ajustes (`sync`, `addTo`, ruta), reutilizando `DJ_REACH_SETTINGS` / `OFFERED` / `PLAYLIST_FIELDS` si ya cubren algo. Los sitios con cadenas de `if` o listas escritas a mano recorren los programas con esas tablas.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md` (bloque 6). Inventario: `docs/superpowers/plans/2026-11-03-bloque-6-inventario.md` (6h, 6i, sección 4).

## Global Constraints

- Refactor puro: ningún test existente cambia lo que afirma (sí montaje). Los datos guardados (JSON de sesión, `settings.json`, `ProcessJob` enviado al proceso principal) no cambian de forma ni de contenido. Sin comentarios nuevos. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout` con trabajo sin commitear.
- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato`, rama `serato`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`).
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
- `dirty.ts` codifica la firma de playlists distinto por programa (rekordbox sin etiqueta, los otros con `['traktor', …]`): la firma resultante debe ser idéntica byte a byte (afecta a qué se marca como "sin guardar").
- Orden de los tres programas en cada sitio: el de hoy en ese sitio.

---

### Task 1 (6h): estado de las pistas

**Sitios** (localizar por contenido; líneas del inventario): `hooks/useTrackProcessing.ts:441-446` (seis campos del trabajo) y `:191` (refresco de membership solo de rekordbox: conservar esa diferencia como campo de tabla), `lib/sessionEdits.ts:43-45, 57-62`, `hooks/useTrackLibrary.ts:518-536` (restaurar sesión) y `:993-1008` (bandera de filas nuevas, la "bandera de filas nuevas" del mapa), `lib/dirty.ts:13-15, 45-47`, `lib/rekordboxPlaylists.ts:19-23` `EDIT_KEYS` (pasar a `Record<DjProgram, …>`), `lib/outputName.ts:22-24`, `lib/triage.ts:226-228` si decide por programa.

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte:** firma de `dirty` con playlists de Traktor y de Engine (hueco del inventario: hoy sin casos); guardar y restaurar la sesión de una pista con playlists de los tres programas devuelve lo mismo; una fila nueva abierta desde cada pestaña lleva su bandera (Engine: ninguna, como hoy).
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** Tabla(s) y sustituciones.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación:** intercambiar en la tabla los campos de playlists de traktor y engine → falla un test; cambiar la codificación de rekordbox en `dirty` para que lleve etiqueta → falla un test. Deshacer editando.
- [ ] **Step 6: Commit** `git commit -m "Read and write each track's per-program library fields through one table"`

### Task 2 (6i): superficies

**Sitios:** `components/Editor.tsx:1129-1134` (tres `usePlaylistsSpec`: las reglas de hooks obligan a llamarlos uno a uno; lo que sí pasa a tabla es el objeto que se arma con ellos, tipado `Record<DjProgram, …>`), `:332-334, 371-381` (consulta de estado de biblioteca con tres `addTo` y tres rutas → leer de la tabla de ajustes), `:566` `librarySourceOf`, `:1865` `reachedPrograms`, `lib/librarySource.ts:33`, `components/SourceIcons.tsx:72` `LIBRARY_ICON` (tiparlo `Record<DjProgram, …>`), `components/PlaylistsField.tsx` valores por defecto `'rekordbox'` (:447, :480; conservar el comportamiento), `components/MusicReview.tsx:217-221, 449` y `MusicReviewDetail.tsx:39-43, 289-291, 501-503` (`LIBRARIES` y la regla "Traktor no cuenta 'replaced' como retenido": usar `KEEPS_REPLACED` del 6f si está accesible desde el renderer vía `shared`, o una tabla equivalente en `shared`), `App.tsx:802-830` (colas por programa) y `:1122-1145` (avisos de problemas de sincronización: rekordbox y Engine), `components/settings/DestinationTab.tsx:172, 339, 434` (tres filas colocadas a mano: recorrer los programas si el orden y los textos lo permiten sin cambiar la pantalla; si no, dejarlas y anotarlo), `lib/settingsContext.tsx:72-74, 132-134, 191-193`, `lib/settingsDraft.ts:26-43, 136-153`.

- [ ] **Step 1: Caracterización (verde con el código actual), solo lo que falte**, en los componentes afectados: textos/orden de las tres bibliotecas en la revisión de Música, que Traktor no cuente como retenido, iconos por programa, avisos de sincronización solo para rekordbox y Engine.
- [ ] **Step 2:** Verdes con el código actual.
- [ ] **Step 3:** Sustituciones.
- [ ] **Step 4:** Suite, tres typecheck, biome.
- [ ] **Step 5: Mutación** por cada tabla nueva: un valor cambiado hace fallar un test (añadirlo si no).
- [ ] **Step 6: Commit** `git commit -m "Build the editor, review, queue and settings surfaces from per-program tables"`

### Task 3: Cierre

- [ ] Matriz completa igual que la base; sonda de Serato y mapa (quitar de "Añadidos a mano" lo resuelto: banderas de filas nuevas, invalidaciones de membership, `cuesOpen` si se tocó); prueba manual con el driver en perfil aislado (abrir pistas de cada pestaña, editor, ajustes > Destino, revisión de Música si hay datos) comprobando que se ve igual; `git merge main`, suite, `git merge --ff-only serato` en el main local.
