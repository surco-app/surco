# Cambiar de formato una pista de biblioteca sin perder nada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converting a track that already lives in Apple Music / rekordbox / Engine DJ / Traktor to ANY other format (AIFF↔WAV↔FLAC↔ALAC↔MP3, any pair) replaces it in every library, and when the decoded audio is sample-identical the libraries keep their analysis, beatgrid and cues untouched.

**Architecture:** Two independent rules. (1) `planConversion` reports `samplesKept` when the decoded samples cannot change (lossless source, lossless target, same rate and depth, no dither, no filter); `convertAudio` then records the rekordbox repoint without its `audio` block, so `rekordboxLibrary` neither shifts cues nor empties `AnalysisDataPath`. (2) `runProcessTrack` replaces the Apple Music entry whenever the job carries `musicPersistentId` and the entry's file is not the file just written, returns the superseded file so the renderer offers to trash it, and Traktor's NML patch follows the file Music landed, like rekordbox's repoint already does.

**Tech Stack:** Electron main (TS), vitest, ffmpeg-static, better-sqlite3-multiple-ciphers.

**Spec:** No separate spec. Agreed with the user on 30/10/2026 after a real test (see memory `aiff-a-wav-desde-music-roto`): opening Sambaleluya Rmx-1 from the Music tab and converting to WAV only re-tagged the AIFF (`processTrack.ts` ~l.533 `updateInAppleMusic` branch, WAV temp discarded) and the rekordbox repoint emptied `AnalysisDataPath` (`rekordboxLibrary.ts:250`). User: "esto tiene que aplicar a cualquier conversion, ya sea AIFF a WAV, que WAV a AIFF o cualquier combinacion". AIFF→WAV decodes to the same md5 (measured).

## Global Constraints

- Work in `/Users/vicent/code/surco/.claude/worktrees/sustituir-formato` (branch `sustituir-formato-biblioteca`). Never touch the main checkout.
- Tests: from `apps/desktop`, `node ../../node_modules/vitest/vitest.mjs run src/main/<file>.test.ts`. Never filter by path from the repo root.
- Typecheck: `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` (bare `tsc --noEmit` checks nothing). Lint: `npx biome check src` must show no new warnings.
- ZERO new code comments beyond what the surrounding file's density needs; match existing style. No TODOs.
- TDD: show each new test failing before the implementation. Verify a new test by mutating the implementation once (it must fail).
- Commit messages: one descriptive English title line, no body, no `feat:` prefix (match `git log`).
- Do not change behaviour of lossy routes: MP3/AAC on either side still sends the `audio` block (cue shift + reanalysis) exactly as today.

## Review Focus

