# Qué pregunta el asistente de bienvenida, y qué le falta

Análisis, sin cambios de código. 13/09/2026.

## Lo que hay

Cuatro pasos: bienvenida, de dónde salen los metadatos, a qué formato y dónde acaban las
pistas, y qué haces con ellas (que decide qué secciones ve en el editor).

De los 64 ajustes de Surco, 11 son estado interno que el usuario nunca elige. De los 53
que quedan, el asistente pregunta 10 y decide otros 4 de forma indirecta. Los otros 39 se
quedan fuera.

**39 fuera no es un problema.** El asistente promete menos de un minuto, y la mayoría de
esos ajustes son afinados que solo importan cuando ya sabes lo que buscas: el tamaño de la
carátula, la compresión FLAC, la notación de tonalidad, las palabras que ignora la
búsqueda. Meterlos ahí lo convertiría en otra cosa.

Lo que importa no es cuántos faltan, sino cuáles.

## Corrección a lo que dije antes

Afirmé que el asistente no pregunta dónde acaban las pistas. **Es falso**: sí lo hace, en
el tercer paso, junto al formato, y también deja elegir la carpeta de salida. Lo dije tras
leer solo los nombres de los pasos. El destino está cubierto.

## Los tres huecos reales

### 1. Engine DJ se puede elegir sin poder configurarlo

El asistente ofrece Engine DJ como destino, pero no pregunta ni dónde está su biblioteca
ni a qué lista añadir. Quien lo elija ahí termina el asistente con el destino puesto y la
biblioteca apuntando a una carpeta por defecto que puede no existir.

En Ajustes esos dos campos aparecen justo debajo de su opción. En el asistente no.

Es el único caso donde el asistente deja una elección a medias, y por eso es el primero.

### 2. Las tres bibliotecas de DJ son invisibles

Ni Traktor, ni rekordbox, ni la parte de Engine DJ que escribe en su biblioteca. Un DJ
termina el asistente sin saber que Surco puede mantener su colección al día.

Y son justo las funciones que más se notan: reapuntar una pista convertida le ahorra
rehacer playlists a mano.

Hay un argumento para dejarlas fuera: escriben en algo que el usuario no puede
reconstruir, así que quizá no deban activarse en un asistente de un minuto. Pero ahora
mismo no es que se decida no ofrecerlas, es que no se mencionan.

**Dato a favor de un paso propio:** Surco ya sabe si tienes cada programa instalado, así
que el paso solo aparecería para quien le sirve. Quien no use ninguno no vería nada.

### 3. El paso 4 pregunta por el editor, no por el audio

Se titula "¿Qué haces con tus pistas?" y decide qué secciones del editor se ven. Tres de
las cuatro opciones son de audio: restaurar vinilo, nivelar volumen, comprobar calidad.

Eso está bien, pero mezcla dos preguntas. Restaurar vinilo es una intención de trabajo;
que aparezca la sección de recorte es una consecuencia. Hoy el usuario no puede saber que
está eligiendo lo segundo.

No es un fallo, es una ambigüedad que conviene tener presente si se toca ese paso.

## Lo que NO haría

**No añadir los 39 ajustes restantes.** La mayoría tienen valores por defecto pensados y
no merecen una pregunta. El asistente compite con las ganas de usar el programa.

**No mover cosas de Ajustes al asistente.** Todo debe seguir en Ajustes. El asistente es
un atajo la primera vez, nunca el único sitio donde vive una opción.

## Orden propuesto

1. **Completar Engine DJ**, con sus dos campos bajo su opción, como en Ajustes. Es cerrar
   algo que ya está a medias.
2. **Un paso de bibliotecas de DJ**, visible solo si Surco detecta alguna instalada.
3. **Dejar el paso 4 como está**, salvo que se rediseñe por otro motivo.

Los dos primeros son pantalla, así que conviene dibujarlos a tamaño real antes de
construir nada.
