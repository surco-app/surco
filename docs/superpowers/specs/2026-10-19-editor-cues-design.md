# Editor de cues y flujos configurables

Fecha: 19/10/2026. Rama `worktree-fuentes-dj-playlists`.

## Para qué

Vicent marca sus pistas así: busca donde rompe la canción, pone ahí un CALL (memory cue) y, hacia atrás, hot cues con su CALL al lado, cada 16 compases y con un color por distancia. Hoy Surco hace eso con las reglas fijas de `cues.py` (plan B de "Llevar a rekordbox": sección Cues del editor). Lo que falta, en sus palabras:

- "Esto es mi flujo, no todos los djs hacen lo mismo, debería poder configurar mi flujo." "Hay djs que solo ponen 1 cue 32 compases antes de que rompa, otros no ponen." "Se pueden dar muchas combinaciones, debemos ser capaces de construir algo que permita a cada uno hacerse sus reglas."
- Retocar a mano lo que sale: en la sesión de `cues.py` corrigió a mano "sobraba la H", "D sobra", "B cae en la parte fuerte". Hoy eso solo se puede hacer en rekordbox.
- Un botón "Auto" que proponga dónde rompe, sin aplicarlo solo: "por ahora no haría detección automática, aunque si crees que se puede hacer, podríamos montar un editor de cues y cal, con un botón de auto, o CRUD de cal y cues manual."

Se trabaja pista a pista, en el editor.

## Decisiones de Vicent

