# Serato fase (b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editar desde Surco los hot cues de Serato (con su reloj y su rejilla), pasarlos a y desde rekordbox/Traktor/Engine, usar Auto mark en Serato y conservarlos al convertir.

**Architecture:** Serato guarda los cues solo en el fichero (`Serato Markers2`). Un codificador puro en `shared/seratoMarkers.ts`, un reloj por formato (`seratoLeadMs`) que reutiliza `rekordboxTimeline.ts`, un escritor en sitio con el patrón de `musicFieldWrite.ts`, y Serato entra en las tablas de cues (cola, escritores, editor, gemelos) con un tipo propio de programas con cues escribibles, sin tocar `WritableProgram` (que sigue siendo lo de la fase c).

**Tech Stack:** Electron, React 19, TypeScript, node-taglib-sharp, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-03-serato-fase-b-design.md` (y la fase a: `docs/superpowers/specs/2026-11-03-serato-cuarto-programa-design.md`).

## Global Constraints

- Worktree `/Users/vicent/code/surco/.claude/worktrees/serato-b`, rama `serato-b`; `node_modules` enlazado; biome desde `apps/desktop`.
  - Suite: `cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` (salida 0, sin `Errors`/`Unhandled`). No filtrar por ruta desde la raíz del repo.
  - Tipos: `cd apps/desktop && for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done` (el `tsc` pelado no comprueba nada).
  - Matriz: `cd apps/desktop && SURCO_MATRIX=1 node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx`; base: 126 pasan, 1 saltada, 4 fallos conocidos (K08, S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey) y la suite conocida "aiff appleMusic music retry source".
- TDD: test rojo primero; mutación a mano de cada pieza nueva (romper la implementación y ver el test caer, deshacer editando).
- Cero comentarios en el código (vale un `// @ts-expect-error` pelado). Sin `--no-verify`. Commits: título en inglés, sin cuerpo ni prefijos. No usar `git checkout`/`git stash` con trabajo sin commitear.
- Textos de UI en los 6 idiomas (es, en, de, fr, pt-BR, ja), sin guion largo ni dos puntos de explicación.
- Mocks de `window.api`: `vi.fn<Api['metodo']>()`.
- Selectores en tests: `data-testid`.
- Nunca escribir con Serato abierto; nunca tocar `master.sqlite`, `database V2` ni `.crate`.
- Valores medidos (no cambiar): MP3 con trama Xing/Info → Serato = Surco + `rekordboxShiftMs('.mp3', head, sr)` (51,2 ms para LAME a 44,1 kHz); MP3 sin ella → 0; M4A → Serato = Surco − `1024 / sr * 1000`; WAV/AIFF/FLAC → 0. El bloque v1 (`Serato Markers_` en ID3, `----:com.serato.dj:markers` en M4A) se quita siempre al escribir. GEOB con descripción Latin-1; etiqueta ID3 v2.3 en MP3, v2.4 en AIFF/WAV.

## Review Focus

- Un payload con entradas que Surco no entiende (`FLIP`, `BPMLOCK 1`, `LOOP` con nombre) debe salir idéntico salvo las `CUE`.
- Un fichero cuyos cues cambió Serato después de que el editor los leyera no se escribe (huella).
- Un MP3 sin cabecera Xing y uno con ella dan leads distintos (0 y 51,2); un MP3 con trama Info no-LAME da 1152 muestras.
- Escribir no cambia el audio: el fichero decodifica igual (patrón `assertDecodable`).
- Convertir un fichero con cues de Serato y también de Traktor conserva los dos.

---

### Task 1: codificador de `Markers2` y lector del `Tempo Map`

**Files:** `apps/desktop/src/shared/seratoMarkers.ts` (+ `.test.ts`), fixtures en `shared/seratoMarkersFixture.ts`.

