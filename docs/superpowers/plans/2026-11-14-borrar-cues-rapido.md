# Borrar cues en lote, rápido

Measured 14/11 in the real built app on the soak fixture (APFS clone of the rekordbox collection, `$TMPDIR/surco-soak`): clearing 80 rekordbox tracks takes 17.3 s, with zero renderer long tasks. The time is `clearCueDrafts` (apps/desktop/src/renderer/src/lib/cueAutoMark.ts) calling `trackCuesQuery` once per track: each `cues:trackCues` IPC opens master.db from scratch (SQLCipher key derivation, ~80 ms, see `withCollection` in main/rekordboxPlaylistsIpc.ts) and parses the track's ANLZ analysis, waveform included (`readTrackCues` in main/rekordboxCues.ts). Clearing needs neither the analysis nor a fresh open per track: only each track's live cues and their fingerprint. At this rate a 13,280-track selection would take about 45 minutes.

## Global Constraints

- Behaviour of clearing does not change (same drafts, same counts, loops kept, unsaved drafts skipped). Only how the cues are read.
- The fingerprint must be exactly the one `readTrackCues` returns for the same track (`cueFingerprint(liveCues(db, id))`), or the draft key would not match the editor's and drafts would be dropped as stale.
- Programs other than rekordbox keep reading through their existing `trackCues` (their cost was not measured; do not invent a batched reader for them).
- Main-process reads stay read-only.
- No code comments. TDD with red seen first. Tests name WHY.
- Run tests from `apps/desktop` of the worktree with `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <paths>`. Typecheck all three projects from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit`, then `tsconfig.node.json`, then `tsconfig.scenarios.json`. Biome from apps/desktop. Full suite once before the last commit, report its exit code and any `FAIL|Unhandled|Errors` lines.
- Commit titles: one descriptive sentence, no prefix, no body, never --no-verify.

## Task 1: read many tracks' live cues in one go

1. `main/cueSource.ts`: add an optional `liveCues?(contentIds: string[]): Promise<Record<string, { cues: TrackCueRow[]; fingerprint: string }>>` to `CueReader`. A track that does not exist is absent from the record.
2. `main/rekordboxCueSource.ts`: implement it with ONE `withCollection` call (same `keyOf(path)` as `trackCues`) that prepares the cue statement once (`liveCuesQuery` in rekordboxCues.ts, export what is needed) and reads every id, skipping ids whose djmdContent row is missing or `rb_local_deleted`, fingerprint via `cueFingerprint`. No analysis read.
3. `main/cuesIpc.ts`: new handler `cues:liveCues` taking `contentIds: string[]`, grouping by `programOf`, using the source's `liveCues` when it has one and otherwise `trackCues` per id (mapping to `{ cues, fingerprint }`, skipping nulls). Returns one merged record.
4. Preload `preload/cues.ts` (+ its test table in `preload/cues.test.ts`, + the type in `preload/index.d.ts` or wherever the cues API type lives): `liveCues: (contentIds) => ipc.invoke('cues:liveCues', contentIds)`.
5. Renderer `clearCueDrafts`: read the targets in chunks of 500 through `window.api.cues.liveCues`, then do exactly what it does today per target, using `{ cues, fingerprint }` from the batch in place of `trackCuesQuery`'s `read`. Keep `queuedCuesQuery` per track as today. Update `cueAutoMark.test.ts` mocks accordingly; every existing clearCueDrafts test must keep its meaning.

Tests:
- rekordbox: reading many tracks opens the collection once (count opens through whatever seam the existing rekordboxCueSource / rekordboxCues tests use, e.g. a spied `openRekordboxDb` or the fixture helper) and returns, for each track, the same cues and fingerprint `readTrackCues` gives; a deleted or unknown id is absent.
- cuesIpc: `cues:liveCues` uses a source's `liveCues` when present and falls back to `trackCues` for a source without it, merging both programs into one record.
- preload: the new channel is in the table.
- clearCueDrafts: reads all targets through one `liveCues` call per 500 targets (e.g. 3 targets → 1 call) and never calls `cues.trackCues`.

## Task 2: twin plans skip drafts that carry nothing

Measured 15/11 on the soak fixture with Task 1 in place: clearing all 13,280 rows of `SOAK BIG` crashed the renderer ("Page crashed") after 11 minutes, without the tally ever showing. Cause: `twinPlansOf` (apps/desktop/src/renderer/src/lib/cueTwins.ts) fetches `trackCuesQuery` (the slow IPC that reopens master.db and parses the full analysis, waveform included, cached forever in the query cache) for EVERY draft, before finding out the draft carries no breaks. `CuesBatchSection` runs it in a `useQuery` keyed on the drafts, so after each new draft, and again on Save. A cleared draft never carries anything to another program: `carriedBreaks` only takes cues with an entry in `draft.origin` (placed by a flow), and `twinPlans` returns nothing for empty breaks.

Change: in `twinPlansOf`, skip a draft before any read when none of its cues has an entry in `draft.origin`. This must be exactly behaviour-preserving (same plans for every input), it only avoids reads whose result could not matter. Do not change `carriedBreaks` or `twinPlans`.

Tests (lib/cueTwins.test.ts, following its existing setup):
- a draft with no flow-placed cues is never read (`window.api.cues.trackCues` not called for it) and yields no plan, so clearing thousands of tracks does not read and cache every track's analysis;
- a draft with flow-placed cues is still read and planned exactly as before (an existing test may already cover it; keep it green).

## Task 3: one draft notification per batch

Measured 15/11 with Tasks 1-2 in place: clearing all 13,280 rows of `SOAK BIG` still crashed the renderer after 11 minutes. Experiment (uncommitted, reverted): setting all cleared drafts and notifying the draft listeners ONCE at the end made the same run finish in 43-74 s with the heap at 400-560 MB, tally right (75,364 hot cues, 106,572 CALLs). Cause: `keepDraft` (lib/cueSession.ts) calls `changed()` per track, which rebuilds the unsaved Set and re-renders every subscriber; `CuesBatchSection` then builds a new `cue-twin-plans-batch` query whose key holds every draft, so the query cache retains thousands of ever-growing keys. Discard has the same shape: `forgetDraft` per id took 3.8 s for 13,280. A second experiment (asking the queue without the query cache) changed nothing and is NOT part of this task. With 13,280 rows selected and nothing clicked, the renderer already spends 42.6 of every 50 s in long tasks; that background load is pre-existing and out of scope.

Change:
1. `lib/cueSession.ts`: add `keepDrafts(entries)` taking the same fields as `keepDraft` per entry (`contentId, draftKey, value, target, base`), setting them all and calling `changed()` once when at least one entry was set. Add `forgetDrafts(contentIds)` that deletes them all and calls `changed()` once when something was deleted. Keep `keepDraft`/`forgetDraft` unchanged for their existing callers.
2. `clearCueDrafts` (lib/cueAutoMark.ts): collect the cleared drafts and call `keepDrafts` once at the end instead of `keepDraft` per track. The counts and `cleared` list stay as they are.
3. `CuesBatchSection` discard of cleared drafts: call `forgetDrafts(cleared ids)` once instead of `forgetDraft` per id.

Tests (lib/cueSession.test.ts if it exists, else next to the existing session tests; cueAutoMark.test.ts; CuesBatchSection.test.tsx):
- keepDrafts of many entries notifies subscribers once (subscribeCueDrafts listener called once) and all become unsaved, so a big clear does not re-render the app once per track;
- forgetDrafts notifies once and removes them all; forgetDrafts of ids with no draft does not notify;
- clearCueDrafts on several tracks notifies the draft listeners once;
- existing clear and discard tests keep passing with their meaning.
