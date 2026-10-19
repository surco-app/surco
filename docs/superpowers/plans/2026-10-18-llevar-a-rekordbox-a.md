# Llevar a rekordbox, part A: the queue, new tracks, the Playlists field and tree rename/delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The DJ says in Surco's metadata form which rekordbox playlists a track goes to; when the track is converted or updated, Surco adds it to the rekordbox collection if it is not there (no analysis; rekordbox analyses it on open) and puts it in those playlists (and takes it out of the ones removed), through one persistent queue that applies at once when rekordbox is closed and waits, with a pill in the toolbar, when it is open. The tree gains Rename and Delete, through the same queue.

**Architecture:** Every write Surco makes into rekordbox becomes an operation in `rekordbox-queue.json` (userData): tree edits, a converted track's playlists (with the facts needed to add it to the collection, read when it was queued), and the conversion's repoint when rekordbox was open. `rekordboxQueue.ts` stores, summarises and applies the queue; `rekordboxPlaylistWrite.ts` becomes a batch writer that keeps every guarantee of phase 2a (plan read-only first, ask once, WAL fold, session and per-write backups, rekordbox checked again, one transaction, the XML written just before the commit, SQLite rollback first) and adds a savepoint per operation, the phases of the spec (new tracks, new playlists, links, renames, deletes) and the XML node `Timestamp` bump that rekordbox itself makes when a playlist's tracks change. Conflicts are found by that `Timestamp` (measured: rekordbox moves it, not `djmdPlaylist.updated_at`). `rekordboxQueueWatch.ts` polls `isRekordboxRunning` every 5 s while there is work and applies when rekordbox closes. The renderer gets a `Playlists` pseudo-field (not a tag: its value is the set of playlists the track must be in) shown, hidden and ordered in Settings › Campos, dots in each list row, the pending pill, and Rename/Delete in the tree.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, lucide-react, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), biome.

**Spec:** `docs/superpowers/specs/2026-10-18-llevar-a-rekordbox-design.md` (binding), the measurements it rests on `docs/llevar-a-rekordbox-medidas.md` (spikes (a) and (b), checked by Vicent in real rekordbox on 18/10) and the write-safety facts of phase 2a `docs/rekordbox-playlists-escritura.md`.

**Split:** the spec is two independent deliverables on one queue. This plan (A) builds the queue and Flow 1 (tracks, playlists field, tree rename/delete). Plan B (`docs/superpowers/plans/2026-10-18-llevar-a-rekordbox-b.md`) builds the Cues section, the list swatches and "complete on close" on top of A's queue. Execute A first; B starts from A's merged code. The USB export has its own plan (`docs/superpowers/plans/2026-10-16-export-usb.md`); nothing here re-plans it. Plan B shares `anlz.ts` with that plan's Task 4 (see B).

**Out of scope (spec "Fuera de alcance" plus):** Surco analysing audio or writing ANLZ, smart playlists, BPM/key/grid, track colours and My Tags, moving playlists between folders, Engine DJ and Traktor, Vicent's `rekordbox-cues` script; the Cues section and "complete on close" (plan B).

## Global Constraints

- **Never open, copy onto or point the app at `~/Library/Pioneer/rekordbox/master.db` or `masterPlaylists6.xml` for writing.** Tests write only temp copies of the encrypted fixture (`rekordboxPlaylistsFixture.ts`) or in-memory databases. The final verification uses a copy in the scratchpad and Vicent's own swap, as in the spikes.
- **Every write goes through `applyRekordboxBatch`** (`rekordboxPlaylistWrite.ts`): plan read-only, `ensureClosed` at most once per batch and only when something will be written, `wal_checkpoint(TRUNCATE)` (no complete fold, no backup, no write), session backup (`.surco-session`) and per-write backup (`.surco-backup`) of `master.db` and, when it exists, `masterPlaylists6.xml`; `isRekordboxRunning()` again right before the write; one transaction (`BEGIN … COMMIT`) with a `SAVEPOINT` per operation; the XML written through `replaceFile` just before `COMMIT`; on failure SQLite's rollback first, the XML restored from its copy if it was written, and `master.db` copied back only when the rollback itself failed (`restoreCollection`). No backup, no write.
- **Order inside one batch** (spec): new tracks (`djmdContent`), new playlists, links (adds, removes, moves, separators), renames, deletes. Repoints of the conversion run before the batch through the existing `repointTracks`.
- **Never delete or rewrite a `djmdContent` row's identity.** Removing a track from a playlist deletes `djmdSongPlaylist` rows only. Deleting a playlist or folder deletes its `djmdPlaylist` rows (and descendants), their `djmdSongPlaylist` links and their XML nodes, never `djmdContent` and never a file.
- **A track already in the collection is reused, never duplicated**: by `contentId` when the queued operation carries a live one, else `findTrackByPath` over the final path with `realPath: realpathSync`. Two rows for one file: skipped and said ("rekordbox la tiene dos veces"). Nothing found: added, only when the operation wants at least one playlist.
- **A new `djmdContent` row** follows the spike's validated mould (medidas, "Qué se ha escrito en el candidato"): `ID` random 28-bit ≥ 100 unused, `MasterSongID` = `ID`, `MasterDBID` and `DeviceID` from `djmdDevice`, `UUID` v4, `FolderPath` = the path as Surco has it in NFC (link not resolved), `FileNameL` its basename, `FileType` from `FILE_TYPES`, `FileSize` from `stat`, `rb_file_id` = the inode as signed 64-bit text, `Length` = floor(duration), `BitRate` (PCM: rate × bits × channels / 1000 floored; else the probe's kbps), `BitDepth` (lossy: 16), `SampleRate`, `DateCreated` = file birthtime as local `YYYY-MM-DD`, `StockDate` = today local, `ContentLink` 2950670, `ExtInfo` 'null', `BPM` 0, `Analysed` 0, `AnalysisDataPath` '', `ImagePath` '', `KeyID` NULL, `AnalysisUpdated`/`TrackInfoUpdated`/`CueUpdated` NULL, `HotCueAutoLoad` 'on', `DeliveryControl` 'on', `ColorID` '0', `VideoAssociate` '0', empty strings for `FileNameS`, `Subtitle`, `ReleaseDate`, `Lyricist`, `OrgFolderPath`, `Reserved1`, `ModifiedByRBM`, `DeliveryComment`, zeros for `Rating`, `DJPlayCount`, `TrackNo`, `DiscNo`, `ReleaseYear`, `ServiceID`, `LyricStatus`, `SamplerTrackInfo`, `SamplerPlayOffset`, `SamplerGain`; artist, album, genre, label, remixer, comment, year, track and disc through the existing `applyRekordboxMeta` (WAV: no label, no ISRC, no track number, as measured). No `contentFile` rows, no artwork (Decision 2).
- **Rows as rekordbox makes them** (phase 2a rules, unchanged): link `ID`/`UUID` = `randomUUID()`, playlist `ID` random 28-bit ≥ 100 unused in the table and the XML, `rekordboxStamp(now)`, `rb_local_usn` from `takeLocalUsn`, `rb_local_synced` 0, `rb_local_deleted` 0, `usn` NULL, `TrackNo` 1..N after every change, new playlists last among live siblings (`Seq = max + 1`).
- **XML:** a playlist whose links change, or that is renamed, gets its node's `Timestamp` set to now in ms and nothing else in the line; a new playlist gets its node appended (2a); a deleted node and its descendants lose their lines. `djmdPlaylist.updated_at` is never touched for link changes (measured). CRLF and every other byte stay.
- **Conflicts, rekordbox wins and Surco says so**: an operation records, when it is queued, the `Timestamp` of every playlist node it may touch; at apply time a node whose `Timestamp` differs drops that part of the operation with a notice. A link removal from a playlist the operation never recorded (the track was added to it in rekordbox after queueing) is also a conflict. Without an XML (rekordbox 5) there is no conflict check.
- **Writing the Playlists field and tree edits do not depend on the `syncRekordbox` toggle** (spec Decision 3). The repoint stays gated by it, as today.
- **The field is not a tag:** key `rekordboxPlaylists`, never in `TrackMetadata`, never written to audio, never in required fields, `{token}` names, find and replace or the inspector.
- UI text in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`), Spanish first; no em dash and no explanatory colon in any UI text. Errors cross IPC as codes and are translated in the renderer.
- Test selectors: `data-testid` first, then roles and text; never CSS classes. Mocks of `window.api` are typed: `vi.fn<Api['method']>()`.
- **Comments: none in new code** (coordinator's rule for this plan, 18/10). This reverses the 2a and USB plans' ruling that followed the repo's habit of commenting every block; existing comments in touched files stay as they are, new lines get none. Flagged so nobody adds them back and nobody strips the old ones.
- Tests from `apps/desktop` of the worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (the worktree has no `node_modules`; never filter from the repo root, it skips the setup). Types from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit` and `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` (bare `tsc` checks nothing). Lint and format: `npm exec --workspace apps/desktop -- biome check --write src` (from the worktree root).
- Locale strings are merged with this helper (run from `apps/desktop`). Write it once:

```bash
export SCRATCH=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad
cat > "$SCRATCH/merge-locale.cjs" <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const additions = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const dir = path.join(process.cwd(), 'src/renderer/src/i18n/locales')
const merge = (into, from) => {
  for (const [key, value] of Object.entries(from)) {
    if (value && typeof value === 'object' && into[key] && typeof into[key] === 'object') merge(into[key], value)
    else into[key] = value
  }
}
for (const [locale, tree] of Object.entries(additions)) {
  const file = path.join(dir, `${locale}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  merge(data, tree)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}
