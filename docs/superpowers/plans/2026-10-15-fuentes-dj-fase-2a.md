# DJ library sources, phase 2a: organise rekordbox playlists (the easy part first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From Surco's rekordbox tree and list, the DJ reorders the tracks of an open playlist by drag and drop, adds tracks to a playlist (drag onto the tree, or the row menu), removes them, creates playlists and folders, and inserts the collection's own separator, every change written straight into `master.db` (and `masterPlaylists6.xml` for creations) with the safety the repoint already has.

**Architecture:** One main-process writer (`rekordboxPlaylistWrite.ts`) takes one edit per user gesture: it plans on a read-only handle (so an edit with nothing to write never asks anything), asks to close rekordbox with today's dialog, checkpoints the WAL, takes the session and per-write backups, checks rekordbox again, runs the edit in one transaction (`rekordboxPlaylistEdit.ts`) and, for a creation, appends the XML node (`rekordboxMasterXml.ts`); any failure restores both files. The renderer sends the edit through `rekordbox:edit`, re-reads the tree and the open playlist afterwards (only a reorder is drawn ahead of the answer), and the list gains a grip and an insertion line when it shows the playlist in its own order.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, lucide-react, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), biome.

**Spec:** `docs/superpowers/specs/2026-10-15-fuentes-dj-playlists-design.md` (section "Fase 2: organizar"), plus the phase 1 plan `docs/superpowers/plans/2026-10-15-fuentes-dj-fase-1.md` it builds on.

**XML risk, contained:** creating a playlist or folder is the only operation that touches `masterPlaylists6.xml`. If Vicent's check in real rekordbox (Task 11, Q1/Q2) shows rekordbox mishandling the created node, creation is disabled (the two tree buttons and the folder menu hidden) and everything else in 2a stays.

**Out of scope (phase 2b or later):** the persistent pending queue with "Aplicar ahora" and pending dots; conflict detection by `updated_at`; deleting playlists and folders; generating a separator MP3 when the collection has none; renaming; Apple Music writes (Music stays read-only); rating (dropped from phase 2 entirely, Surco never writes it to rekordbox).

## Global Constraints

- Never open, copy onto or point the app at `~/Library/Pioneer/rekordbox/master.db` or `masterPlaylists6.xml` for writing. Tests write only the encrypted fixture (`rekordboxPlaylistsFixture.ts`); verification uses a copy in the session scratchpad.
- Every write goes through `editRekordboxPlaylist`: plan read-only, `ensureClosed` (one dialog per edit at most), WAL checkpoint, session backup (`.surco-session`) and per-write backup (`.surco-backup`) of `master.db` and, when the edit touches it, `masterPlaylists6.xml`; `isRekordboxRunning()` again right before the write; one transaction; restore both backups on any failure after the first statement. No backup, no write.
- Never delete or update a `djmdContent` row. Removing deletes `djmdSongPlaylist` rows only.
- New rows as rekordbox makes them: `djmdSongPlaylist.ID` and `UUID` are `randomUUID()` (measured: all 9432 link IDs are 36-char UUIDs); `djmdPlaylist.ID` is a decimal string from a random 28-bit integer ≥ 100 (pyrekordbox's rule), unused in the table AND in the XML; timestamps `rekordboxStamp(now)` (`2026-10-15 18:00:00.000 +00:00`); `rb_local_usn` from `takeLocalUsn` (agentRegistry `localUpdateCount` + 1); `rb_local_synced` 0, `rb_local_deleted` 0, `usn` NULL.
- After every write the touched playlist's live links have `TrackNo` 1..N; rows whose `TrackNo` changed share ONE new `rb_local_usn` and get `updated_at = now` (measured: rekordbox stamped Factory's reordered rows with one usn). A new playlist or folder takes `Seq = max(Seq of live siblings) + 1`.
- XML node: `    <NODE Id="{ID in uppercase hex}" ParentId="{parent hex, "0" for root}" Attribute="{0|1}" Timestamp="{now in ms}" Lib_Type="0" CheckType="0"/>` appended as the last child of `<PLAYLISTS>`, keeping the file's own line ending (CRLF in rekordbox 7). Only creation touches the XML.
- Separator = `IS_SEPARATOR` from `rekordboxPlaylists.ts` (`Length <= 2` and blank title), never a path. "Insert separator" reuses the separator content linked most often in the collection.
- An added track must already be in `djmdContent`: by the `contentId` of a row read from an open rekordbox playlist when there is one, otherwise by `findTrackByPath` over its paths with `realPath: realpathSync` (the symlinked `~/Music/Music` rule). Not found or ambiguous: not added, counted in the report.
- Playlist edits are explicit user actions and are NOT gated by the `syncRekordbox` toggle (that toggle governs the automatic repoint after a conversion).
- rekordbox only. The Music tree gets no editing controls.
- UI text in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`); no em dash and no explanatory colons in any UI text.
- Test selectors: `data-testid` always.
- Comments: the repo documents the WHY in comments on nearly every block (see `rekordboxLibrary.ts`, `rekordboxPlaylists.ts`). Follow that repo convention, which conflicts with the global "zero comments" rule: conformance with the existing code wins (ruled by the coordinator on 15/10, it stays), flagged here so nobody "fixes" it.
- Tests from `apps/desktop` of the worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (the worktree has no `node_modules` of its own; never filter from the repo root, it skips the setup). Types from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit` and `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` (bare `tsc` checks nothing). Lint and format: `npm exec --workspace apps/desktop -- biome check --write src`.
- Locale strings are merged with this helper (run from `apps/desktop`; `$SCRATCH` is the session scratchpad). Write it once:

```bash
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

(Measured: the five locale files round-trip byte for byte through `JSON.stringify(data, null, 2) + '\n'`.)

- Commits: descriptive English title, no body, no `feat:`. One per task unless the task says otherwise.

## Decisions taken where the spec or the request left room

1. **Rows copied from an open rekordbox playlist are added by their `ContentID`.** The user's 35 symlinked twins (67 of them in playlists) would otherwise always be refused when copied from one playlist to another, although the row the user dragged names its exact entry. Paths (and the ambiguity refusal) apply to everything else: rows of the working list, files dropped from Finder.
2. **Adding a track already in the target playlist skips it** and says so ("ya estaba"), instead of creating a hidden duplicate (the list shows each file once).
3. **Removing a track row removes every occurrence of that track in the playlist**: the list shows one row for it, and leaving a hidden duplicate would bring the row straight back on the re-read. Separators are removed one link at a time.
4. **Each separator is drawn as its own line, adjacent and trailing ones included.** Phase 1 collapsed runs and dropped a trailing separator; once separators can be moved and removed, a hidden one could not be reached. The phase 1 test that pinned the collapse is rewritten in Task 9.
5. **Reordering needs the playlist order AND no search or filter** (not only the sort): with rows hidden, a drop between two visible rows would land among rows the user cannot see. Handles hide and one hint line says why.
6. **Only a reorder is drawn before rekordbox answers** (the dragged row must not snap back while the write runs). Everything else waits for the re-read, which is the collection's truth. A refused reorder snaps back on that re-read.
7. **A separator line gets a ✕ to remove it** (not in the sketch, whose menu is per row): without it a separator inserted by mistake could not be undone from Surco.
8. **The WAL is checkpointed before the backup.** The collection is in WAL mode (measured `journal_mode = wal`, a 329 KB `master.db-wal` while rekordbox runs). Copying only `master.db` with committed frames still in the WAL gives a backup that is missing them, and restoring such a copy loses data. The existing repoint has the same exposure; it is flagged, not changed here.
9. **The "rekordbox está abierto" dialog gets its own detail text for playlists**: today's text talks about pointing the collection at a converted file and waiting for the conversion.
10. **Dropping list rows on the tree does not rest on the OS drag bringing files back.** The list records the dragged rows when the drag starts (`lib/reorderDrag`), the tree's drop reads that record (rows keep their rekordbox entry), and only a Finder drop goes by `getPathForFile`.
11. **Links are hard-deleted**, as pyrekordbox does (measured: 0 soft-deleted links among 9432, so rekordbox with cloud sync off deletes them too). Task 11 confirms it in real rekordbox.

## Review Focus

1. **A dropped or menu-added track that is not in the collection, or that is one of the symlinked twins**: nothing is added for it, the notice says how many and why, and when nothing at all can be added rekordbox is not even asked to close. Pinned in Task 3 (`resolveTracks`), Task 5 (`nothing-to-add` without a dialog or backup) and Task 7 (the notice).
2. **A drop onto a folder (or onto the tree outside a playlist)**: nothing is written, and the drop does not fall through to the window's file import (which would add the files to the working list and announce them as already there). Pinned in Task 8.
3. **Reordering while the list is sorted another way, searched or filtered**: no grips, one hint line, no edit sent. Pinned in Task 10.
4. **Two separators adjacent** (inserting above a row that already has one, or dragging a separator next to another): both stay, both are drawn, each can be moved and removed on its own. Pinned in Task 3 (writer) and Task 9 (view and list).
5. **The collection changing under an edit**: rekordbox opened between the dialog and the write (`rekordbox-running`, nothing written), a row deleted in rekordbox before the edit lands (`stale`, nothing written, view re-read), or the playlist re-read in the middle of a drag (the drop still names the dragged row). Pinned in Task 5 and Task 9.

---

## File structure

| File | Responsibility |
|---|---|
| `docs/rekordbox-playlists-escritura.md` (new, Task 1) | measured facts the writer rests on, and the open questions |
| `src/main/rekordboxRows.ts` (new) | timestamp, usn and free-ID helpers shared by every rekordbox row writer |
| `src/main/rekordboxMetadata.ts` (mod) | uses `rekordboxRows` (behaviour unchanged) |
| `src/main/rekordboxPlaylistsFixture.ts` (mod) | the fixture gains the write columns, `agentRegistry`, `FileNameL`, WAL and the XML; `ORGANISE_FIXTURE` |
| `src/main/rekordboxPlaylists.ts` (mod) | entries carry `linkId` and `contentId`; exports `IS_SEPARATOR`, `STREAMING_FILE_TYPE` |
| `src/main/rekordboxPlaylistEdit.ts` (new) | the edits on an open handle: resolve, add, remove, move, separator, create, validation |
| `src/main/rekordboxMasterXml.ts` (new) | `masterPlaylists6.xml` path, hex IDs, node append, node ID set |
| `src/main/rekordboxPlaylistWrite.ts` (new) | the guarded, backed-up, transactional write of one edit |
| `src/main/rekordboxPlaylistsIpc.ts` (mod) | `rekordbox:edit`, `rekordbox:hasSeparator` |
| `src/main/index.ts`, `src/main/i18n.ts` (mod) | wiring, playlist detail text for the quit dialog |
| `src/shared/types.ts` (mod) | `RekordboxPlaylistEdit`, `PlaylistTrackRef`, `RekordboxEditResult`, link ids on entries |
| `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (mod) | the two new calls and their stubs |
| `src/renderer/src/lib/playlistEdits.ts` (new) | optimistic reorder of entries, the notice text for a result |
| `src/renderer/src/hooks/useRekordboxEdits.ts` (new) | send an edit, re-read, notify |
| `src/renderer/src/hooks/useSourceBrowser.ts` (mod) | `canInsertSeparator` |
| `src/renderer/src/lib/reorderDrag.ts` (new) | the rows a drag out of the list carries (read by the tree's drop), and the reorder drag's data type |
| `src/renderer/src/test/drag.ts` (new) | the one DragEvent polyfill and fake DataTransfer for drag tests |
| `src/renderer/src/lib/playlistView.ts` (mod) | separators per link, trailing ones, row link and content ids |
| `src/renderer/src/components/SourceTree.tsx` (mod) | create buttons, inline name, folder menu, drop target |
| `src/renderer/src/components/TrackList.tsx` (mod) | grip, insertion line, draggable separators |
| `src/renderer/src/components/TrackContextMenu.tsx` (mod) | add to playlist, insert separator, remove from playlist |
| `src/renderer/src/App.tsx` (mod) | wiring, reorder gating and hint, hold release on a new order |
| `src/renderer/src/i18n/locales/*.json` (mod) | `sources.edit`, `sources.tree`, `sources.reorder`, `sources.menu` |

All paths below are relative to `apps/desktop/` unless they start with `docs/`.

---

### Task 1: Measure the format on a copy and write the findings note

**Files:**
- Create: `docs/rekordbox-playlists-escritura.md`
- Scratch only (not committed): `$SCRATCH/rb-spike/`

**Interfaces:**
- Consumes: nothing.
- Produces: the measured facts later tasks cite (link ID format, usn sharing, XML layout, root `ParentId="0"`, `Seq` per parent, WAL mode) and the open questions Task 11 hands to Vicent.

- [ ] **Step 1: Copy the collection, read-only use**

```bash
mkdir -p "$SCRATCH/rb-spike"
cp ~/Library/Pioneer/rekordbox/master.db "$SCRATCH/rb-spike/master.db"
[ -f ~/Library/Pioneer/rekordbox/master.db-wal ] && cp ~/Library/Pioneer/rekordbox/master.db-wal "$SCRATCH/rb-spike/master.db-wal"
cp ~/Library/Pioneer/rekordbox/masterPlaylists6.xml "$SCRATCH/rb-spike/masterPlaylists6.xml"
pgrep -x rekordbox && echo "rekordbox OPEN while copying" || echo "rekordbox closed while copying"
ls -la ~/Library/Pioneer/rekordbox/master.db-wal 2>/dev/null || echo "no WAL file"
```

Copy the `-wal` with the database: the collection is in WAL mode, and the main file alone misses recent changes. Note the two last lines' output for the findings note (Q3).

- [ ] **Step 2: Write the measurement script**

```bash
cat > "$SCRATCH/rb-spike/measure.cjs" <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const Database = require('/Users/vicent/code/surco/node_modules/better-sqlite3-multiple-ciphers')
const dir = process.argv[2]
const db = new Database(path.join(dir, 'master.db'), { readonly: true, fileMustExist: true })
db.pragma(`cipher='sqlcipher'`)
db.pragma('legacy=4')
db.pragma(`key='402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497'`)
const one = (sql, ...p) => db.prepare(sql).get(...p)
const all = (sql, ...p) => db.prepare(sql).all(...p)
const out = {}
out.journalMode = one('PRAGMA journal_mode').journal_mode
out.linkIdLengths = all('SELECT length(ID) AS len, count(*) AS n FROM djmdSongPlaylist GROUP BY len')
out.softDeletedLinks = one('SELECT count(*) AS n FROM djmdSongPlaylist WHERE rb_local_deleted = 1').n
out.playlistRows = one('SELECT count(*) AS n, sum(rb_local_deleted) AS deleted FROM djmdPlaylist')
out.seqPerParent = all(`SELECT ParentID, count(*) AS n, min(Seq) AS lo, max(Seq) AS hi, count(DISTINCT Seq) AS distinctSeq
  FROM djmdPlaylist WHERE coalesce(rb_local_deleted, 0) = 0 GROUP BY ParentID`)
out.playlistsWithTrackNoGaps = one(`SELECT count(*) AS n FROM (SELECT PlaylistID, count(*) AS c, max(TrackNo) AS m,
  count(DISTINCT TrackNo) AS d FROM djmdSongPlaylist WHERE coalesce(rb_local_deleted, 0) = 0
  GROUP BY PlaylistID HAVING c <> m OR c <> d)`).n
out.playlistsWhereLinksShareOneUsn = one(`SELECT count(DISTINCT PlaylistID) AS n FROM (SELECT PlaylistID,
  rb_local_usn, count(*) AS c FROM djmdSongPlaylist GROUP BY PlaylistID, rb_local_usn HAVING c > 1)`).n
out.playlistsOlderThanTheirLinks = one(`SELECT count(*) AS n FROM djmdPlaylist p WHERE p.updated_at <
  (SELECT max(s.updated_at) FROM djmdSongPlaylist s WHERE s.PlaylistID = p.ID)`).n
out.localUpdateCount = one(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`).int_1
// What a playlist edit must never change: the collection entries and their cues.
out.contentRows = one('SELECT count(*) AS n FROM djmdContent').n
out.cueRows = one('SELECT count(*) AS n FROM djmdCue').n
out.linkRows = one('SELECT count(*) AS n FROM djmdSongPlaylist').n
const xml = fs.readFileSync(path.join(dir, 'masterPlaylists6.xml'), 'utf8')
const nodes = [...xml.matchAll(/<NODE ([^>]*)\/>/g)].map((m) =>
  Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))
const hex = (id) => (id === 'root' ? '0' : BigInt(id).toString(16).toUpperCase())
const rows = all('SELECT ID, ParentID, Attribute, rb_local_deleted AS d, created_at FROM djmdPlaylist')
const byHex = new Map(nodes.map((n) => [n.Id, n]))
out.xml = {
  crlf: xml.includes('\r\n'),
  nodes: nodes.length,
  libType: nodes.reduce((acc, n) => ({ ...acc, [n.Lib_Type]: (acc[n.Lib_Type] ?? 0) + 1 }), {}),
  rootParentIds: [...new Set(nodes.filter((n) => n.Lib_Type === '0' && !rows.some((r) => hex(r.ID) === n.ParentId)).map((n) => n.ParentId))],
  liveRowsWithoutNode: rows.filter((r) => !r.d && !byHex.has(hex(r.ID))).map((r) => r.ID),
  deletedRowsWithNode: rows.filter((r) => r.d && byHex.has(hex(r.ID))).map((r) => r.ID),
  libType0NodesWithoutRow: nodes.filter((n) => n.Lib_Type === '0' && !rows.some((r) => hex(r.ID) === n.Id)).map((n) => n.Id),
  parentMismatches: rows.filter((r) => byHex.has(hex(r.ID)) && byHex.get(hex(r.ID)).ParentId !== hex(r.ParentID)).length,
  lastNode: nodes[nodes.length - 1],
  newestRow: rows.filter((r) => !r.d).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0],
  newestRowHex: null,
}
out.xml.newestRowHex = hex(out.xml.newestRow.ID)
console.log(JSON.stringify(out, null, 2))
EOF
```

- [ ] **Step 3: Run it**

Run: `node "$SCRATCH/rb-spike/measure.cjs" "$SCRATCH/rb-spike"`
Expected (values measured on 15/10 from a copy; yours may differ in counts, never in shape): `journalMode` `"wal"`; every link ID 36 characters; `softDeletedLinks` 0; `playlistsWithTrackNoGaps` 0; every parent's live `Seq` runs 1..n with no repeats (the live −128 rows, such as "Acapellas", are numbered with the rest); `playlistsWhereLinksShareOneUsn` > 0; `playlistsOlderThanTheirLinks` > 0 (adding or reordering links does not touch `djmdPlaylist.updated_at`); `xml.crlf` true; `xml.rootParentIds` `["0"]`; `xml.parentMismatches` 0; `xml.lastNode.Id` equal to `xml.newestRowHex` (new nodes are appended at the end, whatever their parent). If `liveRowsWithoutNode` is not empty, or the newest row is not the last node, stop and report: Tasks 4 and 5 assume both.

- [ ] **Step 4: Read pyrekordbox's writer for the same operations**

```bash
mkdir -p "$SCRATCH/rb-spike/pyrb"
curl -sfL -o "$SCRATCH/rb-spike/pyrb/database.py" https://raw.githubusercontent.com/dylanljones/pyrekordbox/master/pyrekordbox/masterdb/database.py
curl -sfL -o "$SCRATCH/rb-spike/pyrb/aux_files.py" https://raw.githubusercontent.com/dylanljones/pyrekordbox/master/pyrekordbox/masterdb/aux_files.py
grep -n "def _create_playlist\|def add_to_playlist\|def remove_from_playlist\|def move_song_in_playlist\|is_28_bit\|playlist_xml.add\|uuid4()" "$SCRATCH/rb-spike/pyrb/database.py"
grep -n "def add\|ParentId\|Timestamp" "$SCRATCH/rb-spike/pyrb/aux_files.py"
```

Expected: `_create_playlist` uses `generate_unused_id(table, is_28_bit=True)`, `seq = n + 1` at the end of the parent, and `playlist_xml.add(id_, parent_id, attrib, now, lib_type=0, check_type=0)`; `add_to_playlist` uses `uuid4()` for both `ID` and `UUID`; `remove_from_playlist` deletes the row and renumbers; `MasterPlaylistXml.add` writes `Id` as `f"{int(playlist_id):X}"`, `ParentId` `"0"` for root, `Timestamp` in ms. Nothing in pyrekordbox touches the XML for add, remove or move.

- [ ] **Step 5: Write the note**

Create `docs/rekordbox-playlists-escritura.md` (Spanish, like the other notes in `docs/`). Replace any number below that Step 3 measured differently, and the two `ls`/`pgrep` facts with Step 1's output:

```markdown
# Escribir playlists en rekordbox: lo medido

Medido el 15/10 sobre una copia de la colección de Vicent (rekordbox 7.2.19, `master.db` + `-wal` + `masterPlaylists6.xml`, solo lectura) y sobre el código de pyrekordbox (`masterdb/database.py`, `masterdb/aux_files.py`). Es la base de la fase 2a (`docs/superpowers/plans/2026-10-15-fuentes-dj-fase-2a.md`).

## master.db

- Modo WAL (`journal_mode = wal`). Con rekordbox abierto el `-wal` pesa cientos de KB: copiar solo `master.db` deja fuera cambios ya confirmados. Antes de copiar, Surco hace `wal_checkpoint(TRUNCATE)`.
- `djmdSongPlaylist.ID` es un UUID de 36 caracteres en los 9432 enlaces (no un número). `UUID` es otro UUID.
- 0 enlaces con `rb_local_deleted = 1`: rekordbox, con la nube apagada, borra los enlaces de verdad. Surco también.
- `TrackNo` es 1..N contiguo en todas las playlists.
- Al reordenar, rekordbox da a todas las filas movidas el mismo `rb_local_usn` y el mismo `updated_at` (Factory: 104 filas con usn 565542). pyrekordbox hace lo mismo ("move" = un usn para la lista).
- Añadir, quitar o reordenar pistas NO toca `djmdPlaylist.updated_at` (Factory: playlist del 07/09, enlaces del 02/10). Por eso esas operaciones no necesitan el XML.
- `djmdPlaylist.ID` es decimal; la raíz es `ParentID = 'root'`. `Seq` va 1..n sin repetir entre las filas vivas de cada padre, contando las −128 vivas ("Acapellas" es la 11 de la raíz); la −128 borrada (100000) conserva un `Seq` 2 repetido. Una playlist nueva va con `max(Seq) + 1` de sus hermanos vivos.
- `agentRegistry.localUpdateCount.int_1` = 566718: cada fila nueva toma el siguiente.

## masterPlaylists6.xml

- 123 `NODE`, CRLF, 4 espacios de sangría, `Lib_Type="0"` para playlists y carpetas propias, `Lib_Type="1"` para los 26 nodos del árbol de iTunes (`Attribute` 1 y 4, `Timestamp` 0, Id de 64 bits).
- `Id` = ID en hexadecimal en mayúsculas sin ceros delante (`30D40` = 200000). Raíz: `ParentId="0"`.
- Los nodos nuevos se añaden AL FINAL de `<PLAYLISTS>`, sea cual sea su carpeta (el último nodo es la playlist más reciente).
- La fila −128 borrada (100000) no tiene nodo: borrar quita el nodo.
- `Timestamp` no coincide con `updated_at` (diferencias de 100 ms a días). pyrekordbox lo iguala al confirmar solo si difiere más de 1 s.
- 2 nodos `Lib_Type="0"` sin fila en la copia (9695456E, 5CB3A8B). O la copia era anterior a ellos, o rekordbox tolera nodos sobrantes (pregunta Q2).

## pyrekordbox (cómo lo hace quien ya escribe)

- Crear: ID aleatorio de 28 bits ≥ 100 no usado, `Seq` al final, nodo XML añadido con `Timestamp` = ahora en ms, `Lib_Type` 0, `CheckType` 0.
- Añadir a playlist: `ID` y `UUID` con `uuid4()`, `TrackNo` al final.
- Quitar: borra la fila y renumera.
- Ninguna de las tres de pistas toca el XML.

## Preguntas abiertas (solo se contestan con rekordbox de verdad, lista de la tarea 11)

- Q1. ¿rekordbox enseña una playlist o carpeta creada así, en su carpeta y al final, y sigue ahí tras reiniciar?
- Q2. Si la base y el XML no cuadran (falta un nodo, sobra uno), ¿qué hace rekordbox al abrir?
- Q3. Con rekordbox cerrado, ¿queda `master.db-wal` con datos? (medido al copiar: VALOR DEL PASO 1)
- Q4. ¿Acepta rekordbox los enlaces borrados de verdad (sin `rb_local_deleted`)? La medida dice que sí.
- Q5. Durante el arrastre nativo de una fila (webContents.startDrag), ¿recibe la propia ventana de Surco los eventos de arrastre sobre el árbol? El árbol ya no depende de que lleguen ficheros (lee las filas que la lista apuntó al empezar), pero sí de que lleguen esos eventos.
- Q6. ¿Los 2 nodos sobrantes son restos que rekordbox tolera? Se repite la medida con una copia tomada con rekordbox cerrado.
```

- [ ] **Step 6: Commit**

```bash
git add docs/rekordbox-playlists-escritura.md
git commit -m "Record how rekordbox stores playlists before writing them"
```

---

### Task 2: Shared row helpers, a writable fixture, and link ids on playlist rows

**Files:**
- Create: `src/main/rekordboxRows.ts`
- Test: `src/main/rekordboxRows.test.ts`
- Modify: `src/main/rekordboxMetadata.ts` (helpers at lines 45-47, 61-63 and the `nextUsn`/`unusedId` closures at 74-92)
- Modify: `src/main/rekordboxPlaylistsFixture.ts` (rewrite)
- Create: `src/main/rekordboxMasterXml.ts` (only `hexId` here; Task 4 adds the rest)
- Test: `src/main/rekordboxMasterXml.test.ts`
- Modify: `src/main/rekordboxDb.ts` (export `STREAMING_FILE_TYPE`, line 61)
- Modify: `src/main/rekordboxPlaylists.ts` (drop its own streaming constant, export `IS_SEPARATOR`, `EntryRow`, `readRekordboxPlaylist`)
- Modify: `src/shared/types.ts` (`SourcePlaylistEntry`, ~line 1021)
- Test: `src/main/rekordboxPlaylists.test.ts`

**Interfaces:**
- Consumes: `REKORDBOX_KEY` from `rekordboxDb.ts`.
- Produces:
  - `rekordboxStamp(now: Date): string`
  - `takeLocalUsn(db: Db, stamp: string): number`
  - `unusedRowId(db: Db, table: string, next: () => string): string`
  - `SourcePlaylistEntry.linkId?: string`, `SourcePlaylistEntry.contentId?: string`
  - `export const IS_SEPARATOR` in `rekordboxPlaylists.ts`; `export const STREAMING_FILE_TYPE` in `rekordboxDb.ts` (the one constant both modules use; `rekordboxPlaylists.ts` imports it instead of keeping a copy)
  - `hexId(id: string): string` in `rekordboxMasterXml.ts` (`'root'` → `'0'`, else uppercase hex), used by the fixture and by Task 4
  - `FixtureContent.FileSize?: number` (default 0; `findTrackByPath` reads the column)
  - `writeRekordboxPlaylistFixture(path, data)` with `FixtureLink.ID?`, `PlaylistFixture.usn?`, `.xml?`, `.wal?`
  - `ORGANISE_FIXTURE: PlaylistFixture` (numeric playlist IDs, links `f1..f7`, `h1..h2`, twins `201`/`202`, separators `109`/`110`, `usn` 500)

- [ ] **Step 1: Failing test for the row helpers**

Create `src/main/rekordboxRows.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

