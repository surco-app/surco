# Botón de convertir simplificado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The convert button names only what happens to the file; a line above it names where it goes, each place with its own verb; with nothing to write the footer goes quiet.

**Architecture:** `exportButtonLabel` (lib/exportLabel.ts) loses every destination concern and returns only the action. A new pure `destinationLine` (lib/destinationLine.ts) builds the line from the same facts. `ExportButton` gains an `upToDate` face; `ConvertFooter` renders the line; `BatchPlan` reuses `destinationLine` for its own vocabulary.

**Tech Stack:** React 19 + TS, i18next (6 locales), Vitest + Testing Library, Biome.

**Spec:** the approved sketch https://claude.ai/artifact/S7P1tabSr2xMxs1CrN1Wvr (12 cases, version 3, after the apple-design review). The case numbers below (01–12) refer to its cards.

## Global Constraints

- All work in worktree `.claude/worktrees/boton-convertir`, branch `boton-convertir` (from local `main` a63042040). Never merge until the user has tried it in the real app.
- Run tests from `apps/desktop` (`npm test`), never filtered by path from the repo root. Check the exit code and grep `FAIL|Errors|Unhandled`.
- Typecheck with the explicit configs (`npx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` in `apps/desktop`); a bare `tsc --noEmit` checks nothing.
- `npx biome lint src` clean. Zero code comments added. Selectors in tests: `data-testid`.
- Copy: no em dash, no explanatory colon. English source strings exactly as below; es/de/fr/ja/pt-BR translated in the same task.
- Commit titles: descriptive, no body, no `feat:`/`fix:`.
- Amber (`text-warn`/`bg-warn`) only for case 07 (library copy is better). Everything else on the line is `text-fg-dim`.

## Copy (en.json, `editor.*`)

Button (action only):
| key | en | es |
|---|---|---|
| `update` (exists) | Update tags | Actualizar etiquetas |
| `updateAudio` (new) | Update tags and audio | Actualizar etiquetas y audio |
| `convertAction` (new) | Convert to {{format}} | Convertir a {{format}} |
| `replaceAction` (new) | Replace with {{format}} | Sustituir por {{format}} |
| `libraryHasBetter` (change) | Replace anyway | Sustituir igualmente |
| `upToDate` (new) | No changes | Sin cambios |
| `updateAnyway` (new) | Update anyway | Actualizar igualmente |

Line parts (joined with ` · `):
| key | en | es |
|---|---|---|
| `lineAdds` | Adds to {{places}} | Añade a {{places}} |
| `lineUpdates` | Updates {{places}} | Actualiza {{places}} |
| `lineReplaces` | Replaces the {{format}} in Apple Music | Sustituye el {{format}} de Apple Music |
| `lineReplacesBare` | Replaces the copy in Apple Music | Sustituye la copia de Apple Music |
| `lineBetter` | The Apple Music copy is better | La copia de Apple Music es mejor |
| `lineFolder` | Saves to {{folder}} | Guarda en {{folder}} |
| `lineBeside` | Saves next to the original | Guarda junto al original |
| `lineOverwrite` | Edits the original | Edita el original |

Note on case 01: the sketch said "Up to date in Apple Music · rekordbox". Surco only knows the file matches the editor, not that Music's entry does, so the face says `No changes` (only what is certain). Flag this to the user at the end.

Keys deleted from all 6 locales: `convert`, `convertNoMusic`, `convertTo`, `convertBeside`, `convertOverwrite`, `convertBesideTo`, `convertOverwriteTo`, `updateMusic`, `replaceMusic`, `convertAll`, `convertAllMusic`, `convertAllTo`, `convertAllBeside`, `convertAllOverwrite`, `convertAllBesideTo`, `convertAllOverwriteTo`. (`appleMusicUpdate` stays: the done footer uses it.)

## Review Focus

1. Track opened from rekordbox that is also in Music, nothing edited (the reported case) → face `No changes`, no accent button, `Update anyway` runs the same process as `Update tags`.
2. Editing then undoing back to the read values → quiet again (signature equals `diskSignature`). Pin in Task 3.
3. Normalization changed on an untouched track (`tagsOnly` false, same format) → `Update tags and audio`, never `No changes`. Pin in Task 3.
4. Opened from Apple Music → the line never says "Adds to Apple Music"; it says `Updates Apple Music` (the source is always updated in place). Pin in Task 2.
5. FLAC with Apple Music destination → Music never named (withAppleMusic is already false for FLAC upstream); line shows `Saves to <folder>`. Pin in Task 2.

