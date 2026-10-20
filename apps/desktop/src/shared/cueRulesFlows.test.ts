import { describe, expect, it } from 'vitest'
import {
  BUNDLED_FLOWS,
  CALLS_ONLY,
  type CueFlow,
  type CueRule,
  MY_FLOW,
  ONE_AT_32,
} from './cueFlows'
import {
  diffCues,
  type ExistingCue,
  evaluateFlow,
  type FlowTrack,
  findDrops,
  flowOutcome,
  proposeDrops,
} from './cueRules'

const grid = (bars: number): number[] => Array.from({ length: bars * 4 }, (_, i) => i * 500)
const beat = (bars: number): number => bars * 2000
const track = (over: Partial<FlowTrack> = {}): FlowTrack => ({
  beats: grid(200),
  drops: [beat(64)],
  strong: [],
  phrases: [],
  ...over,
})
const rule = (over: Partial<CueRule> = {}): CueRule => ({
  from: 'drop',
  direction: 'back',
  bars: 16,
  repeat: 1,
  when: 'fits',
  place: 'hot',
  color: { fixed: 1 },
  ...over,
})
const flow = (...rules: CueRule[]): CueFlow => ({ id: 't', name: '', markPoint: true, rules })

describe('evaluateFlow', () => {
  it('runs Mi flujo as the 16, 32, 48 countdown with a colour per repetition', () => {
    expect(evaluateFlow(MY_FLOW, track()).cues).toEqual([
      { ms: beat(16), place: 'both', color: 42, rule: 0, repetition: 3, bars: 48 },
      { ms: beat(32), place: 'both', color: 22, rule: 0, repetition: 2, bars: 32 },
      { ms: beat(48), place: 'both', color: 1, rule: 0, repetition: 1, bars: 16 },
    ])
  })

  it('goes forward from the drop and stops before the next one, so it never lands on it', () => {
    const forward = flow(rule({ direction: 'forward', repeat: 3 }))
    expect(
      evaluateFlow(forward, track({ drops: [beat(64), beat(112)] })).cues.map((c) => c.ms),
    ).toEqual([beat(80), beat(96), beat(128), beat(144), beat(160)])
  })

  it('repeats to the edge of the track when asked, whatever is in the way, with always', () => {
    const edge = flow(rule({ repeat: 'edge', when: 'always', color: { each: [1, 22] } }))
    const cues = evaluateFlow(edge, track()).cues
    expect(cues.map((c) => c.ms)).toEqual([beat(0), beat(16), beat(32), beat(48)])
    expect(cues.map((c) => c.color)).toEqual([22, 22, 22, 1])
  })

  it('counts from each phrase of a type rekordbox analysed', () => {
    const fromChorus = flow(rule({ from: 'chorus', bars: 8, place: 'call' }))
    const phrases = [
      { ms: beat(32), kind: 'chorus' as const },
      { ms: beat(40), kind: 'up' as const },
      { ms: beat(96), kind: 'chorus' as const },
    ]
    expect(evaluateFlow(fromChorus, track({ phrases })).cues).toEqual([
      { ms: beat(24), place: 'call', color: null, rule: 0, repetition: 1, bars: 8 },
      { ms: beat(88), place: 'call', color: null, rule: 0, repetition: 1, bars: 8 },
    ])
  })

  it('places a cue on the first or the last beat with distance zero', () => {
    const ends = flow(
      rule({ from: 'first-beat', bars: 0, when: 'always' }),
      rule({ from: 'last-beat', bars: 0, when: 'always', color: { fixed: 42 } }),
    )
    expect(evaluateFlow(ends, track()).cues.map((c) => [c.ms, c.color])).toEqual([
      [0, 1],
      [grid(200)[799], 42],
    ])
  })

  it('skips a cue that would share a bar with an earlier rule cue, with si no cuadra', () => {
    const clear = flow(
      rule({ bars: 16 }),
      rule({ from: 'first-beat', bars: 0, when: 'clear' }),
      rule({ bars: 0, when: 'clear', place: 'call' }),
    )
    const out = evaluateFlow(clear, track({ drops: [beat(16) + 1500] }))
    expect(out.cues.map((c) => c.rule)).toEqual([0, 2])
  })

  it('keeps the earlier rule when two rules land on the same spot', () => {
    const twice = flow(rule({ color: { fixed: 1 } }), rule({ color: { fixed: 42 } }))
    expect(evaluateFlow(twice, track()).cues.map((c) => c.color)).toEqual([1])
  })

  it('leaves the farthest hot cues out first past 8 and says which', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    const out = evaluateFlow(MY_FLOW, track({ beats: grid(400), drops }))
    expect(out.cues).toHaveLength(8)
    expect(out.trimmed.map((c) => [c.ms, c.bars])).toEqual([[beat(0), 48]])
  })

  it('never counts loose CALLs against the 8 hot cues', () => {
    const calls = flow(rule({ repeat: 'edge', when: 'always', place: 'call' }))
    const out = evaluateFlow(calls, track({ beats: grid(400), drops: [beat(400) - 500] }))
    expect(out.trimmed).toEqual([])
    expect(out.cues).toHaveLength(24)
    expect(out.cues.every((c) => c.place === 'call')).toBe(true)
  })

  it('plans nothing on a track without a grid', () => {
    expect(evaluateFlow(MY_FLOW, track({ beats: [] }))).toEqual({ cues: [], trimmed: [] })
  })
})

