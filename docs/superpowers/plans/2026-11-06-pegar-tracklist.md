# Pegar tracklist en una playlist. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pegar un tracklist de texto sobre una playlist (o carpeta) de rekordbox, Traktor o Serato y añadir, en el orden del set, las pistas que están en la colección.

**Architecture:** Dos módulos puros en el renderer (parser y emparejador) alimentados por un IPC nuevo por programa que devuelve la colección como `{contentId, path, title, artist}`. Un modal de dos pantallas (pegar, revisar) montado desde `App.tsx` y abierto por un item nuevo del menú contextual de `SourceTree`. La escritura reutiliza `useRekordboxEdits` con `kind: 'add'` (y `kind: 'create'` antes, en la variante carpeta).

**Tech Stack:** Electron, React 19, TypeScript, TanStack Query, Vitest, i18next (6 locales), Biome.

**Spec:** `docs/superpowers/specs/2026-11-06-pegar-tracklist-design.md` (y los sets en `docs/superpowers/specs/2026-11-06-pegar-tracklist/`).

## Global Constraints

- Cero comentarios en el código nuevo (CLAUDE.md del usuario). Nombres que se expliquen solos.
- Commits con título descriptivo, sin cuerpo, sin `feat:`/`fix:`, más la línea `Claude-Session: https://claude.ai/code/session_01VUKzGDyN67uc4J8t7RoyA8` como segundo `-m` (los comandos de abajo la omiten por brevedad; va en todos).
- Tests con `data-testid`; nunca clases CSS. `vi.fn<Api['metodo']>()` para mocks de `window.api`.
- Vitest se lanza desde `apps/desktop` (`npm test -- <ruta relativa a apps/desktop>`), nunca desde la raíz con filtro de ruta.
- Textos en los 6 locales (`de`, `en`, `es`, `fr`, `ja`, `pt-BR`); `keys.test.ts` y `usedKeys.test.ts` los vigilan. Sin guion largo ni dos puntos explicativos en los textos de UI.
- Nada se escribe en la colección hasta el botón final del modal.
- Engine no recibe el item (no tiene `edit`). Apple Music tampoco (no tiene `edit`).
- Las «no están» y los huecos no aparecen en la revisión; solo cuentan.

## Review Focus

1. Texto pegado sin ninguna línea de pista (una URL sola, un párrafo): el botón «Buscar» va deshabilitado y el contador dice 0, sin excepción. Test en Tarea 6.
2. Colección vacía o IPC que falla (rekordbox cerrado con la base bloqueada): la revisión muestra 0 encontradas y el botón final deshabilitado, no una pantalla en blanco. Test en Tarea 6.
3. Línea con `(?)` y una sola coincidencia exacta: baja a dudosa aunque el texto cuadre. Test en Tarea 2.
4. Dos líneas que caen en la misma pista y el usuario saca una: la otra sigue entrando una vez. Test en Tarea 3.
5. Variante carpeta con nombre vacío: el botón «Buscar» va deshabilitado hasta que haya nombre. Test en Tarea 6.

---

