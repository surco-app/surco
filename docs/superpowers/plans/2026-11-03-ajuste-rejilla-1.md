# Ajuste de rejilla, parte 1 (prueba en rekordbox, modelo, codificadores y controles)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprobar que rekordbox acepta una rejilla escrita por Surco y construir todo lo que no depende del refactor por programas: el modelo editable de la rejilla, los codificadores ANLZ, la detección para Auto en rekordbox y la fila de controles con deshacer en el editor maximizado.

**Architecture:** Una rejilla constante `{ bpm, anchorMs }` vive en el borrador de cues (`cueDraft.ts`) y entra en su historial. Las operaciones son funciones puras en `shared/gridEdit.ts`. La fila de controles es un componente nuevo montado dentro de `CueDeck`. Los codificadores PQTZ/PQT2 van en `main/anlzWrite.ts` y se prueban contra los lectores existentes. El guardado, Traktor, Engine, las huellas y la medición de reloj de Traktor/Engine son la **parte 2**, que se escribe cuando el bloque 4 del refactor de Serato esté en main y el spike de la tarea 1 haya salido bien.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library, i18next, Biome.

**Spec:** `docs/superpowers/specs/2026-11-03-ajuste-rejilla-design.md`

## Global Constraints

- Esta rama NO se mergea a main al acabar la parte 1: sin guardado, un cambio de rejilla se perdería al guardar (antiobjetivo). Se mergea con la parte 2.
- Preparación del worktree: enlazar `node_modules` del repo principal (`ln -s /Users/vicent/code/surco/node_modules node_modules` en la raíz del worktree, y lo mismo en `apps/desktop` si el repo principal tiene uno ahí).
- Tests desde `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run <ruta>`. Nunca desde la raíz (salta el setup).
- Tipos: `npx tsc --noEmit -p tsconfig.web.json` y `-p tsconfig.node.json` desde `apps/desktop` (el `tsc` pelado no comprueba nada).
- `npm run lint` sin avisos.
- TDD: ver cada test fallar antes de implementar. Sin comentarios en el código. Selectores `data-testid`.
- Copy en los seis idiomas (`src/renderer/src/i18n/locales/{es,en,de,fr,ja,pt-BR}.json`), sin guion largo ni dos puntos de explicación.
- Commits con título descriptivo en inglés, sin cuerpo, sin prefijos.
- Solo en el maximizado. El editor pequeño no cambia.
- Tocar la rejilla nunca mueve un cue.
- Una rejilla no constante nunca se convierte en constante sin que el DJ lo pida: los controles se deshabilitan.
- Tolerancia de aviso = `cueGridTolerance` (5/10/20, defecto 10 ms).
- Auto solo cambia el BPM si el detectado está a menos del 1 % del actual; si no, solo la fase.
- Auto conserva el golpe 1 del DJ (el nuevo golpe 1 es el detectado más cercano al golpe 1 actual).
- Abrir/cerrar, ×2 y ½ dejan quieto el golpe más cercano al cabezal.
- Paso de mover: 1 ms; con ⇧, 10 ms. Teclas ⌥← / ⌥→ (⌥⇧ para 10 ms).
- Abrir / cerrar: −0,01 / +0,01 BPM.
- En esta parte, Traktor y Engine muestran los controles deshabilitados con el motivo "reloj sin medir" (spec, "Reloj de la onda en Traktor y Engine").

## Review Focus

1. Rejilla de rekordbox con tempos distintos (dos tramos de PQTZ): controles deshabilitados, ningún botón cambia nada. Test en tarea 2 (`editableGridOf` devuelve null) y tarea 6.
2. BPM escrito inválido (vacío, `0`, `abc`, `999`) o con coma decimal (`150,5`): el inválido no cambia la rejilla y la coma se acepta. Test en tarea 5.
3. ×2 o ½ que saca el BPM de 40-300: el botón queda deshabilitado. Test en tarea 5.
4. Mover la rejilla hasta antes del inicio del tema (ancla negativa): la rejilla dibujada sigue empezando en el primer golpe ≥ 0 con la numeración de compás correcta. Test en tarea 2.
5. Cambiar de pista y volver con un cambio de rejilla sin guardar: la rejilla del borrador sigue ahí y ⌘Z la deshace. Test en tarea 6.

