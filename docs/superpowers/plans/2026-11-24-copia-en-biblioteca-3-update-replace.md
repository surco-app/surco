# Copia en tu biblioteca, entrega 3: Replace o Update en el botón partido. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando la pista abierta tiene una copia en Apple Music o en un programa DJ, el botón partido ofrece siempre Update (etiquetas y carátula del formulario a la copia, sin tocar su audio ni el archivo abierto) y Replace (convertir el archivo abierto y ocupar el sitio de la copia), con la última elegida recordada como cuerpo del botón.

**Architecture:** Un ajuste `libraryCopyAction` guarda la acción. `lib/libraryCopy.ts` elige la copia del botón entre la de Apple Music que hoy sustituye y las copias DJ con su veredicto. Update es un trabajo de `processTrack` normal cuya entrada es la copia, en su formato, sin procesar audio, con una marca nueva `tagsInPlace` para que main escriba sobre esa ruta exacta. Lo lanza una función nueva `updateLibraryCopy` de `useTrackProcessing` que no mueve la fila abierta. Replace es la conversión de hoy con `replacesPath` puesto también para una copia DJ. El menú de `FormatDestinationMenu` gana arriba el grupo de la copia.

**Tech Stack:** Electron, React 19, TS, Tailwind v4, i18next, TanStack Query, Vitest y Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-copia-en-biblioteca-design.md`, sección «### 3. Replace o Update en el botón partido» y «Decisiones tomadas tras la revisión».

## Global Constraints

- Se trabaja en el worktree `/Users/vicent/code/surco-copia-en-biblioteca`, rama `copia-en-biblioteca`, después de las entregas 1 y 2. Para los tests, `ln -sf /Users/vicent/code/surco/apps/desktop/node_modules apps/desktop/node_modules`; ese enlace no se commitea. Vitest se lanza desde `apps/desktop` con `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>`, nunca desde la raíz del repo.
- Tipos con los tres proyectos, desde `apps/desktop`: `npx tsc --noEmit -p tsconfig.web.json`, `-p tsconfig.node.json` y `-p tsconfig.scenarios.json`. Al final, `npm run lint -w apps/desktop` sobre todo.
- La entrega 1 deja `apps/desktop/src/renderer/src/lib/libraryCopy.ts` con `countsAsCopy(verdict: LibraryVerdict | null | undefined): boolean`. Si no existe, se para y se avisa; no se crea aquí otra versión.
- Qué cuenta como copia (spec): `same`, `even`, `tie`, `here`, `library`, `unmeasurable` y `measuring`. No cuentan `different`, `unreadable`, `missing`, `thisFile`, `several` ni `null`.
- El ajuste es `libraryCopyAction: 'update' | 'replace'`, por defecto `'update'`. Un valor desconocido en el JSON vale `'update'`.
- Copia en 8 idiomas (ca, de, en, es, fr, it, ja, pt-BR), con tuteo. En el texto de la UI no van ni guion largo ni dos puntos explicativos.
- Sin cambios de tamaño: ni el cuerpo ni la mitad del formato cambian de ancho entre Update, Replace y Replace anyway. Se mide en los 8 idiomas al ancho real (Task 10).
- TDD siempre: hay que ver el test en rojo antes de implementar. Un test que pasa a la primera solo vale tras verlo caer con una mutación.
- Los tests seleccionan por `data-testid` y nunca por clases CSS.
- Los comentarios del código solo explican el porqué (CLAUDE.md del repo).
- Mensajes de commit en inglés, una sola línea descriptiva, sin prefijo.
- No se sube ningún namespace de caché. Update no invalida análisis de la copia (su audio no cambia).
- Antes de cambiar o borrar una aserción que ya existe, se dice qué deja de hacer la app (norma «test cambiado: avisar antes»). Los cambios de tests de esta entrega que Vicent ya aprobó el 24/11 están en la Task 2 y la Task 7.
- En la prueba a mano no se toca la biblioteca real de rekordbox: solo una copia de `master.db` fuera de su carpeta, y solo con pistas propias. Traktor, Engine DJ, Serato y VirtualDJ están libres para pruebas.

## Cómo se ejecuta Update, y por qué así

Un trabajo de `processTrack` con `inputPath` = la copia ya hace todo lo que pide el spec, salvo un caso de nombre:

- Edita en su sitio sin reconvertir cuando el formato pedido es el del archivo: `editsInPlace(format, inputPath)` en `shared/format.ts:41-47` es cierto con `formatMatchesInput`, sin que haga falta `overwriteOriginal`. `processTrack.ts:613-621` lo marca `tagsOnly` si no hay normalización, declick ni recorte, y `stage('tags')`.
- No renombra si `outputName` es el nombre actual (`keepsName`, `processTrack.ts:623-631`).
- Las bibliotecas siguen a la entrada: `libraryFrom = job.replacesPath ?? job.inputPath` (`processTrack.ts:548`), así que rekordbox, Engine, Traktor, Serato y VirtualDJ sincronizan la copia, como al editar el original.
- Apple Music: con `addToAppleMusic` y `musicPersistentId`, la rama de `processTrack.ts:1037-1076` hace `updateInAppleMusic(pid, meta, cover)` sin reimportar (la entrada ya apunta a la copia, así que `retagged` queda vacío). Sin Music como destino, en macOS `processTrack.ts:858-878` busca la entrada que reproduce el archivo y la refresca.
- Las marcas de Serato se conservan: `ffmpeg.ts:2837-2870` lleva las marcas de la entrada a la salida (`carrySeratoCues`) salvo con `clearExtras` o con el marcador quitado a mano, que Update no envía.

El caso que falla: `resolveOutputTarget` (`main/inplace.ts:99-102`) arma la ruta con `formatExtension(format)`, así que una copia `.aif` acabaría renombrada a `.aiff`, y un nombre que `sanitizeOutputName` retoque también cambiaría. Por eso el trabajo lleva `tagsInPlace: true` y main usa `job.inputPath` tal cual como destino (Task 4).

No sirve `processOne` tal cual: aplica `exportedPatch` a la fila y la mueve a `result.outputPath` (`useTrackProcessing.ts:521-573`, `refreshTrackFromDisk(id, movedTo)`), con lo que la fila abierta pasaría a ser la copia. `updateLibraryCopy` usa el mismo IPC sin esos pasos. Una IPC propia duplicaría la escritura de etiquetas, la carátula, el bloqueo de Serato y las seis sincronizaciones; se descarta.

## Decisiones de este plan

- **Copia de Apple Music solo si es la que hoy sustituye.** Cuenta la de Music solo con `replaceTarget` no ambiguo y su veredicto contando como copia. Así siguen igual los tests de hoy que no ofrecen Replace con una coincidencia dudosa (`Editor.test.tsx` ~5941 y ~6470).
- **Copias DJ solo con la sección a la vista**, como en la entrega 2: `programCopies` solo se calcula con `libraryShown`. En una pestaña de programa o con la sección oculta, solo cuenta Apple Music.
- **Orden.** Manda la copia de Music; si no, la primera copia DJ que cuenta en el orden de la sección (`DJ_PROGRAMS`), aunque esté comparando.
- **Mientras compara, el clic espera.** Con la copia en `measuring`, o con Music todavía buscando su ruta, el cuerpo ya dice la acción recordada pero va `aria-disabled` y el clic, ⌘⏎ y elegir en el menú no ejecutan nada (elegir sí recuerda). Si acaba en «Another version», escribir etiquetas o sustituir sobre esa copia sería un error. Hoy Replace con Music sí se puede pulsar mientras compara; esto lo cambia.
- **Con Update, la mitad del formato muestra el de la copia** (`shownFormat`), porque es lo que se escribe. El menú marca ese formato. Elegir otro formato solo cuenta si luego se elige Replace.
- **Tras Update, la fila abierta queda como estaba.** No pasa a «done» ni cambia de ruta. Sale un aviso con el texto que ya existe `verify.plainLine.tagsUpdated` («Tags updated»). Si falla, la fila vuelve a su estado y el error sale como el de una conversión (`onProcessError`).
- **Update no lleva playlists apuntadas.** Las de programas con copia ya se aplican al momento (entrega 1); las de programas sin copia siguen apuntadas para una conversión.
- **⌘⏎ hace lo que dice el cuerpo.** Hoy ⌘⏎ va directo a `processOne` (`lib/commands.ts:898-930`) y se salta el sello de Replace que pone el Editor (`Editor.tsx:2487-2500`). Con Update en el cuerpo convertiría. El Editor publica su acción y ⌘⏎ la usa.
- **Copia de Music en «Another version», «Not found» o «Can't be read».** Hoy el botón dice Replace igualmente. Con el spec pasa a Convert/Add. Es un cambio de conducta más, que se avisa en el informe.

## Review Focus

- Una copia `.aif` (o con un nombre que el saneado cambiaría) no se renombra al hacer Update. Test en la Task 4.
- Con la copia todavía comparando, o Music sin ruta, ni el clic ni ⌘⏎ convierten ni actualizan bajo la etiqueta Update. Tests en la Task 7.
- Update nunca lleva a la copia lo que es del archivo abierto: `foreignRemoved`, etiquetas ajenas sueltas, `clearExtras`, normalización, declick, recorte, playlists ni `programs`. Test en la Task 5.
- Cambiar de pista mientras corre Update: el estado vuelve a la fila que lo lanzó y la fila nunca se mueve a la ruta de la copia. Test en la Task 5.
- ⌘⏎ con Update en el cuerpo actualiza la copia y no convierte; con Replace sella `replacesPath` antes de convertir. Test en la Task 7.

---

### Task 1: Ajuste `libraryCopyAction`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`, junto a `cueSaveThen` (~260)
- Modify: `apps/desktop/src/main/settings.ts`, valores por defecto (~105) y al normalizar (~418)
- Test: `apps/desktop/src/main/settings.test.ts`, junto a los tests de `cueSaveThen` (~1232)

