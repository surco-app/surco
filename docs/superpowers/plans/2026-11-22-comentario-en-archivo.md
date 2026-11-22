# Frases en el comentario del archivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Guardar N comentarios» escribe las frases también en la etiqueta Comentario del archivo (sin convertir), con un botón partido para elegir destino («Archivo y rekordbox» / «Solo en rekordbox») y modo («Delante del comentario» / «Sustituir el comentario»).

**Architecture:** La composición del comentario pasa a una función pura con modo (`phrasedComment`). El renderer guarda las dos preferencias en Settings, recompone la vista previa del formulario al cambiar de modo y manda modo y destino a `cues:saveComments`. El main sigue encolando la op `comment` de rekordbox (ahora con modo) y, si toca, reescribe solo la etiqueta Comentario con `rewriteTagFields` (TagLib, sin ffmpeg), pasa el análisis guardado a la fecha nueva del archivo y avisa a la firma de fechas; el renderer relee esas filas.

**Tech Stack:** Electron + React 19 + TS, node-taglib-sharp, Vitest, i18next (8 locales).

**Spec:** Boceto aprobado https://claude.ai/artifact/YDHPpfgMsMJqEKgTphUycL (variante 2 con vista previa al momento) y memoria `comentarios-solo-rekordbox.md`.

## Global Constraints

- Por defecto: destino «Archivo y rekordbox», modo «Delante del comentario». Las dos elecciones se recuerdan (Settings).
- «Sustituir» en rekordbox conserva el bloque de My Tags `/* … */`: `2 - 8 · /* Base / Melodia */`. Sin bloque, queda solo el recuento `2 - 8`.
- Separador ` · ` (el de `shared/phraseCount.ts`).
- Escribir en el archivo NO recodifica, NO renombra, NO toca otros campos ni frames DJ (cues de Traktor/Serato). Solo `rewriteTagFields`.
- Escribir la etiqueta NO debe provocar reanálisis de lo derivado del audio (norma «no forzar reanálisis»). Lo derivado de etiquetas (lectura de metadatos) SÍ debe releerse.
- Con «Archivo y rekordbox», tras guardar el campo Comentario de Surco enseña el comentario nuevo (ya no vuelve al anterior). Con «Solo en rekordbox» se mantiene la vuelta al anterior de hoy.
- Al cambiar el modo en el menú con comentarios pendientes, el campo Comentario se actualiza al momento.
- Sin comentarios en el código. Selectores de test por `data-testid`. Títulos de commit descriptivos, sin cuerpo ni prefijos.
- Copy sin «—» ni dos puntos de explicación; tuteo en todos los idiomas.
- Textos es/en fijados abajo; ca, de, fr, it, ja, pt-BR los traduce el implementador con el mismo sentido.

| clave (`editor.cues.batch.*`) | es | en |
|---|---|---|
| `saveComments_one` | Guardar {{count}} comentario | Save {{count}} comment |
| `saveComments_other` | Guardar {{count}} comentarios | Save {{count}} comments |
| `commentsWhere` (aria-label del chevron) | Opciones de guardado | Save options |
| `commentsToFile` | Archivo y rekordbox | File and rekordbox |
| `commentsRekordboxOnly` | Solo en rekordbox | Only in rekordbox |
| `commentsPrepend` | Delante del comentario | Before the comment |
| `commentsReplace` | Sustituir el comentario | Replace the comment |

## Review Focus

