import { ALL_SLOTS, type CueSlots, HOT_KINDS } from '../../../shared/cueRules'
import { type DjProgram, programOf } from '../../../shared/djProgram'
import { TRAKTOR_CUE_COLOR, TRAKTOR_SLOTS } from '../../../shared/traktorContent'

export interface CueProgram {
  slots: CueSlots
  readsAudio: boolean
  surcoGrid: boolean
  provisionalHelp: string | null
  writesCalls: boolean
  fixedColour: number | null
  colourHelp: string | null
  collectionGate: 'traktor' | null
  callsNote: { key: string; testId: string } | null
  runningNote: { key: string; testId: string } | null
  saveAllKey: string
  fixedGrid: string | null
  takesFlows: boolean
  twinsOnSurcoGrid: boolean
}

export const CUE_PROGRAMS: Record<DjProgram, CueProgram> = {
  rekordbox: {
    slots: ALL_SLOTS,
    readsAudio: false,
    surcoGrid: true,
    provisionalHelp: 'editor.cues.provisional.help',
    writesCalls: true,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: null,
    runningNote: null,
    saveAllKey: 'editor.cues.saveAll',
    fixedGrid: null,
    takesFlows: true,
    twinsOnSurcoGrid: false,
  },
  traktor: {
    slots: TRAKTOR_SLOTS,
    readsAudio: true,
    surcoGrid: true,
    provisionalHelp: null,
    writesCalls: false,
    fixedColour: TRAKTOR_CUE_COLOR,
    colourHelp: 'editor.cues.traktor.colours',
    collectionGate: 'traktor',
    callsNote: { key: 'editor.cues.traktor.calls', testId: 'cues-traktor-calls' },
    runningNote: null,
    saveAllKey: 'editor.cues.traktor.saveAll',
    fixedGrid: null,
    takesFlows: true,
    twinsOnSurcoGrid: false,
  },
  engine: {
    slots: ALL_SLOTS,
    readsAudio: true,
    surcoGrid: false,
    provisionalHelp: null,
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: { key: 'editor.cues.engine.calls', testId: 'cues-engine-calls' },
    runningNote: null,
    saveAllKey: 'editor.cues.engine.saveAll',
    fixedGrid: null,
    takesFlows: true,
    twinsOnSurcoGrid: false,
  },
  serato: {
    slots: { kinds: HOT_KINDS, pairCalls: false },
    readsAudio: true,
    surcoGrid: false,
    provisionalHelp: null,
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: { key: 'editor.cues.serato.calls', testId: 'cues-serato-calls' },
    runningNote: { key: 'editor.cues.serato.waiting', testId: 'cues-serato-waiting' },
    saveAllKey: 'editor.cues.serato.saveAll',
    fixedGrid: 'editor.cues.grid.serato',
    takesFlows: true,
    twinsOnSurcoGrid: false,
  },
  virtualdj: {
    slots: { kinds: HOT_KINDS, pairCalls: false },
    readsAudio: true,
    surcoGrid: true,
    provisionalHelp: 'editor.cues.virtualdj.provisionalHelp',
    writesCalls: false,
    fixedColour: null,
    colourHelp: null,
    collectionGate: null,
    callsNote: { key: 'editor.cues.virtualdj.calls', testId: 'cues-virtualdj-calls' },
    runningNote: { key: 'editor.cues.virtualdj.waiting', testId: 'cues-virtualdj-waiting' },
    saveAllKey: 'editor.cues.virtualdj.saveAll',
    fixedGrid: 'editor.cues.grid.virtualdj',
    takesFlows: true,
    twinsOnSurcoGrid: true,
  },
}

export const cueProgramOf = (contentId: string): CueProgram => CUE_PROGRAMS[programOf(contentId)]

export function programsOfSave(reqs: { contentId: string }[]): DjProgram[] {
  return [...new Set(reqs.map((r) => programOf(r.contentId)))]
}
