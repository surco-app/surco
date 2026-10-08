import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { libraryCopyInfo, usedByDjLibrary } from './libraryFileUse'
import * as rekordboxDb from './rekordboxDb'
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

describe('libraryCopyInfo', () => {
  async function richRekordbox(): Promise<string> {
    const path = join(root, `rich-${Math.random().toString(36).slice(2)}.db`)
    const db = new Database(path)
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${REKORDBOX_KEY}'`)
    db.exec(`CREATE TABLE djmdContent (
      ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255), FileNameL VARCHAR(255),
      FileType INTEGER, FileSize INTEGER, rb_local_deleted TINYINT(1) DEFAULT 0
    )`)
    db.exec(
      `CREATE TABLE djmdCue (ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), rb_local_deleted TINYINT(1))`,
    )
    db.exec(
      `CREATE TABLE djmdSongPlaylist (ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255), ContentID VARCHAR(255), rb_local_deleted TINYINT(1))`,
    )
    db.prepare(
      `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize) VALUES ('1', '/m/a.aiff', 'a.aiff', 12, 10)`,
    ).run()
    const cue = db.prepare(`INSERT INTO djmdCue VALUES (?, '1', ?)`)
    cue.run('c1', 0)
    cue.run('c2', null)
    cue.run('c3', 1)
    const entry = db.prepare(`INSERT INTO djmdSongPlaylist VALUES (?, ?, '1', ?)`)
    entry.run('e1', 'p1', 0)
    entry.run('e2', 'p1', 0)
    entry.run('e3', 'p2', 0)
    entry.run('e4', 'p3', 1)
    db.close()
    return path
  }

  it('counts the live cues and playlists of each copy rekordbox has', async () => {
    const collection = await richRekordbox()
    expect(
      await libraryCopyInfo(['/m/a.aiff', '/m/b.aiff'], { ...OFF, rekordbox: collection }),
    ).toEqual({
      '/m/a.aiff': { rekordbox: { cues: 2, playlists: 2 } },
      '/m/b.aiff': { rekordbox: null },
    })
  })

  it('counts the lists of each copy an Engine DJ library has', async () => {
    const dir = await engine('../../music/a.mp3')
    const require = createRequire(import.meta.url)
    const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
    const SQL = await initSqlJs({
      wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    })
    const dbPath = join(dir, 'Database2', 'm.db')
    const db = new SQL.Database(await readFile(dbPath))
    db.run('CREATE TABLE Information (uuid TEXT)')
    db.run("INSERT INTO Information VALUES ('mine')")
    db.run(
      'CREATE TABLE PlaylistEntity (id INTEGER PRIMARY KEY, listId INTEGER, trackId INTEGER, databaseUuid TEXT)',
    )
    db.run(
      "INSERT INTO PlaylistEntity VALUES (1, 7, 1, 'mine'), (2, 8, 1, 'mine'), (3, 8, 2, 'mine'), (4, 9, 1, 'other')",
    )
    await writeFile(dbPath, db.export())
    const file = join(dir, '..', '..', 'music', 'a.mp3')
    expect(await libraryCopyInfo([file, `${file}.flac`], { ...OFF, engine: dir })).toEqual({
      [file]: { engine: { playlists: 2 } },
      [`${file}.flac`]: { engine: null },
    })
  })

  it('counts the cues, without the beatgrid, and the playlists of each copy Traktor has', async () => {
    const path = join(root, `info-${Math.random().toString(36).slice(2)}.nml`)
    await writeFile(
      path,
      `<NML><COLLECTION ENTRIES="1"><ENTRY TITLE="X"><LOCATION DIR="/:Music/:" FILE="a.mp3" VOLUME="M"></LOCATION>` +
        `<CUE_V2 NAME="AutoGrid" TYPE="4" START="0"></CUE_V2><CUE_V2 NAME="Drop" TYPE="0" START="9"></CUE_V2><CUE_V2 NAME="L" TYPE="5" START="20"></CUE_V2></ENTRY></COLLECTION>` +
        `<PLAYLISTS><PLAYLIST ENTRIES="1" UUID="a"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="M/:Music/:a.mp3"></PRIMARYKEY></ENTRY></PLAYLIST>` +
        `<PLAYLIST ENTRIES="1" UUID="b"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="M/:Music/:z.mp3"></PRIMARYKEY></ENTRY></PLAYLIST></PLAYLISTS></NML>`,
    )
    expect(
      await libraryCopyInfo(['/Volumes/M/Music/a.mp3', '/Volumes/M/Music/b.mp3'], {
        ...OFF,
        traktor: path,
      }),
    ).toEqual({
      '/Volumes/M/Music/a.mp3': { traktor: { cues: 2, playlists: 1 } },
      '/Volumes/M/Music/b.mp3': { traktor: null },
    })
  })

  // The detail only shows what it could read; a locked library just stays out of it.
  it('leaves out a library it cannot read and keeps the others', async () => {
    const collection = await richRekordbox()
    expect(
      await libraryCopyInfo(['/m/a.aiff'], {
        ...OFF,
        rekordbox: collection,
        traktor: join(root, 'missing.nml'),
        engine: join(root, 'no-engine'),
      }),
    ).toEqual({ '/m/a.aiff': { rekordbox: { cues: 2, playlists: 2 } } })
  })

  // rekordbox may be running while the detail is open; a reader must never write.
  it('opens rekordbox read-only', async () => {
    const collection = await richRekordbox()
    const open = vi.spyOn(rekordboxDb, 'openRekordboxDb')
    await libraryCopyInfo(['/m/a.aiff'], { ...OFF, rekordbox: collection })
    expect(open).toHaveBeenCalledWith(collection, { readonly: true })
    expect(open.mock.results[0].value?.readonly).toBe(true)
    open.mockRestore()
  })
})