1. **FLAC**: TagLib escribe `tag.comment` de Xiph como DESCRIPTION; Surco lee y escribe COMMENT (`setFlacComment`, `tags.ts:404-420`). El campo nuevo debe acabar en COMMENT y quitar DESCRIPTION, o Surco/rekordbox leerán el viejo. Test de ida y vuelta en Task 2.
2. **MP3 con TXXX "comment"** (espejo de ffmpeg): si queda, mp3tag enseña dos comentarios. El escritor quita el TXXX como `writeTags` (`TXXX_NATIVE_MIRRORS`). Test en Task 2.
3. **Archivo que cambió entre leer y escribir**: `setOne` solo escribe si el valor actual coincide con `from`; el main lee el comentario del archivo justo antes y lo usa como `from`. Si no coincide, ese archivo cuenta como fallido, no se pisa. Test en Task 4.
4. **Carpeta sin permiso / NAS que falla**: ese archivo falla, los demás siguen, rekordbox se guarda igual, el botón enseña el error de siempre y los fallidos siguen pendientes. Test en Task 4 y Task 6.
5. **Comentario con My Tags y «Sustituir»** en rekordbox: no se pierde el bloque `/* */`; y un comentario del archivo sin bloque queda solo con el recuento. Test en Task 1.

---

### Task 1: `phrasedComment` con modo

**Files:**
- Modify: `apps/desktop/src/shared/phraseCount.ts`
- Test: `apps/desktop/src/shared/phraseCount.test.ts`

**Interfaces:**
- Produces: `export type CommentMode = 'prepend' | 'replace'` y `export function phrasedComment(comment: string, count: string, mode: CommentMode): string`. `withPhraseCount` se queda (lo usa `planComment` y App) y equivale a `phrasedComment(c, n, 'prepend')`.

- [ ] **Step 1: Tests que fallan**

```ts
describe('phrasedComment', () => {
  it('prepends like withPhraseCount so today’s saves keep working', () => {
    expect(phrasedComment('Remix vinilo 2019', '2 - 8', 'prepend')).toBe('2 - 8 · Remix vinilo 2019')
    expect(phrasedComment('1 - 4 · Remix vinilo 2019', '2 - 8', 'prepend')).toBe('2 - 8 · Remix vinilo 2019')
  })
  it('replaces the whole comment with the count when asked, as Enrique wants', () => {
    expect(phrasedComment('Remix vinilo 2019', '2 - 8', 'replace')).toBe('2 - 8')
    expect(phrasedComment('', '2 - 8', 'replace')).toBe('2 - 8')
  })
  it('keeps rekordbox’s My Tags block on replace, so the tags still show in its comment', () => {
    expect(phrasedComment('Remix vinilo 2019 /* Base / Melodia */', '2 - 8', 'replace')).toBe('2 - 8 · /* Base / Melodia */')
    expect(phrasedComment('1 - 4 · Remix /* Base */', '2 - 8', 'replace')).toBe('2 - 8 · /* Base */')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/shared/phraseCount.test.ts` desde `apps/desktop` → FAIL (`phrasedComment` no existe).
- [ ] **Step 3:** Implementar. `replace`: buscar el último bloque `/\/\*[\s\S]*?\*\/\s*$/`; si existe, `${count}${SEPARATOR}${bloque.trim()}`, si no `count`. `prepend`: delegar en `withPhraseCount`.
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `Compose a phrase count comment that replaces the old one while keeping rekordbox's My Tags block`

### Task 2: Escribir solo la etiqueta Comentario en el archivo

**Files:**
- Modify: `apps/desktop/src/main/tagFieldSet.ts`
- Test: `apps/desktop/src/main/tagFieldSet.test.ts` (si no existe, el test de `setTagFields` que haya; buscar `setTagFields(` en `*.test.ts`)

**Interfaces:**
- Produces: `TagFieldChange.field` pasa a `ReviewWriteField | 'comment'` (exportar `type TagWriteField = ReviewWriteField | 'comment'`). `setTagFields(file, [{ field: 'comment', from, to }])` y por tanto `rewriteTagFields` aceptan el comentario. `ReviewWriteField` de `shared/types.ts` NO cambia.

