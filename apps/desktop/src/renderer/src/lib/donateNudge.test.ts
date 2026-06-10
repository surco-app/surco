import { describe, expect, it } from 'vitest'
import {
  MIN_CONVERSIONS,
  MIN_DAYS_BETWEEN,
  SHOW_CHANCE,
  shouldShowDonateNudge,
} from './donateNudge'

const now = new Date('2026-06-10T12:00:00Z')

function state(over: Partial<Parameters<typeof shouldShowDonateNudge>[0]> = {}) {
  return {
    donateNudgeDismissed: false,
    donateNudgeLastShown: '',
    conversionCount: MIN_CONVERSIONS,
    hasSeenOnboarding: true,
    ...over,
  }
}

describe('shouldShowDonateNudge', () => {
  // The whole point of the checkbox: once the user says "don't show again", the
  // nudge is gone for good no matter how eligible the rest of the state looks.
  it('never shows once dismissed', () => {
    expect(shouldShowDonateNudge(state({ donateNudgeDismissed: true }), now, 0)).toBe(false)
  })

  // A summary of "what Surco saved you" is meaningless to someone who has barely
  // used it — and asking them for money on day one would read as nagware.
  it('waits until there is real usage to summarize', () => {
    expect(
      shouldShowDonateNudge(state({ conversionCount: MIN_CONVERSIONS - 1 }), now, 0),
    ).toBe(false)
    expect(shouldShowDonateNudge(state({ conversionCount: MIN_CONVERSIONS }), now, 0)).toBe(true)
  })

  // The nudge must never stack on top of (or race) the first-run wizard.
  it('never shows before onboarding is done', () => {
    expect(shouldShowDonateNudge(state({ hasSeenOnboarding: false }), now, 0)).toBe(false)
  })

  // "De vez en cuando": a hard floor of days between showings, regardless of luck.
  it('enforces the cooldown since the last showing', () => {
    const justUnder = new Date(now.getTime() - (MIN_DAYS_BETWEEN * 24 - 1) * 3600 * 1000)
    const justOver = new Date(now.getTime() - (MIN_DAYS_BETWEEN * 24 + 1) * 3600 * 1000)
    expect(
      shouldShowDonateNudge(state({ donateNudgeLastShown: justUnder.toISOString() }), now, 0),
    ).toBe(false)
    expect(
      shouldShowDonateNudge(state({ donateNudgeLastShown: justOver.toISOString() }), now, 0),
    ).toBe(true)
  })

  // Past the cooldown it stays random per launch, so it lands "every now and then"
  // instead of greeting the user on a predictable schedule.
  it('only shows when the per-launch draw lands under the chance', () => {
    expect(shouldShowDonateNudge(state(), now, SHOW_CHANCE - 0.01)).toBe(true)
    expect(shouldShowDonateNudge(state(), now, SHOW_CHANCE)).toBe(false)
  })

  // A corrupt or future timestamp must fail closed (skip) rather than spam.
  it('skips when the stored timestamp is unparseable', () => {
    expect(shouldShowDonateNudge(state({ donateNudgeLastShown: 'garbage' }), now, 0)).toBe(false)
  })
})