async function open() {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbrows-')), 'master.db')
  writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
  const db = openRekordboxDb(path)
  if (!db) throw new Error('fixture did not open')
  return db
}

describe('rekordbox row helpers', () => {
  // rekordbox writes its timestamps as UTC with milliseconds and an explicit offset; a row in
  // another shape sorts wrongly against every row rekordbox wrote itself.
  it('stamps rows the way rekordbox does', () => {
    expect(rekordboxStamp(new Date('2026-10-15T18:00:00.000Z'))).toBe(
      '2026-10-15 18:00:00.000 +00:00',
    )
  })

  // Every change rekordbox makes takes the next number of one counter; a row written with a
  // number at or below it would read as older than changes already made.
  it('takes the next change number and moves the counter on', async () => {
    const db = await open()
    expect(takeLocalUsn(db, '2026-10-15 18:00:00.000 +00:00')).toBe(501)
    expect(takeLocalUsn(db, '2026-10-15 18:00:00.000 +00:00')).toBe(502)
    db.close()
  })

  it('never hands out an ID the table already uses', async () => {
    const db = await open()
    const ids = ['2000', '2000', '777']
    expect(unusedRowId(db, 'djmdPlaylist', () => ids.shift() ?? '0')).toBe('777')
    db.close()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxRows.test.ts`
Expected: FAIL, `Cannot find module './rekordboxRows'` (and `ORGANISE_FIXTURE` is not exported yet).

- [ ] **Step 3: Rewrite the fixture**

Replace `src/main/rekordboxPlaylistsFixture.ts` with:

```ts
import { writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { REKORDBOX_KEY } from './rekordboxDb'
import { hexId } from './rekordboxMasterXml'

// A miniature master.db with the tables and columns the playlist reader and writer touch,
// encrypted like the real one. The column names come from a live rekordbox 7 collection;
// the shapes worth reproducing are the ones measured there: nested folders whose children
// repeat names, one blank separator file linked many times, a streaming row, soft-deleted
// rows, the −128 cloud-sync trial playlist, link IDs that are UUID-like strings, and the
// change counter every write moves on.
export interface FixtureContent {
  ID: string
  FolderPath: string
  FileType: number
  Title: string
  Length: number
  BPM?: number
  Rating?: number
  KeyID?: string
  // findTrackByPath reads it; 0 unless a test cares.
  FileSize?: number
  deleted?: boolean
}

export interface FixturePlaylist {
  ID: string
  Name: string
  Attribute: number
  ParentID: string
  Seq: number
  deleted?: boolean
}

export interface FixtureLink {
  // Defaults to link-<index>.
  ID?: string
  PlaylistID: string
  ContentID: string
  TrackNo: number
  // null writes a NULL flag, which rekordbox leaves on some rows instead of 0.
  deleted?: boolean | null
}

export interface PlaylistFixture {
  content: FixtureContent[]
  keys: { ID: string; ScaleName: string }[]
  playlists: FixturePlaylist[]
  links: FixtureLink[]
  // Where rekordbox's change counter (agentRegistry localUpdateCount) stands.
  usn?: number
  // Writes masterPlaylists6.xml beside the database, one NODE per live playlist, laid out as
  // rekordbox 7 writes it (CRLF, four-space nodes, ParentId "0" for the root). Playlist IDs
  // must be numeric for this.
  xml?: boolean
  // Leaves the database in WAL mode, as rekordbox keeps it.
  wal?: boolean
}

// Every fixture row is older than any edit a test makes.
export const FIXTURE_STAMP = '2026-01-01 00:00:00.000 +00:00'

export function writeRekordboxPlaylistFixture(path: string, data: PlaylistFixture): void {
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  if (data.wal) db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255),
      FileNameL VARCHAR(255), FileType INTEGER, FileSize INTEGER, Title VARCHAR(255), Length INTEGER,
      BPM INTEGER, Rating INTEGER, KeyID VARCHAR(255), rb_local_deleted INTEGER DEFAULT 0);
    CREATE TABLE djmdKey (ID VARCHAR(255) PRIMARY KEY, ScaleName VARCHAR(255));
    CREATE TABLE djmdPlaylist (ID VARCHAR(255) PRIMARY KEY, Seq INTEGER, Name VARCHAR(255),
      ImagePath VARCHAR(255), Attribute INTEGER, ParentID VARCHAR(255), SmartList TEXT,
      UUID VARCHAR(255), rb_data_status INTEGER DEFAULT 0, rb_local_data_status INTEGER DEFAULT 0,
      rb_local_deleted TINYINT(1) DEFAULT 0, rb_local_synced TINYINT(1) DEFAULT 0, usn BIGINT,
      rb_local_usn BIGINT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
    CREATE TABLE djmdSongPlaylist (ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255),
      ContentID VARCHAR(255), TrackNo INTEGER, UUID VARCHAR(255),
      rb_data_status INTEGER DEFAULT 0, rb_local_data_status INTEGER DEFAULT 0,
      rb_local_deleted TINYINT(1) DEFAULT 0, rb_local_synced TINYINT(1) DEFAULT 0, usn BIGINT,
      rb_local_usn BIGINT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
    CREATE TABLE agentRegistry (registry_id VARCHAR(255) PRIMARY KEY, int_1 BIGINT,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
  `)
  db.prepare(
    `INSERT INTO agentRegistry (registry_id, int_1, created_at, updated_at)
     VALUES ('localUpdateCount', ?, ?, ?)`,
  ).run(data.usn ?? 1, FIXTURE_STAMP, FIXTURE_STAMP)
  const content = db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, Title, Length, BPM,
       Rating, KeyID, rb_local_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      c.deleted ? 1 : 0,
    )
  }
  const key = db.prepare('INSERT INTO djmdKey VALUES (?, ?)')
  for (const k of data.keys) key.run(k.ID, k.ScaleName)
  const playlist = db.prepare(
    `INSERT INTO djmdPlaylist (ID, Seq, Name, Attribute, ParentID, UUID, rb_local_deleted,
       rb_local_usn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
  for (const p of data.playlists) {
    playlist.run(
      p.ID,
      p.Seq,
      p.Name,
      p.Attribute,
      p.ParentID,
      `uuid-${p.ID}`,
      p.deleted ? 1 : 0,
      FIXTURE_STAMP,
      FIXTURE_STAMP,
    )
  }
  const link = db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_local_deleted,
       rb_local_usn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
  data.links.forEach((l, i) => {
    const id = l.ID ?? `link-${i}`
    link.run(
      id,
      l.PlaylistID,
      l.ContentID,
      l.TrackNo,
      `uuid-${id}`,
      l.deleted === null ? null : l.deleted ? 1 : 0,
      FIXTURE_STAMP,
      FIXTURE_STAMP,
    )
  })
  db.close()
  if (data.xml) writeFileSync(join(dirname(path), 'masterPlaylists6.xml'), fixtureXml(data))
}

function fixtureXml(data: PlaylistFixture): string {
  const nodes = data.playlists
    .filter((p) => !p.deleted)
    .map(
      (p) =>
        `    <NODE Id="${hexId(p.ID)}" ParentId="${hexId(p.ParentID)}" Attribute="${p.Attribute}" Timestamp="1767225600000" Lib_Type="0" CheckType="0"/>`,
    )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '',
    '<MASTER_PLAYLIST Version="3.0.0" AutomaticSync="0">',
    '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="Pioneer DJ"/>',
    '  <PLAYLISTS>',
    ...nodes,
    '  </PLAYLISTS>',
    '</MASTER_PLAYLIST>',
    '',
  ].join('\r\n')
}

// The collection the organising tests edit, numeric IDs so its XML can be written. Factory
// holds a track, a separator, a second track, one of the symlinked twins, a second
// separator, a third track and the second track again (rekordbox allows a file twice in a
// playlist). Ekkah is the measured twin case: the same file recorded under ~/Music/Music
// (a symlink) and under the volume it points at.
export const ORGANISE_FIXTURE: PlaylistFixture = {
  content: [
    {
      ID: '101',
      FolderPath: '/Volumes/Public/Music/Night Train.aiff',
      FileType: 12,
      Title: 'Night Train',
      Length: 256,
    },
    {
      ID: '102',
      FolderPath: '/Volumes/Public/Music/Play This Song.wav',
      FileType: 11,
      Title: 'Play This Song',
      Length: 338,
    },
    {
      ID: '103',
      FolderPath: '/Volumes/Public/Music/Gowan.wav',
      FileType: 11,
      Title: 'Gowan',
      Length: 300,
    },
    {
      ID: '104',
      FolderPath: '/Volumes/Public/Music/Vacation.wav',
      FileType: 11,
      Title: 'Vacation',
      Length: 280,
    },
    {
      ID: '109',
      FolderPath: '/Users/dj/Music/PioneerDJ/Blank Audio/_.mp3',
      FileType: 1,
      Title: ' ',
      Length: 1,
    },
    {
      ID: '110',
      FolderPath: '/Users/dj/Music/PioneerDJ/Other/blank.mp3',
      FileType: 1,
      Title: '',
      Length: 2,
    },
    {
      ID: '201',
      FolderPath: '/Users/dj/Music/Music/Ekkah.wav',
      FileType: 11,
      Title: 'Ekkah',
      Length: 310,
    },
    {
      ID: '202',
      FolderPath: '/Volumes/Public/Music/Ekkah.wav',
      FileType: 11,
      Title: 'Ekkah',
      Length: 310,
    },
  ],
  keys: [],
  playlists: [
    { ID: '1000', Name: 'COMBOS', Attribute: 1, ParentID: 'root', Seq: 1 },
    { ID: '2000', Name: 'Factory', Attribute: 0, ParentID: '1000', Seq: 1 },
    { ID: '3000', Name: 'House', Attribute: 0, ParentID: 'root', Seq: 2 },
    {
      ID: '4000',
      Name: 'Trial playlist - Cloud Library Sync',
      Attribute: -128,
      ParentID: 'root',
      Seq: 3,
    },
  ],
  links: [
    { ID: 'f1', PlaylistID: '2000', ContentID: '101', TrackNo: 1 },
    { ID: 'f2', PlaylistID: '2000', ContentID: '109', TrackNo: 2 },
    { ID: 'f3', PlaylistID: '2000', ContentID: '102', TrackNo: 3 },
    { ID: 'f4', PlaylistID: '2000', ContentID: '201', TrackNo: 4 },
    { ID: 'f5', PlaylistID: '2000', ContentID: '109', TrackNo: 5 },
    { ID: 'f6', PlaylistID: '2000', ContentID: '104', TrackNo: 6 },
    { ID: 'f7', PlaylistID: '2000', ContentID: '102', TrackNo: 7 },
    { ID: 'h1', PlaylistID: '3000', ContentID: '102', TrackNo: 1 },
    { ID: 'h2', PlaylistID: '3000', ContentID: '110', TrackNo: 2 },
  ],
  usn: 500,
}

// The user's ~/Music/Music is a symlink to the volume, so one file has two spellings. The
// path rule findTrackByPath applies, described without touching the disk.
export const TWIN_PATHS = {
  realPath: (p: string): string => p.replace('/Users/dj/Music/Music', '/Volumes/Public/Music'),
  homeMusicDir: '/Users/dj/Music/Music',
}
```

- [ ] **Step 4: Create the helpers**

Create `src/main/rekordboxRows.ts`:

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

type Db = InstanceType<typeof Database>

// What every row Surco writes into a rekordbox collection shares with the rows rekordbox
// writes itself. Kept in one place because each writer (the metadata sync, the playlist
// edits) must make rows rekordbox cannot tell from its own.

// UTC with milliseconds and an explicit offset, the format of every created_at and
// updated_at in a rekordbox 7 collection.
export function rekordboxStamp(now: Date): string {
  return `${now.toISOString().replace('T', ' ').replace('Z', '')} +00:00`
}

// rekordbox numbers every local change from one counter (agentRegistry localUpdateCount)
// and stamps the row with it (rb_local_usn). Taking the next number and moving the counter
// on keeps a row Surco writes ordered after every change rekordbox already made.
export function takeLocalUsn(db: Db, stamp: string): number {
  const { int_1 } = db
    .prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`)
    .get() as { int_1: number }
  const usn = Number(int_1) + 1
  db.prepare(
    `UPDATE agentRegistry SET int_1 = ?, updated_at = ? WHERE registry_id = 'localUpdateCount'`,
  ).run(usn, stamp)
  return usn
}

// rekordbox picks row IDs at random, so a generated one can collide with a row already
// there; drawing again until it is free is what rekordbox and pyrekordbox both do.
export function unusedRowId(db: Db, table: string, next: () => string): string {
  const taken = db.prepare(`SELECT 1 FROM ${table} WHERE ID = ?`)
  for (;;) {
    const id = next()
    if (!taken.get(id)) return id
  }
}
```

Create `src/main/rekordboxMasterXml.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hexId } from './rekordboxMasterXml'

describe('masterPlaylists6.xml ids', () => {
  // Measured: Id is the decimal ID in uppercase hex without leading zeros (30D40 is
  // 200000), and the root is ParentId "0". A node spelt otherwise names no playlist.
  it('spells IDs in uppercase hex and the root as 0', () => {
    expect(hexId('200000')).toBe('30D40')
    expect(hexId('4097321833')).toBe('F4382B69')
    expect(hexId('root')).toBe('0')
  })
})
```

and `src/main/rekordboxMasterXml.ts`:

```ts
// rekordbox 6 and 7 keep every playlist and folder twice: as a row in master.db and as a
// NODE in masterPlaylists6.xml beside it, where the row ID is written in hex.

// The decimal row ID in uppercase hex without leading zeros, and the root as "0" (measured
// on the real file: 30D40 is 200000).
export function hexId(id: string): string {
  return id === 'root' ? '0' : BigInt(id).toString(16).toUpperCase()
}
```

- [ ] **Step 5: Run the helper test**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxRows.test.ts src/main/rekordboxMasterXml.test.ts src/main/rekordboxPlaylists.test.ts src/main/rekordboxPlaylistsIpc.test.ts`
Expected: PASS (the phase 1 reader tests still pass on the rewritten fixture).

- [ ] **Step 6: Point the metadata writer at the helpers (behaviour-preserving)**

In `src/main/rekordboxMetadata.ts`:
- Keep the `node:crypto` import as it is and add `import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'`.
- Delete the local `function timestamp(now: Date): string { ... }`.
- Replace `const stamp = timestamp(options.now ?? new Date())` with `const stamp = rekordboxStamp(options.now ?? new Date())`.
- Replace the whole `const nextUsn = (): number => { ... }` closure with `const nextUsn = (): number => takeLocalUsn(db, stamp)`.
- Replace the whole `const unusedId = (table: string): string => { ... }` closure with `const unusedId = (table: string): string => unusedRowId(db, table, nextId)`.

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxMetadata.test.ts src/main/rekordboxLibrary.test.ts src/main/rekordboxTags.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit the refactor and the fixture**

```bash
git add src/main/rekordboxRows.ts src/main/rekordboxRows.test.ts src/main/rekordboxMetadata.ts src/main/rekordboxPlaylistsFixture.ts src/main/rekordboxMasterXml.ts src/main/rekordboxMasterXml.test.ts
git commit -m "Share rekordbox row helpers and give the playlist fixture the columns a write needs"
```

- [ ] **Step 8: Failing test for link ids on playlist rows**

Append inside `describe('readRekordboxPlaylist', ...)` in `src/main/rekordboxPlaylists.test.ts`:

```ts
  // Editing a playlist addresses its rows, not its files: a file can sit in a playlist twice
  // and the separator file sits there dozens of times, so only the link row says which one
  // the user dragged, and the content row is what another playlist links to.
  it('gives every row its link and content id, so an edit can name the exact row', () => {
    const rows = readRekordboxPlaylist(db, 'factory')
    expect(rows.map((r) => [r.linkId, r.contentId])).toEqual([
      ['link-0', 'c1'],
      ['link-1', 'sep'],
      ['link-2', 'c2'],
      ['link-3', 'c3'],
    ])
  })
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylists.test.ts`
Expected: FAIL, received `[undefined, undefined]` pairs.

- [ ] **Step 9: Carry the ids**

In `src/shared/types.ts`, inside `SourcePlaylistEntry` after `musicPersistentId?: string`:

```ts
  // rekordbox only: the playlist row (djmdSongPlaylist.ID) and the collection entry
  // (djmdContent.ID) behind this entry. Edits name the row; copying to another playlist
  // names the entry, which keeps the symlinked twins apart without guessing by path.
  linkId?: string
  contentId?: string
```

In `src/main/rekordboxPlaylists.ts`:
- Delete its `const STREAMING_FILE_TYPE = 25` (and the comment above it) and import the one from `rekordboxDb.ts` instead: `import { STREAMING_FILE_TYPE, type openRekordboxDb } from './rekordboxDb'`. In `src/main/rekordboxDb.ts`, `const STREAMING_FILE_TYPE = 25` (line 61) becomes `export const STREAMING_FILE_TYPE = 25`.
- `const IS_SEPARATOR = ...` becomes `export const IS_SEPARATOR = ...`.
- In `interface EntryRow` add `linkId: string` and `contentId: string` as the first two fields.
- In `readRekordboxPlaylist`, the SELECT becomes `SELECT s.ID AS linkId, c.ID AS contentId, c.FolderPath, c.FileType, c.BPM, c.Rating, k.ScaleName, ${IS_SEPARATOR} AS sep` and the mapping becomes:

```ts
  return rows.map((row) => {
    const ids = { linkId: String(row.linkId), contentId: String(row.contentId) }
    if (row.sep) return { path: entryPath(row.FolderPath), separator: true, meta: {}, ...ids }
    if (row.FileType === STREAMING_FILE_TYPE)
      return { path: null, separator: false, meta: {}, ...ids }
    return { path: entryPath(row.FolderPath), separator: false, meta: metaOf(row), ...ids }
  })
```

- [ ] **Step 10: Run, typecheck, commit**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylists.test.ts src/renderer/src/lib/playlistView.test.ts src/renderer/src/App.test.tsx`
Expected: PASS.
Run both `tsc` commands from Global Constraints. Expected: no errors.

```bash
git add src/shared/types.ts src/main/rekordboxDb.ts src/main/rekordboxPlaylists.ts src/main/rekordboxPlaylists.test.ts
git commit -m "Give each rekordbox playlist row its link and content id"
```

---

### Task 3: Add, remove, move and insert a separator on an open collection

**Files:**
- Modify: `src/shared/types.ts` (after `SourcePlaylistEntry`)
- Create: `src/main/rekordboxPlaylistEdit.ts`
- Test: `src/main/rekordboxPlaylistEdit.test.ts`

**Interfaces:**
- Consumes: `rekordboxStamp`, `takeLocalUsn`, `unusedRowId` (Task 2); `IS_SEPARATOR` from `rekordboxPlaylists.ts`, `STREAMING_FILE_TYPE` from `rekordboxDb.ts` (Task 2); `findTrackByPath`, `isAmbiguous`, `FindOptions` from `rekordboxDb.ts`; `ORGANISE_FIXTURE`, `TWIN_PATHS`, `FIXTURE_STAMP` (Task 2).
- Produces (types in `shared/types.ts`):
  - `interface PlaylistTrackRef { contentId?: string; paths: string[] }`
  - `type RekordboxPlaylistEdit = { kind: 'add'; playlistId: string; tracks: PlaylistTrackRef[] } | { kind: 'move'; playlistId: string; linkIds: string[]; beforeLinkId: string | null } | { kind: 'remove'; playlistId: string; linkIds: string[] } | { kind: 'insertSeparator'; playlistId: string; beforeLinkId: string } | { kind: 'create'; parentId: string; name: string; folder: boolean }`
  - `type RekordboxEditRefusal = 'cancelled' | 'rekordbox-running' | 'unreadable' | 'backup-failed' | 'write-failed' | 'read-only' | 'stale' | 'no-separator' | 'nothing-to-add'`
  - `interface PlaylistAddReport { added: number; already: number; notInCollection: number; ambiguous: number }`
  - `type RekordboxEditResult = { applied: true; createdId?: string; report?: PlaylistAddReport } | { applied: false; reason: RekordboxEditRefusal; report?: PlaylistAddReport }`
- Produces (in `rekordboxPlaylistEdit.ts`):
  - `class EditRefused extends Error { reason: 'stale' | 'no-separator' }`
  - `interface EditContext { now: Date; newPlaylistId?: () => string }`
  - `resolveTracks(db, tracks: PlaylistTrackRef[], options?: FindOptions): { contentIds: string[]; notInCollection: number; ambiguous: number }`
  - `playlistContents(db, playlistId: string): Set<string>`
  - `addToPlaylist(db, playlistId: string, contentIds: string[], ctx: EditContext): { added: number; already: number }`
  - `removeFromPlaylist(db, playlistId: string, linkIds: string[], ctx: EditContext): number`
  - `moveInPlaylist(db, playlistId: string, linkIds: string[], beforeLinkId: string | null, ctx: EditContext): void`
  - `insertSeparator(db, playlistId: string, beforeLinkId: string, ctx: EditContext): void`
  - `separatorContent(db): string | null`
  - `editProblem(db, edit: RekordboxPlaylistEdit): 'stale' | 'no-separator' | null`
  - `nodeAttribute(db, id: string): number | null` (used by Task 4)

- [ ] **Step 1: The shared types**

In `src/shared/types.ts`, right after `SourcePlaylistEntry`:

```ts
// A track to put in a rekordbox playlist: the collection entry when Surco already knows it
// (a row read from an open rekordbox playlist), and the paths to look it up by otherwise
// (the source file, and the converted one when a conversion moved the collection entry).
export interface PlaylistTrackRef {
  contentId?: string
  paths: string[]
}

// One organising action on rekordbox, as the user made it: one drop, one menu choice, one
// name typed. Each is written on its own, so the dialog asking to close rekordbox comes at
// most once per gesture and every gesture has its own backup.
export type RekordboxPlaylistEdit =
  | { kind: 'add'; playlistId: string; tracks: PlaylistTrackRef[] }
  // beforeLinkId null moves the rows to the end.
  | { kind: 'move'; playlistId: string; linkIds: string[]; beforeLinkId: string | null }
  | { kind: 'remove'; playlistId: string; linkIds: string[] }
  | { kind: 'insertSeparator'; playlistId: string; beforeLinkId: string }
  // parentId 'root' is the top of the tree, as rekordbox spells it.
  | { kind: 'create'; parentId: string; name: string; folder: boolean }

// Why an edit was not written. Every one leaves the collection exactly as it was.
export type RekordboxEditRefusal =
  | 'cancelled'
  | 'rekordbox-running'
  | 'unreadable'
  | 'backup-failed'
  | 'write-failed'
  | 'read-only'
  | 'stale'
  | 'no-separator'
  | 'nothing-to-add'

// What an add did with each track it was given.
export interface PlaylistAddReport {
  added: number
  already: number
  notInCollection: number
  ambiguous: number
}

export type RekordboxEditResult =
  | { applied: true; createdId?: string; report?: PlaylistAddReport }
  | { applied: false; reason: RekordboxEditRefusal; report?: PlaylistAddReport }
```

- [ ] **Step 2: Failing tests**

Create `src/main/rekordboxPlaylistEdit.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import {
  addToPlaylist,
  EditRefused,
  editProblem,
  insertSeparator,
  moveInPlaylist,
  removeFromPlaylist,
  resolveTracks,
  separatorContent,
} from './rekordboxPlaylistEdit'
import {
  FIXTURE_STAMP,
  ORGANISE_FIXTURE,
  type PlaylistFixture,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'

const NOW = new Date('2026-10-15T18:00:00.000Z')
const STAMP = '2026-10-15 18:00:00.000 +00:00'
const ctx = { now: NOW }

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>
let db: Db

async function openFixture(fixture: PlaylistFixture = ORGANISE_FIXTURE): Promise<Db> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbedit-')), 'master.db')
  writeRekordboxPlaylistFixture(path, fixture)
  const opened = openRekordboxDb(path)
  if (!opened) throw new Error('fixture did not open')
  return opened
}

beforeEach(async () => {
  db = await openFixture()
})
afterEach(() => db.close())

interface Row {
  ID: string
  ContentID: string
  TrackNo: number
  usn: number
  updated_at: string
}

function rows(playlistId: string): Row[] {
  return db
    .prepare(
      `SELECT ID, ContentID, TrackNo, rb_local_usn AS usn, updated_at FROM djmdSongPlaylist
        WHERE PlaylistID = ? ORDER BY TrackNo`,
    )
    .all(playlistId) as Row[]
}

const ids = (playlistId: string): string[] => rows(playlistId).map((r) => r.ID)
const contents = (playlistId: string): string[] => rows(playlistId).map((r) => r.ContentID)
const trackNos = (playlistId: string): number[] => rows(playlistId).map((r) => r.TrackNo)
const counter = (): number =>
  (
    db.prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`).get() as {
      int_1: number
    }
  ).int_1

describe('resolveTracks', () => {
  // The user's music is reached through ~/Music/Music, a symlink to the volume rekordbox
  // also stored directly: a track Surco loaded through one spelling must still be found.
  it('finds a track by path through the symlinked music folder', () => {
    expect(resolveTracks(db, [{ paths: ['/Users/dj/Music/Music/Gowan.wav'] }], TWIN_PATHS)).toEqual(
      { contentIds: ['103'], notInCollection: 0, ambiguous: 0 },
    )
  })

  // Two collection rows for one file differ in size and in the playlists they sit in;
  // choosing one would be a guess about the user's library, so neither is added.
  it('refuses to guess between the two rows of a symlinked twin', () => {
    expect(resolveTracks(db, [{ paths: ['/Volumes/Public/Music/Ekkah.wav'] }], TWIN_PATHS)).toEqual(
      { contentIds: [], notInCollection: 0, ambiguous: 1 },
    )
  })

  // A row copied from an open rekordbox playlist names its exact entry: copying a twin from
  // one playlist to another is not a guess.
  it('takes the entry a playlist row already names, twin or not', () => {
    expect(
      resolveTracks(
        db,
        [{ contentId: '201', paths: ['/Volumes/Public/Music/Ekkah.wav'] }],
        TWIN_PATHS,
      ).contentIds,
    ).toEqual(['201'])
  })

  // Giving rekordbox a track it does not know means creating its entry, with an analysis
  // still to run: not this phase.
  it('counts a track the collection does not have', () => {
    expect(resolveTracks(db, [{ paths: ['/Volumes/Public/Music/new.wav'] }], TWIN_PATHS)).toEqual(
      { contentIds: [], notInCollection: 1, ambiguous: 0 },
    )
  })

  it('never takes the separator file as a track', () => {
    expect(resolveTracks(db, [{ contentId: '109', paths: [] }], TWIN_PATHS).notInCollection).toBe(1)
  })

  // A conversion that wrote elsewhere moves the collection entry to the new file, so the
  // source path no longer finds it but the converted one does.
  it('finds a converted track by its output when the source is not in the collection', () => {
    expect(
      resolveTracks(
        db,
        [{ paths: ['/Volumes/Public/Music/Gowan.mp3', '/Volumes/Public/Music/Gowan.wav'] }],
        TWIN_PATHS,
      ).contentIds,
    ).toEqual(['103'])
  })

  it('adds a track named twice only once', () => {
    expect(
      resolveTracks(
        db,
        [{ paths: ['/Volumes/Public/Music/Gowan.wav'] }, { contentId: '103', paths: [] }],
        TWIN_PATHS,
      ).contentIds,
    ).toEqual(['103'])
  })
})

describe('addToPlaylist', () => {
  // rekordbox appends a dropped track at the end of the playlist and keeps TrackNo 1..N,
  // which is what the measured collection shows in every playlist.
  it('appends the tracks in the order given, numbered on from the last row', () => {
    expect(addToPlaylist(db, '3000', ['103', '101'], ctx)).toEqual({ added: 2, already: 0 })
    expect(contents('3000')).toEqual(['102', '110', '103', '101'])
    expect(trackNos('3000')).toEqual([1, 2, 3, 4])
  })

  // The list shows each file once; a second link would be a row the user can never see.
  it('skips a track the playlist already holds', () => {
    expect(addToPlaylist(db, '3000', ['102'], ctx)).toEqual({ added: 0, already: 1 })
    expect(contents('3000')).toEqual(['102', '110'])
  })

  // A row rekordbox cannot tell from its own: UUID ids, the next change number, now.
  it('writes the new row the way rekordbox writes one', () => {
    addToPlaylist(db, '3000', ['103'], ctx)
    const row = db
      .prepare(`SELECT * FROM djmdSongPlaylist WHERE PlaylistID = '3000' AND ContentID = '103'`)
      .get() as Record<string, unknown>
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(row.ID).toMatch(uuid)
    expect(row.UUID).toMatch(uuid)
    expect(row).toMatchObject({
      TrackNo: 3,
      rb_local_usn: 501,
      rb_local_deleted: 0,
      rb_local_synced: 0,
      usn: null,
      created_at: STAMP,
      updated_at: STAMP,
    })
    expect(counter()).toBe(501)
  })

  it('refuses a folder as a playlist, so tracks never hang off a folder', () => {
    expect(() => addToPlaylist(db, '1000', ['103'], ctx)).toThrow(EditRefused)
  })
})

describe('removeFromPlaylist', () => {
  // The list shows a track once; removing that row must take every link of the track, or
  // the hidden one brings the row straight back on the re-read.
  it('removes every occurrence of the track the row stands for', () => {
    expect(removeFromPlaylist(db, '2000', ['f3'], ctx)).toBe(2)
    expect(contents('2000')).toEqual(['101', '109', '201', '109', '104'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5])
  })

  // A separator is placed by hand; removing one break must leave the others.
  it('removes a separator by its own row only', () => {
    removeFromPlaylist(db, '2000', ['f2'], ctx)
    expect(ids('2000')).toEqual(['f1', 'f3', 'f4', 'f5', 'f6', 'f7'])
  })

  it('never touches the collection entries themselves', () => {
    const before = db.prepare('SELECT count(*) AS n FROM djmdContent').get()
    removeFromPlaylist(db, '2000', ['f1', 'f2'], ctx)
    expect(db.prepare('SELECT count(*) AS n FROM djmdContent').get()).toEqual(before)
  })

  it('refuses a row that is no longer there', () => {
    expect(() => removeFromPlaylist(db, '2000', ['gone'], ctx)).toThrow(EditRefused)
    expect(ids('2000')).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
  })
})

describe('moveInPlaylist', () => {
  it('moves rows before the row they were dropped on', () => {
    moveInPlaylist(db, '2000', ['f6'], 'f1', ctx)
    expect(ids('2000')).toEqual(['f6', 'f1', 'f2', 'f3', 'f4', 'f5', 'f7'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('moves rows to the end when dropped after the last one', () => {
    moveInPlaylist(db, '2000', ['f1'], null, ctx)
    expect(ids('2000')).toEqual(['f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f1'])
  })

  // Separators move like rows, and two of them may end up side by side.
  it('moves a separator next to another one', () => {
    moveInPlaylist(db, '2000', ['f5'], 'f3', ctx)
    expect(ids('2000')).toEqual(['f1', 'f2', 'f5', 'f3', 'f4', 'f6', 'f7'])
  })

  // Rows Surco does not show (a missing file, the hidden duplicate) are still in the
  // playlist; a move must leave them where they were relative to each other.
  it('keeps the rows it was not asked to move in their order', () => {
    moveInPlaylist(db, '2000', ['f2', 'f6'], 'f1', ctx)
    expect(ids('2000')).toEqual(['f2', 'f6', 'f1', 'f3', 'f4', 'f5', 'f7'])
  })

  // Measured on the real collection: a reorder stamps every moved row with one change
  // number. Rows whose place did not change keep theirs.
  it('stamps the rows whose place changed with one change number', () => {
    moveInPlaylist(db, '2000', ['f6'], 'f4', ctx)
    const byId = Object.fromEntries(rows('2000').map((r) => [r.ID, r]))
    expect([byId.f6.usn, byId.f4.usn, byId.f5.usn]).toEqual([501, 501, 501])
    expect(byId.f6.updated_at).toBe(STAMP)
    expect(byId.f1).toMatchObject({ usn: 1, updated_at: FIXTURE_STAMP })
    expect(counter()).toBe(501)
  })

  it('writes nothing for a drop onto the row being moved', () => {
    moveInPlaylist(db, '2000', ['f3'], 'f3', ctx)
    expect(ids('2000')).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
    expect(counter()).toBe(500)
  })

  it('refuses a target row that is gone', () => {
    expect(() => moveInPlaylist(db, '2000', ['f1'], 'gone', ctx)).toThrow(EditRefused)
  })
})

describe('insertSeparator', () => {
  // Above a row that already has a separator over it, the new one goes right above the
  // row: two breaks side by side, both kept.
  it('puts the collection separator right above the row, even next to another', () => {
    insertSeparator(db, '2000', 'f6', ctx)
    expect(contents('2000')).toEqual(['101', '109', '102', '201', '109', '109', '104', '102'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  // The user's collection has one separator linked 345 times; another blank file used once
  // is more likely a stray than the DJ's separator.
  it('uses the separator the collection links most', () => {
    insertSeparator(db, '3000', 'h1', ctx)
    expect(contents('3000')).toEqual(['109', '102', '110'])
  })

  it('refuses when the collection has no separator to copy', async () => {
    db.close()
    db = await openFixture({
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.filter((c) => c.ID !== '109' && c.ID !== '110'),
      links: ORGANISE_FIXTURE.links.filter((l) => l.ContentID !== '109' && l.ContentID !== '110'),
    })
    expect(separatorContent(db)).toBeNull()
    expect(() => insertSeparator(db, '2000', 'f1', ctx)).toThrow(EditRefused)
  })
})

describe('editProblem', () => {
  // Checked before rekordbox is asked to close: an edit that cannot apply must not cost
  // the user a closed rekordbox.
  it('flags a row or a playlist that is gone', () => {
    expect(
      editProblem(db, { kind: 'move', playlistId: '2000', linkIds: ['gone'], beforeLinkId: null }),
    ).toBe('stale')
    expect(editProblem(db, { kind: 'remove', playlistId: '1000', linkIds: ['f1'] })).toBe('stale')
    expect(editProblem(db, { kind: 'create', parentId: '3000', name: 'x', folder: false })).toBe(
      'stale',
    )
  })

  it('passes an edit that can apply', () => {
    expect(
      editProblem(db, { kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' }),
    ).toBeNull()
    expect(editProblem(db, { kind: 'create', parentId: 'root', name: 'x', folder: true })).toBeNull()
    expect(editProblem(db, { kind: 'insertSeparator', playlistId: '2000', beforeLinkId: 'f1' })).toBeNull()
  })

  // Without a separator to copy, asking rekordbox to close would cost the user for nothing.
  it('flags a separator insert when the collection has none to copy', async () => {
    db.close()
    db = await openFixture({
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.filter((c) => c.ID !== '109' && c.ID !== '110'),
      links: ORGANISE_FIXTURE.links.filter((l) => l.ContentID !== '109' && l.ContentID !== '110'),
    })
    expect(editProblem(db, { kind: 'insertSeparator', playlistId: '2000', beforeLinkId: 'f1' })).toBe(
      'no-separator',
    )
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistEdit.test.ts`
Expected: FAIL, `Cannot find module './rekordboxPlaylistEdit'`.

- [ ] **Step 4: Implement**

Create `src/main/rekordboxPlaylistEdit.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PlaylistTrackRef, RekordboxPlaylistEdit } from '../shared/types'
import { type FindOptions, findTrackByPath, isAmbiguous, STREAMING_FILE_TYPE } from './rekordboxDb'
import { IS_SEPARATOR } from './rekordboxPlaylists'
import { rekordboxStamp, takeLocalUsn } from './rekordboxRows'

// The organising edits, each on a collection already opened read-write and inside the
// caller's transaction (rekordboxPlaylistWrite.ts holds the guard, the backups and the
// rollback). Every edit leaves the touched playlist numbered 1..N, as rekordbox keeps them,
// and never touches djmdContent: a playlist only links collection entries.

type Db = InstanceType<typeof Database>

// An edit that cannot apply to the collection as it is now: a row or playlist removed in
// rekordbox since Surco read it, or no separator to copy. Thrown inside the transaction so
// nothing is half written.
export class EditRefused extends Error {
  constructor(readonly reason: 'stale' | 'no-separator') {
    super(reason)
  }
}

export interface EditContext {
  now: Date
  // Seam for the tests and for skipping IDs the XML already holds (Task 4).
  newPlaylistId?: () => string
}

interface Link {
  ID: string
  ContentID: string
  TrackNo: number
  sep: number
}

// Every live link of the playlist, in its order. A link whose content row is gone still
// holds a number, so it is kept here (LEFT JOIN): numbering around it would collide.
function links(db: Db, playlistId: string): Link[] {
  return db
    .prepare(
      `SELECT s.ID, s.ContentID, s.TrackNo, coalesce(${IS_SEPARATOR}, 0) AS sep
         FROM djmdSongPlaylist s LEFT JOIN djmdContent c ON c.ID = s.ContentID
        WHERE s.PlaylistID = ? AND coalesce(s.rb_local_deleted, 0) = 0
        ORDER BY s.TrackNo, s.ID`,
    )
    .all(playlistId) as Link[]
}

export function nodeAttribute(db: Db, id: string): number | null {
  const row = db
    .prepare(
      `SELECT Attribute FROM djmdPlaylist WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(id) as { Attribute: number } | undefined
  return row ? row.Attribute : null
}

function requirePlaylist(db: Db, id: string): void {
  if (nodeAttribute(db, id) !== 0) throw new EditRefused('stale')
}

function requireLinks(all: Link[], ids: string[]): void {
  const known = new Set(all.map((l) => l.ID))
  if (ids.some((id) => !known.has(id))) throw new EditRefused('stale')
}

// Numbers the playlist 1..N in the order given. Rows whose number changes share one change
// number, as rekordbox stamps a reorder (measured: Factory's rows carry one usn after a
// move); rows that keep their place are left alone.
function writeOrder(db: Db, order: Link[], stamp: string): void {
  if (order.every((l, i) => l.TrackNo === i + 1)) return
  const usn = takeLocalUsn(db, stamp)
  const update = db.prepare(
    `UPDATE djmdSongPlaylist SET TrackNo = ?, rb_local_usn = ?, updated_at = ? WHERE ID = ?`,
  )
  order.forEach((l, i) => {
    if (l.TrackNo !== i + 1) update.run(i + 1, usn, stamp, l.ID)
  })
}

// rekordbox 7 identifies a playlist row by a UUID (measured on all 9432 links), and gives
// each new row its own change number.
function insertLink(
  db: Db,
  playlistId: string,
  contentId: string,
  trackNo: number,
  stamp: string,
): Link {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_data_status,
       rb_local_data_status, rb_local_deleted, rb_local_synced, usn, rb_local_usn, created_at,
       updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
  ).run(id, playlistId, contentId, trackNo, randomUUID(), takeLocalUsn(db, stamp), stamp, stamp)
  return { ID: id, ContentID: contentId, TrackNo: trackNo, sep: 0 }
}

const lastTrackNo = (all: Link[]): number => all.reduce((max, l) => Math.max(max, l.TrackNo), 0)

export interface ResolvedTracks {
  contentIds: string[]
  notInCollection: number
  ambiguous: number
}

// The collection entries for the tracks to add. A row read from a rekordbox playlist names
// its entry already; everything else is looked up by path with the same rules the repoint
// uses (resolved symlinks, and a refusal rather than a guess between two rows for one
// file). A track the collection does not have is counted, never created.
export function resolveTracks(
  db: Db,
  tracks: PlaylistTrackRef[],
  options: FindOptions = {},
): ResolvedTracks {
  const known = db.prepare(
    `SELECT 1 FROM djmdContent c WHERE c.ID = ? AND coalesce(c.rb_local_deleted, 0) = 0
        AND c.FileType <> ? AND NOT ${IS_SEPARATOR}`,
  )
  const found: string[] = []
  let notInCollection = 0
  let ambiguous = 0
  for (const track of tracks) {
    if (track.contentId && known.get(track.contentId, STREAMING_FILE_TYPE)) {
      found.push(track.contentId)
      continue
    }
    let id: string | null = null
    let twins = false
    for (const path of track.paths) {
      const match = findTrackByPath(db, path, options)
      if (match === null) continue
      if (isAmbiguous(match)) {
        twins = true
        continue
      }
      id = match.id
      break
    }
    if (id) found.push(id)
    else if (twins) ambiguous++
    else notInCollection++
  }
  return { contentIds: [...new Set(found)], notInCollection, ambiguous }
}

export function playlistContents(db: Db, playlistId: string): Set<string> {
  return new Set(links(db, playlistId).map((l) => l.ContentID))
}

export function addToPlaylist(
  db: Db,
  playlistId: string,
  contentIds: string[],
  ctx: EditContext,
): { added: number; already: number } {
  requirePlaylist(db, playlistId)
  const stamp = rekordboxStamp(ctx.now)
  const order = links(db, playlistId)
  const present = new Set(order.map((l) => l.ContentID))
  let next = lastTrackNo(order)
  let added = 0
  let already = 0
  for (const id of contentIds) {
    if (present.has(id)) {
      already++
      continue
    }
    present.add(id)
    next += 1
    order.push(insertLink(db, playlistId, id, next, stamp))
    added++
  }
  writeOrder(db, order, stamp)
  return { added, already }
}

// A track row stands for every link of that track in the playlist (the list shows it
// once), so all of them go; a separator goes one link at a time. Links are deleted, as
// rekordbox does with cloud sync off (measured: no soft-deleted link among 9432).
export function removeFromPlaylist(
  db: Db,
  playlistId: string,
  linkIds: string[],
  ctx: EditContext,
): number {
  requirePlaylist(db, playlistId)
  const order = links(db, playlistId)
  requireLinks(order, linkIds)
  const named = order.filter((l) => linkIds.includes(l.ID))
  const tracks = new Set(named.filter((l) => !l.sep).map((l) => l.ContentID))
  const doomed = new Set([
    ...named.map((l) => l.ID),
    ...order.filter((l) => tracks.has(l.ContentID)).map((l) => l.ID),
  ])
  const remove = db.prepare('DELETE FROM djmdSongPlaylist WHERE ID = ?')
  for (const id of doomed) remove.run(id)
  writeOrder(
    db,
    order.filter((l) => !doomed.has(l.ID)),
    rekordboxStamp(ctx.now),
  )
  return doomed.size
}

// The moved rows keep their own relative order and land right before the target (or at the
// end); every other row, shown in Surco or not, keeps its place relative to the rest.
export function moveInPlaylist(
  db: Db,
  playlistId: string,
  linkIds: string[],
  beforeLinkId: string | null,
  ctx: EditContext,
): void {
  requirePlaylist(db, playlistId)
  const order = links(db, playlistId)
  requireLinks(order, beforeLinkId === null ? linkIds : [...linkIds, beforeLinkId])
  const moving = new Set(linkIds)
  if (beforeLinkId !== null && moving.has(beforeLinkId)) return
  const moved = order.filter((l) => moving.has(l.ID))
  const rest = order.filter((l) => !moving.has(l.ID))
  const at = beforeLinkId === null ? rest.length : rest.findIndex((l) => l.ID === beforeLinkId)
  rest.splice(at, 0, ...moved)
  writeOrder(db, rest, rekordboxStamp(ctx.now))
}

// The DJ's own separator, found by what it is (a blank file of a second or two) and, among
// several, the one linked most: the measured collection links one 345 times.
export function separatorContent(db: Db): string | null {
  const row = db
    .prepare(
      `SELECT c.ID, count(s.ID) AS uses FROM djmdContent c
         LEFT JOIN djmdSongPlaylist s ON s.ContentID = c.ID AND coalesce(s.rb_local_deleted, 0) = 0
        WHERE coalesce(c.rb_local_deleted, 0) = 0 AND c.FileType <> ? AND ${IS_SEPARATOR}
        GROUP BY c.ID ORDER BY uses DESC, c.ID LIMIT 1`,
    )
    .get(STREAMING_FILE_TYPE) as { ID: string } | undefined
  return row ? String(row.ID) : null
}

export function insertSeparator(
  db: Db,
  playlistId: string,
  beforeLinkId: string,
  ctx: EditContext,
): void {
  requirePlaylist(db, playlistId)
  const separator = separatorContent(db)
  if (!separator) throw new EditRefused('no-separator')
  const order = links(db, playlistId)
  requireLinks(order, [beforeLinkId])
  const stamp = rekordboxStamp(ctx.now)
  const link = insertLink(db, playlistId, separator, lastTrackNo(order) + 1, stamp)
  order.splice(
    order.findIndex((l) => l.ID === beforeLinkId),
    0,
    link,
  )
  writeOrder(db, order, stamp)
}

// Whether an edit can apply to the collection as it is now, checked on a read-only handle
// before rekordbox is asked to close: an edit that cannot apply must not cost the user a
// closed rekordbox.
export function editProblem(db: Db, edit: RekordboxPlaylistEdit): 'stale' | 'no-separator' | null {
  if (edit.kind === 'create')
    return edit.parentId === 'root' || nodeAttribute(db, edit.parentId) === 1 ? null : 'stale'
  if (nodeAttribute(db, edit.playlistId) !== 0) return 'stale'
  const known = new Set(links(db, edit.playlistId).map((l) => l.ID))
  const named =
    edit.kind === 'move'
      ? [...edit.linkIds, ...(edit.beforeLinkId === null ? [] : [edit.beforeLinkId])]
      : edit.kind === 'remove'
        ? edit.linkIds
        : edit.kind === 'insertSeparator'
          ? [edit.beforeLinkId]
          : []
  if (named.some((id) => !known.has(id))) return 'stale'
  if (edit.kind === 'insertSeparator' && separatorContent(db) === null) return 'no-separator'
  return null
}
```

- [ ] **Step 5: Run the tests**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistEdit.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Mutation check on the rules that protect the data**

One at a time, break and re-run the file; each must turn a test red, then restore:
1. In `removeFromPlaylist`, drop the second spread (`...order.filter((l) => tracks.has(...))`) → "removes every occurrence" fails.
2. In `writeOrder`, use `takeLocalUsn` per row instead of once → "stamps the rows whose place changed with one change number" fails.
3. In `resolveTracks`, replace `twins = true; continue` with `id = match.ambiguous[0]; break` → "refuses to guess" fails.
4. In `addToPlaylist`, remove the `present.has(id)` branch → "skips a track the playlist already holds" fails.
5. In `removeFromPlaylist`, delete the `writeOrder(...)` call (the renumbering) → "removes every occurrence of the track the row stands for" fails on `trackNos('2000')` (it reads `[1, 2, 4, 5, 6]`, not 1..5). This is the contiguity rule the spec asks to mutate.
6. In `editProblem`, delete the `no-separator` line → "flags a separator insert when the collection has none to copy" fails.

- [ ] **Step 7: Typecheck, lint, commit**

Run the two `tsc` commands and `biome check --write src` from Global Constraints. Expected: clean.

```bash
git add src/shared/types.ts src/main/rekordboxPlaylistEdit.ts src/main/rekordboxPlaylistEdit.test.ts
git commit -m "Add, remove, move and separate tracks in a rekordbox playlist"
```

---

### Task 4: Create playlists and folders, and their masterPlaylists6.xml node

**Files:**
- Modify: `src/main/rekordboxPlaylistEdit.ts` (append `createNode`, `randomPlaylistId`)
- Modify: `src/main/rekordboxMasterXml.ts` (Task 2 created it with `hexId`)
- Test: `src/main/rekordboxPlaylistEdit.test.ts` (append), `src/main/rekordboxMasterXml.test.ts` (append)

**Interfaces:**
- Consumes: `EditRefused`, `EditContext`, `nodeAttribute` (Task 3); `rekordboxStamp`, `takeLocalUsn`, `unusedRowId`, `hexId` (Task 2).
- Produces:
  - `randomPlaylistId(): string` (decimal of a random integer in [100, 2^28))
  - `createNode(db, parentId: string, name: string, folder: boolean, ctx: EditContext): { id: string; attribute: 0 | 1 }`
  - `playlistXmlPath(collectionPath: string): string`
  - `withPlaylistNode(xml: string, node: { id: string; parentId: string; attribute: 0 | 1; timestamp: number }): string`
  - `xmlNodeIds(xml: string): Set<string>` (hex Ids)

- [ ] **Step 1: Failing tests for the database side**

Append to `src/main/rekordboxPlaylistEdit.test.ts` (add `createNode, randomPlaylistId` to the import from `./rekordboxPlaylistEdit`):

```ts
describe('createNode', () => {
  function node(id: string) {
    return db.prepare('SELECT * FROM djmdPlaylist WHERE ID = ?').get(id) as Record<string, unknown>
  }

  // rekordbox lists siblings by Seq; a new playlist goes last, after every live sibling,
  // the −128 rows included (rekordbox numbers "Acapellas" with the rest at the root).
  it('creates a playlist at the end of the root', () => {
    expect(createNode(db, 'root', '  Bolo  ', false, { now: NOW, newPlaylistId: () => '777' })).toEqual(
      { id: '777', attribute: 0 },
    )
    expect(node('777')).toMatchObject({
      Seq: 4,
      Name: 'Bolo',
      Attribute: 0,
      ParentID: 'root',
      SmartList: null,
      rb_local_usn: 501,
      rb_local_deleted: 0,
      rb_local_synced: 0,
      created_at: STAMP,
      updated_at: STAMP,
    })
    expect(node('777').UUID).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('creates a folder at the end of a folder', () => {
    createNode(db, '1000', 'BASES', true, { now: NOW, newPlaylistId: () => '778' })
    expect(node('778')).toMatchObject({ Seq: 2, Attribute: 1, ParentID: '1000' })
  })

  it('refuses a parent that is a playlist, not a folder', () => {
    expect(() => createNode(db, '3000', 'x', false, { now: NOW })).toThrow(EditRefused)
  })

  it('draws another ID when the table already uses one', () => {
    const draws = ['2000', '779']
    expect(
      createNode(db, 'root', 'x', false, { now: NOW, newPlaylistId: () => draws.shift() ?? '0' })
        .id,
    ).toBe('779')
  })

  // pyrekordbox keeps generated playlist IDs within 28 bits and away from rekordbox's own
  // reserved low numbers (the CUE Analysis Playlist is 200000, the trial row 100000).
  it('draws IDs the way pyrekordbox does', () => {
    for (let i = 0; i < 200; i++) {
      const id = Number(randomPlaylistId())
      expect(id).toBeGreaterThanOrEqual(100)
      expect(id).toBeLessThan(2 ** 28)
    }
  })
})
```

- [ ] **Step 2: Failing tests for the XML side**

In `src/main/rekordboxMasterXml.test.ts` (Task 2 wrote it with the `hexId` test), change the import to `import { hexId, playlistXmlPath, withPlaylistNode, xmlNodeIds } from './rekordboxMasterXml'` and append:

```ts

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '',
  '<MASTER_PLAYLIST Version="3.0.0" AutomaticSync="0">',
  '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="Pioneer DJ"/>',
  '  <PLAYLISTS>',
  '    <NODE Id="3E8" ParentId="0" Attribute="1" Timestamp="1767225600000" Lib_Type="0" CheckType="0"/>',
  '  </PLAYLISTS>',
  '</MASTER_PLAYLIST>',
  '',
].join('\r\n')

describe('masterPlaylists6.xml', () => {
  it('lives beside master.db', () => {
    expect(playlistXmlPath('/Users/dj/Library/Pioneer/rekordbox/master.db')).toBe(
      '/Users/dj/Library/Pioneer/rekordbox/masterPlaylists6.xml',
    )
  })

  // rekordbox appends new nodes at the end whatever their folder, with CRLF line ends;
  // everything already in the file stays byte for byte.
  it('appends the node as the last playlist entry, keeping the file as it was', () => {
    const next = withPlaylistNode(XML, {
      id: '777',
      parentId: '1000',
      attribute: 0,
      timestamp: 1792087200000,
    })
    expect(next).toBe(
      XML.replace(
        '  </PLAYLISTS>',
        '    <NODE Id="309" ParentId="3E8" Attribute="0" Timestamp="1792087200000" Lib_Type="0" CheckType="0"/>\r\n  </PLAYLISTS>',
      ),
    )
  })

  // A collection with no playlist yet may write the element self-closed.
  it('opens an empty playlist list to add the first node', () => {
    const empty = XML.replace(
      /  <PLAYLISTS>\r\n.*\r\n  <\/PLAYLISTS>/,
      '  <PLAYLISTS/>',
    )
    expect(withPlaylistNode(empty, { id: '777', parentId: 'root', attribute: 1, timestamp: 1 })).toContain(
      '  <PLAYLISTS>\r\n    <NODE Id="309" ParentId="0" Attribute="1" Timestamp="1" Lib_Type="0" CheckType="0"/>\r\n  </PLAYLISTS>',
    )
  })

  it('refuses a file without a playlist list rather than guessing where to write', () => {
    expect(() =>
      withPlaylistNode('<MASTER_PLAYLIST/>', { id: '1', parentId: 'root', attribute: 0, timestamp: 1 }),
    ).toThrow()
  })

  // The real file keeps nodes the database no longer has; a new ID must avoid those too.
  it('lists the node IDs the file already holds', () => {
    expect(xmlNodeIds(XML)).toEqual(new Set(['3E8']))
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistEdit.test.ts src/main/rekordboxMasterXml.test.ts`
Expected: FAIL, `createNode` is not exported and `./rekordboxMasterXml` does not exist.

- [ ] **Step 4: Implement the database side**

In `src/main/rekordboxPlaylistEdit.ts` change the crypto import to `import { randomInt, randomUUID } from 'node:crypto'`, the rows import to `import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'`, and append:

```ts
// pyrekordbox's rule for a new playlist ID: random, within 28 bits, never below 100.
export function randomPlaylistId(): string {
  return String(randomInt(100, 2 ** 28))
}

// A new playlist or folder goes last among its live siblings, which is where rekordbox puts
// one created from its own menu.
export function createNode(
  db: Db,
  parentId: string,
  name: string,
  folder: boolean,
  ctx: EditContext,
): { id: string; attribute: 0 | 1 } {
  if (parentId !== 'root' && nodeAttribute(db, parentId) !== 1) throw new EditRefused('stale')
  const stamp = rekordboxStamp(ctx.now)
  const { last } = db
    .prepare(
      `SELECT coalesce(max(Seq), 0) AS last FROM djmdPlaylist
        WHERE ParentID = ? AND coalesce(rb_local_deleted, 0) = 0`,
    )
    .get(parentId) as { last: number }
  const id = unusedRowId(db, 'djmdPlaylist', ctx.newPlaylistId ?? randomPlaylistId)
  const attribute = folder ? 1 : 0
  db.prepare(
    `INSERT INTO djmdPlaylist (ID, Seq, Name, ImagePath, Attribute, ParentID, SmartList, UUID,
       rb_data_status, rb_local_data_status, rb_local_deleted, rb_local_synced, usn, rb_local_usn,
       created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
  ).run(
    id,
    Number(last) + 1,
    name.trim(),
    attribute,
    parentId,
    randomUUID(),
    takeLocalUsn(db, stamp),
    stamp,
    stamp,
  )
  return { id, attribute }
}
```

- [ ] **Step 5: Implement the XML side**

In `src/main/rekordboxMasterXml.ts` add `import { dirname, join } from 'node:path'` at the top, extend the header comment with the paragraph below, and append the three functions (`hexId` stays as Task 2 wrote it, and is the only one):

```ts
// Creating a playlist or folder means adding both, as pyrekordbox does; moving tracks
// never touches this file (measured: link edits do not even change the playlist row). The
// file is edited as text, not reparsed and reserialised, so everything rekordbox wrote
// (its CRLF line ends, the iTunes nodes, nodes the database no longer has) stays byte for
// byte.

export function playlistXmlPath(collectionPath: string): string {
  return join(dirname(collectionPath), 'masterPlaylists6.xml')
}

export function withPlaylistNode(
  xml: string,
  node: { id: string; parentId: string; attribute: 0 | 1; timestamp: number },
): string {
  const eol = xml.includes('\r\n') ? '\r\n' : '\n'
  const line = `    <NODE Id="${hexId(node.id)}" ParentId="${hexId(node.parentId)}" Attribute="${node.attribute}" Timestamp="${node.timestamp}" Lib_Type="0" CheckType="0"/>`
  const close = xml.lastIndexOf('</PLAYLISTS>')
  if (close !== -1) {
    const lineStart = xml.lastIndexOf('\n', close) + 1
    return `${xml.slice(0, lineStart)}${line}${eol}${xml.slice(lineStart)}`
  }
  const empty = xml.indexOf('<PLAYLISTS/>')
  if (empty === -1) throw new Error('masterPlaylists6.xml has no PLAYLISTS element')
  return `${xml.slice(0, empty)}<PLAYLISTS>${eol}${line}${eol}  </PLAYLISTS>${xml.slice(empty + '<PLAYLISTS/>'.length)}`
}

export function xmlNodeIds(xml: string): Set<string> {
  return new Set([...xml.matchAll(/<NODE [^>]*\bId="([^"]+)"/g)].map((m) => m[1]))
}
```

- [ ] **Step 6: Run the tests**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistEdit.test.ts src/main/rekordboxMasterXml.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

Run the two `tsc` commands and `biome check --write src` from Global Constraints. Expected: clean.

```bash
git add src/main/rekordboxPlaylistEdit.ts src/main/rekordboxPlaylistEdit.test.ts src/main/rekordboxMasterXml.ts src/main/rekordboxMasterXml.test.ts
git commit -m "Create rekordbox playlists and folders with their masterPlaylists6.xml node"
```

---

### Task 5: Write one edit safely: dialog, backups, transaction, restore

**Files:**
- Create: `src/main/rekordboxPlaylistWrite.ts`
- Test: `src/main/rekordboxPlaylistWrite.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 and 4; `openRekordboxDb`, `FindOptions` (`rekordboxDb.ts`); `isRekordboxRunning` (`rekordboxProcess.ts`).
- Produces:
  - `interface PlaylistWriteDeps extends FindOptions { ensureClosed: () => Promise<boolean>; sessionBackup: (path: string) => Promise<void>; now?: () => Date; onWrite?: () => void; writeXml?: (path: string, text: string) => Promise<void> }`
  - `editRekordboxPlaylist(collectionPath: string, edit: RekordboxPlaylistEdit, deps: PlaylistWriteDeps): Promise<RekordboxEditResult>`

- [ ] **Step 1: Failing tests**

Create `src/main/rekordboxPlaylistWrite.test.ts`:

```ts
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'
import {
  ORGANISE_FIXTURE,
  type PlaylistFixture,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'

// The probe shells out to pgrep/tasklist; pinned so the suite never depends on whether
// rekordbox happens to be open on the machine running it.
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { isRekordboxRunning } from './rekordboxProcess'
import { editRekordboxPlaylist } from './rekordboxPlaylistWrite'

const NOW = new Date('2026-10-15T18:00:00.000Z')
const MOVE: RekordboxPlaylistEdit = {
  kind: 'move',
  playlistId: '2000',
  linkIds: ['f6'],
  beforeLinkId: 'f1',
}
const CREATE: RekordboxPlaylistEdit = { kind: 'create', parentId: 'root', name: 'Bolo', folder: false }

beforeEach(() => {
  vi.mocked(isRekordboxRunning).mockReset()
  vi.mocked(isRekordboxRunning).mockResolvedValue(false)
})

async function collection(over: Partial<PlaylistFixture> = {}): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbwrite-')), 'master.db')
  writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true, ...over })
  return path
}

function deps(over: Record<string, unknown> = {}) {
  return {
    ensureClosed: vi.fn(async () => true),
    sessionBackup: vi.fn(async () => {}),
    now: () => NOW,
    ...TWIN_PATHS,
    ...over,
  }
}

function linkIds(path: string, playlistId: string): string[] {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return (
      db
        .prepare('SELECT ID FROM djmdSongPlaylist WHERE PlaylistID = ? ORDER BY TrackNo')
        .all(playlistId) as { ID: string }[]
    ).map((r) => r.ID)
  } finally {
    db.close()
  }
}

function playlistNamed(path: string, name: string): unknown {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return db.prepare('SELECT ID FROM djmdPlaylist WHERE Name = ?').get(name)
  } finally {
    db.close()
  }
}

const FACTORY = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']

describe('editRekordboxPlaylist', () => {
  it('adds what the collection has and reports the rest by reason', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      {
        kind: 'add',
        playlistId: '3000',
        tracks: [
          { paths: ['/Users/dj/Music/Music/Gowan.wav'] },
          { paths: ['/Volumes/Public/Music/Ekkah.wav'] },
          { paths: ['/Volumes/Public/Music/new.wav'] },
          { paths: ['/Volumes/Public/Music/Play This Song.wav'] },
        ],
      },
      deps(),
    )
    expect(result).toEqual({
      applied: true,
      report: { added: 1, already: 1, notInCollection: 1, ambiguous: 1 },
    })
    expect(linkIds(path, '3000')).toHaveLength(3)
  })

  // Closing rekordbox is a cost to the user; an add that can change nothing must not ask
  // for it, nor leave a backup behind as if something had been written.
  it('asks nothing and writes nothing when none of the tracks can be added', async () => {
    const path = await collection()
    const d = deps()
    const result = await editRekordboxPlaylist(
      path,
      { kind: 'add', playlistId: '3000', tracks: [{ paths: ['/Volumes/Public/Music/new.wav'] }] },
      d,
    )
    expect(result).toEqual({
      applied: false,
      reason: 'nothing-to-add',
      report: { added: 0, already: 0, notInCollection: 1, ambiguous: 0 },
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
    expect(existsSync(`${path}.surco-backup`)).toBe(false)
  })

  it('asks nothing for an edit whose row is already gone', async () => {
    const path = await collection()
    const d = deps()
    expect(
      await editRekordboxPlaylist(path, { ...MOVE, linkIds: ['gone'] }, d),
    ).toEqual({ applied: false, reason: 'stale' })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  // Cancel in the dialog means rekordbox stays open, and writing underneath it is exactly
  // what must never happen: nothing is applied and nothing is kept for later in 2a.
  it('applies nothing when the user keeps rekordbox open', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      MOVE,
      deps({ ensureClosed: vi.fn(async () => false) }),
    )
    expect(result).toEqual({ applied: false, reason: 'cancelled' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
    expect(existsSync(`${path}.surco-backup`)).toBe(false)
  })

  // The dialog closed rekordbox, but the user can launch it again before the write.
  it('applies nothing when rekordbox opens between the dialog and the write', async () => {
    const path = await collection()
    vi.mocked(isRekordboxRunning).mockResolvedValueOnce(true)
    expect(await editRekordboxPlaylist(path, MOVE, deps())).toEqual({
      applied: false,
      reason: 'rekordbox-running',
    })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  it('backs up the collection for the session and for this write before writing', async () => {
    const path = await collection()
    const d = deps()
    expect(await editRekordboxPlaylist(path, MOVE, d)).toEqual({ applied: true })
    expect(d.sessionBackup).toHaveBeenCalledWith(path)
    expect(linkIds(`${path}.surco-backup`, '2000')).toEqual(FACTORY)
    expect(linkIds(path, '2000')).toEqual(['f6', 'f1', 'f2', 'f3', 'f4', 'f5', 'f7'])
  })

  // No backup, no write: a session copy that cannot be made stops the edit before
  // rekordbox's file is touched.
  it('writes nothing when the session copy cannot be made', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      MOVE,
      deps({ sessionBackup: vi.fn(async () => Promise.reject(new Error('disk full'))) }),
    )
    expect(result).toEqual({ applied: false, reason: 'backup-failed' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  // The seam runs after the edit's statements, so the rollback below is undoing a real
  // change; a failure before the write would prove nothing.
  it('puts the collection back when the write dies halfway', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      MOVE,
      deps({
        onWrite: () => {
          throw new Error('disk gone')
        },
      }),
    )
    expect(result).toEqual({ applied: false, reason: 'write-failed' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  it('creates a playlist in the database and its node in the XML', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const d = deps()
    const result = await editRekordboxPlaylist(path, CREATE, d)
    expect(result.applied).toBe(true)
    const id = result.applied ? result.createdId : undefined
    expect(playlistNamed(path, 'Bolo')).toEqual({ ID: id })
    const hex = BigInt(id ?? '0').toString(16).toUpperCase()
    expect(await readFile(xmlPath, 'utf8')).toContain(
      `<NODE Id="${hex}" ParentId="0" Attribute="0" Timestamp="1792087200000" Lib_Type="0" CheckType="0"/>`,
    )
    expect(d.sessionBackup).toHaveBeenCalledWith(xmlPath)
    expect(existsSync(`${xmlPath}.surco-backup`)).toBe(true)
  })

  // The database row committed and the XML failed: rekordbox would find a playlist with no
  // node, so both go back.
  it('puts both files back when the XML cannot be written', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const before = await readFile(xmlPath, 'utf8')
    const result = await editRekordboxPlaylist(
      path,
      CREATE,
      deps({ writeXml: vi.fn(async () => Promise.reject(new Error('locked'))) }),
    )
    expect(result).toEqual({ applied: false, reason: 'write-failed' })
    expect(playlistNamed(path, 'Bolo')).toBeUndefined()
    expect(await readFile(xmlPath, 'utf8')).toBe(before)
  })

  it('leaves the XML alone for an edit of tracks', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const before = await readFile(xmlPath, 'utf8')
    await editRekordboxPlaylist(path, MOVE, deps())
    expect(await readFile(xmlPath, 'utf8')).toBe(before)
    expect(existsSync(`${xmlPath}.surco-backup`)).toBe(false)
  })

  // rekordbox keeps the collection in WAL mode: committed changes can still be in the -wal
  // file, and a copy of master.db alone would be a backup missing them.
  it('backs up changes still sitting in the WAL', async () => {
    const path = await collection({ wal: true })
    const other = new Database(path)
    other.pragma(`cipher='sqlcipher'`)
    other.pragma('legacy=4')
    other.pragma(`key='${REKORDBOX_KEY}'`)
    other
      .prepare(
        `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, created_at, updated_at)
         VALUES ('w1', '3000', '104', 3, 'x', 'x')`,
      )
      .run()
    try {
      expect(await editRekordboxPlaylist(path, MOVE, deps())).toEqual({ applied: true })
    } finally {
      other.close()
    }
    expect(linkIds(`${path}.surco-backup`, '3000')).toEqual(['h1', 'h2', 'w1'])
  })

  // A collection the process cannot write to is the user's to fix; "write failed" does not
  // say that.
  it('says the collection is read-only instead of a generic failure', async () => {
    const path = await collection()
    await chmod(path, 0o444)
    expect(await editRekordboxPlaylist(path, MOVE, deps())).toEqual({
      applied: false,
      reason: 'read-only',
    })
  })

  it('reports an unreadable collection without asking anything', async () => {
    const d = deps()
    expect(await editRekordboxPlaylist('', MOVE, d)).toEqual({ applied: false, reason: 'unreadable' })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistWrite.test.ts`
Expected: FAIL, `Cannot find module './rekordboxPlaylistWrite'`.

- [ ] **Step 3: Implement**

Create `src/main/rekordboxPlaylistWrite.ts`:

```ts
import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../shared/types'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import { hexId, playlistXmlPath, withPlaylistNode, xmlNodeIds } from './rekordboxMasterXml'
import {
  addToPlaylist,
  createNode,
  EditRefused,
  editProblem,
  insertSeparator,
  moveInPlaylist,
  playlistContents,
  randomPlaylistId,
  removeFromPlaylist,
  resolveTracks,
} from './rekordboxPlaylistEdit'
import { isRekordboxRunning } from './rekordboxProcess'

// Writes one organising edit into the user's rekordbox collection, the one library they
// cannot rebuild. Same bargain as the repoint (rekordboxLibrary.ts): the edit is planned
// on a read-only handle first, so an edit with nothing to write never asks the user to
// close rekordbox; rekordbox must be closed (asked once, then checked again right before
// the write); there is a copy for the session and one for this write before anything
// changes; the edit runs in one transaction; and any failure after the first statement
// puts every touched file back from its copy.

const BACKUP_SUFFIX = '.surco-backup'

export interface PlaylistWriteDeps extends FindOptions {
  // Asks the user to close rekordbox when it is open; false means it is still open.
  ensureClosed: () => Promise<boolean>
  // The session's one pre-edit copy (rekordboxSessionBackup.ts); throws if it cannot copy.
  sessionBackup: (path: string) => Promise<void>
  now?: () => Date
  // Seams for the tests to fail the write after it has really changed something.
  onWrite?: () => void
  writeXml?: (path: string, text: string) => Promise<void>
}

// Written beside and renamed over, so rekordbox never finds a half-written file.
async function replaceFile(path: string, text: string): Promise<void> {
  const temp = `${path}.surco-tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

// The collection is in WAL mode (measured), so committed changes can still sit in
// master.db-wal. Folding them into master.db first is what makes a copy of master.db a
// complete backup; it changes nothing rekordbox would see.
function checkpoint(collectionPath: string): void {
  const db = openRekordboxDb(collectionPath)
  if (!db) throw new Error('rekordbox collection could not be opened')
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

const isReadOnly = (err: unknown): boolean =>
  String((err as { code?: unknown })?.code).startsWith('SQLITE_READONLY')

async function restore(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await copyFile(`${path}${BACKUP_SUFFIX}`, path)
    } catch {
      // The copy stays on disk under its own name for the user to restore by hand.
    }
  }
}

function refuse(reason: RekordboxEditRefusal, report?: PlaylistAddReport): RekordboxEditResult {
  return report ? { applied: false, reason, report } : { applied: false, reason }
}

export async function editRekordboxPlaylist(
  collectionPath: string,
  edit: RekordboxPlaylistEdit,
  deps: PlaylistWriteDeps,
): Promise<RekordboxEditResult> {
  if (!collectionPath) return refuse('unreadable')

  const probe = openRekordboxDb(collectionPath, { readonly: true })
  if (!probe) return refuse('unreadable')
  let contentIds: string[] = []
  let unresolved = { notInCollection: 0, ambiguous: 0 }
  try {
    const problem = editProblem(probe, edit)
    if (problem) return refuse(problem)
    if (edit.kind === 'add') {
      const resolved = resolveTracks(probe, edit.tracks, deps)
      contentIds = resolved.contentIds
      unresolved = { notInCollection: resolved.notInCollection, ambiguous: resolved.ambiguous }
      const present = playlistContents(probe, edit.playlistId)
      const already = contentIds.filter((id) => present.has(id)).length
      if (already === contentIds.length)
        return refuse('nothing-to-add', { added: 0, already, ...unresolved })
    }
  } finally {
    probe.close()
  }

  if (!(await deps.ensureClosed())) return refuse('cancelled')

  const xmlPath = playlistXmlPath(collectionPath)
  // Only a creation touches the XML; a file rekordbox never wrote (rekordbox 5) is left
  // absent rather than invented.
  const touched = edit.kind === 'create' && existsSync(xmlPath) ? [collectionPath, xmlPath] : [collectionPath]
  try {
    checkpoint(collectionPath)
    for (const path of touched) {
      // The session's copy first: it must describe the collection before Surco's first
      // edit. Then the copy a failed write is restored from.
      await deps.sessionBackup(path)
      await copyFile(path, `${path}${BACKUP_SUFFIX}`)
    }
  } catch (err) {
    return refuse(isReadOnly(err) ? 'read-only' : 'backup-failed')
  }

  // Second check, right before the write: the user can launch rekordbox again after the
  // dialog closed it.
  if (await isRekordboxRunning()) return refuse('rekordbox-running')

  const db = openRekordboxDb(collectionPath)
  if (!db) return refuse('unreadable')
  const now = deps.now?.() ?? new Date()
  let created: { id: string; attribute: 0 | 1 } | undefined
  let counts = { added: 0, already: 0 }
  try {
    const taken = touched.includes(xmlPath) ? xmlNodeIds(await readFile(xmlPath, 'utf8')) : new Set<string>()
    const freeId = (): string => {
      for (;;) {
        const id = randomPlaylistId()
        if (!taken.has(hexId(id))) return id
      }
    }
    db.transaction(() => {
      if (edit.kind === 'add') counts = addToPlaylist(db, edit.playlistId, contentIds, { now })
      else if (edit.kind === 'move')
        moveInPlaylist(db, edit.playlistId, edit.linkIds, edit.beforeLinkId, { now })
      else if (edit.kind === 'remove') removeFromPlaylist(db, edit.playlistId, edit.linkIds, { now })
      else if (edit.kind === 'insertSeparator')
        insertSeparator(db, edit.playlistId, edit.beforeLinkId, { now })
      else created = createNode(db, edit.parentId, edit.name, edit.folder, { now, newPlaylistId: freeId })
      // After the statements, so a test can fail the write once it really changed something.
      deps.onWrite?.()
    })()
  } catch (err) {
    db.close()
    // Refused inside the transaction: it rolled back, nothing was written.
    if (err instanceof EditRefused) return refuse(err.reason)
    if (isReadOnly(err)) return refuse('read-only')
    log.warn(`rekordbox playlist edit failed: ${String(err)}`)
    await restore(touched)
    return refuse('write-failed')
  }
  db.close()

  if (created && touched.includes(xmlPath)) {
    try {
      const xml = await readFile(xmlPath, 'utf8')
      const next = withPlaylistNode(xml, {
        id: created.id,
        parentId: edit.kind === 'create' ? edit.parentId : 'root',
        attribute: created.attribute,
        timestamp: now.getTime(),
      })
      await (deps.writeXml ?? replaceFile)(xmlPath, next)
    } catch (err) {
      log.warn(`rekordbox playlist XML write failed: ${String(err)}`)
      await restore(touched)
      return refuse('write-failed')
    }
  }

  if (edit.kind === 'add') return { applied: true, report: { ...counts, ...unresolved } }
  return created ? { applied: true, createdId: created.id } : { applied: true }
}
```

- [ ] **Step 4: Run the tests**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistWrite.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

One at a time, each must turn a test red, then restore:
1. Remove the second `isRekordboxRunning()` check → "applies nothing when rekordbox opens between the dialog and the write" fails.
2. Remove `checkpoint(collectionPath)` → "backs up changes still sitting in the WAL" fails.
3. Remove `await restore(touched)` in the XML catch → "puts both files back when the XML cannot be written" fails.
4. Move `if (!(await deps.ensureClosed()))` above the probe → "asks nothing and writes nothing when none of the tracks can be added" fails.
5. Wrap `await deps.sessionBackup(path)` in its own `try { ... } catch {}` (a backup failure swallowed) → "writes nothing when the session copy cannot be made" fails.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
git add src/main/rekordboxPlaylistWrite.ts src/main/rekordboxPlaylistWrite.test.ts
git commit -m "Write one rekordbox playlist edit behind the guard, the backups and a rollback"
```

---

### Task 6: IPC, preload and the quit dialog's playlist wording

**Files:**
- Modify: `src/main/rekordboxPlaylistsIpc.ts`
- Test: `src/main/rekordboxPlaylistsIpc.test.ts`
- Modify: `src/main/index.ts` (`ensureRekordboxClosed` ~line 306, `registerRekordboxPlaylistsIpc` call ~line 847)
- Modify: `src/main/i18n.ts` (interface ~line 70, five locale blocks)
- Modify: `src/preload/api.ts` (~line 187), `src/preload/index.ts` (~line 169)
- Modify: `src/renderer/src/test/api.ts` (~line 184), `src/scenarios/harness.tsx` (~line 287)

**Interfaces:**
- Consumes: `editRekordboxPlaylist`, `PlaylistWriteDeps` (Task 5); `separatorContent` (Task 3); `serialLibraryFlush` (`libraryTagSync.ts`).
- Produces:
  - `interface PlaylistEditHost { ensureClosed: (win: BrowserWindow | null) => Promise<boolean>; sessionBackup: (path: string) => Promise<void> }`
  - `registerRekordboxPlaylistsIpc(collection: () => string, host: PlaylistEditHost): void`
  - IPC `rekordbox:edit` (edit) → `RekordboxEditResult`; `rekordbox:hasSeparator` () → `boolean`
  - `Api.editRekordboxPlaylist(edit: RekordboxPlaylistEdit): Promise<RekordboxEditResult>`, `Api.rekordboxHasSeparator(): Promise<boolean>`
  - main i18n key `rekordboxQuitDetailPlaylists`

- [ ] **Step 1: Failing tests**

In `src/main/rekordboxPlaylistsIpc.test.ts` replace the electron mock line with:

```ts
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => 'window') },
}))
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))
```

change the imports to:

```ts
import { ipcMain } from 'electron'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import {
  collectionAvailable,
  registerRekordboxPlaylistsIpc,
  withCollection,
} from './rekordboxPlaylistsIpc'
```

and append:

```ts
function handler(channel: string): (...args: unknown[]) => unknown {
  const call = [...vi.mocked(ipcMain.handle).mock.calls].reverse().find(([name]) => name === channel)
  if (!call) throw new Error(`${channel} not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerRekordboxPlaylistsIpc', () => {
  // The dialog asking to close rekordbox must sit over the window the user was dragging in.
  it('asks to close rekordbox over the window that made the edit, then writes', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const ensureClosed = vi.fn(async () => true)
    registerRekordboxPlaylistsIpc(() => path, { ensureClosed, sessionBackup: vi.fn(async () => {}) })
    const result = await handler('rekordbox:edit')(
      { sender: {} },
      { kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' },
    )
    expect(ensureClosed).toHaveBeenCalledWith('window')
    expect(result).toEqual({ applied: true })
  })

  it('says whether the collection has a separator to copy', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbipc-')), 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      sessionBackup: vi.fn(async () => {}),
    })
    expect(handler('rekordbox:hasSeparator')()).toBe(true)
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistsIpc.test.ts`
Expected: FAIL, `rekordbox:edit not registered`.

- [ ] **Step 2: Register the two channels**

Replace the imports and `registerRekordboxPlaylistsIpc` in `src/main/rekordboxPlaylistsIpc.ts`:

```ts
import { existsSync, realpathSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log/main'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { openRekordboxDb } from './rekordboxDb'
import { separatorContent } from './rekordboxPlaylistEdit'
import { readRekordboxPlaylist, readRekordboxTree } from './rekordboxPlaylists'
import { editRekordboxPlaylist } from './rekordboxPlaylistWrite'
```

```ts
export interface PlaylistEditHost {
  // The "rekordbox is open" dialog, over the window the edit came from.
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  sessionBackup: (path: string) => Promise<void>
}

// The collection path is resolved on every call, not captured once: the user can change
// the override in Settings while Surco runs.
export function registerRekordboxPlaylistsIpc(
  collection: () => string,
  host: PlaylistEditHost,
): void {
  ipcMain.handle('rekordbox:available', () => collectionAvailable(collection()))
  ipcMain.handle('rekordbox:tree', () => withCollection(collection(), readRekordboxTree, []))
  ipcMain.handle('rekordbox:playlist', (_e, id: string) =>
    withCollection(collection(), (db) => readRekordboxPlaylist(db, id), []),
  )
  ipcMain.handle('rekordbox:hasSeparator', () =>
    withCollection(collection(), (db) => separatorContent(db) !== null, false),
  )
  // Queued behind any other library write (a conversion's repoint, a review's sync): they
  // touch the same master.db.
  ipcMain.handle('rekordbox:edit', (e, edit: RekordboxPlaylistEdit) =>
    serialLibraryFlush(() =>
      editRekordboxPlaylist(collection(), edit, {
        ensureClosed: () => host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
        sessionBackup: host.sessionBackup,
        realPath: (p: string) => realpathSync(p),
      }),
    ),
  )
}
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/rekordboxPlaylistsIpc.test.ts`
Expected: PASS.

- [ ] **Step 3: The dialog's wording for playlists**

In `src/main/i18n.ts`, after `rekordboxQuitDetail: string` in the interface add `rekordboxQuitDetailPlaylists: string`, and after each locale's `rekordboxQuitDetail` value add:

- es: `rekordboxQuitDetailPlaylists: 'Surco necesita cerrarlo para guardar el cambio en tus playlists. rekordbox se cerrará de forma segura y puedes volver a abrirlo enseguida.',`
- en: `rekordboxQuitDetailPlaylists: 'Surco needs to close it to save the change to your playlists. rekordbox will be closed safely and you can reopen it right away.',`
- de: `rekordboxQuitDetailPlaylists: 'Surco muss es schließen, um die Änderung an deinen Playlists zu speichern. rekordbox wird sicher geschlossen und du kannst es gleich wieder öffnen.',`
- fr: `rekordboxQuitDetailPlaylists: 'Surco doit le fermer pour enregistrer la modification de tes playlists. rekordbox sera fermé proprement et tu pourras le rouvrir tout de suite.',`
- pt-BR: `rekordboxQuitDetailPlaylists: 'O Surco precisa fechá-lo para salvar a mudança nas suas playlists. O rekordbox será fechado com segurança e você pode reabri-lo em seguida.',`

In `src/main/index.ts`, change the signature and the detail line of `ensureRekordboxClosed`:

```ts
async function ensureRekordboxClosed(
  win: BrowserWindow | null,
  // The conversion's wording by default; a playlist edit has nothing to do with a new file.
  detail: 'rekordboxQuitDetail' | 'rekordboxQuitDetailPlaylists' = 'rekordboxQuitDetail',
): Promise<boolean> {
```

and inside it `detail: t('rekordboxQuitDetail'),` becomes `detail: t(detail),`.

Replace the registration call:

```ts
  registerRekordboxPlaylistsIpc(
    () => findRekordboxCollection({ configured: getSettings().rekordboxDbPath }),
    {
      ensureClosed: (win) => ensureRekordboxClosed(win, 'rekordboxQuitDetailPlaylists'),
      // The same per-session copy the conversion run uses: until the next run starts, it
      // holds the collection as it was before Surco's first write of the session.
      sessionBackup: (path) => sessions.rekordbox.ensure(path),
    },
  )
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/i18n.test.ts`
Expected: PASS.

- [ ] **Step 4: Preload, types and stubs**

`src/preload/api.ts`, after `loadRekordboxPlaylist` (add `RekordboxEditResult` and `RekordboxPlaylistEdit` to its type import):

```ts
  // Applies one organising edit to a rekordbox playlist. Asks to close rekordbox when it is
  // open; the result says whether the edit was written, and why not.
  editRekordboxPlaylist: (edit: RekordboxPlaylistEdit) => Promise<RekordboxEditResult>
  // Whether the collection has a separator track that can be copied into a playlist.
  rekordboxHasSeparator: () => Promise<boolean>
```

`src/preload/index.ts`, after `loadRekordboxPlaylist` (same two type imports):

```ts
  editRekordboxPlaylist: (edit: RekordboxPlaylistEdit): Promise<RekordboxEditResult> =>
    ipcRenderer.invoke('rekordbox:edit', edit),
  rekordboxHasSeparator: (): Promise<boolean> => ipcRenderer.invoke('rekordbox:hasSeparator'),
```

`src/renderer/src/test/api.ts` after `loadRekordboxPlaylist: async () => [],` and `src/scenarios/harness.tsx` after its `loadRekordboxPlaylist: async () => [],`:

```ts
    rekordboxHasSeparator: async () => false,
    editRekordboxPlaylist: async () => ({ applied: false, reason: 'unreadable' }),
```

- [ ] **Step 5: Typecheck, lint, run, commit**

Run both `tsc` commands and `biome check --write src`. Expected: clean.
Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main`
Expected: PASS.

```bash
git add src/main/rekordboxPlaylistsIpc.ts src/main/rekordboxPlaylistsIpc.test.ts src/main/index.ts src/main/i18n.ts src/preload/api.ts src/preload/index.ts src/renderer/src/test/api.ts src/scenarios/harness.tsx
git commit -m "Expose rekordbox playlist edits to the renderer with their own quit wording"
```

---

### Task 7: Send an edit from the renderer, re-read, and tell the user

**Files:**
- Create: `src/renderer/src/lib/playlistEdits.ts`
- Test: `src/renderer/src/lib/playlistEdits.test.ts`
- Create: `src/renderer/src/hooks/useRekordboxEdits.ts`
- Test: `src/renderer/src/hooks/useRekordboxEdits.test.tsx`
- Modify: `src/renderer/src/hooks/useSourceBrowser.ts`, `src/renderer/src/hooks/useSourceBrowser.test.tsx`
- Modify: `src/renderer/src/App.test.tsx` (`setApi` defaults)
- Modify: locales (`sources.edit`)

**Interfaces:**
- Consumes: `Api.editRekordboxPlaylist`, `Api.rekordboxHasSeparator` (Task 6); the types of Task 3.
- Produces:
  - `moveBefore<T>(items: readonly T[], keyOf: (item: T) => string | undefined, moving: ReadonlySet<string>, before: string | null): T[] | null` (the renderer's one copy of the move rule; null when `before` is not among the items left. Task 9's list uses it too)
  - `movedEntries(entries: SourcePlaylistEntry[], linkIds: string[], beforeLinkId: string | null): SourcePlaylistEntry[]`
  - `editMessage(tr: TFunction, edit: RekordboxPlaylistEdit, result: RekordboxEditResult, playlistName: string): { text: string; tone: 'neutral' | 'danger' } | null`
  - `useRekordboxEdits(notify: (text: string, tone: 'neutral' | 'danger') => void): (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult>`
  - `SourceBrowser.canInsertSeparator: boolean` (query key `['source-separator']`)

- [ ] **Step 1: Locale strings**

Write `$SCRATCH/i18n-task7.json` and merge it (Global Constraints helper), from `apps/desktop`:

```bash
cat > "$SCRATCH/i18n-task7.json" <<'EOF'
{
  "es": { "sources": { "edit": {
    "added_one": "{{count}} pista añadida a «{{name}}»",
    "added_other": "{{count}} pistas añadidas a «{{name}}»",
    "noneAdded": "Ninguna pista añadida a «{{name}}»",
    "already_one": "{{count}} ya estaba en la playlist",
    "already_other": "{{count}} ya estaban en la playlist",
    "notInCollection_one": "{{count}} no está en la colección de rekordbox",
    "notInCollection_other": "{{count}} no están en la colección de rekordbox",
    "ambiguous_one": "{{count}} está dos veces en la colección y no se sabe cuál usar",
    "ambiguous_other": "{{count}} están dos veces en la colección y no se sabe cuáles usar",
    "refused": {
      "cancelled": "No se cambió nada porque rekordbox sigue abierto",
      "running": "rekordbox se abrió antes de guardar y no se cambió nada",
      "unreadable": "No se pudo leer la colección de rekordbox y no se cambió nada",
      "backupFailed": "No se pudo copiar la colección antes de cambiarla y no se cambió nada",
      "writeFailed": "No se pudo guardar el cambio. La colección sigue como estaba",
      "readOnly": "La colección de rekordbox es de solo lectura y no se cambió nada",
      "stale": "La playlist cambió en rekordbox. Revísala y vuelve a intentarlo",
      "noSeparator": "Tu colección no tiene ningún separador que copiar"
    } } } },
  "en": { "sources": { "edit": {
    "added_one": "{{count}} track added to “{{name}}”",
    "added_other": "{{count}} tracks added to “{{name}}”",
    "noneAdded": "No tracks added to “{{name}}”",
    "already_one": "{{count}} was already in the playlist",
    "already_other": "{{count}} were already in the playlist",
    "notInCollection_one": "{{count}} is not in the rekordbox collection",
    "notInCollection_other": "{{count}} are not in the rekordbox collection",
    "ambiguous_one": "{{count}} is in the collection twice and Surco can't tell which to use",
    "ambiguous_other": "{{count}} are in the collection twice and Surco can't tell which to use",
    "refused": {
      "cancelled": "Nothing changed because rekordbox is still open",
      "running": "rekordbox opened before saving, so nothing changed",
      "unreadable": "Couldn't read the rekordbox collection, so nothing changed",
      "backupFailed": "Couldn't back up the collection first, so nothing changed",
      "writeFailed": "Couldn't save the change. The collection is as it was",
      "readOnly": "The rekordbox collection is read-only, so nothing changed",
      "stale": "The playlist changed in rekordbox. Check it and try again",
      "noSeparator": "Your collection has no separator to copy"
    } } } },
  "de": { "sources": { "edit": {
    "added_one": "{{count}} Titel zu „{{name}}“ hinzugefügt",
    "added_other": "{{count}} Titel zu „{{name}}“ hinzugefügt",
    "noneAdded": "Keine Titel zu „{{name}}“ hinzugefügt",
    "already_one": "{{count}} war schon in der Playlist",
    "already_other": "{{count}} waren schon in der Playlist",
    "notInCollection_one": "{{count}} ist nicht in der rekordbox-Sammlung",
    "notInCollection_other": "{{count}} sind nicht in der rekordbox-Sammlung",
    "ambiguous_one": "{{count}} ist doppelt in der Sammlung und Surco weiß nicht, welcher gilt",
    "ambiguous_other": "{{count}} sind doppelt in der Sammlung und Surco weiß nicht, welche gelten",
    "refused": {
      "cancelled": "Nichts geändert, weil rekordbox noch geöffnet ist",
      "running": "rekordbox wurde vor dem Speichern geöffnet, nichts geändert",
      "unreadable": "Die rekordbox-Sammlung konnte nicht gelesen werden, nichts geändert",
      "backupFailed": "Die Sammlung konnte vorher nicht gesichert werden, nichts geändert",
      "writeFailed": "Die Änderung konnte nicht gespeichert werden. Die Sammlung ist unverändert",
      "readOnly": "Die rekordbox-Sammlung ist schreibgeschützt, nichts geändert",
      "stale": "Die Playlist hat sich in rekordbox geändert. Prüfe sie und versuche es erneut",
      "noSeparator": "Deine Sammlung hat keinen Trenner zum Kopieren"
    } } } },
  "fr": { "sources": { "edit": {
    "added_one": "{{count}} piste ajoutée à « {{name}} »",
    "added_other": "{{count}} pistes ajoutées à « {{name}} »",
    "noneAdded": "Aucune piste ajoutée à « {{name}} »",
    "already_one": "{{count}} était déjà dans la playlist",
    "already_other": "{{count}} étaient déjà dans la playlist",
    "notInCollection_one": "{{count}} n’est pas dans la collection rekordbox",
    "notInCollection_other": "{{count}} ne sont pas dans la collection rekordbox",
    "ambiguous_one": "{{count}} est deux fois dans la collection et Surco ne sait pas laquelle utiliser",
    "ambiguous_other": "{{count}} sont deux fois dans la collection et Surco ne sait pas lesquelles utiliser",
    "refused": {
      "cancelled": "Rien n’a changé car rekordbox est encore ouvert",
      "running": "rekordbox s’est ouvert avant l’enregistrement, rien n’a changé",
      "unreadable": "Impossible de lire la collection rekordbox, rien n’a changé",
      "backupFailed": "Impossible de sauvegarder la collection avant, rien n’a changé",
      "writeFailed": "Impossible d’enregistrer la modification. La collection est restée telle quelle",
      "readOnly": "La collection rekordbox est en lecture seule, rien n’a changé",
      "stale": "La playlist a changé dans rekordbox. Vérifie-la et réessaie",
      "noSeparator": "Ta collection n’a aucun séparateur à copier"
    } } } },
  "pt-BR": { "sources": { "edit": {
    "added_one": "{{count}} faixa adicionada a “{{name}}”",
    "added_other": "{{count}} faixas adicionadas a “{{name}}”",
    "noneAdded": "Nenhuma faixa adicionada a “{{name}}”",
    "already_one": "{{count}} já estava na playlist",
    "already_other": "{{count}} já estavam na playlist",
    "notInCollection_one": "{{count}} não está na coleção do rekordbox",
    "notInCollection_other": "{{count}} não estão na coleção do rekordbox",
    "ambiguous_one": "{{count}} está duas vezes na coleção e o Surco não sabe qual usar",
    "ambiguous_other": "{{count}} estão duas vezes na coleção e o Surco não sabe quais usar",
    "refused": {
      "cancelled": "Nada mudou porque o rekordbox continua aberto",
      "running": "O rekordbox abriu antes de salvar e nada mudou",
      "unreadable": "Não foi possível ler a coleção do rekordbox e nada mudou",
      "backupFailed": "Não foi possível copiar a coleção antes e nada mudou",
      "writeFailed": "Não foi possível salvar a mudança. A coleção continua como estava",
      "readOnly": "A coleção do rekordbox é somente leitura e nada mudou",
      "stale": "A playlist mudou no rekordbox. Confira e tente de novo",
      "noSeparator": "Sua coleção não tem nenhum separador para copiar"
    } } } }
}
EOF
node "$SCRATCH/merge-locale.cjs" "$SCRATCH/i18n-task7.json"
```

- [ ] **Step 2: Failing tests for the pure helpers**

Create `src/renderer/src/lib/playlistEdits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RekordboxPlaylistEdit, SourcePlaylistEntry } from '../../../shared/types'
import i18n from '../i18n'
import { editMessage, moveBefore, movedEntries } from './playlistEdits'

const row = (linkId: string): SourcePlaylistEntry => ({
  path: `/m/${linkId}.wav`,
  separator: false,
  meta: {},
  linkId,
})
const ENTRIES = ['a', 'b', 'c', 'd'].map(row)
const tr = i18n.getFixedT('en')

describe('moveBefore', () => {
  const same = (k: string): string => k
  // The writer's rule (rekordboxPlaylistEdit.moveInPlaylist), written once for the
  // renderer: the moved items keep their own order and land right before the target, every
  // other item keeps its place.
  it('lands the moved items before the target in their own order', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], same, new Set(['d', 'b']), 'a')).toEqual([
      'b',
      'd',
      'a',
      'c',
    ])
  })

  it('lands them at the end for a null target', () => {
    expect(moveBefore(['a', 'b', 'c'], same, new Set(['a']), null)).toEqual(['b', 'c', 'a'])
  })

  it('has no answer for a target that is gone or is itself moving', () => {
    expect(moveBefore(['a', 'b'], same, new Set(['a']), 'zz')).toBeNull()
    expect(moveBefore(['a', 'b'], same, new Set(['a']), 'a')).toBeNull()
  })
})

describe('movedEntries', () => {
  // The same rule the writer applies, so the row the user dropped stays where it landed
  // while rekordbox is written, and the re-read confirms it rather than moving it.
  it('moves the rows before the target, keeping everything else in order', () => {
    expect(movedEntries(ENTRIES, ['d', 'b'], 'a').map((e) => e.linkId)).toEqual(['b', 'd', 'a', 'c'])
    expect(movedEntries(ENTRIES, ['a'], null).map((e) => e.linkId)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('leaves the order alone when the target is gone', () => {
    expect(movedEntries(ENTRIES, ['a'], 'zz')).toBe(ENTRIES)
  })
})

describe('editMessage', () => {
  const add: RekordboxPlaylistEdit = { kind: 'add', playlistId: 'h', tracks: [] }

  // An add that skips tracks without saying why reads as Surco losing them.
  it('says how many went in and why the rest did not', () => {
    expect(
      editMessage(
        tr,
        add,
        { applied: true, report: { added: 2, already: 1, notInCollection: 1, ambiguous: 1 } },
        'House',
      ),
    ).toEqual({
      text: '2 tracks added to “House”. 1 was already in the playlist. 1 is not in the rekordbox collection. 1 is in the collection twice and Surco can\'t tell which to use',
      tone: 'neutral',
    })
  })

  it('says nothing went in when nothing could', () => {
    expect(
      editMessage(
        tr,
        add,
        {
          applied: false,
          reason: 'nothing-to-add',
          report: { added: 0, already: 0, notInCollection: 3, ambiguous: 0 },
        },
        'House',
      )?.text,
    ).toBe('No tracks added to “House”. 3 are not in the rekordbox collection')
  })

  // Cancel in the dialog leaves rekordbox open; the view snaps back to the collection and
  // this is the line that says why.
  it('says nothing changed when rekordbox stayed open', () => {
    expect(
      editMessage(
        tr,
        { kind: 'remove', playlistId: 'f', linkIds: ['l1'] },
        { applied: false, reason: 'cancelled' },
        'Factory',
      ),
    ).toEqual({ text: 'Nothing changed because rekordbox is still open', tone: 'danger' })
  })

  it('stays quiet for an edit the list already shows', () => {
    expect(
      editMessage(tr, { kind: 'move', playlistId: 'f', linkIds: ['a'], beforeLinkId: null }, { applied: true }, 'F'),
    ).toBeNull()
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/playlistEdits.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/src/lib/playlistEdits.ts`:

```ts
import type { TFunction } from 'i18next'
import type {
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourcePlaylistEntry,
} from '../../../shared/types'

// The move rule of the writer (rekordboxPlaylistEdit.moveInPlaylist, which applies it in
// SQL in main), written once for the renderer: the moved items keep their order and land
// before the target, every other item keeps its place. The optimistic reorder below and
// the list's drop (TrackList) both use it, so what the list draws is what main writes.
export function moveBefore<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
  moving: ReadonlySet<string>,
  before: string | null,
): T[] | null {
  const isMoving = (item: T): boolean => {
    const key = keyOf(item)
    return key !== undefined && moving.has(key)
  }
  const moved = items.filter(isMoving)
  const rest = items.filter((item) => !isMoving(item))
  const at = before === null ? rest.length : rest.findIndex((item) => keyOf(item) === before)
  if (at === -1) return null
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)]
}

// The playlist as it will read once a move is written.
export function movedEntries(
  entries: SourcePlaylistEntry[],
  linkIds: string[],
  beforeLinkId: string | null,
): SourcePlaylistEntry[] {
  return moveBefore(entries, (e) => e.linkId, new Set(linkIds), beforeLinkId) ?? entries
}

const REFUSED: Record<Exclude<RekordboxEditRefusal, 'nothing-to-add'>, string> = {
  cancelled: 'sources.edit.refused.cancelled',
  'rekordbox-running': 'sources.edit.refused.running',
  unreadable: 'sources.edit.refused.unreadable',
  'backup-failed': 'sources.edit.refused.backupFailed',
  'write-failed': 'sources.edit.refused.writeFailed',
  'read-only': 'sources.edit.refused.readOnly',
  stale: 'sources.edit.refused.stale',
  'no-separator': 'sources.edit.refused.noSeparator',
}

// The line the user reads after an edit, or null when the list itself already shows what
// happened. An add always reports, because tracks it could not add vanish from the gesture
// with no other trace.
export function editMessage(
  tr: TFunction,
  edit: RekordboxPlaylistEdit,
  result: RekordboxEditResult,
  playlistName: string,
): { text: string; tone: 'neutral' | 'danger' } | null {
  if (!result.applied && result.reason !== 'nothing-to-add')
    return { text: tr(REFUSED[result.reason]), tone: 'danger' }
  if (edit.kind !== 'add' || !result.report) return null
  const r = result.report
  const parts = [
    r.added > 0
      ? tr('sources.edit.added', { count: r.added, name: playlistName })
      : tr('sources.edit.noneAdded', { name: playlistName }),
  ]
  if (r.already > 0) parts.push(tr('sources.edit.already', { count: r.already }))
  if (r.notInCollection > 0)
    parts.push(tr('sources.edit.notInCollection', { count: r.notInCollection }))
  if (r.ambiguous > 0) parts.push(tr('sources.edit.ambiguous', { count: r.ambiguous }))
  return { text: parts.join('. '), tone: 'neutral' }
}
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/playlistEdits.test.ts`
Expected: PASS.

- [ ] **Step 4: Failing test for the hook**

Create `src/renderer/src/hooks/useRekordboxEdits.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RekordboxEditResult, SourcePlaylistEntry } from '../../../shared/types'
import '../i18n'
import { useRekordboxEdits } from './useRekordboxEdits'

afterEach(cleanup)

const row = (linkId: string): SourcePlaylistEntry => ({
  path: `/m/${linkId}.wav`,
  separator: false,
  meta: {},
  linkId,
})
const ORDER = [row('a'), row('b'), row('c')]

function setup(answer: Promise<RekordboxEditResult>) {
  const loadRekordboxPlaylist = vi.fn().mockResolvedValue(ORDER)
  ;(window as unknown as { api: unknown }).api = {
    loadRekordboxPlaylist,
    editRekordboxPlaylist: vi.fn(() => answer),
  }
  const notify = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => ({
      edit: useRekordboxEdits(notify),
      entries: useQuery({
        queryKey: ['source-playlist', 'rekordbox', 'f'],
        queryFn: () => window.api.loadRekordboxPlaylist('f'),
        staleTime: Number.POSITIVE_INFINITY,
      }).data,
    }),
    { wrapper },
  )
  return { ...hook, notify, loadRekordboxPlaylist }
}

describe('useRekordboxEdits', () => {
  // The dragged row must not snap back while rekordbox is written; if the write is refused,
  // the re-read puts the collection's real order back and the notice says why.
  it('shows a move at once and returns to the real order when it is refused', async () => {
    let refuse: (r: RekordboxEditResult) => void = () => {}
    const { result, notify, loadRekordboxPlaylist } = setup(
      new Promise((resolve) => {
        refuse = resolve
      }),
    )
    await waitFor(() => expect(result.current.entries).toHaveLength(3))
    let done: Promise<RekordboxEditResult> = Promise.resolve({ applied: true })
    act(() => {
      done = result.current.edit(
        { kind: 'move', playlistId: 'f', linkIds: ['c'], beforeLinkId: 'a' },
        'Factory',
      )
    })
    await waitFor(() => expect(result.current.entries?.map((e) => e.linkId)).toEqual(['c', 'a', 'b']))
    await act(async () => {
      refuse({ applied: false, reason: 'cancelled' })
      await done
    })
    expect(loadRekordboxPlaylist).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.entries?.map((e) => e.linkId)).toEqual(['a', 'b', 'c']))
    expect(notify).toHaveBeenCalledWith('Nothing changed because rekordbox is still open', 'danger')
  })

  it('reports an add by what it did with each track', async () => {
    const { result, notify } = setup(
      Promise.resolve({
        applied: true,
        report: { added: 1, already: 0, notInCollection: 1, ambiguous: 0 },
      }),
    )
    await act(async () => {
      await result.current.edit({ kind: 'add', playlistId: 'h', tracks: [] }, 'House')
    })
    expect(notify).toHaveBeenCalledWith(
      '1 track added to “House”. 1 is not in the rekordbox collection',
      'neutral',
    )
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useRekordboxEdits.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement the hook**

Create `src/renderer/src/hooks/useRekordboxEdits.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourcePlaylistEntry,
} from '../../../shared/types'
import { editMessage, movedEntries } from '../lib/playlistEdits'

// Sends one edit to rekordbox and then re-reads what rekordbox holds: the collection is the
// only truth, so the tree, the open playlist and the separator check are fetched again
// whatever the answer. Only a move is drawn before the answer (the dragged row must not
// snap back during the write); the re-read corrects it if the write was refused.
export function useRekordboxEdits(
  notify: (text: string, tone: 'neutral' | 'danger') => void,
): (edit: RekordboxPlaylistEdit, playlistName: string) => Promise<RekordboxEditResult> {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  return useCallback(
    async (edit, playlistName) => {
      if (edit.kind === 'move')
        queryClient.setQueryData<SourcePlaylistEntry[]>(
          ['source-playlist', 'rekordbox', edit.playlistId],
          (prev) => prev && movedEntries(prev, edit.linkIds, edit.beforeLinkId),
        )
      let result: RekordboxEditResult
      try {
        result = await window.api.editRekordboxPlaylist(edit)
      } catch {
        result = { applied: false, reason: 'write-failed' }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['source-tree'] }),
        queryClient.invalidateQueries({ queryKey: ['source-playlist'] }),
        queryClient.invalidateQueries({ queryKey: ['source-separator'] }),
      ])
      const message = editMessage(tr, edit, result, playlistName)
      if (message) notify(message.text, message.tone)
      return result
    },
    [queryClient, tr, notify],
  )
}
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useRekordboxEdits.test.tsx`
Expected: PASS.

- [ ] **Step 6: The separator check in the browser hook**

Failing test, appended in `src/renderer/src/hooks/useSourceBrowser.test.tsx` (inside the describe):

```ts
  // "Insert separator" copies the collection's own separator; with none, the menu item says
  // so instead of failing after the user picked it.
  it('knows whether rekordbox has a separator to copy', async () => {
    const { result } = setup({ rekordboxHasSeparator: vi.fn().mockResolvedValue(true) })
    expect(result.current.canInsertSeparator).toBe(false)
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.canInsertSeparator).toBe(true))
  })
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useSourceBrowser.test.tsx`
Expected: FAIL (`canInsertSeparator` undefined).

In `src/renderer/src/hooks/useSourceBrowser.ts`:
- `SourceBrowser` gains `canInsertSeparator: boolean` (after `entries`).
- After the `entries` query add:

```ts
  const separator = useQuery({
    queryKey: ['source-separator'],
    queryFn: () => window.api.rekordboxHasSeparator(),
    enabled: source === 'rekordbox',
    staleTime: Number.POSITIVE_INFINITY,
  })
