# Buscar en Ajustes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Search settings" field atop the Settings sidebar that, as macOS System Settings does, swaps the tab list for grouped results and jumps the panel to the matching setting.

**Architecture:** A hand-written index (`lib/settingsSearchIndex.ts`) of `{ id, tab, label, anchor? }` entries whose `label` is an existing i18n key; a pure matcher (`lib/settingsSearch.ts`) folds case and accents over the translated label plus per-locale synonyms; the settings primitives render `data-search-id` anchors; `SettingsModal` owns the query, renders `SettingsSearchResults` in place of the tablist and scrolls/marks the selected anchor.

**Tech Stack:** React 19, TypeScript, Tailwind v4, react-i18next, Vitest + Testing Library (jsdom), Biome.

**Spec:** `docs/superpowers/specs/2026-10-29-buscar-en-ajustes-design.md`

## Global Constraints

- All paths below are relative to `apps/desktop/src/renderer/src/` unless they start with `docs/`.
- Run tests: `cd apps/desktop && npx vitest run <file>`; full gate before every commit: `cd apps/desktop && npx vitest run && npx tsc --build && npm run lint`.
- Every new i18n key goes into all 6 locales (`en es de fr pt-BR ja`); `i18n/keys.test.ts` (parity) and `i18n/usedKeys.test.ts` (every key referenced) must pass.
- The internal tab id `search` and its testid `settings-tab-search` do NOT change; only the visible label does.
- Help texts (`*Hint` keys) are NOT searched. Only labels and synonyms.
- The query always starts empty when the modal opens; it is plain `useState('')`, never persisted.
- Selectors in tests: `data-testid` first. Never CSS classes. The highlight is the attribute `data-search-hit="true"`, not a class.
- Commit titles: descriptive sentence, no body, no `feat:`/`fix:` prefix. Never `--no-verify`.
- User rule: no new code comments. (The codebase is heavily commented; this plan follows the user's global rule — see the note to Vicent.)
- Work on a branch, not `main`.

## Review Focus

1. **Escape with text in the field** must clear the search and NOT close the modal (the global handler in `hooks/useKeyboardShortcuts.ts` skips events with `defaultPrevented`). Test in Task 4.
2. **Accented / uppercase queries** ("Música", "TRAKTOR", "metadatos" vs "metadátos") must match regardless of accents in either side, and the `<mark>` must land on the right characters. Test in Task 2.
3. **Sliding pill after clearing a search:** the tablist unmounts while searching; when it comes back the pill must be measured again even if the tab did not change. Test in Task 4.
4. **A result whose anchor is not rendered** (conditional field) must still open its tab without throwing. Covered by the `anchor` fallback + Task 3 integrity test; Task 4 asserts no throw when `scrollIntoView` target is missing.
5. **Whitespace-only query** ("  ") behaves as empty: tabs stay visible. Test in Task 2.

---

### Task 1: Rename the Search tab to Sources

**Files:**
- Modify: `i18n/locales/{en,es,de,fr,pt-BR,ja}.json` — key `settings.tabs.search`
- Test: `components/SettingsModal.test.tsx`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** in `SettingsModal.test.tsx`:

```tsx
it('names the lookup tab Sources so it is not confused with the settings search field', () => {
  render(<SettingsModal {...baseProps} />)
  expect(screen.getByTestId('settings-tab-search')).toHaveTextContent('Sources')
})
```
(Use the file's existing render helper/props for a plain render.)

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/SettingsModal.test.tsx -t "Sources"` → FAIL (text is "Search").
- [ ] **Step 3: Change `settings.tabs.search`**: en `Sources`, es `Fuentes`, de `Quellen`, fr `Sources`, pt-BR `Fontes`, ja `ソース`.
- [ ] **Step 4: Run** the full gate → PASS. Grep the test suite for other assertions on the old label (`'Search'` / `'Búsqueda'` next to `settings-tab-search`) and update them.
- [ ] **Step 5: Commit** `Rename the Search settings tab to Sources so a settings search field can sit above it`

---

### Task 2: Settings search matcher

**Files:**
- Create: `lib/settingsSearch.ts`, `lib/settingsSearch.test.ts`
- Create: `lib/settingsSearchIndex.ts` (types + an initially small index; filled in Task 3)

**Interfaces:**
- Produces:
  - `export interface SettingsSearchEntry { id: string; tab: SettingsTab; label: string; anchor?: string }` — `label` is an i18n key; `anchor` defaults to `id`; an entry with `id === tab` is the tab itself.
  - `export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[]` (in `settingsSearchIndex.ts`); starts with one entry per tab: `{ id: tab, tab, label: \`settings.tabs.${tab}\` }` for every tab in `SETTINGS_TABS`.
  - `export interface SettingsSearchHit { entry: SettingsSearchEntry; text: string; ranges: [number, number][]; synonym: string | null }` — `text` is the translated label; `ranges` are `[start, end)` char offsets into `text` to wrap in `<mark>`; `synonym` is the matching synonym when the label itself did not match.
  - `export function searchSettings(query: string, index: SettingsSearchEntry[], t: (key: string) => string): SettingsSearchHit[]`
  - `export function groupByTab(hits: SettingsSearchHit[]): { tab: SettingsTab; hits: SettingsSearchHit[] }[]` — groups in `SETTINGS_TABS` order.
- Synonyms come from `t(\`settings.searchSynonyms.${entry.id}\`)` split on `,` and trimmed; i18next returns the key itself when missing, so treat a return value equal to the key as "no synonyms".

- [ ] **Step 1: Write the failing tests** (`lib/settingsSearch.test.ts`), with a fake `t` built from a plain object so the tests do not depend on locale copy:

```ts
const dict: Record<string, string> = {
  'settings.traktorSync': 'Traktor collection',
  'settings.mp3Quality': 'MP3 quality',
  'settings.searchSynonyms.mp3Quality': 'bitrate, kbps',
  'settings.theme': 'Apariencia',
  'settings.language': 'Música',
}
const t = (k: string) => dict[k] ?? k
const index = [
  { id: 'mp3Quality', tab: 'conversion', label: 'settings.mp3Quality' },
  { id: 'traktorSync', tab: 'destination', label: 'settings.traktorSync' },
  { id: 'theme', tab: 'general', label: 'settings.theme' },
  { id: 'language', tab: 'general', label: 'settings.language' },
] as SettingsSearchEntry[]

it('finds a setting by any part of its label, ignoring case, so a DJ can type the app name as they think of it')
  // searchSettings('TRAKTOR', index, t) → one hit, id 'traktorSync', ranges [[0, 7]], synonym null
it('ignores accents on both sides, since users type without them')
  // 'musica' → hit 'language', ranges [[0, 6]]; 'apariéncia' → hit 'theme'
it('finds a setting through a synonym when the label uses other words')
  // 'bitrate' → hit 'mp3Quality', synonym 'bitrate', ranges []
it('lists label matches before synonym-only matches')
  // add dict 'settings.searchSynonyms.traktorSync': 'mp3 export'; 'mp3' → ids ['mp3Quality', 'traktorSync']
it('returns nothing for an empty or whitespace-only query, so the tabs stay')
  // searchSettings('  ', index, t) → []
it('groups hits by tab in sidebar order')
  // groupByTab(searchSettings('a', …)) → tabs in SETTINGS_TABS order: general before conversion before destination
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/settingsSearch.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `searchSettings` and `groupByTab`. Fold per character so offsets stay aligned with the original text:

```ts
const fold = (s: string) => [...s].map((c) => c.normalize('NFD').replace(/\p{M}/gu, '')[0] ?? c).join('').toLowerCase()
```
Match = `fold(text).indexOf(fold(query.trim()))`; range `[i, i + query.trim().length]`. Order: label hits, then synonym hits, each in index order.

- [ ] **Step 4: Run** → PASS; run the full gate.
- [ ] **Step 5: Commit** `Add a settings search that matches labels and synonyms ignoring case and accents`

---

### Task 3: Anchors in the tabs and the full index

**Files:**
- Modify: `components/settings/SettingsPrimitives.tsx` — `SettingsSection`, `SettingsField`, `SettingsCheckboxField`, `SettingsLabel` gain `searchId?: string`, rendered as `data-search-id` on their root element.
- Modify: every `components/settings/*Tab.tsx` listed below — pass `searchId` at each site.
- Modify: `lib/settingsSearchIndex.ts` — the entries below.
- Modify: `i18n/locales/*.json` — `settings.searchSynonyms.*`
- Test: `components/settings/SettingsPrimitives.test.tsx`, `components/SettingsModal.test.tsx`

**Interfaces:**
- Consumes: `SettingsSearchEntry`, `SETTINGS_SEARCH_INDEX` (Task 2).
- Produces: a DOM element `[data-search-id="<anchor ?? id>"]` inside `#settings-tabpanel` for every non-tab entry, whenever its tab is shown with the test fixture's settings.

**Index entries** (`id` = the i18n key without `settings.`; label = the key). Where a field is conditional, set `anchor` to its section's id — the red phase of the integrity test tells you which:

| tab | ids |
|---|---|
| general | theme, language, sourcesTitle, updates, betaUpdates |
| search | searchProviders, searchResultsSection, discogsFormats, maxResults, searchMatchingSection, searchByAlbumFirst, autoCleanSpacing, autoCleanCase |
| editor | grouping, genre, showSpectrum, autoAnalyze, showLoudness, showEditorHints, keyNotation |
| layout | sections.title |
| artwork | coverMaxSize, coverUpscale, coverSquare, replaceLowRes, flacFinderCovers |
| cues | cueFlows.flows, cueFlows.manual.jump, cueFlows.manual.quantize, cueFlows.lettersByTime |
| conversion | outputFormat, keepMp3Sources, mp3Quality, bitDepth, sampleRate, flacCompression |
| processing | `declick.title`, `normalize.title` (these keys are top-level, not under `settings.`; use them as-is) |
| naming | titleFormat, filenameFormat, autoApplyFilename, asciiFileNames, trimWhitespace, zeroPadTrack, fullReleaseDate |
| destination | destination, traktorSync, traktorNmlPath, traktorCueOffset, rekordboxSync, rekordboxDbPath, completeCues, engineSync, originals, originalBackup |
| advanced | configDir, backup, backups, cache, log |

`fields`, `shortcuts`, `stats` keep only their tab entry. `id`s with dots (`sections.title`) are fine as `data-search-id` values.

**Synonyms** (`settings.searchSynonyms.<id>`, translate per locale with that language's usual words; keep technical tokens like kbps/LUFS):
mp3Quality `bitrate, kbps, CBR, VBR` · bitDepth `bits, 16, 24` · sampleRate `Hz, kHz, 44.1, 48` · outputFormat `AIFF, FLAC, MP3, WAV, ALAC, convert` · theme `dark, light, mode` · coverMaxSize `artwork, image, resolution` · destination `folder, export, Apple Music` · configDir `iCloud, Dropbox, sync` · `normalize.title` → id `normalize.title`, `loudness, LUFS, volume`.
Ids containing dots must be nested JSON (`"searchSynonyms": { "normalize": { "title": "…" } }`) so `t()` resolves them.

- [ ] **Step 1: Write the failing primitive test** in `SettingsPrimitives.test.tsx`:

```tsx
it('marks a section with its search anchor so settings search can scroll to it', () => {
  render(<SettingsSection eyebrow="Traktor collection" searchId="traktorSync"><p /></SettingsSection>)
  expect(screen.getByTestId('settings-section')).toHaveAttribute('data-search-id', 'traktorSync')
})
```
plus one equivalent assertion each for `SettingsField`, `SettingsCheckboxField` (via its `testid`'s closest `[data-search-id]`) and `SettingsLabel`.

- [ ] **Step 2: Run** → FAIL. **Step 3:** add `searchId` to the four primitives. **Step 4:** run → PASS.

- [ ] **Step 5: Write the failing integrity tests** in `SettingsModal.test.tsx` (it already has the `window.api` stub and the full `settings` fixture):

```tsx
describe('settings search index', () => {
  it.each(SETTINGS_TABS)('has an anchor in the %s tab for every entry, so a result never points nowhere', async (tab) => {
    render(<SettingsModal {...baseProps} initialTab={tab} />)
    const panel = await screen.findByRole('tabpanel')
    for (const e of SETTINGS_SEARCH_INDEX.filter((e) => e.tab === tab && e.id !== tab)) {
      expect(panel.querySelector(`[data-search-id="${e.anchor ?? e.id}"]`), e.id).not.toBeNull()
    }
  })
})
```
And in `i18n/keys.test.ts`: every `SETTINGS_SEARCH_INDEX` label resolves in `en` (walk the en tree by the dotted key; it must be a string).

- [ ] **Step 6: Run** → FAIL listing missing anchors. **Step 7:** fill the index and pass `searchId` at each site; for any entry still missing because the field is conditional in the fixture, set `anchor` to the enclosing section's id. Add the synonym keys to all 6 locales. **Step 8:** full gate → PASS.
- [ ] **Step 9: Commit** `Anchor every searchable setting and index them with per-language synonyms`

---

### Task 4: Search field, results and jump in SettingsModal

**Files:**
- Create: `components/settings/SettingsSearchResults.tsx`
- Modify: `components/SettingsModal.tsx`
- Modify: `i18n/locales/*.json` — `settings.searchField.{placeholder,results_one,results_other,also,none,noneHint,keysMove,keysOpen,keysBack}`
- Test: `components/SettingsModal.test.tsx`

**Interfaces:**
- Consumes: `searchSettings`, `groupByTab`, `SettingsSearchHit` (Task 2); `SETTINGS_SEARCH_INDEX` and `data-search-id` anchors (Task 3).
- Produces: `SettingsSearchResults({ query, groups, selected, onSelect }: { query: string; groups: { tab: SettingsTab; hits: SettingsSearchHit[] }[]; selected: number; onSelect: (flatIndex: number) => void })`.

**English copy** (translate the rest): placeholder `Search settings` · results `{{count}} result` / `{{count}} results` · also `Also: {{words}}` · none `No settings match “{{query}}”` · noneHint `Try another word, like the name of a format or an app.` · keysMove `move` · keysOpen `open` · keysBack `back to tabs`.

**Test ids:** field `settings-search`; result rows `settings-search-result-<entry.id>` with `aria-selected`; empty state `settings-search-empty`; result count `settings-search-count`.

**Behaviour (all in `SettingsModal`):**
- `const [query, setQuery] = useState('')`, `const [selected, setSelected] = useState(0)`; hits = `searchSettings(query, SETTINGS_SEARCH_INDEX, tr)`; searching = hits for a non-blank query.
- The field sits above the tablist, always rendered. With a non-blank query the tablist is replaced by `SettingsSearchResults` (or the empty state).
- Typing resets `selected` to 0. The selected hit sets `tab` to `hit.entry.tab`, then in a `useEffect` on `[tab, selectedHit]` finds `#settings-tabpanel [data-search-id="<anchor ?? id>"]`, calls `scrollIntoView({ block: 'center' })` if found, sets `data-search-hit="true"` on it and removes it after 1500 ms. Tab entries (`id === tab`) scroll the panel to top instead.
- Field `onKeyDown`: ArrowDown/ArrowUp move `selected` (clamped, `preventDefault`); Enter focuses the first focusable element inside the anchor; Escape with a non-empty query → `preventDefault()` + `setQuery('')`; Escape with an empty query does nothing special (modal closes as today).
- ⌘F / Ctrl+F on the modal content → focus the field, `preventDefault()`.
- The pill `useLayoutEffect` deps become `[tab, searching]` so it re-measures when the tablist returns.
- Highlight styling: a Tailwind arbitrary variant on the anchor attribute, e.g. in the tabpanel `className` `[&_[data-search-hit=true]]:ring-1 …` with a `motion-safe:` fade. Exact look per the sketch: ring `rgba(122,162,247,.55)`, bg `rgba(122,162,247,.10)`, radius 10px.

- [ ] **Step 1: Write the failing scenario tests** (stub `Element.prototype.scrollIntoView = vi.fn()` in a `beforeEach`; jsdom lacks it):

```tsx
describe('settings search', () => {
  it('swaps the tabs for grouped results while typing, as macOS Settings does')
    // type 'traktor' in settings-search → settings-tab-general absent; settings-search-result-traktorSync present
  it('opens the tab of the selected result and marks the setting so the eye lands on it')
    // after typing 'traktor': tabpanel aria-labelledby 'settings-tab-destination'; scrollIntoView called;
    // the [data-search-id="traktorSync"] element has data-search-hit="true"
  it('moves through results with the arrow keys without leaving the field')
    // ArrowDown → next result aria-selected; settings-search still has focus
  it('clears the search on Escape instead of closing Settings')
    // Escape with 'traktor' → onClose not called, field empty, settings-tab-general back
  it('says nothing matches instead of showing an empty list')
    // type 'zzzz' → settings-search-empty visible
  it('treats a whitespace-only query as no search')
    // type '   ' → settings-tab-general present
  it('focuses the search field with ⌘F while Settings is open')
    // keyDown metaKey+f on the dialog → settings-search has focus
  it('starts with an empty search every time Settings opens')
    // render, type, unmount, render again → field value ''
  it('puts the sliding pill back under the active tab after a search is cleared')
    // type 'traktor', clear → settings-tab-indicator present
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** implement `SettingsSearchResults` (group headings `tr(\`settings.tabs.${tab}\`)`, rows as `<button type="button" role="option">`, label split by `ranges` into `<mark>`, synonym line via `settings.searchField.also`, keyboard hint footer) and the `SettingsModal` behaviour above; add the copy to all 6 locales. **Step 4:** full gate → PASS.
- [ ] **Step 5: Run the app** (`npm run dev:desktop`), open Settings, search "traktor", "bitrate", "zzzz", press ↓ / Escape / ⌘F; compare with the sketch. Report anything that differs.
- [ ] **Step 6: Commit** `Search settings from the sidebar and jump to the matching setting`
