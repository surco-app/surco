# VirtualDJ como quinto programa de DJ

## Por qué

Surco trabaja con rekordbox, Traktor, Engine DJ y Serato. VirtualDJ es el programa que falta para
cubrir los más usados (decisión del usuario, 10/11: "así soportamos todos los programas más usados").
Tiene que salir completo, como el resto, no por fases publicadas: pestaña con sus playlists, editor de
cues que guarda, editar playlists, pegar un tracklist, sesión automática, añadir lo convertido, llevar
etiquetas, repuntar y USB ("todas las funcionalidades").

El refactor del 10-11/11 (`docs/superpowers/specs/2026-11-10-programas-dj-interfaz-design.md`) dejó
una puerta común: VirtualDJ entra por `window.api.dj.*` y `window.api.cues.*` y por las tablas por
programa que exige el compilador. Su prueba de fuego con un VirtualDJ falso dejó una lista de sitios que
el compilador no pide (sección "Resultado de la prueba de fuego" del plan
`docs/superpowers/plans/2026-11-10-programas-dj-interfaz.md`). Esa lista es parte de este diseño.

Decisiones del usuario (11/11): todo en una rama, sin mergear a main hasta probarlo todo al final; y una
batería de tests de integración que pruebe todos los programas.

## Medido el 11/11 (VirtualDJ 8.5.9307, build 850.9729, macOS, `~/Music/Serato Pruebas`)

- **Biblioteca.** Un único XML, `~/Library/Application Support/VirtualDJ/database.xml`, raíz
  `<VirtualDJ_Database Version="2026">`. Una pista es `<Song FilePath="ruta absoluta" FileSize="bytes"
  Flag="…">` con hijos `<Tags Author Title Genre Album TrackNumber Year Bpm Key Flag>`, `<Infos
  SongLength LastModified FirstSeen FirstPlay LastPlay PlayCount Bitrate Cover>`, `<Comment>`, `<Scan
  Version Bpm Phase AltBpm Volume Key AudioSig Flag>` y varios `<Poi>`. La pista se identifica por su
  ruta: el mismo fichero en dos carpetas son dos `<Song>`.
- **BPM.** `Bpm` está en segundos por pulso (`0.447761` son 134 BPM), en `Tags` y en `Scan`.
- **Cues.** `<Poi Type="cue" Num="n" Pos="segundos" Name="…" Color="entero ARGB">`. `Num` es el pad
  (1, 2…). Los cues que pone el usuario sin nombre no llevan `Name` ni `Color`. Hay además `Poi`
  `Type="automix"` (con `Point`) y `Type="remix"` (con `Name`), que Surco no edita.
- **Cuándo escribe.** Escribe `database.xml` en cuanto cambia algo, no solo al cerrar (cargar una pista
  lo creó al instante), y otra vez al cerrar.
- **Cues de las etiquetas.** Su ajuste `getCuesFromTags = for new files` lee los cues que ya trae el
  fichero la primera vez que lo ve (leyó el cue `Surco` que llevaba Pray). `setTagsAuto = no`: no
  escribe etiquetas en el audio.
- **Reloj.** El mismo cue que Surco escribió a 30,000 s lo lee a 30,000 en el FLAC y a 29,973878 en el
  MP3: VirtualDJ adelanta el MP3 26,12 ms respecto a Surco. Los demás formatos, sin medir.
- **Playlists.** `MyLists/<nombre>.vdjfolder`, XML `<VirtualFolder noDuplicates="no">` con
  `<song path="ruta absoluta" size="bytes" idx="0" …>` (a veces también `songlength`, `bpm`, `key`,
  `artist`, `title`). Una lista vacía o una carpeta es `<VirtualFolder />`.
- **Carpetas.** Una carpeta `X` es `MyLists/X.vdjfolder` vacío más el directorio
  `MyLists/X.subfolders/`, con sus listas dentro. El orden de cada nivel va en un fichero `order`, un
  nombre por línea.
- **Filtros.** `Folders/Filters/*.vdjfolder` son listas inteligentes de VirtualDJ.
- **Proceso.** Ejecutable `VirtualDJ` (`pgrep -x VirtualDJ`). Pide iniciar sesión en su web al abrirse.

