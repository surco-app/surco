# Pruebas de la 1.0 con programas reales

Surco va a salir en versión 1.0 y lo que toca ahora es asegurarnos de que todo lo que hace, lo hace bien. Hay cosas que no podemos comprobar desde aquí porque no tenemos Traktor, ni Windows, ni vuestras bibliotecas. Esta lista es para eso.

## Antes de empezar

1. **Instala la beta.** En Surco: Ajustes → General → activa "Recibir versiones beta". Surco se actualizará a la 1.0.0-beta.0. Comprueba la versión en el menú Surco → Acerca de.
2. **Haz copia de tus colecciones antes de nada.** Surco hace su propia copia, pero no te fíes solo de eso:
   - Traktor: copia `collection.nml` (Mac: `Documentos/Native Instruments/Traktor x.x.x/`; Windows: `Documentos\Native Instruments\Traktor x.x.x\`). Copia también la carpeta `Coverart`.
   - rekordbox: cierra rekordbox y copia la carpeta entera (Mac: `~/Library/Pioneer/rekordbox/`; Windows: `%APPDATA%\Pioneer\rekordbox\`). Lo importante es `master.db`.
   - Engine DJ: copia la carpeta `Engine Library`.
3. **Cierra el programa de DJ antes de convertir**, salvo en las pruebas que digan lo contrario.
4. **Trabaja con copias de tus pistas**, no con las buenas. Crea una carpeta de pruebas y mete ahí lo que vayas a usar.
5. **Una prueba, un mensaje.** Si en una misma prueba ves dos cosas raras, cuéntalas por separado. Nos ayuda mucho saber qué hiciste, qué esperabas y qué salió.

**Qué es "la actividad"**: el botón Actividad de la barra de arriba. Tiene un botón "Copiar" que copia todo lo que ha pasado; pégalo en el mensaje.

**Qué es "el registro"**: Ajustes → General → Registro de errores → "Mostrar archivo". Adjunta ese archivo cuando algo falle.

**Quién hace qué**: djotas, Traktor y Windows (pruebas 1 a 10 y 19 a 22). artexjay, etiquetas y Apple Music (pruebas 15 a 18, 23 y 24). rekordbox y Engine DJ (11 a 14), quien los tenga.

---

## Traktor

Pon en Surco: Ajustes → Destino → "Actualizar la colección de Traktor al convertir" activado, y en `collection.nml` elige tu colección. Para las pruebas de cues, en "En Traktor, ¿dónde te caen los cues de una pista convertida?" deja "Donde los dejé", salvo que la prueba diga otra cosa.

Prepara una pista de cada formato (MP3, FLAC, AIFF, WAV) analizada en Traktor, con la rejilla bien puesta y al menos 3 hotcues repartidos por la pista.

### 1. Surco sabe cuándo Traktor está abierto (Mac y Windows)

- **Objetivo**: que Surco no escriba en la colección con Traktor abierto, y que no se bloquee cuando Traktor está cerrado.
- **Pasos**:
  1. Con Traktor abierto, convierte una pista que esté en tu colección.
  2. Si Surco ofrece cerrar Traktor, acepta. Mira si Traktor se cierra de verdad y si guarda al cerrar.
  3. Cierra Traktor del todo. Deja abiertos otros programas con "Traktor" en el nombre (TraktorCueGridInspector, Lexicon, lo que uses). Convierte otra pista.
  4. Abre una terminal y ejecuta, con Traktor abierto: Mac `pgrep -il traktor`; Windows `tasklist | findstr /i traktor`.
- **Qué debería pasar**: en el paso 1, Surco avisa o la actividad dice "Omitido: Traktor estaba abierto". En el paso 2, Traktor se cierra en pocos segundos. En el paso 3, la actividad dice "N pistas actualizadas en collection.nml".
- **Qué enviar**: la actividad copiada de cada paso, la salida del comando del paso 4, y en qué sistema lo hiciste.
- **Por qué importa**: si Surco escribe con Traktor abierto, Traktor lo borra todo al cerrar y no te enteras.

### 2. Cues y rejilla tras convertir, por formato

- **Objetivo**: que los hotcues y la rejilla caigan en el mismo golpe después de convertir.
- **Pasos**: convierte con Traktor cerrado cada una de estas parejas: MP3 → FLAC, MP3 → AIFF, FLAC → MP3, AIFF → MP3, WAV → FLAC, FLAC → WAV. Abre Traktor, carga cada pista convertida y compara cada hotcue y la rejilla con la original. Si tienes una pista con cues de otro programa (Mixed In Key, Lexicon, rekordbox), conviértela también.
- **Qué debería pasar**: todos los hotcues en el mismo golpe, la rejilla encima del beat, y nada desaparece. En ALAC se pierden y Surco lo avisa: es lo esperado.
- **Qué enviar**: una tabla con cada pareja y "bien / adelantado / atrasado / perdido", y cuántos milisegundos si lo sabes medir. Captura de Traktor de la que falle.
- **Por qué importa**: es lo primero que ve un DJ; un cue movido estropea una sesión.

### 3. Cues y rejilla con recorte de silencio

- **Objetivo**: que al recortar el silencio del principio, los cues y la rejilla se muevan con el audio.
- **Pasos**: usa una pista con silencio al principio (1 segundo o más). En el editor, abre "Recorte de silencio" y recorta el inicio. Convierte a MP3, a FLAC y a AIFF. Carga las tres en Traktor.
- **Qué debería pasar**: la pista empieza antes, pero cada hotcue y la rejilla siguen en su golpe. No tienes que arrastrar la rejilla.
- **Qué enviar**: cuánto recortó Surco (lo dice la sección), el formato, y captura de Traktor si algo no cuadra.
- **Por qué importa**: el recorte casi nunca es un número exacto de beats; si falla, la rejilla queda descuadrada entera.

### 4. El ajuste de ±51 ms de los cues

- **Objetivo**: confirmar que el ajuste automático deja los cues bien, y que las opciones "Entran pronto" y "Entran tarde" corrigen en la dirección correcta.
- **Pasos**:
  1. Con "Donde los dejé", convierte FLAC → MP3 y MP3 → FLAC. Mira en Traktor si los cues caen en el golpe.
  2. Elige "Entran pronto", convierte la misma pista otra vez y mira hacia dónde se mueven.
  3. Repite con "Entran tarde".
- **Qué debería pasar**: en el paso 1, en el golpe. "Entran pronto" debe arreglar cues que caen antes del golpe (los atrasa). "Entran tarde" lo contrario.
- **Qué enviar**: para cada paso, si el cue cae antes, en o después del golpe, y cuánto. Tu versión de Traktor.
- **Por qué importa**: los 51 ms salen de tus medidas en Traktor; necesitamos confirmar que con la 1.0 siguen dando en el clavo.

### 5. Original y convertido en la colección

- **Objetivo**: que la colección quede bien tanto si conservas el original como si lo sustituyes.
- **Pasos**:
  1. Destino "Carpeta de salida": convierte una FLAC que está en Traktor a MP3. Importa también el MP3 a Traktor. Abre y cierra Traktor.
  2. Destino "Sobrescribir el original": convierte otra FLAC que está en Traktor a MP3.
  3. En los dos casos, cambia la carátula de una y mira si cambia también la otra.
- **Qué debería pasar**: en el paso 1, dos pistas independientes, Traktor abre sin problemas, y cambiar la carátula de una no toca la otra. En el paso 2, la pista sigue en sus playlists y su historial, apuntando al MP3, sin "!" de fichero perdido.
- **Qué enviar**: la actividad copiada y, del `collection.nml`, los bloques `<ENTRY>` de esas pistas (búscalas por el nombre del fichero).
- **Por qué importa**: dos entradas con la misma identidad dejaban a Traktor sin abrir.

### 6. Hotcues que solo existen en Traktor

- **Objetivo**: que no se pierdan los hotcues que pusiste en Traktor y que no están guardados dentro del fichero.
- **Pasos**: en Traktor, añade 2 hotcues nuevos a una pista y cierra Traktor sin hacer nada más. Convierte esa pista con Surco. Abre Traktor.
- **Qué debería pasar**: la pista convertida tiene los hotcues de siempre más los 2 nuevos, en su sitio.
- **Qué enviar**: captura de los hotcues en Traktor antes y después, y el `<ENTRY>` de la pista antes y después.
- **Por qué importa**: son cues que solo viven en tu colección; si Surco los pisa, se pierden para siempre.

### 7. Estrellas

- **Objetivo**: que las estrellas que pones en Surco salgan en Traktor.
- **Pasos**: en Surco pon 5 estrellas a una pista que Traktor tiene con 2 (o ninguna) y conviértela. Repite con 1 estrella. Prueba también con una pista que nunca has valorado en Traktor.
- **Qué debería pasar**: Traktor muestra exactamente las estrellas que pusiste en Surco.
- **Qué enviar**: captura de la columna de estrellas en Traktor y el atributo `RANKING` del `<ENTRY>` de esas pistas.
- **Por qué importa**: la escala que usa la colección solo está comprobada en el fichero, no en un `collection.nml` real.

### 8. Carátula nueva en Traktor

- **Objetivo**: que Traktor pinte la carátula nueva después de cambiarla en Surco.
- **Pasos**: cambia la carátula de una pista que está en Traktor y conviértela. Abre Traktor y mira la carátula en la lista y en el deck.
- **Qué debería pasar**: sale la carátula nueva sin borrar nada a mano.
- **Qué enviar**: captura de Traktor, la ruta completa de tu carpeta `Coverart` (a veces está un nivel por encima del `collection.nml`), y la actividad.
- **Por qué importa**: Traktor pinta de su propia caché, no del fichero; es el "no sincroniza carátulas" que reprodujisteis en 5 máquinas.

### 9. Música fuera de un disco externo

- **Objetivo**: que la sincronización funcione con pistas en el disco interno, no solo en discos externos.
- **Pasos**: pon unas pistas en el disco interno (Mac: por ejemplo en `Música`; Windows: en `C:\` y, si tienes, en otra letra como `D:\`). Impórtalas en Traktor, ciérralo, y conviértelas con Surco.
- **Qué debería pasar**: la actividad dice "N pistas actualizadas en collection.nml", no "ninguna de estas pistas está en la colección".
- **Qué enviar**: la actividad copiada y la línea `<LOCATION ...>` de esas pistas en el `collection.nml`.
- **Por qué importa**: Traktor escribe la ruta de otra forma en el disco de arranque y eso no lo hemos visto nunca en una colección real.

### 10. "Mostrar las carátulas de los FLAC en el Finder" con Traktor (solo Mac)

- **Objetivo**: confirmar que el aviso de esta opción es correcto.
- **Pasos**: activa Ajustes → Carátula → "Mostrar las carátulas de los FLAC en el Finder". Convierte una MP3 a FLAC e importa la FLAC en Traktor. Abre y cierra Traktor. Desactiva la opción y repite con otra pista.
- **Qué debería pasar**: con la opción activa, Traktor rechaza la FLAC (y el texto de ayuda de Surco ya lo avisa). Con la opción apagada, la FLAC entra y se queda.
- **Qué enviar**: el número de `ENTRIES=` del `collection.nml` antes y después, y si la pista sigue en Traktor.
- **Por qué importa**: Traktor saca esas pistas de la colección al guardar, y con ellas sus playlists.

---

## rekordbox

Pon en Surco: Ajustes → Destino → "Actualizar la colección de rekordbox al convertir" activado. Cierra rekordbox antes de convertir.

### 11. Cambiar de formato sin perder playlists ni cues

- **Objetivo**: que al convertir, la pista de rekordbox pase a apuntar al fichero nuevo y conserve todo.
- **Pasos**: elige 3 pistas MP3 que estén en playlists de rekordbox, con hotcues y reproducciones. Convierte a WAV o AIFF con "Sobrescribir el original" y luego otras 3 con "Carpeta de salida". Abre rekordbox.
- **Qué debería pasar**: ninguna pista con el "!" de fichero perdido, siguen en sus playlists, conservan hotcues, rejilla y reproducciones, y rekordbox reproduce el fichero nuevo.
- **Qué enviar**: la actividad copiada ("N pistas reapuntadas al archivo nuevo"), captura de rekordbox, tu versión de rekordbox y el sistema.
- **Por qué importa**: es la razón de esta función: cambiar un MP3 por un WAV sin romper la colección.

### 12. Pistas ambiguas

- **Objetivo**: que Surco no reapunte una pista cuando no puede saber cuál es.
- **Pasos**: busca (o crea) un caso en que rekordbox tenga la misma canción dos veces: el mismo fichero importado desde dos rutas (por ejemplo a través de un alias o de un disco de red montado dos veces), o dos entradas del mismo fichero. Convierte esa pista.
- **Qué debería pasar**: la actividad dice "1 pista omitida" y rekordbox queda como estaba. Nada apunta a un fichero equivocado.
- **Qué enviar**: la actividad copiada y cómo llegaste a tener la pista duplicada.
- **Por qué importa**: reapuntar la entrada equivocada es peor que no hacer nada.

### 13. Colección abierta o bloqueada

- **Objetivo**: que Surco no toque la colección cuando no debe, y lo diga.
- **Pasos**:
  1. Con rekordbox abierto, convierte una pista suya.
  2. Con rekordbox cerrado, marca `master.db` como solo lectura (Mac: Obtener información → "Bloqueado"; Windows: Propiedades → "Solo lectura") y convierte otra. Después quítale la marca.
- **Qué debería pasar**: paso 1, "Omitido: rekordbox estaba abierto". Paso 2, "Omitido: la colección es de solo lectura". En los dos, rekordbox abre igual que antes.
- **Qué enviar**: la actividad copiada de cada paso.
- **Por qué importa**: un fallo aquí puede dejar la colección a medio escribir.

---

## Engine DJ

### 14. Convertir directo a la biblioteca y a una playlist

- **Objetivo**: que las pistas convertidas entren en Engine DJ y en la playlist elegida, sin duplicados.
- **Pasos**: Ajustes → Destino: elige "Engine DJ", tu "Biblioteca de Engine DJ" y una "Playlist". Con Engine DJ cerrado, convierte 3 pistas. Después convierte una de ellas otra vez. Por último, abre Engine DJ e intenta convertir otra.
- **Qué debería pasar**: las 3 pistas salen en la colección y en la playlist, con etiquetas y carátula. Reconvertir no crea una segunda entrada. Con Engine DJ abierto, Surco dice "Cierra Engine DJ antes de convertir".
- **Qué enviar**: captura de Engine DJ (colección y playlist), la actividad, tu versión de Engine DJ y el sistema.
- **Por qué importa**: Surco escribe directamente en la base de datos de Engine y solo lo hemos probado con bibliotecas de prueba.

---

## Apple Music (solo Mac)

### 15. Añadir y actualizar

- **Objetivo**: que la pista entre en Música una sola vez y con todo, y que actualizar no la duplique.
- **Pasos**: destino "Apple Music". Convierte 3 pistas a AIFF. Luego cambia el título y la carátula de una en Surco y pulsa "Actualizar en Apple Music".
- **Qué debería pasar**: una entrada por pista, con título, artista, año, género y carátula. Tras actualizar, la misma entrada cambia; no aparece otra.
- **Qué enviar**: captura de Música, la actividad, y tu versión de macOS.
- **Por qué importa**: macOS 26 rompe a veces el "añadir" de Música y queremos saber si Surco lo lleva bien.

### 16. Sustituir un MP3 por un fichero mejor

- **Objetivo**: que "Sustituir por AIFF + Apple Music" deje una sola entrada, apuntando al fichero nuevo.
- **Pasos**: elige un MP3 que está en Música, en una playlist inteligente (por ejemplo por género o año) y, si puedes, también en rekordbox con la sincronización activada. Conviértelo a AIFF con "Sustituir".
- **Qué debería pasar**: una sola entrada en Música, que reproduce el AIFF, y que sigue saliendo en la playlist inteligente. La copia vieja va a la papelera. En rekordbox, sin "!".
- **Qué enviar**: captura de Música (Obtener información → Archivo, para ver la ruta), la actividad y captura de rekordbox si lo usaste.
- **Por qué importa**: hay un instante con dos entradas y queremos confirmar que al final queda una.

### 17. Varios géneros

- **Objetivo**: ver cómo quedan varios géneros en cada programa.
- **Pasos**: en Surco pon dos géneros a una pista (por ejemplo "Pop" e "Indie Pop") y conviértela con destino Apple Music. Crea en Música una playlist inteligente "Género contiene Pop". Si puedes, cárgala también en Traktor y rekordbox.
- **Qué debería pasar**: Música lo muestra como un solo texto con los dos géneros, y la playlist inteligente la encuentra.
- **Qué enviar**: captura de cómo se ve el género en Música, Traktor y rekordbox.
- **Por qué importa**: Música no tiene varios géneros de verdad y no sabemos cómo lo pinta cada programa.

### 18. Biblioteca de Música vacía

- **Objetivo**: que Surco funcione con una biblioteca de Música sin pistas.
- **Pasos**: abre Música con la tecla Opción pulsada → "Crear biblioteca" y crea una nueva vacía. Abre Surco, carga pistas y usa "Importar de Apple Music". Al terminar, vuelve a tu biblioteca de siempre de la misma forma.
- **Qué debería pasar**: ningún error; Surco simplemente no marca nada como "En Apple Music" y dice que no hay playlists.
- **Qué enviar**: captura de lo que salga y el registro si aparece un error.
- **Por qué importa**: antes fallaba en silencio y ninguna pista se marcaba nunca.

---

## Windows

### 19. Convertir la pista que está sonando

- **Objetivo**: que en Windows se pueda sobrescribir o renombrar una pista mientras suena en Surco.
- **Pasos**: destino "Sobrescribir el original". Reproduce una pista en Surco y, sin pararla: cámbiale la carátula y convierte; luego cámbiale el nombre del archivo y convierte. Repite 5 veces con pistas distintas.
- **Qué debería pasar**: sin error ni "Otro programa está usando este archivo". El fichero cambia a la primera, no a la tercera. El audio puede cortarse un momento en Windows (en Mac no se corta); cuéntanos qué hace exactamente.
- **Qué enviar**: cuántas veces de 5 fue bien, el texto de cualquier error, y qué hizo el audio.
- **Por qué importa**: era Surco bloqueándose a sí mismo, y un arreglo a medias solo lo hacía menos frecuente.

### 20. Antivirus y discos lentos

- **Objetivo**: que el antivirus o el indexador de Windows no hagan perder conversiones.
- **Pasos**: con el antivirus normal (Defender u otro) activo, convierte un lote de 40 pistas a FLAC hacia una carpeta del disco interno, y otro lote hacia un USB o un disco de red.
- **Qué debería pasar**: todas convertidas. Si alguna falla al final, aparece junto al destino un fichero con `~` al final del nombre (por ejemplo `Canción~.flac`) con la conversión completa.
- **Qué enviar**: cuántas fallaron, el texto del error, si apareció algún fichero con `~`, el antivirus que usas y el registro.
- **Por qué importa**: el fallo dura milisegundos y antes tiraba la conversión entera.

### 21. Cambiar solo mayúsculas del nombre

- **Objetivo**: que renombrar `cancion.wav` a `Cancion.wav` no borre la pista.
- **Pasos**: destino "Sobrescribir el original". En el editor cambia solo mayúsculas del nombre del archivo y convierte. Hazlo en el disco interno (NTFS), en un USB (exFAT) y, si tienes, en un disco de red.
- **Qué debería pasar**: el fichero sigue ahí, con el nombre nuevo y el audio entero. No aparece en "Originales de Surco" como renombrado.
- **Qué enviar**: qué pasó en cada disco, y el sistema de archivos de cada uno (Explorador → clic derecho en la unidad → Propiedades).
- **Por qué importa**: Surco decide si es el mismo fichero mirando datos del disco que en Windows no hemos podido comprobar; si se equivoca, aparta la pista que acaba de escribir.

### 22. Procesado de audio en Windows

- **Objetivo**: que igualar volumen, recorte y reparación de clicks funcionen igual en Windows que en Mac.
- **Pasos**: con la misma pista en Mac y en Windows, activa "Igualar volumen" (el preajuste que uses), "Recorte de silencio" y "Reparación de clicks de vinilo", y convierte a MP3, a FLAC y a WAV.
- **Qué debería pasar**: sin errores, y los números de volumen que muestra Surco después de convertir son iguales (o casi) en los dos equipos.
- **Qué enviar**: los números de la sección "Calidad de audio" de cada fichero convertido en cada sistema, y el registro si falla.
- **Por qué importa**: la versión de ffmpeg de Windows es distinta de la del Mac y aquí solo podemos probar la de Mac.

---

## Etiquetas

### 23. Energía en FLAC con Traktor y Platinum Notes

- **Objetivo**: saber si los programas DJ leen la energía que escribe Surco en FLAC.
- **Pasos**: toma un fichero con energía de Mixed In Key o Platinum Notes. Mira que Surco muestra un número de 1 a 10 en "Energía" (no un texto largo raro). Conviértelo a FLAC y cárgalo en Traktor, Mixed In Key y Platinum Notes si los tienes.
- **Qué debería pasar**: en Surco, un número de 1 a 10. En los otros programas, la misma energía.
- **Qué enviar**: qué muestra cada programa, y captura de Mp3tag del FLAC con todos sus campos (ahí se ve si el campo se llama ENERGY o ENERGYLEVEL).
- **Por qué importa**: en FLAC, Surco escribe ENERGY, y es posible que los programas DJ esperen ENERGYLEVEL.

### 24. Rastro del programa anterior

- **Objetivo**: que tras convertir no quede el nombre del codificador o del estudio del dueño anterior.
- **Pasos**: busca ficheros codificados por otros programas (LAME, iTunes, Platinum Notes, Traktor, un DAW). En Mp3tag mira los campos "Encoded by", "Encoder settings" (TSSE) y parecidos. Conviértelos con Surco (MP3 → MP3, WAV → MP3, FLAC → FLAC) y vuelve a mirar.
- **Qué debería pasar**: esos campos desaparecen, y tus etiquetas (título, artista, cues) siguen en su sitio. En MP3 los cues no se mueven.
- **Qué enviar**: captura de Mp3tag antes y después, y el fichero original si puedes.
- **Por qué importa**: parece que Surco deja "capas" de otra persona dentro del fichero.
