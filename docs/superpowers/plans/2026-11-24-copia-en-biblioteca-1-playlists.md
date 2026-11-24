# Copia en biblioteca, entrega 1. Playlists sobre la copia. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando un programa DJ ya tiene una copia de la pista, el campo «<programa> · Add to a playlist» enseña las playlists de esa copia y marcar o desmarcar la mete o la saca al momento, con el aviso de siempre y Undo. Sin copia, el campo sigue como hoy.

**Architecture:** `lib/libraryCopy.ts` decide qué cuenta como copia a partir del veredicto de la fila de «In your library» (interfaz compartida con las entregas 2 y 3). Un hook nuevo, `useCopyPlaylistEdits`, manda las ediciones al programa a través de `useRekordboxEdits` (lo mismo que la barra lateral, con la misma pregunta de aplicar ahora o al cerrar) y monta el Undo con `reportUndo` y `offerShortcutUndo`. `usePlaylistsSpec` recibe qué copia tiene cada pista y, para esas pistas, lee la pertenencia de la copia y manda los cambios al hook en vez de apuntarlos en `item.playlists`. Con varias pistas, una búsqueda pura sobre las colecciones ya cargadas dice qué pistas tienen copia.

**Tech Stack:** Electron, React 19, TS, TanStack Query, i18next, Vitest y Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-copia-en-biblioteca-design.md` (solo «### 1. Playlists sobre la copia» y, de «Decisiones tomadas tras la revisión», qué cuenta como copia, Undo de playlists, Engine no quita y una copia por programa).

## Global Constraints

- Se trabaja en el worktree `/Users/vicent/code/surco-copia-en-biblioteca`, en la rama `copia-en-biblioteca`. Para los tests, `ln -sf /Users/vicent/code/surco/apps/desktop/node_modules apps/desktop/node_modules` (ese enlace no se commitea) y vitest se lanza desde `apps/desktop` con `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <ruta>`, nunca desde la raíz del repo.
- Typecheck desde `apps/desktop` con los tres proyectos, `npx tsc --noEmit -p tsconfig.web.json`, `npx tsc --noEmit -p tsconfig.node.json` y `npx tsc --noEmit -p tsconfig.scenarios.json`. Un `tsc` pelado no comprueba nada.
- `npm run lint -w apps/desktop` sobre todo el escritorio (no por fichero) al final, limpio.
- Siempre TDD. Hay que ver el test en rojo antes de implementar. Un test que solo pasa suelto está roto. La suite mira el código de salida (Unhandled Errors deja 1 aunque pasen todos).
- Los tests seleccionan por `data-testid`, nunca por clases CSS.
- Los comentarios del código solo explican el porqué (CLAUDE.md del repo).
- Mensajes de commit en inglés, una sola línea descriptiva, sin prefijo.
- Copia en 8 idiomas (ca, de, en, es, fr, it, ja, pt-BR), con tuteo. En el texto de la UI no van ni guion largo ni dos puntos explicativos. Las cuentas pasan por `count` (i18next las formatea con `formatCount`).
- No se sube ningún namespace de caché (nada de reanálisis forzado). Ningún campo nuevo en `TrackItem` ni en `AppSettings`.
- No se pide confirmación al marcar o desmarcar (norma «confirmar solo lo irreversible»). La pregunta de «aplicar ahora o al cerrar» del programa abierto sí sale, porque es la de la barra lateral.
- En pruebas a mano la biblioteca real de rekordbox no se toca nunca. Solo una copia de `master.db` fuera de `~/Library/Pioneer`, y solo pistas de prueba propias.
- Si un test que ya existe tiene que cambiar o perder una aserción, se avisa antes del commit y se dice qué deja de hacer la app.

## Decisiones de este plan (para que Vicent las corrija si quiere)

- **`several` no cuenta como copia.** Solo lo produce la fila de Apple Music cuando Music tiene varias entradas empatadas (`tiedCopies` en `useLibraryVerdict`): Surco no sabe cuál es la copia. Las filas de programas DJ nunca lo dan. `libraryIn` no es un veredicto, es el texto de la cabecera para `library`.
- **La copia solo se conoce con la sección visible.** `useProgramCopies` corre con `libraryShown` (pestaña Tracks, una pista, sección «In your library» no oculta). Si el DJ oculta la sección, el campo funciona como hoy. Es lo que dice el spec («cuando hay una fila en In your library»).
- **Lo apuntado manda.** Si la pista ya tiene playlists apuntadas para ese programa (`item.playlists[programa].targets` definido), el campo sigue apuntando para esa pista aunque aparezca la copia, así nada apuntado queda oculto y se aplica a escondidas en la conversión.
- **Programa abierto.** Con el programa abierto, la edición queda en cola (`{ applied: false, queued: true }`) y la pertenencia leída del disco no la refleja hasta que se cierra. El campo mantiene marcada (o desmarcada) la playlist en cola hasta que la lectura coincide, con el aviso de siempre («se aplicará al cerrarlo») y **sin Undo**, porque quitar exige un `linkId` que aún no existe.
- **Undo de quitar devuelve la pista a su sitio**, no al final: el orden de una playlist es el set del DJ. Se vuelve a añadir y se mueve delante de la fila que la seguía.
- **Engine DJ.** No permite quitar. Las playlists donde ya está la copia salen marcadas y no se pueden desmarcar, con un tooltip que dice que se quita desde Engine. Añadir va sin Undo. Crear sí lleva Undo, porque Engine permite borrar la playlist creada.
- **Varias pistas.** No hay sección ni veredictos con varias pistas, y medir el audio de toda la selección no es viable. Una pista de la selección tiene copia en un programa cuando su colección tiene una entrada del mismo título, artista y duración (`findLibraryEntry` con la duración), sin el último recurso de solo título que en una pista sola da las filas «Another version», y que no es ella misma. Sin duración conocida, no tiene copia.
- **Aviso neutro sin Undo.** `ToastReporter` gana `reportNotice(message)`, el aviso de edición de siempre (clave `rekordbox-edit`), para los casos sin Undo (en cola, Engine añadir).

## Review Focus

- El DJ marca una playlist mientras la fila aún dice «Comparing» y luego resulta «Another version». La copia ya entró (el spec cuenta «Comparing»), el Undo del aviso la saca, y a partir de ahí el campo vuelve a apuntar. Test en la Task 7.
- rekordbox abierto y el DJ elige «Later». La playlist sigue marcada tras la relectura y no sale Undo. Test en la Task 4.
- La copia está dos veces en la playlist (rekordbox lo permite). Desmarcar quita todas sus filas y Undo las devuelve. Test en la Task 4.
- Undo después de que el DJ haya cambiado de pista. El Undo actúa sobre la copia y la playlist que guardó, no sobre la pista abierta ahora. Test en la Task 4.
- Varias pistas, unas con copia y otras sin ella. Las de copia entran al momento en una sola edición con un aviso y un Undo, y el resto queda apuntado. Test en la Task 8.

---

### Task 1: Qué cuenta como copia

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/libraryCopy.ts`
- Test: `apps/desktop/src/renderer/src/lib/libraryCopy.test.ts`

