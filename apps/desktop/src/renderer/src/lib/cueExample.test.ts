import { describe, expect, it } from 'vitest'
import { CALLS_ONLY, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import type { TrackCues } from '../../../shared/types'
import {
  collectionChoices,
  differingHot,
  EXAMPLE_DROP,
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  EXAMPLE_POINT_BAR,
  EXAMPLE_WAVE,
  exampleBar,
  examplePlan,
  flowFromTrack,
  hotDiff,
  learnTrackOf,
  trackOfCues,
  trackPlan,
} from './cueExample'

describe('the example wave', () => {
  const level = (from: number, to: number) => {
    const bars = EXAMPLE_WAVE.slice(from - 1, to)
    return bars.reduce((sum, c) => sum + c.h, 0) / bars.length
  }

  it('drops quiet in the bars before the point and breaks loud right on it, so the eye finds the drop at bar 96', () => {
    expect(level(84, 95)).toBeLessThan(level(72, 79) * 0.6)
    expect(level(84, 95)).toBeLessThan(level(96, 103) * 0.4)
  })

  it('has no later loud block as big as the drop, so nothing else reads as the drop', () => {
    const drop = Math.min(...EXAMPLE_WAVE.slice(95, 103).map((c) => c.h))
    expect(Math.max(...EXAMPLE_WAVE.slice(127).map((c) => c.h))).toBeLessThan(drop)
  })
})

describe('the example track', () => {
  it('draws no CALL on the example point for a flow that leaves it unmarked, as placing it would', () => {
    const out = examplePlan({ ...ONE_AT_32, markPoint: false })
    expect(out.status === 'plan' && out.wanted.some((c) => c.kind === 0)).toBe(false)
    expect(out.status === 'plan' && out.wanted.map((c) => c.ms)).toEqual([exampleBar(64)])
  })

  it('is 192 bars at 128 BPM with the drop at bar 96, leaving room between the first beat and the countdown', () => {
    expect(EXAMPLE_GRID).toHaveLength(768)
    expect(EXAMPLE_GRID[1].ms - EXAMPLE_GRID[0].ms).toBe(469)
    expect(EXAMPLE_POINT_BAR).toBe(96)
    expect(EXAMPLE_DROP).toBe(exampleBar(96))
    expect(EXAMPLE_DURATION_MS).toBe(360000)
  })

  it('numbers bars from 1 so the drop reads bar 96 beat 1', () => {
    const at = EXAMPLE_GRID.findIndex((b) => b.ms === EXAMPLE_DROP)
    expect(Math.floor(at / 4) + 1).toBe(96)
    expect(EXAMPLE_GRID[at].beat).toBe(1)
    expect(exampleBar(1)).toBe(0)
  })

  it('shows Mi flujo as the countdown Vicent knows', () => {
    const out = examplePlan(MY_FLOW)
    expect(out.status === 'plan' && out.hot.map((h) => [h.ms, h.color])).toEqual([
      [exampleBar(48), 42],
      [exampleBar(64), 22],
      [exampleBar(80), 1],
    ])
  })

  it('shows the other bundled flows doing what their names say', () => {
    const one = examplePlan(ONE_AT_32)
    expect(one.status === 'plan' && one.wanted).toEqual([
      { ms: EXAMPLE_DROP, kind: 0, color: null },
      { ms: exampleBar(64), kind: 1, color: 22 },
    ])
    const calls = examplePlan(CALLS_ONLY)
    expect(calls.status === 'plan' && calls.wanted).toEqual([
      { ms: EXAMPLE_DROP, kind: 0, color: null },
    ])
  })
})

describe('the tracks of the collection a flow can be tried on', () => {
  const entry = (
    contentId: string | undefined,
    title: string,
    cues: { ms: number; kind: number }[] | null,
    path: string | null = `/music/${title}.aiff`,
  ) => ({
    path,
    ...(contentId ? { contentId } : {}),
    ...(cues
      ? {
          preview: {
            title,
            artist: 'Bicep',
            durationSec: 0,
            cues: cues.map((c) => ({ ...c, color: null })),
          },
        }
      : {}),
  })
  const MARK = [{ ms: 64000, kind: 0 }]

  it('offers every track the program gives a handle for, marked or not, since the programs without CALLs mark none and Auto mark finds the points of the rest', () => {
    const entries = [
      entry('rb:1', 'Glue', MARK),
      entry('rb:2', 'Atlas', []),
      entry('rb:3', 'Apricots', [
        { ms: 32000, kind: 1 },
        { ms: 32000, kind: 0 },
      ]),
      entry('rb:4', '', null, '/music/Aura.aiff'),
    ]
    expect(collectionChoices(entries)).toEqual([
      { contentId: 'rb:3', label: 'Apricots', artist: 'Bicep' },
      { contentId: 'rb:2', label: 'Atlas', artist: 'Bicep' },
      { contentId: 'rb:4', label: 'Aura' },
      { contentId: 'rb:1', label: 'Glue', artist: 'Bicep' },
    ])
  })

  it('leaves out an entry the program gives no handle for, whose cues cannot be read', () => {
    expect(collectionChoices([entry(undefined, 'Glue', MARK)])).toEqual([])
  })

  it('offers a track once even when the collection repeats it', () => {
    expect(collectionChoices([entry('rb:1', 'Glue', MARK), entry('rb:1', 'Glue', MARK)])).toEqual([
      { contentId: 'rb:1', label: 'Glue', artist: 'Bicep' },
    ])
  })

  it('names a track as its row in the list does, by its title or by its file when it has none, so the DJ finds it under the same name', () => {
    expect(
      collectionChoices([entry('rb:1', '', MARK, '/music/Bicep - Glue.aiff')]).map((c) => c.label),
    ).toEqual(['Bicep - Glue'])
  })

  it('sorts by name whatever the accents and capitals, so a whole collection can be read down like an index', () => {
    const entries = [
      entry('rb:1', 'Zebra', MARK),
      entry('rb:2', 'Élan', MARK),
      entry('rb:3', 'atlas', MARK),
      entry('rb:4', 'Delta', MARK),
    ]
    expect(collectionChoices(entries).map((c) => c.label)).toEqual([
      'atlas',
      'Delta',
      'Élan',
      'Zebra',
    ])
  })
})

describe('what a flow changes on a track', () => {
  it('names the hot cues the flow adds and the ones it takes away, so the preview can point at each', () => {
    expect(hotDiff([64000, 96000], [96000, 120000])).toEqual({ added: [64000], gone: [120000] })
  })

  it('takes a hot cue a few milliseconds off as the same one, since programs round positions differently', () => {
    expect(hotDiff([64000], [64050])).toEqual({ added: [], gone: [] })
    expect(hotDiff([64000], [64051])).toEqual({ added: [64000], gone: [64051] })
  })

  it('names once two hot cues the track has on the same spot, so the count matches the single square the wave can draw there', () => {
    expect(hotDiff([64000], [120000, 120000, 120030, 96000])).toEqual({
      added: [64000],
      gone: [120000, 96000],
    })
    expect(differingHot([64000], [120000, 120000, 120030, 96000])).toBe(3)
  })

  it('counts as many differing hot cues as it names, so the dot and the breakdown never disagree', () => {
    expect(differingHot([64000, 96000], [96000, 120000])).toBe(2)
    expect(differingHot([64000], [64010])).toBe(0)
  })
})

describe('a flow made from the track on screen', () => {
  const read = (over: Partial<TrackCues> = {}): TrackCues => ({
    contentId: 'rb:1',
    analysed: true,
    grid: EXAMPLE_GRID,
    strong: [{ start: exampleBar(97), end: exampleBar(129) }],
    phrases: [{ ms: exampleBar(97), kind: 'chorus' }],
    cues: [
      { id: 'mark', ms: exampleBar(97), kind: 0, color: null },
      { id: 'a', ms: exampleBar(81), kind: 1, color: 22 },
      { id: 'b', ms: exampleBar(65), kind: 2, color: 1 },
    ],
    wave: null,
    durationMs: EXAMPLE_DURATION_MS,
    fingerprint: '',
    gridFingerprint: '',
    ...over,
  })
  const withLoop = read({
    cues: [...read().cues, { id: 'loop', ms: exampleBar(49), kind: 3, color: 9, loop: true }],
  })

  it('hands the learning the grid, the sections and each cue with its colour, since the rules it writes count bars and paint cues', () => {
    expect(learnTrackOf(read())).toEqual({
      beats: EXAMPLE_GRID.map((b) => b.ms),
      cues: [
        { ms: exampleBar(97), kind: 0, color: null },
        { ms: exampleBar(81), kind: 1, color: 22 },
        { ms: exampleBar(65), kind: 2, color: 1 },
      ],
      strong: read().strong,
      phrases: read().phrases,
    })
  })

  it('leaves loops out, as the preview does when it reads the marks, so a loop is never learned as a hot cue', () => {
    expect(learnTrackOf(withLoop)).toEqual(learnTrackOf(read()))
    expect(flowFromTrack(withLoop)).toEqual(flowFromTrack(read()))
  })

  it('gives a flow the preview finds no difference with on the same track, so the DJ starts from what he already has', () => {
    const flow = flowFromTrack(read())
    expect(flow?.rules).toEqual([
      {
        from: 'drop',
        direction: 'back',
        bars: 16,
        repeat: 2,
        when: 'previous',
        place: 'hot',
        color: { each: [22, 1] },
      },
    ])
    const plan = flow && trackPlan(flow, trackOfCues(read()))
    expect(plan?.status === 'plan' && plan.hot.map((h) => [h.ms, h.color])).toEqual([
      [exampleBar(65), 1],
      [exampleBar(81), 22],
    ])
    expect(
      plan?.status === 'plan' &&
        differingHot(
          plan.hot.map((h) => h.ms),
          [exampleBar(81), exampleBar(65)],
        ),
    ).toBe(0)
  })

  it('gives nothing for a track without a grid, where no distance can be counted', () => {
    expect(flowFromTrack(read({ grid: [] }))).toBeNull()
  })
})
