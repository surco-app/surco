# Sesión automática Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un asistente de cuatro pasos que monta una playlist de sesión a partir de las playlists del usuario, mezclando combos sacados de playlists Set, pistas sueltas por tono, BPM y gusto, y pistas nuevas.

**Architecture:** Un núcleo puro en `src/shared/` (Camelot, combos, montaje) sin disco ni Electron, probado entero. Encima, un ajuste de Surco con el papel de cada playlist, un lector de filas con caché, y la UI en el renderer: modal de cuatro pasos, banda y líneas de por qué. La escritura reutiliza `editRekordbox` (`create`, `add`, `delete`), que ya despacha por programa.

**Tech Stack:** TypeScript, React 19, Vitest, Biome, i18next (6 idiomas), Electron.

**Spec:** `docs/superpowers/specs/2026-11-09-sesion-automatica-design.md`

## Global Constraints

- Cero comentarios en el código nuevo.
- TDD con fase roja visible: cada test se ve fallar antes de implementar.
- Selectores en tests: `data-testid` en kebab-case con prefijo del componente (`session-wizard-…`, `session-band-…`).
- Un commit por funcionalidad, título descriptivo en inglés, sin cuerpo y sin `feat:`/`fix:`. Nunca `--no-verify`.
- Tests desde `apps/desktop` con `npx vitest run <ruta>`; nunca desde la raíz.
- Tipos con `npx tsc --noEmit -p tsconfig.web.json` y `npx tsc --noEmit -p tsconfig.node.json` (el `tsc` pelado no comprueba nada). Lint con `npm run lint`.
- Texto de la UI sin guion largo ni dos puntos de explicación. Cada string nuevo va en los seis `locales/*.json`; `i18n/keys.test.ts` debe seguir verde.
- Programas de la primera entrega: rekordbox, Traktor y Serato. Engine y Music no muestran el item. El item no sale en fuentes USB ni en nodos bloqueados (misma regla que «Pegar tracklist…»).
- Mezcla armónica de serie en Libre. Alternancia de serie sí. Porcentaje de nuevas de serie 15, máximo 40. Tolerancia de BPM ±4, relajada a ±8 con aviso.
- Sin duración de una pista se supone 6 minutos y se avisa. El `why` de una pista solo dice «combo» con pares contiguos reales contados una vez por playlist Set.
- Playlist resultante: «Sesión del d/m». Rehacer y Ajustar crean la nueva y solo después borran la anterior.

## Review Focus

- Playlist Set vacía o de una sola pista: no produce combos y no rompe nada (Task 2).
- Pista sin tono, sin BPM y sin duración a la vez: entra por último recurso, el resumen avisa y no se cuenta como armónica (Task 3).
- Menos pistas elegibles que minutos pedidos: la sesión acaba antes y lo dice (Task 3).
- La misma pista en una playlist de bases y en otra de cantaditas: pasa a «De todo» y no alterna (Task 4).
- rekordbox abierto al montar o al rehacer: la escritura se rechaza, el asistente sigue abierto y la playlist anterior queda intacta (Task 10).
- Ruta con acentos en distinto estado Unicode en Traktor: es la misma pista tras normalizar NFC (Task 5).

---

## File Structure

Núcleo puro (`src/shared/`):
- `camelot.ts`: pasar un tono escrito de cualquier forma a Camelot y medir la distancia entre dos.
- `sessionCombos.ts`: contar pares contiguos de playlists Set.
- `sessionBuild.ts`: el montaje de la sesión y su resumen.
- `sessionTypes.ts`: tipos compartidos del núcleo y del renderer.

Ajustes y datos:
- `src/shared/types.ts`, `src/main/settings.ts`, `src/renderer/src/lib/settingsContext.tsx`: `sessionRoles` y `sessionWizard`.
- `src/main/rekordboxPlaylists.ts`: `playCount` y duración en las filas.
- `src/renderer/src/lib/sessionCandidates.ts`: fila de playlist a pista candidata.
- `src/renderer/src/hooks/useSessionRows.ts`: carga de filas con caché.

