# Pestaña Traktor, fase 3: editar playlists

## Por qué

Las fases 1 y 2 (v1.11.3-beta.0) dejan ver las playlists de Traktor y marcar cues. Lo que falta
para que la pestaña Traktor sea "lo mismo que la de rekordbox" (palabras del usuario) es
organizar: crear, renombrar y borrar playlists y carpetas, meter pistas, reordenarlas,
quitarlas y poner separadores. El usuario pidió paridad completa: "hay que soportar todo igual".

## Objetivos

Todo lo que la pestaña rekordbox permite hoy, con el mismo gesto y el mismo resultado:

- Crear playlist o carpeta (botones del árbol, dentro de una carpeta o en la raíz).
- Renombrar y borrar (clic derecho en el árbol; borrar una carpeta borra lo que contiene, con la
  confirmación que ya cuenta lo que se va).
- Añadir pistas: soltar filas o ficheros de Finder sobre una playlist del árbol, o «Añadir a
  playlist» del menú contextual de una fila.
- Reordenar filas de la playlist abierta arrastrándolas (solo en su orden propio, sin búsqueda
  ni filtro, como rekordbox).
- Quitar filas de la playlist abierta (con la confirmación de varias filas que ya existe).
- Separadores: insertar, mover y quitar, copiando el separador que el DJ ya usa en Traktor.

## No objetivos

- Dar de alta pistas nuevas en la colección. Decidido por el usuario, igual que rekordbox: una
  pista que Traktor no tiene se salta y se avisa («N pistas no están en la colección de
  Traktor»).
- Smartlists: siguen fuera del árbol (fase 1) y no se crean ni se editan.
- Editar playlists en Engine DJ: hoy es de solo lectura; sería otra fase.
- Seleccionar la playlist recién creada: rekordbox tampoco lo hace (solo relee el árbol).

## Antiobjetivos

- Tocar la colección fuera de `<PLAYLISTS>`, salvo lo que la fase 2 ya escribe. Una edición de
  playlist no cambia ni un byte de `<COLLECTION>`.
- Escribir en una colección no confirmada: igual que los cues, solo en `settings.traktorNmlPath`.
- Aplicar una edición sobre una playlist que el DJ cambió en Traktor desde que Surco la leyó.
- Escribir con Traktor abierto (Traktor reescribe el NML entero al salir y la perdería).

## Lo que ya sabemos del NML

- `<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="n">…` y dentro, `NODE` de tipo
  `FOLDER` (con `SUBNODES COUNT`), `PLAYLIST` (con `<PLAYLIST ENTRIES="n" TYPE="LIST"
  UUID="…">` y una `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="VOLUME+DIR+FILE"/></ENTRY>` por fila)
  o `SMARTLIST`.
- La misma pista puede aparecer varias veces en una playlist (los separadores lo hacen siempre).
- Las playlists de fase 1 se identifican por `UUID`; las carpetas por su ruta de nombres
  (`folder:Djotas/Old`). Traktor admite dos carpetas hermanas con el mismo nombre: la segunda y
  siguientes llevan su ordinal en el id (`folder:Djotas#2/Old`) para que nunca choquen
  (decisión de quien escribe la spec).

## Diseño

### Identidad de filas y protección contra cambios

- Cada fila de una playlist lleva `linkId` = `"<uuid>:<n>"`, con n su posición (desde 0) en la
  lista de `ENTRY` de esa `PLAYLIST`. Así funcionan sin cambios `playlistScope`, el reordenar, el
  quitar y los separadores del renderer, que van por `linkId`.
- Un separador es una fila cuyo `ENTRY` de colección dura 2 s o menos (`PLAYTIME`) y no tiene
  título, la misma regla que rekordbox (`IS_SEPARATOR`). Esas filas salen con
  `separator: true`.
- Como el `linkId` es una posición, cada edición encolada lleva la huella del nodo al que
  apunta (`stamps`), igual que rekordbox lleva el timestamp del nodo. La huella de una playlist
  es un hash de su lista de claves en orden; la de una carpeta, un hash de los nombres y tipos de
  sus hijos. Si al aplicar no coincide, la edición se rechaza como `stale` con el aviso
  `edit-changed` que ya existe. `nodeStamps` de la cola de Traktor devuelve estas huellas, con
  lo que el refresco de huellas tras cada lote que ya hace la cola funciona igual.

### Varias ediciones en el mismo lote (decisión de quien escribe la spec)

Mientras Traktor está abierto el fichero no cambia, así que todo lo que el DJ hace en Surco en
ese tiempo se refiere a la colección tal como está en disco (el árbol y las filas que ve son
esas). Por eso el lote resuelve primero los ids de todas sus ops (filas por posición, carpetas
por ruta, playlists por UUID) contra el NML leído al empezar, y solo después aplica, sobre esos
nodos y filas ya resueltos. Un «mover» y un «quitar» encolados sobre la misma playlist tocan las
filas que el DJ vio. Las huellas se comprueban contra ese mismo NML leído.

La cola de Traktor no refresca huellas tras un lote: si quedara pendiente una op sobre una
playlist que el lote cambió, sus posiciones ya no valen y debe salir `stale`, no aplicarse.

