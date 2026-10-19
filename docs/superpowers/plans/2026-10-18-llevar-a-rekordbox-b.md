# Llevar a rekordbox, part B: cues from the waveform, list swatches and "complete on close" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a track from a rekordbox playlist shows a Cues section with rekordbox's own waveform and grid; a click marks a drop on the nearest beat, Surco draws the hot-cue countdown at 16, 32 and 48 bars with the rules of Vicent's `rules.py` unchanged, and "Guardar en rekordbox" queues the cues, which land when rekordbox is closed. The rekordbox list shows each row's hot cues as swatches, and an option, off by default, completes the countdown on close for tracks with drops and no hot cues.

**Architecture:** `shared/cueRules.ts` is a line-by-line port of `rules.py` plus one pure function, `cueChanges`, that turns the cues rekordbox has and the drops the user wants into the rows to insert, update and delete (the `completar` of `cues.py`, with the spec's extended rule 5 so removing a drop recalculates). The renderer draws the plan live with the same function; main applies it. `anlz.ts` (from the USB export plan) gains `PSSI` phrases and the `PWV5` colour waveform. `rekordboxCues.ts` reads a track's cues, grid, phrases and waveform, and writes a change set (`djmdCue`, `contentCue`, `djmdContent.CueUpdated`) as the spike did. Saving queues a `cues` operation on plan A's queue (rank 4, between renames and deletes), with the fingerprint of the cues it read; the batch writer refuses it if rekordbox's cues moved since.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), biome.

**Spec:** `docs/superpowers/specs/2026-10-18-llevar-a-rekordbox-design.md` ("Flujo 2", "Las reglas", "Escribir cues", "Completar solo"), measured by `docs/llevar-a-rekordbox-medidas.md` ("Cues (spike b)", "Resultado en rekordbox de verdad").

**Depends on:** plan A (`docs/superpowers/plans/2026-10-18-llevar-a-rekordbox-a.md`) merged: its queue, batch writer, watcher, pill and the seams listed in its "What plan B builds on". The USB export (`docs/superpowers/plans/2026-10-16-export-usb.md`) already shipped `src/main/anlz.ts` (`anlzSections`, `beatGrid`, `wavePreview`, `maskVocals`); this plan only appends to it and never changes what the export reads.

**Out of scope:** detecting drops automatically, writing ANLZ or analysing audio, BPM/key/grid edits, cue colours other than the four of the rules, loops (`OutMsec` stays −1), Vicent's `rekordbox-cues` script (spec: comment the WAL copy to him, do not touch it).

## Global Constraints