- [ ] **Step 1: Tests que fallan** (fixtures sintéticos como los del resto del fichero; leer con el lector de Surco `readTagLibFields`/el que usen los tests vecinos):
  - `writes the comment of an mp3, m4a, aiff and wav and reads back the new one`: para cada formato, `setTagFields(f, [{field:'comment', from:'Remix', to:'2 - 8 · Remix'}])` → `['written']` y el lector devuelve `comment === '2 - 8 · Remix'`; título, artista y frames de cues iguales que antes.
  - `writes a flac comment to COMMENT and drops DESCRIPTION, the field Surco and rekordbox read`: Xiph con COMMENT=`Remix` → tras escribir, `COMMENT` = nuevo y sin `DESCRIPTION`.
  - `drops the TXXX comment mirror on an mp3 so mp3tag does not list two comments`: MP3 con COMM y TXXX "comment" → tras escribir no queda TXXX "comment".
  - `leaves the file alone when its comment is no longer the one read`: `from:'Otro'` → `['unchanged']` y el archivo sin tocar.
- [ ] **Step 2:** Ejecutar el fichero de test → FAIL.
- [ ] **Step 3:** Añadir `'comment'` en `valuesOf` (`tag.comment`), `assign` (Id3v2: `tag.comment = to` y `setUserText(id3,'comment','')` de `tags.ts`, exportándolo si hace falta; Xiph: como `setFlacComment`), `INFO_IDS.comment = ['ICMT']`, `TAGLIB_INFO_ID.comment = 'ICMT'`. Ajustar los `Record<ReviewWriteField, …>` del fichero a `TagWriteField`.
- [ ] **Step 4:** Fichero de test → PASS; `npx tsc -p tsconfig.node.json --noEmit` limpio.
- [ ] **Step 5:** Commit `Rewrite only a file's comment tag, in the frame every DJ program reads`

### Task 3: Pasar el análisis a la fecha nueva

**Files:**
- Modify: `apps/desktop/src/main/analysisCache.ts` (OJO: tiene bytes NUL; editar con un comando de shell que conserve la codificación, no con Edit/Write)
- Create: `apps/desktop/src/main/carriedAnalysis.ts`
- Test: `apps/desktop/src/main/analysisCache.test.ts`, `apps/desktop/src/main/carriedAnalysis.test.ts`

**Interfaces:**
- Produces: `export async function carryAnalysis(inputPath: string, fromMtimeMs: number, toMtimeMs: number, namespaces: readonly string[]): Promise<void>` en `analysisCache.ts` (copia cada entrada `keyFor(ns, path, from)` a `keyFor(ns, path, to)`; best-effort, una entrada que falta se salta). `export const AUDIO_ONLY_NAMESPACES: readonly string[]` en `carriedAnalysis.ts`.

- [ ] **Step 1: Tests que fallan**
  - `analysisCache.test.ts` › `carries an entry to the file's new date so a tag-only rewrite does not re-measure`: `cachedAnalysis('ns', f, compute)` con mtime A; `carryAnalysis(f, A, B, ['ns'])`; con mtime B `cachedAnalysis` devuelve el valor sin llamar a `compute`.
  - `… does not carry a namespace it was not given, so tag reads are read again`: con `['otro']`, en mtime B `compute` sí se llama.
  - `carriedAnalysis.test.ts` › `never carries a tag read, which would show the old comment`: `AUDIO_ONLY_NAMESPACES` no contiene ningún valor que empiece por los prefijos de `readMetaNamespace`/`readMetaLightNamespace`, y sí contiene `LOUDNESS_NAMESPACE`, `WAVEFORM_NAMESPACE` y el del espectro.
