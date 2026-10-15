# Review metadata by open source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The list's "…" menu "Revisar metadatos" acts on what the source rail has open (the working list, an Apple Music playlist written through Apple Music, or a rekordbox playlist written through its files), a Music playlist also offers "Mostrar duplicados" across the whole library, each item says in a second line what it touches, and the two Apple Music review items leave the File menu.

**Architecture:** One pure function (`lib/reviewTarget.ts`) turns the open source, playlist and rows into a `ReviewTarget` (what would be reviewed, how many tracks, where it writes) and a `ReviewOpening` (the review state App keeps while the panel is open). The Music review stays one AppleScript dump of the whole library, narrowed in the renderer by the open playlist's persistent IDs (`scopedMusicSource`); the list review gets the open playlist's paths and filters its rows by them. The opening is frozen in App's `review` state, so the panel keeps the scope the menu announced until it is closed.

**Tech Stack:** Electron + React 19 + TS, i18next, lucide-react, vitest + Testing Library (jsdom), biome.

**Spec:** the request approved by Vicent from the "Revisar" sketch on 15/10 (memory `fuentes-dj-playlists.md`, "15/10 noche"): Pistas = list review (files); Music + playlist = those tracks in Apple Music + "Mostrar duplicados" across the library; rekordbox + playlist = those tracks (files); the two Music commands leave the File menu. It builds on phase 1 and 2a of `docs/superpowers/specs/2026-10-15-fuentes-dj-playlists-design.md` and runs after Task 10 of `docs/superpowers/plans/2026-10-15-fuentes-dj-fase-2a.md`.

**Concurrent work:** another session is editing `App.tsx`, `App.test.tsx`, `TrackList.tsx` and the locale files in this worktree while this plan is written. Line numbers in `App.tsx` drift; every App edit below is anchored on code text, never on a line number. Start Task 4 only once that work is committed (`git status` clean for `App.tsx` and `App.test.tsx`).

**Out of scope:** the review panel's own scope line (`listReview.scope`, "70 tracks in the list") keeps saying "in the list" for a rekordbox playlist; renaming it is a separate change. No new AppleScript and no new IPC.

## Global Constraints

- Tests from `apps/desktop` of the worktree: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run <path>` (the worktree has no `node_modules` of its own; never filter from the repo root, it skips the setup). Types from the worktree root: `npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit` and `npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit` (bare `tsc` checks nothing). Lint and format: `npm exec --workspace apps/desktop -- biome check --write src`.
- UI text in the 5 locales (`es`, `en`, `de`, `fr`, `pt-BR`); no em dash and no explanatory colons in any UI text. Every count string has `_zero`, `_one` and `_other`: i18next sends 0 to `_other` in es/en and to `_one` in fr/pt-BR, and a `_zero` key wins over both in every language (the repo already uses `_zero`, e.g. `trimApplied_zero`).
- Locale keys must appear literally in source (`usedKeys.test.ts` strips the plural suffix and looks for the bare key), so the code calls `tr('header.menu.scope.list', { count })`, never a key built from a variable.
- Test selectors: `data-testid` always.
- Comments: the repo documents the WHY in comments on nearly every block (see `reviewSource.ts`, `listReviewSource.ts`). Follow that repo convention, which conflicts with the global "zero comments" rule: conformance with the existing code wins (ruled by the coordinator on 15/10), flagged here so nobody "fixes" it.
- Apple Music exists only on macOS: the Music items appear only when the open source is `appleMusic`, which `useSourceBrowser` only offers on `darwin`. Nothing here adds a platform check of its own.
- The renderer locale strings are merged with this helper (run from `apps/desktop`; `$SCRATCH` is the session scratchpad). Write it once:

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

(Measured on 15/10: the five locale files round-trip byte for byte through `JSON.stringify(data, null, 2) + '\n'`.)

- Commits: descriptive English title, no body, no `feat:`. One per task.

## Decisions taken where the request left room

1. **The Music playlist is scoped in the renderer, not by a new AppleScript.** `loadMusicReview()` keeps dumping every file track of the library (one bulk read, `buildReviewDumpScript`), and `scopedMusicSource` keeps the entries whose persistent ID the open playlist carries (`SourcePlaylistEntry.musicPersistentId`, filled by phase 1's `musicEntries`). "Mostrar duplicados" needs the whole library anyway to find the other copies, so a playlist-only script would only serve "Revisar metadatos", and it would be a second dump to keep in step with the first. Both dumps read `file track`s, so every playlist track with a persistent ID is in the library dump.
2. **"Mostrar duplicados" keeps whole recordings.** Its entries are the playlist's tracks plus every library entry with the same `recordingKey` as one of them. Keeping the whole bucket means the hook builds exactly the groups (and the `key#minId` keys) the whole-library review builds for those tracks, so a group ignored there stays ignored here. The playlist's own tracks stay in even without copies, so a playlist with no duplicates opens on "Todo en orden" and not on `musicReview.empty` ("Your Apple Music library is empty").
3. **The review keeps the scope it opened with.** Picking another playlist or source while the panel is open does not reload or close it: the menu said what it would touch, and closing would throw away choices already staged. The opening (paths or persistent IDs) lives in App's `review` state, and the source is rebuilt only when that opening changes.
4. **A target with 0 tracks opens nothing.** The items show disabled with a `_zero` line ("«Viernes» no tiene pistas que revisar"), and the palette command does nothing, so a Music playlist of streaming rows only never opens a review that says the library is empty.
5. **The menu's counts are what the review loads.** Music counts distinct persistent IDs in the open playlist (what `scopeMusicEntries` keeps), not `node.count` (which includes streaming rows) nor the list rows. rekordbox counts the playlist rows the list shows, which are the rows the list review reads; rows it cannot read are reported by the review's own scope line as today.
6. **Command palette:** `list-review` ("Revisar metadatos…", also the Tracks menu item and its shortcut) follows the open source exactly like the "…" item. `music-review` and `music-duplicates` stay in the palette as the whole-library commands they are today ("Revisar metadatos en Apple Music…", "Mostrar duplicados en Apple Music…"). Reason: the whole library has to stay reachable, and whether Music's "Música" playlist reaches the rail could not be checked here (`every user playlist` is what the rail reads; it is not verified to include the special-kind "Music" playlist). Keeping them also keeps the ~20 App tests that open the Music review with `runMenu('music-review')` valid. Only the File menu items and their main-process strings go.
7. **Empty screen:** the two Apple Music buttons (`EmptyActions`, `empty-music-review`, `empty-music-duplicates`) stay as whole-library reviews. With an empty list no source is open, so there is nothing to scope to, and the hints already say they act on the library. Opening the rail instead would replace one click with three and hide the duplicates search.
8. **The "Música" node is not special-cased.** Opened from the rail, it reviews its own tracks like any playlist, which is the whole library except a second entry pointing at the same file (`parsePlaylistTracks` dedupes by path, measured 1 in 982). "Mostrar duplicados" from it finds those too, through the same recording key. The exact whole-library review stays in the palette and on the empty screen (decision 6).
9. **The import notice's "Revisar" stays a whole-list review** (`useListReviewNotice` keeps `openListReview`): it is about the files just imported, not about the open playlist.
10. **Every "…" item gets `aria-label={label}`** and the second line is its `aria-describedby`, so the item is still named "Review metadata" (an App test pins that name) and the line is read as its description.

## Review Focus

