import { describe, expect, it } from 'vitest'
import { ALL_SLOTS, HOT_KINDS } from '../../../shared/cueRules'
import { TRAKTOR_CUE_COLOR, TRAKTOR_SLOTS } from '../../../shared/traktorContent'
import { CUE_PROGRAMS, cueProgramOf } from './cuePrograms'

describe('CUE_PROGRAMS keeps what the cue editor does for each DJ program', () => {
  it('gives rekordbox every slot, reads its stored waveform, fills a missing grid with Surco’s, lets the DJ colour cues and keeps its CALLs', () => {
    expect(CUE_PROGRAMS.rekordbox).toEqual({
      slots: ALL_SLOTS,
      readsAudio: false,
      surcoGrid: true,
      writesCalls: true,
      fixedColour: null,
      colourHelp: null,
      collectionGate: null,
      callsNote: null,
      saveAllKey: 'editor.cues.saveAll',
    })
  })

  it('gives Traktor only its own slots, reads the audio, fills a missing grid with Surco’s, paints every cue its blue and waits for a confirmed collection', () => {
    expect(CUE_PROGRAMS.traktor).toEqual({
      slots: TRAKTOR_SLOTS,
      readsAudio: true,
      surcoGrid: true,
      writesCalls: false,
      fixedColour: TRAKTOR_CUE_COLOR,
      colourHelp: 'editor.cues.traktor.colours',
      collectionGate: 'traktor',
      callsNote: { key: 'editor.cues.traktor.calls', testId: 'cues-traktor-calls' },
      saveAllKey: 'editor.cues.traktor.saveAll',
    })
  })

  it('gives Engine DJ every slot, reads the audio, never measures Surco’s grid and warns its CALLs are not kept', () => {
    expect(CUE_PROGRAMS.engine).toEqual({
      slots: ALL_SLOTS,
      readsAudio: true,
      surcoGrid: false,
      writesCalls: false,
      fixedColour: null,
      colourHelp: null,
      collectionGate: null,
      callsNote: { key: 'editor.cues.engine.calls', testId: 'cues-engine-calls' },
      saveAllKey: 'editor.cues.engine.saveAll',
    })
  })

  it('gives Serato its eight hot cues and a free colour, reads the audio and warns its CALLs are not kept', () => {
    expect(CUE_PROGRAMS.serato).toEqual({
      slots: { kinds: HOT_KINDS, pairCalls: false },
      readsAudio: true,
      surcoGrid: false,
      writesCalls: false,
      fixedColour: null,
      colourHelp: null,
      collectionGate: null,
      callsNote: { key: 'editor.cues.serato.calls', testId: 'cues-serato-calls' },
      saveAllKey: 'editor.cues.serato.saveAll',
    })
  })
})

describe('cueProgramOf picks the entry by the track’s program', () => {
  it('gives a Traktor track the Traktor slots', () => {
    expect(cueProgramOf('traktor:x').slots).toBe(TRAKTOR_SLOTS)
  })

  it('reads the audio of an Engine DJ track', () => {
    expect(cueProgramOf('engine:1').readsAudio).toBe(true)
  })

  it('reads the stored waveform of a rekordbox track', () => {
    expect(cueProgramOf('1').readsAudio).toBe(false)
  })
})
