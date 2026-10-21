# Flujo en fantasma

Fecha: 20/10/2026. Rama `worktree-fuentes-dj-playlists`. Simplifica el editor de cues de `2026-10-20-editor-cues-calma-design.md`.

## Para qué

Vicent, 20/10: "vamos a ver cómo podemos simplificar, vamos a centrarnos en mi flow. Si lo tengo seleccionado podría mostrar, cuando pongo el cursor encima, lo que dibujaría: el CAL donde rompe más 2 o 3 CAL + CUE hacia atrás, en modo ghosting. Si elijo solo 1 CUE a 32, mostraría ese CUE en modo ghosting hasta que pulse y confirme. Lógicamente si no elijo nada de mis flujos, el usuario añade cues o CAL de forma manual e individual." Sobre el texto de ayuda: "'Haz clic donde rompe' es cosa mía, hay que decir simplemente hacer clic".

Boceto aprobado: https://claude.ai/artifact/47sZMkqEzPxz1f296Da2cg

## Decisiones

1. El botón "Aplicar Mi flujo" / "Marcar dónde rompe" / "Marcar otro donde rompe" y la espera armada desaparecen. En su lugar, un selector de modo de Surco: "Flujo **Mi flujo** ▾" con los flujos (incluidos y del DJ) y, separado, **Manual**. Se guarda en los ajustes sincronizados (el flujo activo ya lo está; Manual es un valor más).
2. Con un flujo elegido, al pasar el cursor por la onda (tira plegada, tira y onda ampliada a pantalla completa) se dibuja en fantasma (semitransparente) lo que pondría el flujo si el donde rompe estuviera en el cursor, ajustado según Quantize: el CALL de ese punto y lo que el flujo genere hacia atrás o delante con sus colores, solo lo que cabe. Un fino marcador vertical en el cursor. Junto al selector, "Haz clic para colocar".
3. Clic confirma: coloca de una vez todo lo que se veía (un solo paso de deshacer). Es la misma operación que hoy "marcar donde rompe" con el flujo activo.
4. Con Manual no hay fantasma de flujo: a pantalla completa se ponen cues y CALL uno a uno (pads, "+ CALL", teclas); plegada, un clic abre la pantalla completa en ese punto.
5. Si la pista ya tiene donde rompe y se elige otro flujo, el fantasma muestra cómo quedaría (lo que se iría, apagado; lo nuevo, en fantasma) y aparece "Aplicar a esta pista". Nada cambia sin ese clic. Mientras no se pulse, colocar con el cursor usa el flujo elegido.
6. Sigue igual: borrar (✕ al pasar, clic derecho, "‹ + CALL › ✕", ⌫/Supr), Quantize, Guardar, Descartar, cola de rekordbox, copia, huella, `validWantedSet`.
7. Después, en otra tarea: las propuestas de la detección automática saldrán como fantasmas fijos sobre la onda con el resultado del flujo; clic acepta.

## Genérico, no solo "donde rompe"

Vicent, 20/10: "hay que ser genéricos, no todos los DJs pinchan igual. Y hay usuarios que no marcan donde rompe."

8. En la interfaz no se habla de "donde rompe": el cursor marca un **punto** y el flujo decide qué pone respecto a él. "Donde rompe" es solo cómo lo usa Vicent.
9. Marcar el punto con un CALL es una opción del flujo ("Marcar el punto con un CALL", sí por defecto en Mi flujo). Un flujo sin esa opción coloca solo lo que generan sus reglas, sin CALL en el punto.
10. Un flujo cuyas reglas no dependen del punto (por ejemplo, solo "desde el primer golpe" o "desde cada frase de rekordbox") no sigue al cursor: muestra en fantasma el resultado completo en cuanto se elige, con "Aplicar a esta pista". Un flujo que mezcla reglas con y sin punto sigue al cursor y el fantasma incluye también las que no dependen de él.
11. Al colocar un flujo cuyo punto no queda marcado con un CALL, la colocación es de una vez: Surco no podrá recalcularla después desde ese punto, igual que si se hubiera puesto a mano.

## Tras el recorrido de DJ

Vicent, 20/10, aprobando las propuestas del recorrido (`.superpowers/sdd/2026-10-20-flujo-fantasma/walkthrough-report.md`). Cambian las decisiones 2, 3, 5 y 6.

