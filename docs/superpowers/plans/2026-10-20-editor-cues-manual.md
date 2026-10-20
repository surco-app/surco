# Editor manual de cues a pantalla completa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cues section maximizes into a rekordbox-like manual editor (track header, overview with playhead, full-resolution colour wave with a fixed centred playhead, pads A to H, MEMORY, configurable bar jump, sound from the playhead and a full keyboard map), the colour picker gains "Restablecer", and Settings › Cues is reorganized into flow tabs, a full-width preview, rules written as sentences of clickable words and an "Editor manual" card.

**Architecture:** Everything edits the same draft as today (`lib/cueDraft.ts`); the reducer only learns to place a hot cue on a chosen letter. Pure helpers (`lib/cuePlayhead.ts`, `lib/cueDetail.ts`, `lib/cueKeys.ts`) hold the playhead arithmetic, the visible-window decimation of rekordbox's PWV5 words and the key map, so the components stay thin. Main gains one read-only IPC (`rekordbox:cueWaveDetail`) returning the raw PWV5 words as a `Uint16Array`. Because a maximized section is re-mounted in a portal by `Editor`, the draft and the playhead live in a one-slot module store (`lib/cueSession.ts`), and the section's own `Audio` (`hooks/useCueAudition.ts`) stops whenever the editor stops being maximized. Saving is unchanged: the queue, backup, fingerprint and `validWantedSet`.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library (jsdom), biome, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-20-editor-cues-manual-design.md` (follows `docs/superpowers/specs/2026-10-19-editor-cues-design.md`). Approved sketch: https://claude.ai/artifact/BVZqB1LH5NduFDhy7FmYCt

**Depends on:** branch `worktree-fuentes-dj-playlists` up to `9028e1d5` (plan `2026-10-19-editor-cues.md` done, the 4×4 picker in rekordbox order with its check already in `CuePalette`).

**Out of scope (spec "Fuera de alcance"):** loops stay read-only, no beat-grid editing, quantize always on, no wave computed from audio, no tempo, pitch, EQ or any DJ control beyond play and stop.

## Global Constraints

- `$WT` means `/Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists`. **Write it out literally in every command**: the shell guard refuses commands whose paths come from a variable. Paths below are relative to `apps/desktop/` unless they start with `docs/`.
- Tests: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop <paths relative to apps/desktop>`. Never filter by a path from the repo root (the setup is skipped and failures are false). Full suite: add `--reporter=dot --silent > /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/suite.log` and read the tail.
- Types: `npm --prefix $WT/apps/desktop exec -- tsc -p $WT/apps/desktop/tsconfig.web.json --noEmit` and the same with `tsconfig.node.json`. A bare `tsc --noEmit` checks nothing.
- Lint: `npm --prefix $WT/apps/desktop run check` (it is `biome check --write src`, it may reorder imports), then `git -C $WT status --short` must list only the task's files (other agents commit in this tree; never `git add -A` or `.`).
- The shell guard rejects heredocs, `cd … &&` chains and shell loops: write files with the Write tool, edit with Edit. Search with `rg` or the Grep tool.
- Locale additions: write the JSON shown in the task with the Write tool to the scratchpad path the task names, then run `node /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/learn-merge.cjs <that json>` with the Bash working directory `$WT/apps/desktop` (the helper resolves `src/renderer/src/i18n/locales` from the working directory and deep-merges `{ "<locale>": { ...keys } }` into each file). Key removals are done with Edit in each of the 5 files.
- Zero comments in new code (biome directives included). A comment your change makes false is updated, not deleted.
- `data-testid` first in selectors. `window.api` mocks are typed: `vi.fn<Api['name']>()`.
- No user-facing string with an em dash or an explanatory colon. Every key exists in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`), Spanish written first; French uses "vous"; Spanish says "donde rompe", other locales "drop".
- **Never touch `~/Library/Pioneer`** from tests, scripts or tools. Tests build their own collection with `writeRekordboxPlaylistFixture` and ANLZ files with `anlzFixture` (`anlzFile`, `pqtzSection`, `pwv5Section`). Real data lives only in the test copies: `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-b/master.db` (read-only) and `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-edit/master.db` (the only one Task 13 may write to, and only through the queue).
- **Every rekordbox write goes through the queue and `applyRekordboxBatch`** (backup, close check, fingerprint, `validWantedSet`). The new IPC is read-only (`withCollection` opens the collection `readonly`).
- `src/shared/cueRules.test.ts` is not edited by any task.
- Constants: `SAME_POSITION_MS` 50, `BEATS_PER_BAR` 4, `MAX_HOT_CUES` 8, `HOT_KINDS` `[1, 2, 3, 5, 6, 7, 8, 9]` (A..H, keys 1..8), `HOT_CUE_DEFAULT_INDEX` 22, `CUE_JUMP_BARS` `[8, 16, 32, 64]` default 16, `ZOOM_BARS` `[4, 8, 16, 32, 64]` default 16, PWV5 150 entries per second.
- **Drawing rule** (unchanged from the previous plan): hot cue = square with its letter in rekordbox's colour (`hotCueColor`); CALL = red triangle (`MEMORY_CUE_COLOR`); a CALL paired with a hot cue sits right under it on the same `left`; every CALL at one height. The detail wave places its marks with the same `placeCues`/`markStyle`.
- **Keys** (spec §3): only while the section is maximized and focus is inside it; never when the event target is a field (`isTypingTarget`); a handled key is `preventDefault`-ed so `useKeyboardShortcuts` (which returns on `defaultPrevented`) never runs a global command for it.
- **Sound** (spec §2): one `Audio` of the section; starting it pauses every `<audio>` in the document (the floating player's element); it stops on a second Space, when the section is restored or closed, on another track and on unmount.
- The folded, non-maximized section stays exactly as today (click marks drops, ⌫ and ⌘Z as today). Existing test ids keep working.
- One functionality per commit, title only, no prefix, never `--no-verify`, never bare `git stash`.

## Decisions taken where the spec left room

1. **Jumps keep the phase.** ← → and ⇧← ⇧→ move the playhead a whole number of beats from the beat nearest to it and keep the offset from that beat, so a jump while playing stays in time; C is what snaps to the grid. Past the start the playhead goes to 0, past the end to the last beat.
2. **"Distancia al siguiente CALL"** counts every memory cue (paired or a drop) at or after the playhead minus 50 ms, measured in beats of the grid and shown as rekordbox does, `-16.0`, `-0.0` on the CALL itself. With no CALL ahead there is no label.
3. **No play button.** The approved sketch has none; Space plays and stops. The pads, MEMORY ◀ ▶ ✕ and the jump ‹ › are the mouse equivalents the spec asks for.
4. **The draft and the playhead survive maximize and restore.** `Editor` renders a maximized section through a portal, which re-mounts it and would drop every unsaved edit. A one-slot module store keyed by track, read fingerprint and queued save keeps the draft (and per track the playhead); "Descartar cambios" clears it; another track never sees it.
5. **Overview click while maximized moves the playhead** and does not mark a drop. Marking a drop when maximized is M (a lone CALL is a drop, spec decision 3) or the right-click menu, which stays.
6. **While the maximized editor has focus it swallows every bare letter and digit**, mapped or not, so the claimed Trim keys (q, w, a, z…) of a section hidden under the overlay never move a cut nobody sees. Escape (restore), Tab and every ⌘/Ctrl chord except ⌘Z pass through.
7. **Space is also claimed (`claimKeys({ play })`) while maximized**, so it plays the editor's sound and never the floating player even with the focus on the page body, as Trim's audition does.
8. **Pads show a white letter on the cue colour** (sketch); the wave squares keep their black letter.
9. **Zoom** is in bars visible (4, 8, 16, 32, 64; 16 when opening), the window width taken from the beat length at the playhead; + zooms in (fewer bars).
10. **The detail wave** is fetched only when maximized, as the raw PWV5 words in a `Uint16Array` (structured clone keeps it compact); each frame decimates only the visible window to one column per canvas pixel, tallest entry wins (as `colorWave`). Without PWV5 the overview columns are stretched.
11. **Rule sentence uses a comma before "pon"** where the sketch had a colon (copy rule). The first token keeps today's labels ("Desde donde rompe"), so no origin string is retranslated.
12. **The flow name is edited inside its tab**: the current tab is an input whose placeholder is the translated bundled name.
13. **"Restablecer" sets `HOT_CUE_DEFAULT_INDEX` (22)** in every picker (selection panel, pads, rule colours).
14. **`cueJumpBars` is synced** (not `LOCAL_KEYS`), like the flows: it follows the person. Any value outside 8/16/32/64 normalises to 16.
15. **A pad whose letter is held by a loop** selects it and moves the playhead to it; the loop stays read-only (no colour popover).
16. **Pressing a pad or 1 to 8 places the hot cue on the beat nearest the playhead** (the reducer snaps, as every placement); the playhead itself does not move.

## Review Focus

1. **Unsaved edits when maximizing or restoring.** The portal re-mounts the section; a person who marked cues folded and then maximizes expects to find them, and the reverse. Pinned in Task 7 ("keeps the unsaved cues when the section is mounted again in another place, as maximizing does") and Task 9 ("keeps the playhead when the section is mounted again").
2. **Keys of something hidden acting under the full editor.** Space must not start the floating player and the Trim's claimed letters must not move a cut under the overlay. Pinned in Task 10 ("Space plays the track from the playhead and never reaches the floating player", "swallows other single keys so a hidden section never acts under the full editor").
3. **Typing in a field inside the editor.** The flow selector is inside the editor; arrows and letters there must do what they do in a select. Pinned in Task 10 ("never acts while a field of the editor has the focus").
4. **Sound that keeps playing.** Restoring the section, switching track or unmounting must stop it, and two sounds never overlap. Pinned in Task 6 (four stop cases and the floating player pause) and Task 10 ("stops the sound when the section is restored to its place").
5. **The playhead at the edges.** Jumping before 0 or past the last beat, a grid that does not start at 0, a window that hangs over the start or the end. Pinned in Task 3 (clamps) and Task 5 (blank columns outside the track).

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/cueJump.ts` (new) | `CUE_JUMP_BARS`, `CueJumpBars`, `DEFAULT_CUE_JUMP_BARS`, `normalizeCueJumpBars` |
| `src/shared/types.ts`, `src/main/settings.ts`, `src/renderer/src/lib/settingsDraft.ts`, `src/renderer/src/lib/settingsContext.tsx`, `src/renderer/src/test/api.ts` (mod) | the synced `cueJumpBars` |
| `src/renderer/src/lib/cueDraft.ts` (mod) | `add-hot` with a chosen letter |
| `src/renderer/src/lib/cuePlayhead.ts` (new) | `jumpBeats`, `adjacentCall`, `callAt`, `barsToNextCall`, `ZOOM_BARS`, `DEFAULT_ZOOM_BARS`, `zoomStep`, `detailWindow`, `cueClock` |
| `src/main/anlz.ts`, `src/main/rekordboxCues.ts`, `src/main/rekordboxCuesIpc.ts` (mod) | `colorWaveWords`, `readCueWaveDetail`, `rekordbox:cueWaveDetail` |
| `src/preload/index.ts`, `src/preload/api.ts`, `src/scenarios/harness.tsx` (mod) | `rekordboxCueWaveDetail` |
| `src/renderer/src/lib/cueDetail.ts` (new) | `DetailSource`, `decodeWaveWord`, `visibleColumns` |
| `src/renderer/src/components/CueWaveDetail.tsx` (new) | the zoomed wave: canvas window, bar lines, marks, centred playhead, distance to CALL, drag, zoom buttons |
| `src/renderer/src/hooks/useCueAudition.ts` (new) | the section's sound |
| `src/renderer/src/lib/cueSession.ts` (new) | draft and playhead kept across the portal re-mount |
| `src/renderer/src/components/CueDeck.tsx` (new) | pads A to H, MEMORY ◀ ▶ ✕, jump ‹ N ›, pad colour popover |
| `src/renderer/src/hooks/useTrackCues.ts` (mod) | `useCueWaveDetail` |
| `src/renderer/src/components/CueWave.tsx` (mod) | `playheadMs`, `onSeek`, memoised wave |
| `src/renderer/src/components/CuesSection.tsx` (mod) | maximizable, the full layout, keys, sound |
| `src/renderer/src/lib/cueKeys.ts` (new) | key → editor action |
| `src/renderer/src/components/Editor.tsx`, `src/renderer/src/App.tsx` (mod) | track info and the jump save |
| `src/renderer/src/components/CuePalette.tsx` (mod) | "Restablecer" |
| `src/renderer/src/components/CueRuleRow.tsx`, `src/renderer/src/components/settings/CuesTab.tsx` (mod) | sentence rules, tabs, preview first, "Editor manual" |
| `src/renderer/src/i18n/locales/*.json` (mod) | `editor.cues.*`, `settings.cueFlows.sentence.*`, `settings.cueFlows.manual.*` |

## Task list

| # | Task |
|---|---|
| 1 | The arrow jump as a synced setting |
| 2 | A hot cue on the letter the DJ picks |
| 3 | Playhead arithmetic |
| 4 | Main reads the full colour wave |
| 5 | The zoomed wave |
| 6 | The section's sound |
| 7 | The draft survives the portal |
| 8 | The deck: pads, MEMORY and jump |
| 9 | The section maximizes into the editor |
| 10 | Keys and sound in the editor |
| 11 | "Restablecer" and the pad colours |
| 12 | Settings › Cues, reorganized |
| 13 | Verify on the copy with the driver |

---

### Task 1: The arrow jump as a synced setting

**Files:**
- Create: `src/shared/cueJump.ts`, `src/shared/cueJump.test.ts`
- Modify: `src/shared/types.ts` (`Settings`), `src/main/settings.ts` (`defaults`, `mergeSettings`), `src/renderer/src/lib/settingsDraft.ts` (`SyncedDraft`, `pickSynced`), `src/renderer/src/lib/settingsContext.tsx` (`ResolvedSettings`, `DEFAULTS`, `resolveSettings`), `src/renderer/src/test/api.ts` (default settings)
- Test: `src/main/settings.test.ts`, `src/renderer/src/lib/settingsDraft.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CUE_JUMP_BARS: readonly [8, 16, 32, 64]`, `type CueJumpBars = 8 | 16 | 32 | 64`, `DEFAULT_CUE_JUMP_BARS: CueJumpBars` (16), `normalizeCueJumpBars(value: unknown): CueJumpBars` from `src/shared/cueJump.ts`; `Settings.cueJumpBars: CueJumpBars`; `SyncedDraft.cueJumpBars`; `useAppSettings().cueJumpBars: CueJumpBars`.

- [ ] **Step 1: Write the failing tests**

`src/shared/cueJump.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CUE_JUMP_BARS, DEFAULT_CUE_JUMP_BARS, normalizeCueJumpBars } from './cueJump'

describe('normalizeCueJumpBars', () => {
  it('keeps the four jumps the editor offers', () => {
    for (const bars of CUE_JUMP_BARS) expect(normalizeCueJumpBars(bars)).toBe(bars)
  })

  it('falls back to 16 for anything a hand-edited or older file holds, so the arrows always move', () => {
    for (const value of [undefined, null, 0, 12, 128, '32', -16]) {
      expect(normalizeCueJumpBars(value)).toBe(DEFAULT_CUE_JUMP_BARS)
    }
    expect(DEFAULT_CUE_JUMP_BARS).toBe(16)
  })
})
```

In `src/main/settings.test.ts`, inside `describe('cue flows', …)` add:

```ts
  it('jumps 16 bars by default for a settings file from before the manual editor', () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), JSON.stringify({}))
    expect(getSettings().cueJumpBars).toBe(16)
  })

  it('repairs a jump the editor does not offer instead of leaving the arrows dead', () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), JSON.stringify({ cueJumpBars: 12 }))
    expect(getSettings().cueJumpBars).toBe(16)
  })

  it('carries the arrow jump to another Mac with the flows', () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), JSON.stringify({}))
    const dir = mkdtempSync(join(tmpdir(), 'surco-sync-'))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({}))
    setConfigDir(dir)
    saveSettings({ cueJumpBars: 32 })
    const synced = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))
    expect(synced.cueJumpBars).toBe(32)
    setConfigDir(null)
    rmSync(dir, { recursive: true, force: true })
  })
```

In `src/renderer/src/lib/settingsDraft.test.ts`, add `cueJumpBars: 16,` to the `settings` literal after `activeCueFlow: 'mine',`, and inside `describe('cue flows in the draft', …)`:

```ts
  it('saves the arrow jump the Cues tab staged', () => {
    const synced = { ...pickSynced(settings), cueJumpBars: 64 as const }
    expect(buildSettingsPatch(synced, local).cueJumpBars).toBe(64)
  })
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueJump.test.ts src/main/settings.test.ts src/renderer/src/lib/settingsDraft.test.ts`
Expected: FAIL, `./cueJump` cannot be resolved and `cueJumpBars` is undefined.

- [ ] **Step 3: Implement**

`src/shared/cueJump.ts`:

```ts
export const CUE_JUMP_BARS = [8, 16, 32, 64] as const

export type CueJumpBars = (typeof CUE_JUMP_BARS)[number]

export const DEFAULT_CUE_JUMP_BARS: CueJumpBars = 16

export function normalizeCueJumpBars(value: unknown): CueJumpBars {
  return CUE_JUMP_BARS.find((bars) => bars === value) ?? DEFAULT_CUE_JUMP_BARS
}
```

`src/shared/types.ts`: add `import type { CueJumpBars } from './cueJump'` next to the `./cueFlows` import, and in `Settings` after `activeCueFlow: string`:

```ts
  cueJumpBars: CueJumpBars
```

`src/main/settings.ts`: add `import { DEFAULT_CUE_JUMP_BARS, normalizeCueJumpBars } from '../shared/cueJump'` after the `cueFlows` import; in `defaults` after `activeCueFlow: MY_FLOW_ID,` add `cueJumpBars: DEFAULT_CUE_JUMP_BARS,`; in `mergeSettings` after the `activeCueFlow` entry add:

```ts
    cueJumpBars: normalizeCueJumpBars(patch.cueJumpBars ?? base.cueJumpBars),
```

The key does not go in `LOCAL_KEYS`.

`src/renderer/src/lib/settingsDraft.ts`: import `type CueJumpBars` from `'../../../shared/cueJump'`; `SyncedDraft` gains `cueJumpBars: CueJumpBars` after `activeCueFlow: string`; `pickSynced` gains `cueJumpBars: s.cueJumpBars,` after `activeCueFlow: s.activeCueFlow,`.

`src/renderer/src/lib/settingsContext.tsx`: import `type CueJumpBars, DEFAULT_CUE_JUMP_BARS, normalizeCueJumpBars` from `'../../../shared/cueJump'`; `ResolvedSettings` gains `cueJumpBars: CueJumpBars`; `DEFAULTS` gains `cueJumpBars: DEFAULT_CUE_JUMP_BARS,`; `resolveSettings` returns `cueJumpBars: normalizeCueJumpBars(settings.cueJumpBars),`.

`src/renderer/src/test/api.ts`: the default settings object gains `cueJumpBars: 16,` after `activeCueFlow: 'mine',`.

- [ ] **Step 4: Run tests, types, lint**

