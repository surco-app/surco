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

  it('brings the row back when the user wheeled the list away from the selection', () => {
    // Scrolling with the trackpad leaves the selection far above the viewport; pressing ↓
    // selects the next row, and the editor loads a track the user can no longer see unless
    // the list follows it, even though it lies against the direction of travel.
    const top = pageScrollTop({
      ...base,
      delta: 1,
      rowTop: -2000,
      rowBottom: -1940,
      scrollTop: 3000,
    })
    expect(top).toBe(3000 - 2000 - 40 - 60)
  })

  it('reveals an off-screen row with no travel direction, as the player locate button needs', () => {
    // Locating the playing track that is already the selection has delta 0; returning null
    // made the locate button a no-op exactly when the user had scrolled away from it.
    const top = pageScrollTop({ ...base, delta: 0, rowTop: 900, rowBottom: 960, scrollTop: 0 })
    expect(top).toBe(900 - 40 - 60)
  })
})