**Interfaces:**
- Consumes: `type LibraryVerdict` de `components/LibrarySection.tsx` (`'here' | 'library' | 'same' | 'measuring' | 'different' | 'tie' | 'thisFile' | 'missing' | 'unreadable' | 'unmeasurable' | 'several' | 'even'`).
- Produces (las entregas 2 y 3 los usan, nombres exactos):
  - `export function countsAsCopy(verdict: LibraryVerdict | null | undefined): boolean`. `true` para `same`, `even`, `tie`, `here`, `library`, `unmeasurable` y `measuring`. `false` para `different`, `unreadable`, `missing`, `thisFile`, `several`, `null` y `undefined`.
  - `export function copyPathIn(program: DjProgram, rows: readonly { program: DjProgram; path: string; verdict: LibraryVerdict | null }[]): string | undefined`. La ruta de la fila de ese programa si `countsAsCopy(verdict)`.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `it('counts every verdict about the same recording as a copy, since the DJ already has that track there')`: `it.each(['same','even','tie','here','library','unmeasurable','measuring'])` da `true`.
  - `it('does not count another version, an unreachable copy or the open file itself')`: `it.each(['different','unreadable','missing','thisFile'])` da `false`.
  - `it('does not count several tied copies, since Surco cannot tell which one is the track')`: `'several'` da `false`.
  - `it('has no copy before any verdict')`: `null` y `undefined` dan `false`.
  - `it('finds the copy of one program and ignores the others')`: con filas de rekordbox (`same`, `/r/a.aiff`) y Engine (`different`, `/e/a.mp3`), `copyPathIn('rekordbox', rows)` es `/r/a.aiff` y `copyPathIn('engine', rows)` es `undefined`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/libraryCopy.test.ts` falla (el módulo no existe).
- [ ] **Step 3: Implementar** las dos funciones. Un comentario breve explica por qué `measuring` cuenta (la copia se encontró, falta saber cuál es mejor) y por qué `several` no.
- [ ] **Step 4:** el mismo comando pasa y `npx tsc --noEmit -p tsconfig.web.json` da 0.
- [ ] **Step 5:** commit `Decide which library rows count as a copy of the open track`.

### Task 2: Leer playlists y filas de una ruta

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/rekordboxPlaylists.ts` (`effectivePlaylists`, ~99)
- Test: `apps/desktop/src/renderer/src/lib/rekordboxPlaylists.test.ts`

