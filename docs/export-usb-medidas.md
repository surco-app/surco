# Exportación a USB, lo medido

Medido el 18/10/2026 con rekordbox 7.2.19 cerrado al copiar `master.db` (la copia vivió en el scratchpad y está borrada). Las notas del spike son del 16/10 y del 18/10. Este fichero guarda en el repo lo que el código de la exportación da por cierto, para no depender del scratchpad.

## 1. Veredicto de la fase 2 del spike

Referencia exportada por Vicent con rekordbox 7.2.19 (playlist BASES/Makina, 7 pistas) al USB de pruebas `Surco` (exFAT, UUID B10C96EF-51C2-344E-B78D-DAFC319D973E).

El USB que escribe baken es estructuralmente igual al de rekordbox. Pistas, playlists, artistas, álbumes, géneros, claves, colores, columnas y menú coinciden fila a fila salvo por IDs internos. Las ondas y la rejilla son idénticas byte a byte. Las carpetas USBANLZ salen en el mismo sitio (`Contents/<Artista>/<Álbum>/<fichero>`, con `/` cambiado por `_`). El audio copiado es idéntico (md5) al de rekordbox y al del NAS.

Un hot cue D salía como E por restar uno al Kind del prototipo. El mapa correcto de `djmdCue.Kind` es A=1, B=2, C=3, D=5, E=6, F=7 (el 4 no se usa), así que de Kind 5 en adelante se resta 2.

### Diferencias que quedan y qué hace el plan con ellas

| Qué | rekordbox | baken sin parchear | Qué hace el plan |
|---|---|---|---|
| Color de hot cue sin color asignado | código 0 y el RGB por defecto de su letra | no admite código 0 con RGB propio y lo aproxima a su paleta de 16 | parche 0001 |
| PVDI en `.2EX` (voces de rekordbox 7) | enmascarado con XOR al exportar, con un PVDI vacío en las pistas sin datos | copiado tal cual | Surco lo enmascara al preparar la copia (sección 2) |
| PQT2 vacío (56 bytes) en 2 pistas con rejilla variable | lo quita | lo copia | se ignora, casi seguro que no importa |
| Orden de los memory cues dentro del fichero | orden de la base | orden por tiempo | no importa, el reproductor ordena por posición |
| Carátula | 7 de 7 (usa su caché, también la de los WAV) | 2 de 7 (solo extrae la incrustada de AIFF, MP3, FLAC y M4A) | Surco pasa la de `ImagePath` en una carpeta (parche 0002) |
| Artista del álbum | el de la base | el XML no lo lleva | solo afecta al navegar por álbum |
| Tamaño del fichero en pdb y OneLibrary | el de master.db, desfasado en 5 de 7 por etiquetas reescritas | el real | se escribe el de master.db para parecerse a rekordbox (sección 6) |
| `masterDbId`, `masterContentId`, `unknown2` y similares | IDs de la colección | constantes de baken | parche 0005 |
| My Tag | 28 etiquetas y categorías, ninguna pista etiquetada | sin `exportExt.pdb`, 4 categorías por defecto | parches 0005 y 0006 |
| `playlists3.sync` y `playlists3Plus.sync` | estado del Sync Manager | no se escriben | Surco los escribe (sección 6) |
| `extracted/gcred.dat`, `DEVSETTING.DAT` | los escribe rekordbox | no se escriben | se conservan si ya están (parche 0006) |
| My Settings | los de `~/Library/Application Support/Pioneer/rekordbox6`, más `djprofile.nxs` | los mismos, byte a byte, con `--settings-dir` | iguales |
| Ficheros `._` de macOS | uno por cada audio | uno `._exportLibrary.db` | no importa |
| Página y disposición de `export.pdb` | 2 páginas por tabla con huecos, secuencia 60 | misma estructura, más compacta, secuencia 21 | según rbsync y baken funciona en NXS2 y 3000, a validar en los equipos |

