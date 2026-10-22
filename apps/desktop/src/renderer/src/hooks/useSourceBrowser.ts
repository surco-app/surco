import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import { distinctTracks, musicEntries, musicTree, withReadCounts } from '../lib/appleMusicSource'
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
  canInsertSeparator: boolean
  selectSource: (source: PlaylistSource | null) => void
  selectPlaylist: (node: SourceNode, folders: string[]) => void
}

function containsNode(nodes: SourceNode[], id: string): boolean {
  return nodes.some((n) => n.id === id || (n.children ? containsNode(n.children, id) : false))
}

function readTree(source: PlaylistSource): Promise<SourceNode[]> {
  if (source === 'engine') return window.api.loadEngineTree()
  return source === 'rekordbox'
    ? window.api.loadRekordboxTree()
    : window.api.loadAppleMusicPlaylists().then(musicTree)
}

function readRecentCount(source: PlaylistSource): Promise<number> {
  return source === 'engine' ? window.api.engineRecentCount() : window.api.rekordboxRecentCount()
}

function readPlaylist(source: PlaylistSource, id: string): Promise<SourcePlaylistEntry[]> {
  if (source === 'engine') return window.api.loadEnginePlaylist(id)
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
  const sources: PlaylistSource[] = [
    ...(isMac ? (['appleMusic'] as const) : []),
    ...(rekordbox ? (['rekordbox'] as const) : []),
    ...(import.meta.env.DEV ? (['engine'] as const) : []),
  ].filter((s) => !hiddenSources.includes(s))
  const engine = useQuery({
    queryKey: ['source-available', 'engine'],
    queryFn: () => window.api.engineAvailable(),
    enabled: source === 'engine',
    staleTime: Number.POSITIVE_INFINITY,
  })

  const tree = useQuery({
    queryKey: ['source-tree', source],
    queryFn: () => readTree(source as PlaylistSource),
    enabled: source !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const hasRecent = source === 'rekordbox' || source === 'engine'
  const recent = useQuery({
    queryKey: ['source-tree', source, 'recent'],
    queryFn: () => readRecentCount(source as PlaylistSource),
    enabled: hasRecent,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const shownTree = useMemo(
    () =>
      hasRecent && tree.data && recent.data !== undefined
        ? [
            {
              id: RECENTLY_ADDED_ID,
              name: tr('sources.recentlyAdded'),
              kind: 'playlist' as const,
              count: recent.data,
            },
            ...tree.data,
          ]
        : tree.data,
    [hasRecent, tree.data, recent.data, tr],
  )
  const entries = useQuery({
    queryKey: ['source-playlist', source, playlist?.id],
    queryFn: () => readPlaylist(source as PlaylistSource, playlist?.id as string),
    enabled: source !== null && playlist !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const separator = useQuery({
    queryKey: ['source-separator'],
    queryFn: () => window.api.rekordboxHasSeparator(),
    enabled: source === 'rekordbox',
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
  })

  return {
    sources,
    source,
    playlist,
    tree:
      source === 'appleMusic' && tree.data
        ? withReadCounts(tree.data, (id) => {
            const read = queryClient.getQueryData<SourcePlaylistEntry[]>([
              'source-playlist',
              'appleMusic',
              id,
            ])
            return read && distinctTracks(read)
          })
        : shownTree,
    treeFailed: tree.isError,
    libraryMissing: source === 'engine' && engine.data === false,
    entries: entries.data,
    entriesLoading: source !== null && playlist !== null && entries.isPending,
    entriesFailed: source !== null && playlist !== null && entries.isError,
    canInsertSeparator: separator.data ?? false,
    selectSource: setSource,
    selectPlaylist: (node, folders) => {
      if (!source) return
      setPlaylists((all) => ({ ...all, [source]: { id: node.id, name: node.name, folders } }))
    },
  }
}