```

- In the focus handler add `queryClient.invalidateQueries({ queryKey: ['source-separator'] })`.
- In the returned object add `canInsertSeparator: separator.data ?? false,` after `entries: entries.data,`.

In `src/renderer/src/App.test.tsx` `setApi`, after `rekordboxAvailable: ...`, add:

```ts
    rekordboxHasSeparator: vi.fn<Api['rekordboxHasSeparator']>().mockResolvedValue(true),
    editRekordboxPlaylist: vi
      .fn<Api['editRekordboxPlaylist']>()
      .mockResolvedValue({ applied: true }),
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks src/renderer/src/lib/playlistEdits.test.ts src/renderer/src/i18n`
Expected: PASS, `usedKeys.test.ts` included (every `sources.edit` key is referenced in `playlistEdits.ts`). If `usedKeys` flags a key, its name in the JSON does not match the code: fix the JSON.

- [ ] **Step 7: Typecheck, lint, commit**

Run the two `tsc` commands and `biome check --write src` from Global Constraints. Expected: clean.

```bash
git add src/renderer/src/lib/playlistEdits.ts src/renderer/src/lib/playlistEdits.test.ts src/renderer/src/hooks/useRekordboxEdits.ts src/renderer/src/hooks/useRekordboxEdits.test.tsx src/renderer/src/hooks/useSourceBrowser.ts src/renderer/src/hooks/useSourceBrowser.test.tsx src/renderer/src/App.test.tsx src/renderer/src/i18n/locales
git commit -m "Send rekordbox playlist edits from the renderer and report what they did"
```

---

### Task 8: Create, name and drop onto playlists in the tree

**Files:**
- Create: `src/renderer/src/lib/reorderDrag.ts` (the dragged-rows holder; Task 9 adds the reorder type to it)
- Test: `src/renderer/src/lib/reorderDrag.test.ts`
- Create: `src/renderer/src/test/drag.ts` (the one DragEvent polyfill and fake DataTransfer every drag test uses)
- Modify: `src/renderer/src/components/SourceTree.tsx`
- Test: `src/renderer/src/components/SourceTree.test.tsx`
- Modify: locales (`sources.tree`)

**Interfaces:**
- Consumes: `SourceNode` (phase 1).
- Produces:
  - `setDraggedRows(ids: string[]): void`, `draggedRows(): string[] | null`, `clearDraggedRows(): void` in `lib/reorderDrag.ts`: the track ids a drag out of the list carries, recorded at its start (Task 9) and read by the tree's drop (Task 10), so dropping rows on the tree does not depend on the native drag delivering files to Surco's own window (Q5)
  - `installDragEvent(): void`, `fakeDataTransfer(files?: File[])` in `src/renderer/src/test/drag.ts`
  - `SourceTree` prop `edit?: { onCreate: (parentId: string, name: string, folder: boolean) => void; onDropTracks: (node: SourceNode, files: File[]) => void }` (`files` is empty when the drag carried list rows and no files)
  - `export function flattenPlaylists(nodes: SourceNode[], folders?: string[]): { node: SourceNode; folders: string[] }[]` (the phase 1 `flatten`, renamed and exported)
  - testids: `source-tree-new-playlist`, `source-tree-new-folder`, `source-tree-name`, `source-tree-menu`, `source-tree-new-playlist-inside`, `source-tree-new-folder-inside`, `source-drop-count`; attribute `data-drop-target` on the hovered playlist

- [ ] **Step 1: Locale strings**

```bash
cat > "$SCRATCH/i18n-task8.json" <<'EOF'
{
  "es": { "sources": { "tree": { "newPlaylist": "Nueva playlist", "newFolder": "Nueva carpeta", "newPlaylistInside": "Nueva playlist dentro", "newFolderInside": "Nueva carpeta dentro", "name": "Nombre", "dropCount": "+{{count}} al soltar", "folderMenu": "Acciones de la carpeta" } } },
  "en": { "sources": { "tree": { "newPlaylist": "New playlist", "newFolder": "New folder", "newPlaylistInside": "New playlist inside", "newFolderInside": "New folder inside", "name": "Name", "dropCount": "+{{count}} on drop", "folderMenu": "Folder actions" } } },
  "de": { "sources": { "tree": { "newPlaylist": "Neue Playlist", "newFolder": "Neuer Ordner", "newPlaylistInside": "Neue Playlist darin", "newFolderInside": "Neuer Ordner darin", "name": "Name", "dropCount": "+{{count}} beim Loslassen", "folderMenu": "Ordneraktionen" } } },
  "fr": { "sources": { "tree": { "newPlaylist": "Nouvelle playlist", "newFolder": "Nouveau dossier", "newPlaylistInside": "Nouvelle playlist dedans", "newFolderInside": "Nouveau dossier dedans", "name": "Nom", "dropCount": "+{{count}} au lâcher", "folderMenu": "Actions du dossier" } } },
  "pt-BR": { "sources": { "tree": { "newPlaylist": "Nova playlist", "newFolder": "Nova pasta", "newPlaylistInside": "Nova playlist dentro", "newFolderInside": "Nova pasta dentro", "name": "Nome", "dropCount": "+{{count}} ao soltar", "folderMenu": "Ações da pasta" } } }
}
EOF
node "$SCRATCH/merge-locale.cjs" "$SCRATCH/i18n-task8.json"
```

- [ ] **Step 2: The shared drag test utility and the holder**

Create `src/renderer/src/test/drag.ts`:

```ts
// jsdom has no DragEvent, and a drag event built as a plain Event drops its pointer
// position, which is what decides above or below a row. Call in beforeAll.
export function installDragEvent(): void {
  if (!('DragEvent' in window)) Object.assign(window, { DragEvent: class extends MouseEvent {} })
}

