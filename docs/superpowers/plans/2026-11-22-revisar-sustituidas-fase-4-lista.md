# Revisar sustituidas, fase 4 (almacén, nodo To review, botón Reviewed y pastilla) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda pista sustituida queda en una lista «To review» en la pestaña de cada programa donde está, con su icono verde o ámbar y una pastilla en el editor, hasta que el DJ guarde sus cues en el editor de una pista o pulse «Reviewed».

**Architecture:** Un almacén JSON en userData (`replaced-tracks.json`), calcado de `matchingStore.ts`, que main rellena al acabar cada sustitución y hace seguir al fichero en conversiones posteriores. El renderer lo lee por IPC con una query (`['replaced-tracks']`) y lo cruza en cliente con «All tracks» de cada programa, igual que Matching fuera de rekordbox. Las dos salidas (guardar cues en `CuesSection`, botón «Reviewed») llaman al mismo `review` del almacén; «Reviewed» devuelve la entrada anterior para Deshacer y ⌘Z.

**Tech Stack:** Electron (main + preload), React 19, TanStack Query, Tailwind v4, lucide-react, i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-revisar-sustituidas-design.md` (secciones 4 a 7). Boceto aprobado: https://claude.ai/artifact/HVQ5KGPJRVDAfXXGP13WTC

## Global Constraints

- Worktree `/Users/vicent/code/surco-revisar-sustituidas`, rama `revisar-sustituidas`. Esta fase empieza con la fase 3 ya mergeada en la rama.
- Tests: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>` (usar `node_modules` del worktree si existe). Mirar SIEMPRE el código de salida y `grep -E "Unhandled|Errors "` en la salida: un Unhandled Error deja la suite en 1 aunque todo pase. Nunca filtrar por ruta desde la raíz del repo.
- Tipos: `cd apps/desktop && npx tsc --build` (cubre tsconfig.web, .node y .scenarios; `tsc` pelado no comprueba nada).
- Lint: `npm run lint -w apps/desktop` y `npm run lint -w apps/web`, enteros, sin avisos.
- TDD: test en rojo primero y verlo fallar por la razón esperada. Los tests explican POR QUÉ importa el comportamiento (nombre del `it` en inglés, con el motivo para el DJ).
- Selectores: `data-testid` > semánticos > texto. Nunca clases CSS.
- Estilo: igualar el código vecino. En este repo la convención son comentarios que explican el porqué (choca con la regla global «cero comentarios»; manda la convención del repo, como pide el brief).
- Un commit por funcionalidad, solo título descriptivo, sin `feat:`/`fix:`, nunca `--no-verify`. Nada de push ni merge en esta fase.
- Fixtures sintéticos, nunca la colección de un DJ.
- UI: minimalista estilo Apple. Filas sin texto, estados como icono con `aria-label`. Ningún estado cambia el ancho de un control (reservar sitio). Iconos de `lucide-react`.
- Textos: 8 catálogos en `apps/desktop/src/renderer/src/i18n/locales` (ca, de, en, es, fr, it, ja, pt-BR; el brief decía 5, son 8 y `keys.test.ts` exige paridad). Tuteo (tú/du/você/tu), sin guion largo ni dos puntos de explicación. fr dice «morceau», it «brano».
- No subir namespaces de caché ni forzar reanálisis. Campos nuevos opcionales.
- Nombre del nodo: en «To review», es «Para revisar», ca «Per revisar», de «Zu prüfen», fr «À vérifier», it «Da rivedere», pt-BR «Para revisar», ja «要確認».

## Review Focus

1. **La lista se vacía mientras está abierta** (último «Reviewed» o último guardado): el nodo se esconde y la vista vuelve al árbol sin el aviso de «playlist borrada» que hoy lanza `useSourceBrowser` cuando un nodo desaparece. Test en Task 4.
2. **Guardar cues saca la pista de la lista con el editor abierto**: la fila desaparece de «To review» mientras el DJ sigue en su editor. Comprobar con gesto real en Task 9 qué hace hoy la app cuando la fila seleccionada sale de una lista de programa; si el editor se cierra o salta de pista, parar y contárselo a Vicent antes de inventar nada.
3. **Reapuntado aún en cola**: con el programa abierto, «All tracks» sigue mostrando la ruta vieja. El nodo casa por `oldPath` y guardar cues desde esa fila (cuyo `cue.path` es la ruta vieja) también la saca. Tests en Task 1 (`review` por `oldPath`) y Task 3.
4. **⌘Z tras «Reviewed» con otra acción de etiquetas detrás en la pila**: mientras el aviso de «Reviewed» está vivo, ⌘Z deshace primero «Reviewed». Al caducar el aviso, ⌘Z vuelve a la pila de etiquetas. Test en Task 8.
5. **Una segunda sustitución de la misma pista**: la entrada nueva reemplaza a la anterior (por `newPath` o porque su `newPath` era la ruta que ahora se sustituye) y vuelve a quedar pendiente en todos los programas. Test en Task 1.

