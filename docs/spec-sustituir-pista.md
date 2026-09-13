# Sustituir una pista que ya está en la biblioteca

Estado: los tres pasos de lógica están construidos y probados (13/09). **Nada de esto se
ejecuta todavía**: falta cablearlo a la conversión y decidir la pantalla.

Depende del reapuntado de rekordbox, que ya está construido y probado. Ver
`spec-rekordbox-repunte.md`.

## El caso

Vicent tiene la canción A en Apple Music, en MP3. Consigue una versión mejor, un WAV, y
la carga en Surco. Surco detecta que A ya está en la biblioteca.

Hoy lo que ocurre es esto: Surco convierte, **añade una copia nueva** a Apple Music, y
después ofrece borrar la vieja. Quedan dos entradas durante un rato y la limpieza es un
segundo paso que el usuario puede olvidar.

Lo que él quiere es que sea una sustitución desde el principio: el botón dice actualizar,
el fichero viejo se reemplaza por el nuevo, y rekordbox se entera.

## La pieza que lo hace posible

**Durante la actualización todavía se sabe cuál era el fichero viejo.** Apple Music
responde a la pregunta de dónde vive el fichero de una pista sin tocarla ni borrarla, y
Surco ya usa esa función en el flujo de conversión (`processTrack.ts:293`).

Ese era el obstáculo que yo creía insalvable: pensaba que la ruta vieja se perdía al
sustituir. No se pierde, basta con leerla antes. El planteamiento de Vicent era correcto.

## Medido sobre su biblioteca real (12/09)

1959 pistas en Apple Music, 1962 entradas en rekordbox. Cruzando por ruta, con las mismas
reglas que usa el código (resolver enlaces, ignorar mayúsculas, excluir streaming):

| Caso | Pistas |
|---|---|
| Se localiza en rekordbox sin ambigüedad | 1808 |
| Ambigua, tiene dos entradas | 34 |
| No está en rekordbox | 117 |

**El 92% es reapuntable automáticamente.** Las 117 que faltan son pistas que tiene en
Apple Music y nunca importó a rekordbox: no hay nada que reapuntar y el flujo no hace nada.
Las 34 ambiguas son las duplicadas del enlace simbólico, ya conocidas.

Su biblioteca por formato, que dimensiona el trabajo real:

| Formato | Pistas |
|---|---|
| WAV | 1229 |
| AIFF | 473 |
| MP3 | 225 |
| M4A | 32 |

**Solo 257 pistas son con pérdida.** Ese es el tamaño de lo que le queda por sustituir, no
1959. Ningún fichero de la biblioteca ha desaparecido, así que la relación entre Apple
Music y el disco está sana.

## El orden, que es lo que no se puede equivocar

1. Se carga el fichero nuevo y Surco lo empareja con la entrada de la biblioteca. Ya
   funciona: es lo que hace hoy para decir que la pista ya existe.
2. **Se pregunta a Apple Music por la ruta del fichero viejo.** Antes de convertir nada.
3. Se busca esa ruta en rekordbox y se guarda a qué entrada corresponde.
4. Se convierte al formato de destino.
5. Se reapunta rekordbox del fichero viejo al nuevo. Ya funciona.
6. Se sustituye la copia de Apple Music.

El paso 2 tiene que ir antes del 6. Si se borra primero la copia de Apple Music, ya no hay
forma de saber de qué fichero se venía, y el reapuntado se queda sin su dato de entrada.

## El aviso de calidad

Decisión de Vicent (12/09): **avisar pero dejar sustituir**. Nunca bloquear.

Surco ya tiene lo necesario: `quality.ts` distingue contenedor con y sin pérdida
(`isLosslessContainer`, `isLossyContainer`), detecta transcodificaciones (`isTranscode`) y
emite veredictos. No hay que construir el juicio, solo usarlo.

Cuándo avisa:

- El fichero viejo es sin pérdida y el nuevo con pérdida. Es la pérdida más clara.
- Los dos son con pérdida pero el nuevo tiene peor corte de frecuencias.
- El nuevo parece una transcodificación, un lossless hecho a partir de un MP3.

El aviso dice qué se pierde y deja continuar. No es un diálogo de confirmación destructiva
como el de borrar: es información, y la decisión sigue siendo suya.

