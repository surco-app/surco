# Serato fase (c): crates, añadir a la biblioteca y etiquetas

Continúa `2026-11-03-serato-cuarto-programa-design.md` (objetivo 2, fase c) y
`2026-11-03-serato-fase-b-design.md`. Las fases (a) y (b) están publicadas en v1.23.0.

## Por qué

El usuario quiere que la pestaña Serato tenga lo mismo que las de rekordbox y Traktor. Hoy en ella
se pueden ver los crates y editar los cues, pero no tocar los crates, y lo que Surco convierte o
retoca no llega a la biblioteca de Serato. Decisión del usuario (04/11): "termina esto que falta y
continúa con la c", con la regla de siempre: "estate seguro de que no rompemos nada".

## Medido el 04/11 (Serato DJ Pro 5.0.0.1278, `~/Music/Serato Pruebas`, siempre con Serato cerrado)

- **Crate nuevo** en `_Serato_/Subcrates/<nombre>.crate`: Serato lo importa al arrancar.
- **Crate con pistas que Serato no conocía:** las añade a la biblioteca. En el log sale "Adding
  track not found in database … found in crate", y los metadatos los lee del fichero.
- **Subcrate** `Padre%%Hijo.crate`: aparece colgado del padre.
- **Borrar el `.crate`:** el crate desaparece de Serato.
- **Editar un campo de una pista en `database V2` sin tocar `pfil`** (probado con `tsng`): Serato
  actualiza la misma pista y conserva el rating.
- **Añadir un `otrk` al final de `database V2`** (con `ttyp`, `pfil` y `tsng`): la pista entra en la
  biblioteca con ese título. `ttyp` debe ser el de Serato (`mp3`, `wave`, `aiff`, `flac`,
  `quicktime`); con `wav` la descarta ("type 'wav' is not supported").
- **Cambiar `pfil` (repuntar):** Serato borra la pista y crea otra, y pierde el rating, que solo
  vive en `master.sqlite`. Por eso el repunte queda fuera de esta fase (ver No objetivos).
- **Cambiar la etiqueta solo en el fichero:** Serato no la relee al arrancar; solo al cargar la
  pista en el deck.

## Objetivos

1. **Editar crates en la pestaña Serato**, con las mismas acciones que rekordbox y Traktor menos los
   separadores, que Serato no tiene:
   - crear un crate, en la raíz o dentro de otro (subcrate);
   - renombrar;
   - borrar;
   - añadir pistas (arrastrando filas o desde otra pestaña);
   - quitar pistas;
   - reordenar.
2. **Añadir a Serato lo que Surco convierte** (ajuste `addToSerato`, mismo valor por defecto que
   `addToEngineDj`). Un fichero nuevo que Serato no tiene entra en su biblioteca. Si la conversión
   eligió crates de Serato, entra también en esos crates.
3. **Llevar a Serato los cambios de etiquetas** (ajuste `syncSerato`, mismo valor por defecto que
   `syncEngineDj`). Desde la revisión de etiquetas, el título, el artista, el álbum y el género se
   actualizan en `database V2` para las pistas que Serato tiene en la misma ruta.

## No objetivos

