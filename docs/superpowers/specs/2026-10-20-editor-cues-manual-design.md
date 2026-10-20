# Editor manual de cues a pantalla completa

Fecha: 20/10/2026. Rama `worktree-fuentes-dj-playlists`. Sigue a `2026-10-19-editor-cues-design.md`.

## Para qué

Vicent, 20/10, sobre la sección Cues: "es muy difícil trabajar ahí, falta la opción de pantalla completa". Y: "una cosa es trabajar automáticamente, y otra deberíamos ser capaces de hacerlo manual, bien pulsando atajos de teclado para poder movernos por 16, 32, o 64 (configurable) con las flechas, pulse C para centrar en el grid, y M para marcar el CAL. Luego rekordbox usa 1, 2, 3, 4, 5... para marcar los cue, y tenemos que poder ser capaces de cambiar el color". Pregunta: "¿crees que es posible hacer un editor real con todas las funcionalidades y no depender de rekordbox?".

Sobre Ajustes › Cues: "necesita una reorganización grande, es muy complejo de usar. Los colores imposibles de usar". Referencia: el selector de color de rekordbox (4×4 con marca y "Reset") y su pantalla de reproductor (onda general arriba, onda ampliada con cabezal, pads A a H, MEMORY con ◀ ▶ ✕, salto con ‹ 1 ›).

Boceto aprobado ("vamos a probar"): https://claude.ai/artifact/BVZqB1LH5NduFDhy7FmYCt

## Decisiones

1. La sección Cues se puede maximizar como Recorte, Normalizar y Clics. Plegada sigue como hoy; maximizada es el editor completo.
2. El editor se parece al reproductor de rekordbox: onda general con todas las cues, onda ampliada con el cabezal fijo en el centro, pads A a H, MEMORY, salto configurable.
3. Lo automático y lo manual conviven sobre el mismo borrador. "Aplicar flujo" sigue en la barra; un CALL suelto puesto con M es un donde rompe para el flujo.
4. Toda posición se ajusta al golpe de la rejilla de rekordbox (cuantizado siempre activo, como hoy). Vicent, 20/10, "los CUE o CAL siempre deben coincidir en el grid, eso es lo que rekordbox llama Quantize". En su captura un CALL quedaba entre dos líneas de compás porque se ajustaba al golpe y solo se dibujan los compases. Por eso el cuantizado tiene ahora un valor base como en rekordbox, Compás (por defecto) o Golpe, que se elige en la barra del editor ("Q Compás") y en Ajustes › Cues › Editor manual y viaja con los ajustes sincronizados. Toda cue puesta o movida a mano cae en el inicio de compás más cercano con Compás y en el golpe más cercano con Golpe. Los flujos siguen calculando por compases, las cues leídas de rekordbox no se mueven y el cabezal sigue libre; C lo centra en el compás o el golpe más cercano según el valor. Con Golpe la onda ampliada dibuja los golpes tenues entre las líneas de compás.
5. El selector de color es el de rekordbox: 4×4 en su orden, con la marca en el actual y "Restablecer" (hecho el 20/10 salvo "Restablecer").
6. Ajustes › Cues se reorganiza: flujos como pestañas, vista previa primero a todo el ancho, cada regla escrita como una frase cuyas palabras abren su lista.
7. Sigue sin escribir nada fuera de la cola de rekordbox: copia de seguridad, comprobación de huella y `validWantedSet`.

## Diseño

### 1. Pantalla completa

`SectionHeader` con `maximizable` y `sectionId="cues"`, como Normalizar. Maximizada, la sección ocupa la ventana y muestra, de arriba abajo:

- Cabecera: carátula, título, artista, posición del cabezal, tiempo restante, BPM y tono de la pista.
- Onda general: la de hoy (`CueWave`) con todas las cues y el cabezal. Clic lleva el cabezal a ese punto.
- Onda ampliada: el color de rekordbox a resolución completa (PWV5, 150 columnas por segundo), con rejilla de compases, cues y el cabezal fijo en el centro. La onda corre por debajo. Arrastrar en horizontal mueve el cabezal. Zoom con + y − entre 4, 8, 16, 32 y 64 compases visibles (16 al abrir). Encima del cabezal, la distancia al siguiente CALL en compases ("-16.0 compases al CALL"), como rekordbox.
- Barra: flujo y "Aplicar flujo"; pads A a H; MEMORY con ◀ ▶ ✕; salto ‹ N compases ›; "Descartar cambios" y "Guardar en rekordbox".
- Leyenda de teclas.

