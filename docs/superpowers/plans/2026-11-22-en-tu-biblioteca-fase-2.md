# Sección «En tu biblioteca» (fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la sección «En tu biblioteca» del editor muestre una fila por cada programa DJ que el usuario usa (rekordbox, Traktor, Engine DJ, Serato, VirtualDJ) donde ya esté la pista, y compare este archivo con la copia de cada uno.

**Architecture:** Main añade la duración a `CollectionTrack` en los cinco volcados de `dj:collection` y cachea el de rekordbox por mtime. El renderer convierte cada colección en candidatos con ruta, busca la pista con el mismo emparejador de Apple Music (que ahora devuelve la entrada, no solo un sí/no), mide cada copia con las consultas de copia que ya existen y pinta una fila por programa. La fila de Apple Music de la fase 1 no cambia; la de Engine pasa al mecanismo nuevo, que trae ruta y por tanto comparación.

**Tech Stack:** Electron (main + worker de colecciones), React 19 + TS, TanStack Query (`useQueries`), i18next, Vitest.

**Spec:** boceto aprobado https://claude.ai/artifact/7CdLo1sHpPDGLkDn4zHUKb, lámina «Propuesta: esta es la mejor, dos programas»; fase 1 en `docs/superpowers/plans/2026-11-22-en-tu-biblioteca.md` (mergeada, 9483286cb).

## Global Constraints

- Todo en `apps/desktop/src`, en un worktree. Cero comentarios nuevos. Commits con título, sin cuerpo ni prefijo. Selectores `data-testid`.
- Un programa cuenta si su ajuste de sincronizar o de añadir está activo (`DJ_REACH_SETTINGS[p].sync || .add` en `shared/djSettings.ts`). Sin ninguno de los dos, ni se lee su colección ni sale su fila.
- Orden fijo de filas: Apple Music, rekordbox, Traktor, Engine DJ, Serato, VirtualDJ. Nombres visibles exactamente así (son marcas, no se traducen).
- Una fila solo sale si la pista está en esa colección («no mostrar lo que no tenemos»). Una colección que falla al leerse no pinta fila ni error.
- Duración ausente, 0 o NULL en un programa → `undefined`, nunca `0` (el emparejador trata 0 como una duración real).
- Si la ruta de la copia es este mismo archivo (comparar con `pathKey` de `renderer/src/lib`), la fila sale sin formato, sin punto y sin flecha.
- Veredicto de cabecera = agregado de las filas: alguna `library` → `library`; si no, alguna `measuring` → `measuring`; si no, alguna `here` → `here`; si no, alguna `same` → `same`; si no, `null`. El punto ámbar va solo en las filas cuya copia gana a este archivo.
- «Sustituir igualmente» y todo lo de sustituir siguen siendo solo de Apple Music.
- La comprobación rápida (`replaceWarning`) sigue siendo solo de Apple Music.
- vitest siempre desde `apps/desktop` (`npx vitest run <ruta>`). Antes de cada commit: `npm run lint`, `npx biome check src`, `npx tsc --build` y la suite entera con `npm test; echo exit=$?` (exit 0).
- El código que corre en el worker de colecciones (`main/worker.ts`) no puede importar `electron`.

## Review Focus

1. Pista abierta desde la propia biblioteca de rekordbox (el caso más común): sale la fila rekordbox sin comparación, nada más. Test en Tarea 6.
2. Dos remixes con el mismo título en la colección: con duración tiene que elegir el de la duración cercana. Test en Tarea 3.
3. rekordbox abierto mientras Surco lee: la lectura es de solo lectura y no debe fallar; si falla, no hay fila. Test en Tarea 4 (consulta que falla → sin fila).
4. Colección grande (15.000 pistas): construir el índice no puede ocurrir en cada render. Test en Tarea 4 (el índice se construye una vez por dato).
5. Ajuste de programa desactivado: su colección no se lee. Test en Tarea 4.

---

### Task 1: Duración en los cinco volcados de colección

