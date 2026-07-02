import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// The last-loaded track paths, so a relaunch can offer to reopen where the user left
// off. Always machine-local (userData, never the syncable config dir): these are
// absolute paths on this disk, meaningless on another machine.
function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

export function loadLastSession(): string[] {
  try {
    const raw = JSON.parse(readFileSync(sessionPath(), 'utf-8')) as { paths?: unknown }
    if (!Array.isArray(raw.paths)) return []
    // Files deleted or unmounted since last quit would come back as broken rows;
    // dropping them here keeps the reopen offer's count honest.
    return raw.paths.filter((p): p is string => typeof p === 'string' && existsSync(p))
  } catch {
    return []
  }
}

// Write-then-rename like the settings store: a crash mid-write must never truncate
// the file into unparseable JSON that would silently discard the session.
export function saveLastSession(paths: string[]): void {
  const path = sessionPath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify({ paths }), 'utf-8')
  renameSync(tmp, path)
}
