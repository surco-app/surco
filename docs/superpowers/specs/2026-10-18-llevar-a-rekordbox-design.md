# Llevar pistas a rekordbox: playlists desde el formulario y cues desde la onda

Estado: **diseño aprobado en conversación con Vicent (18/10)**, pendiente de revisar esta spec.
Bocetos "FlujoPistas" y "FlujoCues" en https://claude.ai/artifact/C97L9QfRLUiKKUBvfWAvvu.
Se apoya en la spec de fuentes DJ (`2026-10-15-fuentes-dj-playlists-design.md`): usa su
escritor de la fase 2a y define aquí la cola persistente que allí quedó para la 2b.

## El caso

Hoy una pista nueva tarda en estar lista para pinchar porque pasa por cinco programas y
pasos a mano:

1. Surco la arregla y la convierte.
2. Apple Music la recibe, y unas playlists inteligentes por Grouping la reparten. Eso solo
   sirve para Music.
3. En rekordbox, el botón de Apple Music (muy lento) la trae.
4. Vicent la busca por fecha de alta y la arrastra a varias playlists de rekordbox.
5. Pone el CUE y los CAL (memory cues). Los drops los marca a mano con un CAL.
6. Pone los hot cues de cuenta atrás hacia cada drop.

El paso 6 ya lo hace un script suyo (`~/code/rekordbox-cues`, reglas en `rules.py`), que
corre a mano y con rekordbox cerrado. Lo que quiere:

- **Flujo 1, Pistas.** Decir en Surco a qué playlists de rekordbox va la pista, en el mismo
  formulario en el que pone el Grouping, y que al convertir quede en rekordbox: dada de alta
  en la colección si no estaba y metida en esas playlists. Sin Music por medio.
- **Flujo 2, rekordbox como fuente.** Abrir una playlist de rekordbox en Surco, marcar los
  drops con un clic en la onda y que Surco ponga la cuenta atrás de hot cues con sus reglas,
  y "Guardar en rekordbox".
- En los dos, si rekordbox está abierto, que espere y se aplique solo al cerrarlo.

## Decisiones

1. **"Playlists" es un campo más del formulario**, no una sección. Se muestra, se oculta y se
   ordena en Ajustes › Campos como cualquier otro (lista plana en el orden del usuario,
   igual que los campos propios). Solo existe si hay colección de rekordbox; sin ella no
   aparece ni en el formulario ni en Campos. La primera vez que Surco encuentra una
   colección lo añade visible al final de la lista, una sola vez: si el usuario lo oculta,
   se queda oculto.
2. **El campo no es una etiqueta del fichero.** Su clave (`rekordboxPlaylists`) no está en
   `TrackMetadata` ni se escribe en el audio. Su valor es el conjunto de playlists en las
   que la pista **debe** estar, y se compara con lo que rekordbox tiene al escribir: lo que
   sobra se añade, lo que falta se quita. Quitar una ficha quita la pista de esa playlist
   (nunca de la colección ni del disco). No entra en obligatorios, ni en `{clave}` de
   nombres, ni en buscar y reemplazar, ni en el inspector.
3. **Se escribe al convertir o al Actualizar la pista**, en la misma tanda que hoy vuelca a
   rekordbox los datos y el reapuntado, nunca al teclear. Escribir no depende del
   interruptor "Sincronizar rekordbox" de Ajustes: rellenar el campo ya es pedirlo, igual
   que crear una playlist desde el árbol en la fase 2a (que tampoco lo mira).
4. **Si la pista no está en la colección, Surco la da de alta**, sin análisis: rekordbox la
   analiza cuando la abre (como con una pista arrastrada desde el Finder con el análisis
   automático encendido). Una pista que ya está (por ruta, con la regla de las gemelas) se
   reutiliza siempre, nunca se duplica; una ambigua (dos filas para un fichero) se salta y
   se dice, como hoy al añadir a una playlist.