1. Reglas por bloques (enfoque A del 19/10): cada regla se lee como una frase hecha de bloques que se eligen, sin escribir. Nada de reglas como código ("la C no la van a entender los djs, como mucho algo con bloques").
2. El configurador vive en Ajustes, en su propia pestaña: no hace falta tener una pista seleccionada. Su vista previa usa una pista de ejemplo.
3. Su flujo de hoy es el de partida, idéntico a `rules.py`.
4. El CALL que acompaña a una hot cue se dibuja a la misma altura que ella, detrás, y la hot cue por delante, como hace rekordbox; un CALL suelto va a esa misma altura (boceto "Configurador de cues", https://claude.ai/artifact/S3bRmjsDFmeNe7ENkYsQFC). Vale para el configurador, la sección Cues y la onda de la lista. Vicent, 20/10: los CUE y CAL deberían solaparse, los CUE por delante como hace rekordbox; sustituye al CALL debajo de la hot cue.
5. Los CALL no tienen color propio: rekordbox no deja cambiarlo. Siempre rojos.

## Diseño

### 1. Flujos y reglas

Un **flujo** es una lista ordenada de reglas con un nombre. Hay un flujo activo. Se guardan en los ajustes (`cueFlows`, `activeCueFlow`) y viajan con la exportación de configuración que ya existe.

Una **regla** son estos bloques, en este orden:

| Bloque | Valores |
|---|---|
| Desde | donde rompe · primer golpe · último golpe · cada frase de rekordbox de un tipo (intro, subida, bajada, estribillo, outro) |
| Sentido | hacia atrás · hacia delante |
| Distancia | N compases (0 a 128; 0 es en el mismo golpe) |
| Repetir | 1 vez · N veces · hasta el borde de la pista |
| Condición | siempre · si cabe (no antes del primer golpe ni después del último) · si no cuadra con otra regla (la cue que pondría esa regla no cae en el mismo compás) · si no hay otra antes de donde rompe (ninguna regla anterior puso una cue antes del primer donde rompe) |
| Pon | hot cue · CALL · hot cue + CALL |
| Color (hot cue) | uno fijo · uno por repetición (primera, segunda, tercera…) |

Reglas globales del motor, iguales que hoy en `cueRules.ts`:

- Las hot cues van en orden de tiempo con las letras de rekordbox (`HOT_KINDS`, A a H). Máximo 8.
- Si un flujo pide más de 8, se quitan primero las de mayor distancia a su origen, y el usuario ve cuáles sobran (hoy: `TRIM_ORDER` 48 y luego 32).
- Dos cues a menos de 50 ms son la misma (`SAME_POSITION_MS`).
- Toda posición se ajusta al golpe más cercano de la rejilla de rekordbox (`nearestBeat`).
- Nunca se pisa trabajo a mano: si las hot cues que ya tiene la pista no encajan con el plan, solo se escriben los CALL y se avisa (hoy `fitsPlan`).
- Un CALL que pone una regla "Pon CALL" no cuenta como donde rompe la vez siguiente, para que el flujo no se multiplique al completar al cerrar. Si dos donde rompe de verdad quedan justo a la distancia de esa regla, el primero se lee como su CALL: se conserva, pero no genera su propia cuenta atrás. No afecta a "Mi flujo", que no tiene reglas solo de CALL.

**Flujos incluidos**, editables y borrables salvo "Mi flujo", que se puede editar pero vuelve a su estado con "Restablecer":

- **Mi flujo** (el de `rules.py`):
  1. Desde donde rompe, hacia atrás, 16 compases, 3 veces, si cabe: hot cue + CALL, colores azul (1), verde (22) y rojo (42) por repetición.
  2. Desde el primer golpe, en el mismo golpe, si no hay otra antes de donde rompe: hot cue + CALL, amarillo (32). (Así lo hace hoy `planCues`: la condición "no cuadra" leída como "otro compás" rompería la paridad.)
- **Una cue a 32**: desde donde rompe, hacia atrás, 32 compases, 1 vez, si cabe: hot cue, verde.
- **Solo CALL**: ninguna regla. Marcar donde rompe deja solo el CALL.

**Criterio duro:** "Mi flujo" evaluado con el motor genérico da exactamente lo que da hoy `planCues` + `cueChanges` en todos los casos de `cueRules.test.ts` (el port de `test_cues.py`). Esos tests pasan sin cambiar una línea.

### 2. Configurador (Ajustes › Cues)

Como en el boceto: a la izquierda la lista de flujos y "Nuevo flujo"; en el centro las reglas del flujo elegido, cada una en una fila de bloques desplegables con su "×", y "Añadir regla"; abajo la vista previa.

La vista previa usa una pista de ejemplo fija, no un fichero: 128 BPM, 192 compases, rejilla regular, frases de ejemplo y donde rompe en el compás 64. Se recalcula en vivo al tocar cualquier bloque y dibuja hot cues, CALL y la marca de donde rompe con las mismas reglas de dibujo que la sección Cues.

### 3. Edición a mano en la sección Cues

La sección Cues del editor (pista de una playlist de rekordbox, una sola, analizada) pasa de "marcar donde rompe" a editor completo, sobre la onda en color de rekordbox:

- **Marcar donde rompe:** clic en la onda, como hoy. El flujo activo genera el resto. Un segundo clic sobre la marca la quita y el flujo recalcula.
- **Seleccionar una cue:** clic en su cuadrado o triángulo. Queda resaltada y se puede:
  - **mover** arrastrando (se ajusta al golpe más cercano); una hot cue arrastra su CALL si están juntos;
  - **borrar** con ⌫ o el botón de la barra;
  - **cambiar color** (solo hot cues) con la paleta de rekordbox (los 16 colores de su selector);
  - **cambiar letra** (solo hot cues) a una libre.
- **Añadir:** clic derecho en la onda: "Añadir hot cue aquí", "Añadir CALL aquí", "Marcar donde rompe aquí". Una hot cue nueva toma la primera letra libre y el color por defecto.
- **Aplicar flujo:** un botón que vuelve a generar todo a partir de las marcas de donde rompe, con el flujo activo o con otro elegido en el momento, respetando la regla de no pisar trabajo a mano.
- **Deshacer:** ⌘Z deshace el último cambio dentro de la sección mientras no se guarde.

Todo es un borrador hasta "Guardar en rekordbox", como hoy: se pone en la cola y se escribe al cerrar rekordbox, con copia de seguridad.

### 4. Botón Auto

"Auto" propone dónde rompe y no aplica nada solo. Las propuestas salen del análisis de frases de rekordbox que ya se lee (`strongParts`: el inicio de cada parte fuerte según el humor de la pista, `CHORUS_BY_MOOD`), y se dibujan como marcas punteadas sobre la onda. Un clic en una propuesta la acepta como donde rompe y el flujo hace el resto. Sin análisis de frases, el botón no aparece.

Antes de enseñarlo, se mide contra las marcas de Vicent: en su colección, ¿cuántas propuestas caen en el mismo compás que un CALL suyo sin hot cue (su "donde rompe")? El número se apunta en este documento. Si acierta poco, el botón no sale y se queda en el diseño como pendiente.

### 5. Guardar en rekordbox

La operación `cues` de la cola pasa de llevar "las marcas de donde rompe" a llevar el conjunto completo de cues que quiere la pista (hot cues con letra, color y posición, CALL con posición), más la huella de lo que había al leer. Al aplicarse:

- calcula filas a insertar, cambiar y borrar contra lo que tiene rekordbox, con las mismas reglas de escritura del plan B (filas como las hace rekordbox, `contentCue` al día, `CueUpdated`);
- si la huella no coincide (rekordbox cambió las cues mientras tanto), se descarta con el aviso de hoy: gana rekordbox.

"Completar al cerrar" (ajuste del plan B) usa el flujo activo en vez de las reglas fijas.

### 6. Dibujo de cues en todas partes

En la lista, la sección Cues y el configurador:

- la hot cue es un cuadrado con su letra, en el color de rekordbox;
- el CALL es un triángulo rojo;
- un CALL que acompaña a una hot cue va a la misma altura que ella, centrado y detrás, de modo que solo asoman los bordes del triángulo, y la hot cue se pinta por delante;
- un CALL suelto, también el de donde rompe, va a esa misma altura.

Vicent, 20/10: los CUE y CAL deberían solaparse, los CUE por delante como hace rekordbox. Cambia la pila de dos filas y el carril de marcas se reduce a una sola fila.

Hoy, en la lista, el triángulo de un CALL en la misma posición que su hot cue queda tapado por el cuadrado.

### 7. Aprender de mi colección

Vicent, 19/10: "el auto, esta feature no podría analizar la db de cada usuario y buscar sus patrones?" y "así le haría la configuración Surco en los settings".

- En Ajustes › Cues, un botón "Aprender de mi colección" lee las cues de la colección de rekordbox (solo lectura, como el resto de lecturas) y deduce el flujo dominante del DJ: a qué distancias de donde rompe pone hot cues, con qué color en cada distancia, si cada hot cue lleva su CALL al lado y si hay una cue de inicio.
- Lo muestra como un flujo propuesto con su vista previa y cuántas pistas de la colección lo cumplen. El DJ lo acepta (se guarda como un flujo más y pasa a activo), lo edita o lo descarta. Nunca sustituye un flujo sin su clic.
- Si la medición del botón Auto (§4) muestra que calibrar con las marcas del propio DJ acierta más que la regla general, Auto usa lo aprendido: dónde suele romper para ese DJ respecto a las frases de rekordbox. La calibración se guarda con el flujo aprendido.
- Si la colección no tiene un patrón claro (ningún flujo cubre una parte suficiente de las pistas marcadas), el botón lo dice y no propone nada.

## Fuera de alcance

- Detección automática que escriba sin confirmar.
- Reglas escritas como código.
- Loops, comentarios de cue y colores de CALL.
- Editar cues de pistas que no estén en rekordbox (Music, ficheros sueltos).
- Aplicar un flujo a una playlist entera de una vez (se hace pista a pista; "Completar al cerrar" ya cubre el caso masivo con el flujo activo).

## Cómo sabremos que está

- "Mi flujo" da lo mismo que hoy en todos los casos de `cueRules.test.ts`, sin tocar esos tests.
- "Una cue a 32" y "Solo CALL" hacen lo que dicen en la vista previa y en una pista real de la copia de pruebas, y lo que se escribe en la copia es lo que se ve al abrirla en rekordbox.
- En la sección Cues se puede añadir, mover, borrar y cambiar color o letra de una cue, guardar, cerrar rekordbox y verlo igual en rekordbox.
- El número de aciertos del botón Auto está medido y apuntado.
- Ningún cambio escribe en rekordbox sin pasar por la cola, la copia de seguridad y la comprobación de huella.

## Riesgos

- Mover y borrar cues de rekordbox es más delicado que añadir. Las pruebas se hacen sobre la copia de pruebas, nunca sobre `~/Library/Pioneer`, y el orden de letras al mover una cue se comprueba en rekordbox de verdad antes de dar el plan por bueno.
- El motor genérico tiene que respetar casos raros de `rules.py` (intro que no cuadra, pistas cortas, más de 8 cues); por eso el criterio duro es la paridad con sus tests.

## Medido: botón Auto (19/10/2026)

Copia de pruebas `scratchpad/rb-ver/master.db` (copiada el 19/10 con rekordbox cerrado, después del recoloreado del 18/10), solo lectura. Comando: `SURCO_AUTO_DROPS_DB=<copia> vitest run src/main/autoDropsMeasure.test.ts`.

| Medida | Valor |
|---|---|
| Pistas con donde rompe marcado | 1576 (todas con frases de rekordbox) |
| Donde rompe marcados | 4396 |
| Acertados (propuesta en el mismo compás) | 2780 |
| Propuestas | 15924 (unas 10 por pista) |
| Propuestas que caen en un donde rompe suyo | 2780 |
| Recall | 0,632 |
| Precisión | 0,175 |

Calibrado con sus propias marcas (dejando fuera cada pista al aprender, y también en 5 grupos por pista): aprende "inicio del estribillo, 0 compases", que es lo mismo que ya propone la regla general, y da exactamente los mismos números. Calibrar no mejora.

No sale: acierta 2780 de 4396 (63 %), por debajo del 70 % fijado, y de cada 10 propuestas solo 2 son buenas. Queda pendiente. Lo que más se escapa: 537 donde rompe al inicio de una subida y 486 un compás después del inicio de un estribillo o una subida.

Sus patrones, medidos en las mismas pistas (3023 hot cues antes del primer donde rompe):

- Distancias a donde rompe: 16 compases 1562 veces, 32 compases 994, 48 compases 243; el resto son casos sueltos.
- Color dominante por distancia: 16 azul (1), 32 verde (22), 48 rojo (42).
- El 99,5 % de esas hot cues lleva su CALL debajo.
- 727 hot cues caen en el primer golpe; sus colores se reparten (verde 248, azul 227, amarillo 159, rojo 92), así que en muchas pistas cortas la cue de la cuenta atrás coincide con el inicio.

Es "Mi flujo", tal como está en §1.

## Medido: aprender de mi colección (20/10/2026)

Misma copia de pruebas, solo lectura. Comando: `SURCO_LEARN_FLOW_DB=<copia> vitest run src/main/learnFlowMeasure.test.ts`.

Flujo aprendido: una regla, "desde donde rompe, hacia atrás, 16 compases, 3 veces, si cabe: hot cue + CALL, azul (1), verde (22) y rojo (42)". Es la regla 1 de "Mi flujo". La cue de inicio amarilla no sale: de las 322 pistas donde cabría, solo 44 la tienen.

Encaja con 1161 de 1576 pistas marcadas (74 %). "Mi flujo" completo, con la cue de inicio, encaja con 901 (57 %).

Qué cuenta como encajar: la pista tiene todas las cues que pondría el flujo, en su sitio, del mismo tipo y del mismo color; las letras no cuentan y las cues de más están permitidas. Casi todas sus pistas tienen cues de más (1281 con hot cues de más y 1279 con CALL de más), así que exigir la pista exacta rechazaba hasta "Mi flujo" (150 de 1576).

Las que no encajan: a 389 les falta una hot cue de la cuenta atrás, a 401 un CALL, 14 tienen una cue movida, 10 difieren en la cue de inicio y 3 tienen una hot cue sin color.

Auto no usa calibración: medida en §"Medido: botón Auto", calibrar con sus marcas no mejora la regla general.

Un flujo sin reglas encaja con cualquier pista si se permiten cues de más, así que nunca se propone: una colección que solo tiene CALL recibe "Tu colección no tiene un patrón claro" y le queda "Solo CALL" entre los incluidos.

Tiempo de lectura y aprendizaje sobre la copia: 906 ms la primera vez y unos 257 ms con la caché caliente. Corre en el proceso principal: al pulsar el botón, la app puede tardar en responder alrededor de un segundo. Si se nota, se mueve a un worker.
