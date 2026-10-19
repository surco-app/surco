import { describe, expect, it } from 'vitest'
import { classify, findDrops, fitsPlan, nearestBeat, planCues, strongParts } from './cueRules'

const BPM = 145.0
const BAR_MS = 240000 / BPM
const BEAT_MS = BAR_MS / 4
const grid = (bars: number): number[] =>
  Array.from({ length: bars * 4 }, (_, i) => Math.round(i * BEAT_MS))
const beat = (bars: number): number => Math.round(bars * 4 * BEAT_MS)
const cue = (ms: number, kind: 16 | 32 | 48 | 'inicio') => ({ ms, kind })

describe('findDrops', () => {
  it('memory cue paired with hot cue is not a drop', () => {
    expect(findDrops([105, 26588, 79554], [105, 26588])).toEqual([79554])
  })

  it('drops are sorted because rekordbox returns cues unordered', () => {
    expect(findDrops([90000, 30000], [])).toEqual([30000, 90000])
  })
})

describe('classify', () => {
  it('each distance has its own color so it reads the same in every track', () => {
    const drop = 100 * BAR_MS
    for (const bars of [16, 32, 48] as const)
      expect(classify(drop - bars * BAR_MS, [drop], BPM).kind).toBe(bars)
  })

  it('only the next drop counts', () => {
    expect(classify(104 * BAR_MS, [40 * BAR_MS, 120 * BAR_MS], BPM).kind).toBe(16)
  })

  it('start cue with odd intro length is marked as start', () => {
    expect(classify(77, [12 * BAR_MS + 77], BPM).kind).toBe('inicio')
  })

  it('start cue at exact distance keeps distance color', () => {
    expect(classify(0, [48 * BAR_MS], BPM).kind).toBe(48)
  })

  it('odd distance is left for manual review', () => {
    expect(classify(10000, [10000 + 56 * BAR_MS], BPM).kind).toBeNull()
  })

  it('cue after last drop is left for manual review', () => {
    expect(classify(200000, [100000], BPM).kind).toBeNull()
  })
})

describe('planCues', () => {
  it('long intro gets the full countdown so every drop can be reached from 48 bars', () => {
    expect(planCues([beat(64)], grid(200))).toEqual([
      cue(beat(16), 48),
      cue(beat(32), 32),
      cue(beat(48), 16),
    ])
  })

  it('countdown stops at track start because cues cannot exist before it', () => {
    expect(planCues([beat(40)], grid(200))).toEqual([cue(beat(8), 32), cue(beat(24), 16)])
  })

  it('countdown never reaches the previous drop so it stays detectable as a drop', () => {
    expect(planCues([beat(16), beat(48)], grid(200))).toEqual([cue(beat(0), 16), cue(beat(32), 16)])
  })

  it('intro too short for blue gets a yellow entry point', () => {
    expect(planCues([beat(12)], grid(200))).toEqual([cue(0, 'inicio')])
  })

  it('track without drops is left unmarked so it still looks pending', () => {
    expect(planCues([], grid(200))).toEqual([])
  })

  it('countdown follows the real beatgrid so tempo changes do not misplace cues', () => {
    const beats = [
      ...Array.from({ length: 100 }, (_, i) => i * 500),
      ...Array.from({ length: 200 }, (_, i) => 50000 + i * 400),
    ]
    expect(planCues([beats[164]], beats)).toEqual([cue(beats[36], 32), cue(beats[100], 16)])
  })

  it('blue survives the 8 cue limit because it is the cue that matters most', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    const plan = planCues(drops, grid(400))
    expect(plan).toHaveLength(8)
    expect(plan.filter((p) => p.kind === 16)).toHaveLength(4)
    expect(plan.map((p) => p.kind)).not.toContain(48)
  })
})

describe('strong parts', () => {
  it('countdown stops inside a strong part because the track has not dropped yet', () => {
    expect(planCues([beat(64)], grid(200), [{ start: beat(0), end: beat(40) }])).toEqual([
      cue(beat(48), 16),
    ])
  })

  it('countdown stops at the first strong part even if earlier cues would be outside it', () => {
    expect(planCues([beat(64)], grid(200), [{ start: beat(24), end: beat(40) }])).toEqual([
      cue(beat(48), 16),
    ])
  })

  it('cue where the break begins is kept', () => {
    expect(planCues([beat(64)], grid(200), [{ start: beat(0), end: beat(32) }])).toEqual([
      cue(beat(32), 32),
      cue(beat(48), 16),
    ])
  })

  it('chorus kind depends on rekordbox mood', () => {
    const beats = grid(200)
    expect(
      strongParts(
        1,
        [
          { beat: 1, kind: 1 },
          { beat: 33, kind: 5 },
          { beat: 65, kind: 3 },
        ],
        beats,
      ),
    ).toEqual([{ start: beats[32], end: beats[64] }])
    expect(
      strongParts(
        2,
        [
          { beat: 1, kind: 1 },
          { beat: 33, kind: 9 },
          { beat: 65, kind: 8 },
        ],
        beats,
      ),
    ).toEqual([{ start: beats[32], end: beats[64] }])
  })

  it('last phrase runs until the end of the track', () => {
    const beats = grid(200)
    expect(
      strongParts(
        1,
        [
          { beat: 1, kind: 1 },
          { beat: 33, kind: 5 },
        ],
        beats,
      ),
    ).toEqual([{ start: beats[32], end: beats[beats.length - 1] }])
  })

  it('phrases beyond the beatgrid are ignored because rekordbox analyses can disagree', () => {
    const beats = grid(10)
    expect(
      strongParts(
        1,
        [
          { beat: 1, kind: 5 },
          { beat: 33, kind: 5 },
          { beat: 65, kind: 5 },
        ],
        beats,
      ),
    ).toEqual([
      { start: beats[0], end: beats[32] },
      { start: beats[32], end: beats[beats.length - 1] },
    ])
  })
})

describe('nearestBeat', () => {
  it('keeps the earlier beat on a tie, as Python min does, so a drop clicked between two beats does not move', () => {
    expect(nearestBeat([0, 100], 50)).toBe(0)
  })

  it('snaps a click before the first beat to the first beat', () => {
    expect(nearestBeat([500, 1000], 0)).toBe(0)
  })
})

describe('fitsPlan', () => {
  it('existing cues on planned positions can be completed', () => {
    expect(fitsPlan([beat(48) + 1], [cue(beat(16), 48), cue(beat(48), 16)])).toBe(true)
  })

  it('cue placed elsewhere blocks the track so manual work is never overwritten', () => {
    expect(fitsPlan([beat(40)], [cue(beat(16), 48), cue(beat(48), 16)])).toBe(false)
  })

  it('manual yellow at track start is respected', () => {
    expect(fitsPlan([1], [cue(beat(48), 16)])).toBe(true)
  })
})