## Preguntas abiertas, para decidir al ver la pantalla

1. **El botón.** Vicent propone que diga actualizar cuando la pista ya existe. Hay que
   decidir si sustituye al de convertir o convive con él, y qué pasa cuando hay varias
   pistas seleccionadas y solo algunas están en la biblioteca.

2. **Qué significa sustituir en Apple Music.** No hay forma de cambiar el fichero de una
   pista: Music deja leer su ubicación, nunca escribirla. Así que sustituir es, por debajo,
   añadir el nuevo y borrar el viejo. La diferencia con hoy es que sería un solo paso y no
   dos, pero la mecánica es la misma y hay un instante con dos entradas. Hay que decidir si
   eso se le cuenta al usuario o se le presenta como una sustitución sin más.

3. **El fichero viejo en disco.** Al sustituir, el MP3 original se queda ahí. Hoy el
   borrado de la copia vieja envía su fichero a la papelera. Hay que decidir si la
   sustitución hace lo mismo, lo deja, o lo pregunta.

4. **Qué pasa si falla a mitad.** Si rekordbox queda reapuntado y luego falla la
   sustitución en Apple Music, quedan descolocados. Hay que decidir el orden de deshacer,
   o aceptar que un fallo deja aviso y el usuario lo remata.

5. **Las 34 ambiguas.** Ya se sabe que hay que preguntar cuál conservar, pero no cómo.

## Plan por pasos

**Paso 1. Leer la ruta vieja y emparejarla con rekordbox. HECHO 13/09 (6089691a).**
`replaceTarget.ts`, 7 tests. Verificado contra su colección real en los cuatro casos: un
MP3 con fila en rekordbox, una de las 34 duplicadas (sale ambigua y no elige), una de las
117 que no están en rekordbox (da la ruta vieja, sin fila), y una entrada sin fichero.

**Paso 2. El juicio de calidad. HECHO 13/09 (97efd7e2).**
`replaceWarning.ts`, 11 tests. Avisa en tres casos y nunca bloquea, como pidió: sin
pérdida que pasa a con pérdida, corte más bajo entre dos con pérdida, y lossless falso.

El margen para decidir si un corte es peor son 2100 Hz, y no es inventado: sale del corpus
de 39 codificaciones LAME medido el 29/08, cuya dispersión llega ahí. Con un margen menor,
dos copias del mismo tema a 320 se acusarían entre sí. Hay test que fija los dos lados.

**Paso 3. La cadena completa, sin UI. HECHO 13/09 (005ce22f, 5e9e01cc).**
`replaceFlow.ts` (7 tests) ordena los pasos y `replaceInLibrary.ts` (5 tests) hace el
intercambio en Apple Music.

Dos órdenes que los tests protegen, y que se comprobaron rompiéndolos a propósito:

- **La ruta vieja se lee antes de tocar Apple Music.** Leerla después devolvería el
  fichero nuevo y el reapuntado apuntaría al sitio del que quería salir.
- **En Apple Music se añade antes de borrar.** Al revés, un fallo del añadido dejaría la
  pista fuera de la biblioteca. Así el peor caso son dos copias, visible y recuperable.

Un reapuntado rechazado (rekordbox abierto, colección de solo lectura) no cancela la
sustitución: el fichero ya está en disco y la copia de biblioteca sigue mereciendo
actualizarse. El motivo viaja hacia arriba para poder contarlo.

## Lo que queda

**Cablear la cadena a la conversión.** Los módulos están construidos y probados, pero
nada los llama todavía: `processTrack.ts` sigue con el flujo de hoy, que añade una copia
nueva y ofrece borrar la vieja después. Falta sustituir ese tramo por la cadena.

**La pantalla.** Las cinco preguntas de arriba siguen abiertas, y él pidió decidirlas al
ver el paso 3 funcionando.

## Verificación, no negociable

**Nunca contra su colección real ni contra su biblioteca de Apple Music.** Siempre sobre
copias, con rekordbox cerrado, y abriéndolo después para comprobar a ojo que las playlists
y los cues siguen.

Apple Music no se puede copiar como se copia un fichero, así que las pruebas de la parte
de Music tienen que usar una pista de prueba que se añade y se borra, nunca una suya.
