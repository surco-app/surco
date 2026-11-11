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
import { basename, dirname, join, relative } from 'node:path'
import log from 'electron-log/main'
import type { CopyReason, LibraryCopy, RestoreRefusal, RestoreResult } from '../shared/types'
import { HISTORY_KEEP } from './libraryHistory'
import type { RestoreDeps } from './libraryRestore'
import { backupFolderName } from './seratoLibraryWrite'
import { isVirtualdjHome, type VirtualdjRoot } from './virtualdjLibrary'
import { HISTORY_BACKUPS, LIST_BACKUPS } from './virtualdjLibraryWrite'

type Part = 'tracks' | 'lists'

export interface VirtualdjCopiesDeps {
  backupDir: string
  roots: () => VirtualdjRoot[]
  now?: () => Date
}

interface Manifest {
  reason: CopyReason
  takenAt: number
  dirs: string[]
}

const MANIFEST = 'copy.json'
const SINCE = 'since.json'
const PARTIAL = '.partial'
const WRITING = '.surco-write'
const LISTS = 'MyLists'
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/

const labelOf = (root: VirtualdjRoot): string => (root.root === '/' ? 'Local' : basename(root.root))

const homeOf = (roots: VirtualdjRoot[]) => roots.find(isVirtualdjHome)

export function virtualdjCopyKey(roots: VirtualdjRoot[]): string {
  const root = homeOf(roots) ?? roots[0]
  return root ? join(root.dir, 'database.xml') : ''
}

const historyDir = (deps: VirtualdjCopiesDeps) => join(deps.backupDir, HISTORY_BACKUPS)

const partDir = (deps: VirtualdjCopiesDeps, part: Part): string =>
  part === 'lists' ? join(deps.backupDir, LIST_BACKUPS) : deps.backupDir

function takenAtOf(name: string): number | null {
  const m = name.match(STAMP)
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function readManifest(folder: string): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(join(folder, MANIFEST), 'utf8'))
    return typeof m.reason === 'string' && typeof m.takenAt === 'number' && Array.isArray(m.dirs)
      ? m
      : null
  } catch {
    return null
  }
}

function walk(dir: string): { files: string[]; dirs: string[] } {
  const out = { files: [] as string[], dirs: [] as string[] }
  const visit = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) {
        out.dirs.push(relative(dir, path))
        visit(path)
      } else if (entry.isFile() && !entry.name.endsWith(WRITING))
        out.files.push(relative(dir, path))
    }
  }
  if (existsSync(dir)) visit(dir)
  return out
}

function historyNames(deps: VirtualdjCopiesDeps): string[] {
  return names(historyDir(deps))
    .filter((n) => STAMP.test(n))
    .sort()
}