**Interfaces:**
- Produces: `export type LibraryCopyAction = 'update' | 'replace'` en `shared/types.ts` y `AppSettings.libraryCopyAction: LibraryCopyAction`.

- [ ] **Step 1: Escribir los tests que fallan**, con el estilo de los de `cueSaveThen`.
  - `it('starts a library copy on Update, which leaves its audio alone')`: `getSettings().libraryCopyAction` es `'update'`.
  - `it('keeps the action picked for a library copy')`: `saveSettings({ libraryCopyAction: 'replace' })` y luego es `'replace'`.
  - `it('reads an unknown library copy action as Update')`: con `{ libraryCopyAction: 'merge' }` en el JSON, es `'update'`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/settings.test.ts`. Falla.
- [ ] **Step 3: Implementar.** Default `'update'`, normalizar con `=== 'replace' ? 'replace' : 'update'`.
- [ ] **Step 4:** el mismo comando pasa y los tres `tsc` dan 0. Si algún mock de `AppSettings` deja de compilar, se le añade `libraryCopyAction: 'update'`.
- [ ] **Step 5:** commit `Remember whether a track with a library copy updates the copy or replaces it`.

### Task 2: La etiqueta del cuerpo

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/exportLabel.ts`
- Test: `apps/desktop/src/renderer/src/lib/exportLabel.test.ts`

**Interfaces:**
- Consumes: `LibraryCopyAction` (Task 1).
- Produces: en `ExportLabelState`, `replaces?: boolean` desaparece y entra `libraryAction?: LibraryCopyAction` (undefined = sin copia). `exportButtonLabel` devuelve `{ key: string; options?: Record<string, unknown>; library?: LibraryCopyAction }`. `library` está puesto solo cuando la etiqueta sale de `libraryAction`; así `ExportButton` sabe si el clic es la acción de la copia o la conversión de siempre.

Regla, en el sitio de hoy de `replaces` (después de `done`, para que las ediciones del propio archivo sigan mandando):
- `libraryAction: 'update'` da `{ key: 'editor.update', library: 'update' }`, también con `libraryBetter`.
- `libraryAction: 'replace'` da `editor.libraryHasBetter` con `libraryBetter` y `editor.replaceAction` sin él, con `library: 'replace'`.

