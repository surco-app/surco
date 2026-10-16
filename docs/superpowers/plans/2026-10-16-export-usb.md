# Export rekordbox playlists to a USB stick, fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From Surco, the DJ ticks rekordbox playlists (or whole folders), picks a removable stick identified by its Volume UUID, and presses Exportar: Surco reads `master.db` read-only, prepares baken's input, and a bundled, patched `baken expressport` writes a stick every CDJ and XDJ reads (Device Library + OneLibrary), copying only what changed, with a per-track progress list whose waveforms fill as the bytes land.

**Architecture:** The main process reads the selection from `master.db` (`usbExportSource.ts`), stages a work folder with the XML, the analysis files (PVDI masked as rekordbox does), the artwork per TrackID and the My Settings (`usbExportStage.ts`, `bakenXml.ts`, `anlz.ts`), and drives baken through its new `--json` line protocol (`bakenRun.ts`), first as a dry run for the summary and then for real (`usbExport.ts`), after re-checking the Volume UUID. Removable volumes come from `diskutil` and a watch on `/Volumes` (`usbVolumes.ts`); a per-stick memory lives in `usb-exports.json` (`usbExportMemory.ts`). The renderer has one modal with two faces, choosing (tree with checkboxes, stick chooser, summary) and exporting (the track list with the revealing waveforms), plus a toolbar pill and the top progress line while it runs in the background.

**Tech Stack:** Electron + React 19 + TS, TanStack Query (not needed here), Tailwind v4, lucide-react, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), biome; Rust (cargo) only for the baken patch series.

**Spec:** `docs/superpowers/specs/2026-10-16-export-usb-design.md`, and the spike findings it rests on (copied to `docs/export-usb-medidas.md` in Task 1).

**Platform:** macOS only in this plan. On Windows and Linux nothing of this appears (no button, no command, no notice, no IPC listener that does anything but answer "unsupported").