5. **Una sola cola persistente para todo lo que Surco escribe en rekordbox** (playlists del
   campo, altas, cues, y las operaciones del árbol cuando el usuario elige esperar). Es la
   cola de la 2b, definida aquí. Las escrituras del campo y de los cues no preguntan nunca:
   se encolan y la píldora lo dice. Las del árbol siguen con el diálogo de hoy, y su
   Cancelar ahora encola en vez de descartar.
6. **Los cues siguen las reglas de `rules.py` sin cambiar una coma**, portadas a TS con sus
   mismos casos de prueba. Surco nunca pisa hot cues puestos a mano (regla `fits_plan`).
7. **Completar cues al cerrar rekordbox, apagado por defecto.** Ver "Completar solo".
8. **Nada de esto se programa sin los dos spikes** sobre copias de la colección, que
   terminan con Vicent comprobando en rekordbox de verdad (ver "Spikes").
9. **Cues es una sección del editor, no una pestaña.** El boceto dibuja pestañas
   (Metadatos, Calidad, Cues); el editor de hoy no tiene pestañas sino secciones en el orden
   del usuario, y una pestaña nueva sería un patrón distinto. Va como sección, con su propia
   condición de visibilidad (pista de una playlist de rekordbox abierta). Conflicto con la
   regla "toda sección del editor cambia el fichero": esta cambia rekordbox, no el fichero.
   Se acepta porque sigue siendo accionable (Guardar en rekordbox); queda anotado.

## Flujo 1: Pistas

### El campo

- Etiqueta "Playlists" con el icono de rekordbox. Fichas como las de Mail: cada playlist
  elegida es una ficha con su nombre; al escribir se filtran las playlists de rekordbox por
  nombre, cada opción con la ruta de carpetas a la derecha ("Bolos de verano · BOLOS"),
  porque en su colección hay nombres repetidos ("Todas", "Top", "Fijas") que solo la ruta
  distingue. La ficha lleva la ruta en su tooltip.
- Varias a la vez. Retroceso borra la última ficha; Intro elige la opción resaltada.
- Última opción, siempre que el texto no sea exactamente el nombre de una playlist: "Crear
  playlist «texto»". Se crea en la raíz del árbol al escribir la pista (en la misma tanda de
  la cola), y hasta entonces su ficha sale como pendiente. Moverla a una carpeta se hace
  luego desde el árbol.
- Solo playlists normales (`Attribute` 0). Ni carpetas, ni inteligentes, ni la −128.
- **Varias pistas seleccionadas**: el campo funciona como el de etiquetas en lote
  (`TagListBulkField`). Una ficha está entera si todas las pistas van a esa playlist y a
  medias si solo algunas; clic en una a medias la completa para todas; quitarla la quita de
  todas.
- **Valor inicial**: para una pista que ya está en la colección, las playlists en las que
  rekordbox la tiene hoy (sin las de separadores). Para una que no está, vacío.
- Las ediciones viven en el estado de la pista que Surco ya guarda por ruta (como el resto
  de ediciones sin convertir), así que cambiar de fuente o de playlist no las pierde.

### En la lista

- Cada fila enseña tantos puntos como playlists de rekordbox lleva (hasta 4; a partir de 5,
  "5+"), en el color de rekordbox de la fuente. Tooltip con los nombres.
- Una fila con cambios de playlists aún no escritos lleva los puntos en hueco (contorno),
  como las ediciones pendientes de hoy.

### Al convertir o actualizar

En la tanda de cada conversión, después de escribir el fichero (la ruta final es la del
destino, ya renombrado), Surco encola por pista:

1. Alta en la colección si hace falta (ver "Dar de alta una pista").
2. Las altas y bajas de playlist: diferencia entre el valor del campo y lo que rekordbox
   tiene. Las altas van al final de la playlist; `TrackNo` vuelve a ser 1..N contiguo.
3. Las playlists nuevas del campo, antes que los enlaces que las usan.

Y la cola se aplica enseguida si rekordbox está cerrado. Una tanda de conversión entera es
**un lote**: una copia, una transacción.

