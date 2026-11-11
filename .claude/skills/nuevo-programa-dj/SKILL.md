---
name: nuevo-programa-dj
description: Usar al añadir a Surco un programa de DJ nuevo (el sexto o siguientes, tras rekordbox, Traktor, Engine DJ, Serato y VirtualDJ), al medir la biblioteca, los cues, las listas o el reloj de un programa de DJ antes de soportarlo, o al planificar o revisar su integración por la puerta común (DjProgram, PROGRAM_CAN, window.api.dj).
---

# Añadir un programa de DJ a Surco

## Idea central

Un programa entra por la puerta común (`window.api.dj.*`, `window.api.cues.*`) y por las tablas por
programa. El compilador señala la mayoría de las filas, **pero no todas**: VirtualDJ dejó Copias,
duplicados, daños, el seguidor de tamaño y la comprobación tras convertir como filas que no hacían nada,
y el compilador no dijo nada. La lista de "lo que no obliga el compilador" es lo que más importa aquí.

Todo en una rama y un worktree, sin mergear a main hasta pasar la batería, la matriz y la prueba real
(regla del usuario). Rutas de código relativas a `apps/desktop/src/`.

Historia completa, para cuando algo de aquí no baste:
- Puerta común: `docs/superpowers/specs/2026-11-10-programas-dj-interfaz-design.md` y la sección
  "Resultado de la prueba de fuego" de `docs/superpowers/plans/2026-11-10-programas-dj-interfaz.md`.
- VirtualDJ: `docs/superpowers/specs/2026-11-11-virtualdj-design.md`,
  `docs/superpowers/plans/2026-11-11-virtualdj-bloques-1-2.md`,
  `docs/superpowers/plans/2026-11-11-virtualdj-bloques-3-7.md`, `docs/virtualdj-medidas.md`.
- Decisiones y huecos de cada revisión (no versionado): `.superpowers/sdd/2026-11-11-virtualdj-bloques-*/progress.md`
  y `task-*-review.md`.

## 1. Medir antes de escribir código

Con el programa real instalado. Rellenar `plantilla-medidas.md` (al lado de este fichero) en
`docs/<programa>-medidas.md`. Las medidas las hace el controlador con el usuario, nunca un
implementador: hace falta la interfaz del programa y a veces su cuenta.

- **Copia antes de tocar nada**: la carpeta de la biblioteca y la de cada disco externo. Única excepción:
  el usuario dice que ese programa no lo usa para pinchar (pasó con VirtualDJ). Los otros cinco
  programas siempre con copia.
- **Dónde guarda** biblioteca, cues, loops, rejilla y listas. Cómo identifica una pista (VirtualDJ: por
  ruta, el mismo fichero en dos carpetas son dos entradas).
- **Cuándo escribe**: al cambiar algo, al cerrar, o las dos. Si respeta al abrirse lo que Surco escribió
  con él cerrado y si lo conserva al cerrarse. Probarlo añadiendo a mano un cue y una lista.
- **Finales de línea y codificación** de cada fichero (`file`, `sed -n l`). VirtualDJ usa CRLF en
  `database.xml` y `.vdjfolder` y LF en `order`. Una base reescrita con LF la guardó como
  `Backup/<fecha> broken database.xml`, avisó de corrupción y empezó una base nueva sin cues.
- **El reloj.** Comparar el análisis propio del programa entre formatos (WAV, AIFF, FLAC, MP3, M4A de la
  misma canción) y su rejilla contra `measureBeatGrid` (`main/ffmpeg.ts`). Si coinciden, su posición es el reloj
  de Surco y el desfase es 0. **No medir el reloj con cues que el programa importa de otro**: el "MP3
  adelantado 26,12 ms" de VirtualDJ era su forma de importar cues de Serato, no su reloj, y llegó a
  planificarse un `virtualdjClock.ts` que habría descuadrado todos los MP3. Se descubrió al bloquear la
  Tarea 10.
- **Rejilla**: unidades (VirtualDJ guarda segundos por pulso) y qué es el ancla, confirmado contra lo que
  pinta el programa.
- **Discos externos**: si hay una base por volumen y con qué forma de ruta (VirtualDJ:
  `<volumen>/VirtualDJ/database.xml` con `D:/…` relativo al volumen, y entidades XML en las rutas).
- **Pista desaparecida**: qué hace con su entrada.
- **Proceso**: nombre exacto (`pgrep -x VirtualDJ`), cómo abrirlo (`open -a`) y cómo cerrarlo sin
  diálogo (ver Trampas).
