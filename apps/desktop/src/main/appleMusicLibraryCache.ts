import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicLookupCandidate } from '../shared/types'

// The previous session's Apple Music library dump, persisted so the next launch can
// flag "already owned" instantly instead of waiting seconds for osascript to walk the
// whole library. Always machine-local (userData): it mirrors this machine's Music
// library, meaningless on another. The fresh dump that always follows replaces it, so
// staleness is bounded to the dump's own latency.
function cachePath(): string {
  return join(app.getPath('userData'), 'apple-music-library.json')
}

// The file sits on disk between sessions, so a truncated write or hand edit is
// possible; a row that isn't the expected shape is dropped rather than costing the
// whole snapshot, and mistyped optional fields degrade to a plainer candidate.
function sanitizeCandidate(raw: unknown): AppleMusicLookupCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { title, artist, durationSec, persistentId } = raw as AppleMusicLookupCandidate
  if (typeof title !== 'string' || !title || typeof artist !== 'string' || !artist) return null
  const candidate: AppleMusicLookupCandidate = { title, artist }
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
    candidate.durationSec = durationSec
  }
  if (typeof persistentId === 'string' && persistentId) candidate.persistentId = persistentId
  return candidate
}

// Write-then-rename so a crash mid-write leaves the previous snapshot, never a
// truncated file. The cache is an optimization: a failed write must not fail the
// dump whose result it was persisting, so failures are swallowed.
export function saveLibraryCache(candidates: AppleMusicLookupCandidate[]): void {
  try {
    const tmp = `${cachePath()}.tmp`
    writeFileSync(tmp, JSON.stringify(candidates))
    renameSync(tmp, cachePath())
  } catch {
    return
  }
}

// Null — not [] — when there is no usable snapshot: an empty array would flag the
// whole crate as not-owned, null means "no placeholder, wait for the dump".
// A non-empty file whose every row was dropped is corrupt, not an empty library,
// so it degrades to null too; only a genuinely empty saved library round-trips as [].
export function loadLibraryCache(): AppleMusicLookupCandidate[] | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(cachePath(), 'utf-8'))
    if (!Array.isArray(raw)) return null
    const candidates: AppleMusicLookupCandidate[] = []
    for (const entry of raw) {
      const candidate = sanitizeCandidate(entry)
      if (candidate) candidates.push(candidate)
    }
    if (raw.length > 0 && candidates.length === 0) return null
    return candidates
  } catch {
    return null
  }
}
