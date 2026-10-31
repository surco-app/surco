# Reparar daños de versiones anteriores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Daños" filter in "Revisar metadatos de la lista…" that finds files and Traktor/Engine DJ entries damaged by the bugs fixed in v1.18.3/v1.18.4, shows each with its certainty and evidence, and repairs only what the user stages, with a backup in Copias first.

**Architecture:** Detection runs in main as pure judges (`genreDamage.ts`, `traktorCueDamage.ts`, `engineDamage.ts`) fed by thin IO scanners, orchestrated by `damageScan.ts` behind `damage:scan`. Repairs go through the existing writers and queues: a new guarded TagLib job inside `rewriteTagFields` for genres and cue trees, `NmlPatch.cueShift` through `flushTraktorSync`, `EngineRepoint` (from = to) through `flushEngineSync`. The renderer adds a `damage` filter to `useMusicReview`, a row/detail/confirm/done rendering, and re-scans in the existing "verifying" phase.

**Tech Stack:** Electron main + React 19 renderer (TS), vitest, node-taglib-sharp, ffmpeg-static, sql.js (Engine), i18next (6 locales).

**Spec:** `docs/superpowers/specs/2026-10-31-reparar-danos-design.md` (detection rules with measured tables, certainty rules, sign convention, open questions).

## Global Constraints

