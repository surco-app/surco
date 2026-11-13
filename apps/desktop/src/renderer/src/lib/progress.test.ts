import { describe, expect, it } from 'vitest'
import { sweepTasks, topBarProgress } from './progress'

describe('topBarProgress', () => {
  it('is null when nothing is running so the top bar stays hidden', () => {
    expect(topBarProgress([null, null, { done: 0, total: 0 }], false)).toBeNull()
  })

  it('reports the fraction of a single running sweep', () => {
    expect(topBarProgress([{ done: 3, total: 12 }], false)).toEqual({ fraction: 0.25 })
  })

  it('follows the first running sweep, the one the toolbar pill shows, instead of a pooled sum that matched no counter', () => {
    const progress = topBarProgress(
      [
        { done: 2, total: 4 },
        { done: 8, total: 8 },
      ],
      false,
    )
    expect(progress).toEqual({ fraction: 0.5 })
  })

  it('ignores idle sweeps whose total is still zero', () => {
    expect(
      topBarProgress(
        [
          { done: 0, total: 0 },
          { done: 1, total: 5 },
        ],
        false,
      ),
    ).toEqual({
      fraction: 0.2,
    })
  })

  it('shows an indeterminate bar while importing, when no determinate sweep is running', () => {
    // Loading tags has no fixed total, so fraction is null (the bar animates instead).
    expect(topBarProgress([null], true)).toEqual({ fraction: null })
  })

  it('prefers the determinate fraction over the import indeterminate state', () => {
    expect(topBarProgress([{ done: 1, total: 2 }], true)).toEqual({ fraction: 0.5 })
  })
})

describe('sweepTasks', () => {
  it('is empty while nothing runs, so the pill stays hidden', () => {
    expect(sweepTasks({ importing: null, analysis: null, matching: null })).toEqual([])
  })

  it('leads with the import, since the other sweeps wait on the tracks it reads', () => {
    const tasks = sweepTasks({
      importing: { done: 10, total: 40 },
      analysis: { done: 1, total: 5 },
      matching: { done: 2, total: 8 },
    })
    expect(tasks.map((t) => t.kind)).toEqual(['import', 'analyze', 'match'])
  })

  it('counts auto-match against the tracks still to be read, so its total does not climb as the import goes', () => {
    const early = sweepTasks({
      importing: { done: 1662, total: 5303 },
      analysis: null,
      matching: { done: 108, total: 1662 },
    })
    const later = sweepTasks({
      importing: { done: 1842, total: 5303 },
      analysis: null,
      matching: { done: 118, total: 1842 },
    })
    expect(early[1]).toEqual({ kind: 'match', done: 108, total: 5303, waiting: 1554 })
    expect(later[1]).toEqual({ kind: 'match', done: 118, total: 5303, waiting: 1724 })
  })

  it('counts auto-match against its own queue once nothing is left to read', () => {
    expect(
      sweepTasks({ importing: null, analysis: null, matching: { done: 3, total: 9 } }),
    ).toEqual([{ kind: 'match', done: 3, total: 9, waiting: 6 }])
  })

  it('leaves out a sweep that has no total yet', () => {
    expect(
      sweepTasks({ importing: { done: 0, total: 0 }, analysis: null, matching: null }),
    ).toEqual([])
  })
})
