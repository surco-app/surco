import { ALL_SLOTS, type CueSlots, HOT_KINDS } from '../../../shared/cueRules'
import { type DjProgram, programOf } from '../../../shared/djProgram'
import { TRAKTOR_CUE_COLOR, TRAKTOR_SLOTS } from '../../../shared/traktorContent'

export interface CueProgram {
  slots: CueSlots
  readsAudio: boolean
  surcoGrid: boolean
  writesCalls: boolean
  fixedColour: number | null
  colourHelp: string | null
  collectionGate: 'traktor' | null
  callsNote: { key: string; testId: string } | null
  runningNote: { key: string; testId: string } | null
  saveAllKey: string
  fixedGrid: string | null
}

export const CUE_PROGRAMS: Record<DjProgram, CueProgram> = {
  rekordbox: {
    slots: ALL_SLOTS,
    readsAudio: false,
    surcoGrid: true,
    writesCalls: true,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: null,
    runningNote: null,
    saveAllKey: 'editor.cues.saveAll',
    fixedGrid: null,
  },
  traktor: {
    slots: TRAKTOR_SLOTS,
    readsAudio: true,
    surcoGrid: true,
    writesCalls: false,
    fixedColour: TRAKTOR_CUE_COLOR,
    colourHelp: 'editor.cues.traktor.colours',
    collectionGate: 'traktor',
    callsNote: { key: 'editor.cues.traktor.calls', testId: 'cues-traktor-calls' },
    runningNote: null,
    saveAllKey: 'editor.cues.traktor.saveAll',
    fixedGrid: null,
  },
  engine: {
    slots: ALL_SLOTS,
    readsAudio: true,
    surcoGrid: false,
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: { key: 'editor.cues.engine.calls', testId: 'cues-engine-calls' },
    runningNote: null,
    saveAllKey: 'editor.cues.engine.saveAll',
    fixedGrid: null,
  },
  serato: {
    slots: { kinds: HOT_KINDS, pairCalls: false },
    readsAudio: true,
    surcoGrid: false,
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: { key: 'editor.cues.serato.calls', testId: 'cues-serato-calls' },
    runningNote: { key: 'editor.cues.serato.waiting', testId: 'cues-serato-waiting' },
    saveAllKey: 'editor.cues.serato.saveAll',
    fixedGrid: 'editor.cues.grid.serato',
  },
  virtualdj: {
    slots: { kinds: HOT_KINDS, pairCalls: false },
    readsAudio: true,
    surcoGrid: false,
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: null,
    runningNote: { key: 'editor.cues.virtualdj.waiting', testId: 'cues-virtualdj-waiting' },
    saveAllKey: 'editor.cues.virtualdj.saveAll',
    fixedGrid: null,
  },
}

export const cueProgramOf = (contentId: string): CueProgram => CUE_PROGRAMS[programOf(contentId)]
