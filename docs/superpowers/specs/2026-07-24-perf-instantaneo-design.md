# Perf "instantáneo" — design

Date: 2026-07-24
Status: approved (user directive: implement all five areas, separate commits, no questions)

## Goal

No new features. Make Surco feel instant everywhere by serving previously
computed results from cache instead of recomputing, and by trimming startup
work. Same philosophy as the Apple Music library snapshot cache: stale data
shown instantly, fresh data replaces it (or, where results are pure functions
of file bytes, cache keyed on path+mtime with no staleness at all).

## Areas (one commit each; independent)

### 1. `readMeta` disk cache (biggest win)

Every import AND every session reopen runs, per file: one ffprobe, sometimes a
sync TagLib read, one ffmpeg cover-thumbnail extract, one ffmpeg ffmetadata
pass (`ffmpeg.ts:405-446`) — none cached. Wrap the result in the existing
`cachedAnalysis` primitive (`analysisCache.ts:35`, path+mtime key). The whole
`readMeta` result (tags, duration, cover thumbnail data URL, foreign tags,
grouping, cover dims) is a pure function of the file bytes, so path+mtime is a
correct key; Surco's own tag writes bump mtime and self-invalidate. Cache only
successful reads. Result must remain JSON-serializable.

### 2. Batch hydration of cached analyses

Cold start shows blank quality/attention dots and empty Suspect/Good/Silence
counts until each track's probes resolve one lazy IPC at a time — even though
the payloads sit in the disk cache. Add one batch IPC: given the loaded paths,
return every already-cached analysis payload (spectrogram, loudness,
waveform-scan, clicks, properties, bpm, key) without computing anything on a
miss. Renderer seeds React Query (`setQueryData([name, path], payload)`) so
`tracksSnapshot`/`useTracksView` light up immediately. Namespace strings and
cache-key derivation must be shared constants between the live handlers
(`audioIpc.ts`) and the batch read — no string drift.

### 3. Persist Discogs/Bandcamp lookup caches

`searchCache`/`releaseCache` are in-memory Maps (`discogs.ts:62,274`,
`bandcamp.ts:54,207`); every relaunch re-spends rate-limit tokens (60/min) and
network latency on identical queries. Persist both providers' search+release
caches to userData JSON, entry-capped (order-of-hundreds per kind, oldest
dropped), loaded on startup, saved debounced and on quit. Corrupt/missing file
→ empty cache. Keys already exist (`searchKey`, release id/URL).

### 4. Startup trims

- 4a. Locales: all 5 JSONs (~276 KB) are parsed eagerly (`i18n/index.ts:4-8`);
  load only English (fallback) eagerly and the active language on demand;
  switching language lazy-loads its bundle.
- 4b. Editor subtree (Editor + DiscogsPanel + sections) is imported eagerly in
  `App.tsx` though first paint is the empty pane; put it behind `React.lazy`
  with a Suspense fallback that preserves today's visuals.
- 4c. Settings arrive by async IPC (`useSettings.ts:43-53`) so first frames
  paint fallback defaults (theme/width flash). Mirror the last-known settings
  snapshot in `localStorage` and seed the hook's initial state from it; main
  stays the source of truth and the async load still overwrites. No change to
  which store owns any key.

### 5. Minor caches

- 5a. Engine DJ dump: memoize `dumpEngineLibrary` per `m.db` mtime (module
  memory, not disk) so the 5-min refocus refresh skips the full sql.js
  readFile+parse when the DB is unchanged.
- 5b. Apple Music add/update cover prep: adding N tracks that share one cover
  re-runs `prepareProcessedCover` (an ffmpeg encode) N times
  (`appleMusicIpc.ts:77,109`, also the conversion tail). Reuse the processed
  result for identical (cover source, cover settings) so a batch add encodes
  each distinct cover once. If the cleanup lifecycle makes safe reuse
  impractical, stop and report rather than force it.
  Verified scope: the manual Apple Music add path is strictly per-track — the
  palette/menu command operates on the single selected track, and no bulk-add
  gesture exists — so the batch memo is wired only into the conversion
  pipeline (`process:track`), the only path where N same-cover adds actually
  occur. `appleMusicIpc.ts`'s per-track handlers intentionally keep calling
  `prepareProcessedCover` directly.

## Non-goals

Virtualizing the list, changing analysis algorithms, auto-restoring the
session without the toast, persisting the rendered track list wholesale,
touching the player transcode path.

## Global constraints

- Behavior-identical output everywhere: caches only skip recomputation, never
  change results. First run (cold caches) behaves exactly like today.
- Corrupt/missing cache artifacts degrade to live compute, never to errors.
- TDD per task; suite, `tsc --build`, per-file biome green after each task.
- Comments in the codebase's explanatory style; commit titles descriptive, no
  prefix, no body. One area per commit (4a/4b/4c/5a/5b are separate commits).

## Success criteria

- Reopening an unchanged crate populates rows (tags/covers) without spawning
  ffprobe/ffmpeg per file (verified by tests on the cache layer).
- Quality dots/filter counts appear from cached data in one batch on load.
- A Discogs search repeated after relaunch hits disk, spending no limiter token.
- Startup parses one locale bundle, not five; Editor chunk loads on first
  selection; no default-settings flash when a snapshot exists.
- Engine refocus with unchanged m.db does no readFile+parse; batch add with one
  shared cover runs one cover encode.
