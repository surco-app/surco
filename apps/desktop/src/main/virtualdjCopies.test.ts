import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSessionBackup } from './rekordboxSessionBackup'
import {
  listVirtualdjCopies,
  recoverVirtualdjCopies,
  restoreVirtualdjCopy,
  takeVirtualdjCopy,
  virtualdjCopyKey,
} from './virtualdjCopies'
import { virtualdjLibraryRoots } from './virtualdjLibrary'
import { takeBackups } from './virtualdjLibraryWrite'
import { moveVirtualdjListRows } from './virtualdjListsWrite'
import { repointVirtualdjTracks } from './virtualdjTrackWrite'

const fixture = join(__dirname, 'virtualdjFixtures')
const FROM = '/Music/Serato Pruebas/Pray.mp3'

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) {
        out[`${relative(dir, path)}/`] = ''
        walk(path)
      } else out[relative(dir, path)] = readFileSync(path, 'latin1')
    }
  }
  walk(dir)
  return out
}

function library() {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-copies-'))
  const dir = join(base, 'VirtualDJ')
  cpSync(fixture, dir, { recursive: true })
  mkdirSync(join(base, 'Volumes'))
  const to = join(base, 'Pray.aiff')
  writeFileSync(to, 'aiffdata')
  const roots = () => virtualdjLibraryRoots(dir, join(base, 'Volumes'))
  const backupDir = join(base, 'virtualdj-backups')
  let clock = Date.parse('2026-11-11T10:00:00.000Z')
  const now = () => {
    clock += 60_000
    return new Date(clock)
  }
  const deps = { backupDir, roots, now }
  const session = createSessionBackup({
    take: async (_path, _companions, reason) => takeVirtualdjCopy(deps, reason),
  })
  const restoreDeps = () => ({
    ...deps,
    ensureClosed: vi.fn(async () => true),
    isRunning: vi.fn(async () => false),
    discardQueue: vi.fn(),
    busy: () => false,
  })
  const convert = (sessionBackup?: () => Promise<void>) =>
    repointVirtualdjTracks([{ from: FROM, to }], {
      ...deps,
      virtualdjOpen: async () => false,
      lengthOf: async () => 400,
      ...(sessionBackup ? { sessionBackup } : {}),
    })
  const convertInMoment = () => convert(() => session.ensure(virtualdjCopyKey(roots())))
  const database = () => readFileSync(join(dir, 'database.xml'), 'latin1')
  const lists = () => tree(join(dir, 'MyLists'))
  return {
    base,
    dir,
    roots,
    deps,
    session,
    restoreDeps,
    convert,
    convertInMoment,
    database,
    lists,
  }
}

