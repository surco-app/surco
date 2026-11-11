# Ajustar rejilla en lote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajustar la rejilla (el Auto del editor) a varias pistas a la vez desde el panel de Cues, solo las que lo necesitan, apartando las que el ajuste estropearía, y que el filtro «Rejilla mal» cuente exactamente esas.

**Architecture:** Un criterio único y puro en `shared/gridCheck.ts` (desfase inicio/final + veredicto). Un ajuste puro por pista en `renderer/src/lib/gridAdjust.ts` que aplica `autoFitGrid` + la acción `fit-grid` de `reduceDraft` y decide ajustada / bien / revisar. Un orquestador async (`lib/cueGridBatch.ts`) que lee cada pista, aplica la misma puerta que el editor y deja borradores en `cueSession`. La medida para filtro y recuento pasa de main (`cues:gridVerdict`) al renderer (`trackCues` + `gridFit`), para medir el borrador y reaccionar a la tolerancia.

**Tech Stack:** Electron, React 19, TS, TanStack Query, Vitest + Testing Library, i18next (6 idiomas), Biome.

**Spec:** `docs/superpowers/specs/2026-11-11-rejilla-en-lote-design.md`

## Global Constraints

- Worktree `.claude/worktrees/rejilla-lote`, rama `rejilla-lote`. No mergear a main hasta probarlo en la app real.
- Tests desde `apps/desktop`: `npx vitest run <ruta>`. Nunca desde la raíz del repo.
- Tipos: `npx tsc --noEmit -p tsconfig.web.json` y `npx tsc --noEmit -p tsconfig.node.json` (el `tsc` pelado no comprueba nada). Lint: `npm run lint`.
- TDD con fase roja vista. Cada test nuevo se valida rompiendo la implementación a propósito y viéndolo fallar.
- Cero comentarios nuevos en el código. `data-testid` en todo lo nuevo; selectores de test por `data-testid`.
- Textos en `de, en, es, fr, ja, pt-BR`. Sin guion largo ni dos puntos de explicación en la UI.
- Mocks de `window.api` tipados: `vi.fn<Api['cues']['metodo']>()`.
- Commits: solo título descriptivo en inglés, sin prefijo, una funcionalidad por commit.
- Tolerancia: `settings.cueGridTolerance` (5, 10 o 20 ms; por defecto `DEFAULT_CUE_GRID_TOLERANCE` = 10).
- `zones` = `programOf(contentId) === 'rekordbox'`, como el editor. Playhead del lote y del filtro = 0.

## Review Focus

1. **Pista ajustada y luego guardada.** Tras guardar, la rejilla del programa es la ajustada y no hay borrador; el filtro debe dejar de contarla sin reiniciar. Test en Task 4 (invalida `trackCues` tras guardar y la cuenta baja).
2. **Relanzar «Ajustar» sobre las mismas pistas.** Las ya ajustadas (borrador) cuentan como «Ya estaban bien» y no se vuelven a tocar. Test en Task 3.
3. **Selección con pistas de Serato o sin analizar.** No rompen el lote; cuentan como «Sin golpes que medir». Test en Task 3.
4. **Cambiar la tolerancia en Ajustes con el filtro encendido.** El recuento cambia sin volver a pedir `gridFit`. Test en Task 4.
5. **Deshacer tras retocar una en el editor.** La retocada se queda; las demás vuelven. Test en Task 3.

---

### Task 1: Criterio único de «necesita ajuste»

**Files:**
- Create: `apps/desktop/src/shared/gridCheck.ts`
- Test: `apps/desktop/src/shared/gridCheck.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx:530-536` (el `needsFix` del editor usa el criterio)

