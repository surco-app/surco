# Apple Music library snapshot cache — design

Date: 2026-07-23
Status: approved (conversation 2026-07-23)

## Problem

The "in Apple Music" verdicts (sidebar filter buckets and the editor badge) both
read one in-memory index built from a full-library AppleScript dump
(`dumpAppleMusicLibrary`). The dump runs once per session and can take seconds on
a large library; until it lands, `libraryIndex` is `null`, so the filter buckets
stay hidden and the editor badge shows nothing. Every session pays this cold
start even though the library rarely changes between sessions.

## Goal

On startup, serve the previous session's snapshot immediately so verdicts appear
at once, while the fresh dump runs in the background and replaces the snapshot
when it resolves. Verdicts may be seconds-stale at startup; they self-correct.

## Scope

- Apple Music only. The Engine DJ dump is a local SQLite read (`m.db`), already
  fast — no cache.
- No change to matching logic (`isInLibrary`), the index shape, refocus refresh
  (5 min), or any UI component.

## Design (approved: Option A — main-process cache + `placeholderData`)

### Main process

- After each successful `dumpAppleMusicLibrary()`, write the parsed
  `AppleMusicLookupCandidate[]` as JSON to
  `app.getPath('userData')/apple-music-library.json` (same persistence pattern
  as `session.ts`). A failed write must not fail the dump.
- New IPC `applemusic:libraryCached`: reads that file and returns the
  candidates, or `null` when the file is missing, unreadable, or not an array.
  Never spawns osascript. macOS-only like the other Apple Music handlers
  (returns `null` elsewhere).
- Preload: expose `loadAppleMusicLibraryCached()`.

### Renderer (`useLibraryMembership`)

- A second cheap query (`['library-membership-cached', source]`, enabled only
  for `source === 'appleMusic'`) loads the cached snapshot.
- The main query passes that result as `placeholderData`. React Query then:
  - builds the index from the cached snapshot instantly (`select` applies to
    placeholder data),
  - replaces it wholesale when the fresh dump resolves,
  - keeps the existing refocus invalidation untouched.
- Fallback if `placeholderData` misbehaves with `select` in the installed
  TanStack Query version: seed via `initialData` +
  `initialDataUpdatedAt: 0` (marks the seed stale, forcing an immediate
  background refetch — same observable behavior).

### Data flow

```
session N:   dump ──▶ candidates ──▶ index          └─▶ userData/apple-music-library.json
session N+1: cached file ──▶ placeholder index (instant)
             dump (background) ──▶ fresh index replaces it
```

## Error handling

- Missing/corrupt cache file → `null` → behaves exactly like today (no
  placeholder, wait for dump).
- Cache write failure → logged nowhere special, dump result still returned;
  next successful dump retries the write.
- No expiry/TTL: staleness is bounded by the fresh dump that always follows.

## Testing

- Main: cache write after dump, cached read happy path, missing file → null,
  corrupt JSON → null, non-array JSON → null, write failure doesn't break the
  dump. Follow `session.test.ts` patterns (temp `userData`).
- Renderer: `useLibraryMembership` returns an index built from the cached
  snapshot before the dump resolves, then the fresh index after; Engine DJ
  source never touches the cached query.

## Success criteria

- With a populated cache file, verdicts (filter buckets + editor badge) are
  available on first render after tracks load, without waiting for osascript.
- Fresh dump still runs and its result replaces the placeholder.
- All existing tests keep passing.
