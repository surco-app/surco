# Reparar daños de versiones anteriores

Fecha: 31/10/2026. Estado: diseño pendiente de revisión, sin implementar. Rama `reparar-danos`.

## Por qué

v1.18.3 y v1.18.4 arreglaron cinco bugs que escribían mal y en silencio. El arreglo evita el daño
nuevo, pero lo que ya se escribió sigue ahí, en ficheros y en bibliotecas de DJ:

1. **Géneros ID3v2.3 (MP3, AIFF, WAV).** Con el ajuste por defecto de TagLib, cualquier pase que
   solo añadía cues partía el género por `;` y `/` y lo reescribía con la primera parte como
   número de ID3v1, y escapaba cada `(` como `((`, otra vez en cada guardado. Arreglado en
   `1ada94f7c` (`useNonStandardV2V3GenreSeparators = false`) y `79b825d27`
   (`keepGenreParentheses`).
2. **Cues de Traktor del MP3 original movidos.** Con el sync del `.nml` activo, convertir en el
   disco de arranque a otra carpeta o con otro nombre dejaba los cues calibrados del fichero
   nuevo en la entrada que sigue en el MP3: cada cue 51 ms antes sobre un audio que no cambió.
   Arreglado en `bbd1e61cb`.
3. **Calibración de Traktor al salir de un MP3.** Hasta v1.18.4 la regla era fija (−51 ms a
   AIFF/FLAC, 0 a WAV). Ahora sale de la cabecera de cada MP3 (`cueCalibration.ts`, 697401849):
   un MP3 con Xing a WAV debía moverse −51,18 ms y no se movía; uno sin Xing a AIFF/FLAC no
   debía moverse y se movía −51.
4. **Cues de Engine DJ que no siguieron a un recorte o a un cambio de frecuencia.** Antes de
   v1.18.3 ninguno (`802f79e05`); antes de v1.18.4 los recortados en su sitio
   (`1dbc9542a`).
5. **`Track.length` de Engine DJ.** El repunte reescribe `trackData` pero nunca la columna
   `length`. Este sigue vivo hoy (hallado el 31/10).

El usuario lo quiere todo: encontrar lo dañado, enseñarlo con la prueba y reparar solo lo que
confirme, siempre con copia en Copias.

## Decisiones (propuestas)

1. **No es una pantalla nueva.** Es un cuarto filtro, **Daños**, en «Revisar metadatos de la
   lista…», al lado de Todo, Grafías y Duplicados. Mismo flujo: fila en la columna, detalle a la
   derecha, «Añadir a la tanda», hoja de confirmación, Aplicar, resumen por destino. Solo en la
   revisión de la lista (todas las plataformas), no en la de Apple Music.
2. **Alcance: las pistas cargadas.** Igual que el resto de la revisión de la lista. Las bibliotecas
   se leen solo para esas rutas (ver Preguntas, 1).
3. **Dos niveles, siempre a la vista.** «Seguro» (pastilla verde) y «Probable» (pastilla ámbar).
   Lo seguro entra en la tanda al abrir; lo probable nunca entra solo, igual que una errata
   (`SAFE_KINDS`). Cada hallazgo lleva su prueba en el detalle, con números.
4. **Lo que no se puede probar no se lista como reparable.** Engine recortado sin copia del
   original sale como aviso sin casilla (ver Preguntas, 3).
5. **Copia antes de escribir, siempre.** Ficheros por `keepOriginal(..., regardlessOfPolicy)`,
   como las correcciones de la revisión. Bibliotecas por `moments.begin('review')` (copia
   fechada en Copias, motivo «review») y la copia de sesión de cada escritor.
6. **Las bibliotecas por sus colas.** Traktor por `flushTraktorSync` + `holdInQueue`, Engine DJ
   por `flushEngineSync` + la cola de Engine. Programa abierto = **Pendiente**, no fallo.
7. **Guardas contra doble reparación.** Cada reparación lleva lo que se leyó al escanear y no
   escribe si ya no está: el texto exacto del TCON, el `entryState` de Traktor
   (`spareEditedEntries`), el `trackData` de Engine.
8. **Recomprobación.** La fase «Comprobando» de la revisión vuelve a escanear. Lo reparado que
   sigue saliendo pasa a **No cuadra** en el resumen.
9. **Deshacer** devuelve los géneros desde sus copias, como el Deshacer de la revisión. Los cues
   de Traktor y Engine se devuelven con «Restaurar esta» en Copias, y el resumen lo dice (ver
   Preguntas, 2).
10. **Los géneros no se propagan a las bibliotecas.** La biblioteca o ya tiene el valor bueno (de
    ahí sale lo seguro) o tiene lo que leyó del fichero dañado. El Deshacer tampoco les manda
    nada: mandaría el texto dañado a donde estaba el bueno.