Tests que cambian (aprobado por Vicent el 24/11). Las filas 21 y 22 de `rows` y el test `leaves the format out of the convert, replace and replace anyway labels` (~45-48) usaban `replaces: true`. Pasan a `libraryAction: 'replace'` con la misma clave esperada. La app ya no deduce Replace de que haya una copia; lo hace solo si esa es la acción elegida.

- [ ] **Step 1: Escribir los tests que fallan.** Cambiar las tres filas citadas y añadir:
  - En `rows`: `[{ ...base, tagsOnly: false, libraryAction: 'update' }, 'editor.update']` y `[{ ...base, tagsOnly: false, libraryAction: 'update', libraryBetter: true }, 'editor.update']`.
  - `it('names the library copy action only when the label comes from it, so a press knows what to run')`: `library` es `'update'` y `'replace'` en esas filas; es `undefined` con `{ ...base, inPlace: true, libraryAction: 'update' }` (gana `editor.update` del propio archivo) y con `{ ...base, done: true, libraryAction: 'replace' }`.
  - `it('says anyway only when replacing a better copy, since Update leaves its audio alone')`: con `libraryBetter: true`, `'update'` da `editor.update` y `'replace'` da `editor.libraryHasBetter`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/exportLabel.test.ts`. Falla.
- [ ] **Step 3: Implementar.** Actualizar el comentario de `replaces` en `ExportLabelState` para que diga por qué la acción la elige el usuario y no el veredicto.
- [ ] **Step 4:** el mismo comando pasa. `tsc -p tsconfig.web.json` dará errores en `ExportButton.tsx`, que arregla la Task 6; aquí basta con que el fichero de test pase.
- [ ] **Step 5:** commit `Label the convert button with the action picked for the library copy`.

### Task 3: Elegir la copia del botón

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/libraryCopy.ts`
- Test: `apps/desktop/src/renderer/src/lib/libraryCopy.test.ts`

**Interfaces:**
- Consumes: `countsAsCopy`; `ReplaceCandidate` y `isAmbiguousCandidate` de `lib/appleMusicLibrary`; `replacePatch` de `lib/replaceBeforeConvert`; `OUTPUT_FORMATS` y `formatMatchesInput`.
- Produces:
  ```ts
  export interface CopyCandidate {
    program: PlaylistSource
    path: string // '' while Apple Music still looks the file up
    format: string // "AIFF 16/44.1", as the section's row shows it
    verdict: LibraryVerdict | null
    better: boolean
    music?: ReplaceCandidate // only on the Apple Music candidate, never ambiguous
  }
  export interface LibraryCopyTarget extends Omit<CopyCandidate, 'verdict'> {
    held: boolean
  }
  export interface LibraryCopyRef {
    path: string
    program: PlaylistSource
    musicPersistentId?: string
  }
  export function pickLibraryCopy(candidates: readonly CopyCandidate[]): LibraryCopyTarget | null
  export function replaceCopyPatch(target: LibraryCopyTarget, openPath: string): Partial<TrackItem>
  export function copyRefOf(target: LibraryCopyTarget): LibraryCopyRef
  export function keptFormatOf(path: string): OutputFormat | undefined
  ```

Reglas:
- `pickLibraryCopy`: el primero con `countsAsCopy(verdict)`; `held` es `verdict === 'measuring' || path === ''`.
- `replaceCopyPatch`: con `music`, `replacePatch(target.music, openPath) ?? {}`; si no, `{ replacesPath: target.path }`. Nunca pone `musicPersistentId` para una copia DJ.
- `copyRefOf`: `musicPersistentId` solo con `music`.
- `keptFormatOf`: `OUTPUT_FORMATS.find((f) => formatMatchesInput(f, path))`.

- [ ] **Step 1: Escribir los tests que fallan** en `describe('pickLibraryCopy')`, `describe('replaceCopyPatch')` y `describe('keptFormatOf')`:
  - `it('takes the Apple Music copy before any DJ copy')`.
  - `it('takes the first DJ copy that counts, in the order of the section')`: rekordbox `different`, Traktor `same` da Traktor.
  - `it.each(['different', 'unreadable', 'missing', 'thisFile', 'several', null])('offers nothing for a lone copy that is %s')`.
  - `it('holds the press while the copy is still being compared, it may be another version')`: rekordbox `measuring` da rekordbox con `held: true`.
  - `it('holds the press while Apple Music has not said where its copy lives')`: Music con `path: ''` y `same` da `held: true`.
  - `it('replaces a DJ copy by its path alone, Apple Music is not involved')`: da `{ replacesPath: '/r/a.aiff' }`.
  - `it('replaces the Apple Music copy with the stamp it has today')`: igual que `replacePatch` con el mismo candidato.
  - `it('keeps an .aif copy as AIFF and an .m4a copy as its own container')`: `aiff` y `alac`; `.ogg` da `undefined`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/libraryCopy.test.ts`. Falla.
- [ ] **Step 3: Implementar**, con un comentario que diga por qué la copia que compara retiene el clic.
- [ ] **Step 4:** el mismo comando pasa, con los tests de las entregas 1 y 2.
- [ ] **Step 5:** commit `Pick the library copy the convert button updates or replaces`.

### Task 4: main escribe las etiquetas sobre la ruta exacta

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`, en `ProcessJob` (~825-891)
- Modify: `apps/desktop/src/main/processTrack.ts:632-641` (`resolveOutputTarget`)
- Test: `apps/desktop/src/main/processTrack.test.ts`, en un `describe('runProcessTrack — retagging a library copy where it is')` nuevo, con el `job()` y los `deps` del fichero

