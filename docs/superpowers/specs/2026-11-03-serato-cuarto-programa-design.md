# Serato como cuarto programa de DJ, y una interfaz común para los cuatro

## Por qué

Surco trabaja con rekordbox, Traktor y Engine DJ. Serato DJ Pro es el cuarto gran programa de
DJ y hoy Surco solo sabe escribir un `.crate` suelto (`shared/serato.ts`). Una app de la
competencia (Kue, gratis) ya lee la biblioteca de Serato, edita sus cues y la lleva a un USB
Pioneer. El usuario quiere que Serato tenga lo mismo que las otras tres pestañas y, a la
larga, que los cuatro programas se integren entre sí: los cues de Serato a rekordbox o
cualquier otra combinación, y cualquiera de ellos al USB.

Antes de añadir Serato, el usuario pidió que cada programa cumpla una misma interfaz, para que
añadir un quinto programa más adelante consista en implementarla. Hoy cada programa está
repartido en unos 40 puntos del código que preguntan "¿es rekordbox, Traktor o Engine?"
(inventario del 03/11, ver más abajo).

Decisión del usuario (03/11): "estate seguro de que no rompemos nada, refuerza los tests si
hace falta".

## Objetivos

1. Una interfaz común por programa de DJ, con un objeto por programa, a la que se van moviendo
   los tres programas actuales por bloques y sin cambiar su comportamiento.
2. Serato como cuarto programa, implementando esa interfaz, en este orden:
   - (a) solo lectura: pestaña con crates y pistas, cues visibles en el editor;
   - (b) escribir cues, llevar Auto mark al mismo fichero en Serato, conservar los cues al
     convertir;
   - (c) crates, añadir a la biblioteca, etiquetas, repuntar;
   - (d) USB desde cualquier programa (función nueva para los cuatro).
3. Que nada de lo que hoy funciona en rekordbox, Traktor y Engine cambie.

Este documento detalla el refactor (objetivo 1) y la fase (a). Las fases (b), (c) y (d)
dependen de medidas de Serato que aún faltan y tendrán su propio documento.

## No objetivos

- Rellenar los huecos que ya existen entre los tres programas (Engine no edita playlists en
  el árbol, rekordbox no tiene escaneo de daños propio, Engine no tiene onda detallada en el
  editor, Traktor no tiene USB, nadie sincroniza el color de pista). El refactor los
  conserva tal cual; la interfaz los expresa como capacidades opcionales.
- Escribir en `master.sqlite` de Serato.
- Soportar Serato anterior a la 4.x. Lo medido es Serato DJ Pro 5.0.0.1278.
- Capacidades solo de rekordbox (completar al cerrar, aprender del usuario, rejilla de Surco,
  ondas en la fila): no se generalizan.

## Antiobjetivos

- Un refactor que cambie comportamiento. Cada commit de refactor deja la suite y los tres
  typecheck en verde sin tocar lo que un test afirma, salvo para reforzarlo.
- Un refactor "big bang" a medias. Se migra un bloque cada vez, y cada bloque queda terminado
  y mergeable por sí solo.
- Escribir en ficheros o bibliotecas de Serato con Serato abierto. Serato vuelca los cues al
  cerrar y pisaría lo que haya escrito Surco.
- Leer o tocar los ficheros reales del usuario para medir. Las medidas se hacen sobre
  `~/Music/Serato Pruebas`.

## Lo que sabemos de Serato 5 (medido el 03/11 en el Mac del usuario)

- **Biblioteca.** La verdad está en `~/Library/Application Support/Serato/Library/master.sqlite`
  (más `root.sqlite` para el disco interno y `network-drives/<uuid>.sqlite` por volumen). Sus
  triggers usan funciones y collations propias de Serato (`serato_str_norm`,
  `serato_asset_string_comparator`): leer las tablas básicas funciona, escribir no, y algunas
  vistas ni se leen.
- **Formato clásico.** Serato 5 regenera solo `~/Music/_Serato_/database V2` y
  `~/Music/_Serato_/Subcrates/*.crate` (log: "Dbv2: Exporting DBv2 library"). Es el formato
  documentado y el que `shared/serato.ts` ya escribe. La fase (a) lee de aquí.