**Interfaces:**
- Produces:
  - `interface GridCheck { hereMs: number; endMs: number; worstMs: number; verdict: GridVerdict | null }`
  - `checkGrid(input: { beats: number[]; kicks: number[]; fit: GridFit; atMs: number; durationMs: number }): GridCheck` — `hereMs/endMs` de `gridOffsets(beats, fit, atMs, durationMs, kicks)`, `worstMs = max(|hereMs|, |endMs|)`, `verdict = gridVerdictOf(beats, fit)`.
  - `needsGridFix(check: GridCheck, toleranceMs: number): boolean` — `worstMs > toleranceMs || verdict !== null`.

- [ ] **Step 1: Tests** (`gridCheck.test.ts`), con un `GridFit` sintético a 145 BPM (periodo 413,8 ms) y rejillas desplazadas:
  - `it('flags a grid 102 ms off the kicks, which the old verdict missed')` — rejilla a 145 BPM desplazada +102 ms → `needsGridFix(check, 10) === true`, `check.worstMs` ≈ 102 (±2).
  - `it('leaves a grid within tolerance alone')` — desplazada 7 ms → `false` con tolerancia 10, `true` con 5.
  - `it('flags a drifting grid even when start and end sit inside tolerance')` — fit con `phases` que dan deriva ≥ 3 ms/min y desfase final ≤ 10 → `verdict.kind === 'drifting'` y `needsGridFix === true`.
- [ ] **Step 2:** `npx vitest run src/shared/gridCheck.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar `checkGrid` y `needsGridFix`. En `CuesSection` sustituir `offsets`/`needsFix` por `checkGrid({ beats: ctx.beats, kicks: programBeats, fit: gridFit, atMs: playheadMs, durationMs: read.durationMs })` y `needsGridFix(check, tolerance)`; `offsets` sigue disponible como `check` para sus otros usos.
- [ ] **Step 4:** `npx vitest run src/shared/gridCheck.test.ts src/renderer/src/components/CuesSection (todos los CuesSection.*.test.tsx)` → PASS. Romper `needsGridFix` (quitar el `|| verdict`) y ver fallar el test de deriva; restaurar.
- [ ] **Step 5:** Commit `Judge whether a grid needs fixing from its start and end offsets and its drift in one shared place`.

### Task 2: Ajuste puro de una pista con guardas

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/gridAdjust.ts`
- Test: `apps/desktop/src/renderer/src/lib/gridAdjust.test.ts`

**Interfaces:**
- Consumes: `checkGrid`, `needsGridFix` (Task 1); `autoFitGrid`, `gridBeats` (`shared/gridEdit`); `reduceDraft`, `CueDraft`, `DraftContext` (`lib/cueDraft`).
- Produces:
  - `type GridReview = { kind: 'tempo'; heardBpm: number; programBpm: number } | { kind: 'cueJump'; ms: number } | { kind: 'noBetter'; beforeMs: number; afterMs: number }`
  - `type GridAdjustResult = { kind: 'fine' } | { kind: 'adjusted'; draft: CueDraft } | { kind: 'review'; reason: GridReview }`
  - `adjustGrid(input: { draft: CueDraft; ctx: DraftContext; fit: GridFit; kicks: number[]; durationMs: number; toleranceMs: number; zones: boolean }): GridAdjustResult`

Orden: `before = checkGrid(beats de draft.grid)`; si `!needsGridFix(before)` → `fine`. `grid = autoFitGrid(draft.grid, fit, 0, kicks, zones)`; `next = reduceDraft(draft, { type: 'fit-grid', grid, beats: gridBeats(grid, durationMs).map(b => b.ms) }, ctx)`. Movimiento de cada cue = `next.cues` vs `draft.cues` por `key`; medio tiempo = la mitad de la distancia entre los dos beats de la rejilla de antes que rodean al cue. Si algún movimiento la supera → `review` con `tempo` cuando `|fit.bpm − draft.grid.bpm| / draft.grid.bpm ≥ 0.01` (el `SAME_TEMPO_RATIO` de `gridEdit`; exportarlo), si no `cueJump` con el mayor movimiento. Después `after = checkGrid(nuevas beats)`; si `needsGridFix(after)` o `after.worstMs >= before.worstMs` → `review` `noBetter`. Si no → `adjusted`.