**Files:**
- Modify: `shared/types.ts:1256` (`CollectionTrack` gana `durationSec?: number`)
- Modify: `main/rekordboxPlaylists.ts:196` (`readRekordboxCollection`, añadir `c.Length` al SELECT)
- Modify: `main/seratoDatabase.ts:48` (leer `tlen`) y `main/seratoLibrary.ts:153`
- Modify: `main/virtualdjLibrary.ts:192` (pasar `lengthSeconds`)
- Modify: `main/traktorPlaylists.ts:253` (`INFO PLAYTIME_FLOAT`, si no `PLAYTIME`)
- Modify: el volcado de Engine detrás de `dj:collection` (`Track.length`)
- Test: los tests de cada lector junto a esos ficheros, con sus fixtures (`rekordboxPlaylistsFixture.ts`, `seratoDatabaseFixture.ts`, `virtualdjFixtures/database.xml`, `traktorPlaylistFixture.ts`, `enginePlaylistsFixture.ts`)

**Interfaces:**
- Produces: `CollectionTrack { contentId; path: string | null; title; artist; durationSec?: number }`.

- [ ] **Step 1: Tests que fallan.** Uno por programa: `reads the track length into durationSec` (valor del fixture en segundos, p. ej. rekordbox `Length 361` → `361`) y `leaves durationSec undefined when the length is missing or zero`. Serato: `tlen` es texto UTF-16; el test fija el formato con un fixture `"06:01.25"` → `361.25`; un texto que no se entiende → `undefined`.
- [ ] **Step 2: Ejecutarlos y verlos fallar.**
- [ ] **Step 3: Implementar** en cada lector. Serato: `parseSeratoLength(text: string): number | undefined` en `seratoDatabase.ts` que acepte `mm:ss`, `mm:ss.xx` y `h:mm:ss`.
- [ ] **Step 4: Verlos pasar, lint, tipos y suite.**
- [ ] **Step 5: Commit** `Read the track length in every DJ collection dump`

---

### Task 2: Caché del volcado de colección de rekordbox

**Files:**
- Modify: `main/rekordboxReads.ts:63` (la lectura `collection` deja de usar `fresh`)
- Modify/Test: `main/rekordboxCollection.ts:44` (`collectionMemo`) y su test

**Interfaces:**
- Consumes: el `collectionMemo` existente (clave mtime + tamaño de `master.db` y su `-wal`).

- [ ] **Step 1: Tests que fallan.** `returns the cached collection while master.db and its wal are unchanged` (dos lecturas seguidas abren la base una sola vez: espiar la apertura como hacen los tests de `membership`) y `reads again once the wal changes` (tocar el `-wal` → segunda apertura).
- [ ] **Step 2: Ejecutarlos y verlos fallar.**
- [ ] **Step 3: Pasar `collection` por `collectionMemo`** igual que `membership`, `marked` y `trackFinder`.
- [ ] **Step 4: Verlos pasar, lint, tipos y suite.**
- [ ] **Step 5: Commit** `Cache the rekordbox collection dump until the database changes`

---

### Task 3: El emparejador devuelve la entrada con su ruta

**Files:**
- Modify: `renderer/src/lib/appleMusicLibrary.ts` (`LibraryEntry` :11-20, `buildLibraryIndex` :195, `isInLibrary` :309)
- Modify: `shared/types.ts:1107` (`AppleMusicLookupCandidate` gana `path?: string`)
- Create: `renderer/src/lib/collectionCandidates.ts`
- Test: `renderer/src/lib/appleMusicLibrary.test.ts`, `renderer/src/lib/collectionCandidates.test.ts`

**Interfaces:**
- Produces:
  - `LibraryEntry` gana `path?: string`, copiado del candidato.
  - `findLibraryEntry(index: LibraryIndex, meta: { title: string; artist: string }, durationSec?: number): LibraryEntry | null`, con la misma puntuación, umbral y atajo de `isInLibrary`. Entre varias entradas que pasan el umbral devuelve la de mayor puntuación. `isInLibrary` pasa a ser `findLibraryEntry(...) !== null`, sin cambiar su firma.
  - `collectionCandidates(tracks: CollectionTrack[]): AppleMusicLookupCandidate[]`: `{ title, artist, durationSec, path }`, quitando las filas sin `path`.

- [ ] **Step 1: Tests que fallan.**
  - `returns the matched entry with its path`.
  - `picks the remix whose length is closest` (dos entradas «Never Leave U (Extended Mix)» y «Never Leave U (Radio Edit)» con 361 s y 180 s; buscando la Extended con 360 s devuelve la de 361 s).
  - `keeps isInLibrary answering as before` (los tests existentes de `isInLibrary` siguen sin tocarse).
  - `drops collection rows without a path` y `maps a missing length to undefined`.
