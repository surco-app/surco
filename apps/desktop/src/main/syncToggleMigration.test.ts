import { describe, expect, it } from 'vitest'
import { migratedSyncToggles } from './syncToggleMigration'

// Both collection syncs used to be switched on by having a path and off by emptying it.
// That made an empty text field the off switch, which nobody guesses and the settings
// rule forbids — a control must always be visible and say what it needs. Each now has its
// own toggle, and anyone already syncing has to keep syncing across the upgrade.

describe('migratedSyncToggles', () => {
  // The case that matters: Traktor sync has shipped since v0.76, so a user with a path
  // set is already syncing. Defaulting their new toggle to off would silently stop it.
  it('turns the toggle on for someone already syncing with Traktor', () => {
    expect(migratedSyncToggles({ traktorNmlPath: '/m/collection.nml' })).toEqual({
      syncTraktor: true,
    })
  })

  // No path means they never set it up, and the new feature starts off.
  it('leaves the toggle off when no collection was ever set', () => {
    expect(migratedSyncToggles({ traktorNmlPath: '' })).toEqual({})
  })

  // Presence, not truthiness. Someone who has already seen the new UI and switched the
  // toggle off must not have it switched back on at every launch just because the path
  // field still remembers their collection — the path is now only a path.
  it('never overrides a toggle the user has already set', () => {
    expect(
      migratedSyncToggles({ traktorNmlPath: '/m/collection.nml', syncTraktor: false }),
    ).toEqual({})
    expect(migratedSyncToggles({ traktorNmlPath: '/m/collection.nml', syncTraktor: true })).toEqual(
      {},
    )
  })

  // rekordbox is new in this release: nobody can have been syncing with it before the
  // toggle existed, so there is nothing to migrate and it starts off like any new feature.
  it('does not turn rekordbox on for a detected collection', () => {
    expect(migratedSyncToggles({ rekordboxDbPath: '/m/master.db' })).toEqual({})
  })

  it('migrates nothing for a fresh install', () => {
    expect(migratedSyncToggles({})).toEqual({})
  })
})
