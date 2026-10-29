# Buscar en Ajustes

Estado: **boceto y decisiones aceptados en conversación con Vicent (29/10)**.

Boceto: https://claude.ai/artifact/Ca8F2a9MpYbwPSM2bBwmUZ

## El caso

Ajustes ya tiene 14 pestañas y cada una varias secciones. Encontrar "dónde estaba lo de la
colección de Traktor" obliga a recorrerlas. Ajustes de macOS resuelve lo mismo con un campo de
búsqueda arriba de la barra lateral, y es lo que se copia aquí.

## Comportamiento

1. **Campo "Buscar ajustes"** arriba de la barra lateral del modal. ⌘F lo enfoca mientras el
   modal está abierto (fuera del modal ⌘F sigue siendo `find-replace`).
2. **Al escribir, la barra lateral se sustituye por la lista de resultados**, agrupados por
   pestaña en el orden de `SETTINGS_TABS`. Cada resultado muestra la etiqueta del ajuste con el
   término resaltado y, si coincidió por sinónimo, debajo "También: …". Encima, el número de
   resultados.
3. **El panel derecho sigue al resultado seleccionado**: abre su pestaña, hace scroll hasta el
   ajuste y lo enmarca. El primer resultado queda seleccionado al escribir.
4. **Teclado:** ↑/↓ mueven la selección por los resultados (el foco se queda en el campo), ↩
   enfoca el ajuste en el panel, esc vacía el campo y vuelve a las pestañas (un segundo esc cierra
   el modal, como hoy).
5. **Sin resultados:** "Ningún ajuste coincide con «x»" y una línea de ayuda; el panel derecho se
   queda en la pestaña que estaba.
6. **Vaciar el campo** devuelve la barra de pestañas con la pestaña del último resultado visto
   como activa.
7. **Al abrir el modal la búsqueda está vacía**, siempre; no se recuerda la anterior.

## Qué se busca

- **Índice explícito**, no el DOM: varias pestañas lanzan IPC al montarse (detección de Traktor,
  rekordbox, carpeta de config), así que no se pueden renderizar todas ocultas para buscar.
- Cada entrada: `{ tab, id, label }`, donde `label` es una **clave i18n** ya existente
  (`settings.traktorSync`, `settings.mp3Quality`…). Se busca en el idioma activo
  y el texto nunca diverge del que se ve.
- **Sinónimos** en i18n, `settings.searchSynonyms.<id>`, una lista separada por comas por idioma
  ("bitrate, kbps, CBR"). Solo en las entradas que lo necesiten.
- **Coincidencia:** subcadena, sin distinguir mayúsculas ni acentos (NFD sin diacríticos), sobre
  etiqueta y sinónimos. **Los textos de ayuda no cuentan**: daban resultados de ruido (buscar
  "traktor" sacaba "ALAC" y "Collection backups"). Orden: primero coincidencias en la etiqueta,
  luego por sinónimo; dentro de cada nivel, orden del índice.
- **Granularidad:** una entrada por sección con nombre y por campo de primer nivel. No por opción
  individual de un radio o segmentado.
- **Los nombres de pestaña también son resultados** ("Shortcuts", "Stats"), para que buscar una
  pestaña sin ajustes etiquetados no dé "sin resultados". Abren la pestaña arriba del todo.
- **Ajustes condicionales:** si un campo solo se pinta en ciertos casos (p. ej. la corrección de
  cues de Traktor), su entrada apunta al ancla de la sección que lo contiene, que siempre está.

## Anclas

- Los primitivos de `SettingsPrimitives.tsx` (`SettingsSection`, `SettingsField`,
  `SettingsCheckboxField`) aceptan un `searchId` que pintan como `data-search-id`. Las pocas
  etiquetas sueltas (`SettingsLabel` fuera de un `SettingsField`) se envuelven o reciben el atributo
  donde estén.
- Saltar = cambiar de pestaña, esperar al render, `scrollIntoView({ block: 'center' })` sobre el
  ancla y aplicarle un marco que se desvanece (respetando `prefers-reduced-motion`).

## Tests

- Lógica pura (`lib/settingsSearch.ts`): normalización de acentos, orden por nivel, agrupado por
  pestaña, sinónimos.
- **Integridad del índice:** cada `label`/sinónimo existe en los 6 idiomas, y renderizando
  cada pestaña existe un `data-search-id` por cada entrada suya. Este test es el que impide que el
  índice se quede atrás cuando se añade o mueve un ajuste.
- Escenario de `SettingsModal`: escribir "traktor" lista los resultados, ↓ cambia la pestaña,
  esc vuelve a las pestañas, sin resultados muestra el mensaje.

## Commits previstos

1. Renombrar la pestaña Search a Sources / Fuentes en los 6 idiomas. Independiente del resto.
2. `settingsSearch` (índice vacío + búsqueda) con sus tests.
3. `searchId` en los primitivos y anclas en las pestañas + índice completo + test de integridad.
4. Campo, resultados y salto en `SettingsModal` + escenario.
5. Textos en los 6 idiomas (sinónimos y mensajes).

## Decisiones cerradas

1. La pestaña Search pasa a llamarse **Sources / Fuentes** (el id interno `search` no cambia).
2. **Los textos de ayuda no se buscan**, solo etiquetas y sinónimos.
3. **La búsqueda arranca vacía** cada vez que se abre el modal.
