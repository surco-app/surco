# Matriz de resultados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test matrix that runs Surco's real conversion pipeline over copies of real-shaped rekordbox / Engine DJ / Traktor / Apple Music libraries and asserts result invariants with independent readers, and cross-checks that the self-check's verdict is `ok` exactly when those invariants hold.

**Architecture:** Lives inside the existing scenarios harness (`src/scenarios/`), in a new `matrix/` folder. The harness gains an opt-in `verify` mode wired to the same verify registry `index.ts` builds (extracted into `appVerifyRegistry` first), a Traktor queue, real `checkAppleMusic` over a more faithful Music fake, and two sabotage seams. `cells.ts` declares 131 fixed cells in five layers; `run.ts` runs them in batches through `openSurco`; `oracle.ts` judges each result without importing any `verify*` module; `report.ts` writes a Spanish table. 20 core cells run in `npm test`; the rest behind `SURCO_MATRIX=1`, `SURCO_REAL_MUSIC=1`, `SURCO_MATRIX_REAL=1`.

**Tech Stack:** vitest 4 (jsdom for scenarios), React hooks harness, ffmpeg-static + @ffprobe-installer, node-taglib-sharp, better-sqlite3-multiple-ciphers (rekordbox), better-sqlite3 + sql.js (Engine), Traktor NML text.

**Spec:** `docs/superpowers/specs/2026-10-30-matriz-resultados-design.md` (axes §3, cell list §4, invariants §5, fixtures §6, report §7, risks §9, open decisions §10).

## Global Constraints

- Work only in `/Users/vicent/code/surco/.claude/worktrees/matriz-resultados` (branch `matriz-resultados`). Never open the user's real rekordbox / Engine / Traktor / Music libraries for writing; only Task 17 reads them, and only to copy.
- Tests run from `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run src/<path>`. Never from the repo root (setup is skipped; `setup 0ms` and the `--localstorage-file` warning mean a wrong invocation, not a broken test).
- Typecheck all three projects: `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npx tsc --noEmit -p tsconfig.scenarios.json`. Bare `tsc --noEmit` checks nothing. Lint: `npx biome check src`, no new warnings.
- Full suite before each commit: `node ../../node_modules/vitest/vitest.mjs run src`, exit code 0, and grep the output for `FAIL|Errors|Unhandled` (vitest can exit 1 with every test green).
- TDD: show each new test red first. Every oracle check and every sabotage is mutated once (script in the scratchpad, `break`/`restore`) and seen red; a check that stays green under its mutation is not done.
- `oracle.ts` imports nothing from `src/main/verify*.ts`, `tagChanges.ts`, `libraryPathKey.ts`, `verifyIpc.ts`. Expected values come from the `Cell` and the seeded fixture, never from `job.meta`, `FileExpect` or `ProcessResult`.
- Fixtures: real audio from ffmpeg-static under `scenarioDir`, same flags as production; never a pure sine for tags or cues; compare big buffers by sha1, never `toEqual`.
- No `it.skip`, `it.fails`, `--no-verify`. Opt-in files use `describe.skipIf(!process.env.X)` like `applemusicReal.test.ts`.
- Cell names and report text in Spanish, no em dash, no explanatory colon in user-facing strings. Selectors: `data-testid`.
- No new comments beyond the surrounding density; no TODOs. Commits: one English title line, no body, no prefix.
- Core matrix budget: `core.test.tsx` ≤ 25 s wall on the user's Mac; above 30 s cut cells, do not raise timeouts.

## Review Focus

1. **Sabotage that lands before the write proves nothing** (the rekordbox rollback lesson): each sabotage must run after Surco wrote and before it re-reads. Task 11 asserts the sabotaged value is what the registry read.
2. **NFD vs NFC paths** in every oracle reader (SMB names, `Café Olé`): a reader comparing raw strings reports a false "points elsewhere". Tasks 8 and 9 each have an NFD test.
3. **`open` must never pass through `ok` before close**: an `ok` emitted while the program is open is a false ✓. Task 3 records every emitted status, not only the last.
4. **Cue shift measured, not assumed**: `markerLagMs` on MP3 (encoder delay, Xing) differs per encoder; a hardcoded 0 or 25.06 hides double shifts. Task 8 tests mp3x and mp3n separately.
5. **Original files of the real collections**: any write to them is catastrophic. Task 16 asserts sha1 + mtime of every original before and after, failing first.

---

### Task 1: Extract `appVerifyRegistry` from `index.ts`

