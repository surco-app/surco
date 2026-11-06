# Pegar un tracklist en una playlist

## Por qué

El usuario graba sesiones y saca su tracklist con `tracklist` (programa aparte, en
`~/code/tracklist`): un texto con una pista por línea, con tiempo, `Artista - Título`, huecos
`????? (unidentified, until mm:ss)` y sugerencias marcadas `(?)`. Hoy, para convertir ese set en
una playlist de rekordbox o Traktor, va línea a línea buscando cada pista a mano. Quiere pegar
el texto en Surco y que la playlist se haga sola con lo que tiene en la colección.

Decidido el 06/11/2026 sobre un boceto aprobado (`me encanta`), después de medir tres sets
reales contra su rekordbox (2100 pistas). Pide detectar el máximo posible de lo que tiene:
«cuantas más detectemos que existen en nuestra colección mejor». Medido con las reglas de
abajo (encontradas / dudosas / parecidas / no están):

- Set 1 (YouTube, 19 pistas): 5 / 7 / 1 / 6
- Set 2 (sample.json de tracklist, 46): 15 / 15 / 4 / 12
- Set 3 (XTV Remember, 31): 9 / 19 / 3 / 0

Patrón de oro: el usuario había hecho a mano la playlist del set 3 («231026 - Sagy & Vicent»,
en Bolos de rekordbox, 30 pistas). Las 28 líneas que entran solas (encontradas + dudosas)
coinciden una a una con lo que él metió. Donde había dos candidatas empatadas (Pray → W.I.P.
o sin mezcla, Do It Now → Lock 'n' Load o Jake Shore), la suya está entre ellas; el orden de
un empate es el de la colección (en rekordbox, la más reciente primero), no un criterio. Las 3 parecidas (Dancer, Hardhouse, P.I.K) también
están en su playlist: un clic cada una. «Tom apart» y «Torn Apart (Extended)» caen en la
misma pista y la playlist la lleva una vez. Fijar en un test: ese tracklist contra esa
colección debe dar esas 30 pistas, 27 solas y 3 con clic. Los tres tracklists y la playlist a mano están en
`docs/superpowers/specs/2026-11-06-pegar-tracklist/`; el constructor saca de la colección
real las filas candidatas y señuelos que haga falta para un fixture pequeño.

El nivel «dudosa» es la mitad de lo que tiene, no un residuo. Las «no están» se comprobaron
a mano y lo están de verdad, salvo erratas del propio tracklist (`Tom apart`, `The trip`
por `A Trip`) que no se persiguen.

## Objetivos

- Botón derecho sobre una playlist del árbol (rekordbox, Traktor, Serato): item
  **Pegar tracklist…** entre Rename y Delete. Abre un modal de dos pantallas.
- Botón derecho sobre una carpeta: el mismo item dice **Nueva playlist desde tracklist…**, y
  la primera pantalla lleva un campo de nombre encima del texto.
- Pantalla 1, pegar: un campo de texto grande y un contador vivo («19 pistas, 2 huecos») que
  confirma que el texto se ha entendido. Botón «Buscar en rekordbox» (nombre del programa).
- Pantalla 2, revisar: solo las líneas que están en la colección. Cada fila: tiempo (si lo
  había), punto de estado, la línea pegada y debajo cómo está escrita en la colección.
  - Encontrada (verde): nada que decidir, «se añade».
  - Dudosa (ámbar): la candidata con la diferencia resaltada, botones Aceptar / Fuera, con
    Aceptar marcado de serie. Si hay varias candidatas, radios para elegir y Aceptar coge la
    marcada.
  - Parecida (gris): mismo título pero el artista no cuadra o la línea no traía artista
    («Dancer (Spacio Mix)» → Spacio; «Various Artists - Dancer»; «Lasgo - Something» con el
    tag de artista roto en el fichero; pero también «Action (Poky Mix)» de Stephan K cuando el
    set decía Dj Dbc). Se enseña con su candidata y **Fuera marcado de serie**: un clic para
    cogerla, cero si es otra. Medido: 7 parecidas en los tres sets, 4 buenas y 3 falsas, así
    que no pueden entrar solas.
  - Las que no están y los huecos NO aparecen. Arriba, el recuento: «5 encontradas, 7 dudosas,
    1 parecida, 6 no están en la colección y se ignoran».
  - Botón final «Añadir N pistas», con N recalculado al sacar filas. Es lo único que escribe.
