import { describe, expect, it } from 'vitest'
import { pageScrollTop } from './scroll'

// A 500px-tall list with a 40px sticky filter bar and uniform 60px rows (incl. gap).
const base = { viewport: 500, headerH: 40, footerH: 0, rowStep: 60, scrollTop: 0 }

describe('pageScrollTop', () => {
  it('pages down so the row the user came from becomes the top one', () => {
    // Stepping onto a row whose bottom (540) sits past the viewport (500): instead of
    // nudging it flush to the margin, scroll so it lands one row below the header — the
    // previous (last fully visible) row stays on screen at the top as a line of context.
    const top = pageScrollTop({ ...base, delta: 1, rowTop: 480, rowBottom: 540 })
    // After scrolling to 380, the row's new top is 480-380 = 100 = headerH(40)+rowStep(60).
    expect(top).toBe(380)
  })

  it('does not scroll when stepping onto a row already comfortably in view', () => {
    // Mid-list steps must not jump the list; only crossing the edge pages it.
    expect(pageScrollTop({ ...base, delta: 1, rowTop: 200, rowBottom: 260 })).toBeNull()
    expect(pageScrollTop({ ...base, delta: -1, rowTop: 200, rowBottom: 260 })).toBeNull()
  })

  it('pages up so the row the user came from becomes the bottom one', () => {
    // The mirror case: stepping up onto a row tucked behind the sticky header (top 10 <
    // headerH 40) scrolls so it sits one row above the bottom, the previous row trailing
    // below it as context.
    const top = pageScrollTop({ ...base, delta: -1, rowTop: 10, rowBottom: 70, scrollTop: 400 })
    // New scrollTop 30 puts the row's bottom at 70-(400-30)=... = visibleBottom(500)-rowStep(60).
    expect(top).toBe(30)
  })

  it('keeps the paged-to row clear of the floating player overlay', () => {
    // With the player open the list reserves its bottom 128px (pb-32); a row whose bottom
    // (380) clears the raw viewport but falls under the player (visible bottom 372) must
    // still page so the selection never hides behind the card.
    const top = pageScrollTop({ ...base, delta: 1, footerH: 128, rowTop: 320, rowBottom: 380 })
    expect(top).toBe(220)
  })
})
