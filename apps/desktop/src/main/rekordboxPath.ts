import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Where rekordbox keeps master.db. Unlike Traktor — whose collection folder moves with
// the version and the user's own preference, which is why that setting starts empty and
// must be filled in by hand — rekordbox uses one location per platform, so this can find
// it and the setting exists only as an override.
function standardPath(home: string, platform: string): string {
  return platform === 'win32'
    ? join(home, 'AppData', 'Roaming', 'Pioneer', 'rekordbox', 'master.db')
    : join(home, 'Library', 'Pioneer', 'rekordbox', 'master.db')
}

export interface CollectionLookup {
  home?: string
  platform?: string
  // The user's own path, when they keep the collection somewhere else.
  configured?: string
}

// The collection to work with, or an empty string when there is none — a user who does
// not run rekordbox is the normal case, and the feature simply stays off for them.
//
// A configured path always wins, even when the file is not there: an override means "use
// that collection", and falling back to a detected one would quietly write into a
// different library than the user named.
export function findRekordboxCollection(lookup: CollectionLookup = {}): string {
  if (lookup.configured) return lookup.configured
  const path = standardPath(lookup.home ?? homedir(), lookup.platform ?? process.platform)
  return existsSync(path) ? path : ''
}