- Fixtures del repo (público) sin rutas personales: reescribir a `/Music/<Programa> Pruebas/...`, y
  marcar su carpeta `-text` en `.gitattributes` si el formato depende de los bytes (ya está así
  `apps/desktop/src/main/virtualdjFixtures/**`).

## 2. Orden de bloques

Cada bloque cierra con suite, tres `tsc`, Biome sin errores nuevos en lo tocado, matriz celda a celda
igual a la base y la prueba real que se indica. Antes del bloque 1, medir la base (suite, tipos, Biome,
matriz en `.superpowers/sdd/<plan>/matriz-base.txt`).

| # | Bloque | Aceptación (además de las puertas) | Prueba real |
|---|---|---|---|
| 1 | **Tablas.** Pasar a tabla todo sitio de la lista de abajo que siga escrito a mano, sin cambiar nada de los programas existentes. | Tests de caracterización verdes antes de mover; mutación (quitar una fila) los tumba. | Driver por los sitios tocados con los programas actuales. |
| 2 | **Solo lectura.** Lectores puros sobre los fixtures, `<p>Read(host): DjReadMain`, fila en `PROGRAM_CAN` con todo `false`, `CONTENT_OF`, pestaña, panel de Ajustes, asistente, icono, traducciones. | Una entrada rara (sin etiquetas, sin rejilla, entidades, ruta no ASCII, NFC/NFD) no tumba la pestaña. | Driver contra una **copia** de la biblioteca real apuntada desde Ajustes: árbol, lista, colección, cues al ms de lo que guarda el programa. Hash de la biblioteca real igual antes y después. |
| 3 | **Escribir cues** con borrador (huella mtime+tamaño), copia antes, comprobación de proceso justo antes de cada renombrado y cola mientras el programa está abierto. Gemelas y cues entre programas. | Ida y vuelta sin cambios = mismos bytes; cambiar un cue cambia solo sus líneas; lo que Surco no entiende sobrevive. | Guardar desde Surco cues con nombre y color y un loop en MP3 y FLAC, abrir el programa, sin aviso de corrupción, cerrar, releer. Repetir con el programa abierto: la cola espera y escribe una vez al cerrarlo. |
| 4 | **Raíces por disco.** Una base por volumen montado si el programa las tiene. | Una pista de un volumen se escribe solo en la base de ese volumen; volumen desmontado no aparece. | Pista en un disco externo real. |
| 5 | **Flujos y gemelas**: el programa como origen y destino de cues (`cueFlowTo<P>`). | Un flujo de rekordbox al programa escribe en la gemela; del programa a otro lo lleva. | Abrir en el programa un cue llegado por flujo. |
| 6 | **Editar listas** (crear, renombrar, borrar, añadir, quitar, reordenar, carpetas). Con `edit` salen solos pegar tracklist y la sesión automática. | Ediciones encoladas llevan huella de todo lo que tocan (un borrado encolado no pisa lo que el usuario hizo entretanto). | Crear, renombrar y borrar lista y carpeta, pegar un tracklist por la interfaz, abrir el programa y verlo. |
| 7 | **Biblioteca escribible**: `write`/`reach` a `true`, añadir lo convertido, llevar etiquetas, repuntar al convertir. | Convertir con recorte desplaza cues y quita los que caen fuera; una negativa a repuntar nunca retira el original en silencio. | Convertir una pista de la pestaña y ver en el programa la pista repuntada con sus cues. |
| 8 | **Comprobación, Copias, duplicados y daños.** | Cada tabla tiene una fila que hace algo, no un no-op (ver lista). Restaurar devuelve base y listas juntas. | Restaurar desde Copias con el programa cerrado y deshacer: bytes idénticos. |
| 9 | **USB**: `usb: true`, `read<P>ExportSelection` (modelo `main/usbExportVirtualdj.ts`), vista del modal. | Cues, loops, rejilla y etiquetas en el XML de baken. | Exportación real con baken (sección 5). |
| 10 | **Batería y matriz**: fila en `TEST_LIBRARIES`, tablas de reloj, celdas de matriz. | Batería verde con cada paso decidido por las tablas; un fallo en otro programa se arregla en la rama con su test rojo y su commit. | Prueba final completa con los seis programas (cerrados, con copia). |
| 11 | **Web y tabla de funciones** (`apps/web/src/i18n/locales/*.json`, `apps/web/src/App.tsx`, página de funciones, `docs/funcionalidades.md`). | Solo afirmar lo que pasó la prueba real; test que fija las celdas contra una tabla de datos; prerender en los 6 idiomas. | Boceto dibujado (artifact) aprobado por el usuario antes de construir la tabla; captura con Brave contra `vite preview`. |