The three test files plus `src/renderer/src/components/SettingsModal.test.tsx` and `src/renderer/src/hooks/useSettings.test.tsx`: PASS. Both `tsc`: every `Settings` or `SyncedDraft` literal tsc names (the settings tab tests, `OnboardingWizard.test.tsx`, `onboarding.test.ts`, `App.test.tsx`, `rekordbox*` tests that build `Settings`) gets `cueJumpBars: 16`. `check` clean; status lists only these files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/cueJump.ts apps/desktop/src/shared/cueJump.test.ts apps/desktop/src/shared/types.ts apps/desktop/src/main/settings.ts apps/desktop/src/main/settings.test.ts apps/desktop/src/renderer/src/lib/settingsDraft.ts apps/desktop/src/renderer/src/lib/settingsDraft.test.ts apps/desktop/src/renderer/src/lib/settingsContext.tsx apps/desktop/src/renderer/src/test/api.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Keep the cue editor's arrow jump in the synced settings"
```

(Add every other file tsc made you touch.)

---

### Task 2: A hot cue on the letter the DJ picks

**Files:**
- Modify: `src/renderer/src/lib/cueDraft.ts` (`DraftAction`, the `add-hot` branch of `reduceDraft`)
- Test: `src/renderer/src/lib/cueDraft.test.ts`

**Interfaces:**
- Consumes: `freeLetters`, `HOT_CUE_DEFAULT_INDEX` (already there).
- Produces: `DraftAction` member `{ type: 'add-hot'; ms: number; kind?: number }`. With `kind`, the hot cue takes that letter only if it is a free `HOT_KINDS` letter; otherwise the state is returned unchanged. Without `kind`, behaviour as today (first free letter).

- [ ] **Step 1: Write the failing tests**

Add to `describe('reduceDraft', …)` in `src/renderer/src/lib/cueDraft.test.ts`:

```ts
  it('puts a hot cue on the letter the DJ pressed, on the beat under the playhead, in the default colour', () => {
    const s = run(empty(), { type: 'add-hot', ms: bar(10) + 120, kind: 5 })
    const d = at(s, bar(10), true)
    expect(d).toMatchObject({ kind: 5, color: 22 })
    expect(s.selected).toBe(d?.key)
  })

  it('never puts a second cue on a letter in use, nor a letter rekordbox has no pad for', () => {
    const placed = run(empty(), { type: 'add-hot', ms: bar(10), kind: 1 })
    expect(run(placed, { type: 'add-hot', ms: bar(20), kind: 1 })).toBe(placed)
    expect(run(placed, { type: 'add-hot', ms: bar(20), kind: 4 })).toBe(placed)
    expect(run(placed, { type: 'add-hot', ms: bar(20), kind: 10 })).toBe(placed)
  })

  it('keeps every set main accepts when the pads place cues by letter', () => {
    let s = startDraft([], 'mine')
    for (const kind of [9, 1, 5, 2]) {
      s = reduceDraft(s, { type: 'add-hot', ms: bar(8 * kind), kind }, ctx)
      expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
    }
    expect(s.cues.map((c) => c.kind).sort()).toEqual([1, 2, 5, 9])
  })
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueDraft.test.ts`
Expected: FAIL, the first test finds the cue on letter 1 (`kind` ignored), and tsc in the editor flags `kind` as unknown.

- [ ] **Step 3: Implement**

In `DraftAction` replace `| { type: 'add-hot'; ms: number }` with:

```ts
  | { type: 'add-hot'; ms: number; kind?: number }
```

In `reduceDraft` replace:

```ts
    const kind = hot ? freeLetters(state.cues).at(0) : 0
```

with:

```ts
    const wanted = action.type === 'add-hot' ? action.kind : undefined
    const free = freeLetters(state.cues)
    const kind = !hot ? 0 : wanted === undefined ? free.at(0) : free.find((k) => k === wanted)
```

- [ ] **Step 4: Run tests, types, lint**

`src/renderer/src/lib/cueDraft.test.ts` and `src/renderer/src/components/CuesSection.test.tsx`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueDraft.ts apps/desktop/src/renderer/src/lib/cueDraft.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Place a hot cue on the letter the DJ picks"
```

---

### Task 3: Playhead arithmetic

**Files:**
- Create: `src/renderer/src/lib/cuePlayhead.ts`, `src/renderer/src/lib/cuePlayhead.test.ts`

**Interfaces:**
- Consumes: `BEATS_PER_BAR`, `nearestBeat`, `SAME_POSITION_MS` from `src/shared/cueRules.ts`.
- Produces (all pure, `beats` are beat positions in ms ascending):
  - `jumpBeats(beats: number[], ms: number, count: number): number`
  - `adjacentCall(cues: { ms: number; kind: number }[], ms: number, dir: 1 | -1): number | null`
  - `callAt<T extends { ms: number; kind: number }>(cues: T[], ms: number): T | undefined`
  - `barsToNextCall(beats: number[], cues: { ms: number; kind: number }[], ms: number): number | null`
  - `ZOOM_BARS: readonly [4, 8, 16, 32, 64]`, `DEFAULT_ZOOM_BARS = 16`, `zoomStep(bars: number, dir: 'in' | 'out'): number`
  - `detailWindow(beats: number[], ms: number, bars: number): { fromMs: number; toMs: number }`
  - `cueClock(ms: number): string` (`m:ss.t`)

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/cuePlayhead.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  adjacentCall,
  barsToNextCall,
  callAt,
  cueClock,
  DEFAULT_ZOOM_BARS,
  detailWindow,
  jumpBeats,
  zoomStep,
} from './cuePlayhead'

const beats = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => n * 2000
const cues = [
  { key: 'a', ms: 10000, kind: 0 },
  { key: 'b', ms: 20000, kind: 1 },
  { key: 'c', ms: 20000, kind: 0 },
  { key: 'd', ms: 30000, kind: 0 },
]

describe('jumpBeats', () => {
  it('moves a whole number of beats and keeps the offset, so a jump while playing stays in time', () => {
    expect(jumpBeats(beats, bar(32), 64)).toBe(bar(48))
    expect(jumpBeats(beats, bar(32) + 200, 4)).toBe(bar(33) + 200)
    expect(jumpBeats(beats, bar(32), -1)).toBe(bar(32) - 500)
  })

  it('stops at the start of the track and at the last beat instead of leaving the track', () => {
    expect(jumpBeats(beats, 1000, -64)).toBe(0)
    expect(jumpBeats(beats, 399000, 64)).toBe(399500)
  })

  it('goes back to 0 on a grid that starts late rather than forward to its first beat', () => {
    const late = Array.from({ length: 100 }, (_, i) => 2000 + i * 500)
    expect(jumpBeats(late, 3000, -16)).toBe(0)
  })
})

describe('CALL navigation', () => {
  it('walks the CALLs, skipping the one under the playhead and every hot cue', () => {
    expect(adjacentCall(cues, 20000, 1)).toBe(30000)
    expect(adjacentCall(cues, 20000, -1)).toBe(10000)
    expect(adjacentCall(cues, 30020, 1)).toBeNull()
    expect(adjacentCall(cues, 9990, -1)).toBeNull()
  })

  it('finds the CALL under the playhead within 50 ms, never a hot cue', () => {
    expect(callAt(cues, 20040)?.key).toBe('c')
    expect(callAt(cues, 20100)).toBeUndefined()
  })
})

describe('barsToNextCall', () => {
  it('counts bars of the grid to the next CALL, as rekordbox shows above the playhead', () => {
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 0 }], bar(32))).toBe(16)
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 0 }], bar(32) - 1000)).toBe(16.5)
  })

  it('reads 0 on the CALL itself and nothing with no CALL ahead or no grid', () => {
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 0 }], bar(48) - 20)).toBe(0)
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 1 }], bar(32))).toBeNull()
    expect(barsToNextCall(beats, [{ ms: bar(8), kind: 0 }], bar(32))).toBeNull()
    expect(barsToNextCall([], [{ ms: bar(48), kind: 0 }], bar(32))).toBeNull()
  })
})

describe('zoom', () => {
  it('opens at 16 bars and steps through 4 to 64, stopping at both ends', () => {
    expect(DEFAULT_ZOOM_BARS).toBe(16)
    expect(zoomStep(16, 'in')).toBe(8)
    expect(zoomStep(16, 'out')).toBe(32)
    expect(zoomStep(4, 'in')).toBe(4)
    expect(zoomStep(64, 'out')).toBe(64)
    expect(zoomStep(12, 'in')).toBe(8)
  })

  it('centres a window of the visible bars on the playhead', () => {
    expect(detailWindow(beats, bar(32), 16)).toEqual({ fromMs: bar(24), toMs: bar(40) })
    expect(detailWindow(beats, 0, 4)).toEqual({ fromMs: -4000, toMs: 4000 })
  })
})

describe('cueClock', () => {
  it('writes minutes, seconds and tenths, never below zero', () => {
    expect(cueClock(0)).toBe('0:00.0')
    expect(cueClock(64000)).toBe('1:04.0')
    expect(cueClock(61999)).toBe('1:01.9')
    expect(cueClock(400000)).toBe('6:40.0')
    expect(cueClock(-5)).toBe('0:00.0')
  })
})
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cuePlayhead.test.ts`
Expected: FAIL, `./cuePlayhead` cannot be resolved.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/cuePlayhead.ts`:

```ts
import { BEATS_PER_BAR, nearestBeat, SAME_POSITION_MS } from '../../../shared/cueRules'

export const ZOOM_BARS = [4, 8, 16, 32, 64] as const
export const DEFAULT_ZOOM_BARS = 16

export function jumpBeats(beats: number[], ms: number, count: number): number {
  if (beats.length === 0) return ms
  const from = nearestBeat(beats, ms)
  const to = from + count
  if (to < 0) return 0
  if (to >= beats.length) return beats[beats.length - 1]
  return Math.max(0, beats[to] + ms - beats[from])
}

export function adjacentCall(
  cues: { ms: number; kind: number }[],
  ms: number,
  dir: 1 | -1,
): number | null {
  const ahead = cues
    .filter((c) => c.kind === 0)
    .map((c) => c.ms)
    .filter((at) => (dir === 1 ? at > ms + SAME_POSITION_MS : at < ms - SAME_POSITION_MS))
  if (ahead.length === 0) return null
  return dir === 1 ? Math.min(...ahead) : Math.max(...ahead)
}

export function callAt<T extends { ms: number; kind: number }>(cues: T[], ms: number): T | undefined {
  return cues.find((c) => c.kind === 0 && Math.abs(c.ms - ms) <= SAME_POSITION_MS)
}

function beatPosition(beats: number[], ms: number): number {
  if (ms <= beats[0]) return 0
  let i = 0
  while (i + 1 < beats.length && beats[i + 1] <= ms) i++
  if (i + 1 >= beats.length) return i
  return i + (ms - beats[i]) / (beats[i + 1] - beats[i])
}

export function barsToNextCall(
  beats: number[],
  cues: { ms: number; kind: number }[],
  ms: number,
): number | null {
  if (beats.length === 0) return null
  const ahead = cues.filter((c) => c.kind === 0 && c.ms >= ms - SAME_POSITION_MS).map((c) => c.ms)
  if (ahead.length === 0) return null
  const next = Math.min(...ahead)
  if (Math.abs(next - ms) <= SAME_POSITION_MS) return 0
  return Math.max(0, (beatPosition(beats, next) - beatPosition(beats, ms)) / BEATS_PER_BAR)
}

export function zoomStep(bars: number, dir: 'in' | 'out'): number {
  const found = ZOOM_BARS.findIndex((z) => z === bars)
  const at = found === -1 ? ZOOM_BARS.findIndex((z) => z === DEFAULT_ZOOM_BARS) : found
  const next = Math.min(ZOOM_BARS.length - 1, Math.max(0, at + (dir === 'in' ? -1 : 1)))
  return ZOOM_BARS[next]
}

export function detailWindow(
  beats: number[],
  ms: number,
  bars: number,
): { fromMs: number; toMs: number } {
  const j = Math.max(1, Math.min(nearestBeat(beats, ms) + 1, beats.length - 1))
  const beatMs = beats[j] - beats[j - 1] || 500
  const half = (bars * BEATS_PER_BAR * beatMs) / 2
  return { fromMs: ms - half, toMs: ms + half }
}

export function cueClock(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = String(Math.floor((tenths % 600) / 10)).padStart(2, '0')
  return `${minutes}:${seconds}.${tenths % 10}`
}
```

- [ ] **Step 4: Run tests, types, lint**

