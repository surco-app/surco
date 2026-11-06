import { describe, expect, it } from 'vitest'
import { currentAnalysisLane } from './analysisLane'
import { analysisLimiter } from './analysisLimiter'

describe('analysis lane', () => {
  it('tells a background analysis it runs in the low lane, so its decodes can stay on one core', async () => {
    const seen = await analysisLimiter.run(async () => {
      await Promise.resolve()
      return currentAnalysisLane()
    }, 'low')

    expect(seen).toBe('low')
  })

  it('tells the track on screen it runs in the high lane, so its decodes keep every core', async () => {
    const seen = await analysisLimiter.run(async () => currentAnalysisLane(), 'high')

    expect(seen).toBe('high')
  })

  it('names no lane outside the analysis limiter, so conversions keep their own threading', () => {
    expect(currentAnalysisLane()).toBeUndefined()
  })
})
