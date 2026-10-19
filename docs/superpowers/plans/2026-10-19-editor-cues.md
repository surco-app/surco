# Editor de cues y flujos configurables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each DJ builds their own cue flow from blocks in Settings › Cues (with a live preview on an example track), the Cues section becomes a full editor (mark drops, select, drag, delete, recolour, reletter, add from the right-click menu, apply a flow, ⌘Z), an Auto button proposes drops from rekordbox's phrases if it measures well, and "Guardar en rekordbox" queues the complete wanted cue set, written on close with backup and fingerprint check.

**Architecture:** A flow is data (`shared/cueFlows.ts`: rules made of blocks, the three bundled flows, normalisation). One generic engine in `shared/cueRules.ts` (`evaluateFlow`) turns a flow and a track into planned cues; `planCues` and `cueChanges` become adapters over it with "Mi flujo", so `cueRules.test.ts` passes unchanged and a 3000-case seeded comparison against a frozen copy of today's code proves parity. `flowOutcome` produces the **wanted set** (every cue the track should have, rekordbox IDs kept on the cues it keeps) and `diffCues` turns it into insert/update/delete by ID, so a moved cue is an update of `InMsec`, not a delete and insert. The renderer edits the wanted set through a pure reducer (`lib/cueDraft.ts`); the `cues` queue operation carries it; main diffs it against what rekordbox holds after the fingerprint check. One placement function (`lib/cueMarks.ts`) draws cues the same way in the list row, the Cues section and the configurator preview.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), biome.

**Spec:** `docs/superpowers/specs/2026-10-19-editor-cues-design.md`

**Depends on:** the rest of branch `worktree-fuentes-dj-playlists` (plans A and B of "Llevar a rekordbox", "Playlist al instante" with its Task 11 rekordbox colours, up to `5a970e16`).

**Out of scope (spec "Fuera de alcance"):** automatic detection that writes without confirming, rules written as code, loops, cue comments, CALL colours, editing cues of tracks outside rekordbox, applying a flow to a whole playlist at once.

## Global Constraints

- `$WT` means `/Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists`. **Write it out literally in every command**: the shell guard refuses commands whose paths come from a variable. Paths below are relative to `apps/desktop/` unless they start with `docs/`.
- Tests: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop <paths relative to apps/desktop>`. Never filter by a path from the repo root (the setup is skipped and failures are false). Full suite: add `--reporter=dot --silent > /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/suite.log` and read the tail.
- Types: `npm --prefix $WT/apps/desktop exec -- tsc -p $WT/apps/desktop/tsconfig.web.json --noEmit` and the same with `tsconfig.node.json`. A bare `tsc --noEmit` checks nothing.
- Lint: `npm --prefix $WT/apps/desktop run check`, then `git -C $WT status --short` must list only the task's files (other agents commit in this tree; never `git add -A` or `.`).
- The shell guard rejects heredocs, `cd … &&` chains and shell loops: write files with the Write tool, edit with Edit. Search with `rg` or the Grep tool.
- Locale additions go through the helper `node /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/merge-locale.cjs <file.json>` run with the Bash working directory set to `$WT/apps/desktop` (it resolves `src/renderer/src/i18n/locales` from the working directory and deep-merges `{ "<locale>": { ...keys } }`). Key removals are done with Edit in each of the 5 files.
- Zero comments in new code (biome directives included). A comment your change makes false is updated, not deleted.
- `data-testid` first in selectors. `window.api` mocks are typed: `vi.fn<Api['name']>()`.
- No user-facing string with an em dash or an explanatory colon. Every key exists in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`).
- **Never touch `~/Library/Pioneer`** from tests, scripts or tools. Tests build their own collection with `writeRekordboxPlaylistFixture` and ANLZ files with `anlzFixture` (`anlzFile`, `pqtzSection`, `pssiSection`, `pwv5Section`). Real data is read only from the test copy the settings point at (`/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-b/master.db`), read-only.
- **Every rekordbox write goes through the queue and `applyRekordboxBatch`** (backup, close check, fingerprint). No IPC or tool writes `master.db` directly.
- **Parity is the hard criterion** (spec §1): `src/shared/cueRules.test.ts` is not edited by any task. If a task's change makes it fail, the change is wrong.
- Constants of today stay: `SAME_POSITION_MS` 50, `START_MS` 3000, `BEATS_PER_BAR` 4, `MAX_HOT_CUES` 8, `HOT_KINDS` `[1, 2, 3, 5, 6, 7, 8, 9]` (A..H), memory cue `Kind` 0 with `ColorTableIndex` NULL, `Color` −1 on new rows, rows written as plan B wrote them.
- **Drawing rule** (spec decisions 4 and 5, §6): hot cue = square with its letter in rekordbox's colour (`hotCueColor`); CALL = red triangle (`MEMORY_CUE_COLOR`); a CALL paired with a hot cue sits right under it, centred on the same `left`; every CALL at one height, the drop's included.
- One functionality per commit, title only, no prefix, never `--no-verify`, never bare `git stash`.

## Decisions taken where the spec left room

