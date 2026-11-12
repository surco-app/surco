# Revision de diseno: Surco desktop (principios de Apple)

Resumen
1. La base es sólida: tokens de tema, `.press` en 93 componentes, view transition al cambiar de tema, reduced-motion y reduced-transparency cubiertos, tracking por tamaño de texto. No hay fallos graves.
2. El mayor hueco de diseño está en el editor de cues maximizado: aparece de golpe, tapa toda la ventana y no tiene origen espacial.
3. Las superficies de trabajo del DJ (marcadores de cue, iconos de rejilla, estados deshabilitados) son pequeñas y de poco contraste.
4. El tema claro es plano y gris: el panel y el fondo casi no se separan, y la fila seleccionada pesa poco.
5. Dos acciones "Convertir" a la vez (barra superior y pie del editor) con etiquetas distintas.

Alcance honesto: capturas reales en oscuro y claro (lista, editor, cues normal y maximizado, Settings, paleta, árbol de VirtualDJ, Compact). No pude medir la duración real de transiciones con capturas de Playwright (cada captura tarda más de 100 ms), así que lo de movimiento sale del código y de que el primer fotograma tras el clic ya era el estado final. No probé la caja de cierre (nativa) ni el Traktor.
Capturas en /private/tmp/claude-501/-Users-vicent-code-surco/67320b12-9df1-495b-ba11-01b7b0364003/scratchpad/review/shots/

## Hallazgos por impacto para un DJ

### 1. El editor de cues maximizado entra y sale sin movimiento ni origen (M)
- Visto: `dark-cues-max.png`, `max-30.png`. Un clic en el icono de maximizar y el primer fotograma ya es pantalla completa, cubriendo barra superior, raíl y listas.
- Principio: consistencia espacial (entrar y salir por el mismo camino, origen en el disparador); wayfinding. Con la ventana entera tapada el DJ pierde el contexto de qué pista edita (hay un título pequeño arriba, ver 6).
- Código: `components/Editor.tsx:1960-1968` (portal `fixed inset-0 z-[46]`, sin transición); `components/CuesSection.tsx:1011` (rama `maximized`).
- Arreglo: animar con un View Transition o `transform/opacity` desde el rectángulo de la sección (240 ms, `--ease-standard` o un spring sin rebote), igual a la salida; con reduced-motion, corte seco. Además dejar la barra superior visible (inset-top) para mantener el contexto.

### 2. Marcadores de cue de 12 px con letra de 10 px (S)
- Visto: `dark-cues-compact.png` y el panel de cues de `cues-grid.png`. Las letras A-H sobre la onda son cajitas diminutas y hay que acertar en 12 px para arrastrarlas.
- Principio: diseño para el acierto (objetivo táctil/puntero mínimo), ley de Fitts. En la vista maximizada sí son grandes (`dark-cues-max.png`), lo que confirma que la versión normal queda corta.
- Código: `components/CueWave.tsx:446` (`h-3 w-3 ... text-[10px]`).
- Arreglo: área de golpe invisible de 20-24 px (padding o `::before`) sin cambiar el dibujo; o 16 px en normal.

### 3. Herramientas de rejilla del modo maximizado: iconos sin etiqueta y casi invisibles (S)
- Visto: `dark-cues-max.png`, fila inferior (los 8 iconos tras "133.99 / Auto"): atenuados, sin texto, indistinguibles entre sí.
- Principio: familiaridad y feedback (estado deshabilitado debe leerse como "disponible con condición", no como "ruido"); agrupar y mapear.
- Código: `components/CueGridControls.tsx` y `components/CueDeck.tsx:218,238` (`disabled:opacity-40`).
- Arreglo: tooltip con atajo en el primer hover inmediato y, mejor, deshabilitar solo lo que no aplica con motivo visible ("Selecciona un cue"); subir a 55-60 % de opacidad.

### 4. Dos botones de convertir distintos a la vez (S)
- Visto: `light-vdj-tree.png`: arriba "Convert 1 selected", abajo "Convert to AIFF" (barra grande azul); en `dark-list.png` arriba "Convert 3 tracks" y abajo "No changes / Update anyway".
- Principio: simplicidad y claridad de agencia: dos verbos para una acción confunden qué se va a escribir y dónde ("Saves to Surco" arriba del botón).
- Código: `components/Toolbar.tsx:170` y `components/ConvertFooter.tsx`.
- Arreglo: unificar texto ("Convertir 1 pista" en los dos) o dejar el superior solo para el lote. Es decisión de producto, flaggeo el conflicto.

