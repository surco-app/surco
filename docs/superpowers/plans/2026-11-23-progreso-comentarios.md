# Progreso al guardar comentarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While «Guardar N comentarios» writes file tags, the button fills like Convertir, reads «Guardando… done/total», and on hover reads «Cancelar»; cancelling stops after the current file and leaves the rest pending.

**Architecture:** `cues:saveComments` in main already writes files one by one after queueing rekordbox. It gains a progress event per file (`cues:commentProgress`), a cancel channel (`cues:cancelComments`) checked before each file, and returns the unwritten paths apart from the failed ones. The renderer's split button in `CuesBatchSection` shows the fill and the labels, stacked in one grid cell so the width never changes.

**Tech Stack:** Electron IPC, React 19, i18next (8 locales), Vitest + Testing Library.

**Spec:** Sketch variant A, https://claude.ai/artifact/7C92PApwuyj8MwD9uJWvyG (chosen by Vicent 23/11/2026). Pattern to copy: `apps/desktop/src/renderer/src/components/BatchRun.tsx`.

## Global Constraints

- Paths are relative to `apps/desktop/src/`.
- Run tests from `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run <file>`; never filter from the repo root.
- Typecheck with all three: `tsc -p tsconfig.web.json --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `tsc -p tsconfig.scenarios.json --noEmit` (from `apps/desktop`, binary at `../../node_modules/.bin/tsc`). Lint: `../../node_modules/.bin/biome check src`.
- No code comments. Selectors in tests by `data-testid`. TDD: see the test fail first.
- Commit titles: descriptive, no body, no `feat:`. Never `--no-verify`.
- The button never changes width between idle, running and hover (NORMA «sin cambios de tamaño»).
- New i18n key `editor.cues.batch.savingComments`, exact values:
  ca «Desant… {{done}}/{{total}}», de «Wird gespeichert… {{done}}/{{total}}», en «Saving… {{done}}/{{total}}», es «Guardando… {{done}}/{{total}}», fr «Enregistrement… {{done}}/{{total}}», it «Salvataggio… {{done}}/{{total}}», ja «保存中… {{done}}/{{total}}», pt-BR «Salvando… {{done}}/{{total}}». «Cancelar» reuses `common.cancel`.
- rekordbox still receives every comment at once, before any file; cancel only stops file writes.

## Review Focus

- Cancel clicked during the last file: the result has no unwritten paths and the pending list empties.
- A cancelled run followed by a new save: the cancel flag of the old run must not stop the new one.
- «Solo en rekordbox» (toFile false): no progress, no fill, button behaves as today.
- The askToApply dialog still open: the button stays disabled (no cancel yet, nothing running).
- Cancelled tracks show no failure warning (they did not fail), but stay pending with the count in the label.

---

### Task 1: Progress and cancel in main and preload

**Files:**
- Modify: `main/cuesIpc.ts` (handler `cues:saveComments`, new handler `cues:cancelComments`)
- Modify: `preload/cues.ts`, `preload/api.ts` (`CuesApi`)
- Test: `main/cuesIpc.test.ts`, `preload/cues.test.ts`

**Interfaces:**
- Produces:
  - IPC event `cues:commentProgress` with payload `{ done: number; total: number }`, sent via `e.sender.send` (guard `!e.sender.isDestroyed()`, like `listReviewIpc.ts`), once with `done: 0` before the first file and once after each file (written or failed). Only when `toFile` and there is at least one rekordbox item.
  - `cues:saveComments` resolves `{ failed: string[]; unwritten: string[] }`. `unwritten` are the paths skipped because of a cancel; empty otherwise.
  - `ipcMain.handle('cues:cancelComments')` marks the running save(s) cancelled. Use a per-run object in a `Set`, like `listReviewIpc.ts` `running`, so a cancel never leaks into a later save.
  - `CuesApi.saveComments(items, toFile): Promise<{ failed: string[]; unwritten: string[] }>`, `CuesApi.cancelComments(): Promise<void>`, `CuesApi.onCommentProgress(cb: (p: { done: number; total: number }) => void): () => void` (returns unsubscribe). `createCuesApi` takes `Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>`; check `preload/index.ts` passes `ipcRenderer`.

- [ ] **Step 1: Write failing tests in `main/cuesIpc.test.ts`**
  Existing saveComments tests call the handler with `{}`; give the toFile ones a fake event `{ sender: { isDestroyed: () => false, send: vi.fn() } }` and update their expected result to `{ failed: [...], unwritten: [] }`.
  - `'tells the window how many files are written after each one, so the button can fill'`: two items, toFile true; `send` calls equal `[['cues:commentProgress', { done: 0, total: 2 }], ['cues:commentProgress', { done: 1, total: 2 }], ['cues:commentProgress', { done: 2, total: 2 }]]`, a failed write still counts.
  - `'stops after the file in progress when cancelled and hands back the rest, so they stay pending'`: three items with a controllable `writeCommentToFile` (as in the one-at-a-time test); while the first write is pending call `handler('cues:cancelComments')()`, release it; result `{ failed: [], unwritten: ['/m/b.wav', '/m/c.wav'] }`, `writeCommentToFile` called once, and rekordbox `enqueue` got all three.
  - `'a cancel from an earlier save does not stop the next one'`: cancel with nothing running, then save two items; both written, `unwritten: []`.
  - `'sends no progress when only rekordbox is asked'`: toFile false; `send` not called.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement in `main/cuesIpc.ts`.**
- [ ] **Step 4: Preload.** In `preload/cues.test.ts` update the table result if needed, add `['cancelComments', 'cues:cancelComments', []]`, and a test `'onCommentProgress relays each progress event and stops on unsubscribe'` with a fake `ipc` holding `on`/`removeListener` mocks. Implement in `preload/cues.ts` and `preload/api.ts`.
- [ ] **Step 5: Run both test files, the three tsc, biome. Fix any other caller of `createCuesApi` or of the result type.**
- [ ] **Step 6: Commit** «Report comment file progress and let the save stop after the current file».

### Task 2: Filling Guardar button with Cancelar

**Files:**
- Modify: `renderer/src/components/CuesBatchSection.tsx`
- Modify: `renderer/src/i18n/locales/{ca,de,en,es,fr,it,ja,pt-BR}.json` (key next to `saveComments_*` under `editor.cues.batch`)
- Test: `renderer/src/components/CuesBatchSection.test.tsx` (extend its `window.api.cues` mock with `cancelComments` and `onCommentProgress`)

**Interfaces:**
- Consumes: Task 1 `CuesApi` additions and result shape.

Behaviour:
- `progress: { done: number; total: number } | null`. Set to `{ done: 0, total: n }` right after askToApply resolves when `settings.commentsToFile`; updated from `onCommentProgress` (subscribe in an effect, unsubscribe on unmount); `null` when the save ends.
- While `progress` is set: the save button stays enabled; its click calls `window.api.cues.cancelComments()`; it gets `aria-label={tr('common.cancel')}`; background `bg-[var(--color-accent)]/40` with an `absolute inset-0 origin-left` fill span `data-testid="cues-batch-comments-fill"` at `scaleX(done/total)` and the `progress-sweep` span, as in `BatchRun.tsx`. Label `data-testid="cues-batch-comments-progress"` reads `savingComments`, swapped for `common.cancel` on `group-hover`/`group-focus-visible`. Chevron and Descartar stay disabled (`busy`).
- Before askToApply resolves, and for «Solo en rekordbox», the button is disabled as today and shows no fill.
- Width: the three labels (idle `saveComments` with the count at save start, `savingComments` with `{done: total, total}`, `common.cancel`) share one grid cell (`grid` + `[grid-area:1/1]` on each); only the active one is visible, the others `invisible` and `aria-hidden`.
- After the save: `onCommentsSaved` gets the written ones (not failed, not unwritten); the pending list keeps failed + unwritten; the warning counts only `failed` (null when 0).

- [ ] **Step 1: Write failing tests**
  - `'fills the button and counts the files while they are written, so a long batch is not a dead button'`: `saveComments` held open; emit progress `{done:1,total:2}` through the captured `onCommentProgress` callback; `cues-batch-comments-progress` has text `i18n.t('editor.cues.batch.savingComments', {done:1,total:2})`; `cues-batch-comments-fill` style `transform: scaleX(0.5)`; save button enabled, options and discard disabled.
  - `'clicking the filling button cancels, and the unwritten tracks stay pending without a warning'`: click while running → `cancelComments` called; resolve `{ failed: [], unwritten: ['<path of second>'] }`; save button text `saveComments` count 1; `cues-batch-comments-failed` absent; `onCommentsSaved` got only the first.
  - `'shows no fill when only rekordbox is asked'`: settings `commentsToFile: false`; held save; no `cues-batch-comments-fill`, save button disabled.
  - `'keeps the button at one width while saving'`: idle, running and cancel labels are all in the DOM under the save button while running (three children of the label cell).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement; add the 8 locale values exactly as in Global Constraints.**
- [ ] **Step 4: Run the test file, the i18n parity test if any (`grep -rl "locales" renderer/src/i18n/*.test.ts`), the three tsc, biome.**
- [ ] **Step 5: Commit** «Fill the comment save button with progress and cancel on click».