**Out of scope:** Windows/Linux, porting baken to TS, formatting the stick, `--cdjsafe`, protecting a rekordbox stick, My Tag / `exportExt.pdb`, hand-assigned hot cue colours (exported with their letter's default), exporting from Engine/Traktor/the working list, two exports at once.

## Global Constraints

- **Never write anything under `~/Library/Pioneer`** and never point baken at it: baken always gets `--anlz-dir` (Surco's staged copy) and `--settings-dir` (staged copy) or `--no-settings`, and `bakenArgs` refuses a device or a staged path inside `~/Library/Pioneer`, the home folder itself or `/`. `master.db` is opened with `{ readonly: true }` only, through `openRekordboxDb`.
- **Never write a volume that is not the selected one.** A volume target is resolved by `VolumeUUID` to its mount point, and `diskutil info` is asked again for that mount point right before baken is spawned; a different or missing UUID writes nothing (`volume-changed` / `volume-gone`). Volumes are never matched by name.
- **Never delete user files.** Surco itself deletes nothing on the stick. baken writes only `PIONEER/` and `Contents/` at the volume root; `--prune` (removes unreferenced files only inside `Contents/`, `PIONEER/USBANLZ/`, `PIONEER/Artwork/`) is passed only when the user ticked "Borrar del USB la música que ya no se exporta", which defaults to off.
- **Tests never touch a real stick, a real `master.db`, `~/Library` or the real baken.** Main tests use the encrypted fixtures and a fake baken (a Node script speaking the same JSON lines). Verification (Task 12) uses only the test stick with Volume UUID `B10C96EF-51C2-344E-B78D-DAFC319D973E`, after checking that no other removable volume is mounted.
- baken is pinned: upstream tag `v4.6.1` (commit `c97435a978cafb949ee052afbd6ea9b7bff6fd0b`) plus `apps/desktop/vendor/baken/patches/*.patch`, built from that source by `scripts/build-baken.mjs` on each build machine (CI and local) into `apps/desktop/resources/baken/`. Nothing is published to `surco-releases` (an extra release there would be seen by the website and the updater). Spawned with `BAKEN_NO_UPDATE_CHECK=1`.
- baken's JSON line protocol (stdout, one object per line, produced by patch 0003) is the only interface Surco reads; its human output is never parsed:
  - `{"event":"plan","tracks":[{"id":N,"usbPath":"/Contents/..","size":N,"onStick":bool}],"spaceNeeded":N,"spaceAvailable":N|null,"warnings":[".."],"skipped":[{"name":"..","reason":".."}],"onelibraryFiles":[".."]}`
  - `{"event":"start","index":N,"usbPath":"..","size":N}`, `{"event":"written","index":N,"kept":bool}`, `{"event":"failed","index":N,"message":".."}`, `{"event":"database"}`
  - `{"event":"report","copied":N,"kept":N,"failures":[{"name":"..","message":".."}],"cancelled":bool,"onelibraryWritten":bool,"onelibraryError":".."|null,"artwork":N,"pruned":N,"tracksInDatabase":N}`
  - `{"event":"error","kind":"not-enough-space"|"device-write"|"device-not-found"|"other","message":"..","needed":N?,"available":N?}`
- Hot cue letters from `djmdCue.Kind`: 0 memory cue (`Num -1`), 1..3 → A..C (`Num` 0..2), 5..9 → D..H (`Num` 3..7), 4 never used (measured on Vicent's collection, 16/10). Hot cues go to the XML without colour; patch 0001 gives them rekordbox's default for their letter.
- PVDI masking (measured exact on 5 of 5 tracks, 16/10): for a `PVDI` section longer than 24 bytes whose byte 12 lacks `0x80`, set `0x80` in byte 12 and XOR every byte from offset 24 with `1e dd 1e 19 02 19 1b 11 19 23 18 19 24 11 fb 11 1e 2a 15` cycling from the section's byte 24. A `.2EX` with no `PVDI` gets the empty one appended, `50564449 00000018 00000018 00000400 56220001 00000000`, and the `PMAI` total length (u32 big-endian at offset 8) grows by 24.
- One export at a time. The renderer's cancel is hidden from the `database` event on (cutting between `export.pdb` and `exportLibrary.db` would leave two different libraries).
- UI text in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`); no em dash and no explanatory colons in any UI text. Errors cross IPC as reason codes and are translated in the renderer.
- Test selectors: `data-testid` always.
- Comments: the repo documents the WHY in comments on nearly every block (see `rekordboxPlaylists.ts`). Follow that repo convention, which conflicts with the global "zero comments" rule; conformance with the existing code wins (ruled on 15/10 for this branch), flagged here so nobody "fixes" it.
- Tests from `apps/desktop` of the worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (the worktree has no `node_modules` of its own; never filter from the repo root, it skips the setup). Types from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit` and `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` (bare `tsc` checks nothing). Lint and format: `npm exec --workspace apps/desktop -- biome check --write src`.
- `$SCRATCH` is the session scratchpad. Locale strings are merged with this helper (run from `apps/desktop`). Write it once:

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

- Commits: descriptive English title, no body, no `feat:`. One per task unless the task says otherwise.

## Decisions taken where the spec or the request left room

1. **baken is patched and built by Surco, not used as published.** Progress, the "ya estaba" state, rekordbox's default hot cue colours and the cached artwork cannot be had from outside: baken's human output is an `indicatif` bar that disappears off a TTY, and artwork lives in `export.pdb` tables. Three small patches, each offered upstream; each one is deleted from `patches/` once baken releases it.
2. **PVDI is masked in Surco's staged copy, not by a baken patch and not after baken.** baken copies `.2EX` verbatim apart from the path, so the masked bytes flow through. Patching the stick afterwards would make baken's byte comparison rewrite every analysis file on every export, which is the slow part on FAT32 (about 0.4 s of metadata per track).
3. **Unreferenced music stays by default** (`--prune` only on request): re-ticking a playlist must cost nothing, and a full stick is refused before anything is written (baken's space estimate).
4. **The per-stick memory is its own file** (`usb-exports.json` in userData), not `settings.json`: it is machine-local and grows with track IDs.
5. **Who wrote the stick**: `exportExt.pdb` present means rekordbox (baken always removes it); otherwise `export.pdb` with the size and mtime (±2 s, FAT's resolution) Surco remembered means Surco; no `export.pdb` means empty; anything else is "tiene una exportación" with its date.
6. **The analysis files are staged fresh for every summary and every export**, only for the selected tracks. A persistent cache would let stale or unrelated files into baken's filename matching. Task 1 measures the cost on 500 tracks; Task 9 debounces the summary.
7. **The summary reuses baken's dry run** (`--dry-run --json`), so "X nuevas" and the space check are baken's own judgement, not a reimplementation of its paths. When baken refuses the plan for space, Surco builds the summary from its own selection with every track counted as new and the `noSpace` warning.
8. **Per-track bytes come from polling the destination file** every 250 ms (baken writes the audio in place in 4 MB pieces), only for tracks the plan says are not on the stick.
9. **CDJ-2000 warnings** are FLAC (`FileType` 5), more than 24 bits or more than 48 kHz, from `djmdContent` (no file probing).
10. **The modal's waveform** is rekordbox's `PWAV` preview from the local `.DAT` (400 columns, 5-bit heights), reduced to 100 bars by maximum; no audio is decoded. Covers are rekordbox's `_s` thumbnail next to `ImagePath`, as a data URL, or nothing.
11. **`escapeXml` moves from `renderer/src/lib/xml.ts` to `shared/xml.ts`** so the main process can use it; the two renderer importers are updated. The repo's own comment on that file forbids copy-pasting the escaping per exporter.
12. **Separators are exported as tracks** (they separate on the CDJ too) but not counted in "N pistas".
13. **baken is compiled inside each platform's build, not downloaded.** Each mac runner builds its own arch (7.5 MB instead of the 15 MB universal binary) with a cargo cache; no binary hosting, no token, and the shipped binary always matches the patches in the repo.

## Review Focus

1. **Two sticks with the same name, or a stick swapped between the summary and the export.** The export goes to the UUID chosen or nowhere; the mount point `/Volumes/Vicent 1` of the second stick is never confused with `/Volumes/Vicent`. Pinned in Task 8 (volumes keyed by UUID, `uuidAt`) and Task 9 (`volume-changed`, nothing spawned).
2. **A folder and one of its playlists both ticked, or one track in two ticked playlists.** Each track once in the collection and on the stick, both playlists list it in their own order. Pinned in Task 5 (dedupe, folder expansion) and Task 6 (XML).
3. **Closing the modal mid-export, or pressing Cancel during the database phase.** Closing never stops baken; Cancel kills it only before the `database` event, and after it the button is gone ("Terminando…"). Pinned in Task 9 (exporter) and Task 11 (modal).
4. **rekordbox open, or the collection mid-write, while summarising or exporting.** Read-only open works with rekordbox open; a collection that does not decrypt answers `unreadable` and writes nothing. Pinned in Task 9.
5. **A track whose file is gone or whose NAS is asleep, a streaming row, a track without analysis.** Missing and streaming rows are named in the summary and left out of the XML; the rest exports; a track without analysis still exports (baken computes its waveform) and its row shows a flat bar. Pinned in Task 7 (stage), Task 9 (warnings) and Task 10 (flat bar).

---

## File structure

| File | Responsibility |
|---|---|
| `docs/export-usb-medidas.md` (new, Task 1) | the spike's measured facts, the columns and counts measured on the collection, diskutil shapes, staging cost |
| `apps/desktop/src/main/fixtures/diskutil-*.plist` (new, Task 1) | real `diskutil info -plist` outputs for the volume tests |
| `apps/desktop/vendor/baken/` (new, Task 2) | `UPSTREAM`, `patches/`, `LICENSE` |
| `scripts/build-baken.mjs` (new, Task 3) | clones the pinned tag, applies the patches, builds for this machine into `apps/desktop/resources/baken/` |
| `.github/workflows/release.yml`, `build-test.yml` (mod, Task 3) | build baken (cargo cache) before packaging |
| `apps/desktop/electron-builder.yml`, `.gitignore`, `README.md` (mod, Task 3) | ship the binary and its licence |
| `src/main/bakenPath.ts` (new, Task 3) | where the binary is, packaged or not |
| `src/main/anlz.ts` (new, Task 4) | ANLZ sections, `PQTZ` grid, `PWAV` preview, `PVDI` mask |
| `src/main/rekordboxExportFixture.ts` (new, Task 5) | the encrypted fixture with the columns and tables export reads |
| `src/main/rekordboxPlaylists.ts` (mod, Task 5) | exports `LIVE_LINK` |
| `src/main/usbExportSource.ts` (new, Task 5) | the selection read from `master.db` |
| `src/shared/xml.ts` (moved, Task 6) | `escapeXml` for both processes |
| `src/main/bakenXml.ts` (new, Task 6) | baken's input XML |
| `src/main/usbExportStage.ts` (new, Task 7) | the work folder |
| `src/main/bakenRun.ts` (new, Task 7) | arguments with guards, JSON line parser, spawn and kill |
| `src/main/usbVolumes.ts` (new, Task 8) | plist parsing, removable filter, holder, list and watch |
| `src/main/usbExportMemory.ts` (new, Task 8) | `usb-exports.json` |
| `src/main/usbExport.ts` (new, Task 9) | summary, export, progress, cancel, memory |
| `src/main/usbExportIpc.ts` (new, Task 9) | IPC handlers and the volume watch |
| `src/main/index.ts` (mod, Task 9) | wiring |
| `src/shared/types.ts` (mod, Task 9) | `UsbVolume`, `UsbTarget`, `UsbPlan`, `UsbExportEvent`… |
| `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts` (mod, Task 9) | the calls and their stubs |
| `src/renderer/src/lib/usbExport.ts` (new, Task 10) | progress reducer, speed and time left, waveform path |
| `src/renderer/src/components/TrackWave.tsx`, `ExportTrackRow.tsx`, `UsbExportProgress.tsx` (new, Task 10) | the exporting face |
| `src/renderer/src/components/CheckTree.tsx`, `UsbExportModal.tsx` (new, Task 11) | the choosing face |
| `src/renderer/src/hooks/useUsbVolumes.ts`, `useUsbExport.ts`, `useUsbPlan.ts` (new, Task 11) | live state |
| `src/renderer/src/components/SourceTree.tsx`, `Toolbar.tsx`, `lib/commands.ts`, `App.tsx` (mod, Task 11) | the entry points, the pill, the connect notice |
| `src/renderer/src/i18n/locales/*.json` (mod, Tasks 10-11) | `usbExport.*` |

All paths below are relative to `apps/desktop/` unless they start with `docs/`, `.github/`, `scripts/` or `README.md`, which are relative to the worktree root.

---
### Task 1: Measure what the code will rest on, and keep the spike's findings in the repo

**Files:**
- Create: `docs/export-usb-medidas.md`
- Create: `src/main/fixtures/diskutil-usb-exfat.plist`, `src/main/fixtures/diskutil-usb-whole.plist`, `src/main/fixtures/diskutil-internal.plist`
- Scratch only (not committed): `$SCRATCH/usb-plan/`

**Interfaces:**
- Consumes: nothing.
- Produces: the measured column names of `djmdContent` and `djmdCue` that Task 5 reads; the count of hot cues with Kind 8 and 9 (G, H) and of hand-coloured cues; the real `diskutil` plists Task 8 parses; the staging cost Decision 6 rests on.

- [ ] **Step 1: Copy the collection (read-only use) and the spike's notes**

```bash
mkdir -p "$SCRATCH/usb-plan"
cp ~/Library/Pioneer/rekordbox/master.db "$SCRATCH/usb-plan/master.db"
[ -f ~/Library/Pioneer/rekordbox/master.db-wal ] && cp ~/Library/Pioneer/rekordbox/master.db-wal "$SCRATCH/usb-plan/master.db-wal"
pgrep -x rekordbox >/dev/null && echo "rekordbox OPEN while copying" || echo "rekordbox closed while copying"
cp "$SCRATCH/usb-spike/findings.md" "$SCRATCH/usb-plan/findings.md"
```

- [ ] **Step 2: Measure the columns and the cue counts**

```bash
cat > "$SCRATCH/usb-plan/measure.cjs" <<'EOF'
const Database = require('/Users/vicent/code/surco/node_modules/better-sqlite3-multiple-ciphers')
const db = new Database(process.argv[2], { readonly: true })
db.pragma(`cipher='sqlcipher'`)
db.pragma('legacy=4')
db.pragma(`key='402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497'`)
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).join(', ')
for (const t of ['djmdContent', 'djmdCue', 'djmdArtist', 'djmdAlbum', 'djmdGenre', 'djmdLabel', 'djmdKey'])
  console.log(`${t}: ${cols(t)}`)
console.log('cue kinds', db.prepare(`SELECT Kind, count(*) n FROM djmdCue WHERE coalesce(rb_local_deleted,0)=0 GROUP BY Kind`).all())
console.log('hot cue colours', db.prepare(`SELECT Color, ColorTableIndex, count(*) n FROM djmdCue WHERE Kind > 0 AND coalesce(rb_local_deleted,0)=0 GROUP BY Color, ColorTableIndex`).all())
console.log('analysis path sample', db.prepare(`SELECT AnalysisDataPath FROM djmdContent WHERE AnalysisDataPath <> '' LIMIT 2`).all())
console.log('image path sample', db.prepare(`SELECT ImagePath FROM djmdContent WHERE ImagePath <> '' LIMIT 2`).all())
console.log('without analysis', db.prepare(`SELECT count(*) n FROM djmdContent WHERE coalesce(AnalysisDataPath,'') = '' AND FileType <> 25`).get())
console.log('flac / >24 bit / >48 kHz', db.prepare(`SELECT sum(FileType = 5) flac, sum(BitDepth > 24) deep, sum(SampleRate > 48000) fast FROM djmdContent`).get())
EOF
node "$SCRATCH/usb-plan/measure.cjs" "$SCRATCH/usb-plan/master.db" | tee "$SCRATCH/usb-plan/measure.txt"
ls ~/Library/Pioneer/rekordbox/share/PIONEER/Artwork | head -3
ls "$HOME/Library/Application Support/Pioneer/rekordbox6" | grep -E 'SETTING|djprofile'
```

Expected: `djmdContent` lists at least `ID, FolderPath, Title, ArtistID, AlbumID, GenreID, LabelID, RemixerID, ComposerID, KeyID, Subtitle, FileType, Length, BPM, BitRate, SampleRate, BitDepth, Rating, ReleaseYear, TrackNo, DiscNo, DateCreated, DJPlayCount, Commnt, AnalysisDataPath, ImagePath`; `djmdCue` at least `ContentID, InMsec, OutMsec, Kind, Comment, Color, ColorTableIndex, rb_local_deleted`. If any column Task 5 names is missing, stop and report (Task 5's SQL names them). Then, for the artwork thumbnail rule of Decision 10, check one `ImagePath` on disk:

```bash
img=$(sed -n "s/.*ImagePath: '\(\/PIONEER[^']*\)'.*/\1/p" "$SCRATCH/usb-plan/measure.txt" | head -1)
ls -la "$HOME/Library/Pioneer/rekordbox/share$(dirname "$img")"
```

Expected: the folder holds `artwork.jpg` (or the `ImagePath` name) and an `_s` sibling of the same stem (e.g. `artwork_s.jpg`). If the small one is named differently, write the real rule in the note and use it in Task 7 (`smallCoverPath`).

- [ ] **Step 3: Save the real diskutil shapes**

Run from `apps/desktop`. Mount the test stick only (Volume UUID `B10C96EF-51C2-344E-B78D-DAFC319D973E`, exFAT, named `Surco`). Reading `diskutil` writes nothing.

```bash
mkdir -p src/main/fixtures
diskutil info -plist /Volumes/Surco > src/main/fixtures/diskutil-usb-exfat.plist
grep -A1 '<key>VolumeUUID</key>' src/main/fixtures/diskutil-usb-exfat.plist
whole=$(/usr/libexec/PlistBuddy -c 'Print :ParentWholeDisk' src/main/fixtures/diskutil-usb-exfat.plist)
diskutil info -plist "$whole" > src/main/fixtures/diskutil-usb-whole.plist
diskutil info -plist / > src/main/fixtures/diskutil-internal.plist
/usr/libexec/PlistBuddy -c 'Print :Content' src/main/fixtures/diskutil-usb-whole.plist
diskutil info -plist /Volumes/Public; echo "exit $?"
```

Expected: the UUID line prints `B10C96EF-51C2-344E-B78D-DAFC319D973E`; `Content` prints `FDisk_partition_scheme` (MBR) or `GUID_partition_scheme`; the NAS share answers `Could not find disk` with exit 1 (so network volumes fall out without a special case). Write down `Internal`, `RemovableMediaOrExternalDevice`, `Ejectable`, `BusProtocol`, `FilesystemType`, `FilesystemName`, `FreeSpace`, `TotalSize` of the stick in the note. If `Internal` is not `false` or both `RemovableMediaOrExternalDevice` and `Ejectable` are not `true`, stop: Task 8's filter rests on them.

- [ ] **Step 4: Measure the staging cost**

Copy the `.DAT/.EXT/.2EX` of the first 500 analysed tracks to a scratch folder and time it (this is what every summary does in Decision 6):

```bash
cat > "$SCRATCH/usb-plan/stage-cost.cjs" <<'EOF'
const fs = require('node:fs'), path = require('node:path')
const Database = require('/Users/vicent/code/surco/node_modules/better-sqlite3-multiple-ciphers')
const db = new Database(process.argv[2], { readonly: true })
db.pragma(`cipher='sqlcipher'`); db.pragma('legacy=4')
db.pragma(`key='402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497'`)
const share = path.join(process.env.HOME, 'Library/Pioneer/rekordbox/share')
const out = fs.mkdtempSync(path.join(process.argv[3], 'stage-'))
const rows = db.prepare(`SELECT AnalysisDataPath p FROM djmdContent WHERE AnalysisDataPath <> '' LIMIT 500`).all()
const t0 = Date.now(); let files = 0
for (const { p } of rows) for (const ext of ['DAT', 'EXT', '2EX']) {
  const src = path.join(share, p.replace(/\.DAT$/, `.${ext}`))
  if (!fs.existsSync(src)) continue
  const dst = path.join(out, p.replace(/\.DAT$/, `.${ext}`))
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); files++
}
console.log(`${rows.length} tracks, ${files} files, ${Date.now() - t0} ms`)
fs.rmSync(out, { recursive: true, force: true })
EOF
node "$SCRATCH/usb-plan/stage-cost.cjs" "$SCRATCH/usb-plan/master.db" "$SCRATCH/usb-plan"
```

Expected: one line with the time. Under 3 s for 500 tracks keeps Decision 6; above it, write the number in the note and flag it to the coordinator before Task 9 (a per-session cache would then be needed).

- [ ] **Step 5: Write the note**

Create `docs/export-usb-medidas.md` in Spanish with: the spike's "Fase 2" verdict and its difference table (from `findings.md`, trimmed to what this plan acts on); the PVDI rule and empty section (Global Constraints); the default hot cue colours A..F (255/0/23, 0/196/255, 51/255/0, 77/0/255, 0/255/48, 255/94/0) and the Kind 8/9 and hand-coloured counts from Step 2 (if G or H exist in the collection, say so: patch 0001 then needs their default colour measured from a rekordbox export before Task 12); the columns of Step 2; the diskutil fields of Step 3; the staging time of Step 4; and the open questions handed to Task 12 (exFAT on CDJ-2000 not testable on this stick; OneLibrary on 3000X/XDJ-AZ validated once by Vicent with the spike stick).

- [ ] **Step 6: Delete the copies and commit**

From the worktree root:

```bash
rm -f "$SCRATCH/usb-plan/master.db" "$SCRATCH/usb-plan/master.db-wal"
git add docs/export-usb-medidas.md apps/desktop/src/main/fixtures/diskutil-usb-exfat.plist apps/desktop/src/main/fixtures/diskutil-usb-whole.plist apps/desktop/src/main/fixtures/diskutil-internal.plist
git commit -m "Record the measured facts behind the USB export"
```

---
### Task 2: The baken patch series (JSON lines, default hot cue colours, artwork folder)

**Files:**
- Create: `vendor/baken/UPSTREAM`, `vendor/baken/LICENSE`, `vendor/baken/patches/0001-default-hot-cue-colours.patch`, `vendor/baken/patches/0002-artwork-dir.patch`, `vendor/baken/patches/0003-json-lines.patch`
- Scratch only: `$SCRATCH/baken-build/` (a clone of baken where the patches are written and tested)

**Interfaces:**
- Consumes: Task 1's note (if hot cues G or H exist in the collection, their default colours must be measured before patch 0001 is final; otherwise it ships A..F as below).
- Produces: `baken expressport --json` speaking exactly the protocol in Global Constraints; `--artwork-dir DIR` reading `<TrackID>.jpg|.jpeg|.png`; hot cues without an XML colour written as code 0 + their letter's RGB (A..F). Task 3 builds these; Tasks 7 and 9 consume the protocol.

The toolchain the spike installed works here:

```bash
export CARGO_HOME="$SCRATCH/usb-spike/tools/cargo" RUSTUP_HOME="$SCRATCH/usb-spike/tools/rustup"
export PATH="$CARGO_HOME/bin:$PATH"
cargo --version
```

- [ ] **Step 1: Clone the pinned tag**

```bash
git clone --branch v4.6.1 https://github.com/M-Igashi/baken "$SCRATCH/baken-build"
cd "$SCRATCH/baken-build"
git rev-parse HEAD
```

Expected: `c97435a978cafb949ee052afbd6ea9b7bff6fd0b`. Anything else: stop, the plan is pinned to that commit.

- [ ] **Step 2: Patch 0001, red: rekordbox's default colour per letter**

In `crates/baken-export/src/anlz/cues.rs`, inside `fn hot_cue_colours_follow_rekordbox`, replace the last assertion

```rust
        assert_eq!(hot_colour(&hot(None)), NO_COLOUR);
```

with

```rust
        // No colour is rekordbox's default for the letter: code 0 and that letter's RGB, as
        // rekordbox 7.2.19 wrote A to F on a stick (16/10/2026). Writing green for every
        // letter made the pads of an exported stick differ from rekordbox's.
        for (num, [r, g, b]) in [
            (0, [0xff, 0x00, 0x17]),
            (1, [0x00, 0xc4, 0xff]),
            (2, [0x33, 0xff, 0x00]),
            (3, [0x4d, 0x00, 0xff]),
            (4, [0x00, 0xff, 0x30]),
            (5, [0xff, 0x5e, 0x00]),
        ] {
            let c = Cue {
                num,
                rgb: None,
                ..Default::default()
            };
            assert_eq!(hot_colour(&c), [0, r, g, b], "letter {num}");
        }
        // G and H were not measured, so they keep the form baken wrote before
        let g = Cue {
            num: 6,
            ..Default::default()
        };
        assert_eq!(hot_colour(&g), NO_COLOUR);
```

Run: `cargo test -p baken-export hot_cue_colours_follow_rekordbox`
Expected: FAIL, `letter 0` left `[0, 26, 255, 0]` right `[0, 255, 0, 23]`.

- [ ] **Step 3: Patch 0001, green**

In the same file, just above `fn hot_colour`, add

```rust
/// What rekordbox 7.2.19 writes for a hot cue left without a colour: code 0 and the RGB of
/// its letter, read off a stick it exported (16/10/2026) for A to F. G and H were not
/// measured and keep [`NO_COLOUR`].
const LETTER_DEFAULTS: [[u8; 3]; 6] = [
    [0xff, 0x00, 0x17],
    [0x00, 0xc4, 0xff],
    [0x33, 0xff, 0x00],
    [0x4d, 0x00, 0xff],
    [0x00, 0xff, 0x30],
    [0xff, 0x5e, 0x00],
];
```

and replace the first statement of `hot_colour`

```rust
    let Some((r, g, b)) = c.rgb else {
        return NO_COLOUR;
    };
```

with

```rust
    let Some((r, g, b)) = c.rgb else {
        return usize::try_from(c.num)
            .ok()
            .and_then(|n| LETTER_DEFAULTS.get(n))
            .map_or(NO_COLOUR, |&[r, g, b]| [0, r, g, b]);
    };
```

and in its doc comment replace the sentence `A hot cue without a colour in the XML gets the same.` with `A hot cue without a colour in the XML gets rekordbox's default for its letter ([`LETTER_DEFAULTS`]).`

Run: `cargo test -p baken-export` 
Expected: PASS (all). If `colours_match_rekordbox_export` runs (its fixture lives outside the repo and is usually absent) and fails on a letter without colour, report it: that fixture predates rekordbox 7.2.19.

```bash
git checkout -b surco
git commit -am "Write rekordbox's default colour for a hot cue without one"
```

- [ ] **Step 4: Patch 0002, red: a picture from a folder by TrackID**

In `crates/baken-export/tests/artwork.rs`, after `fn the_cover_goes_onto_the_stick_as_rekordbox_writes_it`, add

```rust
/// rekordbox shows covers it keeps in its own cache (every WAV's, and those of files whose
/// tags carry none), which no file holds; a front-end that has them puts each one in a
/// folder under the track's TrackID, and it wins over the embedded picture.
#[test]
fn a_picture_in_the_artwork_dir_goes_where_the_file_has_none() {
    let (root, mut opts) = library("dir");
    let dir = root.join("art");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("2.png"), png(64, 64)).unwrap();
    opts.artwork_dir = Some(dir);
    let report = export(&plan(&opts).unwrap(), &(), &CancelToken::new()).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.artwork, 2, "the plain track gets the folder's picture");
    assert!(art(&opts, "a2.jpg").exists());
    std::fs::remove_dir_all(&root).unwrap();
}
```

Run: `cargo test -p baken-export --test artwork`
Expected: FAIL to compile, `no field artwork_dir on type Options`.

- [ ] **Step 5: Patch 0002, green**

`crates/baken-export/src/artwork.rs`, after `pub fn for_file`:

```rust
/// The thumbnails of `<dir>/<id>.jpg`, `.jpeg` or `.png`, the picture a front-end put
/// there for TrackID `id`; `None` when there is none or it does not decode.
pub fn from_dir(dir: &Path, id: u64) -> Option<Thumbnails> {
    ["jpg", "jpeg", "png"]
        .iter()
        .find_map(|ext| std::fs::read(dir.join(format!("{id}.{ext}"))).ok())
        .and_then(|bytes| thumbnails(&bytes))
}
```

`crates/baken-export/src/lib.rs`:
- in `pub struct Options`, after `pub artwork: bool,` add

```rust
    /// With `artwork`: a folder of pictures named by TrackID that take precedence over
    /// the picture embedded in the audio ([`artwork::from_dir`]).
    pub artwork_dir: Option<PathBuf>,
```

- in `pub struct Plan`, after `pub artwork: bool,` add `pub artwork_dir: Option<PathBuf>,`
- in `plan`, in the `Ok(Plan { .. })` literal, after `artwork: opts.artwork,` add `artwork_dir: opts.artwork_dir.clone(),`
- in `fn prepare`, replace `prepared.artwork = artwork::for_file(&pt.source);` with

```rust
        prepared.artwork = plan
            .artwork_dir
            .as_deref()
            .and_then(|dir| artwork::from_dir(dir, pt.device.track.id))
            .or_else(|| artwork::for_file(&pt.source));
```

`crates/baken/src/args.rs`, in `ExpressportArgs` after the `artwork` field:

```rust
    /// With --artwork: a folder of pictures named <TrackID>.jpg or .png that take
    /// precedence over the picture embedded in each audio file.
    #[arg(long, value_name = "DIR", requires = "artwork")]
    pub artwork_dir: Option<PathBuf>,
```

`crates/baken/src/expressport.rs`, in the `Options { .. }` literal after `artwork: args.artwork,` add `artwork_dir: args.artwork_dir.clone(),`

Run: `cargo test -p baken-export` and `cargo build -p baken`
Expected: PASS, builds.

```bash
git commit -am "Take artwork from a folder of pictures named by TrackID"
```

- [ ] **Step 6: Patch 0003, red: the track events**

In `crates/baken-export/tests/artwork.rs` (it owns the two-track library helper), add

```rust
use baken_core::{Progress, TrackEvent};
use std::sync::Mutex;

#[derive(Default)]
struct Recorder(Mutex<Vec<String>>);

impl Progress for Recorder {
    fn on_file_done(&self, _done: usize, _total: usize, _file: &Path) {}
    fn on_track(&self, event: TrackEvent<'_>) {
        let line = match event {
            TrackEvent::Start { index, .. } => format!("start {index}"),
            TrackEvent::Written { index, kept } => format!("written {index} {kept}"),
            TrackEvent::Failed { index, .. } => format!("failed {index}"),
            TrackEvent::Database => "database".into(),
        };
        self.0.lock().unwrap().push(line);
    }
}

/// A front-end shows each track as it starts and lands, whether its audio was already on
/// the stick, and when the database is being written (when stopping the run is no longer
/// safe). The second run copies nothing.
#[test]
fn the_export_reports_each_track_and_then_the_database() {
    let (root, opts) = library("events");
    let first = Recorder::default();
    export(&plan(&opts).unwrap(), &first, &CancelToken::new()).unwrap();
    assert_eq!(
        first.0.into_inner().unwrap(),
        ["start 0", "written 0 false", "start 1", "written 1 false", "database"]
    );
    let again = Recorder::default();
    export(&plan(&opts).unwrap(), &again, &CancelToken::new()).unwrap();
    assert_eq!(
        again.0.into_inner().unwrap(),
        ["start 0", "written 0 true", "start 1", "written 1 true", "database"]
    );
    std::fs::remove_dir_all(&root).unwrap();
}
```

Run: `cargo test -p baken-export --test artwork`
Expected: FAIL to compile, `no TrackEvent in the root`.

- [ ] **Step 7: Patch 0003, green: the events**

`crates/baken-core/src/progress.rs`, replace the trait with

```rust
/// What happens to one track of an export, for a front-end that shows it.
pub enum TrackEvent<'a> {
    /// The writer takes track `index` (plan order); `size` is its source's.
    Start {
        index: usize,
        usb_path: &'a str,
        size: u64,
    },
    /// Its files are on the stick; `kept` when the audio already was.
    Written { index: usize, kept: bool },
    /// It failed on its own and stays out of the database; the run goes on.
    Failed { index: usize, message: &'a str },
    /// Every track is done and the databases are being written: stopping now would
    /// leave `export.pdb` and `exportLibrary.db` describing different libraries.
    Database,
}

/// Receives per-file completion events from long-running operations.
/// Files are processed in parallel, so `file` is the one that just finished,
/// not necessarily the next in input order. Called from worker threads.
pub trait Progress: Sync {
    fn on_file_done(&self, done: usize, total: usize, file: &Path);
    /// Export only; the default ignores it.
    fn on_track(&self, _event: TrackEvent<'_>) {}
}
```

`crates/baken-core/src/lib.rs`: `pub use progress::Progress;` becomes `pub use progress::{Progress, TrackEvent};`

`crates/baken-export/src/lib.rs`:
- `use baken_core::{fsname, CancelToken, Progress};` becomes `use baken_core::{fsname, CancelToken, Progress, TrackEvent};`
- in `export`, replace `match prepared.and_then(|p| write_track(plan, pt, p, &mut report)) {` with

```rust
            progress.on_track(TrackEvent::Start {
                index: i,
                usb_path: &pt.device.usb_path,
                size: pt.device.file_size,
            });
            let kept_before = report.kept;
            match prepared.and_then(|p| write_track(plan, pt, p, &mut report)) {
```

- in its `Ok(dt) => {` arm, as the arm's first statement:

```rust
                    progress.on_track(TrackEvent::Written {
                        index: i,
                        kept: report.kept > kept_before,
                    });
```

- in its `Err(e) => {` arm, between the `let message = …;` statement and `report.failures.push(…)`:

```rust
                    progress.on_track(TrackEvent::Failed {
                        index: i,
                        message: &message,
                    });
```

- right before `let date = build::today();`:

```rust
    progress.on_track(TrackEvent::Database);
```

Run: `cargo test -p baken-export --test artwork`
Expected: PASS.

- [ ] **Step 8: Patch 0003, the `--json` front-end**

`crates/baken/Cargo.toml`, under `[dependencies]`: `serde_json.workspace = true`

`crates/baken/src/main.rs`, after `mod expressport;` (keep its `#[cfg(feature = "expressport")]`):

```rust
#[cfg(feature = "expressport")]
mod json;
```

`crates/baken/src/args.rs`, in `ExpressportArgs` before `pub dry_run: bool`:

```rust
    /// One JSON object per line on stdout (the plan, each track, the report or an error)
    /// instead of the progress bar, for a front-end that drives the export.
    #[arg(long)]
    pub json: bool,
```

`crates/baken/src/expressport.rs`, right after the `let opts = Options { .. };` statement:

```rust
    if args.json {
        return crate::json::run(&opts, args.dry_run);
    }
```

Create `crates/baken/src/json.rs`:

```rust
//! `expressport --json`: one JSON object per line on stdout, for a front-end that drives
//! the export and shows its progress. The human output is a progress bar that vanishes
//! when stdout is not a terminal, so a front-end had nothing to read.

use baken_core::{CancelToken, Progress, TrackEvent};
use baken_export::{export, plan, Error, Options, Plan, Report};
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;

fn emit(value: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

pub fn run(opts: &Options, dry_run: bool) -> anyhow::Result<()> {
    let plan = match plan(opts) {
        Ok(plan) => plan,
        Err(e) => fail(&e),
    };
    emit(plan_json(&plan));
    if dry_run {
        return Ok(());
    }
    match export(&plan, &JsonProgress, &CancelToken::new()) {
        Ok(report) => {
            emit(report_json(&report));
            Ok(())
        }
        Err(e) => fail(&e),
    }
}

/// The error as the last line, and a failing exit status.
fn fail(e: &Error) -> ! {
    let message = e.to_string();
    emit(match e {
        Error::NotEnoughSpace { needed, available } => json!({
            "event": "error", "kind": "not-enough-space", "message": message,
            "needed": needed, "available": available,
        }),
        Error::DeviceWrite { .. } => {
            json!({ "event": "error", "kind": "device-write", "message": message })
        }
        Error::DeviceNotFound(_) => {
            json!({ "event": "error", "kind": "device-not-found", "message": message })
        }
        _ => json!({ "event": "error", "kind": "other", "message": message }),
    });
    std::process::exit(1)
}

/// `onStick` is the size check only (the export also compares pieces of the file), which
/// is what a summary before the run needs: how much is left to copy.
fn plan_json(plan: &Plan) -> Value {
    let tracks: Vec<Value> = plan
        .tracks
        .iter()
        .map(|t| {
            let on_stick = std::fs::metadata(plan.device.join(t.device.usb_path.trim_start_matches('/')))
                .map(|m| m.len() == t.device.file_size)
                .unwrap_or(false);
            json!({
                "id": t.device.track.id, "usbPath": t.device.usb_path,
                "size": t.device.file_size, "onStick": on_stick,
            })
        })
        .collect();
    let warnings: Vec<String> = plan.format_warnings().iter().map(|w| w.to_string()).collect();
    let skipped: Vec<Value> = plan
        .skipped
        .iter()
        .map(|s| json!({ "name": s.name, "reason": s.reason }))
        .collect();
    json!({
        "event": "plan", "tracks": tracks, "spaceNeeded": plan.space_needed,
        "spaceAvailable": plan.space_available, "warnings": warnings, "skipped": skipped,
        "onelibraryFiles": plan.onelibrary_files,
    })
}

fn report_json(r: &Report) -> Value {
    let failures: Vec<Value> = r
        .failures
        .iter()
        .map(|(name, message)| json!({ "name": name, "message": message }))
        .collect();
    json!({
        "event": "report", "copied": r.copied, "kept": r.kept, "failures": failures,
        "cancelled": r.cancelled, "onelibraryWritten": r.onelibrary_written,
        "onelibraryError": r.onelibrary_error, "artwork": r.artwork, "pruned": r.pruned,
        "tracksInDatabase": r.tracks_in_database,
    })
}

struct JsonProgress;

impl Progress for JsonProgress {
    fn on_file_done(&self, _done: usize, _total: usize, _file: &Path) {}

    fn on_track(&self, event: TrackEvent<'_>) {
        emit(match event {
            TrackEvent::Start { index, usb_path, size } => {
                json!({ "event": "start", "index": index, "usbPath": usb_path, "size": size })
            }
            TrackEvent::Written { index, kept } => {
                json!({ "event": "written", "index": index, "kept": kept })
            }
            TrackEvent::Failed { index, message } => {
                json!({ "event": "failed", "index": index, "message": message })
            }
            TrackEvent::Database => json!({ "event": "database" }),
        });
    }
}
```

Run: `cargo fmt --all && cargo clippy --all-targets -- -D warnings && cargo test --workspace`
Expected: no warnings, all PASS.

```bash
git add -A && git commit -m "Report each track and the report as JSON lines with --json"
```

- [ ] **Step 9: Check the protocol end to end on the spike's data**

The spike's XML and analysis copies are in `$SCRATCH/usb-spike` (Makina, 7 tracks). The device is a scratch folder, never a stick.

```bash
cargo build --release -p baken
mkdir -p "$SCRATCH/baken-build/fake-usb"
B="$SCRATCH/baken-build/target/release/baken"
BAKEN_NO_UPDATE_CHECK=1 "$B" expressport "$SCRATCH/usb-spike/phase2/collection2.xml" \
  --device "$SCRATCH/baken-build/fake-usb" --anlz-dir "$SCRATCH/usb-spike/anlz-src/USBANLZ" \
  --no-settings --onelibrary --artwork --generate-analysis --device-name "" --json --dry-run
BAKEN_NO_UPDATE_CHECK=1 "$B" expressport "$SCRATCH/usb-spike/phase2/collection2.xml" \
  --device "$SCRATCH/baken-build/fake-usb" --anlz-dir "$SCRATCH/usb-spike/anlz-src/USBANLZ" \
  --no-settings --onelibrary --artwork --generate-analysis --device-name "" --json | tee "$SCRATCH/baken-build/run1.jsonl"
BAKEN_NO_UPDATE_CHECK=1 "$B" expressport "$SCRATCH/usb-spike/phase2/collection2.xml" \
  --device "$SCRATCH/baken-build/fake-usb" --anlz-dir "$SCRATCH/usb-spike/anlz-src/USBANLZ" \
  --no-settings --onelibrary --artwork --generate-analysis --device-name "" --json | grep -c '"kept":true'
```

Expected: the dry run prints exactly one `plan` line with 7 tracks, all `"onStick":false`; `run1.jsonl` has `plan`, 7 × (`start`, `written` with `"kept":false`), `database`, `report` with `"tracksInDatabase":7`, every line valid JSON (`node -e 'require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").forEach(l=>JSON.parse(l))' "$SCRATCH/baken-build/run1.jsonl"` prints nothing); the third run prints `7`.

- [ ] **Step 10: Export the series into Surco and commit**

From the worktree root:

```bash
git -C "$SCRATCH/baken-build" format-patch -3 --zero-commit --no-signature -o /tmp/baken-patches
mkdir -p apps/desktop/vendor/baken/patches
cp /tmp/baken-patches/0001-*.patch apps/desktop/vendor/baken/patches/0001-default-hot-cue-colours.patch
cp /tmp/baken-patches/0002-*.patch apps/desktop/vendor/baken/patches/0002-artwork-dir.patch
cp /tmp/baken-patches/0003-*.patch apps/desktop/vendor/baken/patches/0003-json-lines.patch
cp "$SCRATCH/baken-build/LICENSE" apps/desktop/vendor/baken/LICENSE
printf 'https://github.com/M-Igashi/baken\nv4.6.1\nc97435a978cafb949ee052afbd6ea9b7bff6fd0b\n' > apps/desktop/vendor/baken/UPSTREAM
rm -rf /tmp/baken-check && git clone -q --branch v4.6.1 https://github.com/M-Igashi/baken /tmp/baken-check
git -C /tmp/baken-check am -q "$PWD"/apps/desktop/vendor/baken/patches/*.patch && git -C /tmp/baken-check log --oneline -4
git add apps/desktop/vendor/baken
git commit -m "Add the baken patch series Surco builds"
```

Expected: `git am` applies all three on a clean `v4.6.1` and the log shows them on top of `c97435a`.

Then open the three as pull requests upstream (one each, English, with the measurements of `docs/export-usb-medidas.md`), and note their URLs in `vendor/baken/UPSTREAM` in a follow-up commit `Note the upstream pull requests of the baken patches`. Merging them is not a condition for this plan.

---
### Task 3: Build and ship baken with Surco, and find it at run time

**Files:**
- Create: `scripts/build-baken.mjs`
- Create: `src/main/bakenPath.ts`, `src/main/bakenPath.test.ts`
- Modify: `apps/desktop/package.json` (script `build-baken`), `apps/desktop/electron-builder.yml` (`extraResources`), `.gitignore`, `.github/workflows/release.yml`, `.github/workflows/build-test.yml`, `README.md`

**Interfaces:**
- Consumes: `apps/desktop/vendor/baken/{UPSTREAM,patches/*.patch,LICENSE}` (Task 2).
- Produces: `bakenPath(env: BakenEnv): string | null` and `bakenCommand(env): { file: string; prefixArgs: string[] } | null` (Tasks 7 and 9). `null` means "no baken on this platform" (Windows and Linux in this plan).

```ts
export interface BakenEnv {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string   // process.resourcesPath
  appPath: string         // app.getAppPath() (apps/desktop in dev)
  exists: (path: string) => boolean
}
```

- [ ] **Step 1: Write the failing test**

`src/main/bakenPath.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bakenCommand, bakenPath } from './bakenPath'

const base = {
  resourcesPath: '/Applications/Surco.app/Contents/Resources',
  appPath: '/dev/surco/apps/desktop',
  exists: () => true,
}

describe('bakenPath', () => {
  // electron-builder copies resources/baken next to app.asar (extraResources), outside the
  // archive: a binary inside app.asar cannot be executed, which is why ffmpeg is unpacked.
  it('finds the packaged binary beside the app archive', () => {
    expect(bakenPath({ ...base, platform: 'darwin', packaged: true })).toBe(
      join(base.resourcesPath, 'baken', 'baken'),
    )
  })

  // In development the binary is where scripts/build-baken.mjs left it.
  it('finds the development binary in the desktop app folder', () => {
    expect(bakenPath({ ...base, platform: 'darwin', packaged: false })).toBe(
      join(base.appPath, 'resources', 'baken', 'baken'),
    )
  })

  // The export is macOS only in this plan: Windows and Linux get no baken, so nothing
  // there can offer the feature, even if a binary happened to be on disk.
  it('has no baken off macOS', () => {
    expect(bakenPath({ ...base, platform: 'win32', packaged: true })).toBeNull()
    expect(bakenPath({ ...base, platform: 'linux', packaged: true })).toBeNull()
  })

  // A build that skipped scripts/build-baken.mjs must say "missing piece", not spawn ENOENT
  // halfway through an export.
  it('answers null when the binary is not there', () => {
    expect(bakenPath({ ...base, platform: 'darwin', packaged: true, exists: () => false })).toBeNull()
  })

  it('runs the binary itself, with no prefix arguments', () => {
    expect(bakenCommand({ ...base, platform: 'darwin', packaged: true })).toEqual({
      file: join(base.resourcesPath, 'baken', 'baken'),
      prefixArgs: [],
    })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run (from `apps/desktop`): `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenPath.test.ts`
Expected: FAIL, `Cannot find module './bakenPath'`.

- [ ] **Step 3: Implement**

`src/main/bakenPath.ts`:

```ts
import { join } from 'node:path'

// baken writes the stick (export.pdb, exportLibrary.db, ANLZ, audio). It ships beside the
// app archive through electron-builder's extraResources, not inside app.asar, because a
// binary inside the archive cannot be executed (the same reason ffmpeg is unpacked).
export interface BakenEnv {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  appPath: string
  exists: (path: string) => boolean
}

// Only macOS has the export in this plan: volume detection is diskutil's, and baken's
// own "still mounted" check on Windows only looks at the drive letter.
export function bakenPath(env: BakenEnv): string | null {
  if (env.platform !== 'darwin') return null
  const dir = env.packaged
    ? join(env.resourcesPath, 'baken')
    : join(env.appPath, 'resources', 'baken')
  const file = join(dir, 'baken')
  return env.exists(file) ? file : null
}

// What bakenRun spawns. Tests swap in node plus a fake baken script, so the runner takes a
// file and leading arguments rather than a bare path.
export function bakenCommand(env: BakenEnv): { file: string; prefixArgs: string[] } | null {
  const file = bakenPath(env)
  return file ? { file, prefixArgs: [] } : null
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenPath.test.ts`
Expected: PASS (5).

- [ ] **Step 5: The build script**

`scripts/build-baken.mjs`:

```js
#!/usr/bin/env node
// Builds Surco's patched baken for THIS machine into apps/desktop/resources/baken/.
// Source is pinned (apps/desktop/vendor/baken/UPSTREAM: url, tag, commit) and Surco's
// patches are applied on top, so the shipped binary always matches the repo. Nothing is
// downloaded prebuilt: a release asset in surco-releases would be seen by the website's
// download button and by the updater. On Linux and Windows only the licence is written,
// since the export exists on macOS only for now.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'apps/desktop/vendor/baken')
const out = join(root, 'apps/desktop/resources/baken')
const [url, tag, commit] = readFileSync(join(vendor, 'UPSTREAM'), 'utf8').trim().split('\n')
const work = process.env.BAKEN_BUILD_DIR ?? join(root, 'apps/desktop/.baken-build')

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(join(vendor, 'LICENSE'), join(out, 'LICENSE'))
if (process.platform !== 'darwin') {
  console.log(`baken: not built on ${process.platform} (the USB export is macOS only)`)
  process.exit(0)
}

// A cached clone (CI restores it with the cargo cache) is reset to the pinned commit; the
// patches are re-applied every time so an edited patch can never be skipped.
if (!existsSync(join(work, '.git'))) run('git', ['clone', '--quiet', '--branch', tag, url, work])
run('git', ['fetch', '--quiet', '--tags', 'origin'], work)
run('git', ['checkout', '--quiet', '--force', commit], work)
run('git', ['clean', '-fdq'], work)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work }).toString().trim()
if (head !== commit) throw new Error(`baken ${tag} is ${head}, expected ${commit}`)
const patches = readdirSync(join(vendor, 'patches')).filter((f) => f.endsWith('.patch')).sort()
run('git', ['-c', 'user.name=surco', '-c', 'user.email=surco@localhost', 'am', '--quiet',
  ...patches.map((p) => join(vendor, 'patches', p))], work)
run('cargo', ['build', '--release', '--locked', '-p', 'baken'], work)
copyFileSync(join(work, 'target/release/baken'), join(out, 'baken'))
if (existsSync(join(work, 'THIRD_PARTY_LICENSES.md')))
  copyFileSync(join(work, 'THIRD_PARTY_LICENSES.md'), join(out, 'THIRD_PARTY_LICENSES.md'))
console.log(`baken ${tag} + ${patches.length} patches -> ${join(out, 'baken')}`)
```

`apps/desktop/package.json`, in `scripts` after `"dist"`: `"build-baken": "node ../../scripts/build-baken.mjs",`

`.gitignore` (root), at the end:

```
# Built by scripts/build-baken.mjs on each machine; never committed.
apps/desktop/resources/baken/
apps/desktop/.baken-build/
```

If `THIRD_PARTY_LICENSES.md` is not in the baken tree (upstream generates it in its release job with `cargo about`), the script leaves it out and Step 9 adds a line to the README saying where it is generated; verify which with `ls "$SCRATCH/baken-build"`.

- [ ] **Step 6: Ship it**

`apps/desktop/electron-builder.yml`, after the `asarUnpack:` list:

```yaml
# baken writes the USB export (export.pdb, exportLibrary.db, ANLZ). Built from pinned source
# plus Surco's patches by scripts/build-baken.mjs, and kept outside app.asar because a binary
# inside the archive cannot be executed. electron-builder signs every Mach-O in the bundle,
# this one included, so notarization covers it.
extraResources:
  - from: resources/baken
    to: baken
```

- [ ] **Step 7: Build it in CI before packaging**

In `.github/workflows/release.yml`, in the `release` job, right after the step `Fetch Electron binary`:

```yaml
      # baken (the USB export's writer) is compiled from pinned source plus Surco's patches
      # on each runner, for its own arch. The cache keeps the clone and cargo's target so a
      # release does not pay the full Rust build every time. Linux only gets the licence.
      - name: Cache baken build
        if: runner.os == 'macOS'
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            apps/desktop/.baken-build
          key: baken-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('apps/desktop/vendor/baken/**') }}

      - name: Build baken
        shell: bash
        run: node scripts/build-baken.mjs
```

In `.github/workflows/build-test.yml`, after its `Fetch Electron binary` step, the same `Build baken` step (no cache; it writes only the licence on Windows):

```yaml
      - name: Build baken
        shell: bash
        run: node scripts/build-baken.mjs
```

- [ ] **Step 8: Build locally and check it packs, is signed and runs**

```bash
export CARGO_HOME="$SCRATCH/usb-spike/tools/cargo" RUSTUP_HOME="$SCRATCH/usb-spike/tools/rustup" PATH="$SCRATCH/usb-spike/tools/cargo/bin:$PATH"
npm run build-baken --workspace apps/desktop
apps/desktop/resources/baken/baken expressport --help | grep -E -- '--json|--artwork-dir'
cd apps/desktop && npx electron-vite build && npx electron-builder --mac --dir --publish never && cd ../..
B=$(ls -d apps/desktop/dist/mac*/Surco.app)/Contents/Resources/baken/baken
codesign -dv "$B" 2>&1 | grep -E 'Signature|flags'
"$B" --version
```

Expected: both flags listed in the help; the packed app holds `Contents/Resources/baken/baken`, signed (ad hoc here through `afterPack`'s deep sign; Developer ID with `runtime` flag in CI), and `--version` prints `baken 4.6.1`. In CI, the first release after this task must be checked the same way on the notarized `.dmg` (Task 12, Step 1).

- [ ] **Step 9: Licence notice**

`README.md`, before the licence section, a new section:

```markdown
## Third-party software

Surco bundles [baken](https://github.com/M-Igashi/baken) by Masanari Higashi (MIT licence) to write USB sticks for Pioneer DJ / AlphaTheta players, built from its v4.6.1 source with the patches in `apps/desktop/vendor/baken/patches`. Its licence and those of its dependencies ship next to the binary (`Contents/Resources/baken/` in the app).
```

- [ ] **Step 10: Types, lint, commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add scripts/build-baken.mjs apps/desktop/src/main/bakenPath.ts apps/desktop/src/main/bakenPath.test.ts apps/desktop/package.json apps/desktop/electron-builder.yml .gitignore .github/workflows/release.yml .github/workflows/build-test.yml README.md
git commit -m "Build the patched baken with Surco and ship it beside the app"
```

---
### Task 4: Read and fix rekordbox analysis files (grid, preview, vocal mask)

**Files:**
- Create: `src/main/anlz.ts`, `src/main/anlz.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Tasks 6, 7):

```ts
export interface AnlzSection { tag: string; start: number; length: number }
export function anlzSections(buf: Buffer): AnlzSection[]
export interface Beat { beat: number; bpm: number; ms: number }
export function beatGrid(dat: Buffer): Beat[]
export function wavePreview(dat: Buffer, bars?: number): number[] | null   // 0..1, default 100 bars
export function maskVocals(twoEx: Buffer): Buffer                         // never mutates its input
```

Layouts (big-endian, measured on Vicent's files 16/10): file header `PMAI`, header length u32 at 4, total length u32 at 8. Each section: tag (4 ASCII), header length u32 at +4, section length u32 at +8. `PQTZ`: header 24, beat count u32 at +20, then 8-byte entries `beat u16, tempo×100 u16, time ms u32`. `PWAV`: header 20, data length u32 at +12 (400), then one byte per column, height in the low 5 bits.

- [ ] **Step 1: Write the failing tests**

`src/main/anlz.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { anlzSections, beatGrid, maskVocals, wavePreview } from './anlz'

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

// A section as rekordbox lays it out: tag, header length, total length, then the rest of
// the header and the body.
function section(tag: string, headerRest: Buffer, body: Buffer): Buffer {
  const header = 12 + headerRest.length
  return Buffer.concat([Buffer.from(tag, 'latin1'), u32(header), u32(header + body.length), headerRest, body])
}

function file(...sections: Buffer[]): Buffer {
  const head = Buffer.concat([Buffer.from('PMAI'), u32(28), u32(0), Buffer.from('00000001000100000001000000000000', 'hex')])
  const out = Buffer.concat([head, ...sections])
  out.writeUInt32BE(out.length, 8)
  return out
}

const ppth = section('PPTH', u32(4), Buffer.from('?/a\0', 'latin1'))

function pqtz(beats: [number, number, number][]): Buffer {
  const body = Buffer.concat(
    beats.map(([beat, bpm100, ms]) => {
      const e = Buffer.alloc(8)
      e.writeUInt16BE(beat, 0)
      e.writeUInt16BE(bpm100, 2)
      e.writeUInt32BE(ms, 4)
      return e
    }),
  )
  return section('PQTZ', Buffer.concat([u32(0), u32(0x80000), u32(beats.length)]), body)
}

describe('anlzSections', () => {
  it('walks the sections after the PMAI header', () => {
    const f = file(ppth, pqtz([[1, 15400, 50]]))
    expect(anlzSections(f).map((s) => s.tag)).toEqual(['PPTH', 'PQTZ'])
  })

  // A truncated file (rekordbox mid-write, a copy cut short) must not throw or loop.
  it('stops at a section that runs past the end', () => {
    const f = file(ppth, pqtz([[1, 15400, 50]]))
    expect(anlzSections(f.subarray(0, f.length - 3)).map((s) => s.tag)).toEqual(['PPTH'])
    expect(anlzSections(Buffer.from('nope'))).toEqual([])
  })
})

describe('beatGrid', () => {
  // The XML's TEMPO lines come from this: a tempo change at 50 s (Hands Of Fate) must
  // survive, or the grid drifts off the beats after it.
  it('reads every beat with its tempo and time', () => {
    const f = file(ppth, pqtz([[1, 15400, 50], [2, 15400, 440], [3, 15000, 830]]))
    expect(beatGrid(f)).toEqual([
      { beat: 1, bpm: 154, ms: 50 },
      { beat: 2, bpm: 154, ms: 440 },
      { beat: 3, bpm: 150, ms: 830 },
    ])
  })

  it('has no grid without a PQTZ', () => {
    expect(beatGrid(file(ppth))).toEqual([])
  })
})

describe('wavePreview', () => {
  const pwav = (heights: number[]): Buffer =>
    section('PWAV', Buffer.concat([u32(heights.length), u32(0x10000)]), Buffer.from(heights.map((h) => 0xa0 | h)))

  // 400 columns become 100 bars by taking each group's highest, so a short peak still shows;
  // the top three bits are rekordbox's whiteness, not height.
  it('keeps the highest column of each group, scaled to 0..1', () => {
    const heights = Array.from({ length: 400 }, (_, i) => (i === 5 ? 31 : 0))
    const bars = wavePreview(file(ppth, pwav(heights)))
    expect(bars).toHaveLength(100)
    expect(bars?.[1]).toBe(1)
    expect(bars?.[0]).toBe(0)
  })

  it('answers null without a preview, so the row draws a flat bar', () => {
    expect(wavePreview(file(ppth))).toBeNull()
  })
})

describe('maskVocals', () => {
  // A real PVDI header (rekordbox 7.2.19, Hands Of Fate) shortened to 40 bytes of data, all
  // zero as that track's first bytes are: rekordbox's export sets 0x80 at byte 12 and the
  // data becomes the key itself.
  const plain = Buffer.concat([
    Buffer.from('505644490000001800000040000004005622000100000028', 'hex'),
    Buffer.alloc(40),
  ])
  const masked = Buffer.concat([
    Buffer.from('505644490000001800000040800004005622000100000028', 'hex'),
    Buffer.from(
      '1edd1e1902191b11192318192411fb111e2a151edd1e1902191b11192318192411fb111e2a151edd',
      'hex',
    ),
  ])

  it('masks the vocal section as rekordbox does when it exports', () => {
    const out = maskVocals(file(ppth, plain))
    expect(anlzSections(out).map((s) => s.tag)).toEqual(['PPTH', 'PVDI'])
    const s = anlzSections(out)[1]
    expect(out.subarray(s.start, s.start + s.length)).toEqual(masked)
  })

  // A staged copy masked twice would come out plain again: XOR undoes itself.
  it('leaves an already masked section alone', () => {
    const once = maskVocals(file(ppth, plain))
    expect(maskVocals(once)).toEqual(once)
  })

  // rekordbox writes an empty 24-byte PVDI for a track without vocal data, last in the file,
  // and the file's total length has to grow with it.
  it('appends the empty section when there is none', () => {
    const before = file(ppth)
    const out = maskVocals(before)
    expect(out.subarray(before.length).toString('hex')).toBe(
      '505644490000001800000018000004005622000100000000',
    )
    expect(out.readUInt32BE(8)).toBe(before.length + 24)
  })

  it('never changes the buffer it was given', () => {
    const input = file(ppth, plain)
    const copy = Buffer.from(input)
    maskVocals(input)
    expect(input).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/anlz.test.ts`
Expected: FAIL, `Cannot find module './anlz'`.

- [ ] **Step 3: Implement**

`src/main/anlz.ts`:

```ts
// rekordbox's analysis files (ANLZ0000.DAT/.EXT/.2EX): a PMAI header and tagged sections,
// all big-endian. Surco reads two things from the local copies (the beat grid for baken's
// XML and the small waveform preview for the export list) and fixes one before baken copies
// it to the stick: rekordbox masks the vocal section (PVDI) when it exports and baken does
// not, so Surco masks the staged copy and baken carries it over byte for byte.

export interface AnlzSection {
  tag: string
  start: number
  length: number
}

export function anlzSections(buf: Buffer): AnlzSection[] {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'PMAI') return []
  const out: AnlzSection[] = []
  let pos = buf.readUInt32BE(4)
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos + 8)
    if (length < 12 || pos + length > buf.length) break
    out.push({ tag: buf.toString('latin1', pos, pos + 4), start: pos, length })
    pos += length
  }
  return out
}

export interface Beat {
  beat: number
  bpm: number
  ms: number
}

export function beatGrid(dat: Buffer): Beat[] {
  const s = anlzSections(dat).find((x) => x.tag === 'PQTZ')
  if (!s) return []
  const header = dat.readUInt32BE(s.start + 4)
  const count = dat.readUInt32BE(s.start + 20)
  const beats: Beat[] = []
  for (let i = 0; i < count; i++) {
    const at = s.start + header + i * 8
    if (at + 8 > s.start + s.length) break
    beats.push({ beat: dat.readUInt16BE(at), bpm: dat.readUInt16BE(at + 2) / 100, ms: dat.readUInt32BE(at + 4) })
  }
  return beats
}

// The tiny preview rekordbox draws in its browser (PWAV: 400 columns, height in the low five
// bits). Reduced by maximum so a short peak survives at the export list's size.
export function wavePreview(dat: Buffer, bars = 100): number[] | null {
  const s = anlzSections(dat).find((x) => x.tag === 'PWAV')
  if (!s) return null
  const header = dat.readUInt32BE(s.start + 4)
  const columns = Math.min(dat.readUInt32BE(s.start + 12), s.length - header)
  if (columns <= 0) return null
  const data = dat.subarray(s.start + header, s.start + header + columns)
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor((i * columns) / bars)
    const to = Math.max(from + 1, Math.floor(((i + 1) * columns) / bars))
    let top = 0
    for (let c = from; c < to; c++) top = Math.max(top, data[c] & 0x1f)
    return Math.round((top / 31) * 100) / 100
  })
}

// Measured on rekordbox 7.2.19's export (16/10/2026, 5 of 5 tracks exact): a fixed 19-byte
// key from the section's byte 24 (unlike PSSI's, it does not depend on the length), and 0x80
// in byte 12 to say the data is masked.
const PVDI_KEY = Buffer.from('1edd1e1902191b11192318192411fb111e2a15', 'hex')
const EMPTY_PVDI = Buffer.from('505644490000001800000018000004005622000100000000', 'hex')

export function maskVocals(twoEx: Buffer): Buffer {
  const out = Buffer.from(twoEx)
  const s = anlzSections(out).find((x) => x.tag === 'PVDI')
  if (!s) {
    const grown = Buffer.concat([out, EMPTY_PVDI])
    grown.writeUInt32BE(grown.length, 8)
    return grown
  }
  if (s.length <= 24 || (out[s.start + 12] & 0x80) !== 0) return out
  out[s.start + 12] |= 0x80
  for (let i = 24; i < s.length; i++) out[s.start + i] ^= PVDI_KEY[(i - 24) % PVDI_KEY.length]
  return out
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/anlz.test.ts`
Expected: PASS (10).

- [ ] **Step 5: Check against the real files (scratch only)**

```bash
cat > "$SCRATCH/usb-plan/pvdi-check.ts" <<'EOF'
import { globSync, readFileSync } from 'node:fs'
import { anlzSections, maskVocals } from '/Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists/apps/desktop/src/main/anlz'
const rb = process.argv[2], proto = process.argv[3]
let ok = 0, bad = 0
for (const rel of globSync('PIONEER/USBANLZ/*/*/ANLZ0000.2EX', { cwd: rb })) {
  const pvdi = (b: Buffer) => { const s = anlzSections(b).find((x) => x.tag === 'PVDI'); return s ? b.subarray(s.start, s.start + s.length).toString('hex') : '' }
  pvdi(maskVocals(readFileSync(`${proto}/${rel}`))) === pvdi(readFileSync(`${rb}/${rel}`)) ? ok++ : bad++
}
console.log(`PVDI equal to rekordbox ${ok}, different ${bad}`)
EOF
node "$SCRATCH/usb-spike/tools/tsx/node_modules/tsx/dist/cli.mjs" "$SCRATCH/usb-plan/pvdi-check.ts" "$SCRATCH/usb-spike/rekordbox-baseline" "$SCRATCH/usb-spike/phase2/fake-usb2"
```

Expected: `PVDI equal to rekordbox 7, different 0` (5 masked, 2 empty appended). If `tsx` is not at that path, `ls "$SCRATCH/usb-spike/tools/tsx"` and use its CLI.

- [ ] **Step 6: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/anlz.ts apps/desktop/src/main/anlz.test.ts
git commit -m "Read rekordbox analysis files and mask their vocal section for export"
```

---
### Task 5: Read the selection from master.db

**Files:**
- Create: `src/main/rekordboxExportFixture.ts`, `src/main/usbExportSource.ts`, `src/main/usbExportSource.test.ts`
- Modify: `src/main/rekordboxPlaylists.ts` (export `LIVE_LINK`)

**Interfaces:**
- Consumes: `readRekordboxTree`, `IS_SEPARATOR`, `LIVE_LINK` (`rekordboxPlaylists.ts`), `STREAMING_FILE_TYPE`, `openRekordboxDb` (`rekordboxDb.ts`), `writeRekordboxPlaylistFixture`, `PlaylistFixture` (`rekordboxPlaylistsFixture.ts`), `SourceNode` (`shared/types.ts`).
- Produces (Tasks 6, 7, 9):

```ts
export interface ExportCue { inMs: number; outMs: number; kind: number; comment: string }
export interface ExportTrack {
  id: string; path: string; title: string; artist: string; album: string; genre: string
  label: string; remixer: string; composer: string; mix: string; key: string
  fileType: number; lengthSec: number; bpm: number; bitRate: number; sampleRate: number
  bitDepth: number; rating: number; year: number; trackNo: number; discNo: number
  dateAdded: string; playCount: number; comment: string
  analysisPath: string; imagePath: string; separator: boolean; streaming: boolean
  cues: ExportCue[]
}
export interface ExportPlaylist { id: string; name: string; folders: string[]; trackIds: string[] }
export interface ExportSelection { playlists: ExportPlaylist[]; tracks: ExportTrack[] }
export function selectedPlaylists(tree: SourceNode[], ids: ReadonlySet<string>): { node: SourceNode; folders: string[] }[]
export function readExportSelection(db: RekordboxDb, ids: string[]): ExportSelection
// fixture
export interface ExportFixture extends PlaylistFixture { details?: Record<string, ContentDetails>; names?: FixtureNames; cues?: FixtureCue[] }
export function writeRekordboxExportFixture(path: string, data: ExportFixture): void
```

- [ ] **Step 1: Export the live-link rule**

In `src/main/rekordboxPlaylists.ts`, `const LIVE_LINK =` becomes `export const LIVE_LINK =` (the export reader must skip the same deleted links the tree does, or counts and the stick disagree).

- [ ] **Step 2: The fixture with the export columns**

`src/main/rekordboxExportFixture.ts`:

```ts
import Database from 'better-sqlite3-multiple-ciphers'
import { REKORDBOX_KEY } from './rekordboxDb'
import { type PlaylistFixture, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

// The playlist fixture plus what the USB export reads: the name tables, the djmdContent
// columns baken's XML carries, and djmdCue. Column names as measured on rekordbox 7.2.19
// (docs/export-usb-medidas.md). Added on top rather than folded into the shared fixture so
// the organising tests keep the minimal schema they were written against.
export interface ContentDetails {
  ArtistID?: string
  AlbumID?: string
  GenreID?: string
  LabelID?: string
  RemixerID?: string
  ComposerID?: string
  Subtitle?: string
  BitRate?: number
  SampleRate?: number
  BitDepth?: number
  ReleaseYear?: number
  TrackNo?: number
  DiscNo?: number
  DateCreated?: string
  DJPlayCount?: number
  Commnt?: string
  AnalysisDataPath?: string
  ImagePath?: string
}

interface Named {
  ID: string
  Name: string
}

export interface FixtureNames {
  artists?: Named[]
  albums?: Named[]
  genres?: Named[]
  labels?: Named[]
}

export interface FixtureCue {
  ContentID: string
  InMsec: number
  OutMsec: number
  Kind: number
  Comment?: string
  deleted?: boolean
}

export interface ExportFixture extends PlaylistFixture {
  details?: Record<string, ContentDetails>
  names?: FixtureNames
  cues?: FixtureCue[]
}

const DETAIL_COLUMNS: [keyof ContentDetails, string][] = [
  ['ArtistID', 'VARCHAR(255)'],
  ['AlbumID', 'VARCHAR(255)'],
  ['GenreID', 'VARCHAR(255)'],
  ['LabelID', 'VARCHAR(255)'],
  ['RemixerID', 'VARCHAR(255)'],
  ['ComposerID', 'VARCHAR(255)'],
  ['Subtitle', 'VARCHAR(255)'],
  ['BitRate', 'INTEGER'],
  ['SampleRate', 'INTEGER'],
  ['BitDepth', 'INTEGER'],
  ['ReleaseYear', 'INTEGER'],
  ['TrackNo', 'INTEGER'],
  ['DiscNo', 'INTEGER'],
  ['DateCreated', 'VARCHAR(255)'],
  ['DJPlayCount', 'INTEGER'],
  ['Commnt', 'TEXT'],
  ['AnalysisDataPath', 'VARCHAR(255)'],
  ['ImagePath', 'VARCHAR(255)'],
]

export function writeRekordboxExportFixture(path: string, data: ExportFixture): void {
  writeRekordboxPlaylistFixture(path, data)
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  for (const [name, type] of DETAIL_COLUMNS) db.exec(`ALTER TABLE djmdContent ADD COLUMN ${name} ${type}`)
  db.exec(`
    CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdLabel (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdCue (ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), InMsec INTEGER,
      OutMsec INTEGER, Kind INTEGER, Comment TEXT, Color INTEGER DEFAULT -1,
      ColorTableIndex INTEGER, rb_local_deleted INTEGER DEFAULT 0);
  `)
  const tables: [keyof FixtureNames, string][] = [
    ['artists', 'djmdArtist'],
    ['albums', 'djmdAlbum'],
    ['genres', 'djmdGenre'],
    ['labels', 'djmdLabel'],
  ]
  for (const [key, table] of tables) {
    const insert = db.prepare(`INSERT INTO ${table} (ID, Name) VALUES (?, ?)`)
    for (const n of data.names?.[key] ?? []) insert.run(n.ID, n.Name)
  }
  for (const [id, details] of Object.entries(data.details ?? {})) {
    const entries = Object.entries(details)
    if (entries.length === 0) continue
    db.prepare(`UPDATE djmdContent SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE ID = ?`).run(
      ...entries.map(([, v]) => v),
      id,
    )
  }
  const cue = db.prepare(
    `INSERT INTO djmdCue (ID, ContentID, InMsec, OutMsec, Kind, Comment, rb_local_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  ;(data.cues ?? []).forEach((c, i) =>
    cue.run(`cue-${i}`, c.ContentID, c.InMsec, c.OutMsec, c.Kind, c.Comment ?? '', c.deleted ? 1 : 0),
  )
  db.close()
}
```

- [ ] **Step 3: Write the failing tests**

`src/main/usbExportSource.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceNode } from '../shared/types'
import { type ExportFixture, writeRekordboxExportFixture } from './rekordboxExportFixture'
import { openRekordboxDb } from './rekordboxDb'
import { readExportSelection, selectedPlaylists } from './usbExportSource'

// The spike's playlist (BASES › Makina) in miniature: a track with hot and memory cues, the
// blank separator, a second track, and House holding the second track again and a
// streaming row. Shapes from Vicent's collection (16/10).
const FIXTURE: ExportFixture = {
  content: [
    { ID: '101', FolderPath: '/Volumes/Public/Makina/Hands Of Fate.wav', FileType: 11, Title: 'Hands Of Fate (Original Mix)', Length: 380, BPM: 15400, Rating: 5, KeyID: 'k1' },
    { ID: '102', FolderPath: '/Volumes/Public/Makina/No Fear.aiff', FileType: 12, Title: 'No Fear', Length: 330, BPM: 15000 },
    { ID: '105', FolderPath: 'spotify:track:abc', FileType: 25, Title: 'Streamed', Length: 200 },
    { ID: '109', FolderPath: '/Users/dj/Music/PioneerDJ/Blank Audio/_.mp3', FileType: 1, Title: ' ', Length: 1 },
  ],
  keys: [{ ID: 'k1', ScaleName: '1A' }],
  playlists: [
    { ID: '1000', Name: 'BASES', Attribute: 1, ParentID: 'root', Seq: 1 },
    { ID: '2000', Name: 'Makina', Attribute: 0, ParentID: '1000', Seq: 1 },
    { ID: '3000', Name: 'House', Attribute: 0, ParentID: 'root', Seq: 2 },
  ],
  links: [
    { PlaylistID: '2000', ContentID: '101', TrackNo: 1 },
    { PlaylistID: '2000', ContentID: '109', TrackNo: 2 },
    { PlaylistID: '2000', ContentID: '102', TrackNo: 3 },
    { PlaylistID: '3000', ContentID: '102', TrackNo: 1 },
    { PlaylistID: '3000', ContentID: '105', TrackNo: 2 },
    { PlaylistID: '3000', ContentID: '101', TrackNo: 3, deleted: true },
  ],
  details: {
    '101': {
      ArtistID: 'a1', AlbumID: 'al1', GenreID: 'g1', LabelID: 'l1', RemixerID: 'a2', Subtitle: 'Original Mix',
      BitRate: 2116, SampleRate: 44100, BitDepth: 24, ReleaseYear: 1997, TrackNo: 3, DiscNo: 1,
      DateCreated: '2024-05-01', DJPlayCount: 12, Commnt: 'Cue at the break',
      AnalysisDataPath: '/PIONEER/USBANLZ/51d/3f604-6497/ANLZ0000.DAT', ImagePath: '/PIONEER/Artwork/00a/b1/artwork.jpg',
    },
    '102': { ArtistID: 'a3', BitDepth: 32, SampleRate: 96000 },
  },
  names: {
    artists: [{ ID: 'a1', Name: 'Pastis & Buenri' }, { ID: 'a2', Name: 'Remixer' }, { ID: 'a3', Name: 'K-Style' }],
    albums: [{ ID: 'al1', Name: 'Hands Of Fate' }],
    genres: [{ ID: 'g1', Name: 'Makina' }],
    labels: [{ ID: 'l1', Name: 'Bit Music' }],
  },
  cues: [
    { ContentID: '101', InMsec: 50000, OutMsec: -1, Kind: 2 },
    { ContentID: '101', InMsec: 1000, OutMsec: -1, Kind: 0, Comment: 'Intro' },
    { ContentID: '101', InMsec: 9000, OutMsec: 17000, Kind: 5 },
    { ContentID: '101', InMsec: 3000, OutMsec: -1, Kind: 1, deleted: true },
  ],
}

let dbPath = ''
beforeAll(async () => {
  dbPath = join(await mkdtemp(join(tmpdir(), 'usb-source-')), 'master.db')
  writeRekordboxExportFixture(dbPath, FIXTURE)
})

function read(ids: string[]) {
  const db = openRekordboxDb(dbPath, { readonly: true })
  if (!db) throw new Error('fixture did not open')
  try {
    return readExportSelection(db, ids)
  } finally {
    db.close()
  }
}

describe('selectedPlaylists', () => {
  const tree: SourceNode[] = [
    { id: 'f', name: 'BASES', kind: 'folder', count: 2, children: [
      { id: 'p1', name: 'Makina', kind: 'playlist', count: 2 },
      { id: 'f2', name: '90s', kind: 'folder', count: 1, children: [{ id: 'p2', name: 'Todas', kind: 'playlist', count: 9 }] },
    ] },
    { id: 'p3', name: 'House', kind: 'playlist', count: 1 },
  ]

  // Ticking a folder means everything under it, nested folders included, in rekordbox's order.
  it('expands a ticked folder to every playlist beneath it', () => {
    expect(selectedPlaylists(tree, new Set(['f'])).map((p) => [p.node.id, p.folders])).toEqual([
      ['p1', ['BASES']],
      ['p2', ['BASES', '90s']],
    ])
  })

  // A folder and one of its playlists both ticked must not list the playlist twice.
  it('lists a playlist once when it and its folder are both ticked', () => {
    expect(selectedPlaylists(tree, new Set(['f', 'p1', 'p3'])).map((p) => p.node.id)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('readExportSelection', () => {
  it('reads the ticked playlists in tree order with their folders', () => {
    const sel = read(['3000', '1000'])
    expect(sel.playlists.map((p) => [p.name, p.folders, p.trackIds])).toEqual([
      ['Makina', ['BASES'], ['101', '109', '102']],
      ['House', [], ['102', '105']],
    ])
  })

  // A track in two playlists is one track on the stick: the collection lists it once and
  // both playlists point at it. The soft-deleted link is not a membership.
  it('keeps each track once, in the order it first appears', () => {
    expect(read(['1000', '3000']).tracks.map((t) => t.id)).toEqual(['101', '109', '102', '105'])
  })

  it('reads what the XML carries, names joined', () => {
    const t = read(['2000']).tracks[0]
    expect(t).toMatchObject({
      title: 'Hands Of Fate (Original Mix)', artist: 'Pastis & Buenri', album: 'Hands Of Fate',
      genre: 'Makina', label: 'Bit Music', remixer: 'Remixer', mix: 'Original Mix', key: '1A',
      fileType: 11, lengthSec: 380, bpm: 154, bitRate: 2116, sampleRate: 44100, bitDepth: 24,
      rating: 5, year: 1997, trackNo: 3, discNo: 1, dateAdded: '2024-05-01', playCount: 12,
      comment: 'Cue at the break', analysisPath: '/PIONEER/USBANLZ/51d/3f604-6497/ANLZ0000.DAT',
      imagePath: '/PIONEER/Artwork/00a/b1/artwork.jpg', separator: false, streaming: false,
    })
  })

  // Cues in time order, the deleted one gone; Kind is passed through untouched, the letter
  // mapping (with the unused 4) belongs to the XML.
  it('reads live cues in time order', () => {
    expect(read(['2000']).tracks[0].cues).toEqual([
      { inMs: 1000, outMs: -1, kind: 0, comment: 'Intro' },
      { inMs: 9000, outMs: 17000, kind: 5, comment: '' },
      { inMs: 50000, outMs: -1, kind: 2, comment: '' },
    ])
  })

  it('marks the separator and the streaming row', () => {
    const byId = new Map(read(['1000', '3000']).tracks.map((t) => [t.id, t]))
    expect(byId.get('109')?.separator).toBe(true)
    expect(byId.get('105')?.streaming).toBe(true)
  })

  it('reads nothing for nothing ticked', () => {
    expect(read([])).toEqual({ playlists: [], tracks: [] })
  })
})
```

- [ ] **Step 4: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExportSource.test.ts`
Expected: FAIL, `Cannot find module './usbExportSource'`.

- [ ] **Step 5: Implement**

`src/main/usbExportSource.ts`:

```ts
import type { SourceNode } from '../shared/types'
import { type openRekordboxDb, STREAMING_FILE_TYPE } from './rekordboxDb'
import { IS_SEPARATOR, LIVE_LINK, readRekordboxTree } from './rekordboxPlaylists'

// What the USB export takes from master.db: the ticked playlists (a ticked folder means all
// of it), each track once, with everything baken's XML carries and the paths of rekordbox's
// own analysis and artwork. Read-only like every other reader of the collection; the caller
// opens it with { readonly: true }, which works with rekordbox open.

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

export interface ExportCue {
  inMs: number
  outMs: number
  kind: number
  comment: string
}

export interface ExportTrack {
  id: string
  path: string
  title: string
  artist: string
  album: string
  genre: string
  label: string
  remixer: string
  composer: string
  mix: string
  key: string
  fileType: number
  lengthSec: number
  bpm: number
  bitRate: number
  sampleRate: number
  bitDepth: number
  rating: number
  year: number
  trackNo: number
  discNo: number
  dateAdded: string
  playCount: number
  comment: string
  analysisPath: string
  imagePath: string
  separator: boolean
  streaming: boolean
  cues: ExportCue[]
}

export interface ExportPlaylist {
  id: string
  name: string
  folders: string[]
  trackIds: string[]
}

export interface ExportSelection {
  playlists: ExportPlaylist[]
  tracks: ExportTrack[]
}

export function selectedPlaylists(
  tree: SourceNode[],
  ids: ReadonlySet<string>,
): { node: SourceNode; folders: string[] }[] {
  const out: { node: SourceNode; folders: string[] }[] = []
  const walk = (nodes: SourceNode[], folders: string[], inside: boolean): void => {
    for (const n of nodes) {
      const on = inside || ids.has(n.id)
      if (n.kind === 'folder') walk(n.children ?? [], [...folders, n.name], on)
      else if (on) out.push({ node: n, folders })
    }
  }
  walk(tree, [], false)
  return out
}

interface Row {
  ID: string
  FolderPath: string
  Title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  label: string | null
  remixer: string | null
  composer: string | null
  Subtitle: string | null
  ScaleName: string | null
  FileType: number
  Length: number | null
  BPM: number | null
  BitRate: number | null
  SampleRate: number | null
  BitDepth: number | null
  Rating: number | null
  ReleaseYear: number | null
  TrackNo: number | null
  DiscNo: number | null
  DateCreated: string | null
  DJPlayCount: number | string | null
  Commnt: string | null
  AnalysisDataPath: string | null
  ImagePath: string | null
  sep: number
}

const TRACKS_OF = `
  SELECT c.ID, c.FolderPath, c.Title, a.Name AS artist, al.Name AS album, g.Name AS genre,
         l.Name AS label, r.Name AS remixer, cp.Name AS composer, c.Subtitle, k.ScaleName,
         c.FileType, c.Length, c.BPM, c.BitRate, c.SampleRate, c.BitDepth, c.Rating,
         c.ReleaseYear, c.TrackNo, c.DiscNo, c.DateCreated, c.DJPlayCount, c.Commnt,
         c.AnalysisDataPath, c.ImagePath, ${IS_SEPARATOR} AS sep
    FROM djmdSongPlaylist s
    JOIN djmdContent c ON c.ID = s.ContentID
    LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
    LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
    LEFT JOIN djmdGenre g ON g.ID = c.GenreID
    LEFT JOIN djmdLabel l ON l.ID = c.LabelID
    LEFT JOIN djmdArtist r ON r.ID = c.RemixerID
    LEFT JOIN djmdArtist cp ON cp.ID = c.ComposerID
    LEFT JOIN djmdKey k ON k.ID = c.KeyID
   WHERE s.PlaylistID = ? AND ${LIVE_LINK}
   ORDER BY s.TrackNo`

const text = (v: string | null): string => (v ?? '').trim()
const num = (v: number | string | null): number => Number(v) || 0

function trackOf(r: Row): ExportTrack {
  return {
    id: String(r.ID),
    path: r.FolderPath,
    title: text(r.Title),
    artist: text(r.artist),
    album: text(r.album),
    genre: text(r.genre),
    label: text(r.label),
    remixer: text(r.remixer),
    composer: text(r.composer),
    mix: text(r.Subtitle),
    key: text(r.ScaleName),
    fileType: r.FileType,
    lengthSec: num(r.Length),
    // rekordbox stores BPM ×100.
    bpm: num(r.BPM) / 100,
    bitRate: num(r.BitRate),
    sampleRate: num(r.SampleRate),
    bitDepth: num(r.BitDepth),
    rating: num(r.Rating),
    year: num(r.ReleaseYear),
    trackNo: num(r.TrackNo),
    discNo: num(r.DiscNo),
    dateAdded: text(r.DateCreated).slice(0, 10),
    playCount: num(r.DJPlayCount),
    comment: text(r.Commnt),
    analysisPath: text(r.AnalysisDataPath),
    imagePath: text(r.ImagePath),
    separator: r.sep === 1,
    streaming: r.FileType === STREAMING_FILE_TYPE,
    cues: [],
  }
}

// SQLite's default limit on bound parameters is far above a playlist, but a whole-collection
// export of thousands of tracks is not; chunks keep the IN list well inside it.
const CHUNK = 500

function readCues(db: RekordboxDb, tracks: Map<string, ExportTrack>): void {
  const ids = [...tracks.keys()]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK)
    const rows = db
      .prepare(
        `SELECT ContentID, InMsec, OutMsec, Kind, Comment FROM djmdCue
          WHERE ContentID IN (${part.map(() => '?').join(', ')})
            AND coalesce(rb_local_deleted, 0) = 0
          ORDER BY InMsec`,
      )
      .all(...part) as { ContentID: string; InMsec: number; OutMsec: number | null; Kind: number; Comment: string | null }[]
    for (const c of rows)
      tracks.get(String(c.ContentID))?.cues.push({
        inMs: c.InMsec,
        outMs: c.OutMsec ?? -1,
        kind: c.Kind,
        comment: text(c.Comment),
      })
  }
}

export function readExportSelection(db: RekordboxDb, ids: string[]): ExportSelection {
  const picked = selectedPlaylists(readRekordboxTree(db), new Set(ids))
  const tracks = new Map<string, ExportTrack>()
  const statement = db.prepare(TRACKS_OF)
  const playlists = picked.map(({ node, folders }) => {
    const rows = statement.all(node.id) as Row[]
    for (const r of rows) if (!tracks.has(String(r.ID))) tracks.set(String(r.ID), trackOf(r))
    return { id: node.id, name: node.name, folders, trackIds: rows.map((r) => String(r.ID)) }
  })
  readCues(db, tracks)
  return { playlists, tracks: [...tracks.values()] }
}
```

- [ ] **Step 6: Run them to see them pass, then the neighbours**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExportSource.test.ts src/main/rekordboxPlaylists.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/rekordboxExportFixture.ts apps/desktop/src/main/usbExportSource.ts apps/desktop/src/main/usbExportSource.test.ts apps/desktop/src/main/rekordboxPlaylists.ts
git commit -m "Read the playlists ticked for a USB export from the rekordbox collection"
```

---
### Task 6: baken's input XML

**Files:**
- Move: `src/renderer/src/lib/xml.ts` → `src/shared/xml.ts`, `src/renderer/src/lib/xml.test.ts` → `src/shared/xml.test.ts`
- Modify: `src/renderer/src/lib/rekordbox.ts`, `src/renderer/src/lib/traktor.ts` (import path)
- Create: `src/main/bakenXml.ts`, `src/main/bakenXml.test.ts`

**Interfaces:**
- Consumes: `ExportSelection`, `ExportTrack` (Task 5), `Beat` (Task 4), `escapeXml` (`shared/xml.ts`).
- Produces (Task 7):

```ts
export function hotCueNum(kind: number): number | null   // -1 memory, 0..7 A..H, null unknown
export interface XmlTrackFacts { size: number; grid: Beat[] }
export function buildBakenXml(sel: ExportSelection, facts: ReadonlyMap<string, XmlTrackFacts>): string
```

Only tracks present in `facts` (their file was found and they are not streaming) go into the collection and the playlists; Task 7 decides who is in it.

- [ ] **Step 1: Move the escaping to shared**

```bash
cd apps/desktop
git mv src/renderer/src/lib/xml.ts src/shared/xml.ts
git mv src/renderer/src/lib/xml.test.ts src/shared/xml.test.ts
sed -i '' "s#from './xml'#from '../../../shared/xml'#" src/renderer/src/lib/rekordbox.ts src/renderer/src/lib/traktor.ts
grep -n "shared/xml" src/renderer/src/lib/rekordbox.ts src/renderer/src/lib/traktor.ts
node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/shared/xml.test.ts src/renderer/src/lib/rekordbox.test.ts
```

Expected: both importers point at `../../../shared/xml`; tests PASS (`xml.test.ts` imports `./xml`, which still resolves beside it).

- [ ] **Step 2: Write the failing tests**

`src/main/bakenXml.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildBakenXml, hotCueNum } from './bakenXml'
import type { ExportSelection, ExportTrack } from './usbExportSource'

function track(over: Partial<ExportTrack>): ExportTrack {
  return {
    id: '1', path: '/Volumes/Public/Makina/a.wav', title: 'A', artist: '', album: '', genre: '',
    label: '', remixer: '', composer: '', mix: '', key: '', fileType: 11, lengthSec: 300, bpm: 150,
    bitRate: 1411, sampleRate: 44100, bitDepth: 16, rating: 0, year: 0, trackNo: 0, discNo: 0,
    dateAdded: '', playCount: 0, comment: '', analysisPath: '', imagePath: '', separator: false,
    streaming: false, cues: [], ...over,
  }
}

describe('hotCueNum', () => {
  // rekordbox's Kind skips 4: A=1, B=2, C=3, D=5, E=6, F=7, G=8, H=9 (measured 16/10). The
  // spike's first XML did Kind-1 and put D on E and E on F.
  it('maps rekordbox kinds to letters with 4 unused', () => {
    expect([0, 1, 2, 3, 5, 6, 7, 8, 9].map(hotCueNum)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('has no letter for a kind rekordbox does not use', () => {
    expect(hotCueNum(4)).toBeNull()
    expect(hotCueNum(10)).toBeNull()
  })
})

describe('buildBakenXml', () => {
  const a = track({
    id: '101', title: 'Hands Of Fate', artist: 'Pastis & Buenri', label: 'Bit Music', key: '1A',
    rating: 5, trackNo: 3, dateAdded: '2024-05-01', playCount: 12, path: '/Volumes/Public/Makina/Hands Of Fate #1.wav',
    cues: [
      { inMs: 1000, outMs: -1, kind: 0, comment: 'Intro' },
      { inMs: 9000, outMs: 17000, kind: 5, comment: '' },
    ],
  })
  const b = track({ id: '102', title: 'No Fear', fileType: 12, path: '/Volumes/Public/Makina/No Fear.aiff' })
  const gone = track({ id: '103', title: 'Gone' })
  const sel: ExportSelection = {
    playlists: [
      { id: '2000', name: 'Makina', folders: ['BASES'], trackIds: ['101', '103', '102'] },
      { id: '3000', name: 'House', folders: [], trackIds: ['102'] },
    ],
    tracks: [a, gone, b],
  }
  const facts = new Map([
    ['101', { size: 76_000_123, grid: [{ beat: 1, bpm: 154, ms: 50 }, { beat: 2, bpm: 154, ms: 440 }, { beat: 3, bpm: 150, ms: 830 }] }],
    ['102', { size: 50_000_000, grid: [] }],
  ])
  const xml = buildBakenXml(sel, facts)

  it('lists only the tracks with a file, once each', () => {
    expect(xml).toContain('<COLLECTION Entries="2">')
    expect(xml).not.toContain('Gone')
  })

  // master.db's FileSize goes stale when Surco rewrites tags (5 of 7 in the spike); baken
  // writes the size it is given into both databases.
  it('carries the real size and the data the stick shows', () => {
    expect(xml).toContain('Size="76000123"')
    expect(xml).toContain('Artist="Pastis &amp; Buenri"')
    expect(xml).toContain('Label="Bit Music"')
    expect(xml).toContain('Tonality="1A"')
    expect(xml).toContain('TrackNumber="3"')
    expect(xml).toContain('DateAdded="2024-05-01"')
    expect(xml).toContain('PlayCount="12"')
    expect(xml).toContain('AverageBpm="150.00"')
    // rekordbox XML rates 0..255 in steps of 51; 5 alone read as 0 stars in baken
    expect(xml).toContain('Rating="255"')
    expect(xml).toContain('Kind="WAV File"')
  })

  // A # or a space left raw cuts the Location at baken's URL decoding.
  it('writes a file URL baken can decode', () => {
    expect(xml).toContain('Location="file:///Volumes/Public/Makina/Hands%20Of%20Fate%20%231.wav"')
  })

  // One TEMPO per change of tempo, starting at the first beat, or the grid drifts after a
  // tempo change (Hands Of Fate changes at 50 s).
  it('writes one tempo line per tempo change', () => {
    expect(xml).toContain('<TEMPO Inizio="0.050" Bpm="154.00" Metro="4/4" Battito="1"/>')
    expect(xml).toContain('<TEMPO Inizio="0.830" Bpm="150.00" Metro="4/4" Battito="3"/>')
    expect(xml.match(/<TEMPO /g)).toHaveLength(2)
  })

  // No colour on hot cues: patched baken writes rekordbox's default for the letter.
  it('writes memory cues, loops and hot cue letters without colour', () => {
    expect(xml).toContain('<POSITION_MARK Name="Intro" Type="0" Start="1.000" Num="-1"/>')
    expect(xml).toContain('<POSITION_MARK Name="" Type="4" Start="9.000" End="17.000" Num="3"/>')
    expect(xml).not.toContain('Red=')
  })

  it('nests the playlists in their folders, in order, without the missing track', () => {
    const playlists = xml.slice(xml.indexOf('<PLAYLISTS>'))
    expect(playlists).toContain('<NODE Type="0" Name="ROOT" Count="2">')
    expect(playlists).toContain('<NODE Type="0" Name="BASES" Count="1">')
    expect(playlists).toContain('<NODE Name="Makina" Type="1" KeyType="0" Entries="2"><TRACK Key="101"/><TRACK Key="102"/></NODE>')
    expect(playlists.indexOf('BASES')).toBeLessThan(playlists.indexOf('House'))
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenXml.test.ts`
Expected: FAIL, `Cannot find module './bakenXml'`.

- [ ] **Step 4: Implement**

`src/main/bakenXml.ts`:

```ts
import { pathToFileURL } from 'node:url'
import { escapeXml } from '../shared/xml'
import type { Beat } from './anlz'
import type { ExportSelection, ExportTrack } from './usbExportSource'

// baken reads a rekordbox collection XML (DJ_PLAYLISTS) and writes the stick from it. Surco
// builds that XML from master.db; this is gen_xml2.py from the spike, whose output gave a
// stick Vicent's players read "perfectly" (16/10), ported with its measured rules.

const KINDS: Record<number, string> = {
  1: 'MP3 File',
  4: 'M4A File',
  5: 'FLAC File',
  11: 'WAV File',
  12: 'AIFF File',
}

// rekordbox's djmdCue.Kind for hot cues skips 4: A..C are 1..3 and D..H are 5..9.
export function hotCueNum(kind: number): number | null {
  if (kind === 0) return -1
  if (kind >= 1 && kind <= 3) return kind - 1
  if (kind >= 5 && kind <= 9) return kind - 2
  return null
}

export interface XmlTrackFacts {
  size: number
  grid: Beat[]
}

const attrs = (pairs: [string, string | number][]): string =>
  pairs.map(([k, v]) => `${k}="${escapeXml(String(v))}"`).join(' ')

function tempoLines(grid: Beat[]): string[] {
  const lines: string[] = []
  let last: number | null = null
  for (const b of grid) {
    const bpm = Math.round(b.bpm * 100) / 100
    if (bpm === last) continue
    last = bpm
    lines.push(`<TEMPO Inizio="${(b.ms / 1000).toFixed(3)}" Bpm="${bpm.toFixed(2)}" Metro="4/4" Battito="${b.beat}"/>`)
  }
  return lines
}

function cueLines(t: ExportTrack): string[] {
  return t.cues.flatMap((c) => {
    const num = hotCueNum(c.kind)
    if (num === null) return []
    const loop = c.outMs > 0
    const head = attrs([
      ['Name', c.comment],
      ['Type', loop ? 4 : 0],
      ['Start', (c.inMs / 1000).toFixed(3)],
      ...(loop ? ([['End', (c.outMs / 1000).toFixed(3)]] as [string, string][]) : []),
      ['Num', num],
    ])
    return [`<POSITION_MARK ${head}/>`]
  })
}

function trackXml(t: ExportTrack, f: XmlTrackFacts): string {
  const head = attrs([
    ['TrackID', t.id],
    ['Name', t.title],
    ['Artist', t.artist],
    ['Composer', t.composer],
    ['Album', t.album],
    ['Genre', t.genre],
    ['Kind', KINDS[t.fileType] ?? ''],
    ['Size', f.size],
    ['TotalTime', t.lengthSec],
    ['DiscNumber', t.discNo],
    ['TrackNumber', t.trackNo],
    ['Year', t.year],
    ['AverageBpm', t.bpm.toFixed(2)],
    ['DateAdded', t.dateAdded],
    ['BitRate', t.bitRate],
    ['SampleRate', t.sampleRate],
    ['Comments', t.comment],
    ['PlayCount', t.playCount],
    // rekordbox XML rates 0..255; 51 per star.
    ['Rating', Math.min(Math.max(t.rating, 0), 5) * 51],
    // pathToFileURL encodes spaces, # and ?, which would otherwise end the URL early.
    ['Location', pathToFileURL(t.path).href],
    ['Remixer', t.remixer],
    ['Tonality', t.key],
    ['Label', t.label],
    ['Mix', t.mix],
  ])
  return [`<TRACK ${head}>`, ...tempoLines(f.grid), ...cueLines(t), '</TRACK>'].join('\n')
}

interface Folder {
  name: string
  children: (Folder | string)[]
}

export function buildBakenXml(sel: ExportSelection, facts: ReadonlyMap<string, XmlTrackFacts>): string {
  const tracks = sel.tracks.filter((t) => facts.has(t.id))
  const root: Folder = { name: 'ROOT', children: [] }
  for (const p of sel.playlists) {
    let at = root
    for (const name of p.folders) {
      let next = at.children.find((c): c is Folder => typeof c !== 'string' && c.name === name)
      if (!next) {
        next = { name, children: [] }
        at.children.push(next)
      }
      at = next
    }
    const ids = p.trackIds.filter((id) => facts.has(id))
    at.children.push(
      `<NODE ${attrs([['Name', p.name], ['Type', 1], ['KeyType', 0], ['Entries', ids.length]])}>${ids
        .map((id) => `<TRACK Key="${escapeXml(id)}"/>`)
        .join('')}</NODE>`,
    )
  }
  const node = (f: Folder): string =>
    [
      `<NODE ${attrs([['Type', 0], ['Name', f.name], ['Count', f.children.length]])}>`,
      ...f.children.map((c) => (typeof c === 'string' ? c : node(c))),
      '</NODE>',
    ].join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '<PRODUCT Name="rekordbox" Version="7.2.19" Company="AlphaTheta"/>',
    `<COLLECTION Entries="${tracks.length}">`,
    ...tracks.map((t) => trackXml(t, facts.get(t.id) as XmlTrackFacts)),
    '</COLLECTION>',
    '<PLAYLISTS>',
    node(root),
    '</PLAYLISTS>',
    '</DJ_PLAYLISTS>',
    '',
  ].join('\n')
}
```

The `PRODUCT` line names rekordbox 7.2.19 because that is the export baken's OneLibrary layout was copied from and the spike validated; baken does not branch on it.

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenXml.test.ts`
Expected: PASS (9).

- [ ] **Step 6: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add -A apps/desktop/src/shared/xml.ts apps/desktop/src/shared/xml.test.ts apps/desktop/src/renderer/src/lib apps/desktop/src/main/bakenXml.ts apps/desktop/src/main/bakenXml.test.ts
git commit -m "Build baken's collection XML from the rekordbox selection"
```

---
### Task 7: The work folder and the baken runner

**Files:**
- Create: `src/main/usbExportStage.ts`, `src/main/usbExportStage.test.ts`
- Create: `src/main/bakenRun.ts`, `src/main/bakenRun.test.ts`

**Interfaces:**
- Consumes: `maskVocals`, `beatGrid`, `wavePreview` (Task 4); `ExportSelection` (Task 5); `buildBakenXml` (Task 6); the JSON protocol (Global Constraints).
- Produces (Task 9):

```ts
// usbExportStage.ts
export interface Stage {
  dir: string; xml: string; anlzDir: string; artworkDir: string; settingsDir: string | null
  included: string[]           // track ids in the XML
  missing: string[]            // ids whose file was not found
  sizes: Map<string, number>   // real file sizes of the included tracks
  waves: Map<string, number[]> // PWAV previews, 100 bars
  covers: Map<string, string>  // small cover data URLs
}
export interface StageInput { sel: ExportSelection; shareDir: string; settingsSource: string | null; dir: string }
export function smallCoverPath(imagePath: string): string
export async function stageExport(input: StageInput): Promise<Stage>

// bakenRun.ts
export type BakenEvent = BakenPlan | BakenStart | BakenWritten | BakenFailed | BakenDatabase | BakenReport | BakenError
export function parseBakenLine(line: string): BakenEvent | null
export interface BakenArgsInput { stage: Stage; device: string; prune: boolean; dryRun: boolean; home: string }
export function bakenArgs(input: BakenArgsInput): string[]   // throws BakenGuardError
export class BakenGuardError extends Error {}
export interface BakenHandle { done: Promise<{ code: number | null; stderr: string }>; kill: () => void }
export function runBaken(command: { file: string; prefixArgs: string[] }, args: string[], onEvent: (e: BakenEvent) => void): BakenHandle
```

The exact event types:

```ts
export interface BakenPlan { event: 'plan'; tracks: { id: number; usbPath: string; size: number; onStick: boolean }[]; spaceNeeded: number; spaceAvailable: number | null; warnings: string[]; skipped: { name: string; reason: string }[]; onelibraryFiles: string[] }
export interface BakenStart { event: 'start'; index: number; usbPath: string; size: number }
export interface BakenWritten { event: 'written'; index: number; kept: boolean }
export interface BakenFailed { event: 'failed'; index: number; message: string }
export interface BakenDatabase { event: 'database' }
export interface BakenReport { event: 'report'; copied: number; kept: number; failures: { name: string; message: string }[]; cancelled: boolean; onelibraryWritten: boolean; onelibraryError: string | null; artwork: number; pruned: number; tracksInDatabase: number }
export interface BakenError { event: 'error'; kind: 'not-enough-space' | 'device-write' | 'device-not-found' | 'other'; message: string; needed?: number; available?: number }
```

- [ ] **Step 1: Write the failing stage tests**

`src/main/usbExportStage.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { anlzSections } from './anlz'
import { smallCoverPath, stageExport } from './usbExportStage'
import type { ExportSelection, ExportTrack } from './usbExportSource'

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const anlzFile = (...sections: Buffer[]): Buffer => {
  const out = Buffer.concat([Buffer.from('PMAI'), u32(28), u32(0), Buffer.alloc(16), ...sections])
  out.writeUInt32BE(out.length, 8)
  return out
}
const pwav = Buffer.concat([Buffer.from('PWAV'), u32(20), u32(420), u32(400), u32(0x10000), Buffer.alloc(400, 0xbf)])

function track(over: Partial<ExportTrack>): ExportTrack {
  return {
    id: '1', path: '', title: 'T', artist: '', album: '', genre: '', label: '', remixer: '',
    composer: '', mix: '', key: '', fileType: 11, lengthSec: 1, bpm: 120, bitRate: 0,
    sampleRate: 44100, bitDepth: 16, rating: 0, year: 0, trackNo: 0, discNo: 0, dateAdded: '',
    playCount: 0, comment: '', analysisPath: '', imagePath: '', separator: false,
    streaming: false, cues: [], ...over,
  }
}

let root = ''
let share = ''
let settings = ''
let music = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'usb-stage-'))
  share = join(root, 'share')
  settings = join(root, 'rekordbox6')
  music = join(root, 'music')
  for (const d of [share, settings, music]) mkdirSync(d, { recursive: true })
  const anlz = join(share, 'PIONEER/USBANLZ/51d/3f604')
  mkdirSync(anlz, { recursive: true })
  writeFileSync(join(anlz, 'ANLZ0000.DAT'), anlzFile(pwav))
  writeFileSync(join(anlz, 'ANLZ0000.EXT'), anlzFile())
  writeFileSync(join(anlz, 'ANLZ0000.2EX'), anlzFile())
  mkdirSync(join(share, 'PIONEER/Artwork/00a/b1'), { recursive: true })
  writeFileSync(join(share, 'PIONEER/Artwork/00a/b1/artwork.jpg'), 'big')
  writeFileSync(join(share, 'PIONEER/Artwork/00a/b1/artwork_s.jpg'), 'small')
  writeFileSync(join(music, 'a.wav'), Buffer.alloc(1234))
  for (const f of ['MYSETTING.DAT', 'MYSETTING2.DAT', 'DJMMYSETTING.DAT', 'djprofile.nxs', 'other.txt'])
    writeFileSync(join(settings, f), f)
})

const SEL = (): ExportSelection => {
  const a = track({
    id: '101', path: join(music, 'a.wav'),
    analysisPath: '/PIONEER/USBANLZ/51d/3f604/ANLZ0000.DAT', imagePath: '/PIONEER/Artwork/00a/b1/artwork.jpg',
  })
  const gone = track({ id: '102', path: join(music, 'gone.wav') })
  const stream = track({ id: '103', path: 'spotify:x', streaming: true })
  return {
    playlists: [{ id: 'p', name: 'Makina', folders: [], trackIds: ['101', '102', '103'] }],
    tracks: [a, gone, stream],
  }
}

describe('stageExport', () => {
  it('copies the analysis for baken under USBANLZ, masking the vocal section', async () => {
    const s = await stageExport({ sel: SEL(), shareDir: share, settingsSource: settings, dir: join(root, 'stage') })
    const twoEx = readFileSync(join(s.anlzDir, '51d/3f604/ANLZ0000.2EX'))
    expect(anlzSections(twoEx).map((x) => x.tag)).toEqual(['PVDI'])
    expect(existsSync(join(s.anlzDir, '51d/3f604/ANLZ0000.DAT'))).toBe(true)
    expect(existsSync(join(s.anlzDir, '51d/3f604/ANLZ0000.EXT'))).toBe(true)
  })

  // The originals in rekordbox's share folder must come out byte for byte as they went in.
  it('never changes rekordbox own files', async () => {
    const before = readFileSync(join(share, 'PIONEER/USBANLZ/51d/3f604/ANLZ0000.2EX'))
    await stageExport({ sel: SEL(), shareDir: share, settingsSource: settings, dir: join(root, 'stage') })
    expect(readFileSync(join(share, 'PIONEER/USBANLZ/51d/3f604/ANLZ0000.2EX'))).toEqual(before)
  })

  it('names the artwork by TrackID for baken', async () => {
    const s = await stageExport({ sel: SEL(), shareDir: share, settingsSource: settings, dir: join(root, 'stage') })
    expect(readFileSync(join(s.artworkDir, '101.jpg'), 'utf8')).toBe('big')
    expect(s.covers.get('101')).toBe(`data:image/jpeg;base64,${Buffer.from('small').toString('base64')}`)
  })

  // A file that is gone (or on a NAS that is asleep) and a streaming row stay out of the
  // XML; the rest still exports.
  it('leaves out what has no file, and says which', async () => {
    const s = await stageExport({ sel: SEL(), shareDir: share, settingsSource: settings, dir: join(root, 'stage') })
    expect(s.included).toEqual(['101'])
    expect(s.missing).toEqual(['102'])
    expect(s.sizes.get('101')).toBe(1234)
    const xml = readFileSync(s.xml, 'utf8')
    expect(xml).toContain('Size="1234"')
    expect(xml).not.toContain('TrackID="102"')
    expect(xml).not.toContain('TrackID="103"')
  })

  it('keeps the waveform preview for the export list', async () => {
    const s = await stageExport({ sel: SEL(), shareDir: share, settingsSource: settings, dir: join(root, 'stage') })
    expect(s.waves.get('101')).toHaveLength(100)
    expect(s.waves.get('101')?.[0]).toBe(1)
  })

  it('copies only the My Settings files baken reads', async () => {
    const s = await stageExport({ sel: SEL(), shareDir: share, settingsSource: settings, dir: join(root, 'stage') })
    expect(s.settingsDir).not.toBeNull()
    expect(existsSync(join(s.settingsDir as string, 'MYSETTING.DAT'))).toBe(true)
    expect(existsSync(join(s.settingsDir as string, 'other.txt'))).toBe(false)
  })

  // baken refuses to run without the three required files; without them the stick goes
  // with --no-settings and the player keeps its own.
  it('has no settings folder when rekordbox wrote none', async () => {
    const s = await stageExport({ sel: SEL(), shareDir: share, settingsSource: join(root, 'nowhere'), dir: join(root, 'stage') })
    expect(s.settingsDir).toBeNull()
  })

  it('finds rekordbox small thumbnail beside the cover', () => {
    expect(smallCoverPath('/PIONEER/Artwork/00a/b1/artwork.jpg')).toBe('/PIONEER/Artwork/00a/b1/artwork_s.jpg')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExportStage.test.ts`
Expected: FAIL, `Cannot find module './usbExportStage'`.

- [ ] **Step 3: Implement the stage**

`src/main/usbExportStage.ts`:

```ts
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { beatGrid, maskVocals, wavePreview } from './anlz'
import { buildBakenXml, type XmlTrackFacts } from './bakenXml'
import type { ExportSelection } from './usbExportSource'

// The folder baken works from, so that baken never looks into ~/Library/Pioneer itself and
// nothing there is ever written: the XML, a copy of rekordbox's analysis for the selected
// tracks only (with the vocal section masked as rekordbox's export does), the artwork named
// by TrackID for --artwork-dir, and a copy of the My Settings. Staged fresh each time: a
// cache would let analysis of unselected tracks into baken's filename matching.

export interface Stage {
  dir: string
  xml: string
  anlzDir: string
  artworkDir: string
  settingsDir: string | null
  included: string[]
  missing: string[]
  sizes: Map<string, number>
  waves: Map<string, number[]>
  covers: Map<string, string>
}

export interface StageInput {
  sel: ExportSelection
  shareDir: string
  settingsSource: string | null
  dir: string
}

const REQUIRED_SETTINGS = ['MYSETTING.DAT', 'MYSETTING2.DAT', 'DJMMYSETTING.DAT']
const OPTIONAL_SETTINGS = ['DEVSETTING.DAT', 'djprofile.nxs']
const ANLZ_ROOT = '/PIONEER/USBANLZ/'

// rekordbox keeps an 80 px thumbnail beside each cover with _s before the extension
// (docs/export-usb-medidas.md); the list shows that one, never the full picture.
export function smallCoverPath(imagePath: string): string {
  const ext = extname(imagePath)
  return `${imagePath.slice(0, imagePath.length - ext.length)}_s${ext}`
}

const sizeOf = async (path: string): Promise<number | null> =>
  stat(path).then((s) => (s.isFile() ? s.size : null)).catch(() => null)
const read = async (path: string): Promise<Buffer | null> => readFile(path).catch(() => null)

async function stageSettings(source: string | null, dir: string): Promise<string | null> {
  if (!source) return null
  const files = await Promise.all(REQUIRED_SETTINGS.map((f) => sizeOf(join(source, f))))
  if (files.some((s) => s === null)) return null
  await mkdir(dir, { recursive: true })
  for (const f of [...REQUIRED_SETTINGS, ...OPTIONAL_SETTINGS])
    await copyFile(join(source, f), join(dir, f)).catch(() => undefined)
  return dir
}

export async function stageExport(input: StageInput): Promise<Stage> {
  const { sel, shareDir, dir } = input
  const anlzDir = join(dir, 'USBANLZ')
  const artworkDir = join(dir, 'artwork')
  await mkdir(anlzDir, { recursive: true })
  await mkdir(artworkDir, { recursive: true })
  const facts = new Map<string, XmlTrackFacts>()
  const missing: string[] = []
  const waves = new Map<string, number[]>()
  const covers = new Map<string, string>()
  for (const t of sel.tracks) {
    if (t.streaming) continue
    const size = await sizeOf(t.path)
    if (size === null) {
      missing.push(t.id)
      continue
    }
    let grid: XmlTrackFacts['grid'] = []
    if (t.analysisPath.startsWith(ANLZ_ROOT)) {
      const rel = t.analysisPath.slice(ANLZ_ROOT.length)
      for (const ext of ['DAT', 'EXT', '2EX']) {
        const name = rel.replace(/\.DAT$/, `.${ext}`)
        const bytes = await read(join(shareDir, ANLZ_ROOT, name))
        if (!bytes) continue
        await mkdir(dirname(join(anlzDir, name)), { recursive: true })
        await writeFile(join(anlzDir, name), ext === '2EX' ? maskVocals(bytes) : bytes)
        if (ext === 'DAT') {
          grid = beatGrid(bytes)
          const wave = wavePreview(bytes)
          if (wave) waves.set(t.id, wave)
        }
      }
    }
    if (t.imagePath) {
      const cover = await read(join(shareDir, t.imagePath))
      if (cover) await writeFile(join(artworkDir, `${t.id}${extname(t.imagePath).toLowerCase()}`), cover)
      const small = await read(join(shareDir, smallCoverPath(t.imagePath)))
      if (small) covers.set(t.id, `data:image/jpeg;base64,${small.toString('base64')}`)
    }
    facts.set(t.id, { size, grid })
  }
  const xml = join(dir, 'collection.xml')
  await writeFile(xml, buildBakenXml(sel, facts))
  return {
    dir,
    xml,
    anlzDir,
    artworkDir,
    settingsDir: await stageSettings(input.settingsSource, join(dir, 'settings')),
    included: [...facts.keys()],
    missing,
    sizes: new Map([...facts].map(([id, f]) => [id, f.size])),
    waves,
    covers,
  }
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExportStage.test.ts`
Expected: PASS (8).

- [ ] **Step 5: Write the failing runner tests**

`src/main/bakenRun.test.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type BakenEvent, BakenGuardError, bakenArgs, parseBakenLine, runBaken } from './bakenRun'
import type { Stage } from './usbExportStage'

const stage = (dir: string, settings: string | null = `${dir}/settings`): Stage => ({
  dir, xml: `${dir}/collection.xml`, anlzDir: `${dir}/USBANLZ`, artworkDir: `${dir}/artwork`,
  settingsDir: settings, included: [], missing: [], sizes: new Map(), waves: new Map(), covers: new Map(),
})

describe('bakenArgs', () => {
  const base = { stage: stage('/tmp/s'), device: '/Volumes/Vicent 1', prune: false, dryRun: false, home: '/Users/dj' }

  // baken left alone looks for rekordbox's analysis and settings in ~/Library/Pioneer; Surco
  // always hands it the staged copies so it never goes there.
  it('always passes the staged analysis, artwork and settings, OneLibrary and JSON', () => {
    expect(bakenArgs(base)).toEqual([
      'expressport', '/tmp/s/collection.xml', '--device', '/Volumes/Vicent 1',
      '--anlz-dir', '/tmp/s/USBANLZ', '--settings-dir', '/tmp/s/settings',
      '--onelibrary', '--artwork', '--artwork-dir', '/tmp/s/artwork', '--generate-analysis',
      '--device-name', '', '--json',
    ])
  })

  it('writes no settings when none were staged', () => {
    const args = bakenArgs({ ...base, stage: stage('/tmp/s', null) })
    expect(args).toContain('--no-settings')
    expect(args).not.toContain('--settings-dir')
  })

  // Deleting music is the user's explicit choice, never the default.
  it('prunes only when asked, and dry-runs for the summary', () => {
    expect(bakenArgs(base)).not.toContain('--prune')
    expect(bakenArgs({ ...base, prune: true })).toContain('--prune')
    expect(bakenArgs({ ...base, dryRun: true })).toContain('--dry-run')
  })

  it('refuses to write rekordbox own folder, the home folder or the system root', () => {
    for (const device of ['/Users/dj/Library/Pioneer', '/Users/dj/Library/Pioneer/rekordbox', '/Users/dj', '/'])
      expect(() => bakenArgs({ ...base, device })).toThrow(BakenGuardError)
    expect(() => bakenArgs({ ...base, stage: stage('/Users/dj/Library/Pioneer/x') })).toThrow(BakenGuardError)
  })
})

describe('parseBakenLine', () => {
  it('reads the events of the protocol', () => {
    expect(parseBakenLine('{"event":"start","index":0,"usbPath":"/Contents/a.wav","size":5}')).toEqual({
      event: 'start', index: 0, usbPath: '/Contents/a.wav', size: 5,
    })
    expect(parseBakenLine('{"event":"database"}')).toEqual({ event: 'database' })
  })

  // A stray line (a panic message, a future event) must not end the run.
  it('ignores what is not an event', () => {
    expect(parseBakenLine('thread main panicked')).toBeNull()
    expect(parseBakenLine('{"event":"later"}')).toBeNull()
    expect(parseBakenLine('')).toBeNull()
  })
})

describe('runBaken', () => {
  // A fake baken speaking the same lines, so the spawn, the line splitting and the kill
  // are exercised without the real binary or a stick.
  async function fake(body: string): Promise<{ file: string; prefixArgs: string[] }> {
    const script = join(await mkdtemp(join(tmpdir(), 'fake-baken-')), 'baken.cjs')
    writeFileSync(script, body)
    return { file: process.execPath, prefixArgs: [script] }
  }

  it('hands over each event in order and the exit status', async () => {
    const cmd = await fake(`
      const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
      out({ event: 'start', index: 0, usbPath: '/Contents/a.wav', size: 3 })
      process.stdout.write('{"event":"written","ind')
      setTimeout(() => { process.stdout.write('ex":0,"kept":false}\\n'); out({ event: 'database' }); process.exit(0) }, 20)
    `)
    const seen: BakenEvent[] = []
    const { code } = await runBaken(cmd, [], (e) => seen.push(e)).done
    expect(code).toBe(0)
    expect(seen.map((e) => e.event)).toEqual(['start', 'written', 'database'])
  })

  it('turns the update check off', async () => {
    const cmd = await fake(`process.stdout.write(JSON.stringify({ event: 'error', kind: 'other', message: process.env.BAKEN_NO_UPDATE_CHECK }) + '\\n')`)
    const seen: BakenEvent[] = []
    await runBaken(cmd, [], (e) => seen.push(e)).done
    expect(seen[0]).toMatchObject({ message: '1' })
  })

  it('stops the process when killed', async () => {
    const cmd = await fake('setInterval(() => {}, 1000)')
    const handle = runBaken(cmd, [], () => {})
    handle.kill()
    const { code } = await handle.done
    expect(code).not.toBe(0)
  })
})
```

- [ ] **Step 6: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenRun.test.ts`
Expected: FAIL, `Cannot find module './bakenRun'`.

- [ ] **Step 7: Implement the runner**

`src/main/bakenRun.ts`:

```ts
import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import type { Stage } from './usbExportStage'

// Drives Surco's patched baken (vendor/baken/patches) through its --json lines: one object
// per line on stdout. The human output is never read; it is a progress bar that vanishes
// off a terminal.

export interface BakenPlan {
  event: 'plan'
  tracks: { id: number; usbPath: string; size: number; onStick: boolean }[]
  spaceNeeded: number
  spaceAvailable: number | null
  warnings: string[]
  skipped: { name: string; reason: string }[]
  onelibraryFiles: string[]
}
export interface BakenStart {
  event: 'start'
  index: number
  usbPath: string
  size: number
}
export interface BakenWritten {
  event: 'written'
  index: number
  kept: boolean
}
export interface BakenFailed {
  event: 'failed'
  index: number
  message: string
}
export interface BakenDatabase {
  event: 'database'
}
export interface BakenReport {
  event: 'report'
  copied: number
  kept: number
  failures: { name: string; message: string }[]
  cancelled: boolean
  onelibraryWritten: boolean
  onelibraryError: string | null
  artwork: number
  pruned: number
  tracksInDatabase: number
}
export interface BakenError {
  event: 'error'
  kind: 'not-enough-space' | 'device-write' | 'device-not-found' | 'other'
  message: string
  needed?: number
  available?: number
}
export type BakenEvent =
  | BakenPlan
  | BakenStart
  | BakenWritten
  | BakenFailed
  | BakenDatabase
  | BakenReport
  | BakenError

const EVENTS = new Set(['plan', 'start', 'written', 'failed', 'database', 'report', 'error'])

export function parseBakenLine(line: string): BakenEvent | null {
  try {
    const v = JSON.parse(line) as { event?: unknown }
    return typeof v?.event === 'string' && EVENTS.has(v.event) ? (v as BakenEvent) : null
  } catch {
    return null
  }
}

export class BakenGuardError extends Error {}

export interface BakenArgsInput {
  stage: Stage
  device: string
  prune: boolean
  dryRun: boolean
  home: string
}

const inside = (path: string, dir: string): boolean => {
  const p = resolve(path)
  const d = resolve(dir)
  return p === d || p.startsWith(d + sep)
}

// The last line of defence for the two rules that matter most: nothing under
// ~/Library/Pioneer is ever written or read by baken directly, and the device is never the
// system root or the home folder.
export function bakenArgs({ stage, device, prune, dryRun, home }: BakenArgsInput): string[] {
  const pioneer = resolve(home, 'Library', 'Pioneer')
  if (resolve(device) === '/' || resolve(device) === resolve(home) || inside(device, pioneer))
    throw new BakenGuardError(`refusing to export to ${device}`)
  for (const p of [stage.dir, stage.anlzDir, stage.artworkDir, stage.settingsDir ?? stage.dir])
    if (inside(p, pioneer)) throw new BakenGuardError(`refusing to stage inside ${pioneer}`)
  return [
    'expressport',
    stage.xml,
    '--device',
    device,
    '--anlz-dir',
    stage.anlzDir,
    ...(stage.settingsDir ? ['--settings-dir', stage.settingsDir] : ['--no-settings']),
    '--onelibrary',
    '--artwork',
    '--artwork-dir',
    stage.artworkDir,
    '--generate-analysis',
    // rekordbox 7.2.19's export leaves the name empty; the spike stick did the same.
    '--device-name',
    '',
    '--json',
    ...(prune ? ['--prune'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ]
}

export interface BakenHandle {
  done: Promise<{ code: number | null; stderr: string }>
  kill: () => void
}

export function runBaken(
  command: { file: string; prefixArgs: string[] },
  args: string[],
  onEvent: (e: BakenEvent) => void,
): BakenHandle {
  const child = spawn(command.file, [...command.prefixArgs, ...args], {
    env: { ...process.env, BAKEN_NO_UPDATE_CHECK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const e = parseBakenLine(line)
    if (e) onEvent(e)
  })
  const done = new Promise<{ code: number | null; stderr: string }>((res) => {
    child.on('error', (err) => res({ code: null, stderr: String(err) }))
    child.on('close', (code) => res({ code, stderr }))
  })
  return { done, kill: () => child.kill('SIGTERM') }
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenRun.test.ts src/main/usbExportStage.test.ts`
Expected: PASS. (`close` fires after stdout ends, so every line is delivered before `done` resolves.)

- [ ] **Step 9: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/usbExportStage.ts apps/desktop/src/main/usbExportStage.test.ts apps/desktop/src/main/bakenRun.ts apps/desktop/src/main/bakenRun.test.ts
git commit -m "Stage baken's work folder and run it through its JSON lines"
```

---
### Task 8: Removable volumes, who wrote them, and the per-stick memory

**Files:**
- Create: `src/main/usbVolumes.ts`, `src/main/usbVolumes.test.ts`
- Create: `src/main/usbExportMemory.ts`, `src/main/usbExportMemory.test.ts`
- Modify: `src/shared/types.ts` (the volume and target types)

**Interfaces:**
- Consumes: the diskutil fixtures (Task 1).
- Produces (Task 9, renderer):

```ts
// shared/types.ts
export type UsbFilesystem = 'fat32' | 'exfat' | 'hfs' | 'apfs' | 'other'
export interface UsbHolder { by: 'rekordbox' | 'surco' | 'other' | 'empty'; at: number | null }
export interface UsbRemembered { playlistIds: string[]; prune: boolean; at: number }
export interface UsbVolume {
  uuid: string; name: string; mountPoint: string; filesystem: UsbFilesystem
  partitionScheme: 'mbr' | 'gpt' | 'other'; totalBytes: number; freeBytes: number
  holder: UsbHolder; remembered: UsbRemembered | null
}
export type UsbTarget = { kind: 'volume'; uuid: string } | { kind: 'folder'; path: string }
export interface UsbVolumeList { volumes: UsbVolume[]; lastKey: string | null }

// usbVolumes.ts
export function parsePlist(xml: string): unknown
export type DiskutilInfo = Record<string, unknown>
export function isUsbVolume(info: DiskutilInfo): boolean
export function filesystemOf(info: DiskutilInfo): UsbFilesystem
export function schemeOf(whole: DiskutilInfo | null): 'mbr' | 'gpt' | 'other'
export async function stickHolder(root: string, pdb: { size: number; mtimeMs: number } | null): Promise<UsbHolder>
export interface VolumeDeps { list: () => Promise<string[]>; info: (target: string) => Promise<DiskutilInfo | null> }
export const DARWIN_VOLUMES: VolumeDeps
export async function readVolumes(deps: VolumeDeps, memory: UsbMemory): Promise<UsbVolume[]>
export async function uuidAt(deps: VolumeDeps, mountPoint: string): Promise<string | null>
export function watchVolumes(onChange: () => void): () => void

// usbExportMemory.ts
export interface UsbMemoryEntry { playlistIds: string[]; trackIds: string[]; at: number; pdb: { size: number; mtimeMs: number } | null; prune: boolean }
export function targetKey(t: UsbTarget): string
export interface UsbMemory { last(): string | null; get(key: string): UsbMemoryEntry | null; remember(key: string, entry: UsbMemoryEntry): void }
export function createUsbMemory(file: string): UsbMemory
```

- [ ] **Step 1: Add the shared types**

At the end of `src/shared/types.ts`:

```ts
// The USB export (docs/superpowers/specs/2026-10-16-export-usb-design.md). A stick is
// always named by its Volume UUID: two sticks may share a name ("Vicent" and "Vicent").
export type UsbFilesystem = 'fat32' | 'exfat' | 'hfs' | 'apfs' | 'other'

export interface UsbHolder {
  by: 'rekordbox' | 'surco' | 'other' | 'empty'
  // export.pdb's modification time, when there is one.
  at: number | null
}

// What Surco exported to this stick last time, so the next time is one press of Exportar.
export interface UsbRemembered {
  playlistIds: string[]
  prune: boolean
  at: number
}

export interface UsbVolume {
  uuid: string
  name: string
  mountPoint: string
  filesystem: UsbFilesystem
  partitionScheme: 'mbr' | 'gpt' | 'other'
  totalBytes: number
  freeBytes: number
  holder: UsbHolder
  remembered: UsbRemembered | null
}

export type UsbTarget = { kind: 'volume'; uuid: string } | { kind: 'folder'; path: string }

export interface UsbVolumeList {
  volumes: UsbVolume[]
  // targetKey of the last export, to preselect it.
  lastKey: string | null
}
```

- [ ] **Step 2: Write the failing memory tests**

`src/main/usbExportMemory.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createUsbMemory, targetKey } from './usbExportMemory'

const entry = { playlistIds: ['2000'], trackIds: ['101', '102'], at: 1, pdb: { size: 9, mtimeMs: 2 }, prune: false }

describe('usb export memory', () => {
  // By UUID, never by name: Vicent's two sticks are both called "Vicent".
  it('keys sticks by UUID and folders by path', () => {
    expect(targetKey({ kind: 'volume', uuid: 'B10C' })).toBe('volume:B10C')
    expect(targetKey({ kind: 'folder', path: '/Volumes/SD/sets' })).toBe('folder:/Volumes/SD/sets')
  })

  it('remembers per stick and which was last, across restarts', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'usb-mem-')), 'usb-exports.json')
    createUsbMemory(file).remember('volume:A', entry)
    createUsbMemory(file).remember('volume:B', { ...entry, playlistIds: ['3000'] })
    const again = createUsbMemory(file)
    expect(again.get('volume:A')?.playlistIds).toEqual(['2000'])
    expect(again.get('volume:B')?.playlistIds).toEqual(['3000'])
    expect(again.last()).toBe('volume:B')
    expect(again.get('volume:C')).toBeNull()
  })

  // A broken file must not take the export down; it only forgets.
  it('starts empty from a missing or broken file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usb-mem-'))
    expect(createUsbMemory(join(dir, 'none.json')).last()).toBeNull()
    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(createUsbMemory(join(dir, 'bad.json')).get('volume:A')).toBeNull()
  })

  it('writes the whole file each time, never a half', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'usb-mem-')), 'usb-exports.json')
    createUsbMemory(file).remember('volume:A', entry)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ last: 'volume:A', entries: { 'volume:A': entry } })
  })
})
```

- [ ] **Step 3: Run them to see them fail, then implement**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExportMemory.test.ts`
Expected: FAIL, `Cannot find module './usbExportMemory'`.

