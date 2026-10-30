# Comprobación tras convertir (autocomprobación) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every `process:track`, Surco re-reads the file it wrote and every library it touched (Apple Music, rekordbox, Engine DJ, Traktor) and only then shows the success line; anything that does not add up is shown in amber with "Reintentar", is counted and filterable in a batch, and blocks the trash offer for the superseded file.

**Architecture:** All checks run in main as small pure-ish functions over injected readers (`verifyFile`, `verifyPcm`, `verifyMusic`, `verifyRekordbox`, `verifyEngine`, `verifyTraktor`). `runProcessTrack` snapshots the source's library rows before converting, `convertAudio` digests the source PCM before its rename, and the job ends with an inline `'verify'` stage that checks the file and Music and returns `ProcessResult.verification`. Library places are checked after `flushConversionBatch` and after each queue apply by a registry in main, which emits `verify:update`. The renderer stores `TrackItem.verification` and renders footer states, the shield popover, the amber line, the batch summary, the "No cuadran" filter and the trash gate from it.

**Tech Stack:** Electron main + React 19 renderer (TS), vitest, ffmpeg-static, TagLib (tags.ts), better-sqlite3-multiple-ciphers (rekordbox), sql.js (Engine), osascript (Music), i18next (6 locales).

**Spec:** `docs/superpowers/specs/2026-10-30-autocomprobacion-design.md` (data shape, check list per place, Reintentar, trash gate, risks, open decisions).

## Global Constraints