El `cue` de OneLibrary está vacío en los dos. `.3EX` no lo copia rekordbox al USB, así que no hace falta.

Velocidad del spike. 1,95 s en frío para 7 pistas y 482 MB, 0,27 s en caliente, 4,9 s leyendo de verdad del NAS en la fase 1.

## 2. PVDI

Medido exacto en 5 de 5 pistas el 16/10.
- Para una sección `PVDI` de más de 24 bytes cuyo byte 12 no tiene `0x80`, se pone `0x80` en el byte 12 y se hace XOR de cada byte desde el offset 24 con el patrón `1e dd 1e 19 02 19 1b 11 19 23 18 19 24 11 fb 11 1e 2a 15`, repetido desde el byte 24 de la sección.
- Un `.2EX` sin `PVDI` recibe el vacío al final, `50564449 00000018 00000018 00000400 56220001 00000000`, y la longitud total de `PMAI` (u32 big-endian en el offset 8) crece 24.

## 3. Colores por defecto de los hot cues

Letras A a F que rekordbox pinta cuando el cue no tiene color asignado.

| Letra | R | G | B |
|---|---|---|---|
| A | 255 | 0 | 23 |
| B | 0 | 196 | 255 |
| C | 51 | 255 | 0 |
| D | 77 | 0 | 255 |
| E | 0 | 255 | 48 |
| F | 255 | 94 | 0 |

### Cues de la colección (`djmdCue`, sin borrados)

| Kind | Cues |
|---|---|
| 0 (memory cues) | 15301 |
| 1 (A) | 1933 |
| 2 (B) | 1936 |
| 3 (C) | 1929 |
| 5 (D) | 1823 |
| 6 (E) | 1512 |
| 7 (F) | 920 |
| 8 (G) | 452 |
| 9 (H) | 214 |
| 10 | 180 |
| 11 | 71 |
| 12 | 1 |

**Existen hot cues G (452) y H (214).** El parche 0001 necesita el color por defecto de G y H, que no está medido. Hay que sacarlo de un export de rekordbox antes de la Tarea 12. También hay Kind 10, 11 y 12 (252 cues en total) cuyo significado no está medido. El plan solo conoce A a H.

Colores de los cues con Kind mayor que 0 (10971 en total).

| Color | ColorTableIndex | Cues |
|---|---|---|
| -1 | NULL | 2274 |
| -1 | 1 | 4213 |
| -1 | 22 | 2925 |
| -1 | 32 | 197 |
| -1 | 42 | 453 |
| 255 | 0 | 773 |
| 255 | 1 | 72 |
| 255 | 22 | 52 |
| 255 | 32 | 2 |
| 255 | 42 | 10 |

Con `Color` -1 hay 10062 cues y con `Color` 255 hay 909. Leo `Color` distinto de -1 como "pintado a mano" (909), pero es una lectura mía. Los `ColorTableIndex` 1, 22, 32 y 42 aparecen con `Color` -1 y su significado exacto tampoco está medido. Quien lea esto en la Tarea 7 o la 12 debería contrastarlo con un export de rekordbox antes de apoyarse en ello.

## 4. Columnas que lee la Tarea 5

Todas las columnas que nombra la Tarea 5 existen.

