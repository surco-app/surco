# Serato fase (d), primer tramo: Serato y Traktor al USB de Pioneer. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportar al USB de Pioneer desde las pestañas Serato y Traktor, con sus crates o playlists, cues, bucles, rejilla y datos, por las mismas pantallas que hoy usan rekordbox y Engine.

**Architecture:** Dos lectores nuevos (`usbExportSerato.ts`, `usbExportTraktor.ts`) devuelven la misma `ExportSelection` que hoy sale de `master.db`, con los cues ya en el reloj de rekordbox y la rejilla en un campo nuevo `ExportTrack.grid`. Cada origen tiene su propia instancia de `createUsbExporter` con su memoria y con las piezas de rekordbox apagadas (sin identidad, sin `.sync`, sin análisis ni carátulas copiados, sin My Settings, sin aviso de rekordbox abierto). El router elige la instancia por `req.source`. El renderer abre el mismo modal con una vista por origen.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Biome, baken 4.6.1.

**Spec:** `docs/superpowers/specs/2026-11-04-serato-fase-d-design.md` (continúa `2026-11-03-serato-cuarto-programa-design.md`).

## Global Constraints

- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato-d`, rama `serato-d`. Código en `apps/desktop/src`. Todos los comandos desde `apps/desktop`.
  - Suite: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`). Nunca filtrar por ruta desde la raíz del repo.
  - Un fichero: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/<fichero>.test.ts`.
  - Tipos: `for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Biome: `/Users/vicent/code/surco/node_modules/.bin/biome check src`.
  - Matriz: `SURCO_MATRIX=1 node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx`; base 131 pasan, 1 saltada, 4 fallos conocidos. Antes de la Tarea 1, apuntar los nombres de esos 4; al cerrar cada tarea deben ser los mismos.
- La exportación desde rekordbox y desde Engine no cambia en nada. Sus tests (`usbExport*.test.ts`, `bakenXml.test.ts`, `bakenRun.test.ts`, `engineUsbExport*.test.ts`, `UsbExportModal.test.tsx`, `useUsbPlan.test.tsx`, `CheckTree.test.tsx`) se quedan como están; solo se añaden tests. Un helper de test puede ensanchar su tipo de parámetro sin tocar lo que afirma.
- Nunca escribir en la biblioteca de Serato ni en la de Traktor, ni en ningún `.sqlite` ni en `master.db`. Los lectores solo leen.
- No tocar `librariesKeepingOriginal`, `retireOriginal`, `RekordboxRepoint.names`, `engineConversionFlusher`, la cola de Engine ni el repoint de Serato.
- TDD rojo-verde. Cero comentarios en el código. Sin `--no-verify`. Commits con título en inglés de una línea, sin prefijo ni cuerpo. No usar `git checkout`/`git stash` con trabajo sin commitear.
- Textos de UI en los 6 idiomas (es, en, de, fr, pt-BR, ja), sin guion largo ni dos puntos de explicación. Mocks de `window.api` con `vi.fn<Api['metodo']>()`. Selectores `data-testid`.
- Valores fijados por la spec y por el código actual:
  - baken exige `TrackID` numérico. `fileType`: `.mp3` 1, `.m4a`/`.mp4` 4, `.flac` 5, `.wav` 11, `.aif`/`.aiff` 12; otra extensión 0.
  - `ExportCue.kind` en la escala de `djmdCue`: 0 memoria, `HOT_KINDS = [1, 2, 3, 5, 6, 7, 8, 9]` para A a H. `outMs` `-1` para un punto, el final para un bucle.
  - `rating` de 0 a 5 (el XML multiplica por 51). `dateAdded` `YYYY-MM-DD`.
  - Exportación sin rekordbox: siempre `--no-settings`, sin `--master-ids`, sin `playlists3.sync`.

## Rulings

Decisiones que el código obliga a tomar y la spec deja al constructor.

- **Ruling:** la petición sigue llevando el origen en `UsbExportRequest.source`, que pasa a `Exclude<DjProgram, 'rekordbox'>`. El formato del USB se deduce del origen (Engine da Engine, el resto da Pioneer) y no viaja en la petición. Así una petición de rekordbox o de Engine es byte a byte la de hoy.
- **Ruling:** el router recorre `DJ_PROGRAMS`. Serato y Traktor son opcionales en `UsbExporters`; un origen sin exportador registrado responde `{ ok: false, reason: 'unsupported' }`.
- **Ruling:** cada origen es una instancia propia de `createUsbExporter`, con su memoria en `usb-serato-exports.json` y `usb-traktor-exports.json`. Una sola instancia con dependencias por petición obligaría a reescribir `usbExport.ts`.
- **Ruling:** `identity` puede devolver `null`. Sin identidad, el exportador no lee el `playlists3.sync` del USB, no da `DeviceId` a baken, no escribe ficheros `.sync` y el aviso final lleva `syncFiles: true`. Justo antes de la exportación real borra `playlists3.sync` y `playlists3Plus.sync` además de los dos temporales de hoy, para que rekordbox no tome las playlists de Serato por las suyas (sus `Dev_ID` señalarían a las de baken). `bakenArgs` no cambia, así que `--keep-rekordbox-ext` sigue; la prueba manual mira qué pasa con `exportExt.pdb`.
- **Ruling:** el ID de pista es FNV-1a de 32 bits sobre la ruta en NFC, llevado a `1..2_000_000_000`; si dos rutas chocan, la segunda toma el siguiente libre por orden de aparición. Es estable entre exportaciones, así que `removedSinceLast` sigue contando bien, y una ruta en NFD y en NFC da el mismo ID.
- **Ruling:** reloj. rekordbox ms = Surco ms + `rekordboxShiftOfFile(file, sampleRate)`, la misma conversión de `rekordboxCueSource.surcoGrid`. Serato parte de su `trackCues` (ya en reloj de Surco). Traktor guarda sus posiciones en su reloj, con `traktorLeadOfFile` como desfase: delta = shift − lead. Con lead `null` la pista va sin cues ni rejilla y se marca `cuesLeftOut` solo si tenía algún cue o rejilla.
- **Ruling:** Serato y Traktor dan una rejilla de un solo tempo, así que el BPM de toda la rejilla es la media de sus intervalos y baken recibe un único `TEMPO`. Un beat que tras el cambio de reloj queda antes de 0 se descarta; un cue se fija en 0.
- **Ruling:** Traktor no parte de `trackCues`, que no da los cues sin botón ni el final de los bucles. Lee los `CUE_V2` del `ENTRY` con `traktorCueElements`. Letras como en Surco: `HOTCUE` n de 1 a 7 da `HOT_KINDS[n - 1]`. `HOTCUE` 0 (el cue que Traktor pone al cargar) y −1 van como cues de memoria. `TYPE` 4 es la rejilla y no es un cue. `TYPE` 5 con `LEN` > 0 es bucle hasta `START + LEN`. El nombre `n.n.` (el vacío de Traktor) se escribe vacío.
- **Ruling:** Serato no tiene cues de memoria. Sus hot cues van por letra y sus bucles guardados como bucles de memoria (`kind` 0).
- **Ruling:** árbol de Serato. Una carpeta marcada (nodo `folder`, sin `.crate` propio) incluye todo lo de dentro, como hoy en rekordbox. Un crate marcado incluye solo sus pistas propias. Un crate con subcrates pasa a carpeta con su nombre y su ID; dentro va primero su playlist propia, solo si está marcado y tiene pistas, y después sus subcrates marcados. Un subcrate marcado solo cae igualmente en la carpeta de su padre.
- **Ruling:** datos de Serato. Título, artista, álbum, género, clave, BPM y fecha de alta salen de `database V2`; duración y frecuencia de muestreo salen de la lectura de la etiqueta que ya se hace para los cues. Año, sello y valoración se dejan vacíos o a 0. Una pista de un crate que `database V2` no tiene toma de título el nombre del fichero sin extensión. La ruta es la de `database V2` si la tiene, si no la del crate.
- **Ruling:** datos de Traktor. `TITLE` y `ARTIST` del `ENTRY`; `ALBUM TITLE` y `TRACK`; de `INFO`: `GENRE`, `LABEL`, `COMMENT`, `KEY`, `REMIXER`, `MIX`, `PLAYCOUNT`, `PLAYTIME` (segundos), `BITRATE` / 1000 redondeado, `RANKING` / 51 redondeado, año del primer tramo de `RELEASE_DATE`, `IMPORT_DATE` `y/m/d` a `YYYY-MM-DD`; `TEMPO BPM`. Una fila cuya pista no está en la colección se deja fuera. Los separadores de Traktor no se detectan (van como la pista corta que son).
- **Ruling:** el aviso de CDJ-2000 por alta resolución funciona en Serato por la frecuencia de la etiqueta. En Traktor solo por FLAC, porque la colección no guarda la frecuencia. `bitDepth` queda a 0 en los dos.
- **Ruling:** en el modal, Serato y Traktor no muestran la casilla de My Settings ni la de borrar del USB. La exportación nunca lleva `--prune` desde ellos: borrar música del USB no está en la spec y es destructivo.
- **Ruling:** el `holder` de cada USB para Serato o Traktor se calcula con su propia memoria (`stickHolder` con su `pdb`). Si el USB lo escribió rekordbox, el aviso `rekordboxExport` sale también desde Serato, y es verdad.
- **Ruling:** `CheckTree` trata como desplegable cualquier nodo con hijos, sea `folder` o `playlist`; marcarlo marca su familia, como una carpeta. Solo Serato tiene playlists con hijos, así que rekordbox, Engine y Traktor no cambian.
- **Ruling:** el test de `App.test.tsx` "offers no USB export from the Traktor tree…" afirmaba la decisión que esta spec cambia. Se sustituye por el contrario. No es un test de la exportación de rekordbox ni de Engine.
- **Ruling:** el exportador de Serato solo se registra en macOS (Serato en Windows sigue fuera, como en la fase c). El de Traktor, en las dos plataformas.
- **Ruling:** el resumen relee etiquetas y colección en cada cálculo, sin caché. La prueba manual mide cuánto tarda con la biblioteca de pruebas.

