# Playlist al instante

Fecha: 19/10/2026. Rama `worktree-fuentes-dj-playlists`.

## Para qué

Abrir una playlist de rekordbox en Surco tiene que ser inmediato. Vicent: "la velocidad es clave para que sea killer esta feature" y "inusable, más de 15 segundos en abrir el playlist". Además, todas las listas usan una misma fila: "mismo componente para todo", la de Pistas.

## Medido (19/10, driver sobre la copia `rb-b`, audio en el NAS por SMB, caché vacía)

| Playlist | Salen las filas | Filas con título/artista/carátula | Main bloqueado |
|---|---|---|---|
| MDT (33) | 0,4 s | 6,1 s | 2,7 s en total |
| All (999) | 6,1 s | 133,5 s | 113 s en total, 59 s seguidos |

- La consulta a `master.db` con todos los datos de la fila cuesta 13,7 ms para 1001 temas. Cada IPC a rekordbox paga además unos 80 ms abriendo la base (derivación de clave de SQLCipher), cinco veces por apertura.
- El límite de 6 lecturas no se aplicaba al abrir una playlist: 985 lecturas a la vez. Ya está arreglado (commit "Hold the six-read cap across imports…"); con eso las filas se van llenando poco a poco, pero 999 temas siguen costando unos 93 s, porque el NAS se satura a 6 lecturas en paralelo.
- TagLib corre síncrono en el proceso main (`tags.ts`), 30 a 46 ms por fichero: es lo que congela la app.
- Al navegar sobran la miniatura por ffmpeg y `ffmetadata`, que con TagLib son la mitad del coste por fichero.
- El emparejado automático lanzó 58 búsquedas a Discogs y MusicBrainz durante la apertura de All.

## Decisiones de Vicent

1. La fila de una playlist de rekordbox es la misma que la de Pistas. Fuera los puntitos de playlists (ya quitados) y los cuadraditos de cues.
2. La fila nueva es la variante B del boceto "Filas con onda": título y artista en la primera línea con duración y formato a la derecha, y debajo una mini onda a todo el ancho con las hot cues (cuadradito con su letra) y las memory cues (triángulo). Alto de fila unos 68 px. Vale para todas las listas.
3. La onda de una pista que está en rekordbox sale de su análisis (PWAV del `.DAT`). Una pista que no está en rekordbox usa la onda que ya haya calculado Surco; si no hay ninguna, la fila va sin onda. Nunca se calcula una onda solo para la lista.
4. Colores de Surco: la onda en el acento, las hot cues en el azul de botón, las memory cues en un tono cálido. Nada de los hex de rekordbox.

## Diseño

### 1. Una sola lectura de rekordbox por apertura

Un IPC nuevo devuelve, en una sola apertura de `master.db`, todo lo que la lista necesita para pintar la playlist:

- Lo que ya da `readRekordboxPlaylist` (ids, ruta, separadores, BPM, valoración, tonalidad).
- Para cada tema: título, artista, álbum, género, duración (`Length`), tipo de fichero, `ImagePath` y la ruta de su `.DAT`.
- Las cues de cada tema (hot cues con su número y memory cues, con su posición en ms), de `djmdCue`.

Sustituye a las cinco aperturas sueltas de hoy en la apertura de una playlist (`playlist`, `hasSeparator`, `membership`, `cueSummary` y la del árbol, que solo se relee al volver el foco). La base se sigue abriendo en solo lectura y se cierra al terminar, como hoy: rekordbox puede estar abierto.

### 2. La fila nace con los datos de rekordbox

Al abrir una playlist, cada tema que no está ya en la lista entra como fila con lo que trae rekordbox: título, artista, duración, formato y carátula. La fila se ve completa desde el primer pintado, sin esqueleto y sin esperar al NAS.