- **Repuntar** (seguir un fichero que cambia de ruta o de formato). Cambiar `pfil` pierde el rating.
  Lo lleva otra sesión: hoy Surco conserva el original y avisa ("Serato lo usa y no puede pasar al
  fichero nuevo"). Esta fase no cambia nunca el `pfil` de una pista existente.
- **Desbloquear convertir en las filas de la pestaña Serato.** Depende de lo anterior y sigue
  bloqueado.
- **Escribir en `master.sqlite`, `root.sqlite` o en los `.sqlite` de los discos de red.**
- Smart crates (`SmartCrates/`) y el orden de crates del panel (`neworder.pref`): ni se leen para
  editar ni se tocan.
- Las columnas que guarda cada crate: se conservan tal cual al editarlo.
- USB (fase d).
- Integrar las copias de Serato en la pantalla Copias. Las copias se guardan, pero restaurarlas
  desde la app queda para después (decisión mía; los otros programas sí lo tienen).
- El álbum de artista (`albumArtist`): no se sabe en qué campo de `database V2` lo guarda Serato.
  No se sincroniza (decisión mía).

## Antiobjetivos

- **Escribir con Serato abierto.** Todo va a la cola de Serato (la de los cues de la fase b) y se
  aplica cuando se cierra, sin pedir que se cierre: Serato no tiene salida programable y su salida
  se cuelga.
- **Perder datos de Serato que Surco no entiende.** Al reescribir `database V2` o un `.crate`, todo
  lo que no cambia se conserva byte a byte, en su orden. Esto incluye entradas y campos
  desconocidos y las columnas del crate.
- **Pisar un cambio que Serato hizo después de que Surco leyera.** Si el fichero cambió desde la
  lectura (mtime y tamaño), la edición se rechaza y se avisa, como con Traktor.
- **Romper rekordbox, Traktor o Engine.** La suite, los tres typecheck y la matriz quedan iguales a
  la base: 126 bien y 4 fallos conocidos, más los ejes nuevos que añada la otra sesión.

## Diseño

### Formatos (shared y main)

- **`.crate`:**
  - Un codificador completo, además del lector que ya existe: leer un crate, cambiar su lista de
    pistas (`otrk`/`ptrk`) y volver a escribirlo con el resto de tramas en su sitio.
  - `buildSeratoCrate` sigue sirviendo para crates nuevos.
  - Las rutas van relativas a la raíz del volumen del `_Serato_` que contiene el crate, como ya
    hace `buildSeratoCrate`.
  - Una pista de otro volumen no se puede representar: se rechaza esa pista y se avisa.
- **`database V2`:**
  - Un escritor que cambia campos de texto de una entrada (`tsng`, `tart`, `talb`, `tgen`) buscando
    por `pfil` y deja todo lo demás igual byte a byte.
  - Otro que añade una entrada `otrk` al final con `ttyp`, `pfil`, `tsng`, `tart`, `talb`, `tgen` y
    `tadd`/`uadd` (la hora de alta).
  - `ttyp` sale del formato: `.mp3` → `mp3`, `.wav` → `wave`, `.aif`/`.aiff` → `aiff`,
    `.flac` → `flac`, `.m4a`/`.mp4` → `quicktime`.
  - Ninguno toca `pfil` de una entrada existente.
- **Nombres de crate:**
  - El nombre del fichero es la ruta en el árbol, unida con `%%`.
  - Un nombre con `%%`, con `/` o vacío se rechaza.
  - Renombrar un crate renombra también los ficheros de todos sus subcrates. Borrar un crate borra
    también los de sus subcrates.

### Escritura

- Cada operación se aplica con Serato cerrado: comprobar que está cerrado, leer, comparar huella,
  copiar los ficheros que se van a tocar a la carpeta de copias de Serato de Surco, escribir en un
  temporal, renombrar, y volver a comprobar que Serato sigue cerrado justo antes del rename (como
  en la fase b).
- La cola es la de Serato (`serato-cue-queue.json` de la fase b). Si el formato de la cola necesita
  otro tipo de operación, se amplía sin perder lo que ya haya encolado.
- Cada raíz `_Serato_` (disco interno, discos externos) se trata por separado: un crate vive en la
  raíz que lo contiene, y una pista nueva se añade al `database V2` de la raíz de su volumen.

### Pestaña Serato

- Serato tiene `edit` en `SOURCE_PROGRAMS`, con las acciones de rekordbox y Traktor menos
  insertar separador.
- "Crear carpeta" no se ofrece: en Serato un crate puede tener pistas y subcrates a la vez. Crear
  dentro de un crate crea un subcrate.
- Si Serato está abierto, el aviso de siempre dice que se guardará al cerrarlo.

### Convertir y revisar etiquetas

- **Añadir:** entra en el vaciado de la conversión como un programa más, después de los tres de hoy.
  Solo añade si el fichero de salida es nuevo para Serato (no está en el `database V2` de su
  volumen) y su volumen tiene `_Serato_`.
- **Crates elegidos en la conversión:** se añaden a la pista como en los otros programas.
- **Etiquetas:** `syncSerato` entra en la sincronización de etiquetas de la revisión, como un
  programa más.
- **Tipos:** donde una tabla hoy es `Record<WritableProgram, …>` y Serato ha de entrar, se usa un
  tipo propio que incluya a Serato, como `CueProgram` en la fase b. `WritableProgram` no cambia,
  porque sigue excluyendo a Serato de repuntar, USB y copias. El plan decide qué tablas.

## Cómo no romper nada

- Tests primero, con fixtures sintéticas de `.crate` y `database V2` (ya hay codificadores de test en
  `seratoDatabaseFixture.ts`) y con los ficheros reales de la fase (a).
- Ida y vuelta exacta: leer y escribir sin cambios da los mismos bytes en todas las fixtures.
- Mutación en cada pieza nueva: los dos escritores, el renombrado en cascada, la huella y la cola.
- Prueba manual al final, manejando Serato yo, sobre `~/Music/Serato Pruebas` con copia exacta de
  `_Serato_` y de la biblioteca de Serato antes:
  - crear, renombrar, borrar y reordenar crates y subcrates desde Surco;
  - añadir y quitar pistas;
  - convertir un fichero con "añadir a Serato" y un crate elegido;
  - cambiar un título en la revisión y ver que Serato lo muestra conservando las estrellas.

## Coordinación

Otra sesión trabaja en paralelo en la propagación entre programas y en el repunte de Serato. Esta
fase no toca `librariesKeepingOriginal`, `retireOriginal` ni `RekordboxRepoint.names`. Si los
necesita, avisa antes.

## Lo que queda abierto

- El campo de `database V2` del álbum de artista.
- Si Serato ordena el panel con `neworder.pref` y un crate nuevo cae al final o por orden alfabético.
  Se mira en la prueba manual, sin escribir ese fichero.
