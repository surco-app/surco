// How often a running instance re-asks the feed for a newer build. Two hours keeps a
// day-long cleanup session in the loop without hammering GitHub: patches usually ship
// within the hour of their minor, so the launch-time check alone always missed them.
export const UPDATE_RECHECK_INTERVAL_MS = 2 * 60 * 60 * 1000

// Arms the periodic re-check and returns its disarm. The first probe stays the
// caller's job (it fires immediately at launch); this only covers the hours after.
export function armUpdateRecheck(
  check: () => void,
  intervalMs: number = UPDATE_RECHECK_INTERVAL_MS,
): () => void {
  const handle = setInterval(check, intervalMs)
  return () => clearInterval(handle)
}

// Wraps a background check so it only runs while the user lets Surco update itself.
// Reads the setting on every call, so switching it off stops the very next re-check.
export function onlyWhenAutoUpdates(enabled: () => boolean, check: () => void): () => void {
  return () => {
    if (enabled()) check()
  }
}