**Interfaces:**
- Produces:
  - `export function playlistsOfPath(path: string, membership: Membership, options: readonly PlaylistOption[]): RekordboxPlaylistTarget[]`. Lo que hoy hace la rama final de `effectivePlaylists` (ids de `membership[path]` con su nombre, sin los que no están en `options`). `effectivePlaylists` pasa a usarla, sin cambiar de conducta.
  - `export function linkIdsOf(entries: readonly SourcePlaylistEntry[], paths: readonly string[]): string[]`. Los `linkId` de las entradas cuya `path` coincide con alguna de `paths` comparando con `pathKey` (`lib/pathKey.ts`), en el orden de la playlist, sin separadores ni entradas sin `linkId`.
  - `export function linkAfter(entries: readonly SourcePlaylistEntry[], linkIds: readonly string[]): string | null`. El `linkId` de la primera entrada que sigue a la última de `linkIds` y no está entre ellas, o `null` si van al final.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `it('names the playlists a path is in, skipping smart lists the field cannot offer')`: `membership = { '/r/a.aiff': ['1','9'] }`, `options` solo con `1` → `[{ id: '1', name: 'Verano' }]`.
  - `it('finds every row of the copy, since rekordbox lets a track sit twice in a playlist')`: entradas `a`, copia, `b`, copia (rutas con otra caja de mayúsculas en macOS si `pathKey` las pliega) → los dos `linkId` de la copia.
  - `it('says which row followed the removed ones, so Undo can put the track back in its place')`: entradas `a`,`c1`,`b` y `linkIds=['c1']` → `'b'`. Con la copia la última → `null`.
  - Los tests que ya hay de `effectivePlaylists` siguen pasando sin tocarlos.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/rekordboxPlaylists.test.ts` falla en los nuevos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** pasa, y `tsc` web da 0.
- [ ] **Step 5:** commit `Read the playlists and playlist rows of a library copy by its path`.

### Task 3: Aviso neutro en el ToastReporter

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/toastContext.tsx` (interfaz y `FALLBACK`)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (`toastReporter`, ~481)
- Test: `apps/desktop/src/renderer/src/lib/toastContext.test.tsx`

**Interfaces:**
- Produces: `ToastReporter.reportNotice: (message: string) => void`. En App hace `pushToast(store, { key: 'rekordbox-edit', tone: 'neutral', message, duration: 5000, testid: 'rekordbox-edit-notice' })`, la misma tarjeta que `notifyEdit` (~1016), así una ráfaga de ediciones deja la última. En `FALLBACK` no hace nada.

- [ ] **Step 1: Test que falla** en `toastContext.test.tsx`: `it('says a neutral notice without a provider and without throwing')`, llamar a `useToast().reportNotice('x')` fuera de provider no lanza.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/toastContext.test.tsx` falla.
- [ ] **Step 3: Implementar.** Los mocks de `ToastReporter` en otros tests que no compilen ganan `reportNotice: vi.fn()`.
- [ ] **Step 4:** pasa, y `tsc` web da 0.
- [ ] **Step 5:** commit `Let a component post the neutral library edit notice`.

### Task 4: Editar las playlists de la copia, con Undo

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useCopyPlaylistEdits.ts`
- Modify: los 8 `apps/desktop/src/renderer/src/i18n/locales/*.json` (`editor.playlists`)
- Test: `apps/desktop/src/renderer/src/hooks/useCopyPlaylistEdits.test.tsx`