- `djmdContent`: ID, FolderPath, FileNameL, FileNameS, Title, ArtistID, AlbumID, GenreID, BPM, Length, TrackNo, BitRate, BitDepth, Commnt, FileType, Rating, ReleaseYear, RemixerID, LabelID, OrgArtistID, KeyID, StockDate, ColorID, DJPlayCount, ImagePath, MasterDBID, MasterSongID, AnalysisDataPath, SearchStr, FileSize, DiscNo, ComposerID, Subtitle, SampleRate, DisableQuantize, Analysed, ReleaseDate, DateCreated, ContentLink, Tag, ModifiedByRBM, HotCueAutoLoad, DeliveryControl, DeliveryComment, CueUpdated, AnalysisUpdated, TrackInfoUpdated, Lyricist, ISRC, SamplerTrackInfo, SamplerPlayOffset, SamplerGain, VideoAssociate, LyricStatus, ServiceID, OrgFolderPath, Reserved1 a Reserved4, ExtInfo, rb_file_id, DeviceID, rb_LocalFolderPath, SrcID, SrcTitle, SrcArtistName, SrcAlbumName, SrcLength, UUID y las columnas de sincronización (`rb_data_status`, `rb_local_data_status`, `rb_local_deleted`, `rb_local_synced`, `usn`, `rb_local_usn`, `created_at`, `updated_at`).
- `djmdCue`: ID, ContentID, InMsec, InFrame, InMpegFrame, InMpegAbs, OutMsec, OutFrame, OutMpegFrame, OutMpegAbs, Kind, Color, ColorTableIndex, ActiveLoop, Comment, BeatLoopSize, CueMicrosec, InPointSeekInfo, OutPointSeekInfo, ContentUUID, UUID y las de sincronización.
- `djmdArtist`: ID, Name, SearchStr, UUID y las de sincronización.
- `djmdAlbum`: ID, Name, AlbumArtistID, ImagePath, Compilation, SearchStr, UUID y las de sincronización.
- `djmdGenre`, `djmdLabel`: ID, Name, UUID y las de sincronización.
- `djmdKey`: ID, ScaleName, Seq, UUID y las de sincronización.

Otras cifras de la colección.
- Pistas sin análisis (`AnalysisDataPath` vacío, sin contar `FileType` 25) 0.
- FLAC 0. Con más de 24 bits 123. Con más de 48 kHz 4.
- Rutas de análisis `/PIONEER/USBANLZ/<3 caracteres>/<resto del uuid>/ANLZ0000.DAT`.
- Rutas de carátula `/PIONEER/Artwork/<3 caracteres>/<resto del uuid>/artwork.jpg`.

### Carátula pequeña (Decisión 10)

La carpeta de una carátula en `~/Library/Pioneer/rekordbox/share/PIONEER/Artwork/529/fdbef-93cc-4518-80dc-d40c339168b7/` contiene tres ficheros, `artwork.jpg` (3851 bytes), `artwork_m.jpg` (3954 bytes) y `artwork_s.jpg` (1006 bytes). La pequeña es `<nombre>_s.jpg` junto a la grande, como esperaba el plan (`smallCoverPath`). Existe además una `_m` que el plan no usa.

## 5. Identidad que rekordbox pone en un USB

- `djmdProperty.DBID` es una sola fila, 3942308644.
- **`djmdCloudProperty` tiene dos filas, no una.** Son `4278116378` (`SyncService`, `Google`) y `3436966042` (`CDPFilterVersion`, vacío). La regla de la Tarea 9b (`myTagMasterDbId`) debe elegir la fila por `Reserved1 = 'SyncService'`, nunca por ser la única. Esto se detectó el 18/10 y se comunica al coordinador.
- My Tags 28 (4 con `Attribute = 1`, o sea columnas). My Tags puestos en pistas, 0. Están fuera de alcance y `exportExt.pdb` se conserva tal como lo escribió rekordbox.
- `masterPlaylists6.xml` tiene 120 nodos `<NODE `.
- Ficheros de ajustes en `~/Library/Application Support/Pioneer/rekordbox6` DEVSETTING.DAT, DJMMYSETTING.DAT, MYSETTING.DAT, MYSETTING2.DAT y djprofile.nxs.

## 6. Coexistencia con rekordbox en el mismo USB

### Qué hizo rekordbox el 16/10 sobre el USB de pruebas

