import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TRACKS_ID } from '../../../shared/allTracks'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import {
  distinctTracks,
  joinStretches,
  musicEntries,
  musicTree,
  withReadCounts,
} from '../lib/appleMusicSource'
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
  if (source === 'engine') return window.api.loadEngineTree()
  if (source === 'traktor') return window.api.loadTraktorTree()
  return source === 'rekordbox'
    ? window.api.loadRekordboxTree()
    : window.api.loadAppleMusicPlaylists().then((lists) => musicTree(lists, allTracksName))
}

function readRecentCount(source: PlaylistSource): Promise<number> {
  if (source === 'traktor') return window.api.traktorRecentCount()
  return source === 'engine' ? window.api.engineRecentCount() : window.api.rekordboxRecentCount()
}

function readTrackCount(source: PlaylistSource): Promise<number> {
  if (source === 'traktor') return window.api.traktorTrackCount()
  return source === 'engine' ? window.api.engineTrackCount() : window.api.rekordboxTrackCount()
}

const MUSIC_STRETCH = 200

async function readMusicPlaylist(
  id: string,
  signal: AbortSignal,
  onStretch: (entries: SourcePlaylistEntry[]) => void,
): Promise<SourcePlaylistEntry[]> {
  let read = await window.api.loadAppleMusicPlaylistTracks(id, 1, MUSIC_STRETCH)
  const total = read.total ?? 0
  for (let from = MUSIC_STRETCH + 1; from <= total; from += MUSIC_STRETCH) {
    signal.throwIfAborted()
    onStretch(musicEntries(read))
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
  if (source === 'engine') return window.api.loadEnginePlaylist(id)
  if (source === 'traktor') return window.api.loadTraktorPlaylist(id)
  return source === 'rekordbox'
    ? window.api.loadRekordboxPlaylist(id)
    : window.api.loadAppleMusicPlaylistTracks(id).then(musicEntries)
}

// Which source and playlist the list is showing, and their data. The DJ library is the
// single truth, so nothing here is kept beyond the session: the tree and the open playlist
// are re-read whenever Surco gets the focus back, which is when a change made in rekordbox
// can have happened. Null source is the working list every import has always used.
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
    queryFn: () => window.api.engineAvailable(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const traktor = useQuery({
    queryKey: ['source-available', 'traktor'],
    queryFn: () => window.api.traktorAvailable(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const sources: PlaylistSource[] = [
    ...(isMac ? (['appleMusic'] as const) : []),
    ...(rekordbox ? (['rekordbox'] as const) : []),
    ...(engine.data ? (['engine'] as const) : []),
    ...(traktor.data ? (['traktor'] as const) : []),
  ].filter((s) => !hiddenSources.includes(s))

  const tree = useQuery({
    queryKey: ['source-tree', source],
    queryFn: () => readTree(source as PlaylistSource, tr('sources.allTracks')),
    enabled: source !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const hasRecent = source === 'rekordbox' || source === 'engine' || source === 'traktor'
  const recent = useQuery({
    queryKey: ['source-tree', source, 'recent'],
    queryFn: () => readRecentCount(source as PlaylistSource),
    enabled: hasRecent,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const all = useQuery({
    queryKey: ['source-tree', source, 'all'],
    queryFn: () => readTrackCount(source as PlaylistSource),
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
      return readMusicPlaylist(playlist?.id as string, signal, (part) => {
        const shown = queryClient.getQueryData<SourcePlaylistEntry[]>(entriesKey)
        if (!shown || part.length > shown.length) queryClient.setQueryData(entriesKey, part)
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
    queryClient.invalidateQueries({ queryKey: ['source-tree'] })
    queryClient.invalidateQueries({ queryKey: ['source-playlist'] })
    queryClient.invalidateQueries({ queryKey: ['source-separator'] })
    queryClient.invalidateQueries({ queryKey: ['rekordbox-membership'] })
    queryClient.invalidateQueries({ queryKey: ['traktor-membership'] })
    queryClient.invalidateQueries({ queryKey: ['engine-membership'] })
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
    selectSource: setSource,
    selectPlaylist: (node, folders) => {
      if (!source) return
      setPlaylists((all) => ({ ...all, [source]: { id: node.id, name: node.name, folders } }))
    },
  }
}