**Interfaces — Produces:**
- `seratoPayloadOf(geobOrArmored)`: el payload crudo actual (para conservar lo desconocido). Nombre exacto a elección del implementador, exportado.
- `withSeratoCues(payload: Uint8Array | null, cues: SeratoCue[]): Uint8Array` — cambia solo las entradas `CUE` (cuerpo `00, índice, ms u32, 00, R, G, B, 00 00, nombre UTF-8, 00`), conserva el resto en orden; sin payload → `01 01` + `COLOR 00 FF FF FF` + cues + `BPMLOCK 00` + `00`.
- `seratoGeobBody(payload: Uint8Array): Uint8Array` — `01 01` + base64 sin `=` en líneas de 72 con `\n` + NUL hasta 470 bytes mínimo.
- `seratoArmored(payload: Uint8Array): string` — base64 sin `=` en líneas de 72 de `application/octet-stream\0\0Serato Markers2\0` + cuerpo GEOB.
- `readSeratoTempoMap(data: Uint8Array): { firstBeatMs: number; bpm: number } | null` — bytes `02 00` y recuento de marcadores u16 BE en los bytes 2-3; con 1 marcador → posición f64 BE en byte 4 (segundos), BPM f64 BE en byte 24; otro recuento → `null`. Y su variante armada para FLAC/M4A (cabecera `Serato Tempo Map\0`).

- [ ] Tests rojos: ida y vuelta (`markersFromGeob(seratoGeobBody(withSeratoCues(p, cues)))` devuelve los cues) con el payload real de la fixture; las entradas no-CUE salen byte a byte iguales; el cuerpo GEOB mide ≥470 y sus líneas ≤72; `markersFromArmored(seratoArmored(...))`; Tempo Map de Pray.mp3 (`02000001404689a229cf79f60000000100000000000000004060bfefabfa4db03fd0000000000000010000000000000000` → 45075,26 ms, 133,998 BPM); recuento 2 → `null`.
- [ ] Implementar; verde; mutación (no conservar una entrada desconocida → cae un test).
- [ ] Suite, tres tsc, biome. Commit `Encode Serato Markers2 cues and read the Serato tempo map`.

### Task 2: reloj de Serato y rejilla en la lectura

**Files:** `main/seratoClock.ts` (+ test), `main/seratoTags.ts`, `main/seratoCueSource.ts` (+ tests).

**Interfaces:**
- Consumes: Task 1; `rekordboxShiftMs`, `mp3Head`, `mpeg1Info` de `main/rekordboxTimeline.ts`.
- Produces: `seratoLeadMs(ext: string, head: Buffer, sampleRate: number): number` y `seratoLeadOfFile(file: string, sampleRate: number): Promise<number>` (valores de Global Constraints). `readSeratoTrack` devuelve además `tempoMap` y `sampleRate`. `seratoCueSource.trackCues` resta el lead a cues y loops, y con Tempo Map devuelve `analysed: true` y `grid` (golpes desde `firstBeatMs − lead` cada `60000/bpm` hasta `durationMs`, `beat` 1..4 empezando en 1 en el primer golpe, y hacia atrás hasta 0) y `gridFingerprint` de esa rejilla; sin Tempo Map, como hoy.
- [ ] Tests rojos: lead de una cabecera LAME 44,1 kHz = 51,18…; Info no-LAME = 1152/sr; sin Xing = 0; `.m4a` 44,1 kHz = −23,22; `.flac` = 0. `trackCues` de un MP3 con Xing y un cue de Serato a 3051 ms da 2999,8…; rejilla de un Tempo Map de 120 BPM a 1000 ms en WAV: golpes 500, 1000, 1500… con `beat` cíclico y 1 en 1000.
- [ ] Implementar; verde; mutación (signo del lead de M4A → cae).
- [ ] Suite, tres tsc, biome. Commit `Read Serato cues and its tempo map on Surco's clock`.

### Task 3: escritor de cues de Serato en el fichero

**Files:** `main/seratoCuesWrite.ts` (+ test); trabajo de worker si el patrón lo pide (`main/workerJobs.ts`).