## Review Focus

- Rutas con acentos en NFD (macOS) en un crate y en NFC en `database V2`, o al revés: debe ser la misma pista, con sus datos de `database V2` y un solo ID. Test en Task 3 y Task 4.
- MP3 o M4A de Traktor cuyo desfase no está medido: va sin cues ni rejilla y el plan lo cuenta aparte, pero solo si llega al USB. Test en Task 2 y Task 5.
- Crate con subcrates y pistas propias: carpeta con su playlist propia primero y los subcrates dentro; un subcrate marcado solo queda dentro de la carpeta del padre; el modal deja abrirlo y marcarlo. Test en Task 4 y Task 7.
- La misma pista en dos crates o dos playlists: un solo ID y una sola entrada en la colección del XML. Test en Task 3, Task 4 y Task 5.
- Una pista que ya no está en disco: el lector no falla, la pista sale en el plan como "no se encuentra el fichero" y no cuenta como "sin cues". Test en Task 2 y Task 4.

---

### Task 1: el origen en la petición y el router

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:1763` (`source`)
- Modify: `apps/desktop/src/main/usbExportRoute.ts`
- Test: `apps/desktop/src/main/usbExportRoute.test.ts` (el helper `req` pasa a `(source?: UsbExportRequest['source'])`)

**Interfaces:**
- Produces:
  - `UsbExportRequest.source?: Exclude<DjProgram, 'rekordbox'>`
  - `type UsbExporters = Partial<Record<DjProgram, UsbExporter>> & Record<'rekordbox' | 'engine', UsbExporter>`
  - `usbProgramOf(req: UsbExportRequest): DjProgram`
  - `routeUsbExports(exporters: UsbExporters): UsbExporter`: recorre `DJ_PROGRAMS`; un origen sin exportador responde `{ ok: false, reason: 'unsupported' }` en `plan` y `start`.

- [ ] **Step 1: tests rojos**

```ts
it('sends a Serato and a Traktor export to their own exporters, never to rekordbox', async () => {
  const rekordbox = fake()
  const serato = fake()
  const traktor = fake()
  const route = routeUsbExports({ rekordbox, engine: fake(), serato, traktor })
  await route.plan(req('serato'))
  await route.start(req('traktor'))
  expect(serato.plan).toHaveBeenCalledWith(req('serato'))
  expect(traktor.start).toHaveBeenCalledWith(req('traktor'))
  expect(rekordbox.plan).not.toHaveBeenCalled()
  expect(rekordbox.start).not.toHaveBeenCalled()
})
it('refuses a Serato export while rekordbox writes, and rekordbox while Traktor writes, as a stick takes one export at a time', async () => {
  const route = routeUsbExports({ rekordbox: fake(true), engine: fake(), serato: fake() })
  expect(await route.start(req('serato'))).toEqual({ ok: false, reason: 'busy' })
  const other = routeUsbExports({ rekordbox: fake(), engine: fake(), traktor: fake(true) })
  expect(await other.plan(req())).toEqual({ ok: false, reason: 'busy' })
  expect(other.busy()).toBe(true)
})
it('answers unsupported for a source with no exporter here, rather than reading another library', async () => {
  const route = routeUsbExports({ rekordbox: fake(), engine: fake() })
  expect(await route.plan(req('serato'))).toEqual({ ok: false, reason: 'unsupported' })
  expect(await route.start(req('traktor'))).toEqual({ ok: false, reason: 'unsupported' })
})
it('cancels and stops a Traktor export like the others', async () => {
  const traktor = fake(true)
  const route = routeUsbExports({ rekordbox: fake(), engine: fake(), traktor })
  expect(route.cancel()).toBe(true)
  await route.stop()
  expect(traktor.stop).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: comprobar que fallan.** Run `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExportRoute.test.ts`. Expected: FAIL (tipo de `source` y `exporters.serato` indefinido).
- [ ] **Step 3: implementar** las firmas de Interfaces.
- [ ] **Step 4: verde.** Mismo comando, PASS, y los 4 tests de antes sin tocar.
- [ ] **Step 5: suite, tres tsc, biome. Commit** `Route Serato and Traktor USB exports to their own exporters`.

### Task 2: el exportador de Pioneer sin las piezas de rekordbox

**Files:**
- Modify: `apps/desktop/src/main/usbExportSource.ts` (`ExportTrack`)
- Modify: `apps/desktop/src/main/usbExportStage.ts:102` (rejilla)
- Modify: `apps/desktop/src/main/usbExport.ts` (`identity`, `readSelection`, `.sync`, aviso)
- Modify: `apps/desktop/src/shared/types.ts` (`UsbWarning`)
- Test: `apps/desktop/src/main/usbExport.test.ts`, `apps/desktop/src/main/usbExportStage.test.ts` (solo tests nuevos)

**Interfaces:**
- Produces:
  - `ExportTrack.grid?: Beat[]` (de `./anlz`) y `ExportTrack.cuesLeftOut?: boolean`.
  - `stageExport` usa `t.grid ?? []` como rejilla inicial; el análisis de rekordbox la sustituye como hoy.
  - `UsbExporterDeps.readSelection: (dbPath: string, ids: string[]) => ExportSelection | 'unreadable' | Promise<ExportSelection | 'unreadable'>`
  - `UsbExporterDeps.identity: (dbPath: string, trackIds: string[]) => MasterIdentity | null | 'unreadable'`
  - `UsbExporterDeps.stage: (sel, dir, targetRoot, stick: { identity: MasterIdentity | null; deviceIds: ReadonlyMap<string, number> }) => Promise<Stage>`
  - `UsbWarning` gana `{ kind: 'cuesLeftOut'; titles: string[] }`, detrás de `cdj2000`, con los títulos de las pistas incluidas (`stage.included`) que llevan `cuesLeftOut`.
  - Sin identidad: `deviceIds` vacío sin leer `playlists3.sync`; antes de lanzar baken se borran `[...STALE_STICK_FILES, ...SYNC_FILES]`; `afterSuccess` no escribe `.sync` y devuelve `true`.

- [ ] **Step 1: tests rojos** (en `usbExport.test.ts`, con su `deps`, `happy`, `REQ`, `finished`, `removed`, `writes`; añadir `vi` al import de `vitest`)

```ts
it('exports without a collection identity, reading no sync file and giving baken no stick ids', async () => {
  const read: string[] = []
  const stage = vi.fn(deps(happy).stage)
  const exp = createUsbExporter(
    deps(happy, {
      identity: () => null,
      stage,
      readText: async (p) => {
        read.push(p)
        return null
      },
    }),
  )
  expect((await exp.plan(REQ)).ok).toBe(true)
  expect(read).toEqual([])
  expect(stage.mock.calls[0][3]).toEqual({ identity: null, deviceIds: new Map() })
})
it('removes the sync files rekordbox reads before a run without identity, and writes none', async () => {
  await createUsbExporter(deps(happy, { identity: () => null })).start(REQ)
  expect(await finished()).toMatchObject({ outcome: 'done', syncFiles: true })
  expect(removed).toEqual(
    [...STALE_STICK_FILES, 'playlists3.sync', 'playlists3Plus.sync'].map(
      (n) => `/Volumes/Surco/PIONEER/rekordbox/${n}`,
    ),
  )
  expect(writes).toEqual([])
})
it('waits for a selection that is read in the background', async () => {
  const r = await createUsbExporter(deps(happy, { readSelection: async () => SEL })).plan(REQ)
  expect(r.ok && r.plan.trackCount).toBe(2)
})
it('lists the tracks that go without cues or grid, only those that reach the stick', async () => {
  const sel = {
    ...SEL,
    tracks: SEL.tracks.map((t) => (['101', '103'].includes(t.id) ? { ...t, cuesLeftOut: true } : t)),
  }
  const r = await createUsbExporter(deps(happy, { readSelection: () => sel })).plan(REQ)
  expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'cuesLeftOut', titles: ['T101'] })
})
```

(`103` es la pista que el `stage` del harness da por perdida. El `trackCount` de 2 es el del plan de baken del harness sin el separador.)

En `usbExportStage.test.ts`:

```ts
it('writes the beat grid a track brings when rekordbox has no analysis of it', async () => {
  const sel = SEL()
  sel.tracks[0] = {
    ...sel.tracks[0],
    analysisPath: '',
    grid: [{ ms: 474.94, beat: 1, bpm: 120 }, { ms: 974.94, beat: 2, bpm: 120 }],
  }
  const s = await stageExport({ stickHas: [], identity: null, deviceIds: new Map(), sel, shareDir: share, settingsSource: null, dir: join(root, 'stage') })
  expect(readFileSync(s.xml, 'utf8')).toContain('<TEMPO Inizio="0.475" Bpm="120.00" Metro="4/4" Battito="1"/>')
})
```

- [ ] **Step 2: comprobar que fallan.** Run los dos ficheros. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas de Interfaces. En `prepare`, `await deps.readSelection(...)`; con `identity === null` no se llama a `stickDeviceIds`. `Prepared.identity` pasa a `MasterIdentity | null`.
- [ ] **Step 4: verde.** Todos los tests de antes de `usbExport.test.ts` y `usbExportStage.test.ts` siguen en verde sin tocarlos. Mutación: borrar los `.sync` también con identidad hace caer "removes only the two stale files…"; olvidar `t.grid` hace caer el de la rejilla.
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Export to a Pioneer USB without rekordbox identity, sync files or analysis`.

### Task 3: cues y rejilla al reloj de rekordbox, IDs y tipo de fichero

**Files:**
- Create: `apps/desktop/src/main/usbExportForeign.ts`
- Test: `apps/desktop/src/main/usbExportForeign.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ExportTrack.grid`), `buildBakenXml`, `Beat`.
- Produces:
  - `interface ForeignCue { ms: number; kind: number; name: string; endMs?: number }`
  - `interface ExportMarks { cues: ExportCue[]; grid: Beat[] }`
  - `marksOnRekordboxClock(cues: ForeignCue[], grid: { ms: number; beat: number }[], deltaMs: number): ExportMarks`: cada cue a `inMs = max(0, ms + delta)`, `outMs` `-1` o `max(0, endMs + delta)`, `comment = name`; con menos de 2 beats la rejilla es `[]`; si no, `bpm = 60000 * (n - 1) / (último.ms - primero.ms)` para todos, `ms + delta`, sin los que quedan bajo 0.
  - `exportTrackIds(paths: readonly string[]): Map<string, string>`: clave la ruta en NFC, valor el ID en texto (Ruling de IDs).
  - `exportFileType(path: string): number` (tabla de Global Constraints, sin distinguir mayúsculas).
  - `foreignExportTrack(id: string, path: string, over: Partial<ExportTrack>): ExportTrack`: todo vacío o a 0, `separator` y `streaming` `false`, `cues: []`, `fileType: exportFileType(path)`, y después `over`.

- [ ] **Step 1: tests rojos**

```ts
it('moves every cue, loop end and beat by the same delta', () => {
  const m = marksOnRekordboxClock(
    [{ ms: 1000, kind: 1, name: 'Drop' }, { ms: 2000, kind: 0, name: '', endMs: 6000 }],
    [{ ms: 500, beat: 1 }, { ms: 1000, beat: 2 }],
    26.12,
  )
  expect(m.cues).toEqual([
    { inMs: 1026.12, outMs: -1, kind: 1, comment: 'Drop' },
    { inMs: 2026.12, outMs: 6026.12, kind: 0, comment: '' },
  ])
  expect(m.grid.map((b) => b.ms)).toEqual([526.12, 1026.12])
})
it('drops beats that would land before zero and pins a cue there at zero', () => {
  const m = marksOnRekordboxClock([{ ms: 0.5, kind: 1, name: '' }], [{ ms: 0.5, beat: 1 }, { ms: 500.5, beat: 2 }, { ms: 1000.5, beat: 3 }], -0.9)
  expect(m.cues[0].inMs).toBe(0)
  expect(m.grid.map((b) => b.beat)).toEqual([2, 3])
})
it('gives a whole grid one tempo, so baken writes a single TEMPO', () => {
  const beats = Array.from({ length: 400 }, (_, k) => ({ ms: 123.4 + (k * 60000) / 123.455, beat: (k % 4) + 1 }))
  const { grid } = marksOnRekordboxClock([], beats, 0)
  const t = foreignExportTrack('1', '/m/a.wav', { grid })
  const xml = buildBakenXml({ playlists: [], tracks: [t] }, new Map([['1', { size: 1, grid }]]), 'darwin')
  expect(xml.match(/<TEMPO /g)).toHaveLength(1)
})
it('gives one path written in NFD or NFC the same id', () => {
  const nfc = '/Users/dj/Música/a.mp3'
  const ids = exportTrackIds([nfc.normalize('NFD'), nfc.normalize('NFC')])
  expect([...ids.values()]).toHaveLength(1)
})
it('keeps a track id when the selection around it changes, so the next export knows what left', () => {
  expect(exportTrackIds(['/m/a.mp3']).get('/m/a.mp3')).toBe(exportTrackIds(['/m/z.wav', '/m/a.mp3']).get('/m/a.mp3'))
})
it('never gives two tracks one id, and every id is a number baken takes', () => {
  const paths = Array.from({ length: 5000 }, (_, i) => `/m/${i}.mp3`)
  const ids = [...exportTrackIds(paths).values()]
  expect(new Set(ids).size).toBe(5000)
  expect(ids.every((id) => /^\d+$/.test(id) && Number(id) >= 1 && Number(id) <= 2_000_000_000)).toBe(true)
})
it.each([['a.MP3', 1], ['a.m4a', 4], ['a.mp4', 4], ['a.flac', 5], ['a.wav', 11], ['a.aif', 12], ['a.aiff', 12], ['a.ogg', 0]])('types %s as %i', (path, type) => {
  expect(exportFileType(path)).toBe(type)
})
```

- [ ] **Step 2: comprobar que fallan.** Run `…/vitest.mjs run src/main/usbExportForeign.test.ts`. Expected: FAIL, el módulo no existe.
- [ ] **Step 3: implementar** las firmas de Interfaces. FNV-1a de 32 bits sobre los bytes UTF-8 de la ruta en NFC; ID = `hash % 2_000_000_000 + 1`.
- [ ] **Step 4: verde.** Mutación: calcular el BPM beat a beat hace caer el del `TEMPO` único; no normalizar hace caer el de NFD.
- [ ] **Step 5: suite, tres tsc, biome. Commit** `Place foreign cues and beat grids on rekordbox clock for the USB`.

### Task 4: la selección de Serato

**Files:**
- Modify: `apps/desktop/src/main/seratoCueSource.ts` (extraer `seratoTrackCuesOf`, sin cambiar lo que hace `trackCues`)
- Create: `apps/desktop/src/main/usbExportSerato.ts`
- Test: `apps/desktop/src/main/usbExportSerato.test.ts` (biblioteca en memoria; `vi.mock` de `./seratoTags`, `./seratoClock` y `./rekordboxTimeline` con `importOriginal` solo para el test de `seratoExportMarks`)

**Interfaces:**
- Consumes: Task 3 (`marksOnRekordboxClock`, `exportTrackIds`, `foreignExportTrack`, `ExportMarks`), `seratoTree`, `SeratoLibrary`, `readSeratoTrack`, `rekordboxShiftOfFile`.
- Produces:
  - `seratoTrackCuesOf(contentId: string, track: NonNullable<ReturnType<typeof readSeratoTrack>>): Promise<TrackCues>` en `seratoCueSource.ts`; `trackCues` pasa a ser `readSeratoTrack` + esto.
  - `interface SeratoMarks extends ExportMarks { lengthSec: number; sampleRate: number }`
  - `seratoExportMarks(file: string): Promise<SeratoMarks | null>`: `null` si `readSeratoTrack` da `null`. Cues: los hot cues de `trackCues` (`kind` tal cual, nombre) y los bucles como `{ ms: startMs, kind: 0, name, endMs }`; delta = `rekordboxShiftOfFile(file, track.sampleRate)`. `lengthSec = round(durationMs / 1000)`.
  - `readSeratoExportSelection(library: SeratoLibrary, ids: string[], deps: { marks: (file: string) => Promise<SeratoMarks | null> }): Promise<ExportSelection>`: árbol según el Ruling; datos según el Ruling; `updatedAt: 0`; con `marks` `null`, `cues: []` y sin `cuesLeftOut`.

- [ ] **Step 1: tests rojos**

Fixture: `A = '/Users/dj/Música/a.mp3'` (NFC, en `database V2` como `Alpha`, `Ana`, `Uno`, `House`, `bpm: '124.00'`, `key: 'Am'`, `addedAt: 1793688116`), `B = '/Users/dj/Canción.wav'` (NFC, `Beta`), `C = '/Users/dj/c.wav'` (no está en `database V2`), `GONE = '/Users/dj/gone.mp3'`. Crates: `Sets` → `[A, B]`, `Sets%%Warm` → `[B.normalize('NFD'), C]`, `Empty` → `[]`, `Empty%%Kid` → `[A]`, `Lost` → `[GONE]`. `marks` devuelve `null` para `GONE` y, para el resto, `{ cues: [{ inMs: 1000, outMs: -1, kind: 1, comment: 'Drop' }, { inMs: 2000, outMs: 6000, kind: 0, comment: '' }], grid: [], lengthSec: 300, sampleRate: 96000 }`.

```ts
it('turns a crate with subcrates and tracks of its own into a folder holding its own list first, then its subcrates', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Sets', 'Sets%%Warm'], { marks })
  expect(sel.playlists.map((p) => [p.name, p.folders, p.folderIds])).toEqual([
    ['Sets', ['Sets'], ['Sets']],
    ['Warm', ['Sets'], ['Sets']],
  ])
})
it('leaves out the own list of a ticked parent crate with no tracks, keeping its subcrates in its folder', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Empty', 'Empty%%Kid'], { marks })
  expect(sel.playlists.map((p) => [p.name, p.folders])).toEqual([['Kid', ['Empty']]])
})
it('puts a subcrate ticked alone inside its parent folder, without the parent tracks', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Sets%%Warm'], { marks })
  expect(sel.playlists.map((p) => [p.name, p.folders])).toEqual([['Warm', ['Sets']]])
  expect(sel.tracks.map((t) => t.path.normalize('NFC'))).toEqual([B, C])
})
it('gives a track two crates share one id and one entry, whatever the normalization of its path', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Sets', 'Sets%%Warm'], { marks })
  expect(sel.tracks.filter((t) => t.path.normalize('NFC') === B)).toHaveLength(1)
  expect(sel.playlists[0].trackIds[1]).toBe(sel.playlists[1].trackIds[0])
  expect(sel.tracks.find((t) => t.path.normalize('NFC') === B)?.title).toBe('Beta')
})
it('takes the database V2 facts and the length, rate and cues of the file', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Sets'], { marks })
  expect(sel.tracks[0]).toMatchObject({
    title: 'Alpha', artist: 'Ana', album: 'Uno', genre: 'House', key: 'Am', bpm: 124,
    dateAdded: '2026-11-03', fileType: 1, lengthSec: 300, sampleRate: 96000, rating: 0,
    cues: [{ inMs: 1000, outMs: -1, kind: 1, comment: 'Drop' }, { inMs: 2000, outMs: 6000, kind: 0, comment: '' }],
  })
})
it('names a crate track that database V2 does not know after its file', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Sets%%Warm'], { marks })
  expect(sel.tracks[1].title).toBe('c')
})
it('keeps a track that is not on disk, with no cues and not counted as going without them, so the plan lists it as missing', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Lost'], { marks })
  expect(sel.tracks).toHaveLength(1)
  expect(sel.tracks[0]).toMatchObject({ path: GONE, cues: [] })
  expect(sel.tracks[0].cuesLeftOut).toBeFalsy()
})
it('writes the nested folder, a hot cue and a memory loop into baken XML', async () => {
  const sel = await readSeratoExportSelection(LIB, ['Sets', 'Sets%%Warm'], { marks })
  const xml = buildBakenXml(sel, new Map(sel.tracks.map((t) => [t.id, { size: 1, grid: t.grid ?? [] }])), 'darwin')
  expect(xml).toMatch(/<NODE Type="0" Name="Sets" Count="2">\n<NODE Name="Sets" Type="1" KeyType="0" Entries="2">/)
  expect(xml).toContain('<POSITION_MARK Name="Drop" Type="0" Start="1.000" Num="0"/>')
  expect(xml).toContain('<POSITION_MARK Name="" Type="4" Start="2.000" End="6.000" Num="-1"/>')
})
it('moves Serato cues, loops and grid onto rekordbox clock through Surco clock', async () => {
  vi.mocked(readSeratoTrack).mockReturnValue({
    payload: null, oldBlockDisagrees: false, durationMs: 10000, sampleRate: 44100,
    markers: { cues: [{ index: 0, ms: 1000, color: 0xcc0000, name: 'Drop' }], loops: [{ index: 0, startMs: 2000, endMs: 6000, name: '' }] },
    tempoMap: { firstBeatMs: 500, bpm: 120 },
  })
  vi.mocked(seratoLeadOfFile).mockResolvedValue(51.18)
  vi.mocked(rekordboxShiftOfFile).mockResolvedValue(26.12)
  const m = await seratoExportMarks('/m/a.mp3')
  expect(m?.cues[0]).toMatchObject({ kind: 1, comment: 'Drop', outMs: -1 })
  expect(m?.cues[0].inMs).toBeCloseTo(974.94, 6)
  expect(m?.cues[1].outMs).toBeCloseTo(5974.94, 6)
  expect(m?.grid[0]).toMatchObject({ beat: 1, bpm: 120 })
  expect(m?.grid[0].ms).toBeCloseTo(474.94, 6)
  expect(m).toMatchObject({ lengthSec: 10, sampleRate: 44100 })
})
```

- [ ] **Step 2: comprobar que fallan.** Run `…/vitest.mjs run src/main/usbExportSerato.test.ts`. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas de Interfaces. El recorrido del árbol trabaja sobre `seratoTree(library)`; las pistas de un crate salen de `library.crates.get(id)` y se emparejan con `library.tracks` por `file` en NFC.
- [ ] **Step 4: verde.** `seratoCueSource.test.ts` sigue en verde sin tocarlo. Mutación: emparejar sin NFC hace caer el de normalización; meter la playlist propia aunque esté vacía hace caer el de `Empty`.
- [ ] **Step 5: suite, tres tsc, biome. Commit** `Read a Serato crate selection for the Pioneer USB export`.

### Task 5: la selección de Traktor

**Files:**
- Modify: `apps/desktop/src/main/traktorCues.ts` (exportar `gridOf` como `traktorGridOf`, sin cambiarlo)
- Create: `apps/desktop/src/main/usbExportTraktor.ts`
- Test: `apps/desktop/src/main/usbExportTraktor.test.ts` (copiar los constructores `entryOf`, `keyOf`, `playlist`, `folder` y `nml` de `traktorPlaylists.test.ts`, con un campo `extra` para `ALBUM`, `TEMPO` y `CUE_V2`)

**Interfaces:**
- Consumes: Task 3, `readTraktorTree`, `selectedPlaylists`, `parsePlaylists`, `nodeById`, `findEntries`, `attr`, `traktorFileOf`, `traktorCueElements`, `traktorGridOf`, `traktorLeadOfFile`, `rekordboxShiftOfFile`.
- Produces:
  - `traktorGridOf(block: string, durationMs: number): { ms: number; beat: number }[]`
  - `traktorExportDelta(file: string): Promise<number | null>`: `null` si `traktorLeadOfFile` da `null`; si no, `rekordboxShiftOfFile(file, 44100) − lead`.
  - `readTraktorExportSelection(nml: string, ids: string[], deps: { bootVolume: string; deltaOf: (file: string) => Promise<number | null> }): Promise<ExportSelection>`: playlists con `selectedPlaylists(readTraktorTree(nml), ids)`; filas por `nodeById(parsePlaylists(nml), id).rows`; cues y datos según los Rulings; `updatedAt: 0`.

- [ ] **Step 1: tests rojos**

Fixture: `W` = `w.wav` en `/:Users/:dj/:Music/:` con el bloque real de "Bumpy" de la colección de pruebas (`ALBUM TITLE="Maschine Expansion" TRACK="3"`, `INFO … KEY="Ebm" PLAYTIME="142" PLAYTIME_FLOAT="141.348572" BITRATE="299672" RANKING="153" IMPORT_DATE="2024/6/18" RELEASE_DATE="2019/1/1"`, `TEMPO BPM="136.000000"`, sus `CUE_V2` de `HOTCUE` 0, AutoGrid `TYPE` 4 y `HOTCUE` 1, más uno `TYPE="5" START="10000.000000" LEN="4000.000000" HOTCUE="2"` y uno `TYPE="0" START="50000.000000" HOTCUE="-1" NAME="Break"`; todos con `NAME="n.n."` salvo ese). `M = m.mp3` con un `HOTCUE="1"`. Árbol: carpeta `Sets` con playlist `Friday` (`p1`) = `[W, M]` y playlist `Saturday` (`p2`) = `[W]`. `deltaOf`: `0` para `.wav`, `null` para `.mp3`.

```ts
it('exports a playlist inside its folder, in order, with each ENTRY facts', async () => {
  const sel = await readTraktorExportSelection(NML, ['p1'], deps)
  expect(sel.playlists).toMatchObject([{ id: 'p1', name: 'Friday', folders: ['Sets'], folderIds: ['folder:Sets'] }])
  expect(sel.tracks[0]).toMatchObject({
    title: 'Bumpy', artist: 'Bumpin Flava', album: 'Maschine Expansion', trackNo: 3, key: 'Ebm', bpm: 136,
    rating: 3, dateAdded: '2024-06-18', year: 2019, bitRate: 300, lengthSec: 142, label: 'Native Instruments', fileType: 11,
  })
})
it('gives hot cues Surco letters, keeps the load cue and unbuttoned cues as memory cues, and loops with their end', async () => {
  const sel = await readTraktorExportSelection(NML, ['p1'], deps)
  expect(sel.tracks[0].cues).toEqual([
    { inMs: 71.622549, outMs: -1, kind: 0, comment: '' },
    { inMs: 28306.916666, outMs: -1, kind: 1, comment: '' },
    { inMs: 10000, outMs: 14000, kind: 2, comment: '' },
    { inMs: 50000, outMs: -1, kind: 0, comment: 'Break' },
  ])
})
it('puts the AutoGrid marker on one TEMPO at 136 BPM', async () => {
  const sel = await readTraktorExportSelection(NML, ['p1'], deps)
  const xml = buildBakenXml(sel, new Map(sel.tracks.map((t) => [t.id, { size: 1, grid: t.grid ?? [] }])), 'darwin')
  expect(xml.match(/<TEMPO [^>]*Bpm="136.00"/g)).toHaveLength(1)
  expect(xml).toMatch(/<NODE Type="0" Name="Sets" Count="1">\n<NODE Name="Friday" Type="1" KeyType="0" Entries="2">/)
})
it('exports an MP3 whose lead Traktor never measured without cues or grid, and marks it', async () => {
  const sel = await readTraktorExportSelection(NML, ['p1'], deps)
  expect(sel.tracks[1]).toMatchObject({ cues: [], cuesLeftOut: true })
  expect(sel.tracks[1].grid ?? []).toEqual([])
})
it('gives a track two playlists share one id and one entry', async () => {
  const sel = await readTraktorExportSelection(NML, ['p1', 'p2'], deps)
  expect(sel.tracks).toHaveLength(2)
  expect(sel.playlists[1].trackIds).toEqual([sel.playlists[0].trackIds[0]])
})
it('leaves out a row whose track is no longer in the collection', async () => {
  const sel = await readTraktorExportSelection(nml([W], [playlist('Odd', 'p3', [W, { file: 'ghost.mp3' }])]), ['p3'], deps)
  expect(sel.playlists[0].trackIds).toHaveLength(1)
})
it('knows the lead of a WAV, and not that of an M4A or an MP3 that is not there', async () => {
  expect(await traktorExportDelta('/m/a.wav')).toBe(0)
  expect(await traktorExportDelta('/m/a.m4a')).toBeNull()
  expect(await traktorExportDelta('/nowhere/a.mp3')).toBeNull()
})
```

(El orden de `cues` en el test es el de los `CUE_V2` en el `ENTRY` de la fixture; ajustar el array a ese orden si se escriben en otro.)

- [ ] **Step 2: comprobar que fallan.** Run `…/vitest.mjs run src/main/usbExportTraktor.test.ts`. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas de Interfaces. Una sola pasada de `findEntries` indexa los `ENTRY` por clave `${volume}${dir}${file}`, la misma que usan las filas.
- [ ] **Step 4: verde.** `traktorCues.test.ts` y `traktorPlaylists.test.ts` siguen en verde sin tocarlos. Mutación: `HOT_KINDS[hotcue]` sin el desfase hace caer el de letras; contar `cuesLeftOut` con delta 0 hace caer el de la marca.
- [ ] **Step 5: suite, tres tsc, biome. Commit** `Read a Traktor playlist selection for the Pioneer USB export`.

### Task 6: IPC, memorias por origen y lista de USB

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`UsbVolume.bySource`)
- Modify: `apps/desktop/src/main/usbVolumes.ts:260` (`readVolumes`)
- Modify: `apps/desktop/src/main/usbExportIpc.ts`
- Modify: `apps/desktop/src/main/index.ts:1457` (opciones nuevas)
- Modify: `apps/desktop/src/preload/index.ts:368`, `apps/desktop/src/preload/api.ts:329` (`usbPickFolder`)
- Test: `apps/desktop/src/main/usbVolumes.test.ts` (test nuevo), `apps/desktop/src/main/usbExportIpcSources.test.ts` (nuevo; mismos `vi.mock` que `usbExportIpc.test.ts`, pero `createUsbExporter` guarda en una lista los `deps` de cada llamada y devuelve un `fake()` por llamada; `userData` en un `mkdtemp`)

**Interfaces:**
- Consumes: Task 1, Task 2, Task 4 (`readSeratoExportSelection`, `seratoExportMarks`), Task 5 (`readTraktorExportSelection`, `traktorExportDelta`), `readSeratoLibrary`, `SeratoLibraryRoot`.
- Produces:
  - `UsbVolume.bySource?: Partial<Record<'serato' | 'traktor', { holder: UsbHolder; remembered: UsbRemembered | null }>>`
  - `readVolumes(source, memory, holder?, syncText?, engine?, bySource?: Partial<Record<'serato' | 'traktor', UsbMemory>>)`: por cada origen dado, `holder(v.mountPoint, entry?.pdb ?? null)` y `remembered` con `prune: false` y `settings: false`.
  - `registerUsbExportIpc` gana `serato?: { roots: () => SeratoLibraryRoot[] }` y `traktor?: { nml: () => string; bootVolume: () => string }`. Su `ensureClosed` pasa a `<P extends Exclude<WritableProgram, 'traktor'>>` (el mismo tipo que hoy).
  - Por cada uno dado, un `createUsbExporter` con su memoria (`usb-serato-exports.json`, `usb-traktor-exports.json`), `identity: () => null`, `rekordboxRunning: async () => false`, `ensureRekordboxClosed: async () => true`, `masterPlaylistsXml: async () => null`, `volumes: () => readVolumes(source, suMemoria)` y `stage: (sel, dir) => stageExport({ sel, shareDir: '', settingsSource: null, dir, identity: null, deviceIds: new Map(), stickHas: [] })`. Serato: `collection: () => roots()[0]?.dir ?? ''`, `readSelection` lee `readSeratoLibrary(roots())`. Traktor: `collection: nml`, `readSelection` lee el NML con `readFileSync`. Un error al leer da `'unreadable'`. El resto de `deps` es el de rekordbox, compartido sin cambiarlo.
  - `usb:pickFolder` acepta `from?: Exclude<DjProgram, 'rekordbox'>` y lee la memoria de ese origen. `window.api.usbPickFolder(source?: Exclude<DjProgram, 'rekordbox'>)`.
  - `list()` pasa `bySource` con las memorias registradas.
  - `index.ts`: `serato: process.platform === 'darwin' ? { roots: seratoRoots } : undefined`, `traktor: { nml: traktorReadPath, bootVolume: () => bootVolumeName() }`.

- [ ] **Step 1: tests rojos**

```ts
it('reads per drive what Surco last exported there from Serato, apart from rekordbox and Engine DJ', async () => {
  const source = { list: async () => [{ ...RAW, uuid: 'A', mountPoint: '/Volumes/A' }], idAt: async () => null }
  const serato = await memory()
  serato.remember('volume:A', { playlistIds: ['Sets'], trackIds: ['9'], at: 3, pdb: { size: 1, mtimeMs: 2 }, prune: false, settings: false })
  const holder = vi.fn(async (_root: string, pdb: { size: number; mtimeMs: number } | null) => ({ by: pdb ? ('surco' as const) : ('empty' as const), at: null }))
  const vols = await readVolumes(source, await memory(), holder, noSync, undefined, { serato })
  expect(vols[0].remembered).toBeNull()
  expect(vols[0].holder.by).toBe('empty')
  expect(vols[0].bySource?.serato).toEqual({ holder: { by: 'surco', at: null }, remembered: { playlistIds: ['Sets'], prune: false, settings: false, at: 3 } })
})
```

En `usbExportIpcSources.test.ts`:

```ts
it('builds the Serato and Traktor exporters with their own memory and none of rekordbox pieces', async () => {
  const { pioneer } = register({ serato: { roots: () => [ROOT] }, traktor: { nml: () => '/t/collection.nml', bootVolume: () => 'HD' } })
  const [serato, traktor] = pioneer.slice(0, 2)
  for (const d of [serato, traktor]) {
    expect(d.identity('', [])).toBeNull()
    expect(await d.rekordboxRunning()).toBe(false)
  }
  serato.memory.remember('volume:U', ENTRY)
  expect(existsSync(join(userData, 'usb-serato-exports.json'))).toBe(true)
  expect(existsSync(join(userData, 'usb-exports.json'))).toBe(false)
})
it('has no Serato library to export without a Serato folder', () => {
  const { pioneer } = register({ serato: { roots: () => [] } })
  expect(pioneer[0].collection()).toBe('')
})
it('sends a Serato request to the Serato exporter', async () => {
  const { exporters } = register({ serato: { roots: () => [ROOT] } })
  await handlerFor('usb:plan')({}, { ...req(), source: 'serato' })
  expect(exporters.at(0)?.plan).toHaveBeenCalled()
  expect(exporters.at(-1)?.plan).not.toHaveBeenCalled()
})
it('answers a folder pick with what Surco remembers there for Traktor', async () => {
  const { pioneer } = register({ traktor: { nml: () => '/t/c.nml', bootVolume: () => 'HD' } })
  pioneer[0].memory.remember('folder:/Volumes/S/sets', ENTRY)
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/Volumes/S/sets'] })
  expect(await handlerFor('usb:pickFolder')({ sender: {} }, 'traktor')).toMatchObject({ remembered: { playlistIds: ENTRY.playlistIds } })
})
```

(`register` crea los exportadores de los orígenes dados antes que el de rekordbox, y devuelve `pioneer` = `deps` en orden de creación y `exporters` = los `fake()` devueltos. Si el implementador los crea en otro orden, ajustar los índices, no lo que se afirma. `realpath` de `/Volumes/S/sets` falla en el test y el handler cae a la ruta tal cual, como hoy.)

- [ ] **Step 2: comprobar que fallan.** Run los dos ficheros. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas de Interfaces. `usbExportIpc.test.ts` sigue en verde sin tocarlo: sin `serato` ni `traktor` en sus opciones no se crea ningún exportador nuevo.
- [ ] **Step 4: verde.** Mutación: dar a Serato la memoria de rekordbox hace caer el primer test del IPC.
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Wire the Serato and Traktor USB exporters with their own memories`.

