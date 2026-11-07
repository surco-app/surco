# Árbol de playlists: respuesta inmediata y arrastre de carpetas y playlists

## Por qué

Al crear una playlist o carpeta en el árbol de rekordbox, Traktor o Serato, el campo de
nombre desaparece al pulsar Enter, pasan unos cientos de milisegundos y la fila aparece con
la relectura del árbol entero. El usuario lo describe como «se crea, desaparece y vuelve a
salir». Lo mismo ocurre al renombrar y al borrar. Hoy el único gesto que se pinta antes de
que la escritura termine es mover pistas dentro de una playlist (`useRekordboxEdits`, kind
`move`). Pide que «todo en Surco sea optimistic update».

Además pide reordenar las carpetas y playlists del árbol arrastrándolas, «como rekordbox»:
cambiar el orden entre hermanas y meter o sacar de carpetas con el mismo gesto. Un solo
elemento por arrastre (07/11/2026).

## Objetivos

1. Crear, renombrar, borrar y mover un nodo del árbol se dibujan en el mismo gesto, antes de
   que el programa escriba. La relectura de después sustituye lo dibujado; si la escritura
   fue rechazada, la relectura devuelve el árbol real y el aviso ya existente lo explica.
2. Arrastrar una playlist o carpeta del árbol y soltarla entre dos hermanas, al principio o
   al final de cualquier nivel, o encima de una carpeta para meterla dentro. Una carpeta se
   lleva su contenido.
3. Funciona en los tres programas donde ya se puede crear: rekordbox, Traktor y Serato. En
   Serato solo cambia el padre (ver Restricciones).

## No objetivos

- Selección múltiple de nodos en el árbol. Un solo elemento por arrastre.
- Atajo de teclado para mover nodos.
- Abrir una carpeta cerrada manteniendo el arrastre encima (spring-loading). Para soltar
  dentro de una carpeta anidada, el usuario la abre antes. Soltar «dentro» de una carpeta
  cerrada sí funciona: queda la última y la carpeta se abre al soltar.
- Guardar el orden de los crates de Serato (`neworder.pref`). Queda como trabajo aparte.
- Arrastrar nodos entre programas, o del árbol a la lista de pistas.
- Apple Music: el árbol sigue siendo de solo lectura.
- Seleccionar automáticamente la playlist recién creada (rekordbox tampoco lo hace).
- Mantener dibujado un cambio mientras espera en la cola con el programa abierto. En ese
  caso el IPC devuelve `cancelled` o `rekordbox-running`, el árbol vuelve a lo real con la
  relectura y la píldora de la cola es lo que cuenta el cambio pendiente, como hoy. El
  usuario confirma (07/11) que el parpadeo que reporta ocurre con el programa cerrado.

## Restricciones

- Las escrituras pasan por el mismo camino que hoy: `RekordboxPlaylistEdit` → IPC →
  cola (`rekordboxQueue`) → escritor del programa. Se añade un kind nuevo, no un camino
  nuevo.
- Serato ordena sus crates por nombre al leerlos (`seratoDatabase.crateTree` →
  `sortNodes`) porque Surco no lee `neworder.pref`. Mover entre crates es renombrar el
  fichero `.crate` con otro prefijo `padre%%nombre`; el orden entre hermanos no se guarda y
  no se promete en la interfaz.
- Las carpetas de Traktor se identifican por su ruta (`folder:A/B`, con `#2` si hay dos
  hermanas con el mismo nombre). Mover o renombrar una carpeta le cambia el id a ella y a
  sus carpetas hijas; las playlists conservan su UUID. Hoy renombrar una carpeta de Traktor
  ya la deja cerrada tras la relectura (el conjunto `opened` guarda el id viejo); mover
  hará lo mismo. Se acepta.
- Arrastre nativo HTML5 (`draggable`, `dataTransfer`), como el reorden de pistas de
  `TrackList`. Sin librerías nuevas.
- Cero comentarios de código nuevos (regla global). Las explicaciones van en este documento
  y en los tests.

## Diseño

### 1. El edit nuevo: `moveNode`

```ts
| { kind: 'moveNode'; playlistId: string; parentId: string; beforeId: string | null }
```

