# Playlist al instante Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a rekordbox playlist in Surco paints every row complete (title, artist, duration, cover, waveform and cues) from one read of `master.db`, while the files are read behind it without freezing the app; every list uses the same row, variant B of "Filas con onda".

**Architecture:** The `rekordbox:playlist` read grows a `preview` per entry (title, artist, length, cover file, analysis file, cues) in the same open of `master.db`. The renderer seeds each new row with that preview (`TrackItem.sourcePreview`, never in `meta` or the signatures), adds the rows before the disk check, and reads the files through one shared priority queue (visible and selected rows first). The read itself moves TagLib to the worker and, for rows with a preview, skips the ffmpeg thumbnail and `ffmetadata` until the row is selected or converted. Auto-match waits until the reads are done. The row gets a second line, a mini waveform (rekordbox `PWAV`, or Surco's cached wave) with hot cues as lettered squares and memory cues as triangles, replacing the cue swatches.

**Tech Stack:** Electron + React 19 + TS, TanStack Query, Tailwind v4, vitest + Testing Library (jsdom), `better-sqlite3-multiple-ciphers` (SQLCipher), node-taglib-sharp, biome.

**Spec:** `docs/superpowers/specs/2026-10-19-playlist-al-instante-design.md`

**Depends on:** the rest of branch `worktree-fuentes-dj-playlists` (plans A and B of "Llevar a rekordbox", the dots removal and the shared read cap, commits up to `66a4f3c8`).

**Out of scope:** the CDJ history on the USB, Apple Music playlists getting previews, how a folder drop reads its tags (it only gains the priority queue and TagLib in the worker), computing a wave for a row that has none.

## Global Constraints

- Paths below are relative to `apps/desktop/` unless they start with `docs/`. The worktree is `/Users/vicent/code/surco/.claude/worktrees/fuentes-dj-playlists`; call it `$WT`.
- Tests: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop <paths relative to apps/desktop>`. Full suite: add `--reporter=dot --silent > <scratch log>` and read the tail, ffmpeg output floods the terminal.
- Types: `npm --prefix $WT/apps/desktop exec -- tsc -p $WT/apps/desktop/tsconfig.web.json --noEmit` and the same with `tsconfig.node.json`. A bare `tsc --noEmit` checks nothing.
- Lint: `npm --prefix $WT/apps/desktop exec -- biome check --write --config-path=$WT/apps/desktop <paths>`.
- The worktree guard rejects heredocs, `cd … &&` chains and shell loops: write files with the Write tool, edit with Edit. `grep` in this shell is ugrep and misses matches in some `.ts` files; search with `rg` or the Grep tool.
- Never open `~/Library/Pioneer` from a test, script or tool. Tests build their own `master.db` with `writeRekordboxPlaylistFixture`. `master.db` is opened only through `withCollection` (read-only, closed after the read).
- Zero comments in new code (biome directives included: write code that needs none). Existing comments stay as they are; a comment your change makes false is updated, not deleted.
- `data-testid` first in selectors. `window.api` mocks are typed: `vi.fn<Api['name']>()`.
- No user-facing string with an em dash or an explanatory colon. Every key exists in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`).
- One functionality per commit, title only, no prefix (`feat:` etc.), no `--no-verify`, never bare `git stash`.
- **The preview is never metadata.** `sourcePreview` stays out of `meta`, `trackSignature`, `diskSignature`, `processedSignature` and the session store. A row opened from rekordbox and never touched never reads as modified.
- **Colours are Surco's** (spec decision 4): the wave `var(--color-accent)` at 70 % opacity, hot cue squares `bg-[var(--color-accent)] text-[var(--color-on-accent)]`, memory cue triangles `var(--color-warn)`. No rekordbox hex values.
- **Row B** (sketch `Debajo.dc.html`): 48 px cover; line 1 is `title · artist` (artist dimmed), then marks, duration, format; line 2 is the wave, 28 px tall, full width of the text column. Row about 68 px.
- **Hot cue letters** follow `HOT_KINDS` in `src/shared/cueRules.ts` (`[1, 2, 3, 5, 6, 7, 8, 9]` → `A..H`); `Kind` 0 is a memory cue.
- `READ_CONCURRENCY` stays 6.

## Decisions taken where the spec left room

