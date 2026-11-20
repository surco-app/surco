# Tanda de mejoras 1

Pendiente de aprobación de Vicent. Sale del repaso general del 20/11/2026, en el que Vicent dio por buenas todas las propuestas. Esta es la primera tanda, la de cambios pequeños.

## Intención

Surco ya mide o lee muchos datos que luego no aprovecha, y tiene huecos pequeños que cuestan trabajo al DJ o le hacen perder cosas. Esta tanda cierra once de esos huecos sin añadir pantallas ni controles nuevos de peso.

## Objetivos

Once cambios independientes, uno por commit, cada uno con sus tests.

## Fuera

- Aplicar un flujo a la selección, borradores de cues persistentes, remixer, año original, ISRC, playlists completas de Engine, Serato en Copias y cualquier otra mejora mediana o grande del repaso. Van en tandas posteriores.
- Veredictos de calidad nuevos. Aquí solo se añade lo que es exacto.
- Papelera de reciclaje real en Windows.

## Lo que sería un fracaso aunque funcione

- Un control nuevo que cambie de ancho, un aviso que no se pueda accionar o un texto que afirme más de lo medido.
- Un relleno en lote que pise un valor que el DJ ya tenía.
- Cualquier escritura en una biblioteca de DJ que no pase por la cola, la copia y la autocomprobación de siempre.

## Enfoques

1. **Tanda única en una rama, un commit por cambio (elegido).** Los once cambios no se tocan entre sí, cada uno es pequeño y la rama se queda sin mergear hasta probarlos todos en la app.
2. Una rama por cambio. Once worktrees y once pasadas de puertas para cambios de pocas líneas.
3. Repartirlos dentro de las tandas medianas por área. Retrasa semanas arreglos que hoy pierden datos, como la sesión que se sobrescribe.

## Los cambios

Las referencias son a `apps/desktop/src`, comprobadas el 20/11 sobre `5ca02656d`.

### 1. La sesión automática cuenta altas y escuchas en los cinco programas

`recencyOf` (`renderer/src/lib/sessionCandidates.ts:36`) solo lee `meta.dateAdded`, que solo rellena rekordbox. Traktor, Engine DJ, Serato y VirtualDJ ya entregan `meta.addedAt` en milisegundos. `recencyOf` pasa a usar `addedAt` cuando no hay `dateAdded`. Además, `metaOf` de Traktor lee `PLAYCOUNT` del NML a `meta.playCount`, como ya hace `usbExportTraktor.ts:77`.

Cambia qué pistas cuentan como nuevas en sesiones de esos cuatro programas. `everyNew` sigue neutralizando una biblioteca recién migrada.

### 2. Reabrir la última sesión

El aviso de arranque dura 6 s y al caducar solo se oculta. Si después se suelta una pista, el guardado sobrescribe la sesión anterior y sus ediciones sin aplicar.

- Comando «Reabrir la última sesión» en la paleta y en el menú Archivo. Activo cuando hay una sesión guardada sin responder y la pestaña de ficheros está vacía. Hace lo mismo que el botón del aviso.
- La sesión anterior no se pierde al empezar otra. La primera vez que un arranque va a sobrescribir una sesión sin responder, la anterior se conserva aparte, una sola generación. La ✕ del aviso sigue siendo la única respuesta que la descarta.

Decisión mía: no se reabre encima de una lista con filas, por la misma razón que hoy retira el aviso. Quien soltó una pista vacía la lista, que tiene Deshacer, y reabre.

### 3. Engine DJ lee su colección

`SOURCE_READ.engine` va con `collection: false` (`renderer/src/lib/sourcePrograms.ts:37`), así que «Pegar tracklist» y «Nueva playlist desde tracklist» no se ofrecen. Se añade la lectura de colección de Engine con título, artista y ruta, registrada como la de los otros programas. Hay que medirla con el fixture grande de Engine antes de darla por buena.

### 4. Copiar las que faltan al pegar un tracklist

Las líneas sin pareja solo aparecen como número en la línea de ayuda del diálogo (`PasteTracklistModal.tsx:144`). Junto a ese número va un botón de icono «Copiar» que deja en el portapapeles esas líneas tal como se pegaron, una por línea. Sin texto visible, con `aria-label` y tooltip.

```
3 no están en la colección  ⧉
```

### 5. La carátula de baja resolución también se sustituye en lote

`keepCoverArg` (`renderer/src/lib/coverSource.ts:27`) conserva cualquier carátula existente. El ajuste «Sustituir carátula de baja resolución» solo se consulta en el editor (`Editor.tsx:834`). `keepCoverArg` recibe el ajuste y las medidas de la carátula embebida, y aplica la misma regla que el editor en el barrido de auto-match, las filas de álbum y aceptar una sugerencia. Si las medidas no se conocen todavía, se conserva.