**Interfaces:**
- Consumes: Task 1, Task 2; `rewriteTagFields`/`prepareTagRewrite` o el patrón de `rewriteCueTree` en `main/musicFieldWrite.ts`; `geobParts`, `keepGenreParentheses`, `dropBrokenUfids` y la regla de renderizar GEOB ajenos antes de guardar en `main/tags.ts`.
- Produces: `writeSeratoCues(file: string, wanted: SeratoCue[] /* reloj de Surco */, expectedFingerprint: string, deps): Promise<'written' | 'changed' | 'failed'>` — relee, compara huella (`cueFingerprint` de los cues leídos en reloj de Surco), pasa al reloj de Serato con el lead del fichero, construye el payload con `withSeratoCues` sobre el actual y lo escribe: ID3 → GEOB `Serato Markers2` Latin-1 (v2.3 en MP3, v2.4 en AIFF/WAV), quita GEOB `Serato Markers_`; FLAC → `SERATO_MARKERS_V2`; M4A → `----:com.serato.dj:markersv2` y quita `----:com.serato.dj:markers`. Original guardado sin mirar la política, verificación leyendo, `assertDecodable`, rename.
- [ ] Tests rojos sobre ficheros sintéticos de los cinco formatos (generados en el test como hace `seratoTags.test.ts`): escribe y `readSeratoMarkers` devuelve los cues en reloj de Serato; los loops y entradas desconocidas siguen; el v1 desaparece en MP3 y M4A; otras etiquetas (TRAKTOR4, título, carátula) intactas; huella distinta → `'changed'` y fichero sin tocar; el audio decodifica igual.
- [ ] Implementar; verde; mutación (no quitar el v1 → cae; escribir sin lead → cae).
- [ ] Suite, tres tsc, biome. Commit `Write Serato cues into the audio file`.

### Task 4: cola de cues de Serato en el proceso principal

**Files:** `shared/djProgram.ts` (tipo de programas con cues escribibles), `main/seratoCueSource.ts` → `CueSource`, `main/rekordboxCuesIpc.ts` (`writers`, `CUE_SAVE_ORDER`), `main/index.ts` (cola `serato-cue-queue.json`), `main/djProcesses.ts` si hace falta, `main/programQueue.ts`, tests de esos.

**Interfaces:**
- Produces: un tipo `CueProgram` (nombre a elección) = los cuatro, con su lista en orden `rekordbox, engine, traktor, serato` para el orden de guardado; `WritableProgram` no cambia. La cola de Serato se aplica con `isSeratoRunning` falso, nunca pide cerrar Serato (sin `quit`), espera con la vigilancia de 5 s; su `applyBatch` llama a `writeSeratoCues` por pista y devuelve el resultado como las otras.
- [ ] Tests rojos: `rekordbox:saveCues` con un id `serato:` encola en la cola de Serato y aplica (sustituye el test "never queues a Serato track's cues"); con Serato abierto queda en cola y se aplica cuando se cierra; huella cambiada → el renderer recibe el resultado de "cambiado" como en Engine; `queuedWanted` devuelve lo encolado.
- [ ] Implementar; verde; mutación.
- [ ] Suite, tres tsc, biome, matriz igual a la base. Commit `Queue Serato cue saves and write them once Serato is closed`.

### Task 5: editor de cues de Serato en el renderer

**Files:** `renderer/src/lib/cuePrograms.ts`, `renderer/src/components/CuesSection.tsx`, `renderer/src/hooks/useRekordboxQueue.ts` (`PROGRAM_QUEUES`), `App.tsx` (barras de cola, `cuesMarkable`), `CueWave.tsx` si hace falta, i18n de los 6 idiomas, tests (`CuesSection.serato.test.tsx`, `cuePrograms.test.ts`).

**Interfaces:**
- Consumes: Task 4 (IPC igual que los otros programas).
- Produces: Serato sin `readOnly`, `slots: { kinds: HOT_KINDS, pairCalls: false }`, color libre; el aviso de Serato abierto dice que se guardará al cerrarlo; la barra de cola de Serato como las otras; Auto mark disponible en filas de Serato con rejilla.
- [ ] Tests rojos (data-testid): una pista de Serato muestra el editor normal y Guardar llama a `saveRekordboxCues` con el id `serato:`; con Serato abierto se ve el aviso nuevo; Auto mark aparece con rejilla y no sin ella.
- [ ] Implementar; verde; mutación.
- [ ] Suite, tres tsc, biome. Commit `Edit Serato cues in the cue editor`.

