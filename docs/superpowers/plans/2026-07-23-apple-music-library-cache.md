# Apple Music Library Snapshot Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the previous session's Apple Music library snapshot from disk instantly on startup while the fresh AppleScript dump runs in the background.

**Architecture:** The main process persists each successful `dumpAppleMusicLibrary()` result to `userData/apple-music-library.json` and exposes a read-only `applemusic:libraryCached` IPC. The renderer's `useLibraryMembership` loads that snapshot through a cheap secondary query and feeds it to the main query as `placeholderData`, so `buildLibraryIndex` produces an instant index that React Query replaces wholesale when the fresh dump resolves.

**Tech Stack:** Electron (main IPC + preload bridge), TanStack Query v5, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-apple-music-library-cache-design.md`

## Global Constraints

- Apple Music only — the Engine DJ SQLite read stays uncached.
- No change to `isInLibrary`, `buildLibraryIndex`, the refocus refresh (5 min), or any UI component.
- Missing/corrupt/non-array cache file → `null` → identical behavior to today.
- A failed cache write must never fail the dump.
- Repo conventions: comments follow the codebase's explanatory style (the codebase is densely commented; conformance beats the global zero-comment rule — flagged in the conversation), commit titles are descriptive with no prefix and no body, work stays in worktree `apple-music-library-cache`.
- Run tests from `apps/desktop/` with `npx vitest run <file>`; never `npm run check` (it reformats ~92 unrelated files) — use `npx biome check <changed files>` per file.

---

### Task 1: Main-process cache module

**Files:**
- Create: `apps/desktop/src/main/appleMusicLibraryCache.ts`
- Test: `apps/desktop/src/main/appleMusicLibraryCache.test.ts`

**Interfaces:**
- Consumes: `AppleMusicLookupCandidate` from `../shared/types` (fields: `artist: string`, `title: string`, `durationSec?: number`, `persistentId?: string`), `app.getPath('userData')` from electron.
- Produces: `saveLibraryCache(candidates: AppleMusicLookupCandidate[]): void` and `loadLibraryCache(): AppleMusicLookupCandidate[] | null` — Task 2 imports both.

- [ ] **Step 1: Write the failing tests**

Model the electron mock on `src/main/session.test.ts` (temp `userData` dir):

```ts
import { afterAll, describe, expect, it, vi } from 'vitest'

// appleMusicLibraryCache.ts persists to app.getPath('userData')/apple-music-library.json;
// point Electron at a throwaway temp dir and exercise the real save/load round-trip.
vi.mock('electron', () => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'surco-amcache-'))
  return { app: { getPath: () => dir } }
})

import { mkdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicLookupCandidate } from '../shared/types'
import { loadLibraryCache, saveLibraryCache } from './appleMusicLibraryCache'

afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }))

const cacheFile = (): string => join(app.getPath('userData'), 'apple-music-library.json')