11. **Signo único.** Todo desplazamiento de cue en este diseño es **ms que se suman** a cada
    posición (positivo = más tarde). Se traduce al `shiftMs` de `shiftCueStart`, que resta, en un
    solo sitio por escritor (memoria «Cue offset: doble negación»).

## Detección

### 1. Géneros (`genre-number`, `genre-parens`)

**Medido el 31/10** con `node-taglib-sharp` del repo, guardando dos veces con el ajuste viejo sobre
un MP3 que ffmpeg etiquetó en v2.3:

| Escrito | Queda en el TCON | ffprobe lee | TagLib (ajuste nuevo) lee |
|---|---|---|---|
| `House; Deep House` | `(35) Deep House` | `House` | `House  Deep House` |
| `House/Deep House` | `(35)Deep House` | `House` | `House Deep House` |
| `House; Techno; Deep House` | `(35) Techno; Deep House` | `House` | `House  Techno; Deep House` |
| `Electronic; Techno` | `(52) Techno` | `Electronic` | `Electronic  Techno` |
| `Deep House; Tech House` | igual | igual | igual |
| `Techno (Peak Time / Driving)` | `Techno ((Peak Time ; Driving)` | igual que el TCON | igual que el TCON |

Consecuencias:

- **Ni la lista ni la guarda de la revisión ven el daño.** La lista lee por ffprobe (`House`) y
  `setTagFields` compara `tag.genres` (`House  Deep House`). Hace falta leer el texto crudo del
  frame: `frame.render(3)` sin tocar antes `frame.text` devuelve los bytes tal como están en el
  disco (`textInformationFrame.js:387`), y `id3TextOf` los descodifica.
- **El daño no solo dobla paréntesis**, también cambia `/` por `;` cuando parte el texto.
- **Solo se marca lo que lleva señal:** un `(N)` inicial con N de la tabla de ID3v1, o `((`. Un
  `/` cambiado por `;` sin otra señal no se distingue de lo que escribió el usuario y no se lista.

**El oráculo.** `damageV23(text)` reproduce en puro lo que hacía un guardado con el ajuste viejo.
Un test lo compara con TagLib real (ajuste viejo puesto y restaurado en el test) sobre una tabla
de géneros reales, guardando 1, 2 y 3 veces. Con él:

- **Seguro**: alguna fuente guarda un texto `S` distinto del crudo y `damageV23` aplicado 1 a 4
  veces a `S` da exactamente el crudo. Propuesta: `S`. Fuentes: el `genre` de rekordbox, el
  `GENRE` del `<INFO>` de Traktor, `Track.genre` de Engine DJ y, en un WAV, el `IGNR` del INFO,
  que el bug no tocaba. Prueba: «Traktor tiene «House; Deep House»».
- **Probable**: sin fuente, se generan candidatos invirtiendo (nombre del número delante, unido
  con `; ` si lo que sigue empieza por espacio, con `/` si no; cada racha de `(` a una; ` ; ` a
  ` / ` dentro de un texto con paréntesis) y se quedan los que `damageV23` devuelve al crudo. Si
  queda alguno, el primero va marcado y los demás se ofrecen como las grafías. Prueba: «En
  ID3v1, 35 es House» y «Puede ser un género antiguo escrito así a propósito».
- **Nada** si no queda candidato.

**Reparación.** Escritura mínima por TagLib sobre una copia, como «Arreglar una grafía»
(`rewriteTagFields`), con un trabajo nuevo del worker que compara el texto crudo de cada TCON con
el leído y escribe el nuevo en texto plano (el mismo `Id3v2UnknownFrame` UTF-16 de
`keepGenreParentheses`). INFO e ID3v1 no se tocan.

### 2. y 3. Cues de Traktor (`traktor-source-cues`, `traktor-calibration`)

Requisitos: sync de Traktor activo y `collection.nml` legible. Para cada ruta de la lista con una
sola entrada en la colección:

- **Pareja.** El origen `P` es un `.mp3`. Las hermanas `S` son ficheros con el mismo nombre sin
  extensión y extensión `.aiff`, `.aif`, `.flac` o `.wav` que existen en disco, buscadas en las
  entradas de la colección (cualquier carpeta) y en la carpeta de `P`. Vale con que `P` o `S` esté
  en la lista; la pareja se arma igual. Más de una hermana que encaje = ambiguo, no se lista.
- **Lecturas.** `E_P` y `E_S`: cues de cada entrada (`traktorCueElements`, sin la rejilla
  TYPE 4). `T_P` y `T_S`: el árbol TRAKTOR4 de cada fichero (`readCueTree` +
  `readTraktorMarkers`). `k`: la calibración correcta de hoy en ms a sumar al pasar de `P` a `S`
  (`automaticCueOffsetOfFiles(P, S)`, −51,18 para un MP3 con Xing a PCM; un test lo fija con la
  decisión 11). «B casa con A con desfase d» si tienen los mismos cues por tipo y botón y cada
  posición de B es la de A más d, con 1 ms de margen (`SAME_CUE_MS`).
