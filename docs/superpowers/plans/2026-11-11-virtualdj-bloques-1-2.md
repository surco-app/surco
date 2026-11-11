# VirtualDJ, bloques 1 y 2 (medidas, lista genérica y lectura) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir lo que falta de VirtualDJ, convertir en tablas que el compilador exija los sitios genéricos de la lista de la prueba de fuego, y dejar VirtualDJ como quinto programa con pestaña, árbol, colección y cues visibles en el editor.

**Architecture:** VirtualDJ entra por la puerta común del refactor (`window.api.dj.*`, `window.api.cues.*`, tablas por programa). Dos lectores puros en `main/` (`database.xml` y `MyLists`), una sección `read` y una fuente de cues de solo lectura, y las filas que pida el compilador. Antes, los sitios de la prueba de fuego que no dependen de VirtualDJ pasan a tablas, sin cambiar el comportamiento de los otros cuatro.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-11-virtualdj-design.md`. Contexto: `docs/superpowers/specs/2026-11-10-programas-dj-interfaz-design.md` y la sección "Resultado de la prueba de fuego" de `docs/superpowers/plans/2026-11-10-programas-dj-interfaz.md`.

Los bloques 3 a 7 (escritura de cues, listas y biblioteca, USB, batería de integración, prueba final) tienen su propio plan, escrito con las medidas de la Tarea 1 hechas.

## Global Constraints

- Worktree `/Users/vicent/code/surco/.claude/worktrees/virtualdj`, rama `virtualdj`. Código en `apps/desktop/src`. Comandos desde `apps/desktop`.
  - Suite: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src` en primer plano (timeout 600000 ms), salida 0, sin `Errors`/`Unhandled`. Bajo carga, los ficheros que fallen por tiempo se repiten solos.
  - Tipos: `for p in web node scenarios; do /Users/vicent/code/surco/node_modules/.bin/tsc -p tsconfig.$p.json --noEmit || echo FALLO $p; done`.
  - Biome: `/Users/vicent/code/surco/node_modules/.bin/biome check <ficheros tocados>`, sin errores nuevos (main trae errores previos).
  - Matriz: `SURCO_MATRIX=1 node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/scenarios/matrix/full.test.tsx --reporter=verbose`, comparada celda a celda con la base de la Tarea 0.
- Nada se mergea a main hasta el final del bloque 7. Se trae main a la rama cuando haga falta.
- TDD rojo-verde y mutación a mano en cada pieza nueva. Cero comentarios. Sin `--no-verify`. Commits en inglés, una línea, sin prefijo ni cuerpo. Sin `git checkout`/`git stash` con trabajo sin commitear.
- Textos de UI en los 6 idiomas (es, en, de, fr, pt-BR, ja), sin guion largo ni dos puntos de explicación. Mocks con `vi.fn<Api['dj']['tree']>()` y similares. Selectores `data-testid`.
- Las tareas de los otros cuatro programas (Tareas 2 a 6) son refactor puro: los tests existentes solo cambian cómo llaman, nunca lo que afirman.
- Nunca escribir en la biblioteca real de VirtualDJ (`~/Library/Application Support/VirtualDJ`) desde código ni tests. Las medidas que la tocan se hacen con copia previa y VirtualDJ cerrado.
- Fixtures del repo (público) sin rutas personales: las rutas medidas se reescriben a `/Music/VirtualDJ Pruebas/...`.
- Valores fijados por la spec: id `virtualdj:` + ruta del `<Song>`; proceso `VirtualDJ` (`pgrep -x VirtualDJ`); BPM de `Tags`/`Scan` en segundos por pulso; posiciones de `Poi` en segundos; `Color` entero ARGB; `Poi` `automix` y `remix` ignorados; VirtualDJ oculto en Windows; ajustes nuevos con los mismos valores por defecto que Serato; ruta por defecto de la biblioteca `~/Library/Application Support/VirtualDJ/database.xml`.

## Rulings

