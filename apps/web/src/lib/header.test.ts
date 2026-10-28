import { describe, expect, it } from 'vitest'
import { isCondensed, showsHeaderDownload } from './header'

// The header used to shrink its own padding past a single 12px threshold. Because
// it also shortens the document, a scroll position sitting near that threshold could
// shrink the header, lose height, scroll back up, grow again — flickering between
// both sizes several times a second. Jumping to an anchor landed right in it.
//
// Two guards: the header keeps a fixed height so it never changes the document, and
// the state itself is hysteretic — it condenses at one point and expands at a lower
// one, so no single scroll position can satisfy both.
describe('isCondensed', () => {
  it('condenses once past the upper threshold', () => {
    expect(isCondensed(80, false)).toBe(true)
  })

  it('stays expanded below the upper threshold', () => {
    expect(isCondensed(20, false)).toBe(false)
  })

  it('does not expand again until well below the threshold', () => {
    // The exact position that used to oscillate: past the expand point but below
    // the condense point. Whatever state it is in, it must stay there.
    expect(isCondensed(40, true)).toBe(true)
    expect(isCondensed(40, false)).toBe(false)
  })

  it('expands only near the very top', () => {
    expect(isCondensed(4, true)).toBe(false)
  })

  it('treats a rubber-banded negative offset as the top', () => {
    expect(isCondensed(-30, true)).toBe(false)
  })
})

// The header's own download button stands in for the hero's once a visitor has
// scrolled past it, so the page never has two at once and is never without one.
describe('showsHeaderDownload', () => {
  it('stays hidden while the hero download is on screen', () => {
    expect(showsHeaderDownload({ isIntersecting: true, top: 300 })).toBe(false)
  })

  it('appears once the hero download has scrolled off the top', () => {
    expect(showsHeaderDownload({ isIntersecting: false, top: -120 })).toBe(true)
  })

  it('stays hidden when the hero download is below the fold, not past it', () => {
    // On a short window the hero button starts below the fold; nobody has passed it yet.
    expect(showsHeaderDownload({ isIntersecting: false, top: 900 })).toBe(false)
  })
})
