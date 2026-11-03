# Ajustar la rejilla desde el editor de cues

## Por qué

El filtro "Cues fuera de la rejilla" (v1.21.0) encuentra pistas cuyos cues no caen en el golpe.
En muchas, como What's Up (DJ Tonin), el cue está bien y lo que está mal es la rejilla. Hoy hay
que arreglarla en el programa de DJ, y en rekordbox es "una de las cosas más complicadas de
hacer a mano" (el usuario, 03/11). Surco ya lee la rejilla de rekordbox, Traktor y Engine y
tiene un detector propio de BPM y fase, pero nunca la ha escrito.

Hay tres casos de rejilla mala (el usuario confirma que existen los tres):

1. **Desplazada.** BPM correcto, toda la rejilla corrida lo mismo. El más común.
2. **BPM mal.** Cuadra al principio y se abre hacia el final.
3. **Por zonas.** El tempo cambia dentro del tema, hacen falta varias anclas.

## Objetivos

1. En el editor de cues **maximizado** de las pestañas rekordbox, Traktor y Engine, una fila de
   controles para ajustar la rejilla a mano y un botón Auto, que resuelvan los casos 1 y 2.
2. Guardar la rejilla en el programa con el mismo botón "Guardar en …" que los cues.
3. Que el filtro de cues fuera de la rejilla deje de marcar la pista una vez ajustada.

## No objetivos

- El caso 3 (anclas con tempos distintos). Decisión del usuario: "las zonas para después".
- El editor pequeño (no maximizado). Decisión del usuario: ahí no se ven bien las líneas.
- Serato. Se añade cuando Serato tenga escritura de cues (fase b de su spec).
- TAP. Con la onda delante no hace falta (mi decisión; el usuario puede pedirlo).
- Ajustar en lote muchas pistas a la vez.
- Mover los cues cuando se mueve la rejilla.
- Cambiar el BPM de la etiqueta del fichero.

## Antiobjetivos

- Que una rejilla con varios tempos, que el DJ ajustó a mano en su programa, se aplane a un
  solo BPM sin que lo pida.
- Que Auto cambie la rejilla sin que se vea el resultado o sin poder deshacerlo. El detector
  falla en ~1 de cada 10 pistas (ver Medido).
- Dejar un fichero ANLZ, un NML o una m.db a medio escribir o inconsistente.
- Pisar una rejilla que el DJ cambió en su programa después de que Surco la leyera.

## Medido (antes de este diseño)

De `memory/rejilla-propia-medida` (22/10, 2006 pistas de su colección contra rekordbox):

- `detectBpm` coincide con rekordbox a ±0,02 BPM en el 93 %.
- La fase por "subida más brusca" (`fitBeatGrid`) cae a ≤10 ms en el 83 %. ~10 % se engancha
  a medio golpe u otro sitio. El 1 del compás acierta un 40 %, no sirve.
- El reloj de ffmpeg y el de rekordbox difieren por formato: WAV/AIFF 0, M4A 2112/sr,
  MP3 LAME ≈ 51 ms, MP3 Lavc ≈ 26 ms. Ya resuelto en `rekordboxTimeline.ts`
  (`rekordboxShiftOfFile`).
- Traktor y Engine tienen sus propios desfases (`memory/calibracion-51ms-djotas`,
  `memory/delay-encoder-mp3-falso`). No están medidos para la fase de la rejilla.

De `memory/filtro-grid-descuadrado-aplazado` (30/10): con rejilla buena rekordbox cae a
0-3 ms del golpe. Subidón (DJ Revolution) es un caso 2 real, 0 ms al principio y ~20 ms al
final, equivalente a 0,01 BPM.

## Diseño de la interfaz (aprobado por el usuario sobre el boceto)

Boceto: https://claude.ai/artifact/KFG6kPHAX5DiRX5CrapCf1 (artboard "Rejilla bajo los cues").

**Dónde.** En la fila de `CueDeck` del maximizado, en una sola línea, entre la × de memoria y
Salto: separador, BPM, mover ◀ ▶, abrir y cerrar, el 1 en el cabezal, Auto. Decisión del
usuario: "si puede estar todo en 1 línea, mejor". En la captura del maximizado quedan ~430 px
libres y el grupo ocupa ~380. Si no cabe a algún ancho de ventana, el builder decide cómo se
pliega, pero nunca a una segunda línea en el maximizado sin consultarlo.

**Controles** (inspirados en el GRID EDIT de rekordbox, que el DJ conoce):

| Control | Qué hace |
|---|---|
| Campo BPM | Muestra el BPM de la rejilla con dos decimales. Al pulsarlo se escribe un BPM o se elige ×2 Doble / ½ Mitad en su menú. |
| Mover ◀ ▶ | Desplaza toda la rejilla 1 ms. Con ⇧, 10 ms. |
| Abrir / cerrar | BPM −0,01 / +0,01. |
| El 1 en el cabezal | Pone un golpe 1 de compás exactamente en el cabezal. |
| Auto | Ajusta BPM y fase con el detector (ver Auto). Se pinta en azul relleno cuando la rejilla no cuadra. |

