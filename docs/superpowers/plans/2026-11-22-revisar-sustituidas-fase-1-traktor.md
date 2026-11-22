# Revisar sustituidas, fase 1: Traktor sigue la sustitución. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al sustituir una pista («Actualizar», `job.replacesPath`), la ENTRY de Traktor del fichero viejo pasa entera al fichero nuevo (VOLUME, DIR y FILE de `<LOCATION>`) y se lleva sus CUE_V2, playlists y estrellas, con las mismas guardas que hoy.

**Architecture:** La conversión graba el parche del NML dirigido a la ruta vieja (`toNmlLocation(replacesPath)`) con una marca nueva, `relocates: true`, que le dice a `applyPatches` que reescriba la `<LOCATION>` entera hacia los campos `outputVolume/outputDir/outputFile` que el parche ya lleva. Esos campos ya se rellenan con el volumen de arranque en `syncCollection` y ya siguen al fichero cuando Music lo copia a su carpeta (`redirectNmlPatch`), así que la sustitución reutiliza esa tubería. El parche de una sustitución no lleva árbol de cues del fichero nuevo, y su desplazamiento llega por un parámetro propio (0 en esta fase) que la fase 3 llenará con la medida. La comprobación posterior (`verifyTraktor`) aprende a buscar la entrada en su sitio nuevo, y así la retirada del fichero viejo (`autoRetiredFile`) solo ocurre cuando Traktor ya lo sigue.

**Tech Stack:** Electron (main), TypeScript, Vitest, ffmpeg-static en los tests de conversión, escenarios jsdom de `apps/desktop/src/scenarios`.

**Spec:** `docs/superpowers/specs/2026-11-22-revisar-sustituidas-design.md`, sección «1. Traktor sigue la sustitución» y «Restricciones».

## Global Constraints