Behavior-preserving refactor so the harness builds the same registry production does.

**Files:**
- Modify: `apps/desktop/src/main/verifyIpc.ts` (add export)
- Modify: `apps/desktop/src/main/index.ts:531-577` (call it)
- Test: `apps/desktop/src/main/verifyIpc.test.ts`

**Interfaces:**
- Produces:
```ts
export interface AppVerifyOptions {
  paths: { rekordbox: () => string; engine: () => string; traktor: () => string }
  queues: Parameters<typeof libraryRequeue>[0]
  emit: VerifyRegistryDeps['emit']
  readMusic: VerifyRegistryDeps['readMusic']
  realPath: (p: string) => string
  bootVolume: () => string
}
export function appVerifyRegistry(o: AppVerifyOptions): ReturnType<typeof createVerifyRegistry>
```

- [ ] **Step 1: Write the failing test** `describe('appVerifyRegistry')` › `it('reads rekordbox at the path it is handed, after a flush, and emits ok for a repointed row')`: build a rekordbox fixture with `makeRekordbox` (import from `../scenarios/rekordboxFixture`), register one `VerifyEntry` whose `to` is a real file and whose row was already moved with a direct UPDATE, call `afterFlush({ rekordbox: 'written', engine: 'off', traktor: 'off' })`, expect the emitted verification `status: 'ok'` with a `rekordbox` check `rekordboxOk`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/verifyIpc.test.ts` — FAIL, `appVerifyRegistry is not a function`.
- [ ] **Step 3: Implement** by moving the object literal from `index.ts` verbatim (readers, `readFile: checkFile(e, fileReaders)`, requeue, `exists` via `access`, `samePath` via `pathKey`). `index.ts` passes its queues, `rekordboxCollectionPath`/`engineLibraryPath`/`traktorWritePath`, `verifyUpdateSender(...)`, the darwin `readMusic` and `bootVolumeName`.
- [ ] **Step 4: Run** the test (PASS), the whole suite and the three tsc projects.
- [ ] **Step 5: Commit** `git commit -m "Build the verify registry in one place for the app and the scenarios"`

### Task 2: Harness `verify` mode for rekordbox and Engine

**Files:**
- Modify: `apps/desktop/src/scenarios/harness.tsx` (`ScenarioOptions`, `bootMain`, `scenarioApi`, `processTrackInMain`, `Scenario`)
- Test: `apps/desktop/src/scenarios/verifyWired.test.tsx`

**Interfaces:**
- Consumes: `appVerifyRegistry` (Task 1), `snapshotLibraries`, `queueVerification`, `recordedRekordboxRepoint`, `recordedNmlPatch` as `index.ts:1896-1913` uses them.
- Produces:
```ts
interface ScenarioOptions { verify?: boolean; sabotage?: Sabotage }
interface Sabotage {
  afterConvert?: (finalPath: string) => void | Promise<void>
  beforeLibraryCheck?: () => void | Promise<void>
}
interface Scenario {
  verification: (fileName: string) => Verification | undefined
  statuses: (fileName: string) => Verification['status'][]
  settled: () => Promise<void>
  retry: (fileName: string) => Promise<'rerun-job' | 'rechecked'>
}
```
`settled` resolves when every converted track's status is neither `checking` nor `undefined` and all `flushes` resolved; `statuses` is every status the renderer received, in order.

- [ ] **Step 1: Failing tests** in `verifyWired.test.tsx` (jsdom, mocks as `replaceInLibrary.test.tsx`):
  - `it('says ok for a FLAC converted to AIFF once rekordbox and Engine point at it')`: one FLAC in a `makeRekordbox` row and in an Engine fixture (`writeEngineLibraryFixture` + `analysedTrack`), `openSurco({ verify: true, settings: { outputFormat: 'aiff', syncRekordbox: true, rekordboxDbPath, syncEngineDj: true, engineLibraryDir }, destination: 'folder' })`, `convertAll()`, `settled()`; expect `verification('x.flac')?.status === 'ok'` and checks `['file','rekordbox','engine']` all `ok`.
  - `it('says mismatch when rekordbox was put back on the old file before it was read')`: `sabotage.beforeLibraryCheck` UPDATEs `FolderPath` back; expect `mismatch` with detail `rekordboxStillOld`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/verifyWired.test.tsx` — FAIL (`verification` undefined).
