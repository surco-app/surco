import type { Settings } from '../../../shared/types'

// The donate nudge is deliberately rare: Surco asks for support, it never nags.
// Three gates make that hold — enough real usage that the savings summary means
// something, a hard cooldown between showings, and a per-launch random draw so
// it lands "every now and then" instead of on a predictable schedule. The
// dismissed flag (the modal's "don't show again") wins over everything.
export const MIN_CONVERSIONS = 10
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
