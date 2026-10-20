# Editor de cues, con calma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Cues section so the wave leads and one primary action says what will happen ("Marcar dónde rompe", which arms the next click or M to mark the drop and apply the flow in one step, or "Aplicar Mi flujo" with its flow menu), with Guardar beside it, a slim overview navigator, a zoomed wave that fills the free height with nothing drawn over it, and a small bottom bar to correct by hand.

**Architecture:** Only the renderer changes. `CuesSection.tsx` keeps the same draft (`lib/cueDraft.ts`), queue save, session store and key claims; it gains an "armed" state that routes the next wave click (overview through `CueWave.onMarkDrop`, zoomed wave through a new `CueWaveDetail.onPick`) or M to the existing `mark-drop` action, which already regenerates the active flow. `CueWave` becomes a navigator (ticks every 16 bars, a view rectangle, drag to seek, no drop labels), `CueWaveDetail` fills its parent with a label row above the marks lane and zooms by pinch or ⌘ + wheel through a pure `wheelZoom` helper, and `CueDeck` is rebuilt as the small bottom bar. `Select` learns a `split` look for the flow chevron.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library (jsdom), biome, lucide-react, i18next.

**Spec:** `docs/superpowers/specs/2026-10-20-editor-cues-calma-design.md` (redesigns `2026-10-20-editor-cues-manual-design.md`). Approved sketch: https://claude.ai/artifact/Szq9X6ujtFqNcx7sRCET5t, HTML source at `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-calma.html` (exact layout, sizes and copy).

**Depends on:** branch `worktree-fuentes-dj-playlists` at `ac1d9c07` (plan `2026-10-20-editor-cues-manual.md` done plus the post-plan commits listed in its ledger).

**Out of scope (spec "Fuera de alcance"):** automatic drop detection (`src/shared/dropDetect*`, `src/main/dropDetectMeasure*` are being researched by another agent; no task touches them) and any change to what Surco writes to rekordbox.

## Global Constraints

- `$WT` means `/Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists`. **Write it out literally in every command**: the shell guard refuses commands whose paths come from a variable. Paths below are relative to `apps/desktop/` unless they start with `docs/`.
- Tests: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop <paths relative to apps/desktop>`. Never filter by a path from the repo root (the setup is skipped and failures are false). Full suite: add `--reporter=dot --silent > /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/suite.log` and read the tail.
- Types: `npm --prefix $WT/apps/desktop exec -- tsc -p $WT/apps/desktop/tsconfig.web.json --noEmit` and the same with `tsconfig.node.json`. A bare `tsc --noEmit` checks nothing.
- Lint: `npm --prefix $WT/apps/desktop run check` (it is `biome check --write src`, it may reorder imports), then `git -C $WT status --short` must list only the task's files. Other agents work in this tree (one is writing `src/main/zzDropDump.test.ts` and `src/shared/dropDetect*`): never `git add -A` or `.`, stage by path.
- The shell guard rejects heredocs, `cd … &&` chains and shell loops: write files with the Write tool, edit with Edit. Search with `rg` or the Grep tool.
- Locale additions: write the JSON shown in the task with the Write tool to the scratchpad path the task names, then run `node /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/learn-merge.cjs <that json>` with the Bash working directory `$WT/apps/desktop` (it deep-merges `{ "<locale>": { ...keys } }` into `src/renderer/src/i18n/locales/<locale>.json`). Key removals are done with Edit in each of the 5 files, using the exact lines the task lists. `i18n/usedKeys.test.ts` fails on a key nobody reads and `i18n/keys.test.ts` on a key missing in one locale, so run both after every locale change.
- Zero comments in new code (biome directives included). `Select.tsx` documents each prop with a comment; the new `split` prop gets none (the user's no-comment rule wins over that file's habit; reviewers are told).
- `data-testid` first in selectors; never assert a CSS class. `window.api` mocks are typed: `vi.fn<Api['name']>()`. Function mocks are typed: `vi.fn<(ms: number) => void>()`.
- No user-facing string with an em dash or an explanatory colon. Every key exists in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`), Spanish written first; French uses "vous"; German keeps the repo's "du" form. Spanish copy is the spec's: "Marcar dónde rompe", "Aplicar Mi flujo" (flow name interpolated), "Haz clic donde rompe", "Guardar en rekordbox", "Salto 16 compases", "N compases al CALL".
- Palette rule (`src/renderer/src/index.css.test.ts`): components paint only Tokyo Night tokens. No hex outside the palette, no `rgb(…)` literals, no Tailwind `white`/`black` classes. Use `var(--color-…)` tokens (`--color-accent`, `--color-on-accent`, `--color-accent-hover`, `--color-fg`, `--color-fg-dim`, `--color-fg-faint`, `--color-line`, `--color-line-strong`, `--color-panel`, `--color-panel-2`, `--color-hover`), `MEMORY_CUE_COLOR`, `hotCueColor`, `PAD_LETTER_COLOR`.
- **Never touch `~/Library/Pioneer`** or `/Volumes/Vicent`. Real data lives only in `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-edit/master.db` (Task 6 writes there only through the queue) and `…/scratchpad/rb-b/master.db` (read-only).
- **Decision 9, nothing changes underneath.** The draft reducer (`lib/cueDraft.ts`), `lib/cueSession.ts`, the save call (`saveRekordboxCues` with `wanted` and the read `fingerprint`), `undoRekordboxCues`, the queue, backup and `validWantedSet` in main, `useCueAudition`, `HIDDEN_SECTION_KEYS` and the `claimKeys` call stay as they are. These existing tests must stay green and are never edited: in `CuesSection.test.tsx` "saves the whole wanted set with the fingerprint it read", "saves only sets main accepts…", "starts from what rekordbox holds when the queued save was built on an older read…", "starts afresh on another track whose read looks the same…", "keeps the unsaved cues when the section is mounted again…"; in `CuesSection.maximized.test.tsx` every test of `describe('CuesSection maximized over the rest of the editor')` and "Space plays the track from the playhead…", "answers the global Space while maximized…", "keeps Space and Trim’s keys…", "stops the sound when the section is restored…".
- **Keys and Escape** (rulings of the previous ledger): the full editor handles keys only while focus is inside it and never in a field (`isTypingTarget`, `[aria-haspopup="listbox"]`); every handled key is `preventDefault`-ed. Anything that closes on Escape (popover, menu, the armed wait) listens on `document`, calls `e.stopPropagation()` so the Editor's window listener does not restore the maximized section, and gives the focus back to the editor (`focusEditor`).
- Constants: `SAME_POSITION_MS` 50, `BEATS_PER_BAR` 4, `HOT_KINDS` `[1, 2, 3, 5, 6, 7, 8, 9]`, `CUE_JUMP_BARS` `[8, 16, 32, 64]`, zoom bars `[4, 8, 16, 32, 64]` default 16, `WAVE_MARK_LANE_PX` 15, new `WHEEL_ZOOM_STEP` 40.
- One functionality per commit, title only, no prefix, never `--no-verify`, never bare `git stash`.

## Decisions taken where the spec left room

1. **The "Haz clic donde rompe" hint sits in the top bar, right of the main button**, as a small grey `role="status"` text. Decision 1 and the success criterion ("nothing is drawn over the wave except the playhead and the marks") outrank decision 2's "la onda muestra"; the wave only shows a crosshair cursor while waiting.
2. **The playhead time and "N compases al CALL" sit in their own 16 px row above the zoomed wave's marks lane**, left and right of the centre line, for the same reason. The time keeps the test id `cues-position` (it moves from the header).
3. **M marks only in the full editor**, where the playhead is visible. Folded, the next click on the strip marks (a folded click already marks a drop today); the button still arms so the hint and Escape behave the same.
4. **The flow chevron is there in both states.** Picking a flow never applies it: it becomes the button's flow and the flow the next mark applies (`use-flow`), so a DJ can pick "Solo CALL" before the first mark.
5. **The wait ends** on a mark (overview click, zoomed-wave click, M), on Escape, on a second press of the button, and whenever a drop appears another way (right-click menu); ⌘Z afterwards never brings it back.
6. **‹ and › select the CALL they land on**, so ⌫ (which replaces ✕, decision 6) deletes it; "+ CALL" already selects the CALL it adds.
7. **The selection row (colour, Borrar, loop note) stays in the folded section and is hidden in the full editor**, where the pads (right-click colour) and ⌫ do its work and the bottom bar is the only correction surface.
8. **The restore button moves into the editor's top bar** (same test id `section-maximize`) and the section header row is hidden while the editor is shown full screen. When the track cannot be edited (unread, unanalysed, loading) the header stays, so maximizing is never a dead end.
9. **One drawing rule for every `CueWave`**: the Settings preview (`CueFlowPreview`) also loses drop labels and the per-bar grid and gets the 16-bar ticks.
10. **Pad number hints and the `M` key cap disappear** (the legend lives in the keyboard button, decision 6).
11. **Guardar is a neutral button** (the flow button is the one primary). Folded it reads "Guardar" (new key `editor.cues.saveShort`, accessible name stays "Guardar en rekordbox"); full screen "Guardar en rekordbox". Descartar keeps its text "Descartar cambios" as a grey link, shown only when there is something to discard (the same condition that enabled it before).
12. **"N compases al CALL"** shows the distance rounded to one decimal without a trailing ".0" (`16`, `16.5`), plural by count; on the CALL it reads "0 compases al CALL".
13. **Pinch and ⌘ + wheel** zoom one step per 40 units of accumulated `deltaY` in one direction (a change of direction starts again); a plain wheel does nothing and is not prevented. Chromium sends a trackpad pinch as `wheel` with `ctrlKey`, so the same listener serves both, registered with `{ passive: false }` so the page itself never zooms.
14. **One slim height for the strip**, 64 px (`h-16`), folded and full screen (sketch 54 and 64 px).
15. **The overview playhead is a 1 px line in `--color-fg`**, as in the sketch, not red (the previous ledger noted the red line vanished on red waves).
16. **The hover ghost on the strip stays as a bare dashed line**, without its "+ drop" label.
17. **The header length is `m:ss`** from `formatTime` (`lib/duration.ts`).

## Review Focus

1. **A drop marked another way while waiting, then ⌘Z.** The DJ arms, changes their mind and marks from the right-click menu, then undoes it; the hint must not come back by itself. Pinned in Task 1 ("stops waiting on a second press or once a drop is marked from the menu, and ⌘Z never brings the wait back").
2. **Escape while waiting in the full editor.** It must cancel the wait only, never restore the editor, and keep the keys working. Pinned in Task 1 ("stops waiting with Escape without restoring the full editor, and the overview seeks again").
3. **A flow picked before the first drop.** The button still says "Marcar dónde rompe", but the click must apply the picked flow, not "Mi flujo". Pinned in Task 1 ("marks with the flow picked from the arrow before any drop is marked").
4. **Pinch or ⌘ + wheel over the zoomed wave.** It must zoom the wave and never the whole Electron page; a plain wheel stays free. Pinned in Task 4 ("zooms with a pinch or ⌘ and the wheel, one step per swipe, and leaves a plain wheel alone").
5. **Deleting a CALL without ✕.** A CALL from rekordbox that sits off the grid must still be reachable and deletable by keyboard and mouse. Pinned in Task 5 ("walks to a CALL from rekordbox off the grid with › and deletes it with ⌫").

---

## File structure

| File | Responsibility |
|---|---|
| `src/renderer/src/components/CuesSection.tsx` (mod) | armed wait, primary split button, top bar, folded order, restore in the bar, header meta, wiring of view, zoom and deck |
| `src/renderer/src/components/Select.tsx` (mod) | `split` look for the right half of a split button |
| `src/renderer/src/components/CueWave.tsx` (mod) | the strip: ticks every 16 bars, view rectangle, drag to seek, thin playhead, no drop labels |
| `src/renderer/src/lib/cueWave.ts` (mod) | `dropLabels` removed (no longer used) |
| `src/renderer/src/components/CueWaveDetail.tsx` (mod, rewritten) | fills its parent, label row, calm grid, `onPick`, pinch and ⌘ + wheel |
| `src/renderer/src/lib/cuePlayhead.ts` (mod) | `WHEEL_ZOOM_STEP`, `wheelZoom`; `ZOOM_BARS` no longer exported |
| `src/renderer/src/components/CueDeck.tsx` (mod, rewritten) | Play/Pausa, small pads, ‹ + CALL ›, Salto menu |
| `src/renderer/src/i18n/locales/*.json` (mod) | keys added and removed per task |

## Test ids

| Test id | Fate | Task |
|---|---|---|
| `cues-needs-drop` | removed (the button never does nothing) | 1 |
| `cues-arm-hint` | new | 1 |
| `cues-flow` | kept, now the chevron of the split button (chevron only, accessible name "Flujo: …") | 1 |
| `cues-apply-flow` | kept, the primary button in both states | 1 |
| `cues-flow-row` | removed, merged into `cues-actions` | 2 |
| `cues-actions` | kept, now holds the split button, the hint, Descartar and Guardar | 2 |
| `cues-remaining` | removed (spec decision 7 shows length, BPM, key) | 2 |
| `cues-meta`, `cues-duration` | new | 2 |
| `cues-bpm`, `cues-key` | kept, inside `cues-meta` | 2 |
| `section-maximize` | kept; while the full editor shows it is the restore button in `cues-header` | 2 |
| `cues-undo` | kept, rendered only when there is something to discard | 2 |
| `cue-wave-drop-*`, `cue-wave-drop-label-*`, `cue-wave-bar` | removed | 3 |
| `cue-wave-tick`, `cue-wave-view` | new | 3 |
| `cue-grid-cap` | removed | 4 |
| `cue-detail-zoom-in`, `cue-detail-zoom-out` | removed | 4 |
| `cue-detail-notch` | new | 4 |
| `cues-position` | kept, moves from the header into the zoomed wave's label row | 4 |
| `cues-memory-remove`, `cues-jump-less`, `cues-jump-more`, `cues-jump-value` | removed | 5 |
| `cues-play`, `cues-jump` (a `Select`, options `cues-jump-option-<bars>`) | new | 5 |
| `cues-memory`, `cues-memory-prev`, `cues-memory-next`, `cues-pad-*`, `cues-pad-colours`, `cues-deck` | kept | 5 |

