# Revision de accesibilidad de Surco desktop

## Resumen

1. La base es sólida y medida en la app real. Todo control tabulable muestra foco visible, los diálogos atrapan y devuelven el foco, el listbox tiene aria-selected, aria-setsize y posinset, la paleta es un combobox correcto y prefers-reduced-motion deja cero animaciones en marcha.
2. El problema más grave es el zoom (⌘+). A 200 % (viewport de 660 px) las columnas se superponen y el botón Convertir, los campos del editor y el botón de proceso quedan fuera de pantalla o con 24 a 44 px de ancho, sin scroll.
3. Tras convertir, el foco cae a BODY y el teclado pierde el sitio; el resultado solo se anuncia por un role=status.
4. Contraste en el límite o por debajo de 4,5:1 en texto de 11 a 12 px: texto secundario de fila seleccionada (~4,0), badges de formato y calidad en tema claro (3,9 a 4,5), contador del filtro de proveedor (3,3 en claro).
5. Objetivos pequeños (estrellas 16 px, borrar búsqueda 18 px, maximizar 20 px, marcas de cue 12 px), onda de cues sin alternativa de teclado propia (hay atajos de sección) y varias semánticas menores.

Método: Playwright _electron contra apps/desktop/out (sin recompilar), userData aislado, teclado (Tab, flechas, Escape, ⌘K), ariaSnapshot, emulación de forcedColors, reducedMotion, colorScheme y setZoomFactor, y 4 combinaciones tema x densidad. No hay axe-core en node_modules, así que el contraste se midió con un escáner propio y, donde el fondo era compuesto o semitransparente, con píxeles reales del elemento (PIL). Los scripts están en este directorio (lib.mjs, b1.mjs, b2.mjs, c1.mjs, e1.mjs, f1.mjs).

Lo que biome ya cubre (recommended incluye a11y) y no repito: alt en imágenes, button type, label for, noStaticElementInteractions (ya hay biome-ignore justificados), roles ARIA válidos, tabIndex positivo. El escáner no halló tabindex>0, ids duplicados, inputs sin nombre ni botones sin nombre accesible en ninguna superficie.

Verificado y correcto (no son hallazgos):
- Foco visible en todos los botones y filas por box-shadow (index.css:179-194). Con forcedColors activo el outline sigue siendo solid 2px, así que no se pierde en alto contraste.
- Settings, paleta y modales: foco entra, Tab cicla, Escape devuelve el foco al disparador. aria-modal y inert en el resto (useFocusTrap.ts).
- Paleta ⌘K: role=combobox, aria-controls, aria-activedescendant, aria-expanded, contador aria-live (CommandPalette.tsx:131).
- Lista de pistas: Shift+Flecha extiende la selección, Space abre el reproductor, tecla ContextMenu abre el menú y Escape devuelve el foco a la fila.
- prefers-reduced-motion: tras emular reduce no queda ninguna animación en ejecución.
- Toasts con aria-live polite y pausa al hover o foco (ToastStack.tsx:86, 141).
- Densidad Compact no cambia el contraste (mismos tokens) y los objetivos medidos son los mismos que en Normal.

## Hallazgos por impacto

### 1. Zoom 150 a 200 %+ rompe el layout (baja visión)
- Reproducir: ⌘+ (View > Zoom In) dos o tres veces sobre una ventana de 1320x820 con una pista cargada. Medido con setZoomFactor: a 1,5 el input de Discogs queda en 109 px; a 2 (viewport 660 px) el botón Convertir queda en x 709 a 826 (fuera de los 660 px), el campo Title mide 44 px y el botón de proceso 24 px; a 3 es idéntico. scrollWidth == clientWidth, así que no hay barra de desplazamiento y el contenido se recorta sin alcanzarse.
- Criterio: WCAG 1.4.4 Resize Text, 1.4.10 Reflow (adaptado a escritorio), 1.4.4 afecta sobre todo a baja visión que ya usa el zoom que el menú ofrece a propósito (appMenu.ts:121-125).
- Archivo: layout de columnas en App.tsx (anchos de columna por porcentaje y ColumnShares) y min de la ventana en main (1080x620 en píxeles de ventana, no CSS).
- Arreglo: fijar un min-width CSS al contenedor raíz (aprox. 1000 px) con overflow auto, o colapsar a una o dos columnas bajo ~900 px CSS (ocultar la columna de resultados Discogs tras un botón). Alternativa mínima: limitar el zoom máximo a 1,5 y subir el tamaño base de fuente en lugar de zoom.
- Esfuerzo: M a L.