## 3. Lo que obliga el compilador

Añadir el nombre a `DjProgram` (`shared/djProgram.ts`) pide filas en todo esto. Rellenarlas con
capacidades reales, no con objetos que no hacen nada.

| Tabla | Fichero | Controla |
|---|---|---|
| `PROGRAM_CAN` columnas `write`, `usb`, `reach`, `windows` | `shared/djProgram.ts` | Vía `ProgramsThatCan` deriva `WritableProgram`, `UsbProgram`, `ReachProgram` y `ReadOnlyProgram`, que a su vez exigen o quitan filas en todo lo demás. `windows: false` lo oculta en Windows. |
| `DJ_PROGRAMS`, `LIBRARY_PROGRAMS`, `RAIL_PROGRAMS`, `CUE_PROGRAMS` (`programsInOrder`); `WRITABLE_PROGRAMS` (`writableInOrder`) | `shared/djProgram.ts` | Órdenes. `programsInOrder`/`writableInOrder` no compilan si falta un programa; úsalos para cualquier lista nueva. |
| `CONTENT_OF` | `shared/djProgram.ts` | Prefijo del id (`virtualdj:` + ruta) para `programOf`. |
| `DjMainTable` (`read`, `edit?`, `cueQueue?`, `exportCollection?`, `pickLibraryPath?`, `running?`) | `shared/djApi.ts`, construida en `main/index.ts`, repartida por `registerDjIpc` en `main/djIpc.ts` | Toda la API entre procesos del programa. Ni el preload ni `preload/api.ts` ganan métodos. |
| `sources` de `registerCuesIpc`; `programQueues` | `main/cuesIpc.ts`; `main/index.ts` | Fuente de cues y cola. `cues:save` rechaza un programa con fuente `null`. |
| `SOURCE_READ`, `SOURCE_PROGRAMS` | `renderer/src/lib/sourcePrograms.ts` | Lectura del renderer (`collection` activa pegar tracklist) y columnas de la pestaña: `edit` (con `kinds`, `folders`, `gate`), `separator`, `usb`, `crates`, `idJoin`, `marksOrigin`… |
| `CUE_PROGRAMS` (renderer) | `renderer/src/lib/cuePrograms.ts` | Editor de cues: `slots`, `takesFlows`, `twinsOnSurcoGrid`, `runningNote`, `fixedGrid`… |
| `COPY`; `PROGRAM_QUEUES` | `renderer/src/components/CuesSection.tsx`; `renderer/src/hooks/useRekordboxQueue.ts` | Textos del editor y pastilla de cola. |
| `DJ_PROCESSES`, `QUIT_REASONS`, `QUIT_TEXT`, `QUIT_PROMPT_SHARING` | `main/djProcesses.ts` | Saber si está abierto y pedir que se cierre (ver Trampas). |
| `DJ_REACH_SETTINGS`, `DJ_COLLECTION_PATH`; `FLOW_TO`; `OFFERED`; `PLAYLISTS_FIELD_OFFERED` | `shared/djSettings.ts`; `renderer/src/lib/cueTwins.ts`; `renderer/src/hooks/useRekordboxPlaylists.ts`; `renderer/src/lib/onboarding.ts` | Ajustes guardados nuevos (`addTo<P>`, `sync<P>`, ruta, `cueFlowTo<P>`, `<p>PlaylistsFieldOffered`), la única excepción permitida a "sin nombres de programa en tipos compartidos". |
| `FILE_USE`, `COPY_INFO`, `TRACK_OF` (`LocationOf`) | `main/libraryFileUse.ts` | Qué ficheros usa la biblioteca: protege de reemplazo, papelera y retirar original; gemelas. |
| `FLUSH_ORDER`, `flushers`, `SYNC_BLOCKED_KEY`, `REPORTS_SYNC_ISSUES`, `Sessions` | `main/libraryFlushes.ts` | Añadir lo convertido y repuntar tras convertir. |
| `JOB_PLAYLISTS`; `ATTACH_PLAYLISTS`, `REPOINT_PLAYLISTS`; `LibraryTagFlushers` | `main/processTrack.ts`; `main/rekordboxBatch.ts`; `main/libraryTagSync.ts` | Listas elegidas, repunte de listas y llevar etiquetas. |
| `LISTED`, `CHECKS`; `PLACE_PROGRAMS` | `main/verifyRegistry.ts`; `shared/verification.ts` | Comprobación tras convertir. |
| `programs` de `registerCopiesIpc`; `LIBRARY_SCANS`; `REPAIR_ORDER`; `RUNNING_REASON`; `KEEPS_REPLACED` | `main/copiesIpc.ts`; `main/damageScan.ts`; `main/damageRepair.ts`; `main/duplicateReplace.ts`; `shared/keepsReplaced.ts` | Copias, daños y duplicados. |
| `READ_ONLY_BLOCKED`; `LEFT_OUT_KEY` | `shared/trackOrigin.ts`; `renderer/src/lib/batch.ts`, `renderer/src/components/MusicReview.tsx` | Pistas de un programa de solo lectura que no se convierten. |
| `USB_PROGRAM_VIEW` | `renderer/src/components/UsbExportModal.tsx` | Vista del modal de USB. |
| `LIBRARY_ICON`, `LIBRARY_NAME`, `LibraryStatus`, `LibraryTagSyncReport` | `renderer/src/components/SourceIcons.tsx`, `renderer/src/lib/reviewLibraries.ts`, `shared/types.ts` | Icono, nombre y estado. |
| `TEST_LIBRARIES`; `STORED_MINUS_READ_MS`, `CONVERSION_MOVE_MS`, `STICK_MOVE_MS`, `STICK_CUES_LEFT_OUT`; `STICK_FORMAT`; `MATRIX_PROGRAMS` | `scenarios/djPrograms/libraries.ts`; `scenarios/djPrograms/clocks.ts`; `scenarios/djPrograms/usb.ts`; `scenarios/matrix/cells.ts` | Batería y matriz. Un programa nuevo no compila sin su biblioteca de pruebas y su reloj esperado por formato. |

