import { describe, expect, it } from 'vitest'
import { markStyle, placeCues } from './cueMarks'

describe('placeCues', () => {
  it('puts a CALL right under its hot cue even when rekordbox stored it a few ms apart', () => {
    const { hot, calls } = placeCues(
      [
        { key: 'a', ms: 32000, kind: 1, color: 1 },
        { key: 'b', ms: 32030, kind: 0, color: null },
      ],
      128000,
    )
    expect(hot[0]).toMatchObject({ at: 25, letter: 'A', colour: '#305aff' })
    expect(calls).toEqual([{ key: 'b', ms: 32030, at: 25, paired: true }])
  })

  it('draws one CALL for CALLs stacked at the same spot and a lone CALL as a drop', () => {
    const { calls } = placeCues(
      [
        { key: 'a', ms: 64000, kind: 0, color: null },
        { key: 'b', ms: 64000, kind: 0, color: null },
      ],
      128000,
    )
    expect(calls).toEqual([{ key: 'a', ms: 64000, at: 50, paired: false }])
  })

  it('places nothing it cannot place, for a track with no length or a cue past the end', () => {
    expect(placeCues([{ key: 'a', ms: 1000, kind: 1, color: 1 }], 0)).toEqual({
      hot: [],
      calls: [],
    })
    expect(placeCues([{ key: 'a', ms: 9000, kind: 0, color: null }], 8000).calls).toEqual([])
  })
})

describe('markStyle', () => {
  it('centres both marks on the same spot and puts every CALL at one height under the squares', () => {
    expect(markStyle(25, 'hot', 'row')).toEqual({
      left: '25%',
      top: '0px',
      transform: 'translateX(-50%)',
    })
    expect(markStyle(25, 'call', 'row')).toEqual({
      left: '25%',
      top: '13px',
      transform: 'translateX(-50%)',
    })
    expect(markStyle(25, 'call', 'wave').top).toBe('15px')
  })
})
