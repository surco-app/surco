# Perf Instantáneo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Tasks are ordered but independent; each is one commit.

**Goal:** Make Surco feel instant by caching previously computed results (metadata, analyses, lookups, covers) and trimming startup work — no behavior changes, no new features.

**Architecture:** Reuse the two proven primitives: `cachedAnalysis` (userData disk cache keyed `sha1(namespace + path + mtimeMs)`, `apps/desktop/src/main/analysisCache.ts:35`) for byte-pure per-file results, and the Apple Music snapshot pattern (userData JSON + placeholder/seed in the renderer) for stale-while-revalidate data. Startup trims use `React.lazy` and lazy i18n resource loading.

**Tech Stack:** Electron main + preload, React 19, TanStack Query v5, i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-perf-instantaneo-design.md`

## Global Constraints

- Behavior-identical output: caches only skip recomputation, never change results. Cold caches → exactly today's behavior.
- Corrupt/missing cache artifacts degrade to live compute, never to errors.
- TDD per task (failing test first, watch it fail, implement, watch it pass). Implementers must study the neighbouring test files' patterns before writing tests.
- After each task: the task's test files pass, `npx tsc --build` clean, `npx biome check <changed files>` clean. Never `npm run check` (reformats ~92 unrelated files).
- Comments follow the codebase's dense explanatory style. Commit titles descriptive, no prefix (no `feat:`), no body. One task per commit, exact message given per task.
- Work from `apps/desktop/` for all npm/npx commands.
- Surgical changes: do not refactor, reformat, or improve adjacent code beyond what the task needs.

---

### Task 1: Disk-cache `readMeta` per path+mtime

**Files:**
- Modify: `apps/desktop/src/main/ffmpeg.ts` (readMeta, ~line 405)
- Modify or create test: follow where `readMeta`/ffmpeg helpers are currently tested; if none fits, create `apps/desktop/src/main/readMetaCache.test.ts` modeled on `apps/desktop/src/main/analysisCache.test.ts`

**Requirements:**
- Wrap the expensive body of `readMeta` in `cachedAnalysis` (namespace suggestion: `readmeta-v1`) so a second call for an unchanged file (same path+mtime) returns the identical result from disk without spawning ffprobe/ffmpeg/TagLib.
- The cached value is the complete `readMeta` result (tags, duration, cover thumbnail data URL, cover dims, foreign tags, grouping — whatever the function returns today). It must round-trip JSON cleanly; if any field is not JSON-safe, restructure the cached shape, not the public return type. The public signature and returned shape of `readMeta` must not change.
- `shouldCache`: only cache fully successful reads (probe succeeded). A failed/partial probe must not pin its failure.
- Surco's own tag writes bump mtime → natural invalidation; do not add manual invalidation.
- Mind `MAX_ENTRY_BYTES` (10 MB): the 384px JPEG data URL is ~50-100 KB, fine; do NOT cache full-resolution covers.
- Tests must prove: (a) second call with same mtime returns equal result WITHOUT re-running the compute (spy/counter on the compute layer); (b) touching the file (mtime change) re-computes; (c) a failed probe is not cached (next call retries).

**Verification:** `npx vitest run <the test file(s)>` then the full `src/main` suite: `npx vitest run src/main`; `npx tsc --build`; biome on changed files.

**Commit message:** `Cache track metadata reads on disk keyed by file mtime`

---

### Task 2: Batch hydration of cached analyses on load

**Files:**
- Modify: `apps/desktop/src/main/analysisCache.ts` (add a read-only "peek" that returns the cached payload for (namespace, path) or null, without computing)
- Modify: `apps/desktop/src/main/audioIpc.ts` (extract the namespace strings used by the live handlers — `spectrogram-mono-v13`, `loudness`, `clickcount-v2`, `properties`, `bpm`, `key`, `waveform-v5`, `channelscan-v1` — into shared exported constants used by BOTH the live handlers and the new batch handler; add IPC `audio:cached-batch` taking `paths: string[]` and returning, per path, the cached payloads that exist — never computing on miss)
- Modify: `apps/desktop/src/preload/index.ts` + `apps/desktop/src/preload/api.ts` (expose `loadCachedAnalyses(paths)`)
- Modify: renderer — where tracks get added (`useTrackLibrary` or an adjacent hook): after paths are known, call the batch IPC once and seed React Query via `queryClient.setQueryData([name, path], payload)` for each hit, so `tracksSnapshot`/`useTracksView` show verdicts immediately. Seeding must NOT mark misses in any way that suppresses the normal lazy probes, and must NOT overwrite fresher in-session data (skip `setQueryData` when the key already has data).
- Tests: main-side test for the peek + batch collection (model on `analysisCache.test.ts`); renderer-side test proving seeded payloads surface without the per-probe IPC being called and that existing query data is not clobbered (model on existing hooks tests, e.g. `useLibraryMembership.test.tsx`).

**Requirements:**
- The heavy families' payloads can be large (waveform ~0.5 MB/track): hydrate ONLY what the list verdicts need. Determine which probe results `useTracksView`/triage actually consume for dots/filters (spectrogram verdict, loudness/silence, channel-scan clipping, properties, clicks — NOT the raw waveform peaks) and hydrate exactly those; document the chosen set in a comment.
- One IPC round-trip per load batch, not per track. Missing/corrupt entries are simply absent from the response.
- The batch read must reuse the exact key derivation (`sha1(namespace + ' ' + path + ' ' + mtimeMs)`) — export a helper from `analysisCache.ts` rather than duplicating it.

**Verification:** new tests + `npx vitest run src/main src/renderer/src/hooks`; `npx tsc --build`; biome on changed files.

**Commit message:** `Hydrate list verdicts from the analysis disk cache in one batch`

---

### Task 3: Persist Discogs/Bandcamp lookup caches

**Files:**
- Create: `apps/desktop/src/main/lookupCacheStore.ts` (one small module: load/save a capped, insertion-ordered map from `userData/<name>.json`; write-then-rename like `appleMusicLibraryCache.ts`; corrupt/missing → empty)
- Modify: `apps/desktop/src/main/discogs.ts` (back `searchCache` and `releaseCache` with the store)
- Modify: `apps/desktop/src/main/bandcamp.ts` (same for its `searchCache`/`releaseCache`)
- Test: `apps/desktop/src/main/lookupCacheStore.test.ts` (+ extend discogs/bandcamp tests only if they already exist and cover the caches)

**Requirements:**
- Caps: 300 search entries and 300 release entries per provider; inserting past the cap evicts the oldest. Document the cap reasoning briefly (bound disk + parse time; releases can be tens of KB).
- Persistence is debounced (a few seconds) after mutations and flushed on `app` quit (`before-quit`); loading happens once, lazily, on first cache access — never on the startup critical path synchronously in a way that adds startup cost.
- `hasCachedSearch`/`hasCachedRelease` semantics (skipping limiter tokens for repeats, `discogs.ts:89,276`) must now be true across sessions: a persisted hit spends no limiter token.
- Tests must prove: round-trip across a simulated restart (new store instance reads what the old wrote); cap eviction order; corrupt file → empty; debounce coalesces writes (fake timers).

**Verification:** `npx vitest run src/main`; `npx tsc --build`; biome on changed files.

**Commit message:** `Persist Discogs and Bandcamp lookup caches across sessions`

---

### Task 4a: Lazy locale loading

**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/index.ts`
- Test: follow existing i18n test patterns if any; otherwise a renderer test asserting the active + fallback bundles resolve and a non-active locale is not in the initial resources.