### Task 7: el USB desde las pestañas Serato y Traktor

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:1756` (`UsbProgram = DjProgram`)
- Modify: `apps/desktop/src/renderer/src/lib/sourcePrograms.ts` (`usb: true` en `serato` y `traktor`, que el tipo exige)
- Modify: `apps/desktop/src/renderer/src/components/UsbExportModal.tsx` (vistas `serato` y `traktor`, `failureKey`, aviso `cuesLeftOut`)
- Modify: `apps/desktop/src/renderer/src/components/CheckTree.tsx` (nodo con hijos desplegable)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR,ja}.json`
- Test: `UsbExportModal.test.tsx`, `CheckTree.test.tsx` (tests nuevos), `App.test.tsx` (sustituye el test de Traktor sin USB)

**Interfaces:**
- Consumes: Task 6 (`UsbVolume.bySource`, `usbPickFolder(source)`), Task 2 (`cuesLeftOut`).
- Produces:
  - `UsbProgramView.failureKey: (reason: UsbFailure) => string`. rekordbox y Engine: `` `usbExport.errors.${reason}` ``. Serato y Traktor: `` `usbExport.errorsFrom.${source}.${reason}` `` para `'no-collection'` y `'unreadable'`, el de siempre para el resto. Se usa en los dos sitios del modal que hoy leen `usbExport.errors`.
  - Vista de Serato y Traktor: `holder: (v) => v.bySource?.[source]?.holder ?? v.holder`; `ticks` y `remembered` de `v.bySource?.[source]`; `lastUsed` como Engine, por el `at` más nuevo; `request` con `prune: false`, `settings: false`, `source`; `pickFolder: () => window.api.usbPickFolder(source)`; `settingsBox: false`; `pruneBox: false`.
  - `warning()` gana el caso `cuesLeftOut`, como `cdj2000` (resumen con `count` y lista de títulos).
  - `CheckTree`: `const isFolder = node.kind === 'folder' || (node.children?.length ?? 0) > 0`; ese mismo valor decide estado, chevron, hijos y el borrado en `toggle`.
  - Textos (es / en; de, fr, pt-BR y ja con el mismo sentido):
    - `usbExport.errorsFrom.serato.no-collection`: "No encuentro la biblioteca de Serato." / "The Serato library was not found."
    - `usbExport.errorsFrom.serato.unreadable`: "No se pudo leer la biblioteca de Serato." / "The Serato library could not be read."
    - `usbExport.errorsFrom.traktor.no-collection`: "No encuentro la colección de Traktor." / "The Traktor collection was not found."
    - `usbExport.errorsFrom.traktor.unreadable`: "No se pudo leer la colección de Traktor." / "The Traktor collection could not be read."
    - `usbExport.warnings.cuesLeftOut_one`: "{{count}} pista va sin cues ni rejilla, porque en su formato no se sabe dónde caerían en el CDJ" / "{{count}} track goes without cues or grid, as where they would land on a CDJ is not known for its format"
    - `usbExport.warnings.cuesLeftOut_other`: "{{count}} pistas van sin cues ni rejilla, porque en su formato no se sabe dónde caerían en el CDJ" / "{{count}} tracks go without cues or grid, as where they would land on a CDJ is not known for their format"