- [ ] **Step 1: Tests**, cada uno con el caso medido que lo motiva en el nombre:
  - `it('fixes a grid 102 ms late and carries its cues about 100 ms, like Alfonso Nicolás')` — 145 BPM, desfase 102, cues en beats → `adjusted`; cues movidos ≈ −102; la guarda de medio tiempo (207 ms) NO salta.
  - `it('sets aside a track whose heard tempo disagrees with the program, like Club Robbers')` — rejilla 145 con 3 zonas, fit 137,9 → `review` `tempo` con `heardBpm` 137,9 y `programBpm` 145; el borrador de entrada no cambia (misma referencia).
  - `it('sets aside a track the fit does not improve, like Then Jerico')` — caso donde `after.worstMs >= before.worstMs` → `review` `noBetter` con `beforeMs`/`afterMs`.
  - `it('leaves a grid already on the kicks untouched so a rerun never churns zones')` → `fine`.
  - `it('keeps locked loops in place')` — un cue en `draft.locked` no se mueve en `adjusted`.
- [ ] **Step 2:** `npx vitest run src/renderer/src/lib/gridAdjust.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `adjustGrid` en `lib/gridAdjust.ts`; exportar `SAME_TEMPO_RATIO` de `shared/gridEdit.ts`.
- [ ] **Step 4:** PASS. Mutar: subir la guarda a 1 tiempo y ver fallar Club Robbers; bajarla a 1/8 y ver fallar Alfonso. Restaurar.
- [ ] **Step 5:** Commit `Fit one track's grid to its kicks and set it aside when the fit would move cues by half a beat or not help`.