- Todo el código en `apps/desktop/src`, en el worktree `/Users/vicent/code/surco-revisar-sustituidas` (rama `revisar-sustituidas`). Rutas de este plan relativas a `apps/desktop/src` salvo que digan otra cosa.
- TDD con fase roja: cada test se ve fallar por la razón esperada antes de escribir el código. Un test que pasa a la primera no vale: romper la implementación a propósito y verlo fallar.
- Los tests dicen POR QUÉ importa el comportamiento (comentario encima del `describe`/`it` con la consecuencia para el DJ, como hacen `convertNmlCueShift.test.ts` y `traktorCollection.test.tsx`).
- Selectores en escenarios: `data-testid`, nunca clases CSS.
- Estilo del código existente: este módulo explica el porqué con comentarios en inglés encima de cada decisión; seguir esa norma en lo que se añada (conformidad con el código, por encima de la norma general de cero comentarios).
- Una funcionalidad por commit. Título descriptivo en inglés, sin cuerpo y sin prefijos `feat:`/`fix:`. Nunca `--no-verify`.
- Fixtures sintéticos (NML escrito en el test, audio con `lavfi`/`makeTrack`). Nunca la colección de un DJ.
- Una conversión normal (sin `replacesPath`) conserva su comportamiento exacto de hoy: solo FILE, y solo si la salida queda en la misma carpeta.
- No subir ningún namespace de caché ni forzar reanálisis.
- Si un test existente tiene que cambiar una aserción, avisar a Vicent de qué deja de hacer la app ANTES del commit.
- Comandos, siempre desde `/Users/vicent/code/surco-revisar-sustituidas/apps/desktop` (el worktree no tiene `node_modules`; se usan los binarios de la copia principal):
  - Test: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta> 2>&1 | tee /tmp/claude-501/v.log; echo exit=$?` y después `grep -E "Unhandled|Errors " /tmp/claude-501/v.log` (debe salir vacío). El código de salida cuenta aunque todos los tests pasen.
  - Tipos: `/Users/vicent/code/surco/node_modules/.bin/tsc --build` (cubre web, node y scenarios; `tsc` pelado no comprueba nada).
  - Lint: `/Users/vicent/code/surco/node_modules/.bin/biome lint src` (equivale a `npm run lint -w apps/desktop`; entero, nunca por fichero).

## Review Focus

1. **El fichero nuevo está en otro volumen que el viejo** (viejo en un NAS, descarga convertida al disco interno o a la carpeta de Music). Traktor guarda `VOLUMEID` además de `VOLUME`; cambiar solo el nombre deja la pista perdida. Esperado: toma el `VOLUMEID` de otra entrada de ese volumen; si ninguna lo nombra, no reapunta y la comprobación dice «sigue en el viejo», con lo que el viejo no se retira. Tests en la Tarea 2.
2. **Traktor abierto al terminar la sustitución, y el DJ toca la pista mientras espera.** El parche espera en la cola; al escribirse, `spareEditedEntries` lo reduce a «solo mover». Esperado: el movimiento entero sobrevive a esa reducción (si se perdiera `relocates`, la entrada se quedaría en el viejo). Test en la Tarea 2.
3. **La salida ya tiene su propia ENTRY en la colección** (el DJ arrastró la descarga a Traktor antes de sustituir). Esperado: no se crea un duplicado; la entrada vieja se queda donde estaba y la comprobación la marca «sigue en el viejo», así que el viejo no se retira y nadie pierde cues. Tests en las Tareas 2 y 5.
4. **«Solo Apple Music»: la salida aterriza en la carpeta Media de Music, no donde escribió la conversión.** Esperado: la entrada vieja va a la ruta donde Music dejó el fichero, no al temporal. Tests en la Tarea 4 y en el escenario de la Tarea 7.
5. **La descarga trae su propia etiqueta TRAKTOR4, o hay desfase de códec o el ajuste de Traktor del usuario (`traktorCueOffsetMs`).** Esas correcciones describen descarga → salida, no fichero viejo → nuevo. Esperado: los CUE_V2 de la entrada quedan byte a byte como estaban (en esta fase no se mueve nada). Test en la Tarea 3.

---

### Task 1: `volumeOf` pasa a `traktorNml.ts` (refactor sin cambio de comportamiento)

La Tarea 2 necesita el `VOLUMEID` de un volumen leyendo la colección, que es lo que ya hace `volumeOf` en `traktorPlaylistEdit.ts`. Importarlo desde `traktorNml.ts` crearía un ciclo (`traktorPlaylistEdit` ya importa de `traktorNml`), así que se mueve.

**Files:**
- Modify: `main/traktorPlaylistEdit.ts:299-320` (quitar `volumeOf`, importarlo)
- Modify: `main/traktorNml.ts` (añadir `export function volumeOf`, idéntica)
- Test: `main/traktorPlaylistEdit.test.ts` (existente, sin cambios)

**Interfaces:**
- Produces: `export function volumeOf(nml: string, volume: string | null, bootVolume: string): { volume: string; id: string } | null` en `main/traktorNml.ts`. Mismo cuerpo y comentario que hoy.

- [ ] **Step 1: Mover la función** sin tocar su cuerpo; `traktorPlaylistEdit.ts` la importa de `./traktorNml`.
- [ ] **Step 2: Verificar** `node …/vitest.mjs run src/main/traktorPlaylistEdit.test.ts src/main/traktorNml.test.ts` → exit 0; `tsc --build` y `biome lint src` limpios.
- [ ] **Step 3: Commit** `Move volumeOf next to the NML parser so patches can read volume ids`

---

### Task 2: `applyPatches` mueve la entrada entera cuando el parche es una sustitución

**Files:**
- Modify: `main/traktorNml.ts` (`NmlPatch` ~línea 80, `patchFor` ~566, `patchEntry` ~516, `pathTaken` ~556, `coexistingOutputs` ~297, `matchedPatchCount` ~730, `spareEditedEntries` ~705)
- Test: `main/traktorNml.test.ts` (nuevo `describe('a replace moves the entry whole', …)`)

**Interfaces:**
- Consumes: `volumeOf` (Tarea 1).
- Produces:
  - `NmlPatch.relocates?: true`. Comentario: una sustitución; la entrada que casa con `volume/dir/file` (la del fichero sustituido) pasa entera a `outputVolume/outputDir/outputFile`. Sin ella, el comportamiento de hoy (solo `newFile`).
  - Con `relocates`, `cueShift` (campo existente `{ shiftMs: number; maxMs?: number }`) mueve los CUE_V2 de la entrada vía `shiftEntryCues`, como hoy. Es la vía que usará la fase 3.

Reglas que fija esta tarea (el implementador escribe los cuerpos):
- Reescritura: VOLUME, DIR y FILE de la etiqueta `<LOCATION>` (con `escapeAttr`, reemplazo por función, como `replaceLocation`). Si el volumen nuevo difiere del de la entrada (comparar con `sameText`), también `VOLUMEID`, tomado de `volumeOf(nml, outputVolume, '')`. Sin `VOLUMEID` conocido para ese volumen → no reapunta (la entrada se queda, el resto del parche se aplica como hoy a una entrada no reapuntada).
- `pathTaken` vale también para `relocates`: si otra entrada ya está en la ubicación de salida, no se reapunta.
- `patchFor`: una sustitución que sí reapunta cuenta como `repoints` (conserva `cueShift`); `tags` siguen exigiendo coincidencia exacta como hoy.
- `coexistingOutputs` ignora los parches con `relocates` (una sustitución no es una conversión que conviva con su fuente; no se despoja el AUDIO_ID/COVERARTID de nadie).
- `applyPatches` ya empuja a `moves` cuando cambia FILE; con `relocates` debe empujar cuando cambia cualquiera de VOLUME, DIR o FILE, con la clave nueva `keyOf({ volume, dir, file })` de destino, para que `rewritePlaylists` reescriba las playlists.
- `matchedPatchCount` usa el mismo `patchFor`, así que cuenta un reapuntado como parche aplicado.
- `spareEditedEntries` conserva `relocates` en el parche reducido.

- [ ] **Step 1: Tests que fallan** en `traktorNml.test.ts`. NML de prueba: una ENTRY en `VOLUME="Macintosh HD" VOLUMEID="Macintosh HD" DIR="/:Music/:Old/:" FILE="Song.mp3"` con dos CUE_V2 (uno hotcue `START="10000.000000"`, uno `TYPE="4"` con `<GRID BPM="128.000000">`) y una playlist cuyo `PRIMARYKEY KEY="Macintosh HD/:Music/:Old/:Song.mp3"`; otra ENTRY en `VOLUME="NAS" VOLUMEID="nas-1234"`. Parche base: `{ volume: 'Macintosh HD', dir: '/:Music/:Old/:', file: 'Song.mp3', relocates: true, outputVolume, outputDir, outputFile }`.
  - `moves VOLUME, DIR and FILE of the replaced entry to the new file` → la LOCATION de la entrada tiene `DIR="/:Music/:New/:" FILE="Song.aiff"`; `findEntries(out)` sigue con una sola entrada en esa ruta.
  - `keeps every CUE_V2 of the entry byte for byte` → `entryCues(bloque después) === entryCues(bloque antes)`.
  - `rewrites the playlist key so the track stays in its playlists` → la playlist contiene `KEY="Macintosh HD/:Music/:New/:Song.aiff"` y ya no la vieja.
  - `takes the VOLUMEID of another entry on the new volume` → con `outputVolume: 'NAS'`, la LOCATION tiene `VOLUME="NAS"` y `VOLUMEID="nas-1234"`.
  - `leaves the entry where it was when no entry names the new volume` → con `outputVolume: 'USB'`, la LOCATION sale idéntica.
  - `does not move onto a location another entry already holds` → con una tercera ENTRY ya en `/:Music/:New/:Song.aiff`, ambas LOCATION quedan como estaban y `findEntries` da las mismas tres; además la tercera conserva su `AUDIO_ID`.
  - `moves the entry cues by the shift a replace carries` → con `cueShift: { shiftMs: 120 }`, el hotcue queda en `START="9880.000000"` (la vía de la fase 3).
  - `counts a moved entry as a patch that changed the collection` → `matchedPatchCount(nml, [patch]) === 1`.
  - `an entry edited while the replace waited still moves to the new file` → `entryStates` del NML original, luego el DJ cambia un hotcue; `applyPatches(edited, spareEditedEntries(edited, [patch con cueShift], states, 'Macintosh HD'))` mueve la LOCATION y deja el hotcue editado sin desplazar.
  - `an ordinary conversion into another folder still leaves LOCATION alone` → el mismo parche sin `relocates` y sin `newFile`: LOCATION idéntica (guarda de regresión del comportamiento de hoy).
- [ ] **Step 2: Ejecutarlos y verlos fallar** (los de `relocates` fallan porque LOCATION no cambia; el de regresión pasa ya: comprobarlo mutando a propósito, p. ej. tratando todo parche como `relocates`, y verlo fallar).
- [ ] **Step 3: Implementar** las reglas de arriba en `main/traktorNml.ts`. Una función nueva privada `relocateEntry(block: string, to: { volume: string; volumeId?: string; dir: string; file: string }): string` junto a `replaceLocation`.
- [ ] **Step 4: Verlos pasar** y pasar también `traktorNml*.test.ts`, `traktorNmlLibrary.test.ts`, `traktorPatchQueue.test.ts` y `verifyTraktor.test.ts` (exit 0, sin `Unhandled`). `tsc --build`, `biome lint src`.
- [ ] **Step 5: Commit** `Move a replaced track's Traktor entry whole onto the new file`

