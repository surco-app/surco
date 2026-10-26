# Traktor Cues and Auto Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Cues section of the editor works for a track opened from the Traktor tab: read its cues and grid from `collection.nml`, Auto mark, edit, and save through a queue that writes the NML when Traktor is closed.

**Architecture:** Mirror the Engine DJ cue path. A `traktor:` content id routes the existing `rekordbox:*` cue IPC to a `host.traktor` branch; reads and writes are text edits of the NML `ENTRY` (as `traktorNml.ts` does); a third `createRekordboxQueue` with its watcher applies on Traktor close through the existing `writeCollection` guard.

**Tech Stack:** Electron main + preload, React 19 renderer, TanStack Query, Vitest, Biome, i18next (en, es, de, fr, pt-BR).

**Spec:** `docs/superpowers/specs/2026-10-26-traktor-cues-design.md`

## Global Constraints

- Work in the worktree `/Users/vicent/code/surco-traktor-tab` (branch `traktor-tab`). Run commands from `apps/desktop`.
- Tests: `npx vitest run <file>` from `apps/desktop` (never filter by path from the repo root). Types: `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` (plain `tsc` checks nothing). Lint/format: `npx biome check --write <files>`.
- Commit titles: one descriptive sentence, no body, no `feat:`.
- Surco writes only `TYPE="0"` cues. Letter i of Surco (`HOT_KINDS[i]`, i = 0..6) is `HOTCUE=i+1`; `HOTCUE=0` and `TYPE=4` are never read as editable nor written; letter H (`HOT_KINDS[7]`) has no button.
- Writing uses only `settings.traktorNmlPath` when that file exists; the detected path (`nmlPath()` fallback) is read-only.
- Copy in all 5 locales; no em dash and no explanatory colon in UI text.
- Match the surrounding code: its comment density and naming (`engine*` twins become `traktor*`).

## Review Focus

- An ENTRY whose `HOTCUE=0` is not AutoGrid (Traktor 3, or the DJ replaced it): still untouched and not shown. Test in Task 2.
- A `CUE_V2` written with a body (`<CUE_V2 ...><GRID .../></CUE_V2>`) next to self-closing ones: the rewrite keeps the grid element byte for byte. Test in Task 3.
- Names with `&amp;`, `&quot;` in `DIR`/`FILE`: the content id key must match the PRIMARYKEY and the ENTRY after unescaping. Test in Task 1.
- Saving the set exactly as read changes nothing on disk (no write, no backup). Test in Task 3.
- No confirmed `traktorNmlPath`: Auto mark and Save are disabled with the "set your collection" text, and a queued op is refused as `unreadable`. Tests in Tasks 3 and 6.

---

### Task 1: Traktor content ids and the row's letter mapping

**Files:**
- Create: `src/shared/traktorContent.ts`, `src/shared/traktorContent.test.ts`
- Modify: `src/main/traktorPlaylists.ts` (entries carry `contentId`; `cuesOf` mapping), `src/main/traktorPlaylists.test.ts`