The test file: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cuePlayhead.ts apps/desktop/src/renderer/src/lib/cuePlayhead.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Work out jumps, CALL steps, zoom and the distance to the next CALL for the cue editor"
```

---

### Task 4: Main reads the full colour wave

**Files:**
- Modify: `src/main/anlz.ts` (`colorWaveWords`), `src/main/rekordboxCues.ts` (`readCueWaveDetail`), `src/main/rekordboxCuesIpc.ts` (`rekordbox:cueWaveDetail`), `src/preload/index.ts`, `src/preload/api.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`
- Test: `src/main/anlz.test.ts`, `src/main/rekordboxCuesIpc.test.ts`

**Interfaces:**
- Consumes: `anlzSections`, `insideShare`, `withCollection`, `keyOf`, `rekordboxShareDir` (all existing).
- Produces: `colorWaveWords(ext: Buffer): Uint16Array | null`; `readCueWaveDetail(db, shareDir: string, contentId: string): Uint16Array | null`; IPC `rekordbox:cueWaveDetail(contentId)`; `Api.rekordboxCueWaveDetail: (contentId: string) => Promise<Uint16Array | null>`.

- [ ] **Step 1: Write the failing tests**

`src/main/anlz.test.ts`: add `colorWaveWords` to the `./anlz` import and:

```ts
describe('colorWaveWords', () => {
  it('hands over every PWV5 entry untouched, 150 a second, for the zoomed wave', () => {
    const words = colorWaveWords(
      anlzFile(
        pwv5Section([
          { r: 7, g: 0, b: 0, h: 31 },
          { r: 0, g: 0, b: 7, h: 16 },
          { r: 1, g: 2, b: 3, h: 4 },
        ]),
      ),
    )
    expect(words).toBeInstanceOf(Uint16Array)
    expect([...(words as Uint16Array)]).toEqual([
      (7 << 13) | (31 << 2),
      (7 << 7) | (16 << 2),
      (1 << 13) | (2 << 10) | (3 << 7) | (4 << 2),
    ])
  })

  it('is null without a PWV5', () => {
    expect(colorWaveWords(anlzFile())).toBeNull()
  })
})
```

`src/main/rekordboxCuesIpc.test.ts`: add `pwv5Section` to the `./anlzFixture` import and inside `describe('registerRekordboxCuesIpc', …)`:

```ts
  async function detailCollection(withWave: boolean): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbdetail-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c) =>
        c.ID === '101' ? { ...c, AnalysisDataPath: ANLZ } : c,
      ),
    })
    mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
    writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
    if (withWave)
      writeFileSync(
        join(dir, 'share', ANLZ.replace(/\.DAT$/, '.EXT')),
        anlzFile(
          pwv5Section([
            { r: 7, g: 0, b: 0, h: 31 },
            { r: 0, g: 0, b: 7, h: 16 },
          ]),
        ),
      )
    return path
  }

  it('reads the whole colour wave of a track for the maximized editor and never changes the collection', async () => {
    const path = await detailCollection(true)
    const before = readFileSync(path)
    vi.mocked(openRekordboxDb).mockClear()
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
    })
    const words = (await handler('rekordbox:cueWaveDetail')({}, '101')) as Uint16Array
    expect([...words]).toEqual([(7 << 13) | (31 << 2), (7 << 7) | (16 << 2)])
    expect(vi.mocked(openRekordboxDb)).toHaveBeenCalled()
    expect(vi.mocked(openRekordboxDb).mock.calls.every(([, o]) => o?.readonly === true)).toBe(true)
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('has no detail for a track without PWV5, an unknown track or no collection', async () => {
    const path = await detailCollection(false)
    registerRekordboxCuesIpc({
      collection: () => path,
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
    })
    expect(await handler('rekordbox:cueWaveDetail')({}, '101')).toBeNull()
    expect(await handler('rekordbox:cueWaveDetail')({}, '999')).toBeNull()
    registerRekordboxCuesIpc({
      collection: () => '',
      queue: queue(),
      applyQuietly: quietly(),
      flow: () => MY_FLOW,
    })
    expect(await handler('rekordbox:cueWaveDetail')({}, '101')).toBeNull()
  })
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/anlz.test.ts src/main/rekordboxCuesIpc.test.ts`
Expected: FAIL, `colorWaveWords` is not exported and `rekordbox:cueWaveDetail not registered`.

- [ ] **Step 3: Implement**

`src/main/anlz.ts`, after `colorWave`:

```ts
export function colorWaveWords(ext: Buffer): Uint16Array | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PWV5')
  if (!s) return null
  const header = ext.readUInt32BE(s.start + 4)
  const count = Math.min(ext.readUInt32BE(s.start + 16), Math.floor((s.length - header) / 2))
  if (count <= 0) return null
  const words = new Uint16Array(count)
  for (let i = 0; i < count; i++) words[i] = ext.readUInt16BE(s.start + header + i * 2)
  return words
}
```

`src/main/rekordboxCues.ts`: add `colorWaveWords` to the `./anlz` import and after `readTrackCues`:

```ts
export function readCueWaveDetail(db: Db, shareDir: string, contentId: string): Uint16Array | null {
  const row = db
    .prepare(
      `SELECT AnalysisDataPath FROM djmdContent
        WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(contentId) as { AnalysisDataPath: string | null } | undefined
  if (!row?.AnalysisDataPath) return null
  const datPath = resolve(shareDir, `.${row.AnalysisDataPath}`)
  if (!insideShare(shareDir, datPath)) return null
  const ext = read(datPath.replace(/\.DAT$/, '.EXT'))
  return ext ? colorWaveWords(ext) : null
}
```

`src/main/rekordboxCuesIpc.ts`: import `readCueWaveDetail` with `readTrackCues`; after the `rekordbox:trackCues` handler:

```ts
  ipcMain.handle('rekordbox:cueWaveDetail', async (_e, contentId: string) => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => readCueWaveDetail(db, rekordboxShareDir(path), contentId),
      null,
      await keyOf(path),
    )
  })
```

`src/preload/index.ts`, after `rekordboxTrackCues`:

```ts
  rekordboxCueWaveDetail: (contentId: string): Promise<Uint16Array | null> =>
    ipcRenderer.invoke('rekordbox:cueWaveDetail', contentId),
```

`src/preload/api.ts`, after `rekordboxTrackCues`:

```ts
  rekordboxCueWaveDetail: (contentId: string) => Promise<Uint16Array | null>
```

`src/renderer/src/test/api.ts` and `src/scenarios/harness.tsx`, after `rekordboxTrackCues: async () => null,`:

```ts
    rekordboxCueWaveDetail: async () => null,
```

- [ ] **Step 4: Run tests, types, lint**

Both test files: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/main/anlz.ts apps/desktop/src/main/anlz.test.ts apps/desktop/src/main/rekordboxCues.ts apps/desktop/src/main/rekordboxCuesIpc.ts apps/desktop/src/main/rekordboxCuesIpc.test.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/scenarios/harness.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Read a track's full rekordbox colour wave for the cue editor"
```

---

### Task 5: The zoomed wave

**Files:**
- Create: `src/renderer/src/lib/cueDetail.ts`, `src/renderer/src/lib/cueDetail.test.ts`, `src/renderer/src/components/CueWaveDetail.tsx`, `src/renderer/src/components/CueWaveDetail.test.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json`

**Interfaces:**
- Consumes: `barsToNextCall`, `detailWindow`, `ZOOM_BARS` (Task 3); `placeCues`, `markStyle` (`lib/cueMarks.ts`); `barLines` (`lib/cueWave.ts`); `WaveCue` (`components/CueWave.tsx`); `MEMORY_CUE_COLOR`.
- Produces:
  - `type DetailSource = { words: Uint16Array } | { wave: CueWaveColumn[]; durationMs: number }`, `PWV5_PER_SECOND = 150`, `decodeWaveWord(word: number): CueWaveColumn`, `visibleColumns(source: DetailSource, fromMs: number, toMs: number, width: number): (CueWaveColumn | null)[]`
  - `<CueWaveDetail source grid cues selected playheadMs bars onScrub onZoom />` with props `source: DetailSource | null`, `grid: { ms: number; beat: number }[]`, `cues: WaveCue[]`, `selected: string | null`, `playheadMs: number`, `bars: number`, `onScrub: (ms: number) => void`, `onZoom: (dir: 'in' | 'out') => void`. Test ids: `cue-detail`, `cue-detail-bar`, `cue-detail-hot-<letter>`, `cue-detail-call-<ms>`, `cue-detail-playhead`, `cue-detail-to-call`, `cue-detail-zoom-in`, `cue-detail-zoom-out`.
  - i18n `editor.cues.detail`, `editor.cues.toCall`, `editor.cues.zoomIn`, `editor.cues.zoomOut`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/cueDetail.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodeWaveWord, visibleColumns } from './cueDetail'

const word = (r: number, g: number, b: number, h: number) => (r << 13) | (g << 10) | (b << 7) | (h << 2)

describe('decodeWaveWord', () => {
  it('reads height and colour the way the overview reads PWV5', () => {
    expect(decodeWaveWord(word(7, 0, 0, 31))).toEqual({ h: 1, rgb: [255, 0, 0] })
    expect(decodeWaveWord(word(0, 7, 0, 0))).toEqual({ h: 0, rgb: [0, 255, 0] })
  })
})

describe('visibleColumns', () => {
  const words = new Uint16Array(150)
  words[10] = word(7, 0, 0, 31)
  words[60] = word(0, 7, 0, 20)
  words[120] = word(0, 0, 7, 5)

  it('gives one column per pixel of the window, the tallest entry of each, at 150 entries a second', () => {
    expect(visibleColumns({ words }, 0, 1000, 3)).toEqual([
      { h: 1, rgb: [255, 0, 0] },
      { h: 20 / 31, rgb: [0, 255, 0] },
      { h: 5 / 31, rgb: [0, 0, 255] },
    ])
  })

  it('leaves blank the part of the window before the start or after the end of the track', () => {
    expect(visibleColumns({ words }, -1000, 0, 2)).toEqual([null, null])
    expect(visibleColumns({ words }, 1000, 2000, 2)).toEqual([null, null])
  })

  it('stretches the overview when rekordbox has no PWV5 for the track', () => {
    const wave = [
      { h: 0.1, rgb: null },
      { h: 0.2, rgb: null },
      { h: 0.3, rgb: null },
      { h: 0.4, rgb: null },
    ]
    expect(visibleColumns({ wave, durationMs: 4000 }, 1000, 3000, 2)).toEqual([wave[1], wave[2]])
  })
})
```

`src/renderer/src/components/CueWaveDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { CueWaveDetail } from './CueWaveDetail'

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 160,
    right: 400,
    bottom: 160,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(over: Partial<React.ComponentProps<typeof CueWaveDetail>> = {}) {
  const onScrub = vi.fn<(ms: number) => void>()
  const onZoom = vi.fn<(dir: 'in' | 'out') => void>()
  render(
    <CueWaveDetail
      source={null}
      grid={GRID}
      cues={[]}
      selected={null}
      playheadMs={bar(32)}
      bars={16}
      onScrub={onScrub}
      onZoom={onZoom}
      {...over}
    />,
  )
  return { onScrub, onZoom }
}

describe('CueWaveDetail', () => {
  it('shows the bars around the playhead, which stays fixed in the centre', () => {
    setup()
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(17)
    expect(screen.getByTestId('cue-detail-playhead')).toHaveClass('left-1/2')
  })

  it('shows fewer bars once zoomed in', () => {
    setup({ bars: 8 })
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(9)
  })

  it('draws the cues inside the window by the shared rule and leaves out the rest', () => {
    setup({
      cues: [
        { key: 'a', ms: bar(16), kind: 1, color: 42, pending: false },
        { key: 'b', ms: bar(36), kind: 2, color: 22, pending: false },
        { key: 'p', ms: bar(36), kind: 0, color: null, pending: false },
        { key: 'd', ms: bar(40), kind: 0, color: null, pending: true },
      ],
      selected: 'b',
    })
    expect(screen.queryByTestId('cue-detail-hot-A')).toBeNull()
    expect(screen.getByTestId('cue-detail-hot-B').style.left).toBe('75%')
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId(`cue-detail-call-${bar(36)}`).style.left).toBe('75%')
    expect(screen.getByTestId(`cue-detail-call-${bar(40)}`).style.left).toBe('100%')
  })

  it('says how many bars are left to the next CALL, as rekordbox does above the playhead', () => {
    setup({ cues: [{ key: 'd', ms: bar(48), kind: 0, color: null, pending: false }] })
    expect(screen.getByTestId('cue-detail-to-call')).toHaveTextContent('-16.0 bars to the CALL')
  })

  it('says nothing about a CALL when none lies ahead', () => {
    setup({ cues: [{ key: 'd', ms: bar(8), kind: 0, color: null, pending: false }] })
    expect(screen.queryByTestId('cue-detail-to-call')).toBeNull()
  })

  it('moves the playhead forward when the wave is dragged left, as the wave runs under it', () => {
    const { onScrub } = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 300 })
    expect(onScrub).toHaveBeenLastCalledWith(bar(32) + 8000)
    fireEvent.mouseUp(window, { clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledTimes(1)
  })

  it('paints at most one column per pixel however long the track, so a 5 minute wave stays smooth', () => {
    const fillRect = vi.fn()
    const fake = { clearRect: vi.fn(), fillRect, fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake as never)
    const words = new Uint16Array(45000).fill((7 << 13) | (31 << 2))
    setup({ source: { words }, playheadMs: 150000 })
    expect(fillRect.mock.calls.length).toBeGreaterThan(0)
    expect(fillRect.mock.calls.length).toBeLessThanOrEqual(400)
  })

  it('zooms with its buttons and stops at 4 and 64 bars', () => {
    const { onZoom } = setup({ bars: 4 })
    expect(screen.getByTestId('cue-detail-zoom-in')).toBeDisabled()
    fireEvent.click(screen.getByTestId('cue-detail-zoom-out'))
    expect(onZoom).toHaveBeenCalledWith('out')
  })

  it('stops zooming out at 64 bars', () => {
    setup({ bars: 64 })
    expect(screen.getByTestId('cue-detail-zoom-out')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueDetail.test.ts src/renderer/src/components/CueWaveDetail.test.tsx`
Expected: FAIL, neither module exists.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/cueDetail.ts`:

```ts
import type { CueWaveColumn } from '../../../shared/types'

export const PWV5_PER_SECOND = 150

export type DetailSource = { words: Uint16Array } | { wave: CueWaveColumn[]; durationMs: number }

const level = (v: number): number => Math.round((v / 7) * 255)

export function decodeWaveWord(word: number): CueWaveColumn {
  return {
    h: ((word >> 2) & 0x1f) / 31,
    rgb: [level((word >> 13) & 7), level((word >> 10) & 7), level((word >> 7) & 7)],
  }
}

function entries(source: DetailSource): {
  count: number
  perMs: number
  at: (i: number) => CueWaveColumn
} {
  if ('words' in source)
    return {
      count: source.words.length,
      perMs: PWV5_PER_SECOND / 1000,
      at: (i) => decodeWaveWord(source.words[i]),
    }
  return {
    count: source.wave.length,
    perMs: source.wave.length / Math.max(source.durationMs, 1),
    at: (i) => source.wave[i],
  }
}

export function visibleColumns(
  source: DetailSource,
  fromMs: number,
  toMs: number,
  width: number,
): (CueWaveColumn | null)[] {
  const { count, perMs, at } = entries(source)
  const step = (toMs - fromMs) / Math.max(width, 1)
  return Array.from({ length: Math.max(width, 0) }, (_, x) => {
    const from = Math.floor((fromMs + x * step) * perMs)
    const to = Math.max(from + 1, Math.floor((fromMs + (x + 1) * step) * perMs))
    let best: CueWaveColumn | null = null
    for (let i = Math.max(from, 0); i < Math.min(to, count); i++) {
      const column = at(i)
      if (!best || column.h > best.h) best = column
    }
    return best
  })
}
```

`src/renderer/src/components/CueWaveDetail.tsx`:

```tsx
import { Minus, Plus } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { type DetailSource, visibleColumns } from '../lib/cueDetail'
import { markStyle, placeCues } from '../lib/cueMarks'
import { barsToNextCall, detailWindow, ZOOM_BARS } from '../lib/cuePlayhead'
import { barLines } from '../lib/cueWave'
import type { WaveCue } from './CueWave'

const HEIGHT = 160
const ZOOM_BUTTON =
  'press flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] text-fg-dim hover:text-fg disabled:opacity-40'

export function CueWaveDetail({
  source,
  grid,
  cues,
  selected,
  playheadMs,
  bars,
  onScrub,
  onZoom,
}: {
  source: DetailSource | null
  grid: { ms: number; beat: number }[]
  cues: WaveCue[]
  selected: string | null
  playheadMs: number
  bars: number
  onScrub: (ms: number) => void
  onZoom: (dir: 'in' | 'out') => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beats = useMemo(() => grid.map((b) => b.ms), [grid])
  const lines = useMemo(() => barLines(grid), [grid])
  const { fromMs, toMs } = detailWindow(beats, playheadMs, bars)
  const span = toMs - fromMs
  const latest = useRef({ span, onScrub })
  latest.current = { span, onScrub }
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
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width))
    canvas.width = width
    canvas.height = HEIGHT
    g.clearRect(0, 0, width, HEIGHT)
    if (!source) return
    const faint = getComputedStyle(canvas).getPropertyValue('--color-fg-faint')
    visibleColumns(source, fromMs, toMs, width).forEach((column, x) => {
      if (!column) return
      const h = Math.max(column.h * HEIGHT, 1)
      g.fillStyle = column.rgb ? `rgb(${column.rgb.join(',')})` : faint
      g.fillRect(x, (HEIGHT - h) / 2, 1, h)
    })
  }, [source, fromMs, toMs])
  const { hot, calls } = placeCues(
    cues.map((c) => ({ ...c, ms: c.ms - fromMs })),
    span,
  )
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const toCall = barsToNextCall(beats, cues, playheadMs)
  const zoomAt = ZOOM_BARS.findIndex((z) => z === bars)
  const pct = (ms: number): string => `${((ms - fromMs) / span) * 100}%`
  return (
    <div
      ref={rootRef}
      data-testid="cue-detail"
      role="img"
      aria-label={t('editor.cues.detail')}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const width = rootRef.current?.getBoundingClientRect().width ?? 0
        if (width > 0) setDrag({ x0: e.clientX, ms0: playheadMs, width })
      }}
      className="relative h-40 w-full cursor-grab select-none overflow-hidden rounded-md bg-[var(--color-panel-2)]"
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      {lines
        .filter((b) => b.ms >= fromMs && b.ms <= toMs)
        .map((b) => (
          <span
            key={b.ms}
            data-testid="cue-detail-bar"
            aria-hidden="true"
            style={{ left: pct(b.ms) }}
            className={`absolute top-0 bottom-0 w-px ${
              b.strong ? 'bg-[var(--color-fg)]/40' : 'bg-[var(--color-fg)]/15'
            }`}
          />
        ))}
      {calls.map((c) => (
        <span
          key={`c${c.key}`}
          data-testid={`cue-detail-call-${c.ms + fromMs}`}
          aria-hidden="true"
          style={{ ...markStyle(c.at, 'call', 'wave'), borderTopColor: MEMORY_CUE_COLOR }}
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
            data-selected={selected === h.key ? 'true' : 'false'}
            aria-hidden="true"
            style={{
              ...markStyle(h.at, 'hot', 'wave'),
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
        style={{ backgroundColor: MEMORY_CUE_COLOR }}
        className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-0.5 -translate-x-1/2"
      />
      {toCall !== null && (
        <span
          data-testid="cue-detail-to-call"
          style={{ color: MEMORY_CUE_COLOR }}
          className="pointer-events-none absolute top-6 right-1/2 mr-2 whitespace-nowrap font-mono text-[13px] font-semibold tabular-nums"
        >
          {t('editor.cues.toCall', { bars: `-${toCall.toFixed(1)}` })}
        </span>
      )}
      <div className="absolute top-1/2 left-2 flex -translate-y-1/2 flex-col gap-1.5">
        <button
          type="button"
          data-testid="cue-detail-zoom-in"
          aria-label={t('editor.cues.zoomIn')}
          disabled={zoomAt === 0}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onZoom('in')}
          className={ZOOM_BUTTON}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cue-detail-zoom-out"
          aria-label={t('editor.cues.zoomOut')}
          disabled={zoomAt === ZOOM_BARS.length - 1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onZoom('out')}
          className={ZOOM_BUTTON}
        >
          <Minus className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
```

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-manual-t5.json` and merge it:

```json
{
  "es": { "editor": { "cues": { "detail": "Onda ampliada", "toCall": "{{bars}} compases al CALL", "zoomIn": "Acercar", "zoomOut": "Alejar" } } },
  "en": { "editor": { "cues": { "detail": "Zoomed wave", "toCall": "{{bars}} bars to the CALL", "zoomIn": "Zoom in", "zoomOut": "Zoom out" } } },
  "de": { "editor": { "cues": { "detail": "Vergrößerte Wellenform", "toCall": "{{bars}} Takte bis zum CALL", "zoomIn": "Vergrößern", "zoomOut": "Verkleinern" } } },
  "fr": { "editor": { "cues": { "detail": "Onde agrandie", "toCall": "{{bars}} mesures avant le CALL", "zoomIn": "Zoomer", "zoomOut": "Dézoomer" } } },
  "pt-BR": { "editor": { "cues": { "detail": "Onda ampliada", "toCall": "{{bars}} compassos até o CALL", "zoomIn": "Aproximar", "zoomOut": "Afastar" } } }
}
```

- [ ] **Step 4: Run tests, types, lint**

Both test files plus `src/renderer/src/i18n/keys.test.ts` and `src/renderer/src/i18n/usedKeys.test.ts`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueDetail.ts apps/desktop/src/renderer/src/lib/cueDetail.test.ts apps/desktop/src/renderer/src/components/CueWaveDetail.tsx apps/desktop/src/renderer/src/components/CueWaveDetail.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Draw the zoomed cue wave around a fixed playhead"
```

---

### Task 6: The section's sound

**Files:**
- Create: `src/renderer/src/hooks/useCueAudition.ts`, `src/renderer/src/hooks/useCueAudition.test.tsx`

**Interfaces:**
- Consumes: `mediaUrl` from `src/shared/media.ts`.
- Produces: `interface CueAudition { playing: boolean; toggle: (fromMs: number) => void; seek: (ms: number) => void; stop: () => void }` and `useCueAudition(path: string, active: boolean, onPosition: (ms: number) => void): CueAudition`. It plays `path` from `fromMs`, pauses every `<audio>` in the document first, calls `onPosition` with the media time in ms on every animation frame while sounding, and stops when toggled again, when `active` turns false, when `path` changes and on unmount.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/hooks/useCueAudition.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCueAudition } from './useCueAudition'

const play = vi.fn<() => Promise<void>>()
const pause = vi.fn<() => void>()
const audios: FakeAudio[] = []
const frames: FrameRequestCallback[] = []

class FakeAudio {
  src: string
  onloadedmetadata: (() => void) | null = null
  onended: (() => void) | null = null
  currentTime = 0
  play = play
  pause = pause
  constructor(src: string) {
    this.src = src
    audios.push(this)
  }
}

beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  frames.length = 0
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const nextFrame = () =>
  act(() => {
    for (const frame of frames.splice(0)) frame(0)
  })

async function started(onPosition = vi.fn<(ms: number) => void>()) {
  const hook = renderHook(
    (props: { path: string; active: boolean }) =>
      useCueAudition(props.path, props.active, onPosition),
    { initialProps: { path: '/m/g.wav', active: true } },
  )
  act(() => hook.result.current.toggle(64000))
  await act(async () => {
    audios[0].onloadedmetadata?.()
  })
  return { hook, onPosition }
}

describe('useCueAudition', () => {
  it('plays the track from the playhead and pauses the floating player so two never sound', async () => {
    const shared = document.body.appendChild(document.createElement('audio'))
    const pauseShared = vi.fn()
    shared.pause = pauseShared
    const { hook } = await started()
    expect(audios[0].src).toContain('g.wav')
    expect(audios[0].currentTime).toBe(64)
    expect(play).toHaveBeenCalled()
    expect(pauseShared).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(true)
  })

  it('moves the playhead with the sound on every frame so the wave follows without jumps', async () => {
    const { onPosition } = await started()
    audios[0].currentTime = 64.5
    nextFrame()
    expect(onPosition).toHaveBeenLastCalledWith(64500)
    audios[0].currentTime = 64.52
    nextFrame()
    expect(onPosition).toHaveBeenLastCalledWith(64520)
  })

  it('keeps sounding from the new point when the playhead jumps while it plays', async () => {
    const { hook } = await started()
    act(() => hook.result.current.seek(96000))
    expect(audios[0].currentTime).toBe(96)
    expect(audios).toHaveLength(1)
  })

  it('stops on a second toggle and stops following', async () => {
    const { hook, onPosition } = await started()
    act(() => hook.result.current.toggle(0))
    expect(pause).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(false)
    onPosition.mockClear()
    nextFrame()
    expect(onPosition).not.toHaveBeenCalled()
  })

  it('stops when the editor is no longer maximized', async () => {
    const { hook } = await started()
    hook.rerender({ path: '/m/g.wav', active: false })
    expect(pause).toHaveBeenCalled()
    expect(hook.result.current.playing).toBe(false)
  })

  it('stops on another track', async () => {
    const { hook } = await started()
    hook.rerender({ path: '/m/other.wav', active: true })
    expect(pause).toHaveBeenCalled()
  })

  it('stops when the section goes away', async () => {
    const { hook } = await started()
    hook.unmount()
    expect(pause).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/hooks/useCueAudition.test.tsx`
Expected: FAIL, `./useCueAudition` cannot be resolved.

- [ ] **Step 3: Implement**

`src/renderer/src/hooks/useCueAudition.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../shared/media'

export interface CueAudition {
  playing: boolean
  toggle: (fromMs: number) => void
  seek: (ms: number) => void
  stop: () => void
}

export function useCueAudition(
  path: string,
  active: boolean,
  onPosition: (ms: number) => void,
): CueAudition {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frame = useRef<number | null>(null)
  const latest = useRef(onPosition)
  latest.current = onPosition
  const [playing, setPlaying] = useState(false)

  const stop = useCallback((): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    audioRef.current?.pause()
    audioRef.current = null
    setPlaying(false)
  }, [])

  const follow = useCallback((audio: HTMLAudioElement): void => {
    const tick = () => {
      if (audioRef.current !== audio) return
      latest.current(audio.currentTime * 1000)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(
    (fromMs: number): void => {
      stop()
      for (const other of document.querySelectorAll('audio')) other.pause()
      const audio = new Audio(mediaUrl(path))
      audioRef.current = audio
      audio.onloadedmetadata = () => {
        audio.currentTime = fromMs / 1000
        audio
          .play()
          .then(() => {
            if (audioRef.current === audio) follow(audio)
          })
          .catch(() => stop())
      }
      audio.onended = () => stop()
      setPlaying(true)
    },
    [path, stop, follow],
  )

  const toggle = useCallback(
    (fromMs: number): void => (audioRef.current ? stop() : start(fromMs)),
    [start, stop],
  )

  const seek = useCallback((ms: number): void => {
    if (audioRef.current) audioRef.current.currentTime = ms / 1000
  }, [])

  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  useEffect(() => stop, [path, stop])

  return { playing, toggle, seek, stop }
}
```

- [ ] **Step 4: Run tests, types, lint**

The test file: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/hooks/useCueAudition.ts apps/desktop/src/renderer/src/hooks/useCueAudition.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Play a track from the cue editor's playhead and stop it with the editor"
```

---

### Task 7: The draft survives the portal

`Editor` renders a maximized section with `createPortal` (`Editor.tsx`, the `id === maximized` branch), so maximizing or restoring the Cues section mounts a new `CuesSection` and the reducer state in `Editing` starts again from rekordbox: every unsaved edit is lost.

**Files:**
- Create: `src/renderer/src/lib/cueSession.ts`, `src/renderer/src/lib/cueSession.test.ts`
- Modify: `src/renderer/src/components/CuesSection.tsx`
- Test: `src/renderer/src/components/CuesSection.test.tsx`

**Interfaces:**
- Consumes: `CueDraft`, `startDraft` (`lib/cueDraft.ts`).
- Produces: `keptDraft(key: string): CueDraft | undefined`, `keepDraft(key: string, draft: CueDraft): void`, `forgetDraft(): void`, `keptPlayhead(contentId: string): number`, `keepPlayhead(contentId: string, ms: number): void`, `resetCueSession(): void` (test seam). `Editing` gains the prop `draftKey: string` (`${contentId}|${fingerprint}|${JSON.stringify(queued)}`).

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/cueSession.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startDraft } from './cueDraft'
import {
  forgetDraft,
  keepDraft,
  keepPlayhead,
  keptDraft,
  keptPlayhead,
  resetCueSession,
} from './cueSession'

afterEach(resetCueSession)

describe('cue session', () => {
  it('gives back the draft kept for the same track and read, and none for another', () => {
    const draft = startDraft([{ ms: 1000, kind: 1, color: 22 }], 'mine')
    keepDraft('103|f0|null', draft)
    expect(keptDraft('103|f0|null')).toBe(draft)
    expect(keptDraft('104|f0|null')).toBeUndefined()
    expect(keptDraft('103|f1|null')).toBeUndefined()
  })

  it('keeps one draft only, so an older track never comes back', () => {
    keepDraft('103|f0|null', startDraft([], 'mine'))
    keepDraft('104|f0|null', startDraft([], 'mine'))
    expect(keptDraft('103|f0|null')).toBeUndefined()
  })

  it('forgets the draft on Descartar cambios', () => {
    keepDraft('103|f0|null', startDraft([], 'mine'))
    forgetDraft()
    expect(keptDraft('103|f0|null')).toBeUndefined()
  })

  it('keeps the playhead of the track and starts any other track at 0', () => {
    keepPlayhead('103', 64000)
    expect(keptPlayhead('103')).toBe(64000)
    expect(keptPlayhead('104')).toBe(0)
  })
})
```

In `src/renderer/src/components/CuesSection.test.tsx` import `resetCueSession` from `'../lib/cueSession'`, add `afterEach(resetCueSession)` under `afterEach(cleanup)`, and in `describe('CuesSection', …)`:

```ts
  it('keeps the unsaved cues when the section is mounted again in another place, as maximizing does', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    cleanup()
    setup()
    await ready()
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
  })

  it('starts from rekordbox again after Descartar cambios, even once the section is mounted again', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
    cleanup()
    setup()
    await ready()
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
  })
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueSession.test.ts src/renderer/src/components/CuesSection.test.tsx`
Expected: FAIL, `./cueSession` cannot be resolved; once it exists, "keeps the unsaved cues…" fails (no `cue-wave-hot-A` after the second mount). "starts from rekordbox again…" passes now and is the guard that fails if Step 3 forgets `forgetDraft()`.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/cueSession.ts`:

```ts
import type { CueDraft } from './cueDraft'

let draft: { key: string; value: CueDraft } | null = null
let playhead: { contentId: string; ms: number } | null = null

export function keptDraft(key: string): CueDraft | undefined {
  return draft?.key === key ? draft.value : undefined
}

export function keepDraft(key: string, value: CueDraft): void {
  draft = { key, value }
}

export function forgetDraft(): void {
  draft = null
}

export function keptPlayhead(contentId: string): number {
  return playhead?.contentId === contentId ? playhead.ms : 0
}

export function keepPlayhead(contentId: string, ms: number): void {
  playhead = { contentId, ms }
}

export function resetCueSession(): void {
  draft = null
  playhead = null
}
```

`src/renderer/src/components/CuesSection.tsx`:

- Import `forgetDraft, keepDraft, keptDraft` from `'../lib/cueSession'` (after the `cueFlowName` import).
- `Editing` destructures `draftKey` and types it `draftKey: string` (after `cue`).
- Replace the reducer initializer

```ts
    () =>
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
      ),
  )
```

with

```ts
    () =>
      keptDraft(draftKey) ??
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
      ),
  )
  useEffect(() => keepDraft(draftKey, state), [draftKey, state])
