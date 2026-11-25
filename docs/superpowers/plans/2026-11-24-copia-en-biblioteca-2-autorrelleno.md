# Copia en tu biblioteca, entrega 2: rellenar el formulario con la copia. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando un programa DJ tiene una copia de la misma grabación, los campos vacíos del formulario (y la carátula, si la pista no tiene y no se quitó a mano) se rellenan con esa copia, una vez por pista, con ⌘Z, como ya pasa con la copia que sustituye en Apple Music.

**Architecture:** El hook `useReplacedCopyFill` ya hace todo el relleno (solo lo vacío, carátula, `copyFilled`, `metaCleared`, paso de deshacer, cancelación). No cambia. Lo nuevo es elegir de qué copia lee: una función pura `fillCopyPath` en `lib/libraryCopy.ts` decide entre la copia de Apple Music que sustituye y las copias DJ con su veredicto, y `Editor.tsx` le pasa su resultado al hook en vez de `replacedCopyPath`.

**Tech Stack:** Electron, React 19, TS, TanStack Query, Vitest y Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-copia-en-biblioteca-design.md`, sección «### 2. Rellenar el formulario con la copia» y la decisión «Qué cuenta como copia».

## Global Constraints

- Se trabaja en el worktree `/Users/vicent/code/surco-copia-en-biblioteca`, rama `copia-en-biblioteca`, después de la entrega 1. Para los tests, `ln -sf /Users/vicent/code/surco/apps/desktop/node_modules apps/desktop/node_modules`; ese enlace no se commitea. Vitest se lanza desde `apps/desktop` con `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>`, nunca desde la raíz del repo.
- Tipos con los tres proyectos, desde `apps/desktop`: `npx tsc --noEmit -p tsconfig.web.json`, `-p tsconfig.node.json` y `-p tsconfig.scenarios.json`. Al final, `npm run lint -w apps/desktop` sobre todo.
- La entrega 1 deja `apps/desktop/src/renderer/src/lib/libraryCopy.ts` con `countsAsCopy(verdict: LibraryVerdict | null | undefined): boolean`. Si no existe, se para y se avisa; no se crea aquí otra versión.
- Qué cuenta como copia (spec): `same`, `even`, `tie`, `here`, `library`, `unmeasurable` y `measuring`. No cuentan `different`, `unreadable`, `missing`, `thisFile` ni `null`.
- **El relleno nunca lee una copia en `measuring`.** Para playlists «Comparing» ya es copia, pero el relleno espera a que el veredicto diga que no es `different`, porque las etiquetas de otra versión no son las de este archivo.
- Prioridad (spec): manda la copia que ya usa la sustitución de Apple Music; si no hay, la primera copia DJ en el orden de la sección (`DJ_PROGRAMS`, el orden de `programCopies`).
- Reglas del relleno que no se tocan: solo campos vacíos (`fillFromCopy`, título, artista y `encodedBy` nunca), carátula solo si `!coverUrl && !coverRemoved`, una vez por pista (`copyFilled`), nunca tras Clear all (`metaCleared`), ⌘Z lo deshace (`onRecordUndo` antes del cambio). Sin marca ni texto en la UI. Las playlists no se rellenan.
- TDD siempre: hay que ver el test en rojo antes de implementar. Un test que pasa a la primera solo vale tras verlo caer con una mutación.
- Los tests seleccionan por `data-testid` y nunca por clases CSS.
- Los comentarios del código solo explican el porqué (CLAUDE.md del repo).
- Mensajes de commit en inglés, una sola línea descriptiva, sin prefijo.
- No se sube ningún namespace de caché.
- En la prueba a mano no se toca la biblioteca real de rekordbox: solo una copia de `master.db` fuera de su carpeta, y solo con pistas propias.

## Decisiones de este plan

- **Con la sección oculta no hay relleno DJ.** `programCopies` solo se calcula con `libraryShown` (Files abierto, una pista, sección «In your library» visible), porque sin la sección no se mide y sin veredicto no se sabe si es la misma grabación. El relleno de Apple Music sigue como hoy.
- **Esperar a Apple Music.** Mientras la ubicación de la copia de Music que sustituye se está buscando (`replaceTargetPending`), no se lee ninguna copia DJ. Si el relleno DJ ya se hizo antes de que llegue la instantánea de Music, se queda (una vez por pista). No se espera a que cargue el índice de Music, porque si no llega nunca el relleno DJ no saldría jamás.
- **La primera copia que cuenta manda aunque esté comparando.** Si rekordbox está en `measuring` y Traktor ya es `same`, se espera a rekordbox. Así el resultado no depende de qué comparación acaba antes. Si rekordbox acaba en `different`, se pasa a Traktor.
- **Veredicto tardío.** Se mantiene la regla de hoy (test «fills on top of what the DJ typed»): lo escrito se respeta y solo se rellena lo vacío en el momento en que llega el veredicto. Un campo que el DJ vació a mano antes se rellena, y ⌘Z lo devuelve. Vicent puede corregir esto.
- **El nombre `useReplacedCopyFill` se queda.** Renombrarlo sería un refactor aparte; su comentario en `Editor.tsx` sí se actualiza porque deja de ser cierto.

## Review Focus

- Veredicto que llega tarde, con el DJ ya escribiendo en un campo: lo escrito se queda, se rellenan solo los vacíos y un ⌘Z quita solo el relleno. Test en la Task 2.
- Cambio de pista con la lectura de la copia en vuelo: nada de la copia vieja cae en la pista nueva. Test en la Task 2.
- Copia `different` («Another version»): no se lee ni rellena nada; si un programa posterior tiene la misma grabación, rellena ese. Tests en las Tasks 1 y 3.
- La primera copia todavía comparando y otra ya `same`: se espera, y no se lee ninguna. Tests en las Tasks 1 y 3.
- Copia de Music aún buscándose y copia DJ lista: se espera a Music, que manda. Tests en las Tasks 1 y 3.

---

### Task 1: Elegir la copia que rellena

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/libraryCopy.ts` (de la entrega 1)
- Test: `apps/desktop/src/renderer/src/lib/libraryCopy.test.ts` (crearlo si la entrega 1 no lo dejó)