`playlistId` es el nodo que se mueve (playlist o carpeta; en Serato, crate). `parentId` es
la carpeta de destino, `'root'` para el primer nivel. `beforeId` es la hermana delante de
la que se coloca, o `null` para quedar la última del padre. Mismo vocabulario que `move`
de pistas (`beforeLinkId null` = al final).

Rechazos (todos `stale`, salvo donde se indica), comprobados antes de escribir en cada
programa, igual que `editProblem` en rekordbox:

- el nodo no existe o no es playlist ni carpeta (smartlist, Recientes, Todas);
- el padre no es `'root'` ni una carpeta (en Serato, cualquier crate vale de padre);
- el padre es el propio nodo o está dentro de él;
- `beforeId` no es hija viva del padre de destino;
- Traktor: el nodo es uno de los fijos de la raíz (`TRAKTOR_BUILT_IN`). Soltar delante o
  detrás de uno fijo sí se permite: son nodos corrientes del `SUBNODES` de la raíz y
  Traktor los reordena igual desde su propio árbol;
- Serato: ya hay un crate con ese nombre en el destino (`bad-name`, como en rename).

Mover un nodo a su posición actual no es un error: escribe sin cambios y se aplica.

#### rekordbox (`rekordboxPlaylistEdit.ts`)

`moveNode(db, id, parentId, beforeId, ctx)`, hermana de `createNode`, `renameNode` y
`deleteNode`. Saca el nodo de sus hermanas actuales (las posteriores bajan un `Seq`, como
hace `deleteNode`), lo inserta en el padre de destino en el `Seq` de `beforeId` (las que
estaban ahí y después suben uno) o al final, y actualiza `ParentID`, `Seq`, `rb_local_usn`
y `updated_at`. Cuando el padre no cambia, es solo la renumeración.

El espejo XML (`rekordboxMasterXml.ts`) guarda `ParentId` por nodo: al cambiar de padre se
quita la línea del nodo (`withoutNodes`) y se vuelve a poner con el padre nuevo
(`withPlaylistNode`), con `Timestamp` nuevo. Si el padre no cambia, el XML no se toca (no
guarda orden).

`editProblem` gana la rama de `moveNode` con los rechazos de arriba. `editStamps` lo trata
como `rename` (sello del nodo). `EDIT_RANK.moveNode = 3`, el de `rename`: después de los
`create` y de los edits de pistas, antes de los `delete`.

#### Traktor (`traktorPlaylistEdit.ts`)

En `apply`, antes de la rama `if (!playlist)`: resuelve el padre con `nodeById`, rechaza
según la lista de arriba, quita el nodo de `node.parent.children`, lo inserta en
`parent.children` antes de la hija cuyo `id` es `beforeId` (o al final), actualiza
`node.parent` y marca `dirty` los dos padres. `serializePlaylists` ya reescribe `COUNT` de
los `SUBNODES` sucios. Los sellos (`traktorPlaylistEditIpc`) salen por la rama por
defecto: `traktorStamps(...)[edit.playlistId]`, que ya existe.

#### Serato (`seratoCrateEdits.ts`)

Igual que `rename` pero el id nuevo es `crateIdOf(parentId, nombreActual)`: se renombra la
familia entera (`crateFamily`) en cada raíz. `beforeId` se ignora. Comprobar el nombre
tomado con la misma regla que `rename`. `seratoPlaylistEditIpc` ya pide `files` para
`create` y `rename`; `moveNode` entra en esa lista.

#### Lo que ve el usuario del kind

- Píldora de la cola: `rekordboxQueue.part.tree.moveNode` en los seis idiomas (de, en, es,
  fr, ja, pt-BR). `keys.test.ts` solo compara es/en: el constructor añade los seis a mano.
- `editMessage` no dice nada para `moveNode` (como rename y delete): el árbol muestra el
  resultado.

### 2. El árbol responde al instante

En `lib/playlistEdits.ts`, una función pura:

```ts
editedTree(nodes: SourceNode[], edit: RekordboxPlaylistEdit): SourceNode[] | null
```