1. **Duplicates of a playlist need the whole library**: copies outside the playlist show, copies of tracks not in it do not, and the groups and keys equal the whole-library ones (ignored groups stay ignored). Pinned in Task 1 (`scopeMusicEntries` against `duplicateGroups` of the whole library) and Task 4 (App, "Gold" shown, "Lead" not).
2. **Picking another playlist while the review is open**: the panel keeps the playlist it opened on and does not reload. Pinned in Task 4 (rekordbox, scope line still "2 tracks" after picking another playlist, then the palette opens on the new one).
3. **A Music playlist whose tracks have no file (streaming only), or one still loading**: count 0 or no playlist rows yet; the items say so and stay disabled, the palette opens nothing, and while entries load the target is the rows shown (the working list). Pinned in Task 2 (`reviewTarget`, `reviewOpening`) and Task 3 (disabled duplicates item).
4. **Ignore lists**: the scoped Music review saves to `musicReviewIgnored` and the scoped list review to `listReviewIgnored`, exactly as before, because `review.source` still picks the list. Pinned by Task 1's key equality and left on the existing App tests of ignoring (they run unchanged).
5. **Counts in the second line match what the review loads**: distinct persistent IDs, file-less rows and repeated IDs not counted, plural forms right in all five locales and at 0. Pinned in Task 2 (en and es literals, `_zero`) and Task 4 (App, "The 2 tracks in “Friday”" and a review of exactly those two).

---

## File structure

| File | Responsibility |
|---|---|
| `src/renderer/src/lib/reviewSource.ts` (modify) | `MusicScopeMode`, `scopeMusicEntries`, `scopedMusicSource`: the Music review narrowed to a playlist |
| `src/renderer/src/lib/reviewTarget.ts` (create) | `ReviewTarget`, `ReviewOpening`, `reviewTarget`, `reviewOpening`, `reviewDetail`, `duplicatesDetail`: what the open source would review and the words for it |
| `src/renderer/src/components/TrackListHeader.tsx` (modify) | second line under menu items, "Mostrar duplicados" item |
| `src/renderer/src/App.tsx` (modify) | review state holds the opening; one source per opening; header and palette open the target |
| `src/main/appMenu.ts`, `src/main/i18n.ts` (modify) | File menu without the Music review; Tracks menu label without "de la lista" |
| `src/renderer/src/i18n/locales/*.json` (modify) | `header.menu.scope.*`, `header.menu.showDuplicates`, `commands.listReview` |
| `apps/web/src/i18n/locales/{es,en}.json` (modify) | the guide stops sending people to the File menu |

Paths below are relative to `apps/desktop` unless they start with `apps/`.

---

### Task 1: Narrow the Music review to a playlist

**Files:**
- Modify: `src/renderer/src/lib/reviewSource.ts` (after `musicSource`)
- Test: `src/renderer/src/lib/reviewSource.test.ts`

**Interfaces:**
- Consumes: `musicSource` (same file), `recordingKey(artist: string, title: string): string | null` from `./duplicates`.
- Produces:
  - `type MusicScopeMode = 'tracks' | 'duplicates'`
  - `scopeMusicEntries(entries: ReviewEntry[], ids: ReadonlySet<string>, mode: MusicScopeMode): ReviewEntry[]`
  - `scopedMusicSource(ids: ReadonlySet<string>, mode: MusicScopeMode): ReviewSource` (kind `'music'`)

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/lib/reviewSource.test.ts`, and extend its imports to:

```ts
import type { ReviewEntry } from '../../../shared/types'
import { duplicateGroups } from './duplicates'
import { musicSource, scopedMusicSource, scopeMusicEntries } from './reviewSource'
```

```ts
const entry = (id: string, artist: string, title: string, durationSec?: number): ReviewEntry => ({
  id,
  artist,
  title,
  albumArtist: '',
  album: '',
  genre: '',
  ...(durationSec !== undefined && { durationSec }),
})
const library = [
  entry('01', 'DJ Lara', 'Gold', 300),
  entry('02', 'DJ Lara', 'Gold', 301),
  entry('03', 'DJ Lara', 'Gold', 420),
  entry('04', 'Dj Lara', 'Iron'),
  entry('05', 'Ana', 'Copper'),
  entry('06', 'Bo', 'Lead'),
  entry('07', 'Bo', 'Lead'),
]
const playlist = new Set(['01', '05'])
const toItem = (e: ReviewEntry) => ({
  id: e.id,
  artist: e.artist,
  title: e.title,
  durationSec: e.durationSec,
})

describe('scopeMusicEntries', () => {
  // Reviewing a playlist is about that playlist: a misspelling elsewhere in the library is
  // not what the DJ opened it for, and fixing it would touch tracks they did not pick.
  it('keeps only the playlist tracks when reviewing its metadata', () => {
    expect(scopeMusicEntries(library, playlist, 'tracks').map((e) => e.id)).toEqual(['01', '05'])
  })

  // The copy worth deleting usually sits outside the playlist, so a playlist's duplicates
  // are looked for in the whole library; the playlist's own tracks stay so a playlist
  // without copies opens on "all clear", not on "your library is empty".
  it('adds every library entry of the same recording as a playlist track when showing duplicates', () => {
    expect(scopeMusicEntries(library, playlist, 'duplicates').map((e) => e.id)).toEqual([
      '01',
      '02',
      '03',
      '05',
    ])
  })

  // A group the user ignored in a whole-library review is remembered by a key built from its
  // members; cutting a recording short would give the group a new key and bring it back.
  it('builds for the playlist tracks the same duplicate groups, keys included, as the whole library', () => {
    const whole = duplicateGroups(library.map(toItem))
    const scoped = duplicateGroups(scopeMusicEntries(library, playlist, 'duplicates').map(toItem))
    expect(scoped).toEqual(whole.filter((g) => g.ids.some((id) => playlist.has(id))))
    expect(scoped.flatMap((g) => g.ids)).not.toContain('06')
  })
})