**Interfaces:**
- Produces: `traktorContentId(key: string): string` (`'traktor:' + key`), `isTraktorContent(id: string): boolean`, `traktorKey(id: string): string | null`; `TRAKTOR_HOT_OFFSET = 1`; every non-null `readTraktorPlaylist` entry has `contentId: traktorContentId(volume + dir + file)` (unescaped values, same string as the playlist's PRIMARYKEY after unescape). Export `pathOf` as `traktorFileOf(block: string, bootVolume: string): string` for Task 4.

- [ ] **Step 1: Failing tests.** In `traktorContent.test.ts`: round trip `traktorKey(traktorContentId('HD/:Music/:a & b.mp3')) === 'HD/:Music/:a & b.mp3'`; `isTraktorContent('engine:3') === false`; `traktorKey('engine:3') === null`. In `traktorPlaylists.test.ts`: change the hot cue test so `HOTCUE="2"` yields `kind: HOT_KINDS[1]` (Surco B) and add a cue `HOTCUE="0"` that does not appear in `preview.cues`; update the djotas colour test (its AutoGrid at `HOTCUE=0` drops out, four colours remain); new test "names each row by the key Traktor uses for it" with a FILE of `R&amp;B.mp3`, asserting `entry.contentId === traktorContentId('Macintosh HD/:Users/:dj/:Music/:R&B.mp3')`.
- [ ] **Step 2:** `npx vitest run src/shared/traktorContent.test.ts src/main/traktorPlaylists.test.ts` → FAIL.
- [ ] **Step 3:** Implement `traktorContent.ts` (twin of `engineContent.ts`) and the two changes in `traktorPlaylists.ts` (`kind = HOT_KINDS[hotcue - TRAKTOR_HOT_OFFSET]`, skip `hotcue === 0`).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit "Name each Traktor row by its collection key and give its hot cues the letters Surco edits them under".

### Task 2: Read a Traktor track's cues and grid

**Files:**
- Create: `src/main/traktorCues.ts`, `src/main/traktorCues.test.ts`

**Interfaces:**
- Consumes: Task 1 (`traktorKey`, `TRAKTOR_HOT_OFFSET`), `TRAKTOR_TYPE_COLOR` from `traktorPlaylists.ts`, `cueFingerprint` from `rekordboxCues.ts`, `findEntries`/`attr` from `traktorNml.ts`.
- Produces: `traktorEntryBlock(nml: string, key: string): { start: number; end: number; block: string } | null`; `readTraktorTrackCues(nml: string, contentId: string): TrackCues | null`; `traktorCueRows(block: string): (TrackCueRow & { element: string })[]` (the raw `CUE_V2` text kept for Task 3).

Rules (from the spec): `id` = index of the `CUE_V2` within the ENTRY as a string; `HOTCUE=-1` and `TYPE≠4` → `kind 0, color null`; `HOTCUE=1..7` → `kind HOT_KINDS[h-1]`, `color = rekordboxColorOf(TRAKTOR_TYPE_COLOR[type])`; `TYPE≠0` → `loop: true`; skip `TYPE=4` and `HOTCUE=0`. `grid`: beats every `60000/BPM` ms from the `TYPE=4` START, backwards and forwards within `[0, durationMs]`, marker = beat 1, cycling 1..4. `durationMs` = `PLAYTIME_FLOAT*1000` (else `PLAYTIME`). `analysed` = a `TYPE=4` with `GRID BPM > 0` exists. `phrases: []`, `strong: []`, `wave: null`.

- [ ] **Step 1: Failing tests** on the djotas ENTRY (copy the five `CUE_V2` from `traktorPlaylists.test.ts` plus a `TYPE=4` with `<GRID BPM="128.000000">` at `START="11.333358"` and `PLAYTIME_FLOAT="240.0"`):
  - `cues` equals `[{id:'1',ms:13739.225711,kind:HOT_KINDS[0],color:<load yellow>,loop:true}, {id:'2',ms:92674.60674,kind:HOT_KINDS[1],color:<blue>}, {id:'3',…,kind:HOT_KINDS[2],loop:true}, {id:'4',…,kind:HOT_KINDS[3],loop:true}]` (ids are the CUE_V2 indexes after the TYPE=4 element; compute them from the fixture order you write).
  - two `HOTCUE=-1` cues get distinct ids and `kind 0`.
  - `grid[0].ms` ≥ 0 and < one beat; the beat at 11.333358 has `beat: 1`; consecutive beats differ by 468.75 ms.
  - "keeps whatever holds button 1 out of the editor even when it is not AutoGrid": `HOTCUE="0" NAME="Intro" TYPE="0"` is not in `cues`.
  - no grid marker → `analysed: false, grid: []`.
  - unknown key → `null`.
- [ ] **Step 2:** `npx vitest run src/main/traktorCues.test.ts` → FAIL.
- [ ] **Step 3:** Implement in `traktorCues.ts`.
- [ ] **Step 4:** Same → PASS.
- [ ] **Step 5:** Commit "Read a Traktor track's cues and beat grid from its collection entry".

### Task 3: Write a cue set into the NML

**Files:**
- Create: `src/main/traktorCuesWrite.ts`, `src/main/traktorCuesWrite.test.ts`
- Modify: `src/main/traktorNmlLibrary.ts` (export `writeCollection`), `src/shared/types.ts` (notice `{ code: 'cues-slot-dropped'; track: string }` in `RekordboxQueueNotice`)

**Interfaces:**
- Consumes: Task 2 (`traktorEntryBlock`, `traktorCueRows`, `readTraktorTrackCues`), `validWantedSet`, `HOT_KINDS`, `CuesOp`/`QueueOp`/`BatchResult`/`OpOutcome` from `rekordboxQueueOps.ts`, `writeCollection(nmlPath, patched): Promise<SyncResult['reason'] | null>`.
- Produces: `withTraktorCues(block: string, wanted: WantedCue[]): string` (pure); `applyTraktorCuesBatch(nmlPath: string, ops: QueueOp[], deps: { ensureClosed: () => Promise<boolean>; write?: typeof writeCollection }): Promise<BatchResult>`.

Rewrite rule: keep every `TYPE=4` element and the `HOTCUE=0` element verbatim; a wanted cue with an `id` whose row has the same `ms` keeps its original element verbatim (and its `HOTCUE` updated if the letter changed, only for `TYPE=0`); a new or moved one is written as `<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="<ms.toFixed(6)>" LEN="0.000000" REPEATS="-1" HOTCUE="<h>"></CUE_V2>` with `h = HOT_KINDS.indexOf(kind) + 1`, or `-1` for kind 0; rows not wanted are removed; a wanted `HOT_KINDS[7]` is dropped and reported as `cues-slot-dropped`. New elements go where the removed cue elements were (after the kept ones), so the rest of the ENTRY is byte-identical.

Batch: `nmlPath === ''` → `{ ok:false, reason:'unreadable' }`; per op like `engineCuesWrite.ts` `plan` (`cues-changed` when the key is gone or the fingerprint differs, `cues-invalid` when `validWantedSet` fails); nothing changed → `{ ok:true, wrote:false }` without calling `ensureClosed` or `write`; otherwise `ensureClosed()` false → `cancelled`; `write` returns a reason → `traktor-running` maps to `'rekordbox-running'`, `backup-failed` and `write-failed` to themselves (check `RekordboxEditRefusal` for the exact names and add a mapping test).

- [ ] **Step 1: Failing tests:**
  - "saving the set as read leaves the collection untouched": `withTraktorCues(block, rowsAsWanted) === block`; and `applyTraktorCuesBatch` with that op does not call `write`.
  - "moves a blue cue and keeps the load cue and the grid as they were": the `TYPE=3` and `TYPE=4` elements appear verbatim in the output.
  - "adds a new cue as a normal Traktor cue on the button after AutoGrid": wanted `{ms:60000, kind:HOT_KINDS[0], color:5}` on an entry with no hot cues → output contains `TYPE="0" START="60000.000000"` and `HOTCUE="1"`.
  - "writes a CALL as a cue without a button": kind 0 → `HOTCUE="-1"`.
  - "drops letter H and says so": outcome notices contain `{code:'cues-slot-dropped', track: op.label}`.
  - "keeps a CUE_V2 that has a GRID child intact" (Review Focus).
  - "refuses a set built on cues Traktor changed": fingerprint mismatch → `cues-changed`.
  - "refuses without a confirmed collection": `nmlPath ''` → `{ok:false, reason:'unreadable'}`.
  - "reports Traktor opening mid-write as busy": fake `write` returns `'traktor-running'`.
  - Use temp files (`mkdtemp`) for the batch tests.
- [ ] **Step 2:** `npx vitest run src/main/traktorCuesWrite.test.ts` → FAIL.
- [ ] **Step 3:** Implement; export `writeCollection`.
- [ ] **Step 4:** Same → PASS; `npx vitest run src/main/traktorNmlLibrary.test.ts` still PASS.
- [ ] **Step 5:** Commit "Write a cue set into a Traktor collection entry, keeping the grid, button 1 and the DJ's own load, fade and loop cues".

### Task 4: Route the cue IPC, queue and watcher to Traktor

**Files:**
- Create: `src/main/traktorDropInput.ts` (+ test), `src/main/traktorCueQueueIpc.ts` (+ test)
- Modify: `src/main/rekordboxCuesIpc.ts` (+ its test), `src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`

**Interfaces:**
- Consumes: Tasks 1-3; `createRekordboxQueue`, `watchRekordboxQueue`, `serialLibraryFlush`, `appliedNotice`, `stillWaiting`, `isTraktorRunning`, `ensureTraktorClosed`, `bootVolumeName`, `nmlPath`.
- Produces:
  - `host.traktor?: { nml: () => string; bootVolume: () => string; queue: CueQueue; applyQuietly: () => void; words: (file: string) => Promise<Uint16Array | null> }` on `registerRekordboxCuesIpc`. `nml()` is the path the tab reads (`nmlPath(...)`).
  - Branches: `trackCues` → `readTraktorTrackCues(read(nml), id)`; `cueWaveDetail` → `words(traktorFileOf(entry, bootVolume))`; `cueDropInput` → `traktorDropInput(id, sources)` (twin of `engineDropInput`: rekordbox phrases by path first, else `{grid, phrases: [], words}`); `auditionLead` → 0; `surcoGrid` → null; `queuedCues`/`undoCues` → the Traktor queue; `saveCues` → a third target.
  - `traktorCueQueue = createRekordboxQueue({ store: fileStore(userData/'traktor-cue-queue.json'), collection: confirmedTraktorNml, applyBatch: (p, ops, ensureClosed) => applyTraktorCuesBatch(p, ops, { ensureClosed }), repoint: async () => [], nodeStamps: async () => ({}), onChange: broadcast('traktor:cueQueueChanged') })` where `confirmedTraktorNml = () => { const p = getSettings().traktorNmlPath; return p && existsSync(p) ? p : '' }`; watcher on `isTraktorRunning`; `applyTraktorCueQueueQuietly`.
  - `registerTraktorCueQueueIpc(queue, host)` with channels `traktor:cueQueue`, `traktor:applyCueQueue`, `traktor:discardCueQueue`, `traktor:cueQueueReady`; events `traktor:cueQueueChanged`, `traktor:cueQueueApplied`.
  - IPC `traktor:canSave` → `confirmedTraktorNml() !== ''`.
  - Preload `traktorCueQueue`, `applyTraktorCueQueue`, `discardTraktorCueQueue`, `traktorCueQueueReady`, `onTraktorCueQueueChanged`, `onTraktorCueQueueApplied`, `traktorCanSave` (types mirror the Engine ones).

- [ ] **Step 1: Failing tests** in `rekordboxCuesIpc.test.ts` (follow the Engine cases there): a `traktor:` id reads cues from the NML file `nml()` points at; `saveCues` with one Engine and one Traktor request enqueues each in its own queue; `cueDropInput` for a Traktor id with no rekordbox match returns `{grid, phrases: [], words}`. `traktorCueQueueIpc.test.ts` twin of the Engine one. `traktorDropInput.test.ts`: rekordbox match wins; unanalysed entry → null.
- [ ] **Step 2:** Run those three files → FAIL.
- [ ] **Step 3:** Implement and wire `index.ts` next to the Engine block (lines ~304-326 and ~1096-1115).
- [ ] **Step 4:** Tests PASS; both `tsc` configs clean.
- [ ] **Step 5:** Commit "Send Traktor cue reads, Auto mark input and saves to a queue that writes the collection once Traktor is closed".

### Task 5: Editor and queue pill for Traktor

**Files:**
- Modify: `src/renderer/src/App.tsx` (`cuesOpen`, a third `useRekordboxQueue`, its pill, `pendingCuePaths`), `src/renderer/src/hooks/useRekordboxQueue.ts` (`TRAKTOR_CUE_QUEUE`), `src/renderer/src/lib/rekordboxQueueText.ts` (`TRAKTOR_QUEUE_WORDS`, notice text for `cues-slot-dropped`), `src/renderer/src/components/CuesSection.tsx`, `src/renderer/src/lib/cueAutoMark.ts`, the 5 locale files, and their tests (`App.test.tsx`, `CuesSection.test.tsx`, `cueAutoMark.test.ts`, `rekordboxQueueText.test.ts`, `keys.test.ts` stays green).

**Interfaces:**
- Consumes: Task 4 preload API.
- Produces: `phraseless(contentId) = isEngineContent(id) || isTraktorContent(id)` used where `CuesSection`/`cueAutoMark` decide to fetch `cueDropInputQuery`; `TRAKTOR_COPY` with keys `editor.cues.traktor.{save,unanalysed,unreadable,queuedStale,saveFailed,autoUnreadable,noCollection,colours,saveAll_one,saveAll_other}` and `traktorQueue.*` (twins of `engineQueue.*` plus `notice.slotDropped`).

Behaviour: with a Traktor track and `traktorCanSave() === false`, Auto mark and Save are disabled and `editor.cues.traktor.noCollection` is shown; the (i) in the Cues header shows `editor.cues.traktor.colours` only for Traktor tracks; hot cue markers of a Traktor track paint `rekordboxColorOf(TRAKTOR_TYPE_COLOR[0])` for cues the user added or moved, existing ones keep their read colour; the colour picker is not offered for Traktor.

Copy (en; translate the same meaning to es, de, fr, pt-BR, no em dash):
- save "Save to Traktor"; unanalysed "Traktor has not analysed this track yet"; unreadable "Could not read the cues from Traktor"; queuedStale "The queued save was made before the track changed in Traktor and is out of date. You see what Traktor holds now."; saveFailed "Could not save to Traktor. The cues are still not saved"; autoUnreadable "Surco could not read the audio of this track"; noCollection "Choose your collection.nml in Settings → Output → Traktor so Surco can save"; colours "Traktor colours each cue by its type. Surco saves them as normal cues, in blue, and leaves button 1 to Traktor's AutoGrid"; saveAll "Save {{count}} track(s) to Traktor"; queue pill/applied/backup/unreadable/writeFailed/otherLibrary/notice.cuesChanged/discardConfirm/halted/elsewhere as the Engine strings with "Traktor" and "collection"; notice.slotDropped "Traktor has 7 buttons for Surco's cues, so cue H of {{track}} was not saved".

- [ ] **Step 1: Failing tests:** `cueAutoMark.test.ts` "asks the audio for a Traktor track, which has no phrases"; `CuesSection.test.tsx` "disables Auto mark and Save for a Traktor track until the collection is confirmed, saying where to set it" and "says once how Traktor colours cues, only for a Traktor track"; `App.test.tsx` "opens the Cues section for a playlist of the Traktor tab" and "shows the Traktor queue pill while saves wait for Traktor to close"; `rekordboxQueueText.test.ts` slot-dropped text.
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Those files PASS, then the full suite `npx vitest run` PASS, both `tsc` clean, `npx biome check src` clean.
- [ ] **Step 5:** Commit "Open the Cues section and Auto mark for Traktor tracks, with its own queue pill and copy".

### Task 6: Verify against a real collection

- [ ] **Step 1:** Ask the user for djotas' `collection.nml` (or one exported with 3 analysed tracks). Copy it to the scratchpad, set it as `traktorNmlPath` in a dev profile, run the app with the `run` skill, open a Traktor playlist, Auto mark three tracks, Save, Apply now.
- [ ] **Step 2:** `diff` the NML before and after: only those three ENTRYs' `CUE_V2` lines differ; AutoGrid and `TYPE=4` unchanged; new cues `TYPE="0"` on `HOTCUE` 1..7.
- [ ] **Step 3:** Report the diff and screenshots to the user; the real-Traktor check (open Traktor, cues on buttons 2-8 in blue) is djotas'.
