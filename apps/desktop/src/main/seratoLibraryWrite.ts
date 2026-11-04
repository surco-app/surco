import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import log from 'electron-log/main'
import type { FileStamp } from './rekordboxQueueOps'
import type { SeratoLibraryRoot } from './seratoLibrary'

export function fileStampOf(file: string): FileStamp | null {
  const stat = statSync(file, { throwIfNoEntry: false })
  return stat ? { mtimeMs: stat.mtimeMs, size: stat.size } : null
}

const sameStamp = (a: FileStamp | null, b: FileStamp | null): boolean =>
  a === b || (a !== null && b !== null && a.mtimeMs === b.mtimeMs && a.size === b.size)

interface Entry {
  bytes: Uint8Array
  origin: string | null
  written: boolean
}

export interface DraftChanges {
  writes: { file: string; bytes: Uint8Array }[]
  renames: { from: string; to: string }[]
  removals: string[]
}

export interface SeratoDraft {
  read(file: string): Uint8Array | null
  exists(file: string): boolean
  write(file: string, bytes: Uint8Array): void
  rename(from: string, to: string): void
  remove(file: string): void
  list(dir: string): string[]
  stamps(): Map<string, FileStamp | null>
  changes(): DraftChanges
}

export function createSeratoDraft(): SeratoDraft {
  const disk = new Map<string, Uint8Array | null>()
  const stamps = new Map<string, FileStamp | null>()
  const layer = new Map<string, Entry | null>()

  const fromDisk = (file: string): Uint8Array | null => {
    if (!disk.has(file)) {
      const stamp = fileStampOf(file)
      stamps.set(file, stamp)
      disk.set(file, stamp ? readFileSync(file) : null)
    }
    return disk.get(file) ?? null
  }
  const entryOf = (file: string): Entry | null => {
    if (layer.has(file)) return layer.get(file) ?? null
    const bytes = fromDisk(file)
    return bytes ? { bytes, origin: file, written: false } : null
  }

  return {
    read: (file) => entryOf(file)?.bytes ?? null,
    exists: (file) => entryOf(file) !== null,
    write(file, bytes) {
      layer.set(file, { bytes, origin: entryOf(file)?.origin ?? null, written: true })
    },
    rename(from, to) {
      const entry = entryOf(from)
      if (!entry) throw new Error(`nothing to rename at ${from}`)
      layer.set(from, null)
      layer.set(to, entry)
    },
    remove(file) {
      entryOf(file)
      layer.set(file, null)
    },
    list(dir) {
      const names = new Set(existsSync(dir) ? readdirSync(dir) : [])
      for (const [file, entry] of layer) {
        if (dirname(file) !== dir) continue
        if (entry) names.add(basename(file))
        else names.delete(basename(file))
      }
      return [...names]
    },
    stamps: () => new Map(stamps),
    changes() {
      const live = [...layer].filter((e): e is [string, Entry] => e[1] !== null)
      const origins = new Set(live.map(([, e]) => e.origin))
      const targets = new Set(live.map(([file]) => file))
      return {
        writes: live
          .filter(([, e]) => e.written)
          .map(([file, e]) => ({ file: e.origin ?? file, bytes: e.bytes })),
        renames: live
          .filter(([file, e]) => e.origin !== null && e.origin !== file)
          .map(([file, e]) => ({ from: e.origin as string, to: file })),
        removals: [...layer]
          .filter(([file, e]) => e === null && disk.get(file) && !origins.has(file))
          .map(([file]) => file)
          .filter((file) => !targets.has(file)),
      }
    },
  }
}

export interface SeratoCommitDeps {
  backupDir: string
  roots: () => SeratoLibraryRoot[]
  seratoOpen: () => Promise<boolean>
  now?: () => Date
}

export type SeratoCommit =
  | 'written'
  | 'nothing'
  | 'cancelled'
  | 'backup-failed'
  | 'write-failed'
  | 'write-unknown'

const KEPT_BACKUPS = 20
const TMP = '.surco-tmp'