12. Vicent, 20/10: la tira general siempre navega y nunca coloca. A pantalla completa, clic o arrastre mueven el cabezal al golpe más cercano. Plegada, un clic abre la pantalla completa en ese golpe con cualquier modo, no solo con Manual. El fantasma del flujo se sigue viendo en la tira al pasar el cursor, pero se coloca solo en la onda ampliada, donde se ven los compases. "Haz clic para colocar" sale solo a pantalla completa, porque plegada el clic abre. La vista previa de Ajustes sigue siendo de solo lectura.
13. Vicent, 20/10: el fantasma enseña también lo que el flujo no pone, muy apagado y con contorno discontinuo, y una frase corta junto a la ayuda dice cuántas no caben y por qué. Los motivos son caer en la parte fuerte, chocar con otro punto, caer antes del primer golpe o después del último y pasar de 8 hot cues. Lo calcula el mismo motor que coloca, sin cambiar lo que coloca.
14. Vicent, 20/10: "Aplicar a esta pista" no aparece si el flujo elegido solo quitaría hot cues sin poner ninguna. En su lugar se lee "Este flujo no cabe en esta pista" con el motivo de la decisión 13. Un flujo que por diseño solo pone CALL (Solo CALL) sí se puede aplicar.
15. Vicent, 20/10: el punto se corrige desde su CALL. Arrastrarlo en la onda ampliada mueve el punto al compás o golpe de Quantize y vuelve a colocar su flujo allí, en un solo paso de deshacer. Borrarlo (✕, ⌫ o el menú) se lleva lo que el flujo generó desde ese punto, pero no lo puesto o cambiado a mano ni los bucles. Colocar, borrar el CALL y colocar en otro sitio da lo mismo que colocar limpio. Con Manual el CALL se mueve y se borra solo, como antes.
16. Vicent, 20/10: en la fuente rekordbox la sección Cues va la primera del editor, encima de Archivo y Metadatos, y se pliega y despliega como las demás. Si el DJ ordenó las secciones en Ajustes de forma distinta a la de Surco, se respeta su orden.
17. Vicent, 20/10: "N compases al CALL" cuenta hasta el siguiente punto, no hasta el CALL de una hot cue ni un bucle.
18. Vicent, 20/10: la tira general lleva una escala abajo con una muesca cada 32 golpes (8 compases, una frase de rekordbox), algo más marcada cada 128 golpes, en lugar de la muesca cada 16 compases de `2026-10-20-editor-cues-calma-design.md`. A la izquierda de la onda ampliada, fuera de ella, van los botones de acercar, restablecer y alejar, como en rekordbox, siempre visibles y desactivados en los extremos.
19. Vicent, 20/10: el único flujo que trae Surco se llama "Entrada" y pone una hot cue 16 compases antes del punto (dos vueltas de 32 golpes), con el CALL en el punto y el color de siempre. Sustituye a "Una cue a 32". Una copia guardada de "Una cue a 32" sin tocar pasa a ser "Entrada", también si era la elegida; si el DJ la cambió o le puso nombre, se queda como flujo suyo. "Subidón" es el nombre que Vicent dio a su flujo propio y no se toca. Vicent, 21/10: la distancia es de 16 compases, no de 64; una copia guardada de "Entrada" a 64 compases sin tocar pasa a 16.
20. Vicent, 21/10: se deshace la decisión 16. Cues sigue el orden de Ajustes › Secciones como las demás secciones, y en esa lista la fila de Cues dice "Solo en rekordbox".
21. Vicent, 21/10: Surco trae dos flujos, "Mix in 64" (una hot cue verde 64 golpes, 16 compases, antes del punto, el de por defecto) y "Mix in 32" (32 golpes, 8 compases), los dos con el CALL en el punto y con el mismo nombre en todos los idiomas. "Entrada" pasa a llamarse "Mix in 64". La lista muestra primero los dos de Surco, luego los flujos del DJ y al final Manual. "Solo CALL" deja de ofrecerse y una copia guardada sin tocar desaparece; si era la elegida, pasa a "Mix in 64"; si el DJ la cambió o le puso nombre, se queda como flujo suyo.

## Fuera de alcance

- La detección automática (se hace después sobre este mismo mecanismo).

## Cómo sabremos que está

- Con Mi flujo, al pasar el cursor se ven el CALL y las hot cues con sus CALL en fantasma, y un clic los coloca exactamente donde se veían.
- Con "Mix in 64" o "Mix in 32" solo se ve y coloca ese CALL y esa hot cue.
- Con Manual no aparece ningún fantasma de flujo.
- Cambiar de flujo en una pista marcada no cambia nada hasta "Aplicar a esta pista".