`src/main/usbExportMemory.ts`:

```ts
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { UsbTarget } from '../shared/types'

// What Surco last exported to each stick, in its own file in userData rather than in
// settings.json: it is meaningful on this machine only (sticks are plugged in here) and
// grows with track IDs. Losing it only means the next export starts unticked.

export interface UsbMemoryEntry {
  playlistIds: string[]
  trackIds: string[]
  at: number
  // export.pdb right after Surco wrote it, to tell later whether someone else wrote over it.
  pdb: { size: number; mtimeMs: number } | null
  prune: boolean
}

interface MemoryFile {
  last: string | null
  entries: Record<string, UsbMemoryEntry>
}

export function targetKey(t: UsbTarget): string {
  return t.kind === 'volume' ? `volume:${t.uuid}` : `folder:${t.path}`
}

export interface UsbMemory {
  last: () => string | null
  get: (key: string) => UsbMemoryEntry | null
  remember: (key: string, entry: UsbMemoryEntry) => void
}

export function createUsbMemory(file: string): UsbMemory {
  const load = (): MemoryFile => {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as MemoryFile
      return { last: data.last ?? null, entries: data.entries ?? {} }
    } catch {
      return { last: null, entries: {} }
    }
  }
  return {
    last: () => load().last,
    get: (key) => load().entries[key] ?? null,
    remember: (key, entry) => {
      const data = load()
      data.entries[key] = entry
      data.last = key
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, file)
    },
  }
}
```