### Task 1: Parser del tracklist

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/tracklistParse.ts`
- Test: `apps/desktop/src/renderer/src/lib/tracklistParse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TracklistLine {
    at: string | null        // '1:05:36' tal cual venía, o null
    artist: string           // '' cuando la línea no traía separador
    title: string            // con la mezcla tras un segundo ' - ' ya pasada a paréntesis
    suggested: boolean       // llevaba '(?)'
    raw: string              // la línea limpia, sin tiempo ni '(?)', para pintarla
  }
  export interface ParsedTracklist { lines: TracklistLine[]; gaps: number; ignored: number }
  export function parseTracklist(text: string): ParsedTracklist
  ```

- [ ] **Step 1: Test rojo**

Casos, cada uno su `it`:
- `'  - 00:00 Rave Allstars - Bitte Anschnallen (Charter Mix)'` → `{ at: '00:00', artist: 'Rave Allstars', title: 'Bitte Anschnallen (Charter Mix)', suggested: false }`.
- `'  - 1:05:36 Javi Pirata\'s & Domene DJ - On My Own (Extended Mix)'` → `at: '1:05:36'`.
- `'  - 02:24 ????? (unidentified, until 04:09)'` → `gaps: 1`, `lines: []`.
- `'  - 04:09 DJ Blyatman - Kamaz (feat. dlb) (?)'` → `suggested: true`, `title: 'Kamaz (feat. dlb)'`.
- `'  - 1:13:45 Nick Kamen – I Promised Myself'` (guion corto U+2013) → `artist: 'Nick Kamen'`.
- `'Absolom - Secret - Extended Vocal Mix'` (sin tiempo) → `at: null`, `title: 'Secret (Extended Vocal Mix)'`.
- `'  - 57:36 Dancer (Spacio Mix)'` → `artist: ''`, `title: 'Dancer (Spacio Mix)'`.
- `'  - 1:15:00 P.I.K'` → `artist: ''`, `title: 'P.I.K'`.
- `'https://www.youtube.com/watch?v=3TIb5Yin3Fw'`, `'18 identified, 1 suggested, 2 gaps (13:19 unidentified of 1:10:17)'`, `'DJ Sagy & DJ Vicent — XTV Remember | Sesión Remember 90s y 2000s'` y una línea vacía → `ignored: 3`, `lines: []` (la vacía no cuenta).
- El set 3 entero (`set3-xtv-remember.txt`, leído con `readFileSync`) → `lines.length === 31`, `gaps === 0`.
- El set 1 entero → `lines.length === 19`, `gaps === 2`.

Regla para «línea de pista sin separador»: se acepta solo si lleva tiempo delante (`57:36 Dancer (Spacio Mix)`); sin tiempo y sin separador es `ignored` (así la cabecera `XTV Remember | ...` y la URL no entran).

- [ ] **Step 2: Correr y ver que falla**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/tracklistParse.test.ts`
Expected: FAIL, `parseTracklist` no existe.

- [ ] **Step 3: Implementar `parseTracklist`**

Tiempo opcional: `^\s*[-•*]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s+`. Hueco: tras el tiempo, texto que empieza por `?`. Separadores aceptados entre espacios: `-`, `–` (U+2013), `—` (U+2014); normalizar los tres a ` - ` antes de partir. Primer ` - ` separa artista; si el título aún lleva ` - `, lo que sigue va entre paréntesis. `(?)` final → `suggested`.

- [ ] **Step 4: Verde**

Run: igual que Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/tracklistParse.ts apps/desktop/src/renderer/src/lib/tracklistParse.test.ts
git commit -m "Parse a pasted tracklist into artist, title, time and gaps"
```

---

### Task 2: Emparejador contra la colección

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/tracklistMatch.ts`
- Test: `apps/desktop/src/renderer/src/lib/tracklistMatch.test.ts`
- Fixture (ya en el árbol): `apps/desktop/src/renderer/src/lib/fixtures/tracklistCollection.json` (1233 `{artist, title}` de la colección real, con señuelos).
- Modify: `apps/desktop/src/shared/types.ts` (añadir `CollectionTrack` junto a `PlaylistTrackRef`, ~línea 1227).

**Interfaces:**
- Consumes: `TracklistLine` (Tarea 1), `foldText` de `lib/normalizeText.ts`.
- Produces:
  ```ts
  // shared/types.ts
  export interface CollectionTrack { contentId: string; path: string | null; title: string; artist: string }

  // lib/tracklistMatch.ts
  export type MatchLevel = 'found' | 'doubtful' | 'similar' | 'absent'
  export interface TracklistMatch { line: TracklistLine; level: MatchLevel; candidates: CollectionTrack[] }
  export function matchTracklist(lines: TracklistLine[], collection: CollectionTrack[]): TracklistMatch[]
  export function splitArtists(text: string): string[]      // exportada para test
  export function baseTitle(title: string): string           // exportada para test
  ```
  `candidates` viene ordenada: en `found` una sola; en `doubtful`/`similar` la primera es la propuesta. Orden de candidatas: título normalizado completo igual primero, luego por Dice descendente, luego por orden de colección.

