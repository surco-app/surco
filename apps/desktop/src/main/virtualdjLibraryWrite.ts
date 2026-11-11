import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import log from 'electron-log/main'
import { backupFolderName, type FileStamp, fileStampOf } from './seratoLibraryWrite'
import type { VirtualdjRoot } from './virtualdjLibrary'

export const virtualdjDatabaseOf = (root: VirtualdjRoot): string => join(root.dir, 'database.xml')

const sameStamp = (a: FileStamp | null, b: FileStamp | null): boolean =>
  a === b || (a !== null && b !== null && a.mtimeMs === b.mtimeMs && a.size === b.size)

export interface VirtualdjDraft {
  read(file: string): string | null
  write(file: string, xml: string): void
  stamps(): Map<string, FileStamp | null>
  changes(): { file: string; xml: string }[]
}

export function createVirtualdjDraft(): VirtualdjDraft {
  const disk = new Map<string, string | null>()
  const stamps = new Map<string, FileStamp | null>()
  const layer = new Map<string, string>()
  const fromDisk = (file: string): string | null => {
    if (!disk.has(file)) {
      const stamp = fileStampOf(file)
      stamps.set(file, stamp)
      disk.set(file, stamp ? readFileSync(file, 'utf8') : null)
    }
    return disk.get(file) ?? null
  }
  return {
    read: (file) => layer.get(file) ?? fromDisk(file),
    write(file, xml) {
      fromDisk(file)
      layer.set(file, xml)
    },
    stamps: () => new Map(stamps),
    changes: () =>
      [...layer]
        .filter(([file, xml]) => disk.get(file) !== xml)
        .map(([file, xml]) => ({ file, xml })),
  }
}

export interface VirtualdjCommitDeps {
  backupDir: string
  roots: () => VirtualdjRoot[]
  virtualdjOpen: () => Promise<boolean>
  now?: () => Date
}

export type VirtualdjCommit =
  | 'written'
  | 'nothing'
  | 'cancelled'
  | 'changed'
  | 'backup-failed'
  | 'write-failed'
  | 'write-unknown'

const KEPT_BACKUPS = 20
export const LIST_BACKUPS = 'lists'
const WRITING = '.surco-write'

function backupPathOf(file: string, roots: VirtualdjRoot[]): string {
  const root = roots.find((r) => file.startsWith(`${resolve(r.dir)}/`))
  if (!root) throw new Error(`${file} is in no VirtualDJ library`)
  return join(root.root === '/' ? 'Local' : basename(root.root), relative(root.dir, file))
}

export function takeBackups(files: string[], deps: VirtualdjCommitDeps): Map<string, string> {
  const name = backupFolderName(deps.now?.() ?? new Date())
  let folder = join(deps.backupDir, name)
  for (let n = 1; existsSync(folder); n++) folder = join(deps.backupDir, `${name}-${n}`)
  mkdirSync(folder, { recursive: true })
  const roots = deps.roots()
  const copies = new Map<string, string>()
  for (const file of files) {
    const copy = join(folder, backupPathOf(file, roots))
    mkdirSync(dirname(copy), { recursive: true })
    copyFileSync(file, copy)
    copies.set(file, copy)
  }
  const older = readdirSync(deps.backupDir)
    .filter((n) => n !== basename(folder) && n !== LIST_BACKUPS)
    .sort()
  for (const old of older.slice(0, Math.max(0, older.length + 1 - KEPT_BACKUPS)))
    rmSync(join(deps.backupDir, old), { recursive: true, force: true })
  return copies
}

function clearOrphan(tmp: string): void {
  try {
    rmSync(tmp, { force: true })
  } catch (e) {
    log.warn(`VirtualDJ temp ${tmp} not removed`, e)
  }
}

export async function commitVirtualdjDraft(
  draft: VirtualdjDraft,
  deps: VirtualdjCommitDeps,
): Promise<VirtualdjCommit> {
  const changes = draft.changes()
  if (changes.length === 0) return 'nothing'
  const stamps = draft.stamps()
  const moved = () =>
    changes.some(({ file }) => !sameStamp(fileStampOf(file), stamps.get(file) ?? null))
  for (const { file } of changes) clearOrphan(`${file}${WRITING}`)
  if (await deps.virtualdjOpen()) return 'cancelled'
  let copies: Map<string, string>
  try {
    copies = takeBackups(
      changes.map((c) => c.file).filter((file) => stamps.get(file)),
      deps,
    )
  } catch (e) {
    log.warn('VirtualDJ database backup failed', e)
    return 'backup-failed'
  }
  const done: string[] = []
  const temps = new Set<string>()
  const undo = (): boolean => {
    try {
      for (const tmp of temps) rmSync(tmp, { force: true })
      for (const file of done.reverse()) copyFileSync(copies.get(file) as string, file)
      return true
    } catch (e) {
      log.error('VirtualDJ database rollback failed', e)
      return false
    }
  }
  try {
    for (const { file, xml } of changes) {
      const tmp = `${file}${WRITING}`
      temps.add(tmp)
      writeFileSync(tmp, xml, 'utf8')
    }
    const refusal = (await deps.virtualdjOpen()) ? 'cancelled' : moved() ? 'changed' : null
    if (refusal) return undo() ? refusal : 'write-unknown'
    for (const { file } of changes) {
      const tmp = `${file}${WRITING}`
      renameSync(tmp, file)
      temps.delete(tmp)
      done.push(file)
    }
    return 'written'
  } catch (e) {
    log.warn('VirtualDJ database write failed', e)
    return undo() ? 'write-failed' : 'write-unknown'
  }
}
