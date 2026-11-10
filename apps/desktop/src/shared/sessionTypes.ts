export type PlaylistRole = 'base' | 'vocal' | 'any'

export type SessionHarmony = 'free' | 'neighbours' | 'same'

export interface SessionWizardSettings {
  minutes: number
  playMinutes: number
  freshShare: number
  preferCombos: boolean
  harmony: SessionHarmony
  tasteWeight: boolean
  alternate: boolean
  surprise: boolean
}

export interface SessionAnswers extends SessionWizardSettings {
  sources: string[]
}

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
  song?: string
  acts?: readonly string[]
}