**Interfaces:**
- Consumes: `useRekordboxEdits(notify, library, beforeWrite)` (`hooks/useRekordboxEdits.ts`), `linkIdsOf` y `linkAfter` (Task 2), `reportUndo` y `reportNotice` de `useToast()` (Task 3), `offerShortcutUndo` de `lib/shortcutUndo.ts`, `SOURCE_PROGRAMS[library].edit` (`kinds`, `messagePrefix`).
- Produces:

  ```ts
  export interface CopyPlaylistEdits {
    toggle: (paths: string[], target: RekordboxPlaylistTarget, on: boolean) => Promise<void>
    queued: ReadonlyMap<string, boolean>
    canRemove: boolean
  }
  export function useCopyPlaylistEdits(library: PlaylistLibrary, membership: Membership | undefined): CopyPlaylistEdits
  export const queuedKey = (path: string, playlistId: string): string => `${path}\n${playlistId}`
  ```

Comportamiento:
- `beforeWrite` es `() => window.api.dj.askToApply([library])`, como `editRekordboxAsking` en App (~1063). El `notify` que recibe `useRekordboxEdits` no pinta nada, guarda el último `(text, tone)` en un ref para decidir el aviso después.
- **Añadir** (`on` y `target.id`): `{ kind: 'add', playlistId: target.id, tracks: paths.map((p) => ({ paths: [p] })) }`.
- **Crear** (`on` y sin `id`): `{ kind: 'create', parentId: 'root', name: target.name, folder: false, tracks: … }`.
- **Quitar** (`!on`): lee `window.api.dj.playlist(library, target.id)`, `linkIds = linkIdsOf(entries, paths)`, guarda `next = linkAfter(entries, linkIds)` y manda `{ kind: 'remove', playlistId, linkIds }`. Sin filas, no manda nada. Si `!canRemove` (`kinds` sin `'remove'`, hoy Engine), no hace nada.
- **Aviso** con `applied: true`: el texto capturado (añadir y crear ya lo dan, `editMessage`) o, al quitar, `editor.playlists.copyRemoved` con `count = linkIds.length` y `name`. Va por `reportUndo(text, undo)` con `offerShortcutUndo`, como `ReplacedReview.tsx` (~23-37), salvo añadir en un programa sin `'remove'`, que va por `reportNotice` sin Undo.
- **Aviso** sin aplicar: tono `danger` por `reportError`, `neutral` (en cola, programa abierto) por `reportNotice`. Si es `queued`, apunta `queuedKey(path, playlistId) → on` en `queued` para cada ruta. Una entrada de `queued` se borra cuando `membership[path]` ya dice lo mismo.
- **Undo**, siempre sobre las `paths` y la playlist que guardó la edición, no sobre la pista abierta. Añadir: lee la playlist y quita `linkIdsOf(entries, paths)`. Crear: `{ kind: 'delete', playlistId: result.createdId }`. Quitar: vuelve a añadir y, si `next` no es `null` y el programa admite `'move'`, lee la playlist y mueve las filas nuevas de la copia delante de `next`. Las ediciones del Undo pasan por el mismo `useRekordboxEdits` y no sacan otro Undo. Si fallan, sale su aviso de error.

Copia nueva en `editor.playlists`:
- `copyRemoved_one` / `copyRemoved_other`. en «{{count}} track removed from “{{name}}”» / «{{count}} tracks removed from “{{name}}”». es «{{count}} pista quitada de «{{name}}»» / «{{count}} pistas quitadas de «{{name}}»». Los otros seis siguen las comillas y el tono de `sources.edit.added` en su idioma.