### 6. Rellenar BPM y tonalidad medidos en la selección

El barrido mide BPM y tonalidad de cada pista, pero la sugerencia solo existe con una pista abierta. BPM y tonalidad son campos por pista y el editor de varias no los muestra, así que no hay sitio para un botón.

Comando «Rellenar BPM y tonalidad» en la paleta y en el menú Pistas, sobre la selección, junto a «Rellenar del nombre». Escribe solo en campos vacíos y solo donde hay medida. Aviso «N pistas rellenadas» con Deshacer. No lanza análisis nuevos. La tonalidad se escribe en la notación elegida en Ajustes.

Decisión mía: el BPM se escribe tal como lo ofrece hoy el chip, redondeado, con su posible error de octava. Por eso nunca pisa un valor.

### 7. Filtrar por bits rellenados y reescalado, ordenar por sonoridad

El análisis guarda `bitsUsage` y `resolution` por pista y el barrido mide la sonoridad integrada. Se añaden dos filtros y un orden.

- Filtros «Bits rellenados» y «Reescalado», en la sección del menú donde están silencio y clipping. Una pista sin analizar no entra en ninguno.
- Orden «Sonoridad», con las pistas sin medir al final en los dos sentidos.

Son las pistas que «Corregido» reescribe más pequeñas y las que piden normalizar. Los textos de los filtros son los que ya usa el editor para esos dos hallazgos.

### 8. Canal sin señal

Si un canal es silencio digital, su RMS no es finito, se descarta al leer `astats` (`main/ffmpeg.ts:3327`) y el balance queda `null`, igual que en un fichero mono. La fila de balance desaparece.

El análisis distingue «un canal» de «dos canales, uno sin señal», y en ese caso la tabla de sonoridad muestra una fila en rojo «Canal izquierdo sin señal» o «Canal derecho sin señal» en el sitio del balance. Es exacto: silencio digital en un canal con señal en el otro. Cambia la forma del resultado guardado, así que la caché de esa medida sube de versión.

### 9. El recuento de Auto marcar lleva a las pistas

El recuento tras Auto marcar en lote (`CuesBatchSection.tsx:281`) es una lista de números. Cada línea pasa a ser un botón que deja en la lista solo esas pistas, con el mecanismo de «Verlas en la lista» del bloque Rejilla. Mismo texto, mismo ancho, sin controles añadidos.

### 10. Windows y NAS: borrar sin diálogo, con Deshacer

`volumeKeepsTrash` responde que no en Windows y en volúmenes de red, así que «Mover a la Papelera» pregunta siempre aunque el fichero va a Copias de seguridad y se puede recuperar.

- Cuando todos los ficheros acaban en la Papelera del sistema o en Copias, se borra sin preguntar. El aviso «N pistas quitadas» lleva Deshacer, que devuelve fichero y fila cuando el destino fue Copias. `shell:trash` devuelve el identificador de la copia para poder restaurarla.
- Si un fichero no cabe en Copias o la copia falla, ese fichero no se borra y la fila se queda con su motivo.
- El diálogo sigue saliendo cuando algún fichero se perdería de verdad.

Aparte, en su propio commit, `toggle-sidebar` deja de ser `macOnly` y recibe un acorde propio en Windows que no choque con la tabla, visible en Ajustes › Atajos y en el menú.

### 11. El texto de hi-res dice lo medido

El detector compara 21,5 y 23,5 kHz. Un 48 kHz subido a 96 también tiene contenido ahí y hoy lee «Hi-res auténtico». El texto pasa a decir lo que se mide, en los ocho idiomas.

- Hoy: «Hi-res auténtico: hay contenido real por encima de 22 kHz, así que este archivo a {{rate}} no está reescalado desde calidad CD (44,1 kHz).»
- Propuesto: «Hay contenido real por encima de 22 kHz. Este archivo a {{rate}} no viene de calidad CD (44,1 kHz).»

Si algún test fija la frase actual, cambia con ella. La app deja de llamar «auténtico» a un hi-res que no puede garantizar.

## Lo que queda al constructor

- Dónde se guarda la generación anterior de la sesión y cómo se nombra.
- Cómo llegan `bitsUsage`, `resolution` y la sonoridad a los hechos de la fila sin recalcular.
- El acorde de Windows para la barra lateral.
- Las traducciones de los textos nuevos en los ocho idiomas, medidas al ancho real del control.

## Puertas

Suite completa mirando el código de salida, `tsc` con los tres proyectos, lint de escritorio y web, y build web. Cada test nuevo se ve fallar antes y se comprueba mutando la implementación. Los cambios que mueven interfaz (4, 9 y 10) se prueban con ratón real en la app, lanzada sin activarse. La rama no se mergea hasta probar los once.
