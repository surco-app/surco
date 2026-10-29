# Copias de las bibliotecas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the last 5 dated copies of each DJ library (one per "momento"), let the DJ restore any of them from a new full-screen "Copias" view at the bottom of the source rail, and move the audio-originals trash into that same view.

**Architecture:** Every library write already calls `SessionBackup.ensure(path)` before its first write. We keep that seam: `ensure` now writes a dated entry into a per-collection history (`main/libraryHistory.ts`) instead of overwriting `.surco-session`, and momento boundaries call `begin(reason)` where today only `process:batch-begin` calls `reset()`. Restore (`main/libraryRestore.ts`) reuses the existing closed-program checks and temp+rename. The renderer gets a `CopiesScreen` fed by one `copies:status` IPC.

**Tech Stack:** Electron main (Node fs/promises), React 19 + TS + Tailwind v4, react-i18next, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-10-29-copias-bibliotecas-design.md`

## Global Constraints

- 5 history copies per collection (`HISTORY_KEEP = 5`); 1 separate "antes de restaurar" copy that never counts among the 5.
- Copies live under `libraryBackupRoot()`, in the folder `dirname(backupOf(collectionPath, 'backup'))`, never next to the collection.
- A failed copy means no write (unchanged rule); pruning deletes only after the new entry is complete.
- `.surco-backup` (per-write copy) is untouched by this plan.
- macOS and Windows: replace files with `renameWithRetry` (`main/renameRetry.ts:60`).
- User rules (`~/.claude/CLAUDE.md`): TDD red→green, `data-testid` selectors, **no new code comments**, commit title only (no body, no `feat:`), never `--no-verify`. The codebase is heavily commented; per the user's rule new code adds none, but existing comments that this plan makes false must be corrected or removed.
- Spanish copy is fixed by this plan; `en, de, fr, ja, pt-BR` get faithful translations of the same keys.
- Commands (run in `apps/desktop`): `npx vitest run <file>`, `npm test`, `npx tsc --build`, `npm run lint`.

## Review Focus

1. The DJ program opens while a restore is running → the restore re-checks "closed" right before each rename and stops without touching the remaining files (Task 4).
2. Disk fills mid-copy → the partial entry is never listed, older entries are not pruned, and the write that asked for the copy is refused (Task 1, Task 2).
3. rekordbox `master.db-wal` or Engine `m.db-wal`/`m.db-journal` non-empty at restore → refused, nothing changed (Task 4).
4. Collection path changed (Traktor 4.4 → 4.5) → the section lists only the current collection's copies; restoring an entry whose `collectionPath` differs is refused (Task 4, Task 5).
5. Restoring several times in a row, or restoring the oldest entry → the 5 history entries are unchanged (Task 4).

---

### Task 1: Dated history store

**Files:**
- Create: `apps/desktop/src/main/libraryHistory.ts`
- Test: `apps/desktop/src/main/libraryHistory.test.ts`
- Modify: `apps/desktop/src/shared/types.ts` (add types below)

**Interfaces:**
- Produces (in `shared/types.ts`):
  - `type CopyReason = 'run' | 'cues' | 'review' | 'queue' | 'duplicates' | 'playlists' | 'restore'`
  - `interface LibraryCopy { id: string; collectionPath: string; takenAt: number; reason: CopyReason; files: { name: string; target: string }[] }`
- Produces (in `libraryHistory.ts`):
  - `HISTORY_KEEP = 5`
  - `takeCopy(collectionPath: string, companions: string[], reason: CopyReason, now?: number): Promise<LibraryCopy>`. With `reason: 'restore'` it replaces the single restore slot; otherwise it adds a history entry and prunes to `HISTORY_KEEP`.
  - `listCopies(collectionPath: string): Promise<LibraryCopy[]>`, newest first, history only.
  - `restoreSlot(collectionPath: string): Promise<LibraryCopy | null>`
  - `copyFolder(copy: LibraryCopy): string`, the folder that holds the copy's files.

Layout: `<dirname(backupOf(path,'backup'))>/history/<id>/` and `<…>/history-restore/`. Each folder holds the copied files by basename plus `copy.json` (the `LibraryCopy`). `id` = `String(takenAt)`. Write into `<id>.partial`, then rename to `<id>`. `listCopies` ignores `*.partial` folders and folders without a readable `copy.json`. Copy with `writeBackup` from `rekordboxSessionBackup.ts`. `companions` that don't exist are skipped.

- [ ] **Step 1: Write the failing tests** (temp dir + `setLibraryBackupRoot`, as in `libraryBackups.test.ts`)
  - `keeps the five newest copies so a DJ can still go back days later`: 6 calls with `now` 1..6 → `listCopies` ids `['6','5','4','3','2']`.
  - `copies companions into the same entry so rekordbox's playlists come back with master.db`: master.db + masterPlaylists6.xml → `files.map(f => f.name)` equals both basenames, `target` = original absolute paths, and the copied bytes equal the originals.
  - `a restore copy never pushes out history`: 5 history copies + 3 `'restore'` copies → `listCopies` length 5, `restoreSlot(...).takenAt` = last restore's `now`.
  - `a copy that fails halfway is never listed and prunes nothing`: 5 entries, then `takeCopy` with a missing collection file rejects → `listCopies` still the same 5 ids and no `.partial` folder is listed.
  - `two collections never share history`: two `collection.nml` paths in different folders → each `listCopies` has only its own.