### 2. Foco perdido tras convertir (teclado y VoiceOver)
- Reproducir: seleccionar una pista, Tab hasta "Convert to AIFF" (process-btn), Enter. document.activeElement pasa a BODY de forma inmediata y se queda ahí. El botón es reemplazado por la barra "Converted to AIFF" (ConvertFooter).
- Criterio: WCAG 2.4.3 Focus Order, 3.2.2; el siguiente Tab empieza desde el principio del documento. El mensaje sí se anuncia (role=status "✓ Converted to AIFF", ConvertFooter.tsx:427).
- Archivo: src/renderer/src/components/ConvertFooter.tsx (zona 427 a 540, donde el botón se sustituye por el estado).
- Arreglo: al cambiar a estado hecho, enfocar el primer control de la barra (por ejemplo el menú "..." o el botón de deshacer) o devolver el foco a la fila de pista activa.
- Esfuerzo: S.

### 3. Texto secundario de la fila seleccionada con ~4,0:1 (baja visión)
- Reproducir: seleccionar una pista, medir artista, duración y tono (track-artist, track-duration, track-key). Medido por píxeles, dark: 3,92 a 4,00; light: 4,11 a 4,24 (12 px, 11 px para el tono).
- Criterio: WCAG 1.4.3 (4,5:1 para texto menor de 18 px).
- Archivo: src/renderer/src/index.css:878, 894, 897 (color-mix de --color-on-row-selected al 72, 78 y 85 % de alfa sobre --color-row-selected).
- Arreglo: subir los porcentajes a 100 % del token o usar un token sólido (--color-on-row-selected-dim) calculado a >= 4,5. Tras ello, volver a medir track-duplicate en fila seleccionada (medido 2,35 dark y 2,9 light en el icono, que además es información, ver 4).
- Esfuerzo: S.