- [ ] **Step 1: Escribir los tests que fallan**, con `djReads` (`test/api.ts`), `QueryClientProvider` y un `ToastProvider` con `reportUndo`, `reportNotice` y `reportError` simulados. `import '../i18n'`.
  - `it('adds the copy to the playlist right away and offers Undo, so the DJ never leaves Surco to file it')`: `toggle(['/r/a.aiff'], { id: 'p1', name: 'Verano' }, true)` llama a `editPlaylist('rekordbox', { kind: 'add', playlistId: 'p1', tracks: [{ paths: ['/r/a.aiff'] }] }, 'Verano')` y a `reportUndo` con el texto de «1 track added».
  - `it('asks to apply now or later first, like the sidebar')`: `askToApply` se llama con `['rekordbox']` antes que `editPlaylist`.
  - `it('takes the added copy back out on Undo')`: tras el add, `playlist` devuelve la copia con `linkId: 'L7'`. Ejecutar el `onUndo` recibido manda `{ kind: 'remove', playlistId: 'p1', linkIds: ['L7'] }`.
  - `it('removes every row of the copy and puts them back where they were on Undo')`: entradas `a`, copia `L2`, copia `L4`, `b`. Desmarcar manda `remove` con `['L2','L4']` y `reportUndo` con `copyRemoved` y count 2. El Undo manda `add` y luego `move` con las filas nuevas y `beforeLinkId: 'b'`.
  - `it('creates the playlist with the copy inside and deletes it on Undo')`: `toggle(paths, { name: 'Nueva' }, true)` manda `create` con `parentId: 'root'`. Con `createdId: 'n1'`, el Undo manda `{ kind: 'delete', playlistId: 'n1' }`.
  - `it('keeps a queued change ticked and offers no Undo while the program is open')`: `editPlaylist` responde `{ applied: false, queued: true, opId: 'o' }`. `reportNotice` se llama y `reportUndo` no. `queued.get(queuedKey('/r/a.aiff','p1'))` es `true` hasta que `membership` incluye `p1`, y entonces desaparece.
  - `it('says the refusal in red and changes nothing when the write fails')`: `{ applied: false, reason: 'write-failed' }` llama a `reportError` y no a `reportUndo`.
  - `it('never removes from Engine DJ, which cannot take a track out of a playlist')`: con `'engine'`, `canRemove` es `false` y `toggle(…, false)` no llama a `editPlaylist`.
  - `it('adds to Engine DJ without Undo, since Engine cannot take it back out')`: añadir en Engine llama a `reportNotice` y no a `reportUndo`.
  - `it('undoes on the copy it edited even after the DJ moved to another track')`: se renderiza con un `library` y rutas, se hace el add, se vuelve a renderizar el hook (`rerender`) con otra membership. El Undo quita las filas de `/r/a.aiff` de `p1`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useCopyPlaylistEdits.test.tsx` falla.
- [ ] **Step 3: Implementar** el hook y la copia en los 8 idiomas.
- [ ] **Step 4:** pasa, `tsc` web da 0.
- [ ] **Step 5:** commit `Add and remove a library copy from a playlist at once, with Undo`.

### Task 5: El campo actúa sobre la copia (una pista)

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useRekordboxPlaylists.ts` (`usePlaylistsSpec`, ~101)
- Modify: `apps/desktop/src/renderer/src/lib/fieldSpecs.ts` (`PlaylistsSpec`, ~28)
- Test: `apps/desktop/src/renderer/src/hooks/useRekordboxPlaylists.test.tsx`

**Interfaces:**
- Consumes: `useCopyPlaylistEdits`, `queuedKey` (Task 4), `playlistsOfPath` (Task 2).
- Produces:
  - Opción nueva de `usePlaylistsSpec`: `copyPathOf?: (track: TrackItem) => string | undefined`. Una pista va «sobre la copia» cuando `copyPathOf(t)` da ruta y no tiene nada apuntado para ese programa (`t.playlists?.[library]?.targets === undefined`).
  - `PlaylistsSpec.locked?: string[]`: ids de playlist que el campo enseña marcadas y no deja desmarcar.

Comportamiento en una pista sobre la copia:
- La membership se pide para la ruta de la copia (en `paths`, en lugar de `rekordboxPathOf(item)`).
- `single.value` es `playlistsOfPath(copia)` con lo que diga `queued` encima (en cola marcada se añade, en cola desmarcada se quita).
- `single.onChange(next)` compara `next` con `value`. La que entra va a `toggle([copia], target, true)` y la que sale a `toggle([copia], target, false)`. No llama a `onChange` de la pista: `item.playlists` no cambia.
- `locked` es `value.map(id)` cuando `!canRemove`, y `undefined` en el resto.
- Una pista sin copia, o con algo apuntado, va exactamente como hoy.

