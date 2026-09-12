import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'
import { repointTrack } from './rekordboxLibrary'

// The probe shells out to pgrep/tasklist; pinned so the suite never depends on whether
// rekordbox happens to be open on the machine running it.
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { isRekordboxRunning } from './rekordboxProcess'

const MP3 = '/Volumes/Public/Music/Acid/02 Everybody.mp3'

let dbPath: string
let audioDir: string

// Builds a miniature encrypted collection with the same column names and cipher settings
// as a live rekordbox 7 database, plus the playlist links that make the repoint worth
// doing at all.
async function makeDb(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbw-')), 'master.db')
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`CREATE TABLE djmdContent (
    ID VARCHAR(255) PRIMARY KEY,
    FolderPath VARCHAR(255),
    FileNameL VARCHAR(255),
    FileNameS VARCHAR(255),
    FileType INTEGER,
    FileSize INTEGER,
    OrgFolderPath VARCHAR(255),
    rb_local_deleted TINYINT(1) DEFAULT 0
  )`)
  db.exec(`CREATE TABLE djmdSongPlaylist (
    ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255), ContentID VARCHAR(255)
  )`)
  db.exec(`CREATE TABLE djmdCue (
    ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), InMsec INTEGER
  )`)
  db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, OrgFolderPath)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('900001', MP3, '02 Everybody.mp3', 1, 18307141, '/Users/vicent/Music/Music/old.mp3')
  db.prepare(`INSERT INTO djmdSongPlaylist VALUES (?, ?, ?)`).run('1', 'pl1', '900001')
  db.prepare(`INSERT INTO djmdSongPlaylist VALUES (?, ?, ?)`).run('2', 'pl2', '900001')
  db.prepare(`INSERT INTO djmdCue VALUES (?, ?, ?)`).run('c1', '900001', 32000)
  db.close()
  return path
}

function readRow(path: string, id = '900001') {
  const db = openRekordboxDb(path)
  if (!db) throw new Error('could not reopen the collection')
  const row = db
    .prepare(`SELECT FolderPath, FileNameL, FileType, FileSize, OrgFolderPath FROM djmdContent
              WHERE ID = ?`)
    .get(id) as {
    FolderPath: string
    FileNameL: string
    FileType: number
    FileSize: number
    OrgFolderPath: string
  }
  const playlists = db
    .prepare(`SELECT count(*) c FROM djmdSongPlaylist WHERE ContentID = ?`)
    .get(id) as { c: number }
  const cues = db.prepare(`SELECT count(*) c FROM djmdCue WHERE ContentID = ?`).get(id) as {
    c: number
  }
  db.close()
  return { ...row, playlists: playlists.c, cues: cues.c }
}

beforeEach(async () => {
  vi.mocked(isRekordboxRunning).mockResolvedValue(false)
  dbPath = await makeDb()
  audioDir = await mkdtemp(join(tmpdir(), 'surco-rba-'))
})