---

### Task 1: Button label names only the action

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/exportLabel.ts`
- Test: `apps/desktop/src/renderer/src/lib/exportLabel.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/ExportButton.tsx:144-161` (call site), `DoneMenu.tsx:61-72`

**Interfaces:**
- Produces: `exportButtonLabel(state: ExportLabelState): { key: string; options?: Record<string, unknown> }` with
  `ExportLabelState = { processing; quiet?; inPlace; stale; done; format; exportedFormat?; replaces?; libraryBetter?; tagsOnly?; sameFormat?: boolean }`.
  Fields `count`, `withAppleMusic`, `djTargets`, `inMusic`, `destination`, `openSource` are removed. `programNames` moves to Task 2.

Precedence (first match wins):
1. `processing` → `editor.processing`
2. `quiet` → unchanged (`reexportAs` / `updateAgain` / `reexport`)
3. `inPlace && tagsOnly` → `editor.update`
4. `stale && tagsOnly` → `editor.update`
5. `sameFormat && !tagsOnly && (inPlace || stale)` → `editor.updateAudio`
6. `done` → `editor.exportAgain`
7. `replaces` → `libraryBetter ? editor.libraryHasBetter : editor.replaceAction` `{format}`
8. otherwise → `editor.convertAction` `{format}`

- [ ] **Step 1: Rewrite the `it.each` table** in `exportLabel.test.ts` to the precedence above. Rows (all on `base` with `tagsOnly: true` unless stated):
  - `{processing:true, quiet:true, done:true}` → `editor.processing`
  - `{inPlace:true}` → `editor.update`
  - `{stale:true, done:true}` → `editor.update`
  - `{inPlace:true, tagsOnly:false, sameFormat:true}` → `editor.updateAudio`
  - `{stale:true, tagsOnly:false, sameFormat:true}` → `editor.updateAudio`
  - `{inPlace:true, tagsOnly:false, sameFormat:false}` → `editor.convertAction` (overwrite with another format is a conversion)
  - `{done:true}` → `editor.exportAgain`
  - `{tagsOnly:false, replaces:true}` → `editor.replaceAction`
  - `{tagsOnly:false, replaces:true, libraryBetter:true}` → `editor.libraryHasBetter`
  - `{tagsOnly:false}` → `editor.convertAction`
  Delete the batch-count test and every test about `+ Apple Music`, programs, `beside`/`overwrite` labels. Add one test named "never names a destination" asserting that for every row the key contains none of `Music`, `To`, `Beside`, `Overwrite`, `All`. Keep the quiet/re-export tests as they are.
- [ ] **Step 2: Run** `cd apps/desktop && npx vitest run src/renderer/src/lib/exportLabel.test.ts` → FAIL (keys `updateAudio`, `convertAction`, `replaceAction` not returned).
- [ ] **Step 3: Implement** the precedence in `exportLabel.ts`; delete `placeSuffix`. Leave `programNames` in place for now (Task 2 moves it).
- [ ] **Step 4: Update call sites.** `ExportButton` passes `sameFormat` (new prop, from Editor: `formatMatchesInput(format, item.inputPath)`) and drops removed fields; `DoneMenu` drops `withAppleMusic`/`djTargets`. Add the new en/es keys from the Copy table (button rows only) and change `libraryHasBetter`.
- [ ] **Step 5: Run** the file again → PASS; `npx tsc --noEmit -p tsconfig.web.json` → no errors.
- [ ] **Step 6: Commit** `Name only the action on the convert button`

### Task 2: Destination line

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/destinationLine.ts`
- Test: `apps/desktop/src/renderer/src/lib/destinationLine.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/BatchPlan.tsx` (import `programNames` from the new file)

**Interfaces:**
- Produces:
  ```ts
  export interface DestinationLineState {
    destination: Destination
    withAppleMusic: boolean
    djTargets: DjLibraryId[]
    openSource: PlaylistSource | null
    inPlace: boolean
    inMusic: boolean
    replaces: boolean
    libraryBetter: boolean
    replacedFormat: string
    outputFolder: string
  }
  export interface LinePart { key: string; options?: Record<string, unknown> }
  export function destinationLine(s: DestinationLineState): { parts: LinePart[]; warn: boolean }
  export function programNames(namesMusic: boolean, djTargets: DjLibraryId[]): string
  ```
  `programNames` moves here unchanged (exportLabel.ts no longer exports it).