- [ ] **Step 1: Escribir los tests que fallan** junto a los de `usePlaylistsSpec` que ya hay.
  - `it('shows the playlists of the copy, not of the open file, when the program has a copy')`: membership `{ '/r/a.aiff': ['p1'] }`, `copyPathOf = () => '/r/a.aiff'` → `single.value` es `[{ id: 'p1', … }]` y `membership` se pidió con `['/r/a.aiff']`.
  - `it('sends a tick on the copy straight to the program and stages nothing on the track')`: `single.onChange([...value, p2])` llama a `editPlaylist` con `add` de `p2` y el `onChange` de la pista no se llama.
  - `it('stages as today when the program has no copy')`: sin `copyPathOf`, `single.onChange` llama al `onChange` de la pista con `playlistsEdit` y no a `editPlaylist`.
  - `it('keeps staging on a track that already had playlists staged, so nothing staged is hidden from the DJ')`: con `item.playlists.rekordbox.targets = [p3]` y copia, `single.value` es `[p3]` y marcar apunta.
  - `it('locks the copy playlists in Engine DJ, which cannot take a track out')`: con `'engine'` y copia en `p1`, `locked` es `['p1']`. En rekordbox es `undefined`.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useRekordboxPlaylists.test.tsx` falla en los nuevos.
- [ ] **Step 3: Implementar.** El hook necesita `ToastProvider` en los tests nuevos. Los que ya hay no cambian (el `FALLBACK` del contexto basta).
- [ ] **Step 4:** pasa, `tsc` web da 0.
- [ ] **Step 5:** commit `Point the playlists field at the library copy when the program has one`.

### Task 6: Filas bloqueadas en el árbol (Engine)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/PlaylistTree.tsx` (props ~76, `toggle` ~139, fila con checkbox ~252)
- Modify: `apps/desktop/src/renderer/src/components/PlaylistsField.tsx` (`TreePopover`, `TreeField`, `PlaylistsField`, `PlaylistsBulkField`)
- Modify: `apps/desktop/src/renderer/src/components/MetadataForm.tsx` (~27-47)
- Modify: los 8 `apps/desktop/src/renderer/src/i18n/locales/*.json` (`editor.playlists`)
- Test: `apps/desktop/src/renderer/src/components/PlaylistsField.test.tsx`

**Interfaces:**
- Consumes: `PlaylistsSpec.locked` (Task 5).
- Produces: prop `locked?: readonly string[]` en `PlaylistTree`, `PlaylistsField` y `PlaylistsBulkField`. `MetadataForm` pasa `f.playlists.locked`.

Comportamiento: una fila con id en `locked` y estado `'all'` tiene el checkbox `disabled`, ni el clic ni la barra espaciadora la desmarcan, y lleva `Tooltip` con `editor.playlists.removeIn` (`{{app}}` = nombre del programa). La fila no cambia de tamaño ni de sitio.

Copia nueva: `editor.playlists.removeIn`. en «Remove it in {{app}}», es «Quítala en {{app}}». Los otros seis con tuteo.

- [ ] **Step 1: Tests que fallan** en `PlaylistsField.test.tsx`.
  - `it('will not untick a locked playlist, since that program cannot take the track out')`: `locked={['p1']}`, `value=[p1]`. Abrir `playlists-summary`, clic en `playlists-check-p1` → `onChange` no se llama y `playlists-check-p1` está `disabled`.
  - `it('still ticks other playlists when some are locked')`: clic en `playlists-check-p2` llama a `onChange` con `p1` y `p2`.
  - `it('says where to remove a locked playlist')`: `playlists-row-p1` contiene el tooltip con «Remove it in Engine DJ» (con `library="engine"`).
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/PlaylistsField.test.tsx` falla.
- [ ] **Step 3: Implementar** y la copia en los 8 idiomas.
- [ ] **Step 4:** pasa, `tsc` web da 0.
- [ ] **Step 5:** commit `Keep a playlist the program cannot remove from ticked and say where to remove it`.

### Task 7: Conectar la copia de la sección al campo (Editor)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx` (`programCopies`/`programVerdicts` ~882-900, `playlistsOf` ~1486)
- Test: `apps/desktop/src/renderer/src/components/Editor.test.tsx`, junto a «shows Engine DJ from the Engine collection» (~5551)

**Interfaces:**
- Consumes: `copyPathIn` (Task 1), `rowVerdict` (`lib/libraryVerdict.ts`), `copyPathOf` de `usePlaylistsSpec` (Task 5).
- Produces: nada nuevo hacia fuera.

En Editor, con `libraryShown` y sin `isMulti`, se arman las filas `{ program, path, verdict }` de `comparedProgramCopies` con `rowVerdict(programVerdicts[i])` (las de `isThisFile` no entran) y `playlistsOf(library)` pasa `copyPathOf: (t) => (t.id === item.id ? copyPathIn(library, rows) : undefined)`. Es la misma fila que pinta la sección (una por programa, la que compara).