- [ ] **Step 3: Implement.** With `verify`, `processTrackInMain` passes `snapshotLibraries`, `registerVerification` (with `recordedNmlPatch`/`recordedRekordboxRepoint` as in `index.ts`) and `realPath`; it wraps `convertAudio` so `sabotage.afterConvert(output)` runs after it resolves. `endConversionBatch` takes `registry.cut()`, awaits the flush and the queue applies, runs `sabotage.beforeLibraryCheck`, then `registry.afterFlush(outcome, upTo)`. The in-memory queues' `repoint`/apply call `queueChecks.repointed`/`settled` like `index.ts:324-352`. `onVerifyUpdate` subscribes to the registry `emit`. Without `verify`, every existing path stays as it is.
- [ ] **Step 4: Mutation**: drop the `afterFlush` call; the first test must go red (stays `checking`, `settled` times out). Restore.
- [ ] **Step 5: Run** the new file, then all of `src/scenarios` (no existing scenario changes result), the three tsc projects.
- [ ] **Step 6: Commit** `git commit -m "Let a scenario read back what the self-check said after the batch"`

### Task 3: Traktor queue, open programs and retry in the harness

**Files:**
- Modify: `apps/desktop/src/scenarios/harness.tsx`
- Test: `apps/desktop/src/scenarios/verifyWired.test.tsx`

**Interfaces:**
- Produces: `Scenario.traktorClosed(): Promise<void>`; the in-memory Traktor queue passed as `flushConversionBatch`'s 4th argument (built like `index.ts:464` with `storeInMemory()`).
- Consumes: `isRekordboxRunning`, `isEngineDjRunning`, `isTraktorRunning` as `vi.fn` mocks in the test file.

- [ ] **Step 1: Failing tests:**
  - `it('keeps a track pending, never ok, while rekordbox is open, and ok once it is closed')`: `isRekordboxRunning` → `true`, convert, `settled()`, expect last status `pending`; flip to `false`, `rekordboxClosed()`, `settled()`; expect `statuses(name)` contains no `ok` before the last entry and the last is `ok`.
  - `it('points Traktor at the AIFF and says ok when Traktor was closed')`: NML built as `traktorCollection.test.tsx` builds it, `syncTraktor: true`; expect Traktor check `traktorOk`.
  - `it('waits for Traktor when it is open and applies on close')`: same with `isTraktorRunning` → `true`, then `traktorClosed()`.
  - `it('rechecks on retry after the collection could not be read, without moving the cues again')`: `beforeLibraryCheck` renames `master.db` away, expect `mismatch` (`rekordboxUnreadable`); rename back; `retry(name)` resolves `'rechecked'`, status `ok`, `rekordboxRow(db, id).cuesMs` equal to the seeded ones.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the Traktor queue and `traktorClosed`; `retry` calls `registry.retry(trackId)` and, for `'rerun-job'`, the renderer's retry path (`useTrackProcessing`'s retry).
- [ ] **Step 4: Mutation**: make `afterQueueWaits` a no-op in the harness wiring; the open-rekordbox test must go red. Restore.
- [ ] **Step 5: Run** file + `src/scenarios` + tsc ×3. **Commit** `git commit -m "Run Traktor's queue and open programs through the scenario harness"`

### Task 4: Music fake gains the measured facts

**Files:**
- Modify: `apps/desktop/src/scenarios/fakeMusic.ts`
- Modify: `apps/desktop/src/scenarios/harness.tsx` (`markAppleMusicReplacing`, `appleMusicPlaylists`, `verifyMusic` through the fake when `musicIsFake`)
- Create: `apps/desktop/src/scenarios/musicFacts.ts`
- Test: `apps/desktop/src/scenarios/fakeMusic.test.ts`

**Interfaces:**
- Produces (`musicFacts.ts`), assertions shared by the fake and the real app:
```ts
export interface MusicUnderTest {
  add: (path: string, meta: TrackMetadata) => Promise<string>
  markReplacing: (pid: string, label: string) => Promise<string>
  location: (pid: string) => Promise<string>
  tagGrouping: (pid: string, grouping: string) => Promise<void>
  mediaFolder: () => Promise<string | null>
}
export const MUSIC_FACTS: { name: string; check: (m: MusicUnderTest, dir: string) => Promise<void> }[]
```
Facts, one each: `add of a same-named track in another format hands back the existing entry`; `marking the old entry replacing lets the add create a new one`; `a WAV copied into the media folder lands under Unknown Artist/Unknown Album`; `a file already inside the media folder is added where it is`; `tagging rewrites Music's own copy`; `editing grouping of an MP3 writes GRP1 and leaves TIT1`.
- Fake: `readMusicEntryFacts` and `musicFileEntries` answer from `state` so `checkAppleMusic(e, musicReaders)` runs unchanged.