**Interfaces:**
- Consumes: `countsAsCopy` y `LibraryVerdict` (de `components/LibrarySection`).
- Produces:
  ```ts
  export interface FillCandidate { path: string; verdict: LibraryVerdict | null }
  export function fillCopyPath(args: {
    musicCopyPath: string
    musicCopyPending: boolean
    programs: readonly FillCandidate[]
  }): string
  ```
  Devuelve la ruta a leer, o `''` para no leer todavía (o nunca).

Algoritmo: `musicCopyPath` no vacío gana. Si no, `musicCopyPending` da `''`. Si no, la primera entrada de `programs` con `countsAsCopy(verdict)`: si es `measuring` da `''`, si no su `path`. Sin ninguna, `''`.

- [ ] **Step 1: Escribir los tests que fallan** en `describe('fillCopyPath')`, con rutas `/m/old.mp3`, `/r/a.aiff`, `/t/a.wav`:
  - `it('takes the Apple Music copy a replacement supersedes before any DJ copy')`: Music `/m/old.mp3` y rekordbox `same` da `/m/old.mp3`.
  - `it('waits while the Apple Music copy is still being located, since it has the say')`: `musicCopyPending: true`, Music `''`, rekordbox `same` da `''`.
  - `it('takes the first DJ copy of the same recording')`: rekordbox `here` y Traktor `same` da `/r/a.aiff`.
  - `it('skips copies whose tags belong to another file')`: rekordbox `different`, Traktor `same` da `/t/a.wav`; lo mismo con `unreadable`, `missing`, `thisFile` y `null` en rekordbox (`it.each`).
  - `it('never reads a copy still being compared, it may be another version')`: rekordbox `measuring` solo da `''`.
  - `it('waits for the first copy instead of the one that finished comparing first')`: rekordbox `measuring` y Traktor `same` da `''`.
  - `it('fills from a copy that could not be measured, the spec counts it as a copy')`: rekordbox `unmeasurable` da `/r/a.aiff`.
- [ ] **Step 2:** desde `apps/desktop`, `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/libraryCopy.test.ts`. Falla porque `fillCopyPath` no existe.
- [ ] **Step 3: Implementar** `fillCopyPath` en `lib/libraryCopy.ts`, con un comentario que diga por qué `measuring` espera y por qué la primera copia manda.
- [ ] **Step 4:** el mismo comando pasa, también los tests de `countsAsCopy` de la entrega 1.
- [ ] **Step 5:** commit `Pick the library copy that fills the form, Apple Music first and then the first DJ copy of the same recording`.

### Task 2: Fijar las guardas del hook de relleno

`useReplacedCopyFill` ya debería cumplir esto; los tests lo fijan para la copia DJ, cuyo veredicto llega segundos después.

**Files:**
- Test: `apps/desktop/src/renderer/src/hooks/useReplacedCopyFill.test.tsx`
- Modify: `apps/desktop/src/renderer/src/hooks/useReplacedCopyFill.ts` solo si algún test sale rojo sin mutación.

**Interfaces:**
- Consumes: `useReplacedCopyFill({ item, copyPath, onChange, onRecordUndo })` tal cual.