---

### Task 3: La conversión graba el parche de una sustitución contra la ruta vieja

**Files:**
- Modify: `main/ffmpeg.ts:2022` (`recordConversionPatch`) y `main/ffmpeg.ts:2753` (su llamada en `convertAudio`); actualizar el comentario de bloque de ~1989-2009 para la sustitución.
- Test: `main/convertNmlReplace.test.ts` (nuevo, mismo montaje que `main/convertNmlCueShift.test.ts`: `vi.mock('electron')`, `vi.mock('./settings')` con `syncTraktor: true`, `traktorNmlPath: '/nowhere/collection.nml'`, `traktorCueOffsetMs: -51`; `id3WithCue` y `buildTraktorTree` de `traktor4Fixture`).

**Interfaces:**
- Consumes: `NmlPatch.relocates` (Tarea 2).
- Produces (la fase 3 lo usa):
  - `function recordConversionPatch(input: string, output: string, meta: TrackMetadata, keptArtwork: boolean, clearedExtras: boolean, cueShift: CueShift | undefined, namesBefore: TrackMetadata | undefined, replaces?: { path: string; cueShift: CueShift }): void`
  - En `convertAudio`, justo antes de `renameWithRetry`, `const replacedCueShift: CueShift = { shiftMs: 0 }` y la llamada pasa `replacesPath ? { path: replacesPath, cueShift: replacedCueShift } : undefined`. La fase 3 sustituye esa constante por su valor medido con `traktorReplaceShift(shift, codecMs, userOffsetMs)` (`main/replaceCueShift.ts`, medida contra el temporal, antes del renombrado). Esta fase no crea ese módulo.
  - Un desplazamiento medido de exactamente 0 ms sigue sin grabar `cueShift` en el parche (regla de abajo), también cuando lo calcule `traktorReplaceShift`.

