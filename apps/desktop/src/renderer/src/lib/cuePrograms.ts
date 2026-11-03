import { ALL_SLOTS, type CueSlots } from '../../../shared/cueRules'
import { type DjProgram, programOf } from '../../../shared/djProgram'
import { TRAKTOR_CUE_COLOR, TRAKTOR_SLOTS } from '../../../shared/traktorContent'

export interface CueProgram {
  slots: CueSlots
  readsAudio: boolean
  surcoGrid: boolean
  writesCalls: boolean
  fixedColour: number | null
  colourHelp: string | null
  collectionGate: boolean
  callsNote: { key: string; testId: string } | null
  saveAllKey: string
}

export const CUE_PROGRAMS: Record<DjProgram, CueProgram> = {
  rekordbox: {
    slots: ALL_SLOTS,
    readsAudio: false,
    surcoGrid: true,
    writesCalls: true,
    fixedColour: null,
    colourHelp: null,
    collectionGate: false,
    callsNote: null,
    saveAllKey: 'editor.cues.saveAll',
  },
  traktor: {
    slots: TRAKTOR_SLOTS,
    readsAudio: true,
    surcoGrid: true,
    writesCalls: false,
    fixedColour: TRAKTOR_CUE_COLOR,
    colourHelp: 'editor.cues.traktor.colours',
    collectionGate: true,
    callsNote: { key: 'editor.cues.traktor.calls', testId: 'cues-traktor-calls' },
    saveAllKey: 'editor.cues.traktor.saveAll',
  },
  engine: {
    slots: ALL_SLOTS,
    readsAudio: true,
    surcoGrid: false,
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: false,
    callsNote: { key: 'editor.cues.engine.calls', testId: 'cues-engine-calls' },
    saveAllKey: 'editor.cues.engine.saveAll',
  },
}

export const cueProgramOf = (contentId: string): CueProgram => CUE_PROGRAMS[programOf(contentId)]