EOF
```

- Commits: descriptive English title only, no body, no `feat:`/`fix:`, never `--no-verify`. One per task unless the task says otherwise. Each commit compiles and its tests pass.

## Decisions taken where the spec or the measurements left room

1. **The conflict fingerprint is the XML node `Timestamp` recorded at queue time**, not `djmdPlaylist.updated_at` (medidas: rekordbox does not move `updated_at` when adding or reordering). Comparing with the recorded value rather than with the queue time keeps Surco's own earlier writes from reading as rekordbox's.
2. **No artwork on a new track.** The spec asks for `rekordboxArtwork.ts`; the measurements (written after the spec, which they correct) show rekordbox extracting the artwork itself and the spike validated the row with `ImagePath` ''. The final checklist asks Vicent whether a new track with embedded art shows it after rekordbox analyses it; if not, a follow-up adds `stageArtwork` with its own real-rekordbox check.
3. **One operation per track** (`kind: 'track'`) carries the wanted set, the facts for adding it and the recorded timestamps; the diff against rekordbox is computed when the batch is written, not when it is queued, so a repoint or an add queued earlier in the same batch is seen. The batch still runs in the spec's phase order.
4. **Tree edits all go through the queue**, not only create/rename/delete: an edit is queued and the queue is applied at once with today's dialog; Cancel (or rekordbox reopening) leaves it queued and the notice says it will apply on close. Renaming and deleting travel as two new kinds of the existing `rekordbox:edit` channel (`{ kind: 'rename' }`, `{ kind: 'delete' }`) instead of the spec's separate `rekordbox:renamePlaylist`/`rekordbox:deletePlaylist`: same writer, same dialog, same hook.
5. **The conversion's repoint enters the queue only when it was blocked by rekordbox being open** (the spec's "hoy se pierde con Cancelar"). With rekordbox closed it runs as today, in its own transaction, before the queue's batch: two transactions for one conversion run in that case, not one. Folding the repoint into the batch writer would rewrite a tested production path (`repointTracks`) for no user-visible gain; flagged.
6. **Renaming moves the node's `Timestamp` and sets `Name`, `updated_at` and `rb_local_usn`.** The spike did not measure a rename (medidas has no line on it); moving the `Timestamp` is the safe side for rekordbox's own USB sync. The final checklist has Vicent rename one playlist and check rekordbox and the USB sync.
7. **Deleting renumbers the following siblings' `Seq`** (`Seq - 1`, new `rb_local_usn`, `updated_at`), keeping `Seq` 1..n per parent as measured.
8. **The queue writes no `rb_local_usn` other than through `takeLocalUsn`** and stamps all rows of one batch with one `now`.
9. **The applied notice is not shown for a direct tree edit** (it already gets its own line from `editMessage`); it is shown for applies from the watcher, "Aplicar ahora" and conversions.
10. **A failed apply that is not "rekordbox open" waits for the next close** (watcher disarmed until it sees rekordbox running again), so a missing backup does not retry every 5 s.
11. **Dots use the accent colour.** The spec says "el color de rekordbox de la fuente" but the rail draws the rekordbox icon in the text colour and there is no rekordbox token; accent matches Surco's rule that colour marks Surco's own state.
12. **The field's options come from the tree query** (`['source-tree', 'rekordbox']`), enabled whenever a collection exists, so a tree edit, an apply or a refocus refreshes the field and the tree together.
13. **Membership for dots and the field's initial value** comes from `rekordbox:membership`, one read for the visible rows; `findTrackByPath` gets an optional `quiet` flag so this read does not log a miss for every working-list track rekordbox never had.
14. **The "rekordbox open" dialog after a conversion run is no longer shown for rekordbox** (the repoint is queued and the pill says so). The review's tag sync keeps its dialog.
15. **Deleting a playlist or folder deletes its `djmdPlaylist` rows** (and their links) instead of setting `rb_local_deleted`, as rekordbox does with links (medidas: nobody soft-deletes). A real delete in rekordbox was not measured; Task 16 has Vicent check one.
16. **Rename and delete are new kinds of `RekordboxPlaylistEdit`** (Decision 4), so `editProblem`, the writer and `editMessage` stay one switch each.
17. **Link edits move the node `Timestamp`, tree edits included.** Phase 2a wrote that link edits never touch `masterPlaylists6.xml`; the spike measured rekordbox moving it (Makina, 19:00:36.518), so 2a's moves, removes, separators and adds now move it too, and the XML is backed up whenever it exists and something is written. Replaces the 2a test that asserted the XML untouched.
18. **Phases are per operation.** Each queued operation runs whole inside its own `SAVEPOINT`, operations sorted by the spec's phase (tracks, creates, links, renames, cues, deletes). A track operation does its own add, new playlists and links in that order. The one cross-operation dependency, the same new playlist name on two tracks, is one map per batch (Task 5).

## Review Focus

1. **A track converted twice before rekordbox closes, or the same new playlist name typed on two tracks.** One alta, one new playlist, both tracks in it. Pinned in Task 5 (one `createNode` per name in a batch) and Task 7 (a later track operation for the same path replaces the earlier one).
2. **Two rows in the collection for the converted file (the symlinked twins), or the file deleted before rekordbox closes.** Nothing written for that track, the notice names it, the rest of the batch applies. Pinned in Task 5.
3. **rekordbox reopened between the dialog and the write, or the backup failing.** Nothing written, the queue keeps everything, the watcher does not hammer. Pinned in Task 4 (writer), Task 6 (queue) and Task 7 (watcher disarm).
4. **A playlist changed in rekordbox while Surco waited (added to, reordered, renamed, deleted).** Surco drops only its own part for that playlist and says so; a track added in rekordbox meanwhile to a playlist Surco wants to remove it from is not removed. Pinned in Task 5.
5. **Rename or delete of a folder with nested folders, and the XML missing a node or carrying extra ones.** Descendants go, `djmdContent` is untouched, other nodes stay byte for byte, a missing node is not an error. Pinned in Task 1 (XML helpers) and Task 3 (edits).

---

## File structure

| File | Responsibility |
|---|---|
| `src/main/rekordboxMasterXml.ts` (mod) | node timestamps, move one, remove nodes |
| `src/main/rekordboxPlaylistsFixture.ts` (mod) | the real `djmdContent` columns, lookup tables, `djmdDevice`, per-node timestamps |
| `src/main/rekordboxContentAdd.ts` (new) | facts of a new track, the new `djmdContent` row, file facts |
| `src/main/rekordboxDb.ts` (mod) | `findTrackByPath` quiet flag |
| `src/main/rekordboxPlaylistEdit.ts` (mod) | rename, delete, a track's playlists, remove one track from one playlist |
| `src/main/rekordboxQueueOps.ts` (new) | queue operation types, outcomes, recorded timestamps |
| `src/main/rekordboxPlaylistWrite.ts` (mod) | `applyRekordboxBatch`; `editRekordboxPlaylist` on top of it |
| `src/main/rekordboxQueue.ts` (new) | the queue file, state, apply with repoints first |
| `src/main/rekordboxQueueWatch.ts` (new) | poll while there is work, apply on close |
| `src/main/rekordboxBatch.ts` (mod) | a repoint carries the track's wanted playlists |
| `src/main/processTrack.ts` (mod) | attaches a job's playlists to its repoint |
| `src/main/rekordboxQueueFromRun.ts` (new) | queue operations out of a finished conversion run |
| `src/main/libraryFlushes.ts` (mod) | queues the blocked repoints and the run's playlists, applies |
| `src/main/rekordboxMembership.ts` (new) | which playlists hold each track |
| `src/main/rekordboxQueueIpc.ts` (new) | queue, apply now, discard, membership channels |
| `src/main/rekordboxPlaylistsIpc.ts` (mod) | `rekordbox:edit` through the queue |
| `src/main/index.ts` (mod) | queue, watcher, broadcast, wiring |
| `src/shared/types.ts` (mod) | targets, new edit kinds, queue state and events, membership, job and session fields, setting |
| `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (mod) | new calls and stubs |
| `src/renderer/src/lib/rekordboxPlaylists.ts` (new) | options from the tree, targets, effective value, bulk state |
| `src/renderer/src/components/PlaylistsField.tsx` (new) | tokens, search, create; the bulk variant |
| `src/renderer/src/components/PlaylistDots.tsx` (new) | the row's dots |
| `src/renderer/src/components/RekordboxQueuePill.tsx` (new) | the pill and its menu |
| `src/renderer/src/hooks/useRekordboxQueue.ts` (new) | queue state, events, notices, apply, discard |
| `src/renderer/src/hooks/useRekordboxMembership.ts` (new) | membership query |
| `src/renderer/src/lib/fields.ts`, `lib/fieldSpecs.ts`, `components/MetadataForm.tsx`, `components/FieldsEditor.tsx`, `components/Editor.tsx`, `components/TrackList.tsx`, `components/Toolbar.tsx`, `components/SourceTree.tsx`, `lib/playlistEdits.ts`, `hooks/useRekordboxEdits.ts`, `lib/dirty.ts`, `lib/sessionEdits.ts`, `hooks/useTrackLibrary.ts`, `hooks/useTrackProcessing.ts`, `types.ts`, `App.tsx`, `components/SettingsModal.tsx` (mod) | wiring |
| `src/renderer/src/i18n/locales/*.json` (mod) | `fields.rekordboxPlaylists`, `editor.playlists`, `trackList.playlists*`, `rekordboxQueue`, `sources.tree`, `sources.edit.refused.queued` |

All paths below are relative to `apps/desktop/` unless they start with `docs/`.

---

## Task list

| # | Task | Owns |
|---|---|---|
| 1 | XML node timestamps and removal | `rekordboxMasterXml.ts` |
| 2 | A fixture with real `djmdContent` columns, and the new-track row | `rekordboxPlaylistsFixture.ts`, `rekordboxContentAdd.ts` |
| 3 | Rename, delete, a track's playlists, a quiet lookup | `rekordboxPlaylistEdit.ts`, `rekordboxDb.ts`, `shared/types.ts` |
| 4 | The batch writer | `rekordboxPlaylistWrite.ts`, `rekordboxQueueOps.ts` |
| 5 | Track operations inside the batch: add to collection, diff, conflicts | `rekordboxQueueOps.ts`, `rekordboxPlaylistWrite.ts` |
| 6 | The queue file and its apply | `rekordboxQueue.ts` |
| 7 | Apply when rekordbox closes | `rekordboxQueueWatch.ts` |
| 8 | A conversion run fills the queue | `rekordboxBatch.ts`, `processTrack.ts`, `rekordboxQueueFromRun.ts`, `libraryFlushes.ts` |
| 9 | Membership, IPC, preload and wiring | `rekordboxMembership.ts`, `rekordboxQueueIpc.ts`, `rekordboxPlaylistsIpc.ts`, `index.ts`, preload |
| 10 | The renderer's playlist model and the track's wanted set | `lib/rekordboxPlaylists.ts`, `types.ts`, `lib/dirty.ts`, `lib/sessionEdits.ts`, `useTrackProcessing.ts` |
| 11 | The Playlists field | `components/PlaylistsField.tsx` |
| 12 | The field in the form and in Campos | `lib/fields.ts`, `lib/fieldSpecs.ts`, `MetadataForm.tsx`, `FieldsEditor.tsx`, `Editor.tsx`, `App.tsx` |
| 13 | Dots in the list | `PlaylistDots.tsx`, `useRekordboxMembership.ts`, `TrackList.tsx` |
| 14 | The pending pill | `RekordboxQueuePill.tsx`, `useRekordboxQueue.ts`, `Toolbar.tsx` |
| 15 | Rename and Delete in the tree | `SourceTree.tsx`, `playlistEdits.ts`, `useRekordboxEdits.ts` |
| 16 | Verify on a copy, then Vicent in real rekordbox | none (checklist) |