**Desfase.** En la barra superior, junto al tiempo: "Rejilla aquí ±N ms · al final ±M ms",
con un punto verde (≤ tolerancia) o ámbar (>). "Aquí" es la diferencia entre la rejilla
actual y la detectada en el cabezal; "al final", al final del tema. Distingue el caso 1 (los
dos iguales) del caso 2 (el del final crece). Sin detección disponible no se muestra.

**Cues.** Tocar la rejilla no mueve ningún cue.

**Deshacer.** Cada cambio de rejilla entra en el historial del borrador, ⌘Z / ⇧⌘Z lo
deshacen igual que un cambio de cue.

**Guardar.** Un cambio de rejilla deja el borrador sin guardar y activa "Guardar en …". El
menú de Guardar (esta pista / N pistas / Descartar) lo trata igual que un cambio de cues.

## Comportamiento (decisiones mías, marcadas)

**Modelo editable.** Una rejilla constante: `{ bpm, anchorMs }`, donde `anchorMs` es un golpe 1
de compás. Todas las operaciones trabajan sobre este modelo y la rejilla que se dibuja se
genera de él.

**Rejillas que no se pueden editar (mi decisión).** Si la rejilla leída no es constante
(rekordbox con tempos distintos en PQTZ, más de un marcador TYPE=4 en Traktor, marcadores
ajustados de Engine con periodos distintos) los controles se ven deshabilitados (no
desaparecen, `memory/settings-no-aparecer-desaparecer`), con el motivo en el título del
grupo. Es el antiobjetivo de no aplanar el caso 3. Tolerancia para "constante": el builder la
fija midiendo; rekordbox guarda el tempo con resolución de 0,01.

**Pistas sin analizar.** Si la rejilla es la provisional de Surco (rekordbox sin ANLZ), los
controles están deshabilitados: no hay nada que escribir aún (mi decisión).

**Abrir y cerrar (mi decisión).** El golpe más cercano al cabezal se queda quieto y el resto se
abre o se cierra a su alrededor, para que lo que se mira no salte. ×2 y ½ igual.

**Teclas (mi decisión).** Las flechas ya mueven el cabezal (`cueKeys.ts`), así que mover la
rejilla va en ⌥← / ⌥→ y ⌥⇧ para 10 ms. Se añaden a la leyenda de teclas. El boceto pone "(←)"
en el título del botón, eso queda corregido aquí.

**Auto.**

- Usa `fitBeatGrid` (worker, cacheado en `beatGridCache`) y lo pasa al reloj del programa.
- Conserva la numeración de compás del DJ: el nuevo golpe 1 es el golpe detectado más cercano
  al golpe 1 actual. El detector no sabe dónde empieza el compás.
- Solo cambia el BPM si el detectado está a menos del 1 % del actual. Si no (doble, mitad,
  3:4…), ajusta solo la fase y deja el BPM, y el desfase "al final" lo hará evidente
  (mi decisión; el DJ tiene ×2 y ½).
- Siempre deja el resultado a la vista, sin guardar, y se deshace con ⌘Z.
- Se pinta en azul relleno cuando "aquí" o "al final" pasan la tolerancia de
  `cueGridTolerance` (5/10/20, defecto 10), la misma del filtro.

**Auto por programa (mi decisión).** El desfase de reloj solo está medido para rekordbox.
Para Traktor y Engine, Auto y el desfase se quedan deshabilitados hasta medirlo sobre pistas
suyas con rejilla buena (como se hizo el 22/10 con rekordbox). Los controles manuales sí
funcionan desde el principio, porque trabajan en el reloj del propio programa.

**Reloj de la onda en Traktor y Engine (mi decisión).** En esas pestañas la onda y el audio
del editor van en el reloj de ffmpeg y nada corrige el desfase con el del programa (en MP3
puede ser de 26 a 51 ms, varias veces la tolerancia). Ajustar a ojo sobre esa onda guardaría
una rejilla corrida. Por eso medir ese desfase por programa y formato es un paso de este plan,
y mientras un formato no esté medido los controles de rejilla se ven deshabilitados en ese
programa para ese formato, con el motivo. Los formatos sin desfase de decodificador (WAV,
AIFF, FLAC) son los primeros candidatos, pero también se miden, no se suponen.

**Rejillas bloqueadas (mi decisión).** Si el DJ bloqueó la rejilla en su programa (lock de la
entrada en el NML de Traktor, `isBeatGridLocked` en Engine, el equivalente de rekordbox si
existe), Surco la respeta: controles deshabilitados con el motivo. Surco no pone bloqueos al
escribir salvo que la medición de Engine lo exija.