- **Ruling:** VirtualDJ entra en `DjProgram` en la Tarea 9 y queda fuera de `WritableProgram` y de `UsbProgram` hasta los bloques 3 a 5, pero esos tipos ya salen de tablas de capacidades (Tarea 2), así que dejarlo fuera es una fila `false` y no un `Exclude` con su nombre.
- **Ruling:** la fuente de cues de VirtualDJ en este plan es de solo lectura; `cues:save` para un id `virtualdj:` rechaza con un error claro (Tarea 6) y el editor lo dice (fila de `CUE_PROGRAMS`), igual que Serato en su fase (a).
- **Ruling:** la rejilla se toma de `Scan` con la interpretación de `Phase` que confirme la Tarea 1. Si la Tarea 1 no la confirma, la Tarea 10 no se cierra: vuelve al controlador.

## Review Focus

- **Un `database.xml` con un `<Song>` raro** (sin `Tags`, sin `Scan`, `Poi` sin `Pos`, atributos desconocidos, entidades XML como `&amp;` en la ruta) no tumba la pestaña: esa pista sale sin el dato y las demás salen. Test en la Tarea 7.
- **Una ruta con caracteres no ASCII o con `&`** (habitual en nombres de pistas) se lee y se compara igual que en disco (forma Unicode NFC/NFD, como hizo Serato). Test en las Tareas 7 y 9.
- **`MyLists` con una lista en `order` que no existe en disco, o un `.vdjfolder` que no está en `order`**: se muestra lo que hay, en el orden de `order` y lo demás al final. Test en la Tarea 8.
- **La pestaña de VirtualDJ con VirtualDJ abierto** muestra el aviso de que los cambios pueden no estar al día (fila `runningNote`). Test en la Tarea 10.
- **Los otros cuatro programas, después de las tablas de la Tarea 2 a 6**, se comportan igual: matriz celda a celda y prueba a mano en el cierre del bloque 1.

---

## Bloque 1. Medidas y lista genérica

### Task 0: Base

- [ ] **Step 1:** Suite, tipos, Biome (lista de ficheros con errores previos) y matriz celda a celda en `.superpowers/sdd/<plan>/matriz-base.txt`. Apuntar el resumen al final de este plan ("Base medida").
- [ ] **Step 2:** Commit `Record the baseline for VirtualDJ`.

### Task 1: Medir VirtualDJ (controlador con el usuario)

La hace el controlador, no un implementador. Cada medida: copia de `~/Library/Application Support/VirtualDJ` (sin `PluginsMacArm`) antes, VirtualDJ cerrado al leer, resultado en `docs/virtualdj-medidas.md`.

**Files:**
- Create: `docs/virtualdj-medidas.md`
- Create: `apps/desktop/src/main/virtualdjFixtures/` con un `database.xml` y un `MyLists/` reales, rutas reescritas.

- [ ] **Step 1: Loops y color.** El usuario guarda un loop en un pad y pone nombre y color a un cue en `~/Music/VirtualDJ Pruebas/Pray.mp3`, y cierra. Apuntar el `Poi` de cada uno y el color que muestra la pantalla.
- [ ] **Step 2: VirtualDJ respeta lo escrito por fuera.** Con VirtualDJ cerrado, añadir a mano a la copia viva de `database.xml` un `Poi Type="cue" Num="3" Pos="60.0" Name="Surco medida"` en Pray.flac y una lista `MyLists/Surco escrita.vdjfolder` con una pista; el usuario abre VirtualDJ, confirma que ve ambos, y cierra; comprobar que siguen en disco. Restaurar la copia después.
- [ ] **Step 3: Reloj.** Generar con Surco un cue a 30,000 s en Pray en WAV, AIFF, M4A AAC, M4A ALAC, MP3 a 48 kHz y MP3 sin cabecera LAME (con `ffmpeg` del repo, en `~/Music/VirtualDJ Pruebas`); el usuario los carga en VirtualDJ (lee los cues de las etiquetas en ficheros nuevos); leer cada `Pos` en `database.xml`. Tabla de desfase por fichero.
- [ ] **Step 4: Rejilla.** Confirmar con el usuario, en la pantalla de VirtualDJ, si la primera negra de Pray está a `Phase − n·Bpm` (0,244 s en Pray) y si los compases cuadran; apuntar la regla.
- [ ] **Step 5: Disco externo.** El usuario añade una pista de `/Volumes/Public` y cierra; buscar `/Volumes/Public/VirtualDJ/database.xml` y las rutas que usa.
- [ ] **Step 6: Pista desaparecida.** Renombrar una copia de Pray que VirtualDJ conoce; el usuario abre y cierra; apuntar qué hace con su `<Song>`.
- [ ] **Step 7:** Copiar a `virtualdjFixtures/` el `database.xml` y `MyLists/` finales con rutas reescritas. Commit `Measure VirtualDJ's library, cues, lists, clock and grid`.