## Objetivos

1. **Pestaña VirtualDJ** en el carril de fuentes y su casilla en Ajustes, Sidebar: "All tracks" desde
   `database.xml` y el árbol de `MyLists` (listas y carpetas, en el orden de `order`).
2. **Editor de cues que lee y guarda** los hot cues de VirtualDJ (posición, nombre, color), con el mismo
   flujo que los demás: borrador, Guardar, Guardar todo, cola mientras VirtualDJ está abierto, deshacer.
   Reloj correcto por formato en lectura y escritura.
3. **Rejilla de VirtualDJ** leída de `Scan` (`Bpm` y `Phase`), para pintar los cues sobre la onda, pegar
   al golpe, Auto mark y pasar cues entre programas.
4. **Cues entre programas** con VirtualDJ como origen y como destino (`cueFlowToVirtualdj`), y sus
   gemelas.
5. **Editar listas y carpetas** en la pestaña: crear (en la raíz o dentro de una carpeta), renombrar,
   borrar, añadir pistas, quitar, reordenar. Con eso entran solas **pegar un tracklist** y la **sesión
   automática** (las dos piden `collection` y `edit`).
6. **Añadir a VirtualDJ lo convertido** (`addToVirtualdj`) con las listas elegidas, y **llevar las
   etiquetas** de la revisión (`syncVirtualdj`) a los `<Tags>` de las pistas que VirtualDJ tiene en la
   misma ruta.
7. **Convertir y repuntar.** Una pista de VirtualDJ se puede convertir: el `<Song>` pasa a la ruta y el
   tamaño nuevos, sus cues pasan al reloj del formato de salida, y las listas que la contienen apuntan al
   fichero nuevo. VirtualDJ es `WritableProgram`.
8. **USB de Pioneer desde la pestaña VirtualDJ**, como hoy desde Serato y Traktor: listas y carpetas, con
   cues, rejilla y etiquetas.
9. **Copias** de `database.xml` y `MyLists` antes de cada escritura, restaurables desde la pantalla Copias.
10. **Los 14 sitios de la prueba de fuego**, resueltos para VirtualDJ y, donde sea una capacidad,
    convertidos en tabla que el compilador exija (ver "Lista de la prueba de fuego").
11. **Batería de integración de los cinco programas** (ver su sección): es la puerta para mergear.

## No objetivos

- Escribir en `Folders/Filters` (listas inteligentes) ni en `History`. Los filtros no se muestran.
- Los `Poi` `automix` y `remix`: se conservan tal cual, no se editan ni se muestran.
- Editar loops: se leen y se pintan en el editor como los de Serato, y se conservan tal cual al escribir
  (decisión mía, igual que Serato). Los hot cues por encima del 8 (`Num` mayor que 8) también se
  conservan sin tocarlos.
- Escribir etiquetas en el fichero de audio por VirtualDJ ni tocar su ajuste `setTagsAuto`.
- Windows. VirtualDJ existe en Windows, pero nada está medido allí. La pestaña se oculta en Windows hasta
  medirlo (decisión mía, como se hizo con Serato).
- Iniciar sesión en VirtualDJ o depender de su cuenta.

## Antiobjetivos

- Escribir con VirtualDJ abierto. Escribe la base de datos en cuanto cambia algo y al cerrar, así que
  pisaría lo que escriba Surco. Toda escritura va por la cola de VirtualDJ y espera a que esté cerrado.
- Perder un byte de lo que Surco no entiende: atributos y nodos desconocidos de `<Song>`, otros `Poi`,
  el `Flag`, `AudioSig`, el orden de los nodos y la codificación se conservan al reescribir.
- Cambiar nada de los otros cuatro programas salvo para arreglar un fallo que encuentre la batería de
  integración. La matriz de escenarios, celda a celda igual a la base o mejor.
- Que VirtualDJ se quede fuera de algo en silencio porque el compilador no lo pide.

## Diseño

### Formatos (main)

- **Lector de `database.xml`**: lista de pistas (ruta, tamaño, etiquetas, duración, BPM, tonalidad,
  cues, rejilla) con caché por mtime y tamaño, como las lecturas de `_Serato_`.
