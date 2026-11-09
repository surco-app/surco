import { describe, expect, it } from 'vitest'
import {
  answersFromSettings,
  DEFAULT_SESSION_WIZARD,
  normalizeSessionWizard,
  wizardSettingsFrom,
} from './sessionSettings'

describe('answersFromSettings', () => {
  it('starts the wizard from the saved answers with no playlists chosen yet', () => {
    const saved = { ...DEFAULT_SESSION_WIZARD, minutes: 120, surprise: true }
    expect(answersFromSettings(saved)).toEqual({ ...saved, sources: [], fresh: [] })
  })
})

describe('wizardSettingsFrom', () => {
  const answers = {
    ...DEFAULT_SESSION_WIZARD,
    minutes: 60,
    harmony: 'neighbours' as const,
    alternate: false,
    sources: ['a'],
    fresh: [],
  }

  it('keeps the way the session was asked for and leaves the playlists out', () => {
    expect(wizardSettingsFrom(answers, DEFAULT_SESSION_WIZARD)).toEqual({
      ...DEFAULT_SESSION_WIZARD,
      minutes: 60,
      harmony: 'neighbours',
      alternate: false,
    })
  })

  it('keeps the share the user last chose when no new playlist was picked and the share came as zero', () => {
    const saved = { ...DEFAULT_SESSION_WIZARD, freshShare: 0.3 }
    expect(wizardSettingsFrom({ ...answers, freshShare: 0 }, saved).freshShare).toBe(0.3)
  })

  it('takes the share of this session when new playlists were picked', () => {
    expect(
      wizardSettingsFrom({ ...answers, fresh: ['n'], freshShare: 0.25 }, DEFAULT_SESSION_WIZARD)
        .freshShare,
    ).toBe(0.25)
  })
})

describe('normalizeSessionWizard', () => {
  it('gives the stock answers when nothing was saved', () => {
    expect(normalizeSessionWizard(undefined)).toEqual(DEFAULT_SESSION_WIZARD)
    expect(DEFAULT_SESSION_WIZARD).toEqual({
      minutes: 90,
      playMinutes: 3,
      freshShare: 0.15,
      preferCombos: true,
      harmony: 'free',
      tasteWeight: true,
      alternate: true,
      surprise: false,
    })
  })

  it('keeps what the user chose', () => {
    const chosen = {
      minutes: 120,
      playMinutes: 4,
      freshShare: 0.3,
      preferCombos: false,
      harmony: 'neighbours' as const,
      tasteWeight: false,
      alternate: false,
      surprise: true,
    }
    expect(normalizeSessionWizard(chosen)).toEqual(chosen)
  })

  it('clamps the share of new tracks to 0 to 0.4', () => {
    expect(normalizeSessionWizard({ freshShare: 0.9 }).freshShare).toBe(0.4)
    expect(normalizeSessionWizard({ freshShare: -1 }).freshShare).toBe(0)
  })

  it('goes back to 90 minutes for a duration that is not positive or not a number', () => {
    expect(normalizeSessionWizard({ minutes: 0 }).minutes).toBe(90)
    expect(normalizeSessionWizard({ minutes: -5 }).minutes).toBe(90)
    expect(normalizeSessionWizard({ minutes: 'long' }).minutes).toBe(90)
  })

  it('keeps the minutes each track plays between 1 and 10, in whole minutes', () => {
    expect(normalizeSessionWizard({ playMinutes: 0 }).playMinutes).toBe(1)
    expect(normalizeSessionWizard({ playMinutes: 25 }).playMinutes).toBe(10)
    expect(normalizeSessionWizard({ playMinutes: 3.6 }).playMinutes).toBe(4)
  })

  it('goes back to 3 minutes a track when the saved value is not a number', () => {
    expect(normalizeSessionWizard({ playMinutes: 'long' }).playMinutes).toBe(3)
    expect(normalizeSessionWizard({ playMinutes: Number.NaN }).playMinutes).toBe(3)
    expect(normalizeSessionWizard({}).playMinutes).toBe(3)
  })

  it('falls back to free harmony for an unknown mode', () => {
    expect(normalizeSessionWizard({ harmony: 'strict' }).harmony).toBe('free')
  })

  it('takes the stock value for a switch that is not a boolean', () => {
    const merged = normalizeSessionWizard({ preferCombos: 'yes', surprise: 1 })
    expect(merged.preferCombos).toBe(true)
    expect(merged.surprise).toBe(false)
  })
})