### 4. Badges de formato y calidad en tema claro por debajo de 4,5:1
- Reproducir: tema claro, lista con MP3, FLAC y WAV. track-format y track-quality (texto verde --color-good #33635c sobre fondo gris verdoso de 15 % de mezcla). Píxeles medidos 4,46 (fila normal) y 3,90 (fila con hover o fondo más oscuro). El indicador de duplicado (track-duplicate, text-fg-faint, rank no "best") mide 2,98 sobre fondo claro y 2,35 sobre fila seleccionada en oscuro, y transmite información ("hay una copia mejor").
- Criterio: WCAG 1.4.3 y 1.4.11 (iconos informativos, 3:1).
- Archivo: index.css:108 (--color-good en claro) y 919 (fondo mezclado de la píldora), TrackList.tsx:910-919 (text-fg-faint en track-duplicate), ListRow.tsx:26 (PILL_TEXT 11 px).
- Arreglo: oscurecer --color-good claro o bajar la mezcla del fondo de la píldora a ~8 %; usar text-fg-dim en lugar de text-fg-faint en el icono de duplicado.
- Esfuerzo: S.

### 5. Contador del filtro de proveedor con opacity-70 (baja visión)
- Reproducir: panel Discogs, botón "Filter results by source: All 24". El número usa opacity 0,7: 4,15 en oscuro, 3,31 en claro (12 px).
- Criterio: WCAG 1.4.3.
- Archivo: src/renderer/src/components/Select.tsx:306 (className "shrink-0 tabular-nums opacity-70").
- Arreglo: quitar la opacidad y usar text-fg-dim.
- Esfuerzo: S.

### 6. La onda de cues no tiene alternativa de teclado propia ni instrucciones (teclado, VoiceOver)
- Reproducir: abrir una pista con cues (p. ej. VirtualDJ > All tracks > primera pista). cue-wave es role="application" con tabIndex=-1, sin onKeyDown (CueWave.tsx:242-244); las marcas son botones de 12 px (CueWave.tsx:370-420). La edición por teclado existe a nivel de fieldset (CuesSection.tsx:1792, cueKeyAction en lib/cueKeys.ts: flechas, Intro, 1 a 8, M, Z), y las casillas y botones Tab sí llegan, pero nada anuncia estos atajos (no hay aria-keyshortcuts ni aria-describedby; grep sin resultados).
- role="application" desactiva el modo de lectura de VoiceOver sin explicar qué teclas responden.
- Criterio: WCAG 2.1.1 (cumplido de forma indirecta), 3.3.2 y 4.1.2 (instrucciones y nombre/rol).
- Archivo: CueWave.tsx:242-244; CuesSection.tsx:1785-1795.
- Arreglo: añadir aria-describedby en el fieldset a un párrafo sr-only con los atajos o aria-keyshortcuts; considerar role="group" en la onda en lugar de application. Hacer las marcas >= 24 px de zona con after:-inset (ya se hace en SectionHeader.tsx:210).
- Esfuerzo: S a M.

### 7. Objetivos de puntero menores de 24 px (motricidad)
- Medido (Normal y Compact): estrellas de valoración 16x16 (StarRating.tsx:54-62), discogs-query-clear 18x18, section-maximize 20x20 (tiene after:-inset-0.5, que lo lleva a 24), loudness-help-toggle 20x20 (LoudnessReadout.tsx:184), track-position 25x16, marcas de cue 12x12, casillas de Settings 16x16 (settings-source-*, settings-beta-updates; la etiqueta amplía el objetivo si es un label, comprobar), settings-search 126x20, chips de género 71x23 y 54x23.
- Criterio: WCAG 2.5.8 Target Size (Minimum), 24x24 CSS px.
- Arreglo: añadir el patrón ya usado after:absolute after:-inset-1 en estrellas, borrar búsqueda, ayuda de loudness y chips; hacer clicable toda la fila de checkbox.
- Esfuerzo: S.

### 8. Valoración por estrellas sin navegación de grupo
- Reproducir: Tab entra en las 5 estrellas una por una (cada una un tab stop, tabIndex 0), las flechas no hacen nada. Expone aria-pressed por estrella, de modo que VoiceOver lee "1 star pressed, 2 stars pressed, 3 stars, ...".
- Criterio: WCAG 4.1.2 y expectativa de patrón WAI-ARIA para valoración.
- Archivo: src/renderer/src/components/StarRating.tsx:36-62.
- Arreglo: role="radiogroup" con role="radio" y aria-checked solo en la estrella actual y flechas con roving tabindex; o conservar botones y marcar pressed solo en la estrella exacta.
- Esfuerzo: M.

### 10. Listbox de pistas con botones hijos
- Reproducir: ariaSnapshot del listbox "Tracks" muestra `option` seguidos de `button "Play"` como hermanos dentro del listbox. role="listbox" solo debe contener option o group (aria-required-children) y los Play (tabIndex -1, TrackList.tsx:1098) son un patrón que axe señalaría.
- Criterio: WCAG 4.1.2 (aria-required-children).
- Archivo: src/renderer/src/components/TrackList.tsx:1078-1130 y 1482-1484.
- Arreglo: sacar los botones de acción del subárbol del listbox (portal o posición absoluta fuera del role=listbox) o ponerlos aria-hidden ya que el atajo Space cubre la función.
- Esfuerzo: M.

### 11. Anillo de foco de 1 px en filas de resultados Discogs
- Reproducir: Tab hasta un discogs-result. El anillo es un inset de 1 px acento (computed: `rgb(122,162,247) 0 0 0 1px inset`), no el ring de 2 px (--ring) que usan botones y filas. En un resultado seleccionado o expandido casi se confunde con el borde de selección.
- Criterio: WCAG 2.4.7 y 2.4.13 (apariencia del foco, 2 px).
- Archivo: DiscogsPanel.tsx (clases de la fila discogs-result y discogs-track); regla base index.css:187-194 es sobrescrita por clases locales.
- Arreglo: no pisar el box-shadow en :focus-visible; si hace falta inset, usar 2 px.
- Esfuerzo: S.

### 12. Sin enlace de salto ni landmarks de región (lector de pantalla)
- Reproducir: ariaSnapshot muestra h1 "Surco", banner, navigation "Sources", complementary "Tracks", main. El h1 es el único del documento y luego saltan a h2 "File"; no hay enlace "saltar al editor". En el área del editor, cada sección usa h3 con botón acordeón (correcto). Al abrir la app el primer Tab recorre 6 botones de cabecera y 8 de la barra de fuentes antes de la lista (14 paradas).
- Criterio: WCAG 2.4.1 Bypass Blocks (adaptable en escritorio), 1.3.1.
- Arreglo: añadir un skip link visible al enfocarse hacia la lista y hacia el editor; o atajo F6 para ciclar regiones (ya hay atajos globales).
- Esfuerzo: S.

### 13. Cuatro role=status vacíos en la cabecera
- Reproducir: ariaSnapshot del banner muestra `status` x4 sin texto (Toolbar.tsx:183-198). Son regiones en vivo válidas pero VoiceOver las recorre en modo lectura como elementos vacíos.
- Criterio: WCAG 4.1.3 se cumple; ruido para lectores.
- Arreglo: sr-only o aria-hidden mientras estén vacíos, o fusionarlos en una sola región.
- Esfuerzo: S.

### 14. Mensajes de Discogs y análisis solo sr-only
- Reproducir: "Analyzing quality… 0/3" vive en un span role=status del banner (Toolbar.tsx:198) cuyo texto cambia con cada pista, lo que puede producir anuncios repetidos al ritmo del progreso (no lo probé con VoiceOver, es hipótesis).
- Criterio: WCAG 4.1.3.
- Arreglo: aria-live="polite" con aria-atomic y throttling (anunciar cada 10 % o al final).
- Esfuerzo: S.

### 15. aria-pressed y etiqueta cambiante a la vez en "maximizar sección"
- Reproducir: SectionHeader.tsx:207-208: aria-label alterna "Maximize the section" y "Restore", y además aria-pressed. VoiceOver dice "Restore, toggle button, on".
- Criterio: WCAG 4.1.2 (un cambio de estado se expresa de una sola forma).
- Arreglo: quitar aria-pressed y conservar la etiqueta cambiante, o conservar aria-pressed con etiqueta fija.
- Esfuerzo: S.

### 16. Cinco botones de grupo con aria-pressed como "segmented control"
- Reproducir: Settings > General (tema, densidad, idioma) son `group` con `button [pressed]`. Funciona, pero no hay flechas dentro del grupo (cada opción es un Tab stop: ocho paradas en Idioma).
- Criterio: patrón WAI-ARIA (radiogroup) y 2.4.3 eficiencia.
- Archivo: src/renderer/src/components/settings/GeneralTab.tsx.
- Arreglo: role="radiogroup" con roving tabindex.
- Esfuerzo: M.

### 17. prefers-contrast solo ajusta tintas
- Reproducir: index.css:149-156 sustituye fg-dim y fg-faint por fg-muted y las líneas por input-border. No toca el texto en 72 a 85 % de alfa (hallazgo 3) ni opacity-70 (hallazgo 5), así que con contraste alto sigue habiendo texto semitransparente.
- Criterio: WCAG 1.4.3 con preferencia del usuario.
- Arreglo: añadir en el mismo bloque `@media (prefers-contrast: more)` las reglas de 878/894/897 a 100 % y `.opacity-70 { opacity: 1 }` en el contexto de Select.
- Esfuerzo: S.

### 18. Texto de 11 px como tamaño base de etiqueta
- Reproducir: --text-label: 11px (index.css:17) se usa en pills, tonos, etiquetas de onda (hallazgo 4) y claves; no hay ajuste de tamaño de texto propio, solo el zoom del hallazgo 1.
- Criterio: WCAG 1.4.4 (no hay mínimo normativo, pero 11 px con contraste ~4,0 es el combo que más duele).
- Arreglo: subir --text-label a 12 px o añadir un ajuste "Tamaño del texto" en Settings.
- Esfuerzo: M.

## Quick wins (cada uno S, en orden)

1. Foco tras convertir (hallazgo 2), ConvertFooter.tsx.
2. Subir alfa del texto de fila seleccionada a 100 % (hallazgo 3), index.css:878, 894, 897.
3. Quitar opacity-70 del contador de filtro (hallazgo 5), Select.tsx:306.
4. Oscurecer --color-good claro y bajar la mezcla del fondo de la píldora (hallazgo 4), index.css:108 y 919.
5. Zona de clic ampliada con after:-inset a estrellas, borrar búsqueda, ayuda de loudness y chips (hallazgo 7).
6. Quitar aria-pressed duplicado de maximizar (hallazgo 15), SectionHeader.tsx:208.
7. Respetar el ring de 2 px en resultados de Discogs (hallazgo 11).
8. Skip link o F6 de regiones (hallazgo 12).
9. aria-describedby con los atajos de cues (hallazgo 6, parte barata).
10. Extender prefers-contrast a lo semitransparente (hallazgo 17).

## No comprobado

- VoiceOver real (solo árbol de accesibilidad de Chromium).
- Asistente de onboarding, USB export, MusicReview y modales de pago o donación no se recorrieron con teclado.
- Contraste medido por píxeles en tonos dark y light solo en las superficies Normal (Compact usa los mismos tokens; el escáner dio los mismos recuentos).
- Los falsos positivos del escáner de texto sobre canvas (etiquetas de espectrograma en claro, 1,23) se descartaron al inspeccionar la captura; no verifiqué el fondo real del canvas del espectrograma, queda pendiente de revisar a mano.
