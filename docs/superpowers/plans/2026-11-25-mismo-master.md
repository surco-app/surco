# El mismo master cuenta como la misma grabación

Decidido con Vicent el 25/11 (pregunta directa):

1. Una copia de su biblioteca que es **el mismo master** según la comparación del audio entero cuenta
   como **la misma grabación** aunque las duraciones se separen más de `VERSION_GAP_SEC` (2 s), por
   ejemplo por silencio de más o de menos al principio o al final. Rellena todos los campos vacíos,
   y el campo de playlists actúa sobre la copia al momento. «Another version» queda solo para
   cuando el audio dice que es otra edición (veredicto `different`).
2. La etiqueta «Alike» (veredicto `tie` con `sameMaster`: mismo master, igual calidad, no idéntico
   byte a byte) pasa a mostrarse como «It's the same», en los 8 idiomas, con el mismo aspecto que el
   veredicto `same`. Esto deshace a sabiendas su regla anterior de que «It's the same» exige
   duración a ±2 s: para un DJ es la misma pista con la misma calidad.

## Contexto del código

- `apps/desktop/src/renderer/src/lib/bestCopy.ts`: `compareCopies`, `isOtherVersion` (con más de 2 s
  de diferencia usa `PairFacts.versionCorrelation`, la búsqueda ancha; correlación ≥ 0.5 = mismo
  master; más allá de `beyondVersionReach` deciden las duraciones), `isSameAudio` (veredicto `same`,
  exige ±2 s y no cambia).
- `apps/desktop/src/renderer/src/lib/libraryVerdict.ts`: `verdictState` mapea `tie`+`sameMaster`
  a `'tie'` (Alike) y `tie` sin él a `'even'` (Same quality).
- `apps/desktop/src/renderer/src/components/LibrarySection.tsx`: `STATE` (etiqueta y estilo por
  veredicto). Locales en `renderer/src/i18n/locales/*.json` (`editor.libraryStateTie`).
- `apps/desktop/src/renderer/src/lib/libraryCopy.ts`: `lengthsMatch`, `copyPathIn`, `fillCopyPath`,
  `isAnotherVersion`, `versionCopyPath`, `versionCopyIn`. Hoy todas cortan por duración
  (`VERSION_GAP_SEC`) aunque el audio confirme el mismo master: eso es lo que cambia.
- `components/Editor.tsx`: `copyRows` (copias DJ con veredicto y duración) y `musicCopy` (copia de
  Music con el veredicto de su fila). `lib/duplicateRanks.ts` también usa `'tie'`: revisar si le
  afecta.

## Task 1: El mismo master confirmado por el audio cuenta como copia aunque la duración difiera

Una copia cuenta como la misma grabación si su veredicto cuenta como copia (`countsAsCopy`) y además
o bien las duraciones están a ≤ 2 s (como hoy), o bien la comparación confirmó el mismo master a
través de la diferencia de duración: la búsqueda ancha se hizo (`versionCorrelation` no nulo), dio
≥ `OTHER_VERSION.maxCorrelation` y los dos ficheros eran sondeables (los mismos requisitos que
`isOtherVersion` usa para decir lo contrario). Sin esa confirmación (búsqueda no hecha o fallida,
veredicto `unmeasurable`, duraciones desconocidas) se queda la regla de hoy. `different` nunca cuenta.
`isAnotherVersion` debe ser su complemento coherente: otra versión es `different`, o una copia que
cuenta con duraciones a más de 2 s SIN esa confirmación.

Hace falta que el veredicto lleve esa confirmación hasta las filas (DJ y Music): por ejemplo una
marca opcional en `CopyVerdict` que ponga `compareCopies` y que las filas copien. Elegir la forma más
pequeña y clara; no duplicar la lógica de `isOtherVersion`.

Tests (TDD, rojo primero) en `bestCopy.test.ts`, `libraryCopy.test.ts` y un caso de integración en
`Editor.test.tsx`: copia rekordbox 7:06 contra fichero 7:01 con el mismo master confirmado → rellena
el álbum (todos los vacíos) y el campo de playlists actúa sobre la copia; misma diferencia sin
confirmación → sigue como otra versión.

## Task 2: «Alike» se muestra como «It's the same»

`tie` con `sameMaster` se muestra con la etiqueta y el estilo de `same`. Quitar la clave
`libraryStateTie` de los 8 locales si deja de usarse (norma: código sin uso se borra). No cambiar el
veredicto interno si otras partes dependen de distinguirlos (Update/Replace, `duplicateRanks`,
filtros): revisar y decidir lo más simple que no cambie otras conductas. Tests que digan por qué.

## Normas

- Worktree `/Users/vicent/code/surco-mismo-master`, rama `mismo-master`. Trabajar SOLO ahí, comandos
  desde `apps/desktop`.
- TDD con rojo visto. Selectores `data-testid`, nunca clases CSS. Comentarios solo para explicar
  por qué (norma de Surco).
- Commit por tarea, título descriptivo en inglés sin prefijo ni cuerpo.
- Antes de cada commit: `npx biome format --write <ficheros>`, `npm run lint` entero,
  `npx tsc --build`, y los tests de los ficheros tocados más `src/renderer/src/components/Editor.test.tsx`.
- Si una aserción existente deja de valer, listarla con lo que la app deja de hacer.