Run again. Expected: PASS (4).

- [ ] **Step 4: Write the failing volume tests**

`src/main/usbVolumes.test.ts`:

```ts
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createUsbMemory } from './usbExportMemory'
import { type DiskutilInfo, filesystemOf, isUsbVolume, parsePlist, readVolumes, schemeOf, stickHolder, uuidAt } from './usbVolumes'

const fixture = (name: string): DiskutilInfo =>
  parsePlist(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')) as DiskutilInfo
const STICK = fixture('diskutil-usb-exfat.plist')
const WHOLE = fixture('diskutil-usb-whole.plist')
const INTERNAL = fixture('diskutil-internal.plist')

describe('parsePlist', () => {
  it('reads dicts, arrays, strings, integers and booleans', () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>A</key><string>x &amp; y</string><key>B</key><integer>42</integer><key>C</key><true/><key>D</key><array><string>p</string><false/></array><key>E</key><dict/></dict></plist>`
    expect(parsePlist(xml)).toEqual({ A: 'x & y', B: 42, C: true, D: ['p', false], E: {} })
  })

  it('reads the real diskutil output of the test stick', () => {
    expect(STICK.VolumeUUID).toBe('B10C96EF-51C2-344E-B78D-DAFC319D973E')
  })
})

describe('isUsbVolume', () => {
  it('takes the removable stick', () => {
    expect(isUsbVolume(STICK)).toBe(true)
  })

  // Never the system disk; a network share never gets here (diskutil does not know it).
  it('refuses the internal disk and disk images', () => {
    expect(isUsbVolume(INTERNAL)).toBe(false)
    expect(isUsbVolume({ ...STICK, BusProtocol: 'Disk Image' })).toBe(false)
    expect(isUsbVolume({ ...STICK, Internal: true })).toBe(false)
  })

  it('needs a mount point under /Volumes and a UUID', () => {
    expect(isUsbVolume({ ...STICK, MountPoint: '' })).toBe(false)
    expect(isUsbVolume({ ...STICK, VolumeUUID: undefined })).toBe(false)
  })
})

describe('filesystemOf and schemeOf', () => {
  it('names the filesystems the players care about', () => {
    expect(filesystemOf(STICK)).toBe('exfat')
    expect(filesystemOf({ FilesystemType: 'msdos', FilesystemName: 'MS-DOS FAT32' })).toBe('fat32')
    expect(filesystemOf({ FilesystemType: 'hfs' })).toBe('hfs')
    expect(filesystemOf({ FilesystemType: 'apfs' })).toBe('apfs')
  })

  // GPT is the other thing a CDJ-2000 or NXS2 cannot read.
  it('names the partition scheme of the whole disk', () => {
    expect(['mbr', 'gpt']).toContain(schemeOf(WHOLE))
    expect(schemeOf({ Content: 'FDisk_partition_scheme' })).toBe('mbr')
    expect(schemeOf({ Content: 'GUID_partition_scheme' })).toBe('gpt')
    expect(schemeOf(null)).toBe('other')
  })
})

describe('stickHolder', () => {
  async function stick(files: string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'stick-'))
    mkdirSync(join(root, 'PIONEER/rekordbox'), { recursive: true })
    for (const f of files) writeFileSync(join(root, 'PIONEER/rekordbox', f), 'x'.repeat(9))
    return root
  }

  it('is empty without export.pdb', async () => {
    expect(await stickHolder(await stick([]), null)).toEqual({ by: 'empty', at: null })
  })

  // baken always removes exportExt.pdb, rekordbox always writes it.
  it('is rekordbox when exportExt.pdb is there', async () => {
    expect((await stickHolder(await stick(['export.pdb', 'exportExt.pdb']), null)).by).toBe('rekordbox')
  })

  it('is Surco when export.pdb is the one Surco wrote, within FAT time resolution', async () => {
    const root = await stick(['export.pdb'])
    utimesSync(join(root, 'PIONEER/rekordbox/export.pdb'), 1000, 1000)
    expect((await stickHolder(root, { size: 9, mtimeMs: 1_001_500 })).by).toBe('surco')
    expect((await stickHolder(root, { size: 10, mtimeMs: 1_000_000 })).by).toBe('other')
  })
})