### Task 3: Lote, sesión, puerta compartida y deshacer

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/cueGridBatch.ts`, `apps/desktop/src/renderer/src/lib/gridGate.ts`
- Modify: `apps/desktop/src/renderer/src/lib/cueSession.ts` (almacén de resultados), `apps/desktop/src/renderer/src/components/CuesSection.tsx:515-528` (usar `gridGate`), `apps/desktop/src/renderer/src/hooks/useTrackCues.ts` (exportar `gridFitQuery`)
- Test: `apps/desktop/src/renderer/src/lib/cueGridBatch.test.ts`, `apps/desktop/src/renderer/src/lib/gridGate.test.ts`

**Interfaces:**
- Consumes: `adjustGrid`, `GridAdjustResult`, `GridReview` (Task 2); `AutoMarkTarget` (`lib/cueAutoMark`); `keepDraft`, `keptDraftOn`, `cueDraftKey`, `keptOnSurcoGrid`, `forgetDraft` (`lib/cueSession`); `trackCuesQuery`, `queuedCuesQuery`.
- Produces:
  - `gridGate(input: { contentId: string; read: { analysed: boolean; clockLeadMs?: number | null }; grid: EditableGrid | null; onSurcoGrid: boolean }): GridGateKey | null` en `lib/gridGate.ts`, donde `GridGateKey` es la clave i18n que hoy elige `CuesSection` (`fixedGrid`, `editor.cues.grid.unmeasured`, `.provisional`, `.surcoDraft`, `.varying`). `read.analysed === false` → `.provisional`. El editor pasa `tr(gridGate(...))`. Cambio de comportamiento nulo en el editor.
  - `gridFitQuery(contentId: string)` = `{ queryKey: ['rekordbox-grid-fit', contentId], queryFn, staleTime: Infinity }`; `useGridFit` lo usa.
  - En `cueSession`: `type GridAdjust = { kind: 'adjusted'; before: CueDraft | null; after: CueDraft } | { kind: 'fine' } | { kind: 'review'; reason: GridReview | { kind: 'gate'; key: GridGateKey } } | { kind: 'unmeasured' }`; `keepGridAdjust(contentId, a)`, `forgetGridAdjust(contentId)`, `gridAdjusts(): ReadonlyMap<string, GridAdjust>`, `useGridAdjusts()`; `resetCueSession` las vacía. Mismo patrón que `keepAutoMark`/`useAutoMarks`.
  - `adjustGrids(client: QueryClient, targets: AutoMarkTarget[], settings: { cueGridTolerance: number; cueFlows; cueQuantize; cueLettersByTime }): Promise<void>` en `lib/cueGridBatch.ts`. Por pista: lee `trackCues`, `queued`, `gridFit`; borrador = `keptDraftOn(...) ?? startDraft(baseline, flow, locks, editableGridOf(read.grid), read.gridFingerprint)` (como `CuesSection`, no como `acceptOne`, que no pasa la rejilla); `gridFit` null o `!read.analysed` o Serato → `unmeasured`; `gridGate` no null → `review` `gate`; si no, `adjustGrid`. `adjusted` → `keepDraft` con el mismo `target`/`base` que `acceptOne` y `keepGridAdjust(... before: borrador previo o null, after)`. Cede el hilo entre pistas como `autoMarkTracks`.
  - `undoGridAdjusts(contentIds: string[]): void` — por cada `adjusted` cuyo borrador actual (`keptDrafts()`) sea `===` `after`: si `before` → vuelve a guardarlo con `keepDraft`, si no → `forgetDraft`. Las demás no se tocan. Luego `forgetGridAdjust`.

- [ ] **Step 1: Tests** (`cueGridBatch.test.ts`, `window.api` tipado con `installApi`):
  - `it('adjusts only the tracks that need it and leaves the rest without a draft')` — 3 pistas: una desplazada 102 ms, una bien, una Club Robbers → `adjusted`, `fine`, `review tempo`; `unsavedCueTracks()` contiene solo la primera.
  - `it('counts an already adjusted track as fine on a second run instead of touching it again')`.
  - `it('measures a Serato or unanalysed track as unmeasured without failing the batch')`.
  - `it('adjusts on top of an unsaved draft, as Auto marcar does')` — borrador previo con un cue movido a mano; tras el ajuste ese cue sigue y la rejilla cambia.
  - `it('undoes every adjusted track except one retouched in the editor')` — retocar = `keepDraft` con otro valor; tras `undoGridAdjusts`, esa conserva su borrador y la otra vuelve a no tener.
  - `gridGate.test.ts`: `it('closes the grid where the editor closes Auto')` — un caso por clave.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Sustituir el bloque `gridOff` de `CuesSection` por `gridGate`.
- [ ] **Step 4:** `npx vitest run src/renderer/src/lib src/renderer/src/components/CuesSection (todos los CuesSection.*.test.tsx)` → PASS. Mutar `undoGridAdjusts` para que ignore la comparación por referencia y ver fallar el test de la retocada.
- [ ] **Step 5:** Commit `Adjust the grid of every selected track that needs it into unsaved drafts, with undo`.

### Task 4: Medida del filtro en el renderer con el mismo criterio

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useGridChecks.ts` (sustituye a `useGridVerdicts.ts`)
- Delete: `apps/desktop/src/renderer/src/hooks/useGridVerdicts.ts` y su test; `cues:gridVerdict` en `preload/cues.ts`, `preload/api.ts`, `main/cuesIpc.ts`, `gridVerdict` de `main/cueSource.ts` y de cada `*CueSource.ts`, y `main/gridVerdictCache.ts` con su test, si tras el cambio nadie los usa (`grep -rn gridVerdict src` lo confirma).
- Modify: `apps/desktop/src/renderer/src/lib/triage.ts` (`FilterFacts.gridVerdict` → `gridCheck`), `apps/desktop/src/renderer/src/lib/gridNote.ts`, `apps/desktop/src/renderer/src/App.tsx:2075-2125`
- Test: `apps/desktop/src/renderer/src/hooks/useGridChecks.test.ts`, `lib/triage.test.ts`, `lib/gridNote.test.ts`