Tests that change because an id goes: `CuesSection.test.tsx` "puts the flow row before the wave…", "says what Aplicar flujo needs…", "follows a flow chosen in Settings…", "shows Mi flujo in the flow list…"; `CuesSection.maximized.test.tsx` "stays the section of today while folded…", "opens the full editor…", "moves the playhead with a click on the overview…", the three ✕ tests, "disables ✕…", the two jump tests; `CueWave.test.tsx` the drop label, bar and ghost label tests; `CueWaveDetail.test.tsx` the cap and zoom button tests and the CALL distance copy; `CueDeck.test.tsx` rewritten. Every change is shown in its task.

## Task list

| # | Task |
|---|---|
| 1 | One primary action that never does nothing |
| 2 | The top bar and the folded layout |
| 3 | The overview as a navigator strip |
| 4 | The zoomed wave fills the free height |
| 5 | The bottom bar to correct by hand |
| 6 | Verify on the copy with the driver |

Tasks 1 to 5 all edit `CuesSection.tsx` and the locales: run them in order, one at a time.

---

### Task 1: One primary action that never does nothing

**Files:**
- Modify: `src/renderer/src/components/CuesSection.tsx` (imports, `Editing` state and handlers, the flow row, the `CueWave` and `CueWaveDetail` elements, `run`)
- Modify: `src/renderer/src/components/Select.tsx` (`split` prop)
- Modify: `src/renderer/src/components/CueWaveDetail.tsx` (`onPick`)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.maximized.test.tsx`, `src/renderer/src/components/CueWaveDetail.test.tsx`

**Interfaces:**
- Consumes: `DraftAction` `{ type: 'mark-drop'; ms }`, `{ type: 'apply-flow'; flowId }`, `{ type: 'use-flow'; flowId }` from `lib/cueDraft.ts`; `draftDrops`; `flowName(flow, t)` from `lib/cueFlowName.ts`; `MY_FLOW`, `MY_FLOW_ID` from `shared/cueFlows`.
- Produces: in `Editing`, `armed: boolean`, `primary(): void`, `pickFlow(flowId: string): void`, `markDrop(ms: number): void`, `shownName: string` (used by Task 2's whole-return rewrite). `CueWaveDetail` prop `onPick?: (ms: number) => void` (kept by Task 4's rewrite). `Select` prop `split?: boolean`. Locale keys `editor.cues.markDrop`, `editor.cues.apply` (`{{name}}`), `editor.cues.armHint`; `editor.cues.applyFlow` and `editor.cues.needsDrop` removed.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/CuesSection.test.tsx`, replace the whole test `it('says what Aplicar flujo needs when no drop is marked instead of doing nothing, until one is', …)` with:

```tsx
  it('says Marcar dónde rompe while the track has no drop and Aplicar with the flow name once it has one, so the button never does nothing', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Mark where it drops')
    clickAt(bar(64))
    expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Apply My flow')
  })

  it('waits for the click on the wave after Marcar dónde rompe and says so, until Escape, which never reaches the window', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    expect(screen.getByTestId('cues-arm-hint')).toHaveTextContent('Click where it drops')
    const reachedWindow = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', reachedWindow)
    fireEvent.keyDown(document, { key: 'Escape' })
    window.removeEventListener('keydown', reachedWindow)
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    expect(reachedWindow).not.toHaveBeenCalled()
  })

  it('marks the drop with the click that follows and applies the flow in the same step', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    clickAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
  })

  it('stops waiting on a second press or once a drop is marked from the menu, and ⌘Z never brings the wait back', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(64) / 1000, clientY: 30 })
    fireEvent.click(screen.getByTestId('cues-menu-mark-drop'))
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Apply My flow')
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'z', metaKey: true })
    await waitFor(() =>
      expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Mark where it drops'),
    )
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
  })

  it('marks with the flow picked from the arrow before any drop is marked', async () => {
    setup()
    await ready()
    chooseFlow('one-at-32')
    expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Mark where it drops')
    clickAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toBe(`${(bar(32) / 400000) * 100}%`)
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Apply One cue at 32')
  })
```

In the same file, in the test "follows a flow chosen in Settings while the editor is open…", replace

```tsx
    await waitFor(() => expect(screen.getByTestId('cues-flow')).toHaveTextContent('One cue at 32'))
```

with

```tsx
    await waitFor(() =>
      expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Apply One cue at 32'),
    )
```

and in "shows Mi flujo in the flow list once the flow picked there is deleted in Settings" replace

```tsx
    await waitFor(() => expect(screen.getByTestId('cues-flow')).toHaveTextContent('My flow'))
```

with

```tsx
    await waitFor(() =>
      expect(screen.getByTestId('cues-flow')).toHaveAttribute('aria-label', 'Flow: My flow'),
    )
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx`, add at the end of `describe('CuesSection maximized keys', …)` (after "lists the keys with the jump in use"):

```tsx
  it('marks where it drops with the main button and one click on the overview, applying the flow, instead of moving the playhead', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    seek(128000)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(position()).toBe('0:00.0')
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    seek(100000)
    expect(position()).toBe('1:40.0')
  })

  it('marks where it drops with a click on the zoomed wave while waiting, without scrubbing it', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 100 })
    fireEvent.mouseUp(window, { clientX: 100 })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(position()).toBe('2:08.0')
  })

  it('marks where it drops at the playhead with M while waiting, and applies the flow', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    key('m')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
  })

  it('stops waiting with Escape without restoring the full editor, and the overview seeks again', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    const windowKeys = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', windowKeys)
    fireEvent.keyDown(editor(), { key: 'Escape' })
    window.removeEventListener('keydown', windowKeys)
    expect(screen.queryByTestId('cues-arm-hint')).toBeNull()
    expect(windowKeys).not.toHaveBeenCalled()
    expect(editor()).toHaveAttribute('data-maximized', 'true')
    expect(document.activeElement).toBe(editor())
    seek(100000)
    expect(position()).toBe('1:40.0')
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })
```

In `src/renderer/src/components/CueWaveDetail.test.tsx`, add inside `describe('CueWaveDetail', …)` after "moves the playhead forward when the wave is dragged left…":

```tsx
  it('hands the time under a click to onPick while the editor waits for a drop, instead of scrubbing', () => {
    const onPick = vi.fn<(ms: number) => void>()
    const { onScrub } = setup({ onPick })
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 100 })
    expect(onPick).toHaveBeenCalledWith(bar(32) + 8000)
    expect(onScrub).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/CueWaveDetail.test.tsx`
Expected: FAIL. The new folded tests fail on `Mark where it drops` (the button reads "Apply flow") and on `cues-arm-hint`; the two edited assertions fail on the text and the aria-label; the four new maximized tests fail on `cue-wave-hot-C`/`cues-arm-hint`; the CueWaveDetail test fails because `onPick` is never called. Note the names of any other failure: there must be none.

- [ ] **Step 3: Add the locale keys and remove the two old ones**

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-calma-t1.json`:

```json
{
  "es": { "editor": { "cues": { "markDrop": "Marcar dónde rompe", "apply": "Aplicar {{name}}", "armHint": "Haz clic donde rompe" } } },
  "en": { "editor": { "cues": { "markDrop": "Mark where it drops", "apply": "Apply {{name}}", "armHint": "Click where it drops" } } },
  "de": { "editor": { "cues": { "markDrop": "Drop markieren", "apply": "{{name}} anwenden", "armHint": "Klicke dort, wo der Drop kommt" } } },
  "fr": { "editor": { "cues": { "markDrop": "Marquer le drop", "apply": "Appliquer {{name}}", "armHint": "Cliquez là où arrive le drop" } } },
  "pt-BR": { "editor": { "cues": { "markDrop": "Marcar o drop", "apply": "Aplicar {{name}}", "armHint": "Clique onde entra o drop" } } }
}
```

Run `node /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/learn-merge.cjs /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-calma-t1.json` from `$WT/apps/desktop`.

Then delete these lines with Edit (each is unique in its file):

| File | Lines to delete |
|---|---|
| `es.json` | `    "applyFlow": "Aplicar flujo",` and `    "needsDrop": "Marca primero dónde rompe con M o con un clic en la onda",` |
| `en.json` | `    "applyFlow": "Apply flow",` and `    "needsDrop": "First mark where it drops with M or a click on the wave",` |
| `de.json` | `    "applyFlow": "Ablauf anwenden",` and `    "needsDrop": "Markiere zuerst mit M oder einem Klick auf die Welle, wo der Drop kommt",` |
| `fr.json` | `    "applyFlow": "Appliquer le flux",` and `    "needsDrop": "Marquez d'abord le drop avec M ou un clic sur la forme d'onde",` |
| `pt-BR.json` | `    "applyFlow": "Aplicar fluxo",` and `    "needsDrop": "Marque primeiro onde entra o drop com M ou um clique na onda",` |

(Indentation in the files is 6 spaces at that depth; copy the line from the file when you Edit.)

- [ ] **Step 4: Give `Select` a split look**

In `src/renderer/src/components/Select.tsx`, in `interface Props`, replace

```tsx
  portal?: boolean
}
```

with

```tsx
  portal?: boolean
  split?: boolean
}
```

In the parameter list replace

```tsx
  portal = false,
}: Props): React.JSX.Element {
```

with

```tsx
  portal = false,
  split = false,
}: Props): React.JSX.Element {
```

After `const portaled = fullWidth || portal` add

```tsx
  const look = split
    ? 'rounded-r-lg border-l border-[var(--color-on-accent)]/25 bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
    : bare
      ? 'rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'
      : 'rounded-md border border-[var(--color-line)] bg-[var(--color-field)] text-fg-dim focus:border-[var(--color-accent)]'
```

and replace the trigger's className

```tsx
        className={`flex min-w-0 items-center gap-1.5 rounded-md pr-1.5 pl-2 text-xs text-fg-dim outline-none ${bare ? 'hover:bg-[var(--color-hover)] hover:text-fg' : 'border border-[var(--color-line)] bg-[var(--color-field)] focus:border-[var(--color-accent)]'} ${compact ? 'h-6' : 'h-8'} ${fullWidth ? 'w-full' : ''}`}
```

with

```tsx
        className={`flex min-w-0 items-center gap-1.5 pr-1.5 pl-2 text-xs outline-none ${look} ${compact ? 'h-6' : 'h-8'} ${fullWidth ? 'w-full' : ''}`}
```

Every existing select keeps exactly its classes (only regrouped). The look has no behaviour to test; it is checked on screen in Task 6.

- [ ] **Step 5: Let the zoomed wave hand a click to `onPick`**

In `src/renderer/src/components/CueWaveDetail.tsx` add `onPick,` after `onZoom,` in the destructuring and `onPick?: (ms: number) => void` after `onZoom: (dir: 'in' | 'out') => void` in the props type. Replace

```tsx
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const width = rootRef.current?.getBoundingClientRect().width ?? 0
        if (width > 0) setDrag({ x0: e.clientX, ms0: playheadMs, width })
      }}
```

with

```tsx
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect || rect.width <= 0) return
        if (onPick) onPick(fromMs + ((e.clientX - rect.left) / rect.width) * span)
        else setDrag({ x0: e.clientX, ms0: playheadMs, width: rect.width })
      }}
```

- [ ] **Step 6: The armed wait and the split button in `CuesSection`**

In `src/renderer/src/components/CuesSection.tsx`:

Replace `import { activeCueFlow, MY_FLOW_ID } from '../../../shared/cueFlows'` with `import { activeCueFlow, MY_FLOW, MY_FLOW_ID } from '../../../shared/cueFlows'`.

Replace

```tsx
  const [askedForDrop, setAskedForDrop] = useState(false)
  const noDrop = draftDrops(state.cues, state.locked).length === 0
```

with

```tsx
  const [arming, setArming] = useState(false)
  const noDrop = draftDrops(state.cues, state.locked).length === 0
  const armed = arming && noDrop
  useEffect(() => {
    if (!noDrop) setArming(false)
  }, [noDrop])
```

Replace

```tsx
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
```

with

```tsx
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
  const shownName = flowName(flows.find((f) => f.id === shownFlow) ?? MY_FLOW, tr)
  const pickFlow = (flowId: string) => {
    setChosen(flowId)
    dispatch({ type: 'use-flow', flowId })
  }
  const primary = () => {
    if (noDrop) setArming(!arming)
    else dispatch({ type: 'apply-flow', flowId: shownFlow })
  }
  const markDrop = (ms: number) => {
    dispatch({ type: 'mark-drop', ms })
    setArming(false)
  }
```

In `run`, replace

```tsx
    else if (key.type === 'memory') dispatch({ type: 'add-call', ms: playheadMs })
```

with

```tsx
    else if (key.type === 'memory' && armed) markDrop(playheadMs)
    else if (key.type === 'memory') dispatch({ type: 'add-call', ms: playheadMs })
