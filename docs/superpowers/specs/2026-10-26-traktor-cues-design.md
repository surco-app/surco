# Pestaña Traktor, fase 2: Cues y Auto mark

## Por qué

Auto mark es la función que más está gustando y hoy solo escribe en rekordbox y Engine DJ.
djotas pincha con Traktor. La fase 1 (rama `traktor-tab`) ya lista playlists, Recently added
y pinta los cues en la fila; esta fase hace que la sección Cues del editor funcione con una
pista de Traktor igual que con una de Engine: ver los cues, Auto mark, editar a mano, Guardar,
y que al abrir Traktor estén ahí.

## Objetivos

- Abrir la sección Cues para una pista de la pestaña Traktor, con rejilla, cues existentes y
  onda.
- Auto mark propone y marca drops como en Engine (Traktor no tiene frases).
- Guardar encola el juego de cues y lo escribe en `collection.nml` cuando Traktor está cerrado,
  con la misma cola, aviso y "aplicar ahora / descartar" que Engine.

## No objetivos

- Crear playlists o añadir pistas (fase 3).
- Escribir los cues en el tag TRAKTOR4 del fichero. Traktor manda el NML (ver
  `traktorNml.ts`); el fichero no se toca.
- Elegir tipo de cue (load, fade, loop) desde las reglas. Decidido por el usuario: todo cue que
  escribe Surco es un cue normal.
- Completar al cerrar Traktor, cues provisionales con rejilla de Surco, aprendizaje de flujo.
  Son de rekordbox y no se trasladan.

## Antiobjetivos

- Escribir un NML que no se pidió confirmar. `traktorNmlPath.ts` exige que el usuario acepte la
  ruta antes de tocar el fichero: la escritura usa SOLO `settings.traktorNmlPath`; la ruta
  detectada sirve para leer, nunca para escribir.
- Perder un cue que el DJ puso en Traktor: load, fade y loop existentes se conservan con su
  tipo.
- Tocar el marcador de rejilla (`TYPE=4`) o el hotcue 1.

## Lo que sabemos de Traktor (medido en el NML de djotas, 26/10)

- Cada cue es un `<CUE_V2>` dentro de su `ENTRY`. `START` y `LEN` en ms.
- `HOTCUE` 0..7 es el botón 1..8; `-1` es un cue sin botón.
- El color lo da `TYPE`: 0 cue azul, 1 fade in y 2 fade out naranja, 3 load amarillo,
  4 rejilla blanco, 5 loop verde. `COLOR` solo aparece en los cues que pone Traktor.
- Traktor 4 pone en `HOTCUE=0` un cue `NAME="AutoGrid"`, `TYPE=0`, `COLOR="#FFFFFF"` en el
  mismo `START` que el marcador de rejilla `TYPE=4` (que lleva `<GRID BPM>` dentro).

## Decisiones del usuario

1. Todos los cues que escribe Surco son `TYPE=0` (azul). El color de cada regla sigue valiendo
   solo para rekordbox y Engine.
2. El hotcue 1 (`HOTCUE=0`) queda reservado al AutoGrid: Surco nunca lo lee como editable ni lo
   escribe. Auto mark usa los botones 2 a 8, es decir 7 hot cues.

## Diseño

### Identidad

`shared/traktorContent.ts`, gemelo de `engineContent.ts`: `traktorContentId(key)`,
`isTraktorContent(id)`, `traktorKey(id)`. La clave es la misma que usa Traktor en sus
`PRIMARYKEY`: `VOLUME + DIR + FILE`. `readTraktorPlaylist` pone `contentId` en cada entrada.

### Letras de Surco ↔ botones de Traktor

La letra i de Surco (A=`HOT_KINDS[0]`…G=`HOT_KINDS[6]`) es `HOTCUE=i+1`. Lo que haya en
`HOTCUE=0` no entra en el modelo. La letra H no tiene botón: un juego guardado con H la
descarta con un aviso, como Engine descarta los cues de memoria (`cues-calls-dropped`); código
nuevo `cues-slot-dropped`.