describe('scopedMusicSource', () => {
  // One dump of the library, as the whole-library review reads it, then narrowed here: no
  // second AppleScript to keep in step.
  it('reads the library once and hands the review only the scoped entries', async () => {
    const loadMusicReview = vi
      .fn()
      .mockResolvedValue(library.map(({ id, ...rest }) => ({ persistentId: id, ...rest })))
    setApi({ loadMusicReview })
    const source = scopedMusicSource(playlist, 'tracks')
    const loaded = await source.load()
    expect(loaded.entries.map((e) => e.id)).toEqual(['01', '05'])
    expect(loadMusicReview).toHaveBeenCalledTimes(1)
    expect(loadMusicReview).toHaveBeenCalledWith()
  })

  // Everything but the read is the Music review as it was: the fixes still go to Music.
  it('writes to Music exactly as the whole-library review does', () => {
    const source = scopedMusicSource(playlist, 'duplicates')
    expect(source.kind).toBe('music')
    expect(source.applyFixes).toBe(musicSource.applyFixes)
    expect(source.removeCopies).toBe(musicSource.removeCopies)
    expect(source.revertMusic).toBe(musicSource.revertMusic)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/reviewSource.test.ts`
Expected: FAIL, `scopeMusicEntries` / `scopedMusicSource` are not exported.

- [ ] **Step 3: Write the implementation**

In `src/renderer/src/lib/reviewSource.ts` add `import { recordingKey } from './duplicates'` to the imports and append after `musicSource`:

```ts
// What a review opened from a Music playlist reads. 'tracks' is the playlist's own entries;
// 'duplicates' adds every library entry of the same recording as one of them, because the
// copy to delete usually sits outside the playlist. A recording is kept whole, never part
// of it, so each group comes out with the members, and so the key, the whole library gives
// it: a group ignored there stays ignored here.
export type MusicScopeMode = 'tracks' | 'duplicates'

export function scopeMusicEntries(
  entries: ReviewEntry[],
  ids: ReadonlySet<string>,
  mode: MusicScopeMode,
): ReviewEntry[] {
  if (mode === 'tracks') return entries.filter((e) => ids.has(e.id))
  const keys = new Set<string>()
  for (const e of entries) {
    const key = ids.has(e.id) ? recordingKey(e.artist, e.title) : null
    if (key) keys.add(key)
  }
  return entries.filter((e) => {
    if (ids.has(e.id)) return true
    const key = recordingKey(e.artist, e.title)
    return key !== null && keys.has(key)
  })
}

// Music answers for the whole library in one bulk dump, and the duplicates of a playlist
// need that whole library anyway, so the dump is read as before and narrowed here instead of
// a second AppleScript that reads one playlist. Everything else is the library review.
export function scopedMusicSource(ids: ReadonlySet<string>, mode: MusicScopeMode): ReviewSource {
  return {
    ...musicSource,
    load: async () => {
      const loaded = await musicSource.load()
      return { ...loaded, entries: scopeMusicEntries(loaded.entries, ids, mode) }
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/reviewSource.test.ts`
Expected: PASS.

Then mutate to prove the key test bites: in `scopeMusicEntries` change the `duplicates` branch to `return entries.filter((e) => ids.has(e.id) || (keys.has(recordingKey(e.artist, e.title) ?? '') && e.durationSec !== 420))`, run again, expect the "same duplicate groups" test to FAIL (the version group loses `03`), then revert.

- [ ] **Step 5: Lint, types, commit**

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/renderer/src/lib/reviewSource.ts apps/desktop/src/renderer/src/lib/reviewSource.test.ts
git commit -m "Narrow the Apple Music review to a playlist's tracks or their copies in the library"
```

---

### Task 2: What the open source would review, and the line that says it

**Files:**
- Create: `src/renderer/src/lib/reviewTarget.ts`
- Test: `src/renderer/src/lib/reviewTarget.test.ts`
- Modify: the 5 renderer locales (`header.menu.scope`, `header.menu.showDuplicates`)

**Interfaces:**
- Consumes: `MusicScopeMode` (Task 1); `ReviewFilter` from `../hooks/useMusicReview` (type only); `PlaylistSource`, `SourcePlaylistEntry` from `shared/types`; `TrackItem`.
- Produces:
  - `type ReviewTarget = { kind: 'list'; count: number } | { kind: 'playlist'; name: string; paths: ReadonlySet<string>; count: number } | { kind: 'music'; name: string; ids: ReadonlySet<string>; count: number }`
  - `type ReviewOpening = { source: 'list'; filter: ReviewFilter; paths?: ReadonlySet<string> } | { source: 'music'; filter: ReviewFilter; scope?: { ids: ReadonlySet<string>; mode: MusicScopeMode } }`
  - `reviewTarget(input: { source: PlaylistSource | null; playlistName: string | null; entries: SourcePlaylistEntry[] | undefined; playlistTracks: TrackItem[] | null; workingCount: number }): ReviewTarget`
  - `reviewOpening(target: ReviewTarget, filter: 'all' | 'duplicates'): ReviewOpening | null`
  - `reviewDetail(tr: TFunction, target: ReviewTarget): string`
  - `duplicatesDetail(tr: TFunction, name: string): string`

- [ ] **Step 1: Locale strings**

Write `$SCRATCH/i18n-review-scope.json` and merge it, from `apps/desktop`:

```bash
cat > "$SCRATCH/i18n-review-scope.json" <<'EOF'
{
  "es": { "header": { "menu": {
    "showDuplicates": "Mostrar duplicados",
    "scope": {
      "list_zero": "La lista está vacía",
      "list_one": "La única pista de la lista. Cambia el fichero",
      "list_other": "Las {{count}} pistas de la lista. Cambia los ficheros",
      "playlistFiles_zero": "«{{name}}» no tiene pistas que revisar",
      "playlistFiles_one": "La única pista de «{{name}}». Cambia el fichero",
      "playlistFiles_other": "Las {{count}} pistas de «{{name}}». Cambia los ficheros",
      "playlistMusic_zero": "«{{name}}» no tiene pistas que revisar",
      "playlistMusic_one": "La única pista de «{{name}}». Cambia Apple Music",
      "playlistMusic_other": "Las {{count}} pistas de «{{name}}». Cambia Apple Music",
      "duplicates": "De «{{name}}» en toda tu biblioteca de Music"
    } } } },
  "en": { "header": { "menu": {
    "showDuplicates": "Show duplicates",
    "scope": {
      "list_zero": "The list is empty",
      "list_one": "The only track in the list. Changes the file",
      "list_other": "The {{count}} tracks in the list. Changes the files",
      "playlistFiles_zero": "“{{name}}” has no tracks to review",
      "playlistFiles_one": "The only track in “{{name}}”. Changes the file",
      "playlistFiles_other": "The {{count}} tracks in “{{name}}”. Changes the files",
      "playlistMusic_zero": "“{{name}}” has no tracks to review",
      "playlistMusic_one": "The only track in “{{name}}”. Changes Apple Music",
      "playlistMusic_other": "The {{count}} tracks in “{{name}}”. Changes Apple Music",
      "duplicates": "From “{{name}}” across your whole Music library"
    } } } },
  "de": { "header": { "menu": {
    "showDuplicates": "Duplikate anzeigen",
    "scope": {
      "list_zero": "Die Liste ist leer",
      "list_one": "Der einzige Track der Liste. Ändert die Datei",
      "list_other": "Die {{count}} Tracks der Liste. Ändert die Dateien",
      "playlistFiles_zero": "„{{name}}“ hat keine Tracks zum Prüfen",
      "playlistFiles_one": "Der einzige Track aus „{{name}}“. Ändert die Datei",
      "playlistFiles_other": "Die {{count}} Tracks aus „{{name}}“. Ändert die Dateien",
      "playlistMusic_zero": "„{{name}}“ hat keine Tracks zum Prüfen",
      "playlistMusic_one": "Der einzige Track aus „{{name}}“. Ändert Apple Music",
      "playlistMusic_other": "Die {{count}} Tracks aus „{{name}}“. Ändert Apple Music",
      "duplicates": "Aus „{{name}}“ in deiner ganzen Music-Mediathek"
    } } } },
  "fr": { "header": { "menu": {
    "showDuplicates": "Afficher les doublons",
    "scope": {
      "list_zero": "La liste est vide",
      "list_one": "Le seul morceau de la liste. Modifie le fichier",
      "list_other": "Les {{count}} morceaux de la liste. Modifie les fichiers",
      "playlistFiles_zero": "« {{name}} » n'a aucun morceau à vérifier",
      "playlistFiles_one": "Le seul morceau de « {{name}} ». Modifie le fichier",
      "playlistFiles_other": "Les {{count}} morceaux de « {{name}} ». Modifie les fichiers",
      "playlistMusic_zero": "« {{name}} » n'a aucun morceau à vérifier",
      "playlistMusic_one": "Le seul morceau de « {{name}} ». Modifie Apple Music",
      "playlistMusic_other": "Les {{count}} morceaux de « {{name}} ». Modifie Apple Music",
      "duplicates": "De « {{name}} » dans toute ta bibliothèque Music"
    } } } },
  "pt-BR": { "header": { "menu": {
    "showDuplicates": "Mostrar duplicados",
    "scope": {
      "list_zero": "A lista está vazia",
      "list_one": "A única faixa da lista. Altera o arquivo",
      "list_other": "As {{count}} faixas da lista. Altera os arquivos",
      "playlistFiles_zero": "“{{name}}” não tem faixas para revisar",
      "playlistFiles_one": "A única faixa de “{{name}}”. Altera o arquivo",
      "playlistFiles_other": "As {{count}} faixas de “{{name}}”. Altera os arquivos",
      "playlistMusic_zero": "“{{name}}” não tem faixas para revisar",
      "playlistMusic_one": "A única faixa de “{{name}}”. Altera o Apple Music",
      "playlistMusic_other": "As {{count}} faixas de “{{name}}”. Altera o Apple Music",
      "duplicates": "De “{{name}}” em toda a sua biblioteca do Music"
    } } } }
}
EOF
node "$SCRATCH/merge-locale.cjs" "$SCRATCH/i18n-review-scope.json"
git diff --stat src/renderer/src/i18n/locales
```

Expected: five files, about 11 lines added each, nothing else changed.

- [ ] **Step 2: Write the failing tests**

Create `src/renderer/src/lib/reviewTarget.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { duplicatesDetail, reviewDetail, reviewOpening, reviewTarget } from './reviewTarget'

const row = (inputPath: string) => ({ inputPath }) as TrackItem
const music = (path: string | null, musicPersistentId?: string): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta: {},
  ...(musicPersistentId && { musicPersistentId }),
})
const tr = i18n.t.bind(i18n)

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('reviewTarget', () => {
  // No source open is the working list, the review as it always was.
  it('is the working list when no playlist is open', () => {
    expect(
      reviewTarget({
        source: null,
        playlistName: null,
        entries: undefined,
        playlistTracks: null,
        workingCount: 71,
      }),
    ).toEqual({ kind: 'list', count: 71 })
  })

  // A click acts on the rows shown: until the picked playlist's rows arrive the list still
  // shows the working list, and so that is what a review would read.
  it('is the working list while the picked playlist is still loading', () => {
    expect(
      reviewTarget({
        source: 'appleMusic',
        playlistName: '2K',
        entries: undefined,
        playlistTracks: null,
        workingCount: 5,
      }),
    ).toEqual({ kind: 'list', count: 5 })
  })

  // rekordbox has no review of its own: its playlist is reviewed through the files, the rows
  // the list shows for it.
  it('is the rows of an open rekordbox playlist, by path', () => {
    expect(
      reviewTarget({
        source: 'rekordbox',
        playlistName: 'Factory',
        entries: [],
        playlistTracks: [row('/m/a.wav'), row('/m/b.wav')],
        workingCount: 9,
      }),
    ).toEqual({ kind: 'playlist', name: 'Factory', paths: new Set(['/m/a.wav', '/m/b.wav']), count: 2 })
  })

  // The count is what the Music review will load: one per Music entry, so a row with no file
  // (streaming) or an ID seen twice does not inflate it.
  it('is the distinct Music persistent IDs of an open Music playlist', () => {
    expect(
      reviewTarget({
        source: 'appleMusic',
        playlistName: '2K',
        entries: [music('/m/a.wav', 'A1'), music('/m/b.wav', 'B1'), music(null), music('/m/c.wav', 'A1')],
        playlistTracks: [row('/m/a.wav'), row('/m/b.wav'), row('/m/c.wav')],
        workingCount: 9,
      }),
    ).toEqual({ kind: 'music', name: '2K', ids: new Set(['A1', 'B1']), count: 2 })
  })
})

describe('reviewOpening', () => {
  const musicTarget = { kind: 'music' as const, name: '2K', ids: new Set(['A1']), count: 1 }

  it('opens the Music review on the playlist tracks, or on their copies for duplicates', () => {
    expect(reviewOpening(musicTarget, 'all')).toEqual({
      source: 'music',
      filter: 'all',
      scope: { ids: musicTarget.ids, mode: 'tracks' },
    })
    expect(reviewOpening(musicTarget, 'duplicates')).toEqual({
      source: 'music',
      filter: 'duplicates',
      scope: { ids: musicTarget.ids, mode: 'duplicates' },
    })
  })

  it('opens the list review on the playlist paths, or on the whole list', () => {
    const paths = new Set(['/m/a.wav'])
    expect(reviewOpening({ kind: 'playlist', name: 'F', paths, count: 1 }, 'all')).toEqual({
      source: 'list',
      filter: 'all',
      paths,
    })
    expect(reviewOpening({ kind: 'list', count: 3 }, 'all')).toEqual({ source: 'list', filter: 'all' })
  })

  // A playlist of streaming rows only has nothing to review; opening anyway would show the
  // Music review's "your library is empty", which is false.
  it('opens nothing for a target with no tracks', () => {
    expect(reviewOpening({ ...musicTarget, ids: new Set(), count: 0 }, 'all')).toBeNull()
    expect(reviewOpening({ kind: 'list', count: 0 }, 'all')).toBeNull()
  })
})

describe('reviewDetail', () => {
  it('says what each target touches and where it writes', () => {
    expect(reviewDetail(tr, { kind: 'list', count: 71 })).toBe(
      'The 71 tracks in the list. Changes the files',
    )
    expect(reviewDetail(tr, { kind: 'list', count: 1 })).toBe(
      'The only track in the list. Changes the file',
    )
    expect(
      reviewDetail(tr, { kind: 'playlist', name: 'Factory', paths: new Set(), count: 70 }),
    ).toBe('The 70 tracks in “Factory”. Changes the files')
    expect(reviewDetail(tr, { kind: 'music', name: '2K', ids: new Set(), count: 406 })).toBe(
      'The 406 tracks in “2K”. Changes Apple Music',
    )
    expect(duplicatesDetail(tr, '2K')).toBe('From “2K” across your whole Music library')
  })

  // English sends 0 to _other: without _zero the disabled item would read "The 0 tracks".
  it('says a playlist has nothing to review instead of counting zero tracks', () => {
    expect(reviewDetail(tr, { kind: 'music', name: '2K', ids: new Set(), count: 0 })).toBe(
      '“2K” has no tracks to review',
    )
  })

  // The wording Vicent approved on the sketch.
  it('reads in Spanish as approved', async () => {
    await i18n.changeLanguage('es')
    expect(reviewDetail(tr, { kind: 'music', name: '2K', ids: new Set(), count: 406 })).toBe(
      'Las 406 pistas de «2K». Cambia Apple Music',
    )
    expect(
      reviewDetail(tr, { kind: 'playlist', name: 'Factory', paths: new Set(), count: 70 }),
    ).toBe('Las 70 pistas de «Factory». Cambia los ficheros')
    expect(duplicatesDetail(tr, '2K')).toBe('De «2K» en toda tu biblioteca de Music')
    expect(reviewDetail(tr, { kind: 'list', count: 71 })).toBe(
      'Las 71 pistas de la lista. Cambia los ficheros',
    )
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/reviewTarget.test.ts`
Expected: FAIL, cannot resolve `./reviewTarget`.

- [ ] **Step 4: Write the implementation**

Create `src/renderer/src/lib/reviewTarget.ts`:

```ts
import type { TFunction } from 'i18next'
import type { PlaylistSource, SourcePlaylistEntry } from '../../../shared/types'
import type { ReviewFilter } from '../hooks/useMusicReview'
import type { TrackItem } from '../types'
import type { MusicScopeMode } from './reviewSource'

// What "Revisar metadatos" would read with the source rail as it is: the working list, the
// rows of an open rekordbox playlist (reviewed through their files), or the entries of an
// open Music playlist (reviewed in Apple Music). The count is what that review loads.
export type ReviewTarget =
  | { kind: 'list'; count: number }
  | { kind: 'playlist'; name: string; paths: ReadonlySet<string>; count: number }
  | { kind: 'music'; name: string; ids: ReadonlySet<string>; count: number }

// The review App keeps open: which engine, which filter it opened on, and the rows it was
// opened for. No paths is the whole working list; no scope is the whole Music library.
export type ReviewOpening =
  | { source: 'list'; filter: ReviewFilter; paths?: ReadonlySet<string> }
  | {
      source: 'music'
      filter: ReviewFilter
      scope?: { ids: ReadonlySet<string>; mode: MusicScopeMode }
    }

// playlistTracks is the open playlist's rows once they are applied (App's playlistScope):
// until then the list shows the working list, and a click acts on the rows shown.
export function reviewTarget({
  source,
  playlistName,
  entries,
  playlistTracks,
  workingCount,
}: {
  source: PlaylistSource | null
  playlistName: string | null
  entries: SourcePlaylistEntry[] | undefined
  playlistTracks: TrackItem[] | null
  workingCount: number
}): ReviewTarget {
  if (!playlistTracks || playlistName === null) return { kind: 'list', count: workingCount }
  if (source === 'appleMusic') {
    // One per Music entry: a row with no file has no ID and the Music review never sees it.
    const ids = new Set(
      (entries ?? []).flatMap((e) => (e.musicPersistentId ? [e.musicPersistentId] : [])),
    )
    return { kind: 'music', name: playlistName, ids, count: ids.size }
  }
  return {
    kind: 'playlist',
    name: playlistName,
    paths: new Set(playlistTracks.map((t) => t.inputPath)),
    count: playlistTracks.length,
  }
}

// Null when there is nothing to review: opening anyway would show the review's empty state,
// which for Music says the whole library is empty.
export function reviewOpening(
  target: ReviewTarget,
  filter: 'all' | 'duplicates',
): ReviewOpening | null {
  if (target.count === 0) return null
  if (target.kind === 'music')
    return {
      source: 'music',
      filter,
      scope: { ids: target.ids, mode: filter === 'duplicates' ? 'duplicates' : 'tracks' },
    }
  return target.kind === 'playlist'
    ? { source: 'list', filter, paths: target.paths }
    : { source: 'list', filter }
}

export function reviewDetail(tr: TFunction, target: ReviewTarget): string {
  if (target.kind === 'list') return tr('header.menu.scope.list', { count: target.count })
  if (target.kind === 'playlist')
    return tr('header.menu.scope.playlistFiles', { count: target.count, name: target.name })
  return tr('header.menu.scope.playlistMusic', { count: target.count, name: target.name })
}

export function duplicatesDetail(tr: TFunction, name: string): string {
  return tr('header.menu.scope.duplicates', { name })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/lib/reviewTarget.test.ts src/renderer/src/i18n`
Expected: PASS (the i18n folder holds `keys.test.ts` and `usedKeys.test.ts`, which check the new keys exist in every locale and are used).

- [ ] **Step 6: Lint, types, commit**

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/renderer/src/lib/reviewTarget.ts apps/desktop/src/renderer/src/lib/reviewTarget.test.ts apps/desktop/src/renderer/src/i18n/locales
git commit -m "Work out what the open source would review and say it in one line"
```

---

### Task 3: A second line under the menu items, and Show duplicates

**Files:**
- Modify: `src/renderer/src/components/TrackListHeader.tsx` (`Props`, `MenuAction`, the menu's first item)
- Test: `src/renderer/src/components/TrackListHeader.test.tsx`

**Interfaces:**
- Consumes: the `header.menu.showDuplicates` string (Task 2).
- Produces (new `TrackListHeader` props; `onReviewList` and `canReviewList` keep their names and types):
  - `reviewDetail: string`
  - `duplicates?: { detail: string; onShow: () => void }`
  - test ids `list-review-open-detail`, `music-duplicates-open`, `music-duplicates-open-detail`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/TrackListHeader.test.tsx`, add a default to `renderHeader` right after `canReviewList`:

```tsx
      reviewDetail="The 1 track in the list. Changes the file"
```

and add to `describe('TrackListHeader actions row', ...)`:

```tsx
  // The same words now review a list, a rekordbox playlist or Apple Music; the second line
  // is what tells the user which, and that Apple Music, not a file, is what changes.
  it('says under Review metadata what it will touch, as its description', () => {
    renderHeader({ reviewDetail: 'The 70 tracks in “Factory”. Changes the files' })
    const menu = openMenu()
    const item = within(menu).getByTestId('list-review-open')
    expect(item).toHaveAccessibleName(i18n.t('header.menu.review'))
    expect(item).toHaveAccessibleDescription('The 70 tracks in “Factory”. Changes the files')
    expect(within(menu).getByTestId('list-review-open-detail')).toHaveTextContent(
      'The 70 tracks in “Factory”. Changes the files',
    )
  })

  it('offers duplicates right after the review only when an Apple Music playlist gives them', () => {
    const onShow = vi.fn()
    renderHeader({ duplicates: { detail: 'From “2K” across your whole Music library', onShow } })
    const menu = openMenu()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.dataset.testid),
    ).toEqual([
      'list-review-open',
      'music-duplicates-open',
      'fill-all',
      'open-find-replace',
      'trash-selected',
      'clear-all',
    ])
    const item = within(menu).getByTestId('music-duplicates-open')
    expect(item).toHaveAccessibleName(i18n.t('header.menu.showDuplicates'))
    expect(within(menu).getByTestId('music-duplicates-open-detail')).toHaveTextContent(
      'From “2K” across your whole Music library',
    )
    fireEvent.click(item)
    expect(onShow).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // The duplicates review holds its writes like the metadata one, so it waits with it.
  it('holds Show duplicates with the review while the review cannot open', () => {
    renderHeader({
      canReviewList: false,
      duplicates: { detail: '“2K” has no tracks to review', onShow: vi.fn() },
    })
    const menu = openMenu()
    expect(within(menu).getByTestId('list-review-open')).toBeDisabled()
    expect(within(menu).getByTestId('music-duplicates-open')).toBeDisabled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/TrackListHeader.test.tsx`
Expected: FAIL, no `list-review-open-detail`, no `music-duplicates-open`, and a TS complaint about the unknown props.

- [ ] **Step 3: Write the implementation**

In `TrackListHeader.tsx`:

Add `Copy` to the `lucide-react` import and change `import { useState } from 'react'` to `import { useId, useState } from 'react'`.

In `interface Props`, after `canReviewList: boolean`:

```ts
  // What the review would touch, under its label: the list, a rekordbox playlist or an
  // Apple Music playlist read the same words otherwise.
  reviewDetail: string
  // Only with an Apple Music playlist open: its copies across the whole library.
  duplicates?: { detail: string; onShow: () => void }
```

Replace `MenuAction` with:

```tsx
function MenuAction({
  testid,
  icon: Icon,
  label,
  detail,
  hint,
  danger,
  disabled,
  onClick,
}: {
  testid: string
  icon: LucideIcon
  label: string
  detail?: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  const detailId = useId()
  return (
    // Named by its label alone and described by the second line, so a screen reader says
    // the action first and what it touches after.
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      aria-describedby={detail ? detailId : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {detail && (
          <span id={detailId} data-testid={`${testid}-detail`} className="text-[11px] text-fg-faint">
            {detail}
          </span>
        )}
      </span>
      {hint && (
        <span aria-hidden="true" className="shrink-0 pl-3 text-fg-faint">
          {hint}
        </span>
      )}
    </button>
  )
}
```

Add `reviewDetail,` and `duplicates,` to the destructured props of `TrackListHeader` (after `canReviewList,`). In the menu, replace the review item with:

```tsx
                    <MenuAction
                      testid="list-review-open"
                      icon={SpellCheck}
                      label={tr('header.menu.review')}
                      detail={reviewDetail}
                      hint={hintFor('list-review')}
                      disabled={!canReviewList}
                      onClick={() => run(onReviewList)}
                    />
                    {duplicates && (
                      <MenuAction
                        testid="music-duplicates-open"
                        icon={Copy}
                        label={tr('header.menu.showDuplicates')}
                        detail={duplicates.detail}
                        disabled={!canReviewList}
                        onClick={() => run(duplicates.onShow)}
                      />
                    )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/components/TrackListHeader.test.tsx`
Expected: PASS, the existing order test included (no `duplicates` given, no extra item).

- [ ] **Step 5: Lint, types, commit**

`App.tsx` does not pass `reviewDetail` yet, so `tsc -p tsconfig.web.json` reports exactly one error there (`Property 'reviewDetail' is missing`). Task 4 adds it; to keep this commit compiling, add to the `<TrackListHeader` call in `App.tsx`, next to `canReviewList={...}`, the placeholder-free interim value `reviewDetail={tr('header.menu.scope.list', { count: tracks.length })}` (Task 4 replaces it).

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/renderer/src/components/TrackListHeader.tsx apps/desktop/src/renderer/src/components/TrackListHeader.test.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "Say under each list menu action what it touches and offer Show duplicates"
```

---

### Task 4: Open the review on the open source, and keep it there

**Files:**
- Modify: `src/renderer/src/App.tsx` (review state, a target memo, the review source memo, `MusicReviewProvider`, `TrackListHeader`, the palette's `openListReview`)
- Test: `src/renderer/src/App.test.tsx` (`describe('App list review')`, `describe('App Music review')`)

**Interfaces:**
- Consumes: `scopedMusicSource` (Task 1); `ReviewOpening`, `reviewTarget`, `reviewOpening`, `reviewDetail`, `duplicatesDetail` (Task 2); `reviewDetail` / `duplicates` props (Task 3).
- Produces: the palette and Tracks-menu command `list-review` opens the target review; the "…" items open it with `'all'` / `'duplicates'`.

- [ ] **Step 1: Write the failing tests**

In `App.test.tsx`, inside `describe('App list review', ...)` (it uses `listApi` and `addThree`; tags are `/music/a.wav` Alpha·DJ Lara, `/music/b.wav` Bravo·DJ Lara, `/music/c.wav` Charlie·Dj Lara):

```tsx
  // No source open, the review is the list's, and the line says it writes the files.
  it('says under Review metadata that it changes the files of the whole list', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    fireEvent.click(screen.getByTestId('list-actions-more'))
    expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
      'The 3 tracks in the list. Changes the files',
    )
    expect(screen.queryByTestId('music-duplicates-open')).not.toBeInTheDocument()
  })

  // A rekordbox playlist is the crate the DJ is working on: the review finds what is wrong in
  // it, not in every file that ever passed through the list, and it keeps to the rows the
  // menu named even when another playlist is picked while it is open.
  it('reviews only the open rekordbox playlist and keeps to it when another one is picked', async () => {
    vi.resetModules()
    const entry = (path: string) => ({ path, separator: false, meta: {} })
    listApi({
      rekordboxAvailable: vi.fn<Api['rekordboxAvailable']>().mockResolvedValue(true),
      loadRekordboxTree: vi.fn<Api['loadRekordboxTree']>().mockResolvedValue([
        { id: 'f', name: 'Factory', kind: 'playlist', count: 2 },
        { id: 'g', name: 'Closing', kind: 'playlist', count: 1 },
      ]),
      loadRekordboxPlaylist: vi.fn<Api['loadRekordboxPlaylist']>(async (id) =>
        id === 'f' ? [entry('/music/a.wav'), entry('/music/b.wav')] : [entry('/music/c.wav')],
      ),
    })
    await renderApp()
    await addThree()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))

    fireEvent.click(screen.getByTestId('list-actions-more'))
    expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
      'The 2 tracks in “Factory”. Changes the files',
    )
    expect(screen.queryByTestId('music-duplicates-open')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('list-review-open'))
    expect(await screen.findByTestId('list-review-scope')).toHaveTextContent(/^2 tracks in the list$/)
    expect(await screen.findByTestId('music-review-all-clear')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('source-node-g'))
    await act(async () => {})
    expect(screen.getByTestId('list-review-scope')).toHaveTextContent(/^2 tracks in the list$/)
    expect(screen.getByTestId('music-review-all-clear')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('list-review')
    expect(await screen.findByTestId('list-review-scope')).toHaveTextContent(/^1 track in the list$/)
  })
```

(The whole list holds the DJ Lara / Dj Lara spelling group, so "all clear" on Factory proves Charlie was left out.)

Inside `describe('App Music review', ...)` (it uses `reviewApi` and `reviewEntry`):

```tsx
  // From a Music playlist the review is about that playlist: its own metadata, and the
  // copies of its tracks wherever they sit in the library.
  describe('from an open Music playlist', () => {
    const library = [
      { ...reviewEntry('0000000000000001', 'DJ Lara'), title: 'Gold' },
      { ...reviewEntry('0000000000000002', 'DJ Lara'), title: 'Gold' },
      { ...reviewEntry('0000000000000003', 'Dj Lara'), title: 'Iron' },
      { ...reviewEntry('0000000000000005', 'Ana'), title: 'Copper' },
      { ...reviewEntry('0000000000000006', 'Bo'), title: 'Lead' },
      { ...reviewEntry('0000000000000007', 'Bo'), title: 'Lead' },
    ]
    const openFriday = async () => {
      vi.resetModules()
      reviewApi({
        loadMusicReview: vi.fn().mockResolvedValue(library),
        appleMusicEntryLocation: vi.fn().mockResolvedValue(''),
        loadAppleMusicPlaylists: vi
          .fn()
          .mockResolvedValue([{ persistentId: 'P1', name: 'Friday', count: 2 }]),
        loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
          paths: ['/m/gold.wav', '/m/copper.wav'],
          persistentIds: {
            '/m/gold.wav': '0000000000000001',
            '/m/copper.wav': '0000000000000005',
          },
          meta: {},
          missing: 0,
        }),
      })
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
      fireEvent.click(await screen.findByTestId('source-node-P1'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.click(screen.getByTestId('list-actions-more'))
    }

    it('names the playlist and that Apple Music changes, then reviews only its tracks', async () => {
      await openFriday()
      expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
        'The 2 tracks in “Friday”. Changes Apple Music',
      )
      expect(screen.getByTestId('music-duplicates-open-detail')).toHaveTextContent(
        'From “Friday” across your whole Music library',
      )
      fireEvent.click(screen.getByTestId('list-review-open'))
      expect(await screen.findByTestId('music-review-all-clear')).toBeInTheDocument()
      expect(screen.queryAllByTestId('music-review-row')).toHaveLength(0)
      expect(window.api.loadMusicReview).toHaveBeenCalledTimes(1)
    })

    // The copy to delete is usually outside the playlist: Gold's second copy is found, and
    // Lead, whose copies are both outside it, is not the playlist's business.
    it('shows the copies of its tracks found anywhere in the library, and only those', async () => {
      await openFriday()
      fireEvent.click(screen.getByTestId('music-duplicates-open'))
      await waitFor(() => expect(screen.getAllByTestId('music-review-row')).toHaveLength(1))
      expect(screen.getByTestId('music-review-row-name')).toHaveTextContent('Gold')
      expect(screen.getByTestId('music-review-filter-trigger')).toHaveTextContent('Duplicates')
    })
  })
```

(The whole library would show the DJ Lara / Dj Lara spelling group and the Lead duplicates; none of them may appear.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/App.test.tsx -t "open Music playlist|rekordbox playlist and keeps|changes the files of the whole list"`
Expected: FAIL. The detail lines show the interim whole-list text, `music-duplicates-open` is missing, and the Factory review finds the spelling group of the whole list.

- [ ] **Step 3: Write the implementation**

All anchors are code text in `App.tsx`.

1. Imports: add `import { scopedMusicSource } from './lib/reviewSource'` and `import { duplicatesDetail, type ReviewOpening, reviewDetail, reviewOpening, reviewTarget } from './lib/reviewTarget'`. If `ReviewFilter` (from `./hooks/useMusicReview`) ends up unused after step 2, remove its import (tsc and biome both say so).

2. The review state. Replace

```ts
  const [review, setReview] = useState<{ source: 'music' | 'list'; filter: ReviewFilter } | null>(
    null,
  )
```

with

```ts
  const [review, setReview] = useState<ReviewOpening | null>(null)
```

(`openListReview` and `openMusicReview` keep building `{ source, filter }`, which is still a valid opening: the whole list and the whole library.)

3. The target. Right after the effect that ends with

```ts
    scopeAnalysis(sweepScope)
  }, [sweepScope, scopeAutoMatch, scopeAnalysis])
```

add:

```ts
  // What "Revisar metadatos" would read with the rail as it is: the rows shown, which are
  // the open playlist's once they are applied, reviewed in Apple Music for a Music playlist
  // and through the files otherwise.
  const playlistName = browser.playlist?.name ?? null
  const target = useMemo(
    () =>
      reviewTarget({
        source: browser.source,
        playlistName,
        entries: browser.entries,
        playlistTracks: playlistScope?.tracks ?? null,
        workingCount: tracksView.length,
      }),
    [browser.source, playlistName, browser.entries, playlistScope, tracksView.length],
  )
  const openTargetReview = useStableCallback((filter: 'all' | 'duplicates') => {
    const next = reviewOpening(target, filter)
    if (next) setReview(next)
  })
```

4. The source. Replace the whole block from `// One source per opening: it remembers what it wrote and trashed until the review closes.` down to its closing `[reviewKind, removeTracks, tracksRef],\n  )` with:

```ts
  // One source per opening: it remembers what it wrote and trashed until the review closes,
  // and it keeps to the rows it opened on. Picking another playlist while it is open does
  // not move it: what the menu said it would touch is what it touches.
  const reviewKind = review?.source
  const reviewPaths = review?.source === 'list' ? review.paths : undefined
  const reviewIds = review?.source === 'music' ? review.scope?.ids : undefined
  const reviewMode = review?.source === 'music' ? review.scope?.mode : undefined
  const reviewSource = useMemo(() => {
    if (reviewKind === 'music')
      return reviewIds && reviewMode ? scopedMusicSource(reviewIds, reviewMode) : undefined
    if (reviewKind !== 'list') return undefined
    return listReviewSource({
      rows: reviewPaths
        ? () => tracksViewRef.current.filter((t) => reviewPaths.has(t.inputPath))
        : () => tracksViewRef.current,
      mac: isMac,
      launchMusic: () =>
        !!settingsRef.current?.addToAppleMusic ||
        tracksRef.current.some((t) => t.fromAppleMusic || t.musicPersistentId),
      onRowsRemoved: (paths) =>
        removeTracks(
          tracksRef.current.filter((t) => paths.includes(t.inputPath)).map((t) => t.id),
        ),
    })
  }, [reviewKind, reviewPaths, reviewIds, reviewMode, removeTracks, tracksRef])
```

and in `<MusicReviewProvider` change `source={listSource}` to `source={reviewSource}`. (The paths and IDs are the `Set`s `target` holds, so reopening the same target from the palette keeps the same source and its memory of what it wrote.)

5. The header. In `<TrackListHeader`, replace

```tsx
                          onReviewList={openListReview}
                          canReviewList={tracks.length > 0 && !batching}
                          reviewDetail={tr('header.menu.scope.list', { count: tracks.length })}
```

with

```tsx
                          onReviewList={() => openTargetReview('all')}
                          canReviewList={target.count > 0 && !batching}
                          reviewDetail={reviewDetail(tr, target)}
                          duplicates={
                            target.kind === 'music'
                              ? {
                                  detail: duplicatesDetail(tr, target.name),
                                  onShow: () => openTargetReview('duplicates'),
                                }
                              : undefined
                          }
```

6. The palette (and the Tracks menu, which runs the same command id). In the commands deps, the line right after

```ts
      openMusicReview: isMac ? (filter) => setReview({ source: 'music', filter }) : undefined,
```

is `      openListReview,`; change that one line to

```ts
      openListReview: () => openTargetReview('all'),
```

Leave the other `openListReview,` (the one passed to `useListReviewNotice`) as it is: the import notice reviews the whole list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/renderer/src/App.test.tsx`
Expected: PASS, the new tests and every existing Music and list review test (they open through `runMenu('music-review')`, `runMenu('music-duplicates')` and `runMenu('list-review')` with no source open, which still mean the whole library and the whole list).

Then mutate to prove the scope test bites: in step 4's `rows`, replace the filtered branch with `() => tracksViewRef.current`, rerun the rekordbox test, expect FAIL (the spelling group appears instead of all clear), revert. And change `const reviewPaths = ...` to `const reviewPaths = review?.source === 'list' && target.kind === 'playlist' ? target.paths : undefined` (the scope following the rail instead of the opening), rerun, expect the "keeps to it when another one is picked" test to FAIL on "2 tracks", revert.

- [ ] **Step 5: Lint, types, commit**

```bash
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "Review the playlist open in the source rail from the list menu and the palette"
```

---

### Task 5: The menu bar and the palette follow the open source

**Files:**
- Modify: `src/main/appMenu.ts` (File submenu), `src/main/i18n.ts` (`MenuStrings` and its 5 locales)
- Test: `src/main/appMenu.test.ts`
- Modify: the 5 renderer locales (`commands.listReview`)
- Modify: `apps/web/src/i18n/locales/es.json`, `apps/web/src/i18n/locales/en.json` (the guide's two "File menu" lines)

**Interfaces:**
- Consumes: Task 4's `list-review` behaviour.
- Produces: no File menu item runs `music-review` or `music-duplicates`; `MenuStrings` has no `reviewMusic` / `musicDuplicates`; the Tracks item reads "Review metadata…".

- [ ] **Step 1: Write the failing tests**

In `src/main/appMenu.test.ts`, replace the first test (`'reviews the Music library from the File menu on a Mac'`) and the third (`'has no Music review where there is no Music to script'`) with:

```ts
  // The Music review moved to the list's … menu, where it acts on the playlist open in the
  // source rail; the whole-library commands stay in the palette.
  it('keeps the Music review out of the File menu on every platform', () => {
    for (const mac of [true, false]) {
      const { template, run } = build('en', mac)
      for (const item of menu(template, 'File')) if (item.click) click(item)
      const ran = run.mock.calls.map((c) => c[0])
      expect(ran).not.toContain('music-review')
      expect(ran).not.toContain('music-duplicates')
    }
  })
```

and in `'reviews the list from the Tracks menu on every platform'` change the label `'Review metadata in the list…'` to `'Review metadata…'`, with this comment above the test:

```ts
  // The command follows the open source (the list, a rekordbox or a Music playlist), so its
  // label no longer names the list.
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/appMenu.test.ts`
Expected: FAIL, the File menu runs `music-review`, and there is no `Review metadata…` item.

- [ ] **Step 3: Write the implementation**

In `src/main/appMenu.ts`, replace

```ts
        ...(mac
          ? [
              keymapItem(t('addAppleMusic'), 'add-apple-music'),
              keymapItem(t('reviewMusic'), 'music-review'),
              keymapItem(t('musicDuplicates'), 'music-duplicates'),
            ]
          : []),
```

with

```ts
        ...(mac ? [keymapItem(t('addAppleMusic'), 'add-apple-music')] : []),
```

In `src/main/i18n.ts`, delete `reviewMusic: string` and `musicDuplicates: string` from `MenuStrings`, delete the `reviewMusic:` and `musicDuplicates:` lines from all five locale objects, and set `reviewList` to:

| locale | `reviewList` |
|---|---|
| es | `'Revisar metadatos…'` |
| en | `'Review metadata…'` |
| de | `'Metadaten prüfen…'` |
| fr | `'Vérifier les métadonnées…'` |
| pt-BR | `'Revisar metadados…'` |

Renderer palette label, from `apps/desktop`:

```bash
cat > "$SCRATCH/i18n-list-review.json" <<'EOF'
{
  "es": { "commands": { "listReview": "Revisar metadatos…" } },
  "en": { "commands": { "listReview": "Review metadata…" } },
  "de": { "commands": { "listReview": "Metadaten prüfen…" } },
  "fr": { "commands": { "listReview": "Vérifier les métadonnées…" } },
  "pt-BR": { "commands": { "listReview": "Revisar metadados…" } }
}
EOF
node "$SCRATCH/merge-locale.cjs" "$SCRATCH/i18n-list-review.json"
git diff --stat src/renderer/src/i18n/locales
```

Expected: one line changed in each of the five files (the top-level `listReview` object is untouched).

Web guide (`apps/web/src/i18n/locales`), replace the two `text` values:

| file | old | new |
|---|---|---|
| es.json | `En el menú Archivo, o con ⌘K, elige «Revisar metadatos en Apple Music…».` | `Con ⌘K elige «Revisar metadatos en Apple Music…», o abre una playlist de Apple Music en la columna de fuentes y elige «Revisar metadatos» en el menú … de la lista.` |
| es.json | `En el menú Archivo, o con ⌘K, elige «Mostrar duplicados en Apple Music…».` | `Con ⌘K elige «Mostrar duplicados en Apple Music…», o abre una playlist de Apple Music en la columna de fuentes y elige «Mostrar duplicados» en el menú … de la lista.` |
| en.json | `From the File menu, or with ⌘K, choose “Review metadata in Apple Music…”.` | `With ⌘K, choose “Review metadata in Apple Music…”, or open an Apple Music playlist in the sources column and choose “Review metadata” in the list’s … menu.` |
| en.json | `From the File menu, or with ⌘K, choose “Show duplicates in Apple Music…”.` | `With ⌘K, choose “Show duplicates in Apple Music…”, or open an Apple Music playlist in the sources column and choose “Show duplicates” in the list’s … menu.` |

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/main/appMenu.test.ts src/main/i18n.test.ts src/renderer/src/i18n src/renderer/src/lib/commands.test.ts
cd ../web && node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run src/i18n && cd ../desktop
```

Expected: PASS. `commands.test.ts` still finds `music-review` and `music-duplicates` (they stay in the palette).

- [ ] **Step 5: Whole suite, lint, types, commit**

```bash
node /Users/vicent/code/surco/node_modules/vitest/vitest.mjs run
npm exec --workspace apps/desktop -- biome check --write src
npm exec --workspace apps/desktop -- tsc -p tsconfig.web.json --noEmit
npm exec --workspace apps/desktop -- tsc -p tsconfig.node.json --noEmit
git add apps/desktop/src/main/appMenu.ts apps/desktop/src/main/appMenu.test.ts apps/desktop/src/main/i18n.ts apps/desktop/src/renderer/src/i18n/locales apps/web/src/i18n/locales/es.json apps/web/src/i18n/locales/en.json
git commit -m "Move the Apple Music review out of the File menu and name the review by what it follows"
```

Expected: the whole desktop suite green with no skipped files; report the count.

- [ ] **Step 6: Check in the real app (macOS)**

With the `run-desktop` skill, from this worktree: open Apple Music in the rail, open a playlist, open "…": "Revisar metadatos" shows "Las N pistas de «X». Cambia Apple Music" and "Mostrar duplicados" shows "De «X» en toda tu biblioteca de Music"; open both and compare N with the playlist's file tracks. Open the File menu: no Apple Music review items. Note in the report whether the rail lists Music's own "Música" playlist (decision 6 and 8 rest on not knowing it).

---

## Self-review

1. **Spec coverage.** Pistas reviews the working list (Task 2 `list` target, Task 4 test). Music + playlist reviews its tracks in Apple Music and offers duplicates across the library (Tasks 1, 2, 4). rekordbox + playlist reviews its tracks through the files (Tasks 2, 4). Second line in five locales with plurals and 0 (Task 2). File menu items and their strings removed (Task 5). Palette and empty screen decided (decisions 6, 7; Tasks 4, 5). Music only on macOS (by the rail; Global Constraints).
2. **Placeholders.** None. Task 3's interim `reviewDetail` value is real code that Task 4 replaces, written out in both tasks.
3. **Type consistency.** `ReviewTarget.kind` is `'list' | 'playlist' | 'music'` everywhere; `ReviewOpening` carries `paths` (list) and `scope.ids` / `scope.mode` (music); `MusicScopeMode` is `'tracks' | 'duplicates'`; header props `reviewDetail` and `duplicates: { detail, onShow }` match between Tasks 3 and 4.
4. **Review Focus.** Each of the five lines has its test in the task named there.
