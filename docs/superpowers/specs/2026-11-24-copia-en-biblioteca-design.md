# Cuando la pista ya está en tu biblioteca

Boceto aprobado: https://claude.ai/artifact/TXFs2Gypvxc5qV1TgSTVjf (versión 4).

## Por qué

Vicent abre en Surco una pista (por ejemplo un FLAC) y «In your library» le dice que ya la tiene en rekordbox (un AIFF). Hoy, para meter esa copia en una playlist, cambia a rekordbox, la busca y la arrastra. Quiere hacerlo sin salir de Surco. Y, ya que Surco ha encontrado la copia, quiere que el formulario se rellene con lo que ella tiene y decidir con un clic si sustituye la copia por el archivo nuevo o solo le actualiza las etiquetas.

Vicent solo usa rekordbox, pero otros usuarios usan Traktor, Serato, Engine DJ o VirtualDJ. Todo vale igual para los cinco.

## Qué se construye

Tres entregas, en este orden. Cada una se puede mergear y probar sola.

### 1. Playlists sobre la copia

El campo «<programa> · Add to a playlist» (`PlaylistsField`, uno por programa) cambia de objetivo cuando ese programa tiene una copia de la pista, es decir, cuando hay una fila en «In your library» que no es «Another version» ni «It's this file».

- Muestra las playlists en las que ya está la copia (no el archivo abierto).
- Marcar una playlist añade la copia a esa playlist al momento, sin esperar a Replace ni a Update. Desmarcar la quita. Por debajo es `window.api.dj.editPlaylist(programa, { kind: 'add' | 'remove', … })`, lo mismo que usa el árbol de playlists de la barra lateral.
- Cada cambio saca el aviso de siempre abajo a la izquierda, con Undo. No se pide confirmación (norma «confirmar solo lo irreversible»).
- Crear una playlist nueva desde el campo la crea en ese momento con la copia dentro (`kind: 'create'` con `tracks`).
- Sin copia en ese programa, el campo funciona como hoy: la playlist queda apuntada (chip discontinuo) y la aplica la conversión al archivo que escribe.
- Con varias copias en el programa, se usa la que Surco compara en la sección.
- Varias pistas seleccionadas: el mismo campo (`PlaylistsBulkField`) aplica la regla pista a pista. Las que tienen copia entran al momento, el resto queda apuntado (norma «single y multi homogéneos»).

### 2. Rellenar el formulario con la copia

Cuando un programa DJ tiene una copia de la misma grabación (veredicto distinto de «Another version», «Can't be read» y «It's this file»), los campos vacíos se rellenan con las etiquetas de esa copia, y la carátula si la pista no tiene y no se quitó a mano.

- Es la regla aprobada el 22/11 para sustituir en Apple Music (`fillFromCopy`, `useReplacedCopyFill`), ampliada a las copias de los programas DJ. Solo lo vacío; lo que trae el archivo o lo aplicado de Discogs no se pisa. Sin marca ni texto. ⌘Z lo deshace. Una vez por pista (`copyFilled`), nunca tras Clear all.
- Si hay copia en Apple Music y en un programa DJ, manda la que ya usa hoy la sustitución de Apple Music; si no la hay, la primera copia DJ en el orden de la sección.
- Las playlists no se rellenan con esto. Las lleva la entrega 1.

### 3. Replace o Update en el botón partido

Mejorar o no es decisión del usuario. El veredicto informa, no elige. Cuando hay copia, el botón ofrece siempre las dos acciones, esté la copia en Apple Music o en un programa DJ, y sea mejor, igual o peor.

- El cuerpo del botón muestra la última acción elegida en el menú, recordada entre pistas y entre sesiones como ajuste opcional (`libraryCopyAction: 'update' | 'replace'`, por defecto `'update'`, que no toca el audio).
- Si la acción es Replace y la copia es mejor, el cuerpo dice «Replace anyway», como hoy. Es un aviso, no cambia la acción.
- Mientras compara, el cuerpo ya muestra la acción recordada, así que no cambia de texto al llegar el veredicto.
- Sin copia, «Another version», «Can't be read» o «Not found»: como hoy (Convert / Add).
- **Cambio de conducta en Apple Music.** Hoy, con copia en Music, el cuerpo propone Replace de entrada. Con esto propone Update hasta que el usuario elija Replace una vez. Cambian los tests de `exportLabel` que fijan Replace con copia de Music; Vicent lo aprobó el 24/11.

