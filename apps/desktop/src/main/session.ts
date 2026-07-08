import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import type { SessionData, SessionEdit } from '../shared/types'

// The last-loaded track paths plus each track's staged (not yet converted) edits, so
// a relaunch can offer to reopen where the user left off — edits included, because a
// crash mid-retag used to throw away hours of staged metadata. Always machine-local
// (userData, never the syncable config dir): these are absolute paths on this disk,
// meaningless on another machine.
function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

// Restored previews stay small: a locally picked cover can be a print-size scan, and
// the preview only feeds the editor's cover well.
const COVER_PREVIEW_MAX_PX = 512

// A locally picked cover was displayed through a blob: URL that died with the old
// renderer; only its file path survives the relaunch. Mint a fresh data: preview so
// the restored row shows the exact cover it will embed.
function coverPreview(path: string): string | undefined {
  try {
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return undefined
    const scaled =
      img.getSize().width > COVER_PREVIEW_MAX_PX ? img.resize({ width: COVER_PREVIEW_MAX_PX }) : img
    return scaled.toDataURL()
  } catch {
    return undefined
  }
}

// An edit written by this app is well-formed, but the file is hand-editable and old
// versions wrote no edits at all — anything that isn't the expected shape degrades to
// "no staged edits for this track" instead of poisoning the restore.
function sanitizeEdit(raw: unknown, previews: Map<string, string | undefined>): SessionEdit | null {
  if (typeof raw !== 'object' || raw === null) return null
  const edit = { ...(raw as SessionEdit) }
  if (typeof edit.meta !== 'object' || edit.meta === null) return null
  // Pasted covers live in an OS temp dir that a reboot clears; a vanished file can't
  // be embedded, so the track falls back to its own artwork.
  if (edit.coverPath && !existsSync(edit.coverPath)) delete edit.coverPath
  if (edit.coverPath && !edit.coverUrl) {
    // One preview per distinct file: a cover applied across a multi-selection is
    // shared by many tracks, and minting it once keeps the load O(files) not O(tracks).
    if (!previews.has(edit.coverPath)) previews.set(edit.coverPath, coverPreview(edit.coverPath))
    const preview = previews.get(edit.coverPath)
    if (preview) edit.coverUrl = preview
  }
  return edit
}

export function loadLastSession(): SessionData {
  try {
    const raw = JSON.parse(readFileSync(sessionPath(), 'utf-8')) as {
      paths?: unknown
      edits?: unknown
    }
    if (!Array.isArray(raw.paths)) return { paths: [], edits: {} }
    // Files deleted or unmounted since last quit would come back as broken rows;
    // dropping them here keeps the reopen offer's count honest.
    const paths = raw.paths.filter((p): p is string => typeof p === 'string' && existsSync(p))
    const edits: Record<string, SessionEdit> = {}
    if (typeof raw.edits === 'object' && raw.edits !== null) {
      const previews = new Map<string, string | undefined>()
      for (const path of paths) {
        const edit = sanitizeEdit((raw.edits as Record<string, unknown>)[path], previews)
        if (edit) edits[path] = edit
      }
    }
    return { paths, edits }
  } catch {
    return { paths: [], edits: {} }
  }
}

// Write-then-rename like the settings store: a crash mid-write must never truncate
// the file into unparseable JSON that would silently discard the session.
export function saveLastSession(paths: string[], edits: Record<string, SessionEdit>): void {
  const path = sessionPath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify({ paths, edits }), 'utf-8')
  renameSync(tmp, path)
}