```

- In `CuesSection`, after `const [round, setRound] = useState(0)`:

```ts
  const draftKey = `${cue.contentId}|${read?.fingerprint ?? ''}|${JSON.stringify(queued)}`
```

- The `<Editing` element becomes `key={`${draftKey}|${round}`}`, gains `draftKey={draftKey}`, and `onDiscard` starts with `forgetDraft()` before `setRound((n) => n + 1)`.

- [ ] **Step 4: Run tests, types, lint**

`src/renderer/src/lib/cueSession.test.ts`, `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.dedupe.test.tsx`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueSession.ts apps/desktop/src/renderer/src/lib/cueSession.test.ts apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Keep unsaved cues when the Cues section is mounted again"
```

---

### Task 8: The deck: pads, MEMORY and jump

**Files:**
- Create: `src/renderer/src/components/CueDeck.tsx`, `src/renderer/src/components/CueDeck.test.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json`

**Interfaces:**
- Consumes: `CUE_JUMP_BARS`, `CueJumpBars` (Task 1); `HOT_KINDS`; `hotCueColor`; `cueLetter`.
- Produces: `interface DeckCue { key: string; kind: number; color: number | null }` and `<CueDeck cues selected jumpBars onPad onMemory onMemoryStep onMemoryRemove onJumpBars />` with `onPad: (kind: number) => void`, `onMemory: () => void`, `onMemoryStep: (dir: 1 | -1) => void`, `onMemoryRemove: () => void`, `onJumpBars: (bars: CueJumpBars) => void`. Test ids: `cues-deck`, `cues-pad-<A..H>` (`data-set`, `aria-pressed`), `cues-memory`, `cues-memory-prev`, `cues-memory-next`, `cues-memory-remove`, `cues-jump-less`, `cues-jump-value`, `cues-jump-more`. i18n `editor.cues.memory`, `memoryPrev`, `memoryNext`, `memoryRemove`, `jump`, `jumpLess`, `jumpMore`, `jumpBars_one`, `jumpBars_other`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/CueDeck.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CueJumpBars } from '../../../shared/cueJump'
import '../i18n'
import { CueDeck } from './CueDeck'

