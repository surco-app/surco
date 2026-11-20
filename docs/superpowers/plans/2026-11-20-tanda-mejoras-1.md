# Tanda de mejoras 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar once huecos pequeños de Surco, uno por commit, sin pantallas nuevas.

**Architecture:** Cada tarea reutiliza una pieza que ya existe (un campo que ya se lee, un comando vecino, un filtro vecino) y la extiende. Ninguna tarea depende de otra. Todas viven en `apps/desktop/src`.

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, Biome, i18next con ocho idiomas (`ca de en es fr it ja pt-BR`).

**Spec:** `docs/superpowers/specs/2026-11-20-tanda-mejoras-1-design.md`

## Global Constraints

- Rama `tanda-mejoras-1`, worktree `.claude/worktrees/tanda-mejoras-1`. No se mergea ni se hace push.
- Un commit por tarea. Título descriptivo en inglés, sin cuerpo, sin prefijos `feat:` ni `fix:`. Nunca `--no-verify`.
- TDD. El test nuevo se ve fallar antes de implementar. Después de pasar, se rompe la implementación a propósito para ver que el test cae, y se restaura.
- Cero comentarios nuevos en el código. Selectores de test por `data-testid`.
- Cambios quirúrgicos. No se mejora código vecino.
- Vitest se lanza siempre desde `apps/desktop` sin filtrar por ruta desde la raíz del repo: `cd apps/desktop && npx vitest run <fichero relativo a apps/desktop>`. Al terminar la tarea, la suite entera con `npm test` mirando el código de salida, no solo el recuento.
- Tipos: `npx tsc -p tsconfig.web.json --noEmit`, `npx tsc -p tsconfig.node.json --noEmit` y `npx tsc -p tsconfig.scenarios.json --noEmit`. El `tsc` pelado no comprueba nada.
- Lint: `npm run lint` en `apps/desktop`, sin avisos nuevos. Hay uno previo ajeno en `renderer/src/lib/cueTasteEdits.ts` (import `TrackCues` sin usar) que no se toca.
- Textos de interfaz en los ocho idiomas, con tuteo, sin guion largo y sin dos puntos de explicación. En los ficheros de idioma no se toca el bloque `settings.cueFlows` ni el bloque `pasteTracklist` más allá de la clave que pida la tarea.
- Un control nunca cambia de ancho al cambiar de estado.
- La app no se lanza en estas tareas. La prueba en pantalla la hace el coordinador al final.
- `docs/funcionalidades.md` no se toca en estas tareas.

## Review Focus

1. Sesión reabierta dos veces o con la lista ya poblada: no debe mezclar dos sesiones ni duplicar filas (tarea 2).
2. Relleno de BPM y tonalidad sobre una pista con el campo ya escrito o con medida `null`: no escribe nada (tarea 6).
3. Borrado sin diálogo cuando la copia en Copias falla o no cabe: el fichero sigue en disco y la fila se queda (tarea 10).
4. Fichero mono o con los dos canales en silencio: no debe leerse como «canal sin señal» (tarea 8).
5. Pista sin analizar frente a los filtros y el orden nuevos: fuera de los filtros y al final del orden en ambos sentidos (tarea 7).

---

### Task 1: La sesión automática cuenta altas y escuchas en los cinco programas

**Files:**
- Modify: `renderer/src/lib/sessionCandidates.ts` (`recencyOf`, línea 36)
- Modify: `main/traktorPlaylists.ts` (`metaOf`, hacia la línea 101)
- Test: `renderer/src/lib/sessionCandidates.test.ts`, `main/traktorPlaylists.test.ts`

