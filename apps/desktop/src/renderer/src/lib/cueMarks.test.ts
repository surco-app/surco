import { describe, expect, it } from 'vitest'
import { HOT_MARK_PX, markStyle, placeCues, visibleGhost, WAVE_MARK_LANE_PX } from './cueMarks'

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

describe('visibleGhost', () => {
  const cues = [
    { key: 'a', ms: 32000, kind: 1, color: 22 },
    { key: 'c', ms: 32000, kind: 0, color: null },
    { key: 'b', ms: 64000, kind: 2, color: 42 },
  ]

  it('leaves out what the flow would add where a cue of the same type already sits, so a placed cue never looks like a preview', () => {
    const shown = visibleGhost(
      {
        added: [
          { key: 'g1', ms: 32020, kind: 3, color: 1 },
          { key: 'g2', ms: 32000, kind: 0, color: null },
          { key: 'g3', ms: 64000, kind: 0, color: null },
          { key: 'g4', ms: 96000, kind: 4, color: 1 },
        ],
        gone: [],
      },
      cues,
    )
    expect(shown?.added.map((c) => c.key)).toEqual(['g3', 'g4'])
  })

  it('drops no dashed outline on a spot a real cue holds', () => {
    const shown = visibleGhost(
      {
        added: [],
        gone: [],
        rejected: [
          { ms: 64000, place: 'call', color: null },
          { ms: 96000, place: 'hot', color: 1 },
        ],
      },
      cues,
    )
    expect(shown?.rejected?.map((r) => r.ms)).toEqual([96000])
  })

  it('still previews the replacement of a cue the flow would take away', () => {
    const shown = visibleGhost(
      {
        added: [{ key: 'g1', ms: 32000, kind: 1, color: 1 }],
        gone: ['a'],
        rejected: [{ ms: 32000, place: 'hot', color: 1 }],
      },
      cues.filter((c) => c.kind !== 0),
    )
    expect(shown?.added.map((c) => c.key)).toEqual(['g1'])
    expect(shown?.rejected).toHaveLength(1)
  })
})
