# Flujo en fantasma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cue editor's primary button and armed wait with a synced mode selector ("Flujo **Mi flujo** ▾", the flows, a line, **Manual**), and with a flow chosen draw on hover, in see-through marks, exactly what a click on that point would place, on the folded strip, the full-screen strip and the zoomed wave; switching flow on a marked track shows the difference and changes nothing until "Aplicar a esta pista"; a flow can leave its point without a CALL and a flow that does not depend on a point applies to the whole track at once.

**Architecture:** The engine learns one flow option (`markPoint`) and one input (`flowOutcome`'s `point`) in `shared/`. The draft reducer (`lib/cueDraft.ts`) keeps `mark-drop` as the one placing action (it regenerates when the flow marks its point, and merges a one-off placement, as if by hand, when it does not) and gains a pure `ghostOf(state, action, ctx)` that runs `reduceDraft` and diffs, so the ghost is the commit by construction. `CuesSection.tsx` swaps the split button for a `Select` whose value is the synced `activeCueFlow` (Manual is the value `'manual'`), and feeds a hover point and a ghost to `CueWave` and `CueWaveDetail`, which learn `onPlace`, `onHover` and `ghost` and tell a click (place) from a drag (navigate).

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library (jsdom), biome, i18next.

**Spec:** `docs/superpowers/specs/2026-10-20-flujo-fantasma-design.md` (decisions 1 to 11; simplifies `2026-10-20-editor-cues-calma-design.md`). Approved sketch: https://claude.ai/artifact/47sZMkqEzPxz1f296Da2cg, HTML source at `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/flujo-fantasma.html` (ghost alpha 0.42, gone alpha 0.18, cursor line 1 px of the text colour at 80 %, the selector pill, "Aplicar a esta pista" in accent).

**Depends on:** branch `worktree-fuentes-dj-playlists` at `b5d1bbf8` (plan `2026-10-20-editor-cues-calma.md` done plus the post-plan commits in its ledger `.superpowers/sdd/2026-10-20-editor-cues-calma/progress.md`). Code blocks below were written against that HEAD; when a quoted old text no longer matches, merge into the current file instead of pasting, keeping every ruling listed in Global Constraints.

**Out of scope (spec "Fuera de alcance" and decision 7):** automatic drop detection and its fixed ghosts (`src/shared/dropDetect*`, `src/main/dropDetectMeasure*`, `cueWave.proposal` copy, `CueWave`'s `proposals` prop stay untouched), and anything Surco writes to rekordbox.

## Global Constraints

- `$WT` means `/Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists`. **Write it out literally in every command**: the shell guard refuses commands whose paths come from a variable. Paths below are relative to `apps/desktop/` unless they start with `docs/`.
- Tests: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop <paths relative to apps/desktop>`. Never filter by a path from the repo root (the setup is skipped and failures are false). Full suite: add `--reporter=dot --silent > /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/suite.log` and read the tail.
- Types: `npm --prefix $WT/apps/desktop exec -- tsc -p $WT/apps/desktop/tsconfig.web.json --noEmit` and the same with `tsconfig.node.json`. A bare `tsc --noEmit` checks nothing.
- Lint: `npm --prefix $WT/apps/desktop run check` (it is `biome check --write src`, it may reorder imports), then `git -C $WT status --short` must list only the task's files. Other agents work in this tree: never `git add -A` or `.`, stage by path; never stage `src/shared/dropDetect*`, `src/main/dropDetectMeasure*` or `src/main/zzDropDump.test.ts`.
- The shell guard rejects heredocs, `cd … &&` chains and shell loops: write files with the Write tool, edit with Edit. Search with `rg` or the Grep tool.
- Locale additions or value changes: write the JSON shown in the task with the Write tool to the scratchpad path the task names, then run `node /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/learn-merge.cjs <that json>` with the Bash working directory `$WT/apps/desktop` (it deep-merges `{ "<locale>": { ...keys } }` into `src/renderer/src/i18n/locales/<locale>.json`, overwriting a value that exists). Key removals are done with Edit in each of the 5 files, using the exact lines the task lists. Run `src/renderer/src/i18n/usedKeys.test.ts` and `src/renderer/src/i18n/keys.test.ts` after every locale change.
- Zero comments in new code (biome directives included). `Select.tsx` and `Editor.tsx` document each prop with a comment; the new props get none (the user's no-comment rule wins over those files' habit; reviewers are told).
- `data-testid` first in selectors; never assert a CSS class in a new test. `window.api` mocks are typed: `vi.fn<Api['name']>()`. Function mocks are typed: `vi.fn<(ms: number) => void>()`.
- Copy: no user-facing string with an em dash or an explanatory colon. Every key exists in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`), Spanish written first; French uses "vous"; German keeps the repo's "du" form. Spec copy: "Flujo", "Manual", "Haz clic para colocar", "Aplicar a esta pista", "Marcar el punto con un CALL". Decision 8: no string this plan adds or touches says "donde rompe"; Task 8 rewrites the rest.
- Palette rule (`src/renderer/src/index.css.test.ts`): only Tokyo Night tokens (`var(--color-…)`, `MEMORY_CUE_COLOR`, `hotCueColor`), no new hex, no `rgb(…)`, no Tailwind `white`/`black`. The hot-cue letter colour `'#000'` already used by the real marks is reused as is for the ghost marks.
- **Rulings kept from the previous ledger:** the full editor claims keys while maximized (`claimKeys` with `HIDDEN_SECTION_KEYS`, unchanged); it handles keys only while focus is inside it and never in a field or a `[aria-haspopup="listbox"]` trigger; every handled key is `preventDefault`-ed; anything that closes on Escape listens on `document`, calls `e.stopPropagation()` so the Editor's window listener does not restore the maximized section, and gives the focus back with `focusEditor`; a menu or select used inside the full editor returns the focus to the editor when it closes (`onClosed={focusEditor}`); hand-placed cues snap by Quantize (`ctx.snapTo`); a CALL is drawn behind its hot cue (`placeCues`); deleting stays ✕ on hover, right-click menu, "‹ + CALL › ✕" and ⌫/Supr; Select menus are portaled (`portal`).
- **Decision 6, safety stays.** Unchanged: `lib/cueSession.ts`, the save call (`saveRekordboxCues` with `wanted` and the read `fingerprint`), `undoRekordboxCues`, the queue, backup and `validWantedSet` in main, `useCueAudition`, `HIDDEN_SECTION_KEYS`, the `claimKeys` call, Guardar, Descartar. `reduceDraft` changes only in Task 2's `mark-drop` branch. These tests stay green; the only edit allowed in them is the one quoted in a task (a removed button swapped for its replacement): in `CuesSection.test.tsx` "saves the whole wanted set with the fingerprint it read", "saves only sets main accepts…" (Task 4 swaps one line), "starts from what rekordbox holds when the queued save was built on an older read…", "starts afresh on another track whose read looks the same…", "keeps the unsaved cues when the section is mounted again…"; in `CuesSection.maximized.test.tsx` every test of `describe('CuesSection maximized over the rest of the editor')` and "Space plays the track from the playhead…", "answers the global Space while maximized…", "keeps Space and Trim’s keys…", "stops the sound when the section is restored…". Task 5 changes the file's shared `seek` helper from a click to a drag; the bodies of those tests are not edited.
- Constants: `SAME_POSITION_MS` 50, `BEATS_PER_BAR` 4, `HOT_KINDS` `[1, 2, 3, 5, 6, 7, 8, 9]`, `WAVE_MARK_LANE_PX` 15, new `MANUAL_CUE_FLOW` `'manual'`, new `GHOST_OPACITY` 0.42, new `GONE_OPACITY` 0.18, drag threshold `DRAG_PX` 3 (already in `CueWave.tsx`, new in `CueWaveDetail.tsx`).
- One functionality per commit, title only, no prefix, never `--no-verify`, never bare `git stash`. TDD: run every new test red before the code.

## Decisions taken where the spec left room

1. **Manual is a value of the synced `activeCueFlow`** (`MANUAL_CUE_FLOW = 'manual'`), not a new key, as decision 1 says ("Manual es un valor más"). `normalizeCueFlows` drops any stored flow whose id is `'manual'`, so Manual never stands for a flow. `activeCueFlow(settings)` keeps resolving `'manual'` to Mi flujo, so main's complete-on-close (its own switch in Settings) runs as today. `mergeSettings` already keeps any string; nothing goes into `LOCAL_KEYS`.
2. **Picking a mode in the editor saves it**, through a new `onFlow` prop wired App → Editor → CuesSection to `saveSettings({ activeCueFlow })`, the same hop as Quantize. Settings › Cues shows no flow "En uso" while the mode is Manual; "Usar este flujo" leaves Manual.
3. **`markPoint` is a required boolean on `CueFlow`.** Bundled flows, new flows and learned flows carry `true`; a stored flow without it normalises to `true` (what Surco always did); a non-boolean normalises to `true`. Settings › Cues shows it as a checkbox under the rules, and the preview drops the CALL of the point when it is off.
4. **A flow "depends on the point"** (`followsPoint`) when it marks the point, or has a rule from `'drop'`, or a rule whose condition is `'first'` (that one is measured against the point). Only then does the cursor carry a ghost and a click place. Otherwise the folded strip opens the full editor and the strips seek, as in Manual.
5. **A placement that leaves the point without a CALL is merged once, as if placed by hand** (decision 11): the flow is evaluated for that point alone, cues landing on an occupied spot are skipped (a hot cue's CALL with it), new hot cues take free letters in time order and count as edited. It never regenerates the rest of the track, so a second placement on the same track still places. A placement that marks its point stays today's regeneration.
6. **The ghost is the commit:** `ghostOf` runs `reduceDraft` on the draft and diffs by key, position, letter and colour. A cue the action recolours or reletters shows as gone (old) and added (new).
7. **Click places, drag navigates**, on the full-screen strip and the zoomed wave, when the mode follows the point (more than `DRAG_PX` 3 px is a drag). In Manual both keep today's behaviour (strip click seeks, zoomed wave scrubs). A press that starts on a mark of the zoomed wave never places.
8. **The hover ghost wins over the switch ghost** while the cursor is on a wave; on leave the switch ghost comes back.
9. **"Aplicar a esta pista" shows** when applying the chosen flow would change something and either the chosen flow is not the one that drew the draft or the flow does not follow the point. It sits right of the selector, in accent; the hint "Haz clic para colocar" shows only when the mode follows the point.
10. **The right-click menu's "Marcar donde rompe aquí"** stays (same test id) only when the mode follows the point; Task 8 renames it "Colocar el flujo aquí".
11. **The cursor marker** is a solid 1 px line in `--color-fg` at 80 % (the sketch), replacing the strip's dashed hover line; test id `cue-wave-cursor` on the strip and `cue-detail-cursor` on the zoomed wave.
12. **Clicking a point that is already marked does nothing** (no undo step), as today's `mark-drop` does; the strip no longer takes a point away with a click (that path had no caller left). The `unmark-drop` action stays in the reducer, already unused by the UI before this plan; reported, not deleted.

## Review Focus

1. **Clicking a mark in the zoomed wave with a flow chosen.** The DJ goes for a hot cue's ✕ or right-click and misses by a pixel; that press must never place a new point on the hot cue. Pinned in Task 6 ("never places on a press that starts on a mark…").
2. **Dragging to navigate with a flow chosen.** On the full-screen strip and the zoomed wave a drag must move the playhead and place nothing; a click must place and not move the playhead. Pinned in Task 5 ("places with a click and moves the playhead with a drag…") and Task 6 ("places on the bar under a click and still scrubs with a drag…").
3. **A second placement with a flow that leaves the point without a CALL.** Nothing marks the first point, so a regeneration would forget it and turn the second into "manual"; the second click must still place its cues. Pinned in Task 2 ("places again after a placement that left no CALL…") and Task 4 ("places a flow that leaves the point unmarked…").
4. **Picking a mode in the full editor, then the keys.** After choosing Manual from the list, Space, M and the arrows must work without a click. Pinned in Task 4 ("gives the keys back to the editor after Manual is picked…").
5. **A synced settings file from elsewhere.** A flow stored before `markPoint` existed must still place its CALL; a hand-edited flow with id `'manual'` must not shadow Manual; `'manual'` must keep complete-on-close running Mi flujo. Pinned in Task 1 (normalisation and `activeCueFlow` tests, and the main settings guard).

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/cueFlows.ts` (mod) | `markPoint`, `MANUAL_CUE_FLOW`, normalisation, `followsPoint` |
| `src/shared/cueRules.ts` (mod) | `FlowInput.point`: no CALL on a point the flow leaves unmarked |
| `src/shared/learnFlow.ts` (mod) | learned flows mark their point |
| `src/renderer/src/lib/cueExample.ts` (mod) | the Settings preview passes the example point |
| `src/renderer/src/lib/cueDraft.ts` (mod) | one-off placement for an unmarked point, `ghostOf` |
| `src/renderer/src/lib/cueMarks.ts` (mod) | `CueGhost`, `GHOST_OPACITY`, `GONE_OPACITY` |
| `src/renderer/src/lib/cueWave.ts` (mod) | `clickAction` removed |
| `src/renderer/src/components/settings/CuesTab.tsx` (mod) | the "Marcar el punto con un CALL" checkbox, Manual in use |
| `src/renderer/src/components/Select.tsx` (mod) | `lead`, `divided`; `split` removed |
| `src/renderer/src/components/CuesSection.tsx` (mod) | mode selector, Manual, placing, Aplicar a esta pista, hover and switch ghosts |
| `src/renderer/src/components/CueWave.tsx` (mod) | `onPlace`, `onHover`, `ghost`, cursor line, click versus drag |
| `src/renderer/src/components/CueWaveDetail.tsx` (mod) | `onPlace` (replaces `onPick`), `onHover`, `ghost`, cursor line, click versus drag |
| `src/renderer/src/components/Editor.tsx`, `src/renderer/src/App.tsx` (mod) | `onCueFlow` saves the mode |
| `src/renderer/src/i18n/locales/*.json` (mod) | keys per task |

## Test ids

| Test id | Fate | Task |
|---|---|---|
| `cues-apply-flow` | removed | 4 |
| `cues-arm-hint` | removed | 4 |
| `cues-flow-option-mark-another` | removed | 4 |
| `cues-flow` | kept, now the mode selector (`Flow: <name>` or `Flow: Manual`) | 4 |
| `cues-flow-option-manual`, `cues-flow-separator` | new | 4 |
| `cues-place-hint`, `cues-apply-track` | new | 4 |
| `cue-flow-mark-point` | new (Settings) | 3 |
| `cue-wave-ghost` (dashed line) | replaced by `cue-wave-cursor` | 5 |
| `cue-wave-ghost-hot-<letter>`, `cue-wave-ghost-call-<ms>` | new | 5 |
| `cue-detail-cursor`, `cue-detail-ghost-hot-<letter>`, `cue-detail-ghost-call-<ms>` | new | 6 |
| `data-gone` on real marks (strip and zoomed) | new attribute | 5, 6 |

## Task list

| # | Task |
|---|---|
| 1 | The flow option and the point in the engine |
| 2 | One-off placement and the ghost of an action |
| 3 | Marcar el punto con un CALL in Settings |
| 4 | The mode selector replaces the button and the wait |
| 5 | The strip places, shows the cursor and draws a ghost |
| 6 | The zoomed wave places, shows the cursor and draws a ghost |
| 7 | The ghost follows the cursor and shows a flow switch |
| 8 | Say "el punto", never "donde rompe" |
| 9 | Verify on the copy with the driver |

Tasks 1 and 2 touch only `shared/` and `lib/`. Tasks 4 to 8 edit `CuesSection.tsx` or the locales and run in order, one at a time; Task 3 edits the locales too, so it runs before Task 4. Task 9 is the controller's.

---

### Task 1: The flow option and the point in the engine

**Files:**
- Modify: `src/shared/cueFlows.ts` (`CueFlow`, `MY_FLOW`, `ONE_AT_32`, `CALLS_ONLY`, `normalizeCueFlows`; add `MANUAL_CUE_FLOW`, `followsPoint`)
- Modify: `src/shared/cueRules.ts` (`FlowInput`, `flowOutcome`'s `added`)
- Modify: `src/shared/learnFlow.ts:189`, `src/shared/learnFlow.ts:292` (the two `CueFlow` literals)
- Modify: `src/renderer/src/lib/cueExample.ts` (`examplePlan`)
- Modify: `src/renderer/src/components/settings/CuesTab.tsx` (the `create` literal)
- Test: `src/shared/cueFlows.test.ts`, `src/shared/cueRulesFlows.test.ts`, `src/renderer/src/lib/cueExample.test.ts`, `src/main/settings.test.ts`; literal fixes in the test files `tsc` names

**Interfaces:**
- Consumes: nothing new.
- Produces: `CueFlow { id: string; name: string; markPoint: boolean; rules: CueRule[] }`; `MANUAL_CUE_FLOW = 'manual'`; `followsPoint(flow: CueFlow): boolean`; `FlowInput.point?: number` (a point being placed now; when `flow.markPoint` is false no CALL is added on it).

- [ ] **Step 1: Write the failing tests**

In `src/shared/cueFlows.test.ts`, add `MANUAL_CUE_FLOW`, `followsPoint` and `type CueRule` to the import from `./cueFlows`. In the test "starts from the rules.py countdown so nothing changes for Vicent", add `markPoint: true,` after `name: '',` in the expected object. Then add inside `describe('normalizeCueFlows', …)`:

```ts
  it('marks the point with a CALL for a flow saved before the option existed, as Surco always did', () => {
    const flows = normalizeCueFlows([{ id: 'x', name: 'Vieja', rules: [] }])
    expect(flows.find((f) => f.id === 'x')?.markPoint).toBe(true)
  })

  it('keeps a flow that leaves the point unmarked and repairs a value that is not a boolean', () => {
    const flows = normalizeCueFlows([
      { id: 'a', name: '', markPoint: false, rules: [] },
      { id: 'b', name: '', markPoint: 'no', rules: [] },
    ])
    expect(flows.filter((f) => f.id !== 'mine').map((f) => f.markPoint)).toEqual([false, true])
  })

  it('drops a flow whose id is the Manual mode, so Manual never stands for a flow', () => {
    const flows = normalizeCueFlows([
      MY_FLOW,
      { id: MANUAL_CUE_FLOW, name: 'Mía', markPoint: true, rules: [] },
    ])
    expect(flows.map((f) => f.id)).toEqual(['mine'])
  })
```

Inside `describe('activeCueFlow', …)`:

```ts
  it('runs Mi flujo for main while the editor is in Manual, since completing on close is its own switch', () => {
    expect(activeCueFlow({ cueFlows: BUNDLED_FLOWS, activeCueFlow: MANUAL_CUE_FLOW })).toEqual(
      MY_FLOW,
    )
  })
```

At the end of the file:

```ts
describe('followsPoint', () => {
  const only = (rules: CueRule[], markPoint: boolean): CueFlow => ({
    id: 'x',
    name: '',
    markPoint,
    rules,
  })

  it('follows the cursor when the flow marks the point or counts from it, and not when it only reads the track', () => {
    expect(followsPoint(MY_FLOW)).toBe(true)
    expect(followsPoint(CALLS_ONLY)).toBe(true)
    expect(followsPoint(only([ONE_AT_32.rules[0]], false))).toBe(true)
    expect(followsPoint(only([MY_FLOW.rules[1]], false))).toBe(true)
    expect(followsPoint(only([{ ...MY_FLOW.rules[1], when: 'always' }], false))).toBe(false)
    expect(followsPoint(only([{ ...ONE_AT_32.rules[0], from: 'chorus' }], false))).toBe(false)
    expect(followsPoint(only([], false))).toBe(false)
  })
})
```

In `src/shared/cueRulesFlows.test.ts`, add at the end of the file:

```ts
describe('flowOutcome for a flow that leaves the point unmarked', () => {
  const unmarked = (f: CueFlow): CueFlow => ({ ...f, markPoint: false })

  it('places what the rules draw from the point and no CALL on it, for the DJ who does not mark drops', () => {
    expect(outcome({ flow: unmarked(ONE_AT_32), point: beat(64) })).toEqual({
      status: 'plan',
      wanted: [{ ms: beat(32), kind: 1, color: 22 }],
      hot: [{ ms: beat(32), kind: 1, color: 22 }],
      trimmed: [],
    })
  })

  it('keeps the CALL a rule itself puts on the point, since the flow asked for it', () => {
    const onPoint = unmarked(flow(rule({ bars: 0, place: 'both' })))
    const out = outcome({ flow: onPoint, point: beat(64) })
    expect(out.status === 'plan' && out.wanted).toEqual([
      { ms: beat(64), kind: 1, color: 1 },
      { ms: beat(64), kind: 0, color: null },
    ])
  })

  it('marks the point as before when the flow marks it or no point is being placed', () => {
    expect(outcome({ flow: ONE_AT_32, point: beat(64) })).toEqual(outcome({ flow: ONE_AT_32 }))
    expect(outcome({ flow: unmarked(ONE_AT_32) })).toEqual(outcome({ flow: ONE_AT_32 }))
  })
})
```

In the same file, change the helper `const flow = (...rules: CueRule[]): CueFlow => ({ id: 't', name: '', rules })` to `const flow = (...rules: CueRule[]): CueFlow => ({ id: 't', name: '', markPoint: true, rules })`.

In `src/renderer/src/lib/cueExample.test.ts`, add inside its first `describe`:

```ts
  it('draws no CALL on the example point for a flow that leaves it unmarked, as placing it would', () => {
    const out = examplePlan({ ...ONE_AT_32, markPoint: false })
    expect(out.status === 'plan' && out.wanted.some((c) => c.kind === 0)).toBe(false)
    expect(out.status === 'plan' && out.wanted.map((c) => c.ms)).toEqual([exampleBar(32)])
  })
```

In `src/main/settings.test.ts`, after the test "follows the person to another Mac like the cue offset, not this Mac only", add (a guard: `mergeSettings` already keeps any string, so it may pass before the change; say so in the report):

```ts
  it('keeps Manual as the synced mode, so another Mac opens the editor in Manual too', () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), JSON.stringify({}))
    saveSettings({ activeCueFlow: 'manual' })
    expect(getSettings().activeCueFlow).toBe('manual')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/cueFlows.test.ts src/shared/cueRulesFlows.test.ts src/renderer/src/lib/cueExample.test.ts src/main/settings.test.ts`
Expected: FAIL on `followsPoint is not a function`, the missing `markPoint` in normalised flows, the `'manual'` flow kept, the CALL on the point and the example CALL. The main settings guard may pass; report it.

- [ ] **Step 3: Write the implementation**

In `src/shared/cueFlows.ts`:

```ts
export interface CueFlow {
  id: string
  name: string
  markPoint: boolean
  rules: CueRule[]
}
```

After `export const MY_FLOW_ID = 'mine'` add `export const MANUAL_CUE_FLOW = 'manual'`. Add `markPoint: true,` after `name: '',` in `MY_FLOW` and `ONE_AT_32`, and write `CALLS_ONLY` as `{ id: 'calls-only', name: '', markPoint: true, rules: [] }`.

In `normalizeCueFlows`, replace

```ts
    if (typeof f.id !== 'string' || f.id === '' || seen.has(f.id) || !Array.isArray(f.rules))
      continue
    seen.add(f.id)
    flows.push({
      id: f.id,
      name: typeof f.name === 'string' ? f.name : '',
      rules: f.rules.flatMap((r) => {
```

with

```ts
    if (
      typeof f.id !== 'string' ||
      f.id === '' ||
      f.id === MANUAL_CUE_FLOW ||
      seen.has(f.id) ||
      !Array.isArray(f.rules)
    )
      continue
    seen.add(f.id)
    flows.push({
      id: f.id,
      name: typeof f.name === 'string' ? f.name : '',
      markPoint: typeof f.markPoint === 'boolean' ? f.markPoint : true,
      rules: f.rules.flatMap((r) => {
```

At the end of the file:

```ts
export function followsPoint(flow: CueFlow): boolean {
  return flow.markPoint || flow.rules.some((r) => r.from === 'drop' || r.when === 'first')
}
```

In `src/shared/cueRules.ts`, add `point?: number` as the last member of `FlowInput`, and in `flowOutcome` replace

```ts
  const added: WantedCue[] = wantedDrops
    .filter((ms) => !memory.some((m) => near(m.ms, ms)))
    .map((ms) => ({ ms, kind: 0, color: null }))
```

with

```ts
  const unmarked = (ms: number): boolean =>
    !flow.markPoint && input.point !== undefined && near(ms, input.point)
  const added: WantedCue[] = wantedDrops
    .filter((ms) => !memory.some((m) => near(m.ms, ms)) && !unmarked(ms))
    .map((ms) => ({ ms, kind: 0, color: null }))
```

In `src/renderer/src/lib/cueExample.ts`, add `point: EXAMPLE_DROP,` after `flow,` in `examplePlan`'s `flowOutcome` call.

In `src/shared/learnFlow.ts` line 189 write `const flow: CueFlow = { id: 'countdown', name: '', markPoint: true, rules: countdown ? [countdown] : [] }`, and in `learnMarked` add `markPoint: true,` after `name: '',`.

In `src/renderer/src/components/settings/CuesTab.tsx` `create`, add `markPoint: true,` after the `name:` line.

- [ ] **Step 4: Fix the literals `tsc` names**

Run both `tsc` commands. Every `CueFlow` literal without `markPoint` is an error; add `markPoint: true,` after its `name:` line. Expected sites: `src/main/exportSettings.test.ts`, `src/main/rekordboxCompleteOnClose.test.ts`, `src/renderer/src/lib/cueFlowName.test.ts`, `src/shared/cueFlows.test.ts` (`const mine: CueFlow` and the `normalizeCueFlows` literal objects typed `CueFlow`). A test that deep-compares a normalised flow with a literal (`toEqual`) gets the same `markPoint: true`. No other change.

- [ ] **Step 5: Run the tests and the checks**

Run the Step 2 command plus `src/shared/learnFlow.test.ts src/renderer/src/components/settings/CuesTab.test.tsx src/renderer/src/components/CueFlowPreview.test.tsx src/main/rekordboxCompleteOnClose.test.ts src/main/rekordboxCuesIpc.test.ts src/main/exportSettings.test.ts`, both `tsc`, `check`.
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/shared/cueFlows.ts apps/desktop/src/shared/cueFlows.test.ts apps/desktop/src/shared/cueRules.ts apps/desktop/src/shared/cueRulesFlows.test.ts apps/desktop/src/shared/learnFlow.ts apps/desktop/src/renderer/src/lib/cueExample.ts apps/desktop/src/renderer/src/lib/cueExample.test.ts apps/desktop/src/renderer/src/components/settings/CuesTab.tsx apps/desktop/src/main/settings.test.ts
```

Add each test file Step 4 touched by its path, then:

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Let a cue flow leave its point without a CALL"
```

---

### Task 2: One-off placement and the ghost of an action

**Files:**
- Modify: `src/renderer/src/lib/cueDraft.ts` (`mark-drop` branch, new `placeOnce`, new `ghostOf`)
- Test: `src/renderer/src/lib/cueDraft.test.ts`

**Interfaces:**
- Consumes: `CueFlow.markPoint`, `FlowInput.point` (Task 1).
- Produces: `export interface DraftGhost { added: DraftCue[]; gone: string[] }`; `export function ghostOf(state: CueDraft, action: DraftAction, ctx: DraftContext): DraftGhost`. `mark-drop` with a flow whose `markPoint` is false merges once and marks the new hot cues edited.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/lib/cueDraft.test.ts`, extend the imports: `type CueFlow, MY_FLOW, ONE_AT_32` from `../../../shared/cueFlows` (next to `BUNDLED_FLOWS`), and `type DraftCue, ghostOf` from `./cueDraft`. Add before `describe('quantize of hand-placed cues', …)`:

```ts
const QUIET: CueFlow = { ...ONE_AT_32, id: 'quiet', markPoint: false }
const MIXED: CueFlow = {
  id: 'mixed',
  name: '',
  markPoint: false,
  rules: [ONE_AT_32.rules[0], { ...MY_FLOW.rules[1], when: 'always' }],
}
const CHORUS: CueFlow = {
  id: 'chorus',
  name: '',
  markPoint: false,
  rules: [
    {
      from: 'chorus',
      direction: 'back',
      bars: 0,
      repeat: 1,
      when: 'always',
      place: 'hot',
      color: { fixed: 5 },
    },
  ],
}
const wide = {
  ...ctx,
  flows: [...BUNDLED_FLOWS, QUIET, MIXED, CHORUS],
  phrases: [
    { ms: bar(64), kind: 'chorus' as const },
    { ms: bar(128), kind: 'chorus' as const },
  ],
}
const runWide = (state: CueDraft, ...actions: DraftAction[]) =>
  actions.reduce((s, a) => reduceDraft(s, a, wide), state)
const hotOf = (s: { cues: DraftCue[] }) =>
  s.cues
    .filter((c) => c.kind !== 0)
    .sort((a, b) => a.ms - b.ms)
    .map((c) => [c.ms, c.kind, c.color])
const shape = (cues: DraftCue[]) =>
  cues.map((c) => `${c.key} ${c.ms} ${c.kind} ${c.color}`).sort()
const throughGhost = (s: CueDraft, a: DraftAction) => {
  const g = ghostOf(s, a, wide)
  return [...s.cues.filter((c) => !g.gone.includes(c.key)), ...g.added]
}

describe('a flow that leaves the point unmarked', () => {
  it('places the cues of the point with no CALL on it, so nothing reads as a point afterwards', () => {
    const s = runWide(startDraft([], 'quiet'), { type: 'mark-drop', ms: bar(64) + 120 })
    expect(hotOf(s)).toEqual([[bar(32), 1, 22]])
    expect(s.cues.filter((c) => c.kind === 0)).toEqual([])
    expect(draftDrops(s.cues)).toEqual([])
  })

  it('places again after a placement that left no CALL, so a DJ who does not mark the point can place on every part of the track', () => {
    const s = runWide(
      startDraft([], 'quiet'),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(160) },
    )
    expect(hotOf(s)).toEqual([
      [bar(32), 1, 22],
      [bar(128), 2, 22],
    ])
    expect(s.notice).toBeNull()
  })

  it('places the cues of a mixed flow that do not depend on the point too, in time order of letters', () => {
    const s = runWide(startDraft([], 'mixed'), { type: 'mark-drop', ms: bar(64) })
    expect(hotOf(s)).toEqual([
      [0, 1, 32],
      [bar(32), 2, 22],
    ])
    expect(s.cues.filter((c) => c.kind === 0).map((c) => c.ms)).toEqual([0])
  })

  it('skips a spot already taken and keeps what is there, as a cue placed by hand would', () => {
    const s = runWide(
      startDraft([{ id: 'h', ms: bar(32), kind: 5, color: 1 }], 'quiet'),
      { type: 'mark-drop', ms: bar(64) },
    )
    expect(s.cues).toHaveLength(1)
    expect(s.past).toHaveLength(0)
  })

  it('takes the whole placement away with one undo', () => {
    const s = runWide(startDraft([], 'mixed'), { type: 'mark-drop', ms: bar(64) }, { type: 'undo' })
    expect(s.cues).toEqual([])
    expect(s.past).toEqual([])
  })

  it('keeps every set main accepts', () => {
    const s = runWide(
      startDraft([], 'mixed'),
      { type: 'mark-drop', ms: bar(64) },
      { type: 'mark-drop', ms: bar(160) },
    )
    expect(validWantedSet(wantedOfDraft(s.cues), [])).toEqual({ ok: true })
  })
})

describe('ghostOf', () => {
  it('shows what a click would place with Mi flujo, the CALL of the point and each hot cue with its CALL, and the click places exactly that', () => {
    const action: DraftAction = { type: 'mark-drop', ms: bar(64) }
    const g = ghostOf(empty(), action, wide)
    expect(g.gone).toEqual([])
    expect(g.added).toHaveLength(7)
    expect(shape(throughGhost(empty(), action))).toEqual(
      shape(reduceDraft(empty(), action, wide).cues),
    )
  })

  it('shows only the CALL of the point and the hot cue 32 bars before with Una cue a 32', () => {
    const one = startDraft([], 'one-at-32')
    const g = ghostOf(one, { type: 'mark-drop', ms: bar(64) }, wide)
    expect(g.added.map((c) => [c.ms, c.kind]).sort((a, b) => a[0] - b[0])).toEqual([
      [bar(32), 1],
      [bar(64), 0],
    ])
  })

  it.each([
    ['a flow that leaves the point unmarked', 'quiet'],
    ['a flow mixing rules from the point and from the track', 'mixed'],
  ])('equals the commit for %s', (_name, flowId) => {
    const action: DraftAction = { type: 'mark-drop', ms: bar(64) }
    const s = startDraft([], flowId)
    expect(shape(throughGhost(s, action))).toEqual(shape(reduceDraft(s, action, wide).cues))
  })

  it('shows the whole result of a flow that does not depend on the point, the same as applying it', () => {
    const s = startDraft([], 'chorus')
    const action: DraftAction = { type: 'apply-flow', flowId: 'chorus' }
    expect(ghostOf(s, action, wide).added.map((c) => c.ms)).toEqual([bar(64), bar(128)])
    expect(shape(throughGhost(s, action))).toEqual(shape(reduceDraft(s, action, wide).cues))
  })

  it('shows what switching a marked track to another flow takes away and adds, and changes nothing by itself', () => {
    const marked = runWide(empty(), { type: 'mark-drop', ms: bar(64) })
    const before = JSON.stringify(marked)
    const action: DraftAction = { type: 'apply-flow', flowId: 'one-at-32' }
    const g = ghostOf(marked, action, wide)
    expect(g.gone.length).toBeGreaterThan(0)
    expect(g.added.some((c) => c.kind === 1 && c.ms === bar(32))).toBe(true)
    expect(shape(throughGhost(marked, action))).toEqual(
      shape(reduceDraft(marked, action, wide).cues),
    )
    expect(JSON.stringify(marked)).toBe(before)
  })

  it('shows nothing over a point that is already marked, where a click changes nothing', () => {
    const marked = runWide(empty(), { type: 'mark-drop', ms: bar(64) })
    expect(ghostOf(marked, { type: 'mark-drop', ms: bar(64) + 10 }, wide)).toEqual({
      added: [],
      gone: [],
    })
  })
})
```

Inside `describe('quantize of hand-placed cues', …)` add:

```ts
  it('draws the flow on the bar start under the cursor, where the click will put it', () => {
    const g = ghostOf(empty(), { type: 'mark-drop', ms: bar(64) + 600 }, quantized('bar'))
    expect(g.added.filter((c) => c.kind === 0).map((c) => c.ms)).toContain(bar(64))
    expect(g.added.some((c) => c.ms === bar(64) + 500)).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/cueDraft.test.ts`
Expected: FAIL with `ghostOf is not a function` and, for the unmarked flow, a CALL at bar 64 and a "manual" second placement.

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/lib/cueDraft.ts`, after `function pairOf(…) {…}` add:

```ts
function placeOnce(state: CueDraft, ctx: DraftContext, ms: number, flow: CueFlow): CueDraft {
  const out = flowOutcome({
    existing: [],
    drops: [ms],
    previousDrops: [],
    beats: ctx.beats,
    strong: ctx.strong,
    phrases: ctx.phrases,
    flow,
    point: ms,
  })
  if (out.status === 'too-many') return { ...state, notice: 'too-many' }
  const taken = (c: WantedCue): boolean =>
    state.cues.some((o) => isHot(o) === isHot(c) && near(o.ms, c.ms))
  const skipped = out.wanted.filter((c) => isHot(c) && taken(c))
  const fresh = out.wanted.filter(
    (c) => !taken(c) && (isHot(c) || !skipped.some((h) => near(h.ms, c.ms))),
  )
  if (fresh.length === 0) return state
  const free = freeLetters(state.cues)
  const hot = fresh.filter(isHot).sort((a, b) => a.ms - b.ms)
  if (hot.length > free.length) return { ...state, notice: 'too-many' }
  const letter = new Map(hot.map((c, i) => [c, free[i]]))
  let nextKey = state.nextKey
  const added = fresh.map((c): DraftCue => {
    nextKey += 1
    return { key: `n${nextKey}`, ms: c.ms, kind: letter.get(c) ?? 0, color: c.color }
  })
  return commit(state, [...state.cues, ...added], {
    nextKey,
    selected: null,
    trimmed: out.status === 'plan' ? out.trimmed : [],
    edited: [...state.edited, ...added.filter(isHot).map((c) => c.key)],
  })
}
```

In `reduceDraft`, replace

```ts
  if (action.type === 'mark-drop') {
    const ms = snap(ctx, action.ms)
    if (draftDrops(state.cues, state.locked).some((d) => near(d, ms))) return state
    return regenerate(state, ctx, [...draftDrops(state.cues, state.locked), ms], flow, generator)
  }
```

with

```ts
  if (action.type === 'mark-drop') {
    const ms = snap(ctx, action.ms)
    const drops = draftDrops(state.cues, state.locked)
    if (drops.some((d) => near(d, ms))) return state
    if (!flow.markPoint) return placeOnce(state, ctx, ms, flow)
    return regenerate(state, ctx, [...drops, ms], flow, generator)
  }
```

At the end of the file:

```ts
export interface DraftGhost {
  added: DraftCue[]
  gone: string[]
}

const sameCue = (a: DraftCue, b: DraftCue): boolean =>
  a.key === b.key && a.ms === b.ms && a.kind === b.kind && a.color === b.color

export function ghostOf(state: CueDraft, action: DraftAction, ctx: DraftContext): DraftGhost {
  const next = reduceDraft(state, action, ctx)
  return {
    added: next.cues.filter((c) => !state.cues.some((s) => sameCue(s, c))),
    gone: state.cues.filter((s) => !next.cues.some((c) => sameCue(s, c))).map((s) => s.key),
  }
}
```

- [ ] **Step 4: Run the tests and the checks**

Run the Step 2 command, both `tsc`, `check`.
Expected: PASS (every earlier `reduceDraft` test included, since bundled flows mark their point).

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueDraft.ts apps/desktop/src/renderer/src/lib/cueDraft.test.ts
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Preview what a cue action would place and place unmarked points once"
```

---

### Task 3: Marcar el punto con un CALL in Settings

**Files:**
- Modify: `src/renderer/src/components/settings/CuesTab.tsx` (checkbox, `inUse`)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `src/renderer/src/components/settings/CuesTab.test.tsx`

**Interfaces:**
- Consumes: `CueFlow.markPoint`, `MANUAL_CUE_FLOW` (Task 1); `CheckboxRow` (`./CheckboxRow`); the preview already draws `examplePlan` with the point (Task 1).
- Produces: locale key `settings.cueFlows.markPoint`; test id `cue-flow-mark-point`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/settings/CuesTab.test.tsx`, add `import { EXAMPLE_DROP } from '../../lib/cueExample'` and add inside `describe('CuesTab', …)`:

```tsx
  it('marks the point with a CALL by default and lets a DJ who does not mark it turn that off, the preview following', () => {
    render(<Harness />)
    expect(screen.getByTestId('cue-flow-mark-point')).toBeChecked()
    expect(screen.getByTestId(`cue-wave-call-${EXAMPLE_DROP}`)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cue-flow-mark-point'))
    expect(last?.cueFlows.find((f) => f.id === 'mine')?.markPoint).toBe(false)
    expect(screen.getByTestId('cue-flow-mark-point')).not.toBeChecked()
    expect(screen.queryByTestId(`cue-wave-call-${EXAMPLE_DROP}`)).toBeNull()
  })

  it('marks no flow in use while the editor is in Manual, and Usar este flujo leaves Manual', () => {
    render(<Harness active="manual" />)
    expect(screen.queryByTestId('cue-flow-in-use')).toBeNull()
    fireEvent.click(screen.getByTestId('cue-flow-use'))
    expect(last?.activeCueFlow).toBe('mine')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/settings/CuesTab.test.tsx`
Expected: FAIL, `cue-flow-mark-point` not found; Mi flujo shown "En uso" under Manual.

- [ ] **Step 3: Write the implementation**

In `CuesTab.tsx`, add `MANUAL_CUE_FLOW` to the `../../../../shared/cueFlows` import and `import { CheckboxRow } from './CheckboxRow'`. Replace `const inUse = activeCueFlow(synced).id` with:

```ts
  const inUse = synced.activeCueFlow === MANUAL_CUE_FLOW ? null : activeCueFlow(synced).id
```

Between the `{flow.rules.length === 0 && (…)}` block and `<div className="flex flex-wrap items-center gap-2">` that holds `cue-rule-add`, insert:

```tsx
            <CheckboxRow
              testid="cue-flow-mark-point"
              checked={flow.markPoint}
              onChange={(markPoint) => put({ ...flow, markPoint })}
              label={tr('settings.cueFlows.markPoint')}
            />
```

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/flujo-fantasma-t3.json`:

```json
{
  "es": { "settings": { "cueFlows": { "markPoint": "Marcar el punto con un CALL" } } },
  "en": { "settings": { "cueFlows": { "markPoint": "Mark the point with a CALL" } } },
  "de": { "settings": { "cueFlows": { "markPoint": "Den Punkt mit einem CALL markieren" } } },
  "fr": { "settings": { "cueFlows": { "markPoint": "Marquer le point avec un CALL" } } },
  "pt-BR": { "settings": { "cueFlows": { "markPoint": "Marcar o ponto com um CALL" } } }
}
```

and merge it with `learn-merge.cjs` as Global Constraints say.

- [ ] **Step 4: Run the tests and the checks**

Run the Step 2 command plus `src/renderer/src/i18n/usedKeys.test.ts src/renderer/src/i18n/keys.test.ts`, both `tsc`, `check`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/settings/CuesTab.tsx apps/desktop/src/renderer/src/components/settings/CuesTab.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Choose in Settings whether a flow marks its point with a CALL"
```

---

### Task 4: The mode selector replaces the button and the wait

**Files:**
- Modify: `src/renderer/src/components/Select.tsx` (`lead`, `divided`; `split` removed)
- Modify: `src/renderer/src/components/CuesSection.tsx`
- Modify: `src/renderer/src/components/Editor.tsx` (prop `onCueFlow`), `src/renderer/src/App.tsx` (`onCueFlow`)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json`
- Test: `src/renderer/src/components/Select.test.tsx`, `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `MANUAL_CUE_FLOW`, `followsPoint` (Task 1); `ghostOf` (Task 2); today's `CueWave` props `onMarkDrop`, `onSeek`, `onOpen` and `CueWaveDetail`'s `onPick`.
- Produces: in `Editing`, `chosen: string`, `manual: boolean`, `shownFlow: string`, `placing: boolean`, `pickMode(id: string): void`, `place(ms: number): void`, `switchGhost: DraftGhost | null`, `canApply: boolean` (Tasks 5 to 7 use these names). `CuesSection` prop `onFlow?: (id: string) => void`; `Editor` prop `onCueFlow?: (id: string) => void`. `Select` props `lead?: string` and option `divided?: boolean`. Locale keys `editor.cues.manualMode`, `editor.cues.placeHint`, `editor.cues.applyTrack`; removed `editor.cues.markDrop`, `editor.cues.markAnother`, `editor.cues.apply`, `editor.cues.armHint`.

- [ ] **Step 1: Write the failing Select tests**

Add inside `describe('Select', …)` of `src/renderer/src/components/Select.test.tsx`:

```tsx
  it('puts a lead word before the value on the trigger and keeps the accessible name as label and value', () => {
    render(
      <Select
        value="name"
        options={options}
        onChange={vi.fn()}
        label="Sort"
        testid="sort"
        lead="By"
      />,
    )
    expect(screen.getByTestId('sort')).toHaveTextContent('ByName')
    expect(screen.getByTestId('sort')).toHaveAccessibleName('Sort: Name')
  })

  it('draws a line before an option that starts another group, which the arrows step over', () => {
    render(
      <Select
        value="import"
        options={[...options, { value: 'none', label: 'None', divided: true }]}
        onChange={vi.fn()}
        label="Sort"
        testid="sort"
      />,
    )
    fireEvent.click(screen.getByTestId('sort'))
    expect(screen.getByTestId('sort-separator').nextElementSibling).toBe(
      screen.getByTestId('sort-option-none'),
    )
    screen.getByTestId('sort-option-artist').focus()
    fireEvent.keyDown(screen.getByTestId('sort-listbox'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByTestId('sort-option-none'))
  })
```

- [ ] **Step 2: Write the failing section tests**

In `src/renderer/src/components/CuesSection.test.tsx`:

1. Imports: `import { CALLS_ONLY, type CueFlow, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'`.
2. In `setup`, create `const onFlow = vi.fn<(id: string) => void>()`, pass `onFlow={onFlow}` to `<CuesSection …>` and return `onFlow` with the rest.
3. Replace the `markAt` helper with `const markAt = (ms: number) => clickAt(ms)`.
4. Delete these tests: "says Marcar dónde rompe while the track has no drop…", "waits for the click on the wave after Marcar dónde rompe…", "marks the drop with the click that follows and applies the flow in the same step", "stops waiting on a second press or once a drop is marked from the menu…", "offers Marcar otro donde rompe in the flow menu…", "adds exactly one more drop with Marcar otro donde rompe…", "cancels the wait for another drop with Escape…".
5. In "puts the strip first and the actions under it while folded, with a short Guardar", replace `screen.getByTestId('cues-apply-flow')` with `screen.getByTestId('cues-flow')`.
6. Replace the body of "marks with the flow picked from the arrow before any drop is marked" (rename it "places with the flow picked from the list before anything is placed"):

```tsx
    setup()
    await ready()
    chooseFlow('one-at-32')
    markAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(32) / 400000) * 100}%`,
    )
    expect(screen.queryByTestId('cue-wave-hot-B')).toBeNull()
```

7. In "applies another flow to the drops already marked", and in the guarded "saves only sets main accepts, even after turning a written countdown into CALLs", replace `fireEvent.click(screen.getByTestId('cues-apply-flow'))` with `fireEvent.click(screen.getByTestId('cues-apply-track'))` (the only line changed in the guarded test).
8. In "follows a flow chosen in Settings while the editor is open…", replace

```tsx
    await waitFor(() =>
      expect(screen.getByTestId('cues-apply-flow')).toHaveTextContent('Apply One cue at 32'),
    )
```

with

```tsx
    await waitFor(() =>
      expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: One cue at 32'),
    )
```

9. In "names the bundled flows in the flow list instead of showing them blank", expect `['My flow', 'One cue at 32', 'CALL only', 'Manual']`.
10. Add:

```tsx
  it('reads Flujo and the flow name on the selector, lists Manual apart after the flows and saves the pick', async () => {
    const { onFlow } = setup()
    await ready()
    const trigger = screen.getByTestId('cues-flow')
    expect(within(trigger).getByText('Flow')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('Flow: My flow')
    fireEvent.click(trigger)
    expect(screen.getByTestId('cues-flow-separator').nextElementSibling).toBe(
      screen.getByTestId('cues-flow-option-manual'),
    )
    fireEvent.click(screen.getByTestId('cues-flow-option-manual'))
    expect(onFlow).toHaveBeenCalledWith('manual')
    expect(screen.getByTestId('cues-flow')).toHaveAccessibleName('Flow: Manual')
  })

  it('places the flow with one click on the folded strip and says so, with no button to press first', async () => {
    setup()
    await ready()
    expect(screen.getByTestId('cues-place-hint')).toHaveTextContent('Click to place')
    expect(screen.queryByTestId('cues-apply-flow')).toBeNull()
    clickAt(bar(64))
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
  })

  it('takes the whole placement away with one ⌘Z', async () => {
    setup()
    await ready()
    markAt(bar(64))
    fireEvent.keyDown(screen.getByTestId('cue-wave'), { key: 'z', metaKey: true })
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
  })

  it('opens the full editor from a folded click in Manual and places nothing, with no hint', async () => {
    setup(READ, null, { activeCueFlow: 'manual' })
    await ready()
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    clickAt(bar(64))
    await waitFor(() =>
      expect(screen.getByTestId('cues-editor')).toHaveAttribute('data-maximized', 'true'),
    )
    expect(screen.queryAllByTestId(/^cue-wave-(hot|call)-/)).toHaveLength(0)
  })

  it('places a second point with a second click, each with its own cues', async () => {
    setup(READ, null, { activeCueFlow: 'one-at-32' })
    await ready()
    markAt(bar(64))
    markAt(bar(160))
    expect(screen.getByTestId(`cue-wave-call-${bar(64)}`)).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-call-${bar(160)}`)).toBeInTheDocument()
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(2)
  })

  it('places a flow that leaves the point unmarked without a CALL there, and a second click places again', async () => {
    const quiet: CueFlow = { ...ONE_AT_32, id: 'quiet', markPoint: false }
    setup(READ, null, { cueFlows: [MY_FLOW, quiet], activeCueFlow: 'quiet' })
    await ready()
    markAt(bar(64))
    markAt(bar(160))
    expect(screen.queryByTestId(`cue-wave-call-${bar(64)}`)).toBeNull()
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(2)
  })

  it('changes nothing when another flow is picked on a marked track until Aplicar a esta pista', async () => {
    setup()
    await ready()
    markAt(bar(64))
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
    chooseFlow('one-at-32')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.getByTestId('cues-apply-track')).toHaveTextContent('Apply to this track')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
    expect(screen.getByTestId('cue-wave-hot-A').style.left).toContain(
      `${(bar(32) / 400000) * 100}%`,
    )
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
  })

  it('offers Aplicar a esta pista at once for a flow that does not depend on the point, and no hint to click', async () => {
    const chorus: CueFlow = {
      id: 'chorus',
      name: 'Estribillos',
      markPoint: false,
      rules: [
        {
          from: 'chorus',
          direction: 'back',
          bars: 0,
          repeat: 1,
          when: 'always',
          place: 'hot',
          color: { fixed: 5 },
        },
      ],
    }
    setup(
      {
        ...READ,
        phrases: [
          { ms: bar(64), kind: 'chorus' },
          { ms: bar(128), kind: 'chorus' },
        ],
      },
      null,
      { cueFlows: [MY_FLOW, chorus], activeCueFlow: 'chorus' },
    )
    await ready()
    expect(screen.queryByTestId('cues-place-hint')).toBeNull()
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.getAllByTestId(/^cue-wave-hot-/)).toHaveLength(2)
    expect(screen.queryByTestId('cues-apply-track')).toBeNull()
  })
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx`:

1. In "opens the full editor with the playhead where the folded strip was clicked, without marking anything", write `setup({ activeCueFlow: 'manual' })` instead of `setup()`.
2. In "puts the length, BPM and key in grey beside the title and the main action…", rename it "…beside the title and the mode, Guardar, the keys and restore on the same bar" and use `for (const id of ['cues-flow', 'cues-save', 'cues-keys', 'section-maximize'])`.
3. Delete the five tests from "marks where it drops with the main button and one click on the overview…" through "stops waiting with Escape without restoring the full editor, and the overview seeks again" and add in their place:

```tsx
  it('places the flow with a click on the zoomed wave without moving the playhead', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(position()).toBe('2:08.0')
  })

  it('leaves the zoomed wave to the grab hand in Manual and places nothing with a click', async () => {
    setup({ activeCueFlow: 'manual' })
    await maximize()
    seek(128000)
    expect(screen.getByTestId('cue-detail').style.cursor).toBe('grab')
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(screen.queryByTestId('cue-wave-call-128000')).toBeNull()
  })

  it('gives the keys back to the editor after Manual is picked from the mode list, so M puts a CALL without a click', async () => {
    setup()
    await maximize()
    fireEvent.click(screen.getByTestId('cues-flow'))
    fireEvent.click(screen.getByTestId('cues-flow-option-manual'))
    expect(document.activeElement).toBe(editor())
    key('m')
    expect(screen.getByTestId('cue-wave-call-0')).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/Select.test.tsx src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL (no lead or separator, no Manual option, no hint, no `cues-apply-track`, folded click opens instead of placing).

- [ ] **Step 4: Select learns a lead word and a divided option**

In `src/renderer/src/components/Select.tsx`:
- `import { Fragment, useEffect, useRef, useState } from 'react'`.
- In `SelectOption`, add `divided?: boolean` as the last member. In `Props`, replace `split?: boolean` with `lead?: string`; in the parameter list replace `split = false,` with `lead,`.
- Replace the `look` constant with:

```ts
  const look = bare
    ? 'rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'
    : 'rounded-md border border-[var(--color-line)] bg-[var(--color-field)] text-fg-dim focus:border-[var(--color-accent)]'
```

- Replace the `{options.map((o) => (` … `))}` block of the list with:

```tsx
      {options.map((o) => (
        <Fragment key={o.value}>
          {o.divided && (
            <div
              role="separator"
              data-testid={`${testid}-separator`}
              className="my-1 h-px bg-[var(--color-line)]"
            />
          )}
          <button
            type="button"
            role="option"
            aria-selected={o.value === value}
            data-testid={`${testid}-option-${o.value}`}
            onClick={() => choose(o.value)}
            className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-[var(--color-hover)]"
          >
            {o.icon && <o.icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
            {hinted ? (
              <>
                <span className="w-3 shrink-0">{o.hint && o.label}</span>
                <span className="flex-1 font-mono text-fg-faint">{o.hint ?? o.label}</span>
              </>
            ) : (
              <span className="flex-1">{o.label}</span>
            )}
            <Check
              aria-hidden="true"
              className={`size-3 shrink-0 ${o.value === value ? '' : 'invisible'}`}
            />
          </button>
        </Fragment>
      ))}
```

- In the trigger, replace

```tsx
        {(selected?.short ?? selected?.label) && (
          <span className="min-w-0 flex-1 truncate text-left">
```

with

```tsx
        {lead && <span className="shrink-0 text-fg-dim">{lead}</span>}
        {(selected?.short ?? selected?.label) && (
          <span
            className={`min-w-0 flex-1 truncate text-left ${lead ? 'font-semibold text-fg' : ''}`}
          >
```

Run `rg -n "split" $WT/apps/desktop/src/renderer/src/components` afterwards: only `CuesSection.tsx` may still pass it, and the next step removes it.

- [ ] **Step 5: CuesSection, the selector, placing and Aplicar a esta pista**

In `src/renderer/src/components/CuesSection.tsx`:

Imports: `import { activeCueFlow, followsPoint, MANUAL_CUE_FLOW, MY_FLOW, MY_FLOW_ID } from '../../../shared/cueFlows'`; in the `../lib/cueDraft` import remove `draftDrops` and add `type DraftGhost, ghostOf`. Delete `const MARK_ANOTHER = 'mark-another'`.

`Editing` gains the prop `onFlow` (type `onFlow?: (id: string) => void`, after `onQuantize` in both the destructuring and the type).

Replace everything from `  const dropCount = draftDrops(state.cues, state.locked).length` through the closing `  }, [active.id])` of the `openedWith` effect with:

```ts
  const settled = settings.activeCueFlow === MANUAL_CUE_FLOW ? MANUAL_CUE_FLOW : active.id
  const [chosen, setChosen] = useState(
    settled === MANUAL_CUE_FLOW ? MANUAL_CUE_FLOW : state.flowId,
  )
  const manual = chosen === MANUAL_CUE_FLOW
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
  const placing = !manual && followsPoint(flows.find((f) => f.id === shownFlow) ?? MY_FLOW)
  const pickMode = (id: string) => {
    setChosen(id)
    if (id !== MANUAL_CUE_FLOW) dispatch({ type: 'use-flow', flowId: id })
    onFlow?.(id)
  }
  const place = (ms: number) => dispatch({ type: 'mark-drop', ms })
  const switchGhost = useMemo<DraftGhost | null>(
    () =>
      manual || (placing && state.generatedBy === shownFlow)
        ? null
        : ghostOf(state, { type: 'apply-flow', flowId: shownFlow }, ctx),
    [manual, placing, state, shownFlow, ctx],
  )
  const canApply =
    switchGhost !== null && (switchGhost.added.length > 0 || switchGhost.gone.length > 0)
  const openedWith = useRef(settled)
  useEffect(() => {
    if (openedWith.current === settled) return
    openedWith.current = settled
    setChosen(settled)
    if (settled !== MANUAL_CUE_FLOW) dispatch({ type: 'use-flow', flowId: settled })
  }, [settled])
```

In `run`, delete the line `    else if (key.type === 'memory' && armed) markDrop(playheadMs)`.

Delete the whole effect that starts `  useEffect(() => {\n    if (!armed) return` (the armed Escape listener).

In `actions`, replace from `      <div className="flex">` through the closing `      )}` of the `{armed && (…cues-arm-hint…)}` block with:

```tsx
      <Select
        testid="cues-flow"
        portal
        lead={tr('editor.cues.flow')}
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickMode}
        onClosed={maximized ? focusEditor : undefined}
        options={[
          ...flows.map((f) => ({ value: f.id, label: flowName(f, tr) })),
          { value: MANUAL_CUE_FLOW, label: tr('editor.cues.manualMode'), divided: true },
        ]}
      />
      {canApply && (
        <button
          type="button"
          data-testid="cues-apply-track"
          onClick={() => {
            dispatch({ type: 'apply-flow', flowId: shownFlow })
            if (maximized) focusEditor()
          }}
          className="press h-8 whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          {tr('editor.cues.applyTrack')}
        </button>
      )}
      {placing && (
        <span data-testid="cues-place-hint" role="status" className="text-xs text-fg-dim">
          {tr('editor.cues.placeHint')}
        </span>
      )}
```

In the `<CueWave …>` element replace

```tsx
        onMarkDrop={markDrop}
        onUnmarkDrop={armed ? undefined : (key) => dispatch({ type: 'unmark-drop', key })}
```

with `        onMarkDrop={placing ? place : undefined}`, and

```tsx
        onSeek={maximized && !armed ? seekTo : undefined}
        onOpen={maximized || armed ? undefined : openAt}
```

with

```tsx
        onSeek={maximized ? seekTo : undefined}
        onOpen={maximized || placing ? undefined : openAt}
```

In `<CueWaveDetail …>` replace `onPick={armed ? markDrop : undefined}` with `onPick={placing ? place : undefined}`.

Wrap the `cues-menu-mark-drop` button of the strip menu in `{placing && (` … `)}`.

In `CuesSection`, add `onFlow` to the destructured props and their type (`onFlow?: (id: string) => void`) and pass `onFlow={onFlow}` to `<Editing …>`.

- [ ] **Step 6: Wire the pick to the synced settings**

In `src/renderer/src/components/Editor.tsx`, add to the props type after `onCueQuantize?: (unit: CueQuantize) => void`:

```ts
  onCueFlow?: (id: string) => void
```

add `onCueFlow,` after `onCueQuantize,` in the destructuring, and `onFlow={onCueFlow}` after `onQuantize={onCueQuantize}` on `<CuesSection …>`.

In `src/renderer/src/App.tsx`, after the `onCueQuantize` callback add:

```ts
  const onCueFlow = useStableCallback((activeCueFlow: string) => saveSettings({ activeCueFlow }))
```

and pass `onCueFlow={onCueFlow}` after `onCueQuantize={onCueQuantize}` on `<Editor …>`.

- [ ] **Step 7: Locales**

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/flujo-fantasma-t4.json`:

```json
{
  "es": { "editor": { "cues": { "manualMode": "Manual", "placeHint": "Haz clic para colocar", "applyTrack": "Aplicar a esta pista" } } },
  "en": { "editor": { "cues": { "manualMode": "Manual", "placeHint": "Click to place", "applyTrack": "Apply to this track" } } },
  "de": { "editor": { "cues": { "manualMode": "Manuell", "placeHint": "Zum Setzen klicken", "applyTrack": "Auf diesen Titel anwenden" } } },
  "fr": { "editor": { "cues": { "manualMode": "Manuel", "placeHint": "Cliquez pour placer", "applyTrack": "Appliquer à ce morceau" } } },
  "pt-BR": { "editor": { "cues": { "manualMode": "Manual", "placeHint": "Clique para colocar", "applyTrack": "Aplicar a esta faixa" } } }
}
```

Merge it. Then delete with Edit, in each locale, the four lines of `editor.cues`:

- `es.json`: `"markDrop": "Marcar dónde rompe",`, `"markAnother": "Marcar otro donde rompe",`, `"apply": "Aplicar {{name}}",`, `"armHint": "Haz clic donde rompe",`
- `en.json`: `"markDrop": "Mark where it drops",`, `"markAnother": "Mark another where it drops",`, `"apply": "Apply {{name}}",`, `"armHint": "Click where it drops",`
- `de.json`: `"markDrop": "Drop markieren",`, `"markAnother": "Weiteren Drop markieren",`, `"apply": "{{name}} anwenden",`, `"armHint": "Klicke dort, wo der Drop kommt",`
- `fr.json`: `"markDrop": "Marquer le drop",`, `"markAnother": "Marquer un autre drop",`, `"apply": "Appliquer {{name}}",`, `"armHint": "Cliquez là où arrive le drop",`
- `pt-BR.json`: `"markDrop": "Marcar o drop",`, `"markAnother": "Marcar outro drop",`, `"apply": "Aplicar {{name}}",`, `"armHint": "Clique onde entra o drop",`

- [ ] **Step 8: Run the tests and the checks**

Run the Step 3 command plus `src/renderer/src/components/CuesSection.dedupe.test.tsx src/renderer/src/i18n/usedKeys.test.ts src/renderer/src/i18n/keys.test.ts src/renderer/src/components/Editor.test.tsx src/renderer/src/App.test.tsx`, both `tsc`, `check`.
Expected: PASS, the guarded tests included.

- [ ] **Step 9: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/Select.tsx apps/desktop/src/renderer/src/components/Select.test.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Choose a cue flow or Manual instead of arming the drop button"
```

---

### Task 5: The strip places, shows the cursor and draws a ghost

**Files:**
- Modify: `src/renderer/src/lib/cueMarks.ts` (`CueGhost`, `GHOST_OPACITY`, `GONE_OPACITY`)
- Modify: `src/renderer/src/components/CueWave.tsx`
- Modify: `src/renderer/src/lib/cueWave.ts` (`clickAction` removed)
- Modify: `src/renderer/src/components/CuesSection.tsx` (the `CueWave` element)
- Test: `src/renderer/src/components/CueWave.test.tsx`, `src/renderer/src/lib/cueWave.test.ts`, `src/renderer/src/components/CuesSection.maximized.test.tsx`, `src/renderer/src/components/CuesSection.dedupe.test.tsx`

**Interfaces:**
- Consumes: `placing`, `place` (Task 4).
- Produces: `export interface CueGhost { added: MarkInput[]; gone: string[] }`, `GHOST_OPACITY = 0.42`, `GONE_OPACITY = 0.18` in `cueMarks.ts`. `CueWave` props `onPlace?: (ms: number) => void` (replaces `onMarkDrop`), `onHover?: (ms: number | null) => void`, `ghost?: CueGhost`; `onUnmarkDrop` removed. With `onPlace` and `onSeek` both, a click places and a drag of more than 3 px seeks.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/CueWave.test.tsx`:

1. In `setup`'s `handlers`, replace `onMarkDrop: vi.fn(),` and `onUnmarkDrop: vi.fn(),` with `onPlace: vi.fn<(ms: number) => void>(),`.
2. Everywhere in the file, rename `h.onMarkDrop` and `handlers.onMarkDrop` to `h.onPlace` and `handlers.onPlace`, and the test id `'cue-wave-ghost'` to `'cue-wave-cursor'`.
3. Delete "takes a drop away with a click on its line", the `it.each([800, 1600])` "removes a drop 5 px away…", "shows no ghost over an existing drop" and "does not take a drop away with a click on its line when the folded strip only opens".
4. In "clears the ghost when it becomes read-only…", write `const props = { wave: null, grid: GRID, durationMs: 80000, cues: [], onPlace: vi.fn<(ms: number) => void>() }`.
5. In "moves the playhead instead of marking a drop when the full editor seeks with it" use `setup({ onSeek, playheadMs: 20000, onPlace: undefined })`; in "opens the editor at the clicked point instead of marking a drop when the folded strip only opens" use `setup({ onOpen, onPlace: undefined })` and delete its `handlers.onUnmarkDrop` line; in "moves the playhead while the strip is dragged and stops on release" use `setup({ onSeek, playheadMs: 0, onPlace: undefined })`.
6. Add:

```tsx
  it('hands the beat under the cursor to the editor and forgets it when the cursor leaves, so the flow is drawn only while hovering', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    setup({ onHover })
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 102, clientY: 40 })
    expect(onHover).toHaveBeenLastCalledWith(10000)
    expect(screen.getByTestId('cue-wave-cursor').style.left).toBe('12.5%')
    fireEvent.mouseLeave(screen.getByTestId('cue-wave'))
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
  })

  it('draws the cues the flow would add see-through and dims the ones it would take away, none of them clickable', () => {
    setup({
      ghost: {
        added: [
          { key: 'g1', ms: 32000, kind: 2, color: 22 },
          { key: 'g2', ms: 32000, kind: 0, color: null },
        ],
        gone: ['a'],
      },
    })
    expect(screen.getByTestId('cue-wave-ghost-hot-B')).toHaveStyle({ opacity: '0.42' })
    expect(screen.getByTestId('cue-wave-ghost-hot-B').tagName).toBe('SPAN')
    expect(screen.getByTestId('cue-wave-ghost-call-32000')).toHaveStyle({ opacity: '0.42' })
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveStyle({ opacity: '0.18' })
    expect(screen.getByTestId('cue-wave-call-40000')).toHaveAttribute('data-gone', 'false')
  })

  it('places with a click and moves the playhead with a drag when the full editor has a flow chosen', () => {
    const onSeek = vi.fn<(ms: number) => void>()
    const h = setup({ onSeek, playheadMs: 0 })
    const strip = screen.getByTestId('cue-wave')
    fireEvent.mouseDown(strip, { button: 0, clientX: 100 })
    fireEvent.mouseUp(window, { clientX: 100 })
    fireEvent.click(strip, { clientX: 100 })
    expect(h.onPlace).toHaveBeenCalledWith(10000)
    expect(onSeek).not.toHaveBeenCalled()
    fireEvent.mouseDown(strip, { button: 0, clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 102 })
    expect(onSeek).not.toHaveBeenCalled()
    fireEvent.mouseMove(window, { clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 480 })
    fireEvent.mouseUp(window, { clientX: 480 })
    fireEvent.click(strip, { clientX: 480 })
    expect(onSeek.mock.calls).toEqual([[40000], [48000]])
    expect(h.onPlace).toHaveBeenCalledTimes(1)
  })
```

In `src/renderer/src/lib/cueWave.test.ts`, delete `describe('clickAction', …)` and drop `clickAction` from the import.

In `src/renderer/src/components/CuesSection.dedupe.test.tsx`, write the mock as:

```tsx
vi.mock('./CueWave', () => ({
  CueWave: ({ onPlace }: { onPlace?: (ms: number) => void }) => (
    <button type="button" data-testid="add-same" onClick={() => onPlace?.(128000)} />
  ),
}))
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx`:

1. Replace the `seek` helper with a drag, so every test that moves the playhead keeps doing so whatever the mode (bodies untouched):

```tsx
const seek = (ms: number) => {
  fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: ms / 1000 + 10 })
  fireEvent.mouseMove(window, { clientX: ms / 1000 })
  fireEvent.mouseUp(window, { clientX: ms / 1000 })
}
```

2. In "opens the full editor with the playhead where the folded strip was clicked…", replace `seek(128000)` with `fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 128 })`.
3. Replace "moves the playhead with a click on the overview instead of marking a drop" with:

```tsx
  it('moves the playhead with a click on the overview in Manual', async () => {
    setup({ activeCueFlow: 'manual' })
    await maximize()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100 })
    expect(position()).toBe('1:40.0')
    expect(screen.queryByTestId('cue-wave-call-100000')).toBeNull()
  })

  it('places the flow with a click on the overview and moves the playhead with a drag', async () => {
    setup()
    await maximize()
    fireEvent.mouseDown(screen.getByTestId('cue-wave'), { button: 0, clientX: 128 })
    fireEvent.mouseUp(window, { clientX: 128 })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 128 })
    expect(screen.getByTestId('cue-wave-call-128000')).toBeInTheDocument()
    expect(position()).toBe('0:00.0')
    seek(100000)
    expect(position()).toBe('1:40.0')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueWave.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/CuesSection.dedupe.test.tsx`
Expected: FAIL (`onPlace` never called, no `cue-wave-cursor`, no ghost marks, the full-screen click seeks).

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/lib/cueMarks.ts`, after `MarkInput` add:

```ts
export interface CueGhost {
  added: MarkInput[]
  gone: string[]
}

export const GHOST_OPACITY = 0.42
export const GONE_OPACITY = 0.18
```

In `src/renderer/src/lib/cueWave.ts`, delete `clickAction` and remove `SAME_POSITION_MS` from its `cueRules` import if nothing else uses it.

In `src/renderer/src/components/CueWave.tsx`:

- Imports: `import { type CueGhost, GHOST_OPACITY, GONE_OPACITY, markStyle, placeCues } from '../lib/cueMarks'` and `import { barLines, cuePosition, peakBars, quantizePoints } from '../lib/cueWave'`. Delete `const HIT_PX = 6`.
- Props: replace `onMarkDrop,` and `onUnmarkDrop,` with `onPlace,`, add `onHover,` and `ghost,` after `view,`; in the type replace `onMarkDrop?: (ms: number) => void` and `onUnmarkDrop?: (key: string) => void` with `onPlace?: (ms: number) => void`, and add `onHover?: (ms: number | null) => void` and `ghost?: CueGhost` after `view?: …`.
- Replace `const [ghost, setGhost] = useState<number | null>(null)` with:

```ts
  const [cursor, setCursor] = useState<number | null>(null)
  const [press, setPress] = useState<number | null>(null)
  const dragged = useRef(false)
```

- In the read-only effect write `if (readOnly) setCursor(null)`.
- After the `seeking` effect add:

```ts
  useEffect(() => {
    if (press === null) return
    const move = (e: MouseEvent) => {
      if (Math.abs(e.clientX - press) <= DRAG_PX) return
      dragged.current = true
      setPress(null)
      setSeeking(true)
      latest.current.onSeek?.(msAtX(e.clientX))
    }
    const up = () => setPress(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [press, msAtX])
```

- Delete `const drops = calls.filter((c) => !c.paired)` and the whole `const at = (e: React.MouseEvent<HTMLDivElement>) => {…}` function, and add after `const { hot, calls } = placeCues(cues, durationMs)`:

```ts
  const snapAt = (clientX: number): number => snapMs[nearestBeat(snapMs, msAtX(clientX))]
  const gone = new Set(ghost?.gone ?? [])
  const ghostMarks = ghost ? placeCues(ghost.added, durationMs) : null
```

- Replace the root's `onMouseDown`, `onClick`, `onKeyDown`, `onMouseMove`, `onMouseLeave` and `className` with:

```tsx
      onMouseDown={(e) => {
        if (readOnly || !onSeek || e.button !== 0 || e.ctrlKey) return
        dragged.current = false
        if (onPlace) {
          setPress(e.clientX)
          return
        }
        onSeek(msAtX(e.clientX))
        setSeeking(true)
      }}
      onClick={(e) => {
        if (readOnly || swallowClick.current) return
        if (dragged.current) {
          dragged.current = false
          return
        }
        if (onPlace) {
          setCursor(null)
          onHover?.(null)
          onSelect?.(null)
          onPlace(snapAt(e.clientX))
          return
        }
        if (onSeek) {
          onSeek(msAtX(e.clientX))
          return
        }
        onOpen?.(msAtX(e.clientX))
      }}
      onKeyDown={(e) => {
        if (readOnly || e.target !== e.currentTarget || e.key !== 'Enter' || cursor === null) return
        onPlace?.(cursor)
      }}
```

keep `onContextMenu` as it is, then:

```tsx
      onMouseMove={(e) => {
        if (readOnly || !onPlace || seeking) return
        const ms = snapAt(e.clientX)
        setCursor(ms)
        onHover?.(ms)
      }}
      onMouseLeave={() => {
        setCursor(null)
        onHover?.(null)
      }}
      className={`relative h-16 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        readOnly ? 'cursor-default' : onPlace ? 'cursor-crosshair' : 'cursor-pointer'
      }`}
```

- In the CALL marks' `common`, add `'data-gone': gone.has(c.key) ? 'true' : 'false',` and write the style as `style: { ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR, ...(gone.has(c.key) ? { opacity: GONE_OPACITY } : {}) },`. In the hot marks' `common`, add `'data-gone': gone.has(h.key) ? 'true' : 'false',` and add `...(gone.has(h.key) ? { opacity: GONE_OPACITY } : {}),` as the last entry of its `style`.
- Replace the `{ghost !== null && (…cue-wave-ghost…)}` block with:

```tsx
      {ghostMarks?.calls.map((c) => (
        <span
          key={`gc${c.key}`}
          data-testid={`cue-wave-ghost-call-${c.ms}`}
          aria-hidden="true"
          style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR, opacity: GHOST_OPACITY }}
          className="pointer-events-none absolute z-10 h-0 w-0 border-x-4 border-x-transparent border-t-[6px]"
        />
      ))}
      {ghostMarks?.hot.map((h) => (
        <span
          key={`gh${h.key}`}
          data-testid={`cue-wave-ghost-hot-${h.letter}`}
          aria-hidden="true"
          style={{
            ...markStyle(h.at),
            backgroundColor: h.colour,
            color: '#000',
            opacity: GHOST_OPACITY,
          }}
          className="pointer-events-none absolute z-10 h-3 w-3 rounded-[3px] text-center text-[9px] font-semibold leading-3"
        >
          {h.letter}
        </span>
      ))}
      {cursor !== null && (
        <span
          data-testid="cue-wave-cursor"
          aria-hidden="true"
          style={{ left: pct(cursor) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/80"
        />
      )}
```

In `src/renderer/src/components/CuesSection.tsx`, in the `<CueWave …>` element replace `onMarkDrop={placing ? place : undefined}` with `onPlace={placing ? place : undefined}`.

- [ ] **Step 4: Run the tests and the checks**

Run the Step 2 command plus `src/renderer/src/lib/cueWave.test.ts src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CueFlowPreview.test.tsx src/renderer/src/components/settings/CuesTab.test.tsx src/renderer/src/index.css.test.ts`, both `tsc`, `check`.
Expected: PASS, every guarded test of `CuesSection.maximized.test.tsx` included.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/lib/cueMarks.ts apps/desktop/src/renderer/src/lib/cueWave.ts apps/desktop/src/renderer/src/lib/cueWave.test.ts apps/desktop/src/renderer/src/components/CueWave.tsx apps/desktop/src/renderer/src/components/CueWave.test.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx apps/desktop/src/renderer/src/components/CuesSection.dedupe.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Place a flow with a click on the cue strip and drag it to move the playhead"
```

---

### Task 6: The zoomed wave places, shows the cursor and draws a ghost

**Files:**
- Modify: `src/renderer/src/components/CueWaveDetail.tsx`
- Modify: `src/renderer/src/components/CuesSection.tsx` (the `CueWaveDetail` element)
- Test: `src/renderer/src/components/CueWaveDetail.test.tsx`

**Interfaces:**
- Consumes: `CueGhost`, `GHOST_OPACITY`, `GONE_OPACITY` (Task 5); `quantizePoints` (`lib/cueWave`); `nearestBeat` (`shared/cueRules`).
- Produces: `CueWaveDetail` props `onPlace?: (ms: number) => void` (replaces `onPick`), `onHover?: (ms: number | null) => void`, `ghost?: CueGhost`. A press and release within 3 px that did not start on a mark places at the quantized point; more is a scrub. Real marks carry `data-mark="true"` and `data-gone`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/CueWaveDetail.test.tsx`, replace "hands the time under a click to onPick while the editor waits for a drop, instead of scrubbing" with:

```tsx
  it('places on the bar under a click and still scrubs with a drag when a flow is chosen', () => {
    const onPlace = vi.fn<(ms: number) => void>()
    const { onScrub } = setup({ onPlace })
    const stage = screen.getByTestId('cue-detail')
    fireEvent.mouseDown(stage, { button: 0, clientX: 310 })
    fireEvent.mouseMove(window, { clientX: 312 })
    fireEvent.mouseUp(window, { clientX: 312 })
    expect(onPlace).toHaveBeenCalledWith(bar(36))
    expect(onScrub).not.toHaveBeenCalled()
    fireEvent.mouseDown(stage, { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(onScrub).toHaveBeenLastCalledWith(bar(32) + 8000)
    expect(onPlace).toHaveBeenCalledTimes(1)
  })

  it('never places on a press that starts on a mark, which belongs to its ✕ and its menu', () => {
    const onPlace = vi.fn<(ms: number) => void>()
    setup({ onPlace, cues: [{ key: 'b', ms: bar(36), kind: 2, color: 22, pending: false }] })
    fireEvent.mouseDown(screen.getByTestId('cue-detail-hot-B'), { button: 0, clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 300 })
    expect(onPlace).not.toHaveBeenCalled()
  })

  it('draws a thin line on the bar under the cursor and hands it on, and none without a flow', () => {
    const onHover = vi.fn<(ms: number | null) => void>()
    const { rerender } = setup({ onHover })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
    expect(onHover).not.toHaveBeenCalled()
    rerender({ onHover, onPlace: vi.fn<(ms: number) => void>() })
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 310 })
    expect(onHover).toHaveBeenLastCalledWith(bar(36))
    expect(screen.getByTestId('cue-detail-cursor').style.left).toBe('75%')
    fireEvent.mouseLeave(screen.getByTestId('cue-detail'))
    expect(onHover).toHaveBeenLastCalledWith(null)
    expect(screen.queryByTestId('cue-detail-cursor')).toBeNull()
  })

  it('draws the flow see-through and dims what it would take away', () => {
    setup({
      cues: [{ key: 'b', ms: bar(30), kind: 2, color: 22, pending: false }],
      ghost: {
        added: [
          { key: 'g', ms: bar(36), kind: 1, color: 42 },
          { key: 'gc', ms: bar(36), kind: 0, color: null },
        ],
        gone: ['b'],
      },
    })
    expect(screen.getByTestId('cue-detail-ghost-hot-A')).toHaveStyle({ opacity: '0.42' })
    expect(screen.getByTestId(`cue-detail-ghost-call-${bar(36)}`)).toHaveStyle({
      opacity: '0.42',
    })
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-detail-hot-B')).toHaveStyle({ opacity: '0.18' })
  })
```

In "shows a crosshair over the wave while it waits for a drop…", rename it "shows a crosshair over the wave when a flow is chosen, so the click reads as placing and not as grabbing" and write `rerender({ onPlace: vi.fn<(ms: number) => void>() })`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CueWaveDetail.test.tsx`
Expected: FAIL (no `onPlace`, no cursor, no ghost, a press on a mark places through `onPick`).

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/components/CueWaveDetail.tsx`:

- Imports: `import { nearestBeat } from '../../../shared/cueRules'`, `import { type CueGhost, GHOST_OPACITY, GONE_OPACITY, markStyle, placeCues, WAVE_MARK_LANE_PX } from '../lib/cueMarks'`, `import { barLines, quantizePoints } from '../lib/cueWave'`. After `const WAVE_SPAN = 0.8` add `const DRAG_PX = 3`.
- Props: replace `onPick,` with `onPlace,` and add `onHover,` and `ghost,` after `onDeleteMark,`; in the type replace `onPick?: (ms: number) => void` with `onPlace?: (ms: number) => void` and add `onHover?: (ms: number | null) => void` and `ghost?: CueGhost`.
- Replace from `const latest = useRef({ span, onScrub, onZoom })` through the end of the `drag` effect with:

```ts
  const snapMs = useMemo(() => quantizePoints(grid, quantize), [grid, quantize])
  const latest = useRef({ span, onScrub, onZoom, onPlace })
  latest.current = { span, onScrub, onZoom, onPlace }
  const [drag, setDrag] = useState<{
    x0: number
    ms0: number
    width: number
    pick: number | null
  } | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!drag) return
    moved.current = false
    const move = (e: MouseEvent) => {
      if (!moved.current && drag.pick !== null && Math.abs(e.clientX - drag.x0) <= DRAG_PX) return
      moved.current = true
      latest.current.onScrub(drag.ms0 - ((e.clientX - drag.x0) / drag.width) * latest.current.span)
    }
    const up = () => {
      if (!moved.current && drag.pick !== null) latest.current.onPlace?.(drag.pick)
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag])
  const [cursor, setCursor] = useState<number | null>(null)
  const snapAt = (clientX: number, rect: DOMRect): number =>
    snapMs[nearestBeat(snapMs, fromMs + ((clientX - rect.left) / rect.width) * span)]
```

- After `const pct = …` add:

```ts
  const gone = new Set(ghost?.gone ?? [])
  const ghostMarks = ghost
    ? placeCues(
        ghost.added.map((c) => ({ ...c, ms: c.ms - fromMs })),
        span,
      )
    : null
```

- Replace the stage's `onMouseDown` and `style` with:

```tsx
        onMouseDown={(e) => {
          if (e.button !== 0) return
          const rect = stageRef.current?.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          const onMark = (e.target as HTMLElement).closest('[data-mark]') !== null
          setCursor(null)
          onHover?.(null)
          setDrag({
            x0: e.clientX,
            ms0: playheadMs,
            width: rect.width,
            pick: onPlace && !onMark ? snapAt(e.clientX, rect) : null,
          })
        }}
        onMouseMove={(e) => {
          if (!onPlace || drag) return
          const rect = stageRef.current?.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          const ms = snapAt(e.clientX, rect)
          setCursor(ms)
          onHover?.(ms)
        }}
        onMouseLeave={() => {
          setCursor(null)
          onHover?.(null)
        }}
        style={{ cursor: onPlace ? 'crosshair' : 'grab', height: STAGE_HEIGHT }}
```

- On the CALL mark span add `data-mark="true"` and `data-gone={gone.has(c.key) ? 'true' : 'false'}`, and write its style as `style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR, ...(gone.has(c.key) ? { opacity: GONE_OPACITY } : {}) }}`. On the hot mark span add `data-mark="true"` and `data-gone={gone.has(h.key) ? 'true' : 'false'}`, and add `...(gone.has(h.key) ? { opacity: GONE_OPACITY } : {}),` as the last entry of its `style`.
- Before the closing `</div>` of the stage, after the `hot.map(…)` block, add:

```tsx
        {ghostMarks?.calls.map((c) => (
          <span
            key={`gc${c.key}`}
            data-testid={`cue-detail-ghost-call-${c.ms + fromMs}`}
            aria-hidden="true"
            style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR, opacity: GHOST_OPACITY }}
            className="pointer-events-none absolute z-10 h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px]"
          />
        ))}
        {ghostMarks?.hot.map((h) => (
          <span
            key={`gh${h.key}`}
            data-testid={`cue-detail-ghost-hot-${h.letter}`}
            aria-hidden="true"
            style={{
              ...markStyle(h.at),
              backgroundColor: h.colour,
              color: '#000',
              opacity: GHOST_OPACITY,
            }}
            className="pointer-events-none absolute z-10 h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px]"
          >
            {h.letter}
          </span>
        ))}
        {cursor !== null && cursor >= fromMs && cursor <= toMs && (
          <span
            data-testid="cue-detail-cursor"
            aria-hidden="true"
            style={{ left: pct(cursor) }}
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/80"
          />
        )}
```

In `src/renderer/src/components/CuesSection.tsx`, replace `onPick={placing ? place : undefined}` with `onPlace={placing ? place : undefined}`.

- [ ] **Step 4: Run the tests and the checks**

Run the Step 2 command plus `src/renderer/src/components/CuesSection.maximized.test.tsx src/renderer/src/components/CuesSection.test.tsx src/renderer/src/index.css.test.ts`, both `tsc`, `check`.
Expected: PASS ("places the flow with a click on the zoomed wave without moving the playhead" from Task 4 now runs through the click-versus-drag path).

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CueWaveDetail.tsx apps/desktop/src/renderer/src/components/CueWaveDetail.test.tsx apps/desktop/src/renderer/src/components/CuesSection.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Place a flow with a click on the zoomed wave and keep dragging to scrub"
```

---

### Task 7: The ghost follows the cursor and shows a flow switch

**Files:**
- Modify: `src/renderer/src/components/CuesSection.tsx`
- Test: `src/renderer/src/components/CuesSection.test.tsx`, `src/renderer/src/components/CuesSection.maximized.test.tsx`

**Interfaces:**
- Consumes: `ghostOf`, `DraftGhost` (Task 2); `placing`, `switchGhost`, `canApply`, `place` (Task 4); `CueWave` and `CueWaveDetail` props `onHover`, `ghost` (Tasks 5 and 6).
- Produces: in `Editing`, `hoverMs: number | null`, `ghost: DraftGhost | undefined` handed to both waves.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/CuesSection.test.tsx` add:

```tsx
  const marks = (re: RegExp) =>
    screen
      .queryAllByTestId(re)
      .map((el) => `${el.dataset.testid?.replace('ghost-', '')} ${el.style.left}`)
      .sort()
  const hoverAt = (ms: number) =>
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: ms / 1000, clientY: 40 })

  it('draws on hover what a click would place with Mi flujo, see-through, and the click places exactly that', async () => {
    setup()
    await ready()
    hoverAt(bar(64))
    const shown = marks(/^cue-wave-ghost-(hot|call)-/)
    expect(shown).toHaveLength(7)
    expect(marks(/^cue-wave-(hot|call)-/)).toEqual([])
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: bar(64) / 1000, clientY: 40 })
    expect(marks(/^cue-wave-(hot|call)-/)).toEqual(shown)
    expect(marks(/^cue-wave-ghost-/)).toEqual([])
  })

  it('draws only the CALL of the point and the hot cue 32 bars before with Una cue a 32', async () => {
    setup(READ, null, { activeCueFlow: 'one-at-32' })
    await ready()
    hoverAt(bar(64))
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/).map((el) => el.dataset.testid).sort()).toEqual([
      `cue-wave-ghost-call-${bar(64)}`,
      'cue-wave-ghost-hot-A',
    ])
  })

  it('draws no flow and no cursor in Manual', async () => {
    setup(READ, null, { activeCueFlow: 'manual' })
    await ready()
    hoverAt(bar(64))
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
    expect(screen.queryByTestId('cue-wave-cursor')).toBeNull()
  })

  it('dims what another flow would take away and draws what it would add, changing nothing until Aplicar a esta pista', async () => {
    setup()
    await ready()
    markAt(bar(64))
    chooseFlow('one-at-32')
    expect(screen.getByTestId('cue-wave-hot-C')).toHaveAttribute('data-gone', 'true')
    expect(screen.getByTestId('cue-wave-ghost-hot-A')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-hot-C')).toHaveAttribute('data-pending', 'true')
    fireEvent.click(screen.getByTestId('cues-apply-track'))
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
    expect(screen.queryByTestId('cue-wave-hot-C')).toBeNull()
  })

  it('draws the whole result of a flow that does not depend on the point as soon as it is chosen', async () => {
    const chorus: CueFlow = {
      id: 'chorus',
      name: 'Estribillos',
      markPoint: false,
      rules: [
        {
          from: 'chorus',
          direction: 'back',
          bars: 0,
          repeat: 1,
          when: 'always',
          place: 'hot',
          color: { fixed: 5 },
        },
      ],
    }
    setup(
      {
        ...READ,
        phrases: [
          { ms: bar(64), kind: 'chorus' },
          { ms: bar(128), kind: 'chorus' },
        ],
      },
      null,
      { cueFlows: [MY_FLOW, chorus], activeCueFlow: 'chorus' },
    )
    await ready()
    expect(screen.queryAllByTestId(/^cue-wave-ghost-hot-/)).toHaveLength(2)
    expect(screen.queryAllByTestId(/^cue-wave-hot-/)).toHaveLength(0)
  })
```

In `src/renderer/src/components/CuesSection.maximized.test.tsx` add inside `describe('CuesSection maximized keys', …)`:

```tsx
  it('draws the flow under the cursor on the zoomed wave and on the strip, and a click places it', async () => {
    setup()
    await maximize()
    seek(128000)
    fireEvent.mouseMove(screen.getByTestId('cue-detail'), { clientX: 200 })
    expect(screen.getByTestId('cue-detail-cursor')).toBeInTheDocument()
    expect(screen.getByTestId('cue-detail-ghost-call-128000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-ghost-call-128000')).toBeInTheDocument()
    expect(screen.getByTestId('cue-wave-ghost-hot-C')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId('cue-detail'), { button: 0, clientX: 200 })
    fireEvent.mouseUp(window, { clientX: 200 })
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/^cue-wave-ghost-/)).toHaveLength(0)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/CuesSection.maximized.test.tsx`
Expected: FAIL, no `cue-wave-ghost-*` and no `data-gone="true"`.

- [ ] **Step 3: Write the implementation**

In `Editing` of `src/renderer/src/components/CuesSection.tsx`, right after the `canApply` constant add:

```ts
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  const hoverGhost = useMemo<DraftGhost | null>(
    () =>
      placing && hoverMs !== null ? ghostOf(state, { type: 'mark-drop', ms: hoverMs }, ctx) : null,
    [placing, hoverMs, state, ctx],
  )
  const ghost = hoverGhost ?? (canApply && switchGhost !== null ? switchGhost : undefined)
```

On `<CueWave …>` add, after `onPlace={placing ? place : undefined}`:

```tsx
        onHover={placing ? setHoverMs : undefined}
        ghost={ghost}
```

On `<CueWaveDetail …>` add, after `onPlace={placing ? place : undefined}`:

```tsx
          onHover={placing ? setHoverMs : undefined}
          ghost={ghost}
```

- [ ] **Step 4: Run the tests and the checks**

Run the Step 2 command plus `src/renderer/src/components/CuesSection.dedupe.test.tsx src/renderer/src/components/CueWave.test.tsx src/renderer/src/components/CueWaveDetail.test.tsx`, both `tsc`, `check`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/CuesSection.maximized.test.tsx
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Draw the cues a flow would place under the cursor and on a flow switch"
```

---

### Task 8: Say "el punto", never "donde rompe"

**Files:**
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (values only)
- Test: `src/renderer/src/i18n/keys.test.ts`, `src/renderer/src/components/settings/CuesTab.test.tsx`, `src/renderer/src/components/CuesSection.test.tsx`

**Interfaces:**
- Consumes: nothing new. Produces: new values for `editor.cues.help`, `editor.cues.menuMarkDrop`, `settings.cueFlows.noRules`, `settings.cueFlows.previewHint`, `settings.cueFlows.looseCall`, `settings.cueFlows.from.drop`, `settings.cueFlows.when.first`. `cueWave.proposal` stays (automatic detection, out of scope).

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/i18n/keys.test.ts`, add at the end of the file:

```ts
describe('cue editor copy', () => {
  it('never says donde rompe, since a flow is placed on any point and not every DJ marks the drop', () => {
    expect(
      leaves(es)
        .filter(([key, text]) => /rompe/i.test(text) && key !== 'cueWave.proposal')
        .map(([key]) => key),
    ).toEqual([])
  })
})
```

In `src/renderer/src/components/settings/CuesTab.test.tsx`, in "reads each rule as one sentence, the way the DJ would say it", expect `'Desde el punto, hacia atrás, cada 16 compases, 3 veces, si cabe, pon hot cue + CALL'` and `'Desde el primer golpe, en el mismo golpe, si no hay otra antes del punto, pon hot cue + CALL'`.

In `src/renderer/src/components/CuesSection.test.tsx`, in "marks a drop from the menu and adds a lone CALL from the menu", add after the first `fireEvent.contextMenu(…)` line:

```tsx
    expect(screen.getByTestId('cues-menu-mark-drop')).toHaveTextContent('Place the flow here')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/i18n/keys.test.ts src/renderer/src/components/settings/CuesTab.test.tsx src/renderer/src/components/CuesSection.test.tsx`
Expected: FAIL, listing the seven keys and the old sentences.

- [ ] **Step 3: Write the copy**

Write `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/flujo-fantasma-t8.json` and merge it:

```json
{
  "es": {
    "editor": { "cues": {
      "help": "Elige un flujo y haz clic en la onda para colocarlo, o elige Manual y pon cada cue a mano. Selecciona una cue para moverla, borrarla o cambiarle color o letra.",
      "menuMarkDrop": "Colocar el flujo aquí"
    } },
    "settings": { "cueFlows": {
      "noRules": "Sin reglas. Colocar el flujo deja solo el CALL del punto.",
      "previewHint": "Pista de ejemplo a 128 BPM con el punto en el compás 64",
      "looseCall": "Un CALL suelto se lee como un punto la próxima vez",
      "from": { "drop": "Desde el punto" },
      "when": { "first": "si no hay otra antes del punto" }
    } }
  },
  "en": {
    "editor": { "cues": {
      "help": "Pick a flow and click the waveform to place it, or pick Manual and set each cue by hand. Select a cue to move it, delete it or change its colour or letter.",
      "menuMarkDrop": "Place the flow here"
    } },
    "settings": { "cueFlows": {
      "noRules": "No rules. Placing the flow leaves only the CALL of the point.",
      "previewHint": "Example track at 128 BPM with the point at bar 64",
      "looseCall": "A loose CALL reads as a point the next time",
      "from": { "drop": "From the point" },
      "when": { "first": "if there is none before the point" }
    } }
  },
  "de": {
    "editor": { "cues": {
      "help": "Wähle einen Ablauf und klicke auf die Wellenform, um ihn zu setzen, oder wähle Manuell und setze jedes Cue von Hand. Wähle ein Cue, um es zu verschieben, zu löschen oder Farbe und Buchstaben zu ändern.",
      "menuMarkDrop": "Ablauf hier setzen"
    } },
    "settings": { "cueFlows": {
      "noRules": "Keine Regeln. Der Ablauf setzt nur den CALL des Punkts.",
      "previewHint": "Beispieltitel mit 128 BPM und dem Punkt in Takt 64",
      "looseCall": "Ein einzelner CALL wird beim nächsten Mal als Punkt gelesen",
      "from": { "drop": "Ab dem Punkt" },
      "when": { "first": "wenn vor dem Punkt keins ist" }
    } }
  },
  "fr": {
    "editor": { "cues": {
      "help": "Choisissez un flux et cliquez sur la forme d’onde pour le placer, ou choisissez Manuel et placez chaque cue à la main. Sélectionnez un cue pour le déplacer, le supprimer ou changer sa couleur ou sa lettre.",
      "menuMarkDrop": "Placer le flux ici"
    } },
    "settings": { "cueFlows": {
      "noRules": "Aucune règle. Placer le flux ne laisse que le CALL du point.",
      "previewHint": "Morceau d’exemple à 128 BPM avec le point à la mesure 64",
      "looseCall": "Un CALL seul se lit comme un point la fois suivante",
      "from": { "drop": "Depuis le point" },
      "when": { "first": "s’il n’y en a pas avant le point" }
    } }
  },
  "pt-BR": {
    "editor": { "cues": {
      "help": "Escolha um fluxo e clique na forma de onda para colocá-lo, ou escolha Manual e ponha cada cue à mão. Selecione um cue para movê-lo, apagá-lo ou mudar a cor ou a letra.",
      "menuMarkDrop": "Colocar o fluxo aqui"
    } },
    "settings": { "cueFlows": {
      "noRules": "Sem regras. Colocar o fluxo deixa só o CALL do ponto.",
      "previewHint": "Faixa de exemplo a 128 BPM com o ponto no compasso 64",
      "looseCall": "Um CALL solto é lido como ponto na próxima vez",
      "from": { "drop": "A partir do ponto" },
      "when": { "first": "se não houver outra antes do ponto" }
    } }
  }
}
```

- [ ] **Step 4: Run the tests and the checks**

Run the Step 2 command plus `src/renderer/src/i18n/usedKeys.test.ts src/renderer/src/i18n/cueWarning.test.ts src/renderer/src/components/CueFlowPreview.test.tsx`, `check`, then `rg -n "rompe" $WT/apps/desktop/src/renderer/src --glob '!*.json'` and report any user-facing hit outside tests.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists add apps/desktop/src/renderer/src/i18n/keys.test.ts apps/desktop/src/renderer/src/components/settings/CuesTab.test.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/i18n/locales/es.json apps/desktop/src/renderer/src/i18n/locales/en.json apps/desktop/src/renderer/src/i18n/locales/de.json apps/desktop/src/renderer/src/i18n/locales/fr.json apps/desktop/src/renderer/src/i18n/locales/pt-BR.json
git -C /Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists commit -m "Speak of the point instead of the drop in the cue editor"
```

---

### Task 9: Verify on the copy with the driver

Done by the controller with the run-desktop driver (`apps/desktop/.claude/skills/run-desktop/driver.mjs`, `repl` mode, see its `SKILL.md`; the driver opens the `out/` of the tree it runs from, so build in this worktree) against `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/rb-edit/master.db`. Never `~/Library/Pioneer`, never `/Volumes/Vicent`. Screenshots go to `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/flujo-fantasma/`.

- [ ] **Step 1: Full suite, types, lint**

Full suite (`--reporter=dot --silent` into the scratch log), both `tsc`, `check`. Name any skipped or failing test (the `reopenSession` file is known to flake under load; rerun it alone before calling it).

- [ ] **Step 2: Point the dev settings at the copy**

With Surco closed, read `rekordboxDbPath` and `activeCueFlow` in `~/Library/Application Support/Electron/settings.json` (and the synced folder's `settings.json` if `configDir` is set). Set `rekordboxDbPath` to the `rb-edit` path with Edit and note both old values for Step 7. Stop if the file points at anything outside `/private/tmp/claude-501/`.

- [ ] **Step 3: Mi flujo, folded**

Build, launch, open a rekordbox playlist of the copy, select a track with no hot cues and no CALLs, open Cues. The bar reads "Flujo **Mi flujo** ▾", "Haz clic para colocar", Guardar. Move the pointer over the strip with `eval` dispatching `mousemove` at the bar where the track drops (find it on the wave): screenshot `mine-hover.png` and compare with the sketch's "1 · Mi flujo, con el cursor encima" (thin line, the CALL of the point and A, B, C each with its CALL 16 bars apart, see-through). Read the ghost marks' `left` with `eval`, click at the same point, read the real marks' `left`: the two lists are equal. ⌘Z removes all of them in one step.

- [ ] **Step 4: Una cue a 32 and Manual**

Pick "Una cue a 32" in the selector, hover the same point: only the CALL and one green hot cue 32 bars before (`one-hover.png`, sketch 2). Pick Manual: no hint, no ghost, no cursor line on hover; a folded click opens the full editor at that point (`manual.png`, sketch 3). Restore and pick Mi flujo again.

- [ ] **Step 5: Full screen and the switch**

Maximize. Hover the zoomed wave: cursor line and ghost on both the zoomed wave and the strip; a click places, a drag scrubs without placing; a drag on the strip moves the playhead. Place Mi flujo, then pick "Una cue a 32": A, B, C and their CALLs dim, the new green cue shows see-through, "Aplicar a esta pista" appears and nothing changes in `cues-save`'s disabled state until it is pressed (`switch.png`, sketch 4). Press it.

- [ ] **Step 6: Settings, the point without a CALL**

Open Settings › Cues, create a flow from "Una cue a 32" with "Marcar el punto con un CALL" off: the preview loses the CALL at bar 64. Back in the editor with that flow, place twice: two hot cues, no CALL on either point. Delete the test flow.

- [ ] **Step 7: Save, read back, restore and hand over**

Click "Guardar en rekordbox", apply the queue on the copy (no rekordbox running), read the copy's `djmdCue` rows for that `ContentID` with a read-only script in the scratchpad, and compare with the section re-read. Put the old `rekordboxDbPath` and `activeCueFlow` back. Ask Vicent to hover the waves himself (the driver cannot judge how the see-through reads by eye) and to open the `rb-edit` copy in rekordbox. Record what he saw, dated, under "Cómo sabremos que está" in the spec and commit the spec alone ("Record the ghost flow check on the rekordbox copy").

---

## Self-review

1. **Spec coverage.** Decision 1 (selector replaces button and wait, flows then Manual apart, synced): Task 4 (selector, removed ids and keys, `onFlow` to `saveSettings`), Task 1 (`MANUAL_CUE_FLOW` through normalisation and main), Task 3 (Settings honours Manual). Decision 2 (ghost on hover on the folded strip, the full-screen strip and the zoomed wave, quantized, only what fits, cursor line, "Haz clic para colocar"): Task 2 (`ghostOf` with quantize), Tasks 5 and 6 (cursor, ghost marks, `placeCues` keeps only what fits), Task 7 (wiring on both waves), Task 4 (hint). Decision 3 (click places what was seen, one undo step, same operation as marking): Task 2 (ghost equals commit, one undo), Task 4 (⌘Z test), Task 7 ("the click places exactly that"). Decision 4 (Manual: no ghost, folded click opens the full editor, manual tools in full screen): Task 4 and Task 7 tests. Decision 5 (switch shows gone and new, "Aplicar a esta pista", nothing changes before, placing uses the chosen flow): Tasks 2, 4 and 7. Decision 6 (safety stays): Global Constraints and the guarded tests; Task 2 changes only `mark-drop` and keeps `validWantedSet` true. Decision 8 (no "donde rompe"): Task 8 plus copy rules. Decision 9 (`markPoint`, default yes in Mi flujo, editable in Settings): Tasks 1 and 3. Decision 10 (point-independent flows apply without a click; mixed flows follow the cursor with every cue): Task 1 (`followsPoint`), Task 2 (mixed and chorus ghost tests), Tasks 4 and 7 (button and whole ghost at once). Decision 11 (one-off placement): Task 2. Success criteria: Task 7 tests (Mi flujo ghost equals placed marks; Una cue a 32 only two; Manual none; switch unchanged until applied), checked by eye in Task 9.
2. **Placeholder scan.** Every code step shows the code or the exact old and new text; every locale step carries its JSON or the exact lines to delete; Task 1 Step 4 names the `tsc`-driven literal fix and the files it expects.
3. **Type consistency.** `markPoint: boolean` (Task 1) is read by `reduceDraft` and `placeOnce` (Task 2), `CuesTab` (Task 3) and `followsPoint`; `FlowInput.point?: number` (Task 1) is passed by `placeOnce` and `examplePlan`; `DraftGhost { added: DraftCue[]; gone: string[] }` (Task 2) is assignable to `CueGhost { added: MarkInput[]; gone: string[] }` (Task 5) because `DraftCue` has `key`, `ms`, `kind`, `color`; `placing`, `place`, `switchGhost`, `canApply`, `shownFlow`, `manual` (Task 4) are the names Tasks 5 to 7 edit; `onPlace?: (ms: number) => void` replaces `onMarkDrop` in `CueWave` (Task 5) and `onPick` in `CueWaveDetail` (Task 6), each time with the `CuesSection` element renamed in the same task; `onHover?: (ms: number | null) => void` receives `setHoverMs` (Task 7); `Select`'s `lead?: string` and option `divided?: boolean` (Task 4) are what `CuesSection` passes.
4. **Review Focus.** Line 1 pinned in Task 6, line 2 in Tasks 5 and 6, line 3 in Tasks 2 and 4, line 4 in Task 4, line 5 in Task 1. Also covered though not listed: hovering an already placed point draws nothing (Task 2), a placement onto an occupied spot leaves the draft and its undo history alone (Task 2), Manual removes the right-click placing item (Task 4 wraps it in `placing`).

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-20-flujo-fantasma.md`. Tasks 1 and 2 are pure and can go first; Tasks 3 to 8 share `CuesSection.tsx` or the five locales, so they run one after another, never in parallel; Task 9 is the controller's.