---

### Task 1: XML node timestamps and removal

**Files:**
- Modify: `src/main/rekordboxMasterXml.ts` (append after `xmlNodeIds`, line 42)
- Test: `src/main/rekordboxMasterXml.test.ts` (append)

**Interfaces:**
- Consumes: `hexId(id: string): string` (existing).
- Produces:
  - `nodeTimestamp(xml: string, id: string): number | null` (decimal row ID in, the node's `Timestamp` out, null when the XML has no node for it)
  - `withNodeTimestamp(xml: string, id: string, timestamp: number): string` (only the `Timestamp` value of that one node changes; no node, same text back)
  - `withoutNodes(xml: string, ids: string[]): string` (drops the whole line of each named node, line ending included; every other byte stays)

- [ ] **Step 1: Write the failing tests**

Append to `src/main/rekordboxMasterXml.test.ts` (merge the new names into the existing import from `./rekordboxMasterXml`):

```ts
import { nodeTimestamp, withNodeTimestamp, withoutNodes } from './rekordboxMasterXml'

const THREE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '',
  '<MASTER_PLAYLIST Version="3.0.0" AutomaticSync="0">',
  '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="Pioneer DJ"/>',
  '  <PLAYLISTS>',
  '    <NODE Id="3E8" ParentId="0" Attribute="1" Timestamp="1767225600000" Lib_Type="0" CheckType="0"/>',
  '    <NODE Id="7D0" ParentId="3E8" Attribute="0" Timestamp="1767225600001" Lib_Type="0" CheckType="0"/>',
  '    <NODE Id="BB8" ParentId="0" Attribute="0" Timestamp="1767225600002" Lib_Type="0" CheckType="0"/>',
  '    <NODE Id="ITUNES" ParentId="0" Attribute="0" Timestamp="5" Lib_Type="1" CheckType="0"/>',
  '  </PLAYLISTS>',
  '</MASTER_PLAYLIST>',
  '',
].join('\r\n')

describe('masterPlaylists6.xml node timestamps', () => {
  it('reads the Timestamp of the node for a decimal row ID', () => {
    expect(nodeTimestamp(THREE, '2000')).toBe(1767225600001)
    expect(nodeTimestamp(THREE, '3000')).toBe(1767225600002)
  })

  it('says null for a playlist the XML has no node for', () => {
    expect(nodeTimestamp(THREE, '4000')).toBeNull()
  })

  it('never reads a ParentId as the node it points at', () => {
    const onlyChild = THREE.replace(/.*Id="3E8".*\r\n/, '')
    expect(nodeTimestamp(onlyChild, '1000')).toBeNull()
  })

  // rekordbox moves only this value when a playlist's tracks change (medidas); its own
  // sync to a USB compares it, so any other byte moved would be a change Surco invented.
  it('moves only the one node Timestamp and keeps every other byte', () => {
    const next = withNodeTimestamp(THREE, '2000', 1797000000000)
    expect(next).toBe(THREE.replace('Timestamp="1767225600001"', 'Timestamp="1797000000000"'))
  })

  it('leaves the text alone when the node is missing', () => {
    expect(withNodeTimestamp(THREE, '4000', 1797000000000)).toBe(THREE)
  })
})

describe('masterPlaylists6.xml node removal', () => {
  // A deleted playlist whose node stayed would come back in rekordbox's tree as a
  // node with no row, and its CRLF must not be left behind as a blank line.
  it('drops the named nodes whole, line ending included', () => {
    const next = withoutNodes(THREE, ['1000', '2000'])
    expect(next).toBe(
      THREE.replace(/.*Id="3E8".*\r\n/, '').replace(/.*Id="7D0".*\r\n/, ''),
    )
    expect(next).toContain('Id="BB8"')
    expect(next).toContain('Id="ITUNES"')
    expect(next.includes('\r\n\r\n    <NODE')).toBe(false)
  })

  it('ignores IDs the XML never had', () => {
    expect(withoutNodes(THREE, ['4000'])).toBe(THREE)
  })

  it('keeps a node whose ParentId names a removed one, for the caller to name too', () => {
    expect(withoutNodes(THREE, ['1000'])).toContain('Id="7D0"')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/desktop`): `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxMasterXml.test.ts`
Expected: FAIL, `nodeTimestamp is not a function` (and the other two).

- [ ] **Step 3: Implement**

Append to `src/main/rekordboxMasterXml.ts`:

```ts
function nodeTag(xml: string, id: string): RegExpExecArray | null {
  return new RegExp(`<NODE [^>]*\\bId="${hexId(id)}"[^>]*>`).exec(xml)
}

export function nodeTimestamp(xml: string, id: string): number | null {
  const tag = nodeTag(xml, id)
  const value = tag && /\bTimestamp="(\d+)"/.exec(tag[0])
  return value ? Number(value[1]) : null
}

export function withNodeTimestamp(xml: string, id: string, timestamp: number): string {
  const tag = nodeTag(xml, id)
  if (!tag) return xml
  const next = tag[0].replace(/\bTimestamp="\d+"/, `Timestamp="${timestamp}"`)
  return `${xml.slice(0, tag.index)}${next}${xml.slice(tag.index + tag[0].length)}`
}

export function withoutNodes(xml: string, ids: string[]): string {
  const doomed = new Set(ids.map(hexId))
  return xml
    .split(/(?<=\n)/)
    .filter((line) => {
      const id = /<NODE [^>]*\bId="([^"]+)"/.exec(line)
      return !(id && doomed.has(id[1]))
    })
    .join('')
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxMasterXml.test.ts`
Expected: PASS, the old `hexId`/`withPlaylistNode` tests included.

- [ ] **Step 5: Lint, types, commit**

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/rekordboxMasterXml.ts apps/desktop/src/main/rekordboxMasterXml.test.ts
git commit -m "Read, move and remove masterPlaylists6.xml node timestamps"
```

---

### Task 2: A fixture with real `djmdContent` columns, and the new-track row

**Files:**
- Modify: `src/main/rekordboxPlaylistsFixture.ts` (the `CREATE TABLE djmdContent` statement, the content insert, `PlaylistFixture`, `fixtureXml`)
- Create: `src/main/rekordboxContentAdd.ts`
- Test: `src/main/rekordboxContentAdd.test.ts`

**Interfaces:**
- Consumes: `FILE_TYPES` (`rekordboxDb.ts`), `applyRekordboxMeta`, `RekordboxMeta` (`rekordboxMetadata.ts`), `randomPlaylistId` (`rekordboxPlaylistEdit.ts`), `rekordboxStamp`, `takeLocalUsn`, `unusedRowId` (`rekordboxRows.ts`), `TrackProperties` (`shared/types.ts`).
- Produces:
  - `PlaylistFixture.device?: { ID: string; MasterDBID: string }` (default `{ ID: '7', MasterDBID: '3216549870' }`), `PlaylistFixture.artists?: { ID: string; Name: string }[]`, `PlaylistFixture.xmlTimestamps?: Record<string, number>` (decimal playlist ID to its node's `Timestamp`; default 1767225600000), `FixtureContent.UUID?: string` (default `uuid-c-<ID>`)
  - `interface ContentFacts { path: string; fileType: number; fileSize: number; inode: string; createdMs: number; durationSec: number; sampleRate: number; bitDepth: number; bitRateKbps: number; meta: RekordboxMeta }` (JSON-safe: it is stored in the queue)
  - `interface ContentProbe { properties(path: string): Promise<Pick<TrackProperties, 'sampleRateHz' | 'bitDepth' | 'channels' | 'bitrateKbps'>>; duration(path: string): Promise<number | null> }`
  - `readContentFacts(path: string, meta: RekordboxMeta, probe: ContentProbe): Promise<ContentFacts | null>` (null for a format rekordbox does not import, or no duration)
  - `insertContent(db: Db, facts: ContentFacts, ctx: { now: Date; newContentId?: () => string }): string` (the new `djmdContent.ID`)
  - `CONTENT_LINK = 2950670`

- [ ] **Step 1: Extend the fixture**

In `src/main/rekordboxPlaylistsFixture.ts` add `UUID?: string` to `FixtureContent`, and to `PlaylistFixture`:

```ts
  device?: { ID: string; MasterDBID: string }
  artists?: { ID: string; Name: string }[]
  xmlTimestamps?: Record<string, number>
```

Above `writeRekordboxPlaylistFixture` add:

```ts
const LOOKUP_COLUMNS = `UUID VARCHAR(255), rb_data_status INTEGER DEFAULT 0,
  rb_local_data_status INTEGER DEFAULT 0, rb_local_deleted TINYINT(1) DEFAULT 0,
  rb_local_synced TINYINT(1) DEFAULT 0, usn BIGINT, rb_local_usn BIGINT, created_at DATETIME,
  updated_at DATETIME`
