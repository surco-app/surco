# Rendimiento de la app de escritorio (medicion, 12/11, build `out/` de main f125f3b62)

Solo lectura: no se toco el repo. Banco y scripts en `scratchpad/review/dp/` (bench.mjs, prec.mjs, profile.mjs, prof2.mjs, prof3.mjs, open4.mjs, timeline.mjs). Biblioteca sintetica en `scratchpad/review/perf-lib/` (VirtualDJ database.xml con 8000 canciones, 30 listas de 300, hardlinks de Pray.mp3/.flac/.m4a en 900 carpetas). No encontre un arnes de 8000 pistas en el repo (solo `enginePerformanceFixture.ts` y los tests); lo construi desde cero. Ventana 1320x820, `--force-device-scale-factor=1`, user-data-dir aislado.

## Resumen
1. La interaccion normal esta dentro de presupuesto: seleccionar fila 32-47 ms, tecla 20-33 ms, buscar en 8000 pistas ~130-146 ms tras la ultima tecla, cambiar de lista ~72 ms, arrastrar el playhead de cues a 16,7 ms/frame sin una sola long task.
2. El peor punto medido es abrir "All tracks" con 8000 pistas: las filas salen a los ~190 ms, pero despues el hilo del renderer queda ocupado ~1,7 s con frames de 100 ms (10 fps), 3 de 3 runs. El perfil lo atribuye a `addPaths` (useTrackLibrary.ts:379), 1,4 s de tiempo propio.
3. Cada seleccion paga ~100 ms de CPU en `useIsFetching` (CuesSection.tsx:563) porque cada evento de la cache de TanStack Query recorre todas las queries (`findAll`); crece con el tamano de la biblioteca.
4. Hacer scroll por "All tracks" mete en la cola de analisis TODA fila que pasa por pantalla (146 en 100 ticks de rueda) y cada resultado recalcula agregados sobre 8000 filas en App (1,1 s de render de App en ~4 s de scroll).
5. Arranque en frio: FCP ~180 ms, rail visible a ~327 ms desde el inicio de navegacion (~510 ms desde el arranque del proceso); en reposo con la biblioteca cargada y el analisis terminado el CPU es ~0 y el DOM no muta.

## Entorno y ruido
Load average (uptime) al empezar cada medicion: warm-1 `84,8/38,7/17,0` (muy cargada, es el run con p95 de scroll 34 ms y max 83), warm-2 `10,5/22,8/17,5`, warm-3 `11,7/20,5/17,0`, cold `10,8/27,1/18,1`, prec.mjs `13,7/21,1/18,6`. Otras sesiones corrian tests, asi que los picos aislados (frame max 50-100 ms en `cuePlaying`/`searchType`) los trato como ruido, y los numeros robustos son los que se repiten en las 3 corridas. Cada run = proceso nuevo; "warm" = cache de lecturas ya en disco, "cold" = user-data-dir vacio (lee 8000 ficheros).