- Las pistas entran al final de la playlist en el orden del set. Dos líneas que caen en la
  misma pista (Tom apart y Torn Apart) se añaden una vez, en la posición de la primera. Las
  que ya estaban se saltan (el `already` que `add` ya devuelve).
- El texto se acepta con o sin tiempos: la salida de `tracklist`, la descripción de un vídeo
  de YouTube, o una lista pelada `Artista - Título`. Líneas sin ` - ` se ignoran y cuentan
  como no entendidas en el contador.

## No objetivos

- Engine DJ: Surco no escribe playlists ahí (`edit: null` en `sourcePrograms.ts`). El item
  no sale.
- Apple Music: el árbol de Music no tiene el menú de editar. Fuera.
- Separadores en los huecos. Anotado como posible siguiente paso, no en esta entrega.
- Dar de alta pistas que no están en la colección. Se ignoran, sin aviso por pista.
- Buscar en otra colección distinta de la pestaña abierta.
- Distancias de edición o búsqueda difusa. La medición dice que normalizar basta.

## Antiobjetivos

- Escribir antes de que el usuario pulse el botón final.
- Dar por encontrada una pista por título solo: «Action (Poky Mix)» existe de Stephan K y el
  set decía Dj Dbc. Sin artista en común, no está.
- Un emparejamiento que no se pueda explicar en la fila. Si la UI no puede decir por qué una
  candidata es dudosa, el criterio sobra.

## Emparejamiento, como se midió

Normalizar: NFD sin diacríticos, minúsculas, apóstrofos tipográficos a `'`, espacios
colapsados (es lo que hace `foldText`).

Línea: guion corto, largo o raya rodeados de espacio valen como separador (`Nick Kamen – I
Promised Myself`). Si el título lleva un segundo ` - `, lo que sigue es la mezcla y se trata
como si fuera entre paréntesis (`Secret - Extended Vocal Mix` = `Secret (Extended Vocal
Mix)`). Una línea sin separador es solo título (`Dancer (Spacio Mix)`).

Título base: el normalizado sin paréntesis ni corchetes, sin `-dígitos` al final (el
`you-7356`), sin signos.

Artistas: separar ANTES de plegar (foldText borra las comas), por `,` `&` ` and ` ` x ` `/`
y por `feat` `ft` `presents` `vs` `meets`; quitar signos; descartar «Various Artists», «VA»,
«Unknown». Dos listas se solapan si algún artista de una es igual o contiene a uno de la otra
(`Javi Pirata's & Domene DJ` solapa con `Javi Pirata`; `Brain` con `Brain Bashers`).

Reutilizar `foldText` (`lib/normalizeText.ts`). `titleSimilarity` de `lib/release.ts` NO
sirve aquí: es asimétrica a propósito para Discogs (castiga al candidato que pierde palabras)
y da 0,25 a `Good Vibration 2023 Rmx` frente a `Good Vibration`. La similitud es Dice sobre
tokens del título base, ignorando artículos. Sin llamadas a proveedores (Discogs, Deezer): sobre el ejemplo no habrían
ganado ninguna pista, porque las 7 ausentes lo están de verdad. Si otros sets lo desmienten,
sería un segundo pase solo sobre las líneas que caen en «no está».

Niveles, sobre la colección entera de la pestaña (`ALL_TRACKS_ID`). Su `preview` trae `title`
y `artist` en rekordbox, Traktor y Engine; en Serato no (`seratoLibrary.ts:157`), aunque
`seratoDatabase.ts` lee `tsng`/`tart`. Decisión: añadir el `preview` a la entrada de Serato en
el main, para que las tres fuentes editables busquen igual.