describe('appleMusicLibraryCache', () => {
  // First launch ever: no snapshot on disk means "no placeholder", never an empty
  // library that would flag the whole crate as not-owned.
  it('returns null when no snapshot was ever saved', () => {
    expect(loadLibraryCache()).toBeNull()
  })

  // The whole point: what the dump produced this session comes back next session,
  // optional fields included, so the placeholder index matches like the real one.
  it('round-trips a snapshot with optional fields intact', () => {
    const lib: AppleMusicLookupCandidate[] = [
      { title: 'Strobe', artist: 'deadmau5', durationSec: 634, persistentId: 'ABCDEF0123456789' },
      { title: 'One', artist: 'A' },
    ]
    saveLibraryCache(lib)
    expect(loadLibraryCache()).toEqual(lib)
  })

  // The file lives on disk between sessions; a truncated write or a hand edit must
  // degrade to "no cache", not poison the index with garbage.
  it('returns null on corrupt JSON', () => {
    writeFileSync(cacheFile(), '{"not an arr')
    expect(loadLibraryCache()).toBeNull()
  })

  it('returns null when the JSON is not an array', () => {
    writeFileSync(cacheFile(), '{"tracks": []}')
    expect(loadLibraryCache()).toBeNull()
  })

  // A malformed row is dropped rather than dropping the whole snapshot: one bad hand
  // edit should not cost the other thousands of rows their instant verdicts.
  it('drops malformed rows and mistyped optional fields, keeps the rest', () => {
    writeFileSync(
      cacheFile(),
      JSON.stringify([
        { title: 'Good', artist: 'Artist' },
        { title: '', artist: 'NoTitle' },
        { artist: 'MissingTitle' },
        'not an object',
        null,
        { title: 'Odd Fields', artist: 'B', durationSec: 'long', persistentId: 42 },
      ]),
    )
    expect(loadLibraryCache()).toEqual([
      { title: 'Good', artist: 'Artist' },
      { title: 'Odd Fields', artist: 'B' },
    ])
  })

  // The cache is an optimization: if the disk write fails the dump result must still
  // reach the renderer, so save swallows the failure instead of throwing.
  it('does not throw when the write fails', () => {
    mkdirSync(cacheFile())
    expect(() => saveLibraryCache([{ title: 'X', artist: 'Y' }])).not.toThrow()
    rmdirSync(cacheFile())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/appleMusicLibraryCache.test.ts`
Expected: FAIL — cannot resolve `./appleMusicLibraryCache`.

- [ ] **Step 3: Write the implementation**

```ts
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicLookupCandidate } from '../shared/types'

// The previous session's Apple Music library dump, persisted so the next launch can
// flag "already owned" instantly instead of waiting seconds for osascript to walk the
// whole library. Always machine-local (userData): it mirrors this machine's Music
// library, meaningless on another. The fresh dump that always follows replaces it, so
// staleness is bounded to the dump's own latency.
function cachePath(): string {
  return join(app.getPath('userData'), 'apple-music-library.json')
}

// The file sits on disk between sessions, so a truncated write or hand edit is
// possible; a row that isn't the expected shape is dropped rather than costing the
// whole snapshot, and mistyped optional fields degrade to a plainer candidate.
function sanitizeCandidate(raw: unknown): AppleMusicLookupCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { title, artist, durationSec, persistentId } = raw as AppleMusicLookupCandidate
  if (typeof title !== 'string' || !title || typeof artist !== 'string' || !artist) return null
  const candidate: AppleMusicLookupCandidate = { title, artist }
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
    candidate.durationSec = durationSec
  }
  if (typeof persistentId === 'string' && persistentId) candidate.persistentId = persistentId
  return candidate
}

// Write-then-rename so a crash mid-write leaves the previous snapshot, never a
// truncated file. The cache is an optimization: a failed write must not fail the
// dump whose result it was persisting, so failures are swallowed.
export function saveLibraryCache(candidates: AppleMusicLookupCandidate[]): void {
  try {
    const tmp = `${cachePath()}.tmp`
    writeFileSync(tmp, JSON.stringify(candidates))
    renameSync(tmp, cachePath())
  } catch {
    return
  }
}

// Null — not [] — when there is no usable snapshot: an empty array would flag the
// whole crate as not-owned, null means "no placeholder, wait for the dump".
export function loadLibraryCache(): AppleMusicLookupCandidate[] | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(cachePath(), 'utf-8'))
    if (!Array.isArray(raw)) return null
    const candidates: AppleMusicLookupCandidate[] = []
    for (const entry of raw) {
      const candidate = sanitizeCandidate(entry)
      if (candidate) candidates.push(candidate)
    }
    return candidates
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/appleMusicLibraryCache.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Lint and commit**

```bash
cd apps/desktop && npx biome check src/main/appleMusicLibraryCache.ts src/main/appleMusicLibraryCache.test.ts
cd <worktree-root> && git add apps/desktop/src/main/appleMusicLibraryCache.ts apps/desktop/src/main/appleMusicLibraryCache.test.ts
git commit -m "Persist the Apple Music library snapshot to disk"
```

---

### Task 2: IPC handler + preload bridge

**Files:**
- Modify: `apps/desktop/src/main/appleMusicIpc.ts:27-39` (wrap the dump, add the cached handler)
- Modify: `apps/desktop/src/preload/index.ts:76-77` (add `loadAppleMusicLibraryCached` next to `loadAppleMusicLibrary`)
- Modify: `apps/desktop/src/preload/api.ts:78` (add the type next to `loadAppleMusicLibrary`)

**Interfaces:**
- Consumes: `saveLibraryCache` / `loadLibraryCache` from Task 1.
- Produces: IPC `applemusic:libraryCached` → `AppleMusicLookupCandidate[] | null`; `window.api.loadAppleMusicLibraryCached(): Promise<AppleMusicLookupCandidate[] | null>` — Task 3 calls it.

No test file: the IPC registration layer has no tests in this codebase (needs live `ipcMain`); the cache behavior is covered by Task 1's tests and the renderer behavior by Task 3's. Verification here is `tsc --build` plus the full suite staying green.

- [ ] **Step 1: Wire the cache into `appleMusicIpc.ts`**

Add to the imports from `'./appleMusicLibraryCache'`:

```ts
import { loadLibraryCache, saveLibraryCache } from './appleMusicLibraryCache'
```

Replace the `applemusic:library` handler body (lines 30-38) so the dump persists its result, and register the cached read below it:

```ts
  // The whole-library snapshot the renderer matches the crate against to flag which
  // tracks are already owned; empty off macOS, where there is no library to read.
  // Each successful dump is persisted so the next session can seed its index from
  // disk while this (seconds-long on a big library) dump re-runs.
  ipcMain.handle('applemusic:library', () =>
    process.platform === 'darwin'
      ? activity.track(
          'applemusic',
          'activity.appleMusicLibrary',
          async () => {
            const lib = await dumpAppleMusicLibrary()
            saveLibraryCache(lib)
            return lib
          },
          {
            summary: (lib) => ({
              detailKey: 'activity.trackCount',
              detailParams: { count: lib.length },
            }),
          },
        )
      : [],
  )

  // The previous session's persisted snapshot — a plain file read, no osascript, no
  // activity row. Null (no cache yet) tells the renderer to just wait for the dump.
  ipcMain.handle('applemusic:libraryCached', () =>
    process.platform === 'darwin' ? loadLibraryCache() : null,
  )
```

- [ ] **Step 2: Expose it in the preload bridge**

`src/preload/index.ts`, right after `loadAppleMusicLibrary` (line 76-77):

```ts
  loadAppleMusicLibraryCached: (): Promise<AppleMusicLookupCandidate[] | null> =>
    ipcRenderer.invoke('applemusic:libraryCached'),
```

`src/preload/api.ts`, right after the `loadAppleMusicLibrary` declaration (line 78):

```ts
  // The previous session's Apple Music snapshot read straight from disk — no
  // osascript — to seed the membership index while the fresh dump runs. Null when
  // no snapshot exists yet (first run, or the file was unreadable).
  loadAppleMusicLibraryCached: () => Promise<AppleMusicLookupCandidate[] | null>
```

- [ ] **Step 3: Type-check and run the affected suites**

Run: `cd apps/desktop && npx tsc --build && npx vitest run src/main/appleMusicLibraryCache.test.ts src/main/applemusic.test.ts`
Expected: clean build, all tests pass.

- [ ] **Step 4: Lint and commit**

```bash
cd apps/desktop && npx biome check src/main/appleMusicIpc.ts src/preload/index.ts src/preload/api.ts
git add apps/desktop/src/main/appleMusicIpc.ts apps/desktop/src/preload/index.ts apps/desktop/src/preload/api.ts
git commit -m "Expose the persisted Apple Music snapshot over IPC"
```

---

### Task 3: Seed `useLibraryMembership` from the disk snapshot

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/useLibraryMembership.ts`
- Test: `apps/desktop/src/renderer/src/hooks/useLibraryMembership.test.tsx`

**Interfaces:**
- Consumes: `window.api.loadAppleMusicLibraryCached(): Promise<AppleMusicLookupCandidate[] | null>` from Task 2; existing `buildLibraryIndex`, `isInLibrary` from `../lib/appleMusicLibrary`.
- Produces: unchanged hook signature `useLibraryMembership(trackCount, source): AppleMusicIndex | null` — no caller changes.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe` in `useLibraryMembership.test.tsx` (add `isInLibrary` and the index/candidate types to the imports):

```tsx
import type { AppleMusicIndex } from '../lib/appleMusicLibrary'
import { isInLibrary } from '../lib/appleMusicLibrary'
```

```tsx
  // The dump takes seconds on a big library and used to leave every verdict blank
  // until it landed. The previous session's snapshot answers instantly, and the
  // fresh dump replaces it wholesale — including rows that left the library.
  it('serves the previous session snapshot until the fresh dump lands', async () => {
    let resolveDump: (lib: unknown) => void = () => {}
    const dump = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveDump = resolve
      }),
    )
    const cached = vi.fn().mockResolvedValue([{ title: 'Old Song', artist: 'Old Artist' }])
    setApi({
      loadAppleMusicLibrary: dump,
      loadAppleMusicLibraryCached: cached,
      onWindowFocus: () => () => {},
    })
    const { result } = renderHook(() => useLibraryMembership(3, 'appleMusic'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(
      isInLibrary(result.current as AppleMusicIndex, { title: 'Old Song', artist: 'Old Artist' }),
    ).toBe(true)

    resolveDump([{ title: 'New Song', artist: 'New Artist' }])
    await waitFor(() =>
      expect(
        isInLibrary(result.current as AppleMusicIndex, {
          title: 'New Song',
          artist: 'New Artist',
        }),
      ).toBe(true),
    )
    expect(
      isInLibrary(result.current as AppleMusicIndex, { title: 'Old Song', artist: 'Old Artist' }),
    ).toBe(false)
  })

  // First run (or unreadable file): null from disk means no placeholder — verdicts
  // stay blank until the dump lands, exactly the pre-cache behavior.
  it('waits for the dump when no snapshot exists', async () => {
    let resolveDump: (lib: unknown) => void = () => {}
    const dump = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveDump = resolve
      }),
    )
    const cached = vi.fn().mockResolvedValue(null)
    setApi({
      loadAppleMusicLibrary: dump,
      loadAppleMusicLibraryCached: cached,
      onWindowFocus: () => () => {},
    })
    const { result } = renderHook(() => useLibraryMembership(3, 'appleMusic'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(cached).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()
    resolveDump([{ title: 'One', artist: 'A' }])
    await waitFor(() => expect(result.current).not.toBeNull())
  })

  // The Engine DJ read is a local SQLite file — already instant, so it earns no disk
  // cache; the Apple-only loader must never fire for it.
  it('never reads the disk snapshot for the Engine DJ source', async () => {
    const cached = vi.fn().mockResolvedValue(null)
    const engine = vi.fn().mockResolvedValue([{ title: 'One', artist: 'A' }])
    setApi({
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([]),
      loadAppleMusicLibraryCached: cached,
      loadEngineLibrary: engine,
      onWindowFocus: () => () => {},
    })
    renderHook(() => useLibraryMembership(3, 'engineDj'), { wrapper: wrapper() })
    await waitFor(() => expect(engine).toHaveBeenCalledTimes(1))
    expect(cached).not.toHaveBeenCalled()
  })
```

