# Escribir playlists en rekordbox: lo medido

Medido el 15/10 sobre una copia de la colección de Vicent (rekordbox 7.2.19, `master.db` + `-wal` + `masterPlaylists6.xml`, solo lectura) y sobre el código de pyrekordbox 0.5.0 (`masterdb/database.py`, `masterdb/aux_files.py`, del paquete de PyPI). Es la base de la fase 2a (`docs/superpowers/plans/2026-10-15-fuentes-dj-fase-2a.md`).

## master.db

- Modo WAL (`journal_mode = wal`). Con rekordbox abierto el `-wal` pesa megas (4.136.512 bytes al copiar): copiar solo `master.db` deja fuera cambios ya confirmados. Antes de copiar, Surco hace `wal_checkpoint(TRUNCATE)`.
- `djmdSongPlaylist.ID` es un UUID de 36 caracteres en los 9435 enlaces (no un número). `UUID` es otro UUID.
- 0 enlaces con `rb_local_deleted = 1`: rekordbox, con la nube apagada, borra los enlaces de verdad. Surco también.
- `TrackNo` es 1..N contiguo en todas las playlists.
- Al reordenar, rekordbox da a todas las filas movidas el mismo `rb_local_usn` y el mismo `updated_at` (Factory: 103 filas con usn 565542 y una con 565543; 74 playlists tienen enlaces que comparten usn). pyrekordbox hace lo mismo ("move" = un usn para la lista).
- Añadir, quitar o reordenar pistas NO toca `djmdPlaylist.updated_at` (Factory: playlist del 07/09, enlaces del 02/10; 37 playlists más viejas que sus enlaces). Por eso esas operaciones no necesitan el XML.
- `djmdPlaylist.ID` es decimal; la raíz es `ParentID = 'root'`. `Seq` va 1..n sin repetir entre las filas vivas de cada padre, contando las −128 vivas ("Acapellas" es la 11 de la raíz); la −128 borrada (100000) conserva un `Seq` 2 repetido. Una playlist nueva va con `max(Seq) + 1` de sus hermanos vivos (pyrekordbox usa `n + 1`, que coincide mientras no haya huecos).
- `agentRegistry.localUpdateCount.int_1` = 566799: cada fila nueva toma el siguiente.
- Recuentos de control que una edición de playlist no debe cambiar: `djmdContent` 2072, `djmdCue` 26294.

## masterPlaylists6.xml

- 123 `NODE`, CRLF, 4 espacios de sangría, `Lib_Type="0"` para los 97 de playlists y carpetas propias, `Lib_Type="1"` para los 26 nodos del árbol de iTunes (`Attribute` 1 y 4, `Timestamp` 0, Id de 64 bits).
- `Id` = ID en hexadecimal en mayúsculas sin ceros delante (`30D40` = 200000). Raíz: `ParentId="0"`.
- Los nodos nuevos se añaden AL FINAL de `<PLAYLISTS>`, sea cual sea su carpeta (el último nodo, `BA4DDFDB`, es la playlist más reciente, de otra carpeta que el resto de su grupo). Ninguna fila viva carece de nodo.
- La fila −128 borrada (100000) no tiene nodo: borrar quita el nodo.
- `Timestamp` no coincide con `updated_at` (diferencias de 100 ms a días). pyrekordbox lo iguala al confirmar solo si difiere más de 1 s.
- 2 nodos `Lib_Type="0"` sin fila en la copia (9695456E, 5CB3A8B). O la copia era anterior a ellos, o rekordbox tolera nodos sobrantes (pregunta Q2).

## pyrekordbox (cómo lo hace quien ya escribe)

- Crear (`_create_playlist`): ID aleatorio de 28 bits ≥ 100 no usado (`generate_unused_id`, solo mira la tabla, no el XML), `Seq` al final, nodo XML añadido con `Timestamp` = ahora en ms (`MasterPlaylistXml.add`: `Id` en hex, `ParentId` "0" en la raíz, `SubElement` al final), `Lib_Type` 0, `CheckType` 0.
- Añadir a playlist: `ID` y `UUID` con `uuid4()`, `TrackNo` al final.
- Quitar: borra la fila y renumera.
- Ninguna de las tres de pistas toca el XML.

## Preguntas abiertas (solo se contestan con rekordbox de verdad, lista de la tarea 11)

- Q1. ¿rekordbox enseña una playlist o carpeta creada así, en su carpeta y al final, y sigue ahí tras reiniciar?
- Q2. Si la base y el XML no cuadran (falta un nodo, sobra uno), ¿qué hace rekordbox al abrir?
- Q3. Con rekordbox cerrado, ¿queda `master.db-wal` con datos? (medido al copiar, con rekordbox ABIERTO: `master.db-wal` de 4.136.512 bytes; el caso cerrado no se ha medido)
- Q4. ¿Acepta rekordbox los enlaces borrados de verdad (sin `rb_local_deleted`)? La medida dice que sí.
- Q5. Durante el arrastre nativo de una fila (webContents.startDrag), ¿recibe la propia ventana de Surco los eventos de arrastre sobre el árbol? El árbol ya no depende de que lleguen ficheros (lee las filas que la lista apuntó al empezar), pero sí de que lleguen esos eventos.
- Q6. ¿Los 2 nodos sobrantes son restos que rekordbox tolera? Se repite la medida con una copia tomada con rekordbox cerrado.
