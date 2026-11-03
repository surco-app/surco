import { ALL_SLOTS, type CueSlots } from '../../../shared/cueRules'
import { type DjProgram, programOf } from '../../../shared/djProgram'
import { TRAKTOR_SLOTS } from '../../../shared/traktorContent'

export interface CueProgram {
  slots: CueSlots
  readsAudio: boolean
  surcoGrid: boolean
}

export const CUE_PROGRAMS: Record<DjProgram, CueProgram> = {
  rekordbox: { slots: ALL_SLOTS, readsAudio: false, surcoGrid: true },
  traktor: { slots: TRAKTOR_SLOTS, readsAudio: true, surcoGrid: true },
  engine: { slots: ALL_SLOTS, readsAudio: true, surcoGrid: false },
}

export const cueProgramOf = (contentId: string): CueProgram => CUE_PROGRAMS[programOf(contentId)]
