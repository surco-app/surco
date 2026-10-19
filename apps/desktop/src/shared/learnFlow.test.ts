import { describe, expect, it } from 'vitest'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from './cueFlows'
import { diffCues, flowOutcome, isEmptyChange } from './cueRules'
import { diagnoseLearnFlow, type LearnTrack, learnFlow } from './learnFlow'

const BEATS = Array.from({ length: 1000 }, (_, i) => i * 500)
const bar = (n: number): number => BEATS[n * 4]

function track(dropBars: number[], flow: CueFlow = MY_FLOW): LearnTrack {
  const out = flowOutcome({
    existing: [],
    drops: dropBars.map(bar),
    previousDrops: [],
    beats: BEATS,
    strong: [],
    phrases: [],
    flow,
  })
  if (out.status !== 'plan') throw new Error('the fixture flow must plan')
  return {
    beats: BEATS,
    cues: out.wanted.map(({ ms, kind, color }) => ({ ms, kind, color })),
    strong: [],
    phrases: [],
  }
}

function withExtraHot(dropBar: number, barsBeforeDrop: number): LearnTrack {
  const t = track([dropBar])
  return { ...t, cues: [...t.cues, { ms: bar(dropBar - barsBeforeDrop), kind: 9, color: 56 }] }
}

function reproduces(flow: CueFlow, t: LearnTrack, drops: number[]): boolean {
  const existing = t.cues.map((c, i) => ({ ...c, id: String(i) }))
  const out = flowOutcome({
    existing,
    drops,
    previousDrops: drops,
    beats: t.beats,
    strong: t.strong,
    phrases: t.phrases,
    flow,
  })
  return out.status === 'plan' && isEmptyChange(diffCues(existing, out.wanted))
}

const VICENT_DROPS = [
  [64],
  [64],
  [72],
  [80],
  [48],
  [40],
  [32],
  [16],
  [8],
  [12],
  [96],
  [100],
  [56],
  [40, 120],
  [88],
  [20],
  [24],
  [60],
  [70],
  [8],
]

describe('learnFlow', () => {
  it('learns Mi flujo from a collection marked the way Vicent marks, so the DJ gets back the flow he already uses', () => {
    const tracks = VICENT_DROPS.map((d) => track(d))
    const learned = learnFlow(tracks)
    expect(learned?.flow.rules).toEqual(MY_FLOW.rules)
    expect(learned?.coverage).toEqual({ matching: 20, marked: 20 })
    tracks.forEach((t, i) => {
      expect(reproduces(learned?.flow as CueFlow, t, VICENT_DROPS[i].map(bar))).toBe(true)
    })
  })

  it('reads a first-beat hot cue at a countdown distance as countdown, not as a start cue, since short intros put bar 1 on the countdown', () => {
    const learned = learnFlow([[16], [32], [48], [16], [32], [64], [80]].map((d) => track(d)))
    expect(learned?.flow.rules).toEqual([MY_FLOW.rules[0]])
    expect(learned?.coverage).toEqual({ matching: 7, marked: 7 })
  })

  it('keeps the start cue of an 8-bar intro as a start cue, not as a countdown at 8, since it sits on bar 1 and not where the DJ counts back', () => {
    const tracks = [
      ...Array.from({ length: 15 }, () => track([64])),
      ...Array.from({ length: 5 }, () => track([8])),
    ]
    expect(learnFlow(tracks)?.flow.rules).toEqual(MY_FLOW.rules)
  })

  it('learns another DJ’s single green cue at 32 without a CALL, because each DJ marks differently', () => {
    const learned = learnFlow([[32], [48], [64], [96], [40], [16]].map((d) => track(d, ONE_AT_32)))
    expect(learned?.flow.rules).toEqual(ONE_AT_32.rules)
    expect(learned?.coverage).toEqual({ matching: 6, marked: 6 })
  })

  it('ignores scattered distances below the support threshold so one odd cue does not enter the flow', () => {
    const clean = Array.from({ length: 19 }, () => track([64]))
    const odd = withExtraHot(64, 8)
    const learned = learnFlow([...clean, odd])
    expect(learned?.flow.rules).toEqual([MY_FLOW.rules[0]])
    expect(learned?.coverage).toEqual({ matching: 20, marked: 20 })
  })

  it('ignores tracks with no drop, since a cue only measures against where the track breaks', () => {
    const unmarked: LearnTrack = {
      beats: BEATS,
      cues: [
        { ms: bar(4), kind: 1, color: 56 },
        { ms: bar(4), kind: 0, color: null },
      ],
      strong: [],
      phrases: [],
    }
    const learned = learnFlow([...VICENT_DROPS.map((d) => track(d)), unmarked, unmarked])
    expect(learned?.flow.rules).toEqual(MY_FLOW.rules)
    expect(learned?.coverage).toEqual({ matching: 20, marked: 20 })
  })

  it('proposes a flow when 30 % of the marked tracks follow it and nothing below, so a loose habit is never sold as a pattern', () => {
    const noisy = (count: number) =>
      Array.from({ length: count }, () => edited(track([64]), at(32, 'any', null)))
    expect(
      learnFlow([...Array.from({ length: 6 }, () => track([64])), ...noisy(14)])?.coverage,
    ).toEqual({ matching: 6, marked: 20 })
    expect(learnFlow([...Array.from({ length: 5 }, () => track([64])), ...noisy(15)])).toBeNull()
  })

  it('returns null for a collection with no common pattern', () => {
    const scattered = Array.from({ length: 20 }, (_, i): LearnTrack => {
      const drop = bar(100)
      const at = drop - (i + 1) * 2000 - 500
      return {
        beats: BEATS,
        cues: [
          { ms: drop, kind: 0, color: null },
          { ms: at, kind: 1, color: 1 + i },
          { ms: at, kind: 0, color: null },
        ],
        strong: [],
        phrases: [],
      }
    })
    expect(learnFlow(scattered)).toBeNull()
  })

  it('returns null when nothing is marked', () => {
    expect(learnFlow([])).toBeNull()
  })
})

