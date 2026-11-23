import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TRACKS_ID } from '../../../shared/allTracks'
import { DJ_PROGRAMS, type DjProgram, RAIL_PROGRAMS } from '../../../shared/djProgram'
import { MATCHING_ID } from '../../../shared/matching'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import { type ReplacedEntry, TO_REVIEW_ID } from '../../../shared/toReview'
import type { PlaylistSource, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import {
  distinctTracks,
  joinStretches,
  musicEntries,
  musicTree,
  withReadCounts,
} from '../lib/appleMusicSource'
import { matchingEntriesFor } from '../lib/matchingPaths'
import { takeOwnRemoval } from '../lib/ownRemovals'
import { SOURCE_PROGRAMS, SOURCE_READ } from '../lib/sourcePrograms'
import { keepOpenRows, toReviewEntriesFor } from '../lib/toReview'
import { useProgramsAvailable } from './useProgramsAvailable'
import { useRekordboxMatching } from './useRekordboxMatching'

const NO_PAIRS: readonly (readonly [string, string])[] = []
const NO_REPLACED: readonly ReplacedEntry[] = []
const NO_PATHS: ReadonlySet<string> = new Set()

import { useStableCallback } from './useStableCallback'
import { useWindowFocus } from './useWindowFocus'

export interface SourceBrowser {
  sources: PlaylistSource[]
  source: PlaylistSource | null
  playlist: { id: string; name: string; folders: string[] } | null
  tree: SourceNode[] | undefined
  treeFailed: boolean
  libraryMissing: boolean
  entries: SourcePlaylistEntry[] | undefined
  entriesLoading: boolean
  entriesFailed: boolean
  entriesFetching: boolean
  canInsertSeparator: boolean
  selectSource: (source: PlaylistSource | null) => void
  selectPlaylist: (node: SourceNode, folders: string[]) => void
  openPlaylist: (source: PlaylistSource, node: SourceNode, folders: string[]) => void
  loadTrees: () => Promise<{ source: PlaylistSource; tree: SourceNode[] }[]>
}

function containsNode(nodes: SourceNode[], id: string): boolean {
  return nodes.some((n) => n.id === id || (n.children ? containsNode(n.children, id) : false))
}

function readTree(source: PlaylistSource, allTracksName: string): Promise<SourceNode[]> {
  return source === 'appleMusic'
    ? window.api.loadAppleMusicPlaylists().then((lists) => musicTree(lists, allTracksName))
    : SOURCE_READ[source].tree()
}

// Music lists its playlists in 1.8 s on a good day; the list kept from last time shows at
// once and the fresh one replaces it.
async function readMusicTree(
  allTracksName: string,
  onLastRead: (tree: SourceNode[]) => void,
): Promise<SourceNode[]> {
  const listing = window.api.loadAppleMusicPlaylists()
  const last = await window.api.loadAppleMusicPlaylistsCached()
  if (last) onLastRead(musicTree(last, allTracksName))
  return musicTree(await listing, allTracksName)
}

// Music's playlists change in Music, not while Surco is in front, and reading them again
// cost up to 19 s (measured 01/11): they are read again when the Music tab is opened, and
// the window getting the focus back leaves them alone.
const notMusic = (query: { queryKey: readonly unknown[] }): boolean =>
  query.queryKey[1] !== 'appleMusic'

const MUSIC_STRETCH = 200

async function readMusicPlaylist(
  id: string,
  signal: AbortSignal,
  onLastRead: (entries: SourcePlaylistEntry[]) => void,
): Promise<SourcePlaylistEntry[]> {
  const reading = window.api.loadAppleMusicLibraryPlaylistTracks(id)
  const last = await window.api.loadAppleMusicPlaylistCached(id)
  if (last) onLastRead(musicEntries(last))
  const whole = await reading
  if (whole) return musicEntries(whole)
  let read = await window.api.loadAppleMusicPlaylistTracks(id, 1, MUSIC_STRETCH)
  const total = read.total ?? 0
  for (let from = MUSIC_STRETCH + 1; from <= total; from += MUSIC_STRETCH) {
    signal.throwIfAborted()
    const to = from + MUSIC_STRETCH - 1
    const stretch = await window.api
      .loadAppleMusicPlaylistTracks(id, from, to)
      .catch((err: unknown) => {
        if (signal.aborted) throw err
        return window.api.loadAppleMusicPlaylistTracks(id, from, to)
      })
    read = joinStretches(read, stretch)
  }
  return musicEntries(read)
}

export function readPlaylist(source: PlaylistSource, id: string): Promise<SourcePlaylistEntry[]> {
  return source === 'appleMusic'
    ? window.api.loadAppleMusicPlaylistTracks(id).then(musicEntries)
    : SOURCE_READ[source].playlist(id)
}

// Which source and playlist the list is showing, and their data. The DJ library is the
// single truth, so nothing here is kept beyond the session: the tree and the open playlist
// are re-read whenever Surco gets the focus back, which is when a change made in rekordbox
// can have happened; Music's, when its tab is opened (see notMusic). Null source is the working list every import has always used.
// Each source keeps the playlist it had open, so leaving for another source and coming
// back finds the set where the DJ left it.
export function useSourceBrowser({
  onPlaylistGone,
  hiddenSources,
  matchingPathPairs = NO_PAIRS,
  libraryFolders = null,
  replacedEntries = NO_REPLACED,
  selectedPaths = NO_PATHS,
}: {
  onPlaylistGone: (name: string, source: PlaylistSource) => void
  hiddenSources: PlaylistSource[]
  matchingPathPairs?: readonly (readonly [string, string])[]
  libraryFolders?: readonly string[] | null
  replacedEntries?: readonly ReplacedEntry[]
  selectedPaths?: ReadonlySet<string>
}): SourceBrowser {
  const queryClient = useQueryClient()
  const { t: tr } = useTranslation()
  const onPlaylistGoneRef = useRef(onPlaylistGone)
  onPlaylistGoneRef.current = onPlaylistGone
  const [picked, setSource] = useState<PlaylistSource | null>(null)
  const source = picked && !hiddenSources.includes(picked) ? picked : null
  const [playlists, setPlaylists] = useState<
    Partial<Record<PlaylistSource, NonNullable<SourceBrowser['playlist']>>>
  >({})
  const isMac = window.api.platform === 'darwin'

  const found = useProgramsAvailable()
  const sources = useMemo<PlaylistSource[]>(() => {
    return [
      ...(isMac ? (['appleMusic'] as const) : []),
      ...RAIL_PROGRAMS.filter((p) => found[p]),
    ].filter((s) => !hiddenSources.includes(s))
  }, [isMac, found, hiddenSources])

  const treeQuery = (of: PlaylistSource | null) => {
    const queryKey = ['source-tree', of]
    return {
      queryKey,
      queryFn: () =>
        of === 'appleMusic'
          ? readMusicTree(tr('sources.allTracks'), (last: SourceNode[]) => {
              if (queryClient.getQueryData(queryKey) === undefined)
                queryClient.setQueryData(queryKey, last)
            })
          : readTree(of as PlaylistSource, tr('sources.allTracks')),
      staleTime: Number.POSITIVE_INFINITY,
    }
  }
  const tree = useQuery({ ...treeQuery(source), enabled: source !== null })
  const program = source === 'appleMusic' ? null : source
  const hasRecent = program !== null
  const recent = useQuery({
    queryKey: ['source-tree', source, 'recent'],
    queryFn: () => SOURCE_READ[program as DjProgram].recentCount(),
    enabled: hasRecent,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const all = useQuery({
    queryKey: ['source-tree', source, 'all'],
    queryFn: () => SOURCE_READ[program as DjProgram].trackCount(),
    enabled: hasRecent,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const matching = useRekordboxMatching(program === 'rekordbox')
  const otherProgram = program !== null && program !== 'rekordbox'
  // To review lists rows of All tracks, so the collection is read once for both lists, and
  // only while a replaced track is still to review in this program.
  const reviewHere =
    program !== null && replacedEntries.some((entry) => entry.pending.includes(program))
  const allForMatching = useQuery({
    queryKey: ['source-playlist', source, ALL_TRACKS_ID],
    queryFn: () => readPlaylist(source as PlaylistSource, ALL_TRACKS_ID),
    enabled: (otherProgram && matchingPathPairs.length > 0) || reviewHere,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const otherMatchingEntries = useMemo(
    () =>
      !otherProgram
        ? undefined
        : matchingPathPairs.length === 0
          ? []
          : allForMatching.data && matchingEntriesFor(allForMatching.data, matchingPathPairs),
    [otherProgram, matchingPathPairs, allForMatching.data],
  )
  const toReviewEntries = useMemo(
    () =>
      program === null
        ? undefined
        : !reviewHere
          ? []
          : allForMatching.data &&
            toReviewEntriesFor(allForMatching.data, replacedEntries, program),
    [program, reviewHere, replacedEntries, allForMatching.data],
  )
  const reviewCount = toReviewEntries?.length ?? 0
  const otherCount = otherMatchingEntries?.filter((e) => !e.separator).length
  const matchingCount =
    program === 'rekordbox'
      ? matching.data && new Set(matching.data.flat()).size
      : otherCount && otherCount > 0
        ? otherCount
        : undefined
  const startingPlaylist = useMemo(
    () =>
      (recent.data ?? 0) > 0
        ? { id: RECENTLY_ADDED_ID, name: tr('sources.recentlyAdded'), folders: [] }
        : (all.data ?? 0) > 0
          ? { id: ALL_TRACKS_ID, name: tr('sources.allTracks'), folders: [] }
          : null,
    [recent.data, all.data, tr],
  )
  const playlist = source ? (playlists[source] ?? (hasRecent ? startingPlaylist : null)) : null
  const reviewOpen = program !== null && playlist?.id === TO_REVIEW_ID
  const shownReview = useRef<SourcePlaylistEntry[] | undefined>(undefined)
  const reviewRows = useMemo(() => {
    const rows =
      reviewOpen && toReviewEntries
        ? keepOpenRows(shownReview.current ?? [], toReviewEntries, selectedPaths)
        : toReviewEntries
    shownReview.current = reviewOpen ? rows : undefined
    return rows
  }, [reviewOpen, toReviewEntries, selectedPaths])
  const shownTree = useMemo(
    () =>
      hasRecent && tree.data
        ? [
            ...(recent.data !== undefined
              ? [
                  {
                    id: RECENTLY_ADDED_ID,
                    name: tr('sources.recentlyAdded'),
                    kind: 'playlist' as const,
                    count: recent.data,
                  },
                ]
              : []),
            ...((reviewRows?.length ?? 0) > 0
              ? [
                  {
                    id: TO_REVIEW_ID,
                    name: tr('sources.toReview'),
                    kind: 'playlist' as const,
                    count: reviewCount,
                  },
                ]
              : []),
            ...(all.data !== undefined
              ? [
                  {
                    id: ALL_TRACKS_ID,
                    name: tr('sources.allTracks'),
                    kind: 'playlist' as const,
                    count: all.data,
                  },
                ]
              : []),
            ...(matchingCount !== undefined
              ? [
                  {
                    id: MATCHING_ID,
                    name: tr('sources.matching'),
                    kind: 'playlist' as const,
                    count: matchingCount,
                  },
                ]
              : []),
            ...tree.data,
          ]
        : tree.data,
    [hasRecent, tree.data, all.data, recent.data, reviewRows, reviewCount, matchingCount, tr],
  )
  const otherMatchingOpen = otherProgram && playlist?.id === MATCHING_ID
  const entriesKey = ['source-playlist', source, playlist?.id]
  const entries = useQuery({
    queryKey: entriesKey,
    queryFn: ({ signal }) => {
      if (source !== 'appleMusic')
        return readPlaylist(source as PlaylistSource, playlist?.id as string)
      return readMusicPlaylist(playlist?.id as string, signal, (last) => {
        if (queryClient.getQueryData(entriesKey) === undefined)
          queryClient.setQueryData(entriesKey, last)
      })
    },
    enabled: source !== null && playlist !== null && !otherMatchingOpen && !reviewOpen,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const shownEntries = otherMatchingOpen
    ? otherMatchingEntries
    : reviewOpen
      ? reviewRows
      : entries.data
  const shownPending = otherMatchingOpen
    ? otherMatchingEntries === undefined
    : reviewOpen
      ? toReviewEntries === undefined
      : entries.isPending

  const hasSeparator = program && SOURCE_PROGRAMS[program].separator
  const separator = useQuery({
    queryKey: ['source-separator', source],
    queryFn: hasSeparator || skipToken,
    staleTime: Number.POSITIVE_INFINITY,
  })

  // A playlist deleted in rekordbox while it was open: once the re-read tree no longer
  // holds it, the list goes back to the tree instead of showing rows of a playlist that is
  // gone. The tree stays open where it was, which is the "back to the folder" of the spec,
  // and the caller is told which playlist went, unless Surco itself removed it. A failed
  // re-read keeps the tree it had, so it never reads as a deletion. To review empties
  // because the DJ reviewed its last track, which is no deletion to tell them about.
  useEffect(() => {
    if (!playlist || !source || !shownTree || containsNode(shownTree, playlist.id)) return
    setPlaylists(({ [source]: _, ...rest }) => rest)
    if (playlist.id !== TO_REVIEW_ID && !takeOwnRemoval(playlist.id))
      onPlaylistGoneRef.current(playlist.name, source)
  }, [playlist, source, shownTree])

  // All tracks read only to count To review: a focus marks it stale instead of reading a
  // whole collection with previews on every alt-tab; opening the node reads it again.
  const allTracksKey = ['source-playlist', source, ALL_TRACKS_ID]
  const onlyCounted =
    reviewHere &&
    !(otherProgram && matchingPathPairs.length > 0) &&
    !reviewOpen &&
    playlist?.id !== ALL_TRACKS_ID
  useEffect(() => {
    if (reviewOpen)
      queryClient.refetchQueries({
        queryKey: ['source-playlist', source, ALL_TRACKS_ID],
        exact: true,
        stale: true,
      })
  }, [reviewOpen, source, queryClient])

  const rereadLibraries = useStableCallback(() => {
    // Another view showing the same read (the cue flow preview's track picker) still gets
    // it fresh: it is only counted when this hook is all that watches it.
    const counted = queryClient.getQueryCache().find({ queryKey: allTracksKey, exact: true })
    const skip = onlyCounted && counted !== undefined && counted.getObserversCount() <= 1
    queryClient.invalidateQueries({ queryKey: ['source-available'] })
    queryClient.invalidateQueries({ queryKey: ['source-tree'], predicate: notMusic })
    queryClient.invalidateQueries({
      queryKey: ['source-playlist'],
      predicate: (query) => notMusic(query) && !(skip && query === counted),
    })
    if (skip)
      queryClient.invalidateQueries({ queryKey: allTracksKey, exact: true, refetchType: 'none' })
    queryClient.invalidateQueries({ queryKey: ['source-separator'] })
    for (const p of DJ_PROGRAMS)
      queryClient.invalidateQueries({ queryKey: [SOURCE_PROGRAMS[p].membershipKey] })
  })
  useWindowFocus((focused) => {
    if (focused) rereadLibraries()
  })

  const foldersKey = libraryFolders?.join('\n') ?? null
  const seenFolders = useRef(foldersKey)
  useEffect(() => {
    const before = seenFolders.current
    seenFolders.current = foldersKey
    if (before !== null && before !== foldersKey) rereadLibraries()
  }, [foldersKey, rereadLibraries])

  return {
    sources,
    source,
    playlist,
    tree:
      source === 'appleMusic' && tree.data
        ? withReadCounts(tree.data, (id) => {
            const key = ['source-playlist', 'appleMusic', id]
            if (queryClient.getQueryState(key)?.fetchStatus === 'fetching') return undefined
            const read = queryClient.getQueryData<SourcePlaylistEntry[]>(key)
            return read && distinctTracks(read)
          })
        : shownTree,
    treeFailed: tree.isError,
    libraryMissing:
      program !== null && SOURCE_PROGRAMS[program].missingLibraryCheck && found[program] === false,
    entries: shownEntries,
    entriesLoading: source !== null && playlist !== null && shownPending,
    entriesFailed: source !== null && playlist !== null && entries.isError,
    entriesFetching: entries.isFetching,
    canInsertSeparator: separator.data ?? false,
    selectSource: (next) => {
      if (next === 'appleMusic' && source !== 'appleMusic') {
        queryClient.invalidateQueries({ queryKey: ['source-tree', 'appleMusic'] })
        queryClient.invalidateQueries({ queryKey: ['source-playlist', 'appleMusic'] })
      }
      setSource(next)
    },
    selectPlaylist: (node, folders) => {
      if (!source) return
      setPlaylists((all) => ({ ...all, [source]: { id: node.id, name: node.name, folders } }))
    },
    openPlaylist: (next, node, folders) => {
      setSource(next)
      setPlaylists((all) => ({ ...all, [next]: { id: node.id, name: node.name, folders } }))
    },
    loadTrees: () =>
      Promise.all(
        sources.map((s) =>
          queryClient
            .ensureQueryData(treeQuery(s))
            .then((t) => ({ source: s, tree: t }))
            .catch(() => ({ source: s, tree: [] })),
        ),
      ),
  }
}