### La píldora

- En la barra de herramientas, solo si hay algo esperando: "3 pistas esperan a que cierres
  rekordbox". Cuenta pistas, no operaciones. Con solo operaciones del árbol, "2 cambios
  esperan a que cierres rekordbox".
- Clic: un desplegable con la lista (pista y qué le pasa: "a Makina, Cierre", "alta en la
  colección", "cues") y dos botones, "Aplicar ahora" (cierra rekordbox con el diálogo de
  hoy, `ensureRekordboxClosed`, y aplica) y "Descartar" (con confirmación; vacía la cola y
  las ediciones vuelven a lo que dice rekordbox).
- Al aplicarse, aviso discreto: "Listo en rekordbox · 3 pistas". Si algo no se aplicó, el
  aviso lo nombra (ver "Conflictos").

## Dar de alta una pista nueva en la colección

Lo que rekordbox hace al importar un fichero, sin analizar, con el mismo cuidado que el
escritor de la fase 2a (`rekordboxPlaylistWrite.ts`).

- **Antes, buscar**: `findTrackByPath` con la ruta final (resuelve enlaces simbólicos,
  compara sin mayúsculas). Una fila → se reutiliza. Dos o más → ambigua, se salta y se
  avisa. Ninguna → alta. Nunca se crea una segunda fila para un fichero.
- **Ruta**: `FolderPath` es la ruta tal como Surco la tiene, sin resolver el enlace. La
  colección de Vicent guarda 1513 pistas por `/Volumes/…` y 413 por `~/Music/Music`
  (enlace al mismo volumen); las dos formas valen para rekordbox, y la búsqueda de arriba ya
  impide la gemela. La normalización Unicode (NFC o NFD) y si rekordbox guarda la ruta
  resuelta al importar se miden en el spike (a); manda lo que haga rekordbox.
- **Filas que se escriben** (el molde exacto, columna a columna, sale del spike (a)):
  - `djmdContent`: ID libre (como `unusedRowId`), `UUID` v4, `FolderPath`, `FileNameL`,
    `Title`, `ArtistID`, `AlbumID`, `GenreID`, `LabelID`, `RemixerID`, `ComposerID`,
    `OrgArtistID`, `KeyID` vacío (Surco nunca escribe tono), `FileType` (1 MP3, 4 M4A,
    5 FLAC, 11 WAV, 12 AIFF), `FileSize` y `Length` reales, `BitRate`, `SampleRate`,
    `BitDepth`, `ReleaseYear`, `TrackNo`, `DiscNo`, `Commnt`, `DateCreated` y `StockDate`
    como rekordbox, `DJPlayCount` 0, `Rating` 0, `ColorID` 0, `AnalysisDataPath` vacío,
    `BPM` 0, `MasterDBID` y `MasterSongID` si rekordbox los rellena al importar (lo dice el
    spike), `rb_local_usn` de `takeLocalUsn`, `created_at`/`updated_at` con
    `rekordboxStamp`, `rb_local_synced` 0, `rb_local_deleted` 0.
  - Artista, álbum (con su artista de álbum), género, sello, remezclador, compositor: la
    fila existente por nombre o una nueva, con el molde que ya usa `rekordboxMetadata.ts`.
  - Cualquier otra tabla que el spike (a) vea cambiar al importar en rekordbox (por ejemplo
    `contentFile` o similares de rekordbox 7). Si alguna no se puede imitar con seguridad, el
    alta no se programa y esta parte vuelve a diseño.
- **Carátula**: la del fichero, con `rekordboxArtwork.ts` (`ImagePath` y las miniaturas en
  `share/PIONEER/Artwork`), como ya hace el volcado de datos.
- **BPM, tono, rejilla, onda**: nada. Los pone el análisis de rekordbox.

## Organizar playlists desde el árbol

En el menú contextual del árbol de rekordbox, además de lo de la fase 2a:

- **Crear** playlist y carpeta: ya existe (2a).
- **Renombrar** (nuevo): edición en línea sobre el nodo. Cambia `djmdPlaylist.Name` y
  `updated_at`. Si rekordbox también toca el `Timestamp` del nodo de
  `masterPlaylists6.xml` al renombrar se mide en el spike (a) y se imita.
- **Borrar** (de la 2b), siempre con confirmación: "¿Borrar la playlist «Makina»? Las
  pistas siguen en la colección." En una carpeta: "¿Borrar la carpeta «BASES» y lo que lleva
  dentro? 3 playlists y 1 carpeta. Las pistas siguen en la colección." Borra las filas de
  `djmdPlaylist`, sus enlaces de `djmdSongPlaylist` y sus nodos del XML, en el mismo lote.
  Nunca una pista de `djmdContent` ni un fichero.

Las tres pasan por la cola: con rekordbox cerrado se aplican al momento; abierto, el
diálogo de hoy, y Cancelar las deja en la cola.

## Flujo 2: rekordbox como fuente, la sección Cues

### Qué se ve

Al abrir en el editor una pista que viene de una playlist de rekordbox (y que está en la
colección), aparece la sección **Cues**:

- **La onda de rekordbox**, no la de Surco: la detallada en color (`PWV5` del `.EXT`) y, si
  no hay, la de `PWAV`. Así lo que se ve es lo que se verá en rekordbox y en el CDJ. Encima,
  la rejilla de rekordbox (`PQTZ` del `.DAT`) con una marca fuerte cada compás y una más
  fuerte cada 16.
- Los **hot cues** existentes, cada uno con su letra y su color (`ColorTableIndex`).
- Los **CAL existentes que son drops** (memory cues que no coinciden con un hot cue, regla
  `find_drops`) como líneas blancas con "DROP".
- Un clic en la onda pone un drop **en el golpe más cercano de la rejilla**; un clic sobre un
  drop lo quita. Al pasar el ratón, la línea fantasma "+ drop" dice dónde caerá.
- Cada cambio recalcula al momento la cuenta atrás y la dibuja (en tenue mientras no está
  guardada).
- Texto de ayuda una vez, en el encabezado de la sección (con el (i) de siempre): "Haz clic
  en la onda para marcar un drop. Surco pone la cuenta atrás a 16, 32 y 48 compases sobre la
  rejilla de rekordbox."
- Leyenda: azul 16 compases, verde 32, rojo 48, amarillo Inicio.
- Botones **Deshacer** (vuelve a lo que dice rekordbox) y **Guardar en rekordbox**.
- Si la pista tiene hot cues puestos a mano que no encajan (ver reglas), una línea: "Esta
  pista tiene hot cues puestos a mano. Surco guarda los drops y no toca los hot cues."
- Pista sin analizar: la sección dice "rekordbox aún no ha analizado esta pista" y no deja
  marcar (sin rejilla no hay compases).

### En la lista

En las filas de una playlist de rekordbox, a la derecha:

- "sin analizar" (sin `AnalysisDataPath` o sin `PQTZ`),
- "sin cues" (analizada, sin hot cues),
- o un cuadradito por hot cue en su color, en orden de tiempo.

Con cues pendientes de guardar, los cuadraditos en hueco.

### Las reglas (port de `rules.py`)

Constantes: misma posición si a 50 ms o menos; inicio, antes de 3000 ms; tolerancia de
compás 0,25; 4 tiempos por compás; distancias 16, 32, 48; máximo 8 hot cues; se recorta
primero 48 y luego 32; parte fuerte por mood de `PSSI`: mood 1 → tipo 5, moods 2 y 3 →
tipo 9.

1. **Drops** = memory cues (`Kind` 0) que no están en la misma posición que un hot cue.
2. **Plan por drop**, en orden: el golpe de la rejilla más cercano al drop; hacia atrás 16,
   32 y 48 compases (64, 128, 192 golpes). Se para en cuanto la posición se sale del
   principio de la pista, cae en o antes del drop anterior (+50 ms), o cae dentro de una
   parte fuerte de las frases `PSSI` (el estribillo del mood).
