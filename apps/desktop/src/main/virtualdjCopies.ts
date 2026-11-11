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
import type { LibraryCopy, RestoreRefusal, RestoreResult } from '../shared/types'
import { HISTORY_KEEP } from './libraryHistory'
import type { RestoreDeps } from './libraryRestore'
import { isVirtualdjHome, type VirtualdjRoot } from './virtualdjLibrary'
import { LIST_BACKUPS, RESTORE_BACKUP } from './virtualdjLibraryWrite'

type Part = 'tracks' | 'lists'

export interface VirtualdjCopiesDeps {
  backupDir: string
  roots: () => VirtualdjRoot[]
  now?: () => Date
}

const MANIFEST = 'copy.json'
const STAGED = '.staged'
const ASIDE = '.aside'
const WRITING = '.surco-write'
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/

const labelOf = (root: VirtualdjRoot): string => (root.root === '/' ? 'Local' : basename(root.root))

const homeOf = (roots: VirtualdjRoot[]) => roots.find(isVirtualdjHome)

const collectionPathOf = (roots: VirtualdjRoot[]): string => {
  const home = homeOf(roots)
  return home ? join(home.dir, 'database.xml') : ''
}

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

function readManifest(folder: string): { part: Part; takenAt: number } | null {
  try {
    const m = JSON.parse(readFileSync(join(folder, MANIFEST), 'utf8'))
    return (m.part === 'tracks' || m.part === 'lists') && typeof m.takenAt === 'number' ? m : null
  } catch {
    return null
  }
}

export function listVirtualdjCopies(deps: VirtualdjCopiesDeps): {
  copies: LibraryCopy[]
  restore: LibraryCopy | null
} {
  const collectionPath = collectionPathOf(deps.roots())
  const copyOf = (id: string, takenAt: number, reason: LibraryCopy['reason']): LibraryCopy => ({
    id,
    collectionPath,
    takenAt,
    reason,
    files: [],
  })
  const copies = (['tracks', 'lists'] as const).flatMap((part) =>
    names(partDir(deps, part))
      .flatMap((name) => {
        const takenAt = takenAtOf(name)
        return takenAt === null ? [] : [copyOf(`${part}/${name}`, takenAt, part)]
      })
      .sort((a, b) => b.takenAt - a.takenAt)
      .slice(0, HISTORY_KEEP),
  )
  const slot = readManifest(join(deps.backupDir, RESTORE_BACKUP))
  return {
    copies: copies.sort((a, b) => b.takenAt - a.takenAt),
    restore: slot ? copyOf(RESTORE_BACKUP, slot.takenAt, 'restore') : null,
  }
}

function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) out.push(relative(dir, path))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

interface Plan {
  writes: { target: string; bytes: Buffer }[]
  removals: string[]
  current: { target: string; label: string }[]
}

function planOf(part: Part, folder: string, roots: VirtualdjRoot[]): Plan | null {
  if (part === 'tracks') {
    const writes: Plan['writes'] = []
    for (const label of names(folder).filter((n) => n !== MANIFEST)) {
      const root = roots.find((r) => labelOf(r) === label)
      const source = join(folder, label, 'database.xml')
      if (!root || !existsSync(source)) return null
      writes.push({ target: join(root.dir, 'database.xml'), bytes: readFileSync(source) })
    }
    if (writes.length === 0) return null
    return {
      writes,
      removals: [],
      current: writes.map((w) => {
        const root = roots.find((r) => join(r.dir, 'database.xml') === w.target) as VirtualdjRoot
        return { target: w.target, label: join(labelOf(root), 'database.xml') }
      }),
    }
  }
  const home = homeOf(roots)
  const source = home && join(folder, labelOf(home), 'MyLists')
  if (!home || !source || !existsSync(source)) return null
  const lists = join(home.dir, 'MyLists')
  const wanted = filesUnder(source)
  const present = filesUnder(lists)
  return {
    writes: wanted.map((file) => ({
      target: join(lists, file),
      bytes: readFileSync(join(source, file)),
    })),
    removals: present.filter((file) => !wanted.includes(file)).map((file) => join(lists, file)),
    current: present.map((file) => ({
      target: join(lists, file),
      label: join(labelOf(home), 'MyLists', file),
    })),
  }
}

function sourceOf(
  copyId: string,
  deps: VirtualdjCopiesDeps,
): { part: Part; folder: string } | null {
  if (copyId === RESTORE_BACKUP) {
    const folder = join(deps.backupDir, RESTORE_BACKUP)
    const slot = readManifest(folder)
    return slot ? { part: slot.part, folder } : null
  }
  const [part, name, ...rest] = copyId.split('/')
  if ((part !== 'tracks' && part !== 'lists') || !name || rest.length > 0 || !STAMP.test(name))
    return null
  const folder = join(partDir(deps, part), name)
  return existsSync(folder) ? { part, folder } : null
}

function stageSlot(part: Part, plan: Plan, deps: VirtualdjCopiesDeps): string {
  const staged = join(deps.backupDir, `${RESTORE_BACKUP}${STAGED}`)
  rmSync(staged, { recursive: true, force: true })
  for (const { target, label } of plan.current) {
    const copy = join(staged, label)
    mkdirSync(dirname(copy), { recursive: true })
    copyFileSync(target, copy)
  }
  mkdirSync(staged, { recursive: true })
  const takenAt = (deps.now?.() ?? new Date()).getTime()
  writeFileSync(join(staged, MANIFEST), JSON.stringify({ part, takenAt }))
  return staged
}

function keepSlot(staged: string, deps: VirtualdjCopiesDeps): void {
  const slot = join(deps.backupDir, RESTORE_BACKUP)
  const aside = `${slot}${ASIDE}`
  rmSync(aside, { recursive: true, force: true })
  if (existsSync(slot)) renameSync(slot, aside)
  renameSync(staged, slot)
  rmSync(aside, { recursive: true, force: true })
}

export async function restoreVirtualdjCopy(
  copyId: string,
  deps: VirtualdjCopiesDeps &
    Pick<RestoreDeps, 'ensureClosed' | 'isRunning' | 'discardQueue' | 'busy'>,
): Promise<RestoreResult> {
  const refused = (reason: RestoreRefusal): RestoreResult => ({ ok: false, reason })
  if (!sourceOf(copyId, deps)) return refused('not-found')
  try {
    if (!(await deps.ensureClosed())) return refused('running')
  } catch {
    return refused('failed')
  }
  if (deps.busy()) return refused('busy')
  const source = sourceOf(copyId, deps)
  if (!source) return refused('not-found')
  let plan: Plan | null
  let staged: string
  try {
    plan = planOf(source.part, source.folder, deps.roots())
    if (!plan) return refused('not-found')
    staged = stageSlot(source.part, plan, deps)
  } catch (e) {
    log.warn('VirtualDJ copy could not be prepared for a restore', e)
    return refused('failed')
  }
  const steps = [
    ...plan.writes.map(({ target, bytes }) => () => {
      const tmp = `${target}${WRITING}`
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(tmp, bytes)
      renameSync(tmp, target)
    }),
    ...plan.removals.map((target) => () => rmSync(target, { force: true })),
  ]
  let slotKept = false
  let replaced = false
  const stop = (reason: RestoreRefusal): RestoreResult => {
    for (const { target } of plan.writes) rmSync(`${target}${WRITING}`, { force: true })
    if (!slotKept) rmSync(staged, { recursive: true, force: true })
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
      if (!slotKept) keepSlot(staged, deps)
      slotKept = true
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
