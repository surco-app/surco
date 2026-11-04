# Serato fase (c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editar los crates de Serato desde su pestaña, añadir a Serato lo que Surco convierte (con los crates elegidos) y llevar a `database V2` los cambios de etiquetas de la revisión, siempre con Serato cerrado y sin perder un byte de lo que Surco no entiende.

**Architecture:** Dos codificadores puros (`.crate` y `database V2`) que reescriben solo lo que cambia. Un "borrador" de ficheros de Serato en el proceso principal lee con huella (mtime y tamaño), aplica las operaciones encoladas, copia a `serato-backups`, escribe en temporales y renombra comprobando antes de cada rename que Serato sigue cerrado. Todo entra por la cola de Serato de la fase (b), cuyo `applyBatch` pasa a repartir entre cues (lo de la fase b, intacto) y biblioteca (nuevo). Serato entra en las tablas que lo necesitan con un tipo propio, `LibraryProgram`; `WritableProgram` no cambia.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-04-serato-fase-c-design.md` (y las fases a y b: `2026-11-03-serato-cuarto-programa-design.md`, `2026-11-03-serato-fase-b-design.md`).

## Global Constraints

- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato-c`, rama `serato-c`. Código en `apps/desktop/src`. Todos los comandos desde `apps/desktop`.
  - Suite: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`). Nunca filtrar por ruta desde la raíz del repo.
  - Un fichero: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/<fichero>.test.ts`.
  - Tipos: `for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Biome: `/Users/vicent/code/surco/node_modules/.bin/biome check src`.
  - Matriz: `SURCO_MATRIX=1 node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx`; base 126 pasan, 1 saltada, 4 fallos conocidos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey).
- TDD rojo-verde. Mutación a mano en cada pieza nueva (los dos escritores, el renombrado en cascada, la huella, la cola): romper la implementación, ver caer un test, deshacer editando.
- Cero comentarios en el código. Sin `--no-verify`. Commits con título en inglés de una línea, sin prefijo ni cuerpo. No usar `git checkout`/`git stash` con trabajo sin commitear.
- Textos de UI en los 6 idiomas (es, en, de, fr, pt-BR, ja), sin guion largo ni dos puntos de explicación. Mocks de `window.api` con `vi.fn<Api['metodo']>()`. Selectores `data-testid`.
- Nunca cambiar el `pfil` de una entrada existente de `database V2`. Nunca escribir `master.sqlite`, `root.sqlite` ni ningún `*.sqlite`. Nunca tocar `SmartCrates/` ni `neworder.pref`.
- Escribir solo con Serato cerrado, por la cola de Serato, sin pedir nunca que se cierre. Comprobar `isSeratoRunning` justo antes de cada rename.
- No tocar `librariesKeepingOriginal`, `retireOriginal`, `RekordboxRepoint.names`, `engineConversionFlusher` ni la cola de Engine (los lleva otra sesión).
- Valores fijados por la spec:
  - Nombre de fichero de crate: ruta del árbol unida con `%%` + `.crate`, en `<_Serato_>/Subcrates/`. Nombre vacío, con `%%` o con `/` se rechaza.
  - `ttyp`: `.mp3` → `mp3`, `.wav` → `wave`, `.aif`/`.aiff` → `aiff`, `.flac` → `flac`, `.m4a`/`.mp4` → `quicktime`.
  - Entrada nueva: `ttyp`, `pfil`, `tsng`, `tart`, `talb`, `tgen`, `tadd` (texto, segundos Unix en decimal) y `uadd` (u32 big-endian, los mismos segundos), medido en `~/Music/_Serato_/database V2`.
  - Etiquetas sincronizadas: title → `tsng`, artist → `tart`, album → `talb`, genre → `tgen`. `albumArtist` no.
  - `addToSerato` y `syncSerato` por defecto `false`, como `addToEngineDj` y `syncEngineDj`.

## Rulings

Decisiones que el código obliga a tomar y la spec no fija.

- **Ruling:** `LibraryProgram = DjProgram` en `shared/djProgram.ts`, con `LIBRARY_PROGRAMS = programsInOrder(['rekordbox', 'traktor', 'engine', 'serato'])`. Pasan a `LibraryProgram`: `DJ_REACH_SETTINGS`, `LibraryStatus`, `LibraryTagSyncReport`, `LibraryTagFlushers`, `PlaylistLibrary`, `JOB_PLAYLISTS`, `REPOINT_PLAYLISTS`, `ATTACH_PLAYLISTS`, `attachPlaylists`, `ReviewSync`, `OFFERED`, `PLAYLIST_FIELDS` y la condición de tipo de `TRACK_PROGRAMS`. Siguen en `WritableProgram`: `DJ_COLLECTION_PATH`, `SYNC_BLOCKED_KEY`, `SYNC_ISSUE_CHANNEL`, `Sessions`, `FLUSH_ORDER`, `FlushOutcome`, `KEEPS_REPLACED`, `REVIEW_LIBRARIES`, `DjLibraryId`, `reachedPrograms` y la onboarding.
- **Ruling:** el paso de Serato en `flushConversionBatch` no es un `ConversionFlusher` (eso arrastraría `FlushOutcome` y la verificación). Va después del bucle de `FLUSH_ORDER`, solo si `queues.serato` existe.
- **Ruling:** la unión de la cola crece así. `EditOp` gana `files?: Record<string, FileStamp | null>` (`null` significa que el fichero no debe existir). Se añade `TagsOp`. Las altas de la conversión reutilizan `TrackOp`. `CuesOp` no cambia, así que un `serato-cue-queue.json` de la fase (b) se sigue leyendo.
- **Ruling:** huellas. Un `EditOp` lleva la huella de lo que el usuario vio, tomada en el IPC. `TrackOp` y `TagsOp` no la llevan al encolar: se leen al aplicar (alta solo si falta el `pfil`, etiqueta solo si el `pfil` está). En todos los casos el borrador apunta la huella de cada fichero al leerlo y la vuelve a mirar justo antes de cada rename. Motivo: Serato reescribe `database V2` al cerrarse, así que una huella tomada al encolar con Serato abierto rechazaría siempre la sincronización.
- **Ruling:** varias raíces. Un crate puede tener fichero en varias raíces `_Serato_` (la lectura ya las une). Renombrar, borrar, quitar y reordenar actúan sobre cada raíz que tiene el fichero. Una pista se añade al fichero del crate en la raíz de su volumen; si esa raíz no tiene ese crate, la pista se rechaza. Crear en la raíz del árbol escribe en la raíz interna (`root === '/'`), o en la primera si no hay interna. Crear un subcrate escribe en cada raíz que tiene el padre.
- **Ruling:** el `linkId` de una fila de crate es `` `${index}@${crateFile}` `` (índice del `otrk` en ese fichero y ruta absoluta del `.crate`). Se separa por la primera `@`.
- **Ruling:** nuevo rechazo `'bad-name'` en `RekordboxEditRefusal`. Cubre nombre vacío, con `%%`, con `/`, o que ya exista entre los hermanos. Un renombrado que solo cambia mayúsculas no cuenta como existente. El IPC valida antes de encolar y la aplicación vuelve a validar.
- **Ruling:** al añadir desde la pestaña, una pista de otro volumen, o cuyo fichero no existe, cuenta en `report.notInCollection`, con texto propio de Serato. Un crate elegido en la conversión que no está en la raíz de la pista da un aviso nuevo, `'other-volume'`.
- **Ruling:** copias en `<userData>/serato-backups/<ISO con : y . cambiados por ->/<Music | nombre del volumen>/<ruta dentro de _Serato_>`, una carpeta por escritura, guardando las 20 más nuevas. La poda no está en la spec, pero `database V2` se copia en cada sincronización de etiquetas y sin poda la carpeta crece sin límite.
- **Ruling:** un renombrado de fichero va por dos renames a través de `<from>.surco-tmp`. Así un cambio que solo toca mayúsculas funciona en APFS, que no distingue mayúsculas.
- **Ruling:** el árbol en modo crates (`edit.crates`) no muestra "Nueva carpeta" y ofrece "Nuevo crate dentro" en cualquier nodo. Un crate con subcrates sigue siendo un nodo `folder`, como en la fase (a). Ese límite se queda.
- **Ruling:** `LibraryTagSync` gana `{ outcome: 'queued' }` (solo lo da Serato: guardado al cerrarlo).
- **Ruling:** la firma pasa a ser `libraryStatus(settings, exists, seratoFound: boolean)`, y `currentLibraryStatus(seratoFound = false)`. Los usos internos de `libraryFlushes` no miran Serato. `library:status` pasa `seratoRoots().length > 0`.
- **Ruling:** con Serato abierto, el aviso del árbol usa `editor.cues.serato.waiting`. Si `editor.cues.serato.running` queda sin uso, se borra de los 6 idiomas.
- **Ruling:** el escritor de campos funciona así. Un campo que no existe se añade al final del cuerpo del `otrk`. Una cadena vacía escribe una trama de longitud 0. Se actualizan todas las entradas con ese `pfil` (comparado en NFC).
- **Ruling:** en la entrada nueva se omiten los campos de texto vacíos. Con una extensión desconocida no se añade nada y sale el aviso `'not-added'`.

### Decisiones del controlador sobre el borrador (prevalecen sobre los Rulings de arriba)

- **Ruling:** la huella que lleva un `EditOp` de crate es de contenido, no de mtime y tamaño. Para cada `.crate` que la edición toca guarda si existe y la lista ordenada de rutas de pista (`ptrk`) que vio el usuario. Al aplicar, la edición se rechaza solo si esa lista cambió o el fichero apareció o desapareció. Motivo: medido el 04/11, Serato reescribe los `.crate` al cerrarse (Medida Q.crate cambió de mtime a las 07:12:57 y a las 08:13:07, en dos cierres). Una huella por mtime rechazaría toda edición encolada con Serato abierto. La comprobación de mtime y tamaño justo antes de cada rename se mantiene, contra lo leído al aplicar.
- **Ruling:** no se añade a Serato la salida de una conversión cuyo origen ya está en el `database V2` de Serato. El original se queda en Serato, porque la otra sesión lo conserva y avisa, y añadir la salida crearía una pista duplicada. Solo se añade cuando el origen no está en Serato. Test en la Tarea 7: `does not add the output when Serato already has the source`.
- **Ruling:** un crate con subcrates sigue sin mostrar sus propias pistas en Surco (límite de la fase a). No se arregla en esta fase. Se avisa al usuario en el resumen.
- **Ruling:** los cambios de etiquetas que no vienen de la revisión (Actualizar, conversión en el mismo sitio) no llegan a Serato en esta fase. Tocarían `repoint.names`, que es de la otra sesión.
- **Ruling:** Windows. Las raíces de Serato solo se buscan en el modelo de macOS de la fase (a). En Windows esta fase no escribe nada en Serato.

## Review Focus

- Rutas con acentos en NFD (macOS) frente a NFC en el crate o en `database V2`: deben contar como la misma pista (ya está, y no se duplica). Test en Task 4, Task 7 y Task 9.
- Un crate con fichero en el disco interno y en uno externo: renombrar y borrar tocan los dos; añadir va al del volumen de la pista. Test en Task 3 y Task 4.
- Un `database V2` o un `.crate` con cola truncada: no se escribe nunca y la cola no se pierde. Test en Task 1, Task 2 y Task 4.
- Serato se abre entre la copia y el rename: no se renombra nada, no quedan temporales y la operación sigue en cola. Test en Task 3.
- Renombrar `house` a `House`: el crate cambia de nombre en lugar de rechazarse como existente o desaparecer. Test en Task 3.

---

### Task 1: codificador de `.crate`, nombres y rutas por volumen

**Files:**
- Create: `apps/desktop/src/main/seratoCrateFile.ts`
- Test: `apps/desktop/src/main/seratoCrateFile.test.ts` (fixtures con `frame`/`utf16be`/`concat` de `main/seratoDatabaseFixture.ts` y una copia en el test de los bytes de `~/Music/_Serato_/Subcrates/Medida Q.crate`, construida con esas mismas funciones: `vrsn`, 7 `ovct` con anchos `250`/`30`, 4 `otrk`)

**Interfaces:**
- Consumes: `buildSeratoCrate` (`shared/serato.ts:80`), `seratoDatabaseTruncated` (`main/seratoDatabase.ts:69`), `SeratoLibraryRoot` (`main/seratoLibrary.ts:16`).
- Produces:
  - `type CrateTrack = { keep: number } | { path: string }`
  - `crateTrackPaths(bytes: Uint8Array): string[] | null`: el `ptrk` de cada `otrk` en orden (`''` si falta); `null` si está truncado.
  - `withCrateTracks(bytes: Uint8Array, tracks: CrateTrack[]): Uint8Array | null`: los `otrk` pasan a ser `tracks` (`keep` copia byte a byte el `otrk` número n; `path` crea `otrk{ptrk}`). Van como bloque donde estaba el primer `otrk`, o al final si no había. Todas las demás tramas se quedan en su sitio y orden. `null` si está truncado o un `keep` se sale de rango.
  - `validCrateName(name: string): boolean`: trim no vacío, sin `%%` ni `/`.
  - `crateIdOf(parentId: string, name: string): string`: `'root'` da `name`, si no `` `${parentId}%%${name}` ``.
  - `crateFamily(ids: Iterable<string>, id: string): string[]`: `id` y los que empiezan por `` `${id}%%` ``.
  - `renamedCrateId(id: string, renamed: string, name: string): string`: cambia el último segmento de `renamed` en `id`.
  - `crateFileOf(root: SeratoLibraryRoot, id: string): string`: `join(root.dir, 'Subcrates', `${id}.crate`)`.
  - `seratoRootOf(file: string, roots: SeratoLibraryRoot[]): SeratoLibraryRoot | null`: la raíz externa cuyo `root + '/'` es prefijo (sin distinguir mayúsculas), o la raíz `'/'` si el fichero no está bajo `/Volumes/`.
  - `seratoPathOn(file: string, root: SeratoLibraryRoot): string`: la ruta sin el prefijo del volumen ni la `/` inicial.

- [ ] **Step 1: tests rojos**

```ts
it('rewrites a real crate with the same tracks into the same bytes', () => {
  expect(withCrateTracks(MEDIDA_Q, [0, 1, 2, 3].map((keep) => ({ keep })))).toEqual(MEDIDA_Q)
})
it('reorders and drops tracks while keeping version and columns in place', () => {
  const out = withCrateTracks(MEDIDA_Q, [{ keep: 2 }, { keep: 0 }])!
  expect(crateTrackPaths(out)).toEqual([Q_WAV, Q_XING])
  expect(out.subarray(0, COLUMNS_END)).toEqual(MEDIDA_Q.subarray(0, COLUMNS_END))
})
it('appends a new track after the columns of an empty crate', () => {
  expect(crateTrackPaths(withCrateTracks(buildSeratoCrate([]), [{ path: 'Users/dj/a.mp3' }])!)).toEqual(['Users/dj/a.mp3'])
})
it('keeps unknown frames that sit after the tracks', () => {
  const crate = concat([MEDIDA_Q, frame('zzzz', new Uint8Array([1, 2]))])
  expect(withCrateTracks(crate, [{ keep: 1 }])!.subarray(-10)).toEqual(frame('zzzz', new Uint8Array([1, 2])))
})
it('never rewrites a truncated crate', () => {
  const cut = MEDIDA_Q.subarray(0, MEDIDA_Q.length - 3)
  expect(crateTrackPaths(cut)).toBeNull()
  expect(withCrateTracks(cut, [{ keep: 0 }])).toBeNull()
})
it('refuses empty names and names with %% or a slash', () => {
  expect(['', '  ', 'a%%b', 'a/b'].map(validCrateName)).toEqual([false, false, false, false])
  expect(validCrateName('Techno 2026')).toBe(true)
})
it('finds a crate and every subcrate below it, not siblings sharing a prefix', () => {
  expect(crateFamily(['A', 'A%%B', 'A%%B%%C', 'AB'], 'A').sort()).toEqual(['A', 'A%%B', 'A%%B%%C'])
})
it('renames the segment of the renamed crate in a descendant id', () => {
  expect(renamedCrateId('A%%B%%C', 'A%%B', 'X')).toBe('A%%X%%C')
})
it('places a file on its own volume root', () => {
  const roots = [{ dir: '/Users/dj/Music/_Serato_', root: '/' }, { dir: '/Volumes/Gig/_Serato_', root: '/Volumes/Gig' }]
  expect(seratoRootOf('/Volumes/gig/t.mp3', roots)).toBe(roots[1])
  expect(seratoPathOn('/Volumes/Gig/Tracks/t.mp3', roots[1])).toBe('Tracks/t.mp3')
  expect(seratoPathOn('/Users/dj/t.mp3', roots[0])).toBe('Users/dj/t.mp3')
  expect(seratoRootOf('/Volumes/Other/t.mp3', roots)).toBeNull()
})
```

- [ ] **Step 2: comprobar que fallan.** Run `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/seratoCrateFile.test.ts`. Expected: FAIL, el módulo no existe.
- [ ] **Step 3: implementar** las firmas de Interfaces en `main/seratoCrateFile.ts`. El troceo de tramas lo hace un lector propio que guarda los bytes crudos de cada trama, igual que `framesOf` en `seratoDatabase.ts`.
- [ ] **Step 4: verde.** Mismo comando, PASS. Mutación: re-serializar el `otrk` en lugar de copiarlo hace caer el de ida y vuelta, y saltarse el chequeo de truncado hace caer el de truncado.
- [ ] **Step 5: suite, tres tsc y biome. Commit** `Rewrite Serato crate track lists byte for byte`.

### Task 2: escritores de `database V2`

**Files:**
- Create: `apps/desktop/src/main/seratoDatabaseWrite.ts`
- Test: `apps/desktop/src/main/seratoDatabaseWrite.test.ts` (fixture `REAL_ENTRY` construida con `track()` de `seratoDatabaseFixture.ts` con los 33 campos medidos de la primera entrada: `ttyp aiff`… `uadd 6ae98234`… `bkrk 00`. Los `u*`/`b*` van como `extra` crudos.)

**Interfaces:**
- Produces:
  - `type SeratoTagField = 'tsng' | 'tart' | 'talb' | 'tgen'`
  - `seratoFileType(path: string): string | null` (tabla de Global Constraints; sin distinguir mayúsculas).
  - `seratoDatabaseHas(bytes: Uint8Array, pfil: string): boolean` (NFC).
  - `withSeratoTrackFields(bytes: Uint8Array, pfil: string, fields: Partial<Record<SeratoTagField, string>>): Uint8Array | null`: `null` si no hay entrada o está truncado.
  - `interface NewSeratoTrack { pfil: string; type: string; title: string; artist: string; album: string; genre: string; addedAt: number }`
  - `withSeratoTrackAdded(bytes: Uint8Array, track: NewSeratoTrack): Uint8Array | null`: añade al final un `otrk` con `ttyp, pfil, tsng, tart, talb, tgen, tadd, uadd` en ese orden y sin los textos vacíos. `null` si está truncado.

- [ ] **Step 1: tests rojos**

```ts
it('changes only the title of the entry with that pfil, byte for byte elsewhere', () => {
  const db = concat([VRSN, REAL_ENTRY, OTHER_ENTRY])
  const out = withSeratoTrackFields(db, PRAY_PFIL, { tsng: 'Pray (Edit)' })!
  expect(parseSeratoDatabase(out)[0].title).toBe('Pray (Edit)')
  expect(out.subarray(-OTHER_ENTRY.length)).toEqual(OTHER_ENTRY)
  expect(withSeratoTrackFields(out, PRAY_PFIL, { tsng: 'Pray (W.I.P. In The Church Mix)' })).toEqual(db)
})
it('keeps every unknown field of the entry, in its order', () => {
  const out = withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, { tgen: 'House' })!
  expect(subframeTags(out)).toEqual(subframeTags(concat([VRSN, REAL_ENTRY])))
})
it('adds a field the entry lacked at the end of the entry', () => {
  const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'a.mp3' })])
  expect(subframeTags(withSeratoTrackFields(db, 'a.mp3', { talb: 'X' })!)).toEqual(['ttyp', 'pfil', 'talb'])
})
it('matches a pfil written in NFD with one asked in NFC', () => {
  const db = concat([VRSN, track({ ttyp: 'mp3', pfil: 'Música/a.mp3'.normalize('NFD') })])
  expect(seratoDatabaseHas(db, 'Música/a.mp3'.normalize('NFC'))).toBe(true)
  expect(withSeratoTrackFields(db, 'Música/a.mp3', { tsng: 'T' })).not.toBeNull()
})
it('never touches pfil', () => {
  const out = withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), PRAY_PFIL, { tsng: 'x', tart: 'y', talb: 'z', tgen: 'w' })!
  expect(parseSeratoDatabase(out)[0].path).toBe(PRAY_PFIL)
})
it('answers null for a track that is not there and for a truncated database', () => {
  expect(withSeratoTrackFields(concat([VRSN, REAL_ENTRY]), 'nope.mp3', { tsng: 'x' })).toBeNull()
  const cut = concat([VRSN, REAL_ENTRY]).subarray(0, -2)
  expect(withSeratoTrackFields(cut, PRAY_PFIL, { tsng: 'x' })).toBeNull()
  expect(withSeratoTrackAdded(cut, NEW)).toBeNull()
})
it('appends a new entry Serato reads, with the added time as text and as u32', () => {
  const out = withSeratoTrackAdded(concat([VRSN, REAL_ENTRY]), { ...NEW, addedAt: 1793688116 })!
  expect(out.subarray(0, VRSN.length + REAL_ENTRY.length)).toEqual(concat([VRSN, REAL_ENTRY]))
  expect(parseSeratoDatabase(out)[1]).toMatchObject({ path: NEW.pfil, title: NEW.title, addedAt: 1793688116 })
  expect(lastEntryField(out, 'uadd')).toEqual(Uint8Array.from([0x6a, 0xe9, 0x82, 0x34]))
  expect(subframeTags(out).slice(-8)).toEqual(['ttyp', 'pfil', 'tsng', 'tart', 'talb', 'tgen', 'tadd', 'uadd'])
})
it('leaves out empty text fields of a new entry', () => {
  expect(subframeTags(withSeratoTrackAdded(VRSN, { ...NEW, album: '', genre: '' })!)).toEqual(['ttyp', 'pfil', 'tsng', 'tart', 'tadd', 'uadd'])
})
it.each([['a.MP3', 'mp3'], ['a.wav', 'wave'], ['a.aif', 'aiff'], ['a.aiff', 'aiff'], ['a.flac', 'flac'], ['a.m4a', 'quicktime'], ['a.mp4', 'quicktime'], ['a.ogg', null]])('types %s as %s', (path, type) => {
  expect(seratoFileType(path)).toBe(type)
})
```

(`subframeTags` y `lastEntryField` son ayudantes del test que leen las subtramas del último `otrk`.)

- [ ] **Step 2: comprobar que fallan.** Run `…/vitest.mjs run src/main/seratoDatabaseWrite.test.ts`. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas en `main/seratoDatabaseWrite.ts`. Al cambiar el cuerpo de un `otrk` se reescribe su longitud; las tramas de fuera de ese `otrk` se copian crudas.
- [ ] **Step 4: verde.** Mutación: escribir el campo en UTF-16LE, o reordenar las subtramas, hace caer un test.
- [ ] **Step 5: suite, tres tsc y biome. Commit** `Edit and append Serato database V2 entries byte for byte`.

### Task 3: borrador, escritura segura y operaciones de árbol en la cola de Serato

**Files:**
- Modify: `apps/desktop/src/main/rekordboxQueueOps.ts:15-47` (`FileStamp`, `EditOp.files`)
- Modify: `apps/desktop/src/shared/types.ts:1233` (`'bad-name'` en `RekordboxEditRefusal`)
- Modify: `apps/desktop/src/renderer/src/lib/playlistEdits.ts:42` (`REFUSED['bad-name'] = 'sources.edit.refused.badName'`; la clave se crea en Task 5)
- Create: `apps/desktop/src/main/seratoLibraryWrite.ts` (borrador y commit)
- Create: `apps/desktop/src/main/seratoCrateEdits.ts` (create/rename/delete y las huellas que guarda el IPC)
- Create: `apps/desktop/src/main/seratoBatch.ts` (reparto cues/biblioteca)
- Modify: `apps/desktop/src/main/index.ts:496-521` (la cola de Serato usa `applySeratoBatch`)
- Test: `seratoLibraryWrite.test.ts`, `seratoCrateEdits.test.ts`, `seratoBatch.test.ts` (carpetas `_Serato_` temporales con `testTmpRoot`)

**Interfaces:**
- Consumes: Task 1 (`withCrateTracks`, `crateFamily`, `crateIdOf`, `renamedCrateId`, `crateFileOf`, `validCrateName`), `applySeratoCuesBatch` (`main/seratoCuesWrite.ts:149`), `buildSeratoCrate`, `seratoDatabaseTruncated`.
- Produces:
  - `interface FileStamp { mtimeMs: number; size: number }` en `rekordboxQueueOps.ts`; `EditOp.files?: Record<string, FileStamp | null>`.
  - `fileStampOf(file: string): FileStamp | null`.
  - `interface SeratoDraft { read(file: string): Uint8Array | null; exists(file: string): boolean; write(file: string, bytes: Uint8Array): void; rename(from: string, to: string): void; remove(file: string): void; stamps(): Map<string, FileStamp | null> }` y `createSeratoDraft(): SeratoDraft`. Lee del disco la primera vez, con la huella, y después de su propia capa. `rename` y `remove` se ven en lecturas posteriores.
  - `interface SeratoCommitDeps { backupDir: string; roots: () => SeratoLibraryRoot[]; seratoOpen: () => Promise<boolean>; now?: () => Date }`
  - `commitSeratoDraft(draft: SeratoDraft, deps: SeratoCommitDeps): Promise<'written' | 'nothing' | 'cancelled' | 'backup-failed' | 'write-failed' | 'write-unknown'>`. Orden: si no hay cambios, `'nothing'`. Copia de cada fichero existente que se toca (ruta del Ruling) y poda a 20; si falla, `'backup-failed'`. Escribe cada `write` en `<file>.surco-tmp`. Antes de cada rename (escrituras, después renombres por `<from>.surco-tmp`, después borrados) comprueba `seratoOpen()` y que la huella de cada fichero tocado sigue igual. Si Serato se abrió o un fichero cambió: deshace lo hecho desde las copias, borra los temporales y devuelve `'cancelled'`. Si un paso falla: deshace y devuelve `'write-failed'`, o `'write-unknown'` si deshacer también falla.
  - `seratoEditFiles(edit: RekordboxPlaylistEdit, roots: SeratoLibraryRoot[]): Record<string, FileStamp | null>`. create: el fichero nuevo en cada raíz donde irá (`null`) y los del padre. rename: todos los de la familia en cada raíz y los nombres nuevos (`null`, salvo cambio de solo mayúsculas). delete: toda la familia. add/move/remove: los ficheros del crate en cada raíz (Task 4).
  - `backupFolderName(now: Date): string`: el nombre de la carpeta de copias de una escritura.
  - `applySeratoEdit(draft: SeratoDraft, op: EditOp, roots: SeratoLibraryRoot[]): OpOutcome`. Primero compara `op.files` con `draft`: si difieren, `reason: 'stale'` y aviso `{ code: 'edit-changed', playlist: op.label ?? '' }`. Después aplica create (crate vacío con `buildSeratoCrate([], file)`, `createdId` = id nuevo, `folder` se ignora), rename (cascada con `draft.rename`) y delete (cascada con `draft.remove`). Un nombre no válido o ya existente da `'bad-name'`, y un crate truncado da `'unreadable'`.
  - `applySeratoLibraryOps(ops: QueueOp[], deps: SeratoCommitDeps & { ensureClosed: () => Promise<boolean>; stillQueued?: (id: string) => boolean }): Promise<BatchResult>`. Usa un borrador por lote y ordena las operaciones por `opRank`. Si `ensureClosed` es falso, devuelve `{ ok: false, reason: 'cancelled' }`. Las operaciones `track` y `tags` dan `{ applied: false, reason: 'write-failed' }` hasta Task 7 y Task 9. Mapea el commit así: `'cancelled'`, `'backup-failed'`, `'write-failed'` y `'write-unknown'` van a `{ ok: false, reason }`; `'nothing'` va a `wrote: false`.
  - `applySeratoBatch(ops: QueueOp[], deps: SeratoCommitDeps & Parameters<typeof applySeratoCuesBatch>[1]): Promise<BatchResult>`. Primero las operaciones de biblioteca (`edit`, `track`, `tags`) con `applySeratoLibraryOps` y después las `cues` con `applySeratoCuesBatch`. Junta los `outcomes`; si la primera parte da `ok: false`, devuelve eso sin tocar los cues.
  - En `index.ts`: `applyBatch: (_l, ops, ensureClosed, stillQueued) => applySeratoBatch(ops, { …lo de hoy, roots: seratoRoots, backupDir: join(app.getPath('userData'), 'serato-backups'), seratoOpen: DJ_PROCESSES.serato.isRunning })`.

- [ ] **Step 1: tests rojos**

```ts
it('creates a root crate in the internal _Serato_ and a subcrate wherever the parent is', async () => {
  const { roots, deps } = twoRoots({ internal: ['A'], gig: ['A'] })
  await apply(roots, deps, create('root', 'New'), create('A', 'Sub'))
  expect(existsSync(crateFileOf(roots[0], 'New'))).toBe(true)
  expect(existsSync(crateFileOf(roots[1], 'New'))).toBe(false)
  expect(roots.every((r) => existsSync(crateFileOf(r, 'A%%Sub')))).toBe(true)
})
it('renames a crate and every subcrate file in every root, keeping their bytes', async () => {
  const { roots, deps, bytes } = twoRoots({ internal: ['A', 'A%%B', 'A%%B%%C', 'AB'], gig: ['A%%B'] })
  const outcome = await apply(roots, deps, rename('A%%B', 'X'))
  expect(outcome.applied).toBe(true)
  expect(readFileSync(crateFileOf(roots[0], 'A%%X%%C'))).toEqual(bytes.internal['A%%B%%C'])
  expect(existsSync(crateFileOf(roots[1], 'A%%X'))).toBe(true)
  expect(existsSync(crateFileOf(roots[0], 'AB'))).toBe(true)
  expect(listCrates(roots[0])).not.toContain('A%%B.crate')
})
it('renames house to House on a case-insensitive disk', async () => {
  const { roots, deps } = twoRoots({ internal: ['house'] })
  expect((await apply(roots, deps, rename('house', 'House'))).applied).toBe(true)
  expect(listCrates(roots[0])).toEqual(['House.crate'])
})
it('deletes a crate with its subcrates and nothing else', async () => {
  const { roots, deps } = twoRoots({ internal: ['A', 'A%%B', 'AB'] })
  await apply(roots, deps, del('A'))
  expect(listCrates(roots[0])).toEqual(['AB.crate'])
})
it.each([['', 'empty'], ['a%%b', '%%'], ['a/b', 'slash'], ['AB', 'taken']])('refuses the name %s (%s)', async (name) => {
  const { roots, deps } = twoRoots({ internal: ['A', 'AB'] })
  expect(await apply(roots, deps, rename('A', name))).toMatchObject({ applied: false, reason: 'bad-name' })
  expect(listCrates(roots[0])).toEqual(['A.crate', 'AB.crate'])
})
it('refuses an edit whose crate changed after the user saw it, and says so', async () => {
  const { roots, deps } = twoRoots({ internal: ['A'] })
  const op = editOp(rename('A', 'X'), seratoEditFiles(rename('A', 'X'), roots))
  touch(crateFileOf(roots[0], 'A'), 'one more byte')
  expect(await applyOne(op, deps)).toMatchObject({ applied: false, reason: 'stale', notices: [{ code: 'edit-changed' }] })
})
it('copies every file it touches into serato-backups before writing', async () => {
  const { roots, deps, bytes } = twoRoots({ internal: ['A'] })
  await apply(roots, deps, del('A'))
  expect(readFileSync(onlyBackupOf(deps.backupDir, 'Music/Subcrates/A.crate'))).toEqual(bytes.internal.A)
})
it('writes nothing and leaves no temp when Serato opens before the rename', async () => {
  const { roots, deps, bytes } = twoRoots({ internal: ['A'] })
  const open = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
  expect(await applySeratoLibraryOps([editOp(del('A'))], { ...deps, seratoOpen: open, ensureClosed: async () => true })).toEqual({ ok: false, reason: 'cancelled' })
  expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
  expect(tempsUnder(roots[0].dir)).toEqual([])
})
it('keeps applying cue ops queued by phase (b) and routes them to the cue writer', async () => {
  const cues = vi.fn<typeof applySeratoCuesBatch>().mockResolvedValue({ ok: true, wrote: true, outcomes: [{ id: 'c', applied: true, notices: [] }] })
  const result = await applySeratoBatch([PHASE_B_CUES_OP, editOp(create('root', 'N'))], depsWith({ cues }))
  expect(cues).toHaveBeenCalledWith([PHASE_B_CUES_OP], expect.anything())
  expect(result).toMatchObject({ ok: true, outcomes: [{ applied: true }, { id: 'c', applied: true }] })
})
it('reads a serato-cue-queue.json written by phase (b)', () => {
  const queue = createRekordboxQueue({ ...SERATO_QUEUE_DEPS, store: memoryStore(PHASE_B_FILE) })
  expect(queue.state().items).toHaveLength(1)
})
it('keeps only the newest 20 backup folders', async () => {
  for (let i = 0; i < 21; i++) await apply(roots, { ...deps, now: () => new Date(T0 + i * 1000) }, create('root', `C${i}`))
  expect(readdirSync(deps.backupDir).sort()[0]).toBe(backupFolderName(new Date(T0 + 1000)))
  expect(readdirSync(deps.backupDir)).toHaveLength(20)
})
```

(`twoRoots`, `apply`, `applyOne`, `create`, `rename`, `del`, `editOp`, `listCrates`, `touch`, `tempsUnder`, `onlyBackupOf`, `depsWith` y `memoryStore` son ayudantes de los tests. `backupFolderName(now: Date): string` se exporta de `seratoLibraryWrite.ts`.)

- [ ] **Step 2: comprobar que fallan.** Run `…/vitest.mjs run src/main/seratoLibraryWrite.test.ts`, después `seratoCrateEdits.test.ts` y `seratoBatch.test.ts`. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas de Interfaces y cambiar `index.ts`.
- [ ] **Step 4: verde.** Mutación, una a una: quitar la comprobación de huella antes del rename, quitar el `seratoOpen()` antes del rename, hacer el rename sin el paso por `.surco-tmp` y no cascadear a los subcrates. Cada una debe hacer caer un test.
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Apply Serato crate create, rename and delete through its queue with backups`.

