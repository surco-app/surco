# Ajustar rejilla en lote

## Por qué

En el editor de cues, el botón **Auto** de la rejilla (`autoFitGrid`, `CueGridControls`)
recoloca la rejilla sobre los golpes que Surco oye y arrastra con ella los cues y los CALL.
El usuario lo usa en cada pista nueva: abre la pista, y si el botón sale en acento, lo
pulsa lo primero. Dice que «casi siempre lo deja bien» y que en lote se fiaría y guardaría
sin mirar. Quiere hacerlo sin abrir el editor, sobre una o varias pistas seleccionadas, y
filtrar las que lo necesitan.

Decidido el 11/11/2026 sobre un boceto aprobado («vale, adelante»): artifact
`UjrkExMgfLSakgtxuQqDgZ`, tres pantallas (antes, después, lista).

### Lo que se midió

Un script desechable aplicó `autoFitGrid` (playhead 0, zonas activadas como en rekordbox) a
pistas reales de su rekordbox, sin escribir, y comparó antes y después. Se lanzó sobre
`Sesión del 11-9`, `Sesión del 11-10` (82 pistas, casi todas ya pasadas por Auto a mano),
`Aaron` (9), `Warm Up` (13) y `Cantaditas` (12).

- En pistas sin tocar (Warm Up + Cantaditas), 6 necesitaban ajuste y Auto arregló las 6:
  102→1 ms, 101→0, 84→7, 48→1, 15→0. Los cues se mueven lo que hace falta (hasta ~100 ms).
- En las que ya estaban bien, los cues se mueven como mucho 16 ms. Pero Auto **no es
  idempotente**: en ~25 de las 82 ya ajustadas añade 1 o 2 zonas de tempo nuevas.
