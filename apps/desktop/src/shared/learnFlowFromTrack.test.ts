import { describe, expect, it } from 'vitest'
import type { CueFlow, CueRule } from './cueFlows'
import { evaluateFlow, type StrongPart } from './cueRules'
import { type LearnTrack, learnFlowFromTrack } from './learnFlow'

const BEATS = Array.from({ length: 1000 }, (_, i) => i * 500)
const bar = (n: number): number => BEATS[n * 4]
const GREEN = 22
const BLUE = 1
const RED = 42

type Hot = [bar: number, color: number]

function marked(marks: number[], hot: Hot[], strong: StrongPart[] = []): LearnTrack {
  return {
    beats: BEATS,
    cues: [
      ...marks.map((n) => ({ ms: bar(n), kind: 0, color: null })),
      ...hot.map(([n, color], i) => ({ ms: bar(n), kind: i + 1, color })),
    ],
    strong,
    phrases: [],
  }
}

const withCalls = (t: LearnTrack): LearnTrack => ({
  ...t,
  cues: [
    ...t.cues,
    ...t.cues.filter((c) => c.kind !== 0).map((c) => ({ ms: c.ms, kind: 0, color: null })),
  ],
})

function hotBars(flow: CueFlow | null, marks: number[], t: LearnTrack): number[] {
  if (!flow) throw new Error('the track must give a flow')
  return evaluateFlow(flow, {
    beats: t.beats,
    drops: marks.map(bar),
    strong: t.strong,
    phrases: t.phrases,
  })
    .cues.filter((c) => c.place !== 'call')
    .map((c) => c.ms / 2000)
}

const countdown = (over: Partial<CueRule> = {}): CueRule => ({
  from: 'drop',
  direction: 'back',
  bars: 16,
  repeat: 2,
  when: 'previous',
  place: 'hot',
  color: { each: [GREEN, BLUE] },
  ...over,
})

const start = (over: Partial<CueRule> = {}): CueRule => ({
  from: 'first-beat',
  direction: 'back',
  bars: 0,
  repeat: 1,
  when: 'always',
  place: 'hot',
  color: { fixed: RED },
  ...over,
})

const TWO_MARKS: Hot[] = [
  [17, GREEN],
  [1, BLUE],
  [81, GREEN],
  [65, BLUE],
]