---

## Interfaces de la fase

- **Consumes (fase 3):** de `apps/desktop/src/shared/replaceShift.ts`
  `export type UnmovedReason = 'noMatch' | 'drift' | 'unreadable'` y
  `export type ReplaceShift = { moved: number } | { unmoved: UnmovedReason }`;
  y el campo opcional `replaceShift?: ReplaceShift`, que la fase 3 lleva de `ConversionWritten.replaceShift?` a `ProcessResult.replaceShift?` (`shared/types.ts`), presente en el resultado de un trabajo con `replacesPath`. Nombres confirmados por la fase 3.
- **Produces:** ver el bloque Interfaces de cada tarea. Resumen:
  `shared/toReview.ts` (`TO_REVIEW_ID`, `ReplacedEntry`), `main/replacedStore.ts`, IPC `replaced:list|review|restore`, preload `replacedTracks / reviewReplaced / restoreReplaced`, `hooks/useReplacedTracks.ts`, `lib/toReview.ts`, `lib/shortcutUndo.ts`, `components/ReplacedPill.tsx`, `components/ReplacedReview.tsx`.

---

### Task 1: Almacén de sustituidas en main

**Files:**
- Create: `apps/desktop/src/shared/toReview.ts`
- Create: `apps/desktop/src/main/replacedStore.ts`
- Test: `apps/desktop/src/main/replacedStore.test.ts` (patrón de `main/matchingStore.test.ts`, fichero en `mkdtemp`)

**Interfaces:**
- Consumes: `ReplaceShift` (fase 3); `DjProgram`, `DJ_PROGRAMS` (`shared/djProgram.ts`); `DJ_REACH_SETTINGS` (`shared/djSettings.ts`); `Settings` (`shared/types.ts`).
- Produces:
  ```ts
  // shared/toReview.ts
  export const TO_REVIEW_ID = 'surco:to-review'
  export interface ReplacedEntry {
    newPath: string
    oldPath: string
    replacedAt: number
    shift: ReplaceShift
    pending: DjProgram[]
  }
  // main/replacedStore.ts
  export interface ReplacedStore {
    list(): ReplacedEntry[]
    add(entry: ReplacedEntry): void
    review(path: string, programs?: DjProgram[]): ReplacedEntry | null
    restore(entry: ReplacedEntry): void
    movePath(from: string, to: string): void
  }
  export function createReplacedStore(file: string): ReplacedStore
  export function syncedPrograms(settings: Pick<Settings, 'syncRekordbox' | 'syncEngineDj' | 'syncTraktor' | 'syncSerato' | 'syncVirtualdj'>): DjProgram[]
  export function recordReplacement(store: ReplacedStore, job: { replacesPath?: string }, result: { outputPath: string; skipped?: boolean; replaceShift?: ReplaceShift }, programs: DjProgram[], now: number): void
  export function followReplaced(store: ReplacedStore, job: { inputPath: string }, result: { outputPath: string; skipped?: boolean }, exists: (path: string) => boolean): void
  ```