UI (`src/renderer/src/components/`):
- `PlaylistRolePicker.tsx`: el selector de cuatro valores, usado en el asistente y en el menú del árbol.
- `SessionWizard.tsx` y `SessionWizardSteps.tsx`: el modal y sus cuatro pantallas.
- `SessionBand.tsx`: la banda de arriba de la lista.
- `SessionWhyLine.tsx`: la línea de por qué entre filas.
- Cambios en `SourceTree.tsx` (letra de papel y menú), `App.tsx` (estado y escritura), `lib/commands.ts` (paleta).

---

### Task 1: Camelot

**Files:**
- Create: `apps/desktop/src/shared/camelot.ts`
- Test: `apps/desktop/src/shared/camelot.test.ts`

**Interfaces:**
- Produces: `camelotOf(key: string | undefined): string | null` y `camelotDistance(a: string | null, b: string | null): number | null`.

- [ ] **Step 1: Write the failing test** `camelot.test.ts`
  - `camelotOf('8A')` es `'8A'`; `camelotOf('08b')` es `'8B'`; `camelotOf('Am')` es `'8A'`; `camelotOf('C')` es `'8B'`; `camelotOf('F#')` es `'2B'`; `camelotOf('Ebm')` es `'2A'`; `camelotOf('')`, `camelotOf(undefined)` y `camelotOf('xyz')` son `null`.
  - `camelotDistance('8A','8A')` es 0; `('8A','8B')` es 1; `('8A','9A')` es 1; `('8A','7A')` es 1; `('12A','1A')` es 1 (la rueda es circular); `('8A','10A')` es mayor que 1; `('8A','9B')` es mayor que 1; cualquier lado `null` da `null`.
- [ ] **Step 2: Run** `npx vitest run src/shared/camelot.test.ts`. Expected: FAIL, módulo inexistente.
- [ ] **Step 3: Implement** ambas funciones en `camelot.ts`, apoyadas en `MAJOR_NAMES`, `MINOR_NAMES`, `MAJOR_CAMELOT` y `MINOR_CAMELOT` de `keyNames.ts`. La distancia es 0, 1 o `2 + saltos de número + cambio de letra`.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `Add Camelot key parsing and distance`

### Task 2: Combos de playlists Set

