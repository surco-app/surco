# Serato fase (b): escribir cues, rejilla, cues entre programas y al convertir

Continúa `2026-11-03-serato-cuarto-programa-design.md` (objetivo 2, fase b). La fase (a), solo lectura,
está en main local.

## Por qué

El usuario quiere que Serato tenga lo mismo que rekordbox, Traktor y Engine y que los cuatro se pasen
los cues entre sí ("pasar sus cues de Serato a rekordbox, o cualquier combinación"). La fase (a) solo
enseña los cues de Serato. Esta fase deja editarlos desde Surco, llevarlos a y desde los otros tres
programas, usar Auto mark en Serato y no perderlos al convertir.

## Medido el 03/11 (Serato DJ Pro 5.0.0.1278, ficheros en `~/Music/Serato Pruebas`)

- **Serato acepta `Markers2` escrito desde fuera**, en pistas nuevas y en pistas que ya conocía, si se
  escribe con Serato cerrado. Al salir no pisa lo escrito (reescribe el fichero, pero conserva esos cues).
- **El bloque v1 manda en MP3 y en M4A.** Si el MP3 lleva el GEOB `Serato Markers_` o el M4A el átomo
  `----:com.serato.dj:markers`, Serato enseña esos cues e ignora `Markers2`. Sin el v1 lee `Markers2` y
  no regenera el v1 en MP3. En AIFF manda `Markers2` aunque exista `Markers_`.
- **El GEOB** lleva la descripción en Latin-1 (TagLib pone UTF-16 por defecto y Surco no lo lee) y va en
  una etiqueta ID3 v2.3 en MP3 y v2.4 en AIFF/WAV (una etiqueta nueva en AIFF salía v2.2).
- **Reloj.** Cues regla a 2950/3000/3050 ms sobre un chasquido a 3000 ms (reloj de Surco = decodificar
  con ffmpeg), medidos en píxeles sobre la onda de Serato:
  - WAV, AIFF, FLAC: el chasquido cae en 3000 en el reloj de Serato. Igual que Surco.
  - MP3 sin cabecera Xing: 3025, igual que Surco (ni ffmpeg ni Serato recortan).
  - MP3 con cabecera Xing/LAME: 3050. Serato no salta la trama Xing ni el retardo del codificador:
    `(1152 + 1105) / 44100 = 51,2 ms`, lo mismo que mide su rejilla en Pray.mp3.
  - M4A (AAC de ffmpeg, priming 1024): 2977. Serato salta 1024 muestras más que Surco (−23,2 ms).
  - AAC de Apple (priming 2112): sin medir.
- **Rejilla.** `Serato Tempo Map` (49 bytes con un solo marcador): `02 00 00 01`, posición del primer
  golpe en segundos (f64 BE, byte 4), BPM (f64 BE, byte 24). Está en el mismo reloj que los cues (su
  diferencia entre formatos coincide con la medida en pantalla). No se ha visto un mapa con varios
  marcadores.
- Serato escribe sus etiquetas (Overview, Tempo Map, el v1 en M4A) al cargar la pista en el deck, y un
  cierre con fallo pierde los cues puestos en esa sesión.

## Objetivos

1. **Editar los cues de Serato** desde el editor de cues, con el mismo flujo que los otros programas
   (borrador, Guardar, Guardar todo, cola mientras Serato está abierto, deshacer).
2. **Reloj correcto** en lectura y escritura: los ms de Serato se pasan al reloj de Surco y vuelta con la
   tabla medida. Esto corrige también la fase (a), que hoy enseña los MP3 con Xing 51 ms tarde.
3. **Rejilla de Serato** leída del `Tempo Map`, para pintar los cues sobre la onda, pegar al golpe, usar
   Auto mark y pasar cues entre programas.
4. **Cues entre programas** con Serato como origen y como destino (`cueFlowToSerato`).
5. **Al convertir** un fichero con `Markers2`, el resultado lleva sus cues en el contenedor de salida, en
   el reloj de salida y con el desplazamiento de la conversión. Hoy se pierden o se copian sin ajustar.