Reglas que fijan los tests: fichero `{ version: 1, entries }`, releído en cada llamada, escrito a `${file}.tmp` y renombrado; rutas en NFC al guardar y al buscar; entradas mal formadas descartadas al leer (fichero corrupto = lista vacía). `add` reemplaza cualquier entrada cuyo `newPath` sea el `newPath` o el `oldPath` de la nueva. `review` busca por `newPath` u `oldPath`, quita `programs` (todos si no se pasa) de `pending`, borra la entrada si `pending` queda vacío y devuelve la entrada tal como estaba antes (o `null`). `restore` vuelve a escribir la entrada tal cual (reemplazando la de su `newPath`). `movePath` solo reescribe `newPath` (la ruta vieja es la que aún puede verse en una cola). `recordReplacement` no hace nada sin `replacesPath`, con `skipped` o con `outputPath` vacío (solo Apple Music), ni con `programs` vacío; sin `replaceShift` guarda `{ unmoved: 'unreadable' }` (la pista entra igualmente, en ámbar). `syncedPrograms` = `DJ_PROGRAMS` con su ajuste `DJ_REACH_SETTINGS[p].sync` activo.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps a replaced track across restarts, so nothing slips out of the list unreviewed', …)
//   createReplacedStore(file).add(e); expect(createReplacedStore(file).list()).toEqual([e])
it('finds the entry by the old path, which a program still shows while its repoint waits in the queue', …)
//   add({ newPath:'/m/new.flac', oldPath:'/m/old.mp3', … pending:['rekordbox','traktor'] })
//   expect(store.review('/m/old.mp3', ['traktor'])?.pending).toEqual(['rekordbox','traktor'])
//   expect(store.list()[0].pending).toEqual(['rekordbox'])
it('drops the entry once no program is left to review', …)          // review(path) sin programas → list() == []
it('returns the entry as it was, so Undo can put it back whole', …)  // restore(review(path)!) → list() igual que antes
it('treats the two Unicode spellings of an accented name as one file', …) // add NFD, review NFC → encontrada
it('a second replacement of the same track starts the review over in every program', …)
//   add(A newPath '/m/a.flac' pending ['rekordbox']); add(B oldPath '/m/a.flac' newPath '/m/a2.flac' pending [5 programas])
//   expect(list()).toEqual([B])
it('follows the file when a later conversion moves it, without touching the old path', …)
//   movePath('/m/new.flac','/m/new.aiff') → newPath '/m/new.aiff', oldPath '/m/old.mp3'
it('reads a corrupt file as an empty list instead of failing every call', …)
it('records an unmeasured replacement in amber rather than leaving it out', …)
//   recordReplacement(store, {replacesPath:'/m/old.mp3'}, {outputPath:'/m/new.flac'}, ['rekordbox'], 1)
//   expect(list()[0].shift).toEqual({ unmoved: 'unreadable' })
it('records nothing for a plain conversion, a skipped job or a Music-only landing', …) // 3 casos → list() == []
it('only lists the programs whose library follows the file', …)
//   syncedPrograms({ syncRekordbox:true, syncTraktor:true, syncEngineDj:false, syncSerato:false, syncVirtualdj:false }) → ['rekordbox','traktor'] en orden de DJ_PROGRAMS
it('moves the entry when a later job converts the replaced file elsewhere', …)
//   followReplaced(store, {inputPath:'/m/new.flac'}, {outputPath:'/m/new.aiff'}, () => false) → newPath '/m/new.aiff'
//   con exists → true, o skipped → sin cambios
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/replacedStore.test.ts`
Expected: FAIL, `Cannot find module './replacedStore'`.

- [ ] **Step 3: Implement `shared/toReview.ts` and `main/replacedStore.ts`** con las firmas y reglas de arriba, calcando la estructura de `matchingStore.ts` (load con try/catch y filtro de forma, save a tmp + rename, `nfc`).

- [ ] **Step 4: Run to verify they pass** (mismo comando). Expected: PASS, salida sin `Unhandled`.

- [ ] **Step 5: Mutación rápida.** Cambiar `review` para que solo busque por `newPath` y confirmar que el test de la ruta vieja falla; deshacer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/toReview.ts apps/desktop/src/main/replacedStore.ts apps/desktop/src/main/replacedStore.test.ts
git commit -m "Keep replaced tracks in a review store that follows the file"
```

---

### Task 2: IPC, preload, alta al acabar la sustitución y hook del renderer

**Files:**
- Create: `apps/desktop/src/main/replacedIpc.ts`
- Test: `apps/desktop/src/main/replacedIpc.test.ts` (patrón de `matchingIpc.test.ts`)
- Modify: `apps/desktop/src/main/index.ts` (crear el almacén junto a `matchingStore` en :471 con `join(app.getPath('userData'), 'replaced-tracks.json')`; registrar IPC junto a `registerMatchingIpc` en :1572; en el `.then` de :2309, después de `followConversion`, llamar `followReplaced(replacedStore, job, result, existsSync)` y luego `recordReplacement(replacedStore, job, result, syncedPrograms(getSettings()), Date.now())`)
- Modify: `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts` (junto a `matchingPairs`)
- Modify: `apps/desktop/src/renderer/src/test/api.ts` (mocks por defecto)
- Create: `apps/desktop/src/renderer/src/hooks/useReplacedTracks.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts` (tras el `processTrack`, ~:475)
- Test: `apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.ts(x)` (el existente)

**Interfaces:**
- Consumes: `ReplacedStore`, `ReplacedEntry`, `recordReplacement`, `followReplaced`, `syncedPrograms` (Task 1).
- Produces:
  ```ts
  // IPC
  'replaced:list'    () => ReplacedEntry[]
  'replaced:review'  (path: string, programs?: DjProgram[]) => ReplacedEntry | null
  'replaced:restore' (entry: ReplacedEntry) => void
  // preload (window.api)
  replacedTracks: () => Promise<ReplacedEntry[]>
  reviewReplaced: (path: string, programs?: DjProgram[]) => Promise<ReplacedEntry | null>
  restoreReplaced: (entry: ReplacedEntry) => Promise<void>
  // hooks/useReplacedTracks.ts
  export const REPLACED_QUERY = ['replaced-tracks'] as const
  export function useReplacedTracks(): ReplacedEntry[]          // staleTime Infinity, como useMatchingPathPairs
  export function useReviewReplaced(): {
    review: (path: string, programs?: DjProgram[]) => Promise<ReplacedEntry | null>
    restore: (entry: ReplacedEntry) => Promise<void>
  }                                                              // ambos invalidan REPLACED_QUERY al terminar
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// replacedIpc.test.ts
it('reviews and restores through the renderer, so Undo reaches the file', …)
//   store.add(e); review('/m/new.flac') devuelve e; list → []; restore(e); list → [e]
it('ignores a review that names no path or names programs that do not exist', …)
//   review('', …) y review('/m/new.flac', ['bogus']) → null y la lista intacta
it('ignores a restore whose entry is malformed, so a bad call cannot corrupt the store', …)

// useTrackProcessing.test
it('rereads the review list when a replacement lands, so the new track shows up without a restart', …)
//   processTrack mock → { outputPath:'/m/new.flac', inPlace:false, replaceShift:{ moved: 120 } }
//   expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['replaced-tracks'] })
it('rereads the review list when a conversion moves a file, so the store and the list agree', …)
//   resultado sin replaceShift pero outputPath !== inputPath → misma invalidación
```