**Interfaces:**
- Produces: `ProcessJob.tagsInPlace?: true`. Con ella, `resolved = { outputPath: job.inputPath, inPlace: true }` en vez de `resolveOutputTarget(...)`. Comentario en el tipo: la escribe Update sobre una copia de la biblioteca, que no se puede renombrar porque los programas la tienen por esa ruta.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `it('writes the tags onto an .aif copy without renaming it to .aiff')`: `job({ inputPath: '/r/Song.aif', outputName: 'Song', format: 'aiff', tagsInPlace: true })`. `convertAudio` se llamó con salida `/r/Song.aif`, `removeRenamedOriginal` no se llamó y `result.outputPath` es `/r/Song.aif`.
  - `it('keeps a copy name the safe file name would change')`: `inputPath: '/r/A: B.wav'`, `format: 'wav'`, `asciiFileNames: true` en settings. La salida es `/r/A: B.wav`.
  - `it('lets the libraries follow the copy it retags')`: `snapshotLibraries` se llamó con `/r/Song.aif`.
  - `it('retags the Apple Music entry of the copy instead of adding the file again')`: `addToAppleMusic: true`, `keepOutputCopy: true`, `musicPersistentId: 'P1'`, `appleMusicEntry` responde con la ruta de la copia. Se llamó `updateInAppleMusic('P1', …)` y no `addToAppleMusic`.
  - `it('reports a tags-only write for a library copy update')`: `result.tagsOnly` es `true` y la etapa enviada es `'tags'`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/processTrack.test.ts`. Los dos primeros fallan; los otros pueden pasar ya (se ven caer en la Task 8).
- [ ] **Step 3: Implementar** en `processTrack.ts`.
- [ ] **Step 4:** el mismo comando pasa entero y `tsc -p tsconfig.node.json` da 0.
- [ ] **Step 5:** commit `Retag a library copy at its exact path so an .aif copy is never renamed`.

### Task 5: `updateLibraryCopy` en `useTrackProcessing`

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Consumes: `LibraryCopyRef` (Task 3), `ProcessJob.tagsInPlace` (Task 4).
- Produces:
  - `Params.onLibraryCopyUpdated?: (name: string) => void`.
  - En lo que devuelve el hook, `updateLibraryCopy: (id: string, copy: LibraryCopyRef) => Promise<BatchOutcome>`.

Paso previo, refactor sin cambio de conducta y en su propio commit: sacar de `runOne` dos funciones locales que use también Update. `readyTrack(id): Promise<TrackItem | null>` lleva las comprobaciones de ~280-345 (procesando, programa de solo lectura, relectura, `metaPartial`, `metaReadFailed`, campos obligatorios), con los mismos `updateTrack` de error. `jobMetaOf(track): TrackMetadata` lleva el `withCachedQualityTag(clearHiddenProvenance(sanitizeMeta(...)))` de ~416-427. Los tests que ya hay en `useTrackProcessing*.test.tsx` lo cubren; se pasan antes de seguir. Commit `Share the readiness checks and tag building of a conversion`.

`updateLibraryCopy`:
1. `readyTrack(id)`; si da `null`, `'failed'` o `'skipped'` como hace `runOne`.
2. `window.api.conversionPrograms([copy.path])` y `dj.askToApply` si hay programas, como `askToCloseReached`. Después `beginConversionBatch()`.
3. Guarda `status` y `stage` de la fila y pone `status: 'processing'`, `stage: undefined`. `releaseFile?.(copy.path)` antes del trabajo y `reclaimFile?.(copy.path)` en `finally`.
4. `window.api.processTrack` con estos valores:
   - `id: track.id`, `inputPath: copy.path`, `tagsInPlace: true`, `format: keptFormatOf(copy.path)` y `outputName` igual al nombre de la copia sin extensión.
   - `meta: jobMetaOf(track)`, `...coverSourceOf(await withMusicCover(track, updateTrack))` y `removeCover: track.coverRemoved`.
   - `normalize: { ...(settings?.normalize ?? { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }), mode: 'none' }` (el respaldo son los valores de `main/settings.ts:188`), `declick: { mode: 'off', noise: 'off' }`, `overwriteOriginal: false`, `convertBesideOriginal: false` y `keepOutputCopy: true`.
   - `addToAppleMusic: !!copy.musicPersistentId` y `musicPersistentId: copy.musicPersistentId`.
   - Nunca `trim`, `foreignRemoved`, `clearExtras`, `metaUnread`, `replacesPath`, `previousOutputPath`, `playlists` ni `programs`.
5. Al acabar bien, vuelve el `status`/`stage` guardado, `onLibraryCopyUpdated?.(track.listLabel)` y `'converted'`. Si `result.appleMusicFailed`, `onAppleMusicFailed`. Si `result.engineDjError` o hay excepción, vuelve el estado guardado y `onProcessError(message, label, raw)`, con el mismo `mainErrorMessage` de `runOne`, y da `'failed'`. Una cancelación (`conversionCancelled`) vuelve el estado y da `'skipped'`.
6. En `finally`, `endConversionBatch()`, `rereadMovedSources()` y `rereadReachedCollections(flushed)`. No llama a `exportedPatch`, `refreshTrackFromDisk` ni `removeAnalysisQueries`.

Si `keptFormatOf` da `undefined`, no se envía nada y se da `'skipped'`; la Task 7 ya no ofrece la copia en ese caso.

- [ ] **Step 1: Escribir los tests que fallan**, con el montaje de `useTrackProcessing.test.tsx`:
  - `it('retags the library copy where it is, in its own format, and never the open file')`: copia `/r/Song.aif`. El trabajo lleva `inputPath: '/r/Song.aif'`, `format: 'aiff'`, `tagsInPlace: true`, `outputName: 'Song'` y la meta del formulario.
  - `it('sends the copy nothing that belongs to the open file or changes audio')`: pista con `foreignRemoved`, `metaCleared`, `trim`, `playlists`, `programs` y normalización en settings. El trabajo no tiene `trim`, `foreignRemoved`, `clearExtras`, `playlists` ni `programs`; `normalize.mode` es `'none'` y `declick` es `{ mode: 'off', noise: 'off' }`.
  - `it('retags the Apple Music entry when the copy is the one Music plays')`: con `musicPersistentId: 'P1'`, el trabajo lleva `addToAppleMusic: true` y `musicPersistentId: 'P1'`. Sin él, `addToAppleMusic: false`.
  - `it('leaves the open row on its own file and state after updating the copy')`: fila `idle`; tras resolver, `status` es `'idle'`, `outputPath` y `inputPath` no cambian, `refreshTrackFromDisk` no se llamó y `onLibraryCopyUpdated` se llamó con la etiqueta.
  - `it('puts the state back on the row that ran it even when another track is open by then')`: el trabajo queda pendiente, se cambia la selección y se resuelve. El estado vuelve a la fila `a` y la otra no cambia.
  - `it('says a failed copy update like a failed conversion and leaves the row as it was')`: `processTrack` rechaza. `onProcessError` se llamó y el `status` es el de antes.
  - `it('refuses a copy update with required fields empty, as a conversion would')`: con un campo obligatorio vacío, no hay trabajo y la fila muestra el error de siempre.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useTrackProcessing.test.tsx`. Fallan.