3. **Inicio**: si ningún cue del plan queda antes del primer drop y el primer golpe está
   antes de él, un hot cue amarillo en el primer golpe.
4. **Máximo 8**: se quitan primero los de 48 (el más temprano antes), luego los de 32.
5. **No pisar lo hecho a mano** (`fits_plan`): los hot cues existentes encajan si cada uno
   está antes de 3 s o en la posición de uno del plan. Encajan → Surco escribe el plan. No
   encajan → solo se guardan los drops. Añadido de Surco para poder quitar drops: también
   encajan si cada uno estaba en el plan calculado con los drops **de antes** de la edición
   (son la cuenta atrás que Surco o el script pusieron, y se recalculan).
6. **Escribir el plan** como `completar` de `cues.py`: los hot cues de antes de 3 s que no
   están en el plan se quedan como "inicio"; todos en orden de tiempo reciben las letras A..H
   (`Kind` 1, 2, 3, 5, 6, 7, 8, 9; el 4 no se usa); más de 8 → no se escribe nada y se avisa;
   un hot cue existente en la posición se reutiliza (cambiando letra y color si hace falta);
   en cada posición del plan sin memory cue se añade uno (como hace el script).
7. **Colores** (`ColorTableIndex`, con `Color` −1): 16 compases azul 1, 32 verde 22, 48 rojo
   42, inicio amarillo 32.

Los tests del port son los de `test_cues.py` y los casos de `rules.py` traducidos uno a uno,
más los de la regla 5 ampliada. La rejilla y las frases se leen con el lector ANLZ de la
exportación a USB (`anlz.ts`, tarea 4 de ese plan), ampliado con `PSSI` (en la copia local
puede venir enmascarado como en el USB; el spike (b) lo comprueba) y `PWV5`.

### Escribir cues

- Filas de `djmdCue` como las del script, que ya funcionan en su colección: ID libre, `UUID`
  v4, `ContentID`, `ContentUUID` (el `UUID` de la pista), `InMsec`, `InFrame` = ms × 150 /
  1000, `InMpegFrame`/`InMpegAbs` 0, `OutMsec` −1, `OutFrame` 0, `Kind`, `Color` −1,
  `ColorTableIndex`, `rb_local_usn` de `takeLocalUsn`, `rb_data_status` 0,
  `rb_local_data_status` 0, `rb_local_deleted` 0, `rb_local_synced` 0,
  `created_at`/`updated_at`.
- Quitar un drop que ya estaba en rekordbox: como lo hace rekordbox (borrar la fila o marcar
  `rb_local_deleted`), medido en el spike (b).
- Si rekordbox mueve algo de la pista al cambiar cues a mano (`djmdContent.updated_at`, su
  `rb_local_usn`, algún contador), el spike (b) lo mide y Surco lo imita.
- "Guardar en rekordbox" encola los cues de la pista; con rekordbox cerrado se aplican al
  momento, abierto espera (píldora). Los cues son una operación más de la cola.

### Completar solo

Opción en Ajustes, en el bloque de rekordbox: "Al cerrar rekordbox, poner la cuenta atrás en
las pistas con drops y sin hot cues". **Apagada por defecto.**

Por qué apagada:
- Escribiría en la colección, que no se puede rehacer, en pistas que el usuario no ha
  mirado en Surco. El primer cierre de rekordbox tocaría de golpe todas las pistas de la
  colección con CAL y sin hot cues, sin que nadie las vea.
- Un CAL no siempre es un drop (su colección tiene 26294 cues; no hay forma de saber cuáles
  puso como drop). El script lo asume porque Vicent lo lanza sabiendo sobre qué playlist.
- El caso que justifica encenderla (pistas recién preparadas con drops) ya lo cubre la
  sección Cues pulsando Guardar.