- [ ] **Step 1: Failing test** `describe('the Music fake keeps the facts measured on 30/10')` iterating `MUSIC_FACTS` against a `MusicUnderTest` built on the fake; plus `it('lets checkAppleMusic read an entry it added')`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/fakeMusic.test.ts` — FAIL.
- [ ] **Step 3: Implement** in the fake. Then run all of `src/scenarios`. **If an existing scenario turns red**, stop: that is the matrix's first finding (the old fake hid it). Record which and why in the task report; do not change the scenario's expectation to green it.
- [ ] **Step 4: Commit** `git commit -m "Make the Music fake behave as Music was measured to"`

### Task 5: Same Music facts against the real app

**Files:**
- Modify: `apps/desktop/src/main/applemusicReal.test.ts`

- [ ] **Step 1:** Add `describe.skipIf(!real)('the Music facts hold in the real app')` iterating `MUSIC_FACTS` with a `MusicUnderTest` over `addToAppleMusic`, `markAppleMusicReplacing`, `appleMusicEntryLocation`, the real grouping write, `appleMusicMediaFolder`; tracks named with `PREFIX`, cleaned in the existing `afterAll`.
- [ ] **Step 2:** Run without the variable (skipped, suite green), then `SURCO_REAL_MUSIC=1 node ../../node_modules/vitest/vitest.mjs run src/main/applemusicReal.test.ts` on the Mac: all pass. A fact that fails in the real app is fixed in the fake (Task 4 file), never in `MUSIC_FACTS` to match the fake.
- [ ] **Step 3: Commit** `git commit -m "Hold the Music fake to the real app on the same facts"`

### Task 6: Cell list and coverage proof

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/cells.ts`
- Test: `apps/desktop/src/scenarios/matrix/cells.test.ts`

**Interfaces:**
- Produces:
```ts
export type Origin = 'wav16' | 'wav24' | 'aif' | 'aiff' | 'flac' | 'alac' | 'aac' | 'mp3x' | 'mp3n' | 'mp3j'
export type FileDest = 'folder' | 'beside' | 'overwrite' | 'appleMusic' | 'appleMusicCopy'
export type Programs = 'rekordbox' | 'engine' | 'traktor' | 'music' | 'all'
export type CellState = 'closed' | 'open' | 'retry'
export type Quality = 'source' | 'rate48' | 'bits16' | 'normalize' | 'trim'
export type InvariantName = 'format' | 'pcm' | 'points' | 'cues' | 'playlists' | 'tags' | 'cover' | 'unique' | 'collateral'
export type SabotageId = string
export interface Cell {
  id: string
  layer: 'C' | 'D' | 'Q' | 'K' | 'S'
  name: string
  origin: Origin
  target: OutputFormat
  dest: FileDest
  programs: Programs
  state: CellState
  quality: Quality
  settings?: Partial<Settings>
  sabotage?: SabotageId
  expectedKey?: VerifyDetailKey
  expectBroken?: { invariant: InvariantName; why: string }[]
  core: boolean
}
export const CELLS: Cell[]
export interface CellGroup { key: string; cells: Cell[] }
export function groupsOf(cells: Cell[]): CellGroup[]
export function qualitySettings(q: Quality): Partial<Settings>
```
Layers and counts exactly as spec §4: C 50, D 28 (hand-written covering array), Q 12, K 14 (K01–K14 as the spec table), S 27 (one per listed key plus 3 blind spots with `expectBroken` and no `expectedKey`). `core: true` on the 20 cells spec §4 lists. `groupsOf` groups cells sharing `target, dest, programs, state, quality, settings` and no sabotage; each sabotaged cell is its own group. `qualitySettings`: `rate48` → `{ outputSampleRate: '48000' }`, `bits16` → `{ outputBitDepth: '16' }`, `normalize` → the default normalize mode used by `normalizePlan.test.tsx`, `trim` → trim applied as `trimCues.test.tsx` does; all also set `keepMp3Sources: false` except K13.