describe('VirtualDJ copies of a whole moment', () => {
  it('takes one copy for a write that changes the database and the lists, and restoring it puts both back', async () => {
    const lib = library()
    const database = lib.database()
    const lists = lib.lists()
    await lib.convertInMoment()
    expect(lib.database()).not.toBe(database)
    const { copies, restore } = listVirtualdjCopies(lib.deps)
    expect(copies.map((c) => c.reason)).toEqual(['run'])
    expect(copies[0].collectionPath).toBe(join(lib.dir, 'database.xml'))
    expect(restore).toBeNull()
    const deps = lib.restoreDeps()
    expect(await restoreVirtualdjCopy(copies[0].id, deps)).toEqual({ ok: true })
    expect(lib.database()).toBe(database)
    expect(lib.lists()).toEqual(lists)
    expect(deps.ensureClosed).toHaveBeenCalledTimes(1)
    expect(deps.discardQueue).toHaveBeenCalledTimes(1)
  })

  it('keeps every Before restoring in the copies, so a second restore never loses the first undo', async () => {
    const lib = library()
    await lib.convertInMoment()
    const converted = lib.database()
    const convertedLists = lib.lists()
    const [run] = listVirtualdjCopies(lib.deps).copies
    await restoreVirtualdjCopy(run.id, lib.restoreDeps())
    await restoreVirtualdjCopy(run.id, lib.restoreDeps())
    const { copies, restore } = listVirtualdjCopies(lib.deps)
    expect(restore?.reason).toBe('restore')
    expect(copies.map((c) => c.reason)).toEqual(['restore', 'run'])
    expect(await restoreVirtualdjCopy(copies[0].id, lib.restoreDeps())).toEqual({ ok: true })
    expect(lib.database()).toBe(converted)
    expect(lib.lists()).toEqual(convertedLists)
  })

  it('brings back an empty folder as a folder and empties MyLists when the copy had no lists', async () => {
    const lib = library()
    writeFileSync(join(lib.dir, 'MyLists', 'Vacía.vdjfolder'), '<VirtualFolder />\r\n')
    mkdirSync(join(lib.dir, 'MyLists', 'Vacía.subfolders'))
    const before = lib.lists()
    const copy = takeVirtualdjCopy(lib.deps, 'playlists')
    await lib.convert()
    rmSync(join(lib.dir, 'MyLists', 'Vacía.subfolders'), { recursive: true })
    expect(await restoreVirtualdjCopy(copy.id, lib.restoreDeps())).toEqual({ ok: true })
    expect(lib.lists()).toEqual(before)
    rmSync(join(lib.dir, 'MyLists'), { recursive: true })
    mkdirSync(join(lib.dir, 'MyLists'))
    const empty = takeVirtualdjCopy(lib.deps, 'playlists')
    cpSync(join(fixture, 'MyLists'), join(lib.dir, 'MyLists'), { recursive: true })
    expect(await restoreVirtualdjCopy(empty.id, lib.restoreDeps())).toEqual({ ok: true })
    expect(Object.keys(lib.lists()).filter((k) => !k.endsWith('/'))).toEqual([])
  })

  it('takes the moment copy for a write that only changes the lists too', async () => {
    const lib = library()
    const lists = lib.lists()
    expect(
      await moveVirtualdjListRows([{ from: FROM, to: join(lib.base, 'Pray.aiff'), size: 8 }], {
        ...lib.deps,
        virtualdjOpen: async () => false,
        sessionBackup: () => lib.session.ensure(virtualdjCopyKey(lib.roots())),
      }),
    ).toBe('written')
    const [copy] = listVirtualdjCopies(lib.deps).copies
    expect(copy.reason).toBe('run')
    await restoreVirtualdjCopy(copy.id, lib.restoreDeps())
    expect(lib.lists()).toEqual(lists)
  })

  it('keeps the newest five, and twenty more writes never prune them', async () => {
    const lib = library()
    for (let i = 0; i < 7; i++) takeVirtualdjCopy(lib.deps, 'queue')
    const file = join(lib.dir, 'database.xml')
    for (let i = 0; i < 22; i++)
      takeBackups([file], { ...lib.deps, virtualdjOpen: async () => false })
    expect(listVirtualdjCopies(lib.deps).copies).toHaveLength(5)
    expect(
      readdirSync(lib.deps.backupDir).filter((n) => n !== 'lists' && n !== 'history'),
    ).toHaveLength(20)
  })

  it('refuses a write when its moment copy fails, so nothing changes without a copy behind it', async () => {
    const lib = library()
    const database = lib.database()
    expect(
      await lib.convert(async () => {
        throw new Error('disk full')
      }),
    ).toEqual([{ written: false, reason: 'backup-failed' }])
    expect(lib.database()).toBe(database)
  })
})

describe('VirtualDJ copies from before whole copies', () => {
  it('still lists the separate database and lists copies and restores each, saying what it holds', async () => {
    const lib = library()
    const database = lib.database()
    const lists = lib.lists()
    await lib.convert()
    const { copies } = listVirtualdjCopies(lib.deps)
    expect(copies.map((c) => c.reason)).toEqual(['lists', 'tracks'])
    const tracks = copies.find((c) => c.reason === 'tracks')
    expect(await restoreVirtualdjCopy(tracks?.id ?? '', lib.restoreDeps())).toEqual({ ok: true })
    expect(lib.database()).toBe(database)
    const listsCopy = copies.find((c) => c.reason === 'lists')
    expect(await restoreVirtualdjCopy(listsCopy?.id ?? '', lib.restoreDeps())).toEqual({
      ok: true,
    })
    expect(lib.lists()).toEqual(lists)
  })

  it('leaves out the separate copies taken after whole copies began', async () => {
    const lib = library()
    await lib.convert()
    takeVirtualdjCopy(lib.deps, 'run')
    takeBackups([join(lib.dir, 'database.xml')], { ...lib.deps, virtualdjOpen: async () => false })
    expect(listVirtualdjCopies(lib.deps).copies.map((c) => c.reason)).toEqual([
      'run',
      'lists',
      'tracks',
    ])
  })
})