---

### Task 1: Spike de escritura en rekordbox (puerta)

Desechable. Nada de esto se commitea salvo el informe.

**Files:**
- Create: `docs/superpowers/plans/2026-11-03-ajuste-rejilla-spike.md` (informe)
- Scripts en el scratchpad de la sesión, nunca en el repo.

- [ ] **Step 1: Respaldo.** Con rekordbox cerrado, copiar `~/Library/Pioneer/rekordbox/master.db`, `master.backup*` y la carpeta `share/` de las pistas elegidas a `~/rekordbox-respaldo-spike-rejilla/` con un `sha256.json`. Mismo patrón que `scratchpad/spike/run.sh` del 22/10 (memory `rejilla-propia-medida`).
- [ ] **Step 2: Documentar PQT2.** Leer 3 `.EXT` reales de su colección y la documentación de Deep Symmetry (dysentery, "Extended Beat Grid") y pyrekordbox. Anotar en el informe la disposición byte a byte de PQT2 y comprobarla contra los PQTZ de las mismas pistas.
- [ ] **Step 3: Caso desplazado.** Elegir What's Up (DJ Tonin) u otra pista WAV analizada. Reescribir PQTZ (y PQT2) moviendo todos los golpes +40 ms, con el mismo número de golpes. Escribir con temporal + rename.
- [ ] **Step 4: Caso BPM.** En otra pista, cambiar el BPM en 0,05 (cambia el número de golpes y el tamaño de la sección) y reescribir PQTZ, PQT2, la longitud de PMAI y `djmdContent.BPM`.
- [ ] **Step 5: Prueba del usuario.** Pedir al usuario que abra rekordbox y mire las dos pistas. Esperado: la rejilla nueva se ve, rekordbox no reanaliza, el BPM de la columna cuadra. Tras cerrar rekordbox, comprobar si reescribió los ANLZ (sha256 antes/después).
- [ ] **Step 6: Restaurar** y verificar sha256 iguales. Borrar copias temporales.
- [ ] **Step 7: Informe y puerta.** Escribir el informe (formato PQT2, resultados de los pasos 3-5). **Si rekordbox rechaza, reanaliza o pisa la rejilla: parar y volver al usuario.** Si sale bien, commit del informe:

```bash
git add docs/superpowers/plans/2026-11-03-ajuste-rejilla-spike.md
git commit -m "Record how rekordbox takes a beat grid written from outside"
```

---

### Task 2: Modelo editable y operaciones

**Files:**
- Create: `apps/desktop/src/shared/gridEdit.ts`
- Test: `apps/desktop/src/shared/gridEdit.test.ts`

**Interfaces:**
- Produces:
  - `interface EditableGrid { bpm: number; anchorMs: number }` (anchorMs es un golpe 1)
  - `GRID_BPM_MIN = 40`, `GRID_BPM_MAX = 300`
  - `editableGridOf(beats: { ms: number; beat: number }[]): EditableGrid | null`
  - `gridBeats(grid: EditableGrid, durationMs: number): { ms: number; beat: number }[]`
  - `shiftGrid(grid: EditableGrid, deltaMs: number): EditableGrid`
  - `retempoGrid(grid: EditableGrid, bpm: number, pivotMs: number): EditableGrid | null` (null fuera de 40-300)
  - `downbeatAt(grid: EditableGrid, ms: number): EditableGrid`
  - `fitGrid(grid: EditableGrid, fit: { bpm: number; firstMs: number }): EditableGrid`
  - `gridOffsets(grid: EditableGrid, fit: { bpm: number; firstMs: number }, playheadMs: number, durationMs: number): { hereMs: number; endMs: number }`

