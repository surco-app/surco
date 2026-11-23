# Fase 2: Serato sigue la sustitución. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** al sustituir una pista que está en Serato («Actualizar», `job.replacesPath`), el fichero nuevo lleva las marcas y la rejilla de Serato del viejo, la entrada de `database V2` y los `.crate` pasan a la ruta nueva, y antes de sustituir Surco avisa de que Serato perderá las estrellas de la pista. De paso, toda conversión que reescribe el audio deja de perder la rejilla de Serato.

**Architecture:** la copia de marcas reutiliza `carrySeratoCues` (ya existe para conversiones), con el fichero sustituido como origen y un `shiftMs` nuevo que en esta fase vale 0; la rejilla (`Serato Tempo Map` y el `Serato BeatGrid` antiguo) viaja en el mismo paso con el mismo desfase. El reapuntado recupera la idea de aa4c70aa3 (revertido en 99597884a), pero escrito sobre el borrador y la confirmación de hoy (`createSeratoDraft` / `commitSeratoDraft`, con copia, sellos y vuelta atrás). Solo reapunta sustituciones: las conversiones normales siguen conservando el original como hace e4e40a2ca. El aviso es una nota de una línea encima del botón, como `convert-lossy-note`.

**Tech Stack:** Electron, TypeScript, React 19, TanStack Query, Vitest, TagLib (`taglib-wasm`), ffmpeg-static.

**Spec:** `docs/superpowers/specs/2026-11-22-revisar-sustituidas-design.md` (sección 2; decisión A del 22/11).

## Global Constraints