Para encontrar el resto: `grep -rn -E 'Record<(DjProgram|LibraryProgram|WritableProgram|CueProgram|UsbProgram|ReachProgram|ReadOnlyProgram)|in (DjProgram|LibraryProgram|WritableProgram|CueProgram)\]|programsInOrder\(|writableInOrder\(' src`.

## 4. Lo que NO obliga el compilador (lista de comprobación)

Recorrerla entera en cada bloque. Cada punto costó una revisión.

**Filas que compilan pero no hacen nada**
- [ ] Ninguna fila es un no-op: `CHECKS.<p>` vacío, `LISTED.<p>.touches: () => false`, `collectionPath: () => null` en Copias, `DuplicateSteps.<p>: undefined`, tablas de daños a `null`. Buscar en el diff `() => false`, `async () => {}`, `null`, `undefined` en filas del programa nuevo y justificar cada uno.
- [ ] `UsbExporters` (`main/usbExportRoute.ts`) es `Partial`: sin exportador el USB responde `unsupported` y compila.
- [ ] `WIRED_READS` de `scenarios/harness.tsx` es `Partial`, y la tabla de `scenarios/djPrograms/door.ts` es una copia a mano del cableado de `main/index.ts` (sin `serialLibraryFlush` ni `ensureClosed` reales): revisar que siguen a producción.

**Caminos compartidos que antes solo seguía un programa**
- [ ] **Seguidor de tamaño.** Si la biblioteca guarda el tamaño del fichero, crear su `librarySizeFollower` (`main/librarySizeFollow.ts`) en `main/index.ts` y sumarlo a `followLibrarySize = followingAll(...)`, que llega a la revisión de listas (`listReviewWiring.ts`), Music (`appleMusicIpc.ts`), el retag de la conversión (`processTrack.ts`) y el lote de Serato. Daños (`damageDeps` en `index.ts`, `damageWiring.ts`) y restaurar un original (`trashIpc.ts`) reciben un seguidor por programa escrito a mano (`followEngineSize`, `followVirtualdjSize`), con su guarda. Hasta VirtualDJ solo Engine los seguía.
- [ ] **Copias de base y listas juntas.** Si el programa guarda listas fuera de la base, una copia por momento de escritura con las dos partes, restaurarlas juntas, y "Antes de restaurar" con las dos (si no, la segunda restauración pierde el deshacer de la primera). Rotación separada para que las copias de listas no echen las de la base.
- [ ] **Duplicados**: pedir cerrar y escribir fila de Actividad como los demás, no saltarse el paso en silencio.
- [ ] **Comprobación tras convertir** que relea el programa, también para una pista añadida sin listas.
- [ ] Repunte que el programa no puede seguir (otro volumen, destino ocupado): conservar el original (`librariesKeepingOriginal` en `main/libraryFlushes.ts`) y avisar. Un fallo de listas después de escribir la base se reintenta, no se da por hecho.