function setup(over: Partial<React.ComponentProps<typeof CueDeck>> = {}) {
  const handlers = {
    onPad: vi.fn<(kind: number) => void>(),
    onMemory: vi.fn<() => void>(),
    onMemoryStep: vi.fn<(dir: 1 | -1) => void>(),
    onMemoryRemove: vi.fn<() => void>(),
    onJumpBars: vi.fn<(bars: CueJumpBars) => void>(),
  }
  render(
    <CueDeck
      cues={[
        { key: 'a', kind: 1, color: 42 },
        { key: 'p', kind: 0, color: null },
      ]}
      selected="a"
      jumpBars={16}
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

describe('CueDeck', () => {
  it('shows pads A to H with the key that sets each, coloured where a hot cue is', () => {
    setup()
    for (const letter of 'ABCDEFGH') expect(screen.getByTestId(`cues-pad-${letter}`)).toBeInTheDocument()
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('data-set', 'true')
    expect(screen.getByTestId('cues-pad-A')).toHaveStyle({ backgroundColor: '#e62828' })
    expect(screen.getByTestId('cues-pad-A')).toHaveTextContent('A1')
    expect(screen.getByTestId('cues-pad-H')).toHaveTextContent('H8')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('data-set', 'false')
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

  it('puts, walks and removes CALLs with MEMORY and its arrows', () => {
    const h = setup()
    fireEvent.click(screen.getByTestId('cues-memory'))
    fireEvent.click(screen.getByTestId('cues-memory-prev'))
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(h.onMemory).toHaveBeenCalledTimes(1)
    expect(h.onMemoryStep.mock.calls).toEqual([[-1], [1]])
    expect(h.onMemoryRemove).toHaveBeenCalledTimes(1)
  })

  it('steps the jump through 8, 16, 32 and 64 bars', () => {
    const { onJumpBars } = setup()
    expect(screen.getByTestId('cues-jump-value')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump-less'))
    fireEvent.click(screen.getByTestId('cues-jump-more'))
    expect(onJumpBars.mock.calls).toEqual([[8], [32]])
  })

  it('stops the jump at 8 and at 64 bars', () => {
    setup({ jumpBars: 8 })
    expect(screen.getByTestId('cues-jump-less')).toBeDisabled()
  })

  it('offers no longer jump than 64 bars', () => {
    setup({ jumpBars: 64 })
    expect(screen.getByTestId('cues-jump-more')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueDeck.test.tsx`
Expected: FAIL, `./CueDeck` cannot be resolved.

- [ ] **Step 3: Implement**

`src/renderer/src/components/CueDeck.tsx`:

```tsx
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { CUE_JUMP_BARS, type CueJumpBars } from '../../../shared/cueJump'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { cueLetter } from '../lib/rowCues'

export interface DeckCue {
  key: string
  kind: number
  color: number | null
}

const BUTTON =
  'press inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--color-hover)]'
const GHOST =
  'press inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'
const STEP = 'press px-2 py-1 hover:bg-[var(--color-hover)] disabled:opacity-40'

export function CueDeck({
  cues,
  selected,
  jumpBars,
  onPad,
  onMemory,
  onMemoryStep,
  onMemoryRemove,
  onJumpBars,
}: {
  cues: DeckCue[]
  selected: string | null
  jumpBars: CueJumpBars
  onPad: (kind: number) => void
  onMemory: () => void
  onMemoryStep: (dir: 1 | -1) => void
  onMemoryRemove: () => void
  onJumpBars: (bars: CueJumpBars) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const at = CUE_JUMP_BARS.indexOf(jumpBars)
  return (
    <div data-testid="cues-deck" className="flex flex-wrap items-center gap-x-5 gap-y-3 pb-4">
      <div className="flex items-center gap-1.5">
        {HOT_KINDS.map((kind, i) => {
          const cue = cues.find((c) => c.kind === kind)
          const letter = cueLetter(kind)
          const isSelected = cue !== undefined && cue.key === selected
          return (
            <button
              key={kind}
              type="button"
              data-testid={`cues-pad-${letter}`}
              data-set={cue ? 'true' : 'false'}
              aria-label={tr('editor.cues.selectedHot', { letter })}
              aria-pressed={isSelected}
              onClick={() => onPad(kind)}
              style={cue ? { backgroundColor: hotCueColor(cue.color) } : undefined}
              className={`press relative flex h-8 w-9 items-center justify-center rounded-[5px] text-sm font-bold ${
                cue
                  ? 'text-white'
                  : 'border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg-faint'
              } ${isSelected ? 'outline outline-2 outline-offset-2 outline-[var(--color-fg)]' : ''}`}
            >
              {letter}
              <span
                aria-hidden="true"
                className="absolute -bottom-4 font-mono text-[10px] font-normal text-fg-faint"
              >
                {i + 1}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" data-testid="cues-memory" onClick={onMemory} className={BUTTON}>
          {tr('editor.cues.memory')}
          <kbd className="font-mono text-[11px] font-normal text-fg-faint">M</kbd>
        </button>
        <button
          type="button"
          data-testid="cues-memory-prev"
          aria-label={tr('editor.cues.memoryPrev')}
          onClick={() => onMemoryStep(-1)}
          className={GHOST}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-next"
          aria-label={tr('editor.cues.memoryNext')}
          onClick={() => onMemoryStep(1)}
          className={GHOST}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-remove"
          aria-label={tr('editor.cues.memoryRemove')}
          onClick={onMemoryRemove}
          className={GHOST}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-dim">{tr('editor.cues.jump')}</span>
        <div className="flex items-center overflow-hidden rounded-md border border-[var(--color-line-strong)]">
          <button
            type="button"
            data-testid="cues-jump-less"
            aria-label={tr('editor.cues.jumpLess')}
            disabled={at <= 0}
            onClick={() => onJumpBars(CUE_JUMP_BARS[at - 1])}
            className={STEP}
          >
            ‹
          </button>
          <span
            data-testid="cues-jump-value"
            className="min-w-24 border-x border-[var(--color-line-strong)] px-2 py-1 text-center font-mono"
          >
            {tr('editor.cues.jumpBars', { count: jumpBars })}
          </span>
          <button
            type="button"
            data-testid="cues-jump-more"
            aria-label={tr('editor.cues.jumpMore')}
            disabled={at >= CUE_JUMP_BARS.length - 1}
            onClick={() => onJumpBars(CUE_JUMP_BARS[at + 1])}
            className={STEP}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
```

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-manual-t8.json` and merge it:

```json
{
  "es": { "editor": { "cues": { "memory": "MEMORY", "memoryPrev": "CALL anterior", "memoryNext": "CALL siguiente", "memoryRemove": "Borrar el CALL del cabezal", "jump": "Salto", "jumpLess": "Saltar menos compases", "jumpMore": "Saltar más compases", "jumpBars_one": "{{count}} compás", "jumpBars_other": "{{count}} compases" } } },
  "en": { "editor": { "cues": { "memory": "MEMORY", "memoryPrev": "Previous CALL", "memoryNext": "Next CALL", "memoryRemove": "Delete the CALL at the playhead", "jump": "Jump", "jumpLess": "Jump fewer bars", "jumpMore": "Jump more bars", "jumpBars_one": "{{count}} bar", "jumpBars_other": "{{count}} bars" } } },
  "de": { "editor": { "cues": { "memory": "MEMORY", "memoryPrev": "Vorheriger CALL", "memoryNext": "Nächster CALL", "memoryRemove": "CALL am Abspielkopf löschen", "jump": "Sprung", "jumpLess": "Weniger Takte springen", "jumpMore": "Mehr Takte springen", "jumpBars_one": "{{count}} Takt", "jumpBars_other": "{{count}} Takte" } } },
  "fr": { "editor": { "cues": { "memory": "MEMORY", "memoryPrev": "CALL précédent", "memoryNext": "CALL suivant", "memoryRemove": "Supprimer le CALL sous la tête de lecture", "jump": "Saut", "jumpLess": "Sauter moins de mesures", "jumpMore": "Sauter plus de mesures", "jumpBars_one": "{{count}} mesure", "jumpBars_other": "{{count}} mesures" } } },
  "pt-BR": { "editor": { "cues": { "memory": "MEMORY", "memoryPrev": "CALL anterior", "memoryNext": "Próximo CALL", "memoryRemove": "Apagar o CALL no cursor", "jump": "Salto", "jumpLess": "Saltar menos compassos", "jumpMore": "Saltar mais compassos", "jumpBars_one": "{{count}} compasso", "jumpBars_other": "{{count}} compassos" } } }
}
```

- [ ] **Step 4: Run tests, types, lint**

`src/renderer/src/components/CueDeck.test.tsx`, `src/renderer/src/i18n/keys.test.ts`: PASS. `usedKeys.test.ts` passes too (every new key is read by `CueDeck`). Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CueDeck.tsx apps/desktop/src/renderer/src/components/CueDeck.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Add the cue deck with pads A to H, MEMORY and the bar jump"
```

---

### Task 9: The section maximizes into the editor

**Files:**
- Modify: `src/renderer/src/components/CuesSection.tsx` (whole file below), `src/renderer/src/components/CueWave.tsx`, `src/renderer/src/hooks/useTrackCues.ts`, `src/renderer/src/components/Editor.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/i18n/locales/*.json`
- Create: `src/renderer/src/components/CuesSection.maximized.test.tsx`
- Test: `src/renderer/src/components/CueWave.test.tsx`, `src/renderer/src/components/Editor.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 8 (`cueJumpBars`, `add-hot` with `kind`, `adjacentCall`, `callAt`, `cueClock`, `DEFAULT_ZOOM_BARS`, `zoomStep`, `rekordboxCueWaveDetail`, `DetailSource`, `CueWaveDetail`, `keptPlayhead`, `keepPlayhead`, `CueDeck`), `useMaximizedSection`.
- Produces:
  - `useCueWaveDetail(contentId: string, enabled: boolean): { data: Uint16Array | null | undefined }` in `hooks/useTrackCues.ts`.
  - `CueWave` props `playheadMs?: number` (draws `cue-wave-playhead`) and `onSeek?: (ms: number) => void` (a click on the wave seeks instead of marking a drop, and no ghost is shown).
  - `export interface CueTrackInfo { title: string; artist: string; bpm: string; key: string; cover?: string }`; `CuesSection` props `track?: CueTrackInfo`, `onJumpBars?: (bars: CueJumpBars) => void`. Maximized test ids: `cues-editor[data-maximized]`, `cues-header`, `cues-position`, `cues-remaining`, `cues-bpm`, `cues-key`, plus the `cue-detail-*` and `cues-deck` ids.
  - `Editor` prop `onCueJumpBars?: (bars: CueJumpBars) => void`.
  - i18n `editor.cues.bpm`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/CueWave.test.tsx`, in `describe('CueWave', …)`:

```ts
  it('moves the playhead instead of marking a drop when the full editor seeks with it', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    const handlers = setup({ onSeek, playheadMs: 20000 })
    expect(screen.getByTestId('cue-wave-playhead').style.left).toBe('25%')
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 400 })
    expect(onSeek).toHaveBeenCalledWith(40000)
    expect(handlers.onMarkDrop).not.toHaveBeenCalled()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 200 })
    expect(screen.queryByTestId('cue-wave-ghost')).toBeNull()
  })

  it('draws no playhead and keeps marking drops in the folded section', () => {
    const handlers = setup()
    expect(screen.queryByTestId('cue-wave-playhead')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 200 })
    expect(handlers.onMarkDrop).toHaveBeenCalled()
  })
```

`src/renderer/src/components/CuesSection.maximized.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { Settings, TrackCues } from '../../../shared/types'
import '../i18n'
import { resetEditorSections } from '../hooks/useEditorSections'
import { resetCueSession } from '../lib/cueSession'
import { SettingsProvider } from '../lib/settingsContext'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}
const TRACK = { title: 'Pray', artist: 'Gowan', bpm: '120', key: '6A' }

afterEach(() => {
  cleanup()
  resetEditorSections()
  resetCueSession()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 80,
    right: 400,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(settings: Partial<Settings> | null = null) {
  const rekordboxCueWaveDetail = vi.fn<Api['rekordboxCueWaveDetail']>(async () => null)
  installApi({
    rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => READ),
    rekordboxQueuedCues: vi.fn<Api['rekordboxQueuedCues']>(async () => null),
    rekordboxCueWaveDetail,
  })
  const onJumpBars = vi.fn<(bars: CueJumpBars) => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={settings}>
        <CuesSection
          cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }}
          open
          onToggle={vi.fn()}
          track={TRACK}
          onJumpBars={onJumpBars}
        />
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { rekordboxCueWaveDetail, onJumpBars }
}

const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
const maximize = async () => {
  await ready()
  fireEvent.click(screen.getByTestId('section-maximize'))
  await waitFor(() =>
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
  )
}
const seek = (ms: number) => fireEvent.click(screen.getByTestId('cue-wave'), { clientX: ms / 1000 })
const position = () => screen.getByTestId('cues-position').textContent

describe('CuesSection maximized', () => {
  it('stays the section of today while folded into the column', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'false')
    expect(screen.queryByTestId('cue-detail')).toBeNull()
    expect(screen.queryByTestId('cues-deck')).toBeNull()
    seek(128000)
    expect(screen.getByTestId('cue-wave-drop-128000')).toBeInTheDocument()
  })

  it('opens the full editor with the track header, the zoomed wave and the deck', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-header')).toHaveTextContent('Pray')
    expect(screen.getByTestId('cues-header')).toHaveTextContent('Gowan')
    expect(screen.getByTestId('cues-bpm')).toHaveTextContent('120 BPM')
    expect(screen.getByTestId('cues-key')).toHaveTextContent('6A')
    expect(position()).toBe('0:00.0')
    expect(screen.getByTestId('cues-remaining')).toHaveTextContent('-6:40.0')
    expect(screen.getByTestId('cue-detail')).toBeInTheDocument()
    expect(screen.getByTestId('cues-deck')).toBeInTheDocument()
    expect(screen.getByTestId('cues-save')).toBeInTheDocument()
  })

  it('asks main for the full colour wave only once maximized', async () => {
    const { rekordboxCueWaveDetail } = setup()
    await ready()
    expect(rekordboxCueWaveDetail).not.toHaveBeenCalled()
    await maximize()
    await waitFor(() => expect(rekordboxCueWaveDetail).toHaveBeenCalledWith('103'))
  })

  it('moves the playhead with a click on the overview instead of marking a drop', async () => {
    setup()
    await maximize()
    seek(100000)
    expect(position()).toBe('1:40.0')
    expect(screen.queryByTestId('cue-wave-drop-100000')).toBeNull()
  })

  it('places a hot cue with a pad, and the pad of a placed cue jumps back to it and selects it', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toBe('16%')
    seek(200000)
    fireEvent.click(screen.getByTestId('cues-pad-B'))
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    expect(position()).toBe('1:04.0')
    expect(screen.getByTestId('cues-pad-A')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cues-pad-B')).toHaveAttribute('aria-pressed', 'false')
  })

  it('puts one CALL at the playhead with MEMORY, walks the CALLs and deletes the one under the playhead', async () => {
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
    fireEvent.click(screen.getByTestId('cues-memory-next'))
    expect(position()).toBe('2:00.0')
    fireEvent.click(screen.getByTestId('cues-memory-remove'))
    expect(screen.queryByTestId('cue-wave-call-120000')).toBeNull()
    expect(screen.getByTestId('cue-wave-call-64000')).toBeInTheDocument()
  })

  it('changes the jump with ‹ › and hands it on to be saved', async () => {
    const { onJumpBars } = setup()
    await maximize()
    expect(screen.getByTestId('cues-jump-value')).toHaveTextContent('16 bars')
    fireEvent.click(screen.getByTestId('cues-jump-more'))
    expect(onJumpBars).toHaveBeenCalledWith(32)
  })

  it('shows the jump set in Settings', async () => {
    setup({ cueJumpBars: 64 })
    await maximize()
    expect(screen.getByTestId('cues-jump-value')).toHaveTextContent('64 bars')
  })

  it('keeps the playhead when the section is mounted again on maximize or restore', async () => {
    setup()
    await maximize()
    seek(64000)
    cleanup()
    setup()
    await ready()
    expect(position()).toBe('1:04.0')
  })
})
```

`src/renderer/src/components/Editor.test.tsx`: in the `describe('Editor cues section', …)` `beforeEach`, add `rekordboxCueWaveDetail: vi.fn<Api['rekordboxCueWaveDetail']>().mockResolvedValue(null),` to the `Object.assign`, and:

```ts
  it('maximizes into the full cue editor with the track title, artist, BPM and key', async () => {
    const grid = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
    Object.assign((window as unknown as { api: object }).api, {
      rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>().mockResolvedValue({
        contentId: '103',
        analysed: true,
        grid,
        strong: [],
        phrases: [],
        cues: [],
        wave: null,
        durationMs: 400000,
        fingerprint: 'f0',
      }),
    })
    renderEditor({ id: 'a', meta: { title: 'Pray', artist: 'Gowan', bpm: '120', key: '6A' } }, 'wav', {
      rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
    })
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    fireEvent.click(within(screen.getByTestId('cues-section')).getByTestId('section-maximize'))
    const header = await screen.findByTestId('cues-header')
    expect(header).toHaveTextContent('Pray')
    expect(header).toHaveTextContent('Gowan')
    expect(header).toHaveTextContent('120 BPM')
    expect(header).toHaveTextContent('6A')
    expect(screen.getByTestId('section-maximized-overlay')).toContainElement(header)
  })
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueWave.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/Editor.test.tsx`
Expected: FAIL, no `cue-wave-playhead`, no `section-maximize` in the Cues header, no `cues-header`.

- [ ] **Step 3: Implement**

`src/renderer/src/hooks/useTrackCues.ts`, at the end:

```ts
export function useCueWaveDetail(
  contentId: string,
  enabled: boolean,
): { data: Uint16Array | null | undefined } {
  const { data } = useQuery({
    queryKey: ['rekordbox-cue-wave-detail', contentId],
    queryFn: () => window.api.rekordboxCueWaveDetail(contentId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return { data }
}
```

`src/renderer/src/components/CueWave.tsx`:

- `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'`.
- Add to the destructured props `playheadMs,` and `onSeek,` (after `onAcceptProposal`) and to the prop types `playheadMs?: number` and `onSeek?: (ms: number) => void`.
- Before `if (grid.length === 0) {`, memoise the wave and the bar lines so a moving playhead does not re-diff 1200 rects on every frame:

```tsx
  const waveSvg = useMemo(
    () =>
      wave && (
        <svg
          viewBox={`0 0 ${wave.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          {wave.map((c, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              key={i}
              x={i}
              width={1}
              y={50 - c.h * 50}
              height={Math.max(c.h * 100, 0.5)}
              fill={c.rgb ? `rgb(${c.rgb.join(',')})` : 'var(--color-fg-faint)'}
            />
          ))}
        </svg>
      ),
    [wave],
  )
  const bars = useMemo(
    () =>
      barLines(grid).map((b) => (
        <span
          key={b.ms}
          data-testid="cue-wave-bar"
          data-strong={b.strong ? 'true' : 'false'}
          aria-hidden="true"
          style={{ left: `${(b.ms / Math.max(durationMs, 1)) * 100}%` }}
          className={`absolute top-0 bottom-0 w-px ${
            b.strong ? 'bg-[var(--color-fg)]/40' : 'bg-[var(--color-fg)]/10'
          }`}
        />
      )),
    [grid, durationMs],
  )
```

(the `biome-ignore` line moves with the `rect` it already sat on; it is not a new comment) and replace the inline `{wave && (<svg …>…</svg>)}` and `{barLines(grid).map(…)}` blocks in the JSX with `{waveSvg}` and `{bars}`.
- In `onClick`, after `if (readOnly || swallowClick.current) return`:

```tsx
        if (onSeek) {
          onSeek(msAtX(e.clientX))
          return
        }
```

- In `onMouseMove`, change `if (readOnly) return` to `if (readOnly || onSeek) return`.
- Before the `dragMs !== null &&` block:

```tsx
      {playheadMs !== undefined && (
        <span
          data-testid="cue-wave-playhead"
          aria-hidden="true"
          style={{ left: pct(playheadMs), backgroundColor: MEMORY_CUE_COLOR }}
          className="pointer-events-none absolute top-0 bottom-0 w-0.5"
        />
      )}
```

`src/renderer/src/components/CuesSection.tsx`, the whole file:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import type React from 'react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCueFlow, MY_FLOW_ID } from '../../../shared/cueFlows'
import type { CueJumpBars } from '../../../shared/cueJump'
import { MAX_HOT_CUES } from '../../../shared/cueRules'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { useMaximizedSection } from '../hooks/useEditorSections'
import { useCueWaveDetail, useQueuedCues, useTrackCues } from '../hooks/useTrackCues'
import type { DetailSource } from '../lib/cueDetail'
import {
  type CueDraft,
  type DraftAction,
  type DraftCue,
  freeLetters,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from '../lib/cueDraft'
import { flowName } from '../lib/cueFlowName'
import { adjacentCall, callAt, cueClock, DEFAULT_ZOOM_BARS, zoomStep } from '../lib/cuePlayhead'
import { forgetDraft, keepDraft, keepPlayhead, keptDraft, keptPlayhead } from '../lib/cueSession'
import { cueLetter } from '../lib/rowCues'
import { useAppSettings } from '../lib/settingsContext'
import { CueDeck } from './CueDeck'
import { CuePalette } from './CuePalette'
import { CueWave } from './CueWave'
import { CueWaveDetail } from './CueWaveDetail'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'

interface CueTarget {
  contentId: string
  path: string
  label: string
}

export interface CueTrackInfo {
  title: string
  artist: string
  bpm: string
  key: string
  cover?: string
}

const MENU_ITEM =
  'block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-[var(--color-hover)] disabled:opacity-40'

function Editing({
  read,
  queued,
  cue,
  draftKey,
  maximized,
  track,
  playheadMs,
  onPlayhead,
  onJumpBars,
  onDiscard,
}: {
  read: TrackCues
  queued: QueuedCues | null
  cue: CueTarget
  draftKey: string
  maximized: boolean
  track?: CueTrackInfo
  playheadMs: number
  onPlayhead: (ms: number) => void
  onJumpBars?: (bars: CueJumpBars) => void
  onDiscard: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const ctx = useMemo(
    () => ({
      beats: read.grid.map((b) => b.ms),
      strong: read.strong,
      phrases: read.phrases,
      flows,
    }),
    [read, flows],
  )
  const inRekordbox = useMemo(
    () => read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color })),
    [read],
  )
  const fresh = queued !== null && queued.fingerprint === read.fingerprint
  const baseline = fresh ? queued.wanted : inRekordbox
  const [state, dispatch] = useReducer(
    (s: CueDraft, a: DraftAction) => reduceDraft(s, a, ctx),
    undefined,
    () =>
      keptDraft(draftKey) ??
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
      ),
  )
  useEffect(() => keepDraft(draftKey, state), [draftKey, state])
  const [menu, setMenu] = useState<{ ms: number; x: number; y: number } | null>(null)
  const [chosen, setChosen] = useState(state.flowId)
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
  const openedWith = useRef(active.id)
  useEffect(() => {
    if (openedWith.current === active.id) return
    openedWith.current = active.id
    setChosen(active.id)
    dispatch({ type: 'use-flow', flowId: active.id })
  }, [active.id])
  const menuRef = useRef<HTMLDivElement>(null)
  const wanted = wantedOfDraft(state.cues)
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline)
  const pending = (c: DraftCue): boolean =>
    !inRekordbox.some(
      (r) => r.id === c.id && r.ms === c.ms && r.kind === c.kind && r.color === c.color,
    )
  const selected = state.cues.find((c) => c.key === state.selected)
  const refreshQueued = () => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
  useEffect(() => {
    if (menu === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu])
  const fromMenu = (action: DraftAction) => {
    dispatch(action)
    setMenu(null)
  }
  const letters = selected ? freeLetters(state.cues, selected.kind) : []
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM_BARS)
  const { data: words } = useCueWaveDetail(cue.contentId, maximized)
  const source: DetailSource | null = words
    ? { words }
    : read.wave
      ? { wave: read.wave, durationMs: read.durationMs }
      : null
  const seekTo = (ms: number) => onPlayhead(Math.min(Math.max(ms, 0), read.durationMs))
  const pad = (kind: number) => {
    const existing = state.cues.find((c) => c.kind === kind)
    if (!existing) {
      dispatch({ type: 'add-hot', ms: playheadMs, kind })
      return
    }
    dispatch({ type: 'select', key: existing.key })
    seekTo(existing.ms)
  }
  const memoryStep = (dir: 1 | -1) => {
    const to = adjacentCall(state.cues, playheadMs, dir)
    if (to !== null) seekTo(to)
  }
  const memoryRemove = () => {
    const call = callAt(state.cues, playheadMs)
    if (call) dispatch({ type: 'remove', key: call.key })
  }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch({ type: 'remove', key: selected.key })
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      dispatch({ type: 'undo' })
    }
  }
  const waveCues = state.cues.map((c) => ({
    ...c,
    pending: pending(c),
    locked: state.locked.includes(c.key),
  }))
  return (
    <fieldset
      data-testid="cues-editor"
      data-maximized={maximized ? 'true' : 'false'}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 ${maximized ? 'flex flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
      {maximized && (
        <div
          data-testid="cues-header"
          className="flex items-center gap-4 border-b border-[var(--color-line)] pb-3"
        >
          {track?.cover ? (
            <img src={track.cover} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
          ) : (
            <div
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-md bg-[var(--color-panel-2)]"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-fg">
              {track?.title || cue.label}
            </div>
            <div className="truncate text-xs text-fg-dim">{track?.artist}</div>
          </div>
          <div className="ml-auto flex shrink-0 gap-4 font-mono text-[13px] tabular-nums text-fg-dim">
            <span data-testid="cues-position" className="text-fg">
              {cueClock(playheadMs)}
            </span>
            <span data-testid="cues-remaining">{`-${cueClock(read.durationMs - playheadMs)}`}</span>
            {track?.bpm && (
              <span data-testid="cues-bpm">{tr('editor.cues.bpm', { bpm: track.bpm })}</span>
            )}
            {track?.key && <span data-testid="cues-key">{track.key}</span>}
          </div>
        </div>
      )}
      <CueWave
        wave={read.wave}
        grid={read.grid}
        durationMs={read.durationMs}
        cues={waveCues}
        selected={state.selected}
        trimmed={state.trimmed}
        onMarkDrop={(ms) => dispatch({ type: 'mark-drop', ms })}
        onUnmarkDrop={(key) => dispatch({ type: 'unmark-drop', key })}
        onSelect={(key) => dispatch({ type: 'select', key })}
        onMove={(key, ms) => dispatch({ type: 'move', key, ms })}
        onMenu={setMenu}
        playheadMs={maximized ? playheadMs : undefined}
        onSeek={maximized ? seekTo : undefined}
      />
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
      {selected && (
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
            <>
              <CuePalette
                value={selected.color}
                onPick={(color) => dispatch({ type: 'recolour', key: selected.key, color })}
                label={(index) => tr('editor.cues.colour', { index })}
              />
              <select
                data-testid="cues-letter"
                aria-label={tr('editor.cues.letter')}
                value={selected.kind}
                onChange={(e) =>
                  dispatch({ type: 'reletter', key: selected.key, kind: Number(e.target.value) })
                }
                className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1"
              >
                {(letters.includes(selected.kind) ? letters : [selected.kind, ...letters]).map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {cueLetter(kind)}
                    </option>
                  ),
                )}
              </select>
            </>
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
          jumpBars={settings.cueJumpBars}
          onPad={pad}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onMemoryRemove={memoryRemove}
          onJumpBars={(bars) => onJumpBars?.(bars)}
        />
      )}
      <div data-testid="cues-actions" className="mt-3 flex flex-wrap items-center gap-3">
        <select
          data-testid="cues-flow"
          aria-label={tr('editor.cues.flow')}
          value={shownFlow}
          onChange={(e) => setChosen(e.target.value)}
          className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-1.5 text-xs"
        >
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {flowName(f, tr)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="cues-apply-flow"
          onClick={() => dispatch({ type: 'apply-flow', flowId: shownFlow })}
          className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)]"
        >
          {tr('editor.cues.applyFlow')}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="cues-undo"
            disabled={unchanged && queued === null}
            onClick={onDiscard}
            className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.discard')}
          </button>
          <button
            type="button"
            data-testid="cues-save"
            disabled={unchanged}
            onClick={() => {
              void window.api
                .saveRekordboxCues({
                  contentId: cue.contentId,
                  path: cue.path,
                  label: cue.label,
                  wanted,
                  fingerprint: read.fingerprint,
                })
                .then(refreshQueued)
            }}
            className="press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.save')}
          </button>
        </div>
      </div>
    </fieldset>
  )
}

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
  const { maximized: whole } = useMaximizedSection()
  const maximized = open && whole === 'cues'
  const [round, setRound] = useState(0)
  const draftKey = `${cue.contentId}|${read?.fingerprint ?? ''}|${JSON.stringify(queued)}`
  const [head, setHead] = useState(() => ({
    contentId: cue.contentId,
    ms: keptPlayhead(cue.contentId),
  }))
  const playheadMs = head.contentId === cue.contentId ? head.ms : 0
  const moveHead = (ms: number) => {
    setHead({ contentId: cue.contentId, ms })
    keepPlayhead(cue.contentId, ms)
  }
  return (
    <div data-testid="cues-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="cues"
        maximizable
        title={tr('editor.cues.title')}
        open={open}
        onToggle={onToggle}
        help={tr('editor.cues.help')}
      />
      <SectionBody open={open}>
        <div className="mt-3">
          {isError || read === null ? (
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
              onJumpBars={onJumpBars}
              onDiscard={() => {
                forgetDraft()
                setRound((n) => n + 1)
                if (queued !== null)
                  void window.api
                    .undoRekordboxCues(cue.contentId)
                    .then(() =>
                      queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] }),
                    )
              }}
            />
          )}
        </div>
      </SectionBody>
    </div>
  )
}
```

`src/renderer/src/components/Editor.tsx`:

- import `type CueJumpBars` from `'../../../shared/cueJump'`.
- `EditorProps`, after `rekordboxCue?: …`: `onCueJumpBars?: (bars: CueJumpBars) => void`; destructure `onCueJumpBars,` after `rekordboxCue,`.
- In `case 'cues':` the `<CuesSection` gains:

```tsx
                          track={{
                            title: item.meta.title || item.listLabel,
                            artist: item.meta.artist,
                            bpm: item.meta.bpm,
                            key: item.meta.key,
                            cover: item.coverUrl ?? item.embeddedCover,
                          }}
                          onJumpBars={onCueJumpBars}
```

`src/renderer/src/App.tsx`: import `type CueJumpBars` from `'../../shared/cueJump'`; after `onHideEditorHints`:

```tsx
  const onCueJumpBars = useStableCallback((cueJumpBars: CueJumpBars) =>
    saveSettings({ cueJumpBars }),
  )
```

and pass `onCueJumpBars={onCueJumpBars}` to `<Editor` after `rekordboxCue={rekordboxCue}`.

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-manual-t9.json` and merge it:

```json
{
  "es": { "editor": { "cues": { "bpm": "{{bpm}} BPM" } } },
  "en": { "editor": { "cues": { "bpm": "{{bpm}} BPM" } } },
  "de": { "editor": { "cues": { "bpm": "{{bpm}} BPM" } } },
  "fr": { "editor": { "cues": { "bpm": "{{bpm}} BPM" } } },
  "pt-BR": { "editor": { "cues": { "bpm": "{{bpm}} BPM" } } }
}
```

- [ ] **Step 4: Run tests, types, lint**

`CueWave.test.tsx`, `CuesSection.maximized.test.tsx`, `CuesSection.test.tsx`, `CuesSection.dedupe.test.tsx`, `Editor.test.tsx`, `CueFlowPreview.test.tsx`, `src/renderer/src/i18n/keys.test.ts`, `usedKeys.test.ts`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/components/CueWave.tsx apps/desktop/src/renderer/src/components/CueWave.test.tsx apps/desktop/src/renderer/src/hooks/useTrackCues.ts apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/components/Editor.test.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Maximize the Cues section into a full cue editor"
```

---

### Task 10: Keys and sound in the editor

**Files:**
- Create: `src/renderer/src/lib/cueKeys.ts`, `src/renderer/src/lib/cueKeys.test.ts`
- Modify: `src/renderer/src/components/CuesSection.tsx`, `src/renderer/src/i18n/locales/*.json`
- Test: `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `useCueAudition` (Task 6), `jumpBeats`, `zoomStep` (Task 3), `isTypingTarget`, `pressesOnSpace` (`lib/keymap.ts`), `claimKeys`, `runKeyClaim` (`lib/spaceClaim.ts`), `formatShortcut` (`lib/shortcuts.ts`), `isMacOS` (`lib/platform.ts`), `BEATS_PER_BAR`, `nearestBeat`, `HOT_KINDS`.
- Produces: `type CueKey = { type: 'play' } | { type: 'jump'; dir: 1 | -1 } | { type: 'beat'; dir: 1 | -1 } | { type: 'centre' } | { type: 'memory' } | { type: 'hot'; kind: number } | { type: 'remove' } | { type: 'undo' } | { type: 'zoom'; dir: 'in' | 'out' } | { type: 'swallow' }` and `cueKeyAction(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): CueKey | null`. `Editing` gains the prop `audition: CueAudition`. Test id `cues-legend`. i18n `editor.cues.keys.*`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/cueKeys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cueKeyAction } from './cueKeys'

const press = (key: string, mods: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
  cueKeyAction({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods })

describe('cueKeyAction', () => {
  it('maps the keys of the spec table', () => {
    expect(press(' ')).toEqual({ type: 'play' })
    expect(press('ArrowRight')).toEqual({ type: 'jump', dir: 1 })
    expect(press('ArrowLeft')).toEqual({ type: 'jump', dir: -1 })
    expect(press('ArrowRight', { shiftKey: true })).toEqual({ type: 'beat', dir: 1 })
    expect(press('ArrowLeft', { shiftKey: true })).toEqual({ type: 'beat', dir: -1 })
    expect(press('c')).toEqual({ type: 'centre' })
    expect(press('C', { shiftKey: true })).toEqual({ type: 'centre' })
    expect(press('m')).toEqual({ type: 'memory' })
    expect(press('Backspace')).toEqual({ type: 'remove' })
    expect(press('Delete')).toEqual({ type: 'remove' })
    expect(press('z', { metaKey: true })).toEqual({ type: 'undo' })
    expect(press('z', { ctrlKey: true })).toEqual({ type: 'undo' })
    expect(press('+')).toEqual({ type: 'zoom', dir: 'in' })
    expect(press('=')).toEqual({ type: 'zoom', dir: 'in' })
    expect(press('-')).toEqual({ type: 'zoom', dir: 'out' })
  })

  it('sends 1 to 8 to rekordbox letters A to H', () => {
    expect(['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => press(k))).toEqual(
      [1, 2, 3, 5, 6, 7, 8, 9].map((kind) => ({ type: 'hot', kind })),
    )
  })

  it('swallows every other bare letter or digit so nothing hidden acts under the editor', () => {
    for (const key of ['q', 'w', 'a', 'z', 's', '9', '0']) expect(press(key)).toEqual({ type: 'swallow' })
  })

  it('lets Escape, Tab, Enter and every command chord but undo through', () => {
    for (const key of ['Escape', 'Tab', 'Enter', 'ArrowUp']) expect(press(key)).toBeNull()
    expect(press('k', { metaKey: true })).toBeNull()
    expect(press(',', { metaKey: true })).toBeNull()
    expect(press('z', { metaKey: true, shiftKey: true })).toBeNull()
    expect(press('m', { altKey: true })).toBeNull()
  })
})
```

`src/renderer/src/components/CuesSection.maximized.test.tsx`: add `runKeyClaim` from `'../lib/spaceClaim'` to the imports and, at the end of the file:

```tsx
const play = vi.fn<() => Promise<void>>()
const pause = vi.fn<() => void>()
const audios: { onloadedmetadata: (() => void) | null; currentTime: number }[] = []

function stubSound() {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  vi.stubGlobal(
    'Audio',
    class {
      onloadedmetadata: (() => void) | null = null
      onended: (() => void) | null = null
      currentTime = 0
      play = play
      pause = pause
      constructor() {
        audios.push(this)
      }
    },
  )
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
}

const editor = () => screen.getByTestId('cues-editor')
const key = (k: string, mods: Record<string, boolean> = {}) =>
  fireEvent.keyDown(document.activeElement ?? editor(), { key: k, ...mods })

describe('CuesSection maximized keys', () => {
  it('takes the focus when maximized so the keys work at once', async () => {
    setup()
    await maximize()
    expect(document.activeElement).toBe(editor())
  })

  it('marks a track with the keyboard only', async () => {
    setup()
    await maximize()
    key('ArrowRight')
    expect(position()).toBe('0:32.0')
    key('m')
    expect(screen.getByTestId('cue-wave-call-32000')).toBeInTheDocument()
    key('ArrowRight')
    key('2')
    expect(screen.getByTestId('cue-wave-hot-B').style.left).toBe('16%')
    key('ArrowLeft', { shiftKey: true })
    expect(position()).toBe('1:03.5')
    key('ArrowRight', { shiftKey: true })
    key('ArrowLeft')
    key('2')
    expect(position()).toBe('1:04.0')
    key('Backspace')
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    key('z', { metaKey: true })
    expect(screen.getByTestId('cue-wave-hot-B')).toBeInTheDocument()
  })

  it('centres the playhead on the nearest beat with C', async () => {
    setup()
    await maximize()
    seek(64200)
    editor().focus()
    key('c')
    expect(position()).toBe('1:04.0')
  })

  it('jumps the bars set in Settings', async () => {
    setup({ cueJumpBars: 32 })
    await maximize()
    key('ArrowRight')
    expect(position()).toBe('1:04.0')
  })

  it('zooms the detail with + and −', async () => {
    setup()
    await maximize()
    key('+')
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(9)
    key('-')
    expect(screen.getAllByTestId('cue-detail-bar')).toHaveLength(17)
  })

  it('never acts while a field of the editor has the focus', async () => {
    setup()
    await maximize()
    const flow = screen.getByTestId('cues-flow')
    flow.focus()
    fireEvent.keyDown(flow, { key: 'm' })
    fireEvent.keyDown(flow, { key: 'ArrowRight' })
    expect(screen.queryByTestId('cue-wave-call-0')).toBeNull()
    expect(position()).toBe('0:00.0')
  })

  it('swallows other single keys so a hidden section never acts under the full editor', async () => {
    setup()
    await maximize()
    expect(fireEvent.keyDown(editor(), { key: 'q' })).toBe(false)
    expect(fireEvent.keyDown(editor(), { key: 'a' })).toBe(false)
    expect(fireEvent.keyDown(editor(), { key: 'Escape' })).toBe(true)
    expect(fireEvent.keyDown(editor(), { key: 'k', metaKey: true })).toBe(true)
  })

  it('keeps today’s keys only while folded', async () => {
    setup()
    await ready()
    expect(fireEvent.keyDown(editor(), { key: 'm' })).toBe(true)
    expect(screen.queryByTestId('cue-wave-call-0')).toBeNull()
  })

  it('Space plays the track from the playhead and never reaches the floating player', async () => {
    stubSound()
    const shared = document.body.appendChild(document.createElement('audio'))
    const pauseShared = vi.fn()
    shared.pause = pauseShared
    setup()
    await maximize()
    seek(64000)
    editor().focus()
    expect(key(' ')).toBe(false)
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    expect(audios[0].currentTime).toBe(64)
    expect(play).toHaveBeenCalled()
    expect(pauseShared).toHaveBeenCalled()
    key(' ')
    expect(pause).toHaveBeenCalled()
    shared.remove()
  })

  it('answers the global Space while maximized even with the focus elsewhere', async () => {
    stubSound()
    setup()
    await maximize()
    let handled = false
    act(() => {
      handled = runKeyClaim('play')
    })
    expect(handled).toBe(true)
    expect(audios).toHaveLength(1)
  })

  it('stops the sound when the section is restored to its place', async () => {
    stubSound()
    setup()
    await maximize()
    key(' ')
    await act(async () => {
      audios[0].onloadedmetadata?.()
    })
    fireEvent.click(screen.getByTestId('section-maximize'))
    expect(pause).toHaveBeenCalled()
    expect(runKeyClaim('play')).toBe(false)
  })

  it('lists the keys with the jump in use', async () => {
    setup()
    await maximize()
    expect(screen.getByTestId('cues-legend')).toHaveTextContent('jump 16 bars')
    expect(screen.getByTestId('cues-legend')).toHaveTextContent('⌘Z')
  })
})
```

(`act` joins the `@testing-library/react` import.)

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueKeys.test.ts src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL, `./cueKeys` cannot be resolved; the focus, keyboard, Space and legend tests fail.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/cueKeys.ts`:

```ts
import { HOT_KINDS } from '../../../shared/cueRules'

export type CueKey =
  | { type: 'play' }
  | { type: 'jump'; dir: 1 | -1 }
  | { type: 'beat'; dir: 1 | -1 }
  | { type: 'centre' }
  | { type: 'memory' }
  | { type: 'hot'; kind: number }
  | { type: 'remove' }
  | { type: 'undo' }
  | { type: 'zoom'; dir: 'in' | 'out' }
  | { type: 'swallow' }

export function cueKeyAction(e: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}): CueKey | null {
  if (e.metaKey || e.ctrlKey)
    return !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' ? { type: 'undo' } : null
  if (e.altKey) return null
  if (e.key === ' ') return { type: 'play' }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowRight' ? 1 : -1
    return e.shiftKey ? { type: 'beat', dir } : { type: 'jump', dir }
  }
  if (e.key === 'Backspace' || e.key === 'Delete') return { type: 'remove' }
  if (e.key === '+' || e.key === '=') return { type: 'zoom', dir: 'in' }
  if (e.key === '-') return { type: 'zoom', dir: 'out' }
  const lower = e.key.toLowerCase()
  if (lower === 'c') return { type: 'centre' }
  if (lower === 'm') return { type: 'memory' }
  if (/^[1-8]$/.test(e.key)) return { type: 'hot', kind: HOT_KINDS[Number(e.key) - 1] }
  if (/^[a-z0-9]$/.test(lower)) return { type: 'swallow' }
  return null
}
```

`src/renderer/src/components/CuesSection.tsx` (edits on the Task 9 file):

1. Imports. Replace `import { MAX_HOT_CUES } from '../../../shared/cueRules'` with `import { BEATS_PER_BAR, MAX_HOT_CUES, nearestBeat } from '../../../shared/cueRules'`. Before `import { useMaximizedSection } from '../hooks/useEditorSections'` add `import { type CueAudition, useCueAudition } from '../hooks/useCueAudition'`. Replace `import { adjacentCall, callAt, cueClock, DEFAULT_ZOOM_BARS, zoomStep } from '../lib/cuePlayhead'` with:

```ts
import { type CueKey, cueKeyAction } from '../lib/cueKeys'
import {
  adjacentCall,
  callAt,
  cueClock,
  DEFAULT_ZOOM_BARS,
  jumpBeats,
  zoomStep,
} from '../lib/cuePlayhead'
```

Before `import { cueLetter } from '../lib/rowCues'` add `import { isTypingTarget, pressesOnSpace } from '../lib/keymap'` and `import { isMacOS } from '../lib/platform'`. After `import { useAppSettings } from '../lib/settingsContext'` add `import { formatShortcut } from '../lib/shortcuts'` and `import { claimKeys } from '../lib/spaceClaim'`.

2. Before `function Editing({`, add the legend:

```tsx
function CueKeys({ jumpBars }: { jumpBars: number }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const mac = isMacOS()
  const shift = formatShortcut(['shift'], mac)
  const keys: [string, string][] = [
    [tr('editor.cues.keys.space'), tr('editor.cues.keys.play')],
    ['← →', tr('editor.cues.keys.jump', { count: jumpBars })],
    [`${shift}← ${shift}→`, tr('editor.cues.keys.beat')],
    ['C', tr('editor.cues.keys.centre')],
    ['M', tr('editor.cues.keys.memory')],
    ['1…8', tr('editor.cues.keys.hot')],
    [formatShortcut(['backspace'], mac), tr('editor.cues.keys.remove')],
    [formatShortcut(['mod', 'z'], mac), tr('editor.cues.keys.undo')],
    ['+ −', tr('editor.cues.keys.zoom')],
  ]
  return (
    <ul
      data-testid="cues-legend"
      aria-label={tr('editor.cues.keys.label')}
      className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-3 text-xs text-fg-dim"
    >
      {keys.map(([chord, what]) => (
        <li key={chord} className="flex items-center gap-1.5">
          <kbd className="rounded border border-b-2 border-[var(--color-line-strong)] px-1.5 font-mono text-[11px] text-fg">
            {chord}
          </kbd>
          {what}
        </li>
      ))}
    </ul>
  )
}
```

3. `Editing`: destructure `audition,` after `onPlayhead,` and type `audition: CueAudition` after `onPlayhead: (ms: number) => void`.

4. Replace the `onKey` block of `Editing`:

```tsx
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch({ type: 'remove', key: selected.key })
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      dispatch({ type: 'undo' })
    }
  }
```

with:

```tsx
  const run = (key: CueKey) => {
    if (key.type === 'play') audition.toggle(playheadMs)
    else if (key.type === 'jump')
      seekTo(jumpBeats(ctx.beats, playheadMs, key.dir * settings.cueJumpBars * BEATS_PER_BAR))
    else if (key.type === 'beat') seekTo(jumpBeats(ctx.beats, playheadMs, key.dir))
    else if (key.type === 'centre') seekTo(ctx.beats[nearestBeat(ctx.beats, playheadMs)])
    else if (key.type === 'memory') dispatch({ type: 'add-call', ms: playheadMs })
    else if (key.type === 'hot') pad(key.kind)
    else if (key.type === 'remove' && selected) dispatch({ type: 'remove', key: selected.key })
    else if (key.type === 'undo') dispatch({ type: 'undo' })
    else if (key.type === 'zoom') setZoom((z) => zoomStep(z, key.dir))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (maximized) {
      const target = e.target as HTMLElement
      if (isTypingTarget(target) || (e.key === ' ' && pressesOnSpace(target))) return
      const key = cueKeyAction(e)
      if (!key) return
      e.preventDefault()
      run(key)
      return
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch({ type: 'remove', key: selected.key })
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      dispatch({ type: 'undo' })
    }
  }
  const editorRef = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    if (maximized) editorRef.current?.focus()
  }, [maximized])
```

5. The `<fieldset` opening tag becomes:

```tsx
    <fieldset
      ref={editorRef}
      data-testid="cues-editor"
      data-maximized={maximized ? 'true' : 'false'}
      tabIndex={maximized ? -1 : undefined}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 outline-none ${maximized ? 'flex flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
```

6. Before the closing `</fieldset>`, after the `cues-actions` block, add `{maximized && <CueKeys jumpBars={settings.cueJumpBars} />}`.

7. In `CuesSection`, replace

```tsx
  const moveHead = (ms: number) => {
    setHead({ contentId: cue.contentId, ms })
    keepPlayhead(cue.contentId, ms)
  }
```

with:

```tsx
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
    return claimKeys({ play: () => toggle.current() })
  }, [maximized])
```

and pass `audition={audition}` to `<Editing` after `onPlayhead={moveHead}`.

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-manual-t10.json` and merge it:

```json
{
  "es": { "editor": { "cues": { "keys": { "label": "Teclas", "space": "Espacio", "play": "reproducir o parar", "jump_one": "saltar {{count}} compás", "jump_other": "saltar {{count}} compases", "beat": "un golpe", "centre": "centrar en la rejilla", "memory": "CALL en el cabezal", "hot": "hot cue A a H en el cabezal", "remove": "borrar la seleccionada", "undo": "deshacer", "zoom": "zoom" } } } },
  "en": { "editor": { "cues": { "keys": { "label": "Keys", "space": "Space", "play": "play or stop", "jump_one": "jump {{count}} bar", "jump_other": "jump {{count}} bars", "beat": "one beat", "centre": "centre on the grid", "memory": "CALL at the playhead", "hot": "hot cue A to H at the playhead", "remove": "delete the selected one", "undo": "undo", "zoom": "zoom" } } } },
  "de": { "editor": { "cues": { "keys": { "label": "Tasten", "space": "Leertaste", "play": "abspielen oder stoppen", "jump_one": "{{count}} Takt springen", "jump_other": "{{count}} Takte springen", "beat": "ein Schlag", "centre": "auf das Raster zentrieren", "memory": "CALL am Abspielkopf", "hot": "Hot Cue A bis H am Abspielkopf", "remove": "die ausgewählte löschen", "undo": "rückgängig", "zoom": "Zoom" } } } },
  "fr": { "editor": { "cues": { "keys": { "label": "Touches", "space": "Espace", "play": "lire ou arrêter", "jump_one": "sauter {{count}} mesure", "jump_other": "sauter {{count}} mesures", "beat": "un temps", "centre": "centrer sur la grille", "memory": "CALL sur la tête de lecture", "hot": "hot cue A à H sur la tête de lecture", "remove": "supprimer la sélection", "undo": "annuler", "zoom": "zoom" } } } },
  "pt-BR": { "editor": { "cues": { "keys": { "label": "Teclas", "space": "Espaço", "play": "tocar ou parar", "jump_one": "saltar {{count}} compasso", "jump_other": "saltar {{count}} compassos", "beat": "um tempo", "centre": "centralizar na grade", "memory": "CALL no cursor", "hot": "hot cue A a H no cursor", "remove": "apagar a selecionada", "undo": "desfazer", "zoom": "zoom" } } } }
}
```

- [ ] **Step 4: Run tests, types, lint**

`cueKeys.test.ts`, `CuesSection.maximized.test.tsx`, `CuesSection.test.tsx` (the folded ⌫ and ⌘Z tests must still pass), `CuesSection.dedupe.test.tsx`, `src/renderer/src/hooks/useKeyboardShortcuts.test.tsx`, `src/renderer/src/lib/spaceClaim.test.ts` (if present), `i18n/keys.test.ts`, `i18n/usedKeys.test.ts`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueKeys.ts apps/desktop/src/renderer/src/lib/cueKeys.test.ts apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Mark cues with the keyboard and hear the track in the full cue editor"
```

---

### Task 11: "Restablecer" and the pad colours

**Files:**
- Modify: `src/renderer/src/components/CuePalette.tsx`, `src/renderer/src/components/CueDeck.tsx` (whole file below), `src/renderer/src/components/CuesSection.tsx`, `src/renderer/src/i18n/locales/*.json`
- Test: `src/renderer/src/components/CuePalette.test.tsx`, `src/renderer/src/components/CueDeck.test.tsx`, `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `HOT_CUE_DEFAULT_INDEX`, `CuePalette`, the `recolour` draft action.
- Produces: `cue-palette-reset` in every `CuePalette` (calls `onPick(HOT_CUE_DEFAULT_INDEX)`); `CueDeck` props `locked: string[]` and `onRecolour: (key: string, color: number) => void`; right-click on a pad with a hot cue that is not a loop opens `cues-pad-colours` with the picker. i18n `editor.cues.resetColour`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/CuePalette.test.tsx`: in the first test replace `expect(screen.getAllByRole('button')).toHaveLength(16)` with `expect(screen.getAllByTestId(/^cue-palette-\d+$/)).toHaveLength(16)`, add `import '../i18n'`, and add:

```tsx
  it('puts the default rekordbox colour back with Restablecer, as rekordbox picker does', () => {
    const onPick = vi.fn()
    render(<CuePalette value={42} onPick={onPick} label={(i) => `Color ${i}`} />)
    fireEvent.click(screen.getByTestId('cue-palette-reset'))
    expect(onPick).toHaveBeenCalledWith(22)
    expect(screen.getByTestId('cue-palette-reset')).toHaveTextContent('Reset')
  })
```

`src/renderer/src/components/CueDeck.test.tsx`: `setup` gains `onRecolour: vi.fn<(key: string, color: number) => void>()` in `handlers` and `locked={[]}` in the element; add:

```tsx
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
```

`src/renderer/src/components/CuesSection.maximized.test.tsx`, in `describe('CuesSection maximized', …)`:

```tsx
  it('recolours a placed hot cue from its pad and puts the default colour back', async () => {
    setup()
    await maximize()
    seek(64000)
    fireEvent.click(screen.getByTestId('cues-pad-A'))
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.click(within(screen.getByTestId('cues-pad-colours')).getByTestId('cue-palette-42'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#e62828' })
    fireEvent.contextMenu(screen.getByTestId('cues-pad-A'))
    fireEvent.click(within(screen.getByTestId('cues-pad-colours')).getByTestId('cue-palette-reset'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#28e214' })
  })
```

(`within` joins the `@testing-library/react` import. The placed cue is selected, so the selection panel shows a second picker: every palette click in this test is scoped to `cues-pad-colours`.)

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuePalette.test.tsx src/renderer/src/components/CueDeck.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL, no `cue-palette-reset`, no `cues-pad-colours`.

- [ ] **Step 3: Implement**

`src/renderer/src/components/CuePalette.tsx`:

```tsx
import { Check } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOT_CUE_DEFAULT_INDEX,
  HOT_CUE_PICKER,
  hotCueColor,
} from '../../../shared/rekordboxCueColors'

export function CuePalette({
  value,
  onPick,
  label,
}: {
  value: number | null
  onPick: (index: number) => void
  label: (index: number) => string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex w-max shrink-0 flex-col gap-1.5">
      <div data-testid="cue-palette" className="grid w-max shrink-0 grid-cols-4 gap-1.5">
        {HOT_CUE_PICKER.map((index) => (
          <button
            key={index}
            type="button"
            data-testid={`cue-palette-${index}`}
            aria-label={label(index)}
            aria-pressed={value === index}
            onClick={() => onPick(index)}
            style={{ backgroundColor: hotCueColor(index) }}
            className={`press flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] ${
              value === index
                ? 'ring-2 ring-[var(--color-fg)] ring-offset-1 ring-offset-[var(--color-panel)]'
                : ''
            }`}
          >
            {value === index && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="cue-palette-reset"
        onClick={() => onPick(HOT_CUE_DEFAULT_INDEX)}
        className="press rounded-md px-2 py-0.5 text-xs text-fg-dim hover:text-fg"
      >
        {tr('editor.cues.resetColour')}
      </button>
    </div>
  )
}
```

`src/renderer/src/components/CueDeck.tsx`, the whole file:

```tsx
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CUE_JUMP_BARS, type CueJumpBars } from '../../../shared/cueJump'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { cueLetter } from '../lib/rowCues'
import { CuePalette } from './CuePalette'

export interface DeckCue {
  key: string
  kind: number
  color: number | null
}

const BUTTON =
  'press inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--color-hover)]'
const GHOST =
  'press inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'
const STEP = 'press px-2 py-1 hover:bg-[var(--color-hover)] disabled:opacity-40'

export function CueDeck({
  cues,
  selected,
  locked,
  jumpBars,
  onPad,
  onRecolour,
  onMemory,
  onMemoryStep,
  onMemoryRemove,
  onJumpBars,
}: {
  cues: DeckCue[]
  selected: string | null
  locked: string[]
  jumpBars: CueJumpBars
  onPad: (kind: number) => void
  onRecolour: (key: string, color: number) => void
  onMemory: () => void
  onMemoryStep: (dir: 1 | -1) => void
  onMemoryRemove: () => void
  onJumpBars: (bars: CueJumpBars) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const at = CUE_JUMP_BARS.indexOf(jumpBars)
  const [colouring, setColouring] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (colouring === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColouring(null)
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
  }, [colouring])
  return (
    <div data-testid="cues-deck" className="flex flex-wrap items-center gap-x-5 gap-y-3 pb-4">
      <div className="flex items-center gap-1.5">
        {HOT_KINDS.map((kind, i) => {
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
                style={cue ? { backgroundColor: hotCueColor(cue.color) } : undefined}
                className={`press relative flex h-8 w-9 items-center justify-center rounded-[5px] text-sm font-bold ${
                  cue
                    ? 'text-white'
                    : 'border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg-faint'
                } ${isSelected ? 'outline outline-2 outline-offset-2 outline-[var(--color-fg)]' : ''}`}
              >
                {letter}
                <span
                  aria-hidden="true"
                  className="absolute -bottom-4 font-mono text-[10px] font-normal text-fg-faint"
                >
                  {i + 1}
                </span>
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
                    }}
                    label={(index) => tr('editor.cues.colour', { index })}
                  />
                </div>
              )}
            </span>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" data-testid="cues-memory" onClick={onMemory} className={BUTTON}>
          {tr('editor.cues.memory')}
          <kbd className="font-mono text-[11px] font-normal text-fg-faint">M</kbd>
        </button>
        <button
          type="button"
          data-testid="cues-memory-prev"
          aria-label={tr('editor.cues.memoryPrev')}
          onClick={() => onMemoryStep(-1)}
          className={GHOST}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-next"
          aria-label={tr('editor.cues.memoryNext')}
          onClick={() => onMemoryStep(1)}
          className={GHOST}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-remove"
          aria-label={tr('editor.cues.memoryRemove')}
          onClick={onMemoryRemove}
          className={GHOST}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-dim">{tr('editor.cues.jump')}</span>
        <div className="flex items-center overflow-hidden rounded-md border border-[var(--color-line-strong)]">
          <button
            type="button"
            data-testid="cues-jump-less"
            aria-label={tr('editor.cues.jumpLess')}
            disabled={at <= 0}
            onClick={() => onJumpBars(CUE_JUMP_BARS[at - 1])}
            className={STEP}
          >
            ‹
          </button>
          <span
            data-testid="cues-jump-value"
            className="min-w-24 border-x border-[var(--color-line-strong)] px-2 py-1 text-center font-mono"
          >
            {tr('editor.cues.jumpBars', { count: jumpBars })}
          </span>
          <button
            type="button"
            data-testid="cues-jump-more"
            aria-label={tr('editor.cues.jumpMore')}
            disabled={at >= CUE_JUMP_BARS.length - 1}
            onClick={() => onJumpBars(CUE_JUMP_BARS[at + 1])}
            className={STEP}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/CuesSection.tsx`: the `<CueDeck` element gains `locked={state.locked}` after `selected={state.selected}` and `onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}` after `onPad={pad}`.

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-manual-t11.json` and merge it:

```json
{
  "es": { "editor": { "cues": { "resetColour": "Restablecer" } } },
  "en": { "editor": { "cues": { "resetColour": "Reset" } } },
  "de": { "editor": { "cues": { "resetColour": "Zurücksetzen" } } },
  "fr": { "editor": { "cues": { "resetColour": "Réinitialiser" } } },
  "pt-BR": { "editor": { "cues": { "resetColour": "Redefinir" } } }
}
```

- [ ] **Step 4: Run tests, types, lint**

`CuePalette.test.tsx`, `CueDeck.test.tsx`, `CuesSection.maximized.test.tsx`, `CuesSection.test.tsx` (its recolour test still clicks `cue-palette-5`), `settings/CuesTab.test.tsx` (the rule popover still shows `cue-palette`), `i18n/keys.test.ts`, `i18n/usedKeys.test.ts`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CuePalette.tsx apps/desktop/src/renderer/src/components/CuePalette.test.tsx apps/desktop/src/renderer/src/components/CueDeck.tsx apps/desktop/src/renderer/src/components/CueDeck.test.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Reset a cue colour like rekordbox and recolour a pad with a right click"
```

---

### Task 12: Settings › Cues, reorganized

**Files:**
- Modify: `src/renderer/src/components/CueRuleRow.tsx` (whole file below), `src/renderer/src/components/settings/CuesTab.tsx` (the returned JSX below), `src/renderer/src/i18n/locales/*.json`
- Test: `src/renderer/src/components/settings/CuesTab.test.tsx`

**Interfaces:**
- Consumes: `CUE_JUMP_BARS` (Task 1), `SyncedDraft.cueJumpBars`, `CuePalette` with reset (Task 11), everything `CuesTab` uses today.
- Produces: rule tokens `cue-rule-<i>-<block>` (block in `from`, `direction`, `bars`, `repeat`, `when`, `place`, `color-mode`), each opening `cue-rule-<i>-<block>-menu` with `cue-rule-<i>-<block>-option-<value>` items; colour swatches `cue-rule-<i>-color-<slot>` (as today); flow tabs `cue-flow-<id>` with the name input `cue-flow-name` inside the current one and `cue-flow-in-use` inside the one in use; `cue-flow-use`, `cue-flow-restore`, `cue-flow-delete`, `cue-rule-add`, `cue-flow-new`, `cue-learn` keep their ids; the card `cue-manual` with `cue-jump-<8|16|32|64>`. i18n `settings.cueFlows.sentence.every`, `settings.cueFlows.sentence.put`, `settings.cueFlows.manual.title`, `settings.cueFlows.manual.jump`, `settings.cueFlows.manual.unit`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/settings/CuesTab.test.tsx`:

- Import `type CueJumpBars` from `'../../../../shared/cueJump'`. `last` becomes `Pick<SyncedDraft, 'cueFlows' | 'activeCueFlow' | 'cueJumpBars'> | null` and the Harness state `{ cueFlows: BUNDLED_FLOWS, activeCueFlow: active, cueJumpBars: 16 as CueJumpBars }`.
- Replace the test "lists the bundled flows by their translated names with Mi flujo in use" with:

```tsx
  it('shows the flows as tabs, the one in use marked and the current one named in place', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(screen.getByTestId('cue-flow-mine')).toHaveTextContent('En uso')
    expect(
      within(screen.getByTestId('cue-flow-mine')).getByTestId('cue-flow-name'),
    ).toHaveAttribute('placeholder', 'Mi flujo')
    expect(screen.getByTestId('cue-flow-one-at-32')).toHaveTextContent('Una cue a 32')
    expect(screen.getByTestId('cue-flow-calls-only')).toHaveTextContent('Solo CALL')
  })
```

- In "recalculates the preview live when a block changes" replace the `fireEvent.change(…'cue-rule-0-repeat'…)` line with:

```tsx
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat'))
    fireEvent.click(screen.getByTestId('cue-rule-0-repeat-option-1'))
```

and add at the end `expect(screen.queryByTestId('cue-rule-0-repeat-menu')).toBeNull()`.
- In "warns that a loose CALL from a rule reads as a drop next time" replace the `fireEvent.change` line with clicks on `cue-rule-0-place` then `cue-rule-0-place-option-call`.
- In "never offers to delete Mi flujo but restores it to rules.py" replace the `fireEvent.change` line with clicks on `cue-rule-0-bars` then `cue-rule-0-bars-option-8`.
- Add:

```tsx
  it('reads each rule as one sentence, the way the DJ would say it', async () => {
    await i18n.changeLanguage('es')
    afterTest = () => i18n.changeLanguage('en')
    render(<Harness />)
    expect(screen.getByTestId('cue-rule-0')).toHaveTextContent(
      'Desde donde rompe, hacia atrás, cada 16 compases, 3 veces, si cabe, pon hot cue + CALL',
    )
    expect(screen.getByTestId('cue-rule-1')).toHaveTextContent(
      'Desde el primer golpe, en el mismo golpe, si no hay otra antes de donde rompe, pon hot cue + CALL',
    )
  })

  it('opens one block list at a time and closes it with Escape or a click elsewhere', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-0-when'))
    expect(screen.getByTestId('cue-rule-0-when-option-always')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('cue-rule-0-when-option-fits')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('cue-rule-0-bars'))
    expect(screen.queryByTestId('cue-rule-0-when-menu')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('cue-rule-0-bars-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('cue-rule-0-bars-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-rule-0-from'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('cue-rule-0-from-menu')).toBeNull()
  })

  it('puts the preview first and the rules under it', () => {
    render(<Harness />)
    const preview = screen.getByTestId('cue-flow-preview')
    expect(
      preview.compareDocumentPosition(screen.getByTestId('cue-rule-0')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('opens rekordbox picker with Restablecer from a rule colour', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-rule-0-color-0'))
    fireEvent.click(screen.getByTestId('cue-palette-reset'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.rules[0].color).toEqual({ each: [22, 22, 42] })
    expect(screen.queryByTestId('cue-palette')).toBeNull()
  })

  it('sets the arrow jump of the manual editor in its own card', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-jump-16')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-jump-32'))
    expect(last?.cueJumpBars).toBe(32)
    expect(screen.getByTestId('cue-jump-32')).toHaveAttribute('aria-pressed', 'true')
  })
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/settings/CuesTab.test.tsx`
Expected: FAIL, the tokens are still selects (no `-option-` ids), no `cue-manual`, the name input sits outside the tab.

- [ ] **Step 3: Implement**

`src/renderer/src/components/CueRuleRow.tsx`, the whole file:

```tsx
import { X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CueRule,
  FLOW_CONDITIONS,
  FLOW_ORIGINS,
  FLOW_PLACES,
  type FlowColor,
  type FlowDirection,
  type FlowRepeat,
  MAX_RULE_REPEAT,
  RULE_BARS,
} from '../../../shared/cueFlows'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { CuePalette } from './CuePalette'

const REPEATS = [1, 2, 3, 4, 5, 6, 7, 8]
const DIRECTIONS: FlowDirection[] = ['back', 'forward']
const COLOR_MODES = ['fixed', 'each'] as const

type Block = 'from' | 'direction' | 'bars' | 'repeat' | 'when' | 'place' | 'color-mode'

const BLOCK_LABEL: Record<Block, string> = {
  from: 'from',
  direction: 'direction',
  bars: 'bars',
  repeat: 'repeat',
  when: 'when',
  place: 'place',
  'color-mode': 'colorMode',
}

const TOKEN_CLASS =
  'press rounded-sm border-b border-dashed border-[var(--color-accent)] px-0.5 text-fg hover:bg-[var(--color-hover)]'
const MENU_CLASS =
  'absolute left-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs leading-normal shadow-[var(--shadow-float)]'
const ITEM_CLASS =
  'block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-[var(--color-hover)] aria-checked:font-semibold aria-checked:text-fg'

function slotCount(rule: CueRule): number {
  if ('fixed' in rule.color) return 1
  return rule.repeat === 'edge' ? 3 : Math.min(rule.repeat, MAX_RULE_REPEAT, 8)
}

function colorAt(color: FlowColor, slot: number): number {
  if ('fixed' in color) return color.fixed
  return color.each[slot] ?? color.each[color.each.length - 1] ?? 1
}

export function CueRuleRow({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: CueRule
  index: number
  onChange: (rule: CueRule) => void
  onRemove: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const id = `cue-rule-${index}`
  const slots = slotCount(rule)
  const slotNumbers = Array.from({ length: slots }, (_, i) => i)
  useEffect(() => {
    if (open === null) return
    const onDown = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pickColor = (slot: number, color: number) => {
    if ('fixed' in rule.color) {
      onChange({ ...rule, color: { fixed: color } })
    } else {
      const each = Array.from({ length: slots }, (_, i) => colorAt(rule.color, i))
      each[slot] = color
      onChange({ ...rule, color: { each } })
    }
    setOpen(null)
  }

  const setColorMode = (mode: (typeof COLOR_MODES)[number]) => {
    if (mode === 'each') {
      const first = colorAt(rule.color, 0)
      onChange({ ...rule, color: { each: Array.from({ length: 3 }, () => first) } })
    } else {
      onChange({ ...rule, color: { fixed: colorAt(rule.color, 0) } })
    }
  }

  const barsLabel = (bars: number): string =>
    bars === 0 ? tr('settings.cueFlows.barsZero') : tr('settings.cueFlows.bars', { count: bars })
  const repeatLabel = (repeat: FlowRepeat): string =>
    repeat === 'edge'
      ? tr('settings.cueFlows.repeatEdge')
      : tr('settings.cueFlows.repeat', { count: repeat })

  const token = <T extends string | number>(
    block: Block,
    options: { value: T; label: string }[],
    current: T,
    label: string,
    pick: (value: T) => void,
  ): React.JSX.Element => (
    <span className="relative">
      <button
        type="button"
        data-testid={`${id}-${block}`}
        aria-label={tr(`settings.cueFlows.block.${BLOCK_LABEL[block]}`)}
        aria-haspopup="menu"
        aria-expanded={open === block}
        onClick={() => setOpen(open === block ? null : block)}
        className={TOKEN_CLASS}
      >
        {label}
      </button>
      {open === block && (
        <div role="menu" data-testid={`${id}-${block}-menu`} className={MENU_CLASS}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current}
              data-testid={`${id}-${block}-option-${o.value}`}
              onClick={() => {
                pick(o.value)
                setOpen(null)
              }}
              className={ITEM_CLASS}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )

  return (
    <div
      ref={rowRef}
      data-testid={id}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || open === null) return
        e.stopPropagation()
        setOpen(null)
      }}
      className="relative rounded-md border border-[var(--color-line)] py-2 pl-3 pr-8 text-sm leading-8"
    >
      <span aria-hidden="true" className="mr-2 font-mono text-xs text-fg-faint">
        {index + 1}
      </span>
      {token(
        'from',
        FLOW_ORIGINS.map((o) => ({ value: o, label: tr(`settings.cueFlows.from.${o}`) })),
        rule.from,
        tr(`settings.cueFlows.from.${rule.from}`),
        (from) => onChange({ ...rule, from }),
      )}
      {rule.bars > 0 && (
        <>
          {', '}
          {token(
            'direction',
            DIRECTIONS.map((d) => ({ value: d, label: tr(`settings.cueFlows.direction.${d}`) })),
            rule.direction,
            tr(`settings.cueFlows.direction.${rule.direction}`),
            (direction) => onChange({ ...rule, direction }),
          )}
        </>
      )}
      {', '}
      {rule.bars > 0 && `${tr('settings.cueFlows.sentence.every')} `}
      {token(
        'bars',
        RULE_BARS.map((b) => ({ value: b, label: barsLabel(b) })),
        rule.bars,
        barsLabel(rule.bars),
        (bars) => onChange(bars === 0 ? { ...rule, bars, repeat: 1 } : { ...rule, bars }),
      )}
      {rule.bars > 0 && (
        <>
          {', '}
          {token<FlowRepeat>(
            'repeat',
            [...REPEATS, 'edge' as const].map((r) => ({ value: r, label: repeatLabel(r) })),
            rule.repeat,
            repeatLabel(rule.repeat),
            (repeat) => onChange({ ...rule, repeat }),
          )}
        </>
      )}
      {', '}
      {token(
        'when',
        FLOW_CONDITIONS.map((w) => ({ value: w, label: tr(`settings.cueFlows.when.${w}`) })),
        rule.when,
        tr(`settings.cueFlows.when.${rule.when}`),
        (when) => onChange({ ...rule, when }),
      )}
      {`, ${tr('settings.cueFlows.sentence.put')} `}
      {token(
        'place',
        FLOW_PLACES.map((p) => ({ value: p, label: tr(`settings.cueFlows.place.${p}`) })),
        rule.place,
        tr(`settings.cueFlows.place.${rule.place}`),
        (place) => onChange({ ...rule, place }),
      )}
      {rule.place !== 'call' && (
        <>
          {' '}
          {token(
            'color-mode',
            COLOR_MODES.map((m) => ({ value: m, label: tr(`settings.cueFlows.colorMode.${m}`) })),
            'fixed' in rule.color ? 'fixed' : 'each',
            tr(`settings.cueFlows.colorMode.${'fixed' in rule.color ? 'fixed' : 'each'}`),
            setColorMode,
          )}{' '}
          <span className="inline-flex items-center gap-1 align-middle">
            {slotNumbers.map((slot) => (
              <span key={slot} className="relative">
                <button
                  type="button"
                  data-testid={`${id}-color-${slot}`}
                  aria-label={tr('settings.cueFlows.block.color', { n: slot + 1 })}
                  aria-expanded={open === `color-${slot}`}
                  onClick={() => setOpen(open === `color-${slot}` ? null : `color-${slot}`)}
                  style={{ backgroundColor: hotCueColor(colorAt(rule.color, slot)) }}
                  className="press block h-[18px] w-[18px] rounded-[3px] border border-[var(--color-line)]"
                />
                {open === `color-${slot}` && (
                  <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]">
                    <CuePalette
                      value={colorAt(rule.color, slot)}
                      onPick={(color) => pickColor(slot, color)}
                      label={(i) => tr('editor.cues.colour', { index: i })}
                    />
                  </div>
                )}
              </span>
            ))}
          </span>
        </>
      )}
      <button
        type="button"
        data-testid={`${id}-remove`}
        aria-label={tr('settings.cueFlows.removeRule')}
        onClick={onRemove}
        className="press absolute right-1 top-1.5 rounded-md p-1 text-fg-dim hover:text-fg"
      >
        <X size={14} />
      </button>
      {rule.place === 'call' && (
        <p data-testid={`${id}-loose-call`} className="text-[11px] leading-normal text-fg-dim">
          {tr('settings.cueFlows.looseCall')}
        </p>
      )}
    </div>
  )
}
```

`src/renderer/src/components/settings/CuesTab.tsx`: import `CUE_JUMP_BARS` from `'../../../../shared/cueJump'` and replace the whole returned JSX (from `return (` to the end of the function) with:

```tsx
  const inUse = activeCueFlow(synced).id
  return (
    <div className="flex flex-col gap-5">
      <div
        data-testid="cue-flows"
        role="group"
        aria-label={tr('settings.cueFlows.flows')}
        className="flex flex-wrap items-center gap-2"
      >
        {flows.map((f) =>
          f.id === flow.id && typeof learning !== 'object' ? (
            <span
              key={f.id}
              data-testid={`cue-flow-${f.id}`}
              aria-current="true"
              className="inline-flex items-center rounded-full border border-[var(--color-accent)] bg-[var(--color-field)] px-3 py-1 text-sm text-fg"
            >
              <input
                data-testid="cue-flow-name"
                aria-label={tr('settings.cueFlows.name')}
                value={flow.name}
                placeholder={flowName(flow, tr)}
                size={Math.max(4, (flow.name || flowName(flow, tr)).length)}
                onChange={(e) => put({ ...flow, name: e.target.value })}
                className="min-w-0 bg-transparent outline-none placeholder:text-fg"
              />
              {inUse === f.id && (
                <span data-testid="cue-flow-in-use" className="text-fg-dim">
                  {` · ${tr('settings.cueFlows.inUse')}`}
                </span>
              )}
            </span>
          ) : (
            <button
              key={f.id}
              type="button"
              data-testid={`cue-flow-${f.id}`}
              aria-pressed={false}
              onClick={() => select(f.id)}
              className="press rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-sm text-fg-dim hover:text-fg"
            >
              {flowName(f, tr)}
              {inUse === f.id && (
                <span data-testid="cue-flow-in-use">{` · ${tr('settings.cueFlows.inUse')}`}</span>
              )}
            </button>
          ),
        )}
        <button
          type="button"
          data-testid="cue-flow-new"
          onClick={create}
          className="press rounded-full border border-dashed border-[var(--color-line-strong)] px-3 py-1 text-sm text-fg-dim hover:text-fg"
        >
          {`+ ${tr('settings.cueFlows.newFlow')}`}
        </button>
        <button
          type="button"
          data-testid="cue-learn"
          disabled={!rekordboxCollection || reading}
          onClick={learn}
          className="press inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--color-line-strong)] px-3 py-1 text-sm text-fg-dim hover:text-fg disabled:opacity-60"
        >
          {reading && (
            <Loader2
              data-testid="cue-learn-spinner"
              className="h-3.5 w-3.5 shrink-0 animate-spin"
              aria-hidden="true"
            />
          )}
          {tr('settings.cueFlows.learn')}
        </button>
      </div>
      {learning === 'none' && (
        <p data-testid="cue-learn-none" className="text-xs text-fg-dim">
          {tr('settings.cueFlows.learnNone')}
        </p>
      )}
      {learning === 'failed' && (
        <p data-testid="cue-learn-failed" className="text-xs text-warn">
          {tr('settings.cueFlows.learnFailed')}
        </p>
      )}
      {typeof learning === 'object' ? (
        <div data-testid="cue-learned" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm text-fg">
              {tr('settings.cueFlows.learnedName')}
            </h3>
            <button
              type="button"
              data-testid="cue-learned-use"
              onClick={() => adopt(learning)}
              className={BUTTON_CLASS}
            >
              {tr('settings.cueFlows.use')}
            </button>
            <button
              type="button"
              data-testid="cue-learned-discard"
              onClick={() => setLearning('idle')}
              className={BUTTON_CLASS}
            >
              {tr('settings.cueFlows.discard')}
            </button>
          </div>
          <p data-testid="cue-learned-coverage" className="text-xs text-fg-dim">
            {tr('settings.cueFlows.learnedCoverage', {
              ...learning.coverage,
              count: learning.coverage.marked,
            })}
          </p>
          <CueFlowPreview flow={learning.flow} />
        </div>
      ) : (
        <>
          <section aria-label={tr('settings.cueFlows.preview')}>
            <CueFlowPreview flow={flow} />
          </section>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-fg-dim">{tr('settings.cueFlows.rules')}</h3>
            {rows.map(({ rule, position }) => (
              <CueRuleRow
                key={`${flow.id}-${removals}-${position}`}
                rule={rule}
                index={position}
                onChange={(next) => setRules(flow.rules.map((r, j) => (j === position ? next : r)))}
                onRemove={() => {
                  setRules(flow.rules.filter((_, j) => j !== position))
                  setRemovals(removals + 1)
                }}
              />
            ))}
            {flow.rules.length === 0 && (
              <p data-testid="cue-flow-no-rules" className="text-xs text-fg-dim">
                {tr('settings.cueFlows.noRules')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="cue-rule-add"
                onClick={() => setRules([...flow.rules, NEW_RULE])}
                className={BUTTON_CLASS}
              >
                {`+ ${tr('settings.cueFlows.addRule')}`}
              </button>
              <span className="flex-1" />
              {inUse !== flow.id && (
                <button
                  type="button"
                  data-testid="cue-flow-use"
                  onClick={() => patch('activeCueFlow', flow.id)}
                  className={BUTTON_CLASS}
                >
                  {tr('settings.cueFlows.use')}
                </button>
              )}
              {flow.id === MY_FLOW_ID ? (
                <button
                  type="button"
                  data-testid="cue-flow-restore"
                  onClick={() => patch('cueFlows', restoreMyFlow(flows))}
                  className={BUTTON_CLASS}
                >
                  {tr('settings.cueFlows.restore')}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="cue-flow-delete"
                  onClick={remove}
                  className={BUTTON_CLASS}
                >
                  {tr('settings.cueFlows.delete')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div
        data-testid="cue-manual"
        className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-line)] px-3.5 py-3 text-sm"
      >
        <span className="font-semibold">{tr('settings.cueFlows.manual.title')}</span>
        <span className="text-fg-dim">{tr('settings.cueFlows.manual.jump')}</span>
        <div
          role="group"
          aria-label={tr('settings.cueFlows.manual.jump')}
          className="flex overflow-hidden rounded-md border border-[var(--color-line-strong)]"
        >
          {CUE_JUMP_BARS.map((bars) => (
            <button
              key={bars}
              type="button"
              data-testid={`cue-jump-${bars}`}
              aria-pressed={synced.cueJumpBars === bars}
              onClick={() => patch('cueJumpBars', bars)}
              className={`press px-2.5 py-1 font-mono text-xs ${
                synced.cueJumpBars === bars
                  ? 'bg-[var(--color-field)] text-fg'
                  : 'text-fg-dim hover:text-fg'
              }`}
            >
              {bars}
            </button>
          ))}
        </div>
        <span className="text-fg-dim">{tr('settings.cueFlows.manual.unit')}</span>
      </div>
    </div>
  )
```

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/cues-manual-t12.json` and merge it:

```json
{
  "es": { "settings": { "cueFlows": { "sentence": { "every": "cada", "put": "pon" }, "manual": { "title": "Editor manual", "jump": "Salto de las flechas ← →", "unit": "compases" } } } },
  "en": { "settings": { "cueFlows": { "sentence": { "every": "every", "put": "place" }, "manual": { "title": "Manual editor", "jump": "Arrow jump ← →", "unit": "bars" } } } },
  "de": { "settings": { "cueFlows": { "sentence": { "every": "alle", "put": "setze" }, "manual": { "title": "Manueller Editor", "jump": "Sprung der Pfeiltasten ← →", "unit": "Takte" } } } },
  "fr": { "settings": { "cueFlows": { "sentence": { "every": "toutes les", "put": "placez" }, "manual": { "title": "Éditeur manuel", "jump": "Saut des flèches ← →", "unit": "mesures" } } } },
  "pt-BR": { "settings": { "cueFlows": { "sentence": { "every": "a cada", "put": "coloque" }, "manual": { "title": "Editor manual", "jump": "Salto das setas ← →", "unit": "compassos" } } } }
}
```

Every existing `settings.cueFlows.*` key stays read (`flows` labels the tab group, `preview` the preview region, `rules` the heading, `name` the name input, `block.*` the tokens' accessible names).

- [ ] **Step 4: Run tests, types, lint**

`settings/CuesTab.test.tsx`, `CueFlowPreview.test.tsx`, `SettingsModal.test.tsx`, `i18n/keys.test.ts`, `i18n/usedKeys.test.ts`: PASS. Both `tsc`, `check`: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CueRuleRow.tsx apps/desktop/src/renderer/src/components/settings/CuesTab.tsx apps/desktop/src/renderer/src/components/settings/CuesTab.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Reorganize Settings Cues into flow tabs, rules as sentences and the manual editor jump"
```

---

### Task 13: Verify on the copy with the driver

Done by the controller with the run-desktop driver (`apps/desktop/.claude/skills/run-desktop/driver.mjs`) against the copy `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-edit/master.db`. Never `~/Library/Pioneer`. Screenshots go to `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-manual/`.

- [ ] **Step 1: Full suite, types, lint**

Full suite (`--reporter=dot --silent` into the scratch log), both `tsc`, `check`. Report any skipped test by name (the gated measurements and sweep are the only expected skips).

- [ ] **Step 2: Point the dev settings at the copy**

With Surco closed, read `rekordboxDbPath` in `~/Library/Application Support/Electron/settings.json` (today the `rb-b` copy). Set it to the `rb-edit` path with Edit, note the old value to put back in Step 7. Stop if the file points at anything outside `/private/tmp/claude-501/`.

- [ ] **Step 3: The full editor on a real track**

Build, launch with the driver, open a rekordbox playlist of the copy, select a track with no hot cues, open Cues, click `section-maximize`. Screenshot `maximized.png` and compare with the approved sketch: header with cover, title, artist, position, remaining, BPM and key; overview with the playhead; the detail in rekordbox colours with bar lines and the playhead in the centre; pads, MEMORY ◀ ▶ ✕, jump, flow, Descartar, Guardar; the key legend.

- [ ] **Step 4: Mark the track with the keyboard only**

With `eval` dispatching `keydown` on `document.activeElement` (the editor must already hold the focus after maximizing): → until the first drop, M, ← (16 bars back) and `1`, ← and `2`, ← and `3`, C, ⇧→ then ⇧←, ⌘Z once, `+` and `−`. Right-click pad B and pick another colour, then "Restablecer". Screenshot `keyboard.png`. Read `cues-position` before and after one Space plus a 1 s wait: it advances and the floating player stays paused (`document.querySelector('audio').paused`). Space again stops it. Focus the flow selector and press `m` and →: nothing happens.

- [ ] **Step 5: Save and read it back**

Click "Guardar en rekordbox", apply the queue on the copy (no rekordbox running), then read the copy's `djmdCue` rows for that `ContentID` with a read-only script in the scratchpad (as `colors.cjs` there does) and compare them with the section re-read: positions on beats, letters A to C where they were placed, the recoloured pad's `ColorTableIndex` back to 22 after "Restablecer", the CALLs `Kind` 0, `contentCue` JSON in step.

- [ ] **Step 6: Settings › Cues**

Open Settings › Cues, screenshot `settings.png`: flow tabs with "Mi flujo · En uso", the preview first, both rules as sentences. Change "3 veces" to "2 veces" with two clicks and watch the preview drop C. Pick 32 in "Editor manual", go back to the maximized editor: → now jumps 32 bars. Put the rule back with "Restablecer".

- [ ] **Step 7: Restore and hand over**

Put the old `rekordboxDbPath` back. Ask Vicent to open the `rb-edit` copy in rekordbox and confirm the track shows the cues as Surco drew them; record what he saw, dated, under "Cómo sabremos que está" in the spec and commit the spec alone ("Record the manual cue editor check on the rekordbox copy").

---

## Self-review

1. **Spec coverage.** §1 full screen: Task 9 (maximizable header, header with cover, title, artist, position, remaining, BPM and key, overview with playhead and click to seek, detail, bar, flow and Aplicar flujo, Descartar, Guardar), Task 5 (detail at PWV5 resolution, bar grid, cues by the shared rule, fixed centred playhead, drag, zoom 4 to 64 starting at 16, distance to the next CALL), Task 10 (legend). §2 sound: Task 6 (own `Audio`, floating player paused, follows every frame, seek while sounding, stops) and Task 10 (Space, stop on restore). §3 keys: Task 10 (every row of the table, focus on maximize, never while typing, Space never reaching the floating player). Pads by mouse and right-click colour: Tasks 8 and 11. §4 MEMORY: Task 3 (`adjacentCall`, `callAt`), Task 9 (MEMORY refusing a second CALL within 50 ms through the reducer, ◀ ▶ ✕). §5 jump: Task 1 (synced `cueJumpBars`), Task 8 (‹ ›), Task 9 (saved through `onCueJumpBars`), Task 12 (Settings card). §6 data: Task 4 (`rekordbox:cueWaveDetail` read-only, compact), Task 5 (fallback to the overview), Task 2 (hot cue on a chosen letter; CALL, delete and recolour already in the reducer). §7 Settings: Task 12 (tabs, preview first, sentences with menus, colours with the rekordbox picker, name in the tab, Usar, Restablecer, Borrar, Editor manual). Decision 5 "Restablecer": Task 11. Decision 7 (queue, backup, fingerprint): unchanged save path, checked in Task 13. Success criteria: Task 13. Risks: Task 5 (only the visible window painted, pinned by the fillRect count), Task 10 (Space and arrows consumed and checked against `useKeyboardShortcuts`' `defaultPrevented` and the key claims).
2. **Placeholder scan.** Every code step shows the code; the two places that say "edit" (Task 7 and Task 10 on `CuesSection.tsx`, Task 9 on `CueWave.tsx`, `Editor.tsx`, `App.tsx`) give the exact old and new text or the exact lines to add. Locale steps carry their full JSON.
3. **Type consistency.** `CueJumpBars`, `CUE_JUMP_BARS`, `DEFAULT_CUE_JUMP_BARS`, `normalizeCueJumpBars` (Task 1) are used with those names in Tasks 8, 9 and 12; `add-hot` with `kind?` (Task 2) is what `pad` dispatches in Task 9; `jumpBeats`, `adjacentCall`, `callAt`, `barsToNextCall`, `zoomStep`, `ZOOM_BARS`, `DEFAULT_ZOOM_BARS`, `detailWindow`, `cueClock` (Task 3) match Tasks 5, 9 and 10; `Api.rekordboxCueWaveDetail` returning `Uint16Array | null` (Task 4) matches `useCueWaveDetail` and `DetailSource.words` (Tasks 5 and 9); `CueAudition` with `toggle`, `seek`, `stop`, `playing` (Task 6) matches Task 10; `keptDraft`, `keepDraft`, `forgetDraft`, `keptPlayhead`, `keepPlayhead`, `resetCueSession` (Task 7) match Tasks 9 and 10; `CueDeck` props of Task 8 plus `locked` and `onRecolour` (Task 11) match the `CuesSection` element in both tasks; `CueKey`, `cueKeyAction` (Task 10) match its `run`.
4. **Review Focus.** Line 1 is pinned in Task 7 and Task 9, line 2 and line 3 in Task 10, line 4 in Task 6 and Task 10, line 5 in Task 3 and Task 5.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-20-editor-cues-manual.md`. Tasks 1 to 8 are independent building blocks with their own tests; Tasks 9 to 11 assemble them in `CuesSection.tsx` in that order; Task 12 is independent of 9 to 11 except for the picker's "Restablecer" (Task 11); Task 13 is the controller's.
