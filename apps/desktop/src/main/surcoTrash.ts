import { randomUUID } from 'node:crypto'
import { constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, stat, statfs, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { TRASH_MAX_BYTES, TRASH_MIN_FREE_BYTES, TRASH_RETENTION_DAYS } from '../shared/trash'
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
  // Moves the file into the trash and records it. Null when there is no such file (a
  // caller cleaning up after a rename that changed only the case of the name asks for a
  // path that no longer exists, and that is not an error) or when the file does not fit
  // the room the cap and the disk leave. A `held` copy (an original waiting for the
  // self-check under «Nunca») only takes room that is free: it evicts nothing, and nothing
  // evicts it until it is released.
  stash(
    path: string,
    reason: TrashReason,
    outputPath?: string,
    trashedAt?: number,
    held?: boolean,
  ): Promise<TrashEntry | null>
  release(id: string): void
  list(): Promise<TrashEntry[]>
  // Puts the file back on its original path. Whatever occupies that path now — the
  // converted file, typically — goes into the trash in its turn, so restoring never
  // destroys a version either.
  restore(id: string): Promise<{ restoredTo: string; displaced: TrashEntry | null }>
  remove(id: string): Promise<void>
  empty(): Promise<void>
  // Drops what is older than the retention, then the oldest entries until the rest fits
  // under the size cap. Returns what it dropped. Run at launch; stash makes the same
  // room before each copy, so the cap also holds while the app stays open.
  sweep(now?: number): Promise<TrashEntry[]>
  dir: string
}

const DAY_MS = 24 * 60 * 60 * 1000

// A rename fails across volumes (a NAS or an external disk into userData): copy and
// unlink then, which costs a read of the file but keeps the promise. The copy goes to a
// hidden sibling first and is renamed into place, so a share that drops mid-copy leaves
// no truncated file under the real name.
// `stuckSource` says what a source that will not go after the copy means. Into the trash,
// the move did not happen: the copy is dropped and the original stays where it was. Out of
// it (a restore), the copy IS the user's file back in place: it stays, and the stored copy,
// no longer listed, is left to the sweep of unnamed files.
async function move(
  from: string,
  to: string,
  stuckSource: 'undo' | 'leave' = 'undo',
): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    const partial = join(dirname(to), `.${basename(to)}.tmp-${randomUUID().slice(0, 8)}`)
    try {
      await copyFile(from, partial)
      await rename(partial, to)
    } catch (copyErr) {
      await unlink(partial).catch(() => {})
      throw copyErr
    }
    // A source that will not go (a Windows lock) means the move did not happen: drop the
    // copy, or it stays behind under a name no manifest entry points at.
    await unlink(from).catch(async (unlinkErr) => {
      if (stuckSource === 'leave') return
      await unlink(to).catch(() => {})
      throw unlinkErr
    })
  }
}

// The limits, either fixed or read fresh on every sweep. A getter is what the app
// passes: they are the user's setting now, saved while the app runs, and a value
// captured when the trash was built would leave a tightened cap doing nothing until the
// next restart — indistinguishable, to the user, from a setting that does not work.
export type TrashLimits = { retentionDays?: number; maxBytes?: number }

async function diskFree(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true })
  const fs = await statfs(dir)
  return fs.bavail * fs.bsize
}

