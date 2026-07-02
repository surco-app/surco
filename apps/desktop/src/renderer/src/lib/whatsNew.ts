import type { Settings } from '../../../shared/types'

// The shape of apps/web/src/i18n/changelog/*.json, which the desktop imports
// directly so the popup and the web page can never drift apart. Plain-string items
// predate version stamping and are web-only history.
export type ChangelogItem = string | { text: string; in: string }

export interface ChangelogRelease {
  version: string
  date: string
  title: string
  items: ChangelogItem[]
}

export interface WhatsNewRelease {
  version: string
  title: string
  items: string[]
}

type WhatsNewState = Pick<Settings, 'hasSeenOnboarding' | 'lastSeenChangelogVersion'>

function parse(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

// Decides what the post-update "what's new" popup shows: every stamped changelog
// item shipped after the version the user last saw, up to the running version,
// grouped under its minor's title. Returns null when there is nothing to show —
// fresh installs (no update happened, and onboarding already owns that launch),
// already-seen versions, pure-fix updates, downgrades and corrupt stamps all fail
// closed, because a popup that fires on every launch is worse than no popup.
export function selectWhatsNew(
  releases: ChangelogRelease[],
  settings: WhatsNewState,
  currentVersion: string,
): WhatsNewRelease[] | null {
  if (!settings.hasSeenOnboarding) return null
  const current = parse(currentVersion)
  if (!current) return null

  const lastSeen = settings.lastSeenChangelogVersion
  // No stamp on an install that already finished onboarding means the user updated
  // from a version that predates this feature: fall back to the current minor.
  const floor: [number, number, number] | null =
    lastSeen === '' ? [current[0], current[1], -1] : parse(lastSeen)
  if (!floor || compare(floor, current) >= 0) return null

  const selected: WhatsNewRelease[] = []
  for (const release of releases) {
    const items: string[] = []
    for (const item of release.items) {
      if (typeof item === 'string') continue
      const shipped = parse(item.in)
      if (!shipped) continue
      if (compare(shipped, floor) > 0 && compare(shipped, current) <= 0) {
        items.push(item.text)
      }
    }
    if (items.length > 0) selected.push({ version: release.version, title: release.title, items })
  }
  return selected.length > 0 ? selected : null
}