- Work only in `/Users/vicent/code/surco/.claude/worktrees/autocomprobacion` (branch `autocomprobacion`). Never touch the main checkout or the user's real Music / rekordbox / Engine / Traktor libraries except in Task 20 (driver, with backups).
- Tests from `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run src/<path>.test.ts[x]`. Never filter by path from the repo root (the setup is skipped there).
- Typecheck: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json` (bare `tsc --noEmit` checks nothing). Lint: `npx biome check src`, no new warnings.
- TDD: each new test is shown failing first. Then mutate the implementation once per contract position (script in the scratchpad, `break`/`restore`) and see the test go red; a test that stays green under its mutation is not done.
- Mocks of `window.api` are `vi.fn<Api['method']>()`, never bare `vi.fn()`.
- Fixtures: real audio from ffmpeg in `testTmpRoot`, never a sine for anything that reads tags or cues; compare big buffers by sha1, never `toEqual`.
- UI copy: tuteo in every locale, no em dash, no explanatory colon, Apple-minimal (no text that repeats another element). Places not touched are never listed. Selectors: `data-testid`.
- No new comments beyond the density of the surrounding file. No TODOs.
- Commit: one English title line, no body, no prefix.

## Review Focus

1. **The source digest is taken before the rename.** In an in-place conversion the source path IS the output after `renameWithRetry`; a digest taken after compares the output with itself and always passes. Task 4 has a test that fails on exactly that mutation.
2. **`verificationStatus` priority**: `mismatch`/`unreadable` beat `checking` beat `pending` beat `ok`. A wrong order shows ✓ with a check still running. Task 1.
3. **Trash gate fails closed**: no `verification` or `pending` → no offer. Task 16.
4. **Paths compared NFC + realpath** in every reader (the `~/Music/Music` symlink; NFD from SMB). Each reader task has an NFD test.
5. **Queued is not failed**: a flush `blocked` by the app being open must give `pending`, never `mismatch`. Task 10.
6. **Music async import**: the Music check retries an empty location before saying mismatch, and never retries forever. Task 6.

---

### Task 1: Shared verification types and status reducer

**Files:**
- Create: `apps/desktop/src/shared/verification.ts`
- Test: `apps/desktop/src/shared/verification.test.ts`
- Modify: `apps/desktop/src/shared/types.ts` (`ProcessResult.verification?: Verification`; `ProcessStage` += `'verify'`)

**Interfaces (produces):**
```ts
export type VerifyPlace = 'file' | 'appleMusic' | 'rekordbox' | 'engine' | 'traktor'
export type CheckState = 'checking' | 'ok' | 'mismatch' | 'pending' | 'unreadable'
export interface CheckDetail { key: string; params?: Record<string, string | number> }
export interface PlaceCheck { place: VerifyPlace; state: CheckState; detail: CheckDetail }
export interface Verification { status: 'checking' | 'ok' | 'mismatch' | 'pending'; checks: PlaceCheck[] }
export function verificationStatus(checks: PlaceCheck[]): Verification['status']
export function withChecks(v: Verification, replace: PlaceCheck[]): Verification
export const PLACE_ORDER: VerifyPlace[]
```
`withChecks` replaces checks by place, keeps the others, re-sorts by `PLACE_ORDER`, recomputes status.

- [ ] Step 1: tests in `describe('verificationStatus')`:
  - `all ok is ok`
  - `a mismatch wins over a check still running` (`[mismatch, checking]` → `'mismatch'`)
  - `unreadable reads as mismatch` (`[ok, unreadable]` → `'mismatch'`)
  - `checking wins over pending` (`[pending, checking]` → `'checking'`)
  - `pending is not ok` (`[ok, pending]` → `'pending'`)
  - `nothing checked yet is checking, never ok` (`[]` → `'checking'`)
  - `withChecks replaces one place and keeps the rest in place order`
- [ ] Step 2: run `node ../../node_modules/vitest/vitest.mjs run src/shared/verification.test.ts` → FAIL (module missing).
- [ ] Step 3: implement; Step 4: PASS; mutate the priority order, see red.
- [ ] Step 5: commit `Add the verification result shape and its status rule`

### Task 2: `pcmDigest`, the decoded-audio fingerprint

**Files:** Create `apps/desktop/src/main/verifyPcm.ts`; Test `verifyPcm.test.ts`.

**Interfaces:** `pcmDigest(file: string, opts?: { signal?: AbortSignal }): Promise<{ md5: string; sampleRate: number; channels: number }>`; runs `ffmpeg -v error -i file -map 0:a:0 -c:a <pcm_s32le|pcm_f32le> -f md5 -` (float only for float/lossy decoders, from `probeAudio`), inside `pcmLimiter = createConcurrencyLimiter(2)` with `ANALYSIS_TIMEOUT_MS`.

- [ ] Tests (real files made with ffmpeg from a music-like fixture, e.g. the scenarios' `fixtures.ts` kick):
  - `an AIFF and the WAV transcoded from it digest the same` (be→le, 16 and 24 bit)
  - `a FLAC and the ALAC made from it digest the same`
  - `the same audio with different tags and cover digests the same`
  - `one changed sample changes the digest` (write a WAV, flip one byte inside the data chunk)
  - `a 48 kHz resample does not digest the same`
  - `rejects on an undecodable file`
- [ ] Run → FAIL; implement; PASS; mutate (drop `-map 0:a:0` so the cover stream joins), red.
- [ ] Commit `Fingerprint the decoded audio of a file`

### Task 3: `checkFile`

**Files:** Create `apps/desktop/src/main/verifyFile.ts`; Test `verifyFile.test.ts`.

**Interfaces:**
```ts
export interface FileExpect {
  path: string; ext: ConversionPlan['ext']; codec: string; sampleRateHz?: number; bitDepth?: number
  samplesKept: boolean; sourcePcm?: { md5: string; sampleRate: number; channels: number }
  sourceDurationSec?: number; trimmedSec: number
  tags: Partial<TrackMetadata>; cover: 'written' | 'removed' | 'untouched'
}
export interface FileReaders { exists; probe; assertDecodable; deliveredDurationSec; pcmDigest; snapshotTags; readEmbeddedCover }
export async function checkFile(e: FileExpect, r: FileReaders): Promise<PlaceCheck>
```
Detail keys per the spec (`fileIdentical`, `fileReencoded`, `fileMissing`, `fileWrongFormat`, `fileTruncated`, `filePcmDiffers`, `fileTagDiffers`, `fileNoCover`, `fileCoverKept`). A reader that throws (EIO, timeout) → `unreadable`.

- [ ] Tests (real readers on real fixtures; a fake reader only for the `unreadable` case):
  - `a WAV whose audio equals the source is ok with fileIdentical`
  - `a WAV whose audio differs is a mismatch with filePcmDiffers`
  - `an AIFF left where a WAV was asked is fileWrongFormat with expected WAV, actual AIFF` (the 30/10 bug)
  - `a file cut to a quarter is fileTruncated`
  - `a missing file is fileMissing`
  - `the path is found when written NFD and asked NFC` (`Café.wav`)
  - `a title that did not reach the file is fileTagDiffers with field title`
  - `a cover written but absent is fileNoCover`; `a cover removed but still present is fileCoverKept`
  - `a reencode within 50 ms of the source minus the trim is ok with fileReencoded`
  - `a timed out read is unreadable, never ok`
- [ ] Run → FAIL; implement; PASS; mutations: skip PCM compare when `samplesKept`; compare path without NFC.
- [ ] Commit `Check the written file against what the conversion meant to write`

### Task 4: `convertAudio` reports what it wrote, with the source digest taken before the rename

**Files:** Modify `apps/desktop/src/main/ffmpeg.ts` (`convertAudio` ~l.1920-2445), `processTrack.ts` (`ProcessTrackDeps.convertAudio` return type); Test `ffmpeg.test.ts` (next to the in-place conversion tests).

**Interfaces:** return type becomes `{ normalizeSkipped; declickedSamples?; written: { samplesKept: boolean; sourcePcm?: PcmDigest; plan: Pick<ConversionPlan,'ext'|'codec'|'sampleRateHz'|'bitDepth'>; sourceDurationSec?: number; trimmedSec: number } }`. `sourcePcm` computed with `Promise.all([assertDecodable(tmp, …), samplesKept ? pcmDigest(input) : undefined])` before `renameWithRetry`.

- [ ] Tests:
  - `an in-place AIFF tag update reports the source digest of the audio before the rewrite` (source and output same path; assert `written.sourcePcm.md5` equals a digest taken in the test BEFORE calling convertAudio)
  - `a reencode to MP3 carries no source digest`
  - `a cancel during the digest leaves the source untouched` (isCancelled flips; source sha1 unchanged)
- [ ] Mutation that must go red: move the digest after the rename.
- [ ] Update every `convertAudio` fake in `processTrack.test.ts` with `vi.fn<ProcessTrackDeps['convertAudio']>()` returning `written`. Typecheck node.
- [ ] Commit `Digest the source audio before an in-place conversion replaces it`

### Task 5: Music entry reader script

**Files:** Modify `apps/desktop/src/main/applemusic.ts`; Test `applemusic.test.ts`.

**Interfaces:** `buildVerifyEntryScript(pid: string, oldPid?: string): string`, `parseVerifyEntry(stdout: string): MusicEntryFacts | 'missing'`, `readMusicEntryFacts(pid, oldPid?): Promise<MusicEntryFacts | 'missing'>` (through `appleMusicLimiter`), with
`MusicEntryFacts = { location: string; name: string; artist: string; album: string; artworks: number; playlists: string[]; oldExists?: boolean }`. Normal playlists only (`user playlist` whose `smart` is false and `special kind` is none).

- [ ] Tests (string-level, like the existing `build*Script`/`parse*` tests): script embeds both pids through `appleScriptString`; `parseVerifyEntry` reads a location with a tab and a newline in the album; `missing value` location parses as `location: ''`; `missing` sentinel.
- [ ] Commit `Read back an Apple Music entry in one script`

### Task 6: `checkAppleMusic`

**Files:** Create `apps/desktop/src/main/verifyMusic.ts`; Test `verifyMusic.test.ts`. Modify `processTrack.ts` `replaceUnlocked` to read the old entry's normal playlists before the add and return them as `ReplacedCopy.playlistsBefore` (test in `processTrack.test.ts`: `a replacement returns the playlists the old entry had before the add`).

**Interfaces:**
```ts
export interface MusicExpect { pid: string; file: string; ext: string; meta: Pick<TrackMetadata,'title'|'artist'|'album'>; coverSet: boolean; replaced?: { oldPid: string; playlistsBefore: string[] } }
export interface MusicReaders { entry: typeof readMusicEntryFacts; entriesForFile: (path: string, titles: string[]) => Promise<string[]>; realPath: (p: string) => string; wait: (ms: number) => Promise<void> }
export async function checkAppleMusic(e: MusicExpect, r: MusicReaders): Promise<PlaceCheck>
```
- [ ] Tests (fake readers typed with the real signatures):
  - `an entry on the WAV with one reference is ok with musicOne and its playlists`
  - `an entry still on the AIFF is musicWrongFile with format AIFF` (30/10)
  - `the old entry still there after a replace is musicDuplicate`
  - `two entries on the same file is musicDuplicate count 2`
  - `a location through ~/Music/Music and the volume path count as the same file`
  - `a missing entry is musicMissing` (the deleted-track case of 30/10)
  - `an empty location is retried 3 times then is a mismatch`; `an empty location that fills on the second read is ok` (assert `wait` calls `[1000, 2000]`)
  - `a playlist the old entry had and the new one lacks is musicPlaylistLost`
  - `no artwork when a cover was set is musicNoArtwork`
  - `osascript failing is unreadable`
- [ ] Mutations: drop the realpath; retry forever (test times out → red).
- [ ] Commit `Check the Apple Music entry the conversion left`

### Task 7: rekordbox snapshot and check

**Files:** Create `apps/desktop/src/main/verifyRekordbox.ts`; Test `verifyRekordbox.test.ts` using `scenarios/rekordboxFixture.ts` (`makeRekordbox`, `rekordboxRow`).

**Interfaces:**
```ts
export interface RekordboxSnapshot { id: string; cues: number; analysisDataPath: string; analysed: number }
export function snapshotRekordboxRow(db: RekordboxDb, from: string, find: FindOptions): RekordboxSnapshot | null
export interface RekordboxExpect { from: string; to: string; samplesKept: boolean; before: RekordboxSnapshot | null; added: boolean; size: number }
export function checkRekordbox(db: RekordboxDb, list: RekordboxExpect[], find: FindOptions): PlaceCheck[]
```
- [ ] Tests:
  - `a repointed row on the WAV with its 13 cues and analysis is ok with rekordboxOk`
  - `a row still on the AIFF is rekordboxStillOld with format AIFF`
  - `an emptied AnalysisDataPath on a sample-kept conversion is rekordboxAnalysisEmptied` (30/10)
  - `an emptied AnalysisDataPath after a reencode is ok` (reanalysis is expected)
  - `one cue fewer is rekordboxCuesLost 13 to 12`
  - `a FileSize that is not the file's is rekordboxSizeDiffers`
  - `two rows on one file is a mismatch, never ok` (`AmbiguousMatch`)
  - `an NFD FolderPath matches an NFC file`
  - `the database opens read-only` (assert the file's mtime and sha1 unchanged after the check)
- [ ] Mutation: compare cue count against `after` twice (always equal).
- [ ] Commit `Check rekordbox's row against the file and its state before the conversion`

### Task 8: Engine snapshot and check

**Files:** Create `apps/desktop/src/main/verifyEngine.ts`; Test `verifyEngine.test.ts` using `engine3Fixture.ts` + `enginePerformanceFixture.ts` (`analysedTrack`, `quickCuesBlob`, `beatDataBlob`).

**Interfaces:** `snapshotEngineRow(db, libraryDir, from, key): EngineSnapshot | null` with `{ id: number; quickCues: string; beatData: string; loops: string }` (sha1 of each blob); `checkEngine(db, libraryDir, list: EngineExpect[], key): PlaceCheck[]`.

- [ ] Tests: `a moved row with identical performance blobs is ok`; `a row still on the old path is engineStillOld`; `a changed quickCues blob on a sample-kept conversion is enginePerformanceChanged`; `a changed beatData after a reencode is ok`; `a relative Track.path resolves against the library dir` (`absolute()`); NFD case.
- [ ] Commit `Check Engine DJ's row and performance data after a conversion`

### Task 9: Traktor check

**Files:** Create `apps/desktop/src/main/verifyTraktor.ts`; Test `verifyTraktor.test.ts` (NML strings like `traktorNml.test.ts`).

**Interfaces:** `checkTraktor(nml: string, list: { patch: NmlPatch; oldFile: string }[]): PlaceCheck[]` — only patches with `newFile`; uses `findEntries` + `attr`.

- [ ] Tests: `an entry renamed to the WAV is traktorOk`; `an entry still on the AIFF is traktorStillOld`; `an NFD FILE attribute matches`; `a patch without newFile produces no check` (not listed).
- [ ] Commit `Check Traktor's entry follows the renamed file`

### Task 10: Verification registry and library pass

**Files:** Create `apps/desktop/src/main/verifyRegistry.ts`; Test `verifyRegistry.test.ts`.

**Interfaces:**
```ts
export interface VerifyEntry { trackId: string; from: string; to: string; samplesKept: boolean; places: Set<VerifyPlace>; rekordbox?: RekordboxSnapshot | null; engine?: EngineSnapshot | null; traktorPatch?: NmlPatch; verification: Verification }
export function createVerifyRegistry(deps: { emit: (trackId: string, v: Verification) => void; readRekordbox: (list) => Promise<PlaceCheck[]|'unreadable'>; readEngine; readTraktor }): {
  register(e: VerifyEntry): void
  afterFlush(outcome: { rekordbox: 'written'|'queued'|'off'; engine: …; traktor: … }): Promise<void>
  afterQueueApplied(place: 'rekordbox'|'engine'|'traktor'): Promise<void>
  retry(trackId: string): Promise<'rerun-job' | 'rechecked'>
  get(trackId: string): Verification | undefined
}
```
- [ ] Tests:
  - `after a written flush each registered track gets its library checks and one emit`
  - `a queued rekordbox flush marks rekordbox pending, not mismatch`
  - `applying the rekordbox queue re-checks only the tracks pending there`
  - `a place the job never touched is never listed`
  - `retry on an unreadable place re-reads only that place`
  - `retry on a library mismatch re-enqueues that repoint and re-checks after apply`
  - `retry on a file or Music mismatch answers rerun-job`
- [ ] Commit `Track each conversion's places and re-check the libraries after the batch`

### Task 11: Wire the checks into `runProcessTrack`

**Files:** Modify `apps/desktop/src/main/processTrack.ts`; Test `processTrack.test.ts`.

**Interfaces:** `ProcessTrackDeps` += `snapshotLibraries?: (from: string) => Promise<{ rekordbox?: RekordboxSnapshot|null; engine?: EngineSnapshot|null }>`, `verifyFile: (e: FileExpect) => Promise<PlaceCheck>`, `verifyMusic?: (e: MusicExpect) => Promise<PlaceCheck>`, `registerVerification?: (e: VerifyEntry) => void`. Snapshot right after the `metaUnread`/`isAllowed` guards; `stage('verify')` after the Engine step; result gets `verification`.

- [ ] Tests:
  - `a finished job returns verification with the file check and libraries checking`
  - `the success result carries the file mismatch instead of throwing` (status stays done, verification mismatch)
  - `Music is listed only when the job went through the Music step`
  - `Music only checks the file at the entry's location, not the removed temp`
  - `the snapshot is taken before convertAudio runs` (call order)
  - `the verify stage is sent after the Engine stage`
- [ ] Commit `Re-read the file and Music before a conversion reports back`

### Task 12: IPC, flush and queue hooks in main

**Files:** Create `apps/desktop/src/main/verifyIpc.ts`; Modify `libraryFlushes.ts` (`flushConversionBatch` returns `{ rekordbox, engine, traktor }` outcome), `index.ts` (process:track deps, `process:batch-end` → `registry.afterFlush`, `announceApplied`/`announceEngineApplied`/`announceTraktorApplied` → `registry.afterQueueApplied`), `preload/index.ts` (`onVerifyUpdate`, `retryVerification`), preload `Api` type. Tests: `verifyIpc.test.ts`, `libraryFlushes.test.ts` (or the scenarios' flush tests).

- [ ] Tests:
  - `flushConversionBatch says rekordbox was queued when the app is open`
  - `verify:retry with an unknown track id rejects with an error key`
  - `a verify:update reaches the window that converted` (broadcast)
- [ ] Typecheck node + web.
- [ ] Commit `Send verification updates to the window after the batch and each queue`

### Task 13: Renderer state

**Files:** Modify `renderer/src/types.ts` (`TrackItem.verification?`), `lib/export.ts` (`exportedPatch` copies `result.verification`), Create `hooks/useVerificationUpdates.ts`; Modify `hooks/useTrackProcessing.ts` (`retryVerification(trackId)` → main; on `'rerun-job'` calls the existing single-track process path). Tests: `lib/export.test.ts`, `hooks/useVerificationUpdates.test.ts`, `hooks/useTrackProcessing.test.ts`.

- [ ] Tests:
  - `exportedPatch keeps the verification main returned` (both the music-only and the file branch)
  - `a verify:update for a track updates only that track`
  - `an update for a track no longer loaded is ignored`
  - `retry that answers rerun-job converts the track again`
- [ ] Commit `Keep each track's verification in the renderer`

### Task 14: Footer states and the shield popover

**Files:** Modify `components/ConvertFooter.tsx`; Create `components/VerifiedPopover.tsx` (reuse `menuPlacement.ts` and the `DoneMenu.tsx` popover pattern); Tests `ConvertFooter.test.tsx`, `VerifiedPopover.test.tsx`.

- [ ] Tests (by `data-testid`):
  - `while checking the done row shows verify-checking and no export-success`
  - `stage verify on the processing track shows verify-checking too`
  - `once ok the success line shows with the verify-shield button`
  - `the popover lists one verify-line per touched place, in place order` (file + rekordbox only → 2 lines, no Music line)
  - `the shield button has an accessible name` (`aria-label` = `verify.shieldLabel`)
  - pending rendering per the open decision in the spec (default: success text without ✓, popover line `verify.detail.pending`)
- [ ] Commit `Show Comprobando until the checks pass and what was checked behind a shield`

### Task 15: Amber line and Reintentar

**Files:** Modify `ConvertFooter.tsx`; Test `ConvertFooter.test.tsx`.
- [ ] Tests: `a mismatch shows verify-mismatch with the worst place's text and no success line`; `Reintentar calls retryVerification once with the track id`; `Reintentar is disabled while checking`; `an unreadable place reads No se pudo comprobar`.
- [ ] Commit `Say what does not add up and offer to try again`

### Task 16: Trash gate

**Files:** Modify `lib/supersededFile.ts`, `lib/selectionStatus.ts`; Tests `supersededFile.test.ts`, `selectionStatus.test.ts`.
- [ ] Tests: `no superseded file while checking`; `none while pending`; `none on a mismatch`; `none when the track has no verification`; `offered once ok`; `the original is not offered for cleanup unless verified` (selectionStatus).
- [ ] Mutation: drop the `pending` clause → red.
- [ ] Commit `Never offer to trash a replaced file before everything was checked`

### Task 17: Batch summary, amber dot and the "No cuadran" filter

**Files:** Modify `ConvertFooter.tsx` (multi text), `lib/triage.ts` (`ConversionFilter` += `'mismatch'`, tally `mismatch`), `components/QualityFilterBar.tsx` (option with amber dot, shown only when tally > 0), the list row (`ListRow.tsx`/`ExportTrackRow.tsx`, amber dot `data-testid="verify-dot"` with `aria-label`). Tests: `triage.test.ts`, `QualityFilterBar.test.tsx`, `ConvertFooter.test.tsx`, row test.
- [ ] Tests: `the batch line counts verified and mismatched` (38/2 → `verify.batch` with both counts); `all verified shows only the verified count`; `the mismatch filter keeps only tracks whose verification is mismatch`; `the filter option is hidden at zero`; `a failing row carries the amber dot with its label`; `a pending row carries no dot`.
- [ ] Commit `Count verified tracks in a batch and filter the ones that do not add up`

### Task 18: i18n in six locales

**Files:** `renderer/src/i18n/locales/{es,en,de,fr,pt-BR,ja}.json` (`verify.*`: `checking`, `shieldLabel`, `title`, `retry`, `batch_one/_other`, `mismatchCount_one/_other`, `places.*`, `detail.*`, `filter.mismatch`).
- [ ] `keys.test.ts` passes (es/en parity), and grep every new value in all six: no `—`, no `:` introducing an explanation, no usted/Sie/vous.
- [ ] Commit `Translate the verification copy`

### Task 19: Real Music check (opt-in)

**Files:** Modify `apps/desktop/src/main/applemusicReal.test.ts` (runs only with `SURCO_REAL_MUSIC=1`).
- [ ] Tests: `a fresh add checks ok against the real entry`; `an AIFF replaced by a WAV checks ok and the old entry is gone`; `an entry pointed back at the AIFF with set location checks musicWrongFile`; `a duplicate added on purpose checks musicDuplicate`. Every entry prefixed and deleted afterwards like the existing ones.
- [ ] Run `SURCO_REAL_MUSIC=1 node ../../node_modules/vitest/vitest.mjs run src/main/applemusicReal.test.ts`.
- [ ] Commit `Check the Music verification against the real app`

### Task 20 (controller): real run with the driver

Not a subagent task. With backups of master.db, m.db, collection.nml and the Music library first (run-desktop skill, user's settings copy):
- [ ] AIFF→WAV from the Music tab on the 30/10 track: Comprobando… then ✓, popover with Fichero, Apple Music, rekordbox, Engine DJ lines matching the spec examples.
- [ ] Same with rekordbox open: rekordbox pending; close rekordbox, line turns ok.
- [ ] Break one place by hand (repoint rekordbox back with SQL on the copy): amber "rekordbox sigue en el AIFF", Reintentar fixes it, no trash offer until then.
- [ ] Batch of ~10 on the NAS: measure seconds per track with and without the checks; summary and filter right.
- [ ] Measure the footer and popover at ~1000x621 in es, en, de, fr, pt-BR, ja (no wrap, no clipping). Restore the backups.