- TDD: cada test se ve fallar (rojo) antes de escribir el código. Sin rojo no hay verde.
- Los tests dicen POR QUÉ importa el comportamiento (nombre y comentario), no solo qué hace.
- Selectores de UI: `data-testid` primero; nunca clases CSS.
- Seguir el estilo del código: el código de Surco lleva comentarios que explican el porqué; los cambios nuevos los llevan igual.
- Un commit por funcionalidad, título descriptivo en inglés, sin cuerpo y sin `feat:`/`fix:`. Nunca `--no-verify`.
- Fixtures sintéticos (ffmpeg `sine`, `seratoDatabaseFixture.ts`, `seratoLibraryFixture.ts`); nunca la colección de un DJ.
- Campos nuevos en tipos persistidos (cola `serato-cue-queue.json`) siempre opcionales. Ningún namespace de caché sube.
- Serato solo se escribe con Serato cerrado (lo garantiza `commitSeratoDraft`); si está abierto, el reapuntado espera en su cola.
- Textos de UI: los 8 ficheros de `renderer/src/i18n/locales` (`keys.test.ts` exige las mismas claves en `ca de en es fr it ja pt-BR`), tuteo donde haya trato, sin guion largo ni dos puntos explicativos, lo más corto posible.
- Tests: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>` (el worktree no tiene `node_modules` propio). Mirar SIEMPRE el código de salida y `grep -E "Unhandled|Errors "` en la salida.
- Regla para la fase 3 (la fija esta fase): la medida del desfase se hace contra el temporal ya terminado (que ya incluye cualquier recorte), ANTES del bloque `carrySerato` de `convertAudio` y ANTES de `proveDecodable`; después de esa prueba nada puede escribir el temporal. En una sustitución, `carrySeratoCues` recibe `trimMs: 0` y `shiftMs: replaceCueShiftMs`.
- Tipos: `cd apps/desktop && npx tsc --build`. Lint: `npm run lint -w apps/desktop` y `npm run lint -w apps/web`, enteros.

## Review Focus

1. **Sustitución de un MP3 con bloque v1 (`Serato Markers_`) por un AIFF:** el v1 manda en MP3 (medido 03/11); el AIFF nuevo debe llevar los cues que Serato mostraba, no los de un `Markers2` desfasado. Test en la tarea 2.
2. **Serato abierto al terminar la sustitución:** el reapuntado espera en la cola y el fichero viejo NO se retira mientras Serato lo usa; al cerrarse, se aplica. Test en la tarea 7.
3. **Fichero nuevo en otro volumen que el viejo** (cada volumen tiene su `_Serato_`): no se escribe nada, el viejo se queda. Test en la tarea 5.
4. **Rutas con acentos guardadas en NFD:** el reapuntado casa la entrada y escribe la ruta nueva en la misma forma que estaba. Test en la tarea 4.
5. **Fichero sustituido ilegible al copiar las marcas:** Serato no se reapunta (perdería los cues) y el viejo se queda. Tests en las tareas 2 y 6.

---

### Task 1: `carrySeratoCues` acepta un desplazamiento

**Files:**
- Modify: `apps/desktop/src/main/seratoTags.ts:300-329`
- Modify: `apps/desktop/src/main/workerJobs.ts:136-143` (tipo del trabajo `carrySeratoCues`)
- Modify: `apps/desktop/src/main/ffmpeg.ts:2591-2599` (pasa `shiftMs: 0` de momento)
- Test: `apps/desktop/src/main/seratoTags.test.ts`

**Interfaces:**
- Produces: `carrySeratoCues(source: string, dest: string, opts: { trimMs: number; carry: boolean; strip: boolean; shiftMs: number }): Promise<void>`. `shiftMs` positivo = el mismo audio está más tarde en `dest`, los cues se mueven más tarde. Se suma al desfase de reloj que ya calcula (`leadDest - leadSource - trimMs + shiftMs`); el corte `fromMs` no cambia. El trabajo del worker gana `shiftMs: number`.

- [ ] **Step 1: test en rojo** en `seratoTags.test.ts`, nuevo `describe('carrySeratoCues with a shift')`:

```ts
// The replaced file and its replacement can be different masters: the same beat sits
// later in the new one, and a cue left at its old millisecond lands before the drop.
it('moves the carried cues later by the shift, on top of the clock difference', async () => {
  const source = audioFile('wav'); setSeratoMarkers(source, withSeratoCues(null, [{ index: 0, ms: 2000, color: 0xcc0000, name: '' }]))
  const dest = audioFile('wav')
  await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: false, shiftMs: 120 })
  expect(readSeratoMarkers(dest)?.cues[0].ms).toBe(2120)
})
it('carries the cues where they were with no shift', … shiftMs: 0 … toBe(2000))
```

Actualizar la llamada existente de la línea 171 con `shiftMs: 0`.

- [ ] **Step 2:** ejecutar `…vitest.mjs run src/main/seratoTags.test.ts`. Esperado: FAIL (2120 ≠ 2000) y error de tipos en `shiftMs`.
- [ ] **Step 3:** añadir `shiftMs` a `carrySeratoCues`, al tipo del worker y a la llamada de `ffmpeg.ts` (`shiftMs: 0`).
- [ ] **Step 4:** el test pasa; `cueMatrix.test.ts` entero sigue verde.
- [ ] **Step 5:** commit `Let the Serato cue carry move cues by a given shift`.

### Task 2: la sustitución copia las marcas del fichero viejo y lo deja dicho en el reapuntado

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts:2589-2599` (origen de la copia) y `:2764-2771` (reapuntado)
- Modify: `apps/desktop/src/main/rekordboxBatch.ts:6-27` (`RekordboxRepoint`)
- Modify: `apps/desktop/src/main/rekordboxRepointFor.ts:56-66`
- Test: `apps/desktop/src/main/cueMatrix.test.ts`, `apps/desktop/src/main/convertRekordboxRepoint.test.ts`

**Interfaces:**
- Consumes: `carrySeratoCues(..., { shiftMs })` (tarea 1).
- Produces:
  - `RekordboxRepoint.replaced?: true`: lo pone `rekordboxRepointFor` cuando recibe `options.replaces`. Distingue una sustitución de una conversión normal en todas las colas.
  - `RekordboxRepoint.seratoCarryFailed?: true`: lo pone `convertAudio` cuando la copia de marcas desde `replacesPath` lanzó.
  - En `convertAudio`, justo antes del bloque `carrySerato`, una constante local `const replaceCueShiftMs = 0`. Regla de llamada:
    - con `replacesPath`: `carrySeratoCues(replacesPath, tmp, { trimMs: 0, shiftMs: replaceCueShiftMs, carry, strip })`. El recorte NO se descuenta: la fase 3 mide contra el temporal terminado, que ya lo incluye, y descontarlo otra vez lo contaría dos veces.
    - sin `replacesPath`: `carrySeratoCues(input, tmp, { trimMs: <recorte, como hoy>, shiftMs: 0, carry, strip })`.
    - **La fase 3 solo sustituye `replaceCueShiftMs` por la medida**, calculada antes de este bloque y antes de `proveDecodable`. No toca la llamada.

