# Sesión automática

## Por qué

El usuario monta sus sesiones a mano. Tiene carpetas de bases y de cantaditas, y una lista de
COMBOS que ha ido sacando a ojo de las tracklists que guarda: parejas base + cantadita que
se repiten entre sets. Quiere que Surco haga esa detección y monte una playlist de la duración
que pida, mezclando combos probados con pistas sueltas que le gustan y alguna nueva.

Decidido el 09/11/2026 sobre un boceto aprobado («me encanta»), después de medir un script
desechable contra sus 25 tracklists y su rekordbox (2123 pistas, 87 playlists):

- 24 pares contiguos se repiten entre tracklists, de 1546 distintos. Casi todas sus notas son
  sets de otros DJs, que rara vez repiten la misma pareja. Los combos propios están en
  playlists cortas hechas a mano, donde el orden sí significa algo.
- Camelot no explica sus mezclas: 20 % de pares armónicos frente a 17 % al azar. El BPM dentro
  de ±4 pesa algo más: 51 % frente a 39 %. Por eso la mezcla armónica arranca en «Libre».
- Las estrellas son un favorito: 140 pistas con 5, 1983 con 0. Las escuchas sí existen en 751.
- Una sesión de 90 min sale coherente encadenando combos y rellenando por tono, BPM y escuchas.

Boceto aprobado: artifact `2SQ25skWEH5LE4EgwNC6b3`. Playlist de prueba que le gustó: la que
sacó el script, 14 pistas, 91 min.

## Objetivos

- Item **Sesión automática…** en la paleta de comandos y en el menú de una carpeta del árbol
  (rekordbox, Traktor, Serato). Abre un asistente en modal de cuatro pasos, uno por pantalla,
  con la estructura de `OnboardingWizard` y el ancho de `PasteTracklistModal`.
- Paso 1, duración: 60 min, 90 min, 2 h, 3 h y «Otra» con un campo en minutos.
- Paso 2, playlists de origen. Buscador sobre todas las playlists del programa, con su número
  de pistas. Al elegir una se dice qué contiene con un selector de cuatro valores:
  **Bases**, **Cantaditas**, **De todo**, **Set**. Debajo, las ya elegidas agrupadas por ese
  valor, como chips con una × para quitarlas. Escala a cientos de playlists porque solo se ve
  lo elegido.
  - Surco no adivina el papel. Lo dice el usuario, una vez, y Surco lo guarda por playlist.
  - **Set** significa que el orden de esa playlist es real: una sesión, una lista de combos.
    De ahí salen los pares contiguos. Una playlist Set también aporta sus pistas como «De todo».
  - El papel también se cambia desde el menú contextual de cada playlist del árbol, y se ve
    como una letra pequeña junto al nombre (B, C, S).
  - Hace falta al menos una playlist de origen: «Siguiente» queda deshabilitado sin ella.
    La colección entera no sirve de origen porque no trae tono ni BPM.
- Paso 3, pistas nuevas: playlists de pistas que el usuario quiere probar, y un porcentaje
  (0 a 40 %, 15 % de serie). Las nuevas no tienen historial: se colocan por tono, BPM y por si
  son base o cantadita, detrás de una pista conocida que encaje.
- Paso 4, carácter: alternar base y cantadita (sí de serie), preferir combos probados (sí),
  mezcla armónica **Libre / Vecinos / Mismo tono** (Libre de serie), pesar estrellas y
  escuchas (sí), «Sorpréndeme» que deja un hueco a parejas que nunca se han puesto juntas (no).
- Resultado: una playlist nueva en la carpeta donde se abrió el asistente (o en la raíz, si
  vino de la paleta), llamada «Sesión del 9/11» con la fecha del día. La modal se cierra y la
  playlist se abre en la lista de pistas.
- Banda sobre la lista, solo mientras la sesión es reciente: «Sesión montada por Surco», con
  duración, pistas, combos, nuevas y mezclas armónicas, y tres botones.
  - **Rehacer**: mismas respuestas, otra tirada. Sustituye el contenido de esa playlist.
  - **Ajustar…**: reabre la modal con las respuestas puestas. Al montar, sustituye el
    contenido de esa playlist, no crea otra.
  - **Quedármela así**: quita la banda. La playlist queda como cualquier otra.