- [ ] **Step 1: Test rojo, reglas sueltas**

- `splitArtists('Solar System, Sergi M')` → `['solar system', 'sergi m']`; `splitArtists('Head Horny\'s & Dj Miguel Serna')` → `['head hornys', 'dj miguel serna']`; `splitArtists('David Cabeza Presents Sadey')` → `['david cabeza', 'sadey']`; `splitArtists('Various Artists')` → `[]`.
- `baseTitle('So Easy to Love you-7356')` → `'so easy to love you'`; `baseTitle('Secret (Extended Vocal)')` → `'secret'`; `baseTitle('Fire!!!')` → `'fire'`.

- [ ] **Step 2: Test rojo, niveles sobre colección mínima**

Colección de 6: `Sergi M, Solar System - Because Of You`, `Jessy - Head Over Heels (Extended)`, `3 Ways - Real Love (Extended Version)`, `3 Ways - Real Love`, `Stephan K - Action (Poky Mix)`, `Jessy - Silent Tears (Extended Mix)`.
- `Solar System, Sergi M - Because of You` → `found`, 1 candidata.
- `Jessy - Silent Tears (Extended Mix)` con `suggested: true` → `doubtful` (Review Focus 3).
- `Jessy - Head over heels (Radio Edit)` → `doubtful`, candidata Extended.
- `3 Ways - Real Love (Extended Remastered)` → `doubtful`, 2 candidatas, la primera `(Extended Version)`.
- `Dj Dbc - Action (Poky Mix)` → `similar`, candidata Stephan K.
- `Rave Allstars - Bitte Anschnallen (Charter Mix)` → `absent`, 0 candidatas.
- `Dancer (Spacio Mix)` (artista '') contra colección con `Spacio - Dancer (Spacio Mix)` → `similar`.
- `P.I.K` (artista '') contra colección con una sola pista de `P.I.K.` → `similar` con esa pista; con dos pistas de `P.I.K.` → `absent`.
- `TLD - Tom apart` contra `TLD - Torn Apart (Extended Version)` → `doubtful` (Levenshtein 2 sobre 10).
- `Gigaman - The trip` contra `Gigaman - A Trip` → `doubtful` (artículos fuera).
- `Amadin - You Make Me Feel Alright` contra `Amadin - U Make Me Feel Alright (Extended Version)` → `doubtful` (Dice 4/5 ≥ 0,6).

- [ ] **Step 3: Test rojo, patrón de oro**

`parseTracklist(set3)` + `matchTracklist` contra el fixture. Afirmar los recuentos exactos: `found 9`, `doubtful 19`, `similar 3`, `absent 0`. Y que `candidates[0]` de las filas `found`+`doubtful`, en orden y sin repetir `contentId` (el fixture no trae `contentId`; en el test, construir `contentId` como `${artist} - ${title}`), es igual a `set3-playlist-a-mano.txt` quitándole sus 3 filas `P.I.K. - Speakerfreak`, `Spacio - Dancer (Spacio Mix)` y `Hard House Hooligans - Unbelievable` (27 filas, en el orden del set); y que esas 3 son exactamente `candidates[0]` de las filas `similar`. Set 1: `5 / 7 / 1 / 6`. Set 2: `15 / 15 / 4 / 12`.

- [ ] **Step 4: Correr y ver que falla**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/tracklistMatch.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implementar**