export function takeVirtualdjCopy(deps: VirtualdjCopiesDeps, reason: CopyReason): LibraryCopy {
  const roots = deps.roots()
  const now = deps.now?.() ?? new Date()
  const history = historyDir(deps)
  mkdirSync(history, { recursive: true })
  if (!existsSync(join(history, SINCE)))
    writeFileSync(join(history, SINCE), JSON.stringify({ since: now.getTime() }))
  const name = backupFolderName(now)
  let folder = join(history, name)
  for (let n = 1; existsSync(folder); n++) folder = join(history, `${name}-${n}`)
  const partial = `${folder}${PARTIAL}`
  rmSync(partial, { recursive: true, force: true })
  const copyIn = (from: string, to: string) => {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  try {
    for (const root of roots) {
      const db = join(root.dir, 'database.xml')
      if (existsSync(db)) copyIn(db, join(partial, labelOf(root), 'database.xml'))
    }
    const home = homeOf(roots)
    const lists = home ? walk(join(home.dir, LISTS)) : { files: [], dirs: [] }
    if (home)
      for (const file of lists.files)
        copyIn(join(home.dir, LISTS, file), join(partial, labelOf(home), LISTS, file))
    mkdirSync(partial, { recursive: true })
    const manifest: Manifest = {
      reason,
      takenAt: now.getTime(),
      dirs: lists.dirs,
    }
    writeFileSync(join(partial, MANIFEST), JSON.stringify(manifest))
    renameSync(partial, folder)
  } catch (e) {
    rmSync(partial, { recursive: true, force: true })
    throw e
  }
  const rotation = historyNames(deps).filter(
    (n) => (readManifest(join(history, n))?.reason === 'restore') === (reason === 'restore'),
  )
  for (const old of rotation.slice(0, -HISTORY_KEEP))
    rmSync(join(history, old), { recursive: true, force: true })
  return {
    id: `${HISTORY_BACKUPS}/${basename(folder)}`,
    collectionPath: virtualdjCopyKey(roots),
    takenAt: now.getTime(),
    reason,
    files: [],
  }
}

function sinceOf(deps: VirtualdjCopiesDeps): number {
  try {
    const since = JSON.parse(readFileSync(join(historyDir(deps), SINCE), 'utf8')).since
    return typeof since === 'number' ? since : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function listVirtualdjCopies(deps: VirtualdjCopiesDeps): {
  copies: LibraryCopy[]
  restore: LibraryCopy | null
} {
  const collectionPath = virtualdjCopyKey(deps.roots())
  const copyOf = (id: string, takenAt: number, reason: CopyReason): LibraryCopy => ({
    id,
    collectionPath,
    takenAt,
    reason,
    files: [],
  })
  const whole = historyNames(deps).flatMap((name) => {
    const m = readManifest(join(historyDir(deps), name))
    return m ? [copyOf(`${HISTORY_BACKUPS}/${name}`, m.takenAt, m.reason)] : []
  })
  const since = sinceOf(deps)
  const legacy = (['tracks', 'lists'] as const).flatMap((part) =>
    names(partDir(deps, part))
      .flatMap((name) => {
        const takenAt = takenAtOf(name)
        return takenAt === null || takenAt >= since
          ? []
          : [copyOf(`${part}/${name}`, takenAt, part)]
      })
      .sort((a, b) => b.takenAt - a.takenAt)
      .slice(0, HISTORY_KEEP),
  )
  const all = [...whole, ...legacy].sort((a, b) => b.takenAt - a.takenAt).slice(0, HISTORY_KEEP)
  const restore = all.find((c) => c.reason === 'restore') ?? null
  return { copies: all.filter((c) => c !== restore), restore }
}

interface Plan {
  writes: { target: string; bytes: Buffer }[]
  removals: string[]
  dirs: string[]
}

function databasesIn(folder: string, roots: VirtualdjRoot[]): Plan['writes'] | null {
  const writes: Plan['writes'] = []
  for (const label of names(folder).filter((n) => n !== MANIFEST)) {
    const source = join(folder, label, 'database.xml')
    if (!existsSync(source)) continue
    const root = roots.find((r) => labelOf(r) === label)
    if (!root) return null
    writes.push({ target: join(root.dir, 'database.xml'), bytes: readFileSync(source) })
  }
  return writes
}

function listsIn(source: string, dirs: string[], lists: string): Plan {
  const wanted = walk(source).files
  return {
    writes: wanted.map((file) => ({
      target: join(lists, file),
      bytes: readFileSync(join(source, file)),
    })),
    removals: walk(lists)
      .files.filter((file) => !wanted.includes(file))
      .map((file) => join(lists, file)),
    dirs: dirs.map((d) => join(lists, d)),
  }
}

function planOf(copyId: string, deps: VirtualdjCopiesDeps): Plan | null {
  const roots = deps.roots()
  const home = homeOf(roots)
  const [kind, name, ...rest] = copyId.split('/')
  if (!name || rest.length > 0 || !STAMP.test(name)) return null
  if (kind === HISTORY_BACKUPS) {
    const folder = join(historyDir(deps), name)
    const manifest = readManifest(folder)
    const databases = manifest && databasesIn(folder, roots)
    if (!manifest || !databases) return null
    if (!home || !existsSync(join(folder, labelOf(home))))
      return { writes: databases, removals: [], dirs: [] }
    const lists = listsIn(join(folder, labelOf(home), LISTS), manifest.dirs, join(home.dir, LISTS))
    return {
      writes: [...databases, ...lists.writes],
      removals: lists.removals,
      dirs: lists.dirs,
    }
  }
  if (kind !== 'tracks' && kind !== 'lists') return null
  const folder = join(partDir(deps, kind), name)
  if (!existsSync(folder)) return null
  if (kind === 'tracks') {
    const writes = databasesIn(folder, roots)
    return writes && writes.length > 0 ? { writes, removals: [], dirs: [] } : null
  }
  const source = home && join(folder, labelOf(home), LISTS)
  if (!home || !source || !existsSync(source)) return null
  return listsIn(source, [], join(home.dir, LISTS))
}

export async function restoreVirtualdjCopy(
  copyId: string,
  deps: VirtualdjCopiesDeps &
    Pick<RestoreDeps, 'ensureClosed' | 'isRunning' | 'discardQueue' | 'busy'>,
): Promise<RestoreResult> {
  const refused = (reason: RestoreRefusal): RestoreResult => ({ ok: false, reason })
  if (!planOf(copyId, deps)) return refused('not-found')
  try {
    if (!(await deps.ensureClosed())) return refused('running')
  } catch {
    return refused('failed')
  }
  if (deps.busy()) return refused('busy')
  let plan: Plan | null
  try {
    plan = planOf(copyId, deps)
  } catch (e) {
    log.warn('VirtualDJ copy could not be read for a restore', e)
    return refused('failed')
  }
  if (!plan) return refused('not-found')
  const writes = plan.writes
  const steps = [
    ...plan.dirs.map((dir) => () => mkdirSync(dir, { recursive: true })),
    ...writes.map(({ target, bytes }) => () => {
      const tmp = `${target}${WRITING}`
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(tmp, bytes)
      renameSync(tmp, target)
    }),
    ...plan.removals.map((target) => () => rmSync(target, { force: true })),
  ]
  let undoKept = false
  let replaced = false
  const stop = (reason: RestoreRefusal): RestoreResult => {
    for (const { target } of writes) rmSync(`${target}${WRITING}`, { force: true })
    if (!replaced) return refused(reason)
    deps.discardQueue()
    return refused('partial')
  }
  for (const step of steps) {
    let running: boolean
    try {
      running = await deps.isRunning()
    } catch {
      return stop('failed')
    }
    if (running) return stop('running')
    try {
      if (!undoKept) takeVirtualdjCopy(deps, 'restore')
      undoKept = true
      step()
      replaced = true
    } catch (e) {
      log.warn('VirtualDJ restore stopped halfway', e)
      return stop('failed')
    }
  }
  deps.discardQueue()
  return { ok: true }
}

export function recoverVirtualdjCopies(deps: VirtualdjCopiesDeps): void {
  const history = historyDir(deps)
  for (const name of names(history).filter((n) => n.endsWith(PARTIAL)))
    rmSync(join(history, name), { recursive: true, force: true })
  const roots = deps.roots()
  for (const root of roots) rmSync(join(root.dir, `database.xml${WRITING}`), { force: true })
  const home = homeOf(roots)
  if (!home) return
  const lists = join(home.dir, LISTS)
  const leftovers: string[] = []
  const visit = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name.endsWith(WRITING)) leftovers.push(path)
    }
  }
  if (existsSync(lists)) visit(lists)
  for (const file of leftovers) rmSync(file, { force: true })
}
