# Export rekordbox playlists to a USB stick, fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From Surco on macOS or Windows, the DJ ticks rekordbox playlists (or whole folders), picks a removable stick identified by a stable volume identifier, and presses Exportar: Surco reads `master.db` read-only, prepares baken's input, and a bundled, patched `baken expressport` writes a stick every CDJ and XDJ reads (Device Library + OneLibrary), copying only what changed, with a per-track progress list whose waveforms fill as the bytes land.

**Architecture:** The main process reads the selection from `master.db` (`usbExportSource.ts`), stages a work folder with the XML, the analysis files (PVDI masked as rekordbox does), the artwork per TrackID and, when asked, the My Settings (`usbExportStage.ts`, `bakenXml.ts`, `anlz.ts`), and drives baken through its new `--json` line protocol (`bakenRun.ts`): a dry run for the summary, and for an export a dry run (root and space checks) and then the real run, after re-checking the volume identity and while watching it (`usbExport.ts`). Removable volumes come from `diskutil` on macOS and a PowerShell query on Windows (`usbVolumes.ts`, `windowsVolumes.ps1`); a per-stick memory lives in `usb-exports.json` (`usbExportMemory.ts`). The renderer has one modal with two faces, choosing (tree with checkboxes, stick chooser, summary) and exporting (the track list with the revealing waveforms), and the export's state lives in a store outside React so a progress tick repaints only what reads it (the row, the pill, the top line).

**Tech Stack:** Electron + React 19 + TS, Tailwind v4, lucide-react, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), biome; Rust (cargo, pinned toolchain) only for the baken patch series; PowerShell (Windows only, at run time).

**Spec:** `docs/superpowers/specs/2026-10-16-export-usb-design.md`, and the spike findings it rests on (copied to `docs/export-usb-medidas.md` in Task 1).

**Platform:** macOS and Windows (x64). On Linux nothing of this appears (no button, no command, no notice; the IPC answers "unsupported").