**BPM del programa (mi decisión).** Al guardar una rejilla con otro BPM se actualiza también
el BPM de la pista en el programa (`djmdContent.BPM`, `TEMPO BPM` del NML, `Track.bpm` /
`bpmAnalyzed` de Engine), porque el programa muestra y sincroniza con ese valor. La etiqueta
del fichero no se toca.

**Gemelas (mi decisión).** Cuando los cues se copian a otros programas, la rejilla no viaja:
solo se guarda en el programa de la pestaña.

## Escritura por programa

Las tres escrituras ocurren con el programa cerrado y por la cola existente, como los cues.

**rekordbox.**
- Hoy no se escribe ningún ANLZ local. Hay que escribir PQTZ en el `.DAT` (lista de golpes:
  número 1-4, tempo ×100, ms) y la rejilla ampliada PQT2 en el `.EXT`, coherentes entre sí.
  Cambiar el BPM cambia el número de golpes y el tamaño de la sección, así que se reescribe el
  fichero entero y la longitud de la cabecera PMAI.
- Copia de seguridad de los ANLZ antes de escribir, junto a la de master.db
  (`rekordboxSessionBackup.ts`). Escritura atómica (temporal + rename).
- El formato de PQT2 no está implementado en el código. El builder lo documenta a partir de
  fuentes conocidas (Deep Symmetry, pyrekordbox) y lo valida contra ficheros reales.
- **Spike obligatorio antes de construir la escritura**, en una copia de su colección con
  sha256 para restaurar (como los spikes del 22-24/10): rekordbox carga la rejilla escrita, no
  la reanaliza, el BPM cuadra, y un USB exportado por rekordbox la lleva. Si rekordbox la
  rechaza o la pisa, se para y se vuelve al usuario.

**Traktor.**
- Escribir en collection.nml el marcador TYPE=4 (`START` = ancla, `GRID BPM`) y el `TEMPO BPM`
  de la entrada. Hoy `withTraktorCues` copia el marcador sin tocarlo; `withGridTempo` y
  `cuesToXml` (`traktorNml.ts`) son la base.
- No se toca el blob TRAKTOR4 del fichero: Traktor manda con el NML (`memory/nml-vs-fichero`).

**Engine.**
- No existe codificador de `beatData`. Hay que escribirlo con la misma disposición que
  `decodeBeatGrid` y que `shiftEnginePerformance` (`engineRepoint.ts`) ya reescribe, y fijar
  las dos listas de marcadores (por defecto y ajustada) para una rejilla constante.
- Si Engine reanaliza una pista y pisa la rejilla, el builder decide si hace falta
  `isBeatGridLocked` y lo justifica midiendo.

**Conflictos (mi decisión en la forma).** La huella del borrador (`fingerprint`) hoy cubre
solo los cues. Se añade una huella aparte de la rejilla, que solo comprueban los guardados que
cambian la rejilla. Así un cambio de rejilla hecho en el programa después de leer se detecta,
los guardados de solo cues que ya están en la cola (persistida en disco) no se rechazan al
actualizar Surco, y un guardado de solo cues no falla porque el DJ movió la rejilla en su
programa.

**Filtro.** Tras guardar, se invalida `source-playlist` (ya ocurre tras aplicar la cola) y
`gridDriftMs` se recalcula con la rejilla nueva.

## Restricciones

- El refactor "un programa = una interfaz" está en marcha en el worktree `serato` (bloques
  3-8, el 4 es cues). Esta feature toca los mismos caminos de guardado. Orden (mi decisión):
  primero lo que no depende de programa (modelo, operaciones, codificadores PQTZ/PQT2/beatData
  y Traktor, UI, deshacer); el cableado del guardado, sobre la interfaz por programa cuando el
  bloque 4 esté en main. Si no lo está cuando se llegue ahí, se para y se pregunta.
- Antes de todo lo anterior va el spike de escritura en rekordbox, porque es el programa
  principal del usuario y el único con Auto desde el principio. Si falla, se para y se vuelve
  al usuario antes de construir nada (mi decisión de orden).
- Reglas del repo: TDD, sin comentarios, `data-testid`, i18n en todos los idiomas, mutación
  para los tests nuevos de los codificadores.
- Verificación real: driver en perfil aislado y copias exactas de master.db / collection.nml /
  m.db con sha256 para restaurar, como en el refactor de Serato.

## Lo que queda al builder

- Tolerancia exacta para considerar una rejilla constante.
- Cómo se pliega la fila si una ventana maximizada estrecha no da para una línea.
- Diseño del campo BPM al escribir (validación, Enter/Esc).
- Si Engine necesita `isBeatGridLocked`.
- El texto exacto de los avisos en los seis idiomas (sin guion largo ni dos puntos de
  explicación, `memory/sin-guion-largo-al-escribir`).
