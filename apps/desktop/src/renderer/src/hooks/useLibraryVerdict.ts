import { useEffect, useMemo } from 'react'
import {
  type AppleMusicIndex,
  isInLibrary,
  type StaleLibraryCopy,
  staleLibraryCopy,
} from '../lib/appleMusicLibrary'
import type { LibrarySource } from '../lib/librarySource'
import type { TrackItem } from '../types'

interface Params {
  item: TrackItem
  libraryIndex: AppleMusicIndex | null
  librarySource: LibrarySource
  // The confident Discogs suggestion's canonical title/artist. The raw tags on a vinyl rip
  // are often messier than the library's spelling, so this is what bridges a tag the library
  // can't recognise on its own. Undefined when no trusted release is open.
  suggestedMeta: { title: string; artist: string } | undefined
  // A Discogs lookup still in flight: the verdict reads 'checking' rather than 'no', so a
  // slow lookup never flashes "not owned" at a track that is.
  discogsResolving: boolean
  // App's updateTrack. The Discogs-proven verdict is pinned onto the track so the LIST and
  // its filter read it too — the list has no open release and cannot recompute it.
  onChange: (patch: Partial<TrackItem>) => void
}

interface LibraryVerdict {
  inLibrary: 'idle' | 'yes' | 'no' | 'checking'
  // The library entry this track's add superseded — the old rip, still in the library under a
  // different persistent ID. The footer offers deleting it.
  staleMusicCopy: StaleLibraryCopy | null
}

// Whether the destination library (Apple Music or Engine DJ) already owns this track, and
// whether an older copy of it is still sitting there.
//
// Lifted out of Editor, where 105 lines of library business logic sat inside a component
// that also renders a metadata form, a Discogs column, eight collapsible sections and a
// footer. The memo dependency lists here are load-bearing and deliberately name
// item.meta.title/artist/duration rather than `item`: the index scan is not cheap, and
// depending on the whole track would re-run it on every keystroke in any unrelated field.
export function useLibraryVerdict({
  item,
  libraryIndex,
  librarySource,
  suggestedMeta,
  discogsResolving,
  onChange,
}: Params): LibraryVerdict {

  // Whether the confident Discogs suggestion is what proves this track is owned — the raw
  // tags didn't key-match the library but the release's canonical title/artist does. This is
  // the one verdict the list can't recompute on its own (it has no open release), so it gets
  // persisted below so the filter agrees with this badge.
  // The file's own tags plus its probed length — the library matcher uses the duration to
  // tell two versions of one title apart, so pass it alongside title/artist.
  const ownTags = {
    title: item.meta.title,
    artist: item.meta.artist,
    durationSec: item.duration,
  }
  // isInLibrary normalizes and scans the Apple Music index, so memoize the verdict on
  // the exact tags it reads — a keystroke in an unrelated field must not re-run the
  // library lookup two or three times over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead.
  const resolvedViaDiscogs = useMemo(
    () =>
      !!libraryIndex &&
      !item.musicPersistentId &&
      !isInLibrary(libraryIndex, ownTags) &&
      !!suggestedMeta &&
      isInLibrary(libraryIndex, suggestedMeta),
    [
      libraryIndex,
      item.musicPersistentId,
      item.meta.title,
      item.meta.artist,
      item.duration,
      suggestedMeta,
    ],
  )

  // Hint of whether the song is already in the destination's library — Apple Music or
  // the Engine DJ database, whichever conversions land in — so the user doesn't
  // re-import it. Read from the same session snapshot the list and quality filter use
  // (isInLibrary on item.meta); the editor additionally accepts a confident Discogs
  // suggestion, so opening the right release can flip a tag the raw filename couldn't match.
  // That Discogs-proven verdict is persisted (resolvedViaDiscogs, below) so the row and
  // filter agree with this badge. A track Surco itself added counts as owned even before
  // the snapshot lands — via its Apple Music persistent ID or its Engine add flag,
  // whichever library is active. 'idle' hides the badge when no library destination is
  // chosen and until the snapshot arrives. 'checking' covers the gap that used to flicker
  // "not in library": the raw tags don't match but Discogs is still resolving, so its
  // match could still flip this to 'yes' — only once that work settles without a match do
  // we commit to 'no'.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead so an unrelated keystroke doesn't re-scan the library index.
  const inLibrary: 'idle' | 'yes' | 'no' | 'checking' = useMemo(():
    | 'idle'
    | 'yes'
    | 'no'
    | 'checking' => {
    if (!librarySource) return 'idle'
    const owned =
      librarySource === 'appleMusic'
        ? item.musicPersistentId || item.inLibraryResolved
        : item.engineDjAdded || item.inLibraryResolved
    if (owned) return 'yes'
    if (!libraryIndex) return 'idle'
    if (isInLibrary(libraryIndex, ownTags)) return 'yes'
    if (resolvedViaDiscogs) return 'yes'
    return discogsResolving ? 'checking' : 'no'
  }, [
    librarySource,
    item.musicPersistentId,
    item.engineDjAdded,
    item.inLibraryResolved,
    item.meta.title,
    item.meta.artist,
    item.duration,
    libraryIndex,
    resolvedViaDiscogs,
    discogsResolving,
  ])

  // The library entry this track's Apple Music add superseded: the snapshot still matches
  // the same song under a DIFFERENT persistent ID than the one the add returned — the old
  // rip. The footer offers deleting it, closing the "add the new copy, hunt down the old
  // one in Music" loop. Excluding the add's own ID is what keeps the offer from pointing
  // at the fresh copy once the snapshot refreshes and holds both. Memoized on the exact
  // tags it reads, same as the badge above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead so an unrelated keystroke doesn't re-scan the library index.
  const staleMusicCopy = useMemo(
    () =>
      librarySource === 'appleMusic' && libraryIndex && item.musicPersistentId
        ? staleLibraryCopy(libraryIndex, ownTags, item.musicPersistentId)
        : null,
    [
      librarySource,
      libraryIndex,
      item.musicPersistentId,
      item.meta.title,
      item.meta.artist,
      item.duration,
    ],
  )

  // Pin a Discogs-proven "owned" verdict onto the track so the list and filter read it too,
  // not just this badge. Only when it's newly proven and not already pinned, so the effect
  // settles in one write. onChange is App's updateTrack (a shallow merge), so this adds the
  // flag without disturbing the open edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onChange is identity-stable (App's useStableCallback); excluding it keeps this effect from re-firing on unrelated App renders.
  useEffect(() => {
    if (resolvedViaDiscogs && !item.inLibraryResolved) onChange({ inLibraryResolved: true })
  }, [resolvedViaDiscogs, item.inLibraryResolved])

  return { inLibrary, staleMusicCopy }
}
