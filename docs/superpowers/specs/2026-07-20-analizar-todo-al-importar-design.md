# Analizar todo al importar para llenar la caché de una vez

## Problema

Un usuario (Djotas) reporta: al cargar una pista, Surco analiza silencios,
clips, calidad, etc.; si cierra el programa y vuelve a importar la misma pista,
"vuelve a analizar lo mismo y es lento". Pide que se guarde todo lo que se
calcula para una pista, y evitar recalcularlo en importaciones futuras.

### La causa raíz: no es la caché, es el disparador

La caché a disco **ya existe y ya funciona**. `main/analysisCache.ts` persiste
en `userData/analysis-cache/`, con clave `sha1(namespace + inputPath + mtimeMs)`
(`analysisCache.ts:16-18`). Ya cachea, sobreviviendo a reinicios, casi todos los
análisis pesados: `spectrogram-mono-v13`, `waveform-v5`, `channelscan-v1`
(clipping), `loudness`, `clickcount-v2`, `bpm`, `key`, `properties`. Como la
clave incluye el `mtime`, reimportar un fichero **sin cambios** acierta en caché
y **no vuelve a decodificar con ffmpeg**. La UI de Settings → General ya la
expone ("Analysis cache · Empty cache").

Lo que hace percibir la lentitud es **cuándo** se lanzan los análisis, no si se
cachean. Hoy se disparan de forma **perezosa**:

- En import solo corre `readMeta` (tags + duración + carátula) y, si
  `autoAnalyze && showSpectrum`, un prefetch del **espectro** (`App.tsx:499-500`).
- El resto se dispara al **hover** (`App.tsx:581-608`), al **seleccionar/abrir**
  cada sección del editor (hooks `useWaveform`, `useTrackLoudness`, `useBpm`,
  `useKey`, `useClicks`, `useTrackProperties`, `useWaveformScan`), o con el botón
  manual **"Analyze all"** (`useQualityAnalysis.ts`).

Así, al reabrir la librería, cada análisis se calcula la primera vez que el
usuario toca la pista: *parece* que recalcula todo, cuando en realidad es la
primera vez que se lanza esta sesión (el resultado sí queda cacheado a disco
después).

## Decisión

Analizar **todo** al importar, llenando la caché existente de forma anticipada,
para que al reabrir la librería todo esté ya listo y ningún análisis se dispare
al tocar cada pista. No se toca la caché a disco ni el proceso `main`: solo
cambia **qué** se barre y **cuándo** se dispara, en el renderer.

### Fuera de alcance (seguimiento aparte)

`readMeta` (tags + duración + carátula embebida) y la extracción de carátula
**no** pasan por la caché a disco; se releen en cada import. Son lecturas
ligeras de ffprobe (no decodifican el audio entero), así que no explican la
lentitud reportada. Se dejan fuera de este trabajo.

## Diseño

Enfoque: **extender el barrido existente** (`useQualityAnalysis`) para que cubra
el set completo de análisis, y **dispararlo automáticamente al importar** en vez
de solo bajo el botón "Analyze all". Reutiliza la maquinaria ya endurecida del
sweep: concurrencia 3, focus-gate (pausa si la ventana pierde foco), cancelación
y progreso. La caché a disco persiste el resultado, por lo que reimportar el
mismo fichero son aciertos de caché.

### El set completo que barre el sweep

Hoy el worker hace `fetchQuery` de 3 análisis (`useQualityAnalysis.ts:70-76`).
Se amplía al set completo, por track, en este orden de prioridad:

1. `spectrogram` — verdicto de calidad (fake-lossless)
2. `waveform` — alimenta el filtro de silencio y el trim sugerido
3. `waveformScan` — alimenta el filtro de clipping
4. `loudness` — LUFS / true-peak
5. `clicks` — recuento de clicks (declick)
6. `bpm`
7. `key`
8. `properties`

