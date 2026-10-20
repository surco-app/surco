# Editor de cues, con calma

Fecha: 20/10/2026. Rama `worktree-fuentes-dj-playlists`. Rediseña la sección Cues de `2026-10-20-editor-cues-manual-design.md`.

## Para qué

Vicent, 20/10, viendo el editor a pantalla completa: "me parece muy feo lo que estamos haciendo, necesitamos mejorar el diseño". "Como experto ingeniero de Apple en diseño y usabilidad, deberíamos mejorar sencillez, minimalismo, usable... mejorar incluso lo que hace rekordbox en sencillez." Antes: el flujo "es importante, debería tener más importancia, porque es algo que sí funciona; tal vez no se use lo manual, solo para corregir". Y: "otra cosa que confunde es que mi flujo espera tener CAL".

Boceto aprobado ("vamos a probarlo"): https://claude.ai/artifact/Szq9X6ujtFqNcx7sRCET5t

## Decisiones

1. La onda es la protagonista; el resto se aparta. Nada de texto ni botones encima de la onda.
2. Una acción principal arriba. El botón primario dice lo que va a pasar:
   - sin ningún donde rompe en la pista: **"Marcar dónde rompe"**. Al pulsarlo, el siguiente clic en la onda (o M) marca donde rompe y el flujo activo se aplica solo. Mientras espera, la onda muestra "Haz clic donde rompe" de forma discreta y Escape lo cancela;
   - con al menos un donde rompe: **"Aplicar Mi flujo"** (con el nombre del flujo activo). Su flecha abre la lista de flujos.
   Así nunca hay un botón que no hace nada, y el usuario no necesita saber que un donde rompe se guarda como un CALL.
3. "Guardar en rekordbox" va en la misma barra, a la derecha. "Descartar" es un texto que solo aparece cuando hay cambios.
4. La onda general es una tira fina de navegación: media onda, marcas en una fila encima (el CALL detrás de su hot cue, como rekordbox), un rectángulo suave con la parte que se ve en la onda ampliada. Clic o arrastre mueve el cabezal. Sin etiquetas DROP, sin rejilla densa; una muesca abajo cada 16 compases.
5. La onda ampliada ocupa todo el alto libre, sin caja y sin botones dentro. Cabezal fino en el centro; a su izquierda el tiempo del cabezal, a su derecha "N compases al CALL" en gris. Zoom con + y − del teclado y con el gesto del trackpad (pellizco o ⌘ + rueda). Rejilla: línea suave por compás, más visible cada 16 con muesca abajo; sin golpes sueltos.
   Vicent, 20/10: en pantalla completa una onda tan grande es horrible. La onda ampliada tiene ahora un alto fijo y cómodo (entre 160 y 240 px, como la vista ampliada de rekordbox) y deja un 10 % de aire arriba y abajo para que una pista fuerte no toque los bordes. Cabecera, tira, fila del tiempo, onda ampliada y barra de abajo forman un solo bloque centrado en vertical; una ventana alta añade calma alrededor en vez de estirar la onda, y la barra queda justo debajo de la onda. En macOS el bloque empieza por debajo de los botones de la ventana.
6. Abajo, una barra pequeña para corregir: Play/Pausa, pads A a H pequeños (llenos con su color, vacíos con borde punteado; clic derecho cambia el color), "‹ + CALL ›" (anterior, añadir, siguiente) y "Salto 16 compases ▾" como menú. Desaparecen MEMORY en mayúsculas, la ✕ (borrar es ⌫ con la cue seleccionada), los + − flotantes, la leyenda (ya en el botón de teclado) y el espacio vacío.
7. Cabecera: carátula, título y artista; a la derecha, en gris pequeño, duración · BPM · tono; los botones de teclado y de restaurar.
8. Plegada, la sección muestra la tira de onda con las marcas, el botón principal (decisión 2) y "Guardar". Para corregir a mano, ⤢.
9. Todo sigue igual por debajo: el borrador, la cola de rekordbox, la copia de seguridad, la huella, `validWantedSet`, las teclas y sus reclamaciones a pantalla completa, el sonido.

## Fuera de alcance

- La detección automática de donde rompe (se mide aparte; si llega, propondrá marcas en el modo de la decisión 2).
- Cambiar qué guarda Surco en rekordbox.

## Cómo sabremos que está

- A pantalla completa, sin leer nada, se entiende qué hacer: el botón principal dice "Marcar dónde rompe" o "Aplicar Mi flujo".
- Marcar dónde rompe con un clic aplica el flujo sin otro paso.
- Nada se dibuja encima de la onda salvo el cabezal y las marcas en su franja.
- No queda espacio vacío bajo la barra de herramientas.