Reglas con `replaces`:
- `volume/dir/file` = `toNmlLocation(replaces.path)`; `relocates: true`; `newFile` ausente.
- `cueTree` ausente: el árbol del fichero de salida viene de la descarga, y los cues que valen son los de la entrada de Traktor.
- `cueShift` = `replaces.cueShift` solo si mueve algo (`shiftMs !== 0` o `maxMs !== undefined`); con `{ shiftMs: 0 }` queda ausente, para que los CUE_V2 viajen byte a byte (con un desplazamiento 0, `shiftCueStart` aún puede tirar un marcador de rejilla sin BPM). El `cueShift` del parámetro (descarga → salida) no se usa en una sustitución.
- `bpm`, `ranking`, `tags`, `refreshCoverArt`, `outputPath` y los `output*` como hoy; `origins` sigue siendo `{ input, output }` (así `recordedNmlPatch(entry.source)` de `verifyRun.ts` lo encuentra sin cambios).

- [ ] **Step 1: Tests que fallan** en `convertNmlReplace.test.ts`. Fixtures: `old.mp3` en una carpeta `library/`, `download.mp3` (con `id3WithCue` de un cue a 5000 ms) en `downloads/`, salida `library/Song.aiff`. Llamada: `convertAudio(download, out, 'aiff', meta, …undefined…, oldPath)` (16.º argumento, `replacesPath`).
  - `addresses the patch to the replaced file, which is the one Traktor has` → `patches[0]` tiene `volume/dir/file` de `toNmlLocation(oldPath)`, `relocates: true`, `outputFile: 'Song.aiff'`, `newFile` undefined.
  - `leaves the cues to the entry, not to the download or its codec offset` → `cueTree` y `cueShift` undefined pese a la etiqueta TRAKTOR4 de la descarga y a `traktorCueOffsetMs: -51`; y `applyPatches` sobre un NML con la entrada de `old.mp3` y un hotcue a 10000 ms deja `START="10000.000000"` y la LOCATION en `Song.aiff`.
  - `an ordinary conversion still records no move` → `convertAudio(download, out, …)` sin `replacesPath`: `relocates` undefined y `volume/dir/file` de la descarga (como hoy).
- [ ] **Step 2: Ejecutarlo y verlo fallar** (hoy el parche apunta a `download.mp3`).
- [ ] **Step 3: Implementar** el parámetro y la constante en `main/ffmpeg.ts`.
- [ ] **Step 4: Verlo pasar**, más `convertNmlCueShift.test.ts`, `convertCues.test.ts` y `nmlBatch.test.ts`. `tsc --build`, `biome lint src`.
- [ ] **Step 5: Commit** `Record a replace's Traktor patch against the file it replaces`