Encendida: solo pistas con al menos un drop, sin ningún hot cue (así `fits_plan` es cierto
por definición) y con rejilla. Pasa por la misma cola, la misma copia y la misma
transacción, y el aviso dice cuántas pistas completó. La primera vez que se enciende, antes
de guardar el ajuste, Surco cuenta y lo dice: "Se completarán 312 pistas al cerrar
rekordbox."

## La cola persistente

- Fichero propio en los datos de Surco, `rekordbox-queue.json`, junto a la copia de sesión,
  no en `settings.json`. Sobrevive a cerrar Surco.
- Cada operación guarda lo necesario para aplicarse sola y para detectar conflictos:
  - enlace (pista por `ContentID` o por ruta, playlist, alta o baja),
  - alta de pista (ruta y datos leídos del fichero en el momento de encolar),
  - crear, renombrar o borrar playlist o carpeta,
  - cues de una pista (el plan completo, no un parche), con la huella de los cues que había
    al leerlos (IDs, `Kind`, `InMsec`, `ColorTableIndex`),
  - y para cada playlist tocada, su `updated_at` cuando se encoló.
- **Cuándo se aplica**: al encolar si rekordbox está cerrado; si no, Surco mira cada 5 s si
  sigue abierto (`isRekordboxRunning`) mientras la cola tenga algo, y al arrancar Surco. Al
  verlo cerrado aplica todo. "Aplicar ahora" de la píldora.
- **Cómo se aplica**: un lote, con las garantías del escritor de la 2a. Copia de sesión
  (`.surco-session`) y copia por escritura, cada una **tras plegar el WAL**
  (`wal_checkpoint(TRUNCATE)`; si no pliega entero, no hay copia y no se escribe); se vuelve
  a comprobar que rekordbox sigue cerrado justo antes; una transacción para todo el lote,
  con los nodos del XML escritos justo antes del commit; si algo falla, primero el rollback
  de SQLite, y solo se copia encima si el estado de `master.db` es desconocido. Orden dentro
  del lote: altas de pista, playlists nuevas, enlaces, renombrados, cues, borrados.
- Al aplicar una playlist que cambia de pistas, Surco sube su `updated_at` y el `Timestamp`
  de su nodo en `masterPlaylists6.xml`, como rekordbox (medido el 18/10: al añadir Vicent una
  pista a Makina en rekordbox, el `Timestamp` del nodo cambió). Si no, el sync de rekordbox
  a un USB no vería la playlist cambiada. El spike (a) confirma cuál de los dos mueve
  rekordbox.