- [ ] **Step 1: Tests que fallan.**
  - `it('adds the rekordbox copy to a playlist from the field while the copy is still being compared')`: colección de rekordbox con `/r/Strobe.aiff` (mismo título y artista), `syncRekordbox: true`, campo visible, membership vacía y árbol con `p1`. Abrir `playlists-summary`, clic en `playlists-check-p1` → `editPlaylist('rekordbox', { kind: 'add', playlistId: 'p1', tracks: [{ paths: ['/r/Strobe.aiff'] }] }, …)`.
  - `it('stages the playlist as today when the only match is the open file itself')`: la colección tiene la ruta del archivo abierto. Marcar no llama a `editPlaylist`.
  - `it('stages the playlist as today when the library section is hidden')`: con la sección `library` oculta en `editorSections`, marcar no llama a `editPlaylist`.
  - El caso «Another version» se cubre en `copyPathIn` (Task 1), porque montar un veredicto medido en el Editor exige simular espectro, loudness y duración.
- [ ] **Step 2:** `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/Editor.test.tsx` falla en los nuevos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** pasa, `tsc` web da 0.
- [ ] **Step 5:** commit `Use the copy the library section found as the target of the playlists field`.

### Task 8: Varias pistas, pista a pista

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useProgramCopies.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useRekordboxPlaylists.ts` (rama `bulk`)
- Modify: `apps/desktop/src/renderer/src/lib/rekordboxPlaylists.ts` (`bulkPlaylistState`, `withTarget`)
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx`
- Test: `apps/desktop/src/renderer/src/hooks/useProgramCopies.test.tsx`, `apps/desktop/src/renderer/src/hooks/useRekordboxPlaylists.test.tsx`

**Interfaces:**
- Consumes: `useCopyPlaylistEdits` (Task 4), `copyPathOf` (Task 5).
- Produces:
  - `export function sameLengthCopyIn(tracks: CollectionTrack[], track: { inputPath: string; meta: { title: string; artist: string }; durationSec?: number }): string | undefined` en `useProgramCopies.ts`. Usa el mismo `lookupFor` y `findLibraryEntry(index, meta, durationSec)` sin el último recurso de solo título. `undefined` sin `durationSec` o si la entrada es la propia pista (`pathKey`).
  - `export function useSelectionCopies(tracks: TrackItem[], enabled: boolean): Partial<Record<DjProgram, Record<string, string>>>`: por programa activo (mismas `useQueries` y misma condición `sync || add` que `useProgramCopies`), id de pista → ruta de la copia.
  - `bulkPlaylistState` y `withTarget` ganan un último parámetro opcional `copyPathOf?: (t: TrackItem) => string | undefined`. Para una pista sobre la copia, su estado sale de `playlistsOfPath(copia)` y `withTarget` la deja fuera de los parches.

En `usePlaylistsSpec` (bulk): la membership se pide con la ruta de la copia de cada pista sobre la copia y la propia del resto. `bulk.onToggle(target, on)` manda una sola edición `toggle(rutasDeCopias, target, on)` si hay alguna (un aviso y un Undo para todas) y `onChangeTracks(withTarget(…))` para el resto. `bulk.locked`, con `!canRemove`, son las playlists que tienen todas las pistas de la selección a través de su copia. En Editor, con `isMulti && filesOpen && !libraryHidden`, `copyPathOf = (t) => selectionCopies[library]?.[t.id]` cuando la pista no tiene nada apuntado.

- [ ] **Step 1: Tests que fallan.**
  - En `useProgramCopies.test.tsx`: `it('finds a copy of the same length for a selected track')` → `/r/weekend.aiff` con `durationSec` igual. `it('takes no copy of another length in a selection, since there is no comparison to tell another version apart')` → con la única entrada de otra duración, `undefined`. `it('takes no copy without a known length')`.
  - En `useRekordboxPlaylists.test.tsx`: `it('adds the copies of a selection at once and stages the tracks without a copy')`: dos pistas, una con copia `/r/a.aiff` y otra sin copia. `bulk.onToggle(p1, true)` llama a `editPlaylist` una vez con `tracks: [{ paths: ['/r/a.aiff'] }]` y a `onChangeTracks` solo con la pista sin copia.
  - `it('counts a selected track as in a playlist when its copy is there')`: con la copia en `p1` y la otra pista apuntada en `p1`, `bulk.states` tiene `p1` en `'all'`.