- Con el NAS desmontado en ese momento (AutoMounter lo desmonta al cambiar de interfaz de red) rekordbox no encontró los audios de origen y respondió `[1] The file doesn't exist`. El número entre corchetes es el código de motivo, no un contador.
- No copió audio, adoptó las filas de playlist de Surco (`Dev_ID` 1 y 2 son los de Surco) y vació la playlist Makina, borrando sus 7 entradas en `export.pdb` y en el WAL de OneLibrary. Pistas, artistas y ANLZ quedaron intactos.
- Murió al salir (SIGSEGV en un destructor de interfaz), lo que dejó `exportLibrary.db-wal` y `-shm` sin fusionar.
- Un segundo intento, sincronizando Makina con 8 pistas sobre el `export.pdb` de baken, lo hizo caer dos de dos veces. Se rompía el heap dentro del motor DeviceSQL al borrar o insertar filas en páginas escritas por baken. La misma sync sobre su propio export no cae. Leer sin cambiar nada tampoco cae.
- Si falta una fuente, rekordbox vacía la playlist del USB. Sin el NAS montado se repite el fallo.
- Sin pruebas todavía sobre si, con el NAS montado, rekordbox reutiliza las pistas de Surco o las copia de nuevo.

### Invariante de la última escritura (parche 0004)

Cada página de datos de `export.pdb` guarda tres campos que describen el conjunto de filas tocadas en la última transacción.
- `unknown5` (+0x20) es el número de filas del conjunto.
- `num_rows_large` (+0x22) es el índice de la primera fila del conjunto.
- La máscara es el u16 que va tras los `row_presence_flags` de cada grupo de filas.

Todo lo que escribe rekordbox cumple `unknown5 == popcount(máscara)` y `num_rows_large == bit más bajo de la máscara` (o el centinela `0x1fff/0x1fff` con máscara 0). Se midió en 15 páginas de su export, 2 de `exportExt.pdb`, 17 de las plantillas de rekordcrate y 680 de sus datos reales, con 0 incoherentes. baken escribía `unknown5 = 1` y `num_rows_large = filas - 1` pero con la máscara igual a la presencia de todas las filas, con 10 páginas incoherentes. El arreglo es máscara `1 << ((filas - 1) % 16)` en el último grupo y 0 en los demás, con `unknown5 = 1` y `num_rows_large = filas - 1`. Las tablas plantilla (colores, columnas, menú, u18) usan `unknown5 = filas`, `num_rows_large = 0` y máscara igual a la presencia. `crashtools/fix_txmask.py` cambia 13 bytes en el USB de pruebas y es la referencia de los tests del parche.

El plan recoge que el arreglo se probó a mano contra rekordbox 7.2.19 el 18/10. No hay un informe escrito de esa prueba en las notas del scratchpad que usé (`analisis.md`, `rebuild.md`, `crash-analysis.md`, que acaba proponiéndola). Se cita aquí por lo que dice el plan.

### Regla de `playlists3.sync` y `playlists3Plus.sync`

Se pueden generar byte a byte iguales a los de rekordbox.
- Líneas con CRLF. Cabecera `<Sync DBID="<DBID como int32 con signo>" AutomaticSync="1" AllPlaylists="0" IncludeCue="1" ForcedSync="0" Timestamp="0">`. El DBID 3942308644 es -352658652 como int32.
- Nodo raíz `Id="0" ParentId="0" Attribute="1" Dev_ID="0" Timestamp="0" CheckType="2"`.
- Un nodo por carpeta o playlist del USB. `Id` y `ParentId` son el ID de la playlist en `djmdPlaylist` en hexadecimal mayúsculas, `Attribute` 1 si es carpeta y 0 si es playlist, `Dev_ID` es el ID de la playlist en el USB y `CheckType` 2 para carpetas y 1 para playlists marcadas.
- `Timestamp` es el del mismo `NODE` en `~/Library/Pioneer/rekordbox/masterPlaylists6.xml` (BASES 1790869744800, Makina 1790961625338). No es `djmdPlaylist.updated_at`.
- Otras reglas de identidad. `content.masterDbId` es el DBID (baken ponía una constante). `export.pdb` lleva en cada pista `djmdContent.ID` en `+0x14`, el DBID en `+0x18` y el `FileSize` de master.db en `+0x10`, aunque esté desfasado. `property.myTagMasterDBID` es el ID de la fila `SyncService`. `myTag` sale de `djmdMyTag` (`myTag_id` = ID, `sequenceNo` = Seq - 1, `attribute`, padre 0 si es raíz).