- **Conflictos**, gana rekordbox y Surco avisa, nunca en silencio:
  - playlist con `updated_at` posterior al encolado: sus operaciones se descartan ("No se
    añadió Bam Bam a Makina: cambió en rekordbox"). Si rekordbox mueve ese `updated_at` con
    solo abrir la playlist (daría conflictos falsos), se mide en el spike (a) y se cambia la
    huella por la lista de enlaces;
  - cues de una pista que ya no tienen la huella guardada: se descartan ("Los cues de Tengo
    cambiaron en rekordbox. Vuelve a marcarlos.");
  - pista de un enlace que ya no existe, o playlist borrada: se descarta con aviso.
- **El reapuntado de la conversión** (hoy se pierde con Cancelar) entra en la misma cola.

### La copia de `rekordbox-cues`

El script copia solo `master.db`, sin el WAL, y después de haber preparado los cambios en
memoria: si el WAL tenía datos confirmados, la copia no es completa. Surco no reutiliza ese
camino: pliega el WAL antes de cada copia, como su escritor. Se le comenta a Vicent para su
script (que pliegue antes o copie `-wal` y `-shm`), sin tocarlo desde aquí.

## Spikes, antes de programar nada

Los dos sobre **copias** de la colección en el scratchpad, nunca sobre la de
`~/Library/Pioneer`. Ningún agente escribe en `~/Library/Pioneer` ni en un USB. Cada uno
termina con una comprobación de Vicent en rekordbox de verdad: él cambia la colección por la
copia con rekordbox cerrado, guardando la suya aparte (`master.db`, `-wal`, `-shm` y
`masterPlaylists6.xml`), abre rekordbox, mira, lo cierra y devuelve la suya.

**Spike (a): una pista dada de alta por Surco aparece, se analiza y suena.**
1. Medir el molde: Vicent importa en rekordbox un WAV y un MP3 cualquiera arrastrándolos.
   Se comparan, solo leyendo, copias de antes y de después: qué tablas y columnas cambian
   (`djmdContent` columna a columna, artistas, álbum, `contentFile` u otras, `agentRegistry`,
   `masterPlaylists6.xml`), la forma de la ruta (resuelta o no, NFC o NFD), `MasterDBID`,
   `MasterSongID`, fechas.
2. Lo mismo al añadir una pista a una playlist, renombrar una playlist y abrir una playlist
   sin tocar nada: qué mueve en `updated_at` y en el `Timestamp` del XML.
3. Con el molde, un script del spike da de alta en una copia dos pistas que no están en la
   colección (una por `/Volumes/…`, otra por `~/Music/Music`) y las mete en una playlist
   nueva y en una existente.
4. Vicent abre la copia: las pistas salen en la colección y en las dos playlists, rekordbox
   las analiza (onda, BPM, tono), suenan, y una de las que ya existían no sale duplicada.
   Luego cierra rekordbox y se comprueba, leyendo la copia, que no queda nada raro (filas
   repetidas, `AnalysisDataPath` vacío).

**Spike (b): los cues escritos por Surco se ven bien.**
1. Leer en una copia los `djmdCue` de pistas con cues puestos a mano y con cues puestos por
   `cues.py` (ya usado en su colección el 18/10): `Kind`, `ColorTableIndex`, `Color`,
   `InFrame`, `ContentUUID`, IDs, `rb_local_usn`, y qué cambia en `djmdContent` al poner un
   cue a mano en rekordbox (se mide como en (a)). Cómo borra rekordbox un memory cue.
2. Leer `PSSI` de la copia local de los ANLZ: enmascarado o no.
3. Con el port en TS de las reglas, un script del spike escribe en una copia los cues de 3
   pistas con drops (una con hot cues a mano que no encajan, que no debe cambiar).
4. Vicent abre la copia: los hot cues están en su letra, color y golpe; los CAL siguen; la
   pista con cues a mano está como estaba; se exporta una a USB desde rekordbox (a un USB de
   pruebas) y en el CDJ se ven igual.

Lo que digan los spikes se escribe en `docs/llevar-a-rekordbox-medidas.md` y corrige esta spec
antes del plan.

## Arquitectura

### Main

| Módulo | Qué hace |
|---|---|
| `rekordboxQueue.ts` | la cola en disco: encolar, listar, descartar, aplicar por lotes, conflictos |
| `rekordboxQueueWatch.ts` | mirar si rekordbox se cerró mientras haya cola; aplicar al cerrarse |
| `rekordboxContentAdd.ts` | alta de pista con el molde del spike (a); búsqueda previa por ruta |
| `rekordboxPlaylistEdit.ts` (mod) | renombrar y borrar playlist o carpeta; sube `updated_at` y `Timestamp` |
| `rekordboxPlaylistWrite.ts` (mod) | aplica un lote de la cola con las garantías de hoy |
| `rekordboxCues.ts` | leer cues y drops de una pista; escribir el plan |
| `cueRules.ts` | el port de `rules.py`, puro |
| `anlz.ts` (de la exportación a USB) | más `PSSI` y `PWV5` |

IPC: `rekordbox:queue` (estado), `rekordbox:queueChanged` (evento), `rekordbox:applyNow`,
`rekordbox:discardQueue`, `rekordbox:trackCues(contentId)` (onda, rejilla, cues, drops,
frases), `rekordbox:saveCues(contentId, drops)`, `rekordbox:renamePlaylist`,
`rekordbox:deletePlaylist`. Las playlists del campo viajan dentro de la petición de
conversión que ya existe, por pista.

### Renderer

- `PlaylistsField` (fichas, buscador, crear), con su variante en lote. Clave de campo
  especial en `fields.ts`, fuera de `FIELD_DEFS` de etiquetas, añadida a `visibleFields` una
  vez al detectar la colección.
- Puntos en la fila de la lista, `CueSwatches` en la fila de rekordbox.
- `CuesSection` (onda de rekordbox, rejilla, clic, plan en vivo con `cueRules` compartido).
- `RekordboxQueuePill` en la barra de herramientas.
- Árbol: Renombrar y Borrar en el menú contextual, con el diálogo de confirmación.

`cueRules.ts` va en `shared/` para que la sección dibuje el plan sin ir al main.

## Errores

| Qué pasa | Qué ve el usuario |
|---|---|
| Pista ambigua (dos filas para un fichero) | "No se añadió Bam Bam. rekordbox la tiene dos veces." |
| Fichero que ya no está al aplicar | "No se dio de alta Bam Bam. El fichero ya no está." |
| Playlist cambiada en rekordbox | "No se añadió Bam Bam a Makina. Cambió en rekordbox." |
| Cues cambiados en rekordbox | "Los cues de Tengo cambiaron en rekordbox. Vuelve a marcarlos." |
| Más de 8 hot cues en el plan | "Tengo necesitaría más de 8 hot cues. Quita un drop." |
| Sin copia (WAL que no pliega, disco lleno) | nada se escribe, la cola sigue: "No se pudo hacer la copia de rekordbox. Se intentará al cerrarlo otra vez." |
| Falla a mitad | rollback; la cola sigue con todo; aviso con la ruta de la copia si hubo que restaurar |
| Colección no encontrada | ni campo ni sección; la cola se conserva hasta que vuelva |

Los textos llegan del main como códigos y se traducen en los cinco idiomas.

## Pruebas

- `cueRules`: los casos de `test_cues.py` uno a uno, más la regla 5 ampliada (quitar un
  drop recalcula), recorte a 8, partes fuertes por mood, inicio. Mutación sobre `fits_plan`
  y el recorte.
- `rekordboxContentAdd`: sobre la fixture cifrada ampliada con columnas del spike (a); la
  gemela se reutiliza, la ambigua se salta, ruta por enlace simbólico no duplica, filas de
  artista y álbum reutilizadas.
- `rekordboxQueue`: sobrevive a reiniciar; aplica al cerrarse rekordbox (proceso falso);
  conflicto por `updated_at` y por huella de cues, que gana rekordbox; un lote es una
  transacción (seam después del UPDATE, como en `rekordboxLibrary.test.ts`); sin copia no
  escribe; orden dentro del lote.
- Renombrar y borrar: test rojo primero; borrar una carpeta se lleva sus hijas y nunca una
  fila de `djmdContent`.
- Renderer: el campo (filtrar con ruta, crear, varias pistas a medias), puntos de la fila,
  la sección Cues (clic al golpe, quitar drop, aviso de hot cues a mano, sin analizar),
  píldora. Selectores `data-testid`.
- **Verificación con Vicent en rekordbox real**, tras los spikes y otra vez con la app
  empaquetada sobre una copia: una pista nueva convertida con dos playlists aparece, se
  analiza y suena; los cues de 3 pistas se ven bien; con rekordbox abierto la píldora espera
  y al cerrarlo se aplica; borrar y renombrar desde el árbol.

## Fuera de alcance

Que Surco analice el audio y escriba ANLZ (opción B, spike futuro), detectar drops solo,
playlists inteligentes, cambiar BPM, tono o rejilla, colores de pista y My Tags, mover
playlists entre carpetas arrastrando en el árbol, Engine DJ y Traktor, y tocar el script
`rekordbox-cues` de Vicent.
