import type { Settings } from '../../../shared/types'

// The donate nudge is deliberately gentle: Surco asks for support, it never nags.
// It rides the moment of value — it's evaluated after a conversion run finishes,
// when the savings summary it shows actually means something — held back by three
// gates: enough real usage (a handful of conversions), a hard one-week cooldown
// between showings (stamped on display, so twice in a session is impossible), and a
// per-run random draw so it lands "every now and then" rather than on the exact
// conversion the cooldown expires. The dismissed flag (the modal's "don't show
// again") wins over everything.
export const MIN_CONVERSIONS = 5
export const MIN_DAYS_BETWEEN = 7
export const SHOW_CHANCE = 0.25

type NudgeState = Pick<
  Settings,
  'donateNudgeDismissed' | 'donateNudgeLastShown' | 'conversionCount' | 'hasSeenOnboarding'
>

export function shouldShowDonateNudge(settings: NudgeState, now: Date, random: number): boolean {
  if (settings.donateNudgeDismissed) return false
  if (!settings.hasSeenOnboarding) return false
  if (settings.conversionCount < MIN_CONVERSIONS) return false
  if (settings.donateNudgeLastShown) {
    const last = Date.parse(settings.donateNudgeLastShown)
    // Unparseable (or future) timestamps fail closed: skipping a nudge is free,
    // showing it on every launch is exactly what this module exists to prevent.
    if (Number.isNaN(last)) return false
    if (now.getTime() - last < MIN_DAYS_BETWEEN * 24 * 3600 * 1000) return false
  }
  return random < SHOW_CHANCE
}