- [ ] **Step 2: Run** `npx vitest run src/main/libraryHistory.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `libraryHistory.ts` and the types.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Keep the last five dated copies of each DJ library"`

### Task 2: SessionBackup writes into history, with momentos and grouped small edits

**Files:**
- Modify: `apps/desktop/src/main/rekordboxSessionBackup.ts:21-60` (interface, factory, and the comment at `:28-30` that says dated copies were rejected)
- Modify: `apps/desktop/src/main/traktorNmlLibrary.ts:38` (Traktor instance)
- Modify: `apps/desktop/src/main/index.ts:262-265` (rekordbox and Engine instances)
- Test: `apps/desktop/src/main/rekordboxSessionBackup.test.ts`; update `traktorNmlLibrary.test.ts:147,153` and `rekordboxPlaylistWrite.test.ts:238` (they call `reset()`)

**Interfaces:**
- Consumes: `takeCopy` (Task 1).
- Produces:
  ```ts
  interface SessionBackup {
    ensure: (collectionPath: string) => Promise<void>
    begin: (reason: CopyReason) => void
    beginLoose: (collectionPath: string) => void
    failed: () => ReadonlySet<string>
  }
  createSessionBackup(deps: { take?: typeof takeCopy; companionsOf?: (p: string) => string[]; skip?: (p: string) => boolean }): SessionBackup
  ```
  - `begin` clears the per-collection "done" set and sets the current reason (default `'run'`). It replaces `reset()`.
  - `beginLoose(p)`: the first call per path in the app's lifetime removes `p` from "done" and marks the next copy of `p` as `'playlists'`; later calls do nothing.
  - `ensure` on success removes the path from `failed()`; on throw it adds the path and rethrows.
  - rekordbox instance: `companionsOf = p => basename(p) === 'master.db' ? [playlistXmlPath(p)] : []` and `skip = p => basename(p) === 'masterPlaylists6.xml'` (its copy travels with master.db). This relies on `applyRekordboxBatch` ensuring master.db first (`rekordboxPlaylistWrite.ts:473`); a test pins that order.
- [ ] **Step 1: Write the failing tests** (inject `take: vi.fn()`)
  - `one copy per momento, however many tracks it writes`: `begin('run')`, `ensure(p)` ×3 → `take` called once with reason `'run'`.
  - `a new momento takes a new copy`: `begin('run')`, ensure, `begin('cues')`, ensure → 2 calls, the second with `'cues'`.
  - `small playlist edits share one copy per Surco session`: `beginLoose(p)`, ensure, `beginLoose(p)`, ensure → 1 call, reason `'playlists'`.
  - `the rekordbox XML is copied with master.db, not on its own`: ensure master.db then the XML → 1 call whose companions include the XML.
  - `a failed copy is remembered so the Copias screen can say so`: `take` rejects → `failed()` has `p` and `ensure` rejects; next success → `failed()` empty.
  - In `rekordboxPlaylistWrite.test.ts`: `ensures master.db before the playlist XML`.
- [ ] **Step 2: Run** `npx vitest run src/main/rekordboxSessionBackup.test.ts src/main/rekordboxPlaylistWrite.test.ts src/main/traktorNmlLibrary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace `reset()` with `begin('run')` at `index.ts:1386-1388`. Correct the `:28-30` comment so it no longer states the opposite of the new behaviour.
- [ ] **Step 4: Run the same command, then `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Take one dated library copy per momento instead of overwriting the session copy"`

