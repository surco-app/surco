// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion } from './motion'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
  }))
}

// Script-driven motion (a height tween, a smooth scroll) is invisible to the CSS media
// query, so it has to ask the OS itself; asking wrong means animating for someone who
// said motion makes them ill.
describe('prefersReducedMotion', () => {
  it('reports the reduce request', () => {
    stubMotion(true)
    expect(prefersReducedMotion()).toBe(true)
  })

  it('reports no request when motion is allowed', () => {
    stubMotion(false)
    expect(prefersReducedMotion()).toBe(false)
  })

  // Without matchMedia there is no way to know, and the app's default is its designed
  // motion, not a crash.
  it('treats a missing matchMedia as no request', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