**Out of scope:** Linux, Windows arm64, porting baken to TS, formatting the stick, `--cdjsafe`, protecting a rekordbox stick, My Tag / `exportExt.pdb`, hand-assigned hot cue colours (exported with their letter's default), exporting from Engine/Traktor/the working list, two exports at once, opening pull requests upstream (Vicent decides; Task 2 only drafts them).

## Global Constraints

- **The session scratchpad is pinned**: every command uses `SCRATCH=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad` (it holds the spike: `usb-spike/` with the Rust toolchain, `tsx`, the validators, the analysis copies and `rekordbox-baseline/`). Export it at the start of every task. If `$SCRATCH/usb-spike` is gone (reboot), stop and report: Tasks 2, 4 and 12 rest on it.
- **Never write anything under the rekordbox data folder** (`~/Library/Pioneer` on macOS, `%APPDATA%\Pioneer` on Windows) and never point baken at it: baken always gets `--anlz-dir` (Surco's staged copy) and `--settings-dir` (staged copy) or `--no-settings`. `bakenArgs` refuses a device or a staged path inside that folder, the home folder itself, or the system root (`/`, `%SystemDrive%\`). `master.db` is opened with `{ readonly: true }` only, through `openRekordboxDb`.
- **Never write a volume that is not the selected one.** A volume target is resolved by its stable identifier (macOS `VolumeUUID`, Windows volume GUID) to its mount point or drive root, asked again right before baken is spawned (a different or missing identifier writes nothing: `volume-changed` / `volume-gone`), and its `stat(root).dev` is recorded and polled every second during the run (a change or a failed stat cancels the export). Volumes are never matched by name or drive letter alone. A volume target that baken's plan reports as not a volume root is refused (`not-volume-root`).
- **Folder targets ("Otro destino")** must resolve (`realpath`) inside a listed removable volume, else `not-removable`; `--prune` is never passed for a folder target.
- **Never delete user files.** Surco itself deletes nothing on the stick. baken writes only `PIONEER/` and `Contents/` at the volume root; `--prune` (removes unreferenced files only inside `Contents/`, `PIONEER/USBANLZ/`, `PIONEER/Artwork/`) is passed only for a volume target and only when the user ticked "Borrar del USB la música que ya no se exporta", which defaults to off.
- **My Settings are opt-in**: `--settings-dir` only when the request's `settings` is true (checkbox "Copiar My Settings", off by default, remembered per stick); otherwise `--no-settings`.
- **Single flight**: `start()` claims the export synchronously before its first `await` and releases it on every early return; the renderer's Exportar is disabled while a start is pending. One export at a time.
- **Space before writing**: every export runs baken's dry run first and refuses (`no-space`, with needed and free bytes) when `spaceNeeded > spaceAvailable`, or when baken reports `not-enough-space`.
- **Cancel only at a track boundary**: Surco writes `cancel\n` to baken's stdin (patch 0003; SIGINT/SIGTERM also handled on macOS) and waits for baken's report; it never kills baken. No audio file referenced by the previous export is ever left truncated. Cancel is not offered from the `database` event on (cutting between `export.pdb` and `exportLibrary.db` would leave two different libraries).
- **Tests never touch a real stick, a real `master.db`, `~/Library`, `%APPDATA%` or the real baken.** Main tests use the encrypted fixtures, injected filesystem and holder functions, and a fake runner. Verification (Task 12) uses only the test stick with Volume UUID `B10C96EF-51C2-344E-B78D-DAFC319D973E`, after checking that no other removable volume is mounted.
- baken is pinned: upstream tag `v4.6.1` (commit `c97435a978cafb949ee052afbd6ea9b7bff6fd0b`), Rust toolchain from `apps/desktop/vendor/baken/RUST_TOOLCHAIN`, plus `apps/desktop/vendor/baken/patches/*.patch`, built from that source by `scripts/build-baken.mjs` on each build machine (CI and local) into `apps/desktop/resources/baken/` (`baken`, or `baken.exe` on Windows x64). Nothing is published to `surco-releases` (an extra release there would be seen by the website and the updater). Spawned with `BAKEN_NO_UPDATE_CHECK=1`.
- baken's JSON line protocol (stdout, one object per line, produced by patch 0003) is the only interface Surco reads; its human output is never parsed:
  - `{"event":"plan","volumeRoot":bool,"tracks":[{"id":N,"usbPath":"/Contents/..","size":N,"onStick":bool}],"spaceNeeded":N,"spaceAvailable":N|null,"warnings":[".."],"skipped":[{"name":"..","reason":".."}],"onelibraryFiles":[".."]}`
  - `{"event":"start","index":N,"usbPath":"..","size":N}`, `{"event":"written","index":N,"kept":bool}`, `{"event":"failed","index":N,"message":".."}`, `{"event":"database"}`
  - `{"event":"report","copied":N,"kept":N,"failures":[{"name":"..","message":".."}],"cancelled":bool,"onelibraryWritten":bool,"onelibraryError":".."|null,"artwork":N,"pruned":N,"tracksInDatabase":N}`
  - `{"event":"error","kind":"not-enough-space"|"device-write"|"device-not-found"|"other","message":"..","needed":N?,"available":N?}`
  - stdin: a line `cancel` asks baken to stop before the next track.
- baken's English texts (failure messages, skip reasons) never reach the UI: Surco maps them to codes (`missing-file`, `unreadable`, `device`, `skipped`) and logs the raw text with `electron-log`.
- No count in the UI includes separators (summary, `7 / 12`, pill, done notice).
- Hot cue letters from `djmdCue.Kind`: 0 memory cue (`Num -1`), 1..3 → A..C (`Num` 0..2), 5..9 → D..H (`Num` 3..7), 4 never used (measured on Vicent's collection, 16/10). Hot cues go to the XML without colour; patch 0001 gives them rekordbox's default for their letter.
- PVDI masking (measured exact on 5 of 5 tracks, 16/10): for a `PVDI` section longer than 24 bytes whose byte 12 lacks `0x80`, set `0x80` in byte 12 and XOR every byte from offset 24 with `1e dd 1e 19 02 19 1b 11 19 23 18 19 24 11 fb 11 1e 2a 15` cycling from the section's byte 24. A `.2EX` with no `PVDI` gets the empty one appended, `50564449 00000018 00000018 00000400 56220001 00000000`, and the `PMAI` total length (u32 big-endian at offset 8) grows by 24.
- Paths: every main-process function that builds or compares paths takes the platform (or a `path.posix`/`path.win32` module) so the Windows paths (`E:\`, `C:\Users\dj\AppData\Roaming\Pioneer`) are tested on any runner; Windows comparisons are case-insensitive.
- UI text in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`); no em dash and no explanatory colons in any UI text. Errors cross IPC as reason codes and are translated in the renderer.
- Test selectors: `data-testid` always.
- Comments: the repo documents the WHY in comments on nearly every block (see `rekordboxPlaylists.ts`). Follow that repo convention, which conflicts with the global "zero comments" rule; conformance with the existing code wins (ruled on 15/10 for this branch), flagged here so nobody "fixes" it.
- Tests from `apps/desktop` of the worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (never filter from the repo root, it skips the setup). Types from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit` and `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` (bare `tsc` checks nothing). Lint and format: `npm exec --workspace apps/desktop -- biome check --write src`. Anything that packages the app (Tasks 3 and 12) runs `npm ci` in the worktree first, so `electron-vite`/`electron-builder` and the production dependencies come from the lockfile.
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

(Measured: the five locale files round-trip byte for byte through `JSON.stringify(data, null, 2) + '\n'`.)

- Commits: descriptive English title, no body, no `feat:`. One per task unless the task says otherwise.

## Decisions taken where the spec or the request left room

1. **baken is patched and built by Surco, not used as published.** Progress, the "ya estaba" state, cancelling at a track boundary, rekordbox's default hot cue colours and the cached artwork cannot be had from outside: baken's human output is an `indicatif` bar that disappears off a TTY, its CLI never triggers its own cancel token, and artwork lives in `export.pdb` tables. Three small patches; Task 2 drafts their upstream PRs in `docs/baken-upstream-prs.md` and opens nothing.
2. **Cancel is a request on stdin, not a signal.** A Windows child process gets no SIGINT; a stdin line works on both platforms, and baken then stops between tracks, so no audio over a file the old export references is ever truncated (baken's `copy_audio` writes in place).
3. **PVDI is masked in Surco's staged copy, not by a baken patch and not after baken.** baken copies `.2EX` verbatim apart from the path. Patching the stick afterwards would make baken's byte comparison rewrite every analysis file on every export, the slow part on FAT32.
4. **Unreferenced music stays by default** (`--prune` only on request, never for a folder target).
5. **The per-stick memory is its own file** (`usb-exports.json` in userData), keyed `volume:<id>` or `folder:<realpath>`; it also remembers the prune and My Settings boxes.
6. **Who wrote the stick**: `exportExt.pdb` present means rekordbox; otherwise `export.pdb` with the size and mtime (±2 s, FAT's resolution) Surco remembered means Surco; no `export.pdb` means empty; anything else is "tiene una exportación" with its date.
7. **The analysis files are staged fresh for every summary and every export**, only for the selected tracks; Task 1 measures the cost; the summary waits 300 ms after the last tick.
8. **Summary and export both use baken's dry run**, so "X nuevas", the root check and the space check are baken's own judgement. When baken refuses the plan for space, the summary is built from Surco's selection with every track new and `noSpace` (needed, free).
9. **Per-track bytes come from polling the destination file** every 250 ms (baken writes the audio in place in 4 MB pieces), only for tracks the plan says are not on the stick; the volume's `dev` is polled every second on both platforms.
10. **Windows volumes**: one PowerShell script (`Win32_Volume` plus `Get-Partition | Get-Disk`), shipped as `src/main/windowsVolumes.ps1` and imported with Vite's `?raw`, so the CI Windows job can run the very same file. Identifier = volume GUID (`\\?\Volume{…}\`); removable = has a letter, not system/boot, `DriveType` 2 or `BusType` USB. Live updates poll the set of existing drive letters every 2 s and rerun the script on change. NTFS gets a warning (players do not read it).
11. **The export's renderer state lives in a store outside React** (`lib/usbExportStore.ts`, `useSyncExternalStore` with narrow selectors). App subscribes only to the phase (for notices); the row, the progress view, the pill and the top line read their own slice.
12. **CDJ-2000 warnings** are FLAC (`FileType` 5), more than 24 bits or more than 48 kHz, from `djmdContent`.
13. **The modal's waveform** is rekordbox's `PWAV` preview from the local `.DAT`, reduced to 100 bars; Task 10 measures it with 500+ rows and, if it costs, switches each row to a thin progress line (Vicent's ruling).
14. **`escapeXml` moves from `renderer/src/lib/xml.ts` to `shared/xml.ts`** so the main process can use it.
15. **Separators are exported as tracks** but never counted.
16. **baken is compiled inside each platform's build, not downloaded**, with a pinned Rust toolchain and the patch tests run in CI.

## Review Focus

1. **Two sticks with the same name, a stick swapped between the summary and the export, or another stick taking the same drive letter.** The export goes to the identifier chosen or nowhere, and a `dev` change mid-run cancels it. Pinned in Task 8 (volumes keyed by identifier, `uuidAt` on both platforms) and Task 9 (`volume-changed`, nothing spawned; `dev` change cancels).
2. **Exportar pressed twice quickly.** One baken, one export. Pinned in Task 9 (two concurrent `start()` calls) and Task 11 (button disabled while starting).
3. **Closing the modal mid-export, Cancel while a big WAV copies, Cancel during the database phase.** Closing never stops baken; Cancel asks baken over stdin and waits for its report; after `database` there is no Cancel. Pinned in Task 2 (cargo test: cancel leaves no partial audio, no `export.pdb`), Task 7 (stdin), Task 9 (exporter) and Task 10 (view).
4. **A folder chosen as "Otro destino" on the system disk, or a stick mounted below its root.** Refused before anything runs; prune never applies to folders. Pinned in Task 7 (args) and Task 9 (exporter).
5. **A track whose file is gone or whose NAS is asleep, a streaming row, a track baken skips, a track without analysis.** Each is listed with its reason in the summary and left out; the rest exports; a track without analysis still exports with a flat bar. Pinned in Task 7 (stage), Task 9 (`unexportable`) and Task 10 (flat bar).

---

## File structure

| File | Responsibility |
|---|---|
| `docs/export-usb-medidas.md` (new, Task 1) | the spike's measured facts, the columns and counts measured on the collection, diskutil shapes, staging cost |
| `docs/baken-upstream-prs.md` (new, Task 2) | the three PR drafts, for Vicent to send or not |
| `apps/desktop/src/main/fixtures/diskutil-*.plist`, `win32-volumes.json` (new, Tasks 1, 8) | real `diskutil` outputs (trimmed) and a PowerShell output for the volume tests |
| `apps/desktop/vendor/baken/` (new, Task 2) | `UPSTREAM`, `RUST_TOOLCHAIN`, `patches/`, `LICENSE`, `THIRD_PARTY_LICENSES.md` |
| `scripts/build-baken.mjs` (new, Task 3) | clones the pinned tag, applies the patches, tests and builds for this machine into `apps/desktop/resources/baken/` |
| `.github/workflows/release.yml`, `build-test.yml`, `ci.yml` (mod, Task 3) | build baken (cargo cache) before packaging; a signed and notarized macOS test build; a Windows job for the USB tests and the PowerShell script |
| `apps/desktop/electron-builder.yml`, `.gitignore`, `README.md` (mod, Task 3) | ship the binary and its licences |
| `src/main/bakenPath.ts` (new, Task 3) | where the binary is, packaged or not, per platform |
| `src/main/anlz.ts` (new, Task 4) | ANLZ sections, `PQTZ` grid, `PWAV` preview, `PVDI` mask |
| `src/main/rekordboxExportFixture.ts` (new, Task 5) | the encrypted fixture with the columns and tables export reads |
| `src/main/rekordboxPlaylists.ts` (mod, Task 5) | exports `LIVE_LINK` |
| `src/main/usbExportSource.ts` (new, Task 5) | the selection read from `master.db` |
| `src/shared/xml.ts` (moved, Task 6) | `escapeXml` for both processes |
| `src/main/bakenXml.ts` (new, Task 6) | baken's input XML, macOS and Windows locations |
| `src/main/usbExportStage.ts` (new, Task 7) | the work folder |
| `src/main/bakenRun.ts` (new, Task 7) | arguments with guards, JSON line parser, spawn, cancel over stdin |
| `src/main/usbVolumes.ts`, `src/main/windowsVolumes.ps1` (new, Task 8) | plist and PowerShell parsing, removable filters, holder, list and watch per platform |
| `src/main/usbExportMemory.ts` (new, Task 8) | `usb-exports.json` |
| `src/main/usbExport.ts` (new, Task 9) | summary, checks, export, progress, cancel, memory |
| `src/main/usbExportIpc.ts` (new, Task 9) | IPC handlers and the lazy volume watch |
| `src/main/index.ts` (mod, Task 9) | wiring |
| `src/shared/types.ts` (mod, Tasks 8-9) | `UsbVolume`, `UsbTarget`, `UsbPlan`, `UsbExportEvent`… |
| `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (mod, Task 9) | the calls and their stubs |
| `src/renderer/src/lib/usbExport.ts`, `lib/usbExportStore.ts` (new, Task 10) | progress reducer, speed and time left, waveform path; the store |
| `src/renderer/src/components/TrackWave.tsx`, `ExportTrackRow.tsx`, `UsbExportProgress.tsx`, `UsbExportPill.tsx`, `UsbTopProgress.tsx` (new, Task 10) | the exporting face and its background views |
| `src/renderer/src/components/CheckTree.tsx`, `UsbExportModal.tsx` (new, Task 11) | the choosing face |
| `src/renderer/src/hooks/useUsbVolumes.ts`, `useUsbPlan.ts` (new, Task 11) | live state |
| `src/renderer/src/components/SourceTree.tsx`, `Toolbar.tsx`, `lib/commands.ts`, `App.tsx` (mod, Task 11) | the entry points, the pill slot, the connect notice |
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
export SCRATCH=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad
test -d "$SCRATCH/usb-spike" || { echo "spike folder gone: stop and report"; exit 1; }
mkdir -p "$SCRATCH/usb-plan"
cp ~/Library/Pioneer/rekordbox/master.db "$SCRATCH/usb-plan/master.db"
[ -f ~/Library/Pioneer/rekordbox/master.db-wal ] && cp ~/Library/Pioneer/rekordbox/master.db-wal "$SCRATCH/usb-plan/master.db-wal"
[ -f ~/Library/Pioneer/rekordbox/master.db-shm ] && cp ~/Library/Pioneer/rekordbox/master.db-shm "$SCRATCH/usb-plan/master.db-shm"
pgrep -x rekordbox >/dev/null && echo "rekordbox OPEN while copying" || echo "rekordbox closed while copying"
cp "$SCRATCH/usb-spike/findings.md" "$SCRATCH/usb-plan/findings.md"
```

- [ ] **Step 2: Measure the columns and the cue counts**

```bash
cat > "$SCRATCH/usb-plan/measure.cjs" <<'EOF'
const Database = require('/Users/vicent/code/surco/node_modules/better-sqlite3-multiple-ciphers')
// The scratch copy is opened read-write: a read-only open of a WAL database can fail when the
// -shm is missing, and this is a copy, never the collection.
const db = new Database(process.argv[2])
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
diskutil info -plist / | grep -c '<key>'
cat > src/main/fixtures/diskutil-internal.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>BusProtocol</key>
	<string>Apple Fabric</string>
	<key>Ejectable</key>
	<false/>
	<key>FilesystemType</key>
	<string>apfs</string>
	<key>Internal</key>
	<true/>
	<key>MountPoint</key>
	<string>/</string>
	<key>RemovableMediaOrExternalDevice</key>
	<false/>
	<key>VolumeName</key>
	<string>Macintosh HD</string>
	<key>VolumeUUID</key>
	<string>00000000-0000-0000-0000-000000000001</string>
</dict>
</plist>
PLIST
/usr/libexec/PlistBuddy -c 'Print :Content' src/main/fixtures/diskutil-usb-whole.plist
diskutil info -plist /Volumes/Public; echo "exit $?"
```

The internal disk's fixture is written by hand with only the keys the filter reads and a dummy UUID: the real one carries this Mac's disk and volume identifiers, which do not belong in the repo (check the values above match what `diskutil info -plist /` printed for those keys). Expected: the UUID line prints `B10C96EF-51C2-344E-B78D-DAFC319D973E`; `Content` prints `FDisk_partition_scheme` (MBR) or `GUID_partition_scheme`; the NAS share answers `Could not find disk` with exit 1 (so network volumes fall out without a special case). Write down `Internal`, `RemovableMediaOrExternalDevice`, `Ejectable`, `BusProtocol`, `FilesystemType`, `FilesystemName`, `FreeSpace`, `TotalSize` of the stick in the note. If `Internal` is not `false` or both `RemovableMediaOrExternalDevice` and `Ejectable` are not `true`, stop: Task 8's filter rests on them.

- [ ] **Step 4: Measure the staging cost**

Copy the `.DAT/.EXT/.2EX` of the first 500 analysed tracks to a scratch folder and time it (this is what every summary does in Decision 6):

```bash
cat > "$SCRATCH/usb-plan/stage-cost.cjs" <<'EOF'
const fs = require('node:fs'), path = require('node:path')
const Database = require('/Users/vicent/code/surco/node_modules/better-sqlite3-multiple-ciphers')
const db = new Database(process.argv[2])
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
rm -f "$SCRATCH/usb-plan/master.db" "$SCRATCH/usb-plan/master.db-wal" "$SCRATCH/usb-plan/master.db-shm"
git add docs/export-usb-medidas.md apps/desktop/src/main/fixtures/diskutil-usb-exfat.plist apps/desktop/src/main/fixtures/diskutil-usb-whole.plist apps/desktop/src/main/fixtures/diskutil-internal.plist
git commit -m "Record the measured facts behind the USB export"
```

---
### Task 2: The baken patch series (default hot cue colours, artwork folder, JSON lines with cancel)

**Files:**
- Create: `vendor/baken/UPSTREAM`, `vendor/baken/RUST_TOOLCHAIN`, `vendor/baken/LICENSE`, `vendor/baken/THIRD_PARTY_LICENSES.md`, `vendor/baken/patches/0001-default-hot-cue-colours.patch`, `vendor/baken/patches/0002-artwork-dir.patch`, `vendor/baken/patches/0003-json-lines.patch`
- Create: `docs/baken-upstream-prs.md` (drafts only; nothing is sent)
- Scratch only: `$SCRATCH/baken-build/` (a clone of baken where the patches are written and tested)

**Interfaces:**
- Consumes: Task 1's note (if hot cues G or H exist in the collection, their default colours must be measured before patch 0001 is final; otherwise it ships A..F as below).
- Produces: `baken expressport --json` speaking exactly the protocol in Global Constraints, including `volumeRoot` in the plan and a `cancel` line on stdin (SIGINT/SIGTERM too on Unix) that stops the export between tracks; `--artwork-dir DIR` reading `<TrackID>.jpg|.jpeg|.png`; hot cues without an XML colour written as code 0 + their letter's RGB (A..F). Task 3 builds these; Tasks 7 and 9 consume the protocol.

The toolchain the spike installed works here (it has no default toolchain set, hence `RUSTUP_TOOLCHAIN`); if it is gone, install the same version into the scratchpad with rustup:

```bash
export SCRATCH=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad
export CARGO_HOME="$SCRATCH/usb-spike/tools/cargo" RUSTUP_HOME="$SCRATCH/usb-spike/tools/rustup" RUSTUP_TOOLCHAIN=stable
export PATH="$CARGO_HOME/bin:$PATH"
cargo --version || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain 1.99.1
rustc --version
```

Expected: `rustc 1.99.1 (58cf8f9c3 2026-10-13)` (what the spike installed, 16/10). That version is what `vendor/baken/RUST_TOOLCHAIN` pins in Step 10.

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

and in its doc comment replace the sentence `A hot cue without a colour in the XML gets the same.` (it wraps over two comment lines in the source, `/// the XML gets the same.` ending the second) with `A hot cue without a colour in the XML gets rekordbox's default for its letter ([`LETTER_DEFAULTS`]).`

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

struct CancelAfterFirst(CancelToken);

impl Progress for CancelAfterFirst {
    fn on_file_done(&self, _done: usize, _total: usize, _file: &Path) {}
    fn on_track(&self, event: TrackEvent<'_>) {
        if let TrackEvent::Written { index: 0, .. } = event {
            self.0.cancel();
        }
    }
}

/// A front-end's cancel lands between tracks: the track being copied is finished whole, the
/// next one is never started, and export.pdb is not written. Killing the process instead
/// could leave a half-written audio file over one the stick's previous library points at
/// (copy_audio writes in place).
#[test]
fn a_cancel_stops_before_the_next_track_and_writes_no_database() {
    let (root, opts) = library("cancel");
    let token = CancelToken::new();
    let report = export(&plan(&opts).unwrap(), &CancelAfterFirst(token.clone()), &token).unwrap();
    assert!(report.cancelled);
    let source = std::fs::metadata(root.join("music/cover.aif")).unwrap().len();
    let copied = std::fs::metadata(opts.device.join("Contents/A/B/cover.aif")).unwrap().len();
    assert_eq!(copied, source, "the track in progress is complete");
    assert!(!opts.device.join("Contents/A/B/plain.aif").exists());
    assert!(!opts.device.join("PIONEER/rekordbox/export.pdb").exists());
    std::fs::remove_dir_all(&root).unwrap();
}
```

The cancel test passes as soon as the events exist (the export loop already checks the token before each track); it pins the guarantee Surco relies on, so a later baken that cancels mid-copy breaks this test, not a stick.

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

`crates/baken/Cargo.toml`, under `[dependencies]`: `serde_json.workspace = true`, and a new section:

```toml
[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

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
use std::io::{BufRead, Write};
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
    let token = CancelToken::new();
    cancel_on_request(&token);
    match export(&plan, &JsonProgress, &token) {
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
        "event": "plan", "volumeRoot": plan.volume_root, "tracks": tracks,
        "spaceNeeded": plan.space_needed,
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

/// Cancels `token` when the front-end asks: a line `cancel` on stdin, which works on every
/// platform (a Windows child process gets no SIGINT), or SIGINT/SIGTERM on Unix. The export
/// checks the token between tracks, so the track being copied always finishes and no audio
/// file is left half-written. stdin closing (the front-end gone) is not a cancel.
fn cancel_on_request(token: &CancelToken) {
    let on_line = token.clone();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            match line {
                Ok(l) if l.trim() == "cancel" => {
                    on_line.cancel();
                    break;
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });
    #[cfg(unix)]
    cancel_on_signals(token.clone());
}

#[cfg(unix)]
fn cancel_on_signals(token: CancelToken) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static STOP: AtomicBool = AtomicBool::new(false);
    // Only an atomic store in the handler: nothing else is async-signal-safe.
    extern "C" fn on_signal(_: libc::c_int) {
        STOP.store(true, Ordering::SeqCst);
    }
    unsafe {
        libc::signal(libc::SIGINT, on_signal as usize as libc::sighandler_t);
        libc::signal(libc::SIGTERM, on_signal as usize as libc::sighandler_t);
    }
    std::thread::spawn(move || loop {
        if STOP.load(Ordering::SeqCst) {
            token.cancel();
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    });
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
git add -A && git commit -m "Report each track as JSON lines with --json and cancel between tracks on request"
```

- [ ] **Step 9: Check the protocol end to end on the spike's data**

The spike's XML and analysis copies are in `$SCRATCH/usb-spike` (Makina, 7 tracks). The XML's `Location`s are on the NAS: `/Volumes/Public` must be mounted (`ls /Volumes/Public` lists the share), or every track is skipped. The device is a scratch folder, never a stick.

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

Then the cancel, on a fresh folder (the first WAV takes long enough from the NAS that the line arrives during it):

```bash
rm -rf "$SCRATCH/baken-build/fake-usb-cancel" && mkdir -p "$SCRATCH/baken-build/fake-usb-cancel"
( sleep 0.3; echo cancel ) | BAKEN_NO_UPDATE_CHECK=1 "$B" expressport "$SCRATCH/usb-spike/phase2/collection2.xml" \
  --device "$SCRATCH/baken-build/fake-usb-cancel" --anlz-dir "$SCRATCH/usb-spike/anlz-src/USBANLZ" \
  --no-settings --onelibrary --artwork --generate-analysis --device-name "" --json | tail -1
ls "$SCRATCH/baken-build/fake-usb-cancel/PIONEER/rekordbox/export.pdb" 2>&1 | tail -1
```

Expected: the dry run prints exactly one `plan` line with `"volumeRoot":false` (a scratch folder is not a volume root) and 7 tracks, all `"onStick":false`; `run1.jsonl` has `plan`, 7 × (`start`, `written` with `"kept":false`), `database`, `report` with `"tracksInDatabase":7`, every line valid JSON (`node -e 'require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").forEach(l=>JSON.parse(l))' "$SCRATCH/baken-build/run1.jsonl"` prints nothing); the third run prints `7`; the cancelled run's last line is a `report` with `"cancelled":true` and fewer than 7 `written` before it, and there is no `export.pdb` (`No such file or directory`).

- [ ] **Step 10: Export the series into Surco and commit**

From the worktree root:

```bash
rm -rf "$SCRATCH/baken-patches" && git -C "$SCRATCH/baken-build" format-patch -3 --zero-commit --no-signature -o "$SCRATCH/baken-patches"
mkdir -p apps/desktop/vendor/baken/patches
cp "$SCRATCH"/baken-patches/0001-*.patch apps/desktop/vendor/baken/patches/0001-default-hot-cue-colours.patch
cp "$SCRATCH"/baken-patches/0002-*.patch apps/desktop/vendor/baken/patches/0002-artwork-dir.patch
cp "$SCRATCH"/baken-patches/0003-*.patch apps/desktop/vendor/baken/patches/0003-json-lines.patch
cp "$SCRATCH/baken-build/LICENSE" apps/desktop/vendor/baken/LICENSE
# The dependency licences are generated in baken's release job (cargo about), not kept in its
# source tree: take the v4.6.1 release's file the spike downloaded with the official binary.
cp "$SCRATCH/usb-spike/tools/baken/THIRD_PARTY_LICENSES.md" apps/desktop/vendor/baken/THIRD_PARTY_LICENSES.md
printf '1.99.1\n' > apps/desktop/vendor/baken/RUST_TOOLCHAIN
printf 'https://github.com/M-Igashi/baken\nv4.6.1\nc97435a978cafb949ee052afbd6ea9b7bff6fd0b\n' > apps/desktop/vendor/baken/UPSTREAM
rm -rf "$SCRATCH/baken-check" && git clone -q --branch v4.6.1 https://github.com/M-Igashi/baken "$SCRATCH/baken-check"
git -C "$SCRATCH/baken-check" am -q "$PWD"/apps/desktop/vendor/baken/patches/*.patch && git -C "$SCRATCH/baken-check" log --oneline -4
```

Expected: `git am` applies all three on a clean `v4.6.1` and the log shows them on top of `c97435a`.

- [ ] **Step 11: Draft the upstream pull requests, send nothing**

Opening pull requests on someone else's public repository speaks for Vicent: that is his call. Write `docs/baken-upstream-prs.md` (English, it is for baken's author) with one section per patch: a title, a body that says what changes and why, the measurement behind it (rekordbox 7.2.19's export of 16/10/2026 for the colours, the WAV covers rekordbox keeps in its cache for the artwork folder, the front-end use case and the cancel guarantee for the JSON lines), the tests the patch adds, and the patch file name. Start the file with one line in Spanish for Vicent: "Borradores. No se ha enviado nada; los envías tú si quieres." Do not run `gh`, do not push anywhere.

```bash
git add apps/desktop/vendor/baken docs/baken-upstream-prs.md
git commit -m "Add the baken patch series Surco builds"
```

Merging upstream is not a condition for this plan.

---
### Task 3: Build and ship baken with Surco (macOS and Windows), and find it at run time

**Files:**
- Create: `scripts/build-baken.mjs`
- Create: `src/main/bakenPath.ts`, `src/main/bakenPath.test.ts`
- Modify: `apps/desktop/package.json` (script `build-baken`), `apps/desktop/electron-builder.yml` (`extraResources`), `.gitignore`, `.github/workflows/release.yml`, `.github/workflows/build-test.yml`, `README.md`

**Interfaces:**
- Consumes: `apps/desktop/vendor/baken/{UPSTREAM,RUST_TOOLCHAIN,patches/*.patch,LICENSE,THIRD_PARTY_LICENSES.md}` (Task 2).
- Produces: `bakenPath(env: BakenEnv): string | null` and `bakenCommand(env): { file: string; prefixArgs: string[] } | null` (Tasks 7 and 9). `null` means "no baken on this platform" (Linux) or "not built".

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
import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bakenCommand, bakenPath } from './bakenPath'

const mac = { resourcesPath: '/Applications/Surco.app/Contents/Resources', appPath: '/dev/surco/apps/desktop', exists: () => true }
const win = { resourcesPath: 'C:\\Program Files\\Surco\\resources', appPath: 'C:\\dev\\surco\\apps\\desktop', exists: () => true }

describe('bakenPath', () => {
  // electron-builder copies resources/baken next to app.asar (extraResources), outside the
  // archive: a binary inside app.asar cannot be executed, which is why ffmpeg is unpacked.
  it('finds the packaged binary beside the app archive', () => {
    expect(bakenPath({ ...mac, platform: 'darwin', packaged: true })).toBe(posix.join(mac.resourcesPath, 'baken', 'baken'))
    expect(bakenPath({ ...win, platform: 'win32', packaged: true })).toBe(win32.join(win.resourcesPath, 'baken', 'baken.exe'))
  })

  // In development the binary is where scripts/build-baken.mjs left it.
  it('finds the development binary in the desktop app folder', () => {
    expect(bakenPath({ ...mac, platform: 'darwin', packaged: false })).toBe(posix.join(mac.appPath, 'resources', 'baken', 'baken'))
    expect(bakenPath({ ...win, platform: 'win32', packaged: false })).toBe(win32.join(win.appPath, 'resources', 'baken', 'baken.exe'))
  })

  // Linux has no export: nothing there can offer the feature, even with a binary on disk.
  it('has no baken on Linux', () => {
    expect(bakenPath({ ...mac, platform: 'linux', packaged: true })).toBeNull()
  })

  // A build that skipped scripts/build-baken.mjs must say "missing piece", not spawn ENOENT
  // halfway through an export.
  it('answers null when the binary is not there', () => {
    expect(bakenPath({ ...mac, platform: 'darwin', packaged: true, exists: () => false })).toBeNull()
  })

  it('runs the binary itself, with no prefix arguments', () => {
    expect(bakenCommand({ ...mac, platform: 'darwin', packaged: true })).toEqual({
      file: posix.join(mac.resourcesPath, 'baken', 'baken'),
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
import { posix, win32 } from 'node:path'

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

const NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'baken', win32: 'baken.exe' }

// macOS and Windows only; the platform's own path rules so a Windows path is built right
// even when this runs in a test on a Mac.
export function bakenPath(env: BakenEnv): string | null {
  const name = NAMES[env.platform]
  if (!name) return null
  const { join } = env.platform === 'win32' ? win32 : posix
  const dir = env.packaged ? join(env.resourcesPath, 'baken') : join(env.appPath, 'resources', 'baken')
  const file = join(dir, name)
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
// Source is pinned (apps/desktop/vendor/baken/UPSTREAM: url, tag, commit), the Rust version
// too (RUST_TOOLCHAIN), and Surco's patches are applied on top, so the shipped binary always
// matches the repo. Nothing is downloaded prebuilt: a release asset in surco-releases would
// be seen by the website's download button and by the updater. On Linux only the licences
// are written, since the export exists on macOS and Windows only.
// BAKEN_TEST=1 also runs baken's export tests (the patches' own tests among them).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'apps/desktop/vendor/baken')
const out = join(root, 'apps/desktop/resources/baken')
const [url, tag, commit] = readFileSync(join(vendor, 'UPSTREAM'), 'utf8').trim().split('\n')
const toolchain = readFileSync(join(vendor, 'RUST_TOOLCHAIN'), 'utf8').trim()
const work = process.env.BAKEN_BUILD_DIR ?? join(root, 'apps/desktop/.baken-build')
const exe = process.platform === 'win32' ? 'baken.exe' : 'baken'

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(join(vendor, 'LICENSE'), join(out, 'LICENSE'))
copyFileSync(join(vendor, 'THIRD_PARTY_LICENSES.md'), join(out, 'THIRD_PARTY_LICENSES.md'))
if (process.platform !== 'darwin' && process.platform !== 'win32') {
  console.log(`baken: not built on ${process.platform} (the USB export is macOS and Windows only)`)
  process.exit(0)
}

// A cached clone (CI restores it with the cargo cache) may hold a `git am` that failed last
// time; left there it blocks every later build, so it is aborted first. The clone is then
// reset to the pinned commit and the patches are re-applied, so an edited patch is never
// skipped.
if (!existsSync(join(work, '.git'))) run('git', ['clone', '--quiet', '--branch', tag, url, work])
try {
  execFileSync('git', ['am', '--abort'], { cwd: work, stdio: 'ignore' })
} catch {}
run('git', ['fetch', '--quiet', '--tags', 'origin'], work)
run('git', ['checkout', '--quiet', '--force', commit], work)
run('git', ['clean', '-fdq'], work)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work }).toString().trim()
if (head !== commit) throw new Error(`baken ${tag} is ${head}, expected ${commit}`)
const patches = readdirSync(join(vendor, 'patches')).filter((f) => f.endsWith('.patch')).sort()
run('git', ['-c', 'user.name=surco', '-c', 'user.email=surco@localhost', 'am', '--quiet',
  ...patches.map((p) => join(vendor, 'patches', p))], work)
// rustup reads this file and installs the pinned version if the machine lacks it.
writeFileSync(join(work, 'rust-toolchain.toml'), `[toolchain]\nchannel = "${toolchain}"\n`)
if (process.env.BAKEN_TEST === '1') run('cargo', ['test', '--release', '--locked', '-p', 'baken-export'], work)
run('cargo', ['build', '--release', '--locked', '-p', 'baken'], work)
copyFileSync(join(work, 'target/release', exe), join(out, exe))
console.log(`baken ${tag} + ${patches.length} patches (Rust ${toolchain}) -> ${join(out, exe)}`)
```

`apps/desktop/package.json`, in `scripts` after `"dist"`: `"build-baken": "node ../../scripts/build-baken.mjs",`

`.gitignore` (root), at the end:

```
# Built by scripts/build-baken.mjs on each machine; never committed.
apps/desktop/resources/baken/
apps/desktop/.baken-build/
```

- [ ] **Step 6: Ship it**

`apps/desktop/electron-builder.yml`, after the `asarUnpack:` list:

```yaml
# baken writes the USB export (export.pdb, exportLibrary.db, ANLZ). Built from pinned source
# plus Surco's patches by scripts/build-baken.mjs (baken on macOS, baken.exe on Windows), and
# kept outside app.asar because a binary inside the archive cannot be executed. On macOS
# electron-builder signs every Mach-O in the bundle with the Developer ID, this one included,
# so notarization covers it; build-test.yml's mac-signed job checks that before any tag.
# Windows ships unsigned today (packaging/windows-signing.md); baken.exe joins the signing
# when it arrives.
extraResources:
  - from: resources/baken
    to: baken
```

- [ ] **Step 7: Build it in CI before packaging, with its tests, and a signed macOS test build**

In `.github/workflows/release.yml`, in the `release` job, right after the step `Fetch Electron binary`:

```yaml
      # baken (the USB export's writer) is compiled from pinned source plus Surco's patches
      # on each runner, for its own arch, and its export tests (the patches' among them) gate
      # the release. The cache keeps the clone and cargo's target so a release does not pay
      # the full Rust build every time. Linux only gets the licences.
      - name: Cache baken build
        if: runner.os != 'Linux'
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            apps/desktop/.baken-build
          key: baken-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('apps/desktop/vendor/baken/**') }}

      - name: Build baken
        shell: bash
        env:
          BAKEN_TEST: '1'
        run: node scripts/build-baken.mjs
```

In `.github/workflows/build-test.yml`, in the `windows` job after `Fetch Electron binary`, the same two steps (cache with `if: runner.os != 'Linux'` and `Build baken` with `BAKEN_TEST: '1'`), so the Windows test installer carries `baken.exe`.

And a new job in the same file, the signed and notarized macOS build that is checked before any tag (Global Constraints: nothing ships unverified):

```yaml
  # The USB export bundles a native helper (baken) that must be signed with the Developer
  # ID and covered by notarization like the app. Verified here, by hand-launched build, before
  # a release tag ever runs: nothing is published.
  mac-signed:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: |
          for attempt in 1 2 3; do
            npm ci && exit 0
            echo "npm ci failed (attempt $attempt), retrying in 15s..."
            sleep 15
          done
          exit 1

      - name: Fetch Electron binary
        run: node node_modules/electron/install.js

      - name: Build baken
        env:
          BAKEN_TEST: '1'
        run: node scripts/build-baken.mjs

      - name: Write Apple API key
        run: echo "${{ secrets.APPLE_API_KEY_BASE64 }}" | base64 --decode > "$RUNNER_TEMP/apple-api-key.p8"

      - name: Build, sign and notarize without publishing
        working-directory: apps/desktop
        env:
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_API_KEY: ${{ runner.temp }}/apple-api-key.p8
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
        run: |
          npx electron-vite build
          npx electron-builder --mac --arm64 --publish never

      - name: Check baken is signed, hardened and notarized
        working-directory: apps/desktop
        run: |
          APP=$(ls -d dist/mac-arm64/Surco.app)
          codesign -dv --verbose=4 "$APP/Contents/Resources/baken/baken" 2>&1 | tee baken-sign.txt
          grep -q 'Authority=Developer ID Application' baken-sign.txt
          grep -q 'flags=0x10000(runtime)' baken-sign.txt
          codesign --verify --deep --strict "$APP"
          xcrun stapler validate "$APP"
          spctl -a -vvv -t exec "$APP"
          "$APP/Contents/Resources/baken/baken" expressport --help | grep -q -- '--json'

      - uses: actions/upload-artifact@v4
        with:
          name: surco-mac-signed-${{ github.run_id }}
          path: apps/desktop/dist/*.dmg
          if-no-files-found: error
```

- [ ] **Step 8: Build locally and check it packs and runs**

From the worktree root. `npm ci` first: the worktree has no `node_modules` of its own, and `npx` would otherwise fetch unpinned tools and pack without the production dependencies.

```bash
export SCRATCH=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad
export CARGO_HOME="$SCRATCH/usb-spike/tools/cargo" RUSTUP_HOME="$SCRATCH/usb-spike/tools/rustup" PATH="$SCRATCH/usb-spike/tools/cargo/bin:$PATH"
npm ci
BAKEN_TEST=1 npm run build-baken --workspace apps/desktop
apps/desktop/resources/baken/baken expressport --help | grep -E -- '--json|--artwork-dir'
cd apps/desktop && npx electron-vite build && npx electron-builder --mac --dir --publish never && cd ../..
B=$(ls -d apps/desktop/dist/mac*/Surco.app)/Contents/Resources/baken/baken
"$B" --version
ls "$(dirname "$B")"
```

Expected: the patch tests pass; both flags listed in the help; the packed app holds `Contents/Resources/baken/{baken,LICENSE,THIRD_PARTY_LICENSES.md}` and `--version` prints `baken 4.6.1`. A local unsigned build's baken is only linker-signed (`afterPack`'s ad hoc `--deep` does not reach `Resources`); that is expected here. The Developer ID signature, the hardened runtime and notarization are checked by `build-test.yml`'s `mac-signed` job (Task 12, Step 1), before any tag.

- [ ] **Step 9: Licence notice**

`README.md`, before the licence section, a new section:

```markdown
## Third-party software

Surco bundles [baken](https://github.com/M-Igashi/baken) by Masanari Higashi (MIT licence) to write USB sticks for Pioneer DJ / AlphaTheta players, built from its v4.6.1 source with the patches in `apps/desktop/vendor/baken/patches`. Its licence and those of its dependencies ship next to the binary (`Contents/Resources/baken/` on macOS, `resources\baken\` on Windows).
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
export function buildBakenXml(sel: ExportSelection, facts: ReadonlyMap<string, XmlTrackFacts>, platform?: NodeJS.Platform): string
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

  // A # or a space left raw cuts the Location at baken's URL decoding. The form is
  // rekordbox's own, file://localhost and the path, which baken's tests decode on both
  // platforms (file://localhost/C:/Music/... on Windows).
  it('writes a file URL baken can decode', () => {
    expect(xml).toContain('Location="file://localhost/Volumes/Public/Makina/Hands%20Of%20Fate%20%231.wav"')
  })

  it('writes a Windows path as rekordbox does on Windows', () => {
    const win = buildBakenXml(
      { playlists: [{ id: 'p', name: 'P', folders: [], trackIds: ['9'] }], tracks: [track({ id: '9', path: 'E:\\Musica\\No Fear.aiff' })] },
      new Map([['9', { size: 1, grid: [] }]]),
      'win32',
    )
    expect(win).toContain('Location="file://localhost/E:/Musica/No%20Fear.aiff"')
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

function trackXml(t: ExportTrack, f: XmlTrackFacts, platform: NodeJS.Platform): string {
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
    // rekordbox's form, file://localhost plus the encoded path (file://localhost/E:/... on
    // Windows). pathToFileURL encodes spaces, # and ?, which would otherwise end the URL early.
    ['Location', `file://localhost${pathToFileURL(t.path, { windows: platform === 'win32' }).pathname}`],
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

export function buildBakenXml(
  sel: ExportSelection,
  facts: ReadonlyMap<string, XmlTrackFacts>,
  platform: NodeJS.Platform = process.platform,
): string {
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
    ...tracks.map((t) => trackXml(t, facts.get(t.id) as XmlTrackFacts, platform)),
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
Expected: PASS (9: two for `hotCueNum`, seven for `buildBakenXml`).

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
export interface BakenArgsInput { stage: Stage; device: string; target: 'volume' | 'folder'; prune: boolean; settings: boolean; dryRun: boolean; platform: NodeJS.Platform; home: string; pioneerDir: string; systemRoot: string }
export function bakenArgs(input: BakenArgsInput): string[]   // throws BakenGuardError
export class BakenGuardError extends Error {}
export interface BakenHandle { done: Promise<{ code: number | null; stderr: string; started: boolean }>; cancel: () => void }
export function runBaken(command: { file: string; prefixArgs: string[] }, args: string[], onEvent: (e: BakenEvent) => void): BakenHandle
```

The exact event types:

```ts
export interface BakenPlan { event: 'plan'; volumeRoot: boolean; tracks: { id: number; usbPath: string; size: number; onStick: boolean }[]; spaceNeeded: number; spaceAvailable: number | null; warnings: string[]; skipped: { name: string; reason: string }[]; onelibraryFiles: string[] }
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
import { type BakenArgsInput, type BakenEvent, BakenGuardError, bakenArgs, parseBakenLine, runBaken } from './bakenRun'
import type { Stage } from './usbExportStage'

const stage = (dir: string, settings: string | null = `${dir}/settings`): Stage => ({
  dir, xml: `${dir}/collection.xml`, anlzDir: `${dir}/USBANLZ`, artworkDir: `${dir}/artwork`,
  settingsDir: settings, included: [], missing: [], sizes: new Map(), waves: new Map(), covers: new Map(),
})

const MAC: BakenArgsInput = {
  stage: stage('/tmp/s'), device: '/Volumes/Vicent 1', target: 'volume', prune: false, settings: true, dryRun: false,
  platform: 'darwin', home: '/Users/dj', pioneerDir: '/Users/dj/Library/Pioneer', systemRoot: '/',
}
const WIN: BakenArgsInput = {
  stage: stage('C:\\Users\\dj\\AppData\\Local\\Temp\\surco-usb-1'), device: 'E:\\', target: 'volume', prune: false,
  settings: true, dryRun: false, platform: 'win32', home: 'C:\\Users\\dj',
  pioneerDir: 'C:\\Users\\dj\\AppData\\Roaming\\Pioneer', systemRoot: 'C:\\',
}

describe('bakenArgs', () => {
  // baken left alone looks for rekordbox's analysis and settings in the Pioneer folder; Surco
  // always hands it the staged copies so it never goes there.
  it('always passes the staged analysis, artwork, OneLibrary and JSON', () => {
    expect(bakenArgs(MAC)).toEqual([
      'expressport', '/tmp/s/collection.xml', '--device', '/Volumes/Vicent 1',
      '--anlz-dir', '/tmp/s/USBANLZ', '--settings-dir', '/tmp/s/settings',
      '--onelibrary', '--artwork', '--artwork-dir', '/tmp/s/artwork', '--generate-analysis',
      '--device-name', '', '--json',
    ])
  })

  // My Settings are opt-in: unticked (or none staged), the player keeps its own.
  it('writes no settings unless asked and staged', () => {
    expect(bakenArgs({ ...MAC, settings: false })).toContain('--no-settings')
    expect(bakenArgs({ ...MAC, stage: stage('/tmp/s', null) })).toContain('--no-settings')
    expect(bakenArgs({ ...MAC, settings: false })).not.toContain('--settings-dir')
  })

  // Deleting music is the user's explicit choice, and never inside a folder picked by hand:
  // its Contents/ may be anything.
  it('prunes only a volume, only when asked', () => {
    expect(bakenArgs(MAC)).not.toContain('--prune')
    expect(bakenArgs({ ...MAC, prune: true })).toContain('--prune')
    expect(bakenArgs({ ...MAC, prune: true, target: 'folder' })).not.toContain('--prune')
    expect(bakenArgs({ ...MAC, dryRun: true })).toContain('--dry-run')
  })

  it('refuses rekordbox own folder, the home folder or the system root on macOS', () => {
    for (const device of ['/Users/dj/Library/Pioneer', '/Users/dj/Library/Pioneer/rekordbox', '/Users/dj', '/'])
      expect(() => bakenArgs({ ...MAC, device })).toThrow(BakenGuardError)
    expect(() => bakenArgs({ ...MAC, stage: stage('/Users/dj/Library/Pioneer/x') })).toThrow(BakenGuardError)
  })

  // Same rules with drive letters; Windows paths compare without case.
  it('refuses the Pioneer folder, the home folder and the system drive on Windows', () => {
    expect(bakenArgs(WIN)).toContain('E:\\')
    for (const device of ['C:\\', 'c:\\', 'C:\\Users\\dj', 'c:\\users\\DJ\\AppData\\Roaming\\Pioneer\\rekordbox'])
      expect(() => bakenArgs({ ...WIN, device })).toThrow(BakenGuardError)
    expect(() => bakenArgs({ ...WIN, stage: stage('C:\\Users\\dj\\AppData\\Roaming\\Pioneer\\tmp') })).toThrow(BakenGuardError)
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
  // A fake baken speaking the same lines, so the spawn, the line splitting and the cancel
  // request are exercised without the real binary or a stick.
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

  // Cancel is a line on stdin, which reaches a child process on Windows too (no SIGINT
  // there); baken answers with its report once the track in progress is done.
  it('asks for a cancel on stdin and waits for the report', async () => {
    const cmd = await fake(`
      require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
        if (l === 'cancel') { process.stdout.write(JSON.stringify({ event: 'report', cancelled: true }) + '\\n'); process.exit(0) }
      })
    `)
    const seen: BakenEvent[] = []
    const handle = runBaken(cmd, [], (e) => seen.push(e))
    handle.cancel()
    const { code } = await handle.done
    expect(code).toBe(0)
    expect(seen).toEqual([{ event: 'report', cancelled: true }])
  })

  // A binary that cannot start (missing, not executable) says so instead of hanging.
  it('reports a process that never started', async () => {
    const { code, started } = await runBaken({ file: '/nonexistent/baken', prefixArgs: [] }, [], () => {}).done
    expect(code).toBeNull()
    expect(started).toBe(false)
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
import { posix, win32 } from 'node:path'
import { createInterface } from 'node:readline'
import type { Stage } from './usbExportStage'

// Drives Surco's patched baken (vendor/baken/patches) through its --json lines: one object
// per line on stdout, and a `cancel` line on stdin. The human output is never read; it is a
// progress bar that vanishes off a terminal.

export interface BakenPlan {
  event: 'plan'
  volumeRoot: boolean
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
  target: 'volume' | 'folder'
  prune: boolean
  settings: boolean
  dryRun: boolean
  platform: NodeJS.Platform
  home: string
  // ~/Library/Pioneer on macOS, %APPDATA%\Pioneer on Windows.
  pioneerDir: string
  // '/' on macOS, %SystemDrive%\ on Windows.
  systemRoot: string
}

// The last line of defence for the rules that matter most: nothing under the Pioneer folder
// is ever written or read by baken directly, the device is never the system root or the
// home folder, and a folder picked by hand is never pruned.
export function bakenArgs(input: BakenArgsInput): string[] {
  const { stage, device, target, prune, settings, dryRun, platform } = input
  const p = platform === 'win32' ? win32 : posix
  const norm = (x: string): string => {
    const r = p.resolve(x)
    return platform === 'win32' ? r.toLowerCase() : r
  }
  const inside = (path: string, dir: string): boolean => {
    const a = norm(path)
    const d = norm(dir)
    return a === d || a.startsWith(d.endsWith(p.sep) ? d : d + p.sep)
  }
  if (norm(device) === norm(input.systemRoot) || norm(device) === norm(input.home) || inside(device, input.pioneerDir))
    throw new BakenGuardError(`refusing to export to ${device}`)
  for (const dir of [stage.dir, stage.anlzDir, stage.artworkDir, stage.settingsDir ?? stage.dir])
    if (inside(dir, input.pioneerDir)) throw new BakenGuardError(`refusing to stage inside ${input.pioneerDir}`)
  return [
    'expressport',
    stage.xml,
    '--device',
    device,
    '--anlz-dir',
    stage.anlzDir,
    ...(settings && stage.settingsDir ? ['--settings-dir', stage.settingsDir] : ['--no-settings']),
    '--onelibrary',
    '--artwork',
    '--artwork-dir',
    stage.artworkDir,
    '--generate-analysis',
    // rekordbox 7.2.19's export leaves the name empty; the spike stick did the same.
    '--device-name',
    '',
    '--json',
    ...(prune && target === 'volume' ? ['--prune'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ]
}

export interface BakenHandle {
  // started: false when the process never ran (missing or not executable binary).
  done: Promise<{ code: number | null; stderr: string; started: boolean }>
  // Asks baken to stop before its next track; it then reports and exits on its own.
  cancel: () => void
}

export function runBaken(
  command: { file: string; prefixArgs: string[] },
  args: string[],
  onEvent: (e: BakenEvent) => void,
): BakenHandle {
  const child = spawn(command.file, [...command.prefixArgs, ...args], {
    env: { ...process.env, BAKEN_NO_UPDATE_CHECK: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let started = false
  child.on('spawn', () => {
    started = true
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  // A cancel written after baken exited must not crash the main process.
  child.stdin.on('error', () => {})
  createInterface({ input: child.stdout }).on('line', (line) => {
    const e = parseBakenLine(line)
    if (e) onEvent(e)
  })
  const done = new Promise<{ code: number | null; stderr: string; started: boolean }>((res) => {
    child.on('error', (err) => res({ code: null, stderr: String(err), started }))
    child.on('close', (code) => res({ code, stderr, started }))
  })
  return {
    done,
    cancel: () => {
      if (child.stdin.writable) child.stdin.write('cancel\n')
    },
  }
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/bakenRun.test.ts src/main/usbExportStage.test.ts`
Expected: PASS. (`close` fires after stdout ends, so every line is delivered before `done` resolves. The runner never kills baken: a kill mid-copy would leave a truncated audio file over one the stick's previous library may reference.)

- [ ] **Step 9: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/usbExportStage.ts apps/desktop/src/main/usbExportStage.test.ts apps/desktop/src/main/bakenRun.ts apps/desktop/src/main/bakenRun.test.ts
git commit -m "Stage baken's work folder and run it through its JSON lines"
```

---
### Task 8: Removable volumes on macOS and Windows, who wrote them, and the per-stick memory

**Files:**
- Create: `src/main/usbVolumes.ts`, `src/main/usbVolumes.test.ts`
- Create: `src/main/windowsVolumes.ps1`, `src/main/rawImports.d.ts`, `src/main/fixtures/win32-volumes.json`
- Create: `src/main/usbExportMemory.ts`, `src/main/usbExportMemory.test.ts`
- Modify: `src/shared/types.ts` (the volume and target types), `.github/workflows/ci.yml` (Windows job)

**Interfaces:**
- Consumes: the diskutil fixtures (Task 1).
- Produces (Task 9, renderer):

```ts
// shared/types.ts
export type UsbFilesystem = 'fat32' | 'exfat' | 'hfs' | 'apfs' | 'ntfs' | 'other'
export interface UsbHolder { by: 'rekordbox' | 'surco' | 'other' | 'empty'; at: number | null }
export interface UsbRemembered { playlistIds: string[]; prune: boolean; settings: boolean; at: number }
export interface UsbVolume {
  uuid: string; name: string; mountPoint: string; filesystem: UsbFilesystem
  partitionScheme: 'mbr' | 'gpt' | 'other'; totalBytes: number; freeBytes: number
  holder: UsbHolder; remembered: UsbRemembered | null
}
export type UsbTarget = { kind: 'volume'; uuid: string } | { kind: 'folder'; path: string }
export interface UsbVolumeList { volumes: UsbVolume[]; lastKey: string | null }

// usbVolumes.ts
export type RawVolume = Omit<UsbVolume, 'holder' | 'remembered'>
export interface VolumeSource { list: () => Promise<RawVolume[]>; idAt: (root: string) => Promise<string | null> }
export function parsePlist(xml: string): unknown
export type DiskutilInfo = Record<string, unknown>
export function isUsbVolume(info: DiskutilInfo): boolean
export function filesystemOf(info: DiskutilInfo): UsbFilesystem
export function schemeOf(whole: DiskutilInfo | null): 'mbr' | 'gpt' | 'other'
export function darwinSource(deps: { list: () => Promise<string[]>; info: (target: string) => Promise<DiskutilInfo | null> }): VolumeSource
export interface WinVolume { DeviceID: string; DriveLetter: string | null; Label: string | null; FileSystem: string | null; Capacity: number; FreeSpace: number; DriveType: number; SerialNumber: number; BusType: string | null; PartitionStyle: string | null; SystemVolume: boolean; BootVolume: boolean }
export function parseWindowsVolumes(json: unknown): RawVolume[]
export function windowsSource(query: (letter?: string) => Promise<unknown>): VolumeSource
export const DARWIN_DISKUTIL: { list: () => Promise<string[]>; info: (target: string) => Promise<DiskutilInfo | null> }
export function powershellQuery(letter?: string): Promise<unknown>
export function systemVolumeSource(platform: NodeJS.Platform): VolumeSource | null
export async function stickHolder(root: string, pdb: { size: number; mtimeMs: number } | null): Promise<UsbHolder>
export async function readVolumes(source: VolumeSource, memory: UsbMemory, holder?: typeof stickHolder): Promise<UsbVolume[]>
export function volumeContaining(volumes: RawVolume[], path: string, platform: NodeJS.Platform): RawVolume | null
export function watchVolumes(platform: NodeJS.Platform, onChange: () => void, deps?: { exists: (p: string) => boolean; intervalMs?: number }): () => void

// usbExportMemory.ts
export interface UsbMemoryEntry { playlistIds: string[]; trackIds: string[]; at: number; pdb: { size: number; mtimeMs: number } | null; prune: boolean; settings: boolean }
export function targetKey(t: UsbTarget): string
export interface UsbMemory { last(): string | null; get(key: string): UsbMemoryEntry | null; remember(key: string, entry: UsbMemoryEntry): void }
export function createUsbMemory(file: string): UsbMemory
```

On Windows the identifier is the volume GUID from `Win32_Volume.DeviceID` (`\\?\Volume{6f1c…}\`, lowercased, braces kept), the mount point the drive root (`E:\`). A drive letter alone never identifies a stick: letters are reassigned as sticks come and go.

- [ ] **Step 1: Add the shared types**

At the end of `src/shared/types.ts`:

```ts
// The USB export (docs/superpowers/specs/2026-10-16-export-usb-design.md). A stick is
// always named by a stable volume identifier (macOS VolumeUUID, Windows volume GUID), never
// by its name or drive letter: two sticks may share a name ("Vicent" and "Vicent").
export type UsbFilesystem = 'fat32' | 'exfat' | 'hfs' | 'apfs' | 'ntfs' | 'other'

export interface UsbHolder {
  by: 'rekordbox' | 'surco' | 'other' | 'empty'
  // export.pdb's modification time, when there is one.
  at: number | null
}

// What Surco exported to this stick last time, so the next time is one press of Exportar.
export interface UsbRemembered {
  playlistIds: string[]
  prune: boolean
  settings: boolean
  at: number
}

export interface UsbVolume {
  uuid: string
  name: string
  // /Volumes/Vicent on macOS, E:\ on Windows.
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

const entry = { playlistIds: ['2000'], trackIds: ['101', '102'], at: 1, pdb: { size: 9, mtimeMs: 2 }, prune: false, settings: true }

describe('usb export memory', () => {
  // By identifier, never by name: Vicent's two sticks are both called "Vicent".
  it('keys sticks by identifier and folders by path', () => {
    expect(targetKey({ kind: 'volume', uuid: 'B10C' })).toBe('volume:B10C')
    expect(targetKey({ kind: 'folder', path: '/Volumes/SD/sets' })).toBe('folder:/Volumes/SD/sets')
  })

  it('remembers per stick, its boxes, and which was last, across restarts', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'usb-mem-')), 'usb-exports.json')
    createUsbMemory(file).remember('volume:A', entry)
    createUsbMemory(file).remember('volume:B', { ...entry, playlistIds: ['3000'], settings: false })
    const again = createUsbMemory(file)
    expect(again.get('volume:A')).toMatchObject({ playlistIds: ['2000'], settings: true })
    expect(again.get('volume:B')).toMatchObject({ playlistIds: ['3000'], settings: false })
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
  settings: boolean
}

interface MemoryFile {
  last: string | null
  entries: Record<string, UsbMemoryEntry>
}

// A folder's path must already be its real path (the IPC resolves it), so one folder reached
// through a symlink and directly is one memory.
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

- [ ] **Step 4: The PowerShell query and its fixture**

`src/main/windowsVolumes.ps1` (read-only CIM and storage queries; one JSON array on stdout):

```powershell
# Surco's USB export: the lettered volumes of this PC with what the removable filter needs.
# Read-only. With a drive letter argument ('E:'), only that volume.
$ErrorActionPreference = 'SilentlyContinue'
$only = $args[0]
$vols = Get-CimInstance -ClassName Win32_Volume | Where-Object { $_.DriveLetter -and (-not $only -or $_.DriveLetter -eq $only) }
$out = foreach ($v in $vols) {
  $bus = $null
  $style = $null
  $part = Get-Partition -DriveLetter $v.DriveLetter.TrimEnd(':')
  if ($part) {
    $disk = $part | Get-Disk
    if ($disk) { $bus = [string]$disk.BusType; $style = [string]$disk.PartitionStyle }
  }
  [pscustomobject]@{
    DeviceID = $v.DeviceID; DriveLetter = $v.DriveLetter; Label = $v.Label; FileSystem = $v.FileSystem
    Capacity = [double]$v.Capacity; FreeSpace = [double]$v.FreeSpace; DriveType = [int]$v.DriveType
    SerialNumber = [double]$v.SerialNumber; BusType = $bus; PartitionStyle = $style
    SystemVolume = [bool]$v.SystemVolume; BootVolume = [bool]$v.BootVolume
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 2
```

`src/main/rawImports.d.ts`:

```ts
// The PowerShell query ships inside the main bundle as text (Vite's ?raw), so the very file
// the CI Windows job runs is the one the app runs.
declare module '*.ps1?raw' {
  const text: string
  export default text
}
```

`src/main/fixtures/win32-volumes.json`, the shape `ConvertTo-Json` gives for a PC with the system disk, a FAT32 stick, a USB SSD in exFAT, a CD drive and a mapped NAS share (hand-written from the documented `Win32_Volume` and `Get-Disk` properties; there is no Windows machine here, the CI job of Step 9 runs the real script):

```json
[
  {"DeviceID":"\\\\?\\Volume{0b1f0c55-0000-0000-0000-100000000000}\\","DriveLetter":"C:","Label":"Windows","FileSystem":"NTFS","Capacity":511101108224,"FreeSpace":201326592000,"DriveType":3,"SerialNumber":3735928559,"BusType":"NVMe","PartitionStyle":"GPT","SystemVolume":false,"BootVolume":true},
  {"DeviceID":"\\\\?\\Volume{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}\\","DriveLetter":"E:","Label":"VICENT","FileSystem":"FAT32","Capacity":31457280000,"FreeSpace":22988390400,"DriveType":2,"SerialNumber":2970916591,"BusType":"USB","PartitionStyle":"MBR","SystemVolume":false,"BootVolume":false},
  {"DeviceID":"\\\\?\\Volume{9a2d4c11-77e0-4b5a-8f3e-2c1d0e9f8a7b}\\","DriveLetter":"F:","Label":"SSD SETS","FileSystem":"exFAT","Capacity":500107862016,"FreeSpace":300000000000,"DriveType":3,"SerialNumber":1234567890,"BusType":"USB","PartitionStyle":"GPT","SystemVolume":false,"BootVolume":false},
  {"DeviceID":"\\\\?\\Volume{11111111-2222-3333-4444-555555555555}\\","DriveLetter":"D:","Label":null,"FileSystem":null,"Capacity":0,"FreeSpace":0,"DriveType":5,"SerialNumber":0,"BusType":"SATA","PartitionStyle":null,"SystemVolume":false,"BootVolume":false},
  {"DeviceID":"\\\\?\\Volume{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}\\","DriveLetter":"Z:","Label":"Public","FileSystem":"NTFS","Capacity":4000000000000,"FreeSpace":1000000000000,"DriveType":4,"SerialNumber":0,"BusType":null,"PartitionStyle":null,"SystemVolume":false,"BootVolume":false}
]
```

- [ ] **Step 5: Write the failing volume tests**

`src/main/usbVolumes.test.ts`:

```ts
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUsbMemory } from './usbExportMemory'
import {
  type DiskutilInfo, darwinSource, filesystemOf, isUsbVolume, parsePlist, parseWindowsVolumes,
  readVolumes, schemeOf, stickHolder, volumeContaining, watchVolumes, windowsSource,
} from './usbVolumes'

afterEach(() => vi.useRealTimers())

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
const STICK = parsePlist(fixture('diskutil-usb-exfat.plist')) as DiskutilInfo
const WHOLE = parsePlist(fixture('diskutil-usb-whole.plist')) as DiskutilInfo
const INTERNAL = parsePlist(fixture('diskutil-internal.plist')) as DiskutilInfo
const WIN = JSON.parse(fixture('win32-volumes.json')) as unknown
const memory = async () => createUsbMemory(join(await mkdtemp(join(tmpdir(), 'mem-')), 'm.json'))
// Tests never touch a real stick: who wrote it is answered by a stand-in.
const holder = async () => ({ by: 'empty' as const, at: null })

describe('parsePlist', () => {
  it('reads dicts, arrays, strings, integers and booleans', () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>A</key><string>x &amp; y</string><key>B</key><integer>42</integer><key>C</key><true/><key>D</key><array><string>p</string><false/></array><key>E</key><dict/></dict></plist>`
    expect(parsePlist(xml)).toEqual({ A: 'x & y', B: 42, C: true, D: ['p', false], E: {} })
  })

  it('reads the real diskutil output of the test stick', () => {
    expect(STICK.VolumeUUID).toBe('B10C96EF-51C2-344E-B78D-DAFC319D973E')
  })
})

describe('macOS: isUsbVolume', () => {
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

describe('macOS: darwinSource and readVolumes', () => {
  const deps = (infos: Record<string, DiskutilInfo | null>) => ({
    list: async () => Object.keys(infos).filter((k) => k.startsWith('/Volumes/')),
    info: async (target: string) => infos[target] ?? null,
  })

  // Two sticks with the same name mount as "Vicent" and "Vicent 1"; each is its own UUID.
  it('lists only the removable volumes, each by its UUID', async () => {
    const twin = { ...STICK, VolumeUUID: 'OTHER-UUID', MountPoint: '/Volumes/Vicent 1', VolumeName: 'Vicent' }
    const source = darwinSource(deps({
      '/Volumes/Surco': STICK,
      '/Volumes/Vicent 1': twin,
      '/Volumes/Macintosh HD': INTERNAL,
      '/Volumes/Public': null,
      [String(STICK.ParentWholeDisk)]: WHOLE,
    }))
    const vols = await readVolumes(source, await memory(), holder)
    expect(vols.map((v) => [v.uuid, v.mountPoint])).toEqual([
      ['B10C96EF-51C2-344E-B78D-DAFC319D973E', '/Volumes/Surco'],
      ['OTHER-UUID', '/Volumes/Vicent 1'],
    ])
    expect(vols[0].filesystem).toBe('exfat')
    expect(vols[0].totalBytes).toBeGreaterThan(0)
  })

  it('reads the UUID at a mount point right now', async () => {
    expect(await darwinSource(deps({ '/Volumes/Surco': STICK })).idAt('/Volumes/Surco')).toBe('B10C96EF-51C2-344E-B78D-DAFC319D973E')
    expect(await darwinSource(deps({})).idAt('/Volumes/Surco')).toBeNull()
  })
})

describe('Windows: parseWindowsVolumes', () => {
  // A USB stick (DriveType 2) and a USB SSD (fixed, but on the USB bus) are offered; the
  // system disk, the CD drive and the mapped NAS share are not.
  it('keeps the removable volumes, by volume GUID, mounted at their drive root', () => {
    expect(parseWindowsVolumes(WIN)).toEqual([
      {
        uuid: '{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}', name: 'VICENT', mountPoint: 'E:\\', filesystem: 'fat32',
        partitionScheme: 'mbr', totalBytes: 31457280000, freeBytes: 22988390400,
      },
      {
        uuid: '{9a2d4c11-77e0-4b5a-8f3e-2c1d0e9f8a7b}', name: 'SSD SETS', mountPoint: 'F:\\', filesystem: 'exfat',
        partitionScheme: 'gpt', totalBytes: 500107862016, freeBytes: 300000000000,
      },
    ])
  })

  it('never offers a system or boot volume, even on USB', () => {
    const [, stick] = WIN as Record<string, unknown>[]
    expect(parseWindowsVolumes([{ ...stick, BootVolume: true }])).toEqual([])
    expect(parseWindowsVolumes([{ ...stick, SystemVolume: true }])).toEqual([])
  })

  // PowerShell gives an object, not an array, when there is one; garbage gives nothing.
  it('takes a single object and ignores what it cannot read', () => {
    const [, stick] = WIN as Record<string, unknown>[]
    expect(parseWindowsVolumes(stick)).toHaveLength(1)
    expect(parseWindowsVolumes(null)).toEqual([])
    expect(parseWindowsVolumes([{ DriveLetter: 'E:' }])).toEqual([])
  })

  it('names NTFS, which the players do not read', () => {
    const [, stick] = WIN as Record<string, unknown>[]
    expect(parseWindowsVolumes([{ ...stick, FileSystem: 'NTFS' }])[0].filesystem).toBe('ntfs')
  })

  it('asks for one drive letter when checking what is mounted there', async () => {
    const query = vi.fn(async (letter?: string) => (letter === 'E:' ? [(WIN as unknown[])[1]] : []))
    expect(await windowsSource(query).idAt('E:\\')).toBe('{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}')
    expect(query).toHaveBeenCalledWith('E:')
    expect(await windowsSource(query).idAt('G:\\')).toBeNull()
  })
})

describe('volumeContaining', () => {
  const vols = [
    { uuid: 'U1', name: 'SD', mountPoint: '/Volumes/SD', filesystem: 'fat32' as const, partitionScheme: 'mbr' as const, totalBytes: 1, freeBytes: 1 },
    { uuid: 'W1', name: 'VICENT', mountPoint: 'E:\\', filesystem: 'fat32' as const, partitionScheme: 'mbr' as const, totalBytes: 1, freeBytes: 1 },
  ]
  // "Otro destino" must be on a listed removable volume; the system disk never is.
  it('finds the removable volume a folder is on, or none', () => {
    expect(volumeContaining(vols, '/Volumes/SD/sets', 'darwin')?.uuid).toBe('U1')
    expect(volumeContaining(vols, '/Volumes/SDX/sets', 'darwin')).toBeNull()
    expect(volumeContaining(vols, '/Users/dj/Music', 'darwin')).toBeNull()
    expect(volumeContaining(vols, 'e:\\Sets', 'win32')?.uuid).toBe('W1')
    expect(volumeContaining(vols, 'C:\\Users\\dj', 'win32')).toBeNull()
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

describe('watchVolumes on Windows', () => {
  // No /Volumes on Windows: the set of existing drive letters is checked every 2 s (a stat
  // per letter, cheap) and only a change reruns the PowerShell query.
  it('fires when a drive letter appears or goes', () => {
    vi.useFakeTimers()
    const present = new Set(['C:\\'])
    const onChange = vi.fn()
    const stop = watchVolumes('win32', onChange, { exists: (p) => present.has(p), intervalMs: 2000 })
    vi.advanceTimersByTime(2000)
    expect(onChange).not.toHaveBeenCalled()
    present.add('E:\\')
    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(1)
    present.delete('E:\\')
    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(2)
    stop()
  })
})
```

- [ ] **Step 6: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbVolumes.test.ts`
Expected: FAIL, `Cannot find module './usbVolumes'`.

- [ ] **Step 7: Implement**

`src/main/usbVolumes.ts`:

```ts
import { execFile } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import type { UsbFilesystem, UsbHolder, UsbVolume } from '../shared/types'
import { type UsbMemory, targetKey } from './usbExportMemory'
import windowsVolumesScript from './windowsVolumes.ps1?raw'

// The sticks the export can write: mounted, removable, never the system disk, never a
// network share, never a disk image. macOS asks diskutil one volume at a time; Windows asks
// one PowerShell query. Both come out as RawVolume, keyed by a stable identifier.

export type RawVolume = Omit<UsbVolume, 'holder' | 'remembered'>

export interface VolumeSource {
  list: () => Promise<RawVolume[]>
  // The identifier of whatever is mounted at that root now, asked again right before writing.
  idAt: (root: string) => Promise<string | null>
}

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

const numberOf = (v: unknown): number => (typeof v === 'number' ? v : 0)

export function darwinSource(deps: {
  list: () => Promise<string[]>
  info: (target: string) => Promise<DiskutilInfo | null>
}): VolumeSource {
  return {
    list: async () => {
      const out: RawVolume[] = []
      for (const mount of await deps.list()) {
        const info = await deps.info(mount)
        if (!info || !isUsbVolume(info)) continue
        const whole = typeof info.ParentWholeDisk === 'string' ? await deps.info(info.ParentWholeDisk) : null
        out.push({
          uuid: String(info.VolumeUUID),
          name: String(info.VolumeName ?? ''),
          mountPoint: String(info.MountPoint),
          filesystem: filesystemOf(info),
          partitionScheme: schemeOf(whole),
          totalBytes: numberOf(info.TotalSize),
          freeBytes: numberOf(info.APFSContainerFree ?? info.FreeSpace),
        })
      }
      return out
    },
    idAt: async (root) => {
      const info = await deps.info(root)
      return info && typeof info.VolumeUUID === 'string' ? info.VolumeUUID : null
    },
  }
}

const run = promisify(execFile)

export const DARWIN_DISKUTIL = {
  list: async (): Promise<string[]> => (await readdir('/Volumes').catch(() => [])).map((n) => join('/Volumes', n)),
  info: async (target: string): Promise<DiskutilInfo | null> => {
    try {
      const { stdout } = await run('diskutil', ['info', '-plist', target])
      const info = parsePlist(stdout) as DiskutilInfo | null
      return info && info.Error !== true ? info : null
    } catch {
      return null
    }
  },
}

export interface WinVolume {
  DeviceID: string
  DriveLetter: string | null
  Label: string | null
  FileSystem: string | null
  Capacity: number
  FreeSpace: number
  DriveType: number
  SerialNumber: number
  BusType: string | null
  PartitionStyle: string | null
  SystemVolume: boolean
  BootVolume: boolean
}

const REMOVABLE_DRIVE = 2
const GUID = /Volume(\{[0-9a-f-]+\})/i

function winFilesystem(fs: string | null): UsbFilesystem {
  const f = (fs ?? '').toLowerCase()
  return f === 'fat32' ? 'fat32' : f === 'exfat' ? 'exfat' : f === 'ntfs' ? 'ntfs' : 'other'
}

// Removable = a stick (DriveType 2) or any disk on the USB bus (USB SSDs report as fixed),
// with a letter, never the system or boot volume. Network shares are DriveType 4 and not on
// a bus, so they never qualify.
export function parseWindowsVolumes(json: unknown): RawVolume[] {
  const items = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : []
  return (items as Partial<WinVolume>[]).flatMap((v) => {
    const guid = GUID.exec(String(v.DeviceID ?? ''))?.[1]
    const letter = String(v.DriveLetter ?? '')
    if (!guid || !/^[A-Z]:$/i.test(letter) || v.SystemVolume || v.BootVolume) return []
    if (v.DriveType !== REMOVABLE_DRIVE && String(v.BusType ?? '').toUpperCase() !== 'USB') return []
    return [{
      uuid: guid.toLowerCase(),
      name: String(v.Label ?? ''),
      mountPoint: `${letter.toUpperCase()}\\`,
      filesystem: winFilesystem(v.FileSystem ?? null),
      partitionScheme: v.PartitionStyle === 'MBR' ? 'mbr' : v.PartitionStyle === 'GPT' ? 'gpt' : 'other',
      totalBytes: numberOf(v.Capacity),
      freeBytes: numberOf(v.FreeSpace),
    }]
  })
}

export function windowsSource(query: (letter?: string) => Promise<unknown>): VolumeSource {
  return {
    list: async () => parseWindowsVolumes(await query()),
    idAt: async (root) => {
      const letter = /^([A-Z]:)/i.exec(root)?.[1]?.toUpperCase()
      if (!letter) return null
      return parseWindowsVolumes(await query(letter))[0]?.uuid ?? null
    },
  }
}

// The script goes in as -EncodedCommand (UTF-16LE base64), so no quoting of the script or
// the letter can break it; the letter is validated before it is spliced in.
export async function powershellQuery(letter?: string): Promise<unknown> {
  const arg = letter && /^[A-Z]:$/i.test(letter) ? ` '${letter}'` : ''
  const command = `& {\n${windowsVolumesScript}\n}${arg}`
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { windowsHide: true, maxBuffer: 1 << 20 },
    )
    return JSON.parse(stdout.trim() || '[]')
  } catch {
    return []
  }
}

export function systemVolumeSource(platform: NodeJS.Platform): VolumeSource | null {
  if (platform === 'darwin') return darwinSource(DARWIN_DISKUTIL)
  if (platform === 'win32') return windowsSource(powershellQuery)
  return null
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

export async function readVolumes(
  source: VolumeSource,
  memory: UsbMemory,
  holder: typeof stickHolder = stickHolder,
): Promise<UsbVolume[]> {
  const out: UsbVolume[] = []
  for (const v of await source.list()) {
    const entry = memory.get(targetKey({ kind: 'volume', uuid: v.uuid }))
    out.push({
      ...v,
      holder: await holder(v.mountPoint, entry?.pdb ?? null),
      remembered: entry ? { playlistIds: entry.playlistIds, prune: entry.prune, settings: entry.settings ?? false, at: entry.at } : null,
    })
  }
  return out
}

// "Otro destino" has to be on one of the listed removable volumes; this finds which.
export function volumeContaining(volumes: RawVolume[], path: string, platform: NodeJS.Platform): RawVolume | null {
  const p = platform === 'win32' ? win32 : posix
  const norm = (x: string): string => (platform === 'win32' ? p.resolve(x).toLowerCase() : p.resolve(x))
  const target = norm(path)
  return (
    volumes.find((v) => {
      const root = norm(v.mountPoint)
      return target === root || target.startsWith(root.endsWith(p.sep) ? root : root + p.sep)
    }) ?? null
  )
}

const LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`)

// macOS adds and removes /Volumes entries as volumes mount and unmount (debounced: one mount
// fires several events). Windows has no such folder: the set of existing drive roots is
// compared every 2 s, and only a change reports.
export function watchVolumes(
  platform: NodeJS.Platform,
  onChange: () => void,
  deps: { exists: (p: string) => boolean; intervalMs?: number } = { exists: existsSync },
): () => void {
  if (platform === 'win32') {
    const snapshot = (): string => LETTERS.filter((l) => deps.exists(l)).join('')
    let last = snapshot()
    const timer = setInterval(() => {
      const now = snapshot()
      if (now !== last) {
        last = now
        onChange()
      }
    }, deps.intervalMs ?? 2000)
    return () => clearInterval(timer)
  }
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

- [ ] **Step 8: Run them to see them pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbVolumes.test.ts src/main/usbExportMemory.test.ts`
Expected: PASS. If `isUsbVolume(STICK)` fails, compare with the fields written down in Task 1 Step 3; the filter must follow the real stick, and the test that pins it must then say why. If vitest cannot import `./windowsVolumes.ps1?raw`, it is Vite's `?raw` query: check that the main build (`npx electron-vite build`) also bundles it, and keep the import; do not read the file from disk at run time (it would have to be shipped separately).

- [ ] **Step 9: The Windows CI job**

`.github/workflows/ci.yml`, a second job beside `check`:

```yaml
  # The USB export's Windows paths (drive letters, the PowerShell volume query, the guards)
  # are tested everywhere with fixtures; this job runs them on Windows itself and runs the
  # real PowerShell query, which no Mac can.
  usb-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        shell: bash
        run: |
          for attempt in 1 2 3; do
            npm ci && exit 0
            echo "npm ci failed (attempt $attempt), retrying in 15s..."
            sleep 15
          done
          exit 1

      - name: USB export tests
        working-directory: apps/desktop
        run: npx vitest run src/main/usbVolumes.test.ts src/main/usbExportMemory.test.ts src/main/bakenPath.test.ts src/main/bakenRun.test.ts src/main/bakenXml.test.ts src/main/usbExportStage.test.ts

      - name: The volume query runs and answers JSON
        shell: pwsh
        run: |
          $json = powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File apps/desktop/src/main/windowsVolumes.ps1
          $vols = $json | ConvertFrom-Json
          if ($null -eq $vols) { throw 'no JSON from windowsVolumes.ps1' }
          Write-Output "volumes: $(@($vols).Count)"
          @($vols) | Where-Object { $_.DriveLetter -eq 'C:' -and -not $_.DeviceID } | ForEach-Object { throw 'C: without a volume GUID' }
```

Task 9 adds `src/main/usbExport.test.ts` to this list when it creates the file.

- [ ] **Step 10: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/usbVolumes.ts apps/desktop/src/main/usbVolumes.test.ts apps/desktop/src/main/windowsVolumes.ps1 apps/desktop/src/main/rawImports.d.ts apps/desktop/src/main/fixtures/win32-volumes.json apps/desktop/src/main/usbExportMemory.ts apps/desktop/src/main/usbExportMemory.test.ts apps/desktop/src/shared/types.ts .github/workflows/ci.yml
git commit -m "List removable volumes by stable identifier on macOS and Windows and remember each stick's export"
```

---
### Task 9: The exporter: summary, checks, export, progress, cancel; IPC and preload

**Files:**
- Create: `src/main/usbExport.ts`, `src/main/usbExport.test.ts`, `src/main/usbExportIpc.ts`
- Modify: `src/shared/types.ts`, `src/main/index.ts`, `src/preload/api.ts`, `src/preload/index.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`, `.github/workflows/ci.yml` (add the new test file to `usb-windows`)

**Interfaces:**
- Consumes: Tasks 3-8 (`bakenCommand`, `readExportSelection`, `stageExport`, `bakenArgs`, `runBaken`, `BakenEvent`, `systemVolumeSource`, `readVolumes`, `volumeContaining`, `watchVolumes`, `createUsbMemory`, `targetKey`).
- Produces (renderer, Tasks 10-11), in `shared/types.ts`:

```ts
export interface UsbPlanTrack { id: string; title: string; artist: string; size: number; onStick: boolean; separator: boolean; cover: string | null; wave: number[] | null }
export type UsbUnexportableReason = 'missing-file' | 'streaming' | 'skipped'
export type UsbWarning =
  | { kind: 'rekordboxExport' } | { kind: 'exfat' } | { kind: 'gpt' } | { kind: 'ntfs' } | { kind: 'notVolumeRoot' }
  | { kind: 'cdj2000'; titles: string[] }
  | { kind: 'unexportable'; tracks: { title: string; reason: UsbUnexportableReason }[] }
  | { kind: 'noSpace'; neededBytes: number; freeBytes: number }
export interface UsbPlan { tracks: UsbPlanTrack[]; trackCount: number; newCount: number; newBytes: number; keptCount: number; removedSinceLast: number | null; warnings: UsbWarning[] }
export interface UsbExportRequest { playlistIds: string[]; target: UsbTarget; prune: boolean; settings: boolean }
export type UsbFailure = 'unsupported' | 'no-collection' | 'unreadable' | 'nothing-selected' | 'volume-gone' | 'volume-changed' | 'not-removable' | 'not-volume-root' | 'no-baken' | 'refused' | 'baken-failed' | 'device-write' | 'no-space' | 'busy'
export type UsbPlanResult = { ok: true; plan: UsbPlan } | { ok: false; reason: UsbFailure }
export type UsbStartResult = { ok: true } | { ok: false; reason: UsbFailure; neededBytes?: number; freeBytes?: number }
export interface UsbFolderPick { path: string; remembered: UsbRemembered | null }
export type UsbTrackFailure = 'missing-file' | 'unreadable' | 'device'
export type UsbExportEvent =
  | { type: 'started'; tracks: UsbPlanTrack[]; targetName: string; startedAt: number }
  | { type: 'progress'; index: number; bytes: number }
  | { type: 'track'; index: number; state: 'done' | 'kept' }
  | { type: 'failed'; index: number; reason: UsbTrackFailure }
  | { type: 'cancelling' }
  | { type: 'database' }
  | { type: 'finished'; outcome: 'done'; tracks: number; failed: number; ms: number }
  | { type: 'finished'; outcome: 'cancelled' }
  | { type: 'finished'; outcome: 'error'; reason: UsbFailure }
```

and on `window.api`: `usbVolumes()`, `onUsbVolumesChanged(cb)`, `usbPickFolder()`, `usbPlan(req)`, `usbExport(req)`, `usbCancel()`, `onUsbEvent(cb)`.

- [ ] **Step 1: Add the types**

Append to `src/shared/types.ts` (after Task 8's block) exactly the types listed above, each with a one-line WHY comment where it is not obvious (`UsbPlanTrack.onStick`: "baken's size check, what is left to copy"; `UsbPlan.trackCount`: "without separators, as the tree counts"; `UsbTrackFailure`: "baken's English failure text mapped to something the UI translates; the raw text goes to the log"; `UsbExportEvent` `progress`: "bytes of the track being copied, polled from the stick").

- [ ] **Step 2: Write the failing exporter tests**

`src/main/usbExport.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UsbExportEvent, UsbExportRequest, UsbVolume } from '../shared/types'
import type { BakenEvent, BakenHandle } from './bakenRun'
import { createUsbExporter, failureReason, type UsbExporterDeps } from './usbExport'
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
    track('105', { streaming: true, title: 'Streamed' }),
  ],
}

const volume = (over: Partial<UsbVolume> = {}): UsbVolume => ({
  uuid: UUID, name: 'Surco', mountPoint: '/Volumes/Surco', filesystem: 'exfat', partitionScheme: 'mbr',
  totalBytes: 32e9, freeBytes: 20e9, holder: { by: 'empty', at: null }, remembered: null, ...over,
})

const PLAN: BakenEvent = {
  event: 'plan', volumeRoot: true,
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

type Emit = (e: BakenEvent) => void
// The fake baken: `dry` answers the dry run, `real` plays the export. `cancelled` resolves
// when Surco asks to cancel, as the stdin line does for the real one.
type Script = (emit: Emit, cancelled: Promise<void>) => Promise<void>

let memory: UsbMemory
let sent: UsbExportEvent[]
let calls: string[][]
let cancels: number
let logged: string[]

beforeEach(async () => {
  memory = createUsbMemory(join(await mkdtemp(join(tmpdir(), 'usb-exp-')), 'usb-exports.json'))
  sent = []
  calls = []
  cancels = 0
  logged = []
})

const dryPlan: Script = async (emit) => emit(PLAN)

function deps(real: Script, over: Partial<UsbExporterDeps> & { dry?: Script; started?: boolean } = {}): UsbExporterDeps {
  const { dry = dryPlan, started = true, ...rest } = over
  return {
    platform: 'darwin',
    collection: () => '/rb/master.db',
    readSelection: () => SEL,
    volumes: async () => [volume()],
    idAt: async () => UUID,
    devOf: async () => 42,
    realPath: async (p) => p,
    baken: () => ({ file: 'baken', prefixArgs: [] }),
    stage: async (_sel, dir): Promise<Stage> => ({
      dir, xml: `${dir}/c.xml`, anlzDir: `${dir}/USBANLZ`, artworkDir: `${dir}/art`, settingsDir: `${dir}/settings`,
      included: ['101', '109', '102'], missing: ['103'], sizes: new Map([['101', 70], ['109', 5], ['102', 30]]),
      waves: new Map([['101', [0.5]]]), covers: new Map(),
    }),
    makeStageDir: async () => '/tmp/stage',
    removeDir: async () => {},
    memory,
    home: '/Users/dj',
    pioneerDir: '/Users/dj/Library/Pioneer',
    systemRoot: '/',
    send: (e) => sent.push(e),
    now: () => 1000,
    fileSize: async () => 35,
    pdbFacts: async () => ({ size: 9, mtimeMs: 5 }),
    log: (m) => logged.push(m),
    pollMs: 2,
    devPollMs: 2,
    run: (_cmd, args, onEvent): BakenHandle => {
      calls.push(args)
      let cancel: () => void = () => {}
      const cancelled = new Promise<void>((r) => {
        cancel = r
      })
      const script = args.includes('--dry-run') ? dry : real
      const done = script(onEvent, cancelled).then(() => ({ code: started ? 0 : null, stderr: '', started }))
      return { done, cancel: () => { cancels++; cancel() } }
    },
    ...rest,
  }
}

const REQ: UsbExportRequest = { playlistIds: ['1000'], target: { kind: 'volume', uuid: UUID }, prune: false, settings: false }
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
const finished = async () => {
  for (let i = 0; i < 200 && !sent.some((e) => e.type === 'finished'); i++) await tick(5)
  return sent.find((e) => e.type === 'finished')
}
const realCalls = () => calls.filter((a) => !a.includes('--dry-run'))

describe('plan', () => {
  it('asks baken for a dry run and summarises what it would copy, separators not counted', async () => {
    const r = await createUsbExporter(deps(async () => {})).plan(REQ)
    expect(calls[0]).toContain('--dry-run')
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan).toMatchObject({ trackCount: 2, newCount: 1, newBytes: 70, keptCount: 1 })
    expect(r.plan.tracks.map((t) => [t.id, t.onStick, t.wave])).toEqual([
      ['101', false, [0.5]], ['109', true, null], ['102', true, null],
    ])
  })

  // Each track that cannot go is named with its reason; baken's own skip reason is English,
  // so it goes to the log and the UI gets a code.
  it('warns about what the players will not read and lists what cannot be exported', async () => {
    const dry: Script = async (emit) => emit({ ...PLAN, skipped: [{ name: 'Odd One', reason: 'unknown Kind' }] } as BakenEvent)
    const ex = createUsbExporter(deps(async () => {}, {
      dry,
      volumes: async () => [volume({ holder: { by: 'rekordbox', at: 1 }, partitionScheme: 'gpt' })],
    }))
    const r = await ex.plan(REQ)
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan.warnings).toEqual([
      { kind: 'rekordboxExport' },
      { kind: 'exfat' },
      { kind: 'gpt' },
      { kind: 'cdj2000', titles: ['No Fear'] },
      { kind: 'unexportable', tracks: [
        { title: 'Gone', reason: 'missing-file' },
        { title: 'Streamed', reason: 'streaming' },
        { title: 'Odd One', reason: 'skipped' },
      ] },
    ])
    expect(logged.join('\n')).toContain('unknown Kind')
  })

  it('warns about NTFS, which the players do not read', async () => {
    const r = await createUsbExporter(deps(async () => {}, { volumes: async () => [volume({ filesystem: 'ntfs' })] })).plan(REQ)
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'ntfs' })
  })

  // baken refuses the plan outright when it does not fit; the summary still has to say what
  // was asked for, how much it needs and how much there is.
  it('still summarises when the stick is too small', async () => {
    const dry: Script = async (emit) => emit({ event: 'error', kind: 'not-enough-space', message: 'no', needed: 10, available: 4 })
    const r = await createUsbExporter(deps(async () => {}, { dry })).plan(REQ)
    if (!r.ok) throw new Error(r.reason)
    expect(r.plan.newCount).toBe(2)
    expect(r.plan.warnings).toContainEqual({ kind: 'noSpace', neededBytes: 10, freeBytes: 4 })
  })

  it('counts what left the stick since Surco last wrote it', async () => {
    memory.remember(`volume:${UUID}`, { playlistIds: ['1000'], trackIds: ['101', '999'], at: 1, pdb: null, prune: false, settings: false })
    const ex = createUsbExporter(deps(async () => {}, { volumes: async () => [volume({ holder: { by: 'surco', at: 1 } })] }))
    const r = await ex.plan(REQ)
    expect(r.ok && r.plan.removedSinceLast).toBe(1)
  })

  it('answers why when it cannot summarise', async () => {
    const none = async () => {}
    expect(await createUsbExporter(deps(none)).plan({ ...REQ, playlistIds: [] })).toEqual({ ok: false, reason: 'nothing-selected' })
    expect(await createUsbExporter(deps(none, { collection: () => '' })).plan(REQ)).toEqual({ ok: false, reason: 'no-collection' })
    expect(await createUsbExporter(deps(none, { readSelection: () => 'unreadable' })).plan(REQ)).toEqual({ ok: false, reason: 'unreadable' })
    expect(await createUsbExporter(deps(none, { volumes: async () => [] })).plan(REQ)).toEqual({ ok: false, reason: 'volume-gone' })
    expect(await createUsbExporter(deps(none, { baken: () => null })).plan(REQ)).toEqual({ ok: false, reason: 'no-baken' })
  })

  // "Otro destino" must be on a removable volume; a folder of the system disk is refused,
  // and a folder below a stick's root only warns.
  it('refuses a folder that is not on a removable volume, and warns below the root', async () => {
    const folder = (path: string): UsbExportRequest => ({ ...REQ, target: { kind: 'folder', path } })
    const ex = createUsbExporter(deps(async () => {}, { dry: async (emit) => emit({ ...PLAN, volumeRoot: false } as BakenEvent) }))
    expect(await ex.plan(folder('/Users/dj/Music/usb'))).toEqual({ ok: false, reason: 'not-removable' })
    const r = await ex.plan(folder('/Volumes/Surco/sets'))
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'notVolumeRoot' })
  })
})

describe('start', () => {
  const happy: Script = async (emit) => {
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
    const ex = createUsbExporter(deps(happy, { idAt: async () => 'OTHER' }))
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'volume-changed' })
    expect(calls).toEqual([])
  })

  // Two presses before the first await returns: one baken, one export.
  it('runs one export even when asked twice at once', async () => {
    const ex = createUsbExporter(deps(happy))
    const [a, b] = await Promise.all([ex.start(REQ), ex.start(REQ)])
    expect([a, b]).toContainEqual({ ok: false, reason: 'busy' })
    expect([a, b]).toContainEqual({ ok: true })
    await finished()
    expect(realCalls()).toHaveLength(1)
  })

  it('releases the claim when it cannot start, so the next try runs', async () => {
    let other = true
    const ex = createUsbExporter(deps(happy, { idAt: async () => (other ? 'OTHER' : UUID) }))
    expect((await ex.start(REQ)).ok).toBe(false)
    other = false
    expect(await ex.start(REQ)).toEqual({ ok: true })
    await finished()
  })

  // The space check runs before any write, with the numbers for the message.
  it('refuses before writing when it does not fit', async () => {
    const dry: Script = async (emit) => emit({ ...PLAN, spaceNeeded: 3_100, spaceAvailable: 1_700 } as BakenEvent)
    const ex = createUsbExporter(deps(happy, { dry }))
    expect(await ex.start(REQ)).toEqual({ ok: false, reason: 'no-space', neededBytes: 3_100, freeBytes: 1_700 })
    expect(realCalls()).toEqual([])
  })

  // A stick mounted somewhere below its own root would get an unreadable library.
  it('refuses a volume target that is not a volume root', async () => {
    const dry: Script = async (emit) => emit({ ...PLAN, volumeRoot: false } as BakenEvent)
    expect(await createUsbExporter(deps(happy, { dry })).start(REQ)).toEqual({ ok: false, reason: 'not-volume-root' })
  })

  it('never prunes a folder target, even when asked', async () => {
    const ex = createUsbExporter(deps(happy))
    await ex.start({ ...REQ, prune: true, target: { kind: 'folder', path: '/Volumes/Surco/sets' } })
    await finished()
    expect(realCalls()[0]).not.toContain('--prune')
  })

  it('passes My Settings only when asked', async () => {
    const ex = createUsbExporter(deps(happy))
    await ex.start(REQ)
    await finished()
    expect(realCalls()[0]).toContain('--no-settings')
  })

  it('tells the renderer each track as it lands, then done, and remembers the stick', async () => {
    const ex = createUsbExporter(deps(happy))
    expect(await ex.start({ ...REQ, settings: true })).toEqual({ ok: true })
    // three tracks in the database, the separator not counted
    expect(await finished()).toEqual({ type: 'finished', outcome: 'done', tracks: 2, failed: 0, ms: 0 })
    const types = sent.filter((e) => e.type !== 'progress').map((e) => (e.type === 'track' ? `${e.index} ${e.state}` : e.type))
    expect(types).toEqual(['started', '0 done', '1 kept', '2 kept', 'database', 'finished'])
    expect(memory.get(`volume:${UUID}`)).toMatchObject({ playlistIds: ['1000'], trackIds: ['101', '109', '102'], pdb: { size: 9, mtimeMs: 5 }, settings: true })
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

  // baken's failure text is English: the row gets a code, the log gets the text.
  it('maps a failed track to a reason code and logs the raw text', async () => {
    const ex = createUsbExporter(deps(async (emit) => {
      emit(PLAN)
      emit({ event: 'failed', index: 0, message: 'No such file or directory (os error 2)' })
      emit({ ...REPORT, failures: [{ name: 'T101', message: 'No such file or directory (os error 2)' }] } as BakenEvent)
    }))
    await ex.start(REQ)
    await finished()
    expect(sent).toContainEqual({ type: 'failed', index: 0, reason: 'missing-file' })
    expect(logged.join('\n')).toContain('os error 2')
    expect(failureReason('Cannot write to the stick: /Volumes/Surco: Read-only file system')).toBe('device')
    expect(failureReason('could not decode the FLAC frames')).toBe('unreadable')
  })

  // Cancel is a request: baken finishes the track it copies and reports. Surco waits; it
  // never kills it, which could truncate audio the previous library references.
  it('asks baken to cancel and waits for its report', async () => {
    const ex = createUsbExporter(deps(async (emit, cancelled) => {
      emit(PLAN)
      emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
      await cancelled
      emit({ event: 'written', index: 0, kept: false })
      emit({ ...REPORT, cancelled: true } as BakenEvent)
    }))
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(true)
    expect(cancels).toBe(1)
    expect(sent).toContainEqual({ type: 'cancelling' })
    expect(await finished()).toEqual({ type: 'finished', outcome: 'cancelled' })
    expect(memory.get(`volume:${UUID}`)).toBeNull()
  })

  // Between export.pdb and exportLibrary.db a stop would leave two different libraries.
  it('does not cancel once the database is being written', async () => {
    const ex = createUsbExporter(deps(async (emit) => { emit(PLAN); emit({ event: 'database' }); await tick(30); emit(REPORT) }))
    await ex.start(REQ)
    await tick()
    expect(ex.cancel()).toBe(false)
    expect(cancels).toBe(0)
    expect((await finished())?.type).toBe('finished')
  })

  // Another stick taking the same mount point or drive letter mid-run changes the device
  // number: the export stops at the next track and says the stick went away.
  it('cancels when the volume under the target changes', async () => {
    let dev = 42
    const ex = createUsbExporter(deps(async (emit, cancelled) => {
      emit(PLAN)
      emit({ event: 'start', index: 0, usbPath: '/Contents/A/UnknownAlbum/101.wav', size: 70 })
      dev = 7
      await cancelled
      emit({ ...REPORT, cancelled: true } as BakenEvent)
    }, { devOf: async () => dev }))
    await ex.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
    expect(cancels).toBe(1)
  })

  it('says the stick went away when it was unplugged mid-export', async () => {
    let mounted = true
    const ex = createUsbExporter(deps(async (emit) => {
      emit(PLAN)
      mounted = false
      emit({ event: 'error', kind: 'device-write', message: 'gone' })
    }, { volumes: async () => (mounted ? [volume()] : []) }))
    await ex.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
  })

  it('maps a full stick, a baken that never starts, and an unknown failure', async () => {
    const full = createUsbExporter(deps(async (emit) => { emit(PLAN); emit({ event: 'error', kind: 'not-enough-space', message: '' }) }))
    await full.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'no-space' })
    sent = []
    const never = createUsbExporter(deps(async () => {}, { started: false, dry: async () => {} }))
    expect(await never.start(REQ)).toEqual({ ok: false, reason: 'no-baken' })
    const silent = createUsbExporter(deps(async () => {}))
    await silent.start(REQ)
    expect(await finished()).toEqual({ type: 'finished', outcome: 'error', reason: 'baken-failed' })
  })
})

describe('Windows paths', () => {
  // Same rules with a drive letter: the identifier is the volume GUID, the root E:\.
  it('exports to a drive root by its volume GUID', async () => {
    const guid = '{6f1c2a7e-3b4d-11f0-9c2a-806e6f6e6963}'
    const ex = createUsbExporter(deps(async (emit) => { emit(PLAN); emit(REPORT) }, {
      platform: 'win32',
      volumes: async () => [volume({ uuid: guid, mountPoint: 'E:\\', filesystem: 'fat32' })],
      idAt: async (root) => (root === 'E:\\' ? guid : null),
      home: 'C:\\Users\\dj',
      pioneerDir: 'C:\\Users\\dj\\AppData\\Roaming\\Pioneer',
      systemRoot: 'C:\\',
    }))
    expect(await ex.start({ ...REQ, target: { kind: 'volume', uuid: guid } })).toEqual({ ok: true })
    expect((await finished())?.type).toBe('finished')
    expect(realCalls()[0]).toContain('E:\\')
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExport.test.ts`
Expected: FAIL, `Cannot find module './usbExport'`.

- [ ] **Step 4: Implement the exporter**

`src/main/usbExport.ts`:

```ts
import { posix, win32 } from 'node:path'
import type {
  UsbExportEvent, UsbExportRequest, UsbFailure, UsbPlan, UsbPlanResult, UsbPlanTrack, UsbStartResult,
  UsbTarget, UsbTrackFailure, UsbVolume, UsbWarning,
} from '../shared/types'
import { type BakenError, type BakenEvent, type BakenPlan, type BakenReport, bakenArgs, runBaken } from './bakenRun'
import { type UsbMemory, targetKey } from './usbExportMemory'
import type { ExportSelection } from './usbExportSource'
import type { Stage } from './usbExportStage'
import { volumeContaining } from './usbVolumes'

// One USB export at a time: a dry run of baken for the summary; for an export, the claim,
// the identity check, a dry run for the root and the space, then the real run while the
// volume's device number is watched. Everything that touches the disk, the collection or a
// process comes in through deps, so the rules here are tested without any.

export interface UsbExporterDeps {
  platform: NodeJS.Platform
  collection: () => string
  readSelection: (dbPath: string, ids: string[]) => ExportSelection | 'unreadable'
  volumes: () => Promise<UsbVolume[]>
  idAt: (root: string) => Promise<string | null>
  devOf: (root: string) => Promise<number | null>
  realPath: (path: string) => Promise<string | null>
  baken: () => { file: string; prefixArgs: string[] } | null
  stage: (sel: ExportSelection, dir: string) => Promise<Stage>
  makeStageDir: () => Promise<string>
  removeDir: (dir: string) => Promise<void>
  memory: UsbMemory
  home: string
  pioneerDir: string
  systemRoot: string
  send: (e: UsbExportEvent) => void
  now: () => number
  fileSize: (path: string) => Promise<number | null>
  pdbFacts: (root: string) => Promise<{ size: number; mtimeMs: number } | null>
  log: (message: string) => void
  pollMs?: number
  devPollMs?: number
  run?: typeof runBaken
}

interface Target {
  root: string
  name: string
  volume: UsbVolume | null
  kind: 'volume' | 'folder'
}

interface Prepared {
  target: Target
  sel: ExportSelection
  stage: Stage
}

const CDJ2000_FLAC = 5

// baken's per-track failure texts are English and for a terminal; the UI gets a code.
export function failureReason(message: string): UsbTrackFailure {
  const m = message.toLowerCase()
  if (/no such file|not found|cannot find|os error 2\b/.test(m)) return 'missing-file'
  if (/stick|device|disappeared|read-only|no space|os error 28\b/.test(m)) return 'device'
  return 'unreadable'
}

async function resolveTarget(deps: UsbExporterDeps, t: UsbTarget): Promise<Target | UsbFailure> {
  const volumes = await deps.volumes()
  if (t.kind === 'volume') {
    const v = volumes.find((x) => x.uuid === t.uuid)
    return v ? { root: v.mountPoint, name: v.name, volume: v, kind: 'volume' } : 'volume-gone'
  }
  const real = await deps.realPath(t.path)
  if (!real) return 'volume-gone'
  const on = volumeContaining(volumes, real, deps.platform)
  if (!on) return 'not-removable'
  const name = (deps.platform === 'win32' ? win32 : posix).basename(real)
  return { root: real, name, volume: volumes.find((v) => v.uuid === on.uuid) ?? null, kind: 'folder' }
}

async function prepare(deps: UsbExporterDeps, req: UsbExportRequest): Promise<Prepared | UsbFailure> {
  if (req.playlistIds.length === 0) return 'nothing-selected'
  const db = deps.collection()
  if (!db) return 'no-collection'
  if (!deps.baken()) return 'no-baken'
  const target = await resolveTarget(deps, req.target)
  if (typeof target === 'string') return target
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

function warningsOf(
  deps: UsbExporterDeps,
  p: Prepared,
  plan: BakenPlan | null,
  noSpace: { neededBytes: number; freeBytes: number } | null,
): UsbWarning[] {
  const out: UsbWarning[] = []
  const v = p.target.volume
  if (v?.holder.by === 'rekordbox' && p.target.kind === 'volume') out.push({ kind: 'rekordboxExport' })
  if (v?.filesystem === 'exfat') out.push({ kind: 'exfat' })
  if (v?.filesystem === 'ntfs') out.push({ kind: 'ntfs' })
  if (v?.partitionScheme === 'gpt') out.push({ kind: 'gpt' })
  if (p.target.kind === 'folder' && plan && !plan.volumeRoot) out.push({ kind: 'notVolumeRoot' })
  const included = new Set(p.stage.included)
  const old = p.sel.tracks.filter(
    (t) => included.has(t.id) && (t.fileType === CDJ2000_FLAC || t.bitDepth > 24 || t.sampleRate > 48000),
  )
  if (old.length) out.push({ kind: 'cdj2000', titles: old.map((t) => t.title) })
  const missing = new Set(p.stage.missing)
  for (const s of plan?.skipped ?? []) deps.log(`baken skipped ${s.name}: ${s.reason}`)
  const unexportable = [
    ...p.sel.tracks.filter((t) => missing.has(t.id)).map((t) => ({ title: t.title, reason: 'missing-file' as const })),
    ...p.sel.tracks.filter((t) => t.streaming).map((t) => ({ title: t.title, reason: 'streaming' as const })),
    ...(plan?.skipped ?? []).map((s) => ({ title: s.name, reason: 'skipped' as const })),
  ]
  if (unexportable.length) out.push({ kind: 'unexportable', tracks: unexportable })
  if (noSpace) out.push({ kind: 'noSpace', ...noSpace })
  return out
}

function summary(deps: UsbExporterDeps, p: Prepared, req: UsbExportRequest, tracks: UsbPlanTrack[], warnings: UsbWarning[]): UsbPlan {
  const real = tracks.filter((t) => !t.separator)
  const entry = deps.memory.get(targetKey(req.target))
  const ours = p.target.kind === 'folder' || p.target.volume?.holder.by === 'surco'
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

type DryRun = { plan: BakenPlan | null; error: BakenError | null; started: boolean }

export function createUsbExporter(deps: UsbExporterDeps) {
  const run = deps.run ?? runBaken
  // Claimed synchronously at the top of start(), before any await: two quick presses must
  // never start two bakens on one stick.
  let running: { phase: 'starting' | 'tracks' | 'database'; cancelling: boolean; cancel: () => void } | null = null

  const argsFor = (p: Prepared, req: UsbExportRequest, dryRun: boolean): string[] | null => {
    try {
      return bakenArgs({
        stage: p.stage,
        device: p.target.root,
        target: p.target.kind,
        prune: req.prune,
        settings: req.settings,
        dryRun,
        platform: deps.platform,
        home: deps.home,
        pioneerDir: deps.pioneerDir,
        systemRoot: deps.systemRoot,
      })
    } catch {
      return null
    }
  }

  async function dryRun(p: Prepared, req: UsbExportRequest): Promise<DryRun | 'refused'> {
    const args = argsFor(p, req, true)
    if (!args) return 'refused'
    let plan: BakenPlan | null = null
    let error: BakenError | null = null
    const { started } = await run(deps.baken() as { file: string; prefixArgs: string[] }, args, (e) => {
      if (e.event === 'plan') plan = e
      if (e.event === 'error') error = e
    }).done
    return { plan, error, started }
  }

  const shortOf = (d: DryRun): { neededBytes: number; freeBytes: number } | null => {
    if (d.error?.kind === 'not-enough-space')
      return { neededBytes: d.error.needed ?? 0, freeBytes: d.error.available ?? 0 }
    if (d.plan && d.plan.spaceAvailable !== null && d.plan.spaceNeeded > d.plan.spaceAvailable)
      return { neededBytes: d.plan.spaceNeeded, freeBytes: d.plan.spaceAvailable }
    return null
  }

  async function plan(req: UsbExportRequest): Promise<UsbPlanResult> {
    const p = await prepare(deps, req)
    if (typeof p === 'string') return { ok: false, reason: p }
    try {
      const d = await dryRun(p, req)
      if (d === 'refused') return { ok: false, reason: 'refused' }
      if (!d.started) return { ok: false, reason: 'no-baken' }
      const short = shortOf(d)
      if (!d.plan && !short) return { ok: false, reason: d.error?.kind === 'device-write' ? 'device-write' : 'baken-failed' }
      if (d.plan && !d.plan.volumeRoot && p.target.kind === 'volume') return { ok: false, reason: 'not-volume-root' }
      const tracks = planTracks(p, d.plan)
      return { ok: true, plan: summary(deps, p, req, tracks, warningsOf(deps, p, d.plan, short)) }
    } finally {
      await deps.removeDir(p.stage.dir)
    }
  }

  async function failureAfter(error: BakenError | null, req: UsbExportRequest): Promise<UsbFailure> {
    if (error?.kind === 'not-enough-space') return 'no-space'
    if (error?.kind === 'device-write' || error?.kind === 'device-not-found') {
      // A stick pulled out mid-copy reads as a write error; say what really happened.
      const t = req.target
      if (t.kind === 'volume' && !(await deps.volumes()).some((v) => v.uuid === t.uuid)) return 'volume-gone'
      return 'device-write'
    }
    return 'baken-failed'
  }

  async function start(req: UsbExportRequest): Promise<UsbStartResult> {
    if (running) return { ok: false, reason: 'busy' }
    const state: { phase: 'starting' | 'tracks' | 'database'; cancelling: boolean; cancel: () => void } = {
      phase: 'starting',
      cancelling: false,
      cancel: () => {},
    }
    running = state
    let staged: Prepared | null = null
    const refuse = async (reason: UsbFailure, extra: { neededBytes?: number; freeBytes?: number } = {}): Promise<UsbStartResult> => {
      running = null
      if (staged) await deps.removeDir(staged.stage.dir)
      return { ok: false, reason, ...extra }
    }
    try {
      const p = await prepare(deps, req)
      if (typeof p === 'string') return refuse(p)
      staged = p
      if (req.target.kind === 'volume' && (await deps.idAt(p.target.root)) !== req.target.uuid) return refuse('volume-changed')
      const dev = await deps.devOf(p.target.root)
      if (dev === null) return refuse('volume-gone')
      const d = await dryRun(p, req)
      if (d === 'refused') return refuse('refused')
      if (!d.started) return refuse('no-baken')
      const short = shortOf(d)
      if (short) return refuse('no-space', short)
      if (!d.plan) return refuse(await failureAfter(d.error, req))
      if (!d.plan.volumeRoot && p.target.kind === 'volume') return refuse('not-volume-root')
      const args = argsFor(p, req, false)
      if (!args) return refuse('refused')
      return launch(p, req, args, dev, state)
    } catch (err) {
      deps.log(`usb export did not start: ${String(err)}`)
      return refuse('baken-failed')
    }
  }

  function launch(
    p: Prepared,
    req: UsbExportRequest,
    args: string[],
    dev: number,
    state: { phase: 'starting' | 'tracks' | 'database'; cancelling: boolean; cancel: () => void },
  ): UsbStartResult {
    const startedAt = deps.now()
    const join = (deps.platform === 'win32' ? win32 : posix).join
    let tracks: UsbPlanTrack[] = []
    const written = new Set<number>()
    let current = -1
    let poll: NodeJS.Timeout | null = null
    let report: BakenReport | null = null
    let error: BakenError | null = null
    let lostVolume = false
    state.phase = 'tracks'
    const stopPoll = (): void => {
      if (poll) clearInterval(poll)
      poll = null
      current = -1
    }
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
          written.add(e.index)
          deps.send({ type: 'track', index: e.index, state: e.kept ? 'kept' : 'done' })
          break
        case 'failed':
          stopPoll()
          deps.log(`usb export track ${e.index} failed: ${e.message}`)
          deps.send({ type: 'failed', index: e.index, reason: failureReason(e.message) })
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
    const handle = run(deps.baken() as { file: string; prefixArgs: string[] }, args, onEvent)
    state.cancel = handle.cancel
    // Another volume under the same mount point or drive letter changes the device number
    // (on Windows it is the volume serial): stop at the next track.
    const watch = setInterval(() => {
      void deps.devOf(p.target.root).then((now) => {
        if (now === dev || lostVolume) return
        lostVolume = true
        if (state.phase === 'tracks') handle.cancel()
      })
    }, deps.devPollMs ?? 1000)
    void handle.done.then(async ({ started }) => {
      stopPoll()
      clearInterval(watch)
      running = null
      try {
        const r = report as BakenReport | null
        if (r && !r.cancelled) {
          for (const f of r.failures) deps.log(`usb export failed ${f.name}: ${f.message}`)
          deps.memory.remember(targetKey(req.target), {
            playlistIds: req.playlistIds,
            trackIds: tracks.map((t) => t.id),
            at: deps.now(),
            pdb: await deps.pdbFacts(p.target.root),
            prune: req.prune,
            settings: req.settings,
          })
          const counted = tracks.filter((t, i) => !t.separator && written.has(i)).length
          deps.send({ type: 'finished', outcome: 'done', tracks: counted, failed: r.failures.length, ms: deps.now() - startedAt })
        } else if (lostVolume) deps.send({ type: 'finished', outcome: 'error', reason: 'volume-gone' })
        else if (r?.cancelled) deps.send({ type: 'finished', outcome: 'cancelled' })
        else deps.send({ type: 'finished', outcome: 'error', reason: started ? await failureAfter(error, req) : 'no-baken' })
      } finally {
        await deps.removeDir(p.stage.dir)
      }
    })
    return { ok: true }
  }

  // Only while tracks are copying, and only as a request: baken finishes the track in
  // progress and reports. Once it writes the databases, stopping could leave export.pdb new
  // and exportLibrary.db old: two libraries on one stick.
  function cancel(): boolean {
    if (!running || running.phase !== 'tracks' || running.cancelling) return false
    running.cancelling = true
    running.cancel()
    deps.send({ type: 'cancelling' })
    return true
  }

  return { plan, start, cancel, busy: () => running !== null }
}
```

- [ ] **Step 5: Run them to see them pass, then mutate the safety rules**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/usbExport.test.ts`
Expected: PASS (23). Then break each rule on purpose and see its test go red, restoring each time: move `running = state` below the first `await` (`runs one export even when asked twice at once`); delete the `idAt` comparison (`writes nothing when another stick sits at the mount point`); delete the `phase !== 'tracks'` guard (`does not cancel once the database is being written`); pass `prune: req.prune` without the target check in `bakenArgs` (Task 7's `prunes only a volume` and `never prunes a folder target`); remove `if (short) return refuse(...)` (`refuses before writing when it does not fit`).

- [ ] **Step 6: IPC**

`src/main/usbExportIpc.ts`:

```ts
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log/main'
import type { UsbExportRequest, UsbFolderPick, UsbVolumeList } from '../shared/types'
import { openRekordboxDb } from './rekordboxDb'
import { createUsbExporter } from './usbExport'
import { createUsbMemory, targetKey } from './usbExportMemory'
import { readExportSelection } from './usbExportSource'
import { stageExport } from './usbExportStage'
import { readVolumes, systemVolumeSource, watchVolumes } from './usbVolumes'

// The USB export's IPC, macOS and Windows. Elsewhere every call answers "unsupported" and
// nothing is watched; the renderer does not offer the feature there at all.
export function registerUsbExportIpc(opts: {
  collection: () => string
  userData: string
  home: string
  // %APPDATA% on Windows (app.getPath('appData')); unused on macOS.
  appData: string
  baken: () => { file: string; prefixArgs: string[] } | null
}): void {
  const platform = process.platform
  const source = systemVolumeSource(platform)
  if (!source) {
    ipcMain.handle('usb:volumes', (): UsbVolumeList => ({ volumes: [], lastKey: null }))
    ipcMain.handle('usb:pickFolder', () => null)
    ipcMain.handle('usb:plan', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:export', () => ({ ok: false, reason: 'unsupported' }))
    ipcMain.handle('usb:cancel', () => false)
    return
  }
  const win = platform === 'win32'
  // rekordbox's own folders: never written, never handed to baken.
  const pioneerDir = win ? join(opts.appData, 'Pioneer') : join(opts.home, 'Library', 'Pioneer')
  const settingsSource = win
    ? join(opts.appData, 'Pioneer', 'rekordbox6')
    : join(opts.home, 'Library', 'Application Support', 'Pioneer', 'rekordbox6')
  const systemRoot = win ? `${process.env.SystemDrive ?? 'C:'}\\` : '/'
  const memory = createUsbMemory(join(opts.userData, 'usb-exports.json'))
  const broadcast = (channel: string, payload: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }
  const list = async (): Promise<UsbVolumeList> => ({
    volumes: await readVolumes(source, memory),
    lastKey: memory.last(),
  })
  const exporter = createUsbExporter({
    platform,
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
    volumes: () => readVolumes(source, memory),
    idAt: (root) => source.idAt(root),
    devOf: (root) => stat(root).then((s) => s.dev).catch(() => null),
    realPath: (p) => realpath(p).catch(() => null),
    baken: opts.baken,
    // rekordbox keeps the analysis and artwork beside master.db, in share/.
    stage: (sel, dir) =>
      stageExport({ sel, shareDir: join(dirname(opts.collection()), 'share'), settingsSource, dir }),
    makeStageDir: () => mkdtemp(join(tmpdir(), 'surco-usb-')),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),
    memory,
    home: opts.home,
    pioneerDir,
    systemRoot,
    send: (e) => broadcast('usb:event', e),
    now: () => Date.now(),
    fileSize: (path) => stat(path).then((s) => s.size).catch(() => null),
    pdbFacts: (root) =>
      stat(join(root, 'PIONEER', 'rekordbox', 'export.pdb'))
        .then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }))
        .catch(() => null),
    log: (m) => log.info(m),
  })
  // Watching starts with the first request for the list (the rail offers the export only
  // with a rekordbox collection), not at launch for every user.
  let unwatch: (() => void) | null = null
  ipcMain.handle('usb:volumes', () => {
    unwatch ??= watchVolumes(platform, () => void list().then((l) => broadcast('usb:volumesChanged', l)))
    return list()
  })
  ipcMain.handle('usb:pickFolder', async (e): Promise<UsbFolderPick | null> => {
    const w = BrowserWindow.fromWebContents(e.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const { canceled, filePaths } = w ? await dialog.showOpenDialog(w, options) : await dialog.showOpenDialog(options)
    if (canceled || !filePaths[0]) return null
    // The real path: one folder reached through a symlink or directly is one memory.
    const path = await realpath(filePaths[0]).catch(() => filePaths[0])
    const entry = memory.get(targetKey({ kind: 'folder', path }))
    return {
      path,
      remembered: entry ? { playlistIds: entry.playlistIds, prune: false, settings: entry.settings ?? false, at: entry.at } : null,
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
    appData: app.getPath('appData'),
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
  // The USB export (macOS and Windows). Volumes come by stable identifier; the event feeds
  // the progress list and the toolbar pill, also with the modal closed.
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

`src/scenarios/harness.tsx`, in `wired` after `editRekordboxPlaylist` (App subscribes to the event feed on mount):

```ts
    usbVolumes: async () => ({ volumes: [], lastKey: null }),
    onUsbVolumesChanged: () => () => {},
    onUsbEvent: () => () => {},
```

`.github/workflows/ci.yml`, in `usb-windows`'s test step, append `src/main/usbExport.test.ts` to the list.

- [ ] **Step 8: Types, the whole main suite, lint, commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
cd apps/desktop && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main && cd ../..
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/main/usbExport.ts apps/desktop/src/main/usbExport.test.ts apps/desktop/src/main/usbExportIpc.ts apps/desktop/src/main/index.ts apps/desktop/src/shared/types.ts apps/desktop/src/preload apps/desktop/src/renderer/src/test/api.ts apps/desktop/src/scenarios/harness.tsx .github/workflows/ci.yml
git commit -m "Summarise and run the USB export with baken, checking the stick first"
```

Expected: tsc clean; `src/main` all PASS (none skipped).

---
### Task 10: The exporting face: the store, and the track list whose waveforms fill as bytes land

**Files:**
- Create: `src/renderer/src/lib/usbExport.ts`, `src/renderer/src/lib/usbExport.test.ts`
- Create: `src/renderer/src/lib/usbExportStore.ts`, `src/renderer/src/lib/usbExportStore.test.tsx`
- Create: `src/renderer/src/components/TrackWave.tsx`, `src/renderer/src/components/ExportTrackRow.tsx`, `src/renderer/src/components/UsbExportProgress.tsx`, `src/renderer/src/components/UsbExportPill.tsx`, `src/renderer/src/components/UsbTopProgress.tsx`, `src/renderer/src/components/UsbExportProgress.test.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json` (`usbExport.progress`, `usbExport.trackFailure`, `usbExport.span`, `usbExport.fs`, `usbExport.errors`)

**Interfaces:**
- Consumes: `UsbExportEvent`, `UsbPlanTrack`, `UsbFailure`, `UsbTrackFailure`, `UsbFilesystem` (Task 9); `formatFileSize` (`lib/properties.ts`); `prefersReducedMotion` (`lib/motion.ts`, already in the repo); `TopProgressBar`.
- Produces (Task 11):

```ts
// lib/usbExport.ts
export type RowState = 'queued' | 'copying' | 'done' | 'kept' | 'failed'
export interface ExportRow { track: UsbPlanTrack; state: RowState; bytes: number; failure: UsbTrackFailure | null }
export interface UsbExportState {
  phase: 'idle' | 'copying' | 'database' | 'done' | 'cancelled' | 'error'
  cancelling: boolean
  rows: ExportRow[]; targetName: string; startedAt: number
  samples: { at: number; bytes: number }[]
  result: { tracks: number; failed: number; ms: number } | null
  reason: UsbFailure | null
}
export const IDLE_EXPORT: UsbExportState
export type UsbExportAction = UsbExportEvent | { type: 'reset' }
export function usbExportReducer(s: UsbExportState, a: UsbExportAction, now: number): UsbExportState
export function isRunning(s: UsbExportState): boolean
export function exportCounts(s: UsbExportState): { done: number; total: number }   // separators never counted
export function bytesDone(s: UsbExportState): number
export function bytesToCopy(s: UsbExportState): number
export function speed(s: UsbExportState): number | null        // bytes per second
export function timeLeft(s: UsbExportState): number | null     // ms
export function formatSpan(ms: number, tr: (k: string, o?: Record<string, unknown>) => string): string
export function wavePath(bars: number[]): string
export const FLAT_WAVE: number[]

// lib/usbExportStore.ts
export interface UsbExportStore { getState(): UsbExportState; subscribe(l: () => void): () => void; dispatch(a: UsbExportAction): void }
export function createUsbExportStore(now?: () => number): UsbExportStore
export const usbExportStore: UsbExportStore
export function useUsbExportState<T>(selector: (s: UsbExportState) => T, store?: UsbExportStore): T
export function connectUsbExportFeed(store?: UsbExportStore): () => void

// components
export function TrackWave(props: { bars: number[] | null; state: RowState; fraction: number }): JSX.Element
export const ExportTrackRow: React.MemoExoticComponent<(props: { index: number; store?: UsbExportStore }) => JSX.Element>
export function UsbExportProgress(props: {
  footer: { name: string; freeBytes: number | null; filesystem: UsbFilesystem | null }
  onBackground: () => void; onCancel: () => void; onClose: () => void; store?: UsbExportStore
}): JSX.Element
export function UsbExportPill(props: { hidden: boolean; onOpen: () => void; store?: UsbExportStore }): JSX.Element | null
export function UsbTopProgress(props: { store?: UsbExportStore }): JSX.Element | null
```

Why a store: App holds most of the screen. A progress tick every 250 ms that re-rendered App would repaint the list, the editor and the player for a byte count. Each consumer subscribes with `useSyncExternalStore` to the slice it draws; selectors return primitives or the row object itself (stable between ticks that do not touch it).

- [ ] **Step 1: Write the failing lib tests**

`src/renderer/src/lib/usbExport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { UsbPlanTrack } from '../../../shared/types'
import {
  bytesDone, bytesToCopy, exportCounts, formatSpan, IDLE_EXPORT, isRunning, speed, timeLeft, type UsbExportAction,
  usbExportReducer, wavePath,
} from './usbExport'

const t = (id: string, size: number, onStick = false, separator = false): UsbPlanTrack => ({
  id, title: id, artist: 'A', size, onStick, separator, cover: null, wave: null,
})
const TRACKS = [t('a', 100), t('b', 50, true), t('c', 200)]
const STARTED: UsbExportAction = { type: 'started', tracks: TRACKS, targetName: 'Surco', startedAt: 0 }

const run = (...steps: [UsbExportAction, number][]) =>
  steps.reduce((s, [e, now]) => usbExportReducer(s, e, now), IDLE_EXPORT)

describe('usbExportReducer', () => {
  it('queues every track when the export starts', () => {
    const s = run([STARTED, 0])
    expect(s.phase).toBe('copying')
    expect(isRunning(s)).toBe(true)
    expect(s.rows.map((r) => r.state)).toEqual(['queued', 'queued', 'queued'])
  })

  it('follows a track from copying to done, and one already there to kept', () => {
    const s = run(
      [STARTED, 0],
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

  // The separator is a track on the stick but never a number the user reads.
  it('never counts separators', () => {
    const s = run(
      [{ type: 'started', tracks: [t('a', 1), t('sep', 1, false, true), t('c', 1)], targetName: 'S', startedAt: 0 }, 0],
      [{ type: 'track', index: 1, state: 'done' }, 1],
    )
    expect(exportCounts(s)).toEqual({ done: 0, total: 2 })
  })

  it('records a failed track with its reason code and goes on', () => {
    const s = run([STARTED, 0], [{ type: 'failed', index: 1, reason: 'missing-file' }, 10])
    expect(s.rows[1]).toMatchObject({ state: 'failed', failure: 'missing-file' })
    expect(s.phase).toBe('copying')
  })

  it('knows a cancel was asked, then ends done, cancelled or with a reason', () => {
    expect(run([STARTED, 0], [{ type: 'cancelling' }, 1]).cancelling).toBe(true)
    expect(run([STARTED, 0], [{ type: 'database' }, 1]).phase).toBe('database')
    expect(run([STARTED, 0], [{ type: 'finished', outcome: 'done', tracks: 3, failed: 0, ms: 64000 }, 1]).result).toEqual({ tracks: 3, failed: 0, ms: 64000 })
    expect(run([STARTED, 0], [{ type: 'finished', outcome: 'cancelled' }, 1]).phase).toBe('cancelled')
    expect(run([STARTED, 0], [{ type: 'finished', outcome: 'error', reason: 'volume-gone' }, 1]).reason).toBe('volume-gone')
  })

  it('goes back to idle on reset', () => {
    expect(run([STARTED, 0], [{ type: 'reset' }, 1])).toEqual(IDLE_EXPORT)
  })
})

describe('speed and time left', () => {
  // Measured over the last few seconds, not since the start: the first tracks may have
  // been on the stick already, and the NAS warms up.
  it('measures the recent rate and what is left at that rate', () => {
    const s = run([STARTED, 0], [{ type: 'progress', index: 0, bytes: 50 }, 1000], [{ type: 'progress', index: 0, bytes: 100 }, 2000])
    expect(speed(s)).toBe(50)
    expect(timeLeft(s)).toBe(4000)
  })

  it('knows nothing before two samples', () => {
    const s = run([STARTED, 0])
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

`src/renderer/src/lib/usbExportStore.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { UsbExportEvent } from '../../../shared/types'
import { stubApi } from '../test/api'
import { connectUsbExportFeed, createUsbExportStore, useUsbExportState } from './usbExportStore'

const STARTED: UsbExportEvent = {
  type: 'started',
  tracks: [{ id: 'a', title: 'A', artist: '', size: 10, onStick: false, separator: false, cover: null, wave: null }],
  targetName: 'Surco',
  startedAt: 0,
}

describe('usbExportStore', () => {
  // The export outlives the modal: the main process events feed a store App never owns.
  it('folds the main process events in', () => {
    let emit: (e: UsbExportEvent) => void = () => {}
    ;(window as unknown as { api: Api }).api = stubApi({ onUsbEvent: (cb) => { emit = cb; return () => {} } })
    const store = createUsbExportStore(() => 0)
    const off = connectUsbExportFeed(store)
    emit(STARTED)
    expect(store.getState().phase).toBe('copying')
    off()
  })

  // A byte tick must not re-render a component that only reads the phase.
  it('re-renders a subscriber only when its slice changes', () => {
    const store = createUsbExportStore(() => 0)
    store.dispatch(STARTED)
    const renders = vi.fn()
    renderHook(() => {
      renders()
      return useUsbExportState((s) => s.phase, store)
    })
    const before = renders.mock.calls.length
    act(() => store.dispatch({ type: 'progress', index: 0, bytes: 5 }))
    expect(renders.mock.calls.length).toBe(before)
    act(() => store.dispatch({ type: 'database' }))
    expect(renders.mock.calls.length).toBe(before + 1)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/usbExport.test.ts src/renderer/src/lib/usbExportStore.test.tsx`
Expected: FAIL, `Cannot find module './usbExport'`.

- [ ] **Step 3: Implement the lib and the store**

`src/renderer/src/lib/usbExport.ts`:

```ts
import type { UsbExportEvent, UsbFailure, UsbPlanTrack, UsbTrackFailure } from '../../../shared/types'

// The running USB export as the renderer sees it, folded from the main process's events.
// Held in lib/usbExportStore, outside React, so closing the modal never loses it and a byte
// tick repaints only what reads it.

export type RowState = 'queued' | 'copying' | 'done' | 'kept' | 'failed'

export interface ExportRow {
  track: UsbPlanTrack
  state: RowState
  bytes: number
  failure: UsbTrackFailure | null
}

export interface UsbExportState {
  phase: 'idle' | 'copying' | 'database' | 'done' | 'cancelled' | 'error'
  // Cancel was asked; baken is finishing the track it copies.
  cancelling: boolean
  rows: ExportRow[]
  targetName: string
  startedAt: number
  samples: { at: number; bytes: number }[]
  result: { tracks: number; failed: number; ms: number } | null
  reason: UsbFailure | null
}

export const IDLE_EXPORT: UsbExportState = {
  phase: 'idle',
  cancelling: false,
  rows: [],
  targetName: '',
  startedAt: 0,
  samples: [],
  result: null,
  reason: null,
}

export type UsbExportAction = UsbExportEvent | { type: 'reset' }

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

export function usbExportReducer(s: UsbExportState, e: UsbExportAction, now: number): UsbExportState {
  switch (e.type) {
    case 'reset':
      return IDLE_EXPORT
    case 'started':
      return {
        ...IDLE_EXPORT,
        phase: 'copying',
        rows: e.tracks.map((track) => ({ track, state: 'queued', bytes: 0, failure: null })),
        targetName: e.targetName,
        startedAt: e.startedAt,
        samples: [{ at: now, bytes: 0 }],
      }
    case 'progress':
      return sampled({ ...s, rows: withRow(s, e.index, { state: 'copying', bytes: e.bytes }) }, now)
    case 'track':
      return sampled(
        { ...s, rows: withRow(s, e.index, { state: e.state, bytes: e.state === 'done' ? (s.rows[e.index]?.track.size ?? 0) : 0 }) },
        now,
      )
    case 'failed':
      return { ...s, rows: withRow(s, e.index, { state: 'failed', bytes: 0, failure: e.reason }) }
    case 'cancelling':
      return { ...s, cancelling: true }
    case 'database':
      return { ...s, phase: 'database' }
    case 'finished':
      if (e.outcome === 'done') return { ...s, phase: 'done', result: { tracks: e.tracks, failed: e.failed, ms: e.ms } }
      if (e.outcome === 'cancelled') return { ...s, phase: 'cancelled' }
      return { ...s, phase: 'error', reason: e.reason }
  }
}

export function isRunning(s: UsbExportState): boolean {
  return s.phase === 'copying' || s.phase === 'database'
}

// Separators are tracks on the stick but never a number the user reads, as in the tree.
export function exportCounts(s: UsbExportState): { done: number; total: number } {
  const real = s.rows.filter((r) => !r.track.separator)
  return {
    done: real.filter((r) => r.state === 'done' || r.state === 'kept' || r.state === 'failed').length,
    total: real.length,
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
```

`src/renderer/src/lib/usbExportStore.ts`:

```ts
import { useSyncExternalStore } from 'react'
import { IDLE_EXPORT, type UsbExportAction, type UsbExportState, usbExportReducer } from './usbExport'

// The export's state outside React (spec: App must not re-render on every byte tick). Each
// consumer reads its own slice with useUsbExportState; a selector must return a primitive or
// an object that only changes when its slice does (a row is replaced only when that row
// changes), or useSyncExternalStore would re-render on every dispatch.
export interface UsbExportStore {
  getState: () => UsbExportState
  subscribe: (listener: () => void) => () => void
  dispatch: (a: UsbExportAction) => void
}

export function createUsbExportStore(now: () => number = Date.now): UsbExportStore {
  let state = IDLE_EXPORT
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    dispatch: (a) => {
      state = usbExportReducer(state, a, now())
      for (const l of listeners) l()
    },
  }
}

export const usbExportStore = createUsbExportStore()

export function useUsbExportState<T>(selector: (s: UsbExportState) => T, store: UsbExportStore = usbExportStore): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}

// Called once by App: the main process's events go straight into the store.
export function connectUsbExportFeed(store: UsbExportStore = usbExportStore): () => void {
  return window.api.onUsbEvent((e) => store.dispatch(e))
}
```

Run Step 2's command. Expected: PASS.

- [ ] **Step 4: Write the failing component tests**

`src/renderer/src/components/UsbExportProgress.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UsbExportEvent, UsbPlanTrack } from '../../../shared/types'
import i18n from '../i18n'
import { createUsbExportStore, type UsbExportStore } from '../lib/usbExportStore'
import { TrackWave } from './TrackWave'
import { UsbExportPill } from './UsbExportPill'
import { UsbExportProgress } from './UsbExportProgress'
import { UsbTopProgress } from './UsbTopProgress'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)
afterEach(() => vi.unstubAllGlobals())

const t = (id: string, size: number, onStick = false, separator = false): UsbPlanTrack => ({
  id, title: `Title ${id}`, artist: 'K-Style', size, onStick, separator, cover: null, wave: [0.2, 0.9, 0.4],
})
const STARTED: UsbExportEvent = { type: 'started', tracks: [t('a', 70e6), t('b', 30e6, true), t('c', 50e6), t('sep', 1, false, true)], targetName: 'Surco', startedAt: 0 }
const storeWith = (...events: UsbExportEvent[]): UsbExportStore => {
  const store = createUsbExportStore(() => 0)
  for (const e of events) store.dispatch(e)
  return store
}

function show(events: UsbExportEvent[]) {
  const handlers = { onBackground: vi.fn(), onCancel: vi.fn(), onClose: vi.fn() }
  const store = storeWith(...events)
  render(<UsbExportProgress store={store} footer={{ name: 'Surco', freeBytes: 21.4e9, filesystem: 'exfat' }} {...handlers} />)
  return { ...handlers, store }
}

describe('UsbExportProgress', () => {
  it('lists every track with its state, and counts without the separator', () => {
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

  // baken's English never reaches the row: the reason is a code, translated.
  it('says why a track failed, in the user language', () => {
    show([STARTED, { type: 'failed', index: 2, reason: 'missing-file' }])
    expect(screen.getByTestId('export-row-2')).toHaveTextContent('no se encuentra el fichero')
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

  it('offers cancel while copying, says it is cancelling, and none while writing the database', () => {
    const h = show([STARTED])
    fireEvent.click(screen.getByTestId('usb-cancel'))
    expect(h.onCancel).toHaveBeenCalled()
    act(() => h.store.dispatch({ type: 'cancelling' }))
    expect(screen.queryByTestId('usb-cancel')).toBeNull()
    expect(screen.getByTestId('usb-cancelling')).toBeInTheDocument()
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

describe('UsbExportPill and UsbTopProgress', () => {
  // With the modal closed the export stays visible and one click away.
  it('shows the running export as a pill that reopens the modal', () => {
    const store = storeWith(STARTED, { type: 'track', index: 0, state: 'done' })
    const onOpen = vi.fn()
    render(<UsbExportPill store={store} hidden={false} onOpen={onOpen} />)
    expect(screen.getByTestId('usb-export-progress')).toHaveTextContent('USB 1/3')
    fireEvent.click(screen.getByTestId('usb-export-progress'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('has no pill while the modal is open or nothing runs', () => {
    render(<UsbExportPill store={storeWith(STARTED)} hidden onOpen={() => {}} />)
    render(<UsbExportPill store={storeWith()} hidden={false} onOpen={() => {}} />)
    expect(screen.queryByTestId('usb-export-progress')).toBeNull()
  })

  it('draws the top line only while it runs', () => {
    const { rerender } = render(<UsbTopProgress store={storeWith(STARTED)} />)
    expect(screen.getByTestId('top-progress')).toBeInTheDocument()
    rerender(<UsbTopProgress store={storeWith()} />)
    expect(screen.queryByTestId('top-progress')).toBeNull()
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

(`66,8 MB` is `formatFileSize(70e6, 'es')`: 70 000 000 / 1024² = 66.76. `lib/motion.ts` reads `window.matchMedia`; `vi.stubGlobal` replaces it on the jsdom window.)

- [ ] **Step 5: Run them to see them fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/UsbExportProgress.test.tsx`
Expected: FAIL, `Cannot find module './TrackWave'`.

- [ ] **Step 6: Implement the components**

`src/renderer/src/components/TrackWave.tsx`:

```tsx
import type React from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { FLAT_WAVE, type RowState, wavePath } from '../lib/usbExport'

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

`src/renderer/src/components/ExportTrackRow.tsx`:

```tsx
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '../lib/properties'
import { usbExportStore, type UsbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { TrackWave } from './TrackWave'

// A row of the export list. It subscribes to its own row: a progress tick replaces one row
// object, so only that row renders again.
export const ExportTrackRow = memo(function ExportTrackRow({
  index,
  store = usbExportStore,
}: {
  index: number
  store?: UsbExportStore
}): React.JSX.Element | null {
  const { t: tr, i18n } = useTranslation()
  const row = useUsbExportState((s) => s.rows[index], store)
  if (!row) return null
  const { track, state } = row
  const label =
    state === 'queued'
      ? tr('usbExport.progress.queued')
      : state === 'copying'
        ? tr('usbExport.progress.copying')
        : state === 'kept'
          ? tr('usbExport.progress.kept')
          : state === 'failed'
            ? tr(`usbExport.trackFailure.${row.failure ?? 'unreadable'}`)
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
      <span className={`w-32 truncate text-right text-xs tabular-nums ${state === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
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
import { bytesDone, bytesToCopy, exportCounts, formatSpan, speed, timeLeft } from '../lib/usbExport'
import { usbExportStore, type UsbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { ExportTrackRow } from './ExportTrackRow'

// The modal while exporting and when done: one column, the export's tracks in order, a thin
// overall line with the count, speed and time left on top, the stick in the footer. The
// header and footer read the store once per tick; the rows read their own row.
export function UsbExportProgress({
  footer,
  onBackground,
  onCancel,
  onClose,
  store = usbExportStore,
}: {
  footer: { name: string; freeBytes: number | null; filesystem: UsbFilesystem | null }
  onBackground: () => void
  onCancel: () => void
  onClose: () => void
  store?: UsbExportStore
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const state = useUsbExportState((s) => s, store)
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
          <ExportTrackRow key={row.track.id} index={i} store={store} />
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
          {state.phase === 'copying' && !state.cancelling && (
            <button type="button" data-testid="usb-cancel" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]">
              {tr('usbExport.progress.cancel')}
            </button>
          )}
          {state.phase === 'copying' && state.cancelling && (
            <span data-testid="usb-cancelling" role="status" className="px-3 py-1.5 text-sm">{tr('usbExport.progress.cancelling')}</span>
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

(The tokens `--color-danger`, `--color-on-accent` and `--color-line-strong` exist in the theme, checked by the pre-flight scan.)

`src/renderer/src/components/UsbExportPill.tsx`:

```tsx
import { Usb } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { exportCounts, isRunning } from '../lib/usbExport'
import { usbExportStore, type UsbExportStore, useUsbExportState } from '../lib/usbExportStore'

// The USB export running with its modal closed: a pill like the sweeps', which reopens it.
// It subscribes to two numbers, so the toolbar around it does not re-render with the bytes.
export function UsbExportPill({
  hidden,
  onOpen,
  store = usbExportStore,
}: {
  hidden: boolean
  onOpen: () => void
  store?: UsbExportStore
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const running = useUsbExportState(isRunning, store)
  const done = useUsbExportState((s) => exportCounts(s).done, store)
  const total = useUsbExportState((s) => exportCounts(s).total, store)
  if (!running || hidden) return null
  const label = tr('usbExport.pill', { done, total })
  return (
    <button
      type="button"
      data-testid="usb-export-progress"
      onClick={onOpen}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[var(--color-accent)] tabular-nums hover:bg-[var(--color-hover)]"
    >
      <Usb size={14} aria-hidden="true" />
      {label}
      <span role="status" className="sr-only">{label}</span>
    </button>
  )
}
```

`src/renderer/src/components/UsbTopProgress.tsx`:

```tsx
import type React from 'react'
import { bytesDone, bytesToCopy, exportCounts, isRunning } from '../lib/usbExport'
import { usbExportStore, type UsbExportStore, useUsbExportState } from '../lib/usbExportStore'
import { TopProgressBar } from './TopProgressBar'

// The thin line on top while the export runs in the background, the one the conversions
// use. Rounded to whole percents so a byte tick that does not move it renders nothing.
export function UsbTopProgress({ store = usbExportStore }: { store?: UsbExportStore }): React.JSX.Element | null {
  const percent = useUsbExportState((s) => {
    if (!isRunning(s)) return null
    const toCopy = bytesToCopy(s)
    const c = exportCounts(s)
    const f = toCopy > 0 ? bytesDone(s) / toCopy : c.total > 0 ? c.done / c.total : 0
    return Math.round(f * 100)
  }, store)
  return percent === null ? null : <TopProgressBar fraction={percent / 100} />
}
```

- [ ] **Step 7: Locale strings**

Write `$SCRATCH/usb-locale-10.json` and merge it (`node "$SCRATCH/merge-locale.cjs" "$SCRATCH/usb-locale-10.json"` from `apps/desktop`):

```json
{
  "es": {
    "usbExport": {
      "progress": {
        "queued": "en cola",
        "copying": "copiando",
        "kept": "ya estaba",
        "counter": "{{done}} / {{total}}",
        "speed": "{{value}}/s",
        "left": "quedan {{time}}",
        "free": "{{size}} libres",
        "background": "Seguir en segundo plano",
        "cancel": "Cancelar",
        "finishing": "Terminando…",
        "close": "Cerrar",
        "done_one": "Listo · {{count}} pista en {{time}}. Ya puedes expulsar el USB.",
        "done_other": "Listo · {{count}} pistas en {{time}}. Ya puedes expulsar el USB.",
        "failedCount_one": "{{count}} no se pudo exportar.",
        "failedCount_other": "{{count}} no se pudieron exportar.",
        "cancelled": "Cancelado. El USB tiene su biblioteca anterior.",
        "cancelling": "Cancelando…"
      },
      "span": {
        "minSec": "{{min}} min {{sec}} s",
        "sec": "{{sec}} s"
      },
      "fs": {
        "fat32": "FAT32",
        "exfat": "exFAT",
        "hfs": "HFS+",
        "apfs": "APFS",
        "other": "otro formato",
        "ntfs": "NTFS"
      },
      "errors": {
        "unsupported": "Exportar a USB solo está disponible en macOS y Windows.",
        "no-collection": "No encuentro la colección de rekordbox.",
        "unreadable": "No se pudo leer la colección de rekordbox.",
        "nothing-selected": "Marca al menos una playlist.",
        "volume-gone": "El USB se desconectó. Lo que había sigue igual; conéctalo y exporta otra vez.",
        "volume-changed": "Ese USB ya no está montado ahí.",
        "no-baken": "Falta una pieza de Surco para exportar. Reinstala Surco.",
        "refused": "Surco no escribe en esa carpeta.",
        "baken-failed": "La exportación falló. El USB tiene su biblioteca anterior.",
        "device-write": "No se pudo escribir en el USB.",
        "no-space": "No cabe en el USB.",
        "busy": "Ya hay una exportación en marcha.",
        "not-removable": "Elige una carpeta de un USB o una tarjeta.",
        "not-volume-root": "Los reproductores solo leen la raíz de un USB."
      },
      "trackFailure": {
        "missing-file": "no se encuentra el fichero",
        "unreadable": "no se pudo leer",
        "device": "no se pudo escribir en el USB"
      }
    }
  },
  "en": {
    "usbExport": {
      "progress": {
        "queued": "queued",
        "copying": "copying",
        "kept": "already there",
        "counter": "{{done}} / {{total}}",
        "speed": "{{value}}/s",
        "left": "{{time}} left",
        "free": "{{size}} free",
        "background": "Keep going in the background",
        "cancel": "Cancel",
        "finishing": "Finishing…",
        "close": "Close",
        "done_one": "Done · {{count}} track in {{time}}. You can eject the USB now.",
        "done_other": "Done · {{count}} tracks in {{time}}. You can eject the USB now.",
        "failedCount_one": "{{count}} could not be exported.",
        "failedCount_other": "{{count}} could not be exported.",
        "cancelled": "Cancelled. The USB keeps its previous library.",
        "cancelling": "Cancelling…"
      },
      "span": {
        "minSec": "{{min}} min {{sec}} s",
        "sec": "{{sec}} s"
      },
      "fs": {
        "fat32": "FAT32",
        "exfat": "exFAT",
        "hfs": "HFS+",
        "apfs": "APFS",
        "other": "other format",
        "ntfs": "NTFS"
      },
      "errors": {
        "unsupported": "Export to USB is only available on macOS and Windows.",
        "no-collection": "The rekordbox collection was not found.",
        "unreadable": "The rekordbox collection could not be read.",
        "nothing-selected": "Tick at least one playlist.",
        "volume-gone": "The USB was disconnected. What was on it is unchanged; plug it in and export again.",
        "volume-changed": "That USB is no longer mounted there.",
        "no-baken": "A part of Surco needed to export is missing. Reinstall Surco.",
        "refused": "Surco does not write to that folder.",
        "baken-failed": "The export failed. The USB keeps its previous library.",
        "device-write": "The USB could not be written.",
        "no-space": "It does not fit on the USB.",
        "busy": "An export is already running.",
        "not-removable": "Choose a folder on a USB or a card.",
        "not-volume-root": "Players only read the root of a USB."
      },
      "trackFailure": {
        "missing-file": "file not found",
        "unreadable": "could not be read",
        "device": "could not write to the USB"
      }
    }
  },
  "de": {
    "usbExport": {
      "progress": {
        "queued": "wartet",
        "copying": "wird kopiert",
        "kept": "schon da",
        "counter": "{{done}} / {{total}}",
        "speed": "{{value}}/s",
        "left": "noch {{time}}",
        "free": "{{size}} frei",
        "background": "Im Hintergrund weitermachen",
        "cancel": "Abbrechen",
        "finishing": "Wird abgeschlossen…",
        "close": "Schließen",
        "done_one": "Fertig · {{count}} Track in {{time}}. Du kannst den USB-Stick jetzt auswerfen.",
        "done_other": "Fertig · {{count}} Tracks in {{time}}. Du kannst den USB-Stick jetzt auswerfen.",
        "failedCount_one": "{{count}} konnte nicht exportiert werden.",
        "failedCount_other": "{{count}} konnten nicht exportiert werden.",
        "cancelled": "Abgebrochen. Der USB-Stick behält seine bisherige Bibliothek.",
        "cancelling": "Wird abgebrochen…"
      },
      "span": {
        "minSec": "{{min}} min {{sec}} s",
        "sec": "{{sec}} s"
      },
      "fs": {
        "fat32": "FAT32",
        "exfat": "exFAT",
        "hfs": "HFS+",
        "apfs": "APFS",
        "other": "anderes Format",
        "ntfs": "NTFS"
      },
      "errors": {
        "unsupported": "Export auf USB gibt es nur unter macOS und Windows.",
        "no-collection": "Die rekordbox-Sammlung wurde nicht gefunden.",
        "unreadable": "Die rekordbox-Sammlung konnte nicht gelesen werden.",
        "nothing-selected": "Markiere mindestens eine Playlist.",
        "volume-gone": "Der USB-Stick wurde getrennt. Was darauf war, ist unverändert; steck ihn ein und exportiere erneut.",
        "volume-changed": "Dieser USB-Stick ist dort nicht mehr eingebunden.",
        "no-baken": "Ein Teil von Surco für den Export fehlt. Installiere Surco neu.",
        "refused": "Surco schreibt nicht in diesen Ordner.",
        "baken-failed": "Der Export ist fehlgeschlagen. Der USB-Stick behält seine bisherige Bibliothek.",
        "device-write": "Auf den USB-Stick konnte nicht geschrieben werden.",
        "no-space": "Passt nicht auf den USB-Stick.",
        "busy": "Es läuft bereits ein Export.",
        "not-removable": "Wähle einen Ordner auf einem USB-Stick oder einer Karte.",
        "not-volume-root": "Player lesen nur das Hauptverzeichnis eines USB-Sticks."
      },
      "trackFailure": {
        "missing-file": "Datei nicht gefunden",
        "unreadable": "konnte nicht gelesen werden",
        "device": "konnte nicht auf den USB-Stick schreiben"
      }
    }
  },
  "fr": {
    "usbExport": {
      "progress": {
        "queued": "en attente",
        "copying": "copie",
        "kept": "déjà là",
        "counter": "{{done}} / {{total}}",
        "speed": "{{value}}/s",
        "left": "encore {{time}}",
        "free": "{{size}} libres",
        "background": "Continuer en arrière-plan",
        "cancel": "Annuler",
        "finishing": "Finalisation…",
        "close": "Fermer",
        "done_one": "Terminé · {{count}} piste en {{time}}. Tu peux éjecter la clé USB.",
        "done_other": "Terminé · {{count}} pistes en {{time}}. Tu peux éjecter la clé USB.",
        "failedCount_one": "{{count}} n’a pas pu être exportée.",
        "failedCount_other": "{{count}} n’ont pas pu être exportées.",
        "cancelled": "Annulé. La clé USB garde sa bibliothèque précédente.",
        "cancelling": "Annulation…"
      },
      "span": {
        "minSec": "{{min}} min {{sec}} s",
        "sec": "{{sec}} s"
      },
      "fs": {
        "fat32": "FAT32",
        "exfat": "exFAT",
        "hfs": "HFS+",
        "apfs": "APFS",
        "other": "autre format",
        "ntfs": "NTFS"
      },
      "errors": {
        "unsupported": "L’export vers USB n’existe que sur macOS et Windows.",
        "no-collection": "La collection rekordbox est introuvable.",
        "unreadable": "La collection rekordbox n’a pas pu être lue.",
        "nothing-selected": "Coche au moins une playlist.",
        "volume-gone": "La clé USB a été débranchée. Son contenu n’a pas changé ; rebranche-la et exporte à nouveau.",
        "volume-changed": "Cette clé USB n’est plus montée à cet endroit.",
        "no-baken": "Il manque une partie de Surco pour exporter. Réinstalle Surco.",
        "refused": "Surco n’écrit pas dans ce dossier.",
        "baken-failed": "L’export a échoué. La clé USB garde sa bibliothèque précédente.",
        "device-write": "Impossible d’écrire sur la clé USB.",
        "no-space": "Ça ne tient pas sur la clé USB.",
        "busy": "Un export est déjà en cours.",
        "not-removable": "Choisis un dossier sur une clé USB ou une carte.",
        "not-volume-root": "Les lecteurs ne lisent que la racine d’une clé USB."
      },
      "trackFailure": {
        "missing-file": "fichier introuvable",
        "unreadable": "lecture impossible",
        "device": "écriture impossible sur la clé USB"
      }
    }
  },
  "pt-BR": {
    "usbExport": {
      "progress": {
        "queued": "na fila",
        "copying": "copiando",
        "kept": "já estava",
        "counter": "{{done}} / {{total}}",
        "speed": "{{value}}/s",
        "left": "faltam {{time}}",
        "free": "{{size}} livres",
        "background": "Continuar em segundo plano",
        "cancel": "Cancelar",
        "finishing": "Finalizando…",
        "close": "Fechar",
        "done_one": "Pronto · {{count}} faixa em {{time}}. Já pode ejetar o USB.",
        "done_other": "Pronto · {{count}} faixas em {{time}}. Já pode ejetar o USB.",
        "failedCount_one": "{{count}} não pôde ser exportada.",
        "failedCount_other": "{{count}} não puderam ser exportadas.",
        "cancelled": "Cancelado. O USB mantém a biblioteca anterior.",
        "cancelling": "Cancelando…"
      },
      "span": {
        "minSec": "{{min}} min {{sec}} s",
        "sec": "{{sec}} s"
      },
      "fs": {
        "fat32": "FAT32",
        "exfat": "exFAT",
        "hfs": "HFS+",
        "apfs": "APFS",
        "other": "outro formato",
        "ntfs": "NTFS"
      },
      "errors": {
        "unsupported": "Exportar para USB só está disponível no macOS e no Windows.",
        "no-collection": "A coleção do rekordbox não foi encontrada.",
        "unreadable": "Não foi possível ler a coleção do rekordbox.",
        "nothing-selected": "Marque pelo menos uma playlist.",
        "volume-gone": "O USB foi desconectado. O que havia nele continua igual; conecte e exporte de novo.",
        "volume-changed": "Esse USB não está mais montado ali.",
        "no-baken": "Falta uma parte do Surco para exportar. Reinstale o Surco.",
        "refused": "O Surco não escreve nessa pasta.",
        "baken-failed": "A exportação falhou. O USB mantém a biblioteca anterior.",
        "device-write": "Não foi possível gravar no USB.",
        "no-space": "Não cabe no USB.",
        "busy": "Já há uma exportação em andamento.",
        "not-removable": "Escolha uma pasta de um USB ou de um cartão.",
        "not-volume-root": "Os players só leem a raiz de um USB."
      },
      "trackFailure": {
        "missing-file": "arquivo não encontrado",
        "unreadable": "não foi possível ler",
        "device": "não foi possível gravar no USB"
      }
    }
  }
}
```

`done_one`/`done_other` follow the repo's plural rule (count 0 goes to `_other`).

- [ ] **Step 8: Run them to see them pass, then the locale key test**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/usbExport.test.ts src/renderer/src/lib/usbExportStore.test.tsx src/renderer/src/components/UsbExportProgress.test.tsx src/renderer/src/i18n`
Expected: PASS (the i18n folder's key test compares the locales).

- [ ] **Step 9: Measure the waveforms with 500 rows (Vicent's ruling: only if cheap)**

Mount `UsbExportProgress` in the running dev app with a synthetic store of 600 rows (temporary, not committed: a `?usbPerf` query handled in `App.tsx` that dispatches a `started` with 600 tracks and a `progress` every 250 ms on row 300). In Chrome DevTools Performance, record 10 s. Accept when the main thread stays under 10% busy and no frame exceeds 16 ms beyond the first paint. If it does not, replace `TrackWave`'s copying and done states with a thin progress line per row (a 2 px bar whose width is the fraction; queued stays the dashed line), keep the tests' testids (`track-wave`, `track-wave-fill`) on the bar so they still pin reveal and reduced motion, and say so in the commit title. Remove the temporary hook before committing and write the numbers in `docs/export-usb-medidas.md`.

- [ ] **Step 10: Lint and commit**

```bash
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- biome check --write src
git add apps/desktop/src/renderer/src/lib/usbExport.ts apps/desktop/src/renderer/src/lib/usbExport.test.ts apps/desktop/src/renderer/src/lib/usbExportStore.ts apps/desktop/src/renderer/src/lib/usbExportStore.test.tsx apps/desktop/src/renderer/src/components/TrackWave.tsx apps/desktop/src/renderer/src/components/ExportTrackRow.tsx apps/desktop/src/renderer/src/components/UsbExportProgress.tsx apps/desktop/src/renderer/src/components/UsbExportPill.tsx apps/desktop/src/renderer/src/components/UsbTopProgress.tsx apps/desktop/src/renderer/src/components/UsbExportProgress.test.tsx apps/desktop/src/renderer/src/i18n/locales docs/export-usb-medidas.md
git commit -m "Show the USB export as a track list whose waveforms fill as they copy"
```

---
### Task 11: The choosing face, the live lists, and the ways in

**Files:**
- Create: `src/renderer/src/components/CheckTree.tsx`, `src/renderer/src/components/CheckTree.test.tsx`
- Create: `src/renderer/src/components/UsbExportModal.tsx`, `src/renderer/src/components/UsbExportModal.test.tsx`
- Create: `src/renderer/src/hooks/useUsbVolumes.ts`, `src/renderer/src/hooks/useUsbPlan.ts`, `src/renderer/src/hooks/useUsbPlan.test.tsx`
- Modify: `src/renderer/src/lib/usbExport.ts` (+ `holderText`, `newlyMounted`), its test
- Modify: `src/renderer/src/components/SourceTree.tsx` (+ test), `src/renderer/src/components/Toolbar.tsx` (+ test), `src/renderer/src/lib/commands.ts` (+ test), `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/i18n/locales/*.json` (`usbExport.*` for the chooser, `commands.exportUsb`, `sources.tree.exportUsb`)

**Interfaces:**
- Consumes: Task 9's API and types; Task 10's `UsbExportProgress`, `UsbExportPill`, `UsbTopProgress`, `usbExportStore`, `useUsbExportState`, `connectUsbExportFeed`, `isRunning`, `formatSpan`.
- Produces: the finished feature.

```ts
// lib/usbExport.ts additions
export function holderText(h: UsbHolder, tr: (k: string, o?: Record<string, unknown>) => string, now: Date): string
export function newlyMounted(prev: UsbVolume[] | null, next: UsbVolume[]): UsbVolume[]
// CheckTree.tsx
export function playlistIdsUnder(node: SourceNode): string[]
export function folderState(node: SourceNode, checked: ReadonlySet<string>): 'all' | 'some' | 'none'
export function foldersHolding(nodes: SourceNode[], checked: ReadonlySet<string>): string[]
export function CheckTree(props: { nodes: SourceNode[]; checked: ReadonlySet<string>; onChange: (next: Set<string>) => void }): JSX.Element
// hooks
export function useUsbVolumes(enabled: boolean): { list: UsbVolumeList | null }
export function useUsbPlan(req: UsbExportRequest | null): { plan: UsbPlan | null; failure: UsbFailure | null; loading: boolean }
// UsbExportModal.tsx
export function UsbExportModal(props: {
  nodes: SourceNode[] | undefined; volumes: UsbVolumeList | null; preselect: string | null
  onStart: (req: UsbExportRequest) => Promise<UsbStartResult>
  onCancelExport: () => void; onClose: () => void; store?: UsbExportStore
}): JSX.Element
// Toolbar: new optional prop `usbPill?: React.ReactNode` (the slot App fills with <UsbExportPill/>)
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
import { CheckTree, folderState, foldersHolding, playlistIdsUnder } from './CheckTree'

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
  it('names the folders that hold a ticked playlist, nested ones included', () => {
    expect(foldersHolding(NODES, new Set(['todas']))).toEqual(['bases', '90s'])
    expect(foldersHolding(NODES, new Set(['house']))).toEqual([])
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

  // A stick's remembered playlists must be visible when the chooser opens, not hidden in
  // closed folders.
  it('opens the folders that hold ticked playlists', () => {
    render(<CheckTree nodes={NODES} checked={new Set(['todas'])} onChange={() => {}} />)
    expect(screen.getByTestId('check-node-todas')).toBeChecked()
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

export function foldersHolding(nodes: SourceNode[], checked: ReadonlySet<string>): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder' && folderState(n, checked) !== 'none'
      ? [n.id, ...foldersHolding(n.children ?? [], checked)]
      : [],
  )
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
  // The folders holding something ticked open on their own (a stick's remembered selection
  // must be visible), once per change of the ticked set and during render, so it never draws
  // closed for a frame. The user can still close them afterwards.
  const tickedKey = [...checked].sort().join('\n')
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (openedFor !== tickedKey && nodes.length > 0) {
    setOpenedFor(tickedKey)
    const holding = foldersHolding(nodes, checked)
    if (holding.some((id) => !opened.has(id))) setOpened((prev) => new Set([...prev, ...holding]))
  }
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

- [ ] **Step 3: Failing hook test**

`src/renderer/src/hooks/useUsbPlan.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { UsbPlanResult } from '../../../shared/types'
import { stubApi } from '../test/api'
import { useUsbPlan } from './useUsbPlan'

afterEach(() => vi.useRealTimers())

describe('useUsbPlan', () => {
  // Ticking several boxes in a row must not run baken's dry run for each one.
  it('waits for the ticking to settle before asking', async () => {
    vi.useFakeTimers()
    const usbPlan = vi.fn(async (): Promise<UsbPlanResult> => ({ ok: false, reason: 'nothing-selected' }))
    ;(window as unknown as { api: Api }).api = stubApi({ usbPlan })
    const target = { kind: 'volume' as const, uuid: 'U' }
    const { rerender } = renderHook(({ ids }) => useUsbPlan({ playlistIds: ids, target, prune: false, settings: false }), {
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

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/hooks/useUsbPlan.test.tsx`
Expected: FAIL, missing module.

- [ ] **Step 4: Implement the hooks**

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

// The mounted removable volumes, live: main re-reads them when /Volumes changes (macOS) or
// a drive letter comes or goes (Windows). The first call is what starts that watch.
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
import type { SourceNode, UsbPlan, UsbStartResult, UsbVolume, UsbVolumeList } from '../../../shared/types'
import i18n from '../i18n'
import { createUsbExportStore } from '../lib/usbExportStore'
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
const REMEMBERED = { playlistIds: ['mak'], prune: false, settings: false, at: 1 }
const PLAN: UsbPlan = {
  tracks: [], trackCount: 7, newCount: 5, newBytes: 1.2e9, keptCount: 2, removedSinceLast: 1,
  warnings: [
    { kind: 'exfat' },
    { kind: 'cdj2000', titles: ['No Fear'] },
    { kind: 'unexportable', tracks: [{ title: 'Gone', reason: 'missing-file' }, { title: 'Streamed', reason: 'streaming' }] },
  ],
}

let usbPlan = vi.fn()
beforeEach(() => {
  usbPlan = vi.fn(async () => ({ ok: true, plan: PLAN }))
  ;(window as unknown as { api: Api }).api = stubApi({ usbPlan, usbPickFolder: async () => ({ path: '/Volumes/Vicent/sets', remembered: null }) })
})

async function show(list: UsbVolumeList | null, over: Partial<Parameters<typeof UsbExportModal>[0]> = {}) {
  vi.useFakeTimers()
  const onStart = vi.fn(async (): Promise<UsbStartResult> => ({ ok: true }))
  const store = createUsbExportStore(() => 0)
  render(
    <UsbExportModal nodes={NODES} volumes={list} preselect={null} onStart={onStart} onCancelExport={() => {}} onClose={() => {}} store={store} {...over} />,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  vi.useRealTimers()
  return { onStart, store }
}

describe('UsbExportModal choosing', () => {
  it('asks to connect a USB when there is none', async () => {
    await show({ volumes: [], lastKey: null })
    expect(screen.getByTestId('usb-none')).toHaveTextContent('Conecta un USB')
  })

  // Two sticks both called "Vicent": each row is its own stick, picked by its identifier.
  it('lists each stick with its space, format and what it holds', async () => {
    await show({ volumes: [vol({}), vol({ uuid: 'U2', mountPoint: '/Volumes/Vicent 1', holder: { by: 'rekordbox', at: Date.now() } })], lastKey: null })
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('Vicent')
    expect(screen.getByTestId('usb-volume-U1')).toHaveTextContent('FAT32')
    expect(screen.getByTestId('usb-volume-U2')).toHaveTextContent('exportado por rekordbox hoy')
  })

  // The second time is one press: the stick last used is chosen, its playlists ticked and
  // visible (their folder opens), its boxes as they were.
  it('preselects the last stick and ticks what it got last time', async () => {
    await show({ volumes: [vol({}), vol({ uuid: 'U2', remembered: { ...REMEMBERED, settings: true } })], lastKey: 'volume:U2' })
    expect(screen.getByTestId('usb-volume-U2')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
    expect(screen.getByTestId('usb-settings')).toBeChecked()
    expect(usbPlan).toHaveBeenCalledWith({ playlistIds: ['mak'], target: { kind: 'volume', uuid: 'U2' }, prune: false, settings: true })
  })

  it('summarises, warns, and names each track that cannot go with its reason', async () => {
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    const s = screen.getByTestId('usb-summary')
    expect(s).toHaveTextContent('7 pistas')
    expect(s).toHaveTextContent('5 nuevas')
    expect(s).toHaveTextContent('2 ya están')
    expect(s).toHaveTextContent('1 quitada desde la última vez')
    expect(screen.getByTestId('usb-warning-exfat')).toBeInTheDocument()
    expect(screen.getByTestId('usb-warning-cdj2000')).toHaveTextContent('No Fear')
    expect(screen.getByTestId('usb-warning-unexportable')).toHaveTextContent('2 pistas no se pueden exportar')
    expect(screen.getByTestId('usb-warning-unexportable')).toHaveTextContent('Gone · no se encuentra el fichero')
  })

  it('cannot export what does not fit, and says how much is needed and free', async () => {
    usbPlan.mockResolvedValue({ ok: true, plan: { ...PLAN, warnings: [{ kind: 'noSpace', neededBytes: 3.1 * 1024 ** 3, freeBytes: 1.7 * 1024 ** 3 }] } })
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-export')).toBeDisabled()
    expect(screen.getByTestId('usb-warning-noSpace')).toHaveTextContent('Hace falta 3,10 GB y hay 1,70 GB libres')
  })

  // Deleting music and copying settings are opt-in, both sent only when ticked.
  it('exports with both boxes off unless ticked', async () => {
    const { onStart } = await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    expect(screen.getByTestId('usb-prune')).not.toBeChecked()
    expect(screen.getByTestId('usb-settings')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(onStart).toHaveBeenCalledWith({ playlistIds: ['mak'], target: { kind: 'volume', uuid: 'U1' }, prune: false, settings: false })
  })

  // A double click before the first answer must not ask twice.
  it('disables Exportar while the export is starting', async () => {
    let finish: (r: UsbStartResult) => void = () => {}
    const onStart = vi.fn(() => new Promise<UsbStartResult>((r) => { finish = r }))
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null }, { onStart })
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(screen.getByTestId('usb-export')).toBeDisabled()
    fireEvent.click(screen.getByTestId('usb-export'))
    expect(onStart).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: false, reason: 'no-space', neededBytes: 2 * 1024 ** 3, freeBytes: 1024 ** 3 }))
    expect(screen.getByTestId('usb-start-error')).toHaveTextContent('Hace falta 2,00 GB y hay 1,00 GB libres')
    expect(screen.getByTestId('usb-export')).toBeEnabled()
  })

  // A folder picked by hand is never pruned, so the box is not offered for it.
  it('hides the prune box for a folder destination', async () => {
    await show({ volumes: [vol({ remembered: REMEMBERED })], lastKey: null })
    await act(async () => {
      fireEvent.click(screen.getByTestId('usb-other'))
    })
    expect(screen.queryByTestId('usb-prune')).toBeNull()
  })

  it('shows the progress list once an export runs', async () => {
    const { store } = await show({ volumes: [vol({})], lastKey: null })
    act(() => store.dispatch({ type: 'started', tracks: [], targetName: 'Vicent', startedAt: 0 }))
    expect(screen.getByTestId('usb-rows')).toBeInTheDocument()
    expect(screen.queryByTestId('usb-summary')).toBeNull()
  })
})
```

(`3,10 GB` is `formatFileSize(3.1 × 1024³, 'es')`, two decimals above a gigabyte.)

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
import { useUsbPlan } from '../hooks/useUsbPlan'
import { formatFileSize } from '../lib/properties'
import { holderText } from '../lib/usbExport'
import { usbExportStore, type UsbExportStore, useUsbExportState } from '../lib/usbExportStore'
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
  onStart,
  onCancelExport,
  onClose,
  store = usbExportStore,
}: {
  nodes: SourceNode[] | undefined
  volumes: UsbVolumeList | null
  preselect: string | null
  onStart: (req: UsbExportRequest) => Promise<UsbStartResult>
  onCancelExport: () => void
  onClose: () => void
  store?: UsbExportStore
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const size = (bytes: number): string => formatFileSize(bytes, i18n.language)
  const phase = useUsbExportState((s) => s.phase, store)
  const targetName = useUsbExportState((s) => s.targetName, store)
  const first = initialVolume(volumes, preselect)
  const [target, setTarget] = useState<UsbTarget | null>(first ? { kind: 'volume', uuid: first.uuid } : null)
  const [checked, setChecked] = useState<Set<string>>(new Set(first?.remembered?.playlistIds ?? []))
  const [prune, setPrune] = useState(first?.remembered?.prune ?? false)
  const [settings, setSettings] = useState(first?.remembered?.settings ?? false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const remember = (r: { playlistIds: string[]; prune: boolean; settings: boolean } | null): void => {
    if (!r) return
    setChecked(new Set(r.playlistIds))
    setPrune(r.prune)
    setSettings(r.settings)
  }
  // A list that arrives after the modal opened still preselects, once.
  const [seeded, setSeeded] = useState(first !== null)
  if (!seeded && first) {
    setSeeded(true)
    setTarget({ kind: 'volume', uuid: first.uuid })
    remember(first.remembered)
  }
  const folder = target?.kind === 'folder'
  const req: UsbExportRequest | null =
    target && checked.size > 0 ? { playlistIds: [...checked].sort(), target, prune: folder ? false : prune, settings } : null
  const { plan, failure, loading } = useUsbPlan(req)
  const chosen = target?.kind === 'volume' ? (volumes?.volumes.find((v) => v.uuid === target.uuid) ?? null) : null

  const choose = (v: UsbVolume): void => {
    setTarget({ kind: 'volume', uuid: v.uuid })
    remember(v.remembered)
  }
  const pickFolder = async (): Promise<void> => {
    const pick = await window.api.usbPickFolder()
    if (!pick) return
    setTarget({ kind: 'folder', path: pick.path })
    remember(pick.remembered)
  }
  const noSpace = plan?.warnings.some((w) => w.kind === 'noSpace') ?? false
  const start = (): void => {
    if (!req || starting) return
    setStarting(true)
    setStartError(null)
    void onStart(req).then((r) => {
      setStarting(false)
      if (r.ok) return
      setStartError(
        r.reason === 'no-space' && r.neededBytes !== undefined && r.freeBytes !== undefined
          ? tr('usbExport.warnings.noSpace', { needed: size(r.neededBytes), free: size(r.freeBytes) })
          : tr(`usbExport.errors.${r.reason}`),
      )
    })
  }

  const warning = (w: UsbWarning): React.ReactNode => {
    switch (w.kind) {
      case 'cdj2000':
        return (
          <details>
            <summary>{tr('usbExport.warnings.cdj2000', { count: w.titles.length })}</summary>
            <ul className="mt-1 list-disc pl-5">{w.titles.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
        )
      case 'unexportable':
        return (
          <details>
            <summary>{tr('usbExport.warnings.unexportable', { count: w.tracks.length })}</summary>
            <ul className="mt-1 list-disc pl-5">
              {w.tracks.map((t) => (
                <li key={`${t.title}-${t.reason}`}>{`${t.title} · ${tr(`usbExport.unexportable.${t.reason}`)}`}</li>
              ))}
            </ul>
          </details>
        )
      case 'noSpace':
        return tr('usbExport.warnings.noSpace', { needed: size(w.neededBytes), free: size(w.freeBytes) })
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
      {phase !== 'idle' ? (
        <UsbExportProgress
          store={store}
          footer={{ name: targetName, freeBytes: chosen?.freeBytes ?? null, filesystem: chosen?.filesystem ?? null }}
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
                      {[tr('usbExport.choose.capacity', { total: size(v.totalBytes), free: size(v.freeBytes) }), tr(`usbExport.fs.${v.filesystem}`)].join(' · ')}
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
                  <p>{tr('usbExport.summary.new', { count: plan.newCount, size: size(plan.newBytes) })}</p>
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
              <input type="checkbox" data-testid="usb-settings" checked={settings} onChange={(e) => setSettings(e.target.checked)} />
              {tr('usbExport.choose.settings')}
            </label>
            {!folder && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" data-testid="usb-prune" checked={prune} onChange={(e) => setPrune(e.target.checked)} />
                {tr('usbExport.choose.prune')}
              </label>
            )}
            {startError && <p data-testid="usb-start-error" role="alert" className="text-xs text-danger">{startError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" data-testid="usb-cancel-choose" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-hover)]">
                {tr('usbExport.choose.cancel')}
              </button>
              <button
                type="button"
                data-testid="usb-export"
                disabled={!req || !plan || loading || noSpace || starting}
                onClick={start}
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

`Toolbar.tsx`: one optional prop, a slot, so the pill's ticks never re-render the toolbar:

```ts
  // The USB export's pill (UsbExportPill), which subscribes to the export itself; the
  // toolbar only places it, so a byte tick never re-renders the toolbar.
  usbPill?: React.ReactNode
```

rendered right before the `importing` pill: `{usbPill}`. In `Toolbar.test.tsx`:

```tsx
  it('places the USB export pill it is given', () => {
    renderBar({ usbPill: <span data-testid="pill-slot">USB 7/12</span> })
    expect(screen.getByTestId('pill-slot')).toHaveTextContent('USB 7/12')
  })
```

- [ ] **Step 8: App wiring**

In `App.tsx`:

1. Imports: `UsbExportModal`, `UsbExportPill`, `UsbTopProgress`, `useUsbVolumes`, `connectUsbExportFeed`, `usbExportStore`, `useUsbExportState`, `formatSpan`, `isRunning`, `newlyMounted`, `type UsbVolume`, and `useQuery` from `@tanstack/react-query` if App does not import it yet.
2. Next to `const editRekordbox = useRekordboxEdits(notifyEdit)`:

```tsx
  // The USB export: macOS and Windows, with a rekordbox collection. Its state lives in
  // usbExportStore, outside React; App reads only the phase (for the notices), so a byte
  // tick never re-renders the app.
  const usbAvailable = (isMac || window.api.platform === 'win32') && browser.sources.includes('rekordbox')
  useEffect(() => connectUsbExportFeed(), [])
  const usbPhase = useUsbExportState((s) => s.phase)
  const usbRunning = usbPhase === 'copying' || usbPhase === 'database'
  const { list: usbVolumes } = useUsbVolumes(usbAvailable)
  const [usbModal, setUsbModal] = useState<{ preselect: string | null } | null>(null)
  // Opening after a finished background export starts again at the chooser: its result was
  // already announced.
  const openUsbExport = useCallback((preselect: string | null = null) => {
    if (!isRunning(usbExportStore.getState()) && usbExportStore.getState().phase !== 'idle')
      usbExportStore.dispatch({ type: 'reset' })
    setUsbModal({ preselect })
  }, [])
  const closeUsbExport = useCallback(() => {
    setUsbModal(null)
    if (!isRunning(usbExportStore.getState())) usbExportStore.dispatch({ type: 'reset' })
  }, [])
  // The same query key the source browser uses for rekordbox's tree, so an open tree is
  // reused and a tree read here is there when the user opens rekordbox in the rail.
  const usbTree = useQuery({
    queryKey: ['source-tree', 'rekordbox'],
    queryFn: () => window.api.loadRekordboxTree(),
    enabled: usbModal !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
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
  const lastUsbPhase = useRef(usbPhase)
  useEffect(() => {
    const was = lastUsbPhase.current
    lastUsbPhase.current = usbPhase
    if (usbModal || was === usbPhase) return
    const s = usbExportStore.getState()
    if (usbPhase === 'done' && s.result)
      pushToast(store, {
        tone: 'neutral',
        message: { key: 'usbExport.progress.done', values: { count: s.result.tracks, time: formatSpan(s.result.ms, tr) } },
        duration: 10000,
        testid: 'usb-done-notice',
      })
    if (usbPhase === 'error' && s.reason)
      pushToast(store, { tone: 'danger', message: { key: `usbExport.errors.${s.reason}` }, testid: 'usb-error-notice' })
  }, [usbPhase, usbModal, store, tr])
```

3. The top line: the existing `fallback={progress && <TopProgressBar fraction={progress.fraction} />}` becomes `fallback={progress ? <TopProgressBar fraction={progress.fraction} /> : <UsbTopProgress />}` (a conversion's line, when one runs, wins; the export's otherwise).
4. `<Toolbar … usbPill={<UsbExportPill hidden={usbModal !== null} onOpen={() => openUsbExport()} />} />`.
5. `<SourceTree … onExportUsb={usbAvailable && browser.source === 'rekordbox' ? () => openUsbExport() : undefined} />`.
6. `buildCommands({ … openUsbExport: usbAvailable ? () => openUsbExport() : undefined })`.
7. With the other overlays:

```tsx
            {usbModal && (
              <UsbExportModal
                nodes={usbTree.data}
                volumes={usbVolumes}
                preselect={usbModal.preselect}
                onStart={(req) => window.api.usbExport(req)}
                onCancelExport={() => void window.api.usbCancel()}
                onClose={closeUsbExport}
              />
            )}
```

- [ ] **Step 9: Locale strings**

Merge `$SCRATCH/usb-locale-11.json`:

```json
{
  "es": {
    "commands": {
      "exportUsb": "Exportar a USB…"
    },
    "sources": {
      "tree": {
        "exportUsb": "Exportar a USB"
      }
    },
    "usbExport": {
      "title": "Exportar a USB",
      "pill": "USB {{done}}/{{total}}",
      "connected": "USB {{name}} conectado",
      "connectedAction": "Exportar",
      "holder": {
        "empty": "vacío",
        "today": "hoy {{time}}",
        "on": "el {{date}} {{time}}",
        "rekordbox": "exportado por rekordbox {{when}}",
        "surco": "exportado por Surco {{when}}",
        "other": "tiene una exportación, {{when}}"
      },
      "choose": {
        "tick": "Marcar {{name}}",
        "sticks": "USB",
        "none": "Conecta un USB",
        "other": "Otro destino…",
        "capacity": "{{total}} · {{free}} libres",
        "pick": "Marca playlists y elige un USB.",
        "calculating": "Calculando…",
        "prune": "Borrar del USB la música que ya no se exporta",
        "cancel": "Cancelar",
        "export": "Exportar",
        "settings": "Copiar My Settings"
      },
      "summary": {
        "tracks_one": "{{count}} pista",
        "tracks_other": "{{count}} pistas",
        "new_one": "{{count}} nueva · {{size}}",
        "new_other": "{{count}} nuevas · {{size}}",
        "kept_one": "{{count}} ya está",
        "kept_other": "{{count}} ya están",
        "removed_one": "{{count}} quitada desde la última vez",
        "removed_other": "{{count}} quitadas desde la última vez"
      },
      "warnings": {
        "rekordboxExport": "Este USB lo exportó rekordbox. Su biblioteca se sustituye por esta; la música que ya está se aprovecha.",
        "exfat": "exFAT. El CDJ-2000 no lo lee.",
        "gpt": "GPT. El CDJ-2000 y los NXS2 no lo leen.",
        "notVolumeRoot": "Los reproductores solo leen la raíz de un USB.",
        "cdj2000_one": "{{count}} pista puede que no suene en un CDJ-2000",
        "cdj2000_other": "{{count}} pistas puede que no suenen en un CDJ-2000",
        "noSpace": "No cabe. Hace falta {{needed}} y hay {{free}} libres.",
        "ntfs": "NTFS. Los reproductores no lo leen.",
        "unexportable_one": "{{count}} pista no se puede exportar",
        "unexportable_other": "{{count}} pistas no se pueden exportar"
      },
      "unexportable": {
        "missing-file": "no se encuentra el fichero",
        "streaming": "es de streaming",
        "skipped": "baken no la acepta"
      }
    }
  },
  "en": {
    "commands": {
      "exportUsb": "Export to USB…"
    },
    "sources": {
      "tree": {
        "exportUsb": "Export to USB"
      }
    },
    "usbExport": {
      "title": "Export to USB",
      "pill": "USB {{done}}/{{total}}",
      "connected": "USB {{name}} connected",
      "connectedAction": "Export",
      "holder": {
        "empty": "empty",
        "today": "today {{time}}",
        "on": "on {{date}} {{time}}",
        "rekordbox": "exported by rekordbox {{when}}",
        "surco": "exported by Surco {{when}}",
        "other": "holds an export, {{when}}"
      },
      "choose": {
        "tick": "Tick {{name}}",
        "sticks": "USB",
        "none": "Connect a USB",
        "other": "Other destination…",
        "capacity": "{{total}} · {{free}} free",
        "pick": "Tick playlists and choose a USB.",
        "calculating": "Calculating…",
        "prune": "Delete music from the USB that is no longer exported",
        "cancel": "Cancel",
        "export": "Export",
        "settings": "Copy My Settings"
      },
      "summary": {
        "tracks_one": "{{count}} track",
        "tracks_other": "{{count}} tracks",
        "new_one": "{{count}} new · {{size}}",
        "new_other": "{{count}} new · {{size}}",
        "kept_one": "{{count}} already there",
        "kept_other": "{{count}} already there",
        "removed_one": "{{count}} removed since last time",
        "removed_other": "{{count}} removed since last time"
      },
      "warnings": {
        "rekordboxExport": "rekordbox exported this USB. Its library is replaced by this one; music already on it is reused.",
        "exfat": "exFAT. The CDJ-2000 cannot read it.",
        "gpt": "GPT. The CDJ-2000 and the NXS2 cannot read it.",
        "notVolumeRoot": "Players only read the root of a USB.",
        "cdj2000_one": "{{count}} track may not play on a CDJ-2000",
        "cdj2000_other": "{{count}} tracks may not play on a CDJ-2000",
        "noSpace": "It does not fit. {{needed}} needed and {{free}} free.",
        "ntfs": "NTFS. Players cannot read it.",
        "unexportable_one": "{{count}} track cannot be exported",
        "unexportable_other": "{{count}} tracks cannot be exported"
      },
      "unexportable": {
        "missing-file": "file not found",
        "streaming": "streaming track",
        "skipped": "baken does not take it"
      }
    }
  },
  "de": {
    "commands": {
      "exportUsb": "Auf USB exportieren…"
    },
    "sources": {
      "tree": {
        "exportUsb": "Auf USB exportieren"
      }
    },
    "usbExport": {
      "title": "Auf USB exportieren",
      "pill": "USB {{done}}/{{total}}",
      "connected": "USB {{name}} verbunden",
      "connectedAction": "Exportieren",
      "holder": {
        "empty": "leer",
        "today": "heute {{time}}",
        "on": "am {{date}} {{time}}",
        "rekordbox": "von rekordbox exportiert {{when}}",
        "surco": "von Surco exportiert {{when}}",
        "other": "enthält einen Export, {{when}}"
      },
      "choose": {
        "tick": "{{name}} markieren",
        "sticks": "USB",
        "none": "Schließ einen USB-Stick an",
        "other": "Anderes Ziel…",
        "capacity": "{{total}} · {{free}} frei",
        "pick": "Markiere Playlists und wähle einen USB-Stick.",
        "calculating": "Wird berechnet…",
        "prune": "Musik vom USB-Stick löschen, die nicht mehr exportiert wird",
        "cancel": "Abbrechen",
        "export": "Exportieren",
        "settings": "My Settings kopieren"
      },
      "summary": {
        "tracks_one": "{{count}} Track",
        "tracks_other": "{{count}} Tracks",
        "new_one": "{{count}} neu · {{size}}",
        "new_other": "{{count}} neu · {{size}}",
        "kept_one": "{{count}} schon da",
        "kept_other": "{{count}} schon da",
        "removed_one": "{{count}} seit dem letzten Mal entfernt",
        "removed_other": "{{count}} seit dem letzten Mal entfernt"
      },
      "warnings": {
        "rekordboxExport": "Diesen USB-Stick hat rekordbox exportiert. Seine Bibliothek wird durch diese ersetzt; vorhandene Musik wird weiterverwendet.",
        "exfat": "exFAT. Der CDJ-2000 liest das nicht.",
        "gpt": "GPT. Der CDJ-2000 und die NXS2 lesen das nicht.",
        "notVolumeRoot": "Player lesen nur das Hauptverzeichnis eines USB-Sticks.",
        "cdj2000_one": "{{count}} Track läuft eventuell nicht auf einem CDJ-2000",
        "cdj2000_other": "{{count}} Tracks laufen eventuell nicht auf einem CDJ-2000",
        "noSpace": "Passt nicht. Nötig sind {{needed}}, frei sind {{free}}.",
        "ntfs": "NTFS. Player lesen das nicht.",
        "unexportable_one": "{{count}} Track kann nicht exportiert werden",
        "unexportable_other": "{{count}} Tracks können nicht exportiert werden"
      },
      "unexportable": {
        "missing-file": "Datei nicht gefunden",
        "streaming": "Streaming-Track",
        "skipped": "baken nimmt ihn nicht an"
      }
    }
  },
  "fr": {
    "commands": {
      "exportUsb": "Exporter vers USB…"
    },
    "sources": {
      "tree": {
        "exportUsb": "Exporter vers USB"
      }
    },
    "usbExport": {
      "title": "Exporter vers USB",
      "pill": "USB {{done}}/{{total}}",
      "connected": "USB {{name}} connectée",
      "connectedAction": "Exporter",
      "holder": {
        "empty": "vide",
        "today": "aujourd’hui {{time}}",
        "on": "le {{date}} {{time}}",
        "rekordbox": "exportée par rekordbox {{when}}",
        "surco": "exportée par Surco {{when}}",
        "other": "contient un export, {{when}}"
      },
      "choose": {
        "tick": "Cocher {{name}}",
        "sticks": "USB",
        "none": "Branche une clé USB",
        "other": "Autre destination…",
        "capacity": "{{total}} · {{free}} libres",
        "pick": "Coche des playlists et choisis une clé USB.",
        "calculating": "Calcul en cours…",
        "prune": "Supprimer de la clé la musique qui n’est plus exportée",
        "cancel": "Annuler",
        "export": "Exporter",
        "settings": "Copier My Settings"
      },
      "summary": {
        "tracks_one": "{{count}} piste",
        "tracks_other": "{{count}} pistes",
        "new_one": "{{count}} nouvelle · {{size}}",
        "new_other": "{{count}} nouvelles · {{size}}",
        "kept_one": "{{count}} déjà là",
        "kept_other": "{{count}} déjà là",
        "removed_one": "{{count}} retirée depuis la dernière fois",
        "removed_other": "{{count}} retirées depuis la dernière fois"
      },
      "warnings": {
        "rekordboxExport": "Cette clé a été exportée par rekordbox. Sa bibliothèque est remplacée par celle-ci ; la musique déjà présente est réutilisée.",
        "exfat": "exFAT. Le CDJ-2000 ne le lit pas.",
        "gpt": "GPT. Le CDJ-2000 et les NXS2 ne le lisent pas.",
        "notVolumeRoot": "Les lecteurs ne lisent que la racine d’une clé USB.",
        "cdj2000_one": "{{count}} piste risque de ne pas jouer sur un CDJ-2000",
        "cdj2000_other": "{{count}} pistes risquent de ne pas jouer sur un CDJ-2000",
        "noSpace": "Ça ne tient pas. Il faut {{needed}} et il reste {{free}}.",
        "ntfs": "NTFS. Les lecteurs ne le lisent pas.",
        "unexportable_one": "{{count}} piste ne peut pas être exportée",
        "unexportable_other": "{{count}} pistes ne peuvent pas être exportées"
      },
      "unexportable": {
        "missing-file": "fichier introuvable",
        "streaming": "piste en streaming",
        "skipped": "baken ne la prend pas"
      }
    }
  },
  "pt-BR": {
    "commands": {
      "exportUsb": "Exportar para USB…"
    },
    "sources": {
      "tree": {
        "exportUsb": "Exportar para USB"
      }
    },
    "usbExport": {
      "title": "Exportar para USB",
      "pill": "USB {{done}}/{{total}}",
      "connected": "USB {{name}} conectado",
      "connectedAction": "Exportar",
      "holder": {
        "empty": "vazio",
        "today": "hoje {{time}}",
        "on": "em {{date}} {{time}}",
        "rekordbox": "exportado pelo rekordbox {{when}}",
        "surco": "exportado pelo Surco {{when}}",
        "other": "tem uma exportação, {{when}}"
      },
      "choose": {
        "tick": "Marcar {{name}}",
        "sticks": "USB",
        "none": "Conecte um USB",
        "other": "Outro destino…",
        "capacity": "{{total}} · {{free}} livres",
        "pick": "Marque playlists e escolha um USB.",
        "calculating": "Calculando…",
        "prune": "Apagar do USB a música que não é mais exportada",
        "cancel": "Cancelar",
        "export": "Exportar",
        "settings": "Copiar My Settings"
      },
      "summary": {
        "tracks_one": "{{count}} faixa",
        "tracks_other": "{{count}} faixas",
        "new_one": "{{count}} nova · {{size}}",
        "new_other": "{{count}} novas · {{size}}",
        "kept_one": "{{count}} já está",
        "kept_other": "{{count}} já estão",
        "removed_one": "{{count}} removida desde a última vez",
        "removed_other": "{{count}} removidas desde a última vez"
      },
      "warnings": {
        "rekordboxExport": "Este USB foi exportado pelo rekordbox. A biblioteca dele é substituída por esta; a música que já está é aproveitada.",
        "exfat": "exFAT. O CDJ-2000 não lê.",
        "gpt": "GPT. O CDJ-2000 e os NXS2 não leem.",
        "notVolumeRoot": "Os players só leem a raiz de um USB.",
        "cdj2000_one": "{{count}} faixa pode não tocar num CDJ-2000",
        "cdj2000_other": "{{count}} faixas podem não tocar num CDJ-2000",
        "noSpace": "Não cabe. São necessários {{needed}} e há {{free}} livres.",
        "ntfs": "NTFS. Os players não leem.",
        "unexportable_one": "{{count}} faixa não pode ser exportada",
        "unexportable_other": "{{count}} faixas não podem ser exportadas"
      },
      "unexportable": {
        "missing-file": "arquivo não encontrado",
        "streaming": "faixa de streaming",
        "skipped": "o baken não a aceita"
      }
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
### Task 12: Verify on the test stick (macOS), then the players, then a Windows user's checklist

**Files:**
- Modify: `docs/export-usb-medidas.md` (section "Verificación")
- Scratch only: `$SCRATCH/usb-verify/`

**Interfaces:**
- Consumes: everything above, in the packaged app.
- Produces: the go or no-go for merging, written in the note.

```bash
export SCRATCH=/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad
```

Only the stick with Volume UUID `B10C96EF-51C2-344E-B78D-DAFC319D973E` is written. Before every step that writes, confirm it is the only removable volume mounted:

```bash
for v in /Volumes/*; do diskutil info "$v" 2>/dev/null | grep -E 'Volume UUID|Removable Media|Device Location' | tr '\n' ' '; echo " <- $v"; done
```

Expected: exactly one line with `Removable` / `External` and that UUID. Anything else: unplug it first. No second stick is ever plugged in during this task (Vicent's real sticks are both named "Vicent"; the same-name case is pinned by Task 8's and Task 9's tests instead).

- [ ] **Step 1: The signed build carries a signed, notarized baken (before any tag)**

Push the branch and run the hand-launched test build's macOS job (it publishes nothing):

```bash
git push -u origin worktree-fuentes-dj-playlists
gh workflow run build-test.yml -f ref=worktree-fuentes-dj-playlists
gh run watch "$(gh run list --workflow build-test.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected: the `mac-signed` job passes its "Check baken is signed, hardened and notarized" step (Developer ID authority, `runtime` flag, stapled ticket, `spctl` accepted, `--json` in the help) and the `windows` job builds an installer with `resources\baken\baken.exe`. Download both artifacts (`gh run download`) into `$SCRATCH/usb-verify/`. Ask Vicent before pushing (this is the only push in the plan); nothing here is tagged or released.

Then the local package for the steps below, from the worktree root:

```bash
npm ci
BAKEN_TEST=1 npm run build-baken --workspace apps/desktop
cd apps/desktop && npx electron-vite build && npx electron-builder --mac --dir --publish never && cd ../..
APP=$(ls -d apps/desktop/dist/mac*/Surco.app)
"$APP/Contents/Resources/baken/baken" expressport --help | grep -c -- '--json'
ls "$APP/Contents/Resources/baken/"
```

Expected: `1`, and `baken LICENSE THIRD_PARTY_LICENSES.md`.

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
- the modal lists only `Surco`, with its capacity, `exFAT` and what it holds;
- tick `BASES` (Makina gets ticked and the folder is open); the summary says 7 pistas, the warnings show exFAT (and the rekordbox one if the stick still has rekordbox's export at its root);
- "Copiar My Settings" and "Borrar del USB…" are both off;
- double-click Exportar: one export starts (the button greys at the first click);
- the list fills row by row, the copying row's waveform reveals left to right, MB/s and time left move, Cancelar is replaced by "Terminando…" at the end;
- press "Seguir en segundo plano" mid-copy: the modal closes, the pill `USB n/7` and the top line move, the rest of the app stays responsive, and the "Listo" notice appears at the end; reopening the modal shows the chooser again;
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
ls /Volumes/Surco/PIONEER/MYSETTING.DAT 2>&1 | tail -1
cat "/Volumes/Surco/Mis cosas/nota.txt"
```

Expected (each script prints its own verdict; if a path argument differs, read its head and pass the stick the way it expects):
- `PDB VALID`, BASES/Makina with 7 tracks in order; rekordcrate parses every ANLZ; pyrekordbox opens OneLibrary with 7 entries;
- `slot_colors.py` prints, for letters 1..6, code 0 and exactly rekordbox's RGB (`(0, 0, 255, 0, 23)`, `(0, 0, 0, 196, 255)`, …), the same as on `rekordbox-baseline`;
- `PVDI equal to rekordbox 7, different 0`;
- 28 artwork files (7 tracks × 4) instead of the spike's 8;
- no `MYSETTING.DAT` written by this export (the box was off; if the stick already had one, its date is unchanged);
- `no tocar`.

- [ ] **Step 5: Second export, incremental, the memory and the boxes**

Close and reopen the modal: `Surco` is preselected and `BASES` ticked. The summary reads `0 nuevas` and `7 ya están`. Tick "Copiar My Settings" and export: it takes about a second, every row says "ya estaba", and `PIONEER/MYSETTING.DAT` now exists. Reopen: the box is still ticked (remembered for this stick). Then tick one more small playlist: only its tracks are new; export. Then untick it: the summary says "N quitadas desde la última vez"; export with the prune box **off**: those files are still in `Contents/` (`find /Volumes/Surco/Contents -newer "$SCRATCH/usb-verify/stick-root-before.txt" | wc -l`), and the stick's database no longer lists the playlist (rerun `validate_pdb.ts`).

- [ ] **Step 6: Failure paths and refusals**

- Cancel during copy (tick a playlist with a large WAV not yet on the stick): "Cancelando…" until that track finishes, then "Cancelado…". `validate_pdb.ts` still shows the previous library, and the WAV that was copying is complete (`ls -l` its size equals the source's) or absent, never shorter.
- Unplug during copy (same kind of playlist): "El USB se desconectó…"; nothing is written on the Mac's disk (`ls /Volumes` shows no leftover `Surco` folder); plug back in and export: it completes and `validate_pdb.ts` is valid.
- "Otro destino…" on a folder of the Mac's disk (`~/Desktop`): the summary says "Elige una carpeta de un USB o una tarjeta." and Exportar stays disabled. On `/Volumes/Surco/sets`: the warning "Los reproductores solo leen la raíz de un USB" and no prune box.
- Too big: tick enough playlists to exceed the stick's free space: "No cabe. Hace falta X y hay Y libres." and Exportar disabled.

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

- [ ] **Step 9: The Windows checklist, for a Windows user**

There is no Windows machine here. Write this list (Spanish, for Vicent to pass on) in the note's "Verificación en Windows" section, with the installer from Step 1's `windows` artifact. The tester needs rekordbox 7 installed on that PC with a few analysed playlists, and a spare USB stick that may be wiped (FAT32).

1. Instalar el build de prueba (SmartScreen avisará: "Más información" y "Ejecutar de todos modos"; la app va sin firmar, como hoy).
2. Abrir Surco, elegir rekordbox en el carril: el árbol sale y en su cabecera está el botón de USB. Ctrl+K "Exportar a USB…" también.
3. Abrir el modal sin USB conectado: "Conecta un USB". Conectar el USB: aparece solo en 2 o 3 segundos, con su nombre, capacidad, libre y "FAT32". Desconectarlo: desaparece. Volver a conectarlo (aunque Windows le dé otra letra): se reconoce como el mismo, con lo que tenía marcado si ya se exportó.
4. Exportar una playlist pequeña: la lista avanza fila a fila, termina con "Listo · N pistas…", y en el Explorador el USB tiene `PIONEER` y `Contents` en su raíz y nada más cambiado.
5. Repetir sin cambios: todas "ya estaba", en segundos.
6. Exportar una playlist grande y pulsar Cancelar mientras copia: "Cancelando…", y luego "Cancelado". El USB sigue con la exportación anterior.
7. Exportar otra vez y desenchufar a mitad: "El USB se desconectó…". Volver a conectar y exportar: termina bien.
8. "Otro destino…" en `C:\Users\…\Escritorio`: "Elige una carpeta de un USB o una tarjeta."
9. Comprobar en `%APPDATA%\Pioneer\rekordbox` que las fechas de `master.db` y de la carpeta `share` no cambian por exportar (solo cambian si rekordbox está abierto y escribe él).
10. Llevar el USB a un reproductor (o a un Mac con Surco y los validadores de este plan) y repasar los puntos 1, 2, 3, 5, 7 y 11 de la lista de hardware.
11. Si algo falla: versión de Windows, el texto exacto del aviso y el registro de Surco (`%APPDATA%\Surco\logs\main.log`).

- [ ] **Step 10: Write the verdict and commit**

Add to `docs/export-usb-medidas.md` a section "Verificación (fecha)" with the times of Steps 3 and 5, each Step's expected-versus-seen, the hardware answers per model and firmware, the Windows checklist (and its answers when they come back), and the verdict. Any failed check is a bug to fix (with its red test) before merging, not a note. Windows stays "pendiente de verificar" until the checklist comes back.

```bash
git add docs/export-usb-medidas.md
git commit -m "Record the USB export's verification on the test stick and the players"
```