- **Escritor de `database.xml`** que reescribe solo los nodos que cambian (los `Poi` `cue` de una pista,
  los atributos de `Tags` sincronizados, `FilePath` y `FileSize` al repuntar, un `<Song>` nuevo al añadir)
  y deja el resto del texto idéntico byte a byte. Un test de ida y vuelta sobre el fichero medido fija que
  leer y escribir sin cambios da los mismos bytes.
- **Lector y escritor de `MyLists`**: `.vdjfolder`, `.subfolders/` y `order`. Igual criterio: una lista
  que no cambia no se reescribe.
- **Ids.** Prefijo `virtualdj:` más la ruta del `<Song>`, con su detector en la tabla `CONTENT_OF` de
  `programOf`.

### Reloj y rejilla

- La diferencia entre el reloj de VirtualDJ y el de Surco se calcula por fichero, como hace
  `main/seratoClock.ts` (frecuencia de muestreo, retardo del codificador, AAC frente a ALAC), y no como
  una constante por formato (decisión mía). Los 26,12 ms del MP3 son exactamente 1152 muestras a
  44,1 kHz, un frame de MP3. Se mide con un cue de Surco en los cinco formatos y además en un MP3 a
  48 kHz, un MP3 sin cabecera LAME y un M4A ALAC.
- La rejilla sale de `Scan`: `Bpm` (segundos por pulso) y `Phase`. En Pray, 57,559 s menos 128 pulsos de
  0,447778 s da 0,244 s, junto al `realStart` de 0,248 s, así que `Phase` parece una negra de anclaje.
  Se confirma en el bloque 1 contra la rejilla que pinta VirtualDJ. VirtualDJ no sale sin rejilla: la
  necesitan el USB, pegar al golpe, Auto mark y los cues entre programas (decisión mía, porque tiene que
  salir completo).

### Escritura

- Cola de VirtualDJ (`cueQueue`), con su pastilla y su aviso de "VirtualDJ está abierto" (`runningNote`,
  `running` en main con `pgrep -x VirtualDJ`).
- Antes de cada escritura, copia de `database.xml` y de `MyLists` en la carpeta de copias de Surco.
- Justo antes de cada renombrado se comprueba otra vez que VirtualDJ sigue cerrado.

### Pestaña y ajustes

- Disponibilidad: `database.xml` presente en la carpeta de VirtualDJ. Ruta ajustable en Ajustes,
  Programas de DJ (un panel propio, no vacío), con su ajuste guardado.
- Ajustes guardados nuevos: `addToVirtualdj`, `syncVirtualdj`, `cueFlowToVirtualdj`,
  `virtualdjPlaylistsFieldOffered` y la ruta de la biblioteca. Mismos valores por defecto que Serato.
- El asistente de bienvenida detecta VirtualDJ como a los demás.

### Lista de la prueba de fuego

Cada punto de la sección "Lo que el compilador no pidió" del plan del refactor se resuelve para
VirtualDJ. Donde sea una capacidad que otro programa podría tener, se convierte en tabla que el compilador
exija, con su test; donde no, se resuelve a mano y queda apuntado en el mapa. En particular:

- Proteger los ficheros que VirtualDJ usa al reemplazar, mover a la papelera o dejar sin original
  (`libraryFileUse.ts`, `librariesKeepingOriginal`, `usedByAnyLibrary`).
- Las consultas de disponibilidad escritas a mano (`useSourceBrowser.ts`, la sonda `foundBy` de
  `CuesTab.tsx`, `playlistLibrariesFound` de `App.tsx`).
- Las gemelas de cues, los duplicados y la revisión de listas (`libraryTracksOf`,
  `duplicateLibraryDeps`, `listReviewDeps`).
- `UsbProgram` y `WritableProgram` derivados de tablas de capacidades, sin el nombre de un programa
  dentro de un tipo compartido.
- `useCopies.ts` y `PICKED` de `revealCue.ts`, sin listas de programas a mano.
- Guardar cues de un programa sin fuente de cues deja de ser un no-op silencioso.
- Los tests que afirman la lista de programas y los tres que usan `'virtualdj'` como ejemplo de programa
  desconocido.

### Batería de integración de los cinco programas

