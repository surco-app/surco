# Mejor copia entre duplicados

Estado: **implementado en `worktree-mejor-copia` (15/10)**, pendiente del visto bueno de los
textos y del merge. Lo que cambió respecto al diseño durante la implementación está en
"Decisiones tomadas al implementar", al final. Boceto en
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
| Mismo audio | Mismo audio (neutro) | una frase, sin tabla | sin cambios |
| Empate | nada | nada | sin cambios |
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

- **Lista**: las pistas cargadas se agrupan con `duplicateGroups` (`lib/duplicates.ts`), el
  mismo que ya alimenta el filtro de duplicados: misma clave de artista y título y duración
  a 5 s o menos. Solo cuentan los grupos `duplicate`; los `version` (otra duración) no se
  comparan. No hay un criterio nuevo.
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
| Huella del audio | **nuevo** | MD5 del PCM decodificado a s16 estéreo 44,1 kHz (`-f md5`); un pase de decodificación extra, ~0,05 s en local |
| Mismo master | **nuevo** | `comparePair(a, b)`: las dos copias a 44,1 kHz mono, desfase buscado en los primeros 91 s, correlación, residuo y ganancia sobre 60 s alineados desde el segundo 30 (desde 0 si la pista dura menos de 90 s; menos de 10 s no se compara) |

La huella demuestra "mismo audio" en el caso padded16 frente a 16 bits reales: si el byte
bajo está vacío, decodificar a s16 da las mismas muestras. Si la ganancia difiere un solo
bit, la huella difiere y se pasa a comparar medidas.

Cambiar `LoudnessResult` obliga a subir el namespace de su caché: `loudness` pasa a
`loudness-v2`. La huella va en caché propia (`fingerprint`) por ruta + mtime. El par no se
guarda en disco: son pocos y la respuesta cambia si cambia cualquiera de los dos ficheros.

### Orden de decisión

Para cada par se aplica en orden y gana el primer criterio que separa (`compareCopies`,
`lib/bestCopy.ts`):

1. **Mismo audio** → fin. Huella igual, o el par alineado deja un residuo de −60 dB o menos
   con una ganancia de menos de 0,01 dB.
2. **Sin pérdidas frente a con pérdidas, transcodificado, corte**: se reutiliza tal cual
   `replaceWarning` (`lib/replaceWarning.ts`), la misma regla que ya avisaba al sustituir en
   Music. Así el pie del editor y la comparación nunca se contradicen.
3. **Processed**, después **upsampled**, frente a limpio → gana el limpio.
4. Solo si el par es **el mismo master** (correlación ≥ 0,98 tras alinear):
   1. **Muestras en el pico**: menos gana si una copia tiene 10 veces más que la otra.
   2. **Cresta**: más gana si la diferencia es de 1,5 dB o más.
5. Nada separa → empate.

Los criterios 2 y 3 valen entre masters distintos; los de nivel no, porque entre masters
distintos la cresta y las muestras en el pico varían tanto como dentro de uno.

El loudness se enseña pero **nunca decide**: más alto suele ser peor y no siempre.

Los bits declarados no entran: padded16 cuenta como 16. Una copia 24 bits llena frente a
16 solo gana si `bitsUsage === 'full'`, y entra como criterio 3,5. Pendiente de calibrar si
merece la pena (con el corpus actual no hay pares así).

### Umbrales

Los umbrales **no se fijan a ojo**. Se calibraron con pares reales:

- Fuente: duplicados del pack de Soulseek de Vicent contra su biblioteca de Music (10-20
  pares), más versiones del corpus de espectro que compartan master.
- Cada par se mide con el script de comparación (alineación, residuo, cresta, peak count)
  y se etiqueta a mano.
- Cada umbral queda en un test con el par que lo justifica, como el corpus de espectro.

Sin calibración no se publica. Mientras tanto, empate.

Resultado (`COPY_MARGINS`, fijado por `bestCopy.calibration.test.ts` con los 26 pares
medidos):

| Umbral | Valor | Por qué |
|---|---|---|
| Mismo master | correlación ≥ 0,98 | los pares del mismo master quedan por encima una vez alineados, salvo uno que deriva en el tiempo y queda en empate |
| Muestras en el pico | razón ≥ 10 | los 8 pares que se separaban 1 LU o más iban de 25x a 36000x; los de menos de 0,4 LU, por debajo de 3x |
| Cresta | ≥ 1,5 dB | el único par donde las dos medidas no coincidían tenía 1,18 dB |

El corte no tiene margen propio: decide `replaceWarning` con el suyo.

La calibración enseñó lo que obligó a añadir la sonda de mismo master: con 26 pares, ni la
cresta ni las muestras en el pico separan masters distintos. Sin la sonda, un remaster más
dinámico ganaría a otro master solo por ser distinto. Límites conocidos: 25 de los 26 pares
salen de una misma carpeta de Soulseek y de un solo género, y los pares con pérdidas no
están calibrados.

## Dónde vive

- **main**: `parseAstats` lee `Peak count`; nueva `audioFingerprint(path)` en `ffmpeg.ts`;
  IPC para ambas siguiendo el patrón de `audioIpc.ts` (caché, namespace).