type Cue = LearnTrack['cues'][number]

function edited(t: LearnTrack, change: (c: Cue) => Cue[]): LearnTrack {
  return { ...t, cues: t.cues.flatMap(change) }
}

const at =
  (barNumber: number, kind: 'hot' | 'any', patch: Partial<Cue> | null) =>
  (c: Cue): Cue[] => {
    const hit = c.ms === bar(barNumber) && (kind === 'any' || c.kind !== 0)
    if (!hit) return [c]
    return patch === null ? [] : [{ ...c, ...patch }]
  }

const reletter = (t: LearnTrack): LearnTrack => {
  const hot = t.cues.filter((c) => c.kind !== 0)
  const kinds = hot.map((c) => c.kind).reverse()
  return {
    ...t,
    cues: [...t.cues.filter((c) => c.kind === 0), ...hot.map((c, i) => ({ ...c, kind: kinds[i] }))],
  }
}

describe('learnFlow on collections shaped like the real one', () => {
  it('keeps 48 when few first drops are deep enough for it, since support counts only the tracks where the distance fits', () => {
    const tracks = [
      ...Array.from({ length: 33 }, () => track([40, 104])),
      ...Array.from({ length: 3 }, () => track([80, 160])),
      ...Array.from({ length: 4 }, () => track([8, 72])),
    ]
    const learned = learnFlow(tracks)
    expect(learned?.flow.rules).toEqual(MY_FLOW.rules)
    expect(learned?.coverage).toEqual({ matching: 40, marked: 40 })
  })

  it('ignores the letters, since rekordbox letters by time and a flow has none', () => {
    const tracks = [
      ...Array.from({ length: 15 }, () => track([64, 128])),
      ...Array.from({ length: 5 }, () => reletter(track([64, 128]))),
    ]
    expect(learnFlow(tracks)?.coverage).toEqual({ matching: 20, marked: 20 })
  })

  it('never lets a distance seen on a single track in, even where it is the only track it fits', () => {
    const tracks = [...Array.from({ length: 20 }, () => track([64])), withExtraHot(120, 64)]
    expect(learnFlow(tracks)?.flow.rules).toEqual([MY_FLOW.rules[0]])
  })

  it('leaves out a common distance that is not a multiple of the step, since one rule cannot place it', () => {
    const tracks = [
      ...Array.from({ length: 10 }, () => track([64])),
      ...Array.from({ length: 10 }, () => withExtraHot(64, 20)),
    ]
    const learned = learnFlow(tracks)
    expect(learned?.flow.rules).toEqual([MY_FLOW.rules[0]])
    expect(learned?.coverage).toEqual({ matching: 20, marked: 20 })
  })

  it('learns no start cue when most tracks with an early drop have none, as on the real collection', () => {
    const early = (): LearnTrack => ({
      beats: BEATS,
      cues: [
        { ms: bar(12), kind: 0, color: null },
        { ms: bar(6), kind: 1, color: 1 },
        { ms: bar(6), kind: 0, color: null },
      ],
      strong: [],
      phrases: [],
    })
    const tracks = [
      ...Array.from({ length: 20 }, () => track([64])),
      ...Array.from({ length: 5 }, early),
      track([8]),
    ]
    expect(learnFlow(tracks)?.flow.rules).toEqual([MY_FLOW.rules[0]])
  })

  it('weighs a distance only among tracks whose first drop lies strictly beyond it, since a drop exactly there puts the cue on bar 1', () => {
    const tracks = [
      ...Array.from({ length: 4 }, () => track([80])),
      ...Array.from({ length: 20 }, () => track([48])),
    ]
    expect(learnFlow(tracks)?.flow.rules).toEqual([MY_FLOW.rules[0]])
  })

  it('needs 2 % of the marked tracks behind a distance in a large collection, so a handful of deep tracks cannot add one', () => {
    const tracks = [
      ...Array.from({ length: 148 }, () => track([64])),
      ...Array.from({ length: 2 }, () => withExtraHot(120, 64)),
    ]
    expect(learnFlow(tracks)?.flow.rules).toEqual([MY_FLOW.rules[0]])
  })
})

