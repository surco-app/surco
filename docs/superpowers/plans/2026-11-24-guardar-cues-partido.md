# Botón partido de guardar cues. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El botón de guardar del editor de cues pasa a ser «cuerpo | ⌄», con dos modos que se recuerdan (guardar, o guardar e ir a la siguiente pista) y «Save N tracks» en el mismo menú. Descartar sale del menú.

**Architecture:** Un ajuste opcional `cueSaveThen` en AppSettings guarda el modo. App lo pasa al Editor y al `CuesSection` junto con `onCueSaveThen` y `onStepTrack` (la `moveSelection` de las flechas). `CuesSection` dibuja el mismo botón partido en la vista plegada y en la completa, y para el menú reutiliza `useSplitMenu`, `SPLIT_MENU` y `SPLIT_ITEM` de `components/SplitButton.tsx`.

**Tech Stack:** Electron, React 19, TS, Tailwind v4, i18next, Vitest y Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-guardar-cues-partido-design.md`

## Global Constraints

- Se trabaja en el worktree `/Users/vicent/code/surco-guardar-partido`, en la rama `guardar-partido`. Para los tests, `ln -sf /Users/vicent/code/surco/apps/desktop/node_modules apps/desktop/node_modules` y `vitest` se lanza desde `apps/desktop`, nunca desde la raíz del repo. Ese enlace no se commitea.
- El ajuste es `cueSaveThen: 'stay' | 'next'`, por defecto `'stay'`. Un valor desconocido en el JSON vale `'stay'`. No se sube ningún namespace de caché.
- Copia en 8 idiomas (ca, de, en, es, fr, it, ja, pt-BR), con tuteo. En el texto de la UI no van ni guion largo ni dos puntos explicativos.
- Los tests seleccionan por `data-testid` y nunca por clases CSS. Siempre TDD: hay que ver el test en rojo antes de implementar.
- Los comentarios del código solo explican el porqué (CLAUDE.md del repo).
- Mensajes de commit en inglés, una sola línea descriptiva, sin prefijo.
- Se conservan los `data-testid` que ya existen: `cues-save` (el cuerpo), `cues-save-more` (la flecha), `cues-save-all` (la línea «Save N tracks») y `cues-discard`/`cues-undo` (descartar). El de descartar en la vista completa es `cues-undo` y en la plegada `cues-discard`; se mantienen los dos.

## Review Focus

- Si el guardado en modo «next» falla, la selección no avanza y se ve el error de guardado de siempre.
- En la última fila, el modo «next» guarda y la pista sigue seleccionada, sin que la app falle.
- Con el editor a pantalla completa, avanzar de pista lo deja a pantalla completa en la pista siguiente. `useMaximizedSection` debe seguir en `'cues'`.
- Elegir una línea de modo con la pista sin cambios (o bloqueada) solo cambia el modo, no guarda ni avanza.
- Que el cuerpo no cambie de ancho entre modos. Se comprueba midiendo en la app (Task 4), porque los tests no miran clases.

---

### Task 1: Ajuste `cueSaveThen`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`, junto a `cueJumpBars` (~257)
- Modify: `apps/desktop/src/main/settings.ts`, en los valores por defecto (~104) y al normalizar (~416)
- Test: `apps/desktop/src/main/settings.test.ts`, junto a los tests de `cueJumpBars` (~1220)

**Interfaces:**
- Produces: `export type CueSaveThen = 'stay' | 'next'` en `shared/types.ts`, y `AppSettings.cueSaveThen: CueSaveThen`.

- [ ] **Step 1: Escribir los tests que fallan**, copiando el estilo de los de `cueJumpBars`.
  - `it('starts cue saves staying on the track')`: `getSettings().cueSaveThen` es `'stay'`.
  - `it('keeps the chosen way to save cues')`: `saveSettings({ cueSaveThen: 'next' })` y luego `getSettings().cueSaveThen` es `'next'`.
  - `it('reads an unknown way to save cues as staying')`: con `{ cueSaveThen: 'close' }` escrito en el JSON, el valor es `'stay'`.
