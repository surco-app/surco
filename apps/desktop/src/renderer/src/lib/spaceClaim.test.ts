import { describe, expect, it, vi } from 'vitest'
import { claimKeys, runKeyClaim } from './spaceClaim'

describe('spaceClaim', () => {
  it('runs the claiming section handler instead of the global command', () => {
    const play = vi.fn()
    const release = claimKeys({ play })
    expect(runKeyClaim('play')).toBe(true)
    expect(play).toHaveBeenCalled()
    release()
  })

  it('leaves the key to the global command when nothing is claimed', () => {
    expect(runKeyClaim('play')).toBe(false)
  })

  it('hands the key back on release', () => {
    const release = claimKeys({ play: vi.fn() })
    release()
    expect(runKeyClaim('play')).toBe(false)
  })

  // Two wave sections can be open at once (click repair and the beatgrid), and each has
  // its own transport. The one opened last owns Space — that is the one the user is
  // looking at.
  it('gives the key to the most recent claimant', () => {
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = claimKeys({ play: first })
    const releaseSecond = claimKeys({ play: second })
    runKeyClaim('play')
    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
    releaseFirst()
  })

  // The bug this stack exists for: with a single global claim, the second section to
  // register simply overwrote the first, and when IT closed the key fell through to the
  // global command — so Space started the mini-player underneath a section that still
  // had its own transport open, which is exactly what claiming is meant to prevent.
  it('falls back to the section still open when the top one closes', () => {
    const below = vi.fn()
    const above = vi.fn()
    const releaseBelow = claimKeys({ play: below })
    const releaseAbove = claimKeys({ play: above })
    releaseAbove()
    expect(runKeyClaim('play')).toBe(true)
    expect(below).toHaveBeenCalled()
    releaseBelow()
    expect(runKeyClaim('play')).toBe(false)
  })

  // Releases can arrive in any order (React unmounts children before parents, and the
  // sections are reorderable), so a stale release must never resurrect a dead claim or
  // drop a live one.
  it('survives releases arriving out of order', () => {
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = claimKeys({ play: first })
    const releaseSecond = claimKeys({ play: second })
    releaseFirst()
    // The top claim is still the live one.
    runKeyClaim('play')
    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
    expect(runKeyClaim('play')).toBe(false)
  })

  it('only answers for the keys the top claimant actually registered', () => {
    const release = claimKeys({ play: vi.fn() })
    expect(runKeyClaim('centre-beat')).toBe(false)
    release()
  })

  // The top section can be open yet have nothing to play (click repair set to Off claims
  // no play handler). Space must then reach the nearest section BELOW that is still
  // auditioning, not fall through to the mini-player and blast the whole track under a
  // live transport. Play searches down the stack; the lane verbs stay top-only.
  it('runs play from the nearest claimant below when the top has none', () => {
    const below = vi.fn()
    const releaseBelow = claimKeys({ play: below })
    const releaseTop = claimKeys({ 'centre-beat': vi.fn() })
    expect(runKeyClaim('play')).toBe(true)
    expect(below).toHaveBeenCalled()
    // A lane verb the top did not register still does not reach the section below.
    expect(runKeyClaim('add-segment')).toBe(false)
    releaseTop()
    releaseBelow()
  })
})
