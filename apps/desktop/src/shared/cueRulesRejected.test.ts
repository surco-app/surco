import { describe, expect, it } from 'vitest'
import { type CueFlow, type CueRule, MY_FLOW } from './cueFlows'
import { evaluateFlow, type FlowTrack, rejectedCues } from './cueRules'

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
const brief = (f: CueFlow, t: FlowTrack) =>
  rejectedCues(f, t).map((c) => [c.ms, c.bars, c.reason, c.color])

describe('rejectedCues', () => {
  it('names the countdown cues a strong part cuts off, so the DJ learns why only one hot cue appears', () => {
    const t = track({ strong: [{ start: beat(30), end: beat(40) }] })
    expect(evaluateFlow(MY_FLOW, t).cues.map((c) => c.bars)).toEqual([16])
    expect(brief(MY_FLOW, t)).toEqual([
      [beat(32), 32, 'strong', 22],
      [beat(16), 48, 'strong', 42],
    ])
  })

  it('says the cues that would run into the previous point collide with it', () => {
    expect(brief(MY_FLOW, track({ drops: [beat(100), beat(124)] }))).toEqual([
      [beat(92), 32, 'point', 22],
      [beat(76), 48, 'point', 42],
    ])
  })

  it('says the cues before the first beat fall off the start of the track', () => {
    const out = rejectedCues(MY_FLOW, track({ drops: [beat(40)] }))
    expect(out.map((c) => [c.bars, c.reason])).toEqual([[48, 'start']])
    expect(out[0].ms).toBeLessThan(0)
  })

  it('says the cues past the last beat fall off the end of the track', () => {
    const ahead = flow(rule({ direction: 'forward', repeat: 2 }))
    expect(brief(ahead, track({ beats: grid(80), drops: [beat(56)] }))).toEqual([
      [beat(88), 32, 'end', 1],
    ])
  })

  it('lists the hot cues the 8 limit leaves out with that reason', () => {
    const drops = Array.from({ length: 4 }, (_, i) => beat(48 + 48 * i))
    expect(brief(MY_FLOW, track({ beats: grid(400), drops }))).toEqual([[beat(0), 48, 'limit', 42]])
  })

  it('lists one dropped cue per position even when two rules drop the same one', () => {
    const both = flow(rule(), rule({ place: 'call' }))
    const t = track({ strong: [{ start: beat(46), end: beat(50) }] })
    expect(brief(both, t)).toEqual([[beat(48), 16, 'strong', 1]])
  })

  it('never marks a position that is a point or already holds a placed cue, so the count names only real gaps', () => {
    expect(rejectedCues(MY_FLOW, track({ drops: [beat(100), beat(116)] }))).toEqual([])
  })

  it('reports nothing for a rule that repeats to the edge and simply runs out of track', () => {
    expect(rejectedCues(flow(rule({ repeat: 'edge', when: 'always' })), track())).toEqual([])
  })

  it('leaves out what a condition other than fitting skipped, which is the rule working as set', () => {
    expect(rejectedCues(MY_FLOW, track({ drops: [beat(64), beat(128)] }))).toEqual([])
  })

  it('rejects nothing without a grid', () => {
    expect(rejectedCues(MY_FLOW, track({ beats: [] }))).toEqual([])
  })
})

describe('points marked by hand', () => {
  const mixIn = flow(rule())

  it('places the cue inside a strong part, since the DJ chose that point and the fitting is only for Auto mark', () => {
    const t = track({ strong: [{ start: beat(40), end: beat(56) }] })
    expect(evaluateFlow(mixIn, t).cues).toEqual([])
    const forced = track({ strong: [{ start: beat(40), end: beat(56) }], byHand: [beat(64)] })
    expect(evaluateFlow(mixIn, forced).cues.map((c) => c.ms)).toEqual([beat(48)])
    expect(rejectedCues(mixIn, forced)).toEqual([])
  })

  it('stops its countdown at the previous point, so the next drop never stacks a cue on the drop before it', () => {
    const countdown = flow(rule({ repeat: 3, color: { each: [1, 22, 42] } }))
    const t = track({ drops: [beat(64), beat(112)], byHand: [beat(64), beat(112)] })
    expect(evaluateFlow(countdown, t).cues.map((c) => c.ms)).toEqual([
      beat(16),
      beat(32),
      beat(48),
      beat(80),
      beat(96),
    ])
  })

  it('stops its countdown before a previous point it would run past', () => {
    const t = track({ drops: [beat(100), beat(108)], byHand: [beat(108)] })
    expect(evaluateFlow(mixIn, t).cues.map((c) => c.ms)).toEqual([beat(84)])
  })

  it('still leaves out a cue that falls off the start of the track, where there is nowhere to put it', () => {
    const t = track({ drops: [beat(10)], byHand: [beat(10)] })
    expect(evaluateFlow(mixIn, t).cues).toEqual([])
    expect(brief(mixIn, t).map(([, , reason]) => reason)).toEqual(['start'])
  })

  it('keeps fitting the points it did not mark by hand', () => {
    const t = track({
      drops: [beat(64), beat(150)],
      strong: [{ start: beat(40), end: beat(56) }],
      byHand: [beat(150)],
    })
    expect(evaluateFlow(mixIn, t).cues.map((c) => c.ms)).toEqual([beat(134)])
  })
})