```

After the colour popover effect (the one ending `}, [colourOpen, focusEditor])`) add

```tsx
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setArming(false)
      focusEditor()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [armed, focusEditor])
```

Replace the whole flow row

```tsx
      <div data-testid="cues-flow-row" className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-fg-dim">{tr('editor.cues.flow')}</span>
        <Select
          testid="cues-flow"
          label={tr('editor.cues.flow')}
          value={shownFlow}
          onChange={setChosen}
          options={flows.map((f) => ({ value: f.id, label: flowName(f, tr) }))}
        />
        <button
          type="button"
          data-testid="cues-apply-flow"
          onClick={() => {
            if (noDrop) setAskedForDrop(true)
            else dispatch({ type: 'apply-flow', flowId: shownFlow })
          }}
          className="press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          {tr('editor.cues.applyFlow')}
        </button>
        {askedForDrop && noDrop && (
          <span data-testid="cues-needs-drop" role="status" className="text-xs text-warn">
            {tr('editor.cues.needsDrop')}
          </span>
        )}
      </div>
```

with

```tsx
      <div data-testid="cues-flow-row" className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex">
          <button
            type="button"
            data-testid="cues-apply-flow"
            aria-pressed={noDrop ? armed : undefined}
            onClick={primary}
            className="press h-8 whitespace-nowrap rounded-l-lg bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
          >
            {noDrop ? tr('editor.cues.markDrop') : tr('editor.cues.apply', { name: shownName })}
          </button>
          <Select
            testid="cues-flow"
            split
            label={tr('editor.cues.flow')}
            value={shownFlow}
            onChange={pickFlow}
            options={flows.map((f) => ({ value: f.id, label: flowName(f, tr), short: '' }))}
          />
        </div>
        {armed && (
          <span data-testid="cues-arm-hint" role="status" className="text-xs text-fg-dim">
            {tr('editor.cues.armHint')}
          </span>
        )}
      </div>
```

In the `CueWave` element replace `onMarkDrop={(ms) => dispatch({ type: 'mark-drop', ms })}` with `onMarkDrop={markDrop}` and `onSeek={maximized ? seekTo : undefined}` with `onSeek={maximized && !armed ? seekTo : undefined}`. In the `CueWaveDetail` element replace

```tsx
          onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
        />
```

with

```tsx
          onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
          onPick={armed ? markDrop : undefined}
        />
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/CueWaveDetail.test.tsx src/renderer/src/components/Select.test.tsx src/renderer/src/i18n`
Expected: PASS, none skipped. (If `Select.test.tsx` does not exist, drop it from the command; `rg --files src/renderer/src/components | rg Select` tells.)

- [ ] **Step 8: Types, lint, commit**

Run both `tsc` commands and `npm --prefix $WT/apps/desktop run check`; `git -C $WT status --short` lists only the files of this task.

```bash
git -C $WT add apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/Select.tsx apps/desktop/src/renderer/src/components/CueWaveDetail.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/components/CueWaveDetail.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C $WT commit -m "Mark where it drops and apply the flow from one cue button"
```

---

### Task 2: The top bar and the folded layout

**Files:**
- Modify: `src/renderer/src/components/CuesSection.tsx` (imports, `Editing` props, the whole `return` of `Editing`, the whole `CuesSection` component)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: Task 1's `armed`, `primary`, `pickFlow`, `markDrop`, `shownName`; `formatTime(seconds: number): string` from `lib/duration.ts`; `useMaximizedSection(): { maximized, setMaximized }`.
- Produces: `Editing` prop `onRestore: () => void`; the `CueWave`, `CueWaveDetail` and `CueDeck` elements exactly as written below (Tasks 3, 4 and 5 edit them by that text); the header `<span data-testid="cues-position" …>` block (removed by Task 4); key `editor.cues.saveShort`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/CuesSection.test.tsx`, replace the whole test "puts the flow row before the wave, since applying the flow is the main way to work" with:

```tsx
  it('puts the strip first and the actions under it while folded, with a short Guardar', async () => {
    setup()
    await ready()
    const order = screen
      .getByTestId('cue-wave')
      .compareDocumentPosition(screen.getByTestId('cues-actions'))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('cues-actions')).toContainElement(
      screen.getByTestId('cues-apply-flow'),
    )
    expect(screen.getByTestId('cues-actions')).toContainElement(screen.getByTestId('cues-save'))
    expect(screen.getByTestId('cues-save').textContent).toBe('Save')
    expect(screen.getByTestId('cues-save')).toHaveAccessibleName('Save to rekordbox')
  })

  it('offers Descartar only once there is something to discard', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-undo')).toBeNull()
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(screen.queryByTestId('cues-undo')).toBeNull())
  })
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx`, replace the test "opens the full editor with the track header, the zoomed wave and the deck" with:

```tsx
  it('opens the full editor with the track header, the zoomed wave and the deck', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-header')).toHaveTextContent('Pray')
    expect(screen.getByTestId('cues-header')).toHaveTextContent('Gowan')
    expect(screen.getByTestId('cues-duration')).toHaveTextContent('6:40')
    expect(screen.getByTestId('cues-bpm')).toHaveTextContent('120 BPM')
    expect(screen.getByTestId('cues-key')).toHaveTextContent('6A')
    expect(position()).toBe('0:00.0')
    expect(screen.queryByTestId('cues-remaining')).toBeNull()
    expect(screen.getByTestId('cue-detail')).toBeInTheDocument()
    expect(screen.getByTestId('cues-deck')).toBeInTheDocument()
    expect(screen.getByTestId('cues-save')).toBeInTheDocument()
  })

  it('puts the length, BPM and key in grey beside the title and the main action, Guardar, the keys and restore on the same bar', async () => {
    setup()
    await maximize()
    const header = screen.getByTestId('cues-header')
    const meta = within(header).getByTestId('cues-meta')
    for (const id of ['cues-duration', 'cues-bpm', 'cues-key'])
      expect(meta).toContainElement(screen.getByTestId(id))
    for (const id of ['cues-apply-flow', 'cues-flow', 'cues-save', 'cues-keys', 'section-maximize'])
      expect(header).toContainElement(screen.getByTestId(id))
    expect(screen.getAllByTestId('section-maximize')).toHaveLength(1)
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-save')).toHaveTextContent('Save to rekordbox')
  })

  it('keeps the restore button when the track cannot be edited, so the full editor is never a dead end', async () => {
    setup(null, { ...READ, analysed: false, grid: [] })
    await waitFor(() => expect(screen.getByTestId('cues-unanalysed')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(screen.getByTestId('section-maximize')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no selection row in the full editor, where the pads and ⌫ do its work', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(screen.queryByTestId('cues-selection')).toBeNull()
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL on `cues-actions` order and the short "Save", on `cues-undo` being present with no change, on `cues-duration`/`cues-meta`, on two `section-maximize` buttons, and on `cues-selection` being shown. "keeps the restore button when the track cannot be edited" is green before the change: it guards the `editable` condition. Show it red once by writing `{!maximized && <SectionHeader …/>}` in Step 4 first, record that in the ledger, then write the version below.

- [ ] **Step 3: Add the short save label**

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-calma-t2.json`:

```json
{
  "es": { "editor": { "cues": { "saveShort": "Guardar" } } },
  "en": { "editor": { "cues": { "saveShort": "Save" } } },
  "de": { "editor": { "cues": { "saveShort": "Speichern" } } },
  "fr": { "editor": { "cues": { "saveShort": "Enregistrer" } } },
  "pt-BR": { "editor": { "cues": { "saveShort": "Salvar" } } }
}
```

Merge it with `learn-merge.cjs` as in Task 1. Every full label contains its short one, so the accessible name keeps the visible word.

- [ ] **Step 4: Rewrite the layout**

In `src/renderer/src/components/CuesSection.tsx`:

Replace `import { Keyboard } from 'lucide-react'` with `import { Keyboard, Minimize2 } from 'lucide-react'`, and add `import { formatTime } from '../lib/duration'` among the `../lib/` imports.

In `Editing`'s destructuring add `onRestore,` after `onDiscard,` and in its props type add `onRestore: () => void` after `onDiscard: () => void`.

Replace everything from

```tsx
  const waveCues = state.cues.map((c) => ({
```

to the closing `}` of `Editing` (the line before `export function CuesSection`) with the text below. The range includes the `cues-flow-row` block Task 1 wrote, which disappears into `actions`.

```tsx
  const waveCues = state.cues.map((c) => ({
    ...c,
    pending: pending(c),
    locked: state.locked.includes(c.key),
  }))
  const save = () => {
    void window.api
      .saveRekordboxCues({
        contentId: cue.contentId,
        path: cue.path,
        label: cue.label,
        wanted,
        fingerprint: read.fingerprint,
      })
      .then(refreshQueued)
  }
  const actions = (
    <div data-testid="cues-actions" className="flex flex-wrap items-center gap-2">
      <div className="flex">
        <button
          type="button"
          data-testid="cues-apply-flow"
          aria-pressed={noDrop ? armed : undefined}
          onClick={primary}
          className="press h-8 whitespace-nowrap rounded-l-lg bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          {noDrop ? tr('editor.cues.markDrop') : tr('editor.cues.apply', { name: shownName })}
        </button>
        <Select
          testid="cues-flow"
          split
          label={tr('editor.cues.flow')}
          value={shownFlow}
          onChange={pickFlow}
          options={flows.map((f) => ({ value: f.id, label: flowName(f, tr), short: '' }))}
        />
      </div>
      {armed && (
        <span data-testid="cues-arm-hint" role="status" className="text-xs text-fg-dim">
          {tr('editor.cues.armHint')}
        </span>
      )}
      <span className="flex-1" />
      {(!unchanged || queued !== null) && (
        <button
          type="button"
          data-testid="cues-undo"
          onClick={onDiscard}
          className="press whitespace-nowrap px-2 py-1.5 text-xs text-fg-dim hover:text-fg"
        >
          {tr('editor.cues.discard')}
        </button>
      )}
      <button
        type="button"
        data-testid="cues-save"
        disabled={unchanged}
        aria-label={maximized ? undefined : tr('editor.cues.save')}
        onClick={save}
        className="press h-8 whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 text-xs font-semibold text-fg hover:bg-[var(--color-hover)] disabled:opacity-40"
      >
        {maximized ? tr('editor.cues.save') : tr('editor.cues.saveShort')}
      </button>
    </div>
  )
  const header = (
    <div data-testid="cues-header" className="flex shrink-0 items-center gap-3.5">
      {track?.cover ? (
        <img src={track.cover} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <div aria-hidden="true" className="h-10 w-10 shrink-0 rounded-md bg-[var(--color-panel-2)]" />
      )}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold text-fg">{track?.title || cue.label}</div>
        <div className="truncate text-xs text-fg-dim">{track?.artist}</div>
      </div>
      <div
        data-testid="cues-meta"
        className="ml-2 flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-fg-faint"
      >
        <span data-testid="cues-duration">{formatTime(read.durationMs / 1000)}</span>
        {track?.bpm && (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="cues-bpm">{tr('editor.cues.bpm', { bpm: track.bpm })}</span>
          </>
        )}
        {track?.key && (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="cues-key">{track.key}</span>
          </>
        )}
      </div>
      <span data-testid="cues-position" className="font-mono text-[13px] tabular-nums text-fg">
        {cueClock(playheadMs)}
      </span>
      <span className="flex-1" />
      {actions}
      <CueKeys jumpBars={settings.cueJumpBars} onClose={focusEditor} />
      <button
        type="button"
        data-testid="section-maximize"
        aria-label={tr('editor.sectionRestore')}
        aria-pressed="true"
        onClick={onRestore}
        className="press flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-dim hover:text-fg"
      >
        <Minimize2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
  return (
    <fieldset
      ref={editorRef}
      data-testid="cues-editor"
      data-maximized={maximized ? 'true' : 'false'}
      tabIndex={maximized ? -1 : undefined}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 outline-none ${maximized ? 'flex min-h-0 flex-1 flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
      {maximized && header}
      <CueWave
        wave={read.wave}
        grid={read.grid}
        durationMs={read.durationMs}
        cues={waveCues}
        selected={state.selected}
        trimmed={state.trimmed}
        onMarkDrop={markDrop}
        onUnmarkDrop={(key) => dispatch({ type: 'unmark-drop', key })}
        onSelect={(key) => dispatch({ type: 'select', key })}
        onMove={(key, ms) => dispatch({ type: 'move', key, ms })}
        onMenu={setMenu}
        playheadMs={maximized ? playheadMs : undefined}
        onSeek={maximized && !armed ? seekTo : undefined}
      />
      {!maximized && <div className="mt-3">{actions}</div>}
      {maximized && (
        <CueWaveDetail
          source={source}
          grid={read.grid}
          cues={waveCues}
          selected={state.selected}
          playheadMs={playheadMs}
          bars={zoom}
          onScrub={seekTo}
          onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
          onPick={armed ? markDrop : undefined}
        />
      )}
      {menu !== null && (
        <div
          ref={menuRef}
          data-testid="cues-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="absolute z-20 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs shadow-[var(--shadow-float)]"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-add-hot"
            disabled={state.cues.filter((c) => c.kind !== 0).length >= MAX_HOT_CUES}
            onClick={() => fromMenu({ type: 'add-hot', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuAddHot')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-add-call"
            onClick={() => fromMenu({ type: 'add-call', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuAddCall')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-mark-drop"
            onClick={() => fromMenu({ type: 'mark-drop', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuMarkDrop')}
          </button>
        </div>
      )}
      {selected && !maximized && (
        <div
          data-testid="cues-selection"
          className="mt-2 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="font-medium">
            {selected.kind === 0
              ? tr('editor.cues.selectedCall')
              : tr('editor.cues.selectedHot', { letter: cueLetter(selected.kind) })}
          </span>
          {state.locked.includes(selected.key) && (
            <span data-testid="cues-loop" className="text-fg-dim">
              {tr('editor.cues.loop')}
            </span>
          )}
          {selected.kind !== 0 && !state.locked.includes(selected.key) && (
            <div ref={colourRef} className="relative">
              <button
                type="button"
                data-testid="cues-colour"
                aria-label={tr('editor.cues.colourPicker')}
                aria-haspopup="true"
                aria-expanded={colourOpen}
                onClick={() => setColourFor(colourOpen ? null : selected.key)}
                style={{ backgroundColor: hotCueColor(selected.color) }}
                className="press block h-6 w-6 rounded-[3px] border border-[var(--color-line-strong)]"
              />
              {colourOpen && (
                <div
                  data-testid="cues-colour-popover"
                  className="absolute z-20 mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]"
                >
                  <CuePalette
                    value={selected.color}
                    onPick={(color) => {
                      dispatch({ type: 'recolour', key: selected.key, color })
                      setColourFor(null)
                      focusEditor()
                    }}
                    label={(index) => tr('editor.cues.colour', { index })}
                  />
                </div>
              )}
            </div>
          )}
          {!state.locked.includes(selected.key) && (
            <button
              type="button"
              data-testid="cues-delete"
              onClick={() => dispatch({ type: 'remove', key: selected.key })}
              className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1 hover:bg-[var(--color-hover)]"
            >
              {tr('editor.cues.delete')}
            </button>
          )}
        </div>
      )}
      {queued !== null && !fresh && (
        <p data-testid="cues-queued-stale" className="mt-2 text-xs text-warn">
          {tr('editor.cues.queuedStale')}
        </p>
      )}
      {state.notice === 'manual' && (
        <p data-testid="cues-manual" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.manual')}
        </p>
      )}
      {state.notice === 'too-many' && (
        <p data-testid="cues-too-many" className="mt-2 text-xs text-warn">
          {tr('editor.cues.tooMany')}
        </p>
      )}
      {state.trimmed.length > 0 && (
        <p data-testid="cues-trimmed" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.trimmed', { count: state.trimmed.length })}
        </p>
      )}
      {maximized && (
        <CueDeck
          cues={state.cues}
          selected={state.selected}
          locked={state.locked}
          jumpBars={settings.cueJumpBars}
          onPad={pad}
          onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onMemoryRemove={memoryRemove}
          canRemoveMemory={callHere !== undefined}
          onJumpBars={(bars) => onJumpBars?.(bars)}
          onDone={focusEditor}
        />
      )}
    </fieldset>
  )
}
```

