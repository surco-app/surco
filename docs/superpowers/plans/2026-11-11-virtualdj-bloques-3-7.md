# VirtualDJ, bloques 3 a 7 (escritura, listas y biblioteca, USB, batería, cierre) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que VirtualDJ salga completo como los otros cuatro programas (cues que se guardan, listas editables, añadir lo convertido, etiquetas, repuntar y convertir, USB) y que una batería de integración pruebe los cinco programas por la puerta común antes de mergear a main.

**Architecture:** Un escritor de `database.xml` y de `MyLists` que cambia solo los nodos tocados y conserva el resto byte a byte (CRLF incluidos). Toda escritura va por la cola de VirtualDJ, con copia antes y comprobando que VirtualDJ sigue cerrado justo antes de cada renombrado. VirtualDJ pasa a `write: true`, `reach: true`, `usb: true` y `saveCues: true` en `PROGRAM_CAN`, y el compilador pide cada fila. Un fichero por volumen: la base de `~/Library/...` para el disco interno y `<volumen>/VirtualDJ/database.xml` (rutas `D:/…`) para cada disco externo montado.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-11-virtualdj-design.md`. Medidas: `docs/virtualdj-medidas.md`. Plan previo: `docs/superpowers/plans/2026-11-11-virtualdj-bloques-1-2.md`.

## Global Constraints

- Las mismas del plan de los bloques 1 y 2 (worktree `virtualdj`, comandos, suite en primer plano, tipos, Biome sin errores nuevos, matriz celda a celda con la base `.superpowers/sdd/2026-11-11-virtualdj-bloques-1-2/matriz-base.txt`, TDD, mutación, cero comentarios, commits en inglés de una línea, 6 idiomas sin guion largo ni dos puntos de explicación, `data-testid`, fixtures sin rutas personales). Nada se mergea a main hasta la Tarea 19.
- **Formato de escritura (medido):** `database.xml` y `.vdjfolder` en CRLF; `order` en LF; nada que no cambie se reescribe; una base con LF la da por rota y pierde cues. Entidades XML en los atributos (`&amp;`, `&apos;`, `&quot;`, `&lt;`, `&gt;`).
- **Reloj:** `Pos` y `Phase` en segundos del reloj de Surco en todos los formatos (sin desfase).
- **Loop:** `<Poi Type="loop" Num="-1" Slot="n" Pos="inicio s" Size="pulsos" [Name] [Color]>`. **Color:** `0xFF000000 | rgb`.
- **Hot cues por encima del 8** (`Num > 8`): no salen en las filas del editor; al escribir se conservan leyéndolos de la base, nunca de `TrackCues`.
- **Nunca escribir con VirtualDJ abierto** (`pgrep -x VirtualDJ`), ni en su biblioteca real desde tests. Las pruebas a mano contra VirtualDJ real las hace el controlador: copia de `~/Library/Application Support/VirtualDJ` y del `VirtualDJ/` del disco externo antes, VirtualDJ cerrado al escribir, y después abrirlo, mirar (captura y ficheros, `Backup/*broken*` vacío) y cerrarlo con `pkill -TERM -x VirtualDJ`.
- Un fallo que encuentre la batería (Tarea 18) en rekordbox, Traktor, Engine o Serato se arregla en esta rama, con su test rojo primero, en un commit propio.

## Rulings

- **Ruling:** el escritor es un "borrador" como el de Serato (`main/seratoLibraryWrite.ts`): lee con huella (mtime y tamaño), aplica las operaciones encoladas, copia a la carpeta de copias de Surco, escribe en temporal y renombra comprobando antes que VirtualDJ sigue cerrado.
- **Ruling:** convertir una pista de VirtualDJ es repuntar su `<Song>` (como Engine y Traktor, cuyos cues viven en la base): `FilePath`, `FileSize`, los `Poi` desplazados por el desplazamiento de la conversión (los que caen fuera se quitan), y las listas que la contienen. No hay que llevar cues dentro del fichero.
- **Ruling:** el id de una pista de disco externo es `virtualdj:` + la ruta absoluta en macOS (`/Volumes/Public/…`); la traducción `D:/…` ↔ `/Volumes/<v>/…` vive solo en el lector y el escritor del volumen.

## Review Focus

- **Escribir sin cambiar nada da los mismos bytes** que el `database.xml` y los `.vdjfolder` medidos (CRLF, entidades, cabecera rellena de espacios, `Poi` desconocidos, `Comment`, `Flag`, `AudioSig`). Test de ida y vuelta en la Tarea 11.
- **VirtualDJ se abre mientras la cola espera**: no se escribe nada; al cerrarse se escribe una vez. Test en la Tarea 12.
- **Un cue con nombre o una ruta con `&`, comillas o no ASCII** se escribe escapado y se vuelve a leer igual. Tests en las Tareas 11 y 14.
- **Convertir con recorte**: un cue que cae dentro del trozo recortado se desplaza; uno que cae fuera se quita; un loop que se corta se quita. Test en la Tarea 16.
- **Dos discos y la base interna**: una pista de `/Volumes/Public` se escribe en la base de ese volumen y nunca en la de `~/Library`. Test en la Tarea 13.

---

## Bloque 3. Escribir cues

### Task 11: Escritor de `database.xml`

**Files:**
- Create: `main/virtualdjDatabaseWrite.ts`, `main/virtualdjDatabaseWrite.test.ts`
- Use: `main/virtualdjFixtures/database.xml`

**Interfaces:**
- Produces:
  ```ts
  export type VirtualdjCueWrite = { num: number; seconds: number; name?: string; color?: number }
  export type VirtualdjLoopWrite = { slot: number; seconds: number; sizeBeats: number; name?: string; color?: number }
  export function withVirtualdjCues(xml: string, path: string, cues: VirtualdjCueWrite[], loops?: VirtualdjLoopWrite[]): string | null
  export function withVirtualdjSongMoved(xml: string, from: string, to: { path: string; size: number }, shiftSeconds: number, keepUntilSeconds: number | null): string | null
  export function withVirtualdjTags(xml: string, path: string, tags: Partial<Record<'Title' | 'Author' | 'Album' | 'Genre', string>>): string | null
  export function withVirtualdjSongAdded(xml: string, song: { path: string; size: number; title: string; artist: string; album: string; genre: string }): string | null
  ```
  `null` si la pista no está (o ya está, al añadir). `withVirtualdjCues` reemplaza los `Poi Type="cue"` con `Num` 1-8 y deja intactos los de `Num > 8`, los `loop` (si `loops` es `undefined`), `automix` y `remix`.

- [ ] **Step 1:** Tests rojos: ida y vuelta sin cambios = bytes idénticos sobre el fixture; cambiar un cue cambia solo esa línea y mantiene CRLF; `Num="9"` sobrevive; nombre con `&`/comillas escapado; mover desplaza y quita lo que cae fuera; añadir mete un `<Song>` CRLF con `Tags`; etiquetas cambian solo esos atributos.
- [ ] **Step 2:** Implementar sobre el texto (sin reconstruir el XML), con los ayudantes de `shared/xml.ts`.
- [ ] **Step 3:** Mutación: escribir `\n` en vez de `\r\n` → falla la ida y vuelta.
- [ ] **Step 4:** Commit `Write VirtualDJ's database without touching what does not change`.

### Task 12: Borrador, copias y cola de VirtualDJ

**Files:**
- Create: `main/virtualdjLibraryWrite.ts` (borrador con huella, copias, renombrado comprobando `isRunning`), `main/virtualdjCueQueueIpc.ts` (`virtualdjCueQueueSection`), tests.
- Modify: `main/index.ts` (cola en `programQueues`, fila `cueQueue` de `DjMainTable`, `sources.virtualdj` con escritura), `shared/djProgram.ts` (`PROGRAM_CAN.virtualdj.saveCues = true`), `renderer/src/lib/cuePrograms.ts` (`takesFlows: true`), y lo que pida el compilador.

- [ ] **Step 1:** Tests rojos: guardar con VirtualDJ cerrado escribe al momento y deja copia; con VirtualDJ abierto encola y escribe una vez al cerrarse; si VirtualDJ se abre entre leer y renombrar, no se renombra; deshacer quita lo encolado.
- [ ] **Step 2:** Implementar siguiendo `seratoLibraryWrite.ts`, `seratoCueQueueIpc.ts` y `applySeratoCuesBatch`.
- [ ] **Step 3:** La fuente de cues pasa a escribir con `withVirtualdjCues`; el editor deja de estar en solo lectura para VirtualDJ y usa la onda con su rejilla, como los demás.
- [ ] **Step 4:** Commit `Save VirtualDJ cues, waiting while VirtualDJ is open`.

### Task 13: Una base de datos por volumen

**Files:**
- Modify: `main/virtualdjLibrary.ts` (raíces: la interna y `<volumen>/VirtualDJ/` de cada volumen montado; traducción `D:/…` ↔ `/Volumes/<v>/…`), `main/virtualdjLibraryWrite.ts`, `main/libraryFileUse.ts` (fila `virtualdj` con varias raíces), settings si hace falta.

- [ ] **Step 1:** Tests rojos: una base de volumen con `D:/Musica/x.flac` y `&apos;` se lee como `/Volumes/<v>/Musica/x.flac`; escribir una pista de ese volumen toca su base y no la interna; un volumen desmontado no aparece; un volumen sin `VirtualDJ/` no se crea.
- [ ] **Step 2:** Implementar. Si la letra `D:` no se puede deducir con un solo disco medido, el controlador mide un segundo volumen antes (pedir NEEDS_CONTEXT).
- [ ] **Step 3:** Commit `Read and write the VirtualDJ database of each mounted drive`.

### Task 14: Cues entre programas y gemelas

**Files:**
- Modify: `renderer/src/lib/cueTwins.ts`, `main/libraryFileUse.ts` (`TRACK_OF.virtualdj` ya existe; revisar), settings `cueFlowToVirtualdj`, `CuesTab.tsx`.

- [ ] **Step 1:** Tests rojos: un flow de rekordbox a VirtualDJ escribe los cues en el `<Song>` gemelo (misma ruta, NFC); de VirtualDJ a Serato los lleva al fichero; la casilla de VirtualDJ en Ajustes, Cues ya no está deshabilitada.
- [ ] **Step 2:** Implementar. Commit `Carry cues to and from VirtualDJ`.

**Cierre del bloque 3:** matriz igual a la base; prueba con VirtualDJ real por el controlador: guardar desde Surco 3 cues con nombre y color y un loop en Pray.mp3 y Pray.flac; abrir VirtualDJ; captura con los cues en su sitio (y sin `broken database.xml`); cerrar; leer la base y comprobar que se conservaron. Repetir con VirtualDJ abierto al guardar (la cola espera y escribe al cerrarlo).

## Bloque 4. Listas, biblioteca, etiquetas y convertir

### Task 15: Escritor de `MyLists` y edición en la pestaña

**Files:**
- Create: `main/virtualdjListsWrite.ts` (crear lista o carpeta, renombrar, borrar, añadir, quitar, reordenar; `.vdjfolder` CRLF, `.subfolders/`, `order` LF), `main/virtualdjPlaylistEditIpc.ts` (`virtualdjEdit`), tests.
- Modify: `main/index.ts` (fila `edit`), `renderer/src/lib/sourcePrograms.ts` (`edit` de VirtualDJ; con eso salen pegar un tracklist y la sesión automática).

- [ ] **Step 1:** Tests rojos por operación sobre una copia de los fixtures, incluido renombrar una carpeta (renombra `.vdjfolder`, `.subfolders/` y su línea de `order`) y borrar una carpeta con listas dentro.
- [ ] **Step 2:** Implementar por la cola y el borrador de la Tarea 12. Commit `Edit VirtualDJ lists and folders from its tab`.

### Task 16: Añadir lo convertido, etiquetas, repuntar y convertir

**Files:**
- Modify: `shared/djProgram.ts` (`PROGRAM_CAN.virtualdj.write = true`, `reach = true`) y cada fila que pida el compilador (`JOB_PLAYLISTS`, `ATTACH_PLAYLISTS`, `REPOINT_PLAYLISTS`, flusher de etiquetas, `SyncedLibraries`, `DuplicateSteps`, copias, comprobación…); `main/processTrack.ts` (paso de VirtualDJ como los de Engine/Serato), `main/libraryFlushes.ts`, `main/libraryTagSync.ts`, `renderer/src/components/settings/DestinationTab.tsx` (añadir y sincronizar, ya visibles), `PlaylistsField`.

- [ ] **Step 1:** Tests rojos: con `addToVirtualdj` una conversión nueva entra como `<Song>` y en las listas elegidas; con `syncVirtualdj` la revisión lleva título, artista, álbum y género; convertir una pista de la pestaña VirtualDJ repunta su `<Song>` y las listas, desplaza los cues y quita los que caen fuera; la conversión ya no se rechaza (`READ_ONLY_BLOCKED` sin VirtualDJ).
- [ ] **Step 2:** Implementar. Commit por capacidad (`Add converted tracks to VirtualDJ`, `Carry tag changes to VirtualDJ`, `Follow a converted VirtualDJ track to its new file`).

### Task 16b: Comprobación, Copias, duplicados y daños

Salió en la revisión de la Tarea 16: las filas de VirtualDJ en estas tablas no hacen nada, y el usuario pidió VirtualDJ "completo, como el resto".

**Files:** las tablas de comprobación tras convertir, la pantalla Copias (restaurar `database.xml` y `MyLists` desde `virtualdj-backups` y `virtualdj-backups/lists`), la sustitución de duplicados y la reparación de daños, siguiendo a Serato en cada una.

- [ ] **Step 1:** Tests rojos por capacidad: tras convertir, Surco relee VirtualDJ y confirma la pista; Copias lista las copias de VirtualDJ y restaura una (con VirtualDJ cerrado, copia de cómo estaba antes, solo descarta la cola de VirtualDJ); quitar un duplicado pasa sus listas y su `<Song>` a la copia que se queda; la reparación de daños llega a VirtualDJ como a los otros.
- [ ] **Step 2:** Implementar. Ojo: `reasonOfDetail` lanza con VirtualDJ y `ensureClosed('virtualdj')` devuelve false sin diálogo; Copias necesita pedir que se cierre.
- [ ] **Step 3:** Un commit por capacidad.

**Cierre del bloque 4:** matriz; con VirtualDJ real por el controlador: crear, renombrar y borrar una lista y una carpeta desde Surco; pegar un tracklist en una lista; convertir Pray.flac de la pestaña VirtualDJ a MP3; abrir VirtualDJ y comprobar en pantalla y en ficheros la lista, la pista repuntada y sus cues; cerrar.

## Bloque 5. USB

### Task 17: USB de Pioneer desde VirtualDJ

**Files:**
- Create: `main/usbExportVirtualdj.ts` (`readVirtualdjExportSelection`, marcas: cues, loops, rejilla de `Scan`, etiquetas), test.
- Modify: `shared/djProgram.ts` (`PROGRAM_CAN.virtualdj.usb = true`), `main/usbExportIpc.ts`/`usbExportRoute.ts` y la vista del modal que pida el compilador.

- [ ] **Step 1:** Tests rojos siguiendo `usbExportSerato.ts`: una lista de VirtualDJ con cues, loop y rejilla sale en el XML de baken con esos datos.
- [ ] **Step 2:** Implementar. Commit `Export VirtualDJ lists to a Pioneer USB`.

**Cierre del bloque 5:** matriz; exportar `Surco prueba` a una carpeta temporal como USB y abrir el resultado con el lector de USB de Surco (como la fase d de Serato).

## Bloque 6. Batería de integración de los cinco programas

### Task 18: Batería

**Files:**
- Create: `src/integration/djPrograms.test.ts` (o el sitio que mejor encaje con `src/scenarios/`), `src/integration/libraries/<programa>.ts` (una biblioteca de pruebas por programa, construida en un temporal), audios de pocos segundos generados con ffmpeg.
- Modify: lo que la batería encuentre roto en cualquier programa, con su test rojo y su commit.

**Interfaces:**
- Produces: `const TEST_LIBRARIES: Record<DjProgram, TestLibrary>` (el compilador la exige para un programa nuevo) y el guion común de la spec (leer; editar playlists donde `edit`; guardar un cue y leerlo en cada formato; convertir y comprobar repunte y cues; etiquetas y añadir donde `reach`; USB donde `usb`), con cada paso decidido por las tablas de capacidades.

- [ ] **Step 1:** Escribir la batería con el guion completo para los cinco. Correr. Apuntar cada fallo.
- [ ] **Step 2:** Por cada fallo en un programa: test rojo propio que lo aísla, arreglo, commit. La matriz solo puede cambiar de fallo a acierto.
- [ ] **Step 3:** Commit `Run one integration script over every DJ program`.

## Bloque 7. Cierre

### Task 18b: La web y la tabla de programas

Pedido por el usuario el 11/11. Va después de la Tarea 18, antes de la 19, para describir lo que de verdad funciona.

**Files:**
- Modify: `apps/web/src/i18n/locales/*.json` (6 idiomas), `apps/web/src/App.tsx` (lista de marcas), la página de funciones, `docs/funcionalidades.md`.

- [ ] **Step 1:** Recorrer cada texto de la web que nombra los programas de DJ (descripción, meta, funciones, FAQ, guía) y añadir VirtualDJ donde ya funciona. No afirmar nada que no haya pasado la prueba real.
- [ ] **Step 2:** Tabla nueva en la página de funciones: una fila por función (pestaña y playlists, editar playlists, pegar tracklist, sesión automática, editor de cues, flujos y gemelas, rejilla, añadir convertidas, sincronizar etiquetas, sustituir, USB, copias, Windows) y una columna por programa (rekordbox, Traktor, Engine DJ, Serato, VirtualDJ), con las salvedades reales (p. ej. Engine DJ sin CALL). Antes de escribirla, el controlador enseña al usuario un boceto dibujado (artifact) y espera su visto bueno.
- [ ] **Step 3:** Test de la web que fije las celdas de la tabla contra una tabla de datos única, y build/prerender en verde en los 6 idiomas; captura con Brave contra vite preview.
- [ ] **Step 4:** `docs/funcionalidades.md` con VirtualDJ y la fecha de revisión.
- [ ] **Step 5:** Commits `Mention VirtualDJ across the website` y `Show which features each DJ program supports on the features page`.

### Task 19: Prueba final, skill y merge

- [ ] **Step 1:** Suite, tipos, Biome, matriz y batería en verde.
- [ ] **Step 2:** Prueba a mano completa por el controlador con VirtualDJ real y los otros cuatro programas (cerrados), con copia antes de cada escritura.
- [ ] **Step 3:** Revisión final de toda la rama (subagente con el modelo más capaz) y una tanda de arreglos.
- [ ] **Step 4:** Skill `.claude/skills/nuevo-programa-dj/SKILL.md` en el repo: qué medir antes (dónde guarda biblioteca, cues, listas, cuándo escribe, finales de línea, reloj comparando su propio análisis entre formatos, disco externo, proceso), el orden de bloques, las tablas que el compilador exige y la lista de lo que no exige (actualizada con lo aprendido en VirtualDJ), cómo probar (suite, matriz, batería, driver, programa real con copia). Commit `Teach how to add a DJ program to Surco`.
- [ ] **Step 5:** Traer main a la rama, suite y tipos, y merge a main local sin push.