describe('VirtualDJ copies on the screen', () => {
  it('shows five at most, whole copies and older separate ones together, as the footer says for every program', async () => {
    const lib = library()
    await lib.convert()
    await lib.convert()
    const file = join(lib.dir, 'database.xml')
    for (let i = 0; i < 4; i++)
      takeBackups([file], { ...lib.deps, virtualdjOpen: async () => false })
    for (let i = 0; i < 3; i++) takeVirtualdjCopy(lib.deps, 'queue')
    takeVirtualdjCopy(lib.deps, 'restore')
    const { copies, restore } = listVirtualdjCopies(lib.deps)
    expect(copies.length + (restore ? 1 : 0)).toBe(5)
    expect(restore?.reason).toBe('restore')
    expect(copies.map((c) => c.reason)).toEqual(['queue', 'queue', 'queue', 'tracks'])
  })
})

describe('recoverVirtualdjCopies', () => {
  it('clears what a restore or a copy cut short by a crash left, keeping the copies and the library', async () => {
    const lib = library()
    await lib.convertInMoment()
    const database = lib.database()
    const lists = lib.lists()
    const history = join(lib.deps.backupDir, 'history')
    const [copy] = listVirtualdjCopies(lib.deps).copies
    mkdirSync(join(history, '2026-11-11T11-00-00-000Z.partial', 'Local'), { recursive: true })
    writeFileSync(join(lib.dir, 'database.xml.surco-write'), 'half')
    writeFileSync(join(lib.dir, 'MyLists', 'Surco prueba.vdjfolder.surco-write'), 'half')
    recoverVirtualdjCopies(lib.deps)
    expect(readdirSync(history).filter((n) => n.endsWith('.partial'))).toEqual([])
    expect(existsSync(join(lib.dir, 'database.xml.surco-write'))).toBe(false)
    expect(existsSync(join(lib.dir, 'MyLists', 'Surco prueba.vdjfolder.surco-write'))).toBe(false)
    expect(lib.database()).toBe(database)
    expect(lib.lists()).toEqual(lists)
    expect(listVirtualdjCopies(lib.deps).copies).toEqual([copy])
  })
})

describe('restoreVirtualdjCopy refusals', () => {
  it('changes nothing and keeps the queue while VirtualDJ stays open or opens again', async () => {
    const lib = library()
    await lib.convertInMoment()
    const converted = lib.database()
    const [copy] = listVirtualdjCopies(lib.deps).copies
    const closed = { ...lib.restoreDeps(), ensureClosed: vi.fn(async () => false) }
    expect(await restoreVirtualdjCopy(copy.id, closed)).toEqual({ ok: false, reason: 'running' })
    const reopened = { ...lib.restoreDeps(), isRunning: vi.fn(async () => true) }
    expect(await restoreVirtualdjCopy(copy.id, reopened)).toEqual({ ok: false, reason: 'running' })
    expect(lib.database()).toBe(converted)
    expect(closed.discardQueue).not.toHaveBeenCalled()
    expect(reopened.discardQueue).not.toHaveBeenCalled()
    expect(listVirtualdjCopies(lib.deps).restore).toBeNull()
  })

  it('refuses a copy that is not there and one while Surco converts', async () => {
    const lib = library()
    await lib.convertInMoment()
    expect(await restoreVirtualdjCopy('history/nope', lib.restoreDeps())).toEqual({
      ok: false,
      reason: 'not-found',
    })
    const [copy] = listVirtualdjCopies(lib.deps).copies
    expect(await restoreVirtualdjCopy(copy.id, { ...lib.restoreDeps(), busy: () => true })).toEqual(
      { ok: false, reason: 'busy' },
    )
    expect(existsSync(join(lib.deps.backupDir, 'history'))).toBe(true)
  })
})