## Tabla de escenarios (mediana de 3 runs warm salvo indicacion)
| Escenario | Mediana | Peor | Presupuesto DJ | Estado |
|---|---|---|---|---|
| FCP en arranque | 180 ms (176/180/264) | 264 | <500 ms | OK |
| Rail visible (navegacion -> interactivo) | 327 ms (327/327/312) | 327 | <1 s | OK |
| Proceso -> inicio de navegacion | 182 ms (193/182/174) | 193 | | OK |
| Abrir pestana VirtualDJ (arbol con 8001) | 203 ms (203/209/177) | 209 | 100-200 ms | limite |
| Abrir "All tracks" hasta primera fila | 188 ms (188/218/184) | 218 | 200 ms | OK |
| ...hilo ocupado despues de abrir "All tracks" | ~1,7 s a 10 fps (frames de 100 ms, 3/3 runs, load 13) | long tasks 125-130 ms | frames 16 ms | MAL |
| Scroll lento (120 px/16 ms), frame p95 | 17,6 ms (34/17,6/17,6) | max 83 ms (run con load 85) | 16,7 ms | OK |
| Scroll rapido (900 px/16 ms), frame max | 18 ms | 18 | 16,7 ms | OK |
| Salto por scrollbar, tiempo a pintar | 30-33 ms | 33 | 100 ms | OK |
| Scroll durante lectura en frio (8000 ficheros, 18-22 s) | p95 33 ms, 3-6 frames >50 ms | max 67 ms | 16,7 ms | flojo |
| Seleccionar fila (clic) -> editor actualizado | 39 ms (32-47, n=8) | 47 | 100 ms | OK |
| Seleccionar con ArrowDown | 62 ms (34-87, n=8) | 87 | 100 ms | OK, peor que clic |
| Primer seleccion -> editor + onda de cues | 398 ms (warm) / 1511 ms (cold, analisis en curso) | 1511 | 500 ms | cold flojo |
| Teclear en buscador, tecla -> pintado | 21 ms (20-33) | 33 | 100 ms | OK |
| Buscar en 8001, ultima tecla -> lista filtrada | 144 ms (129/144/146) | 146 | 200 ms | OK |
| Cambiar de lista (300 filas), clic -> pintado | 72 ms (n=1 fiable; el resto no discriminable) | ~130 en bench (incluye overhead de Playwright) | 100 ms | OK |
| Volver a "All tracks" 8001 | 40 ms (38-42) | 42 | 100 ms | OK |
| Arrastrar playhead en editor de cues | frame p95 17,6 ms, 0 long tasks | 18 | 16,7 ms | OK |
| Reproducir con editor de cues 4 s | frame p95 17,6; max 18/100/51 (picos con load) | 100 | | OK salvo ruido |
| Zoom de la onda de cues | no medible: `cue-zoom-in` deshabilitado con la pista del fixture | | | sin dato |
| Idle sin seleccion, biblioteca cargada y analisis terminado | Browser 0-0,1 %, Tab 0,1 %, 0 mutaciones/3 s (timeline.mjs, idle2.mjs) | | ~0 | OK |
| Idle durante analisis de fondo | Browser 3-4 %, ~22 mutaciones/3 s (input `track-search` atributo `name` y `open-activity`) | | | menor |
| Lectura en frio de 8000 pistas | 18-22 s; main (Browser) 10-18 % CPU; renderer 1-2 %; 0 long tasks | | | OK |
| Memoria tras cargar 8001 (warm, tras GC) | main heap 121 MB, RSS main 457 MB (base 277); heap renderer sin GC llego a 342-747 MB | | | ver H5 |

## Hechos medidos vs hipotesis
Medido: todo lo de la tabla; los perfiles CDP con sourcemaps de `profile.mjs`/`prof2.mjs`/`prof3.mjs`; el recuento de mutaciones por testid; la cola de analisis "x/146" tras 100 ticks de rueda. Hipotesis: la causa exacta (numero de lotes) de H1, y las ganancias esperadas.

## Hotspots ordenados

### H1. `addPaths` cuadratico al volcar la biblioteca (abrir "All tracks")
- Evidencia medida: perfil al abrir All tracks, 2117 ms ocupados; `qe` = `addPaths` src/hooks/useTrackLibrary.ts:379 con 1407 ms de tiempo propio, llamado desde el listener `onExpandedBatch` (useTrackLibrary.ts:918). En paralelo `open4.mjs` (3/3 runs): long tasks 125-130 ms y frames de 100 ms entre +0,57 s y +2,25 s tras el clic.
- Codigo: cada llamada reconstruye `new Set(tracksRef.current.map(...))` y `alreadyInFiles` sobre todas las filas (useTrackLibrary.ts:387-390) y copia el array dos veces (`[...tracksRef.current, ...bases]`, `setTracks(prev => [...prev, ...bases])`). Con un lote por carpeta es O(N x lotes).
- Hipotesis: son ~900 lotes (una carpeta por artista en mi fixture, ~9 ficheros por carpeta). No cuente los lotes reales; una biblioteca con menos carpetas grandes lo sufriria menos, una con carpetas de 1-2 ficheros, mas.
- Arreglo: conjuntos `inputPath`/`inFiles` persistentes en refs actualizados de forma incremental, y fusionar los lotes que llegan en el mismo tick/frame en un solo `setTracks`.
- Ganancia esperada: de ~1,4 s de CPU a <100 ms; frames de 100 ms a ~16 ms al abrir. Esfuerzo: S-M (los tests de dedupe de streamed/duplicados ya existen y lo cubren).