La fila de la lista (fase 1) usa el mismo mapeo, para que la fila y el editor digan la misma
letra del mismo cue. Hoy la fila mapea `HOTCUE=n` a `HOT_KINDS[n]`: se corrige.

### Lectura (`main/traktorCues.ts`)

De un `ENTRY`, un `TrackCues`:

- `cues`: hot cues de los botones 2..8 con `kind` según el mapeo y `color` = color de su tipo
  (`TRAKTOR_TYPE_COLOR`, ya en `traktorPlaylists.ts`). Los cues sin botón (`HOTCUE=-1`,
  `TYPE≠4`) como cues de memoria (`kind` 0, `color` null).
- `id`: el orden del `CUE_V2` dentro del `ENTRY` en texto, único aunque haya varios `HOTCUE=-1`
  (si fuera el `HOTCUE`, dos cues de memoria darían `duplicate-id`). *Decisión de quien
  escribe la spec.*
- Los cues que no son `TYPE=0` (fade in 1, fade out 2, load 3, loop 5) llevan `loop: true`, la
  marca que `validWantedSet` ya usa para "intocable": el DJ los puso en Traktor y el usuario
  pidió respetarlos, así que Surco no los mueve, no los borra y Auto mark planifica alrededor
  de ellos igual que alrededor de un loop de rekordbox. (Respuesta a la revisión: lo ya
  decidido, "lo que ya hay se respeta".)
- `grid`: desde el `TYPE=4` y su `GRID BPM`, un beat cada `60000/BPM` ms en toda la duración,
  hacia atrás y hacia delante, con el marcador como beat 1 del compás. Sin marcador o sin BPM,
  `analysed: false`.
- `durationMs` de `PLAYTIME_FLOAT` (o `PLAYTIME`). `phrases: []`, `strong: []`.
- `wave: null`. La onda de detalle sale del audio (ver Auto mark).
- `fingerprint` = `cueFingerprint(cues)`, para que guardar rechace un juego que Traktor cambió
  entretanto.

### IPC

Las rutas `rekordbox:trackCues`, `cueWaveDetail`, `cueDropInput`, `queuedCues`, `undoCues` y
`saveCues` ya despachan Engine por el prefijo del `contentId`; Traktor entra igual, con un
`host.traktor` hermano de `host.engine`:

- `trackCues` → lectura de arriba sobre el NML que lee la pestaña.
- `cueWaveDetail` → las palabras de onda del audio del fichero (`host.words`), para que el
  zoom tenga onda.
- `cueDropInput` → como `engineDropInput`: si la pista está en rekordbox por su ruta, sus
  frases y onda; si no, `{ grid, phrases: [], words }` del audio.
- `saveCues` → a la cola de Traktor.

### Escritura (`main/traktorCuesWrite.ts`)

`applyTraktorCuesBatch(nmlPath, ops, deps)`, mismo contrato `BatchResult` que
`applyEngineCuesBatch`:

1. Sin `settings.traktorNmlPath` confirmado: `{ ok: false, reason: 'unreadable' }`. Es la
   segunda guarda: la primera está en el editor, que con una pista de Traktor y sin ruta
   confirmada no deja Guardar ni Auto mark y dice dónde ponerla (ver Textos), para que nadie
   prepare trabajo que no se puede escribir. La cola apunta cada op a la colección con la que
   se guardó, como en rekordbox y Engine; si la ruta cambia, las ops pendientes salen como
   "otra colección" con el aviso que ya existe. *Decisión de quien escribe la spec.*
2. Los cues de memoria sí se escriben (Traktor los tiene, `HOTCUE=-1`), a diferencia de Engine.
   El único aviso nuevo es el de la letra H.
3. Por cada op: localizar el `ENTRY` por clave, releer, comprobar `fingerprint` y
   `validWantedSet`; si no, `cues-changed` / `cues-invalid` como Engine.
