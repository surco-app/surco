import { describe, expect, it } from 'vitest'
import { MY_FLOW } from './cueFlows'
import {
  type CueSlots,
  classify,
  cueChanges,
  type ExistingCue,
  findDrops,
  fitsPlan,
  flowOutcome,
  HOT_KINDS,
  isEmptyChange,
  nearestBeat,
  planCues,
  strongParts,
} from './cueRules'

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

describe('cueChanges', () => {
  let n = 0
  const id = () => `c${++n}`
  const hotAt = (ms: number, kind: number, color: number): ExistingCue => ({
    id: id(),
    ms,
    kind,
    color,
  })
  const memAt = (ms: number): ExistingCue => ({ id: id(), ms, kind: 0, color: null })
  const byMs = <T extends { ms: number; kind: number }>(a: T, b: T) =>
    a.ms - b.ms || a.kind - b.kind

  it('writes the drop and its countdown in A, B, C with their colours and a memory cue under each hot cue on a track without cues', () => {
    const out = cueChanges([], [beat(64)], [], grid(200), [])
    expect(out.status).toBe('plan')
    if (out.status !== 'plan') return
    expect([...out.changes.insert].sort(byMs)).toEqual([
      { ms: beat(16), kind: 0, color: null },
      { ms: beat(16), kind: 1, color: 42 },
      { ms: beat(32), kind: 0, color: null },
      { ms: beat(32), kind: 2, color: 22 },
      { ms: beat(48), kind: 0, color: null },
      { ms: beat(48), kind: 3, color: 1 },
      { ms: beat(64), kind: 0, color: null },
    ])
    expect(out.changes.update).toEqual([])
    expect(out.changes.remove).toEqual([])
    expect(out.hot).toEqual([
      { ms: beat(16), kind: 1, color: 42 },
      { ms: beat(32), kind: 2, color: 22 },
      { ms: beat(48), kind: 3, color: 1 },
    ])
  })

  it('reuses hot cues already on the plan and moves their letters because a new countdown shifts the letters after it', () => {
    const existing = [hotAt(0, 1, 32), hotAt(beat(48), 2, 1), memAt(beat(48)), memAt(beat(64))]
    const out = cueChanges(existing, [beat(64), beat(128)], [beat(64)], grid(200), [])
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.hot.map((h) => h.kind)).toEqual([1, 2, 3, 5, 6, 7, 8])
    expect(out.changes.update).toEqual([{ id: existing[1].id, kind: 5, color: 1 }])
    expect(out.changes.remove).toEqual([])
    expect(
      out.changes.insert
        .filter((c) => c.kind === 0)
        .map((c) => c.ms)
        .sort((a, b) => a - b),
    ).toEqual([0, beat(16), beat(32), beat(80), beat(96), beat(112), beat(128)])
  })

  it('writes only the drops when a hot cue placed by hand does not fit, so it is never touched', () => {
    const manual = hotAt(beat(40), 1, 1)
    const out = cueChanges([manual], [beat(64)], [], grid(200), [])
    expect(out).toEqual({
      status: 'manual',
      changes: { insert: [{ ms: beat(64), kind: 0, color: null }], update: [], remove: [] },
    })
  })

  it('removes the countdown of a drop the user took away with its paired memory cues so none reads as a new drop', () => {
    const plan = [
      [beat(16), 1, 42],
      [beat(32), 2, 22],
      [beat(48), 3, 1],
      [beat(80), 5, 42],
      [beat(96), 6, 22],
      [beat(112), 7, 1],
    ] as const
    const hot = plan.map(([ms, kind, color]) => hotAt(ms, kind, color))
    const paired = plan.map(([ms]) => memAt(ms))
    const drop64 = memAt(beat(64))
    const drop128 = memAt(beat(128))
    const out = cueChanges(
      [...hot, ...paired, drop64, drop128],
      [beat(64)],
      [beat(64), beat(128)],
      grid(200),
      [],
    )
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.changes.insert).toEqual([])
    expect(out.changes.update).toEqual([])
    expect([...out.changes.remove].sort()).toEqual(
      [
        hot[3].id,
        hot[4].id,
        hot[5].id,
        paired[3].id,
        paired[4].id,
        paired[5].id,
        drop128.id,
      ].sort(),
    )
  })

  it('keeps the new drop when it is moved onto a cue of the old countdown, writing the countdown with its drop', () => {
    const hot16 = hotAt(beat(16), 1, 42)
    const hot32 = hotAt(beat(32), 2, 22)
    const hot48 = hotAt(beat(48), 3, 1)
    const mem16 = memAt(beat(16))
    const mem32 = memAt(beat(32))
    const mem48 = memAt(beat(48))
    const oldDrop = memAt(beat(64))
    const out = cueChanges(
      [hot16, hot32, hot48, mem16, mem32, mem48, oldDrop],
      [beat(48)],
      [beat(64)],
      grid(200),
      [],
    )
    if (out.status !== 'plan') throw new Error(out.status)
    expect([...out.changes.remove].sort()).toEqual([hot48.id, oldDrop.id].sort())
    expect(out.changes.remove).not.toContain(mem48.id)
    expect(out.changes.insert).toEqual([
      { ms: 0, kind: 1, color: 42 },
      { ms: 0, kind: 0, color: null },
    ])
    expect(out.changes.update).toEqual([
      { id: hot16.id, kind: 2, color: 22 },
      { id: hot32.id, kind: 3, color: 1 },
    ])
    expect(out.hot).toEqual([
      { ms: 0, kind: 1, color: 42 },
      { ms: beat(16), kind: 2, color: 22 },
      { ms: beat(32), kind: 3, color: 1 },
    ])
  })

  it('refuses a plan that needs more than 8 hot cues and writes nothing', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    expect(cueChanges([hotAt(500, 1, 32)], drops, [], grid(400), [])).toEqual({
      status: 'too-many',
      needed: 9,
    })
  })

  it('changes nothing when the cues already are the plan', () => {
    const existing = [
      hotAt(beat(16), 1, 42),
      hotAt(beat(32), 2, 22),
      hotAt(beat(48), 3, 1),
      memAt(beat(16)),
      memAt(beat(32)),
      memAt(beat(48)),
      memAt(beat(64)),
    ]
    const out = cueChanges(existing, [beat(64)], [beat(64)], grid(200), [])
    expect(out.status === 'plan' && isEmptyChange(out.changes)).toBe(true)
  })
})