6. Los pendientes de la fase (a) que tocan a la escritura: rechazo de ids `serato:` en el proceso
   principal al convertir, Serato en `usedByLibrary`, caché por mtime de las lecturas de `_Serato_`.

## No objetivos

- Crates, añadir a la biblioteca de Serato, repuntar, etiquetas (fase c). Por eso **convertir sigue
  bloqueado para las filas de la pestaña Serato**: un fichero convertido cambia de ruta y Serato lo
  perdería; se desbloquea con el repunte en la fase (c) (decisión mía; cambia lo que decía el diseño de
  la fase a, "se activan en la fase b").
- USB (fase d).
- Escribir la rejilla de Serato (`Tempo Map`): solo se lee.
- Loops: se conservan tal cual al escribir; el editor no los edita (como hoy en los demás programas).
- Mapas de tempo con varios marcadores: la pista se trata como sin rejilla.
- Escribir en `master.sqlite`, `database V2` o `.crate`.

## Antiobjetivos

- Escribir con Serato abierto. Se encola y se aplica al cerrarse, sin pedir que se cierre (Serato no
  tiene salida programable y su salida se cuelga).
- Perder lo que Serato guarda en el payload y Surco no entiende (`COLOR`, `BPMLOCK`, `LOOP`, `FLIP`,
  entradas desconocidas): se conservan en su orden.
- Tocar el audio. Solo cambia la etiqueta; el fichero se reescribe con el patrón de siempre (copia,
  verificación, original guardado, rename) y se comprueba que decodifica igual.
- Romper rekordbox, Traktor o Engine: la suite, los tres typecheck y la matriz de resultados quedan
  iguales a la base (126 / 4 fallos conocidos).

## Diseño

### Formato (shared)

- `shared/seratoMarkers.ts` gana el escritor: dado el payload que había (o ninguno) y los cues nuevos,
  produce el payload nuevo cambiando solo las entradas `CUE` (índice, ms, color RGB, nombre) y dejando el
  resto en su sitio; si no había payload, `COLOR` blanco + cues + `BPMLOCK 0`. Salidas: cuerpo del GEOB
  (`01 01` + base64 sin `=` en líneas de 72 + NUL hasta 470 bytes) y forma armada para FLAC/M4A (base64
  en líneas de 72 de `application/octet-stream\0\0Serato Markers2\0` + cuerpo). Ida y vuelta exacta
  contra las fixtures reales de la fase (a).
- Lector del `Tempo Map` (un marcador → `{ firstBeatMs, bpm }`; otro caso → `null`).

### Reloj

- `seratoLeadMs(file)`: MP3 con trama Xing/Info → `+(1152 + retardo LAME + 529) / sr` en ms (reutilizar
  el parser de cabeceras MP3 que ya usan rekordbox y la calibración de cues); MP3 sin ella → 0;
  M4A → `−1024 / sr`; resto → 0. Surco ms = Serato ms − lead; al escribir, Serato ms = Surco ms + lead.
- Se aplica en la lectura (cues, loops, rejilla) y en la escritura. Así cuadra con `clockLeadMs` de
  Traktor/Engine si el contrato de `TrackCues` lo pide (el implementador sigue el patrón existente).

### Escritura

- Un escritor de Serato en main que reescribe en su sitio la etiqueta del fichero:
  - ID3 (MP3, AIFF, WAV): GEOB `Serato Markers2` en Latin-1, quita el GEOB `Serato Markers_`.
  - FLAC: campo Vorbis `SERATO_MARKERS_V2`.
  - M4A: `----:com.serato.dj:markersv2`, quita `----:com.serato.dj:markers`.
  - Respeta lo que ya hace cualquier guardado ID3 de Surco (géneros, UFID rotos, v2.3) y el aviso de
    `tags.ts` sobre GEOB ajenos sin renderizar.
  - Con el patrón de `musicFieldWrite.ts` (copia, worker, verificar leyendo, decodificable, original
    guardado sin mirar la política, rename). La copia del original es la copia de seguridad de Serato.
