import { describe, expect, it } from 'vitest'
import {
  adjacentCall,
  barsToNextCall,
  callAt,
  cueClock,
  DEFAULT_ZOOM_BARS,
  detailWindow,
  jumpBeats,
  zoomStep,
} from './cuePlayhead'

const beats = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => n * 2000
const cues = [
  { key: 'a', ms: 10000, kind: 0 },
  { key: 'b', ms: 20000, kind: 1 },
  { key: 'c', ms: 20000, kind: 0 },
  { key: 'd', ms: 30000, kind: 0 },
]

describe('jumpBeats', () => {
  it('moves a whole number of beats and keeps the offset, so a jump while playing stays in time', () => {
    expect(jumpBeats(beats, bar(32), 64)).toBe(bar(48))
    expect(jumpBeats(beats, bar(32) + 200, 4)).toBe(bar(33) + 200)
    expect(jumpBeats(beats, bar(32), -1)).toBe(bar(32) - 500)
  })

  it('stops at the start of the track and at the last beat instead of leaving the track', () => {
    expect(jumpBeats(beats, 1000, -64)).toBe(0)
    expect(jumpBeats(beats, 399000, 64)).toBe(399500)
  })

  it('never moves backward on a forward jump from past the last beat', () => {
    expect(jumpBeats(beats, 399800, 64)).toBe(399800)
    expect(jumpBeats(beats, 399800, 1)).toBe(399800)
  })

  it('counts beats of the grid, not milliseconds, across a tempo change', () => {
    const changing = [0, 500, 1000, 1500, 2000, 2400, 2800, 3200, 3600, 4000]
    expect(jumpBeats(changing, 1600, 4)).toBe(3300)
    expect(jumpBeats(changing, 3300, -4)).toBe(1600)
  })

  it('goes back to 0 on a grid that starts late rather than forward to its first beat', () => {
    const late = Array.from({ length: 100 }, (_, i) => 2000 + i * 500)
    expect(jumpBeats(late, 3000, -16)).toBe(0)
  })
})

describe('CALL navigation', () => {
  it('walks the CALLs, skipping the one under the playhead and every hot cue', () => {
    expect(adjacentCall(cues, 20000, 1)).toBe(30000)
    expect(adjacentCall(cues, 20000, -1)).toBe(10000)
    expect(adjacentCall(cues, 30020, 1)).toBeNull()
    expect(adjacentCall(cues, 9990, -1)).toBeNull()
  })

  it('finds the CALL under the playhead within 50 ms, never a hot cue', () => {
    expect(callAt(cues, 20040)?.key).toBe('c')
    expect(callAt(cues, 20100)).toBeUndefined()
  })

  it('treats 50 ms as the same position and 51 ms as another one, as rekordbox does', () => {
    expect(callAt(cues, 20050)?.key).toBe('c')
    expect(callAt(cues, 19950)?.key).toBe('c')
    expect(callAt(cues, 20051)).toBeUndefined()
    expect(callAt(cues, 19949)).toBeUndefined()
    expect(adjacentCall(cues, 9950, 1)).toBe(20000)
    expect(adjacentCall(cues, 9949, 1)).toBe(10000)
    expect(adjacentCall(cues, 10050, -1)).toBeNull()
    expect(adjacentCall(cues, 10051, -1)).toBe(10000)
  })
})

describe('barsToNextCall', () => {
  it('counts bars of the grid to the next CALL, as rekordbox shows above the playhead', () => {
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 0 }], bar(32))).toBe(16)
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 0 }], bar(32) - 1000)).toBe(16.5)
  })

  it('counts beats of the grid across a tempo change, so the bars match the music', () => {
    const changing = [
      ...Array.from({ length: 16 }, (_, i) => i * 500),
      ...Array.from({ length: 16 }, (_, i) => 8000 + i * 400),
    ]
    expect(barsToNextCall(changing, [{ ms: 8000 + 8 * 400, kind: 0 }], 4000)).toBe(4)
    expect(barsToNextCall(changing, [{ ms: 8000 + 4 * 400, kind: 0 }], 8000 + 200)).toBe(0.875)
  })

  it('reads 0 on the CALL itself and nothing with no CALL ahead or no grid', () => {
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 0 }], bar(48) - 20)).toBe(0)
    expect(barsToNextCall(beats, [{ ms: bar(48), kind: 1 }], bar(32))).toBeNull()
    expect(barsToNextCall(beats, [{ ms: bar(8), kind: 0 }], bar(32))).toBeNull()
    expect(barsToNextCall([], [{ ms: bar(48), kind: 0 }], bar(32))).toBeNull()
  })
})

describe('zoom', () => {
  it('opens at 16 bars and steps through 4 to 64, stopping at both ends', () => {
    expect(DEFAULT_ZOOM_BARS).toBe(16)
    expect(zoomStep(16, 'in')).toBe(8)
    expect(zoomStep(16, 'out')).toBe(32)
    expect(zoomStep(4, 'in')).toBe(4)
    expect(zoomStep(64, 'out')).toBe(64)
    expect(zoomStep(12, 'in')).toBe(8)
  })

  it('centres a window of the visible bars on the playhead', () => {
    expect(detailWindow(beats, bar(32), 16)).toEqual({ fromMs: bar(24), toMs: bar(40) })
    expect(detailWindow(beats, 0, 4)).toEqual({ fromMs: -4000, toMs: 4000 })
  })
})

describe('cueClock', () => {
  it('writes minutes, seconds and tenths, never below zero', () => {
    expect(cueClock(0)).toBe('0:00.0')
    expect(cueClock(64000)).toBe('1:04.0')
    expect(cueClock(61999)).toBe('1:01.9')
    expect(cueClock(400000)).toBe('6:40.0')
    expect(cueClock(-5)).toBe('0:00.0')
  })
})