- [ ] **Step 2: Ejecutarlos y verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verlos pasar, lint, tipos y suite.**
- [ ] **Step 5: Commit** `Return the matched library entry and build candidates from DJ collections`

---

### Task 4: Hook `useProgramCopies`

**Files:**
- Create: `renderer/src/hooks/useProgramCopies.ts`
- Modify: si la consulta `['source-collection', p]` se define en línea en `App.tsx:3548`, extraer `sourceCollectionOptions(p: DjProgram)` a `renderer/src/lib/sourcePrograms.ts` y usarla en los dos sitios (misma clave y `staleTime` de 60 s, así la caché se comparte)
- Test: `renderer/src/hooks/useProgramCopies.test.tsx`

**Interfaces:**
- Consumes: `findLibraryEntry`, `buildLibraryIndex`, `collectionCandidates` (Tarea 3); `SOURCE_READ` y `DJ_REACH_SETTINGS`.
- Produces:
```ts
export interface ProgramCopy { program: DjProgram; path: string; isThisFile: boolean }
export function useProgramCopies(args: {
  inputPath: string
  meta: { title: string; artist: string }
  durationSec?: number
  suggestedMeta?: { title: string; artist: string }
  enabled: boolean
}): ProgramCopy[]
```
Devuelve solo los programas activos (Global Constraints) donde hay coincidencia, en el orden fijo. Primero empareja con `meta`; si no hay coincidencia y hay `suggestedMeta`, prueba con esa. El índice de cada programa se construye con `useMemo` sobre el dato de la consulta.

- [ ] **Step 1: Tests que fallan** (mockear `window.api.dj.collection` y los ajustes como en otros tests de hooks):
  - `lists each enabled program that holds the track, in order`.
  - `does not read the collection of a program that is switched off` (el mock de ese programa no se llama).
  - `shows no copy for a program whose collection fails to read`.
  - `marks the copy that is this very file` (`isThisFile` con la misma ruta y distinta normalización NFC/NFD).
  - `falls back to the suggested tags`.
  - `builds each index once per collection` (espiar `buildLibraryIndex`: dos renders con los mismos datos → una llamada por programa).
- [ ] **Step 2: Ejecutarlos y verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verlos pasar, lint, tipos y suite.**
- [ ] **Step 5: Commit** `Find the track in every DJ collection the user works with`

---

### Task 5: Veredicto por copia y agregado de cabecera

**Files:**
- Create: `renderer/src/hooks/useCopyVerdicts.ts`
- Create: `renderer/src/lib/libraryVerdict.ts`
- Test: `renderer/src/hooks/useCopyVerdicts.test.tsx`, `renderer/src/lib/libraryVerdict.test.ts`

**Interfaces:**
- Consumes: `copyFactsQueries`, `toCopyFacts`, `pairOptions` (`hooks/useCopyFacts.ts`), `compareCopies` (`lib/bestCopy.ts`), las opciones de `properties` de `useTrackProperties.ts` (exportarlas si hace falta) y `libraryCopyFormat` (`lib/properties.ts`).
- Produces:
```ts
export interface CopyVerdictState { verdict: CopyVerdict | null; measuring: boolean; format: string }
export function useCopyVerdicts(herePath: string, copyPaths: string[]): CopyVerdictState[]
export function rowVerdict(state: CopyVerdictState): LibraryVerdict | null
export function aggregateLibraryVerdict(rows: (LibraryVerdict | null)[]): LibraryVerdict | null
```
`useCopyVerdicts` usa un solo `useQueries` con las consultas de este archivo (prioridad `high`), las de cada copia (`low`), un `pairOptions` por copia y un `properties` por copia, en el mismo orden que `copyPaths`. `rowVerdict` sigue el mapa de `copyState` de `Editor.tsx` (ganador `a` → `here`, `b` → `library`, `same` → `same`, midiendo → `measuring`, empate o sin dato → `null`). `aggregateLibraryVerdict` aplica la regla de Global Constraints.

