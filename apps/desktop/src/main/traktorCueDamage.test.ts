import { describe, expect, it } from 'vitest'
import { type CueMark, judgeTraktorPair, offsetBetween, type TraktorPair } from './traktorCueDamage'

const K = -51.18
const cues = (intro: number, brk: number): CueMark[] => [
  { type: 0, hotcue: 0, ms: intro },
  { type: 0, hotcue: 1, ms: brk },
]
const pair = (p: Partial<TraktorPair>): TraktorPair => ({
  sourceEntry: null,
  sourceTree: null,
  siblingEntry: null,
  siblingTree: null,
  k: K,
  sourceOnBootDisk: true,
  ...p,
})

describe('offsetBetween', () => {
  it('is the one displacement that takes every cue of a to b', () => {
    expect(offsetBetween(cues(10000, 15000), cues(9948.82, 14948.82))).toBeCloseTo(-51.18, 6)
  })

  it('is null when the cues moved by different amounts', () => {
    expect(offsetBetween(cues(10000, 15000), cues(9948.82, 14990))).toBeNull()
  })

  it('is null when a cue changed its button', () => {
    expect(
      offsetBetween(cues(10000, 15000), [
        { type: 0, hotcue: 0, ms: 10000 },
        { type: 0, hotcue: 2, ms: 15000 },
      ]),
    ).toBeNull()
  })
})

// Traktor shows a cue where the file's own tree and its collection entry say. Each bug left a
// recognisable displacement: the MP3's entry took its converted sibling's cues (calibrated
// for the PCM), or the sibling kept a rule that no longer matches its source's header.
describe('judgeTraktorPair', () => {
  it("is sure the MP3 entry took the sibling's cues when its own tree proves it", () => {
    expect(
      judgeTraktorPair(
        pair({
          sourceTree: cues(10000, 15000),
          sourceEntry: cues(9948.82, 14948.82),
          siblingTree: cues(9948.82, 14948.82),
        }),
      ),
    ).toEqual([
      {
        kind: 'traktor-source-cues',
        certainty: 'sure',
        addMs: 51.18,
        fixEntry: 'source',
        fixTree: false,
      },
    ])
  })

  it('is only likely without the MP3 tree', () => {
    const [j] = judgeTraktorPair(
      pair({ sourceEntry: cues(9948.82, 14948.82), siblingTree: cues(9948.82, 14948.82) }),
    )
    expect(j.certainty).toBe('likely')
    expect(j.addMs).toBeCloseTo(51.18, 6)
  })

  it('leaves an entry off the boot disk alone, where the bug never ran', () => {
    expect(
      judgeTraktorPair(
        pair({
          sourceTree: cues(10000, 15000),
          sourceEntry: cues(9948.82, 14948.82),
          siblingTree: cues(9948.82, 14948.82),
          sourceOnBootDisk: false,
        }),
      ),
    ).toEqual([])
  })

  it('leaves a healthy pair alone', () => {
    expect(
      judgeTraktorPair(
        pair({
          sourceTree: cues(10000, 15000),
          sourceEntry: cues(10000, 15000),
          siblingTree: cues(9948.82, 14948.82),
          siblingEntry: cues(9948.82, 14948.82),
        }),
      ),
    ).toEqual([])
  })

  it('moves a WAV converted with the old rule by the 51.18 ms it missed', () => {
    expect(
      judgeTraktorPair(
        pair({
          sourceTree: cues(10000, 15000),
          sourceEntry: cues(10000, 15000),
          siblingTree: cues(10000, 15000),
          siblingEntry: cues(10000, 15000),
        }),
      ),
    ).toEqual([
      {
        kind: 'traktor-calibration',
        certainty: 'sure',
        addMs: -51.18,
        fixEntry: 'sibling',
        fixTree: true,
      },
    ])
  })

  it('moves back an AIFF the old rule moved from an MP3 with no Xing header', () => {
    const [j] = judgeTraktorPair(
      pair({
        k: 0,
        sourceTree: cues(10000, 15000),
        siblingTree: cues(9949, 14949),
        siblingEntry: cues(9949, 14949),
      }),
    )
    expect(j.kind).toBe('traktor-calibration')
    expect(j.addMs).toBeCloseTo(51, 6)
  })

  it('is only likely when the reference is the MP3 entry', () => {
    const [j] = judgeTraktorPair(
      pair({
        sourceEntry: cues(10000, 15000),
        siblingEntry: cues(10000, 15000),
        sourceOnBootDisk: false,
      }),
    )
    expect(j).toMatchObject({ kind: 'traktor-calibration', certainty: 'likely', fixTree: false })
  })

  it('leaves a sibling off by an amount no old rule produced', () => {
    expect(
      judgeTraktorPair(pair({ sourceTree: cues(10000, 15000), siblingTree: cues(9970, 14970) })),
    ).toEqual([])
  })

  it('leaves cues edited by hand afterwards', () => {
    expect(
      judgeTraktorPair(pair({ sourceTree: cues(10000, 15000), siblingTree: cues(10000, 16000) })),
    ).toEqual([])
  })
})