### Task 3: Mark every momento and small edit

**Files:**
- Create: `apps/desktop/src/main/moments.ts`
- Test: `apps/desktop/src/main/moments.test.ts`
- Modify (call sites; each module gets an optional dep `beginMoment?: (r: CopyReason) => void` or `beginLoose?: (p: string) => void`, wired in `index.ts`):
  - `'cues'`: `rekordboxCuesIpc.ts:210` (`rekordbox:saveCues`)
  - `'review'`: `index.ts:1437` (`library:syncTags`), `listReviewIpc.ts:43` (`listreview:applyFixes`)
  - `'duplicates'`: `index.ts:1463` (`library:replaceDuplicates`), `listReviewIpc.ts:74`
  - `'queue'`: the `apply` passed to the three `watchRekordboxQueue` calls (`index.ts:306,362,415`), the three `apply…Quietly` (`:330,371,437`), and the manual apply handlers (`rekordbox:applyNow` in `rekordboxQueueIpc.ts`, `engineCueQueueIpc.ts:16`, `traktorCueQueueIpc.ts:16`)
  - loose: `rekordboxPlaylistsIpc.ts:123` (`rekordbox:edit`) and `traktorPlaylistEditIpc.ts:26` (`traktor:edit`), with the collection path the handler already resolves

**Interfaces:**
- Consumes: the three `SessionBackup`s (Task 2).
- Produces: `createMoments(sessions: SessionBackup[]): { begin(r: CopyReason): void; beginLoose(p: string): void }`, which fans out to all three. `index.ts` builds one `moments` and passes `moments.begin` / `moments.beginLoose`.

- [ ] **Step 1: Write the failing tests**
  - `moments.test.ts`: `begin fans out to every program so a review touching three libraries copies all three`.
  - `rekordboxCuesIpc.test.ts`: `saving cues starts a cues momento before anything is queued` (beginMoment called with `'cues'` before `queue.enqueue`).
  - `rekordboxPlaylistsIpc.test.ts` / `traktorPlaylistEditIpc.test.ts`: `a playlist edit is a small change of its collection` (beginLoose called with the collection path before `queue.apply`).
  - `engineCueQueueIpc.test.ts` / `traktorCueQueueIpc.test.ts`: `applying the queue by hand is a queue momento`.
  - `listReviewIpc.test.ts`: `applying fixes is a review momento`; `removing duplicates is a duplicates momento`.
- [ ] **Step 2: Run** those test files. Expected: FAIL.
- [ ] **Step 3: Implement** `moments.ts` and wire the call sites.
- [ ] **Step 4: Run** those files, then `npm test` and `npx tsc --build`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Start a library copy momento at every write the DJ triggers"`

### Task 4: Restore a copy

**Files:**
- Create: `apps/desktop/src/main/libraryRestore.ts`
- Test: `apps/desktop/src/main/libraryRestore.test.ts`

**Interfaces:**
- Consumes: `listCopies`, `takeCopy`, `copyFolder` (Task 1); `renameWithRetry`.
- Produces:
  ```ts
  type RestoreRefusal = 'running' | 'pending-log' | 'not-found' | 'other-collection' | 'failed'
  restoreCopy(req: { collectionPath: string; copyId: string }, deps: {
    ensureClosed: () => Promise<boolean>
    isRunning: () => Promise<boolean>
    pendingLog: (collectionPath: string) => boolean
    discardQueue: () => void
  }): Promise<{ ok: true } | { ok: false; reason: RestoreRefusal }>
  ```
  Order: find the copy among `listCopies` or `restoreSlot`, else `'not-found'`; check `copy.collectionPath === req.collectionPath`, else `'other-collection'`; `ensureClosed()` false → `'running'`; `pendingLog` true → `'pending-log'`; `takeCopy(current, companions, 'restore')`, and if that throws → `'failed'` with nothing changed. Then for each file: copy to `<target>.surco-tmp`, check `isRunning()` again (true → stop with `'running'`), then `renameWithRetry` over `target`. Finally `discardQueue()`.
  - `pendingLog`: rekordbox `master.db-wal` size > 0; Engine `m.db-wal` or `m.db-journal` size > 0; Traktor always false.

