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
    const gone = copyFolder({
      id: '6',
      collectionPath: join(dir, 'Traktor', 'gone.nml'),
      takenAt: 6,
      reason: 'run',
      files: [],
    })
    for (const root of [join(copyFolder((await listCopies(path))[0]), '..'), join(gone, '..')]) {
      expect(readdirSync(root).filter((n) => n.endsWith('.partial'))).toEqual([])
    }
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

  it('sweeps the half-written copies a crash left behind when the next copy is taken', async () => {
    const path = collection('Traktor', 'collection.nml')
    const first = await takeCopy(path, [], 'run', 1)
    const stale = `${copyFolder({ ...first, id: '0' })}.partial`
    mkdirSync(stale)
    writeFileSync(join(stale, 'collection.nml'), 'half')
    await takeCopy(path, [], 'run', 2)
    expect(readdirSync(join(stale, '..')).sort()).toEqual(['1', '2'])
  })

  it('skips a copy whose manifest is not one Surco wrote, so restore never reads a wrong file list', async () => {
    const path = collection('Traktor', 'collection.nml')
    const good = await takeCopy(path, [], 'run', 1)
    const bad = (id: string, manifest: unknown) => {
      const folder = copyFolder({ ...good, id })
      mkdirSync(folder)
      writeFileSync(join(folder, 'copy.json'), JSON.stringify(manifest))
    }
    bad('2', { ...good, id: '2', takenAt: 'yesterday' })
    bad('3', { ...good, id: '3', files: [{ name: 'collection.nml' }] })
    bad('4', { ...good, id: '4', files: [{ name: '../../escape.nml', target: path }] })
    bad('5', { ...good, id: 5 })
    bad('6', null)
    expect((await listCopies(path)).map((c) => c.id)).toEqual(['1'])
  })

  it('an undo copy keeps the main file and its companions even when the main file is missing', async () => {
    const db = join(dir, 'rekordbox', 'master.db')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-now')
    const staged = await stageRestoreCopy(db, [xml], 2)
    await staged.commit()
    const slot = await restoreSlot(db)
    expect(slot?.collectionPath).toBe(db)
    expect(slot?.files.map((f) => f.target)).toEqual([xml])
    expect(slot?.absent).toEqual([db])
    expect(readFileSync(join(copyFolder(slot as never), 'masterPlaylists6.xml'), 'utf8')).toBe(
      'xml-now',
    )
  })

  it('an undo copy left staged after a restore created the missing main file is promoted, so undo can remove it', async () => {
    const db = join(dir, 'rekordbox', 'master.db')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-now')
    await stageRestoreCopy(db, [xml], 2)
    writeFileSync(db, 'restored')
    await recoverRestoreSlot(db)
    expect((await restoreSlot(db))?.absent).toEqual([db])
  })
})