Normalizar con `foldText` y, además, unificar `’ ‘ \` ´` a `'` antes (foldText no lo hace). Separar artistas ANTES de plegar: cortar por `,`, `&`, ` and `, ` x `, `/`, y por las palabras `feat.?`, `ft.?`, `presents`, `pres.?`, `vs.?`, `meets`; plegar cada trozo; descartar `various artists`, `va`, `unknown`. Solape: algún artista de la línea es igual, contiene o está contenido en alguno de la pista. Título base: plegado, sin `(...)`/`[...]`, sin `-\d+$`, sin apóstrofos. Tokens para Dice: título base partido por espacio sin `a`, `the`, `el`, `la`, `los`, `las`. Levenshtein sobre título base, umbral `max(1, floor(0.2 * max(len)))`.

Niveles, en este orden, parando en el primero con candidatas:
1. `found`: `fold(título)` igual y solape, exactamente 1, y `!suggested`.
2. `doubtful`: solape y (`fold(título)` igual con más de 1, o `suggested`, o base igual, o Dice ≥ 0,6, o Levenshtein dentro del umbral).
3. `similar`: base igual sin solape, o línea sin artista con base igual, o línea sin artista cuyo `fold(title)` es exactamente un artista de la colección con una sola pista.
4. `absent`.

- [ ] **Step 6: Verde**

Run: igual que Step 4. Expected: PASS, los tres sets con los números de la spec.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/types.ts apps/desktop/src/renderer/src/lib/tracklistMatch.ts apps/desktop/src/renderer/src/lib/tracklistMatch.test.ts apps/desktop/src/renderer/src/lib/fixtures/tracklistCollection.json
git commit -m "Match pasted tracklist lines against a DJ collection in four levels"
```

---

### Task 3: Elección del usuario y lista final

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/tracklistMatch.ts`
- Test: `apps/desktop/src/renderer/src/lib/tracklistMatch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReviewRow { match: TracklistMatch; picked: number; included: boolean }
  export function reviewRows(matches: TracklistMatch[]): ReviewRow[]
  export function chosenTracks(rows: ReviewRow[]): CollectionTrack[]
  ```
  `reviewRows` deja fuera `absent`; `included` es `true` en `found`/`doubtful` y `false` en `similar`; `picked` es 0. `chosenTracks` devuelve, en orden de fila, las candidatas `picked` de las filas `included`, sin repetir `contentId` (gana la primera).

- [ ] **Step 1: Test rojo**

- `reviewRows` sobre `[found, doubtful, similar, absent]` → 3 filas, `included` `[true, true, false]`.
- `chosenTracks` con dos filas que apuntan al mismo `contentId` → 1 pista, en la posición de la primera.
- Mismo caso con la primera fila `included: false` → 1 pista, la segunda (Review Focus 4).
- Fila `doubtful` con `picked: 1` → devuelve la segunda candidata.

- [ ] **Step 2: Rojo, Step 3: Implementar, Step 4: Verde**

Run: `cd apps/desktop && npm test -- src/renderer/src/lib/tracklistMatch.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -am "Keep the user's picks over tracklist matches and dedupe the tracks to add"
```

---

### Task 4: IPC de colección por programa

**Files:**
- Modify: `apps/desktop/src/main/rekordboxPlaylists.ts` (junto a `readRekordboxTrackCount`, línea 158)
- Modify: `apps/desktop/src/main/traktorPlaylists.ts` (junto a `readTraktorTrackCount`, línea 221)
- Modify: `apps/desktop/src/main/seratoLibrary.ts` (junto a `seratoTrackCount`, línea 144)
- Modify: `apps/desktop/src/main/rekordboxPlaylistsIpc.ts:92`, `traktorPlaylistsIpc.ts:27`, `seratoPlaylistsIpc.ts:23` (un `ipcMain.handle` al lado de `trackCount`)
- Modify: `apps/desktop/src/preload/index.ts` (junto a `rekordboxTrackCount` 233, `seratoTrackCount` 251, y el de Traktor) y `apps/desktop/src/preload/api.ts` (tipos, junto a `seratoTrackCount` 270)
- Modify: `apps/desktop/src/renderer/src/lib/sourcePrograms.ts` (`SourceRead` gana `collection?(): Promise<CollectionTrack[]>`, opcional; la definen rekordbox, Traktor y Serato, Engine no.)
- Tests: `apps/desktop/src/main/rekordboxPlaylists.test.ts`, `traktorPlaylists.test.ts`, `seratoLibrary.test.ts` (los que ya existen; añadir un `it` en cada uno con su fixture actual).

