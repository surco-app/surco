# Bibliotecas DJ como fuente: navegar y organizar playlists

Estado: **diseño aprobado en conversación (15/10)**, pendiente de revisar esta spec.
Boceto en https://claude.ai/artifact/C97L9QfRLUiKKUBvfWAvvu (variante A elegida).

## El caso

Hay DJs que no usan Apple Music: su biblioteca de verdad es rekordbox, Engine DJ o Traktor.
Hoy Surco solo sabe abrir playlists de Music (`ApplePlaylistModal`), así que esos usuarios no
tienen forma de traer "la playlist del bolo" para arreglarle carátulas, datos o formato. En
Windows, donde Music no existe, no hay ningún origen de playlists.

Lo que Vicent quiere:

1. Ver las playlists del programa DJ en Surco, con su árbol de carpetas, como en el panel de
   rekordbox, y trabajar sus pistas con todo Surco.
2. Organizar desde Surco: crear playlists, añadir y mover pistas entre ellas, meter separadores.
3. Que todo quede sincronizado: la biblioteca del programa DJ es la única verdad.

## Fases

Cada fase es su propio plan; esta spec cubre la 1 y la 2.

| Fase | Qué | Riesgo |
|---|---|---|
| 1 | Navegar rekordbox (solo lectura), variante A del boceto | bajo |
| 2 | Organizar en rekordbox: crear playlists, añadir/mover/quitar pistas, separadores, rating | medio: inserta filas |
| 3 | Engine DJ y Traktor con el mismo contrato | spec propia |
| aparte | Exportar a USB para CDJ (export.pdb + ANLZ + exportLibrary.db) | spike de viabilidad antes de nada |

Apple Music entra en el carril desde la fase 1 con su lector de hoy, sin cambiar su AppleScript.

## Medido en su colección (copia de master.db, solo lectura, 15/10)

- 2067 pistas reales; 81 playlists, 13 carpetas (`Attribute` 1), **0 inteligentes**.
- 1 fila `Attribute` −128, "Trial playlist - Cloud Library Sync", vacía. Se excluye.
- Carpetas anidadas con nombres repetidos: "Todas", "Top", "Fijas" bajo CANTADITAS › 90s,
  CANTADITAS › 2Ks, BASES › 90s… Solo la ruta de carpetas completa las distingue.
- **Separadores**: un único fichero,
  `~/Music/PioneerDJ/Imported from Device/Contents/UnknownArtist/Blank Audio/_.mp3`
  (`Length` 1, título " "), enlazado **345 veces**. En COMBOS › Factory son 28 de 104 filas.
- 9430 enlaces pista-playlist, ninguno de streaming.
- `djmdSongPlaylist.TrackNo` es 1..N contiguo (Factory: 1..104, 104 distintos).
- Datos por pista: BPM 2060, tono 2067, género 2066, sello 452, comentario 262,
  **rating 140 (todas a 5)**, color 0, My Tags 0, cues 26294.

Las playlists con engranaje de su captura de rekordbox son el nodo iTunes de rekordbox (lee
las de Music), no playlists propias.

## Qué se ve (variante A)

- **Carril de fuentes** a la izquierda, 60 px: Pistas (la lista de trabajo de hoy), Music
  (solo macOS), rekordbox, Engine, Traktor. Solo aparecen las fuentes detectadas en el equipo,
  igual que hoy el destino Music no existe fuera de macOS. En fase 1, Engine y Traktor no
  aparecen todavía.
- **Árbol** de la fuente elegida, 236 px: carpetas desplegables, playlists con su número de
  pistas reales (sin separadores), buscador de playlists.
- **La lista ES la playlist**: al elegir una, la barra lateral enseña sus pistas en el orden
  de la playlist, con cabecera "rekordbox › COMBOS" + "Factory · 76 pistas · 28
  separadores". Los separadores se pintan como una línea discontinua "separador", no como
  fila: no se seleccionan, no se convierten, no pasan por el emparejamiento automático.
- "Pistas" en el carril vuelve a la lista de trabajo de siempre (arrastrar ficheros,
  importar de Music como hoy). Cambiar de fuente o de playlist no pierde ediciones sin
  guardar: el estado de cada pista vive en la misma colección de Surco que hoy, indexado por
  ruta, y la vista solo filtra y ordena. Es la pieza de la fase 1 que más toca código existente
  (`useTrackLibrary`): el plan empieza comprobando que encaja.

## Arquitectura

### Contrato común (`shared/types.ts`)