- **Cues.** Van en el fichero de audio, en todos los formatos, y Serato los escribe SOLO AL
  CERRARSE (10 min vigilando sin cambios tras expulsar la pista del deck; escrito en el segundo
  del cierre). Un cierre forzado los pierde. La salida de Serato se colgó dos veces en
  "Exit - are you sure? / Backing up".
  - MP3, AIFF (chunk `ID3 `) y WAV (chunk `id3 `): GEOB `Serato Markers2` y `Serato Markers_`.
  - FLAC: Vorbis `SERATO_MARKERS_V2`.
  - M4A: átomo `----:com.serato.dj:markersv2`.
  - FLAC y M4A guardan `base64(mime \0 \0 "Serato Markers2" \0 + 01 01 + base64(payload))`;
    ID3 guarda `01 01 + base64(payload)` en el GEOB.
  - Payload: `01 01` y entradas `nombre \0 + longitud u32 BE + cuerpo`: `COLOR`, `CUE` (índice,
    posición en ms, color RGB, nombre), `LOOP` (índice, inicio y fin en ms), `BPMLOCK`.
- **Rejilla.** Serato 5 escribe `Serato Tempo Map` (49 bytes), no el `Serato BeatGrid`
  documentado. Formato sin medir.
- **Una biblioteca por disco.** Además de `~/Music/_Serato_`, Serato crea `_Serato_` en la raíz
  de cada volumen que usa (medido: `/Volumes/Public/_Serato_` con `database V2`, `Subcrates`,
  `Library`, `Metadata`), con rutas relativas a ese volumen. Es donde los DJ de Serato tienen
  la música (discos externos).
- **Al importar** añade a cada fichero un TXXX `Serato Import ID` = uuid (1925 ficheros del
  NAS del usuario, audio intacto, TRAKTOR4/POPM conservados).
- Fixtures: `~/Music/Serato Pruebas/Pray.{mp3,aiff,wav,flac,m4a}`, con cues aleatorios
  distintos en cada uno (MP3: 8 cues con "A" nombrado, 2 loops). Los tests no deben depender
  de esos 75 MB: se extraen las etiquetas a fixtures pequeñas.

## Inventario actual (03/11)

Cómo sabe hoy Surco de qué programa es una pista: por el prefijo del id (`traktor:` en
`shared/traktorContent.ts`, `engine:` en `shared/engineContent.ts`, sin prefijo es
rekordbox). El resto se decide con uniones de tipos repetidas
(`DjProgram`, `CueLibrary`, `PlaylistSource`, `PlaylistLibrary`, `VerifyPlace`,
`LibraryTagSyncReport`, `Library` local en `verifyRegistry.ts`, `GenreSource`) y con ramas por
programa en:

- `main/index.ts`: copias de sesión (312-325), colas y vigilantes (351-538), `ensure*Closed`
  (699-805), cableado IPC (1354-1560), `hostFor` (1613), fin de lote (1630), `library:copyInfo`
  (1672), daños (1686).
- `main/rekordboxCuesIpc.ts`: un juego de canales `rekordbox:*` para los tres, eligiendo por
  prefijo (`engineOf`, `traktorOf`).
- `main/libraryFlushes.ts`, `libraryTagSync.ts`, `libraryFileUse.ts`, `moments.ts`,
  `copiesIpc.ts`, `verifyRegistry.ts`, `verifyIpc.ts`, `damageScan.ts`, `damageRepair.ts`,
  `damageWiring.ts`, `damageIpc.ts`, `genreDamage.ts`, `processTrack.ts`, `rekordboxBatch.ts`,
  `duplicateReplace.ts`, `usbExportRoute.ts`, `exportIpc.ts`.
- `preload/api.ts`: unos 85 métodos por programa.
- Renderer: `App.tsx`, `useSourceBrowser.ts`, `SourceRail.tsx`, `useRekordboxPlaylists.ts`,
  `useTrackLibrary.ts`, `cueTwins.ts`, `CuesSection.tsx`, `CuesBatchSection.tsx`, `Editor.tsx`,
  `PlaylistsField.tsx`, `lib/*` (fields, revealCue, reviewTarget, selectionStatus, ...),
  `CopiesScreen.tsx`, `MusicReview*.tsx`, `DamageDetail.tsx`, ajustes y onboarding
  (`djLibraries.ts`, `djReach.ts`, `OnboardingWizard.tsx`, `DestinationTab.tsx`,
  `CuesTab.tsx`).
- Tests: `scenarios/matrix/*` (`Programs` en `cells.ts:16`).

El único sitio que ya sigue el patrón de interfaz es `main/copiesIpc.ts:9` (`CopiesProgram`,
usado como `Record<DjProgram, CopiesProgram>`).

## Diseño

### La interfaz (decisión del usuario: misma interfaz para todos; forma: decisión mía)