- [ ] **Step 1: Write the failing tests** (temp files)
  - `puts the collection back byte for byte`.
  - `restores master.db and its playlist XML together`.
  - `keeps a copy of what it overwrote so restoring can be undone`: `restoreSlot` holds the pre-restore bytes.
  - `restoring never changes the five history copies` (Review Focus 5): ids before and after are equal, also when restoring the oldest one twice.
  - `refuses while the program is open and changes nothing`.
  - `stops if the program opens mid-restore` (Review Focus 1): `isRunning` true on the second file → result `'running'` and the second target is unchanged.
  - `refuses when rekordbox still has an unfolded log` (Review Focus 3).
  - `refuses a copy of another collection` (Review Focus 4).
  - `discards that program's waiting changes so they don't land on the restored copy`.
- [ ] **Step 2: Run** `npx vitest run src/main/libraryRestore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Restore a DJ library from one of its copies"`

### Task 5: Copias IPC and status

**Files:**
- Create: `apps/desktop/src/main/copiesIpc.ts`, `apps/desktop/src/main/copiesIpc.test.ts`
- Modify: `main/index.ts` (register near `:1846`; pass the per-program deps), `preload/api.ts`, `preload/index.ts`, `renderer/src/test/api.ts`, `shared/types.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4. Per-program collection paths: `rekordboxCollectionPath()` (`libraryFlushes.ts:71`), `traktorWritePath()` (`index.ts:397`), `engineDatabasePath(engineLibraryPath())` (`index.ts:342`, `enginePlaylists.ts:23`). Closed-program helpers: `ensureEngineDjClosed`, the Traktor and rekordbox twins in `index.ts:518-610`. Queues: `.state()` (`tracks + changes`, `halted`) and `.discard()`.
- Produces:
  ```ts
  type DjProgram = 'rekordbox' | 'traktor' | 'engine'
  interface ProgramCopies { program: DjProgram; collectionPath: string | null; copies: LibraryCopy[]; restore: LibraryCopy | null; pending: number; halted: boolean; copyFailed: boolean; untouched: boolean }
  ```
  - IPC `copies:status` → `ProgramCopies[]`, only for programs found on this machine. `untouched` = `!settings.syncRekordbox` / `!syncTraktor` / `!syncEngineDj`.
  - IPC `copies:restore(program, copyId)` → the `restoreCopy` result; afterwards it broadcasts `copies:changed`.
  - Every `takeCopy` attempt, successful or failed, also broadcasts `copies:changed` (via the `take` dep the instances get in `index.ts`), so a failed copy turns the rail red without waiting for a refresh.
  - preload: `copiesStatus()`, `restoreCopy(program, copyId)`, `onCopiesChanged(cb) => unsubscribe`. Reveal reuses the existing `revealBackups`.
- [ ] **Step 1: Write the failing tests** (pattern from `shellIpc.test.ts`: mock `electron`, `handlerFor(channel)`)
  - `lists only the current collection's copies` (Review Focus 4): copies exist for an old Traktor path → status for the new path has `copies: []`.
  - `reports waiting changes and a halted queue per program`.
  - `marks a program the DJ set to "No tocar" as untouched but still lists its copies`.
  - `restoring broadcasts copies:changed so the screen refreshes`.
- [ ] **Step 2: Run** `npx vitest run src/main/copiesIpc.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire.
- [ ] **Step 4: Run** it, then `npx tsc --build`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Expose DJ library copies and restore to the window"`