```

Replace the `CREATE TABLE djmdContent (...)` statement inside the `db.exec` template with these tables (the columns the spike wrote and rekordbox accepted, medidas "Qué se ha escrito en el candidato"):

```sql
    CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255),
      FileNameL VARCHAR(255), FileNameS VARCHAR(255), Title VARCHAR(255), ArtistID VARCHAR(255),
      AlbumID VARCHAR(255), GenreID VARCHAR(255), BPM INTEGER, Length INTEGER, TrackNo INTEGER,
      BitRate INTEGER, BitDepth INTEGER, Commnt TEXT, FileType INTEGER, Rating INTEGER,
      ReleaseYear INTEGER, RemixerID VARCHAR(255), LabelID VARCHAR(255), OrgArtistID VARCHAR(255),
      KeyID VARCHAR(255), StockDate VARCHAR(255), ColorID VARCHAR(255), DJPlayCount INTEGER,
      ImagePath VARCHAR(255), MasterDBID VARCHAR(255), MasterSongID VARCHAR(255),
      AnalysisDataPath VARCHAR(255), SearchStr VARCHAR(255), FileSize INTEGER, DiscNo INTEGER,
      ComposerID VARCHAR(255), Subtitle VARCHAR(255), SampleRate INTEGER, DisableQuantize INTEGER,
      Analysed INTEGER, ReleaseDate VARCHAR(255), DateCreated VARCHAR(255), ContentLink INTEGER,
      Tag VARCHAR(255), ModifiedByRBM VARCHAR(255), HotCueAutoLoad VARCHAR(255),
      DeliveryControl VARCHAR(255), DeliveryComment VARCHAR(255), CueUpdated VARCHAR(255),
      AnalysisUpdated VARCHAR(255), TrackInfoUpdated VARCHAR(255), Lyricist VARCHAR(255),
      ISRC VARCHAR(255), SamplerTrackInfo INTEGER, SamplerPlayOffset INTEGER, SamplerGain FLOAT,
      VideoAssociate VARCHAR(255), LyricStatus INTEGER, ServiceID INTEGER,
      OrgFolderPath VARCHAR(255), Reserved1 TEXT, ExtInfo TEXT, rb_file_id VARCHAR(255),
      DeviceID VARCHAR(255), UUID VARCHAR(255), rb_data_status INTEGER DEFAULT 0,
      rb_local_data_status INTEGER DEFAULT 0, rb_local_deleted INTEGER DEFAULT 0,
      rb_local_synced INTEGER DEFAULT 0, usn BIGINT, rb_local_usn BIGINT, created_at DATETIME,
      updated_at DATETIME);
    CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
      SearchStr VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
      AlbumArtistID VARCHAR(255), ImagePath VARCHAR(255), Compilation INTEGER,
      SearchStr VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdLabel (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP_COLUMNS});
    CREATE TABLE djmdDevice (ID VARCHAR(255) PRIMARY KEY, MasterDBID VARCHAR(255),
      Name VARCHAR(255), ${LOOKUP_COLUMNS});
