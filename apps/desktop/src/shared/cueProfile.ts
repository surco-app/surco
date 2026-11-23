import type { DropTaste, TasteCheck } from './autoCue'
import type { CueFlow } from './cueFlows'

export type { TasteTrack } from './autoCue'

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
  edits: { count: number; sinceLearn: number; corrected: number }
  marked: number
}
