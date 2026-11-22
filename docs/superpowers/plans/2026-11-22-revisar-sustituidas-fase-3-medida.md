# Revisar sustituidas, fase 3. Medir el desfase al sustituir y desplazar los cues en los cinco programas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando un trabajo trae `replacesPath`, Surco mide cuánto se ha movido el audio entre el fichero viejo y el nuevo y, si la medida es fiable, desplaza esa cantidad los cues de la pista en rekordbox, Engine DJ, VirtualDJ, Traktor y Serato. El resultado de la medida sale en el `ProcessResult` para que la fase 4 lo guarde.

**Architecture:** `bestLag` sale de `ffmpeg.ts` a un módulo puro (`pcmLag.ts`) para que el worker pueda usarlo. `measureReplaceShift` (en `ffmpeg.ts`) decodifica con ffmpeg dos ventanas de cada fichero, una cerca del principio y otra cerca del final, y manda la correlación al worker (`runInWorker`, tipo `replaceShift`), así el proceso principal no hace FFT. `convertAudio` mide contra el temporal terminado antes de copiar las marcas de Serato y antes del renombrado. Con la medida calcula el desplazamiento de cada programa sumando la diferencia de adelantos por códec, como ya hace la conversión normal, y lo pasa por las vías que ya existen.

**Tech Stack:** Electron (main), TypeScript, ffmpeg-static, worker_threads (`worker.ts` / `workerJobs.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-revisar-sustituidas-design.md` (sección 3, y las restricciones de la sección «Restricciones»).

## Global Constraints

- Esta fase va DESPUÉS de las fases 1 (`2026-11-22-revisar-sustituidas-fase-1-traktor.md`) y 2 (`2026-11-22-revisar-sustituidas-fase-2-serato.md`). Antes de la tarea 5 hay que comprobar con `grep` que en `convertAudio` existen `const replacedCueShift: CueShift = { shiftMs: 0 }` (fase 1, justo antes de `renameWithRetry`), `const replaceCueShiftMs = 0` (fase 2, justo antes del bloque `carrySerato`), `recordConversionPatch(..., replaces?: { path: string; cueShift: CueShift })`, `carrySeratoCues(source, dest, { trimMs, carry, strip, shiftMs })` y `RekordboxRepoint.replaced?: true`. Si algo difiere, se usa lo real y se dice en el informe.
- Decisiones de Vicent/coordinador ya tomadas: `traktorCueOffsetMs` se aplica en las sustituciones movidas como en cualquier conversión; los motivos de «sin mover» no llevan duraciones (el texto de la fase 4 es genérico por `UnmovedReason`); el fallo de Engine DJ con otra frecuencia se arregla en esta fase (tarea 6).
- TDD con fase roja: cada test se ve fallar antes de escribir el código y se apunta el mensaje del fallo.
- Los tests dicen POR QUÉ importa el comportamiento (un comentario encima de cada `it` con la consecuencia para el DJ, como en `convertRekordboxCueShift.test.ts`).
- El signo de cada programa se fija con un test que mueve un cue concreto (10 000 ms) y comprueba dónde cae. Nunca se deduce leyendo el código (memoria `cue-offset-signo-doble-negacion`: dos negaciones encadenadas ya engañaron tres veces).
- Mutación obligatoria de la regla de fiabilidad: romperla a propósito y ver el test en rojo, luego restaurarla (tarea 2) y del signo de cada programa (tareas 5, 6 y 7).
- Estilo del código existente. En `apps/desktop/src/main` la convención son comentarios que explican el porqué. Esto choca con la regla global «ZERO comments». Se sigue la convención del fichero (conformidad dentro del código base) y se avisa aquí.
- Un commit por funcionalidad, título descriptivo en inglés, sin cuerpo, sin `feat:`/`fix:`. Nunca `--no-verify`.
- Fixtures de audio sintéticos generados con ffmpeg dentro del test (patrón de `headOffset.test.ts`). Nunca la colección ni el audio de un DJ en un fixture.
- No se sube ningún namespace de caché ni se fuerza reanálisis en Surco. Los campos nuevos son opcionales (`replaceShift?`).
- La medida no puede bloquear el proceso principal más de 100 ms. La FFT va al worker y la decodificación en procesos ffmpeg.
- Una medida que falla nunca hace fallar la conversión. Solo la cancelación corta el trabajo.
- Comandos (el worktree no tiene `node_modules` propio):
  - Tests: `cd /Users/vicent/code/surco-revisar-sustituidas/apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/<fichero>.test.ts; echo EXIT=$?` y mirar también `grep -E "Unhandled|Errors "` en la salida.
  - Tipos: `cd /Users/vicent/code/surco-revisar-sustituidas/apps/desktop && node /Users/vicent/code/surco/node_modules/typescript/bin/tsc --build; echo EXIT=$?` (el `tsconfig.json` referencia node, web y scenarios).
  - Lint: `cd /Users/vicent/code/surco-revisar-sustituidas/apps/desktop && /Users/vicent/code/surco/node_modules/.bin/biome lint src; echo EXIT=$?` (lint entero, no por fichero).
- No se hace commit de este plan desde la tarea que lo escribe. Cada tarea hace sus propios commits.

### Convención de signo de `ReplaceShift` y su traducción por programa

`moved` son milisegundos medidos sobre el audio decodificado por ffmpeg. **Positivo = el audio del fichero nuevo empieza MÁS TARDE que el del viejo**: un sonido que en el viejo suena en `t` suena en el nuevo en `t + moved`. Por tanto un cue en `C` del viejo tiene que acabar en `C + moved` (más la diferencia de adelantos del programa).

| Programa | Vía existente | Valor con `{ moved: m }` | Con `{ unmoved }` |
|---|---|---|---|
| rekordbox | `RekordboxRepoint.audio.cueShiftMs` (`shiftCues` suma) | `Math.round(m + rbLead(nuevo) − rbLead(viejo))`, `rbLead` = `rekordboxShiftOfFile` | `0`, como hoy |
| Engine DJ | `engineShift.trimmedMs` (`shiftEnginePerformance` resta) | `trimmedMs = −Math.round(m)`, `sampleRateHz` = frecuencia real del nuevo, `sampleCount` si la conversión lo contó | `trimmedMs: 0` con `sampleRateHz` del nuevo (tarea 6: las posiciones de Engine son muestras y hay que reescalarlas aunque no se muevan en el tiempo) |
| VirtualDJ | el mismo `engineShift` (POI `−trimmedMs/1000` s) | sale solo de la fila de Engine: `+m/1000` s | POI sin mover (`trimmedMs: 0`) |
| Traktor | `replacedCueShift` de la fase 1 → `NmlPatch.cueShift.shiftMs` (`shiftCueStart` resta) | `−Math.round(m) − automaticCueOffsetOfFiles(viejo, tmp) − traktorCueOffsetMs` | `{ shiftMs: 0 }` (la fase 1 no registra `cueShift` con 0) |
| Serato | `replaceCueShiftMs` de la fase 2 → `carrySeratoCues(replacesPath, tmp, { trimMs: 0, shiftMs })` | `shiftMs = m` tal cual; `carrySeratoCues` ya suma `leadDest − leadSource`. `trimMs: 0` porque la medida contra el temporal ya incluye el recorte | `0` |

Engine y VirtualDJ no suman adelanto por códec porque la conversión normal tampoco lo hace (`rekordboxRepointFor` solo les pasa el recorte). Traktor conserva el ajuste del DJ (`traktorCueOffsetMs`) porque `cueShiftFor` lo aplica en toda conversión (decidido).

## Review Focus

1. **Sustitución sobre la misma ruta** (`output === replacesPath`): la medida tiene que leer el viejo antes del renombrado y Engine/VirtualDJ necesitan `fromBytes` (el tamaño del viejo) para aplicar el desplazamiento a una fila que ya apunta a esa ruta. Hoy `rekordboxRepointFor` lo descarta en toda sustitución. Test en la tarea 8 (`same path`) y en la tarea 5 (`fromBytes`).
2. **El viejo no se puede leer** (borrado entre el inicio del trabajo y la medida, NAS caído, fichero corrupto): la conversión termina bien y el resultado es `{ unmoved: 'unreadable' }`, sin mover nada. Test en la tarea 3 y en la tarea 8.
3. **Cancelar durante la medida**: lanza `conversionCancelled`, el viejo queda intacto y ningún ffmpeg de la medida sigue abierto (en Windows bloquearía el renombrado). Test en la tarea 8.
4. **Pista corta o ventana en silencio** (una herramienta de 40 s, una intro ambiental muda en el segundo 30): `{ unmoved: 'noMatch' }`, nunca un desplazamiento inventado. Tests en las tareas 2 y 3.
5. **Lote con dos pasos sobre la misma pista** (sustituir sobre la misma ruta y volver a convertir en el mismo lote, o sustituir dos veces): `stackRepoint` suma los dos movimientos porque el segundo se midió sobre el resultado del primero, y la frecuencia que queda es la del último fichero. Test en las tareas 5 y 6.

---

### Task 1: Sacar `bestLag` y la correlación a `pcmLag.ts` (refactor sin cambio de comportamiento)

**Files:**
- Create: `apps/desktop/src/main/pcmLag.ts`
- Modify: `apps/desktop/src/main/ffmpeg.ts:3410-3510` (constantes `PAIR_RATE`, `PAIR_SILENT_RMS`, `bestLag`, el bucle de correlación de `headOffsetMs`)
- Test: `apps/desktop/src/main/pcmLag.test.ts`

**Interfaces:**
- Consumes: `fft(re, im)` de `main/fft.ts`.
- Produces:
  - `export const PAIR_RATE = 44100`
  - `export function bestLag(a: Float32Array, b: Float32Array, from: number, reach?: number): number | null` (mismo cuerpo, mismo contrato: `a[i]` casa con `b[i + lag]`, ventana de 5 s, `reach` por defecto `PAIR_RATE`).
  - `export function correlationAt(a: Float32Array, aFrom: number, b: Float32Array, bFrom: number, width: number): number | null` (correlación normalizada sin quitar la media, como el bucle de `headOffsetMs`: `xy / sqrt(xx·yy)`; `null` si algún lado tiene energía 0).
  - `ffmpeg.ts` importa los tres y `headOffsetMs` usa `correlationAt(cur, 0, orig, lag, end)`.

- [ ] **Step 1: Escribir el test de caracterización** en `pcmLag.test.ts`. Ruido determinista en JS (LCG con semilla), 20 s a 44,1 kHz.
  - `it('says a copy delayed by 100 samples lines up 100 samples later')`: `b` = `a` con 100 ceros delante. `expect(bestLag(a, b, 5 * PAIR_RATE)).toBe(100)`. Comentario: el signo de toda la fase sale de aquí; positivo significa que `b` suena más tarde.
  - `it('says a copy cut 100 samples short lines up 100 samples earlier')`: `b = a.subarray(100)`. `toBe(-100)`.
  - `it('is null over a silent window')`: `a` de ceros. `toBeNull()`.
  - `it('correlates a copy with itself at 1 and unrelated noise far below 0.9')`: `correlationAt(a, 0, a, 0, 5 * PAIR_RATE)` ≈ 1 (`toBeCloseTo(1, 6)`); con otra semilla `< 0.2`.
- [ ] **Step 2: Ejecutarlo.** Falla con «Cannot find module './pcmLag'».
- [ ] **Step 3: Mover `bestLag`, `PAIR_RATE` y `PAIR_SILENT_RMS` a `pcmLag.ts`** con su comentario, añadir `correlationAt` extraído del bucle de `headOffsetMs` y hacer que `ffmpeg.ts` los importe. Ningún cambio de lógica.
- [ ] **Step 4: Ejecutar** `pcmLag.test.ts`, `headOffset.test.ts`, `sameMaster.test.ts` y `limiterGlimpse.ffmpeg.test.ts`. Todos verdes, `EXIT=0`, sin `Unhandled`.
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/pcmLag.ts apps/desktop/src/main/pcmLag.test.ts apps/desktop/src/main/ffmpeg.ts
git commit -m "Move the sample-lag search out of ffmpeg.ts so a worker can run it"
```

---

### Task 2: Tipo compartido y regla de fiabilidad pura

**Files:**
- Create: `apps/desktop/src/shared/replaceShift.ts`
- Create: `apps/desktop/src/main/replaceShiftMeasure.ts`
- Test: `apps/desktop/src/main/replaceShiftMeasure.test.ts`

**Interfaces:**
- Consumes: `bestLag`, `correlationAt`, `PAIR_RATE` (tarea 1).
- Produces (la fase 4 consume el tipo tal cual):

```ts
// shared/replaceShift.ts
export type UnmovedReason = 'noMatch' | 'drift' | 'unreadable'
export type ReplaceShift = { moved: number } | { unmoved: UnmovedReason }
```

  En `main/replaceShiftMeasure.ts`:
  - `export const REPLACE_REACH_SECONDS = 10` (provisional, lo fija la tarea 4)
  - `export const REPLACE_HEAD_AT_SECONDS = 30` (provisional; debe ser ≥ `REPLACE_REACH_SECONDS`)
  - `export const REPLACE_TAIL_BEFORE_END_SECONDS = 30` (provisional)
  - `export const REPLACE_TOLERANCE_MS = 2` (provisional)
  - `export const REPLACE_MIN_CORRELATION = 0.9`
  - `export const REPLACE_WINDOW_SECONDS = 5` (la ventana fija de `bestLag`)
  - `export interface ReplaceWindow { old: Float32Array; new: Float32Array }`: `old` son `REPLACE_WINDOW_SECONDS` del viejo desde un instante `t`; `new` son `REPLACE_WINDOW_SECONDS + 2·REPLACE_REACH_SECONDS` del nuevo desde `t − REPLACE_REACH_SECONDS`, ambos a `PAIR_RATE` mono.
  - `export function windowLagMs(w: ReplaceWindow): number | null`: desfase en ms (positivo = el nuevo más tarde) o `null` si la ventana está en silencio o la correlación en ese desfase es `< REPLACE_MIN_CORRELATION`.
  - `export function replaceShiftOf(head: ReplaceWindow | null, tail: ReplaceWindow | null): ReplaceShift`. Regla: cualquiera `null` → `{ unmoved: 'noMatch' }`; algún `windowLagMs` `null` → `'noMatch'`; `|head − tail| > REPLACE_TOLERANCE_MS` → `'drift'`; si no, `{ moved: Math.round(headMs) }`.

  Para `windowLagMs`, la ventana del viejo se alinea con la del nuevo colocándola `REPLACE_REACH_SECONDS·PAIR_RATE` muestras dentro de un buffer del largo de `new` y llamando a `bestLag(padded, w.new, reachSamples, reachSamples)`; la correlación se mide con `correlationAt(w.old, 0, w.new, reachSamples + lag, w.old.length)`.

- [ ] **Step 1: Escribir los tests** en `replaceShiftMeasure.test.ts` con ruido determinista en JS. Un helper `windowFor(source, newSource, tSec)` corta las dos ventanas igual que lo hará la tarea 3.
  - `it('moves the cues later when the new master starts 1.5 s later')`: nuevo = 1,5 s de ceros + viejo. `expect(replaceShiftOf(head, tail)).toEqual({ moved: 1500 })`. Comentario: positivo = suena más tarde; es el signo que traducen los cinco programas.
  - `it('moves them earlier when the new master lost 750 ms of lead-in')`: nuevo = viejo sin los primeros 0,75 s. `{ moved: -750 }`.
  - `it('leaves the cues alone when the end does not line up with the start')`: la cola del nuevo lleva 50 ms más de desfase que la cabeza (otro edit). `{ unmoved: 'drift' }`. Comentario: mover con una medida dudosa es la anti-meta; un cue a 50 ms se oye en cabina.
  - `it('leaves them alone when the end is another recording')`: cola del nuevo = otra semilla. `{ unmoved: 'noMatch' }`.
  - `it('leaves them alone when the start window is silent')`: cabeza del viejo a ceros. `{ unmoved: 'noMatch' }`.
  - `it('leaves them alone when the move is beyond the reach')`: nuevo = 12 s de ceros + viejo. `{ unmoved: 'noMatch' }`.
  - `it('leaves them alone when a window is missing because the track is short')`: `replaceShiftOf(head, null)` → `'noMatch'`.
  - `it('accepts two windows that agree within the tolerance')`: cola con `REPLACE_TOLERANCE_MS` exactos de más. `{ moved: 1500 }`.
- [ ] **Step 2: Ejecutarlos.** Fallan con «Cannot find module './replaceShiftMeasure'».
- [ ] **Step 3: Crear `shared/replaceShift.ts` e implementar `windowLagMs` y `replaceShiftOf`** con las constantes de arriba y un comentario que diga que son provisionales hasta el barrido de la tarea 4.
- [ ] **Step 4: Ejecutarlos.** Verdes, `EXIT=0`.
- [ ] **Step 5: Mutación.** Una a una, y restaurando tras cada una: (a) cambiar `> REPLACE_TOLERANCE_MS` por `> Infinity`; (b) quitar la comprobación de `REPLACE_MIN_CORRELATION`; (c) devolver `-headMs`. Cada mutación debe poner al menos un test en rojo; apuntar cuál. Si alguna sobrevive, añadir el test que falta antes de seguir.
- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/replaceShift.ts apps/desktop/src/main/replaceShiftMeasure.ts apps/desktop/src/main/replaceShiftMeasure.test.ts
git commit -m "Judge a replaced file's audio shift from a head and a tail window"
```

---

### Task 3: `measureReplaceShift` decodifica con ffmpeg y calcula en el worker

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (`decodePcm` ~3701, nueva función junto a `headOffsetMs`)
- Modify: `apps/desktop/src/main/workerJobs.ts` (unión `WorkerJob`, `WorkerJobResult`, `switch`)
- Test: `apps/desktop/src/main/replaceShift.ffmpeg.test.ts`

**Interfaces:**
- Consumes: `replaceShiftOf`, `ReplaceWindow`, constantes (tarea 2); `probeDuration(input, signal)` de `ffmpeg.ts`; `runInWorker(job, transfer)` de `worker.ts`.
- Produces:
  - `decodePcm` acepta `exactStart?: boolean`: con él, `-ss` va DESPUÉS de `-i` (ffmpeg decodifica desde el principio y descarta, posición exacta a la muestra). Sin él, todo igual que hoy.
  - Job de worker `{ type: 'replaceShift'; head: ReplaceWindow | null; tail: ReplaceWindow | null }` → `ReplaceShift` (añadido a `WorkerJobResult`).
  - `export async function measureReplaceShift(old: string, current: string, signal?: AbortSignal): Promise<ReplaceShift>` en `ffmpeg.ts`.

  Comportamiento: duración del viejo con `probeDuration`; `null` o fallo → `{ unmoved: 'unreadable' }`. Cabeza en `t = REPLACE_HEAD_AT_SECONDS`, cola en `t = duración − REPLACE_TAIL_BEFORE_END_SECONDS − REPLACE_WINDOW_SECONDS`; si la cola empieza antes de que acabe la cabeza, `tail = null`. Las cuatro decodificaciones van con `exactStart` (la búsqueda por la cabecera de un MP3 VBR puede caer desplazada y la cola parecería deriva) y en paralelo. Fallo al decodificar el viejo → `'unreadable'`; error de cancelación → se relanza (`isAbortError`). Las ventanas van al worker como transferibles (sus `.buffer`).

- [ ] **Step 1: Escribir los tests** con fixtures ffmpeg (patrón de `headOffset.test.ts`: `anoisesrc` rosa + clics, 90 s).
  - `it('measures a master with 1.5 s more lead-in as moved 1500 ms')`: nuevo = `adelay=1500:all=1` del viejo, en FLAC. `{ moved: 1500 }` con `Math.abs(moved - 1500) <= 1`.
  - `it('measures the same audio re-encoded as LAME MP3 as not moved')`: nuevo = viejo en MP3 320k (ffmpeg quita su propio retardo al decodificar). `{ moved: 0 }` (±1). Comentario: el adelanto de cada programa se suma aparte; aquí solo cuenta el audio.
  - `it('says unreadable when the old file is gone')`: ruta inexistente. `{ unmoved: 'unreadable' }`.
  - `it('says unreadable when the old file is not audio')`: fichero de texto con extensión `.mp3`. `'unreadable'`.
  - `it('says noMatch for a track too short for two windows')`: viejo de 40 s. `{ unmoved: 'noMatch' }`.
  - `it('hands the correlation to the worker, not the main process')`: `vi.mock('./worker', ...)` con `runInWorker` espía que delega en `runWorkerJob`; tras medir, `expect(runInWorker).toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceShift' }), expect.any(Array))`. Comentario: norma «Surco instantáneo», una FFT de 2²¹ puntos en el hilo principal pasa de 100 ms.
  - `it('rethrows a cancel')`: `AbortController` abortado antes de llamar; `rejects` con un error que `isAbortError` reconoce.
- [ ] **Step 2: Ejecutarlos.** Fallan porque `measureReplaceShift` no existe.
- [ ] **Step 3: Implementar** `exactStart` en `decodePcm`, el job en `workerJobs.ts` (llama a `replaceShiftOf`) y `measureReplaceShift`. `maxBufferMb` de cada decodificación dimensionado a su ventana (≤ 25 s mono f32 ≈ 4,4 MB, usar 8).
- [ ] **Step 4: Ejecutar** `replaceShift.ffmpeg.test.ts` y `headOffset.test.ts`. Verdes, `EXIT=0`, sin `Unhandled`.
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ffmpeg.ts apps/desktop/src/main/workerJobs.ts apps/desktop/src/main/replaceShift.ffmpeg.test.ts
git commit -m "Measure how far a replacement moved the audio, off the main thread"
```

---

### Task 4: Barrido sobre pares reales y constantes congeladas

**Files:**
- Create: `apps/desktop/src/main/replaceShiftSweep.test.ts`
- Modify: `apps/desktop/package.json` (script `"replace-sweep": "vitest run src/main/replaceShiftSweep.test.ts"`)
- Modify: `apps/desktop/src/main/replaceShiftMeasure.ts` (constantes y su comentario con las cifras medidas)

**Interfaces:**
- Consumes: `decodePcm` con `exactStart`, `windowLagMs`, constantes (tareas 2 y 3).
- Produces: valores finales de `REPLACE_REACH_SECONDS`, `REPLACE_HEAD_AT_SECONDS`, `REPLACE_TAIL_BEFORE_END_SECONDS`, `REPLACE_TOLERANCE_MS`.

Patrón de `bitsWindowSweep.test.ts`: `it.skipIf(!pairs)`, filas JSONL que se añaden según llegan y reanudación. Entrada: `SURCO_REPLACE_SWEEP_PAIRS`, un fichero de pares `viejo<TAB>nuevo`, o por defecto los pares confirmados de `~/Library/Application Support/Surco/matching-pairs.json` (misma pista, otro fichero: el caso real de una sustitución). Salida: `SURCO_REPLACE_SWEEP_OUT` (por defecto `~/surco-replace-sweep.jsonl`). Por cada par mide, con un alcance amplio de 30 s, el desfase y la correlación de cabeza y cola, y las duraciones. Además mide un control negativo: cada viejo contra el nuevo de otro par al azar (semilla fija).

- [ ] **Step 1: Escribir el barrido** (no es un test del código; un comentario de cabecera lo dice, como en `bitsWindowSweep.test.ts`) y el script de `package.json`.
- [ ] **Step 2: Comprobar que sin la variable sale como omitido** con `EXIT=0`.
- [ ] **Step 3: Lanzarlo sobre la biblioteca de Vicent** (solo lectura de ficheros de audio; no toca ningún programa): `SURCO_REPLACE_SWEEP_CONCURRENCY=4 caffeinate -dims node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/replaceShiftSweep.test.ts`. Debe dar filas para al menos 50 pares; si no hay tantos, decirlo y no congelar nada sin avisar.
- [ ] **Step 4: Fijar las constantes con estas reglas y apuntar las cifras en el comentario:**
  - `REPLACE_REACH_SECONDS`: el menor de {5, 10, 15, 20} que cubre el `|desfase de cabeza|` de todos los pares con correlación ≥ 0,9.
  - `REPLACE_HEAD_AT_SECONDS` y `REPLACE_TAIL_BEFORE_END_SECONDS`: los que dejan menos ventanas en silencio en el barrido, con la cabeza ≥ el alcance.
  - `REPLACE_TOLERANCE_MS`: el máximo `|cabeza − cola|` de los pares que casan en las dos ventanas, redondeado hacia arriba al ms, más 1 ms. Si ese valor pasa de 10 ms, parar y enseñárselo a Vicent: significaría masters con deriva real.
  - Condición dura: ningún par del control negativo sale fiable. Si alguno sale, subir `REPLACE_MIN_CORRELATION` hasta que ninguno salga y apuntarlo.
- [ ] **Step 5: Volver a ejecutar** `replaceShiftMeasure.test.ts` y `replaceShift.ffmpeg.test.ts` con las constantes nuevas. Si un test usaba un número ligado a una constante provisional (12 s fuera de alcance), se ajusta al valor nuevo y se dice en el informe.
- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/replaceShiftSweep.test.ts apps/desktop/package.json apps/desktop/src/main/replaceShiftMeasure.ts apps/desktop/src/main/replaceShiftMeasure.test.ts apps/desktop/src/main/replaceShift.ffmpeg.test.ts
git commit -m "Fix the replace-shift reach and tolerance from a sweep of real pairs"
```

---

### Task 5: rekordbox, Engine DJ y VirtualDJ reciben el desplazamiento de una sustitución

**Files:**
- Modify: `apps/desktop/src/main/rekordboxRepointFor.ts`
- Test: `apps/desktop/src/main/convertRekordboxRepoint.test.ts`
- Test: `apps/desktop/src/main/rekordboxBatch.test.ts`
- Test: `apps/desktop/src/main/engineRepoint.test.ts`

**Interfaces:**
- Consumes: `ReplaceShift` (tarea 2); `EngineShift`, `RekordboxRepoint`, `stackRepoint` existentes; `RekordboxRepoint.replaced?: true`, que la fase 2 ya pone en `rekordboxRepointFor` cuando hay `options.replaces` (se conserva tal cual; los cambios de aquí van en la misma rama `options.replaces`).
- Produces: `rekordboxRepointFor(input, output, options)` acepta en `options`:
  - `replaceShift?: ReplaceShift`
  - `replaceAudio?: { oldShiftMs: number; newShiftMs: number; sampleRateHz?: number; sampleCount?: number }` (adelantos de rekordbox del viejo y del nuevo, frecuencia real del nuevo y su largo en muestras si se contó).

  Con `replaces` y `replaceShift` `{ moved: m }`: `audio = { cueShiftMs: Math.round(m + newShiftMs − oldShiftMs) }`, `engineShift = { trimmedMs: -Math.round(m), sampleRateHz?, sampleCount? }`. Con `replaces` y `{ unmoved }` o sin `replaceShift`: `cueShiftMs: 0` si hay `audio`, como hoy (el `engineShift` de este caso lo cambia la tarea 6). Con `replaces === output` se conserva `fromBytes` (hoy se tira en toda sustitución); con `replaces !== output`, se sigue tirando. `replaced: true` sigue en todos los casos con `replaces`.

  **Paso separable (reanálisis de rekordbox, pendiente de confirmar por Vicent):** `audio` se crea en una sustitución cuando hoy se crearía (`options.audio` presente, el audio se reescribió) **y además** cuando hay `{ moved: m }` con `m !== 0` aunque las muestras se copiaran tal cual. `audio` vacía `AnalysisDataPath`/`Analysed` y rekordbox reanaliza al abrir, igual que hoy con una sustitución recodificada: la onda y la rejilla viejas ya no casan con el audio nuevo. Va en su propio test (paso 1, cuarto `it`) y en su propio commit (paso 9) para poder quitarlo sin tocar lo demás.

- [ ] **Step 1: Escribir los tests en `convertRekordboxRepoint.test.ts`:**
  - `it('moves rekordbox cues later by the measured shift plus the lead each file has')`: `replaces: '/m/a.mp3'`, `replaceShift: { moved: 1500 }`, `replaceAudio: { oldShiftMs: 51.18, newShiftMs: 0 }`, `audio` de hoy presente → `audio: { cueShiftMs: 1449 }`. Comentario: el kick que el DJ marcó en 10 000 ms en el MP3 LAME suena en el AIFF nuevo en 11 449 ms del reloj de rekordbox (regla medida el 24/10, rekordbox = ffmpeg + adelanto).
  - `it('moves Engine DJ positions by the measured shift, as a negative trim')`: mismo caso → `engineShift: { trimmedMs: -1500 }`.
  - `it('keeps today\'s untouched cues when the shift could not be trusted')`: `replaceShift: { unmoved: 'drift' }` → `audio: { cueShiftMs: 0 }`, `replaced: true` y `engineShift.trimmedMs` ausente o 0.
  - **(separable)** `it('has rekordbox re-analyse a moved replacement whose samples were copied')`: sin `options.audio`, `replaceShift: { moved: 200 }`, `replaceAudio: { oldShiftMs: 0, newShiftMs: 0 }` → `audio: { cueShiftMs: 200 }`. Comentario: la onda y la rejilla que rekordbox guarda son del fichero viejo; con el audio 200 ms más tarde, los cues movidos caerían fuera de su rejilla.
  - `it('keeps the old size when the replacement lands on the replaced path')`: `rekordboxRepointFor('/dl/a.flac', '/m/a.aiff', { replaces: '/m/a.aiff', fromBytes: 1234, replaceShift: { moved: 1500 }, ... })` → `fromBytes: 1234`. Comentario: sin él Engine DJ y VirtualDJ toman la fila por ya escrita y no mueven nada.
  - El test existente `leaves the cues alone when the conversion replaces a different file` sigue igual y debe seguir verde (sin `replaceShift` no hay medida).
- [ ] **Step 2: Escribir el test de signo de Engine en `engineRepoint.test.ts`** reutilizando la biblioteca sintética que ya usan los tests de `engineShift` (línea ~484): `it('lands a quick cue set at 10 s at 11.5 s after a replacement measured 1.5 s later')` con `engineShift: { trimmedMs: -1500 }`. Leer el cue de la fila y comprobar `11.5 s · rate` (±1 muestra).
- [ ] **Step 3: Escribir el test de lote en `rekordboxBatch.test.ts`:** `it('adds a second same-path replacement on top of the first')`: `stackRepoint({ from: p, to: p, audio: { cueShiftMs: 1449 }, engineShift: { trimmedMs: -1500 }, fromBytes: 10 }, { from: p, to: p, audio: { cueShiftMs: -26 }, engineShift: { trimmedMs: 26 } })` → `audio.cueShiftMs === 1423`, `engineShift.trimmedMs === -1474`, `fromBytes === 10`. Comentario: el segundo se midió contra el fichero que dejó el primero.
- [ ] **Step 4: Ejecutar los tres ficheros.** Los nuevos de los pasos 1 fallan (`audio.cueShiftMs` 0, sin `engineShift`, sin `fromBytes`); el de Engine y el de lote pueden pasar ya porque prueban vías existentes: en ese caso decirlo en el informe (son tests de signo, no de código nuevo) y comprobarlos con la mutación del paso 7.
- [ ] **Step 5: Implementar** las opciones nuevas en `rekordboxRepointFor`, todavía SIN la parte separable (`audio` solo cuando hoy se crearía). El test separable sigue en rojo; marcarlo `it.todo` hasta el paso 9 no vale (sería un test saltado), así que se deja fuera del fichero hasta el paso 9.
- [ ] **Step 6: Ejecutar** los tres ficheros más `libraryFlushes.test.ts`, `verifyRun.test.ts` y `virtualdjTrackWrite.test.ts`. Verdes, `EXIT=0`.
- [ ] **Step 7: Mutación de signo.** (a) `m + newShiftMs − oldShiftMs` → `−m + …`; (b) `trimmedMs: -Math.round(m)` → `Math.round(m)`. Cada una tiene que poner en rojo al menos un test; restaurar.
- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/rekordboxRepointFor.ts apps/desktop/src/main/convertRekordboxRepoint.test.ts apps/desktop/src/main/rekordboxBatch.test.ts apps/desktop/src/main/engineRepoint.test.ts
git commit -m "Shift rekordbox, Engine DJ and VirtualDJ cues by a measured replacement"
```

- [ ] **Step 9 (separable, quitar si Vicent dice que no): reanálisis de rekordbox en una sustitución copiada y movida.** Añadir el test separable del paso 1, verlo en rojo, crear `audio` también con `{ moved: m }`, `m !== 0`, verlo en verde y ejecutar `convertRekordboxRepoint.test.ts` y `rekordboxLibrary.test.ts`. Commit propio:

```bash
git add apps/desktop/src/main/rekordboxRepointFor.ts apps/desktop/src/main/convertRekordboxRepoint.test.ts
git commit -m "Have rekordbox re-analyse a moved replacement whose samples were copied"
```

---

### Task 6: Engine DJ reescala los cues de una sustitución con otra frecuencia (fallo que ya existe)

Hoy una sustitución no pasa `engineShift`, así que la fila de Engine conserva la frecuencia del fichero viejo. Engine guarda cues, loops y rejilla en muestras: si el viejo era de 44,1 kHz y el nuevo de 48 kHz, un cue en la muestra 441 000 (10 s) pasa a sonar a 9,19 s. Ocurre también cuando la medida no es fiable, y por eso se arregla aparte de la medida.

**Files:**
- Modify: `apps/desktop/src/main/rekordboxRepointFor.ts`
- Test: `apps/desktop/src/main/convertRekordboxRepoint.test.ts`
- Test: `apps/desktop/src/main/engineRepoint.test.ts`
- Test: `apps/desktop/src/main/rekordboxBatch.test.ts`

**Interfaces:**
- Consumes: `replaceAudio.sampleRateHz` y `replaceAudio.sampleCount` (tarea 5; los rellena `convertAudio` en la tarea 8 con la frecuencia real del temporal, `probeAudio(tmp).sampleRate`, no con `plan.sampleRateHz`, que solo existe cuando hay remuestreo); `shiftEnginePerformance` (reescala con `to = sampleRateHz ?? from` y no hace nada si coincide con la de la fila).
- Produces: en toda sustitución con `replaceAudio.sampleRateHz`, `engineShift` existe aunque la medida no sea fiable: `{ trimmedMs: 'moved' in shift ? -Math.round(shift.moved) : 0, sampleRateHz, ...(sampleCount ? { sampleCount } : {}) }`. VirtualDJ recibe así `trimmedMs: 0` en el caso no fiable: POI sin mover (su `shiftedAlready` mira `!!trimmedMs`, no se activa).

- [ ] **Step 1: Escribir los tests:**
  - En `convertRekordboxRepoint.test.ts`: `it('tells Engine DJ the new file\'s rate even when the shift could not be trusted')`: `replaces`, `replaceShift: { unmoved: 'noMatch' }`, `replaceAudio: { oldShiftMs: 0, newShiftMs: 0, sampleRateHz: 48000 }` → `engineShift: { trimmedMs: 0, sampleRateHz: 48000 }` y `audio.cueShiftMs` 0 si hay `audio`.
  - En `engineRepoint.test.ts`, con la biblioteca sintética de los tests de `engineShift` (~549): `it('keeps a cue at 10 s at 10 s when a 44.1 kHz track is replaced by a 48 kHz one')`: fila a 44 100 con un quick cue en la muestra 441 000, `engineShift: { trimmedMs: 0, sampleRateHz: 48000 }` → el cue queda en 480 000 (±1). Comentario: sin reescalar sonaría a 9,19 s, en cabina.
  - En `rekordboxBatch.test.ts`: `it('keeps the last file\'s rate when a same-path replacement is converted again')`: `stackRepoint({ from: p, to: p, engineShift: { trimmedMs: 0, sampleRateHz: 48000 } }, { from: p, to: p, engineShift: { trimmedMs: 0, sampleRateHz: 44100 } })` → `engineShift.sampleRateHz === 44100`.
- [ ] **Step 2: Ejecutar.** El primero falla (sin `engineShift`). Los otros dos prueban vías existentes y pueden pasar ya: decirlo en el informe y comprobarlos con la mutación del paso 5.
- [ ] **Step 3: Implementar** el `engineShift` de sustitución en `rekordboxRepointFor`.
- [ ] **Step 4: Ejecutar** los tres ficheros más `virtualdjTrackWrite.test.ts`, `verifyEngine.test.ts` y `libraryFlushes.test.ts`. Verdes, `EXIT=0`.
- [ ] **Step 5: Mutación.** Quitar `sampleRateHz` del `engineShift` de sustitución → el primer test en rojo; en `shiftEnginePerformance` cambiar `shift.sampleRateHz ?? from` por `from` → el de `engineRepoint.test.ts` en rojo. Restaurar.
- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/rekordboxRepointFor.ts apps/desktop/src/main/convertRekordboxRepoint.test.ts apps/desktop/src/main/engineRepoint.test.ts apps/desktop/src/main/rekordboxBatch.test.ts
git commit -m "Rescale Engine DJ cues when a replacement has another sample rate"
```

---

### Task 7: Desplazamiento de Traktor para una sustitución

**Files:**
- Create: `apps/desktop/src/main/replaceCueShift.ts`
- Test: `apps/desktop/src/main/replaceCueShift.test.ts`

**Interfaces:**
- Consumes: `ReplaceShift` (tarea 2); `CueShift` de `tags.ts:359`; `shiftCueStart` de `traktor4.ts:153`.
- Produces: `export function traktorReplaceShift(shift: ReplaceShift, codecMs: number, userOffsetMs: number): CueShift`. `{ moved: m }` → `{ shiftMs: -Math.round(m) - codecMs - userOffsetMs }`; `{ unmoved }` → `{ shiftMs: 0 }`. Con 0 la fase 1 no registra `cueShift` y los CUE_V2 viajan byte a byte. `codecMs` es `automaticCueOffsetOfFiles(replacesPath, tmp)` y `userOffsetMs` es `traktorCueOffsetMs` leído como en `cueShiftFor` (un valor no numérico cuenta como 0). La tarea 8 pone el resultado en la constante `replacedCueShift` de la fase 1.

- [ ] **Step 1: Escribir los tests:**
  - `it('lands a Traktor cue set at 10 000 ms at 11 500 ms when the new master starts 1.5 s later')`: `const s = traktorReplaceShift({ moved: 1500 }, 0, 0)`; `expect(shiftCueStart(0, 10000, s.shiftMs)).toBe(11500)`. Comentario: `shiftCueStart` resta; leer solo una de las dos líneas da el signo al revés (memoria del 09/09).
  - `it('adds what Traktor draws ahead of a new MP3')`: `codecMs = 50` → `shiftCueStart(0, 10000, …) === 11550`.
  - `it('keeps the DJ\'s own Traktor offset, as every conversion does')`: `userOffsetMs = -20` → `11480`.
  - `it('leaves Traktor cues where they were when the shift could not be trusted')`: `{ unmoved: 'noMatch' }` con `codecMs = 50` y `userOffsetMs = -20` → `{ shiftMs: 0 }`. Comentario: anti-meta, ni siquiera el ajuste del DJ se aplica sobre una medida dudosa.
- [ ] **Step 2: Ejecutar.** Falla por módulo inexistente.
- [ ] **Step 3: Implementar** `traktorReplaceShift`.
- [ ] **Step 4: Ejecutar.** Verde. Mutar el signo de `m` y ver rojo; restaurar.
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/replaceCueShift.ts apps/desktop/src/main/replaceCueShift.test.ts
git commit -m "Work out the Traktor cue shift for a measured replacement"
```

---

### Task 8: `convertAudio` mide la sustitución y reparte el desplazamiento

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (`ConversionWritten` ~2144; `convertAudio`: la constante `replaceCueShiftMs` y el bloque `carrySerato` ~2589, las lecturas de adelanto ~2680, la constante `replacedCueShift` antes de `renameWithRetry`, la llamada a `rekordboxRepointFor`; retorno ~2800)
- Test: `apps/desktop/src/main/convertReplaceShift.test.ts`

**Interfaces:**
- Consumes: `measureReplaceShift` (tarea 3); `rekordboxRepointFor` con `replaceShift`/`replaceAudio`/`fromBytes` (tareas 5 y 6); `traktorReplaceShift` (tarea 7); `rekordboxShiftOfFile`, `automaticCueOffsetOfFiles`, `isSameFile`, `probeAudio`.
  - **De la fase 1:** `const replacedCueShift: CueShift = { shiftMs: 0 }` justo antes de `renameWithRetry` y `recordConversionPatch(..., replacesPath ? { path: replacesPath, cueShift: replacedCueShift } : undefined)`.
  - **De la fase 2:** `const replaceCueShiftMs = 0` justo antes del bloque `carrySerato`, que se pasa como `shiftMs` a `carrySeratoCues(replacesPath ?? input, tmp, { trimMs, carry, strip, shiftMs })` cuando hay `replacesPath`; `carrySeratoCues` suma él mismo la diferencia de reloj entre códecs. `RekordboxRepoint.replaced?: true` y `seratoCarryFailed?: true` siguen igual.
- Produces:
  - `ConversionWritten.replaceShift?: ReplaceShift`, presente si y solo si el trabajo traía `replacesPath`.
  - **Dónde se mide:** una vez, justo antes de `replaceCueShiftMs` / `carrySerato`. Es antes de `proveDecodable` (después de esa prueba nada puede escribir el temporal) y después de la última escritura de audio del temporal. Con un `AbortController` vigilado por `isCancelled` como el bloque `measuring`; si se cancela, `errorWithKey('conversionCancelled')` y no queda ningún ffmpeg de la medida vivo. Cualquier otro fallo ya llega como `'unreadable'`.
  - Serato: `const replaceCueShiftMs = 'moved' in shift ? shift.moved : 0` y, en una sustitución, `trimMs: 0` en el trabajo `carrySeratoCues` (la medida contra el temporal ya incluye el recorte; pasarlo además lo restaría dos veces). Sin `replacesPath`, `trimMs` como hoy.
  - Antes del renombrado y solo si hay `replacesPath`: `oldShiftMs = rekordboxShiftOfFile(replacesPath, rateOld)` (`rateOld` de `probeAudio(replacesPath)` cuando es `.m4a`, 44100 si no, igual que `sourceRate`), `newShiftMs = outputShiftMs`, `newRate = Number((await probeAudio(tmp)).sampleRate)`, `codecMs = automaticCueOffsetOfFiles(replacesPath, tmp)`, `oldBytes = (await stat(replacesPath)).size` si `isSameFile(replacesPath, output)`. Todo antes del renombrado porque el nuevo puede caer en la ruta del viejo. Un fallo de estas lecturas deja el valor neutro (0, sin `newRate`, sin `oldBytes`), nunca hace fallar la conversión.
  - rekordbox/Engine/VirtualDJ: `rekordboxRepointFor(..., { replaces, replaceShift: shift, replaceAudio: { oldShiftMs, newShiftMs, sampleRateHz: newRate, sampleCount }, fromBytes: oldBytes ?? fromBytes })`.
  - Traktor: `const replacedCueShift = traktorReplaceShift(shift, codecMs, traktorCueOffsetMs)`.

- [ ] **Step 1: Escribir los tests** en `convertReplaceShift.test.ts`, con `vi.mock('./rekordboxBatch', ...)`, `vi.mock('./nmlBatch', () => ({ recordNmlPatch: vi.fn() }))` y `getSettings` con `syncTraktor: true`, `traktorNmlPath: '/x.nml'`, `traktorCueOffsetMs: 0` (patrón de `convertRekordboxCueShift.test.ts`). Viejo = WAV de 90 s a 44,1 kHz de ruido rosa con clics; nuevo = el mismo con `adelay=1500` en FLAC; salida AIFF.
  - `it('shifts every program by 1.5 s when the new master starts 1.5 s later')`: `written.replaceShift` = `{ moved: 1500 }` (±1); repoint con `replaced: true`, `audio.cueShiftMs` 1500 (±1) y `engineShift` `{ trimmedMs: −1500 (±1), sampleRateHz: 44100 }`; parche NML con `cueShift.shiftMs` −1500 (±1).
  - `it('adds rekordbox\'s lead of the old LAME MP3')`: viejo re-firmado LAME (helper `lameMp3` de `convertRekordboxCueShift.test.ts`, 90 s de ruido) → `cueShiftMs` ≈ 1449.
  - `it('applies the DJ\'s Traktor offset on a moved replacement')`: `traktorCueOffsetMs: -51` → `cueShift.shiftMs` ≈ −1449.
  - `it('moves nothing and says why when the new file is another recording')`: nuevo de otra semilla → `{ unmoved: 'noMatch' }`, `cueShiftMs` 0, `engineShift.trimmedMs` 0, parche sin `cueShift`.
  - `it('rescales Engine DJ to a 48 kHz replacement it could not measure')`: nuevo de otra semilla a 48 kHz → `engineShift` `{ trimmedMs: 0, sampleRateHz: 48000 }`.
  - `it('measures before the rename when the new file takes the replaced path')`: `output === replacesPath`. `{ moved: 1500 }`, repoint con `from === to` y `fromBytes` = tamaño del viejo antes de convertir.
  - `it('finishes the conversion when the old file cannot be read')`: `replacesPath` inexistente → la conversión resuelve, el fichero existe, `{ unmoved: 'unreadable' }`.
  - `it('stops on a cancel during the measurement and leaves the old file as it was')`: `isCancelled` pasa a `true` en cuanto empieza la medida (espía sobre `measureReplaceShift` o un `isCancelled` que cuenta llamadas) → rechaza con la clave `conversionCancelled`; el sha256 del viejo no cambia y no queda temporal.
  - `it('carries the replaced file\'s Serato cues 1.5 s later, without counting the trim twice')`: viejo con marcas de Serato (`makeSeratoSource` de `cueMatrix.test.ts`, cue en 10 000 ms) y un recorte de 0,5 s en el trabajo; el nuevo lleva `adelay=1500` → `measured` ≈ 1000, y la salida lee el cue en ≈ 11 000 ms (±1) más la diferencia de reloj de códec que ya aplica `carrySeratoCues` (0 entre WAV y AIFF).
  - `it('reports no replace shift on an ordinary conversion')`: sin `replacesPath` → `written.replaceShift` `undefined`.
- [ ] **Step 2: Ejecutar.** Fallan (sin `replaceShift`, `cueShiftMs` 0, `replacedCueShift` 0).
- [ ] **Step 3: Implementar** el cableado en `convertAudio` según «Produces».
- [ ] **Step 4: Ejecutar** `convertReplaceShift.test.ts`, `convertRekordboxCueShift.test.ts`, `convertCues.test.ts`, `cueMatrix.test.ts`, `convertNmlReplace.test.ts`, `convertNmlCueShift.test.ts`, `ffmpeg.cancel.test.ts`, `replaceFlow.test.ts` y `replaceInLibrary.test.ts`. Verdes, `EXIT=0`, sin `Unhandled`.
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ffmpeg.ts apps/desktop/src/main/convertReplaceShift.test.ts
git commit -m "Measure a replacement before the rename and shift its cues in every program"
```

---

### Task 9: El resultado del trabajo lleva `replaceShift`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`ProcessResult` ~1438)
- Modify: `apps/desktop/src/main/processTrack.ts` (los dos `return` de éxito ~1300 y ~1321)
- Test: `apps/desktop/src/main/processTrack.test.ts`

**Interfaces:**
- Consumes: `ConversionWritten.replaceShift` (tarea 8), `ReplaceShift` (tarea 2).
- Produces: `ProcessResult.replaceShift?: ReplaceShift`, con un comentario que diga que lo guarda la lista «To review» (fase 4). Presente en los dos retornos de éxito cuando `written.replaceShift` existe.

- [ ] **Step 1: Escribir los tests** en `processTrack.test.ts` con el `deps.convertAudio` falso que ya usa el fichero:
  - `it('hands the measured shift of a replacement to the renderer')`: `written.replaceShift = { moved: 120 }`, `job.replacesPath` puesto → `result.replaceShift` igual.
  - `it('hands it back on an Apple Music only replacement too')`: mismo con el modo «Apple Music only».
  - `it('says nothing about a shift on an ordinary conversion')`: sin él → `'replaceShift' in result === false`.
- [ ] **Step 2: Ejecutar.** Fallan los dos primeros.
- [ ] **Step 3: Implementar** el campo y los dos `...(written.replaceShift ? { replaceShift: written.replaceShift } : {})`.
- [ ] **Step 4: Ejecutar** `processTrack.test.ts` y `processTrackMatrix.test.ts`. Verdes. `tsc --build` con `EXIT=0`.
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/processTrack.ts apps/desktop/src/main/processTrack.test.ts
git commit -m "Return a replacement's measured shift with the job result"
```

---

### Task 10: Suite entera, lint, tipos y prueba real con copia

**Files:** ninguno nuevo (el spike de la prueba real va en el scratchpad, sin commit).

- [ ] **Step 1: Suite entera** desde `apps/desktop`: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run > /tmp/suite.txt 2>&1; echo EXIT=$?` y `grep -E "Unhandled|Errors |failed" /tmp/suite.txt`. `EXIT=0`, ningún `Unhandled`. Los únicos omitidos son los barridos con `skipIf`; listarlos en el informe.
- [ ] **Step 2: Lint entero y `tsc --build`.** Los dos con `EXIT=0` y sin avisos.
- [ ] **Step 3: Avisar a Vicent antes de tocar rekordbox** y esperar su sí. Pedirle que cierre rekordbox, Engine DJ y Traktor.
- [ ] **Step 4: Prueba real en rekordbox con copia** (patrón de `repoint-mp3-cues-desplazados.md`): sha256 de `master.db` y de la carpeta de análisis guardados; copia de respaldo en `~/rekordbox-respaldo-prueba-sustituidas`. Importar en rekordbox un MP3 LAME sintético (ruido + clics cada 0,437 s, nunca música de la colección) con 4 hot cues sobre clics. Generar el «nuevo» con 1,5 s más de silencio delante en FLAC y sustituir con `convertAudio` real y `repointTracks` (spike en el scratchpad, no en el repo). Abrir rekordbox, dejar que reanalice y comprobar a ojo con Vicent que cada cue cae en su clic; anotar `cue − clic` por cue (esperado ≤ 2 ms). Si el paso separable de la tarea 5 sigue en el plan, repetir con un «nuevo» AIFF copiado tal cual (sin recodificar) y comprobar que rekordbox reanaliza y los cues caen en el clic. Restaurar la colección y comprobar que el sha256 vuelve a ser el mismo; borrar ANLZ y audio de prueba.
- [ ] **Step 5: Engine DJ y Traktor con copia, VirtualDJ sin copia** (norma de la memoria): el mismo par sintético; un cue a 10 s en cada programa debe quedar a 11,5 s. En Engine, además, un par 44,1 → 48 kHz no medible (otra semilla) con el cue a 10 s debe seguir sonando a 10 s. Restaurar Engine y Traktor desde su copia con sha256 igual. En VirtualDJ borrar después la pista de prueba.
- [ ] **Step 6: Informe final**: qué se verificó en qué programa, cifras de `cue − clic`, sha256 de restauración, y lo que no se pudo probar (Serato en la app de Serato si no está instalado, por ejemplo). Nada de merge: la rama espera a la fase 4 (memoria «no mergear hasta probar todo»).

---

## Riesgos y decisiones que revisar

- **Reanálisis en rekordbox (pendiente de que Vicent lo confirme; planificado como SÍ).** Hoy `audio` en el reapuntado también vacía `AnalysisDataPath` y rekordbox reanaliza al abrir, igual que hoy en una sustitución recodificada. El paso 9 de la tarea 5 lo extiende a la sustitución copiada tal cual con el audio movido, porque la onda y la rejilla viejas ya no casan con el audio nuevo. Va en su propio test y commit; si Vicent dice que no, se quita ese paso y, en ese caso, rekordbox se queda sin mover los cues.
- **VirtualDJ en la misma ruta:** `shiftedAlready` da por ya desplazada una fila si el largo del viejo y del nuevo coincide dentro de la tolerancia. Un master con `m` ms más de cabeza y `m` ms menos de cola no se desplazaría. Es raro, pero existe; si la prueba real lo muestra, se trata aparte.
- **Coste en NAS:** la cola se decodifica desde el principio (`exactStart`) para no fiarse de la búsqueda en MP3 VBR. En un recurso SMB lento son unos segundos más por sustitución, fuera del proceso principal.
- **Pistas cortas** (< cabeza + ventana + cola, unos 65 s con los valores provisionales): siempre `'noMatch'`. El barrido dirá cuántas son.
- **Verificación de Traktor:** la fase 1 deja dicho que, con `cueShift` presente, la comprobación posterior no compara posiciones. Esta fase no lo cambia; la prueba real del paso 5 de la tarea 10 es la que comprueba las posiciones.