- [ ] **Step 1: tests en rojo.** En `cueMatrix.test.ts`, `describe('a replacement carries the Serato cues of the file it replaces')`, con `convertAudio` y `replacesPath` como argumento 16 (tras `foreignRemoved`):

```ts
// The download never was in Serato: the cues the DJ set live in the file it replaces,
// and that file is retired once the check comes back.
it('writes the replaced file\'s Serato cues into the new file, not the download\'s', async () => {
  const replaced = makeSeratoSource(dir, '.mp3')          // MP3 con Markers_ y Markers2 que casan
  const download = plainSine(dir, '.flac')                // sin marcas de Serato
  await convertAudio(download, out /* .aiff */, 'aiff', meta, …, replaced)
  expect((await surcoMs(out))?.cue[0]).toBeCloseTo((await surcoMs(replaced))?.cue[0] ?? NaN, 0)
})
it('keeps the download\'s own Serato cues when the replaced file has none', …)
// The measure of phase 3 is taken on the finished file, trim included: taking the trim
// off again here would move the cues twice.
it('does not take a trim off the replaced file\'s cues', …)   // trim { startSec: 0.5 } + replacesPath → cue[0] ≈ el del viejo
// Review Focus 5
it('says so on the repoint when the replaced file could not be read, so Serato is not pointed at a file without its cues', async () => {
  await convertAudio(download, out, 'aiff', meta, …, join(dir, 'gone.mp3'))
  expect(recordedRekordboxRepoint(out)).toMatchObject({ replaced: true, seratoCarryFailed: true })
})
```

En `convertRekordboxRepoint.test.ts`: `rekordboxRepointFor('/downloads/a.flac', '/m/a.aiff', { replaces: '/m/a.mp3' })` lleva `replaced: true`; sin `replaces`, no lleva la clave.

- [ ] **Step 2:** ejecutar los dos ficheros. Esperado: FAIL (el cue sale `null` o del download; falta `replaced`).
- [ ] **Step 3:** en `ffmpeg.ts`, `source: replacesPath ?? input`, `trimMs: replacesPath ? 0 : <recorte>` y `shiftMs: replacesPath ? replaceCueShiftMs : 0` en el trabajo `carrySeratoCues`; `seratoCarryFailed = true` en su `.catch` solo si había `replacesPath`; pasar el campo al `rekordboxRepointFor` (o añadirlo al objeto devuelto antes de `recordRekordboxRepoint`). En `rekordboxRepointFor`, `...(options.replaces ? { replaced: true as const } : {})`. La copia sigue antes de la prueba de decodificación (`proveDecodable`): después de ella nada puede escribir el temporal.
- [ ] **Step 4:** los tests pasan; `cueMatrix.test.ts` y `convertRekordboxRepoint.test.ts` enteros en verde.
- [ ] **Step 5:** commit `Carry the replaced file's Serato cues into its replacement`.

### Task 3: la rejilla de Serato viaja con los cues

**Files:**
- Modify: `apps/desktop/src/shared/seratoMarkers.ts` (junto a `readSeratoTempoMap`)
- Modify: `apps/desktop/src/main/seratoTags.ts` (`carrySeratoCues`, `dropSeratoAnalysis`, escritores de la rejilla por contenedor junto a `id3TempoMap` / `flacTempoMap` / `m4aTempoMap`)
- Test: `apps/desktop/src/shared/seratoMarkers.test.ts`, `apps/desktop/src/main/seratoTags.test.ts`, `apps/desktop/src/main/cueMatrix.test.ts`

**Comprobado hoy:** la rejilla se pierde también en las conversiones normales. Solo la copia tal cual la conserva (mismo formato y sin desplazamiento, `seratoAnalysisKept = true` en `ffmpeg.ts:2354`). Toda recodificación deja el temporal sin datos de Serato (la matriz exige `seratoLeftovers(out)` vacío entre formatos). Con el audio movido, `strip` quita `Serato Tempo Map` y `Serato BeatGrid` junto con el resto del análisis (`dropSeratoAnalysis`). Una rejilla corregida a mano se pierde y Serato la recalcula al cargar la pista. Se arregla en las dos vías, sustitución y conversión normal.