### 5. Titulos que se cortan justo donde está la diferencia (S)
- Visto: `dark-compact-vdj.png`: seis filas "Pray (W.I.P. In The C…" casi idénticas; lo que las distingue (Mix, formato) está al final. El tooltip/marquee existe pero exige parar el ratón.
- Principio: el contenido es el protagonista; reconocimiento sobre recuerdo.
- Código: `components/TrackList.tsx:772-777` (`truncate` por la derecha).
- Arreglo: truncado en el medio para títulos con paréntesis final (conservar "(…Mix)"), o repartir el ancho: la columna de resultados ocupa un tercio fijo de la ventana mientras la lista queda en ~280 px.

### 6. Columna de resultados con peso mayor que la lista de pistas (M)
- Visto: todas las capturas de 1320 px: lista ~290 px, resultados ~270 px, editor ~460 px. Con una pista cargada, la zona de "Best match" se come la atención del DJ que solo quiere editar cues.
- Principio: jerarquía y simplicidad; lo contextual no debe pesar como lo principal.
- Código: `App.tsx` (`resultsWidth` en ajustes, plegable con el botón `results-fold`).
- Arreglo: plegar automáticamente al abrir un cue editor o cuando el usuario trabaja en un programa DJ sin búsqueda activa; recordar el estado por origen.

### 7. Tema claro plano: fondo y panel casi iguales (S)
- Visto: `light-vdj-tree.png`, `light-cues-hover.png`. Fondo `#d6d8df` y panel `#e6e7ed`: la jerarquía de capas se pierde; la fila seleccionada `#c1cee5` es sutil y los bordes de campos (`#707280`) pesan más que el contenido.
- Principio: materiales y profundidad (capas que se distinguen), contraste por jerarquía.
- Código: `index.css:93-116`.
- Arreglo: separar más `--color-ink` y `--color-panel` (p. ej. panel casi blanco), o sombra suave bajo las tarjetas; suavizar `--color-input-border` y dejar el borde fuerte solo en foco.

### 8. Estado deshabilitado de "Analyze/Match/Review" casi ilegible (S)
- Visto: `dark-vdj` y `dark-compact-vdj.png`: "Analyze" a muy bajo contraste cuando no hay trabajo.
- Principio: feedback: lo inactivo debe seguir diciendo por qué.
- Código: `components/Toolbar.tsx:233,284`.
- Arreglo: opacidad 55 % y tooltip con motivo ("Todas las pistas analizadas").

### 9. Avisos de duración distinta como triángulo sin texto (S)
- Visto: lista de resultados, filas B1/B2 con triángulo ámbar y "6:00" frente a 7:06.
- Principio: feedback por tipos: el icono avisa sin explicar; el DJ sabe mejor que nadie qué significa una duración distinta (otra mezcla).
- Código: `components/DiscogsPanel.tsx` (`track-length-mismatch`).
- Arreglo: mostrar la diferencia ("-1:06") junto a la duración en lugar de solo el icono.

### 10. Opciones de Settings sin jerarquía clara en General (S)
- Visto: `dark-settings.png`: el selector de idioma deja una celda vacía en la segunda fila; "Appearance" y "Density" son controles segmentados de distinto ancho, sin alinear con el resto.
- Principio: agrupar y mapear; alineación.
- Código: `components/SettingsModal.tsx` (idioma, 7 opciones en 4 columnas).
- Arreglo: 4+3 con la última fila centrada, o lista de 7 en 2 columnas.

### 11. Paleta de comandos recortada sin indicación de scroll (S)
- Visto: `dark-palette.png`: la última fila se corta a mitad ("Auto-match all tracks" cortada) sin degradado.
- Principio: pistas de wayfinding (hay más por debajo).
- Código: `components/CommandPalette.tsx`.
- Arreglo: máscara de degradado de 16 px en el borde inferior, como ya hace `editor-scroll-fade`.

### 12. Atajos en la paleta: los deshabilitados siguen mostrando atajo sin motivo (S)
- Visto: `dark-palette.png`: "Undo last metadata edit ⌘Z" en gris sin explicar.
- Principio: feedback y agencia.
- Arreglo: segunda línea corta con la razón ("Sin ediciones") o ocultar el atajo.

## Quick wins (todas S)
- Hallazgo 2: área de golpe de 24 px en marcadores de cue.
- Hallazgo 3: subir opacidad de iconos deshabilitados y añadir tooltips.
- Hallazgo 4: unificar etiqueta de "Convertir".
- Hallazgo 8, 11: contraste de lo inactivo y degradado de scroll en la paleta.
- Hallazgo 9: mostrar la diferencia de duración, no solo el triángulo.

## Lo que está bien y no tocaría
- `.press` con scale(0.97) en `:active` a 120 ms (`index.css:777-782`) responde al pulsar, no al soltar.
- Cambio de tema con View Transition y salida limpia con reduced-motion (`hooks/useSettings.ts:131-137`).
- Escala de tracking por tamaño (`index.css:18-23`).
- Modales con desenfoque de fondo y fallback en `prefers-reduced-transparency` (`index.css:158`).
- Onda en el color de acento, con verde/ámbar solo para estados.