- Esos datos son una vista previa, no los metadatos de la pista. No entran en `meta` ni en las firmas (`diskSignature`, `processedSignature`), así que nunca cuentan como un cambio que guardar o convertir.
- Cuando llega la lectura del fichero, la fila muestra las etiquetas del fichero, como cualquier fila de Pistas. Si difieren de rekordbox, el texto cambia en ese momento: es lo correcto, porque Surco edita el fichero.
- Lo que necesita el fichero espera a su lectura, como hoy: editar, convertir, actualizar etiquetas, la píldora de calidad, el emparejado.
- La carátula sale de `ImagePath` dentro de la carpeta `share` de rekordbox (`rekordboxShareDir`), en su tamaño `_m`, servida por el protocolo de medios con la misma lista de permitidos que las demás.
- El `stat` previo de `expandPaths` deja de retrasar la primera fila: la fila se pinta antes y la comprobación de "no está en disco" llega después, con el aviso de hoy.

### 3. Lectura de ficheros por detrás

- Las lecturas de una apertura van por la cola global de 6 que ya existe (`readSlot`), y primero las de las filas visibles y la seleccionada. Una fila que entra en pantalla adelanta su lectura.
- TagLib sale del hilo principal del main: corre en el worker que ya existe (`runInWorker`). El main deja de congelarse.
- Al leer para la lista no se genera la miniatura por ffmpeg ni se vuelca `ffmetadata`; esos dos pasos se hacen al seleccionar la pista o cuando se necesitan para convertir.
- El emparejado automático no compite con la cola: empieza cuando la cola de lecturas de esa apertura se vacía.

### 4. La fila B

- Un solo componente de fila para Pistas, playlists de Music, playlists de rekordbox y, más adelante, las sesiones del USB.
- La onda se pinta con la vista previa de 400 columnas de rekordbox (`wavePreview` en `anlz.ts`, ya existe) o con la onda que Surco tenga en su caché de análisis. Se pide solo para las filas visibles y se guarda en memoria.
- Las cues se dibujan encima: hot cue = cuadradito con su letra, memory cue = triángulo. Sustituyen a los cuadraditos de colores (`CueSwatches`) y a su consulta.
- Sin onda: la segunda línea queda vacía, a la misma altura, para que la lista no salte.

## Fuera de alcance

- El historial de los CDJ en el USB (va en su propio diseño; el formato ya está medido en la memoria `historial-cdj-onelibrary`).
- Cambiar cómo se leen las etiquetas fuera de la apertura de playlists (arrastrar una carpeta sigue igual, salvo que también se beneficia de la cola global y de TagLib en el worker).

## Cómo sabremos que está

Medido con el mismo método que el 19/10 (driver, copia `rb-b`, caché vacía, NAS):

- All (999): todas las filas con título, artista, duración y carátula en menos de 0,5 s desde el clic. MDT (33): menos de 0,3 s.
- El main nunca bloqueado más de 200 ms seguidos durante la apertura.
- La pista seleccionada responde en el editor en menos de 10 s con la caché fría.
- Ninguna fila abierta desde rekordbox aparece como modificada sin que el usuario haya tocado nada.

## Riesgos y comprobaciones previas

- Carátulas, comprobado el 19/10 sobre una copia de `share/PIONEER/Artwork` (166 MB, copiada con rekordbox cerrado a `rb-b/share`): existen 992 de 1001 en All y 2051 de 2061 en la colección, con sus tamaños `_m` y `_s`. Un tema sin fichero de carátula muestra la del audio cuando llega su lectura.
- Análisis, comprobado igual sobre una copia de `share/PIONEER/USBANLZ` (749 MB): los 1001 temas de All tienen `.DAT` con PWAV, 9 MB en total, y leerlos todos cuesta 98 ms. La onda puede ir en la misma respuesta que la playlist o pedirse por filas visibles; el plan elige por medida.
- Un tema sin análisis en rekordbox no tiene `.DAT`: va sin onda, como una pista que no está en rekordbox.
- Abrir de nuevo una playlist tras editarla en rekordbox debe refrescar la vista previa, igual que hoy refresca las entradas al volver el foco.
