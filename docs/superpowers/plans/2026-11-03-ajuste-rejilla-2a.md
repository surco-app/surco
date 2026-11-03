# Ajuste de rejilla, parte 2a (guardar la rejilla en rekordbox)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que "Guardar en rekordbox" escriba la rejilla editada (PQTZ del `.DAT`, cabecera PQT2 del `.EXT`, `djmdContent.BPM`) por la cola existente, con copias de seguridad y sin pisar una rejilla que rekordbox cambió después de leerla.

**Architecture:** La petición de guardado (`SaveCuesRequest`, y con ella `CuesOp`) gana `grid` y `gridFingerprint`, que solo viajan si el borrador cambió la rejilla. `TrackCues` gana `gridFingerprint` (huella de la rejilla leída) y el borrador guarda la de su base. En main, `planCuesOp` comprueba esa huella aparte de la de cues y deja de dar por vacía una operación que solo cambia la rejilla; `applyRekordboxBatch` copia y escribe los ANLZ antes de la transacción de master.db y los restaura si la transacción falla.

**Tech Stack:** Electron, TypeScript, better-sqlite3 (SQLCipher), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-ajuste-rejilla-design.md` · Spike: `docs/superpowers/plans/2026-11-03-ajuste-rejilla-spike.md` · Parte 1: `docs/superpowers/plans/2026-11-03-ajuste-rejilla-1.md`

## Global Constraints

- Mismas reglas que la parte 1: TDD viendo el rojo, sin comentarios, `data-testid`, seis idiomas, títulos de commit en inglés sin prefijo, tests desde `apps/desktop` con `node ../../node_modules/vitest/vitest.mjs run <ruta>`, `tsc` con `tsconfig.web.json` y `tsconfig.node.json`.
- La rejilla solo se escribe en el programa de la pestaña: las peticiones gemelas (`twinRequests`) nunca llevan `grid`.
- Huella de rejilla aparte: un guardado de solo cues nunca se rechaza porque cambió la rejilla, y uno con rejilla se rechaza con `cues-changed` si la rejilla leída ya no es la base del borrador.
- PQTZ: golpes de `gridBeats(grid, durationMs)` con ms redondeados y tempo `round(bpm*100)`. PQT2: solo la cabecera (`pqt2WithGrid`), cuerpo y recuento intactos; si el `.EXT` no tiene PQT2 no se toca.
- `djmdContent.BPM = round(bpm*100)`, con `rb_local_usn` (`takeLocalUsn`) y `updated_at`, como `applyCueChanges`.
- Escritura atómica (temporal + rename) y copia de cada ANLZ con `writeBackup(path, backupOf(path, 'backup'))` antes de escribir.
- La etiqueta BPM del fichero no se toca.
- Traktor y Engine siguen sin guardar rejilla (parte 2b); sus controles siguen deshabilitados.

## Review Focus

1. Pista con rejilla editada en Surco y rekordbox abierto: el guardado espera en la cola y se aplica al cerrar rekordbox, como los cues. Test en tarea 4 (cola) reutilizando el patrón de `rekordboxQueueCues.test.ts`.
2. El DJ cambió la rejilla en rekordbox entre que Surco la leyó y el guardado: se rechaza con `cues-changed`, los ANLZ no se tocan. Test en tarea 3.
3. Fallo de la transacción de master.db después de escribir los ANLZ: los ANLZ vuelven a su copia. Test en tarea 4.
4. `.EXT` ausente o sin PQT2: se escribe el `.DAT` y el guardado sigue. Test en tarea 4.
5. Guardar todas las pistas (`draftsToSave`) con una pista de rejilla cambiada y otra solo de cues: solo la primera lleva `grid`. Test en tarea 2.

---

### Task 1: Huella de la rejilla leída

**Files:**
- Modify: `apps/desktop/src/shared/gridEdit.ts`, `apps/desktop/src/shared/types.ts` (`TrackCues.gridFingerprint: string`)
- Modify: los tres lectores que construyen `TrackCues` (`main/rekordboxCues.ts` `readTrackCues`, `main/traktorCues.ts`, `main/engineCues.ts`) y los literales de `TrackCues` en tests y fixtures que el compilador señale.
- Test: `apps/desktop/src/shared/gridEdit.test.ts`, `apps/desktop/src/main/rekordboxCues.test.ts`

**Interfaces:**
- Produces: `gridFingerprint(grid: { ms: number; beat: number }[]): string` en `gridEdit.ts`; `TrackCues.gridFingerprint`.

- [ ] **Step 1: Tests que fallan.** `gridFingerprint` igual para la misma lista, distinto si un golpe se mueve 1 ms o cambia su número, y `''` para lista vacía. `readTrackCues` de un fixture con PQTZ devuelve `gridFingerprint === gridFingerprint(read.grid)`. Por qué: es lo que detecta que rekordbox cambió la rejilla.
- [ ] **Step 2: Run** ambos ficheros. Esperado: FAIL.
- [ ] **Step 3: Implementar** (`ms|beat` unidos con `;`). Poner el campo en los tres lectores y arreglar los literales que señale `tsc`.
- [ ] **Step 4: Run** los tests y los dos `tsc`. Esperado: PASS y sin errores.
- [ ] **Step 5: Commit** `Fingerprint the beat grid a DJ program holds`.

### Task 2: El borrador manda su rejilla al guardar

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`SaveCuesRequest.grid?: EditableGrid`, `SaveCuesRequest.gridFingerprint?: string`, `QueuedCues.grid?: EditableGrid`)
- Modify: `apps/desktop/src/renderer/src/lib/cueDraft.ts` (`CueDraft.baseGridFingerprint: string`, `startDraft(…, grid, gridFingerprint = '')`, `gridRequestOf(draft): Pick<SaveCuesRequest, 'grid' | 'gridFingerprint'>`)
- Modify: `apps/desktop/src/renderer/src/lib/cueSession.ts` (`draftsToSave`), `apps/desktop/src/renderer/src/components/CuesSection.tsx` (`save`, siembra con `read.gridFingerprint`)
- Test: `cueDraft.test.ts`, `cueSession.test.ts` (o el test que ya cubre `draftsToSave`), `CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `draftGridChanged`, `gridFingerprint` (tarea 1).
- Produces: `gridRequestOf(draft: CueDraft): { grid?: EditableGrid; gridFingerprint?: string }` — vacío si `!draftGridChanged(draft)`, si no `{ grid: draft.grid, gridFingerprint: draft.baseGridFingerprint }`.

