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
19. **A track's entry is looked up when it is queued** by its final path and, only when the run also repoints it ("Sincronizar rekordbox" on), by the path it came from. With the toggle off, a format change adds the new file beside the old entry instead of moving the old entry; the toggle keeps meaning "Surco may move my entries". Checked with Vicent in Task 16.

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

### Task 5: Track operations inside the batch: add to collection, diff, conflicts

**Files:**
- Modify: `src/shared/types.ts` (append `RekordboxPlaylistTarget`)
- Modify: `src/main/rekordboxQueueOps.ts` (`TrackOp`, `QueueOp`, `OpOutcome.contentId`, `opRank`, `XmlDraft.created`)
- Modify: `src/main/rekordboxPlaylistWrite.ts` (`planOp`, `writeOp`, `needsNode`, the draft and the savepoint loop)
- Test: `src/main/rekordboxQueueTrack.test.ts`

**Interfaces:**
- Consumes: Task 2 `ContentFacts`, `insertContent`; Task 3 `trackPlaylists`, `removeTrackFromPlaylist`; Task 4 `applyRekordboxBatch`, `Plan`, `Planned`, `playlistName`, `freeId`, `bumpNode`; existing `resolveTracks`, `nodeAttribute`, `createNode`, `addToPlaylist`, `withPlaylistNode`, `nodeTimestamp`.
- Produces:
  - `shared/types.ts`: `interface RekordboxPlaylistTarget { id?: string; name: string }` (no `id`: a playlist to create at the root under `name`)
  - `rekordboxQueueOps.ts`: `interface TrackOp { id: string; kind: 'track'; path: string; label: string; contentId?: string; facts: ContentFacts | null; wanted: RekordboxPlaylistTarget[]; known: string[]; stamps: Record<string, number> }`; `type QueueOp = EditOp | TrackOp` (plan B adds its cues kind with rank 4); `OpOutcome.contentId?: string`; `XmlDraft.created: Map<string, string>` (new playlist name to its ID, one per batch)

Rules (spec "Al convertir o actualizar", "Conflictos"):
- The entry: `contentId` when it is live, else `findTrackByPath` on `path` (through `resolveTracks`, which also refuses the separator and streaming rows). Two rows: notice `ambiguous`, nothing written. None and `wanted` empty: nothing to do. None and the file gone (or no facts): notice `file-missing` (`not-added` without facts), nothing written. None otherwise: `insertContent`.
- Adds: wanted IDs the entry is not in, at the end (`addToPlaylist`). Removes: playlists the entry is in that are not wanted (`removeTrackFromPlaylist`, all its links there). Each touched playlist's node `Timestamp` moves.
- A wanted playlist that is gone or no longer a normal playlist: notice `playlist-gone`, the rest applies. A playlist whose node `Timestamp` differs from `stamps`: notice `playlist-changed`, that part dropped. A remove from a playlist not in `known` (rekordbox added the track there after Surco queued): notice `playlist-changed`, not removed. Without an XML there is no Timestamp check.
- New names: one `createNode` per name per batch (`draft.created`), root, last among siblings, node appended.

- [ ] **Step 1: Write the failing tests**

Create `src/main/rekordboxQueueTrack.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import type { ContentFacts } from './rekordboxContentAdd'
import { openRekordboxDb } from './rekordboxDb'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import {
  ORGANISE_FIXTURE,
  type PlaylistFixture,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'
import type { TrackOp } from './rekordboxQueueOps'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { applyRekordboxBatch } from './rekordboxPlaylistWrite'

const NOW = new Date('2026-10-18T19:00:00.000Z')
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'surco-rbtrack-'))
})

async function collection(over: Partial<PlaylistFixture> = {}): Promise<string> {
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true, ...over })
  return path
}

const deps = () => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  now: () => NOW,
  ...TWIN_PATHS,
})

async function newFile(name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, Buffer.alloc(100))
  return path
}

function facts(path: string): ContentFacts {
  return {
    path,
    fileType: 11,
    fileSize: 100,
    inode: '12345',
    createdMs: NOW.getTime(),
    durationSec: 300,
    sampleRate: 44100,
    bitDepth: 16,
    bitRateKbps: 1411,
    meta: rekordboxMetaFrom({ ...emptyMetadata(), title: 'Bam Bam', artist: 'Sister Nancy' }),
  }
}

function op(over: Partial<TrackOp>): TrackOp {
  return {
    id: 't',
    kind: 'track',
    path: '/Volumes/Public/Music/Gowan.wav',
    label: 'Bam Bam',
    facts: null,
    wanted: [],
    known: [],
    stamps: { '2000': 1767225600000, '3000': 1767225600000 },
    ...over,
  }
}

function read<T>(path: string, sql: string, ...args: string[]): T[] {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return db.prepare(sql).all(...args) as T[]
  } finally {
    db.close()
  }
}

const contentsOf = (path: string, playlistId: string) =>
  read<{ ContentID: string }>(
    path,
    'SELECT ContentID FROM djmdSongPlaylist WHERE PlaylistID = ? ORDER BY TrackNo',
    playlistId,
  ).map((r) => r.ContentID)

const named = (path: string, name: string) =>
  read<{ ID: string; ParentID: string }>(path, 'SELECT ID, ParentID FROM djmdPlaylist WHERE Name = ?', name)

describe('track operations', () => {
  // Flow 1: a track rekordbox never had ends up in the collection and in its playlists,
  // a new one included, without Music in between.
  it('adds a new track to the collection, to an existing playlist and to a new one', async () => {
    const path = await collection()
    const file = await newFile('Bam Bam.wav')
    const result = await applyRekordboxBatch(
      path,
      [op({ path: file, facts: facts(file), wanted: [{ id: '3000', name: 'House' }, { name: 'Bolos' }] })],
      deps(),
    )
    const entry = result.ok ? result.outcomes[0].contentId : undefined
    expect(result.ok && result.outcomes[0]).toMatchObject({ applied: true, notices: [] })
    expect(contentsOf(path, '3000')).toEqual(['102', '110', entry])
    const [bolos] = named(path, 'Bolos')
    expect(bolos.ParentID).toBe('root')
    expect(contentsOf(path, bolos.ID)).toEqual([entry])
    const xml = await readFile(join(dir, 'masterPlaylists6.xml'), 'utf8')
    expect(xml).toContain(`Id="${BigInt(bolos.ID).toString(16).toUpperCase()}" ParentId="0"`)
    expect(xml).toMatch(new RegExp(`Id="BB8" [^>]*Timestamp="${NOW.getTime()}"`))
    expect(xml).toMatch(/Id="7D0" [^>]*Timestamp="1767225600000"/)
  })

  // Never a second row for one file: the DJ's cues and history live on the first.
  it('reuses the entry rekordbox already has for the file', async () => {
    const path = await collection()
    const before = read(path, 'SELECT ID FROM djmdContent').length
    await applyRekordboxBatch(path, [op({ wanted: [{ id: '3000', name: 'House' }] })], deps())
    expect(read(path, 'SELECT ID FROM djmdContent')).toHaveLength(before)
    expect(contentsOf(path, '3000')).toEqual(['102', '110', '103'])
  })

  // Removing a token means "not in this playlist": every link of the track there goes,
  // the collection entry stays.
  it('takes the track out of the playlists it is no longer wanted in', async () => {
    const path = await collection()
    await applyRekordboxBatch(
      path,
      [
        op({
          path: '/Volumes/Public/Music/Play This Song.wav',
          wanted: [{ id: '3000', name: 'House' }],
          known: ['2000', '3000'],
        }),
      ],
      deps(),
    )
    expect(contentsOf(path, '2000')).toEqual(['101', '109', '201', '109', '104'])
    expect(contentsOf(path, '3000')).toEqual(['102', '110'])
  })

  it('leaves alone a playlist rekordbox changed since the track was queued, and says so', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [op({ wanted: [{ id: '3000', name: 'House' }], stamps: { '3000': 1 } })],
      deps(),
    )
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-changed', track: 'Bam Bam', playlist: 'House' },
    ])
    expect(contentsOf(path, '3000')).toEqual(['102', '110'])
  })

  // The track was dragged into Factory in rekordbox after Surco queued its playlists;
  // removing it would undo the DJ's own gesture.
  it('never removes the track from a playlist it joined in rekordbox after queueing', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [op({ path: '/Volumes/Public/Music/Play This Song.wav', wanted: [{ id: '3000', name: 'House' }], known: ['3000'] })],
      deps(),
    )
    expect(contentsOf(path, '2000')).toContain('102')
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-changed', track: 'Bam Bam', playlist: 'Factory' },
    ])
  })

  it('says a wanted playlist is gone and applies the rest', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(
      path,
      [op({ wanted: [{ id: '9999', name: 'Makina' }, { id: '3000', name: 'House' }] })],
      deps(),
    )
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'playlist-gone', track: 'Bam Bam', playlist: 'Makina' },
    ])
    expect(contentsOf(path, '3000')).toContain('103')
  })

  it('skips a file the collection holds twice and says so', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(
      path,
      [op({ path: '/Users/dj/Music/Music/Ekkah.wav', wanted: [{ id: '3000', name: 'House' }] })],
      d,
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 't', applied: false, notices: [{ code: 'ambiguous', track: 'Bam Bam' }] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  it('adds nothing for a file deleted before rekordbox closed', async () => {
    const path = await collection()
    const gone = join(dir, 'gone.wav')
    const result = await applyRekordboxBatch(
      path,
      [op({ path: gone, facts: facts(gone), wanted: [{ id: '3000', name: 'House' }] })],
      deps(),
    )
    expect(result.ok && result.outcomes[0]).toEqual({
      id: 't',
      applied: false,
      notices: [{ code: 'file-missing', track: 'Bam Bam' }],
    })
  })

  // Two tracks converted in one run with the same new name typed: one playlist, both in it.
  it('creates a new playlist name once per batch', async () => {
    const path = await collection()
    const a = await newFile('a.wav')
    const b = await newFile('b.wav')
    await applyRekordboxBatch(
      path,
      [
        op({ id: 'a', path: a, facts: facts(a), wanted: [{ name: 'Bolos' }] }),
        op({ id: 'b', path: b, facts: { ...facts(b), inode: '6789' }, wanted: [{ name: 'Bolos' }] }),
      ],
      deps(),
    )
    const rows = named(path, 'Bolos')
    expect(rows).toHaveLength(1)
    expect(contentsOf(path, rows[0].ID)).toHaveLength(2)
  })

  it('checks no Timestamp when the collection has no XML (rekordbox 5)', async () => {
    const path = await collection({ xml: false })
    await applyRekordboxBatch(
      path,
      [op({ wanted: [{ id: '3000', name: 'House' }], stamps: { '3000': 1 } })],
      deps(),
    )
    expect(contentsOf(path, '3000')).toContain('103')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueueTrack.test.ts`
Expected: FAIL, type errors on `kind: 'track'` and every batch refusing the operation (`planOp` only knows edits).

- [ ] **Step 3: Types**

Append to `src/shared/types.ts`:

```ts
export interface RekordboxPlaylistTarget {
  id?: string
  name: string
}
```

In `src/main/rekordboxQueueOps.ts` add the imports `import type { RekordboxPlaylistTarget } from '../shared/types'` (merge with the existing type import) and `import type { ContentFacts } from './rekordboxContentAdd'`, then:

```ts
export interface TrackOp {
  id: string
  kind: 'track'
  path: string
  label: string
  contentId?: string
  facts: ContentFacts | null
  wanted: RekordboxPlaylistTarget[]
  known: string[]
  stamps: Record<string, number>
}

export type QueueOp = EditOp | TrackOp
```

(replacing `export type QueueOp = EditOp`), add `contentId?: string` to `OpOutcome`, `created: Map<string, string>` to `XmlDraft`, and change `opRank`:

```ts
export function opRank(op: QueueOp): number {
  return op.kind === 'track' ? 0 : EDIT_RANK[op.edit.kind]
}
```

- [ ] **Step 4: Plan and write a track operation**

In `src/main/rekordboxPlaylistWrite.ts`, add to the imports `insertContent` and `type ContentFacts` from `./rekordboxContentAdd`, `nodeAttribute`, `removeTrackFromPlaylist`, `trackPlaylists` from `./rekordboxPlaylistEdit`, `type TrackOp` from `./rekordboxQueueOps` and `type RekordboxQueueNotice` from `../shared/types`.

Add to `Planned`:

```ts
  track?: { entry?: string; adds: string[]; removes: string[]; names: string[]; notices: RekordboxQueueNotice[] }
```

Add, after `planEdit`:

```ts
function planTrack(probe: Db, xml: string | null, op: TrackOp, find: FindOptions): Plan {
  const notices: RekordboxQueueNotice[] = []
  const finish = (applied: boolean): Plan => ({ outcome: { id: op.id, applied, notices } })
  const resolved = resolveTracks(probe, [{ contentId: op.contentId, paths: [op.path] }], find)
  if (resolved.ambiguous > 0) {
    notices.push({ code: 'ambiguous', track: op.label })
    return finish(false)
  }
  const entry = resolved.contentIds[0]
  if (!entry && op.wanted.length === 0) return finish(true)
  if (!entry && (!op.facts || !existsSync(op.path))) {
    notices.push({ code: op.facts ? 'file-missing' : 'not-added', track: op.label })
    return finish(false)
  }
  const changed = (pid: string): boolean =>
    xml !== null && op.stamps[pid] !== undefined && nodeTimestamp(xml, pid) !== op.stamps[pid]
  const current = entry ? trackPlaylists(probe, entry) : []
  const wantedIds = op.wanted.flatMap((t) => (t.id ? [t.id] : []))
  const names = [...new Set(op.wanted.flatMap((t) => (t.id ? [] : [t.name.trim()])))].filter(
    (n) => n !== '',
  )
  const adds: string[] = []
  for (const target of op.wanted) {
    if (!target.id || current.includes(target.id)) continue
    if (nodeAttribute(probe, target.id) !== 0)
      notices.push({ code: 'playlist-gone', track: op.label, playlist: target.name })
    else if (changed(target.id))
      notices.push({ code: 'playlist-changed', track: op.label, playlist: target.name })
    else adds.push(target.id)
  }
  const removes: string[] = []
  for (const pid of current) {
    if (wantedIds.includes(pid)) continue
    if (!op.known.includes(pid) || changed(pid))
      notices.push({ code: 'playlist-changed', track: op.label, playlist: playlistName(probe, pid) })
    else removes.push(pid)
  }
  if (entry && adds.length === 0 && removes.length === 0 && names.length === 0)
    return finish(true)
  return { op, track: { entry, adds, removes, names, notices } }
}

function writeTrack(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  const op = planned.op as TrackOp
  const plan = planned.track as NonNullable<Planned['track']>
  const ctx = { now, newPlaylistId: () => freeId(draft) }
  const entry = plan.entry ?? insertContent(db, op.facts as ContentFacts, { now })
  const adds = [...plan.adds]
  for (const name of plan.names) {
    let pid = draft.created.get(name)
    if (!pid) {
      pid = createNode(db, 'root', name, false, ctx).id
      if (draft.xml !== null)
        draft.xml = withPlaylistNode(draft.xml, {
          id: pid,
          parentId: 'root',
          attribute: 0,
          timestamp: draft.now,
        })
      draft.taken.add(hexId(pid))
      draft.created.set(name, pid)
    }
    adds.push(pid)
  }
  for (const pid of adds) {
    addToPlaylist(db, pid, [entry], ctx)
    bumpNode(draft, pid)
  }
  for (const pid of plan.removes) {
    removeTrackFromPlaylist(db, pid, entry, ctx)
    bumpNode(draft, pid)
  }
  return { id: op.id, applied: true, notices: plan.notices, contentId: entry }
}
```

Replace `planOp`, `writeOp` and `needsNode`:

```ts
function planOp(probe: Db, xml: string | null, op: QueueOp, find: FindOptions): Plan {
  return op.kind === 'track' ? planTrack(probe, xml, op, find) : planEdit(probe, xml, op, find)
}

function writeOp(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  return planned.op.kind === 'track'
    ? writeTrack(db, draft, planned, now)
    : writeEdit(db, draft, planned, now)
}

function needsNode(planned: Planned): boolean {
  if (planned.op.kind === 'track') return (planned.track?.names.length ?? 0) > 0
  return planned.op.edit.kind === 'create'
}
```

In `applyRekordboxBatch`, the draft gains `created: new Map<string, string>()`, and the savepoint loop keeps a full snapshot so a refused operation leaves no name, ID or node behind:

```ts
    for (const p of [...planned].sort((a, b) => opRank(a.op) - opRank(b.op))) {
      const saved = { xml: draft.xml, taken: new Set(draft.taken), created: new Map(draft.created) }
      db.exec('SAVEPOINT surco_op')
      try {
        outcomes.set(p.op.id, writeOp(db, draft, p, now))
        db.exec('RELEASE surco_op')
      } catch (err) {
        if (!(err instanceof EditRefused)) throw err
        db.exec('ROLLBACK TO surco_op')
        db.exec('RELEASE surco_op')
        Object.assign(draft, saved)
        outcomes.set(p.op.id, { id: p.op.id, applied: false, reason: err.reason, notices: [] })
      }
    }
```

`writeEdit` reads `planned.op as EditOp`; with the widened union that cast still compiles.

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueueTrack.test.ts src/main/rekordboxPlaylistWrite.test.ts src/main/rekordboxContentAdd.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Delete `!op.known.includes(pid) ||` and rerun: `'never removes the track from a playlist it joined in rekordbox after queueing'` must fail. Replace `draft.created.get(name)` with `undefined`: `'creates a new playlist name once per batch'` must fail. Restore both.

- [ ] **Step 7: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxQueueOps.ts apps/desktop/src/main/rekordboxPlaylistWrite.ts apps/desktop/src/main/rekordboxQueueTrack.test.ts
git commit -m "Add a track to rekordbox and to the playlists it should be in, rekordbox winning conflicts"
```

---

### Task 6: The queue file and its apply

**Files:**
- Modify: `src/shared/types.ts` (append the queue state types)
- Modify: `src/main/rekordboxQueueOps.ts` (`EditOp.label?`)
- Create: `src/main/rekordboxQueue.ts`
- Test: `src/main/rekordboxQueue.test.ts`

**Interfaces:**
- Consumes: Task 4/5 `QueueOp`, `OpOutcome`, `BatchResult`, `RekordboxQueueNotice`; `RekordboxRepoint` (`rekordboxBatch.ts`); `LibraryRepointResult` (`libraryRepointFlush.ts`).
- Produces:
  - `shared/types.ts`: `type RekordboxQueuePart = { kind: 'repoint' } | { kind: 'collection' } | { kind: 'playlists'; names: string[] } | { kind: 'tree'; edit: RekordboxPlaylistEdit['kind'] }`; `interface RekordboxQueueItem { key: string; label: string; parts: RekordboxQueuePart[] }`; `interface RekordboxQueueState { tracks: number; changes: number; items: RekordboxQueueItem[] }`; `type RekordboxQueueApplied = { tracks: number; changes: number; notices: RekordboxQueueNotice[] } | { refused: RekordboxEditRefusal }`
  - `EditOp.label?: string` (the playlist's name, for the pill and the notices)
  - `rekordboxQueue.ts`: `interface QueueStore { read(): string | null; write(text: string): void; setAside(): void }`, `fileStore(path: string): QueueStore`, `interface QueueDeps { store; collection(): string; applyBatch(collectionPath: string, ops: QueueOp[], ensureClosed: () => Promise<boolean>): Promise<BatchResult>; repoint(collectionPath: string, repoints: RekordboxRepoint[]): Promise<LibraryRepointResult[]>; onChange(state: RekordboxQueueState): void }`, `type QueueApply = { status: 'empty' } | { status: 'refused'; reason: RekordboxEditRefusal } | { status: 'applied'; tracks: number; changes: number; notices: RekordboxQueueNotice[]; outcomes: OpOutcome[] }`, `createRekordboxQueue(deps: QueueDeps): RekordboxQueue` with `enqueue(ops: QueueOp[], repoints?: RekordboxRepoint[]): void`, `state(): RekordboxQueueState`, `isEmpty(): boolean`, `discard(): void`, `apply(ensureClosed: () => Promise<boolean>): Promise<QueueApply>`
  - `keyOf(op: QueueOp): string` (a later operation with the same key replaces the earlier one; plan B adds its cues key)

Behaviour:
- The file is `rekordbox-queue.json` in userData, `{ "version": 1, "repoints": [...], "ops": [...] }`, rewritten (temp file and rename) after every change. Unreadable: set aside as `rekordbox-queue.json.unreadable`, logged, the queue starts empty.
- A track operation for a path already queued replaces it (`track:<path>`); an edit never replaces another (`edit:<id>`). A repoint with the same `from` replaces the earlier one, as `recordRekordboxRepoint` does.
- `apply`: repoints first (asking `ensureClosed` once before them), then the operations in one batch (the batch asks, when there were no repoints, only if it has something to write). A collection-wide repoint failure, or a refused batch, keeps everything. A finished batch removes the operations it was given, applied or dropped by a conflict (rekordbox won; the notice says so), never one queued meanwhile. Applies never overlap.
- Counts: `tracks` = distinct track keys, `changes` = tree edits. An edit refused without a notice of its own (`stale` from `editProblem`) gets `{ code: 'edit-changed', playlist: label }`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/rekordboxQueue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { RekordboxQueueState } from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import { createRekordboxQueue, type QueueDeps, type QueueStore } from './rekordboxQueue'
import type { BatchResult, QueueOp, TrackOp } from './rekordboxQueueOps'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

function memoryStore(initial: string | null = null): QueueStore & { text: string | null; aside: boolean } {
  const store = {
    text: initial,
    aside: false,
    read: () => store.text,
    write: (text: string) => {
      store.text = text
    },
    setAside: () => {
      store.aside = true
      store.text = null
    },
  }
  return store
}

const track = (id: string, path: string, over: Partial<TrackOp> = {}): TrackOp => ({
  id,
  kind: 'track',
  path,
  label: path.split('/').pop() ?? path,
  facts: null,
  wanted: [{ id: '3000', name: 'Makina' }],
  known: [],
  stamps: {},
  ...over,
})

const rename: QueueOp = {
  id: 'e1',
  kind: 'edit',
  edit: { kind: 'rename', playlistId: '3000', name: 'Makina 26' },
  stamps: {},
  label: 'Makina',
}

const applied = (ops: QueueOp[]): BatchResult => ({
  ok: true,
  wrote: true,
  outcomes: ops.map((o) => ({ id: o.id, applied: true, notices: [] })),
})

function deps(over: Partial<QueueDeps> = {}) {
  return {
    store: memoryStore(),
    collection: () => '/c/master.db',
    applyBatch: vi.fn<QueueDeps['applyBatch']>(async (_c, ops) => applied(ops)),
    repoint: vi.fn<QueueDeps['repoint']>(async (_c, list) =>
      list.map((): LibraryRepointResult => ({ written: true })),
    ),
    onChange: vi.fn<(s: RekordboxQueueState) => void>(),
    ...over,
  }
}

const closed = async () => true

describe('rekordbox queue', () => {
  // The spec's promise: what waits for rekordbox to close survives closing Surco.
  it('survives a restart', () => {
    const d = deps()
    createRekordboxQueue(d).enqueue([track('a', '/m/a.wav')])
    const again = createRekordboxQueue({ ...d, onChange: vi.fn() })
    expect(again.state().tracks).toBe(1)
  })

  // Converting a track twice before rekordbox closes must leave one wish, the last one.
  it('keeps only the latest operation for one track', () => {
    const q = createRekordboxQueue(deps())
    q.enqueue([track('a', '/m/a.wav')])
    q.enqueue([track('b', '/m/a.wav', { wanted: [{ name: 'Cierre' }] })])
    expect(q.state().items).toEqual([
      {
        key: 'track:/m/a.wav',
        label: 'a.wav',
        parts: [
          { kind: 'collection' },
          { kind: 'playlists', names: ['Cierre'] },
        ],
      },
    ])
  })

  it('counts tracks apart from tree changes, and names what happens to each', () => {
    const q = createRekordboxQueue(deps())
    const repoint: RekordboxRepoint = { from: '/m/b.mp3', to: '/m/b.wav' }
    q.enqueue([track('a', '/m/a.wav', { contentId: '101' }), rename], [repoint])
    expect(q.state()).toEqual({
      tracks: 2,
      changes: 1,
      items: [
        { key: 'track:/m/b.wav', label: 'b.wav', parts: [{ kind: 'repoint' }] },
        { key: 'track:/m/a.wav', label: 'a.wav', parts: [{ kind: 'playlists', names: ['Makina'] }] },
        { key: 'edit:e1', label: 'Makina', parts: [{ kind: 'tree', edit: 'rename' }] },
      ],
    })
  })

  it('tells the window every time the queue changes', () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    q.discard()
    expect(d.onChange).toHaveBeenCalledTimes(2)
    expect(d.onChange).toHaveBeenLastCalledWith({ tracks: 0, changes: 0, items: [] })
  })

  // Spec order: the conversion's repoint before the batch, so a track converted to WAV is
  // found under its new path when its playlists are written.
  it('applies the repoints, then the batch, and empties the queue', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    const calls: string[] = []
    d.repoint.mockImplementation(async (_c, list) => {
      calls.push('repoint')
      return list.map(() => ({ written: true }))
    })
    d.applyBatch.mockImplementation(async (_c, ops) => {
      calls.push('batch')
      return applied(ops)
    })
    q.enqueue([track('a', '/m/b.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(closed)).toEqual({
      status: 'applied',
      tracks: 1,
      changes: 0,
      notices: [],
      outcomes: [{ id: 'a', applied: true, notices: [] }],
    })
    expect(calls).toEqual(['repoint', 'batch'])
    expect(q.isEmpty()).toBe(true)
  })

  // A conflict is rekordbox winning: the operation is done with, and the user is told.
  it('drops an operation the batch refused for a conflict and passes its notice on', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({
        ok: true,
        wrote: false,
        outcomes: [{ id: 'e1', applied: false, reason: 'stale', notices: [] }],
      })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    const result = await q.apply(closed)
    expect(result.status === 'applied' && result.notices).toEqual([
      { code: 'edit-changed', playlist: 'Makina' },
    ])
    expect(q.isEmpty()).toBe(true)
  })

  // Nothing written means nothing lost: the queue waits for the next close.
  it('keeps everything when the batch is refused', async () => {
    const d = deps({
      applyBatch: vi.fn<QueueDeps['applyBatch']>(async () => ({ ok: false, reason: 'backup-failed' })),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([rename])
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'backup-failed' })
    expect(q.state().changes).toBe(1)
  })

  it('writes no batch when the repoints stop for the whole collection', async () => {
    const d = deps({
      repoint: vi.fn<QueueDeps['repoint']>(async () => [{ written: false, reason: 'rekordbox-running' }]),
    })
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/b.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(closed)).toEqual({ status: 'refused', reason: 'rekordbox-running' })
    expect(d.applyBatch).not.toHaveBeenCalled()
    expect(q.state().items[0].parts).toContainEqual({ kind: 'repoint' })
  })

  it('asks nothing and writes nothing when the user keeps rekordbox open', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/b.wav')], [{ from: '/m/b.mp3', to: '/m/b.wav' }])
    expect(await q.apply(async () => false)).toEqual({ status: 'refused', reason: 'cancelled' })
    expect(d.repoint).not.toHaveBeenCalled()
  })

  // A conversion finishing while the queue applies must not be swept away by that apply.
  it('keeps operations queued while an apply is running', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    q.enqueue([track('a', '/m/a.wav')])
    d.applyBatch.mockImplementationOnce(async (_c, ops) => {
      q.enqueue([track('b', '/m/b.wav')])
      return applied(ops)
    })
    await q.apply(closed)
    expect(q.state().items.map((i) => i.key)).toEqual(['track:/m/b.wav'])
  })

  it('never runs two applies at once', async () => {
    const d = deps()
    const q = createRekordboxQueue(d)
    let inFlight = 0
    let most = 0
    d.applyBatch.mockImplementation(async (_c, ops) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return applied(ops)
    })
    q.enqueue([track('a', '/m/a.wav')])
    await Promise.all([q.apply(closed), q.apply(closed)])
    expect(most).toBe(1)
  })

  it('sets an unreadable file aside and starts empty', () => {
    const store = memoryStore('{ not json')
    const q = createRekordboxQueue(deps({ store }))
    expect(q.isEmpty()).toBe(true)
    expect(store.aside).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueue.test.ts`
