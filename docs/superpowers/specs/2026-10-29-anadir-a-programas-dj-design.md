# Añadir a rekordbox, Traktor y Engine DJ al convertir

Estado: **planteamiento aceptado en conversación con Vicent (29/10)**, pendiente de revisar esta
spec y de cerrar las preguntas abiertas del final.

## El caso

Hoy, de los tres programas de DJ, solo Engine DJ puede ser el sitio "al que va" una pista
convertida, y lo es como un radio más del destino, al lado de Carpeta de salida, Apple Music,
Junto al original y Editar el original. Quien pincha con rekordbox o Traktor no tiene esa
opción. La pregunta de partida fue: ¿deberían ser un destino más?

No, porque el radio mezcla dos preguntas distintas:

- **Dónde queda el fichero.** Carpeta de salida, Junto al original, Editar el original y Apple
  Music (que se queda el fichero en su carpeta Media, sin copia en la de salida).
- **Qué programas se enteran.** rekordbox, Traktor y Engine DJ.

Engine DJ ya lo demuestra: su texto dice "el archivo se queda en la carpeta de salida". Es
"Carpeta de salida + registrar en Engine" presentado como un destino. Con más radios:

- Quien usa rekordbox y Traktor a la vez no puede elegir los dos.
- Combinaciones válidas, como "Junto al original + rekordbox", quedan prohibidas sin motivo.

### Los usuarios "sin carpeta"

Hay DJs que no organizan carpetas: arrastran la pista directamente al programa. Pero rekordbox,
Traktor y Engine DJ (en el ordenador) **no copian el fichero**, solo apuntan a su ruta. La pista
vive donde la soltaron, normalmente en Descargas, y si la borran el programa la marca como
perdida. La excepción es Apple Music, que sí copia a su carpeta Media.

Así que para estos usuarios la carpeta existe aunque no lo sepan. Surco tiene que guardar el
fichero en algún sitio, y lo hace en la carpeta de salida por defecto, `~/Music/Surco`
(`settings.ts`, `outputDir`), que ya es una carpeta gestionada como la de Apple Music. Basta con
que la interfaz deje de hacerles pensar en ella.

## Decisiones

1. **El radio de destino solo responde "dónde queda el fichero":** Carpeta de salida, Apple
   Music, Junto al original y Editar el original. Engine DJ sale del radio.
2. **Apple Music se queda en el radio.** En la conversación propuse moverlo a los controles de programas, pero
   no encaja: Apple Music es una ubicación (se queda el fichero) y no un programa que solo apunta.
   Con Apple Music elegido, rekordbox y Traktor apuntan al fichero que hay dentro de Music/Media,
   la misma ruta que rekordbox ve hoy al leer la biblioteca de Music. Engine DJ registra la copia
   de la carpeta de salida que Surco conserva mientras Engine está activado.
3. **Debajo del radio, un control por programa** (los mismos que hoy muestran su sección en
   Ajustes). Se pueden activar varios a la vez.
4. **Cada control sustituye al interruptor "Actualizar la colección de X al convertir"**. Es un
   control segmentado de tres estados (una casilla no puede tener tres):
   - *No tocar*: Surco no escribe en ese programa.
   - *Actualizar las que ya están*: lo que hacen hoy `syncRekordbox`, `syncTraktor` y
     `syncEngineDj` (reapuntar y volcar datos de las pistas que ya están en la colección).
   - *Actualizar y añadir las nuevas*: además, da de alta en la colección las que no están.
5. **El texto principal es el programa y la carpeta pasa a ser un detalle**: "Los archivos se
   guardan en Música › Surco · Cambiar". Quien no toca nada acaba con `~/Music/Surco` y los
   programas apuntando ahí.
6. **El botón de convertir nombra los programas a los que llega**, igual que hoy nombra Engine DJ
   (2a11498ae).
