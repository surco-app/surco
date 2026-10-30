import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryCopy } from '../shared/types'
import { setLibraryBackupRoot } from './libraryBackups'
import { copyFolder, listCopies, restoreSlot, takeCopy } from './libraryHistory'
import { enginePendingLog, rekordboxPendingLog, restoreCopy } from './libraryRestore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-restore-'))
  setLibraryBackupRoot(join(dir, 'backups'))
})

function collection(folder: string, name: string, content: string): string {
  const path = join(dir, folder, name)
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(path, content)
  return path
}

function deps(overrides: Partial<Parameters<typeof restoreCopy>[1]> = {}) {
  return {
    ensureClosed: async () => true,
    isRunning: async () => false,
    pendingLog: () => false,
    discardQueue: vi.fn(),
    ...overrides,
  }
}

function leftovers(path: string): string[] {
  return readdirSync(dirname(path)).filter((name) => name.endsWith('.surco-tmp'))
}

describe('restoreCopy', () => {
  it('puts the collection back byte for byte', async () => {
    const path = collection('Traktor', 'collection.nml', 'before\u0000ÿ')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'after')
    expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())).toEqual({
      ok: true,
    })
    expect(readFileSync(path)).toEqual(Buffer.from('before\u0000ÿ'))
    expect(leftovers(path)).toEqual([])
  })

  it('restores master.db and its playlist XML together', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-before')
    const copy = await takeCopy(db, [xml], 'cues', 1)
    writeFileSync(db, 'db-after')
    writeFileSync(xml, 'xml-after')
    expect((await restoreCopy({ collectionPath: db, copyId: copy.id }, deps())).ok).toBe(true)
    expect(readFileSync(db, 'utf8')).toBe('db-before')
    expect(readFileSync(xml, 'utf8')).toBe('xml-before')
  })

  it('keeps a copy of what it overwrote so restoring can be undone', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-before')
    const copy = await takeCopy(db, [xml], 'cues', 1)
    writeFileSync(db, 'db-after')
    writeFileSync(xml, 'xml-after')
    await restoreCopy({ collectionPath: db, copyId: copy.id }, deps())
    const undo = await restoreSlot(db)
    expect(undo?.files.map((f) => f.target)).toEqual([db, xml])
    expect((await restoreCopy({ collectionPath: db, copyId: undo?.id ?? '' }, deps())).ok).toBe(
      true,
    )
    expect(readFileSync(db, 'utf8')).toBe('db-after')
    expect(readFileSync(xml, 'utf8')).toBe('xml-after')
  })

  it('restoring never changes the five history copies', async () => {
    const path = collection('Traktor', 'collection.nml', 'v0')
    for (let now = 1; now <= 5; now++) {
      writeFileSync(path, `v${now}`)
      await takeCopy(path, [], 'run', now)
    }
    const before = (await listCopies(path)).map((c) => c.id)
    const oldest = before[before.length - 1]
    await restoreCopy({ collectionPath: path, copyId: oldest }, deps())
    await restoreCopy({ collectionPath: path, copyId: oldest }, deps())
    await restoreCopy({ collectionPath: path, copyId: before[0] }, deps())
    expect((await listCopies(path)).map((c) => c.id)).toEqual(before)
    expect(readFileSync(path, 'utf8')).toBe('v5')
  })

  it('a restore stopped before any file was replaced keeps the previous undo copy as it was', async () => {
    const path = collection('Traktor', 'collection.nml', 'first')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'second')
    await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())
    const slot = await restoreSlot(path)
    const kept = readFileSync(join(copyFolder(slot as LibraryCopy), 'collection.nml'))
    writeFileSync(path, 'third')
    expect(
      await restoreCopy(
        { collectionPath: path, copyId: copy.id },
        deps({ isRunning: async () => true }),
      ),
    ).toEqual({ ok: false, reason: 'running' })
    expect(await restoreSlot(path)).toEqual(slot)
    expect(readFileSync(join(copyFolder(slot as LibraryCopy), 'collection.nml'))).toEqual(kept)
    expect(readFileSync(path, 'utf8')).toBe('third')
  })

  it('restoring from the undo copy and being stopped keeps that undo copy', async () => {
    const path = collection('Traktor', 'collection.nml', 'first')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'second')
    await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())
    const slot = (await restoreSlot(path)) as LibraryCopy
    writeFileSync(path, 'third')
    expect(
      await restoreCopy(
        { collectionPath: path, copyId: slot.id },
        deps({ isRunning: async () => true }),
      ),
    ).toEqual({ ok: false, reason: 'running' })
    expect(await restoreSlot(path)).toEqual(slot)
    expect(readFileSync(join(copyFolder(slot), 'collection.nml'), 'utf8')).toBe('second')
    expect(await restoreCopy({ collectionPath: path, copyId: slot.id }, deps())).toEqual({
      ok: true,
    })
    expect(readFileSync(path, 'utf8')).toBe('second')
  })

  it('refuses while the program is open and changes nothing', async () => {
    const path = collection('Traktor', 'collection.nml', 'before')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'after')
    const d = deps({ ensureClosed: async () => false })
    expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, d)).toEqual({
      ok: false,
      reason: 'running',
    })
    expect(readFileSync(path, 'utf8')).toBe('after')
    expect(await restoreSlot(path)).toBeNull()
    expect(d.discardQueue).not.toHaveBeenCalled()
  })

  it('stops if the program opens mid-restore and says the restore is half done', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-before')
    const copy = await takeCopy(db, [xml], 'cues', 1)
    writeFileSync(db, 'db-after')
    writeFileSync(xml, 'xml-after')
    const isRunning = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const d = deps({ isRunning })
    expect(await restoreCopy({ collectionPath: db, copyId: copy.id }, d)).toEqual({
      ok: false,
      reason: 'partial',
    })
    expect(readFileSync(db, 'utf8')).toBe('db-before')
    expect(readFileSync(xml, 'utf8')).toBe('xml-after')
    expect(leftovers(db)).toEqual([])
    expect(d.discardQueue).toHaveBeenCalledTimes(1)
  })

  it('keeps the waiting changes when the program opens before any file was replaced', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-before')
    const copy = await takeCopy(db, [xml], 'cues', 1)
    writeFileSync(db, 'db-after')
    writeFileSync(xml, 'xml-after')
    const d = deps({ isRunning: async () => true })
    expect(await restoreCopy({ collectionPath: db, copyId: copy.id }, d)).toEqual({
      ok: false,
      reason: 'running',
    })
    expect(readFileSync(db, 'utf8')).toBe('db-after')
    expect(readFileSync(xml, 'utf8')).toBe('xml-after')
    expect(leftovers(db)).toEqual([])
    expect(d.discardQueue).not.toHaveBeenCalled()
  })

  it('a running check that fails before any file was replaced is a failure, not an open program', async () => {
    const path = collection('Traktor', 'collection.nml', 'before')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'after')
    const d = deps({ isRunning: async () => Promise.reject(new Error('ps')) })
    expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, d)).toEqual({
      ok: false,
      reason: 'failed',
    })
    expect(readFileSync(path, 'utf8')).toBe('after')
    expect(leftovers(path)).toEqual([])
    expect(d.discardQueue).not.toHaveBeenCalled()
  })

  it('a running check that fails after a file was replaced says the restore is half done and leaves no temp files', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    const xml = collection('rekordbox', 'masterPlaylists6.xml', 'xml-before')
    const copy = await takeCopy(db, [xml], 'cues', 1)
    writeFileSync(db, 'db-after')
    writeFileSync(xml, 'xml-after')
    const isRunning = vi.fn().mockResolvedValueOnce(false).mockRejectedValue(new Error('ps'))
    const d = deps({ isRunning })
    expect(await restoreCopy({ collectionPath: db, copyId: copy.id }, d)).toEqual({
      ok: false,
      reason: 'partial',
    })
    expect(readFileSync(xml, 'utf8')).toBe('xml-after')
    expect(leftovers(db)).toEqual([])
    expect(d.discardQueue).toHaveBeenCalledTimes(1)
  })

  it('fails without changing anything when the closed or log checks throw', async () => {
    const path = collection('Traktor', 'collection.nml', 'before')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'after')
    const req = { collectionPath: path, copyId: copy.id }
    const closedThrows = deps({ ensureClosed: async () => Promise.reject(new Error('ps')) })
    const logThrows = deps({
      pendingLog: () => {
        throw new Error('stat')
      },
    })
    expect(await restoreCopy(req, closedThrows)).toEqual({ ok: false, reason: 'failed' })
    expect(await restoreCopy(req, logThrows)).toEqual({ ok: false, reason: 'failed' })
    expect(readFileSync(path, 'utf8')).toBe('after')
    expect(await restoreSlot(path)).toBeNull()
    expect(leftovers(path)).toEqual([])
  })

  it('brings back a collection whose file was deleted', async () => {
    const path = collection('Traktor', 'collection.nml', 'before')
    const copy = await takeCopy(path, [], 'run', 1)
    rmSync(path)
    expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())).toEqual({
      ok: true,
    })
    expect(readFileSync(path, 'utf8')).toBe('before')
    expect(leftovers(path)).toEqual([])
  })

  it('refuses when rekordbox still has an unfolded log', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    const copy = await takeCopy(db, [], 'cues', 1)
    writeFileSync(db, 'db-after')
    writeFileSync(`${db}-wal`, 'frames')
    expect(
      await restoreCopy(
        { collectionPath: db, copyId: copy.id },
        deps({ pendingLog: rekordboxPendingLog }),
      ),
    ).toEqual({ ok: false, reason: 'pending-log' })
    expect(readFileSync(db, 'utf8')).toBe('db-after')
    expect(await restoreSlot(db)).toBeNull()
  })

  it('treats an empty rekordbox log as folded so the restore can go ahead', async () => {
    const db = collection('rekordbox', 'master.db', 'db-before')
    writeFileSync(`${db}-wal`, '')
    expect(rekordboxPendingLog(db)).toBe(false)
    writeFileSync(`${db}-wal`, 'frames')
    expect(rekordboxPendingLog(db)).toBe(true)
  })

  it('sees an Engine wal or journal with data as a log still to fold', async () => {
    const db = collection('Engine Library/Database2', 'm.db', 'db')
    expect(enginePendingLog(db)).toBe(false)
    writeFileSync(`${db}-journal`, 'pages')
    expect(enginePendingLog(db)).toBe(true)
    rmSync(`${db}-journal`)
    writeFileSync(`${db}-wal`, 'frames')
    expect(enginePendingLog(db)).toBe(true)
  })

  it('refuses a copy of another collection', async () => {
    const old = collection('Traktor 4.4', 'collection.nml', 'old')
    const current = collection('Traktor 4.5', 'collection.nml', 'current')
    const copy = await takeCopy(old, [], 'run', 1)
    expect(await restoreCopy({ collectionPath: current, copyId: copy.id }, deps())).toEqual({
      ok: false,
      reason: 'not-found',
    })
    expect(readFileSync(current, 'utf8')).toBe('current')
    expect(readFileSync(old, 'utf8')).toBe('old')
  })

  it('refuses a listed copy whose manifest names another collection', async () => {
    const path = collection('Traktor 4.5', 'collection.nml', 'current')
    const other = collection('Traktor 4.4', 'collection.nml', 'old')
    const copy = await takeCopy(path, [], 'run', 1)
    writeFileSync(path, 'after')
    writeFileSync(
      join(copyFolder(copy), 'copy.json'),
      JSON.stringify({ ...copy, collectionPath: other }),
    )
    expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())).toEqual({
      ok: false,
      reason: 'other-collection',
    })
    expect(readFileSync(path, 'utf8')).toBe('after')
    expect(readFileSync(other, 'utf8')).toBe('old')
    expect(await restoreSlot(path)).toBeNull()
  })

  it('on Windows a copy whose path differs only in letter case is the same collection', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const path = collection('Traktor', 'collection.nml', 'before')
      const copy = await takeCopy(path, [], 'run', 1)
      writeFileSync(path, 'after')
      writeFileSync(
        join(copyFolder(copy), 'copy.json'),
        JSON.stringify({ ...copy, collectionPath: path.toUpperCase() }),
      )
      expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())).toEqual({
        ok: true,
      })
      expect(readFileSync(path, 'utf8')).toBe('before')
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    }
  })

  it('refuses an id that is not among the copies', async () => {
    const path = collection('Traktor', 'collection.nml', 'current')
    await takeCopy(path, [], 'run', 1)
    expect(await restoreCopy({ collectionPath: path, copyId: '999' }, deps())).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it('fails without touching the collection when the undo copy cannot be taken', async () => {
    const path = collection('Traktor', 'collection.nml', 'before')
    const copy = await takeCopy(path, [], 'run', 1)
    rmSync(path)
    mkdirSync(path)
    expect(await restoreCopy({ collectionPath: path, copyId: copy.id }, deps())).toEqual({
      ok: false,
      reason: 'failed',
    })
    expect(readdirSync(path)).toEqual([])
    expect(leftovers(path)).toEqual([])
  })

  it("discards that program's waiting changes so they don't land on the restored copy", async () => {
    const path = collection('Traktor', 'collection.nml', 'before')
    const copy = await takeCopy(path, [], 'run', 1)
    const d = deps()
    await restoreCopy({ collectionPath: path, copyId: copy.id }, d)
    expect(d.discardQueue).toHaveBeenCalledTimes(1)
  })
})