- [ ] **Step 2: Run to verify they fail.** Expected: módulo `./replacedIpc` no existe; la invalidación no ocurre.

- [ ] **Step 3: Implement** `registerReplacedIpc(store: ReplacedStore): void` validando argumentos como `matchingIpc.ts` (rutas no vacías, programas dentro de `DJ_PROGRAMS`, entrada con la forma de `ReplacedEntry`); el cableado de `index.ts`, preload y mocks; el hook; y en `useTrackProcessing` invalidar `REPLACED_QUERY` cuando `result.replaceShift` exista o `result.outputPath && result.outputPath !== track.inputPath`.

- [ ] **Step 4: Run to verify they pass** (los dos ficheros). Expected: PASS.

- [ ] **Step 5: `npx tsc --build`** desde `apps/desktop`. Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git commit -m "Record each replacement for review when its job finishes"
```

---

### Task 3: Reglas puras de la lista

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/toReview.ts`
- Test: `apps/desktop/src/renderer/src/lib/toReview.test.ts`

**Interfaces:**
- Consumes: `ReplacedEntry` (Task 1), `ReplaceShift` (fase 3), `SourcePlaylistEntry`, `SaveCuesRequest` (`shared/types.ts`), `programOf` (`shared/djProgram.ts`).
- Produces:
  ```ts
  export function toReviewEntriesFor(all: readonly SourcePlaylistEntry[], replaced: readonly ReplacedEntry[], program: DjProgram): SourcePlaylistEntry[]
  export function replacedEntryOf(replaced: readonly ReplacedEntry[], path: string, program: DjProgram): ReplacedEntry | undefined
  export function savedReviews(reqs: readonly Pick<SaveCuesRequest, 'contentId' | 'path'>[]): [path: string, programs: DjProgram[]][]
  export function shiftLabel(ms: number): string
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('lists a track by its new path or by the old one a queued repoint still shows', …)
it('leaves out the tracks whose review is already done in this program', …)        // pending sin el programa → fuera
it('leaves out a track with no cues here, because there is nothing to review', …)  // preview.cues = [] → fuera; preview ausente → dentro
it('shows each replaced track once even if both paths are in the library', …)      // filas con newPath y oldPath → una, la del newPath
it('puts the unmoved tracks first, then the most recent replacement', …)
//   moved t=3, unmoved t=1, moved t=2 → [unmoved t=1, moved t=3, moved t=2]
it('never lists separators', …)
it('finds the entry for the editor only while this program still has it pending', …) // replacedEntryOf
it('groups a save by track, so twins in other programs leave the list too', …)
//   reqs rekordbox '/m/a.flac' + traktor (contentId de Traktor) '/m/a.flac' + rekordbox '/m/b.flac'
//   → [['/m/a.flac', ['rekordbox','traktor']], ['/m/b.flac', ['rekordbox']]]
it('signs the shift so the DJ sees which way the cues went', …)
//   shiftLabel(120) === '+120 ms'; shiftLabel(-26) === '−26 ms'; shiftLabel(0) === '0 ms'
```

Comparación de rutas en NFC. Para fabricar `contentId` de cada programa en el test, usar los mismos formatos que reconoce `programOf`.

- [ ] **Step 2: Run to verify they fail.** Expected: módulo no existe.
- [ ] **Step 3: Implement** las cuatro funciones.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Mutación.** Invertir el orden ámbar/verde y comprobar que el test de orden falla; deshacer.
- [ ] **Step 6: Commit** `git commit -m "Decide which replaced tracks each program lists for review"`

---