- [ ] **Step 1: tests rojos**

En `UsbExportModal.test.tsx` (con su `show`, `vol`, `usbPlan`):

```ts
const SERATO_MEMORY = { holder: { by: 'surco' as const, at: 1 }, remembered: { playlistIds: ['house'], prune: false, settings: false, at: 2 } }
it('asks main for a Serato export with none of the rekordbox options, ticking what Surco last sent there from Serato', async () => {
  await show({ volumes: [vol({ stickPlaylists: ['mak'], remembered: REMEMBERED, bySource: { serato: SERATO_MEMORY } })], lastKey: null }, { program: 'serato' })
  expect(screen.queryByTestId('usb-settings')).not.toBeInTheDocument()
  expect(screen.queryByTestId('usb-prune')).not.toBeInTheDocument()
  await waitFor(() =>
    expect(usbPlan).toHaveBeenLastCalledWith({ playlistIds: ['house'], target: { kind: 'volume', uuid: 'U1' }, prune: false, settings: false, source: 'serato' }),
  )
})
it('says the Serato library is missing in Serato words, not rekordbox ones', async () => {
  usbPlan.mockResolvedValue({ ok: false, reason: 'no-collection' })
  await show({ volumes: [vol({ bySource: { serato: SERATO_MEMORY } })], lastKey: null }, { program: 'serato' })
  expect(await screen.findByTestId('usb-summary')).toHaveTextContent('No encuentro la biblioteca de Serato.')
})
it('lists the tracks that go without cues or grid, and never ticks what Surco sent there from rekordbox', async () => {
  usbPlan.mockResolvedValue({ ok: true, plan: { ...PLAN, warnings: [{ kind: 'cuesLeftOut', titles: ['Clicks'] }] } })
  await show({ volumes: [vol({ remembered: { ...REMEMBERED, playlistIds: ['house'] }, stickPlaylists: ['house'] })], lastKey: null }, { program: 'traktor' })
  expect(screen.getByTestId('check-node-house')).not.toBeChecked()
  fireEvent.click(screen.getByTestId('check-node-house'))
  expect(await screen.findByTestId('usb-warning-cuesLeftOut')).toHaveTextContent('1 pista va sin cues ni rejilla')
  expect(screen.getByTestId('usb-warning-cuesLeftOut')).toHaveTextContent('Clicks')
})
it('asks for the folder with what Surco remembers for Traktor there', async () => {
  const usbPickFolder = vi.fn<Api['usbPickFolder']>(async () => null)
  ;(window as unknown as { api: Api }).api = stubApi({ usbPlan, usbPickFolder })
  await show({ volumes: [], lastKey: null }, { program: 'traktor' })
  fireEvent.click(screen.getByTestId('usb-other'))
  expect(usbPickFolder).toHaveBeenCalledWith('traktor')
})
```

