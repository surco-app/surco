import { describe, expect, it } from 'vitest'
import { DJ_REACH_SETTINGS, fromDjReach, reachedPrograms, toDjReach } from './djReach'

describe('toDjReach', () => {
  it('reads the stored pair as the one thing the DJ asked of the program', () => {
    expect(toDjReach(false, false)).toBe('off')
    expect(toDjReach(true, false)).toBe('update')
    expect(toDjReach(true, true)).toBe('add')
  })

  it('reads an old add-without-update setting as add, because adding is what it does', () => {
    expect(toDjReach(false, true)).toBe('add')
  })
})

describe('fromDjReach', () => {
  it('keeps the program updated whenever new tracks are added to it', () => {
    expect(fromDjReach('add')).toEqual({ sync: true, add: true })
  })

  it('clears both flags for off so an old add flag cannot keep reaching the program', () => {
    expect(fromDjReach('off')).toEqual({ sync: false, add: false })
    expect(fromDjReach('update')).toEqual({ sync: true, add: false })
  })

  it('round-trips every choice so the control never shows something else than was saved', () => {
    for (const r of ['off', 'update', 'add'] as const) {
      const { sync, add } = fromDjReach(r)
      expect(toDjReach(sync, add)).toBe(r)
    }
  })
})

describe('DJ_REACH_SETTINGS', () => {
  it('ties each program to its own stored flags so one control never writes another program', () => {
    expect(DJ_REACH_SETTINGS).toEqual({
      rekordbox: { sync: 'syncRekordbox', add: 'addToRekordbox' },
      engine: { sync: 'syncEngineDj', add: 'addToEngineDj' },
      traktor: { sync: 'syncTraktor', add: 'addToTraktor' },
    })
  })
})

describe('reachedPrograms', () => {
  it('lists the programs new tracks go to, in the same order on every machine', () => {
    expect(
      reachedPrograms({
        addToRekordbox: true,
        addToTraktor: true,
        addToEngineDj: true,
      }),
    ).toEqual(['rekordbox', 'engine', 'traktor'])
    expect(
      reachedPrograms({
        addToRekordbox: false,
        addToTraktor: true,
        addToEngineDj: false,
      }),
    ).toEqual(['traktor'])
    expect(
      reachedPrograms({
        addToRekordbox: false,
        addToTraktor: false,
        addToEngineDj: false,
      }),
    ).toEqual([])
  })

  it('leaves out a program Surco cannot reach, so the button never promises adding to it', () => {
    const s = { addToRekordbox: false, addToTraktor: true, addToEngineDj: false }
    expect(reachedPrograms(s, new Set(['rekordbox']))).toEqual([])
    expect(reachedPrograms(s)).toEqual(['traktor'])
  })
})
