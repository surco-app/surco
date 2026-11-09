import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_WIZARD,
  normalizeSessionRoles,
  normalizeSessionWizard,
} from './sessionSettings'
import { sessionRoleKey } from './sessionTypes'

describe('sessionRoleKey', () => {
  it('names a playlist by its program and id', () => {
    expect(sessionRoleKey('rekordbox', '12')).toBe('rekordbox:12')
  })
})

describe('normalizeSessionRoles', () => {
  it('keeps valid roles', () => {
    expect(
      normalizeSessionRoles({ 'rekordbox:1': 'base', 'traktor:Top/Mix': 'set', 'serato:c': 'any' }),
    ).toEqual({ 'rekordbox:1': 'base', 'traktor:Top/Mix': 'set', 'serato:c': 'any' })
  })

  it('drops a key without a known program and an id', () => {
    expect(
      normalizeSessionRoles({
        '12': 'base',
        'virtualdj:1': 'base',
        'rekordbox:': 'base',
        'rekordbox:7': 'vocal',
      }),
    ).toEqual({ 'rekordbox:7': 'vocal' })
  })

  it('drops a value that is not one of the four roles', () => {
    expect(
      normalizeSessionRoles({ 'rekordbox:1': 'bases', 'rekordbox:2': 3, 'rekordbox:3': 'set' }),
    ).toEqual({
      'rekordbox:3': 'set',
    })
  })

  it('reads anything that is not an object as no roles', () => {
    expect(normalizeSessionRoles(undefined)).toEqual({})
    expect(normalizeSessionRoles(null)).toEqual({})
    expect(normalizeSessionRoles(['rekordbox:1'])).toEqual({})
    expect(normalizeSessionRoles('base')).toEqual({})
  })
})

describe('normalizeSessionWizard', () => {
  it('gives the stock answers when nothing was saved', () => {
    expect(normalizeSessionWizard(undefined)).toEqual(DEFAULT_SESSION_WIZARD)
    expect(DEFAULT_SESSION_WIZARD).toEqual({
      minutes: 90,
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

  it('falls back to free harmony for an unknown mode', () => {
    expect(normalizeSessionWizard({ harmony: 'strict' }).harmony).toBe('free')
  })

  it('takes the stock value for a switch that is not a boolean', () => {
    const merged = normalizeSessionWizard({ preferCombos: 'yes', surprise: 1 })
    expect(merged.preferCombos).toBe(true)
    expect(merged.surprise).toBe(false)
  })
})