### Task 6: Status rules and copy (pure)

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/copiesView.ts`, `copiesView.test.ts`
- Modify: `renderer/src/i18n/locales/{es,en,de,fr,ja,pt-BR}.json` (new `copies` block)

**Interfaces:**
- Produces:
  - `programState(p: ProgramCopies): 'halted' | 'failed' | 'pending' | 'untouched' | 'ok'`, checked in that order.
  - `railAlert(list: ProgramCopies[]): 'none' | 'warn' | 'danger'`: any halted or failed → danger; any pending → warn.
  - `COPIES_KEEP = 5`.
- Spanish keys (exact):
  - `copies.rail`: "Copias"; `copies.title`: "Copias"; `copies.intro`: "Antes de tocar tus programas o tus archivos, Surco guarda una copia. Si algo no te cuadra, vuelve atrás."
  - `copies.state.ok`: "Al día"; `copies.state.pending`: "{{count}} cambios esperan a que cierres {{program}}"; `copies.state.halted`: "Surco ha parado: revisa los cambios pendientes"; `copies.state.failed`: "La última copia falló"; `copies.state.untouched`: "Surco no lo toca (lo has elegido en Ajustes)"
  - `copies.facts.state`: "Estado"; `copies.facts.last`: "Última copia"; `copies.facts.kept`: "Guardadas"; `copies.kept`: "{{count}} de {{max}}"; `copies.none`: "Aún no hay copias"
  - `copies.reason.run`: "Antes de convertir"; `.cues`: "Antes de guardar cues"; `.review`: "Antes de corregir metadatos"; `.queue`: "Antes de aplicar los cambios que esperaban"; `.duplicates`: "Antes de reemplazar duplicados"; `.playlists`: "Antes de tus cambios de playlists de hoy"; `.restore`: "Antes de restaurar"
  - `copies.show`: "Ver copias"; `copies.hide`: "Ocultar copias"; `copies.restore`: "Restaurar…"; `copies.restoreThis`: "Restaurar esta"
  - `copies.confirm.title`: "¿Volver a como estaba {{program}} {{when}}?"; `copies.confirm.body`: "Se perderá lo que hayas cambiado en {{program}} después de esa hora, también lo que hiciste desde {{program}}."; `copies.confirm.safety`: "Antes guardamos una copia de cómo está ahora, por si cambias de idea."; `copies.confirm.queue`: "También se descartarán {{count}} cambios que esperaban a que cerraras {{program}}."; `copies.confirm.ok`: "Restaurar"
  - `copies.refused.running`: "{{program}} sigue abierto. Ciérralo y vuelve a intentarlo."; `.pending-log`: "{{program}} aún está guardando cambios. Espera un momento y vuelve a intentarlo."; `.not-found` / `.other-collection`: "Esta copia ya no corresponde a tu colección actual."; `.failed`: "No se pudo restaurar. Tu biblioteca no ha cambiado."
  - `copies.music.title`: "Archivos de música"; `copies.music.state`: "Originales guardados"; `copies.footer`: "De cada programa guardamos las últimas 5 copias. Los archivos de música, {{days}} días."; `copies.reveal`: "Mostrar en Finder" (Windows: "Mostrar en el Explorador", following the existing reveal keys)
- [ ] **Step 1: Write the failing tests**: `a halted queue outranks waiting changes`, `a failed copy turns the rail red`, `waiting changes alone turn it amber`, `untouched with no problems shows no dot`. Also a locale-parity test if one exists (check `i18n` tests); otherwise every locale gets the same keys.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/lib/copiesView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and add the locale keys.
- [ ] **Step 4: Run** it plus the i18n tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Decide what the Copias screen and its rail icon say"`

### Task 7: Refactor — extract the trash list out of its modal

Behaviour-preserving only.

**Files:**
- Create: `apps/desktop/src/renderer/src/components/TrashBrowser.tsx`
- Modify: `components/TrashPanel.tsx` (becomes `ModalShell` + `TrashBrowser`)
- Test: existing `TrashPanel.test.tsx` must pass unchanged

**Interfaces:**
- Produces: `TrashBrowser(props: Omit<TrashPanelProps, 'onClose'>)`, which holds the sidebar filters, search, rows, remove/empty confirmations and usage bar, with the same `data-testid`s.
- [ ] **Step 1: Run** `npx vitest run src/renderer/src/components/TrashPanel.test.tsx`. Expected: PASS (baseline).
- [ ] **Step 2: Move** the body into `TrashBrowser`; `TrashPanel` renders `<ModalShell …><TrashBrowser …/></ModalShell>`.
- [ ] **Step 3: Run** the same command and `npm run lint`. Expected: PASS, no warnings.
- [ ] **Step 4: Commit** `git commit -m "Split the trash list out of its dialog"`

### Task 8: CopiesScreen

**Files:**
- Create: `renderer/src/components/CopiesScreen.tsx`, `CopiesScreen.test.tsx`, `renderer/src/hooks/useCopies.ts`
- Mockup: `/Users/vicent/code/surco/.superpowers/brainstorm/94961-1793309731/content/copias-boceto-v3.html` (layout, not pixels; use `index.css` tokens)

