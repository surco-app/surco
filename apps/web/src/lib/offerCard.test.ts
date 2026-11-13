import { describe, expect, it } from 'vitest'
import { offerPlacement, showOffer } from './offerCard'

describe('offerPlacement', () => {
  it('right-aligns the card to the language button on a wide screen', () => {
    const p = offerPlacement({ left: 1200, right: 1250 }, 1440)
    expect(p.width).toBe(320)
    expect(p.left + p.width).toBe(1250)
    expect(p.arrow).toBe(1225 - p.left)
  })

  it('keeps the card inside a 390 px viewport with a margin on both sides', () => {
    const p = offerPlacement({ left: 250, right: 300 }, 390)
    expect(p.left).toBeGreaterThanOrEqual(16)
    expect(p.left + p.width).toBeLessThanOrEqual(390 - 16)
  })

  it('still points the arrow at the button when the card was pushed inwards', () => {
    const p = offerPlacement({ left: 250, right: 300 }, 390)
    expect(p.left + p.arrow).toBe(275)
  })

  it('narrows the card on screens thinner than the card', () => {
    const p = offerPlacement({ left: 200, right: 250 }, 300)
    expect(p.width).toBe(268)
    expect(p.left).toBe(16)
  })

  it('keeps the arrow away from the card corners', () => {
    const p = offerPlacement({ left: 1420, right: 1440 }, 1440)
    expect(p.arrow).toBeLessThanOrEqual(p.width - 16)
  })
})

describe('showOffer', () => {
  it('shows nothing when no language is offered', () => {
    expect(showOffer(null, false, false)).toBe(false)
  })

  it('shows the card for an offered language', () => {
    expect(showOffer('en', false, false)).toBe(true)
  })

  it('steps aside while the mobile menu is open so it cannot cover the menu links', () => {
    expect(showOffer('en', true, false)).toBe(false)
  })

  it('steps aside while the language menu is open so its edges do not stick out around the menu', () => {
    expect(showOffer('en', false, true)).toBe(false)
  })
})