(The selection row loses only the empty `<>…</>` fragment it had around the colour block; its content is the same.)

Replace the whole `CuesSection` component (from `export function CuesSection({` to the end of the file) with:

```tsx
export function CuesSection({
  cue,
  open,
  onToggle,
  track,
  onJumpBars,
}: {
  cue: CueTarget
  open: boolean
  onToggle: () => void
  track?: CueTrackInfo
  onJumpBars?: (bars: CueJumpBars) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const { data: read, isError } = useTrackCues(cue.contentId)
  const { data: queued } = useQueuedCues(cue.contentId)
  const { maximized: whole, setMaximized } = useMaximizedSection()
  const maximized = open && whole === 'cues'
  const [round, setRound] = useState(0)
  const draftKey = `${cue.contentId}|${read?.fingerprint ?? ''}|${JSON.stringify(queued)}`
  const [head, setHead] = useState(() => ({
    contentId: cue.contentId,
    ms: keptPlayhead(cue.contentId),
  }))
  const playheadMs = head.contentId === cue.contentId ? head.ms : 0
  const follow = (ms: number) => {
    setHead({ contentId: cue.contentId, ms })
    keepPlayhead(cue.contentId, ms)
  }
  const audition = useCueAudition(cue.path, maximized, follow)
  const moveHead = (ms: number) => {
    follow(ms)
    audition.seek(ms)
  }
  const toggle = useRef(() => {})
  toggle.current = () => audition.toggle(playheadMs)
  useEffect(() => {
    if (!maximized) return
    return claimKeys({ ...HIDDEN_SECTION_KEYS, play: () => toggle.current() }, { over: true })
  }, [maximized])
  const editable =
    !isError &&
    read !== undefined &&
    read !== null &&
    queued !== undefined &&
    read.analysed &&
    read.grid.length > 0
  const full = maximized && editable
  const body =
    isError || read === null ? (
      <p data-testid="cues-unreadable" className="text-xs text-fg-dim">
        {tr('editor.cues.unreadable')}
      </p>
    ) : read === undefined || queued === undefined ? null : !read.analysed ||
      read.grid.length === 0 ? (
      <p data-testid="cues-unanalysed" className="text-xs text-fg-dim">
        {tr('editor.cues.unanalysed')}
      </p>
    ) : (
      <Editing
        key={`${draftKey}|${round}`}
        read={read}
        queued={queued}
        cue={cue}
        draftKey={draftKey}
        maximized={maximized}
        track={track}
        playheadMs={playheadMs}
        onPlayhead={moveHead}
        audition={audition}
        onJumpBars={onJumpBars}
        onRestore={() => setMaximized(null)}
        onDiscard={() => {
          forgetDraft()
          setRound((n) => n + 1)
          if (queued !== null)
            void window.api
              .undoRekordboxCues(cue.contentId)
              .then(() => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] }))
        }}
      />
    )
  return (
    <div
      data-testid="cues-section"
      className={full ? 'flex h-full flex-col' : 'mt-6 border-t border-[var(--color-line)] pt-6'}
    >
      {!full && (
        <SectionHeader
          sectionId="cues"
          maximizable
          title={tr('editor.cues.title')}
          open={open}
          onToggle={onToggle}
          help={tr('editor.cues.help')}
        />
      )}
      {full ? (
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      ) : (
        <SectionBody open={open}>
          <div className="mt-3">{body}</div>
        </SectionBody>
      )}
    </div>
  )
}
```

The overlay in `Editor.tsx` (`fixed inset-0 … px-8 pb-8 pt-2`) gives the section a definite height, so `h-full` and the `flex-1` chain reach the zoomed wave in Task 4. `Editor.tsx` itself does not change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/CuesSection.dedupe.test.tsx src/renderer/src/components/Editor.test.tsx src/renderer/src/i18n`
Expected: PASS, none skipped. `Editor.test.tsx` "Editor cues section" still finds `cues-header` with "120 BPM" and "6A" inside the overlay.

- [ ] **Step 6: Types, lint, commit**

Both `tsc`, `check`, `git -C $WT status --short`.

```bash
git -C $WT add apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C $WT commit -m "Put the cue editor on one calm top bar with Guardar beside the flow"
```

---

### Task 3: The overview as a navigator strip

**Files:**
- Modify: `src/renderer/src/components/CueWave.tsx` (rewritten below)
- Modify: `src/renderer/src/lib/cueWave.ts` (remove `dropLabels` and `LABEL_SPAN`)
- Modify: `src/renderer/src/components/CuesSection.tsx` (the `CueWave` element and the `cuePlayhead` import)
- Test: `src/renderer/src/components/CueWave.test.tsx`, `src/renderer/src/lib/cueWave.test.ts`, `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `detailWindow(beats: number[], ms: number, bars: number): { fromMs: number; toMs: number }` from `lib/cuePlayhead.ts`; `barLines(grid)` (`strong` every 16 bars).
- Produces: `CueWave` prop `view?: { fromMs: number; toMs: number }`; `onSeek` now also follows a drag. `GRID_LINE` and `GridCaps` stay exported from `CueWave.tsx` for `CueWaveDetail` until Task 4 removes them.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/CueWave.test.tsx`:

Change the import `import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'` to `import { cleanup, fireEvent, render, screen } from '@testing-library/react'` and delete the `drop(ms, pending)` helper function (both stop being used).

In "draws hot cues as lettered squares in rekordbox colours and CALLs behind them at their height", replace the last five lines

```tsx
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('DROP')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveAttribute('data-pending', 'true')
    expect(screen.queryByTestId('cue-wave-drop-16000')).toBeNull()
    expect(
      screen.getAllByTestId('cue-wave-bar').filter((b) => b.dataset.strong === 'true'),
    ).toHaveLength(3)
```

with

```tsx
    expect(dropCall).toHaveAttribute('data-pending', 'true')
    expect(paired).toHaveAttribute('data-pending', 'false')
    expect(screen.getByTestId('cue-wave')).not.toHaveTextContent('DROP')
```

Replace "lets the half wave reach the bottom edge and lays the drop labels over it, so no band under the wave goes to waste" with

```tsx
  it('lets the half wave reach the bottom edge, so no band under the wave goes to waste', () => {
    setup()
    expect(screen.getByTestId('cue-wave-area').style.bottom).toBe('0px')
  })
```

Replace "caps only the phrase lines of the overview, where a cap on every bar would grey out the whole wave" with

```tsx
  it('marks only every 16 bars with a small tick at the bottom, so the strip reads as a navigator and not a grid', () => {
    setup()
    expect(screen.queryAllByTestId('cue-wave-bar')).toHaveLength(0)
    expect(screen.getAllByTestId('cue-wave-tick').map((t) => t.style.left)).toEqual([
      '0%',
      '40%',
      '80%',
    ])
  })
```

Replace "shows where the drop will land while hovering" with

```tsx
  it('shows where the drop will land while hovering, as a bare line with no label over the wave', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost').style.left).toBe('12.5%')
    expect(screen.getByTestId('cue-wave-ghost').textContent).toBe('')
  })
```

Delete the tests "names the beat the hover will take, so the user can tell which of the beats under the pointer it is", "names where each drop sits", "turns the label of a drop near the end to the left so the edge does not cut it" and "stacks the labels of two close drops instead of drawing them over each other".

Add at the end of `describe('CueWave', …)`:

```tsx
  it('shows the part the zoomed wave shows as a soft rectangle', () => {
    setup({
      onSeek: vi.fn<(ms: number) => void>(),
      playheadMs: 20000,
      view: { fromMs: 12000, toMs: 28000 },
    })
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('15%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('20%')
  })

  it('cuts the rectangle at the start of the track instead of drawing it off the strip', () => {
    setup({
      onSeek: vi.fn<(ms: number) => void>(),
      playheadMs: 0,
      view: { fromMs: -8000, toMs: 8000 },
    })
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('0%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('10%')
  })

  it('moves the playhead while the strip is dragged and stops on release', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 400 })
    fireEvent.mouseUp(window, { clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 600 })
    expect(onSeek.mock.calls).toEqual([[10000], [40000]])
  })

  it('moves a mark instead of the playhead when the drag starts on it', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    const h = setup({ onSeek, playheadMs: 0 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { button: 0, clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    fireEvent.mouseUp(window, { clientX: 243 })
    expect(onSeek).not.toHaveBeenCalled()
    expect(h.onMove).toHaveBeenCalledWith('a', 24500)
  })
```

In `src/renderer/src/lib/cueWave.test.ts`, change the import to `import { barLines, clickAction, cuePosition } from './cueWave'` and delete the whole `describe('dropLabels', () => { … })` block (the last block of the file).

In `src/renderer/src/components/CuesSection.maximized.test.tsx`: in "stays the section of today while folded into the column" replace `cue-wave-drop-128000` with `cue-wave-call-128000`; in "moves the playhead with a click on the overview instead of marking a drop" replace `cue-wave-drop-100000` with `cue-wave-call-100000`; and add to `describe('CuesSection maximized', …)`:

```tsx
  it('shows on the overview the part the zoomed wave shows, and follows the zoom', async () => {
    setup()
    await maximize()
    seek(56000)
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('10%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('8%')
    editor().focus()
    key('+')
    expect(screen.getByTestId('cue-wave-view').style.left).toBe('12%')
    expect(screen.getByTestId('cue-wave-view').style.width).toBe('4%')
  })

  it('draws no rectangle on the folded strip, where there is no zoomed wave', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cue-wave-view')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueWave.test.tsx src/renderer/src/lib/cueWave.test.ts src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL on the "DROP" text, `data-pending` on CALLs, `cue-wave-tick`, the ghost's label, `cue-wave-view` (CueWave and section tests) and the drag (only the click seeks today). The two `cue-wave-drop-*` → `cue-wave-call-*` replacements in the maximized file already pass (a drop is a lone CALL), and `cueWave.test.ts` passes (only deletions).

- [ ] **Step 3: Rewrite `CueWave.tsx`**

Replace the whole file `src/renderer/src/components/CueWave.tsx` with:

```tsx
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { CueWaveColumn } from '../../../shared/types'
import { markStyle, placeCues, WAVE_MARK_LANE_PX } from '../lib/cueMarks'
import { barLines, clickAction, cuePosition } from '../lib/cueWave'

export interface WaveCue {
  key: string
  ms: number
  kind: number
  color: number | null
  pending: boolean
  locked?: boolean
}

export const GRID_LINE = 'bg-[var(--color-fg-dim)]/60'

