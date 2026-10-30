import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { setLibraryBackupRoot } from './libraryBackups'
import {
  copyFolder,
  listCopies,
  recoverRestoreSlot,
  restoreSlot,
  stageRestoreCopy,
  takeCopy,
} from './libraryHistory'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-history-'))
  setLibraryBackupRoot(join(dir, 'backups'))
})

function collection(folder: string, name: string, content = 'data'): string {
  const path = join(dir, folder, name)
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(path, content)
  return path
}

describe('libraryHistory', () => {
  it('keeps the five newest copies so a DJ can still go back days later', async () => {
    const path = collection('Traktor', 'collection.nml')
    for (let now = 1; now <= 6; now++) await takeCopy(path, [], 'run', now)
    expect((await listCopies(path)).map((c) => c.id)).toEqual(['6', '5', '4', '3', '2'])
  })

  it("copies companions into the same entry so rekordbox's playlists come back with master.db", async () => {
    const db = collection('rekordbox', 'master.db', 'db-bytes')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-bytes')
    const copy = await takeCopy(db, [xml, join(dir, 'rekordbox', 'missing.db-wal')], 'cues', 10)
    expect(copy.files.map((f) => f.name)).toEqual(['master.db', 'masterPlaylists6.xml'])
    expect(copy.files.map((f) => f.target)).toEqual([db, xml])
    const folder = copyFolder(copy)
    expect(readFileSync(join(folder, 'master.db'), 'utf8')).toBe('db-bytes')
    expect(readFileSync(join(folder, 'masterPlaylists6.xml'), 'utf8')).toBe('xml-bytes')
  })

  it('a restore copy never pushes out history', async () => {
    const path = collection('Traktor', 'collection.nml')
    for (let now = 1; now <= 5; now++) await takeCopy(path, [], 'run', now)
    for (let now = 100; now <= 102; now++) await takeCopy(path, [], 'restore', now)
    expect(await listCopies(path)).toHaveLength(5)
    expect((await restoreSlot(path))?.takenAt).toBe(102)
  })

  it('a copy that fails halfway is never listed and prunes nothing', async () => {
    const path = collection('Traktor', 'collection.nml')
    for (let now = 1; now <= 5; now++) await takeCopy(path, [], 'run', now)
    const before = (await listCopies(path)).map((c) => c.id)
    await expect(takeCopy(join(dir, 'Traktor', 'gone.nml'), [], 'run', 6)).rejects.toThrow()
    await expect(takeCopy(path, [join(dir, 'Traktor')], 'run', 7)).rejects.toThrow()
    expect((await listCopies(path)).map((c) => c.id)).toEqual(before)
    const partials = readdirSync(join(copyFolder((await listCopies(path))[0]), '..')).filter((n) =>
      n.endsWith('.partial'),
    )
    expect(partials).toEqual([])
  })

  it('two collections never share history', async () => {
    const a = collection('Traktor 3', 'collection.nml')
    const b = collection('Traktor 4', 'collection.nml')
    await takeCopy(a, [], 'run', 1)
    await takeCopy(b, [], 'run', 2)
    expect((await listCopies(a)).map((c) => c.id)).toEqual(['1'])
    expect((await listCopies(b)).map((c) => c.id)).toEqual(['2'])
  })

  it('a staged undo copy leaves the previous one in place until it is committed', async () => {
    const path = collection('Traktor', 'collection.nml', 'older state')
    const previous = await takeCopy(path, [], 'restore', 1)
    writeFileSync(path, 'newer state')
    const dropped = await stageRestoreCopy(path, [], 2)
    expect(await restoreSlot(path)).toEqual(previous)
    await dropped.discard()
    expect(await restoreSlot(path)).toEqual(previous)
    expect(readFileSync(join(copyFolder(previous), 'collection.nml'), 'utf8')).toBe('older state')
    const kept = await stageRestoreCopy(path, [], 3)
    await kept.commit()
    expect((await restoreSlot(path))?.takenAt).toBe(3)
    expect(readFileSync(join(copyFolder(previous), 'collection.nml'), 'utf8')).toBe('newer state')
    expect(readdirSync(join(copyFolder(previous), '..')).sort()).toEqual(['history-restore'])
  })

  it('an undo copy left staged by a crash after the library was replaced becomes the undo copy instead of being deleted', async () => {
    const path = collection('Traktor', 'collection.nml', 'first')
    await takeCopy(path, [], 'restore', 1)
    writeFileSync(path, 'second')
    await stageRestoreCopy(path, [], 2)
    writeFileSync(path, 'restored')
    const next = await stageRestoreCopy(path, [], 3)
    const slot = await restoreSlot(path)
    expect(slot?.takenAt).toBe(2)
    expect(readFileSync(join(copyFolder(slot as never), 'collection.nml'), 'utf8')).toBe('second')
    await next.discard()
    expect((await restoreSlot(path))?.takenAt).toBe(2)
  })

  it('an undo copy left staged before anything was replaced is dropped and the previous one kept', async () => {
    const path = collection('Traktor', 'collection.nml', 'first')
    const previous = await takeCopy(path, [], 'restore', 1)
    writeFileSync(path, 'second')
    await stageRestoreCopy(path, [], 2)
    await recoverRestoreSlot(path)
    expect(await restoreSlot(path)).toEqual(previous)
    expect(readdirSync(join(copyFolder(previous), '..')).sort()).toEqual(['history-restore'])
  })

  it('an undo copy left aside by a swap whose rollback failed is put back', async () => {
    const path = collection('Traktor', 'collection.nml', 'first')
    const previous = await takeCopy(path, [], 'restore', 1)
    renameSync(copyFolder(previous), `${copyFolder(previous)}.aside`)
    expect(await restoreSlot(path)).toBeNull()
    await stageRestoreCopy(path, [], 2)
    expect(await restoreSlot(path)).toEqual(previous)
    expect(readFileSync(join(copyFolder(previous), 'collection.nml'), 'utf8')).toBe('first')
  })
})
