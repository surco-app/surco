import { access, chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as rekordboxDb from './rekordboxDb'
import { openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'
import { replaceRekordboxDuplicates } from './rekordboxDuplicates'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { isRekordboxRunning } from './rekordboxProcess'

const OLD = '2024-01-01 00:00:00.000 +00:00'

let dir: string
let dbPath: string
let FROM: string
let TO: string

function open(path: string): Database.Database {
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  return db
}

async function makeDb(withTo = true): Promise<string> {
  const path = join(dir, 'master.db')
  const db = open(path)
  db.exec(`CREATE TABLE djmdContent (
    ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255), FileNameL VARCHAR(255),
    FileType INTEGER, FileSize INTEGER, rb_local_deleted TINYINT(1) DEFAULT 0,
    rb_local_usn BIGINT, updated_at DATETIME
  )`)
  db.exec(`CREATE TABLE djmdSongPlaylist (
    ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255), ContentID VARCHAR(255),
    TrackNo INTEGER, UUID VARCHAR(255), rb_local_deleted TINYINT(1) DEFAULT 0,
    rb_local_usn BIGINT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
  )`)
  db.exec(`CREATE TABLE djmdCue (
    ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), InMsec INTEGER,
    rb_local_deleted TINYINT(1) DEFAULT 0, rb_local_usn BIGINT, updated_at DATETIME
  )`)
  db.exec(
    `CREATE TABLE agentRegistry (registry_id VARCHAR(255) PRIMARY KEY, int_1 BIGINT, updated_at DATETIME)`,
  )
  db.exec(`INSERT INTO agentRegistry (registry_id, int_1) VALUES ('localUpdateCount', 100)`)
  const content = db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, rb_local_deleted, rb_local_usn, updated_at)
     VALUES (?, ?, ?, 12, 100, 0, 7, ?)`,
  )
  content.run('A', FROM, 'from.aiff', OLD)
  if (withTo) content.run('B', TO, 'to.aiff', OLD)
  content.run('X', '/m/x.aiff', 'x.aiff', OLD)
  const entry = db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_local_deleted, rb_local_usn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 7, ?, ?)`,
  )
  entry.run('e1', 'p1', 'A', 1, 'u1', 0, OLD, OLD)
  entry.run('e2', 'p1', 'X', 2, 'u2', 0, OLD, OLD)
  if (withTo) entry.run('e3', 'p2', 'B', 1, 'u3', 0, OLD, OLD)
  entry.run('e4', 'p2', 'X', withTo ? 2 : 1, 'u4', 0, OLD, OLD)
  entry.run('e5', 'p2', 'A', withTo ? 3 : 2, 'u5', 0, OLD, OLD)
  entry.run('e6', 'p2', 'Y', withTo ? 4 : 3, 'u6', 0, OLD, OLD)
  entry.run('e7', 'p3', 'A', 1, 'u7', 1, OLD, OLD)
  const cue = db.prepare(
    `INSERT INTO djmdCue (ID, ContentID, InMsec, rb_local_deleted, rb_local_usn, updated_at) VALUES (?, ?, ?, 0, 7, ?)`,
  )
  cue.run('c1', 'A', 1000, OLD)
  if (withTo) cue.run('c2', 'B', 2000, OLD)
  db.close()
  return path
}

function query<T>(sql: string, ...args: unknown[]): T[] {
  const db = openRekordboxDb(dbPath)
  if (!db) throw new Error('could not reopen the collection')
  const rows = db.prepare(sql).all(...args) as T[]
  db.close()
  return rows
}

type Entry = {
  ID: string
  PlaylistID: string
  ContentID: string
  TrackNo: number
  rb_local_deleted: number
  rb_local_usn: number
  updated_at: string
}
const entries = () => query<Entry>(`SELECT * FROM djmdSongPlaylist ORDER BY ID`)
const entry = (id: string) => entries().find((e) => e.ID === id) as Entry
const content = (id: string) =>
  query<{ FolderPath: string; rb_local_deleted: number; rb_local_usn: number; updated_at: string }>(
    `SELECT * FROM djmdContent WHERE ID = ?`,
    id,
  )[0]
const cues = () => query(`SELECT * FROM djmdCue ORDER BY ID`)
const counter = () =>
  query<{ int_1: number }>(
    `SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`,
  )[0].int_1