### Reglas de convivencia

- Antes de reescribir `exportLibrary.db` hay que borrar `-wal` y `-shm`. Un fichero nuevo junto a un WAL de rekordbox repetiría páginas ajenas y lo corrompería.
- Los `IDs` de playlist del USB (`Dev_ID`) deben ser estables entre reconstrucciones. Se leen del `playlists3.sync` del USB y las nuevas toman el máximo más uno en orden de árbol.
- No se edita en el sitio lo que escribió rekordbox, se reconstruye respetando su identidad. Se conservan `exportExt.pdb`, `DEVSETTING.DAT` y `extracted/gcred.dat`.
- Se ponen las fechas de modificación del audio copiado iguales a las del origen, como hace rekordbox.
- Una sola escritora por USB y por ejecución. Si rekordbox lo toca, Surco reconstruye.

## 7. Formato de `diskutil` en macOS

Fixtures reales en `apps/desktop/src/main/fixtures/`.
- `diskutil-usb-exfat.plist` es `diskutil info -plist /Volumes/Surco` (la partición).
- `diskutil-usb-whole.plist` es `diskutil info -plist disk4` (el disco entero, `ParentWholeDisk` de la partición). Su `Content` es `FDisk_partition_scheme`, o sea MBR.
- `diskutil-internal.plist` está escrito a mano, con solo las claves que lee el filtro y un UUID de relleno. El real lleva identificadores de este Mac que no deben estar en el repo. Las claves coinciden con lo que imprime `diskutil info -plist /`.
- Un volumen de red (`/Volumes/Public`) responde `Could not find disk` con código de salida 1, así que los volúmenes de red se descartan sin un caso especial.

Campos de la partición del USB de pruebas.

| Clave | Valor |
|---|---|
| Internal | false |
| RemovableMediaOrExternalDevice | true |
| Ejectable | true |
| Removable | false |
| RemovableMedia | false |
| BusProtocol | USB |
| FilesystemType | exfat |
| FilesystemName | ExFAT |
| Content | Windows_NTFS |
| FreeSpace | 123044364288 |
| TotalSize | 124731129856 |
| VolumeName | Surco |
| VolumeUUID | B10C96EF-51C2-344E-B78D-DAFC319D973E |
| ParentWholeDisk | disk4 |

`Removable` y `RemovableMedia` son false en un USB. El filtro debe apoyarse en `RemovableMediaOrExternalDevice` y `Ejectable`, no en `Removable`.

## 8. Coste de preparar los análisis (Decisión 6)

Copiar los `.DAT`, `.EXT` y `.2EX` de las primeras 500 pistas analizadas (1500 ficheros) a una carpeta del scratchpad tardó 820 ms la primera vez y 290 ms la segunda (caché del sistema). Está por debajo de los 3 s, así que la Decisión 6 se mantiene sin caché por sesión. Es disco local a disco local, no incluye el enmascarado de PVDI.

## 9. Preguntas abiertas para la Tarea 12

- El CDJ-2000 no lee exFAT y no se puede probar con este USB. Haría falta otro en FAT32 con MBR.
- OneLibrary en CDJ-3000X y XDJ-AZ solo la ha validado Vicent una vez, con el USB del spike. Falta comprobar si la XDJ-AZ o el 3000X enseñan raras las zonas de voz con el PVDI enmascarado.
- Los colores por defecto de los hot cues G y H (sección 3).
- El significado de los Kind 10, 11 y 12.
- Si rekordbox, con el NAS montado, reutiliza las pistas de Surco o las copia otra vez.
- La nota escrita de la prueba del 18/10 con el arreglo de la máscara (sección 6).
