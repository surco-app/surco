import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { TRASH_MAX_BYTES, TRASH_RETENTION_DAYS } from '../shared/trash'
import type { TrashEntry, TrashReason } from '../shared/types'

// Surco's own trash: the originals a conversion replaced, kept for a while so a bad
// write is a restore rather than a loss. "Replace the original" was the one action the
// app took that could not be undone, and every defect in the write path — four in one
// week (17/09/2026) — cost the user the file instead of a redo. The OS Trash cannot do
// this job: an in-place conversion overwrites the source by renaming over it, so nothing
// ever passes through the Trash, and on a NAS macOS has no Trash at all and deletes
// outright (see trashSupport.ts). This folder lives in userData, on the local disk,
// under a manifest that names where each file came from.

export interface SurcoTrash {
  // Moves the file into the trash and records it. Null when there is no such file: a
  // caller cleaning up after a rename that changed only the case of the name asks for a
  // path that no longer exists, and that is not an error.
  stash(
    path: string,
    reason: TrashReason,
    outputPath?: string,
    trashedAt?: number,
  ): Promise<TrashEntry | null>
  list(): Promise<TrashEntry[]>
  // Puts the file back on its original path. Whatever occupies that path now — the
  // converted file, typically — goes into the trash in its turn, so restoring never
  // destroys a version either.
  restore(id: string): Promise<{ restoredTo: string; displaced: TrashEntry | null }>
  remove(id: string): Promise<void>
  empty(): Promise<void>
  // Drops what is older than the retention, then the oldest entries until the rest fits
  // under the size cap. Returns what it dropped. Run once at launch.
  sweep(now?: number): Promise<TrashEntry[]>
  dir: string
}

const DAY_MS = 24 * 60 * 60 * 1000

// A rename fails across volumes (a NAS or an external disk into userData): copy and
// unlink then, which costs a read of the file but keeps the promise.
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await unlink(from)
  }
}

export function createSurcoTrash(
  dir: string,
  opts: { retentionDays?: number; maxBytes?: number } = {},
): SurcoTrash {
  const retentionMs = (opts.retentionDays ?? TRASH_RETENTION_DAYS) * DAY_MS
  const maxBytes = opts.maxBytes ?? TRASH_MAX_BYTES
  const items = join(dir, 'items')
  const manifest = join(dir, 'trash.json')

  const read = (): TrashEntry[] => {
    if (!existsSync(manifest)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
      return Array.isArray(parsed) ? (parsed as TrashEntry[]) : []
    } catch {
      // A corrupt manifest (a partial write mid-crash) reads as empty rather than
      // failing every call; the files it named stay on disk until the next sweep of a
      // manifest that names them again.
      return []
    }
  }
  // Write-then-rename, like settings.json: a crash mid-write must not truncate the
  // one record of where each file belongs.
  const write = (entries: TrashEntry[]): void => {
    mkdirSync(dir, { recursive: true })
    const tmp = `${manifest}.tmp`
    writeFileSync(tmp, JSON.stringify(entries, null, 2))
    renameSync(tmp, manifest)
  }
  const newestFirst = (entries: TrashEntry[]): TrashEntry[] =>
    [...entries].sort((a, b) => b.trashedAt - a.trashedAt)

  const stash: SurcoTrash['stash'] = async (path, reason, outputPath, trashedAt) => {
    const info = await stat(path).catch(() => null)
    if (!info) return null
    await mkdir(items, { recursive: true })
    const id = randomUUID()
    const storedPath = join(items, `${id}-${basename(path)}`)
    await move(path, storedPath)
    const entry: TrashEntry = {
      id,
      name: basename(path),
      originalPath: path,
      storedPath,
      bytes: info.size,
      trashedAt: trashedAt ?? Date.now(),
      reason,
      ...(outputPath ? { outputPath } : {}),
    }
    write([...read(), entry])
    return entry
  }

  const discard = async (entry: TrashEntry): Promise<void> => {
    await unlink(entry.storedPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }

  return {
    dir,
    stash,
    list: async () => newestFirst(read()),
    restore: async (id) => {
      const entries = read()
      const entry = entries.find((e) => e.id === id)
      if (!entry) throw new Error(`no such trash entry: ${id}`)
      await mkdir(dirname(entry.originalPath), { recursive: true })
      const occupant = await stat(entry.originalPath).catch(() => null)
      const displaced = occupant ? await stash(entry.originalPath, 'restored-over') : null
      await move(entry.storedPath, entry.originalPath)
      write(read().filter((e) => e.id !== id))
      return { restoredTo: entry.originalPath, displaced }
    },
    remove: async (id) => {
      const entry = read().find((e) => e.id === id)
      if (!entry) return
      await discard(entry)
      write(read().filter((e) => e.id !== id))
    },
    empty: async () => {
      for (const entry of read()) await discard(entry)
      write([])
    },
    sweep: async (now = Date.now()) => {
      const entries = newestFirst(read())
      const dropped: TrashEntry[] = []
      let kept: TrashEntry[] = []
      for (const entry of entries) {
        if (now - entry.trashedAt > retentionMs) dropped.push(entry)
        else kept.push(entry)
      }
      // Newest first, so the running total keeps the recent ones and drops from the
      // old end once the cap is passed.
      let total = 0
      kept = kept.filter((entry) => {
        total += entry.bytes
        if (total <= maxBytes) return true
        dropped.push(entry)
        return false
      })
      for (const entry of dropped) await discard(entry)
      write(kept)
      return dropped
    },
  }
}