**Interfaces:**
- Produces:
  ```ts
  export function readRekordboxCollection(db: RekordboxDb): CollectionTrack[]
  export function readTraktorCollection(nml: string, bootVolume: string): CollectionTrack[]
  export function seratoCollection(library: SeratoLibrary): CollectionTrack[]
  // preload
  loadRekordboxCollection(): Promise<CollectionTrack[]>
  loadTraktorCollection(): Promise<CollectionTrack[]>
  loadSeratoCollection(): Promise<CollectionTrack[]>
  // sourcePrograms
  SOURCE_READ[p].collection?: () => Promise<CollectionTrack[]>
  ```
  `contentId` es el mismo que `SourcePlaylistEntry.contentId` de cada programa (rekordbox: `djmdContent.ID`; Traktor: `traktorContentId(key)`; Serato: `serato:${file}`), de modo que `PlaylistTrackRef { contentId, paths: [path] }` lo entiende el `add` de cada uno.

- [ ] **Step 1: Test rojo en los tres `.test.ts` del main**

Cada uno contra el fixture que ya usa ese fichero: afirmar `length` igual al `trackCount` del mismo fixture, y que una pista conocida del fixture sale con `title`, `artist` y `contentId` esperados.

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npm test -- src/main/rekordboxPlaylists.test.ts src/main/traktorPlaylists.test.ts src/main/seratoLibrary.test.ts`

- [ ] **Step 3: Implementar**

rekordbox: `SELECT c.ID AS contentId, c.FolderPath, c.Title, a.Name AS Artist FROM djmdContent c LEFT JOIN djmdArtist a ON a.ID = c.ArtistID WHERE ${ALL}`, `path` con la misma composición que usa `entryOf` en ese fichero. Traktor: `collection(nml)` filtrando separadores, `attr(head,'TITLE')`/`'ARTIST'`, `traktorFileOf`. Serato: `library.tracks.map`. IPC y preload copiando el patrón de `trackCount` de cada fichero (incluido `withCollection(path, ..., [], await keyOf(path))` en rekordbox y `read(fn, [])` en Traktor). Añadir `collection` a los tres `SOURCE_READ` editables.

- [ ] **Step 4: Verde + tsc**

Run: tests de Step 2 y `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS, sin errores.

- [ ] **Step 5: Commit**

```bash
git commit -am "Expose each DJ collection as title, artist and content id over IPC"
```

---

