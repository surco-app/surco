# Spikes (a) y (b), medidas sobre la copia del 18/10 21:48

Copia tomada con rekordbox cerrado (sin `-wal` ni `-shm` en ese momento). rekordbox se abrió a las 21:49 y ya ha escrito 1,5 MB de WAL, así que la copia y el candidato están desfasados respecto a la colección real (ver CHECKLIST, paso 1).

## Cómo da de alta rekordbox una pista (medido en las altas más recientes, MP3, WAV y AIFF)

Todas las altas de la colección vienen del navegador de iTunes/Música (`ExtInfo` = `{"browseTypeFrom": "itunes:tracks:N"}`) o de "Imported from Device" (`ExtInfo` = el texto `null`). No hay ninguna alta arrastrada desde Finder y **ninguna pista sin analizar**, así que el estado "recién importada, aún sin análisis" no se puede leer aquí; solo el estado final.

- `ID` y `MasterSongID` iguales, de 28 bits (192668 a 267901056). `MasterDBID` y `DeviceID` los de `djmdDevice` (uno solo).
- `UUID` v4. `AnalysisDataPath` e `ImagePath` cuelgan del UUID (`/PIONEER/USBANLZ/219/e40e4-.../ANLZ0000.DAT`).
- `rb_file_id` = **inodo del fichero** (`st_ino` como entero de 64 bits con signo). Comprobado en 3 de 3 y en las 19 filas de `~/Music/Music`. Dos filas con la misma ruta comparten `rb_file_id`; 9 grupos con el mismo `rb_file_id` y distinta ruta (la misma pista por dos prefijos).
- `DateCreated` = fecha de creación del fichero (birthtime, fecha local). `StockDate` = fecha de alta (en iTunes es su "añadida el"; con alta propia, hoy).
- `Length` = duración truncada (458,9 s da 458). `BitRate` 320 en MP3, 1411 en WAV/AIFF 16/44,1. `BitDepth` 16 también en MP3.
- WAV: rekordbox no guarda sello (0 de 1260 con `LabelID`), ni ISRC (0), y casi nunca número de pista (8 de 1260). AIFF y MP3 sí.
- FK ausente = `NULL` (`RemixerID`, `LabelID`, `ComposerID`, `OrgArtistID`). Textos ausentes = `''` (`FileNameS`, `Subtitle`, `ReleaseDate`, `Lyricist`, `ISRC`, `OrgFolderPath`, `Reserved1`, `ModifiedByRBM`, `DeliveryComment`).
- Constantes en las 2070 filas: `HotCueAutoLoad` 'on', `DeliveryControl` 'on', `ColorID` '0', `ServiceID` 0, `LyricStatus` 0, `SamplerTrackInfo` 0, `SamplerPlayOffset` 0, `VideoAssociate` '0' (8 samplers con ''), `SearchStr` NULL, `usn` NULL, `rb_local_synced` 0.
- `ContentLink` no es el `rb_local_usn` del menú TRACK (pyrekordbox se equivoca). Toma 6 valores con los 16 bits bajos fijos (0x060E). Las altas recientes de ficheros llevan 2950670 (645 filas, ago 2025 a oct 2026). Significado desconocido.
- `Analysed` 105 o 233 (máscara de bits del análisis), `AnalysisUpdated`, `TrackInfoUpdated`, `CueUpdated` son contadores en texto. `CueUpdated` es NULL en las 487 pistas sin edición de cues.
- Artista, álbum, sello y género nuevos se crean en el mismo instante que la pista (mismo `created_at` al milisegundo), con su propio `rb_local_usn`. Álbum con `ImagePath` NULL, `Compilation` 0, `SearchStr` NULL, `AlbumArtistID` = artista del álbum o, sin él, el de la pista. IDs de 32 bits.
- `contentFile`: una fila por carátula y por cada ANLZ (`.DAT`, `.EXT`, `.2EX`, `.3EX`), creadas por rekordbox al extraer la carátula (0,6 s tras el alta) y al terminar el análisis (unos 11 s). `ID` = `<UUID pista>_<ruta url-encoded>`. Surco no las escribe: no hay carátula ni análisis en el alta.
- Rutas: 2016 por `/Volumes/Public/Music/`, 19 por `~/Music/Music` (ahora es una carpeta local, ya no un enlace), 27 de "Imported from Device", 8 del sampler. Las 55 rutas con caracteres no ASCII están en NFC, ninguna en NFD.
- **El enlace `~/Music/Music` ya no existe**. El enlace al NAS es ahora `~/Music/Music.old -> /Volumes/Public/Music`. La pista de prueba por enlace va por `Music.old`.
- `djmdSongPlaylist`: al añadir Tengo a Makina hoy (19:00:36.517) rekordbox **no** cambió `djmdPlaylist.updated_at` de Makina (sigue en 01/10) y sí puso el `Timestamp` de su nodo del XML a 19:00:36.518. Lo mismo en Factory e Insta al reordenar. La huella de conflicto por `updated_at` de la playlist no sirve; la que se mueve es el `Timestamp` del XML.

