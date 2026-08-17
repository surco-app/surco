import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import { normalizeTrim } from '../shared/trim'
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

// What one cover file resolved to, cached per distinct path across the whole restore.
// null means the file is gone (a pasted cover the OS temp cleaner took), which the
// caller turns into "this track falls back to its own artwork". `preview` is minted on
// first demand and remembered: a track that already carries a coverUrl needs none, so
// asking for it eagerly would decode a print-size scan nobody displays.
interface CoverEntry {
  preview?: string | undefined
  minted: boolean
}
type ResolvedCover = CoverEntry | null

// One filesystem question per distinct cover, however many tracks reference it.
function resolveCover(path: string, cache: Map<string, ResolvedCover>): ResolvedCover {
  const hit = cache.get(path)
  if (hit !== undefined) return hit
  const resolved: ResolvedCover = existsSync(path) ? { minted: false } : null
  cache.set(path, resolved)
  return resolved
}

// The preview for a resolved cover, decoded once across every track that shares it.
function previewOf(entry: CoverEntry, path: string): string | undefined {
  if (!entry.minted) {
    entry.preview = coverPreview(path)
    entry.minted = true
  }
  return entry.preview
}

// An edit written by this app is well-formed, but the file is hand-editable and old
// versions wrote no edits at all — anything that isn't the expected shape degrades to
// "no staged edits for this track" instead of poisoning the restore.
function sanitizeEdit(raw: unknown, previews: Map<string, ResolvedCover>): SessionEdit | null {
  if (typeof raw !== 'object' || raw === null) return null
  const edit = { ...(raw as SessionEdit) }
  if (typeof edit.meta !== 'object' || edit.meta === null) return null
  // Pasted covers live in an OS temp dir that a reboot clears; a vanished file can't
  // be embedded, so the track falls back to its own artwork.
  //
  // Resolved through the same per-file cache as the preview, not ahead of it. A cover
  // applied across a multi-selection is one file referenced by every track in it, so
  // the old order asked the filesystem once per TRACK — and this runs inside a load the
  // comment below calls async precisely so the window can paint. Local that is
  // microseconds; for a cover picked off a NAS it is a round trip apiece.
  if (edit.coverPath) {
    const resolved = resolveCover(edit.coverPath, previews)
    if (!resolved) delete edit.coverPath
    else if (!edit.coverUrl) {
      const preview = previewOf(resolved, edit.coverPath)
      if (preview) edit.coverUrl = preview
    }
  }
  // A malformed trim (hand-edited, or an inverted range) would make atrim emit an
  // empty stream at the next conversion — repair it to "no trim" here so every
  // consumer downstream can trust the shape.
  const trim = normalizeTrim(edit.trim)
  if (trim) edit.trim = trim
  else delete edit.trim
  // Sessions written before the beatgrid feature was removed still carry a
  // beatgrid key; drop it so the stale grid never rides the restore.
  delete (edit as Record<string, unknown>).beatgrid
  return edit
}

// Async, and deliberately so: this answers session:get on the main process, which is also
// the thread that paints the window. The existence check below used to be a synchronous
// existsSync per path, so a crate loaded from a network (SMB) volume blocked the main
// process for one stat round trip per track — ~4s measured for 622 paths — with the window
// created but unable to paint, which is the black window at launch. Worse, it was spent
// before the user had answered the reopen prompt at all: work for a decision not yet made.
// The awaits let the event loop (and the paint) run; the concurrent stats collapse the
// round trips into one wait instead of N.
export async function loadLastSession(): Promise<SessionData> {
  try {
    const raw = JSON.parse(await readFile(sessionPath(), 'utf-8')) as {
      paths?: unknown
      edits?: unknown
    }
    if (!Array.isArray(raw.paths)) return { paths: [], edits: {} }
    // Files deleted or unmounted since last quit would come back as broken rows;
    // dropping them here keeps the reopen offer's count honest. Checked concurrently so a
    // slow volume costs one round trip, not one per track, and never blocks the paint.
    const candidates = raw.paths.filter((p): p is string => typeof p === 'string')
    const present = await Promise.all(
      candidates.map((p) =>
        stat(p).then(
          () => true,
          () => false,
        ),
      ),
    )
    const paths = candidates.filter((_, i) => present[i])
    const edits: Record<string, SessionEdit> = {}
    if (typeof raw.edits === 'object' && raw.edits !== null) {
      const previews = new Map<string, ResolvedCover>()
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