```

Replace the content insert (statement and loop) with one that also writes `UUID`, followed by the device and artists:

```ts
  const content = db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, Title, Length, BPM,
       Rating, KeyID, UUID, rb_local_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const c of data.content) {
    content.run(
      c.ID,
      c.FolderPath,
      basename(c.FolderPath),
      c.FileType,
      c.FileSize ?? 0,
      c.Title,
      c.Length,
      c.BPM ?? 0,
      c.Rating ?? 0,
      c.KeyID ?? null,
      c.UUID ?? `uuid-c-${c.ID}`,
      c.deleted ? 1 : 0,
    )
  }
  const device = data.device ?? { ID: '7', MasterDBID: '3216549870' }
  db.prepare(
    `INSERT INTO djmdDevice (ID, MasterDBID, Name, created_at, updated_at) VALUES (?, ?, 'Mac', ?, ?)`,
  ).run(device.ID, device.MasterDBID, FIXTURE_STAMP, FIXTURE_STAMP)
  const artist = db.prepare(
    `INSERT INTO djmdArtist (ID, Name, rb_local_deleted, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
  )
  for (const a of data.artists ?? []) artist.run(a.ID, a.Name, FIXTURE_STAMP, FIXTURE_STAMP)
```

In `fixtureXml`, replace the literal `Timestamp="1767225600000"` with `Timestamp="${data.xmlTimestamps?.[p.ID] ?? 1767225600000}"`.

Run (from `apps/desktop`): `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistWrite.test.ts src/main/rekordboxPlaylistEdit.test.ts src/main/rekordboxPlaylists.test.ts src/main/rekordboxPlaylistsIpc.test.ts src/main/rekordboxRows.test.ts`
Expected: PASS (columns and tables were only added).

- [ ] **Step 2: Write the failing tests**

Create `src/main/rekordboxContentAdd.test.ts`:

```ts
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import {
  CONTENT_LINK,
  type ContentFacts,
  insertContent,
  readContentFacts,
} from './rekordboxContentAdd'
import { openRekordboxDb } from './rekordboxDb'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const NOW = new Date(2026, 9, 18, 23, 30)
const META = rekordboxMetaFrom({
  ...emptyMetadata(),
  title: 'Last Night',
  artist: 'Ultra Naté',
  album: 'Fussion V2',
  genre: 'Hard House',
  publisher: 'Blanco y Negro',
  trackNumber: '3',
})

function facts(over: Partial<ContentFacts> = {}): ContentFacts {
  return {
    path: '/Volumes/Public/Music/Last Night.wav',
    fileType: 11,
    fileSize: 81234567,
    inode: '-4611686018427387904',
    createdMs: new Date(2026, 2, 3, 12).getTime(),
    durationSec: 458.9,
    sampleRate: 44100,
    bitDepth: 16,
    bitRateKbps: 1411,
    meta: META,
    ...over,
  }
}

async function open() {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbadd-')), 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    artists: [{ ID: '508225883', Name: 'Ultra Naté' }],
  })
  const db = openRekordboxDb(path)
  if (!db) throw new Error('fixture did not open')
  return db
}

function probe(over: { bitDepth?: number | null; bitrateKbps?: number | null } = {}) {
  return {
    properties: async () => ({
      sampleRateHz: 44100,
      bitDepth: 16 as number | null,
      channels: 2,
      bitrateKbps: 1411 as number | null,
      ...over,
    }),
    duration: async () => 458.9,
  }
}

async function file(name: string, bytes: number): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbfacts-')), name)
  await writeFile(path, Buffer.alloc(bytes))
  return path
}

describe('readContentFacts', () => {
  // rb_file_id is the inode as signed 64-bit text (medidas); another value would make
  // rekordbox's relocate treat the file as a different one.
  it('reads size, inode and type from the file as it is on disk', async () => {
    const path = await file('Last Night.wav', 1000)
    const st = await stat(path, { bigint: true })
    expect(await readContentFacts(path, META, probe())).toMatchObject({
      path,
      fileType: 11,
      fileSize: 1000,
      inode: BigInt.asIntN(64, st.ino).toString(),
      durationSec: 458.9,
      bitRateKbps: 1411,
      bitDepth: 16,
    })
  })

  // Measured: MP3 rows carry BitDepth 16 and the stream's kbps; PCM rows rate x bits x channels.
  it('gives a lossy file 16 bits and its own bit rate', async () => {
    const path = await file('Goteras.mp3', 10)
    expect(
      await readContentFacts(path, META, probe({ bitDepth: null, bitrateKbps: 320 })),
    ).toMatchObject({ fileType: 1, bitDepth: 16, bitRateKbps: 320 })
  })

  it('refuses a format rekordbox does not import', async () => {
    expect(await readContentFacts(await file('x.ogg', 10), META, probe())).toBeNull()
  })
})

describe('insertContent', () => {
  it('writes the row in the mould rekordbox accepted and analysed on open', async () => {
    const db = await open()
    const id = insertContent(db, facts(), { now: NOW, newContentId: () => '142145108' })
    const row = db.prepare('SELECT * FROM djmdContent WHERE ID = ?').get(id) as Record<
      string,
      unknown
    >
    expect(row).toMatchObject({
      ID: '142145108',
      MasterSongID: '142145108',
      MasterDBID: '3216549870',
      DeviceID: '7',
      FolderPath: '/Volumes/Public/Music/Last Night.wav',
      FileNameL: 'Last Night.wav',
      FileType: 11,
      FileSize: 81234567,
      rb_file_id: '-4611686018427387904',
      Length: 458,
      BitRate: 1411,
      BitDepth: 16,
      SampleRate: 44100,
      DateCreated: '2026-03-03',
      StockDate: '2026-10-18',
      ContentLink: CONTENT_LINK,
      ExtInfo: 'null',
      BPM: 0,
      Analysed: 0,
      AnalysisDataPath: '',
      ImagePath: '',
      KeyID: null,
      CueUpdated: null,
      HotCueAutoLoad: 'on',
      Title: 'Last Night',
      rb_local_deleted: 0,
    })
    expect(Number(row.rb_local_usn)).toBeGreaterThan(500)
    db.close()
  })

  // A second artist row with the same name splits the DJ's browse view in two.
  it('reuses the artist row rekordbox already has', async () => {
    const db = await open()
    const id = insertContent(db, facts(), { now: NOW })
    expect(db.prepare('SELECT ArtistID FROM djmdContent WHERE ID = ?').get(id)).toEqual({
      ArtistID: '508225883',
    })
    expect(db.prepare('SELECT count(*) AS n FROM djmdArtist').get()).toEqual({ n: 1 })
    db.close()
  })

  // Measured on 1260 WAV rows: rekordbox keeps no label and almost never a track number.
  it('leaves a WAV without label and track number, an AIFF with them', async () => {
    const db = await open()
    const wav = insertContent(db, facts(), { now: NOW })
    const aiff = insertContent(
      db,
      facts({ path: '/Volumes/Public/Music/B.aiff', fileType: 12 }),
      { now: NOW },
    )
    const read = (id: string) =>
      db.prepare('SELECT LabelID, TrackNo FROM djmdContent WHERE ID = ?').get(id) as {
        LabelID: string | null
        TrackNo: number
      }
    expect(read(wav)).toEqual({ LabelID: null, TrackNo: 0 })
    expect(read(aiff).LabelID).not.toBeNull()
    expect(read(aiff).TrackNo).toBe(3)
    db.close()
  })

  // All 55 non-ASCII paths in the measured collection are NFC; macOS hands Surco NFD.
  it('stores the path in NFC', async () => {
    const db = await open()
    const nfd = '/Volumes/Public/Music/Café.wav'.normalize('NFD')
    const id = insertContent(db, facts({ path: nfd }), { now: NOW })
    expect(db.prepare('SELECT FolderPath FROM djmdContent WHERE ID = ?').get(id)).toEqual({
      FolderPath: '/Volumes/Public/Music/Café.wav'.normalize('NFC'),
    })
    db.close()
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxContentAdd.test.ts`
Expected: FAIL, `Cannot find module './rekordboxContentAdd'`.

- [ ] **Step 4: Implement**

Create `src/main/rekordboxContentAdd.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { TrackProperties } from '../shared/types'
import { FILE_TYPES } from './rekordboxDb'
import { applyRekordboxMeta, type RekordboxMeta } from './rekordboxMetadata'
import { randomPlaylistId } from './rekordboxPlaylistEdit'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'

type Db = InstanceType<typeof Database>

export const CONTENT_LINK = 2950670

export interface ContentFacts {
  path: string
  fileType: number
  fileSize: number
  inode: string
  createdMs: number
  durationSec: number
  sampleRate: number
  bitDepth: number
  bitRateKbps: number
  meta: RekordboxMeta
}

export interface ContentProbe {
  properties: (
    path: string,
  ) => Promise<Pick<TrackProperties, 'sampleRateHz' | 'bitDepth' | 'channels' | 'bitrateKbps'>>
  duration: (path: string) => Promise<number | null>
}

const PCM = new Set([11, 12])
const LOSSY = new Set([1, 4])

export async function readContentFacts(
  path: string,
  meta: RekordboxMeta,
  probe: ContentProbe,
): Promise<ContentFacts | null> {
  const fileType = FILE_TYPES[extname(path).slice(1).toLowerCase()]
  if (fileType === undefined) return null
  const [st, props, duration] = await Promise.all([
    stat(path, { bigint: true }),
    probe.properties(path),
    probe.duration(path),
  ])
  if (duration === null) return null
  const bitDepth = LOSSY.has(fileType) ? 16 : (props.bitDepth ?? 16)
  return {
    path,
    fileType,
    fileSize: Number(st.size),
    inode: BigInt.asIntN(64, st.ino).toString(),
    createdMs: Number(st.birthtimeMs),
    durationSec: duration,
    sampleRate: props.sampleRateHz,
    bitDepth,
    bitRateKbps: PCM.has(fileType)
      ? Math.floor((props.sampleRateHz * bitDepth * props.channels) / 1000)
      : (props.bitrateKbps ?? 0),
    meta,
  }
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function insertContent(
  db: Db,
  facts: ContentFacts,
  ctx: { now: Date; newContentId?: () => string },
): string {
  const stamp = rekordboxStamp(ctx.now)
  const device = db.prepare('SELECT ID, MasterDBID FROM djmdDevice LIMIT 1').get() as
    | { ID: string; MasterDBID: string }
    | undefined
  if (!device) throw new Error('rekordbox collection has no djmdDevice row')
  const id = unusedRowId(db, 'djmdContent', ctx.newContentId ?? randomPlaylistId)
  const folderPath = facts.path.normalize('NFC')
  const fileName = basename(folderPath)
  const row: Record<string, string | number | null> = {
    ID: id,
    FolderPath: folderPath,
    FileNameL: fileName,
    FileNameS: '',
    Title: facts.meta.title.trim() || basename(fileName, extname(fileName)),
    BPM: 0,
    Length: Math.floor(facts.durationSec),
    TrackNo: 0,
    BitRate: facts.bitRateKbps,
    BitDepth: facts.bitDepth,
    Commnt: '',
    FileType: facts.fileType,
    Rating: 0,
    ReleaseYear: 0,
    KeyID: null,
    StockDate: localDate(ctx.now),
    ColorID: '0',
    DJPlayCount: 0,
    ImagePath: '',
    MasterDBID: device.MasterDBID,
    MasterSongID: id,
    AnalysisDataPath: '',
    FileSize: facts.fileSize,
    DiscNo: 0,
    Subtitle: '',
    SampleRate: facts.sampleRate,
    Analysed: 0,
    ReleaseDate: '',
    DateCreated: localDate(new Date(facts.createdMs)),
    ContentLink: CONTENT_LINK,
    ModifiedByRBM: '',
    HotCueAutoLoad: 'on',
    DeliveryControl: 'on',
    DeliveryComment: '',
    CueUpdated: null,
    AnalysisUpdated: null,
    TrackInfoUpdated: null,
    Lyricist: '',
    ISRC: '',
    SamplerTrackInfo: 0,
    SamplerPlayOffset: 0,
    SamplerGain: 0,
    VideoAssociate: '0',
    LyricStatus: 0,
    ServiceID: 0,
    OrgFolderPath: '',
    Reserved1: '',
    ExtInfo: 'null',
    rb_file_id: facts.inode,
    DeviceID: device.ID,
    UUID: randomUUID(),
    rb_data_status: 0,
    rb_local_data_status: 0,
    rb_local_deleted: 0,
    rb_local_synced: 0,
    usn: null,
    rb_local_usn: takeLocalUsn(db, stamp),
    created_at: stamp,
    updated_at: stamp,
  }
  const names = Object.keys(row)
  db.prepare(
    `INSERT INTO djmdContent (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  ).run(...Object.values(row))
  const meta = facts.fileType === 11 ? { ...facts.meta, label: '', trackNumber: '' } : facts.meta
  applyRekordboxMeta(db, id, meta, { now: ctx.now })
  return id
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxContentAdd.test.ts src/main/rekordboxPlaylistWrite.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/rekordboxPlaylistsFixture.ts apps/desktop/src/main/rekordboxContentAdd.ts apps/desktop/src/main/rekordboxContentAdd.test.ts
git commit -m "Add a converted track to the rekordbox collection in the measured mould"
```

---

### Task 3: Rename, delete, a track's playlists, a quiet lookup

**Files:**
- Modify: `src/shared/types.ts` (`RekordboxPlaylistEdit`, ~line 1046)
- Modify: `src/main/rekordboxDb.ts` (`FindOptions` and the miss log in `findTrackByPath`)
- Modify: `src/main/rekordboxPlaylistEdit.ts` (append; extend `editProblem`)
- Test: `src/main/rekordboxPlaylistEdit.test.ts` (append), `src/main/rekordboxDb.test.ts` (append)

**Interfaces:**
- Consumes: `links`, `writeOrder`, `nodeAttribute`, `EditRefused`, `EditContext` (same file), `takeLocalUsn`, `rekordboxStamp`.
- Produces:
  - `RekordboxPlaylistEdit` gains `{ kind: 'rename'; playlistId: string; name: string }` and `{ kind: 'delete'; playlistId: string }` (`playlistId` names a playlist or a folder)
  - `FindOptions` gains `quiet?: boolean` (no miss line in the log)
  - `renameNode(db: Db, id: string, name: string, ctx: EditContext): void`
  - `deleteNode(db: Db, id: string, ctx: EditContext): string[]` (every deleted `djmdPlaylist.ID`, the node first, for the XML)
  - `nodeSubtree(db: Db, id: string): string[]`
  - `trackPlaylists(db: Db, contentId: string): string[]` (live normal playlists, `Attribute` 0, that link the entry)
  - `removeTrackFromPlaylist(db: Db, playlistId: string, contentId: string, ctx: EditContext): number` (links deleted)

Deleting removes rows the way rekordbox removes links with cloud sync off (measured for links, not for playlists: medidas has no line on a deleted playlist). The Task 16 checklist asks Vicent to delete a folder from Surco and look in rekordbox; Decision 15 below records it.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/rekordboxPlaylistEdit.test.ts` (add `deleteNode`, `nodeSubtree`, `removeTrackFromPlaylist`, `renameNode`, `trackPlaylists` to the import from `./rekordboxPlaylistEdit`):

```ts
const NESTED: PlaylistFixture = {
  ...ORGANISE_FIXTURE,
  playlists: [
    ...ORGANISE_FIXTURE.playlists,
    { ID: '1100', Name: 'SUB', Attribute: 1, ParentID: '1000', Seq: 2 },
    { ID: '1110', Name: 'Deep', Attribute: 0, ParentID: '1100', Seq: 1 },
  ],
  links: [...ORGANISE_FIXTURE.links, { ID: 'd1', PlaylistID: '1110', ContentID: '101', TrackNo: 1 }],
}

const live = (id: string) =>
  db.prepare('SELECT ID, Name, Seq, rb_local_usn AS usn, updated_at FROM djmdPlaylist WHERE ID = ?').get(id) as
    | { ID: string; Name: string; Seq: number; usn: number; updated_at: string }
    | undefined

describe('renameNode', () => {
  it('renames the row and stamps it as a change of its own', () => {
    renameNode(db, '3000', '  House 2026 ', ctx)
    expect(live('3000')).toMatchObject({ Name: 'House 2026', usn: 501, updated_at: STAMP })
  })

  it('renames a folder too', () => {
    renameNode(db, '1000', 'COMBOS VIEJOS', ctx)
    expect(live('1000')?.Name).toBe('COMBOS VIEJOS')
  })

  it('refuses a node that is gone or a blank name', () => {
    expect(() => renameNode(db, '9999', 'X', ctx)).toThrow(EditRefused)
    expect(() => renameNode(db, '3000', '  ', ctx)).toThrow(EditRefused)
  })
})

describe('deleteNode', () => {
  // A folder holds playlists the DJ cannot see from the menu that deletes it; leaving them
  // would keep rows rekordbox shows nowhere and still exports.
  it('takes a folder, its nested folders and playlists and all their links', async () => {
    db.close()
    db = await openFixture(NESTED)
    expect(nodeSubtree(db, '1000').sort()).toEqual(['1000', '1100', '1110', '2000'])
    expect(deleteNode(db, '1000', ctx)).toEqual(['1000', '2000', '1100', '1110'])
    for (const id of ['1000', '1100', '1110', '2000']) expect(live(id)).toBeUndefined()
    expect(rows('2000')).toEqual([])
    expect(rows('1110')).toEqual([])
    expect(contents('3000')).toEqual(['102', '110'])
  })

  // The spec's one promise in the confirmation: the tracks stay in the collection.
  it('never deletes a collection entry', async () => {
    db.close()
    db = await openFixture(NESTED)
    const before = db.prepare('SELECT count(*) AS n FROM djmdContent').get()
    deleteNode(db, '1000', ctx)
    expect(db.prepare('SELECT count(*) AS n FROM djmdContent').get()).toEqual(before)
  })

  // rekordbox keeps Seq 1..n per parent (measured); a gap reorders nothing but every later
  // creation would compute its place from it.
  it('closes the gap among the siblings that followed', () => {
    deleteNode(db, '1000', ctx)
    expect(live('3000')).toMatchObject({ Seq: 1, updated_at: STAMP })
    expect(live('4000')?.Seq).toBe(2)
  })

  it('refuses a node that is gone', () => {
    expect(() => deleteNode(db, '9999', ctx)).toThrow(EditRefused)
  })
})

describe('trackPlaylists', () => {
  // The field's initial value: where rekordbox has the track today, normal playlists only.
  it('lists the playlists that link the entry, once each', () => {
    expect(trackPlaylists(db, '102').sort()).toEqual(['2000', '3000'])
    expect(trackPlaylists(db, '103')).toEqual([])
  })
})

describe('removeTrackFromPlaylist', () => {
  it('removes every link of the entry and renumbers the rest', () => {
    expect(removeTrackFromPlaylist(db, '2000', '102', ctx)).toBe(2)
    expect(contents('2000')).toEqual(['101', '109', '201', '109', '104'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5])
  })

  it('removes nothing when the playlist does not hold the entry', () => {
    expect(removeTrackFromPlaylist(db, '3000', '101', ctx)).toBe(0)
    expect(contents('3000')).toEqual(['102', '110'])
  })
})

describe('editProblem for rename and delete', () => {
  it('flags a node that is gone and a blank name', () => {
    expect(editProblem(db, { kind: 'rename', playlistId: '9999', name: 'X' })).toBe('stale')
    expect(editProblem(db, { kind: 'rename', playlistId: '3000', name: ' ' })).toBe('stale')
    expect(editProblem(db, { kind: 'delete', playlistId: '9999' })).toBe('stale')
  })

  it('passes a folder and a playlist', () => {
    expect(editProblem(db, { kind: 'rename', playlistId: '1000', name: 'X' })).toBeNull()
    expect(editProblem(db, { kind: 'delete', playlistId: '3000' })).toBeNull()
  })
})
```

In `src/main/rekordboxDb.test.ts`, add `vi` to the `vitest` import, add `import log from 'electron-log/main'`, put this mock right under the imports:

```ts
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
```

and append:

```ts
describe('findTrackByPath quiet', () => {
  // The membership read asks for every row of the working list; most were never in
  // rekordbox, and a miss line for each would bury the misses that matter.
  it('logs no miss when asked to be quiet', () => {
    const db = openRekordboxDb(dbPath)
    if (!db) throw new Error('fixture did not open')
    vi.mocked(log.info).mockClear()
    expect(findTrackByPath(db, '/nowhere/x.wav', { quiet: true })).toBeNull()
    expect(log.info).not.toHaveBeenCalled()
    findTrackByPath(db, '/nowhere/x.wav')
    expect(log.info).toHaveBeenCalled()
    db.close()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistEdit.test.ts src/main/rekordboxDb.test.ts`
Expected: FAIL, `renameNode is not a function` (and the rest); the quiet test fails on `log.info` having been called.

- [ ] **Step 3: Types and the quiet flag**

In `src/shared/types.ts`, add to the `RekordboxPlaylistEdit` union:

```ts
  | { kind: 'rename'; playlistId: string; name: string }
  | { kind: 'delete'; playlistId: string }
```

In `src/main/rekordboxDb.ts`:

```ts
export type FindOptions = PathMatchOptions & { quiet?: boolean }
```

and guard the miss log in `findTrackByPath`:

```ts
  if (matches.length === 0) {
    if (!options.quiet)
      log.info(
        `rekordbox lookup miss: name=${JSON.stringify(fileName)} target=${JSON.stringify(target)} rows=${rows.length}` +
          rows.map((r) => ` | row ${r.ID} -> ${JSON.stringify(safeResolve(r.FolderPath))}`).join(''),
      )
    return null
  }
```

- [ ] **Step 4: Implement the edits**

Append to `src/main/rekordboxPlaylistEdit.ts`:

```ts
function requireNode(db: Db, id: string): void {
  const attribute = nodeAttribute(db, id)
  if (attribute !== 0 && attribute !== 1) throw new EditRefused('stale')
}

export function renameNode(db: Db, id: string, name: string, ctx: EditContext): void {
  requireNode(db, id)
  if (name.trim() === '') throw new EditRefused('stale')
  const stamp = rekordboxStamp(ctx.now)
  db.prepare('UPDATE djmdPlaylist SET Name = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?').run(
    name.trim(),
    takeLocalUsn(db, stamp),
    stamp,
    id,
  )
}

export function nodeSubtree(db: Db, id: string): string[] {
  const children = db.prepare(
    `SELECT ID FROM djmdPlaylist WHERE ParentID = ? AND coalesce(rb_local_deleted, 0) = 0 ORDER BY Seq`,
  )
  const found = [id]
  for (let i = 0; i < found.length; i++) {
    for (const row of children.all(found[i]) as { ID: string }[]) found.push(String(row.ID))
  }
  return found
}

export function deleteNode(db: Db, id: string, ctx: EditContext): string[] {
  requireNode(db, id)
  const { ParentID, Seq } = db.prepare('SELECT ParentID, Seq FROM djmdPlaylist WHERE ID = ?').get(id) as {
    ParentID: string
    Seq: number
  }
  const doomed = nodeSubtree(db, id)
  const unlink = db.prepare('DELETE FROM djmdSongPlaylist WHERE PlaylistID = ?')
  const drop = db.prepare('DELETE FROM djmdPlaylist WHERE ID = ?')
  for (const node of doomed) {
    unlink.run(node)
    drop.run(node)
  }
  const stamp = rekordboxStamp(ctx.now)
  const after = db
    .prepare(
      `SELECT ID, Seq FROM djmdPlaylist WHERE ParentID = ? AND Seq > ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .all(ParentID, Seq) as { ID: string; Seq: number }[]
  const renumber = db.prepare(
    'UPDATE djmdPlaylist SET Seq = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?',
  )
  for (const sibling of after) renumber.run(sibling.Seq - 1, takeLocalUsn(db, stamp), stamp, sibling.ID)
  return doomed
}

