# Mapa de Serato: lo que el compilador obliga a decidir

Medido el 03/11 tras el bloque 1 añadiendo `'serato'` a `DjProgram` (y revirtiendo): errores de los tres `tsc`, `fichero:línea código`.

## Añadidos a mano (el compilador no los ve)

- `shared/djProgram.ts` `programOf`: el caso por defecto devuelve `'rekordbox'`. Primer cambio de Serato: reconocer `serato:`.
- `shared/verification.ts` `PLACE_ORDER`, `shared/hiddenSources.ts:3`, `renderer/src/components/settings/GeneralTab.tsx:18` (`SOURCES`): listas que mezclan programas con 'file'/'appleMusic'.
- `renderer/src/components/CuesSection.tsx`: el booleano `traktor` (guardado bloqueado, color fijo, menús de color, nota de CALL, recolor), `copy === ENGINE_COPY`, `saveAllKey` (etiqueta de rekordbox por defecto), texto de ayuda de colores; `CuesBatchSection.tsx` puerta de guardado de Traktor. Van al bloque 4 (cues).
- `renderer/src/lib/playlistEdits.ts:81` y comprobaciones `browser.source` de `App.tsx`: bloques 5 (playlists) y 6 (USB).

## Errores del compilador

```
src/main/copiesIpc.test.ts:110 TS2741
src/main/copiesIpc.test.ts:119 TS2741
src/main/copiesIpc.test.ts:140 TS2741
src/main/copiesIpc.test.ts:164 TS2741
src/main/copiesIpc.test.ts:181 TS2741
src/main/copiesIpc.test.ts:196 TS2741
src/main/copiesIpc.test.ts:218 TS2741
src/main/copiesIpc.test.ts:250 TS2741
src/main/copiesIpc.test.ts:262 TS2741
src/main/copiesIpc.test.ts:283 TS2741
src/main/copiesIpc.test.ts:310 TS2741
src/main/copiesIpc.test.ts:342 TS2741
src/main/copiesIpc.test.ts:356 TS2741
src/main/copiesIpc.test.ts:381 TS2741
src/main/copiesIpc.test.ts:99 TS2741
src/main/damageScan.ts:19 TS2741
src/main/duplicateReplace.ts:17 TS2345
src/main/duplicateReplace.ts:174 TS7053
src/main/index.ts:2170 TS2741
src/main/index.ts:325 TS2741
src/main/libraryStatus.ts:22 TS2741
src/main/libraryTagSync.ts:42 TS7053
src/main/libraryTagSync.ts:5 TS2345
src/main/moments.test.ts:20 TS2741
src/main/moments.test.ts:33 TS2741
src/main/processTrack.ts:1157 TS2322
src/main/rekordboxCuesIpc.ts:124 TS2366
src/main/rekordboxCuesIpc.ts:148 TS2366
src/main/rekordboxCuesIpc.ts:181 TS2366
src/main/rekordboxCuesIpc.ts:207 TS2366
src/main/rekordboxCuesIpc.ts:252 TS2366
src/main/rekordboxCuesIpc.ts:38 TS2345
src/main/rekordboxCuesIpc.ts:76 TS2366
src/main/rekordboxCuesIpc.ts:97 TS2366
src/main/verifyIpc.ts:213 TS7053
src/main/verifyIpc.ts:214 TS7053
src/main/verifyIpc.ts:226 TS7053
src/main/verifyIpc.ts:227 TS7053
src/main/verifyRegistry.ts:113 TS2322
src/main/verifyRegistry.ts:155 TS2741
src/main/verifyRegistry.ts:163 TS2741
src/main/verifyRegistry.ts:315 TS7053
src/main/verifyRegistry.ts:329 TS7053
src/main/verifyRegistry.ts:93 TS2345
src/main/verifyRegistry.ts:94 TS2741
src/renderer/src/App.tsx:404 TS7053
src/renderer/src/App.tsx:408 TS2741
src/renderer/src/components/CuesBatchSection.tsx:27 TS2741
src/renderer/src/components/CuesSection.tsx:159 TS2741
src/renderer/src/components/CuesSection.tsx:291 TS2741
src/renderer/src/components/Editor.test.tsx:837 TS2741
src/renderer/src/components/Editor.test.tsx:883 TS2741
src/renderer/src/components/Editor.test.tsx:892 TS2741
src/renderer/src/components/Editor.test.tsx:898 TS2741
src/renderer/src/components/Editor.test.tsx:906 TS2741
src/renderer/src/components/Editor.tsx:129 TS2345
src/renderer/src/components/FieldsEditor.tsx:154 TS7053
src/renderer/src/components/MusicReview.test.tsx:1091 TS2741
src/renderer/src/components/MusicReview.test.tsx:1241 TS2741
src/renderer/src/components/MusicReview.test.tsx:1262 TS2741
src/renderer/src/components/MusicReview.test.tsx:1289 TS2741
src/renderer/src/components/MusicReview.test.tsx:1320 TS2741
src/renderer/src/components/MusicReview.test.tsx:1331 TS2741
src/renderer/src/components/MusicReview.test.tsx:1394 TS2741
src/renderer/src/components/MusicReview.test.tsx:2547 TS2741
src/renderer/src/components/MusicReview.test.tsx:2561 TS2741
src/renderer/src/components/MusicReview.test.tsx:2573 TS2741
src/renderer/src/components/MusicReview.test.tsx:2594 TS2741
src/renderer/src/components/MusicReview.test.tsx:2647 TS2741
src/renderer/src/components/MusicReview.test.tsx:677 TS2741
src/renderer/src/components/MusicReview.test.tsx:690 TS2741
src/renderer/src/components/MusicReview.test.tsx:707 TS2741
src/renderer/src/components/MusicReview.test.tsx:732 TS2741
src/renderer/src/components/MusicReview.test.tsx:806 TS2741
src/renderer/src/components/MusicReview.test.tsx:822 TS2322
src/renderer/src/components/MusicReview.test.tsx:849 TS2741
src/renderer/src/components/MusicReview.test.tsx:870 TS2741
src/renderer/src/components/MusicReview.test.tsx:891 TS2741
src/renderer/src/components/MusicReview.test.tsx:914 TS2741
src/renderer/src/components/MusicReview.test.tsx:928 TS2741
src/renderer/src/components/MusicReview.test.tsx:950 TS2741
src/renderer/src/components/MusicReview.test.tsx:966 TS2741
src/renderer/src/components/MusicReview.test.tsx:980 TS2741
src/renderer/src/components/PlaylistsField.tsx:358 TS7053
src/renderer/src/components/settings/GeneralTab.tsx:49 TS2741
src/renderer/src/components/settings/GeneralTab.tsx:55 TS2741
src/renderer/src/components/SourceRail.tsx:11 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1066 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1067 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1080 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1081 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1099 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1100 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1101 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1116 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:1117 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:54 TS2741
src/renderer/src/hooks/useMusicReview.test.tsx:66 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:101 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:113 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:153 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:173 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.test.tsx:91 TS2741
src/renderer/src/hooks/useRekordboxPlaylists.ts:108 TS7053
src/renderer/src/hooks/useRekordboxPlaylists.ts:114 TS7053
src/renderer/src/hooks/useRekordboxPlaylists.ts:47 TS7053
src/renderer/src/hooks/useRekordboxPlaylists.ts:50 TS2322
src/renderer/src/hooks/useRekordboxPlaylists.ts:63 TS7053
src/renderer/src/hooks/useRekordboxPlaylists.ts:67 TS2322
src/renderer/src/hooks/useRekordboxPlaylists.ts:86 TS7053
src/renderer/src/lib/cuePrograms.ts:12 TS2741
src/renderer/src/lib/cueTwins.ts:54 TS2741
src/renderer/src/lib/djLibraries.ts:18 TS2345
src/renderer/src/lib/djReach.ts:19 TS2345
src/renderer/src/lib/djReach.ts:7 TS2741
src/renderer/src/lib/fields.ts:147 TS2741
src/renderer/src/lib/rekordboxPlaylists.ts:115 TS7006
src/renderer/src/lib/rekordboxPlaylists.ts:152 TS7053
src/renderer/src/lib/rekordboxPlaylists.ts:185 TS7053
src/renderer/src/lib/rekordboxPlaylists.ts:186 TS7053
src/renderer/src/lib/rekordboxPlaylists.ts:24 TS2339
src/renderer/src/lib/rekordboxPlaylists.ts:26 TS7053
src/renderer/src/lib/rekordboxPlaylists.ts:27 TS7053
src/renderer/src/test/api.ts:186 TS2322
src/renderer/src/test/api.ts:191 TS2322
src/scenarios/harness.tsx:511 TS2741
src/scenarios/harness.tsx:517 TS2741
src/scenarios/harness.tsx:524 TS7053
src/scenarios/harness.tsx:545 TS7053
src/scenarios/matrix/cells.ts:360 TS2741
src/scenarios/matrix/cells.ts:91 TS2741
src/scenarios/matrix/libraries.ts:26 TS2345
src/scenarios/matrix/libraries.ts:384 TS2741
src/scenarios/matrix/oracle.ts:1077 TS2741
src/scenarios/matrix/oracle.ts:569 TS2741
src/scenarios/matrix/oracle.ts:66 TS2345
src/scenarios/matrix/realLibraries.ts:753 TS2741
src/scenarios/matrix/report.ts:72 TS2741
src/shared/djProgram.test.ts:16 TS2345
src/shared/djProgram.ts:6 TS2345
```
