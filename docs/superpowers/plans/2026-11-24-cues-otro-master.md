# Cues al sustituir por otro master

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando la pista nueva es otro master de la misma pista (otra cabecera, otra ecualización, una velocidad algo distinta), Surco no puede alinearla al sample y hoy deja los cues donde estaban, a cientos de ms de su golpe. Con este plan Surco mide el desfase por la envolvente en seis ventanas, mueve los cues si las seis coinciden, y en rekordbox los encaja en la rejilla nueva cuando rekordbox la analiza.

**Caso real que lo origina (24/11):** `01 World Of Dreams (Paramount Mix).mp3` sustituido por la AIFF del FLAC `Gregory B - World of dreams (original paramount mix '95)`. Las ventanas de la medida exacta dan una correlación de 0,13 a 0,25 (umbral 0,95), así que el resultado fue `{ unmoved: 'noMatch' }`. El audio nuevo suena unos 290 ms antes (de −297 a −252 ms según la ventana, porque los masters corren a velocidad algo distinta). Los cues se quedaron 70 a 97 ms antes del segundo golpe del compás en la rejilla nueva de rekordbox, en vez de en el primero.

**Medida que fija las reglas (prototipo 24/11 sobre las parejas de `~/surco-replace-sweep.jsonl`):** 163 parejas que la medida exacta ya alinea (verdad conocida), 58 parejas de la misma pista que no alinea, 424 negativas (419 al azar y 5 de Matching) y World of Dreams.

- Envolvente: RMS en bloques de 10 ms (100 Hz) del audio mono a 4000 Hz, en log (`Math.log(rms + 1e-4)`). Seis ventanas de 30 s del viejo, empezando en 30, 60 y 90 s y terminando 30, 60 y 90 s antes del final (es decir, empiezan en `dur − 60`, `dur − 90`, `dur − 120`). Cada ventana busca el desfase con correlación de Pearson en ±5 s a paso de 10 ms.
- Ajuste fino: envolvente de ataques (RMS en bloques de 1 ms y diferencia positiva entre bloques seguidos), Pearson en ±60 ms alrededor del desfase grueso, a paso de 1 ms, sobre los mismos 30 s.
- Regla: las seis ventanas existen, cada una con correlación gruesa ≥ 0,5, y todos los desfases finos caben en 50 ms. El desplazamiento es la media de los seis, redondeada.
- Resultado: 159 de 163 exactas movidas con un error máximo de 0,43 ms frente a la verdad al sample. 19 de 58 de otro master movidas. World of Dreams movida (media ≈ −275 ms). 0 de 424 negativas. En las negativas, como mucho 2 de 6 ventanas coinciden dentro de 50 ms. Las de otra velocidad (la deriva crece en línea recta, de −109 a −566 ms en una) y las ediciones no pasan y siguen sin moverse, que es lo correcto.
- Con una o dos ventanas no basta. En World of Dreams el pico correcto saca solo 0,015 a 0,03 al pico de un golpe antes (−710 ms), así que la seguridad viene de que coincidan las seis, no de un margen.

**Architecture:** `masterShiftOf(old, current)` en `replaceShiftMeasure.ts` es pura y va al worker (tipo de trabajo nuevo `masterShift`). `measureReplaceShift` (en `ffmpeg.ts`) solo la llama cuando la medida exacta da `noMatch`. Decodifica los dos ficheros enteros a 4000 Hz mono, unos 10 MB cada uno para 10 minutos. El resultado es `{ moved, master: 'other' }`. Ese `moved` ya llega a los cinco programas por las vías que existen. Además `rekordboxRepointFor` marca `reanalyse` y `snapToGrid`. `repointTracks` devuelve los cues ya desplazados de esas filas, y `repointRekordbox` los apunta en la lista de pendientes (`rekordboxProvisional`), que los encaja en la rejilla de rekordbox cuando la analiza, con su regla de un cuarto de golpe.

**Tech Stack:** Electron (main), TypeScript, ffmpeg-static, worker_threads, Vitest.

