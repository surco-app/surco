# Botón partido de guardar en el editor de cues

Boceto aprobado: https://claude.ai/artifact/4thaj6DXoS4SraK3BctdhG (versión 3).

## Por qué

Vicent edita cues pista a pista en el editor a pantalla completa. Quiere guardar sin salir del editor y, si le conviene, guardar y pasar a la siguiente pista de un solo clic. El cierre al guardar era un bug aparte, ya arreglado (7c30a975a).

## Qué se construye

El botón de guardar del editor de cues pasa a ser un botón partido, «cuerpo | ⌄», en la vista a pantalla completa y en la sección plegada. Las dos usan el mismo menú (norma «single y multi homogéneos»).

El menú tiene todo lo que guarda y nada más.

```
✓ Save to rekordbox
  Save and go to next track
  ─────────
  Save N tracks to rekordbox      (solo con 2 o más pistas con borrador)
```

- Las dos primeras opciones son modos. Elegir una guarda en ese momento y la deja como acción del cuerpo. El modo se recuerda entre pistas y entre sesiones, como ajuste opcional (`cueSaveThen: 'stay' | 'next'`, por defecto `'stay'`).
- En modo «next», el cuerpo guarda y luego avanza la selección una fila en la lista visible, igual que la flecha abajo. El editor sigue a pantalla completa. Si el guardado falla, no avanza. En la última fila guarda y se queda.
- «Save N tracks» guarda todos los borradores, como hoy, y no se recuerda.
- «Discard changes» sale del menú y queda como botón propio junto al deshacer, también en la vista plegada.
- El texto del programa sale de la copia que ya tiene cada programa («Save to Engine DJ», «Save to Serato»…). Hay que añadir la variante «next» por programa en los 8 idiomas, con tuteo.
- El cuerpo reserva el ancho de la etiqueta más larga de los dos modos, así no cambia de tamaño (norma «sin cambios de tamaño»).
- El menú se abre hacia abajo en la barra superior del editor completo, anclado a la flecha.

## Qué no

- No hay «guardar y cerrar», porque es guardar y luego Esc.
- No cambia nada de cómo se guarda.

## Enfoques considerados

- **A.** El cuerpo siempre guarda y se queda, y el menú trae «siguiente» como acción suelta. Era más simple, pero obliga a abrir el menú en cada pista.
- **B.** El menú elige el modo del cuerpo y lo recuerda, con Descartar y Guardar todo dentro del mismo menú. Vicent vio que mezclaba cosas.
- **Elegido.** A que recuerda. El menú tiene solo lo que guarda, y elegir un modo lo ejecuta y lo recuerda. Descartar va fuera.

## Lo que decide quien lo construya

- De dónde sale «siguiente pista». La propuesta es una función `onStepTrack` que App pase hasta `CuesSection`, la misma `moveSelection(1)` que usan las flechas.
- Las etiquetas cortas de la vista plegada.
- Antes de cerrar, medir la fila plegada en los idiomas al ancho real (norma «errores visuales: no»).

## Cambio tras medir (24/11, variante C del boceto, versión 5)

La sección plegada desbordaba: 197 px disponibles frente a 325 a 419 px necesarios. Vicent quiere una sola línea y un botón con menos protagonismo.

- **Tono suave en las dos vistas.** El botón partido usa fondo `--color-accent-soft` con texto `--color-accent`, sin bloque de acento relleno. Sin cambios, sale atenuado como hoy.
- **Vista plegada:**
  - El cuerpo dice siempre «Save» (`editor.cues.saveShort`). En modo «next» añade un icono de flecha abajo dentro del cuerpo. La acción completa va en el `aria-label` y en el tooltip.
  - El cuerpo ya no reserva el ancho de «Save and next». La flecha es lo único que añade el modo «next», y ese hueco sí se reserva.
  - Descartar pasa a ser un botón icono, un círculo con ✕, con tooltip y `aria-label` «Discard changes». Es distinto del icono de deshacer.
  - La fila queda en una línea: borrar todo, deshacer, descartar y luego guardar.
- **Pantalla completa:** mantiene el texto completo y toma el mismo tono suave.