export function trackPlaylists(db: Db, contentId: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT p.ID FROM djmdSongPlaylist s JOIN djmdPlaylist p ON p.ID = s.PlaylistID
          WHERE s.ContentID = ? AND coalesce(s.rb_local_deleted, 0) = 0
            AND coalesce(p.rb_local_deleted, 0) = 0 AND p.Attribute = 0`,
      )
      .all(contentId) as { ID: string }[]
  ).map((r) => String(r.ID))
}

export function removeTrackFromPlaylist(
  db: Db,
  playlistId: string,
  contentId: string,
  ctx: EditContext,
): number {
  requirePlaylist(db, playlistId)
  const order = links(db, playlistId)
  const doomed = order.filter((l) => l.ContentID === contentId)
  if (doomed.length === 0) return 0
  const remove = db.prepare('DELETE FROM djmdSongPlaylist WHERE ID = ?')
  for (const l of doomed) remove.run(l.ID)
  writeOrder(
    db,
    order.filter((l) => l.ContentID !== contentId),
    rekordboxStamp(ctx.now),
  )
  return doomed.length
}
```

In `editProblem`, right after the `create` branch, add:

```ts
  if (edit.kind === 'rename' || edit.kind === 'delete') {
    const attribute = nodeAttribute(db, edit.playlistId)
    if (attribute !== 0 && attribute !== 1) return 'stale'
    return edit.kind === 'rename' && edit.name.trim() === '' ? 'stale' : null
  }
```

`links` returns `ContentID` as stored; the fixture and rekordbox store IDs as text, so the strict comparison holds.

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistEdit.test.ts src/main/rekordboxDb.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

`editRekordboxPlaylist`'s final `else` now also receives `rename`/`delete`; until Task 4 replaces that dispatch, `tsc` reports them on `edit.parentId`. Make the existing `else` explicit so this commit compiles, in `rekordboxPlaylistWrite.ts`:

```ts
    else if (edit.kind === 'create')
      created = createNode(db, edit.parentId, edit.name, edit.folder, {
        now,
        newPlaylistId: freeId,
      })
    else if (edit.kind === 'rename') renameNode(db, edit.playlistId, edit.name, { now })
    else deleteNode(db, edit.playlistId, { now })
```

(import `renameNode`, `deleteNode`). Task 4 adds the XML side of both.

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxDb.ts apps/desktop/src/main/rekordboxDb.test.ts apps/desktop/src/main/rekordboxPlaylistEdit.ts apps/desktop/src/main/rekordboxPlaylistEdit.test.ts apps/desktop/src/main/rekordboxPlaylistWrite.ts
git commit -m "Rename and delete rekordbox playlists and folders, and read a track's playlists"
```

If `tsc -p tsconfig.web.json` reports a non-exhaustive switch over `RekordboxPlaylistEdit['kind']` in the renderer (`playlistEdits.ts` has none today), add the two kinds to that switch returning `null`; Task 15 gives them their messages.

---

### Task 4: The batch writer

**Files:**
- Create: `src/main/rekordboxQueueOps.ts`
- Modify: `src/shared/types.ts` (append `RekordboxQueueNotice` after `RekordboxEditResult`)
- Modify: `src/main/rekordboxPlaylistWrite.ts` (imports; `xmlTakesNode`; replace everything from `function refuse` to the end of the file)
- Test: `src/main/rekordboxPlaylistWrite.test.ts` (replace one test, append a `describe`)

**Interfaces:**
- Consumes: Task 1 `nodeTimestamp`, `withNodeTimestamp`, `withoutNodes`; Task 3 `renameNode`, `deleteNode`; existing `editProblem`, `resolveTracks`, `playlistContents`, `moveChangesOrder`, `addToPlaylist`, `moveInPlaylist`, `removeFromPlaylist`, `insertSeparator`, `createNode`, `randomPlaylistId`, `EditRefused`.
- Produces:
  - `shared/types.ts`: `type RekordboxQueueNotice = { code: 'ambiguous' | 'file-missing' | 'not-added'; track: string } | { code: 'playlist-changed' | 'playlist-gone'; track: string; playlist: string } | { code: 'edit-changed'; playlist: string }`
  - `rekordboxQueueOps.ts`: `interface EditOp { id: string; kind: 'edit'; edit: RekordboxPlaylistEdit; stamps: Record<string, number> }`, `type QueueOp = EditOp` (Task 5 widens it), `interface OpOutcome { id: string; applied: boolean; reason?: RekordboxEditRefusal; report?: PlaylistAddReport; createdId?: string; notices: RekordboxQueueNotice[] }`, `type BatchResult = { ok: true; wrote: boolean; outcomes: OpOutcome[] } | { ok: false; reason: RekordboxEditRefusal }`, `opRank(op: QueueOp): number`, `interface XmlDraft { xml: string | null; taken: Set<string>; now: number }`, `bumpNode(draft: XmlDraft, playlistId: string): void`
  - `rekordboxPlaylistWrite.ts`: `applyRekordboxBatch(collectionPath: string, ops: QueueOp[], deps: PlaylistWriteDeps): Promise<BatchResult>` (outcomes in the order of `ops`); `editRekordboxPlaylist` keeps its signature and answers.

Ranks (the spec's order, per operation; each operation runs whole inside its own `SAVEPOINT`): track 0, `create` 1, `add`/`move`/`remove`/`insertSeparator` 2, `rename` 3, cues 4 (plan B), `delete` 5. A refusal inside one operation (`EditRefused`) rolls back that savepoint only and its XML changes with it; any other error rolls back the whole batch (spec "Falla a mitad").

Decision 17 applies here: every write that changes a playlist's links, or renames it, moves its node `Timestamp`, so the XML is backed up and written whenever it exists and something is written.

- [ ] **Step 1: Write the failing tests**

In `src/main/rekordboxPlaylistWrite.test.ts`, replace the test `'leaves the XML alone for an edit of tracks'` with:

```ts
  // Measured 18/10: rekordbox moves the node Timestamp of a playlist whose tracks change,
  // and its USB sync reads it; a reorder that left it would never reach the stick.
  it('moves only the Timestamp of the playlist whose tracks changed', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const before = await readFile(xmlPath, 'utf8')
    await editRekordboxPlaylist(path, MOVE, deps())
    expect(await readFile(xmlPath, 'utf8')).toBe(
      before.replace(
        /(<NODE Id="7D0" [^>]*Timestamp=")\d+/,
        `$1${NOW.getTime()}`,
      ),
    )
    expect(existsSync(`${xmlPath}.surco-backup`)).toBe(true)
  })
```

Add `applyRekordboxBatch` to the import from `./rekordboxPlaylistWrite`, `type QueueOp` from `./rekordboxQueueOps`, and append:

```ts
const edit = (id: string, e: RekordboxPlaylistEdit, stamps: Record<string, number> = {}): QueueOp => ({
  id,
  kind: 'edit',
  edit: e,
  stamps,
})

function playlistRow(path: string, id: string): { Name: string } | undefined {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return db.prepare('SELECT Name FROM djmdPlaylist WHERE ID = ?').get(id) as
      | { Name: string }
      | undefined
  } finally {
    db.close()
  }
}