1. **Conditions: four, not three.** The spec defines "si no cuadra con otra regla" as "does not fall in the same bar as another rule's cue". With that meaning "Mi flujo" breaks parity: `planCues` adds the yellow start only when *no countdown cue lies before the first drop* (drop at bar 40 plans bars 8 and 24 and no start cue, though neither is in bar 0). So the condition block offers `siempre`, `si cabe`, `si no cuadra con otra regla` (the spec's meaning: no cue of an earlier rule within one bar, 4 beats) and `si no hay otra antes de donde rompe` (`first`: the cue lies more than 50 ms before the first drop and no earlier rule placed a cue before that drop). Mi flujo's rule 2 uses `first`.
2. **Mi flujo rule 2 places hot cue + CALL**, not hot cue alone as the spec lists: today's `cueChanges` puts a CALL under the yellow start (`cueRules.test.ts` "reuses hot cues already on the plan…" expects a memory cue inserted at 0), and parity wins.
3. **Distance 0, "en el mismo golpe".** Rule 2 places its cue *at* the first beat, which "N compases (1 a 128)" cannot express. Distance 0 places one cue at the origin; direction and repeat are hidden and ignored, and "si cabe" does not apply to it.
4. **"si cabe" for a rule going back:** inside the grid, more than 50 ms after the previous origin of the same rule (the previous drop for "donde rompe"), and not inside a rekordbox strong part. **Going forward:** inside the grid and more than 50 ms before the next origin. The first repetition that does not fit ends that origin's repetitions (`break`, as `rules.py`). "Siempre" only stops at the edge of the grid.
5. **Limit of 8 (hot cues only).** Candidates to leave out are hot cues with repetition > 1, farthest from their origin first (`bars` descending), earliest first among equals; the first repetition of every rule is never left out. That is `TRIM_ORDER` 48 then 32 for Mi flujo. If the plan still needs more than 8, the outcome is `too-many` as today. The cues left out are returned (`trimmed`) and shown, as the spec asks.
6. **Two rules on the same spot:** a cue within 50 ms of a cue an earlier rule placed is not added (the earlier rule wins). Mi flujo never produces this, so parity is untouched.
7. **Letters:** a flow's output takes `HOT_KINDS` in time order. Manual edits never reletter: moving keeps the letter, an added hot cue takes the first free letter, "cambiar letra" offers only free letters. The real-rekordbox check in Task 16 confirms rekordbox shows a moved cue with the letter it had.
8. **The 16-colour picker** is `HOT_CUE_PICKER` = table indices `[1, 5, 9, 14, 18, 22, 26, 30, 32, 38, 42, 45, 48, 52, 56, 60]`, taken from Deep Symmetry's rekordbox colour table (the same table `rekordboxCueColors.ts` already holds). It contains the four colours of `cues.py` (1, 22, 32, 42), the only ones in Vicent's collection (measured on `rb-b`: hot cues use NULL, 0, 1, 22, 32, 42). Task 16 compares it against rekordbox's own picker; a difference is fixed in the constant before the plan is done. A new hot cue takes index 22, the colour `HOT_CUE_DEFAULT_COLOR` already paints.
9. **Storage and migration:** `cueFlows` and `activeCueFlow` are synced settings (not `LOCAL_KEYS`): a flow follows the person, like `traktorCueOffsetMs`. `mergeSettings` normalises them on every read, so an old file gets the three bundled flows with "Mi flujo" active, a file without "Mi flujo" gets it back, invalid rules are dropped and an unknown active id falls back to "Mi flujo". The existing configuration export carries them with no change (it exports every synced key); a test pins the round trip. Bundled flows are stored with an empty `name` and shown with a translated name until renamed; their ids are `mine`, `one-at-32`, `calls-only`; new flows get `crypto.randomUUID()`. Deleting the active flow makes "Mi flujo" active.
10. **Phrase types** map from rekordbox's `PSSI` kinds per mood: intro 1; high mood (1) up 2, down 3, chorus 5, outro 6; mid and low moods (2, 3) "subida" = verses 2 to 7, "bajada" = bridge 8, chorus 9, outro 10. Chorus matches `CHORUS_BY_MOOD`.
11. **Editing a pair:** a hot cue drags and deletes the CALL within 50 ms of it; a CALL moves and deletes alone. A move onto a spot already taken by a cue of the same type (or the pair's CALL onto another CALL) is refused and the cue snaps back.
12. **The wanted set keeps rekordbox IDs** on cues it keeps, and `diffCues` is a pure ID diff: an ID'd cue whose letter, colour or position changed is an update (position included, writing `InMsec`/`InFrame` in place so rekordbox keeps the cue's identity), a cue without ID is an insert, a rekordbox cue missing from the set is a delete.
13. **Marking or unmarking a drop and "Aplicar flujo" evaluate against the current draft**, so cues edited in the section count as manual work exactly like cues placed in rekordbox; `previousDrops` are the draft's drops and `previousFlow` the flow that last generated the draft. "Aplicar flujo" with another flow switches the draft to it.
14. **Queue files written before this plan** hold `cues` ops with `drops`/`previousDrops` and no `wanted`. They still apply, through Mi flujo, exactly as before.
15. **Block values are chosen, not typed** (spec decision 1): distance from `[0, 1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]`, repeat from 1 to 8 or "hasta el borde". Normalisation accepts any integer 0 to 128 and repeats 1 to 16 from a hand-edited file.
16. **A CALL placed by a rule on its own** (Pon = CALL) reads as a drop the next time the track is read; rekordbox has nothing that tells them apart. The rule row says so under the block.
17. **⌘Z and ⌫ are handled where the cue editor has focus** (`preventDefault`, so the global ⌘Z metadata undo does not fire); outside the section ⌘Z keeps its meaning. The existing "Deshacer" button becomes "Descartar cambios" (back to what rekordbox holds, dropping a queued save), since ⌘Z is now the step undo.
18. **The fixed four-colour legend goes**: colours now come from the flow. The section shows the flow selector instead.
19. **Spanish copy says "donde rompe"** in the new strings (the spec's and Vicent's words); other locales say "drop". The existing es help text is rewritten to match.
20. **Auto ships if at least 70 % of Vicent's drops get a proposal in the same bar** (the spec leaves "acierta poco" open). Both recall and precision are written into the spec; below 70 % Task 15 is not run and the spec records the button as pending.
21. **The example track** (spec §2): 128 BPM, 192 bars, regular grid, phrases intro 0, up 32, chorus 64, down 96, up 112, chorus 128, outro 160, strong parts 64 to 96 and 128 to 160 (high mood), drop at bar 64, and a synthetic waveform whose height follows the phrase.

## Review Focus

1. **Cues edited by hand in the section, then another drop marked.** The flow must not overwrite those edits: only the CALL is added and the section says the cues are manual. Pinned in Task 10 ("marking a drop after moving a countdown cue keeps the move and only adds the CALL").
2. **A move that lands on another cue, or a delete of a hot cue that has its CALL under it.** The move is refused, letters never reshuffle, the CALL goes with its hot cue and never survives as a fake drop. Pinned in Task 10.
3. **A queue file saved by the previous build** (a `cues` op with `drops` and no `wanted`) applied after updating Surco. It lands as Mi flujo, never over manual work. Pinned in Task 7.
4. **A settings file from another Mac or an older Surco** with no flows, a flow list without "Mi flujo", a broken rule or an active id of a deleted flow. Mi flujo is always there and active as fallback; the section and "complete on close" never crash or use an empty flow by accident. Pinned in Task 1 and Task 6.
5. **rekordbox changes or moves a cue between the section's read and the apply,** or a moved cue is written. The op is dropped with "cues-changed"; a move rewrites `InMsec`/`InFrame` of the same row and keeps its `ID`. Pinned in Task 4 and Task 7.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/cueFlows.ts` (new) | flow and rule types, the three bundled flows, `phraseKindOf`, `normalizeCueFlows`, `activeCueFlow`, `restoreMyFlow` |
| `src/shared/cueRules.ts` (mod) | `evaluateFlow` (the generic engine), `flowOutcome`, `diffCues`, `proposeDrops`; `planCues` and `cueChanges` as adapters with Mi flujo |
| `src/shared/rekordboxCueColors.ts` (mod) | `HOT_CUE_PICKER`, `HOT_CUE_DEFAULT_INDEX` |
| `src/shared/types.ts` (mod) | `Settings.cueFlows`, `Settings.activeCueFlow`, `TrackCues.phrases`, `SaveCuesRequest.wanted` |
| `src/main/rekordboxCues.ts` (mod) | phrases in the read; moves in `applyCueChanges` |
| `src/main/rekordboxQueueOps.ts`, `rekordboxPlaylistWrite.ts`, `rekordboxCuesIpc.ts` (mod) | the `cues` op carries the wanted set |
| `src/main/rekordboxCompleteOnClose.ts`, `src/main/index.ts` (mod) | complete on close with the active flow |
| `src/main/settings.ts` (mod) | defaults and normalisation of the flows |
| `src/main/autoDropsMeasure.test.ts` (new) | gated measurement of Auto against the test copy |
| `src/preload/index.ts`, `src/preload/api.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (mod) | `rekordboxQueuedCues` returns the wanted set |
| `src/renderer/src/lib/cueMarks.ts` (new) | where each hot cue and CALL is drawn |
| `src/renderer/src/lib/cueDraft.ts` (new) | the section's draft: actions and undo |
| `src/renderer/src/lib/cueExample.ts` (new) | the example track of the preview |
| `src/renderer/src/components/RowWave.tsx`, `CueWave.tsx` (mod) | drawing rule; CueWave gains selection, drag, menu, proposals, read-only |
| `src/renderer/src/components/CuePalette.tsx` (new) | the 16-colour picker |
| `src/renderer/src/components/CuesSection.tsx` (mod) | the editor |
| `src/renderer/src/components/CueFlowPreview.tsx`, `CueRuleRow.tsx`, `settings/CuesTab.tsx` (new) | the configurator |
| `src/renderer/src/lib/settingsDraft.ts`, `settingsContext.tsx`, `settingsTabs.ts`, `components/SettingsModal.tsx`, `settings/DestinationTab.tsx` (mod) | wiring |
| `src/renderer/src/i18n/locales/*.json` (mod) | `editor.cues.*`, `cueWave.*`, `cueFlows.*`, `settings.cueFlows.*`, `settings.tabs.cues`, `settings.completeCues*` |
| `docs/superpowers/specs/2026-10-19-editor-cues-design.md` (mod) | the Auto measurement |

## Task list

| # | Task |
|---|---|
| 1 | The flow model |
| 2 | The generic engine, with `planCues` on it |
| 3 | Wanted sets and an ID diff, with `cueChanges` on them |
| 4 | Moves in the change writer |
| 5 | Phrases in the track read |
| 6 | Flows in the settings |
| 7 | The `cues` operation carries the wanted set |
| 8 | Complete on close with the active flow |
| 9 | One drawing rule, starting with the list row |
| 10 | The section's draft |
| 11 | The waveform: marks, selection, drag, menu, proposals |
| 12 | The Cues section becomes the editor |
| 13 | The configurator in Settings › Cues |
| 14 | Propose drops, and measure them against Vicent's collection |
| 15 | The Auto button (only if Task 14 clears the bar) |
| 16 | Verify on the test copy, then Vicent in real rekordbox |

---

### Task 1: The flow model

**Files:**
- Create: `src/shared/cueFlows.ts`
- Test: `src/shared/cueFlows.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (all exported from `src/shared/cueFlows.ts`):
  - `type PhraseKind = 'intro' | 'up' | 'down' | 'chorus' | 'outro'`
  - `type FlowOrigin = 'drop' | 'first-beat' | 'last-beat' | PhraseKind`
  - `type FlowDirection = 'back' | 'forward'`; `type FlowRepeat = number | 'edge'`
  - `type FlowCondition = 'always' | 'fits' | 'clear' | 'first'`
  - `type FlowPlace = 'hot' | 'call' | 'both'`
  - `type FlowColor = { fixed: number } | { each: number[] }`
  - `interface CueRule { from: FlowOrigin; direction: FlowDirection; bars: number; repeat: FlowRepeat; when: FlowCondition; place: FlowPlace; color: FlowColor }`
  - `interface CueFlow { id: string; name: string; rules: CueRule[] }`
  - `interface FlowPhrase { ms: number; kind: PhraseKind }`
  - constants `MY_FLOW_ID`, `MY_FLOW`, `ONE_AT_32`, `CALLS_ONLY`, `BUNDLED_FLOWS`, `RULE_BARS`, `MAX_RULE_REPEAT`, `FLOW_ORIGINS`, `FLOW_CONDITIONS`, `FLOW_PLACES`
  - `phraseKindOf(mood: number, kind: number): PhraseKind | null`
  - `normalizeCueFlows(value: unknown): CueFlow[]`
  - `activeCueFlow(settings: { cueFlows?: CueFlow[]; activeCueFlow?: string }): CueFlow`
  - `restoreMyFlow(flows: CueFlow[]): CueFlow[]`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/cueFlows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  activeCueFlow,
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  MY_FLOW,
  ONE_AT_32,
  normalizeCueFlows,
  phraseKindOf,
  restoreMyFlow,
} from './cueFlows'

describe('bundled flows', () => {
  it('starts from the rules.py countdown so nothing changes for Vicent', () => {
    expect(MY_FLOW).toEqual({
      id: 'mine',
      name: '',
      rules: [
        {
          from: 'drop',
          direction: 'back',
          bars: 16,
          repeat: 3,
          when: 'fits',
          place: 'both',
          color: { each: [1, 22, 42] },
        },
        {
          from: 'first-beat',
          direction: 'back',
          bars: 0,
          repeat: 1,
          when: 'first',
          place: 'both',
          color: { fixed: 32 },
        },
      ],
    })
  })

  it('offers one green cue 32 bars before the drop and a flow with no rules at all', () => {
    expect(ONE_AT_32.rules).toEqual([
      {
        from: 'drop',
        direction: 'back',
        bars: 32,
        repeat: 1,
        when: 'fits',
        place: 'hot',
        color: { fixed: 22 },
      },
    ])
    expect(CALLS_ONLY.rules).toEqual([])
    expect(BUNDLED_FLOWS.map((f) => f.id)).toEqual(['mine', 'one-at-32', 'calls-only'])
  })
})

describe('phraseKindOf', () => {
  it('reads high mood phrases as rekordbox names them', () => {
    expect([1, 2, 3, 5, 6].map((k) => phraseKindOf(1, k))).toEqual([
      'intro',
      'up',
      'down',
      'chorus',
      'outro',
    ])
  })

  it('reads verses as up and the bridge as down in mid and low moods, where rekordbox has no up or down', () => {
    expect([1, 2, 7, 8, 9, 10].map((k) => phraseKindOf(2, k))).toEqual([
      'intro',
      'up',
      'up',
      'down',
      'chorus',
      'outro',
    ])
    expect(phraseKindOf(3, 9)).toBe('chorus')
  })

  it('leaves a kind it does not know out instead of guessing', () => {
    expect(phraseKindOf(1, 4)).toBeNull()
    expect(phraseKindOf(2, 11)).toBeNull()
  })
})

describe('normalizeCueFlows', () => {
  it('gives the bundled flows to a settings file written before flows existed', () => {
    expect(normalizeCueFlows(undefined)).toEqual(BUNDLED_FLOWS)
  })

  it('puts Mi flujo back when a synced file lost it, because the app falls back to it', () => {
    const mine: CueFlow = { id: 'x', name: 'Solo 64', rules: [] }
    expect(normalizeCueFlows([mine]).map((f) => f.id)).toEqual(['mine', 'x'])
  })

  it('drops a broken rule and keeps the good ones, so a hand-edited file never crashes the engine', () => {
    const flows = normalizeCueFlows([
      {
        id: 'x',
        name: 'Mixta',
        rules: [
          { ...ONE_AT_32.rules[0], bars: 500 },
          { ...ONE_AT_32.rules[0], color: { each: [] } },
          { ...ONE_AT_32.rules[0], from: 'bridge' },
          { ...ONE_AT_32.rules[0], repeat: 'edge' },
        ],
      },
    ])
    expect(flows.find((f) => f.id === 'x')?.rules).toEqual([
      { ...ONE_AT_32.rules[0], repeat: 'edge' },
    ])
  })

  it('keeps the first of two flows with the same id', () => {
    const flows = normalizeCueFlows([
      MY_FLOW,
      { id: 'x', name: 'A', rules: [] },
      { id: 'x', name: 'B', rules: [] },
    ])
    expect(flows.filter((f) => f.id === 'x').map((f) => f.name)).toEqual(['A'])
  })
})

describe('activeCueFlow', () => {
  it('uses the flow the user chose', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: 'one-at-32' })).toBe(ONE_AT_32)
  })

  it('falls back to Mi flujo when the chosen flow was deleted on another Mac', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: 'gone' })).toBe(MY_FLOW)
    expect(activeCueFlow({})).toBe(MY_FLOW)
  })
})

describe('restoreMyFlow', () => {
  it('puts Mi flujo back as rules.py has it and leaves the other flows alone', () => {
    const edited = { ...MY_FLOW, name: 'Lo mío', rules: [] }
    expect(restoreMyFlow([edited, ONE_AT_32])).toEqual([MY_FLOW, ONE_AT_32])
  })
})
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueFlows.test.ts`
Expected: FAIL, `Failed to resolve import "./cueFlows"`.

- [ ] **Step 3: Implement**

Create `src/shared/cueFlows.ts`:

```ts
export type PhraseKind = 'intro' | 'up' | 'down' | 'chorus' | 'outro'
export type FlowOrigin = 'drop' | 'first-beat' | 'last-beat' | PhraseKind
export type FlowDirection = 'back' | 'forward'
export type FlowRepeat = number | 'edge'
export type FlowCondition = 'always' | 'fits' | 'clear' | 'first'
export type FlowPlace = 'hot' | 'call' | 'both'
export type FlowColor = { fixed: number } | { each: number[] }

export interface CueRule {
  from: FlowOrigin
  direction: FlowDirection
  bars: number
  repeat: FlowRepeat
  when: FlowCondition
  place: FlowPlace
  color: FlowColor
}

export interface CueFlow {
  id: string
  name: string
  rules: CueRule[]
}

export interface FlowPhrase {
  ms: number
  kind: PhraseKind
}

export const MY_FLOW_ID = 'mine'
export const RULE_BARS = [0, 1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]
export const MAX_RULE_REPEAT = 16
export const FLOW_ORIGINS: FlowOrigin[] = [
  'drop',
  'first-beat',
  'last-beat',
  'intro',
  'up',
  'down',
  'chorus',
  'outro',
]
export const FLOW_CONDITIONS: FlowCondition[] = ['always', 'fits', 'clear', 'first']
export const FLOW_PLACES: FlowPlace[] = ['hot', 'call', 'both']
const DIRECTIONS: FlowDirection[] = ['back', 'forward']

export const MY_FLOW: CueFlow = {
  id: MY_FLOW_ID,
  name: '',
  rules: [
    {
      from: 'drop',
      direction: 'back',
      bars: 16,
      repeat: 3,
      when: 'fits',
      place: 'both',
      color: { each: [1, 22, 42] },
    },
    {
      from: 'first-beat',
      direction: 'back',
      bars: 0,
      repeat: 1,
      when: 'first',
      place: 'both',
      color: { fixed: 32 },
    },
  ],
}

export const ONE_AT_32: CueFlow = {
  id: 'one-at-32',
  name: '',
  rules: [
    {
      from: 'drop',
      direction: 'back',
      bars: 32,
      repeat: 1,
      when: 'fits',
      place: 'hot',
      color: { fixed: 22 },
    },
  ],
}

export const CALLS_ONLY: CueFlow = { id: 'calls-only', name: '', rules: [] }

export const BUNDLED_FLOWS: CueFlow[] = [MY_FLOW, ONE_AT_32, CALLS_ONLY]

const HIGH_MOOD: Record<number, PhraseKind> = { 1: 'intro', 2: 'up', 3: 'down', 5: 'chorus', 6: 'outro' }
const OTHER_MOOD: Record<number, PhraseKind> = { 1: 'intro', 8: 'down', 9: 'chorus', 10: 'outro' }

export function phraseKindOf(mood: number, kind: number): PhraseKind | null {
  if (mood === 1) return HIGH_MOOD[kind] ?? null
  if (kind >= 2 && kind <= 7) return 'up'
  return OTHER_MOOD[kind] ?? null
}

const isColorIndex = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 62

function colorOf(value: unknown): FlowColor | null {
  if (!value || typeof value !== 'object') return null
  const c = value as { fixed?: unknown; each?: unknown }
  if (isColorIndex(c.fixed)) return { fixed: c.fixed }
  if (Array.isArray(c.each) && c.each.length > 0 && c.each.every(isColorIndex))
    return { each: [...c.each] }
  return null
}

function repeatOf(value: unknown): FlowRepeat | null {
  if (value === 'edge') return 'edge'
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_RULE_REPEAT
    ? value
    : null
}

function ruleOf(value: unknown): CueRule | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const color = colorOf(r.color)
  const repeat = repeatOf(r.repeat)
  const bars = r.bars
  if (
    !FLOW_ORIGINS.includes(r.from as FlowOrigin) ||
    !DIRECTIONS.includes(r.direction as FlowDirection) ||
    !FLOW_CONDITIONS.includes(r.when as FlowCondition) ||
    !FLOW_PLACES.includes(r.place as FlowPlace) ||
    typeof bars !== 'number' ||
    !Number.isInteger(bars) ||
    bars < 0 ||
    bars > 128 ||
    color === null ||
    repeat === null
  )
    return null
  return {
    from: r.from as FlowOrigin,
    direction: r.direction as FlowDirection,
    bars,
    repeat,
    when: r.when as FlowCondition,
    place: r.place as FlowPlace,
    color,
  }
}

export function normalizeCueFlows(value: unknown): CueFlow[] {
  if (!Array.isArray(value)) return BUNDLED_FLOWS
  const seen = new Set<string>()
  const flows: CueFlow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    if (typeof f.id !== 'string' || f.id === '' || seen.has(f.id) || !Array.isArray(f.rules))
      continue
    seen.add(f.id)
    flows.push({
      id: f.id,
      name: typeof f.name === 'string' ? f.name : '',
      rules: f.rules.flatMap((r) => {
        const rule = ruleOf(r)
        return rule ? [rule] : []
      }),
    })
  }
  return seen.has(MY_FLOW_ID) ? flows : [MY_FLOW, ...flows]
}

export function activeCueFlow(settings: { cueFlows?: CueFlow[]; activeCueFlow?: string }): CueFlow {
  const flows = settings.cueFlows ?? BUNDLED_FLOWS
  return (
    flows.find((f) => f.id === settings.activeCueFlow) ??
    flows.find((f) => f.id === MY_FLOW_ID) ??
    MY_FLOW
  )
}

export function restoreMyFlow(flows: CueFlow[]): CueFlow[] {
  return flows.map((f) => (f.id === MY_FLOW_ID ? MY_FLOW : f))
}
```

- [ ] **Step 4: Run tests, types, lint**

Run the test file: PASS. Both `tsc`: clean. `npm --prefix $WT/apps/desktop run check`: clean; `git -C $WT status --short`: only the two files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/cueFlows.ts apps/desktop/src/shared/cueFlows.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Describe cue flows as rules made of blocks"
```

---

### Task 2: The generic engine, with `planCues` on it

**Files:**
- Modify: `src/shared/cueRules.ts` (add the engine, rewrite `planCues` as an adapter)
- Create: `src/shared/cueRulesFlows.test.ts`, `src/shared/cueRulesParity.test.ts`
- Untouched and must pass: `src/shared/cueRules.test.ts`

**Interfaces:**
- Consumes: `CueFlow`, `CueRule`, `FlowPhrase`, `FlowPlace`, `MY_FLOW` from Task 1.
- Produces (exported from `src/shared/cueRules.ts`):
  - `interface FlowTrack { beats: number[]; drops: number[]; strong: StrongPart[]; phrases: FlowPhrase[] }`
  - `interface FlowCue { ms: number; place: FlowPlace; color: number | null; rule: number; repetition: number; bars: number }`
  - `interface FlowPlan { cues: FlowCue[]; trimmed: FlowCue[] }`
  - `ruleColor(rule: CueRule, repetition: number): number`
  - `evaluateFlow(flow: CueFlow, track: FlowTrack): FlowPlan`
  - `planCues` keeps its signature and result.
  - `fitsPlan(existingHotMs: number[], plan: { ms: number }[]): boolean` (parameter widened, same behaviour).

`cueRules.ts` imports from `cueFlows.ts` and `cueFlows.ts` imports nothing from `cueRules.ts`, so there is no import cycle.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/cueRulesFlows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type CueFlow, type CueRule, MY_FLOW } from './cueFlows'
import { evaluateFlow, type FlowTrack } from './cueRules'

const grid = (bars: number): number[] => Array.from({ length: bars * 4 }, (_, i) => i * 500)
const beat = (bars: number): number => bars * 2000
const track = (over: Partial<FlowTrack> = {}): FlowTrack => ({
  beats: grid(200),
  drops: [beat(64)],
  strong: [],
  phrases: [],
  ...over,
})
const rule = (over: Partial<CueRule> = {}): CueRule => ({
  from: 'drop',
  direction: 'back',
  bars: 16,
  repeat: 1,
  when: 'fits',
  place: 'hot',
  color: { fixed: 1 },
  ...over,
})
const flow = (...rules: CueRule[]): CueFlow => ({ id: 't', name: '', rules })

describe('evaluateFlow', () => {
  it('runs Mi flujo as the 16, 32, 48 countdown with a colour per repetition', () => {
    expect(evaluateFlow(MY_FLOW, track()).cues).toEqual([
      { ms: beat(16), place: 'both', color: 42, rule: 0, repetition: 3, bars: 48 },
      { ms: beat(32), place: 'both', color: 22, rule: 0, repetition: 2, bars: 32 },
      { ms: beat(48), place: 'both', color: 1, rule: 0, repetition: 1, bars: 16 },
    ])
  })

  it('goes forward from the drop and stops before the next one, so it never lands on it', () => {
    const forward = flow(rule({ direction: 'forward', repeat: 3 }))
    expect(
      evaluateFlow(forward, track({ drops: [beat(64), beat(112)] })).cues.map((c) => c.ms),
    ).toEqual([beat(80), beat(96), beat(128), beat(144), beat(160)])
  })

  it('repeats to the edge of the track when asked, whatever is in the way, with always', () => {
    const edge = flow(rule({ repeat: 'edge', when: 'always', color: { each: [1, 22] } }))
    const cues = evaluateFlow(edge, track()).cues
    expect(cues.map((c) => c.ms)).toEqual([beat(0), beat(16), beat(32), beat(48)])
    expect(cues.map((c) => c.color)).toEqual([22, 22, 22, 1])
  })

  it('counts from each phrase of a type rekordbox analysed', () => {
    const fromChorus = flow(rule({ from: 'chorus', bars: 8, place: 'call' }))
    const phrases = [
      { ms: beat(32), kind: 'chorus' as const },
      { ms: beat(40), kind: 'up' as const },
      { ms: beat(96), kind: 'chorus' as const },
    ]
    expect(evaluateFlow(fromChorus, track({ phrases })).cues).toEqual([
      { ms: beat(24), place: 'call', color: null, rule: 0, repetition: 1, bars: 8 },
      { ms: beat(88), place: 'call', color: null, rule: 0, repetition: 1, bars: 8 },
    ])
  })

  it('places a cue on the first or the last beat with distance zero', () => {
    const ends = flow(
      rule({ from: 'first-beat', bars: 0, when: 'always' }),
      rule({ from: 'last-beat', bars: 0, when: 'always', color: { fixed: 42 } }),
    )
    expect(evaluateFlow(ends, track()).cues.map((c) => [c.ms, c.color])).toEqual([
      [0, 1],
      [grid(200)[799], 42],
    ])
  })

  it('skips a cue that would share a bar with an earlier rule cue, with si no cuadra', () => {
    const clear = flow(
      rule({ bars: 16 }),
      rule({ from: 'first-beat', bars: 0, when: 'clear' }),
      rule({ bars: 0, when: 'clear', place: 'call' }),
    )
    const out = evaluateFlow(clear, track({ drops: [beat(16) + 1500] }))
    expect(out.cues.map((c) => c.rule)).toEqual([0, 2])
  })

  it('keeps the earlier rule when two rules land on the same spot', () => {
    const twice = flow(rule({ color: { fixed: 1 } }), rule({ color: { fixed: 42 } }))
    expect(evaluateFlow(twice, track()).cues.map((c) => c.color)).toEqual([1])
  })

  it('leaves the farthest hot cues out first past 8 and says which', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    const out = evaluateFlow(MY_FLOW, track({ beats: grid(400), drops }))
    expect(out.cues).toHaveLength(8)
    expect(out.trimmed.map((c) => [c.ms, c.bars])).toEqual([[beat(0), 48]])
  })

  it('never counts loose CALLs against the 8 hot cues', () => {
    const calls = flow(rule({ repeat: 'edge', when: 'always', place: 'call' }))
    expect(evaluateFlow(calls, track({ beats: grid(400), drops: [beat(400) - 500] })).trimmed).toEqual(
      [],
    )
  })

  it('plans nothing on a track without a grid', () => {
    expect(evaluateFlow(MY_FLOW, track({ beats: [] }))).toEqual({ cues: [], trimmed: [] })
  })
})
```

Create `src/shared/cueRulesParity.test.ts`. `legacyPlanCues` and `legacyCueChanges` are today's `planCues` and `cueChanges` copied verbatim, frozen here as the reference; Task 3 adds the `cueChanges` half of the comparison.

```ts
import { describe, expect, it } from 'vitest'
import { nearestBeat, planCues, type PlannedCue, type StrongPart } from './cueRules'

const SAME = 50
const LEGACY_DISTANCES = [16, 32, 48] as const
const LEGACY_TRIM = [48, 32] as const

function legacyPlanCues(dropsMs: number[], beatsMs: number[], strong: StrongPart[] = []): PlannedCue[] {
  let plan: PlannedCue[] = []
  let previous: number | null = null
  for (const drop of [...dropsMs].sort((a, b) => a - b)) {
    const index = nearestBeat(beatsMs, drop)
    for (const bars of LEGACY_DISTANCES) {
      const back = index - bars * 4
      if (back < 0 || (previous !== null && beatsMs[back] <= previous + SAME)) break
      if (strong.some((s) => s.start <= beatsMs[back] && beatsMs[back] < s.end)) break
      plan.push({ ms: beatsMs[back], kind: bars })
    }
    previous = drop
  }
  const firstDrop = dropsMs.length > 0 ? Math.min(...dropsMs) : null
  if (firstDrop !== null && !plan.some((p) => p.ms < firstDrop) && beatsMs[0] < firstDrop - SAME)
    plan.push({ ms: beatsMs[0], kind: 'inicio' })
  for (const kind of LEGACY_TRIM) {
    while (plan.length > 8 && plan.some((p) => p.kind === kind)) {
      const earliest = plan.filter((p) => p.kind === kind).reduce((a, b) => (b.ms < a.ms ? b : a))
      plan = plan.filter((p) => p !== earliest)
    }
  }
  return plan.sort((a, b) => a.ms - b.ms)
}

function prng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomTrack(r: () => number) {
  const count = 100 + Math.floor(r() * 700)
  const start = Math.floor(r() * 2000)
  const beatMs = 400 + r() * 200
  const change = Math.floor(r() * count)
  const beats = Array.from({ length: count }, (_, i) =>
    Math.round(start + i * beatMs + (i > change ? (i - change) * 20 : 0)),
  )
  const end = beats[count - 1]
  const pick = (): number =>
    r() < 0.8 ? beats[Math.floor(r() * count)] : Math.round(r() * (end + 2000))
  const drops = Array.from({ length: Math.floor(r() * 6) }, pick)
  if (drops.length > 0 && r() < 0.1) drops.push(drops[0])
  const strong: StrongPart[] =
    r() < 0.5
      ? []
      : Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
          const a = Math.floor(r() * count)
          return { start: beats[a], end: beats[Math.min(count - 1, a + Math.floor(r() * 128))] }
        })
  return { beats, drops, strong, pick }
}

describe('Mi flujo through the engine against the frozen planCues', () => {
  it('plans exactly what rules.py planned in 3000 random tracks', () => {
    const r = prng(20261019)
    for (let i = 0; i < 3000; i++) {
      const { beats, drops, strong } = randomTrack(r)
      expect(planCues(drops, beats, strong), `case ${i}`).toEqual(
        legacyPlanCues(drops, beats, strong),
      )
    }
  })
})
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueRulesFlows.test.ts src/shared/cueRulesParity.test.ts`
Expected: FAIL, `evaluateFlow` is not exported (the parity test passes already against today's `planCues`; it is the net for Step 3).

- [ ] **Step 3: Implement**

In `src/shared/cueRules.ts`, add at the top:

```ts
import { type CueFlow, type CueRule, type FlowPhrase, type FlowPlace, MY_FLOW } from './cueFlows'
```

Widen `fitsPlan`'s second parameter to `plan: { ms: number }[]` (body unchanged).

Add after `fitsPlan`:

```ts
export interface FlowTrack {
  beats: number[]
  drops: number[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
}

export interface FlowCue {
  ms: number
  place: FlowPlace
  color: number | null
  rule: number
  repetition: number
  bars: number
}

export interface FlowPlan {
  cues: FlowCue[]
  trimmed: FlowCue[]
}

const isPlannedHot = (c: FlowCue): boolean => c.place !== 'call'

export function ruleColor(rule: CueRule, repetition: number): number {
  return 'fixed' in rule.color
    ? rule.color.fixed
    : rule.color.each[Math.min(repetition, rule.color.each.length) - 1]
}

function originsOf(rule: CueRule, track: FlowTrack, drops: number[]): number[] {
  if (rule.from === 'drop') return drops
  if (rule.from === 'first-beat') return [track.beats[0]]
  if (rule.from === 'last-beat') return [track.beats[track.beats.length - 1]]
  return track.phrases
    .filter((p) => p.kind === rule.from)
    .map((p) => p.ms)
    .sort((a, b) => a - b)
}

function fitsAround(
  ms: number,
  rule: CueRule,
  previous: number | null,
  next: number | null,
  strong: StrongPart[],
): boolean {
  if (rule.direction === 'forward') return next === null || ms < next - SAME_POSITION_MS
  if (previous !== null && ms <= previous + SAME_POSITION_MS) return false
  return !strong.some((s) => s.start <= ms && ms < s.end)
}

function allowed(
  rule: CueRule,
  ms: number,
  earlier: FlowCue[],
  drops: number[],
  beats: number[],
): boolean {
  if (rule.when === 'first')
    return (
      drops.length > 0 &&
      ms < drops[0] - SAME_POSITION_MS &&
      !earlier.some((c) => c.ms < drops[0])
    )
  if (rule.when === 'clear') {
    const at = nearestBeat(beats, ms)
    return earlier.every((c) => Math.abs(nearestBeat(beats, c.ms) - at) >= BEATS_PER_BAR)
  }
  return true
}

function trimToLimit(cues: FlowCue[]): FlowPlan {
  let kept = cues
  const trimmed: FlowCue[] = []
  const candidates = cues
    .filter((c) => isPlannedHot(c) && c.repetition > 1)
    .sort((a, b) => b.bars - a.bars || a.ms - b.ms)
  for (const c of candidates) {
    if (kept.filter(isPlannedHot).length <= MAX_HOT_CUES) break
    kept = kept.filter((k) => k !== c)
    trimmed.push(c)
  }
  return { cues: [...kept].sort((a, b) => a.ms - b.ms), trimmed }
}

export function evaluateFlow(flow: CueFlow, track: FlowTrack): FlowPlan {
  const { beats } = track
  if (beats.length === 0) return { cues: [], trimmed: [] }
  const drops = [...track.drops].sort((a, b) => a - b)
  const placed: FlowCue[] = []
  flow.rules.forEach((rule, index) => {
    const own: FlowCue[] = []
    const add = (ms: number, repetition: number): void => {
      if ([...placed, ...own].some((c) => Math.abs(c.ms - ms) <= SAME_POSITION_MS)) return
      own.push({
        ms,
        place: rule.place,
        color: rule.place === 'call' ? null : ruleColor(rule, repetition),
        rule: index,
        repetition,
        bars: repetition * rule.bars,
      })
    }
    const origins = originsOf(rule, track, drops)
    origins.forEach((origin, i) => {
      const start = nearestBeat(beats, origin)
      if (rule.bars === 0) {
        if (allowed(rule, beats[start], placed, drops, beats)) add(beats[start], 1)
        return
      }
      const previous = i > 0 ? origins[i - 1] : null
      const next = i + 1 < origins.length ? origins[i + 1] : null
      const step = rule.bars * BEATS_PER_BAR * (rule.direction === 'back' ? -1 : 1)
      const times = rule.repeat === 'edge' ? beats.length : rule.repeat
      for (let k = 1; k <= times; k++) {
        const at = start + k * step
        if (at < 0 || at >= beats.length) break
        const ms = beats[at]
        if (rule.when === 'fits' && !fitsAround(ms, rule, previous, next, track.strong)) break
        if (allowed(rule, ms, placed, drops, beats)) add(ms, k)
      }
    })
    placed.push(...own)
  })
  return trimToLimit(placed)
}
```

Replace the body of `planCues`:

```ts
export function planCues(
  dropsMs: number[],
  beatsMs: number[],
  strong: StrongPart[] = [],
): PlannedCue[] {
  return evaluateFlow(MY_FLOW, { beats: beatsMs, drops: dropsMs, strong, phrases: [] }).cues.map(
    (c) => ({ ms: c.ms, kind: c.rule === 0 ? (c.bars as 16 | 32 | 48) : 'inicio' }),
  )
}
```

`TRIM_ORDER` is now unused by `cueRules.ts`; `rg -n "TRIM_ORDER" $WT/apps/desktop/src`: if nothing else uses it, delete the constant. `DISTANCES` stays (`classify` uses it).

- [ ] **Step 4: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueRules.test.ts src/shared/cueRulesFlows.test.ts src/shared/cueRulesParity.test.ts src/shared/cueFlows.test.ts`
Expected: PASS, with `cueRules.test.ts` byte for byte as it was (`git -C $WT diff --stat apps/desktop/src/shared/cueRules.test.ts` is empty). Both `tsc`, `check`: clean; status only the three files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/cueRules.ts apps/desktop/src/shared/cueRulesFlows.test.ts apps/desktop/src/shared/cueRulesParity.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Plan cues with a generic flow engine that runs Mi flujo exactly as rules.py"
```

---

### Task 3: Wanted sets and an ID diff, with `cueChanges` on them

**Files:**
- Modify: `src/shared/cueRules.ts`
- Test: `src/shared/cueRulesFlows.test.ts`, `src/shared/cueRulesParity.test.ts`
- Untouched and must pass: `src/shared/cueRules.test.ts`

**Interfaces:**
- Consumes: `evaluateFlow`, `FlowPlan`, `ruleColor` (Task 2); `CueFlow`, `FlowPhrase`, `MY_FLOW` (Task 1).
- Produces (exported from `src/shared/cueRules.ts`):
  - `interface WantedCue { id?: string; ms: number; kind: number; color: number | null }` (kind 0 = CALL)
  - `CueChangeSet.update` becomes `{ id: string; kind: number; color: number | null; ms?: number }[]` (`ms` only when the cue moved)
  - `DrawnHotCue.color` becomes `number | null`
  - `interface FlowInput { existing: ExistingCue[]; drops: number[]; previousDrops: number[]; beats: number[]; strong: StrongPart[]; phrases: FlowPhrase[]; flow: CueFlow; previousFlow?: CueFlow }`
  - `type FlowOutcome = { status: 'plan'; wanted: WantedCue[]; hot: DrawnHotCue[]; trimmed: number[] } | { status: 'manual'; wanted: WantedCue[] } | { status: 'too-many'; needed: number }`
  - `flowOutcome(input: FlowInput): FlowOutcome`
  - `diffCues(existing: ExistingCue[], wanted: WantedCue[]): CueChangeSet`
  - `cueChanges` keeps its signature and result (removes compared as a set; no consumer depends on their order).

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/cueRulesFlows.test.ts` (extend the imports with `CALLS_ONLY`, `ONE_AT_32`, `diffCues`, `type ExistingCue`, `flowOutcome`):

```ts
const outcome = (over: Partial<Parameters<typeof flowOutcome>[0]> = {}) =>
  flowOutcome({
    existing: [],
    drops: [beat(64)],
    previousDrops: [],
    beats: grid(200),
    strong: [],
    phrases: [],
    flow: MY_FLOW,
    ...over,
  })

describe('flowOutcome', () => {
  it('pairs no CALL with the hot cue of a flow that places only a hot cue', () => {
    expect(outcome({ flow: ONE_AT_32 })).toEqual({
      status: 'plan',
      wanted: [
        { ms: beat(64), kind: 0, color: null },
        { ms: beat(32), kind: 1, color: 22 },
      ],
      hot: [{ ms: beat(32), kind: 1, color: 22 }],
      trimmed: [],
    })
  })

  it('leaves only the CALL of the drop with Solo CALL', () => {
    expect(outcome({ flow: CALLS_ONLY })).toEqual({
      status: 'plan',
      wanted: [{ ms: beat(64), kind: 0, color: null }],
      hot: [],
      trimmed: [],
    })
  })

  it('keeps the rekordbox ID of every cue it keeps, so saving is a diff by identity', () => {
    const existing: ExistingCue[] = [
      { id: 'h', ms: beat(48), kind: 5, color: 1 },
      { id: 'p', ms: beat(48), kind: 0, color: null },
      { id: 'd', ms: beat(64), kind: 0, color: 0 },
    ]
    const out = outcome({ existing, previousDrops: [beat(64)] })
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.wanted.filter((w) => w.id !== undefined)).toEqual([
      { id: 'p', ms: beat(48), kind: 0, color: null },
      { id: 'd', ms: beat(64), kind: 0, color: 0 },
      { id: 'h', ms: beat(48), kind: 3, color: 1 },
    ])
  })

  it('lists the hot cues the 8 limit leaves out, so the user sees which ones', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    const out = outcome({ drops, beats: grid(400) })
    expect(out.status === 'plan' && out.trimmed).toEqual([beat(0)])
  })

  it('counts cues of the flow that generated the draft as fitting when switching flows', () => {
    const fromMine = outcome()
    if (fromMine.status !== 'plan') throw new Error(fromMine.status)
    const existing = fromMine.wanted.map((w, i) => ({ ...w, id: `e${i}` }))
    const switched = outcome({
      existing,
      previousDrops: [beat(64)],
      flow: ONE_AT_32,
      previousFlow: MY_FLOW,
    })
    expect(switched.status).toBe('plan')
    expect(switched.status === 'plan' && switched.hot).toEqual([{ ms: beat(32), kind: 1, color: 22 }])
  })
})

describe('diffCues', () => {
  const existing: ExistingCue[] = [
    { id: 'a', ms: beat(16), kind: 1, color: 1 },
    { id: 'b', ms: beat(16), kind: 0, color: null },
    { id: 'c', ms: beat(64), kind: 0, color: null },
  ]

  it('moves a kept cue in place instead of deleting and inserting it', () => {
    expect(
      diffCues(existing, [
        { id: 'a', ms: beat(20), kind: 1, color: 1 },
        { id: 'b', ms: beat(20), kind: 0, color: null },
        { id: 'c', ms: beat(64), kind: 0, color: null },
      ]),
    ).toEqual({
      insert: [],
      update: [
        { id: 'a', kind: 1, color: 1, ms: beat(20) },
        { id: 'b', kind: 0, color: null, ms: beat(20) },
      ],
      remove: [],
    })
  })

  it('inserts cues without an ID and removes the rekordbox cues the set left out', () => {
    expect(
      diffCues(existing, [
        { id: 'c', ms: beat(64), kind: 0, color: null },
        { ms: beat(48), kind: 1, color: 22 },
      ]),
    ).toEqual({ insert: [{ ms: beat(48), kind: 1, color: 22 }], update: [], remove: ['a', 'b'] })
  })

  it('writes a new letter or colour without a position when the cue did not move', () => {
    expect(diffCues(existing, [{ id: 'a', ms: beat(16), kind: 2, color: 42 }]).update).toEqual([
      { id: 'a', kind: 2, color: 42 },
    ])
  })
})
```

Append to `src/shared/cueRulesParity.test.ts` (extend the imports with `cueChanges`, `type CueOutcome`, `type ExistingCue`, `fitsPlan`, `HOT_KINDS`):

```ts
const LEGACY_COLOR: Record<16 | 32 | 48 | 'inicio', number> = { 16: 1, 32: 22, 48: 42, inicio: 32 }
const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME

function legacyCueChanges(
  existing: ExistingCue[],
  drops: number[],
  previousDrops: number[],
  beats: number[],
  strong: StrongPart[],
): CueOutcome {
  const hot = existing.filter((c) => c.kind !== 0)
  const memory = existing.filter((c) => c.kind === 0)
  const wantedDrops = [...new Set(drops)].sort((a, b) => a - b)
  const currentDrops = memory.filter((m) => hot.every((h) => !near(m.ms, h.ms)))
  const changes = {
    insert: wantedDrops
      .filter((ms) => !memory.some((m) => near(m.ms, ms)))
      .map((ms) => ({ ms, kind: 0, color: null as number | null })),
    update: [] as { id: string; kind: number; color: number }[],
    remove: currentDrops.filter((m) => !wantedDrops.some((d) => near(d, m.ms))).map((m) => m.id),
  }
  const plan = legacyPlanCues(wantedDrops, beats, strong)
  const oldPlan = legacyPlanCues(previousDrops, beats, strong)
  const fits = hot.every((h) => fitsPlan([h.ms], plan) || fitsPlan([h.ms], oldPlan))
  if (!fits) return { status: 'manual', changes }
  const wanted: PlannedCue[] = [
    ...plan,
    ...hot
      .filter((h) => h.ms < 3000 && plan.every((p) => !near(h.ms, p.ms)))
      .map((h) => ({ ms: h.ms, kind: 'inicio' as const })),
  ].sort((a, b) => a.ms - b.ms)
  if (wanted.length > 8) return { status: 'too-many', needed: wanted.length }
  const used = new Set<string>()
  const drawn = wanted.map((w, i) => {
    const kind = HOT_KINDS[i]
    const color = LEGACY_COLOR[w.kind]
    const there = hot.find((h) => !used.has(h.id) && near(h.ms, w.ms))
    if (there) {
      used.add(there.id)
      if (there.kind !== kind || there.color !== color)
        changes.update.push({ id: there.id, kind, color })
    } else changes.insert.push({ ms: w.ms, kind, color })
    if (
      !memory.some((m) => near(m.ms, w.ms)) &&
      !changes.insert.some((c) => c.kind === 0 && near(c.ms, w.ms))
    )
      changes.insert.push({ ms: w.ms, kind: 0, color: null })
    return { ms: there ? there.ms : w.ms, kind, color }
  })
  for (const h of hot) {
    if (used.has(h.id)) continue
    changes.remove.push(h.id)
    const pairedMemory = memory.find(
      (m) =>
        near(m.ms, h.ms) &&
        !changes.remove.includes(m.id) &&
        !wantedDrops.some((d) => near(d, m.ms)),
    )
    if (pairedMemory) changes.remove.push(pairedMemory.id)
  }
  return { status: 'plan', changes, hot: drawn }
}

function randomExisting(
  r: () => number,
  beats: number[],
  previousDrops: number[],
  strong: StrongPart[],
  pick: () => number,
): ExistingCue[] {
  const out: ExistingCue[] = []
  let n = 0
  const id = (): string => `e${n++}`
  if (r() < 0.7)
    legacyPlanCues(previousDrops, beats, strong).forEach((p, i) => {
      if (r() < 0.85)
        out.push({ id: id(), ms: p.ms, kind: HOT_KINDS[i] ?? 9, color: r() < 0.9 ? LEGACY_COLOR[p.kind] : 1 })
      if (r() < 0.85) out.push({ id: id(), ms: p.ms, kind: 0, color: null })
    })
  for (const d of previousDrops) if (r() < 0.9) out.push({ id: id(), ms: d, kind: 0, color: r() < 0.9 ? null : 0 })
  if (r() < 0.2) out.push({ id: id(), ms: pick(), kind: [1, 2, 3, 5][Math.floor(r() * 4)], color: r() < 0.5 ? null : 1 })
  if (r() < 0.2) out.push({ id: id(), ms: Math.floor(r() * 3000), kind: 1, color: 32 })
  if (out.length > 0 && r() < 0.1) out.push({ ...out[Math.floor(r() * out.length)], id: id() })
  return out
}

const removalsAsSet = (o: CueOutcome): CueOutcome =>
  o.status === 'too-many' ? o : { ...o, changes: { ...o.changes, remove: [...o.changes.remove].sort() } }

describe('Mi flujo through wanted sets against the frozen cueChanges', () => {
  it('changes exactly what cues.py completar changed in 3000 random collections', () => {
    const r = prng(19102026)
    for (let i = 0; i < 3000; i++) {
      const { beats, drops: previousDrops, strong, pick } = randomTrack(r)
      const existing = randomExisting(r, beats, previousDrops, strong, pick)
      const drops = [
        ...previousDrops.filter(() => r() < 0.7),
        ...Array.from({ length: Math.floor(r() * 3) }, pick),
      ]
      expect(removalsAsSet(cueChanges(existing, drops, previousDrops, beats, strong)), `case ${i}`).toEqual(
        removalsAsSet(legacyCueChanges(existing, drops, previousDrops, beats, strong)),
      )
    }
  })
})
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueRulesFlows.test.ts src/shared/cueRulesParity.test.ts`
Expected: FAIL, `flowOutcome` and `diffCues` are not exported.

- [ ] **Step 3: Implement**

In `src/shared/cueRules.ts`:

Change the change-set types:

```ts
export interface CueChangeSet {
  insert: { ms: number; kind: number; color: number | null }[]
  update: { id: string; kind: number; color: number | null; ms?: number }[]
  remove: string[]
}

export interface DrawnHotCue {
  ms: number
  kind: number
  color: number | null
}

export interface WantedCue {
  id?: string
  ms: number
  kind: number
  color: number | null
}
```

Replace the body of `cueChanges` and add the two new functions:

```ts
export interface FlowInput {
  existing: ExistingCue[]
  drops: number[]
  previousDrops: number[]
  beats: number[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
  flow: CueFlow
  previousFlow?: CueFlow
}

export type FlowOutcome =
  | { status: 'plan'; wanted: WantedCue[]; hot: DrawnHotCue[]; trimmed: number[] }
  | { status: 'manual'; wanted: WantedCue[] }
  | { status: 'too-many'; needed: number }

const keep = (c: ExistingCue): WantedCue => ({ id: c.id, ms: c.ms, kind: c.kind, color: c.color })

export function flowOutcome(input: FlowInput): FlowOutcome {
  const { existing, beats, strong, phrases, flow } = input
  const hot = existing.filter((c) => c.kind !== 0)
  const memory = existing.filter((c) => c.kind === 0)
  const wantedDrops = [...new Set(input.drops)].sort((a, b) => a - b)
  const currentDrops = memory.filter((m) => hot.every((h) => !near(m.ms, h.ms)))
  const removed = new Set(
    currentDrops.filter((m) => !wantedDrops.some((d) => near(d, m.ms))).map((m) => m.id),
  )
  const added: WantedCue[] = wantedDrops
    .filter((ms) => !memory.some((m) => near(m.ms, ms)))
    .map((ms) => ({ ms, kind: 0, color: null }))
  const plan = evaluateFlow(flow, { beats, drops: wantedDrops, strong, phrases })
  const oldPlan = evaluateFlow(input.previousFlow ?? flow, {
    beats,
    drops: input.previousDrops,
    strong,
    phrases,
  })
  const hotOf = (p: FlowPlan) => p.cues.filter((c) => c.place !== 'call')
  const fits = hot.every((h) => fitsPlan([h.ms], hotOf(plan)) || fitsPlan([h.ms], hotOf(oldPlan)))
  if (!fits)
    return {
      status: 'manual',
      wanted: [...memory.filter((m) => !removed.has(m.id)).map(keep), ...added, ...hot.map(keep)],
    }

  const start = flow.rules.find((r) => r.from === 'first-beat')
  const planned = [
    ...hotOf(plan).map((c) => ({ ms: c.ms, color: c.color, paired: c.place === 'both' })),
    ...hot
      .filter((h) => h.ms < START_MS && hotOf(plan).every((p) => !near(h.ms, p.ms)))
      .map((h) => ({
        ms: h.ms,
        color: start ? ruleColor(start, 1) : h.color,
        paired: start?.place === 'both',
      })),
  ].sort((a, b) => a.ms - b.ms)
  if (planned.length > MAX_HOT_CUES) return { status: 'too-many', needed: planned.length }

  const used = new Set<string>()
  const placed: WantedCue[] = []
  const drawn: DrawnHotCue[] = planned.map((w, i) => {
    const kind = HOT_KINDS[i]
    const there = hot.find((h) => !used.has(h.id) && near(h.ms, w.ms))
    if (there) used.add(there.id)
    placed.push(there ? { id: there.id, ms: there.ms, kind, color: w.color } : { ms: w.ms, kind, color: w.color })
    if (
      w.paired &&
      !memory.some((m) => near(m.ms, w.ms)) &&
      ![...added, ...placed].some((c) => c.id === undefined && c.kind === 0 && near(c.ms, w.ms))
    )
      placed.push({ ms: w.ms, kind: 0, color: null })
    return { ms: there ? there.ms : w.ms, kind, color: w.color }
  })
  for (const h of hot) {
    if (used.has(h.id)) continue
    removed.add(h.id)
    const pairedMemory = memory.find(
      (m) => near(m.ms, h.ms) && !removed.has(m.id) && !wantedDrops.some((d) => near(d, m.ms)),
    )
    if (pairedMemory) removed.add(pairedMemory.id)
  }
  return {
    status: 'plan',
    wanted: [...memory.filter((m) => !removed.has(m.id)).map(keep), ...added, ...placed],
    hot: drawn,
    trimmed: plan.trimmed.map((c) => c.ms),
  }
}

export function diffCues(existing: ExistingCue[], wanted: WantedCue[]): CueChangeSet {
  const byId = new Map(existing.map((c) => [c.id, c]))
  const kept = new Set<string>()
  const changes: CueChangeSet = { insert: [], update: [], remove: [] }
  for (const w of wanted) {
    const was = w.id === undefined ? undefined : byId.get(w.id)
    if (!was) {
      changes.insert.push({ ms: w.ms, kind: w.kind, color: w.color })
      continue
    }
    kept.add(was.id)
    if (was.ms !== w.ms) changes.update.push({ id: was.id, kind: w.kind, color: w.color, ms: w.ms })
    else if (was.kind !== w.kind || was.color !== w.color)
      changes.update.push({ id: was.id, kind: w.kind, color: w.color })
  }
  changes.remove = existing.filter((c) => !kept.has(c.id)).map((c) => c.id)
  return changes
}

export function cueChanges(
  existing: ExistingCue[],
  drops: number[],
  previousDrops: number[],
  beats: number[],
  strong: StrongPart[],
): CueOutcome {
  const out = flowOutcome({ existing, drops, previousDrops, beats, strong, phrases: [], flow: MY_FLOW })
  if (out.status === 'too-many') return out
  const changes = diffCues(existing, out.wanted)
  return out.status === 'manual'
    ? { status: 'manual', changes }
    : { status: 'plan', changes, hot: out.hot }
}
```

`COLOR_BY_KIND` is now unused inside `cueRules.ts`: `rg -n "COLOR_BY_KIND" $WT/apps/desktop/src` and delete it if nothing else imports it. `CueWave.tsx` types its `hot` prop as `Omit<DrawnHotCue, 'color'> & { color: number | null; pending: boolean }`; that still type-checks.

- [ ] **Step 4: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared src/main/rekordboxQueueCues.test.ts src/main/rekordboxCompleteOnClose.test.ts src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.dedupe.test.tsx`
Expected: PASS, `cueRules.test.ts` untouched. If the parity test reports a case, fix `flowOutcome` or `diffCues`, never the frozen copy. Both `tsc`, `check`: clean; status only the three files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/cueRules.ts apps/desktop/src/shared/cueRulesFlows.test.ts apps/desktop/src/shared/cueRulesParity.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Turn a flow into the cues a track wants and diff them by rekordbox ID"
```

---

### Task 4: Moves in the change writer

**Files:**
- Modify: `src/main/rekordboxCues.ts` (`applyCueChanges`, `changedEntries`)
- Test: `src/main/rekordboxCues.test.ts`

**Interfaces:**
- Consumes: `CueChangeSet.update[].ms?` (Task 3).
- Produces: `applyCueChanges` writes `InMsec` and `InFrame` (floor(ms × 150 / 1000)) of an updated row when `ms` is set, in `djmdCue` and in the `contentCue` JSON entry; the row keeps its `ID`, takes `rb_local_usn` and `updated_at` as any update. The count it returns is unchanged (one per row).

- [ ] **Step 1: Write the failing tests**

In `src/main/rekordboxCues.test.ts`, inside `describe('applyCueChanges')`, add:

```ts
  it('moves a cue in place, keeping its row so rekordbox keeps its identity', async () => {
    const db = await writable()
    db.prepare(
      `INSERT INTO contentCue (ID, ContentID, Cues, rb_cue_count) VALUES ('uuid-c-103', '103', ?, 1)`,
    ).run(JSON.stringify([{ ID: 'q2', Kind: 1, InMsec: 8000, InFrame: 1200 }]))
    expect(
      applyCueChanges(
        db,
        '103',
        { insert: [], update: [{ id: 'q2', kind: 1, color: 1, ms: 12000 }], remove: [] },
        { now: NOW },
      ),
    ).toBe(1)
    expect(
      db
        .prepare(`SELECT InMsec, InFrame, Kind, ColorTableIndex, updated_at FROM djmdCue WHERE ID = 'q2'`)
        .get(),
    ).toEqual({ InMsec: 12000, InFrame: 1800, Kind: 1, ColorTableIndex: 1, updated_at: STAMP })
    const cc = db.prepare(`SELECT Cues FROM contentCue WHERE ContentID = '103'`).get() as {
      Cues: string
    }
    expect(JSON.parse(cc.Cues)).toEqual([
      { ID: 'q2', Kind: 1, InMsec: 12000, InFrame: 1800, updated_at: '2026-10-18T19:00:00.000+00:00' },
    ])
    db.close()
  })

  it('leaves the position alone when only the letter changes', async () => {
    const db = await writable()
    applyCueChanges(
      db,
      '103',
      { insert: [], update: [{ id: 'q2', kind: 3, color: 1 }], remove: [] },
      { now: NOW },
    )
    expect(db.prepare(`SELECT InMsec, InFrame FROM djmdCue WHERE ID = 'q2'`).get()).toMatchObject({
      InMsec: 8000,
    })
    db.close()
  })
```

(The fixture inserts `q2` without an `InFrame`; the second test asserts only `InMsec` for that reason.)

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxCues.test.ts`
Expected: FAIL on the first, `InMsec` still 8000.

- [ ] **Step 3: Implement**

In `src/main/rekordboxCues.ts`:

```ts
const frameOf = (ms: number): number => Math.floor((ms * 150) / 1000)
```

Use it for `InFrame` in the insert row. In `changedEntries`, inside the update loop after `e.Kind = u.kind`:

```ts
      if (u.ms !== undefined) {
        e.InMsec = u.ms
        e.InFrame = frameOf(u.ms)
      }
```

In `applyCueChanges`, after the `update` statement:

```ts
  const move = db.prepare('UPDATE djmdCue SET InMsec = ?, InFrame = ? WHERE ID = ? AND ContentID = ?')
  for (const u of changes.update) {
    update.run(u.kind, u.color, takeLocalUsn(db, stamp), stamp, u.id, contentId)
    if (u.ms !== undefined) move.run(u.ms, frameOf(u.ms), u.id, contentId)
  }
```

(replacing the one-line `for` that only ran `update`).

- [ ] **Step 4: Run tests, types, lint**

`src/main/rekordboxCues.test.ts` and `src/main/rekordboxQueueCues.test.ts`: PASS. Both `tsc`, `check`: clean; status only the two files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/main/rekordboxCues.ts apps/desktop/src/main/rekordboxCues.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Move a rekordbox cue in place instead of deleting and adding it"
```

---

### Task 5: Phrases in the track read

**Files:**
- Modify: `src/main/rekordboxCues.ts` (`analyse`, `readTrackCues`), `src/shared/types.ts` (`TrackCues`)
- Test: `src/main/rekordboxCues.test.ts`, plus every test building a `TrackCues` literal (tsc lists them: `CuesSection.test.tsx`, `CuesSection.dedupe.test.tsx`)

**Interfaces:**
- Consumes: `phraseKindOf`, `FlowPhrase` (Task 1); `phrases` from `anlz.ts` (exists).
- Produces: `TrackCues.phrases: FlowPhrase[]` (ms of the phrase's first beat on the grid, its kind; phrases beyond the grid or of unknown kind left out; `[]` without `.EXT`, without `PSSI` or unanalysed).

- [ ] **Step 1: Write the failing test**

In `src/main/rekordboxCues.test.ts`, in `'reads the grid, the strong parts, the cues and the colour waveform'`, add to the expectations:

```ts
    expect(read?.phrases).toEqual([
      { ms: 0, kind: 'intro' },
      { ms: 16000, kind: 'chorus' },
    ])
```

and add:

```ts
  it('reads no phrases for a track without an .EXT, so flows counting from phrases place nothing', async () => {
    const { db, share } = await collection({ ext: null })
    expect(readTrackCues(db, share, '103')?.phrases).toEqual([])
    db.close()
  })
```

(Use the read variable name the existing test uses; the fixture's `PSSI` is mood 1 with kinds 1 at beat 1 and 5 at beat 33, and beats are every 500 ms.)

- [ ] **Step 2: Run, see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxCues.test.ts`
Expected: FAIL, `phrases` undefined.

- [ ] **Step 3: Implement**

`src/shared/types.ts`: add `import type { FlowPhrase } from './cueFlows'` and `phrases: FlowPhrase[]` to `TrackCues` after `strong`.

`src/main/rekordboxCues.ts`: import `phraseKindOf` and `type FlowPhrase` from `'../shared/cueFlows'`; `Analysis` gains `phrases: FlowPhrase[]`; in `analyse`, after `strong`:

```ts
  const phraseList: FlowPhrase[] = sections
    ? sections.entries.flatMap((p) => {
        const kind = phraseKindOf(sections.mood, p.kind)
        const at = grid[p.beat - 1]
        return kind && at ? [{ ms: at.ms, kind }] : []
      })
    : []
```

and return `phrases: phraseList` in both returns of `analyse`. In `readTrackCues`, the unanalysed return gains `phrases: []`.

Give every `TrackCues` literal in tests `phrases: []`.

- [ ] **Step 4: Run tests, types, lint**

`src/main/rekordboxCues.test.ts`, `src/main/rekordboxQueueCues.test.ts`, `src/main/rekordboxCompleteOnClose.test.ts`, `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.dedupe.test.tsx`: PASS. Both `tsc`, `check`: clean; status only these files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/main/rekordboxCues.ts apps/desktop/src/main/rekordboxCues.test.ts apps/desktop/src/shared/types.ts apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.dedupe.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Read rekordbox phrases with a track's cues so flows can count from them"
```

---

### Task 6: Flows in the settings

**Files:**
- Modify: `src/shared/types.ts` (`Settings`), `src/main/settings.ts` (`defaults`, `mergeSettings`), `src/renderer/src/lib/settingsDraft.ts` (`SyncedDraft`, `pickSynced`), `src/renderer/src/lib/settingsContext.tsx` (`ResolvedSettings`, `DEFAULTS`, `resolveSettings`), `src/renderer/src/test/api.ts` (default settings)
- Test: `src/main/settings.test.ts`, `src/main/exportSettings.test.ts`, `src/renderer/src/lib/settingsDraft.test.ts` (its `settings` literal gains the two keys)

**Interfaces:**
- Consumes: `CueFlow`, `BUNDLED_FLOWS`, `MY_FLOW_ID`, `normalizeCueFlows` (Task 1).
- Produces: `Settings.cueFlows: CueFlow[]`, `Settings.activeCueFlow: string`; the same two keys in `SyncedDraft` and in `useAppSettings()` (`cueFlows` normalised, `activeCueFlow` a string). Consumers resolve the flow with `activeCueFlow({ cueFlows, activeCueFlow })` from `shared/cueFlows`.

- [ ] **Step 1: Write the failing tests**

In `src/main/settings.test.ts` add:

```ts
describe('cue flows', () => {
  it('gives a settings file from before flows the bundled ones with Mi flujo active', () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), JSON.stringify({}))
    expect(getSettings().cueFlows.map((f) => f.id)).toEqual(['mine', 'one-at-32', 'calls-only'])
    expect(getSettings().activeCueFlow).toBe('mine')
  })

  it('puts Mi flujo back into a synced file that lost it, so the section always has a flow', () => {
    writeFileSync(
      join(app.getPath('userData'), 'settings.json'),
      JSON.stringify({ cueFlows: [{ id: 'x', name: 'Solo 64', rules: [] }], activeCueFlow: 'x' }),
    )
    expect(getSettings().cueFlows.map((f) => f.id)).toEqual(['mine', 'x'])
    expect(getSettings().activeCueFlow).toBe('x')
  })

  it('follows the person to another Mac like the cue offset, not this Mac only', () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), JSON.stringify({}))
    const dir = mkdtempSync(join(tmpdir(), 'surco-sync-'))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({}))
    setConfigDir(dir)
    saveSettings({ activeCueFlow: 'one-at-32' })
    const synced = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))
    expect(synced.activeCueFlow).toBe('one-at-32')
    setConfigDir(null)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

In `src/main/exportSettings.test.ts` add (import `applyImportedSettings` from `./exportIpc`, `getSettings` from `./settings` and `type CueFlow` from `'../shared/cueFlows'`):

```ts
  it('carries a flow the DJ built to another install and back', () => {
    const flow: CueFlow = {
      id: 'x',
      name: 'Una a 64',
      rules: [
        {
          from: 'drop',
          direction: 'back',
          bars: 64,
          repeat: 1,
          when: 'fits',
          place: 'hot',
          color: { fixed: 42 },
        },
      ],
    }
    saveSettings({ cueFlows: [...getSettings().cueFlows, flow], activeCueFlow: 'x' })
    const exported = JSON.parse(serializeSettingsForExport())
    saveSettings({ cueFlows: [], activeCueFlow: 'mine' })
    const back = applyImportedSettings(exported)
    expect(back.cueFlows.find((f) => f.id === 'x')).toEqual(flow)
    expect(back.activeCueFlow).toBe('x')
  })
```

In `src/renderer/src/lib/settingsDraft.test.ts`, add `cueFlows: BUNDLED_FLOWS, activeCueFlow: 'mine'` to the `settings` literal (import `BUNDLED_FLOWS` from `../../../shared/cueFlows`) and:

```ts
  it('saves the flows and the active flow the Cues tab staged', () => {
    const synced = { ...pickSynced(settings), activeCueFlow: 'calls-only' }
    expect(buildSettingsPatch(synced, local).activeCueFlow).toBe('calls-only')
    expect(buildSettingsPatch(synced, local).cueFlows).toBe(settings.cueFlows)
  })
```

(use the `LocalDraft` fixture the file already builds, under whatever name it has).

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/settings.test.ts src/main/exportSettings.test.ts src/renderer/src/lib/settingsDraft.test.ts`
Expected: FAIL, `cueFlows` undefined.

- [ ] **Step 3: Implement**

`src/shared/types.ts`, in `Settings` after `completeCuesOnClose`:

```ts
  cueFlows: CueFlow[]
  activeCueFlow: string
```

(add `CueFlow` to the `import type` from `./cueFlows`).

`src/main/settings.ts`: import `BUNDLED_FLOWS`, `MY_FLOW_ID`, `normalizeCueFlows` from `'../shared/cueFlows'`; in `defaults` after `completeCuesOnClose: false,` add `cueFlows: BUNDLED_FLOWS,` and `activeCueFlow: MY_FLOW_ID,`; in `mergeSettings` add:

```ts
    cueFlows: normalizeCueFlows(patch.cueFlows ?? base.cueFlows),
    activeCueFlow:
      typeof patch.activeCueFlow === 'string' ? patch.activeCueFlow : base.activeCueFlow,
```

Neither key goes in `LOCAL_KEYS`.

`src/renderer/src/lib/settingsDraft.ts`: `SyncedDraft` gains `cueFlows: Settings['cueFlows']` and `activeCueFlow: string`; `pickSynced` copies both (`cueFlows: s.cueFlows, activeCueFlow: s.activeCueFlow`). `buildSettingsPatch` carries them through `...rest`.

`src/renderer/src/lib/settingsContext.tsx`: `ResolvedSettings` gains `cueFlows: CueFlow[]` and `activeCueFlow: string`; `DEFAULTS` gets `cueFlows: BUNDLED_FLOWS, activeCueFlow: MY_FLOW_ID`; `resolveSettings` returns `cueFlows: normalizeCueFlows(settings.cueFlows)` and `activeCueFlow: settings.activeCueFlow ?? DEFAULTS.activeCueFlow`.

`src/renderer/src/test/api.ts`: the default settings object gains `cueFlows: BUNDLED_FLOWS, activeCueFlow: 'mine'`.

- [ ] **Step 4: Run tests, types, lint**

The three files plus `src/renderer/src/components/SettingsModal.test.tsx` and `src/renderer/src/hooks/useSettings.test.tsx`: PASS. Both `tsc` (every other `Settings` literal tsc names gets the two keys), `check`: clean; status only these files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/types.ts apps/desktop/src/main/settings.ts apps/desktop/src/main/settings.test.ts apps/desktop/src/main/exportSettings.test.ts apps/desktop/src/renderer/src/lib/settingsDraft.ts apps/desktop/src/renderer/src/lib/settingsDraft.test.ts apps/desktop/src/renderer/src/lib/settingsContext.tsx apps/desktop/src/renderer/src/test/api.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Keep the DJ's cue flows and the active one in the synced settings"
```

(Add any other file tsc made you touch.)

---

### Task 7: The `cues` operation carries the wanted set

**Files:**
- Modify: `src/shared/types.ts` (`SaveCuesRequest`), `src/main/rekordboxQueueOps.ts` (`CuesOp`), `src/main/rekordboxPlaylistWrite.ts` (`planCuesOp`), `src/main/rekordboxCuesIpc.ts` (`rekordbox:queuedCues`), `src/preload/index.ts`, `src/preload/api.ts`, `src/scenarios/harness.tsx`, `src/renderer/src/test/api.ts`, `src/renderer/src/hooks/useTrackCues.ts` (`useQueuedCues`), `src/renderer/src/components/CuesSection.tsx` (bridge until Task 12)
- Test: `src/main/rekordboxQueueCues.test.ts`, `src/main/rekordboxCuesIpc.test.ts`, `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.dedupe.test.tsx`

**Interfaces:**
- Consumes: `WantedCue`, `flowOutcome`, `diffCues`, `isEmptyChange`, `MAX_HOT_CUES` (Task 3); `MY_FLOW` (Task 1); `TrackCues.phrases` (Task 5).
- Produces:
  - `SaveCuesRequest = { contentId: string; path: string; label: string; wanted: WantedCue[]; fingerprint: string }`
  - `CuesOp = Omit<SaveCuesRequest, 'wanted'> & { id: string; kind: 'cues'; wanted?: WantedCue[]; drops?: number[]; previousDrops?: number[] }` (`drops`/`previousDrops` only on ops a previous build persisted)
  - `window.api.rekordboxQueuedCues(contentId): Promise<WantedCue[] | null>`
  - `useQueuedCues(contentId): { data: WantedCue[] | null | undefined }`
  - Apply rules: fingerprint differs or track no longer analysed → `cues-changed`; more than 8 hot cues wanted → `cues-too-many`; empty diff → applied without writing; else `applyCueChanges(diffCues(read.cues, wanted))`.

- [ ] **Step 1: Write the failing tests**

In `src/main/rekordboxQueueCues.test.ts`, replace the `op` helper and add a wanted set (import `HOT_KINDS` and `type WantedCue` from `'../shared/cueRules'`):

```ts
const COUNTDOWN: WantedCue[] = [
  { ms: bar(64), kind: 0, color: null },
  { ms: bar(16), kind: 1, color: 42 },
  { ms: bar(16), kind: 0, color: null },
  { ms: bar(32), kind: 2, color: 22 },
  { ms: bar(32), kind: 0, color: null },
  { ms: bar(48), kind: 3, color: 1 },
  { ms: bar(48), kind: 0, color: null },
]

const op = (path: string, over: Partial<CuesOp> = {}): CuesOp => ({
  id: 'c',
  kind: 'cues',
  contentId: '103',
  path: '/Volumes/Public/Music/Gowan.wav',
  label: 'Gowan',
  wanted: COUNTDOWN,
  fingerprint: fingerprintOf(path),
  ...over,
})
```

Keep the first four tests as they are. Replace the last three with:

```ts
  it('writes nothing and says so when the wanted set has more than 8 hot cues', async () => {
    const path = await collection()
    const wanted = Array.from({ length: 9 }, (_, i) => ({
      ms: bar(8 * i + 8),
      kind: HOT_KINDS[i] ?? 10,
      color: 1,
    }))
    const result = await applyRekordboxBatch(path, [op(path, { wanted })], deps())
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'cues-too-many', track: 'Gowan' },
    ])
    expect(cuesOf(path)).toEqual([])
  })

  it('moves a cue rekordbox already has instead of adding a second one', async () => {
    const path = await collection([
      { ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 },
      { ID: 'n', InMsec: bar(40), Kind: 0, ColorTableIndex: null },
    ])
    const wanted = [
      { id: 'm', ms: bar(44), kind: 1, color: 1 },
      { id: 'n', ms: bar(44), kind: 0, color: null },
    ]
    await applyRekordboxBatch(path, [op(path, { wanted })], deps())
    expect(cuesOf(path).map((c) => [c.id, c.ms, c.kind])).toEqual([
      ['n', bar(44), 0],
      ['m', bar(44), 1],
    ])
  })

  it('deletes the cues the wanted set leaves out', async () => {
    const path = await collection([
      { ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 },
      { ID: 'n', InMsec: bar(64), Kind: 0, ColorTableIndex: null },
    ])
    await applyRekordboxBatch(
      path,
      [op(path, { wanted: [{ id: 'n', ms: bar(64), kind: 0, color: null }] })],
      deps(),
    )
    expect(cuesOf(path).map((c) => c.id)).toEqual(['n'])
  })

  it('applies a wanted set that is already in rekordbox without asking to close it', async () => {
    const path = await collection()
    await applyRekordboxBatch(path, [op(path)], deps())
    const d = deps()
    const wanted = cuesOf(path).map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
    const result = await applyRekordboxBatch(path, [op(path, { wanted })], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: true, notices: [] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  it('still lands an operation the previous build queued with drops, as Mi flujo and never over manual work', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 }])
    const legacy = op(path, { wanted: undefined, drops: [bar(64)], previousDrops: [] })
    await applyRekordboxBatch(path, [legacy], deps())
    expect(cuesOf(path).map((c) => [c.ms, c.kind])).toEqual([
      [bar(40), 1],
      [bar(64), 0],
    ])
  })
```

(`cuesOf` sorts by `ms` then `kind`; the move test expects the CALL first at the same `ms`.)

In `src/main/rekordboxCuesIpc.test.ts`, the save test's `req` replaces `drops: [1000], previousDrops: []` with `wanted: [{ ms: 1000, kind: 0, color: null }]`, and the queued-cues test becomes:

```ts
  it('reports the cues queued for a track, or null when nothing waits or the save predates wanted sets', () => {
    const wanted = [{ ms: 1000, kind: 0, color: null }]
    const ops: Record<string, unknown> = {
      '103': { id: 'c1', wanted },
      '105': { id: 'c2', drops: [1000], previousDrops: [] },
    }
    registerRekordboxCuesIpc({
      collection: () => '/c/master.db',
      queue: { enqueue: vi.fn(), cuesOp: vi.fn((id: string) => ops[id]) as never, drop: vi.fn() },
      applyQuietly: vi.fn(),
    })
    expect(handler('rekordbox:queuedCues')({}, '103')).toEqual(wanted)
    expect(handler('rekordbox:queuedCues')({}, '104')).toBeNull()
    expect(handler('rekordbox:queuedCues')({}, '105')).toBeNull()
  })
```

In `CuesSection.test.tsx`, every `rekordboxQueuedCues` mock that returned drops (`number[]`) now returns the wanted set those drops produced: `[{ ms: bar(64), kind: 0, color: null }]` for a queued drop alone; assertions on `saveRekordboxCues` payloads expect `wanted` (use `expect.objectContaining({ contentId: '103', fingerprint: 'f0', wanted: expect.arrayContaining([{ ms: bar(64), kind: 0, color: null }]) })`) instead of `drops`/`previousDrops`.

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxQueueCues.test.ts src/main/rekordboxCuesIpc.test.ts`
Expected: FAIL, the op carries `wanted`, the writer still reads `drops`.

- [ ] **Step 3: Implement**

`src/shared/types.ts`: import `WantedCue` type from `./cueRules` (next to `StrongPart`); `SaveCuesRequest` replaces `drops` and `previousDrops` with `wanted: WantedCue[]`.

`src/main/rekordboxQueueOps.ts`:

```ts
export interface CuesOp extends Omit<SaveCuesRequest, 'wanted'> {
  id: string
  kind: 'cues'
  wanted?: WantedCue[]
  drops?: number[]
  previousDrops?: number[]
}
```

`src/main/rekordboxPlaylistWrite.ts` (imports: `diffCues`, `flowOutcome`, `isEmptyChange`, `MAX_HOT_CUES`, `type WantedCue` from `'../shared/cueRules'`; `MY_FLOW` from `'../shared/cueFlows'`; `type TrackCues` from `'../shared/types'`; drop `cueChanges` from the import if unused):

```ts
function wantedOf(op: CuesOp, read: TrackCues): WantedCue[] | null {
  if (op.wanted) return op.wanted
  const out = flowOutcome({
    existing: read.cues,
    drops: op.drops ?? [],
    previousDrops: op.previousDrops ?? [],
    beats: read.grid.map((b) => b.ms),
    strong: read.strong,
    phrases: read.phrases,
    flow: MY_FLOW,
  })
  return out.status === 'too-many' ? null : out.wanted
}

function planCuesOp(probe: Db, op: CuesOp, shareDir: string): Plan {
  const changed = (code: 'cues-changed' | 'cues-too-many'): Plan => ({
    outcome: { id: op.id, applied: false, notices: [{ code, track: op.label }] },
  })
  const read = readTrackCues(probe, shareDir, op.contentId, { wave: false })
  if (!read?.analysed || read.fingerprint !== op.fingerprint) return changed('cues-changed')
  const wanted = wantedOf(op, read)
  if (wanted === null || wanted.filter((c) => c.kind !== 0).length > MAX_HOT_CUES)
    return changed('cues-too-many')
  const cues = diffCues(read.cues, wanted)
  if (isEmptyChange(cues)) return { outcome: { id: op.id, applied: true, notices: [] } }
  return { op, cues }
}
```

`src/main/rekordboxCuesIpc.ts`: `'rekordbox:queuedCues'` returns `host.queue.cuesOp(contentId)?.wanted ?? null`.

`src/preload/index.ts` and `src/preload/api.ts`: `rekordboxQueuedCues` returns `Promise<WantedCue[] | null>`. `src/renderer/src/hooks/useTrackCues.ts`: `useQueuedCues` returns `{ data: WantedCue[] | null | undefined }`. `test/api.ts` and `scenarios/harness.tsx` stubs keep `async () => null`.

Bridge in `src/renderer/src/components/CuesSection.tsx` (rewritten in Task 12; this keeps today's behaviour through the new op):
- `queued: WantedCue[] | null`; the starting drops become `queued ? findDrops(queued.filter((c) => c.kind === 0).map((c) => c.ms), queued.filter((c) => c.kind !== 0).map((c) => c.ms)) : initial`.
- `const outcome = flowOutcome({ existing: read.cues, drops, previousDrops: initial, beats, strong: read.strong, phrases: read.phrases, flow: MY_FLOW })`; `const changes = outcome.status === 'too-many' ? null : diffCues(read.cues, outcome.wanted)`.
- `drawnHot` uses `outcome.status === 'plan'` as today; Save is disabled when `changes === null || (!dirty && isEmptyChange(changes))`; Save sends `{ contentId, path, label, wanted: outcome.wanted, fingerprint }` (only reachable when `outcome.status !== 'too-many'`).
- The `key` of `Marking` becomes `` `${read.fingerprint}|${JSON.stringify(queued)}` ``.

- [ ] **Step 4: Run tests, types, lint**

`src/main/rekordboxQueueCues.test.ts`, `src/main/rekordboxCuesIpc.test.ts`, `src/main/rekordboxQueue.test.ts`, `src/main/rekordboxQueueOps.test.ts`, `src/main/rekordboxCompleteOnClose.test.ts`, `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.dedupe.test.tsx`: PASS (`completableOps` still builds legacy-shaped ops until Task 8; that is allowed by the optional fields). Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxQueueOps.ts apps/desktop/src/main/rekordboxPlaylistWrite.ts apps/desktop/src/main/rekordboxCuesIpc.ts apps/desktop/src/main/rekordboxQueueCues.test.ts apps/desktop/src/main/rekordboxCuesIpc.test.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/scenarios/harness.tsx apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/renderer/src/hooks/useTrackCues.ts apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.dedupe.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Queue the complete set of cues a track wants and write its diff on close"
```

---

### Task 8: Complete on close with the active flow

**Files:**
- Modify: `src/main/rekordboxCompleteOnClose.ts`, `src/main/rekordboxCuesIpc.ts` (`countCompletable`), `src/main/index.ts` (wiring), `src/renderer/src/i18n/locales/*.json` (`settings.completeCues`, `settings.completeCuesHint`)
- Test: `src/main/rekordboxCompleteOnClose.test.ts`, `src/main/rekordboxCuesIpc.test.ts`

**Interfaces:**
- Consumes: `flowOutcome`, `diffCues`, `isEmptyChange`, `findDrops` (shared/cueRules); `CueFlow`, `activeCueFlow`, `MY_FLOW`, `ONE_AT_32`, `CALLS_ONLY` (Task 1); `CuesOp.wanted` (Task 7).
- Produces:
  - `completableOps(db: Db, shareDir: string, flow: CueFlow, newId?: () => string): CuesOp[]` (ops carry `wanted`, no `drops`)
  - `completeOnClose(deps: { enabled: () => boolean; collection: () => string; flow: () => CueFlow; queue: …; newId?: () => string }): void`
  - `registerRekordboxCuesIpc(host: { collection; queue; applyQuietly; flow: () => CueFlow })`
  - `index.ts` passes `flow: () => activeCueFlow(getSettings())` to both.

- [ ] **Step 1: Write the failing tests**

In `src/main/rekordboxCompleteOnClose.test.ts` (import `MY_FLOW`, `ONE_AT_32`, `CALLS_ONLY` from `'../shared/cueFlows'`), change the `completableOps` call to `completableOps(db, join(path, '../share'), MY_FLOW, () => 'op')` and its expectation to:

```ts
    expect(ops).toEqual([
      {
        id: 'op',
        kind: 'cues',
        contentId: '101',
        path: '/Volumes/Public/Music/Night Train.aiff',
        label: 'Night Train',
        wanted: [
          { id: '11', ms: 128000, kind: 0, color: null },
          { ms: 32000, kind: 1, color: 42 },
          { ms: 32000, kind: 0, color: null },
          { ms: 64000, kind: 2, color: 22 },
          { ms: 64000, kind: 0, color: null },
          { ms: 96000, kind: 3, color: 1 },
          { ms: 96000, kind: 0, color: null },
        ],
        fingerprint: '11|0|128000|',
      },
    ])
```

and add:

```ts
  it('completes with the flow the DJ chose, one green cue at 32 bars and no CALL under it', async () => {
    const path = await collection()
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    expect(completableOps(db, join(path, '../share'), ONE_AT_32, () => 'op')[0].wanted).toEqual([
      { id: '11', ms: 128000, kind: 0, color: null },
      { ms: 64000, kind: 1, color: 22 },
    ])
    db.close()
  })

  it('has nothing to complete with Solo CALL, since the drops already are the CALLs', async () => {
    const path = await collection()
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    expect(completableOps(db, join(path, '../share'), CALLS_ONLY)).toEqual([])
    db.close()
  })
```

Every `completeOnClose({...})` call in the file gains `flow: () => MY_FLOW`. In `rekordboxCuesIpc.test.ts` the host gains `flow: () => MY_FLOW`.

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxCompleteOnClose.test.ts src/main/rekordboxCuesIpc.test.ts`
Expected: FAIL, ops carry `drops`, not `wanted`.

- [ ] **Step 3: Implement**

`src/main/rekordboxCompleteOnClose.ts`:

```ts
import { diffCues, findDrops, flowOutcome, isEmptyChange } from '../shared/cueRules'
import type { CueFlow } from '../shared/cueFlows'
```

`completableOps(db, shareDir, flow, newId = randomUUID)`; inside the loop, replacing the `cueChanges` call and the push:

```ts
    const out = flowOutcome({
      existing: read.cues,
      drops,
      previousDrops: drops,
      beats: read.grid.map((b) => b.ms),
      strong: read.strong,
      phrases: read.phrases,
      flow,
    })
    if (out.status !== 'plan' || isEmptyChange(diffCues(read.cues, out.wanted))) continue
    ops.push({
      id: newId(),
      kind: 'cues',
      contentId,
      path: row.FolderPath,
      label: row.Title || row.FolderPath,
      wanted: out.wanted,
      fingerprint: read.fingerprint,
    })
```

`completeOnClose` deps gain `flow: () => CueFlow` and call `completableOps(db, rekordboxShareDir(path), deps.flow(), deps.newId)`.

`src/main/rekordboxCuesIpc.ts`: host gains `flow: () => CueFlow`; `countCompletable` calls `completableOps(db, rekordboxShareDir(path), host.flow()).length`.

`src/main/index.ts`: import `activeCueFlow` from `'../shared/cueFlows'`; add `flow: () => activeCueFlow(getSettings()),` to the `completeOnClose({...})` deps and to `registerRekordboxCuesIpc({...})`.

Locales: the option now applies the active flow. Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-t8.json`:

```json
{
  "es": { "settings": {
    "completeCues": "Al cerrar rekordbox, aplicar tu flujo activo en las pistas con donde rompe y sin hot cues",
    "completeCuesHint": "Escribe en tu colección, también en pistas que no has mirado en Surco. Apagado, tus cues solo se guardan desde la sección Cues."
  } },
  "en": { "settings": {
    "completeCues": "When rekordbox closes, apply your active flow to tracks with drops and no hot cues",
    "completeCuesHint": "It writes to your collection on tracks you have not looked at in Surco. Off, your cues are only saved from the Cues section."
  } },
  "de": { "settings": {
    "completeCues": "Beim Schließen von rekordbox deinen aktiven Ablauf auf Titel mit Drops und ohne Hot Cues anwenden",
    "completeCuesHint": "Schreibt in deine Sammlung, auch in Titel, die du in Surco nicht angesehen hast. Aus werden deine Cues nur im Abschnitt Cues gespeichert."
  } },
  "fr": { "settings": {
    "completeCues": "À la fermeture de rekordbox, appliquer ton flux actif aux morceaux avec drops et sans hot cues",
    "completeCuesHint": "Écrit dans ta collection, y compris sur des morceaux que tu n'as pas regardés dans Surco. Désactivé, tes cues ne s'enregistrent que depuis la section Cues."
  } },
  "pt-BR": { "settings": {
    "completeCues": "Ao fechar o rekordbox, aplicar seu fluxo ativo nas faixas com drops e sem hot cues",
    "completeCuesHint": "Grava na sua coleção, inclusive em faixas que você não viu no Surco. Desligado, seus cues só são salvos pela seção Cues."
  } }
}
```

and merge it with the Global Constraints helper.

- [ ] **Step 4: Run tests, types, lint**

The two test files plus `src/main/rekordboxQueueWatch.test.ts`, `src/renderer/src/components/settings/DestinationTab.test.tsx`, `src/renderer/src/i18n/index.test.ts`: PASS. Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/main/rekordboxCompleteOnClose.ts apps/desktop/src/main/rekordboxCompleteOnClose.test.ts apps/desktop/src/main/rekordboxCuesIpc.ts apps/desktop/src/main/rekordboxCuesIpc.test.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/i18n/locales
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Complete cues on close with the active flow instead of the fixed rules"
```

---

### Task 9: One drawing rule, starting with the list row

**Files:**
- Create: `src/renderer/src/lib/cueMarks.ts`, test `src/renderer/src/lib/cueMarks.test.ts`
- Modify: `src/renderer/src/components/RowWave.tsx`
- Test: `src/renderer/src/components/RowWave.test.tsx`

**Interfaces:**
- Consumes: `SAME_POSITION_MS` (shared/cueRules), `hotCueColor` (shared/rekordboxCueColors), `cueLetter` (lib/rowCues).
- Produces (from `lib/cueMarks.ts`):
  - `interface MarkInput { key: string; ms: number; kind: number; color: number | null }`
  - `interface HotMark { key: string; ms: number; at: number; kind: number; letter: string; colour: string }`
  - `interface CallMark { key: string; ms: number; at: number; paired: boolean }`
  - `placeCues(cues: MarkInput[], spanMs: number): { hot: HotMark[]; calls: CallMark[] }` (`at` in percent; cues outside `0..spanMs` and a `spanMs` ≤ 0 or NaN place nothing; CALLs at the same `ms` collapse to one; a CALL within 50 ms of a hot cue takes that hot cue's `at` and `paired: true`)
  - `type MarkSize = 'row' | 'wave'`; `HOT_MARK_PX: Record<MarkSize, number>` (`row` 12, `wave` 14)
  - `markStyle(at: number, row: 'hot' | 'call', size: MarkSize): { left: string; top: string; transform: string }` (`left` `${at}%`, `transform` `translateX(-50%)`, `top` `0px` for hot cues and `${HOT_MARK_PX[size] + 1}px` for every CALL)

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/cueMarks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { markStyle, placeCues } from './cueMarks'

describe('placeCues', () => {
  it('puts a CALL right under its hot cue even when rekordbox stored it a few ms apart', () => {
    const { hot, calls } = placeCues(
      [
        { key: 'a', ms: 32000, kind: 1, color: 1 },
        { key: 'b', ms: 32030, kind: 0, color: null },
      ],
      128000,
    )
    expect(hot[0]).toMatchObject({ at: 25, letter: 'A', colour: '#305aff' })
    expect(calls).toEqual([{ key: 'b', ms: 32030, at: 25, paired: true }])
  })

  it('draws one CALL for CALLs stacked at the same spot and a lone CALL as a drop', () => {
    const { calls } = placeCues(
      [
        { key: 'a', ms: 64000, kind: 0, color: null },
        { key: 'b', ms: 64000, kind: 0, color: null },
      ],
      128000,
    )
    expect(calls).toEqual([{ key: 'a', ms: 64000, at: 50, paired: false }])
  })

  it('places nothing it cannot place, for a track with no length or a cue past the end', () => {
    expect(placeCues([{ key: 'a', ms: 1000, kind: 1, color: 1 }], 0)).toEqual({ hot: [], calls: [] })
    expect(placeCues([{ key: 'a', ms: 9000, kind: 0, color: null }], 8000).calls).toEqual([])
  })
})

describe('markStyle', () => {
  it('centres both marks on the same spot and puts every CALL at one height under the squares', () => {
    expect(markStyle(25, 'hot', 'row')).toEqual({ left: '25%', top: '0px', transform: 'translateX(-50%)' })
    expect(markStyle(25, 'call', 'row')).toEqual({ left: '25%', top: '13px', transform: 'translateX(-50%)' })
    expect(markStyle(25, 'call', 'wave').top).toBe('15px')
  })
})
```

In `src/renderer/src/components/RowWave.test.tsx` add:

```tsx
  it('draws a CALL under its hot cue, centred, instead of hiding it behind the square', () => {
    render(
      <RowWave
        request={request}
        cues={[
          { ms: 0, kind: 1, color: 42 },
          { ms: 0, kind: 0, color: null },
        ]}
        durationSec={128}
        pending={false}
        active
      />,
    )
    const hot = screen.getByTestId('track-hot-cue')
    const call = screen.getByTestId('track-memory-cue')
    expect(call.style.left).toBe(hot.style.left)
    expect(call.style.transform).toBe('translateX(-50%)')
    expect(hot.style.transform).toBe('translateX(-50%)')
    expect(call.style.top).toBe('13px')
  })

  it('puts every CALL at one height, the drop alone and the ones under hot cues', () => {
    render(
      <RowWave
        request={request}
        cues={[
          { ms: 0, kind: 1, color: 42 },
          { ms: 0, kind: 0, color: null },
          { ms: 64000, kind: 0, color: null },
        ]}
        durationSec={128}
        pending={false}
        active
      />,
    )
    expect(new Set(screen.getAllByTestId('track-memory-cue').map((c) => c.style.top))).toEqual(
      new Set(['13px']),
    )
  })
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueMarks.test.ts src/renderer/src/components/RowWave.test.tsx`
Expected: FAIL, no `./cueMarks`; RowWave's CALL has `top-0.5` and a different `left`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/cueMarks.ts`:

```ts
import { SAME_POSITION_MS } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import { cueLetter } from './rowCues'

export interface MarkInput {
  key: string
  ms: number
  kind: number
  color: number | null
}

export interface HotMark {
  key: string
  ms: number
  at: number
  kind: number
  letter: string
  colour: string
}

export interface CallMark {
  key: string
  ms: number
  at: number
  paired: boolean
}

export type MarkSize = 'row' | 'wave'

export const HOT_MARK_PX: Record<MarkSize, number> = { row: 12, wave: 14 }

export function placeCues(
  cues: MarkInput[],
  spanMs: number,
): { hot: HotMark[]; calls: CallMark[] } {
  if (!(spanMs > 0)) return { hot: [], calls: [] }
  const inside = cues.filter((c) => c.ms >= 0 && c.ms <= spanMs)
  const hotCues = inside.filter((c) => c.kind !== 0)
  const hot = hotCues.map((c) => ({
    key: c.key,
    ms: c.ms,
    at: (c.ms / spanMs) * 100,
    kind: c.kind,
    letter: cueLetter(c.kind),
    colour: hotCueColor(c.color),
  }))
  const calls = inside
    .filter((c, i) => c.kind === 0 && inside.findIndex((o) => o.kind === 0 && o.ms === c.ms) === i)
    .map((c) => {
      const pair = hotCues.find((h) => Math.abs(h.ms - c.ms) <= SAME_POSITION_MS)
      return {
        key: c.key,
        ms: c.ms,
        at: ((pair ? pair.ms : c.ms) / spanMs) * 100,
        paired: pair !== undefined,
      }
    })
  return { hot, calls }
}

export function markStyle(
  at: number,
  row: 'hot' | 'call',
  size: MarkSize,
): { left: string; top: string; transform: string } {
  return {
    left: `${at}%`,
    top: row === 'hot' ? '0px' : `${HOT_MARK_PX[size] + 1}px`,
    transform: 'translateX(-50%)',
  }
}
```

`src/renderer/src/components/RowWave.tsx`: replace the `placed`/`hot`/`memory` computation with

```ts
  const { hot, calls } = placeCues(
    cues.map((c, i) => ({ key: `${i}`, ...c })),
    span,
  )
```

(`awaiting` and `label` read `hot.length` as before). The memory span becomes `key={`m-${c.key}`}`, `style={{ ...markStyle(c.at, 'call', 'row'), borderTopColor: MEMORY_CUE_COLOR }}`, class `absolute h-0 w-0 border-x-4 border-t-[6px] border-x-transparent` (no `top-0.5`, no `calc`). The hot span: `key={`h-${c.key}`}`, `const colour = c.colour`, style `{ ...markStyle(c.at, 'hot', 'row'), backgroundColor: colour, color: '#000' }` (or `{ ...markStyle(c.at, 'hot', 'row'), borderColor: colour, color: colour }` when pending), class without `top-0`, text `{c.letter}`. The pending placeholder (`track-cue-pending`) uses `markStyle(0, 'hot', 'row')`. Remove the `hotCueColor` and `cueLetter` imports from RowWave if now unused.

- [ ] **Step 4: Run tests, types, lint**

The two test files plus `src/renderer/src/components/TrackList.test.tsx`: PASS (existing RowWave tests keep their test ids; a test that asserted the old `calc(...)` left is updated to the new `left`). Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueMarks.ts apps/desktop/src/renderer/src/lib/cueMarks.test.ts apps/desktop/src/renderer/src/components/RowWave.tsx apps/desktop/src/renderer/src/components/RowWave.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Draw each CALL under its hot cue and every CALL at one height in the list"
```

---

### Task 10: The section's draft

**Files:**
- Create: `src/renderer/src/lib/cueDraft.ts`, test `src/renderer/src/lib/cueDraft.test.ts`
- Modify: `src/shared/rekordboxCueColors.ts` (`HOT_CUE_PICKER`, `HOT_CUE_DEFAULT_INDEX`), test `src/shared/rekordboxCueColors.test.ts`

**Interfaces:**
- Consumes: `flowOutcome`, `findDrops`, `nearestBeat`, `HOT_KINDS`, `SAME_POSITION_MS`, `type ExistingCue`, `type StrongPart`, `type WantedCue` (shared/cueRules); `CueFlow`, `FlowPhrase`, `MY_FLOW` (shared/cueFlows).
- Produces:
  - `HOT_CUE_PICKER: number[]` = `[1, 5, 9, 14, 18, 22, 26, 30, 32, 38, 42, 45, 48, 52, 56, 60]`; `HOT_CUE_DEFAULT_INDEX = 22`
  - from `lib/cueDraft.ts`:
    - `interface DraftCue extends WantedCue { key: string }`
    - `type DraftNotice = 'manual' | 'too-many' | null`
    - `interface CueDraft { cues: DraftCue[]; flowId: string; past: DraftCue[][]; selected: string | null; notice: DraftNotice; trimmed: number[]; nextKey: number }`
    - `interface DraftContext { beats: number[]; strong: StrongPart[]; phrases: FlowPhrase[]; flows: CueFlow[] }`
    - `type DraftAction = { type: 'mark-drop'; ms: number } | { type: 'unmark-drop'; key: string } | { type: 'select'; key: string | null } | { type: 'move'; key: string; ms: number } | { type: 'remove'; key: string } | { type: 'recolour'; key: string; color: number } | { type: 'reletter'; key: string; kind: number } | { type: 'add-hot'; ms: number } | { type: 'add-call'; ms: number } | { type: 'apply-flow'; flowId: string } | { type: 'undo' }`
    - `startDraft(cues: WantedCue[], flowId: string): CueDraft`
    - `reduceDraft(state: CueDraft, action: DraftAction, ctx: DraftContext): CueDraft`
    - `draftDrops(cues: WantedCue[]): number[]`
    - `freeLetters(cues: WantedCue[], current?: number): number[]`
    - `wantedOfDraft(cues: DraftCue[]): WantedCue[]`

- [ ] **Step 1: Write the failing tests**

In `src/shared/rekordboxCueColors.test.ts` add:

```ts
  it('offers the 16 colours of rekordbox picker, the four of the countdown among them', () => {
    expect(HOT_CUE_PICKER).toHaveLength(16)
    expect(HOT_CUE_PICKER).toEqual(expect.arrayContaining([1, 22, 32, 42]))
    expect(new Set(HOT_CUE_PICKER.map(hotCueColor)).size).toBe(16)
  })

  it('gives a new hot cue the colour rekordbox draws a cue without one', () => {
    expect(hotCueColor(HOT_CUE_DEFAULT_INDEX)).toBe(HOT_CUE_DEFAULT_COLOR)
  })
```

Create `src/renderer/src/lib/cueDraft.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BUNDLED_FLOWS } from '../../../shared/cueFlows'
import {
  type CueDraft,
  type DraftAction,
  draftDrops,
  freeLetters,
  reduceDraft,
  startDraft,
} from './cueDraft'

const beats = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => n * 2000
const ctx = { beats, strong: [], phrases: [], flows: BUNDLED_FLOWS }
const run = (state: CueDraft, ...actions: DraftAction[]) =>
  actions.reduce((s, a) => reduceDraft(s, a, ctx), state)
const empty = () => startDraft([], 'mine')
const at = (s: CueDraft, ms: number, hot: boolean) =>
  s.cues.find((c) => c.ms === ms && (c.kind !== 0) === hot)

describe('reduceDraft', () => {
  it('marks a drop on the nearest beat and lets the flow draw the countdown', () => {
    const s = run(empty(), { type: 'mark-drop', ms: bar(64) + 120 })
    expect(draftDrops(s.cues)).toEqual([bar(64)])
    expect(s.cues.filter((c) => c.kind !== 0).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(16), 1, 42],
      [bar(32), 2, 22],
      [bar(48), 3, 1],
    ])
  })

  it('takes the countdown away with the drop when the mark is clicked again', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const drop = at(marked, bar(64), false)
    const s = run(marked, { type: 'unmark-drop', key: drop?.key as string })
    expect(s.cues).toEqual([])
  })

  it('keeps one drop when the same position is marked twice', () => {
    const s = run(empty(), { type: 'mark-drop', ms: bar(64) }, { type: 'mark-drop', ms: bar(64) + 10 })
    expect(draftDrops(s.cues)).toEqual([bar(64)])
  })

  it('marking a drop after moving a countdown cue keeps the move and only adds the CALL', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)
    const moved = run(marked, { type: 'move', key: a?.key as string, ms: bar(20) })
    const s = run(moved, { type: 'mark-drop', ms: bar(128) })
    expect(s.notice).toBe('manual')
    expect(at(s, bar(20), true)).toBeDefined()
    expect(draftDrops(s.cues)).toEqual([bar(64), bar(128)])
    expect(s.cues.filter((c) => c.kind !== 0)).toHaveLength(3)
  })

  it('moves a hot cue with the CALL under it, snapped to the beat, and keeps its letter', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const b = at(marked, bar(32), true)
    const s = run(marked, { type: 'move', key: b?.key as string, ms: bar(36) + 200 })
    expect(at(s, bar(36), true)).toMatchObject({ kind: 2, color: 22 })
    expect(at(s, bar(36), false)).toBeDefined()
    expect(at(s, bar(32), false)).toBeUndefined()
  })

  it('refuses a move onto another hot cue so two never share a spot', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)
    expect(run(marked, { type: 'move', key: a?.key as string, ms: bar(32) })).toBe(marked)
  })

  it('deletes a hot cue with its CALL, so the CALL never reads as a drop', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const c = at(marked, bar(48), true)
    const s = run(marked, { type: 'remove', key: c?.key as string })
    expect(at(s, bar(48), true)).toBeUndefined()
    expect(at(s, bar(48), false)).toBeUndefined()
    expect(draftDrops(s.cues)).toEqual([bar(64)])
  })

  it('deletes a CALL under a hot cue and leaves the hot cue', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const call = at(marked, bar(48), false)
    const s = run(marked, { type: 'remove', key: call?.key as string })
    expect(at(s, bar(48), true)).toBeDefined()
    expect(at(s, bar(48), false)).toBeUndefined()
  })

  it('recolours and reletters hot cues only, and only to a free letter', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const a = at(marked, bar(16), true)?.key as string
    const call = at(marked, bar(16), false)?.key as string
    const s = run(
      marked,
      { type: 'recolour', key: a, color: 5 },
      { type: 'reletter', key: a, kind: 2 },
      { type: 'reletter', key: a, kind: 9 },
      { type: 'recolour', key: call, color: 5 },
    )
    expect(at(s, bar(16), true)).toMatchObject({ kind: 9, color: 5 })
    expect(at(s, bar(16), false)?.color).toBeNull()
    expect(freeLetters(s.cues)).toEqual([1, 5, 6, 7, 8])
  })

  it('adds a hot cue on the first free letter in the default colour, never a ninth', () => {
    let s = run(empty(), { type: 'add-hot', ms: bar(10) })
    expect(at(s, bar(10), true)).toMatchObject({ kind: 1, color: 22 })
    for (let i = 1; i < 8; i++) s = run(s, { type: 'add-hot', ms: bar(10 + 4 * i) })
    expect(run(s, { type: 'add-hot', ms: bar(100) })).toBe(s)
  })

  it('adds a CALL without asking the flow for anything', () => {
    const s = run(empty(), { type: 'add-call', ms: bar(64) })
    expect(s.cues.map((c) => [c.ms, c.kind])).toEqual([[bar(64), 0]])
  })

  it('applies another flow to the drops already marked, replacing what the first flow drew', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const s = run(marked, { type: 'apply-flow', flowId: 'one-at-32' })
    expect(s.flowId).toBe('one-at-32')
    expect(s.cues.filter((c) => c.kind !== 0).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(32), 1, 22],
    ])
    expect(draftDrops(s.cues)).toEqual([bar(64)])
  })

  it('says a plan needs more than 8 hot cues and changes nothing', () => {
    let s = startDraft([{ id: 'y', ms: 500, kind: 1, color: 32 }], 'mine')
    for (const n of [48, 96, 144]) s = run(s, { type: 'mark-drop', ms: bar(n) })
    const before = s.cues
    const after = run(s, { type: 'mark-drop', ms: bar(192) })
    expect(after.notice).toBe('too-many')
    expect(after.cues).toBe(before)
  })

  it('undoes one step at a time and never undoes a selection', () => {
    const marked = run(empty(), { type: 'mark-drop', ms: bar(64) })
    const selected = run(marked, { type: 'select', key: marked.cues[0].key })
    const removed = run(selected, { type: 'remove', key: marked.cues[0].key })
    expect(run(removed, { type: 'undo' }).cues).toEqual(marked.cues)
    expect(run(removed, { type: 'undo' }, { type: 'undo' }).cues).toEqual([])
  })

  it('keeps the rekordbox ID of a cue it moves, so the save is a move and not a new cue', () => {
    const s = startDraft(
      [
        { id: '70001', ms: bar(16), kind: 1, color: 1 },
        { id: '70002', ms: bar(16), kind: 0, color: null },
      ],
      'mine',
    )
    const moved = run(s, { type: 'move', key: '70001', ms: bar(20) })
    expect(moved.cues.map((c) => [c.id, c.ms])).toEqual([
      ['70001', bar(20)],
      ['70002', bar(20)],
    ])
  })
})
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueDraft.test.ts src/shared/rekordboxCueColors.test.ts`
Expected: FAIL, missing modules and exports.

- [ ] **Step 3: Implement**

`src/shared/rekordboxCueColors.ts`, append:

```ts
export const HOT_CUE_PICKER = [1, 5, 9, 14, 18, 22, 26, 30, 32, 38, 42, 45, 48, 52, 56, 60]
export const HOT_CUE_DEFAULT_INDEX = 22
```

Create `src/renderer/src/lib/cueDraft.ts`:

```ts
import { type CueFlow, type FlowPhrase, MY_FLOW } from '../../../shared/cueFlows'
import {
  type ExistingCue,
  findDrops,
  flowOutcome,
  HOT_KINDS,
  nearestBeat,
  SAME_POSITION_MS,
  type StrongPart,
  type WantedCue,
} from '../../../shared/cueRules'
import { HOT_CUE_DEFAULT_INDEX } from '../../../shared/rekordboxCueColors'

export interface DraftCue extends WantedCue {
  key: string
}

export type DraftNotice = 'manual' | 'too-many' | null

export interface CueDraft {
  cues: DraftCue[]
  flowId: string
  past: DraftCue[][]
  selected: string | null
  notice: DraftNotice
  trimmed: number[]
  nextKey: number
}

export interface DraftContext {
  beats: number[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
  flows: CueFlow[]
}

export type DraftAction =
  | { type: 'mark-drop'; ms: number }
  | { type: 'unmark-drop'; key: string }
  | { type: 'select'; key: string | null }
  | { type: 'move'; key: string; ms: number }
  | { type: 'remove'; key: string }
  | { type: 'recolour'; key: string; color: number }
  | { type: 'reletter'; key: string; kind: number }
  | { type: 'add-hot'; ms: number }
  | { type: 'add-call'; ms: number }
  | { type: 'apply-flow'; flowId: string }
  | { type: 'undo' }

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS
const isHot = (c: { kind: number }): boolean => c.kind !== 0

export function startDraft(cues: WantedCue[], flowId: string): CueDraft {
  return {
    cues: cues.map((c, i) => ({ ...c, key: c.id ?? `n${i}` })),
    flowId,
    past: [],
    selected: null,
    notice: null,
    trimmed: [],
    nextKey: cues.length,
  }
}

export function draftDrops(cues: WantedCue[]): number[] {
  return findDrops(
    cues.filter((c) => !isHot(c)).map((c) => c.ms),
    cues.filter(isHot).map((c) => c.ms),
  )
}

export function freeLetters(cues: WantedCue[], current?: number): number[] {
  return HOT_KINDS.filter((k) => k === current || !cues.some((c) => c.kind === k))
}

export function wantedOfDraft(cues: DraftCue[]): WantedCue[] {
  return cues.map(({ key: _key, ...c }) => c)
}

const flowById = (ctx: DraftContext, id: string): CueFlow =>
  ctx.flows.find((f) => f.id === id) ?? MY_FLOW

const snap = (ctx: DraftContext, ms: number): number => ctx.beats[nearestBeat(ctx.beats, ms)]

function commit(state: CueDraft, cues: DraftCue[], over: Partial<CueDraft> = {}): CueDraft {
  return { ...state, notice: null, ...over, cues, past: [...state.past, state.cues] }
}

function regenerate(
  state: CueDraft,
  ctx: DraftContext,
  drops: number[],
  flow: CueFlow,
  previousFlow: CueFlow,
): CueDraft {
  const existing: ExistingCue[] = state.cues.map((c) => ({
    id: c.key,
    ms: c.ms,
    kind: c.kind,
    color: c.color,
  }))
  const out = flowOutcome({
    existing,
    drops,
    previousDrops: draftDrops(state.cues),
    beats: ctx.beats,
    strong: ctx.strong,
    phrases: ctx.phrases,
    flow,
    previousFlow,
  })
  if (out.status === 'too-many') return { ...state, notice: 'too-many' }
  const byKey = new Map(state.cues.map((c) => [c.key, c]))
  let nextKey = state.nextKey
  const cues = out.wanted.map((w): DraftCue => {
    const was = w.id === undefined ? undefined : byKey.get(w.id)
    if (was) return { ...was, ms: w.ms, kind: w.kind, color: w.color }
    nextKey += 1
    return { key: `n${nextKey}`, ms: w.ms, kind: w.kind, color: w.color }
  })
  return commit(state, cues, {
    flowId: flow.id,
    nextKey,
    selected: null,
    notice: out.status === 'manual' ? 'manual' : null,
    trimmed: out.status === 'plan' ? out.trimmed : [],
  })
}

function pairOf(cues: DraftCue[], target: DraftCue): DraftCue | undefined {
  return isHot(target) ? cues.find((c) => !isHot(c) && near(c.ms, target.ms)) : undefined
}

export function reduceDraft(state: CueDraft, action: DraftAction, ctx: DraftContext): CueDraft {
  const flow = flowById(ctx, state.flowId)
  if (action.type === 'select') return { ...state, selected: action.key }
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]
    if (!previous) return state
    return { ...state, cues: previous, past: state.past.slice(0, -1), selected: null, notice: null }
  }
  if (action.type === 'mark-drop') {
    const ms = snap(ctx, action.ms)
    if (state.cues.some((c) => !isHot(c) && near(c.ms, ms))) return state
    return regenerate(state, ctx, [...draftDrops(state.cues), ms], flow, flow)
  }
  if (action.type === 'apply-flow')
    return regenerate(state, ctx, draftDrops(state.cues), flowById(ctx, action.flowId), flow)
  if (action.type === 'add-hot' || action.type === 'add-call') {
    const ms = snap(ctx, action.ms)
    const hot = action.type === 'add-hot'
    const kind = hot ? freeLetters(state.cues).at(0) : 0
    if (kind === undefined || state.cues.some((c) => isHot(c) === hot && near(c.ms, ms)))
      return state
    const key = `n${state.nextKey + 1}`
    const cue: DraftCue = { key, ms, kind, color: hot ? HOT_CUE_DEFAULT_INDEX : null }
    return commit(state, [...state.cues, cue], { nextKey: state.nextKey + 1, selected: key })
  }
  const target = state.cues.find((c) => c.key === action.key)
  if (!target) return state
  if (action.type === 'unmark-drop')
    return regenerate(
      state,
      ctx,
      draftDrops(state.cues).filter((d) => d !== target.ms),
      flow,
      flow,
    )
  if (action.type === 'remove') {
    const pair = pairOf(state.cues, target)
    return commit(
      state,
      state.cues.filter((c) => c.key !== target.key && c.key !== pair?.key),
      { selected: null },
    )
  }
  if (action.type === 'recolour') {
    if (!isHot(target)) return state
    return commit(
      state,
      state.cues.map((c) => (c.key === target.key ? { ...c, color: action.color } : c)),
    )
  }
  if (action.type === 'reletter') {
    if (!isHot(target) || !freeLetters(state.cues).includes(action.kind)) return state
    return commit(
      state,
      state.cues.map((c) => (c.key === target.key ? { ...c, kind: action.kind } : c)),
    )
  }
  const ms = snap(ctx, action.ms)
  const pair = pairOf(state.cues, target)
  const moving = new Set([target.key, pair?.key])
  const taken = (hot: boolean): boolean =>
    state.cues.some((c) => !moving.has(c.key) && isHot(c) === hot && near(c.ms, ms))
  if (near(ms, target.ms) || taken(isHot(target)) || (pair && taken(false))) return state
  return commit(
    state,
    state.cues.map((c) => (moving.has(c.key) ? { ...c, ms } : c)),
  )
}
```

(`freeLetters(state.cues).at(0)` is the first free letter; with all eight taken it is `undefined` and the add is refused. Switching to another flow keeps a CALL that sat under a hot cue the new flow reuses, as `cueChanges` always has: a CALL only goes with the hot cue it was paired with.)

- [ ] **Step 4: Run tests, types, lint**

The two test files: PASS. Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueDraft.ts apps/desktop/src/renderer/src/lib/cueDraft.test.ts apps/desktop/src/shared/rekordboxCueColors.ts apps/desktop/src/shared/rekordboxCueColors.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Edit a track's cues as a draft with flows, moves, deletes, colours, letters and undo"
```

---

### Task 11: The waveform: marks, selection, drag, menu, proposals

**Files:**
- Modify: `src/renderer/src/components/CueWave.tsx` (props and drawing), `src/renderer/src/components/CuesSection.tsx` (call site bridge), `src/renderer/src/i18n/locales/*.json` (`cueWave.*`)
- Test: `src/renderer/src/components/CueWave.test.tsx` (rewritten for the new props)

**Interfaces:**
- Consumes: `placeCues`, `markStyle`, `HOT_MARK_PX` (Task 9); `barLines`, `clickAction`, `cuePosition`, `dropLabels` (lib/cueWave); `nearestBeat` (shared/cueRules); `MEMORY_CUE_COLOR` (shared/rekordboxCueColors).
- Produces:
  - `interface WaveCue { key: string; ms: number; kind: number; color: number | null; pending: boolean }` exported from `CueWave.tsx`
  - `CueWave` props: `wave: CueWaveColumn[] | null; grid: { ms: number; beat: number }[]; durationMs: number; cues: WaveCue[]; selected?: string | null; proposals?: number[]; trimmed?: number[]; readOnly?: boolean; onMarkDrop?: (ms: number) => void; onUnmarkDrop?: (key: string) => void; onSelect?: (key: string | null) => void; onMove?: (key: string, ms: number) => void; onMenu?: (at: { ms: number; x: number; y: number }) => void; onAcceptProposal?: (ms: number) => void`
  - test ids: `cue-wave` (root, `tabIndex` 0 unless read-only), `cue-wave-hot-<letter>` (`data-pending`, `data-selected`), `cue-wave-call-<ms>` (`data-paired`, `data-selected`), `cue-wave-drop-<ms>` and `cue-wave-drop-label-<ms>` (as today, for unpaired CALLs), `cue-wave-ghost`, `cue-wave-drag-ghost`, `cue-wave-proposal-<ms>`, `cue-wave-trimmed-<ms>`, `cue-wave-bar`, `cue-wave-not-analysed`.
  - Behaviour: a click on the empty wave marks a drop on the beat under it (`clickAction` over the unpaired CALLs, as today) or unmarks the drop within 6 px; a mousedown on a mark selects it and starts a drag; moving the mouse more than 3 px shows the snapped target and mouseup calls `onMove(key, beatMs)`; a click on the empty wave also clears the selection (`onSelect(null)`); a right-click calls `onMenu` with the snapped beat and the position inside the wave; a click on a proposal calls `onAcceptProposal`. `readOnly` takes none of it.

- [ ] **Step 1: Write the failing tests**

Rewrite `src/renderer/src/components/CueWave.test.tsx`. Keep `GRID` (500 ms beats, 160 beats), the `getBoundingClientRect` mock (800 px wide) and `afterEach(cleanup)`; `durationMs` 80000, so 1 px is 100 ms. The label and ghost tests of today keep their bodies, adapted to the new props (`cues` with an unpaired CALL where they used `drops`). New `setup`:

```tsx
function setup(over: Partial<React.ComponentProps<typeof CueWave>> = {}) {
  const handlers = {
    onMarkDrop: vi.fn(),
    onUnmarkDrop: vi.fn(),
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onMenu: vi.fn(),
    onAcceptProposal: vi.fn(),
  }
  render(
    <CueWave
      wave={[{ h: 1, rgb: [255, 0, 0] }]}
      grid={GRID}
      durationMs={80000}
      cues={[
        { key: 'a', ms: 16000, kind: 1, color: 42, pending: false },
        { key: 'p', ms: 16000, kind: 0, color: null, pending: false },
        { key: 'd', ms: 40000, kind: 0, color: null, pending: true },
      ]}
      {...handlers}
      {...over}
    />,
  )
  return handlers
}
```

Tests:

```tsx
  it('draws hot cues as lettered squares in rekordbox colours and CALLs under them at one height', () => {
    setup()
    const a = screen.getByTestId('cue-wave-hot-A')
    expect(a).toHaveTextContent('A')
    expect(a).toHaveStyle({ backgroundColor: '#e62828' })
    const paired = screen.getByTestId('cue-wave-call-16000')
    const drop = screen.getByTestId('cue-wave-call-40000')
    expect(paired.style.left).toBe(a.style.left)
    expect(paired.style.top).toBe('15px')
    expect(drop.style.top).toBe('15px')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('DROP')
    expect(screen.queryByTestId('cue-wave-drop-16000')).toBeNull()
  })

  it('marks a drop on the beat under a click on the empty wave and clears the selection', () => {
    const h = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 60 })
    expect(h.onMarkDrop).toHaveBeenCalledWith(10000)
    expect(h.onSelect).toHaveBeenCalledWith(null)
  })

  it('takes a drop away with a click on its line', () => {
    const h = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 402, clientY: 60 })
    expect(h.onUnmarkDrop).toHaveBeenCalledWith('d')
  })

  it('selects a cue with a click on its square without marking a drop there', () => {
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseUp(window, { clientX: 160 })
    fireEvent.click(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    expect(h.onSelect).toHaveBeenCalledWith('a')
    expect(h.onMarkDrop).not.toHaveBeenCalled()
    expect(h.onMove).not.toHaveBeenCalled()
  })

  it('drags a cue to the beat under the pointer', () => {
    const h = setup()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseMove(window, { clientX: 243 })
    expect(screen.getByTestId('cue-wave-drag-ghost')).toBeInTheDocument()
    fireEvent.mouseUp(window, { clientX: 243 })
    expect(h.onMove).toHaveBeenCalledWith('a', 24500)
  })

  it('opens the menu on a right-click with the beat under it', () => {
    const h = setup()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 30 })
    expect(h.onMenu).toHaveBeenCalledWith({ ms: 10000, x: 100, y: 30 })
  })

  it('draws proposals dashed and accepts one with a click', () => {
    const h = setup({ proposals: [32000] })
    fireEvent.click(screen.getByTestId('cue-wave-proposal-32000'))
    expect(h.onAcceptProposal).toHaveBeenCalledWith(32000)
    expect(h.onMarkDrop).not.toHaveBeenCalled()
  })

  it('draws the hot cues the 8 limit left out apart, so the user sees them', () => {
    setup({ trimmed: [8000] })
    expect(screen.getByTestId('cue-wave-trimmed-8000')).toBeInTheDocument()
  })

  it('marks the selected cue', () => {
    setup({ selected: 'a' })
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-selected', 'true')
  })

  it('takes no clicks, drags or menus read-only, as in the settings preview', () => {
    const h = setup({ readOnly: true })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 60 })
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: 160 })
    fireEvent.mouseUp(window, { clientX: 300 })
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 30 })
    expect(Object.values(h).every((f) => f.mock.calls.length === 0)).toBe(true)
  })
```

(243 px is 24300 ms; the nearest beat is 24500.) Keep `'says the track is not analysed and takes no clicks when it has no grid'`, the label tests (`'names where each drop sits'`, `'turns the label of a drop near the end…'`, `'stacks the labels…'`) and the ghost tests, building their drops as unpaired CALLs in `cues`.

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueWave.test.tsx`
Expected: FAIL, `cues` is not a prop.

- [ ] **Step 3: Implement**

`src/renderer/src/components/CueWave.tsx`, structure (keep the waveform `svg`, the bar lines, the drop line with its two-line label, the hover ghost and the not-analysed box as they are today):

```tsx
export interface WaveCue {
  key: string
  ms: number
  kind: number
  color: number | null
  pending: boolean
}

const HIT_PX = 6
const DRAG_PX = 3
```

- Placement: `const { hot, calls } = placeCues(cues, durationMs)`; drops are `calls.filter((c) => !c.paired)`; `clickAction(ms, beatsMs, drops.map((d) => d.ms), tolerance)` decides click and hover as today, and a `remove` maps back to the drop's `key`.
- The root keeps `data-testid="cue-wave"`, gets `tabIndex={readOnly ? -1 : 0}`, `onContextMenu` (`preventDefault`, then `onMenu?.({ ms: beatsMs[nearestBeat(beatsMs, ms)], x: e.clientX - rect.left, y: e.clientY - rect.top })` unless `readOnly`), and `onClick` (unless `readOnly`): `onSelect?.(null)` then mark or unmark.
- Hot cue: `<button type="button" data-testid={`cue-wave-hot-${c.letter}`} data-pending data-selected aria-label={t('cueWave.hotCue', { letter: c.letter })} style={{ ...markStyle(c.at, 'hot', 'wave'), ...(pending ? { borderColor: c.colour, color: c.colour } : { backgroundColor: c.colour, color: '#000' }) }} className="absolute h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] …">` with `ring-2 ring-[var(--color-fg)]` when selected and `border` when pending. `onMouseDown` (unless `readOnly`): `e.stopPropagation()`, `onSelect?.(c.key)`, start the drag; `onClick`: `e.stopPropagation()`.
- CALL: the same for `calls`, as a `<button>` with `data-testid={`cue-wave-call-${c.ms}`}`, `data-paired`, `aria-label={t('cueWave.call')}`, style `{ ...markStyle(c.at, 'call', 'wave'), borderTopColor: MEMORY_CUE_COLOR }`, class `absolute h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent` (+ `opacity-60` when pending; selected adds `drop-shadow` with the foreground colour).
- Drag: `const [drag, setDrag] = useState<{ key: string; x0: number; ms: number | null } | null>(null)`; an effect while `drag` is set adds `mousemove` and `mouseup` listeners on `window`: on move, if `Math.abs(e.clientX - drag.x0) > DRAG_PX`, `ms` becomes the snapped beat under `e.clientX` (rect from a `ref` on the root); on up, `if (drag.ms !== null) onMove?.(drag.key, drag.ms)` and `setDrag(null)`. While `drag.ms !== null`, draw `<span data-testid="cue-wave-drag-ghost" style={{ left: pct(drag.ms) }} className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/70" />`.
- Proposals: for each `ms` in `proposals ?? []`, `<button type="button" data-testid={`cue-wave-proposal-${ms}`} aria-label={t('cueWave.proposal', { bar: cuePosition(ms, grid).bar })} style={{ left: pct(ms) }} className="absolute top-0 bottom-0 w-2 -translate-x-1/2 border-l border-dashed border-[var(--color-fg)]/70" onClick={(e) => { e.stopPropagation(); onAcceptProposal?.(ms) }} />` (not rendered when `readOnly`).
- Read-only: hot cue and CALL marks render as `span` with the same test ids, styles and `aria-hidden="true"`, no handlers, and the root has no click, context menu or hover ghost.
- Trimmed: for each `ms` in `trimmed ?? []`, `<span data-testid={`cue-wave-trimmed-${ms}`} aria-hidden="true" style={markStyle((ms / Math.max(durationMs, 1)) * 100, 'hot', 'wave')} className="absolute h-3.5 w-3.5 rounded-[3px] border border-dashed border-[var(--color-fg-faint)]" />`.
- Drop labels move to the bottom rows (`bottom-0` and `bottom-6`) so they never sit on the hot cue squares.
- The root's `biome-ignore` comments go: the root keeps pointer marking only, but its marks are buttons and the root takes focus, so the a11y lints are satisfied; if biome still flags the root's `onClick`, add `onKeyDown` handling Enter as a mark at the hovered beat (no comment).

Bridge in `CuesSection.tsx` until Task 12: build `cues` from today's `drawnHot` (`key: `h${h.kind}``) and `drops` (`key: `d${ms}``, `kind: 0`, `color: null`); `onMarkDrop` does what `onAddDrop` did; `onUnmarkDrop(key)` removes the drop whose key it is.

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-t11.json` and merge it:

```json
{
  "es": { "cueWave": { "hotCue": "Hot cue {{letter}}", "call": "CALL", "proposal": "Propuesta de donde rompe en el compás {{bar}}" } },
  "en": { "cueWave": { "hotCue": "Hot cue {{letter}}", "call": "CALL", "proposal": "Suggested drop at bar {{bar}}" } },
  "de": { "cueWave": { "hotCue": "Hot Cue {{letter}}", "call": "CALL", "proposal": "Vorgeschlagener Drop in Takt {{bar}}" } },
  "fr": { "cueWave": { "hotCue": "Hot cue {{letter}}", "call": "CALL", "proposal": "Drop proposé à la mesure {{bar}}" } },
  "pt-BR": { "cueWave": { "hotCue": "Hot cue {{letter}}", "call": "CALL", "proposal": "Drop sugerido no compasso {{bar}}" } }
}
```

- [ ] **Step 4: Run tests, types, lint**

`CueWave.test.tsx`, `CuesSection.test.tsx`, `CuesSection.dedupe.test.tsx`, `src/renderer/src/i18n/index.test.ts`: PASS (a `CuesSection` test that read `cue-wave-hot-*` styles from the theme colours is updated to the rekordbox colour). Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CueWave.tsx apps/desktop/src/renderer/src/components/CueWave.test.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/i18n/locales
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Select, drag and add cues on the waveform, drawn as rekordbox draws them"
```

---

### Task 12: The Cues section becomes the editor

**Files:**
- Create: `src/renderer/src/components/CuePalette.tsx`, test `src/renderer/src/components/CuePalette.test.tsx`
- Modify: `src/renderer/src/components/CuesSection.tsx` (rewrite of `Marking` into `Editing`), `src/renderer/src/i18n/locales/*.json` (`editor.cues.*`, `cueFlows.*`)
- Test: `src/renderer/src/components/CuesSection.test.tsx` (rewritten), `src/renderer/src/components/CuesSection.dedupe.test.tsx`

**Interfaces:**
- Consumes: `startDraft`, `reduceDraft`, `freeLetters`, `wantedOfDraft`, `DraftCue`, `CueDraft`, `DraftAction` (Task 10); `CueWave`, `WaveCue` (Task 11); `MAX_HOT_CUES`, `type WantedCue` (shared/cueRules); `activeCueFlow`, `CueFlow` (Task 1); `useAppSettings().cueFlows/activeCueFlow` (Task 6); `HOT_CUE_PICKER`, `hotCueColor` (shared/rekordboxCueColors); `cueLetter` (lib/rowCues); `useTrackCues`, `useQueuedCues` (hooks).
- Produces:
  - `CuePalette({ value, onPick, label }: { value: number | null; onPick: (index: number) => void; label: (index: number) => string }): JSX.Element`, test ids `cue-palette` and `cue-palette-<index>` (`aria-pressed` on the current one)
  - `flowName(flow: CueFlow, t: TFunction): string` in `src/renderer/src/lib/cueFlowName.ts` (new), used by the section and by Task 13: the stored name, else the translated name of a bundled flow, else `cueFlows.unnamed`
  - Section test ids: `cues-section`, `cues-editor` (keyboard owner), `cues-selection`, `cues-delete`, `cue-palette-*`, `cues-letter`, `cues-flow`, `cues-apply-flow`, `cues-undo` (Descartar cambios), `cues-save`, `cues-manual`, `cues-too-many`, `cues-trimmed`, `cues-menu`, `cues-menu-add-hot`, `cues-menu-add-call`, `cues-menu-mark-drop`, plus today's `cues-unreadable`, `cues-unanalysed`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/CuePalette.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CuePalette } from './CuePalette'

afterEach(cleanup)

describe('CuePalette', () => {
  it('offers rekordbox 16 colours and marks the current one', () => {
    const onPick = vi.fn()
    render(<CuePalette value={22} onPick={onPick} label={(i) => `Color ${i}`} />)
    expect(screen.getAllByRole('button')).toHaveLength(16)
    expect(screen.getByTestId('cue-palette-22')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-palette-42'))
    expect(onPick).toHaveBeenCalledWith(42)
  })
})
```

Rewrite `src/renderer/src/components/CuesSection.test.tsx`. Keep the header (imports, `GRID` of 800 beats every 500 ms, `bar`, `READ` with `phrases: []`, the rect mock at 400 px for 400000 ms, so 1 px is 1000 ms) and `setup`, which now also takes `settings?: Partial<Settings>` and wraps the tree in `<SettingsProvider settings={settings ?? null}>`. `queued` is `WantedCue[] | null | Error`. Helpers:

```tsx
const clickAt = (ms: number) =>
  fireEvent.click(screen.getByTestId('cue-wave'), { clientX: ms / 1000, clientY: 60 })
const ready = () => waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
```

Tests (each one a real `it` in the file):

```tsx
  it('draws the countdown of the active flow live after marking a drop', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
  })

  it('uses the flow chosen in Settings, one cue at 32 bars with no CALL under it', async () => {
    setup(READ, null, { activeCueFlow: 'one-at-32' })
    await ready()
    clickAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toBe(`${(bar(32) / 400000) * 100}%`)
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
    expect(screen.queryByTestId(`cue-wave-call-${bar(32)}`)).toBeNull()
  })

  it('saves the whole wanted set with the fingerprint it read', async () => {
    const { saveRekordboxCues } = setup()
    await ready()
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    await waitFor(() => expect(saveRekordboxCues).toHaveBeenCalled())
    const req = saveRekordboxCues.mock.calls[0][0]
    expect(req).toMatchObject({ contentId: '103', path: '/m/g.wav', label: 'Gowan', fingerprint: 'f0' })
    expect(req.wanted.filter((c) => c.kind !== 0).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(16), 1, 42],
      [bar(32), 2, 22],
      [bar(48), 3, 1],
    ])
  })

  it('keeps Save off while the draft is what rekordbox or the queued save already holds', async () => {
    setup({ ...READ, cues: [{ id: 'd', ms: bar(64), kind: 0, color: null }] })
    await ready()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('deletes the selected hot cue and its CALL with the button or the backspace key', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-C'), { clientX: bar(48) / 1000 })
    fireEvent.mouseUp(window, { clientX: bar(48) / 1000 })
    fireEvent.click(screen.getByTestId('cues-delete'))
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(screen.queryByTestId(`cue-wave-call-${bar(48)}`)).toBeNull()
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-B'), { clientX: bar(32) / 1000 })
    fireEvent.mouseUp(window, { clientX: bar(32) / 1000 })
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'Backspace' })
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
  })

  it('undoes the last change with cmd Z without letting the metadata undo see the key', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })
    screen.getByTestId('cue-wave').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull())
  })

  it('recolours a hot cue from rekordbox picker and changes its letter only to a free one', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-A'), { clientX: bar(16) / 1000 })
    fireEvent.mouseUp(window, { clientX: bar(16) / 1000 })
    fireEvent.click(screen.getByTestId('cue-palette-5'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#50b4ff' })
    const letters = [...(screen.getByTestId('cues-letter') as HTMLSelectElement).options].map((o) => o.text)
    expect(letters).toEqual(['A', 'D', 'E', 'F', 'G', 'H'])
    fireEvent.change(screen.getByTestId('cues-letter'), { target: { value: '9' } })
    expect(screen.getByTestId('cue-wave-hot-H')).toBeInTheDocument()
  })

  it('shows no colour or letter for a selected CALL, since rekordbox lets neither change', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    fireEvent.mouseDown(screen.getByTestId(`cue-wave-call-${bar(64)}`), { clientX: 64 * 2 })
    fireEvent.mouseUp(window, { clientX: 64 * 2 })
    expect(screen.getByTestId('cues-delete')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-palette')).toBeNull()
    expect(screen.queryByTestId('cues-letter')).toBeNull()
  })

  it('adds a hot cue from the right-click menu on the first free letter in the default colour', async () => {
    setup()
    await ready()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(10) / 1000, clientY: 30 })
    fireEvent.click(screen.getByTestId('cues-menu-add-hot'))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ borderColor: '#28e214' })
    expect(screen.queryByTestId('cues-menu')).toBeNull()
  })

  it('marks a drop from the menu and adds a lone CALL from the menu', async () => {
    setup()
    await ready()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(64) / 1000, clientY: 30 })
    fireEvent.click(screen.getByTestId('cues-menu-mark-drop'))
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('cue-wave'), { clientX: bar(100) / 1000, clientY: 30 })
    fireEvent.click(screen.getByTestId('cues-menu-add-call'))
    expect(screen.getByTestId(`cue-wave-call-${bar(100)}`)).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-hot-D')).toBeNull()
  })

  it('applies another flow to the drops already marked', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    fireEvent.change(screen.getByTestId('cues-flow'), { target: { value: 'calls-only' } })
    fireEvent.click(screen.getByTestId('cues-apply-flow'))
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
  })

  it('moves a hot cue with its CALL by dragging it', async () => {
    setup()
    await ready()
    clickAt(bar(64))
    fireEvent.mouseDown(screen.getByTestId('cue-wave-hot-B'), { clientX: bar(32) / 1000 })
    fireEvent.mouseMove(window, { clientX: bar(36) / 1000 })
    fireEvent.mouseUp(window, { clientX: bar(36) / 1000 })
    expect(screen.getByTestId('cue-wave-hot-B').style.left).toBe(`${(bar(36) / 400000) * 100}%`)
    expect(screen.getByTestId(`cue-wave-call-${bar(36)}`)).toBeInTheDocument()
  })

  it('says hand-placed hot cues stay as they are and only adds the CALL', async () => {
    setup({ ...READ, cues: [{ id: 'm', ms: bar(40), kind: 1, color: 1 }] })
    await ready()
    clickAt(bar(64))
    expect(screen.getByTestId('cues-manual')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
  })

  it('says which hot cues the 8 limit leaves out', async () => {
    setup()
    await ready()
    for (const n of [48, 96, 144, 192]) clickAt(bar(n))
    expect(screen.getByTestId('cues-trimmed')).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-trimmed-${bar(0)}`)).toBeInTheDocument()
  })

  it('starts from a queued save and drops it with Descartar cambios', async () => {
    const queued = [{ ms: bar(64), kind: 0, color: null }]
    const { undoRekordboxCues } = setup(READ, queued)
    await ready()
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cues-undo'))
    await waitFor(() => expect(undoRekordboxCues).toHaveBeenCalledWith('103'))
  })
```

Keep, adapted to the new props and test ids: `'offers no marking on a track rekordbox has not analysed'`, `'offers no plan on a track without a grid even if rekordbox calls it analysed'`, `'explains it could not read rekordbox when the read fails'`, `'explains it could not read rekordbox when there is no collection'`, `'draws what rekordbox now holds as written once the queue landed and the cues were re-read'`, `'shows what rekordbox says and logs when the queued save cannot be read'`. Remove the legend tests (Decision 18). `CuesSection.dedupe.test.tsx` keeps its one test; it now asserts one `cue-wave-call-<ms>` after two clicks at the same spot.

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuePalette.test.tsx src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.dedupe.test.tsx`
Expected: FAIL, no `CuePalette`, no `cues-delete`, the active flow is ignored.

- [ ] **Step 3: Implement**

`src/renderer/src/components/CuePalette.tsx`:

```tsx
import type React from 'react'
import { HOT_CUE_PICKER, hotCueColor } from '../../../shared/rekordboxCueColors'

export function CuePalette({
  value,
  onPick,
  label,
}: {
  value: number | null
  onPick: (index: number) => void
  label: (index: number) => string
}): React.JSX.Element {
  return (
    <div data-testid="cue-palette" className="grid grid-cols-8 gap-1">
      {HOT_CUE_PICKER.map((index) => (
        <button
          key={index}
          type="button"
          data-testid={`cue-palette-${index}`}
          aria-label={label(index)}
          aria-pressed={value === index}
          onClick={() => onPick(index)}
          style={{ backgroundColor: hotCueColor(index) }}
          className={`press h-4 w-4 rounded-[3px] ${
            value === index ? 'ring-2 ring-[var(--color-fg)] ring-offset-1 ring-offset-[var(--color-panel)]' : ''
          }`}
        />
      ))}
    </div>
  )
}
```

`src/renderer/src/lib/cueFlowName.ts`:

```ts
import type { TFunction } from 'i18next'
import type { CueFlow } from '../../../shared/cueFlows'

export function flowName(flow: CueFlow, t: TFunction): string {
  return flow.name || t(`cueFlows.builtIn.${flow.id}`, { defaultValue: t('cueFlows.unnamed') })
}
```

`src/renderer/src/components/CuesSection.tsx`: `CuesSection` keeps its shell (header, unreadable, unanalysed). `Marking` and `LEGEND` are replaced by `Editing`:

```tsx
function Editing({
  read,
  queued,
  cue,
}: {
  read: TrackCues
  queued: WantedCue[] | null
  cue: CueTarget
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const ctx = useMemo(
    () => ({ beats: read.grid.map((b) => b.ms), strong: read.strong, phrases: read.phrases, flows }),
    [read, flows],
  )
  const inRekordbox = useMemo(() => read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color })), [read])
  const baseline = queued ?? inRekordbox
  const [state, dispatch] = useReducer(
    (s: CueDraft, a: DraftAction) => reduceDraft(s, a, ctx),
    undefined,
    () => startDraft(baseline, active.id),
  )
  const [menu, setMenu] = useState<{ ms: number; x: number; y: number } | null>(null)
  const [chosen, setChosen] = useState(state.flowId)
  const wanted = wantedOfDraft(state.cues)
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline)
  const pending = (c: DraftCue): boolean =>
    !inRekordbox.some(
      (r) => r.id === c.id && r.ms === c.ms && r.kind === c.kind && r.color === c.color,
    )
```

`unchanged` compares JSON because the draft starts as `baseline` mapped one to one (`wantedOfDraft` drops only the `key`) and every action that changes a cue goes through `commit`; an undo back to the start makes it equal again. `diffCues` and `isEmptyChange` are not needed in the section.

Markup, top to bottom inside `<div data-testid="cues-editor" className="relative" onKeyDown={onKey}>`:
- `CueWave` with `cues={state.cues.map((c) => ({ ...c, pending: pending(c) }))}`, `selected={state.selected}`, `trimmed={state.trimmed}`, `onMarkDrop={(ms) => dispatch({ type: 'mark-drop', ms })}`, `onUnmarkDrop={(key) => dispatch({ type: 'unmark-drop', key })}`, `onSelect={(key) => dispatch({ type: 'select', key })}`, `onMove={(key, ms) => dispatch({ type: 'move', key, ms })}`, `onMenu={setMenu}`.
- The menu when `menu !== null`: `<div data-testid="cues-menu" role="menu" style={{ left: menu.x, top: menu.y }} className="absolute z-20 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs shadow-lg">` with three `role="menuitem"` buttons (`cues-menu-add-hot` disabled when `state.cues.filter((c) => c.kind !== 0).length >= MAX_HOT_CUES`, `cues-menu-add-call`, `cues-menu-mark-drop`), each dispatching its action with `menu.ms` and then `setMenu(null)`. A `useEffect` while open closes it on `Escape` and on a `mousedown` outside it (document listeners, removed on close).
- Selection bar when `selected` is a cue: `<div data-testid="cues-selection" className="mt-2 flex flex-wrap items-center gap-3 text-xs">` with the title (`editor.cues.selectedHot` with its letter, or `editor.cues.selectedCall`), the delete button `cues-delete` (`editor.cues.delete`), and for a hot cue `CuePalette` (`value={cue.color}`, `onPick={(color) => dispatch({ type: 'recolour', key, color })}`, `label={(index) => tr('editor.cues.colour', { index })}`) and `<select data-testid="cues-letter" aria-label={tr('editor.cues.letter')} value={cue.kind}>` whose options are `freeLetters(state.cues, cue.kind)` shown with `cueLetter`, dispatching `reletter`.
- Notices: `cues-manual` (`editor.cues.manual`) for `state.notice === 'manual'`, `cues-too-many` (`editor.cues.tooMany`) for `'too-many'`, `cues-trimmed` (`editor.cues.trimmed`, `count: state.trimmed.length`) when `state.trimmed.length > 0`.
- Actions row (`cues-actions`): `<select data-testid="cues-flow" aria-label={tr('editor.cues.flow')} value={chosen}>` over `flows` with `flowName`; `cues-apply-flow` (`editor.cues.applyFlow`) dispatching `{ type: 'apply-flow', flowId: chosen }`; then, right-aligned, `cues-undo` (`editor.cues.discard`, disabled when `unchanged && queued === null`; it calls the `onDiscard` prop: `CuesSection` keeps `const [round, setRound] = useState(0)`, puts it in `Editing`'s key (`` `${read.fingerprint}|${JSON.stringify(queued)}|${round}` ``) and its `onDiscard` does `setRound((n) => n + 1)` plus, when a save is queued, `undoRekordboxCues(contentId)` and a refresh of the queued query, so the draft restarts from what rekordbox holds) and `cues-save` (`editor.cues.save`, disabled when `unchanged`, sends `{ contentId, path, label, wanted, fingerprint: read.fingerprint }`, then refreshes the queued query).
- `onKey`: `Backspace` or `Delete` with a selection dispatches `remove`; `z` with `metaKey` or `ctrlKey` dispatches `undo`; both `preventDefault()`. Nothing else is handled.

`Editing` takes `onDiscard: () => void` besides `read`, `queued` and `cue`.

Locales: remove `editor.cues.undo`, `legend16`, `legend32`, `legend48`, `legendStart` from the 5 files with Edit. Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-t12.json` and merge it:

```json
{
  "es": {
    "editor": { "cues": {
      "help": "Haz clic en la onda para marcar donde rompe y tu flujo pone el resto. Selecciona una cue para moverla, borrarla o cambiarle color o letra. Con el clic derecho añades una.",
      "discard": "Descartar cambios",
      "applyFlow": "Aplicar flujo",
      "flow": "Flujo",
      "delete": "Borrar",
      "colour": "Color {{index}}",
      "letter": "Letra",
      "selectedHot": "Hot cue {{letter}}",
      "selectedCall": "CALL",
      "menuAddHot": "Añadir hot cue aquí",
      "menuAddCall": "Añadir CALL aquí",
      "menuMarkDrop": "Marcar donde rompe aquí",
      "trimmed_one": "{{count}} hot cue se queda fuera por el límite de 8",
      "trimmed_other": "{{count}} hot cues se quedan fuera por el límite de 8"
    } },
    "cueFlows": { "unnamed": "Flujo sin nombre", "builtIn": { "mine": "Mi flujo", "one-at-32": "Una cue a 32", "calls-only": "Solo CALL" } }
  },
  "en": {
    "editor": { "cues": {
      "help": "Click the waveform to mark a drop and your flow sets the rest. Select a cue to move it, delete it or change its colour or letter. Right-click to add one.",
      "discard": "Discard changes",
      "applyFlow": "Apply flow",
      "flow": "Flow",
      "delete": "Delete",
      "colour": "Colour {{index}}",
      "letter": "Letter",
      "selectedHot": "Hot cue {{letter}}",
      "selectedCall": "CALL",
      "menuAddHot": "Add hot cue here",
      "menuAddCall": "Add CALL here",
      "menuMarkDrop": "Mark drop here",
      "trimmed_one": "{{count}} hot cue is left out by the limit of 8",
      "trimmed_other": "{{count}} hot cues are left out by the limit of 8"
    } },
    "cueFlows": { "unnamed": "Unnamed flow", "builtIn": { "mine": "My flow", "one-at-32": "One cue at 32", "calls-only": "CALL only" } }
  },
  "de": {
    "editor": { "cues": {
      "help": "Klicke auf die Wellenform, um einen Drop zu markieren, dein Ablauf setzt den Rest. Wähle ein Cue, um es zu verschieben, zu löschen oder Farbe und Buchstaben zu ändern. Mit Rechtsklick fügst du eins hinzu.",
      "discard": "Änderungen verwerfen",
      "applyFlow": "Ablauf anwenden",
      "flow": "Ablauf",
      "delete": "Löschen",
      "colour": "Farbe {{index}}",
      "letter": "Buchstabe",
      "selectedHot": "Hot Cue {{letter}}",
      "selectedCall": "CALL",
      "menuAddHot": "Hot Cue hier hinzufügen",
      "menuAddCall": "CALL hier hinzufügen",
      "menuMarkDrop": "Drop hier markieren",
      "trimmed_one": "{{count}} Hot Cue fällt wegen der Grenze von 8 weg",
      "trimmed_other": "{{count}} Hot Cues fallen wegen der Grenze von 8 weg"
    } },
    "cueFlows": { "unnamed": "Ablauf ohne Namen", "builtIn": { "mine": "Mein Ablauf", "one-at-32": "Ein Cue bei 32", "calls-only": "Nur CALL" } }
  },
  "fr": {
    "editor": { "cues": {
      "help": "Clique sur la forme d’onde pour marquer un drop et ton flux place le reste. Sélectionne un cue pour le déplacer, le supprimer ou changer sa couleur ou sa lettre. Clic droit pour en ajouter un.",
      "discard": "Annuler les changements",
      "applyFlow": "Appliquer le flux",
      "flow": "Flux",
      "delete": "Supprimer",
      "colour": "Couleur {{index}}",
      "letter": "Lettre",
      "selectedHot": "Hot cue {{letter}}",
      "selectedCall": "CALL",
      "menuAddHot": "Ajouter un hot cue ici",
      "menuAddCall": "Ajouter un CALL ici",
      "menuMarkDrop": "Marquer le drop ici",
      "trimmed_one": "{{count}} hot cue reste dehors à cause de la limite de 8",
      "trimmed_other": "{{count}} hot cues restent dehors à cause de la limite de 8"
    } },
    "cueFlows": { "unnamed": "Flux sans nom", "builtIn": { "mine": "Mon flux", "one-at-32": "Un cue à 32", "calls-only": "CALL seulement" } }
  },
  "pt-BR": {
    "editor": { "cues": {
      "help": "Clique na forma de onda para marcar um drop e seu fluxo põe o resto. Selecione um cue para movê-lo, apagá-lo ou mudar a cor ou a letra. Com o clique direito você adiciona um.",
      "discard": "Descartar alterações",
      "applyFlow": "Aplicar fluxo",
      "flow": "Fluxo",
      "delete": "Apagar",
      "colour": "Cor {{index}}",
      "letter": "Letra",
      "selectedHot": "Hot cue {{letter}}",
      "selectedCall": "CALL",
      "menuAddHot": "Adicionar hot cue aqui",
      "menuAddCall": "Adicionar CALL aqui",
      "menuMarkDrop": "Marcar drop aqui",
      "trimmed_one": "{{count}} hot cue fica de fora pelo limite de 8",
      "trimmed_other": "{{count}} hot cues ficam de fora pelo limite de 8"
    } },
    "cueFlows": { "unnamed": "Fluxo sem nome", "builtIn": { "mine": "Meu fluxo", "one-at-32": "Um cue a 32", "calls-only": "Só CALL" } }
  }
}
```

- [ ] **Step 4: Run tests, types, lint**

`CuePalette.test.tsx`, `CuesSection.test.tsx`, `CuesSection.dedupe.test.tsx`, `CueWave.test.tsx`, `Editor.test.tsx`, `src/renderer/src/i18n/index.test.ts` and the i18n keys test (`rg -l "keys.test" $WT/apps/desktop/src/renderer/src/i18n`): PASS. Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CuePalette.tsx apps/desktop/src/renderer/src/components/CuePalette.test.tsx apps/desktop/src/renderer/src/lib/cueFlowName.ts apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.dedupe.test.tsx apps/desktop/src/renderer/src/i18n/locales
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Turn the Cues section into an editor of hot cues and CALLs"
```

---

### Task 13: The configurator in Settings › Cues

**Files:**
- Create: `src/renderer/src/lib/cueExample.ts` (+ test `cueExample.test.ts`), `src/renderer/src/components/CueFlowPreview.tsx` (+ test), `src/renderer/src/components/CueRuleRow.tsx`, `src/renderer/src/components/settings/CuesTab.tsx` (+ test `CuesTab.test.tsx`)
- Modify: `src/renderer/src/lib/settingsTabs.ts` (`'cues'` tab, icon `Flag`), `src/renderer/src/components/SettingsModal.tsx` (render it), `src/renderer/src/i18n/locales/*.json` (`settings.tabs.cues`, `settings.cueFlows.*`)

**Interfaces:**
- Consumes: `flowOutcome` (shared/cueRules); `CueFlow`, `CueRule`, `MY_FLOW_ID`, `RULE_BARS`, `FLOW_ORIGINS`, `FLOW_CONDITIONS`, `FLOW_PLACES`, `restoreMyFlow`, `activeCueFlow` (Task 1); `CueWave`, `WaveCue` (Task 11); `CuePalette`, `flowName` (Task 12); `SyncedDraft.cueFlows/activeCueFlow`, `PatchSynced` (Task 6).
- Produces:
  - from `lib/cueExample.ts`: `EXAMPLE_GRID: { ms: number; beat: number }[]`, `EXAMPLE_DROP: number`, `EXAMPLE_DURATION_MS: number`, `EXAMPLE_PHRASES: FlowPhrase[]`, `EXAMPLE_STRONG: StrongPart[]`, `EXAMPLE_WAVE: CueWaveColumn[]`, `exampleBar(n: number): number`, `examplePlan(flow: CueFlow): FlowOutcome`
  - `CueFlowPreview({ flow }: { flow: CueFlow })`, test ids `cue-flow-preview`, `cue-preview-too-many`, `cue-preview-trimmed`
  - `CueRuleRow({ rule, index, onChange, onRemove }: { rule: CueRule; index: number; onChange: (rule: CueRule) => void; onRemove: () => void })`, test ids `cue-rule-<index>`, `cue-rule-<index>-from|direction|bars|repeat|when|place|color-mode`, `cue-rule-<index>-color-<slot>`, `cue-rule-<index>-remove`, `cue-rule-<index>-loose-call`
  - `CuesTab({ synced, patch }: { synced: SyncedDraft; patch: PatchSynced })`, test ids `cue-flows`, `cue-flow-<id>`, `cue-flow-new`, `cue-flow-name`, `cue-flow-use`, `cue-flow-in-use`, `cue-flow-delete`, `cue-flow-restore`, `cue-rule-add`, `cue-flow-no-rules`

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/cueExample.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CALLS_ONLY, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import { EXAMPLE_DROP, EXAMPLE_DURATION_MS, EXAMPLE_GRID, exampleBar, examplePlan } from './cueExample'

describe('the example track', () => {
  it('is 192 bars at 128 BPM with the drop at bar 64', () => {
    expect(EXAMPLE_GRID).toHaveLength(768)
    expect(EXAMPLE_GRID[1].ms - EXAMPLE_GRID[0].ms).toBe(469)
    expect(EXAMPLE_DROP).toBe(exampleBar(64))
    expect(EXAMPLE_DURATION_MS).toBe(360000)
  })

  it('shows Mi flujo as the countdown Vicent knows', () => {
    const out = examplePlan(MY_FLOW)
    expect(out.status === 'plan' && out.hot.map((h) => [h.ms, h.color])).toEqual([
      [exampleBar(16), 42],
      [exampleBar(32), 22],
      [exampleBar(48), 1],
    ])
  })

  it('shows the other bundled flows doing what their names say', () => {
    const one = examplePlan(ONE_AT_32)
    expect(one.status === 'plan' && one.wanted).toEqual([
      { ms: EXAMPLE_DROP, kind: 0, color: null },
      { ms: exampleBar(32), kind: 1, color: 22 },
    ])
    const calls = examplePlan(CALLS_ONLY)
    expect(calls.status === 'plan' && calls.wanted).toEqual([{ ms: EXAMPLE_DROP, kind: 0, color: null }])
  })
})
```

(`469` is `Math.round(468.75)`; 768 beats of 468.75 ms are exactly 360000 ms.)

`src/renderer/src/components/CueFlowPreview.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import '../i18n'
import { CueFlowPreview } from './CueFlowPreview'

afterEach(cleanup)

describe('CueFlowPreview', () => {
  it('draws the flow on the example track with the drop marked and nothing to click', () => {
    render(<CueFlowPreview flow={MY_FLOW} />)
    expect(screen.getByTestId('cue-wave-hot-A')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^cue-wave-call-/)).toHaveLength(4)
    expect(screen.getByTestId('cue-wave')).toHaveAttribute('tabindex', '-1')
  })

  it('draws a hot cue without CALL for a flow that places only hot cues', () => {
    render(<CueFlowPreview flow={ONE_AT_32} />)
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(1)
    expect(screen.getAllByTestId(/^cue-wave-call-/)).toHaveLength(1)
  })

  it('says when a flow asks for more than 8 hot cues', () => {
    const many = {
      ...ONE_AT_32,
      rules: [{ ...ONE_AT_32.rules[0], from: 'first-beat' as const, direction: 'forward' as const, bars: 8, repeat: 'edge' as const, when: 'always' as const }],
    }
    render(<CueFlowPreview flow={many} />)
    expect(screen.getByTestId('cue-preview-trimmed')).toBeInTheDocument()
  })
})
```

(A forward rule from the first beat every 8 bars to the edge plans 23 hot cues; 15 of them are left out by the limit, so the preview shows the trimmed notice and stays a plan.)

Add one more test for the other notice, a flow of nine single cues at the same distance from nine different spots, which nothing can trim:

```tsx
  it('says when a flow asks for more than 8 hot cues that cannot be left out', () => {
    const one = ONE_AT_32.rules[0]
    const nine = {
      ...ONE_AT_32,
      rules: [8, 24, 40, 56, 72, 88, 104, 120, 136].map((bars) => ({
        ...one,
        from: 'first-beat' as const,
        direction: 'forward' as const,
        bars,
        when: 'always' as const,
      })),
    }
    render(<CueFlowPreview flow={nine} />)
    expect(screen.getByTestId('cue-preview-too-many')).toBeInTheDocument()
  })
```

`src/renderer/src/components/settings/CuesTab.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_FLOWS, MY_FLOW } from '../../../../shared/cueFlows'
import '../../i18n'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { CuesTab } from './CuesTab'

afterEach(cleanup)

let last: Pick<SyncedDraft, 'cueFlows' | 'activeCueFlow'> | null = null

function Harness({ active = 'mine' }: { active?: string }) {
  const [draft, setDraft] = useState({ cueFlows: BUNDLED_FLOWS, activeCueFlow: active })
  last = draft
  return (
    <CuesTab
      synced={draft as unknown as SyncedDraft}
      patch={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
    />
  )
}

describe('CuesTab', () => {
  it('lists the bundled flows by their translated names with Mi flujo in use', () => {
    render(<Harness />)
    expect(within(screen.getByTestId('cue-flows')).getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Mi flujo', 'Una cue a 32', 'Solo CALL']),
    )
    expect(screen.getByTestId('cue-flow-in-use')).toBeInTheDocument()
  })

  it('recalculates the preview live when a block changes', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('cue-rule-0-repeat'), { target: { value: '1' } })
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.rules[0].repeat).toBe(1)
  })

  it('adds and removes a rule', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-flow-calls-only'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-add'))
    expect(screen.getByTestId('cue-rule-0')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-rule-0-remove'))
    expect(screen.getByTestId('cue-flow-no-rules')).toBeInTheDocument()
  })

  it('hides direction and repeat for a cue on the origin itself', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-rule-1-direction')).toBeNull()
    expect(screen.queryByTestId('cue-rule-1-repeat')).toBeNull()
  })

  it('warns that a loose CALL from a rule reads as a drop next time', () => {
    render(<Harness />)
    fireEvent.change(screen.getByTestId('cue-rule-0-place'), { target: { value: 'call' } })
    expect(screen.getByTestId('cue-rule-0-loose-call')).toBeInTheDocument()
    expect(screen.queryByTestId('cue-rule-0-color-mode')).toBeNull()
  })

  it('creates a flow, names it and makes it the one in use', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('cue-flow-new'))
    fireEvent.change(screen.getByTestId('cue-flow-name'), { target: { value: 'Mis 64' } })
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    const made = last?.cueFlows.find((f) => f.name === 'Mis 64')
    expect(made).toBeDefined()
    expect(last?.activeCueFlow).toBe(made?.id)
  })

  it('never offers to delete Mi flujo but restores it to rules.py', () => {
    render(<Harness />)
    expect(screen.queryByTestId('cue-flow-delete')).toBeNull()
    fireEvent.change(screen.getByTestId('cue-rule-0-bars'), { target: { value: '8' } })
    fireEvent.click(screen.getByTestId('cue-flow-restore'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')).toEqual(MY_FLOW)
  })

  it('deletes another flow and falls back to Mi flujo when it was in use', () => {
    render(<Harness active="one-at-32" />)
    fireEvent.click(screen.getByTestId('cue-flow-one-at-32'))
    fireEvent.click(screen.getByTestId('cue-flow-delete'))
    expect(last?.cueFlows.map((f) => f.id)).toEqual(['mine', 'calls-only'])
    expect(last?.activeCueFlow).toBe('mine')
  })
})
```

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueExample.test.ts src/renderer/src/components/CueFlowPreview.test.tsx src/renderer/src/components/settings/CuesTab.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/cueExample.ts`:

```ts
import type { CueFlow, FlowPhrase, PhraseKind } from '../../../shared/cueFlows'
import { type FlowOutcome, flowOutcome, type StrongPart } from '../../../shared/cueRules'
import type { CueWaveColumn } from '../../../shared/types'

const BEAT_MS = 60000 / 128
const BARS = 192

export const EXAMPLE_GRID = Array.from({ length: BARS * 4 }, (_, i) => ({
  ms: Math.round(i * BEAT_MS),
  beat: (i % 4) + 1,
}))

export const exampleBar = (n: number): number => EXAMPLE_GRID[n * 4].ms
export const EXAMPLE_DROP = exampleBar(64)
export const EXAMPLE_DURATION_MS = Math.round(BARS * 4 * BEAT_MS)

const SECTIONS: [number, PhraseKind][] = [
  [0, 'intro'],
  [32, 'up'],
  [64, 'chorus'],
  [96, 'down'],
  [112, 'up'],
  [128, 'chorus'],
  [160, 'outro'],
]

export const EXAMPLE_PHRASES: FlowPhrase[] = SECTIONS.map(([bar, kind]) => ({ ms: exampleBar(bar), kind }))

export const EXAMPLE_STRONG: StrongPart[] = [
  { start: exampleBar(64), end: exampleBar(96) },
  { start: exampleBar(128), end: exampleBar(160) },
]

const LEVEL: Record<PhraseKind, number> = { intro: 0.35, up: 0.55, chorus: 0.95, down: 0.45, outro: 0.3 }

export const EXAMPLE_WAVE: CueWaveColumn[] = Array.from({ length: BARS }, (_, bar) => {
  const kind = [...SECTIONS].reverse().find(([start]) => start <= bar)?.[1] ?? 'intro'
  return { h: LEVEL[kind] * (bar % 4 === 0 ? 1 : 0.85), rgb: null }
})

export function examplePlan(flow: CueFlow): FlowOutcome {
  return flowOutcome({
    existing: [],
    drops: [EXAMPLE_DROP],
    previousDrops: [],
    beats: EXAMPLE_GRID.map((b) => b.ms),
    strong: EXAMPLE_STRONG,
    phrases: EXAMPLE_PHRASES,
    flow,
  })
}
```

`src/renderer/src/components/CueFlowPreview.tsx`:

```tsx
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CueFlow } from '../../../shared/cueFlows'
import { EXAMPLE_DURATION_MS, EXAMPLE_GRID, EXAMPLE_WAVE, examplePlan } from '../lib/cueExample'
import { CueWave } from './CueWave'

export function CueFlowPreview({ flow }: { flow: CueFlow }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const out = examplePlan(flow)
  const cues =
    out.status === 'too-many'
      ? []
      : out.wanted.map((c, i) => ({ ...c, key: `${i}`, pending: false }))
  return (
    <div data-testid="cue-flow-preview">
      <CueWave
        wave={EXAMPLE_WAVE}
        grid={EXAMPLE_GRID}
        durationMs={EXAMPLE_DURATION_MS}
        cues={cues}
        trimmed={out.status === 'plan' ? out.trimmed : []}
        readOnly
      />
      <p className="mt-1 text-[11px] text-fg-dim">{tr('settings.cueFlows.previewHint')}</p>
      {out.status === 'too-many' && (
        <p data-testid="cue-preview-too-many" className="mt-1 text-xs text-warn">
          {tr('settings.cueFlows.tooMany', { count: out.needed })}
        </p>
      )}
      {out.status === 'plan' && out.trimmed.length > 0 && (
        <p data-testid="cue-preview-trimmed" className="mt-1 text-xs text-fg-dim">
          {tr('editor.cues.trimmed', { count: out.trimmed.length })}
        </p>
      )}
    </div>
  )
}
```

`src/renderer/src/components/CueRuleRow.tsx`: one row (`<div data-testid={`cue-rule-${index}`} className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1.5 text-xs">`) of native `<select>`s, each with an `aria-label` from `settings.cueFlows.block.*` and option texts from `settings.cueFlows.*`:
- `from` over `FLOW_ORIGINS` (`settings.cueFlows.from.<value>`),
- `bars` over `RULE_BARS` (`settings.cueFlows.bars`, `{ count }`, and `settings.cueFlows.barsZero` for 0); on change to 0 set `repeat: 1`,
- when `bars > 0`: `direction` (`back`/`forward`) and `repeat` (1 to 8 and `edge`; `settings.cueFlows.repeat` with `count`, `settings.cueFlows.repeatEdge`); the select's value for `edge` is `'edge'` and a number otherwise, parsed back with `Number`,
- `when` over `FLOW_CONDITIONS`,
- `place` over `FLOW_PLACES`; when it is `call`, render `<p data-testid={`cue-rule-${index}-loose-call`} className="basis-full text-[11px] text-fg-dim">{tr('settings.cueFlows.looseCall')}</p>` and no colour blocks,
- otherwise `color-mode` (`fixed`/`each`) and colour slots: one slot for `fixed`, `min(repeat, 8)` slots for `each` with a number repeat and 3 for `edge`; each slot is a button `cue-rule-<index>-color-<slot>` painted with `hotCueColor` that toggles a popover holding `CuePalette` (picking writes the slot: `{ fixed: index }`, or `each` with that slot replaced, padding missing slots with the last colour),
- `×` button `cue-rule-<index>-remove` (`aria-label` `settings.cueFlows.removeRule`).
Every change calls `onChange({ ...rule, <field>: value })`.

`src/renderer/src/components/settings/CuesTab.tsx`: local `const [current, setCurrent] = useState(synced.activeCueFlow)`; `const flows = synced.cueFlows`; `const flow = flows.find((f) => f.id === current) ?? activeCueFlow(synced)`; `const put = (next: CueFlow) => patch('cueFlows', flows.map((f) => (f.id === next.id ? next : f)))`. Layout `grid grid-cols-[10rem_1fr] gap-4`:
- left `<div data-testid="cue-flows">`: a button per flow `cue-flow-<id>` (`flowName`, selected style when `id === flow.id`), then `cue-flow-new` (`settings.cueFlows.newFlow`) which appends `{ id: crypto.randomUUID(), name: tr('settings.cueFlows.newFlowName', { n: flows.length + 1 }), rules: [NEW_RULE] }` with `NEW_RULE = { from: 'drop', direction: 'back', bars: 16, repeat: 1, when: 'fits', place: 'both', color: { fixed: 1 } }` and selects it;
- right: name `<input data-testid="cue-flow-name" value={flow.name} placeholder={flowName(flow, tr)}>` (writes `name`); `cue-flow-in-use` badge (`settings.cueFlows.inUse`) when `synced.activeCueFlow === flow.id`, else button `cue-flow-use` (`settings.cueFlows.use`) → `patch('activeCueFlow', flow.id)`; `cue-flow-restore` (`settings.cueFlows.restore`) only for `MY_FLOW_ID` → `patch('cueFlows', restoreMyFlow(flows))`; `cue-flow-delete` (`settings.cueFlows.delete`) for every other flow → `patch('cueFlows', flows.filter((f) => f.id !== flow.id))`, then `patch('activeCueFlow', MY_FLOW_ID)` when it was active, and `setCurrent(MY_FLOW_ID)`;
- rules: heading `settings.cueFlows.rules`, `CueRuleRow` per rule (`onChange` replaces rule `i`, `onRemove` filters it), `cue-flow-no-rules` (`settings.cueFlows.noRules`) when there are none, `cue-rule-add` (`settings.cueFlows.addRule`) appending `NEW_RULE`;
- preview: heading `settings.cueFlows.preview`, `<CueFlowPreview flow={flow} />`.

`settingsTabs.ts`: add `'cues'` to `SettingsTab`, to the `editing` group after `'artwork'`, and `cues: Flag` to the icons (import `Flag` from `lucide-react`). `SettingsModal.tsx`: `{tab === 'cues' && <CuesTab synced={synced} patch={patch} />}`.

Locales: write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-t13.json` and merge it. Spanish, the reference (the other four translate the same keys with "drop" where Spanish says "donde rompe"):

```json
{
  "es": { "settings": {
    "tabs": { "cues": "Cues" },
    "cueFlows": {
      "flows": "Flujos", "newFlow": "Nuevo flujo", "newFlowName": "Flujo {{n}}",
      "name": "Nombre", "use": "Usar este flujo", "inUse": "En uso",
      "delete": "Borrar flujo", "restore": "Restablecer",
      "rules": "Reglas", "addRule": "Añadir regla", "removeRule": "Quitar regla",
      "noRules": "Sin reglas. Marcar donde rompe deja solo el CALL.",
      "preview": "Vista previa",
      "previewHint": "Pista de ejemplo a 128 BPM con donde rompe en el compás 64",
      "tooMany": "Este flujo pide {{count}} hot cues y rekordbox admite 8",
      "looseCall": "Un CALL suelto se lee como donde rompe la próxima vez",
      "block": { "from": "Desde", "direction": "Sentido", "bars": "Distancia", "repeat": "Repetir", "when": "Condición", "place": "Pon", "colorMode": "Color", "color": "Color {{n}}" },
      "from": { "drop": "Desde donde rompe", "first-beat": "Desde el primer golpe", "last-beat": "Desde el último golpe", "intro": "Desde cada intro", "up": "Desde cada subida", "down": "Desde cada bajada", "chorus": "Desde cada estribillo", "outro": "Desde cada outro" },
      "direction": { "back": "hacia atrás", "forward": "hacia delante" },
      "bars_one": "{{count}} compás", "bars_other": "{{count}} compases", "barsZero": "en el mismo golpe",
      "repeat_one": "1 vez", "repeat_other": "{{count}} veces", "repeatEdge": "hasta el borde",
      "when": { "always": "siempre", "fits": "si cabe", "clear": "si no cuadra con otra regla", "first": "si no hay otra antes de donde rompe" },
      "place": { "hot": "hot cue", "call": "CALL", "both": "hot cue + CALL" },
      "colorMode": { "fixed": "un color", "each": "un color por repetición" }
    }
  } },
  "en": { "settings": {
    "tabs": { "cues": "Cues" },
    "cueFlows": {
      "flows": "Flows", "newFlow": "New flow", "newFlowName": "Flow {{n}}",
      "name": "Name", "use": "Use this flow", "inUse": "In use",
      "delete": "Delete flow", "restore": "Restore",
      "rules": "Rules", "addRule": "Add rule", "removeRule": "Remove rule",
      "noRules": "No rules. Marking a drop leaves only its CALL.",
      "preview": "Preview",
      "previewHint": "Example track at 128 BPM with the drop at bar 64",
      "tooMany": "This flow asks for {{count}} hot cues and rekordbox allows 8",
      "looseCall": "A loose CALL reads as a drop the next time",
      "block": { "from": "From", "direction": "Direction", "bars": "Distance", "repeat": "Repeat", "when": "Condition", "place": "Place", "colorMode": "Colour", "color": "Colour {{n}}" },
      "from": { "drop": "From the drop", "first-beat": "From the first beat", "last-beat": "From the last beat", "intro": "From each intro", "up": "From each build", "down": "From each breakdown", "chorus": "From each chorus", "outro": "From each outro" },
      "direction": { "back": "backwards", "forward": "forwards" },
      "bars_one": "{{count}} bar", "bars_other": "{{count}} bars", "barsZero": "on the same beat",
      "repeat_one": "once", "repeat_other": "{{count}} times", "repeatEdge": "to the edge",
      "when": { "always": "always", "fits": "if it fits", "clear": "if it does not clash with another rule", "first": "if there is none before the drop" },
      "place": { "hot": "hot cue", "call": "CALL", "both": "hot cue + CALL" },
      "colorMode": { "fixed": "one colour", "each": "a colour per repeat" }
    }
  } },
  "de": { "settings": {
    "tabs": { "cues": "Cues" },
    "cueFlows": {
      "flows": "Abläufe", "newFlow": "Neuer Ablauf", "newFlowName": "Ablauf {{n}}",
      "name": "Name", "use": "Diesen Ablauf verwenden", "inUse": "Aktiv",
      "delete": "Ablauf löschen", "restore": "Zurücksetzen",
      "rules": "Regeln", "addRule": "Regel hinzufügen", "removeRule": "Regel entfernen",
      "noRules": "Keine Regeln. Ein markierter Drop setzt nur seinen CALL.",
      "preview": "Vorschau",
      "previewHint": "Beispieltitel mit 128 BPM und Drop in Takt 64",
      "tooMany": "Dieser Ablauf verlangt {{count}} Hot Cues und rekordbox erlaubt 8",
      "looseCall": "Ein einzelner CALL wird beim nächsten Mal als Drop gelesen",
      "block": { "from": "Ab", "direction": "Richtung", "bars": "Abstand", "repeat": "Wiederholen", "when": "Bedingung", "place": "Setzen", "colorMode": "Farbe", "color": "Farbe {{n}}" },
      "from": { "drop": "Ab dem Drop", "first-beat": "Ab dem ersten Schlag", "last-beat": "Ab dem letzten Schlag", "intro": "Ab jedem Intro", "up": "Ab jedem Aufbau", "down": "Ab jedem Breakdown", "chorus": "Ab jedem Refrain", "outro": "Ab jedem Outro" },
      "direction": { "back": "rückwärts", "forward": "vorwärts" },
      "bars_one": "{{count}} Takt", "bars_other": "{{count}} Takte", "barsZero": "auf demselben Schlag",
      "repeat_one": "einmal", "repeat_other": "{{count}} Mal", "repeatEdge": "bis zum Rand",
      "when": { "always": "immer", "fits": "wenn es passt", "clear": "wenn es mit keiner anderen Regel kollidiert", "first": "wenn vor dem Drop keins ist" },
      "place": { "hot": "Hot Cue", "call": "CALL", "both": "Hot Cue + CALL" },
      "colorMode": { "fixed": "eine Farbe", "each": "eine Farbe pro Wiederholung" }
    }
  } },
  "fr": { "settings": {
    "tabs": { "cues": "Cues" },
    "cueFlows": {
      "flows": "Flux", "newFlow": "Nouveau flux", "newFlowName": "Flux {{n}}",
      "name": "Nom", "use": "Utiliser ce flux", "inUse": "Utilisé",
      "delete": "Supprimer le flux", "restore": "Rétablir",
      "rules": "Règles", "addRule": "Ajouter une règle", "removeRule": "Retirer la règle",
      "noRules": "Aucune règle. Marquer un drop ne laisse que son CALL.",
      "preview": "Aperçu",
      "previewHint": "Morceau d’exemple à 128 BPM avec le drop à la mesure 64",
      "tooMany": "Ce flux demande {{count}} hot cues et rekordbox en accepte 8",
      "looseCall": "Un CALL seul se lit comme un drop la fois suivante",
      "block": { "from": "Depuis", "direction": "Sens", "bars": "Distance", "repeat": "Répéter", "when": "Condition", "place": "Placer", "colorMode": "Couleur", "color": "Couleur {{n}}" },
      "from": { "drop": "Depuis le drop", "first-beat": "Depuis le premier temps", "last-beat": "Depuis le dernier temps", "intro": "Depuis chaque intro", "up": "Depuis chaque montée", "down": "Depuis chaque descente", "chorus": "Depuis chaque refrain", "outro": "Depuis chaque outro" },
      "direction": { "back": "en arrière", "forward": "en avant" },
      "bars_one": "{{count}} mesure", "bars_other": "{{count}} mesures", "barsZero": "sur le même temps",
      "repeat_one": "1 fois", "repeat_other": "{{count}} fois", "repeatEdge": "jusqu’au bord",
      "when": { "always": "toujours", "fits": "si ça rentre", "clear": "si ça ne tombe pas sur une autre règle", "first": "s’il n’y en a pas avant le drop" },
      "place": { "hot": "hot cue", "call": "CALL", "both": "hot cue + CALL" },
      "colorMode": { "fixed": "une couleur", "each": "une couleur par répétition" }
    }
  } },
  "pt-BR": { "settings": {
    "tabs": { "cues": "Cues" },
    "cueFlows": {
      "flows": "Fluxos", "newFlow": "Novo fluxo", "newFlowName": "Fluxo {{n}}",
      "name": "Nome", "use": "Usar este fluxo", "inUse": "Em uso",
      "delete": "Apagar fluxo", "restore": "Restaurar",
      "rules": "Regras", "addRule": "Adicionar regra", "removeRule": "Remover regra",
      "noRules": "Sem regras. Marcar um drop deixa só o CALL.",
      "preview": "Prévia",
      "previewHint": "Faixa de exemplo a 128 BPM com o drop no compasso 64",
      "tooMany": "Este fluxo pede {{count}} hot cues e o rekordbox aceita 8",
      "looseCall": "Um CALL solto é lido como drop na próxima vez",
      "block": { "from": "A partir de", "direction": "Sentido", "bars": "Distância", "repeat": "Repetir", "when": "Condição", "place": "Pôr", "colorMode": "Cor", "color": "Cor {{n}}" },
      "from": { "drop": "A partir do drop", "first-beat": "A partir do primeiro tempo", "last-beat": "A partir do último tempo", "intro": "A partir de cada intro", "up": "A partir de cada subida", "down": "A partir de cada descida", "chorus": "A partir de cada refrão", "outro": "A partir de cada outro" },
      "direction": { "back": "para trás", "forward": "para frente" },
      "bars_one": "{{count}} compasso", "bars_other": "{{count}} compassos", "barsZero": "no mesmo tempo",
      "repeat_one": "1 vez", "repeat_other": "{{count}} vezes", "repeatEdge": "até a borda",
      "when": { "always": "sempre", "fits": "se couber", "clear": "se não coincidir com outra regra", "first": "se não houver outra antes do drop" },
      "place": { "hot": "hot cue", "call": "CALL", "both": "hot cue + CALL" },
      "colorMode": { "fixed": "uma cor", "each": "uma cor por repetição" }
    }
  } }
}
```

- [ ] **Step 4: Run tests, types, lint**

The three new test files plus `SettingsModal.test.tsx` (its tab count and roving-tabindex tests read `SETTINGS_TABS`, so they follow), `CueWave.test.tsx`, `src/renderer/src/i18n/index.test.ts`, the keys test: PASS. Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Look at it**

Build (`npm --prefix $WT/apps/desktop run build`), open Settings › Cues with the run-desktop driver and screenshot the tab with Mi flujo selected into `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues/configurator.png`. Compare with the sketch "Configurador de cues" (https://claude.ai/artifact/S3bRmjsDFmeNe7ENkYsQFC): flows on the left, rule rows in the centre, preview below, CALLs under their hot cues at one height.

- [ ] **Step 6: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueExample.ts apps/desktop/src/renderer/src/lib/cueExample.test.ts apps/desktop/src/renderer/src/components/CueFlowPreview.tsx apps/desktop/src/renderer/src/components/CueFlowPreview.test.tsx apps/desktop/src/renderer/src/components/CueRuleRow.tsx apps/desktop/src/renderer/src/components/settings/CuesTab.tsx apps/desktop/src/renderer/src/components/settings/CuesTab.test.tsx apps/desktop/src/renderer/src/lib/settingsTabs.ts apps/desktop/src/renderer/src/components/SettingsModal.tsx apps/desktop/src/renderer/src/i18n/locales
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Build cue flows from blocks in Settings with a live preview on an example track"
```

---

### Task 14: Propose drops, and measure them against Vicent's collection

Steps 1 to 5 are a normal task (the pure function and the gated measurement test); Steps 6 and 7 are done by the controller, who reads the test copy.

**Files:**
- Modify: `src/shared/cueRules.ts` (`proposeDrops`)
- Test: `src/shared/cueRulesFlows.test.ts`
- Create: `src/main/autoDropsMeasure.test.ts`
- Modify (Step 7): `docs/superpowers/specs/2026-10-19-editor-cues-design.md`

**Interfaces:**
- Consumes: `StrongPart`, `SAME_POSITION_MS` (shared/cueRules); `readTrackCues` (main/rekordboxCues); `openRekordboxDb`, `rekordboxRawKey` (main/rekordboxDb); `rekordboxShareDir` (main/rekordboxArtwork).
- Produces: `proposeDrops(strong: StrongPart[], drops: number[]): number[]` (the start of each strong part, once, in time order, leaving out those within 50 ms of a drop already marked).

- [ ] **Step 1: Write the failing test**

Append to `src/shared/cueRulesFlows.test.ts` (import `proposeDrops`):

```ts
describe('proposeDrops', () => {
  it('proposes where each strong part starts and nothing already marked', () => {
    const strong = [
      { start: beat(64), end: beat(96) },
      { start: beat(128), end: beat(160) },
      { start: beat(128), end: beat(144) },
    ]
    expect(proposeDrops(strong, [beat(64) + 20])).toEqual([beat(128)])
  })

  it('proposes nothing without phrase analysis', () => {
    expect(proposeDrops([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run, see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueRulesFlows.test.ts`
Expected: FAIL, `proposeDrops` is not exported.

- [ ] **Step 3: Implement**

In `src/shared/cueRules.ts`:

```ts
export function proposeDrops(strong: StrongPart[], drops: number[]): number[] {
  return [...new Set(strong.map((s) => s.start))]
    .filter((ms) => drops.every((d) => !near(d, ms)))
    .sort((a, b) => a - b)
}
```

Create `src/main/autoDropsMeasure.test.ts`:

```ts
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDrops, nearestBeat, proposeDrops } from '../shared/cueRules'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readTrackCues } from './rekordboxCues'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'

const copy = process.env.SURCO_AUTO_DROPS_DB
const SCRATCH = '/private/tmp/claude-501/'

function barOf(grid: { ms: number; beat: number }[], ms: number): number {
  const index = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  return grid.slice(0, index + 1).filter((b) => b.beat === 1).length
}

describe.skipIf(!copy)('Auto proposals against the drops the DJ marked', () => {
  it('counts the drops a proposal lands in the same bar of, on a copy only', async () => {
    const path = resolve(copy as string)
    expect(path.startsWith(SCRATCH) && !path.includes('/Library/Pioneer')).toBe(true)
    const db =
      openRekordboxDb(path, { readonly: true }) ??
      openRekordboxDb(path, { readonly: true, key: await rekordboxRawKey(path) })
    if (!db) throw new Error('the copy did not open')
    const ids = db
      .prepare('SELECT DISTINCT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0')
      .all() as { ContentID: string }[]
    const tally = { tracks: 0, noPhrases: 0, drops: 0, hit: 0, proposals: 0, right: 0 }
    for (const { ContentID } of ids) {
      const read = readTrackCues(db, rekordboxShareDir(path), String(ContentID), { wave: false })
      if (!read?.analysed) continue
      const mine = findDrops(
        read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
        read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
      )
      if (mine.length === 0) continue
      tally.tracks++
      if (read.phrases.length === 0) {
        tally.noPhrases++
        continue
      }
      const offered = proposeDrops(read.strong, [])
      const offeredBars = new Set(offered.map((ms) => barOf(read.grid, ms)))
      const mineBars = new Set(mine.map((ms) => barOf(read.grid, ms)))
      tally.drops += mine.length
      tally.hit += mine.filter((ms) => offeredBars.has(barOf(read.grid, ms))).length
      tally.proposals += offered.length
      tally.right += offered.filter((ms) => mineBars.has(barOf(read.grid, ms))).length
    }
    db.close()
    console.log(
      JSON.stringify({
        ...tally,
        recall: tally.drops ? tally.hit / tally.drops : null,
        precision: tally.proposals ? tally.right / tally.proposals : null,
      }),
    )
    expect(tally.tracks).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 4: Run tests, types, lint**

`src/shared/cueRulesFlows.test.ts` and `src/main/autoDropsMeasure.test.ts` (without the variable it is reported skipped, which is its intended state in every normal run, like `spectrumSweep.test.ts`): PASS. Both `tsc`, `check`: clean; status only the three files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/cueRules.ts apps/desktop/src/shared/cueRulesFlows.test.ts apps/desktop/src/main/autoDropsMeasure.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Propose drops from rekordbox's strong parts and measure them against marked drops"
```

- [ ] **Step 6: Measure (controller)**

Confirm `rb-b/share` holds ANLZ files (`ls /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-b/share/PIONEER/USBANLZ | head`). Run:

`SURCO_AUTO_DROPS_DB=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-b/master.db npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/autoDropsMeasure.test.ts`

Read the JSON line: tracks with drops, how many lack phrases, drops, drops hit, proposals, proposals right, recall, precision.

- [ ] **Step 7: Record and decide (controller)**

Add a section "Medido: botón Auto (fecha)" at the end of the spec with the six counts, recall and precision (as measured, not rounded into a pass), the copy it ran on and the command. Apply Decision 20: recall ≥ 0.70, run Task 15; below, write "No sale: acierta X de Y. Queda pendiente." in that section and skip Task 15. Commit only the spec: `git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add docs/superpowers/specs/2026-10-19-editor-cues-design.md` and `git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Record how often the Auto proposals land on the drops Vicent marked"`.

---

### Task 15: The Auto button (only if Task 14 clears the bar)

**Files:**
- Modify: `src/renderer/src/components/CuesSection.tsx`, `src/renderer/src/i18n/locales/*.json` (`editor.cues.auto`, `editor.cues.autoNone`)
- Test: `src/renderer/src/components/CuesSection.test.tsx`

**Interfaces:**
- Consumes: `proposeDrops` (Task 14); `draftDrops` (Task 10); `CueWave` `proposals`/`onAcceptProposal` (Task 11).
- Produces: a toggle button `cues-auto` (`aria-pressed`), shown only when `read.strong.length > 0`; while on, `CueWave` gets `proposals={proposeDrops(read.strong, draftDrops(state.cues))}` and `onAcceptProposal={(ms) => dispatch({ type: 'mark-drop', ms })}`; with nothing left to propose, `cues-auto-none` (`editor.cues.autoNone`).

- [ ] **Step 1: Write the failing tests**

In `CuesSection.test.tsx`:

```tsx
  it('offers no Auto without rekordbox phrase analysis', async () => {
    setup()
    await ready()
    expect(screen.queryByTestId('cues-auto')).toBeNull()
  })

  it('proposes drops dashed and writes nothing until one is accepted', async () => {
    const { saveRekordboxCues } = setup({ ...READ, strong: [{ start: bar(64), end: bar(96) }] })
    await ready()
    fireEvent.click(screen.getByTestId('cues-auto'))
    expect(screen.getByTestId(`cue-wave-proposal-${bar(64)}`)).toBeInTheDocument()
    expect(screen.queryByTestId('cue-wave-hot-A')).toBeNull()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId(`cue-wave-proposal-${bar(64)}`))
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.queryByTestId(`cue-wave-proposal-${bar(64)}`)).toBeNull()
    expect(saveRekordboxCues).not.toHaveBeenCalled()
  })

  it('says there is nothing left to propose once every strong part is marked', async () => {
    setup({ ...READ, strong: [{ start: bar(64), end: bar(96) }] })
    await ready()
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-auto'))
    expect(screen.getByTestId('cues-auto-none')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuesSection.test.tsx`
Expected: FAIL, no `cues-auto`.

- [ ] **Step 3: Implement**

In `Editing`: `const [auto, setAuto] = useState(false)`; `const proposals = auto ? proposeDrops(read.strong, draftDrops(state.cues)) : []`; pass `proposals` and `onAcceptProposal` to `CueWave`; in the actions row, before the flow selector, when `read.strong.length > 0`: `<button type="button" data-testid="cues-auto" aria-pressed={auto} onClick={() => setAuto((a) => !a)} className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] aria-pressed:bg-[var(--color-hover)]">{tr('editor.cues.auto')}</button>`; when `auto && proposals.length === 0`, `<p data-testid="cues-auto-none" className="mt-2 text-xs text-fg-dim">{tr('editor.cues.autoNone')}</p>`.

Locales (`/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues-t15.json`, merged):

```json
{
  "es": { "editor": { "cues": { "auto": "Auto", "autoNone": "rekordbox no ve otra parte fuerte que proponer" } } },
  "en": { "editor": { "cues": { "auto": "Auto", "autoNone": "rekordbox sees no other strong part to suggest" } } },
  "de": { "editor": { "cues": { "auto": "Auto", "autoNone": "rekordbox sieht keinen weiteren starken Teil zum Vorschlagen" } } },
  "fr": { "editor": { "cues": { "auto": "Auto", "autoNone": "rekordbox ne voit aucune autre partie forte à proposer" } } },
  "pt-BR": { "editor": { "cues": { "auto": "Auto", "autoNone": "O rekordbox não vê outra parte forte para sugerir" } } }
}
```

- [ ] **Step 4: Run tests, types, lint**

`CuesSection.test.tsx`, `src/renderer/src/i18n/index.test.ts`, the keys test: PASS. Both `tsc`, `check`: clean; status only the task's files.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/i18n/locales
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Propose drops from rekordbox's phrases with an Auto button that writes nothing on its own"
```

---

### Task 16: Verify on the test copy, then Vicent in real rekordbox

Done by the controller with the run-desktop driver against the test copy (`rekordboxDbPath` under `/private/tmp/claude-501/`; check `~/Library/Application Support/Electron/settings.json` before starting and stop if it points anywhere else). Never `~/Library/Pioneer`.

- [ ] **Step 1: Full suite, types, lint**

Full suite (`--reporter=dot --silent` into the scratch log), both `tsc`, `check`. Report any skipped test by name (the gated measurement and sweep are the only expected skips).

- [ ] **Step 2: The three flows on a real track of the copy**

Build, open a track of a rekordbox playlist with no hot cues, open the Cues section. With each bundled flow active in turn (Settings › Cues › "Usar este flujo"), mark the drop and screenshot the section into `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/editor-cues/flow-<id>.png`. The section must draw what the preview drew for that flow.

- [ ] **Step 3: Edit, save, apply to the copy**

On one track: add a hot cue from the menu, move a countdown cue two bars, delete one, recolour one, change a letter, ⌘Z once, save. Apply the queue (the copy has no rekordbox running). Read back the copy's `djmdCue` rows for that `ContentID` with a read-only script in the scratchpad (as `colors.cjs` there does) and compare them with the section re-read: same positions, letters and colours, moved cues keeping their `ID`, `contentCue` JSON in step.

- [ ] **Step 4: Vicent in rekordbox**

Ask Vicent to open the copy in rekordbox (or his library after his own backup, his call) and check, in his words: the cues look as Surco drew them; a moved cue keeps its letter where it was put; the 16 swatches Surco offers are rekordbox's picker in the same order (if not, correct `HOT_CUE_PICKER` from what he sees, rerun `rekordboxCueColors.test.ts`, commit "Match the cue colour picker to rekordbox's own"); "Una cue a 32" and "Solo CALL" do what they say. Record what he saw in the spec under "Cómo sabremos que está" as a dated note and commit the spec alone.

---

## Self-review

1. **Spec coverage.** §1 flows and rules: Task 1 (model, bundled flows, Restablecer), Task 2 (engine, global rules, parity of `planCues`), Task 3 (fit check, manual work, limit of 8 with what is left out, parity of `cueChanges`). §2 configurator: Task 13 (with the example track of 128 BPM, 192 bars, drop at 64). §3 manual editing: Task 10 (every action, undo), Task 11 (click, select, drag snapping to beat, right-click), Task 12 (toolbar, palette, letter, menu, apply flow, ⌘Z, draft until saved). §4 Auto: Task 14 (proposals and the measurement written into the spec), Task 15 (button, dashed marks, accept, hidden without phrases). §5 save: Task 7 (wanted set, fingerprint, plan B row rules through `applyCueChanges`, moves from Task 4) and Task 8 (complete on close with the active flow). §6 drawing rule: Task 9 (row), Task 11 (section), Task 13 (preview reuses `CueWave`). Storage and export: Task 6. Success criteria and risks: Task 16 (copy first, letter order on move checked in rekordbox).
2. **Placeholder scan.** UI markup in Tasks 11, 12 and 13 is described element by element with test ids, classes and handlers instead of full JSX; every test is real code. The one IPC test in Task 7 written as "in the file's own style" names the handler, input and expected `null`.
3. **Type consistency.** `WantedCue`, `FlowOutcome`, `FlowInput`, `diffCues`, `flowOutcome`, `evaluateFlow`, `FlowTrack`, `FlowCue`, `FlowPlan` (Tasks 2 and 3) are the names later tasks consume; `CuesOp.wanted?` and `SaveCuesRequest.wanted` (Task 7) match Task 8 and Task 12; `DraftCue`, `CueDraft`, `DraftAction`, `reduceDraft`, `startDraft`, `draftDrops`, `freeLetters`, `wantedOfDraft` (Task 10) match Task 12 and Task 15; `WaveCue` and the `CueWave` props (Task 11) match Tasks 12, 13 and 15; `placeCues`, `markStyle`, `HOT_MARK_PX` (Task 9) match Task 11; `HOT_CUE_PICKER`, `HOT_CUE_DEFAULT_INDEX` (Task 10) match Tasks 12 and 13; `flowName` (Task 12) matches Task 13.
4. **Review Focus.** Each of the five lines has its test in the owning task: 1 and 2 in Task 10, 3 in Task 7, 4 in Tasks 1 and 6, 5 in Tasks 4 and 7.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-19-editor-cues.md`. Tasks 1 to 3 are the parity core and every later task builds on their names; Tasks 14 and 16 are the controller's.