const pair = () => [{ from: FROM, to: TO }]

beforeEach(async () => {
  vi.mocked(isRekordboxRunning).mockResolvedValue(false)
  dir = await mkdtemp(join(tmpdir(), 'surco-rbdup-'))
  FROM = join(dir, 'from.aiff')
  TO = join(dir, 'to.aiff')
  await writeFile(FROM, Buffer.alloc(10))
  await writeFile(TO, Buffer.alloc(20))
})

describe('replaceRekordboxDuplicates with both copies in the collection', () => {
  beforeEach(async () => {
    dbPath = await makeDb()
  })

  // The DJ's set order is the point of a playlist: the kept copy takes the removed one's place.
  it('points an entry at the kept copy in the same position when the playlist lacks it', async () => {
    const [r] = await replaceRekordboxDuplicates(dbPath, pair())
    expect(r).toEqual({ written: true, outcome: 'replaced' })
    const e1 = entry('e1')
    expect(e1).toMatchObject({ ContentID: 'B', TrackNo: 1, rb_local_deleted: 0 })
    expect(e1.rb_local_usn).toBe(101)
    expect(e1.updated_at).not.toBe(OLD)
    expect(entry('e2')).toMatchObject({ ContentID: 'X', TrackNo: 2, rb_local_usn: 7 })
  })

  // Two entries of one song in a playlist would play it twice in a set. rekordbox itself
  // deletes a playlist entry outright (the real collection has no soft-deleted one).
  it('deletes the entry when the playlist already holds the kept copy and closes the gap', async () => {
    await replaceRekordboxDuplicates(dbPath, pair())
    expect(entries().map((e) => e.ID)).not.toContain('e5')
    expect(entry('e3')).toMatchObject({ ContentID: 'B', TrackNo: 1, rb_local_usn: 7 })
    expect(entry('e6')).toMatchObject({ ContentID: 'Y', TrackNo: 3, rb_local_deleted: 0 })
    const live = entries().filter((e) => e.PlaylistID === 'p2' && !e.rb_local_deleted)
    expect(live.map((e) => e.TrackNo).sort()).toEqual([1, 2, 3])
  })

  // Unproven that rekordbox hides a soft-deleted track, so the removed copy stays in the
  // collection with its cues, out of every playlist.
  it('leaves both tracks and the cues in the collection as they were', async () => {
    const before = cues()
    await replaceRekordboxDuplicates(dbPath, pair())
    expect(content('A')).toMatchObject({
      rb_local_deleted: 0,
      FolderPath: FROM,
      rb_local_usn: 7,
      updated_at: OLD,
    })
    expect(content('B')).toMatchObject({ rb_local_deleted: 0, rb_local_usn: 7, updated_at: OLD })
    expect(cues()).toEqual(before)
    expect(query(`SELECT count(*) AS n FROM djmdContent`)).toEqual([{ n: 3 }])
    expect(query(`SELECT count(*) AS n FROM djmdSongPlaylist`)).toEqual([{ n: 6 }])
  })

  // rekordbox stamps one operation with one usn and moves its counter once.
  it('stamps every changed row with one usn and moves the counter once', async () => {
    await replaceRekordboxDuplicates(dbPath, pair())
    expect(counter()).toBe(101)
    expect(entry('e1').rb_local_usn).toBe(101)
    expect(entry('e6').rb_local_usn).toBe(101)
    expect(entry('e6').updated_at).not.toBe(OLD)
  })

  it('leaves an entry rekordbox already deleted as it was', async () => {
    await replaceRekordboxDuplicates(dbPath, pair())
    expect(entry('e7')).toMatchObject({ ContentID: 'A', rb_local_deleted: 1, rb_local_usn: 7 })
  })

  it('looks the tracks up read-only and opens for writing only to write', async () => {
    const open = vi.spyOn(rekordboxDb, 'openRekordboxDb')
    await replaceRekordboxDuplicates(dbPath, pair())
    expect(open.mock.calls[0]).toEqual([dbPath, { readonly: true }])
    expect(open.mock.calls[1]).toEqual([dbPath])
    open.mockRestore()
  })

  it('refuses the whole run while rekordbox is open', async () => {
    vi.mocked(isRekordboxRunning).mockResolvedValue(true)
    expect(await replaceRekordboxDuplicates(dbPath, pair())).toEqual([
      { written: false, reason: 'rekordbox-running' },
    ])
    expect(entry('e1').ContentID).toBe('A')
    expect(counter()).toBe(100)
    await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
  })

  it('refuses to write when rekordbox opened between the read and the write', async () => {
    vi.mocked(isRekordboxRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await replaceRekordboxDuplicates(dbPath, pair())).toEqual([
      { written: false, reason: 'rekordbox-running' },
    ])
    expect(entry('e1').ContentID).toBe('A')
    expect(entries()).toHaveLength(7)
    expect(counter()).toBe(100)
  })

  it('takes the session copy first and a backup of the collection as it was', async () => {
    const sessionBackup = vi.fn(async () => {
      await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
    })
    await replaceRekordboxDuplicates(dbPath, pair(), { sessionBackup })
    expect(sessionBackup).toHaveBeenCalledWith(dbPath)
    const live = dbPath
    dbPath = `${live}.surco-backup`
    expect(entry('e1').ContentID).toBe('A')
    expect(entries()).toHaveLength(7)
    dbPath = live
    expect(entry('e1').ContentID).toBe('B')
  })

  it('writes nothing when the session backup cannot be made', async () => {
    const results = await replaceRekordboxDuplicates(dbPath, pair(), {
      sessionBackup: vi.fn(async () => Promise.reject(new Error('disk full'))),
    })
    expect(results).toEqual([{ written: false, reason: 'backup-failed' }])
    expect(entry('e1').ContentID).toBe('A')
    expect(counter()).toBe(100)
  })

  it('says so when the collection file is read-only', async () => {
    await chmod(dbPath, 0o444)
    const [r] = await replaceRekordboxDuplicates(dbPath, pair())
    await chmod(dbPath, 0o644)
    expect(r).toEqual({ written: false, reason: 'read-only' })
    expect(entry('e1').ContentID).toBe('A')
  })

  it('does nothing when both paths name the same row', async () => {
    const [r] = await replaceRekordboxDuplicates(dbPath, [{ from: FROM, to: FROM }])
    expect(r).toEqual({ written: false, reason: 'no-match' })
    expect(counter()).toBe(100)
    await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
  })
})