describe('applyRekordboxBatch', () => {
  // A queue that waited for rekordbox to close is one gesture for the user: one dialog,
  // one copy, one transaction.
  it('writes several operations behind one question and one copy', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(
      path,
      [edit('a', MOVE), edit('b', { kind: 'rename', playlistId: '3000', name: 'House 26' })],
      d,
    )
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [
        { id: 'a', applied: true, notices: [] },
        { id: 'b', applied: true, notices: [] },
      ],
    })
    expect(d.ensureClosed).toHaveBeenCalledTimes(1)
    expect(d.sessionBackup).toHaveBeenCalledWith(path)
    expect(linkIds(path, '2000')[0]).toBe('f6')
    expect(playlistRow(path, '3000')).toEqual({ Name: 'House 26' })
  })

  // Deleting a folder takes its playlists; an operation on one of them, queued earlier,
  // no longer applies, and only that one is dropped.
  it('drops only the operation that no longer applies inside the batch', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [edit('folder', { kind: 'delete', playlistId: '1000' }), edit('child', { kind: 'delete', playlistId: '2000' })],
      deps(),
    )
    expect(result.ok && result.outcomes).toEqual([
      { id: 'folder', applied: true, notices: [] },
      { id: 'child', applied: false, reason: 'stale', notices: [] },
    ])
    expect(playlistRow(path, '1000')).toBeUndefined()
  })

  it('removes the deleted nodes from the XML and keeps the rest', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    await applyRekordboxBatch(path, [edit('x', { kind: 'delete', playlistId: '1000' })], deps())
    const xml = await readFile(xmlPath, 'utf8')
    expect(xml).not.toContain('Id="3E8"')
    expect(xml).not.toContain('Id="7D0"')
    expect(xml).toContain('Id="BB8"')
  })

  // The spec's order: links before deletes, whatever order the queue holds them in.
  it('applies links before deletes', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [
        edit('del', { kind: 'delete', playlistId: '3000' }),
        edit('add', { kind: 'add', playlistId: '3000', tracks: [{ paths: ['/Volumes/Public/Music/Gowan.wav'] }] }),
      ],
      deps(),
    )
    expect(result.ok && result.outcomes.map((o) => o.applied)).toEqual([true, true])
  })

  // rekordbox wins: a playlist touched there since the operation was queued is left as
  // rekordbox has it, the user is told, and nothing is asked or written for it.
  it('drops an operation on a playlist rekordbox changed since it was queued', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(
      path,
      [edit('r', { kind: 'rename', playlistId: '3000', name: 'X' }, { '3000': 1 })],
      d,
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        { id: 'r', applied: false, reason: 'stale', notices: [{ code: 'edit-changed', playlist: 'House' }] },
      ],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
    expect(playlistRow(path, '3000')).toEqual({ Name: 'House' })
  })

  it('applies an operation whose recorded Timestamp still matches', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [edit('r', { kind: 'rename', playlistId: '3000', name: 'X' }, { '3000': 1767225600000 })],
      deps(),
    )
    expect(result.ok && result.outcomes[0].applied).toBe(true)
  })

  it('undoes every operation of the batch when the write dies halfway', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [edit('a', MOVE), edit('b', { kind: 'rename', playlistId: '3000', name: 'House 26' })],
      deps({
        onWrite: () => {
          throw new Error('disk gone')
        },
      }),
    )
    expect(result).toEqual({ ok: false, reason: 'write-failed' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
    expect(playlistRow(path, '3000')).toEqual({ Name: 'House' })
  })

  it('asks nothing when no operation has anything to write', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(
      path,
      [edit('m', { kind: 'move', playlistId: '2000', linkIds: ['f1'], beforeLinkId: 'f2' })],
      d,
    )
    expect(result).toEqual({ ok: true, wrote: false, outcomes: [{ id: 'm', applied: true, notices: [] }] })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistWrite.test.ts`
Expected: FAIL, `Cannot find module './rekordboxQueueOps'`; once it exists, `applyRekordboxBatch is not a function` and the Timestamp test sees the XML untouched.

- [ ] **Step 3: The operation types**

Append to `src/shared/types.ts`, after `RekordboxEditResult`:

```ts
export type RekordboxQueueNotice =
  | { code: 'ambiguous' | 'file-missing' | 'not-added'; track: string }
  | { code: 'playlist-changed' | 'playlist-gone'; track: string; playlist: string }
  | { code: 'edit-changed'; playlist: string }
```

Create `src/main/rekordboxQueueOps.ts`:

```ts
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxPlaylistEdit,
  RekordboxQueueNotice,
} from '../shared/types'
import { withNodeTimestamp } from './rekordboxMasterXml'

export interface EditOp {
  id: string
  kind: 'edit'
  edit: RekordboxPlaylistEdit
  stamps: Record<string, number>
}

export type QueueOp = EditOp

export interface OpOutcome {
  id: string
  applied: boolean
  reason?: RekordboxEditRefusal
  report?: PlaylistAddReport
  createdId?: string
  notices: RekordboxQueueNotice[]
}

export type BatchResult =
  | { ok: true; wrote: boolean; outcomes: OpOutcome[] }
  | { ok: false; reason: RekordboxEditRefusal }

const EDIT_RANK: Record<RekordboxPlaylistEdit['kind'], number> = {
  create: 1,
  add: 2,
  move: 2,
  remove: 2,
  insertSeparator: 2,
  rename: 3,
  delete: 5,
}

export function opRank(op: QueueOp): number {
  return EDIT_RANK[op.edit.kind]
}

export interface XmlDraft {
  xml: string | null
  taken: Set<string>
  now: number
}