**Files:**
- Create: `apps/desktop/src/shared/sessionTypes.ts`, `apps/desktop/src/shared/sessionCombos.ts`
- Test: `apps/desktop/src/shared/sessionCombos.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces en `sessionTypes.ts`: `PlaylistRole = 'base' | 'vocal' | 'any' | 'set'`, `TrackRole = 'base' | 'vocal' | 'any'`, `SessionTrack { id: string; role: TrackRole; key: string | null; bpm: number; rating: number; plays: number; secs: number; fresh: boolean; title: string; artist: string }`.
- Produces en `sessionCombos.ts`: `type Combos = ReadonlyMap<string, ReadonlyMap<string, number>>` (de `a` a `b` con la fuerza) y `mineCombos(sets: readonly (readonly string[])[], pool: ReadonlySet<string>): Combos`.

- [ ] **Step 1: Write the failing test**
  - Un par `a→b` en dos Sets distintos tiene fuerza 2; el mismo par dos veces dentro de un solo Set suma 1.
  - `b→a` no existe cuando solo se vio `a→b` (dirigido).
  - Un par con una pista fuera del `pool` no cuenta.
  - Set vacío y Set de una pista: sin combos, sin error.
  - Pares de una pista consigo misma (`a→a`) se ignoran.
  - Cadena: de `[a,b,c]` salen `a→b` y `b→c`, cada uno con fuerza 1.
  - Caso real: Set con `['absolom-secret','the-bass-here-we-go','crush-jellyhead']` da esa cadena de fuerza 1.
- [ ] **Step 2: Run** `npx vitest run src/shared/sessionCombos.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `mineCombos`. Un `Set<string>` de pares por playlist para contar una sola vez.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Count repeated track pairs from Set playlists`

### Task 3: Montaje, núcleo (combos, gusto, armonía, BPM, duración)

**Files:**
- Create: `apps/desktop/src/shared/sessionBuild.ts`
- Test: `apps/desktop/src/shared/sessionBuild.test.ts`

**Interfaces:**
- Consumes: `SessionTrack`, `Combos`, `camelotDistance`.
- Produces: `SessionOptions { minutes: number; preferCombos: boolean; harmony: 'free' | 'neighbours' | 'same'; tasteWeight: boolean; alternate: boolean; freshShare: number; surprise: boolean; seed: number }`, `SessionWhy = { kind: 'start' } | { kind: 'combo'; sets: number } | { kind: 'harmonic'; from: string; to: string; distance: number } | { kind: 'taste'; plays: number; rating: number } | { kind: 'bpm'; relaxed: boolean } | { kind: 'fresh'; key: string | null; role: TrackRole }`, `SessionItem { track: SessionTrack; why: SessionWhy }`, `SessionSummary { secs: number; tracks: number; combos: number; fresh: number; harmonic: number; withKey: number; shortBySecs: number; missingDurations: number }`, `SessionPlan { items: SessionItem[]; summary: SessionSummary }`, `buildSession(pool: readonly SessionTrack[], combos: Combos, options: SessionOptions): SessionPlan`.

- [ ] **Step 1: Write the failing tests**
  - Arranca por la pista con el combo más fuerte; sin combos, arranca por una determinada por la semilla.
  - Con `preferCombos` toma `a→b` cuando existe y no está usada; sin él, lo ignora.
  - Nunca repite una pista y nunca supera los minutos por más de una pista.
  - Con `harmony: 'neighbours'` ninguna transición entre pistas con tono tiene distancia mayor que 1; con `'same'` solo 0; con `'free'` no filtra.
  - Una pista sin tono se coloca por BPM ±4 y no cuenta en `harmonic` ni en `withKey`.
  - Mismo `pool`, `combos`, `options` y semilla dan exactamente la misma lista; otra semilla da otra.
  - Con `tasteWeight`, entre dos candidatas equivalentes gana la de más estrellas, y a igualdad la de más escuchas; con estrellas 0 en todas, las escuchas deciden.
  - Menos pistas que minutos: `shortBySecs` es mayor que 0 y la lista no se alarga.
  - Pistas sin `secs`: se cuentan como 360 s y `missingDurations` las cuenta.
  - Sin candidatas dentro de ±4 se relaja a ±8 con `why: { kind: 'bpm', relaxed: true }`.
- [ ] **Step 2: Run** `npx vitest run src/shared/sessionBuild.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildSession`. Generador pseudoaleatorio con semilla pequeño y local (por ejemplo mulberry32) en el mismo fichero. Gusto: `rating/100` mayor peso que `plays` normalizado por el máximo del conjunto.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Build a session from combos, taste and harmonic fit`

### Task 4: Montaje, alternancia, nuevas y sorpresa

**Files:**
- Modify: `apps/desktop/src/shared/sessionBuild.ts`
- Test: `apps/desktop/src/shared/sessionBuild.test.ts`

**Interfaces:**
- Consumes: lo de Task 3.
- Produces: el mismo `buildSession`, con `alternate`, `freshShare` y `surprise` activos.

- [ ] **Step 1: Write the failing tests**
  - Con `alternate`, entre pistas `base` y `vocal` nunca van dos del mismo rol seguidas; una `any` no rompe la alternancia ni cambia cuál toca después (después de `base`, `any`, la siguiente es `vocal`).
  - Un combo disponible gana sobre alternar solo cuando respeta la alternancia; uno que la rompe se salta.
  - Con `freshShare: 0.15` y 20 pistas, entran entre 1 y 4 nuevas, ninguna primera ni última; con `0`, ninguna.
  - Un combo disponible en el hueco de una nueva gana y la nueva se aplaza al siguiente hueco.
  - Una pista `fresh` encaja por tono y rol igual que una normal; `summary.fresh` las cuenta.
  - Con `surprise`, al menos una transición de la sesión no tiene combo previo cuando hay candidatas sin él.
  - La misma pista en bases y en cantaditas llega al núcleo como `any` (ver Task 5, no aquí).
