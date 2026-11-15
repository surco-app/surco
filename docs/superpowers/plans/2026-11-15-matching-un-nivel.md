# Matching de un nivel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La playlist Matching enseña cada pareja una sola vez, en el orden en que se guardó, con bloques de un solo nivel (una pista y las que van detrás de ella), y deja invertir una pareja y quitar una pista de un bloque.

**Architecture:** Una pareja guardada `[a, b]` significa «a, luego b». Un bloque es una pista cabeza más todas las pistas `b` de sus parejas `[cabeza, b]`, en el orden de las parejas. Una pista puede salir en dos bloques, así que la lista de Matching admite filas repetidas: cada fila tiene una clave (`id` la primera vez, `id~1`, `id~2`… las siguientes) y los separadores van por clave de fila, no por id de pista. Invertir y quitar se hacen con las llamadas `editMatching('remove' | 'add', …)` que ya existen, en secuencia.

**Tech Stack:** Electron + React 19 + TS, Vitest + Testing Library, Biome.

**Spec:** decisiones de Vicent del 15/11 (conversación):
1. El orden guardado de cada pareja manda (la primera pista va delante), también para las parejas hechas en rekordbox.
2. Un solo nivel: `A→B, A→C, C→D` da los bloques `A, B, C` y `C, D`.
3. Una pista que está en dos bloques sale en los dos (fila repetida).
4. «Invertir orden» en el menú derecho.
5. Quitar una pista de un bloque de más de 2. Si es la que une a las demás (la cabeza), las demás siguen juntas (equivalente al «unir A → C» que eligió).

## Global Constraints

- Sin comentarios en el código. Selectores de test: `data-testid`.
- Textos nuevos en los 8 idiomas (`ca de en es fr it ja pt-BR`), con tuteo; sin guion largo ni «:» explicativo.
- vitest desde `apps/desktop` del worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src`. No filtrar por ruta desde la raíz.
- Tipos: los tres `tsc --noEmit -p tsconfig.{web,node,scenarios}.json` desde `apps/desktop` con `/Users/vicent/code/surco/node_modules/.bin/tsc`.
- Biome: `/Users/vicent/code/surco/node_modules/@biomejs/biome/bin/biome check <ficheros>` desde `apps/desktop`; dentro del worktree sale un aviso del `biome.json` anidado que no cuenta, solo cuentan diagnósticos de los ficheros.
- Un commit por tarea, título descriptivo en inglés sin prefijo, terminado con la línea `Claude-Session: https://claude.ai/code/session_01VUKzGE6v271gPJs2j1Fgnc`.
- Cambiar o borrar una aserción existente: decir en el informe de la tarea qué deja de hacer la app.

## Review Focus

1. Una pareja guardada en los dos sentidos (`[a,b]` y `[b,a]`) sale una sola vez, en el sentido de la primera (Task 1 lo fija).
2. Seleccionar una pista repetida resalta sus dos filas; ↑/↓ y ⌫ no se rompen ni lanzan (Task 2 lo fija con un test de teclado).
3. «Crear playlist» con una pista repetida no la mete dos veces en la playlist nueva (Task 2).
4. El contador de la banda de Matching cuenta pistas, no filas (Task 2).
5. Invertir y quitar con rekordbox abierto se encolan en orden: primero se quita y luego se añade (Task 3 comprueba el orden de las llamadas).

---

### Task 1: Bloques de un nivel en el orden guardado

**Files:**
- Modify: `apps/desktop/src/shared/matchingChains.ts` (renombrar a `matchingBlocks.ts`, junto con su test)
- Modify: `apps/desktop/src/main/rekordboxMatching.ts:34-43`, `apps/desktop/src/renderer/src/lib/matchingPaths.ts:45`
- Test: `apps/desktop/src/shared/matchingBlocks.test.ts`