- Work only in `/Users/vicent/code/surco/.claude/worktrees/reparar-danos` (branch `reparar-danos`). Never touch the user's real Traktor, Engine DJ, rekordbox or Music libraries.
- Tests from `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run src/<path>`. Never filter by path from the repo root (setup is skipped there). Before the last commit, `npm test` in `apps/desktop` exits 0 (grep `Errors|Unhandled` too).
- Typecheck all three projects: `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `-p tsconfig.scenarios.json`. Lint `npx biome check src`, no new warnings.
- TDD: show each new test red first. Then mutate the implementation once per rule (scratchpad script, break/restore) and see the test go red.
- Sign convention: every cue displacement in types and judges is **ms added** to each position (positive = later). Convert to `shiftCueStart`'s subtracting `shiftMs` only at the writer (`shiftMs = -addMs`).
- Margins: `SAME_CUE_MS = 1` (reuse the constant semantics of `traktorNml.ts`), `ENGINE_SAME_SEC = 0.1`, old Traktor rules `[-51, 0]`, genre damage replayed 1 to 4 saves.
- Certainty: `sure` is staged by default, `likely` never. A finding with `repair: null` has no checkbox.
- No library or file write without its backup: files via `keepOriginal(..., { reencodes: false, regardlessOfPolicy: true })` (as `rewriteTagFields` does), libraries via `moments.begin('review')` plus each writer's own session backup.
- UI copy in es, en, de, fr, pt-BR, ja: tuteo, no em dash, no explanatory colon. Selectors `data-testid` with prefix `damage-`. Mocks of `window.api` are `vi.fn<Api['method']>()`.
- Fixtures: real audio from ffmpeg (not a pure sine for anything correlated), cue trees from `traktor4Fixture.ts`, Engine rows from `enginePerformanceFixture.ts`.
- Zero new comments. No TODOs. Commits: one English title line, no body, no prefix.

## Review Focus

1. **Double repair.** A finding re-staged while its first repair is still queued must not shift twice. Guards: TCON text equals `from`, Traktor `entryState`, Engine `expectTrackData`. Tests in Tasks 2, 9, 10.
2. **Sign of the Traktor shift.** `k = automaticCueOffsetOfFiles(mp3, pcm)` is −51.18 for a Xing MP3; the source-entry repair adds `−k` (cues later), the NML patch carries `shiftMs = k`. Task 4 pins it with numbers, Task 10 on a real NML.
3. **A legit genre with parentheses.** `Techno (Peak Time)` written by ffmpeg (single `(`) is not damage; `(17)` alone is not damage. Task 1.
4. **NFD paths** from SMB or Traktor in sibling and row lookup. Tasks 5 and 8 each have an NFD case.
5. **A library that cannot be read** leaves its findings out and says so on the scope line; it never fails the whole scan. Task 9.

---

### Task 1: Genre damage oracle and judge

**Files:**
- Create: `apps/desktop/src/main/genreDamage.ts`
- Test: `apps/desktop/src/main/genreDamage.test.ts`, `apps/desktop/src/main/genreDamageTaglib.test.ts`

**Interfaces:**
- Produces:
  - `damageV23(text: string): string` — what one save with `useNonStandardV2V3GenreSeparators = true` left in a v2.3 TCON.
  - `hasGenreMarker(raw: string): boolean` — leading `(N)` with N in TagLib's ID3v1 table, or `((`.
  - `type GenreJudgement = { kind: 'genre-number' | 'genre-parens'; certainty: 'sure' | 'likely'; options: string[]; source?: GenreSource }`
  - `type GenreSource = 'rekordbox' | 'traktor' | 'engine' | 'info'`
  - `judgeGenre(raw: string, evidence: { source: GenreSource; value: string }[]): GenreJudgement | null`

- [ ] **Step 1: Write the oracle test** in `genreDamageTaglib.test.ts`: for each of `House; Deep House`, `House/Deep House`, `House; Techno; Deep House`, `Electronic; Techno`, `Techno; House`, `Deep House; Tech House`, `Techno (Peak Time / Driving)`, `Afro House (Melodic)`, encode an MP3 with ffmpeg `-id3v2_version 3 -metadata genre=…`, set `Id3v2Settings.useNonStandardV2V3GenreSeparators = true`, save the file `n` times (n = 1, 2, 3) changing `comment`, restore the setting to `false` in `afterEach`, read the raw TCON bytes, and `expect(raw).toBe(applyN(damageV23, text, n))`. Pin the measured rows from the spec table explicitly (`'(35) Deep House'`, `'(35)Deep House'`, `'Techno ((Peak Time ; Driving)'`).
- [ ] **Step 2: Write `judgeGenre` tests** in `genreDamage.test.ts`:
  - `judgeGenre('(35) Deep House', [{ source: 'traktor', value: 'House; Deep House' }])` → `{ kind: 'genre-number', certainty: 'sure', options: ['House; Deep House'], source: 'traktor' }`.
  - `judgeGenre('(35) Deep House', [])` → `certainty: 'likely'`, `options[0] === 'House; Deep House'`.
  - `judgeGenre('(35)Deep House', [])` → `options[0] === 'House/Deep House'`.
  - `judgeGenre('Techno ((((Peak Time ; Driving)', [])` → `kind: 'genre-parens'`, `options[0] === 'Techno (Peak Time / Driving)'`.
  - `judgeGenre('Techno (Peak Time)', [])`, `judgeGenre('(17)', [])`, `judgeGenre('Deep House; Tech House', [])` → `null`.
  - `judgeGenre('(35) Deep House', [{ source: 'engine', value: 'House' }])` → `likely` (evidence that does not replay to raw is ignored).
- [ ] **Step 3: Run both, expect FAIL** (`Cannot find module './genreDamage'`).
- [ ] **Step 4: Implement `genreDamage.ts`.** Use TagLib's `Genres.audioToIndex` / `indexToAudio` for the v1 table. Candidates for `likely`, in this order: number name + `;` + rest when rest starts with a space, number name + `/` + rest otherwise; every run of `(` collapsed to one; ` ; ` back to ` / ` inside a text with `(`. Keep only those whose `damageV23` replayed 1..4 times equals `raw`.
- [ ] **Step 5: Run both, expect PASS.** Mutate the escape rule and the `/`→`;` rule once each and see the oracle go red.
- [ ] **Step 6: Commit** `Model the ID3v2.3 genres TagLib's old separators left so damaged ones can be told apart`

### Task 2: Raw TCON read and guarded genre write

**Files:**
- Create: `apps/desktop/src/main/genreFrame.ts`
- Modify: `apps/desktop/src/main/workerJobs.ts` (two job types), `apps/desktop/src/main/musicFieldWrite.ts` (`rewriteTagFields` takes the job)
- Test: `apps/desktop/src/main/genreFrame.test.ts`, `apps/desktop/src/main/musicFieldWrite.test.ts`

**Interfaces:**
- Produces:
  - `readGenreFrame(file: string): { raw: string; info?: string } | null` — null when the file has no ID3v2.3 TCON; `info` is a WAV's RIFF `IGNR` without its NUL.
  - `setGenreFrame(file: string, changes: TagFieldChange[]): FieldWrite[]` — `written` only when every TCON's raw text equals `change.from`; writes `change.to` as plain text the way `keepGenreParentheses` does.
  - Worker jobs `{ type: 'genreFrame'; file }` and `{ type: 'setGenreFrame'; file; changes }`.
  - `rewriteTagFields(file, changes, tracking?, job: 'setTagFields' | 'setGenreFrame' = 'setTagFields')`

- [ ] **Step 1: Write failing tests.** Damage MP3, AIFF (`injectAiffPriv`-style ID3 chunk written by TagLib) and WAV fixtures with the old setting on, then: `readGenreFrame(mp3)` → `{ raw: '(35) Deep House' }`; WAV keeps `info: 'House; Deep House'`; `setGenreFrame(mp3, [{ field: 'genre', from: '(35) Deep House', to: 'House; Deep House' }])` → `['written']` and a fresh read gives `raw === 'House; Deep House'` and ffprobe reads `House; Deep House`; same call with `from: 'House'` → `['unchanged']` and the file's sha1 is unchanged; the WAV's `IGNR` and every PRIV TRAKTOR4 frame survive byte for byte (sha1). In `musicFieldWrite.test.ts`: `rewriteTagFields(file, changes, undefined, 'setGenreFrame')` leaves a backup whose content is the damaged file.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Read the raw body with `id3TextOf(frame.render(3).subarray(10))` before anything touches `frame.text`. Keep `rewriteTagFields`' copy, check, backup, rename unchanged; only the job name varies.
- [ ] **Step 4: Run, expect PASS.** Run `musicFieldWrite.test.ts` and `tagFieldSetGenre.test.ts` unchanged and green.
- [ ] **Step 5: Commit** `Read and rewrite the raw ID3v2.3 genre frame behind a guard on its exact text`

### Task 3: What each library holds as a file's genre

**Files:**
- Modify: `apps/desktop/src/main/libraryFileUse.ts`
- Test: `apps/desktop/src/main/libraryFileUse.test.ts`

**Interfaces:**
- Produces: `libraryGenresOf(paths: string[], libraries: SyncedLibraries, options?: PathMatchOptions): Promise<Record<string, { source: 'rekordbox' | 'traktor' | 'engine'; value: string }[]>>` — read only; a library that cannot be read is left out, as `libraryCopyInfo` does.

- [ ] **Step 1: Failing test** with a rekordbox fixture row, an Engine `Track.genre` and an NML `<INFO GENRE="House; Deep House">` for the same path: all three come back; an unreadable NML drops only Traktor; an NFD path in the NML still matches.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** next to `libraryCopyInfo`, reusing `findTrackByPath`, `engineRowFinder`, `findEntries` + `attr`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Read the genre each DJ library keeps for a file`

### Task 4: Traktor cue judge

**Files:**
- Create: `apps/desktop/src/main/traktorCueDamage.ts`
- Test: `apps/desktop/src/main/traktorCueDamage.test.ts`

**Interfaces:**
- Produces:
  - `interface CueMark { type: number; hotcue: number; ms: number }` (grid TYPE 4 excluded by the caller)
  - `offsetBetween(a: CueMark[], b: CueMark[]): number | null` — the d with `b = a + d` for every cue (same type and hotcue, same count, `SAME_CUE_MS`), else null.
  - `interface TraktorPair { sourceEntry: CueMark[] | null; sourceTree: CueMark[] | null; siblingEntry: CueMark[] | null; siblingTree: CueMark[] | null; k: number; sourceOnBootDisk: boolean }`
  - `type TraktorJudgement = { kind: 'traktor-source-cues' | 'traktor-calibration'; certainty: 'sure' | 'likely'; addMs: number; fixEntry: 'source' | 'sibling'; fixTree: boolean }`
  - `judgeTraktorPair(pair: TraktorPair): TraktorJudgement[]`

- [ ] **Step 1: Failing tests**, with `k = -51.18`:
  - Source moved, sure: `sourceTree` Intro 10000 / Break 15000, `sourceEntry` and `siblingTree` 9948.82 / 14948.82 → `[{ kind: 'traktor-source-cues', certainty: 'sure', addMs: 51.18, fixEntry: 'source', fixTree: false }]`.
  - Same without `sourceTree` → `likely`, `addMs: 51.18`.
  - Same with `sourceOnBootDisk: false` → `[]`.
  - Healthy pair (`sourceEntry` = tree, sibling = tree − 51.18) → `[]`.
  - Old rule on Xing MP3 → WAV: `sourceTree` 10000, `siblingTree` and `siblingEntry` 10000, `k = -51.18` → `[{ kind: 'traktor-calibration', certainty: 'sure', addMs: -51.18, fixEntry: 'sibling', fixTree: true }]`.
  - No-Xing MP3 → AIFF: `k = 0`, sibling at −51 → `addMs: 51`.
  - Sibling off by an odd 30 ms (not an old rule) → `[]`. Cues edited so offsets differ per cue → `[]`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the two rules of spec §2/§3 literally; `likely` when the reference is `sourceEntry` instead of `sourceTree`.
- [ ] **Step 4: Run, expect PASS.** Mutate the sign of `addMs` and the old-rule set; both go red.
- [ ] **Step 5: Commit** `Judge Traktor cue pairs left off by the source-entry and MP3 calibration bugs`

### Task 5: Traktor scan over the list

**Files:**
- Create: `apps/desktop/src/main/traktorCueDamageScan.ts`
- Test: `apps/desktop/src/main/traktorCueDamageScan.test.ts`

**Interfaces:**
- Consumes: `judgeTraktorPair` (Task 4), `readCueTree`, `readTraktorMarkers`, `traktorCueElements`, `findEntries`, `entryStates`, `automaticCueOffsetOfFiles`, `bootVolumeName`.
- Produces:
  - `interface TraktorDamage { path: string; judgement: TraktorJudgement; sibling: string; before: CueMark[]; entry?: { volume: string; dir: string; file: string; entryState: string } }`
  - `scanTraktorDamage(paths: string[], nmlPath: string, deps?: { bootVolume?: string; exists?: (p: string) => boolean; readdir?: (dir: string) => string[] }): Promise<TraktorDamage[]>`

- [ ] **Step 1: Failing tests** with a temp NML and real files: an ffmpeg MP3 with LAME Xing carrying a TRAKTOR4 PRIV (`id3WithPriv`), its `.aiff` sibling in another folder carrying the tree shifted −51.18, both entries in the NML on `Macintosh HD` with the MP3 entry holding the shifted cues → one `traktor-source-cues` sure for the MP3 path with `entry.file === 'uno.mp3'`. Only the `.aiff` in `paths` → the same finding (pair built from either side). Two siblings (`.aiff` and `.flac`) that both match → `[]`. Sibling found by NFD file name in the NML → matched. Unreadable NML → rejects (the caller decides).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Read the NML once; siblings from NML entries by NFC stem plus `readdir` of the source's folder; `entryState` from `entryStates(nml, [patch], bootVolume)`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Find Traktor entries whose cues the two cue bugs left off over the loaded tracks`

### Task 6: Engine DJ keeps the length a trim or resample wrote

**Files:**
- Modify: `apps/desktop/src/main/engineRepoint.ts`
- Test: `apps/desktop/src/main/engineRepoint.test.ts`

**Interfaces:**
- Produces:
  - `engineLengthOf(sampleCount: number, sampleRate: number): number` = `Math.round(sampleCount / sampleRate)` (measured on 23 real rows, spec §4).
  - `writeEngineRepoints` sets `Track.length` whenever the shift carries `sampleCount`.
  - `EngineRepoint.expectTrackData?: { sampleRate: number; sampleCount: number }` — a row whose `trackData` differs is `{ written: false, reason: 'no-match' }`.

- [ ] **Step 1: Failing tests:** a trim repoint with `sampleCount: 13230000` at 44100 leaves `Track.length === 300`; `engineLengthOf(9609216, 44100) === 218`, `(14751744, 44100) === 335`; a repoint with `expectTrackData` that does not match the row writes nothing (row bytes unchanged) and returns `no-match`; with it matching, the shift lands once and a second identical call returns `no-match`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** in the `UPDATE Track` of `writeEngineRepoints` and the match loop.
- [ ] **Step 4: Run, expect PASS**, plus `convertRekordboxCueShift.test.ts` and `src/scenarios/engineTrimCues.test.tsx` green.
- [ ] **Step 5: Commit** `Give Engine DJ the track length a trim or resample wrote`

### Task 7: Where the current audio starts inside a backup

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (`bestLag` takes its reach; new export)
- Test: `apps/desktop/src/main/headOffset.test.ts`

**Interfaces:**
- Produces: `headOffsetMs(original: string, current: string, maxSec: number, signal?: AbortSignal): Promise<number | null>` — ms the current file starts later inside the original, at 44.1 kHz sample precision; null when silent or unrelated. `bestLag(a, b, from, reach = PAIR_RATE)`.

- [ ] **Step 1: Failing test:** from an ffmpeg fixture of pink noise with clicks (not a sine), cut `atrim=start=1.234` into a second file; `headOffsetMs(orig, cut, 3)` is within 0.05 ms of 1234; a resampled 48 kHz cut gives the same within 0.05 ms; an unrelated file gives null. `comparePair` tests stay green.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with `decodePcm` of the first `maxSec + 6` s of both and `bestLag(current, original, 0, maxSec * PAIR_RATE)`; reject a negative lag.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Measure where a trimmed file starts inside its backup`

### Task 8: Engine judge and scan

**Files:**
- Create: `apps/desktop/src/main/engineDamage.ts`
- Test: `apps/desktop/src/main/engineDamage.test.ts`

**Interfaces:**
- Consumes: `engineLengthOf` (Task 6), `headOffsetMs` (Task 7), `decodeTrackData`, `inflateEngineBlob`, `engineRowFinder`, `SurcoTrash.list`.
- Produces:
  - `type EngineJudgement = { kind: 'engine-cues' | 'engine-length'; certainty: 'sure'; trimmedMs: number; sampleRateHz?: number; backup?: { id: string; trashedAt: number } } | { kind: 'engine-cues'; unrepairable: true; missingSec: number }`
  - `judgeEngineRow(row: { sampleRate: number; sampleCount: number; length: number }, file: { sampleRate: number; durationSec: number }, backup: { id: string; trashedAt: number; durationSec: number; headMs: number | null } | null): EngineJudgement | null`
  - `interface EngineDamage { path: string; judgement: EngineJudgement; fileBytes: number; trackData: { sampleRate: number; sampleCount: number } }`
  - `scanEngineDamage(paths: string[], libraryDir: string, deps: { probe: (p: string) => Promise<{ sampleRate: number; durationSec: number } | null>; backups: () => Promise<TrashEntry[]>; headOffsetMs: typeof headOffsetMs; durationOf: (p: string) => Promise<number | null> }): Promise<EngineDamage[]>`

- [ ] **Step 1: Failing tests** for `judgeEngineRow`: 48000/14400000 row vs 44100/300.0 s file → `engine-cues` sure, `trimmedMs: 0`, `sampleRateHz: 44100`; row 44100/13230000 vs file 298.76 s with backup `durationSec: 300.0, headMs: 1240` → `trimmedMs: 1240` with the backup; same without backup → `{ unrepairable: true, missingSec: 1.24 }`; backup whose `headMs` exceeds 1.24 s + 50 ms → unrepairable; row length 299 vs `trackData` 13230000/44100 and file matching → `engine-length`; a healthy row → null; an MP3 off by 0.05 s → null. For `scanEngineDamage` on an `engine3Fixture` m.db: one row per path, NFD path matched, a path with two rows skipped.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Backups match `originalPath === path || outputPath === path`; `headOffsetMs` runs only for a backup whose duration is within `ENGINE_SAME_SEC` of the row's.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Find Engine DJ rows whose positions or length did not follow a trim or resample`

### Task 9: Shared types, scan orchestration and `damage:scan`

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/test/api.ts`, `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/damageScan.ts`, `apps/desktop/src/main/damageIpc.ts`
- Test: `apps/desktop/src/main/damageScan.test.ts`, `apps/desktop/src/main/damageIpc.test.ts`

**Interfaces:**
- Produces (shared):
  - `DamageKind`, `DamageCertainty`, `DamageNote`, `DamageFinding`, `DamageOutcomeState`, `DamageOutcome` exactly as in spec "Datos".
  - `type DamageRepair = { target: 'genre'; path: string; from: string; to: string } | { target: 'traktor'; path: string; volume: string; dir: string; file: string; entryState: string; addMs: number; treeFile?: string } | { target: 'engine'; path: string; fileBytes: number; expectTrackData: { sampleRate: number; sampleCount: number }; trimmedMs: number; sampleRateHz?: number }`
  - `interface DamageScan { findings: DamageFinding[]; unread: ('traktor' | 'engine')[] }`
- Produces (main): `scanDamage(paths: string[], deps: DamageScanDeps): Promise<DamageScan>`; IPC `damage:scan` (invoke, paths) and `pendingDamage: Set<string>` owned by `damageIpc.ts`, marking `pending: true` on re-found ids and dropping ids no longer found.
- Produces (preload): `scanDamage: (paths: string[]) => Promise<DamageScan>`.

- [ ] **Step 1: Failing tests:** with stub scanners, `scanDamage` maps each judgement to a `DamageFinding` (id `kind\0path`, evidence keys `damage.evidence.*` with numbers as params, `before`/`options`), genre `sure` carries `options: [libraryValue]`, `unrepairable` Engine gives `repair: null`; a Traktor scanner that rejects yields `unread: ['traktor']` and the rest of the findings; only paths `mediaAccess.isAllowed` are scanned. In `damageIpc.test.ts`: an id in `pendingDamage` comes back `pending: true`; an id no longer found leaves the set.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, wiring in `index.ts` next to `library:copyInfo` with `rekordboxFlushDeps`/`engineFlushDeps`/`traktorFlushDeps` paths and `getSurcoTrash().list`. Genre scan runs `readGenreFrame` through the worker only for `.mp3 .aiff .aif .wav`.
- [ ] **Step 4: Run, expect PASS.** Typecheck node + web.
- [ ] **Step 5: Commit** `Scan the loaded tracks for damage the v1.18 fixes left behind`

### Task 10: Repairs through the existing writers and queues

**Files:**
- Create: `apps/desktop/src/main/damageRepair.ts`
- Modify: `apps/desktop/src/main/damageIpc.ts` (`damage:repair`), `apps/desktop/src/main/index.ts`, preload files, `renderer/src/test/api.ts`
- Test: `apps/desktop/src/main/damageRepair.test.ts`

**Interfaces:**
- Consumes: `applyListFixes` with `deps.rewrite = (f, c) => rewriteTagFields(f, c, tracking, 'setGenreFrame')`; `flushTraktorSync` with `endNmlBatch: () => patches` and `holdInQueue`; `flushEngineSync` with `endBatch: () => repoints` and the Engine queue as in `flushConversionBatch`; `moments.begin('review')`.
- Produces: `repairDamage(repairs: DamageRepair[], deps: DamageRepairDeps): Promise<DamageOutcome[]>`; IPC `damage:repair`; preload `repairDamage: (repairs: DamageRepair[]) => Promise<DamageOutcome[]>`.

- [ ] **Step 1: Failing tests** with injected deps:
  - Genre: `written` → `repaired` with `backupId`; guard refused → `unchanged`; throw → `failed` with message.
  - Traktor: patch is `{ volume, dir, file, cueShift: { shiftMs: -addMs } }` (assert `shiftMs === -51.18` for `addMs: 51.18`); outcome `open` → every Traktor repair `pending` and its id in `pendingDamage`; `updated` → `repaired`.
  - Engine: repoint has `from === to === path`, `fromBytes`, `expectTrackData`, `engineShift.sampleCount` from the injected exact counter; Engine running → `pending`.
  - `moments.begin('review')` is called once, before the first write, and not at all for an empty list.
  - Real NML end to end: `syncCollection` on a temp NML with the damaged MP3 entry → the entry's Intro is back at `10000.000000`, a second identical repair (stale `entryState`) leaves the NML byte for byte.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Repair damaged genres and library cues through the review's writers and queues`

### Task 11: Repair a converted file's own Traktor tree

**Files:**
- Modify: `apps/desktop/src/main/workerJobs.ts`, `apps/desktop/src/main/musicFieldWrite.ts`, `apps/desktop/src/main/damageRepair.ts`
- Test: `apps/desktop/src/main/musicFieldWrite.test.ts`, `apps/desktop/src/main/damageRepair.test.ts`

**Interfaces:**
- Produces: `rewriteCueTree(file: string, addMs: number, tracking?: TmpTracking): Promise<{ written: boolean; backup?: TrashEntry }>` — copy, `copyCueFrames(file, tmp, { shiftMs: -addMs })` for ID3 containers or `shiftFlacCues(tmp, …)` for FLAC, re-read with `readCueTree` and require every marker moved by `addMs` (else `written: false`, temp dropped), `assertDecodable`, `keepOriginal`, rename. A `traktor` repair with `treeFile` calls it.

- [ ] **Step 1: Failing tests** on a WAV (`injectWavPriv`) and a FLAC fixture: Intro 10000 → 9948.82 for `addMs: -51.18`, backup holds the old tree (`storedTree` sha1), audio stream md5 unchanged; a file with no tree → `written: false`, no backup.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Move a converted file's own Traktor cues by the calibration it missed`

### Task 12: Review source and renderer model

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/damageReview.ts`
- Modify: `apps/desktop/src/renderer/src/lib/reviewSource.ts`, `apps/desktop/src/renderer/src/lib/listReviewSource.ts`
- Test: `apps/desktop/src/renderer/src/lib/damageReview.test.ts`, `apps/desktop/src/renderer/src/lib/listReviewSource.test.ts`

**Interfaces:**
- Produces:
  - `ReviewSource.loadDamage?: () => Promise<DamageScan>` and `ReviewSource.repairDamage?: (repairs: DamageRepair[]) => Promise<DamageOutcome[]>` (list source only).
  - `damageKey(f: DamageFinding): string` = `damage:${f.id}`.
  - `defaultStaged(findings: DamageFinding[]): Set<string>` — `sure`, with a repair, not pending.
  - `repairsOf(findings: DamageFinding[], staged: ReadonlySet<string>, choice: (key: string) => string | null): DamageRepair[]` — genre `to` from the chosen option.
  - `summarizeDamage(repairs: DamageRepair[]): Partial<Record<DamageKind, number>>`
  - `settleDamage(outcomes: DamageOutcome[], rescanned: DamageFinding[]): DamageOutcome[]` — `repaired` still found → `mismatch`.

- [ ] **Step 1: Failing tests** for each function, plus: `listReviewSource().loadDamage()` calls `window.api.scanDamage` with the rows' paths minus unread rows; the Music source has neither method.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Stage damage findings in the list review the way spellings are staged`

### Task 13: Damage in the review hook

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useMusicReview.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useMusicReview.test.ts` (create if absent; else extend `components/MusicReview.test.tsx`)

**Interfaces:**
- Produces on `MusicReview`: `ReviewFilter` gains `'damage'`; `damage: DamageFinding[]`; `damageLoading: boolean`; `damageUnread: ('traktor' | 'engine')[]`; `summary.damage: Partial<Record<DamageKind, number>>`; `ReviewRun.damage?: DamageOutcome[]`.

- [ ] **Step 1: Failing tests:** load resolves spellings before the damage scan resolves (`damageLoading` true meanwhile); `sure` findings are staged on load, `likely` are not; `apply` calls `repairDamage` after `applyFixes` and before the libraries phase, then the verifying reload re-scans and `lastRun.damage` is settled (`mismatch` for a still-found repair); `undo` calls `trashRestore(backupId, 'undo')` for each damage outcome with a backup and sends **no** library tag update for them; ignoring a damage key hides it like a spelling.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with the existing `staged`, `choice`, `hidden`, `fill`, phase and `lastRun` machinery; no new phase names.
- [ ] **Step 4: Run, expect PASS**, and the whole `MusicReview.test.tsx` green.
- [ ] **Step 5: Commit** `Carry damage findings through the review's apply, re-check and undo`

### Task 14: Damage rows, detail, confirmation and summary

**Files:**
- Create: `apps/desktop/src/renderer/src/components/DamageDetail.tsx`
- Modify: `apps/desktop/src/renderer/src/components/MusicReview.tsx`, `apps/desktop/src/renderer/src/components/MusicReviewColumn.tsx`, `apps/desktop/src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR,ja}.json`
- Test: `apps/desktop/src/renderer/src/components/DamageDetail.test.tsx`, `apps/desktop/src/renderer/src/components/MusicReview.test.tsx`

**Interfaces:**
- Consumes: Task 13's hook fields; `Row`, `TonePill`, `FilterOption`, `Sheet`, `Select`.
- Produces testids: `music-review-filter-damage`, `damage-row`, `damage-row-certainty` (`data-tone` good/warn), `damage-row-pending`, `damage-detail`, `damage-before`, `damage-after`, `damage-evidence`, `damage-option`, `damage-stage`, `music-review-confirm-damage-<kind>`, `music-review-done-dest-damage-<file|traktor|engine>`, `damage-undo-note`, `list-review-damage-loading`.
- Copy (es; other five locales translated with the same rules): filter «Daños»; kinds «Género», «Cues de Traktor», «Cues de Engine DJ», «Duración en Engine DJ»; certainty «Seguro», «Probable»; «Pendiente»; «Buscando daños…»; «Ahora», «Queda»; confirm «Se guarda copia de cada fichero y de cada biblioteca en Copias»; done note «Los cues se devuelven desde Copias»; evidence keys from spec §1 to §5 with params.

- [ ] **Step 1: Failing tests:** the filter option exists only for `kind === 'list'`; a `sure` row shows the good pill and is staged, a `likely` one the warn pill and is not; a `repair: null` row has no `damage-stage`; a pending row shows `damage-row-pending` and no stage; the detail lists every evidence line with its numbers formatted for the locale (`51,18` in es); a genre finding with two options renders a `Select` and staging uses the chosen one; the confirm sheet shows one row per kind with its count; the done screen shows one destination row per target touched and the undo note when a library repair ran. `i18n/keys.test.ts` passes for all six locales.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** reusing `ListRow` classes and the existing detail section components; no new visual primitives.
- [ ] **Step 4: Run, expect PASS.** Typecheck web.
- [ ] **Step 5: Commit** `Show damage findings with their certainty and evidence in the list review`

### Task 15: Scenario and inventory

**Files:**
- Create: `apps/desktop/src/scenarios/repairDamage.test.tsx`
- Modify: `docs/funcionalidades.md` (§11 «Revisar metadatos», new paragraph «Daños»; header revision line)
- Test: the scenario itself

- [ ] **Step 1: Failing scenario** on the harness: load a folder with a damaged MP3 genre (Traktor holds `House; Deep House`), a damaged Traktor source entry, and an Engine row resampled 48→44.1 kHz; open the list review, pick «Daños», see three rows (all `sure`, staged), apply with Traktor reported running → genre `repaired`, Traktor `pending`, Engine `repaired`; the file reads `House; Deep House` through ffprobe; the Engine row's quick cue moved by the rate and `length` updated; a Copias backup exists for the genre file and a `review` library copy for Engine; Undo restores the genre only.
- [ ] **Step 2: Run, expect FAIL**, then make it pass with wiring fixes only (no new behavior).
- [ ] **Step 3: Update `docs/funcionalidades.md`** with what the filter finds, the two certainty levels, the guards, and what it does not repair (spec «Fuera de alcance»).
- [ ] **Step 4: Full gate:** `npm test` exit 0, three `tsc` projects, `biome check src`.
- [ ] **Step 5: Commit** `Prove the damage review end to end and list it in the inventory`
