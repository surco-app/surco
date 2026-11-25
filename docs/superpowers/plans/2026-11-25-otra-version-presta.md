# Otra versión presta grouping, playlists y carátula

Decidido con Vicent el 25/11 (respuesta a pregunta directa):

- Una copia de su biblioteca que sale como «Another version» (veredicto `different`, o una copia
  que cuenta pero cuya duración está a más de `VERSION_GAP_SEC` = 2 s) presta a la pista abierta
  **solo grouping, playlists y carátula**. Álbum, año, sello y lo demás siguen viniendo solo de una
  copia de la misma grabación (la regla de `fillCopyPath` / `copyPathIn`, que no cambia).
- **La carátula de la copia manda**, también en una copia de la misma grabación: se pone como
  carátula elegida aunque el fichero traiga la suya. La del fichero (`embeddedCover`) sigue en el
  carrusel 1/N y el cambio se deshace con ⌘Z (`onRecordUndo` con `cover: true`). No pisa una
  carátula quitada a mano (`coverRemoved`) ni una que el usuario haya elegido a mano, si existe
  esa señal en `TrackItem`; si no existe, no inventarla: gana sobre la del fichero y sobre la de
  un match automático.
- El relleno sigue siendo «solo campos vacíos» para el grouping, una vez por pista (como
  `copyFilled` / `appleMusicFilled`) y nunca tras «Clear all» (`metaCleared`).

Casos reales que lo motivan (capturas de Vicent):
1. FLAC 6:01, copia MP3 5:57 en Apple Music y rekordbox. El MP3 lleva `GRP1 = "Bases, Rockola"`.
   Salía «Another version» y el grouping quedaba vacío.
2. FLAC 7:01, copia WAV 7:06 en Apple Music y rekordbox. El WAV no lleva grouping (Music no
   escribe etiquetas en WAV); «Bases» vive solo en la base de datos de Music.

Ya arreglado aparte en esta rama: `readTags` (main/ffmpeg.ts) ahora lee GRP1 y POPM igual que
`readMeta`, así que leer las etiquetas de la copia MP3 ya devuelve el grouping.

## Contexto del código

- `renderer/src/components/Editor.tsx` alrededor de 930-1015: `copyRows` (copias DJ con veredicto
  y duración), `copyPathIn`, `useAppleMusicFill`, `useReplacedCopyFill` y `fillCopyPath`.
- `renderer/src/lib/libraryCopy.ts`: `countsAsCopy`, `lengthsMatch`, `copyPathIn`, `fillCopyPath`.
- `renderer/src/hooks/useReplacedCopyFill.ts` + `lib/fillFromCopy.ts`: relleno desde las etiquetas
  del fichero de la copia (`window.api.readTags`, `readCoverFull`). Hoy la carátula solo rellena si
  no hay (`wantsCover`).
- `renderer/src/hooks/useAppleMusicFill.ts` + `lib/appleMusicFill.ts`: relleno desde la base de
  Music. Hoy pregunta con `item.inputPath`, y main (`applemusic:entryMeta` en
  `main/appleMusicIpc.ts`) solo responde la entrada cuyo fichero es ese path, así que para una
  copia que es otro fichero devuelve null. Preguntar con la ruta de la copia
  (`replaceTarget.path`) devuelve la entrada de la copia.
- `replaceTarget` sale de `useLibraryVerdict`; el veredicto de la copia de Music respecto al
  fichero es `copyVerdict` / la fila de Music en la sección «In your library».
- Playlists: `renderer/src/hooks/useRekordboxPlaylists.ts` `usePlaylistsSpec`. Con copia de la
  misma grabación el campo actúa sobre la copia (`copyPathOf`). Sin ella, el campo guarda la
  selección en `track.playlists[library]` (`playlistsEdit`, `effectivePlaylists`) y la conversión
  la aplica al fichero nuevo. La pertenencia de una ruta a playlists se lee con
  `useRekordboxMembership(paths, shown, library)`.

### Task 1: Grouping y carátula desde una copia «Another version» (ficheros)

Si no hay copia de la misma grabación (`fillCopyPath` devuelve ''), pero sí una copia encontrada
que es otra versión (Music `replaceTarget` no ambiguo con `path`, o una fila DJ con veredicto
`different` o con duración fuera de `VERSION_GAP_SEC`), leer sus etiquetas y prestar solo el
grouping (si el campo está vacío) y la carátula (regla de arriba). Una copia aún en `measuring`
espera, como hoy. `several` no presta nada.

Además, en el relleno de la misma grabación la carátula de la copia pasa a mandar.

Tests (TDD, rojo primero): en `useReplacedCopyFill.test.tsx` / `fillFromCopy.test.ts` /
`libraryCopy.test.ts` y, si hace falta el cableado, `Editor.test.tsx`. Que digan POR QUÉ: «una
copia de otra versión trae el grouping con el que el DJ la archivó, no su álbum».

### Task 2: Grouping y carátula desde la base de Music para una copia que es otro fichero

`useAppleMusicFill`: cuando el candidato es `replaceTarget` y su `path` no es el fichero abierto,
preguntar a main con la ruta de la copia. Misma grabación: todo `FILLABLE` + carátula, como hoy.
Otra versión: solo grouping + carátula. La carátula de Music también manda (regla de arriba).
Comprobar en `appleMusicIpc.test.ts` que main ya responde por la ruta de la copia; si no, ajustarlo.

### Task 3: Playlists desde una copia «Another version»

Para cada programa DJ (y Apple Music si su campo de playlists usa el mismo mecanismo) cuya copia
es otra versión, una vez por pista y solo si no hay nada preparado para ese programa
(`track.playlists[library]` vacío), preparar en la pista las playlists donde está esa copia, para
que el campo las muestre marcadas y la conversión archive ahí el fichero nuevo. Con ⌘Z deshecho.
La copia de la misma grabación sigue como hoy (el campo actúa sobre la copia al momento).

## Normas para quien implemente

- Worktree `/Users/vicent/code/surco-grouping-copia`, rama `grouping-copia`. Trabajar SOLO ahí.
- TDD: ver el test en rojo antes de implementar. Selectores `data-testid`, nunca clases CSS.
- Comentarios solo para explicar por qué (norma de Surco). Sin guion largo ni dos puntos de
  explicación en textos de UI.
- Commit por tarea, título descriptivo en inglés sin prefijos ni cuerpo, como el log existente.
- Antes de cada commit: `npx biome format --write <ficheros>`, `npm run lint` (entero) y
  `npx tsc --build` desde `apps/desktop`, y los tests de los ficheros tocados
  (`npx vitest run <ruta>` desde `apps/desktop`).
- Sin textos nuevos en la UI.
