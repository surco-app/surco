# Sustituir una pista que ya está en la biblioteca

Estado: propuesta, sin implementar. Requiere aprobación antes de tocar código.

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

Cada paso es verificable por separado y ninguno toca la biblioteca real hasta el último.

**Paso 1. Leer la ruta vieja y emparejarla con rekordbox.**
Dado un fichero nuevo que ya está en la biblioteca, obtener la ruta del viejo y la entrada
de rekordbox que le corresponde.
Éxito: sobre una copia de su colección, un MP3 suyo de Apple Music devuelve su entrada.

**Paso 2. El juicio de calidad de la sustitución.**
Comparar viejo y nuevo y decidir si hay que avisar y de qué.
Éxito: tests con los tres casos de arriba, más el caso de una mejora real, que no avisa.

**Paso 3. La cadena completa, sin UI.**
Encadenar los seis pasos del orden, con el reapuntado ya construido.
Éxito: sobre una COPIA de su colección y con una pista de prueba, la sustitución deja
rekordbox apuntando al fichero nuevo y Apple Music con una sola entrada.

**Paso 4. La pantalla.**
Sin diseñar. Se decide al ver el paso 3 funcionando, que es lo que él pidió.

## Verificación, no negociable

**Nunca contra su colección real ni contra su biblioteca de Apple Music.** Siempre sobre
copias, con rekordbox cerrado, y abriéndolo después para comprobar a ojo que las playlists
y los cues siguen.

Apple Music no se puede copiar como se copia un fichero, así que las pruebas de la parte
de Music tienen que usar una pista de prueba que se añade y se borra, nunca una suya.