**Interfaces:**
- Consumes: `carrySeratoCues(..., { shiftMs })` (tarea 1) y la regla de llamada de la tarea 2.
- Produces:
  - `retimedSeratoTempoMap(data: Uint8Array, shiftMs: number): Uint8Array | null` en `shared/seratoMarkers.ts`. Suma `shiftMs / 1000` al primer golpe (f64 en el byte 4) y deja el resto igual. Devuelve `null` si `readSeratoTempoMap(data)` no reconoce la forma (forma no medida); entonces no se copia.
  - `retimedSeratoBeatGrid(data: Uint8Array, shiftMs: number): Uint8Array | null`. Formato antiguo: cabecera `01 00`, recuento u32 y marcas con posición f32 en segundos. Suma el desfase a cada posición; `null` si no se puede leer entero.
  - `carrySeratoCues` copia, además de las marcas, la rejilla del origen al destino con el MISMO desfase que los cues (`leadDest - leadSource - trimMs + shiftMs`). Cada contenedor en su campo: GEOB `Serato Tempo Map` / `Serato BeatGrid` (ID3, descripción en Latin-1 como las marcas), Vorbis `SERATO_TEMPO_MAP` / `SERATO_BEATGRID` y freeform `----:com.serato.dj:tempomap` / `beatgrid`.
    - Se copia aunque `strip` quite el resto del análisis.
    - No se copia con `carry: false` (etiquetas vaciadas o marcas de Serato borradas en el inspector), igual que hoy las marcas.
    - Si el origen no tiene rejilla, la del destino se queda como esté.
    - `Serato Overview` y los demás análisis siguen sin copiarse.

- [ ] **Step 1: tests en rojo.**

```ts
// seratoMarkers.test.ts
it('moves the first beat of a tempo map by the shift and keeps its BPM', …)        // 2,950 s con +120 ms → 3,070 s; bpm igual
it('answers null for a tempo map shape that was never measured', …)               // recuento 2
it('moves every marker of an old BeatGrid by the shift', …)
// seratoTags.test.ts
// A DJ who fixed the grid by hand in Serato loses that work if the copy drops it:
// Serato re-analyses a track with no grid and lands wherever its detector says.
it('carries the tempo map with the cues, moved by the same amount', …)          // wav → wav, shiftMs 120
it('carries the tempo map even when the rest of the Serato analysis is stripped', …) // strip: true → sin Overview, con Tempo Map
it('carries no grid when the DJ asked for no Serato data', …)                    // carry: false
// cueMatrix.test.ts
it('keeps a hand-set Serato grid on the same beat from FLAC to MP3, where the MP3 clock starts later', …)
  // primer golpe del MP3 ≈ el del FLAC + seratoLeadOfFile(out) - seratoLeadOfFile(in), margen 1 ms
it('keeps the replaced file\'s Serato grid in its replacement', …)                 // con replacesPath
```

El fixture `makeSeratoSource` no lleva Tempo Map, así que la aserción `seratoLeftovers(out)` vacía de la matriz no cambia. Si al implementar hubiera que cambiarla (por ejemplo, para dejar pasar `Serato Tempo Map`), avisar a Vicent ANTES del commit de qué deja de hacer la app.

- [ ] **Step 2:** ejecutar los tres ficheros. Esperado: FAIL (funciones inexistentes, rejilla ausente en el destino).
- [ ] **Step 3:** implementar las dos funciones de `shared` y los escritores por contenedor. En `carrySeratoCues`, leer la rejilla bruta del origen, retemporizarla y escribirla después de `dropSeratoAnalysis`, en la misma pasada de TagLib (`saveKeeping`).
- [ ] **Step 4:** verde, y `cueMatrix.test.ts` y `seratoTags.test.ts` enteros.
- [ ] **Step 5:** commit `Carry Serato's beat grid with its cues, moved by the same amount`.

### Task 4: reescribir una ruta en `database V2` y en un `.crate`

**Files:**
- Modify: `apps/desktop/src/main/seratoDatabaseWrite.ts`
- Modify: `apps/desktop/src/main/seratoCrateFile.ts`
- Test: `apps/desktop/src/main/seratoDatabaseWrite.test.ts`, `apps/desktop/src/main/seratoCrateFile.test.ts`

**Interfaces:**
- Produces:
  - `withSeratoTrackRepointed(bytes: Uint8Array, fromPfil: string, toPfil: string): Uint8Array | null`: reescribe `pfil` de la entrada cuyo `pfil` casa en NFC con `fromPfil`, en la forma (NFC/NFD) en que estaba guardado; si `seratoFileType(toPfil)` difiere del `ttyp` guardado, lo reescribe también. Todo lo demás byte a byte igual. `null` si no hay tal entrada o la base no se puede leer entera.
  - `withCrateTrackRepointed(bytes: Uint8Array, fromPfil: string, toPfil: string): Uint8Array | null`: mismo criterio sobre `ptrk`, usando `crateTrackPaths` + `withCrateTracks` para que la pista conserve su posición. `null` si el crate no la tiene.