### Task 4: pistas en un crate, `linkId` y el IPC `serato:edit`

**Files:**
- Modify: `apps/desktop/src/main/seratoCrateFile.ts` (`seratoLinkId`, `parseSeratoLinkId`)
- Modify: `apps/desktop/src/main/seratoLibrary.ts:23-27,51-63,135-146` (`links` y `linkId` en las entradas)
- Modify: `apps/desktop/src/main/seratoCrateEdits.ts` (add/move/remove)
- Create: `apps/desktop/src/main/seratoPlaylistEditIpc.ts`
- Modify: `apps/desktop/src/main/index.ts` (registro, junto a `registerSeratoCueQueueIpc` en `:1431`)
- Modify: `apps/desktop/src/preload/index.ts` (cerca de `:309`), `apps/desktop/src/preload/api.ts:303`, `apps/desktop/src/renderer/src/test/api.ts:216`
- Test: `seratoCrateEdits.test.ts`, `seratoLibrary.test.ts`, `seratoPlaylistEditIpc.test.ts` (patrón de `traktorPlaylistEditIpc.test.ts` si existe; si no, el de `seratoPlaylistsIpc.test.ts`)

**Interfaces:**
- Consumes: Task 1, Task 3; `editResultOfOutcome`, `withoutOp`, `stillWaiting`, `serialLibraryFlush`; `moveBefore` tiene la misma regla que `renderer/src/lib/playlistEdits.ts:15`.
- Produces:
  - `seratoLinkId(index: number, crateFile: string): string` y `parseSeratoLinkId(linkId: string): { index: number; crateFile: string } | null`.
  - `SeratoLibrary.links: Map<string, string[]>` en el mismo orden que `crates`. `seratoPlaylist` da `linkId` en las entradas de un crate (no en Recientes ni en Todas).
  - En `applySeratoEdit`, tres casos nuevos:
    - add: el fichero de cada pista es el último de `paths`. Con raíz por volumen y el crate en esa raíz, si ya está (NFC) suma a `already`; si no, lo añade al final con `seratoPathOn`. Sin raíz, sin el crate en esa raíz o sin el fichero en disco, suma a `notInCollection`. Devuelve `report` con `ambiguous: 0`.
    - remove: los índices de los `linkIds`; un índice que no existe da `'stale'`.
    - move: todos los `linkIds` y `beforeLinkId` deben ser del mismo fichero (si no, `'stale'`), con la regla de `moveBefore`.
  - `registerSeratoPlaylistEditIpc(host: { roots: () => SeratoLibraryRoot[]; queue: Pick<RekordboxQueue, 'apply' | 'drop'> & { enqueue: (ops: EditOp[]) => void }; isRunning: () => Promise<boolean>; onApplied?: (result: QueueApply) => void; onWaiting?: () => void }): void`. Atiende el canal `serato:edit` con `(edit, label?)`. Para create y rename comprueba el nombre antes de encolar y, si no vale, devuelve `{ applied: false, reason: 'bad-name' }`. Si vale, encola `EditOp` con `files: seratoEditFiles(edit, roots)` y aplica con `ensureClosed = async () => !(await host.isRunning())`. El resto es como `traktor:edit` (`traktorPlaylistEditIpc.ts:28-61`).
  - Preload: `editSeratoPlaylist(edit: RekordboxPlaylistEdit, label?: string): Promise<RekordboxEditResult>`.