- Comprobación de huella: si los cues del fichero ya no son los que el editor leyó, no se escribe y se
  avisa como en los otros programas.

### Serato como programa con cues escribibles

- Serato pasa a tener cola de cues propia (`serato-cue-queue.json`), aplicada cuando Serato está
  cerrado: inmediatamente si lo está, si no por la vigilancia que espera a que se cierre. Nunca pide
  cerrarlo.
- El tipo que hoy excluye a Serato de todo lo que escribe (`WritableProgram`) sigue igual para lo de la
  fase (c) (playlists, repunte, USB, sincronizar etiquetas); las tablas de cues (escritores, orden de
  guardado, colas visibles, flujos, gemelos) pasan a incluir a Serato con un tipo propio de "programa con
  cues escribibles" que hoy son los cuatro. Si una tabla no encaja, se decide en el plan.
- Editor: Serato deja de ser `readOnly`; 8 hot cues (`HOT_KINDS`), color libre (se escribe el RGB del
  color elegido), sin llamadas emparejadas. El aviso de "Serato abierto" se queda y explica que se
  guardará al cerrarlo.
- Auto mark: rejilla de Serato + la onda de Surco; si rekordbox tiene analizado el mismo fichero, sus
  frases, como hace Engine. Sin rejilla de Serato no hay Auto mark (como hoy en una pista sin analizar).
- Primer golpe del `Tempo Map` = golpe 1 del compás (decisión mía: Serato no guarda el compás; si no
  acierta, las propuestas de Auto mark caen en otro golpe del compás).

### Cues entre programas

- `cueFlowToSerato` como los otros tres, con el mismo valor por defecto. Serato encuentra su gemelo por
  ruta en sus `database V2`, como hace con los crates.
- Los gemelos pegan al golpe de la rejilla del destino, como hoy. Con los relojes de Serato corregidos,
  un cue en el mismo golpe musical acaba en el mismo sitio en los cuatro.

### Al convertir

- Si el origen tiene `Markers2` (en cualquier contenedor), la salida lleva un `Markers2` nuevo: cues y
  loops pasados al reloj de Surco con el lead del origen, desplazados con `cueShiftFor` (recorte,
  calibración), y vueltos al reloj de Serato con el lead de la salida; resto del payload conservado. Sin v1.
- Los GEOB de Serato dejan de copiarse en crudo (`copyCueFrames` clona todo GEOB hoy y puede tumbar el
  guardado); el resto de etiquetas de Serato (Overview, Tempo Map, Autotags) no se llevan: Serato las
  rehace al cargar la pista y en otro contenedor estarían en otro reloj.
- `SERATO_MARKERS_V2` de un FLAC deja de viajar por ffmpeg como TXXX ilegible a los destinos ID3.

## Cómo no romper nada

- Tests primero, con fixtures pequeñas (las reales de la fase a, más ficheros sintéticos generados en el
  test). Mutación en cada pieza nueva (escritor, reloj, cola, gemelos, conversión).
- Matriz de cues de conversión (`main/cueMatrix.test.ts`) ampliada con Serato en origen×destino.
- Prueba manual al final, hecha por mí manejando Serato (CGEvent y captura de su ventana), sobre
  `~/Music/Serato Pruebas` con copia exacta antes: editar en Surco, abrir Serato, medir en píxeles que el
  cue cae en el golpe en los cinco formatos; pasar cues de rekordbox a Serato en Pray; convertir un
  fichero con cues de Serato y abrirlo en Serato.

## Lo que queda abierto

- AAC de Apple (priming 2112): se aplica el mismo −1024 muestras sin medir (decisión mía; si Serato
  salta un priming fijo de 2048, el error es +1,5 ms; se mide en la prueba manual si hay forma de
  meter un M4A de Apple en Serato).
- MP3 con trama VBRI (Fraunhofer) o de iTunes ("Appl", retardo 0): se tratan con el parser existente;
  sin medir en Serato.
- `Tempo Map` con varios marcadores.
