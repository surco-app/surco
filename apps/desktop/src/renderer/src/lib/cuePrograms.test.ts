import { describe, expect, it } from 'vitest'
import { ALL_SLOTS } from '../../../shared/cueRules'
import { TRAKTOR_SLOTS } from '../../../shared/traktorContent'
import { CUE_PROGRAMS, cueProgramOf } from './cuePrograms'

describe('CUE_PROGRAMS keeps what the cue editor does for each DJ program', () => {
  it('gives rekordbox every slot, reads its stored waveform and fills a missing grid with Surco’s', () => {
    expect(CUE_PROGRAMS.rekordbox).toEqual({ slots: ALL_SLOTS, readsAudio: false, surcoGrid: true })
  })

  it('gives Traktor only its own slots, reads the audio and fills a missing grid with Surco’s', () => {
    expect(CUE_PROGRAMS.traktor).toEqual({
      slots: TRAKTOR_SLOTS,
      readsAudio: true,
      surcoGrid: true,
    })
  })

  it('gives Engine DJ every slot, reads the audio and never measures Surco’s grid', () => {
    expect(CUE_PROGRAMS.engine).toEqual({ slots: ALL_SLOTS, readsAudio: true, surcoGrid: false })
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