- [ ] **Step 1: Escribir los tests**, con los ayudantes `track`, `copyTags` y `setApi` del fichero:
  - `it('fills only the fields still empty when the copy arrives after the DJ typed')`: se monta con `copyPath: ''`; `rerender` con `meta.album: 'Typed'`; `rerender` con `copyPath: '/r/your-love.aiff'`; la copia trae `album: 'Your Love'` y `genre: 'Euro House'`. El parche lleva `album: 'Typed'`, `genre: 'Euro House'`, y `onRecordUndo` se llamó antes que `onChange`.
  - `it('drops a copy read that answers after the DJ moved to another track')`: `readTags` con promesa pendiente; `rerender` con `track({ id: 't2' })`; se resuelve la primera respuesta. `onChange` no recibe nunca `album: 'Your Love'` de esa respuesta.
  - `it('drops the old answer when the copy to fill from changes mid-read')`: `readTags` con dos promesas, una por ruta; montaje con `/r/your-love.aiff`, `rerender` con `/m/old.mp3`; se resuelve primero la de `/r`. El único parche que llega trae lo de `/m/old.mp3`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useReplacedCopyFill.test.tsx`. Si pasan a la primera, ver el rojo con mutación: quitar `if (!cancelled)` hace caer los dos de «drops»; quitar `copyPath` de las dependencias del efecto hace caer el primero. Deshacer las mutaciones. Si alguno sale rojo sin mutación, es un fallo real: arreglarlo en el hook y decirlo en el informe.
- [ ] **Step 3:** el mismo comando pasa entero.
- [ ] **Step 4:** commit `Pin that a library copy fill keeps typed text and drops answers meant for another track or copy`.

### Task 3: El editor rellena con la copia DJ

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx:913-919`. `replacedCopyPath` se queda como entrada; el hook recibe `fillCopyPath(...)`. `programVerdicts` y `rowVerdict` ya están más arriba (~897, import en ~99). El comentario de ~913 pasa a decir por qué solo una copia de la misma grabación presta sus campos y por qué Music manda.
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx`, dentro de `describe('rows for the DJ programs that hold the track')` (~6629).

**Interfaces:**
- Consumes: `fillCopyPath` y `FillCandidate` de la Task 1. Las entradas salen de `comparedProgramCopies` y `programVerdicts` (mismo índice): `{ path: copy.path, verdict: state ? rowVerdict(state) : null }`. `musicCopyPath: replacedCopyPath`, `musicCopyPending: replaceTargetPending`.

Ayudante: `renderWithPrograms` gana opciones sin cambiar lo que devuelve, así los tests que ya hay no se tocan.
- `Copy.durationSec?: number` y `here` con `hereDuration?: number`; `api.readDuration` responde por ruta. 95 s aquí y 30 s en la copia da `different` (como el test «says another version from the lengths alone», ~6416).
- `tags?: Record<string, Partial<TrackMetadata>>` por ruta para `api.readTags`; una ruta sin entrada rechaza.
- `pairPending?: boolean`: `comparePair` devuelve una promesa que no se resuelve, así la fila se queda en `measuring`.
- `music?: string`: plataforma `darwin`, `addToAppleMusic: true`, un índice con `persistentId` para Strobe y `appleMusicEntryLocation` que resuelve a esa ruta.
- El resultado de `renderEditor` se guarda en un `let rendered` del `describe`, para leer `onChange` y `onRecordUndo`.

- [ ] **Step 1: Escribir los tests que fallan** (rekordbox en `/r/Strobe.wav`, Traktor en `/t/Strobe.wav`, etiquetas de copia `album: 'Strobe EP'`, `genre: 'Progressive House'`):
  - `it('fills the empty fields from the rekordbox copy once it proves to be the same recording')`: se espera a que `library-row-state` no tenga `data-state="measuring"`. `readTags` se llamó con `/r/Strobe.wav`; el parche con `copyFilled: true` lleva esos dos campos; `onRecordUndo` recibió `(['a'], { cover: false })`.
  - `it('never fills from a DJ copy that is another version, its tags are another edit')`: rekordbox con 30 s y aquí 95 s. Tras ver `data-state="different"`, `readTags` no se llamó con `/r/Strobe.wav` y ningún parche lleva `copyFilled`.
  - `it('waits for the comparison before reading a DJ copy')`: `pairPending: true`. Con la fila en `measuring` y tras 50 ms, `readTags` no se llamó con `/r/Strobe.wav`.
  - `it('fills from the next program when the first holds another version')`: rekordbox `different` por longitud, Traktor igual; `readTags` se llamó con `/t/Strobe.wav` y nunca con `/r/Strobe.wav`.
  - `it('lets the Apple Music copy a replacement supersedes fill before a DJ copy')`: `music: '/m/old/Strobe.mp3'` con `album: 'From Music'`, rekordbox igual con `album: 'From rekordbox'`. El parche lleva `album: 'From Music'` y `readTags` nunca se llamó con `/r/Strobe.wav`.
  - `it('does not fill from a DJ copy when the track was already filled once')`: pista con `copyFilled: true`; `readTags` no se llamó con `/r/Strobe.wav`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/Editor.test.tsx`. Los nuevos fallan, salvo «different», «waits» y «already filled», que pasan porque hoy no se rellena nunca con DJ; esos se verán caer en la Task 4.