- [ ] **Step 2:** Ejecutar ambos → FAIL.
- [ ] **Step 3:** Implementar `carryAnalysis` (copiar también el `.verdict.json` si existe). `AUDIO_ONLY_NAMESPACES` con las constantes de namespaces de audio: `LOUDNESS_NAMESPACE`, `WAVEFORM_NAMESPACE`, `FINGERPRINT_NAMESPACE`, `CHANNELSCAN_NAMESPACE`, `CLICKS_NAMESPACE`, `CUE_WAVE_FINE_NAMESPACE`, `CUE_WAVE_WORDS_NAMESPACE` y el del espectro (`'spectrogram-mono-v31'` hoy literal en 3 sitios: exportarlo como constante desde su módulo y usarla en esos 3). Si importar alguno arrastra `electron` a un chunk del worker, dejarlo fuera y anotarlo en el informe (solo se recalculará ese). Los namespaces dinámicos (`ns(...)` de normalización, `${GRID_AUDIT_NAMESPACE}-${grid}`) quedan fuera y se recalculan.
- [ ] **Step 4:** Ambos → PASS.
- [ ] **Step 5:** Commit `Carry a file's audio analysis to its new date after a tag-only rewrite`

### Task 4: `cues:saveComments` con modo y archivo

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:2033` (`SaveCommentRequest`), `apps/desktop/src/main/rekordboxQueueOps.ts:70` (`CommentOp`), `apps/desktop/src/main/rekordboxPlaylistWrite.ts:386` (`planComment`), `apps/desktop/src/main/cuesIpc.ts:143`, `apps/desktop/src/main/index.ts` (registro de `registerCuesIpc`, ~1693), `apps/desktop/src/preload/api.ts:110`, `apps/desktop/src/preload/cues.ts:20`
- Create: `apps/desktop/src/main/commentFileWrite.ts`
- Test: `apps/desktop/src/main/commentFileWrite.test.ts`, `apps/desktop/src/main/rekordboxPlaylistWrite.test.ts`, `apps/desktop/src/main/cuesIpc.test.ts` (o donde se pruebe `cues:saveComments` hoy)

**Interfaces:**
- Consumes: `phrasedComment`, `CommentMode` (Task 1); `rewriteTagFields` con `field:'comment'` (Task 2); `carryAnalysis`, `AUDIO_ONLY_NAMESPACES` (Task 3).
- Produces:
  - `SaveCommentRequest` gana `mode: CommentMode`. `CommentOp` gana `mode: CommentMode`.
  - `window.api.cues.saveComments(items: SaveCommentRequest[], toFile: boolean): Promise<{ failed: string[] }>` — `failed` = `path` de los archivos que no se pudieron escribir (vacío si `toFile` es false).
  - `writeCommentToFile(path: string, count: string, mode: CommentMode, deps: CommentFileDeps): Promise<boolean>` en `commentFileWrite.ts`, con `CommentFileDeps = { allowed(path): boolean; readComment(path): Promise<string>; mtime(path): Promise<number>; rewrite(path, changes: TagFieldChange[]): Promise<{ outcomes: FieldWrite[] }>; carry(path, from, to): Promise<void>; noteWritten(path): Promise<unknown> }`.

- [ ] **Step 1: Tests que fallan**
  - `rekordboxPlaylistWrite.test.ts` › `replaces rekordbox's comment but keeps its My Tags block when the op asks to replace`: Commnt `Remix /* Base */`, op `{count:'2 - 8', mode:'replace'}` → Commnt `2 - 8 · /* Base */`. Y el caso `prepend` existente sigue pasando con `mode:'prepend'`.
  - `commentFileWrite.test.ts`:
    - `writes the composed comment over the one on disk and carries the analysis to the new date`: `readComment`→`'Remix'`, `mtime` A luego B → `rewrite` recibe `[{field:'comment', from:'Remix', to:'2 - 8 · Remix'}]`, `carry(path, A, B)` y `noteWritten(path)` llamados, devuelve `true`.
    - `refuses a file outside the folders Surco may touch`: `allowed`→false → `rewrite` no se llama, devuelve `false`.
    - `reports a file whose comment changed under it as not written`: `rewrite`→`{outcomes:['unchanged']}` con `'Remix'`≠`to` → devuelve `false`, sin `carry`.
    - `does nothing when the comment already says it`: `readComment`→`'2 - 8 · Remix'` → `rewrite` no se llama, devuelve `true`.
    - `reports a rewrite that throws as not written`: `rewrite` lanza → `false`.
  - IPC: `saves rekordbox comments and writes the files when asked` (con `toFile:true` encola las ops con `mode` y llama a `writeCommentToFile` por item; devuelve `{failed}` con los que dieron `false`) y `leaves files alone when only rekordbox is asked` (`toFile:false` → ninguna escritura, `{failed:[]}`).