7. **Las playlists son solo el campo por pista** que ya existe para los tres programas
   (`rekordboxPlaylists`, `traktorPlaylists`, `enginePlaylists`). Rellenar el campo sigue
   bastando para que la pista llegue a esas playlists, como fija la spec de rekordbox del 18/10
   (decisión 3). La playlist fija de Engine (`engineDjPlaylist`) se retira: tenía sentido
   cuando Surco no sabía crear playlists, y ahora se crean desde el árbol de cada programa
   (Vicent, 29/10).
8. **Con rekordbox o Traktor abiertos, las altas esperan en la cola de cada programa**
   (`libraryFlushes.ts`). Engine DJ también: con Engine cerrado registra la pista durante la
   conversión (con la carátula ya procesada); con Engine abierto no pregunta ni falla, sino que
   deja el alta en su cola y la aplica al cerrarlo (enmienda del 29/10, segunda tanda).

## Qué hay ya y qué falta

| Programa | Actualizar las que ya están | Añadir las nuevas |
|---|---|---|
| Engine DJ | `syncEngineDj` | Hecho: `addToEngineLibrary` (`engineLibrary.ts`), activado hoy por el destino `engineDj` (`addToEngineDj`), y también desde el campo Playlists (c3f0296fa) |
| rekordbox | `syncRekordbox` | Solo desde el campo Playlists: `planTrack` (`rekordboxPlaylistWrite.ts`) no da de alta una pista sin playlists |
| Traktor | `syncTraktor` | Solo desde el campo Playlists: `withCollectionEntry` (`traktorPlaylistEdit.ts`, 30c62ab60, 28/10). **Sin probar en Traktor real** |

Lo que falta es poder dar de alta **sin elegir playlist** en rekordbox y Traktor, quitar Engine
del radio y reorganizar Ajustes y el botón.

### Decisión anterior ya revertida

La spec de playlists de Traktor (26/10) ponía como no objetivo dar de alta pistas nuevas. Vicent
lo revocó el 28/10 por la noche para los tres programas (30c62ab60), y lo vuelve a confirmar el
29/10.

## Prueba en Traktor real

El alta en Traktor (`withCollectionEntry`) está en main sin haberse probado en Traktor real. Antes
de publicar, sobre una copia de `collection.nml`: convertir un AIFF, un MP3 y un FLAC con Traktor
en *Actualizar y añadir* y sin playlist, abrir Traktor y comprobar que las pistas aparecen, se
analizan, y que Traktor no pierde las entradas al salir. Termina con Vicent comprobándolo.

## Migración

- `addToEngineDj: true` pasa a destino Carpeta de salida + Engine DJ en *Actualizar y añadir*.
- `syncX: true` pasa a *Actualizar las que ya están*; `false`, a *No tocar*.
- `engineDjPlaylist` desaparece de los ajustes, con su campo en `EngineLibraryFields` y sus
  textos. Las pistas ya metidas en esa playlist de Engine se quedan donde están.
- El tipo `Destination` (`lib/destination.ts`) pierde `'engineDj'`. Hay que tocar `toDestination`
  y `fromDestination` y sus consumidores: Ajustes (`DestinationTab`), el asistente
  (`OnboardingWizard`), el menú del botón (`Editor`) y `useTrackProcessing`.

## Fuera de esta spec

- Exportar a USB (spec del 16/10).
- Serato.
- Encolar las altas de Engine DJ mientras Engine está abierto, como ya hacen rekordbox y
  Traktor (pendiente para después).

## Preguntas cerradas

1. **Alta de pistas nuevas en Traktor: sí** (Vicent, 29/10). Revierte el no objetivo de la spec
   de playlists de Traktor del 26/10.

## Antecedente

El 23/09 ya se separó "dónde guardar" de "con qué pinchas" (plan "Surco simple", fase 5:
`DjSoftwarePicker`, `LocationPicker`), y el mismo día ada162911 lo devolvió al radio. Ni el
commit ni las conversaciones guardadas dicen por qué. Vicent no lo recuerda; su hipótesis es que
entonces Surco no soportaba todos los programas (29/10). Al prototipar, conviene revisar ese
diff (`DjSoftwarePicker.tsx`, `LocationPicker.tsx`) por si hubo otro motivo.
