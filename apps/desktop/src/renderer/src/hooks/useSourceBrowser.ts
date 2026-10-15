import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { PlaylistSource, SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import { musicEntries, musicTree } from '../lib/appleMusicSource'
import { useWindowFocus } from './useWindowFocus'

export interface SourceBrowser {
  sources: PlaylistSource[]
  source: PlaylistSource | null
  playlist: { id: string; name: string; folders: string[] } | null
  tree: SourceNode[] | undefined
  treeFailed: boolean
  entries: SourcePlaylistEntry[] | undefined
  entriesLoading: boolean
  canInsertSeparator: boolean
  selectSource: (source: PlaylistSource | null) => void
  selectPlaylist: (node: SourceNode, folders: string[]) => void
}

function containsNode(nodes: SourceNode[], id: string): boolean {
  return nodes.some((n) => n.id === id || (n.children ? containsNode(n.children, id) : false))
}

function readTree(source: PlaylistSource): Promise<SourceNode[]> {
  return source === 'rekordbox'
    ? window.api.loadRekordboxTree()
    : window.api.loadAppleMusicPlaylists().then(musicTree)
}

function readPlaylist(source: PlaylistSource, id: string): Promise<SourcePlaylistEntry[]> {
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
}: {
  onPlaylistGone: (name: string, source: PlaylistSource) => void
}): SourceBrowser {
  const queryClient = useQueryClient()
  const onPlaylistGoneRef = useRef(onPlaylistGone)
  onPlaylistGoneRef.current = onPlaylistGone
  const [source, setSource] = useState<PlaylistSource | null>(null)
  const [playlists, setPlaylists] = useState<
    Partial<Record<PlaylistSource, NonNullable<SourceBrowser['playlist']>>>
  >({})
  const playlist = source ? (playlists[source] ?? null) : null
  const isMac = window.api.platform === 'darwin'

  const { data: rekordbox = false } = useQuery({
    queryKey: ['source-available', 'rekordbox'],
    queryFn: () => window.api.rekordboxAvailable(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const sources: PlaylistSource[] = [
    ...(isMac ? (['appleMusic'] as const) : []),
    ...(rekordbox ? (['rekordbox'] as const) : []),
  ]

  const tree = useQuery({
    queryKey: ['source-tree', source],
    queryFn: () => readTree(source as PlaylistSource),
    enabled: source !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
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
    if (!playlist || !source || !tree.data || containsNode(tree.data, playlist.id)) return
    setPlaylists(({ [source]: _, ...rest }) => rest)
    onPlaylistGoneRef.current(playlist.name, source)
  }, [playlist, source, tree.data])

  useWindowFocus((focused) => {
    if (!focused) return
    queryClient.invalidateQueries({ queryKey: ['source-available'] })
    queryClient.invalidateQueries({ queryKey: ['source-tree'] })
    queryClient.invalidateQueries({ queryKey: ['source-playlist'] })
    queryClient.invalidateQueries({ queryKey: ['source-separator'] })
  })

  return {
    sources,
    source,
    playlist,
    tree: tree.data,
    treeFailed: tree.isError,
    entries: entries.data,
    entriesLoading: source !== null && playlist !== null && entries.isPending,
    canInsertSeparator: separator.data ?? false,
    selectSource: setSource,
    selectPlaylist: (node, folders) => {
      if (!source) return
      setPlaylists((all) => ({ ...all, [source]: { id: node.id, name: node.name, folders } }))
    },
  }
}