- [ ] **Step 2:** `npx vitest run src/main/settings.test.ts`. Tiene que fallar.
- [ ] **Step 3: Implementar.** Default `'stay'` y normalizar con `(patch.cueSaveThen ?? base.cueSaveThen) === 'next' ? 'next' : 'stay'`.
- [ ] **Step 4:** el mismo comando pasa, y `npx tsc --noEmit -p tsconfig.node.json` y `-p tsconfig.web.json` dan 0. Si algún mock de AppSettings en los tests web deja de compilar, se le añade `cueSaveThen: 'stay'`.
- [ ] **Step 5:** commit `Remember whether a cue save stays on the track or moves to the next one`.

### Task 2: El botón partido en el editor de cues

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CuesSection.tsx`. La barra completa está en `actions` (~1456). Lo plegado, con el menú actual, en ~1665-1760. `save` está en ~1199 y `send` devuelve `Promise<boolean>`.
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx`, que pasa las props nuevas igual que `onCueJumpBars` (~259, ~378, ~2068).
- Modify: `apps/desktop/src/renderer/src/App.tsx`, con `onCueSaveThen` junto a `onCueJumpBars` (~3125). `moveSelection` sale de `useListNavigation`.
- Modify: los 8 `apps/desktop/src/renderer/src/i18n/locales/*.json`
- Test: `apps/desktop/src/renderer/src/components/CuesSection.test.tsx` (plegada) y `CuesSection.maximized.test.tsx` (completa)

**Interfaces:**
- Consumes: `CueSaveThen` de la Task 1.
- Produces: estas props nuevas de `CuesSection` (y del `Editing` interno), todas opcionales.
  - `saveThen?: CueSaveThen` (por defecto `'stay'`)
  - `onSaveThen?: (mode: CueSaveThen) => void`
  - `onStepTrack?: () => void`

  En `Editor`, `cueSaveThen?: CueSaveThen`, `onCueSaveThen?` y `onStepTrack?` se pasan tal cual. App pasa `settings?.cueSaveThen`, `onCueSaveThen = (m) => saveSettings({ cueSaveThen: m })` y `onStepTrack = () => moveSelection(1)`.

Comportamiento que fija el spec:
- **Cuerpo `cues-save`.** En modo `'stay'` muestra la copia de guardar de siempre: `copy.save` a pantalla completa y `editor.cues.saveShort` en la plegada. En modo `'next'` muestra `copy.saveNext` a pantalla completa y `editor.cues.saveNextShort` en la plegada. El clic llama a `save()` y, si el modo es `'next'` y `send` devolvió `true`, llama a `onStepTrack`.
- **Flecha `cues-save-more`.** Sale siempre, en las dos vistas, con `aria-haspopup="menu"` y la etiqueta `editor.cues.saveMore`.
- **Menú.** Se abre hacia abajo en la vista completa (`top-full mt-2` en vez del `bottom-full` de `SPLIT_MENU`) y hacia arriba en la plegada, como ahora. Lleva estas líneas:
  - `cues-save-mode-stay`, con `role="menuitemradio"`, `aria-checked` si el modo es `'stay'` y el texto `copy.save`.
  - `cues-save-mode-next`, con `role="menuitemradio"` y el texto `copy.saveNext`.
  - Al elegir una línea de modo: `onSaveThen(modo)`, se cierra el menú y, si hay cambios (`!unchanged && !blocked`), guarda con ese modo, avance incluido.
  - Separador y `cues-save-all`, con `role="menuitem"`, solo si `unsavedTracks > 1`. Texto `saveAllLabel` y llama a `saveAll()`.
- **Fuera del menú.** Descartar vuelve a ser botón propio en la plegada, `cues-discard`, igual que `cues-undo` en la completa y visible con `discardable`. En la completa desaparece el botón suelto de «Save N tracks», que ahora vive en el menú. `cues-save-this` desaparece, porque es la línea de modo `stay`.
- **Ancho estable.** El cuerpo reserva el ancho de la etiqueta más larga de los dos modos. Para eso pinta las dos etiquetas superpuestas en una rejilla de una celda (`grid` con las dos en `[grid-area:1/1]`) y oculta con `invisible` la que no toca. Es el mismo truco de reservar espacio que usa el proyecto con `visibility: hidden`.

Copia nueva:
- Una sola clave nueva, `editor.cues.saveNext`, sin variantes por programa, porque la línea de encima ya nombra el programa. En «Save and go to next track», en es «Guardar e ir a la siguiente pista». `copy.saveNext` apunta a esa clave en los cinco programas.
- `editor.cues.saveNextShort`: en «Save and next», en es «Guardar y siguiente».
- Se borran `editor.cues.saveThis` en los 8 idiomas si ya no la usa nadie.

