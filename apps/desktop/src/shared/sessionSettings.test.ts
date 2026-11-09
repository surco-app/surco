import { describe, expect, it } from 'vitest'
import {
  answersFromSettings,
  DEFAULT_SESSION_WIZARD,
  normalizeSessionRoles,
  normalizeSessionWizard,
  rolesForProgram,
  withPlaylistRole,
  wizardSettingsFrom,
} from './sessionSettings'
import { sessionRoleKey } from './sessionTypes'

describe('sessionRoleKey', () => {
  it('names a playlist by its program and id', () => {
    expect(sessionRoleKey('rekordbox', '12')).toBe('rekordbox:12')
  })
})

describe('rolesForProgram', () => {
  it('lists the roles of one program by playlist id and leaves the others out', () => {
    expect(
      rolesForProgram(
        { 'rekordbox:1': 'base', 'rekordbox:Top/Mix': 'set', 'traktor:1': 'vocal' },
        'rekordbox',
      ),
    ).toEqual({ '1': 'base', 'Top/Mix': 'set' })
  })

  it('keeps an id that itself holds a colon', () => {
    expect(rolesForProgram({ 'serato:Sets:Friday': 'set' }, 'serato')).toEqual({
      'Sets:Friday': 'set',
    })
  })
})

describe('withPlaylistRole', () => {
  it('adds a role without touching the roles it was given', () => {
    const before = { 'rekordbox:1': 'base' as const }
    const after = withPlaylistRole(before, 'rekordbox', '2', 'set')
    expect(after).toEqual({ 'rekordbox:1': 'base', 'rekordbox:2': 'set' })
    expect(before).toEqual({ 'rekordbox:1': 'base' })
  })

  it('replaces the role of a playlist', () => {
    expect(withPlaylistRole({ 'rekordbox:1': 'base' }, 'rekordbox', '1', 'vocal')).toEqual({
      'rekordbox:1': 'vocal',
    })
  })

  it('takes a role away with null', () => {
    expect(
      withPlaylistRole({ 'rekordbox:1': 'base', 'traktor:1': 'set' }, 'rekordbox', '1', null),
    ).toEqual({ 'traktor:1': 'set' })
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