- [ ] **Step 1: Failing tests:**
  - `it('has 131 cells with unique ids')` and counts per layer `{ C: 50, D: 28, Q: 12, K: 14, S: 27 }`.
  - `it('covers every pair of values of any two D factors')` over dest × programs × state × conversion class.
  - `it('never sends FLAC to Music or Music to a non-Music destination')`.
  - `it('names a reachable detail key for every sabotage that is not a blind spot')` (`VERIFY_DETAIL_KEYS.includes`).
  - `it('keeps 20 cells in the core and none with a known open bug')` (no `K07`, no blind spot).
  - `it('runs layer C as five batches of ten')` (`groupsOf` on layer C).
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/cells.test.ts` — FAIL; implement; PASS.
- [ ] **Step 3: Commit** `git commit -m "Declare the results matrix cells and prove their pairwise coverage"`

### Task 7: Source fixtures

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/sources.ts`
- Test: `apps/desktop/src/scenarios/matrix/sources.test.ts`

**Interfaces:**
- Produces:
```ts
export const MARKER_SEC = 10
export interface TrickyTags { title: string; artist: string; album: string; genre: string; grouping: string; trackNumber: string; discNumber: string; bpm: string; key: string; publisher: string; catalogNumber: string; comment: string }
export const TRICKY: TrickyTags // title 'Café Olé', artist 'AC/DC', genre 'House; Deep House', grouping 'Peak Time', trackNumber '3/12', discNumber '1/2', bpm '124', key '8A', comment '🔥 promo'
export const SEEDED_CUES_MS: number[] // [MARKER_SEC * 1000, 15000]
export interface SourceTrack { origin: Origin; path: string; tags: TrickyTags; coverSha1: string; cuesMs: number[] }
export function makeSource(dir: string, origin: Origin, opts?: { leadSilenceSec?: number; fileName?: string; tags?: Partial<TrickyTags> }): SourceTrack
```
20 s `kick` signal plus a one-sample click at 0.8 FS at `MARKER_SEC` (+ `leadSilenceSec`); filename in NFD; `wav24` 24-bit 96 kHz; `mp3x` `-write_xing 1`, `mp3n` `-write_xing 0`, `mp3j` a Lyrics3 block and 512 zero bytes before the first frame; `alac`/`aac` in `.m4a`; TRAKTOR4 cues and cover as `fixtures.ts`'s `makeTrack` does.

- [ ] **Step 1: Failing test** `it.each(ORIGINS)('makes a %s that is what it says')`: ffprobe container/codec/rate/bits as declared; Xing present only in `mp3x` (look for `Xing`/`Info` in the first frame); `mp3j` first bytes not `ID3`/frame sync; the click found at `MARKER_SEC` ± 1 sample by decoding; title read back NFC `Café Olé`; filename bytes NFD.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/sources.test.ts` — FAIL; implement; PASS.
- [ ] **Step 3: Commit** `git commit -m "Make every source format the matrix converts, with a timing marker and hard tags"`

### Task 8: Oracle for the file

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/oracle.ts`
- Test: `apps/desktop/src/scenarios/matrix/oracle.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Broken { invariant: InvariantName; detail: string }
export function markerLagMs(source: string, output: string): number
export function pcmSha1(path: string): string
export function fileInvariants(cell: Cell, source: SourceTrack, finalPath: string, expectedCoverSha1: string | null): Broken[]
```
Rules from spec §5.1, §5.2, §5.6. `pcmSha1` = ffmpeg `-f s32le` raw + node sha1. Tag reads at frame level with TagLib (`TIT1`, `GRP1`, `TRCK`, `TPOS`, `TCON`, `TPE1` frames; Xiph `GROUPING`, `TRACKNUMBER`, `TRACKTOTAL`; `©grp`, `trkn`, `disk`), plus ffprobe for title/artist/album/track/disc. `detail` strings Spanish, e.g. `"grouping: TIT1 'Peak Time', GRP1 ausente"`.

