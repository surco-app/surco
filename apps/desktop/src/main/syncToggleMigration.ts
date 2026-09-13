import type { Settings } from '../shared/types'

// Both collection syncs used to be turned on by filling in a path and off by emptying it,
// which made a blank text field the off switch. Nobody guesses that, and it contradicts
// the rule the settings screen follows everywhere else: a control is always visible and
// says what it still needs. Each sync now has its own toggle, and the path is just a path.
//
// Which leaves one thing to carry across: Traktor's sync has shipped since v0.76, so a
// user with a path set is already syncing today. Defaulting their new toggle to off would
// stop it without telling them.

export function migratedSyncToggles(stored: Partial<Settings>): Partial<Settings> {
  // Presence, not truthiness — the same rule the Discogs token migration in settings.ts
  // had to learn. Once the toggle exists in the stored settings it is the user's answer,
  // including a deliberate false, and a path left in the field must never overturn it.
  if ('syncTraktor' in stored) return {}
  // rekordbox ships with its toggle, so nobody can have been syncing before it existed:
  // there is nothing to carry across and it starts off like any other new feature.
  return stored.traktorNmlPath ? { syncTraktor: true } : {}
}