## Global Constraints

- Worktree: `/Users/vicent/code/surco/.claude/worktrees/cues-otro-master` (rama `cues-otro-master`, desde `main` f9cbb2b21). No tiene `node_modules` propio, se usan los de `/Users/vicent/code/surco/node_modules`.
- Comandos, siempre desde `apps/desktop` del worktree:
  - Tests: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/<fichero>.test.ts; echo EXIT=$?`, mirando también `grep -E "Unhandled|Errors "` en la salida. Nunca filtrar por ruta desde la raíz del repo.
  - Tipos: `node /Users/vicent/code/surco/node_modules/typescript/bin/tsc --build; echo EXIT=$?` (cubre node, web y scenarios). `tsc` a secas no comprueba nada.
  - Lint: `/Users/vicent/code/surco/node_modules/.bin/biome lint src; echo EXIT=$?`. No ejecutar `npm run check`, que reformatea el repo entero.
- TDD con fase roja: cada test se ve fallar antes de escribir el código y se apunta el mensaje del fallo.
- Mutación obligatoria: romper la regla a propósito (las seis ventanas, el umbral 0,5, la tolerancia de 50 ms, y `snapToGrid`) y ver el test en rojo, luego restaurarla.
- Los tests dicen POR QUÉ importa (un comentario encima de cada `it` con la consecuencia para el DJ, como en `replaceShiftMeasure.test.ts`).
- Comentarios: en Surco se escriben los que explican el porqué (CLAUDE.md del proyecto manda sobre la regla global de cero comentarios). Nada de comentarios que repitan el código.
- Fixtures de audio sintéticos con ffmpeg dentro del test (patrón de `replaceShift.ffmpeg.test.ts`). Nunca audio ni colección de un DJ.
- Nada de subir un namespace de caché ni de forzar reanálisis en Surco. Campos nuevos opcionales (`master?`, `snapToGrid?`, `settleOnGrid?`).
- El proceso principal no se bloquea más de 100 ms: las correlaciones van al worker, la decodificación en ffmpeg.
- Una medida que falla nunca hace fallar la conversión. Solo la cancelación corta el trabajo.
- Un commit por funcionalidad, título descriptivo en inglés, sin cuerpo y sin `feat:`/`fix:`. Nunca `--no-verify`. Antes de cada commit, `git branch --show-current` tiene que decir `cues-otro-master`.
- Código sin uso se borra en su commit.

## Review Focus

1. Que la medida exacta siga mandando. El método nuevo solo corre con `noMatch`, nunca con `drift` (un paso constante entre cabeza y cola es una edición) ni con `unreadable`.
2. El signo. `moved` positivo significa que el audio nuevo suena más tarde, igual que en la medida exacta. En World of Dreams sale negativo.
3. Pistas cortas. Si alguna de las seis ventanas no cabe (la pista dura menos de 150 s, o el nuevo es tan corto que la búsqueda se sale), el resultado es `noMatch`.
4. Que el encaje en la rejilla solo afecte a rekordbox, solo a filas sustituidas por otro master, y que `sameSet` de `adjustmentOps` lo deje en paz si el DJ toca los cues antes del análisis.

---

### Task 1: `masterShiftOf`, la medida por envolvente (pura)

**Files:**
- Modify: `apps/desktop/src/main/replaceShiftMeasure.ts`
- Test: `apps/desktop/src/main/replaceShiftMeasure.test.ts`

- [ ] Constantes exportadas con un comentario que resuma la medida de este plan (números de arriba): `MASTER_RATE = 4000`, `MASTER_WINDOW_SECONDS = 30`, `MASTER_REACH_SECONDS = 5`, `MASTER_EDGES_SECONDS = [30, 60, 90]`, `MASTER_MIN_CORRELATION = 0.5`, `MASTER_TOLERANCE_MS = 50`, `MASTER_FINE_REACH_MS = 60`.
- [ ] `export function masterShiftOf(old: Float32Array, current: Float32Array): number | null`. Las dos entradas son el fichero entero, mono, a `MASTER_RATE`. Devuelve el desplazamiento en ms (positivo = el nuevo suena más tarde) o null. Algoritmo, el mismo del prototipo:
  - Envolvente gruesa: para cada bloque de 40 muestras (10 ms), `Math.log(Math.sqrt(media de x²) + 1e-4)`.
  - Envolvente fina: para cada bloque de 4 muestras (1 ms), `rms`, y luego `d[i] = max(0, rms[i] − rms[i−1])`.
  - Para cada inicio `s` en segundos (30, 60, 90, dur−120, dur−90, dur−60, con `dur = old.length / MASTER_RATE`): si `s < 0` o `s + 30 > dur`, devuelve null. Curva gruesa: Pearson entre `eo[s·100 … +3000]` y `en[s·100 + L …]` para `L` en −500…500, saltando los `L` que se salen de `en`. Si no hay ningún `L` válido, null. Coge el mejor `L` y su correlación. Fino: Pearson entre `fo[s·1000 … +30000]` y `fn[s·1000 + L' …]` para `L'` en `10·L − 60 … 10·L + 60`, y se queda con el mejor `L'` (ms).
  - Si alguna correlación gruesa es < 0,5, null. Si `max − min` de los seis finos es > 50, null. Si no, `Math.round(media)`.
  - Pearson con la media quitada, y −1 cuando alguna varianza es 0 (silencio).
- [ ] Tests (señales sintéticas generadas en el test, sin ffmpeg, a `MASTER_RATE`). La «música» es ruido modulado por una envolvente con secciones de distinta duración y nivel, más golpes cada 0,42 s, para que la estructura no sea periódica:
  - Otro master 290 ms antes (se quitan 290 ms del principio y se filtra con un paso bajo simple) da −290 ±2. Por qué: es el caso de World of Dreams, y sin mover los cues quedan un golpe fuera.
  - 750 ms más tarde (se añade silencio delante) da +750 ±2. Fija el signo.
  - Con una deriva de velocidad de 100 ppm (remuestreo lineal) sigue moviendo, con un valor entre los desfases de cabeza y cola. Por qué: dos masters reales corren a velocidad algo distinta (World of Dreams deriva 30 ms en la pista).
  - Una edición, con 4 s cortados a mitad de pista, da null. Por qué: los cues de después caerían 4 s fuera.
  - Otra pista (otra semilla de ruido y otras secciones) da null.
  - Pista de 140 s da null (no caben seis ventanas).
  - El nuevo en silencio da null.
- [ ] Mutaciones: cambiar «seis» por «cinco» (aceptar un fallo), subir la tolerancia a 5 000 y bajar 0,5 a −1. Cada una tiene que poner algún test en rojo. Restaurar.
- [ ] Commit: `Measure a replacement's shift on the envelope when it is another master`

### Task 2: El trabajo del worker y `measureReplaceShift` lo usan cuando la medida exacta no encaja

**Files:**
- Modify: `apps/desktop/src/shared/replaceShift.ts` (`ReplaceShift = { moved: number; master?: 'other' } | { unmoved: UnmovedReason }`)
- Modify: `apps/desktop/src/main/workerJobs.ts` (tipo `{ type: 'masterShift'; old: Float32Array; current: Float32Array }` que devuelve `number | null`)
- Modify: `apps/desktop/src/main/ffmpeg.ts` (`measureReplaceShift`)
- Test: `apps/desktop/src/main/replaceShift.ffmpeg.test.ts`

- [ ] En `measureReplaceShift`, después de `runInWorker` del tipo `replaceShift`: si el resultado es `{ unmoved: 'noMatch' }` y las dos ventanas de cabeza del viejo se leyeron, decodificar los dos ficheros enteros con `decodePcm(input, { sampleRate: MASTER_RATE, maxBufferMb, signal })`. `maxBufferMb` sale de la duración (`probeDuration` del viejo ya está; para el nuevo se usa la misma con un margen, por ejemplo `Math.ceil((duración + 60) · MASTER_RATE · 4 / 1e6) + 1`). Mandarlos al worker (`masterShift`, transfiriendo los buffers). Con un número, devolver `{ moved: n, master: 'other' }`; con null, el `noMatch` de antes. Un fallo de decodificación o del worker deja el `noMatch` (solo la cancelación se relanza, como el resto de la función). Comentario del porqué: la medida exacta exige el mismo master, y sin esto otro master deja los cues a cientos de ms.
- [ ] Tests nuevos en `replaceShift.ffmpeg.test.ts`. Hace falta un viejo con estructura: la `music()` actual es ruido rosa constante más clics, sin secciones, y la envolvente no tendría con qué alinear. Crear `structuredMusic(path, seconds)` con secciones de distinto volumen (`volume='…':eval=frame` con tramos de duración irregular) sobre ruido rosa más golpes. El otro master se deriva con `adelay=300`, un paso bajo (`lowpass=6000`), una pizca de velocidad (`asetrate=44100*1.0001,aresample=44100`) y MP3 a 192k. Hay que comprobar dentro del test (con `replaceShiftOf` y las ventanas, o con `measureReplaceShift` sin el método nuevo en la fase roja) que la medida exacta de ese fixture da `noMatch`. Si no lo da, ajustar el fixture hasta que lo dé y decirlo en el informe.
  - Otro master 300 ms más tarde da `{ moved: ≈300 (±10), master: 'other' }`.
  - Otra pista estructurada (otra semilla) da `{ unmoved: 'noMatch' }`.
  - Los tests de siempre (1500 ms de cabecera, el MP3 re-codificado, unreadable, el nuevo que falta o no es audio, la pista corta, worker y cancelación) siguen pasando sin tocarlos. El de 1500 ms tiene que seguir sin `master`.
  - El método nuevo también va al worker: `runInWorker` llamado con `expect.objectContaining({ type: 'masterShift' })` en el caso de otro master.
- [ ] Commit: `Fall back to the envelope measure when a replacement is another master`

### Task 3: rekordbox reanaliza y encaja en su rejilla los cues de otro master

**Files:**
- Modify: `apps/desktop/src/main/rekordboxBatch.ts` (`RekordboxRepoint.snapToGrid?: true`, con un comentario del porqué; `stackRepoint` lo conserva como hace con `reanalyse`, `...(stacks && earlier.snapToGrid ? { snapToGrid: true as const } : {})`)
- Modify: `apps/desktop/src/main/rekordboxRepointFor.ts`
- Modify: `apps/desktop/src/main/rekordboxLibrary.ts` (`repointTracks`)
- Modify: `apps/desktop/src/main/libraryFlushes.ts` (`repointRekordbox`, `LibraryHost`)
- Modify: `apps/desktop/src/main/index.ts` (el `repoint` de la cola de rekordbox y el `LibraryHost`)
- Tests: `apps/desktop/src/main/convertRekordboxRepoint.test.ts` o el test de `rekordboxRepointFor` que exista, el test de `stackRepoint`, el de `repointTracks` (`rekordboxLibrary*.test.ts`) y el de `libraryFlushes` que cubra `repointRekordbox`. Buscar con `grep -rln` y seguir el patrón de cada uno.

- [ ] `rekordboxRepointFor`: con `replaceShift` `{ moved, master: 'other' }`, `reanalyse` es true (la rejilla y la onda del viejo master no describen el nuevo aunque los cues se muevan) y la fila lleva `snapToGrid: true`. El desplazamiento de cues es el mismo que con una medida exacta. Con una medida exacta todo sigue igual (sin `reanalyse` por esta vía y sin `snapToGrid`).
- [ ] `repointTracks`: en la misma transacción, después de `shiftCues`, para cada fila con `snapToGrid` leer los cues vivos (`liveCues(write, w.id)` de `rekordboxCues.ts`) y quedarse con los que no son loop, como `{ id, ms, kind, color }`. El resultado escrito lleva `settleOnGrid: WantedCue[]` cuando hay alguno. Ampliar `RepointResult` con ese campo opcional.
- [ ] `repointRekordbox(collectionPath, list, sessions, provisional)`: con cada resultado escrito que traiga `settleOnGrid`, `provisional.add({ contentId: result.id, label, wanted })`, donde `label` es el nombre del fichero nuevo sin extensión. Si hay `ids` (varias filas), una entrada por id con los cues de cada una (que `repointTracks` devuelva los cues por id). Un `provisional` es `Pick<ProvisionalList, 'add'>`.
- [ ] `LibraryHost` gana `provisional: Pick<ProvisionalList, 'add'>`. En `index.ts` se le pasa `provisionalCues`, y el `repoint` de la cola de rekordbox llama a `repointRekordbox(collectionPath, list, sessions, provisionalCues)`. Ojo: `provisionalCues` se declara más abajo que la cola en `index.ts`. Si el orden lo impide, pasar un cierre (`{ add: (e) => provisionalCues.add(e) }`) o mover la declaración, y decirlo en el informe.
- [ ] Tests, cada uno con su porqué:
  - `rekordboxRepointFor` con otro master da `reanalyse: true`, `snapToGrid: true` y `audio.cueShiftMs` igual que con la medida exacta del mismo valor. Con la exacta, sin `snapToGrid`.
  - `stackRepoint` conserva `snapToGrid` cuando la segunda conversión parte del resultado de la primera.
  - `repointTracks` sobre una colección de fixture (el patrón de sus tests): una fila con un hot cue en 10 000 ms, `audio.cueShiftMs = −290` y `snapToGrid` devuelve `settleOnGrid` con ese cue en 9 710 ms. Sin `snapToGrid` no devuelve nada.
  - `repointRekordbox` (o la capa que lo envuelva) llama a `provisional.add` con ese id y esos cues, y no la llama sin `settleOnGrid`.
  - Ya existe la prueba de que `adjustmentOps` encaja en la rejilla. Añadir una de punta a punta si el fixture lo permite: entrada pendiente con un cue a 9 710, rejilla de rekordbox con golpe en 9 700, y el cue acaba en 9 700.
- [ ] Mutación: quitar `snapToGrid` en `rekordboxRepointFor` y ver en rojo el test de `repointRekordbox` o el de punta a punta.
- [ ] Commit: `Settle a replacement's cues on rekordbox's new grid when it is another master`

### Task 4: Barrido que deja escrita la medida

**Files:**
- Create: `apps/desktop/src/main/replaceMasterSweep.test.ts`

- [ ] Igual que `replaceShiftSweep.test.ts`: no es un test del código sino la medida que fija las constantes, y solo corre con una variable de entorno (`SURCO_MASTER_SWEEP_ROWS=/Users/…/surco-replace-sweep.jsonl`). Sin la variable, el `it` se salta (`it.skipIf`). Lee las filas de ese barrido (pares `old`/`new`, `kind` y las ventanas h90/t90 de alcance 5 para saber cuáles alinea la medida exacta), decodifica cada fichero a 4000 Hz con ffmpeg, llama a `masterShiftOf` y escribe un resumen como el de este plan: exactas movidas con su error máximo frente a la verdad, otro master movidas y negativas movidas. Concurrencia 4. Salida en `SURCO_MASTER_SWEEP_OUT` (por defecto `~/surco-master-sweep.txt`).
- [ ] No hace falta ejecutarlo en la tarea (tarda unos 30 minutos y lee del NAS). La tarea solo comprueba que compila y que sin la variable se salta.
- [ ] Commit: `Add the sweep that fixes the envelope measure's rules`

### Task 5: Cierre

- [ ] Suite entera de escritorio desde `apps/desktop` (`node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run; echo EXIT=$?`), con el código de salida 0 y sin `Unhandled Errors`. Un test que solo pase suelto está roto.
- [ ] `tsc --build` y lint de escritorio y de web, sin avisos.