**Trampas de cerrar el programa**
- [ ] `reasonOfDetail` (`main/djProcesses.ts`) lanza si el programa no tiene `QUIT_TEXT`, y `ensureClosed` devuelve `false` sin diálogo. Copias, USB y duplicados no pueden pasar por ahí sin darle `QUIT_REASONS` y textos (`<p>Quit*` en `main/i18n.ts` y `main/locales/ja.json`).
- [ ] Si Surco no sabe cerrarlo, `quit` solo espera a que el usuario lo cierre (`waitForVirtualdjExit` en `main/virtualdjProcess.ts`) y `convert` va sin diálogo (`detail.convert: null`).

**Sitios escritos a mano**
- [ ] Traducciones por plantilla en los 6 idiomas (`renderer/src/i18n/locales/*.json`): `sources.<p>`, `sources.hide|failed|notFound|gone.<p>`, `settings.source.<p>`, `settings.source<P>Unavailable`, `settings.<p>Library*`, `settings.cueFlows.targets.<p>`, `fields.<p>Playlists`, `onboarding.djLibrary.<p>*`, `editor.cues.<p>.*`, `sources.edit<P>.*`, `<p>Queue.*`, `usbExport.errorsFrom.<p>.*`, `activity.<p>Sync*`. `keys.test.ts` solo compara es y en.
- [ ] Panel propio en Ajustes, Programas de DJ (`<div {...panel('<p>')}>` en `renderer/src/components/settings/DestinationTab.tsx`, `PROGRAM_OF_ANCHOR`); sin él el botón abre un panel vacío. Búsqueda de Ajustes (`renderer/src/lib/settingsSearchIndex.ts`); si el programa no existe en Windows, esa búsqueda no se filtra por plataforma y abre una pestaña vacía (pendiente con VirtualDJ; `offeredHere` de `DestinationTab.tsx` ya filtra el resto).
- [ ] Ruta de la biblioteca en `LOCAL_KEYS` y `MACHINE_PATH_KEYS` (`main/settings.ts`), `LocalDraft`/`pickLocal` (`renderer/src/lib/settingsDraft.ts`), valores por defecto en `renderer/src/lib/settingsContext.tsx` y `renderer/src/test/api.ts`.
- [ ] Sonda del asistente: `Promise.all` de `dj.available(...)` en `renderer/src/components/OnboardingWizard.tsx`.
- [ ] `pickLibraryPath` y `running` en la fila de `DjMainTable` (opcionales).
- [ ] Reselección de una lista abierta movida o renombrada en `renderer/src/App.tsx` si los ids son rutas.
- [ ] `MATRIX_PROGRAMS` obliga a nombrar el programa, pero sus celdas y su oráculo (`virtualdjBroken` en `scenarios/matrix/oracle.ts`) se escriben a mano.
- [ ] Tests que afirman la lista de programas (`djProgram.test.ts`, `sourcePrograms.test.ts`, `GeneralTab.test.tsx`, `CuesTab.test.tsx`, `libraryTagSync.test.ts`, `onboarding.test.ts`…) y los que usan un nombre inventado como programa desconocido (hoy `'djotron'`): si el programa nuevo se llama así, cambiar el ejemplo.
- [ ] El camino de cues de solo lectura se borró (commit `89a5a8a95`). Si el bloque 2 enseña cues sin guardarlos, recuperarlo de ahí o ir directo al bloque 3.

**Formato y reloj**
- [ ] Escritura sobre el texto, conservando bytes, finales de línea, entidades y lo desconocido; rechazar una entrada con finales de línea que no son los medidos.
- [ ] La batería comprueba el formato tras cada paso (`formatProblems` de su `TestLibrary`) y los cues contra el fichero crudo (`storedCuesMs`), no solo con el lector del propio programa: un error simétrico entre lector y escritor pasa el lector.

## 5. Cómo probar

Desde `apps/desktop` del worktree. `node_modules` vive en el checkout principal: `R=/Users/vicent/code/surco`.