Una suite que recorre, para cada programa de `DJ_PROGRAMS` y desde una biblioteca de pruebas por
programa construida en un directorio temporal, el mismo guion por la puerta común:

1. leer el árbol, una playlist, la colección y la pertenencia;
2. editar una playlist (crear, renombrar, añadir, quitar, borrar) donde el programa edite;
3. guardar un cue y leerlo otra vez, en cada formato, comprobando el reloj;
4. convertir una pista y comprobar el repunte y los cues en el fichero nuevo;
5. llevar etiquetas y añadir a la biblioteca;
6. exportar a USB donde el programa tenga USB.

La lista de programas sale de las tablas, y cada programa declara su biblioteca de pruebas en una tabla
que el compilador exige: un programa nuevo no compila sin su fila, y una capacidad que declara se prueba
sin que nadie lo pida. Corre en la suite normal, sin depender de las bibliotecas reales del usuario, con
audios de pocos segundos generados con ffmpeg para que no pese en cada commit (decisión mía). Es la puerta
para mergear a main, junto con la matriz y la prueba a mano final.

**Un fallo que encuentre la batería en rekordbox, Traktor, Engine o Serato se arregla en esta rama antes
de mergear** (decisión del usuario, 11/11: "se arregla por supuesto"). Cada arreglo lleva primero el test
que falla, en un commit propio, y su programa vuelve a pasar la matriz y la prueba a mano de lo que toca.
Si un arreglo cambia una celda de la matriz, solo puede ser de fallo a acierto (por ejemplo, alguno de los
cuatro fallos conocidos de la base).

## Cómo no romper nada

- TDD rojo-verde y mutación a mano en cada pieza nueva (lectores, escritores, reloj, cola).
- Cada commit con la suite completa, los tres typecheck y Biome sin errores nuevos en lo tocado.
- La matriz celda a celda igual a la base al final de cada bloque.
- Prueba a mano al final de cada bloque con el driver; las que necesitan VirtualDJ abierto (comprobar en
  su pantalla lo que escribió Surco) las hace el usuario abriéndolo y cerrándolo, con la copia de
  `database.xml` y `MyLists` hecha antes.
- Todo en la rama `virtualdj`; nada se mergea a main hasta que pasen la batería, la matriz y la prueba
  final.

## Lo que queda por medir (al empezar cada bloque, con VirtualDJ cerrado)

- Cómo guarda un loop (no apareció ninguno) y cómo guarda el color de un cue que pone el usuario.
- Si VirtualDJ respeta al abrirse lo que Surco escribió con él cerrado en `database.xml` y en `MyLists`,
  y si lo conserva al cerrarse.
- El reloj en WAV, AIFF y M4A.
- Qué es `Scan Phase`.
- Si usa una base de datos por disco externo (`<disco>/VirtualDJ/database.xml`) al añadir una pista de
  `/Volumes/Public`, y con qué rutas. Si la usa, sus pistas se leen y se escriben como las del disco
  interno, cada una en la base de datos de su volumen montado, y la ruta única por programa
  (`SyncedLibraries`, `DJ_COLLECTION_PATH`) pasa a admitir varias raíces en el bloque 1 (decisión mía,
  porque los DJ suelen tener la música en discos externos).
- Qué hace con una ruta que ya no existe (pista desaparecida) y con un `<Song>` añadido por fuera sin
  `Scan`.

## Orden por bloques

1. Medidas que faltan, y la lista de la prueba de fuego que no depende de VirtualDJ (tablas de
   capacidades, protección de ficheros genérica).
2. Lectura: pestaña, árbol, colección, cues en el editor (solo leer), rejilla, reloj.
3. Escritura de cues, cola, gemelas y cues entre programas; conservar cues al convertir.
4. Listas y carpetas, añadir lo convertido, etiquetas, repuntar y convertir.
5. USB desde VirtualDJ.
6. Batería de integración de los cinco programas.
7. Prueba final completa y merge a main local (sin push).

## Lo que queda al constructor

- Nombres de módulos y funciones, siguiendo los de Serato (`virtualdjLibrary.ts`, `virtualdjCues.ts`…).
- La forma exacta de las bibliotecas de pruebas de la batería.
- Cómo se reparte la batería en ficheros.
