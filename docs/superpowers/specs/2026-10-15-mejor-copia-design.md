# Mejor copia entre duplicados

Estado: **diseño aprobado en conversación (15/10)**, sin código. Boceto en
https://claude.ai/artifact/B7Kds6RTkHoR1YBJR34T3D (variante C en la lista, parte 2 en el
editor).

## El caso

Vicent tiene la misma pista dos veces y no sabe cuál conservar. Caso real, Netzwerk
"Memories (Extended 12" Mix)":

- un WAV 16/44.1 en su biblioteca de Apple Music (NAS);
- un AIF "24/44.1" bajado de Soulseek.

A ojo, el WAV parece mejor porque su espectro tiene "más color". Medido, es al revés:

| | WAV (Apple Music) | AIF (Soulseek) |
|---|---|---|
| Muestras / desfase / correlación | 17237220 / 0 / 0,9973 | igual |
| Bits reales | 16 | 16 (padded16, byte bajo vacío en el 0,000 %) |
| Loudness integrado | −10,0 LUFS | −12,2 LUFS |
| LRA | 4,2 LU | 5,4 LU |
| Cresta | 10,7 dB | 13,2 dB |
| Muestras en el pico (astats Peak count) | 1978 | 1 |

Mismo master. El WAV es el AIF 2,2 dB más alto y pasado por un limitador: el residuo tras
quitar la ganancia queda a −20,5 dB, así que no es solo volumen. El color del espectro es
nivel, y más nivel aquí significa peor copia.

De aquí salen dos reglas de diseño:

1. **Ni el color ni los bits declarados deciden.** El veredicto de espectro ya es invariante
   a la ganancia (`spectrumInvariance.test.ts`), y los bits rellenados cuentan como 16.
2. **Si no hay diferencia medida, se dice "mismo audio" o empate.** Nunca se inventa un
   ganador.

## Qué se ve

### Lista (variante C)

Un icono de 12 px en la línea del artista, en el grupo de iconos que ya existe (después de
cleaned, antes del hueco de la píldora de formato, `TrackList.tsx` ~710). Familia Lucide,
como `Undo2`.

| Estado | Icono | Color | Tooltip |
|---|---|---|---|
| Mejor del grupo | `CopyCheck` | `text-good` | Mejor copia de {{count}} · {{razón}} |
| Peor del grupo | `Copy` | `text-fg-faint` | Hay una copia mejor en la lista · {{razón}} |
| Empate o mismo audio | `CopyMinus` (=) | `text-fg-faint` | Mismo audio que otra copia de la lista |

El icono cambia de forma además de color (regla de daltonismo de la fila). No se usa rojo,
no se toca la franja de severidad y no se reordena la lista. Lleva `sr-only` como los demás
iconos de la fila y `data-testid="track-duplicate"` con `data-rank="best|worse|same"`.

### Editor, cabecera de Apple Music

Junto a "Apple Music · WAV 16/44.1" aparece una pastilla que despliega una tarjeta con la
tabla comparativa (mismo patrón visual que `quality-evidence`).

| Estado | Pastilla | Tarjeta | Pie |
|---|---|---|---|
| Este fichero gana | Este fichero es mejor (good) | frase + tabla | sin cambios ("Replace with…") |
| Apple Music gana | Apple Music tiene una mejor (warn) | frase + tabla | botón principal "Apple Music ya tiene una copia mejor"; sustituir sigue en el menú |
| Empate / mismo audio | Mismo audio (neutro) | una frase, sin tabla | sin cambios |
| Midiendo | Comparando… (neutro) | nada | sin cambios |
| No se pudo leer | nada (como hoy) | nada | sin cambios |

Filas de la tabla: bits reales, corte, loudness, cresta, muestras en el pico. Solo se
colorean las filas que decidieron.

### Textos

Todos son afirmaciones de calidad y **cada frase se aprueba antes de entrar**
(lección del 23/09: el rojo sin medir genera reportes). Propuestas del boceto, pendientes de visto bueno:

- "Mejor copia de 2 · menos limitada"
- "Hay una copia mejor en la lista · esta está más limitada"
- "Mismo audio que otra copia de la lista"
- "Mismo master. La copia de Apple Music está 2,2 dB más alta y pasó por un limitador, con
  1978 muestras clavadas en su techo."
- "Este fichero es un MP3 con el corte en 19,8 kHz. La copia de Apple Music llega a 22 kHz."
- "Mismas muestras, misma ganancia. Solo cambia el contenedor."

La razón del tooltip sale del criterio que decidió (tabla de abajo), una por criterio.
es y en a la vez.

## Cómo se decide

### Quién es duplicado de quién

- **Lista**: las pistas cargadas se agrupan con el emparejador de la biblioteca
  (`libraryMatchScore` ≥ `LIBRARY_MATCH_THRESHOLD`, `appleMusicLibrary.ts:249`), que compara
  título, artista y duración. Se exporta tal cual; no hay un criterio nuevo.
- Solo grupos sin ambigüedad: si una pista encaja con dos grupos que no encajan entre sí, no
  se marca ninguna de ellas.
- **Apple Music**: la entrada que ya devuelve `replaceCandidate`. Si es `ambiguous`, no se
  compara.

### Qué se mide