- [ ] **Step 3: Implementar** el refactor (y su commit) y luego `updateLibraryCopy`.
- [ ] **Step 4:** el mismo comando pasa, junto a `src/renderer/src/hooks/useTrackProcessingPerTrackDials.test.tsx`, y `tsc -p tsconfig.web.json` no da errores nuevos en este fichero.
- [ ] **Step 5:** commit `Update a library copy's tags and cover without touching its audio or the open file`.

### Task 6: El grupo de la copia en el botón y el menú

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/FormatDestinationMenu.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ExportButton.tsx` (props ~29-95, etiqueta ~177-190, clic del cuerpo ~395-410, menú ~485-500)
- Modify: `apps/desktop/src/renderer/src/components/ConvertFooter.tsx` (props ~73-79, nota de Serato ~765, `ExportButton` ~788-789)
- Modify: los 8 `apps/desktop/src/renderer/src/i18n/locales/*.json`
- Test: `apps/desktop/src/renderer/src/components/ExportButton.test.tsx` y `ConvertFooter.test.tsx`

**Interfaces:**
- Consumes: `exportButtonLabel(...).library` (Task 2), `LibraryCopyAction`.
- Produces:
  ```ts
  // lib/libraryCopy.ts
  export interface LibraryCopyOffer {
    name: string // "rekordbox", "Apple Music"
    format: string // "AIFF 16/44.1"
    action: LibraryCopyAction
    better: boolean
    held: boolean
    keptFormat?: OutputFormat
  }
  ```
  - `ExportButton`: salen `replaces` y `libraryBetter`. Entran `libraryCopy?: LibraryCopyOffer`, `onLibraryAction?: (action: LibraryCopyAction) => void` (ejecuta) y `onLibraryActionChange?: (action: LibraryCopyAction) => void` (recuerda).
  - `ConvertFooter`: salen `replaces` y `libraryBetter`; entran los mismos tres. Pasa `libraryCopy={isMulti ? undefined : libraryCopy}` (la Task 11 lo enciende con varias).
  - `FormatDestinationMenu`: `libraryCopy?: { heading: string; action: LibraryCopyAction; onPick: (action: LibraryCopyAction) => void }`.

Comportamiento:
- **Cuerpo.** `exportButtonLabel` recibe `libraryAction: libraryCopy?.action` y `libraryBetter: libraryCopy?.better`. Si la etiqueta trae `library`, el clic llama a `onLibraryAction(library)` en vez de `onProcess`. Con `held`, el cuerpo va `aria-disabled` y el clic no hace nada. Con campos obligatorios vacíos sigue la sacudida de hoy.
- **Mitad del formato.** Con la etiqueta en `library: 'update'` y `keptFormat`, `shownFormat` es `keptFormat`.
- **Menú.** Arriba, un `fieldset` con el encabezado `library-copy-heading` y el texto `${name} · ${format}`, compuesto como la fila de la sección, sin clave nueva. Debajo van dos `menuitemradio`, `library-copy-update` y `library-copy-replace`, con `aria-checked` en la acción actual. Cada uno lleva su verbo (`editor.update`, `editor.replaceAction`) y una línea gris debajo (`text-label font-normal text-fg-dim`, como `menuOverwriteNote`). Luego el separador y Formato como hoy. Elegir uno: cierra el menú, `onLibraryActionChange(acción)` y, si no está `held` ni bloqueado, `onLibraryAction(acción)`.
- **Nota de Serato** (`convert-serato-stars-note`): sale con `libraryCopy?.action === 'replace'` o `item.replacesPath`, ya no con cualquier copia. Con Update no hay archivo nuevo, así que no se pierden estrellas.

Copia nueva (2 claves en `editor`):

| clave | en | es | ca | de | fr | it | pt-BR | ja |
|---|---|---|---|---|---|---|---|---|
| `libraryCopyKeepsAudio` | Keeps its audio | Mantiene su audio | Manté el seu àudio | Behält sein Audio | Garde son audio | Mantiene il suo audio | Mantém o áudio | 音声はそのまま |
| `libraryCopyWithThisFile` | With this file | Con este archivo | Amb aquest fitxer | Mit dieser Datei | Avec ce fichier | Con questo file | Com este arquivo | このファイルで |

El cuerpo reusa `editor.update`, `editor.replaceAction` y `editor.libraryHasBetter`. El cuerpo es `flex-1`, así que su ancho no depende del texto. La mitad del formato ya reserva el nombre más largo (`formatPicker`). La Task 10 lo mide.

Test que cambia: `ConvertFooter.test.tsx` ~618 (`replaces: true` para la nota de Serato) pasa a `libraryCopy` con `action: 'replace'`. Lo que dejaba de cubrir: nada, el caso es el mismo con otro nombre de prop.

- [ ] **Step 1: Escribir los tests que fallan.** En `ExportButton.test.tsx`, con una oferta `{ name: 'rekordbox', format: 'AIFF 16/44.1', action: 'update', better: false, held: false, keptFormat: 'aiff' }`:
  - `it('updates the copy from the body when Update is the remembered action')`: clic en `process-btn` llama a `onLibraryAction('update')` y no a `onProcess`.
  - `it('says Replace anyway over a better copy, and still replaces')`: `action: 'replace'`, `better: true`. El texto es «Replace anyway» y el clic da `onLibraryAction('replace')`.
  - `it('offers both actions under the copy, each saying what it does')`: abrir `process-format-toggle`. `library-copy-heading` dice `rekordbox · AIFF 16/44.1`; `library-copy-update` contiene «Update» y «Keeps its audio» y tiene `aria-checked="true"`; `library-copy-replace` contiene «Replace» y «With this file».
  - `it('remembers and runs the action picked from the menu')`: clic en `library-copy-replace` da `onLibraryActionChange('replace')` y `onLibraryAction('replace')`, y el menú se cierra.
  - `it('only remembers a pick while the copy is still being compared')`: con `held: true`, elegir llama a `onLibraryActionChange` y no a `onLibraryAction`. El cuerpo tiene `aria-disabled="true"` y su clic no llama a nada.
  - `it('shows the copy format on the dropdown half while updating, since that is what gets written')`: `outputFormat: 'flac'`. `process-format-current` dice `AIFF`; con `action: 'replace'` dice `FLAC`.
  - `it('converts as today with no library copy')`: sin oferta, el clic llama a `onProcess` y no hay `library-copy-heading`.

  En `ConvertFooter.test.tsx`:
  - `it('does not warn about Serato stars when only the copy tags are updated')`: con `seratoLosesStars` y la oferta en `update`, no hay `convert-serato-stars-note`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/ExportButton.test.tsx src/renderer/src/components/ConvertFooter.test.tsx`. Fallan.
- [ ] **Step 3: Implementar**, con la copia en los 8 idiomas. Si existe un test de paridad de claves de locales, se pasa también.
- [ ] **Step 4:** el mismo comando pasa y `tsc -p tsconfig.web.json` solo da errores en `Editor.tsx` (Task 7).
- [ ] **Step 5:** commit `Offer Update and Replace for the library copy in the convert split button`.

### Task 7: El editor elige la copia y ejecuta la acción

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx`: props (~214, ~370), candidatos tras `libraryRows` (~1861), `seratoLosesStars` (~923-927), `ConvertFooter` (~2399-2406 y `onProcess` ~2487-2500)
- Modify: `apps/desktop/src/renderer/src/App.tsx`: `useTrackProcessing` (~1874), `onProcessSelected`/`convertSelected` (~3105-3147), junto a `onCueSaveThen` (~3164), props del Editor (~5325-5400)
- Modify: `apps/desktop/src/renderer/src/lib/commands.ts`: `process-current` (~898-930) y su tipo de entrada (~233)
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx` (bloque de `renderWithLibraryCopy`, ~5834, y `describe('rows for the DJ programs that hold the track')`, ~6629); `apps/desktop/src/renderer/src/lib/commands.test.ts`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: props nuevas del Editor, todas opcionales.
  - `libraryCopyAction?: LibraryCopyAction` (por defecto `'update'`)
  - `onLibraryCopyAction?: (action: LibraryCopyAction) => void`
  - `onUpdateLibraryCopy?: (copy: LibraryCopyRef) => void`
  - `onLibraryRunChange?: (run: ((onStarted?: () => void) => void) | null) => void`

  `onProcess` pasa a `(format: OutputFormat, onStarted?: () => void) => void`. En `commands.ts`, la entrada gana `editorLibraryRunRef: { readonly current: ((onStarted?: () => void) => void) | null }`.

Comportamiento:
- **Candidatos**, solo sin `isMulti`. Música primero, si `replaceTarget` no es ambiguo, `!musicHoldsFile` y hay `musicRow`: `{ program: 'appleMusic', path: replaceTarget.path ?? '', format: replacedCopyFormat, verdict: musicRow.verdict, better: libraryCopyBetter, music: replaceTarget }`. Luego cada `comparedProgramCopies[i]` con `programVerdicts[i]`: `{ program, path, format: state.format, verdict: rowVerdict(state), better: rowVerdict(state) === 'library' }`. `target = pickLibraryCopy(...)`. Si `keptFormatOf(target.path)` da `undefined`, no hay oferta.
- **Oferta** a `ConvertFooter`: `{ name, format, action: libraryCopyAction, better, held, keptFormat }`. `name` es `'Apple Music'` o `LIBRARY_NAME[program]`.
- **`run(action, onStarted?)`**: con `held`, nada. Con `'update'`, `onUpdateLibraryCopy(copyRefOf(target))` y `onStarted?.()`. Con `'replace'`, `onChange(replaceCopyPatch(target, item.inputPath))` y `onProcess(format, onStarted)`. Sin oferta, el `onProcess` del Editor sigue como hoy (sello de `replacePatch` para el caso «es este archivo»).
- `onLibraryAction` = `run`, y `onLibraryActionChange` = `onLibraryCopyAction`.
- `onLibraryRunChange` se llama en un efecto: con oferta, `(onStarted) => run(libraryCopyAction, onStarted)`; sin oferta, `null`. Al desmontar, `null`.
- `seratoLosesStars` usa `target.path` solo con la acción `'replace'`.
- **App.** `onUpdateLibraryCopy = (copy) => selected && void updateLibraryCopy(selected.id, copy)`. `onLibraryCopyAction = (a) => saveSettings({ libraryCopyAction: a })`. `onLibraryCopyUpdated` hace `pushToast` con `tone: 'neutral'`, `tr('verify.plainLine.tagsUpdated')` y `testid: 'library-copy-updated'`. `onProcessSelected` reenvía `onStarted` a `convertSelected`. `editorLibraryRunRef` se rellena con `onLibraryRunChange`.
- **⌘⏎** (`process-current`, una pista): si `editorLibraryRunRef.current` existe, `editorLibraryRunRef.current(() => moveSelection(1))` y return; si no, como hoy.

Tests que cambian (aprobado por Vicent el 24/11; la app deja de proponer Replace de entrada con una copia de Music):
- `it('offers the replace as a deliberate one when Apple Music has the better copy')` (~6329), `it('warns before replacing a better Apple Music copy from a program tab')` (~6338) y `it('warns before replacing a better Apple Music copy with the library section hidden')` (~6346). Hoy esperan «Replace anyway» sin elegir nada. Pasan a montar con `libraryCopyAction: 'replace'` y siguen esperando «Replace anyway». El primero comprueba además que el clic llama a `onProcess` con `onChange` recibiendo `replacesPath: '/Music/Strobe.wav'`. A cada uno se le añade un gemelo con la acción por defecto que espera `/^Update$/`. Para eso `renderWithLibraryCopy` gana `libraryCopyAction?` y devuelve también `onUpdateLibraryCopy`.

- [ ] **Step 1: Escribir los tests que fallan.**
  - Los tres cambiados y sus gemelos.
  - `it('updates the Apple Music copy from the body by default, leaving the open file alone')`: con veredicto listo, clic en `process-btn`. `onUpdateLibraryCopy` recibe `{ path: '/Music/Strobe.wav', program: 'appleMusic', musicPersistentId: … }` y no se llamó a `onProcess`.
  - `it('waits for the comparison before a press updates or replaces')`: `pair` pendiente. `process-btn` dice «Update» y tiene `aria-disabled="true"`. Un clic no llama a `onUpdateLibraryCopy` ni a `onProcess`.
  - `it('offers nothing new for an Apple Music copy that is another version')`: el caso 3 Ways (~6470) con `.not.toHaveTextContent(/Update/)` añadido, que hoy ya pasa. Se dice en el informe que es una aserción nueva sobre un test que ya existía.
  - En el bloque DJ, `it('replaces a copy only rekordbox holds by its path')`: rekordbox `same`, `libraryCopyAction: 'replace'`. El clic llama a `onChange` con `{ replacesPath: '/r/Strobe.wav' }` sin `musicPersistentId`, y después a `onProcess`.
  - `it('updates a copy only rekordbox holds')`: por defecto, el clic da `onUpdateLibraryCopy({ path: '/r/Strobe.wav', program: 'rekordbox' })`.
  - `it('names the copy and its format above the two actions')`: abrir el menú. `library-copy-heading` dice `rekordbox · WAV 16/44.1` (el formato que dé el ayudante).
  - `it('remembers the action picked from the menu')`: clic en `library-copy-replace` da `onLibraryCopyAction('replace')`.
  - `it('converts as today when the only copy is another version')`: rekordbox `different`. `process-btn` dice «Convert» y no hay `library-copy-heading`.
  - En `commands.test.ts`: `it('runs the library copy action on ⌘⏎ instead of converting')`: con `editorLibraryRunRef.current` puesto, `process-current` lo llama y no llama a `processOne`, y `moveSelection(1)` llega por `onStarted`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/Editor.test.tsx src/renderer/src/lib/commands.test.ts`. Fallan los nuevos y los cambiados.
- [ ] **Step 3: Implementar** en Editor, App y commands.
- [ ] **Step 4:** el mismo comando pasa y los tres `tsc` dan 0.
- [ ] **Step 5:** commit `Update or replace the library copy the editor found, in Apple Music or a DJ program`.

### Task 8: Probar con mutación

- [ ] **Step 1:** una a una, deshaciendo cada una:
  - Quitar `tagsInPlace` del trabajo de Update: cae «retags the library copy where it is…» (Task 5).
  - En main, ignorar `tagsInPlace`: caen los dos primeros de la Task 4.
  - Enviar `trim: track.trim` en Update: cae «sends the copy nothing…».
  - Llamar a `refreshTrackFromDisk(id, copy.path)` tras Update: cae «leaves the open row…».
  - `held` siempre `false`: caen «holds the press…» (Task 3), «only remembers a pick…» (Task 6) y «waits for the comparison…» (Task 7).
  - Poner las copias DJ antes que Music: cae «takes the Apple Music copy before any DJ copy».
  - En `exportButtonLabel`, devolver `library` también desde `editor.update` del propio archivo: cae «names the library copy action only when…».
  - Quitar el atajo de `editorLibraryRunRef` en `process-current`: cae el test de ⌘⏎.
  - En `replaceCopyPatch`, poner `musicPersistentId` también para DJ: cae «replaces a copy only rekordbox holds by its path».
- [ ] **Step 2:** si alguna mutación no tumba ningún test, el test es falso: arreglarlo y volver a mutar. En el informe, qué tests cayó cada mutación.

### Task 9: Pasos de la CI

- [ ] **Step 1:** desde `apps/desktop`, la suite entera `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run` con código de salida 0 (un «Unhandled Errors» la deja en 1 aunque todo pase). Un test que solo pasa suelto está roto y se arregla.
- [ ] **Step 2:** `npm run lint -w apps/desktop` limpio y los tres `tsc` con 0 errores.
- [ ] **Step 3:** si algo se arregló, commit con una línea que diga qué.

### Task 10: Prueba en la app y medidas (controlador)

- [ ] **Preparar.** Copiar `~/Library/Pioneer/rekordbox/master.db` (y su `-wal` y `-shm` si existen) a `~/surco-pruebas/rekordbox/` y anotar el `shasum` del original. Compilar el worktree y arrancar la app empaquetada con `quietLaunch` (skill `run`, sin activar la ventana) en un perfil temporal (`--user-data-dir`). En Ajustes, `rekordboxDbPath` apunta a la copia; comprobarlo antes de abrir nada. Solo pistas propias.
- [ ] **Update con rekordbox.** Una pista de la copia en `.aif` y un FLAC de ella con álbum distinto. Al abrir el FLAC, mientras compara, el cuerpo dice «Update» y no reacciona al clic. Con el veredicto, el clic escribe el álbum en el `.aif`: no se renombra, su `shasum` de audio (`ffmpeg -i x -map 0:a -f md5 -`) es el mismo, el FLAC no cambia y la entrada de la copia de `master.db` tiene el álbum nuevo. Sale «Tags updated» y la fila sigue en el FLAC. Anotar si la fila de la sección vuelve a comparar.
- [ ] **Replace con rekordbox.** Elegir Replace en el menú: convierte, la copia de `master.db` apunta al archivo nuevo, con cues y playlists. El cuerpo dice «Replace» en la pista siguiente y tras reiniciar la app.
- [ ] **Replace anyway.** Con una copia mejor, el cuerpo dice «Replace anyway» con Replace y «Update» con Update.
- [ ] **Apple Music.** Una pista con copia en Music: por defecto Update retaguea la entrada (álbum y carátula en Music) sin añadir otra. Replace hace lo de hoy.
- [ ] **Otro programa.** Repetir Update y Replace con Traktor o Engine DJ, y Update con una copia de Serato (sus marcas siguen tras Update).
- [ ] **⌘⏎** con Update en el cuerpo actualiza la copia y pasa a la pista siguiente; con Replace pregunta lo de siempre antes de pasar.
- [ ] **Sin copia, Another version, Can't be read y Not found:** el botón dice Convert o Add, como hoy.
- [ ] **Medidas.** En los 8 idiomas, con la ventana al ancho mínimo y en la vista normal, medir el ancho del cuerpo y de la mitad del formato con Update, Replace y Replace anyway (`getBoundingClientRect` desde DevTools, o captura sin activar la ventana). No pueden cambiar entre acciones, el texto no se corta y el menú (`w-56`) muestra entero `VirtualDJ · AIFF 24/192` y las líneas grises. Si algo se corta en un idioma, se acorta ese texto y se vuelve a medir. Las medidas van al informe.
- [ ] Al acabar, el `shasum` del `master.db` original es el mismo. En el informe, lo probado y lo que no se pudo probar.

### Task 11: Varias pistas (separable, se puede dejar para otra rama)

**Antes de empezar, preguntar a Vicent.** Hoy una selección que mezcla pistas que sustituyen con pistas que se añaden se bloquea entera (`lib/batch.ts:96-127`, `selectionReplaceMode`, regla suya del 15/09, texto `editor.mixedReplaceSelection`). El spec pide lo contrario: la acción elegida para las que tienen copia y el resto convertido como hoy. Hay que confirmar que esa regla cae y avisar de que cambian sus tests. Sin su sí, esta tarea no se hace.

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useProgramCopies.ts`: sacar la búsqueda por programa (~70-90) a una función pura exportada
- Create: `apps/desktop/src/renderer/src/hooks/useSelectionCopies.ts`
- Modify: `apps/desktop/src/renderer/src/lib/libraryCopy.ts`, `lib/batch.ts` (`convertGate`), `hooks/useTrackProcessing.ts` (`processAll`), `components/ConvertFooter.tsx` (~788), `components/Editor.tsx`, `App.tsx` (`convertTracks`, `onProcessAllSelected`)
- Test: `useProgramCopies.test.tsx`, `useSelectionCopies.test.tsx`, `lib/batch.test.ts`, `useTrackProcessing.test.tsx`, `Editor.test.tsx`

**Interfaces:**
- Produces:
  - `export function programCopyOf(tracks: CollectionTrack[], track: { inputPath: string; meta: { title: string; artist: string }; durationSec?: number }, withLength: boolean): ProgramCopy | null`. `useProgramCopies` la usa con la cascada de hoy.
  - `useSelectionCopies(tracks: TrackItem[], enabled: boolean): ReadonlyMap<string, { ref: LibraryCopyRef; patch: Partial<TrackItem> }>`. Por pista: Music si `replaceCandidate` no es ambiguo y `appleMusicEntryLocation` dio ruta (una consulta por `persistentId`); si no, el primer programa DJ con `programCopyOf(..., true)`. Solo cuenta la coincidencia por longitud, porque con varias pistas no se mide y la longitud es lo que deja fuera otra versión. Sin «Another version» medido, una copia que no se lee falla en su pista con el error de siempre.
  - `processAll(..., copies?: ReadonlyMap<...>, libraryAction?: LibraryCopyAction)`. Por cada id con copia: con `'update'`, el cuerpo de `updateLibraryCopy` sin su propio `begin/endConversionBatch` (va dentro del lote); con `'replace'`, `updateTrack(id, patch)` antes de `runOne`. El resto, `runOne` como hoy.
  - `ConvertFooter` pasa la oferta también con varias. `name` es el programa si todas las copias están en uno; si no, `tr('editor.librarySectionTitle')`. `format` va vacío y el encabezado muestra solo el nombre. `held` es `false` y `better` es `false`.

- [ ] **Step 1: Escribir los tests que fallan**:
  - `it('finds the same copy for one track as the editor does')` en `programCopyOf`.
  - `it('keeps a copy of another length out of a selection, where nothing is measured')`.
  - `it('updates the tracks that have a copy and converts the rest')` en `processAll`: dos pistas, una con copia. Hay un trabajo con `tagsInPlace` y otro de conversión normal.
  - `it('stamps each replaced track with its own copy before converting it')`.
  - `it('no longer holds back a selection that mixes copies and new tracks')` en `convertGate`, que sustituye al test del bloqueo mixto. Se avisa antes, como dice la nota de arriba.
  - En `Editor.test.tsx`, `it('offers the same two actions over several tracks')`: con dos pistas con copia en rekordbox, el menú tiene `library-copy-update` y `library-copy-replace`.
- [ ] **Step 2:** lanzar esos ficheros con `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <rutas>`. Fallan.
- [ ] **Step 3: Implementar**, empezando por la extracción de `programCopyOf` en un commit propio sin cambio de conducta (`Share the library lookup of one track's DJ copies`).
- [ ] **Step 4:** pasan. Repetir las Tasks 8 y 9 sobre lo nuevo: mutar `withLength` a `false` y ver caer «keeps a copy of another length…».
- [ ] **Step 5:** commit `Apply Update or Replace to every selected track that has a library copy`.
- [ ] **Step 6: Prueba a mano**, con la copia de `master.db`: una selección de tres pistas, dos con copia en rekordbox y una sin. Con Update, las dos copias cambian de etiquetas sin renombrarse y la tercera se convierte. Con Replace, las dos sustituyen y la tercera se añade. El `shasum` del `master.db` original sigue igual.
