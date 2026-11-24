import { useEffect, useMemo, useState } from 'react'
import {
  type AppleMusicIndex,
  findLibraryEntry,
  isInLibrary,
  type ReplaceCandidate,
  replaceCandidate,
  type StaleLibraryCopy,
  staleLibraryCopy,
  topLibraryEntries,
} from '../lib/appleMusicLibrary'
import { type LibrarySource, libraryMembership } from '../lib/librarySource'
import type { TrackItem } from '../types'

interface Params {
  item: TrackItem
  libraryIndex: AppleMusicIndex | null
  librarySource: LibrarySource
  // The confident Discogs suggestion's canonical title/artist. The raw tags on a vinyl rip
  // are often messier than the library's spelling, so this is what bridges a tag the library
  // can't recognise on its own. Undefined when no trusted release is open.
  suggestedMeta: { title: string; artist: string } | undefined
  // App's updateTrack. The Discogs-proven verdict is pinned onto the track so the LIST and
  // its filter read it too — the list has no open release and cannot recompute it.
  onChange: (patch: Partial<TrackItem>) => void
  describesCopy: boolean
}

interface LibraryVerdict {
  inLibrary: 'idle' | 'yes' | 'no'
  // The library entry this track's add superseded — the old rip, still in the library under a
  // different persistent ID. The footer offers deleting it.
  staleMusicCopy: StaleLibraryCopy | null
  // The copy a track that has NOT been converted yet would supersede. staleMusicCopy can
  // only answer after an add (it excludes the ID that add returned), so a file the user has
  // merely loaded — a FLAC downloaded into a folder whose song is already in the library as
  // an MP3 — had no way to offer a replacement and quietly offered an add instead.
  replaceTarget: ReplaceCandidate | null
  replaceTargetPending: boolean
  // The file of the library copy the section describes. It is the replace target's when
  // there is one; otherwise the entry the section shows (a copy too far in length to replace,
  // found again on title and artist alone), read only to say what it is, never replaced.
  libraryCopyPath: string
  libraryCopyPending: boolean
  tiedCopies: number
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
  onChange,
  describesCopy,
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
  // chosen and until the snapshot arrives. The answer never waits on Discogs: the index is
  // local and instant, while the search cascade can take tens of seconds, so an unmatched
  // track reads 'no' at once and a later Discogs match flips it to 'yes'.
  // biome-ignore lint/correctness/useExhaustiveDependencies: libraryMembership reads the whole item; its read surface (the owned flags, item.meta.title/artist, item.duration) is listed instead so an unrelated keystroke doesn't re-scan the library index.
  const inLibrary: 'idle' | 'yes' | 'no' = useMemo((): 'idle' | 'yes' | 'no' => {
    const membership = libraryMembership(item, librarySource, libraryIndex)
    return membership === 'no' && resolvedViaDiscogs ? 'yes' : membership
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
  ])

  // The library entry this track's Apple Music add superseded: the snapshot still matches
  // the same song under a DIFFERENT persistent ID than the one the add returned — the old
  // rip. The footer offers deleting it, closing the "add the new copy, hunt down the old
  // one in Music" loop. Excluding the add's own ID is what keeps the offer from pointing
  // at the fresh copy once the snapshot refreshes and holds both. Memoized on the exact
  // tags it reads, same as the badge above.
  // Only for a track with no library copy of its own yet: once it has one, staleMusicCopy
  // below is the question that matters, and offering both would put two different
  // "replace" answers on one footer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: same read surface as the memos around it — the tags it actually looks at, not the whole track.
  const replaceTarget = useMemo(
    () =>
      librarySource === 'appleMusic' && libraryIndex && !item.musicPersistentId
        ? replaceCandidate(libraryIndex, ownTags)
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

  // Where the offered copy's file lives, read ONCE when the copy is offered rather than
  // when the user presses convert. Reported 15/09: resolving it at click time asked Music
  // where the track was after an earlier replacement had already repointed that entry at
  // the new AIFF, so rekordbox was searched for a path it had never indexed and reported
  // the song missing from a collection it was plainly in. Keyed by persistent ID so a
  // stale path can never outlive the copy it described.
  const offeredId =
    replaceTarget && !('ambiguous' in replaceTarget) ? replaceTarget.persistentId : null
  // A shown copy with no replace target still has to say what it is: the entry the section
  // matched, looked up without the length that kept it from being a replace candidate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead.
  const topEntries = useMemo(
    () =>
      describesCopy && libraryIndex && replaceTarget && 'ambiguous' in replaceTarget
        ? topLibraryEntries(libraryIndex, ownTags)
        : [],
    [describesCopy, libraryIndex, replaceTarget, item.meta.title, item.meta.artist, item.duration],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownTags is a fresh literal each render; its read surface (item.meta.title/artist, item.duration) is listed instead.
  const describedId = useMemo(() => {
    if (!describesCopy || offeredId || librarySource !== 'appleMusic' || !libraryIndex) return null
    // Several entries match: one that clearly scores best is the copy described, while a tie at
    // the top could describe the wrong one. Replacing still needs a single match.
    if (replaceTarget && 'ambiguous' in replaceTarget) {
      return topEntries.length === 1 ? (topEntries[0].persistentId ?? null) : null
    }
    if (inLibrary !== 'yes' || item.musicPersistentId) return null
    const entry =
      findLibraryEntry(libraryIndex, ownTags, ownTags.durationSec) ??
      findLibraryEntry(libraryIndex, ownTags) ??
      (suggestedMeta ? findLibraryEntry(libraryIndex, suggestedMeta) : null)
    return entry?.persistentId ?? null
  }, [
    describesCopy,
    offeredId,
    replaceTarget,
    topEntries,
    librarySource,
    libraryIndex,
    inLibrary,
    item.musicPersistentId,
    item.meta.title,
    item.meta.artist,
    item.duration,
    suggestedMeta,
  ])
  const ownId = describesCopy && librarySource === 'appleMusic' ? item.musicPersistentId : undefined
  const copyId = offeredId ?? describedId ?? ownId ?? null
  const [offeredPath, setOfferedPath] = useState<{ id: string; path: string } | null>(null)
  const [lookedUp, setLookedUp] = useState<string | null>(null)
  useEffect(() => {
    if (!copyId) return
    let cancelled = false
    void window.api
      .appleMusicEntryLocation(copyId)
      .catch(() => '')
      .then((path) => {
        if (cancelled) return
        if (path) setOfferedPath({ id: copyId, path })
        setLookedUp(copyId)
      })
    return () => {
      cancelled = true
    }
  }, [copyId])

  const replaceTargetWithPath = useMemo(
    () =>
      replaceTarget && offeredId && offeredPath?.id === offeredId
        ? { ...replaceTarget, path: offeredPath.path }
        : replaceTarget,
    [replaceTarget, offeredId, offeredPath],
  )

  return {
    inLibrary,
    staleMusicCopy,
    replaceTarget: replaceTargetWithPath,
    replaceTargetPending: !!offeredId && lookedUp !== offeredId,
    libraryCopyPath: copyId && offeredPath?.id === copyId ? offeredPath.path : '',
    libraryCopyPending: !!copyId && lookedUp !== copyId,
    tiedCopies: topEntries.length > 1 ? topEntries.length : 0,
  }
}
