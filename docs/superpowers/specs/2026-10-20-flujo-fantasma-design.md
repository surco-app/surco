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

## Fuera de alcance

- La detección automática (se hace después sobre este mismo mecanismo).

## Cómo sabremos que está

- Con Mi flujo, al pasar el cursor se ven el CALL y las hot cues con sus CALL en fantasma, y un clic los coloca exactamente donde se veían.
- Con "Una cue a 32" solo se ve y coloca ese CALL y esa hot cue.
- Con Manual no aparece ningún fantasma de flujo.
- Cambiar de flujo en una pista marcada no cambia nada hasta "Aplicar a esta pista".