const outcome = (over: Partial<Parameters<typeof flowOutcome>[0]> = {}) =>
  flowOutcome({
    existing: [],
    drops: [beat(64)],
    previousDrops: [],
    beats: grid(200),
    strong: [],
    phrases: [],
    flow: MY_FLOW,
    ...over,
  })

describe('flowOutcome', () => {
  it('pairs no CALL with the hot cue of a flow that places only a hot cue', () => {
    expect(outcome({ flow: ONE_AT_32 })).toEqual({
      status: 'plan',
      wanted: [
        { ms: beat(64), kind: 0, color: null },
        { ms: beat(32), kind: 1, color: 22 },
      ],
      hot: [{ ms: beat(32), kind: 1, color: 22 }],
      trimmed: [],
    })
  })

  it('leaves only the CALL of the drop with Solo CALL', () => {
    expect(outcome({ flow: CALLS_ONLY })).toEqual({
      status: 'plan',
      wanted: [{ ms: beat(64), kind: 0, color: null }],
      hot: [],
      trimmed: [],
    })
  })

  it('keeps the rekordbox ID of every cue it keeps, so saving is a diff by identity', () => {
    const existing: ExistingCue[] = [
      { id: 'h', ms: beat(48), kind: 5, color: 1 },
      { id: 'p', ms: beat(48), kind: 0, color: null },
      { id: 'd', ms: beat(64), kind: 0, color: 0 },
    ]
    const out = outcome({ existing, previousDrops: [beat(64)] })
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.wanted.filter((w) => w.id !== undefined)).toEqual([
      { id: 'p', ms: beat(48), kind: 0, color: null },
      { id: 'd', ms: beat(64), kind: 0, color: 0 },
      { id: 'h', ms: beat(48), kind: 3, color: 1 },
    ])
  })

  it('lists the hot cues the 8 limit leaves out, so the user sees which ones', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    const out = outcome({ drops, beats: grid(400) })
    expect(out.status === 'plan' && out.trimmed).toEqual([beat(0)])
  })

  it('counts cues of the flow that generated the draft as fitting when switching flows', () => {
    const fromMine = outcome()
    if (fromMine.status !== 'plan') throw new Error(fromMine.status)
    const existing = fromMine.wanted.map((w, i) => ({ ...w, id: `e${i}` }))
    const switched = outcome({
      existing,
      previousDrops: [beat(64)],
      flow: ONE_AT_32,
      previousFlow: MY_FLOW,
    })
    expect(switched.status).toBe('plan')
    expect(switched.status === 'plan' && switched.hot).toEqual([
      { ms: beat(32), kind: 1, color: 22 },
    ])
  })
})

describe('flowOutcome with a rule that places only a CALL', () => {
  const callAt32 = flow(rule({ bars: 32, place: 'call' }))

  it('writes the CALL the rule places, so a CALL rule is not silently dropped', () => {
    expect(outcome({ flow: callAt32 })).toEqual({
      status: 'plan',
      wanted: [
        { ms: beat(64), kind: 0, color: null },
        { ms: beat(32), kind: 0, color: null },
      ],
      hot: [],
      trimmed: [],
    })
  })

  it('keeps the rekordbox CALL already near that spot instead of inserting a second one', () => {
    const existing: ExistingCue[] = [
      { id: 'd', ms: beat(64), kind: 0, color: null },
      { id: 'c', ms: beat(32) + 20, kind: 0, color: null },
    ]
    const out = outcome({ existing, previousDrops: [beat(64)], flow: callAt32 })
    if (out.status !== 'plan') throw new Error(out.status)
    expect(out.wanted).toContainEqual({ id: 'c', ms: beat(32) + 20, kind: 0, color: null })
    expect(diffCues(existing, out.wanted)).toEqual({ insert: [], update: [], remove: [] })
  })
})