## Cues (spike b)

- `PSSI` de la copia local **no** está enmascarado (mood 1 o 2 leído en claro en las 10 pistas de Makina).
- Cue puesto a mano en rekordbox (All I Want, 18/10 08:15): fila de `djmdCue` con `rb_local_usn` **NULL**, `ColorTableIndex` NULL en memory cue, `Color` −1. Además rekordbox reescribe `contentCue` (JSON con los cues, `rb_cue_count`, `rb_local_usn`, `updated_at`) y en `djmdContent` sube `CueUpdated` en uno por cue, `rb_local_usn` (el de `contentCue` + 1) y `updated_at`.
- 18390 de 26291 cues tienen `rb_local_usn` NULL; los que lo tienen los tocó pyrekordbox.
- El JSON de `contentCue` casi nunca lleva `ColorTableIndex` (20180 entradas sin él) y los colores que puso `cues.py colorear` el 18/10 08:05 no están en él. Aun así rekordbox los muestra, así que rekordbox lee `djmdCue`, no `contentCue`. Tras `cues.py completar`, `contentCue` de All I Want quedó desfasado (2 frente a 10) y rekordbox lo abrió sin problema.
- Nadie borra cues con `rb_local_deleted` (0 filas); rekordbox borra la fila.
- Port de `rules.py` a JS (`rules.cjs`) contrastado con el Python original en 3000 casos aleatorios (rejilla, drops, frases, hot cues existentes): 0 diferencias.

## Qué se ha escrito en el candidato (todo con el mismo sello de tiempo)

Ver `build-report.json` para cada fila.

- Last Night.wav (`/Volumes/...`), ID 142145108, artista y álbum nuevos, género Hard House existente, sin sello.
- 01 Goteras.mp3 (`~/Music/Music.old/...`), ID 67901555, artistas Omar Montes y Omar Montes, JC Reyes nuevos, álbum Goteras nuevo, género Unclassifiable nuevo.
- Columnas no medibles (pista sin analizar) como pyrekordbox o la spec: `BPM` 0, `Analysed` 0, `AnalysisDataPath` '', `ImagePath` '', `KeyID` NULL, `AnalysisUpdated`/`TrackInfoUpdated`/`CueUpdated` NULL, `ExtInfo` 'null', `ContentLink` 2950670.
- Playlist nueva "Surco prueba alta" en la raíz (Seq 14) con las dos; Makina pasa de 10 a 12. Nodo nuevo en el XML y `Timestamp` de Makina movido; `djmdPlaylist` de Makina sin tocar.
- Hands Of Fate: 2 hot cues nuevos (C rojo 48 en 1:39.955, F verde 32 en 3:19.700) con su CAL, 3 hot cues cambian de letra (C→D, D→E, E→G). Din Dah: 1 hot cue nuevo (B rojo 48 en 0:26.469) con su CAL, 5 cambian de letra (B→C, C→D, D→E, E→F, F→G). Ningún CAL existente se toca. `contentCue` al día y `CueUpdated` +7 en las dos.
- Tengo (hot cues a mano, todos azules; 3:39.760 no encaja en el plan): sin cambios.

## Resultado en rekordbox de verdad (18/10, 22:05 a 22:10)

Candidato rehecho sobre la colección de las 22:03 (respaldo verificado por sha256), puesto en
su sitio con rekordbox cerrado y devuelto después (sha256 idéntico al respaldo).

- Vicent abrió rekordbox: "está todo perfecto". Las dos pistas salen una vez, en la playlist
  nueva y al final de Makina, suenan, y rekordbox **las analizó solo al abrirse** sin pulsar
  nada. Sin avisos ni "!".
- Hot cues de Hands Of Fate y Din Dah en su letra, color y golpe; CAL intactos; Tengo igual.
- Tras el análisis, en cada pista nueva rekordbox puso `BPM` (centésimas), `KeyID`,
  `AnalysisDataPath`, `Analysed` 105, `AnalysisUpdated` y `TrackInfoUpdated` "2",
  `rb_local_usn` y `updated_at` nuevos, y sus 4 filas de `contentFile` (.DAT, .EXT, .2EX,
  .3EX). Ninguna fila repetida. Los valores "sin analizar" que escribió Surco (`BPM` 0,
  `Analysed` 0, `AnalysisDataPath` '', `KeyID` NULL) valen.
- Los `djmdCue` y `contentCue` escritos por Surco siguen igual tras abrir y cerrar.
- Ni el `updated_at` de Makina ni el de la playlist nueva se movieron. `integrity_check` ok.
- Quedan en `share/PIONEER` las carpetas de análisis de las dos pistas (huérfanas, sin uso).
