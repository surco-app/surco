import { describe, expect, it } from 'vitest'
import { topBarProgress } from './progress'

describe('topBarProgress', () => {
  it('is null when nothing is running so the top bar stays hidden', () => {
    expect(topBarProgress([null, null, { done: 0, total: 0 }], false)).toBeNull()
  })

  it('reports the fraction of a single running sweep', () => {
    expect(topBarProgress([{ done: 3, total: 12 }], false)).toEqual({ fraction: 0.25 })
  })

  it('pools done/total across concurrent sweeps so the bar reflects the total work left', () => {
    // 2/4 analyzing + 8/8 matching = 10 of 12 done overall.
    const progress = topBarProgress(
      [
        { done: 2, total: 4 },
        { done: 8, total: 8 },
      ],
      false,
    )
    expect(progress).toEqual({ fraction: 10 / 12 })
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