- [ ] **Step 1: Failing tests**, each with a file built by `makeSource` then altered by hand:
  - `it('passes an AIFF made from a FLAC that kept the samples')`
  - `it('fails format for a FLAC that was only re-tagged under an .aiff name')`
  - `it('fails pcm when one sample changed')`
  - `it('fails tags when an MP3 has TIT1 but no GRP1')` and `it('fails tags when a WAV carries a GRP1')`
  - `it('fails tags for track 312 instead of 3/12, and disc 0 instead of 1/2')`
  - `it('fails tags when AC/DC came back as two artists')`
  - `it('finds an NFD-named output asked for by its NFC name')`
  - `it('measures the lag of a 2 s trim as -2000 ms')`, `it('measures mp3x and mp3n lags separately')` (assert each against a hand ffmpeg measurement recorded in the test, not against each other)
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/oracle.test.ts` — FAIL; implement; PASS.
- [ ] **Step 3: Mutations**: compare PCM by duration only; read grouping through `file.tag.grouping`; skip NFC in the lookup. Each must turn a test red. Restore.
- [ ] **Step 4: Commit** `git commit -m "Judge a converted file without the self-check's readers"`

### Task 9: Library fixtures and their oracle

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/libraries.ts`
- Modify: `apps/desktop/src/scenarios/rekordboxFixture.ts` (seed `fileSize`, `analysisDataPath`, `analysed`; `rekordboxRow` returns them)
- Modify: `apps/desktop/src/scenarios/matrix/oracle.ts`
- Test: `apps/desktop/src/scenarios/matrix/libraries.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SeededTrack extends SourceTrack { rekordboxId: string; engineId: number; traktorAudioId: string; musicPid?: string; playlists: { rekordbox: string[]; engine: number[]; traktor: string[]; music: string[] } }
export interface LibrarySet { root: string; rekordboxDb?: string; engineDir?: string; traktorNml?: string; music: boolean; bystander: SeededTrack; tracks: SeededTrack[]; settings: Partial<Settings>; sha1Before: Record<'rekordbox' | 'engine' | 'traktor', string | null> }
export function buildLibraries(root: string, programs: Programs, sources: SourceTrack[], extra?: { nfdRow?: boolean; twinRows?: boolean }): LibrarySet
export interface Expected { finalPath: string; lagMs: number; samplesKept: boolean; destGone: boolean }
export function libraryInvariants(cell: Cell, set: LibrarySet, track: SeededTrack, expected: Expected): Broken[]
```
Each track: 2 playlists per program, `SEEDED_CUES_MS` as rekordbox `djmdCue`, Engine `analysedTrack` quickCues, Traktor `CUE_V2`; one bystander track. Traktor playlists by `PRIMARYKEY` built with `toNmlLocation` for seeding only. `libraryInvariants` implements spec §5.3–§5.5, §5.7, §5.8 with its own SQL / NML parsing; Engine blobs decoded with `engineBlobs.ts`; NFC + `realpathSync` comparison written in the oracle.

- [ ] **Step 1: Failing tests:**
  - `it('builds a set whose oracle passes untouched against the sources')` with `finalPath = source.path`.
  - one test per broken case, each altering the copy by hand: `FolderPath` old, `FileType` stale, `FileSize` wrong, cue +500 ms, `djmdSongPlaylist` row deleted, `AnalysisDataPath` emptied with `samplesKept`, Engine `quickCues` changed, Traktor `FILE` old, Traktor `PRIMARYKEY` dangling, second rekordbox row on the new path, bystander cue moved (`collateral`), unsynced library byte-changed (`collateral`).
  - `it('treats an NFD FolderPath as the same file')`, `it('resolves twin rows through the ~/Music/Music link as one file')`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/libraries.test.ts` — FAIL; implement; PASS. Then `src/scenarios` (the `rekordboxFixture` change keeps old callers green).
- [ ] **Step 3: Mutations**: compare cue count instead of positions; skip the bystander. Red each. Restore.
- [ ] **Step 4: Commit** `git commit -m "Seed real-shaped libraries for the matrix and judge them independently"`

### Task 10: Group runner and report

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/run.ts`, `apps/desktop/src/scenarios/matrix/report.ts`
- Test: `apps/desktop/src/scenarios/matrix/report.test.ts`, `apps/desktop/src/scenarios/matrix/run.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface CellOutcome { cell: Cell; finalPath: string; broken: Broken[]; verdict: Verification | undefined; statuses: Verification['status'][] }
export type Agreement = 'green' | 'honestBug' | 'falseOk' | 'falseAlarm'
export function agreement(o: CellOutcome): Agreement
export function cellFailure(o: CellOutcome): string | null
export function renderReport(outcomes: CellOutcome[], at: Date): string
export function writeReport(outcomes: CellOutcome[]): string
export async function runGroup(group: CellGroup): Promise<CellOutcome[]>
```
`agreement` follows spec §5.9: green when no unexpected broken and `ok`, or broken exactly as `expectBroken`/sabotage and not `ok` with `expectedKey` among checks (and for `open`, no `ok` in `statuses` before close). `renderReport` = spec §7 table plus the four counts. `writeReport` writes `SURCO_MATRIX_REPORT` or `<scenarioRoot>/matriz-YYYY-MM-DD.md`, prints the path, returns it. `runGroup`: `makeSource` per cell, `buildLibraries`, `openSurco({ verify: true, ... })` with `fromDestination`-mapped dest (`appleMusicCopy` = `appleMusic` + `keepOutputCopy: true`), Music-destination cells driven by `convertInEditor` as `replaceInLibrary.test.tsx`, others by `drop` + `convertAll('confirm', target)`; state handling per Task 3; then `fileInvariants` + `libraryInvariants`.

