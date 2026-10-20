import { describe, expect, it } from 'vitest'
import { HOT_MARK_PX, markStyle, placeCues, WAVE_MARK_LANE_PX } from './cueMarks'

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
  it('centres every mark on its spot at the top, so a CALL sits at the height of its hot cue and is drawn behind it', () => {
    expect(markStyle(25)).toEqual({
      left: 'clamp(6px, 25%, calc(100% - 6px))',
      top: '0px',
      transform: 'translateX(-50%)',
    })
  })

  it('keeps a mark at the very start or end fully inside the strip, since half a square hides its letter', () => {
    expect(markStyle(0).left).toBe('clamp(6px, 0%, calc(100% - 6px))')
    expect(markStyle(100).left).toBe('clamp(6px, 100%, calc(100% - 6px))')
  })

  it('needs a lane of one row of marks, since CALLs no longer stack under the squares', () => {
    expect(WAVE_MARK_LANE_PX).toBe(HOT_MARK_PX.wave + 1)
  })
})