- [ ] **Step 1: Tests que fallan.**
  - `gridRequestOf` vacío en un borrador sin cambio de rejilla, y con `grid` y la huella de la base tras `set-grid`.
  - En el maximizado: mover la rejilla y pulsar `cues-save` → la petición de esa pista lleva `grid` y `gridFingerprint` = la huella leída al abrir; solo mover un cue → sin `grid`.
  - Con un flujo que marca gemelas: las peticiones gemelas no llevan `grid`.
  - `draftsToSave` con dos pistas (una con rejilla cambiada, otra solo cues): solo la primera lleva `grid` (Review Focus 5).
- [ ] **Step 2: Run.** Esperado: FAIL.
- [ ] **Step 3: Implementar.** `save()` y `draftsToSave` añaden `...gridRequestOf(draft)` solo a la petición de la propia pista.
- [ ] **Step 4: Run** los tres ficheros. Esperado: PASS.
- [ ] **Step 5: Commit** `Send the edited beat grid with the cues of the track it belongs to`.

### Task 3: Planear la escritura de la rejilla

**Files:**
- Modify: `apps/desktop/src/main/rekordboxPlaylistWrite.ts` (`planCuesOp`, tipo `Planned`)
- Test: `apps/desktop/src/main/rekordboxPlaylistWrite.test.ts` (o el test de cues de la cola que ya construye colecciones con ANLZ: `rekordboxQueueCues.test.ts`)

**Interfaces:**
- Consumes: `CuesOp.grid`, `CuesOp.gridFingerprint`, `TrackCues.gridFingerprint`, `gridBeats`.
- Produces: `Planned.grid?: { beats: { ms: number; beat: number }[]; bpm: number }` (golpes ya redondeados).

- [ ] **Step 1: Tests que fallan.**
  - Op con `grid` y huella vigente y cues iguales a los de rekordbox → planeada (no "aplicada sin cambios"), con `grid.beats` = `gridBeats` redondeado.
  - Op con `grid` y huella vieja → `applied: false`, aviso `cues-changed` (Review Focus 2).
  - Op sin `grid` con la rejilla cambiada en rekordbox → se planea como hoy. Por qué: un guardado de solo cues no depende de la rejilla.
  - Op con `grid` en una pista sin análisis → `cues-changed`.
- [ ] **Step 2: Run.** Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Esperado: PASS.
- [ ] **Step 5: Commit** `Plan a beat grid write and refuse it when rekordbox moved the grid since`.

