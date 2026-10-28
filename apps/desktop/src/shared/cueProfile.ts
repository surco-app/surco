import type { CueFlow } from './cueFlows'
import type { DropTaste, TasteCheck } from './dropTaste'

export type { TasteTrack } from './dropTaste'

export interface CueProfile {
  learnedAt: string
  sources: { rekordbox: number; edits: number }
  taste: DropTaste | null
  check: TasteCheck | null
  flow: CueFlow | null
  coverage: { matching: number; marked: number } | null
  paired: number | null
  start: { open: number; withStart: number } | null
}

export interface CueProfileRead {
  profile: CueProfile | null
  edits: { count: number; sinceLearn: number }
  marked: number
}