describe('repointTrack', () => {
  it('moves the entry onto the converted file', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))

    const result = await repointTrack(dbPath, { from: MP3, to: output })

    expect(result.written).toBe(true)
    const row = readRow(dbPath)
    expect(row.FolderPath).toBe(output)
    expect(row.FileNameL).toBe('02 Everybody.wav')
    // wav is 11; leaving the mp3 code behind would describe the row as a file it is not.
    expect(row.FileType).toBe(11)
    expect(row.FileSize).toBe(5000)
  })

  // The entire reason to repoint rather than re-import: the row keeps its ID, so every
  // playlist entry and cue that references it survives untouched.
  it('keeps the track in its playlists and keeps its cues', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))

    await repointTrack(dbPath, { from: MP3, to: output })

    const row = readRow(dbPath)
    expect(row.playlists).toBe(2)
    expect(row.cues).toBe(1)
  })

  // OrgFolderPath records where the track originally came from. In the real collection
  // 846 rows already disagree with the live path and rekordbox runs fine, so it is
  // history, not a second address to keep in step.
  it('leaves the original-path column alone', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))

    await repointTrack(dbPath, { from: MP3, to: output })

    expect(readRow(dbPath).OrgFolderPath).toBe('/Users/vicent/Music/Music/old.mp3')
  })

  it('writes a backup next to the collection before touching it', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))
    const before = await readFile(dbPath)

    await repointTrack(dbPath, { from: MP3, to: output })

    expect(await readFile(`${dbPath}.surco-backup`)).toEqual(before)
  })

  // No backup, no write. A write without a recoverable copy beside it is the one outcome
  // this module exists to rule out — the collection cannot be rebuilt from anywhere else.
  it('refuses to write when the backup cannot be made', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))

    const result = await repointTrack(dbPath, {
      from: MP3,
      to: output,
      backup: async () => {
        throw new Error('read-only volume')
      },
    })

    expect(result).toEqual({ written: false, reason: 'backup-failed' })
    expect(readRow(dbPath).FolderPath).toBe(MP3)
  })

  // rekordbox holds master.db open for as long as it runs, so a write underneath it can
  // be lost or can corrupt the file.
  it('refuses to write while rekordbox is open', async () => {
    vi.mocked(isRekordboxRunning).mockResolvedValue(true)
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))

    const result = await repointTrack(dbPath, { from: MP3, to: output })

    expect(result).toEqual({ written: false, reason: 'rekordbox-running' })
    expect(readRow(dbPath).FolderPath).toBe(MP3)
  })

  // The file has to be on disk before the collection is told to point at it, or the
  // repoint trades one missing-file "!" for another.
  it('refuses to point the entry at a file that is not there', async () => {
    const result = await repointTrack(dbPath, { from: MP3, to: join(audioDir, 'never.wav') })

    expect(result).toEqual({ written: false, reason: 'output-missing' })
    expect(readRow(dbPath).FolderPath).toBe(MP3)
  })

  // A user who keeps only part of their library in rekordbox is the normal case, not an
  // error, and nothing should be written or backed up for a track it never had.
  it('reports no match without writing when the collection lacks the track', async () => {
    const output = join(audioDir, 'Other.wav')
    await writeFile(output, Buffer.alloc(10))

    const result = await repointTrack(dbPath, { from: '/elsewhere/Other.mp3', to: output })

    expect(result).toEqual({ written: false, reason: 'no-match' })
    await expect(stat(`${dbPath}.surco-backup`)).rejects.toThrow()
  })

  // 35 files in the real collection have two rows apiece and 67 of those rows are in
  // playlists. Repointing one would leave its twin on the replaced file, so the caller is
  // told to ask rather than being handed a guess.
  it('refuses to choose between two rows for one file', async () => {
    const db = openRekordboxDb(dbPath)
    if (!db) throw new Error('could not open the collection')
    db.prepare(
      `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, OrgFolderPath)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('900002', MP3.replace('/Volumes/Public/Music', '/mirror'), '02 Everybody.mp3', 1, 999, '')
    db.close()
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))

    const result = await repointTrack(dbPath, {
      from: MP3,
      to: output,
      realPath: (p) => p.replace('/mirror', '/Volumes/Public/Music'),
      homeMusicDir: '/mirror',
    })

    expect(result).toEqual({ written: false, reason: 'ambiguous', ids: ['900001', '900002'] })
    expect(readRow(dbPath).FolderPath).toBe(MP3)
  })

  // The guard is checked again immediately before the write: rekordbox can be launched
  // during the lookup and the backup, and that window is exactly when a user double-clicks
  // the app after starting a conversion.
  it('checks again right before writing, after the backup', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))
    vi.mocked(isRekordboxRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await repointTrack(dbPath, { from: MP3, to: output })

    expect(result).toEqual({ written: false, reason: 'rekordbox-running' })
    expect(readRow(dbPath).FolderPath).toBe(MP3)
  })

  // A collection whose file is not writable reports its own reason, because the fix is
  // the user's to make and "write-failed" does not say what to do. Hit for real while
  // testing against a copy of the live collection: the copy inherited read-only
  // permissions and every repoint came back as a generic failure.
  it('says so when the collection file is read-only', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))
    await chmod(dbPath, 0o444)

    const result = await repointTrack(dbPath, { from: MP3, to: output })

    expect(result).toEqual({ written: false, reason: 'read-only' })
    await chmod(dbPath, 0o644)
    expect(readRow(dbPath).FolderPath).toBe(MP3)
  })

  it('restores the collection from the backup when the write fails midway', async () => {
    const output = join(audioDir, '02 Everybody.wav')
    await writeFile(output, Buffer.alloc(5000))
    const before = await readFile(dbPath)

    const result = await repointTrack(dbPath, {
      from: MP3,
      to: output,
      onWrite: () => {
        throw new Error('disk went away')
      },
    })

    expect(result).toEqual({ written: false, reason: 'write-failed' })
    expect(await readFile(dbPath)).toEqual(before)
  })
})