- [ ] **Step 1: tests en rojo.**

```ts
// Serato keeps BPM, key, added date and plays across the re-import only because they ride in
// database V2 (measured 04/11): a rewrite that lost any of them would cost more than the stars.
it('changes only the path and the type, leaving tbpm, tkey, uadd and utpc as they were', …)
it('writes the new type Serato expects when the format changes', …)            // .mp3 → .wav: ttyp 'wave'
it('keeps the decomposed form the database stored the path in', …)            // Review Focus 4
it('leaves every other track untouched', …)
it('answers null for a path the database does not hold', …)
// seratoCrateFile.test.ts
it('points the crate at the new file in the same position, since DJs order crates by hand', …)
it('answers null for a crate without the file', …)
```

- [ ] **Step 2:** ejecutar ambos ficheros. Esperado: FAIL (funciones no exportadas).
- [ ] **Step 3:** implementar las dos funciones sobre `rawFramesOf` / `frame` / `textFrame` (los ayudantes que ya usan `withSeratoTrackFields` y `withCrateTracks`).
- [ ] **Step 4:** verde.
- [ ] **Step 5:** commit `Rewrite a track's path in Serato's database and crates`.

### Task 5: `repointSerato` sobre el borrador de Serato

**Files:**
- Create: `apps/desktop/src/main/seratoRepoint.ts`
- Test: `apps/desktop/src/main/seratoRepoint.test.ts`

**Interfaces:**
- Consumes: `withSeratoTrackRepointed`, `withCrateTrackRepointed` (tarea 4); `createSeratoDraft`, `commitSeratoDraft`, `SeratoCommitDeps` (`seratoLibraryWrite.ts`); `seratoRootOf`, `seratoPathOn` (`seratoCrateFile.ts`); `LibraryRepointResult` (`libraryRepointFlush.ts`).
- Produces: `repointSerato(repoints: RekordboxRepoint[], deps: SeratoCommitDeps): Promise<LibraryRepointResult[]>`, un resultado por reapuntado, en orden. Razones: `'rekordbox-running'` para todos si `commitSeratoDraft` responde `'cancelled'` (Serato abierto; el nombre es el que `COLLECTION_WIDE` ya reconoce y deja la cola esperando), `'unreadable'` para todos si una base implicada está truncada (`seratoDatabaseTruncated`), `'backup-failed'` / `'write-failed'` para todos según la confirmación, `'other-volume'` si `from` y `to` caen en raíces distintas (o `to` en ninguna), `'no-match'` si la base no tiene `from`.

- [ ] **Step 1: tests en rojo**, con `twoRoots`, `crateBytes`, `onlyBackupOf`, `tempsUnder` de `seratoLibraryFixture.ts` (nombres heredados de aa4c70aa3):

```ts
it('points the Serato track and every crate holding it at the new file, after copying what it rewrites', …)
it('writes nothing for a file Serato does not hold', …)                         // no-match, sin copia
it('waits while Serato is open, since Serato writes its own library over ours when it quits', …)
it('refuses to rewrite a database it could not read to the end', …)            // 'unreadable'
it('reads the home library from the disk root, where Serato stores paths without the leading slash', …)
it('repoints a track on an external drive in that drive\'s own library', …)
it('leaves a track whose new file is on another drive, since one library cannot point across volumes', …) // Review Focus 3
it('leaves no temp behind after writing', …)
```

- [ ] **Step 2:** ejecutar. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3:** implementar: un borrador por llamada; por reapuntado, raíz de `from` y de `to`; `draft.write` de la base y de cada crate de `Subcrates` que cambie; una sola `commitSeratoDraft`.
- [ ] **Step 4:** verde.
- [ ] **Step 5:** commit `Point Serato's library and crates at the file that replaced a track`.

### Task 6: la cola de Serato reapunta las sustituciones

