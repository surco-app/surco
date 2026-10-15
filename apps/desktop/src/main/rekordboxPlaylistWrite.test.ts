import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RekordboxPlaylistEdit } from '../shared/types'
import { openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'
import {
  ORGANISE_FIXTURE,
  type PlaylistFixture,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'

// The probe shells out to pgrep/tasklist; pinned so the suite never depends on whether
// rekordbox happens to be open on the machine running it.
vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

// The real generator by default; one test feeds it IDs to prove which ones a creation skips.
vi.mock('./rekordboxPlaylistEdit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rekordboxPlaylistEdit')>()
  return { ...actual, randomPlaylistId: vi.fn(actual.randomPlaylistId) }
})

import { randomPlaylistId } from './rekordboxPlaylistEdit'
import { editRekordboxPlaylist } from './rekordboxPlaylistWrite'
import { isRekordboxRunning } from './rekordboxProcess'

const NOW = new Date('2026-10-15T18:00:00.000Z')
const MOVE: RekordboxPlaylistEdit = {
  kind: 'move',
  playlistId: '2000',
  linkIds: ['f6'],
  beforeLinkId: 'f1',
}
const CREATE: RekordboxPlaylistEdit = {
  kind: 'create',
  parentId: 'root',
  name: 'Bolo',
  folder: false,
}

beforeEach(() => {
  vi.mocked(isRekordboxRunning).mockReset()
  vi.mocked(isRekordboxRunning).mockResolvedValue(false)
})

async function collection(over: Partial<PlaylistFixture> = {}): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbwrite-')), 'master.db')
  writeRekordboxPlaylistFixture(path, { ...ORGANISE_FIXTURE, xml: true, ...over })
  return path
}

function deps(over: Record<string, unknown> = {}) {
  return {
    ensureClosed: vi.fn(async () => true),
    sessionBackup: vi.fn(async () => {}),
    now: () => NOW,
    ...TWIN_PATHS,
    ...over,
  }
}

function linkIds(path: string, playlistId: string): string[] {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return (
      db
        .prepare('SELECT ID FROM djmdSongPlaylist WHERE PlaylistID = ? ORDER BY TrackNo')
        .all(playlistId) as { ID: string }[]
    ).map((r) => r.ID)
  } finally {
    db.close()
  }
}

function playlistNamed(path: string, name: string): unknown {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return db.prepare('SELECT ID FROM djmdPlaylist WHERE Name = ?').get(name)
  } finally {
    db.close()
  }
}

const FACTORY = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']