### Task 4: Escribir los ANLZ y el BPM

**Files:**
- Create: `apps/desktop/src/main/rekordboxGridWrite.ts`
- Modify: `apps/desktop/src/main/rekordboxPlaylistWrite.ts` (`applyRekordboxBatch`), `apps/desktop/src/main/anlzWrite.ts` (`pqt2WithGrid` con lista vacía devuelve la sección intacta)
- Test: `apps/desktop/src/main/rekordboxGridWrite.test.ts`, el test de `applyRekordboxBatch` que ya existe, `anlzWrite.test.ts`

**Interfaces:**
- Consumes: `encodePqtz`, `replaceSection`, `pqt2WithGrid` (parte 1), `writeBackup`, `backupOf`, `takeLocalUsn`, `rekordboxStamp`.
- Produces:
  - `anlzPathsOf(db: Db, shareDir: string, contentId: string): { dat: string; ext: string } | null`
  - `writeGridFiles(paths: { dat: string; ext: string }, grid: { beats: { ms: number; beat: number }[]; bpm: number }): Promise<void>` (copia, temporal + rename)
  - `restoreGridFiles(paths: { dat: string; ext: string }): Promise<void>`
  - `applyGridBpm(db: Db, contentId: string, bpm: number, ctx: { now: Date }): void`

- [ ] **Step 1: Tests que fallan.**
  - `writeGridFiles` sobre un `.DAT`/`.EXT` de fixture: `beatGrid` del `.DAT` = los golpes nuevos; cabecera PQT2 con primer y último golpe nuevos; las demás secciones byte a byte; copia `backup` igual al original.
  - `.EXT` ausente o sin PQT2 → escribe el `.DAT` y no falla (Review Focus 4).
  - `restoreGridFiles` deja los dos ficheros como su copia.
  - `applyGridBpm` → `djmdContent.BPM` = `round(bpm*100)` y `rb_local_usn` sube.
  - `applyRekordboxBatch` con una op de rejilla: escribe ANLZ, cues y BPM; si la transacción falla (forzar con un `contentId` cuya escritura de cues lance, o inyectando el fallo en `deps`), los ANLZ quedan como su copia (Review Focus 3).
  - Con rekordbox abierto la op queda en la cola y se aplica al cerrar (Review Focus 1), con el patrón de los tests de cola de cues.
  - `pqt2WithGrid(section, [], 150)` devuelve la sección intacta.
- [ ] **Step 2: Run.** Esperado: FAIL.
- [ ] **Step 3: Implementar.** En `applyRekordboxBatch`, tras las copias de master.db y antes de `BEGIN`: para cada planeada con `grid`, `writeGridFiles`; en la transacción, `applyGridBpm`; si la transacción lanza, `restoreGridFiles` de las que se escribieron antes de devolver el error de siempre.
- [ ] **Step 4: Run.** Esperado: PASS. Mutación a mano de `writeGridFiles` (sin copia, sin rename, sin PQT2) y ver caer un test por mutante.
- [ ] **Step 5: Commit** `Write the edited beat grid into rekordbox's analysis files and the track's BPM`.

### Task 5: Tras guardar

**Files:**
- Modify (si hace falta): `apps/desktop/src/renderer/src/hooks/useRekordboxQueue.ts`, `CuesSection.tsx`
- Test: `CuesSection.maximized.test.tsx`

- [ ] **Step 1: Test que falla (o que fija lo que ya ocurre, viéndolo fallar con una mutación).** Tras guardar una rejilla movida y releer la pista con la rejilla nueva, la pista no queda "sin guardar", la fila parte de la rejilla nueva y el desfase usa la nueva. Una op en cola con `grid` (`QueuedCues.grid`) siembra el borrador con esa rejilla al volver a la pista.
- [ ] **Step 2-4:** rojo, implementar `QueuedCues.grid` en `rekordbox:queuedCues` y en la siembra, verde.
- [ ] **Step 5: Commit** `Start the draft from the saved or queued beat grid`.

### Task 6: Comprobación

- [ ] Suite entera, los dos `tsc`, lint.
- [ ] App real con el driver sobre un clon APFS de la colección: What's Up → Auto → Guardar en rekordbox. Comprobar en el clon que el `.DAT` tiene la rejilla nueva, el `.EXT` la cabecera nueva y `djmdContent.BPM` el BPM nuevo, y que existe la copia `backup`.
- [ ] Informar y proponer al usuario la prueba en su rekordbox real (con respaldo y sha256) y la del USB en el CDJ.
