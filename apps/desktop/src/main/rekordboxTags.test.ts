import { access, chmod, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'
import { updateRekordboxTags } from './rekordboxTags'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { isRekordboxRunning } from './rekordboxProcess'

const TRACK = '/m/c.mp3'
const AUDIT = `rb_data_status INTEGER, rb_local_data_status INTEGER, rb_local_deleted TINYINT(1), rb_local_synced TINYINT(1), usn BIGINT, rb_local_usn BIGINT, created_at DATETIME, updated_at DATETIME`

let dbPath: string

function insertArtist(db: Database.Database, id: string, name: string) {
  db.prepare(
    `INSERT INTO djmdArtist (ID, Name, UUID, rb_local_deleted, rb_local_usn, created_at, updated_at)
     VALUES (?, ?, ?, 0, 5, '2024-06-25 12:16:14.804 +00:00', '2024-06-25 12:16:14.804 +00:00')`,
  ).run(id, name, `uuid-${id}`)
}

async function makeDb(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbt-')), 'master.db')
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`CREATE TABLE djmdContent (
    ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255), FileNameL VARCHAR(255),
    FileNameS VARCHAR(255), FileType INTEGER, FileSize INTEGER, OrgFolderPath VARCHAR(255),
    Title VARCHAR(255), ArtistID VARCHAR(255), AlbumID VARCHAR(255), GenreID VARCHAR(255),
    rb_local_deleted TINYINT(1) DEFAULT 0, rb_local_usn BIGINT, updated_at DATETIME
  )`)
  db.exec(
    `CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), SearchStr VARCHAR(255), UUID VARCHAR(255), ${AUDIT})`,
  )
  db.exec(
    `CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), AlbumArtistID VARCHAR(255), ImagePath VARCHAR(255), Compilation INTEGER, SearchStr VARCHAR(255), UUID VARCHAR(255), ${AUDIT})`,
  )
  db.exec(
    `CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), UUID VARCHAR(255), ${AUDIT})`,
  )
  db.exec(
    `CREATE TABLE agentRegistry (registry_id VARCHAR(255) PRIMARY KEY, id_1 VARCHAR(255), id_2 VARCHAR(255), int_1 BIGINT, int_2 BIGINT, str_1 VARCHAR(255), str_2 VARCHAR(255), date_1 DATETIME, date_2 DATETIME, text_1 TEXT, text_2 TEXT, created_at DATETIME, updated_at DATETIME)`,
  )
  db.exec(`INSERT INTO agentRegistry (registry_id, int_1) VALUES ('localUpdateCount', 100)`)
  insertArtist(db, 'L1', 'Dj Lara')
  db.prepare(
    `INSERT INTO djmdAlbum (ID, Name, AlbumArtistID, UUID, rb_local_deleted) VALUES ('A1', 'X', 'L1', 'uuid-A1', 0)`,
  ).run()
  db.prepare(
    `INSERT INTO djmdGenre (ID, Name, UUID, rb_local_deleted) VALUES ('G1', 'electronic', 'uuid-G1', 0)`,
  ).run()
  db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, Title, ArtistID, AlbumID, GenreID)
     VALUES ('900001', ?, 'c.mp3', 1, 'Old Title', 'L1', 'A1', 'G1')`,
  ).run(TRACK)
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

const track = () =>
  query<{
    Title: string
    ArtistID: string
    AlbumID: string
    GenreID: string
    rb_local_usn: number | null
    updated_at: string | null
  }>(
    `SELECT Title, ArtistID, AlbumID, GenreID, rb_local_usn, updated_at FROM djmdContent WHERE ID = '900001'`,
  )[0]
const names = (table: string) =>
  query<{ Name: string }>(`SELECT Name FROM ${table} ORDER BY Name`).map((r) => r.Name)
const counter = () =>
  query<{ int_1: number }>(
    `SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`,
  )[0].int_1

beforeEach(async () => {
  vi.mocked(isRekordboxRunning).mockResolvedValue(false)
  dbPath = await makeDb()
})

describe('updateRekordboxTags', () => {
  it('points the track at the artist spelled right, creating it when the collection has none', async () => {
    const [r] = await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(r).toEqual({ written: true })
    const created = query<{ ID: string; UUID: string; rb_local_usn: number; created_at: string }>(
      `SELECT ID, UUID, rb_local_usn, created_at FROM djmdArtist WHERE Name = 'DJ Lara'`,
    )
    expect(created).toHaveLength(1)
    expect(track().ArtistID).toBe(created[0].ID)
    expect(created[0].UUID).toMatch(/^[0-9a-f-]{36}$/)
    expect(created[0].rb_local_usn).toBe(101)
    expect(track().rb_local_usn).toBe(102)
    expect(created[0].created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \+00:00$/)
    expect(names('djmdArtist')).toContain('Dj Lara')
    expect(counter()).toBe(102)
  })

  it('reuses the artist row that already has the right name', async () => {
    const db = new Database(dbPath)
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${REKORDBOX_KEY}'`)
    insertArtist(db, 'L2', 'DJ Lara')
    db.close()
    await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(track().ArtistID).toBe('L2')
    expect(names('djmdArtist')).toEqual(['DJ Lara', 'Dj Lara'])
  })

  // A DJ who renamed the artist inside rekordbox made a choice the review never saw.
  it('leaves a track alone when rekordbox already says something else', async () => {
    const db = new Database(dbPath)
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${REKORDBOX_KEY}'`)
    insertArtist(db, 'L3', 'DJ LARA')
    db.prepare(`UPDATE djmdContent SET ArtistID = 'L3'`).run()
    db.close()
    const [r] = await updateRekordboxTags(dbPath, [
      {
        path: TRACK,
        fields: {
          artist: { from: 'Dj Lara', to: 'DJ Lara' },
          title: { from: 'Old Title', to: 'New Title' },
        },
      },
    ])
    expect(r).toEqual({ written: false, reason: 'changed' })
    expect(track().Title).toBe('Old Title')
    expect(track().ArtistID).toBe('L3')
    expect(counter()).toBe(100)
  })

  it('moves the track to the album of the new album artist and keeps the album name', async () => {
    await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { albumArtist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    const [album] = query<{ ID: string; Name: string; AlbumArtistID: string }>(
      `SELECT ID, Name, AlbumArtistID FROM djmdAlbum WHERE ID = ?`,
      track().AlbumID,
    )
    expect(album.Name).toBe('X')
    const owner = query<{ Name: string }>(
      `SELECT Name FROM djmdArtist WHERE ID = ?`,
      album.AlbumArtistID,
    )
    expect(owner[0].Name).toBe('DJ Lara')
    expect(track().AlbumID).not.toBe('A1')
    expect(query(`SELECT 1 FROM djmdAlbum WHERE ID = 'A1' AND AlbumArtistID = 'L1'`)).toHaveLength(
      1,
    )
  })

  it('renames the title in place and points the genre at the right row', async () => {
    await updateRekordboxTags(dbPath, [
      {
        path: TRACK,
        fields: {
          title: { from: 'Old Title', to: 'New Title' },
          genre: { from: 'electronic', to: 'Electronic' },
        },
      },
    ])
    const t = track()
    expect(t.Title).toBe('New Title')
    expect(
      query<{ Name: string }>(`SELECT Name FROM djmdGenre WHERE ID = ?`, t.GenreID)[0].Name,
    ).toBe('Electronic')
    expect(names('djmdGenre')).toEqual(['Electronic', 'electronic'])
    expect(t.rb_local_usn).toBeGreaterThan(100)
    expect(t.updated_at).toMatch(/\+00:00$/)
  })

  it('reports a track the collection does not have as no-match and writes no backup', async () => {
    const [r] = await updateRekordboxTags(dbPath, [
      { path: '/m/none.mp3', fields: { title: { from: 'a', to: 'b' } } },
    ])
    expect(r).toEqual({ written: false, reason: 'no-match' })
    await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
  })

  it('refuses the whole run while rekordbox is open', async () => {
    vi.mocked(isRekordboxRunning).mockResolvedValue(true)
    const results = await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { title: { from: 'Old Title', to: 'New Title' } } },
    ])
    expect(results).toEqual([{ written: false, reason: 'rekordbox-running' }])
    expect(track().Title).toBe('Old Title')
  })

  it('keeps the backups and the session copy of the collection as it was before the write', async () => {
    const order: string[] = []
    const sessionBackup = vi.fn(async () => {
      order.push('session')
      await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
    })
    await updateRekordboxTags(
      dbPath,
      [{ path: TRACK, fields: { title: { from: 'Old Title', to: 'New Title' } } }],
      { sessionBackup },
    )
    expect(sessionBackup).toHaveBeenCalledWith(dbPath)
    const backup = `${dbPath}.surco-backup`
    await access(backup)
    const live = dbPath
    dbPath = backup
    expect(track().Title).toBe('Old Title')
    dbPath = live
    expect(track().Title).toBe('New Title')
    expect(await readFile(backup)).not.toHaveLength(0)
  })

  it('refuses to write when rekordbox opened between the read and the write', async () => {
    vi.mocked(isRekordboxRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const results = await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { title: { from: 'Old Title', to: 'New Title' } } },
    ])
    expect(results).toEqual([{ written: false, reason: 'rekordbox-running' }])
    expect(track().Title).toBe('Old Title')
    expect(counter()).toBe(100)
  })

  it('writes nothing when the session backup cannot be made', async () => {
    const results = await updateRekordboxTags(
      dbPath,
      [{ path: TRACK, fields: { title: { from: 'Old Title', to: 'New Title' } } }],
      { sessionBackup: vi.fn(async () => Promise.reject(new Error('disk full'))) },
    )
    expect(results).toEqual([{ written: false, reason: 'backup-failed' }])
    expect(track().Title).toBe('Old Title')
    expect(counter()).toBe(100)
  })

  // The fix for a read-only collection is the user's, and write-failed does not say so.
  it('says so when the collection file is read-only', async () => {
    await chmod(dbPath, 0o444)
    const [r] = await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { title: { from: 'Old Title', to: 'New Title' } } },
    ])
    await chmod(dbPath, 0o644)
    expect(r).toEqual({ written: false, reason: 'read-only' })
    expect(track().Title).toBe('Old Title')
  })

  it('ignores an album artist change on a track with no album and creates no album', async () => {
    const db = new Database(dbPath)
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${REKORDBOX_KEY}'`)
    db.prepare(`UPDATE djmdContent SET AlbumID = NULL`).run()
    db.close()
    const [r] = await updateRekordboxTags(dbPath, [
      {
        path: TRACK,
        fields: {
          albumArtist: { from: 'Dj Lara', to: 'DJ Lara' },
          title: { from: 'Old Title', to: 'New Title' },
        },
      },
    ])
    expect(r).toEqual({ written: true })
    expect(track().Title).toBe('New Title')
    expect(track().AlbumID).toBeNull()
    expect(names('djmdAlbum')).toEqual(['X'])
    expect(names('djmdArtist')).toEqual(['Dj Lara'])
  })

  it('reports no-match and bumps nothing when no field is left to write', async () => {
    const db = new Database(dbPath)
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${REKORDBOX_KEY}'`)
    db.prepare(`UPDATE djmdContent SET AlbumID = NULL`).run()
    db.close()
    const [r] = await updateRekordboxTags(dbPath, [
      { path: TRACK, fields: { albumArtist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(r).toEqual({ written: false, reason: 'no-match' })
    expect(track().rb_local_usn).toBeNull()
    expect(counter()).toBe(100)
    await expect(access(`${dbPath}.surco-backup`)).rejects.toThrow()
  })
})