(El modo de esperar al plan, con temporizadores falsos, es el de los tests de Engine del mismo fichero.)

En `CheckTree.test.tsx`:

```ts
it('opens a Serato crate that has subcrates, and ticks it with them', () => {
  const onChange = vi.fn()
  const nodes: SourceNode[] = [{ id: 'Sets', name: 'Sets', kind: 'playlist', count: 2, children: [{ id: 'Sets%%Warm', name: 'Warm', kind: 'playlist', count: 2 }] }]
  render(<CheckTree nodes={nodes} checked={new Set()} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sets' }))
  expect(screen.getByTestId('check-node-Sets%%Warm')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('check-node-Sets'))
  expect(onChange).toHaveBeenCalledWith(new Set(['Sets', 'Sets%%Warm']))
})
```

En `App.test.tsx`, en lugar de "offers no USB export from the Traktor tree…":

```ts
it('opens the USB export from the Traktor tree on its playlists and asks for a Traktor export', async () => {
  const usbPlan = vi.fn<Api['usbPlan']>().mockResolvedValue({ ok: false, reason: 'nothing-selected' })
  openTraktor({ usbVolumes: vi.fn<Api['usbVolumes']>().mockResolvedValue({ volumes: [stick('A', 'empty')], lastKey: null }), usbPlan })
  await renderApp()
  fireEvent.click(await screen.findByTestId('source-rail-traktor'))
  fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
  fireEvent.click(await screen.findByTestId('check-node-u1'))
  await waitFor(() => expect(usbPlan).toHaveBeenCalledWith(expect.objectContaining({ playlistIds: ['u1'], source: 'traktor' })))
})
```