Rules, in order of the parts:
1. Where the file lands: `folder` → `lineFolder {folder: outputFolder}` unless `inPlace`; `beside` → `lineBeside`; `overwrite` → `lineOverwrite`; `appleMusic` → nothing (Music holds it).
2. Apple Music (only when `withAppleMusic` or `openSource === 'appleMusic'`):
   - `replaces && libraryBetter` → `lineBetter`, `warn: true`
   - `replaces` → `lineReplaces {format: replacedFormat}`, or `lineReplacesBare` when `replacedFormat` is empty
   - `inMusic || openSource === 'appleMusic'` → counts as an *updated* place
   - else → counts as an *added* place
3. Each DJ target: *updated* when `openSource === id || inPlace`, else *added*.
4. Updated places go in one `lineUpdates {places}` part, added ones in one `lineAdds {places}` part, places joined with ` · ` via `programNames`-style names (`settings.source.<id>`). Updates before Adds.

- [ ] **Step 1: Write the failing tests**, one per sketch case, asserting `parts.map(p => p.key)` and options:
  - case 02 `{destination:'appleMusic', withAppleMusic:true, inMusic:true, inPlace:true, djTargets:['rekordbox'], openSource:'rekordbox'}` → `[lineUpdates]`, `places: 'Apple Music · rekordbox'`
  - case 05 `{destination:'appleMusic', withAppleMusic:true}` → `[lineAdds]` `places:'Apple Music'`
  - case 06 `{…case05, replaces:true, replacedFormat:'MP3'}` → `[lineReplaces]` `{format:'MP3'}`; with `replacedFormat:''` → `[lineReplacesBare]`
  - case 07 `{…case06, libraryBetter:true}` → `[lineBetter]`, `warn: true`; every other case `warn: false`
  - case 08 `{destination:'folder', outputFolder:'Converted', djTargets:['rekordbox']}` → `[lineFolder, lineAdds]`
  - case 09 `{destination:'beside'}` → `[lineBeside]`; case 10 `{destination:'overwrite', inPlace:true}` → `[lineOverwrite]`
  - Review Focus 4: `{destination:'folder', withAppleMusic:false, openSource:'appleMusic', inPlace:true}` → `[lineUpdates]` with `places:'Apple Music'`, never `lineAdds`
  - Review Focus 5: `{destination:'folder', withAppleMusic:false, outputFolder:'Converted'}` → `[lineFolder]` only
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/destinationLine.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `destinationLine.ts`; move `programNames` and update its imports (`BatchPlan.tsx`, and `exportLabel.ts` loses the i18n import if now unused). Add the line keys (en/es) from the Copy table.
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `Describe where a conversion goes in its own line`

### Task 3: Footer shows the line and goes quiet with nothing to write

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ExportButton.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ConvertFooter.tsx:690-735`
- Modify: `apps/desktop/src/renderer/src/components/Editor.tsx:1991-2020` (props)
- Modify: `apps/desktop/src/renderer/src/components/BatchPlan.tsx:56-62`
- Test: `apps/desktop/src/renderer/src/components/ExportButton.test.tsx`, `ConvertFooter.test.tsx`

**Interfaces:**
- Consumes: `exportButtonLabel` (Task 1), `destinationLine` (Task 2), `hasStagedEdits(track)` from `lib/sessionEdits.ts`.
- Produces: `ExportButton` prop `upToDate?: boolean`; `ConvertFooter` props `upToDate: boolean`, `inLibrary: 'idle'|'yes'|'no'`, `replacedFormat: string`.

Editor computes:
```ts
const upToDate = !isMulti && item.status === 'idle' && willEditInPlace && tagsOnlyExport
  && item.diskSignature !== undefined && !hasStagedEdits(item)