- [ ] **Step 1: Tests que fallan.** En `gridEdit.test.ts`:
  - `editableGridOf` de 400 golpes cada 400 ms desde 46 con beat 1-4 → `{ bpm: 150, anchorMs: 46 }`.
  - Con golpes en ms enteros redondeados de 150,04 BPM (jitter ±1 ms) → `bpm` 150.04.
  - Dos tramos (200 golpes a 150 y 200 a 140) → `null`. Por qué: aplanarlos borra trabajo del DJ.
  - Menos de 2 golpes → `null`.
  - `gridBeats({150, 46}, 2000)` → ms `[46, 446, 846, 1246, 1646]`, beats `[1, 2, 3, 4, 1]`.
  - `gridBeats({150, -354}, 1000)` → empieza en 46 con beat 2. Por qué: mover antes del inicio no puede perder la numeración.
  - `shiftGrid({150, 46}, -10)` → `{150, 36}`.
  - `retempoGrid({150, 0}, 149.99, 4000)`: el golpe en 4000 sigue en 4000 (±0,5 ms) en `gridBeats`.
  - `retempoGrid(…, 301, …)` y `(…, 39, …)` → `null`.
  - `downbeatAt({150, 46}, 1000)` → `gridBeats` tiene un beat 1 en 1000.
  - `fitGrid({150, 46}, {bpm: 150, firstMs: 10})` → `anchorMs` ≡ 10 mod 400 y el más cercano a 46 (→ 10).
  - `fitGrid({150, 46}, {bpm: 300, firstMs: 10})` → bpm sigue 150 (fuera del 1 %), anchorMs alineado a la fase detectada.
  - `fitGrid({150, 46}, {bpm: 150.04, firstMs: 10})` → bpm 150.04.
  - `gridOffsets({150, 46}, {150, 0}, 26500, 345000)` → `{ hereMs: 46, endMs: 46 }`.
  - `gridOffsets({150.01, 0}, {150, 0}, 0, 345000)` → `hereMs` 0 y `endMs` ≈ −23 (±1). Por qué: así se distingue el caso 2 del 1.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/shared/gridEdit.test.ts`. Esperado: FAIL, módulo inexistente.
- [ ] **Step 3: Implementar.** `editableGridOf`: periodo por mínimos cuadrados sobre todos los golpes, constante si todos caen a ≤2 ms de la recta; bpm redondeado a 0,01; ancla = primer golpe con `beat === 1`. Los offsets se miden como diferencia firmada (rejilla − detectada) del golpe más cercano en el cabezal y en `durationMs`.
- [ ] **Step 4: Run** el mismo comando. Esperado: PASS.
- [ ] **Step 5: Commit** `git commit -m "Model a constant beat grid the cue editor can shift, retempo and fit"`.

---

### Task 3: Codificador PQTZ y reemplazo de secciones ANLZ

**Files:**
- Create: `apps/desktop/src/main/anlzWrite.ts`
- Test: `apps/desktop/src/main/anlzWrite.test.ts`

**Interfaces:**
- Consumes: `anlzSections`, `beatGrid` de `main/anlz.ts`; `pqtzSection`, fixtures de `main/anlzFixture.ts` (solo tests).
- Produces:
  - `encodePqtz(beats: { ms: number; beat: number }[], bpm: number): Buffer` (la sección completa, cabecera incluida)
  - `replaceSection(file: Buffer, tag: string, section: Buffer): Buffer` (error si el tag no existe; actualiza la longitud total en PMAI offset 8)

- [ ] **Step 1: Tests que fallan.**
  - `beatGrid(fichero con encodePqtz(...))` devuelve exactamente los golpes y bpm de entrada.
  - `encodePqtz` produce los mismos bytes que `pqtzSection` del fixture para la misma entrada. Por qué: el fixture está validado contra ficheros reales.
  - `replaceSection` con una sección más larga conserva intactas, byte a byte, las secciones anterior y posterior, y `readUInt32BE(8)` = nueva longitud.
  - `replaceSection` con un tag ausente lanza.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/anlzWrite.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** con los offsets del lector existente.
- [ ] **Step 4: Run.** Esperado: PASS.
- [ ] **Step 5: Mutación** de `anlzWrite.ts` con `npm run mutate` (o romper a mano cada campo) y confirmar que algún test cae por cada mutante relevante.
- [ ] **Step 6: Commit** `git commit -m "Encode a rekordbox PQTZ beat grid and swap it into an analysis file"`.

---

### Task 4: Codificador PQT2

**Files:**
- Modify: `apps/desktop/src/main/anlzWrite.ts`, `apps/desktop/src/main/anlz.ts` (lector PQT2 para el round-trip)
- Test: `apps/desktop/src/main/anlzWrite.test.ts`, `apps/desktop/src/main/anlz.test.ts`

**Interfaces:**
- Consumes: el formato documentado en el informe de la tarea 1.
- Produces: `extendedBeatGrid(ext: Buffer): { ms: number; beat: number }[]` en `anlz.ts`; `encodePqt2(beats: { ms: number; beat: number }[], bpm: number): Buffer` en `anlzWrite.ts`.

- [ ] **Step 1: Tests que fallan.** Un `.EXT` real recortado a su sección PQT2 (copiado del spike a un fixture binario pequeño en el árbol de tests): `extendedBeatGrid` coincide con el `beatGrid` del `.DAT` de la misma pista; `encodePqt2(beatGrid(dat), bpm)` reproduce los bytes de la PQT2 real. Por qué: rekordbox lee las dos y deben cuadrar.
- [ ] **Step 2: Run** los dos ficheros de test. Esperado: FAIL.
- [ ] **Step 3: Implementar** según el informe.
- [ ] **Step 4: Run.** Esperado: PASS.
- [ ] **Step 5: Commit** `git commit -m "Read and encode rekordbox's extended PQT2 beat grid"`.

---

### Task 5: Fila de controles de rejilla

**Files:**
- Create: `apps/desktop/src/renderer/src/components/CueGridControls.tsx`
- Test: `apps/desktop/src/renderer/src/components/CueGridControls.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/CueDeck.tsx` (prop opcional `gridControls?: React.ReactNode`, renderizada entre `cues-memory-remove` y `cues-jump` tras un separador)
- Modify: los seis `locales/*.json` (claves `editor.cues.grid.*`)

**Interfaces:**
- Consumes: `EditableGrid`, `shiftGrid`, `retempoGrid`, `downbeatAt`, `fitGrid`, `GRID_BPM_MIN/MAX` de la tarea 2.
- Produces: `CueGridControls(props: { grid: EditableGrid | null; disabledReason: string | null; fit: { bpm: number; firstMs: number } | null; needsFix: boolean; playheadMs: number; onChange: (grid: EditableGrid) => void })`.
- testids: `cues-grid-bpm`, `cues-grid-bpm-menu`, `cues-grid-bpm-input`, `cues-grid-double`, `cues-grid-half`, `cues-grid-left`, `cues-grid-right`, `cues-grid-widen`, `cues-grid-narrow`, `cues-grid-downbeat`, `cues-grid-auto`, `cues-grid` (el grupo, con `aria-disabled` y `title` = motivo cuando está deshabilitado).

- [ ] **Step 1: Tests que fallan.**
  - Con `grid {150, 46}`, `cues-grid-bpm` muestra `150,00` en es y `150.00` en en.
  - `left`/`right` llaman `onChange` con anchorMs 45/47; con ⇧ pulsado, 36/56.
  - `widen`/`narrow` → bpm 149.99/150.01 con el golpe más cercano a `playheadMs` quieto.
  - `downbeat` → `onChange(downbeatAt(grid, playheadMs))`.
  - Menú: escribir `150,5` + Enter → bpm 150.5; `abc`, vacío, `0`, `999` + Enter → no llama `onChange`; Esc cierra sin cambiar.
  - `double` deshabilitado con bpm 175 (350 > 300); `half` deshabilitado con bpm 70 (35 < 40).
  - `auto` con `fit` null → deshabilitado; con `needsFix` true lleva `data-needs-fix="true"`; pulsarlo → `onChange(fitGrid(grid, fit))`.
  - `disabledReason` no nulo → todos los botones deshabilitados y el grupo con `title` = motivo. Por qué: deshabilitado y visible, nunca desaparece.
  - `grid` null → igual que deshabilitado.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/components/CueGridControls.test.tsx`. Esperado: FAIL.
- [ ] **Step 3: Implementar** con los estilos del boceto (botones de icono de 28 px, campo BPM de 62 px, Auto con texto; iconos SVG inline de trazo). Montarlo en `CueDeck` vía `gridControls`.
- [ ] **Step 4: Run** el test nuevo y `src/renderer/src/components/CueDeck.test.tsx`. Esperado: PASS.
- [ ] **Step 5: Run** `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/i18n` (claves es/en). Esperado: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add the grid row beside the cue pads with BPM, nudge, stretch, downbeat and Auto"`.

---

### Task 6: La rejilla en el borrador y en el editor maximizado

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/cueDraft.ts` (campo `grid`, acción `set-grid`, snapshot)
- Modify: `apps/desktop/src/renderer/src/lib/cueKeys.ts` (⌥← / ⌥→)
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx` (siembra, dibujo, controles, desfase en la barra, leyenda de teclas)
- Test: `cueDraft.test.ts`, `cueKeys.test.ts`, `CuesSection.maximized.test.tsx`, `CuesSection.traktor.test.tsx`, `CuesSection.engine.test.tsx`

**Interfaces:**
- Consumes: tarea 2 entera; `CueGridControls` (tarea 5); `gridFit` de la tarea 7 (en esta tarea, mockeado en `window.api`).
- Produces:
  - `CueDraft.grid: EditableGrid | null` y `DraftSnapshot.grid: EditableGrid | null`
  - `startDraft(cues, flowId, locked?, grid?: EditableGrid | null)`
  - `DraftAction` gana `{ type: 'set-grid'; grid: EditableGrid }`
  - `CueKey` gana `{ type: 'grid-shift'; ms: 1 | -1 | 10 | -10 }`
  - testid `cues-grid-offsets` (barra superior), con `cues-grid-here` y `cues-grid-end`.

- [ ] **Step 1: Tests que fallan (borrador y teclas).**
  - `set-grid` cambia `grid`, deja `cues` idéntico (misma referencia) y apila un snapshot; `undo` devuelve la rejilla anterior; `redo` la rehace. Por qué: tocar la rejilla nunca mueve un cue y ⌘Z la deshace.
  - Un `undo` tras `move` de cue y luego `set-grid` deshace primero la rejilla y después el cue.
  - `cueKeyAction({key:'ArrowLeft', altKey:true})` → `grid-shift -1`; con `shiftKey` → `-10`; sin ⌥ sigue siendo `jump` (las flechas siguen moviendo el cabezal).
- [ ] **Step 2: Run** `cueDraft.test.ts` y `cueKeys.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `set-grid` y la tecla. En `cueKeys.ts` la rama `altKey` hoy devuelve null: devolver `grid-shift` para las flechas y null para el resto.
- [ ] **Step 4: Run.** Esperado: PASS. Commit `git commit -m "Keep the beat grid in the cue draft so undo covers it"`.
- [ ] **Step 5: Tests que fallan (editor).** En `CuesSection.maximized.test.tsx`:
  - Pista rekordbox analizada con rejilla constante: `cues-grid` habilitado; pulsar `cues-grid-right` mueve las líneas dibujadas 1 ms y deja la pista sin guardar (`cues-unsaved`), con los cues en el mismo sitio.
  - ⌥→ hace lo mismo que el botón.
  - ⌘Z tras mover la rejilla la devuelve a su sitio.
  - Rejilla de dos tempos: `cues-grid` deshabilitado con motivo.
  - Pista provisional (sin análisis): `cues-grid` deshabilitado con motivo.
  - Con `gridFit` que da 46 ms de desfase: `cues-grid-here` muestra `+46 ms`, Auto con `data-needs-fix="true"`; tras Auto, `+0 ms` y sin `data-needs-fix`.
  - Cambiar a otra pista y volver: la rejilla movida sigue y ⌘Z la deshace (Review Focus 5).
  - Mini (no maximizado): no existe `cues-grid`.
  - En `CuesSection.traktor.test.tsx` y `CuesSection.engine.test.tsx`: `cues-grid` visible y deshabilitado con el motivo de reloj sin medir; no hay `cues-grid-offsets`.
- [ ] **Step 6: Run** los tres ficheros. Esperado: FAIL.
- [ ] **Step 7: Implementar.** Sembrar `grid` con `editableGridOf(read.grid)` al crear el borrador, salvo pista provisional (null). Cuando el borrador tiene rejilla, la que se dibuja y la de `ctx.beats`/`snapTo` sale de `gridBeats(draft.grid, durationMs)`. Motivo de deshabilitado por orden: programa sin reloj medido, provisional, no constante. Desfase visible solo si hay `fit` y rejilla. Añadir ⌥←/⌥→ a la leyenda de teclas.
- [ ] **Step 8: Run** los tres ficheros y toda la carpeta `src/renderer/src/components`. Esperado: PASS.
- [ ] **Step 9: Commit** `git commit -m "Edit the beat grid from the maximized cue editor with its offsets beside the time"`.

---

### Task 7: Detección para Auto en rekordbox

**Files:**
- Modify: `apps/desktop/src/main/rekordboxCuesIpc.ts` (canal `rekordbox:gridFit`)
- Modify: `apps/desktop/src/preload/index.ts`, tipos de `window.api`
- Modify: `apps/desktop/src/renderer/src/hooks/useTrackCues.ts` (`useGridFit(contentId, enabled)`)
- Test: `apps/desktop/src/main/rekordboxCuesIpc.test.ts`, `apps/desktop/src/renderer/src/hooks/useTrackCues.test.ts` (si existe; si no, en el test de la sección)

**Interfaces:**
- Consumes: `host.beatGrid(file)` (ya inyectado, `cachedBeatGrid`), `rekordboxShiftOfFile(file, sampleRate)`, `REKORDBOX_BEAT_AFTER_RISE_MS` de `beatGrid.ts` (exportarla).
- Produces: `window.api.rekordboxGridFit(contentId: string): Promise<{ bpm: number; firstMs: number } | null>`; `useGridFit(contentId: string, enabled: boolean)` con `staleTime: Infinity`, clave `['rekordbox-grid-fit', contentId]`.

- [ ] **Step 1: Tests que fallan.**
  - Pista rekordbox WAV con `fit {150, 10}` y desplazamiento 0 → `{ bpm: 150, firstMs: 12 }` (10 + 2 ms del golpe tras la subida, igual que `provisionalGrid`). Por qué: el mismo reloj que la rejilla provisional, ya validada contra rekordbox.
  - MP3 LAME con desplazamiento 51 → `firstMs` 63.
  - `contentId` de Traktor o Engine → `null` (reloj sin medir).
  - `host.beatGrid` null → `null`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/rekordboxCuesIpc.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** reutilizando la consulta de `rekordbox:surcoGrid` (misma fila de `djmdContent`).
- [ ] **Step 4: Run.** Esperado: PASS.
- [ ] **Step 5:** Cambiar el mock de `gridFit` de la tarea 6 por el hook real en `CuesSection` (solo con el maximizado abierto). Run los tests de la tarea 6. Esperado: PASS.
- [ ] **Step 6: Commit** `git commit -m "Fit the beat grid from the audio on rekordbox's clock for the Auto button"`.

---

### Task 8: Comprobación de la parte 1

- [ ] **Step 1:** Suite entera desde `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run src`. Esperado: todo verde (anotar cuántos).
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.web.json` y `-p tsconfig.node.json`. Esperado: sin errores.
- [ ] **Step 3:** `npm run lint`. Esperado: sin avisos.
- [ ] **Step 4:** App real con el skill `run-desktop`, perfil aislado (`--user-data-dir`), sobre una COPIA de su colección rekordbox: abrir What's Up en el maximizado, ver la fila en una línea, mover, Auto, ⌘Z. Captura para el usuario. No guardar (la parte 1 no guarda).
- [ ] **Step 5:** Informar al usuario de lo hecho, lo verificado y lo que queda para la parte 2: escritura de rekordbox (ANLZ + `djmdContent.BPM` + copias de seguridad), huella de rejilla aparte, Traktor y Engine (escritura, bloqueos, medición de reloj), y el cableado sobre la interfaz por programa del bloque 4.