- [ ] **Step 2:** Ejecutar los tres ficheros → FAIL.
- [ ] **Step 3:** Implementar. `planComment` usa `phrasedComment(current, op.count, op.mode)`. `writeCommentToFile` en el orden de los tests. En `cuesIpc`, el handler recibe `(items, toFile)`, encola como hoy (con `mode`) y, si `toFile`, escribe los archivos uno a uno (secuencial: NAS) vía un `host.writeCommentToFile` inyectado. En `index.ts` cablear las deps: `allowed: mediaAccess.isAllowed`, `readComment` con el lector TagLib de Surco en el worker (el mismo que da `comment` en `tagLibFieldsOf`), `mtime: fileSignatures.fresh`, `rewrite: (f, c) => rewriteTagFields(f, c, <tmp tracking>, followLibrarySize)` como en `listReviewWiring.ts:38`, `carry: (p,a,b) => carryAnalysis(p,a,b,AUDIO_ONLY_NAMESPACES)`, `noteWritten: fileSignatures.changed`.
- [ ] **Step 4:** Los tres → PASS. Tras `npx electron-vite build`, `grep -l 'from "electron"\|electron-log' out/main/chunks/*.js` vacío (trampa del worker).
- [ ] **Step 5:** Commit `Save phrase comments to the file's comment tag as well as rekordbox, replacing or prepending`

### Task 5: Preferencias en Settings

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (Settings, junto a `matchingDismissed` ~269), `apps/desktop/src/main/settings.ts` (defaults ~117 y `mergeSettings` ~427), `apps/desktop/src/renderer/src/test/api.ts:65`
- Test: `apps/desktop/src/main/settings.test.ts`

**Interfaces:**
- Produces: `Settings.commentsToFile: boolean` (por defecto `true`) y `Settings.commentsReplace: boolean` (por defecto `false`). Sincronizados (no van a la lista de locales).

- [ ] **Step 1: Test que falla** `defaults phrase comments to the file and rekordbox, prepended, and repairs a hand-edited value`: settings vacíos → `commentsToFile === true`, `commentsReplace === false`; `{commentsToFile: 'x'}` → `true`; `{commentsReplace: 'x'}` → `false`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Normalizar en `mergeSettings` como `cueFlowToRekordbox` (`!== false`) y `commentsReplace` con `=== true`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `Remember where phrase comments are saved and whether they replace the comment`