| Dato | Estado hoy | Fuente |
|---|---|---|
| Veredicto de espectro (lossy, corte, processed, upsampled) | existe | `SpectrumResult` |
| padded16 | existe | `bitsUsage` |
| Cresta | existe | `measureLoudness` → `crestDb` (astats) |
| Loudness integrado | existe | `measureLoudness` |
| Muestras en el pico | **nuevo** | `Peak count` del mismo pase `astats` de `measureLoudness` (`ffmpeg.ts` ~2896); solo hay que leerlo en `parseAstats` |
| Huella del audio | **nuevo** | MD5 del PCM decodificado a s16 estéreo (`-f md5`); un pase de decodificación extra, ~0,05 s en local |

La huella demuestra "mismo audio" en el caso padded16 frente a 16 bits reales: si el byte
bajo está vacío, decodificar a s16 da las mismas muestras. Si la ganancia difiere un solo
bit, la huella difiere y se pasa a comparar medidas.

Cambiar `LoudnessResult` obliga a subir el namespace de su caché. La huella va en caché
propia por ruta + mtime.

### Orden de decisión

Para cada par se aplica en orden y gana el primer criterio que separa:

1. **Huella igual** → mismo audio. Fin.
2. **Sin pérdidas frente a con pérdidas** (veredicto de espectro) → gana sin pérdidas.
3. **Processed o upsampled** frente a limpio → gana el limpio.
4. **Corte**: entre dos lossy, más corte gana si la diferencia supera `CUTOFF_MARGIN_HZ`.
5. **Muestras en el pico**: menos gana si la diferencia supera `PEAK_COUNT_MARGIN`.
6. **Cresta**: más gana si la diferencia supera `CREST_MARGIN_DB`.
7. Nada separa → empate ("mismo audio" en el texto solo si la huella coincide; si no, "sin
   diferencia medida", texto pendiente).

El loudness se enseña pero **nunca decide**: más alto suele ser peor y no siempre.

Los bits declarados no entran: padded16 cuenta como 16. Una copia 24 bits llena frente a
16 solo gana si `bitsUsage === 'full'`, y entra como criterio 3,5. Pendiente de calibrar si
merece la pena (con el corpus actual no hay pares así).

### Umbrales

`CUTOFF_MARGIN_HZ`, `PEAK_COUNT_MARGIN` y `CREST_MARGIN_DB` **no se fijan a ojo**. Se
calibran con pares reales:

- Fuente: duplicados del pack de Soulseek de Vicent contra su biblioteca de Music (10-20
  pares), más versiones del corpus de espectro que compartan master.
- Cada par se mide con el script de comparación (alineación, residuo, cresta, peak count)
  y se etiqueta a mano.
- Cada umbral queda en un test con el par que lo justifica, como el corpus de espectro.

Sin calibración no se publica. Mientras tanto, empate.

## Dónde vive

- **main**: `parseAstats` lee `Peak count`; nueva `audioFingerprint(path)` en `ffmpeg.ts`;
  IPC para ambas siguiendo el patrón de `audioIpc.ts` (caché, namespace).
- **renderer**:
  - `lib/bestCopy.ts`: función pura `compareCopies(a, b): { winner: 'a' | 'b' | 'same', reason }`
    con el orden de arriba. Es la pieza que más tests lleva.
  - `lib/duplicateGroups.ts`: agrupa la lista con `libraryMatchScore`.
  - `hooks/useDuplicateRank.ts`: por pista, su rango en el grupo. Mide solo las pistas que
    tienen duplicado; las demás no pagan nada.
  - `hooks/useLibraryCopyVerdict.ts`: análisis del fichero de Music (ruta por
    `appleMusicEntryLocation`), lanzado al abrir en el editor una pista con
    `replaceTarget`. Caché por ruta + mtime para no releer el NAS.
  - `TrackList.tsx`: el icono. `Editor.tsx` / cabecera de Metadata: pastilla + tarjeta.
    `ConvertFooter.tsx`: el estado "Apple Music ya tiene una copia mejor".

## Errores

- Fichero de Music inaccesible (NAS desmontado, ruta movida): la cabecera queda como hoy, sin
  pastilla. No se muestra error; la comparación es un extra.
- Una de las dos copias sin analizar o con análisis fallido: sin icono / sin pastilla.
  Nunca se decide con datos a medias.
- Cachés de análisis antiguas sin `peakCount`: se tratan como "no medido" y se re-mide.

## Pruebas

- `bestCopy.test.ts`: un caso por criterio y por umbral, con los números de Netzwerk como
  caso real (gana el AIF por muestras en el pico), el empate por huella, y que el loudness
  solo nunca decide.
- `duplicateGroups.test.ts`: grupos, ambigüedad, pistas sin duplicado.
- `ffmpeg` real: `Peak count` y huella sobre fixtures; padded16 y su versión de 16 bits dan
  la misma huella; +0,1 dB de ganancia la cambia.
- Componentes: icono por rango (`data-rank`), pastilla y pie por estado, sin pastilla si
  falla la lectura.
- Escenario de app completa con Music falso (`scenarios/fakeMusic.ts`) para el flujo del
  editor.
- Mutation testing sobre `compareCopies`.

## Fuera de alcance

- Borrar o mover la copia peor. Sustituir en Music ya existe; en la lista, el usuario decide.
- Comparar contra rekordbox o Engine DJ.
- Duplicados fuera de la lista cargada (barrer carpetas o la biblioteca entera).

## Contexto

Capacidad nueva tras la 1.0, que se había cerrado a "solo estabilizar"
(notas de la v1.0.0). Vicent siguió adelante el 15/10.
