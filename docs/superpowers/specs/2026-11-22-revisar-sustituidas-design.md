# Revisar las pistas sustituidas

## Por qué

Vicent sustituye pistas de su biblioteca por ficheros mejores («Actualizar», `job.replacesPath`).
El fichero nuevo puede ser otro master, con más o menos silencio al principio, y entonces los cues
que el DJ puso sobre el viejo quedan descuadrados. Hoy nadie lo mide: al sustituir,
`rekordboxRepointFor` pone `cueShiftMs = 0` y los demás programas tampoco mueven nada. Un cue
descuadrado se descubre en cabina, delante de la pista de baile. Vicent (22/11): «si se nos cuela un
fallo, eso es desastroso para un DJ».

Al mirarlo apareció un fallo que ya existe hoy: Traktor y Serato no siguen la sustitución. Su
entrada se queda en la ruta vieja y, cuando Surco retira el fichero viejo, la pista sale perdida y
sus cues con ella. Vicent: «hay que arreglar siempre todo lo que se encuentra».

Boceto aprobado: https://claude.ai/artifact/HVQ5KGPJRVDAfXXGP13WTC

## Metas

- Al sustituir, Surco mide cuánto se ha movido el audio entre el fichero viejo y el nuevo y, si la
  medida es fiable, mueve los cues de la pista en los cinco programas esa cantidad.
- Toda pista sustituida entra en una lista «To review» en la pestaña de cada programa donde está,
  se haya ajustado o no, hasta que alguien la revise.
- Traktor y Serato siguen al fichero nuevo con sus cues, como ya hacen rekordbox, Engine DJ y
  VirtualDJ.

## No metas

- No revisa las conversiones normales (mismo audio, otro formato). Esas ya mueven los cues por el
  desfase del códec y no entran en la lista.
- No crea playlists dentro de los programas (enfoque B descartado).
- No reanaliza ni cambia la rejilla del programa más allá de lo que ya hace hoy el reapuntado.

## Anti-metas (fallaría aunque funcione)

- Mover cues con una medida dudosa. Ante la duda, no tocar y marcar ámbar.
- Que una pista salga de la lista sin que nadie la haya revisado (por abrirla, escucharla, por
  caducidad o porque el fichero cambió de ruta).
- Perder los cues de una pista en cualquier programa al sustituir.
- Texto en las filas de la lista. Iconos con `aria-label` (norma de UI minimalista).
- Subir un namespace de caché o forzar reanálisis (norma «no forzar reanálisis»).

## Enfoques

- **A, elegido: lista propia de Surco.** Almacén en userData. El nodo se muestra en la pestaña de cada
  programa cruzando el almacén con «All tracks», como hace Matching fuera de rekordbox. Siempre dice
  la verdad: la salida de la lista se registra en Surco, esté el programa abierto o no.
- **B, descartado: playlist «Surco · Revisar» dentro de cada programa.** Se vería dentro de rekordbox,
  pero solo se escribe con el programa cerrado y Surco no se entera de que el DJ revisó la pista en
  el programa. La lista quedaría desactualizada.

Ajuste automático y lista van juntos (Vicent: «las dos»).

## Qué hace

### 1. Traktor sigue la sustitución (arreglo previo, sus propios commits)

Hoy `recordConversionPatch` (`ffmpeg.ts`) dirige el parche del NML por `toNmlLocation(input)` e
ignora `replacesPath`. En una sustitución `input` es la descarga nueva, que Traktor nunca indexó,
así que el parche no casa con nada. Además `libraryTrackOps` no añade la pista porque la ruta vieja
ya está en la colección.

Arreglo: en una sustitución el parche apunta a la ENTRY de `replacesPath` y reescribe su
`<LOCATION>` entera (VOLUME, DIR y FILE) hacia el fichero nuevo. Hoy `patchEntry` solo reescribe FILE
a propósito, para no seguir conversiones que escriben en otra carpeta. Una sustitución es distinta:
el DJ ha pedido que esa pista sea el fichero nuevo. Los CUE_V2 de la ENTRY van con ella. Mismas
guardas que hoy: copia de seguridad, programa cerrado, escribir y renombrar.

