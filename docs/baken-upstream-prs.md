Borradores. No se ha enviado nada; los envías tú si quieres.

# Pull requests for baken (drafts)

Six patches on top of baken v4.6.1 (`c97435a`), kept in Surco's tree as
`apps/desktop/vendor/baken/patches/`. Each section below is one pull request: a title, a
body, what the change rests on, and the tests it adds. The first one is a plain bug fix
that crashes rekordbox and stands on its own; the others serve a front-end and are worth
sending only if the author wants them.

## 1. Write each page's last-write mask as rekordbox does

Patch: `0004-last-write-mask.patch`

### Body

rekordbox 7.2.19 crashed two times out of two while syncing a playlist onto a stick
whose `export.pdb` baken had written, with heap corruption inside its DeviceSQL storage
engine while it deleted rows of a page baken wrote. Syncing onto rekordbox's own export
of the same playlist never crashed, and only reading the stick never crashed either.

Every data page of `export.pdb` records its last write as three fields: `unknown5`
(`+0x20`, the number of rows in that write), `num_rows_large` (`+0x22`, its first row)
and the u16 that follows each row group's presence flags (the bit mask of those rows,
group `g` holding rows `16 g..16 g + 15`). baken writes `unknown5 = 1` and
`num_rows_large = rows - 1` for a normal page, which says "the last write was the last
row", but puts the presence flags in the mask, which says "every row". rekordbox sizes
its undo of that write from `unknown5` and walks the mask, so it writes past its buffer
the first time it deletes a row there.

The fix keeps `unknown5` and `num_rows_large` and writes the mask they describe: the last
row's bit in the last row's group and 0 in the other groups. The two fixed tables (colors
and columns) already say "every row" (`unknown5 = rows`, `num_rows_large = 0`), so their
mask stays the presence flags.

### Measurement

The invariant `unknown5 == popcount(mask)` and `num_rows_large == lowest set bit of mask`
(or `0x1fff/0x1fff` with an empty mask) holds on every page rekordbox writes: 15 pages
of its 7.2.19 export, 2 of its `exportExt.pdb`, the 17 template pages rekordcrate ships
and 680 pages of a real library, 0 incoherent. baken 4.6.1's export of the same playlist
had 8 incoherent pages out of 12 (`page 2 typ 0 nro 7 u5=1 unrl=6 txmask=0x7f`). With
the patch, an export of the same collection has 14 coherent pages and 0 incoherent, and
patching baken's stick by hand the same way let rekordbox sync onto it.

### Tests

- `pdb::page::tests::the_last_write_is_the_last_row_as_rekordbox_writes_it`: a page of 7
  playlist entries has unknown5 1, num_rows_large 6, presence 0x7f and mask 0x40, as
  rekordbox's own page.
- `pdb::page::tests::the_last_write_spans_row_groups`: 20 rows put bit 3 in group 1 and
  0 in group 0.
- `pdb::page::tests::fixed_pages_keep_every_row_in_the_last_write`.
- `pdb::writer::tests::every_data_page_has_a_coherent_last_write`: every data page of a
  700-track export keeps the invariant.

## 2. Write rekordbox's default colour for a hot cue without one

Patch: `0001-default-hot-cue-colours.patch`

### Body

A hot cue with no colour in the XML went onto the stick as green (`[0, 0x1a, 0xff,
0x00]`) whatever its letter. rekordbox writes code 0 followed by the RGB of the letter's
default colour, so the pads of a baken stick showed every uncoloured hot cue in green
where rekordbox's own stick shows red, blue, green, purple and so on. The patch adds the
defaults for A to F; G and H keep the previous form because they were not measured.

### Measurement

rekordbox 7.2.19's export of 16/10/2026 to a stick, hot cues A to F left without colour:

| Letter | R | G | B |
|---|---|---|---|
| A | 255 | 0 | 23 |
| B | 0 | 196 | 255 |
| C | 51 | 255 | 0 |
| D | 77 | 0 | 255 |
| E | 0 | 255 | 48 |
| F | 255 | 94 | 0 |

### Tests

`anlz::cues::tests::hot_cue_colours_follow_rekordbox` now checks each letter A to F
without colour, and that G keeps the earlier bytes.

## 3. Take artwork from a folder of pictures named by TrackID

Patch: `0002-artwork-dir.patch`

### Body

