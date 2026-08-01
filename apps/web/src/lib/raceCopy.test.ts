import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import { MANUAL_STEPS, raceFrame, RACE_END, TRACKS } from './race'

// Speed.tsx pairs MANUAL_STEPS with the translated manualSteps by index, and prints
// each step's duration straight off MANUAL_STEPS. Nothing in the type system ties the
// two lists together, so a step added on one side and not the other would silently
// mislabel every row after it, or drop a row's time entirely.
const LOCALES = { es, en }

describe('the manual flow copy and its timings', () => {
  for (const [name, locale] of Object.entries(LOCALES)) {
    it(`has one ${name} label per timed step`, () => {
      expect(locale.speed.manualSteps).toHaveLength(MANUAL_STEPS.length)
    })

    it(`gives every ${name} step an app and a label`, () => {
      for (const step of locale.speed.manualSteps) {
        expect(step.label.trim()).not.toBe('')
        expect(step.app.trim()).not.toBe('')
      }
    })
  }

  // This is the mistake that already shipped once: the lede promised "four or five
  // minutes per track" while the steps below it added up to under two, because the
  // steps were corrected and the sentence above them was not. The headline figure has
  // to be derivable from the same numbers the card animates.
  it('states a total the steps actually add up to', () => {
    const { manualSeconds } = raceFrame(RACE_END)
    const hours = Math.floor(manualSeconds / 3600)
    const minutes = Math.round((manualSeconds % 3600) / 60)

    for (const locale of Object.values(LOCALES)) {
      const claimed = locale.speed.manualTime.match(/(\d+)\s*h\s*(\d+)/)
      expect(claimed, `manualTime should read like "~2 h 45 min", got "${locale.speed.manualTime}"`).
        not.toBeNull()
      const claimedMinutes = Number(claimed?.[1]) * 60 + Number(claimed?.[2])
      // Rounded for readability, so allow the copy to sit within a few minutes of the
      // computed total rather than demanding an exact match.
      expect(Math.abs(claimedMinutes - (hours * 60 + minutes))).toBeLessThanOrEqual(5)
    }
  })

  // Batch steps run once for the whole folder. If every step became per-track the
  // total would balloon back to the three-hour figure a DJ would read as inflated.
  it('keeps at least one step off the per-track loop', () => {
    expect(MANUAL_STEPS.some((s) => s.per === 'batch')).toBe(true)
    expect(MANUAL_STEPS.some((s) => s.per === 'track')).toBe(true)
  })

  it('animates the same track count the copy talks about', () => {
    expect(raceFrame(RACE_END).surcoDone).toBe(TRACKS)
    for (const locale of Object.values(LOCALES)) {
      expect(locale.speed.oneClick).toContain(String(TRACKS))
    }
  })
})