```
and passes `inMusic` to `destinationLine` as `hasMusicCopy || (inLibrary === 'yes' && willEditInPlace)`, `replacedFormat` as `replacedCopyPath ? fileExtension(replacedCopyPath) : ''`.

- [ ] **Step 1: Write the failing tests.**
  - `ExportButton.test.tsx` "goes quiet when there is nothing to write": render with `upToDate`; expect `getByTestId('convert-up-to-date')` with text `No changes`, `queryByTestId('process-btn')` null, and clicking `getByTestId('convert-update-anyway')` calls `onProcess` with the current format.
  - "an edit brings the accent button back": rerender with `upToDate={false}` → `process-btn` present with text `Update tags`.
  - `ConvertFooter.test.tsx` "names where the file goes above the button": single track, Apple Music destination, `inLibrary: 'yes'`, `willEditInPlace`, `openSource: 'rekordbox'`, `djTargets: ['rekordbox']` → `getByTestId('convert-destination-line')` has text `Updates Apple Music · rekordbox`; the button text is `Update tags` (the reported screenshot).
  - "undoing an edit returns to quiet" (Review Focus 2): in an Editor-level or ConvertFooter test with a track whose `meta.genre` is changed then restored to the read value → `convert-up-to-date` visible again.
  - "a new normalization never reads as no changes" (Review Focus 3): untouched track, `tagsOnly` false, same format → no `convert-up-to-date`, button `Update tags and audio`.
  - "the library copy being better reads amber": `replaces` + `libraryBetter` → the line element carries `data-tone="warn"`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/ExportButton.test.tsx src/renderer/src/components/ConvertFooter.test.tsx` → the new tests FAIL.
- [ ] **Step 3: Implement.** `ExportButton`: when `upToDate && !processing`, render in the button's slot (same `h-` height as the split button) a row `data-testid="convert-up-to-date"` with a `✓` (`text-success`, `aria-hidden`) and `editor.upToDate`, plus a bordered quiet button `data-testid="convert-update-anyway"` labelled `editor.updateAnyway` that calls `onProcess(outputFormat)`. Key the slot on `upToDate` and give it the existing `animate-footer-swap` class so the swap fades in (the class already respects reduced motion if it does today; do not add new animation CSS). `ExportButton` also drops the `process-folder` name beside the button (the line now says it; update its tests). `ConvertFooter`: above `ExportButton` (single only, hidden while `upToDate`), render `<p data-testid="convert-destination-line" data-tone={warn ? 'warn' : 'dim'}>` with the parts joined by ` · `, `text-xs text-center`, `text-warn` when warn else `text-fg-dim`. `BatchPlan`: replace the `+ ${programs}` suffix with ` · ` + the `destinationLine` parts (batch has no `inPlace`/`replaces`: pass `false`).
- [ ] **Step 4: Run** the two files → PASS, then the full suite `cd apps/desktop && npm test; echo exit=$?` → `exit=0`, no `Errors`/`Unhandled`.
- [ ] **Step 5: Commit** `Show where the file goes and stay quiet when nothing changed`

### Task 4: Translations and dead keys

**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/locales/{en,es,de,fr,ja,pt-BR}.json`
- Test: existing `i18n/keys.test.ts`, `i18n/usedKeys.test.ts`

- [ ] **Step 1: Run** `npx vitest run src/renderer/src/i18n` → expect FAIL in `usedKeys`/`keys` (new keys missing in de/fr/ja/pt-BR, dead keys still present). If it does not fail, note that the guard misses non-es/en locales (known: keys.test only compares es/en) and grep the locales by hand.
- [ ] **Step 2:** Add every key from the Copy table to de/fr/ja/pt-BR (translated, same tone as neighbouring keys); delete the listed dead keys from all 6.
- [ ] **Step 3: Run** the i18n tests → PASS; `grep -c '"convertAll' apps/desktop/src/renderer/src/i18n/locales/*.json` → all `0`.
- [ ] **Step 4:** Full gate: `npm test; echo exit=$?` → `exit=0`; both tsc configs clean; `npx biome lint src` clean.
- [ ] **Step 5: Commit** `Translate the new convert footer copy and drop unused labels`

### Task 5: Check it in the real app (no merge)

- [ ] **Step 1:** With the `run-desktop` skill from this worktree (watch the binary path: the driver opens the `out/` of the tree it runs from), open a rekordbox track that is also in Apple Music, untouched → `No changes` + `Update anyway`; edit Genre → line `Updates Apple Music · rekordbox` + `Update tags`; undo → quiet again.
- [ ] **Step 2:** Screenshot both states and show the user. Do not merge to main until the user has tried it.

---

**Follow-ups not in this plan:** /guia screenshots that show the old labels; web changelog entry at release time.