describe('readVolumes and uuidAt', () => {
  const deps = (infos: Record<string, DiskutilInfo | null>) => ({
    list: async () => Object.keys(infos).filter((k) => k.startsWith('/Volumes/')),
    info: async (target: string) => infos[target] ?? null,
  })

  // Two sticks with the same name mount as "Vicent" and "Vicent 1"; each is its own UUID.
  it('lists only the removable volumes, each by its UUID', async () => {
    const memory = createUsbMemory(join(await mkdtemp(join(tmpdir(), 'mem-')), 'm.json'))
    const twin = { ...STICK, VolumeUUID: 'OTHER-UUID', MountPoint: '/Volumes/Vicent 1', VolumeName: 'Vicent' }
    const vols = await readVolumes(
      deps({
        '/Volumes/Surco': STICK,
        '/Volumes/Vicent 1': twin,
        '/Volumes/Macintosh HD': INTERNAL,
        '/Volumes/Public': null,
        [String(STICK.ParentWholeDisk)]: WHOLE,
      }),
      memory,
    )
    expect(vols.map((v) => [v.uuid, v.mountPoint])).toEqual([
      ['B10C96EF-51C2-344E-B78D-DAFC319D973E', '/Volumes/Surco'],
      ['OTHER-UUID', '/Volumes/Vicent 1'],
    ])
    expect(vols[0].filesystem).toBe('exfat')
    expect(vols[0].totalBytes).toBeGreaterThan(0)
  })

  it('reads the UUID at a mount point right now', async () => {
    expect(await uuidAt(deps({ '/Volumes/Surco': STICK }), '/Volumes/Surco')).toBe('B10C96EF-51C2-344E-B78D-DAFC319D973E')
    expect(await uuidAt(deps({}), '/Volumes/Surco')).toBeNull()
  })
})
```

- [ ] **Step 5: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbVolumes.test.ts`
Expected: FAIL, `Cannot find module './usbVolumes'`.

- [ ] **Step 6: Implement**

`src/main/usbVolumes.ts`:

```ts
import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { UsbFilesystem, UsbHolder, UsbVolume } from '../shared/types'
import { type UsbMemory, targetKey } from './usbExportMemory'

// The sticks the export can write: mounted, removable, never the system disk, never a
// network share (diskutil does not know those, so they fall out on their own), never a disk
// image. Read from `diskutil info -plist`, one volume at a time, macOS only.

export type DiskutilInfo = Record<string, unknown>

// diskutil speaks XML plists. This reads the subset it uses (dict, array, key, string,
// integer, real, true, false) without a dependency or a call to plutil, so tests run on
// any CI runner.
export function parsePlist(xml: string): unknown {
  const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|string|integer|real|true|false|date|data)\s*(\/?)>([^<]*)/g)]
  let i = 0
  const text = (raw: string): string =>
    raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const value = (): unknown => {
    const [, , tag, selfClosing, body] = tokens[i++]
    if (tag === 'true') return true
    if (tag === 'false') return false
    if (selfClosing) return tag === 'dict' ? {} : tag === 'array' ? [] : ''
    if (tag === 'dict') {
      const out: Record<string, unknown> = {}
      while (i < tokens.length && tokens[i][1] !== '/') {
        const key = text(tokens[i][4])
        i += 2
        out[key] = value()
      }
      i++
      return out
    }
    if (tag === 'array') {
      const out: unknown[] = []
      while (i < tokens.length && tokens[i][1] !== '/') out.push(value())
      i++
      return out
    }
    i++
    return tag === 'integer' || tag === 'real' ? Number(body) : text(body)
  }
  return tokens.length ? value() : null
}

export function isUsbVolume(info: DiskutilInfo): boolean {
  return (
    info.Internal === false &&
    typeof info.MountPoint === 'string' &&
    info.MountPoint.startsWith('/Volumes/') &&
    typeof info.VolumeUUID === 'string' &&
    info.BusProtocol !== 'Disk Image' &&
    (info.RemovableMediaOrExternalDevice === true || info.Ejectable === true)
  )
}

export function filesystemOf(info: DiskutilInfo): UsbFilesystem {
  const type = String(info.FilesystemType ?? '').toLowerCase()
  if (type === 'msdos') return 'fat32'
  if (type === 'exfat') return 'exfat'
  if (type === 'hfs') return 'hfs'
  if (type === 'apfs') return 'apfs'
  return 'other'
}

export function schemeOf(whole: DiskutilInfo | null): 'mbr' | 'gpt' | 'other' {
  const content = String(whole?.Content ?? '')
  if (content === 'FDisk_partition_scheme') return 'mbr'
  if (content === 'GUID_partition_scheme') return 'gpt'
  return 'other'
}

// FAT stores modification times in 2-second steps.
const FAT_RESOLUTION_MS = 2000

export async function stickHolder(root: string, pdb: { size: number; mtimeMs: number } | null): Promise<UsbHolder> {
  const dir = join(root, 'PIONEER', 'rekordbox')
  const current = await stat(join(dir, 'export.pdb')).catch(() => null)
  if (!current) return { by: 'empty', at: null }
  const ext = await stat(join(dir, 'exportExt.pdb')).catch(() => null)
  if (ext) return { by: 'rekordbox', at: current.mtimeMs }
  if (pdb && pdb.size === current.size && Math.abs(pdb.mtimeMs - current.mtimeMs) <= FAT_RESOLUTION_MS)
    return { by: 'surco', at: current.mtimeMs }
  return { by: 'other', at: current.mtimeMs }
}

export interface VolumeDeps {
  list: () => Promise<string[]>
  info: (target: string) => Promise<DiskutilInfo | null>
}

const run = promisify(execFile)

export const DARWIN_VOLUMES: VolumeDeps = {
  list: async () => (await readdir('/Volumes').catch(() => [])).map((n) => join('/Volumes', n)),
  info: async (target) => {
    try {
      const { stdout } = await run('diskutil', ['info', '-plist', target])
      const info = parsePlist(stdout) as DiskutilInfo | null
      return info && info.Error !== true ? info : null
    } catch {
      return null
    }
  },
}

const numberOf = (v: unknown): number => (typeof v === 'number' ? v : 0)

export async function readVolumes(deps: VolumeDeps, memory: UsbMemory): Promise<UsbVolume[]> {
  const out: UsbVolume[] = []
  for (const mount of await deps.list()) {
    const info = await deps.info(mount)
    if (!info || !isUsbVolume(info)) continue
    const uuid = String(info.VolumeUUID)
    const entry = memory.get(targetKey({ kind: 'volume', uuid }))
    const whole = typeof info.ParentWholeDisk === 'string' ? await deps.info(info.ParentWholeDisk) : null
    out.push({
      uuid,
      name: String(info.VolumeName ?? ''),
      mountPoint: String(info.MountPoint),
      filesystem: filesystemOf(info),
      partitionScheme: schemeOf(whole),
      totalBytes: numberOf(info.TotalSize),
      freeBytes: numberOf(info.APFSContainerFree ?? info.FreeSpace),
      holder: await stickHolder(String(info.MountPoint), entry?.pdb ?? null),
      remembered: entry ? { playlistIds: entry.playlistIds, prune: entry.prune, at: entry.at } : null,
    })
  }
  return out
}

// Asked again right before baken starts: a mount point names whatever is mounted there now.
export async function uuidAt(deps: VolumeDeps, mountPoint: string): Promise<string | null> {
  const info = await deps.info(mountPoint)
  return info && typeof info.VolumeUUID === 'string' ? info.VolumeUUID : null
}

// macOS adds and removes /Volumes entries as volumes mount and unmount. Debounced: one mount
// fires several events.
export function watchVolumes(onChange: () => void): () => void {
  let timer: NodeJS.Timeout | null = null
  const watcher = watch('/Volumes', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 500)
  })
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
```

- [ ] **Step 7: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbVolumes.test.ts src/main/usbExportMemory.test.ts`
Expected: PASS. If `isUsbVolume(STICK)` fails, compare with the fields written down in Task 1 Step 3; the filter must follow the real stick, and the test that pins it must then say why.

- [ ] **Step 8: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/usbVolumes.ts apps/desktop/src/main/usbVolumes.test.ts apps/desktop/src/main/usbExportMemory.ts apps/desktop/src/main/usbExportMemory.test.ts apps/desktop/src/shared/types.ts
git commit -m "List removable volumes by UUID and remember each stick's export"
```

---
### Task 9: The exporter: summary, export, progress, cancel; IPC and preload

**Files:**
- Create: `src/main/usbExport.ts`, `src/main/usbExport.test.ts`, `src/main/usbExportIpc.ts`
- Modify: `src/shared/types.ts`, `src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`

**Interfaces:**
- Consumes: Tasks 3-8 (`bakenCommand`, `readExportSelection`, `stageExport`, `bakenArgs`, `runBaken`, `BakenEvent`, `readVolumes`, `uuidAt`, `watchVolumes`, `DARWIN_VOLUMES`, `createUsbMemory`, `targetKey`).
- Produces (renderer, Tasks 10-11), in `shared/types.ts`:

```ts
export interface UsbPlanTrack { id: string; title: string; artist: string; size: number; onStick: boolean; separator: boolean; cover: string | null; wave: number[] | null }
export type UsbWarning =
  | { kind: 'rekordboxExport' } | { kind: 'exfat' } | { kind: 'gpt' } | { kind: 'notVolumeRoot' }
  | { kind: 'cdj2000'; titles: string[] } | { kind: 'missing'; titles: string[] }
  | { kind: 'streaming'; count: number } | { kind: 'noSpace'; missingBytes: number }
export interface UsbPlan { tracks: UsbPlanTrack[]; trackCount: number; newCount: number; newBytes: number; keptCount: number; removedSinceLast: number | null; warnings: UsbWarning[] }
export interface UsbExportRequest { playlistIds: string[]; target: UsbTarget; prune: boolean }
export type UsbFailure = 'unsupported' | 'no-collection' | 'unreadable' | 'nothing-selected' | 'volume-gone' | 'volume-changed' | 'no-baken' | 'refused' | 'baken-failed' | 'device-write' | 'no-space' | 'busy'
export type UsbPlanResult = { ok: true; plan: UsbPlan } | { ok: false; reason: UsbFailure }
export type UsbStartResult = { ok: true } | { ok: false; reason: UsbFailure }
export interface UsbFolderPick { path: string; remembered: UsbRemembered | null }
export type UsbExportEvent =
  | { type: 'started'; tracks: UsbPlanTrack[]; targetName: string; startedAt: number }
  | { type: 'progress'; index: number; bytes: number }
  | { type: 'track'; index: number; state: 'done' | 'kept' }
  | { type: 'failed'; index: number; message: string }
  | { type: 'database' }
  | { type: 'finished'; outcome: 'done'; tracks: number; failed: number; ms: number }
  | { type: 'finished'; outcome: 'cancelled' }
  | { type: 'finished'; outcome: 'error'; reason: UsbFailure }
```

and on `window.api`: `usbVolumes()`, `onUsbVolumesChanged(cb)`, `usbPickFolder()`, `usbPlan(req)`, `usbExport(req)`, `usbCancel()`, `onUsbEvent(cb)`.

- [ ] **Step 1: Add the types**