describe('editRekordboxPlaylist', () => {
  it('adds what the collection has and reports the rest by reason', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      {
        kind: 'add',
        playlistId: '3000',
        tracks: [
          { paths: ['/Users/dj/Music/Music/Gowan.wav'] },
          { paths: ['/Volumes/Public/Music/Ekkah.wav'] },
          { paths: ['/Volumes/Public/Music/new.wav'] },
          { paths: ['/Volumes/Public/Music/Play This Song.wav'] },
        ],
      },
      deps(),
    )
    expect(result).toEqual({
      applied: true,
      report: { added: 1, already: 1, notInCollection: 1, ambiguous: 1 },
    })
    expect(linkIds(path, '3000')).toHaveLength(3)
  })

  // Closing rekordbox is a cost to the user; an add that can change nothing must not ask
  // for it, nor leave a backup behind as if something had been written.
  it('asks nothing and writes nothing when none of the tracks can be added', async () => {
    const path = await collection()
    const d = deps()
    const result = await editRekordboxPlaylist(
      path,
      { kind: 'add', playlistId: '3000', tracks: [{ paths: ['/Volumes/Public/Music/new.wav'] }] },
      d,
    )
    expect(result).toEqual({
      applied: false,
      reason: 'nothing-to-add',
      report: { added: 0, already: 0, notInCollection: 1, ambiguous: 0 },
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
    expect(existsSync(`${path}.surco-backup`)).toBe(false)
  })

  it('asks nothing for an edit whose row is already gone', async () => {
    const path = await collection()
    const d = deps()
    expect(await editRekordboxPlaylist(path, { ...MOVE, linkIds: ['gone'] }, d)).toEqual({
      applied: false,
      reason: 'stale',
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  // Cancel in the dialog means rekordbox stays open, and writing underneath it is exactly
  // what must never happen: nothing is applied and nothing is kept for later in 2a.
  it('applies nothing when the user keeps rekordbox open', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      MOVE,
      deps({ ensureClosed: vi.fn(async () => false) }),
    )
    expect(result).toEqual({ applied: false, reason: 'cancelled' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
    expect(existsSync(`${path}.surco-backup`)).toBe(false)
  })

  // Dropping a row onto its own place, or onto the place it already holds, is a gesture
  // that changes nothing; asking to close rekordbox for it would be a cost for no write.
  it.each([
    ['onto itself', { ...MOVE, linkIds: ['f3'], beforeLinkId: 'f3' }],
    ['onto the row it already precedes', { ...MOVE, linkIds: ['f1'], beforeLinkId: 'f2' }],
    ['to the end it already holds', { ...MOVE, linkIds: ['f6', 'f7'], beforeLinkId: null }],
  ])('asks nothing and writes nothing for a move %s', async (_, edit) => {
    const path = await collection()
    const d = deps()
    expect(await editRekordboxPlaylist(path, edit, d)).toEqual({ applied: true })
    expect(d.ensureClosed).not.toHaveBeenCalled()
    expect(d.sessionBackup).not.toHaveBeenCalled()
    expect(existsSync(`${path}.surco-backup`)).toBe(false)
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  // The dialog closed rekordbox, but the user can launch it again before the write.
  it('applies nothing when rekordbox opens between the dialog and the write', async () => {
    const path = await collection()
    vi.mocked(isRekordboxRunning).mockResolvedValueOnce(true)
    expect(await editRekordboxPlaylist(path, MOVE, deps())).toEqual({
      applied: false,
      reason: 'rekordbox-running',
    })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  it('backs up the collection for the session and for this write before writing', async () => {
    const path = await collection()
    const d = deps()
    expect(await editRekordboxPlaylist(path, MOVE, d)).toEqual({ applied: true })
    expect(d.sessionBackup).toHaveBeenCalledWith(path)
    expect(linkIds(`${path}.surco-backup`, '2000')).toEqual(FACTORY)
    expect(linkIds(path, '2000')).toEqual(['f6', 'f1', 'f2', 'f3', 'f4', 'f5', 'f7'])
  })

  // No backup, no write: a session copy that cannot be made stops the edit before
  // rekordbox's file is touched.
  it('writes nothing when the session copy cannot be made', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      MOVE,
      deps({ sessionBackup: vi.fn(async () => Promise.reject(new Error('disk full'))) }),
    )
    expect(result).toEqual({ applied: false, reason: 'backup-failed' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  // The seam runs after the edit's statements, so the rollback below is undoing a real
  // change; a failure before the write would prove nothing.
  it('puts the collection back when the write dies halfway', async () => {
    const path = await collection()
    const result = await editRekordboxPlaylist(
      path,
      MOVE,
      deps({
        onWrite: () => {
          throw new Error('disk gone')
        },
      }),
    )
    expect(result).toEqual({ applied: false, reason: 'write-failed' })
    expect(linkIds(path, '2000')).toEqual(FACTORY)
  })

  it('creates a playlist in the database and its node in the XML', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const d = deps()
    const result = await editRekordboxPlaylist(path, CREATE, d)
    expect(result.applied).toBe(true)
    const id = result.applied ? result.createdId : undefined
    expect(playlistNamed(path, 'Bolo')).toEqual({ ID: id })
    const hex = BigInt(id ?? '0')
      .toString(16)
      .toUpperCase()
    expect(await readFile(xmlPath, 'utf8')).toContain(
      `<NODE Id="${hex}" ParentId="0" Attribute="0" Timestamp="1792087200000" Lib_Type="0" CheckType="0"/>`,
    )
    expect(d.sessionBackup).toHaveBeenCalledWith(xmlPath)
    expect(existsSync(`${xmlPath}.surco-backup`)).toBe(true)
  })

  // The XML can hold a node the table no longer has; giving a new playlist that ID would
  // make rekordbox read two playlists as one.
  it('never gives a new playlist an ID the XML already holds', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const xml = await readFile(xmlPath, 'utf8')
    await writeFile(
      xmlPath,
      xml.replace(
        '  </PLAYLISTS>',
        '    <NODE Id="1F4" ParentId="0" Attribute="0" Timestamp="1767225600000" Lib_Type="0" CheckType="0"/>\r\n  </PLAYLISTS>',
      ),
    )
    vi.mocked(randomPlaylistId).mockReturnValueOnce('500').mockReturnValueOnce('600')
    const result = await editRekordboxPlaylist(path, CREATE, deps())
    expect(result).toEqual({ applied: true, createdId: '600' })
    expect(playlistNamed(path, 'Bolo')).toEqual({ ID: '600' })
  })

  // The database row committed and the XML failed: rekordbox would find a playlist with no
  // node, so both go back.
  it('puts both files back when the XML cannot be written', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const before = await readFile(xmlPath, 'utf8')
    const result = await editRekordboxPlaylist(
      path,
      CREATE,
      deps({ writeXml: vi.fn(async () => Promise.reject(new Error('locked'))) }),
    )
    expect(result).toEqual({ applied: false, reason: 'write-failed' })
    expect(playlistNamed(path, 'Bolo')).toBeUndefined()
    expect(await readFile(xmlPath, 'utf8')).toBe(before)
  })

  // A layout the text edit refuses to guess at is a failed write like any other: the
  // playlist row already committed must not stay behind without its node.
  it('puts both files back when the XML is not laid out one node per line', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    await writeFile(
      xmlPath,
      (await readFile(xmlPath, 'utf8')).replace('\r\n  </PLAYLISTS>', '</PLAYLISTS>'),
    )
    const before = await readFile(xmlPath, 'utf8')
    expect(await editRekordboxPlaylist(path, CREATE, deps())).toEqual({
      applied: false,
      reason: 'write-failed',
    })
    expect(playlistNamed(path, 'Bolo')).toBeUndefined()
    expect(await readFile(xmlPath, 'utf8')).toBe(before)
  })

  it('leaves the XML alone for an edit of tracks', async () => {
    const path = await collection()
    const xmlPath = join(path, '..', 'masterPlaylists6.xml')
    const before = await readFile(xmlPath, 'utf8')
    await editRekordboxPlaylist(path, MOVE, deps())
    expect(await readFile(xmlPath, 'utf8')).toBe(before)
    expect(existsSync(`${xmlPath}.surco-backup`)).toBe(false)
  })

  // rekordbox keeps the collection in WAL mode: committed changes can still be in the -wal
  // file, and a copy of master.db alone would be a backup missing them.
  it('backs up changes still sitting in the WAL', async () => {
    const path = await collection({ wal: true })
    const other = new Database(path)
    other.pragma(`cipher='sqlcipher'`)
    other.pragma('legacy=4')
    other.pragma(`key='${REKORDBOX_KEY}'`)
    other
      .prepare(
        `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, created_at, updated_at)
         VALUES ('w1', '3000', '104', 3, 'x', 'x')`,
      )
      .run()
    try {
      expect(await editRekordboxPlaylist(path, MOVE, deps())).toEqual({ applied: true })
    } finally {
      other.close()
    }
    expect(linkIds(`${path}.surco-backup`, '3000')).toEqual(['h1', 'h2', 'w1'])
  })

  // A collection the process cannot write to is the user's to fix; "write failed" does not
  // say that.
  it('says the collection is read-only instead of a generic failure', async () => {
    const path = await collection()
    await chmod(path, 0o444)
    expect(await editRekordboxPlaylist(path, MOVE, deps())).toEqual({
      applied: false,
      reason: 'read-only',
    })
  })

  it('reports an unreadable collection without asking anything', async () => {
    const d = deps()
    expect(await editRekordboxPlaylist('', MOVE, d)).toEqual({
      applied: false,
      reason: 'unreadable',
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })
})