### Task 6: cues entre programas con Serato

**Files:** `shared/types.ts`, `main/settings.ts` (`cueFlowToSerato`, por defecto `true` como los otros, normalizado igual), `renderer/src/lib/cueTwins.ts` (`FLOW_TO`), `renderer/src/components/settings/CuesTab.tsx`, `main/libraryFileUse.ts` (`TRACK_OF` de Serato por ruta en sus `database V2`), `main/index.ts` (cableado), `main/seratoCueSource.ts` (`dropInput`: el análisis de rekordbox del mismo fichero si existe, si no las palabras de Surco sobre la rejilla de Serato, como `engineDropInput`), tests.
- [ ] Tests rojos: un cue marcado en rekordbox con el flujo a Serato encola el gemelo de Serato pegado a su rejilla; al revés, de Serato a Engine; con `cueFlowToSerato` apagado no; ajustes muestra la casilla de Serato (data-testid `settings-cue-flow-to-serato`).
- [ ] Implementar; verde; mutación.
- [ ] Suite, tres tsc, biome. Commit `Carry flow cues to and from Serato`.

### Task 7: los cues de Serato al convertir

**Files:** `main/ffmpeg.ts` (ramas de copia, WAV/M4A, MP3/AIFF con valoración, rutas simples, FLAC), `main/tags.ts` (`copyCueFrames` deja de clonar GEOB de Serato), `main/workerJobs.ts` si hace falta, `main/cueMatrix.test.ts` (Serato en origen×destino), tests.

**Interfaces:**
- Consumes: Task 1-3; `cueShiftFor` y `rekordboxShiftOfFile`/`seratoLeadOfFile`.
- Produces: tras escribir la salida, si el origen tenía `Markers2`, la salida lleva uno nuevo: ms de origen − lead de origen − desplazamiento de la conversión + lead de salida, en cues y loops, resto del payload conservado; sin v1; sin Overview/Tempo Map/Autotags de Serato; `SERATO_MARKERS_V2` ya no llega como TXXX a destinos ID3.
- [ ] Tests rojos: matriz FLAC/MP3 con Xing/AIFF/WAV/M4A × FLAC/MP3/AIFF/WAV con cues de Serato: el cue cae en el mismo ms de Surco en la salida (±1 ms); con TRAKTOR4 además, los dos sobreviven; recorte de inicio desplaza los cues.
- [ ] Implementar; verde; mutación.
- [ ] Suite, tres tsc, biome, matriz igual a la base. Commit `Keep Serato cues when converting`.

### Task 8: pendientes de la fase (a) que tocan a la escritura

**Files:** `main/processTrack.ts` (rechazo de ids `serato:`), `main/libraryFileUse.ts` (`usedByLibrary` con Serato en lectura), `main/seratoLibrary.ts`/`seratoPlaylistsIpc.ts` (caché por mtime de `database V2` y `.crate`), tests.
- [ ] Tests rojos: convertir un id `serato:` en el proceso principal se rechaza con el mismo motivo que muestra el renderer; un fichero listado en un `database V2` cuenta como usado por la biblioteca (no se manda a la papelera); dos lecturas sin cambios de mtime leen los ficheros una vez.
- [ ] Implementar; verde; mutación.
- [ ] Suite, tres tsc, biome. Commit `Refuse Serato rows in conversion, count Serato in library use and cache its reads`.

### Task 9: cierre

- [ ] Matriz completa igual a la base. Mapa (`2026-11-03-serato-mapa.md`): marcar lo hecho de "Pendiente para la fase (b)".
- [ ] Prueba manual (controlador, no subagente) con copia exacta de `~/Music/Serato Pruebas`, `~/Music/_Serato_` y `master.sqlite`: driver de Surco con perfil aislado; editar cues de las 5 Pray, cerrar Surco, abrir Serato manejado por CGEvent, medir en píxeles que caen donde Surco dice; gemelos rekordbox→Serato; convertir un Clicks con cues de Serato y abrirlo en Serato.
- [ ] `git merge main`, suite, `git merge --ff-only serato-b` en el main local (sin push).
