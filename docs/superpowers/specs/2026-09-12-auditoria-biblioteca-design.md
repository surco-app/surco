# Auditoría de biblioteca

## Problema

Un coleccionista con miles de pistas no sabe cuáles tienen defectos. Los
defectos existen, son detectables y buena parte se arregla sin tocar el audio,
pero hoy hay que abrir pista por pista en el editor para verlos. Con 6000
ficheros eso no lo hace nadie.

## Qué se entrega

Una pantalla de barrido que recorre una carpeta, agrupa los defectos
encontrados y repara en lote los que no requieren tocar el audio.

La reparación es de nivel A: se reescriben tags y cabeceras, y los flujos de
audio quedan byte a byte idénticos. El fichero puede cambiar de tamaño porque
cambian los metadatos, pero las muestras no se tocan ni se vuelven a codificar.
Nada en esta funcionalidad transcodifica.

Los defectos que sí requerirían re-encode (DC offset, picos sobre techo,
loudness) quedan fuera. Los defectos de calidad de origen (falso lossless)
se informan pero no se reparan, porque no tienen arreglo.

## Arquitectura

Tres etapas con responsabilidades separadas.

**Recorrido.** Reutiliza `expandPaths` de `main/expand.ts` con su callback por
lotes. Ya está medido sobre NAS y se sabe que el coste dominante son los
directorios, no los ficheros. La auditoría no añade recorrido propio.

**Detección.** Módulo nuevo con una función por hallazgo. Cada detector recibe
lo leído del fichero y devuelve un hallazgo o nada. Son funciones puras.
Ningún detector escribe.

**Reparación.** Módulo aparte que recibe un hallazgo y lo aplica con TagLib,
apoyándose en `writeTags` y las funciones de cues de `main/tags.ts`.

Separar detección de reparación es lo que permite mostrar la lista antes de
tocar nada, y garantiza que un detector con un fallo no pueda corromper
ficheros.

## Las dos pasadas

**Pasada rápida.** Lee tags y cabeceras. Encuentra los cuatro hallazgos
reparables. Su coste es el del recorrido de directorios. Es lo primero que ve
el usuario y desde donde puede actuar de inmediato.

**Pasada profunda.** Decodifica y mide el espectro para dictar el veredicto de
calidad y encontrar los falsos lossless. Es opcional y la lanza el usuario a
mano, nunca arranca sola: son horas de CPU sobre una biblioteca grande y la
mayoría querrá reparar primero lo barato.

Escribe en la misma caché de análisis que el editor, de modo que una pista ya
analizada no se vuelve a medir. Debe poder pararse y reanudarse: si se cierra
Surco a mitad, al volver continúa donde estaba.

Las dos pasadas alimentan la misma lista. El usuario ve una funcionalidad, no
dos.

## Pantalla

Tres zonas.

**Control.** Carpeta elegida, progreso de la pasada actual y botón de la pasada
profunda una vez terminada la rápida. El progreso cuenta ficheros recorridos,
no porcentaje, porque el total no se conoce hasta acabar.

**Grupos.** Un bloque por tipo de hallazgo, con recuento y botón de reparar.
Los cuatro reparables arriba, los veredictos de calidad debajo, visualmente
distintos y sin botón. Un grupo sin hallazgos sigue visible y deshabilitado,
diciendo que no se encontró nada.

**Detalle.** Al desplegar un grupo se ven los ficheros afectados y se pueden
desmarcar los que no se quieran tocar.

## Comportamiento de la reparación

Es por grupo, no por pista. Reparar de uno en uno no ahorra tiempo a quien
tiene 6000 pistas, que es el problema que se está resolviendo.

Pide confirmación diciendo exactamente qué campo se toca en cada fichero, no
solo cuántos ficheros. Escribir en lote sobre la colección de alguien es
irreversible en la práctica.

Los errores no paran el lote. Un fichero bloqueado o de solo lectura se anota
y se sigue. Al terminar, el grupo dice cuántas se repararon y cuántas fallaron,
con el motivo. Windows retiene descriptores por antivirus y por el propio
player, y eso no puede abortar un lote de cientos.

Tras reparar, el grupo se recuenta. Lo reparado desaparece. Si algo sigue
apareciendo después de repararlo, es un bug y debe verse.

## Los cuatro detectores

**Rating descuadrado.** En FLAC el rating vive en un `RATING` de Vorbis con
formato `usuario|byte|playcount` y escala de 51 por estrella
(`shared/rating.ts`). Hay hallazgo cuando el valor no sigue ese formato, o
cuando conviven campos de rating que no traducen a las mismas estrellas. En
ID3 hay hallazgo cuando existe una sola de las dos POPM que Surco escribe
(Traktor y Windows Media Player), porque entonces una de las dos familias de
apps lee un valor distinto. La reparación escribe, en FLAC, el formato canónico
que produce `formatRatingTag`, y en ID3 las dos POPM.

**TXXX duplicado.** `TXXX_NATIVE_MIRRORS` en `main/tags.ts` ya enumera los
casos conocidos. Hay hallazgo cuando existe un TXXX de esa lista junto al frame
nativo equivalente. La reparación borra el TXXX y deja el nativo.

**FLAC con ID3 delante.** Un FLAC correcto empieza por la marca `fLaC`. Hay
hallazgo cuando empieza por `ID3`. Ese prefijo deja el fichero fuera de norma y
Traktor lo saca de la colección. La reparación elimina el bloque ID3.

**Numeración en el título.** Hay hallazgo cuando el título empieza por dígitos
seguidos de separador y el resto no queda vacío. La reparación quita el prefijo
y, si el número de pista está vacío, lo rellena con ese número. Es el único de
los cuatro con riesgo real de falso positivo, porque hay títulos que empiezan
por número legítimamente. Por eso su grupo viene desmarcado por defecto y exige
que el usuario revise la lista.

## Pruebas

Cada detector se escribe primero en rojo contra un fichero de muestra con el
defecto, y se verifica mutando la implementación para confirmar que el test se
pone rojo de verdad. Un test que no se ha visto fallar no prueba nada.

Los ficheros de muestra se generan dentro del propio test. No entran pistas
comerciales en el repo.

La reparación se prueba comprobando que el flujo de audio decodificado queda
idéntico antes y después, que es la promesa central del nivel A. Comparar el
fichero entero no sirve: los metadatos cambian por definición.

## Fuera de alcance

- Cualquier reparación que implique re-encode, en lossless o en lossy.
- Recuperar calidad de un falso lossless. No es posible.
- Reparar cues y carátulas. Son hallazgos válidos, pero se dejan para una
  versión posterior una vez asentados los cuatro primeros.