- Línea de por qué entre filas mientras la banda está: violeta «Combo probado en N sets»,
  azul «8A → 8B, vecino», verde «Nueva. Encaja por tono 10A y es base», ámbar «La más
  escuchada de las que cuadran». Un «Cambiar ▾» en la fila seleccionada ofrece pistas que
  encajan igual.
- Una vez creada y sin la banda, la playlist se comporta como una normal. El editor de la
  derecha no cambia en nada.

## No objetivos

- Engine DJ y Apple Music: Surco no escribe playlists ahí (`edit: null`). El item no sale.
- Leer tracklists de texto, de Notas o de ningún otro sitio. Los combos salen solo de playlists
  marcadas como Set. Pegar un tracklist ya convierte texto en playlist; después se marca Set.
- Analizar la tonalidad de pistas que el programa no trae con tono. Traktor, Engine y Music no
  la dan en las filas de una playlist. En esos programas Camelot queda desactivado y el
  asistente lo dice en el paso 4.
- Aprender gustos de otros usuarios o enviar nada fuera. Todo se calcula en local.
- Persistir la banda entre arranques. Al cerrar Surco la playlist queda como una normal.
- Separadores entre bloques, y exportar la sesión a un programa distinto del abierto.

## Antiobjetivos

- Escribir en el programa antes de que el usuario pulse «Montar sesión».
- Inventar un papel. Una playlist sin papel no cuenta como base ni como cantadita; solo
  entra como «De todo» si el usuario la eligió así.
- Afirmar un combo que no se ha visto. «Combo probado en N sets» solo con N pares contiguos
  reales contados una vez por playlist Set.
- Una pista repetida dentro de la misma sesión.
- Un resultado que no se pueda explicar en la fila: cada pista dice por qué está.
- Dar por buena una mezcla armónica sin tono: una pista sin tono no cuenta como armónica ni
  como no armónica, se coloca por BPM.

## El algoritmo

Módulo puro en `shared/`, sin acceso a disco ni a Electron, para poder probarlo entero.

**Entrada.** Una lista de pistas candidatas, cada una con `id`, `role` (`base`, `vocal`, `any`),
`key` (Camelot o vacío), `bpm` (o 0), `rating` (0 a 100), `plays` (0 si no se sabe), `secs`
(duración, 0 si no se sabe), y si es `fresh` (viene de una playlist de nuevas). Las playlists
Set como listas ordenadas de `id`. Las opciones del paso 4 y una semilla.

**Combos.** Para cada playlist Set, cada par contiguo `a → b` suma 1 una sola vez por playlist.
Un par solo cuenta si ambos están en las candidatas. Un par con N ≥ 1 es un combo; N es su
fuerza. Cadenas: si `a → b` y `b → c` existen, la sesión puede recorrer `a → b → c` seguido.
Los combos son dirigidos: `a → b` no implica `b → a`.

**Camelot.** Distancia entre dos tonos de la rueda: 0 mismo tono, 1 mismo número con la letra
cambiada o número vecino con la misma letra, mayor en cualquier otro caso. Libre no filtra,
Vecinos exige distancia ≤ 1, Mismo tono exige 0. Sin tono en alguna de las dos: no se aplica
el filtro, se exige BPM dentro de ±4 en su lugar.

**Montaje.** Parte de la pista conocida con el combo más fuerte (o de una al azar con la
semilla si no hay combos). En cada paso, desde la pista actual:

1. Si «preferir combos» y existe un combo no usado desde ella, que además respete la
   alternancia, se toma el de más fuerza.
2. Si no, entre las candidatas no usadas que respeten alternancia, armonía y BPM ±4, se
   puntúa por gusto (estrellas y escuchas, normalizadas dentro del conjunto) y se desempata con
   la semilla.
3. Si toca una nueva (la proporción pedida se reparte a lo largo de la sesión, nunca la primera
   ni la última), se elige entre las `fresh` que encajen por tono, BPM y rol.