1. **Encontrada**: título normalizado completo igual y artistas solapan, exactamente una.
2. **Dudosa** (entra de serie): artistas solapan y, o bien título base igual (otra mezcla,
   varios candidatos), o bien similitud de título alta (`titleSimilarity` ≥ 0,6 sobre
   tokens, ignorando artículos a/the/el/la; caza `You Make Me` frente a `U Make Me`,
   `Good Vibration 2023 Rmx` frente a `Good Vibration`, `Fire!!!` frente a `Fire`, `The trip`
   frente a `A Trip`), o título base a distancia de edición ≤ 20 % (`Tom apart` frente a
   `Torn Apart`, pedido por el usuario); o encontrada pero la línea traía `(?)`.
3. **Parecida** (fuera de serie): título base igual y los artistas no solapan o la línea no
   trae artista. También una línea sin separador que es exactamente un artista con una sola
   pista en la colección (`P.I.K` → P.I.K. - Speakerfreak).
4. **No está**: lo demás.

Casos medidos para fijar en tests:
- Encontradas: Because of You (artistas en otro orden), On My Own (artista parcial), X-Santo
  (mezcla tras segundo guion), Black Rabbit Remix (`Remix` suelto frente a `(Remix)`).
- Dudosas: To Be Loved Radio→Extended, Go! con y sin mezcla, Number One Mix→Remix, So Easy to
  Love you-7356→(Club Mix), Real Love con dos candidatas, U Make Me Feel Alright, Do it now →
  Brain Bashers, Can You Feel The Rhythm (?) → Rythm, Tom apart → Torn Apart.
- Parecidas: Dancer (Spacio Mix) sin artista, Various Artists - Dancer, Hardhouse →
  Hard House Hooligans, P.I.K solo artista, Action (Poky Mix) Dj Dbc → Stephan K (esta es falsa y por eso el
  nivel va apagado).
- No están: Frogin Beat, Klubbhopping, Kamaz.

## Parser

Una línea es pista si contiene ` - `. Tiempo opcional al principio: `-`, viñeta o nada, luego
`h:mm:ss` o `mm:ss`. `(?)` al final marca sugerida. Línea que empieza por `?` es hueco. Las
demás (URL, el resumen `18 identified…`, vacías) se ignoran. Un título de vídeo o una URL
como primera línea no se usa para nada en esta entrega (el campo de nombre se escribe a mano).

## Decisiones ya tomadas

- Nombre del item: «Pegar tracklist…» (dice lo que haces) y «Nueva playlist desde tracklist…».
- El repaso se mantiene aunque las dudosas entren solas: Tendance Mix frente a Extended Mix es
  un caso que el usuario quiere ver antes.
- Reglas del árbol: no sale en nodos `locked` (HISTORY de Traktor); sí en `tracks-only`
  (Preparation). En una carpeta solo la variante «Nueva playlist».
- Traktor exige colección (`addsUncollected: false`): como solo se añaden pistas que ya están
  en la colección, no hay caso de pista nueva.

## Lo que queda al constructor

- La colección llega por un IPC nuevo y ligero por programa (`contentId`, `path`, `title`,
  `artist`), no por `playlist(ALL_TRACKS_ID)`, que arrastra cues y carátulas de 2100 pistas.
  El emparejamiento corre en el renderer sobre esa lista. Decisión del plan.
- Cómo pasar las elegidas a `add`: `contentId` donde la fuente lo da, `paths` si no.
- Variante carpeta: `create` devuelve `createdId`; encadenar el `add` detrás en el renderer,
  como dos ediciones seguidas (así cada una conserva su copia de seguridad y no hace falta
  IPC nuevo). Si el `add` se rechaza (rekordbox abierto, cancelado, árbol cambiado), la
  playlist nueva se queda vacía en el árbol y el aviso que ya existe dice por qué. Decisión
  mía, cambiable.
- i18n en los 6 idiomas, con los textos del boceto en castellano como referencia.
- Resaltar la diferencia de la candidata: basta con el trozo entre paréntesis que cambia.