**Interfaces:**
- Consumes: `checkGrid`, `needsGridFix` (Task 1); `gridGate`, `gridFitQuery` (Task 3); `keptDrafts`, `subscribeCueDrafts`.
- Produces:
  - `useGridChecks(entries: [string, string][], active: boolean): { checkOf(trackId: string): GridCheck | null | undefined; done: number; total: number }` — mismo contrato de carga que `useGridVerdicts` (nada hasta `active`, 2 workers, caché de módulo, `resetGridChecks()` para tests). Cada worker trae `trackCues` y `gridFit` por `queryClient.fetchQuery` (comparte caché con el editor). `checkOf` calcula al vuelo con la rejilla del borrador si existe (`gridBeats(draft.grid, read.durationMs)`), si no la guardada; `kicks` = rejilla guardada; `atMs` 0. `null` = medida sin necesidad o con puerta cerrada; `undefined` = sin medir.
  - `FilterFacts.gridCheck: (track) => GridCheck | null | undefined`; `badGrid` cuenta y filtra con `needsGridFix(check, facts.gridTolerance)`.
  - `gridNote(check: GridCheck, tr, language)`: con `verdict` igual que hoy; sin él, nota `shifted` con el desfase de mayor valor absoluto (`hereMs` o `endMs`, con signo) y los textos `trackList.gridEarly/gridLate` existentes.

- [ ] **Step 1: Tests**:
  - `useGridChecks.test.ts`: portar los de `useGridVerdicts.test.ts` (nada hasta activo, 2 workers, `done/total`); y `it('measures the unsaved draft so an adjusted track leaves the filter before saving')`; `it('recounts when tolerance changes without asking for the fit again')` (el `gridFit` mock se llama una vez por pista); `it('drops a track from the count once its saved grid is the adjusted one')` (invalidar `trackCues` con la rejilla nueva y sin borrador).
  - `triage.test.ts`: `it('counts as bad grid exactly the tracks the batch would adjust')` — una de 102 ms (sin veredicto) y una con deriva → `badGrid === 2`.
  - `gridNote.test.ts`: `it('notes a 102 ms shift the old verdict could not see')` → texto `+102 ms`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar; en `App` cambiar `useGridVerdicts` por `useGridChecks`, `gridVerdict:` por `gridCheck:` y `gridNoteOf` para pasar el check. Borrar lo que quede sin uso.
- [ ] **Step 4:** `npx vitest run` (suite entera desde `apps/desktop`) + los dos `tsc` + `npm run lint` → verde.
- [ ] **Step 5:** Commit `Measure the bad grid filter in the renderer with the shared criterion so it sees large shifts and unsaved drafts`.

### Task 5: Bloque «Rejilla» del panel de varias pistas

**Files:**
- Create: `apps/desktop/src/renderer/src/components/GridBatchBlock.tsx`
- Modify: `apps/desktop/src/renderer/src/components/CuesBatchSection.tsx` (lo monta debajo de Auto marcar), `apps/desktop/src/renderer/src/components/Editor.tsx` (props), `apps/desktop/src/renderer/src/App.tsx` (callbacks), `i18n/locales/{de,en,es,fr,ja,pt-BR}.json` bajo `editor.cues.gridBatch`
- Test: `apps/desktop/src/renderer/src/components/GridBatchBlock.test.tsx`

**Interfaces:**
- Consumes: `useGridChecks` (Task 4) para el recuento previo, `adjustGrids`, `undoGridAdjusts`, `useGridAdjusts` (Task 3), `needsGridFix`.
- Produces: `GridBatchBlock({ targets, checkOf, onShowInList, onOpen }: { targets: AutoMarkTarget[]; checkOf: (contentId: string) => GridCheck | null | undefined; onShowInList: () => void; onOpen: (contentId: string) => void })`. En App: `onShowInList` = `setFilterSelection({ ...filterSelection, attention: 'badGrid' })`; `onOpen` = seleccionar solo esa pista (como un clic en su fila).