Also extend the FIRST existing test's `setApi` (`refreshes the snapshot on refocus…`) with `loadAppleMusicLibraryCached: vi.fn().mockResolvedValue(null),` — its source is `'appleMusic'`, so the new secondary query fires and must not hit an undefined API.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd apps/desktop && npx vitest run src/renderer/src/hooks/useLibraryMembership.test.tsx`
Expected: the three new tests FAIL (`loadAppleMusicLibraryCached` never called / snapshot not served); the three existing ones PASS.

- [ ] **Step 3: Implement the placeholder seed**

In `useLibraryMembership.ts`, extend the hook (module comment gains the disk-seed sentence; signature unchanged):

```ts
export function useLibraryMembership(
  trackCount: number,
  source: LibrarySource,
): AppleMusicIndex | null {
  const queryClient = useQueryClient()
  const queryKey = ['library-membership', source]
  // The previous session's persisted dump, read from disk in one IPC — Apple Music
  // only, because the seconds-long osascript dump is what it exists to hide (the
  // Engine read is a local SQLite file, already instant). Null (no snapshot yet)
  // simply leaves the main query placeholder-less.
  const { data: cachedSnapshot } = useQuery({
    queryKey: ['library-membership-cached', source],
    queryFn: () => window.api.loadAppleMusicLibraryCached(),
    enabled: source === 'appleMusic' && trackCount > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      source === 'engineDj' ? window.api.loadEngineLibrary() : window.api.loadAppleMusicLibrary(),
    enabled: source !== null && trackCount > 0,
    staleTime: Number.POSITIVE_INFINITY,
    select: buildLibraryIndex,
    // Stale-while-revalidate across sessions: the disk snapshot stands in until the
    // fresh dump resolves and replaces it — verdicts appear at once instead of after
    // seconds of blank filter buckets.
    placeholderData: cachedSnapshot ?? undefined,
  })
  useWindowFocus((focused) => {
    if (!focused || source === null) return
    const state = queryClient.getQueryState(queryKey)
    if (state?.data && Date.now() - state.dataUpdatedAt > REFRESH_AFTER_MS) {
      void queryClient.invalidateQueries({ queryKey })
    }
  })
  return data ?? null
}
```

Known risk (spec fallback): if `select` is not applied to `placeholderData` in TanStack Query 5.101 the first test fails on the placeholder assertion — then drop `placeholderData` and seed via `initialData: cachedSnapshot ?? undefined` + `initialDataUpdatedAt: 0` on the main query instead (marks the seed stale so the dump still fires immediately).

- [ ] **Step 4: Run the hook tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/renderer/src/hooks/useLibraryMembership.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Lint and commit**

```bash
cd apps/desktop && npx biome check src/renderer/src/hooks/useLibraryMembership.ts src/renderer/src/hooks/useLibraryMembership.test.tsx
git add apps/desktop/src/renderer/src/hooks/useLibraryMembership.ts apps/desktop/src/renderer/src/hooks/useLibraryMembership.test.tsx
git commit -m "Seed the library membership index from the previous session snapshot"
```

---

### Task 4: Full verification

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `cd apps/desktop && npx vitest run`
Expected: all pass (baseline was 3095 tests / 259 files; now +9).

- [ ] **Step 2: Type-check the whole app**

Run: `cd apps/desktop && npx tsc --build`
Expected: exit 0, no output.

- [ ] **Step 3: Lint every changed file once more**

Run: `cd apps/desktop && npx biome check src/main/appleMusicLibraryCache.ts src/main/appleMusicLibraryCache.test.ts src/main/appleMusicIpc.ts src/preload/index.ts src/preload/api.ts src/renderer/src/hooks/useLibraryMembership.ts src/renderer/src/hooks/useLibraryMembership.test.tsx`
Expected: no diagnostics.

No commit — this task only verifies.