---

### Task 4: La sustitución sigue al fichero hasta la carpeta de Music

`redirectNmlPatch` (`main/nmlBatch.ts:49`) ya mueve los campos `output*` al sitio donde Music dejó el fichero, pero después devuelve `false` si esa carpeta no es la de la fuente, lo que `processTrack` lee como «Traktor se queda en la fuente» (`traktorFollowed`). Con `relocates` la entrada sí sigue.

**Files:**
- Modify: `main/nmlBatch.ts:49-67` (y su comentario de ~40-46)
- Test: `main/nmlBatch.test.ts`

**Interfaces:**
- Consumes: `NmlPatch.relocates`.
- Produces: `redirectNmlPatch(currentTo, landedAt, landedLocation?)` devuelve `true` para un parche con `relocates` y deja `newFile` sin tocar; para el resto, igual que hoy.

- [ ] **Step 1: Test que falla** `a replace follows the file into Music's own folder` → se graba un parche `{ volume:'', dir:'/:Users/:me/:Music/:Old/:', file:'Song.mp3', relocates: true, outputDir/outputFile del temporal }` con `{ input: '/tmp/dl.mp3', output: '/tmp/x/Song.aiff' }`; `redirectNmlPatch('/tmp/x/Song.aiff', '/Users/me/Music/Media/A/B/Song.aiff', toNmlLocation(...))` → `true`; el parche que devuelve `endNmlBatch()` tiene `outputDir === '/:Users/:me/:Music/:Media/:A/:B/:'`, `relocates: true` y `newFile` undefined.
- [ ] **Step 2: Verlo fallar** (hoy devuelve `false`).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Verlo pasar** con `nmlBatch.test.ts` y `processTrack.test.ts` enteros.
- [ ] **Step 5: Commit** `Let a replaced track's Traktor entry follow the file into Music's folder`

---

### Task 5: La comprobación busca la entrada en su sitio nuevo

Hoy `judge` y `entryKey` (`main/verifyTraktor.ts`) suponen que la entrada se queda en `patch.dir` y solo cambia FILE. Tras esta fase una sustitución la mueve de carpeta (o de volumen). Si la comprobación no lo sabe, dice «falta en Traktor» y el viejo nunca se retira, o, peor, no lista Traktor y el viejo se retira con la entrada aún en él. `autoRetiredFile.ts` (renderer) no cambia: ya espera mientras Traktor está `pending` (parche en cola) y conserva el viejo con cualquier `mismatch`.

**Files:**
- Modify: `main/verifyTraktor.ts` (`judge` ~150, `entryKey` ~132)
- Test: `main/verifyTraktor.test.ts` (nuevo `describe('a replace', …)` con NML sintético y `checkTraktor(nml, [{ patch, before: 'Song.mp3', cues }], 'Macintosh HD')`)

**Interfaces:**
- Consumes: `NmlPatch.relocates`, `outputVolume/outputDir/outputFile`.
- Produces: `checkTraktor` sin cambio de firma. Con `relocates`: clave vieja = `locationKey(volume, dir, before)`, clave nueva = `locationKey(outputVolume || bootVolume, outputDir, outputFile)`; `entryKey` devuelve la nueva.

Reglas:
- Vieja presente (cualquier mayúscula) y distinta de la nueva → `traktorStillOld`.
- Más de una entrada en la nueva → `traktorAmbiguous`.
- Una entrada en la nueva: si el parche no lleva `cueShift` y `e.cues` existe, exigir `cuesHeld(e.cues, cues de la nueva)` → si no, `traktorCuesChanged`; si no, `traktorOk` con el formato de `outputFile`. Con `cueShift` (fase 3) no se compara la posición aquí.
- Ninguna en la nueva y la vieja tampoco → `traktorMissing`.

- [ ] **Step 1: Tests que fallan:**
  - `an entry moved whole to the new file is traktorOk` → `state: 'ok'`, `detail.key: 'traktorOk'`, formato AIFF.
  - `an entry still on the replaced file is traktorStillOld, so the old file is kept` → `traktorStillOld`.
  - `an entry moved without a cue it had is traktorCuesChanged` → `e.cues` con dos CUE_V2, la nueva con uno.
  - `a replace that landed on the old file's own path is judged by its one entry` → salida = ruta vieja, una entrada → `traktorOk`.
  - `reads the names from the entry at the new location` → `patch.tags.title { from: 'Old', to: 'New' }` y la entrada nueva aún dice `TITLE="Old"` → `traktorNameStale`.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar** una rama de `judge` para `relocates`, antes de la de `!patch.newFile`.