export function GridCaps(): React.JSX.Element {
  return (
    <>
      <span
        data-testid="cue-grid-cap"
        className="absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[3px] border-t-[4px] border-x-transparent border-t-[var(--color-fg-dim)]"
      />
      <span
        data-testid="cue-grid-cap"
        className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[3px] border-b-[4px] border-x-transparent border-b-[var(--color-fg-dim)]"
      />
    </>
  )
}

const HIT_PX = 6
const DRAG_PX = 3

export function CueWave({
  wave,
  grid,
  durationMs,
  cues,
  selected,
  proposals,
  trimmed,
  readOnly,
  onMarkDrop,
  onUnmarkDrop,
  onSelect,
  onMove,
  onMenu,
  onAcceptProposal,
  playheadMs,
  onSeek,
  view,
}: {
  wave: CueWaveColumn[] | null
  grid: { ms: number; beat: number }[]
  durationMs: number
  cues: WaveCue[]
  selected?: string | null
  proposals?: number[]
  trimmed?: number[]
  readOnly?: boolean
  onMarkDrop?: (ms: number) => void
  onUnmarkDrop?: (key: string) => void
  onSelect?: (key: string | null) => void
  onMove?: (key: string, ms: number) => void
  onMenu?: (at: { ms: number; x: number; y: number }) => void
  onAcceptProposal?: (ms: number) => void
  playheadMs?: number
  onSeek?: (ms: number) => void
  view?: { fromMs: number; toMs: number }
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const swallowClick = useRef(false)
  const [ghost, setGhost] = useState<number | null>(null)
  const dragRef = useRef<{ key: string; x0: number; ms: number | null } | null>(null)
  const [dragMs, setDragMs] = useState<number | null>(null)
  const [armed, setArmed] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const beatsMs = grid.map((b) => b.ms)
  const latest = useRef({ beatsMs, durationMs, onMove, onSeek })
  latest.current = { beatsMs, durationMs, onMove, onSeek }
  useEffect(() => {
    if (readOnly) setGhost(null)
  }, [readOnly])
  const msAtX = useCallback((clientX: number): number => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    return (x / Math.max(rect.width, 1)) * latest.current.durationMs
  }, [])
  useEffect(() => {
    if (!armed) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d || Math.abs(e.clientX - d.x0) <= DRAG_PX) return
      const beats = latest.current.beatsMs
      d.ms = beats[nearestBeat(beats, msAtX(e.clientX))]
      setDragMs(d.ms)
    }
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setArmed(false)
      setDragMs(null)
      if (!d || d.ms === null) return
      swallowClick.current = true
      setTimeout(() => {
        swallowClick.current = false
      }, 0)
      latest.current.onMove?.(d.key, d.ms)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [armed, msAtX])
  useEffect(() => {
    if (!seeking) return
    const move = (e: MouseEvent) => latest.current.onSeek?.(msAtX(e.clientX))
    const up = () => setSeeking(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [seeking, msAtX])
  const waveSvg = useMemo(
    () =>
      wave && (
        <svg
          viewBox={`0 0 ${wave.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full opacity-70"
        >
          {wave.map((c, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              key={i}
              x={i}
              width={1}
              y={100 - Math.max(c.h * 100, 0.5)}
              height={Math.max(c.h * 100, 0.5)}
              fill="var(--color-accent)"
            />
          ))}
        </svg>
      ),
    [wave],
  )
  const ticks = useMemo(
    () =>
      barLines(grid)
        .filter((b) => b.strong)
        .map((b) => (
          <span
            key={b.ms}
            data-testid="cue-wave-tick"
            aria-hidden="true"
            style={{ left: `${(b.ms / Math.max(durationMs, 1)) * 100}%` }}
            className="absolute bottom-0 h-[3px] w-px bg-[var(--color-fg-faint)]"
          />
        )),
    [grid, durationMs],
  )
  if (grid.length === 0) {
    return (
      <div
        data-testid="cue-wave-not-analysed"
        className="flex h-16 w-full items-center justify-center rounded-md bg-[var(--color-panel-2)] px-4 text-center text-xs text-[var(--color-fg-faint)]"
      >
        {t('cueWave.notAnalysed')}
      </div>
    )
  }
  const { hot, calls } = placeCues(cues, durationMs)
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const drops = calls.filter((c) => !c.paired)
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const shown = view && {
    from: Math.max(view.fromMs, 0),
    to: Math.min(view.toMs, durationMs),
  }
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ms = msAtX(e.clientX)
    const tolerance = (HIT_PX / Math.max(rect.width, 1)) * durationMs
    const action = clickAction(
      ms,
      beatsMs,
      drops.map((d) => d.ms),
      tolerance,
    )
    return { ...action, key: drops.find((d) => d.ms === action.ms)?.key }
  }
  const startDrag = (key: string, e: React.MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey) return
    e.stopPropagation()
    onSelect?.(key)
    if (cues.some((c) => c.key === key && c.locked)) return
    dragRef.current = { key, x0: e.clientX, ms: null }
    setArmed(true)
  }
  const selectMark = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.(key)
  }
  return (
    <div
      ref={rootRef}
      data-testid="cue-wave"
      role="application"
      aria-label={t('cueWave.label')}
      tabIndex={readOnly ? -1 : 0}
      onMouseDown={(e) => {
        if (readOnly || !onSeek || e.button !== 0 || e.ctrlKey) return
        onSeek(msAtX(e.clientX))
        setSeeking(true)
      }}
      onClick={(e) => {
        if (readOnly || swallowClick.current) return
        if (onSeek) {
          onSeek(msAtX(e.clientX))
          return
        }
        setGhost(null)
        onSelect?.(null)
        const action = at(e)
        if (action.kind === 'remove' && action.key !== undefined) onUnmarkDrop?.(action.key)
        else onMarkDrop?.(action.ms)
      }}
      onKeyDown={(e) => {
        if (readOnly || e.target !== e.currentTarget || e.key !== 'Enter' || ghost === null) return
        onMarkDrop?.(ghost)
      }}
      onContextMenu={(e) => {
        if (readOnly) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        onMenu?.({
          ms: beatsMs[nearestBeat(beatsMs, msAtX(e.clientX))],
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }}
      onMouseMove={(e) => {
        if (readOnly || onSeek) return
        const action = at(e)
        setGhost(action.kind === 'add' ? action.ms : null)
      }}
      onMouseLeave={() => setGhost(null)}
      className={`relative h-16 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        readOnly ? 'cursor-default' : onSeek ? 'cursor-pointer' : 'cursor-crosshair'
      }`}
    >
      <div
        data-testid="cue-wave-area"
        aria-hidden="true"
        style={{ top: `${WAVE_MARK_LANE_PX}px`, bottom: '0px' }}
        className="pointer-events-none absolute inset-x-0"
      >
        {shown && (
          <span
            data-testid="cue-wave-view"
            style={{ left: pct(shown.from), width: pct(shown.to - shown.from) }}
            className="absolute top-0 bottom-0 bg-[var(--color-fg)]/10"
          />
        )}
        {waveSvg}
        {ticks}
        {playheadMs !== undefined && (
          <span
            data-testid="cue-wave-playhead"
            style={{ left: pct(playheadMs) }}
            className="absolute top-0 bottom-0 w-px bg-[var(--color-fg)]"
          />
        )}
      </div>
      {(trimmed ?? []).map((ms) => (
        <span
          key={`t${ms}`}
          data-testid={`cue-wave-trimmed-${ms}`}
          aria-hidden="true"
          style={markStyle((ms / Math.max(durationMs, 1)) * 100)}
          className="absolute h-3.5 w-3.5 rounded-[3px] border border-dashed border-[var(--color-fg-faint)]"
        />
      ))}
      {!readOnly &&
        (proposals ?? []).map((ms) => (
          <button
            key={`p${ms}`}
            type="button"
            data-testid={`cue-wave-proposal-${ms}`}
            aria-label={t('cueWave.proposal', { bar: cuePosition(ms, grid).bar })}
            style={{ left: pct(ms), top: `${WAVE_MARK_LANE_PX}px` }}
            className="absolute bottom-0 w-2 -translate-x-1/2 border-l border-dashed border-[var(--color-fg)]/70"
            onClick={(e) => {
              e.stopPropagation()
              onAcceptProposal?.(ms)
            }}
          />
        ))}
      {calls.map((c) => {
        const pending = pendingOf.get(c.key) ?? false
        const isSelected = selected === c.key
        const common = {
          'data-testid': `cue-wave-call-${c.ms}`,
          'data-paired': c.paired ? 'true' : 'false',
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: { ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR },
          className: `absolute h-0 w-0 border-x-[5px] border-x-transparent ${
            isSelected ? 'border-t-[10px]' : 'border-t-[7px]'
          } ${pending ? 'opacity-60' : ''}`,
        }
        return readOnly ? (
          <span key={`c${c.key}`} aria-hidden="true" {...common} />
        ) : (
          <button
            key={`c${c.key}`}
            type="button"
            aria-label={t('cueWave.call')}
            onMouseDown={(e) => startDrag(c.key, e)}
            onClick={(e) => selectMark(c.key, e)}
            {...common}
          />
        )
      })}
      {hot.map((h) => {
        const pending = pendingOf.get(h.key) ?? false
        const isSelected = selected === h.key
        const common = {
          'data-testid': `cue-wave-hot-${h.letter}`,
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: {
            ...markStyle(h.at),
            ...(pending
              ? { borderColor: h.colour, color: h.colour }
              : { backgroundColor: h.colour, color: '#000' }),
          },
          className: `absolute h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] ${
            pending ? 'border' : ''
          } ${isSelected ? 'ring-2 ring-[var(--color-fg)]' : ''}`,
        }
        return readOnly ? (
          <span key={`h${h.key}`} aria-hidden="true" {...common}>
            {h.letter}
          </span>
        ) : (
          <button
            key={`h${h.key}`}
            type="button"
            aria-label={t('cueWave.hotCue', { letter: h.letter })}
            onMouseDown={(e) => startDrag(h.key, e)}
            onClick={(e) => selectMark(h.key, e)}
            {...common}
          >
            {h.letter}
          </button>
        )
      })}
      {dragMs !== null && (
        <span
          data-testid="cue-wave-drag-ghost"
          aria-hidden="true"
          style={{ left: pct(dragMs) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/70"
        />
      )}
      {ghost !== null && (
        <span
          data-testid="cue-wave-ghost"
          aria-hidden="true"
          style={{ left: pct(ghost), top: `${WAVE_MARK_LANE_PX}px` }}
          className="pointer-events-none absolute bottom-0 w-px border-l border-dashed border-[var(--color-fg)]/70"
        />
      )}
    </div>
  )
}
```

The `'#000'` on the hot squares and the existing `biome-ignore` are carried over unchanged from HEAD (the palette test reads them as today).

- [ ] **Step 4: Remove `dropLabels`**

In `src/renderer/src/lib/cueWave.ts` delete everything from `const LABEL_SPAN = 0.12` to the end of `dropLabels` (the end of the file). `rg -n "dropLabels" $WT/apps/desktop/src` must print nothing.

- [ ] **Step 5: Hand the strip the zoomed window**

In `src/renderer/src/components/CuesSection.tsx` replace

```tsx
  DEFAULT_ZOOM_BARS,
  jumpBeats,
```

with

```tsx
  DEFAULT_ZOOM_BARS,
  detailWindow,
  jumpBeats,
```

and in the `CueWave` element replace

```tsx
        onSeek={maximized && !armed ? seekTo : undefined}
      />
```

with

```tsx
        onSeek={maximized && !armed ? seekTo : undefined}
        view={maximized ? detailWindow(ctx.beats, playheadMs, zoom) : undefined}
      />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueWave.test.tsx src/renderer/src/lib/cueWave.test.ts src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/CueWaveDetail.test.tsx src/renderer/src/components/settings src/renderer/src/index.css.test.ts`
Expected: PASS, none skipped (the settings tests cover `CueFlowPreview`, which shares the strip).

- [ ] **Step 7: Types, lint, commit**

```bash
git -C $WT add apps/desktop/src/renderer/src/components/CueWave.tsx apps/desktop/src/renderer/src/lib/cueWave.ts apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CueWave.test.tsx apps/desktop/src/renderer/src/lib/cueWave.test.ts apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx
git -C $WT commit -m "Turn the cue overview into a slim navigator strip"
```

---

### Task 4: The zoomed wave fills the free height

**Files:**
- Modify: `src/renderer/src/lib/cuePlayhead.ts` (`WHEEL_ZOOM_STEP`, `wheelZoom`, `ZOOM_BARS` private)
- Modify: `src/renderer/src/components/CueWaveDetail.tsx` (rewritten below)
- Modify: `src/renderer/src/components/CueWave.tsx` (remove `GRID_LINE`, `GridCaps`)
- Modify: `src/renderer/src/components/CuesSection.tsx` (header position span, `cueClock` import)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `src/renderer/src/lib/cuePlayhead.test.ts`, `src/renderer/src/components/CueWaveDetail.test.tsx`, `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: Task 1's `onPick`; `barsToNextCall`, `cueClock`, `detailWindow` from `lib/cuePlayhead.ts`.
- Produces: `WHEEL_ZOOM_STEP = 40`, `wheelZoom(pending: number, deltaY: number): { pending: number; dir: 'in' | 'out' | null }`; `CueWaveDetail` props unchanged from Task 1 (`source, grid, cues, selected, playheadMs, bars, onScrub, onZoom, onPick?`); `cues-position` rendered by `CueWaveDetail`; keys `editor.cues.toCall_one`/`_other` (`{{count}}`); `toCall`, `zoomIn`, `zoomOut` removed.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/lib/cuePlayhead.test.ts` add `WHEEL_ZOOM_STEP` and `wheelZoom` to the import list and append:

```ts
describe('wheelZoom', () => {
  it('zooms in one step once a pinch or ⌘ wheel has gone far enough, and starts counting again', () => {
    expect(WHEEL_ZOOM_STEP).toBe(40)
    expect(wheelZoom(0, -10)).toEqual({ pending: -10, dir: null })
    expect(wheelZoom(-10, -10)).toEqual({ pending: -20, dir: null })
    expect(wheelZoom(-30, -10)).toEqual({ pending: 0, dir: 'in' })
    expect(wheelZoom(0, 60)).toEqual({ pending: 0, dir: 'out' })
  })

  it('starts again when the fingers turn back, so a hesitation never zooms the wrong way', () => {
    expect(wheelZoom(-30, 15)).toEqual({ pending: 15, dir: null })
    expect(wheelZoom(30, -15)).toEqual({ pending: -15, dir: null })
  })
})
```

In `src/renderer/src/components/CueWaveDetail.test.tsx`:

Replace "caps every bar line at both ends as rekordbox does, so the grid reads over a loud wave" with

```tsx
  it('draws a soft line per bar and a notch at the bottom only every 16 bars, with no loose beats', () => {
    setup()
    const lines = screen.getAllByTestId('cue-detail-bar')
    expect(lines).toHaveLength(17)
    const strong = lines.filter((l) => l.dataset.strong === 'true')
    expect(strong).toHaveLength(1)
    expect(within(strong[0]).getAllByTestId('cue-detail-notch')).toHaveLength(1)
    expect(screen.getAllByTestId('cue-detail-notch')).toHaveLength(1)
    expect(screen.queryAllByTestId('cue-grid-cap')).toHaveLength(0)
  })
```

Replace "says how many bars are left to the next CALL, as rekordbox does above the playhead" with

```tsx
  it('shows the playhead time left of the centre and the bars to the CALL right of it, in a row above the wave so nothing sits on it', () => {
    setup({ cues: [{ key: 'd', ms: bar(48), kind: 0, color: null, pending: false }] })
    expect(screen.getByTestId('cues-position')).toHaveTextContent('1:04.0')
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('16 bars to the CALL')
    expect(screen.getByTestId('cue-detail')).not.toContainElement(
      screen.getByTestId('cues-position'),
    )
    expect(screen.getByTestId('cue-detail')).not.toContainElement(
      screen.getByTestId('cue-detail-to-call'),
    )
  })

  it('says one bar in the singular and keeps half a bar when the CALL sits off the bar', () => {
    const { rerender } = setup({
      cues: [{ key: 'd', ms: bar(33), kind: 0, color: null, pending: false }],
    })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('1 bar to the CALL')
    rerender({ cues: [{ key: 'd', ms: bar(40) + 1000, kind: 0, color: null, pending: false }] })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('8.5 bars to the CALL')
  })
```

Replace the two zoom button tests ("zooms with its buttons and stops at 4 and 64 bars", "stops zooming out at 64 bars") with

```tsx
  it('puts no buttons over the wave, zoom lives on the keys and the trackpad', () => {
    setup()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('zooms with a pinch or ⌘ and the wheel, one step per swipe, and leaves a plain wheel alone', () => {
    const { onZoom } = setup()
    const stage = screen.getByTestId('cue-detail')
    expect(fireEvent.wheel(stage, { deltaY: -60, ctrlKey: true })).toBe(false)
    expect(onZoom.mock.calls).toEqual([['in']])
    fireEvent.wheel(stage, { deltaY: 25, metaKey: true })
    expect(onZoom).toHaveBeenCalledTimes(1)
    fireEvent.wheel(stage, { deltaY: 25, metaKey: true })
    expect(onZoom.mock.calls).toEqual([['in'], ['out']])
    expect(fireEvent.wheel(stage, { deltaY: -200 })).toBe(true)
    expect(onZoom).toHaveBeenCalledTimes(2)
  })

  it('fills the height it is given, so the zoomed wave takes all the free room', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const fake = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    setup()
    const canvas = screen.getByTestId('cue-detail').querySelector('canvas') as HTMLCanvasElement
    expect(canvas.height).toBe(300)
  })
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx` add to `describe('CuesSection maximized keys', …)`:

```tsx
  it('zooms the zoomed wave with a pinch or ⌘ and the wheel', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.wheel(screen.getByTestId('cue-detail'), { deltaY: -60, ctrlKey: true })
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(9)
    fireEvent.wheel(screen.getByTestId('cue-detail'), { deltaY: 60, metaKey: true })
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(17)
  })

  it('shows the playhead time beside the playhead instead of in the top bar', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-header')).not.toContainElement(
      screen.getByTestId('cues-position'),
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cuePlayhead.test.ts src/renderer/src/components/CueWaveDetail.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL. `wheelZoom` is not exported; `cue-detail-notch`, `cues-position` in the detail, "16 bars to the CALL" (today "-16.0 bars…"), the buttons count (2), the wheel and the 300 px canvas (today 160) all fail; the header still holds `cues-position`.

- [ ] **Step 3: The wheel helper**

In `src/renderer/src/lib/cuePlayhead.ts` replace `export const ZOOM_BARS = [4, 8, 16, 32, 64] as const` with `const ZOOM_BARS = [4, 8, 16, 32, 64] as const` and append:

```ts
export const WHEEL_ZOOM_STEP = 40

export function wheelZoom(
  pending: number,
  deltaY: number,
): { pending: number; dir: 'in' | 'out' | null } {
  const sum = pending * deltaY < 0 ? deltaY : pending + deltaY
  if (sum <= -WHEEL_ZOOM_STEP) return { pending: 0, dir: 'in' }
  if (sum >= WHEEL_ZOOM_STEP) return { pending: 0, dir: 'out' }
  return { pending: sum, dir: null }
}
```

- [ ] **Step 4: Locale keys**

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-calma-t4.json`:

```json
{
  "es": { "editor": { "cues": { "toCall_one": "{{count}} compás al CALL", "toCall_other": "{{count}} compases al CALL" } } },
  "en": { "editor": { "cues": { "toCall_one": "{{count}} bar to the CALL", "toCall_other": "{{count}} bars to the CALL" } } },
  "de": { "editor": { "cues": { "toCall_one": "{{count}} Takt bis zum CALL", "toCall_other": "{{count}} Takte bis zum CALL" } } },
  "fr": { "editor": { "cues": { "toCall_one": "{{count}} mesure avant le CALL", "toCall_other": "{{count}} mesures avant le CALL" } } },
  "pt-BR": { "editor": { "cues": { "toCall_one": "{{count}} compasso até o CALL", "toCall_other": "{{count}} compassos até o CALL" } } }
}
```

Merge it with `learn-merge.cjs`, then delete with Edit:

| File | Lines to delete |
|---|---|
| `es.json` | `"toCall": "{{bars}} compases al CALL",`, `"zoomIn": "Acercar",`, `"zoomOut": "Alejar",` |
| `en.json` | `"toCall": "{{bars}} bars to the CALL",`, `"zoomIn": "Zoom in",`, `"zoomOut": "Zoom out",` |
| `de.json` | `"toCall": "{{bars}} Takte bis zum CALL",`, `"zoomIn": "Vergrößern",`, `"zoomOut": "Verkleinern",` |
| `fr.json` | `"toCall": "{{bars}} mesures avant le CALL",`, `"zoomIn": "Zoomer",`, `"zoomOut": "Dézoomer",` |
| `pt-BR.json` | `"toCall": "{{bars}} compassos até o CALL",`, `"zoomIn": "Aproximar",`, `"zoomOut": "Afastar",` |

- [ ] **Step 5: Rewrite `CueWaveDetail.tsx`**

Replace the whole file `src/renderer/src/components/CueWaveDetail.tsx` with:

```tsx
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { type DetailSource, visibleColumns } from '../lib/cueDetail'
import { markStyle, placeCues, WAVE_MARK_LANE_PX } from '../lib/cueMarks'
import { barsToNextCall, cueClock, detailWindow, wheelZoom } from '../lib/cuePlayhead'
import { barLines } from '../lib/cueWave'
import type { WaveCue } from './CueWave'

export function CueWaveDetail({
  source,
  grid,
  cues,
  selected,
  playheadMs,
  bars,
  onScrub,
  onZoom,
  onPick,
}: {
  source: DetailSource | null
  grid: { ms: number; beat: number }[]
  cues: WaveCue[]
  selected: string | null
  playheadMs: number
  bars: number
  onScrub: (ms: number) => void
  onZoom: (dir: 'in' | 'out') => void
  onPick?: (ms: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beats = useMemo(() => grid.map((b) => b.ms), [grid])
  const lines = useMemo(() => barLines(grid), [grid])
  const { fromMs, toMs } = detailWindow(beats, playheadMs, bars)
  const span = toMs - fromMs
  const latest = useRef({ span, onScrub, onZoom })
  latest.current = { span, onScrub, onZoom }
  const [drag, setDrag] = useState<{ x0: number; ms0: number; width: number } | null>(null)
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) =>
      latest.current.onScrub(drag.ms0 - ((e.clientX - drag.x0) / drag.width) * latest.current.span)
    const up = () => setDrag(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let pending = 0
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const step = wheelZoom(pending, e.deltaY)
      pending = step.pending
      if (step.dir) latest.current.onZoom(step.dir)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    if (!source) return
    const accent = getComputedStyle(canvas).getPropertyValue('--color-accent').trim()
    g.globalAlpha = 0.7
    visibleColumns(source, fromMs, toMs, width).forEach((column, x) => {
      if (!column) return
      const h = Math.max(column.h * height, 1)
      g.fillStyle = accent
      g.fillRect(x, (height - h) / 2, 1, h)
    })
  }, [source, fromMs, toMs])
  useEffect(draw, [draw])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [draw])
  const { hot, calls } = placeCues(
    cues.map((c) => ({ ...c, ms: c.ms - fromMs })),
    span,
  )
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const toCall = barsToNextCall(beats, cues, playheadMs)
  const pct = (ms: number): string => `${((ms - fromMs) / span) * 100}%`
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative h-4 shrink-0 text-xs tabular-nums">
        <span
          data-testid="cues-position"
          className="absolute right-1/2 mr-2 font-semibold whitespace-nowrap text-fg"
        >
          {cueClock(playheadMs)}
        </span>
        {toCall !== null && (
          <span
            data-testid="cue-detail-to-call"
            className="absolute left-1/2 ml-2 whitespace-nowrap text-fg-dim"
          >
            {t('editor.cues.toCall', { count: Number(toCall.toFixed(1)) })}
          </span>
        )}
      </div>
      <div
        ref={stageRef}
        data-testid="cue-detail"
        role="img"
        aria-label={t('editor.cues.detail')}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          const rect = stageRef.current?.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          if (onPick) onPick(fromMs + ((e.clientX - rect.left) / rect.width) * span)
          else setDrag({ x0: e.clientX, ms0: playheadMs, width: rect.width })
        }}
        className={`relative min-h-40 w-full flex-1 select-none overflow-hidden ${
          onPick ? 'cursor-crosshair' : 'cursor-grab'
        }`}
      >
        <canvas
          ref={canvasRef}
          style={{
            top: `${WAVE_MARK_LANE_PX}px`,
            height: `calc(100% - ${WAVE_MARK_LANE_PX}px)`,
          }}
          className="absolute inset-x-0 w-full"
        />
        {lines
          .filter((b) => b.ms >= fromMs && b.ms <= toMs)
          .map((b) => (
            <span
              key={b.ms}
              data-testid="cue-detail-bar"
              data-strong={b.strong ? 'true' : 'false'}
              aria-hidden="true"
              style={{ left: pct(b.ms), top: `${WAVE_MARK_LANE_PX}px` }}
              className={`absolute bottom-0 w-px ${
                b.strong ? 'bg-[var(--color-fg-dim)]/60' : 'bg-[var(--color-fg)]/10'
              }`}
            >
              {b.strong && (
                <span
                  data-testid="cue-detail-notch"
                  className="absolute bottom-0 left-1/2 h-[3px] w-[5px] -translate-x-1/2 bg-[var(--color-fg-dim)]"
                />
              )}
            </span>
          ))}
        {calls.map((c) => (
          <span
            key={`c${c.key}`}
            data-testid={`cue-detail-call-${c.ms + fromMs}`}
            data-pending={pendingOf.get(c.key) ? 'true' : 'false'}
            aria-hidden="true"
            style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR }}
            className={`absolute h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px] ${
              pendingOf.get(c.key) ? 'opacity-60' : ''
            }`}
          />
        ))}
        {hot.map((h) => {
          const pending = pendingOf.get(h.key) ?? false
          return (
            <span
              key={`h${h.key}`}
              data-testid={`cue-detail-hot-${h.letter}`}
              data-pending={pending ? 'true' : 'false'}
              data-selected={selected === h.key ? 'true' : 'false'}
              aria-hidden="true"
              style={{
                ...markStyle(h.at),
                ...(pending
                  ? { borderColor: h.colour, color: h.colour }
                  : { backgroundColor: h.colour, color: '#000' }),
              }}
              className={`absolute h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] ${
                pending ? 'border' : ''
              } ${selected === h.key ? 'ring-2 ring-[var(--color-fg)]' : ''}`}
            >
              {h.letter}
            </span>
          )
        })}
        <span
          data-testid="cue-detail-playhead"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px bg-[var(--color-fg)]"
        />
      </div>
    </div>
  )
}
```

`useMemo`, `useState`, `useCallback` stay in use; `Minus`, `Plus`, `ZOOM_BARS`, `GRID_LINE`, `GridCaps` and the `HEIGHT`/`ZOOM_BUTTON` constants are gone.

- [ ] **Step 6: Remove what nothing uses any more**

In `src/renderer/src/components/CueWave.tsx` delete the `export const GRID_LINE = …` line and the whole `export function GridCaps() { … }` component. `rg -n "GridCaps|GRID_LINE|cue-grid-cap" $WT/apps/desktop/src` must print only the `queryAllByTestId('cue-grid-cap')` line of the notch test.

In `src/renderer/src/components/CuesSection.tsx` delete the header block

```tsx
      <span data-testid="cues-position" className="font-mono text-[13px] tabular-nums text-fg">
        {cueClock(playheadMs)}
      </span>
```

and the line `  cueClock,` from the `../lib/cuePlayhead` import.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cuePlayhead.test.ts src/renderer/src/components/CueWaveDetail.test.tsx src/renderer/src/components/CueWave.test.tsx src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/i18n src/renderer/src/index.css.test.ts`
Expected: PASS, none skipped. The old "zooms the detail with + and −" (9 then 17 bars) still passes through the keys.

- [ ] **Step 8: Types, lint, commit**

```bash
git -C $WT add apps/desktop/src/renderer/src/lib/cuePlayhead.ts apps/desktop/src/renderer/src/lib/cuePlayhead.test.ts apps/desktop/src/renderer/src/components/CueWaveDetail.tsx apps/desktop/src/renderer/src/components/CueWaveDetail.test.tsx apps/desktop/src/renderer/src/components/CueWave.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C $WT commit -m "Let the zoomed cue wave fill the free height and zoom with the trackpad"
```

---

### Task 5: The bottom bar to correct by hand

**Files:**
- Modify: `src/renderer/src/components/CueDeck.tsx` (rewritten below)
- Modify: `src/renderer/src/components/CuesSection.tsx` (`memoryStep`, the `callHere`/`memoryRemove` block, the `CueDeck` element)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `src/renderer/src/components/CueDeck.test.tsx` (rewritten), `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `CueAudition.playing: boolean`, `CueAudition.toggle(fromMs)` from `hooks/useCueAudition.ts`; `adjacentCall`, `callAt` from `lib/cuePlayhead.ts`; `Select` (`bare`, `compact`, `portal`).
- Produces: `CueDeck` props `{ cues: DeckCue[]; selected: string | null; locked: string[]; jumpBars: CueJumpBars; playing: boolean; onPlay: () => void; onPad: (kind: number) => void; onRecolour: (key: string, color: number) => void; onMemory: () => void; onMemoryStep: (dir: 1 | -1) => void; onJumpBars: (bars: CueJumpBars) => void; onDone?: () => void }`; keys `editor.cues.play`, `editor.cues.pause`, `editor.cues.addCall`; `memory`, `memoryRemove`, `jumpLess`, `jumpMore` removed.

- [ ] **Step 1: Write the failing tests**

Replace the whole file `src/renderer/src/components/CueDeck.test.tsx` with:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CueJumpBars } from '../../../shared/cueJump'
import '../i18n'
import { CueDeck } from './CueDeck'