### 2. Serato sigue la sustitución (arreglo previo, sus propios commits)

Serato guarda los cues dentro del fichero (GEOB `Serato Markers2`, `Serato BeatGrid` y compañía).
Hoy nadie los copia al fichero nuevo y la cola de Serato no reapunta (`repoint: async () => []`).

- **Cues:** al sustituir, Surco copia las marcas de Serato del fichero viejo al nuevo, desplazadas
  con el ajuste de la sección 3, antes de que el viejo se retire.
- **Entrada y crates:** reapuntar la ruta en `database V2` y en los `.crate`. **Riesgo medido el
  04/11:** reapuntar por `database V2` hace que Serato borre el asset y cree otro, y pierde el
  **rating** (solo vive en `master.sqlite`, que no se escribe). El reapuntado se revirtió entonces
  (99597884a) y hoy, si Serato usa el original, la conversión conserva el original y avisa.
  **Pendiente de Vicent:** ver «Preguntas abiertas».

### 3. Medir el desfase al sustituir

Cuando un trabajo trae `replacesPath`, después de escribir el fichero nuevo y antes de anotar los
reapuntados, Surco compara el audio del viejo (`replacesPath`) con el del nuevo:

- **Medida en dos sitios:** cerca del principio y cerca del final, con la correlación cruzada que ya
  existe (`bestLag` / `headOffsetMs` en `ffmpeg.ts`, correlación mínima 0,9).
- **Fiable** si las dos ventanas casan y dan el mismo desfase dentro de una tolerancia pequeña.
  Entonces el resultado es `{ moved: ms }`.
- **No fiable** si alguna ventana no casa, o si las dos dan desfases distintos (otro edit, otra
  velocidad o duración distinta). Entonces el resultado es `{ unmoved: motivo }` y los cues no se
  tocan.
- **Desfase por programa:** la medida es sobre el audio decodificado por ffmpeg. Cada programa tiene
  su propio adelanto por códec (`rekordboxShiftOfFile`, `automaticCueOffsetOfFiles`), así que el
  desplazamiento final de cada programa es la medida más la diferencia de adelantos entre el viejo y
  el nuevo, igual que ya hace la conversión normal.
- **Aplicación:** por las vías que ya existen. rekordbox `cueShiftMs` (`shiftCues`), Engine DJ
  `shiftEnginePerformance`, VirtualDJ el desplazamiento de POIs del reapuntado, Traktor `cueShift`
  del parche y Serato las marcas copiadas de la sección 2. Hoy todas reciben 0 o nada en una
  sustitución.

### 4. Almacén «To review»

- Fichero en userData, mismo patrón que `matching-pairs.json` (`matchingStore.ts`): JSON con
  versión, rutas NFC, escribir a temporal y renombrar.
- Cada entrada: ruta del fichero nuevo, ruta vieja, fecha de sustitución, resultado de la medida
  (`{ moved: ms }` o `{ unmoved: motivo }`) y los programas que aún la tienen pendiente.
- La ruta vieja sirve mientras el reapuntado espera en la cola de un programa abierto: su
  «All tracks» aún muestra la ruta vieja y el nodo casa con cualquiera de las dos. *(Decisión de
  diseño, sin preguntar.)*
- Entra cuando termina una sustitución, haya podido medirse o no.
- Sigue al fichero si una conversión posterior lo mueve, como `followConversion` de Matching.
- Una entrada solo sale por las dos vías de la sección 6.

### 5. Nodo en cada pestaña

- Nodo fijo «To review» / «Para revisar» en rekordbox, Engine DJ, Traktor, Serato y VirtualDJ,
  debajo de «Recently added». Mismas reglas que los otros nodos fijos de `SourceTree.tsx`: no se
  edita, no se arrastra, no recibe pistas.
- Muestra las pistas del programa cuya ruta (nueva o vieja) está en el almacén con ese programa
  pendiente. Se esconde cuando no hay ninguna.