Plegada y sin maximizar, la sección es la de hoy.

### 2. Reproducción

Un `Audio` propio de la sección, como la escucha de Recorte: al reproducir se pausa el reproductor flotante. Suena desde el cabezal; mientras suena el cabezal avanza y la onda ampliada lo sigue. Saltar con el teclado o con clic mientras suena sigue sonando desde el nuevo punto. Al cerrar la sección, minimizarla o cambiar de pista, se para.

### 3. Teclado

Activo cuando el editor tiene el foco (siempre al maximizar) y nunca mientras se escribe en un campo:

| Tecla | Hace |
|---|---|
| Espacio | reproducir / parar desde el cabezal |
| ← → | saltar N compases (N de Ajustes, 16 por defecto) |
| ⇧← ⇧→ | saltar un golpe |
| C | llevar el cabezal al golpe más cercano |
| M | poner un CALL en el cabezal |
| 1 a 8 | hot cue A a H: si no existe, la pone en el cabezal con el color por defecto; si existe, lleva el cabezal a ella y la selecciona |
| ⌫ | borrar la cue seleccionada |
| ⌘Z | deshacer |
| + − | zoom |

Los pads hacen lo mismo con el ratón. Clic derecho en un pad con cue abre el selector de color.

### 4. MEMORY

- MEMORY (o M): CALL en el cabezal. Si ya hay uno a menos de 50 ms, no hace nada.
- ◀ ▶: cabezal al CALL anterior o siguiente.
- ✕: borra el CALL que está en el cabezal (a menos de 50 ms).

### 5. Salto configurable

Ajuste sincronizado `cueJumpBars`: 8, 16, 32 o 64 (16 por defecto), en Ajustes › Cues. El ‹ › de la barra lo cambia también y lo guarda.

### 6. Datos

- La onda a resolución completa se pide al maximizar con una lectura nueva de solo lectura (`rekordbox:cueWaveDetail`, por `contentId`), que devuelve las columnas de PWV5 en un formato compacto. Sin PWV5, la onda ampliada usa la general estirada.
- Las acciones nuevas son del borrador de hoy (`cueDraft`): poner hot cue con letra elegida en una posición, poner CALL, borrar, recolorear. Lo que falte se añade al reductor con sus tests.

### 7. Ajustes › Cues

Como el boceto:

- Arriba, los flujos como pestañas: "Mi flujo · en uso", "Una cue a 32", "Solo CALL", los del DJ, "+ Nuevo" y "Aprender de mi colección".
- Debajo, la vista previa a todo el ancho.
- Las reglas, una por línea, escritas como frase: "Desde **donde rompe**, **hacia atrás**, cada **16 compases**, **3 veces**, **si cabe**: pon **hot cue + CALL** ■■■". Cada palabra marcada abre su lista en un menú; los colores abren el selector de rekordbox.
- Nombre del flujo editable en la pestaña, "Usar este flujo", "Restablecer" y "Borrar flujo" junto a las reglas.
- Una tarjeta "Editor manual" con el salto de las flechas (8, 16, 32, 64).

## Fuera de alcance

- Bucles (siguen de solo lectura), editar la rejilla de golpes, desactivar el cuantizado.
- Onda calculada desde el audio: solo la de rekordbox.
- Velocidad, tono, ecualización o cualquier control de reproductor de DJ más allá de reproducir y parar.

## Cómo sabremos que está

- Con la sección maximizada se puede marcar una pista entera solo con el teclado: saltar, centrar, M, 1 a 8, color, guardar, y verlo igual en rekordbox.
- La reproducción suena desde el cabezal y la onda ampliada lo sigue sin saltos visibles.
- Ninguna tecla del editor actúa mientras se escribe en otro campo, y Espacio no abre el reproductor flotante con el editor enfocado.
- En Ajustes › Cues una regla se cambia con dos clics y se lee como frase; el selector de color se puede usar.
- Todo lo que se guarda pasa por la cola, la copia y la huella, como hoy.

## Riesgos

- Rendimiento de la onda ampliada: 45.000 columnas para una pista de 5 minutos. Se dibuja en canvas solo la ventana visible.
- Espacio y las flechas ya son atajos globales (reproductor flotante, cambio de pista). El editor enfocado los consume; hay que comprobarlo con el sistema de atajos de hoy (`useKeyboardShortcuts`, `data-shortcut-scope`).