Pantallas y textos (es; traducir a los otros 5), tal cual el boceto `UjrkExMgfLSakgtxuQqDgZ`:
- Título `Rejilla`; enlace `Verlas en la lista` (`data-testid="grid-batch-show"`).
- Midiendo: `Midiendo la rejilla… {{done}} de {{total}}`; botón deshabilitado.
- Medido: `{{count}} de {{total}} no van con los golpes. Las otras {{rest}} ya están bien y no se tocan.` (plurales `_one/_other`). Si 0: `Todas van con los golpes.` y sin botón.
- Botón primario `Ajustar {{count}} pista` / `Ajustar {{count}} pistas` (`grid-batch-adjust`), con el icono de rejilla.
- Tras ajustar, recuento como `cues-batch-tally` (`grid-batch-tally`): `Ajustadas`, `Ya estaban bien`, `Sin golpes que medir`, `Para revisar a mano` (este en `text-warn`).
- Caja `Surco no las ha tocado` (`grid-batch-review`), una fila por apartada (`grid-batch-review-{contentId}`) con su etiqueta, el motivo y botón `Abrir` (`grid-batch-open-{contentId}`). Motivos: `tempo` → `Surco oye {{heard}} BPM y {{program}} dice {{bpm}}` (BPM con 1 decimal, formateado por idioma; `program` = nombre del programa como en `LIBRARY_NAME`); `cueJump` → `Un cue se movería {{ms}} ms`; `noBetter` → `El ajuste no la mejora`; `gate` → el texto de la clave del editor.
- Enlace `Deshacer el ajuste` (`grid-batch-undo`).
- El guardado es el botón `cues-batch-save` que ya existe; no se añade otro.
- No se muestra con todas las pistas en Serato.

- [ ] **Step 1: Tests** (`GridBatchBlock.test.tsx`):
  - `it('offers to adjust only the tracks that need it')` — 3 targets, 1 necesita → botón `Ajustar 1 pista`.
  - `it('waits while measuring so nobody adjusts half a playlist')` — un check `undefined` → botón deshabilitado y texto de progreso.
  - `it('lists Club Robbers with the tempo Surco hears and the one rekordbox says')` — tras `adjustGrids` con reason `tempo` → fila con `137,9` y `145`.
  - `it('opens a set-aside track in the editor')` — clic en Abrir → `onOpen(contentId)`.
  - `it('turns on the bad grid filter from the panel')` → `onShowInList` llamado.
  - Las claves nuevas existen en los 6 idiomas (el test de claves del repo solo compara es/en: añadir las 6 a mano y comprobarlo con `grep`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar y montar; cablear props por `Editor` hasta `App`.
- [ ] **Step 4:** Suite entera + `tsc` ×2 + lint → verde.
- [ ] **Step 5:** Commit `Add a grid block to the multi-track cues panel that adjusts the tracks that need it and lists the ones set aside`.

### Task 6: Prueba en la app real

- [ ] **Step 1:** Con la skill `run-desktop` (desde este worktree), abrir rekordbox › `Warm Up`, seleccionar las 13, comprobar `6 de 13` (o lo que mida hoy), ajustar, ver el recuento y que «Rejilla mal» cuenta lo mismo que el bloque.
- [ ] **Step 2:** Seleccionar `Sesión del 11-10` y comprobar que Club Robbers aparece en «Para revisar a mano» con `137,9` y `145`, sin borrador.
- [ ] **Step 3:** Deshacer, y comprobar que no queda nada sin guardar. **No guardar** en su rekordbox sin que el usuario lo pida.
- [ ] **Step 4:** Informar al usuario con capturas; no mergear.