- [ ] **Step 4: Verlos pasar** con `verifyTraktor.test.ts`, `verifyRegistry.test.ts`, `verifyRun.test.ts` y `src/renderer/src/lib/autoRetiredFile.test.ts`.
- [ ] **Step 5: Commit** `Check a replaced track's Traktor entry at its new location`

---

### Task 6: Con «Add to Traktor» y sin «Sync Traktor», la sustitución también mueve la entrada

Hueco previo encontrado al planear: con `addToTraktor` activo y `syncTraktor` apagado no se graba parche (`recordConversionPatch` sale por `syncTraktor`), `traktorCollectionHas` solo mira la ruta nueva (`followsFrom = syncTraktor`) y la cola añade una ENTRY nueva; cuando Surco retira el fichero viejo, la entrada vieja sale perdida con sus cues y playlists. Una sustitución pedida por el DJ con «Add to Traktor» activo es permiso para mover su propia entrada. Fuera de una sustitución, con «Sync Traktor» apagado todo sigue igual (ni estrellas, ni nombres, ni carátulas, ni conversiones normales).

**Files:**
- Modify: `main/ffmpeg.ts:2034` (puerta de `recordConversionPatch`)
- Modify: `main/libraryFlushes.ts:364-366` (`traktorFlushDeps.traktorNmlPath`), `main/libraryFlushes.ts:813-830` (`pathsHeld`, `traktorCollectionHas`)
- Modify: `main/rekordboxBatch.ts` (`RekordboxRepoint` gana `replaced?: true`), `main/rekordboxRepointFor.ts:38` (lo pone cuando hay `options.replaces`)
- Modify: `main/rekordboxQueueFromRun.ts:82-105` (`libraryTrackOps` pasa `r.replaced` a `known`)
- Test: `main/convertNmlReplace.test.ts` (segundo `describe` con su propio `vi.mock('./settings')` en un fichero aparte si el mock no se puede variar: `main/convertNmlReplaceAddOnly.test.ts`), `main/libraryFlushes.test.ts`, `main/rekordboxQueueFromRun.test.ts`, `main/convertRekordboxRepoint.test.ts`

**Interfaces:**
- Consumes: `replaces` de `recordConversionPatch` (Tarea 3), `NmlPatch.relocates` (Tarea 2).
- Produces:
  - `RekordboxRepoint.replaced?: true`, puesto por `rekordboxRepointFor` cuando recibe `replaces`.
  - `type LibraryHas = (path: string, from?: string, replaced?: boolean) => boolean`. `traktorCollectionHas` mira `from` cuando `followsFrom || replaced`; `engineLibraryHas` ignora el tercer argumento (sin cambio).
  - `libraryTrackOps` llama `known?.(r.to, r.from, r.replaced)`.

Reglas:
- `recordConversionPatch`: sigue exigiendo `traktorNmlPath`. Con `syncTraktor` graba como hoy. Sin `syncTraktor` pero con `replaces` y `addToTraktor`, graba SOLO el movimiento: `{ volume, dir, file, relocates: true, outputVolume, outputDir, outputFile }` (sin `outputPath`) más `cueShift` según la regla de la Tarea 3 (los cues de la entrada se mueven con su pista, fase 3). Sin `ranking`, `tags`, `refreshCoverArt`, `outputPath`, `bpm` ni `cueTree`: eso es «sincronizar», y está apagado.
- `traktorFlushDeps.traktorNmlPath`: la ruta cuando `(syncTraktor || addToTraktor) && found`. Seguro porque sin `syncTraktor` el lote solo puede contener parches de movimiento. `collectionMissing` no cambia.
- La cola, la copia de seguridad, el «programa cerrado» y la comprobación de la Tarea 5 son los mismos.

- [ ] **Step 1: Tests que fallan:**
  - `convertNmlReplaceAddOnly.test.ts` con `syncTraktor: false, addToTraktor: true`: `with only Add to Traktor on, a replace records just the move` → un parche con `relocates: true`, ruta vieja y `output*`, y `ranking`, `tags`, `refreshCoverArt`, `cueTree` undefined; y `with only Add to Traktor on, an ordinary conversion records nothing` → `endNmlBatch()` vacío.
  - `convertRekordboxRepoint.test.ts` (donde ya se prueba `rekordboxRepointFor`): `marks a repoint that replaces a library file` → `replaced: true` con `replaces`, ausente sin él.
  - `rekordboxQueueFromRun.test.ts`: `does not add a replaced track whose old file the library holds` → `libraryTrackOps([{ from: old, to: new, replaced: true, meta }], 'traktor', id, true, known)` con un `known` que responde por `from` solo si recibe `replaced` → `[]`; y `still adds the new file of an ordinary conversion when only the source is held` → con `replaced` ausente, un op con `add: true`.
  - `libraryFlushes.test.ts`: `writes the collection for a replace when only Add to Traktor is on` → con `syncTraktor: false, addToTraktor: true` y la colección encontrada, `traktorFlushDeps(...).traktorNmlPath` es la ruta; con los dos apagados, `''`.