Expected: FAIL, `Cannot find module './rekordboxQueue'`.

- [ ] **Step 3: Types**

In `src/main/rekordboxQueueOps.ts`, add `label?: string` to `EditOp`.

Append to `src/shared/types.ts`:

```ts
export type RekordboxQueuePart =
  | { kind: 'repoint' }
  | { kind: 'collection' }
  | { kind: 'playlists'; names: string[] }
  | { kind: 'tree'; edit: RekordboxPlaylistEdit['kind'] }

export interface RekordboxQueueItem {
  key: string
  label: string
  parts: RekordboxQueuePart[]
}

export interface RekordboxQueueState {
  tracks: number
  changes: number
  items: RekordboxQueueItem[]
}

export type RekordboxQueueApplied =
  | { tracks: number; changes: number; notices: RekordboxQueueNotice[] }
  | { refused: RekordboxEditRefusal }
```

- [ ] **Step 4: Implement**

Create `src/main/rekordboxQueue.ts`:

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import log from 'electron-log/main'
import type {
  RekordboxEditRefusal,
  RekordboxQueueItem,
  RekordboxQueueNotice,
  RekordboxQueueState,
} from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { BatchResult, OpOutcome, QueueOp } from './rekordboxQueueOps'

interface QueueFile {
  version: 1
  repoints: RekordboxRepoint[]
  ops: QueueOp[]
}

export interface QueueStore {
  read: () => string | null
  write: (text: string) => void
  setAside: () => void
}

export function fileStore(path: string): QueueStore {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: (text) => {
      writeFileSync(`${path}.tmp`, text, 'utf8')
      renameSync(`${path}.tmp`, path)
    },
    setAside: () => renameSync(path, `${path}.unreadable`),
  }
}

export interface QueueDeps {
  store: QueueStore
  collection: () => string
  applyBatch: (
    collectionPath: string,
    ops: QueueOp[],
    ensureClosed: () => Promise<boolean>,
  ) => Promise<BatchResult>
  repoint: (collectionPath: string, repoints: RekordboxRepoint[]) => Promise<LibraryRepointResult[]>
  onChange: (state: RekordboxQueueState) => void
}

export type QueueApply =
  | { status: 'empty' }
  | { status: 'refused'; reason: RekordboxEditRefusal }
  | {
      status: 'applied'
      tracks: number
      changes: number
      notices: RekordboxQueueNotice[]
      outcomes: OpOutcome[]
    }

export interface RekordboxQueue {
  enqueue: (ops: QueueOp[], repoints?: RekordboxRepoint[]) => void
  state: () => RekordboxQueueState
  isEmpty: () => boolean
  discard: () => void
  apply: (ensureClosed: () => Promise<boolean>) => Promise<QueueApply>
}

const COLLECTION_WIDE: ReadonlySet<string> = new Set([
  'rekordbox-running',
  'backup-failed',
  'read-only',
  'unreadable',
  'write-failed',
])

export function keyOf(op: QueueOp): string {
  return op.kind === 'track' ? `track:${op.path}` : `edit:${op.id}`
}

function load(store: QueueStore): QueueFile {
  const empty: QueueFile = { version: 1, repoints: [], ops: [] }
  const text = store.read()
  if (text === null) return empty
  let parsed: QueueFile | null
  try {
    parsed = JSON.parse(text) as QueueFile
  } catch {
    parsed = null
  }
  if (parsed?.version === 1 && Array.isArray(parsed.ops) && Array.isArray(parsed.repoints))
    return parsed
  log.warn('rekordbox queue file unreadable, set aside as .unreadable')
  store.setAside()
  return empty
}

function stateOf(q: QueueFile): RekordboxQueueState {
  const items = new Map<string, RekordboxQueueItem>()
  const item = (key: string, label: string): RekordboxQueueItem => {
    const found = items.get(key)
    if (found) return found
    const made: RekordboxQueueItem = { key, label, parts: [] }
    items.set(key, made)
    return made
  }
  for (const r of q.repoints) item(`track:${r.to}`, basename(r.to)).parts.push({ kind: 'repoint' })
  for (const op of q.ops) {
    const it = item(keyOf(op), op.kind === 'track' ? op.label : (op.label ?? ''))
    if (op.kind === 'track') {
      it.label = op.label
      if (!op.contentId) it.parts.push({ kind: 'collection' })
      it.parts.push({ kind: 'playlists', names: op.wanted.map((t) => t.name) })
    } else it.parts.push({ kind: 'tree', edit: op.edit.kind })
  }
  const all = [...items.values()]
  const tracks = all.filter((i) => i.key.startsWith('track:')).length
  return { tracks, changes: all.length - tracks, items: all }
}

export function createRekordboxQueue(deps: QueueDeps): RekordboxQueue {
  const q = load(deps.store)
  let chain: Promise<unknown> = Promise.resolve()

  const save = (): void => {
    deps.store.write(JSON.stringify(q))
    deps.onChange(stateOf(q))
  }

  const refused = (reason: RekordboxEditRefusal): QueueApply => ({ status: 'refused', reason })

  const run = async (ensureClosed: () => Promise<boolean>): Promise<QueueApply> => {
    if (q.repoints.length === 0 && q.ops.length === 0) return { status: 'empty' }
    const collectionPath = deps.collection()
    if (!collectionPath) return refused('unreadable')
    const repoints = [...q.repoints]
    let askBatch = ensureClosed
    if (repoints.length > 0) {
      if (!(await ensureClosed())) return refused('cancelled')
      askBatch = async () => true
      const results = await deps.repoint(collectionPath, repoints)
      const wide = results.find((r) => !r.written && COLLECTION_WIDE.has(r.reason))
      if (wide && !wide.written) return refused(wide.reason as RekordboxEditRefusal)
      q.repoints = q.repoints.filter((r) => !repoints.includes(r))
      save()
    }
    const ops = [...q.ops]
    if (ops.length === 0)
      return { status: 'applied', tracks: repoints.length, changes: 0, notices: [], outcomes: [] }
    const result = await deps.applyBatch(collectionPath, ops, askBatch)
    if (!result.ok) return refused(result.reason)
    const given = new Set(ops.map((o) => o.id))
    q.ops = q.ops.filter((o) => !given.has(o.id))
    save()
    const byId = new Map(ops.map((o) => [o.id, o]))
    const notices = result.outcomes.flatMap((o) => {
      const op = byId.get(o.id)
      if (op?.kind === 'edit' && !o.applied && o.notices.length === 0 && o.reason !== 'nothing-to-add')
        return [{ code: 'edit-changed' as const, playlist: op.label ?? '' }]
      return o.notices
    })
    const appliedOps = result.outcomes.filter((o) => o.applied).map((o) => byId.get(o.id))
    const tracks = new Set([
      ...repoints.map((r) => r.to),
      ...appliedOps.flatMap((op) => (op?.kind === 'track' ? [op.path] : [])),
    ]).size
    const changes = appliedOps.filter((op) => op?.kind === 'edit').length
    return { status: 'applied', tracks, changes, notices, outcomes: result.outcomes }
  }

  return {
    enqueue(ops, repoints = []) {
      for (const r of repoints) {
        const at = q.repoints.findIndex((x) => x.from === r.from)
        if (at === -1) q.repoints.push(r)
        else q.repoints[at] = r
      }
      for (const op of ops) {
        const at = q.ops.findIndex((x) => keyOf(x) === keyOf(op))
        if (at === -1) q.ops.push(op)
        else q.ops[at] = op
      }
      save()
    },
    state: () => stateOf(q),
    isEmpty: () => q.repoints.length === 0 && q.ops.length === 0,
    discard() {
      q.repoints = []
      q.ops = []
      save()
    },
    apply(ensureClosed) {
      const next = chain.then(() => run(ensureClosed))
      chain = next.catch(() => undefined)
      return next
    },
  }
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueue.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Replace `q.ops = q.ops.filter((o) => !given.has(o.id))` with `q.ops = []`: `'keeps operations queued while an apply is running'` must fail. Replace `else q.ops[at] = op` with `else q.ops.push(op)`: `'keeps only the latest operation for one track'` must fail. Restore both.

- [ ] **Step 7: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxQueueOps.ts apps/desktop/src/main/rekordboxQueue.ts apps/desktop/src/main/rekordboxQueue.test.ts
git commit -m "Keep rekordbox writes in a persistent queue and apply it as one batch"
```

---

### Task 7: Apply when rekordbox closes

**Files:**
- Create: `src/main/rekordboxQueueWatch.ts`
- Test: `src/main/rekordboxQueueWatch.test.ts`

**Interfaces:**
- Consumes: Task 6 `RekordboxQueue` (`isEmpty`, `apply`), `QueueApply`.
- Produces: `interface WatchDeps { queue: Pick<RekordboxQueue, 'isEmpty' | 'apply'>; isRunning: () => Promise<boolean>; onApplied: (result: QueueApply) => void; intervalMs?: number }`, `watchRekordboxQueue(deps: WatchDeps): { poke(): void; stop(): void }`. `poke` is called at startup and after every enqueue; it checks at once and then every 5 s while the queue holds anything, and stops by itself when it is empty.

Behaviour (spec "Cuándo se aplica", Decision 10): rekordbox running means wait and remember it was seen. Closed means apply, with an `ensureClosed` that only checks (never a dialog: the user did not ask for anything right now). A refusal for rekordbox (`cancelled`, `rekordbox-running`) keeps polling. Any other refusal (`backup-failed`, `write-failed`, ...) is reported once and disarms the watcher until rekordbox is seen running again, so a missing backup is retried at the next close and not every 5 s. Ticks never overlap.

- [ ] **Step 1: Write the failing tests**

Create `src/main/rekordboxQueueWatch.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueApply } from './rekordboxQueue'
import { watchRekordboxQueue, type WatchDeps } from './rekordboxQueueWatch'