```bash
node $R/node_modules/vitest/vitest.mjs run src            # suite, en primer plano, timeout 600000; salida 0 sin Errors/Unhandled
node $R/node_modules/vitest/vitest.mjs run src/main/<f>.test.ts   # un fichero (nunca filtrar desde la raíz del repo)
for p in web node scenarios; do $R/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done
$R/node_modules/.bin/biome check <ficheros tocados>      # main trae errores previos: sin errores nuevos
SURCO_MATRIX=1 node $R/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx --reporter=verbose   # diff contra matriz-base.txt
node $R/node_modules/vitest/vitest.mjs run src/scenarios/djPrograms/battery.test.tsx   # batería (también corre en la suite)
PATH="$R/node_modules/.bin:$PATH" electron-vite build    # antes del driver
```

- **Mutación a mano** en cada pieza nueva (escribir `\n` en vez de `\r\n`, ignorar el orden, quitar una
  fila): ver caer el test, deshacer editando.
- **Driver**: skill `run-desktop` (`apps/desktop/.claude/skills/run-desktop/SKILL.md`), `node driver.mjs repl`
  desde esa carpeta del worktree, con `launch`, `eval <js>` (llama a `window.api.dj.*` y
  `window.api.cues.*`, ids `<p>:<ruta>`) y `quit`. Abre el `out/` del árbol desde el que se lanza: build
  en el mismo worktree. En su perfil (`~/Library/Application Support/Electron/settings.json`) dejar en
  `false` los ajustes de añadir y sincronizar de los otros programas.
- **Programa real**: copia, programa cerrado al escribir, después `open -a <Nombre>`, esperar ~30 s,
  mirar ficheros y avisos (VirtualDJ: `ls Backup/*broken*` vacío), cerrar con `pkill -TERM -x <Nombre>`
  y releer. Repetir con el programa abierto para ver la cola.
- **USB real con el baken de la app**: copiar `/Applications/Surco.app/Contents/Resources/baken/baken`
  a `apps/desktop/resources/baken/baken` (ignorado por git; no hay cargo para `npm run build-baken`).
  Test desechable `src/main/zz-<bloque>.local.test.ts`, nunca commiteado: copia de la biblioteca a un
  temporal, `read<P>ExportSelection`, `stageExport` (de `main/usbExportStage.ts`) con los argumentos de
  `pioneerFrom` en `main/usbExportIpc.ts`, y `runBaken(..., bakenArgs({ target: 'folder', ... }))` de
  `main/bakenRun.ts` hacia una carpeta temporal. **Al hijo baken, `HOME` y `XDG_CACHE_HOME` apuntando a
  un temporal vacío**: lleva rutas fijas a `~/Library/Pioneer` y a la caché. Leer el resultado con
  `beatGrid` y `anlzSections` (`main/anlz.ts`) y `openRekordboxDb` (`main/rekordboxDb.ts`) sobre
  `exportLibrary.db`. Modelo: `.superpowers/sdd/2026-11-11-virtualdj-bloques-3-7/block-5-check-report.md`.

## 6. Trampas

- **Editar en modo texto convierte CRLF en LF.** Las herramientas de edición, `sed` o Python en modo
  texto sobre `database.xml` o un fixture rompen el formato sin que se note. Tocar esos ficheros en
  binario (`open(p, 'rb')`), comprobar con `file` o `sed -n l`, y mantener `-text` en `.gitattributes`.
- **`screencapture` no captura ventanas generadas.** `screencapture -l <wid>` de VirtualDJ sale en
  blanco, y la pantalla completa es el escritorio del usuario (no capturarla). Juzgar el programa por sus
  ficheros y sus avisos; la comprobación en pantalla la hace el usuario.
- **El Quit de AppleScript devuelve "User canceled"** porque VirtualDJ pide confirmación al salir. Cerrar
  con `pkill -TERM -x`. Con `pkill` VirtualDJ no reescribió la base al salir, así que "lo conserva al
  cerrar" se acepta por ausencia de copia rota en tres arranques.
- **Caminos compartidos que solo seguía Engine** (seguidor de tamaño, repunte en su sitio): el programa
  nuevo hereda el hueco en silencio. Ver lista.
- **Copias que hay que tomar juntas**: base y listas por separado dan restauraciones a medias.
- **Programa nuevo escribible por defecto** si alguien vuelve a escribir un `Exclude<DjProgram, …>`:
  derivar siempre de `PROGRAM_CAN`.
- **Nunca escribir con el programa abierto**, ni en su biblioteca real desde tests. Comprobar el proceso
  antes de la copia y otra vez justo antes de cada renombrado.
- **Flakes bajo carga** (`CuesTab.test.tsx`, `App.test.tsx`): repetir el fichero solo antes de dar nada por
  roto, y apuntarlo; no alargar timeouts.