- **renderer**:
  - `lib/bestCopy.ts`: función pura `compareCopies(a, b, pair)` que devuelve
    `{ winner: 'a' | 'b', reason } | { winner: 'same' } | { winner: 'tie' }` con el orden de
    arriba, y `COPY_MARGINS`. Es la pieza que más tests lleva.
  - `lib/duplicateRanks.ts`: `rankGroup`, el rango de cada copia de un grupo.
  - `hooks/useCopyFacts.ts`: los datos de una copia (espectro sin la imagen, loudness,
    huella) por las consultas de análisis, y `usePairFacts` para el par.
  - `hooks/useDuplicateRanks.ts`: agrupa con `duplicateGroups` y mide solo las pistas que
    tienen duplicado; las demás no pagan nada.
  - `TrackList.tsx`: el icono. `Editor.tsx` (cabecera de Metadata): pastilla, y
    `CopyComparison.tsx`, la tarjeta. `ConvertFooter.tsx`: el estado "Apple Music ya tiene
    una copia mejor".
- **main**: además, `comparePair` en `ffmpeg.ts` y su IPC `audio:pair`.

## Errores

- Fichero de Music inaccesible (NAS desmontado, ruta movida): la cabecera queda como hoy, sin
  pastilla. No se muestra error; la comparación es un extra.
- Una de las dos copias sin analizar o con análisis fallido: sin icono / sin pastilla.
  Nunca se decide con datos a medias.
- Cachés de análisis antiguas sin `peakCount`: se tratan como "no medido" y se re-mide.
- Un fichero que desaparece conserva sus últimos datos hasta que se desalojan sus análisis; la
  comparación de un par (`['pair', a, b]`) se desaloja con cualquiera de las dos rutas.

## Pruebas

- `bestCopy.test.ts`: un caso por criterio y por umbral, con los números de Netzwerk como
  caso real (gana el AIF por muestras en el pico), el empate por huella, y que el loudness
  solo nunca decide.
- `duplicateGroups.test.ts`: grupos, ambigüedad, pistas sin duplicado.
- `ffmpeg` real: `Peak count` y huella sobre fixtures; padded16 y su versión de 16 bits dan
  la misma huella; +0,1 dB de ganancia la cambia.
- Componentes: icono por rango (`data-rank`), pastilla y pie por estado, sin pastilla si
  falla la lectura.
- Escenario de app completa con Music falso (`scenarios/bestCopy.test.tsx`): un AIFF abierto
  frente al mismo audio limitado en Music (pastilla "here", decide la fila de muestras en el
  pico) y las dos copias en la lista (AIFF `best`, WAV `worse`).
- `bestCopy.calibration.test.ts`: los 26 pares medidos con su veredicto esperado.
- Mutation testing sobre `compareCopies`.

## Fuera de alcance

- Borrar o mover la copia peor. Sustituir en Music ya existe; en la lista, el usuario decide.
- Comparar contra rekordbox o Engine DJ.
- Duplicados fuera de la lista cargada (barrer carpetas o la biblioteca entera).

## Decisiones tomadas al implementar

- **Agrupar con `duplicateGroups`** y no con `libraryMatchScore`: ya decide qué es un
  duplicado en el filtro de la lista, y dos criterios distintos marcarían grupos distintos.
- **`replaceWarning` decide formato, transcodificado y corte**, para que la comparación y el
  aviso de sustituir en Music digan lo mismo. Mientras se mide, el pie sigue la respuesta de
  `replaceWarning`; es el mismo criterio entre masters, así que solo cambia si la medida lo
  desmiente.
- **Caché de loudness `loudness-v2`**, porque `LoudnessResult` gana `peakCount`.
- **Sonda de mismo master** (`comparePair`): a 44,1 kHz y no a 11025 Hz, porque un desfase
  impar entre dos copias idénticas cae entre muestras a la frecuencia baja y no se cancela,
  y porque en material tonal la búsqueda gruesa se enganchaba a una repetición. Desfase en
  los primeros 91 s, medida sobre 60 s desde el segundo 30, mismo master con correlación
  ≥ 0,98. Coste: el veredicto mira los segundos 30 a 90, y un desfase de más de 1 s se lee
  como copias sin relación.
- **Mismo audio por huella o por el par**: residuo ≤ −60 dB y |ganancia| < 0,01 dB. Un par
  real (Aquagen) desplazado 6 muestras rompía el MD5 siendo las mismas muestras.
- **"Mismo audio" solo con prueba**: `DuplicateRank` lleva `identical`, cierto solo si todas
  las copias del grupo son mismo audio entre sí. Un empate sin esa prueba usa
  `trackList.copyNoDifference` ("Sin diferencia medida con otra copia de la lista").
- **Cada fila con su razón**: una copia peor dice por qué pierde frente a la mejor, no la
  razón con la que la mejor ganó al grupo; una copia que es mismo audio que la mejor se marca
  `same`.
- **El empate no se enseña en el editor**: ni pastilla ni tarjeta. `copyNoDifference` queda
  para la lista.
- **Un par que no se pudo alinear** (sin relación, invertido o ilegible) compara igual con
  `pair = null`: los criterios de nivel no se aplican y formato, corte y espectro siguen
  decidiendo. Solo una copia sin datos oculta la pastilla.
- **La frase de sin pérdidas nombra los formatos** (el contenedor con pérdidas frente al sin
  pérdidas), nunca los cortes. La fila de corte solo se colorea cuando la razón es el corte.
- Con la pastilla visible, el antiguo "· mejor que esta" de la cabecera desaparece: un solo
  mensaje.

## Contexto

Capacidad nueva tras la 1.0, que se había cerrado a "solo estabilizar"
(notas de la v1.0.0). Vicent siguió adelante el 15/10.