Devuelve el árbol tal como se leerá cuando el edit esté escrito, o `null` cuando el edit
no toca el árbol (`add`, `move`, `remove`, `insertSeparator`) o no encuentra lo que nombra:

- `create`: el nodo nuevo al final de los hijos del padre, `count: 0`, `children: []` si
  es carpeta, con id provisional `pending:<aleatorio>` (constante `PENDING_NODE` exportada
  junto a la función). En rekordbox y Traktor un nodo nuevo va el último (así lo escriben
  `createNode` y `newNode`); en Serato irá por nombre tras la relectura, un salto que se
  acepta.
- `rename`: el nombre nuevo en el nodo.
- `delete`: el nodo y su subárbol fuera.
- `moveNode`: el nodo (con su subárbol) fuera de donde está y dentro del padre nuevo,
  delante de `beforeId` o al final. Para Serato (`crates`), la función recibe un flag y
  coloca el nodo en el padre por orden alfabético de nombre, no por `beforeId`.

`useRekordboxEdits` aplica `editedTree` con `queryClient.setQueryData(['source-tree',
source])` antes de `await save`, tras `cancelQueries` de esa clave, exactamente como hace
hoy con `move` y `['source-playlist', …]`. Recientes y Todas no están en esa caché
(`useSourceBrowser.shownTree` los antepone), así que la función no los ve. Después del
`save`, las invalidaciones de hoy siguen igual; la relectura trae los ids reales.

Un nodo `pending:` es inerte en `SourceTree`: no se selecciona, no abre menú, no recibe
pistas ni nodos, no se arrastra. Vive unos cientos de milisegundos, hasta la relectura.

Al entrar en el flujo, el campo de nombre al pulsar Enter se convierte en la fila nueva sin
hueco. Si el programa rechaza el edit, la relectura la quita y sale el aviso que ya existe
(`sources.edit.refused.*`).

**Borrar o mover la playlist abierta.** `useSourceBrowser` vigila `shownTree` y, cuando la
playlist seleccionada deja de estar, la deselecciona y avisa «ya no está en rekordbox»
(`sources.gone.*`). Ese aviso es para desapariciones ajenas. Cuando la desaparición la
provoca un edit propio (`delete` optimista, o `moveNode` en Serato, donde el id del crate
cambia a `padre%%nombre`), la deselección es silenciosa: el hook registra en la caché, junto
al árbol, el id que acaba de quitar él mismo, y `useSourceBrowser` no avisa por ese id. En
Serato, además, `App` vuelve a seleccionar el crate movido por su id nuevo
(`crateIdOf(parentId, node.name)`, conocido de antemano) cuando era el seleccionado. En
rekordbox y Traktor las playlists conservan su id al moverse y la selección no se toca.

### 3. Arrastrar en `SourceTree`

**Qué se puede arrastrar.** Una fila de playlist o carpeta, cuando hay `edit`, salvo
Recientes, Todas, los nodos fijos de Traktor (`fixed` da `locked` o `tracks-only`), los
`pending:` y la fila en renombrado. Durante una búsqueda (`hits`) nada se arrastra: la lista
plana no tiene orden. El arrastre lleva el tipo `application/x-surco-tree-node` con el id
del nodo (constante `TREE_NODE_TYPE` y predicado `isTreeNodeDrag` en `lib/reorderDrag.ts`,
al lado de `REORDER_TYPE`). `effectAllowed = 'move'`. La fila arrastrada se pinta al 50 %
de opacidad (`data-dragging`).

**Dónde se puede soltar** (rekordbox y Traktor):

- Sobre una fila de playlist: mitad superior → delante de ella; mitad inferior → detrás
  (delante de su siguiente hermana, o la última si no hay).
- Sobre una fila de carpeta: cuarto superior → delante; cuarto inferior → detrás; la mitad
  central → dentro, la última. Si la carpeta estaba cerrada, se abre al soltar.
- Sobre el espacio libre bajo la última fila: la última de la raíz.
- Nunca: sobre Recientes, Todas, el propio nodo, nada dentro de su subárbol, ni un nodo
  `pending:`. Soltar en la posición que ya ocupa no envía nada.