- [ ] **Step 3: Implementar** el paso de `fillCopyPath` en `Editor.tsx`.
- [ ] **Step 4:** el mismo comando pasa entero, y también `src/renderer/src/hooks/useReplacedCopyFill.test.tsx` y `src/renderer/src/lib/libraryCopy.test.ts`. Los tres `tsc` dan 0.
- [ ] **Step 5:** commit `Fill empty fields from a DJ program copy of the same recording`.

### Task 4: Probar con mutación

- [ ] **Step 1:** una a una, y deshaciendo cada una:
  - En `fillCopyPath`, tratar `measuring` como lista: caen «never reads a copy still being compared», «waits for the first copy…» y el de Editor «waits for the comparison…».
  - Quitar el `countsAsCopy` (tomar la primera copia sea cual sea): caen «skips copies…» y los de Editor «never fills… another version» y «fills from the next program…».
  - Poner las copias DJ antes que Music: caen «takes the Apple Music copy…» y el de Editor «lets the Apple Music copy…».
  - Ignorar `musicCopyPending`: cae «waits while the Apple Music copy is still being located».
  - En `Editor.tsx`, pasar `copyFilled: false` al hook (`{ ...item, copyFilled: false }`): cae «does not fill from a DJ copy when the track was already filled once».
- [ ] **Step 2:** si alguna mutación no tumba ningún test, el test es falso: arreglarlo y volver a mutar. Sin commit si no cambia nada; en el informe, qué tests cayó cada mutación.

### Task 5: Pasos de la CI

- [ ] **Step 1:** desde `apps/desktop`, la suite entera `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run` con código de salida 0 (un «Unhandled Errors» la deja en 1 aunque todo pase). Un test que solo pasa suelto está roto y se arregla.
- [ ] **Step 2:** `npm run lint -w apps/desktop` limpio y los tres `tsc` con 0 errores.
- [ ] **Step 3:** si algo se arregló, commit con una línea que diga qué.

### Task 6: Prueba en la app con rekordbox sobre una copia de master.db (controlador)

- [ ] **Preparar.** Copiar `~/Library/Pioneer/rekordbox/master.db` (y su `-wal` y `-shm` si existen) a `~/surco-pruebas/rekordbox/` y anotar el `shasum` del original. No mover ni abrir la carpeta de rekordbox de otra forma. Compilar el worktree y arrancar la app empaquetada con `quietLaunch` (skill `run`, sin activar la ventana) en un perfil temporal (`--user-data-dir`). En Ajustes, poner la ruta de rekordbox (`rekordboxDbPath`) en la copia y comprobar que la muestra antes de abrir nada. Solo pistas propias de Vicent.
- [ ] **Pista de prueba.** Elegir una pista de la copia con álbum, género, comentario y carátula. Hacer un FLAC de ella en una carpeta de pruebas, con título y artista iguales y álbum, género y carátula vacíos.
- [ ] Abrirla en Files. Mientras la fila rekordbox dice «Comparing», el formulario no cambia. Al salir el veredicto, se rellenan álbum, género y comentario y sale la carátula; título y artista siguen siendo los del FLAC; no aparece ninguna marca ni texto.
- [ ] Un ⌘Z deja el formulario y la carátula como antes del relleno.
- [ ] Ir a otra pista y volver: no se rellena otra vez. Clear all, ir a otra pista y volver: sigue vacío.
- [ ] Con otra copia del FLAC sin analizar, escribir en Álbum mientras la fila dice «Comparing». Al llegar el veredicto, el álbum escrito se queda y el resto se rellena.
- [ ] Con otra copia sin analizar, cambiar de pista mientras compara y esperar: la otra pista no recibe nada de esta copia.
- [ ] Un FLAC con carátula propia: la carátula se queda. Otro en el que se quita la carátula a mano antes del veredicto: sigue sin carátula.
- [ ] Una edición distinta del mismo título (otra longitud) que rekordbox tiene: la fila dice «Another version» y no se rellena nada.
- [ ] Una pista que está en Apple Music como copia que sustituye y también en rekordbox, con álbumes distintos: rellena el de Music.
- [ ] Con «In your library» oculta en Ajustes › Secciones del editor: no hay relleno desde rekordbox.
- [ ] Repetir el primer caso con Traktor o Engine DJ, que están libres para pruebas.
- [ ] Al acabar, el `shasum` del `master.db` original es el mismo. En el informe, lo probado y lo que no se pudo probar.
