import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listVirtualdjCopies, restoreVirtualdjCopy } from './virtualdjCopies'
import { virtualdjLibraryRoots } from './virtualdjLibrary'
import { takeBackups } from './virtualdjLibraryWrite'
import { repointVirtualdjTracks } from './virtualdjTrackWrite'

const fixture = join(__dirname, 'virtualdjFixtures')
const FROM = '/Music/Serato Pruebas/Pray.mp3'

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(dir, path)] = readFileSync(path, 'latin1')
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
  const restoreDeps = () => ({
    ...deps,
    ensureClosed: vi.fn(async () => true),
    isRunning: vi.fn(async () => false),
    discardQueue: vi.fn(),
    busy: () => false,
  })
  const convert = () =>
    repointVirtualdjTracks([{ from: FROM, to }], {
      ...deps,
      virtualdjOpen: async () => false,
      lengthOf: async () => 400,
    })
  const database = () => readFileSync(join(dir, 'database.xml'), 'latin1')
  const lists = () => tree(join(dir, 'MyLists'))
  return { base, dir, roots, deps, restoreDeps, convert, database, lists }
}

describe('listVirtualdjCopies', () => {
  it('lists the database and the lists copies VirtualDJ writes took, newest first, each saying what it holds', async () => {
    const lib = library()
    await lib.convert()
    const { copies, restore } = listVirtualdjCopies(lib.deps)
    expect(copies.map((c) => [c.reason, new Date(c.takenAt).toISOString()])).toEqual([
      ['lists', '2026-11-11T10:02:00.000Z'],
      ['tracks', '2026-11-11T10:01:00.000Z'],
    ])
    expect(copies.every((c) => c.collectionPath === join(lib.dir, 'database.xml'))).toBe(true)
    expect(restore).toBeNull()
  })

  it('shows the newest five of each, as the screen keeps for every program', async () => {
    const lib = library()
    const file = join(lib.dir, 'database.xml')
    for (let i = 0; i < 7; i++)
      takeBackups([file], { ...lib.deps, virtualdjOpen: async () => false })
    expect(listVirtualdjCopies(lib.deps).copies.map((c) => c.id)).toEqual([
      'tracks/2026-11-11T10-07-00-000Z',
      'tracks/2026-11-11T10-06-00-000Z',
      'tracks/2026-11-11T10-05-00-000Z',
      'tracks/2026-11-11T10-04-00-000Z',
      'tracks/2026-11-11T10-03-00-000Z',
    ])
  })
})

describe('restoreVirtualdjCopy', () => {
  it('puts database.xml back byte for byte once VirtualDJ is closed, keeps how it was in Before restoring, and drops only the VirtualDJ queue', async () => {
    const lib = library()
    const original = lib.database()
    await lib.convert()
    const converted = lib.database()
    const copy = listVirtualdjCopies(lib.deps).copies.find((c) => c.reason === 'tracks')
    const deps = lib.restoreDeps()
    expect(await restoreVirtualdjCopy(copy?.id ?? '', deps)).toEqual({ ok: true })
    expect(lib.database()).toBe(original)
    expect(deps.ensureClosed).toHaveBeenCalledTimes(1)
    expect(deps.discardQueue).toHaveBeenCalledTimes(1)
    const { restore } = listVirtualdjCopies(lib.deps)
    expect(restore?.reason).toBe('restore')
    expect(await restoreVirtualdjCopy(restore?.id ?? '', lib.restoreDeps())).toEqual({ ok: true })
    expect(lib.database()).toBe(converted)
  })

  it('puts MyLists back file for file, taking out a list made after the copy', async () => {
    const lib = library()
    const before = lib.lists()
    await lib.convert()
    writeFileSync(join(lib.dir, 'MyLists', 'Nueva.vdjfolder'), '<VirtualFolder />\r\n')
    const copy = listVirtualdjCopies(lib.deps).copies.find((c) => c.reason === 'lists')
    expect(await restoreVirtualdjCopy(copy?.id ?? '', lib.restoreDeps())).toEqual({ ok: true })
    expect(lib.lists()).toEqual(before)
  })

  it('changes nothing and keeps the queue while VirtualDJ stays open', async () => {
    const lib = library()
    await lib.convert()
    const converted = lib.database()
    const copy = listVirtualdjCopies(lib.deps).copies.find((c) => c.reason === 'tracks')
    const deps = { ...lib.restoreDeps(), ensureClosed: vi.fn(async () => false) }
    expect(await restoreVirtualdjCopy(copy?.id ?? '', deps)).toEqual({
      ok: false,
      reason: 'running',
    })
    expect(lib.database()).toBe(converted)
    expect(deps.discardQueue).not.toHaveBeenCalled()
    expect(listVirtualdjCopies(lib.deps).restore).toBeNull()
  })

  it('stops before writing when VirtualDJ opens after the DJ closed it, and Before restoring stays as it was', async () => {
    const lib = library()
    await lib.convert()
    const converted = lib.database()
    const copy = listVirtualdjCopies(lib.deps).copies.find((c) => c.reason === 'tracks')
    const deps = { ...lib.restoreDeps(), isRunning: vi.fn(async () => true) }
    expect(await restoreVirtualdjCopy(copy?.id ?? '', deps)).toEqual({
      ok: false,
      reason: 'running',
    })
    expect(lib.database()).toBe(converted)
    expect(listVirtualdjCopies(lib.deps).restore).toBeNull()
    expect(deps.discardQueue).not.toHaveBeenCalled()
  })

  it('refuses a copy that is not there and one while Surco converts', async () => {
    const lib = library()
    await lib.convert()
    expect(await restoreVirtualdjCopy('tracks/nope', lib.restoreDeps())).toEqual({
      ok: false,
      reason: 'not-found',
    })
    const copy = listVirtualdjCopies(lib.deps).copies[0]
    expect(await restoreVirtualdjCopy(copy.id, { ...lib.restoreDeps(), busy: () => true })).toEqual(
      { ok: false, reason: 'busy' },
    )
  })

  it('keeps Before restoring when twenty more writes prune the old copies', async () => {
    const lib = library()
    await lib.convert()
    const copy = listVirtualdjCopies(lib.deps).copies.find((c) => c.reason === 'tracks')
    await restoreVirtualdjCopy(copy?.id ?? '', lib.restoreDeps())
    const file = join(lib.dir, 'database.xml')
    for (let i = 0; i < 22; i++)
      takeBackups([file], { ...lib.deps, virtualdjOpen: async () => false })
    expect(listVirtualdjCopies(lib.deps).restore?.reason).toBe('restore')
    expect(existsSync(join(lib.deps.backupDir, 'restore'))).toBe(true)
    expect(
      readdirSync(lib.deps.backupDir).filter((n) => n !== 'lists' && n !== 'restore'),
    ).toHaveLength(20)
  })
})