4. Si «Sorpréndeme», cada cierto número de pistas se elige una pareja sin combo previo.
5. Si no hay ninguna que encaje, se relaja el BPM a ±8 y se anota en el «por qué»; si ni así,
   se acaba la sesión antes de tiempo y el resumen lo dice.

Termina cuando la suma de duraciones alcanza la pedida, con tolerancia de una pista. Sin
duración de una pista se supone 6 minutos para el cálculo y se anota.

**Salida.** Lista de `{ id, why }` con `why` tipado (`combo`, `harmonic`, `fresh`, `taste`,
`bpm`, `start`) y los datos para la frase, más el resumen (minutos, pistas, combos, nuevas,
mezclas armónicas sobre mezclas con tono) y los avisos.

Misma entrada con la misma semilla da la misma sesión. **Rehacer** cambia la semilla.

## Datos por programa

Lo que cada programa da en las filas de una playlist (medido leyendo el código):

| Programa | BPM | Tono | Estrellas | Escuchas |
|---|---|---|---|---|
| rekordbox | sí | sí, `ScaleName` | sí | sí (`DJPlayCount`) |
| Traktor | sí | no | sí | no |
| Serato | sí | sí | no | no |

- Las escuchas hoy no viajan en las filas. Se añade `playCount` opcional a los datos de fila
  y solo rekordbox lo rellena. Donde falta, el gusto usa solo estrellas, y donde faltan
  ambas, solo el BPM y el orden.
- El tono llega tal como lo escribe el programa. Se normaliza a Camelot con `keyNames.ts`; lo
  que no se reconoce cuenta como sin tono.
- La duración sale de `preview.durationSec` cuando existe.

## Dónde vive cada cosa

- **Papel de cada playlist**: ajuste de Surco, no se escribe en el programa. Un registro
  `sessionRoles` en `settings.json` con clave `programa:idDePlaylist` y valor `base`,
  `vocal`, `any` o `set`. Se normaliza al leer como `hiddenSources` y se limpia de claves
  inválidas. Mover una playlist cambia su id en Serato; ahí el papel se pierde y se vuelve a
  marcar (no se persigue).
- **Última configuración del asistente**: duración, porcentaje y carácter, para que «Montar
  otra» arranque donde se dejó. En `settings.json` junto al registro.
- **La banda**: estado de React, no persiste. Guarda el id de la playlist creada, las
  respuestas y la semilla.
- **Creación y escritura**: reutiliza `editRekordbox` con `create` y `add`, que ya despacha por
  programa, hace copia de seguridad por gesto y respeta que rekordbox esté abierto. Rehacer y
  Ajustar crean primero la playlist nueva con su contenido y, solo si eso salió bien, borran
  la anterior con `delete`. Así nunca queda una playlist vacía a medias, no hace falta
  conocer los `linkId` de las filas (Traktor no los tiene) y, si el programa rechaza (rekordbox
  abierto), la anterior sigue intacta y se avisa.
- **i18n**: claves nuevas en los seis idiomas. `keys.test.ts` compara los seis.

## Decisiones mías

Marcadas porque el usuario pidió empezar sin más preguntas:

- El papel **Set** es un cuarto valor del selector. El usuario describió Bases, Cantaditas y
  De todo; sin Set no hay de dónde sacar combos fuera de sus notas, que otros usuarios no
  tienen.
- Los combos solo se cuentan dentro de playlists Set, no entre todas, porque el orden de una
  playlist de bases no significa nada.
- Pista en dos playlists con papeles distintos: bases + cantaditas a la vez se trata como «De
  todo» y no alterna. Una playlist concreta (bases) gana sobre «De todo».
- Programas de la primera entrega: rekordbox, Traktor y Serato, los tres con crear y añadir.
- Escuchas solo en rekordbox. Se añade el dato en lugar de dejarlo fuera porque el usuario lo
  pidió como señal de gusto.
- La playlist se llama «Sesión del d/m» y no se pregunta el nombre; se renombra con el menú de
  siempre.
- Rehacer y Ajustar sustituyen la playlist (crear la nueva, borrar la anterior) en lugar de
  dejar una más por cada intento. La nueva toma el nombre de la anterior.

## Resuelto tras la revisión

Ocho huecos que encontró un revisor independiente; los cierro así, y son decisiones mías.