### Task 2: `WritableProgram` y `UsbProgram` desde tablas de capacidades

**Files:**
- Modify: `shared/djProgram.ts` (`WritableProgram = Exclude<DjProgram, 'serato'>`, línea 7), `shared/types.ts` (`UsbProgram = DjProgram`, ~1781), y lo que pida el compilador.
- Test: `shared/djProgram.test.ts`

**Interfaces:**
- Produces: `const PROGRAM_CAN: { [P in DjProgram]: { write: boolean; usb: boolean } }` en `shared/djProgram.ts`; `WritableProgram` y `UsbProgram` derivados de él (tipos que extraen las claves con `write: true` / `usb: true`, con `as const satisfies`). Hoy: rekordbox, traktor, engine `write: true`; serato `write: false`; `usb: true` en los cuatro (como hoy).

- [ ] **Step 1:** Test rojo: `WRITABLE_PROGRAMS` y la lista de USB salen de `PROGRAM_CAN`; un test de tipos (`expectTypeOf`) fija que `WritableProgram` es exactamente `'rekordbox' | 'traktor' | 'engine'` y `UsbProgram` los cuatro.
- [ ] **Step 2:** Implementar. Tipos y suite verdes sin cambiar afirmaciones.
- [ ] **Step 3:** Commit `Derive the writable and USB programs from one table of what each program can do`.

### Task 3: Ficheros que usa cada biblioteca, por tabla

**Files:**
- Modify: `main/libraryFileUse.ts` (`SyncedLibraries` ~18, las intersecciones `& { serato?: SeratoLibraryRoot[] }` ~26, 36, 362), `main/libraryFlushes.ts` (`seratoRoots` en ~114, 141, 164, 186, 765, 837), `main/index.ts` (`seratoRoots` ~357, 418, 427).
- Test: `main/libraryFileUse.test.ts`, `main/libraryFlushes.test.ts`

**Interfaces:**
- Produces: una tabla por `LibraryProgram` de "cómo sé qué ficheros usa este programa" (`Record<LibraryProgram, FileUseOf>`), donde la fila de serato es la lectura de raíces de hoy. Un programa nuevo no compila sin su fila. Las firmas que hoy reciben `seratoRoots` reciben la tabla.

- [ ] **Step 1:** Test de caracterización verde: un fichero que solo Serato usa cuenta como usado (protegido de reemplazo y papelera) por las tres rutas de hoy; si `_Serato_` no se puede leer, cuenta como usado.
- [ ] **Step 2:** Mover a la tabla. Mutación: quitar la fila de serato y ver caer el test.
- [ ] **Step 3:** Commit `Ask every DJ program which files it uses through one table`.

### Task 4: Disponibilidad de cada programa, por tabla

**Files:**
- Modify: `renderer/src/hooks/useSourceBrowser.ts` (las `useQuery` de engine, traktor, serato ~124-140), `renderer/src/components/settings/CuesTab.tsx` (`foundBy` ~87), `renderer/src/App.tsx` (`playlistLibrariesFound` ~458), `renderer/src/hooks/useRekordboxPlaylists.ts` (`useLibraryAvailable`).

**Interfaces:**
- Produces: un hook `useProgramsAvailable(): Record<DjProgram, boolean | undefined>` (en `renderer/src/hooks/`) que hace una consulta por programa con `window.api.dj.available(p)` recorriendo `DJ_PROGRAMS`, con la misma clave de consulta que hoy por programa. Los tres sitios lo usan.