describe('coverage counts a track when the plan of the flow is inside its cues', () => {
  const collection = (odd: LearnTrack) => [
    ...Array.from({ length: 10 }, () => track([64, 128])),
    odd,
  ]

  it('still counts a track with cues beyond the flow after the drop, since DJs add later drops and mix points', () => {
    const t = track([64])
    const extras: LearnTrack = {
      ...t,
      cues: [
        ...t.cues,
        { ms: bar(80), kind: 4, color: 56 },
        { ms: bar(80), kind: 0, color: null },
        { ms: bar(150), kind: 0, color: null },
        { ms: bar(150), kind: 5, color: 1 },
        { ms: bar(170), kind: 6, color: 9 },
      ],
    }
    expect(learnFlow(collection(extras))?.coverage).toEqual({ matching: 11, marked: 11 })
  })

  it('does not count a track missing the 32 cue the flow places', () => {
    const missing = edited(track([64]), at(32, 'any', null))
    expect(learnFlow(collection(missing))?.coverage).toEqual({ matching: 10, marked: 11 })
    expect(diagnoseLearnFlow(collection(missing)).mismatches).toEqual({
      'missing-hot-cue': [10],
      'call-missing': [10],
    })
  })
})

describe('diagnoseLearnFlow', () => {
  it('names why each marked track misses the learned flow, so a low coverage can be explained before it is judged', () => {
    const clean = Array.from({ length: 20 }, () => track([64]))
    const starts = Array.from({ length: 3 }, () => track([8]))
    const everyTwenty = Array.from({ length: 9 }, (_, i) => ({
      ms: bar(20 * (i + 1)),
      kind: 0,
      color: null,
    }))
    const odd: LearnTrack[] = [
      reletter(track([64])),
      edited(track([64]), at(32, 'hot', { color: null })),
      edited(track([64]), at(32, 'hot', { color: 56 })),
      edited(track([64]), at(16, 'any', null)),
      withExtraHot(64, 8),
      edited(track([64, 160]), at(32, 'hot', { color: null })),
      edited(track([8]), at(0, 'hot', { color: 56 })),
      edited(track([64]), (c) => (c.ms === bar(48) ? [{ ...c, ms: c.ms + 500 }] : [c])),
      track([64, 160]),
      { beats: BEATS, cues: everyTwenty, strong: [], phrases: [] },
      {
        beats: BEATS,
        cues: [
          { ms: bar(4), kind: 0, color: null },
          { ms: bar(4), kind: 1, color: 1 },
        ],
        strong: [],
        phrases: [],
      },
      { beats: [], cues: [{ ms: bar(4), kind: 0, color: null }], strong: [], phrases: [] },
    ]
    const first = clean.length + starts.length
    const d = diagnoseLearnFlow([...clean, ...starts, ...odd])
    expect(d).toMatchObject({
      tracks: 35,
      noGrid: 1,
      noDrop: 1,
      marked: 33,
      flow: { rules: MY_FLOW.rules },
      countdownPaired: 1,
      start: { open: 4, withStart: 4 },
      matching: 26,
      withExtraHot: 1,
      withExtraCall: 0,
    })
    expect(d.support[48]).toEqual({ tracks: 27, eligible: 28 })
    expect(d.support[8]).toEqual({ tracks: 1, eligible: 29 })
    const mismatches = {
      'colour-null': [first + 1, first + 5],
      'colour-differs': [first + 2],
      'missing-hot-cue': [first + 3],
      'call-missing': [first + 3],
      'several-drops': [first + 5, first + 9],
      'start-cue-differs': [first + 6],
      moved: [first + 7],
      'too-many': [first + 9],
    }
    expect(d.mismatches).toEqual(mismatches)
    expect(d.myFlow).toEqual({ matching: 26, mismatches, withExtraHot: 1, withExtraCall: 0 })
  })

  it('measures Mi flujo on the same tracks as the reference when the collection learns another flow', () => {
    const d = diagnoseLearnFlow([32, 48, 64, 96].map((n) => track([n], ONE_AT_32)))
    expect(d.flow.rules).toEqual(ONE_AT_32.rules)
    expect(d.matching).toBe(4)
    expect(d.myFlow.matching).toBe(0)
  })
})
