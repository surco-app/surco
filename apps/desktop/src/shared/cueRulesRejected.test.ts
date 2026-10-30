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

  it('places the cue past the previous point too', () => {
    const t = track({ drops: [beat(100), beat(108)], byHand: [beat(108)] })
    expect(evaluateFlow(mixIn, t).cues.map((c) => c.ms)).toEqual([beat(84), beat(92)])
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
