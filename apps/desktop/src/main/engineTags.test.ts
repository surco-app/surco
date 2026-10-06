import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { isEngineDjRunning } from './engineProcess'
import { updateEngineTags } from './engineTags'
import { renameWithRetry } from './renameRetry'

vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('./renameRetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./renameRetry')>()
  return { ...actual, renameWithRetry: vi.fn(actual.renameWithRetry) }
})

let SQL: SqlJsStatic
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  SQL = await initSqlJs({
    wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })
})
beforeEach(() => vi.mocked(isEngineDjRunning).mockResolvedValue(false))

interface Library {
  dir: string
  dbPath: string
  music: string
  file: string
}

async function library(
  rows: string[] = ['../music/c.mp3'],
  storedArtist = 'Dj Lara',
): Promise<Library> {
  const root = await mkdtemp(join(tmpdir(), 'surco-engine-tags-'))
  const dir = join(root, 'Engine Library')
  const music = join(root, 'music')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  await mkdir(music)
  await writeFile(join(music, 'c.mp3'), Buffer.alloc(100))
  const db = new SQL.Database()
  db.exec(ENGINE_3_SCHEMA)
  for (const path of rows) {
    db.run(
      "INSERT INTO Track (path, filename, fileType, fileBytes, bitrate, title, artist, album, genre) VALUES (?, 'c.mp3', 'mp3', 100, 320, 'Old Title', ?, 'X', 'electronic')",
      [path, storedArtist],
    )
  }
  const dbPath = join(dir, 'Database2', 'm.db')
  await writeFile(dbPath, db.export())
  db.close()
  return { dir, dbPath, music, file: join(music, 'c.mp3') }
}

async function track(path: string, id = 1): Promise<Record<string, unknown>> {
  const db: Database = new SQL.Database(await readFile(path))
  const stmt = db.prepare('SELECT * FROM Track WHERE id = ?', [id])
  stmt.step()
  const row = stmt.getAsObject()
  stmt.free()
  db.close()
  return row
}

const artist = (path: string, from = 'Dj Lara', to = 'DJ Lara') => ({
  path,
  fields: { artist: { from, to } },
})

describe('updateEngineTags', () => {
  it('rewrites the artist of the row that names this file and nothing else', async () => {
    const lib = await library()
    const before = await track(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file)])
    expect(result).toEqual({ written: true })
    // Engine's own trigger stamps lastEditTime on any update.
    expect(await track(lib.dbPath)).toEqual({
      ...before,
      artist: 'DJ Lara',
      lastEditTime: expect.any(Number),
    })
  })

  it('rewrites every field the review changed in one row', async () => {
    const lib = await library()
    const [result] = await updateEngineTags(lib.dir, [
      {
        path: lib.file,
        fields: {
          title: { from: 'Old Title', to: 'New Title' },
          album: { from: 'X', to: 'Y' },
          genre: { from: 'electronic', to: 'Electronic' },
        },
      },
    ])
    expect(result).toEqual({ written: true })
    expect(await track(lib.dbPath)).toMatchObject({
      title: 'New Title',
      artist: 'Dj Lara',
      album: 'Y',
      genre: 'Electronic',
    })
  })

  // The user may have fixed the name in Engine already; the review must not undo it.
  it('leaves a row whose artist Engine already spells otherwise', async () => {
    const lib = await library()
    const bytes = await readFile(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file, 'DJ LARA')])
    expect(result).toEqual({ written: false, reason: 'changed' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
  })

  it('compares names regardless of Unicode normalization', async () => {
    const lib = await library(['../music/c.mp3'], 'José'.normalize('NFC'))
    const [result] = await updateEngineTags(lib.dir, [
      artist(lib.file, 'José'.normalize('NFD'), 'Jose'),
    ])
    expect(result).toEqual({ written: true })
  })

  it('writes nothing for an album artist, which Engine does not store', async () => {
    const lib = await library()
    const before = await stat(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [
      { path: lib.file, fields: { albumArtist: { from: 'a', to: 'b' } } },
    ])
    expect(result).toEqual({ written: false, reason: 'no-match' })
    expect((await stat(lib.dbPath)).mtimeMs).toBe(before.mtimeMs)
  })

  it('leaves the library untouched for a file it never had', async () => {
    const lib = await library()
    const before = await stat(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(join(lib.music, 'other.mp3'))])
    expect(result).toEqual({ written: false, reason: 'no-match' })
    expect((await stat(lib.dbPath)).mtimeMs).toBe(before.mtimeMs)
  })

  it('refuses to choose between two rows for the same file', async () => {
    const lib = await library(['../music/c.mp3', '../link/c.mp3'])
    await symlink(lib.music, join(lib.dir, '..', 'link'))
    const [result] = await updateEngineTags(lib.dir, [
      { ...artist(lib.file), realPath: realpathSync },
    ])
    expect(result).toEqual({ written: false, reason: 'ambiguous' })
  })

  it('finds a row stored through a symlinked folder', async () => {
    const lib = await library(['../link/c.mp3'])
    await symlink(lib.music, join(lib.dir, '..', 'link'))
    const [result] = await updateEngineTags(lib.dir, [
      { ...artist(lib.file), realPath: realpathSync },
    ])
    expect(result).toEqual({ written: true })
  })

  // Engine keeps the library in memory and writes it back on exit, so a write made while it
  // runs would be lost.
  it('refuses while Engine DJ is open', async () => {
    const lib = await library()
    vi.mocked(isEngineDjRunning).mockResolvedValue(true)
    const bytes = await readFile(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file)])
    expect(result).toEqual({ written: false, reason: 'engine-running' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
  })

  // Engine may launch while the rows are being read; it would write its old copy back over
  // ours on quit, so the check repeats right before the swap.
  it('refuses when Engine DJ opens after the rows were read', async () => {
    const lib = await library()
    vi.mocked(isEngineDjRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const bytes = await readFile(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file)])
    expect(result).toEqual({ written: false, reason: 'engine-running' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
    expect(await readdir(join(lib.dir, 'Database2'))).not.toContain('m.db.surco-tmp')
  })

  it('reports a failed swap, keeps the library and leaves no temporary file', async () => {
    const lib = await library()
    vi.mocked(renameWithRetry).mockRejectedValueOnce(new Error('EPERM'))
    const bytes = await readFile(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file)])
    expect(result).toEqual({ written: false, reason: 'write-failed' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
    expect(await readdir(join(lib.dir, 'Database2'))).not.toContain('m.db.surco-tmp')
  })

  it('keeps the library as it was in a backup, and takes the session copy first', async () => {
    const lib = await library()
    const bytes = await readFile(lib.dbPath)
    const sessionBackup = vi.fn(async () => {})
    await updateEngineTags(lib.dir, [artist(lib.file)], { sessionBackup })
    expect(sessionBackup).toHaveBeenCalledWith(lib.dbPath)
    expect(await readFile(`${lib.dbPath}.surco-backup`)).toEqual(bytes)
  })

  it('writes nothing when the session backup fails', async () => {
    const lib = await library()
    const bytes = await readFile(lib.dbPath)
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file)], {
      sessionBackup: async () => {
        throw new Error('disk full')
      },
    })
    expect(result).toEqual({ written: false, reason: 'backup-failed' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
  })

  it('reports an unreadable database without throwing', async () => {
    const lib = await library()
    await writeFile(lib.dbPath, 'not a database')
    const [result] = await updateEngineTags(lib.dir, [artist(lib.file)])
    expect(result).toEqual({ written: false, reason: 'unreadable' })
  })
})