describe('a condition of its own on one repetition', () => {
  const bar = (n: number): number => beat(n - 1)
  const part = (from: number, to: number) => ({ start: bar(from), end: bar(to) })
  const kinds = {
    intro: [1],
    chorus: [9, 33, 109, 181],
    up: [25, 65, 97, 173, 221],
    down: [89, 165, 229],
    outro: [245],
  } as const
  const phrases = Object.entries(kinds).flatMap(([kind, bars]) =>
    bars.map((n) => ({ ms: bar(n), kind: kind as keyof typeof kinds })),
  )
  const song = (over: Partial<FlowTrack> = {}): FlowTrack => ({
    beats: grid(250),
    drops: [bar(33), bar(109), bar(181)],
    strong: [
      part(9, 25),
      part(33, 41),
      part(41, 49),
      part(49, 65),
      part(109, 125),
      part(125, 137),
      part(137, 141),
      part(141, 157),
      part(157, 165),
      part(181, 197),
      part(197, 213),
      part(213, 221),
    ],
    phrases,
    ...over,
  })
  const buildUp = (over: Partial<CueRule> = {}): CueFlow =>
    flow(rule({ repeat: 3, when: 'previous', color: { each: [1, 22, 42] }, ...over }))
  const placedAt = (f: CueFlow, t: FlowTrack) => evaluateFlow(f, t).cues.map((c) => c.ms)
  const inTrack = (f: CueFlow, t: FlowTrack) =>
    rejectedCues(f, t)
      .filter((c) => c.ms >= 0)
      .map((c) => [c.ms, c.bars, c.reason])

  it('places every repetition of a rule without one, exactly as before it existed', () => {
    expect(placedAt(buildUp(), song())).toEqual(
      [1, 17, 61, 77, 93, 133, 149, 165].map((n) => bar(n)),
    )
    expect(inTrack(buildUp(), song())).toEqual([])
  })

  it('keeps the 48 only where it lands in a breakdown, so one rule gives the long run-up without a red cue inside a chorus', () => {
    const f = buildUp({ whenEach: ['rule', 'rule', 'down'] })
    expect(placedAt(f, song())).toEqual([1, 17, 77, 93, 149, 165].map((n) => bar(n)))
    expect(inTrack(f, song())).toEqual([
      [bar(61), 48, 'section'],
      [bar(133), 48, 'section'],
    ])
  })

  it('keeps the 48 only where it fits outside a strong part, saying the strong part is what left it out', () => {
    const f = buildUp({ whenEach: ['rule', 'rule', 'fits'] })
    expect(placedAt(f, song())).toEqual([1, 17, 77, 93, 149, 165].map((n) => bar(n)))
    expect(inTrack(f, song())).toEqual([
      [bar(61), 48, 'strong'],
      [bar(133), 48, 'strong'],
    ])
  })

  it('goes on to the next repetition after leaving one out, because the condition belongs to that repetition alone', () => {
    const f = buildUp({ whenEach: ['rule', 'down'] })
    expect(placedAt(f, song({ drops: [bar(109)] }))).toEqual([bar(61), bar(93)])
    expect(inTrack(f, song({ drops: [bar(109)] }))).toEqual([[bar(77), 32, 'section']])
  })

  it('reads the section in force at the cue, not only the one that starts on it', () => {
    const f = buildUp({ repeat: 1, whenEach: ['down'] })
    expect(placedAt(f, song())).toEqual([bar(93), bar(165)])
  })

  it('places nothing that asks for a section on a track without phrases, since nothing says where it is', () => {
    const f = buildUp({ whenEach: ['rule', 'rule', 'down'] })
    const bare = song({ phrases: [] })
    expect(placedAt(f, bare)).toEqual([1, 17, 77, 93, 149, 165].map((n) => bar(n)))
    expect(inTrack(f, bare).map(([, , reason]) => reason)).toEqual(['section', 'section'])
  })

  it('lets the rule cut the countdown first, so a repetition never gets past where the rule stops', () => {
    const f = buildUp({ whenEach: ['rule', 'rule', 'down'] })
    const unbroken = song({
      strong: [part(9, 25), part(33, 65), part(109, 165), part(181, 221)],
    })
    expect(placedAt(f, unbroken)).toEqual([1, 17, 77, 93, 165].map((n) => bar(n)))
    expect(inTrack(f, unbroken)).toEqual([
      [bar(61), 48, 'strong'],
      [bar(149), 32, 'strong'],
      [bar(133), 48, 'strong'],
    ])
  })

  it('skips the fitting on a point marked by hand, as the rule does, since the DJ chose that point', () => {
    const f = buildUp({ whenEach: ['rule', 'rule', 'fits'] })
    const forced = song({ byHand: [bar(109)] })
    expect(placedAt(f, forced)).toEqual([1, 17, 61, 77, 93, 149, 165].map((n) => bar(n)))
  })

  it('still asks for the section on a point marked by hand, because the section is about where the cue lands', () => {
    const f = buildUp({ whenEach: ['rule', 'rule', 'down'] })
    const forced = song({ byHand: [bar(109)] })
    expect(placedAt(f, forced)).toEqual([1, 17, 77, 93, 149, 165].map((n) => bar(n)))
  })
})