const APPLIED: QueueApply = { status: 'applied', tracks: 1, changes: 0, notices: [], outcomes: [] }

function setup(running: boolean[], results: QueueApply[] = [APPLIED]) {
  let empty = false
  const deps = {
    queue: {
      isEmpty: () => empty,
      apply: vi.fn<WatchDeps['queue']['apply']>(async (ensureClosed) => {
        const result = results.shift() ?? APPLIED
        if (result.status === 'applied') empty = true
        expect(await ensureClosed()).toBe(true)
        return result
      }),
    },
    isRunning: vi.fn(async () => running.shift() ?? false),
    onApplied: vi.fn<WatchDeps['onApplied']>(),
  }
  return { deps, setEmpty: (v: boolean) => (empty = v) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchRekordboxQueue', () => {
  // The spec's case: the DJ converts with rekordbox open, closes it later, and the
  // queue lands without anyone pressing anything.
  it('applies once rekordbox is seen closed', async () => {
    const { deps } = setup([true, true, false, false])
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.queue.apply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    expect(deps.onApplied).toHaveBeenCalledWith(APPLIED)
    watch.stop()
  })

  // Polling costs a process listing every 5 s; with nothing queued it must not run.
  it('stops polling once the queue is empty', async () => {
    const { deps } = setup([false, false])
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    const checks = deps.isRunning.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(deps.isRunning.mock.calls.length).toBe(checks)
  })

  // A backup that cannot be made (disk full) would otherwise retry, and log, every 5 s
  // for as long as Surco stays open.
  it('waits for the next close after a failure that is not rekordbox', async () => {
    const { deps } = setup(
      [false, false, false, true, false, false],
      [{ status: 'refused', reason: 'backup-failed' }, APPLIED],
    )
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.onApplied).toHaveBeenCalledWith({ status: 'refused', reason: 'backup-failed' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(2)
    watch.stop()
  })

  // rekordbox reopened between the check and the write: nothing to tell, keep waiting.
  it('keeps polling silently when the apply found rekordbox open again', async () => {
    const { deps } = setup([false, false, false, false], [{ status: 'refused', reason: 'rekordbox-running' }, APPLIED])
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(2)
    expect(deps.onApplied).toHaveBeenCalledTimes(1)
    expect(deps.onApplied).toHaveBeenCalledWith(APPLIED)
    watch.stop()
  })

  it('does nothing at startup with an empty queue', async () => {
    const { deps, setEmpty } = setup([])
    setEmpty(true)
    watchRekordboxQueue(deps).poke()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.isRunning).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueueWatch.test.ts`
Expected: FAIL, `Cannot find module './rekordboxQueueWatch'`.

- [ ] **Step 3: Implement**

Create `src/main/rekordboxQueueWatch.ts`:

```ts
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'

export interface WatchDeps {
  queue: Pick<RekordboxQueue, 'isEmpty' | 'apply'>
  isRunning: () => Promise<boolean>
  onApplied: (result: QueueApply) => void
  intervalMs?: number
}

export function watchRekordboxQueue(deps: WatchDeps): { poke: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let armed = true
  let busy = false

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const tick = async (): Promise<void> => {
    if (busy) return
    if (deps.queue.isEmpty()) {
      stop()
      return
    }
    busy = true
    try {
      if (await deps.isRunning()) {
        armed = true
        return
      }
      if (!armed) return
      const result = await deps.queue.apply(async () => !(await deps.isRunning()))
      if (
        result.status === 'refused' &&
        (result.reason === 'cancelled' || result.reason === 'rekordbox-running')
      )
        return
      if (result.status === 'refused') armed = false
      if (result.status !== 'empty') deps.onApplied(result)
      if (deps.queue.isEmpty()) stop()
    } finally {
      busy = false
    }
  }

  return {
    poke() {
      if (deps.queue.isEmpty()) return
      if (!timer) timer = setInterval(() => void tick(), deps.intervalMs ?? 5000)
      void tick()
    },
    stop,
  }
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxQueueWatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Delete `if (!armed) return` and rerun: `'waits for the next close after a failure that is not rekordbox'` must fail. Restore.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/rekordboxQueueWatch.ts apps/desktop/src/main/rekordboxQueueWatch.test.ts
git commit -m "Apply the rekordbox queue when rekordbox closes"
```

---

### Task 8: A conversion run fills the queue

**Files:**
- Modify: `src/shared/types.ts` (`ProcessJob.rekordboxPlaylists?`)
- Modify: `src/main/rekordboxBatch.ts` (`RekordboxRepoint.playlists?`, `attachRekordboxPlaylists`)
- Modify: `src/main/processTrack.ts` (`ProcessTrackDeps.attachRekordboxPlaylists?`, one call after `convertAudio`)
- Create: `src/main/rekordboxQueueFromRun.ts`
- Modify: `src/main/libraryFlushes.ts` (`flushConversionBatch`)
- Test: `src/main/rekordboxBatch.test.ts`, `src/main/processTrack.test.ts`, `src/main/rekordboxQueueFromRun.test.ts`

**Interfaces:**
- Consumes: Task 2 `readContentFacts`, `ContentProbe`; Task 3 `trackPlaylists`; Task 1 `nodeTimestamp`; Task 5 `TrackOp`, `RekordboxPlaylistTarget`; Task 6 `RekordboxQueue['enqueue']`; existing `flushRekordboxSync`, `FlushResult`, `resolveTracks`.
- Produces:
  - `ProcessJob.rekordboxPlaylists?: RekordboxPlaylistTarget[]` (absent: the field was never touched, nothing is queued; `[]`: out of every playlist)
  - `RekordboxRepoint.playlists?: RekordboxPlaylistTarget[]`; `attachRekordboxPlaylists(to: string, playlists: RekordboxPlaylistTarget[]): void`
  - `ProcessTrackDeps.attachRekordboxPlaylists?: (to: string, playlists: RekordboxPlaylistTarget[]) => void`
  - `trackOpsFromRun(collectionPath: string, repoints: RekordboxRepoint[], opts: { repointing: boolean; probe: ContentProbe; find: FindOptions; newId?: () => string }): Promise<TrackOp[]>`
  - `interface RunQueueDeps { collectionPath: string; repointing: boolean; flushRepoints: (repoints: RekordboxRepoint[]) => Promise<FlushResult>; readOps: (repoints: RekordboxRepoint[]) => Promise<TrackOp[]>; enqueue: (ops: TrackOp[], repoints: RekordboxRepoint[]) => void; apply: () => void }`, `queueConversionRun(repoints: RekordboxRepoint[], deps: RunQueueDeps): Promise<void>`
  - `flushConversionBatch(host, sessions, queue: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void })` (new third parameter; Task 9 passes it)

Rules (spec "Al convertir o actualizar", Decisions 5, 14 and 19):
- The repoint flush runs as today, gated by "Sincronizar rekordbox", with its close dialog. If it stopped because rekordbox stayed open, its repoints go to the queue instead of being lost, and no "blocked" dialog follows (the pill says it).
- The track operations do not depend on the toggle: for every repoint carrying `playlists`, one `TrackOp` for the final path. Its entry is looked up when it is queued, by the final path and, when the repoint is part of this run, by the path it came from; its current playlists become `known`; the node `Timestamp` of every playlist it is in or wants becomes `stamps`; the file's facts are read now, while the file is certainly there.
- Then the queue applies without a dialog (only if rekordbox is closed); otherwise it waits and the pill shows it.
- Decision 19: when "Sincronizar rekordbox" is off, a converted MP3-to-WAV with playlists is looked up by its new path only, so the WAV is added beside the MP3 entry rather than the MP3 entry silently following it. Flagged for Vicent in Task 16.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/rekordboxBatch.test.ts` (add `attachRekordboxPlaylists` to the import):

```ts
describe('playlists on a repoint', () => {
  // The repoint is recorded inside the encode; only the job knows the wanted playlists,
  // so they join the entry for the file it just wrote.
  it('attaches the wanted playlists to the repoint of the file just written', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    attachRekordboxPlaylists('/m/one.wav', [{ id: '3000', name: 'Makina' }])
    expect(endRekordboxBatch()).toEqual([{ ...a, playlists: [{ id: '3000', name: 'Makina' }] }])
  })

  // Apple Music moves the file after the encode; the playlists travel with the redirect.
  it('keeps the playlists when the repoint is redirected', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    attachRekordboxPlaylists('/m/one.wav', [{ name: 'Bolos' }])
    redirectRekordboxRepoint('/m/one.wav', '/Media/one.wav')
    expect(endRekordboxBatch()).toEqual([{ ...a, to: '/Media/one.wav', playlists: [{ name: 'Bolos' }] }])
  })
})
```

Append to `src/main/processTrack.test.ts`, inside its top-level `describe` (it has `job` and `makeDeps` helpers):

```ts
  // The Playlists field rides the job; main hands it to the rekordbox batch for the file
  // the conversion actually wrote.
  it('attaches the job playlists to the file it wrote', async () => {
    const attachRekordboxPlaylists = vi.fn()
    const result = await runProcessTrack(
      job({ rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] }),
      makeDeps({ attachRekordboxPlaylists }),
    )
    expect(attachRekordboxPlaylists).toHaveBeenCalledWith(result.outputPath, [
      { id: '3000', name: 'Makina' },
    ])
  })

  it('attaches nothing when the field was never touched', async () => {
    const attachRekordboxPlaylists = vi.fn()
    await runProcessTrack(job(), makeDeps({ attachRekordboxPlaylists }))
    expect(attachRekordboxPlaylists).not.toHaveBeenCalled()
  })
```

Create `src/main/rekordboxQueueFromRun.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import type { RekordboxRepoint } from './rekordboxBatch'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import { ORGANISE_FIXTURE, TWIN_PATHS, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import { queueConversionRun, type RunQueueDeps, trackOpsFromRun } from './rekordboxQueueFromRun'

const META = rekordboxMetaFrom({ ...emptyMetadata(), artist: 'Sister Nancy', title: 'Bam Bam' })
const probe = {
  properties: async () => ({ sampleRateHz: 44100, bitDepth: 16, channels: 2, bitrateKbps: 1411 }),
  duration: async () => 200,
}
let n = 0
const newId = () => `op-${++n}`

async function collection(): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbrun-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    xml: true,
    xmlTimestamps: { '2000': 1767225600111 },
  })
  return { path, dir }
}

describe('trackOpsFromRun', () => {
  // The conversion moved Play This Song from MP3 to WAV; its entry is found by where it
  // came from, and Surco records where rekordbox has it today to spot later changes.
  it('records the entry, its playlists and their Timestamps when queued', async () => {
    const { path } = await collection()
    const repoint: RekordboxRepoint = {
      from: '/Volumes/Public/Music/Play This Song.wav',
      to: '/Volumes/Public/Music/Play This Song (24).wav',
      meta: META,
      playlists: [{ id: '3000', name: 'House' }],
    }
    const [op] = await trackOpsFromRun(path, [repoint], { repointing: true, probe, find: TWIN_PATHS, newId })
    expect(op).toMatchObject({
      kind: 'track',
      path: '/Volumes/Public/Music/Play This Song (24).wav',
      label: 'Sister Nancy - Bam Bam',
      contentId: '102',
      wanted: [{ id: '3000', name: 'House' }],
    })
    expect(op.known.sort()).toEqual(['2000', '3000'])
    expect(op.stamps).toEqual({ '2000': 1767225600111, '3000': 1767225600000 })
  })

  // Read now, while the file is certainly there; the apply may come hours later.
  it('reads the facts of a file rekordbox does not have', async () => {
    const { path, dir } = await collection()
    const file = join(dir, 'Bam Bam.wav')
    await writeFile(file, Buffer.alloc(64))
    const [op] = await trackOpsFromRun(
      path,
      [{ from: file, to: file, meta: META, playlists: [{ name: 'Bolos' }] }],
      { repointing: false, probe, find: TWIN_PATHS, newId },
    )
    expect(op.contentId).toBeUndefined()
    expect(op.known).toEqual([])
    expect(op.facts).toMatchObject({ path: file, fileType: 11, fileSize: 64 })
  })

  it('queues nothing for a track whose field was never touched', async () => {
    const { path } = await collection()
    expect(
      await trackOpsFromRun(path, [{ from: '/m/a.mp3', to: '/m/a.wav', meta: META }], {
        repointing: true,
        probe,
        find: TWIN_PATHS,
        newId,
      }),
    ).toEqual([])
  })

  it('queues nothing without a collection', async () => {
    expect(
      await trackOpsFromRun('', [{ from: '/m/a.wav', to: '/m/a.wav', meta: META, playlists: [] }], {
        repointing: false,
        probe,
        find: TWIN_PATHS,
        newId,
      }),
    ).toEqual([])
  })
})

describe('queueConversionRun', () => {
  const repoint: RekordboxRepoint = { from: '/m/a.mp3', to: '/m/a.wav', meta: META }
  const deps = (over: Partial<RunQueueDeps> = {}) => ({
    collectionPath: '/c/master.db',
    repointing: true,
    flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({ written: 1, skipped: [] })),
    readOps: vi.fn<RunQueueDeps['readOps']>(async () => []),
    enqueue: vi.fn<RunQueueDeps['enqueue']>(),
    apply: vi.fn<RunQueueDeps['apply']>(),
    ...over,
  })

  // Today Cancel loses the repoint and the DJ relocates the track by hand in rekordbox.
  it('queues the repoints the user kept rekordbox open for', async () => {
    const d = deps({
      flushRepoints: vi.fn<RunQueueDeps['flushRepoints']>(async () => ({
        written: 0,
        skipped: [],
        blocked: 'rekordbox-running',
      })),
    })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([], [repoint])
    expect(d.apply).toHaveBeenCalled()
  })

  it('queues the run playlists whatever the repoint did', async () => {
    const op = {
      id: 'x',
      kind: 'track' as const,
      path: '/m/a.wav',
      label: 'a',
      facts: null,
      wanted: [],
      known: [],
      stamps: {},
    }
    const d = deps({ readOps: vi.fn<RunQueueDeps['readOps']>(async () => [op]) })
    await queueConversionRun([repoint], d)
    expect(d.enqueue).toHaveBeenCalledWith([op], [])
  })

  it('leaves the queue alone when the run has nothing for it', async () => {
    const d = deps()
    await queueConversionRun([repoint], d)
    expect(d.enqueue).not.toHaveBeenCalled()
    expect(d.apply).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxBatch.test.ts src/main/processTrack.test.ts src/main/rekordboxQueueFromRun.test.ts`
Expected: FAIL, `attachRekordboxPlaylists is not a function`, the processTrack spy never called, and `Cannot find module './rekordboxQueueFromRun'`.

- [ ] **Step 3: The job and the batch**

In `src/shared/types.ts`, add to `ProcessJob` (after `replacesLabel`):

```ts
  rekordboxPlaylists?: RekordboxPlaylistTarget[]
```

In `src/main/rekordboxBatch.ts`, add `import type { RekordboxPlaylistTarget } from '../shared/types'`, add `playlists?: RekordboxPlaylistTarget[]` to `RekordboxRepoint`, and append:

```ts
export function attachRekordboxPlaylists(to: string, playlists: RekordboxPlaylistTarget[]): void {
  const index = repoints.findIndex((r) => r.to === to)
  if (index !== -1) repoints[index] = { ...repoints[index], playlists }
}
```

`redirectRekordboxRepoint` already spreads the entry, so the playlists follow it; its "landed back on the source" drop only fires without `meta`, which a conversion always records.

In `src/main/processTrack.ts`, add to `ProcessTrackDeps`:

```ts
  attachRekordboxPlaylists?: (to: string, playlists: RekordboxPlaylistTarget[]) => void
```

(import the type from `../shared/types`), and right after the `try { ... } catch { ... } finally { ... }` around `deps.convertAudio`:

```ts
    if (job.rekordboxPlaylists) deps.attachRekordboxPlaylists?.(target, job.rekordboxPlaylists)
```

- [ ] **Step 4: Operations out of a run**

Create `src/main/rekordboxQueueFromRun.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { FlushResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import { type ContentProbe, readContentFacts } from './rekordboxContentAdd'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import { nodeTimestamp, playlistXmlPath } from './rekordboxMasterXml'
import { resolveTracks, trackPlaylists } from './rekordboxPlaylistEdit'
import type { TrackOp } from './rekordboxQueueOps'

function labelOf(r: RekordboxRepoint): string {
  const artist = r.meta?.artist.trim()
  const title = r.meta?.title.trim()
  return artist && title ? `${artist} - ${title}` : basename(r.to)
}

export async function trackOpsFromRun(
  collectionPath: string,
  repoints: RekordboxRepoint[],
  opts: { repointing: boolean; probe: ContentProbe; find: FindOptions; newId?: () => string },
): Promise<TrackOp[]> {
  const wanted = repoints.filter((r) => r.playlists)
  if (wanted.length === 0 || !collectionPath) return []
  const db = openRekordboxDb(collectionPath, { readonly: true })
  if (!db) return []
  const xmlPath = playlistXmlPath(collectionPath)
  const xml = existsSync(xmlPath) ? readFileSync(xmlPath, 'utf8') : null
  const read: { r: RekordboxRepoint; contentId?: string; known: string[]; stamps: Record<string, number> }[] = []
  try {
    for (const r of wanted) {
      const paths = opts.repointing && r.from !== r.to ? [r.to, r.from] : [r.to]
      const contentId = resolveTracks(db, [{ paths }], { ...opts.find, quiet: true }).contentIds[0]
      const known = contentId ? trackPlaylists(db, contentId) : []
      const stamps: Record<string, number> = {}
      const touched = new Set([...known, ...(r.playlists ?? []).flatMap((t) => (t.id ? [t.id] : []))])
      for (const pid of touched) {
        const stamp = xml === null ? null : nodeTimestamp(xml, pid)
        if (stamp !== null) stamps[pid] = stamp
      }
      read.push({ r, contentId, known, stamps })
    }
  } finally {
    db.close()
  }
  const newId = opts.newId ?? randomUUID
  const ops: TrackOp[] = []
  for (const { r, contentId, known, stamps } of read) {
    const facts = r.meta ? await readContentFacts(r.to, r.meta, opts.probe).catch(() => null) : null
    ops.push({
      id: newId(),
      kind: 'track',
      path: r.to,
      label: labelOf(r),
      ...(contentId ? { contentId } : {}),
      facts,
      wanted: r.playlists ?? [],
      known,
      stamps,
    })
  }
  return ops
}

export interface RunQueueDeps {
  collectionPath: string
  repointing: boolean
  flushRepoints: (repoints: RekordboxRepoint[]) => Promise<FlushResult>
  readOps: (repoints: RekordboxRepoint[]) => Promise<TrackOp[]>
  enqueue: (ops: TrackOp[], repoints: RekordboxRepoint[]) => void
  apply: () => void
}

export async function queueConversionRun(
  repoints: RekordboxRepoint[],
  deps: RunQueueDeps,
): Promise<void> {
  const result = await deps.flushRepoints(repoints)
  const waiting = result.blocked === 'rekordbox-running' ? repoints : []
  const ops = deps.collectionPath ? await deps.readOps(repoints) : []
  if (ops.length === 0 && waiting.length === 0) return
  deps.enqueue(ops, waiting)
  deps.apply()
}
```

`readContentFacts` for a file whose tags or duration cannot be read gives `null`, and the apply then says `not-added` if it had to add it.

- [ ] **Step 5: The flush uses it**

In `src/main/libraryFlushes.ts`, import `queueConversionRun`, `trackOpsFromRun` from `./rekordboxQueueFromRun`, `type RekordboxQueue` from `./rekordboxQueue`, `probeDuration`, `probeProperties` from `./ffmpeg` (alongside `toNmlLocation`), and change `flushConversionBatch` to take the queue and run the rekordbox part through `queueConversionRun`:

```ts
export async function flushConversionBatch(
  host: LibraryHost,
  sessions: { rekordbox: SessionBackup; engine: SessionBackup },
  queue: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void },
): Promise<void> {
  await flushTraktorSync({ ...traktorFlushDeps(host), endNmlBatch })
  const repoints = endRekordboxBatch()
  const rekordbox = rekordboxFlushDeps(host)
  const collectionPath = currentLibraryStatus().rekordbox.found
    ? findRekordboxCollection({ configured: getSettings().rekordboxDbPath })
    : ''
  await queueConversionRun(repoints, {
    collectionPath,
    repointing: rekordbox.collectionPath !== '',
    flushRepoints: async (list) => {
      const result = await flushRekordboxSync({
        ...rekordbox,
        showBlockedDialog: () => {},
        endBatch: () => list,
        repointTracks: (path, items) =>
          repointTracks(
            path,
            items.map((repoint) => ({ ...repoint, realPath: (p: string) => realpathSync(p) })),
            {
              sessionBackup: (db) => sessions.rekordbox.ensure(db),
              readCover: readEmbeddedCover,
            },
          ),
      })
      logLibraryFlush('rekordbox repoint', result)
      return result
    },
    readOps: (list) =>
      trackOpsFromRun(collectionPath, list, {
        repointing: rekordbox.collectionPath !== '',
        probe: { properties: probeProperties, duration: (p) => probeDuration(p) },
        find: { realPath: (p: string) => realpathSync(p) },
      }),
    enqueue: queue.enqueue,
    apply: queue.applyQuietly,
  })
  const engineResult = await flushEngineSync({
    ...engineFlushDeps(host),
    endBatch: () => repoints.filter((repoint) => repoint.from !== repoint.to),
    repointTracks: (libraryDir, list) =>
      repointEngineTracks(
        libraryDir,
        list.map((repoint) => ({ ...repoint, realPath: (p: string) => realpathSync(p) })),
        { sessionBackup: (path) => sessions.engine.ensure(path) },
      ),
  })
  logLibraryFlush('Engine DJ repoint', engineResult)
}
```

The existing comments of this function stay on the lines that stay (the Traktor and Engine ones); the rekordbox block is new code and carries none. Engine DJ still gets the run's repoints, as before.

`index.ts` keeps compiling only once Task 9 passes the third argument; to keep this commit green, pass a stand-in in the one call site (`index.ts`, `process:batch-end`) that Task 9 replaces:

```ts
      flushConversionBatch(
        hostFor(BrowserWindow.fromWebContents(e.sender), e.sender),
        sessions,
        { enqueue: () => {}, applyQuietly: () => {} },
      ),
```

and the same in `src/scenarios/harness.tsx` (`endConversionBatch`), where no scenario has a collection:

```ts
    endConversionBatch: () => {
      flushes.push(
        flushConversionBatch(libraryHost(errors), sessions, {
          enqueue: () => {},
          applyQuietly: () => {},
        }),
      )
    },
```

- [ ] **Step 6: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxBatch.test.ts src/main/processTrack.test.ts src/main/rekordboxQueueFromRun.test.ts src/main/rekordboxFlush.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/rekordboxBatch.ts apps/desktop/src/main/rekordboxBatch.test.ts apps/desktop/src/main/processTrack.ts apps/desktop/src/main/processTrack.test.ts apps/desktop/src/main/rekordboxQueueFromRun.ts apps/desktop/src/main/rekordboxQueueFromRun.test.ts apps/desktop/src/main/libraryFlushes.ts apps/desktop/src/main/index.ts apps/desktop/src/scenarios/harness.tsx
git commit -m "Queue a converted track's rekordbox playlists and the repoints rekordbox kept from running"
```

---

### Task 9: Membership, IPC, preload and wiring

**Files:**
- Create: `src/main/rekordboxMembership.ts`, `src/main/rekordboxQueueIpc.ts`
- Modify: `src/main/rekordboxPlaylistsIpc.ts` (`PlaylistEditHost.queue`, `rekordbox:edit` through the queue)
- Modify: `src/main/index.ts` (the queue, the watcher, broadcasts, the batch-end call)
- Modify: `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`
- Test: `src/main/rekordboxMembership.test.ts`, `src/main/rekordboxQueueIpc.test.ts`, `src/main/rekordboxPlaylistsIpc.test.ts`

**Interfaces:**
- Consumes: Task 3 `trackPlaylists`, `FindOptions.quiet`; Task 4 `applyRekordboxBatch`, `EditOp`; Task 6 `createRekordboxQueue`, `fileStore`, `RekordboxQueue`, `QueueApply`; Task 7 `watchRekordboxQueue`; Task 8 `flushConversionBatch(host, sessions, queue)`; existing `withCollection`, `serialLibraryFlush`, `findTrackByPath`, `isAmbiguous`, `repointTracks`.
- Produces:
  - `readMembership(db: Db, paths: string[], find: FindOptions): Record<string, string[]>` (path to the IDs of the normal playlists its entry is in; a path with no single entry is left out)
  - `appliedNotice(result: QueueApply): RekordboxQueueApplied | null` (null for nothing applied and for rekordbox still open, which the pill already shows)
  - `editResultOf(result: QueueApply, opId: string): RekordboxEditResult`
  - `registerRekordboxQueueIpc(queue: RekordboxQueue, host: QueueIpcHost): void` with `interface QueueIpcHost { collection: () => string; ensureClosed: (win: BrowserWindow | null) => Promise<boolean>; onApplied: (notice: RekordboxQueueApplied) => void }`; channels `rekordbox:queue`, `rekordbox:applyNow`, `rekordbox:discardQueue`, `rekordbox:membership`
  - `PlaylistEditHost.queue: Pick<RekordboxQueue, 'enqueue' | 'apply'>`; `rekordbox:edit (edit, label?)`
  - events to every window: `rekordbox:queueChanged` (`RekordboxQueueState`), `rekordbox:queueApplied` (`RekordboxQueueApplied`)
  - `Api` (preload): `rekordboxQueue(): Promise<RekordboxQueueState>`, `applyRekordboxQueue(): Promise<RekordboxQueueApplied | null>`, `discardRekordboxQueue(): Promise<void>`, `rekordboxMembership(paths: string[]): Promise<Record<string, string[]>>`, `onRekordboxQueueChanged(cb: (s: RekordboxQueueState) => void): () => void`, `onRekordboxQueueApplied(cb: (a: RekordboxQueueApplied) => void): () => void`, `editRekordboxPlaylist(edit: RekordboxPlaylistEdit, label?: string): Promise<RekordboxEditResult>`

A tree edit (Decision 4) is queued with the `Timestamp` its playlist has now and applied at once with today's dialog. Cancel leaves it queued (`{ applied: false, reason: 'cancelled' }`, which Task 15 words as "se aplicará al cerrar rekordbox"); the watcher applies it later. The applied notice is broadcast for the watcher, "Aplicar ahora" and conversions; a tree edit broadcasts it only when its apply also wrote other waiting work (Decision 9).

- [ ] **Step 1: Write the failing tests**

Create `src/main/rekordboxMembership.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { readMembership } from './rekordboxMembership'
import { ORGANISE_FIXTURE, TWIN_PATHS, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

describe('readMembership', () => {
  // The field's starting value and the row dots: where rekordbox has each file today.
  it('lists the playlists of each file the collection holds once', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbmember-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    const read = readMembership(
      db,
      [
        '/Volumes/Public/Music/Play This Song.wav',
        '/Volumes/Public/Music/Gowan.wav',
        '/Users/dj/Music/Music/Ekkah.wav',
        '/nowhere/x.wav',
      ],
      TWIN_PATHS,
    )
    expect(read['/Volumes/Public/Music/Play This Song.wav'].sort()).toEqual(['2000', '3000'])
    expect(read['/Volumes/Public/Music/Gowan.wav']).toEqual([])
    expect('/Users/dj/Music/Music/Ekkah.wav' in read).toBe(false)
    expect('/nowhere/x.wav' in read).toBe(false)
    db.close()
  })
})
```

Create `src/main/rekordboxQueueIpc.test.ts`:

```ts
import { ipcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))

import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice, editResultOf, registerRekordboxQueueIpc } from './rekordboxQueueIpc'

function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([n]) => n === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

const APPLIED: QueueApply = {
  status: 'applied',
  tracks: 3,
  changes: 0,
  notices: [{ code: 'ambiguous', track: 'Ekkah' }],
  outcomes: [{ id: 'e', applied: true, createdId: '77', notices: [] }],
}

function queue(result: QueueApply = APPLIED) {
  return {
    enqueue: vi.fn(),
    state: vi.fn(() => ({ tracks: 1, changes: 0, items: [] })),
    isEmpty: vi.fn(() => false),
    discard: vi.fn(),
    apply: vi.fn<RekordboxQueue['apply']>(async (ensureClosed) => {
      await ensureClosed()
      return result
    }),
  }
}

describe('appliedNotice', () => {
  it('tells what was written and what rekordbox kept', () => {
    expect(appliedNotice(APPLIED)).toEqual({
      tracks: 3,
      changes: 0,
      notices: [{ code: 'ambiguous', track: 'Ekkah' }],
    })
  })

  // rekordbox still open is what the pill already says; a second line would be noise.
  it('says nothing when rekordbox is still open or nothing was queued', () => {
    expect(appliedNotice({ status: 'refused', reason: 'cancelled' })).toBeNull()
    expect(appliedNotice({ status: 'refused', reason: 'rekordbox-running' })).toBeNull()
    expect(appliedNotice({ status: 'empty' })).toBeNull()
  })

  it('names a refusal the user has to know about', () => {
    expect(appliedNotice({ status: 'refused', reason: 'backup-failed' })).toEqual({
      refused: 'backup-failed',
    })
  })
})

describe('editResultOf', () => {
  it('answers a tree edit with its own outcome', () => {
    expect(editResultOf(APPLIED, 'e')).toEqual({ applied: true, createdId: '77' })
  })

  it('answers a refused apply with its reason', () => {
    expect(editResultOf({ status: 'refused', reason: 'cancelled' }, 'e')).toEqual({
      applied: false,
      reason: 'cancelled',
    })
  })
})

describe('registerRekordboxQueueIpc', () => {
  // "Aplicar ahora" closes rekordbox with today's dialog, over the window it came from.
  it('applies now behind the close dialog and answers with the notice', async () => {
    const q = queue()
    const ensureClosed = vi.fn(async () => true)
    const onApplied = vi.fn()
    registerRekordboxQueueIpc(q, { collection: () => '/c/master.db', ensureClosed, onApplied })
    expect(await handler('rekordbox:applyNow')({ sender: {} })).toEqual(appliedNotice(APPLIED))
    expect(ensureClosed).toHaveBeenCalledWith('window')
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('discards and reports the state', async () => {
    const q = queue()
    registerRekordboxQueueIpc(q, {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
      onApplied: vi.fn(),
    })
    await handler('rekordbox:discardQueue')()
    expect(q.discard).toHaveBeenCalled()
    expect(handler('rekordbox:queue')()).toEqual({ tracks: 1, changes: 0, items: [] })
  })

  it('answers no membership without a collection', () => {
    registerRekordboxQueueIpc(queue(), {
      collection: () => '',
      ensureClosed: vi.fn(async () => true),
      onApplied: vi.fn(),
    })
    expect(handler('rekordbox:membership')({}, ['/m/a.wav'])).toEqual({})
  })
})
```

In `src/main/rekordboxPlaylistsIpc.test.ts`, every `registerRekordboxPlaylistsIpc(() => path, { ensureClosed, sessionBackup })` gains `queue: queueFor(path, sessionBackup)`, with this helper above the `describe('registerRekordboxPlaylistsIpc'`:

```ts
import { applyRekordboxBatch } from './rekordboxPlaylistWrite'
import { createRekordboxQueue } from './rekordboxQueue'

function queueFor(path: string, sessionBackup = vi.fn(async () => {})) {
  let text: string | null = null
  return createRekordboxQueue({
    store: {
      read: () => text,
      write: (t) => {
        text = t
      },
      setAside: () => {
        text = null
      },
    },
    collection: () => path,
    applyBatch: (c, ops, ensureClosed) => applyRekordboxBatch(c, ops, { ensureClosed, sessionBackup }),
    repoint: async () => [],
    onChange: () => {},
  })
}
```

and append:

```ts
  // Cancel used to throw the edit away; now it waits for rekordbox to close.
  it('keeps a cancelled edit queued', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true })
    const queue = queueFor(path)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => false),
      sessionBackup: vi.fn(async () => {}),
      queue,
    })
    const result = await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'rename', playlistId: '3000', name: 'House 26' },
      'House',
    )
    expect(result).toEqual({ applied: false, reason: 'cancelled' })
    expect(queue.state().items).toEqual([
      { key: expect.stringMatching(/^edit:/), label: 'House', parts: [{ kind: 'tree', edit: 'rename' }] },
    ])
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxMembership.test.ts src/main/rekordboxQueueIpc.test.ts src/main/rekordboxPlaylistsIpc.test.ts`
Expected: FAIL, missing modules, and the playlists IPC tests failing on the unknown `queue` host field (type) and the cancelled edit leaving no queued item.

- [ ] **Step 3: Membership and the queue channels**

Create `src/main/rekordboxMembership.ts`:

```ts
import { type FindOptions, findTrackByPath, isAmbiguous, type openRekordboxDb } from './rekordboxDb'
import { trackPlaylists } from './rekordboxPlaylistEdit'

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