describe('flowOutcome run again on its own output', () => {
  const callRules: CueFlow[] = (['back', 'forward'] as const).flatMap((direction) =>
    [4, 8, 16, 32].flatMap((bars) =>
      ([1, 2, 3, 'edge'] as const).flatMap((repeat) =>
        (['fits', 'always'] as const).map((when) =>
          flow(rule({ direction, bars, repeat, when, place: 'call' })),
        ),
      ),
    ),
  )
  const flows: CueFlow[] = [
    ...BUNDLED_FLOWS,
    ...callRules,
    {
      ...MY_FLOW,
      rules: [...MY_FLOW.rules, rule({ direction: 'forward', bars: 8, place: 'call' })],
    },
  ]
  const dropSets = [[beat(64)], [beat(64), beat(128)], [beat(40), beat(112)]]

  it('changes nothing, so a CALL a rule placed never turns into a drop that grows more CALLs', () => {
    for (const f of flows)
      for (const drops of dropSets) {
        let existing: ExistingCue[] = []
        let marked = drops
        for (let round = 0; round < 3; round++) {
          const out = outcome({ existing, drops: marked, previousDrops: marked, flow: f })
          if (out.status !== 'plan') throw new Error(`${out.status} on round ${round}`)
          if (round > 0)
            expect(
              diffCues(existing, out.wanted),
              `${JSON.stringify(f.rules)} ${drops} round ${round}`,
            ).toEqual({ insert: [], update: [], remove: [] })
          existing = out.wanted.map((w, i) => ({ ...w, id: w.id ?? `r${round}-${i}` }))
          marked = findDrops(
            existing.filter((c) => c.kind === 0).map((c) => c.ms),
            existing.filter((c) => c.kind !== 0).map((c) => c.ms),
          )
        }
      }
  })
})

describe('diffCues', () => {
  const existing: ExistingCue[] = [
    { id: 'a', ms: beat(16), kind: 1, color: 1 },
    { id: 'b', ms: beat(16), kind: 0, color: null },
    { id: 'c', ms: beat(64), kind: 0, color: null },
  ]

  it('moves a kept cue in place instead of deleting and inserting it', () => {
    expect(
      diffCues(existing, [
        { id: 'a', ms: beat(20), kind: 1, color: 1 },
        { id: 'b', ms: beat(20), kind: 0, color: null },
        { id: 'c', ms: beat(64), kind: 0, color: null },
      ]),
    ).toEqual({
      insert: [],
      update: [
        { id: 'a', kind: 1, color: 1, ms: beat(20) },
        { id: 'b', kind: 0, color: null, ms: beat(20) },
      ],
      remove: [],
    })
  })

  it('inserts cues without an ID and removes the rekordbox cues the set left out', () => {
    expect(
      diffCues(existing, [
        { id: 'c', ms: beat(64), kind: 0, color: null },
        { ms: beat(48), kind: 1, color: 22 },
      ]),
    ).toEqual({ insert: [{ ms: beat(48), kind: 1, color: 22 }], update: [], remove: ['a', 'b'] })
  })

  it('writes a new letter or colour without a position when the cue did not move', () => {
    expect(diffCues(existing, [{ id: 'a', ms: beat(16), kind: 2, color: 42 }]).update).toEqual([
      { id: 'a', kind: 2, color: 42 },
    ])
  })
})

describe('proposeDrops', () => {
  it('proposes where each strong part starts and nothing already marked', () => {
    const strong = [
      { start: beat(64), end: beat(96) },
      { start: beat(128), end: beat(160) },
      { start: beat(128), end: beat(144) },
    ]
    expect(proposeDrops(strong, [beat(64) + 20])).toEqual([beat(128)])
  })

  it('proposes nothing without phrase analysis', () => {
    expect(proposeDrops([], [])).toEqual([])
  })
})

describe('flowOutcome for a flow that leaves the point unmarked', () => {
  const unmarked = (f: CueFlow): CueFlow => ({ ...f, markPoint: false })

  it('places what the rules draw from the point and no CALL on it, for the DJ who does not mark drops', () => {
    expect(outcome({ flow: unmarked(ONE_AT_32), point: beat(64) })).toEqual({
      status: 'plan',
      wanted: [{ ms: beat(32), kind: 1, color: 22 }],
      hot: [{ ms: beat(32), kind: 1, color: 22 }],
      trimmed: [],
    })
  })

  it('keeps the CALL a rule itself puts on the point, since the flow asked for it', () => {
    const onPoint = unmarked(flow(rule({ bars: 0, place: 'both' })))
    const out = outcome({ flow: onPoint, point: beat(64) })
    expect(out.status === 'plan' && out.wanted).toEqual([
      { ms: beat(64), kind: 1, color: 1 },
      { ms: beat(64), kind: 0, color: null },
    ])
  })

  it('marks the point as before when the flow marks it or no point is being placed', () => {
    expect(outcome({ flow: ONE_AT_32, point: beat(64) })).toEqual(outcome({ flow: ONE_AT_32 }))
    expect(outcome({ flow: unmarked(ONE_AT_32) })).toEqual(outcome({ flow: ONE_AT_32 }))
  })
})
