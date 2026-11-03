# Bloque 6 (tras convertir): inventario y división

Medido el 03/11 sobre `eb5cd2e80` (rutas relativas a `apps/desktop/src/`). Nada del bloque 6 pasa por una interfaz por programa: `flushConversionBatch` (`main/libraryFlushes.ts:218-376`) es una secuencia escrita a mano (Traktor, rekordbox, Engine), cada programa con su forma de dependencias, su tipo de resultado y su cola.

## Puntos clave

- Durante el trabajo: `nmlBatch` (Traktor, `ffmpeg.ts:1957`) y `rekordboxBatch` (`ffmpeg.ts:2676`, `rekordboxRepointFor.ts`) compartido por rekordbox, Engine y las elecciones de playlists de Traktor/Engine (`RekordboxRepoint`, `rekordboxBatch.ts:6-24`). `processTrack.ts:781-792` adjunta playlists con dos funciones de firma distinta. Engine es el único que se añade durante el trabajo (`processTrack.ts:568, 636, 1041`; adaptador `index.ts:1788`; `isAppleMusicOnly`; `engineSizeFollow`).
- `process:batch-end` (`index.ts:1514-1542`) pasa tres colas por posición; resultado literal en el fallo.
- `LibraryHost` (`libraryFlushes.ts:52-62`): `ensureTraktorClosed`/`ensureRekordboxClosed`/`ensureEngineDjClosed`, `showBlockedDialog(SyncBlockedKey)`, `reportIssue('rekordbox:sync-issue'|'engine:sync-issue')`, `rekordboxHeld()`. `hostFor` en `index.ts:1497`.
- Fábricas de dependencias con formas distintas: `traktorFlushDeps(host, session)` (`:142`), `rekordboxFlushDeps` (`:161`), `rekordboxWriteDeps` (`:174`), `engineFlushDeps` (`:180`). Textos: `REKORDBOX_KEYS`, `ENGINE_KEYS` (`RepointKeys`) frente a `TRAKTOR_SYNC_SKIP_KEYS`.
- Acoplamientos: `repointEngineQueued` renombra `engine-running` a `'rekordbox-running'` (`libraryFlushes.ts:464`); `queueConversionRun` compara con `'rekordbox-running'` (`rekordboxQueueFromRun.ts:129`); `libraryTrackOps` elige con ternario (`:90`).
- `Sessions` (`libraryFlushes.ts:65`) y `SyncedLibraries` (`libraryFileUse.ts:16-20`) con claves escritas a mano (el compilador no las exige para un cuarto programa).
- Etiquetas: `LibraryTagFlushers` (`libraryTagSync.ts:7-13`) interfaz con tres claves; campos: rekordbox 5 (con albumArtist), Traktor y Engine 4.
- Duplicados: `SKIPPED` (`duplicateReplace.ts:66`), `stillHeld` (`:226`), `traktorDuplicateStep` con forma propia, `DuplicateReplaceOutcome` con claves escritas, `duplicateLibraryDeps` (`libraryFlushes.ts:536`), `libraryFileUse` con cadenas de `if`, `usedByAnyLibrary`.
- Colas en `index.ts:348-620`: tres colas, tres `applyXQueueQuietly`, tres vigilantes, `verifyRegistry` literal.
- Renderer: seis campos de playlists en el trabajo (`useTrackProcessing.ts:441`), banderas `fromX`, `sessionEdits`, `useTrackLibrary`, `dirty` (codificación distinta por programa), `EDIT_KEYS`, `Editor` (tres `usePlaylistsSpec`, `reachedPrograms`, estado de biblioteca), `LIBRARY_ICON`, `MusicReview*` `LIBRARIES`/`ReviewSync` (`engineDj`), colas y avisos de `App.tsx`, `DestinationTab`, ajustes.
- USB: `routeUsbExports(rekordbox, engine)` por posición (`usbExportRoute.ts`), `usbExportIpc.ts` (sin tests), `UsbExportRequest.source?: 'engine'`, `UsbVolume.engine`, `App.tsx` y `UsbExportModal` con ramas `engine`.

## Huecos de tests

Sin tests: `usbExportIpc.ts`; `dirty` sin casos de Traktor/Engine; `PlaylistsField` y `useUsbVolumes` sin casos por programa; `syncTagsInLibraries` por programa en el cableado; `repointEngineQueued` (renombrado del motivo) aislado; `usedByAnyLibrary` y `library:copyInfo` solo indirectos; elección de fuente del USB en App solo por escenarios.

## Subbloques (orden)

1. **6a** host y dependencias de biblioteca (main, M).
2. **6b** acumulador de la conversión y adjuntar playlists (main + shared, M).
3. **6c** `flushConversionBatch` por programa (main, L, el núcleo).
4. **6d** añadir a Engine durante el trabajo (main, S-M).
5. **6e** sincronizar etiquetas (main, S).
6. **6f** duplicados y uso de ficheros (main + shared, S-M).
7. **6g** colas de `index.ts` (main, M; en paralelo a 6c).
8. **6h** estado de pistas en el renderer (S-M).
9. **6i** superficies del renderer (S).
10. **6j** USB (main + renderer, M).