- **Rehacer no puede dejar nada a medias.** Crear y rellenar la nueva antes de borrar la
  anterior, como arriba. El borrado usa `delete`, que existe en los tres programas.
- **Cuándo se acaba la banda.** Cualquier edición del usuario sobre esa playlist (añadir,
  quitar, mover pistas, renombrar) la quita, porque Rehacer destruiría lo que ha hecho. Se
  detecta en el mismo punto por el que pasan las ediciones de Surco sobre esa playlist. Rehacer
  solo se ofrece sobre una playlist que Surco no ha visto tocar.
- **«De todo» y la alternancia.** La alternancia solo distingue base y cantadita. «De todo» es
  neutro: cabe en cualquier hueco y no cambia cuál toca después. Así los combos de las playlists
  Set disparan aunque sus pistas no tengan papel.
- **Identidad de una pista.** `contentId` cuando la fila lo trae (rekordbox, Serato) y, si no,
  la ruta normalizada NFC (Traktor). Dos filas del mismo fichero con `contentId` distinto
  (gemelas por enlace simbólico) se tratan como pistas distintas; no se persigue unirlas.
- **Carga de filas.** Al pulsar «Siguiente» en el paso 2 y en el 3, se cargan con los lectores
  que ya existen las filas de las playlists elegidas, con un estado de carga en el botón. Así
  el paso 4 sabe ya si hay tonos y cuántas pistas hay de verdad. Un solo lector por playlist,
  con caché mientras la modal está abierta.
- **Clave del papel y USB.** `programa:idDePlaylist`, sin distinguir unidad. El item no
  aparece cuando la fuente abierta es un USB, igual que el resto de ediciones de playlist.
- **Combos frente a nuevas.** Un combo disponible gana sobre el hueco de una nueva; la nueva
  se aplaza al siguiente hueco y la proporción pedida es un objetivo, no un contrato. Una pista
  que está a la vez en una playlist de nuevas y en una de origen cuenta como pista normal.
- **Nodos bloqueados y carpetas.** El item sale donde hoy sale «Pegar tracklist…» sobre una
  carpeta, y con la misma regla (`fixedNode` de cada programa). En Serato la «carpeta» es el
  crate. En una carpeta bloqueada de Traktor no se ofrece.

## Casos límite

- Menos pistas elegibles de las que cubren la duración: la sesión acaba antes y el resumen dice
  «Solo hay pistas para 62 min».
- Ninguna pista con tono (Traktor): armonía deshabilitada en el paso 4, con una línea que lo
  explica.
- Sin playlists Set (pero con otras de origen): no hay combos; el resumen muestra 0 combos y la sesión es solo gusto, tono
  y BPM. No es un error.
- Playlist elegida que se vacía o desaparece entre abrir y montar: se ignora y se avisa una vez.
- rekordbox abierto al montar: el gesto lo rechaza; el asistente se queda abierto con el aviso
  y no escribe nada.

## Pruebas

- Módulo del algoritmo: combos contados una vez por playlist, cadenas, Camelot (0/1/mayor),
  alternancia, respeto de la duración, no repetir pista, determinismo por semilla, relajación
  de BPM, sesión corta por falta de pistas.
- Un test con datos reales pequeños: el combo Absolom → The Bass → Crush del set de Fran BP
  debe salir como cadena de 3 desde una playlist Set que lo contenga, con fuerza 1.
- Normalización de `sessionRoles` en ajustes (claves inválidas fuera, valores desconocidos
  fuera).
- Componentes: el selector de papel, los chips agrupados, la navegación de cuatro pasos y que
  el botón final es lo único que escribe. Selectores `data-testid`.
- Cierre en la app real con `run-desktop`, contra datos reales, con una captura de la modal y de
  la banda.

## Qué queda al constructor

- Nombres de tipos y módulos, siguiendo el estilo de `tracklistMatch` y `sourcePrograms`.
- La fórmula exacta de puntuación de gusto, mientras estrellas pesen más que escuchas y el
  resultado se pueda explicar en el «por qué».
- El texto de cada frase de «por qué» y de los avisos, en los seis idiomas.
- Cómo se reparte la proporción de nuevas a lo largo de la sesión.