En Serato (`edit.crates`): cualquier crate es «dentro» en toda su altura, y el espacio
libre bajo la última fila es la raíz. No hay líneas de inserción, porque el orden no se
guarda.

**Qué se ve mientras se arrastra.** Una línea de inserción de 2 px en color acento
(`data-testid="source-tree-drop-line"`), igual que `reorder-line` de `TrackList`, entre las
filas, sangrada a la profundidad del padre de destino (`paddingLeft = 10 + depth * 18`,
como las filas). Para «dentro», el contorno discontinuo que ya usa la fila cuando recibe
pistas (`data-drop-target`), sin el contador `+N`.

**Al soltar.** `edit.onMove(node, parentId, beforeId)`, prop nueva de `edit` en
`SourceTree`; `App` la cablea a `editRekordbox({ kind: 'moveNode', playlistId: node.id,
parentId, beforeId }, node.name)`. El árbol se pinta movido en el acto (parte 2).

**La ventana y la lista.** `App` ya ignora para el overlay de importación las arrastradas
de reorden (`isReorderDrag`) y las filas sacadas de la lista (`draggedRows`); gana
`isTreeNodeDrag` en los mismos tres sitios (`onDragEnterCapture`, `onDragLeaveCapture`,
`onDrop`). `TrackList` lee `getData(REORDER_TYPE)` solo tras `isReorderDrag`; un arrastre
de nodo no es `isReorderDrag`, así que no se confunde con un separador. El `onDrop` del
contenedor del árbol que hoy traga las soltadas que no caen en una playlist sigue
tragándolas.

### 4. Tests que fijan el comportamiento

- `playlistEdits.test.ts`: `editedTree` para los cuatro kinds, el `null` para los otros,
  mover a un descendiente devuelve `null`, el flag de Serato ordena por nombre.
- `useRekordboxEdits.test.ts`: el árbol en caché cambia antes de que `save` resuelva, y la
  invalidación llega después, para `create`, `rename`, `delete` y `moveNode`.
- `SourceTree.test.tsx`: qué filas son `draggable`; la línea de inserción aparece en la
  mitad correcta de la fila; «dentro» abre la carpeta al soltar; no se puede soltar en el
  propio subárbol; soltar en el sitio actual no llama a `onMove`; nada se arrastra durante
  una búsqueda; un nodo `pending:` ni se arrastra ni recibe; en `crates` no hay línea.
- `rekordboxPlaylistEdit.test.ts`: `moveNode` renumera `Seq` en origen y destino, cambia
  `ParentID`, rechaza padre dentro del subárbol y `beforeId` ajeno; `editProblem` lo
  rechaza antes de cerrar rekordbox. `rekordboxPlaylistWrite.test.ts`: el XML refleja el
  padre nuevo.
- `traktorPlaylistEdit.test.ts`: el NML sale con el nodo bajo el padre nuevo en la posición
  pedida y `COUNT` correcto en los dos padres; rechazos de fijos y de subárbol.
- `seratoCrateEdits.test.ts`: la familia se renombra con el prefijo nuevo; nombre tomado da
  `bad-name`.
- Los seis locales tienen `rekordboxQueue.part.tree.moveNode` (`keys.test.ts` cubre es/en;
  el constructor comprueba los otros cuatro con el test de claves huérfanas o a mano).

## Lo que queda al constructor

- Nombres de las funciones nuevas en main, mientras sigan la pauta `createNode` /
  `renameNode` / `deleteNode`.
- Cómo se calcula la mitad o el cuarto de la fila (`getBoundingClientRect` en `dragOver`).
- Si la zona de «espacio libre bajo la última fila» es el `ul` con padding o un `li`
  vacío final; lo que importa es que exista y tenga `data-testid`.
- Orden de los commits. Sugerido: tipo + escritores (uno por programa) → `editedTree` y
  el hook → arrastre en `SourceTree` → cableado en `App` y locales.
- Verificación en la app real con el driver (`run-desktop`) contra una colección de
  prueba, con rekordbox cerrado. El arrastre nativo no se puede simular desde el driver:
  esa parte se prueba a mano y se dice.