4. Reescribir solo los `CUE_V2` de ese `ENTRY`, como texto (igual que `traktorNml.ts`):
   - el `TYPE=4` y el `HOTCUE=0` se quedan tal cual;
   - un cue querido con `id` de uno existente y la misma posición conserva su elemento entero
     (tipo, `LEN`, `NAME`, `REPEATS`);
   - uno nuevo o movido (solo puede ser `TYPE=0`, los demás son intocables) se escribe `TYPE="0"`, `LEN="0.000000"`, `REPEATS="-1"`,
     `NAME="n.n."`, `DISPL_ORDER="0"`, `START` con 6 decimales y su `HOTCUE` (o -1);
   - los que ya no están en el juego se borran.
5. La escritura del fichero pasa por la guarda existente de `traktorNmlLibrary.ts`
   (`writeCollection`: copia `.surco-backup`, segunda comprobación de Traktor abierto,
   escribir y renombrar); se exporta para usarla aquí.

### Cola y aviso

Convivencia con el sync de conversión (`syncTraktor`), que también reescribe el NML al cerrar
Traktor y puede mover un `ENTRY` a otra ruta: las dos escrituras pasan por
`serialLibraryFlush`, así que nunca se pisan, y cada una relee el NML justo antes de escribir.
Si una conversión movió la pista de un juego de cues pendiente, la clave ya no existe y la op
sale como `cues-changed` con su aviso; el DJ vuelve a marcar esa pista. Seguir el fichero a su
nueva clave queda fuera de esta fase. *Decisión de quien escribe la spec.*

Una tercera `createRekordboxQueue` (`traktor-cue-queue.json`) con su `watchRekordboxQueue`
sobre `isTraktorRunning`, y `registerTraktorCueQueueIpc` gemelo de `engineCueQueueIpc.ts`
(`traktor:cueQueue`, `applyCueQueue`, `discardCueQueue`, `cueQueueReady`, eventos
`cueQueueChanged` / `cueQueueApplied`). En el renderer, `TRAKTOR_CUE_QUEUE` en
`useRekordboxQueue.ts` y su `RekordboxQueuePill` junto a la de Engine. El diálogo de "cierra
Traktor" reutiliza `ensureTraktorClosed`.

### Editor

- `cuesOpen` en `App.tsx` incluye la pestaña Traktor.
- Donde `CuesSection.tsx` y `cueAutoMark.ts` preguntan `isEngineContent` para decidir "sin
  frases: pedir `cueDropInput`", preguntan "Engine o Traktor".
- Textos propios (`TRAKTOR_COPY`), ver abajo.
- Colores: en una pista de Traktor el editor pinta todos los hot cues que vienen de Surco en el
  azul del tipo 0, y los existentes con el color de su tipo, porque es lo que se verá en
  Traktor. El selector de color de un cue no se ofrece para Traktor.
- Un (i) en el encabezado de Cues, solo con pista de Traktor: "Traktor pinta cada cue según su
  tipo; Surco los guarda como cues normales (azul) y deja el botón 1 para su AutoGrid."

### Textos (5 idiomas)

Gemelos de `editor.cues.engine.*` y `engineQueue.*`: guardar en Traktor, sin analizar ("Analiza
la pista en Traktor primero"), ilegible, cola caducada, fallo al guardar, otra colección, sin
ruta confirmada ("Elige tu collection.nml en Ajustes → Salida → Traktor para que Surco pueda
guardar"), el aviso de la letra H descartada y el (i). Sin guion largo ni dos puntos
explicativos.

## Verificación

- Tests de lectura y escritura sobre el `ENTRY` real de djotas (el pegado el 26/10) y sobre
  `fixtures/traktor-pro-4-collection.nml`: lo que no se toca sale byte a byte igual.
- Ida y vuelta: leer, guardar el mismo juego, el NML no cambia.
- Prueba real con djotas antes de mergear: Auto mark en 3 pistas, cerrar y abrir Traktor, los
  cues están en sus botones 2..8 en azul y su AutoGrid sigue en el 1.

## Lo que queda a criterio de quien lo construya

- Repartir el código entre módulos nuevos y los existentes.
- Cómo pinta la onda general (`read.wave`) si `null` queda pobre: puede derivarse de las mismas
  palabras de audio.
- Nombres exactos de claves i18n y de códigos de aviso.