### Task 5: Item del menú en el árbol

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/SourceTree.tsx` (props `edit` líneas 78-84; menú líneas 566-590)
- Modify: `apps/desktop/src/renderer/src/i18n/locales/*.json` (`sources.tree.pasteTracklist`, `sources.tree.newPlaylistFromTracklist`)
- Test: `apps/desktop/src/renderer/src/components/SourceTree.test.tsx` (el `setup` de la línea 33 ya crea `edit`; añadir `onPasteTracklist: vi.fn()`)

**Interfaces:**
- Produces: `edit.onPasteTracklist?: (node: SourceNode, create: boolean) => void`, opcional para que `App` compile hasta la Tarea 7; sin ella el item no se pinta. `create` es `true` cuando el nodo es carpeta.
- Textos es: `"pasteTracklist": "Pegar tracklist…"`, `"newPlaylistFromTracklist": "Nueva playlist desde tracklist…"`. en: `"Paste tracklist…"`, `"New playlist from tracklist…"`. Los otros 4 locales, traducción directa.

- [ ] **Step 1: Test rojo**

- Clic derecho en `House` (playlist) con `editable` → `source-tree-paste-tracklist` visible, con texto «Pegar tracklist…» (el test usa `i18n` ya cargado en es); clic → `edit.onPasteTracklist` llamado con `(nodo House, false)`.
- Clic derecho en `BASES` (carpeta) → el mismo testid con texto «Nueva playlist desde tracklist…»; clic → `(nodo BASES, true)`.
- Un nodo `fixed` `'tracks-only'` (pasar `fixed={() => 'tracks-only'}`): hoy no abre menú (`menuEdit` es `undefined` si `fixedAs !== null`, línea 261). Decisión: abrir el menú en `tracks-only` SOLO con el item de pegar (sin Rename ni Delete). Test: clic derecho en `House` con `fixed={() => 'tracks-only'}` → aparece `source-tree-paste-tracklist` y NO `source-tree-rename` ni `source-tree-delete`. Con `'locked'` → no hay menú.
- El item va entre Rename y Delete, dentro del mismo `div` del menú, mismas clases que Rename.

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/SourceTree.test.tsx`

- [ ] **Step 3: Implementar**

En `row`: `menuEdit` pasa a ser `fixedAs === null ? nodeEdit : fixedAs === 'tracks-only' ? pasteOnly(nodeEdit) : undefined`, donde el menú sabe si está en modo «solo pegar» (un booleano en el estado `menu`). Botón nuevo `data-testid="source-tree-paste-tracklist"` que llama `edit.onPasteTracklist(menu.node, menu.node.kind === 'folder')` y cierra el menú.

- [ ] **Step 4: Verde + locales**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/SourceTree.test.tsx src/renderer/src/i18n/keys.test.ts src/renderer/src/i18n/usedKeys.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -am "Offer Paste tracklist in the playlist tree's context menu"
```

---

### Task 6: El modal

**Files:**
- Create: `apps/desktop/src/renderer/src/components/PasteTracklistModal.tsx`
- Test: `apps/desktop/src/renderer/src/components/PasteTracklistModal.test.tsx`
- Modify: locales (`pasteTracklist.*`)

**Interfaces:**
- Consumes: `parseTracklist`, `matchTracklist`, `reviewRows`, `chosenTracks`, `SOURCE_READ[program].collection`, `ModalShell` (`components/ModalShell.tsx`, mismo uso que `RenameModal.tsx:68`).
- Produces:
  ```ts
  interface Props {
    program: DjProgram
    node: SourceNode
    create: boolean
    onAdd: (tracks: PlaylistTrackRef[], newName: string | null) => void
    onClose: () => void
  }
  export function PasteTracklistModal(props: Props): React.JSX.Element
  ```
  `tracks` ya deduplicados y en orden; `newName` solo en `create`.

- [ ] **Step 1: Test rojo (jsdom, `window.api` mockeado con `vi.fn<Api['loadRekordboxCollection']>()`)**

testids: `paste-tracklist-text`, `paste-tracklist-name`, `paste-tracklist-count`, `paste-tracklist-search`, `paste-tracklist-row-<i>`, `paste-tracklist-accept-<i>`, `paste-tracklist-exclude-<i>`, `paste-tracklist-pick-<i>-<j>`, `paste-tracklist-summary`, `paste-tracklist-back`, `paste-tracklist-add`, `paste-tracklist-backdrop`.
- Pantalla 1: pegar set 1 → `paste-tracklist-count` dice «19 pistas, 2 huecos». Texto sin pistas → «0 pistas» y `paste-tracklist-search` deshabilitado (Review Focus 1). En `create`, `paste-tracklist-name` existe y vacío deja «Buscar» deshabilitado aunque haya pistas (Review Focus 5); sin `create`, no existe.
- Pantalla 2 (colección de 6 de la Tarea 2 por el mock, set 1 pegado): `paste-tracklist-summary` dice «2 encontradas, 2 dudosas, 1 parecida, 14 no están en la colección y se ignoran» (Because of You y Silent Tears encontradas; Head over heels y Real Love dudosas; Action parecida). Las filas `absent` no se pintan. La fila `similar` tiene `exclude` activo. Clic en `accept` de esa fila → `paste-tracklist-add` dice «Añadir N+1 pistas». Fila con 2 candidatas pinta `pick-i-0` y `pick-i-1`; clic en `pick-i-1` y `add` → `onAdd` recibe la segunda.
- `onAdd` recibe `PlaylistTrackRef[]` como `{ contentId, paths: [path] }` (paths `[]` si `path` es null), en orden del set, y `newName` con el nombre escrito en `create` (null si no).
- Mock que rechaza (`mockRejectedValue`) → `paste-tracklist-summary` existe con «0 encontradas» y `paste-tracklist-add` deshabilitado (Review Focus 2).
- `paste-tracklist-back` vuelve a la pantalla 1 conservando el texto.

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/PasteTracklistModal.test.tsx`

- [ ] **Step 3: Implementar**

Dos estados: `step: 'paste' | 'review'`. La colección se pide con `useQuery({ queryKey: ['source-collection', program], queryFn: SOURCE_READ[program].collection })` al pulsar Buscar (`enabled: step === 'review'`); el modal se envuelve en el `QueryClientProvider` que `App` ya tiene (en el test, crear uno). Diseño según el boceto: cabecera con título «Pegar tracklist en «{{name}}»» y la descripción; `textarea` mono; lista con tiempo en mono, punto de estado (verde `--color-good`, ámbar `--color-warn`, gris hueco con borde para parecida), línea pegada, candidata debajo con la parte entre paréntesis distinta en ámbar (`<em>` sobre el trozo que no coincide con el de la línea), botones `press rounded-full` «Aceptar»/«Fuera» como los chips de `RenameModal.tsx:96`, radios nativos para varias candidatas. Pie con el recuento y los dos botones con las clases de `RenameModal.tsx:115-123`.

Textos (es; los demás locales traducción directa):
```
"pasteTracklist": {
  "title": "Pegar tracklist en «{{name}}»",
  "titleNew": "Nueva playlist desde tracklist",
  "hint": "Una pista por línea. Vale con o sin tiempos, la descripción de YouTube o lo que saca tracklist.",
  "name": "Nombre de la playlist",
  "count_one": "{{count}} pista", "count_other": "{{count}} pistas",
  "gaps_one": "{{count}} hueco", "gaps_other": "{{count}} huecos",
  "search": "Buscar en {{program}}",
  "reviewHint": "{{have}} de {{total}} están. Las dudosas son otra mezcla u otro candidato y entran igual, salvo que las saques. Las parecidas tienen el título pero otro artista y van fuera, salvo que las cojas.",
  "found_one": "{{count}} encontrada", "found_other": "{{count}} encontradas",
  "doubtful_one": "{{count}} dudosa", "doubtful_other": "{{count}} dudosas",
  "similar_one": "{{count}} parecida", "similar_other": "{{count}} parecidas",
  "absent_one": "{{count}} no está en la colección y se ignora", "absent_other": "{{count}} no están en la colección y se ignoran",
  "willAdd": "se añade", "accept": "Aceptar", "exclude": "Fuera",
  "otherArtist": "mismo título, otro artista", "suggestedMark": "(?) en el tracklist",
  "summary_one": "Se añadirá {{count}} pista a «{{name}}»", "summary_other": "Se añadirán {{count}} pistas a «{{name}}»",
  "back": "Atrás", "add_one": "Añadir {{count}} pista", "add_other": "Añadir {{count}} pistas",
  "loading": "Buscando en la colección…", "failed": "No se pudo leer la colección"
}
```
`{{program}}` es `tr('sources.' + program)`, que ya existe. Plural `_one`/`_other` como el resto del fichero (ojo: `count 0` va a `_other`).

- [ ] **Step 4: Verde + locales + tsc**

Run: `cd apps/desktop && npm test -- src/renderer/src/components/PasteTracklistModal.test.tsx src/renderer/src/i18n && npx tsc --noEmit -p tsconfig.web.json`

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src/renderer/src/components/PasteTracklistModal.tsx apps/desktop/src/renderer/src/components/PasteTracklistModal.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Add the Paste tracklist modal with its paste and review steps"
```

---

### Task 7: Cablear en App

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (`treeEdit` ~2746; render de `SourceTree` ~3502; junto a los otros modales en `ModalExit`)
- Test: `apps/desktop/src/renderer/src/App.test.tsx` (seguir el patrón de los tests que abren el menú del árbol y mockean `editRekordboxPlaylist`)

**Interfaces:**
- Consumes: `editRekordbox` (línea 850), `PasteTracklistModal`, `treeEdit`.

- [ ] **Step 1: Test rojo**

- Con rekordbox como fuente y árbol cargado: clic derecho en una playlist → `source-tree-paste-tracklist` → modal `paste-tracklist-text` visible. Pegar una línea que el mock de colección encuentra → Buscar → Añadir → `window.api.editRekordboxPlaylist` llamado con `{ kind: 'add', playlistId: <id>, tracks: [{ contentId, paths }] }` y el modal cerrado.
- Variante carpeta: `editRekordboxPlaylist` llamado primero con `{ kind: 'create', parentId: <carpeta>, name: 'Mi set', folder: false }` (mock devuelve `{ applied: true, createdId: 'nuevo' }`) y luego con `{ kind: 'add', playlistId: 'nuevo', ... }`.
- Si el `create` devuelve `applied: false`, no se llama al `add`.

- [ ] **Step 2: Rojo**

Run: `cd apps/desktop && npm test -- src/renderer/src/App.test.tsx -t "tracklist"`

- [ ] **Step 3: Implementar**

Estado `pasteTracklist: { node: SourceNode; create: boolean } | null`. `treeEdit.onPasteTracklist = (node, create) => setPasteTracklist({ node, create })`. `onAdd`:
```ts
async (tracks, newName) => {
  let playlistId = node.id, name = node.name
  if (create) {
    const created = await editRekordbox({ kind: 'create', parentId: node.id, name: newName!, folder: false }, newName!)
    if (!created.applied || !created.createdId) return
    playlistId = created.createdId; name = newName!
  }
  await editRekordbox({ kind: 'add', playlistId, tracks }, name)
}
```
Cerrar el modal al lanzar (la escritura ya avisa por `notify`). El modal va dentro de `ModalExit` con `program={editableSource}` (solo se abre si `editableSource` no es null, que es cuando `treeEdit` existe).

- [ ] **Step 4: Verde completo**

Run: `cd apps/desktop && npm test && npm run lint && npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: toda la suite verde, sin avisos.

- [ ] **Step 5: Commit**

```bash
git commit -am "Paste a tracklist into a playlist or a new playlist from the tree"
```

---

### Task 8: Comprobación en la app real

- [ ] Con el skill `run` (driver de Surco), abrir la pestaña rekordbox, botón derecho en una playlist de prueba, pegar `set3-xtv-remember.txt`, comprobar el recuento 9 / 19 / 3 / 0 contra la colección real, aceptar las 3 parecidas, Añadir 30, y verificar en rekordbox (o releyendo la playlist en Surco) que las 30 están en el orden del set.
- [ ] Captura de las dos pantallas para el changelog.
- [ ] Anotar en la memoria del proyecto el resultado real.