export function bumpNode(draft: XmlDraft, playlistId: string): void {
  if (draft.xml !== null) draft.xml = withNodeTimestamp(draft.xml, playlistId, draft.now)
}
```

- [ ] **Step 4: The batch writer**

In `src/main/rekordboxPlaylistWrite.ts`:

Imports become:

```ts
import { existsSync } from 'node:fs'
import { chmod, copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../shared/types'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import {
  hexId,
  nodeTimestamp,
  playlistXmlPath,
  withoutNodes,
  withPlaylistNode,
  xmlNodeIds,
} from './rekordboxMasterXml'
import {
  addToPlaylist,
  createNode,
  deleteNode,
  EditRefused,
  editProblem,
  insertSeparator,
  moveChangesOrder,
  moveInPlaylist,
  playlistContents,
  randomPlaylistId,
  removeFromPlaylist,
  renameNode,
  resolveTracks,
} from './rekordboxPlaylistEdit'
import { isRekordboxRunning } from './rekordboxProcess'
import {
  type BatchResult,
  bumpNode,
  type EditOp,
  type OpOutcome,
  opRank,
  type QueueOp,
  type XmlDraft,
} from './rekordboxQueueOps'
import { writeBackup } from './rekordboxSessionBackup'
```

`xmlTakesNode` loses its `parentId` parameter (the placeholder node goes under the root; only the layout is checked):

```ts
async function xmlTakesNode(xmlPath: string): Promise<boolean> {
  try {
    withPlaylistNode(await readFile(xmlPath, 'utf8'), {
      id: '100',
      parentId: 'root',
      attribute: 0,
      timestamp: 0,
    })
    return true
  } catch {
    return false
  }
}
```

Replace everything from `function refuse(` to the end of the file with:

```ts
function refuse(reason: RekordboxEditRefusal, report?: PlaylistAddReport): RekordboxEditResult {
  return report ? { applied: false, reason, report } : { applied: false, reason }
}

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

interface Planned {
  op: QueueOp
  contentIds?: string[]
  unresolved?: { notInCollection: number; ambiguous: number }
}

type Plan = Planned | { outcome: OpOutcome }

function playlistName(db: Db, id: string): string {
  const row = db.prepare('SELECT Name FROM djmdPlaylist WHERE ID = ?').get(id) as
    | { Name: string }
    | undefined
  return row?.Name ?? id
}

function planEdit(probe: Db, xml: string | null, op: EditOp, find: FindOptions): Plan {
  const { edit } = op
  const refused = (reason: RekordboxEditRefusal, report?: PlaylistAddReport): Plan => ({
    outcome: report
      ? { id: op.id, applied: false, reason, report, notices: [] }
      : { id: op.id, applied: false, reason, notices: [] },
  })
  const problem = editProblem(probe, edit)
  if (problem) return refused(problem)
  for (const [playlistId, stamp] of Object.entries(op.stamps)) {
    if (xml !== null && nodeTimestamp(xml, playlistId) !== stamp)
      return {
        outcome: {
          id: op.id,
          applied: false,
          reason: 'stale',
          notices: [{ code: 'edit-changed', playlist: playlistName(probe, playlistId) }],
        },
      }
  }
  if (
    edit.kind === 'move' &&
    !moveChangesOrder(probe, edit.playlistId, edit.linkIds, edit.beforeLinkId)
  )
    return { outcome: { id: op.id, applied: true, notices: [] } }
  if (edit.kind === 'add') {
    const resolved = resolveTracks(probe, edit.tracks, find)
    const unresolved = { notInCollection: resolved.notInCollection, ambiguous: resolved.ambiguous }
    const present = playlistContents(probe, edit.playlistId)
    const already = resolved.contentIds.filter((id) => present.has(id)).length
    if (already === resolved.contentIds.length)
      return refused('nothing-to-add', { added: 0, already, ...unresolved })
    return { op, contentIds: resolved.contentIds, unresolved }
  }
  return { op }
}

function planOp(probe: Db, xml: string | null, op: QueueOp, find: FindOptions): Plan {
  return planEdit(probe, xml, op, find)
}

function freeId(draft: XmlDraft): string {
  for (;;) {
    const id = randomPlaylistId()
    if (!draft.taken.has(hexId(id))) return id
  }
}

function writeEdit(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  const op = planned.op as EditOp
  const { edit } = op
  const ctx = { now, newPlaylistId: () => freeId(draft) }
  const done = (extra: Partial<OpOutcome> = {}): OpOutcome => ({
    id: op.id,
    applied: true,
    notices: [],
    ...extra,
  })
  if (edit.kind === 'add') {
    const counts = addToPlaylist(db, edit.playlistId, planned.contentIds ?? [], ctx)
    bumpNode(draft, edit.playlistId)
    return done({ report: { ...counts, notInCollection: 0, ambiguous: 0, ...planned.unresolved } })
  }
  if (edit.kind === 'move') {
    moveInPlaylist(db, edit.playlistId, edit.linkIds, edit.beforeLinkId, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  if (edit.kind === 'remove') {
    removeFromPlaylist(db, edit.playlistId, edit.linkIds, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  if (edit.kind === 'insertSeparator') {
    insertSeparator(db, edit.playlistId, edit.beforeLinkId, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  if (edit.kind === 'create') {
    const created = createNode(db, edit.parentId, edit.name, edit.folder, ctx)
    if (draft.xml !== null)
      draft.xml = withPlaylistNode(draft.xml, {
        id: created.id,
        parentId: edit.parentId,
        attribute: created.attribute,
        timestamp: draft.now,
      })
    draft.taken.add(hexId(created.id))
    return done({ createdId: created.id })
  }
  if (edit.kind === 'rename') {
    renameNode(db, edit.playlistId, edit.name, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  const gone = deleteNode(db, edit.playlistId, ctx)
  if (draft.xml !== null) draft.xml = withoutNodes(draft.xml, gone)
  return done()
}

function writeOp(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  return writeEdit(db, draft, planned, now)
}

function needsNode(planned: Planned): boolean {
  return planned.op.kind === 'edit' && planned.op.edit.kind === 'create'
}

export async function applyRekordboxBatch(
  collectionPath: string,
  ops: QueueOp[],
  deps: PlaylistWriteDeps,
): Promise<BatchResult> {
  if (!collectionPath) return { ok: false, reason: 'unreadable' }
  const xmlPath = playlistXmlPath(collectionPath)
  const hasXml = existsSync(xmlPath)
  const outcomes = new Map<string, OpOutcome>()
  const planned: Planned[] = []
  const probe = openRekordboxDb(collectionPath, { readonly: true })
  if (!probe) return { ok: false, reason: 'unreadable' }
  try {
    const current = hasXml ? await readFile(xmlPath, 'utf8') : null
    for (const op of ops) {
      const plan = planOp(probe, current, op, deps)
      if ('outcome' in plan) outcomes.set(op.id, plan.outcome)
      else planned.push(plan)
    }
  } finally {
    probe.close()
  }
  const inOrder = (): OpOutcome[] => ops.map((op) => outcomes.get(op.id) as OpOutcome)
  if (planned.length === 0) return { ok: true, wrote: false, outcomes: inOrder() }

  if (hasXml && planned.some(needsNode) && !(await xmlTakesNode(xmlPath)))
    return { ok: false, reason: 'unreadable' }

  if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }

  const touched = hasXml ? [collectionPath, xmlPath] : [collectionPath]
  let xml: string | null = null
  try {
    checkpoint(collectionPath)
    for (const path of touched) {
      await deps.sessionBackup(path)
      await writeBackup(path, `${path}${BACKUP_SUFFIX}`)
    }
    if (hasXml) xml = await readFile(xmlPath, 'utf8')
  } catch (err) {
    return { ok: false, reason: isReadOnly(err) ? 'read-only' : 'backup-failed' }
  }

  if (await isRekordboxRunning()) return { ok: false, reason: 'rekordbox-running' }

  const db = openRekordboxDb(collectionPath)
  if (!db) return { ok: false, reason: 'unreadable' }
  const now = deps.now?.() ?? new Date()
  const draft: XmlDraft = {
    xml,
    taken: xml === null ? new Set<string>() : xmlNodeIds(xml),
    now: now.getTime(),
  }
  let xmlWritten = false
  try {
    db.exec('BEGIN')
    for (const p of [...planned].sort((a, b) => opRank(a.op) - opRank(b.op))) {
      const saved = draft.xml
      db.exec('SAVEPOINT surco_op')
      try {
        outcomes.set(p.op.id, writeOp(db, draft, p, now))
        db.exec('RELEASE surco_op')
      } catch (err) {
        if (!(err instanceof EditRefused)) throw err
        db.exec('ROLLBACK TO surco_op')
        db.exec('RELEASE surco_op')
        draft.xml = saved
        outcomes.set(p.op.id, { id: p.op.id, applied: false, reason: err.reason, notices: [] })
      }
    }
    deps.onWrite?.()
    if (draft.xml !== null && draft.xml !== xml) {
      await (deps.writeXml ?? replaceFile)(xmlPath, draft.xml)
      xmlWritten = true
    }
    db.exec('COMMIT')
  } catch (err) {
    const known = rollback(db, deps.onRollback)
    db.close()
    if (xmlWritten) await restoreFile(xmlPath)
    if (!known && !(await restoreCollection(collectionPath)))
      return { ok: false, reason: 'write-unknown' }
    if (isReadOnly(err)) return { ok: false, reason: 'read-only' }
    log.warn(`rekordbox batch failed: ${String(err)}`)
    return { ok: false, reason: 'write-failed' }
  }
  db.close()
  return { ok: true, wrote: true, outcomes: inOrder() }
}

export async function editRekordboxPlaylist(
  collectionPath: string,
  edit: RekordboxPlaylistEdit,
  deps: PlaylistWriteDeps,
): Promise<RekordboxEditResult> {
  const result = await applyRekordboxBatch(
    collectionPath,
    [{ id: 'edit', kind: 'edit', edit, stamps: {} }],
    deps,
  )
  if (!result.ok) return refuse(result.reason)
  const [outcome] = result.outcomes
  if (!outcome.applied) return refuse(outcome.reason ?? 'write-failed', outcome.report)
  if (outcome.report) return { applied: true, report: outcome.report }
  return outcome.createdId ? { applied: true, createdId: outcome.createdId } : { applied: true }
}
```

The rename branch Task 3 put in the old dispatch goes away with it.

- [ ] **Step 5: Run the writer's whole suite**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistWrite.test.ts src/main/rekordboxPlaylistsIpc.test.ts src/main/rekordboxPlaylistEdit.test.ts`
Expected: PASS, every 2a test unchanged except the replaced Timestamp one. If `'never gives a new playlist an ID the XML already holds'` fails, check that `freeId` reads `draft.taken` (filled from the XML read after the backups).

- [ ] **Step 6: Mutation check**

Change `if (!(err instanceof EditRefused)) throw err` to `throw err` and rerun the file: `'drops only the operation that no longer applies inside the batch'` must fail (it now reports `write-failed`). Change `opRank(a.op) - opRank(b.op)` to `0`: `'applies links before deletes'` must fail. Restore both.

- [ ] **Step 7: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxQueueOps.ts apps/desktop/src/main/rekordboxPlaylistWrite.ts apps/desktop/src/main/rekordboxPlaylistWrite.test.ts
git commit -m "Write a batch of rekordbox operations in one transaction with a savepoint each"
```

---