export function backupFolderName(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

function backupPathOf(file: string, roots: SeratoLibraryRoot[]): string {
  const root = roots.find((r) => file.startsWith(`${r.dir}/`))
  if (!root) throw new Error(`${file} is in no Serato library`)
  return join(root.root === '/' ? 'Music' : basename(root.root), relative(root.dir, file))
}

function takeBackups(files: string[], deps: SeratoCommitDeps): Map<string, string> {
  const folder = join(deps.backupDir, backupFolderName(deps.now?.() ?? new Date()))
  mkdirSync(folder, { recursive: true })
  const roots = deps.roots()
  const copies = new Map<string, string>()
  for (const file of files) {
    const copy = join(folder, backupPathOf(file, roots))
    mkdirSync(dirname(copy), { recursive: true })
    copyFileSync(file, copy)
    copies.set(file, copy)
  }
  const folders = readdirSync(deps.backupDir).sort()
  for (const old of folders.slice(0, Math.max(0, folders.length - KEPT_BACKUPS)))
    rmSync(join(deps.backupDir, old), { recursive: true, force: true })
  return copies
}

type Undo = { restore: string } | { unlink: string }

export async function commitSeratoDraft(
  draft: SeratoDraft,
  deps: SeratoCommitDeps,
): Promise<SeratoCommit> {
  const { writes, renames, removals } = draft.changes()
  if (writes.length + renames.length + removals.length === 0) return 'nothing'
  const stamps = draft.stamps()
  const existed = (file: string): boolean => (stamps.get(file) ?? null) !== null
  if (await deps.seratoOpen()) return 'cancelled'
  let copies: Map<string, string>
  try {
    const touched = [...writes.map((w) => w.file), ...renames.map((r) => r.from), ...removals]
    copies = takeBackups([...new Set(touched.filter(existed))], deps)
  } catch (e) {
    log.warn('Serato library backup failed', e)
    return 'backup-failed'
  }

  const changed = new Set<string>()
  const temps = new Set<string>()
  const undo: Undo[] = []
  const rollback = (): boolean => {
    try {
      for (const step of [...undo].reverse()) {
        if ('unlink' in step) rmSync(step.unlink, { force: true })
        else copyFileSync(copies.get(step.restore) as string, step.restore)
      }
      for (const tmp of temps) rmSync(tmp, { force: true })
      return true
    } catch (e) {
      log.error('Serato library rollback failed', e)
      return false
    }
  }
  const safe = async (): Promise<boolean> => {
    if (await deps.seratoOpen()) return false
    for (const [file, stamp] of stamps)
      if (!changed.has(file) && !sameStamp(fileStampOf(file), stamp)) {
        log.info(`Serato library: ${file} changed on disk, nothing written`)
        return false
      }
    return true
  }
  const step = async (run: () => void, undoing: Undo, files: string[]): Promise<boolean> => {
    if (!(await safe())) return false
    for (const file of files) changed.add(file)
    run()
    undo.push(undoing)
    return true
  }
  const undoOf = (file: string): Undo => (existed(file) ? { restore: file } : { unlink: file })

  try {
    for (const { file, bytes } of writes) {
      mkdirSync(dirname(file), { recursive: true })
      temps.add(`${file}${TMP}`)
      writeFileSync(`${file}${TMP}`, bytes)
    }
    const steps: [() => void, Undo, string[]][] = [
      ...writes.map(({ file }): [() => void, Undo, string[]] => [
        () => {
          renameSync(`${file}${TMP}`, file)
          temps.delete(`${file}${TMP}`)
        },
        undoOf(file),
        [file],
      ]),
      ...renames.map(({ from }): [() => void, Undo, string[]] => [
        () => {
          renameSync(from, `${from}${TMP}`)
          temps.add(`${from}${TMP}`)
        },
        { restore: from },
        [from],
      ]),
      ...renames.map(({ from, to }): [() => void, Undo, string[]] => [
        () => {
          renameSync(`${from}${TMP}`, to)
          temps.delete(`${from}${TMP}`)
        },
        { unlink: to },
        [to],
      ]),
      ...removals.map((file): [() => void, Undo, string[]] => [
        () => rmSync(file),
        { restore: file },
        [file],
      ]),
    ]
    for (const [run, undoing, files] of steps)
      if (!(await step(run, undoing, files))) return rollback() ? 'cancelled' : 'write-unknown'
    return 'written'
  } catch (e) {
    log.warn('Serato library write failed', e)
    return rollback() ? 'write-failed' : 'write-unknown'
  }
}