El usuario propuso una clase base con herencia. Surco casi no usa clases (4 en todo el código,
tres de ellas errores o React) y ya tiene el patrón equivalente en `CopiesProgram`: una
interfaz de funciones y un `Record<DjProgram, …>`. Se sigue ese patrón:

- Un tipo `DjProgram` único (los alias `CueLibrary`, `PlaylistLibrary`, `Library`… pasan a
  derivar de él o a desaparecer) y un `DJ_PROGRAMS` ordenado como fuente de los bucles.
- Una interfaz por bloque de capacidad, no una sola interfaz gigante. Cada programa entrega un
  objeto por bloque, y `Record<DjProgram, Bloque>` obliga al compilador a exigir el cuarto
  programa en cuanto se añada a la unión.
- Las capacidades que un programa no tiene son explícitas (`undefined` en un campo opcional o
  un valor `unsupported`), nunca una rama `if (program === …)` fuera del objeto del programa.
- Lo común se comparte por composición (funciones auxiliares), no por herencia.

La forma exacta de cada interfaz la decide quien implementa, bloque a bloque, a partir de lo
que los tres programas ya hacen.

### Bloques, en orden

Cada bloque es una rama de trabajo (o una serie de commits) que deja todo en verde y se puede
mergear sola:

1. **Unión única y prefijo de id.** `DjProgram` y `DJ_PROGRAMS` como fuente, y una función
   `programOf(trackId)` que sustituya a las comprobaciones `isTraktorContent` /
   `isEngineContent` sueltas.
2. **Programa abierto o cerrado.** `isRunning` y `ensureClosed` (hoy `ensure*Closed` en
   `index.ts`) en el objeto del programa.
3. **Copias y restauración.** Ya existe (`CopiesProgram`); se integra en el mismo registro.
4. **Cues.** Leer, guardar, cola, entrada de Auto mark, onda, colores y botones disponibles
   (rekordbox 8 + CALL, Traktor A-G sin CALL y azul fijo, Engine 8 con paleta). Saca el
   reparto por prefijo de `rekordboxCuesIpc.ts` y las tablas de `CuesSection.tsx` /
   `cueTwins.ts`.
5. **Pestaña y playlists.** Árbol, playlist, recuento, pertenencia y edición opcional.
6. **Tras convertir.** Repuntar, añadir, sincronizar etiquetas, duplicados
   (`libraryFlushes.ts`, `processTrack.ts`, `rekordboxBatch.ts`, `duplicateReplace.ts`).
7. **Comprobación y daños.** `verifyRegistry.ts`, `damage*`.
8. **Ajustes y onboarding.** Detección de ruta, interruptores `sync*` / `addTo*`.

Los ocho bloques entran en este trabajo. Serato fase (a) necesita los bloques 1, 2, 4 y 5 y
puede empezar en cuanto estén; los bloques 3, 6, 7 y 8 se terminan después o en paralelo.

Condición para añadir `'serato'` a `DjProgram` (decisión mía, por la revisión): ningún punto
del código puede tratar un id desconocido como rekordbox. Hoy "sin prefijo = rekordbox" está
repartido (`cueTwins.ts:54` `libraryOf`, el reparto de `rekordboxCuesIpc.ts`, las uniones de
`libraryFileUse.ts`, `genreDamage.ts`, `playlistEdits.ts`). El bloque 1 los lleva todos a
`programOf(trackId)`, que reconoce `serato:` y no lo confunde con rekordbox. En los bloques
aún no migrados, Serato aparece como "no soportado" de forma explícita; ninguna ruta que
escribe puede recibir una pista de Serato.

API entre procesos (decisión mía): el refactor puede cambiar la forma del preload y de los
canales IPC (`rekordbox:*` para los tres, ~85 métodos por programa) a métodos que reciben el
programa, porque ahí está la mayor parte del coste de añadir un programa. Los tests pueden
cambiar cómo llaman y cómo simulan `window.api`, nunca lo que afirman.

### Cómo no romper nada

- Antes de mover un bloque, inventariar qué tests lo cubren y reforzar lo que falte con tests
  de caracterización: fijan lo que el código hace hoy en los tres programas (también las
  rarezas), no lo que debería hacer.
- Cada garantía nueva o reforzada se valida mutando la implementación a propósito y viendo el
  test fallar (`npm run mutate` con Stryker donde aplique, o mutación a mano).