- Una pista sin cues en ese programa no sale en su nodo: no hay nada que revisar (norma «no mostrar
  lo que no tenemos»). Se decide con los cues que la lista ya carga (`sourcePreview.cues`, el mismo
  dato del filtro «Sin cues»), así que no hace falta leer los cinco programas al acabar el trabajo.
  *(Decisión de diseño.)*
- Orden: primero las ámbar (sin mover), después por fecha de sustitución, la más reciente arriba.
- Fila: el icono verde (cues movidos) o ámbar (sin mover), cada uno con su `aria-label`. Sin texto.
- Recuento junto al nodo, como «Recently added».

### 6. Salir de la lista

- **Guardar cues de esa pista en el editor de una pista** (`CuesSection`): la quita de los
  programas a los que se escribe en ese guardado, incluidas las copias a sus gemelas en otros
  programas. «Guardar solo en este programa» la quita solo de ese. Se registra al guardar, aunque el
  programa esté abierto y la escritura espere en la cola. *(Decisión de diseño.)*
- **No cuentan** los guardados en lote (`CuesBatchSection`, auto cue sobre muchas pistas): nadie ha
  mirado esas pistas una a una. Por eso el gancho va en el guardado de una pista, no en el manejador
  general de `cues:save`. *(Decisión de diseño.)*
- **Botón «Reviewed» en el editor:** solo aparece si la pista está en el almacén. Sin confirmación.
  Aviso abajo a la izquierda (288 px, pila de avisos actual) con Deshacer, y ⌘Z lo deshace.
- «Reviewed» la quita de todos los programas a la vez.
- No sale por abrirla ni escucharla, ni caduca.

### 7. Editor

Junto al título de la sección «Cues», si la pista está en el almacén, una pastilla:
- verde con los milisegundos movidos (`+120 ms`);
- ámbar «not moved», y debajo el motivo en una línea («El fichero nuevo dura 41 s más. Los cues siguen
  como estaban.»).

Textos en los 5 idiomas, con tuteo, y medidos al ancho real.

## Restricciones

- Los cues de Traktor y Serato se escriben con el programa cerrado (colas actuales). Si el programa
  está abierto, el reapuntado y el desplazamiento esperan en su cola como hoy. La entrada del almacén
  se crea igualmente al acabar la sustitución.
- La medida y la copia de marcas de Serato necesitan el fichero viejo. Se mide contra el temporal
  ya terminado, **antes del renombrado** de `convertAudio`. Así el viejo sigue en su sitio aunque el
  nuevo vaya a ocupar su misma ruta y el ajuste no guarde copia en Originales. Si aun así no se
  puede leer, el resultado es `{ unmoved }` y la pista sale en ámbar. *(Decisión de diseño.)*
- La medida decodifica dos ventanas de cada fichero. No puede bloquear el proceso principal más de
  100 ms (norma «Surco instantáneo»).
- Pruebas con fixtures sintéticos, nunca con la colección de un DJ. Las pruebas reales se hacen con
  copia en rekordbox, Engine y Traktor. VirtualDJ se toca sin copia. Avisar a Vicent antes de tocar
  rekordbox o Music.
- TDD con test en rojo primero. Mutación de la medida y de la regla de fiabilidad.

## Preguntas abiertas para Vicent

1. **Serato y el rating:** reapuntar pierde las estrellas de la pista en Serato. ¿Lo aceptamos con
   aviso, o en Serato seguimos conservando el original (sin reapuntar) y solo copiamos los cues al
   fichero nuevo?

## Lo que decide quien lo construya

- La tolerancia exacta entre la medida del principio y la del final, y dónde caen las ventanas.
  Hay que fijarlas con un barrido sobre pares reales de sustituciones (norma «medir, no preguntar»).
- La lista cerrada de motivos de «sin mover» y su texto.
- Cómo se engancha el botón «Reviewed» a la pila de deshacer que ya exista.
- El orden de los commits dentro de cada fase.

## Fases (cada una mergeable)

1. Traktor sigue la sustitución con sus cues.
2. Serato sigue la sustitución con sus cues (según la respuesta a la pregunta 1).
3. Medida del desfase y desplazamiento en los cinco programas.
4. Almacén, nodo «To review», botón «Reviewed» y pastilla del editor.