1. Pinned output rate or depth that differs from the source (e.g. 24-bit FLAC → 16-bit WAV, 44.1 → 48 kHz): audio changes, so the repoint must still carry `audio` (reanalysis). Task 1 tests it.
2. A Music track converted to the SAME format in place (AIFF tag edit): must stay an `updateInAppleMusic`, never an add+delete (it would reset date added and playlist order). Task 3 tests it.
3. `musicPersistentId` whose entry no longer exists (`appleMusicEntryLocation` rejects or returns ''): must fall back to today's `update ?? add`, not throw. Task 3 tests it.
4. Batch of mixed AIFF/WAV from Music converted to WAV: the WAVs are same-format in-place updates, the AIFFs replacements; each decided per job. Covered because the rule lives in `runProcessTrack` per job (Task 3 tests both shapes).
5. Traktor patch when Music lands the file in a DIFFERENT folder than the source: Traktor can only rewrite FILE, so `newFile` must stay undefined there (today's sameDir rule). Task 4 tests it.

---

### Task 1: `planConversion` reports whether the samples survive

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (`ConversionPlan` ~l.1082, `planConversion` ~l.1101-1255)
- Test: `apps/desktop/src/main/ffmpeg.test.ts` (next to the existing `planConversion` tests)

**Interfaces:**
- Produces: `ConversionPlan.samplesKept?: true` — set when the decoded PCM of the output equals the source's: every `codec: 'copy'` plan, and every lossless-target plan whose source codec is lossless (`pcm_*`, `flac`, `alac`) and for which the existing `keepsSource(plan)` holds and `normalize` is false. Never set for an `mp3` target or an AAC-encode plan.

- [ ] **Step 1: Write the failing tests** (`describe('planConversion samplesKept')`, using the file's existing fake probe helper; probe `codecName`, `sampleRate`, bit depth as the neighbouring tests do)
  - `pcm_s16be` 44100 `.aiff` → `'wav'`, default quality → `samplesKept: true`
  - `pcm_s16le` `.wav` → `'aiff'` → `true`
  - `flac` 24-bit `.flac` → `'alac'` with `bitDepth: 'source'` → `true`
  - `alac` `.m4a` → `'flac'` → `true`
  - `.aiff` → `'wav'` with `sampleRate: '48000'` (source 44100) → `samplesKept` undefined
  - 24-bit `.flac` → `'wav'` with `bitDepth: '16'` → undefined
  - `.aiff` → `'wav'` with `normalize = true` → undefined
  - `mp3` `.mp3` → `'wav'` → undefined; `.wav` → `'mp3'` → undefined; AAC `.m4a` → `'wav'` → undefined
  - `.mp3` → `'mp3'` (copy) → `true`
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/ffmpeg.test.ts -t samplesKept` — Expected: FAIL (property undefined where `true` expected).
- [ ] **Step 3: Implement** in each lossless branch of `planConversion`: compute `kept = copyOk && losslessSource && (await keepsSource(plan))` (losslessSource from `(await probeOnce()).codecName`) and spread `...(kept ? { samplesKept: true as const } : {})`; add `samplesKept: true` to every `codec: 'copy'` return.
- [ ] **Step 4: Run** the same command, then the whole `ffmpeg.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `Tell whether a conversion keeps the source's samples untouched`

### Task 2: A sample-identical conversion leaves rekordbox's analysis and cues alone

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (~l.2306 `rekordboxAudio`)
- Test: `apps/desktop/src/main/convertRekordboxRepoint.test.ts`, `apps/desktop/src/main/rekordboxLibrary.test.ts`

**Interfaces:**
- Consumes: `ConversionPlan.samplesKept` (Task 1).
- Produces: the repoint recorded by `convertAudio` has no `audio` key when `copiedVerbatim || plan.samplesKept`.

- [ ] **Step 1: Write the failing tests**
  - `convertRekordboxRepoint.test.ts`: real AIFF fixture converted to `wav` (same pattern as existing tests there) → recorded repoint `from` .aiff, `to` .wav, `audio` undefined. Same for WAV→AIFF and WAV→FLAC.
  - Same file: MP3 → WAV still records `audio` (guards the lossy route).
  - `rekordboxLibrary.test.ts`: a repoint without `audio` keeps `AnalysisDataPath`, `Analysed` and the `djmdCue` rows byte-identical, while FolderPath/FileNameL/FileType/FileSize change (FileType 12 → 11 for aiff→wav). If an equivalent test already exists, cite it in the commit instead of duplicating.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/convertRekordboxRepoint.test.ts` — Expected: FAIL (`audio` present).
- [ ] **Step 3: Implement** `const rekordboxAudio = copiedVerbatim || plan.samplesKept ? undefined : {…}`.
- [ ] **Step 4: Run** both test files plus `src/main/cueMatrix.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `Keep rekordbox's grid, waveform and cues when a conversion leaves the samples untouched`

### Task 3: Converting a library track to another format replaces its Apple Music entry

**Files:**
- Modify: `apps/desktop/src/main/processTrack.ts` (Apple Music branch ~l.500-545, result ~l.598-630), `apps/desktop/src/shared/types.ts` (`ProcessResult` ~l.1253)
- Modify: `apps/desktop/src/renderer/src/lib/export.ts` (result → track patch, ~l.20-70)
- Modify: `docs/funcionalidades.md` (section «Sustituir la copia de la biblioteca», ~l.1840): one paragraph saying a track opened from Music and converted to another format is replaced the same way, and that a lossless→lossless conversion at the same rate/depth keeps rekordbox's analysis (Task 2).
- Test: `apps/desktop/src/main/processTrack.test.ts`, `apps/desktop/src/renderer/src/lib/export.test.ts`

**Interfaces:**
- Consumes: existing `replaceAppleMusicCopy(job, target, coverPath, deps, tmpDir)` (defaults `old` to `job.musicPersistentId`), `deps.appleMusicEntryLocation`, `deps.isSameFile`.
- Produces: `ProcessResult.supersededPath?: string` — the entry's old file, set only when this new replace path ran and the old entry was deleted (`oldCopyKept` undefined); `deps.allowMedia(supersededPath)` called. Renderer: `export.ts` maps `result.supersededPath` to `replacesPath` on the track so `supersededFile()` offers the trash as for any other replacement.

Rule, in the final `else` branch where today `job.musicPersistentId ? update ?? add : add` runs: read `entryPath = await deps.appleMusicEntryLocation(job.musicPersistentId).catch(() => '')`; if `entryPath` is non-empty and `!(await deps.isSameFile(entryPath, target))`, run `replaceAppleMusicCopy(job, target, coverPath, deps, tmpDir)` and set `verified = true`; otherwise keep today's code. The `existingMusicEntry && inPlace && outputIsInput` branch is untouched.

- [ ] **Step 1: Write the failing tests** in `processTrack.test.ts` with the file's existing deps factory:
  - job `{ inputPath: '/lib/A.aiff', format: 'wav', musicPersistentId: 'PID', addToAppleMusic: true, keepOutputCopy: false }`, `appleMusicEntryLocation('PID') → '/lib/A.aiff'`: expects `addToAppleMusic` called, `carryAppleMusicHistory('PID', <new>, …)`, `deleteAppleMusic('PID', …)`, `updateInAppleMusic` NOT called, result `supersededPath: '/lib/A.aiff'`.
  - Same with `keepOutputCopy: true` (file written to the output folder) → same replacement.
  - Same-format in place (`inputPath '/lib/A.aiff'`, `format 'aiff'`, `isSameFile → true`) → `updateInAppleMusic('PID', …)` only; no add, no delete, no `supersededPath`.
  - `appleMusicEntryLocation` rejects → today's `updateInAppleMusic ?? addToAppleMusic`, no throw.
  - `carryAppleMusicHistory → 'mismatch'` → `oldMusicCopyKept: 'mismatch'`, no `supersededPath`.
  - `export.test.ts`: a result with `supersededPath` yields a track patch with `replacesPath` equal to it.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/processTrack.test.ts` — Expected: the replace tests FAIL (`updateInAppleMusic` called instead).
- [ ] **Step 3: Implement** the rule above, `supersededPath` in both return objects (musicOnly and normal), the type field, and the `export.ts` mapping. Update `docs/funcionalidades.md`.
- [ ] **Step 4: Run** `processTrack.test.ts`, `processTrackMatrix.test.ts`, `export.test.ts`, then both `tsc` configs — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `Replace an Apple Music track's entry when it is converted to another format`

### Task 4: Traktor follows the file Apple Music landed

**Files:**
- Modify: `apps/desktop/src/main/nmlBatch.ts`, `apps/desktop/src/main/ffmpeg.ts` (`recordConversionPatch` ~l.1355), `apps/desktop/src/main/index.ts` (~l.1706 `redirectRepoint`)
- Test: `apps/desktop/src/main/nmlBatch.test.ts`

**Interfaces:**
- Produces: `recordNmlPatch(patch: NmlPatch, paths?: { input: string; output: string }): void` (existing callers unchanged) and `redirectNmlPatch(currentTo: string, landedAt: string): void` — finds the patch recorded with `output === currentTo` and sets `newFile = basename(landedAt)` only when `dirname(landedAt) === dirname(input)` and the name differs; otherwise leaves it as is.
- `index.ts`: `redirectRepoint: (to, landed) => { redirectRekordboxRepoint(to, landed); redirectNmlPatch(to, landed) }`. Engine already follows through the rekordbox repoints (`libraryFlushes.ts:227`), no change.

- [ ] **Step 1: Write the failing tests** in `nmlBatch.test.ts`: record a patch for input `/m/A/x.aiff`, output `/tmp/surco-1/x.wav`; `redirectNmlPatch('/tmp/surco-1/x.wav', '/m/A/x.wav')` → `endNmlBatch()[0].newFile === 'x.wav'`. Landed at `/m/B/x.wav` → `newFile` undefined. Unknown `currentTo` → no change.
- [ ] **Step 2: Run** `node ../../node_modules/vitest/vitest.mjs run src/main/nmlBatch.test.ts` — Expected: FAIL (`redirectNmlPatch` not exported).
- [ ] **Step 3: Implement** a side list of `{ input, output }` parallel to `patches`, cleared wherever `patches` is; pass `{ input, output }` from `recordConversionPatch`; wire `index.ts`.
- [ ] **Step 4: Run** `nmlBatch.test.ts`, `traktorNml.test.ts`, both `tsc` configs — Expected: PASS.
- [ ] **Step 5: Commit** `Point Traktor at the file Apple Music copied when converting to Apple Music only`

### Task 5: Full suite and lint

- [ ] Run from `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run` — Expected: all green (report counts; if a known-flaky file fails, rerun that file alone and report both runs).
- [ ] `npx biome check src` and both `tsc` configs — Expected: clean.

### Task 6 (controller, not a subagent): Real test on the user's libraries

Done by the controller with the driver (`scratchpad/aiff-wav-prueba/serve.mjs` pattern, isolated userData seeded from the user's settings with `syncEngineDj`/`syncTraktor` on), rekordbox/Engine/Traktor closed, fresh backups first:
1. Sambaleluya Rmx-1 (rekordbox 212224125, Engine id 3) from the Music tab, AIFF → WAV.
2. Check: Music entry is the .wav, kind WAV, same artwork/tags, still in playlists 24 and All; rekordbox row → .wav, FileType 11, `AnalysisDataPath` and 13 cues unchanged; Engine row → .wav, `quickCues`/`beatData`/`loops` blobs md5-identical; decoded PCM md5 of the WAV equals the AIFF's; superseded AIFF offered for trash.
3. Convert it back WAV → AIFF and check the same, so the user's library ends as it started.
