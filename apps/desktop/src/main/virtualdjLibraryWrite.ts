import { isUtf8 } from 'node:buffer'
import {
  copyFileSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import log from 'electron-log/main'
import type { BatchResult, OpOutcome, QueueOp } from './rekordboxQueueOps'
import { type FileStamp, fileStampOf, takeRotatedBackups } from './seratoLibraryWrite'
import { parseVirtualdjDatabase, type VirtualdjSong } from './virtualdjDatabase'
import { editedBody, type SongSpan, songSpans } from './virtualdjDatabaseWrite'
import { type VirtualdjRoot, virtualdjRootLabel } from './virtualdjLibrary'

export const virtualdjDatabaseOf = (root: VirtualdjRoot): string => join(root.dir, 'database.xml')

const sameStamp = (a: FileStamp | null, b: FileStamp | null): boolean =>
  a === b || (a !== null && b !== null && a.mtimeMs === b.mtimeMs && a.size === b.size)

export interface VirtualdjDraft {
  read(file: string): string | null
  write(file: string, xml: string): void
  songsOf(file: string): VirtualdjSong[] | null
  songEdited(file: string, path: string): boolean
  editSong(file: string, path: string, edit: (lines: string[]) => string[]): boolean
  stamps(): Map<string, FileStamp | null>
  changes(): { file: string; xml: string }[]
  notUtf8(file: string): boolean
}

export function createVirtualdjDraft(): VirtualdjDraft {
  const disk = new Map<string, string | null>()
  const stamps = new Map<string, FileStamp | null>()
  const layer = new Map<string, string>()
  const notUtf8 = new Set<string>()
  const fromDisk = (file: string): string | null => {
    if (!disk.has(file)) {
      const stamp = fileStampOf(file)
      stamps.set(file, stamp)
      const bytes = stamp ? readFileSync(file) : null
      if (bytes && !isUtf8(bytes)) notUtf8.add(file)
      disk.set(file, bytes ? bytes.toString('utf8') : null)
    }
    return disk.get(file) ?? null
  }
  const pending = new Map<
    string,
    { base: string; spans: Map<string, SongSpan>; bodies: Map<string, string> }
  >()
  const parsed = new Map<string, { xml: string; songs: VirtualdjSong[] }>()
  const settled = (file: string): string | null => {
    const waiting = pending.get(file)
    if (!waiting || waiting.bodies.size === 0) return layer.get(file) ?? fromDisk(file)
    const parts: string[] = []
    let from = 0
    const edited = [...waiting.bodies]
      .map(([path, body]) => ({ span: waiting.spans.get(path) as SongSpan, body }))
      .sort((a, b) => a.span.openEnd - b.span.openEnd)
    for (const { span, body } of edited) {
      parts.push(waiting.base.slice(from, span.openEnd), body)
      from = span.bodyEnd
    }
    parts.push(waiting.base.slice(from))
    pending.delete(file)
    layer.set(file, parts.join(''))
    return layer.get(file) ?? null
  }
  const unsettled = (file: string): string | null =>
    pending.get(file)?.base ?? layer.get(file) ?? fromDisk(file)
  return {
    read: settled,
    write(file, xml) {
      fromDisk(file)
      pending.delete(file)
      layer.set(file, xml)
    },
    songsOf(file) {
      const xml = unsettled(file)
      if (xml === null) return null
      const known = parsed.get(file)
      if (known?.xml === xml) return known.songs
      const songs = parseVirtualdjDatabase(xml)
      parsed.set(file, { xml, songs })
      return songs
    },
    songEdited: (file, path) => pending.get(file)?.bodies.has(path) ?? false,
    editSong(file, path, edit) {
      const base = unsettled(file)
      if (base === null) return false
      let waiting = pending.get(file)
      if (!waiting) {
        waiting = { base, spans: songSpans(base), bodies: new Map() }
        pending.set(file, waiting)
      }
      const span = waiting.spans.get(path)
      if (!span) return false
      const body = waiting.bodies.get(path) ?? base.slice(span.openEnd, span.bodyEnd)
      waiting.bodies.set(path, editedBody(body, edit))
      return true
    },
    stamps: () => new Map(stamps),
    changes: () => {
      for (const file of [...pending.keys()]) settled(file)
      return [...layer]
        .filter(([file, xml]) => disk.get(file) !== xml)
        .map(([file, xml]) => ({ file, xml }))
    },
    notUtf8: (file) => notUtf8.has(file),
  }
}

export interface VirtualdjCommitDeps {
  backupDir: string
  roots: () => VirtualdjRoot[]
  virtualdjOpen: () => Promise<boolean>
  now?: () => Date
  sessionBackup?: () => Promise<void>
}

export type VirtualdjCommit =
  | 'written'
  | 'nothing'
  | 'cancelled'
  | 'changed'
  | 'backup-failed'
  | 'unreadable'
  | 'write-failed'
  | 'write-unknown'

export const LIST_BACKUPS = 'lists'
export const HISTORY_BACKUPS = 'history'
const KEPT_BACKUPS = 20
const WRITING = '.surco-write'

function backupPathOf(file: string, roots: VirtualdjRoot[]): string {
  const root = roots.find((r) => file.startsWith(`${resolve(r.dir)}${sep}`))
  if (!root) throw new Error(`${file} is in no VirtualDJ library`)
  return join(virtualdjRootLabel(root), relative(root.dir, file))
}

export function takeBackups(files: string[], deps: VirtualdjCommitDeps): Map<string, string> {
  return takeRotatedBackups(files, deps, backupPathOf, KEPT_BACKUPS, [
    LIST_BACKUPS,
    HISTORY_BACKUPS,
  ])
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
  if (changes.some(({ file }) => draft.notUtf8(file))) {
    log.warn('VirtualDJ database holds bytes that are not UTF-8, nothing written')
    return 'unreadable'
  }
  const stamps = draft.stamps()
  const moved = () =>
    changes.some(({ file }) => !sameStamp(fileStampOf(file), stamps.get(file) ?? null))
  for (const { file } of changes) clearOrphan(`${file}${WRITING}`)
  if (await deps.virtualdjOpen()) return 'cancelled'
  let copies: Map<string, string>
  try {
    await deps.sessionBackup?.()
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

const ATTEMPTS = 3

export async function applyVirtualdjDraftOps(
  ops: QueueOp[],
  deps: VirtualdjCommitDeps & {
    ensureClosed: () => Promise<boolean>
    stillQueued?: (id: string) => boolean
  },
  apply: (draft: VirtualdjDraft, op: QueueOp, roots: VirtualdjRoot[]) => OpOutcome,
): Promise<BatchResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
    const draft = createVirtualdjDraft()
    const roots = deps.roots()
    const outcomes = ops.map(
      (op): OpOutcome =>
        deps.stillQueued && !deps.stillQueued(op.id)
          ? { id: op.id, applied: false, reason: 'cancelled', notices: [] }
          : apply(draft, op, roots),
    )
    const written = await commitVirtualdjDraft(draft, deps)
    if (written === 'changed') continue
    if (written !== 'written' && written !== 'nothing') return { ok: false, reason: written }
    return { ok: true, wrote: written === 'written', outcomes }
  }
  log.info('VirtualDJ database kept changing while Surco wrote, nothing written')
  return { ok: false, reason: 'cancelled' }
}