### Task 6: Botón partido, vista previa al momento y relectura

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CuesBatchSection.tsx:83-135, 334-362`, `apps/desktop/src/renderer/src/components/Editor.tsx:255-256, 1921-1922`, `apps/desktop/src/renderer/src/App.tsx:3266-3303, ~5151`, `apps/desktop/src/renderer/src/lib/phraseCountBatch.ts`, los 8 `renderer/src/i18n/locales/*.json`
- Test: `apps/desktop/src/renderer/src/components/CuesBatchSection.test.tsx`, `apps/desktop/src/renderer/src/App.test.tsx` (los casos de frases existentes)

**Interfaces:**
- Consumes: `phrasedComment`, `CommentMode` (Task 1); `saveComments(items, toFile) → {failed}` (Task 4); `commentsToFile`, `commentsReplace` (Task 5).
- Produces (props nuevas, App → Editor → CuesBatchSection):
  - `onPhrases: (mode: CommentMode) => Promise<{done; skipped; comments: PhrasedComment[]}>` (antes sin argumento).
  - `onRecomposeComments: (comments: PhrasedComment[], mode: CommentMode) => PhrasedComment[]` — rehace `after` desde `before` y actualiza el campo de las pistas cuyo comentario sigue siendo el `after` anterior.
  - `onCommentsSaved: (comments: PhrasedComment[], toFile: boolean) => void` — con `toFile` relee del disco esas filas (`refreshChangedTrack` de `useTrackLibrary`); sin `toFile` hace lo de `onRestoreComments` hoy (que se queda para Descartar).
  - `onSaveSettings: (patch: Partial<Settings>) => void` (App pasa `saveSettingsStable`).

- [ ] **Step 1: Tests que fallan** (`CuesBatchSection.test.tsx`, data-testid nuevos `cues-batch-comments-options`, `cues-batch-comments-to-file`, `cues-batch-comments-rekordbox-only`, `cues-batch-comments-prepend`, `cues-batch-comments-replace`):
  - `saves to the file and rekordbox by default`: tras poner frases y pulsar `cues-batch-comments-save`, `saveComments` recibe items con `mode:'prepend'` y `toFile:true`; el botón dice «Save 2 comments».
  - `asks rekordbox only when picked and remembers it`: abrir `cues-batch-comments-options`, pulsar `cues-batch-comments-rekordbox-only` → `onSaveSettings({commentsToFile:false})`; con `commentsToFile:false` en settings, guardar manda `toFile:false` y llama a `onCommentsSaved(…, false)`.
  - `shows the replaced comment in the form the moment Replace is picked`: con comentarios pendientes, pulsar `cues-batch-comments-replace` → `onRecomposeComments(pending,'replace')` y `onSaveSettings({commentsReplace:true})`; el guardado siguiente manda `mode:'replace'`.
  - `keeps the files that failed pending and says so`: `saveComments`→`{failed:[pathB]}` → aparece `cues-batch-comments-failed` y el botón dice «Save 1 comment».
  - Menú: items `role="menuitemradio"` con `aria-checked`, dos grupos separados por una línea, teclado de `useSplitMenu`.
  - App: `App.test.tsx` › `after saving to the file the comment field shows the phrases instead of going back`: tras guardar con `toFile:true` el campo `comment` de la pista es el `after` (no el `before`).
- [ ] **Step 2:** Ejecutar los dos ficheros desde `apps/desktop` (sin filtrar por ruta desde la raíz) → FAIL.
- [ ] **Step 3:** Implementar. Botón partido pequeño con las clases `PRIMARY` del fichero y `useSplitMenu`; el chevron con `aria-label={tr('editor.cues.batch.commentsWhere')}`; el ancho del botón no cambia al abrir el menú ni al guardar. Las claves de la tabla de Global Constraints en los 8 locales (quitar «en rekordbox» de `saveComments_*`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `Choose in a split save button whether phrase comments go to the file and whether they replace the comment`

### Task 7: Comprobación final

- [ ] Suite entera de escritorio desde `apps/desktop` (`npx vitest run`), código de salida 0, sin «Unhandled Errors».
- [ ] `npx tsc -p tsconfig.web.json --noEmit`, `-p tsconfig.node.json`, `-p tsconfig.scenarios.json`; lint de escritorio y web; build web (pasos de CI antes de main).
- [ ] Prueba en la app empaquetada sin firmar (toca el worker): con un MP3 y un FLAC sintéticos en una biblioteca rekordbox de prueba, poner frases, guardar con «Archivo y rekordbox», comprobar con el lector de Surco y `ffprobe` el comentario nuevo, que el espectro no se recalcula (sin trabajo de análisis nuevo en el registro) y que el campo de Surco enseña las frases. Repetir con «Sustituir» y con «Solo en rekordbox».
- [ ] Medir los 8 idiomas al ancho real del panel: el botón partido y los cuatro items no se cortan.
