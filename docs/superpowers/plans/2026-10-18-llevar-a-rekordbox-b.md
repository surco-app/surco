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