rekordbox shows covers that no audio file holds: it keeps them in its own cache, for
every WAV (symphonia does not read a WAV's ID3 chunk) and for files whose tags carry no
picture. A front-end that can read that cache has no way to hand those pictures to
`--artwork`. `--artwork-dir DIR` (with `--artwork`) reads `DIR/<TrackID>.jpg`, `.jpeg`
or `.png` and uses it ahead of the embedded picture; a track without a file there falls
back to the embedded one as before.

### Tests

`a_picture_in_the_artwork_dir_goes_where_the_file_has_none` in `tests/artwork.rs`: the
track without an embedded cover gets the folder's picture and its thumbnails.

## 4. Report each track as JSON lines with --json and cancel between tracks on request

Patch: `0003-json-lines.patch`

### Body

A front-end that drives `expressport` had nothing to read: the human output is a
progress bar that disappears when stdout is not a terminal. `--json` prints one JSON
object per line instead: the plan (tracks with their size and whether the stick already
has them, space needed and free, warnings, skipped tracks, whether the device is a
volume root), then `start`, `written` (with `kept` when the audio was already there) or
`failed` per track, `database` when the databases are being written, and the report or
an error with a kind (`not-enough-space`, `device-write`, `device-not-found`, `other`).

It also lets the front-end stop the run safely. A line `cancel` on stdin (which works on
Windows, where a child process gets no SIGINT), or SIGINT/SIGTERM on Unix, cancels the
token the export loop already checks between tracks. The track being copied finishes
whole, the next one never starts, and `export.pdb` is not written. Killing the process
instead could leave a half-written audio file in place of one the stick's previous
library points at, since the copy writes in place.

`Progress` gains `on_track(TrackEvent)` with a default that ignores it, so existing
implementations are unaffected.

### Tests

In `tests/artwork.rs`:

- `the_export_reports_each_track_and_then_the_database`: the event order of a first run
  and of a second run that keeps every file.
- `a_cancel_stops_before_the_next_track_and_writes_no_database`: a cancel after the first
  track leaves it complete, does not start the second and writes no `export.pdb`.

## 5. Carry the rekordbox collection's identity and stable playlist ids onto the stick

Patch: `0005-master-identity.patch`

### Body

rekordbox treats a stick as its own library only when the stick carries its
collection's identity. Comparing rekordbox 7.2.19's own export of a playlist with
baken's export of the same playlist (16-18/10/2026):

- each `export.pdb` track row has `djmdContent.ID` at `+0x14` (baken: `id + 20`), the
  collection's `djmdProperty.DBID` at `+0x18` (baken: a constant) and the `FileSize`
  rekordbox's database has at `+0x10`;
- OneLibrary's `content.masterDbId` is the DBID, `content.fileSize` that size,
  `property.myTagMasterDBID` the ID of the collection's `SyncService` cloud property row,
  and `myTag` the collection's own My Tags;
- the stick's playlist ids stay the same between exports, because rekordbox maps them in
  `playlists3.sync`.

The XML carries none of this. `--master-ids FILE` takes it as JSON
(`dbId`, `myTagMasterDbId`, `myTags`, `fileSizes` by TrackID) and an optional
`DeviceId="N"` on each XML `NODE` gives the playlist id to keep; nodes without one take
the next free id in document order, and two nodes with the same id, or a new node with
no id left after `u32::MAX`, are an error. Without
either, the stick is exactly what baken wrote before. A file that does not parse ends the
run before anything is planned or written.

### Tests

- `collection::tests::a_node_keeps_its_device_id`
- `build::tests::device_ids_from_the_xml_are_kept`
- `build::tests::track_rows_carry_the_master_identity`
- `pdb::rows::tests::the_track_row_puts_the_master_id_and_db_id_where_rekordbox_does`
- `onelibrary::tests::onelibrary_carries_the_master_identity`
- `crates/baken/tests/master_ids.rs`: `master_ids_is_read_from_a_file` and
  `a_bad_master_ids_file_is_an_error_before_anything_is_written`

## 6. Keep rekordbox's extension tables and the source's date on the stick

Patch: `0006-keep-rekordbox-files.patch`

### Body

baken removes `exportExt.pdb` (issue #208), which was right when the stick held
rekordbox's old library next to baken's new one. With the identity of the previous
patch the stick is rekordbox's own library, and rekordbox expects to find the My Tag
tables it wrote there when it syncs again; the coexistence run that rekordbox accepted
kept the file. `--keep-rekordbox-ext` leaves it, and still removes a stale
`exportLibrary.db-wal`/`-shm`, which SQLite would replay into the new database. The plan
no longer lists the kept file among those the export removes.

The audio rekordbox copies onto a stick keeps its source's modification time, and the
coexistence run reproduced that. The copy now sets it too; a filesystem that refuses is
counted in the report (`dates_not_kept`) and never fails the track. A file already on the
stick is not written, so its date does not change.

### Tests

In `tests/onelibrary.rs`:

- `keep_rekordbox_ext_leaves_export_ext_pdb`: with and without `--onelibrary`, the file
  stays byte for byte and the log files go; without the option every file goes as before.
- `the_plan_does_not_list_a_kept_export_ext_pdb`.
- `copied_audio_carries_the_source_modification_time`: the copy's time matches the
  source's within FAT's two seconds, and a kept track's time stays.