- [ ] **Step 2: Verlos fallar** por la razón esperada.
- [ ] **Step 3: Implementar** las reglas de arriba.
- [ ] **Step 4: Verlos pasar** con `libraryFlushes.test.ts`, `rekordboxQueueFromRun.test.ts`, `convertRekordboxRepoint.test.ts`, `convertNmlReplace*.test.ts`, `traktorSyncFlush.test.ts` y `processTrack.test.ts`. `tsc --build`, `biome lint src`.
- [ ] **Step 5: Añadir al escenario de la Tarea 7** un segundo `describe` igual con `syncTraktor: false, addToTraktor: true`: `with only Add to Traktor on, the old entry still moves to the new file` (exactamente una ENTRY, en la ruta nueva, con sus CUE_V2) y `keeps its stars as Traktor had them` (`RANKING="204"`, porque sin sincronizar Surco no escribe estrellas). Si la Tarea 7 aún no existe al ejecutar esta, se escribe allí.
- [ ] **Step 6: Commit** `Move a replaced track's Traktor entry when only Add to Traktor is on`

---

### Task 7: Escenario de punta a punta

**Files:**
- Create: `scenarios/traktorReplace.test.tsx`
- Consulta: `scenarios/replaceInLibrary.test.tsx` (sustitución con Music falso, `openSurco({ verify: true, destination: 'appleMusic' })`, `surco.convertInEditor`, `osTrash`) y `scenarios/traktorCollection.test.tsx` (NML sintético con `toNmlLocation` + `bootVolumeName`, mock de `../main/traktorProcess`).

**Interfaces:**
- Consumes: todo lo anterior. No produce nada.

Montaje: `describe.skipIf(process.platform !== 'darwin')('Swap a track kept in Traktor for a better copy', …)`. `Show Me Love.mp3` en `Music/` con entrada en Music falso (como en `replaceInLibrary`) y en un `collection.nml` sintético con dos CUE_V2 (`HOTCUE="1"` a 32000 ms y uno `TYPE="4"` con GRID), `RANKING="204"` y una playlist «Peak» que la contiene. Descarga `Robin S - Show Me Love.flac`. Ajustes: `outputFormat: 'aiff'`, `syncTraktor: true`, `addToTraktor: true`, `traktorNmlPath`. Esperar a que `osTrash` contenga `Show Me Love.mp3`.

- [ ] **Step 1: Escenario que falla** (comentario de cabecera: hoy la entrada se queda en el mp3 y, al retirarlo Surco, Traktor pierde la pista con sus cues):
  - `keeps the track in Traktor, now on the new AIFF in Music's folder` → exactamente una ENTRY y su `<LOCATION>` es `toNmlLocation` del AIFF que Music guardó (`music.entry(oldPid).location` o la ruta en `media`), con VOLUME del arranque.
  - `carries every cue Traktor kept, unmoved` → `entryCues` de la entrada = los dos CUE_V2 originales, texto idéntico.
  - `keeps its stars and its place in the playlist` → `RANKING="204"` y la playlist «Peak» con la clave nueva.
  - `retires the old file only once Traktor follows the new one` → `osTrash` contiene `Show Me Love.mp3`.
  - `keeps a copy of the collection as it was` → `backupOf(nml, 'backup')` contiene `FILE="Show Me Love.mp3"`.
  - `runs without a single error the user would see` → `surco.errors` vacío.
- [ ] **Step 2: Verlo fallar en `main` sin las Tareas 2 a 5** (stash o `git worktree` temporal) o, más simple, revertir a propósito la línea de `replaces` de la Tarea 3 y ver caer los tres primeros.
- [ ] **Step 3: Verlo pasar** con todo en su sitio, y pasar también `replaceInLibrary.test.tsx` y `traktorCollection.test.tsx`.
- [ ] **Step 4: Commit** `Scenario: a replaced track keeps its Traktor entry and cues`

---

