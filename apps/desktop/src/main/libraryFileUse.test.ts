import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { usedByDjLibrary } from './libraryFileUse'
import { REKORDBOX_KEY } from './rekordboxDb'

const OFF = { rekordbox: '', engine: '', traktor: '' }
let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'surco-file-use-'))
})

async function rekordbox(folderPath: string): Promise<string> {
  const path = join(root, `master-${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`CREATE TABLE djmdContent (
    ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255), FileNameL VARCHAR(255),
    FileType INTEGER, FileSize INTEGER, rb_local_deleted TINYINT(1) DEFAULT 0
  )`)
  db.prepare(
    'INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize) VALUES (?, ?, ?, 1, 10)',
  ).run('1', folderPath, folderPath.slice(folderPath.lastIndexOf('/') + 1))
  db.close()
  return path
}

async function engine(stored: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const SQL = await initSqlJs({
    wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })
  const dir = join(root, `Engine-${Math.random().toString(36).slice(2)}`, 'Engine Library')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  const db = new SQL.Database()
  db.run('CREATE TABLE Track (id INTEGER PRIMARY KEY, path TEXT)')
  db.run('INSERT INTO Track (id, path) VALUES (1, ?)', [stored])
  await writeFile(join(dir, 'Database2', 'm.db'), db.export())
  return dir
}

async function traktor(volume: string, dir: string, file: string): Promise<string> {
  const path = join(root, `collection-${Math.random().toString(36).slice(2)}.nml`)
  await writeFile(
    path,
    `<NML><COLLECTION ENTRIES="1"><ENTRY TITLE="X"><LOCATION DIR="${dir}" FILE="${file}" VOLUME="${volume}"></LOCATION></ENTRY></COLLECTION></NML>`,
  )
  return path
}

describe('usedByDjLibrary', () => {
  it('says no when no library has its sync on', async () => {
    expect(await usedByDjLibrary('/Volumes/M/a.mp3', OFF)).toBe(false)
  })

  it('finds the file in a rekordbox collection', async () => {
    const collection = await rekordbox('/Volumes/M/a.mp3')
    expect(await usedByDjLibrary('/Volumes/M/a.mp3', { ...OFF, rekordbox: collection })).toBe(true)
    expect(await usedByDjLibrary('/Volumes/M/b.mp3', { ...OFF, rekordbox: collection })).toBe(false)
  })

  it('finds the file in an Engine DJ library by its stored relative path', async () => {
    const dir = await engine('../../music/a.mp3')
    const file = join(dir, '..', '..', 'music', 'a.mp3')
    expect(await usedByDjLibrary(file, { ...OFF, engine: dir })).toBe(true)
    expect(await usedByDjLibrary(`${file}.flac`, { ...OFF, engine: dir })).toBe(false)
  })

  it('finds the file in a Traktor collection by its location', async () => {
    const nml = await traktor('M', '/:Music/:', 'a.mp3')
    expect(await usedByDjLibrary('/Volumes/M/Music/a.mp3', { ...OFF, traktor: nml })).toBe(true)
    expect(await usedByDjLibrary('/Volumes/M/Music/a.flac', { ...OFF, traktor: nml })).toBe(false)
  })

  // Traktor names the boot disk ("Macintosh HD") where Surco's location leaves the volume
  // empty; a miss there would trash a file Traktor uses.
  it('finds a boot-disk file whatever volume name Traktor gave it', async () => {
    const nml = await traktor('Macintosh HD', '/:Users/:me/:Music/:', 'a.mp3')
    expect(await usedByDjLibrary('/Users/me/Music/a.mp3', { ...OFF, traktor: nml })).toBe(true)
  })

  // A library that cannot be read may still use the file.
  it('throws when a library with its sync on cannot be read', async () => {
    const junk = join(root, 'junk.db')
    await writeFile(junk, 'not a database')
    await expect(usedByDjLibrary('/a.mp3', { ...OFF, rekordbox: junk })).rejects.toThrow()
    await expect(
      usedByDjLibrary('/a.mp3', { ...OFF, traktor: join(root, 'missing.nml') }),
    ).rejects.toThrow()
    await expect(
      usedByDjLibrary('/a.mp3', { ...OFF, engine: join(root, 'no-engine') }),
    ).rejects.toThrow()
  })
})