### H2. `useIsFetching` recorre toda la cache en cada evento
- Evidencia: en "select other x4" 410 ms inclusivos en `findAll` (queryCache.js:198) <- `useIsFetching.js:42` <- notifyManager; auto 142 ms en `utils.js:132` (`partialMatchKey/matchQuery`). El unico consumidor es src/components/CuesSection.tsx:563 (`useIsFetching({ queryKey: gridFitQuery(cue.contentId).queryKey })`). ~100 ms de CPU por seleccion, ~110 ms por cada 4 flechas.
- Arreglo: observar solo esa query (por ejemplo `useQuery` con esa key y `enabled:false` leyendo `isFetching`, o `useSyncExternalStore` sobre `queryCache.find`) en lugar de un `findAll` por evento.
- Ganancia: ~100 ms de hilo por seleccion (no cambia la latencia percibida de 39 ms pero libera el hilo para la onda y el siguiente clic) y deja de crecer con la biblioteca. Esfuerzo: S.

### H3. Cada resultado de analisis recalcula agregados sobre 8000 filas en App
- Evidencia (prof3, scroll de 100 ticks): `App` (hK, App.tsx:352) 1126 ms inclusivos; `(anon)` App.tsx:2266 (`qualityCounts`/facets) 467 ms, `qualityCounts` triage.ts:552 224 ms, `playlistView.ts:65` 225 ms, App.tsx:2080 251 ms; origen: `setData` de queryClient (src/lib/queryClient.ts:30, 143 ms) por cada resultado de analisis.
- Hipotesis: el recalculo se dispara por cada `filterFacts`/pista nueva con veredicto. Arreglo: agrupar los resultados de analisis por frame (un solo `setQueryData` en lote) y/o tallies incrementales. Ganancia esperada: 2-4x menos render de App durante el analisis. Esfuerzo: M.

### H4. El scroll encola para analisis cada fila que pasa
- Evidencia: tras 100 ticks de rueda (idle3.mjs) la cabecera marca "Measuring loudness, BPM and key... 8/146" y avanza 1 pista cada ~3 s; 1940 mutaciones `aria-posinset/setsize` durante el scroll (ya optimizado por perf-react).
- Codigo: App.tsx:2049-2056 anade a `seenInAll` toda fila que entra en vista (solo hay un debounce `SEEN_SETTLE_MS`, no hay permanencia minima) y `sweepScope` (App.tsx:2136) manda esas filas al barrido.
- Es probablemente intencionado ("lo que ha visto el usuario"); el coste es CPU de ffmpeg durante minutos y la tormenta de H3. Arreglo: exigir que la fila lleve visible ~250-300 ms (o que el scroll se detenga) antes de entrar en `seenInAll`. Ganancia: evita cientos de analisis al arrastrar la barra. Esfuerzo: S.

### H5. Lectura en frio (8000 ficheros): 18-22 s con scroll flojo
- Medido: p95 33 ms y 3-6 frames >50 ms al hacer scroll durante la lectura; primera seleccion con onda 1511 ms frente a 398 ms en caliente. El CPU es del proceso main (10-18 %), el renderer solo 1-2 %. No hay long tasks, asi que lo atribuyo a competencia por CPU, no a JS del renderer. Mi fixture reutiliza 3 ficheros, asi que el coste real por pista (lectura de tags de ficheros distintos) puede ser mayor. Sin accion clara; solo vigilar. Memoria: el working set del main llego a 1,5 GB en la lectura en frio frente a 0,95 GB en caliente (medida de `getAppMetrics`, no distingue cache del SO); tras GC el heap del main es 121 MB. No investigue la causa del pico.

### H6. Menores
- ArrowDown (34-87 ms) es mas lento que el clic (32-47 ms); no lo perfile, puede ser el `scrollIntoView` del reveal.
- Ruido en reposo durante el analisis: el atributo `name` del input `track-search` muta ~7 veces/s y `open-activity` otras ~3/s (22 y 10 mutaciones por 3 s); inofensivo pero indica un re-render al ritmo del progreso.
- Abrir la pestana VirtualDJ (~200 ms) incluye leer y parsear un database.xml de 3,6 MB; no lo perfile en el main.

## Lo que NO es problema (medido)
Scroll rapido y salto por scrollbar a 16,7 ms; arrastre del playhead sin long tasks; teclear en el buscador; DOM de ~1000 nodos con 8001 pistas (virtualizacion funciona); reposo a ~0 % CPU.

## Limites de esta medicion
Una sola biblioteca sintetica (VirtualDJ) y una pista real repetida; no medi Traktor/rekordbox/Engine ni el editor de cues con onda ampliada (zoom deshabilitado). Sin React Profiler (no hay build de profiling); atribucion por perfil de CPU con sourcemaps. Frame times medidos con rAF y Event Timing, sin trazas de GPU.