- **Replace** convierte el archivo abierto y ocupa el sitio de la copia (`replacesPath`). Los programas ya siguen la sustitución (cues, playlists, estrellas; trabajo de «To review»). Hoy Replace solo sale cuando la copia está en Apple Music (`replaceBeforeConvert.ts`). Hay que ofrecerlo también cuando la copia solo está en un programa DJ.
- **Update** escribe las etiquetas y la carátula del formulario en el archivo de la copia y en los programas que la tienen, como hace hoy «Update» al editar el original. No renombra la copia. El audio de la copia no se toca y el archivo abierto se queda como está. Si la copia está también en Apple Music, se actualiza allí igual. Hoy `processTrack` solo escribe sobre `job.inputPath`, así que hace falta un trabajo cuya entrada sea la copia; cómo se monta es del constructor.
- El desplegable que ya existe añade arriba un grupo con el programa y la copia, y las dos acciones, cada una con una línea gris debajo:

```
rekordbox · AIFF 16/44.1
✓ Update
  Keeps its audio
  Replace
  With this file
───────────
Format
✓ AIFF   FLAC   WAV
```

- El formato solo cuenta al sustituir. Con Update se mantiene el de la copia.
- Elegir en el menú ejecuta esa acción y la deja como cuerpo del botón (recordada, ver arriba).
- Textos nuevos en los 8 idiomas con tuteo, sin dos puntos ni guion largo. El cuerpo del botón reserva el ancho de la etiqueta más larga (norma «sin cambios de tamaño»); medir en los 8 idiomas al ancho real.
- Varias pistas: mismo botón y mismo menú, la acción elegida se aplica a cada pista que tiene copia y el resto se convierte como hoy. Hoy Replace se apaga con varias pistas (`ConvertFooter.tsx`, `replaces={!isMulti && replaces}`), también para Music; hay que encenderlo. Es la parte más delicada y puede ir como tarea final separable.

## Decisiones tomadas tras la revisión

Decididas por Claude, Vicent puede corregirlas:

- **Qué cuenta como copia.** Para playlists, autorrelleno y botón cuentan las filas con veredicto «It's the same», «Neither is better», «Alike», «The new one is better», «The new one is worse», «Can't be measured» y «Comparing». No cuentan «Another version», «Can't be read», «Not found» ni «It's this file».
- **Undo de playlists.** Las ediciones de playlist de la barra lateral hoy no tienen Undo (`useRekordboxEdits.ts` solo avisa). Hay que construirlo con el deshacer de la app (`reportUndo`). Quitar exige el `linkId` de la copia en esa playlist, que se lee de las entradas de la playlist.
- **Engine DJ no permite quitar de una playlist** (`sourcePrograms.ts`, solo create/add/delete). Ahí las playlists donde ya está la copia salen marcadas y no se pueden desmarcar, y añadir va sin Undo y sin confirmación (se quita desde Engine).
- **Una copia por programa.** `useProgramCopies` ya devuelve como mucho una por programa.

## Qué no

- La copia nunca manda sobre las etiquetas del archivo abierto.
- No hay playlists de Apple Music en el campo (no existe ese campo para Music).
- No se toca la biblioteca real de rekordbox en pruebas: solo una copia de master.db fuera de su carpeta.

## Enfoques considerados

- **Playlists, A (elegido).** El campo de playlists actúa sobre la copia al momento. No añade controles y ya existe para los cinco programas.
- **Playlists, B.** Botón ＋ en cada fila de «In your library». Descartado: otro control, dos sitios para lo mismo con reglas distintas, y con varias pistas la sección no existe.
- **Botón, «Update tags» / «Update tags and audio».** Descartado: Replace también escribe etiquetas, así que nombrarlas confunde, y obligaba a cambiar los textos de Apple Music.
- **Botón, «Replace» / «Update» con línea gris en el menú (elegido).** Una palabra en el botón; lo que los distingue, el audio, se dice una vez en el menú. «Update» ya significa «solo etiquetas» en Surco.

## Para quien lo construya

- El orden de las entregas, el reparto en tareas y los tests son suyos.
- Probar cada entrega en la app empaquetada (rekordbox sobre copia de master.db, Traktor/Engine/Serato/VirtualDJ libres) antes de mergear.
- Sin reanálisis: ningún namespace de caché nuevo.