**Files:**
- Modify: `apps/desktop/src/main/libraryFlushes.ts:552-570` (`queueSeratoRun`)
- Modify: `apps/desktop/src/main/index.ts:619-645` (`repoint` de la cola `serato`)
- Test: `apps/desktop/src/main/libraryFlushes.test.ts` (junto a `flushConversionBatch with a converted track Serato does not have`), `apps/desktop/src/main/seratoRepoint.test.ts` (cableado)

**Interfaces:**
- Consumes: `RekordboxRepoint.replaced`, `.seratoCarryFailed` (tarea 2); `repointSerato` (tarea 5).
- Produces: `queueSeratoRun` llama `queue.enqueue(ops, moves)` con `moves = run.repoints.filter(r => r.replaced && !r.seratoCarryFailed && r.from !== r.to && held(r.from))`, `held = syncSerato ? (p) => seratoLibraryHas(roots)(p) : () => false` (solo la ruta, sin `from`). Sale sin encolar si `ops.length + moves.length === 0`. En `index.ts`: `repoint: (_library, list) => repointSerato(list, { roots: seratoRoots, backupDir: join(app.getPath('userData'), 'serato-backups'), seratoOpen: DJ_PROCESSES.serato.isRunning })`.

- [ ] **Step 1: tests en rojo.**

```ts
// Decided 22/11 (option A): Serato follows a replacement even though it costs the stars,
// because the old file is retired and Serato would otherwise lose the track and its cues.
it('queues a Serato repoint for a replaced file Serato holds', …)   // enqueue([], [{ from: '/m/a.mp3', to: '/m/a.flac', replaced: true }])
it('does not repoint Serato for a plain conversion, which keeps its original instead', …)
it('does not repoint Serato when the cues could not be carried into the new file', …)  // Review Focus 5
it('does not repoint Serato with its sync off', …)
// seratoRepoint.test.ts, como los tests de cableado de activeConversions.test.ts
it('hands the Serato queue its repoint', () =>
  expect(readFileSync(join(__dirname, 'index.ts'), 'utf-8')).toMatch(/repoint: \(_library, list\) =>\s+repointSerato\(list,/))
```

- [ ] **Step 2:** ejecutar. Esperado: FAIL.
- [ ] **Step 3:** implementar. Las operaciones de pista de esa sustitución ya no piden añadir (`seratoLibraryHas(...)(to, from)` ve `from`) y la cola aplica los reapuntados antes que las operaciones, así que las crates elegidas para la pista dejan de dar `source-in-serato`.
- [ ] **Step 4:** verde, y `libraryFlushes.test.ts` entero.
- [ ] **Step 5:** commit `Queue Serato's repoint when a replacement lands`.

### Task 7: el original se retira cuando Serato ya sigue al nuevo

**Files:**
- Modify: `apps/desktop/src/main/seratoRepoint.ts`
- Modify: `apps/desktop/src/main/index.ts:505-513` (`holdsInAnyLibrary`)
- Test: `apps/desktop/src/main/seratoRepoint.test.ts`

**Interfaces:**
- Consumes: `RekordboxQueue['holdsRepoint' | 'apply']`; `programQueues.serato.announceApplied`.
- Produces: `settleSeratoRepoint(path: string, deps: { queue: Pick<RekordboxQueue, 'holdsRepoint' | 'apply'>; isRunning: () => Promise<boolean>; onApplied: (result: QueueApply) => void }): Promise<void>`. Si la cola tiene un reapuntado desde `path`, lo aplica ya (`queue.apply`, que se encadena tras cualquier aplicación en curso) con `ensureClosed = !isRunning()`; si Serato está abierto, la aplicación se rechaza y el reapuntado sigue en la cola.

Por qué: hoy la retirada (`useRetireSuperseded` → `shell:retireSuperseded` → `usedByAnyLibrary`) se pregunta UNA vez. La cola de Serato aplica con `applyQuietly(later)`, sin comprobación propia en `verifyRegistry` (Serato no es `WritableProgram`), así que podía preguntar antes de que `database V2` cambiara y conservar el viejo para siempre (`supersededKept`). Con Serato abierto se conserva, como rekordbox o VirtualDJ con su cola esperando. La guarda de e4e40a2ca (`librariesKeepingOriginal`, para `job.inputPath`) no cambia: cubre conversiones normales, que no reapuntan Serato.

- [ ] **Step 1: tests en rojo.**

