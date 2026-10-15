import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
export function useSourceBrowser(): SourceBrowser {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<PlaylistSource | null>(null)
  const [playlist, setPlaylist] = useState<SourceBrowser['playlist']>(null)
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

  // A playlist deleted in rekordbox while it was open: once the re-read tree no longer
  // holds it, the list goes back to the tree instead of showing rows of a playlist that is
  // gone. The tree stays open where it was, which is the "back to the folder" of the spec.
  const openId = playlist?.id
  useEffect(() => {
    if (openId && tree.data && !containsNode(tree.data, openId)) setPlaylist(null)
  }, [openId, tree.data])

  useWindowFocus((focused) => {
    if (!focused) return
    queryClient.invalidateQueries({ queryKey: ['source-available'] })
    queryClient.invalidateQueries({ queryKey: ['source-tree'] })
    queryClient.invalidateQueries({ queryKey: ['source-playlist'] })
  })

  return {
    sources,
    source,
    playlist,
    tree: tree.data,
    treeFailed: tree.isError,
    entries: entries.data,
    selectSource: (next) => {
      setSource(next)
      setPlaylist(null)
    },
    selectPlaylist: (node, folders) => setPlaylist({ id: node.id, name: node.name, folders }),
  }
}