y el mismo para Serato con `openSerato` y un crate de su fixture, esperando `source: 'serato'`. (`stick` está definido en otro `describe`; moverlo a nivel de fichero o copiarlo.)

- [ ] **Step 2: comprobar que fallan.** Run cada fichero. Expected: FAIL.
- [ ] **Step 3: implementar** las firmas de Interfaces. `App.tsx` no necesita más cambio que el que pida `tsc`.
- [ ] **Step 4: verde.** Pasan `keys.test.ts` y `usedKeys.test.ts`. Todos los tests anteriores de `UsbExportModal.test.tsx` y `CheckTree.test.tsx` sin tocar.
- [ ] **Step 5: suite, tres tsc, biome y matriz igual a la base. Commit** `Export to a Pioneer USB from the Serato and Traktor tabs`.

### Task 8: prueba manual y cierre (controlador, no subagente)

- [ ] Sumas `shasum` antes de empezar de `~/Music/_Serato_/database V2`, `~/Music/_Serato_/Subcrates/*`, `~/Documents/Native Instruments/Traktor 4.5.1/collection.nml` y el `master.db` de rekordbox. Al final deben ser iguales.
- [ ] Destino: la raíz de un USB de pruebas en FAT32 (rekordbox solo lee la raíz de un volumen). Si no hay USB a mano, una imagen `hdiutil create -size 2g -fs MS-DOS -volname SURCOTEST`, comprobando antes que `isUsbVolume` la lista; si no, pedir un USB al usuario.
- [ ] Surco con perfil aislado (`run-desktop`). Pestaña Serato, botón de USB, marcar `Medida Q` y un crate con subcrates de `~/Music/Serato Pruebas`. Anotar cuánto tarda el resumen. Exportar.
- [ ] Mirar el USB: `PIONEER/rekordbox/export.pdb`, un `ANLZ0000.DAT` y `.EXT` por pista en `PIONEER/USBANLZ`, ningún `playlists3.sync`, y qué ha pasado con `exportExt.pdb`.
- [ ] Abrir rekordbox con el USB montado y mirarlo como dispositivo, sin importar nada: playlists y carpetas como en Serato, onda, rejilla y que cada cue de las pistas de medida cae en su chasquido con un error de 50 ms como mucho. Cerrar rekordbox sin sincronizar.
- [ ] Lo mismo desde la pestaña Traktor con la colección de pruebas, incluida una pista MP3 sin desfase medido (sale en el aviso de "sin cues ni rejilla").
- [ ] Volver a exportar desde Serato al mismo USB: el resumen dice "ya está" para la música y el USB sale como escrito por Surco. La pestaña rekordbox, sobre ese USB, no marca playlists de Serato.
- [ ] Sumas iguales. Matriz completa igual a la base, suite, tres tsc y biome. `git merge main`, otra vez la suite, y `git merge --ff-only serato-d` en el main local (sin push).
- [ ] Anotar el resultado al final de este plan. Sin CDJ a mano, lo que diga un CDJ queda pendiente y se dice en el resumen. Commit `Record the Serato and Traktor USB export manual test`.