```ts
it('applies a pending Serato repoint for the file before its use is read, so a closed Serato lets the original go', …)
it('leaves the repoint queued while Serato is open, so the original stays', …)  // Review Focus 2
it('does nothing for a file with no repoint waiting', …)                         // apply no llamado
it('settles Serato before asking any library about a file to retire', () =>
  expect(source).toMatch(/holdsInAnyLibrary = async[\s\S]*?settleSeratoRepoint\(path,[\s\S]*?usedByAnyLibrary\(path, titles, \{\s+traktorRead: traktorReadPath,\s+rootLibraries,/))
```

- [ ] **Step 2:** ejecutar. Esperado: FAIL.
- [ ] **Step 3:** implementar y cablear en `holdsInAnyLibrary` (mantener intacto el patrón que fija `activeConversions.test.ts`).
- [ ] **Step 4:** verde, más `activeConversions.test.ts`, `usedByAnyLibrary.test.ts`, `retireSuperseded.test.ts`.
- [ ] **Step 5:** commit `Let a replaced original go once Serato points at its replacement`.

### Task 8: pedir que se cierre Serato antes de sustituir una pista suya

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts:584-588` (`askToCloseReached`)
- Test: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Produces: `askToCloseReached` pregunta por `[inputPath, replacesPath?]` de cada pista.

Por qué: Serato 5 escribe los cues en el fichero solo al cerrarse (medido 03/11). Con Serato abierto, la tarea 2 copiaría los cues de antes de la sesión. Hoy solo se pregunta por la descarga, que Serato no tiene.

- [ ] **Step 1: test en rojo**, junto al de la línea 190:

```ts
it('asks the programs that hold the replaced file too, so Serato saves its cues into it before they are copied', …)
// expect(conversionPrograms).toHaveBeenCalledWith(['/dl/new.flac', '/m/old.mp3'])
```

- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** verde.
- [ ] **Step 5:** commit `Ask the programs holding a replaced file to close before replacing it`.

### Task 9: aviso de que Serato perderá las estrellas

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useSeratoLosesStars.ts`
- Modify: `apps/desktop/src/renderer/src/components/ConvertFooter.tsx:742-752` (prop `seratoLosesStars`, nota)
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx:754-757, 2208-2213` (calcula y pasa la prop)
- Modify: los 8 `apps/desktop/src/renderer/src/i18n/locales/*.json` (`editor.seratoLosesStars`)
- Test: `apps/desktop/src/renderer/src/hooks/useSeratoLosesStars.test.tsx`, `apps/desktop/src/renderer/src/components/ConvertFooter.test.tsx`

**Interfaces:**
- Produces:
  - `useSeratoLosesStars(replacedPath: string): boolean`: `true` si `syncSerato` está activo, la ruta no está vacía y la colección de Serato (`sourceCollectionOptions('serato')`) tiene esa ruta (`pathKey`). Sin `syncSerato` no se reapunta (tarea 6), luego no hay pérdida.
  - `ConvertFooter` prop `seratoLosesStars?: boolean`; la nota `<p data-testid="convert-serato-stars-note">` sale solo con `!isMulti && replaces && seratoLosesStars`, con el mismo estilo que `convert-lossy-note`.

**Forma elegida:** una nota de una línea encima del botón «Sustituir», como las notas `convert-damaged-note` y `convert-lossy-note` que ya avisan antes de convertir. Se ve antes de pulsar, sin añadir un paso. Descartado un diálogo de confirmación: cada sustitución de una pista de Serato pediría un clic más. Descartado solo icono: un aviso de pérdida irreversible tiene que leerse. Si Vicent prefiere confirmar, cambia solo esta tarea.

Textos (`editor.seratoLosesStars`):

| locale | texto |
|---|---|
| en | Serato will lose this track's stars. |
| es | Serato perderá las estrellas de esta pista. |
| de | Serato verliert die Sterne dieses Tracks. |
| pt-BR | O Serato vai perder as estrelas desta faixa. |
| fr | Serato perdra les étoiles de ce morceau. |
| it | Serato perderà le stelle di questo brano. |
| ca | Serato perdrà les estrelles d'aquesta pista. |
| ja | Serato でこのトラックの星の評価が失われます。 |

- [ ] **Step 1: tests en rojo.** Hook, con el patrón de `useProgramCopies.test.tsx` (`installApi`, `djReads`, `SettingsProvider`):

```ts
// Serato re-imports a repointed track as a new one, and the rating lives only in
// master.sqlite, which Surco cannot write (measured 04/11).
it('warns when Serato holds the replaced file and follows replacements', …)
it('stays quiet with Serato sync off, since Serato is then left on the old file', …)
it('stays quiet when Serato does not hold the replaced file', …)
it('stays quiet with no replaced file', …)
```

`ConvertFooter.test.tsx`:

```ts
it('says Serato will lose the stars before a replacement of a Serato track', …)  // toHaveTextContent(i18n.t('editor.seratoLosesStars'))
it('says nothing when the button adds instead of replacing', …)                 // replaces: false
```

- [ ] **Step 2:** FAIL (hook inexistente, nota ausente, clave ausente en `keys.test.ts` cuando se añada a uno solo).
- [ ] **Step 3:** implementar hook, prop, nota, cableado en `Editor` (`useSeratoLosesStars(replacedCopyPath)`) y las 8 traducciones.
- [ ] **Step 4:** verde, más `src/renderer/src/i18n` entero y `Editor.test.tsx`.
- [ ] **Step 5:** medir la nota al ancho real del editor (estrecho y normal) en en, es, de, pt-BR y fr: una línea o dos sin cortar palabras ni mover el botón de sitio; captura con la app lanzada por `quietLaunch`.
- [ ] **Step 6:** commit `Warn before replacing a Serato track that Serato will lose its stars`.

### Task 10: verificación final y prueba en una biblioteca de Serato de pruebas

**Files:** ninguno nuevo.

- [ ] **Step 1:** suite entera: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run; echo "exit $?"`. Esperado: `exit 0` y nada en `grep -E "Unhandled|Errors "`.
- [ ] **Step 2:** `npx tsc --build` (apps/desktop), `npm run lint -w apps/desktop`, `npm run lint -w apps/web`. Esperado: sin errores ni avisos.
- [ ] **Step 3: preparar.** Avisar a Vicent antes: la sustitución pasa por Apple Music (`replaceAppleMusicCopy`) y Serato importa la biblioteca de Music al abrirse. Con Serato cerrado, copia de `~/Music/_Serato_`, de `~/Library/Application Support/Serato/Library` y de `~/Music/Serato Pruebas` al scratchpad.
- [ ] **Step 4: Serato cerrado.** En `~/Music/Serato Pruebas`, una pista MP3 con cues, en un crate y con estrellas. Sustituirla en Surco por un AIFF sintético del mismo audio. Antes, corregir a mano en Serato la rejilla de esa pista. Comprobar: la nota de las estrellas salió antes de pulsar; el AIFF lleva `Markers2` con los mismos cues y `Serato Tempo Map` con el primer golpe corregido; `database V2` y el `.crate` apuntan al AIFF (copia en `serato-backups`); el MP3 viejo se retiró. Abrir Serato: la pista sale con sus cues en el crate, en su posición, con BPM, tonalidad y la rejilla corregida (que Serato respete un Tempo Map escrito desde fuera nunca se ha medido; anotar el resultado en la memoria); las estrellas se han perdido (esperado).
- [ ] **Step 5: Serato abierto.** Repetir con Serato abierto: Surco pide cerrarlo; si se dice que no, el MP3 viejo se queda, la cola de Serato muestra el reapuntado esperando y se aplica al cerrar Serato.
- [ ] **Step 6: conversión normal.** Convertir de FLAC a MP3 otra pista con la rejilla corregida a mano y comprobar en Serato que el primer golpe sigue en su sitio.
- [ ] **Step 7:** restaurar las copias del paso 3 y anotar el resultado en la memoria del hilo.

## Riesgos y decisiones abiertas

- **Rejilla sin medir en Serato:** nunca se ha medido si Serato respeta, al reimportar, un `Serato Tempo Map` escrito desde fuera. La tarea 10 lo comprueba a mano. Solo se retemporizan las formas de rejilla que el lector reconoce; cualquier otra no se copia y Serato la recalcula, como hoy.
- **Sin comprobación posterior en Serato:** `verifyRegistry` solo conoce los `WritableProgram`; el reapuntado de Serato no se relee tras escribirlo.
- **Aviso sin leer las estrellas:** Surco no lee `master.sqlite`, así que avisa aunque la pista no tenga estrellas, y también en el caso raro en que el fichero nuevo acaba en la misma ruta que el viejo (entonces no se reapunta ni se pierde nada).
- **Serato abierto y Vicent no lo cierra:** los cues copiados son los del disco; los que ponga en esa sesión se guardan al cerrar en el fichero viejo, ya sustituido.