describe('replaceRekordboxDuplicates with one copy in the collection', () => {
  // Repointing keeps the row, so its cues, playlists and history go with the kept file.
  it('repoints the removed copy at the kept file when only the removed one is there', async () => {
    dbPath = await makeDb(false)
    const [r] = await replaceRekordboxDuplicates(dbPath, pair())
    expect(r).toEqual({ written: true, outcome: 'repointed' })
    expect(content('A')).toMatchObject({ FolderPath: TO, rb_local_deleted: 0 })
    expect(entry('e1').ContentID).toBe('A')
    expect(entry('e5')).toMatchObject({ ContentID: 'A', rb_local_deleted: 0 })
  })

  // Both rows would end on one file, which the collection would then hold twice.
  it('repoints only the first removed copy onto a kept file and fails the next', async () => {
    dbPath = await makeDb(false)
    const second = join(dir, 'second.aiff')
    await writeFile(second, Buffer.alloc(5))
    const db = open(dbPath)
    db.prepare(
      `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, rb_local_deleted) VALUES ('C', ?, 'second.aiff', 12, 5, 0)`,
    ).run(second)
    db.close()
    const results = await replaceRekordboxDuplicates(dbPath, [
      { from: FROM, to: TO },
      { from: second, to: TO },
    ])
    expect(results).toEqual([
      { written: true, outcome: 'repointed' },
      { written: false, reason: 'kept-taken' },
    ])
    expect(content('A').FolderPath).toBe(TO)
    expect(content('C').FolderPath).toBe(second)
  })

  it('touches nothing when only the kept copy is there', async () => {
    dbPath = await makeDb()
    const db = open(dbPath)
    db.prepare(`UPDATE djmdContent SET FolderPath = '/m/other.aiff' WHERE ID = 'A'`).run()
    db.close()
    const [r] = await replaceRekordboxDuplicates(dbPath, pair())
    expect(r).toEqual({ written: false, reason: 'no-match' })
    expect(counter()).toBe(100)
    await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
  })
})