**Requirements:**
- English (fallback) stays eagerly imported. The other four locales load via dynamic `import('./locales/<lng>.json')` only when they become the active language (initial detection or a language switch), added with `i18n.addResourceBundle` before `changeLanguage` resolves.
- No flash of translation keys: the language switch awaits the bundle before applying; initial load with a non-English language may briefly render English (same as a cold i18next fallback today) — acceptable, but keys must never render raw.
- Vite must code-split the JSONs (verify via `npx vite build` output listing separate chunks — cite the chunk names in the report).

**Verification:** i18n tests + full renderer suite (`npx vitest run src/renderer`); `npx tsc --build`; biome.

**Commit message:** `Load only the active locale bundle at startup`

---

### Task 4b: Lazy Editor boundary

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (Editor import → `React.lazy`, wrap the render site in `Suspense`)

**Requirements:**
- The Suspense fallback must preserve today's visuals: while the chunk loads, show the same empty-state pane the app shows with no selection (or nothing, if the empty pane's markup lives outside the boundary) — never a spinner flash on every selection. The chunk loads once; subsequent selections must not re-suspend.
- If other heavyweight editor-only children are imported by App directly (DiscogsPanel, sections) confirm they're only reachable through Editor's module graph so the split actually moves them out of the entry chunk; verify with `npx vite build` (entry chunk shrinks, editor chunk appears) and cite numbers in the report.
- Existing App/Editor tests must keep passing unmodified except where they need `await`/`findBy` for the lazy mount — do not weaken assertions.