- **Origen movido (bug 2).** `E_P` casa con `E_S` o con `T_S` con desfase 0, y `k` no es 0.
  - Seguro si `T_P` existe y `E_P` casa con `T_P` con desfase `k`. Reparación: sumar `−k`
    a los cues de la entrada de `P`. Prueba: «El MP3 guarda «Intro» en 10,000 s; Traktor la tiene en
    9,949 s, igual que uno.aiff».
  - Probable si no hay `T_P`. Misma reparación. Prueba: «Traktor le dio los cues de uno.aiff; pasar
    de este MP3 a AIFF los mueve 51,18 ms».
  - Solo en entradas del disco de arranque (`VOLUME` igual a `bootVolumeName()`), donde estaba el
    bug.
- **Convertida con la regla vieja (bug 3).** La referencia es `T_P`, o `E_P` si no hay árbol y el
  caso anterior no se dio. Si `T_S` (o `E_S`) casa con la referencia con un desfase `d` distinto
  de `k` en más de 1 ms, y `d` es una de las reglas viejas (−51 o 0), la hermana está desplazada
  `k − d`.
  - Seguro con `T_P`; probable con `E_P`.
  - Reparación: sumar `k − d` a la entrada de `S` si la hay y al árbol del fichero `S` (copia,
    `copyCueFrames` u `shiftFlacCues` con desplazamiento, `assertDecodable`, copia en Copias,
    renombrar). Prueba: «uno.wav se convirtió con la regla anterior; le faltan 51,18 ms».
- La rejilla (TYPE 4) no entra en la comparación, pero se repara con el mismo desplazamiento por
  la ruta de siempre (`shiftEntryCues`, fase y no posición).

**Escritura.** Un `NmlPatch` `{ volume, dir, file, cueShift: { shiftMs: −suma } }` por entrada,
con su `entryState` al escanear, por `flushTraktorSync` (`endNmlBatch` devuelve los parches) y
`holdInQueue`. Traktor abierto = Pendiente.

### 4. y 5. Engine DJ (`engine-cues`, `engine-length`)

Requisitos: sync de Engine activo y `m.db` legible. Para cada ruta con una sola fila:

- **Lecturas.** De la fila: `trackData` (`R_e`, `N_e`), `Track.length`, `fileBytes`. Del fichero:
  frecuencia `R_f` y duración `D_f` por ffprobe. `D_e = N_e / R_e`. Margen `ENGINE_SAME_SEC = 0,1`
  (el retardo de un MP3 entre lectores cabe de sobra).
- **Cambio de frecuencia sin recorte.** `R_f ≠ R_e` y `|D_e − D_f| ≤ 0,1`. Seguro. Reparación:
  reescalar todas las posiciones a `R_f` (`shiftEnginePerformance` con `trimmedMs: 0`). Prueba:
  «Engine DJ la analizó a 48 kHz; el fichero va a 44,1 kHz».
- **Recorte.** `D_e − D_f > 0,1`. Se busca en Copias de seguridad una copia de esta ruta
  (`originalPath` o `outputPath` igual a la ruta) cuya duración esté a 0,1 s de `D_e`.
  - Con copia: se mide dónde empieza el audio actual dentro de la copia, a nivel de muestra, por
    correlación (la misma `bestLag` de `comparePair`, con alcance hasta lo recortado + 1 s).
    Seguro si el desfase cae entre 0 y lo recortado + 50 ms. Reparación: `trimmedMs` medido y
    frecuencia nueva si cambió. Prueba: «Copia del 29/10; el audio empieza 1,240 s más tarde en
    ella».
  - Sin copia: aviso sin casilla, «Engine DJ la recuerda 2,1 s más larga y ya no queda el
    original. Vuelve a analizarla en Engine DJ».
- **Solo la duración.** Sin lo anterior, si `Track.length` no es la duración que dice el propio
  `trackData` de Engine, alguien movió `trackData` sin `length`: esa firma es la de Surco. Seguro.
  Reparación: solo `length`. **Medido el 31/10** en las 23 filas analizadas del `m.db` real de
  este Mac: `length` es siempre `Math.round(N_e / R_e)` (217,896 → 218, 300,420 → 300, 334,507 →
  335). Se fija en `engineLengthOf(sampleCount, sampleRate)`. Ninguna de las 23 tiene hoy esta
  firma.

