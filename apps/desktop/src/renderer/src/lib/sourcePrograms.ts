import type { DjProgram } from '../../../shared/djProgram'
import type { SourceNode, SourcePlaylistEntry } from '../../../shared/types'

export interface SourceRead {
  available(): Promise<boolean>
  tree(): Promise<SourceNode[]>
  recentCount(): Promise<number>
  trackCount(): Promise<number>
  playlist(id: string): Promise<SourcePlaylistEntry[]>
  membership(paths: string[]): Promise<Record<string, string[]>>
}

export const SOURCE_READ: Record<DjProgram, SourceRead> = {
  rekordbox: {
    available: () => window.api.rekordboxAvailable(),
    tree: () => window.api.loadRekordboxTree(),
    recentCount: () => window.api.rekordboxRecentCount(),
    trackCount: () => window.api.rekordboxTrackCount(),
    playlist: (id) => window.api.loadRekordboxPlaylist(id),
    membership: (paths) => window.api.rekordboxMembership(paths),
  },
  traktor: {
    available: () => window.api.traktorAvailable(),
    tree: () => window.api.loadTraktorTree(),
    recentCount: () => window.api.traktorRecentCount(),
    trackCount: () => window.api.traktorTrackCount(),
    playlist: (id) => window.api.loadTraktorPlaylist(id),
    membership: (paths) => window.api.traktorMembership(paths),
  },
  engine: {
    available: () => window.api.engineAvailable(),
    tree: () => window.api.loadEngineTree(),
    recentCount: () => window.api.engineRecentCount(),
    trackCount: () => window.api.engineTrackCount(),
    playlist: (id) => window.api.loadEnginePlaylist(id),
    membership: (paths) => window.api.engineMembership(paths),
  },
}