### Playlists propias de Traktor (decisión de quien escribe la spec)

`Preparation`, `HISTORY`, `_LOOPS` y `_RECORDINGS` en la raíz son de Traktor: no se renombran
ni se borran (el árbol no lo ofrece y la op sale `stale`). `HISTORY` no se edita de ningún
modo, es un registro. En las otras tres sí se añaden, mueven y quitan pistas.

### Una sola cola para Traktor

Las ediciones de playlist van a la cola que ya usan los cues de Traktor (mismo fichero, misma
pastilla «espera a que cierres Traktor», mismo aplicar al cerrar). El escritor de lotes de
Traktor pasa a aplicar ops `edit` y ops `cues` en un solo lote, ordenadas por `opRank` como
rekordbox (crear, añadir/mover/quitar/separador, renombrar, cues, borrar), sobre el mismo texto
en memoria, y escribe una vez con `writeCollection` (copia `.surco-backup`, segunda comprobación
de Traktor abierto, escribir y renombrar). Una op rechazada no impide las demás.

### Operaciones (texto del NML, como `traktorNml.ts`)

- **create** `{parentId, name, folder}`: inserta un `NODE` al final de los hijos del padre
  (`root` = `$ROOT`), sube su `SUBNODES COUNT`. Playlist nueva: `PLAYLIST ENTRIES="0"
  TYPE="LIST"` con un `UUID` nuevo de 32 hexadecimales en minúscula. Nombre escapado. Nombre
  vacío: `stale`, como rekordbox.
- **rename** `{playlistId, name}`: cambia el `NAME` del `NODE` (playlist o carpeta).
- **delete** `{playlistId}`: quita el `NODE` entero (con todo lo que contenga) y baja el
  `SUBNODES COUNT` del padre.
- **add** `{playlistId, tracks}`: cada pista se resuelve por su `contentId` (clave de Traktor)
  o, si no lo tiene, por sus rutas contra las `LOCATION` de la colección (misma conversión de
  ruta y volumen que la fase 1, comparando en NFC). Dos `ENTRY` con esa ruta: `ambiguous`. Sin
  ninguna: `notInCollection`. Las que ya están en la playlist: `already`. Se añaden al final,
  en el orden dado, y se actualiza `ENTRIES`. El informe es el mismo `PlaylistAddReport`.
- **move** `{playlistId, linkIds, beforeLinkId}`: reordena las `ENTRY`; un movimiento que no
  cambia el orden no escribe.
- **remove** `{playlistId, linkIds}`: quita esas `ENTRY` y actualiza `ENTRIES`. Como en
  rekordbox, quitar una pista quita todas sus filas en la playlist y quitar un separador solo
  esa fila (eso lo decide ya el renderer con `linksOf`).
- **insertSeparator** `{playlistId, beforeLinkId}`: inserta antes de esa fila un `ENTRY` con la
  clave del separador del DJ: entre las pistas que cumplen la regla de separador, la que más
  aparece en playlists. Sin ninguna: `no-separator`.
- Toda op sobre un `playlistId`/`linkId` que ya no existe: `stale`. Sobre una smartlist:
  `stale`.

### IPC y renderer

- `traktor:edit` (edición, nombre de la playlist) → `RekordboxEditResult`, con el mismo flujo
  que `rekordbox:edit`: encolar con huellas, aplicar si Traktor está cerrado, si está abierto
  dejarla esperando y avisar al watcher, y anunciar lo que se aplicó en el mismo lote.
  `traktor:hasSeparator` → si la colección tiene separador.
- Sin colección confirmada, el árbol no ofrece editar (sin botones +, sin menú, sin soltar), y
  lo explica una vez el mismo texto de la fase 2.
- En `App.tsx`, `useSourceBrowser.ts`, `useRekordboxEdits.ts`, `TrackContextMenu.tsx`,
  `TrackList.tsx` y `SourceTree.tsx`, todo lo que hoy pregunta `source === 'rekordbox'` para
  editar pasa a preguntar «fuente editable» (rekordbox o Traktor) y llama a la API de esa
  fuente. La clave de consulta fija `['source-playlist','rekordbox',id]` pasa a usar la fuente.
- Textos: los de `sources.edit.*` que nombran rekordbox tienen gemelo Traktor (5 idiomas), y el
  diálogo de cerrar Traktor tiene su texto para playlists (como `rekordboxQuitDetailPlaylists`).

## Verificación

- Tests de cada operación sobre NML con carpetas anidadas, separadores, filas repetidas,
  nombres con `&` y comillas, y las dos colecciones reales de `fixtures/`: fuera de
  `<PLAYLISTS>` nada cambia; el NML resultante es XML válido; releer da lo esperado.
- Lote mixto cues + edición: se aplican los dos en una escritura.
- Prueba en la app con el driver y una colección sintética (como en la fase 2): crear carpeta y
  playlist, soltar 3 pistas (una fuera de la colección: aviso), reordenar, separador, renombrar,
  borrar. Diff del NML antes y después.

## Lo que queda a criterio de quien lo construya

- Nombres de módulos y funciones.
- El hash concreto de las huellas (estable entre lecturas del mismo texto).
- Si `editProblem`/precomprobación de rekordbox tiene un gemelo útil para Traktor.