- [ ] **Step 1: tests rojos**

```ts
it('adds tracks to the crate file on their own volume and counts the rest', async () => {
  const { roots, deps } = twoRoots({ internal: ['A'], gig: ['A'] })
  const outcome = await apply(roots, deps, addTo('A', '/Users/dj/a.mp3', '/Volumes/Gig/b.mp3', '/Volumes/Other/c.mp3', '/Users/dj/missing.mp3'))
  expect(outcome.report).toEqual({ added: 2, already: 0, notInCollection: 2, ambiguous: 0 })
  expect(crateTrackPaths(readFileSync(crateFileOf(roots[1], 'A')))).toEqual(['b.mp3'])
})
it('counts a track already in the crate under another normalization as already there', async () => {
  const { roots, deps } = twoRoots({ internal: [['A', ['Users/dj/Música/a.mp3'.normalize('NFD')]]] })
  expect((await apply(roots, deps, addTo('A', '/Users/dj/Música/a.mp3'.normalize('NFC')))).report).toMatchObject({ added: 0, already: 1 })
})
it('refuses a track for a crate that only lives on another drive', async () => {
  const { roots, deps } = twoRoots({ gig: ['OnlyGig'] })
  expect((await apply(roots, deps, addTo('OnlyGig', '/Users/dj/a.mp3'))).report).toMatchObject({ added: 0, notInCollection: 1 })
})
it('moves and removes rows by link id, keeping the crate columns', async () => {
  const { roots, deps } = twoRoots({ internal: [['A', ['a', 'b', 'c']]] })
  const file = crateFileOf(roots[0], 'A')
  await apply(roots, deps, move('A', [seratoLinkId(2, file)], seratoLinkId(0, file)))
  expect(crateTrackPaths(readFileSync(file))).toEqual(['c', 'a', 'b'])
  await apply(roots, deps, remove('A', [seratoLinkId(1, file)]))
  expect(crateTrackPaths(readFileSync(file))).toEqual(['c', 'b'])
})
it('never rewrites a truncated crate', async () => {
  const { roots, deps, bytes } = twoRoots({ internal: ['A'], truncated: ['A'] })
  expect(await apply(roots, deps, addTo('A', '/Users/dj/a.mp3'))).toMatchObject({ applied: false, reason: 'unreadable' })
  expect(readFileSync(crateFileOf(roots[0], 'A'))).toEqual(bytes.internal.A)
})
it('gives every crate row a link id the edit can resolve', () => {
  const entries = seratoPlaylist(readSeratoLibrary(roots), 'A')
  expect(entries.map((e) => parseSeratoLinkId(e.linkId!))).toEqual([{ index: 0, crateFile: file }, { index: 1, crateFile: file }])
})
it('serato:edit queues the edit and says it waits while Serato is open, without asking to close it', async () => {
  const { handle, queue } = registerWith({ running: true })
  expect(await handle('serato:edit', rename('A', 'X'), 'A')).toEqual({ applied: false, reason: 'cancelled' })
  expect(queue.enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'edit', files: expect.any(Object) })])
})
it('serato:edit refuses a bad name before queueing it', async () => {
  const { handle, queue } = registerWith({ running: false })
  expect(await handle('serato:edit', create('root', 'a%%b'), 'a%%b')).toEqual({ applied: false, reason: 'bad-name' })
  expect(queue.enqueue).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: comprobar que fallan.** Run los tres ficheros. Expected: FAIL.
- [ ] **Step 3: implementar**, registrar el IPC en `index.ts` con `queue: seratoCueQueue`, `isRunning: DJ_PROCESSES.serato.isRunning`, `onApplied: programQueues.serato.announceApplied` y `onWaiting: seratoCueQueueWatch.poke`, y añadir la preload.
- [ ] **Step 4: verde.** Mutación: comparar rutas sin NFC hace caer un test; añadir al crate de la raíz equivocada hace caer otro.
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Add, move and remove tracks in Serato crates from an IPC edit`.