- Everything in plan A's Global Constraints applies here unchanged (never touch `~/Library/Pioneer` from tests or tools, every write through `applyRekordboxBatch`, rows as rekordbox makes them, 5 locales without em dash or explanatory colon, `data-testid` first, typed `window.api` mocks, zero comments in new code, the test/type/lint commands, the `merge-locale.cjs` helper, commit style).
- **The rules are `rules.py` without changing a comma** (spec Decision 6): `SAME_POSITION_MS` 50, `START_MS` 3000, `BAR_TOLERANCE` 0.25, `BEATS_PER_BAR` 4, `DISTANCES` 16/32/48, `MAX_HOT_CUES` 8, `TRIM_ORDER` 48 then 32, `CHORUS_BY_MOOD` {1: 5, 2: 9, 3: 9}. Ties resolve as Python's `min` does (first index, earliest tuple).
- **Colours and letters** (`cues.py`): `ColorTableIndex` 16 bars 1 (blue), 32 bars 22 (green), 48 bars 42 (red), start 32 (yellow); hot cue `Kind` in time order 1, 2, 3, 5, 6, 7, 8, 9 (A..H; 4 is not used); memory cues `Kind` 0 with `ColorTableIndex` NULL; `Color` −1 on every row.
- **Never overwrite manual work** (`fits_plan`): when the existing hot cues do not fit, only the drops (memory cues) are written and the hot cues are left as they are.
- **Rows as the spike wrote and rekordbox accepted** (medidas "Qué se ha escrito en el candidato"): new `djmdCue` with `ID` random 32-bit ≥ 100 unused, `UUID` v4, `ContentID`, `ContentUUID` (the track's `UUID`), `InMsec`, `InFrame` = floor(ms × 150 / 1000), `InMpegFrame`/`InMpegAbs`/`OutFrame`/`OutMpegFrame`/`OutMpegAbs` 0, `OutMsec` −1, `rb_local_usn` NULL (as rekordbox leaves hand-placed cues), `rb_data_status`/`rb_local_data_status`/`rb_local_deleted`/`rb_local_synced` 0, `usn` NULL, `created_at`/`updated_at` the batch stamp; an existing hot cue that changes letter or colour gets `Kind`, `ColorTableIndex`, `rb_local_usn` from `takeLocalUsn` and `updated_at`; a removed cue's row is deleted (medidas: nobody soft-deletes cues); `contentCue` keeps its JSON in step (entries with `ID, ContentID, ContentUUID, InMsec, InFrame, InMpegFrame, InMpegAbs, OutMsec, OutFrame, OutMpegFrame, OutMpegAbs, Kind, Color, UUID, created_at, updated_at`, timestamps ISO with `+00:00`), `rb_cue_count`, its own `rb_local_usn` and `updated_at`, or a new row keyed by the track `UUID`; `djmdContent.CueUpdated` goes up by the number of cue rows inserted, updated or deleted, then `rb_local_usn` (taken after `contentCue`'s) and `updated_at`.
- **Conflicts, rekordbox wins:** a `cues` operation carries the fingerprint (`ID`, `Kind`, `InMsec`, `ColorTableIndex` of every live cue) it was computed from; a different fingerprint at apply time drops it with "Los cues de Tengo cambiaron en rekordbox. Vuelve a marcarlos."
- **"Complete on close" is off by default** and only touches tracks with at least one drop, no hot cue and a grid.

## Decisions taken where the spec or the measurements left room

1. **New cue rows carry `rb_local_usn` NULL**, not a `takeLocalUsn` number as the spec says: medidas measured rekordbox leaving it NULL on hand-placed cues (18390 of 26291), the spike wrote NULL and rekordbox accepted it. Updated rows take a number, as the spike did.
2. **Removing a drop deletes its memory cue row**, and recalculating deletes the countdown hot cues of the old plan that the new plan no longer has, each with the memory cue `cues.py` paired with it at the same position. Without the second delete, that leftover memory cue would read as a new drop (`find_drops`).
3. **`classify` is ported too**, though Surco does not use it, because the spec asks for `test_cues.py` one to one and four of its tests exercise it.
4. **The waveform drawn is `PWV5` (colour, 150 columns per second) when the `.EXT` has it, else the `PWAV` preview** of the `.DAT`, as the spec says; neither is drawn when the track has no `AnalysisDataPath`.
5. **A `cues` operation's queue key is `cues:<contentId>`** (a later save replaces an earlier one) **and its pill item is `track:<path>`**, so a track with playlists and cues waiting is one line and counts once.
6. **The section appears only for a single track opened from a rekordbox playlist** (it needs the row's `contentId`); in a selection it shows the usual "one track only" line.
7. **"Complete on close" runs in the watcher**, right after it sees rekordbox closed and before it applies the queue, so the completions ride the same batch, backup and transaction.

## Review Focus

1. **A track whose grid starts after the first drop click, or a click before the first beat.** The drop snaps to the first beat; no countdown is planned before the start. Pinned in Task 1 (`nearestBeat` at index 0) and Task 8 (click mapping clamps).
2. **A track with hot cues placed by hand that do not fit.** Only drops are written, the hot cues stay byte for byte, the section says so. Pinned in Task 2 and Task 5.
3. **More than 8 hot cues needed.** Nothing written, the user told "Tengo necesitaría más de 8 hot cues. Quita un drop." Pinned in Task 2 and Task 6.
4. **rekordbox changed the cues (or re-analysed the track) between opening the section and closing rekordbox.** The operation is dropped with its notice; nothing else in the batch is affected. Pinned in Task 6.
5. **A track rekordbox has not analysed yet (the ones plan A added), or whose ANLZ files are missing.** The section says so and offers no marking; the swatch says "sin analizar"; "complete on close" skips it. Pinned in Task 4, Task 9 and Task 10.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/cueRules.ts` (new) | the port of `rules.py`; `cueChanges` (the `completar` plan with extended rule 5) |
| `src/main/anlz.ts` (mod) | `phrases` (PSSI, masked or not), `colorWave` (PWV5) |
| `src/main/rekordboxCues.ts` (new) | read a track's cues and analysis; write a change set; the fingerprint |
| `src/main/rekordboxPlaylistsFixture.ts` (mod) | `djmdCue`, `contentCue`, `AnalysisDataPath`, content `UUID` |
| `src/main/anlzFixture.ts` (new) | build PMAI buffers with PQTZ, PSSI, PWAV, PWV5 for tests |
| `src/main/rekordboxQueueOps.ts`, `rekordboxPlaylistWrite.ts`, `rekordboxQueue.ts` (mod) | the `cues` operation |
| `src/main/rekordboxCuesIpc.ts` (new) | `rekordbox:trackCues`, `rekordbox:saveCues`, `rekordbox:cueSummary`, `rekordbox:countCompletable` |
| `src/main/rekordboxCompleteOnClose.ts` (new) | the completable tracks and their operations |
| `src/main/rekordboxQueueWatch.ts`, `src/main/index.ts` (mod) | the close hook, wiring |
| `src/shared/types.ts`, `src/shared/editorSections.ts` (mod) | cue types, notices, the `cues` section, the setting |
| `src/preload/*`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (mod) | new calls and stubs |
| `src/renderer/src/components/CueWave.tsx` (new) | waveform, grid, cues, click and hover |
| `src/renderer/src/components/CuesSection.tsx` (new), `hooks/useTrackCues.ts` (new) | the section, its data and actions |
| `src/renderer/src/components/CueSwatches.tsx` (new) | the row's swatches |
| `src/renderer/src/components/Editor.tsx`, `TrackList.tsx`, `App.tsx`, `settings/DestinationTab.tsx`, `lib/rekordboxQueueText.ts` (mod) | wiring |
| `src/renderer/src/i18n/locales/*.json` (mod) | `editor.cues.*`, `trackList.cues*`, `settings.completeCues*`, `rekordboxQueue` cues entries |

All paths below are relative to `apps/desktop/` unless they start with `docs/`.

## Task list

| # | Task |
|---|---|
| 1 | Port `rules.py` |
| 2 | The change set: `completar` with extended rule 5 |
| 3 | PSSI phrases and the PWV5 waveform |
| 4 | Read a track's cues and analysis |
| 5 | Write a change set |
| 6 | The `cues` operation in the queue, and its IPC |
| 7 | The waveform with grid and cues |
| 8 | The Cues section |
| 9 | Swatches in the rekordbox list |
| 10 | Complete on close |
| 11 | Verify on a copy, then Vicent in real rekordbox |

---

### Task 1: Port `rules.py`

**Files:**
- Create: `src/shared/cueRules.ts`
- Test: `src/shared/cueRules.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (all exported from `shared/cueRules.ts`, so the renderer draws the plan without asking main):
  - constants `SAME_POSITION_MS`, `START_MS`, `BAR_TOLERANCE`, `BEATS_PER_BAR`, `DISTANCES`, `MAX_HOT_CUES`, `TRIM_ORDER`, `CHORUS_BY_MOOD`
  - `type CountdownKind = 16 | 32 | 48 | 'inicio'`; `interface PlannedCue { ms: number; kind: CountdownKind }`; `interface Phrase { beat: number; kind: number }`; `interface StrongPart { start: number; end: number }`
  - `findDrops(memoryMs: number[], hotMs: number[]): number[]`
  - `classify(cueMs: number, drops: number[], bpm: number): { kind: CountdownKind | null; bars: number | null }`
  - `nearestBeat(beatsMs: number[], ms: number): number`
  - `strongParts(mood: number, phrases: Phrase[], beatsMs: number[]): StrongPart[]`
  - `planCues(dropsMs: number[], beatsMs: number[], strong?: StrongPart[]): PlannedCue[]`
  - `fitsPlan(existingHotMs: number[], plan: PlannedCue[]): boolean`

The tests are `test_cues.py` one to one (same names, same numbers), so a reader can hold the two files side by side. `rules.cjs` in the spike was checked against the Python in 3000 random cases with 0 differences; this port follows it line for line, with the Python's tuple `(ms, kind)` as `{ ms, kind }`.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/cueRules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classify, findDrops, fitsPlan, nearestBeat, planCues, strongParts } from './cueRules'

const BPM = 145.0
const BAR_MS = 240000 / BPM
const BEAT_MS = BAR_MS / 4
const grid = (bars: number): number[] =>
  Array.from({ length: bars * 4 }, (_, i) => Math.round(i * BEAT_MS))
const beat = (bars: number): number => Math.round(bars * 4 * BEAT_MS)
const cue = (ms: number, kind: 16 | 32 | 48 | 'inicio') => ({ ms, kind })

describe('findDrops', () => {
  it('memory cue paired with hot cue is not a drop', () => {
    expect(findDrops([105, 26588, 79554], [105, 26588])).toEqual([79554])
  })

  it('drops are sorted because rekordbox returns cues unordered', () => {
    expect(findDrops([90000, 30000], [])).toEqual([30000, 90000])
  })
})

describe('classify', () => {
  it('each distance has its own color so it reads the same in every track', () => {
    const drop = 100 * BAR_MS
    for (const bars of [16, 32, 48] as const)
      expect(classify(drop - bars * BAR_MS, [drop], BPM).kind).toBe(bars)
  })

  it('only the next drop counts', () => {
    expect(classify(104 * BAR_MS, [40 * BAR_MS, 120 * BAR_MS], BPM).kind).toBe(16)
  })

  it('start cue with odd intro length is marked as start', () => {
    expect(classify(77, [12 * BAR_MS + 77], BPM).kind).toBe('inicio')
  })

  it('start cue at exact distance keeps distance color', () => {
    expect(classify(0, [48 * BAR_MS], BPM).kind).toBe(48)
  })

  it('odd distance is left for manual review', () => {
    expect(classify(10000, [10000 + 56 * BAR_MS], BPM).kind).toBeNull()
  })

  it('cue after last drop is left for manual review', () => {
    expect(classify(200000, [100000], BPM).kind).toBeNull()
  })
})

describe('planCues', () => {
  it('long intro gets the full countdown so every drop can be reached from 48 bars', () => {
    expect(planCues([beat(64)], grid(200))).toEqual([
      cue(beat(16), 48),
      cue(beat(32), 32),
      cue(beat(48), 16),
    ])
  })

  it('countdown stops at track start because cues cannot exist before it', () => {
    expect(planCues([beat(40)], grid(200))).toEqual([cue(beat(8), 32), cue(beat(24), 16)])
  })

  it('countdown never reaches the previous drop so it stays detectable as a drop', () => {
    expect(planCues([beat(16), beat(48)], grid(200))).toEqual([
      cue(beat(0), 16),
      cue(beat(32), 16),
    ])
  })

  it('intro too short for blue gets a yellow entry point', () => {
    expect(planCues([beat(12)], grid(200))).toEqual([cue(0, 'inicio')])
  })

  it('track without drops is left unmarked so it still looks pending', () => {
    expect(planCues([], grid(200))).toEqual([])
  })

  it('countdown follows the real beatgrid so tempo changes do not misplace cues', () => {
    const beats = [
      ...Array.from({ length: 100 }, (_, i) => i * 500),
      ...Array.from({ length: 200 }, (_, i) => 50000 + i * 400),
    ]
    expect(planCues([beats[164]], beats)).toEqual([cue(beats[36], 32), cue(beats[100], 16)])
  })

  it('blue survives the 8 cue limit because it is the cue that matters most', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    const plan = planCues(drops, grid(400))
    expect(plan).toHaveLength(8)
    expect(plan.filter((p) => p.kind === 16)).toHaveLength(4)
    expect(plan.map((p) => p.kind)).not.toContain(48)
  })
})

describe('strong parts', () => {
  it('countdown stops inside a strong part because the track has not dropped yet', () => {
    expect(planCues([beat(64)], grid(200), [{ start: beat(0), end: beat(40) }])).toEqual([
      cue(beat(48), 16),
    ])
  })

  it('countdown stops at the first strong part even if earlier cues would be outside it', () => {
    expect(planCues([beat(64)], grid(200), [{ start: beat(24), end: beat(40) }])).toEqual([
      cue(beat(48), 16),
    ])
  })

  it('cue where the break begins is kept', () => {
    expect(planCues([beat(64)], grid(200), [{ start: beat(0), end: beat(32) }])).toEqual([
      cue(beat(32), 32),
      cue(beat(48), 16),
    ])
  })

  it('chorus kind depends on rekordbox mood', () => {
    const beats = grid(200)
    expect(
      strongParts(
        1,
        [
          { beat: 1, kind: 1 },
          { beat: 33, kind: 5 },
          { beat: 65, kind: 3 },
        ],
        beats,
      ),
    ).toEqual([{ start: beats[32], end: beats[64] }])
    expect(
      strongParts(
        2,
        [
          { beat: 1, kind: 1 },
          { beat: 33, kind: 9 },
          { beat: 65, kind: 8 },
        ],
        beats,
      ),
    ).toEqual([{ start: beats[32], end: beats[64] }])
  })

  it('last phrase runs until the end of the track', () => {
    const beats = grid(200)
    expect(
      strongParts(
        1,
        [
          { beat: 1, kind: 1 },
          { beat: 33, kind: 5 },
        ],
        beats,
      ),
    ).toEqual([{ start: beats[32], end: beats[beats.length - 1] }])
  })

  it('phrases beyond the beatgrid are ignored because rekordbox analyses can disagree', () => {
    const beats = grid(10)
    expect(
      strongParts(
        1,
        [
          { beat: 1, kind: 5 },
          { beat: 33, kind: 5 },
          { beat: 65, kind: 5 },
        ],
        beats,
      ),
    ).toEqual([
      { start: beats[0], end: beats[32] },
      { start: beats[32], end: beats[beats.length - 1] },
    ])
  })
})

describe('nearestBeat', () => {
  // Python's min keeps the first of two equally near beats; a later one would move a
  // drop clicked exactly between two beats.
  it('keeps the earlier beat on a tie, as min does', () => {
    expect(nearestBeat([0, 100], 50)).toBe(0)
  })

  it('snaps a click before the first beat to the first beat', () => {
    expect(nearestBeat([500, 1000], 0)).toBe(0)
  })
})

describe('fitsPlan', () => {
  it('existing cues on planned positions can be completed', () => {
    expect(fitsPlan([beat(48) + 1], [cue(beat(16), 48), cue(beat(48), 16)])).toBe(true)
  })

  it('cue placed elsewhere blocks the track so manual work is never overwritten', () => {
    expect(fitsPlan([beat(40)], [cue(beat(16), 48), cue(beat(48), 16)])).toBe(false)
  })

  it('manual yellow at track start is respected', () => {
    expect(fitsPlan([1], [cue(beat(48), 16)])).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/cueRules.test.ts`
Expected: FAIL, `Cannot find module './cueRules'`.

- [ ] **Step 3: Implement**

Create `src/shared/cueRules.ts`:

```ts
export const SAME_POSITION_MS = 50
export const START_MS = 3000
export const BAR_TOLERANCE = 0.25
export const BEATS_PER_BAR = 4
export const DISTANCES = [16, 32, 48] as const
export const MAX_HOT_CUES = 8
export const TRIM_ORDER = [48, 32] as const
export const CHORUS_BY_MOOD: Record<number, number> = { 1: 5, 2: 9, 3: 9 }

export type CountdownKind = 16 | 32 | 48 | 'inicio'

export interface PlannedCue {
  ms: number
  kind: CountdownKind
}

export interface Phrase {
  beat: number
  kind: number
}

export interface StrongPart {
  start: number
  end: number
}

export function findDrops(memoryMs: number[], hotMs: number[]): number[] {
  return memoryMs
    .filter((m) => hotMs.every((h) => Math.abs(m - h) > SAME_POSITION_MS))
    .sort((a, b) => a - b)
}

export function classify(
  cueMs: number,
  drops: number[],
  bpm: number,
): { kind: CountdownKind | null; bars: number | null } {
  const following = drops.filter((d) => d > cueMs + SAME_POSITION_MS)
  const bars = following.length > 0 ? (following[0] - cueMs) / (240000 / bpm) : null
  const distance = DISTANCES.find((n) => bars && Math.abs(bars - n) < BAR_TOLERANCE) ?? null
  if (distance === null && cueMs < START_MS) return { kind: 'inicio', bars }
  return { kind: distance, bars }
}

export function nearestBeat(beatsMs: number[], ms: number): number {
  let best = 0
  for (let i = 1; i < beatsMs.length; i++)
    if (Math.abs(beatsMs[i] - ms) < Math.abs(beatsMs[best] - ms)) best = i
  return best
}

export function strongParts(mood: number, phrases: Phrase[], beatsMs: number[]): StrongPart[] {
  const starts = [...phrases.map((p) => p.beat), beatsMs.length]
  const out: StrongPart[] = []
  phrases.forEach((p, i) => {
    const end = starts[i + 1]
    if (p.kind === CHORUS_BY_MOOD[mood] && p.beat <= beatsMs.length)
      out.push({ start: beatsMs[p.beat - 1], end: beatsMs[Math.min(end, beatsMs.length) - 1] })
  })
  return out
}

export function planCues(
  dropsMs: number[],
  beatsMs: number[],
  strong: StrongPart[] = [],
): PlannedCue[] {
  let plan: PlannedCue[] = []
  let previous: number | null = null
  for (const drop of [...dropsMs].sort((a, b) => a - b)) {
    const index = nearestBeat(beatsMs, drop)
    for (const bars of DISTANCES) {
      const back = index - bars * BEATS_PER_BAR
      if (back < 0 || (previous !== null && beatsMs[back] <= previous + SAME_POSITION_MS)) break
      if (strong.some((s) => s.start <= beatsMs[back] && beatsMs[back] < s.end)) break
      plan.push({ ms: beatsMs[back], kind: bars })
    }
    previous = drop
  }
  const firstDrop = dropsMs.length > 0 ? Math.min(...dropsMs) : null
  if (
    firstDrop !== null &&
    !plan.some((p) => p.ms < firstDrop) &&
    beatsMs[0] < firstDrop - SAME_POSITION_MS
  )
    plan.push({ ms: beatsMs[0], kind: 'inicio' })
  for (const kind of TRIM_ORDER) {
    while (plan.length > MAX_HOT_CUES && plan.some((p) => p.kind === kind)) {
      const earliest = plan
        .filter((p) => p.kind === kind)
        .reduce((a, b) => (b.ms < a.ms ? b : a))
      plan = plan.filter((p) => p !== earliest)
    }
  }
  return plan.sort((a, b) => a.ms - b.ms)
}

export function fitsPlan(existingHotMs: number[], plan: PlannedCue[]): boolean {
  return existingHotMs.every(
    (ms) => ms < START_MS || plan.some((p) => Math.abs(ms - p.ms) <= SAME_POSITION_MS),
  )
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/cueRules.test.ts`
Expected: PASS, 26 tests (24 from `test_cues.py`, two for `nearestBeat`).

- [ ] **Step 5: Mutation check**

One at a time, rerun after each and restore: change `TRIM_ORDER` to `[32, 48]` (`'blue survives the 8 cue limit...'` must fail); change `ms < START_MS` in `fitsPlan` to `ms < 0` (`'manual yellow at track start is respected'` must fail); remove the `strong.some(...)` break (three strong-part tests must fail); change `<` to `<=` in `nearestBeat` (`'keeps the earlier beat on a tie, as min does'` must fail).

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/shared/cueRules.ts apps/desktop/src/shared/cueRules.test.ts
git commit -m "Port the rekordbox-cues countdown rules to TypeScript"
```

---

### Task 2: The change set: `completar` with extended rule 5

**Files:**
- Modify: `src/shared/cueRules.ts` (append)
- Test: `src/shared/cueRules.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 `planCues`, `fitsPlan`, `SAME_POSITION_MS`, `START_MS`, `MAX_HOT_CUES`, `PlannedCue`, `StrongPart`.
- Produces:
  - `COLOR_BY_KIND: Record<CountdownKind, number>` (16: 1, 32: 22, 48: 42, inicio: 32), `HOT_KINDS = [1, 2, 3, 5, 6, 7, 8, 9]`
  - `interface ExistingCue { id: string; ms: number; kind: number; color: number | null }` (`kind` 0 is a memory cue)
  - `interface CueChangeSet { insert: { ms: number; kind: number; color: number | null }[]; update: { id: string; kind: number; color: number }[]; remove: string[] }`
  - `interface DrawnHotCue { ms: number; kind: number; color: number }`
  - `type CueOutcome = { status: 'plan'; changes: CueChangeSet; hot: DrawnHotCue[] } | { status: 'manual'; changes: CueChangeSet } | { status: 'too-many'; needed: number }`
  - `cueChanges(existing: ExistingCue[], drops: number[], previousDrops: number[], beats: number[], strong: StrongPart[]): CueOutcome`
  - `isEmptyChange(changes: CueChangeSet): boolean`

Rules (spec "Las reglas" 5 and 6, `cues.py completar`, plan B Decision 2):
- Drops are memory cues away from every hot cue. A wanted drop with no memory cue there gets one; a current drop no longer wanted is removed.
- Fit: every existing hot cue is before 3 s, or on the new plan, or on the plan computed from `previousDrops` (the countdown Surco or the script put, which is recalculated). No fit: status `manual`, only the drop changes.
- Fit: wanted = the plan plus every hot cue before 3 s that is not on it (kept as "inicio"); more than 8 is `too-many` and nothing is written. In time order they take `HOT_KINDS`; a hot cue already at the position is reused (updated only if its letter or colour differs), else inserted; every planned position without a memory cue gets one. A hot cue not wanted (it was on the old plan) is removed with the memory cue at its position.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/cueRules.test.ts` (add `cueChanges`, `type ExistingCue`, `isEmptyChange` to the import):

```ts
describe('cueChanges', () => {
  let n = 0
  const id = () => `c${++n}`
  const hotAt = (ms: number, kind: number, color: number): ExistingCue => ({ id: id(), ms, kind, color })
  const memAt = (ms: number): ExistingCue => ({ id: id(), ms, kind: 0, color: null })
  const byMs = <T extends { ms: number; kind: number }>(a: T, b: T) => a.ms - b.ms || a.kind - b.kind

  // Flow 2 on a track with no cues: the drop, the countdown in A, B, C with their colours,
  // and a memory cue under each hot cue, as the script writes it.
  it('writes the drop and its countdown on a track without cues', () => {
    const out = cueChanges([], [beat(64)], [], grid(200), [])
    expect(out.status).toBe('plan')
    if (out.status !== 'plan') return
    expect([...out.changes.insert].sort(byMs)).toEqual([
      { ms: beat(16), kind: 0, color: null },
      { ms: beat(16), kind: 1, color: 42 },
      { ms: beat(32), kind: 0, color: null },
      { ms: beat(32), kind: 2, color: 22 },
      { ms: beat(48), kind: 0, color: null },
      { ms: beat(48), kind: 3, color: 1 },
      { ms: beat(64), kind: 0, color: null },
    ])
    expect(out.changes.update).toEqual([])
    expect(out.changes.remove).toEqual([])
    expect(out.hot).toEqual([
      { ms: beat(16), kind: 1, color: 42 },
      { ms: beat(32), kind: 2, color: 22 },
      { ms: beat(48), kind: 3, color: 1 },
    ])
  })

  // Measured on Hands Of Fate: a new countdown shifts the letters of the cues after it.
  it('reuses hot cues already on the plan and moves their letters', () => {
    const existing = [hotAt(0, 1, 32), hotAt(beat(48), 2, 1), memAt(beat(48)), memAt(beat(64))]
    const out = cueChanges(existing, [beat(64), beat(128)], [beat(64)], grid(200), [])
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.hot.map((h) => h.kind)).toEqual([1, 2, 3, 5, 6, 7, 8])
    expect(out.changes.update).toEqual([{ id: existing[1].id, kind: 5, color: 1 }])
    expect(out.changes.remove).toEqual([])
    expect(out.changes.insert.filter((c) => c.kind === 0).map((c) => c.ms).sort((a, b) => a - b)).toEqual([
      0,
      beat(16),
      beat(32),
      beat(80),
      beat(96),
      beat(112),
      beat(128),
    ])
  })

  // fits_plan: a hot cue the DJ put by hand somewhere else is never touched.
  it('writes only the drops when hand-placed hot cues do not fit', () => {
    const manual = hotAt(beat(40), 1, 1)
    const out = cueChanges([manual], [beat(64)], [], grid(200), [])
    expect(out).toEqual({
      status: 'manual',
      changes: { insert: [{ ms: beat(64), kind: 0, color: null }], update: [], remove: [] },
    })
  })

  // Extended rule 5: removing a drop recalculates; the old countdown goes with its memory
  // cues, or each leftover memory cue would read as a new drop.
  it('removes the countdown of a drop the user took away, with its paired memory cues', () => {
    const plan = [
      [beat(16), 1, 42],
      [beat(32), 2, 22],
      [beat(48), 3, 1],
      [beat(80), 5, 42],
      [beat(96), 6, 22],
      [beat(112), 7, 1],
    ] as const
    const hot = plan.map(([ms, kind, color]) => hotAt(ms, kind, color))
    const paired = plan.map(([ms]) => memAt(ms))
    const drop64 = memAt(beat(64))
    const drop128 = memAt(beat(128))
    const out = cueChanges(
      [...hot, ...paired, drop64, drop128],
      [beat(64)],
      [beat(64), beat(128)],
      grid(200),
      [],
    )
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.changes.insert).toEqual([])
    expect(out.changes.update).toEqual([])
    expect([...out.changes.remove].sort()).toEqual(
      [hot[3].id, hot[4].id, hot[5].id, paired[3].id, paired[4].id, paired[5].id, drop128.id].sort(),
    )
  })

  // Spec: more than 8 hot cues, nothing is written and the user is told.
  it('refuses a plan that needs more than 8 hot cues', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    expect(cueChanges([hotAt(500, 1, 32)], drops, [], grid(400), [])).toEqual({
      status: 'too-many',
      needed: 9,
    })
  })

  it('changes nothing when the cues already are the plan', () => {
    const existing = [
      hotAt(beat(16), 1, 42),
      hotAt(beat(32), 2, 22),
      hotAt(beat(48), 3, 1),
      memAt(beat(16)),
      memAt(beat(32)),
      memAt(beat(48)),
      memAt(beat(64)),
    ]
    const out = cueChanges(existing, [beat(64)], [beat(64)], grid(200), [])
    expect(out.status === 'plan' && isEmptyChange(out.changes)).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/cueRules.test.ts`
Expected: FAIL, `cueChanges is not a function`.

- [ ] **Step 3: Implement**

Append to `src/shared/cueRules.ts`:

```ts
export const COLOR_BY_KIND: Record<CountdownKind, number> = { 16: 1, 32: 22, 48: 42, inicio: 32 }
export const HOT_KINDS = [1, 2, 3, 5, 6, 7, 8, 9]

export interface ExistingCue {
  id: string
  ms: number
  kind: number
  color: number | null
}

export interface CueChangeSet {
  insert: { ms: number; kind: number; color: number | null }[]
  update: { id: string; kind: number; color: number }[]
  remove: string[]
}

export interface DrawnHotCue {
  ms: number
  kind: number
  color: number
}

export type CueOutcome =
  | { status: 'plan'; changes: CueChangeSet; hot: DrawnHotCue[] }
  | { status: 'manual'; changes: CueChangeSet }
  | { status: 'too-many'; needed: number }

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

export function isEmptyChange(changes: CueChangeSet): boolean {
  return changes.insert.length === 0 && changes.update.length === 0 && changes.remove.length === 0
}

export function cueChanges(
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
  const changes: CueChangeSet = {
    insert: wantedDrops
      .filter((ms) => !memory.some((m) => near(m.ms, ms)))
      .map((ms) => ({ ms, kind: 0, color: null })),
    update: [],
    remove: currentDrops.filter((m) => !wantedDrops.some((d) => near(d, m.ms))).map((m) => m.id),
  }
  const plan = planCues(wantedDrops, beats, strong)
  const oldPlan = planCues(previousDrops, beats, strong)
  const fits = hot.every((h) => fitsPlan([h.ms], plan) || fitsPlan([h.ms], oldPlan))
  if (!fits) return { status: 'manual', changes }

  const wanted: PlannedCue[] = [
    ...plan,
    ...hot
      .filter((h) => h.ms < START_MS && plan.every((p) => !near(h.ms, p.ms)))
      .map((h) => ({ ms: h.ms, kind: 'inicio' as const })),
  ].sort((a, b) => a.ms - b.ms)
  if (wanted.length > MAX_HOT_CUES) return { status: 'too-many', needed: wanted.length }

  const used = new Set<string>()
  const drawn: DrawnHotCue[] = wanted.map((w, i) => {
    const kind = HOT_KINDS[i]
    const color = COLOR_BY_KIND[w.kind]
    const there = hot.find((h) => !used.has(h.id) && near(h.ms, w.ms))
    if (there) {
      used.add(there.id)
      if (there.kind !== kind || there.color !== color)
        changes.update.push({ id: there.id, kind, color })
    } else changes.insert.push({ ms: w.ms, kind, color })
    if (!memory.some((m) => near(m.ms, w.ms)) && !changes.insert.some((c) => c.kind === 0 && near(c.ms, w.ms)))
      changes.insert.push({ ms: w.ms, kind: 0, color: null })
    return { ms: there ? there.ms : w.ms, kind, color }
  })
  for (const h of hot) {
    if (used.has(h.id)) continue
    changes.remove.push(h.id)
    const pairedMemory = memory.find((m) => near(m.ms, h.ms) && !changes.remove.includes(m.id))
    if (pairedMemory) changes.remove.push(pairedMemory.id)
  }
  return { status: 'plan', changes, hot: drawn }
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/cueRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

One at a time, rerun and restore: drop `|| fitsPlan([h.ms], oldPlan)` (`'removes the countdown of a drop...'` must fail: it turns `manual`); drop the paired-memory removal (same test fails); change `> MAX_HOT_CUES` to `> MAX_HOT_CUES + 1` (`'refuses a plan that needs more than 8 hot cues'` fails).

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/shared/cueRules.ts apps/desktop/src/shared/cueRules.test.ts
git commit -m "Turn the drops a DJ marks into the cue rows to write, never over hand-placed hot cues"
```

---

### Task 3: PSSI phrases and the PWV5 waveform

**Files:**
- Create: `src/main/anlzFixture.ts` (test builders, shared by Tasks 3, 4, 9, 10)
- Modify: `src/main/anlz.ts` (append `phrases`, `colorWave`)
- Modify: `src/shared/types.ts` (`CueWaveColumn`)
- Test: `src/main/anlz.test.ts` (append)

**Interfaces:**
- Consumes: `anlzSections` (existing, USB export plan Task 4); `Phrase` (Task 1).
- Produces:
  - `shared/types.ts`: `interface CueWaveColumn { h: number; rgb: [number, number, number] | null }` (`h` 0..1; `rgb` 0..255, null for the monochrome preview)
  - `phrases(ext: Buffer): { mood: number; masked: boolean; entries: Phrase[] } | null`
  - `colorWave(ext: Buffer, columns?: number): CueWaveColumn[] | null` (default 1200 columns: height by maximum, colour of the tallest entry)
  - `anlzFixture.ts`: `anlzFile(...sections: Buffer[]): Buffer`, `pqtzSection(beatsMs: number[], bpm?: number): Buffer`, `pssiSection(mood: number, phrases: Phrase[], masked?: boolean): Buffer`, `pwavSection(heights: number[]): Buffer`, `pwv5Section(entries: { r: number; g: number; b: number; h: number }[]): Buffer`

Layouts (Deep Symmetry's ANLZ notes, confirmed by the spike's `anlz.cjs` on Vicent's files): `PSSI` header 32 bytes (`len_entry_bytes` 24 at 12, `len_entries` u16 at 16, `mood` u16 at 18), entries of 24 bytes with `beat` u16 at 2 and `kind` u16 at 4; when masked, every byte from 18 is XORed with `KEY[(x - 18) % 19] + len_entries` (medidas: the local copies are not masked, the USB ones are; both are read). `PWV5` header 24 bytes (`len_entry_bytes` 2 at 12, `len_entries` u32 at 16), entries u16 big-endian: red bits 15-13, green 12-10, blue 9-7, height 6-2.

- [ ] **Step 1: The fixture builders**

Create `src/main/anlzFixture.ts`:

```ts
import type { Phrase } from '../shared/cueRules'

const PSSI_KEY = [
  0xcb, 0xe1, 0xee, 0xfa, 0xe5, 0xee, 0xad, 0xee, 0xe9, 0xd2, 0xe9, 0xeb, 0xe1, 0xe9, 0xf3, 0xe8,
  0xe9, 0xf4, 0xe1,
]

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

function section(tag: string, headerRest: Buffer, body: Buffer): Buffer {
  const header = 12 + headerRest.length
  return Buffer.concat([
    Buffer.from(tag, 'latin1'),
    u32(header),
    u32(header + body.length),
    headerRest,
    body,
  ])
}

export function anlzFile(...sections: Buffer[]): Buffer {
  const head = Buffer.concat([
    Buffer.from('PMAI'),
    u32(28),
    u32(0),
    Buffer.from('00000001000100000001000000000000', 'hex'),
  ])
  const out = Buffer.concat([head, ...sections])
  out.writeUInt32BE(out.length, 8)
  return out
}

export function pqtzSection(beatsMs: number[], bpm = 145): Buffer {
  const body = Buffer.concat(
    beatsMs.map((ms, i) => {
      const e = Buffer.alloc(8)
      e.writeUInt16BE((i % 4) + 1, 0)
      e.writeUInt16BE(Math.round(bpm * 100), 2)
      e.writeUInt32BE(ms, 4)
      return e
    }),
  )
  return section('PQTZ', Buffer.concat([u32(0), u32(0x80000), u32(beatsMs.length)]), body)
}

export function pssiSection(mood: number, phrases: Phrase[], masked = false): Buffer {
  const headerRest = Buffer.concat([
    u32(24),
    u16(phrases.length),
    u16(mood),
    Buffer.alloc(6),
    u16(phrases.at(-1)?.beat ?? 0),
    Buffer.alloc(4),
  ])
  const body = Buffer.concat(
    phrases.map((p, i) => Buffer.concat([u16(i + 1), u16(p.beat), u16(p.kind), Buffer.alloc(18)])),
  )
  const out = section('PSSI', headerRest, body)
  if (masked)
    for (let x = 18; x < out.length; x++)
      out[x] ^= (PSSI_KEY[(x - 18) % 19] + phrases.length) & 0xff
  return out
}

export function pwavSection(heights: number[]): Buffer {
  return section(
    'PWAV',
    Buffer.concat([u32(heights.length), u32(0x10000)]),
    Buffer.from(heights.map((h) => h & 0x1f)),
  )
}

export function pwv5Section(entries: { r: number; g: number; b: number; h: number }[]): Buffer {
  const body = Buffer.concat(entries.map((e) => u16((e.r << 13) | (e.g << 10) | (e.b << 7) | (e.h << 2))))
  return section('PWV5', Buffer.concat([u32(2), u32(entries.length), u32(0x00960305)]), body)
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/main/anlz.test.ts` (merge `colorWave`, `phrases` into the import from `./anlz`, and import the builders from `./anlzFixture`):

```ts
describe('phrases', () => {
  const PHRASES = [
    { beat: 1, kind: 1 },
    { beat: 33, kind: 5 },
    { beat: 65, kind: 3 },
  ]

  // medidas: the local copies Surco reads are in the clear (mood 1 or 2 on Makina).
  it('reads mood and phrases from a local analysis', () => {
    expect(phrases(anlzFile(pssiSection(1, PHRASES)))).toEqual({
      mood: 1,
      masked: false,
      entries: PHRASES,
    })
  })

  // rekordbox masks PSSI on a USB; the strong parts must not depend on where it came from.
  it('unmasks a masked section', () => {
    expect(phrases(anlzFile(pssiSection(2, PHRASES, true)))).toEqual({
      mood: 2,
      masked: true,
      entries: PHRASES,
    })
  })

  it('is null without a PSSI', () => {
    expect(phrases(anlzFile())).toBeNull()
  })
})

describe('colorWave', () => {
  // What the section draws is rekordbox's own colour waveform, so it looks like the CDJ.
  it('keeps the tallest entry of each column with its colour', () => {
    const wave = colorWave(
      anlzFile(
        pwv5Section([
          { r: 7, g: 0, b: 0, h: 31 },
          { r: 0, g: 7, b: 0, h: 10 },
          { r: 0, g: 0, b: 7, h: 0 },
          { r: 0, g: 0, b: 7, h: 16 },
        ]),
      ),
      2,
    )
    expect(wave).toEqual([
      { h: 1, rgb: [255, 0, 0] },
      { h: 16 / 31, rgb: [0, 0, 255] },
    ])
  })

  it('is null without a PWV5', () => {
    expect(colorWave(anlzFile())).toBeNull()
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/anlz.test.ts`
Expected: FAIL, `phrases is not a function`.

- [ ] **Step 4: Implement**

Append to `src/shared/types.ts`:

```ts
export interface CueWaveColumn {
  h: number
  rgb: [number, number, number] | null
}
```

Append to `src/main/anlz.ts`:

```ts
const PSSI_KEY = [
  0xcb, 0xe1, 0xee, 0xfa, 0xe5, 0xee, 0xad, 0xee, 0xe9, 0xd2, 0xe9, 0xeb, 0xe1, 0xe9, 0xf3, 0xe8,
  0xe9, 0xf4, 0xe1,
]

export function phrases(
  ext: Buffer,
): { mood: number; masked: boolean; entries: Phrase[] } | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PSSI')
  if (!s) return null
  const t = Buffer.from(ext.subarray(s.start, s.start + s.length))
  const count = t.readUInt16BE(16)
  const moodRaw = t.readUInt16BE(18)
  const masked = !(moodRaw >= 1 && moodRaw <= 3)
  if (masked) for (let x = 18; x < t.length; x++) t[x] ^= (PSSI_KEY[(x - 18) % 19] + count) & 0xff
  const header = t.readUInt32BE(4)
  const entries: Phrase[] = []
  for (let i = 0; i < count; i++) {
    const at = header + i * 24
    if (at + 6 > t.length) break
    entries.push({ beat: t.readUInt16BE(at + 2), kind: t.readUInt16BE(at + 4) })
  }
  return { mood: t.readUInt16BE(18), masked, entries }
}

export function colorWave(ext: Buffer, columns = 1200): CueWaveColumn[] | null {
  const s = anlzSections(ext).find((x) => x.tag === 'PWV5')
  if (!s) return null
  const header = ext.readUInt32BE(s.start + 4)
  const count = Math.min(ext.readUInt32BE(s.start + 16), Math.floor((s.length - header) / 2))
  if (count <= 0) return null
  const width = Math.min(columns, count)
  const scale = (v: number): number => Math.round((v / 7) * 255)
  return Array.from({ length: width }, (_, i) => {
    const from = Math.floor((i * count) / width)
    const to = Math.max(from + 1, Math.floor(((i + 1) * count) / width))
    let best = -1
    let word = 0
    for (let e = from; e < to; e++) {
      const w = ext.readUInt16BE(s.start + header + e * 2)
      const h = (w >> 2) & 0x1f
      if (h > best) {
        best = h
        word = w
      }
    }
    return {
      h: best / 31,
      rgb: [scale((word >> 13) & 7), scale((word >> 10) & 7), scale((word >> 7) & 7)],
    }
  })
}
```

with `import type { Phrase } from '../shared/cueRules'` and `import type { CueWaveColumn } from '../shared/types'` at the top of `anlz.ts`. The USB export's functions are not touched.

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/anlz.test.ts`
Expected: PASS, the export's own `anlz` tests included.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/anlz.ts apps/desktop/src/main/anlz.test.ts apps/desktop/src/main/anlzFixture.ts apps/desktop/src/shared/types.ts
git commit -m "Read rekordbox's phrases and colour waveform from the analysis files"
```

---

### Task 4: Read a track's cues and analysis

**Files:**
- Modify: `src/main/rekordboxPlaylistsFixture.ts` (`djmdCue`, `contentCue`, `FixtureContent.AnalysisDataPath`, `PlaylistFixture.cues`)
- Modify: `src/shared/types.ts` (`TrackCueRow`, `TrackCues`)
- Create: `src/main/rekordboxCues.ts`
- Test: `src/main/rekordboxCues.test.ts`

**Interfaces:**
- Consumes: Task 3 `phrases`, `colorWave`, `anlzFixture`; `beatGrid`, `wavePreview` (`anlz.ts`); Task 1 `strongParts`; `rekordboxShareDir` (`rekordboxArtwork.ts`).
- Produces:
  - `shared/types.ts`: `interface TrackCueRow { id: string; ms: number; kind: number; color: number | null }`; `interface TrackCues { contentId: string; analysed: boolean; grid: { ms: number; beat: number }[]; strong: StrongPart[]; cues: TrackCueRow[]; wave: CueWaveColumn[] | null; durationMs: number; fingerprint: string }` (`StrongPart` re-exported type from `shared/cueRules`)
  - `rekordboxCues.ts`: `readTrackCues(db: Db, shareDir: string, contentId: string): TrackCues | null` (null when the entry is gone); `cueFingerprint(cues: TrackCueRow[]): string`; `liveCues(db: Db, contentId: string): TrackCueRow[]`
  - fixture: `FixtureContent.AnalysisDataPath?: string`, `PlaylistFixture.cues?: { ID: string; ContentID: string; InMsec: number; Kind: number; ColorTableIndex: number | null }[]` (the `contentCue` table is created empty)

`analysed` is true only with an `AnalysisDataPath`, its `.DAT` on disk and a non-empty `PQTZ`: a track plan A added has none until rekordbox analyses it (spec "Pista sin analizar"). The fingerprint is the sorted `ID|Kind|InMsec|ColorTableIndex` of every live cue (spec "La cola persistente").

- [ ] **Step 1: Extend the fixture**

In `src/main/rekordboxPlaylistsFixture.ts`: add `AnalysisDataPath?: string` to `FixtureContent`; add to `PlaylistFixture`:

```ts
  cues?: { ID: string; ContentID: string; InMsec: number; Kind: number; ColorTableIndex: number | null }[]
```

add these two tables to the `db.exec` template:

```sql
    CREATE TABLE djmdCue (ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), InMsec INTEGER,
      InFrame INTEGER, InMpegFrame INTEGER, InMpegAbs INTEGER, OutMsec INTEGER, OutFrame INTEGER,
      OutMpegFrame INTEGER, OutMpegAbs INTEGER, Kind INTEGER, Color INTEGER, ColorTableIndex INTEGER,
      ActiveLoop INTEGER, Comment VARCHAR(255), BeatLoopSize INTEGER, CueMicrosec INTEGER,
      InPointSeekInfo VARCHAR(255), OutPointSeekInfo VARCHAR(255), ContentUUID VARCHAR(255),
      ${LOOKUP_COLUMNS});
    CREATE TABLE contentCue (ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), Cues TEXT,
      rb_cue_count INTEGER, ${LOOKUP_COLUMNS});
```

write `AnalysisDataPath` in the content insert (add the column and `c.AnalysisDataPath ?? ''` to the statement and the `run` call, after `UUID`), and after the artists:

```ts
  const cue = db.prepare(
    `INSERT INTO djmdCue (ID, ContentID, InMsec, InFrame, Kind, Color, ColorTableIndex, OutMsec,
       ContentUUID, rb_local_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, -1, ?, -1, ?, 0, ?, ?)`,
  )
  for (const q of data.cues ?? [])
    cue.run(
      q.ID,
      q.ContentID,
      q.InMsec,
      Math.floor((q.InMsec * 150) / 1000),
      q.Kind,
      q.ColorTableIndex,
      `uuid-c-${q.ContentID}`,
      FIXTURE_STAMP,
      FIXTURE_STAMP,
    )
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/rekordboxCues.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anlzFile, pqtzSection, pssiSection, pwavSection, pwv5Section } from './anlzFixture'
import { openRekordboxDb } from './rekordboxDb'
import { cueFingerprint, readTrackCues } from './rekordboxCues'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const ANLZ = '/PIONEER/USBANLZ/219/e40e4/ANLZ0000.DAT'
const BEATS = Array.from({ length: 64 }, (_, i) => i * 500)

async function collection(over: { analysed?: boolean; ext?: Buffer | null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbcues-'))
  const path = join(dir, 'master.db')
  const content = ORGANISE_FIXTURE.content.map((c) =>
    c.ID === '103' ? { ...c, AnalysisDataPath: over.analysed === false ? '' : ANLZ } : c,
  )
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content,
    cues: [
      { ID: 'q2', ContentID: '103', InMsec: 8000, Kind: 1, ColorTableIndex: 1 },
      { ID: 'q1', ContentID: '103', InMsec: 8000, Kind: 0, ColorTableIndex: null },
      { ID: 'q3', ContentID: '103', InMsec: 16000, Kind: 0, ColorTableIndex: null },
    ],
  })
  const share = join(dir, 'share')
  mkdirSync(join(share, '/PIONEER/USBANLZ/219/e40e4'), { recursive: true })
  writeFileSync(join(share, ANLZ), anlzFile(pqtzSection(BEATS), pwavSection([31, 0, 16])))
  if (over.ext !== null)
    writeFileSync(
      join(share, ANLZ.replace('.DAT', '.EXT')),
      over.ext ??
        anlzFile(
          pssiSection(1, [
            { beat: 1, kind: 1 },
            { beat: 33, kind: 5 },
          ]),
          pwv5Section([{ r: 7, g: 7, b: 7, h: 31 }]),
        ),
    )
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  return { db, share }
}

describe('readTrackCues', () => {
  it('reads the grid, the strong parts, the cues and the colour waveform', async () => {
    const { db, share } = await collection()
    const read = readTrackCues(db, share, '103')
    expect(read).toMatchObject({
      contentId: '103',
      analysed: true,
      durationMs: 300000,
      strong: [{ start: BEATS[32], end: BEATS[63] }],
      wave: [{ h: 1, rgb: [255, 255, 255] }],
    })
    expect(read?.grid.slice(0, 5)).toEqual([
      { ms: 0, beat: 1 },
      { ms: 500, beat: 2 },
      { ms: 1000, beat: 3 },
      { ms: 1500, beat: 4 },
      { ms: 2000, beat: 1 },
    ])
    expect(read?.cues.map((c) => c.id).sort()).toEqual(['q1', 'q2', 'q3'])
    db.close()
  })

  // Decision 4: the colour waveform, or the monochrome preview without it.
  it('falls back to the preview waveform without an .EXT', async () => {
    const { db, share } = await collection({ ext: null })
    expect(readTrackCues(db, share, '103')?.wave?.[0]).toEqual({ h: 1, rgb: null })
    db.close()
  })

  // A track plan A added has no analysis until rekordbox opens: no grid, no marking.
  it('says a track rekordbox has not analysed yet', async () => {
    const { db, share } = await collection({ analysed: false })
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [], wave: null })
    db.close()
  })

  it('answers null for an entry that is gone', async () => {
    const { db, share } = await collection()
    expect(readTrackCues(db, share, '999')).toBeNull()
    db.close()
  })
})

describe('cueFingerprint', () => {
  // The conflict check: any cue rekordbox added, moved, recoloured or deleted changes it.
  it('changes with any cue and ignores their order', () => {
    const a = { id: 'q1', ms: 8000, kind: 0, color: null }
    const b = { id: 'q2', ms: 8000, kind: 1, color: 1 }
    expect(cueFingerprint([a, b])).toBe(cueFingerprint([b, a]))
    expect(cueFingerprint([a, { ...b, color: 22 }])).not.toBe(cueFingerprint([a, b]))
    expect(cueFingerprint([a])).not.toBe(cueFingerprint([a, b]))
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCues.test.ts`
Expected: FAIL, `Cannot find module './rekordboxCues'`.

- [ ] **Step 4: Implement**

Append to `src/shared/types.ts`:

```ts
export interface TrackCueRow {
  id: string
  ms: number
  kind: number
  color: number | null
}

export interface TrackCues {
  contentId: string
  analysed: boolean
  grid: { ms: number; beat: number }[]
  strong: { start: number; end: number }[]
  cues: TrackCueRow[]
  wave: CueWaveColumn[] | null
  durationMs: number
  fingerprint: string
}
```

Create `src/main/rekordboxCues.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import type Database from 'better-sqlite3-multiple-ciphers'
import { strongParts } from '../shared/cueRules'
import type { TrackCueRow, TrackCues } from '../shared/types'
import { beatGrid, colorWave, phrases, wavePreview } from './anlz'

type Db = InstanceType<typeof Database>

export function cueFingerprint(cues: TrackCueRow[]): string {
  return cues
    .map((c) => `${c.id}|${c.kind}|${c.ms}|${c.color ?? ''}`)
    .sort()
    .join(';')
}

export function liveCues(db: Db, contentId: string): TrackCueRow[] {
  return (
    db
      .prepare(
        `SELECT ID, InMsec, Kind, ColorTableIndex FROM djmdCue
          WHERE ContentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
      )
      .all(contentId) as { ID: string; InMsec: number; Kind: number; ColorTableIndex: number | null }[]
  ).map((r) => ({ id: String(r.ID), ms: r.InMsec, kind: r.Kind, color: r.ColorTableIndex }))
}

function read(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null
}

export function readTrackCues(db: Db, shareDir: string, contentId: string): TrackCues | null {
  const row = db
    .prepare(
      `SELECT AnalysisDataPath, Length FROM djmdContent
        WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(contentId) as { AnalysisDataPath: string | null; Length: number } | undefined
  if (!row) return null
  const cues = liveCues(db, contentId)
  const base = { contentId, cues, durationMs: row.Length * 1000, fingerprint: cueFingerprint(cues) }
  const dat = row.AnalysisDataPath ? read(`${shareDir}${row.AnalysisDataPath}`) : null
  const grid = dat ? beatGrid(dat).map((b) => ({ ms: b.ms, beat: b.beat })) : []
  if (!dat || grid.length === 0) return { ...base, analysed: false, grid: [], strong: [], wave: null }
  const ext = read(`${shareDir}${row.AnalysisDataPath?.replace(/\.DAT$/, '.EXT')}`)
  const sections = ext ? phrases(ext) : null
  const beatsMs = grid.map((b) => b.ms)
  const preview = wavePreview(dat, 400)
  return {
    ...base,
    analysed: true,
    grid,
    strong: sections ? strongParts(sections.mood, sections.entries, beatsMs) : [],
    wave:
      (ext ? colorWave(ext) : null) ??
      (preview ? preview.map((h) => ({ h, rgb: null })) : null),
  }
}
```

`rekordboxShareDir(collectionPath)` (from `rekordboxArtwork.ts`) is what Task 6's IPC passes as `shareDir`; the spike read the analysis with exactly that join (`share` + `AnalysisDataPath`).

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCues.test.ts src/main/rekordboxPlaylistWrite.test.ts src/main/rekordboxContentAdd.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/rekordboxCues.ts apps/desktop/src/main/rekordboxCues.test.ts apps/desktop/src/main/rekordboxPlaylistsFixture.ts apps/desktop/src/shared/types.ts
git commit -m "Read a rekordbox track's cues, grid, strong parts and waveform"
```

---

### Task 5: Write a change set

**Files:**
- Modify: `src/main/rekordboxCues.ts` (append `applyCueChanges`)
- Test: `src/main/rekordboxCues.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 `CueChangeSet`; `rekordboxStamp`, `takeLocalUsn`, `unusedRowId` (`rekordboxRows.ts`).
- Produces: `applyCueChanges(db: Db, contentId: string, changes: CueChangeSet, ctx: { now: Date; newCueId?: () => string }): number` (rows inserted, updated and deleted; 0 writes nothing). Runs inside the caller's transaction (Task 6's savepoint).

The rows follow the spike exactly (Global Constraints "Rows as the spike wrote"): what rekordbox opened without complaint on 18/10 and kept after closing.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/rekordboxCues.test.ts` (add `applyCueChanges` to the import, and `writeRekordboxPlaylistFixture`/`ORGANISE_FIXTURE` are already there):

```ts
describe('applyCueChanges', () => {
  const NOW = new Date('2026-10-18T19:00:00.000Z')
  const STAMP = '2026-10-18 19:00:00.000 +00:00'

  async function writable() {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbcuew-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      cues: [
        { ID: 'q2', ContentID: '103', InMsec: 8000, Kind: 1, ColorTableIndex: 1 },
        { ID: 'q1', ContentID: '103', InMsec: 8000, Kind: 0, ColorTableIndex: null },
        { ID: 'q3', ContentID: '103', InMsec: 16000, Kind: 0, ColorTableIndex: null },
        { ID: 'other', ContentID: '104', InMsec: 1000, Kind: 0, ColorTableIndex: null },
      ],
    })
    const db = openRekordboxDb(path)
    if (!db) throw new Error('did not open')
    return db
  }

  const changes = {
    insert: [
      { ms: 4000, kind: 2, color: 22 },
      { ms: 4000, kind: 0, color: null },
    ],
    update: [{ id: 'q2', kind: 3, color: 1 }],
    remove: ['q3'],
  }

  it('writes the cue rows the way the spike did and rekordbox accepted', async () => {
    const db = await writable()
    const ids = ['70001', '70002', '70003']
    expect(applyCueChanges(db, '103', changes, { now: NOW, newCueId: () => ids.shift() as string })).toBe(4)
    const row = (id: string) => db.prepare('SELECT * FROM djmdCue WHERE ID = ?').get(id) as Record<string, unknown>
    expect(row('70001')).toMatchObject({
      ContentID: '103',
      ContentUUID: 'uuid-c-103',
      InMsec: 4000,
      InFrame: 600,
      OutMsec: -1,
      OutFrame: 0,
      InMpegFrame: 0,
      Kind: 2,
      Color: -1,
      ColorTableIndex: 22,
      rb_local_usn: null,
      rb_local_deleted: 0,
      created_at: STAMP,
    })
    expect(row('70002')).toMatchObject({ Kind: 0, ColorTableIndex: null })
    expect(row('q2')).toMatchObject({ Kind: 3, ColorTableIndex: 1, updated_at: STAMP })
    expect(Number(row('q2').rb_local_usn)).toBeGreaterThan(500)
    expect(db.prepare(`SELECT ID FROM djmdCue WHERE ID = 'q3'`).get()).toBeUndefined()
    db.close()
  })

  // rekordbox reads djmdCue, but keeps contentCue in step; the spike kept it so and
  // rekordbox opened the result without a complaint.
  it('keeps contentCue and the track counters in step', async () => {
    const db = await writable()
    const ids = ['70001', '70002', '70003']
    applyCueChanges(db, '103', changes, { now: NOW, newCueId: () => ids.shift() as string })
    const cc = db.prepare(`SELECT * FROM contentCue WHERE ContentID = '103'`).get() as {
      ID: string
      Cues: string
      rb_cue_count: number
      rb_local_usn: number
    }
    expect(cc.ID).toBe('uuid-c-103')
    const entries = JSON.parse(cc.Cues) as { ID: string; Kind: number; updated_at: string }[]
    expect(entries.map((e) => e.ID).sort()).toEqual(['70001', '70002'])
    expect(cc.rb_cue_count).toBe(2)
    const content = db.prepare(`SELECT CueUpdated, rb_local_usn, updated_at FROM djmdContent WHERE ID = '103'`).get() as {
      CueUpdated: string
      rb_local_usn: number
      updated_at: string
    }
    expect(content.CueUpdated).toBe('4')
    expect(content.rb_local_usn).toBe(cc.rb_local_usn + 1)
    expect(content.updated_at).toBe(STAMP)
    db.close()
  })

  it('updates an existing contentCue entry and drops the removed one', async () => {
    const db = await writable()
    db.prepare(
      `INSERT INTO contentCue (ID, ContentID, Cues, rb_cue_count) VALUES ('uuid-c-103', '103', ?, 2)`,
    ).run(
      JSON.stringify([
        { ID: 'q2', Kind: 1, InMsec: 8000 },
        { ID: 'q3', Kind: 0, InMsec: 16000 },
      ]),
    )
    applyCueChanges(db, '103', { insert: [], update: [{ id: 'q2', kind: 3, color: 1 }], remove: ['q3'] }, { now: NOW })
    const cc = db.prepare(`SELECT Cues, rb_cue_count FROM contentCue WHERE ContentID = '103'`).get() as {
      Cues: string
      rb_cue_count: number
    }
    expect(JSON.parse(cc.Cues)).toEqual([
      { ID: 'q2', Kind: 3, InMsec: 8000, updated_at: '2026-10-18T19:00:00.000+00:00' },
    ])
    expect(cc.rb_cue_count).toBe(1)
    db.close()
  })

  it('never touches another track nor writes anything for an empty change', async () => {
    const db = await writable()
    expect(applyCueChanges(db, '103', { insert: [], update: [], remove: [] }, { now: NOW })).toBe(0)
    expect(db.prepare(`SELECT CueUpdated FROM djmdContent WHERE ID = '103'`).get()).toEqual({ CueUpdated: null })
    applyCueChanges(db, '103', changes, { now: NOW })
    expect(db.prepare(`SELECT ID FROM djmdCue WHERE ContentID = '104'`).all()).toEqual([{ ID: 'other' }])
    db.close()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCues.test.ts`
Expected: FAIL, `applyCueChanges is not a function`.

- [ ] **Step 3: Implement**

Append to `src/main/rekordboxCues.ts` (imports: `randomInt`, `randomUUID` from `node:crypto`; `type CueChangeSet` from `../shared/cueRules`; `rekordboxStamp`, `takeLocalUsn`, `unusedRowId` from `./rekordboxRows`):

```ts
const CUE_JSON_KEYS = [
  'ID',
  'ContentID',
  'ContentUUID',
  'InMsec',
  'InFrame',
  'InMpegFrame',
  'InMpegAbs',
  'OutMsec',
  'OutFrame',
  'OutMpegFrame',
  'OutMpegAbs',
  'Kind',
  'Color',
  'UUID',
  'created_at',
  'updated_at',
] as const

const randomCueId = (): string => String(randomInt(100, 2 ** 32))

export function applyCueChanges(
  db: Db,
  contentId: string,
  changes: CueChangeSet,
  ctx: { now: Date; newCueId?: () => string },
): number {
  const count = changes.insert.length + changes.update.length + changes.remove.length
  if (count === 0) return 0
  const stamp = rekordboxStamp(ctx.now)
  const iso = ctx.now.toISOString().replace('Z', '+00:00')
  const track = db
    .prepare('SELECT UUID, CueUpdated FROM djmdContent WHERE ID = ?')
    .get(contentId) as { UUID: string; CueUpdated: string | null }

  const inserted: Record<string, string | number | null>[] = []
  for (const c of changes.insert) {
    const row: Record<string, string | number | null> = {
      ID: unusedRowId(db, 'djmdCue', ctx.newCueId ?? randomCueId),
      ContentID: contentId,
      InMsec: c.ms,
      InFrame: Math.floor((c.ms * 150) / 1000),
      InMpegFrame: 0,
      InMpegAbs: 0,
      OutMsec: -1,
      OutFrame: 0,
      OutMpegFrame: 0,
      OutMpegAbs: 0,
      Kind: c.kind,
      Color: -1,
      ColorTableIndex: c.color,
      ContentUUID: track.UUID,
      UUID: randomUUID(),
      rb_data_status: 0,
      rb_local_data_status: 0,
      rb_local_deleted: 0,
      rb_local_synced: 0,
      usn: null,
      rb_local_usn: null,
      created_at: stamp,
      updated_at: stamp,
    }
    const names = Object.keys(row)
    db.prepare(
      `INSERT INTO djmdCue (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ).run(...Object.values(row))
    inserted.push(row)
  }
  const update = db.prepare(
    'UPDATE djmdCue SET Kind = ?, ColorTableIndex = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
  )
  for (const u of changes.update) update.run(u.kind, u.color, takeLocalUsn(db, stamp), stamp, u.id)
  const remove = db.prepare('DELETE FROM djmdCue WHERE ID = ?')
  for (const id of changes.remove) remove.run(id)

  const cc = db.prepare('SELECT ID, Cues FROM contentCue WHERE ContentID = ?').get(contentId) as
    | { ID: string; Cues: string | null }
    | undefined
  const gone = new Set(changes.remove)
  const entries = (cc?.Cues ? (JSON.parse(cc.Cues) as Record<string, unknown>[]) : []).filter(
    (e) => !gone.has(String(e.ID)),
  )
  for (const u of changes.update) {
    const e = entries.find((x) => String(x.ID) === u.id)
    if (e) {
      e.Kind = u.kind
      e.updated_at = iso
    }
  }
  for (const row of inserted)
    entries.push(
      Object.fromEntries(
        CUE_JSON_KEYS.map((k) => [k, k === 'created_at' || k === 'updated_at' ? iso : row[k]]),
      ),
    )
  const ccUsn = takeLocalUsn(db, stamp)
  if (cc)
    db.prepare(
      'UPDATE contentCue SET Cues = ?, rb_cue_count = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
    ).run(JSON.stringify(entries), entries.length, ccUsn, stamp, cc.ID)
  else
    db.prepare(
      `INSERT INTO contentCue (ID, ContentID, Cues, rb_cue_count, UUID, rb_data_status,
         rb_local_data_status, rb_local_deleted, rb_local_synced, usn, rb_local_usn, created_at,
         updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
    ).run(track.UUID, contentId, JSON.stringify(entries), entries.length, randomUUID(), ccUsn, stamp, stamp)
  db.prepare(
    'UPDATE djmdContent SET CueUpdated = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
  ).run(String(Number(track.CueUpdated ?? 0) + count), takeLocalUsn(db, stamp), stamp, contentId)
  return count
}
```

The fresh `contentCue` keeps only Surco's own entries, as the spike's did for a track without one; medidas found rekordbox reading `djmdCue` and opening a track whose `contentCue` lagged behind without trouble.

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCues.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/rekordboxCues.ts apps/desktop/src/main/rekordboxCues.test.ts
git commit -m "Write hot cues and drops into rekordbox as the validated spike did"
```

---

### Task 6: The `cues` operation in the queue, and its IPC

**Files:**
- Modify: `src/shared/types.ts` (`RekordboxQueueNotice`, `RekordboxQueuePart`, `SaveCuesRequest`)
- Modify: `src/main/rekordboxQueueOps.ts` (`CuesOp`, `QueueOp`, `opRank`)
- Modify: `src/main/rekordboxPlaylistWrite.ts` (`planOp`/`writeOp` gain the cues branch; `Planned.cues`)
- Modify: `src/main/rekordboxQueue.ts` (`keyOf`, the item key in `stateOf`)
- Create: `src/main/rekordboxCuesIpc.ts`
- Modify: `src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`
- Modify: `src/renderer/src/lib/rekordboxQueueText.ts`, `src/renderer/src/i18n/locales/*.json`
- Test: `src/main/rekordboxQueueCues.test.ts`, `src/main/rekordboxQueue.test.ts` (append), `src/main/rekordboxCuesIpc.test.ts`, `src/renderer/src/lib/rekordboxQueueText.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 `cueChanges`, `isEmptyChange`; Task 4 `readTrackCues`; Task 5 `applyCueChanges`; plan A `applyRekordboxBatch` internals (`Plan`, `Planned`, `planOp`, `writeOp`), `RekordboxQueue.enqueue`, `applyRekordboxQueueQuietly` (index), `withCollection`, `rekordboxShareDir`.
- Produces:
  - `shared/types.ts`: the notice union's first member becomes `{ code: 'ambiguous' | 'file-missing' | 'not-added' | 'cues-changed' | 'cues-too-many'; track: string }`; `RekordboxQueuePart` gains `{ kind: 'cues' }`; `interface SaveCuesRequest { contentId: string; path: string; label: string; drops: number[]; previousDrops: number[]; fingerprint: string }`
  - `rekordboxQueueOps.ts`: `interface CuesOp extends SaveCuesRequest { id: string; kind: 'cues' }`; `type QueueOp = EditOp | TrackOp | CuesOp`; `opRank` gives cues 4
  - `rekordboxCuesIpc.ts`: `registerRekordboxCuesIpc(host: { collection: () => string; queue: Pick<RekordboxQueue, 'enqueue'>; applyQuietly: () => void }): void` with `rekordbox:trackCues (contentId) → TrackCues | null` and `rekordbox:saveCues (req: SaveCuesRequest) → void`
  - `Api`: `rekordboxTrackCues(contentId: string): Promise<TrackCues | null>`, `saveRekordboxCues(req: SaveCuesRequest): Promise<void>`

At apply time the operation re-reads the track: gone, re-analysed without a grid, or a fingerprint that differs is `cues-changed` (rekordbox wins); `too-many` is `cues-too-many` and nothing is written; `manual` writes the drops only; an empty change set is applied with nothing to write. All of it is decided on the read-only probe, before rekordbox is asked to close.

- [ ] **Step 1: Locale strings**

Merge with the helper:

```json
{
  "es": { "rekordboxQueue": { "notice": { "cuesChanged": "Los cues de {{track}} cambiaron en rekordbox. Vuelve a marcarlos", "cuesTooMany": "{{track}} necesitaría más de 8 hot cues. Quita un drop" }, "part": { "cues": "cues" } } },
  "en": { "rekordboxQueue": { "notice": { "cuesChanged": "The cues of {{track}} changed in rekordbox. Mark them again", "cuesTooMany": "{{track}} would need more than 8 hot cues. Remove a drop" }, "part": { "cues": "cues" } } },
  "de": { "rekordboxQueue": { "notice": { "cuesChanged": "Die Cues von {{track}} haben sich in rekordbox geändert. Markiere sie erneut", "cuesTooMany": "{{track}} bräuchte mehr als 8 Hot Cues. Entferne einen Drop" }, "part": { "cues": "Cues" } } },
  "fr": { "rekordboxQueue": { "notice": { "cuesChanged": "Les cues de {{track}} ont changé dans rekordbox. Marquez-les à nouveau", "cuesTooMany": "{{track}} aurait besoin de plus de 8 hot cues. Retirez un drop" }, "part": { "cues": "cues" } } },
  "pt-BR": { "rekordboxQueue": { "notice": { "cuesChanged": "Os cues de {{track}} mudaram no rekordbox. Marque-os de novo", "cuesTooMany": "{{track}} precisaria de mais de 8 hot cues. Tire um drop" }, "part": { "cues": "cues" } } }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/rekordboxQueueCues.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { anlzFile, pqtzSection } from './anlzFixture'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, TWIN_PATHS, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import type { CuesOp } from './rekordboxQueueOps'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { cueFingerprint, liveCues } from './rekordboxCues'
import { applyRekordboxBatch } from './rekordboxPlaylistWrite'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const BEATS = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => BEATS[n * 4]

async function collection(cues: { ID: string; InMsec: number; Kind: number; ColorTableIndex: number | null }[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbqcues-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) => (c.ID === '103' ? { ...c, AnalysisDataPath: ANLZ } : c)),
    cues: cues.map((q) => ({ ...q, ContentID: '103' })),
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
  return path
}

function fingerprintOf(path: string): string {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return cueFingerprint(liveCues(db, '103'))
  } finally {
    db.close()
  }
}

function cuesOf(path: string) {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return liveCues(db, '103').sort((a, b) => a.ms - b.ms || a.kind - b.kind)
  } finally {
    db.close()
  }
}

const deps = () => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  now: () => new Date('2026-10-18T19:00:00.000Z'),
  ...TWIN_PATHS,
})

const op = (path: string, over: Partial<CuesOp> = {}): CuesOp => ({
  id: 'c',
  kind: 'cues',
  contentId: '103',
  path: '/Volumes/Public/Music/Gowan.wav',
  label: 'Gowan',
  drops: [bar(64)],
  previousDrops: [],
  fingerprint: fingerprintOf(path),
  ...over,
})

describe('cues operations', () => {
  // Flow 2 end to end on the writer: the drop and its countdown land in one batch.
  it('writes the drop and the countdown', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(path, [op(path)], deps())
    expect(result.ok && result.outcomes[0]).toEqual({ id: 'c', applied: true, notices: [] })
    expect(cuesOf(path).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(16), 0, null],
      [bar(16), 1, 42],
      [bar(32), 0, null],
      [bar(32), 2, 22],
      [bar(48), 0, null],
      [bar(48), 3, 1],
      [bar(64), 0, null],
    ])
  })

  // rekordbox wins: cues touched there since the section read them are left alone.
  it('drops the operation when rekordbox changed the cues meanwhile', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(path, [op(path, { fingerprint: 'stale' })], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: false, notices: [{ code: 'cues-changed', track: 'Gowan' }] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  it('writes nothing and says so when the plan needs more than 8 hot cues', async () => {
    const path = await collection([{ ID: 'y', InMsec: 500, Kind: 1, ColorTableIndex: 32 }])
    const drops = [bar(48), bar(96), bar(144), bar(192)]
    const result = await applyRekordboxBatch(path, [op(path, { drops })], deps())
    expect(result.ok && result.outcomes[0].notices).toEqual([{ code: 'cues-too-many', track: 'Gowan' }])
    expect(cuesOf(path)).toHaveLength(1)
  })

  // fits_plan: hand-placed hot cues stay; only the drop is written.
  it('writes only the drop on a track with hand-placed hot cues', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 }])
    await applyRekordboxBatch(path, [op(path)], deps())
    expect(cuesOf(path).map((c) => [c.ms, c.kind])).toEqual([
      [bar(40), 1],
      [bar(64), 0],
    ])
  })
})
```

Append to `src/main/rekordboxQueue.test.ts`:

```ts
describe('cues in the queue', () => {
  const cues = (id: string, drops: number[]): QueueOp => ({
    id,
    kind: 'cues',
    contentId: '103',
    path: '/m/a.wav',
    label: 'a',
    drops,
    previousDrops: [],
    fingerprint: 'f',
  })

  // Saving twice before rekordbox closes must leave the last marking, not both.
  it('keeps the latest cues of a track and shows them on the track line', () => {
    const q = createRekordboxQueue(deps())
    q.enqueue([track('t', '/m/a.wav', { contentId: '103' }), cues('c1', [1000])])
    q.enqueue([cues('c2', [2000])])
    expect(q.state()).toEqual({
      tracks: 1,
      changes: 0,
      items: [
        {
          key: 'track:/m/a.wav',
          label: 'a.wav',
          parts: [{ kind: 'playlists', names: ['Makina'] }, { kind: 'cues' }],
        },
      ],
    })
  })
})
```

Create `src/main/rekordboxCuesIpc.test.ts`:

```ts
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { registerRekordboxCuesIpc } from './rekordboxCuesIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerRekordboxCuesIpc', () => {
  // Spec: "Guardar en rekordbox" never asks; it queues and applies if rekordbox is closed.
  it('queues the cues and applies quietly', async () => {
    const enqueue = vi.fn()
    const applyQuietly = vi.fn()
    registerRekordboxCuesIpc({ collection: () => '/c/master.db', queue: { enqueue }, applyQuietly })
    const req = { contentId: '103', path: '/m/a.wav', label: 'a', drops: [1000], previousDrops: [], fingerprint: 'f' }
    await handler('rekordbox:saveCues')({}, req)
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ kind: 'cues', ...req })])
    expect(applyQuietly).toHaveBeenCalled()
  })

  it('reads nothing without a collection', () => {
    registerRekordboxCuesIpc({ collection: () => '', queue: { enqueue: vi.fn() }, applyQuietly: vi.fn() })
    expect(handler('rekordbox:trackCues')({}, '103')).toBeNull()
  })
})
```

Append to `src/renderer/src/lib/rekordboxQueueText.test.ts`:

```ts
  it('names the cue notices', () => {
    expect(appliedMessage(tr, { tracks: 0, changes: 0, notices: [{ code: 'cues-changed', track: 'Tengo' }] })?.text).toBe(
      'The cues of Tengo changed in rekordbox. Mark them again',
    )
    expect(partText(tr, { kind: 'cues' })).toBe('cues')
  })
```

(inside its existing `describe`).

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueueCues.test.ts src/main/rekordboxQueue.test.ts src/main/rekordboxCuesIpc.test.ts src/renderer/src/lib/rekordboxQueueText.test.ts`
Expected: FAIL, type errors on `kind: 'cues'`, missing module, missing locale keys.

- [ ] **Step 4: Types and the operation**

`src/shared/types.ts`: in `RekordboxQueueNotice` the first member becomes `{ code: 'ambiguous' | 'file-missing' | 'not-added' | 'cues-changed' | 'cues-too-many'; track: string }`; `RekordboxQueuePart` gains `| { kind: 'cues' }`; append:

```ts
export interface SaveCuesRequest {
  contentId: string
  path: string
  label: string
  drops: number[]
  previousDrops: number[]
  fingerprint: string
}
```

`src/main/rekordboxQueueOps.ts` (import `type SaveCuesRequest`):

```ts
export interface CuesOp extends SaveCuesRequest {
  id: string
  kind: 'cues'
}

export type QueueOp = EditOp | TrackOp | CuesOp

export function opRank(op: QueueOp): number {
  if (op.kind === 'track') return 0
  if (op.kind === 'cues') return 4
  return EDIT_RANK[op.edit.kind]
}
```

`src/main/rekordboxQueue.ts`: `keyOf` gains `if (op.kind === 'cues') return `cues:${op.contentId}``; in `stateOf`, the loop over `q.ops` becomes:

```ts
  for (const op of q.ops) {
    if (op.kind === 'edit') {
      item(keyOf(op), op.label ?? '').parts.push({ kind: 'tree', edit: op.edit.kind })
      continue
    }
    const it = item(`track:${op.path}`, op.label)
    if (op.kind === 'cues') {
      it.parts.push({ kind: 'cues' })
      continue
    }
    it.label = op.label
    if (!op.contentId) it.parts.push({ kind: 'collection' })
    it.parts.push({ kind: 'playlists', names: op.wanted.map((t) => t.name) })
  }
```

`src/main/rekordboxPlaylistWrite.ts`: import `cueChanges`, `isEmptyChange`, `type CueChangeSet` from `../shared/cueRules`, `applyCueChanges`, `readTrackCues` from `./rekordboxCues`, `rekordboxShareDir` from `./rekordboxArtwork`, `type CuesOp` from `./rekordboxQueueOps`. `Planned` gains `cues?: CueChangeSet`. Add:

```ts
function planCuesOp(probe: Db, op: CuesOp, shareDir: string): Plan {
  const changed = (code: 'cues-changed' | 'cues-too-many'): Plan => ({
    outcome: { id: op.id, applied: false, notices: [{ code, track: op.label }] },
  })
  const read = readTrackCues(probe, shareDir, op.contentId)
  if (!read || !read.analysed || read.fingerprint !== op.fingerprint) return changed('cues-changed')
  const out = cueChanges(
    read.cues,
    op.drops,
    op.previousDrops,
    read.grid.map((b) => b.ms),
    read.strong,
  )
  if (out.status === 'too-many') return changed('cues-too-many')
  if (isEmptyChange(out.changes)) return { outcome: { id: op.id, applied: true, notices: [] } }
  return { op, cues: out.changes }
}
```

`planOp` takes the share folder and dispatches the three kinds:

```ts
function planOp(
  probe: Db,
  xml: string | null,
  op: QueueOp,
  find: FindOptions,
  shareDir: string,
): Plan {
  if (op.kind === 'track') return planTrack(probe, xml, op, find)
  if (op.kind === 'cues') return planCuesOp(probe, op, shareDir)
  return planEdit(probe, xml, op, find)
}
```

and its one call in `applyRekordboxBatch` passes `rekordboxShareDir(collectionPath)`. `writeOp`:

```ts
function writeOp(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  if (planned.op.kind === 'track') return writeTrack(db, draft, planned, now)
  if (planned.op.kind === 'cues') {
    applyCueChanges(db, planned.op.contentId, planned.cues as CueChangeSet, { now })
    return { id: planned.op.id, applied: true, notices: [] }
  }
  return writeEdit(db, draft, planned, now)
}
```

`needsNode` stays: a cues operation adds no node. `writeEdit`'s `planned.op as EditOp` cast is unchanged.

- [ ] **Step 5: IPC and wiring**

Create `src/main/rekordboxCuesIpc.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { SaveCuesRequest } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readTrackCues } from './rekordboxCues'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { RekordboxQueue } from './rekordboxQueue'

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'enqueue'>
  applyQuietly: () => void
}): void {
  ipcMain.handle('rekordbox:trackCues', (_e, contentId: string) => {
    const path = host.collection()
    return withCollection(path, (db) => readTrackCues(db, rekordboxShareDir(path), contentId), null)
  })
  ipcMain.handle('rekordbox:saveCues', (_e, req: SaveCuesRequest) => {
    host.queue.enqueue([{ ...req, id: randomUUID(), kind: 'cues' }])
    host.applyQuietly()
  })
}
```

`src/main/index.ts`, after `registerRekordboxQueueIpc(...)`:

```ts
  registerRekordboxCuesIpc({
    collection: rekordboxCollectionPath,
    queue: rekordboxQueue,
    applyQuietly: applyRekordboxQueueQuietly,
  })
```

`src/preload/api.ts`: `rekordboxTrackCues: (contentId: string) => Promise<TrackCues | null>` and `saveRekordboxCues: (req: SaveCuesRequest) => Promise<void>`; `src/preload/index.ts`: `rekordboxTrackCues: (contentId: string) => ipcRenderer.invoke('rekordbox:trackCues', contentId)`, `saveRekordboxCues: (req: SaveCuesRequest) => ipcRenderer.invoke('rekordbox:saveCues', req)`; `src/renderer/src/test/api.ts` and `src/scenarios/harness.tsx`: `rekordboxTrackCues: async () => null`, `saveRekordboxCues: async () => {}`.

`src/renderer/src/lib/rekordboxQueueText.ts`, in `NOTICE_KEY`:

```ts
  'cues-changed': 'rekordboxQueue.notice.cuesChanged',
  'cues-too-many': 'rekordboxQueue.notice.cuesTooMany',
```

(`partText` already reads `rekordboxQueue.part.${part.kind}` for the plain kinds, so `cues` needs no code.)

- [ ] **Step 6: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueueCues.test.ts src/main/rekordboxQueue.test.ts src/main/rekordboxCuesIpc.test.ts src/main/rekordboxPlaylistWrite.test.ts src/main/rekordboxQueueTrack.test.ts src/renderer/src/lib/rekordboxQueueText.test.ts src/renderer/src/i18n`
Expected: PASS.

- [ ] **Step 7: Mutation check**

Replace `read.fingerprint !== op.fingerprint` with `false` and rerun `rekordboxQueueCues.test.ts`: `'drops the operation when rekordbox changed the cues meanwhile'` must fail. Restore.

- [ ] **Step 8: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxQueueOps.ts apps/desktop/src/main/rekordboxPlaylistWrite.ts apps/desktop/src/main/rekordboxQueue.ts apps/desktop/src/main/rekordboxQueue.test.ts apps/desktop/src/main/rekordboxQueueCues.test.ts apps/desktop/src/main/rekordboxCuesIpc.ts apps/desktop/src/main/rekordboxCuesIpc.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/scenarios/harness.tsx apps/desktop/src/renderer/src/lib/rekordboxQueueText.ts apps/desktop/src/renderer/src/lib/rekordboxQueueText.test.ts apps/desktop/src/renderer/src/i18n/locales
git commit -m "Queue a track's cues for rekordbox, dropping them if rekordbox changed the cues meanwhile"
```

---

### Task 7: The waveform with grid and cues

**Files:**
- Create: `src/renderer/src/lib/cueWave.ts`
- Create: `src/renderer/src/components/CueWave.tsx`
- Test: `src/renderer/src/lib/cueWave.test.ts`, `src/renderer/src/components/CueWave.test.tsx`

**Interfaces:**
- Consumes: Task 1 `nearestBeat`, `SAME_POSITION_MS`; Task 3 `CueWaveColumn`; Task 2 `DrawnHotCue`.
- Produces:
  - `lib/cueWave.ts`: `CUE_COLOR: Record<number, string>` (1, 22, 42, 32 to CSS colours), `HOT_LETTER: Record<number, string>` (1..9 without 4 to A..H), `barLines(grid: { ms: number; beat: number }[]): { ms: number; strong: boolean }[]` (one per downbeat, `strong` every 16 bars from the first), `clickAction(ms: number, beatsMs: number[], drops: number[], toleranceMs: number): { kind: 'add' | 'remove'; ms: number }`
  - `CueWave({ wave, grid, durationMs, hot, drops, disabled, onAddDrop, onRemoveDrop }: { wave: CueWaveColumn[] | null; grid: { ms: number; beat: number }[]; durationMs: number; hot: (DrawnHotCue & { pending: boolean })[]; drops: { ms: number; pending: boolean }[]; disabled?: boolean; onAddDrop: (ms: number) => void; onRemoveDrop: (ms: number) => void })`
  - test ids `cue-wave`, `cue-wave-hot-<letter>`, `cue-wave-drop-<ms>`, `cue-wave-ghost`, `cue-wave-bar` (`data-strong`)

Spec "Qué se ve": rekordbox's waveform; a mark every bar and a stronger one every 16; hot cues with their letter and colour; existing drops as white lines with "DROP"; a click on the wave adds a drop on the nearest beat, a click on a drop removes it; the hover ghost "+ drop" says where it will land; unsaved cues drawn faint. Colours are rekordbox's own (not Surco's accent): the DJ reads them as he will on the CDJ. The CSS values approximate rekordbox's palette entries 1, 22, 42 and 32; Task 11 has Vicent compare them.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/cueWave.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { barLines, clickAction } from './cueWave'

const GRID = Array.from({ length: 160 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const BEATS = GRID.map((b) => b.ms)

describe('barLines', () => {
  // A mark per bar and a stronger one every 16: the DJ counts phrases of 16 bars.
  it('marks every bar and every 16th strongly', () => {
    const lines = barLines(GRID)
    expect(lines).toHaveLength(40)
    expect(lines[0]).toEqual({ ms: 0, strong: true })
    expect(lines[1]).toEqual({ ms: 2000, strong: false })
    expect(lines[16]).toEqual({ ms: 32000, strong: true })
  })
})

describe('clickAction', () => {
  it('adds a drop on the nearest beat', () => {
    expect(clickAction(1240, BEATS, [], 100)).toEqual({ kind: 'add', ms: 1000 })
  })

  // A click on a drop takes it away instead of adding a second one beside it.
  it('removes the drop under the click', () => {
    expect(clickAction(10040, BEATS, [10000], 100)).toEqual({ kind: 'remove', ms: 10000 })
  })

  it('snaps a click before the grid to its first beat', () => {
    const late = BEATS.map((ms) => ms + 300)
    expect(clickAction(10, late, [], 100)).toEqual({ kind: 'add', ms: 300 })
  })
})
```

Create `src/renderer/src/components/CueWave.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { CueWave } from './CueWave'

afterEach(cleanup)

const GRID = Array.from({ length: 160 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 80,
    right: 800,
    bottom: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(over: Partial<React.ComponentProps<typeof CueWave>> = {}) {
  const onAddDrop = vi.fn()
  const onRemoveDrop = vi.fn()
  render(
    <CueWave
      wave={[{ h: 1, rgb: [255, 0, 0] }]}
      grid={GRID}
      durationMs={80000}
      hot={[{ ms: 16000, kind: 1, color: 42, pending: false }]}
      drops={[{ ms: 40000, pending: true }]}
      onAddDrop={onAddDrop}
      onRemoveDrop={onRemoveDrop}
      {...over}
    />,
  )
  return { onAddDrop, onRemoveDrop }
}

describe('CueWave', () => {
  it('draws hot cues with their letter and drops with DROP', () => {
    setup()
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveTextContent('A')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveTextContent('DROP')
    expect(screen.getByTestId('cue-wave-drop-40000')).toHaveAttribute('data-pending', 'true')
    expect(screen.getAllByTestId('cue-wave-bar').filter((b) => b.dataset.strong === 'true')).toHaveLength(3)
  })

  // 100 px of 800 is 10 s of 80 s: the click lands on the beat at 10000 ms.
  it('adds a drop on the beat under the click', () => {
    const { onAddDrop } = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(onAddDrop).toHaveBeenCalledWith(10000)
  })

  it('removes the drop under the click', () => {
    const { onRemoveDrop, onAddDrop } = setup()
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 400, clientY: 40 })
    expect(onRemoveDrop).toHaveBeenCalledWith(40000)
    expect(onAddDrop).not.toHaveBeenCalled()
  })

  it('shows where the drop will land while hovering', () => {
    setup()
    fireEvent.mouseMove(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(screen.getByTestId('cue-wave-ghost')).toHaveTextContent('+ drop')
  })

  it('takes no clicks when disabled', () => {
    const { onAddDrop } = setup({ disabled: true })
    fireEvent.click(screen.getByTestId('cue-wave'), { clientX: 100, clientY: 40 })
    expect(onAddDrop).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/cueWave.test.ts src/renderer/src/components/CueWave.test.tsx`
Expected: FAIL, missing modules.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/cueWave.ts`:

```ts
import { nearestBeat } from '../../../shared/cueRules'

export const CUE_COLOR: Record<number, string> = {
  1: '#305aff',
  22: '#10b24f',
  42: '#e8243c',
  32: '#f2c40c',
}

export const HOT_LETTER: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  5: 'D',
  6: 'E',
  7: 'F',
  8: 'G',
  9: 'H',
}

export function barLines(grid: { ms: number; beat: number }[]): { ms: number; strong: boolean }[] {
  const downbeats = grid.filter((b) => b.beat === 1)
  return downbeats.map((b, i) => ({ ms: b.ms, strong: i % 16 === 0 }))
}

export function clickAction(
  ms: number,
  beatsMs: number[],
  drops: number[],
  toleranceMs: number,
): { kind: 'add' | 'remove'; ms: number } {
  const hit = drops.find((d) => Math.abs(d - ms) <= toleranceMs)
  if (hit !== undefined) return { kind: 'remove', ms: hit }
  return { kind: 'add', ms: beatsMs[nearestBeat(beatsMs, ms)] }
}
```

Create `src/renderer/src/components/CueWave.tsx`:

```tsx
import type React from 'react'
import { useState } from 'react'
import type { DrawnHotCue } from '../../../shared/cueRules'
import type { CueWaveColumn } from '../../../shared/types'
import { barLines, CUE_COLOR, clickAction, HOT_LETTER } from '../lib/cueWave'

const HIT_PX = 6

export function CueWave({
  wave,
  grid,
  durationMs,
  hot,
  drops,
  disabled,
  onAddDrop,
  onRemoveDrop,
}: {
  wave: CueWaveColumn[] | null
  grid: { ms: number; beat: number }[]
  durationMs: number
  hot: (DrawnHotCue & { pending: boolean })[]
  drops: { ms: number; pending: boolean }[]
  disabled?: boolean
  onAddDrop: (ms: number) => void
  onRemoveDrop: (ms: number) => void
}): React.JSX.Element {
  const [ghost, setGhost] = useState<number | null>(null)
  const beatsMs = grid.map((b) => b.ms)
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width)
    const ms = (x / Math.max(rect.width, 1)) * durationMs
    const tolerance = (HIT_PX / Math.max(rect.width, 1)) * durationMs
    return clickAction(
      ms,
      beatsMs,
      drops.map((d) => d.ms),
      tolerance,
    )
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: marking a drop is a pointer gesture on the waveform; the section's buttons are the keyboard path
    // biome-ignore lint/a11y/noStaticElementInteractions: same as above
    <div
      data-testid="cue-wave"
      onClick={(e) => {
        if (disabled || beatsMs.length === 0) return
        const action = at(e)
        if (action.kind === 'remove') onRemoveDrop(action.ms)
        else onAddDrop(action.ms)
      }}
      onMouseMove={(e) => {
        if (disabled || beatsMs.length === 0) return
        const action = at(e)
        setGhost(action.kind === 'add' ? action.ms : null)
      }}
      onMouseLeave={() => setGhost(null)}
      className={`relative h-20 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        disabled ? 'cursor-default' : 'cursor-crosshair'
      }`}
    >
      {wave && (
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
      )}
      {barLines(grid).map((b) => (
        <span
          key={b.ms}
          data-testid="cue-wave-bar"
          data-strong={b.strong ? 'true' : 'false'}
          aria-hidden="true"
          style={{ left: pct(b.ms) }}
          className={`absolute top-0 bottom-0 w-px ${
            b.strong ? 'bg-[var(--color-fg)]/40' : 'bg-[var(--color-fg)]/10'
          }`}
        />
      ))}
      {drops.map((d) => (
        <span
          key={`d${d.ms}`}
          data-testid={`cue-wave-drop-${d.ms}`}
          data-pending={d.pending ? 'true' : undefined}
          style={{ left: pct(d.ms) }}
          className={`absolute top-0 bottom-0 w-0.5 bg-white ${d.pending ? 'opacity-60' : ''}`}
        >
          <span className="absolute top-0 left-1 text-[9px] font-semibold text-white">DROP</span>
        </span>
      ))}
      {hot.map((h) => (
        <span
          key={`h${h.kind}`}
          data-testid={`cue-wave-hot-${HOT_LETTER[h.kind]}`}
          data-pending={h.pending ? 'true' : undefined}
          style={{ left: pct(h.ms), backgroundColor: CUE_COLOR[h.color] }}
          className={`absolute top-0 bottom-0 w-0.5 ${h.pending ? 'opacity-50' : ''}`}
        >
          <span
            style={{ backgroundColor: CUE_COLOR[h.color] }}
            className="absolute bottom-0 left-0 rounded-sm px-1 text-[9px] font-bold text-black"
          >
            {HOT_LETTER[h.kind]}
          </span>
        </span>
      ))}
      {ghost !== null && (
        <span
          data-testid="cue-wave-ghost"
          style={{ left: pct(ghost) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-white/70"
        >
          <span className="absolute top-3 left-1 text-[9px] text-white/80">+ drop</span>
        </span>
      )}
    </div>
  )
}
```

The two `biome-ignore` lines are directives, not comments: biome needs them and the repo already uses them the same way (`FieldsEditor.tsx`, `LayoutTab.tsx`). Their reasons are required text.

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/cueWave.test.ts src/renderer/src/components/CueWave.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/renderer/src/lib/cueWave.ts apps/desktop/src/renderer/src/lib/cueWave.test.ts apps/desktop/src/renderer/src/components/CueWave.tsx apps/desktop/src/renderer/src/components/CueWave.test.tsx
git commit -m "Draw rekordbox's waveform with its grid and cues, and mark drops on the nearest beat"
```

---

### Task 8: The Cues section

**Files:**
- Modify: `src/shared/editorSections.ts` (`cues` section, after `quality`, open by default, group `metadata`)
- Create: `src/renderer/src/hooks/useTrackCues.ts`
- Create: `src/renderer/src/components/CuesSection.tsx`
- Modify: `src/renderer/src/components/Editor.tsx` (`rekordboxCue` prop, the `cues` case, `singleTrackOnly` id type)
- Modify: `src/renderer/src/App.tsx` (passes the open row's rekordbox entry)
- Modify: `src/renderer/src/hooks/useRekordboxQueue.ts` (re-reads `['rekordbox-track-cues']` too)
- Modify: `src/renderer/src/i18n/locales/*.json` (`editor.cues.*`, `settings.sections.cues`)
- Test: `src/shared/editorSections.test.ts`, `src/renderer/src/components/CuesSection.test.tsx`

**Interfaces:**
- Consumes: Task 2 `cueChanges`, `findDrops`; Task 6 `window.api.rekordboxTrackCues`, `saveRekordboxCues`, `SaveCuesRequest`; Task 7 `CueWave`, `CUE_COLOR`; `SectionHeader` (`help`), `SectionBody`.
- Produces:
  - `useTrackCues(contentId: string | undefined): { data: TrackCues | null | undefined; isError: boolean }` (query `['rekordbox-track-cues', contentId]`)
  - `CuesSection({ cue, open, onToggle }: { cue: { contentId: string; path: string; label: string }; open: boolean; onToggle: () => void })`
  - `Editor` prop `rekordboxCue?: { contentId: string; path: string; label: string }`
  - test ids `cues-section`, `cues-unanalysed`, `cues-manual`, `cues-too-many`, `cues-undo`, `cues-save`, `cues-legend`

Spec "Qué se ve" and Decision 9: a section, not a tab, shown only for a track of an open rekordbox playlist; help once in the header (i); legend blue 16, green 32, red 48, yellow start; Deshacer back to what rekordbox says; Guardar en rekordbox queues; the manual hot cues line; "rekordbox aún no ha analizado esta pista" with no marking. Each change redraws the countdown at once with the shared rules, faint while unsaved.

- [ ] **Step 1: Locale strings**

Merge with the helper:

```json
{
  "es": {
    "settings": { "sections": { "cues": "Cues" } },
    "editor": { "cues": {
      "title": "Cues",
      "help": "Haz clic en la onda para marcar un drop. Surco pone la cuenta atrás a 16, 32 y 48 compases sobre la rejilla de rekordbox.",
      "unanalysed": "rekordbox aún no ha analizado esta pista",
      "manual": "Esta pista tiene hot cues puestos a mano. Surco guarda los drops y no toca los hot cues.",
      "tooMany": "Necesitaría más de 8 hot cues. Quita un drop.",
      "undo": "Deshacer",
      "save": "Guardar en rekordbox",
      "legend16": "16 compases", "legend32": "32 compases", "legend48": "48 compases", "legendStart": "Inicio",
      "unreadable": "No se pudieron leer los cues de rekordbox"
    } }
  },
  "en": {
    "settings": { "sections": { "cues": "Cues" } },
    "editor": { "cues": {
      "title": "Cues",
      "help": "Click the waveform to mark a drop. Surco sets the countdown at 16, 32 and 48 bars on rekordbox's grid.",
      "unanalysed": "rekordbox has not analysed this track yet",
      "manual": "This track has hot cues set by hand. Surco saves the drops and leaves the hot cues alone.",
      "tooMany": "It would need more than 8 hot cues. Remove a drop.",
      "undo": "Undo",
      "save": "Save to rekordbox",
      "legend16": "16 bars", "legend32": "32 bars", "legend48": "48 bars", "legendStart": "Start",
      "unreadable": "Could not read the cues from rekordbox"
    } }
  },
  "de": {
    "settings": { "sections": { "cues": "Cues" } },
    "editor": { "cues": {
      "title": "Cues",
      "help": "Klicke in die Wellenform, um einen Drop zu markieren. Surco setzt den Countdown bei 16, 32 und 48 Takten auf das Raster von rekordbox.",
      "unanalysed": "rekordbox hat diesen Titel noch nicht analysiert",
      "manual": "Dieser Titel hat von Hand gesetzte Hot Cues. Surco speichert die Drops und lässt die Hot Cues unverändert.",
      "tooMany": "Es wären mehr als 8 Hot Cues nötig. Entferne einen Drop.",
      "undo": "Rückgängig",
      "save": "In rekordbox speichern",
      "legend16": "16 Takte", "legend32": "32 Takte", "legend48": "48 Takte", "legendStart": "Start",
      "unreadable": "Die Cues aus rekordbox konnten nicht gelesen werden"
    } }
  },
  "fr": {
    "settings": { "sections": { "cues": "Cues" } },
    "editor": { "cues": {
      "title": "Cues",
      "help": "Cliquez sur la forme d’onde pour marquer un drop. Surco place le compte à rebours à 16, 32 et 48 mesures sur la grille de rekordbox.",
      "unanalysed": "rekordbox n’a pas encore analysé ce morceau",
      "manual": "Ce morceau a des hot cues placés à la main. Surco enregistre les drops et ne touche pas aux hot cues.",
      "tooMany": "Il faudrait plus de 8 hot cues. Retirez un drop.",
      "undo": "Annuler",
      "save": "Enregistrer dans rekordbox",
      "legend16": "16 mesures", "legend32": "32 mesures", "legend48": "48 mesures", "legendStart": "Début",
      "unreadable": "Impossible de lire les cues de rekordbox"
    } }
  },
  "pt-BR": {
    "settings": { "sections": { "cues": "Cues" } },
    "editor": { "cues": {
      "title": "Cues",
      "help": "Clique na forma de onda para marcar um drop. O Surco põe a contagem regressiva a 16, 32 e 48 compassos na grade do rekordbox.",
      "unanalysed": "O rekordbox ainda não analisou esta faixa",
      "manual": "Esta faixa tem hot cues postos à mão. O Surco salva os drops e não mexe nos hot cues.",
      "tooMany": "Precisaria de mais de 8 hot cues. Tire um drop.",
      "undo": "Desfazer",
      "save": "Salvar no rekordbox",
      "legend16": "16 compassos", "legend32": "32 compassos", "legend48": "48 compassos", "legendStart": "Início",
      "unreadable": "Não foi possível ler os cues do rekordbox"
    } }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/shared/editorSections.test.ts`:

```ts
// An install upgraded from before the section gets it right after Quality, open.
it('inserts the Cues section after Quality in an older stored order', () => {
  const stored = DEFAULT_EDITOR_SECTIONS.filter((s) => s.id !== 'cues')
  const ids = normalizeEditorSections(stored).map((s) => s.id)
  expect(ids.indexOf('cues')).toBe(ids.indexOf('quality') + 1)
})
```

Create `src/renderer/src/components/CuesSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { TrackCues } from '../../../shared/types'
import '../i18n'
import { installApi } from '../test/api'
import { CuesSection } from './CuesSection'

afterEach(cleanup)

const GRID = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const bar = (n: number) => n * 2000
const READ: TrackCues = {
  contentId: '103',
  analysed: true,
  grid: GRID,
  strong: [],
  cues: [],
  wave: null,
  durationMs: 400000,
  fingerprint: 'f0',
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 400, height: 80, right: 400, bottom: 80, x: 0, y: 0, toJSON: () => ({}),
  })
})

function setup(read: TrackCues = READ) {
  const saveRekordboxCues = vi.fn<Api['saveRekordboxCues']>(async () => {})
  installApi({ rekordboxTrackCues: vi.fn<Api['rekordboxTrackCues']>(async () => read), saveRekordboxCues })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CuesSection cue={{ contentId: '103', path: '/m/g.wav', label: 'Gowan' }} open onToggle={vi.fn()} />
    </QueryClientProvider>,
  )
  return { saveRekordboxCues }
}

const clickAt = (ms: number) =>
  fireEvent.click(screen.getByTestId('cue-wave'), { clientX: (ms / 400000) * 400, clientY: 40 })

describe('CuesSection', () => {
  // Flow 2: one click on the drop draws its countdown at once, faint until saved.
  it('draws the countdown live after marking a drop', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    expect(screen.getByTestId('cue-wave-hot-A')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('cue-wave-hot-C')).toBeInTheDocument()
    expect(screen.getByTestId(`cue-wave-drop-${bar(64)}`)).toBeInTheDocument()
  })

  it('saves the drops with the fingerprint it read', async () => {
    const { saveRekordboxCues } = setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    expect(screen.getByTestId('cues-save')).toBeDisabled()
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-save'))
    expect(saveRekordboxCues).toHaveBeenCalledWith({
      contentId: '103',
      path: '/m/g.wav',
      label: 'Gowan',
      drops: [bar(64)],
      previousDrops: [],
      fingerprint: 'f0',
    })
  })

  it('goes back to what rekordbox says with Undo', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    fireEvent.click(screen.getByTestId('cues-undo'))
    expect(screen.queryByTestId(`cue-wave-drop-${bar(64)}`)).toBeNull()
    expect(screen.getByTestId('cues-save')).toBeDisabled()
  })

  it('says hand-placed hot cues stay as they are', async () => {
    setup({ ...READ, cues: [{ id: 'm', ms: bar(40), kind: 1, color: 1 }] })
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    clickAt(bar(64))
    expect(screen.getByTestId('cues-manual')).toBeInTheDocument()
  })

  it('offers no marking on a track rekordbox has not analysed', async () => {
    setup({ ...READ, analysed: false, grid: [] })
    await waitFor(() => expect(screen.getByTestId('cues-unanalysed')).toBeInTheDocument())
    expect(screen.queryByTestId('cue-wave')).toBeNull()
  })

  it('shows the legend', async () => {
    setup()
    await waitFor(() => expect(screen.getByTestId('cues-legend')).toHaveTextContent('16 bars'))
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/editorSections.test.ts src/renderer/src/components/CuesSection.test.tsx`
Expected: FAIL, unknown section id and missing module.

- [ ] **Step 4: The section id**

In `src/shared/editorSections.ts`: add `'cues'` to `EDITOR_SECTION_IDS` after `'quality'`; `cues: 'metadata'` in `EDITOR_SECTION_GROUP`; and in `DEFAULT_EDITOR_SECTIONS`, right after the `quality` entry, `{ id: 'cues', open: true },`. `normalizeEditorSections` already inserts a missing default after its nearest surviving neighbour.

- [ ] **Step 5: Data and section**

Create `src/renderer/src/hooks/useTrackCues.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { TrackCues } from '../../../shared/types'

export function useTrackCues(contentId: string | undefined): {
  data: TrackCues | null | undefined
  isError: boolean
} {
  const { data, isError } = useQuery({
    queryKey: ['rekordbox-track-cues', contentId],
    queryFn: () => window.api.rekordboxTrackCues(contentId as string),
    enabled: contentId !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return { data, isError }
}
```

In `src/renderer/src/hooks/useRekordboxQueue.ts`, add `queryClient.invalidateQueries({ queryKey: ['rekordbox-track-cues'] }),` to `reread`'s list, so a section open while the queue lands shows what rekordbox now has.

Create `src/renderer/src/components/CuesSection.tsx`:

```tsx
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cueChanges, findDrops } from '../../../shared/cueRules'
import type { TrackCues } from '../../../shared/types'
import { useTrackCues } from '../hooks/useTrackCues'
import { CUE_COLOR } from '../lib/cueWave'
import { CueWave } from './CueWave'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'

const LEGEND: [number, string][] = [
  [1, 'editor.cues.legend16'],
  [22, 'editor.cues.legend32'],
  [42, 'editor.cues.legend48'],
  [32, 'editor.cues.legendStart'],
]

function Marking({
  read,
  cue,
}: {
  read: TrackCues
  cue: { contentId: string; path: string; label: string }
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const hot = read.cues.filter((c) => c.kind !== 0)
  const initial = useMemo(
    () =>
      findDrops(
        read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
        read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
      ),
    [read],
  )
  const [drops, setDrops] = useState<number[]>(initial)
  const beats = read.grid.map((b) => b.ms)
  const outcome = cueChanges(read.cues, drops, initial, beats, read.strong)
  const dirty = drops.length !== initial.length || drops.some((d) => !initial.includes(d))
  const same = (ms: number, kind: number, color: number) =>
    hot.some((h) => Math.abs(h.ms - ms) <= 50 && h.kind === kind && h.color === color)
  const drawnHot =
    outcome.status === 'plan'
      ? outcome.hot.map((h) => ({ ...h, pending: !same(h.ms, h.kind, h.color) }))
      : hot.map((h) => ({ ms: h.ms, kind: h.kind, color: h.color ?? 1, pending: false }))
  return (
    <>
      <CueWave
        wave={read.wave}
        grid={read.grid}
        durationMs={read.durationMs}
        hot={drawnHot}
        drops={drops.map((ms) => ({ ms, pending: !initial.includes(ms) }))}
        onAddDrop={(ms) => setDrops((d) => [...d, ms].sort((a, b) => a - b))}
        onRemoveDrop={(ms) => setDrops((d) => d.filter((x) => x !== ms))}
      />
      {outcome.status === 'manual' && (
        <p data-testid="cues-manual" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.manual')}
        </p>
      )}
      {outcome.status === 'too-many' && (
        <p data-testid="cues-too-many" className="mt-2 text-xs text-warn">
          {tr('editor.cues.tooMany')}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <ul data-testid="cues-legend" className="flex flex-wrap items-center gap-3 text-[11px] text-fg-dim">
          {LEGEND.map(([color, key]) => (
            <li key={key} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                style={{ backgroundColor: CUE_COLOR[color] }}
                className="h-2 w-2 rounded-sm"
              />
              {tr(key)}
            </li>
          ))}
        </ul>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="cues-undo"
            disabled={!dirty}
            onClick={() => setDrops(initial)}
            className="press rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.undo')}
          </button>
          <button
            type="button"
            data-testid="cues-save"
            disabled={!dirty || outcome.status === 'too-many'}
            onClick={() =>
              void window.api.saveRekordboxCues({
                contentId: cue.contentId,
                path: cue.path,
                label: cue.label,
                drops,
                previousDrops: initial,
                fingerprint: read.fingerprint,
              })
            }
            className="press rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.save')}
          </button>
        </div>
      </div>
    </>
  )
}

export function CuesSection({
  cue,
  open,
  onToggle,
}: {
  cue: { contentId: string; path: string; label: string }
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { data: read, isError } = useTrackCues(cue.contentId)
  return (
    <div data-testid="cues-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="cues"
        title={tr('editor.cues.title')}
        open={open}
        onToggle={onToggle}
        help={tr('editor.cues.help')}
      />
      <SectionBody open={open}>
        <div className="mt-3">
          {isError || read === null ? (
            <p className="text-xs text-fg-dim">{tr('editor.cues.unreadable')}</p>
          ) : read === undefined ? null : !read.analysed ? (
            <p data-testid="cues-unanalysed" className="text-xs text-fg-dim">
              {tr('editor.cues.unanalysed')}
            </p>
          ) : (
            <Marking key={read.fingerprint} read={read} cue={cue} />
          )}
        </div>
      </SectionBody>
    </div>
  )
}
```

`Marking` is keyed by the fingerprint, so once the queue lands (or rekordbox changes the cues) the re-read starts the marking again from what rekordbox has. `text-warn` and `--color-on-accent` are existing theme tokens (`Field.tsx`, `ConfirmDialog.tsx`).

- [ ] **Step 6: In the editor**

In `src/renderer/src/components/Editor.tsx`: add `rekordboxCue?: { contentId: string; path: string; label: string }` to the props and destructuring; widen `singleTrackOnly(id: 'quality' | 'properties' | 'cues', ...)`; import `CuesSection`; and add, next to `case 'properties':`:

```tsx
                    case 'cues':
                      if (!rekordboxCue) return false
                      if (isMulti) return singleTrackOnly(id, tr('editor.cues.title'))
                      return (
                        <CuesSection
                          key={id}
                          cue={rekordboxCue}
                          open={sectionOpen.cues}
                          onToggle={() => setSectionOpen('cues', !sectionOpen.cues)}
                        />
                      )
```

In `src/renderer/src/App.tsx`, on `<Editor`:

```tsx
                          rekordboxCue={
                            rekordboxOpen && playlistScope?.contentOf.get(selected.id)
                              ? {
                                  contentId: playlistScope.contentOf.get(selected.id) as string,
                                  path: selected.inputPath,
                                  label: selected.listLabel,
                                }
                              : undefined
                          }
```

- [ ] **Step 7: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/editorSections.test.ts src/renderer/src/components/CuesSection.test.tsx src/renderer/src/components/Editor.test.tsx src/renderer/src/components/settings src/renderer/src/hooks/useRekordboxQueue.test.tsx src/renderer/src/i18n`
Expected: PASS. If a settings test lists the section ids in order, it now sees `cues` after `quality`; update its expected list in the same commit, since the new order is the intended one.

- [ ] **Step 8: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/shared/editorSections.ts apps/desktop/src/shared/editorSections.test.ts apps/desktop/src/renderer/src/hooks/useTrackCues.ts apps/desktop/src/renderer/src/hooks/useRekordboxQueue.ts apps/desktop/src/renderer/src/components/CuesSection.tsx apps/desktop/src/renderer/src/components/CuesSection.test.tsx apps/desktop/src/renderer/src/components/Editor.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/i18n/locales apps/desktop/src/renderer/src/components/settings
git commit -m "Mark drops on rekordbox's waveform and save the countdown to rekordbox"
```

---

### Task 9: Swatches in the rekordbox list

**Files:**
- Modify: `src/shared/types.ts` (`CueSummary`)
- Modify: `src/main/rekordboxCues.ts` (`cueSummaries`), `src/main/rekordboxCuesIpc.ts` (`rekordbox:cueSummary`), preload, `test/api.ts`, `harness.tsx`
- Create: `src/renderer/src/components/CueSwatches.tsx`, `src/renderer/src/hooks/useCueSummaries.ts`
- Modify: `src/renderer/src/components/TrackList.tsx` (`cueSwatches` prop), `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useRekordboxQueue.ts` (re-read), `src/renderer/src/i18n/locales/*.json` (`trackList.cues*`)
- Test: `src/main/rekordboxCues.test.ts` (append), `src/renderer/src/components/CueSwatches.test.tsx`

**Interfaces:**
- Consumes: Task 4 `liveCues`; `anlzSections` (`anlz.ts`); Task 7 `CUE_COLOR`; plan A `RekordboxQueueState` (an item `track:<path>` with a `cues` part means pending cues).
- Produces:
  - `interface CueSummary { analysed: boolean; hot: { ms: number; color: number | null }[] }` (hot cues in time order)
  - `cueSummaries(db: Db, shareDir: string, contentIds: string[]): Record<string, CueSummary>`
  - IPC `rekordbox:cueSummary (contentIds: string[]) → Record<string, CueSummary>`; `Api.rekordboxCueSummary(contentIds: string[]): Promise<Record<string, CueSummary>>`
  - `useCueSummaries(contentIds: string[], enabled: boolean): Record<string, CueSummary>` (query `['rekordbox-cue-summary', sortedIds]`)
  - `CueSwatches({ summary, pending }: { summary: CueSummary; pending: boolean })`, test id `track-cue-swatches` with `data-pending`
  - `TrackList` prop `cueSwatches?: ReadonlyMap<string, { summary: CueSummary; pending: boolean }>`

Spec "En la lista": in the rows of a rekordbox playlist, "sin analizar" (no `AnalysisDataPath` or no `PQTZ`), "sin cues" (analysed, no hot cue), or one small square per hot cue in its colour, in time order; hollow while cues wait in the queue.

- [ ] **Step 1: Locale strings**

```json
{
  "es": { "trackList": { "cuesUnanalysed": "sin analizar", "cuesNone": "sin cues" } },
  "en": { "trackList": { "cuesUnanalysed": "not analysed", "cuesNone": "no cues" } },
  "de": { "trackList": { "cuesUnanalysed": "nicht analysiert", "cuesNone": "keine Cues" } },
  "fr": { "trackList": { "cuesUnanalysed": "non analysé", "cuesNone": "sans cues" } },
  "pt-BR": { "trackList": { "cuesUnanalysed": "sem análise", "cuesNone": "sem cues" } }
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/main/rekordboxCues.test.ts` (add `cueSummaries` to the import; the `collection` helper of Task 4 writes an analysed track 103 with cues q1..q3):

```ts
describe('cueSummaries', () => {
  it('says per track whether it is analysed and which hot cues it has', async () => {
    const { db, share } = await collection()
    expect(cueSummaries(db, share, ['103', '104'])).toEqual({
      '103': { analysed: true, hot: [{ ms: 8000, color: 1 }] },
      '104': { analysed: false, hot: [] },
    })
    db.close()
  })
})
```

Create `src/renderer/src/components/CueSwatches.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { CueSwatches } from './CueSwatches'

afterEach(cleanup)

describe('CueSwatches', () => {
  // The DJ scans a playlist for what still needs cues; the three states read at a glance.
  it('says when the track is not analysed or has no cues', () => {
    render(<CueSwatches summary={{ analysed: false, hot: [] }} pending={false} />)
    expect(screen.getByTestId('track-cue-swatches')).toHaveTextContent('not analysed')
    cleanup()
    render(<CueSwatches summary={{ analysed: true, hot: [] }} pending={false} />)
    expect(screen.getByTestId('track-cue-swatches')).toHaveTextContent('no cues')
  })

  it('draws one square per hot cue, hollow while waiting for rekordbox', () => {
    render(
      <CueSwatches
        summary={{ analysed: true, hot: [{ ms: 1000, color: 1 }, { ms: 2000, color: 42 }] }}
        pending
      />,
    )
    const swatches = screen.getByTestId('track-cue-swatches')
    expect(swatches.querySelectorAll('[data-swatch]')).toHaveLength(2)
    expect(swatches).toHaveAttribute('data-pending', 'true')
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCues.test.ts src/renderer/src/components/CueSwatches.test.tsx`
Expected: FAIL, missing export and module.

- [ ] **Step 4: Implement**

`src/shared/types.ts`:

```ts
export interface CueSummary {
  analysed: boolean
  hot: { ms: number; color: number | null }[]
}
```

Append to `src/main/rekordboxCues.ts` (import `anlzSections` from `./anlz` and `type CueSummary`):

```ts
export function cueSummaries(
  db: Db,
  shareDir: string,
  contentIds: string[],
): Record<string, CueSummary> {
  const row = db.prepare(
    `SELECT AnalysisDataPath FROM djmdContent WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
  )
  const out: Record<string, CueSummary> = {}
  for (const id of contentIds) {
    const found = row.get(id) as { AnalysisDataPath: string | null } | undefined
    if (!found) continue
    const dat = found.AnalysisDataPath ? read(`${shareDir}${found.AnalysisDataPath}`) : null
    const analysed = dat !== null && anlzSections(dat).some((s) => s.tag === 'PQTZ')
    out[id] = {
      analysed,
      hot: liveCues(db, id)
        .filter((c) => c.kind !== 0)
        .sort((a, b) => a.ms - b.ms)
        .map((c) => ({ ms: c.ms, color: c.color })),
    }
  }
  return out
}
```

In `src/main/rekordboxCuesIpc.ts`:

```ts
  ipcMain.handle('rekordbox:cueSummary', (_e, contentIds: string[]) => {
    const path = host.collection()
    return withCollection(path, (db) => cueSummaries(db, rekordboxShareDir(path), contentIds), {})
  })
```

Preload: `rekordboxCueSummary: (contentIds: string[]) => Promise<Record<string, CueSummary>>` in `api.ts`, `rekordboxCueSummary: (contentIds: string[]) => ipcRenderer.invoke('rekordbox:cueSummary', contentIds)` in `index.ts`; stubs `rekordboxCueSummary: async () => ({})` in `test/api.ts` and `harness.tsx`.

Create `src/renderer/src/hooks/useCueSummaries.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { CueSummary } from '../../../shared/types'

const NONE: Record<string, CueSummary> = {}

export function useCueSummaries(contentIds: string[], enabled: boolean): Record<string, CueSummary> {
  const key = [...new Set(contentIds)].sort()
  const { data } = useQuery({
    queryKey: ['rekordbox-cue-summary', key],
    queryFn: () => window.api.rekordboxCueSummary(key),
    enabled: enabled && key.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data ?? NONE
}
```

Create `src/renderer/src/components/CueSwatches.tsx`:

```tsx
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CueSummary } from '../../../shared/types'
import { CUE_COLOR } from '../lib/cueWave'

export function CueSwatches({
  summary,
  pending,
}: {
  summary: CueSummary
  pending: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <span
      data-testid="track-cue-swatches"
      data-pending={pending ? 'true' : undefined}
      className="flex shrink-0 items-center gap-0.5 text-[10px] text-fg-faint"
    >
      {!summary.analysed
        ? tr('trackList.cuesUnanalysed')
        : summary.hot.length === 0
          ? tr('trackList.cuesNone')
          : summary.hot.map((h) => (
              <span
                key={h.ms}
                data-swatch
                aria-hidden="true"
                style={{
                  borderColor: CUE_COLOR[h.color ?? 1],
                  backgroundColor: pending ? 'transparent' : CUE_COLOR[h.color ?? 1],
                }}
                className="h-2 w-2 rounded-[2px] border"
              />
            ))}
    </span>
  )
}
```

`src/renderer/src/components/TrackList.tsx`: `cueSwatches?: ReadonlyMap<string, { summary: CueSummary; pending: boolean }>` on `Props`, `cueSwatch?: { summary: CueSummary; pending: boolean }` on `RowProps`, passed as `cueSwatch={cueSwatches?.get(t.id)}`, and rendered right after the playlist dots of plan A's Task 14:

```tsx
              {cueSwatch && <CueSwatches summary={cueSwatch.summary} pending={cueSwatch.pending} />}
```

`src/renderer/src/App.tsx`, next to plan A's `playlistDots`:

```tsx
  const rekordboxContentIds = useMemo(
    () => (rekordboxOpen && playlistScope ? [...playlistScope.contentOf.values()] : []),
    [rekordboxOpen, playlistScope],
  )
  const cueSummaries = useCueSummaries(rekordboxContentIds, rekordboxOpen)
  const pendingCuePaths = useMemo(
    () =>
      new Set(
        rekordboxQueue.state.items
          .filter((i) => i.parts.some((p) => p.kind === 'cues'))
          .map((i) => i.key.slice('track:'.length)),
      ),
    [rekordboxQueue.state],
  )
  const cueSwatches = useMemo(() => {
    const out = new Map<string, { summary: CueSummary; pending: boolean }>()
    if (!rekordboxOpen || !playlistScope) return out
    for (const [trackId, contentId] of playlistScope.contentOf) {
      const summary = cueSummaries[contentId]
      const t = tracksRef.current.find((x) => x.id === trackId)
      if (summary && t) out.set(trackId, { summary, pending: pendingCuePaths.has(t.inputPath) })
    }
    return out
  }, [rekordboxOpen, playlistScope, cueSummaries, pendingCuePaths, tracksRef])
```

and `cueSwatches={cueSwatches}` on `<TrackList`. `rekordboxOpen` and `playlistScope` are defined further down in App today (line ~1841); move this block below them. The map changes only when the summaries, the open playlist or the queue change, not on every edit, so the memoized rows stay put.

`src/renderer/src/hooks/useRekordboxQueue.ts`: add `queryClient.invalidateQueries({ queryKey: ['rekordbox-cue-summary'] }),` to `reread`.

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCues.test.ts src/main/rekordboxCuesIpc.test.ts src/renderer/src/components/CueSwatches.test.tsx src/renderer/src/components/TrackList.test.tsx src/renderer/src/i18n`
Expected: PASS.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxCues.ts apps/desktop/src/main/rekordboxCues.test.ts apps/desktop/src/main/rekordboxCuesIpc.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/scenarios/harness.tsx apps/desktop/src/renderer/src/components/CueSwatches.tsx apps/desktop/src/renderer/src/components/CueSwatches.test.tsx apps/desktop/src/renderer/src/hooks/useCueSummaries.ts apps/desktop/src/renderer/src/components/TrackList.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/hooks/useRekordboxQueue.ts apps/desktop/src/renderer/src/i18n/locales
git commit -m "Show each rekordbox row's hot cues as swatches, or that it is not analysed"
```

---

### Task 10: Complete on close

**Files:**
- Modify: `src/shared/types.ts` (`Settings.completeCuesOnClose`), `src/main/settings.ts`, `src/renderer/src/test/api.ts`, `src/renderer/src/lib/settingsDraft.ts`
- Create: `src/main/rekordboxCompleteOnClose.ts`
- Modify: `src/main/rekordboxQueueWatch.ts` (`alwaysWatch`, `onClosed`)
- Modify: `src/main/rekordboxCuesIpc.ts` (`rekordbox:countCompletable`), `src/main/index.ts` (watcher deps, poke after a settings save), preload, `harness.tsx`
- Modify: `src/renderer/src/components/settings/DestinationTab.tsx` (the toggle and its count)
- Modify: `src/renderer/src/i18n/locales/*.json` (`settings.completeCues*`)
- Test: `src/main/rekordboxCompleteOnClose.test.ts`, `src/main/rekordboxQueueWatch.test.ts` (append), `src/renderer/src/components/settings/DestinationTab.test.tsx` (append)

**Interfaces:**
- Consumes: Task 4 `readTrackCues`; Task 2 `cueChanges`, `findDrops`, `isEmptyChange`; Task 6 `CuesOp`; plan A Task 7 `watchRekordboxQueue`.
- Produces:
  - `Settings.completeCuesOnClose: boolean` (default false; spec "Apagada por defecto")
  - `completableOps(db: Db, shareDir: string, newId?: () => string): CuesOp[]` (tracks with at least one drop, no hot cue and a grid, whose plan writes something)
  - `WatchDeps.alwaysWatch?: () => boolean` (poll even with an empty queue) and `WatchDeps.onClosed?: () => void` (called once each time rekordbox goes from running to closed, before the apply)
  - IPC `rekordbox:countCompletable → number`; `Api.rekordboxCountCompletable(): Promise<number>`
  - test ids `settings-complete-cues`, `settings-complete-cues-confirm`, `settings-complete-cues-yes`, `settings-complete-cues-no`

Spec "Completar solo": only tracks with drops, no hot cue (so `fits_plan` holds) and a grid; same queue, backup and transaction; the notice counts the tracks completed; turning it on first counts and says "Se completarán 312 pistas al cerrar rekordbox." before the setting is kept. Decision 7: the watcher calls it the moment it sees rekordbox closed, then applies.

- [ ] **Step 1: Locale strings**

```json
{
  "es": { "settings": { "completeCues": "Al cerrar rekordbox, poner la cuenta atrás en las pistas con drops y sin hot cues", "completeCuesHint": "Escribe en tu colección pistas que no has mirado en Surco. Apagado, la cuenta atrás solo se guarda desde la sección Cues.", "completeCuesCount_one": "Se completará 1 pista al cerrar rekordbox.", "completeCuesCount_other": "Se completarán {{count}} pistas al cerrar rekordbox.", "completeCuesYes": "Encender", "completeCuesNo": "Cancelar" } },
  "en": { "settings": { "completeCues": "When rekordbox closes, set the countdown on tracks with drops and no hot cues", "completeCuesHint": "It writes to your collection on tracks you have not looked at in Surco. Off, the countdown is only saved from the Cues section.", "completeCuesCount_one": "1 track will be completed when rekordbox closes.", "completeCuesCount_other": "{{count}} tracks will be completed when rekordbox closes.", "completeCuesYes": "Turn on", "completeCuesNo": "Cancel" } },
  "de": { "settings": { "completeCues": "Beim Schließen von rekordbox den Countdown in Titeln mit Drops und ohne Hot Cues setzen", "completeCuesHint": "Schreibt in deine Sammlung, auch in Titel, die du in Surco nicht angesehen hast. Aus wird der Countdown nur im Abschnitt Cues gespeichert.", "completeCuesCount_one": "1 Titel wird beim Schließen von rekordbox ergänzt.", "completeCuesCount_other": "{{count}} Titel werden beim Schließen von rekordbox ergänzt.", "completeCuesYes": "Einschalten", "completeCuesNo": "Abbrechen" } },
  "fr": { "settings": { "completeCues": "À la fermeture de rekordbox, placer le compte à rebours sur les morceaux avec drops et sans hot cues", "completeCuesHint": "Écrit dans votre collection sur des morceaux que vous n’avez pas regardés dans Surco. Désactivé, le compte à rebours ne s’enregistre que depuis la section Cues.", "completeCuesCount_one": "1 morceau sera complété à la fermeture de rekordbox.", "completeCuesCount_other": "{{count}} morceaux seront complétés à la fermeture de rekordbox.", "completeCuesYes": "Activer", "completeCuesNo": "Annuler" } },
  "pt-BR": { "settings": { "completeCues": "Ao fechar o rekordbox, pôr a contagem regressiva nas faixas com drops e sem hot cues", "completeCuesHint": "Grava na sua coleção em faixas que você não viu no Surco. Desligado, a contagem só é salva pela seção Cues.", "completeCuesCount_one": "1 faixa será completada ao fechar o rekordbox.", "completeCuesCount_other": "{{count}} faixas serão completadas ao fechar o rekordbox.", "completeCuesYes": "Ligar", "completeCuesNo": "Cancelar" } }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/rekordboxCompleteOnClose.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anlzFile, pqtzSection } from './anlzFixture'
import { completableOps } from './rekordboxCompleteOnClose'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const BEATS = Array.from({ length: 800 }, (_, i) => i * 500)

describe('completableOps', () => {
  // Only what fits_plan allows by definition: drops, no hot cue at all, and a grid.
  it('completes tracks with drops and no hot cues, and only those', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbcomplete-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.map((c) =>
        ['101', '102', '103'].includes(c.ID) ? { ...c, AnalysisDataPath: ANLZ } : c,
      ),
      cues: [
        { ID: 'a', ContentID: '101', InMsec: 128000, Kind: 0, ColorTableIndex: null },
        { ID: 'b', ContentID: '102', InMsec: 128000, Kind: 0, ColorTableIndex: null },
        { ID: 'c', ContentID: '102', InMsec: 1000, Kind: 1, ColorTableIndex: 32 },
        { ID: 'd', ContentID: '104', InMsec: 128000, Kind: 0, ColorTableIndex: null },
      ],
    })
    mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
    writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    const ops = completableOps(db, join(dir, 'share'), () => 'op')
    expect(ops).toEqual([
      expect.objectContaining({
        kind: 'cues',
        contentId: '101',
        path: '/Volumes/Public/Music/Night Train.aiff',
        label: 'Night Train',
        drops: [128000],
        previousDrops: [128000],
      }),
    ])
    db.close()
  })
})
```

Append to `src/main/rekordboxQueueWatch.test.ts`:

```ts
describe('watchRekordboxQueue on close', () => {
  // The option has to see rekordbox close even when nothing is queued yet.
  it('calls onClosed when rekordbox goes from open to closed, with an empty queue', async () => {
    const { deps, setEmpty } = setup([true, false, false])
    setEmpty(true)
    const onClosed = vi.fn(() => setEmpty(false))
    const watch = watchRekordboxQueue({ ...deps, alwaysWatch: () => true, onClosed })
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(onClosed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('never calls onClosed when rekordbox was not seen open', async () => {
    const { deps } = setup([false, false])
    const onClosed = vi.fn()
    watchRekordboxQueue({ ...deps, alwaysWatch: () => true, onClosed }).poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(onClosed).not.toHaveBeenCalled()
  })
})
```

In `src/renderer/src/components/settings/DestinationTab.test.tsx`, add `completeCuesOnClose: false,` to its `synced` constant (the type gains the field in Step 4) and append:

```tsx
describe('complete on close', () => {
  function renderRekordbox(completeCuesOnClose: boolean, count = 312) {
    ;(window as unknown as { api: unknown }).api = {
      platform: 'darwin',
      rekordboxCountCompletable: vi.fn(async () => count),
    }
    const patch = vi.fn()
    render(
      <DestinationTab
        synced={{ ...synced, completeCuesOnClose }}
        local={local}
        patch={patch}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection="/rb/master.db"
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )
    return patch
  }

  // Off by default; turning it on first says how many tracks it will touch.
  it('counts the tracks before turning on', async () => {
    const patch = renderRekordbox(false)
    fireEvent.click(screen.getByTestId('settings-complete-cues'))
    expect(await screen.findByTestId('settings-complete-cues-confirm')).toHaveTextContent(
      '312 tracks will be completed when rekordbox closes.',
    )
    expect(patch).not.toHaveBeenCalledWith('completeCuesOnClose', true)
    fireEvent.click(screen.getByTestId('settings-complete-cues-yes'))
    expect(patch).toHaveBeenCalledWith('completeCuesOnClose', true)
  })

  it('keeps it off when the count is declined', async () => {
    const patch = renderRekordbox(false)
    fireEvent.click(screen.getByTestId('settings-complete-cues'))
    fireEvent.click(await screen.findByTestId('settings-complete-cues-no'))
    expect(patch).not.toHaveBeenCalled()
  })

  it('turns off without asking', () => {
    const patch = renderRekordbox(true)
    fireEvent.click(screen.getByTestId('settings-complete-cues'))
    expect(patch).toHaveBeenCalledWith('completeCuesOnClose', false)
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCompleteOnClose.test.ts src/main/rekordboxQueueWatch.test.ts src/renderer/src/components/settings/DestinationTab.test.tsx`
Expected: FAIL, missing module, unknown deps, missing toggle.

- [ ] **Step 4: The setting**

`src/shared/types.ts`, in `Settings` next to `syncRekordbox`: `completeCuesOnClose: boolean`. `src/main/settings.ts` defaults: `completeCuesOnClose: false,`. `src/renderer/src/test/api.ts` defaults: `completeCuesOnClose: false,`. `src/renderer/src/lib/settingsDraft.ts`: `completeCuesOnClose: boolean` in `SyncedDraft` after `syncRekordbox`, and `completeCuesOnClose: s.completeCuesOnClose,` where the draft is seeded (after `syncRekordbox: s.syncRekordbox,`). It is a synced key like `syncRekordbox`, not one of `LOCAL_KEYS`.

- [ ] **Step 5: The completable tracks**

Create `src/main/rekordboxCompleteOnClose.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { cueChanges, findDrops, isEmptyChange } from '../shared/cueRules'
import { readTrackCues } from './rekordboxCues'
import type { CuesOp } from './rekordboxQueueOps'

type Db = InstanceType<typeof Database>

export function completableOps(db: Db, shareDir: string, newId: () => string = randomUUID): CuesOp[] {
  const ids = (
    db
      .prepare(
        `SELECT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0
          GROUP BY ContentID HAVING sum(CASE WHEN Kind <> 0 THEN 1 ELSE 0 END) = 0`,
      )
      .all() as { ContentID: string }[]
  ).map((r) => String(r.ContentID))
  const info = db.prepare(
    `SELECT FolderPath, Title FROM djmdContent WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
  )
  const ops: CuesOp[] = []
  for (const contentId of ids) {
    const row = info.get(contentId) as { FolderPath: string; Title: string | null } | undefined
    if (!row) continue
    const read = readTrackCues(db, shareDir, contentId)
    if (!read || !read.analysed) continue
    const drops = findDrops(
      read.cues.map((c) => c.ms),
      [],
    )
    const out = cueChanges(
      read.cues,
      drops,
      drops,
      read.grid.map((b) => b.ms),
      read.strong,
    )
    if (out.status !== 'plan' || isEmptyChange(out.changes)) continue
    ops.push({
      id: newId(),
      kind: 'cues',
      contentId,
      path: row.FolderPath,
      label: row.Title ?? row.FolderPath,
      drops,
      previousDrops: drops,
      fingerprint: read.fingerprint,
    })
  }
  return ops
}
```

In `src/main/rekordboxCuesIpc.ts`:

```ts
  ipcMain.handle('rekordbox:countCompletable', () => {
    const path = host.collection()
    return withCollection(path, (db) => completableOps(db, rekordboxShareDir(path)).length, 0)
  })
```

Preload: `rekordboxCountCompletable: () => Promise<number>` / `rekordboxCountCompletable: () => ipcRenderer.invoke('rekordbox:countCompletable')`; stubs `rekordboxCountCompletable: async () => 0` in `test/api.ts` and `harness.tsx`.

- [ ] **Step 6: The watcher sees rekordbox close**

In `src/main/rekordboxQueueWatch.ts`, `WatchDeps` gains `alwaysWatch?: () => boolean` and `onClosed?: () => void`, and the body becomes:

```ts
export function watchRekordboxQueue(deps: WatchDeps): { poke: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let armed = true
  let busy = false
  let seenRunning = false
  const shouldWatch = (): boolean => !deps.queue.isEmpty() || (deps.alwaysWatch?.() ?? false)

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const tick = async (): Promise<void> => {
    if (busy) return
    if (!shouldWatch()) {
      stop()
      return
    }
    busy = true
    try {
      if (await deps.isRunning()) {
        armed = true
        seenRunning = true
        return
      }
      if (seenRunning) {
        seenRunning = false
        deps.onClosed?.()
      }
      if (deps.queue.isEmpty() || !armed) return
      const result = await deps.queue.apply(async () => !(await deps.isRunning()))
      if (
        result.status === 'refused' &&
        (result.reason === 'cancelled' || result.reason === 'rekordbox-running')
      )
        return
      if (result.status === 'refused') armed = false
      if (result.status !== 'empty') deps.onApplied(result)
      if (!shouldWatch()) stop()
    } finally {
      busy = false
    }
  }

  return {
    poke() {
      if (!shouldWatch()) return
      if (!timer) timer = setInterval(() => void tick(), deps.intervalMs ?? 5000)
      void tick()
    },
    stop,
  }
}
```

In `src/main/index.ts`, the watcher gets:

```ts
  alwaysWatch: () => getSettings().completeCuesOnClose,
  onClosed: () => {
    if (!getSettings().completeCuesOnClose) return
    const path = rekordboxCollectionPath()
    if (!path) return
    try {
      const ops = withCollection(path, (db) => completableOps(db, rekordboxShareDir(path)), [])
      if (ops.length > 0) rekordboxQueue.enqueue(ops)
    } catch (err) {
      log.warn(`rekordbox complete on close skipped: ${String(err)}`)
    }
  },
```

(imports `completableOps`, `withCollection`, `rekordboxShareDir`), and the `settings:set` handler pokes it after saving: `if (patch.completeCuesOnClose !== undefined) rekordboxQueueWatch.poke()`.

- [ ] **Step 7: The toggle**

In `src/renderer/src/components/settings/DestinationTab.tsx` (import `useState`), inside the rekordbox `SettingsSection`, after the `rekordboxDbPathHint` hint:

```tsx
        <CheckboxRow
          testid="settings-complete-cues"
          className="mt-4"
          checked={synced.completeCuesOnClose}
          disabled={!rekordboxCollection}
          onChange={(v) => {
            if (!v) {
              setCompleteCount(null)
              patch('completeCuesOnClose', false)
              return
            }
            void window.api.rekordboxCountCompletable().then(setCompleteCount)
          }}
          label={tr('settings.completeCues')}
        />
        {completeCount !== null && (
          <div
            data-testid="settings-complete-cues-confirm"
            className="mt-2 rounded-lg border border-[var(--color-line-strong)] p-3 text-xs"
          >
            <p className="text-fg">{tr('settings.completeCuesCount', { count: completeCount })}</p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                data-testid="settings-complete-cues-no"
                onClick={() => setCompleteCount(null)}
                className="rounded px-2 py-1 text-fg-muted hover:bg-[var(--color-hover)]"
              >
                {tr('settings.completeCuesNo')}
              </button>
              <button
                type="button"
                data-testid="settings-complete-cues-yes"
                onClick={() => {
                  patch('completeCuesOnClose', true)
                  setCompleteCount(null)
                }}
                className="rounded bg-[var(--color-accent-soft)] px-2 py-1 text-fg hover:bg-[var(--color-hover)]"
              >
                {tr('settings.completeCuesYes')}
              </button>
            </div>
          </div>
        )}
        <SettingsHint className="mt-2">{tr('settings.completeCuesHint')}</SettingsHint>
```

with `const [completeCount, setCompleteCount] = useState<number | null>(null)` at the top of the component.

- [ ] **Step 8: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxCompleteOnClose.test.ts src/main/rekordboxQueueWatch.test.ts src/main/rekordboxCuesIpc.test.ts src/renderer/src/components/settings/DestinationTab.test.tsx src/renderer/src/lib/settingsDraft.test.ts src/renderer/src/i18n`
Expected: PASS.

- [ ] **Step 9: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/settings.ts apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/renderer/src/lib/settingsDraft.ts apps/desktop/src/main/rekordboxCompleteOnClose.ts apps/desktop/src/main/rekordboxCompleteOnClose.test.ts apps/desktop/src/main/rekordboxQueueWatch.ts apps/desktop/src/main/rekordboxQueueWatch.test.ts apps/desktop/src/main/rekordboxCuesIpc.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.ts apps/desktop/src/scenarios/harness.tsx apps/desktop/src/renderer/src/components/settings/DestinationTab.tsx apps/desktop/src/renderer/src/components/settings/DestinationTab.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Optionally complete the countdown on close for tracks with drops and no hot cues"
```

---