- [ ] **Step 1: Tests que fallan.**
  - `aggregateLibraryVerdict`: `[ 'here', 'library' ]` → `'library'`; `[ 'here', 'measuring' ]` → `'measuring'`; `[ 'here', 'same' ]` → `'here'`; `[ 'same', null ]` → `'same'`; `[ null ]` → `null`.
  - `useCopyVerdicts`: `measures each copy against this file` (dos rutas con hechos mockeados → un veredicto por ruta en orden) y `reports measuring until every fact is in`.
- [ ] **Step 2: Ejecutarlos y verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verlos pasar, lint, tipos y suite.**
- [ ] **Step 5: Commit** `Judge each library copy and the section verdict from all of them`

---

### Task 6: Varias filas en la sección y montaje en el editor

**Files:**
- Modify: `renderer/src/components/LibrarySection.tsx` (de una fila a una lista)
- Modify: `renderer/src/components/CopyComparison.tsx` (quitar `LIBRARY = 'Apple Music'` fijo; prop `libraryName: string`)
- Modify: `renderer/src/components/Editor.tsx` (montaje de la fase 1)
- Test: `LibrarySection.test.tsx`, `CopyComparison` (si tiene test), `Editor.test.tsx`

**Interfaces:**
- Consumes: `useProgramCopies` (Tarea 4), `useCopyVerdicts`, `rowVerdict`, `aggregateLibraryVerdict` (Tarea 5).
- Produces:
```ts
export interface LibraryRow {
  id: string
  name: string
  format: string
  better: boolean
  comparison?: React.ReactNode
  comparisonOpen: boolean
  onToggleComparison: () => void
}
LibrarySection(props: { open: boolean; onToggle: () => void; verdict: LibraryVerdict | null; rows: LibraryRow[] })
```
Cada fila sigue siendo `library-row` (con `data-row={id}`) y el punto `library-row-better`; cada una abre su comparación por separado.

Montaje en `Editor.tsx`: la fila de Apple Music se construye como hoy, solo cuando `librarySource === 'appleMusic'` e `inLibrary === 'yes'`. Las filas de programas salen de `useProgramCopies` (con `meta` y `suggestedMeta` del editor, `enabled: !isMulti`); las copias con `isThisFile` no entran en `useCopyVerdicts` y su fila va sin formato, sin punto y sin comparación. La fila antigua de Engine de la fase 1 (rama `librarySource === 'engineDj'`) desaparece: Engine sale ya como programa. La sección se pinta si hay al menos una fila. Cabecera = `aggregateLibraryVerdict` de la fila de Music (con su comprobación rápida de la fase 1) y las de los programas.

**Aviso al usuario antes del commit:** los tests de la fase 1 que esperan la fila «Engine DJ» sin veredicto a partir de `librarySource === 'engineDj'` pasan a construirla desde la colección de Engine, que ahora sí compara. Ninguna otra aserción se invierte ni se borra.

- [ ] **Step 1: Tests que fallan.**
  - `LibrarySection`: `renders one row per program in the given order`, `opens each comparison on its own`, `marks only the copies that beat this file`.
  - `Editor`: `shows rekordbox and Traktor rows when both collections hold the track`; `shows the rekordbox row without comparison when this file is the rekordbox copy`; `says there is a better copy when any program holds one`; `names the program in the comparison table` (cabecera de la tabla «rekordbox · AIFF…»); `shows no section when no enabled program holds the track and it is not in Apple Music`.
- [ ] **Step 2: Ejecutarlos y verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verlos pasar, lint, `biome check`, tipos y suite.**
- [ ] **Step 5: Commit** `Show a library row for every DJ program that holds the track`

---

### Task 7: Prueba en la app (controlador)

- [ ] Compilar el worktree y arrancar con `quietLaunch` en un perfil temporal (`--user-data-dir`), como en la fase 1.
- [ ] rekordbox real de Vicent, solo lectura: abrir una copia MP3 de una pista que está en rekordbox y comprobar la fila, el veredicto y la comparación; abrir el fichero que usa rekordbox y comprobar la fila sin comparación. No escribir nada en rekordbox.
- [ ] Engine y Traktor (libres para pruebas) con el mismo par de ficheros.
- [ ] Medir la sección con tres filas en los 8 idiomas a 1440 y a 1024 px.
- [ ] Medir cuánto tarda en salir la fila de rekordbox con su colección real, la primera vez y la segunda (caché).