export function readMembership(
  db: Db,
  paths: string[],
  find: FindOptions,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const path of paths) {
    const match = findTrackByPath(db, path, { ...find, quiet: true })
    if (match === null || isAmbiguous(match)) continue
    out[path] = trackPlaylists(db, match.id)
  }
  return out
}
```

Create `src/main/rekordboxQueueIpc.ts`:

```ts
import { realpathSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import type { RekordboxEditResult, RekordboxQueueApplied } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { readMembership } from './rekordboxMembership'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'

export function appliedNotice(result: QueueApply): RekordboxQueueApplied | null {
  if (result.status === 'empty') return null
  if (result.status === 'refused')
    return result.reason === 'cancelled' || result.reason === 'rekordbox-running'
      ? null
      : { refused: result.reason }
  return { tracks: result.tracks, changes: result.changes, notices: result.notices }
}

export function editResultOf(result: QueueApply, opId: string): RekordboxEditResult {
  if (result.status === 'refused') return { applied: false, reason: result.reason }
  const outcome = result.status === 'applied' ? result.outcomes.find((o) => o.id === opId) : undefined
  if (!outcome) return { applied: false, reason: 'write-failed' }
  if (!outcome.applied) {
    const reason = outcome.reason ?? 'stale'
    return outcome.report ? { applied: false, reason, report: outcome.report } : { applied: false, reason }
  }
  if (outcome.report) return { applied: true, report: outcome.report }
  return outcome.createdId ? { applied: true, createdId: outcome.createdId } : { applied: true }
}

export interface QueueIpcHost {
  collection: () => string
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  onApplied: (notice: RekordboxQueueApplied) => void
}

export function registerRekordboxQueueIpc(queue: RekordboxQueue, host: QueueIpcHost): void {
  ipcMain.handle('rekordbox:queue', () => queue.state())
  ipcMain.handle('rekordbox:applyNow', (e) =>
    serialLibraryFlush(async () =>
      appliedNotice(
        await queue.apply(() => host.ensureClosed(BrowserWindow.fromWebContents(e.sender))),
      ),
    ),
  )
  ipcMain.handle('rekordbox:discardQueue', () => queue.discard())
  ipcMain.handle('rekordbox:membership', (_e, paths: string[]) =>
    withCollection(
      host.collection(),
      (db) => readMembership(db, paths, { realPath: (p: string) => realpathSync(p) }),
      {},
    ),
  )
}
```

The applied notice of "Aplicar ahora" goes back as the call's answer, so `onApplied` is not called for it (the pill shows it once).

- [ ] **Step 4: Tree edits through the queue**

In `src/main/rekordboxPlaylistsIpc.ts`, replace the `editRekordboxPlaylist` import with:

```ts
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { nodeTimestamp, playlistXmlPath } from './rekordboxMasterXml'
import type { RekordboxQueue } from './rekordboxQueue'
import { editResultOf } from './rekordboxQueueIpc'
import type { EditOp } from './rekordboxQueueOps'
```

(merge `readFileSync` into the existing `node:fs` import), add to `PlaylistEditHost`:

```ts
  queue: Pick<RekordboxQueue, 'enqueue' | 'apply'>
```

add above `registerRekordboxPlaylistsIpc`:

```ts
function editStamps(collectionPath: string, edit: RekordboxPlaylistEdit): Record<string, number> {
  if (edit.kind === 'create' || !existsSync(playlistXmlPath(collectionPath))) return {}
  const stamp = nodeTimestamp(readFileSync(playlistXmlPath(collectionPath), 'utf8'), edit.playlistId)
  return stamp === null ? {} : { [edit.playlistId]: stamp }
}
```

and replace the `rekordbox:edit` handler with:

```ts
  ipcMain.handle('rekordbox:edit', (e, edit: RekordboxPlaylistEdit, label?: string) =>
    serialLibraryFlush(async () => {
      const path = collection()
      if (!path) return { applied: false as const, reason: 'unreadable' as const }
      const op: EditOp = {
        id: randomUUID(),
        kind: 'edit',
        edit,
        stamps: editStamps(path, edit),
        ...(label ? { label } : {}),
      }
      host.queue.enqueue([op])
      const result = await host.queue.apply(() =>
        host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
      )
      if (result.status === 'applied' && (result.tracks > 0 || result.changes > 1))
        host.onApplied?.(result)
      return editResultOf(result, op.id)
    }),
  )
```

with `onApplied?: (result: QueueApply) => void` added to `PlaylistEditHost` (import `type QueueApply` from `./rekordboxQueue`). `editRekordboxPlaylist` stays exported from the writer for any other caller; this handler no longer uses it.

- [ ] **Step 5: Wire the queue in `index.ts`**

At module level, after `const sessions = ...`:

```ts
const broadcast = (channel: string, payload: unknown): void => {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
}
const rekordboxCollectionPath = (): string =>
  currentLibraryStatus().rekordbox.found
    ? findRekordboxCollection({ configured: getSettings().rekordboxDbPath })
    : ''
const rekordboxQueue = createRekordboxQueue({
  store: fileStore(join(app.getPath('userData'), 'rekordbox-queue.json')),
  collection: rekordboxCollectionPath,
  applyBatch: (collectionPath, ops, ensureClosed) =>
    applyRekordboxBatch(collectionPath, ops, {
      ensureClosed,
      sessionBackup: (path) => sessions.rekordbox.ensure(path),
      realPath: (p: string) => realpathSync(p),
    }),
  repoint: (collectionPath, list) =>
    repointTracks(
      collectionPath,
      list.map((r) => ({ ...r, realPath: (p: string) => realpathSync(p) })),
      { sessionBackup: (path) => sessions.rekordbox.ensure(path), readCover: readEmbeddedCover },
    ),
  onChange: (state) => {
    broadcast('rekordbox:queueChanged', state)
    rekordboxQueueWatch.poke()
  },
})
const announceApplied = (result: QueueApply): void => {
  const notice = appliedNotice(result)
  if (notice) broadcast('rekordbox:queueApplied', notice)
}
const rekordboxQueueWatch = watchRekordboxQueue({
  queue: {
    isEmpty: () => rekordboxQueue.isEmpty(),
    apply: (ensureClosed) => serialLibraryFlush(() => rekordboxQueue.apply(ensureClosed)),
  },
  isRunning: isRekordboxRunning,
  onApplied: announceApplied,
})
const applyRekordboxQueueQuietly = (): void => {
  void serialLibraryFlush(() =>
    rekordboxQueue.apply(async () => !(await isRekordboxRunning())),
  ).then(announceApplied)
}
```

`rekordboxQueueWatch` is used inside `onChange` only after both exist (the queue calls `onChange` on its first change, never while being created). Imports to add: `createRekordboxQueue`, `fileStore`, `type QueueApply` from `./rekordboxQueue`; `watchRekordboxQueue` from `./rekordboxQueueWatch`; `appliedNotice`, `registerRekordboxQueueIpc` from `./rekordboxQueueIpc`; `applyRekordboxBatch` from `./rekordboxPlaylistWrite`; `repointTracks` from `./rekordboxLibrary`; `readEmbeddedCover` from `./tags`; `currentLibraryStatus` from `./libraryFlushes`; `serialLibraryFlush` from `./libraryTagSync` (whichever of these `index.ts` does not import yet; `realpathSync`, `join`, `getSettings`, `findRekordboxCollection`, `isRekordboxRunning` are already there).

In the `registerRekordboxPlaylistsIpc` call add `queue: rekordboxQueue` and `onApplied: announceApplied`. Right after it:

```ts
  registerRekordboxQueueIpc(rekordboxQueue, {
    collection: rekordboxCollectionPath,
    ensureClosed: (win) => ensureRekordboxClosed(win, 'rekordboxQuitDetailPlaylists'),
    onApplied: (notice) => broadcast('rekordbox:queueApplied', notice),
  })
```

Replace the `process:batch-end` stand-in from Task 8 with:

```ts
      flushConversionBatch(hostFor(BrowserWindow.fromWebContents(e.sender), e.sender), sessions, {
        enqueue: rekordboxQueue.enqueue,
        applyQuietly: applyRekordboxQueueQuietly,
      }),
```

`applyRekordboxQueueQuietly` queues behind the flush that called it (`serialLibraryFlush` chains), so it never deadlocks on it.

In `app.whenReady().then(...)`, right after `createWindow()` (line ~1466): `rekordboxQueueWatch.poke()` (spec: "y al arrancar Surco").

- [ ] **Step 6: Preload, test api, harness**

`src/preload/api.ts` (add the four new types to the import from `../shared/types`), next to `editRekordboxPlaylist`:

```ts
  editRekordboxPlaylist: (edit: RekordboxPlaylistEdit, label?: string) => Promise<RekordboxEditResult>
  rekordboxQueue: () => Promise<RekordboxQueueState>
  applyRekordboxQueue: () => Promise<RekordboxQueueApplied | null>
  discardRekordboxQueue: () => Promise<void>
  rekordboxMembership: (paths: string[]) => Promise<Record<string, string[]>>
  onRekordboxQueueChanged: (cb: (state: RekordboxQueueState) => void) => () => void
  onRekordboxQueueApplied: (cb: (applied: RekordboxQueueApplied) => void) => () => void
```

`src/preload/index.ts`:

```ts
  editRekordboxPlaylist: (edit: RekordboxPlaylistEdit, label?: string): Promise<RekordboxEditResult> =>
    ipcRenderer.invoke('rekordbox:edit', edit, label),
  rekordboxQueue: () => ipcRenderer.invoke('rekordbox:queue'),
  applyRekordboxQueue: () => ipcRenderer.invoke('rekordbox:applyNow'),
  discardRekordboxQueue: () => ipcRenderer.invoke('rekordbox:discardQueue'),
  rekordboxMembership: (paths: string[]) => ipcRenderer.invoke('rekordbox:membership', paths),
  onRekordboxQueueChanged: (cb: (state: RekordboxQueueState) => void) => {
    const listener = (_e: unknown, state: RekordboxQueueState): void => cb(state)
    ipcRenderer.on('rekordbox:queueChanged', listener)
    return () => ipcRenderer.removeListener('rekordbox:queueChanged', listener)
  },
  onRekordboxQueueApplied: (cb: (applied: RekordboxQueueApplied) => void) => {
    const listener = (_e: unknown, applied: RekordboxQueueApplied): void => cb(applied)
    ipcRenderer.on('rekordbox:queueApplied', listener)
    return () => ipcRenderer.removeListener('rekordbox:queueApplied', listener)
  },
```

`src/renderer/src/test/api.ts` and `src/scenarios/harness.tsx`, next to `editRekordboxPlaylist`:

```ts
    rekordboxQueue: async () => ({ tracks: 0, changes: 0, items: [] }),
    applyRekordboxQueue: async () => null,
    discardRekordboxQueue: async () => {},
    rekordboxMembership: async () => ({}),
    onRekordboxQueueChanged: () => () => {},
    onRekordboxQueueApplied: () => () => {},
```

(in `test/api.ts` use its `unsubscribe` helper for the two `on...` entries, as its other listeners do).

- [ ] **Step 7: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxMembership.test.ts src/main/rekordboxQueueIpc.test.ts src/main/rekordboxPlaylistsIpc.test.ts src/main/rekordboxPlaylistWrite.test.ts`
Expected: PASS.

- [ ] **Step 8: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/main/rekordboxMembership.ts apps/desktop/src/main/rekordboxMembership.test.ts apps/desktop/src/main/rekordboxQueueIpc.ts apps/desktop/src/main/rekordboxQueueIpc.test.ts apps/desktop/src/main/rekordboxPlaylistsIpc.ts apps/desktop/src/main/rekordboxPlaylistsIpc.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/scenarios/harness.tsx
git commit -m "Expose the rekordbox queue, membership and queued tree edits to the window"
```

---

### Task 10: The renderer's playlist model and the track's wanted set

**Files:**
- Create: `src/renderer/src/lib/rekordboxPlaylists.ts`
- Modify: `src/renderer/src/types.ts` (`TrackItem.rekordboxPlaylists?`)
- Modify: `src/shared/types.ts` (`SessionEdit.rekordboxPlaylists?`)
- Modify: `src/renderer/src/lib/dirty.ts` (`trackSignature`, its `SignatureFields`)
- Modify: `src/renderer/src/lib/sessionEdits.ts`, `src/renderer/src/hooks/useTrackLibrary.ts` (`restoredPatch`)
- Modify: `src/renderer/src/hooks/useTrackProcessing.ts` (the job)
- Test: `src/renderer/src/lib/rekordboxPlaylists.test.ts`, `src/renderer/src/lib/dirty.test.ts`, `src/renderer/src/lib/sessionEdits.test.ts`, `src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Consumes: Task 5 `RekordboxPlaylistTarget`; Task 8 `ProcessJob.rekordboxPlaylists`; `SourceNode`.
- Produces (all in `lib/rekordboxPlaylists.ts`):
  - `interface PlaylistOption { id: string; name: string; path: string }` (`path`: the folders above it, outermost first, joined with ` › `; '' at the root)
  - `type Membership = Record<string, string[]>` (path to playlist IDs, as `rekordbox:membership` answers)
  - `playlistOptions(tree: readonly SourceNode[]): PlaylistOption[]`
  - `matchingOptions(options: readonly PlaylistOption[], text: string, chosen: readonly RekordboxPlaylistTarget[]): PlaylistOption[]`
  - `canCreate(options: readonly PlaylistOption[], text: string, chosen: readonly RekordboxPlaylistTarget[]): boolean`
  - `rekordboxPathOf(track: Pick<TrackItem, 'inputPath' | 'outputPath'>): string`
  - `effectivePlaylists(track: TrackItem, membership: Membership, options: readonly PlaylistOption[]): RekordboxPlaylistTarget[]`
  - `isPlaylistsPending(track: TrackItem, membership: Membership): boolean`
  - `targetKey(target: RekordboxPlaylistTarget): string`
  - `bulkPlaylistState(tracks: readonly TrackItem[], membership: Membership, options: readonly PlaylistOption[]): { target: RekordboxPlaylistTarget; state: 'all' | 'some' }[]`
  - `withTarget(tracks: readonly TrackItem[], membership: Membership, options: readonly PlaylistOption[], target: RekordboxPlaylistTarget, on: boolean): { id: string; rekordboxPlaylists: RekordboxPlaylistTarget[] }[]`
- `TrackItem.rekordboxPlaylists?: RekordboxPlaylistTarget[]` and `SessionEdit.rekordboxPlaylists?` (absent: never touched, rekordbox's own membership is the value)

The track's value lives with its other staged edits (spec: "Las ediciones viven en el estado de la pista que Surco ya guarda por ruta"): it is in the session file and in the signature, so editing it brings back "Actualizar" on a converted track, which is how it gets written (Decision 3 of the spec). The signature gains the field only when it is set, so every signature stored before this change still compares equal and no converted track turns stale on upgrade.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/lib/rekordboxPlaylists.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { SourceNode } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  bulkPlaylistState,
  canCreate,
  effectivePlaylists,
  isPlaylistsPending,
  matchingOptions,
  playlistOptions,
  withTarget,
} from './rekordboxPlaylists'

function track(over: Partial<TrackItem> & { id: string }): TrackItem {
  return {
    inputPath: `/m/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    listLabel: over.id,
    query: '',
    status: 'idle',
    meta: emptyMetadata(),
    ...over,
  }
}

const TREE: SourceNode[] = [
  {
    id: '1000',
    name: 'BOLOS',
    kind: 'folder',
    count: 2,
    children: [
      { id: '1001', name: 'Bolos de verano', kind: 'playlist', count: 3 },
      {
        id: '1100',
        name: 'FIJAS',
        kind: 'folder',
        count: 1,
        children: [{ id: '1101', name: 'Todas', kind: 'playlist', count: 9 }],
      },
    ],
  },
  { id: '2000', name: 'Todas', kind: 'playlist', count: 40 },
  { id: '3000', name: 'Makina', kind: 'playlist', count: 10 },
]
const OPTIONS = playlistOptions(TREE)

describe('playlistOptions', () => {
  // The collection repeats names ("Todas"); only the folder path tells them apart.
  it('lists playlists only, each with the folders above it', () => {
    expect(OPTIONS).toEqual([
      { id: '1001', name: 'Bolos de verano', path: 'BOLOS' },
      { id: '1101', name: 'Todas', path: 'BOLOS › FIJAS' },
      { id: '2000', name: 'Todas', path: '' },
      { id: '3000', name: 'Makina', path: '' },
    ])
  })
})

describe('matchingOptions', () => {
  it('filters by name ignoring case and accents, without the chosen ones', () => {
    expect(matchingOptions(OPTIONS, 'MAKÍNA', []).map((o) => o.id)).toEqual(['3000'])
    expect(matchingOptions(OPTIONS, 'todas', [{ id: '2000', name: 'Todas' }]).map((o) => o.id)).toEqual([
      '1101',
    ])
  })
})

describe('canCreate', () => {
  // The spec offers "Crear playlist" unless the text is exactly an existing name.
  it('offers a new name only when no playlist is called exactly that', () => {
    expect(canCreate(OPTIONS, 'Makina', [])).toBe(false)
    expect(canCreate(OPTIONS, 'makina', [])).toBe(true)
    expect(canCreate(OPTIONS, '  ', [])).toBe(false)
    expect(canCreate(OPTIONS, 'Cierre', [{ name: 'Cierre' }])).toBe(false)
  })
})

describe('effectivePlaylists', () => {
  // Untouched, the field shows where rekordbox has the track today.
  it('starts from what rekordbox holds for the file', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav' })
    expect(effectivePlaylists(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toEqual([
      { id: '3000', name: 'Makina' },
    ])
  })

  it('follows the converted file, where the entry now points', () => {
    const t = track({ id: 'a', inputPath: '/m/a.mp3', outputPath: '/m/a.wav' })
    expect(effectivePlaylists(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toEqual([
      { id: '3000', name: 'Makina' },
    ])
  })

  it('uses the edit once the user touched the field', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav', rekordboxPlaylists: [{ name: 'Cierre' }] })
    expect(effectivePlaylists(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toEqual([{ name: 'Cierre' }])
  })
})

describe('isPlaylistsPending', () => {
  // Hollow dots: the wish is not yet what rekordbox holds.
  it('is pending until rekordbox holds exactly the wanted set', () => {
    const want = track({ id: 'a', inputPath: '/m/a.wav', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] })
    expect(isPlaylistsPending(want, {})).toBe(true)
    expect(isPlaylistsPending(want, { '/m/a.wav': ['3000'] })).toBe(false)
    expect(isPlaylistsPending(want, { '/m/a.wav': ['3000', '2000'] })).toBe(true)
    expect(isPlaylistsPending(track({ id: 'b' }), {})).toBe(false)
  })
})

describe('bulk', () => {
  const a = track({ id: 'a', inputPath: '/m/a.wav' })
  const b = track({ id: 'b', inputPath: '/m/b.wav' })
  const membership = { '/m/a.wav': ['3000', '2000'], '/m/b.wav': ['3000'] }

  it('says which playlists every track is in and which only some', () => {
    expect(bulkPlaylistState([a, b], membership, OPTIONS)).toEqual([
      { target: { id: '3000', name: 'Makina' }, state: 'all' },
      { target: { id: '2000', name: 'Todas' }, state: 'some' },
    ])
  })

  it('completes a half token for every track, and removes it from all', () => {
    const todas = { id: '2000', name: 'Todas' }
    expect(withTarget([a, b], membership, OPTIONS, todas, true)).toEqual([
      { id: 'a', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }, todas] },
      { id: 'b', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }, todas] },
    ])
    expect(withTarget([a, b], membership, OPTIONS, todas, false)).toEqual([
      { id: 'a', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] },
      { id: 'b', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] },
    ])
  })
})
```

Append to `src/renderer/src/lib/dirty.test.ts` (it builds tracks with its own `converted` helper):

```ts
describe('trackSignature with rekordbox playlists', () => {
  // Every converted track carries a stored signature; one that changed shape on upgrade
  // would flip all of them to "Actualizar" at once.
  it('reads the same as before for a track whose playlists were never touched', () => {
    const t = converted()
    expect(trackSignature(t)).toBe(trackSignature({ ...t, rekordboxPlaylists: undefined }))
    expect(JSON.parse(trackSignature(t))).toHaveLength(6)
  })

  // Editing the field must bring "Actualizar" back: that is when it is written.
  it('changes when the wanted playlists change', () => {
    const t = converted()
    expect(trackSignature({ ...t, rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] })).not.toBe(
      trackSignature(t),
    )
  })
})
```

Append to `src/renderer/src/lib/sessionEdits.test.ts` (its local `track` builder takes overrides):

```ts
// Switching source or playlist, or relaunching, must not lose the wish (spec "El campo").
it('keeps the wanted rekordbox playlists of a staged track', () => {
  const t = track({
    id: 'a',
    inputPath: '/m/a.wav',
    diskSignature: 'x',
    rekordboxPlaylists: [{ name: 'Cierre' }],
  })
  expect(sessionEdits([t])['/m/a.wav'].rekordboxPlaylists).toEqual([{ name: 'Cierre' }])
})
```

Append to `src/renderer/src/hooks/useTrackProcessing.test.tsx`, inside the last `describe` (it has `track`, `setApi`, `withClient`):

```ts
  it('sends the wanted rekordbox playlists with the job', async () => {
    const processTrack = vi
      .fn<Api['processTrack']>()
      .mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false })
    setApi({ processTrack })
    const live = { current: [track({ id: 'a', rekordboxPlaylists: [{ name: 'Cierre' }] })] }
    const { result } = renderHook(
      () => useTrackProcessing({ tracks: live.current, tracksRef: live, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ rekordboxPlaylists: [{ name: 'Cierre' }] }),
    )
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/rekordboxPlaylists.test.ts src/renderer/src/lib/dirty.test.ts src/renderer/src/lib/sessionEdits.test.ts src/renderer/src/hooks/useTrackProcessing.test.tsx`
Expected: FAIL, missing module, the signature unchanged by the field, the session edit without it, the job without it.

- [ ] **Step 3: Types and plumbing**

`src/renderer/src/types.ts`, in `TrackItem` after `replacesPath`:

```ts
  rekordboxPlaylists?: RekordboxPlaylistTarget[]
```

`src/shared/types.ts`, in `SessionEdit`: `rekordboxPlaylists?: RekordboxPlaylistTarget[]`.

`src/renderer/src/lib/dirty.ts`: add `'rekordboxPlaylists'` to the `Pick` in `SignatureFields`, and end the array in `trackSignature` with:

```ts
    track.foreignRemoved ?? [],
    ...(track.rekordboxPlaylists ? [track.rekordboxPlaylists] : []),
  ])
```

`src/renderer/src/lib/sessionEdits.ts`, in `sessionEdit` after `declick`:

```ts
  if (track.rekordboxPlaylists) edit.rekordboxPlaylists = track.rekordboxPlaylists
```

`src/renderer/src/hooks/useTrackLibrary.ts`, in `restoredPatch` after `trim`:

```ts
    if (saved.rekordboxPlaylists) patch.rekordboxPlaylists = saved.rekordboxPlaylists
```

`src/renderer/src/hooks/useTrackProcessing.ts`, in the `window.api.processTrack({...})` job after `replacesLabel`:

```ts
          rekordboxPlaylists: track.rekordboxPlaylists,
```

- [ ] **Step 4: The model**

Create `src/renderer/src/lib/rekordboxPlaylists.ts`:

```ts
import type { RekordboxPlaylistTarget, SourceNode } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface PlaylistOption {
  id: string
  name: string
  path: string
}

export type Membership = Record<string, string[]>

export function playlistOptions(tree: readonly SourceNode[]): PlaylistOption[] {
  const out: PlaylistOption[] = []
  const walk = (nodes: readonly SourceNode[], trail: string[]): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children ?? [], [...trail, node.name])
      else out.push({ id: node.id, name: node.name, path: trail.join(' › ') })
    }
  }
  walk(tree, [])
  return out
}

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()

export function targetKey(target: RekordboxPlaylistTarget): string {
  return target.id ?? `new:${target.name}`
}

export function matchingOptions(
  options: readonly PlaylistOption[],
  text: string,
  chosen: readonly RekordboxPlaylistTarget[],
): PlaylistOption[] {
  const taken = new Set(chosen.flatMap((t) => (t.id ? [t.id] : [])))
  const query = fold(text.trim())
  return options.filter((o) => !taken.has(o.id) && (query === '' || fold(o.name).includes(query)))
}

export function canCreate(
  options: readonly PlaylistOption[],
  text: string,
  chosen: readonly RekordboxPlaylistTarget[],
): boolean {
  const name = text.trim()
  return (
    name !== '' &&
    !options.some((o) => o.name === name) &&
    !chosen.some((t) => !t.id && t.name === name)
  )
}

export function rekordboxPathOf(track: Pick<TrackItem, 'inputPath' | 'outputPath'>): string {
  return track.outputPath || track.inputPath
}

export function effectivePlaylists(
  track: TrackItem,
  membership: Membership,
  options: readonly PlaylistOption[],
): RekordboxPlaylistTarget[] {
  if (track.rekordboxPlaylists) return track.rekordboxPlaylists
  const byId = new Map(options.map((o) => [o.id, o.name]))
  return (membership[rekordboxPathOf(track)] ?? []).flatMap((id) => {
    const name = byId.get(id)
    return name === undefined ? [] : [{ id, name }]
  })
}

export function isPlaylistsPending(track: TrackItem, membership: Membership): boolean {
  const want = track.rekordboxPlaylists
  if (!want) return false
  const held = new Set(membership[rekordboxPathOf(track)] ?? [])
  return want.length !== held.size || want.some((t) => !t.id || !held.has(t.id))
}

export function bulkPlaylistState(
  tracks: readonly TrackItem[],
  membership: Membership,
  options: readonly PlaylistOption[],
): { target: RekordboxPlaylistTarget; state: 'all' | 'some' }[] {
  const seen = new Map<string, { target: RekordboxPlaylistTarget; n: number }>()
  for (const t of tracks) {
    for (const target of effectivePlaylists(t, membership, options)) {
      const entry = seen.get(targetKey(target)) ?? { target, n: 0 }
      entry.n += 1
      seen.set(targetKey(target), entry)
    }
  }
  return [...seen.values()].map(({ target, n }) => ({
    target,
    state: n === tracks.length ? 'all' : 'some',
  }))
}

export function withTarget(
  tracks: readonly TrackItem[],
  membership: Membership,
  options: readonly PlaylistOption[],
  target: RekordboxPlaylistTarget,
  on: boolean,
): { id: string; rekordboxPlaylists: RekordboxPlaylistTarget[] }[] {
  return tracks.map((t) => {
    const rest = effectivePlaylists(t, membership, options).filter(
      (x) => targetKey(x) !== targetKey(target),
    )
    return { id: t.id, rekordboxPlaylists: on ? [...rest, target] : rest }
  })
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/rekordboxPlaylists.test.ts src/renderer/src/lib/dirty.test.ts src/renderer/src/lib/sessionEdits.test.ts src/renderer/src/hooks/useTrackProcessing.test.tsx src/renderer/src/hooks/useTrackLibrary.test.tsx`
Expected: PASS.

- [ ] **Step 6: Lint, types, commit** (from the worktree root)

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/renderer/src/lib/rekordboxPlaylists.ts apps/desktop/src/renderer/src/lib/rekordboxPlaylists.test.ts apps/desktop/src/renderer/src/types.ts apps/desktop/src/shared/types.ts apps/desktop/src/renderer/src/lib/dirty.ts apps/desktop/src/renderer/src/lib/dirty.test.ts apps/desktop/src/renderer/src/lib/sessionEdits.ts apps/desktop/src/renderer/src/lib/sessionEdits.test.ts apps/desktop/src/renderer/src/hooks/useTrackLibrary.ts apps/desktop/src/renderer/src/hooks/useTrackProcessing.ts apps/desktop/src/renderer/src/hooks/useTrackProcessing.test.tsx
git commit -m "Keep a track's wanted rekordbox playlists with its staged edits and send them with the job"
```

---