**Interfaces:**
- Consumes: `window.api.copiesStatus/restoreCopy/onCopiesChanged/revealBackups` (Task 5); `programState`, `COPIES_KEEP` (Task 6); `TrashBrowser` (Task 7); `ConfirmDialog` (`components/ConfirmDialog.tsx`); `SOURCE_ICON` (`SourceRail.tsx`).
- Produces:
  - `useCopies(): { programs: ProgramCopies[]; refresh(): void }`. It reloads on mount, on `onCopiesChanged`, and on the three queue-changed events used by `useRekordboxQueue`.
  - `CopiesScreen(props: { programs: ProgramCopies[]; trash: TrashBrowserProps; openMusic?: boolean; onRestore(program: DjProgram, copyId: string): Promise<RestoreResult>; onReveal(): void })`
  - testids: `copies-screen`, `copies-section-<program>`, `copies-section-music`, `copies-state-<program>`, `copies-toggle-<program>`, `copies-restore-<program>`, `copies-item-<id>`, `copies-restore-item-<id>`.
  - Sections: one per program in `programs` order rekordbox, Traktor, Engine, then music. "Restaurar…" restores `copies[0]` and is disabled only when `copies` is empty. Dates come from `Intl.DateTimeFormat(lng, …)`. The restore slot appears at the top of the list, labelled `copies.reason.restore`. The music section shows count and size (`formatBytes`) and, when expanded, `TrashBrowser`.
- [ ] **Step 1: Write the failing tests**
  - `shows each program's state, last copy and how many of five are kept`.
  - `restoring asks first, says what is lost and that the current state is kept`: click `copies-restore-rekordbox` → the dialog text contains the `confirm.body` and `confirm.safety` strings; with `pending: 3` it also contains `confirm.queue`.
  - `a refused restore says why and leaves the screen as it was`: `onRestore` resolves `{ok:false, reason:'running'}` → `refused.running` text is shown.
  - `restore stays available for a program set to "No tocar"`.
  - `opening from a track's backup mark lands on the music files with the search filled` (`openMusic` + `trash.initialQuery`).
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/CopiesScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the Copias screen with one section per program and the music files"`

### Task 9: Rail entry and App wiring

**Files:**
- Modify: `renderer/src/components/SourceRail.tsx`, `SourceRail.test.tsx`, `renderer/src/App.tsx` (`:356` trash state, `:1996-2006` open handlers, `:3104` rail condition, `:3507-3520` `TrashPanel` render)
- Delete: `components/TrashPanel.tsx` and its test, if nothing else imports them after this task (move any assertions still meaningful into `CopiesScreen.test.tsx`)

**Interfaces:**
- Consumes: `CopiesScreen`, `useCopies`, `railAlert`.
- Produces: `SourceRail` gets the props `copies: { active: boolean; alert: 'none' | 'warn' | 'danger'; onOpen(): void }`.
  - It renders a bottom item (`mt-auto`, testid `source-rail-copies`) with lucide `ShieldCheck`, or `ShieldAlert` when the alert is danger, and the label `copies.rail`.
  - A dot (testid `source-rail-copies-dot`, `data-alert`) appears only when the alert is not `none`.
- App:
  - `copiesOpen` state. Picking any source closes it; opening it clears `browser.source` highlighting.
  - While open, the tree, list and `main` are replaced by `<CopiesScreen>` filling `flex-1`.
  - The rail renders even when `browser.sources.length === 0`.
  - `onOpenTrash` and `onOpenBackup` open Copias with the music section expanded (and `initialQuery`) instead of `TrashPanel`.
- [ ] **Step 1: Write the failing tests**
  - `SourceRail.test.tsx`: `shows Copias at the bottom with no dot when all is well`; `an amber dot when changes are waiting`; `a red dot and alert shield when Surco stopped`.
  - An App-level test (follow `App.test.tsx` or `scenarios/*`): `the rail and Copias show even without any DJ program`; `a track's backup mark opens Copias on that file`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/components/SourceRail.test.tsx src/renderer/src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the imports, state and functions this makes unused.
- [ ] **Step 4: Run** `npm test`, `npx tsc --build`, `npm run lint`. Expected: all PASS, no warnings.
- [ ] **Step 5: Manual check:** run the app (`run` skill). Convert one track with rekordbox sync on → Copias shows a "Antes de convertir" copy. Restore it with rekordbox closed → the collection opens in rekordbox as before.
- [ ] **Step 6: Commit** `git commit -m "Open Copias from the bottom of the source rail"`
