import { describe, expect, it } from 'vitest'
import { type CueFlow, MY_FLOW, ONE_AT_32 } from './cueFlows'
import { diffCues, flowOutcome, isEmptyChange } from './cueRules'
import { type LearnTrack, learnFlow } from './learnFlow'

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
    expect(learned?.coverage).toEqual({ matching: 19, marked: 20 })
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
      Array.from({ length: count }, (_, i) => withExtraHot(64, i + 1))
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