### Task 5: editar crates en la pestaña Serato

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/sourcePrograms.ts:56-61,141-153` (`edit`, `EditMessagePrefix`, `invalidatesOnEdit: true`, campo nuevo `crates: boolean` en `SourceProgram`: `true` solo en Serato)
- Modify: `apps/desktop/src/renderer/src/components/SourceTree.tsx:80-85,170-180,440-530` (`edit.crates?: true`)
- Modify: `apps/desktop/src/renderer/src/App.tsx:3327-3334` (aviso con Serato abierto, `crates` hacia `SourceTree`)
- Modify: `apps/desktop/src/renderer/src/lib/rekordboxQueueText.ts:112-131` (textos de cola de Serato que ya no son solo de cues)
- Modify: los 6 `renderer/src/i18n/locales/*.json`
- Test: `sourcePrograms.test.ts`, `SourceTree.test.tsx`, `useRekordboxEdits.test.tsx`, `playlistEdits.test.ts`

**Interfaces:**
- Consumes: Task 4 (`window.api.editSeratoPlaylist`).
- Produces:
  - `SOURCE_PROGRAMS.serato.edit = { save: (edit, label) => window.api.editSeratoPlaylist(edit, label), messagePrefix: 'sources.editSerato.', gate: 'none' }` y `separator: null`.
  - `SourceTree` con `edit.crates` no muestra `source-tree-new-folder` ni `source-tree-new-folder-inside`. Muestra `source-tree-new-playlist-inside` en cualquier nodo con el texto `sources.tree.newCrateInside`, y la cabecera usa `sources.tree.newCrate`. Para borrar usa `sources.tree.deleteCrateTitle`, y como mensaje `deleteCrate` (sin subcrates) o `deleteCrateWithSubcrates` (con `count` = todos los descendientes).
  - i18n (es; traducir a los 6):
    - `sources.editSerato.*`: todas las claves de `sources.edit.*` cambiando "rekordbox" por "Serato" y "playlist" por "crate".
    - `sources.editSerato.notInCollection_one/_other`: "{{count}} está en otro disco o ya no existe" / "{{count}} están en otro disco o ya no existen".
    - `sources.editSerato.refused.badName`: "Ese nombre no vale para un crate. No puede estar vacío, repetirse ni llevar / o %%".
    - `sources.editSerato.refused.stale`: "El crate cambió en Serato. Revísalo y vuelve a intentarlo".
    - `sources.edit.refused.badName` y `sources.editTraktor.refused.badName` con el mismo sentido (lo exige la tabla `REFUSED`).
    - `sources.tree.newCrate`: "Nuevo crate". `sources.tree.newCrateInside`: "Nuevo crate dentro". `sources.tree.deleteCrateTitle`: "Borrar de Serato".
    - `sources.tree.deleteCrate`: "¿Borrar el crate «{{name}}»? Las pistas siguen en Serato.".
    - `sources.tree.deleteCrateWithSubcrates_one/_other`: "¿Borrar el crate «{{name}}» y su subcrate? Las pistas siguen en Serato." / "¿Borrar el crate «{{name}}» y sus {{count}} subcrates? Las pistas siguen en Serato.".
    - `seratoQueue.writeFailed`: "No se pudieron guardar los cambios en Serato. Los ficheros siguen como estaban".
    - `seratoQueue.discardConfirm`: "¿Descartar lo que espera? Serato se queda como está".

- [ ] **Step 1: tests rojos**

```tsx
it('lets the Serato tab edit crates with no separator and no folders', () => {
  expect(SOURCE_PROGRAMS.serato).toMatchObject({ separator: null, crates: true, invalidatesOnEdit: true, edit: { messagePrefix: 'sources.editSerato.', gate: 'none' } })
})
it('saves a Serato edit through editSeratoPlaylist', async () => {
  const editSeratoPlaylist = vi.fn<Api['editSeratoPlaylist']>().mockResolvedValue({ applied: true })
  await runEdit('serato', { kind: 'rename', playlistId: 'A', name: 'B' }, { editSeratoPlaylist })
  expect(editSeratoPlaylist).toHaveBeenCalledWith({ kind: 'rename', playlistId: 'A', name: 'B' }, 'A')
})
it('offers a new crate inside a crate and never a folder', async () => {
  renderTree({ crates: true, nodes: [{ id: 'A', name: 'A', kind: 'playlist', count: 2 }] })
  expect(screen.queryByTestId('source-tree-new-folder')).toBeNull()
  await openMenu('A')
  expect(screen.getByTestId('source-tree-new-playlist-inside')).toHaveTextContent('Nuevo crate dentro')
  expect(screen.queryByTestId('source-tree-new-folder-inside')).toBeNull()
})
it('says a bad crate name in Serato words', () => {
  expect(editMessage(tr, rename('A', 'a/b'), { applied: false, reason: 'bad-name' }, 'A', 'sources.editSerato.')?.text).toMatch(/crate/)
})
it('tells the DJ the change waits for Serato to close', async () => {
  renderApp({ source: 'serato', seratoRunning: true })
  expect(await screen.findByTestId('source-tree-notice')).toHaveTextContent('Tus cambios se guardarán cuando lo cierres')
})
```

- [ ] **Step 2: comprobar que fallan.** Run cada fichero. Expected: FAIL.
- [ ] **Step 3: implementar.** `App.tsx` pasa `edit={editableSource ? { ...treeEdit, ...(SOURCE_PROGRAMS[editableSource].crates && { crates: true as const }) } : undefined}` (memoizado) y usa `tr('editor.cues.serato.waiting')` como aviso. Si `editor.cues.serato.running` queda sin uso, se borra de los 6 idiomas.
- [ ] **Step 4: verde.** Pasan los tests de i18n (`keys.test.ts`, `usedKeys.test.ts`).
- [ ] **Step 5: suite, tres tsc y biome. Commit** `Edit Serato crates from its tab`.

### Task 6: `LibraryProgram`, ajustes `addToSerato`/`syncSerato` y estado de la biblioteca

**Files:**
- Modify: `apps/desktop/src/shared/djProgram.ts` (`LibraryProgram`, `LIBRARY_PROGRAMS`)
- Modify: `apps/desktop/src/shared/djSettings.ts:3-13` (`DJ_REACH_SETTINGS: Record<LibraryProgram, …>`, `serato: { sync: 'syncSerato', add: 'addToSerato' }`)
- Modify: `apps/desktop/src/shared/types.ts` (`Settings.addToSerato`, `Settings.syncSerato`, `seratoPlaylistsFieldOffered` cerca de `:250`; `LibraryStatus` en `:1648` sobre `LibraryProgram`)
- Modify: `apps/desktop/src/main/settings.ts:68,99` (valores por defecto `false`)
- Modify: `apps/desktop/src/main/libraryStatus.ts`, `apps/desktop/src/main/libraryFlushes.ts:91`, `apps/desktop/src/main/index.ts:1505`
- Modify: `apps/desktop/src/renderer/src/lib/settingsDraft.ts:132,150`, `renderer/src/lib/settingsContext.tsx:131`, `renderer/src/test/api.ts:30,54`, `renderer/src/components/settings/DestinationTab.tsx:541-580` (más una sección nueva tras la de Engine, `:430`), `renderer/src/lib/settingsSearchIndex.ts`, 6 locales
- Test: `libraryStatus.test.ts`, `settings.test.ts`, `DestinationTab.test.tsx`, `settingsDraft.test.ts`

**Interfaces:**
- Produces:
  - `type LibraryProgram = DjProgram` y `LIBRARY_PROGRAMS: readonly LibraryProgram[]` en el orden `rekordbox, traktor, engine, serato`.
  - `libraryStatus(settings: StatusSettings & { syncSerato: boolean }, exists: (path: string) => boolean, seratoFound: boolean): LibraryStatus` y `currentLibraryStatus(seratoFound = false): LibraryStatus`.
  - `DjReachRow` acepta `program: LibraryProgram`. Nueva sección `searchId="seratoSync"`, deshabilitada sin biblioteca de Serato (`window.api.seratoAvailable()`).
  - i18n (es): `settings.seratoSync` "Serato"; `settings.syncSerato` "Biblioteca de Serato"; `settings.syncSeratoHint` "Surco escribe en Serato cuando lo cierras. Actualizar lleva los cambios de etiquetas de la revisión, y Añadir mete además lo que conviertes"; `settings.syncSeratoIdle` "Surco no encuentra una biblioteca de Serato".

- [ ] **Step 1: tests rojos**

```ts
it('defaults Serato to off like Engine DJ', () => {
  expect(defaults()).toMatchObject({ addToSerato: false, syncSerato: false, seratoPlaylistsFieldOffered: false })
})
it('reports Serato enabled and found apart', () => {
  expect(libraryStatus({ ...S, syncSerato: true }, () => false, false).serato).toEqual({ enabled: true, found: false })
})
it('turns Serato to add from Settings', async () => {
  const save = renderDestination({ seratoAvailable: true })
  await user.click(screen.getByTestId('settings-reach-serato-add'))
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ syncSerato: true, addToSerato: true }))
})
it('disables the Serato row without a Serato library', async () => {
  renderDestination({ seratoAvailable: false })
  expect(await screen.findByTestId('settings-reach-serato')).toBeDisabled()
})
```

- [ ] **Step 2: comprobar que fallan.** Expected: FAIL.
- [ ] **Step 3: implementar.** Arreglar cada `Record` que el `tsc` señale; las tablas que siguen en `WritableProgram` (ver Rulings) no se tocan.
- [ ] **Step 4: verde.**
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Add Serato sync and add settings`.

### Task 7: añadir a Serato lo que Surco convierte, con sus crates

**Files:**
- Modify: `apps/desktop/src/main/rekordboxBatch.ts:6-25,153-189` (`seratoPlaylists?: LibraryPlaylistChoice`, `REPOINT_PLAYLISTS`/`ATTACH_PLAYLISTS` sobre `LibraryProgram`, `attachPlaylists(to, program: LibraryProgram, choice)`)
- Modify: `apps/desktop/src/main/processTrack.ts:508-527,798` (`JOB_PLAYLISTS.serato`, bucle sobre `LIBRARY_PROGRAMS`)
- Modify: `apps/desktop/src/shared/types.ts:631-636,839-844` (`seratoPlaylists`, `seratoPlaylistsBase` en `ProcessJob` y en la pista de sesión)
- Modify: `apps/desktop/src/main/rekordboxQueueFromRun.ts:82` (`library: 'traktor' | 'engine' | 'serato'`)
- Modify: `apps/desktop/src/shared/types.ts:1259` (`'other-volume'` junto a `'playlist-changed' | 'playlist-gone'`), `renderer/src/lib/rekordboxQueueText.ts` (`notices['other-volume'] = 'seratoQueue.notice.otherVolume'`)
- Modify: `apps/desktop/src/main/seratoCrateEdits.ts` (`applySeratoTrack`), `apps/desktop/src/main/seratoBatch.ts`
- Modify: `apps/desktop/src/main/libraryFlushes.ts:281-317` (`ConversionQueues.serato`, paso de Serato tras el bucle), `apps/desktop/src/main/index.ts` (pasa la cola)
- Test: `seratoCrateEdits.test.ts`, `libraryFlushes.test.ts`, `rekordboxBatch.test.ts`, `processTrack.test.ts`, `rekordboxQueueFromRun.test.ts`

**Interfaces:**
- Consumes: Task 2 (`withSeratoTrackAdded`, `seratoDatabaseHas`, `seratoFileType`), Task 1, Task 3 (borrador), Task 6 (`addToSerato`, `LIBRARY_PROGRAMS`).
- Produces:
  - `applySeratoTrack(draft: SeratoDraft, op: TrackOp, roots: SeratoLibraryRoot[], now: Date): OpOutcome`:
    - Sin raíz para `op.path`: aviso `'not-added'`.
    - Con `op.add` y `op.meta`, si el `database V2` de la raíz no tiene el `pfil`, añade la entrada: `type` de `seratoFileType` (si es `null`, aviso `'not-added'` y no hay alta), `addedAt` = `now` en segundos.
    - Crates como `applyTrack` de Traktor (`traktorPlaylistEdit.ts:209-248`), sobre el fichero del crate en la raíz de la pista:
      - Un objetivo con `id` cuyo crate no está en esa raíz da aviso `{ code: 'other-volume', track, playlist }`.
      - Uno sin `id` crea `<name>.crate` en esa raíz si el nombre vale.
      - Un crate que tiene la pista y no está en `known` da `'playlist-changed'`.
      - Lo que se deseleccionó se quita.
  - `applySeratoLibraryOps` deja de rechazar `track` y llama a `applySeratoTrack`.
  - `ConversionQueues.serato?: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void; roots: () => SeratoLibraryRoot[] }`.
  - `seratoLibraryHas(roots: SeratoLibraryRoot[]): (path: string) => boolean`. Da `true` (nada que hacer) si el volumen no tiene `_Serato_` o si el `pfil` ya está (NFC). No sigue `from`, porque Serato no repunta.
  - Paso en `flushConversionBatch` tras `settle`. `libraryTrackOps(repoints, 'serato', undefined, addToSerato, addToSerato && run.addable ? seratoLibraryHas(roots) : undefined)`. Si hay operaciones, `enqueue` y después `applyQuietly()` sin `await`. No cambia `FlushOutcome`.
  - i18n `seratoQueue.notice.otherVolume` (es): "{{track}} está en otro disco y no puede ir al crate «{{playlist}}»".

- [ ] **Step 1: tests rojos**

```ts
it('adds a converted file Serato does not have to the database of its volume', () => {
  const outcome = applySeratoTrack(draft, trackOp({ path: '/Users/dj/new.aiff', add: true, meta: META }), roots, NOW)
  expect(outcome.applied).toBe(true)
  expect(parseSeratoDatabase(draft.read(dbOf(roots[0]))!).at(-1)).toMatchObject({ path: 'Users/dj/new.aiff', title: META.title, addedAt: NOW_S })
})
it('does not add a file the database already holds under another normalization', () => {
  applySeratoTrack(draft, trackOp({ path: '/Users/dj/Música/a.mp3'.normalize('NFC'), add: true, meta: META }), rootsWith(['Users/dj/Música/a.mp3'.normalize('NFD')]), NOW)
  expect(parseSeratoDatabase(draft.read(dbOf(roots[0]))!)).toHaveLength(1)
})
it('puts the converted file in the crates the conversion chose', () => {
  applySeratoTrack(draft, trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'A', name: 'A' }, { name: 'Nuevo' }] }), roots, NOW)
  expect(crateTrackPaths(draft.read(crateFileOf(roots[0], 'A'))!)).toContain('Users/dj/a.mp3')
  expect(crateTrackPaths(draft.read(crateFileOf(roots[0], 'Nuevo'))!)).toEqual(['Users/dj/a.mp3'])
})
it('warns instead of adding to a crate on another drive', () => {
  expect(applySeratoTrack(draft, trackOp({ path: '/Users/dj/a.mp3', wanted: [{ id: 'OnlyGig', name: 'OnlyGig' }] }), roots, NOW).notices).toEqual([{ code: 'other-volume', track: 'a.mp3', playlist: 'OnlyGig' }])
})
it('skips a format Serato does not take', () => {
  expect(applySeratoTrack(draft, trackOp({ path: '/Users/dj/a.ogg', add: true, meta: META }), roots, NOW).notices[0].code).toBe('not-added')
})
it('queues Serato adds after the three libraries of today, only with addToSerato on', async () => {
  settings({ addToSerato: true })
  const serato = { enqueue: vi.fn(), applyQuietly: vi.fn(), roots: () => roots }
  await flushConversionBatch(HOST, SESSIONS, { ...QUEUES, serato })
  expect(serato.enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'track', add: true, path: OUT })])
  settings({ addToSerato: false })
  serato.enqueue.mockClear()
  await flushConversionBatch(HOST, SESSIONS, { ...QUEUES, serato })
  expect(serato.enqueue).not.toHaveBeenCalled()
})
it('carries Serato crate picks from the job to the repoint', () => {
  expect(JOB_PLAYLISTS.serato({ ...JOB, seratoPlaylists: [{ id: 'A', name: 'A' }], seratoPlaylistsBase: [] })).toEqual({ wanted: [{ id: 'A', name: 'A' }], base: [] })
  attachPlaylists(OUT, 'serato', { wanted: [{ id: 'A', name: 'A' }], base: [] })
  expect(recordedRekordboxRepoint(OUT)?.seratoPlaylists).toEqual({ wanted: [{ id: 'A', name: 'A' }], base: [] })
})
```

- [ ] **Step 2: comprobar que fallan.** Expected: FAIL.
- [ ] **Step 3: implementar.** En `index.ts`, la llamada a `flushConversionBatch` recibe `serato: { enqueue: seratoCueQueue.enqueue, applyQuietly: () => programQueues.serato.applyQuietly(), roots: seratoRoots }`.
- [ ] **Step 4: verde.** Mutación: no comparar en NFC duplica la entrada; olvidar `uadd` hace caer el test del escritor.
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Add converted tracks and their chosen crates to Serato`.

### Task 8: campo "Crates de Serato" en el editor

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:1822` (`PlaylistLibrary = LibraryProgram`)
- Modify: `apps/desktop/src/renderer/src/types.ts:236-241` (`seratoPlaylists`, `seratoPlaylistsBase`)
- Modify: `apps/desktop/src/renderer/src/lib/trackPrograms.ts` (`TRACK_PROGRAMS.serato` completo con `playlists: 'seratoPlaylists'`, `playlistsBase: 'seratoPlaylistsBase'`, `signatureTag: null`, `rereadAfterMove: false`; condición de tipo sobre `PlaylistLibrary`; bucles sobre `LIBRARY_PROGRAMS`)
- Modify: `apps/desktop/src/renderer/src/lib/fields.ts:147` (`serato: 'seratoPlaylists'`), `renderer/src/hooks/useRekordboxPlaylists.ts:21-25` (`OFFERED.serato = 'seratoPlaylistsFieldOffered'`, bucle sobre `LIBRARY_PROGRAMS`), `renderer/src/lib/sourcePrograms.ts` (`addsUncollected: true` en Serato), `renderer/src/components/Editor.tsx:1134-1151`, `App.tsx:855-861` (`onWritten`/`onDiscarded` de la cola de Serato limpian `'serato'`), y cada `Record<PlaylistLibrary, …>` que señale `tsc`
- Modify: 6 locales (`fields.seratoPlaylists`, es: "Crates de Serato")
- Test: `useRekordboxPlaylists.test.tsx`, `trackPrograms.test.ts`, `Editor.test.tsx`

**Interfaces:**
- Consumes: Task 6, Task 7 (`ProcessJob.seratoPlaylists`).
- Produces: el campo `seratoPlaylists`, ofrecido una vez cuando hay biblioteca de Serato, con `data-testid` de prefijo `serato-`. Las elecciones viajan en `jobPlaylists`, se guardan en la sesión y se limpian cuando la cola de Serato las escribe.

- [ ] **Step 1: tests rojos**

```tsx
it('offers the Serato crates field once a Serato library is there', () => {
  renderOffer({ available: { rekordbox: false, traktor: false, engine: false, serato: true } })
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ seratoPlaylistsFieldOffered: true, visibleFields: expect.arrayContaining(['seratoPlaylists']) }))
})
it('sends the crates picked for a track with its job', () => {
  expect(jobPlaylists({ seratoPlaylists: [{ id: 'A', name: 'A' }], seratoPlaylistsBase: [] })).toMatchObject({ seratoPlaylists: [{ id: 'A', name: 'A' }], seratoPlaylistsBase: [] })
})
it('picks a crate in the editor for a track Serato does not have yet', async () => {
  renderEditor({ visibleFields: ['seratoPlaylists'], seratoTree: [{ id: 'A', name: 'A', kind: 'playlist', count: 0 }], seratoMembership: {} })
  await user.click(await screen.findByTestId('serato-playlists-field'))
  await user.click(screen.getByRole('option', { name: 'A' }))
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ seratoPlaylists: [{ id: 'A', name: 'A' }] }))
})
```

(El `data-testid` exacto del campo es el que da `fieldTestId('serato', …)` en `PlaylistsField.tsx:18`; el test usa el mismo ayudante que el de Engine.)

- [ ] **Step 2: comprobar que fallan.** Expected: FAIL.
- [ ] **Step 3: implementar.**
- [ ] **Step 4: verde.**
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Pick Serato crates for a track in the editor`.

### Task 9: llevar a Serato las etiquetas de la revisión

**Files:**
- Modify: `apps/desktop/src/main/rekordboxQueueOps.ts:47,63-77` (`TagsOp`, unión, `opRank` 1)
- Modify: `apps/desktop/src/main/rekordboxQueue.ts:117-122,150-190` (`keyOf`: `` `tags:${op.id}` ``; `stateOf`: parte `{ kind: 'tags' }` en el ítem `track:${path}`)
- Modify: `apps/desktop/src/shared/types.ts:1652-1656,1829` (`'queued'`, `LibraryTagSyncReport: Record<LibraryProgram, LibraryTagSync>`, parte `{ kind: 'tags' }`)
- Modify: `apps/desktop/src/main/seratoCrateEdits.ts` (`applySeratoTags`), `seratoBatch.ts`
- Create: `apps/desktop/src/main/seratoTagSync.ts`
- Modify: `apps/desktop/src/main/libraryTagSync.ts:6-8` (`LIBRARY_ORDER = programsInOrder(['traktor', 'rekordbox', 'engine', 'serato'])`, `LibraryTagFlushers` sobre `LibraryProgram`), `main/libraryFlushes.ts:635` (cuarto parámetro `serato`), `main/index.ts:1558`
- Modify: `apps/desktop/src/renderer/src/components/MusicReviewDetail.tsx:41,285` (`ReviewSync: Record<LibraryProgram, boolean>`, Serato en los lugares), `renderer/src/lib/reviewLibraries.ts` (`TAG_LIBRARIES` con Serato), `renderer/src/components/MusicReview.tsx:333-360,413-457` (fila y avisos de Serato solo desde `tagSync`/`libraries`; `run.replaced` solo para los escribibles), `App.tsx:3557` (`serato: settings?.syncSerato ?? false`), 6 locales
- Test: `seratoTagSync.test.ts`, `seratoCrateEdits.test.ts`, `rekordboxQueue.test.ts`, `libraryTagSync.test.ts`, `MusicReview.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`withSeratoTrackFields`), Task 3, Task 6 (`syncSerato`, `LibraryStatus.serato`).
- Produces:
  - `interface TagsOp { id: string; kind: 'tags'; path: string; label: string; fields: Partial<Record<SeratoTagField, string>> }`, y `QueueOp = EditOp | TrackOp | CuesOp | TagsOp`.
  - `applySeratoTags(draft: SeratoDraft, op: TagsOp, roots: SeratoLibraryRoot[]): OpOutcome`. Si no hay raíz, o `withSeratoTrackFields` da `null`, devuelve `applied: false` con aviso `'not-in-library'`.
  - `seratoTagOps(updates: LibraryTagUpdate[], roots: SeratoLibraryRoot[]): TagsOp[]`. Coge solo `title`, `artist`, `album` y `genre` (con su `to`), y solo las rutas cuyo `pfil` está ahora en el `database V2` de su raíz.
  - `syncSeratoTags(updates: LibraryTagUpdate[], deps: { enabled: boolean; roots: () => SeratoLibraryRoot[]; queue: Pick<RekordboxQueue, 'enqueue' | 'apply' | 'drop'>; isRunning: () => Promise<boolean>; onWaiting: () => void }): Promise<LibraryTagSync>`:
    - Apagado: `'nothing'`. Sin raíces: `'missing'`. Sin operaciones: `'nothing'`.
    - Si no, encola y llama directamente a `queue.apply(async () => !(await deps.isRunning()))`. No usa `applyQuietly`, porque ya corre dentro de `serialLibraryFlush` y se bloquearía.
    - Aplicado: `'updated'` con el número de operaciones propias aplicadas, o `'nothing'` si es 0. Esperando: `onWaiting()` y `'queued'`. Rechazado: `drop` de cada una y `'failed'`.
  - `syncTagsInLibraries(updates, host, sessions, beginMoment, serato?: Omit<Parameters<typeof syncSeratoTags>[1], 'enabled'>)`. Sin `serato` devuelve `{ outcome: 'nothing' }` para Serato.
  - i18n (es): `rekordboxQueue.part.tags` "etiquetas"; `musicReview.done.where.queued` "se guardará al cerrar Serato".

- [ ] **Step 1: tests rojos**

```ts
it('changes title, artist, album and genre of the track Serato has at that path, and nothing else', () => {
  const op: TagsOp = { id: 't', kind: 'tags', path: '/Users/vicent/Music/Serato Pruebas/Pray.aiff', label: 'Pray.aiff', fields: { tsng: 'Pray', tart: 'Tina', talb: 'P', tgen: 'House' } }
  expect(applySeratoTags(draft, op, roots).applied).toBe(true)
  expect(parseSeratoDatabase(draft.read(dbOf(roots[0]))!)[0]).toMatchObject({ title: 'Pray', artist: 'Tina', album: 'P', genre: 'House', path: PRAY_PFIL })
})
it('never syncs albumArtist and skips tracks Serato does not have', () => {
  expect(seratoTagOps([{ path: PRAY, fields: { albumArtist: { from: 'a', to: 'b' } } }, { path: '/Users/dj/x.mp3', fields: { title: { from: 'a', to: 'b' } } }], roots)).toEqual([])
})
it('writes at once with Serato closed and reports the count', async () => {
  expect(await syncSeratoTags(UPDATES, depsWith({ running: false }))).toEqual({ outcome: 'updated', count: 1 })
})
it('queues with Serato open and says it will save on close', async () => {
  const deps = depsWith({ running: true })
  expect(await syncSeratoTags(UPDATES, deps)).toEqual({ outcome: 'queued' })
  expect(deps.onWaiting).toHaveBeenCalled()
})
it('keeps two syncs of the same track queued apart so neither field is lost', () => {
  queue.enqueue([tags('a', { tsng: 'T' })])
  queue.enqueue([tags('b', { tart: 'A' })])
  expect(queue.state().items[0].parts).toEqual([{ kind: 'tags' }, { kind: 'tags' }])
})
it('shows Serato in the done sheet when its sync is on', () => {
  renderDone({ libraries: { ...OFF, serato: { enabled: true, found: true } }, tagSync: { ...NOTHING, serato: { outcome: 'queued' } } })
  expect(screen.getByTestId('music-review-done-where-serato')).toHaveTextContent('se guardará al cerrar Serato')
})
```

(El `data-testid` de la fila sale de cómo `MusicReview.tsx` nombra las de las otras bibliotecas; el test usa ese mismo patrón.)

- [ ] **Step 2: comprobar que fallan.** Expected: FAIL.
- [ ] **Step 3: implementar.** En `index.ts`, `library:syncTags` pasa `{ roots: seratoRoots, queue: seratoCueQueue, isRunning: DJ_PROCESSES.serato.isRunning, onWaiting: seratoCueQueueWatch.poke }`, y `enabled` sale de `getSettings().syncSerato` dentro de `syncTagsInLibraries`.
- [ ] **Step 4: verde.** Mutación: usar `keyOf` por ruta hace caer el test de las dos sincronizaciones; llamar a `applyQuietly` en lugar de `apply` deja el test colgado (timeout).
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Carry review tag changes to Serato`.

### Task 10: prueba manual y cierre (controlador, no subagente)

- [ ] Copia exacta antes de empezar: `~/Music/_Serato_` (incluidos `database V2`, `Subcrates/`, `neworder.pref` y `SmartCrates/`), la carpeta de `master.sqlite` de Serato y `~/Music/Serato Pruebas`, con `cp -Rp` a una carpeta fechada del scratchpad. Sumas con `shasum` de `neworder.pref`, `SmartCrates/*` y `*.sqlite` para comprobar al final que no cambiaron.
- [ ] Surco con perfil aislado (`run-desktop`) y Serato cerrado:
  - crear `Prueba C` en la raíz, `Sub` dentro, renombrar `Prueba C` a `Prueba D`, reordenar y quitar pistas de Pray, añadir arrastrando desde la lista y desde otra pestaña, y borrar `Sub`;
  - convertir un Clicks con "añadir" en Serato y el crate `Prueba D` elegido;
  - cambiar el título de Pray.mp3 en la revisión.
- [ ] Repetir una edición de crate con Serato abierto. Comprobar que espera y se aplica al cerrarlo. **Medir aquí si Serato reescribe al cerrarse los `.crate` y `database V2`.** Si reescribe los crates, la huella por mtime rechazará toda edición de crate encolada con Serato abierto, y hay que volver al usuario con la alternativa de una huella por contenido (la lista de `ptrk`).
- [ ] Abrir Serato: los crates y subcrates tienen el nombre, el orden y las pistas esperados; la conversión está en la biblioteca y en `Prueba D`; el título nuevo sale y Pray conserva sus estrellas. Anotar si el crate nuevo cae al final o por orden alfabético (`neworder.pref`, pregunta abierta de la spec).
- [ ] Las sumas de `neworder.pref`, `SmartCrates/*` y `*.sqlite` siguen iguales. Las copias están en `serato-backups`.
- [ ] Matriz completa igual a la base, suite, tres tsc y biome. `git merge main`, otra vez la suite, y `git merge --ff-only serato-c` en el main local (sin push).