- [ ] **Step 1:** Tests de caracterización verdes de los tres sitios: qué pestañas aparecen, qué destinos de cues salen como encontrados, qué programas ofrecen el campo de playlists, con cada programa disponible o no.
- [ ] **Step 2:** Implementar y mover. Mutación: hacer que el hook ignore un programa y ver caer un test.
- [ ] **Step 3:** Commit `Ask whether each DJ program is there through one hook`.

### Task 5: Gemelas, duplicados, revisión de listas, copias y avisos sin listas a mano

**Files:**
- Modify: `main/cuesIpc.ts` / `main/index.ts` (`libraryTracksOf`), `main/libraryFlushes.ts` (`duplicateLibraryDeps`), `main/listReviewWiring.ts` (`listReviewDeps`), `renderer/src/hooks/useCopies.ts` (~15-17), `renderer/src/lib/revealCue.ts` (`PICKED` ~47).

- [ ] **Step 1:** Por sitio, test de caracterización verde si no lo hay; pasar la lista o el argumento de Serato a una tabla por programa (o a `WRITABLE_PROGRAMS`/`LIBRARY_PROGRAMS` donde corresponda); mutación; commit por sitio con título que nombre la capacidad.

### Task 6: Guardar cues de un programa sin fuente de cues rechaza

**Files:**
- Modify: `main/cuesIpc.ts` (`cues:save`), `renderer/src/components/CuesSection.tsx` si el error necesita texto.
- Test: `main/cuesIpc.test.ts`

- [ ] **Step 1:** Test rojo: `cues:save` con una petición cuyo programa tiene fuente `null` rechaza con `<program> has no cue source`; las peticiones de los demás programas en la misma llamada no se escriben (todo o nada, como hoy cuando una falla).
- [ ] **Step 2:** Implementar. Hoy ningún programa tiene fuente `null` en producción, así que la matriz no cambia.
- [ ] **Step 3:** Commit `Refuse to save cues for a program that has no cue source instead of dropping them`.

**Cierre del bloque 1:** matriz igual a la base; prueba a mano con el driver de lo que tocan las Tareas 2 a 6 (pestañas, destinos de cues, campo de playlists, papelera de un fichero que usa Serato con una biblioteca sintética, copias). Sin merge.

## Bloque 2. Lectura

### Task 7: Lector de `database.xml`

**Files:**
- Create: `main/virtualdjDatabase.ts`, `main/virtualdjDatabase.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface VirtualdjPoi { kind: 'cue' | 'loop' | 'other'; num: number | null; seconds: number; name?: string; color?: number; sizeSeconds?: number }
  export interface VirtualdjSong {
    path: string; size: number | null
    title: string; artist: string; album: string; genre: string; year: string; key: string
    lengthSeconds: number | null; secondsPerBeat: number | null; phaseSeconds: number | null
    pois: VirtualdjPoi[]
  }
  export function parseVirtualdjDatabase(xml: string): VirtualdjSong[]
  ```
  `loop` y `sizeSeconds` según la medida de la Tarea 1. `automix` y `remix` como `other`.

- [ ] **Step 1:** Tests rojos sobre `virtualdjFixtures/database.xml`: las pistas medidas con sus etiquetas, BPM en segundos por pulso, cues con `Num`, nombre y color, el loop medido; y los casos de Review Focus (song sin `Tags`/`Scan`, `Poi` sin `Pos`, entidades XML, ruta no ASCII).
- [ ] **Step 2:** Implementar con el parser XML que ya use el repo (buscar el de `traktorNml`). Mutación: ignorar `Num`.
- [ ] **Step 3:** Commit `Read VirtualDJ's database`.

### Task 8: Lector de `MyLists`

**Files:**
- Create: `main/virtualdjLists.ts`, `main/virtualdjLists.test.ts`

**Interfaces:**
- Produces: `readVirtualdjLists(dir: string): VirtualdjNode[]` con `VirtualdjNode = { id: string; name: string; kind: 'folder' | 'playlist'; paths: string[]; children?: VirtualdjNode[] }`. El `id` es la ruta relativa a `MyLists` sin extensión (`Carpeta/Dentro`). Orden según `order` y lo que falte al final.