- Cada commit: suite completa desde `apps/desktop` con código de salida 0 (también sin
  `Errors`/`Unhandled`), y los tres typecheck (`tsconfig.web.json`, `tsconfig.node.json`,
  `tsconfig.scenarios.json`). Biome sin avisos.
- Los tests existentes no se reescriben salvo para cambiar una importación o un nombre; si un
  test necesita cambiar su afirmación, el refactor no es puro y se para.
- La matriz completa (`npm run matrix`, saltada en la suite normal) al final de cada bloque,
  comparada celda a celda con la de la base. Base medida el 03/11 sobre `9d54c37dd`: 126 bien,
  1 saltada y 4 que ya fallan en main (K08 "AIFF a WAV con dos filas de rekordbox...",
  S-blindRekordboxCueMoved, S-blindRekordboxPlaylistLink, S-blindTraktorPlaylistKey). Un
  bloque no puede cambiar el resultado de ninguna celda. Esos 4 fallos se investigan aparte;
  no se arreglan dentro del refactor.
- Suite normal de la base: 14787 bien, 254 saltados (dependen de plataforma, red o bibliotecas
  reales), los tres typecheck limpios.
- Prueba manual en la app al final de cada bloque contra las bibliotecas reales (rekordbox,
  Traktor, Engine) del usuario, en las rutas que toque el bloque. La hace Claude con el driver
  (decisión del usuario), con los programas cerrados y escribiendo en las colecciones reales
  solo con la copia de seguridad de Surco hecha antes.

### Serato fase (a): solo lectura

- **Detección.** `~/Music/_Serato_/database V2` presente. Ajuste de ruta como los demás.
- **Pestaña.** Serato en el carril de fuentes. Árbol de crates desde `Subcrates/*.crate`
  (subcrates con `%%` en el nombre); "All" desde `database V2`. Se leen la biblioteca de
  `~/Music/_Serato_` y la de cada volumen montado con `_Serato_` en su raíz (rutas relativas al
  volumen), y se juntan como hace Serato (decisión mía: sin los volúmenes la pestaña saldría
  casi vacía para un DJ real). Un volumen desmontado no aparece.
- **Rejilla.** Sin `Tempo Map` medido, una pista de Serato se comporta como una sin analizar:
  sin rejilla ni filtro de "fuera de rejilla" (decisión mía).
- **Posición de los cues.** Se pintan en el ms que dice `Markers2`, sin corrección por formato.
  Verdad de referencia: la MP3 de pruebas en pantalla de Serato (A 00:57.6, 01:12, 01:17,
  01:23, 01:28, 01:33, 01:42, 01:50; loops 00:57.6 y 01:04.8) cuadra con lo leído. El desfase
  por formato se mide en (b) (decisión mía).
- **Dónde aparece Serato en (a)** (decisión mía): solo en el carril de fuentes, su pestaña y el
  editor de cues en solo lectura. Copias, onboarding, ajustes de destino, `cueFlowTo*`, cues
  gemelos y la matriz lo marcan "no soportado" hasta la fase que lo implemente.
- **Cues en el editor.** Abrir una pista de Serato muestra sus hot cues (posición, color,
  nombre) y loops leídos de `Serato Markers2` del fichero, en los cinco formatos. Sin guardar
  en esta fase: el editor indica que Serato es de solo lectura.
- **Serato abierto.** Leer con Serato abierto da cues posiblemente viejos (los vuelca al
  cerrar). La pestaña avisa de que los cues pueden no estar al día mientras Serato está
  abierto.
- **Ids.** Prefijo `serato:` como `traktor:` y `engine:`.
- **Convertir y sustituir** (decisión mía, el usuario lo dejó a mi criterio): desactivados para
  las pistas abiertas desde la pestaña Serato, visibles y con el motivo ("Serato pierde la
  pista y sus cues; llega en la siguiente fase"), siguiendo la regla de Surco de deshabilitar
  en vez de esconder. Se activan en la fase (b), cuando los cues viajen con la conversión. Un
  fichero abierto desde una carpeta sigue como hoy.

## Lo que queda abierto (para las fases b, c, d)

- Si Serato 5 importa cambios hechos desde fuera en `database V2` / `.crate`
  (`root.sqlite.dbv2_status` tiene `last_import_revision`, sugiere que sí).
- El formato de `Serato Tempo Map`.
- Si una pista convertida que lleva el mismo `Serato Import ID` la reconoce Serato como la
  misma (repuntar).
- Desfase de los cues entre formatos (la M4A lleva `primingoffset`).
- Cómo sabe Serato de los volúmenes externos (`_Serato_` en cada disco, `location` con uuid).