- [ ] **Step 2:** los dos ficheros fallan en los nuevos.
- [ ] **Step 3: Implementar.** `useProgramCopies` pasa a usar las piezas compartidas sin cambiar su conducta (sus tests siguen igual).
- [ ] **Step 4:** pasan los dos y `Editor.test.tsx`, `tsc` web da 0.
- [ ] **Step 5:** commit `Apply the playlists field to each selected track's library copy at once`.

### Task 9: Probar con mutación

- [ ] **Step 1:** romper adrede, de uno en uno, y ver caer el test que nombra cada caso. Que `countsAsCopy('different')` dé `true` (cae «does not count another version…»). Que `linkIdsOf` devuelva solo la primera fila (cae «removes every row of the copy…»). Quitar la regla «lo apuntado manda» (cae «keeps staging on a track that already had playlists staged…»). Ofrecer Undo en una respuesta en cola (cae «keeps a queued change ticked…»). Hacer que el Undo use la ruta de la pista abierta en vez de la guardada (cae «undoes on the copy it edited…»). Deshacer cada cambio. Sin commit. En el informe, qué test cayó en cada uno, o qué test hubo que reforzar si alguno no cayó.

### Task 10: Suite, tipos, lint y prueba en la app

- [ ] **Step 1:** desde `apps/desktop`, `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run` con código de salida 0. Los tres `tsc` sin errores. `npm run lint -w apps/desktop` limpio.
- [ ] **Step 2: Montar la prueba sin tocar nada real.** Seguir `apps/desktop/.claude/skills/run-desktop/SKILL.md` (build con `electron-vite build`, `driver.mjs repl`, arranque por `quietLaunch`, nunca en primer plano). rekordbox: `cp ~/Library/Pioneer/rekordbox/master.db "$TMPDIR/surco-copia-rb/master.db"` con rekordbox cerrado, y en el perfil del driver `window.api.saveSettings({ rekordboxDbPath: '<esa ruta>', syncRekordbox: true })`. Crear dos tonos propios con las mismas etiquetas (título «Surco Copia Prueba», artista «Surco»): uno AIFF que se añade a la copia de la db con Surco, y otro FLAC que es el que se abre. Traktor y Engine se pueden usar reales, también con pistas de prueba propias.
- [ ] **Step 3: Qué comprobar, una a una, con captura de cada estado.**
  1. rekordbox, una pista. Abierto el FLAC, «In your library» enseña la fila de rekordbox y el campo de rekordbox lista las playlists de la copia AIFF.
  2. Marcar una playlist la añade sin pulsar convertir. Sale el aviso abajo a la izquierda con Undo, y en la copia de `master.db` (consultada con sqlite, no con rekordbox) la fila existe.
  3. Undo (botón y ⌘Z) la quita de la db y el campo la desmarca.
  4. Desmarcar quita la fila. Undo la devuelve a su posición en la playlist, no al final.
  5. Crear una playlist desde el campo la crea con la copia dentro. Undo la borra.
  6. El archivo abierto (FLAC) no entra en ninguna playlist, y convertir no aplica nada de esto.
  7. Una pista sin copia, y otra cuya fila dice «Another version», apuntan como hoy (chip discontinuo, nada en la db hasta convertir).
  8. Traktor: lo mismo que 2 a 5 contra su NML, con la colección confirmada en Ajustes.
  9. Engine DJ: las playlists donde ya está la copia salen marcadas y no se desmarcan, con el tooltip «Remove it in Engine DJ». Añadir funciona y su aviso no trae Undo. Crear trae Undo y lo borra.
  10. Varias pistas (una con copia, otra sin): marcar mete la copia al momento con un aviso y un Undo, y la otra queda apuntada.
  11. Programa abierto (Traktor o Engine, nunca rekordbox real): marcar, elegir «Later», la playlist sigue marcada, el aviso dice que se aplica al cerrar y no hay Undo. Al cerrar el programa la edición se escribe.
  12. En es, en y de, el tooltip y los avisos se leen enteros y nada cambia de tamaño al marcar.
- [ ] **Step 4:** borrar `$TMPDIR/surco-copia-rb` y los tonos. En el informe, qué punto pasó, cuál no y con qué captura. Sin commit en esta tarea si nada cambió; si algo hubo que arreglar, su propio commit con test.