Cada uno ya tiene su factory de opciones: `spectrogramOptions`,
`waveformOptions`, `waveformScanOptions` (`hooks/useWaveform.ts`,
`hooks/useSpectrogram.ts`) y, vía `analysisOptions(name, inputPath, probe)`
(`lib/analysisQueries.ts:19`), `loudness`, `clicks`, `bpm`, `key`, `properties`.
El worker solo tiene que `fetchQuery` de cada uno; la caché a disco
(`path+mtime`) hace que un fichero ya analizado no relance ffmpeg.

El progreso sigue contándose **por track** (no por análisis), conservando el
"done/total" que la UI ya muestra.

### Disparo automático al importar

`App.tsx` `onMetaLoaded` (~`App.tsx:490-501`), que hoy con
`autoAnalyze && showSpectrum` hace `prefetchQuery(spectrogramOptions)`, pasa a
**encolar el track en el barrido completo** cuando `autoAnalyze` esté activo. Se
encola visible-only, igual que el auto-match (`enqueueAutoMatch`,
`App.tsx:494`): un filtro activo retiene las filas que oculta; al cambiarlo, las
recién mostradas entran al barrido.

### Gating: se reutiliza `autoAnalyze`

Se reutiliza el setting existente `autoAnalyze` (`shared/types.ts:206`). Su
semántica se amplía de "auto-analiza el espectro de mis imports" a
"auto-analiza **todo** de mis imports". Sin settings nuevos. Con `autoAnalyze`
off, importar no lanza ningún barrido (comportamiento de opt-in intacto).

El disparo deja de depender de `showSpectrum` (hoy `autoAnalyze && showSpectrum`,
`App.tsx:499`): el barrido llena la caché aunque las secciones estén plegadas,
igual que ya hace "Analyze all". Es intencional, no un descuido.

### El sweep debe admitir "append" en caliente

Hoy `analyzeAllQuality` es un disparo manual único: `runningRef`
(`useQualityAnalysis.ts:45`) bloquea reentradas y `setAnalysis({done:0, total})`
reinicia el progreso en cada arranque. Para auto-encolar por import se necesita
que aceptar **nuevos tracks mientras un barrido está en curso** los **añada** a
la cola sin reiniciar el progreso ni re-analizar los ya hechos.

El cambio: convertir el `runningRef`-como-cerrojo en una **cola con append**. Un
import que llega con un barrido en marcha suma sus tracks (deduplicados contra
lo ya en cola / ya analizado por `tracksToAnalyze`) e incrementa el `total`; el
barrido no se reinicia. Cuando la cola se vacía, el progreso vuelve a `null`.

## Manejo de errores

Se conserva el patrón actual (`useQualityAnalysis.ts:77-88`): un fichero que
ffmpeg no puede leer se cuenta en `failed` y **no aborta** el barrido; al final
se reporta el total vía `onErrors`. Además, cada análisis del set va en su
propio `try` para que un fallo de, p. ej., `bpm` no tire los otros siete del
mismo track. La cancelación (`analyzeCancel`) y el focus-gate quedan intactos.

## Tests (TDD, red → green)

1. El worker del sweep hace `fetchQuery` de los 8 análisis por track (no solo 3).
2. Un track ya cacheado (mismo `path+mtime`) no relanza el probe de ffmpeg.
3. Con `autoAnalyze` activo, importar encola el barrido completo; con
   `autoAnalyze` off, importar no lanza barrido.
4. Importar más tracks mientras el barrido corre los **añade** sin reiniciar el
   progreso ni re-analizar los ya hechos.
5. Un fichero ilegible se cuenta como `failed` y no aborta el resto del barrido.
6. Un fallo de un análisis concreto no impide que los otros del mismo track se
   ejecuten.

## Archivos afectados

- `renderer/src/hooks/useQualityAnalysis.ts` — ampliar el set del worker; cola
  con append; progreso que no reinicia.
- `renderer/src/App.tsx` — `onMetaLoaded` encola el barrido completo bajo
  `autoAnalyze`.
- Sin cambios en `main/analysisCache.ts` ni en el proceso `main`: la caché a
  disco ya persiste todo por `path+mtime`.