describe('learnFlowFromTrack', () => {
  it('turns the countdown of a track marked by hand into one rule with a colour per repetition, so the new flow places the same hot cues the DJ put there', () => {
    const t = marked([33, 97], TWO_MARKS)
    const flow = learnFlowFromTrack(t)
    expect(flow).toEqual({ id: 'learned', name: '', markPoint: true, rules: [countdown()] })
    expect(hotBars(flow, [33, 97], t)).toEqual([1, 17, 65, 81])
  })

  it('adds the hot cue on the first beat as a rule of its own with its colour, placed even though the countdown already fits before the first mark', () => {
    const t = marked([33, 97], [...TWO_MARKS, [0, RED]])
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown(), start()])
    expect(hotBars(flow, [33, 97], t)).toEqual([0, 1, 17, 65, 81])
  })

  it('keeps a lone start cue tied to the first mark having nothing before it, as the flows learned from a collection do', () => {
    const flow = learnFlowFromTrack(marked([8], [[0, RED]]))
    expect(flow?.rules).toEqual([start({ when: 'first' })])
  })

  it('needs a single mark, since one track marked to taste is all the DJ has to show', () => {
    const t = marked([64], [[48, GREEN]])
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown({ repeat: 1, color: { fixed: GREEN } })])
    expect(hotBars(flow, [64], t)).toEqual([48])
  })

  it('counts a hot cue on the first beat as one more step of the countdown when it lands on it, since a 32-bar intro puts bar 1 there', () => {
    const flow = learnFlowFromTrack(
      marked(
        [32],
        [
          [16, GREEN],
          [0, BLUE],
        ],
      ),
    )
    expect(flow?.rules).toEqual([countdown()])
  })

  it('leaves a hot cue at a distance no rule can hold out of the flow and learns the rest, so the preview can point at the odd one', () => {
    const t = marked([33, 97], [...TWO_MARKS, [22, RED]])
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown()])
    expect(hotBars(flow, [33, 97], t)).toEqual([1, 17, 65, 81])
  })

  it('counts back in the step that reproduces most hot cues when the marks disagree, so a cue put once does not reshape the whole countdown', () => {
    const t = marked(
      [40, 104],
      [
        [32, RED],
        [24, GREEN],
        [8, BLUE],
        [88, GREEN],
        [72, BLUE],
      ],
    )
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown()])
    expect(hotBars(flow, [40, 104], t)).toEqual([8, 24, 72, 88])
  })

  it('counts back in the shorter step when two reproduce as many hot cues, since the cue nearest the mark is the one a mix starts from', () => {
    const flow = learnFlowFromTrack(
      marked(
        [64],
        [
          [48, GREEN],
          [16, BLUE],
        ],
      ),
    )
    expect(flow?.rules).toEqual([countdown({ repeat: 1, color: { fixed: GREEN } })])
  })

  it('places a CALL beside each hot cue when the track pairs them, and only the hot cue when it does not', () => {
    expect(learnFlowFromTrack(withCalls(marked([33, 97], TWO_MARKS)))?.rules[0].place).toBe('both')
    expect(learnFlowFromTrack(marked([33, 97], TWO_MARKS))?.rules[0].place).toBe('hot')
  })

  it('never invents a condition per repetition, which a single track cannot tell apart from chance', () => {
    const flow = learnFlowFromTrack(marked([33, 97], TWO_MARKS))
    expect(flow?.rules.every((r) => r.whenEach === undefined)).toBe(true)
  })
})

describe('the condition learnFlowFromTrack gives the countdown', () => {
  it('stops at strong parts when the DJ left out the cue that falls inside one, since only that condition reproduces the gap', () => {
    const t = marked(
      [40, 104],
      [
        [24, GREEN],
        [8, BLUE],
        [88, GREEN],
      ],
      [{ start: bar(70), end: bar(80) }],
    )
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown({ when: 'fits' })])
    expect(hotBars(flow, [40, 104], t)).toEqual([8, 24, 88])
  })

  it('looks only at the previous mark when the DJ kept a cue inside a strong part and none on the mark before, since only that condition reproduces both', () => {
    const t = marked(
      [40, 56],
      [
        [24, GREEN],
        [8, BLUE],
      ],
      [{ start: bar(20), end: bar(30) }],
    )
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown()])
    expect(hotBars(flow, [40, 56], t)).toEqual([8, 24])
  })

  it('places always when the DJ counted back through the strong part that holds the previous mark, which the other two would cut', () => {
    const t = marked(
      [40, 104],
      [
        [24, GREEN],
        [8, BLUE],
        [88, GREEN],
        [72, BLUE],
      ],
      [{ start: bar(40), end: bar(100) }],
    )
    const flow = learnFlowFromTrack(t)
    expect(flow?.rules).toEqual([countdown({ when: 'always' })])
    expect(hotBars(flow, [40, 104], t)).toEqual([8, 24, 72, 88])
  })
})

describe('a track learnFlowFromTrack cannot read', () => {
  it('gives nothing without a grid, since distances are counted in bars', () => {
    expect(learnFlowFromTrack({ ...marked([33, 97], TWO_MARKS), beats: [] })).toBeNull()
  })

  it('gives nothing without a mark, since every cue hangs from one', () => {
    expect(learnFlowFromTrack(withCalls(marked([], TWO_MARKS)))).toBeNull()
  })

  it('gives nothing when no hot cue sits at a distance a rule can hold nor on the first beat, rather than an empty flow', () => {
    expect(learnFlowFromTrack(marked([64], [[53, GREEN]]))).toBeNull()
    expect(learnFlowFromTrack(marked([64], []))).toBeNull()
  })
})