// What fireEvent needs as a drag's dataTransfer. setData records its type the way a browser
// does; files arrive under the 'Files' type, as a drop from Finder does.
export function fakeDataTransfer(files: File[] = []) {
  const data: Record<string, string> = {}
  return {
    effectAllowed: '',
    types: (files.length ? ['Files'] : []) as string[],
    files,
    items: { length: files.length },
    setData(type: string, value: string) {
      data[type] = value
      this.types.push(type)
    },
    getData: (type: string) => data[type] ?? '',
  }
}
```

Failing test, `src/renderer/src/lib/reorderDrag.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearDraggedRows, draggedRows, setDraggedRows } from './reorderDrag'

afterEach(clearDraggedRows)

describe('dragged rows', () => {
  // The tree learns what the list is dragging from here, not from the files the OS drag
  // may or may not bring back into Surco's own window.
  it('holds the rows of the drag in progress until it is cleared', () => {
    expect(draggedRows()).toBeNull()
    setDraggedRows(['a', 'b'])
    expect(draggedRows()).toEqual(['a', 'b'])
    clearDraggedRows()
    expect(draggedRows()).toBeNull()
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/reorderDrag.test.ts`
Expected: FAIL, module not found. Create `src/renderer/src/lib/reorderDrag.ts`:

```ts
// The rows a drag out of the list carries, recorded by the list when the drag starts. That
// drag hands the OS the files (so a row lands in Spek or Finder), and whether the OS then
// also delivers them as files to Surco's own window is not something to build on: the tree
// reads the rows from here instead. Module state, because the list and the tree share no
// component, and a drag is one at a time.
let draggedRowIds: string[] | null = null

export function setDraggedRows(ids: string[]): void {
  draggedRowIds = ids
}

export function draggedRows(): string[] | null {
  return draggedRowIds
}

export function clearDraggedRows(): void {
  draggedRowIds = null
}
```

Run it again. Expected: PASS.

- [ ] **Step 3: Failing tests for the tree**

In `src/renderer/src/components/SourceTree.test.tsx`, replace `setup` with:

```tsx
function setup(selectedId: string | null = null, editable = false) {
  const onSelect = vi.fn()
  const edit = { onCreate: vi.fn(), onDropTracks: vi.fn() }
  const onOuterDrop = vi.fn()
  render(
    // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the window's own file drop
    <div onDrop={onOuterDrop}>
      <SourceTree
        title="rekordbox"
        source="rekordbox"
        nodes={NODES}
        failed={false}
        selectedId={selectedId}
        onSelect={onSelect}
        edit={editable ? edit : undefined}
      />
    </div>,
  )
  return Object.assign(onSelect, { edit, onOuterDrop })
}

const files = (...names: string[]) => fakeDataTransfer(names.map((n) => new File([''], n)))
```

add to its imports `import { clearDraggedRows, setDraggedRows } from '../lib/reorderDrag'` and `import { fakeDataTransfer } from '../test/drag'`, and `afterEach(clearDraggedRows)` under `afterEach(cleanup)`.

and append:

```tsx
describe('SourceTree organising', () => {
  it('creates a playlist at the root, named right in the tree', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bolo' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    expect(edit.onCreate).toHaveBeenCalledWith('root', 'Bolo', false)
    expect(screen.queryByTestId('source-tree-name')).not.toBeInTheDocument()
  })

  it('creates a folder inside a folder from its menu, opening it to show where', () => {
    const { edit } = setup(null, true)
    fireEvent.contextMenu(screen.getByTestId('source-node-bases'))
    fireEvent.click(screen.getByTestId('source-tree-new-folder-inside'))
    expect(screen.getByTestId('source-node-bt')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Fijas' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    expect(edit.onCreate).toHaveBeenCalledWith('bases', 'Fijas', true)
  })

  it('creates nothing for an empty name, and Escape gives up', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-folder'))
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    fireEvent.click(screen.getByTestId('source-tree-new-folder'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Escape' })
    expect(edit.onCreate).not.toHaveBeenCalled()
  })

  // Finder's rule: clicking away keeps what was typed, and an empty name is no playlist.
  it('creates with the typed name when the field loses focus, and nothing when it is empty', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bolo' } })
    fireEvent.blur(screen.getByTestId('source-tree-name'))
    expect(edit.onCreate).toHaveBeenCalledWith('root', 'Bolo', false)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.blur(screen.getByTestId('source-tree-name'))
    expect(edit.onCreate).toHaveBeenCalledTimes(1)
  })

  it('lights a playlist under a file drag and says how many will land in it', () => {
    const { edit } = setup(null, true)
    const house = screen.getByTestId('source-node-house')
    const dt = files('a.wav', 'b.wav')
    fireEvent.dragOver(house, { dataTransfer: dt })
    expect(house).toHaveAttribute('data-drop-target')
    expect(screen.getByTestId('source-drop-count')).toHaveTextContent('+2 on drop')
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(NODES[2], dt.files)
    expect(house).not.toHaveAttribute('data-drop-target')
  })

  // Rows dragged out of the list are known from the holder; the drop must take them even
  // when the OS drag brings no files into Surco's own window.
  it('takes rows dragged from the list when no files arrive', () => {
    const { edit } = setup(null, true)
    setDraggedRows(['a', 'b', 'c'])
    const house = screen.getByTestId('source-node-house')
    const dt = fakeDataTransfer()
    fireEvent.dragOver(house, { dataTransfer: dt })
    expect(screen.getByTestId('source-drop-count')).toHaveTextContent('+3 on drop')
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(NODES[2], [])
  })

  // A folder holds playlists, not tracks; a drop there must neither write anything nor
  // fall through to the window, which would import the files into the list.
  it('takes no drop on a folder and keeps it from reaching the window import', () => {
    const { edit, onOuterDrop } = setup(null, true)
    const bases = screen.getByTestId('source-node-bases')
    const dt = files('a.wav')
    fireEvent.dragOver(bases, { dataTransfer: dt })
    expect(bases).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(bases, { dataTransfer: dt })
    expect(edit.onDropTracks).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })

  it('offers no editing where the source is read-only', () => {
    setup()
    expect(screen.queryByTestId('source-tree-new-playlist')).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('source-node-bases'))
    expect(screen.queryByTestId('source-tree-menu')).not.toBeInTheDocument()
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/SourceTree.test.tsx`
Expected: FAIL on the new describe (no `source-tree-new-playlist`).

- [ ] **Step 4: Implement**

In `src/renderer/src/components/SourceTree.tsx`:

Imports become:

```tsx
import { ChevronDown, ChevronRight, FolderPlus, ListPlus, Search } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
```

Rename `function flatten(` to `export function flattenPlaylists(` and its two uses (`flatten(n.children ?? [], ...)` inside it and `flatten(nodes)` in `hits`).

Props: add after `onSelect`:

```tsx
  // Organising, offered only where the source can be written (rekordbox): creating playlists
  // and folders, and taking tracks dropped on a playlist (rows dragged from the list, known
  // from lib/reorderDrag, or files from Finder). Without it the tree only browses.
  edit?: {
    onCreate: (parentId: string, name: string, folder: boolean) => void
    onDropTracks: (node: SourceNode, files: File[]) => void
  }
```

and `edit,` to the destructured props, and `import { draggedRows } from '../lib/reorderDrag'` to the imports. After the `toggle` function add:

```tsx
  // The name field for a playlist or folder being created, and where it goes. Enter and
  // leaving the field both keep the name (Finder's rule); Escape and an empty name drop it.
  const [creating, setCreating] = useState<{ parentId: string; folder: boolean } | null>(null)
  const startCreating = (parentId: string, folder: boolean): void =>
    setCreating({ parentId, folder })
  const commit = (value: string): void => {
    setCreating(null)
    const name = value.trim()
    if (creating && name) edit?.onCreate(creating.parentId, name, creating.folder)
  }
  const cancel = (): void => setCreating(null)
  const focusField = useCallback((el: HTMLInputElement | null) => el?.focus(), [])
  const [menu, setMenu] = useState<{ node: SourceNode; x: number; y: number } | null>(null)
  const createInside = (node: SourceNode, folder: boolean): void => {
    setMenu(null)
    setOpened((prev) => new Set([...prev, node.id]))
    startCreating(node.id, folder)
  }
  // Which playlist a drag of tracks is over, and how many it carries: the list's own rows
  // when a drag from the list is in progress, otherwise the files of a drag from Finder.
  const [dropOn, setDropOn] = useState<{ id: string; count: number } | null>(null)
  const carriesTracks = (e: React.DragEvent): boolean =>
    draggedRows() !== null || e.dataTransfer.types.includes('Files')

  const nameField = (parentId: string, depth: number): React.ReactNode =>
    creating?.parentId === parentId && (
      <li key="creating" style={{ paddingLeft: 10 + depth * 18 }} className="pr-2.5">
        <input
          ref={focusField}
          data-testid="source-tree-name"
          aria-label={tr('sources.tree.name')}
          placeholder={tr('sources.tree.name')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
            if (e.key === 'Escape') cancel()
          }}
          onBlur={(e) => commit(e.currentTarget.value)}
          className="h-[27px] w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-field)] px-2 text-[11.5px] outline-none"
        />
      </li>
    )
```

In `row`, the `<button>` gains these props (after `onClick`):

```tsx
          onContextMenu={(e) => {
            if (!edit || !isFolder) return
            e.preventDefault()
            setMenu({ node, x: e.clientX, y: e.clientY })
          }}
          data-drop-target={dropOn?.id === node.id || undefined}
          onDragOver={(e) => {
            if (!edit || isFolder || !carriesTracks(e)) return
            e.preventDefault()
            setDropOn({ id: node.id, count: draggedRows()?.length ?? e.dataTransfer.items.length })
          }}
          onDragLeave={() => setDropOn((d) => (d?.id === node.id ? null : d))}
          onDrop={(e) => {
            if (!edit || isFolder || !carriesTracks(e)) return
            e.preventDefault()
            e.stopPropagation()
            setDropOn(null)
            edit.onDropTracks(node, Array.from(e.dataTransfer.files))
          }}
```

its className template gains `${dropOn?.id === node.id ? 'outline-dashed outline-1 -outline-offset-1 outline-[var(--color-accent)]' : ''}` at the end, and the count span becomes:

```tsx
          {dropOn?.id === node.id ? (
            <span data-testid="source-drop-count" className="ml-auto text-[11px] text-[var(--color-accent)]">
              {tr('sources.tree.dropCount', { count: dropOn.count })}
            </span>
          ) : (
            <span className="ml-auto text-[11px] tabular-nums text-fg-faint">{node.count}</span>
          )}
```

The folder's children list becomes:

```tsx
        {isFolder && open && (
          <ul>
            {(node.children ?? []).map((c) => row(c, depth + 1, [...folders, node.name]))}
            {nameField(node.id, depth + 1)}
          </ul>
        )}
```

and the root body `else body = <ul>{nodes.map((n) => row(n, 0, []))}</ul>` becomes `else body = (<ul>{nodes.map((n) => row(n, 0, []))}{nameField('root', 0)}</ul>)`. The `nodes.length === 0` branch becomes `else if (nodes.length === 0 && !creating)` so a first playlist can be named in an empty collection.

The returned JSX: the title `div` becomes

```tsx
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <span className="font-semibold">{title}</span>
        {edit && (
          <span className="ml-auto flex gap-0.5">
            <button
              type="button"
              data-testid="source-tree-new-playlist"
              aria-label={tr('sources.tree.newPlaylist')}
              onClick={() => startCreating('root', false)}
              className="rounded p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
            >
              <ListPlus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="source-tree-new-folder"
              aria-label={tr('sources.tree.newFolder')}
              onClick={() => startCreating('root', true)}
              className="rounded p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
            >
              <FolderPlus size={14} aria-hidden="true" />
            </button>
          </span>
        )}
      </div>
```

the scroll `div` becomes

```tsx
      {/* biome-ignore lint/a11y/noStaticElementInteractions: swallows drops that miss a playlist; nothing to operate here */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2"
        onDrop={(e) => {
          // A drop that misses a playlist (a folder, the gaps) must not fall through to the
          // window, whose drop imports the files into the list.
          if (!edit) return
          e.preventDefault()
          e.stopPropagation()
          setDropOn(null)
        }}
      >
        {body}
      </div>
      {menu && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={tr('common.close')}
            onClick={() => setMenu(null)}
            className="absolute inset-0"
          />
          <div
            ref={(el) => el?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()}
            role="menu"
            aria-label={tr('sources.tree.folderMenu')}
            data-testid="source-tree-menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMenu(null)
            }}
            style={{ top: menu.y, left: menu.x }}
            className="absolute min-w-[190px] rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="source-tree-new-playlist-inside"
              onClick={() => createInside(menu.node, false)}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
            >
              {tr('sources.tree.newPlaylistInside')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="source-tree-new-folder-inside"
              onClick={() => createInside(menu.node, true)}
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
            >
              {tr('sources.tree.newFolderInside')}
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Run, lint, commit**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/SourceTree.test.tsx src/renderer/src/lib/reorderDrag.test.ts src/renderer/src/i18n`
Expected: PASS. (`usedKeys` passes once Task 8's keys are all referenced, which they are above.)
Run `tsc` (web) and `biome check --write src`.

```bash
git add src/renderer/src/lib/reorderDrag.ts src/renderer/src/lib/reorderDrag.test.ts src/renderer/src/test/drag.ts src/renderer/src/components/SourceTree.tsx src/renderer/src/components/SourceTree.test.tsx src/renderer/src/i18n/locales
git commit -m "Create playlists and folders and take dropped tracks in the rekordbox tree"
```

---

### Task 9: Reorder by hand: per-link separators, grips and the insertion line

**Files:**
- Modify: `src/renderer/src/lib/reorderDrag.ts` (Task 8 created it with the dragged-rows holder)
- Modify: `src/renderer/src/lib/playlistView.ts`, `src/renderer/src/lib/playlistView.test.ts`
- Modify: `src/renderer/src/components/TrackList.tsx`, `src/renderer/src/components/TrackList.test.tsx`
- Modify: `src/renderer/src/App.tsx` (only the `<TrackList>` props: `separatorBefore` now passes a Map, and `trailingSeparators` is added)
- Modify: locales (`sources.reorder.removeSeparator`)

**Interfaces:**
- Consumes: `SourcePlaylistEntry.linkId/contentId` (Task 2); `moveBefore` (Task 7); `setDraggedRows`, `clearDraggedRows`, `installDragEvent`, `fakeDataTransfer` (Task 8).
- Produces:
  - `REORDER_TYPE = 'application/x-surco-reorder'`, `isReorderDrag(e: { dataTransfer?: DataTransfer | null }): boolean`
  - `playlistView(tracks, entries): PlaylistScope` with `interface PlaylistScope { tracks: TrackItem[]; separatorBefore: ReadonlyMap<string, readonly string[]>; trailingSeparators: readonly string[]; linkOf: ReadonlyMap<string, string>; contentOf: ReadonlyMap<string, string> }` (separator key = its `linkId`, or `sep-<index>` without one)
  - `TrackList` props: `separatorBefore?: ReadonlyMap<string, readonly string[]>`, `trailingSeparators?: readonly string[]`, `reorder?: { onMove: (keys: string[], beforeKey: string | null) => void; onRemoveSeparator: (key: string) => void }`
  - testids: `track-drag-<id>` on every row wrapper (the element that carries the drag), `track-grip-<key>`, `reorder-line`, `track-separator-<key>`, `separator-remove-<key>`; the attribute `data-reorder-key` on wrappers and separator lines is for the list's own drop logic, never for tests
  - a drag-out records the dragged track ids with `setDraggedRows`; the list clears them on the window's `dragend` and on the next `pointerdown`, and drops a pressed grip on the window's `mouseup`

- [ ] **Step 1: Locale string**

```bash
cat > "$SCRATCH/i18n-task9.json" <<'EOF'
{
  "es": { "sources": { "reorder": { "removeSeparator": "Quitar separador" } } },
  "en": { "sources": { "reorder": { "removeSeparator": "Remove separator" } } },
  "de": { "sources": { "reorder": { "removeSeparator": "Trenner entfernen" } } },
  "fr": { "sources": { "reorder": { "removeSeparator": "Retirer le séparateur" } } },
  "pt-BR": { "sources": { "reorder": { "removeSeparator": "Remover separador" } } }
}
EOF
node "$SCRATCH/merge-locale.cjs" "$SCRATCH/i18n-task9.json"
```

- [ ] **Step 2: Failing tests for the view**

In `src/renderer/src/lib/playlistView.test.ts`, change `entry` to carry ids:

```ts
function entry(path: string | null, separator = false, linkId?: string): SourcePlaylistEntry {
  return { path, separator, meta: {}, linkId, contentId: linkId && `c-${linkId}` }
}
```

replace the test `'marks the track after each separator, so the list can draw the break'` with:

```ts
  it('marks the track after each separator, so the list can draw the break', () => {
    const view = playlistView(
      [A, B],
      [entry('/m/A.wav', false, 'l1'), entry(SEP, true, 's1'), entry('/m/B.wav', false, 'l2')],
    )
    expect([...view.separatorBefore]).toEqual([['b', ['s1']]])
  })
```

and replace the test `'collapses runs of separators and drops a trailing one: a break is a break'` (its whole `it(...)` block) with:

```ts
  // Separators can be moved and removed now; one hidden in a collapsed run, or one after the
  // last row, could never be reached. Each stays its own line.
  it('keeps every separator as its own line, side by side and after the last row', () => {
    const view = playlistView(
      [A, B],
      [
        entry(SEP, true, 's0'),
        entry('/m/A.wav', false, 'l1'),
        entry(SEP, true, 's1'),
        entry(SEP, true, 's2'),
        entry('/m/B.wav', false, 'l2'),
        entry(SEP, true, 's3'),
      ],
    )
    expect(Object.fromEntries(view.separatorBefore)).toEqual({ a: ['s0'], b: ['s1', 's2'] })
    expect(view.trailingSeparators).toEqual(['s3'])
  })

  // A track shown once stands for its first row in the playlist: that is the row a drag
  // moves, and the entry another playlist links to when it is copied.
  it('gives each shown track the link of its first row and its collection entry', () => {
    const view = playlistView(
      [A, B],
      [entry('/m/A.wav', false, 'l1'), entry('/m/B.wav', false, 'l2'), entry('/m/A.wav', false, 'l3')],
    )
    expect(Object.fromEntries(view.linkOf)).toEqual({ a: 'l1', b: 'l2' })
    expect(Object.fromEntries(view.contentOf)).toEqual({ a: 'c-l1', b: 'c-l2' })
  })

  // A separator before a row Surco does not show (a missing file) still breaks the set; it
  // is drawn above the next row that is shown.
  it('carries a separator over a row the list does not show', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry(SEP, true, 's1'),
        entry('/m/gone.wav', false, 'l2'),
        entry('/m/B.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.separatorBefore)).toEqual({ b: ['s1'] })
  })
```

Any other test in the file that reads `view.separatorBefore` as a Set: change `[...view.separatorBefore]` to `[...view.separatorBefore.keys()]`.

Replace the phase 1 test `'is empty for a playlist of only separators, with no orphan break'` (its name no longer holds: those separators are now kept) with:

```ts
  // No row to draw a break above, but the separators are still the playlist's: they stay as
  // trailing lines so they can be dragged or removed.
  it('shows no rows for a playlist of only separators, keeping them as trailing lines', () => {
    const view = playlistView([A], [entry(SEP, true, 's1'), entry(SEP, true, 's2')])
    expect(view.tracks).toEqual([])
    expect(view.separatorBefore.size).toBe(0)
    expect(view.trailingSeparators).toEqual(['s1', 's2'])
  })
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/playlistView.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the view**

In `src/renderer/src/lib/playlistView.ts` replace `playlistView` (keep the header comment, add the paragraph below to it):

```ts
// Separators are kept one by one, each under its own key (its playlist row), so each can be
// dragged and removed; one in a run or after the last row is not folded away. Each shown
// track also knows its first row in the playlist and its collection entry: a drag moves
// that row, a copy links that entry.
export interface PlaylistScope {
  tracks: TrackItem[]
  separatorBefore: ReadonlyMap<string, readonly string[]>
  trailingSeparators: readonly string[]
  linkOf: ReadonlyMap<string, string>
  contentOf: ReadonlyMap<string, string>
}

export function playlistView(tracks: TrackItem[], entries: SourcePlaylistEntry[]): PlaylistScope {
  const byPath = new Map<string, TrackItem>()
  for (const t of tracks) if (t.outputPath) byPath.set(t.outputPath.normalize('NFC'), t)
  for (const t of tracks) byPath.set(t.inputPath.normalize('NFC'), t)
  const shown: TrackItem[] = []
  const seen = new Set<string>()
  const separatorBefore = new Map<string, string[]>()
  const linkOf = new Map<string, string>()
  const contentOf = new Map<string, string>()
  let pending: string[] = []
  entries.forEach((e, i) => {
    if (e.separator) {
      pending.push(e.linkId ?? `sep-${i}`)
      return
    }
    const t = e.path ? byPath.get(e.path.normalize('NFC')) : undefined
    if (!t || seen.has(t.id)) return
    seen.add(t.id)
    shown.push(t)
    if (e.linkId) linkOf.set(t.id, e.linkId)
    if (e.contentId) contentOf.set(t.id, e.contentId)
    if (pending.length) separatorBefore.set(t.id, pending)
    pending = []
  })
  return { tracks: shown, separatorBefore, trailingSeparators: pending, linkOf, contentOf }
}
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/playlistView.test.ts`
Expected: PASS.

- [ ] **Step 4: The drag type**

Append to `src/renderer/src/lib/reorderDrag.ts`:

```ts
// A drag that reorders the open playlist inside the list. It carries this type instead of
// files, so the window's import does not treat it as files arriving and the tree does not
// take it as tracks to add.
export const REORDER_TYPE = 'application/x-surco-reorder'

export function isReorderDrag(e: { dataTransfer?: DataTransfer | null }): boolean {
  return e.dataTransfer?.types?.includes(REORDER_TYPE) ?? false
}
```

- [ ] **Step 5: Failing tests for the list**

In `src/renderer/src/components/TrackList.test.tsx`:
- In `renderList`'s options type change `separatorBefore?: ReadonlySet<string>` to `separatorBefore?: ReadonlyMap<string, readonly string[]>`, add `trailingSeparators?: readonly string[]` and `reorder?: { onMove: (keys: string[], beforeKey: string | null) => void; onRemoveSeparator: (key: string) => void }` to the options and destructuring, and pass `trailingSeparators={trailingSeparators}` and `reorder={reorder}` to `<TrackList>`.
- Add `beforeAll` to the vitest import, `import { clearDraggedRows, draggedRows } from '../lib/reorderDrag'` and `import { fakeDataTransfer, installDragEvent } from '../test/drag'` to the imports, and after the `afterEach(cleanup)` line:

```ts
beforeAll(installDragEvent)
afterEach(clearDraggedRows)

// A track row's draggable wrapper, or a separator line, by its test id.
const wrapperOf = (key: string): HTMLElement =>
  screen.queryByTestId(`track-drag-${key}`) ?? screen.getByTestId(`track-separator-${key}`)

// Grip, drag start, hover over the target (upper half when above), drop.
function drag(from: string, onto: string, above: boolean) {
  const dt = fakeDataTransfer()
  fireEvent.mouseDown(screen.getByTestId(`track-grip-${from}`))
  fireEvent.dragStart(wrapperOf(from), { dataTransfer: dt })
  fireEvent.dragOver(wrapperOf(onto), { dataTransfer: dt, clientY: above ? -1 : 1 })
  fireEvent.drop(wrapperOf(onto), { dataTransfer: dt })
  return dt
}
```

- Replace the test `'draws a separator line above the rows a playlist breaks before'` with:

```ts
  it('draws a separator line above the rows a playlist breaks before', () => {
    renderList([track({ id: 'a' }), track({ id: 'b' })], null, [], {
      separatorBefore: new Map([['b', ['s1']]]),
    })
    expect(screen.getByTestId('track-separator-s1')).toBeInTheDocument()
    expect(wrapperOf('s1').compareDocumentPosition(wrapperOf('b')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
```

- Append:

```ts
describe('TrackList reorder', () => {
  const abc = () => [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })]
  const reorderSpy = () => ({ onMove: vi.fn(), onRemoveSeparator: vi.fn() })

  it('has no grips unless the playlist can be reordered', () => {
    renderList(abc())
    expect(screen.queryByTestId(/^track-grip-/)).not.toBeInTheDocument()
  })

  it('moves a row before the one it is dropped on, with a line where it will land', () => {
    const reorder = reorderSpy()
    renderList(abc(), null, [], { reorder })
    const dt = fakeDataTransfer()
    fireEvent.mouseDown(screen.getByTestId('track-grip-c'))
    fireEvent.dragStart(wrapperOf('c'), { dataTransfer: dt })
    fireEvent.dragOver(wrapperOf('a'), { dataTransfer: dt, clientY: -1 })
    expect(screen.getByTestId('reorder-line')).toBeInTheDocument()
    fireEvent.drop(wrapperOf('a'), { dataTransfer: dt })
    expect(reorder.onMove).toHaveBeenCalledWith(['c'], 'a')
    expect(screen.queryByTestId('reorder-line')).not.toBeInTheDocument()
  })

  // Finder's convention, already used by the drag-out: a dragged row that is part of the
  // selection takes the whole selection with it, in list order.
  it('moves the whole selection when the dragged row is part of it', () => {
    const reorder = reorderSpy()
    renderList(abc(), 'c', ['a', 'c'], { reorder })
    drag('a', 'c', false)
    expect(reorder.onMove).toHaveBeenCalledWith(['a', 'c'], null)
  })

  it('moves a separator like a row, next to another one if dropped there', () => {
    const reorder = reorderSpy()
    renderList(abc(), null, [], {
      reorder,
      separatorBefore: new Map([
        ['b', ['s1']],
        ['c', ['s2']],
      ]),
    })
    drag('s2', 'b', true)
    expect(reorder.onMove).toHaveBeenCalledWith(['s2'], 'b')
  })

  it('sends nothing for a drop that leaves the order as it was', () => {
    const reorder = reorderSpy()
    renderList(abc(), null, [], { reorder })
    drag('a', 'a', false)
    expect(reorder.onMove).not.toHaveBeenCalled()
  })

  // The grip is what makes a drag a reorder; dragging anywhere else on the row still hands
  // the files to the OS (and to the tree), as before.
  it('keeps the drag-out to other apps when the grip was not pressed', () => {
    const reorder = reorderSpy()
    renderList(abc(), null, [], { reorder })
    fireEvent.dragStart(wrapperOf('b'), { dataTransfer: fakeDataTransfer() })
    expect(api.startTrackDrag).toHaveBeenCalledWith(['/music/b.wav'], undefined)
  })

  it('removes a separator from its own line', () => {
    const reorder = reorderSpy()
    renderList(abc(), null, [], { reorder, separatorBefore: new Map([['b', ['s1']]]) })
    fireEvent.click(screen.getByTestId('separator-remove-s1'))
    expect(reorder.onRemoveSeparator).toHaveBeenCalledWith('s1')
  })

  it('draws the separators after the last row', () => {
    renderList(abc(), null, [], { trailingSeparators: ['s9'] })
    expect(wrapperOf('c').compareDocumentPosition(wrapperOf('s9')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // A grip pressed and released without dragging, even outside the list, must not turn
  // the next plain drag of that row into a reorder: that drag belongs to other apps.
  it('lets go of a pressed grip when the mouse is released anywhere', () => {
    renderList(abc(), null, [], { reorder: reorderSpy() })
    fireEvent.mouseDown(screen.getByTestId('track-grip-b'))
    fireEvent.mouseUp(window)
    fireEvent.dragStart(wrapperOf('b'), { dataTransfer: fakeDataTransfer() })
    expect(api.startTrackDrag).toHaveBeenCalled()
  })

  // The tree reads what the list is dragging from this record, not from files the OS may
  // or may not bring back into Surco's window; a finished drag must not leave it behind.
  it('records the rows of a drag-out and forgets them when the drag ends', () => {
    renderList(abc(), 'c', ['a', 'c'])
    fireEvent.dragStart(wrapperOf('c'), { dataTransfer: fakeDataTransfer() })
    expect(draggedRows()).toEqual(['a', 'c'])
    fireEvent.dragEnd(window)
    expect(draggedRows()).toBeNull()
    fireEvent.dragStart(wrapperOf('b'), { dataTransfer: fakeDataTransfer() })
    fireEvent.pointerDown(window)
    expect(draggedRows()).toBeNull()
  })

  // The tree and the open playlist are re-read on focus; a re-read landing mid-drag brings
  // new row objects for the same tracks, and the drop must still move the dragged row.
  it('still drops the dragged row when the list re-renders mid-drag', () => {
    const reorder = reorderSpy()
    const props = (tracks: TrackItem[]) => ({
      tracks,
      selectedId: null,
      selectedIds: new Set<string>(),
      outputFormat: 'aiff' as const,
      bindings,
      onSelect: vi.fn(),
      onActivate: vi.fn(),
      onRemove: vi.fn(),
      onSwipeRemove: vi.fn(),
      onAcceptReview: vi.fn(),
      onPrefetch: vi.fn(),
      renderMenu: () => null,
      reorder,
    })
    const { rerender } = render(<TrackList {...props(abc())} />)
    const dt = fakeDataTransfer()
    fireEvent.mouseDown(screen.getByTestId('track-grip-c'))
    fireEvent.dragStart(wrapperOf('c'), { dataTransfer: dt })
    rerender(<TrackList {...props(abc())} />)
    fireEvent.dragOver(wrapperOf('a'), { dataTransfer: dt, clientY: -1 })
    fireEvent.drop(wrapperOf('a'), { dataTransfer: dt })
    expect(reorder.onMove).toHaveBeenCalledWith(['c'], 'a')
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/TrackList.test.tsx`
Expected: FAIL (no grips, separator testid by key).

- [ ] **Step 6: Implement the list**

In `src/renderer/src/components/TrackList.tsx`:

1. Add `GripVertical,` to the lucide import (after `CopyMinus,`), `useMemo,` to the react import (after `useLayoutEffect,`), `import { moveBefore } from '../lib/playlistEdits'` and `import { clearDraggedRows, REORDER_TYPE, setDraggedRows } from '../lib/reorderDrag'` after the `../lib/progress` import.
   In `startDragOut`, right after the `paths` constant, record the rows for the tree:

```tsx
    // The tree's drop reads these (lib/reorderDrag): the OS drag below carries files for
    // other apps, and is not relied on to bring them back into this window.
    setDraggedRows(
      selectedIds.has(track.id) ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id) : [track.id],
    )
```


2. In `Props`, replace the `separatorBefore` comment and line with:

```tsx
  // Rows a playlist breaks before (lib/playlistView), each separator under its own key and
  // drawn as a dashed line above the row. Only passed while the list shows a playlist in
  // its own order: under any other sort the breaks would land between unrelated rows.
  separatorBefore?: ReadonlyMap<string, readonly string[]>
  // Separators after the last row, drawn under it.
  trailingSeparators?: readonly string[]
  // Reordering the open rekordbox playlist by hand: a grip on every row and separator, an
  // insertion line, and a ✕ on each separator. Only passed while the list shows the
  // playlist in its own order with nothing hidden; keys are track ids and separator keys.
  reorder?: {
    onMove: (keys: string[], beforeKey: string | null) => void
    onRemoveSeparator: (key: string) => void
  }
```

3. In `RowProps`, after `outsideFilter: boolean`:

```tsx
  // Whether the row shows a grip, whether the grip was pressed (so the next drag reorders
  // instead of handing the file to the OS), and the press itself.
  reorderable: boolean
  armed: boolean
  onArmReorder: (key: string) => void
```

and add `reorderable, armed, onArmReorder,` to `TrackRow`'s destructuring after `outsideFilter,`.

4. On the row wrapper `div` (the one with `ref={rowRef}`), add ``data-testid={`track-drag-${t.id}`}`` and `data-reorder-key={t.id}` after `role="presentation"`, and replace its `onDragStart` with:

```tsx
        onDragStart={(e) => {
          // Pressed on the grip, the drag reorders the playlist inside the list.
          if (armed) {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData(REORDER_TYPE, t.id)
            return
          }
          // Otherwise hand the OS the untouched source file(s) so the row can be dropped
          // onto Spek, any app, or a rekordbox playlist in the tree. An actual drag
          // suppresses the click, so select and drag-out don't fight (same arrangement the
          // cover uses). The cover rides along so the OS drag thumbnail is the track's own
          // art, not a generic app icon.
          e.preventDefault()
          onDragOut(t)
        }}
```

5. Right before `<button` whose next lines are `type="button"` and `ref={(el) => {` (the row button), insert:

```tsx
        {reorderable && (
          <GripVertical
            data-testid={`track-grip-${t.id}`}
            aria-hidden="true"
            onMouseDown={() => onArmReorder(t.id)}
            className="absolute top-1/2 left-0.5 z-10 h-3 w-3 -translate-y-1/2 cursor-grab text-fg-faint opacity-0 group-hover:opacity-100"
          />
        )}
```

6. In `TrackList`'s destructuring add `trailingSeparators,` and `reorder,` after `separatorBefore,`. After the `closeMenu` declaration add:

```tsx
  // The reorder drag: the key whose grip was pressed, and where the drop would land (before
  // this key, null for the end, undefined while no reorder drag is over the list).
  const [armed, setArmed] = useState<string | null>(null)
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined)
  const orderKeys = useMemo(
    () => [
      ...tracks.flatMap((t) => [...(separatorBefore?.get(t.id) ?? []), t.id]),
      ...(trailingSeparators ?? []),
    ],
    [tracks, separatorBefore, trailingSeparators],
  )
  const endReorder = (): void => {
    setArmed(null)
    setDropBefore(undefined)
  }
  // A grip released anywhere (outside the list too) is no longer pressed. The rows a
  // drag-out recorded for the tree are forgotten when that drag ends, and at the next press
  // in the window in case the OS drag ended without telling this window.
  useEffect(() => {
    const release = (): void => setArmed(null)
    window.addEventListener('mouseup', release)
    window.addEventListener('dragend', clearDraggedRows, true)
    window.addEventListener('pointerdown', clearDraggedRows, true)
    return () => {
      window.removeEventListener('mouseup', release)
      window.removeEventListener('dragend', clearDraggedRows, true)
      window.removeEventListener('pointerdown', clearDraggedRows, true)
    }
  }, [])
  const onReorderOver = (e: React.DragEvent): void => {
    if (!reorder || !e.dataTransfer.types.includes(REORDER_TYPE)) return
    e.preventDefault()
    const el = (e.target as Element).closest<HTMLElement>('[data-reorder-key]')
    const key = el?.dataset.reorderKey
    if (!el || !key) return
    const box = el.getBoundingClientRect()
    setDropBefore(
      e.clientY < box.top + box.height / 2 ? key : (orderKeys[orderKeys.indexOf(key) + 1] ?? null),
    )
  }
  const onReorderDrop = (e: React.DragEvent): void => {
    if (!reorder || !e.dataTransfer.types.includes(REORDER_TYPE)) return
    e.preventDefault()
    // The window's own drop imports files; a reorder is not an import.
    e.stopPropagation()
    const dragged = e.dataTransfer.getData(REORDER_TYPE)
    const moved = selectedIds.has(dragged) ? orderKeys.filter((k) => selectedIds.has(k)) : [dragged]
    const target = dropBefore
    endReorder()
    if (target === undefined) return
    // The same rule main writes and the optimistic re-read draws (lib/playlistEdits).
    const next = moveBefore(orderKeys, (k) => k, new Set(moved), target)
    if (next && next.join('\n') !== orderKeys.join('\n')) reorder.onMove(moved, target)
  }
  const insertionLine = (
    <div data-testid="reorder-line" className="mx-2 h-0.5 rounded-full bg-[var(--color-accent)]" />
  )
  const separatorLine = (key: string): React.JSX.Element => (
    <Fragment key={key}>
      {dropBefore === key && insertionLine}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging a separator is a pointer-only enhancement; it has no keyboard twin in this phase */}
      <div
        data-testid={`track-separator-${key}`}
        data-reorder-key={key}
        aria-hidden={reorder ? undefined : 'true'}
        draggable={armed === key}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(REORDER_TYPE, key)
        }}
        className="group mx-4 flex h-[22px] items-center gap-2 text-[10.5px] text-fg-faint before:flex-1 before:border-t before:border-dashed before:border-line-strong before:content-[''] after:flex-1 after:border-t after:border-dashed after:border-line-strong after:content-['']"
      >
        {reorder && (
          <GripVertical
            data-testid={`track-grip-${key}`}
            aria-hidden="true"
            onMouseDown={() => setArmed(key)}
            className="h-3 w-3 cursor-grab opacity-0 group-hover:opacity-100"
          />
        )}
        {tr('sources.separator')}
        {reorder && (
          <button
            type="button"
            data-testid={`separator-remove-${key}`}
            aria-label={tr('sources.reorder.removeSeparator')}
            onClick={() => reorder.onRemoveSeparator(key)}
            className="rounded opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
          >
            <X size={11} aria-hidden="true" />
          </button>
        )}
      </div>
    </Fragment>
  )
```

`tr` is declared further down in the component (`const { t: tr } = useTranslation()`): move that line up above this block.

7. On the listbox `div` (the one with `ref={listRef}`) add:

```tsx
        onDragOver={onReorderOver}
        onDrop={onReorderDrop}
        onDragEnd={endReorder}
        onMouseUp={() => setArmed(null)}
```

8. Replace the `{tracks.map((t, i) => ( <Fragment key={t.id}> {separatorBefore?.has(t.id) && ( ...dashed div... )} <TrackRow` opening with:

```tsx
        {tracks.map((t, i) => (
          <Fragment key={t.id}>
            {separatorBefore?.get(t.id)?.map(separatorLine)}
            {dropBefore === t.id && insertionLine}
            <TrackRow
```

add to the `TrackRow` props:

```tsx
              reorderable={!!reorder}
              armed={armed === t.id}
              onArmReorder={setArmed}
```

and after the closing `))}` of `tracks.map`, still inside the listbox `div`:

```tsx
        {trailingSeparators?.map(separatorLine)}
        {dropBefore === null && insertionLine}
```

9. In `src/renderer/src/App.tsx`, the `separatorBefore={...}` prop of `<TrackList>` keeps its expression (it now passes a Map); add right after it:

```tsx
                            trailingSeparators={
                              playlistScope && sortBy === 'import'
                                ? playlistScope.trailingSeparators
                                : undefined
                            }
```

- [ ] **Step 7: Run, typecheck, lint, commit**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/TrackList.test.tsx src/renderer/src/lib/playlistView.test.ts src/renderer/src/App.test.tsx src/renderer/src/i18n`
Expected: PASS (the App test that finds `/^track-separator-/` still finds one).
Run `tsc` (web) and `biome check --write src`. Expected: clean.

```bash
git add src/renderer/src/lib/reorderDrag.ts src/renderer/src/lib/playlistView.ts src/renderer/src/lib/playlistView.test.ts src/renderer/src/components/TrackList.tsx src/renderer/src/components/TrackList.test.tsx src/renderer/src/App.tsx src/renderer/src/i18n/locales
git commit -m "Reorder the open playlist by dragging rows and separators in the list"
```

---

### Task 10: Row menu, tree and reorder wired into the app

**Files:**
- Modify: `src/renderer/src/components/TrackContextMenu.tsx`, `src/renderer/src/components/TrackContextMenu.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx` (`describe('App source playlists')`)
- Modify: locales (`sources.menu`, `sources.reorder.hint`)

**Interfaces:**
- Consumes: `useRekordboxEdits` (Task 7), `browser.canInsertSeparator` (Task 7), `SourceTree.edit` (`onCreate`, `onDropTracks`), `flattenPlaylists`, `draggedRows`, `clearDraggedRows`, `installDragEvent`, `fakeDataTransfer` (Task 8), `PlaylistScope`, `TrackList.reorder`, `isReorderDrag` (Task 9); App's existing `menuTargets` (`useStableCallback((id: string) => TrackItem[])`, App.tsx ~925), reused as is.
- Produces:
  - `export interface TrackPlaylistMenu { targets: { node: SourceNode; folders: string[] }[]; openName: string | null; canInsertSeparator: boolean; onAddTo: (node: SourceNode) => void; onInsertSeparator: () => void; onRemove: () => void }` and the `playlist?: TrackPlaylistMenu` prop on `TrackContextMenu`
  - testids: `track-menu-add-to`, `track-menu-playlists`, `track-menu-playlist-<id>`, `track-menu-insert-separator`, `track-menu-remove-from`, `reorder-hint`, `rekordbox-edit-notice`

- [ ] **Step 1: Locale strings**

```bash
cat > "$SCRATCH/i18n-task10.json" <<'EOF'
{
  "es": { "sources": { "menu": { "addTo": "Añadir a playlist", "insertSeparator": "Insertar separador encima", "removeFrom": "Quitar de «{{name}}»" }, "reorder": { "hint": "Para reordenar, ordena «Por defecto» y quita la búsqueda y los filtros" } } },
  "en": { "sources": { "menu": { "addTo": "Add to playlist", "insertSeparator": "Insert separator above", "removeFrom": "Remove from “{{name}}”" }, "reorder": { "hint": "To reorder, sort by “Default” and clear the search and filters" } } },
  "de": { "sources": { "menu": { "addTo": "Zu Playlist hinzufügen", "insertSeparator": "Trenner darüber einfügen", "removeFrom": "Aus „{{name}}“ entfernen" }, "reorder": { "hint": "Zum Umsortieren nach „Standard“ sortieren und Suche und Filter leeren" } } },
  "fr": { "sources": { "menu": { "addTo": "Ajouter à une playlist", "insertSeparator": "Insérer un séparateur au-dessus", "removeFrom": "Retirer de « {{name}} »" }, "reorder": { "hint": "Pour réordonner, trie par « Par défaut » et efface la recherche et les filtres" } } },
  "pt-BR": { "sources": { "menu": { "addTo": "Adicionar à playlist", "insertSeparator": "Inserir separador acima", "removeFrom": "Remover de “{{name}}”" }, "reorder": { "hint": "Para reordenar, ordene por “Padrão” e limpe a busca e os filtros" } } }
}
EOF
node "$SCRATCH/merge-locale.cjs" "$SCRATCH/i18n-task10.json"
```

- [ ] **Step 2: Failing tests for the menu**

Append to `src/renderer/src/components/TrackContextMenu.test.tsx`:

```tsx
describe('TrackContextMenu playlist actions', () => {
  const FACTORY = { id: 'f', name: 'Factory', kind: 'playlist' as const, count: 3 }
  const HOUSE = { id: 'h', name: 'House', kind: 'playlist' as const, count: 2 }
  function playlist(over: Record<string, unknown> = {}) {
    return {
      targets: [
        { node: FACTORY, folders: ['COMBOS'] },
        { node: HOUSE, folders: [] },
      ],
      openName: 'Todas',
      canInsertSeparator: true,
      onAddTo: vi.fn(),
      onInsertSeparator: vi.fn(),
      onRemove: vi.fn(),
      ...over,
    }
  }

  // The same "Todas" or "Fijas" sits under several folders in the measured collection;
  // the folder path is what tells the targets apart.
  it('offers the other playlists with their folders and adds to the one picked', () => {
    const p = playlist()
    const props = renderMenu({ playlist: p })
    fireEvent.click(screen.getByTestId('track-menu-add-to'))
    expect(screen.getByTestId('track-menu-playlist-f')).toHaveTextContent('COMBOS › Factory')
    fireEvent.click(screen.getByTestId('track-menu-playlist-f'))
    expect(p.onAddTo).toHaveBeenCalledWith(FACTORY)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('disables inserting a separator when the collection has none, and says why', () => {
    renderMenu({ playlist: playlist({ canInsertSeparator: false }) })
    expect(screen.getByTestId('track-menu-insert-separator')).toBeDisabled()
    expect(screen.getByTestId('track-menu-insert-separator')).toHaveTextContent(
      'Your collection has no separator to copy',
    )
  })

  it('names the playlist a row is removed from', () => {
    const p = playlist()
    renderMenu({ playlist: p })
    expect(screen.getByTestId('track-menu-remove-from')).toHaveTextContent('Remove from “Todas”')
    fireEvent.click(screen.getByTestId('track-menu-remove-from'))
    expect(p.onRemove).toHaveBeenCalled()
  })

  it('offers only adding while no playlist is open', () => {
    renderMenu({ playlist: playlist({ openName: null }) })
    expect(screen.getByTestId('track-menu-add-to')).toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/TrackContextMenu.test.tsx`
Expected: FAIL (no `track-menu-add-to`).

- [ ] **Step 3: Implement the menu**

In `src/renderer/src/components/TrackContextMenu.tsx`:
- Add `import type { SourceNode } from '../../../shared/types'`.
- Before `interface Props` add:

```tsx
// What the menu offers for the open rekordbox crate. Present only while rekordbox is the
// source; openName is the playlist on screen, null when the list is not one.
export interface TrackPlaylistMenu {
  targets: { node: SourceNode; folders: string[] }[]
  openName: string | null
  canInsertSeparator: boolean
  onAddTo: (node: SourceNode) => void
  onInsertSeparator: () => void
  onRemove: () => void
}
```

- In `Props` add `playlist?: TrackPlaylistMenu` (after `onOpenBackup`), and `playlist,` to the destructuring.
- `MenuItem` becomes:

```tsx
function MenuItem({
  label,
  testid,
  danger,
  disabled,
  hint,
  onClick,
}: {
  label: string
  testid: string
  danger?: boolean
  disabled?: boolean
  // Why the item cannot be used, in words under it: a greyed item with no reason reads as
  // broken.
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      // One Tab stop for the whole menu: the arrows move between items, Tab leaves.
      tabIndex={-1}
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className={`block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)] disabled:opacity-60 disabled:hover:bg-transparent ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      {label}
      {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
    </button>
  )
}
```

- After `const isWin = isWindows()` add `const [picking, setPicking] = useState(false)`.
- Right after the `track-menu-startover` item and before the first `<hr ... />`, insert:

```tsx
        {playlist && (
          <>
            <hr className="my-1 h-px border-0 bg-[var(--color-line)]" />
            <div className="relative">
              <MenuItem
                testid="track-menu-add-to"
                label={`${tr('sources.menu.addTo')} ›`}
                onClick={() => setPicking((p) => !p)}
              />
              {picking && (
                <div
                  data-testid="track-menu-playlists"
                  className="absolute top-0 left-full ml-1 max-h-[60vh] min-w-[220px] overflow-y-auto rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
                >
                  {playlist.targets.map(({ node, folders }) => (
                    <MenuItem
                      key={node.id}
                      testid={`track-menu-playlist-${node.id}`}
                      label={[...folders, node.name].join(' › ')}
                      onClick={() => run(() => playlist.onAddTo(node))}
                    />
                  ))}
                </div>
              )}
            </div>
            {playlist.openName !== null && (
              <MenuItem
                testid="track-menu-insert-separator"
                label={tr('sources.menu.insertSeparator')}
                disabled={!playlist.canInsertSeparator}
                hint={
                  playlist.canInsertSeparator ? undefined : tr('sources.edit.refused.noSeparator')
                }
                onClick={() => run(playlist.onInsertSeparator)}
              />
            )}
          </>
        )}
```

- Right before the `track-menu-remove` item insert:

```tsx
        {playlist && playlist.openName !== null && (
          <MenuItem
            testid="track-menu-remove-from"
            danger
            label={tr('sources.menu.removeFrom', { name: playlist.openName })}
            onClick={() => run(playlist.onRemove)}
          />
        )}
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/TrackContextMenu.test.tsx`
Expected: PASS (the order test is unchanged without `playlist`).

- [ ] **Step 4: Failing App tests**

In `src/renderer/src/App.test.tsx`, add `beforeAll` to the vitest import, `import { clearDraggedRows } from './lib/reorderDrag'` and `import { fakeDataTransfer, installDragEvent } from './test/drag'` to the imports, and above `describe('App source playlists'`:

```tsx
beforeAll(installDragEvent)
afterEach(clearDraggedRows)

// The draggable wrapper of the row at this position in the list.
const rowWrapper = (index: number): HTMLElement => screen.getAllByTestId(/^track-drag-/)[index]
```

Inside `describe('App source playlists', ...)` append:

```tsx
  const linked = (path: string, linkId: string, separator = false) => ({
    path,
    separator,
    meta: {},
    linkId,
    contentId: `c-${linkId}`,
  })
  const FACTORY_ENTRIES = [
    linked('/m/a.wav', 'l1'),
    linked('/m/_.mp3', 's1', true),
    linked('/m/b.wav', 'l2'),
    linked('/m/c.wav', 'l3'),
  ]
  const TITLES: Record<string, string> = { '/m/a.wav': 'Alpha', '/m/b.wav': 'Bravo', '/m/c.wav': 'Charlie' }
  const titles = () => screen.getAllByTestId('track-row').map((r) => r.textContent ?? '')

  async function openFactory(over: Record<string, unknown> = {}) {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav', '/m/c.wav']),
      readTags: vi.fn(async (path: string) => ({ title: TITLES[path], artist: 'DJ' })),
      rekordboxAvailable: vi.fn<Api['rekordboxAvailable']>().mockResolvedValue(true),
      loadRekordboxTree: vi.fn<Api['loadRekordboxTree']>().mockResolvedValue([
        { id: 'f', name: 'Factory', kind: 'playlist', count: 3 },
        { id: 'h', name: 'House', kind: 'playlist', count: 0 },
      ]),
      loadRekordboxPlaylist: vi.fn<Api['loadRekordboxPlaylist']>().mockResolvedValue(FACTORY_ENTRIES),
      ...over,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(titles()[0]).toContain('Alpha'))
  }

  // The DJ's own request: put the set in order by dragging. The list must show the new
  // order at once and keep it after rekordbox answers, even with the dragged row selected
  // (a held selection otherwise freezes the order on screen).
  it('reorders an open rekordbox playlist by dragging a row onto another', async () => {
    const edit = vi.fn<Api['editRekordboxPlaylist']>().mockResolvedValue({ applied: true })
    const load = vi
      .fn<Api['loadRekordboxPlaylist']>()
      .mockResolvedValueOnce(FACTORY_ENTRIES)
      .mockResolvedValue([FACTORY_ENTRIES[3], FACTORY_ENTRIES[0], FACTORY_ENTRIES[1], FACTORY_ENTRIES[2]])
    await openFactory({ editRekordboxPlaylist: edit, loadRekordboxPlaylist: load })
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[2])
    const charlie = rowWrapper(2)
    const dt = fakeDataTransfer()
    fireEvent.mouseDown(within(charlie).getByTestId(/^track-grip-/))
    fireEvent.dragStart(charlie, { dataTransfer: dt })
    fireEvent.dragOver(rowWrapper(0), { dataTransfer: dt, clientY: -1 })
    fireEvent.drop(rowWrapper(0), { dataTransfer: dt })
    expect(edit).toHaveBeenCalledWith({
      kind: 'move',
      playlistId: 'f',
      linkIds: ['l3'],
      beforeLinkId: 'l1',
    })
    await waitFor(() =>
      expect(titles()).toEqual([
        expect.stringContaining('Charlie'),
        expect.stringContaining('Alpha'),
        expect.stringContaining('Bravo'),
      ]),
    )
  })

  // Sorted by artist, a drop between two rows means nothing in the playlist's own order.
  it('hides the grips and says why when the list is not in playlist order', async () => {
    await openFactory()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-artist'))
    await waitFor(() => expect(screen.queryByTestId(/^track-grip-/)).not.toBeInTheDocument())
    expect(screen.getByTestId('reorder-hint')).toHaveTextContent(
      'To reorder, sort by “Default” and clear the search and filters',
    )
  })

  // Copying between playlists names the exact rekordbox entry of a row read from a
  // playlist, so the symlinked twins copy instead of being refused.
  it('adds a row to another playlist from its menu, naming its rekordbox entry', async () => {
    const edit = vi.fn<Api['editRekordboxPlaylist']>().mockResolvedValue({
      applied: true,
      report: { added: 1, already: 0, notInCollection: 0, ambiguous: 0 },
    })
    await openFactory({ editRekordboxPlaylist: edit })
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('track-menu-add-to'))
    fireEvent.click(screen.getByTestId('track-menu-playlist-h'))
    expect(edit).toHaveBeenCalledWith({
      kind: 'add',
      playlistId: 'h',
      tracks: [{ contentId: 'c-l1', paths: ['/m/a.wav'] }],
    })
    expect(await screen.findByTestId('rekordbox-edit-notice')).toHaveTextContent(
      '1 track added to “House”',
    )
  })

  it('says nothing changed and re-reads the playlist when rekordbox stays open', async () => {
    const load = vi.fn<Api['loadRekordboxPlaylist']>().mockResolvedValue(FACTORY_ENTRIES)
    await openFactory({
      loadRekordboxPlaylist: load,
      editRekordboxPlaylist: vi
        .fn<Api['editRekordboxPlaylist']>()
        .mockResolvedValue({ applied: false, reason: 'cancelled' }),
    })
    const before = load.mock.calls.length
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
    fireEvent.click(await screen.findByTestId('track-menu-remove-from'))
    expect(await screen.findByTestId('rekordbox-edit-notice')).toHaveTextContent(
      'Nothing changed because rekordbox is still open',
    )
    expect(load.mock.calls.length).toBeGreaterThan(before)
  })

  // Rows dragged out of the list onto a tree playlist are known from the list's own record,
  // so they are added (by their rekordbox entry) even if the OS drag brings no files back
  // into Surco's window.
  it('adds rows dragged from the list onto a playlist in the tree, with or without files', async () => {
    const edit = vi.fn<Api['editRekordboxPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ editRekordboxPlaylist: edit, startTrackDrag: vi.fn() })
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
    const house = screen.getByTestId('source-node-h')
    fireEvent.dragOver(house, { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(house, { dataTransfer: fakeDataTransfer() })
    expect(edit).toHaveBeenCalledWith({
      kind: 'add',
      playlistId: 'h',
      tracks: [{ contentId: 'c-l1', paths: ['/m/a.wav'] }],
    })
  })

  // A drop from Finder is files the list never dragged: they go by their paths.
  it('adds files dropped from Finder onto a playlist by their paths', async () => {
    const edit = vi.fn<Api['editRekordboxPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({
      editRekordboxPlaylist: edit,
      getPathForFile: vi.fn((f: File) => `/Volumes/Public/Music/${f.name}`),
    })
    const house = screen.getByTestId('source-node-h')
    const dt = fakeDataTransfer([new File([''], 'Gowan.wav')])
    fireEvent.dragOver(house, { dataTransfer: dt })
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit).toHaveBeenCalledWith({
      kind: 'add',
      playlistId: 'h',
      tracks: [{ paths: ['/Volumes/Public/Music/Gowan.wav'] }],
    })
  })

  it('creates a playlist named in the tree', async () => {
    const edit = vi.fn<Api['editRekordboxPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ editRekordboxPlaylist: edit })
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bolo' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    expect(edit).toHaveBeenCalledWith({ kind: 'create', parentId: 'root', name: 'Bolo', folder: false })
  })

  // A reorder is not files arriving; lighting the import overlay would invite a drop that
  // means something else.
  it('does not light the file-drop overlay while reordering', async () => {
    await openFactory()
    const rows = screen.getAllByTestId('track-row')
    const dt = fakeDataTransfer()
    fireEvent.mouseDown(within(rowWrapper(2)).getByTestId(/^track-grip-/))
    fireEvent.dragStart(rowWrapper(2), { dataTransfer: dt })
    fireEvent.dragEnter(rowWrapper(0), { dataTransfer: dt })
    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over')
  })
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/App.test.tsx`
Expected: FAIL on the five new tests.

- [ ] **Step 5: Wire App**

In `src/renderer/src/App.tsx`:

1. Imports: `import { SourceTree } from './components/SourceTree'` becomes `import { flattenPlaylists, SourceTree } from './components/SourceTree'`; `import { TrackContextMenu } from './components/TrackContextMenu'` becomes `import { TrackContextMenu, type TrackPlaylistMenu } from './components/TrackContextMenu'`; add `import { useRekordboxEdits } from './hooks/useRekordboxEdits'` after the `useSourceBrowser` import; add `import { clearDraggedRows, draggedRows, isReorderDrag } from './lib/reorderDrag'` in the `./lib/` imports; add `PlaylistTrackRef` and `SourceNode` to the `../../shared/types` type import (create one if App has none: `import type { PlaylistTrackRef, SourceNode } from '../../shared/types'`).

2. Right after the `const browser = useSourceBrowser({ ... })` statement:

```tsx
  // What an edit to rekordbox did, or why it did nothing: one keyed line, so a burst of
  // edits leaves the latest answer, not a stack.
  const notifyEdit = useCallback(
    (text: string, tone: 'neutral' | 'danger') =>
      pushToast(store, {
        key: 'rekordbox-edit',
        tone,
        message: text,
        duration: 5000,
        testid: 'rekordbox-edit-notice',
      }),
    [store],
  )
  const editRekordbox = useRekordboxEdits(notifyEdit)
```

3. The root drop `div`: replace

```tsx
            onDragEnterCapture={() => setDragging(dragDepth.current.enter())}
```

with

```tsx
            onDragEnterCapture={(e) => {
              // A reorder inside the list is not files arriving: no import overlay for it.
              if (!isReorderDrag(e)) setDragging(dragDepth.current.enter())
            }}
```

and

```tsx
            onDragLeaveCapture={() => setDragging(dragDepth.current.leave())}
```

with

```tsx
            onDragLeaveCapture={(e) => {
              if (!isReorderDrag(e)) setDragging(dragDepth.current.leave())
            }}
```

4. The held order must let go when the playlist's own order changes. After the `const openPlaylistId = ...` line add:

```tsx
  // The playlist's order, so a reorder (or a re-read bringing another order) is a new view:
  // the order held for the selected row would otherwise keep the old one on screen.
  const playlistOrder = useMemo(
    () => playlistScope?.tracks.map((t) => t.id).join('\n') ?? '',
    [playlistScope],
  )
```

change `const viewKey = \`${key}|${deferredSearch}|${sortBy}|${sortDir}|${openPlaylistId}\`` to `const viewKey = \`${key}|${deferredSearch}|${sortBy}|${sortDir}|${openPlaylistId}|${playlistOrder}\``, and in that memo's dependency list replace `    openPlaylistId,\n    selectedId,` with `    openPlaylistId,\n    playlistOrder,\n    selectedId,`.

5. Right before the comment `// What the right-click menu offers is App's decision` add:

```tsx
  // Organising the open rekordbox crate. Every action sends one edit; what rekordbox holds
  // afterwards is re-read and shown (useRekordboxEdits).
  const rekordboxOpen =
    browser.source === 'rekordbox' && browser.playlist !== null && playlistScope !== null
  // A row read from an open rekordbox playlist names its collection entry; any other track
  // is looked up by its file, and by its converted file when a conversion moved the entry.
  const trackRef = (t: TrackItem): PlaylistTrackRef => ({
    contentId: rekordboxOpen ? playlistScope?.contentOf.get(t.id) : undefined,
    paths: t.outputPath && t.outputPath !== t.inputPath ? [t.inputPath, t.outputPath] : [t.inputPath],
  })
  const addToRekordbox = useStableCallback((node: SourceNode, targets: TrackItem[]) => {
    void editRekordbox({ kind: 'add', playlistId: node.id, tracks: targets.map(trackRef) }, node.name)
  })
  // Tracks dropped on a playlist in the tree: the rows a drag out of the list recorded
  // (lib/reorderDrag), which carry their rekordbox entry, or files from Finder. The record
  // is used whenever the drop brought no files or only those rows' files, so it does not
  // matter whether the OS drag delivers files back to this window; a Finder drop that finds
  // a stale record goes by its own files.
  const dropOnRekordbox = useStableCallback((node: SourceNode, files: File[]) => {
    const paths = files.map((f) => window.api.getPathForFile(f).normalize('NFC'))
    const held = (draggedRows() ?? []).flatMap((id) => {
      const t = tracksRef.current.find((x) => x.id === id)
      return t ? [t] : []
    })
    clearDraggedRows()
    const heldPaths = new Set(held.map((t) => t.inputPath.normalize('NFC')))
    const fromList = held.length > 0 && paths.every((p) => heldPaths.has(p))
    const byPath = new Map(tracksRef.current.map((t) => [t.inputPath.normalize('NFC'), t]))
    const tracks = fromList
      ? held.map(trackRef)
      : paths.map((p) => {
          const t = byPath.get(p)
          return t ? trackRef(t) : { paths: [p] }
        })
    if (tracks.length > 0)
      void editRekordbox({ kind: 'add', playlistId: node.id, tracks }, node.name)
  })
  const createInRekordbox = useStableCallback((parentId: string, name: string, folder: boolean) => {
    void editRekordbox({ kind: 'create', parentId, name, folder }, name)
  })
  const treeEdit = useMemo(
    () => ({ onCreate: createInRekordbox, onDropTracks: dropOnRekordbox }),
    [createInRekordbox, dropOnRekordbox],
  )
  const linkFor = (key: string): string => playlistScope?.linkOf.get(key) ?? key
  const moveInRekordbox = useStableCallback((keys: string[], beforeKey: string | null) => {
    if (!browser.playlist) return
    void editRekordbox(
      {
        kind: 'move',
        playlistId: browser.playlist.id,
        linkIds: keys.map(linkFor),
        beforeLinkId: beforeKey === null ? null : linkFor(beforeKey),
      },
      browser.playlist.name,
    )
  })
  const removeFromRekordbox = useStableCallback((linkIds: string[]) => {
    if (!browser.playlist || linkIds.length === 0) return
    void editRekordbox(
      { kind: 'remove', playlistId: browser.playlist.id, linkIds },
      browser.playlist.name,
    )
  })
  const removeSeparator = useStableCallback((key: string) => removeFromRekordbox([key]))
  // Reordering only means something in the playlist's own order with nothing hidden: under
  // another sort, a search or a filter, a drop would land among rows the user cannot see.
  const reorderEnabled = rekordboxOpen && sortBy === 'import' && !search && !filterActive
  const reorder = useMemo(
    () =>
      reorderEnabled ? { onMove: moveInRekordbox, onRemoveSeparator: removeSeparator } : undefined,
    [reorderEnabled, moveInRekordbox, removeSeparator],
  )
  // The right-clicked row acts with the selection it belongs to through App's existing
  // menuTargets (the one remove and trash use). Added tracks therefore go in working-list
  // order, which is the order they were loaded in.
  const trackMenuPlaylist = (track: TrackItem): TrackPlaylistMenu | undefined => {
    if (browser.source !== 'rekordbox' || !browser.tree) return undefined
    const playlist = browser.playlist
    return {
      targets: flattenPlaylists(browser.tree).filter((h) => h.node.id !== playlist?.id),
      openName: rekordboxOpen && playlist ? playlist.name : null,
      canInsertSeparator: browser.canInsertSeparator,
      onAddTo: (node) => addToRekordbox(node, menuTargets(track.id)),
      onInsertSeparator: () => {
        const beforeLinkId = playlistScope?.linkOf.get(track.id)
        if (!playlist || !beforeLinkId) return
        void editRekordbox(
          { kind: 'insertSeparator', playlistId: playlist.id, beforeLinkId },
          playlist.name,
        )
      },
      onRemove: () =>
        removeFromRekordbox(
          menuTargets(track.id).flatMap((t) => {
            const link = playlistScope?.linkOf.get(t.id)
            return link ? [link] : []
          }),
        ),
    }
  }
```

6. In `renderTrackMenu`, add `playlist={trackMenuPlaylist(menu.track)}` after `onOpenBackup={onOpenBackup}`.

7. On `<SourceTree ... onSelect={browser.selectPlaylist}`, add after it: `edit={browser.source === 'rekordbox' ? treeEdit : undefined}`.

8. On `<TrackList`, after the `trailingSeparators={...}` prop add `reorder={reorder}`.

9. Replace

```tsx
                          onTrashSuspects={onTrashSuspects}
                        />
                        {visibleTracks.length === 0 ? (
```

with

```tsx
                          onTrashSuspects={onTrashSuspects}
                        />
                        {rekordboxOpen && !reorderEnabled && (
                          <p
                            data-testid="reorder-hint"
                            className="px-4 pt-1 text-[11px] text-fg-faint"
                          >
                            {tr('sources.reorder.hint')}
                          </p>
                        )}
                        {visibleTracks.length === 0 ? (
```

- [ ] **Step 6: Run everything that can be affected**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/App.test.tsx src/renderer/src/components src/renderer/src/i18n`
Expected: PASS.
Run both `tsc` commands and `biome check --write src`. Expected: clean.

- [ ] **Step 7: Full suite**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run`
Expected: PASS. A file that fails alone and passes on re-run is the known flaky family (memory: `suite-flaky-fichero-entero`); re-run that file on its own before suspecting this change, and report it either way.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/TrackContextMenu.tsx src/renderer/src/components/TrackContextMenu.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/i18n/locales
git commit -m "Organise rekordbox playlists from the row menu, the tree and the list"
```

---

### Task 11: Verify on a copy, then Vicent's checklist in real rekordbox

**Files:** none of the repo (scripts in the scratchpad). Report goes to the final summary.

**Interfaces:**
- Consumes: the whole feature; `measure.cjs` from Task 1.
- Produces: measured evidence for the summary, and the checklist Vicent runs if he decides to.

- [ ] **Step 1: Copy, with rekordbox closed if possible**

```bash
mkdir -p "$SCRATCH/rb-2a"
pgrep -x rekordbox && echo "rekordbox OPEN: copy the -wal too" || echo "rekordbox closed"
cp ~/Library/Pioneer/rekordbox/master.db "$SCRATCH/rb-2a/master.db"
[ -f ~/Library/Pioneer/rekordbox/master.db-wal ] && cp ~/Library/Pioneer/rekordbox/master.db-wal "$SCRATCH/rb-2a/master.db-wal"
cp ~/Library/Pioneer/rekordbox/masterPlaylists6.xml "$SCRATCH/rb-2a/masterPlaylists6.xml"
cp "$SCRATCH/rb-2a/masterPlaylists6.xml" "$SCRATCH/rb-2a/masterPlaylists6.before.xml"
node "$SCRATCH/rb-spike/measure.cjs" "$SCRATCH/rb-2a" > "$SCRATCH/rb-2a/measure.before.json"
```

Do NOT `chmod 444` the copy: Surco writes to it in this task. The "before" measurement is taken on this same copy, so the comparison in Step 4 isolates what Surco wrote.

- [ ] **Step 2: Point the driver's app at the copy**

Follow `.claude/skills/run-desktop/SKILL.md` (`npm install` inside `apps/desktop/.claude/skills/run-desktop/` of THIS worktree, then build with `electron-vite build` from `apps/desktop`). Back up `~/Library/Application Support/Electron/settings.json` to `$SCRATCH/rb-2a/settings.before.json`, then set `"rekordboxDbPath"` in it to `$SCRATCH/rb-2a/master.db` (absolute). The setting is shared with other sessions: restore it in Step 6 whatever happens.

- [ ] **Step 3: Drive each operation**

With `node driver.mjs repl` (from the skill dir): `launch`, click `[data-testid=source-rail-rekordbox]`, then:
1. Create: click `[data-testid=source-tree-new-playlist]`, type `Surco prueba 2a` + Enter (use `eval` to set the field's value and dispatch `keydown` Enter if the REPL has no typing command). `ss create`.
2. Open COMBOS › Factory (click its folder and playlist nodes). Right-click the first row, `Añadir a playlist ›` → `Surco prueba 2a`. `ss add` (the notice must say 1 added).
3. Open `Surco prueba 2a`. Add two more tracks the same way from Factory.
4. Reorder: two separate `eval`s (React must re-render between the grip press and the drag):
   - `eval document.querySelectorAll('[data-reorder-key]')[2].querySelector('[data-testid^="track-grip-"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`
   - `eval (()=>{const rows=[...document.querySelectorAll('[data-reorder-key]')];const dt=new DataTransfer();rows[2].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));const r=rows[0].getBoundingClientRect();rows[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.top+1}));rows[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:r.top+1}));return 'ok'})()`
   `ss reorder` (third row now first).
5. Right-click the second row → "Insertar separador encima". `ss separator`.
6. Right-click a row → "Quitar de «Surco prueba 2a»". `ss remove`.
7. Sort by artist: grips gone, hint visible. `ss hint`.

Open and look at every screenshot.

- [ ] **Step 4: Read the copy back**

```bash
node "$SCRATCH/rb-spike/measure.cjs" "$SCRATCH/rb-2a" > "$SCRATCH/rb-2a/measure.after.json"
diff "$SCRATCH/rb-2a/measure.before.json" "$SCRATCH/rb-2a/measure.after.json"
diff <(tr -d '\r' < "$SCRATCH/rb-2a/masterPlaylists6.before.xml") <(tr -d '\r' < "$SCRATCH/rb-2a/masterPlaylists6.xml")
```

Expected in the measurement diff: `contentRows` and `cueRows` unchanged; `linkRows` up by the tracks added plus the separator minus the row removed; `localUpdateCount` higher; `playlistsWithTrackNoGaps` still 0; `xml.nodes` up by one, `xml.liveRowsWithoutNode` still empty, `xml.lastNode.Id` the hex of the new playlist's ID, `xml.parentMismatches` 0. Expected in the XML diff: exactly one added `NODE` line (ParentId `0`, Attribute `0`, Lib_Type `0`).

Then put the new rows next to rows rekordbox made:

```bash
cat > "$SCRATCH/rb-2a/rows.cjs" <<'EOF'
const Database = require('/Users/vicent/code/surco/node_modules/better-sqlite3-multiple-ciphers')
const db = new Database(`${process.argv[2]}/master.db`, { readonly: true, fileMustExist: true })
db.pragma(`cipher='sqlcipher'`)
db.pragma('legacy=4')
db.pragma(`key='402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497'`)
const mine = db.prepare(`SELECT * FROM djmdPlaylist WHERE Name = 'Surco prueba 2a'`).get()
const theirs = db.prepare(`SELECT * FROM djmdPlaylist WHERE Name = 'Factory'`).get()
console.log({ mine, theirs })
console.log(db.prepare('SELECT * FROM djmdSongPlaylist WHERE PlaylistID = ? ORDER BY TrackNo').all(mine.ID))
console.log(db.prepare('SELECT * FROM djmdSongPlaylist WHERE PlaylistID = ? ORDER BY TrackNo LIMIT 2').all(theirs.ID))
EOF
node "$SCRATCH/rb-2a/rows.cjs" "$SCRATCH/rb-2a"
ls -la "$SCRATCH/rb-2a"/*.surco-*
```

Confirm the new rows fill the same columns the same way as rekordbox's (UUID shapes, timestamp format, `rb_local_usn` above the "before" `localUpdateCount`, `rb_local_synced` 0, `TrackNo` 1..N in the new playlist with the separator where it was inserted), and that `master.db.surco-session`, `master.db.surco-backup`, `masterPlaylists6.xml.surco-session` and `masterPlaylists6.xml.surco-backup` exist beside the copy.

- [ ] **Step 5: Cancel path on the copy**

Open rekordbox ONLY if Vicent agrees to it in this session (it opens his real collection, read by rekordbox, untouched by Surco because Surco points at the copy). If he does: in Surco remove a row; the dialog "rekordbox está abierto" must show the playlist wording; press Cancelar; the notice must say nothing changed and the row must still be there. If he does not, report this path as covered by Task 5 and Task 10 tests only.

- [ ] **Step 6: Restore the shared setting**

```bash
cp "$SCRATCH/rb-2a/settings.before.json" ~/Library/Application\ Support/Electron/settings.json
```

and confirm `rekordboxDbPath` is back to its previous value.

- [ ] **Step 7: Vicent's checklist for real rekordbox (he decides whether and when)**

Hand him this, in Spanish, in the final summary:

0. Antes de nada, con rekordbox cerrado, haz tu propia copia, que es la que sirve para volver atrás: `cp ~/Library/Pioneer/rekordbox/master.db ~/Library/Pioneer/rekordbox/master.db.antes-2a` y `cp ~/Library/Pioneer/rekordbox/masterPlaylists6.xml ~/Library/Pioneer/rekordbox/masterPlaylists6.xml.antes-2a`.
1. Con rekordbox cerrado, comprueba con `ls -la ~/Library/Pioneer/rekordbox/master.db-wal` si queda un `-wal` con tamaño (Q3).
2. En Surco, carril rekordbox: crea la playlist "Surco prueba" en la raíz y la carpeta "Surco carpeta" con una playlist "Surco dentro" (menú contextual de la carpeta).
3. Arrastra 3 filas de Factory sobre "Surco prueba" en el árbol (Q5: ¿se ilumina con «+3 al soltar» y entran?). Arrastra también un fichero desde Finder que ya esté en la colección. Ábrela, reordénalas con el asa, inserta un separador encima de la segunda y quita una.
4. Abre rekordbox (Q1): ¿están las dos playlists y la carpeta, al final de su sitio, con las pistas en ese orden, el separador en su sitio y los cues intactos? Cierra y abre rekordbox otra vez y vuelve a mirar.
5. ¿Avisa rekordbox de algo raro al abrir (Q2, Q4)? Si quieres, borra las playlists de prueba desde rekordbox.

Volver atrás si algo sale mal: cierra rekordbox; si `master.db-wal` existe y no está vacío, para y avísame; si no, restaura tu copia del paso 0: `cp ~/Library/Pioneer/rekordbox/master.db.antes-2a ~/Library/Pioneer/rekordbox/master.db` y `cp ~/Library/Pioneer/rekordbox/masterPlaylists6.xml.antes-2a ~/Library/Pioneer/rekordbox/masterPlaylists6.xml`. Las copias de Surco no sirven para esto con seguridad: `.surco-session` se vuelve a tomar en cada tanda de conversión y cada vez que abres Surco, así que puede ser posterior a la prueba, y `.surco-backup` es solo el estado antes del último cambio. rekordbox guarda además sus copias fechadas `master.backup.AAAAMMDD.db` en la misma carpeta, como último recurso.

- [ ] **Step 8: Report**

Screenshots, the `measure.cjs` numbers before and after, the XML diff and the answers to Q1..Q6 that this task could settle go into the final summary. Nothing is called done without this task.