### Task 8: Suite, lint, tipos y prueba con Traktor real

- [ ] **Step 1: Suite entera** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run 2>&1 | tee /tmp/claude-501/suite.log; echo exit=$?` → `exit=0`; `grep -E "Unhandled|Errors " /tmp/claude-501/suite.log` vacío. Un test que solo pasa suelto se arregla antes de seguir.
- [ ] **Step 2:** `/Users/vicent/code/surco/node_modules/.bin/biome lint src` sin avisos y `/Users/vicent/code/surco/node_modules/.bin/tsc --build` sin errores.
- [ ] **Step 3: Prueba a mano con una COPIA de la colección de Traktor** (Traktor está libre para pruebas en esta máquina; nunca la colección de un DJ):
  1. Cerrar Traktor. `cp "$HOME/Documents/Native Instruments/Traktor 4.5.1/collection.nml"` a `$TMPDIR/traktor-backup-<fecha>.nml`.
  2. Generar dos ficheros sintéticos con ffmpeg (`old.mp3` con 2 s de silencio delante, `new.flac` del mismo tono), importar `old.mp3` en Traktor, poner dos hotcues y meterla en una playlist. Cerrar Traktor.
  3. Arrancar Surco del worktree SIEMPRE con `quietLaunch` (`apps/desktop/.claude/skills/run-desktop/quiet-launch.mjs`, mergeando antes main en la rama si hace falta) y un `--user-data-dir` temporal, con «Sync Traktor» activo y la ruta del `collection.nml` real; cargar `new.flac`, sustituir `old.mp3` y convertir.
  4. Comprobar en el NML: la ENTRY está en la ruta del fichero nuevo con sus dos CUE_V2 iguales, la playlist la nombra por la ruta nueva y existe la copia de seguridad.
  5. Abrir Traktor: la pista no sale perdida, tiene sus dos hotcues donde estaban y sigue en la playlist. Cerrar Traktor, volver a abrirlo y comprobar que los cues siguen (Traktor reescribe la colección al salir y podría reanalizar al ver otro fichero bajo el mismo `AUDIO_ID`). Anotar si Traktor reanaliza o cambia BPM/rejilla.
  6. Repetir el paso 3 con Traktor abierto: el parche queda en cola, Surco no retira el viejo hasta cerrarlo, y al cerrarlo la entrada se mueve.
  7. Restaurar la copia del paso 1 en su sitio.
- [ ] **Step 4: Informe** a Vicent con lo probado, lo que no (p. ej. Windows, cross-volume con NAS real) y lo observado en el paso 5. Sin merge a main hasta que lo diga (los trabajos por fases se quedan en la rama hasta el final); antes del merge, los pasos de la CI (lint de escritorio y web, `tsc --build`, build web) sobre el resultado.

---

## Self-review

- **Cobertura del spec, sección 1:** parche a la ENTRY de `replacesPath` (Tarea 3), LOCATION entera VOLUME/DIR/FILE (Tarea 2), CUE_V2 viajan con la entrada (Tareas 2, 3, 6), mismas guardas: copia de seguridad, programa cerrado, escribir y renombrar, cola si está abierto (sin cambios en `syncCollection`/`flushTraktorSync`/`holdInQueue`; cubiertas por Tarea 2, `spareEditedEntries`, Tarea 7 y paso 6 de la Tarea 8). Con «Sync Traktor» activo `traktorCollectionHas` ya mira la ruta vieja (`followsFrom`) y no añade una segunda entrada, porque el parche mueve la vieja; el escenario de la Tarea 7 lo fija con `addToTraktor: true` y «exactamente una ENTRY». El hueco previo con solo «Add to Traktor» (sin parche, entrada nueva y la vieja perdida) se arregla en la Tarea 6 con `RekordboxRepoint.replaced` y la puerta nueva de `recordConversionPatch`/`traktorFlushDeps`. Restricción «la entrada se crea igualmente al acabar» es de la fase 4.
- **Entrada para la fase 3:** `recordConversionPatch(..., replaces?: { path; cueShift })`, la constante `replacedCueShift` en `convertAudio` y `NmlPatch.cueShift` con `relocates` (test `moves the entry cues by the shift a replace carries`). La comprobación con `cueShift` presente no compara posiciones; la fase 3 decide cómo verificarlas.
- **Tipos:** `relocates?: true`, `volumeOf(nml, volume, bootVolume)`, `replaces?: { path: string; cueShift: CueShift }` usados igual en todas las tareas.
- **Proporción:** sin cuerpos de función; solo firmas, reglas y aserciones.