### Task 4: Nodo «To review» en el árbol

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useSourceBrowser.ts` (:166-260 y el efecto de :273-279)
- Modify: `apps/desktop/src/renderer/src/components/SourceTree.tsx` (:391-425 guardas, :534-563 icono)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (pasar `replacedEntries` a `useSourceBrowser`, :799)
- Modify: los 8 catálogos (`sources.toReview`)
- Test: `apps/desktop/src/renderer/src/hooks/useSourceBrowser.test.tsx`, `apps/desktop/src/renderer/src/components/SourceTree.test.tsx`

**Interfaces:**
- Consumes: `useReplacedTracks` (Task 2), `toReviewEntriesFor` (Task 3), `TO_REVIEW_ID` (Task 1).
- Produces: `useSourceBrowser({ …, replacedEntries: ReplacedEntry[] })`; el nodo `{ id: TO_REVIEW_ID, name: tr('sources.toReview'), kind: 'playlist', count }` justo debajo de Recently added (encima de All tracks), solo en programas DJ y solo con `count > 0`; con el nodo abierto, `entries` = `toReviewEntriesFor(allTracks, replacedEntries, program)` (como `otherMatchingOpen`, sin `readPlaylist`).

«All tracks» ya se lee con la query `['source-playlist', source, ALL_TRACKS_ID]` para Matching; ampliar su `enabled` a «hay pares de Matching o alguna entrada del almacén pendiente en este programa», y en rekordbox también.

- [ ] **Step 1: Write the failing tests**

```ts
// useSourceBrowser.test.tsx
it('adds To review right below Recently added, counting the tracks still to review here', …)
//   rekordbox con 2 entradas pendientes que casan → orden [recent, to-review(2), all, …]
it('hides To review when nothing is left to review in this program', …)  // entradas pendientes solo en traktor → sin nodo en rekordbox
it('opens To review with the unmoved tracks first', …)                   // entries del nodo en el orden de Task 3
it('goes back to the tree without a "playlist deleted" notice when the last track is reviewed', …)
//   nodo abierto; replacedEntries pasa a []; expect(onPlaylistGone).not.toHaveBeenCalled(); playlist ya no es TO_REVIEW_ID
// SourceTree.test.tsx
it('never renames, drags or drops onto To review, like the other fixed nodes', …)
it('marks To review with its own icon so it reads as Surco\'s list, not a playlist', …) // data-testid="source-node-review-icon"
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** En `SourceTree.tsx`, tratar `TO_REVIEW_ID` como `recent`/`matching` en `nodeEdit`, `canDrag` y `nodeDragOver`, con icono `History` de lucide (size 13, `text-fg-faint`, `aria-hidden`, `data-testid="source-node-review-icon"`). En el efecto de playlist desaparecida, no avisar si `playlist.id === TO_REVIEW_ID` (sí volver al árbol). Textos `sources.toReview` en los 8 catálogos con los nombres de Global Constraints.
- [ ] **Step 4: Run to verify they pass**, más `src/renderer/src/i18n/keys.test.ts` y `usedKeys.test.ts`.
- [ ] **Step 5: Commit** `git commit -m "Show replaced tracks in a To review node under Recently added"`

---

### Task 5: Icono de estado en las filas del nodo

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/TrackList.tsx` (props :117, :1223, :1570; fila junto a `track-matching` :988)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (junto a `matchingIds`, :3356; prop en :5060)
- Modify: los 8 catálogos (`trackList.cuesMoved`, `trackList.cuesNotMoved`)
- Test: `apps/desktop/src/renderer/src/components/TrackList.test.tsx`

**Interfaces:**
- Consumes: `replacedEntryOf` (Task 3), `TO_REVIEW_ID`, `ReplaceShift`.
- Produces: `TrackList` prop `replacedShifts?: ReadonlyMap<string, ReplaceShift>` (por id de pista); `TrackRow` prop `replaced?: ReplaceShift`. App solo lo rellena con el nodo `TO_REVIEW_ID` abierto (cruzando `track.inputPath` con el almacén para el programa de la pestaña).

Marcado: `CircleCheck` `text-good` o `CircleAlert` `text-warn`, `h-3 w-3`, envuelto en `<span data-testid="track-replaced" data-state="moved|unmoved" role="img" aria-label={…}>`. Sin texto visible. Mismo hueco fijo que `track-matching`.

- [ ] **Step 1: Write the failing tests**

```ts
it('marks a track whose cues Surco moved with the green icon and says so to VoiceOver', …)
//   replacedShifts Map([[id, { moved: 120 }]]) → getByTestId('track-replaced') data-state 'moved', aria-label 'Cues moved'
it('marks a track Surco left alone in amber, so the DJ checks it first', …)       // { unmoved:'drift' } → 'unmoved', 'Cues not moved'
it('shows no review icon outside the list, so other rows stay as they were', …) // sin prop → queryByTestId null
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Textos: en «Cues moved» / «Cues not moved»; es «Cues movidos» / «Cues sin mover»; resto traducido con el mismo sentido.
- [ ] **Step 4: Run to verify they pass** (TrackList y i18n).
- [ ] **Step 5: Commit** `git commit -m "Mark each To review row with a moved or not moved icon"`