1. **The separator check stays its own query.** `rekordbox:hasSeparator` is keyed per collection (`['source-separator']`, `staleTime: Infinity`), so it is not read per opening; folding it into the playlist read would change the shape of `loadRekordboxPlaylist` under 39 test mocks for no measured gain. The membership read stays in the editor (one selected track). Per opening there is one read of `master.db`; `rekordbox:cueSummary` goes away. Cost if wrong: one 80 ms open the first time a rekordbox playlist is opened in a session.
2. **Waves are fetched for the rows on screen, in batches.** A row asks for its wave when it mounts; asks within 16 ms share one IPC. Measured 98 ms for all 1001 `.DAT` of All, so a batch of visible rows is a few ms. Waves are cached in memory for the session, keyed by the analysis file (or the audio path for Surco's wave). A track re-analysed in rekordbox keeps its old wave until Surco restarts.
3. **The row keeps rekordbox's cover after the light read.** The light read skips the thumbnail, so a row with a preview shows `artwork_m.jpg` until it is selected; selecting it completes the read and the file's own art, when it has one, takes over.
4. **Selecting completes the read for every selected row**, multi-selection included, so "clear metadata" and the foreign-tag inspector never act on a row whose foreign tags were not read. A conversion of a row still partial completes it first and refuses it if that read fails, with the same `errors.sourceTagsUnread` a failed read gets today.
5. **A file rekordbox lists but the disk lacks** gets a row at once and loses it when the background disk check answers; the "N missing" toast is unchanged. A read still queued for it is skipped, and a read that already failed is not counted in the "could not read" notice, which counts failed rows still in the list.
6. **Rows already in the list get their preview refreshed on every re-read** of a rekordbox playlist (opening, focus, after an edit or after queued cues land), so new cues show without reopening Surco.
7. **Pending cues** (saved in Surco, waiting for rekordbox) draw the row's hot cue squares hollow, as the swatches did.
8. **Auto-match waits for the whole read queue**, except the selected track, which still resolves at once.

## Review Focus

1. **A rekordbox entry whose file is gone.** The row appears, then goes when the disk check answers; the toast counts it; no "could not read" notice for it. Pinned in Task 2.
2. **A row converted or cleared while its read is still partial** (batch convert of a just-opened playlist). The read completes before any write; if it fails the row is refused, never written with an unknown cover or foreign tags. Pinned in Task 5.
3. **A collection whose `ImagePath` or `AnalysisDataPath` points outside `share`** (a crafted or corrupt row, `/../../etc/...`). No cover, no wave, no media grant for it. Pinned in Task 1 and Task 7.
4. **A track with `Length` 0 (not analysed) or a cue past the end.** No cue is drawn outside the wave, nothing is `NaN`. Pinned in Task 8.
5. **Re-reading a playlist after cues are saved or rekordbox edits it.** Loaded rows get the new preview and stay unmodified. Pinned in Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` (mod) | `RowCue`, `SourcePreview`, `RowWaveRequest`, `SourcePlaylistEntry.preview`; `CueSummary` removed |
| `src/main/rekordboxPlaylists.ts` (mod) | `readRekordboxPlaylistWithPreview`, `shareFile`, `coverFileOf` |
| `src/main/rekordboxPlaylistsFixture.ts` (mod) | `ArtistID`, `ImagePath` on fixture content |
| `src/main/rekordboxPlaylistsIpc.ts`, `src/main/index.ts` (mod) | the playlist handler reads the preview and grants media access |
| `src/shared/media.ts` (mod) | JPEG content type for covers served through `surco://media` |
| `src/renderer/src/types.ts` (mod) | `TrackItem.sourcePreview`, `TrackItem.metaPartial` |
| `src/renderer/src/lib/rowDisplay.ts` (new) | what a row shows: preview while reading, file after |
| `src/renderer/src/hooks/useTrackLibrary.ts` (mod) | seeds previews, rows before the disk check, priority reads, light reads, completing a read |
| `src/renderer/src/lib/concurrency.ts` (mod) | `createPriorityLimit` replaces `createConcurrencyLimit` |
| `src/main/tags.ts`, `src/main/workerJobs.ts`, `src/main/ffmpeg.ts` (mod) | TagLib read as one worker job; `readMetaLight` |
| `src/main/audioIpc.ts`, `src/main/analysisCache.ts` (mod) | `audio:metaLight`; `WAVEFORM_NAMESPACE` moves to the cache module |
| `src/renderer/src/hooks/useTrackProcessing.ts` (mod) | completes a partial row before writing |
| `src/renderer/src/hooks/useAutoMatch.ts` (mod) | `holdForReads` |
| `src/main/rowWavesIpc.ts` (new) | `list:rowWaves`: rekordbox `PWAV` or Surco's cached wave, reduced to 100 bars |
| `src/renderer/src/lib/rowWaves.ts` (new) | batched, cached wave requests for rows |
| `src/renderer/src/lib/rowCues.ts` (new) | hot cue letter |
| `src/renderer/src/components/RowWave.tsx` (new) | the row's wave line with cues |
| `src/renderer/src/components/TrackList.tsx`, `ListRow.tsx`, `App.tsx` (mod) | row B, wiring |
| `src/preload/index.ts`, `src/preload/api.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (mod) | new calls and stubs, `rekordboxCueSummary` removed |
| deleted | `components/CueSwatches.tsx`, `lib/cueSwatches.ts`, `hooks/useCueSummaries.ts` and their tests; `cueSummaries`/`hasGrid` in `main/rekordboxCues.ts`; `rekordbox:cueSummary` |
| `src/renderer/src/i18n/locales/*.json` (mod) | `trackList.cuesUnanalysed`, `cuesNone`, `cuesPendingNone` removed |

## Task list

### Task 1: The playlist read carries each row's preview

**Files:**
- Modify: `src/shared/types.ts` (after `SourcePlaylistEntry`)
- Modify: `src/main/rekordboxPlaylists.ts`
- Modify: `src/main/rekordboxPlaylistsFixture.ts`
- Modify: `src/main/rekordboxPlaylistsIpc.ts`, `src/main/index.ts:944-953`
- Modify: `src/shared/media.ts` (the `MIME` table)
- Test: `src/main/rekordboxPlaylists.test.ts`, `src/main/rekordboxPlaylistsIpc.test.ts`, `src/shared/media.test.ts`

**Interfaces:**
- Produces (shared types, used by Tasks 2, 7, 8, 9):
  ```ts
  export interface RowCue {
    ms: number
    kind: number
  }

  export interface SourcePreview {
    title: string
    artist: string
    durationSec: number
    coverUrl?: string
    analysisPath?: string
    cues: RowCue[]
  }
  ```
  and `preview?: SourcePreview` on `SourcePlaylistEntry`. `coverUrl` is a `surco://media/...` URL (`mediaUrl`), `analysisPath` an absolute path inside rekordbox's `share` folder, `cues` sorted by `ms`.
- Produces (main): `readRekordboxPlaylistWithPreview(db, share: string, id: string, exists?: (p: string) => boolean): SourcePlaylistEntry[]`, `shareFile(share: string, stored: string | null): string | null`, `coverFileOf(share, imagePath, exists?): string | null`. `PlaylistEditHost.allowMedia?: (paths: string[]) => void`.

- [ ] **Step 1: Let the fixture carry an artist and a cover**

In `src/main/rekordboxPlaylistsFixture.ts`, add to `FixtureContent`:

```ts
  ArtistID?: string
  ImagePath?: string
```

and write them in the content insert:

```ts
  const content = db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, Title, Length, BPM,
       Rating, KeyID, UUID, AnalysisDataPath, ArtistID, ImagePath, rb_local_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      c.UUID ?? `uuid-c-${c.ID}`,
      c.AnalysisDataPath ?? '',
      c.ArtistID ?? null,
      c.ImagePath ?? null,
      c.deleted ? 1 : 0,
    )
  }
```

- [ ] **Step 2: Write the failing reader tests**

Append to `src/main/rekordboxPlaylists.test.ts` (it already defines `NIGHT`, `PLAY`, `SEP`, `SPOTIFY` and imports `mkdtemp`, `tmpdir`, `join`, `openRekordboxDb`, `writeRekordboxPlaylistFixture`; add `readRekordboxPlaylistWithPreview` and `coverFileOf` to the import from `./rekordboxPlaylists` and `mediaUrl` from `../shared/media`):

```ts
describe('readRekordboxPlaylistWithPreview', () => {
  const share = '/Users/dj/Library/Pioneer/rekordbox/share'
  let pdb: NonNullable<ReturnType<typeof openRekordboxDb>>

  beforeAll(async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbpv-')), 'master.db')
    writeRekordboxPlaylistFixture(path, {
      content: [
        {
          ...NIGHT,
          ArtistID: 'a1',
          ImagePath: '/PIONEER/Artwork/abc/def/artwork.jpg',
          AnalysisDataPath: '/PIONEER/USBANLZ/p1/q1/ANLZ0000.DAT',
        },
        { ...PLAY, ImagePath: '/../../../../etc/artwork.jpg', AnalysisDataPath: '/../x.DAT' },
        SEP,
        SPOTIFY,
      ],
      keys: [
        { ID: 'k1', ScaleName: '4B' },
        { ID: 'k2', ScaleName: '8A' },
      ],
      artists: [{ ID: 'a1', Name: 'Rebel Vision' }],
      playlists: [{ ID: 'p', Name: 'P', Attribute: 0, ParentID: 'root', Seq: 1 }],
      links: [
        { PlaylistID: 'p', ContentID: 'c1', TrackNo: 1 },
        { PlaylistID: 'p', ContentID: 'sep', TrackNo: 2 },
        { PlaylistID: 'p', ContentID: 'c2', TrackNo: 3 },
        { PlaylistID: 'p', ContentID: 'c3', TrackNo: 4 },
      ],
      cueRows: [
        { ID: 'q2', ContentID: 'c1', InMsec: 64000, Kind: 2, ColorTableIndex: 22 },
        { ID: 'q1', ContentID: 'c1', InMsec: 1000, Kind: 1, ColorTableIndex: 1 },
        { ID: 'q3', ContentID: 'c1', InMsec: 32000, Kind: 0, ColorTableIndex: null },
      ],
    })
    const opened = openRekordboxDb(path, { readonly: true })
    if (!opened) throw new Error('fixture did not open')
    pdb = opened
  })

  afterAll(() => pdb.close())

  const onlyMedium = (p: string): boolean => p.endsWith('artwork_m.jpg')

  it('gives a row what the list paints first, so it never waits for the file', () => {
    const [night] = readRekordboxPlaylistWithPreview(pdb, share, 'p', onlyMedium)
    expect(night.preview).toEqual({
      title: 'Night Train (Extended Mix)',
      artist: 'Rebel Vision',
      durationSec: 256,
      coverUrl: mediaUrl(join(share, 'PIONEER/Artwork/abc/def/artwork_m.jpg')),
      analysisPath: join(share, 'PIONEER/USBANLZ/p1/q1/ANLZ0000.DAT'),
      cues: [
        { ms: 1000, kind: 1 },
        { ms: 32000, kind: 0 },
        { ms: 64000, kind: 2 },
      ],
    })
  })

  it('keeps the entries readRekordboxPlaylist gives, separators and streaming rows without a preview', () => {
    const rows = readRekordboxPlaylistWithPreview(pdb, share, 'p', onlyMedium)
    expect(rows.map((r) => [r.separator, r.path === null, r.preview !== undefined])).toEqual([
      [false, false, true],
      [true, false, false],
      [false, false, true],
      [false, true, false],
    ])
    expect(rows[0].meta).toEqual({ bpm: '150', key: '4B' })
  })

  it('names no file outside the share folder, so a crafted row cannot reach the disk', () => {
    const [, , play] = readRekordboxPlaylistWithPreview(pdb, share, 'p', () => true)
    expect(play.preview?.coverUrl).toBeUndefined()
    expect(play.preview?.analysisPath).toBeUndefined()
    expect(play.preview?.artist).toBe('')
  })
})

describe('coverFileOf', () => {
  const share = '/s'

  it('prefers the 240 px copy rekordbox keeps for its own browser', () => {
    expect(coverFileOf(share, '/PIONEER/Artwork/a/b/artwork.jpg', () => true)).toBe(
      join(share, 'PIONEER/Artwork/a/b/artwork_m.jpg'),
    )
  })

  it('falls back to the full image when the small one is missing', () => {
    expect(
      coverFileOf(share, '/PIONEER/Artwork/a/b/artwork.jpg', (p) => !p.endsWith('_m.jpg')),
    ).toBe(join(share, 'PIONEER/Artwork/a/b/artwork.jpg'))
  })

  it('gives nothing when rekordbox has no artwork file for the track', () => {
    expect(coverFileOf(share, '/PIONEER/Artwork/a/b/artwork.jpg', () => false)).toBeNull()
    expect(coverFileOf(share, null, () => true)).toBeNull()
  })
})
```

Make sure the file's vitest import includes `afterAll` and `beforeAll`.

- [ ] **Step 3: Run them to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxPlaylists.test.ts`
Expected: FAIL, `readRekordboxPlaylistWithPreview is not a function`.

- [ ] **Step 4: Add the types**

In `src/shared/types.ts`, before `export interface SourcePlaylistEntry`, add `RowCue` and `SourcePreview` exactly as in Interfaces, and inside `SourcePlaylistEntry` after `contentId?: string`:

```ts
  preview?: SourcePreview
```

- [ ] **Step 5: Implement the reader**

In `src/main/rekordboxPlaylists.ts` add the imports

```ts
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mediaUrl } from '../shared/media'
import { insideShare } from './rekordboxArtwork'
```

(merge with the existing `node:path` default import: keep `import path from 'node:path'` and add `import { resolve } from 'node:path'`), extend the type import with `RowCue, SourcePreview`, and append:

```ts
interface PreviewRow {
  contentId: string
  Title: string | null
  Artist: string | null
  Length: number | null
  ImagePath: string | null
  AnalysisDataPath: string | null
}

interface CueRow {
  contentId: string
  InMsec: number
  Kind: number
}

const PLAYLIST_CONTENT = `SELECT s.ContentID FROM djmdSongPlaylist s
  WHERE s.PlaylistID = ? AND coalesce(s.rb_local_deleted, 0) = 0`

export function shareFile(share: string, stored: string | null): string | null {
  if (!stored) return null
  const file = resolve(share, `.${stored}`)
  return insideShare(share, file) ? file : null
}

export function coverFileOf(
  share: string,
  imagePath: string | null,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const full = shareFile(share, imagePath)
  if (!full) return null
  const medium = full.replace(/\.jpg$/i, '_m.jpg')
  if (medium !== full && exists(medium)) return medium
  return exists(full) ? full : null
}

export function readRekordboxPlaylistWithPreview(
  db: RekordboxDb,
  share: string,
  id: string,
  exists: (p: string) => boolean = existsSync,
): SourcePlaylistEntry[] {
  const entries = readRekordboxPlaylist(db, id)
  const rows = db
    .prepare(
      `SELECT c.ID AS contentId, c.Title, a.Name AS Artist, c.Length, c.ImagePath, c.AnalysisDataPath
         FROM djmdContent c LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
        WHERE c.ID IN (${PLAYLIST_CONTENT})`,
    )
    .all(id) as PreviewRow[]
  const cueRows = db
    .prepare(
      `SELECT ContentID AS contentId, InMsec, Kind FROM djmdCue
        WHERE coalesce(rb_local_deleted, 0) = 0 AND ContentID IN (${PLAYLIST_CONTENT})
        ORDER BY InMsec`,
    )
    .all(id) as CueRow[]
  const cues = new Map<string, RowCue[]>()
  for (const c of cueRows) {
    const list = cues.get(String(c.contentId)) ?? []
    list.push({ ms: c.InMsec, kind: c.Kind })
    cues.set(String(c.contentId), list)
  }
  const previews = new Map<string, SourcePreview>()
  for (const r of rows) {
    const cover = coverFileOf(share, r.ImagePath, exists)
    const analysis = shareFile(share, r.AnalysisDataPath)
    previews.set(String(r.contentId), {
      title: r.Title?.trim() ?? '',
      artist: r.Artist?.trim() ?? '',
      durationSec: r.Length ?? 0,
      ...(cover ? { coverUrl: mediaUrl(cover) } : {}),
      ...(analysis ? { analysisPath: analysis } : {}),
      cues: cues.get(String(r.contentId)) ?? [],
    })
  }
  return entries.map((e) => {
    const preview = e.contentId ? previews.get(e.contentId) : undefined
    return e.path && !e.separator && preview ? { ...e, preview } : e
  })
}
```

- [ ] **Step 6: Run the reader tests**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxPlaylists.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing handler and MIME tests**

In `src/main/rekordboxPlaylistsIpc.test.ts`, inside `describe('registerRekordboxPlaylistsIpc')`, add:

```ts
  it('grants the files and covers of the playlist it read, so the rows can play and paint before any disk walk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbipc-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, ORGANISE_FIXTURE)
    const allowMedia = vi.fn()
    registerRekordboxPlaylistsIpc(() => path, {
      ensureClosed: vi.fn(async () => true),
      queue: queueFor(path),
      allowMedia,
    })
    const entries = (await handler('rekordbox:playlist')({}, '2000')) as SourcePlaylistEntry[]
    const paths = entries.flatMap((e) => (e.path && !e.separator ? [e.path] : []))
    expect(paths.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.separator || e.path === null || e.preview)).toBe(true)
    expect(allowMedia).toHaveBeenCalledWith(expect.arrayContaining(paths))
  })
```

(import `type SourcePlaylistEntry` from `../shared/types`). In `src/shared/media.test.ts` add to its `mediaMimeType` describe (create one if the file has none, with `import { describe, expect, it } from 'vitest'` and `import { mediaMimeType } from './media'`):

```ts
  it('serves rekordbox artwork as JPEG, so the row image decodes', () => {
    expect(mediaMimeType('/share/PIONEER/Artwork/a/b/artwork_m.jpg')).toBe('image/jpeg')
  })
```

- [ ] **Step 8: Run them to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxPlaylistsIpc.test.ts src/shared/media.test.ts`
Expected: FAIL (`allowMedia` not called; `application/octet-stream`).

- [ ] **Step 9: Wire the handler**

In `src/shared/media.ts` add to `MIME`:

```ts
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
```

In `src/main/rekordboxPlaylistsIpc.ts` import `mediaPathFromUrl` from `../shared/media`, `rekordboxShareDir` from `./rekordboxArtwork`, `readRekordboxPlaylistWithPreview` from `./rekordboxPlaylists` (drop the now unused `readRekordboxPlaylist` import), add to `PlaylistEditHost`:

```ts
  allowMedia?: (paths: string[]) => void
```

and replace the `rekordbox:playlist` handler with:

```ts
  ipcMain.handle('rekordbox:playlist', (_e, id: string) => {
    const path = collection()
    const entries = withCollection(
      path,
      (db) => readRekordboxPlaylistWithPreview(db, rekordboxShareDir(path), id),
      [],
    )
    host.allowMedia?.(
      entries.flatMap((e) => [
        ...(e.path && !e.separator ? [e.path] : []),
        ...(e.preview?.coverUrl ? [mediaPathFromUrl(e.preview.coverUrl)] : []),
      ]),
    )
    return entries
  })
```

In `src/main/index.ts`, in the `registerRekordboxPlaylistsIpc` host object, add:

```ts
      allowMedia: (paths) => mediaAccess.allowAll(paths),
```

- [ ] **Step 10: Run the tests, types and lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rekordboxPlaylists.test.ts src/main/rekordboxPlaylistsIpc.test.ts src/shared/media.test.ts`
Expected: PASS. Then both `tsc` commands and biome on the touched files: clean.

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/shared/media.ts src/shared/media.test.ts src/main/rekordboxPlaylists.ts src/main/rekordboxPlaylists.test.ts src/main/rekordboxPlaylistsFixture.ts src/main/rekordboxPlaylistsIpc.ts src/main/rekordboxPlaylistsIpc.test.ts src/main/index.ts
git commit -m "Read each rekordbox row's title, artist, length, cover, analysis and cues with its playlist"
```

---

### Task 2: Rows are born with rekordbox's preview

**Files:**
- Modify: `src/renderer/src/types.ts` (TrackItem, after `duration?: number`)
- Create: `src/renderer/src/lib/rowDisplay.ts`, test `src/renderer/src/lib/rowDisplay.test.ts`
- Modify: `src/renderer/src/hooks/useTrackLibrary.ts` (`addPaths` read task, `startOverTrack`, `openSourcePlaylist`)
- Modify: `src/renderer/src/components/TrackList.tsx` (title, artist, duration, cover of the row)
- Test: `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx`, `src/renderer/src/components/TrackList.test.tsx`

**Interfaces:**
- Consumes: `SourcePreview` and `SourcePlaylistEntry.preview` (Task 1).
- Produces: `TrackItem.sourcePreview?: SourcePreview`; `rowDisplay(t: TrackItem): RowDisplay` with `RowDisplay = { title: string; artist: string; duration: number | undefined; cover: string | undefined; waiting: boolean }`. Task 9 builds row B on `rowDisplay`.

- [ ] **Step 1: Write the failing `rowDisplay` tests**

Create `src/renderer/src/lib/rowDisplay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { rowDisplay } from './rowDisplay'

const preview = {
  title: 'Night Train (Extended Mix)',
  artist: 'Rebel Vision',
  durationSec: 256,
  coverUrl: 'surco://media/cover',
  cues: [],
}

function track(over: Partial<TrackItem>): TrackItem {
  return {
    id: 'a',
    inputPath: '/m/Night Train.aiff',
    fileName: 'Night Train',
    listLabel: 'Night Train',
    query: '',
    status: 'idle',
    meta: { title: 'Night Train', artist: '' } as TrackMetadata,
    ...over,
  }
}

describe('rowDisplay', () => {
  it('shows what rekordbox knows while the file is still being read', () => {
    expect(rowDisplay(track({ loadingMeta: true, sourcePreview: preview }))).toEqual({
      title: 'Night Train (Extended Mix)',
      artist: 'Rebel Vision',
      duration: 256,
      cover: 'surco://media/cover',
      waiting: false,
    })
  })

  it('shows the file once it is read, because Surco edits the file and not rekordbox', () => {
    const read = rowDisplay(
      track({
        loadingMeta: false,
        sourcePreview: preview,
        listLabel: 'Night Train (Original Mix)',
        meta: { title: 'Night Train (Original Mix)', artist: 'Rebel' } as TrackMetadata,
        duration: 255.6,
        embeddedCover: 'surco://cover/x.jpg',
      }),
    )
    expect(read).toEqual({
      title: 'Night Train (Original Mix)',
      artist: 'Rebel',
      duration: 255.6,
      cover: 'surco://cover/x.jpg',
      waiting: false,
    })
  })

  it('keeps rekordbox cover and length when the file gives none', () => {
    const read = rowDisplay(track({ loadingMeta: false, sourcePreview: preview }))
    expect(read.cover).toBe('surco://media/cover')
    expect(read.duration).toBe(256)
  })

  it('waits with a skeleton only for a row that has nothing to show yet', () => {
    expect(rowDisplay(track({ loadingMeta: true })).waiting).toBe(true)
    expect(rowDisplay(track({ loadingMeta: true, sourcePreview: { ...preview, durationSec: 0 } })).duration).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/rowDisplay.test.ts`
Expected: FAIL, cannot resolve `./rowDisplay`.

- [ ] **Step 3: Add the field and the helper**

In `src/renderer/src/types.ts` add to `TrackItem` (import `SourcePreview` from `../../shared/types` with the other shared imports):

```ts
  sourcePreview?: SourcePreview
```

Create `src/renderer/src/lib/rowDisplay.ts`:

```ts
import type { TrackItem } from '../types'

export interface RowDisplay {
  title: string
  artist: string
  duration: number | undefined
  cover: string | undefined
  waiting: boolean
}

export function rowDisplay(t: TrackItem): RowDisplay {
  const reading = t.loadingMeta ? t.sourcePreview : undefined
  const previewLength = t.sourcePreview?.durationSec
  return {
    title: reading?.title || t.listLabel,
    artist: reading ? reading.artist : t.meta.artist,
    duration: t.duration ?? (previewLength && previewLength > 0 ? previewLength : undefined),
    cover: t.embeddedCover ?? t.sourcePreview?.coverUrl,
    waiting: Boolean(t.loadingMeta) && !t.sourcePreview,
  }
}
```

- [ ] **Step 4: Run the helper tests**

Expected: PASS.

- [ ] **Step 5: Write the failing library tests**

Append to `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx` (its `setup` stubs `expandPaths` as identity and `readMeta`):

```ts
describe('opening a rekordbox playlist with previews', () => {
  const preview = (title: string) => ({
    title,
    artist: 'Rebel Vision',
    durationSec: 256,
    cues: [{ ms: 1000, kind: 1 }],
  })
  const entry = (path: string, title: string) => ({
    path,
    separator: false,
    meta: {},
    contentId: path,
    preview: preview(title),
  })

  it('adds the rows before the disk check answers, each with its preview', async () => {
    let answer: (paths: string[]) => void = () => {}
    const expandPaths = vi.fn(() => new Promise<string[]>((r) => (answer = r)))
    const read = vi.fn(() => new Promise(() => {}))
    const { result } = setup({ expandPaths, readMeta: read, readMetaLight: read })
    let opened: Promise<number> = Promise.resolve(0)
    act(() => {
      opened = result.current.openSourcePlaylist(
        [entry('/m/a.aiff', 'A'), entry('/m/b.aiff', 'B')],
        'rekordbox',
      )
    })
    await waitFor(() => expect(result.current.tracks).toHaveLength(2))
    expect(result.current.tracks.map((t) => t.sourcePreview?.title)).toEqual(['A', 'B'])
    answer(['/m/a.aiff', '/m/b.aiff'])
    await act(async () => {
      await opened
    })
  })

  it('drops the row of a file the disk lacks and counts it once, as missing and not as unreadable', async () => {
    const read = vi.fn((path: string) =>
      path === '/m/gone.aiff'
        ? new Promise((_, reject) => setTimeout(() => reject(new Error('ENOENT')), 20))
        : Promise.resolve({ tags: tags({ title: 'A' }), duration: 1, cover: null, foreignTags: [], partial: true }),
    )
    const expandPaths = vi.fn(async () => ['/m/a.aiff'])
    const onMetaReadFailed = vi.fn()
    const { result } = setup({ expandPaths, readMeta: read, readMetaLight: read }, { onMetaReadFailed })
    let missing = -1
    await act(async () => {
      missing = await result.current.openSourcePlaylist(
        [entry('/m/a.aiff', 'A'), entry('/m/gone.aiff', 'Gone')],
        'rekordbox',
      )
    })
    expect(missing).toBe(1)
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff'])
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40))
    })
    expect(onMetaReadFailed).not.toHaveBeenCalled()
  })

  it('never counts the preview as an edit once the file is read', async () => {
    const read = vi.fn().mockResolvedValue({
      tags: tags({ title: 'A from file', artist: 'File Artist' }),
      duration: 255,
      cover: null,
      foreignTags: [],
      partial: true,
    })
    const { result } = setup({ readMeta: read, readMetaLight: read })
    await act(async () => {
      await result.current.openSourcePlaylist([entry('/m/a.aiff', 'A')], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const row = result.current.tracks[0]
    expect(row.meta.title).toBe('A from file')
    expect(row.diskSignature).toBe(trackSignature(row))
  })

  it('refreshes the preview of a row already loaded when the playlist is read again', async () => {
    const read = vi.fn().mockResolvedValue({
      tags: tags({ title: 'A' }),
      duration: 255,
      cover: null,
      foreignTags: [],
      partial: true,
    })
    const { result } = setup({ readMeta: read, readMetaLight: read })
    await act(async () => {
      await result.current.openSourcePlaylist([entry('/m/a.aiff', 'A')], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const before = result.current.tracks[0]
    const withNewCue = {
      ...entry('/m/a.aiff', 'A'),
      preview: { ...preview('A'), cues: [{ ms: 1000, kind: 1 }, { ms: 64000, kind: 2 }] },
    }
    await act(async () => {
      await result.current.openSourcePlaylist([withNewCue], 'rekordbox')
    })
    const after = result.current.tracks[0]
    expect(after.sourcePreview?.cues).toHaveLength(2)
    expect(after.diskSignature).toBe(before.diskSignature)
    expect(after.diskSignature).toBe(trackSignature(after))
  })
})
```

Every test passes the same mock as `readMeta` and `readMetaLight`: in this task the rows still read through `readMeta`, Task 5 moves rows with a preview to `readMetaLight`, and these tests keep passing unchanged across both.

- [ ] **Step 6: Run to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx`
Expected: FAIL (rows appear only after `expandPaths`, no `sourcePreview`, the gone file is read, the preview is not refreshed).

- [ ] **Step 7: Implement in `useTrackLibrary`**

1. Failed reads are counted by row, so a row removed as missing is not also reported as unreadable. `importFailed` becomes `useRef(new Set<string>())`. In `addPaths`, inside the `readSlot.current(async () => { ... })` task, replace `const ok = await loadTrackMeta(base)` and `if (!ok) importFailed.current += 1` with:

```ts
          const present = tracksRef.current.some((t) => t.id === base.id)
          const ok = present ? await loadTrackMeta(base) : true
          if (!ok) importFailed.current.add(base.id)
```

and the settle block with:

```ts
            const failed = tracksRef.current.filter((t) => importFailed.current.has(t.id)).length
            importFailed.current = new Set()
            if (failed > 0) onMetaReadFailed(failed)
```

The reset in `clearTracks` (`importFailed.current = 0`) becomes `importFailed.current = new Set()`.

2. In `startOverTrack`, keep the preview: `const base = { ...newTrack(track.inputPath), loadingMeta: true, sourcePreview: track.sourcePreview }`.

3. In `openSourcePlaylist`, right after `const loaded = loadedNow()`, add the refresh of loaded rows:

```ts
    if (source === 'rekordbox') {
      const previewOf = new Map(
        entries.flatMap((e) =>
          e.path && !e.separator && e.preview ? [[same(e.path), e.preview] as const] : [],
        ),
      )
      const stale = new Set(
        tracksRef.current
          .filter((t) => {
            const next = previewOf.get(same(t.inputPath))
            return next !== undefined && JSON.stringify(next) !== JSON.stringify(t.sourcePreview)
          })
          .map((t) => t.id),
      )
      if (stale.size > 0)
        mapTracks((t) =>
          stale.has(t.id) ? { ...t, sourcePreview: previewOf.get(same(t.inputPath)) } : t,
        )
    }
```

4. In the staging loop (`for (const e of fresh) { appleMusicMeta.current.set(...) ... }`) add, for rekordbox entries:

```ts
      if (source === 'rekordbox' && e.preview) pendingSeed.current.set(e.path, { sourcePreview: e.preview })
```

5. Replace everything from `const freshPaths = ...` to the end of the function with:

```ts
    const freshPaths = [...new Map(fresh.map((e) => [same(e.path), e.path])).values()]
    await addPaths(freshPaths)
    const onDisk = new Set((await window.api.expandPaths(freshPaths)).map(same))
    const gone = new Set(freshPaths.filter((p) => !onDisk.has(same(p))).map(same))
    for (const e of fresh) {
      if (!gone.has(same(e.path))) continue
      appleMusicMeta.current.delete(e.path)
      pendingSeed.current.delete(e.path)
    }
    const goneRows = tracksRef.current.filter((t) => gone.has(same(t.inputPath))).map((t) => t.id)
    if (goneRows.length > 0) removeTracks(goneRows)
    return gone.size
```

`removeTracks` is declared below `openSourcePlaylist` as a `useStableCallback`/function in the same hook; if TypeScript reports it used before declaration, move `openSourcePlaylist` below `removeTracks` (no other change). Update the comment block above `openSourcePlaylist` that says expandPaths runs first: it now says the rows go in at once and the disk check removes the ones that are not there.

- [ ] **Step 8: Paint the preview in the row**

In `src/renderer/src/components/TrackList.tsx`, inside the row component, add `const shown = rowDisplay(t)` (import from `../lib/rowDisplay`) and use it:
- `{t.embeddedCover ? (<img ... src={t.embeddedCover} .../>)` → `{shown.cover ? (<img ... src={shown.cover} .../>)`.
- the title text `{t.listLabel}` → `{shown.title}`.
- the duration slot: `{t.duration !== undefined && (<span data-testid="track-duration">{formatTime(t.duration)}</span>)}` → same with `shown.duration`.
- `{t.loadingMeta ? (<span data-testid="track-loading" .../>)` → `{shown.waiting ? (...)`.
- the artist `{t.meta.artist || tr('trackList.noArtist')}` → `{shown.artist || tr('trackList.noArtist')}`.

Add a test to `src/renderer/src/components/TrackList.test.tsx` next to `'omits the duration until it has been probed'`:

```ts
  it('paints a row opened from rekordbox complete while its file is still being read', () => {
    renderList([
      track({
        id: 'a',
        loadingMeta: true,
        sourcePreview: {
          title: 'Night Train (Extended Mix)',
          artist: 'Rebel Vision',
          durationSec: 256,
          coverUrl: 'surco://media/x',
          cues: [],
        },
      }),
    ])
    expect(screen.getByTestId('track-row')).toHaveTextContent('Night Train (Extended Mix)')
    expect(screen.getByTestId('track-row')).toHaveTextContent('Rebel Vision')
    expect(screen.getByTestId('track-duration')).toHaveTextContent('4:16')
    expect(screen.getByTestId('track-cover')).toHaveAttribute('src', 'surco://media/x')
    expect(screen.queryByTestId('track-loading')).toBeNull()
  })
```

- [ ] **Step 9: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/rowDisplay.test.ts src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx src/renderer/src/hooks/useTrackLibrary.test.tsx src/renderer/src/components/TrackList.test.tsx src/renderer/src/App.test.tsx`
Expected: PASS. An existing test in `useTrackLibraryPlaylist.test.tsx` that asserted `expandPaths` runs before rows exist, or that staged seeds are cleaned for dropped paths, is updated to the new order (rows first, removal after) with its reason kept. Both `tsc`, biome: clean.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/types.ts src/renderer/src/lib/rowDisplay.ts src/renderer/src/lib/rowDisplay.test.ts src/renderer/src/hooks/useTrackLibrary.ts src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx src/renderer/src/components/TrackList.tsx src/renderer/src/components/TrackList.test.tsx
git commit -m "Paint rekordbox playlist rows from rekordbox's own data before their files are read"
```

---

### Task 3: One read queue, rows on screen first

**Files:**
- Modify: `src/renderer/src/lib/concurrency.ts`, test `src/renderer/src/lib/concurrency.test.ts`
- Modify: `src/renderer/src/hooks/useTrackLibrary.ts` (`readSlot`, new `prioritizeReads`)
- Modify: `src/renderer/src/App.tsx` (`onListRowVisible` at ~1389, selection)
- Test: `src/renderer/src/hooks/useTrackLibrary.test.tsx`

**Interfaces:**
- Produces: `createPriorityLimit(limit: number): PriorityLimit` with `run<R>(key: string, task: () => Promise<R>): Promise<R>` and `prioritize(keys: readonly string[]): void`; `createConcurrencyLimit` is removed. Library: `prioritizeReads: (ids: string[]) => void`.

- [ ] **Step 1: Rewrite the limiter tests as failing tests**

In `src/renderer/src/lib/concurrency.test.ts`, change the three `createConcurrencyLimit` tests to `createPriorityLimit` (`const limit = createPriorityLimit(2)`, each `limit(task)` becomes `limit.run(String(i), task)`), and add:

```ts
  it('starts a waiting task early when its row comes on screen', async () => {
    const limit = createPriorityLimit(1)
    const started: string[] = []
    let releaseFirst: () => void = () => {}
    const first = limit.run('a', () => {
      started.push('a')
      return new Promise<void>((r) => (releaseFirst = r))
    })
    const rest = ['b', 'c', 'd'].map((k) =>
      limit.run(k, async () => {
        started.push(k)
      }),
    )
    limit.prioritize(['d'])
    releaseFirst()
    await Promise.all([first, ...rest])
    expect(started).toEqual(['a', 'd', 'b', 'c'])
  })

  it('ignores keys that are running or not queued', async () => {
    const limit = createPriorityLimit(1)
    const started: string[] = []
    const all = ['a', 'b'].map((k) =>
      limit.run(k, async () => {
        started.push(k)
      }),
    )
    limit.prioritize(['a', 'zzz'])
    await Promise.all(all)
    expect(started).toEqual(['a', 'b'])
  })
```

- [ ] **Step 2: Run to see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/concurrency.test.ts`
Expected: FAIL, `createPriorityLimit` is not exported.

- [ ] **Step 3: Implement**

Replace `createConcurrencyLimit` and its comment in `src/renderer/src/lib/concurrency.ts` with:

```ts
export interface PriorityLimit {
  run<R>(key: string, task: () => Promise<R>): Promise<R>
  prioritize(keys: readonly string[]): void
}

export function createPriorityLimit(limit: number): PriorityLimit {
  let active = 0
  let waiting: { key: string; start: () => void }[] = []
  const release = (): void => {
    const next = waiting.shift()
    if (next) next.start()
    else active--
  }
  return {
    async run(key, task) {
      if (active >= limit) await new Promise<void>((start) => waiting.push({ key, start }))
      else active++
      try {
        return await task()
      } finally {
        release()
      }
    },
    prioritize(keys) {
      const wanted = new Set(keys)
      const first = keys.flatMap((k) => waiting.filter((w) => w.key === k))
      if (first.length === 0) return
      waiting = [...first, ...waiting.filter((w) => !wanted.has(w.key))]
    },
  }
}
```

- [ ] **Step 4: Run the limiter tests**

Expected: PASS.

- [ ] **Step 5: Failing library test**

Append to `src/renderer/src/hooks/useTrackLibrary.test.tsx`, beside "useTrackLibrary read cap across imports" (reuse that describe's setup helper and its way of holding reads open):

```ts
  it('reads the row on screen before the ones still queued ahead of it', async () => {
    const order: string[] = []
    const gates = new Map<string, () => void>()
    const readMeta = vi.fn(
      (path: string) =>
        new Promise((resolve) => {
          order.push(path)
          gates.set(path, () =>
            resolve({ tags: emptyMetadata(), duration: null, cover: null, foreignTags: [] }),
          )
        }),
    )
    const { result } = setup({ readMeta })
    const paths = Array.from({ length: 10 }, (_, i) => `/m/${i}.mp3`)
    await act(async () => {
      await result.current.addPaths(paths)
    })
    expect(order).toHaveLength(6)
    const last = result.current.tracks.find((t) => t.inputPath === '/m/9.mp3')
    act(() => result.current.prioritizeReads([last?.id ?? '']))
    await act(async () => {
      gates.get('/m/0.mp3')?.()
    })
    await waitFor(() => expect(order).toHaveLength(7))
    expect(order[6]).toBe('/m/9.mp3')
  })
```

(Use the names that file already has for its setup and for `emptyMetadata`; if its setup is named differently, adapt only the call.)

- [ ] **Step 6: Run to see it fail**, then **implement**:

In `useTrackLibrary.ts`: import `createPriorityLimit` instead of `createConcurrencyLimit`; `const readSlot = useRef(createPriorityLimit(READ_CONCURRENCY))`; the read becomes `readSlot.current.run(base.id, async () => { ... })`; add to the `TrackLibrary` interface and the returned object:

```ts
  prioritizeReads: (ids: string[]) => void
```

```ts
  const prioritizeReads = useCallback((ids: string[]): void => readSlot.current.prioritize(ids), [])
```

In `App.tsx`, take `prioritizeReads` from `useTrackLibrary`, and in `onListRowVisible` add `if (visible) prioritizeReads([id])`. Next to the `focusAutoMatch(selectedId)` effect add:

```ts
  useEffect(() => {
    if (selectedId) prioritizeReads([selectedId])
  }, [selectedId, prioritizeReads])
```

- [ ] **Step 7: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/concurrency.test.ts src/renderer/src/hooks/useTrackLibrary.test.tsx src/renderer/src/App.test.tsx`
Expected: PASS ("useTrackLibrary read cap across imports" still holds a peak of 6). `tsc` both, biome: clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/concurrency.ts src/renderer/src/lib/concurrency.test.ts src/renderer/src/hooks/useTrackLibrary.ts src/renderer/src/hooks/useTrackLibrary.test.tsx src/renderer/src/App.tsx
git commit -m "Read the rows on screen and the selected one before the rest of the queue"
```

---

### Task 4: TagLib reads in the worker

**Files:**
- Modify: `src/main/tags.ts` (after `popmRatingOf`)
- Modify: `src/main/workerJobs.ts`
- Modify: `src/main/ffmpeg.ts` (`readMetaUncached`)
- Test: `src/main/workerJobs.test.ts`, `src/main/readMetaWorker.test.ts` (new)

**Interfaces:**
- Produces: `export interface TagLibRead { grouping: string; extras: Partial<TrackMetadata>; popm: string; reviewRaw: ReviewRawFields }`, `readTagLibFields(file: string): TagLibRead` in `tags.ts`; worker job `{ type: 'tagLibRead'; file: string }`.

- [ ] **Step 1: Failing worker job test**

Append to `src/main/workerJobs.test.ts` (import `execFileSync` from `node:child_process`, `ffmpegStatic` from `ffmpeg-static`, `mkdtempSync` from `node:fs`, `tmpdir`, `join`, if not already):

```ts
describe('tagLibRead', () => {
  it('reads every TagLib field readMeta needs in one job, off the main process', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-tlread-')), 'a.mp3')
    execFileSync(ffmpegStatic as unknown as string, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libmp3lame',
      '-metadata',
      'grouping=Peak Time',
      '-metadata',
      'album=Bright Days ',
      file,
    ])
    const read = (await runWorkerJob({ type: 'tagLibRead', file })) as TagLibRead
    expect(read.grouping).toBe('Peak Time')
    expect(read.reviewRaw.album).toBe('Bright Days ')
    expect(read.popm).toBe('')
  })

  it('answers empty fields for a file TagLib cannot open, as the inline read did', async () => {
    const read = (await runWorkerJob({ type: 'tagLibRead', file: '/no/such.mp3' })) as TagLibRead
    expect(read).toEqual({ grouping: '', extras: {}, popm: '', reviewRaw: {} })
  })
})
```

(import `type TagLibRead` from `./tags`).

- [ ] **Step 2: Failing routing test**

Create `src/main/readMetaWorker.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('./analysisCache', () => ({
  LOUDNESS_NAMESPACE: 'loudness',
  cachedAnalysis: (_namespace: string, _input: string, run: () => Promise<unknown>) => run(),
}))
const jobs: unknown[] = []
vi.mock('./worker', async () => {
  const { runWorkerJob } = await import('./workerJobs')
  return {
    runInWorker: async (job: unknown) => {
      jobs.push(job)
      return runWorkerJob(job as Parameters<typeof runWorkerJob>[0])
    },
  }
})

import { readMeta } from './ffmpeg'

describe('readMeta and TagLib', () => {
  it('asks the worker for the TagLib fields, so a slow NAS file never freezes the app', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-rmworker-')), 'a.mp3')
    execFileSync(ffmpegStatic as unknown as string, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libmp3lame',
      '-metadata',
      'grouping=Peak Time',
      file,
    ])
    const read = await readMeta(file)
    expect(jobs).toContainEqual({ type: 'tagLibRead', file })
    expect(read.tags.grouping).toBe('Peak Time')
  })
})
```

- [ ] **Step 3: Run both to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/workerJobs.test.ts src/main/readMetaWorker.test.ts`
Expected: FAIL (unknown job type; no `tagLibRead` job sent).

- [ ] **Step 4: Implement**

In `src/main/tags.ts` (it already imports `TrackMetadata`; add `ReviewRawFields` to that type import):

```ts
export interface TagLibRead {
  grouping: string
  extras: Partial<TrackMetadata>
  popm: string
  reviewRaw: ReviewRawFields
}

export function readTagLibFields(file: string): TagLibRead {
  const taglib = lazyTagLibFile(file)
  try {
    return {
      grouping: taglib.use(itunesGroupingOf, ''),
      extras: taglib.use(tagLibExtrasOf, {}),
      popm: taglib.use(popmRatingOf, ''),
      reviewRaw: taglib.use(tagLibReviewRawOf, {}),
    }
  } finally {
    taglib.dispose()
  }
}
```

In `src/main/workerJobs.ts`: import `readTagLibFields, type TagLibRead` from `./tags`; add `| { type: 'tagLibRead'; file: string }` to `WorkerJob`, `| TagLibRead` to `WorkerJobResult`, and the case:

```ts
    case 'tagLibRead':
      return readTagLibFields(job.file)
```

In `src/main/ffmpeg.ts` `readMetaUncached`, replace the block from `let reviewRaw: ReviewRawFields | undefined` through the `finally { taglib.dispose() }` with:

```ts
    const tagLib = await runInWorker<TagLibRead>({ type: 'tagLibRead', file: input })
    if (!tags.grouping.trim() && tagLib.grouping) tags.grouping = tagLib.grouping
    withTagLibExtras(input, tags, () => tagLib.extras)
    if (!tags.rating?.trim() && tagLib.popm) tags.rating = tagLib.popm
    const reviewRaw = reviewRawOf(tags, reviewRawFromProbe(data), () => tagLib.reviewRaw)
```

Import `type TagLibRead` from `./tags`; remove imports this leaves unused (`lazyTagLibFile`, `itunesGroupingOf`, `popmRatingOf`, `tagLibExtrasOf`, `tagLibReviewRawOf` if nothing else in the file uses them). The comments that explained each fallback (GRP1, POPM) move above the matching new line, shortened only where they mention the shared open.

- [ ] **Step 5: Run the TagLib-touching suites**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/workerJobs.test.ts src/main/readMetaWorker.test.ts src/main/readMetaReviewRaw.test.ts src/main/readMetaCache.test.ts src/main/ffmpeg.test.ts`
Expected: PASS, the existing GRP1, POPM and review-raw tests unchanged. Then run every `src/main/*.test.ts` whose name contains `readMeta`, `grouping`, `popm` or `itunes` (`rg -l "readMeta\(" src/main --glob '*.test.ts'`) and the full main suite once; both `tsc`, biome: clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/tags.ts src/main/workerJobs.ts src/main/workerJobs.test.ts src/main/ffmpeg.ts src/main/readMetaWorker.test.ts
git commit -m "Read the TagLib fields of an imported file in the worker instead of the main process"
```

---

### Task 5: Light read while listing, full read on selection or conversion

**Files:**
- Modify: `src/main/ffmpeg.ts` (`readMeta`, `readMetaUncached`, new `readMetaLight`)
- Modify: `src/main/audioIpc.ts` (`audio:metaLight` beside `audio:meta`)
- Modify: `src/preload/index.ts`, `src/preload/api.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`
- Modify: `src/renderer/src/types.ts` (`metaPartial`)
- Modify: `src/renderer/src/hooks/useTrackLibrary.ts` (`loadTrackMeta`, new `completeTrackMeta`)
- Modify: `src/renderer/src/hooks/useTrackProcessing.ts` (gate at ~194), `src/renderer/src/App.tsx`
- Test: `src/main/readMetaCache.test.ts`, `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx`, `src/renderer/src/hooks/useTrackProcessing.test.tsx`

**Interfaces:**
- Consumes: `TrackItem.sourcePreview` (Task 2).
- Produces: `readMetaLight(input: string): Promise<MetaRead & { partial: boolean }>`; preload `readMetaLight: (path: string) => Promise<MetaRead & { partial: boolean }>`; `TrackItem.metaPartial?: boolean`; library `completeTrackMeta: (id: string) => Promise<void>`; `useTrackProcessing` param `completeTrackMeta?: (id: string) => Promise<void>`.

- [ ] **Step 1: Failing main tests**

Append to `src/main/readMetaCache.test.ts` (its mock records every spawn in `calls`; import `readMetaLight` next to `readMeta`):

```ts
describe('readMetaLight', () => {
  it('reads tags and length without the cover thumbnail or the ffmetadata pass', async () => {
    const read = await readMetaLight(src)
    expect(read.tags.title).toBe('Test Track')
    expect(read.partial).toBe(true)
    expect(read.cover).toBeNull()
    expect(calls.some((c) => c.args.includes('ffmetadata'))).toBe(false)
    expect(calls.some((c) => c.args.some((a) => a.endsWith('.jpg')))).toBe(false)
  })

  it('answers the full read when one is already cached, so a known file is never partial', async () => {
    await readMeta(src)
    calls.length = 0
    const read = await readMetaLight(src)
    expect(read.partial).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('caches the light read too, so reopening the playlist costs nothing', async () => {
    await readMetaLight(src)
    calls.length = 0
    await readMetaLight(src)
    expect(calls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/readMetaCache.test.ts`
Expected: FAIL, `readMetaLight` is not exported.

- [ ] **Step 3: Implement the main side**

In `src/main/ffmpeg.ts` (import `peekAnalysis` from `./analysisCache` beside `cachedAnalysis`):

```ts
const READMETA_NAMESPACE = 'readmeta-v5'
const READMETA_LIGHT_NAMESPACE = 'readmeta-light-v1'

const FAILED_READ: MetaRead = {
  tags: {} as TrackMetadata,
  duration: null,
  cover: null,
  foreignTags: [],
  failed: true,
}

function composed(result: MetaRead): MetaRead {
  return {
    ...result,
    tags: composeMeta(result.tags),
    ...(result.reviewRaw && { reviewRaw: composeMeta(result.reviewRaw) }),
  }
}
```

Rewrite `readMeta` with them (same behaviour: `cachedAnalysis(READMETA_NAMESPACE, …)`, `composed(result)` or `FAILED_READ`; keep its comments), give `readMetaUncached` a second parameter `full = true` and use it for the two costly steps:

```ts
      cover: full ? await extractCover(input, dims) : null,
      foreignTags: full ? await readForeignTags(input) : [],
```

and add:

```ts
export async function readMetaLight(input: string): Promise<MetaRead & { partial: boolean }> {
  const full = await peekAnalysis<MetaRead>(READMETA_NAMESPACE, input)
  if (full) return { ...composed(full), partial: false }
  const light = await cachedAnalysis(READMETA_LIGHT_NAMESPACE, input, () =>
    readMetaUncached(input, false),
  )
  return light ? { ...composed(light), partial: true } : { ...FAILED_READ, partial: false }
}
```

In `src/main/audioIpc.ts`, import `readMetaLight` with `readMeta` and add beside `audio:meta`:

```ts
  ipcMain.handle('audio:metaLight', async (_e, inputPath: string) => {
    const read = await readMetaLight(inputPath)
    const meta = { ...read, tags: withSettingsYear(read.tags) }
    if (!meta.cover) return meta
    return {
      ...meta,
      cover: { ...meta.cover, thumbUrl: await coverThumbUrlFor(meta.cover.thumbUrl) },
    }
  })
```

Preload `src/preload/index.ts` beside `readMeta`:

```ts
  readMetaLight: (path: string) => ipcRenderer.invoke('audio:metaLight', path),
```

`src/preload/api.ts` beside `readMeta`'s type: `readMetaLight: (path: string) => Promise<MetaRead & { partial: boolean }>`. Stubs: in `src/renderer/src/test/api.ts` and `src/scenarios/harness.tsx`, add `readMetaLight` returning what their `readMeta` stub returns plus `partial: false`.

- [ ] **Step 4: Run the main tests**

Expected: PASS (the three old `readMetaCache` tests too).

- [ ] **Step 5: Failing renderer tests**

Append to `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx`:

```ts
describe('the light read of a rekordbox row', () => {
  const entry = {
    path: '/m/a.aiff',
    separator: false,
    meta: {},
    contentId: 'c1',
    preview: { title: 'A', artist: 'R', durationSec: 256, cues: [] },
  }
  const light = {
    tags: tags({ title: 'A' }),
    duration: 255,
    cover: null,
    foreignTags: [],
    partial: true,
  }
  const full = {
    tags: tags({ title: 'A' }),
    duration: 255,
    cover: { thumbUrl: 'surco://cover/a.jpg', width: 600, height: 600 },
    foreignTags: [{ name: 'ENERGY', value: '7' }],
  }

  it('lists the row from the light read and leaves it marked as partial', async () => {
    const readMetaLight = vi.fn().mockResolvedValue(light)
    const readMeta = vi.fn().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    expect(readMeta).not.toHaveBeenCalled()
    expect(result.current.tracks[0].metaPartial).toBe(true)
  })

  it('completes the cover and foreign tags without the row reading as edited', async () => {
    const readMetaLight = vi.fn().mockResolvedValue(light)
    const readMeta = vi.fn().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    await act(async () => {
      await result.current.completeTrackMeta(result.current.tracks[0].id)
    })
    const row = result.current.tracks[0]
    expect(row.metaPartial).toBe(false)
    expect(row.embeddedCover).toBe('surco://cover/a.jpg')
    expect(row.coverUrl).toBe('surco://cover/a.jpg')
    expect(row.foreignTags).toEqual([{ name: 'ENERGY', value: '7' }])
    expect(row.diskSignature).toBe(trackSignature(row))
  })

  it('reads a dropped file fully, as before', async () => {
    const readMetaLight = vi.fn().mockResolvedValue(light)
    const readMeta = vi.fn().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.addPaths(['/m/b.aiff'])
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    expect(readMetaLight).not.toHaveBeenCalled()
    expect(result.current.tracks[0].metaPartial).toBeFalsy()
  })
})
```

In `src/renderer/src/hooks/useTrackProcessing.test.tsx`, next to the existing test that refuses a row whose read failed (search `sourceTagsUnread`), add two tests built with that file's own setup: a track `{ ...track, metaPartial: true }` and a `completeTrackMeta` mock that clears the flag in the same `tracksRef` (`vi.fn(async (id) => { tracksRef.current = tracksRef.current.map((t) => (t.id === id ? { ...t, metaPartial: false } : t)) })`) is converted and `completeTrackMeta` was called with its id before `window.api.process` (or the file's convert call); and with a `completeTrackMeta` that leaves the flag set, the row ends `status: 'error'` with `errors.sourceTagsUnread` and the convert call is never made.

- [ ] **Step 6: Run to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx src/renderer/src/hooks/useTrackProcessing.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement the renderer side**

`src/renderer/src/types.ts`, in `TrackItem`: `metaPartial?: boolean`.

`useTrackLibrary.ts`, `loadTrackMeta`:

```ts
      const read = base.sourcePreview
        ? await window.api.readMetaLight(path)
        : { ...(await window.api.readMeta(path)), partial: false }
      const { tags, duration, cover, foreignTags, failed, reviewRaw } = read
```

and in the applier object add `metaPartial: read.partial,` next to `loadingMeta: false`.

Add, after `rereadTrackMeta`:

```ts
  const completing = useRef(new Set<string>())
  const completeTrackMeta = useStableCallback(async (id: string): Promise<void> => {
    const current = tracksRef.current.find((t) => t.id === id)
    if (!current?.metaPartial || completing.current.has(id)) return
    completing.current.add(id)
    try {
      const { cover, foreignTags, failed } = await window.api.readMeta(current.inputPath)
      if (failed) return
      enqueueMetaPatch(id, (t) => {
        const untouched = t.diskSignature === trackSignature(t)
        const completed: TrackItem = {
          ...t,
          metaPartial: false,
          foreignTags,
          embeddedCover: cover?.thumbUrl ?? t.embeddedCover,
          embeddedCoverDims:
            cover && cover.width > 0 ? { w: cover.width, h: cover.height } : t.embeddedCoverDims,
          ...(untouched && t.coverUrl === undefined && !t.coverRemoved && cover?.thumbUrl
            ? { coverUrl: cover.thumbUrl }
            : {}),
        }
        const before = trackSignature(t)
        const after = trackSignature(completed)
        return {
          ...completed,
          ...(t.processedSignature === before && { processedSignature: after }),
          ...(t.diskSignature === before && { diskSignature: after }),
        }
      })
    } finally {
      completing.current.delete(id)
    }
  })
```

Expose `completeTrackMeta` in the `TrackLibrary` interface and the returned object.

`useTrackProcessing.ts`: add the param `completeTrackMeta?: (id: string) => Promise<void>` to `Params` and the destructuring, and before the `metaReadFailed` gate:

```ts
      if (track.metaPartial && completeTrackMeta) {
        await completeTrackMeta(id)
        const fresh = tracksRef.current.find((t) => t.id === id)
        if (!fresh || fresh.metaPartial) {
          updateTrack(id, {
            status: 'error',
            error: tr('errors.sourceTagsUnread'),
            stage: undefined,
          })
          return 'failed'
        }
        track = fresh
      }
```

`App.tsx`: take `completeTrackMeta` from `useTrackLibrary`, pass it to `useTrackProcessing`, and add:

```ts
  const partialSelected = useMemo(() => {
    const ids = new Set(selection.ids)
    return tracks.filter((t) => t.metaPartial && ids.has(t.id)).map((t) => t.id)
  }, [tracks, selection.ids])
  useEffect(() => {
    for (const id of partialSelected) void completeTrackMeta(id)
  }, [partialSelected, completeTrackMeta])
```

(use the names App already has for the track list and the selection state).

- [ ] **Step 8: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/readMetaCache.test.ts src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx src/renderer/src/hooks/useTrackLibrary.test.tsx src/renderer/src/hooks/useTrackProcessing.test.tsx src/renderer/src/App.test.tsx`
Expected: PASS. Both `tsc`, biome: clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/ffmpeg.ts src/main/readMetaCache.test.ts src/main/audioIpc.ts src/preload/index.ts src/preload/api.ts src/renderer/src/test/api.ts src/scenarios/harness.tsx src/renderer/src/types.ts src/renderer/src/hooks/useTrackLibrary.ts src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx src/renderer/src/hooks/useTrackProcessing.ts src/renderer/src/hooks/useTrackProcessing.test.tsx src/renderer/src/App.tsx
git commit -m "Skip the cover thumbnail and ffmetadata while listing a rekordbox playlist and finish the read on selection"
```

---

### Task 6: Auto-match waits for the reads

**Files:**
- Modify: `src/renderer/src/hooks/useAutoMatch.ts`
- Modify: `src/renderer/src/App.tsx` (destructuring at ~1059, new effect)
- Test: `src/renderer/src/hooks/useAutoMatch.test.tsx`

**Interfaces:**
- Produces: `AutoMatchSweep.holdForReads: (held: boolean) => void`.

- [ ] **Step 1: Failing test**

Append to `src/renderer/src/hooks/useAutoMatch.test.tsx`:

```ts
describe('holding the sweep while files are read', () => {
  it('waits for the reads to finish before searching, so Discogs never competes with the NAS', async () => {
    setApi()
    const tracks = [track('a'), track('b')]
    const { result } = setup(tracks)
    act(() => result.current.holdForReads(true))
    act(() => result.current.enqueueAutoMatch(tracks, true))
    await new Promise((r) => setTimeout(r, 20))
    expect(window.api.search).not.toHaveBeenCalled()
    act(() => result.current.holdForReads(false))
    await waitFor(() => expect(window.api.search).toHaveBeenCalledTimes(2))
  })

  it('still matches the selected track at once', async () => {
    setApi()
    const tracks = [track('a'), track('b')]
    const { result } = setup(tracks)
    act(() => result.current.holdForReads(true))
    act(() => result.current.focusTrack('b'))
    act(() => result.current.enqueueAutoMatch(tracks, true))
    await waitFor(() => expect(window.api.search).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(window.api.search).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/hooks/useAutoMatch.test.tsx`
Expected: FAIL, `holdForReads is not a function`.

- [ ] **Step 3: Implement**

In `useAutoMatch.ts`: add `holdForReads: (held: boolean) => void` to `AutoMatchSweep`; add `const held = useRef(false)` beside `focusedId`; at the end of `readyMatchTargets`, before `return targets`:

```ts
    if (held.current) return targets.filter((t) => t.id === focusedId.current)
```

add

```ts
  const holdForReads = useCallback(
    (next: boolean): void => {
      held.current = next
      if (!next) void pumpAutoMatch()
    },
    [pumpAutoMatch],
  )
```

and return it. In `App.tsx` take `holdForReads: holdAutoMatch` from `useAutoMatch` and add:

```ts
  useEffect(() => {
    holdAutoMatch(importProgress !== null)
  }, [importProgress, holdAutoMatch])
```

- [ ] **Step 4: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/hooks/useAutoMatch.test.tsx src/renderer/src/App.test.tsx`
Expected: PASS. An App test that expects auto-match to search while an import is still reading is updated to wait for the import to settle, with its reason kept. Both `tsc`, biome: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useAutoMatch.ts src/renderer/src/hooks/useAutoMatch.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "Hold auto-match until the open playlist's files are read, except for the selected track"
```

---

### Task 7: Row waves from rekordbox or Surco's cache

**Files:**
- Modify: `src/shared/types.ts` (`RowWaveRequest`)
- Modify: `src/main/analysisCache.ts` (export `WAVEFORM_NAMESPACE`), `src/main/audioIpc.ts` (import it instead of its local constant)
- Create: `src/main/rowWavesIpc.ts`, test `src/main/rowWavesIpc.test.ts`
- Modify: `src/main/index.ts` (register), `src/preload/index.ts`, `src/preload/api.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx`

**Interfaces:**
- Produces: `export interface RowWaveRequest { path: string; analysisPath?: string }`; `rowWaves(requests, sources): Promise<Record<string, number[]>>` keyed by `analysisPath ?? path`, each value 100 numbers in 0..1; `barsOf(peaks: number[], bars?: number): number[] | null`; `ROW_WAVE_BARS = 100`; IPC `list:rowWaves`; preload `rowWaves: (requests: RowWaveRequest[]) => Promise<Record<string, number[]>>`.

- [ ] **Step 1: Failing tests**

Create `src/main/rowWavesIpc.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, nativeImage: {} }))

import { anlzFile, pqtzSection, pwavSection } from './anlzFixture'
import { barsOf, ROW_WAVE_BARS, type RowWaveSources, rowWaves } from './rowWavesIpc'

const share = '/rb/share'
const dat = `${share}/PIONEER/USBANLZ/p/q/ANLZ0000.DAT`

function sources(over: Partial<RowWaveSources> = {}): RowWaveSources {
  return {
    share,
    readDat: vi.fn(async () => anlzFile(pwavSection(Array(400).fill(31)))),
    peekWave: vi.fn(async () => null),
    ...over,
  }
}

describe('rowWaves', () => {
  it('draws rekordbox own preview for a track it has analysed', async () => {
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: dat }], sources())
    expect(found[dat]).toHaveLength(ROW_WAVE_BARS)
    expect(found[dat].every((v) => v === 1)).toBe(true)
  })

  it('never reads an analysis file outside the share folder', async () => {
    const s = sources({
      peekWave: vi.fn(async () => ({ peaks: [0.5, 0.5], rms: [], durationSec: 1 })),
    })
    const outside = '/etc/passwd'
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: outside }], s)
    expect(s.readDat).not.toHaveBeenCalled()
    expect(found[outside]).toHaveLength(ROW_WAVE_BARS)
  })

  it('uses the wave Surco already measured for a track rekordbox does not know', async () => {
    const s = sources({
      peekWave: vi.fn(async () => ({ peaks: [0.1, 0.9, 0.2, 0.4], rms: [], durationSec: 1 })),
    })
    const found = await rowWaves([{ path: '/m/b.wav' }], s)
    expect(found['/m/b.wav']).toHaveLength(ROW_WAVE_BARS)
    expect(Math.max(...found['/m/b.wav'])).toBe(0.9)
  })

  it('falls back to Surco when the analysis has no preview section', async () => {
    const s = sources({
      readDat: vi.fn(async () => anlzFile(pqtzSection([0, 500]))),
      peekWave: vi.fn(async () => ({ peaks: [0.3], rms: [], durationSec: 1 })),
    })
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: dat }], s)
    expect(Math.max(...found[dat])).toBe(0.3)
  })

  it('answers nothing for a track with no wave anywhere, so the row stays empty', async () => {
    const found = await rowWaves([{ path: '/m/c.wav' }], sources())
    expect(found).toEqual({})
  })
})

describe('barsOf', () => {
  it('keeps the loudest peak of each slice, so a short hit survives at row size', () => {
    expect(barsOf([0.1, 0.9, 0.2, 0.4], 2)).toEqual([0.9, 0.4])
  })

  it('gives nothing for an empty wave', () => {
    expect(barsOf([], 2)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rowWavesIpc.test.ts`
Expected: FAIL, cannot resolve `./rowWavesIpc`.

- [ ] **Step 3: Implement**

`src/shared/types.ts`, after `SourcePreview`:

```ts
export interface RowWaveRequest {
  path: string
  analysisPath?: string
}
```

`src/main/analysisCache.ts`, beside `LOUDNESS_NAMESPACE`: `export const WAVEFORM_NAMESPACE = 'waveform-v6'`. In `src/main/audioIpc.ts` delete the local `const WAVEFORM_NAMESPACE = 'waveform-v6'` and import it from `./analysisCache` (the version comments on `audio:waveform` stay).

Create `src/main/rowWavesIpc.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { RowWaveRequest, WaveformResult } from '../shared/types'
import { peekAnalysis, WAVEFORM_NAMESPACE } from './analysisCache'
import { wavePreview } from './anlz'
import { insideShare, rekordboxShareDir } from './rekordboxArtwork'

export const ROW_WAVE_BARS = 100

export interface RowWaveSources {
  share: string
  readDat: (file: string) => Promise<Buffer | null>
  peekWave: (path: string) => Promise<WaveformResult | null>
}

export function barsOf(peaks: number[], bars = ROW_WAVE_BARS): number[] | null {
  if (peaks.length === 0) return null
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor((i * peaks.length) / bars)
    const to = Math.min(peaks.length, Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / bars)))
    let top = 0
    for (let p = from; p < to; p++) top = Math.max(top, Math.abs(peaks[p]))
    return Math.round(Math.min(1, top) * 100) / 100
  })
}

async function fromRekordbox(request: RowWaveRequest, sources: RowWaveSources): Promise<number[] | null> {
  const file = request.analysisPath
  if (!file || !sources.share || !insideShare(sources.share, file)) return null
  const dat = await sources.readDat(file)
  return dat ? wavePreview(dat, ROW_WAVE_BARS) : null
}

async function fromSurco(request: RowWaveRequest, sources: RowWaveSources): Promise<number[] | null> {
  const wave = await sources.peekWave(request.path)
  return wave ? barsOf(wave.peaks) : null
}

export async function rowWaves(
  requests: RowWaveRequest[],
  sources: RowWaveSources,
): Promise<Record<string, number[]>> {
  const found: Record<string, number[]> = {}
  await Promise.all(
    requests.map(async (request) => {
      const bars = (await fromRekordbox(request, sources)) ?? (await fromSurco(request, sources))
      if (bars) found[request.analysisPath ?? request.path] = bars
    }),
  )
  return found
}

export function registerRowWavesIpc(collection: () => string): void {
  ipcMain.handle('list:rowWaves', (_e, requests: RowWaveRequest[]) => {
    const path = collection()
    return rowWaves(requests, {
      share: path ? rekordboxShareDir(path) : '',
      readDat: (file) => readFile(file).catch(() => null),
      peekWave: (track) =>
        peekAnalysis<WaveformResult>(WAVEFORM_NAMESPACE, track).catch(() => null),
    })
  })
}
```

In `src/main/index.ts`, beside `registerRekordboxCuesIpc`, call `registerRowWavesIpc(rekordboxCollectionPath)` (the same collection getter `registerRekordboxCuesIpc` receives). Preload `src/preload/index.ts`: `rowWaves: (requests: RowWaveRequest[]): Promise<Record<string, number[]>> => ipcRenderer.invoke('list:rowWaves', requests),`; `src/preload/api.ts`: `rowWaves: (requests: RowWaveRequest[]) => Promise<Record<string, number[]>>`; stubs in `src/renderer/src/test/api.ts` and `src/scenarios/harness.tsx`: `rowWaves: async () => ({})`.

- [ ] **Step 4: Run tests, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/main/rowWavesIpc.test.ts src/main/audioIpc.test.ts`
Expected: PASS. Both `tsc`, biome: clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/analysisCache.ts src/main/audioIpc.ts src/main/rowWavesIpc.ts src/main/rowWavesIpc.test.ts src/main/index.ts src/preload/index.ts src/preload/api.ts src/renderer/src/test/api.ts src/scenarios/harness.tsx
git commit -m "Serve each list row a small wave from rekordbox's analysis or Surco's cached one"
```

---

### Task 8: The row's wave line

**Files:**
- Create: `src/renderer/src/lib/rowWaves.ts`, test `src/renderer/src/lib/rowWaves.test.ts`
- Create: `src/renderer/src/lib/rowCues.ts`, test `src/renderer/src/lib/rowCues.test.ts`
- Create: `src/renderer/src/components/RowWave.tsx`, test `src/renderer/src/components/RowWave.test.tsx`

**Interfaces:**
- Consumes: `RowWaveRequest`, `RowCue` (Tasks 1, 7), `window.api.rowWaves` (Task 7), `HOT_KINDS` from `src/shared/cueRules.ts`.
- Produces: `RowWave({ request, cues, durationSec, pending }: { request: RowWaveRequest; cues: RowCue[]; durationSec: number | undefined; pending: boolean })`; `subscribeRowWave`, `rowWaveOf`, `rowWaveKey`, `resetRowWaves` (tests only); `cueLetter(kind: number): string`.

- [ ] **Step 1: Failing tests**

`src/renderer/src/lib/rowCues.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cueLetter } from './rowCues'

describe('cueLetter', () => {
  it('names hot cues as rekordbox shows them, skipping the kind it never uses', () => {
    expect([1, 2, 3, 5, 6, 7, 8, 9].map(cueLetter).join('')).toBe('ABCDEFGH')
  })

  it('gives no letter to a kind that is not a hot cue', () => {
    expect(cueLetter(0)).toBe('')
    expect(cueLetter(4)).toBe('')
  })
})
```

`src/renderer/src/lib/rowWaves.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { resetRowWaves, rowWaveOf, subscribeRowWave } from './rowWaves'

afterEach(() => {
  resetRowWaves()
  vi.useRealTimers()
})

function stub(answer: Api['rowWaves']): ReturnType<typeof vi.fn<Api['rowWaves']>> {
  const rowWaves = vi.fn<Api['rowWaves']>(answer)
  ;(window as unknown as { api: Partial<Api> }).api = { rowWaves }
  return rowWaves
}

describe('row waves', () => {
  it('asks once for every row that mounts in the same frame', async () => {
    vi.useFakeTimers()
    const rowWaves = stub(async () => ({ '/a.DAT': [1], '/m/b.wav': [0.5] }))
    const seen = vi.fn()
    subscribeRowWave({ path: '/m/a.wav', analysisPath: '/a.DAT' }, seen)
    subscribeRowWave({ path: '/m/b.wav' }, seen)
    await vi.advanceTimersByTimeAsync(20)
    expect(rowWaves).toHaveBeenCalledTimes(1)
    expect(rowWaves.mock.calls[0][0]).toHaveLength(2)
    expect(rowWaveOf('/a.DAT')).toEqual([1])
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('remembers a wave, so scrolling back never asks again', async () => {
    vi.useFakeTimers()
    const rowWaves = stub(async () => ({ '/m/b.wav': [0.5] }))
    subscribeRowWave({ path: '/m/b.wav' }, () => {})()
    await vi.advanceTimersByTimeAsync(20)
    subscribeRowWave({ path: '/m/b.wav' }, () => {})
    await vi.advanceTimersByTimeAsync(20)
    expect(rowWaves).toHaveBeenCalledTimes(1)
  })

  it('settles a failed ask as no wave instead of throwing', async () => {
    vi.useFakeTimers()
    stub(async () => {
      throw new Error('ipc down')
    })
    subscribeRowWave({ path: '/m/c.wav' }, () => {})
    await vi.advanceTimersByTimeAsync(20)
    expect(rowWaveOf('/m/c.wav')).toBeNull()
  })
})
```

`src/renderer/src/components/RowWave.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import '../i18n'
import { resetRowWaves } from '../lib/rowWaves'
import { RowWave } from './RowWave'

beforeEach(() => {
  ;(window as unknown as { api: Partial<Api> }).api = {
    rowWaves: vi.fn<Api['rowWaves']>(async () => ({ '/a.DAT': Array(100).fill(0.5) })),
  }
})
afterEach(() => {
  cleanup()
  resetRowWaves()
})

const request = { path: '/m/a.wav', analysisPath: '/a.DAT' }
const cues = [
  { ms: 0, kind: 1 },
  { ms: 32000, kind: 0 },
  { ms: 64000, kind: 2 },
]

describe('RowWave', () => {
  it('draws the wave once it arrives', async () => {
    render(<RowWave request={request} cues={[]} durationSec={128} pending={false} />)
    expect(await screen.findByTestId('track-wave-bars')).toBeInTheDocument()
  })

  it('places hot cues as lettered squares and memory cues as triangles along the track', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending={false} />)
    const hot = screen.getAllByTestId('track-hot-cue')
    expect(hot.map((h) => h.textContent)).toEqual(['A', 'B'])
    expect(hot[1].style.left).toBe('calc(50% - 6px)')
    expect(screen.getAllByTestId('track-memory-cue')).toHaveLength(1)
    expect(screen.getByTestId('track-wave')).toHaveAccessibleName('2 hot cues')
  })

  it('draws no cue it cannot place, for a track with no length or a cue past the end', () => {
    const { rerender } = render(
      <RowWave request={request} cues={cues} durationSec={0} pending={false} />,
    )
    expect(screen.queryAllByTestId('track-hot-cue')).toHaveLength(0)
    rerender(
      <RowWave request={request} cues={[{ ms: 999000, kind: 1 }]} durationSec={128} pending={false} />,
    )
    expect(screen.queryAllByTestId('track-hot-cue')).toHaveLength(0)
  })

  it('draws cues still waiting for rekordbox hollow', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending />)
    expect(screen.getByTestId('track-wave')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByTestId('track-wave')).toHaveAccessibleName('2 hot cues waiting for rekordbox')
  })
})
```

(Tests render in English: `src/renderer/src/i18n/index.ts` bundles only `en` up front.)

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/lib/rowCues.test.ts src/renderer/src/lib/rowWaves.test.ts src/renderer/src/components/RowWave.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/rowCues.ts`:

```ts
import { HOT_KINDS } from '../../../shared/cueRules'

const LETTERS = 'ABCDEFGH'

export function cueLetter(kind: number): string {
  const i = HOT_KINDS.indexOf(kind)
  return i >= 0 ? LETTERS[i] : ''
}
```

`src/renderer/src/lib/rowWaves.ts`:

```ts
import type { RowWaveRequest } from '../../../shared/types'

const BATCH_MS = 16

const known = new Map<string, number[] | null>()
const listeners = new Map<string, Set<() => void>>()
const inFlight = new Set<string>()
let queued = new Map<string, RowWaveRequest>()
let timer: ReturnType<typeof setTimeout> | null = null

export function rowWaveKey(request: RowWaveRequest): string {
  return request.analysisPath ?? request.path
}

function settle(keys: string[], found: Record<string, number[]>): void {
  for (const key of keys) {
    inFlight.delete(key)
    known.set(key, found[key] ?? null)
    for (const listener of listeners.get(key) ?? []) listener()
  }
}

function flush(): void {
  timer = null
  const batch = [...queued.values()]
  queued = new Map()
  const keys = batch.map(rowWaveKey)
  for (const key of keys) inFlight.add(key)
  Promise.resolve()
    .then(() => window.api.rowWaves(batch))
    .then(
      (found) => settle(keys, found),
      () => settle(keys, {}),
    )
}

export function subscribeRowWave(request: RowWaveRequest, listener: () => void): () => void {
  const key = rowWaveKey(request)
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(listener)
  listeners.set(key, set)
  if (!known.has(key) && !inFlight.has(key) && !queued.has(key)) {
    queued.set(key, request)
    timer ??= setTimeout(flush, BATCH_MS)
  }
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}

export function rowWaveOf(key: string): number[] | null | undefined {
  return known.get(key)
}

export function resetRowWaves(): void {
  if (timer) clearTimeout(timer)
  timer = null
  known.clear()
  listeners.clear()
  inFlight.clear()
  queued = new Map()
}
```

`src/renderer/src/components/RowWave.tsx`:

```tsx
import type React from 'react'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { RowCue, RowWaveRequest } from '../../../shared/types'
import { cueLetter } from '../lib/rowCues'
import { rowWaveKey, rowWaveOf, subscribeRowWave } from '../lib/rowWaves'

const WAVE_HEIGHT = 20

function wavePath(bars: number[]): string {
  return bars
    .map((v, i) => {
      const h = Math.max(1, v * WAVE_HEIGHT)
      return `M${i} ${(WAVE_HEIGHT - h) / 2}h0.7v${h}h-0.7Z`
    })
    .join('')
}

export function RowWave({
  request,
  cues,
  durationSec,
  pending,
}: {
  request: RowWaveRequest
  cues: RowCue[]
  durationSec: number | undefined
  pending: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const key = rowWaveKey(request)
  const { path, analysisPath } = request
  const subscribe = useCallback(
    (listener: () => void) => subscribeRowWave({ path, analysisPath }, listener),
    [path, analysisPath],
  )
  const bars = useSyncExternalStore(subscribe, () => rowWaveOf(key))
  const span = durationSec && durationSec > 0 ? durationSec * 1000 : 0
  const placed =
    span > 0
      ? cues.filter((c) => c.ms >= 0 && c.ms <= span).map((c) => ({ ...c, at: (c.ms / span) * 100 }))
      : []
  const hot = placed.filter((c) => c.kind !== 0)
  const memory = placed.filter((c) => c.kind === 0)
  const label =
    hot.length > 0
      ? tr(pending ? 'trackList.cuesAriaPending' : 'trackList.cuesAria', { count: hot.length })
      : undefined
  return (
    <span
      data-testid="track-wave"
      data-pending={pending || undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative block h-full"
    >
      {bars && bars.length > 0 && (
        <svg
          data-testid="track-wave-bars"
          aria-hidden="true"
          viewBox={`0 0 ${bars.length} ${WAVE_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-5 w-full fill-[var(--color-accent)] opacity-70"
        >
          <path d={wavePath(bars)} />
        </svg>
      )}
      {memory.map((c) => (
        <span
          key={`m-${c.ms}`}
          data-testid="track-memory-cue"
          aria-hidden="true"
          style={{ left: `calc(${c.at}% - 4px)` }}
          className="absolute top-0.5 h-0 w-0 border-x-4 border-t-[6px] border-x-transparent border-t-[var(--color-warn)]"
        />
      ))}
      {hot.map((c) => (
        <span
          key={`h-${c.kind}-${c.ms}`}
          data-testid="track-hot-cue"
          aria-hidden="true"
          style={{ left: `calc(${c.at}% - 6px)` }}
          className={`absolute top-0 h-3 w-3 rounded-[3px] text-center text-[9px] font-semibold leading-3 ${
            pending
              ? 'border border-[var(--color-accent)] text-[var(--color-accent)]'
              : 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
          }`}
        >
          {cueLetter(c.kind)}
        </span>
      ))}
    </span>
  )
}
```

- [ ] **Step 4: Run tests, types, lint**

Expected: PASS. Both `tsc`, biome: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/rowCues.ts src/renderer/src/lib/rowCues.test.ts src/renderer/src/lib/rowWaves.ts src/renderer/src/lib/rowWaves.test.ts src/renderer/src/components/RowWave.tsx src/renderer/src/components/RowWave.test.tsx
git commit -m "Draw a row's wave with its hot cues as lettered squares and memory cues as triangles"
```

---

### Task 9: Row B in every list, cue swatches gone

**Files:**
- Modify: `src/renderer/src/components/TrackList.tsx` (row markup ~620-890, `TrackList` props ~101, wrapper `contain-intrinsic-size` ~528)
- Modify: `src/renderer/src/components/ListRow.tsx` (`CoverPlaceholder` gets `large`)
- Modify: `src/renderer/src/App.tsx` (~1980-2010, ~2822)
- Modify: `src/renderer/src/hooks/useRekordboxQueue.ts` (drop the `rekordbox-cue-summary` invalidation)
- Delete: `src/renderer/src/components/CueSwatches.tsx` (+ test), `src/renderer/src/lib/cueSwatches.ts` (+ test), `src/renderer/src/hooks/useCueSummaries.ts` (+ test)
- Modify: `src/main/rekordboxCues.ts` (remove `cueSummaries`, `hasGrid`), `src/main/rekordboxCuesIpc.ts` (remove `rekordbox:cueSummary`), their tests; `src/shared/types.ts` (remove `CueSummary`); `src/preload/index.ts`, `src/preload/api.ts`, `src/renderer/src/test/api.ts`, `src/scenarios/harness.tsx` (remove `rekordboxCueSummary`)
- Modify: `src/renderer/src/i18n/locales/{es,en,de,fr,pt-BR}.json` (remove `trackList.cuesUnanalysed`, `trackList.cuesNone`, `trackList.cuesPendingNone`)
- Test: `src/renderer/src/components/TrackList.test.tsx`, `src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `rowDisplay` (Task 2), `RowWave` (Task 8), `TrackItem.sourcePreview`.
- Produces: `TrackList` prop `pendingCuePaths?: ReadonlySet<string>` replacing `cueSwatches`; row testids `track-title-line` (title, `track-artist`, marks, duration, format) and `track-wave-line`.

- [ ] **Step 1: Rewrite the layout test as the failing spec of row B**

In `src/renderer/src/components/TrackList.test.tsx` add `rowWaves: vi.fn(async () => ({}))` to the local `api` object, `resetRowWaves()` (from `../lib/rowWaves`) to the `afterEach`, and replace `'puts the duration on the title line and the format under it'` with:

```ts
  it('puts title, artist, duration and format on one line and the wave under it, as rekordbox does', () => {
    renderList([
      track({
        id: 'a',
        inputPath: '/music/a.mp3',
        fileName: 'a',
        duration: 287,
        meta: { title: 'Dance 4 Me', artist: 'DJ Miguel' } as TrackMetadata,
        sourcePreview: {
          title: 'Dance 4 Me',
          artist: 'DJ Miguel',
          durationSec: 287,
          cues: [{ ms: 1000, kind: 1 }],
        },
      }),
    ])
    const line = screen.getByTestId('track-title-line')
    expect(line).toContainElement(screen.getByTestId('track-artist'))
    expect(line).toContainElement(screen.getByTestId('track-duration'))
    expect(line).toContainElement(screen.getByTestId('track-format'))
    expect(screen.getByTestId('track-artist')).toHaveTextContent('DJ Miguel')
    expect(screen.getByTestId('track-wave-line')).toContainElement(
      screen.getByTestId('track-hot-cue'),
    )
  })

  it('keeps the wave line for a row with no wave, so the list does not jump', () => {
    renderList([track({ id: 'a' })])
    expect(screen.getByTestId('track-wave-line')).toBeInTheDocument()
    expect(screen.queryByTestId('track-wave-bars')).toBeNull()
  })

  it('draws the cues of a track waiting for rekordbox hollow', () => {
    const t = track({
      id: 'a',
      inputPath: '/music/a.mp3',
      duration: 200,
      sourcePreview: { title: 'A', artist: '', durationSec: 200, cues: [{ ms: 1000, kind: 1 }] },
    })
    renderList([t], { pendingCuePaths: new Set(['/music/a.mp3']) })
    expect(screen.getByTestId('track-wave')).toHaveAttribute('data-pending', 'true')
  })
```

(`renderList` in this file takes the tracks and extra props; if its second parameter has another shape, pass `pendingCuePaths` the way that file passes other optional `TrackList` props.) Delete the tests in this file and in `App.test.tsx` that assert `track-cue-swatches` / `track-cue-swatch` / `track-cue-pending`; for each, if it asserted something the new row still owes (a pending track reads as pending, a rekordbox row shows its hot cue count), rewrite it against `track-wave` / `track-hot-cue` instead of deleting it.

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/TrackList.test.tsx`
Expected: FAIL (`track-artist`, `track-wave-line` missing).

- [ ] **Step 3: Build row B**

In `ListRow.tsx`, `CoverPlaceholder` takes `large = false` and uses `large ? 'h-12 w-12' : 'h-8 w-8'` for the box and `large ? 'h-5 w-5' : 'h-3.5 w-3.5'` for the icon.

In `TrackList.tsx`, inside the row button:

1. Cover: the `<img data-testid="track-cover">` class `h-8 w-8` becomes `h-12 w-12`; `<CoverPlaceholder testid="track-cover-placeholder" round={converting} large />`.
2. Replace the text column (`<span data-fit className="relative min-w-0 flex-1">` and everything inside it, down to its closing tag) with:

```tsx
          <span data-fit className="relative flex min-w-0 flex-1 flex-col gap-[3px]">
            <span data-testid="track-title-line" className="flex h-5 items-center gap-2">
              <span className="relative block min-w-0 flex-1 truncate">
                <span className={ROW_TITLE}>
                  <Tooltip label={rowTooltip(t, tr)} />
                  {shown.title}
                  <span data-testid="track-artist" className="font-normal text-fg-dim">
                    {` · ${shown.artist || tr('trackList.noArtist')}`}
                  </span>
                </span>
              </span>
              {MARKS}
              <span data-testid="track-duration-slot" className={`w-[44px] ${ROW_TRAILING}`}>
                {shown.duration !== undefined && (
                  <span data-testid="track-duration">{formatTime(shown.duration)}</span>
                )}
              </span>
              {FORMAT_SLOT}
            </span>
            <span data-testid="track-wave-line" className="block h-[28px]">
              {shown.waiting ? (
                <span
                  data-testid="track-loading"
                  className="skeleton-sweep mt-2 block h-2.5 w-28 rounded bg-[var(--color-panel-2)]"
                />
              ) : converting ? (
                STAGE
              ) : (
                <RowWave
                  request={{ path: t.inputPath, analysisPath: t.sourcePreview?.analysisPath }}
                  cues={t.sourcePreview?.cues ?? []}
                  durationSec={shown.duration}
                  pending={cuesPending}
                />
              )}
            </span>
          </span>
```

where `MARKS` is the old detail line's children from `{t.metaReadFailed && (` through the `{duplicate && (...)}` block, moved verbatim (only the `!t.loadingMeta && !converting` conditions that guarded the whole detail line now guard nothing: the marks show whenever their own condition holds); `FORMAT_SLOT` is the old `<span data-testid="track-format-slot" ...>…</span>`, moved verbatim; `STAGE` is the old `<span data-testid="track-stage" className="mt-0.5 block">…</span>`, moved verbatim. Write them inline, not as variables. The old `CueSwatches` element and its import go.

3. The review button sibling: `right-[58px] bottom-[5px]` becomes `right-[110px] top-[6px]` (the slot now sits on line 1, left of the 44 px duration and 46 px format slots: 10 px padding + 46 + 8 gap + 44 + 8 gap + half of the 12 px slot − half of the 24 px target). Update its comment's arithmetic to these numbers.
4. The play overlay: `h-8 w-8` becomes `h-12 w-12`, its icon `h-5 w-5`.
5. The wrapper: `[contain-intrinsic-size:auto_52px]` becomes `[contain-intrinsic-size:auto_68px]`.
6. Props: `TrackList` loses `cueSwatches?: ReadonlyMap<string, CueSwatch>` and gains `pendingCuePaths?: ReadonlySet<string>`; the row loses `cueSwatch` and gains `cuesPending: boolean`, passed as `cuesPending={pendingCuePaths?.has(t.inputPath) ?? false}`. Remove the `CueSwatch` type import.

- [ ] **Step 4: App and the removals**

`App.tsx`: delete `useCueSummaries`, `cueSwatchesOf`/`CueSwatch` imports, `rekordboxContentIds` (if nothing else reads it), `cueSummaries`, `cueSwatchesRef`, `cueSwatches`; keep `pendingCuePaths`; pass `pendingCuePaths={pendingCuePaths}` to `TrackList` instead of `cueSwatches={cueSwatches}`. `useRekordboxQueue.ts`: drop the `['rekordbox-cue-summary']` invalidation line. Delete the three renderer files and their tests. In `src/main/rekordboxCues.ts` delete `hasGrid` and `cueSummaries` and the `CueSummary` import; in `rekordboxCuesIpc.ts` delete the `rekordbox:cueSummary` handler and the `cueSummaries` import; delete their tests in `rekordboxCues.test.ts` and `rekordboxCuesIpc.test.ts`. Remove `CueSummary` from `src/shared/types.ts`, `rekordboxCueSummary` from both preload files and both stubs. Remove the three i18n keys from the 5 locale files (keep `cuesAria_*` and `cuesAriaPending_*`, which `RowWave` uses). Run `rg -n "CueSummary|cueSummar|CueSwatch|cueSwatch|cuesUnanalysed|cuesNone|cuesPendingNone" src` and expect no hits.

- [ ] **Step 5: Run the suites, types, lint**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/renderer/src/components/TrackList.test.tsx src/renderer/src/App.test.tsx src/renderer/src/components/RowWave.test.tsx src/main/rekordboxCues.test.ts src/main/rekordboxCuesIpc.test.ts src/renderer/src/i18n`
Expected: PASS (the i18n key tests included). Then the full suite once with the dot reporter into a scratch log: 0 failures. Both `tsc`, biome: clean.

- [ ] **Step 6: Look at it**

Build and open the app with the driver (`.claude/skills/run-desktop`), open a rekordbox playlist of the test copy (`rekordboxDbPath` already points at `scratchpad/rb-b/master.db`), and take a screenshot of the list next to the sketch `Debajo.dc.html`. Check: 48 px covers, `title · artist` with the artist dimmed, duration and format on the right, waves full width with A/B/C squares and orange triangles, the selected row readable, the review sparkle (when a row has one) sitting in its slot. Fix spacing only if it is visibly off; record the screenshot path in the report.

- [ ] **Step 7: Commit**

```bash
git add -A src/renderer/src src/main/rekordboxCues.ts src/main/rekordboxCues.test.ts src/main/rekordboxCuesIpc.ts src/main/rekordboxCuesIpc.test.ts src/shared/types.ts src/preload src/scenarios/harness.tsx
git commit -m "Give every list row the rekordbox-style wave with its cues and retire the cue swatches"
```

---

### Task 10: Measure against the spec's criteria

Done by the controller, not a subagent: it drives the real app against the test copy and reads Vicent's settings file.

- [ ] **Step 1: Build and check the settings guard**

Run: `npm --prefix $WT/apps/desktop run build`. Confirm `~/Library/Application Support/Electron/settings.json` has `rekordboxDbPath` under `/private/tmp/claude-501/` (the measurement script refuses otherwise). Stop the background dev app first if it is running.

- [ ] **Step 2: Measure cold and warm**

Clear Surco's analysis cache in that userData (`analysis-cache` folder) for the cold run. Run `node /private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/open-speed/measure.mjs`, adapting its "filled" condition to row B: a row is filled when it has a `track-cover` image (or a `track-cover-placeholder` for the 9 tracks without artwork), a non-empty `track-artist` and no `track-loading`. Collect, for All (999) and MDT (33): time from click to all rows filled; longest main-process stall during the open; time until the selected track's editor shows its spectrum with the cache cold; and whether any row reads as modified (`[data-dirty]` or the row's modified mark) without being touched.

- [ ] **Step 3: Compare and record**

Targets (spec "Cómo sabremos que está"): All under 0.5 s, MDT under 0.3 s, main never blocked 200 ms in a row, editor under 10 s cold, no row modified. Write the numbers with the before column (6.1 s / 133.5 s / 113 s blocked) into a new section "Medido tras el plan (fecha)" at the end of the spec, commit it as "Record the instant playlist measurements after the implementation", and report any target missed with its number, not rounded into a pass.

---

### Task 11: Cues in rekordbox's own colours

Vicent, 19/10 during execution: "fíjate que los cues salgan del mismo color que en rekordbox". This overrides spec decision 4 **for the cues of the list row only**: the wave stays `var(--color-accent)` at 70 %; hot cue squares and memory cue triangles take the colour rekordbox draws.

**Measured source of truth.** rekordbox stores a hot cue's colour as `djmdCue.ColorTableIndex` (1..62). The RGB for each index is rekordbox's colour table as documented by Deep Symmetry (beat-link `CueList.findRekordboxColor`, codes 0x01..0x3e). It agrees with Surco's own rules (`cues.py`): 1 blue `#305aff`, 22 green `#28e214`, 32 yellow `#c3af04`, 42 red `#e62828`, which Vicent saw in rekordbox after the spike. Vicent's collection (copy `rb-b`) has memory cues only with index NULL (12209) or 0 (210): rekordbox draws them red.

**Files:**
- Create: `src/shared/rekordboxCueColors.ts`, test `src/shared/rekordboxCueColors.test.ts`
- Modify: `src/shared/types.ts` (`RowCue`), `src/main/rekordboxPlaylists.ts` (cue query), `src/renderer/src/components/RowWave.tsx`
- Test: `src/main/rekordboxPlaylists.test.ts`, `src/renderer/src/components/RowWave.test.tsx`, plus every test that builds a `RowCue` literal (tsc lists them)

**Interfaces:**
- `RowCue` becomes `{ ms: number; kind: number; color: number | null }` (`color` = `ColorTableIndex`).
- `hotCueColor(index: number | null): string` and `MEMORY_CUE_COLOR` from `src/shared/rekordboxCueColors.ts`.

- [ ] **Step 1: Failing tests**

`src/shared/rekordboxCueColors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HOT_CUE_DEFAULT_COLOR, hotCueColor, MEMORY_CUE_COLOR } from './rekordboxCueColors'

describe('rekordbox cue colours', () => {
  it('paints the four countdown colours as rekordbox shows them', () => {
    expect(hotCueColor(1)).toBe('#305aff')
    expect(hotCueColor(22)).toBe('#28e214')
    expect(hotCueColor(32)).toBe('#c3af04')
    expect(hotCueColor(42)).toBe('#e62828')
  })

  it('covers rekordbox whole table, first to last', () => {
    expect(hotCueColor(2)).toBe('#5073ff')
    expect(hotCueColor(62)).toBe('#6473ff')
  })

  it('falls back to rekordbox default for a cue with no colour or an unknown index', () => {
    expect(hotCueColor(null)).toBe(HOT_CUE_DEFAULT_COLOR)
    expect(hotCueColor(0)).toBe(HOT_CUE_DEFAULT_COLOR)
    expect(hotCueColor(63)).toBe(HOT_CUE_DEFAULT_COLOR)
  })

  it('draws memory cues red, as rekordbox does', () => {
    expect(MEMORY_CUE_COLOR).toBe('#e62828')
  })
})
```

In `src/main/rekordboxPlaylists.test.ts` (`readRekordboxPlaylistWithPreview` describe), the expected `cues` become:

```ts
      cues: [
        { ms: 1000, kind: 1, color: 1 },
        { ms: 32000, kind: 0, color: null },
        { ms: 64000, kind: 2, color: 22 },
      ],
```

In `src/renderer/src/components/RowWave.test.tsx` give every cue a `color` (`{ ms: 0, kind: 1, color: 42 }`, `{ ms: 32000, kind: 0, color: null }`, `{ ms: 64000, kind: 2, color: 22 }`) and add:

```tsx
  it('paints each cue in the colour rekordbox gives it', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending={false} />)
    const [a, b] = screen.getAllByTestId('track-hot-cue')
    expect(a).toHaveStyle({ backgroundColor: '#e62828' })
    expect(b).toHaveStyle({ backgroundColor: '#28e214' })
    expect(screen.getByTestId('track-memory-cue')).toHaveStyle({ borderTopColor: '#e62828' })
  })

  it('keeps a waiting cue hollow in its own colour', () => {
    render(<RowWave request={request} cues={cues} durationSec={128} pending />)
    const [a] = screen.getAllByTestId('track-hot-cue')
    expect(a).toHaveStyle({ borderColor: '#e62828', color: '#e62828' })
  })
```

(jsdom normalises hex to `rgb(...)` in computed styles; `toHaveStyle` with hex compares equivalently. If it does not in this setup, assert the `style` attribute instead.)

- [ ] **Step 2: Run them, see them fail**

Run: `npm --prefix $WT/apps/desktop exec -- vitest run --root $WT/apps/desktop src/shared/rekordboxCueColors.test.ts src/main/rekordboxPlaylists.test.ts src/renderer/src/components/RowWave.test.tsx`

- [ ] **Step 3: Implement**

`src/shared/rekordboxCueColors.ts`:

```ts
const TABLE = [
  '#305aff', '#5073ff', '#508cff', '#50a0ff', '#50b4ff', '#50b0f2', '#50aee8', '#45acdb',
  '#00e0ff', '#19daf0', '#32d2e6', '#21b4b9', '#20aaa0', '#1fa392', '#19a08c', '#14a584',
  '#14aa7d', '#10b176', '#30d26e', '#37de5a', '#3ceb50', '#28e214', '#7dc13d', '#8cc832',
  '#9bd723', '#a5e116', '#a5dc0a', '#aad208', '#b4c805', '#b4be04', '#bab404', '#c3af04',
  '#e1aa00', '#ffa000', '#ff9600', '#ff8c00', '#ff7500', '#e0641b', '#e0461e', '#e0301e',
  '#e02823', '#e62828', '#ff376f', '#ff2d6f', '#ff127b', '#f51e8c', '#eb2da0', '#e637b4',
  '#de44cf', '#de448d', '#e630b4', '#e619dc', '#e600ff', '#dc00ff', '#cc00ff', '#b432ff',
  '#b93cff', '#c542ff', '#aa5aff', '#aa72ff', '#8272ff', '#6473ff',
]

export const HOT_CUE_DEFAULT_COLOR = '#28e214'
export const MEMORY_CUE_COLOR = '#e62828'

export function hotCueColor(index: number | null): string {
  return (index !== null && index >= 1 ? TABLE[index - 1] : undefined) ?? HOT_CUE_DEFAULT_COLOR
}
```

(Index n is `TABLE[n - 1]`: the table holds codes 0x01..0x3e in order. Biome will reflow the array; that is fine.)

`src/shared/types.ts`: `RowCue` gains `color: number | null`.

`src/main/rekordboxPlaylists.ts`: the cue query selects `ColorTableIndex` too (`SELECT ContentID AS contentId, InMsec, Kind, ColorTableIndex FROM djmdCue ...`), `CueRow` gains `ColorTableIndex: number | null`, and the push becomes `list.push({ ms: c.InMsec, kind: c.Kind, color: c.ColorTableIndex })`.

`src/renderer/src/components/RowWave.tsx`:
- memory triangle: drop `border-t-[var(--color-warn)]` from the class and add `borderTopColor: MEMORY_CUE_COLOR` to its `style`.
- hot square: the colour moves from classes to `style`. Not pending: `style={{ left: …, backgroundColor: colour, color: '#000' }}` and no colour classes; pending: `style={{ left: …, borderColor: colour, color: colour }}` with the `border` class kept. `colour = hotCueColor(c.color)`.
- The wave keeps `fill-[var(--color-accent)] opacity-70`.

Update every other test that builds a `RowCue` literal to carry `color` (tsc names them; use `color: null` where the colour does not matter).

- [ ] **Step 4: Run tests, types, lint**

The three files above, plus `src/renderer/src/components/TrackList.test.tsx`, `src/renderer/src/hooks/useTrackLibraryPlaylist.test.tsx`, `src/renderer/src/lib/rowDisplay.test.ts`, `src/renderer/src/App.test.tsx`: PASS. Both `tsc`, `npm --prefix $WT/apps/desktop run check`: clean, `git status` only your files.

- [ ] **Step 5: Look at it**

Build (`npm --prefix $WT/apps/desktop run build`) and, with the run-desktop driver as Task 9 did, open the House playlist of the test copy and screenshot the list at 560 px into `/private/tmp/claude-501/-Users-vicent-code-surco/60b03f2f-5add-4da8-8475-3fe0dd5d1e8d/scratchpad/row-b/cue-colours.png`. The cues should read blue A, green B, red C (Surco's countdown rows) and red memory triangles.

- [ ] **Step 6: Commit**

```bash
git add src/shared/rekordboxCueColors.ts src/shared/rekordboxCueColors.test.ts src/shared/types.ts src/main/rekordboxPlaylists.ts src/main/rekordboxPlaylists.test.ts src/renderer/src/components/RowWave.tsx src/renderer/src/components/RowWave.test.tsx <other tests you touched>
git commit -m "Paint the list's cues in the colours rekordbox gives them"
```