- **Club Robbers - Search For The Ball (Pitcher's Club Mix)**: rekordbox 145 BPM con 3
  zonas, Surco oye 137,9. Como los tempos no casan, Auto tira las zonas y aplana. El final
  queda a 163 ms y los cues se mueven hasta 815 ms. Es el caso que el lote no puede guardar.
- **Then Jerico - The Motive '96**: necesitaba ajuste (15 ms) y Auto no lo mejora (19 ms).
- **2 Fabiola - Play This Song**: deriva de 3,3 ms/min antes y después. Auto no la arregla.
- **Carlos Tafalla - Everything**: Surco no encuentra golpes (`gridFit` null).
- **El filtro «Rejilla mal» actual no ve estas pistas.** Sobre las 116 medidas, el criterio
  del botón Auto marca 11 y `gridVerdictOf` (lo que usa el filtro) marca 1, sin solaparse.
  Las de 84–102 ms de desfase dan veredicto null: pasan de `period / 4` y salen de
  `steady`, o el `spread` supera `MAX_SPREAD_MS`.

## Objetivos

1. **Bloque «Rejilla» en el panel de varias pistas** (`CuesBatchSection`), debajo de Auto
   marcar. Con una o varias pistas seleccionadas en una playlist del programa:
   - Mide cada pista y dice «N de M no van con los golpes. Las otras K ya están bien y no se
     tocan». Mientras mide: «Midiendo la rejilla… X de M», y el botón espera.
   - Botón **Ajustar N pistas**. Solo actúa sobre las que necesitan ajuste.
   - Enlace **Verlas en la lista**, que enciende el filtro «Rejilla mal».
2. **Ajuste con guardas.** Para cada pista que lo necesita: `autoFitGrid` con los mismos
   argumentos que el editor (playhead 0) y los cues movidos igual que la acción `fit-grid` de
   `reduceDraft`. Después se vuelve a medir. Se aparta para revisar a mano, **sin tocarla**,
   si:
   - el peor desfase (inicio o final, como `gridOffsets`) sigue por encima de la tolerancia,
     o no baja respecto al de antes;
   - sigue teniendo veredicto (`gridVerdictOf` no null) después del ajuste;
   - algún cue o CALL se movería más de medio tiempo, medido con el periodo de la rejilla
     de antes en la posición del cue (la que el usuario ve). Mi decisión.
   Club Robbers, Then Jerico y 2 Fabiola caen aquí con los datos medidos.
3. **Resultado.** Recuento como el de Auto marcar: Ajustadas, Ya estaban bien, Sin golpes que
   medir, y **Para revisar a mano** en `--color-warn`. Debajo, una caja con las apartadas:
   nombre, motivo en una línea («Surco oye 137,9 BPM y rekordbox dice 145», «El ajuste no la
   mejora») y botón **Abrir** que la abre en el editor. Enlace **Deshacer el ajuste** que
   devuelve cada ajustada a como estaba antes del ajuste. Una que el usuario retocó después
   en el editor se queda como está. Mi decisión.
4. **Borradores, no escritura.** Las ajustadas quedan como borradores sin guardar, los mismos
   que deja el editor y que guarda el botón «Guardar N pistas en …» que ya existe en
   `CuesBatchSection`. Abrir una ajustada en el editor muestra el ajuste y se puede retocar.
5. **Filtro «Rejilla mal» con el mismo criterio.** Cuenta exactamente las pistas que el
   bloque llama «no van con los golpes». Cada fila sigue mostrando su nota (`gridNote`), que
   amplía a «Desplazada N ms» para las que detecta el criterio del botón.

## Criterio de «necesita ajuste»

Una pista necesita ajuste si se cumple cualquiera de estos:
- El criterio del botón Auto: `max(|hereMs|, |endMs|)` de `gridOffsets` mayor que
  `settings.cueGridTolerance`, con el playhead en 0 (inicio) en lugar del cabezal.
- `gridVerdictOf` da un veredicto (lo que el filtro ya detecta hoy, para no perderlo).

Mi decisión: la unión. Solo el criterio del botón dejaría de detectar las derivas que hoy
salen en el filtro; solo el veredicto no ve las de 100 ms. Una pista que solo tiene
veredicto y Auto no arregla (2 Fabiola) acaba en «Para revisar», que es lo correcto.

El criterio vive en un solo sitio (`shared/`, con el cabezal como parámetro) y lo usan el
filtro, el bloque y el botón del editor. El editor le pasa su cabezal; el lote y el filtro,
0. Al abrir una pista el cabezal está en 0, así que coinciden con lo que se ve al abrirla.

**Qué rejilla se mide.** Si la pista tiene borrador, se mide la rejilla del borrador, como
hace el editor (`needsFix` usa `ctx.beats`, la rejilla del borrador). Así, tras «Ajustar»,
las ajustadas salen del filtro aunque estén sin guardar (el filtro «Sin guardar» ya las
encuentra), y relanzar el lote las cuenta como «Ya estaban bien». Mi decisión.

**Dónde se mide.** Main ya cachea `gridFit` (`cachedBeatGrid`). La caché de veredictos de
main (`gridVerdictCache`) solo sirve para la rejilla guardada y para un veredicto sin
tolerancia, así que el criterio se calcula en el renderer a partir de `gridFit` + la rejilla
(guardada o del borrador) + `settings.cueGridTolerance`. Cambiar la tolerancia en Ajustes
recalcula el filtro al momento sin volver a decodificar. Mi decisión.

## No objetivos

- No se toca el algoritmo de `autoFitGrid`. Club Robbers y la no idempotencia se apartan con
  las guardas, no se arreglan aquí.
- No se guarda solo. Guardar sigue siendo el botón que ya existe.
- No se mide la biblioteca entera de golpe: se mide la selección y, con el filtro encendido,
  la playlist abierta, como hoy (`useGridVerdicts`, 2 workers).
- No cambia el editor de una pista salvo que su botón use el criterio compartido.

## Antiobjetivos

- Que el lote guarde una pista como Club Robbers con los cues a 800 ms. Esto es un fallo
  aunque todo lo demás funcione.
- Que volver a lanzarlo sobre una playlist ya ajustada toque pistas que estaban bien.
- Que el filtro y el bloque den números distintos para la misma playlist.

## Restricciones

- Programas: los mismos donde el editor ofrece Auto hoy (los que devuelven `gridFit`:
  rekordbox, Traktor, Engine DJ). Serato no tiene `gridFit` y no muestra el bloque. Mi
  decisión: medido solo en rekordbox; los demás usan el mismo código.
- La medida (`gridFit`) es cara: decodifica el audio. Ya está cacheada en main
  (`cachedBeatGrid`, `gridVerdictCache`). Reutilizar esa caché y la cola con prioridad baja.
- Una pista con borrador sin guardar se ajusta **sobre su borrador**, igual que Auto marcar
  parte de `keptDraftOn` (`cueAutoMark.ts`). Mi decisión, por conformidad con Auto marcar.
- Mismas puertas que el editor. El lote no ajusta una pista en la que el editor tiene Auto
  deshabilitado (`gridOff`: rejilla fija, provisional, sin `clockLeadMs`, borrador sobre la
  rejilla de Surco, zonas fuera de rekordbox, `gridFit` null); cuenta como «Sin golpes que
  medir» o «Para revisar» con su motivo. `zones` se pasa como el editor:
  `programOf(id) === 'rekordbox'`.
- Textos en los seis idiomas. Sin guion largo ni dos puntos de explicación en la UI.
- `data-testid` en todo lo nuevo. TDD.

## Lo que queda al constructor

- Dónde vive el estado del lote (junto a `useAutoMarks` en `cueSession` parece natural).
- Si la medida antes y después se hace en main (un IPC nuevo que devuelva el veredicto
  completo) o en el renderer con `gridFit` + `trackCues` como ahora hace el editor.
- El texto exacto de cada motivo de «Para revisar».
- Las guardas, en `shared/`, con tests sobre rejillas y fits sintéticos que reproducen los
  casos medidos: Club Robbers (145 BPM con 3 zonas frente a 137,9 oídos, cues a 815 ms),
  Then Jerico (15 → 19 ms), Alfonso Nicolás (145 BPM, 102 → 1 ms, cues ~100 ms, que SÍ
  debe pasar: la guarda de medio tiempo no puede apartar una corrección legítima de 100 ms
  con un periodo de 414 ms).