---

### Task 6: Pastilla y motivo en el editor

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ReplacedPill.tsx`
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx` (wrapper `CuesSection`, :2272-2479: `status` del `SectionHeader` y el cuerpo plegado; `Editing`: nueva prop y la cabecera maximizada `cues-header`, :1715-1760)
- Modify: los 8 catálogos (`editor.cues.replaced.*`)
- Test: `apps/desktop/src/renderer/src/components/ReplacedPill.test.tsx`, y uno de cableado en `CuesSection.test.tsx`

**Interfaces:**
- Consumes: `useReplacedTracks` (Task 2), `replacedEntryOf`, `shiftLabel` (Task 3), `programOf`.
- Produces:
  ```ts
  export function ReplacedPill({ shift }: { shift: ReplaceShift }): React.JSX.Element   // data-testid="cues-replaced-pill", data-state
  export function ReplacedReason({ shift }: { shift: ReplaceShift }): React.JSX.Element | null // data-testid="cues-replaced-reason"; null si moved
  ```
  En `CuesSection`, `const replaced = replacedEntryOf(useReplacedTracks(), cue.path, programOf(cue.contentId))`, y se pasa a `Editing` como prop `replaced?: ReplacedEntry`.
  - **Sin maximizar:** la pastilla va en `status` del `SectionHeader` junto a las marcas que ya hay (Unsaved/Saved/Provisional); el motivo, debajo de `{body}` y antes de `{footer}`.
  - **Maximizado** (donde el DJ revisa de verdad los cues; ahí el `SectionHeader` no se pinta): la pastilla va en `cues-header`, en la línea de metadatos tras `ProvisionalMark`; el motivo y el botón «Reviewed» de Task 8 van en una fila propia (`data-testid="cues-replaced-row"`) justo debajo de `cues-header`, antes de la onda. Esa fila solo existe si hay entrada, así que no hay estado que cambie anchos dentro de la pista abierta.

Copia fija:
- Pastilla verde: icono `CircleCheck` + `shiftLabel(ms)` (sin traducir). Ámbar: `CircleAlert` + `editor.cues.replaced.notMoved` (en «not moved», es «sin mover»).
- Motivo (en / es):
  - `noMatch`: «The new file's audio doesn't match the old one. Cues left as they were.» / «El audio del fichero nuevo no casa con el del viejo. Los cues siguen como estaban.»
  - `drift`: «The start and the end moved by different amounts. Cues left as they were.» / «El principio y el final se movieron distinto. Los cues siguen como estaban.»
  - `unreadable`: «The old file couldn't be read. Cues left as they were.» / «No se pudo leer el fichero viejo. Los cues siguen como estaban.»
  Texto genérico por motivo, sin duraciones ni cifras (decidido). Antes de cerrar, confirmar que cada frase dice lo cierto para lo que la fase 3 marca con ese motivo (norma «calidad: solo lo cierto»).

- [ ] **Step 1: Write the failing tests**

```ts
it('shows how far the cues moved, signed, so the DJ knows which way', …)        // { moved: 120 } → pill text '+120 ms', data-state 'moved'
it('says not moved in amber with the reason below, so the DJ knows why to check', …)
//   { unmoved:'drift' } → pill 'not moved'; ReplacedReason text = en.editor.cues.replaced.drift
it('gives every unmoved reason its own sentence', …)                             // los 3 motivos → 3 textos distintos, ninguno vacío
// CuesSection.test.tsx
it('shows the pill on a replaced track only while this program still has it to review', …)
//   replacedTracks mock con pending ['rekordbox'] → pill visible; pending ['traktor'] → ausente
it('shows the pill and the reason in the maximized editor too, where the DJ actually checks cues', …)
//   patrón de CuesSection.maximized.test.tsx; { unmoved:'noMatch' } → within(getByTestId('cues-header')) pill 'not moved';
//   getByTestId('cues-replaced-row') contiene cues-replaced-reason
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** (clases de pastilla como las marcas existentes del `SectionHeader`; `text-good` / `text-warn`).
- [ ] **Step 4: Run to verify they pass** (ReplacedPill, CuesSection, i18n).
- [ ] **Step 5: Commit** `git commit -m "Show the measured shift or why cues were not moved in the cue editor"`

---

### Task 7: Salir de la lista al guardar cues en el editor de una pista

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx` (`send`, ~:1145-1167)
- Test: `apps/desktop/src/renderer/src/components/CuesSection.test.tsx`

**Interfaces:**
- Consumes: `useReviewReplaced().review` (Task 2), `savedReviews` (Task 3).
- Produces: nada nuevo; tras un guardado correcto, `send` llama `review(path, programs)` por cada grupo de `savedReviews(reqs)`.