**Interfaces:**
- Produces: `matchingBlocks(pairs: readonly (readonly [string, string])[], label: (id: string) => string): string[][]`. Cada bloque es `[cabeza, ...seguidoras]`. Se ignoran las parejas consigo misma y la segunda aparición de una pareja en cualquier sentido. Las seguidoras van en el orden de sus parejas en `pairs` (que llegan por `created_at`). Las cabezas son las pistas con al menos una pareja saliente. Los bloques se ordenan de más largo a más corto y, a igual longitud, por `label(cabeza)`.

- [ ] **Step 1: Reescribir el test.** Mantener los de «unrelated pairs apart», «both deck orders» (esperado `[['a','b']]`), «longer first» y «itself». Sustituir los de cadena por:

```ts
it('keeps the saved order of a pair, because the first track is the one played first', () => {
  const titles: Record<string, string> = { '9': 'Acid Groove', '1': 'Take Me Home' }
  expect(matchingBlocks([['1', '9']], (id) => titles[id])).toEqual([['1', '9']])
})

it('stops at one level, so A→B, A→C, C→D reads as A, B, C and C, D', () => {
  expect(matchingBlocks([['a', 'b'], ['a', 'c'], ['c', 'd']], byId)).toEqual([
    ['a', 'b', 'c'],
    ['c', 'd'],
  ])
})

it('puts the followers in the order the pairs were saved, not by title', () => {
  expect(matchingBlocks([['hub', 'z'], ['hub', 'a']], byId)).toEqual([['hub', 'z', 'a']])
})

it('gives a track played after two others a place in both blocks', () => {
  expect(matchingBlocks([['x', 'a'], ['y', 'a']], byId)).toEqual([
    ['x', 'a'],
    ['y', 'a'],
  ])
})
```

«longer first» con `[['a','b'],['x','y'],['x','z']]` espera `[['x','y','z'],['a','b']]`.

- [ ] **Step 2:** Ejecutar la suite; los nuevos fallan.
- [ ] **Step 3:** Implementar `matchingBlocks`, cambiar las dos llamadas e imports.
- [ ] **Step 4:** Suite completa en verde. Si `rekordboxPlaylists`, `matchingPaths` o `App` tienen aserciones sobre el orden viejo, ajustarlas y listarlas en el informe.
- [ ] **Step 5: Commit** `Read each Matching block as one track and the tracks saved after it, in the saved order`