- [ ] **Step 1: Failing pure tests** in `report.test.ts`: `it('calls a broken result with ok the worst case')` (`falseOk`), `honestBug`, `falseAlarm`, `green`; `it('writes one row per cell with a footnote per broken invariant')` checking the Spanish header row of spec §7 verbatim.
- [ ] **Step 2: Failing integration test** in `run.test.tsx`: `it('runs one closed FLAC to AIFF cell green')` with the C cell `flac→aiff` from `CELLS`.
- [ ] **Step 3: Run** both — FAIL; implement; PASS.
- [ ] **Step 4: Commit** `git commit -m "Run a matrix batch through the real pipeline and report it as a table"`

### Task 11: Sabotage catalogue

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/sabotage.ts`
- Modify: `apps/desktop/src/scenarios/matrix/run.ts` (pass `SABOTAGES[cell.sabotage]` as `ScenarioOptions.sabotage`)
- Test: `apps/desktop/src/scenarios/matrix/sabotage.test.tsx`

**Interfaces:**
- Produces: `export const SABOTAGES: Record<SabotageId, (set: LibrarySet, track: SeededTrack) => Sabotage>` with the 27 ids of spec §4 layer S (`fileMissing`, `fileWrongFormat`, ..., `traktorAmbiguous`, `blindRekordboxCueMoved`, `blindRekordboxPlaylistLink`, `blindTraktorPlaylistKey`). File sabotages use `afterConvert`; Music and library ones `beforeLibraryCheck` (Music ones mutate `music.state`).

- [ ] **Step 1: Failing test** `it.each(sabotageIds)('%s is seen by the oracle and lands where the self-check reads')`: run the cell; expect `broken` non-empty; for non-blind ids expect `verdict.checks` to include `expectedKey`; and assert the value the registry read is the sabotaged one by re-reading the library right after `settled()` (guards Review Focus 1).
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/sabotage.test.tsx` — FAIL; implement; PASS. Blind spots: expect `agreement === 'falseOk'` in this test (they document today's gap; the matrix cell itself stays red per spec §10).
- [ ] **Step 3: Mutation**: run `beforeLibraryCheck` before the flush instead of after; the rekordbox sabotages must go red. Restore.
- [ ] **Step 4: Commit** `git commit -m "Break results on purpose to prove the self-check sees each failure"`

### Task 12: Core matrix in the normal suite

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/core.test.tsx`

- [ ] **Step 1:** `describe.skipIf(process.platform !== 'darwin')('Matriz de resultados (núcleo)')`: `for (const group of groupsOf(CELLS.filter(c => c.core)))` a `describe(group.key)` whose `beforeAll` runs `runGroup` (timeout 120 s), one `it(cell.name)` per cell asserting `cellFailure(outcome)` is `null` (`expect(cellFailure(o)).toBeNull()` so the Spanish message is the failure). `afterAll` calls `writeReport`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/core.test.tsx` and time it. Every red cell: classify fixture / pipeline / checker before anything else. A fixture red is fixed in the fixture; a pipeline or checker red means the cell does not belong in the core: report it and move it out (`core: false`) with the reason in the task report, never weaken its assertion.
- [ ] **Step 3: Budget**: wall time ≤ 25 s; above 30 s drop the slowest core cells (keep one per invariant). Record the measured time.
- [ ] **Step 4: Full suite** + tsc ×3 + biome. **Commit** `git commit -m "Run the core of the results matrix with every test run"`

### Task 13: Full opt-in matrix

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/full.test.tsx`
- Modify: `apps/desktop/package.json` (script `"matrix": "SURCO_MATRIX=1 vitest run src/scenarios/matrix/full.test.tsx"`)

- [ ] **Step 1:** Same shape as `core.test.tsx` over all `CELLS`, `describe.skipIf(!process.env.SURCO_MATRIX || process.platform !== 'darwin')`.
- [ ] **Step 2:** Run without the variable: skipped, suite unchanged. **Commit** `git commit -m "Add the full results matrix behind SURCO_MATRIX"`

### Task 14: Run the full matrix and triage

- [ ] **Step 1:** `cd apps/desktop && npm run matrix`. Record wall time and the report path.
- [ ] **Step 2:** For each non-green cell, write one line in the task report: id, agreement class, broken invariants, and the classification (fixture / pipeline / checker), with the evidence that decides it (reproduce by hand with the same ffmpeg flags production uses before calling it a pipeline bug). Fix fixture causes in their task's file with a commit `Fix the matrix fixture for <cell>`; do not fix pipeline or checker bugs here.
- [ ] **Step 3:** Re-run until only pipeline/checker reds remain. Deliver the final report path and the list to the controller.

### Task 15: Music cells against the real app

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/music.test.tsx`

- [ ] **Step 1:** `describe.skipIf(process.env.SURCO_REAL_MUSIC !== '1')` running K01–K03 and the 5 Music sabotages with the real `applemusic` module (no `vi.mock` of it) and `musicReaders`; every entry titled with a random prefix and deleted in `afterAll` like `applemusicReal.test.ts`; never a track from the user's library.
- [ ] **Step 2:** Run without the variable (skipped). Then `SURCO_REAL_MUSIC=1 node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/music.test.tsx`; compare with the fake's outcome for the same cells; any difference means Task 4's fake is wrong: report it.
- [ ] **Step 3: Commit** `git commit -m "Run the Music cells of the matrix against the real app on request"`

### Task 16: Copies of real collections

**Files:**
- Create: `apps/desktop/src/scenarios/matrix/realLibraries.ts`, `apps/desktop/src/scenarios/matrix/real.test.tsx`
- Test: `apps/desktop/src/scenarios/matrix/realLibraries.test.ts`

**Interfaces:**
- Produces:
```ts
export interface RealSources { rekordboxDb?: string; engineDir?: string; traktorNml?: string }
export interface RealCopy { set: LibrarySet; originals: { path: string; sha1: string; mtimeMs: number }[]; rewrites: string[] }
export function realSourcesFromEnv(): RealSources
export async function copyRealLibraries(src: RealSources, root: string, perFormat?: number): Promise<RealCopy>
export function assertOriginalsUntouched(copy: RealCopy): void
```
Steps exactly spec §6.5: SQLite backup API from a `readonly` open; `chmod 644`; sample up to `perFormat` (default 3) tracks per format with an existing file, ≥1 cue, ≥1 playlist, excluding `FileType 25`; 2 twin rows and 2 NFD names when present; audio copied into `root/espejo/<original path>` byte-exact names; `~/Music/Music` link recreated inside the mirror; prefixes rewritten only in the copies, each rewrite logged in `rewrites`.

- [ ] **Step 1: Failing tests** on a synthetic "real-shaped" source made by `buildLibraries` in a separate tmp dir (never the user's): `it('copies without changing a byte or mtime of the originals')`, `it('leaves the copies writable even when the original is read-only')` (original `chmod 444`), `it('keeps NFD file names byte for byte in the mirror')`, `it('never samples a streaming row')`.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/realLibraries.test.ts` — FAIL; implement; PASS.
- [ ] **Step 3:** `real.test.tsx`: `describe.skipIf(!process.env.SURCO_MATRIX_REAL)`, `beforeAll` copies, runs layer C and D cells whose origin exists in the sample (origin chosen by the sampled file's format), `afterAll` calls `assertOriginalsUntouched` first, then `writeReport`, then removes the root unless `SURCO_MATRIX_KEEP=1`.
- [ ] **Step 4: Commit** `git commit -m "Run the matrix on copies of real collections without touching the originals"`

### Task 17 (controller): Matrix on copies of the user's collections

Run by the controller, not a subagent, with the user's say-so in this session.

- [ ] **Step 1:** Check rekordbox, Engine DJ and Traktor are closed (`pgrep -x rekordbox`, `pgrep -x "Engine DJ"`, `pgrep -x "Traktor"`); if one is open, ask the user to close it, do not continue.
- [ ] **Step 2:** Record sha1 + mtime of `master.db`, `Database2/m.db`, `collection.nml` in the scratchpad by hand.
- [ ] **Step 3:** `cd apps/desktop && SURCO_MATRIX_REAL=1 SURCO_MATRIX_REPORT=<scratchpad>/matriz-real.md node ../../node_modules/vitest/vitest.mjs run src/scenarios/matrix/real.test.tsx` (paths from env if not detected).
- [ ] **Step 4:** Re-check the sha1 + mtime from Step 2 by hand; any difference is reported to the user immediately, before anything else.
- [ ] **Step 5:** Publish the report to the user (what passed, the reds by class, which ones need a decision) and write the memory note `matriz-resultados` with the counts, runtime and the open reds.