**Verification:** `npx vitest run src/renderer`; `npx tsc --build`; biome; `npx vite build` chunk evidence.

**Commit message:** `Split the editor into its own lazy chunk`

---

### Task 4c: Settings snapshot for first paint

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useSettings.ts`
- Test: extend the hook's existing test file (or create one following the hooks-test pattern)

**Requirements:**
- Mirror the last-known merged settings into `localStorage` (single key, e.g. `settings-snapshot`) every time settings load or change. On mount, seed the hook's initial state from that snapshot synchronously (parse guarded — corrupt/missing → today's `null` start). The async `getSettings()` IPC still runs and overwrites.
- Main remains the source of truth; the snapshot is a paint-only seed. Do NOT move any key's ownership between stores (LOCAL_KEYS semantics untouched).
- Guard against a snapshot from an older app version carrying unknown/missing fields: merge over the same defaults the hook already applies to IPC results, so a stale snapshot can never crash the first render.
- Tests must prove: with a snapshot present, first render exposes snapshot values (no `null` phase); IPC result overwrites the seed; corrupt snapshot → behaves like today.

**Verification:** `npx vitest run src/renderer/src/hooks`; `npx tsc --build`; biome.

**Commit message:** `Seed first paint from a local settings snapshot`

---

### Task 5a: Memoize the Engine DJ dump per m.db mtime

**Files:**
- Modify: `apps/desktop/src/main/engineLibrary.ts` (`dumpEngineLibrary`, ~line 31)
- Test: extend `apps/desktop/src/main/engineLibrary.test.ts` if it exists; otherwise create it following the main-process test patterns

**Requirements:**
- Before reading, `stat` the `m.db`; if mtimeMs (+ path) equals the last successful dump's, return the retained result without readFile/sql.js parse. Module-level memory (one entry), not disk. A changed mtime or a different library dir re-reads. Engine writes by Surco itself (`writeBatch`) change the file → natural invalidation; failed reads are not memoized.
- Tests: same-mtime second call does not re-read (spy on fs); mtime bump re-reads; different dir re-reads.

**Verification:** `npx vitest run src/main`; `npx tsc --build`; biome.

**Commit message:** `Skip re-parsing an unchanged Engine DJ database`

---

### Task 5b: Reuse the processed cover across Apple Music adds

**Files:**
- Investigate first: `apps/desktop/src/main/cover.ts` (`prepareProcessedCover`, `hasCoverSource`), call sites in `appleMusicIpc.ts:77,109` and the conversion tail in `index.ts`/process pipeline.
- Modify: whichever layer lets N adds sharing one identical cover source + identical cover settings run the ffmpeg encode once (an in-memory keyed memo of the processed file with lifecycle-safe cleanup, or a `cachedAnalysis`-style disk cache when the source is a stable file path — choose based on what the source shapes actually are and justify in the report).
- Test: prove one encode for N same-cover jobs and correct isolation for different sources/settings; prove cleanup still happens (no temp leak) via the existing cleanup contract.

**Requirements:**
- The cleanup contract today: each caller gets `prepared.cleanup()` and calls it in `finally`. Any reuse must keep every caller's `finally` safe (refcount, copy-per-caller, or content-addressed cache directory with its own sweep — pick the simplest that cannot delete a file another in-flight job still needs).
- If after investigation a safe reuse cannot be had without redesigning the cleanup lifecycle, STOP and report BLOCKED with what you found — do not force it.

**Verification:** `npx vitest run src/main`; `npx tsc --build`; biome.

**Commit message:** `Encode each distinct cover once per Apple Music batch`

---

### Task 6: Final whole-suite verification (no commit)

Run from `apps/desktop/`: `npx vitest run` (full), `npx tsc --build`, biome over every file the branch changed. Expected: all green.