function setup(over: Partial<React.ComponentProps<typeof CueDeck>> = {}) {
  const handlers = {
    onPlay: vi.fn<() => void>(),
    onPad: vi.fn<(kind: number) => void>(),
    onRecolour: vi.fn<(key: string, color: number) => void>(),
    onMemory: vi.fn<() => void>(),
    onMemoryStep: vi.fn<(dir: 1 | -1) => void>(),
    onJumpBars: vi.fn<(bars: CueJumpBars) => void>(),
  }
  render(
    <CueDeck
      cues={[
        { key: 'a', kind: 1, color: 42 },
        { key: 'p', kind: 0, color: null },
      ]}
      selected="a"
      locked={[]}
      jumpBars={16}
      playing={false}
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

describe('CueDeck', () => {
  it('shows pads A to H, filled with their colour where a hot cue is and empty where none is, with no key hints', () => {
    setup()
    for (const letter of 'ABCDEFGH')
      expect(screen.getByTestId(`cues-pad-${letter}`)).toBeInTheDocument()
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('data-set', 'true')
    expect(screen.getByTestId('cues-pad-A')).toHaveStyle({ backgroundColor: '#e62828' })
    expect(screen.getByTestId('cues-pad-A').textContent).toBe('A')
    expect(screen.getByTestId('cues-pad-H').textContent).toBe('H')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('data-set', 'false')
    expect(screen.getByTestId('cues-pad-B').style.backgroundColor).toBe('')
  })

  it('marks the pad of the selected hot cue', () => {
    setup()
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'false')
  })

  it('hands the rekordbox letter of the pad, so D is kind 5', () => {
    const { onPad } = setup()
    fireEvent.click(screen.getByTestId('cues-pad-D'))
    expect(onPad).toHaveBeenCalledWith(5)
  })

  it('opens rekordbox picker on a right click on a pad with a hot cue and recolours it', () => {
    const { onRecolour } = setup()
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cues-pad-colours')).toBeInTheDocument()
    expect(screen.getByTestId('cue-palette-42')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-palette-5'))
    expect(onRecolour).toHaveBeenCalledWith('a', 5)
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
  })

  it('opens no picker on an empty pad or on a loop', () => {
    setup({ locked: ['a'] })
    fireEvent.contextMenu(screen.getByTestId('cues-pad-B'))
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
  })

  it('closes the picker with Escape or a click elsewhere', () => {
    setup()
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cues-pad-colours')).toBeNull()
  })

  it('keeps Escape from the window listener that restores the maximized section', () => {
    setup()
    const onWindowKey = vi.fn<(e: KeyboardEvent) => void>()
    window.addEventListener('keydown', onWindowKey)
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.keyDown(document, { key: 'Escape' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })

  it('walks the CALLs with ‹ › and puts one at the playhead with + CALL', () => {
    const h = setup()
    expect(screen.getByTestId('cues-memory')).toHaveTextContent('CALL')
    expect(screen.getByTestId('cues-memory')).toHaveAccessibleName('Add a CALL at the playhead')
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory-prev'))
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(h.onMemory).toHaveBeenCalledTimes(1)
    expect(h.onMemoryStep.mock.calls).toEqual([[-1], [1]])
  })

  it('has no MEMORY button and no ✕, since ⌫ deletes the selected CALL', () => {
    setup()
    expect(screen.queryByTestId('cues-memory-remove')).toBeNull()
    expect(screen.getByTestId('cues-deck')).not.toHaveTextContent('MEMORY')
  })

  it('plays and pauses with its button and says which one it will do', () => {
    const { onPlay } = setup()
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(onPlay).toHaveBeenCalledTimes(1)
  })

  it('says Pause while the track sounds', () => {
    setup({ playing: true })
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Pause')
  })

  it('picks the jump from a menu of 8, 16, 32 and 64 bars', () => {
    const { onJumpBars } = setup()
    expect(screen.getByTestId('cues-jump')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump'))
    const names = within(screen.getByTestId('cues-jump-listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['8 bars', '16 bars', '32 bars', '64 bars'])
    fireEvent.click(screen.getByTestId('cues-jump-option-32'))
    expect(onJumpBars).toHaveBeenCalledWith(32)
  })
})
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx`:

Replace the four tests "puts one CALL at the playhead with MEMORY, walks the CALLs and deletes the one under the playhead", "removes with ✕ the CALL MEMORY just put on the beat when the playhead sat off the grid", "still removes with ✕ a CALL from rekordbox that sits off the grid under the playhead" and "disables ✕ while no CALL sits at the playhead, so a click never looks like it did nothing" with:

```tsx
  it('puts one CALL at the playhead with + CALL, walks the CALLs selecting each and deletes the selected one with ⌫', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.getAllByTestId('cue-wave-call-64000')).toHaveLength(1)
    seek(120000)
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory-prev'))
    expect(position()).toBe('1:04.0')
    expect(screen.getByTestId('cue-wave-call-64000')).toHaveAttribute('data-selected', 'true')
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(position()).toBe('2:00.0')
    expect(screen.getByTestId('cue-wave-call-120000')).toHaveAttribute('data-selected', 'true')
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-call-120000')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
  })

  it('deletes with ⌫ the CALL + CALL just put on the beat when the playhead sat off the grid', async () => {
    setup()
    await maximize()
    seek(64200)
    fireEvent.click(screen.getByTestId('cues-memory'))
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-call-64000')).toBeNull()
  })

  it('walks to a CALL from rekordbox off the grid with › and deletes it with ⌫', async () => {
    setup(null, { ...READ, cues: [{ id: 'r', ms: 64230, kind: 0, color: null }] })
    await maximize()
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(position()).toBe('1:04.2')
    editor().focus()
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-call-64230')).toBeNull()
  })
```

Replace "changes the jump with ‹ › and hands it on to be saved" and "shows the jump set in Settings" with:

```tsx
  it('changes the jump from its menu and hands it on to be saved', async () => {
    const { onJumpBars } = setup()
    await maximize()
    expect(screen.getByTestId('cues-jump')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump'))
    fireEvent.click(screen.getByTestId('cues-jump-option-32'))
    expect(onJumpBars).toHaveBeenCalledWith(32)
  })

  it('shows the jump set in Settings', async () => {
    setup({ cueJumpBars: 64 })
    await maximize()
    expect(screen.getByTestId('cues-jump')).toHaveTextContent('64 bars')
  })
```

Add to `describe('CuesSection maximized keys', …)`:

```tsx
  it('plays and pauses with the Play button for whoever does not use the keyboard', async () => {
    stubSound()
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(audios).toHaveLength(1)
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Pause')
    fireEvent.click(screen.getByTestId('cues-play'))
    expect(pause).toHaveBeenCalled()
    expect(screen.getByTestId('cues-play')).toHaveAccessibleName('Play')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueDeck.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL on the pad text ("A1"), `cues-play`, the "+ CALL" name, `cues-memory-remove` still present, "MEMORY", `cues-jump` and the CALL selection after ‹ ›. (vitest does not typecheck, so the new `playing`/`onPlay` props are simply ignored until Step 4.)

- [ ] **Step 3: Locale keys**

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-calma-t5.json`:

```json
{
  "es": { "editor": { "cues": { "play": "Reproducir", "pause": "Pausa", "addCall": "Añadir un CALL en el cabezal" } } },
  "en": { "editor": { "cues": { "play": "Play", "pause": "Pause", "addCall": "Add a CALL at the playhead" } } },
  "de": { "editor": { "cues": { "play": "Abspielen", "pause": "Pause", "addCall": "CALL am Abspielkopf setzen" } } },
  "fr": { "editor": { "cues": { "play": "Lire", "pause": "Pause", "addCall": "Ajouter un CALL sur la tête de lecture" } } },
  "pt-BR": { "editor": { "cues": { "play": "Tocar", "pause": "Pausar", "addCall": "Adicionar um CALL no cursor" } } }
}
```

Merge it with `learn-merge.cjs`, then delete with Edit:

| File | Lines to delete |
|---|---|
| `es.json` | `"memory": "MEMORY",`, `"memoryRemove": "Borrar el CALL del cabezal",`, `"jumpLess": "Saltar menos compases",`, `"jumpMore": "Saltar más compases",` |
| `en.json` | `"memory": "MEMORY",`, `"memoryRemove": "Delete the CALL at the playhead",`, `"jumpLess": "Jump fewer bars",`, `"jumpMore": "Jump more bars",` |
| `de.json` | `"memory": "MEMORY",`, `"memoryRemove": "CALL am Abspielkopf löschen",`, `"jumpLess": "Weniger Takte springen",`, `"jumpMore": "Mehr Takte springen",` |
| `fr.json` | `"memory": "MEMORY",`, `"memoryRemove": "Supprimer le CALL sous la tête de lecture",`, `"jumpLess": "Sauter moins de mesures",`, `"jumpMore": "Sauter plus de mesures",` |
| `pt-BR.json` | `"memory": "MEMORY",`, `"memoryRemove": "Apagar o CALL no cursor",`, `"jumpLess": "Saltar menos compassos",`, `"jumpMore": "Saltar mais compassos",` |

(`editor.cues.keys.memory` is a different key and stays.)

- [ ] **Step 4: Rewrite `CueDeck.tsx`**

Replace the whole file `src/renderer/src/components/CueDeck.tsx` with:

```tsx
import { ChevronLeft, ChevronRight, Pause, Play, Plus } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CUE_JUMP_BARS, type CueJumpBars } from '../../../shared/cueJump'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor, PAD_LETTER_COLOR } from '../../../shared/rekordboxCueColors'
import { cueLetter } from '../lib/rowCues'
import { CuePalette } from './CuePalette'
import { Select } from './Select'

export interface DeckCue {
  key: string
  kind: number
  color: number | null
}

const STEP =
  'press flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'

export function CueDeck({
  cues,
  selected,
  locked,
  jumpBars,
  playing,
  onPlay,
  onPad,
  onRecolour,
  onMemory,
  onMemoryStep,
  onJumpBars,
  onDone,
}: {
  cues: DeckCue[]
  selected: string | null
  locked: string[]
  jumpBars: CueJumpBars
  playing: boolean
  onPlay: () => void
  onPad: (kind: number) => void
  onRecolour: (key: string, color: number) => void
  onMemory: () => void
  onMemoryStep: (dir: 1 | -1) => void
  onJumpBars: (bars: CueJumpBars) => void
  onDone?: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [colouring, setColouring] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (colouring === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setColouring(null)
      onDone?.()
    }
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setColouring(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [colouring, onDone])
  return (
    <div data-testid="cues-deck" className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
      <button
        type="button"
        data-testid="cues-play"
        aria-label={playing ? tr('editor.cues.pause') : tr('editor.cues.play')}
        onClick={onPlay}
        className="press flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-panel-2)] text-fg hover:bg-[var(--color-hover)]"
      >
        {playing ? (
          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <div className="flex items-center gap-1.5">
        {HOT_KINDS.map((kind) => {
          const cue = cues.find((c) => c.kind === kind)
          const letter = cueLetter(kind)
          const isSelected = cue !== undefined && cue.key === selected
          return (
            <span key={kind} className="relative">
              <button
                type="button"
                data-testid={`cues-pad-${letter}`}
                data-set={cue ? 'true' : 'false'}
                aria-label={tr('editor.cues.selectedHot', { letter })}
                aria-pressed={isSelected}
                onClick={() => onPad(kind)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (cue && !locked.includes(cue.key)) setColouring(cue.key)
                }}
                style={
                  cue
                    ? { backgroundColor: hotCueColor(cue.color), color: PAD_LETTER_COLOR }
                    : undefined
                }
                className={`press flex h-7 w-7 items-center justify-center rounded-[7px] text-xs font-bold ${
                  cue ? '' : 'border border-dashed border-[var(--color-line-strong)] text-fg-faint'
                } ${isSelected ? 'outline outline-2 outline-offset-2 outline-[var(--color-fg)]' : ''}`}
              >
                {letter}
              </button>
              {cue && colouring === cue.key && (
                <div
                  ref={popoverRef}
                  data-testid="cues-pad-colours"
                  className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-2.5 shadow-[var(--shadow-float)]"
                >
                  <CuePalette
                    value={cue.color}
                    onPick={(color) => {
                      onRecolour(cue.key, color)
                      setColouring(null)
                      onDone?.()
                    }}
                    label={(index) => tr('editor.cues.colour', { index })}
                  />
                </div>
              )}
            </span>
          )
        })}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          data-testid="cues-memory-prev"
          aria-label={tr('editor.cues.memoryPrev')}
          onClick={() => onMemoryStep(-1)}
          className={STEP}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory"
          aria-label={tr('editor.cues.addCall')}
          onClick={onMemory}
          className="press flex h-7 items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 text-xs font-medium text-fg hover:bg-[var(--color-hover)]"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {tr('editor.cues.selectedCall')}
        </button>
        <button
          type="button"
          data-testid="cues-memory-next"
          aria-label={tr('editor.cues.memoryNext')}
          onClick={() => onMemoryStep(1)}
          className={STEP}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <span className="flex-1" />
      <div className="flex items-center gap-1 text-xs">
        <span className="text-fg-dim">{tr('editor.cues.jump')}</span>
        <Select
          testid="cues-jump"
          bare
          compact
          portal
          label={tr('editor.cues.jump')}
          value={String(jumpBars)}
          onChange={(value) => {
            const bars = CUE_JUMP_BARS.find((b) => String(b) === value)
            if (bars) onJumpBars(bars)
          }}
          options={CUE_JUMP_BARS.map((b) => ({
            value: String(b),
            label: tr('editor.cues.jumpBars', { count: b }),
          }))}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the bar in `CuesSection`**

In `src/renderer/src/components/CuesSection.tsx` replace

```tsx
  const memoryStep = (dir: 1 | -1) => {
    const to = adjacentCall(state.cues, playheadMs, dir)
    if (to !== null) seekTo(to)
  }
  const callHere =
    callAt(state.cues, playheadMs) ??
    callAt(state.cues, ctx.beats[nearestBeat(ctx.beats, playheadMs)])
  const memoryRemove = () => {
    if (callHere) dispatch({ type: 'remove', key: callHere.key })
  }
```

with

```tsx
  const memoryStep = (dir: 1 | -1) => {
    const to = adjacentCall(state.cues, playheadMs, dir)
    if (to === null) return
    seekTo(to)
    const call = callAt(state.cues, to)
    if (call) dispatch({ type: 'select', key: call.key })
  }
```

and replace

```tsx
          jumpBars={settings.cueJumpBars}
          onPad={pad}
          onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onMemoryRemove={memoryRemove}
          canRemoveMemory={callHere !== undefined}
          onJumpBars={(bars) => onJumpBars?.(bars)}
```

with

```tsx
          jumpBars={settings.cueJumpBars}
          playing={audition.playing}
          onPlay={() => audition.toggle(playheadMs)}
          onPad={pad}
          onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onJumpBars={(bars) => onJumpBars?.(bars)}
```

`nearestBeat` stays imported (the C key uses it).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueDeck.test.tsx src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/i18n src/renderer/src/index.css.test.ts`
Expected: PASS, none skipped.

- [ ] **Step 7: Full suite, types, lint, commit**

Run the full suite into the scratch log and read its tail; report every failing or skipped test by name (the gated measurements and the sweep are the only expected skips). Both `tsc`, `check`.

```bash
git -C $WT add apps/desktop/src/renderer/src/components/CueDeck.tsx apps/desktop/src/renderer/src/components/CueDeck.test.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C $WT commit -m "Correct cues from a small bottom bar with Play, pads, CALL and the jump menu"
```

---

### Task 6: Verify on the copy with the driver

Done by the controller with the run-desktop driver (`apps/desktop/.claude/skills/run-desktop/driver.mjs`, `repl` mode, see its `SKILL.md`) against `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-edit/master.db`. Never `~/Library/Pioneer`. Screenshots go to `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-calma/`.

- [ ] **Step 1: Full suite, types, lint**

Full suite (`--reporter=dot --silent` into the scratch log), both `tsc`, `check`. Name any skipped or failing test.

- [ ] **Step 2: Point the dev settings at the copy**

With Surco closed, read `rekordboxDbPath` in `~/Library/Application Support/Electron/settings.json`. Set it to the `rb-edit` path with Edit and note the old value for Step 8. Stop if the file points at anything outside `/private/tmp/claude-501/`.

- [ ] **Step 3: Folded**

Build (`electron-vite build`, as the skill says), launch, open a rekordbox playlist of the copy, select a track with no hot cues and no CALLs, open Cues. Screenshot `folded.png`. Compare with the sketch's "Plegada, en el editor": the strip with marks above a half wave, ticks every 16 bars and nothing else on it; under it the split button reading "Marcar dónde rompe ▾" and "Guardar" at the right; no Descartar.

- [ ] **Step 4: Full screen, before marking**

Click `section-maximize`. Screenshot `maximized-empty.png` and compare with the sketch's "A pantalla completa": one top bar (cover, title, artist, grey "m:ss · BPM · key", "Marcar dónde rompe ▾", Guardar en rekordbox, ⌨, ⤡) and no section header row above it; the slim strip with the soft view rectangle; the zoomed wave from under the strip down to the bottom bar, with the time left and "N compases al CALL" right of the centre line in the row above it; the bottom bar (Play, pads dashed, ‹ + CALL ›, "Salto 16 compases ▾").

Measure with `eval`:

```js
(() => {
  const r = (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect()
  const overlay = r('section-maximized-overlay'), deck = r('cues-deck'), stage = r('cue-detail')
  const over = [...document.querySelectorAll('[data-testid="cue-detail"] *')]
    .filter((el) => el.textContent.trim() !== '' && !/^cue-detail-hot-/.test(el.dataset.testid ?? ''))
    .map((el) => el.dataset.testid ?? el.tagName)
  return { gapUnderDeck: overlay.bottom - deck.bottom, stageHeight: stage.height, textOverWave: over }
})()
```

Expected: `gapUnderDeck` at most 40 (the overlay's 32 px padding plus rounding), `stageHeight` well above 160 on a normal window, `textOverWave` empty (only hot cue letters live inside the wave, in the marks lane).

- [ ] **Step 5: One click marks and applies**

Click "Marcar dónde rompe": the grey "Haz clic donde rompe" appears in the bar. Screenshot `armed.png`. Click the strip where the track drops: the countdown of "Mi flujo" appears at once, the button reads "Aplicar Mi flujo", "Descartar cambios" appears. Screenshot `applied.png`. ⌘Z, arm again, press Escape: the hint goes and the editor stays full screen.

- [ ] **Step 6: Zoom and the bottom bar**

Dispatch on `cue-detail` `new WheelEvent('wheel', { deltaY: -60, metaKey: true, bubbles: true, cancelable: true })` and count `cue-detail-bar` before and after (17 then 9); `document.documentElement.clientWidth` and `window.devicePixelRatio` do not change. Click Play: `cues-position` advances over one second and `document.querySelector('audio')?.paused` stays true for the floating player; click again to stop. Click › to land on a CALL, press Backspace on the focused editor: the CALL goes. Open "Salto" and pick 32: → jumps 32 bars. Put it back to 16.

- [ ] **Step 7: Save and read it back**

Click "Guardar en rekordbox", apply the queue on the copy (no rekordbox running), read the copy's `djmdCue` rows for that `ContentID` with a read-only script in the scratchpad (as `colors.cjs` there does), and compare with the section re-read: positions on beats, letters and colours of the flow, the CALLs `Kind` 0, `contentCue` in step.

- [ ] **Step 8: Restore and hand over**

Put the old `rekordboxDbPath` back. Ask Vicent to look at the full editor and the folded section, to try a trackpad pinch on the zoomed wave (the driver cannot pinch), and to open the `rb-edit` copy in rekordbox. Record what he saw, dated, under "Cómo sabremos que está" in the spec and commit the spec alone ("Record the calm cue editor check on the rekordbox copy").

---

## Self-review

1. **Spec coverage.** Decision 1 (the wave leads, nothing over it): Task 3 (no drop labels, ghost without label, ticks), Task 4 (no buttons, labels in their own row, test "…in a row above the wave so nothing sits on it"), Task 6 Step 4 (`textOverWave`). Decision 2 (one primary that says what happens, arm, next click or M, flow applied in one step, discreet hint, Escape, flow list from the arrow): Task 1. Decision 3 (Guardar in the same bar, Descartar only with changes): Task 2. Decision 4 (slim strip, half wave, marks lane with CALL behind its hot cue, view rectangle, click or drag moves the playhead, no DROP labels, a notch every 16 bars): Task 3 (the CALL-behind rule and half wave are kept and still pinned by the existing CueWave tests). Decision 5 (fills the free height, no box, no buttons, thin centred playhead, time left, "N compases al CALL" right in grey, + − keys and pinch or ⌘ + wheel, calm grid): Task 4 plus Task 2's `h-full` chain, checked in Task 6. Decision 6 (bottom bar with Play/Pausa, small pads filled or dashed, right-click colour, ‹ + CALL ›, Salto as a menu; MEMORY, ✕, floating + −, legend and empty space gone): Task 5, Task 4 (+ −), Task 6 Step 4 (empty space). Decision 7 (header with cover, title, artist, grey length · BPM · key, keyboard and restore buttons): Task 2. Decision 8 (folded: strip, primary, Guardar; ⤢ to correct): Tasks 2 and 3. Decision 9 (nothing underneath changes): Global Constraints lists the untouched modules and the guard tests; no task edits the reducer, session store, audition hook, claims or main. Success criteria: Task 1 tests (button text, one click applies), Task 4 and Task 6 Step 4 (nothing over the wave, no empty space).
2. **Placeholder scan.** Every code step shows the code or the exact old and new text; every locale step carries its JSON and the exact lines to delete; Task 6 gives the measuring script.
3. **Type consistency.** `armed`, `primary`, `pickFlow`, `markDrop`, `shownName` (Task 1) are used with those names in Task 2's whole-return text; `onPick?: (ms: number) => void` (Task 1) is kept in Task 4's rewrite and passed as `onPick={armed ? markDrop : undefined}` in Task 2; `view?: { fromMs: number; toMs: number }` (Task 3) is fed by `detailWindow(ctx.beats, playheadMs, zoom)` whose return type matches; `wheelZoom(pending, deltaY): { pending; dir }` and `WHEEL_ZOOM_STEP` (Task 4) match their test and the component; `CueDeck` props of Task 5 match the element Task 5 writes into the Task 2 text (`playing`, `onPlay`; `onMemoryRemove`, `canRemoveMemory` removed in both places); `onRestore: () => void` (Task 2) matches `() => setMaximized(null)`. Task 3's `CueWave` element edit and Task 4's header deletion quote text that Task 2 wrote verbatim. `GridCaps`/`GRID_LINE` stay exported through Task 3 for `CueWaveDetail` and are removed in Task 4 when the rewrite stops importing them.
4. **Review Focus.** Line 1 is pinned in Task 1 (the ⌘Z part needed the `if (!noDrop) setArming(false)` effect, added to Task 1's code), line 2 in Task 1, line 3 in Task 1, line 4 in Task 4 (component and section tests), line 5 in Task 5. Also covered in tasks though not listed: the folded strip has no view rectangle and no drag (Task 3), the view rectangle clamps at the start (Task 3), restore stays reachable on an unanalysed track (Task 2), Play for mouse users (Task 5).

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-20-editor-cues-calma.md`. Tasks 1 to 5 all edit `CuesSection.tsx` and the five locales, so they run one after another, never in parallel; Task 6 is the controller's.