```ts
type PlaylistSource = 'appleMusic' | 'rekordbox' | 'engine' | 'traktor'

interface SourceNode {           // carpeta o playlist
  id: string
  name: string
  kind: 'folder' | 'playlist'
  count: number                  // pistas reales, sin separadores
  children?: SourceNode[]
}

interface SourcePlaylistEntry {  // una fila de la playlist, en su orden
  path: string | null            // null = sin fichero (streaming)
  separator: boolean
  meta: SourceTrackMeta          // lo que la fuente sabe y el fichero quizá no
}
```

`SourceTrackMeta` generaliza `AppleMusicTrackMeta` (grouping, year, comment, bpm, rating…)
y añade `key`. Music sigue llenando `persistentIds` por su lado.

### Main

- IPC genéricos: `sources:list` (fuentes disponibles), `sources:tree(source)`,
  `sources:playlist(source, id)`.
- `rekordboxPlaylists.ts` (nuevo, fase 1): abre `master.db` en solo lectura con la receta de
  `rekordboxDb.ts`. Árbol desde `djmdPlaylist` (Attribute 0 playlist, 1 carpeta, el resto
  fuera; `rb_local_deleted = 0`; orden por `Seq` dentro de cada `ParentID`). Pistas desde
  `djmdSongPlaylist` ordenado por `TrackNo`, unido a `djmdContent` (+ artista, tono).
- **Separador** = pista con `Length <= 2` y título vacío o solo espacios. Regla por contenido,
  no por ruta: otro usuario tendrá su separador en otra carpeta.
- **Refresco**: vigilar `master.db` (mtime) y releer el árbol y la playlist abierta al
  cambiar, y al volver el foco a Surco. Nada se cachea más allá de la sesión.
- Apple Music: adaptador sobre `appleMusicPlaylists.ts` a la forma común. Music no tiene
  separadores; su árbol sale de la carpeta padre de hoy.

### Renderer

- `SourceRail` + `SourceTree` nuevos; `ApplePlaylistModal` se retira cuando Music vive en el
  carril (mismo flujo de importar, ahora navegando).
- La lista lee la playlist por la fuente y entra por `addPaths` como hoy hace
  `importApplePlaylist`, sembrando `pendingSeed` con lo que la fuente sabe. Ningún flujo de
  después (análisis, conversión, reapuntado, sync de datos) sabe de dónde vino la pista.

## Datos de rekordbox en Surco

Regla general, la de Music: **se ve y se escribe el fichero; rekordbox rellena los huecos
que el fichero deja y nunca pisa lo que el fichero tiene.**

| Dato | Se ve en Surco | Llega al fichero al convertir | Surco lo escribe en rekordbox |
|---|---|---|---|
| Título, artista, álbum, género, sello, comentario, año, nº | sí | sí (como hoy) | sí, sync de datos que ya existe |
| BPM, tono | sí, rellenando huecos | sí | **nunca** (análisis, rejilla y cues) |
| Rating | sí | sí (POPM, como hoy) | **sí, fase 2**, por la cola |
| Cues, color, My Tags | no | no | nunca |

Rating: rekordbox guarda 0..5 en `djmdContent.Rating`, Surco "1".."5" o vacío. Mapeo directo.
Decisión de Vicent: en los dos sentidos.

## Fase 2: organizar

### Operaciones

1. Crear playlist (en la raíz o dentro de una carpeta) y crear carpeta.
2. Añadir pistas a una playlist: arrastrando desde la lista a un nodo del árbol. Una pista
   cargada en Surco que no está en la colección de rekordbox **no se añade en esta fase**: el
   aviso lo dice. Darla de alta en `djmdContent` es otra operación (con análisis pendiente
   en rekordbox) y queda fuera.
3. Mover pistas: dentro de la playlist (reordenar) y de una a otra (mover = añadir + quitar).
4. Quitar pistas de una playlist. Nunca borra la pista de la colección ni el fichero.
5. Insertar separador: añade el separador de la colección en la posición elegida. Si la
   colección no tiene ninguno, Surco genera uno (MP3 de 1 s de silencio, título " ") en
   la carpeta de datos de Surco y lo da de alta una vez. **No 0 s**: rekordbox y los CDJ
   necesitan un fichero que analizar y cargar.
6. Cambiar rating.

7. Borrar playlists y carpetas (pedido por Vicent el 15/10), siempre con confirmación. El
   diálogo nombra lo que se borra y, en una carpeta, cuántas playlists y carpetas lleva
   dentro. Borra las filas de `djmdPlaylist` y sus enlaces de `djmdSongPlaylist`; nunca
   una pista de `djmdContent` ni un fichero. Es la operación que más pierde si sale mal:
   pasa por la misma cola, la misma copia de seguridad y la misma transacción que el resto.