- [ ] **Step 1: Tests que fallan.** En `sessionCandidates.test.ts`: una entrada sin `meta.dateAdded` y con `meta.addedAt` de hace 5 días sale como nueva; con `addedAt` de hace 90 días no; con los dos campos manda `dateAdded`. En `traktorPlaylists.test.ts`: una entrada cuyo `INFO` lleva `PLAYCOUNT="7"` entrega `meta.playCount === 7`, y sin el atributo no hay `playCount`.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.** `recencyOf` usa `Date.parse(dateAdded)` y, si no es fecha, `meta.addedAt` (milisegundos). `metaOf` lee `PLAYCOUNT` igual que `main/usbExportTraktor.ts:77`.
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Count date added and plays from every DJ program when a session picks new tracks`

### Task 2: Reabrir la última sesión

**Files:**
- Modify: `main/session.ts` (`saveLastSession`, línea 204, y `loadLastSession`), `main/index.ts:1335-1343`, `preload/index.ts`, `preload/api.ts`
- Modify: `renderer/src/hooks/useSessionPersistence.ts`, `renderer/src/lib/commands.ts`, `renderer/src/App.tsx`, `main/appMenu.ts`, `main/i18n.ts`, `shared/shortcutDefaults.ts` solo si el menú lo exige
- Modify: `renderer/src/i18n/locales/*.json` (clave `commands.reopenLastSession`)
- Test: `main/session.test.ts`, `renderer/src/hooks/useSessionPersistence.test.ts` (o el test que ya cubra el hook), `renderer/src/lib/commands.test.ts`

**Interfaces:**
- Produces: `loadPreviousSession(): SessionData | null` en `main/session.ts`, expuesto como `window.api.loadPreviousSession()`. Comando `reopen-last-session`.

Reglas:
- `main` guarda una generación anterior en `session.prev.json`, junto a `session.json`. La primera escritura de un arranque que vaya a reemplazar una sesión no vacía con otras rutas copia antes la existente a `session.prev.json`. Las siguientes escrituras del mismo arranque no la tocan.
- Responder la ✕ del aviso (`declineLastSession`) borra también `session.prev.json`.
- El comando está activo cuando la pestaña de ficheros está vacía y existe sesión que reabrir: la del aviso de este arranque si no se respondió, o la de `session.prev.json`. Ejecuta `reopenLastSession` con ella.
- Texto (es) `Reabrir la última sesión`, (en) `Reopen last session`.

- [ ] **Step 1: Tests que fallan.** `session.test.ts`: guardar A, simular arranque nuevo, guardar B, `loadPreviousSession()` devuelve A; un segundo guardado C en ese arranque deja A; declinar borra la anterior; guardar las mismas rutas no crea anterior. Test del hook: con el aviso caducado y Files vacío el comando reabre; con una fila en Files el comando está deshabilitado; ejecutarlo dos veces seguidas carga una sola vez.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Reopen the last session from the palette and keep it when a new list starts`

### Task 3: Engine DJ lee su colección

**Files:**
- Modify: `main/engineReads.ts`, `main/enginePlaylists.ts` (consulta nueva junto a la de la línea 188), `renderer/src/lib/sourcePrograms.ts:37`
- Test: `main/engineReads.test.ts`, `main/enginePlaylists.test.ts`, `renderer/src/lib/sourcePrograms.test.ts` si existe

**Interfaces:**
- Produces: lectura `collection` de Engine que devuelve `CollectionTrack[]` (`shared/types.ts:1248`: `contentId`, `path`, `title`, `artist`), con el mismo contrato que `READS.collection` de `main/traktorReads.ts:92` y `empty: []`.

- [ ] **Step 1: Tests que fallan.** Sobre el fixture de Engine que ya usan los tests: la lectura devuelve una fila por pista de `Track` con título, artista y ruta absoluta resuelta como en las demás lecturas de `engineReads.ts`; biblioteca ausente devuelve `[]`. `SOURCE_READ.engine.collection` está definido.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.** `collection: true` para Engine en `sourcePrograms.ts`. La operación ya está registrada de forma genérica en `main/djIpc.ts:70`; comprobar que la tabla de Engine la atiende.
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Read the Engine DJ collection so a pasted tracklist finds its tracks`

### Task 4: Copiar las que faltan al pegar un tracklist

**Files:**
- Modify: `renderer/src/lib/tracklistMatch.ts`, `renderer/src/components/PasteTracklistModal.tsx:139-146`
- Modify: `renderer/src/i18n/locales/*.json` (clave `pasteTracklist.copyAbsent`)
- Test: `renderer/src/lib/tracklistMatch.test.ts`, `renderer/src/components/PasteTracklistModal.test.tsx`

**Interfaces:**
- Produces: `absentLines(matches: TracklistMatch[]): string` en `tracklistMatch.ts`, las líneas de nivel `absent` tal como se pegaron, unidas con `\n`, en su orden.

- [ ] **Step 1: Tests que fallan.** `absentLines` con dos ausentes entre otras devuelve las dos líneas originales en orden; sin ausentes, cadena vacía. En el modal: con ausentes aparece `data-testid="paste-tracklist-copy-absent"` con `aria-label` de la clave nueva, y al pulsarlo `navigator.clipboard.writeText` recibe `absentLines`; sin ausentes no existe.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.** Botón de icono (`Copy` de lucide, el patrón de botón de icono que ya use el modal) al final de la línea `paste-tracklist-hint`, sin texto visible. Texto (es) `Copiar las que faltan`, (en) `Copy the missing ones`.
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Copy the tracklist lines missing from the collection`

### Task 5: La carátula de baja resolución también se sustituye en lote

**Files:**
- Modify: `renderer/src/lib/coverSource.ts` (`keepCoverArg`), y sus llamadores `renderer/src/hooks/useAutoMatch.ts`, `renderer/src/components/AlbumMatchRows.tsx`, `renderer/src/lib/autoMatch.ts`
- Test: `renderer/src/lib/coverSource.test.ts` y el test del llamador que ya cubra `keep`

**Interfaces:**
- Produces: `keepCoverArg(track: Pick<TrackItem, 'coverUrl' | 'coverPath' | 'embeddedCover' | 'embeddedCoverDims'>, replaceLowRes: boolean): { url?: string; path?: string; keep: boolean }`.

Regla, la misma que `Editor.tsx:834`: `keep` es falso solo si `replaceLowRes` está activo, la carátula mostrada es la embebida (`coverUrl === embeddedCover`), sus medidas se conocen y `isLowResCover(w, h)` es cierto. Sin medidas se conserva.

- [ ] **Step 1: Tests que fallan.** Las cuatro combinaciones: ajuste apagado conserva; ajuste encendido con embebida pequeña no conserva; ajuste encendido con embebida grande conserva; ajuste encendido sin medidas conserva; carátula elegida por el usuario (`coverPath`) conserva siempre.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar** y pasar `settings.replaceLowResCover` desde cada llamador.
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Replace a low resolution cover in the match sweep when the setting asks for it`

### Task 6: Rellenar BPM y tonalidad medidos en la selección

**Files:**
- Create: `renderer/src/lib/fillMeasured.ts`
- Modify: `renderer/src/lib/commands.ts` (junto a `derive-tags`, línea 642), `renderer/src/App.tsx` (junto a `deriveTags`, línea 3851), `main/appMenu.ts` (menú Pistas), `main/i18n.ts`, `shared/shortcutDefaults.ts` (id sin acorde)
- Modify: `renderer/src/i18n/locales/*.json` (claves `commands.fillMeasured`, `notices.filledMeasured_one`, `notices.filledMeasured_other`)
- Test: `renderer/src/lib/fillMeasured.test.ts`, `renderer/src/lib/commands.test.ts`

**Interfaces:**
- Produces: `fillMeasuredPatches(tracks: TrackItem[], measured: { bpm: (path: string) => BpmResult | null | undefined; key: (path: string) => KeyResult | null | undefined }, keyNotation: 'camelot' | <la otra notación del ajuste>): { id: string; meta: Partial<TrackMeta> }[]`.

Reglas:
- Solo campos vacíos tras `trim()`. BPM como `String(Math.round(bpm))`, tonalidad como `camelot` o `name` según el ajuste, igual que `renderer/src/lib/fieldSpecs.ts:356-361`.
- Las medidas se leen de la caché de TanStack Query con las mismas claves que `useBpm` y `useKey`, con `queryClient.getQueryData`. No se lanza ningún análisis.
- El comando actúa sobre `editScope(selectedTracks, selected)`, aplica con `deriveTracksUndoable` y avisa con Deshacer como `clearMeta`. Sin parches no hace nada ni avisa.
- Textos (es) `Rellenar BPM y tonalidad`, `{{count}} pista rellenada` / `{{count}} pistas rellenadas`; (en) `Fill in BPM and key`, `{{count}} track filled in` / `{{count}} tracks filled in`.

- [ ] **Step 1: Tests que fallan.** BPM vacío con medida 127,6 escribe `"128"`; BPM ya escrito no entra en el parche; medida `null` o `undefined` no escribe; tonalidad en cada notación; pista con los dos vacíos produce un solo parche con los dos campos; lista sin nada que rellenar devuelve `[]`. El comando `fill-measured` existe y está deshabilitado sin selección.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Fill in the measured BPM and key of the selected tracks`

### Task 7: Filtrar por bits rellenados y reescalado, ordenar por sonoridad

**Files:**
- Modify: `renderer/src/lib/triage.ts` (`AttentionFilter`, `FilterFacts`, `NO_FACTS`, el recuento, `TrackSort` y su tabla de claves hacia la línea 513), `renderer/src/components/QualityFilterBar.tsx` (listas de las líneas 74 y 117, iconos), el menú de orden que liste `TrackSort`, `renderer/src/App.tsx` (donde se construyen los `FilterFacts`)
- Modify: `renderer/src/i18n/locales/*.json`
- Test: `renderer/src/lib/triage.test.ts`, `renderer/src/components/QualityFilterBar.test.tsx`

**Interfaces:**
- Produces: `AttentionFilter` gana `'paddedBits' | 'upsampled'`. `TrackSort` gana `'loudness'`. `FilterFacts` gana `analysis: (track: TrackItem) => { paddedBits: boolean; upsampled: boolean; lufs: number | null } | undefined`, con `undefined` para una pista sin analizar.

Reglas:
- `paddedBits` es el mismo hecho que pinta el badge «Bits rellenados» del editor y `upsampled` el que pinta la línea de reescalado (`renderer/src/components/QualitySection.tsx`). Se leen de la caché del análisis, no se recalculan. Los nombres de los filtros reutilizan las etiquetas que ya existen para esos hallazgos; si la etiqueta existente es una frase larga, clave nueva corta: (es) `Bits rellenados`, `Reescalado`; (en) `Padded bits`, `Upsampled`.
- Orden (es) `Sonoridad`, (en) `Loudness`. Las pistas sin medida van al final en ascendente y en descendente.

- [ ] **Step 1: Tests que fallan.** Una pista sin analizar no entra en ninguno de los dos filtros; una con relleno entra en `paddedBits` y no en `upsampled`; el recuento cuenta cada uno; orden por sonoridad ascendente y descendente con una pista sin medir al final en ambos; la barra muestra las dos entradas nuevas en la sección de silencio y clipping.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Filter the list by padded bits and upsampled files and sort it by loudness`

### Task 8: Canal sin señal

**Files:**
- Modify: `main/ffmpeg.ts` (parseo de `astats`, líneas 3315-3358), `shared/types.ts` (tipo del resultado de sonoridad), la versión de la clave de caché de esa medida en `main/analysisCache.ts`
- Modify: `renderer/src/components/LoudnessReadout.tsx`, `renderer/src/i18n/locales/*.json`
- Test: el test que ya cubre el parseo de `astats` en `main/`, `renderer/src/components/LoudnessReadout.test.tsx`

**Interfaces:**
- Produces: campo `silentChannel: 'left' | 'right' | null` junto a `balanceDb` en el resultado.

Reglas:
- `silentChannel` es `'left'` o `'right'` solo cuando `astats` informa exactamente dos secciones `Channel:` y el RMS de una no es finito y el de la otra sí. Mono, dos canales con señal y dos canales en silencio dan `null`.
- La tabla pinta una fila con tono `bad` y `data-testid="loudness-silent-channel"` en el lugar de la fila de balance. Textos (es) `Canal izquierdo sin señal`, `Canal derecho sin señal`; (en) `Left channel has no signal`, `Right channel has no signal`.
- Un resultado en caché anterior, sin el campo, se trata como `null`.

- [ ] **Step 1: Tests que fallan.** Salida de `astats` con canal 1 finito y canal 2 `-inf` da `silentChannel: 'right'` y `balanceDb: null`; al revés `'left'`; un solo canal `null`; dos `-inf` `null`. La tabla muestra la fila solo con el campo puesto, y sin fila de balance.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Say which channel carries no signal instead of dropping the balance row`

### Task 9: El recuento de Auto marcar lleva a las pistas

**Files:**
- Modify: `renderer/src/components/CuesBatchSection.tsx` (líneas 127-132 y 280-291), `renderer/src/components/Editor.tsx` y `renderer/src/App.tsx` (donde se cablea `onShowBadGrid`)
- Test: `renderer/src/components/CuesBatchSection.test.tsx`

**Interfaces:**
- Produces: prop `onShowMarked: (ids: string[]) => void` en `CuesBatchSection`.

Reglas:
- Cada fila del recuento es un `button` con `data-testid="cues-batch-tally-<kind>"` que llama a `onShowMarked` con los ids de ese tipo. Mismo texto, misma rejilla, mismas clases de color; el botón ocupa la fila entera para no cambiar anchos.
- En `App`, `onShowMarked` deja esas pistas como selección y activa el filtro `selection: 'selected'`, que ya existe. No se añade ningún filtro nuevo.

- [ ] **Step 1: Tests que fallan.** Con dos pistas `proposed` y una `none`, pulsar `cues-batch-tally-proposed` llama a `onShowMarked` con los dos ids; las filas con cero siguen sin pintarse.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Show in the list the tracks behind each line of the auto mark tally`

### Task 10: Borrar sin diálogo cuando el fichero se puede recuperar

**Files:**
- Modify: `main/shellIpc.ts` (`shell:trash`, línea 34), `main/recoverableTrash.ts` y lo que haga falta de `trashAsConfirmed` para devolver el identificador, `preload/index.ts`, `preload/api.ts`
- Modify: `renderer/src/hooks/useConfirmFlows.ts` (`askTrash`, líneas 285-325)
- Test: `main/recoverableTrash.test.ts`, `main/shellIpc.test.ts` si existe, `renderer/src/hooks/useConfirmFlows.test.tsx`

**Interfaces:**
- Produces: `window.api.trashFile(path, permanentConfirmed)` resuelve `{ where: 'trash' | 'surco' | 'deleted'; id?: string }`, con `id` cuando `where === 'surco'`.

Reglas:
- Sin diálogo cuando `alwaysAsk` es falso y, para cada fichero, o el volumen conserva Papelera o `settings.backupPolicy !== 'never'`. El diálogo sigue saliendo si algún fichero se borraría para siempre.
- Un fichero cuya copia falla no se borra, la fila se queda y se informa con `reportTrashFailure`, como hoy.
- Tras borrar, las filas cuyos ficheros fueron a Copias (`where === 'surco'`) se pueden recuperar: el aviso de filas quitadas lleva Deshacer, que llama a `window.api.restoreTrash(id, 'undo')` (o el nombre real del puente a `trash:restore`) y devuelve las filas. Seguir el patrón de `renderer/src/hooks/useMusicReview.ts:853`. Las que fueron a la Papelera del sistema no ofrecen Deshacer.
- Los tests existentes que afirmen que en Windows o en NAS se pregunta siempre cambian. Antes de cambiarlos, listarlos en el informe de la tarea con qué deja de hacer la app.

- [ ] **Step 1: Tests que fallan.** Windows (`keepsTrash` falso) con copias activas: no se abre el diálogo y se llama a `trashFile`. Con `backupPolicy: 'never'`: se abre. Mezcla de un fichero recuperable y uno no: se abre. Copia que falla: la fila sigue. Deshacer restaura por id. `trashRecoverably` devuelve el id de la copia.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Move a recoverable file to the backups without asking and offer to undo it`

### Task 11: Atajo de la barra lateral en Windows

**Files:**
- Modify: `shared/shortcutDefaults.ts:79`, `main/appMenu.ts:103-104`, `renderer/src/components/settings/ShortcutsTab.tsx:202` solo si hace falta
- Test: `shared/shortcutDefaults.test.ts`, `main/appMenu.test.ts`

Reglas:
- `toggle-sidebar` deja de ser `macOnly`. En macOS conserva `['ctrl','mod','s']`. En Windows y Linux el acorde es `['mod','alt','s']` si no choca con ninguna otra entrada de `SHORTCUT_DEFAULTS`; si choca, `['mod','shift','b']`. Usar el mecanismo de acorde por plataforma que ya tenga la tabla; si no existe, un campo opcional `winChord` leído donde se resuelven los acordes.
- El menú le pone acelerador en las dos plataformas.

- [ ] **Step 1: Tests que fallan.** En Windows el comando tiene acorde, no colisiona con ningún otro de la tabla y el menú lo lleva como acelerador; en macOS no cambia.
- [ ] **Step 2: Verlos fallar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pasan, mutación, suite, tipos, lint.**
- [ ] **Step 5: Commit** `Give the sidebar toggle a shortcut on Windows`

### Task 12: El texto de hi-res dice lo medido

**Files:**
- Modify: `renderer/src/i18n/locales/*.json` (clave `editor.qualityHiRes` o donde viva `qualityHiRes`)
- Test: el test de locales o de `QualitySection` que fije la frase

Textos:
- es: `Hay contenido real por encima de 22 kHz. Este archivo a {{rate}} no viene de calidad CD (44,1 kHz).`
- en: `There is real content above 22 kHz. This {{rate}} file does not come from CD quality (44.1 kHz).`
- Los otros seis idiomas con el mismo sentido y sin la palabra equivalente a «auténtico» ni «genuino».

- [ ] **Step 1: Test que falla.** Ningún idioma contiene en `qualityHiRes` su equivalente de «auténtico» (`auténtico`, `genuine`, `authentique`, `echt`, `autentico`, `autèntic`, `autêntico`, `本物`) y todos conservan `{{rate}}`.
- [ ] **Step 2: Verlo fallar.**
- [ ] **Step 3: Cambiar las ocho frases.** Si algún test fija la frase anterior, se actualiza y se nombra en el informe.
- [ ] **Step 4: Pasa, suite, lint.**
- [ ] **Step 5: Commit** `Say only what is measured about content above 22 kHz`