- [ ] **Step 2: Run.** Expected: FAIL en los casos nuevos, PASS en los de Task 3.
- [ ] **Step 3: Implement** reparto de nuevas por posiciones objetivo equiespaciadas, aplazables.
- [ ] **Step 4: Run** `npx vitest run src/shared/sessionBuild.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `Alternate base and vocal tracks and place new tracks in sessions`

### Task 5: De fila de playlist a pista candidata

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/sessionCandidates.ts`
- Test: `apps/desktop/src/renderer/src/lib/sessionCandidates.test.ts`

**Interfaces:**
- Consumes: `SourcePlaylistEntry`, `camelotOf`, `PlaylistRole`, `SessionTrack`.
- Produces: `trackIdOf(entry: SourcePlaylistEntry): string | null` (el `contentId` o, si no, la ruta en NFC; `null` si no hay ninguno o es separador) y `toCandidates(sources: readonly { role: PlaylistRole | 'fresh'; entries: readonly SourcePlaylistEntry[] }[]): SessionTrack[]` y `setSequences(sources): string[][]` (los ids en orden de cada playlist `set`).

- [ ] **Step 1: Write the failing tests**
  - Dos rutas iguales en NFC y NFD dan el mismo id; con `contentId` manda el `contentId`.
  - Separadores y filas sin ruta ni `contentId` se descartan.
  - Una pista en una playlist `base` y en una `vocal` sale con rol `any`; en `base` y `any`, `base`.
  - Una pista en una `fresh` y en una de origen no es `fresh`.
  - Una playlist `set` aporta sus pistas con rol `any` y su orden en `setSequences`.
  - `meta.key` `'Am'` pasa a `'8A'`; vacío pasa a `null`; `meta.bpm` `'138.07'` pasa a 138.07; `'x'` a 0; `rating` y `playCount` ausentes a 0; `preview.durationSec` ausente a 0.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/sessionCandidates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** las tres funciones; el rol de una pista en varias playlists se decide con una tabla de resolución (`base`+`vocal` es `any`, uno concreto gana a `any`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Turn playlist rows into session candidates`

### Task 6: Papel de cada playlist en los ajustes

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`, `apps/desktop/src/main/settings.ts`, `apps/desktop/src/renderer/src/lib/settingsContext.tsx`
- Test: `apps/desktop/src/main/settings.test.ts` (o el fichero de pruebas de ajustes que exista; buscarlo antes)

**Interfaces:**
- Produces: `Settings.sessionRoles: Record<string, PlaylistRole>`, `Settings.sessionWizard: { minutes: number; freshShare: number; preferCombos: boolean; harmony: 'free' | 'neighbours' | 'same'; tasteWeight: boolean; alternate: boolean; surprise: boolean }`, `sessionRoleKey(program: DjProgram, playlistId: string): string` en `shared/sessionTypes.ts`, y `normalizeSessionRoles(raw: unknown): Record<string, PlaylistRole>` junto a la normalización de `hiddenSources`.

- [ ] **Step 1: Write the failing tests**
  - Un ajuste viejo sin `sessionRoles` se lee como `{}` y sin `sessionWizard` con los valores de serie (90 min, 15 %, `preferCombos` true, `harmony` `'free'`, `tasteWeight` true, `alternate` true, `surprise` false).
  - `normalizeSessionRoles` tira claves sin `programa:id` válido y valores que no son uno de los cuatro papeles, y conserva el resto.
  - `freshShare` fuera de 0 a 0.4 se recorta; `minutes` no positivo vuelve a 90.
  - `sessionRoleKey('rekordbox', '12')` es `'rekordbox:12'`.
- [ ] **Step 2: Run** el test de ajustes. Expected: FAIL.
- [ ] **Step 3: Implement** tipos, valores por defecto y normalización siguiendo cómo `hiddenSources` se declara en `types.ts`, se normaliza en `settings.ts` y se expone en `settingsContext.tsx`.
- [ ] **Step 4: Run** el test de ajustes más `npx vitest run src/shared`. Expected: PASS.
- [ ] **Step 5: Commit** `Remember the role of each playlist for sessions`

### Task 7: Escuchas y duración en las filas de rekordbox

**Files:**
- Modify: `apps/desktop/src/shared/types.ts` (`AppleMusicTrackMeta`), `apps/desktop/src/main/rekordboxPlaylists.ts`
- Test: `apps/desktop/src/main/rekordboxPlaylists.test.ts`

**Interfaces:**
- Produces: `AppleMusicTrackMeta.playCount?: number`, rellenado solo por rekordbox con `DJPlayCount` cuando es mayor que 0; y la duración en `preview.durationSec` si hoy no llega de `Length`.

- [ ] **Step 1: Write the failing test**: una fila con `DJPlayCount` 41 sale con `meta.playCount` 41; con 0 o nulo, sin el campo; `Length` de 342 sale como `durationSec` 342.
- [ ] **Step 2: Run** `npx vitest run src/main/rekordboxPlaylists.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** añadiendo `c.DJPlayCount` y `c.Length` a la consulta de entradas y a `metaOf`/`preview`, sin tocar lo demás.
- [ ] **Step 4: Run** el test y `npx vitest run src/main`. Expected: PASS.
- [ ] **Step 5: Commit** `Read play counts and durations for rekordbox playlist rows`

### Task 8: Carga de filas con caché

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useSessionRows.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useSessionRows.test.tsx`

**Interfaces:**
- Consumes: `SOURCE_READ[program].playlist(id)`, `SourcePlaylistEntry`.
- Produces: `useSessionRows(program: DjProgram): { load(ids: readonly string[]): Promise<ReadonlyMap<string, readonly SourcePlaylistEntry[]>>; loading: boolean; failed: readonly string[] }`.

- [ ] **Step 1: Write the failing tests** con `test/api.ts`: dos llamadas a `load` con la misma playlist leen una sola vez; ids distintos leen cada uno; una lectura que falla deja el id en `failed` y no tumba a las demás; `loading` es true mientras hay lecturas en curso.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/hooks/useSessionRows.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** compartiendo la promesa en vuelo por id (la caché de sesión sola no basta con montajes simultáneos).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Load the rows of chosen playlists once per wizard`

### Task 9: Selector de papel y letra en el árbol

**Files:**
- Create: `apps/desktop/src/renderer/src/components/PlaylistRolePicker.tsx`
- Modify: `apps/desktop/src/renderer/src/components/SourceTree.tsx`, `apps/desktop/src/renderer/src/App.tsx`, los seis `locales/*.json`
- Test: `PlaylistRolePicker.test.tsx`, `SourceTree.test.tsx`

**Interfaces:**
- Produces: `PlaylistRolePicker({ value: PlaylistRole | null; onChange(role: PlaylistRole | null): void; testIdPrefix: string })` con cuatro botones (`Bases`, `Cantaditas`, `De todo`, `Set`) y el activo repetido quita el papel; en `SourceTree`, prop opcional `roles?: Record<string, PlaylistRole>` y `onRole?(node: SourceNode, role: PlaylistRole | null): void`.

- [ ] **Step 1: Write the failing tests**: el selector marca el valor actual con `aria-pressed`, llama a `onChange` con el elegido y con `null` al pulsar el activo; el árbol muestra B, C, D o S junto a una playlist con papel (`data-testid="source-tree-role-<id>"`) y nada en una sin él; el menú contextual de una playlist trae «Papel para sesiones» con el selector y llama a `onRole`; en una carpeta el item no sale.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/PlaylistRolePicker.test.tsx src/renderer/src/components/SourceTree.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** componente y cableado; `App.tsx` pasa `settings.sessionRoles` y guarda con la clave de `sessionRoleKey`.
- [ ] **Step 4: Run** esos tests y `npx vitest run src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit** `Mark playlists as bases, vocals, mixed or sets from the tree`

### Task 10: Escritura de la sesión en el programa

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useSessionWrite.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useSessionWrite.test.tsx`

**Interfaces:**
- Consumes: `editRekordbox` (la función de `useRekordboxEdits`), `PlaylistTrackRef`.
- Produces: `useSessionWrite(edit: typeof editRekordbox)` con `create(parentId: string, name: string, tracks: PlaylistTrackRef[]): Promise<string | null>` (devuelve el id creado) y `replace(parentId: string, oldId: string, name: string, tracks: PlaylistTrackRef[]): Promise<string | null>` (crea y rellena la nueva y solo después borra la anterior).

- [ ] **Step 1: Write the failing tests**
  - `create` llama a `create` y luego a `add` con las pistas en orden y devuelve el `createdId`; si `create` no se aplica, no llama a `add` y devuelve `null`.
  - `replace` no llama a `delete` si `create` o `add` no se aplicaron, y la playlist anterior queda intacta (rekordbox abierto).
  - `replace` borra la anterior solo tras un `add` aplicado y devuelve el id nuevo.
  - Ninguna función escribe nada antes de ser llamada.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/hooks/useSessionWrite.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** reutilizando el mismo patrón de `addPastedTracklist` en `App.tsx`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Create and replace session playlists without leaving half-written ones`

### Task 11: Asistente, pasos 1 y 2

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SessionWizard.tsx`, `SessionWizardSteps.tsx`
- Modify: los seis `locales/*.json`
- Test: `SessionWizard.test.tsx`

**Interfaces:**
- Consumes: `PlaylistRolePicker`, `SourceNode`, `Settings.sessionRoles`, `Settings.sessionWizard`.
- Produces: `SessionWizard({ program: DjProgram; tree: readonly SourceNode[]; roles: Record<string, PlaylistRole>; initial: SessionAnswers; onRole(id: string, role: PlaylistRole | null): void; onClose(): void; onBuild(answers: SessionAnswers): void })` y `SessionAnswers { minutes: number; sources: string[]; fresh: string[]; freshShare: number; preferCombos: boolean; harmony: SessionOptions['harmony']; tasteWeight: boolean; alternate: boolean; surprise: boolean }`. Dentro de `ModalShell`, con puntos de progreso y encabezado enfocado en cada paso, como `OnboardingWizard`.

- [ ] **Step 1: Write the failing tests**
  - Paso 1: los cinco valores (`60`, `90`, `120`, `180`, «Otra») marcan duración; «Otra» abre un campo en minutos y solo acepta enteros positivos.
  - Paso 2: escribir «mak» lista las playlists cuyo nombre lo contiene (sin distinguir mayúsculas ni acentos) con su número de pistas; elegir el papel en una coincidencia la añade al grupo correspondiente como chip y llama a `onRole`; la × la quita; «Siguiente» está deshabilitado sin ninguna playlist de origen.
  - Una playlist ya marcada en el árbol aparece directamente en su grupo al abrir.
  - Escape y la ✕ llaman a `onClose` sin llamar a `onBuild`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/SessionWizard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** shell, pasos 1 y 2 y los textos de los seis idiomas.
- [ ] **Step 4: Run** el test y `npx vitest run src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit** `Add the session wizard with duration and source playlists`

### Task 12: Asistente, pasos 3 y 4 y montaje

**Files:**
- Modify: `SessionWizard.tsx`, `SessionWizardSteps.tsx`, los seis `locales/*.json`
- Test: `SessionWizard.test.tsx`

**Interfaces:**
- Consumes: `useSessionRows`, `toCandidates`, `setSequences`, `mineCombos`, `buildSession`.
- Produces: el asistente completo; `onBuild` recibe `SessionAnswers` ya validadas. El cálculo de la sesión vive fuera (Task 13).

- [ ] **Step 1: Write the failing tests**
  - Paso 3: elegir playlists de nuevas y mover el porcentaje (0 a 40) actualiza las respuestas; saltarse el paso deja `fresh` vacío y `freshShare` 0.
  - Al pulsar «Siguiente» en los pasos 2 y 3 se llama a la carga de filas y el botón muestra el estado de carga; una playlist cuyo cargado falla se avisa una vez y no bloquea.
  - Paso 4: si ninguna fila cargada trae tono, «Mezcla armónica» queda deshabilitada con la línea que lo explica; si hay tonos, las tres opciones se eligen; los cinco interruptores reflejan y cambian las respuestas, con los valores de `Settings.sessionWizard` como inicio.
  - «Montar sesión» es el único botón que llama a `onBuild`, una sola vez, con las respuestas completas.
- [ ] **Step 2: Run.** Expected: FAIL en los casos nuevos.
- [ ] **Step 3: Implement** pasos 3 y 4 y la guardia de carga; guardar las respuestas en `Settings.sessionWizard` al montar.
- [ ] **Step 4: Run** `npx vitest run src/renderer/src/components/SessionWizard.test.tsx src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit** `Finish the session wizard with new tracks and character`

### Task 13: Montar, banda, Rehacer y Ajustar

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SessionBand.tsx`, `apps/desktop/src/renderer/src/lib/sessionRun.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`, los seis `locales/*.json`
- Test: `SessionBand.test.tsx`, `sessionRun.test.ts`

**Interfaces:**
- Consumes: Tasks 2 a 12.
- Produces: `runSession(input: { answers: SessionAnswers; roles: Record<string, PlaylistRole>; rows: ReadonlyMap<string, readonly SourcePlaylistEntry[]>; roleOf(id: string): PlaylistRole | null; seed: number }): { plan: SessionPlan; refs: PlaylistTrackRef[] }` y `SessionBand({ plan: SessionPlan; onRedo(): void; onAdjust(): void; onKeep(): void; busy: boolean })`. Estado de la sesión reciente en `App.tsx`: `{ playlistId: string; parentId: string; answers: SessionAnswers; seed: number; plan: SessionPlan }`.

- [ ] **Step 1: Write the failing tests**
  - `runSession` reparte las filas por papel, mina los combos de las playlists `set`, construye con la semilla y devuelve las referencias en el orden de la sesión con su `contentId` o ruta.
  - La banda muestra duración, pistas, combos, nuevas y «N/M armónicas»; sus tres botones llaman a `onRedo`, `onAdjust` y `onKeep`; con `busy` están deshabilitados; si `shortBySecs` es mayor que 0 muestra «Solo hay pistas para N min».
  - Rehacer cambia la semilla y llama a `replace` con el mismo nombre; Ajustar reabre el asistente con las respuestas puestas y al montar sustituye; Quedármela así quita la banda y no escribe.
  - Cualquier edición del usuario sobre esa playlist (añadir, quitar, mover, renombrar) quita la banda; Rehacer deja de ofrecerse.
  - Si `replace` devuelve `null` (rekordbox abierto) la banda y la playlist siguen como estaban y se avisa.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/SessionBand.test.tsx src/renderer/src/lib/sessionRun.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `runSession`, la banda y el cableado en `App.tsx`: abrir la playlist creada y recordar el estado reciente; el nombre es «Sesión del d/m» con la fecha del día.
- [ ] **Step 4: Run** esos tests y `npx vitest run src/renderer/src/App.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `Show the session band with redo, adjust and keep`

### Task 14: Línea de por qué y Cambiar

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SessionWhyLine.tsx`, `apps/desktop/src/renderer/src/lib/sessionAlternatives.ts`
- Modify: la fila de playlist de fuente en la lista (buscar el componente que pinta `SourcePlaylistEntry`), los seis `locales/*.json`
- Test: `SessionWhyLine.test.tsx`, `sessionAlternatives.test.ts`

**Interfaces:**
- Produces: `SessionWhyLine({ why: SessionWhy; selected: boolean; onChange?(): void })` y `alternativesFor(plan: SessionPlan, index: number, pool: readonly SessionTrack[], combos: Combos, options: SessionOptions): SessionTrack[]` (hasta 5 pistas que encajan igual en esa posición, sin repetir ninguna ya usada).

- [ ] **Step 1: Write the failing tests**
  - Cada `kind` pinta su frase: combo con «N sets», harmonic con `8A → 8B, vecino` o `misma rueda` según la distancia, fresh con tono y rol, taste con escuchas, bpm con aviso si `relaxed`.
  - «Cambiar» solo aparece en la fila seleccionada y abre las alternativas; elegir una sustituye la pista y recalcula el resumen sin tocar las demás.
  - `alternativesFor` respeta rol, armonía y BPM de los vecinos de esa posición y no devuelve pistas ya usadas.
  - Sin banda (sesión ya «quedada» o playlist normal) no se pinta ninguna línea.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** la línea y las alternativas; sustituir una pista en el programa usa el mismo reemplazo de Task 10.
- [ ] **Step 4: Run** los tests nuevos y `npx vitest run src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit** `Explain why each session track is there and offer swaps`

### Task 15: Entradas al asistente

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/commands.ts`, `SourceTree.tsx`, `App.tsx`, `lib/sourcePrograms.ts` (solo si hace falta un indicador), los seis `locales/*.json`
- Test: `commands.test.ts`, `SourceTree.test.tsx`

**Interfaces:**
- Produces: comando de paleta `session.new` («Sesión automática…») y `onSession?(node: SourceNode | null): void` en el menú de carpeta de `SourceTree`.

- [ ] **Step 1: Write the failing tests**
  - El comando existe, está habilitado con rekordbox, Traktor o Serato abiertos en la fuente principal, y deshabilitado en Engine, Music, sin fuente y en USB.
  - El menú de una carpeta trae «Sesión automática…» (`data-testid="source-tree-session"`) y llama a `onSession` con ese nodo; en una playlist y en una carpeta bloqueada de Traktor no sale.
  - Abrir desde la paleta crea la playlist en la raíz; desde la carpeta, dentro de ella.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/commands.test.ts src/renderer/src/components/SourceTree.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** comando y entrada del menú con la misma regla que «Pegar tracklist…» sobre carpeta.
- [ ] **Step 4: Run** esos tests, `npx vitest run src/i18n` y el conjunto completo `npx vitest run`. Expected: PASS todos, nada saltado.
- [ ] **Step 5: Commit** `Open the session wizard from the command palette and folders`

### Task 16: Comprobación en la app real

**Files:**
- Ninguno de producto. Capturas en el scratchpad.

- [ ] **Step 1:** Cierre de calidad: `npx tsc --noEmit -p tsconfig.web.json`, `npx tsc --noEmit -p tsconfig.node.json`, `npm run lint` y `npx vitest run`. Expected: sin errores, sin tests saltados.
- [ ] **Step 2:** Con el skill `run-desktop`, arrancar Surco desde este worktree (el binario sale del `out/` del árbol desde el que se lanza) contra los datos reales con rekordbox cerrado.
- [ ] **Step 3:** Marcar «Bases 90» como bases, «Cantaditas 90» como cantaditas, «COMBOS» como Set y una playlist de nuevas; montar 90 min con los valores de serie. Expected: playlist «Sesión del d/m» en rekordbox con 14 a 24 pistas, banda con combos, líneas de por qué, y Rehacer sustituye sin dejar una playlist vacía.
- [ ] **Step 4:** Con rekordbox abierto, montar otra vez. Expected: el asistente avisa, no escribe y la anterior sigue intacta.
- [ ] **Step 5:** Capturas de la modal (pasos 2 y 4) y de la banda. Reportar lo que se comprobó y lo que no.

## Self-Review

- **Spec coverage:** pasos 1 a 4 (Tasks 11 y 12), papeles y letra en el árbol (6 y 9), combos solo de Set (2 y 5), Camelot libre/vecinos/mismo (1 y 3), alternancia con «De todo» neutro (4 y 5), nuevas con proporción y aplazamiento (4), sorpréndeme (4), banda con Rehacer, Ajustar y Quedármela (13), por qué y Cambiar (14), crear-y-luego-borrar (10), banda que se quita al editar (13), escuchas solo rekordbox (7), USB y nodos bloqueados (15), identidad por `contentId` o NFC (5), carga con caché (8). Sin huecos.
- **Consistencia de tipos:** `PlaylistRole`, `TrackRole`, `SessionTrack`, `Combos`, `SessionOptions`, `SessionPlan` y `SessionAnswers` se definen una vez (Tasks 2, 3 y 11) y se usan con los mismos nombres después. `sessionRoleKey` en Task 6, usado en 9.
- **Proporción:** el plan es de longitud parecida al diseño y no lleva cuerpos de función; solo firmas, nombres de tests y sus aserciones.
