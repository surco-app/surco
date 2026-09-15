# Sustituir una pista que ya está en la biblioteca

Estado: **publicado en v0.97.0** (15/09). La cadena está cableada a la conversión y las
cinco preguntas de pantalla quedaron decididas y construidas. Ver «Cómo se decidió cada
pregunta».

Depende del reapuntado de rekordbox, publicado en la misma versión y apagado por defecto.
Ver `spec-rekordbox-repunte.md`.

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
responde a la pregunta de dónde vive el fichero de una pista sin tocarla ni borrarla.

En la versión publicada la ruta vieja no se lee al convertir, sino que **viaja con la
pista**: se estampa como `replacesPath` cuando el usuario ve el botón de sustituir
(`replaceBeforeConvert.ts`) y llega al proceso principal dentro del trabajo
(`processTrack.ts:286`, `:322`). El matiz importa y está fijado en un comentario del
código: la ruta sale del candidato que se le enseñó al usuario, **nunca de una consulta
fresca**, porque la respuesta de Music cambia en cuanto una sustitución anterior reapunta
esa entrada.

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

## Cómo se decidió cada pregunta (15/09)

1. **El botón.** Dice «Sustituir» en lugar de convertir, no además (`exportLabel.ts`,
   `useLibraryVerdict.ts`). Con varias pistas seleccionadas la decisión se toma **sobre la
   selección entera**, no pista a pista: si todas sustituyen es una sustitución, si ninguna
   lo hace es un añadido, y **una selección mixta se rechaza** con el botón deshabilitado
   diciendo por qué (`replaceSelection.ts`, `85fec2aa`). La razón está escrita en el
   código: un solo clic haciendo dos cosas distintas a pistas distintas es justo la forma
   de fallo que ya costó un día aquí, un botón cuya etiqueta prometía una acción mientras
   el clic ejecutaba otra.

2. **Qué significa sustituir en Apple Music.** Sigue siendo añadir y borrar por debajo, en
   un solo paso (`replaceAppleMusicCopy`, `processTrack.ts:127`). No se le cuenta al
   usuario el instante de dos entradas: se le presenta como una sustitución. Lo que sí se
   fija es el orden — **se añade antes de borrar**, para que el peor caso sean dos copias
   visibles y recuperables en vez de una pista fuera de la biblioteca.

3. **El fichero viejo en disco.** Se pregunta, no se decide por él. La sustitución **deja
   el fichero** («the superseded MP3 stays on disk for the user's own trash original to
   decide», `processTrack.ts:125`) y al terminar se ofrece mandarlo a la papelera, de una
   pista o del lote entero en una sola acción (`supersededFile.ts` 29409b1c,
   `selectionStatus.ts` 72c573e9).

   Con una vuelta de tuerca que no estaba prevista: antes de prometer papelera se le
   pregunta **al sistema de ficheros** si el borrado es recuperable (`trashSupport.ts`,
   983b01a1). APFS, HFS y exFAT la guardan; un SMB no, y ahí el aviso dice que el borrado
   puede ser definitivo. Es lista blanca, así que un sistema de ficheros imprevisto lee
   como «sin promesa» — la dirección segura, y la que ya costó un fichero cuando un diálogo
   prometió una papelera que el NAS no tenía.

4. **Qué pasa si falla a mitad.** Se aceptó la segunda opción: no hay deshacer. Un repunte
   rechazado **no cancela** la sustitución, porque el fichero ya está en disco y la copia de
   biblioteca sigue mereciendo actualizarse; el motivo viaja hacia arriba y se cuenta en el
   panel de actividad.

5. **Las 34 ambiguas.** No se pregunta cuál conservar: **no se sustituye**. Una coincidencia
   ambigua no estampa nada y la conversión añade en vez de sustituir, porque sobrescribir a
   ojo puede destruir la canción equivocada y el añadido es el resultado seguro
   (`replaceBeforeConvert.ts`). El botón tampoco ofrece sustituir (`Editor.tsx:1339`), y en
   un lote una ambigua basta para declararlo mixto. Qué enseñarle al usuario en ese caso
   sigue sin decidir, igual que en la spec de rekordbox.

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

**Paso 3. La cadena completa, todavía sin pantalla. HECHO 13/09 (005ce22f, 5e9e01cc).**
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

**Paso 4. Cableado a la conversión. HECHO 15/09 (447bc2e5, 01786d49, 53d18fe3).**
`processTrack.ts` ya no añade una copia nueva y ofrece borrar la vieja: cuando el trabajo
trae `replacesPath`, sustituye la copia de la biblioteca (`:322`) y deja el fichero
superado accesible para que el renderer pueda ofrecer la papelera (`:397`).

**Paso 5. El aviso de pérdida de calidad, en pantalla. HECHO 15/09.**
`replaceWarning.ts` ya estaba construido en el paso 2; aquí se conectó a la ficha. Informa
y deja seguir, nunca bloquea, como se decidió el 12/09.

## Lo que sigue abierto

**Qué enseñar ante una pista ambigua.** Hoy el efecto es correcto y conservador — no se
sustituye, se añade — pero el usuario no recibe explicación de por qué el botón no le
ofrece sustituir una pista que sí está en su biblioteca. Es la misma decisión pendiente
que la spec de rekordbox deja abierta para tomarla sobre tandas reales.

## Verificación, no negociable

**Nunca contra su colección real ni contra su biblioteca de Apple Music.** Siempre sobre
copias, con rekordbox cerrado, y abriéndolo después para comprobar a ojo que las playlists
y los cues siguen.

Apple Music no se puede copiar como se copia un fichero, así que las pruebas de la parte
de Music tienen que usar una pista de prueba que se añade y se borra, nunca una suya.