**Escritura.** Un `EngineRepoint` con `from` y `to` iguales a la ruta, `fromBytes` el `fileBytes`
leído y `engineShift` con `sampleCount` exacto, contado al reparar con `proveDecodable(...,
countSamples)` (no al escanear: es un decode entero). Dos cambios en `writeEngineRepoints`:

- **`length` se escribe** con `engineLengthOf` siempre que haya `sampleCount`. Arregla también el
  bug vivo en cada conversión, en un commit propio.
- **`expectTrackData`** opcional: si la fila ya no tiene ese `trackData`, `no-match`. Es lo que
  impide mover dos veces.

Por `flushEngineSync` y la cola de Engine, como `flushConversionBatch`. Engine abierto = Pendiente.

## Datos

En `shared/types.ts`:

```ts
type DamageKind = 'genre-number' | 'genre-parens' | 'traktor-source-cues'
  | 'traktor-calibration' | 'engine-cues' | 'engine-length'
type DamageCertainty = 'sure' | 'likely'
interface DamageNote { key: string; params?: Record<string, string | number> }
interface DamageFinding {
  id: string                 // kind + NUL + ruta
  kind: DamageKind
  path: string
  certainty: DamageCertainty
  evidence: DamageNote[]
  before: DamageNote
  options: string[]          // géneros: candidatos; el resto: un solo «después»
  repair: DamageRepair | null  // null = aviso sin casilla
  pending?: true             // reparación encolada en esta sesión
}
type DamageOutcomeState = 'repaired' | 'pending' | 'unchanged' | 'failed' | 'mismatch'
interface DamageOutcome { id: string; state: DamageOutcomeState; backupId?: string; error?: string }
```

`DamageRepair` es una unión por destino (`genre`, `traktor`, `engine`) con lo justo para la guarda
y la escritura. Los textos viajan como claves traducibles (memoria «Errores del main
traducibles»).

## Interfaz

- **Filtro** `damage`, icono `ShieldAlert`, «Daños». Solo existe en la revisión de la lista.
- **Fila**: título de la pista, detalle con el tipo («Género», «Cues de Traktor», «Cues de Engine
  DJ», «Duración en Engine DJ») y la pastilla «Seguro» o «Probable». Pendiente sustituye a la
  pastilla y quita la casilla.
- **Detalle**: «Ahora» y «Queda», la prueba línea a línea y, en géneros con varios candidatos, el
  selector de las grafías. «Añadir a la tanda» como siempre.
- **Mientras busca**: «Buscando daños…» en la línea de alcance, sin bloquear grafías ni
  duplicados. El escaneo corre en main en segundo plano.
- **Confirmación**: una fila por tipo con su número, más la línea «Se guarda copia de cada
  fichero y de cada biblioteca en Copias».
- **Resumen**: filas por destino (Fichero, Traktor, Engine DJ) con reparadas, pendientes, no
  cuadran y sin cambios. Nota bajo Deshacer: «Los cues se devuelven desde Copias».
- Textos en 6 idiomas, tuteo, sin raya, sin dos puntos explicativos. Selectores `data-testid`
  `damage-*`.

## Fuera de alcance

- Apple Music como fuente de prueba de géneros (pide AppleScript por pista).
- `/` cambiado por `;` sin otra señal.
- rekordbox: ninguno de los cinco bugs le tocó la colección.
- Reparar lo que no está en la lista cargada.
- Estimar el recorte de Engine sin copia del original.

## Riesgos

- **Falso seguro en géneros**: una biblioteca con un texto distinto que por casualidad daña al
  mismo crudo. El oráculo lo hace casi imposible y el usuario ve el valor antes de aplicar.
- **Cues editados a mano después del daño**: no casan con desfase único y no salen. Se pierde
  recuperación, no se escribe nada malo.
- **Coste del escaneo**: TagLib por fichero ID3, una lectura del NML, una del `m.db` y un
  ffprobe por fila de Engine. Las decodificaciones (correlación, recuento exacto) solo para
  filas con copia o al reparar.

## Preguntas para el usuario

1. **Alcance.** ¿Basta con las pistas cargadas, como el resto de «Revisar metadatos de la lista»,
   o quieres barrer la colección entera de Traktor y Engine DJ aunque las pistas no estén en la
   lista?
2. **Deshacer.** ¿Vale que Deshacer devuelva los géneros y que los cues se devuelvan con
   «Restaurar esta» en Copias, o quieres que Deshacer también devuelva los cues?
3. **Engine recortado sin copia** (más de 7 días o Copias en «Nunca»). ¿Solo aviso para que la
   vuelvas a analizar en Engine DJ, o te sirve una estimación «probable» a partir de la rejilla?
4. **Géneros probables** como `(35)Deep House`, que también puede ser un género antiguo puesto
   así a propósito. ¿Los listo como probables fuera de la tanda, o prefieres no verlos?
