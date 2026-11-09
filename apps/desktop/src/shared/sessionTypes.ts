export type PlaylistRole = 'base' | 'vocal' | 'any' | 'set'

export type TrackRole = 'base' | 'vocal' | 'any'

export interface SessionTrack {
  id: string
  role: TrackRole
  key: string | null
  bpm: number
  rating: number
  plays: number
  secs: number
  fresh: boolean
  title: string
  artist: string
}
