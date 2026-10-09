# Revisar metadatos de la lista

## Problema

La revisión de Apple Music encuentra grafías distintas de lo mismo y duplicados, pero solo
dentro de Music. Quien trabaja con carpetas (un NAS con `Hard House`, una carpeta de
descargas, la colección de rekordbox que nunca pasó por Music) tiene el mismo desorden y no
tiene dónde verlo. Esas pistas ya están en la lista de Surco con sus etiquetas leídas, así
que la revisión puede correr sobre ellas sin leer nada más.

## Qué se entrega

La misma vista de revisión (grafías y duplicados, misma columna, mismo detalle, mismo botón
partido y misma hoja de confirmación), con las pistas cargadas en la lista como fuente en vez
de la biblioteca de Music. El boceto aprobado es `revision-carpetas.html`.

- **Grafías**: mismas reglas, mismos tipos y misma grafía por defecto que en Music. Arreglar
  escribe el fichero, lo lleva a rekordbox, Engine DJ y Traktor como hace la revisión de
  Music, y si el mismo fichero está en Apple Music (solo macOS) corrige también su entrada.
  Las filas de la lista pasan a mostrar el valor nuevo.
- **Duplicados**: misma regla de grabación y duración. Cada copia enseña formato, calidad
  (el veredicto que Surco ya tiene de esa fila, o "sin analizar"), tamaño, álbum, duración,
  fichero y dónde está en las bibliotecas DJ y en Apple Music. Quitar una copia la saca de las
  bibliotecas, de Music si está, manda su fichero a la Papelera y quita su fila de la lista.

Queda fuera lo mismo que en Music: campos vacíos, búsqueda en proveedores, carátulas y
géneros con varios valores. Tampoco se renombran ficheros en el disco.

## Medido antes de planificar (08/10/2026)

- Agrupar 5000 pistas sintéticas con 2000 artistas distintos de 8 a 16 letras tarda
  **1,45 s** con el código actual en este Mac. Casi todo es la distancia de edición completa
  que se calcula para cada par de nombres de longitud parecida, y la expresión regular que
  saca los dígitos de los dos nombres en cada par. Con una comprobación lineal de "a una
  edición o menos" (la misma regla, Damerau incluido) y los dígitos calculados una vez por
  nombre baja a **0,14 s** con los mismos 121 grupos y los 27 tests de `musicSpelling` en
  verde. Los duplicados ya tardan 5 ms.
- La lectura de ubicaciones de Music en bloque (`location of every track`) está medida en
  1,39 s para 400 pistas junto con otros nueve campos (`appleMusicPlaylists.ts`). No está
  medida sobre una biblioteca entera.

## Decisiones

- **Entrada**: "Revisar metadatos de la lista…" en el menú Pistas y en ⌘K, en todas las
  plataformas, activa cuando la lista tiene pistas. Abre la misma vista en la columna de la
  lista y al cerrar la lista vuelve tal cual. Las dos entradas de Apple Music no cambian.
- **Fuente**: las etiquetas que la lista ya leyó de cada fila. Nada de AppleScript para leer
  la lista. Las filas cuya lectura falló o aún no terminó se quedan fuera, y la vista dice
  cuántas.
- **La guarda es el fichero**: se escribe solo si el fichero sigue diciendo lo que se leyó.
- **Un motor y una vista**: lo que difiere entre Music y la lista (de dónde salen las pistas,
  cómo se escribe, cómo se quita una copia y los textos que cambian) vive en una fuente. Las
  entradas llevan un `id` que es la ruta en la lista y el persistent ID en Music.
- **Arreglar una grafía**: la escritura mínima por TagLib que ya existe, con copia de
  seguridad y Deshacer. Después rekordbox, Engine DJ y Traktor como en la revisión de Music.
  Si el fichero está en Apple Music, su entrada se corrige con guarda.
- **Quitar un duplicado**, en este orden: sus sitios en las playlists de rekordbox, Engine DJ
  y Traktor pasan a la copia que se queda; si está en Apple Music, sus playlists normales
  pasan a la que se queda y sale de Music; su fichero va a la Papelera; su fila sale de la
  lista. Nunca se tira un fichero que una biblioteca aún usa ni cuando la copia que se queda
  es el mismo fichero. Los duplicados quitados no se deshacen desde Surco.
- **Ignorar es para siempre**, guardado aparte de lo ignorado en Music.
- **Deshacer** restaura las copias de seguridad, las bibliotecas DJ y Music, como ya hace.
- **Coste**: agrupar sigue siendo rápido con 5000 pistas cargadas, y un test lo fija.
- **Textos** en las cinco lenguas, castellano llano, sin guion largo ni dos puntos de
  explicación.

## Decisiones tomadas al planificar

