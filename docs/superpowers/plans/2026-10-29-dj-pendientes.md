# Pendientes de "Añadir a programas DJ" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los pendientes del merge d517461cf: que las altas de Engine DJ esperen en su cola con Engine abierto, que la cola no anuncie altas de pistas que el programa ya tiene, que el botón no nombre programas inalcanzables y traducir dos textos en japonés.

**Architecture:** Las altas sin playlist de Engine pasan, como las de Traktor, por `libraryTrackOps` → cola de Engine (`engineCueQueue`), cuyo planificador (`planEngineTrackPlaylists`, `engineTrackPlaylists.ts`) ya sabe dar de alta (`addTrack`). `processTrack` sigue registrando al momento con Engine cerrado; con Engine abierto se lo salta sin error. Un predicado `known` evita encolar altas de pistas que ya están en la colección.

**Tech Stack:** Electron + React 19 + TS, Vitest, Biome, i18next.

**Spec:** `docs/superpowers/specs/2026-10-29-anadir-a-programas-dj-design.md` (decisión 8 enmendada el 29/10, segunda tanda)

## Global Constraints

- Comandos en `apps/desktop`: `npx vitest run <ruta>`, `npm test`, `npm run lint`, `npx tsc --build`.
- No se añaden comentarios en el código. Los comentarios existentes que describan código cambiado se corrigen.
- Textos en los seis idiomas: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR,ja}.json`.
- Selectores en tests: `data-testid`. Commits: título en inglés, sin cuerpo ni prefijos.
- Una pista que ya está en la colección nunca se duplica ni pierde sus playlists.

## Review Focus

1. Engine abierto al convertir con Engine en 'add': la conversión termina sin error, la pista entra en la cola de Engine y se da de alta al cerrar Engine, con su carátula embebida. Task 2.
2. Engine cerrado: la pista se registra al momento (como hoy) y la operación encolada después no la duplica. Task 2.
3. Engine en 'update' (no 'add'): ni alta inmediata ni operación de alta en la cola. Task 2.
4. Pista que Traktor ya tiene, con Traktor abierto y en 'add': no aparece en la píldora de la cola. Task 1.
5. Traktor en 'add' sin `collection.nml` configurado, o un programa no encontrado: el botón no lo nombra. Task 1.

---

### Task 1: La cola y el botón solo nombran lo que de verdad pasa; japonés

**Files:**
- Modify: `src/main/rekordboxQueueFromRun.ts` (`libraryTrackOps`), `src/main/libraryFlushes.ts` (llamada de Traktor)
- Modify: `src/renderer/src/lib/djReach.ts` (`reachedPrograms`), `src/renderer/src/components/Editor.tsx:1803`
- Modify: `src/renderer/src/i18n/locales/ja.json` (`editor.convertAllBeside`, `editor.convertAllOverwrite`)
- Test: `src/main/rekordboxQueueFromRun.test.ts`, `src/main/libraryFlushes.test.ts`, `src/renderer/src/lib/djReach.test.ts`, el test del Editor que cubre el botón

**Interfaces:**
- Produces: `libraryTrackOps(repoints, library, newId = randomUUID, addNew = false, known?: (path: string, from?: string) => boolean)`. Un op de solo alta no se emite cuando `known(r.to, r.from)` es true. `reachedPrograms(s, reachable?: ReadonlySet<DjLibraryId>)`: con `reachable`, filtra también por él.

- [ ] **Step 1: Tests que fallan.**
  - `libraryTrackOps`, `'does not queue adding a track the collection already has'`: `known` devuelve true → `[]`; con `known` false → el op de alta de siempre.
  - `libraryFlushes`, `'asks the Traktor collection which converted tracks it already has'`: con un NML de fixture que contiene la ruta convertida y `addToTraktor: true`, no se encola ningún op de alta para esa pista (Review Focus 4).
  - `reachedPrograms({ addToTraktor: true, … }, new Set(['rekordbox']))` → `[]`; sin `reachable` → `['traktor']`.
  - Editor: con Traktor en 'add' y la biblioteca de Traktor no encontrada (o sin `traktorNmlPath`), el botón no dice "Traktor" (Review Focus 5).
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3: Implementar.**
  - En `libraryFlushes`, construir `known` para Traktor leyendo una vez el NML de `settings.traktorNmlPath` con `traktorCollectionIndex` (`traktorPlaylistEdit.ts`) y el volumen de arranque (`bootVolumeName`). Si el NML no se puede leer, `known` es `undefined` y se mantiene el comportamiento de hoy.
  - En el Editor, `reachable` sale del estado de bibliotecas que ya usa el renderer (`window.api.libraryStatus()`, ver `useMusicReview.ts:269`): un programa es alcanzable si su biblioteca está `found`, y Traktor además necesita `traktorNmlPath`.
  - Traducir al japonés las dos claves, con el mismo estilo que las demás `convert*` de `ja.json`.
- [ ] **Step 4:** Los tests pasan; `npx tsc --build` y lint limpios.
- [ ] **Step 5:** Commits: `Leave tracks a DJ program already has out of its add queue and the convert button off programs Surco cannot reach` y `Translate the Japanese batch beside and overwrite convert labels`.

### Task 2: Las altas de Engine DJ esperan en su cola con Engine abierto

**Files:**
- Modify: `src/main/processTrack.ts:341` y el stage `engineDj` (~561)
- Modify: `src/main/rekordboxQueueFromRun.ts` (`libraryTrackOps` para `'engine'`), `src/main/libraryFlushes.ts:~223` (llamada de Engine)
- Modify: `src/main/engineTrackPlaylists.ts` (op `add` con `wanted: []`), `src/main/index.ts` (deps de `processTrack`; `addsTracks` de `engineCueQueue`)
- Test: `src/main/processTrack.test.ts`, `src/main/rekordboxQueueFromRun.test.ts`, `src/main/engineCuesWrite.test.ts` (o el de `engineTrackPlaylists`), y un escenario en `src/scenarios/` siguiendo `scenarios/engineDj.test.tsx`

**Interfaces:**
- Consumes: `libraryTrackOps(..., addNew, known)` de la Task 1.
- Produces: `ProcessDeps.isEngineDjRunning?: () => Promise<boolean>` sustituye a `ensureEngineDjClosed` en el camino de conversión; `ProcessResult` gana `engineDjQueued?: true`.

- [ ] **Step 1: Tests que fallan.**
  - `processTrack`, `'leaves the Engine add to its queue while Engine DJ is open'`: `addToEngineDj: true`, `isEngineDjRunning` → true ⇒ no lanza, no llama a `deps.addToEngineDj`, el resultado lleva `engineDjQueued: true` y no `engineDjError`.
  - `processTrack`, `'registers in Engine DJ right away while it is closed'`: `isEngineDjRunning` → false ⇒ llama a `deps.addToEngineDj` como hoy.
  - `libraryTrackOps(repoints, 'engine', id, true, known)` emite op de alta (`add: true`, `wanted: []`, con `meta`) para pistas no conocidas, y nada si `known` es true o `addNew` es false (Review Focus 3).
  - Planificador de Engine, `'adds an Engine track for an add op with no playlists'` y `'leaves an Engine track already in the library untouched for an add op'` (sin escribir la base de datos) (Review Focus 2).
  - Escenario: con Engine abierto (mock del detector), convertir con Engine en 'add' ⇒ la conversión acaba bien, la base de Engine no cambia, la cola tiene la pista; al cerrar Engine la pista está en `Track` con `albumArtId` (Review Focus 1).
- [ ] **Step 2:** Los tests fallan.
- [ ] **Step 3: Implementar.**
  - En `processTrack`: el chequeo de la línea 341 deja de preguntar. Con Engine en marcha, se omite el stage `engineDj` y se marca `engineDjQueued`.
  - En `libraryFlushes`: llamar a `libraryTrackOps(repoints, 'engine', randomUUID, getSettings().addToEngineDj, knownEngine)`. `knownEngine` se construye leyendo la base de Engine en solo lectura con lo que ya use el código para encontrar filas por ruta (`engineRowFinder`). Si no se puede leer, es `undefined`.
  - En el planificador de Engine: un op con `add` y `wanted` vacío da de alta con `addTrack` si no encuentra la pista, y si la encuentra devuelve `applied: true` sin escribir.
  - En `index.ts`: pasar `isEngineDjRunning` (el mismo detector que usa `ensureEngineDjClosed`) y poner `addsTracks: true` en `engineCueQueue`, para que la píldora diga "se añade a la colección".
  - El renderer no necesita cambios si `engineDjQueued` no cambia la presentación; si algún sitio muestra `engineDjError`, comprobar que una pista encolada no sale como fallida.
- [ ] **Step 4:** Los tests y el escenario pasan, `npm test` entero en verde, y `tsc` y lint limpios.
- [ ] **Step 5:** Commit: `Queue Engine DJ adds while Engine is open instead of failing the conversion`.

### Task 3: Documentación

- [ ] Actualizar `docs/funcionalidades.md` (la subsección "Añadir a rekordbox, Traktor y Engine DJ al convertir" y los límites que mencionan que Engine no encola). Commit: `Describe Engine DJ adds waiting in their queue in the feature inventory`.