- [ ] **Step 1: Escribir los tests que fallan** en `CuesSection.test.tsx`, con el montaje de los tests de guardado que ya hay ahí.
  - `it('saves and stays on the track by default, so editing cue by cue never jumps away')`: sin `saveThen`, añade una marca, clic en `cues-save`. `window.api.cues.save` se llama una vez y `onStepTrack` ninguna.
  - `it('saves and moves to the next track when that is the remembered way')`: con `saveThen="next"` y `onStepTrack` simulado, después del guardado `onStepTrack` se llama una vez.
  - `it('does not move on when the save fails, so the unsaved cues stay in sight')`: `saveThen="next"`, `cues.save` rechazada. `onStepTrack` no se llama y sale el aviso de error de guardado de siempre.
  - `it('remembers the way picked from the menu and saves with it')`: clic en `cues-save-more`, luego en `cues-save-mode-next`. `onSaveThen` recibe `'next'`, se guarda y `onStepTrack` se llama una vez.
  - `it('changes the way without saving when nothing changed')`: sin cambios, elegir `cues-save-mode-next` llama a `onSaveThen('next')` y no llama a `cues.save`.
  - `it('keeps Discard out of the save menu, since throwing changes away is not a way to save')`: con cambios, `cues-discard` está en la sección y no dentro de `role="menu"`.
  - `it('offers saving every unsaved track in the save menu only when more than one is unsaved')`: con un borrador en otra pista, `cues-save-all` sale dentro del menú. Con solo esta pista, no sale.

  Si algún test que ya existe busca `cues-save-this`, o busca `cues-discard` dentro del menú, hay que **avisar antes de cambiarlo** (norma «test cambiado: avisar antes»). Se adapta a la nueva ubicación y en el informe se dice qué dejó de hacer la app.

  En `CuesSection.maximized.test.tsx`:
  - `it('keeps saving every unsaved track inside the save menu in full screen, not as a loose button')`: con dos pistas con borrador, `cues-save-all` no sale hasta abrir `cues-save-more`.
  - `it('stays full screen after saving and moving to the next track')`: con `saveThen="next"`, después del clic `useMaximizedSection().maximized` sigue siendo `'cues'`.
- [ ] **Step 2:** `npx vitest run src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`. Los tests nuevos tienen que fallar.
- [ ] **Step 3: Implementar** en `CuesSection.tsx`. `save()` pasa a devolver `Promise<boolean>`, y un `saveWith(mode: CueSaveThen)` hace el avance. Luego van la copia de los 8 idiomas, el paso de props en Editor y la conexión en App.
- [ ] **Step 4:** el mismo comando pasa, y después la suite entera desde `apps/desktop` (`npx vitest run`) con código de salida 0. Si un test solo pasa suelto, está roto y hay que arreglarlo. `npx biome lint src` limpio, y `npx tsc --noEmit` con `-p tsconfig.web.json`, `-p tsconfig.node.json` y `-p tsconfig.scenarios.json` sin errores.
- [ ] **Step 5:** commit `Turn the cue save into a split button that remembers saving and moving to the next track`.

### Task 3: Probar con mutación

- [ ] **Step 1:** romper adrede `saveWith` para que avance aunque `send` falle, y comprobar que el test «does not move on when the save fails» se pone rojo. Romper la lectura de `saveThen` para que siempre sea `'stay'` y ver caer los tests de «next». Deshacer los dos cambios. No hay commit; en el informe se dice que tests cayeron.

### Task 4: Comprobación visual

- [ ] **Step 1:** medir el ancho del cuerpo en los dos modos y en los 5 idiomas principales (en, es, de, fr, pt-BR) en la vista plegada al ancho mínimo de la ventana y en la completa. El cuerpo no puede cambiar de ancho entre modos y la fila plegada no puede desbordar. Se hace con la app arrancada por los scripts de run-desktop (quietLaunch, sin activarla) o con una captura headless del componente. Si la fila plegada desborda en algún idioma, se acorta `saveNextShort` en ese idioma y se vuelve a medir. En el informe van las medidas.