Decisión a la vista del código: no existe «Guardar solo en este programa». `cues-save-this` es «Guardar esta pista» (frente a «Guardar N pistas»). El gancho va en `send`, que es el guardado de `CuesSection` y cubre guardar, guardar esta pista, guardar todas las pistas editadas a mano en este editor, aceptar propuestas de auto cue de esa pista y las copias a gemelas (`twinRequests`). Así cada programa sale solo si se le escribió. Los guardados en lote de `CuesBatchSection` no pasan por aquí y no cuentan. Decisión aceptada por el coordinador; `CuesBatchSection` queda fuera.

- [ ] **Step 1: Write the failing tests**

```ts
it('takes a track out of To review in the program its cues were saved to', …)
//   guardar en rekordbox → window.api.reviewReplaced toHaveBeenCalledWith(cue.path, ['rekordbox'])
it('takes it out of the twin programs the same save wrote to', …)
//   guardado con gemela de Traktor planificada → llamada con (path, ['rekordbox','traktor'])
it('keeps the track in To review when the save failed, since nothing reached the program', …)
//   window.api.cues.save rechaza → reviewReplaced no llamado
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** la llamada tras `forgetDrafts` en `send`, sin esperar a que termine para devolver `true`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Mutación.** Quitar las gemelas de `savedReviews` y comprobar que el segundo test falla; deshacer.
- [ ] **Step 6: Commit** `git commit -m "Take a track out of To review when its cues are saved in the editor"`

---

### Task 8: Botón «Reviewed» con Deshacer y ⌘Z

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/shortcutUndo.ts`
- Test: `apps/desktop/src/renderer/src/lib/shortcutUndo.test.ts`
- Create: `apps/desktop/src/renderer/src/components/ReplacedReview.tsx`
- Test: `apps/desktop/src/renderer/src/components/ReplacedReview.test.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/toastContext.tsx` (`reportUndo` devuelve `() => void` que cierra el aviso; el FALLBACK devuelve un no-op)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (`toastReporter.reportUndo` :476 devuelve `() => dismissToast(store, id)`; `undoMeta` :4120 y `canUndoMeta` :4329)
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx` (render del botón junto al motivo de Task 6, en las dos vistas: plegada y fila `cues-replaced-row` del maximizado)
- Test: `apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx`
- Modify: los 8 catálogos (`editor.cues.replaced.reviewed`, `notices.reviewed`)
- Test: `apps/desktop/src/renderer/src/App.test.tsx` (un test de ⌘Z)

**Interfaces:**
- Consumes: `useReviewReplaced` (Task 2), `useToast` (`lib/toastContext.tsx`), `ReplacedEntry`.
- Produces:
  ```ts
  // lib/shortcutUndo.ts: el Deshacer del último aviso que lo ofrece a ⌘Z
  export function offerShortcutUndo(run: () => void): () => void   // devuelve withdraw; una oferta nueva sustituye a la anterior
  export function takeShortcutUndo(): (() => void) | null           // la saca y la devuelve
  export function hasShortcutUndo(): boolean
  // components/ReplacedReview.tsx
  export function ReviewedButton({ path, name }: { path: string; name: string }): React.JSX.Element // data-testid="cues-reviewed"
  ```
  Flujo del clic, sin confirmación: `before = await review(path)` (todos los programas); si `before`, `dismiss = reportUndo(t('notices.reviewed', { name }), undo, withdraw, 'replaced-reviewed')` y `withdraw = offerShortcutUndo(() => { dismiss(); undo() })`, con `undo = () => { withdraw(); void restore(before) }`. En App: `undoMeta` ejecuta primero `takeShortcutUndo()` si hay y sale; `canUndoMeta = () => hasShortcutUndo() || metaUndo.canUndo()`.

Copia: botón icono `Check` + en «Reviewed», es «Revisada», ca «Revisada», pt-BR «Revisada», de «Geprüft», fr «Vérifié», it «Rivisto», ja «確認済み». Aviso: `notices.reviewed` en «Reviewed · {{name}}», es «Revisada · {{name}}» (resto igual con su palabra). El aviso usa la pila actual (abajo a la izquierda, 288 px), sin tocarla.

- [ ] **Step 1: Write the failing tests**

```ts
// shortcutUndo.test.ts
it('hands ⌘Z the undo of the notice on screen, once', …)        // offer(f); take() === f; take() === null
it('forgets the offer when its notice goes, so ⌘Z returns to tag undo', …) // withdraw(); hasShortcutUndo() false
it('lets a newer notice replace the older offer', …)
// ReplacedReview.test.tsx (ToastProvider con un reportUndo espía)
it('takes the track out of every program at once, with no question asked', …)
//   click cues-reviewed → reviewReplaced toHaveBeenCalledWith('/m/new.flac', undefined); reportUndo llamado con 'Reviewed · Name'
it('puts the track back exactly as it was when the DJ presses Undo', …)
//   onUndo del espía → restoreReplaced toHaveBeenCalledWith(entradaDevuelta)
it('puts it back with ⌘Z too, and closes the notice', …)
//   takeShortcutUndo()!() → restoreReplaced llamado y el dismiss devuelto por reportUndo llamado
// CuesSection.maximized.test.tsx
it('offers Reviewed in the maximized editor, so the DJ can close the review without leaving it', …)
//   maximizado con entrada → getByTestId('cues-reviewed') dentro de cues-replaced-row; click → reviewReplaced(path, undefined)
// App.test.tsx
it('⌘Z undoes Reviewed while its notice is up, before older tag edits', …)
//   ofrecer un undo con offerShortcutUndo(spy) y una edición de etiquetas en la pila; keyDown ctrl+z → spy llamado y la etiqueta sigue cambiada
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** el módulo, el cambio de firma de `reportUndo` (los llamadores actuales ignoran el retorno, no cambian), el botón (solo se pinta si `replacedEntryOf` encuentra entrada para este programa, Task 6) y el cableado de App.
- [ ] **Step 4: Run to verify they pass** (los ficheros nuevos/tocados, `CuesSection.maximized.test.tsx`, `lib/commands.test.ts` y i18n).