- **Los valores salen de la instantánea del disco, no de lo editado.** Cada fila guarda en
  `diskSignature` la lectura pura del fichero, y `meta` lleva además lo que el usuario haya
  tecleado sin convertir. La revisión lee la instantánea: revisa lo que hay en el disco, que
  es lo que va a escribir. Tras aplicar, `withReviewedFields` mueve la instantánea y solo toca
  en `meta` los campos que aún decían el valor viejo, así que una edición pendiente sobrevive.
- **Esa instantánea no es exactamente la etiqueta.** Título y artista caen al nombre del
  fichero cuando la etiqueta está vacía, y la importación desde Music rellena huecos con lo que
  sabe Music. Un grupo puede mostrar un valor que el fichero no tiene. No se escribe nada malo
  por ello, porque la guarda del fichero responde `unchanged`, y la hoja final lo cuenta como
  "ya no decía lo que se leyó". Se acepta antes que volver a leer 5000 ficheros del NAS.
- **Orden de escritura, fichero primero.** En Music la guarda era Music y el fichero iba
  después. Aquí la guarda es el fichero: Music solo se toca en los campos que llegaron al
  fichero, con la guarda de siempre (`considering case, diacriticals…`) contra el valor leído
  del fichero. Si Music dice otra cosa se deja como está y se cuenta.
- **Cómo se sabe si un fichero está en Music.** Un solo `osascript` al abrir la revisión lee
  persistent ID, ubicación, artista y nombre de cada pista con fichero, en bloque como el
  import de playlists, y se cruza con las rutas de la lista por igualdad exacta en NFC. Es lo
  más barato que no se equivoca: el índice de la biblioteca que ya existe empareja por
  título, artista y duración, justo los valores que la revisión corrige, y solo existe cuando
  el destino es Music. `updateInAppleMusic` no sirve aquí porque necesita el persistent ID que
  se está buscando.
- **Music no se abre por sorpresa.** Esa consulta solo se hace si Music ya está abierta, si
  "Añadir a Apple Music" está activo o si alguna fila llegó desde Music o fue añadida por
  Surco. Si no, la vista dice que Apple Music no se ha consultado, y la revisión trata los
  ficheros como si no estuvieran en Music.
- **Una ruta con dos o más entradas de Music es ambigua.** No se corrige ninguna de esas
  entradas y, si es una copia que se quita, su fichero se queda en el disco: borrar una entrada
  al azar podría llevarse playlists que el usuario quería conservar.
- **Copia quitada en Music y la que se queda fuera de Music**: no se toca Music y el fichero
  se queda, porque sus playlists de Music no tendrían adónde ir. La hoja lo dice.
- **La Papelera es la recuperable de Surco.** Un volumen sin Papelera (un NAS) borra al
  instante con `shell.trashItem`; la lista usa la misma regla que `shell:trash`, que en ese
  caso guarda el fichero en Copias de seguridad. Se extrae a una función y `shell:trash` la
  reutiliza sin cambiar.
- **Mismo fichero real** (dos rutas a un fichero, enlace simbólico): no se toca nada y la fila
  se queda. Una fila solo sale de la lista cuando su fichero llegó a la Papelera.
- **Ignorados en `listReviewIgnored`, local, separado de `musicReviewIgnored`.** Las claves de
  duplicado llevan rutas en una y persistent IDs en la otra, y compartirlas haría que ignorar
  algo en una fuente lo escondiera en la otra sin que el usuario lo haya visto allí. Entra en
  `LOCAL_KEYS` desde el primer día, así que no hay migración que borre datos.
- **Plataformas.** `library:status` y `library:copyInfo` dejan de responder vacío fuera de
  macOS: solo leen, y la lista existe también en Windows. `library:replaceDuplicates` sigue
  igual porque es de la revisión de Music; la lista tiene su propio canal sin esa limitación.
- **La entrada se desactiva mientras corre una conversión**, que escribe los mismos ficheros y
  bases, y las filas en conversión no se revisan.
- **Copia que se queda por defecto**: la regla de formato de siempre y, en empate, el mejor
  veredicto de calidad ya medido (buena, dudosa, reprocesada, mala, sin analizar).
- **Calidad de cada copia**: la etiqueta del veredicto que ya enseña el editor ("Buena
  calidad", "Fuente con pérdidas"…) y el corte medido en kHz cuando hay rodilla. Sin análisis
  se dice "Sin analizar". Nada se calcula nuevo para la vista.
- **Nombres.** `useMusicReview`, `MusicReview*` y las claves `musicReview.*` se quedan como
  están para no renombrar media app; lo propio de la lista va en `lib/listReviewSource.ts` y
  en claves `listReview.*`.
- **Coste.** La distancia de edición completa se sustituye por la comprobación lineal medida
  arriba, con un test de equivalencia contra la distancia de referencia, y el agrupado deja de
  recalcularse al ignorar un grupo.