- [ ] **Step 1:** Tests rojos sobre `virtualdjFixtures/MyLists`: `Carpeta` (carpeta, con `Dentro` dentro), `Surco prueba` (lista con dos rutas); y los casos de Review Focus (nombre en `order` sin fichero, fichero fuera de `order`).
- [ ] **Step 2:** Implementar. Mutación: ignorar `order`.
- [ ] **Step 3:** Commit `Read VirtualDJ's lists and folders`.

### Task 9: VirtualDJ como quinto programa, en lectura

**Files:**
- Create: `shared/virtualdjContent.ts` (`isVirtualdjContent`, `virtualdjFileOf`), `main/virtualdjLibrary.ts` (lectura con caché por mtime y tamaño; `virtualdjTree`, `virtualdjCollection`, `virtualdjPlaylist`, `virtualdjMembership`, conteos), `main/virtualdjPlaylistsIpc.ts` (`virtualdjRead(host): DjReadMain`).
- Modify: `shared/djProgram.ts` (`DjProgram`, órdenes, `CONTENT_OF`, `PROGRAM_CAN` con `write: false, usb: false`) y cada fila que pida el compilador; `main/index.ts` (fila de `DjMainTable`), `main/djProcesses.ts` (`isRunning` con `pgrep -x VirtualDJ`), settings (ruta de la biblioteca), los 6 `locales/*.json` (las claves de plantilla de la lista de la prueba de fuego), `renderer/src/components/SourceIcons.tsx`, `renderer/src/components/settings/DestinationTab.tsx` (panel propio con la ruta), `renderer/src/components/OnboardingWizard.tsx` (detección).

- [ ] **Step 1:** Tests rojos: `virtualdjRead` sobre los fixtures (árbol, colección, playlist con `allowMedia`, pertenencia, conteos, `available` según exista el fichero); `programOf('virtualdj:/Music/x.mp3') === 'virtualdj'`; la pestaña aparece y lista las pistas (test de renderer con `djReads`); el panel de Ajustes enseña la ruta; oculto en Windows.
- [ ] **Step 2:** Implementar, resolviendo los errores del compilador con filas reales (no stubs) donde VirtualDJ lea, y `false`/`null` donde escriba (bloques 3-5). Apuntar en el informe cada sitio tocado que el compilador no pidió.
- [ ] **Step 3:** Actualizar los tests que afirman la lista de programas y los tres que usan `'virtualdj'` como programa desconocido (cambiar el ejemplo por otro nombre inventado).
- [ ] **Step 4:** Commit `Add VirtualDJ as a read-only DJ program with its own tab`.

### Task 10: Cues de VirtualDJ en el editor (solo lectura)

**Files:**
- Create: `main/virtualdjClock.ts` (desfase por fichero, según la tabla de la Tarea 1), `main/virtualdjCueSource.ts` (`CueReader` completo; `queuedWanted`/`queue`/`applyQuietly` inertes), tests de ambos.
- Modify: `main/index.ts` (fila `virtualdj` de `sources` de `registerCuesIpc`), `renderer/src/lib/cuePrograms.ts` (fila `virtualdj`: solo lectura con su texto, `runningNote` de VirtualDJ), `CuesSection.tsx` (`COPY`).

- [ ] **Step 1:** Tests rojos: los cues de Pray.flac y Pray.mp3 de los fixtures salen en el reloj de Surco (MP3 corregido 26,12 ms o lo que diga la tabla); la rejilla sale de `Scan` con la regla de la Tarea 1; loops como en Serato; `cues:save` de un id `virtualdj:` rechaza (Tarea 6); el editor muestra "solo lectura" y el aviso de VirtualDJ abierto.
- [ ] **Step 2:** Implementar. Mutación: quitar la corrección del MP3.
- [ ] **Step 3:** Commit `Show VirtualDJ's cues, loops and grid in the cue editor`.

**Cierre del bloque 2:** matriz igual a la base; driver con una copia de la biblioteca real de VirtualDJ apuntada desde Ajustes (nunca la real): pestaña, árbol con `Carpeta/Dentro`, playlist, colección, editor de cues de Pray.mp3 y Pray.flac con sus cues en el sitio que muestra VirtualDJ. Sin merge.

## Base medida

(La rellena la Tarea 0.)