Ojo con el foco en maximizado: el `onKey` de `Editing` se queda ⌘Z para el borrador de cues cuando el foco está en el editor. Tras pulsar «Reviewed» el botón desaparece; comprobar en Task 9 que ⌘Z llega al atajo global y deshace «Reviewed», no un paso del borrador. Si no llega, devolver el foco a donde lo deje la app al desmontar el botón y contarlo, sin tocar el `onKey` del borrador.
- [ ] **Step 5: Mutación.** Hacer que `undoMeta` mire la pila de etiquetas primero y comprobar que el test de App falla; deshacer.
- [ ] **Step 6: Commit** `git commit -m "Add a Reviewed button that takes the track out of To review with Undo and ⌘Z"`

---

### Task 9: Anchos en 8 idiomas, suite entera y prueba en la app empaquetada

**Files:** ninguno nuevo salvo arreglos que salgan de aquí (cada uno en su propio commit).

- [ ] **Step 1: Suite entera.** `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run; echo EXIT=$?` y `grep -E "Unhandled|Errors "` sobre la salida. Expected: `EXIT=0`, sin coincidencias. Un test que solo pasa suelto está roto: arreglarlo.
- [ ] **Step 2: Tipos y lint.** `npx tsc --build` (apps/desktop), `npm run lint -w apps/desktop`, `npm run lint -w apps/web`. Expected: sin errores ni avisos.
- [ ] **Step 3: Build.** `cd apps/desktop && PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build` (o `/Users/vicent/code/surco/node_modules/.bin` si el worktree no tiene).
- [ ] **Step 4: Arranque silencioso.** Lanzar siempre por `quiet-launch.mjs` del skill `apps/desktop/.claude/skills/run-desktop` (ventana sin mostrar, nunca activar la app ni saltar de escritorio). Datos: un userData de prueba con `replaced-tracks.json` sintético (una entrada `moved`, una `unmoved: 'drift'`) apuntando a ficheros de una biblioteca de prueba. Usar Traktor o Engine con copia; rekordbox solo con copia y avisando a Vicent antes; nunca su biblioteca real de Music.
- [ ] **Step 5: Medir anchos en los 8 idiomas** (ca, de, en, es, fr, it, ja, pt-BR) al ancho real de la ventana y del editor: nombre del nodo con su recuento en el árbol, pastilla ámbar junto a «Cues» con Unsaved a la vez, botón «Reviewed», aviso con un nombre largo, y el motivo en una línea; todo ello también en el editor maximizado (pastilla en la cabecera con artista, duración, BPM y tono largos; fila de motivo y botón). Nada se corta ni empuja el título; la pastilla no cambia el ancho de la cabecera al aparecer el estado Saved. Capturas por idioma para Vicent.
- [ ] **Step 6: Gestos reales con ratón** (no clics sintéticos del DOM): abrir el nodo, comprobar orden (ámbar arriba), seleccionar una fila, guardar cues y ver que sale de la lista en ese programa y sigue en otro; pulsar «Reviewed», Deshacer en el aviso, otra vez «Reviewed» y ⌘Z, en la vista plegada y en la maximizada; vaciar la lista y ver que vuelve al árbol sin aviso. Anotar qué pasa con el editor cuando la fila seleccionada sale de la lista (Review Focus 2) y contárselo a Vicent.
- [ ] **Step 7: Informe.** Qué se probó a mano y qué solo con tests, decir explícitamente lo que no se pudo probar. No mergear: el trabajo por fases se queda en la rama hasta el final.