Append to `src/shared/types.ts` (after Task 8's block) exactly the types listed above, each with a one-line WHY comment where it is not obvious (`UsbPlanTrack.onStick`: "baken's size check, what is left to copy"; `UsbPlan.trackCount`: "without separators, as the tree counts"; `UsbExportEvent` `progress`: "bytes of the track being copied, polled from the stick").

- [ ] **Step 2: Write the failing exporter tests**

`src/main/usbExport.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UsbExportEvent, UsbVolume } from '../shared/types'
import type { BakenEvent, BakenHandle } from './bakenRun'
import { createUsbExporter, type UsbExporterDeps } from './usbExport'
import { createUsbMemory, type UsbMemory } from './usbExportMemory'
import type { ExportSelection, ExportTrack } from './usbExportSource'
import type { Stage } from './usbExportStage'

const UUID = 'B10C96EF-51C2-344E-B78D-DAFC319D973E'

function track(id: string, over: Partial<ExportTrack> = {}): ExportTrack {
  return {
    id, path: `/m/${id}.wav`, title: `T${id}`, artist: 'A', album: '', genre: '', label: '', remixer: '',
    composer: '', mix: '', key: '', fileType: 11, lengthSec: 1, bpm: 120, bitRate: 0, sampleRate: 44100,
    bitDepth: 16, rating: 0, year: 0, trackNo: 0, discNo: 0, dateAdded: '', playCount: 0, comment: '',
    analysisPath: '', imagePath: '', separator: false, streaming: false, cues: [], ...over,
  }
}

const SEL: ExportSelection = {
  playlists: [{ id: '2000', name: 'Makina', folders: ['BASES'], trackIds: ['101', '109', '102', '103', '105'] }],
  tracks: [
    track('101'),
    track('109', { separator: true, title: '' }),
    track('102', { bitDepth: 32, title: 'No Fear' }),
    track('103', { title: 'Gone' }),
    track('105', { streaming: true }),
  ],
}

const volume = (over: Partial<UsbVolume> = {}): UsbVolume => ({
  uuid: UUID, name: 'Surco', mountPoint: '/Volumes/Surco', filesystem: 'exfat', partitionScheme: 'mbr',
  totalBytes: 32e9, freeBytes: 20e9, holder: { by: 'empty', at: null }, remembered: null, ...over,
})

const PLAN: BakenEvent = {
  event: 'plan',
  tracks: [
    { id: 101, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70, onStick: false },
    { id: 109, usbPath: '/Contents/U/B/_.mp3', size: 5, onStick: true },
    { id: 102, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30, onStick: true },
  ],
  spaceNeeded: 80, spaceAvailable: 1000, warnings: [], skipped: [], onelibraryFiles: [],
}
const REPORT: BakenEvent = {
  event: 'report', copied: 1, kept: 2, failures: [], cancelled: false, onelibraryWritten: true,
  onelibraryError: null, artwork: 3, pruned: 0, tracksInDatabase: 3,
}

type Script = (args: string[], emit: (e: BakenEvent) => void) => Promise<void>

let memory: UsbMemory
let sent: UsbExportEvent[]
let calls: string[][]
let killed: boolean

beforeEach(async () => {
  memory = createUsbMemory(join(await mkdtemp(join(tmpdir(), 'usb-exp-')), 'usb-exports.json'))
  sent = []
  calls = []
  killed = false
})

// No child process: the runner is replaced by a script that emits baken's events, and kill
// ends the run the way SIGTERM does (no report).
function deps(script: Script, over: Partial<UsbExporterDeps> = {}): UsbExporterDeps {
  return {
    collection: () => '/rb/master.db',
    readSelection: () => SEL,
    volumes: async () => [volume()],
    uuidAt: async () => UUID,
    isVolumeRoot: async () => true,
    baken: () => ({ file: 'baken', prefixArgs: [] }),
    stage: async (_sel, dir): Promise<Stage> => ({
      dir, xml: `${dir}/c.xml`, anlzDir: `${dir}/USBANLZ`, artworkDir: `${dir}/art`, settingsDir: null,
      included: ['101', '109', '102'], missing: ['103'], sizes: new Map([['101', 70], ['109', 5], ['102', 30]]),
      waves: new Map([['101', [0.5]]]), covers: new Map(),
    }),
    makeStageDir: async () => '/tmp/stage',
    removeDir: async () => {},
    memory,
    home: '/Users/dj',
    send: (e) => sent.push(e),
    now: () => 1000,
    fileSize: async () => 35,
    pdbFacts: async () => ({ size: 9, mtimeMs: 5 }),
    pollMs: 2,
    run: (_cmd, args, onEvent): BakenHandle => {
      calls.push(args)
      let stop: () => void = () => {}
      const stopped = new Promise<void>((r) => {
        stop = r
      })
      const done = Promise.race([
        script(args, onEvent).then(() => ({ code: 0, stderr: '' })),
        stopped.then(() => ({ code: null, stderr: '' })),
      ])
      return { done, kill: () => { killed = true; stop() } }
    },
    ...over,
  }
}

const REQ = { playlistIds: ['1000'], target: { kind: 'volume' as const, uuid: UUID }, prune: false }
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
const finished = async () => {
  for (let i = 0; i < 100 && !sent.some((e) => e.type === 'finished'); i++) await tick(5)
  return sent.find((e) => e.type === 'finished')
}

describe('plan', () => {
  it('asks baken for a dry run and summarises what it would copy', async () => {
    const ex = createUsbExporter(deps(async (_a, emit) => emit(PLAN)))
    const r = await ex.plan(REQ)
    expect(calls[0]).toContain('--dry-run')
    if (!r.ok) throw new Error(r.reason)
    // separators are tracks on the stick but not in the count, as in the tree
    expect(r.plan).toMatchObject({ trackCount: 2, newCount: 1, newBytes: 70, keptCount: 1 })
    expect(r.plan.tracks.map((t) => [t.id, t.onStick, t.wave])).toEqual([
      ['101', false, [0.5]], ['109', true, null], ['102', true, null],
    ])
  })

  it('warns about what the players or the selection will not take', async () => {
    const ex = createUsbExporter(deps(async (_a, emit) => emit(PLAN), {
      volumes: async () => [volume({ holder: { by: 'rekordbox', at: 1 }, partitionScheme: 'gpt' })],
    }))
    const r = await ex.plan(REQ)
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan.warnings).toEqual([
      { kind: 'rekordboxExport' },
      { kind: 'exfat' },
      { kind: 'gpt' },
      { kind: 'cdj2000', titles: ['No Fear'] },
      { kind: 'missing', titles: ['Gone'] },
      { kind: 'streaming', count: 1 },
    ])
  })

  // baken refuses the plan outright when it does not fit; the summary still has to say
  // what was asked for and by how much it does not fit.
  it('still summarises when the stick is too small', async () => {
    const ex = createUsbExporter(deps(async (_a, emit) =>
      emit({ event: 'error', kind: 'not-enough-space', message: 'no', needed: 10, available: 4 })))
    const r = await ex.plan(REQ)
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan.newCount).toBe(2)
    expect(r.plan.warnings).toContainEqual({ kind: 'noSpace', missingBytes: 6 })
  })

  it('counts what left the stick since Surco last wrote it', async () => {
    memory.remember(`volume:${UUID}`, { playlistIds: ['1000'], trackIds: ['101', '999'], at: 1, pdb: null, prune: false })
    const ex = createUsbExporter(deps(async (_a, emit) => emit(PLAN), {
      volumes: async () => [volume({ holder: { by: 'surco', at: 1 } })],
    }))
    const r = await ex.plan(REQ)
    expect(r.ok && r.plan.removedSinceLast).toBe(1)
  })

  it('answers why when it cannot summarise', async () => {
    const ok = async (_a: string[], emit: (e: BakenEvent) => void) => emit(PLAN)
    expect(await createUsbExporter(deps(ok)).plan({ ...REQ, playlistIds: [] })).toEqual({ ok: false, reason: 'nothing-selected' })
    expect(await createUsbExporter(deps(ok, { collection: () => '' })).plan(REQ)).toEqual({ ok: false, reason: 'no-collection' })
    expect(await createUsbExporter(deps(ok, { readSelection: () => 'unreadable' })).plan(REQ)).toEqual({ ok: false, reason: 'unreadable' })
    expect(await createUsbExporter(deps(ok, { volumes: async () => [] })).plan(REQ)).toEqual({ ok: false, reason: 'volume-gone' })
    expect(await createUsbExporter(deps(ok, { baken: () => null })).plan(REQ)).toEqual({ ok: false, reason: 'no-baken' })
  })
})

describe('start', () => {
  const happy: Script = async (_a, emit) => {
    emit(PLAN)
    emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
    await tick(20)
    emit({ event: 'written', index: 0, kept: false })
    emit({ event: 'start', index: 1, usbPath: '/Contents/U/B/_.mp3', size: 5 })
    emit({ event: 'written', index: 1, kept: true })
    emit({ event: 'start', index: 2, usbPath: '/Contents/A/UnknownAlbum/102.wav', size: 30 })
    emit({ event: 'written', index: 2, kept: true })
    emit({ event: 'database' })
    emit(REPORT)
  }

  // The mount point names whatever is mounted there now; a different stick there must get
  // nothing written, not even a started baken.
  it('writes nothing when another stick sits at the mount point', async () => {
    const ex = createUsbExporter(deps(happy, { uuidAt: async () => 'OTHER' }))
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'volume-changed' })
    expect(calls).toEqual([])
  })

  it('tells the renderer each track as it lands, then done, and remembers the stick', async () => {
    const ex = createUsbExporter(deps(happy))
    expect(await ex.start(REQ)).toEqual({ ok: true })
    expect(await finished()).toEqual({ type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 0 })
    const types = sent.filter((e) => e.type !== 'progress').map((e) => (e.type === 'track' ? `${e.index} ${e.state}` : e.type))
    expect(types).toEqual(['started', '0 done', '1 kept', '2 kept', 'database', 'finished'])
    expect(calls[0]).not.toContain('--dry-run')
    expect(memory.get(`volume:${UUID}`)).toMatchObject({ playlistIds: ['1000'], trackIds: ['101', '109', '102'], pdb: { size: 9, mtimeMs: 5 } })
    expect(memory.last()).toBe(`volume:${UUID}`)
  })

  // The row of the track being copied fills as its bytes land; tracks already on the stick
  // are not polled, and nothing about a track arrives after it is done.
  it('polls the bytes of the track being copied, and only that one', async () => {
    const ex = createUsbExporter(deps(happy))
    await ex.start(REQ)
    await finished()
    const progress = sent.filter((e) => e.type === 'progress')
    expect(progress.some((e) => e.type === 'progress' && e.index === 0 && e.bytes === 35)).toBe(true)
    expect(progress.some((e) => e.type === 'progress' && e.index > 0 && e.bytes > 0)).toBe(false)
    const doneAt = sent.findIndex((e) => e.type === 'track' && e.index === 0)
    expect(sent.slice(doneAt).some((e) => e.type === 'progress' && e.index === 0)).toBe(false)
  })

  it('runs one export at a time', async () => {
    const ex = createUsbExporter(deps(async (_a, emit) => { emit(PLAN); await tick(50); emit(REPORT) }))
    await ex.start(REQ)
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'busy' })
    await finished()
  })

  it('cancels while copying, and leaves the stick to its old library', async () => {
    const ex = createUsbExporter(deps(async (_a, emit) => { emit(PLAN); await tick(200); emit(REPORT) }))
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(true)
    expect(killed).toBe(true)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'cancelled' })
    expect(memory.get(`volume:${UUID}`)).toBeNull()
  })

  // Between export.pdb and exportLibrary.db a kill would leave two different libraries.
  it('does not cancel once the database is being written', async () => {
    const ex = createUsbExporter(deps(async (_a, emit) => { emit(PLAN); emit({ event: 'database' }); await tick(30); emit(REPORT) }))
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(false)
    expect(killed).toBe(false)
    expect((await finished())?.type).toBe('finished')
  })

  it('says the stick went away when it was unplugged mid-export', async () => {
    let mounted = true
    const ex = createUsbExporter(deps(async (_a, emit) => {
      emit(PLAN)
      mounted = false
      emit({ event: 'error', kind: 'device-write', message: 'gone' })
    }, { volumes: async () => (mounted ? [volume()] : []) }))
    await ex.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
  })

  it('maps a full stick and an unknown failure', async () => {
    const full = createUsbExporter(deps(async (_a, emit) => { emit(PLAN); emit({ event: 'error', kind: 'not-enough-space', message: '' }) }))
    await full.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'no-space' })
    sent = []
    const silent = createUsbExporter(deps(async () => {}))
    await silent.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'baken-failed' })
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExport.test.ts`
Expected: FAIL, `Cannot find module './usbExport'`.

- [ ] **Step 4: Implement the exporter**

`src/main/usbExport.ts`:

```ts
import { basename, join } from 'node:path'
import type {
  UsbExportEvent,
  UsbExportRequest,
  UsbFailure,
  UsbPlan,
  UsbPlanResult,
  UsbPlanTrack,
  UsbStartResult,
  UsbTarget,
  UsbVolume,
  UsbWarning,
} from '../shared/types'
import {
  type BakenError,
  type BakenEvent,
  type BakenPlan,
  type BakenReport,
  bakenArgs,
  runBaken,
} from './bakenRun'
import { type UsbMemory, targetKey } from './usbExportMemory'
import type { ExportSelection } from './usbExportSource'
import type { Stage } from './usbExportStage'

// One USB export at a time: a dry run of baken for the summary, then the real run, with the
// stick's UUID checked again right before it. Everything that touches the disk, the
// collection or a process comes in through deps, so the rules here are tested without any.

export interface UsbExporterDeps {
  collection: () => string
  readSelection: (dbPath: string, ids: string[]) => ExportSelection | 'unreadable'
  volumes: () => Promise<UsbVolume[]>
  uuidAt: (mountPoint: string) => Promise<string | null>
  isVolumeRoot: (path: string) => Promise<boolean>
  baken: () => { file: string; prefixArgs: string[] } | null
  stage: (sel: ExportSelection, dir: string) => Promise<Stage>
  makeStageDir: () => Promise<string>
  removeDir: (dir: string) => Promise<void>
  memory: UsbMemory
  home: string
  send: (e: UsbExportEvent) => void
  now: () => number
  fileSize: (path: string) => Promise<number | null>
  pdbFacts: (root: string) => Promise<{ size: number; mtimeMs: number } | null>
  pollMs?: number
  run?: typeof runBaken
}

interface Target {
  root: string
  name: string
  volume: UsbVolume | null
}

interface Prepared {
  target: Target
  sel: ExportSelection
  stage: Stage
}

const CDJ2000_FLAC = 5

async function resolveTarget(deps: UsbExporterDeps, t: UsbTarget): Promise<Target | null> {
  if (t.kind === 'folder') return { root: t.path, name: basename(t.path), volume: null }
  const v = (await deps.volumes()).find((x) => x.uuid === t.uuid)
  return v ? { root: v.mountPoint, name: v.name, volume: v } : null
}

async function prepare(deps: UsbExporterDeps, req: UsbExportRequest): Promise<Prepared | UsbFailure> {
  if (req.playlistIds.length === 0) return 'nothing-selected'
  const db = deps.collection()
  if (!db) return 'no-collection'
  if (!deps.baken()) return 'no-baken'
  const target = await resolveTarget(deps, req.target)
  if (!target) return 'volume-gone'
  const sel = deps.readSelection(db, req.playlistIds)
  if (sel === 'unreadable') return 'unreadable'
  if (sel.tracks.length === 0) return 'nothing-selected'
  return { target, sel, stage: await deps.stage(sel, await deps.makeStageDir()) }
}

function planTracks(p: Prepared, plan: BakenPlan | null): UsbPlanTrack[] {
  const byId = new Map(p.sel.tracks.map((t) => [t.id, t]))
  const rows = plan
    ? plan.tracks.map((b) => ({ id: String(b.id), size: b.size, onStick: b.onStick }))
    : p.stage.included.map((id) => ({ id, size: p.stage.sizes.get(id) ?? 0, onStick: false }))
  return rows.flatMap((r) => {
    const t = byId.get(r.id)
    if (!t) return []
    return [{
      id: r.id,
      title: t.title,
      artist: t.artist,
      size: r.size,
      onStick: r.onStick,
      separator: t.separator,
      cover: p.stage.covers.get(r.id) ?? null,
      wave: p.stage.waves.get(r.id) ?? null,
    }]
  })
}

async function warningsOf(deps: UsbExporterDeps, p: Prepared, req: UsbExportRequest, noSpace: number | null): Promise<UsbWarning[]> {
  const out: UsbWarning[] = []
  const v = p.target.volume
  if (v?.holder.by === 'rekordbox') out.push({ kind: 'rekordboxExport' })
  if (v?.filesystem === 'exfat') out.push({ kind: 'exfat' })
  if (v?.partitionScheme === 'gpt') out.push({ kind: 'gpt' })
  if (req.target.kind === 'folder' && !(await deps.isVolumeRoot(req.target.path))) out.push({ kind: 'notVolumeRoot' })
  const included = new Set(p.stage.included)
  const old = p.sel.tracks.filter(
    (t) => included.has(t.id) && (t.fileType === CDJ2000_FLAC || t.bitDepth > 24 || t.sampleRate > 48000),
  )
  if (old.length) out.push({ kind: 'cdj2000', titles: old.map((t) => t.title) })
  const missing = new Set(p.stage.missing)
  if (missing.size) out.push({ kind: 'missing', titles: p.sel.tracks.filter((t) => missing.has(t.id)).map((t) => t.title) })
  const streaming = p.sel.tracks.filter((t) => t.streaming).length
  if (streaming) out.push({ kind: 'streaming', count: streaming })
  if (noSpace !== null && noSpace > 0) out.push({ kind: 'noSpace', missingBytes: noSpace })
  return out
}

function summary(deps: UsbExporterDeps, p: Prepared, req: UsbExportRequest, tracks: UsbPlanTrack[], warnings: UsbWarning[]): UsbPlan {
  const real = tracks.filter((t) => !t.separator)
  const entry = deps.memory.get(targetKey(req.target))
  const ours = req.target.kind === 'folder' || p.target.volume?.holder.by === 'surco'
  const ids = new Set(tracks.map((t) => t.id))
  return {
    tracks,
    trackCount: real.length,
    newCount: real.filter((t) => !t.onStick).length,
    newBytes: tracks.filter((t) => !t.onStick).reduce((sum, t) => sum + t.size, 0),
    keptCount: real.filter((t) => t.onStick).length,
    removedSinceLast: entry && ours ? entry.trackIds.filter((id) => !ids.has(id)).length : null,
    warnings,
  }
}

export function createUsbExporter(deps: UsbExporterDeps) {
  const run = deps.run ?? runBaken
  let running: { phase: 'tracks' | 'database'; cancelled: boolean; kill: () => void } | null = null

  const args = (p: Prepared, req: UsbExportRequest, dryRun: boolean): string[] | null => {
    try {
      return bakenArgs({ stage: p.stage, device: p.target.root, prune: req.prune, dryRun, home: deps.home })
    } catch {
      return null
    }
  }

  async function plan(req: UsbExportRequest): Promise<UsbPlanResult> {
    const p = await prepare(deps, req)
    if (typeof p === 'string') return { ok: false, reason: p }
    try {
      const a = args(p, req, true)
      if (!a) return { ok: false, reason: 'refused' }
      let planned: BakenPlan | null = null
      let error: BakenError | null = null
      await run(deps.baken() as { file: string; prefixArgs: string[] }, a, (e) => {
        if (e.event === 'plan') planned = e
        if (e.event === 'error') error = e
      }).done
      const err = error as BakenError | null
      const fits = err?.kind === 'not-enough-space'
      if (!planned && !fits) return { ok: false, reason: err?.kind === 'device-write' ? 'device-write' : 'baken-failed' }
      const p2 = planned as BakenPlan | null
      const short = fits
        ? (err?.needed ?? 0) - (err?.available ?? 0)
        : p2 && p2.spaceAvailable !== null ? p2.spaceNeeded - p2.spaceAvailable : null
      const tracks = planTracks(p, p2)
      return { ok: true, plan: summary(deps, p, req, tracks, await warningsOf(deps, p, req, short)) }
    } finally {
      await deps.removeDir(p.stage.dir)
    }
  }

  async function failureAfter(error: BakenError | null, req: UsbExportRequest): Promise<UsbFailure> {
    if (error?.kind === 'not-enough-space') return 'no-space'
    if (error?.kind === 'device-write' || error?.kind === 'device-not-found') {
      // A stick pulled out mid-copy reads as a write error; say what really happened.
      if (req.target.kind === 'volume' && !(await deps.volumes()).some((v) => v.uuid === (req.target as { uuid: string }).uuid))
        return 'volume-gone'
      return 'device-write'
    }
    return 'baken-failed'
  }

  async function start(req: UsbExportRequest): Promise<UsbStartResult> {
    if (running) return { ok: false, reason: 'busy' }
    const p = await prepare(deps, req)
    if (typeof p === 'string') return { ok: false, reason: p }
    if (req.target.kind === 'volume' && (await deps.uuidAt(p.target.root)) !== req.target.uuid) {
      await deps.removeDir(p.stage.dir)
      return { ok: false, reason: 'volume-changed' }
    }
    const a = args(p, req, false)
    if (!a) {
      await deps.removeDir(p.stage.dir)
      return { ok: false, reason: 'refused' }
    }
    const startedAt = deps.now()
    let tracks: UsbPlanTrack[] = []
    let current = -1
    let poll: NodeJS.Timeout | null = null
    let report: BakenReport | null = null
    let error: BakenError | null = null
    const stopPoll = (): void => {
      if (poll) clearInterval(poll)
      poll = null
      current = -1
    }
    // Set before baken starts: its first events may arrive before run() returns.
    const state = { phase: 'tracks' as 'tracks' | 'database', cancelled: false, kill: () => {} }
    running = state
    const onEvent = (e: BakenEvent): void => {
      switch (e.event) {
        case 'plan':
          tracks = planTracks(p, e)
          deps.send({ type: 'started', tracks, targetName: p.target.name, startedAt })
          break
        case 'start': {
          stopPoll()
          current = e.index
          deps.send({ type: 'progress', index: e.index, bytes: 0 })
          if (tracks[e.index]?.onStick) break
          const file = join(p.target.root, e.usbPath)
          const index = e.index
          poll = setInterval(() => {
            void deps.fileSize(file).then((bytes) => {
              if (bytes !== null && current === index) deps.send({ type: 'progress', index, bytes })
            })
          }, deps.pollMs ?? 250)
          break
        }
        case 'written':
          stopPoll()
          deps.send({ type: 'track', index: e.index, state: e.kept ? 'kept' : 'done' })
          break
        case 'failed':
          stopPoll()
          deps.send({ type: 'failed', index: e.index, message: e.message })
          break
        case 'database':
          stopPoll()
          state.phase = 'database'
          deps.send({ type: 'database' })
          break
        case 'report':
          report = e
          break
        case 'error':
          error = e
          break
      }
    }
    const handle = run(deps.baken() as { file: string; prefixArgs: string[] }, a, onEvent)
    state.kill = handle.kill
    void handle.done.then(async () => {
      stopPoll()
      running = null
      try {
        const r = report as BakenReport | null
        if (state.cancelled && !r) deps.send({ type: 'finished', outcome: 'cancelled' })
        else if (r && !r.cancelled) {
          deps.memory.remember(targetKey(req.target), {
            playlistIds: req.playlistIds,
            trackIds: tracks.map((t) => t.id),
            at: deps.now(),
            pdb: await deps.pdbFacts(p.target.root),
            prune: req.prune,
          })
          deps.send({ type: 'finished', outcome: 'done', tracks: r.tracksInDatabase, failed: r.failures.length, ms: deps.now() - startedAt })
        } else deps.send({ type: 'finished', outcome: 'error', reason: await failureAfter(error, req) })
      } finally {
        await deps.removeDir(p.stage.dir)
      }
    })
    return { ok: true }
  }

  // Only while tracks are copying. Once baken writes the databases, stopping it could leave
  // export.pdb new and exportLibrary.db old: two libraries on one stick.
  function cancel(): boolean {
    if (!running || running.phase !== 'tracks') return false
    running.cancelled = true
    running.kill()
    return true
  }

  return { plan, start, cancel, busy: () => running !== null }
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExport.test.ts`
Expected: PASS (12). Then mutate on purpose (Review Focus 1 and 3): delete the `uuidAt` comparison and the `phase !== 'tracks'` guard one at a time and see `writes nothing when another stick sits at the mount point` and `does not cancel once the database is being written` go red; restore.

- [ ] **Step 6: IPC**

`src/main/usbExportIpc.ts`:

```ts
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { UsbExportRequest, UsbFolderPick, UsbVolumeList } from '../shared/types'
import { openRekordboxDb } from './rekordboxDb'
import { createUsbExporter } from './usbExport'
import { createUsbMemory, targetKey } from './usbExportMemory'
import { readExportSelection } from './usbExportSource'
import { stageExport } from './usbExportStage'
import { DARWIN_VOLUMES, readVolumes, uuidAt, watchVolumes } from './usbVolumes'

// The USB export's IPC. macOS only: elsewhere every call answers "unsupported" and nothing
// is watched, and the renderer does not offer the feature at all.
export function registerUsbExportIpc(opts: {
  collection: () => string
  userData: string
  home: string
  baken: () => { file: string; prefixArgs: string[] } | null
}): void {
  if (process.platform !== 'darwin') {
    ipcMain.handle('usb:volumes', (): UsbVolumeList => ({ volumes: [], lastKey: null }))
    ipcMain.handle('usb:pickFolder', () => null)
    ipcMain.handle('usb:plan', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:export', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:cancel', () => false)
    return
  }
  const memory = createUsbMemory(join(opts.userData, 'usb-exports.json'))
  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  const list = async (): Promise<UsbVolumeList> => ({
    volumes: await readVolumes(DARWIN_VOLUMES, memory),
    lastKey: memory.last(),
  })
  const exporter = createUsbExporter({
    collection: opts.collection,
    readSelection: (path, ids) => {
      const db = openRekordboxDb(path, { readonly: true })
      if (!db) return 'unreadable'
      try {
        return readExportSelection(db, ids)
      } catch {
        return 'unreadable'
      } finally {
        db.close()
      }
    },
    volumes: () => readVolumes(DARWIN_VOLUMES, memory),
    uuidAt: (mountPoint) => uuidAt(DARWIN_VOLUMES, mountPoint),
    isVolumeRoot: async (path) => {
      const [here, parent] = await Promise.all([stat(path), stat(dirname(path))])
      return here.dev !== parent.dev
    },
    baken: opts.baken,
    // rekordbox keeps the analysis and artwork beside master.db, in share/.
    stage: (sel, dir) =>
      stageExport({
        sel,
        shareDir: join(dirname(opts.collection()), 'share'),
        settingsSource: join(opts.home, 'Library', 'Application Support', 'Pioneer', 'rekordbox6'),
        dir,
      }),
    makeStageDir: () => mkdtemp(join(tmpdir(), 'surco-usb-')),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),
    memory,
    home: opts.home,
    send: (e) => broadcast('usb:event', e),
    now: () => Date.now(),
    fileSize: (path) => stat(path).then((s) => s.size).catch(() => null),
    pdbFacts: (root) =>
      stat(join(root, 'PIONEER', 'rekordbox', 'export.pdb'))
        .then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }))
        .catch(() => null),
  })
  watchVolumes(() => void list().then((l) => broadcast('usb:volumesChanged', l)))
  ipcMain.handle('usb:volumes', list)
  ipcMain.handle('usb:pickFolder', async (e): Promise<UsbFolderPick | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (canceled || !filePaths[0]) return null
    const entry = memory.get(targetKey({ kind: 'folder', path: filePaths[0] }))
    return {
      path: filePaths[0],
      remembered: entry ? { playlistIds: entry.playlistIds, prune: entry.prune, at: entry.at } : null,
    }
  })
  ipcMain.handle('usb:plan', (_e, req: UsbExportRequest) => exporter.plan(req))
  ipcMain.handle('usb:export', (_e, req: UsbExportRequest) => exporter.start(req))
  ipcMain.handle('usb:cancel', () => exporter.cancel())
}
```

`src/main/index.ts`: import `registerUsbExportIpc` from `./usbExportIpc`, `bakenCommand` from `./bakenPath`, `existsSync` from `node:fs` (if not imported) and `homedir` from `node:os` (next to `tmpdir`); right after the `registerRekordboxPlaylistsIpc(...)` call:

```ts
  registerUsbExportIpc({
    collection: () => findRekordboxCollection({ configured: getSettings().rekordboxDbPath }),
    userData: app.getPath('userData'),
    home: homedir(),
    baken: () =>
      bakenCommand({
        platform: process.platform,
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        exists: existsSync,
      }),
  })
```

- [ ] **Step 7: Preload and stubs**

`src/preload/api.ts`, in `Api` near the rekordbox calls:

```ts
  // The USB export (macOS). Volumes come by UUID; the event feeds the progress list and
  // the toolbar pill, also with the modal closed.
  usbVolumes: () => Promise<UsbVolumeList>
  onUsbVolumesChanged: (cb: (list: UsbVolumeList) => void) => () => void
  usbPickFolder: () => Promise<UsbFolderPick | null>
  usbPlan: (req: UsbExportRequest) => Promise<UsbPlanResult>
  usbExport: (req: UsbExportRequest) => Promise<UsbStartResult>
  usbCancel: () => Promise<boolean>
  onUsbEvent: (cb: (e: UsbExportEvent) => void) => () => void
```

(with the types added to its `import type` from `../shared/types`). `src/preload/index.ts`, in `api` after `rekordboxHasSeparator`:

```ts
  usbVolumes: (): Promise<UsbVolumeList> => ipcRenderer.invoke('usb:volumes'),
  onUsbVolumesChanged: (cb: (list: UsbVolumeList) => void) => {
    const listener = (_e: unknown, list: UsbVolumeList): void => cb(list)
    ipcRenderer.on('usb:volumesChanged', listener)
    return () => ipcRenderer.removeListener('usb:volumesChanged', listener)
  },
  usbPickFolder: (): Promise<UsbFolderPick | null> => ipcRenderer.invoke('usb:pickFolder'),
  usbPlan: (req: UsbExportRequest): Promise<UsbPlanResult> => ipcRenderer.invoke('usb:plan', req),
  usbExport: (req: UsbExportRequest): Promise<UsbStartResult> => ipcRenderer.invoke('usb:export', req),
  usbCancel: (): Promise<boolean> => ipcRenderer.invoke('usb:cancel'),
  onUsbEvent: (cb: (e: UsbExportEvent) => void) => {
    const listener = (_e: unknown, event: UsbExportEvent): void => cb(event)
    ipcRenderer.on('usb:event', listener)
    return () => ipcRenderer.removeListener('usb:event', listener)
  },
```

`src/renderer/src/test/api.ts`, in `stubApi` after `rekordboxHasSeparator`:

```ts
    usbVolumes: async () => ({ volumes: [], lastKey: null }),
    onUsbVolumesChanged: unsubscribe,
    usbPickFolder: async () => null,
    usbPlan: async () => ({ ok: false, reason: 'nothing-selected' }),
    usbExport: async () => ({ ok: false, reason: 'nothing-selected' }),
    usbCancel: async () => false,
    onUsbEvent: unsubscribe,
```

`src/scenarios/harness.tsx`, in `wired` after `editRekordboxPlaylist` (App subscribes to both events on mount):

```ts
    usbVolumes: async () => ({ volumes: [], lastKey: null }),
    onUsbVolumesChanged: () => () => {},
    onUsbEvent: () => () => {},
```

- [ ] **Step 8: Types, the whole main suite, lint, commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main && cd ../..
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/usbExport.ts apps/desktop/src/main/usbExport.test.ts apps/desktop/src/main/usbExportIpc.ts apps/desktop/src/main/index.ts apps/desktop/src/shared/types.ts apps/desktop/src/preload apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/scenarios/harness.tsx
git commit -m "Summarise and run the USB export with baken, checking the stick first"
```

Expected: tsc clean; `src/main` all PASS (none skipped).

---
### Task 10: The exporting face: the track list whose waveforms fill as bytes land

**Files:**
- Create: `src/renderer/src/lib/usbExport.ts`, `src/renderer/src/lib/usbExport.test.ts`
- Create: `src/renderer/src/components/TrackWave.tsx`, `src/renderer/src/components/ExportTrackRow.tsx`, `src/renderer/src/components/UsbExportProgress.tsx`, `src/renderer/src/components/UsbExportProgress.test.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json` (`usbExport.progress`, `usbExport.span`, `usbExport.fs`, `usbExport.errors`)

**Interfaces:**
- Consumes: `UsbExportEvent`, `UsbPlanTrack`, `UsbFailure`, `UsbFilesystem` (Task 9); `formatFileSize` (`lib/properties.ts`).
- Produces (Task 11):

```ts
// lib/usbExport.ts
export type RowState = 'queued' | 'copying' | 'done' | 'kept' | 'failed'
export interface ExportRow { track: UsbPlanTrack; state: RowState; bytes: number; message: string | null }
export interface UsbExportState {
  phase: 'idle' | 'copying' | 'database' | 'done' | 'cancelled' | 'error'
  rows: ExportRow[]; targetName: string; startedAt: number
  samples: { at: number; bytes: number }[]
  result: { tracks: number; failed: number; ms: number } | null
  reason: UsbFailure | null
}
export const IDLE_EXPORT: UsbExportState
export function usbExportReducer(s: UsbExportState, e: UsbExportEvent, now: number): UsbExportState
export function exportCounts(s: UsbExportState): { done: number; total: number }
export function bytesDone(s: UsbExportState): number
export function bytesToCopy(s: UsbExportState): number
export function speed(s: UsbExportState): number | null        // bytes per second
export function timeLeft(s: UsbExportState): number | null     // ms
export function formatSpan(ms: number, tr: (k: string, o?: Record<string, unknown>) => string): string
export function wavePath(bars: number[]): string
export const FLAT_WAVE: number[]
export function prefersReducedMotion(): boolean

// components
export function TrackWave(props: { bars: number[] | null; state: RowState; fraction: number }): JSX.Element
export const ExportTrackRow: React.MemoExoticComponent<(props: { row: ExportRow; index: number }) => JSX.Element>
export function UsbExportProgress(props: {
  state: UsbExportState
  footer: { name: string; freeBytes: number | null; filesystem: UsbFilesystem | null }
  onBackground: () => void; onCancel: () => void; onClose: () => void
}): JSX.Element
```

- [ ] **Step 1: Write the failing lib tests**

`src/renderer/src/lib/usbExport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { UsbPlanTrack } from '../../../shared/types'
import {
  bytesDone, bytesToCopy, exportCounts, formatSpan, IDLE_EXPORT, speed, timeLeft, usbExportReducer, wavePath,
} from './usbExport'

const t = (id: string, size: number, onStick = false): UsbPlanTrack => ({
  id, title: id, artist: 'A', size, onStick, separator: false, cover: null, wave: null,
})
const TRACKS = [t('a', 100), t('b', 50, true), t('c', 200)]

const run = (...steps: [Parameters<typeof usbExportReducer>[1], number][]) =>
  steps.reduce((s, [e, now]) => usbExportReducer(s, e, now), IDLE_EXPORT)

describe('usbExportReducer', () => {
  it('queues every track when the export starts', () => {
    const s = run([{ type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }, 0])
    expect(s.phase).toBe('copying')
    expect(s.rows.map((r) => r.state)).toEqual(['queued', 'queued', 'queued'])
  })

  it('follows a track from copying to done, and one already there to kept', () => {
    const s = run(
      [{ type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }, 0],
      [{ type: 'progress', index: 0, bytes: 40 }, 1000],
      [{ type: 'track', index: 0, state: 'done' }, 2000],
      [{ type: 'track', index: 1, state: 'kept' }, 2000],
      [{ type: 'progress', index: 2, bytes: 20 }, 3000],
    )
    expect(s.rows.map((r) => [r.state, r.bytes])).toEqual([['done', 100], ['kept', 0], ['copying', 20]])
    expect(exportCounts(s)).toEqual({ done: 2, total: 3 })
    // only what had to be copied counts: the kept track is not bytes the stick is waiting for
    expect(bytesToCopy(s)).toBe(300)
    expect(bytesDone(s)).toBe(120)
  })

  it('records a failed track with its reason and goes on', () => {
    const s = run(
      [{ type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }, 0],
      [{ type: 'failed', index: 1, message: 'NAS asleep' }, 10],
    )
    expect(s.rows[1]).toMatchObject({ state: 'failed', message: 'NAS asleep' })
    expect(s.phase).toBe('copying')
  })

  it('ends done, cancelled or with a reason', () => {
    const base: [Parameters<typeof usbExportReducer>[1], number] = [{ type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }, 0]
    expect(run(base, [{ type: 'database' }, 1]).phase).toBe('database')
    expect(run(base, [{ type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 64000 }, 1]).result).toEqual({ tracks: 3, failed: 0, ms: 64000 })
    expect(run(base, [{ type: 'finished', outcome: 'cancelled' }, 1]).phase).toBe('cancelled')
    expect(run(base, [{ type: 'finished', outcome: 'error', reason: 'volume-gone' }, 1]).reason).toBe('volume-gone')
  })
})

describe('speed and time left', () => {
  // Measured over the last few seconds, not since the start: the first tracks may have
  // been on the stick already, and the NAS warms up.
  it('measures the recent rate and what is left at that rate', () => {
    const s = run(
      [{ type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }, 0],
      [{ type: 'progress', index: 0, bytes: 50 }, 1000],
      [{ type: 'progress', index: 0, bytes: 100 }, 2000],
    )
    expect(speed(s)).toBe(50)
    expect(timeLeft(s)).toBe(4000)
  })

  it('knows nothing before two samples', () => {
    const s = run([{ type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }, 0])
    expect(speed(s)).toBeNull()
    expect(timeLeft(s)).toBeNull()
  })
})

describe('formatSpan', () => {
  const tr = (k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o)}`
  it('says minutes and seconds, or seconds alone', () => {
    expect(formatSpan(64000, tr)).toBe('usbExport.span.minSec:{"min":1,"sec":4}')
    expect(formatSpan(9400, tr)).toBe('usbExport.span.sec:{"sec":9}')
  })
})

describe('wavePath', () => {
  it('draws one bar per value, mirrored around the middle', () => {
    const d = wavePath([0, 1])
    expect(d.match(/M/g)).toHaveLength(2)
    // two bars split the 100-wide box: the second starts at 50, full height from the top
    expect(d).toContain('M50 0h35v16')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/usbExport.test.ts`
Expected: FAIL, `Cannot find module './usbExport'`.

- [ ] **Step 3: Implement the lib**

`src/renderer/src/lib/usbExport.ts`:

```ts
import type { UsbExportEvent, UsbFailure, UsbPlanTrack } from '../../../shared/types'

// The running USB export as the renderer sees it, folded from the main process's events.
// Lives in App (useUsbExport) so closing the modal never loses it.

export type RowState = 'queued' | 'copying' | 'done' | 'kept' | 'failed'

export interface ExportRow {
  track: UsbPlanTrack
  state: RowState
  bytes: number
  message: string | null
}

export interface UsbExportState {
  phase: 'idle' | 'copying' | 'database' | 'done' | 'cancelled' | 'error'
  rows: ExportRow[]
  targetName: string
  startedAt: number
  samples: { at: number; bytes: number }[]
  result: { tracks: number; failed: number; ms: number } | null
  reason: UsbFailure | null
}

export const IDLE_EXPORT: UsbExportState = {
  phase: 'idle',
  rows: [],
  targetName: '',
  startedAt: 0,
  samples: [],
  result: null,
  reason: null,
}

const SPEED_WINDOW_MS = 5000

export function bytesDone(s: UsbExportState): number {
  return s.rows.reduce((sum, r) => sum + (r.state === 'done' ? r.track.size : r.state === 'copying' ? r.bytes : 0), 0)
}

export function bytesToCopy(s: UsbExportState): number {
  return s.rows.reduce((sum, r) => sum + (r.track.onStick ? 0 : r.track.size), 0)
}

const withRow = (s: UsbExportState, index: number, row: Partial<ExportRow>): ExportRow[] =>
  s.rows.map((r, i) => (i === index ? { ...r, ...row } : r))

function sampled(s: UsbExportState, now: number): UsbExportState {
  const samples = [...s.samples, { at: now, bytes: bytesDone(s) }].filter((x) => now - x.at <= SPEED_WINDOW_MS)
  return { ...s, samples }
}

export function usbExportReducer(s: UsbExportState, e: UsbExportEvent, now: number): UsbExportState {
  switch (e.type) {
    case 'started':
      return {
        ...IDLE_EXPORT,
        phase: 'copying',
        rows: e.tracks.map((track) => ({ track, state: 'queued', bytes: 0, message: null })),
        targetName: e.targetName,
        startedAt: e.startedAt,
        samples: [{ at: now, bytes: 0 }],
      }
    case 'progress':
      return sampled({ ...s, rows: withRow(s, e.index, { state: 'copying', bytes: e.bytes }) }, now)
    case 'track':
      return sampled({ ...s, rows: withRow(s, e.index, { state: e.state, bytes: e.state === 'done' ? s.rows[e.index]?.track.size ?? 0 : 0 }) }, now)
    case 'failed':
      return { ...s, rows: withRow(s, e.index, { state: 'failed', bytes: 0, message: e.message }) }
    case 'database':
      return { ...s, phase: 'database' }
    case 'finished':
      if (e.outcome === 'done') return { ...s, phase: 'done', result: { tracks: e.tracks, failed: e.failed, ms: e.ms } }
      if (e.outcome === 'cancelled') return { ...s, phase: 'cancelled' }
      return { ...s, phase: 'error', reason: e.reason }
  }
}

export function exportCounts(s: UsbExportState): { done: number; total: number } {
  return {
    done: s.rows.filter((r) => r.state === 'done' || r.state === 'kept' || r.state === 'failed').length,
    total: s.rows.length,
  }
}

export function speed(s: UsbExportState): number | null {
  if (s.samples.length < 2) return null
  const first = s.samples[0]
  const last = s.samples[s.samples.length - 1]
  const ms = last.at - first.at
  return ms > 0 ? ((last.bytes - first.bytes) * 1000) / ms : null
}

export function timeLeft(s: UsbExportState): number | null {
  const rate = speed(s)
  if (!rate || rate <= 0) return null
  return Math.round(((bytesToCopy(s) - bytesDone(s)) / rate) * 1000)
}

export function formatSpan(ms: number, tr: (k: string, o?: Record<string, unknown>) => string): string {
  const total = Math.round(ms / 1000)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return min > 0 ? tr('usbExport.span.minSec', { min, sec }) : tr('usbExport.span.sec', { sec })
}

// One thin bar per value in a 100 × 16 box, mirrored around the middle like rekordbox's
// preview, never thinner than half a unit so silence still draws a line.
export function wavePath(bars: number[]): string {
  const w = 100 / bars.length
  return bars
    .map((v, i) => {
      const h = Math.max(0.5, v * 16)
      const y = (16 - h) / 2
      return `M${+(i * w).toFixed(2)} ${+y.toFixed(2)}h${+(w * 0.7).toFixed(2)}v${+h.toFixed(2)}h-${+(w * 0.7).toFixed(2)}Z`
    })
    .join('')
}

// A track rekordbox never analysed has no preview: a flat bar stands in for it.
export const FLAT_WAVE: number[] = Array.from({ length: 100 }, () => 0.12)

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
```

Run the lib tests. Expected: PASS.

- [ ] **Step 4: Write the failing component tests**

`src/renderer/src/components/UsbExportProgress.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UsbExportEvent, UsbPlanTrack } from '../../../shared/types'
import i18n from '../i18n'
import { IDLE_EXPORT, usbExportReducer } from '../lib/usbExport'
import { TrackWave } from './TrackWave'
import { UsbExportProgress } from './UsbExportProgress'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

const t = (id: string, size: number, onStick = false): UsbPlanTrack => ({
  id, title: `Title ${id}`, artist: 'K-Style', size, onStick, separator: false, cover: null, wave: [0.2, 0.9, 0.4],
})
const state = (...events: UsbExportEvent[]) =>
  events.reduce((s, e, i) => usbExportReducer(s, e, i * 1000), IDLE_EXPORT)
const STARTED: UsbExportEvent = { type: 'started', tracks: [t('a', 70e6), t('b', 30e6, true), t('c', 50e6)], targetName: 'Surco', startedAt: 0 }

function show(events: UsbExportEvent[]) {
  const handlers = { onBackground: vi.fn(), onCancel: vi.fn(), onClose: vi.fn() }
  render(<UsbExportProgress state={state(...events)} footer={{ name: 'Surco', freeBytes: 21.4e9, filesystem: 'exfat' }} {...handlers} />)
  return handlers
}

describe('UsbExportProgress', () => {
  it('lists every track with its state', () => {
    show([STARTED, { type: 'progress', index: 0, bytes: 35e6 }, { type: 'track', index: 1, state: 'kept' }])
    expect(screen.getByTestId('export-row-0')).toHaveAttribute('data-state', 'copying')
    expect(screen.getByTestId('export-row-1')).toHaveTextContent('ya estaba')
    expect(screen.getByTestId('export-row-2')).toHaveTextContent('en cola')
    expect(screen.getByTestId('usb-counter')).toHaveTextContent('1 / 3')
  })

  it('shows the size once a copied track is done', () => {
    show([STARTED, { type: 'track', index: 0, state: 'done' }])
    expect(screen.getByTestId('export-row-0')).toHaveTextContent('66,8 MB')
  })

  it('names the stick, its free space and filesystem in the footer', () => {
    show([STARTED])
    expect(screen.getByTestId('usb-footer')).toHaveTextContent('Surco')
    expect(screen.getByTestId('usb-footer')).toHaveTextContent('exFAT')
  })

  // Closing never stops the export; the button says it goes on.
  it('keeps going in the background', () => {
    const h = show([STARTED])
    fireEvent.click(screen.getByTestId('usb-background'))
    expect(h.onBackground).toHaveBeenCalled()
  })

  it('offers cancel while copying, and not while writing the database', () => {
    const h = show([STARTED])
    fireEvent.click(screen.getByTestId('usb-cancel'))
    expect(h.onCancel).toHaveBeenCalled()
    cleanup()
    show([STARTED, { type: 'database' }])
    expect(screen.queryByTestId('usb-cancel')).toBeNull()
    expect(screen.getByTestId('usb-finishing')).toBeInTheDocument()
  })

  it('says it is done and the stick can be ejected', () => {
    show([STARTED, { type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 64000 }])
    expect(screen.getByTestId('usb-done')).toHaveTextContent('Listo · 3 pistas en 1 min 4 s. Ya puedes expulsar el USB.')
  })

  it('says why it stopped', () => {
    show([STARTED, { type: 'finished', outcome: 'error', reason: 'volume-gone' }])
    expect(screen.getByTestId('usb-error')).toHaveTextContent('El USB se desconectó')
  })
})

describe('TrackWave', () => {
  const fill = () => screen.getByTestId('track-wave-fill')

  it('draws a faint dashed line for a queued track', () => {
    render(<TrackWave bars={[0.5]} state="queued" fraction={0} />)
    expect(screen.getByTestId('track-wave-queued')).toBeInTheDocument()
  })

  // The copying track reveals its waveform left to right as its bytes land.
  it('reveals the copied part of the waveform', () => {
    render(<TrackWave bars={[0.5]} state="copying" fraction={0.4} />)
    expect(fill().style.clipPath).toBe('inset(0 60% 0 0)')
    expect(fill().style.transition).toContain('clip-path')
  })

  it('is whole once done', () => {
    render(<TrackWave bars={[0.5]} state="done" fraction={0} />)
    expect(fill().style.clipPath).toBe('inset(0 0% 0 0)')
  })

  it('jumps to the percentage without animating under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    render(<TrackWave bars={[0.5]} state="copying" fraction={0.4} />)
    expect(fill().style.transition).toBe('none')
  })

  it('draws a flat bar for a track without analysis', () => {
    render(<TrackWave bars={null} state="done" fraction={1} />)
    expect(screen.getByTestId('track-wave')).toHaveAttribute('data-flat', 'true')
  })
})
```

(`66,8 MB` is `formatFileSize(70e6, 'es')`: 70 000 000 / 1024² = 66.76.)

- [ ] **Step 5: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/UsbExportProgress.test.tsx`
Expected: FAIL, `Cannot find module './TrackWave'`.

- [ ] **Step 6: Implement the components**

`src/renderer/src/components/TrackWave.tsx`:

```tsx
import type React from 'react'
import { FLAT_WAVE, prefersReducedMotion, type RowState, wavePath } from '../lib/usbExport'

// One track's small waveform in the export list (rekordbox's own preview). The motion of
// the whole export lives here: the row being copied reveals its waveform left to right as
// the bytes land, a clip-path transition and nothing else, so a tick re-renders one row.
export function TrackWave({
  bars,
  state,
  fraction,
}: {
  bars: number[] | null
  state: RowState
  fraction: number
}): React.JSX.Element {
  if (state === 'queued')
    return (
      <svg data-testid="track-wave-queued" viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true" className="h-4 w-full">
        <line x1="0" y1="8" x2="100" y2="8" stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  const d = wavePath(bars ?? FLAT_WAVE)
  const shown = state === 'copying' ? Math.min(Math.max(fraction, 0), 1) : state === 'failed' ? 0 : 1
  return (
    <svg data-testid="track-wave" data-flat={bars ? undefined : 'true'} viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true" className="h-4 w-full">
      <path d={d} fill="var(--color-line-strong)" />
      <path
        data-testid="track-wave-fill"
        d={d}
        fill={state === 'failed' ? 'var(--color-danger)' : 'var(--color-accent)'}
        opacity={state === 'kept' ? 0.55 : 1}
        style={{
          clipPath: `inset(0 ${Math.round((1 - shown) * 100)}% 0 0)`,
          transition: prefersReducedMotion() ? 'none' : 'clip-path 250ms linear',
        }}
      />
    </svg>
  )
}
```

If `--color-danger` is not a token in this theme, use the one `text-danger` maps to (grep `--color-danger` in `src/renderer/src/*.css`).

`src/renderer/src/components/ExportTrackRow.tsx`:

```tsx
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '../lib/properties'
import type { ExportRow } from '../lib/usbExport'
import { TrackWave } from './TrackWave'

// A row of the export list. Memoised: a progress tick changes one row's object only, so
// only that row renders again.
export const ExportTrackRow = memo(function ExportTrackRow({
  row,
  index,
}: {
  row: ExportRow
  index: number
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const { track, state } = row
  const label =
    state === 'queued'
      ? tr('usbExport.progress.queued')
      : state === 'copying'
        ? tr('usbExport.progress.copying')
        : state === 'kept'
          ? tr('usbExport.progress.kept')
          : state === 'failed'
            ? (row.message ?? '')
            : formatFileSize(track.size, i18n.language)
  return (
    <li
      data-testid={`export-row-${index}`}
      data-state={state}
      className="grid grid-cols-[32px_minmax(0,1fr)_minmax(80px,30%)_auto] items-center gap-3 px-4 py-1.5"
    >
      {track.cover ? (
        <img src={track.cover} alt="" className="size-8 rounded object-cover" />
      ) : (
        <div aria-hidden="true" className="size-8 rounded bg-[var(--color-hover)]" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm">{track.title}</p>
        <p className="truncate text-xs text-fg-faint">{track.artist}</p>
      </div>
      <TrackWave bars={track.wave} state={state} fraction={track.size > 0 ? row.bytes / track.size : 0} />
      <span className={`w-24 truncate text-right text-xs tabular-nums ${state === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
        {label}
      </span>
    </li>
  )
})
```

`src/renderer/src/components/UsbExportProgress.tsx`:

```tsx
import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsbFilesystem } from '../../../shared/types'
import { formatFileSize } from '../lib/properties'
import { bytesDone, bytesToCopy, exportCounts, formatSpan, speed, timeLeft, type UsbExportState } from '../lib/usbExport'
import { ExportTrackRow } from './ExportTrackRow'

// The modal while exporting and when done: one column, the export's tracks in order, a thin
// overall line with the count, speed and time left on top, the stick in the footer.
export function UsbExportProgress({
  state,
  footer,
  onBackground,
  onCancel,
  onClose,
}: {
  state: UsbExportState
  footer: { name: string; freeBytes: number | null; filesystem: UsbFilesystem | null }
  onBackground: () => void
  onCancel: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const counts = exportCounts(state)
  const toCopy = bytesToCopy(state)
  const fraction = toCopy > 0 ? bytesDone(state) / toCopy : counts.total > 0 ? counts.done / counts.total : 0
  const rate = speed(state)
  const left = timeLeft(state)
  const running = state.phase === 'copying' || state.phase === 'database'
  const copying = state.rows.findIndex((r) => r.state === 'copying')
  const list = useRef<HTMLOListElement>(null)
  // The row being copied stays in view, without moving the list when it already is.
  useEffect(() => {
    if (copying < 0) return
    list.current?.querySelector(`[data-testid="export-row-${copying}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [copying])
  return (
    <div className="flex max-h-[80vh] min-h-0 flex-col">
      <header className="px-4 pt-4 pb-2">
        <div className="h-0.5 w-full overflow-hidden rounded bg-[var(--color-line)]">
          <div data-testid="usb-overall" className="h-full bg-[var(--color-accent)]" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <p className="mt-2 flex gap-3 text-xs text-fg-muted tabular-nums">
          <span data-testid="usb-counter">{tr('usbExport.progress.counter', { done: counts.done, total: counts.total })}</span>
          {running && rate !== null && <span>{tr('usbExport.progress.speed', { value: formatFileSize(rate, i18n.language) })}</span>}
          {running && left !== null && <span>{tr('usbExport.progress.left', { time: formatSpan(left, tr) })}</span>}
        </p>
      </header>
      <ol ref={list} data-testid="usb-rows" className="min-h-0 flex-1 overflow-y-auto">
        {state.rows.map((row, i) => (
          <ExportTrackRow key={row.track.id} row={row} index={i} />
        ))}
      </ol>
      {state.phase === 'done' && state.result && (
        <p data-testid="usb-done" role="status" className="px-4 pt-3 text-sm">
          {tr('usbExport.progress.done', { count: state.result.tracks, time: formatSpan(state.result.ms, tr) })}
          {state.result.failed > 0 && ` ${tr('usbExport.progress.failedCount', { count: state.result.failed })}`}
        </p>
      )}
      {state.phase === 'cancelled' && (
        <p data-testid="usb-cancelled" role="status" className="px-4 pt-3 text-sm">{tr('usbExport.progress.cancelled')}</p>
      )}
      {state.phase === 'error' && state.reason && (
        <p data-testid="usb-error" role="alert" className="px-4 pt-3 text-sm text-danger">{tr(`usbExport.errors.${state.reason}`)}</p>
      )}
      <footer className="flex items-center gap-3 border-t border-[var(--color-line)] px-4 py-3 text-xs text-fg-muted">
        <span data-testid="usb-footer" className="min-w-0 truncate">
          {[
            footer.name,
            footer.freeBytes !== null ? tr('usbExport.progress.free', { size: formatFileSize(footer.freeBytes, i18n.language) }) : null,
            footer.filesystem ? tr(`usbExport.fs.${footer.filesystem}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="ml-auto flex gap-2">
          {state.phase === 'copying' && (
            <button type="button" data-testid="usb-cancel" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]">
              {tr('usbExport.progress.cancel')}
            </button>
          )}
          {state.phase === 'database' && (
            <span data-testid="usb-finishing" className="px-3 py-1.5 text-sm">{tr('usbExport.progress.finishing')}</span>
          )}
          {running ? (
            <button type="button" data-testid="usb-background" onClick={onBackground} className="rounded-md bg-[var(--color-hover)] px-3 py-1.5 text-sm">
              {tr('usbExport.progress.background')}
            </button>
          ) : (
            <button type="button" data-testid="usb-close" onClick={onClose} className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-on-accent)]">
              {tr('usbExport.progress.close')}
            </button>
          )}
        </span>
      </footer>
    </div>
  )
}
```

(Check the accent foreground token name with `grep -n "on-accent" src/renderer/src/*.css`; use the one the existing primary buttons use, e.g. in `ConfirmDialog.tsx`.)

- [ ] **Step 7: Locale strings**

Write `$SCRATCH/usb-locale-10.json` and merge it (`node "$SCRATCH/merge-locale.cjs" "$SCRATCH/usb-locale-10.json"` from `apps/desktop`):

```json
{
  "es": { "usbExport": {
    "progress": { "queued": "en cola", "copying": "copiando", "kept": "ya estaba", "counter": "{{done}} / {{total}}", "speed": "{{value}}/s", "left": "quedan {{time}}", "free": "{{size}} libres", "background": "Seguir en segundo plano", "cancel": "Cancelar", "finishing": "Terminando…", "close": "Cerrar", "done_one": "Listo · {{count}} pista en {{time}}. Ya puedes expulsar el USB.", "done_other": "Listo · {{count}} pistas en {{time}}. Ya puedes expulsar el USB.", "failedCount_one": "{{count}} no se pudo exportar.", "failedCount_other": "{{count}} no se pudieron exportar.", "cancelled": "Cancelado. El USB tiene su biblioteca anterior." },
    "span": { "minSec": "{{min}} min {{sec}} s", "sec": "{{sec}} s" },
    "fs": { "fat32": "FAT32", "exfat": "exFAT", "hfs": "HFS+", "apfs": "APFS", "other": "otro formato" },
    "errors": { "unsupported": "Exportar a USB solo está disponible en macOS.", "no-collection": "No encuentro la colección de rekordbox.", "unreadable": "No se pudo leer la colección de rekordbox.", "nothing-selected": "Marca al menos una playlist.", "volume-gone": "El USB se desconectó. Lo que había sigue igual; conéctalo y exporta otra vez.", "volume-changed": "Ese USB ya no está montado ahí.", "no-baken": "Falta una pieza de Surco para exportar. Reinstala Surco.", "refused": "Surco no escribe en esa carpeta.", "baken-failed": "La exportación falló. El USB tiene su biblioteca anterior.", "device-write": "No se pudo escribir en el USB.", "no-space": "No cabe en el USB.", "busy": "Ya hay una exportación en marcha." }
  } },
  "en": { "usbExport": {
    "progress": { "queued": "queued", "copying": "copying", "kept": "already there", "counter": "{{done}} / {{total}}", "speed": "{{value}}/s", "left": "{{time}} left", "free": "{{size}} free", "background": "Keep going in the background", "cancel": "Cancel", "finishing": "Finishing…", "close": "Close", "done_one": "Done · {{count}} track in {{time}}. You can eject the USB now.", "done_other": "Done · {{count}} tracks in {{time}}. You can eject the USB now.", "failedCount_one": "{{count}} could not be exported.", "failedCount_other": "{{count}} could not be exported.", "cancelled": "Cancelled. The USB keeps its previous library." },
    "span": { "minSec": "{{min}} min {{sec}} s", "sec": "{{sec}} s" },
    "fs": { "fat32": "FAT32", "exfat": "exFAT", "hfs": "HFS+", "apfs": "APFS", "other": "other format" },
    "errors": { "unsupported": "Export to USB is only available on macOS.", "no-collection": "The rekordbox collection was not found.", "unreadable": "The rekordbox collection could not be read.", "nothing-selected": "Tick at least one playlist.", "volume-gone": "The USB was disconnected. What was on it is unchanged; plug it in and export again.", "volume-changed": "That USB is no longer mounted there.", "no-baken": "A part of Surco needed to export is missing. Reinstall Surco.", "refused": "Surco does not write to that folder.", "baken-failed": "The export failed. The USB keeps its previous library.", "device-write": "The USB could not be written.", "no-space": "It does not fit on the USB.", "busy": "An export is already running." }
  } },
  "de": { "usbExport": {
    "progress": { "queued": "wartet", "copying": "wird kopiert", "kept": "schon da", "counter": "{{done}} / {{total}}", "speed": "{{value}}/s", "left": "noch {{time}}", "free": "{{size}} frei", "background": "Im Hintergrund weitermachen", "cancel": "Abbrechen", "finishing": "Wird abgeschlossen…", "close": "Schließen", "done_one": "Fertig · {{count}} Track in {{time}}. Du kannst den USB-Stick jetzt auswerfen.", "done_other": "Fertig · {{count}} Tracks in {{time}}. Du kannst den USB-Stick jetzt auswerfen.", "failedCount_one": "{{count}} konnte nicht exportiert werden.", "failedCount_other": "{{count}} konnten nicht exportiert werden.", "cancelled": "Abgebrochen. Der USB-Stick behält seine bisherige Bibliothek." },
    "span": { "minSec": "{{min}} min {{sec}} s", "sec": "{{sec}} s" },
    "fs": { "fat32": "FAT32", "exfat": "exFAT", "hfs": "HFS+", "apfs": "APFS", "other": "anderes Format" },
    "errors": { "unsupported": "Export auf USB gibt es nur unter macOS.", "no-collection": "Die rekordbox-Sammlung wurde nicht gefunden.", "unreadable": "Die rekordbox-Sammlung konnte nicht gelesen werden.", "nothing-selected": "Markiere mindestens eine Playlist.", "volume-gone": "Der USB-Stick wurde getrennt. Was darauf war, ist unverändert; steck ihn ein und exportiere erneut.", "volume-changed": "Dieser USB-Stick ist dort nicht mehr eingebunden.", "no-baken": "Ein Teil von Surco für den Export fehlt. Installiere Surco neu.", "refused": "Surco schreibt nicht in diesen Ordner.", "baken-failed": "Der Export ist fehlgeschlagen. Der USB-Stick behält seine bisherige Bibliothek.", "device-write": "Auf den USB-Stick konnte nicht geschrieben werden.", "no-space": "Passt nicht auf den USB-Stick.", "busy": "Es läuft bereits ein Export." }
  } },
  "fr": { "usbExport": {
    "progress": { "queued": "en attente", "copying": "copie", "kept": "déjà là", "counter": "{{done}} / {{total}}", "speed": "{{value}}/s", "left": "encore {{time}}", "free": "{{size}} libres", "background": "Continuer en arrière-plan", "cancel": "Annuler", "finishing": "Finalisation…", "close": "Fermer", "done_one": "Terminé · {{count}} piste en {{time}}. Tu peux éjecter la clé USB.", "done_other": "Terminé · {{count}} pistes en {{time}}. Tu peux éjecter la clé USB.", "failedCount_one": "{{count}} n’a pas pu être exportée.", "failedCount_other": "{{count}} n’ont pas pu être exportées.", "cancelled": "Annulé. La clé USB garde sa bibliothèque précédente." },
    "span": { "minSec": "{{min}} min {{sec}} s", "sec": "{{sec}} s" },
    "fs": { "fat32": "FAT32", "exfat": "exFAT", "hfs": "HFS+", "apfs": "APFS", "other": "autre format" },
    "errors": { "unsupported": "L’export vers USB n’existe que sur macOS.", "no-collection": "La collection rekordbox est introuvable.", "unreadable": "La collection rekordbox n’a pas pu être lue.", "nothing-selected": "Coche au moins une playlist.", "volume-gone": "La clé USB a été débranchée. Son contenu n’a pas changé ; rebranche-la et exporte à nouveau.", "volume-changed": "Cette clé USB n’est plus montée à cet endroit.", "no-baken": "Il manque une partie de Surco pour exporter. Réinstalle Surco.", "refused": "Surco n’écrit pas dans ce dossier.", "baken-failed": "L’export a échoué. La clé USB garde sa bibliothèque précédente.", "device-write": "Impossible d’écrire sur la clé USB.", "no-space": "Ça ne tient pas sur la clé USB.", "busy": "Un export est déjà en cours." }
  } },
  "pt-BR": { "usbExport": {
    "progress": { "queued": "na fila", "copying": "copiando", "kept": "já estava", "counter": "{{done}} / {{total}}", "speed": "{{value}}/s", "left": "faltam {{time}}", "free": "{{size}} livres", "background": "Continuar em segundo plano", "cancel": "Cancelar", "finishing": "Finalizando…", "close": "Fechar", "done_one": "Pronto · {{count}} faixa em {{time}}. Já pode ejetar o USB.", "done_other": "Pronto · {{count}} faixas em {{time}}. Já pode ejetar o USB.", "failedCount_one": "{{count}} não pôde ser exportada.", "failedCount_other": "{{count}} não puderam ser exportadas.", "cancelled": "Cancelado. O USB mantém a biblioteca anterior." },
    "span": { "minSec": "{{min}} min {{sec}} s", "sec": "{{sec}} s" },
    "fs": { "fat32": "FAT32", "exfat": "exFAT", "hfs": "HFS+", "apfs": "APFS", "other": "outro formato" },
    "errors": { "unsupported": "Exportar para USB só está disponível no macOS.", "no-collection": "A coleção do rekordbox não foi encontrada.", "unreadable": "Não foi possível ler a coleção do rekordbox.", "nothing-selected": "Marque pelo menos uma playlist.", "volume-gone": "O USB foi desconectado. O que havia nele continua igual; conecte e exporte de novo.", "volume-changed": "Esse USB não está mais montado ali.", "no-baken": "Falta uma parte do Surco para exportar. Reinstale o Surco.", "refused": "O Surco não escreve nessa pasta.", "baken-failed": "A exportação falhou. O USB mantém a biblioteca anterior.", "device-write": "Não foi possível gravar no USB.", "no-space": "Não cabe no USB.", "busy": "Já há uma exportação em andamento." }
  } }
}
```

Note the counter test reads `1 / 3`; `done_one`/`done_other` follow the repo's plural rule (count 0 goes to `_other`, `docs` memory "i18n: count 0 va a _other").

- [ ] **Step 8: Run them to see them pass, then the locale key test**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/usbExport.test.ts src/renderer/src/components/UsbExportProgress.test.tsx src/renderer/src/i18n`
Expected: PASS (the i18n folder's key test compares the locales).

- [ ] **Step 9: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/renderer/src/lib/usbExport.ts apps/desktop/src/renderer/src/lib/usbExport.test.ts apps/desktop/src/renderer/src/components/TrackWave.tsx apps/desktop/src/renderer/src/components/ExportTrackRow.tsx apps/desktop/src/renderer/src/components/UsbExportProgress.tsx apps/desktop/src/renderer/src/components/UsbExportProgress.test.tsx apps/desktop/src/renderer/src/i18n/locales
git commit -m "Show the USB export as a track list whose waveforms fill as they copy"
```

---
### Task 11: The choosing face, the live state, and the ways in

**Files:**
- Create: `src/renderer/src/components/CheckTree.tsx`, `src/renderer/src/components/CheckTree.test.tsx`
- Create: `src/renderer/src/components/UsbExportModal.tsx`, `src/renderer/src/components/UsbExportModal.test.tsx`
- Create: `src/renderer/src/hooks/useUsbVolumes.ts`, `src/renderer/src/hooks/useUsbPlan.ts`, `src/renderer/src/hooks/useUsbExport.ts`, `src/renderer/src/hooks/useUsbExport.test.tsx`
- Modify: `src/renderer/src/lib/usbExport.ts` (+ `holderText`, `newlyMounted`), its test
- Modify: `src/renderer/src/components/SourceTree.tsx` (+ test), `src/renderer/src/components/Toolbar.tsx` (+ test), `src/renderer/src/lib/commands.ts` (+ test), `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json` (`usbExport.*` for the chooser, `commands.exportUsb`, `sources.tree.exportUsb`)

**Interfaces:**
- Consumes: Task 9's API and types; Task 10's `UsbExportProgress`, `usbExportReducer`, `IDLE_EXPORT`, `exportCounts`, `formatSpan`.
- Produces: the finished feature.

```ts
// lib/usbExport.ts additions
export function holderText(h: UsbHolder, tr: (k: string, o?: Record<string, unknown>) => string, now: Date): string
export function newlyMounted(prev: UsbVolume[] | null, next: UsbVolume[]): UsbVolume[]
// CheckTree.tsx
export function playlistIdsUnder(node: SourceNode): string[]
export function folderState(node: SourceNode, checked: ReadonlySet<string>): 'all' | 'some' | 'none'
export function CheckTree(props: { nodes: SourceNode[]; checked: ReadonlySet<string>; onChange: (next: Set<string>) => void }): JSX.Element
// hooks
export function useUsbVolumes(enabled: boolean): { list: UsbVolumeList | null }
export function useUsbPlan(req: UsbExportRequest | null): { plan: UsbPlan | null; failure: UsbFailure | null; loading: boolean }
export function useUsbExport(): { state: UsbExportState; start: (req: UsbExportRequest) => Promise<UsbStartResult>; cancel: () => void; reset: () => void }
// UsbExportModal.tsx
export function UsbExportModal(props: {
  nodes: SourceNode[] | undefined; volumes: UsbVolumeList | null; preselect: string | null
  exportState: UsbExportState; onStart: (req: UsbExportRequest) => Promise<UsbStartResult>
  onCancelExport: () => void; onClose: () => void
}): JSX.Element
```

The checked set holds **playlist IDs only**: ticking a folder adds every playlist under it, so what is remembered and sent is exactly what goes on the stick, and a playlist later added to the folder in rekordbox is not silently exported.

- [ ] **Step 1: Failing tests for the helpers and the tree**

Append to `src/renderer/src/lib/usbExport.test.ts`:

```ts
import { holderText, newlyMounted } from './usbExport'
import type { UsbVolume } from '../../../shared/types'

describe('holderText', () => {
  const tr = (k: string, o?: Record<string, unknown>) => `${k}${o ? JSON.stringify(o) : ''}`
  const now = new Date(2026, 9, 16, 12, 0)
  it('says who exported the stick and when, today by the time only', () => {
    expect(holderText({ by: 'empty', at: null }, tr, now)).toBe('usbExport.holder.empty')
    expect(holderText({ by: 'surco', at: new Date(2026, 9, 16, 9, 12).getTime() }, tr, now)).toBe(
      'usbExport.holder.surco{"when":"usbExport.holder.today{\\"time\\":\\"09:12\\"}"}',
    )
    expect(holderText({ by: 'rekordbox', at: new Date(2026, 9, 15, 8, 27).getTime() }, tr, now)).toBe(
      'usbExport.holder.rekordbox{"when":"usbExport.holder.on{\\"date\\":\\"15/10\\",\\"time\\":\\"08:27\\"}"}',
    )
  })
})

describe('newlyMounted', () => {
  const v = (uuid: string): UsbVolume => ({
    uuid, name: uuid, mountPoint: `/Volumes/${uuid}`, filesystem: 'fat32', partitionScheme: 'mbr',
    totalBytes: 1, freeBytes: 1, holder: { by: 'surco', at: 1 }, remembered: null,
  })
  // The first list after launch is not "connected now": no notice for sticks already in.
  it('reports only sticks that appeared since the last list', () => {
    expect(newlyMounted(null, [v('A')])).toEqual([])
    expect(newlyMounted([v('A')], [v('A'), v('B')]).map((x) => x.uuid)).toEqual(['B'])
  })
})
```

`src/renderer/src/components/CheckTree.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import i18n from '../i18n'
import { CheckTree, folderState, playlistIdsUnder } from './CheckTree'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)

const NODES: SourceNode[] = [
  { id: 'bases', name: 'BASES', kind: 'folder', count: 2, children: [
    { id: 'mak', name: 'Makina', kind: 'playlist', count: 7 },
    { id: '90s', name: '90s', kind: 'folder', count: 1, children: [{ id: 'todas', name: 'Todas', kind: 'playlist', count: 336 }] },
  ] },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]

describe('folder helpers', () => {
  it('lists every playlist under a folder, nested ones included', () => {
    expect(playlistIdsUnder(NODES[0])).toEqual(['mak', 'todas'])
  })
  it('reads a folder as all, some or none', () => {
    expect(folderState(NODES[0], new Set(['mak', 'todas']))).toBe('all')
    expect(folderState(NODES[0], new Set(['mak']))).toBe('some')
    expect(folderState(NODES[0], new Set())).toBe('none')
  })
})

describe('CheckTree', () => {
  it('ticks a whole folder, and unticks it when all was ticked', () => {
    const onChange = vi.fn()
    const { rerender } = render(<CheckTree nodes={NODES} checked={new Set()} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('check-node-bases'))
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['mak', 'todas'])
    rerender(<CheckTree nodes={NODES} checked={new Set(['mak', 'todas'])} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('check-node-bases'))
    expect([...onChange.mock.calls[1][0]]).toEqual([])
  })

  it('shows a folder half ticked when only part of it is', () => {
    render(<CheckTree nodes={NODES} checked={new Set(['mak'])} onChange={() => {}} />)
    expect(screen.getByTestId('check-node-bases')).toHaveProperty('indeterminate', true)
    expect(screen.getByTestId('check-node-house')).not.toBeChecked()
  })

  it('ticks a single playlist with its track count beside it', () => {
    const onChange = vi.fn()
    render(<CheckTree nodes={NODES} checked={new Set()} onChange={onChange} />)
    expect(screen.getByTestId('check-row-house')).toHaveTextContent('32')
    fireEvent.click(screen.getByTestId('check-node-house'))
    expect([...onChange.mock.calls[0][0]]).toEqual(['house'])
  })

  it('finds playlists by name and keeps them tickable', () => {
    render(<CheckTree nodes={NODES} checked={new Set()} onChange={() => {}} />)
    fireEvent.change(screen.getByTestId('check-tree-search'), { target: { value: 'tod' } })
    expect(screen.getByTestId('check-node-todas')).toBeInTheDocument()
    expect(screen.queryByTestId('check-node-house')).toBeNull()
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/usbExport.test.ts src/renderer/src/components/CheckTree.test.tsx`
Expected: FAIL (`holderText` not exported; `./CheckTree` missing).

- [ ] **Step 2: Implement the helpers and the tree**

Append to `src/renderer/src/lib/usbExport.ts`:

```ts
import type { UsbHolder, UsbVolume } from '../../../shared/types'

const two = (n: number): string => String(n).padStart(2, '0')

// "exportado por Surco hoy 09:12" / "exportado por rekordbox el 15/10 08:27": the day only
// when it is not today, in the order the user reads dates (day/month).
export function holderText(
  h: UsbHolder,
  tr: (k: string, o?: Record<string, unknown>) => string,
  now: Date,
): string {
  if (h.by === 'empty' || h.at === null) return tr('usbExport.holder.empty')
  const d = new Date(h.at)
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  const today = d.toDateString() === now.toDateString()
  const when = today
    ? tr('usbExport.holder.today', { time })
    : tr('usbExport.holder.on', { date: `${two(d.getDate())}/${two(d.getMonth() + 1)}`, time })
  return tr(`usbExport.holder.${h.by}`, { when })
}

export function newlyMounted(prev: UsbVolume[] | null, next: UsbVolume[]): UsbVolume[] {
  if (!prev) return []
  const known = new Set(prev.map((v) => v.uuid))
  return next.filter((v) => !known.has(v.uuid))
}
```

(Move the new `import type` line up into the file's existing import of `../../../shared/types`.)

`src/renderer/src/components/CheckTree.tsx`:

```tsx
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceNode } from '../../../shared/types'
import { flattenPlaylists } from './SourceTree'

// The rekordbox tree with a checkbox per playlist and per folder, for choosing what goes on
// the stick. Only playlist IDs are held: a folder is a shortcut for everything under it.

export function playlistIdsUnder(node: SourceNode): string[] {
  return node.kind === 'playlist' ? [node.id] : (node.children ?? []).flatMap(playlistIdsUnder)
}

export function folderState(node: SourceNode, checked: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const ids = playlistIdsUnder(node)
  const on = ids.filter((id) => checked.has(id)).length
  return ids.length > 0 && on === ids.length ? 'all' : on > 0 ? 'some' : 'none'
}

export function CheckTree({
  nodes,
  checked,
  onChange,
}: {
  nodes: SourceNode[]
  checked: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? flattenPlaylists(nodes).filter((h) => h.node.name.toLowerCase().includes(q)) : null
  }, [nodes, query])

  const toggle = (node: SourceNode): void => {
    const ids = playlistIdsUnder(node)
    const next = new Set(checked)
    const clear = node.kind === 'folder' ? folderState(node, checked) === 'all' : checked.has(node.id)
    for (const id of ids) clear ? next.delete(id) : next.add(id)
    onChange(next)
  }

  const row = (node: SourceNode, depth: number, trail?: string): React.JSX.Element => {
    const isFolder = node.kind === 'folder'
    const state = isFolder ? folderState(node, checked) : checked.has(node.id) ? 'all' : 'none'
    const open = opened.has(node.id)
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={node.id}>
        <div data-testid={`check-row-${node.id}`} style={{ paddingLeft: 8 + depth * 18 }} className="flex h-[27px] items-center gap-1.5 pr-2 text-[11.5px]">
          {isFolder ? (
            <button
              type="button"
              aria-label={node.name}
              aria-expanded={open}
              onClick={() =>
                setOpened((prev) => {
                  const next = new Set(prev)
                  if (next.has(node.id)) next.delete(node.id)
                  else next.add(node.id)
                  return next
                })
              }
              className="text-fg-faint"
            >
              <Chevron size={12} aria-hidden="true" />
            </button>
          ) : (
            <span className="w-3" />
          )}
          <input
            type="checkbox"
            data-testid={`check-node-${node.id}`}
            aria-label={tr('usbExport.choose.tick', { name: node.name })}
            checked={state === 'all'}
            ref={(el) => {
              if (el) el.indeterminate = state === 'some'
            }}
            onChange={() => toggle(node)}
          />
          <span className={`min-w-0 truncate ${isFolder ? 'font-semibold' : ''}`}>{node.name}</span>
          {trail && <span className="min-w-0 truncate text-[11px] text-fg-faint">{trail}</span>}
          {!isFolder && <span className="ml-auto text-[11px] tabular-nums text-fg-faint">{node.count}</span>}
        </div>
        {isFolder && open && <ul>{(node.children ?? []).map((c) => row(c, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <label className="mb-2 flex h-[30px] items-center gap-1.5 rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2 text-xs">
        <Search size={13} className="text-fg-faint" aria-hidden="true" />
        <input
          data-testid="check-tree-search"
          aria-label={tr('sources.search')}
          placeholder={tr('sources.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {hits ? hits.map((h) => row(h.node, 0, h.folders.join(' › '))) : nodes.map((n) => row(n, 0))}
      </ul>
    </div>
  )
}
```

Run Step 1's command. Expected: PASS.

- [ ] **Step 3: Failing hook tests**

`src/renderer/src/hooks/useUsbExport.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { UsbExportEvent, UsbPlanResult } from '../../../shared/types'
import { stubApi } from '../test/api'
import { useUsbExport } from './useUsbExport'
import { useUsbPlan } from './useUsbPlan'

let emit: (e: UsbExportEvent) => void = () => {}
const setApi = (over: Partial<Api> = {}) => {
  const api = stubApi({
    onUsbEvent: (cb) => {
      emit = cb
      return () => {}
    },
    ...over,
  })
  ;(window as unknown as { api: Api }).api = api
  return api
}
beforeEach(() => setApi())
afterEach(() => vi.useRealTimers())

describe('useUsbExport', () => {
  // The state lives above the modal, so closing it loses nothing.
  it('folds the main process events into the export state', () => {
    const { result } = renderHook(() => useUsbExport())
    act(() => emit({ type: 'started', tracks: [], targetName: 'Surco', startedAt: 0 }))
    expect(result.current.state.phase).toBe('copying')
    act(() => emit({ type: 'finished', outcome: 'cancelled' }))
    expect(result.current.state.phase).toBe('cancelled')
    act(() => result.current.reset())
    expect(result.current.state.phase).toBe('idle')
  })
})

describe('useUsbPlan', () => {
  // Ticking several boxes in a row must not run baken's dry run for each one.
  it('waits for the ticking to settle before asking', async () => {
    vi.useFakeTimers()
    const usbPlan = vi.fn(async (): Promise<UsbPlanResult> => ({ ok: false, reason: 'nothing-selected' }))
    setApi({ usbPlan })
    const target = { kind: 'volume' as const, uuid: 'U' }
    const { rerender } = renderHook(({ ids }) => useUsbPlan({ playlistIds: ids, target, prune: false }), {
      initialProps: { ids: ['a'] },
    })
    rerender({ ids: ['a', 'b'] })
    rerender({ ids: ['a', 'b', 'c'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(usbPlan).toHaveBeenCalledTimes(1)
    expect(usbPlan.mock.calls[0][0]).toMatchObject({ playlistIds: ['a', 'b', 'c'] })
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useUsbExport.test.tsx`
Expected: FAIL, missing modules.

- [ ] **Step 4: Implement the hooks**

`src/renderer/src/hooks/useUsbExport.ts`:

```ts
import { useCallback, useEffect, useReducer } from 'react'
import type { UsbExportEvent, UsbExportRequest, UsbStartResult } from '../../../shared/types'
import { IDLE_EXPORT, type UsbExportState, usbExportReducer } from '../lib/usbExport'

type Action = UsbExportEvent | { type: 'reset' }

// The running export, kept in App so the modal can close and reopen around it, and the
// toolbar pill and the top progress line can read it.
export function useUsbExport(): {
  state: UsbExportState
  start: (req: UsbExportRequest) => Promise<UsbStartResult>
  cancel: () => void
  reset: () => void
} {
  const [state, dispatch] = useReducer(
    (s: UsbExportState, a: Action) => (a.type === 'reset' ? IDLE_EXPORT : usbExportReducer(s, a, Date.now())),
    IDLE_EXPORT,
  )
  useEffect(() => window.api.onUsbEvent((e) => dispatch(e)), [])
  const start = useCallback((req: UsbExportRequest) => window.api.usbExport(req), [])
  const cancel = useCallback(() => void window.api.usbCancel(), [])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [])
  return { state, start, cancel, reset }
}
```

`src/renderer/src/hooks/useUsbPlan.ts`:

```ts
import { useEffect, useState } from 'react'
import type { UsbExportRequest, UsbFailure, UsbPlan } from '../../../shared/types'

// The summary under the chooser. Each request runs baken's dry run (and stages the
// analysis), so it waits until the ticking has paused, and a late answer to an old
// selection is dropped.
const SETTLE_MS = 300

export function useUsbPlan(req: UsbExportRequest | null): {
  plan: UsbPlan | null
  failure: UsbFailure | null
  loading: boolean
} {
  const [answer, setAnswer] = useState<{ plan: UsbPlan | null; failure: UsbFailure | null }>({ plan: null, failure: null })
  const [loading, setLoading] = useState(false)
  const key = req ? JSON.stringify(req) : ''
  useEffect(() => {
    if (!key) {
      setAnswer({ plan: null, failure: null })
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    const timer = setTimeout(() => {
      void window.api.usbPlan(JSON.parse(key) as UsbExportRequest).then((r) => {
        if (!live) return
        setAnswer(r.ok ? { plan: r.plan, failure: null } : { plan: null, failure: r.reason })
        setLoading(false)
      })
    }, SETTLE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key])
  return { ...answer, loading }
}
```

`src/renderer/src/hooks/useUsbVolumes.ts`:

```ts
import { useEffect, useState } from 'react'
import type { UsbVolumeList } from '../../../shared/types'

// The mounted removable volumes, live: main re-reads them when /Volumes changes.
export function useUsbVolumes(enabled: boolean): { list: UsbVolumeList | null } {
  const [list, setList] = useState<UsbVolumeList | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void window.api.usbVolumes().then((l) => live && setList(l))
    const off = window.api.onUsbVolumesChanged((l) => setList(l))
    return () => {
      live = false
      off()
    }
  }, [enabled])
  return { list }
}
```

Run Step 3's command. Expected: PASS.

- [ ] **Step 5: Failing modal tests**

`src/renderer/src/components/UsbExportModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { SourceNode, UsbPlan, UsbVolume, UsbVolumeList } from '../../../shared/types'
import i18n from '../i18n'
import { IDLE_EXPORT, usbExportReducer } from '../lib/usbExport'
import { stubApi } from '../test/api'
import { UsbExportModal } from './UsbExportModal'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)

const NODES: SourceNode[] = [
  { id: 'bases', name: 'BASES', kind: 'folder', count: 1, children: [{ id: 'mak', name: 'Makina', kind: 'playlist', count: 7 }] },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]
const vol = (over: Partial<UsbVolume>): UsbVolume => ({
  uuid: 'U1', name: 'Vicent', mountPoint: '/Volumes/Vicent', filesystem: 'fat32', partitionScheme: 'mbr',
  totalBytes: 32e9, freeBytes: 21e9, holder: { by: 'empty', at: null }, remembered: null, ...over,
})
const PLAN: UsbPlan = {
  tracks: [], trackCount: 7, newCount: 5, newBytes: 1.2e9, keptCount: 2, removedSinceLast: 1,
  warnings: [{ kind: 'exfat' }, { kind: 'cdj2000', titles: ['No Fear'] }],
}

let usbPlan = vi.fn()
beforeEach(() => {
  usbPlan = vi.fn(async () => ({ ok: true, plan: PLAN }))
  ;(window as unknown as { api: Api }).api = stubApi({ usbPlan })
})

async function show(list: UsbVolumeList | null, over: Partial<Parameters<typeof UsbExportModal>[0]> = {}) {
  vi.useFakeTimers()
  const onStart = vi.fn(async () => ({ ok: true as const }))
  render(
    <UsbExportModal nodes={NODES} volumes={list} preselect={null} exportState={IDLE_EXPORT} onStart={onStart} onCancelExport={() => {}} onClose={() => {}} {...over} />,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  vi.useRealTimers()
  return { onStart }
}

describe('UsbExportModal choosing', () => {
  it('asks to connect a USB when there is none', async () => {
    await show({ volumes: [], lastKey: null })
    expect(screen.getByTestId('usb-none')).toHaveTextContent('Conecta un USB')
  })

  // Two sticks both called "Vicent": each row is its own stick, picked by UUID.
  it('lists each stick with its space, format and what it holds', async () => {
    await show({ volumes: [vol({}), vol({ uuid: 'U2', mountPoint: '/Volumes/Vicent 1', holder: { by: 'rekordbox', at: Date.now() } })], lastKey: null })
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('Vicent')
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('FAT32')
    expect(screen.getByTestId('usb-volume-U2')).toHaveTextContent('exportado por rekordbox hoy')
  })

  // The second time is one press: the stick last used is chosen and its playlists ticked.
  it('preselects the last stick and ticks what it got last time', async () => {
    const remembered = { playlistIds: ['mak'], prune: false, at: 1 }
    await show({ volumes: [vol({}), vol({ uuid: 'U2', remembered })], lastKey: 'volume:U2' })
    expect(screen.getByTestId('usb-volume-U2')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
    expect(usbPlan).toHaveBeenCalledWith({ playlistIds: ['mak'], target: { kind: 'volume', uuid: 'U2' }, prune: false })
  })

  it('summarises and warns', async () => {
    await show({ volumes: [vol({ remembered: { playlistIds: ['mak'], prune: false, at: 1 } })], lastKey: null })
    const s = screen.getByTestId('usb-summary')
    expect(s).toHaveTextContent('7 pistas')
    expect(s).toHaveTextContent('5 nuevas')
    expect(s).toHaveTextContent('2 ya están')
    expect(s).toHaveTextContent('1 quitada desde la última vez')
    expect(screen.getByTestId('usb-warning-exfat')).toBeInTheDocument()
    expect(screen.getByTestId('usb-warning-cdj2000')).toHaveTextContent('No Fear')
  })

  it('cannot export what does not fit', async () => {
    usbPlan.mockResolvedValue({ ok: true, plan: { ...PLAN, warnings: [{ kind: 'noSpace', missingBytes: 1.4e9 }] } })
    await show({ volumes: [vol({ remembered: { playlistIds: ['mak'], prune: false, at: 1 } })], lastKey: null })
    expect(screen.getByTestId('usb-export')).toBeDisabled()
  })

  // Deleting music from the stick is opt-in and sent only when ticked.
  it('exports with prune off unless ticked', async () => {
    const { onStart } = await show({ volumes: [vol({ remembered: { playlistIds: ['mak'], prune: false, at: 1 } })], lastKey: null })
    expect(screen.getByTestId('usb-prune')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(onStart).toHaveBeenCalledWith({ playlistIds: ['mak'], target: { kind: 'volume', uuid: 'U1' }, prune: false })
  })

  it('shows the progress list once an export runs', async () => {
    const running = usbExportReducer(IDLE_EXPORT, { type: 'started', tracks: [], targetName: 'Vicent', startedAt: 0 }, 0)
    await show({ volumes: [vol({})], lastKey: null }, { exportState: running })
    expect(screen.getByTestId('usb-rows')).toBeInTheDocument()
    expect(screen.queryByTestId('usb-summary')).toBeNull()
  })
})
```

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/UsbExportModal.test.tsx`
Expected: FAIL, missing module.

- [ ] **Step 6: Implement the modal**

`src/renderer/src/components/UsbExportModal.tsx`:

```tsx
import { Usb } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SourceNode, UsbExportRequest, UsbStartResult, UsbTarget, UsbVolume, UsbVolumeList, UsbWarning,
} from '../../../shared/types'
import { formatFileSize } from '../lib/properties'
import { holderText, type UsbExportState } from '../lib/usbExport'
import { useUsbPlan } from '../hooks/useUsbPlan'
import { CheckTree } from './CheckTree'
import { ModalShell } from './ModalShell'
import { UsbExportProgress } from './UsbExportProgress'

// The first stick to offer: the one asked for (the connect notice), else the last one used
// if it is mounted, else the only one.
function initialVolume(list: UsbVolumeList | null, preselect: string | null): UsbVolume | null {
  const vols = list?.volumes ?? []
  return (
    vols.find((v) => v.uuid === preselect) ??
    vols.find((v) => `volume:${v.uuid}` === list?.lastKey) ??
    (vols.length === 1 ? vols[0] : null)
  )
}

export function UsbExportModal({
  nodes,
  volumes,
  preselect,
  exportState,
  onStart,
  onCancelExport,
  onClose,
}: {
  nodes: SourceNode[] | undefined
  volumes: UsbVolumeList | null
  preselect: string | null
  exportState: UsbExportState
  onStart: (req: UsbExportRequest) => Promise<UsbStartResult>
  onCancelExport: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const first = initialVolume(volumes, preselect)
  const [target, setTarget] = useState<UsbTarget | null>(first ? { kind: 'volume', uuid: first.uuid } : null)
  const [checked, setChecked] = useState<Set<string>>(new Set(first?.remembered?.playlistIds ?? []))
  const [prune, setPrune] = useState(first?.remembered?.prune ?? false)
  const [startError, setStartError] = useState<string | null>(null)
  // A list that arrives after the modal opened still preselects, once.
  const [seeded, setSeeded] = useState(first !== null)
  if (!seeded && first) {
    setSeeded(true)
    setTarget({ kind: 'volume', uuid: first.uuid })
    setChecked(new Set(first.remembered?.playlistIds ?? []))
    setPrune(first.remembered?.prune ?? false)
  }
  const req = target && checked.size > 0 ? { playlistIds: [...checked].sort(), target, prune } : null
  const { plan, failure, loading } = useUsbPlan(req)
  const chosen = target?.kind === 'volume' ? volumes?.volumes.find((v) => v.uuid === target.uuid) ?? null : null

  const choose = (v: UsbVolume): void => {
    setTarget({ kind: 'volume', uuid: v.uuid })
    if (v.remembered) {
      setChecked(new Set(v.remembered.playlistIds))
      setPrune(v.remembered.prune)
    }
  }
  const pickFolder = async (): Promise<void> => {
    const pick = await window.api.usbPickFolder()
    if (!pick) return
    setTarget({ kind: 'folder', path: pick.path })
    if (pick.remembered) {
      setChecked(new Set(pick.remembered.playlistIds))
      setPrune(pick.remembered.prune)
    }
  }
  const noSpace = plan?.warnings.some((w) => w.kind === 'noSpace') ?? false
  const exporting = exportState.phase !== 'idle'

  const warning = (w: UsbWarning): React.ReactNode => {
    switch (w.kind) {
      case 'cdj2000':
        return (
          <details>
            <summary>{tr('usbExport.warnings.cdj2000', { count: w.titles.length })}</summary>
            <ul className="mt-1 list-disc pl-5">{w.titles.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
        )
      case 'missing':
        return tr('usbExport.warnings.missing', { count: w.titles.length })
      case 'streaming':
        return tr('usbExport.warnings.streaming', { count: w.count })
      case 'noSpace':
        return tr('usbExport.warnings.noSpace', { size: formatFileSize(w.missingBytes, i18n.language) })
      default:
        return tr(`usbExport.warnings.${w.kind}`)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="usb-export-backdrop"
      dialogTestId="usb-export-modal"
      labelledBy="usb-export-title"
      className="flex w-[760px] max-w-[94vw] flex-col rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] shadow-[var(--shadow-float)]"
    >
      <h2 id="usb-export-title" className="flex items-center gap-2 px-4 pt-4 text-base font-semibold">
        <Usb size={16} aria-hidden="true" />
        {tr('usbExport.title')}
      </h2>
      {exporting ? (
        <UsbExportProgress
          state={exportState}
          footer={{ name: exportState.targetName, freeBytes: chosen?.freeBytes ?? null, filesystem: chosen?.filesystem ?? null }}
          onBackground={onClose}
          onCancel={onCancelExport}
          onClose={onClose}
        />
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 p-4" style={{ height: '62vh' }}>
          <CheckTree nodes={nodes ?? []} checked={checked} onChange={setChecked} />
          <div className="flex min-h-0 flex-col gap-3">
            <div role="radiogroup" aria-label={tr('usbExport.choose.sticks')} className="flex flex-col gap-1.5">
              {(volumes?.volumes ?? []).length === 0 && (
                <p data-testid="usb-none" className="rounded-md border border-dashed border-[var(--color-line-strong)] px-3 py-4 text-center text-sm text-fg-muted">
                  {tr('usbExport.choose.none')}
                </p>
              )}
              {(volumes?.volumes ?? []).map((v) => {
                const on = target?.kind === 'volume' && target.uuid === v.uuid
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    key={v.uuid}
                    data-testid={`usb-volume-${v.uuid}`}
                    onClick={() => choose(v)}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${on ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)] hover:bg-[var(--color-hover)]'}`}
                  >
                    <span className="font-semibold">{v.name}</span>
                    <span className="block text-xs text-fg-muted">
                      {[
                        tr('usbExport.choose.capacity', {
                          total: formatFileSize(v.totalBytes, i18n.language),
                          free: formatFileSize(v.freeBytes, i18n.language),
                        }),
                        tr(`usbExport.fs.${v.filesystem}`),
                      ].join(' · ')}
                    </span>
                    <span className="block text-xs text-fg-faint">{holderText(v.holder, tr, new Date())}</span>
                  </button>
                )
              })}
              <button type="button" data-testid="usb-other" onClick={() => void pickFolder()} className="self-start text-xs text-[var(--color-accent)] hover:underline">
                {target?.kind === 'folder' ? target.path : tr('usbExport.choose.other')}
              </button>
            </div>
            <div data-testid="usb-summary" role="status" className="min-h-0 flex-1 overflow-y-auto text-sm">
              {!req && <p className="text-fg-faint">{tr('usbExport.choose.pick')}</p>}
              {req && loading && <p className="text-fg-faint">{tr('usbExport.choose.calculating')}</p>}
              {req && !loading && failure && <p className="text-danger">{tr(`usbExport.errors.${failure}`)}</p>}
              {req && !loading && plan && (
                <>
                  <p className="font-semibold">{tr('usbExport.summary.tracks', { count: plan.trackCount })}</p>
                  <p>{tr('usbExport.summary.new', { count: plan.newCount, size: formatFileSize(plan.newBytes, i18n.language) })}</p>
                  <p>{tr('usbExport.summary.kept', { count: plan.keptCount })}</p>
                  {plan.removedSinceLast !== null && plan.removedSinceLast > 0 && (
                    <p>{tr('usbExport.summary.removed', { count: plan.removedSinceLast })}</p>
                  )}
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
                    {plan.warnings.map((w) => (
                      <li key={w.kind} data-testid={`usb-warning-${w.kind}`}>{warning(w)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" data-testid="usb-prune" checked={prune} onChange={(e) => setPrune(e.target.checked)} />
              {tr('usbExport.choose.prune')}
            </label>
            {startError && <p role="alert" className="text-xs text-danger">{startError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" data-testid="usb-cancel-choose" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]">
                {tr('usbExport.choose.cancel')}
              </button>
              <button
                type="button"
                data-testid="usb-export"
                disabled={!req || !plan || loading || noSpace}
                onClick={() => {
                  if (!req) return
                  setStartError(null)
                  void onStart(req).then((r) => {
                    if (!r.ok) setStartError(tr(`usbExport.errors.${r.reason}`))
                  })
                }}
                className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm text-[var(--color-on-accent)] disabled:opacity-40"
              >
                {tr('usbExport.choose.export')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
```

The preselect test expects `playlistIds` sorted (`['mak']`); requests always send them sorted so the plan's debounce key does not change with tick order.

- [ ] **Step 7: Entry points**

`SourceTree.tsx`: add an optional prop `onExportUsb?: () => void` (documented: "The USB export, offered where it exists: rekordbox's tree on macOS.") and, in the header, before the `edit` buttons' `<span>` (or as its own `ml-auto` span when `edit` is absent):

```tsx
            {onExportUsb && (
              <button
                type="button"
                data-testid="source-tree-export-usb"
                aria-label={tr('sources.tree.exportUsb')}
                onClick={onExportUsb}
                className="rounded p-1 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
              >
                <Usb size={14} aria-hidden="true" />
                <Tooltip label={tr('sources.tree.exportUsb')} />
              </button>
            )}
```

(`Usb` added to the `lucide-react` import.) Test in `SourceTree.test.tsx`:

```tsx
  it('offers the USB export only when asked to', () => {
    const onExportUsb = vi.fn()
    const { rerender } = render(<SourceTree title="rekordbox" source="rekordbox" nodes={NODES} failed={false} selectedId={null} onSelect={() => {}} />)
    expect(screen.queryByTestId('source-tree-export-usb')).toBeNull()
    rerender(<SourceTree title="rekordbox" source="rekordbox" nodes={NODES} failed={false} selectedId={null} onSelect={() => {}} onExportUsb={onExportUsb} />)
    fireEvent.click(screen.getByTestId('source-tree-export-usb'))
    expect(onExportUsb).toHaveBeenCalled()
  })
```

`lib/commands.ts`: in `CommandDeps` after `openApplePlaylist?`:

```ts
  // Undefined where the USB export does not exist (off macOS, or without a rekordbox
  // collection): not registered rather than shown disabled.
  openUsbExport?: () => void
```

destructure it in `buildCommands`, and after the `list-review` command:

```ts
    ...(openUsbExport
      ? [
          {
            id: 'export-usb',
            group: 'library' as const,
            title: tr('commands.exportUsb'),
            hint: hintFor('export-usb'),
            enabled: true,
            run: openUsbExport,
          },
        ]
      : []),
```

Test in `commands.test.ts` (it builds deps with `makeDeps`, like the Music review command's test):

```ts
  it('offers the USB export only where it exists', () => {
    expect(buildCommands(makeDeps()).some((c) => c.id === 'export-usb')).toBe(false)
    const open = vi.fn()
    commandById(makeDeps({ openUsbExport: open }), 'export-usb').run()
    expect(open).toHaveBeenCalled()
  })
```

`Toolbar.tsx`: props

```ts
  // The USB export running with its modal closed: a pill like the sweeps', which reopens it.
  usbExport: { done: number; total: number } | null
  onUsbExport: () => void
```

rendered right before the `importing` pill:

```tsx
        {usbExport && (
          <button
            type="button"
            data-testid="usb-export-progress"
            onClick={onUsbExport}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[var(--color-accent)] tabular-nums hover:bg-[var(--color-hover)]"
          >
            <Usb size={14} aria-hidden="true" />
            {tr('usbExport.pill', { done: usbExport.done, total: usbExport.total })}
          </button>
        )}
```

and in the `sr-only` live region block one more `<span role="status">` with the same text when `usbExport` is set. In `Toolbar.test.tsx`, add `usbExport: null, onUsbExport: vi.fn(),` to the `props` object of its `renderBar` helper, and:

```tsx
  // Closing the modal never stops the export; the pill is the way back to it.
  it('shows a running USB export as a pill that reopens it', () => {
    const props = renderBar({ usbExport: { done: 7, total: 12 } })
    fireEvent.click(screen.getByTestId('usb-export-progress'))
    expect(screen.getByTestId('usb-export-progress')).toHaveTextContent('USB 7/12')
    expect(props.onUsbExport).toHaveBeenCalled()
  })

  it('has no pill without a USB export running', () => {
    renderBar()
    expect(screen.queryByTestId('usb-export-progress')).toBeNull()
  })
```

- [ ] **Step 8: App wiring**

In `App.tsx`:

1. Imports: `UsbExportModal`, `useUsbExport`, `useUsbVolumes`, `exportCounts`, `formatSpan`, `newlyMounted`, `type UsbVolume`, and `useQuery` from `@tanstack/react-query` if App does not import it yet.
2. Next to `const editRekordbox = useRekordboxEdits(notifyEdit)`:

```tsx
  // The USB export: macOS with a rekordbox collection only. Its state lives here so the
  // modal can close while it runs (pill in the toolbar, line on top, notice when done).
  const usbAvailable = isMac && browser.sources.includes('rekordbox')
  const usb = useUsbExport()
  const { list: usbVolumes } = useUsbVolumes(usbAvailable)
  const [usbModal, setUsbModal] = useState<{ preselect: string | null } | null>(null)
  const openUsbExport = useCallback((preselect: string | null = null) => setUsbModal({ preselect }), [])
  // The same query key the source browser uses for rekordbox's tree, so an open tree is
  // reused and a tree read here is there when the user opens rekordbox in the rail.
  const usbTree = useQuery({
    queryKey: ['source-tree', 'rekordbox'],
    queryFn: () => window.api.loadRekordboxTree(),
    enabled: usbModal !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const usbRunning = usb.state.phase === 'copying' || usb.state.phase === 'database'
  const prevVolumes = useRef<UsbVolume[] | null>(null)
  useEffect(() => {
    if (!usbVolumes) return
    const appeared = newlyMounted(prevVolumes.current, usbVolumes.volumes)
    prevVolumes.current = usbVolumes.volumes
    if (usbModal || usbRunning) return
    for (const v of appeared.filter((x) => x.holder.by !== 'empty'))
      pushToast(store, {
        key: `usb-connected-${v.uuid}`,
        tone: 'neutral',
        message: { key: 'usbExport.connected', values: { name: v.name } },
        action: { label: { key: 'usbExport.connectedAction' }, onAction: () => openUsbExport(v.uuid) },
        duration: 8000,
        testid: 'usb-connected',
      })
  }, [usbVolumes, usbModal, usbRunning, store, openUsbExport])
  const usbPhase = useRef(usb.state.phase)
  useEffect(() => {
    const was = usbPhase.current
    usbPhase.current = usb.state.phase
    if (usbModal || was === usb.state.phase) return
    if (usb.state.phase === 'done' && usb.state.result)
      pushToast(store, {
        tone: 'neutral',
        message: { key: 'usbExport.progress.done', values: { count: usb.state.result.tracks, time: formatSpan(usb.state.result.ms, tr) } },
        duration: 10000,
        testid: 'usb-done-notice',
      })
    if (usb.state.phase === 'error' && usb.state.reason)
      pushToast(store, { tone: 'danger', message: { key: `usbExport.errors.${usb.state.reason}` }, testid: 'usb-error-notice' })
  }, [usb.state.phase, usb.state.result, usb.state.reason, usbModal, store, tr])
```

3. `topBarProgress([analysis, matching, batchProgress, importProgress, usbRunning ? exportCounts(usb.state) : null], anyLoadingMeta)`.
4. `<Toolbar … usbExport={usbRunning && !usbModal ? exportCounts(usb.state) : null} onUsbExport={() => openUsbExport()} />`.
5. `<SourceTree … onExportUsb={usbAvailable && browser.source === 'rekordbox' ? () => openUsbExport() : undefined} />`.
6. `buildCommands({ … openUsbExport: usbAvailable ? () => openUsbExport() : undefined })`.
7. With the other overlays:

```tsx
            {usbModal && (
              <UsbExportModal
                nodes={usbTree.data}
                volumes={usbVolumes}
                preselect={usbModal.preselect}
                exportState={usb.state}
                onStart={usb.start}
                onCancelExport={usb.cancel}
                onClose={() => {
                  setUsbModal(null)
                  if (!usbRunning) usb.reset()
                }}
              />
            )}
```


- [ ] **Step 9: Locale strings**

Merge `$SCRATCH/usb-locale-11.json`:

```json
{
  "es": {
    "commands": { "exportUsb": "Exportar a USB…" },
    "sources": { "tree": { "exportUsb": "Exportar a USB" } },
    "usbExport": {
      "title": "Exportar a USB", "pill": "USB {{done}}/{{total}}", "connected": "USB {{name}} conectado", "connectedAction": "Exportar",
      "holder": { "empty": "vacío", "today": "hoy {{time}}", "on": "el {{date}} {{time}}", "rekordbox": "exportado por rekordbox {{when}}", "surco": "exportado por Surco {{when}}", "other": "tiene una exportación, {{when}}" },
      "choose": { "tick": "Marcar {{name}}", "sticks": "USB", "none": "Conecta un USB", "other": "Otro destino…", "capacity": "{{total}} · {{free}} libres", "pick": "Marca playlists y elige un USB.", "calculating": "Calculando…", "prune": "Borrar del USB la música que ya no se exporta", "cancel": "Cancelar", "export": "Exportar" },
      "summary": { "tracks_one": "{{count}} pista", "tracks_other": "{{count}} pistas", "new_one": "{{count}} nueva · {{size}}", "new_other": "{{count}} nuevas · {{size}}", "kept_one": "{{count}} ya está", "kept_other": "{{count}} ya están", "removed_one": "{{count}} quitada desde la última vez", "removed_other": "{{count}} quitadas desde la última vez" },
      "warnings": { "rekordboxExport": "Este USB lo exportó rekordbox. Su biblioteca se sustituye por esta; la música que ya está se aprovecha.", "exfat": "exFAT. El CDJ-2000 no lo lee.", "gpt": "GPT. El CDJ-2000 y los NXS2 no lo leen.", "notVolumeRoot": "Los reproductores solo leen la raíz de un USB.", "cdj2000_one": "{{count}} pista puede que no suene en un CDJ-2000", "cdj2000_other": "{{count}} pistas puede que no suenen en un CDJ-2000", "missing_one": "{{count}} pista no se encuentra", "missing_other": "{{count}} pistas no se encuentran", "streaming_one": "{{count}} de streaming no se puede exportar", "streaming_other": "{{count}} de streaming no se pueden exportar", "noSpace": "No cabe. Faltan {{size}}." }
    }
  },
  "en": {
    "commands": { "exportUsb": "Export to USB…" },
    "sources": { "tree": { "exportUsb": "Export to USB" } },
    "usbExport": {
      "title": "Export to USB", "pill": "USB {{done}}/{{total}}", "connected": "USB {{name}} connected", "connectedAction": "Export",
      "holder": { "empty": "empty", "today": "today {{time}}", "on": "on {{date}} {{time}}", "rekordbox": "exported by rekordbox {{when}}", "surco": "exported by Surco {{when}}", "other": "holds an export, {{when}}" },
      "choose": { "tick": "Tick {{name}}", "sticks": "USB", "none": "Connect a USB", "other": "Other destination…", "capacity": "{{total}} · {{free}} free", "pick": "Tick playlists and choose a USB.", "calculating": "Calculating…", "prune": "Delete music from the USB that is no longer exported", "cancel": "Cancel", "export": "Export" },
      "summary": { "tracks_one": "{{count}} track", "tracks_other": "{{count}} tracks", "new_one": "{{count}} new · {{size}}", "new_other": "{{count}} new · {{size}}", "kept_one": "{{count}} already there", "kept_other": "{{count}} already there", "removed_one": "{{count}} removed since last time", "removed_other": "{{count}} removed since last time" },
      "warnings": { "rekordboxExport": "rekordbox exported this USB. Its library is replaced by this one; music already on it is reused.", "exfat": "exFAT. The CDJ-2000 cannot read it.", "gpt": "GPT. The CDJ-2000 and the NXS2 cannot read it.", "notVolumeRoot": "Players only read the root of a USB.", "cdj2000_one": "{{count}} track may not play on a CDJ-2000", "cdj2000_other": "{{count}} tracks may not play on a CDJ-2000", "missing_one": "{{count}} track is missing", "missing_other": "{{count}} tracks are missing", "streaming_one": "{{count}} streaming track cannot be exported", "streaming_other": "{{count}} streaming tracks cannot be exported", "noSpace": "It does not fit. {{size}} short." }
    }
  },
  "de": {
    "commands": { "exportUsb": "Auf USB exportieren…" },
    "sources": { "tree": { "exportUsb": "Auf USB exportieren" } },
    "usbExport": {
      "title": "Auf USB exportieren", "pill": "USB {{done}}/{{total}}", "connected": "USB {{name}} verbunden", "connectedAction": "Exportieren",
      "holder": { "empty": "leer", "today": "heute {{time}}", "on": "am {{date}} {{time}}", "rekordbox": "von rekordbox exportiert {{when}}", "surco": "von Surco exportiert {{when}}", "other": "enthält einen Export, {{when}}" },
      "choose": { "tick": "{{name}} markieren", "sticks": "USB", "none": "Schließ einen USB-Stick an", "other": "Anderes Ziel…", "capacity": "{{total}} · {{free}} frei", "pick": "Markiere Playlists und wähle einen USB-Stick.", "calculating": "Wird berechnet…", "prune": "Musik vom USB-Stick löschen, die nicht mehr exportiert wird", "cancel": "Abbrechen", "export": "Exportieren" },
      "summary": { "tracks_one": "{{count}} Track", "tracks_other": "{{count}} Tracks", "new_one": "{{count}} neu · {{size}}", "new_other": "{{count}} neu · {{size}}", "kept_one": "{{count}} schon da", "kept_other": "{{count}} schon da", "removed_one": "{{count}} seit dem letzten Mal entfernt", "removed_other": "{{count}} seit dem letzten Mal entfernt" },
      "warnings": { "rekordboxExport": "Diesen USB-Stick hat rekordbox exportiert. Seine Bibliothek wird durch diese ersetzt; vorhandene Musik wird weiterverwendet.", "exfat": "exFAT. Der CDJ-2000 liest das nicht.", "gpt": "GPT. Der CDJ-2000 und die NXS2 lesen das nicht.", "notVolumeRoot": "Player lesen nur das Hauptverzeichnis eines USB-Sticks.", "cdj2000_one": "{{count}} Track läuft eventuell nicht auf einem CDJ-2000", "cdj2000_other": "{{count}} Tracks laufen eventuell nicht auf einem CDJ-2000", "missing_one": "{{count}} Track fehlt", "missing_other": "{{count}} Tracks fehlen", "streaming_one": "{{count}} Streaming-Track kann nicht exportiert werden", "streaming_other": "{{count}} Streaming-Tracks können nicht exportiert werden", "noSpace": "Passt nicht. Es fehlen {{size}}." }
    }
  },
  "fr": {
    "commands": { "exportUsb": "Exporter vers USB…" },
    "sources": { "tree": { "exportUsb": "Exporter vers USB" } },
    "usbExport": {
      "title": "Exporter vers USB", "pill": "USB {{done}}/{{total}}", "connected": "USB {{name}} connectée", "connectedAction": "Exporter",
      "holder": { "empty": "vide", "today": "aujourd’hui {{time}}", "on": "le {{date}} {{time}}", "rekordbox": "exportée par rekordbox {{when}}", "surco": "exportée par Surco {{when}}", "other": "contient un export, {{when}}" },
      "choose": { "tick": "Cocher {{name}}", "sticks": "USB", "none": "Branche une clé USB", "other": "Autre destination…", "capacity": "{{total}} · {{free}} libres", "pick": "Coche des playlists et choisis une clé USB.", "calculating": "Calcul en cours…", "prune": "Supprimer de la clé la musique qui n’est plus exportée", "cancel": "Annuler", "export": "Exporter" },
      "summary": { "tracks_one": "{{count}} piste", "tracks_other": "{{count}} pistes", "new_one": "{{count}} nouvelle · {{size}}", "new_other": "{{count}} nouvelles · {{size}}", "kept_one": "{{count}} déjà là", "kept_other": "{{count}} déjà là", "removed_one": "{{count}} retirée depuis la dernière fois", "removed_other": "{{count}} retirées depuis la dernière fois" },
      "warnings": { "rekordboxExport": "Cette clé a été exportée par rekordbox. Sa bibliothèque est remplacée par celle-ci ; la musique déjà présente est réutilisée.", "exfat": "exFAT. Le CDJ-2000 ne le lit pas.", "gpt": "GPT. Le CDJ-2000 et les NXS2 ne le lisent pas.", "notVolumeRoot": "Les lecteurs ne lisent que la racine d’une clé USB.", "cdj2000_one": "{{count}} piste risque de ne pas jouer sur un CDJ-2000", "cdj2000_other": "{{count}} pistes risquent de ne pas jouer sur un CDJ-2000", "missing_one": "{{count}} piste est introuvable", "missing_other": "{{count}} pistes sont introuvables", "streaming_one": "{{count}} piste en streaming ne peut pas être exportée", "streaming_other": "{{count}} pistes en streaming ne peuvent pas être exportées", "noSpace": "Ça ne tient pas. Il manque {{size}}." }
    }
  },
  "pt-BR": {
    "commands": { "exportUsb": "Exportar para USB…" },
    "sources": { "tree": { "exportUsb": "Exportar para USB" } },
    "usbExport": {
      "title": "Exportar para USB", "pill": "USB {{done}}/{{total}}", "connected": "USB {{name}} conectado", "connectedAction": "Exportar",
      "holder": { "empty": "vazio", "today": "hoje {{time}}", "on": "em {{date}} {{time}}", "rekordbox": "exportado pelo rekordbox {{when}}", "surco": "exportado pelo Surco {{when}}", "other": "tem uma exportação, {{when}}" },
      "choose": { "tick": "Marcar {{name}}", "sticks": "USB", "none": "Conecte um USB", "other": "Outro destino…", "capacity": "{{total}} · {{free}} livres", "pick": "Marque playlists e escolha um USB.", "calculating": "Calculando…", "prune": "Apagar do USB a música que não é mais exportada", "cancel": "Cancelar", "export": "Exportar" },
      "summary": { "tracks_one": "{{count}} faixa", "tracks_other": "{{count}} faixas", "new_one": "{{count}} nova · {{size}}", "new_other": "{{count}} novas · {{size}}", "kept_one": "{{count}} já está", "kept_other": "{{count}} já estão", "removed_one": "{{count}} removida desde a última vez", "removed_other": "{{count}} removidas desde a última vez" },
      "warnings": { "rekordboxExport": "Este USB foi exportado pelo rekordbox. A biblioteca dele é substituída por esta; a música que já está é aproveitada.", "exfat": "exFAT. O CDJ-2000 não lê.", "gpt": "GPT. O CDJ-2000 e os NXS2 não leem.", "notVolumeRoot": "Os players só leem a raiz de um USB.", "cdj2000_one": "{{count}} faixa pode não tocar num CDJ-2000", "cdj2000_other": "{{count}} faixas podem não tocar num CDJ-2000", "missing_one": "{{count}} faixa não foi encontrada", "missing_other": "{{count}} faixas não foram encontradas", "streaming_one": "{{count}} faixa de streaming não pode ser exportada", "streaming_other": "{{count}} faixas de streaming não podem ser exportadas", "noSpace": "Não cabe. Faltam {{size}}." }
    }
  }
}
```

The holder test in Step 1 expects the Spanish surco text to read `exportado por Surco hoy 09:12`, which these keys give (`when` = `hoy 09:12`); the modal test's `exportado por rekordbox hoy` likewise.

- [ ] **Step 10: Run the renderer suite, types, lint, commit**

```bash
cd apps/desktop
node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer
cd ../..
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/renderer
git commit -m "Choose playlists and a stick for the USB export, from the tree, the palette or a notice"
```

Expected: all PASS, none skipped; no type or lint errors.

---
### Task 12: Verify on the test stick, then Vicent's checklist on his players

**Files:**
- Modify: `docs/export-usb-medidas.md` (section "Verificación")
- Scratch only: `$SCRATCH/usb-verify/`

**Interfaces:**
- Consumes: everything above, in the packaged app.
- Produces: the go or no-go for merging, written in the note.

Only the stick with Volume UUID `B10C96EF-51C2-344E-B78D-DAFC319D973E` is written. Before every step that writes, confirm it is the only removable volume mounted:

```bash
for v in /Volumes/*; do diskutil info "$v" 2>/dev/null | grep -E 'Volume UUID|Removable Media|Device Location' | tr '\n' ' '; echo " <- $v"; done
```

Expected: exactly one line with `Removable` / `External` and that UUID. Anything else: unplug it first.

- [ ] **Step 1: The packaged app ships a signed baken**

```bash
npm run build-baken --workspace apps/desktop
cd apps/desktop && npx electron-vite build && npx electron-builder --mac --dir --publish never && cd ../..
APP=$(ls -d apps/desktop/dist/mac*/Surco.app)
codesign --verify --deep --strict "$APP" && echo "bundle signature ok"
"$APP/Contents/Resources/baken/baken" expressport --help | grep -c -- '--json'
ls "$APP/Contents/Resources/baken/"
```

Expected: `bundle signature ok`, `1`, and `baken LICENSE` (plus `THIRD_PARTY_LICENSES.md` if Task 3 found it). After the next CI release, repeat `codesign -dv` on the notarized app's baken and check `flags=0x10000(runtime)` and the Developer ID authority.

- [ ] **Step 2: Snapshot what must not change**

```bash
mkdir -p "$SCRATCH/usb-verify"
find ~/Library/Pioneer -maxdepth 3 -exec stat -f '%m %z %N' {} \; | sort > "$SCRATCH/usb-verify/pioneer-before.txt"
ls -la /Volumes/Surco > "$SCRATCH/usb-verify/stick-root-before.txt"
mkdir -p "/Volumes/Surco/Mis cosas" && echo "no tocar" > "/Volumes/Surco/Mis cosas/nota.txt"
```

The `Mis cosas` folder stands for the user's own files on the stick (Global Constraints: never deleted).

- [ ] **Step 3: First export from the app**

Launch the packaged app (`open "$APP"`), with rekordbox **open** (reading must work with it running). In the rekordbox tree header press the USB button. Check, and write each in the note:
- the modal lists only `Surco`, with its capacity, `exFAT` and "exportado por rekordbox …" or what it holds;
- tick `BASES` (Makina gets ticked); the summary says 7 pistas, the warnings show exFAT (and the rekordbox one if the stick still has rekordbox's export at its root);
- Exportar: the list fills row by row, the copying row's waveform reveals left to right, MB/s and time left move, Cancelar is replaced by "Terminando…" at the end;
- press "Seguir en segundo plano" mid-copy: the modal closes, the pill `USB n/7` and the top line move, and the "Listo" notice appears at the end;
- time it, as the spike did (4.9 s from the NAS for 459 MB).

- [ ] **Step 4: Validate the stick with the independent readers**

The spike's validators read the stick (read-only):

```bash
cd "$SCRATCH/usb-spike"
node tools/tsx/node_modules/tsx/dist/cli.mjs validate/validate_pdb.ts /Volumes/Surco
./venv/bin/python -I validate/rekordcrate_all.py /Volumes/Surco
./venv/bin/python -I validate/validate_anlz_onelib.py /Volumes/Surco
./venv/bin/python -I phase2/slot_colors.py /Volumes/Surco
node tools/tsx/node_modules/tsx/dist/cli.mjs "$SCRATCH/usb-plan/pvdi-check.ts" "$SCRATCH/usb-spike/rekordbox-baseline" /Volumes/Surco
ls /Volumes/Surco/PIONEER/Artwork/00001 | wc -l
cat "/Volumes/Surco/Mis cosas/nota.txt"
```

Expected (each script prints its own verdict; if a path argument differs, read its head and pass the stick the way it expects):
- `PDB VALID`, BASES/Makina with 7 tracks in order; rekordcrate parses every ANLZ; pyrekordbox opens OneLibrary with 7 entries;
- `slot_colors.py` prints, for letters 1..6, code 0 and exactly rekordbox's RGB (`(0, 0, 255, 0, 23)`, `(0, 0, 0, 196, 255)`, …), the same as on `rekordbox-baseline`;
- `PVDI equal to rekordbox 7, different 0`;
- 28 artwork files (7 tracks × 4) instead of the spike's 8;
- `no tocar`.

- [ ] **Step 5: Second export, incremental, and the memory**

Close and reopen the modal: `Surco` is preselected and `BASES` ticked. The summary reads `0 nuevas` and `7 ya están`. Export: it takes about a second, every row says "ya estaba". Then tick one more small playlist: only its tracks are new; export. Then untick it: the summary says "N quitadas desde la última vez"; export with the prune box **off**: those files are still in `Contents/` (`find /Volumes/Surco/Contents -newer "$SCRATCH/usb-verify/stick-root-before.txt" | wc -l`), and the stick's database no longer lists the playlist (rerun `validate_pdb.ts`).

- [ ] **Step 6: Failure paths**

- Cancel during copy (a playlist with a large WAV not yet on the stick): "Cancelado…", and `validate_pdb.ts` still shows the previous library.
- Unplug during copy (same kind of playlist): "El USB se desconectó…"; nothing is written to `/Volumes/Surco` on the Mac's disk (`ls /Volumes` shows no leftover `Surco` folder); plug back in and export: it completes and `validate_pdb.ts` is valid.
- Rename the stick in Finder to `Vicent`, plug a second stick also named `Vicent` only if one is available and empty: the modal shows two rows; writing goes to the UUID chosen. (Skip, and say so in the note, if no second stick is available.)

- [ ] **Step 7: Nothing of rekordbox's changed**

```bash
find ~/Library/Pioneer -maxdepth 3 -exec stat -f '%m %z %N' {} \; | sort > "$SCRATCH/usb-verify/pioneer-after.txt"
diff "$SCRATCH/usb-verify/pioneer-before.txt" "$SCRATCH/usb-verify/pioneer-after.txt" && echo "~/Library/Pioneer untouched by Surco"
```

Expected: no diff, or only files rekordbox itself writes while open (`master.db-wal`, `master.db-shm`, logs); list any other line in the note and stop if one is Surco's doing.

- [ ] **Step 8: Vicent's hardware checklist**

Hand Vicent the stick with BASES/Makina exported by Surco, and this list (CDJ-3000X and XDJ-AZ first, then CDJ-3000; the CDJ-2000 needs a FAT32/MBR stick, exported the same way):

1. El USB aparece y se navega sin cuelgues ni mensajes.
2. PLAYLIST › BASES › Makina con las 7 pistas en este orden: Hands Of Fate, Dehlia, Fly On The Wings Of Love, Children, Poem Without Words, No Fear, Jumpen.
3. Onda en color y, en 3000/3000X/XDJ-AZ, la vista de 3 bandas.
4. Rejilla en los golpes, sobre todo Hands Of Fate (cambio de tempo a los 50 s).
5. Hot cues en su letra (Poem Without Words A..F, No Fear A..C) y **del mismo color que en el USB de rekordbox**.
6. Memory cues en la onda (Poem Without Words, 9).
7. Clave y BPM como rekordbox (Hands Of Fate 1A, 154).
8. **Carátula en las 7 pistas.**
9. **Zonas de voz** en la onda (3000X, XDJ-AZ) iguales que con el USB de rekordbox.
10. Búsqueda por título y por artista ("K-Style").
11. Suena de principio a fin y el salto a hot cue cae en su sitio.
12. Exportar desde Surco una playlist más al mismo USB: tarda segundos y el equipo ve las dos.
13. Si algo falla, modelo, firmware y foto de la pantalla.

- [ ] **Step 9: Write the verdict and commit**

Add to `docs/export-usb-medidas.md` a section "Verificación (fecha)" with the times of Steps 3 and 5, each Step's expected-versus-seen, the hardware answers per model and firmware, and the verdict. Any failed check is a bug to fix (with its red test) before merging, not a note.

```bash
git add docs/export-usb-medidas.md
git commit -m "Record the USB export's verification on the test stick and the players"
```