### Task 2: La lista de Matching enseña una pista en dos bloques

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/playlistView.ts` (`playlistView`, `blocksWith`, `blocksOf`)
- Modify: `apps/desktop/src/renderer/src/components/TrackList.tsx` (`rowFor`, `orderKeys`, clave del contenedor virtual, `MenuState`)
- Modify: `apps/desktop/src/renderer/src/components/TrackRow` (el componente de fila dentro de `TrackList.tsx`, línea ~350: `onOpenMenu`)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (llamada a `playlistView` ~1975, `MatchingBand tracks` ~4226, `blocksOf` ~4250, `blocksWith` ~2219)
- Test: `lib/playlistView.test.ts`, `components/TrackList.test.tsx`, `App.test.tsx`

**Interfaces:**
- Consumes: bloques de Task 1 llegan como entradas separadas por separadores (`inChains` / `matchingEntriesFor`), con la misma pista en varios bloques.
- Produces:
  - `rowKeys(tracks: readonly { id: string }[]): string[]` en `playlistView.ts`: `id` la primera vez, `` `${id}~${n}` `` la n-ésima repetición (n desde 1).
  - `playlistView(tracks, entries, previous, { repeats }?: { repeats?: boolean })`: con `repeats: true` una pista que vuelve a aparecer se añade otra vez a `tracks`; sin la opción, igual que hoy. `separatorBefore` queda indexado por clave de fila (para listas sin repetidas, clave == id, así que nada cambia fuera de Matching).
  - `blocksWith` y `blocksOf` miran `separatorBefore` por `rowKeys(tracks)[i]`. `blocksOf` devuelve cada pista una sola vez.
  - `MenuState` gana `rowKey: string`; `onOpenMenu(track, x, y, rowKey)`. La fila recibe su `rowKey` como prop.
  - App llama a `playlistView(..., { repeats: browser.playlist?.id === MATCHING_ID })`.

- [ ] **Step 1: Tests en rojo.**
  - `playlistView.test.ts`: con `repeats` y entradas `a, b, c, sep, c, d` → `tracks` ids `['a','b','c','c','d']` y `separatorBefore` tiene la clave `'c~1'` y no `'c'`. Sin `repeats` → `['a','b','c','d']` (lo de hoy).
  - `rowKeys(['a','c','c','c'])` → `['a','c','c~1','c~2']`.
  - `blocksOf` con `c` repetida y elegida → `c` una sola vez.
  - `TrackList.test.tsx`: con la misma pista dos veces y un separador antes de la segunda, salen dos `track-row`, un `track-separator-*` entre ellas, sin aviso de claves duplicadas de React (espiar `console.error`), y con la pista seleccionada las dos filas tienen `aria-selected="true"`. ↓ desde la primera fila no lanza.
  - `App.test.tsx` (patrón de `describe('with tracks selected')`, `matching` → `[['r1','r2'],['r1','r3'],['r3','r4']]` con 4 pistas): salen 5 filas, la pista r3 dos veces, y `MatchingBand` cuenta 4.
- [ ] **Step 2:** Ejecutar; fallan por lo esperado.
- [ ] **Step 3:** Implementar. El contador de `MatchingBand` usa pistas únicas (`new Set(scopeTracks.map((t) => t.id)).size`).
- [ ] **Step 4:** Suite completa + 3 tsc + biome en verde.
- [ ] **Step 5: Commit** `Show a track in every Matching block it belongs to`

### Task 3: Invertir orden y quitar una pista desde el menú derecho

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (`renderTrackMenu` ~3410, junto a `unmatchPairOf`)
- Modify: `apps/desktop/src/renderer/src/components/TrackContextMenu.tsx` (junto a `track-menu-unmatch`, línea ~300)
- Modify: los 8 `i18n/locales/*.json` bajo `trackList.context`
- Test: `App.test.tsx`, `components/TrackContextMenu.test.tsx`

**Interfaces:**
- Consumes: `MenuState.rowKey` (Task 2); `rowKeys`, `separatorBefore` por clave de fila (Task 2); `editMatching(action, pair, label, paths)` y `pairOfTracks(first, second)` de App.
- Produces: `TrackContextMenu` props `onReverseMatch?: () => void` (testid `track-menu-reverse-match`) y `onLeaveMatch?: () => void` (testid `track-menu-leave-match`). Claves i18n `trackList.context.reverseMatch` («Invertir orden») y `trackList.context.leaveMatch` («Quitar del matching»).

Reglas (solo con la playlist Matching abierta; el bloque se saca de la fila por `rowKey`, cabeza = primera fila del bloque):
- Fila seguidora `X` del bloque de `H`: «Invertir orden» quita `[H, X]` y añade `[X, H]`. «Quitar del matching» quita `[H, X]`.
- Fila cabeza `H` de un bloque de 2 (`H, X`): «Invertir orden» quita `[H, X]` y añade `[X, H]`. «Quitar del matching» quita `[H, X]`.
- Fila cabeza `H` de un bloque de 3 o más (`H, S1, …, Sn`): sin «Invertir orden». «Quitar del matching» quita cada `[H, Si]` y añade `[S1, Si]` para `i ≥ 2`, así el resto sigue junto.
- Cada cambio es una llamada `editMatching` con `pairOfTracks`, en el orden escrito y esperando a la anterior (`await`).
- El «Quitar matching» de dos pistas seleccionadas sigue igual; si sale, «Quitar del matching» no sale.

- [ ] **Step 1: Tests en rojo** en `App.test.tsx` con `matching` `[['r1','r2']]` y otro con `[['r1','r2'],['r1','r3']]`, espiando `window.api.dj.match`:
  - Clic derecho en la segunda fila de un bloque de 2 → «Invertir orden» llama `match('rekordbox','remove',['r1','r2'])` y luego `match('rekordbox','add',['r2','r1'])`, en ese orden.
  - En el bloque de 3, «Quitar del matching» en la fila r3 → solo `remove ['r1','r3']`.
  - En el bloque de 3, «Quitar del matching» en la cabeza r1 → `remove ['r1','r2']`, `remove ['r1','r3']`, `add ['r2','r3']`.
  - Cabeza de un bloque de 3 → no hay `track-menu-reverse-match`.
  - Fuera de Matching ninguna de las dos opciones sale.
- [ ] **Step 2:** Ejecutar; fallan.
- [ ] **Step 3:** Implementar; textos en los 8 idiomas (`ca` «Inverteix l'ordre» / «Treu del matching», `de` «Reihenfolge umkehren» / «Aus dem Matching entfernen», `en` «Reverse order» / «Remove from matching», `fr` «Inverser l'ordre» / «Retirer du matching», `it` «Inverti l'ordine» / «Togli dal matching», `ja` «順序を入れ替える» / «マッチングから外す», `pt-BR` «Inverter a ordem» / «Tirar do matching»).
- [ ] **Step 4:** Suite completa + 3 tsc + biome en verde.
- [ ] **Step 5: Commit** `Reverse a Matching pair or take one track out of its block from the row menu`

### Task 4: Fusionar bloques seleccionados

Spec 6 (15/11): con A+B+C y C+D seleccionados (al menos una pista de cada bloque), el usuario los fusiona en uno, A+B+C+D.

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (`renderTrackMenu`), `apps/desktop/src/renderer/src/components/TrackContextMenu.tsx`, los 8 `i18n/locales/*.json` bajo `trackList.context`
- Test: `App.test.tsx`, `components/TrackContextMenu.test.tsx`

**Interfaces:**
- Consumes: bloques por `rowKeys` + `separatorBefore` (Task 2), `editMatching`, `pairOfTracks`; el mismo patrón secuencial de Task 3.
- Produces: prop `onMergeMatch?: () => void` (testid `track-menu-merge-match`), clave `trackList.context.mergeMatch`.

Reglas (solo con la playlist Matching abierta):
- Bloques tocados = los bloques que contienen alguna fila seleccionada, en orden de la lista. La opción sale solo si son 2 o más.
- El primer bloque manda: su cabeza `H` pasa a ser la cabeza de todo.
- Para cada otro bloque `K` (cabeza `Hk`, seguidoras `Sk…`): quitar cada `[Hk, s]`; después añadir `[H, x]` por cada pista `x` de `K` (cabeza y seguidoras) que no sea `H` ni sea ya seguidora de `H`, en el orden del bloque.
- Llamadas `editMatching` en secuencia con `await`: primero todas las de quitar, luego todas las de añadir.
- Textos: `es` «Fusionar bloques», `ca` «Fusiona els blocs», `de` «Blöcke zusammenführen», `en` «Merge blocks», `fr` «Fusionner les blocs», `it` «Unisci i blocchi», `ja` «ブロックを結合», `pt-BR` «Juntar blocos».

- [ ] **Step 1: Tests en rojo** (`matching` `[['r1','r2'],['r1','r3'],['r3','r4']]`): seleccionar una fila de cada bloque y elegir «Fusionar bloques» → `remove ['r3','r4']` y luego `add ['r1','r4']`, nada más (r3 ya es seguidora de r1). Con `[['r1','r2'],['r5','r6']]` → `remove ['r5','r6']`, `add ['r1','r5']`, `add ['r1','r6']`. Con una sola fila o filas del mismo bloque, no hay `track-menu-merge-match`.
- [ ] **Step 2:** Ejecutar; fallan.
- [ ] **Step 3:** Implementar + textos.
- [ ] **Step 4:** Suite completa + 3 tsc + biome en verde.
- [ ] **Step 5: Commit** `Merge the selected Matching blocks into one from the row menu`