describe('flowOutcome on a deck with fewer buttons', () => {
  const plan = (slots?: CueSlots, existing: ExistingCue[] = [], drops = [beat(64), beat(128)]) =>
    flowOutcome({
      existing,
      drops,
      previousDrops: [],
      beats: grid(400),
      strong: [],
      phrases: [],
      flow: MY_FLOW,
      ...(slots ? { slots } : {}),
    })
  const hotOf = (out: ReturnType<typeof plan>) =>
    out.status === 'too-many' ? [] : out.wanted.filter((c) => c.kind !== 0)
  const SEVEN: CueSlots = { kinds: HOT_KINDS.slice(0, 7), pairCalls: false }

  it('never plans a letter the deck has no button for, trimming to the buttons there are', () => {
    const out = plan(SEVEN, [], [beat(64), beat(128), beat(192)])
    expect(hotOf(plan()).length).toBeGreaterThan(0)
    expect(hotOf(plan(undefined, [], [beat(64), beat(128), beat(192)])).length).toBe(8)
    expect(out.status).toBe('plan')
    expect(hotOf(out).length).toBe(7)
    expect(hotOf(out).some((c) => c.kind === HOT_KINDS[7])).toBe(false)
  })

  it('leaves out the CALL twin of each hot cue where the deck shows hot cues as markers already', () => {
    const out = plan(SEVEN)
    const hot = hotOf(out)
    const calls = out.status === 'too-many' ? [] : out.wanted.filter((c) => c.kind === 0)
    expect(hot.length).toBeGreaterThan(0)
    expect(calls.some((c) => hot.some((h) => Math.abs(h.ms - c.ms) < 1))).toBe(false)
  })

  it('still pairs each hot cue with a CALL on a full deck, as rekordbox expects', () => {
    const out = plan()
    const calls = out.status === 'too-many' ? [] : out.wanted.filter((c) => c.kind === 0)
    expect(hotOf(out).every((h) => calls.some((c) => Math.abs(h.ms - c.ms) < 1))).toBe(true)
  })
})
