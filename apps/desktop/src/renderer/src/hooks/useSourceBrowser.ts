import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TRACKS_ID } from '../../../shared/allTracks'
import { DJ_PROGRAMS, type DjProgram, RAIL_PROGRAMS } from '../../../shared/djProgram'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import {
  distinctTracks,
  joinStretches,
  musicEntries,
  musicTree,
  withReadCounts,
} from '../lib/appleMusicSource'
import { SOURCE_READ } from '../lib/sourcePrograms'
import { useRekordboxAvailable } from './useRekordboxPlaylists'
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
}: {
  onPlaylistGone: (name: string, source: PlaylistSource) => void
  hiddenSources: PlaylistSource[]
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
  const playlist = source ? (playlists[source] ?? null) : null
  const isMac = window.api.platform === 'darwin'

  const rekordbox = useRekordboxAvailable()
  const engine = useQuery({
    queryKey: ['source-available', 'engine'],
    queryFn: SOURCE_READ.engine.available,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const traktor = useQuery({
    queryKey: ['source-available', 'traktor'],
    queryFn: SOURCE_READ.traktor.available,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const sources = useMemo<PlaylistSource[]>(() => {
    const found: Record<DjProgram, boolean | undefined> = {
      rekordbox,
      engine: engine.data,
      traktor: traktor.data,
    }
    return [
      ...(isMac ? (['appleMusic'] as const) : []),
      ...RAIL_PROGRAMS.filter((p) => found[p]),
    ].filter((s) => !hiddenSources.includes(s))
  }, [isMac, rekordbox, engine.data, traktor.data, hiddenSources])

  const treeKey = ['source-tree', source]
  const tree = useQuery({
    queryKey: treeKey,
    queryFn: () =>
      source === 'appleMusic'
        ? readMusicTree(tr('sources.allTracks'), (last) => {
            if (queryClient.getQueryData(treeKey) === undefined)
              queryClient.setQueryData(treeKey, last)
          })
        : readTree(source as PlaylistSource, tr('sources.allTracks')),
    enabled: source !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
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
  const shownTree = useMemo(
    () =>
      hasRecent && tree.data
        ? [
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
            ...tree.data,
          ]
        : tree.data,
    [hasRecent, tree.data, all.data, recent.data, tr],
  )
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
    enabled: source !== null && playlist !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const separator = useQuery({
    queryKey: ['source-separator', source],
    queryFn: () =>
      source === 'traktor' ? window.api.traktorHasSeparator() : window.api.rekordboxHasSeparator(),
    enabled: source === 'rekordbox' || source === 'traktor',
    staleTime: Number.POSITIVE_INFINITY,
  })

  // A playlist deleted in rekordbox while it was open: once the re-read tree no longer
  // holds it, the list goes back to the tree instead of showing rows of a playlist that is
  // gone. The tree stays open where it was, which is the "back to the folder" of the spec,
  // and the caller is told which playlist went, so the jump back has a reason. A failed
  // re-read keeps the tree it had, so it never reads as a deletion.
  useEffect(() => {
    if (!playlist || !source || !shownTree || containsNode(shownTree, playlist.id)) return
    setPlaylists(({ [source]: _, ...rest }) => rest)
    onPlaylistGoneRef.current(playlist.name, source)
  }, [playlist, source, shownTree])

  useWindowFocus((focused) => {
    if (!focused) return
    queryClient.invalidateQueries({ queryKey: ['source-available'] })
    queryClient.invalidateQueries({ queryKey: ['source-tree'], predicate: notMusic })
    queryClient.invalidateQueries({ queryKey: ['source-playlist'], predicate: notMusic })
    queryClient.invalidateQueries({ queryKey: ['source-separator'] })
    for (const p of DJ_PROGRAMS) queryClient.invalidateQueries({ queryKey: [`${p}-membership`] })
  })

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
    libraryMissing: source === 'engine' && engine.data === false,
    entries: entries.data,
    entriesLoading: source !== null && playlist !== null && entries.isPending,
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
  }
}
