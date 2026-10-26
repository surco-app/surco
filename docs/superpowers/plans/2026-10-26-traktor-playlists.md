# Traktor Playlist Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Traktor tab edits playlists exactly as the rekordbox tab does: create, rename, delete, add, move, remove, separators.

**Architecture:** A model of `<PLAYLISTS>` parsed from the NML keeps every node's original text; edits resolve their ids against the NML as read, apply to the model, and only changed nodes are re-serialized. Edit ops ride the existing Traktor queue next to cue ops, in one write through `writeCollection`. The renderer's rekordbox-only editing gates become "editable source" and call the source's own API.

**Tech Stack:** Electron main + preload, React 19, TanStack Query, Vitest, Biome, i18next (en, es, de, fr, pt-BR).

**Spec:** `docs/superpowers/specs/2026-10-26-traktor-playlists-design.md`

## Global Constraints

- Worktree `/Users/vicent/code/surco-traktor-playlists` (branch `traktor-playlists`); commands from `apps/desktop`. Tests `npx vitest run <file>`; types `npx tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json` / `tsconfig.scenarios.json`; `npx biome check --write <files>`.
- Commit titles: one descriptive sentence, no body, no prefix.
- Nothing outside `<PLAYLISTS>` changes for an edit op; an unchanged node keeps its exact text.
- Writes only to the confirmed `settings.traktorNmlPath` (the queue's `collection`).
- Built-ins at the root (`Preparation`, `HISTORY`, `_LOOPS`, `_RECORDINGS`): no rename/delete; `HISTORY` no edit at all.
- Same `RekordboxPlaylistEdit`, `RekordboxEditResult`, `PlaylistAddReport`, `OpOutcome` shapes as rekordbox.
- UI copy in 5 locales, no em dash, no explanatory colon.

## Review Focus

- Two queued edits on one playlist (move then remove) while Traktor is open hit the rows the DJ saw. Test in Task 2.
- A playlist the DJ changed in Traktor after queuing: op refused `stale`, nothing written. Test in Task 2.
- A name with `&`, `"`, `<` round-trips through create/rename. Test in Task 1.
- Two sibling folders with the same name keep distinct ids and edits land on the right one. Tests in Tasks 1 and 3.
- Mixed batch (a cue op and an edit op) writes once and both land. Test in Task 2.

---

### Task 1: Model of `<PLAYLISTS>` with ids, stamps and serialization

**Files:** Create `src/main/traktorPlaylistModel.ts` (+ test). Modify `src/main/traktorPlaylists.ts` (+ test).

**Interfaces — Produces:**
- `parsePlaylists(nml: string): PlaylistModel | null` and `serializePlaylists(nml: string, model: PlaylistModel): string` (returns `nml` with only the changed nodes rewritten; byte-identical when nothing changed).
- `PlaylistModel { root: ModelNode; start: number; end: number }`; `ModelNode { id: string; kind: 'folder'|'playlist'|'smartlist'; name: string; uuid: string; rows: ModelRow[]; children: ModelNode[]; parent: ModelNode | null; text: string; dirty: boolean }`; `ModelRow { key: string; text: string }`.
- `nodeById(model, id): ModelNode | null` (`'root'` → the `$ROOT` folder); `rowLinkId(node, index) = \`${node.uuid}:${index}\``.
- `stampOf(node: ModelNode): number` (stable 32-bit hash: playlist → its row keys in order; folder → children kind+name in order); `traktorStamps(nml: string): Record<string, number>` keyed by node id.
- Folder ids: `folder:` + names joined by `/`, a sibling sharing an earlier sibling's name gets `#<n>` (n = 2, 3…) appended to its segment. `readTraktorTree` uses the same ids (switch it to the model).
- `readTraktorPlaylist` rows gain `linkId` (`rowLinkId`) and `separator: true` for rows whose collection ENTRY has `PLAYTIME` ≤ 2 and an empty `TITLE`.
- `traktorSeparatorKey(nml): string | null` — among separator ENTRYs, the key used most across playlists.

- [ ] Step 1: failing tests — round trip byte-identical on both fixtures and on a synthetic NML with folders, repeated rows and a smartlist; `#2` ids for twin folders; `linkId`s `"<uuid>:0".."<uuid>:n"`; separator rows flagged; `traktorSeparatorKey` picks the most used.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS (plus `traktorPlaylists*.test.ts`, `traktorCues*.test.ts`).
- [ ] Step 5: commit "Model Traktor's playlist tree with stable ids, row links and separators".

### Task 2: Apply edit ops and cue ops in one Traktor batch

**Files:** Create `src/main/traktorPlaylistEdit.ts` (+ test). Modify `src/main/traktorCuesWrite.ts` → exports `applyTraktorBatch` (rename of `applyTraktorCuesBatch`, callers updated) (+ test).

**Interfaces — Produces:** `applyTraktorBatch(nmlPath: string, ops: QueueOp[], deps: { ensureClosed; write? }): Promise<BatchResult>`; `planTraktorEdits(model, ops: EditOp[]): Map<string, OpOutcome>` resolving every id against the model as read, then applying in `opRank` order. Outcomes: `{applied:true, report?, createdId?}` or `{applied:false, reason:'stale'|'no-separator'|'nothing-to-add'}`; a non-applied edit gets the `edit-changed` notice like rekordbox. Stamps compared with `stampOf` of the as-read nodes.

Op semantics per spec (create appends child + COUNT; rename; delete subtree + COUNT; add resolves by `contentId` key else path → ENTRY LOCATION (NFC; uses `traktorFileOf`/bootVolume), counts `already`/`notInCollection`/`ambiguous`, appends, updates `ENTRIES`; move; remove; insertSeparator). New playlist: `<NODE TYPE="PLAYLIST" NAME="…"><PLAYLIST ENTRIES="0" TYPE="LIST" UUID="<32 hex>"></PLAYLIST>\n</NODE>`; new folder: `<NODE TYPE="FOLDER" NAME="…"><SUBNODES COUNT="0"></SUBNODES>\n</NODE>`; new row `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="…"></PRIMARYKEY>\n</ENTRY>`. Built-in guard per Global Constraints.

- [ ] Step 1: failing tests — each op; built-ins refused; stale stamp refused and nothing written; move+remove queued on the same playlist land on the rows as read; mixed cue + edit batch writes once; `&"<` names; output outside `<PLAYLISTS>` identical; output parses as XML (saxes is in devDependencies? if not, check balanced `NODE`/`SUBNODES`/`PLAYLIST` tags).
- [ ] Steps 2-4: FAIL → implement → PASS (plus `traktorCuesWrite.test.ts`).
- [ ] Step 5: commit "Apply Traktor playlist edits next to cue saves in one collection write".

### Task 3: IPC, queue wiring and preload

**Files:** Create `src/main/traktorPlaylistEditIpc.ts` (+ test). Modify `src/main/index.ts`, `src/main/i18n.ts` (+ test: `traktorQuitDetailPlaylists`), `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`.

**Interfaces — Produces:** IPC `traktor:edit` (edit, label?) → `RekordboxEditResult` (twin of `rekordbox:edit`: `EditOp` with `stamps` from `traktorStamps` for the nodes the edit names, enqueue, apply with `ensureTraktorClosed(win,'traktorQuitDetailPlaylists')`, announce others, wait or drop); `traktor:hasSeparator` → boolean. Preload `editTraktorPlaylist(edit, label?)`, `traktorHasSeparator()`. Queue `applyBatch` → `applyTraktorBatch`; `nodeStamps` stays `async () => ({})` (no refresh, per spec).

- [ ] TDD as above (IPC test twin of `rekordboxPlaylistsIpc` edit cases; twin-folder id lands on the right folder end to end through the IPC).
- [ ] Commit "Send Traktor playlist edits through the Traktor queue".

### Task 4: Renderer — editable Traktor tree, rows and menus

**Files:** Modify `src/renderer/src/App.tsx`, `hooks/useRekordboxEdits.ts`, `hooks/useSourceBrowser.ts`, `components/TrackContextMenu.tsx`, `components/SourceTree.tsx`, `lib/playlistEdits.ts`, locales; tests `App.test.tsx`, `useRekordboxEdits.test.tsx`, `SourceTree.test.tsx`, `playlistEdits.test.ts`.

**Behaviour:** "editable source" = rekordbox, or Traktor with `traktorCanSave()`. `useRekordboxEdits` takes the source and calls its API and query key. `treeEdit`, `trackMenuPlaylist`, `reorder`, `crateOpen`, `trackRef.contentId`, `canInsertSeparator` (`traktor:hasSeparator`) work for Traktor. SourceTree hides rename/delete for built-ins and refuses drops on `HISTORY` (prop `locked?: (node) => 'all' | 'rename' | null` or equivalent). Refusal and "running" copy has Traktor twins.

- [ ] TDD; full suite, types, lint green.
- [ ] Commit "Organise Traktor playlists from the Traktor tab as in rekordbox's".

### Task 5: Verify in the app

- [ ] Driver + synthetic collection (as in phase 2, profile settings backed up and restored): create folder and playlist, drop 3 tracks (one outside the collection → notice), reorder, insert separator, rename, delete; diff the NML; screenshots.