export function createSurcoTrash(
  dir: string,
  opts: TrashLimits | (() => TrashLimits) = {},
  freeBytes: () => Promise<number> = () => diskFree(dir),
): SurcoTrash {
  const limits = (): { retentionMs: number; maxBytes: number } => {
    const o = typeof opts === 'function' ? opts() : opts
    return {
      retentionMs: (o.retentionDays ?? TRASH_RETENTION_DAYS) * DAY_MS,
      maxBytes: o.maxBytes ?? TRASH_MAX_BYTES,
    }
  }
  const items = join(dir, 'items')
  const manifest = join(dir, 'trash.json')

  const read = (): TrashEntry[] => {
    if (!existsSync(manifest)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
      return Array.isArray(parsed) ? (parsed as TrashEntry[]) : []
    } catch {
      // A corrupt manifest reads as empty rather than failing every call. It is set aside
      // so the next write cannot destroy the original paths it holds, and the files it
      // named are swept once they outlive the retention.
      try {
        renameSync(manifest, `${manifest}.unreadable`)
      } catch {}
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

  const discard = async (entry: TrashEntry): Promise<void> => {
    await unlink(entry.storedPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }

  // Drops what is past the retention, then the oldest entries until the rest fits in
  // `room` bytes.
  const pinned = new Set<string>()
  const prune = async (now: number, room: number): Promise<TrashEntry[]> => {
    const { retentionMs } = limits()
    const entries = newestFirst(read()).filter((e) => !pinned.has(e.id))
    const dropped: TrashEntry[] = []
    let kept: TrashEntry[] = []
    for (const entry of entries) {
      if (now - entry.trashedAt > retentionMs) dropped.push(entry)
      else kept.push(entry)
    }
    // Newest first, so the running total keeps the recent ones and drops from the
    // old end once the room is used up.
    let total = read()
      .filter((e) => pinned.has(e.id))
      .reduce((sum, e) => sum + e.bytes, 0)
    kept = kept.filter((entry) => {
      total += entry.bytes
      if (total <= room) return true
      dropped.push(entry)
      return false
    })
    for (const entry of dropped) await discard(entry)
    const gone = new Set(dropped.map((e) => e.id))
    write(read().filter((e) => !gone.has(e.id)))
    return dropped
  }

  // Aged from when the file came into the trash. A move keeps the file's own creation
  // date, years old for a track bought long ago, while the change time is set by the move
  // itself (and by the copy, a new file).
  const sweepUnnamed = async (now: number): Promise<void> => {
    const named = new Set(read().map((e) => e.storedPath))
    const { retentionMs } = limits()
    for (const name of await readdir(items).catch(() => [])) {
      const path = join(items, name)
      if (named.has(path)) continue
      const info = await stat(path).catch(() => null)
      if (info && now - Math.max(info.birthtimeMs, info.ctimeMs) > retentionMs)
        await unlink(path).catch(() => {})
    }
  }

  const keep: SurcoTrash['stash'] = async (path, reason, outputPath, trashedAt) => {
    const info = await stat(path).catch(() => null)
    if (!info) return null
    await mkdir(items, { recursive: true })
    const id = randomUUID()
    const storedPath = join(items, `${id}-${basename(path)}`)
    // A replaced original stays on its path: the conversion's rename lands over it, and
    // until then it is the user's only copy. Moving it out first meant a rename that
    // failed needed a way back, and on an SMB NAS that way back failed too. A clone
    // where the volume can make one, so a local disk pays nothing for the copy.
    if (reason === 'replaced') await copyFile(path, storedPath, constants.COPYFILE_FICLONE)
    else await move(path, storedPath)
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

  // The room is made before the copy, not swept after it: the copy just taken is what a
  // failed rename restores from, and a sweep behind it could discard exactly that one.
  // The disk bounds it as well as the cap. A file that fits in neither even with the
  // trash emptied gets no copy, and nothing is dropped to make room it would not use.
  const stashNow: SurcoTrash['stash'] = async (path, reason, outputPath, trashedAt, hold) => {
    const info = await stat(path).catch(() => null)
    if (!info) return null
    const entries = read()
    const held = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    const budget = Math.min(limits().maxBytes, held + (await freeBytes()) - TRASH_MIN_FREE_BYTES)
    const untouchable = hold
      ? held
      : entries.filter((e) => pinned.has(e.id)).reduce((sum, e) => sum + e.bytes, 0)
    if (info.size + untouchable > budget) return null
    if (!hold) await prune(Date.now(), budget - info.size)
    const entry = await keep(path, reason, outputPath, trashedAt)
    if (entry && hold) pinned.add(entry.id)
    return entry
  }
  // One at a time: a batch stashes several originals at once, and each sized its room
  // from the trash as it stood before the others had written, so together they went
  // past the cap and the disk's free margin.
  let stashing: Promise<unknown> = Promise.resolve()
  const stash: SurcoTrash['stash'] = (...args) => {
    const run = stashing.then(() => stashNow(...args))
    stashing = run.catch(() => {})
    return run
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
      const displaced = occupant ? await keep(entry.originalPath, 'restored-over') : null
      await move(entry.storedPath, entry.originalPath, 'leave')
      write(read().filter((e) => e.id !== id))
      return { restoredTo: entry.originalPath, displaced }
    },
    release: (id) => {
      pinned.delete(id)
    },
    remove: async (id) => {
      pinned.delete(id)
      const entry = read().find((e) => e.id === id)
      if (!entry) return
      await discard(entry)
      write(read().filter((e) => e.id !== id))
    },
    // Each copy is settled on its own: one held open must not leave the ones already deleted
    // listed, pointing at files that are gone. The first failure is reported once the list
    // says what is really left.
    empty: async () => {
      const gone = new Set<string>()
      let failure: unknown = null
      for (const entry of read()) {
        try {
          await discard(entry)
          gone.add(entry.id)
        } catch (err) {
          failure ??= err
        }
      }
      write(read().filter((e) => !gone.has(e.id)))
      if (failure) throw failure
    },
    sweep: async (now = Date.now()) => {
      const dropped = await prune(now, limits().maxBytes)
      await sweepUnnamed(now)
      return dropped
    },
  }
}