### Escritura en `master.db`

- Filas nuevas como las crea rekordbox, el molde ya está en `rekordboxMetadata.ts`: ID
  libre, UUID v4, `rb_local_usn` = contador de `agentRegistry` + 1 (y subirlo),
  `created_at`/`updated_at`, `rb_local_synced` 0.
- `djmdSongPlaylist`: tras cada cambio, `TrackNo` vuelve a ser 1..N contiguo en la playlist
  tocada (como la medida en su colección).
- `djmdPlaylist`: `Seq` al final del padre.
- `masterPlaylists6.xml` (junto a `master.db`, 123 nodos en su colección, rekordbox 7.2.19):
  rekordbox lleva ahí también cada playlist y carpeta (`NODE Id` en hexadecimal del ID,
  `ParentId`, `Attribute`, `Timestamp`). Crear y borrar playlists o carpetas añade o quita
  su nodo, como hace pyrekordbox; con copia propia y dentro del mismo lote. El plan
  empieza por verificar sobre una copia qué pasa en rekordbox si la base y el XML no
  cuadran, y si mover pistas o renombrar también lo tocan.
- Todo un lote de la cola en **una transacción**; si algo falla, se restaura la copia.
- Mismas garantías que el reapuntado: sin copia no se escribe (`.surco-session` por tanda y
  copia por escritura), nunca con rekordbox abierto, nunca se borra una fila de
  `djmdContent`.

### La cola de pendientes

- Cada operación se ve al instante en Surco, marcada como **pendiente** en el árbol y en la
  fila.
- Si rekordbox está cerrado, se aplica enseguida.
- Si está abierto, sale **el diálogo de hoy** ("rekordbox está abierto", Cerrar rekordbox /
  Cancelar, `ensureRekordboxClosed`), una vez por tanda, nunca uno por pista:
  - Cerrar rekordbox: lo cierra, copia y aplica todo.
  - Cancelar: **la cola se conserva**. Se aplica sola cuando Surco detecta rekordbox cerrado,
    o con "Aplicar ahora".
- La cola persiste en disco (sobrevive a cerrar Surco) junto a sus datos, no en settings.
- **Conflicto**: si al aplicar, la playlist cambió en rekordbox desde que se encoló la
  operación (su `updated_at` es posterior), **gana rekordbox**: esa operación se descarta y
  Surco avisa de cuál no se aplicó. Nunca se machaca en silencio. Por verificar en el plan:
  qué más mueve rekordbox ese `updated_at` (si lo toca al abrir la playlist, daría
  conflictos falsos).

Fuera de esta spec: que la misma cola recoja también el reapuntado al convertir (hoy se
pierde con Cancelar). Es la misma mejora y queda anotada para después.

## Errores

- Colección no encontrada o ilegible: la fuente no aparece en el carril; en Ajustes el campo
  de colección de hoy dice por qué.
- Playlist borrada en rekordbox mientras se mira: al refrescar, la vista vuelve a la carpeta
  padre con un aviso.
- Pista cuyo fichero no existe: fila con el aviso de fichero perdido de hoy, no se cuela en
  la conversión.
- Pista ambigua (dos filas para el mismo fichero, las 35 conocidas): se ve, se puede añadir a
  playlists (va por ContentID, no por ruta); el reapuntado sigue rechazándola como hoy.

## Pruebas

- Fixture cifrada propia, la de `rekordboxDb.test.ts`, ampliada con carpetas anidadas,
  nombres repetidos, separador, fila −128 y fila borrada.
- Lector: árbol, orden por `Seq`/`TrackNo`, exclusiones, separadores fuera del recuento.
- Escritura: cada operación con su test rojo primero; `TrackNo` contiguo tras mover;
  restauración cuando falla a medias (el seam DESPUÉS del UPDATE, como en `rekordboxLibrary.test.ts`); cola que sobrevive a Cancelar; conflicto que gana rekordbox.
- Mutación sobre las reglas que protegen datos (copia, guarda, contigüidad, conflicto).
- Verificación sobre **copia de su colección real** antes de dar cada fase por buena, y en
  fase 2 abrir la copia en rekordbox real para ver las playlists creadas.

## Fuera de alcance

Engine y Traktor (fase 3), exportar a USB, playlists inteligentes, dar de alta pistas nuevas
en la colección, color, My Tags, cues, escribir BPM o tono en
rekordbox.
