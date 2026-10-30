import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { makeRekordbox, type RekordboxSeed, rekordboxRow } from '../scenarios/rekordboxFixture'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import {
  checkRekordbox,
  type RekordboxExpect,
  type RekordboxSnapshot,
  snapshotRekordboxRow,
} from './verifyRekordbox'

const FROM = '/Volumes/Music/Artist/Title.aiff'
const TO = '/Volumes/Music/Artist/Title.wav'
const SIZE = 52_000_123
const find: FindOptions = { realPath: (p) => p, homeMusicDir: '/nowhere', quiet: true }
const thirteen = Array.from({ length: 13 }, (_, i) => 1000 * (i + 1))

const opened: { close: () => void }[] = []
afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

function collection(seeds: Partial<RekordboxSeed>[]): string {
  return makeRekordbox(
    join(mkdtempSync(join(tmpdir(), 'surco-verifyrb-')), 'rekordbox'),
    seeds.map((s, i) => ({
      id: String(100 + i),
      path: FROM,
      title: 'Title',
      artist: 'Artist',
      fileType: 12,
      cuesMs: thirteen,
      ...s,
    })),
  )
}

function write(path: string, sql: string, ...args: unknown[]) {
  const db = openRekordboxDb(path)
  if (!db) throw new Error('fixture did not open')
  db.prepare(sql).run(...args)
  db.close()
}

const analyse = (path: string, id: string) =>
  write(
    path,
    `UPDATE djmdContent SET AnalysisDataPath = ?, Analysed = 105 WHERE ID = ?`,
    `/PIONEER/USBANLZ/0a1/${id}/ANLZ0000.DAT`,
    id,
  )

const repoint = (path: string, id: string, to = TO, fileType = 11, size = SIZE) =>
  write(
    path,
    `UPDATE djmdContent SET FolderPath = ?, FileNameL = ?, FileType = ?, FileSize = ? WHERE ID = ?`,
    to,
    to.slice(to.lastIndexOf('/') + 1),
    fileType,
    size,
    id,
  )

const readOnly = (path: string) => {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('fixture did not open read-only')
  opened.push(db)
  return db
}

const snapshot = (path: string, from = FROM) => snapshotRekordboxRow(readOnly(path), from, find)

const expectFor = (
  before: RekordboxSnapshot | null,
  over: Partial<RekordboxExpect> = {},
): RekordboxExpect => ({
  from: FROM,
  to: TO,
  samplesKept: true,
  before,
  added: false,
  size: SIZE,
  ...over,
})

const checkOne = (path: string, e: RekordboxExpect) => checkRekordbox(readOnly(path), [e], find)

describe('snapshotRekordboxRow', () => {
  // The "before" is the only way to say the cues and the grid survived: read it from the
  // source's row before anything writes.
  it('reads the row id, its live cues and its analysis', () => {
    const db = collection([{}])
    analyse(db, '100')
    expect(snapshot(db)).toEqual({
      id: '100',
      cues: 13,
      analysisDataPath: '/PIONEER/USBANLZ/0a1/100/ANLZ0000.DAT',
      analysed: 105,
    })
  })

  it('a deleted cue does not count', () => {
    const db = collection([{}])
    write(db, `UPDATE djmdCue SET rb_local_deleted = 1 WHERE ID = '100-cue0'`)
    expect(snapshot(db)?.cues).toBe(12)
  })

  it('a file the collection does not have has no snapshot', () => {
    const db = collection([{}])
    expect(snapshot(db, '/Volumes/Music/Other.aiff')).toBeNull()
  })
})

describe('checkRekordbox', () => {
  // The 30/10 report: Surco said done while rekordbox had lost the analysis. Only a
  // re-read of the row after the flush can say "points at the WAV, cues and grid intact".
  it('a repointed row on the WAV with its 13 cues and analysis is ok with rekordboxOk', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    expect(checkOne(db, expectFor(before))).toEqual([
      {
        place: 'rekordbox',
        state: 'ok',
        detail: { key: 'rekordboxOk', params: { format: 'WAV', cues: 13 } },
      },
    ])
  })

  it('a row still on the AIFF is rekordboxStillOld with format AIFF', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    expect(checkOne(db, expectFor(before))).toEqual([
      {
        place: 'rekordbox',
        state: 'mismatch',
        detail: { key: 'rekordboxStillOld', params: { format: 'AIFF' } },
      },
    ])
  })

  it('a row on the new path with the old FileType is rekordboxStillOld', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100', TO, 12)
    expect(checkOne(db, expectFor(before))[0].detail).toEqual({
      key: 'rekordboxStillOld',
      params: { format: 'AIFF' },
    })
  })

  // Kept samples mean the old analysis still describes the audio; emptying it made
  // rekordbox redraw the grid and lose the beat it had.
  it('an emptied AnalysisDataPath on a sample-kept conversion is rekordboxAnalysisEmptied', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    write(db, `UPDATE djmdContent SET AnalysisDataPath = '', Analysed = 0 WHERE ID = '100'`)
    expect(checkOne(db, expectFor(before))[0]).toEqual({
      place: 'rekordbox',
      state: 'mismatch',
      detail: { key: 'rekordboxAnalysisEmptied' },
    })
  })

  it('an emptied AnalysisDataPath with Analysed untouched is rekordboxAnalysisEmptied', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    write(db, `UPDATE djmdContent SET AnalysisDataPath = '' WHERE ID = '100'`)
    expect(checkOne(db, expectFor(before))[0].detail.key).toBe('rekordboxAnalysisEmptied')
  })

  it('a reset Analysed flag on a sample-kept conversion is rekordboxAnalysisEmptied', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    write(db, `UPDATE djmdContent SET Analysed = 0 WHERE ID = '100'`)
    expect(checkOne(db, expectFor(before))[0].detail.key).toBe('rekordboxAnalysisEmptied')
  })

  // A re-encode moves the audio, so rekordbox must analyse it again: an empty analysis
  // is the intended state there, not a loss.
  it('an emptied AnalysisDataPath after a reencode is ok', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    write(db, `UPDATE djmdContent SET AnalysisDataPath = '', Analysed = 0 WHERE ID = '100'`)
    expect(checkOne(db, expectFor(before, { samplesKept: false }))[0].state).toBe('ok')
  })

  it('one cue fewer is rekordboxCuesLost 13 to 12', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    write(db, `DELETE FROM djmdCue WHERE ID = '100-cue5'`)
    expect(checkOne(db, expectFor(before))[0]).toEqual({
      place: 'rekordbox',
      state: 'mismatch',
      detail: { key: 'rekordboxCuesLost', params: { before: 13, after: 12 } },
    })
  })

  it('a cue more than before is rekordboxCuesChanged', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100')
    write(
      db,
      `INSERT INTO djmdCue (ID, ContentID, InMsec, Kind, rb_local_deleted) VALUES ('x', '100', 5, 0, 0)`,
    )
    expect(checkOne(db, expectFor(before))[0].detail).toEqual({
      key: 'rekordboxCuesChanged',
      params: { before: 13, after: 14 },
    })
  })

  it("a FileSize that is not the file's is rekordboxSizeDiffers", () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100', TO, 11, SIZE - 1)
    expect(checkOne(db, expectFor(before))[0]).toEqual({
      place: 'rekordbox',
      state: 'mismatch',
      detail: { key: 'rekordboxSizeDiffers' },
    })
  })

  // The user's collection has 35 files with two rows, most in playlists. Repointing one
  // leaves the other on the old file, so two rows can never read as done.
  it('two rows on one file is a mismatch, never ok', () => {
    const db = collection([{}, {}])
    analyse(db, '100')
    repoint(db, '100')
    repoint(db, '101')
    const before: RekordboxSnapshot = {
      id: '100',
      cues: 13,
      analysisDataPath: '/PIONEER/USBANLZ/0a1/100/ANLZ0000.DAT',
      analysed: 105,
    }
    expect(checkOne(db, expectFor(before))[0]).toEqual({
      place: 'rekordbox',
      state: 'mismatch',
      detail: { key: 'rekordboxAmbiguous', params: { count: 2 } },
    })
  })

  it('two rows still on the source file are a mismatch, never ok', () => {
    const db = collection([{}, {}])
    expect(snapshot(db)).toBeNull()
    expect(checkOne(db, expectFor(null))[0].detail).toEqual({
      key: 'rekordboxAmbiguous',
      params: { count: 2 },
    })
  })

  // macOS and SMB hand Surco NFD names; rekordbox keeps whatever it was given.
  it('an NFD FolderPath matches an NFC file', () => {
    const from = '/Volumes/Music/Artist/Café.aiff'.normalize('NFC')
    const to = '/Volumes/Music/Artist/Café.wav'.normalize('NFC')
    const db = collection([{ path: from.normalize('NFD') }])
    analyse(db, '100')
    const before = snapshot(db, from)
    expect(before?.id).toBe('100')
    repoint(db, '100', to.normalize('NFD'))
    expect(checkOne(db, expectFor(before, { from, to }))[0].state).toBe('ok')
  })

  it('a row on the ~/Music/Music spelling of the file is the same file', () => {
    const link = '/Users/dj/Music/Music'
    const options: FindOptions = {
      realPath: (p) => (p === link ? '/Volumes/Music' : p),
      homeMusicDir: link,
      quiet: true,
    }
    const db = collection([{ path: `${link}/Artist/Title.aiff` }])
    analyse(db, '100')
    const before = snapshotRekordboxRow(readOnly(db), FROM, options)
    repoint(db, '100', `${link}/Artist/Title.wav`)
    expect(checkRekordbox(readOnly(db), [expectFor(before)], options)[0].state).toBe('ok')
  })

  it('a row on neither file is rekordboxMissing', () => {
    const db = collection([{}])
    analyse(db, '100')
    const before = snapshot(db)
    repoint(db, '100', '/Volumes/Music/Elsewhere/Title.wav')
    expect(checkOne(db, expectFor(before))[0]).toEqual({
      place: 'rekordbox',
      state: 'mismatch',
      detail: { key: 'rekordboxMissing' },
    })
  })

  it('another row on the file than the one photographed is rekordboxOtherRow', () => {
    const db = collection([{}, { path: '/Volumes/Music/Other.aiff' }])
    analyse(db, '100')
    const before = snapshot(db)
    write(db, `DELETE FROM djmdContent WHERE ID = '100'`)
    repoint(db, '101')
    expect(checkOne(db, expectFor(before))[0].detail).toEqual({ key: 'rekordboxOtherRow' })
  })

  // Without the photo there is nothing to compare the cues and the grid against.
  it('a repoint with no snapshot is unreadable, never ok', () => {
    const db = collection([{}])
    repoint(db, '100')
    expect(checkOne(db, expectFor(null))[0]).toEqual({
      place: 'rekordbox',
      state: 'unreadable',
      detail: { key: 'rekordboxUnreadable' },
    })
  })

  it('an added row on the file is ok with its cues', () => {
    const db = collection([{ path: TO, fileType: 11, cuesMs: [] }])
    write(db, `UPDATE djmdContent SET FileSize = ? WHERE ID = '100'`, SIZE)
    expect(checkOne(db, expectFor(null, { added: true }))[0]).toEqual({
      place: 'rekordbox',
      state: 'ok',
      detail: { key: 'rekordboxOk', params: { format: 'WAV', cues: 0 } },
    })
  })

  it('a database that fails to read is unreadable', () => {
    const db = collection([{}])
    const handle = readOnly(db)
    handle.close()
    expect(checkRekordbox(handle, [expectFor(null, { added: true })], find)).toEqual([
      { place: 'rekordbox', state: 'unreadable', detail: { key: 'rekordboxUnreadable' } },
    ])
  })

  it('judges every track of the batch in order', () => {
    const db = collection([{}, { path: '/Volumes/Music/B.aiff' }])
    analyse(db, '100')
    analyse(db, '101')
    const a = snapshot(db)
    const b = snapshot(db, '/Volumes/Music/B.aiff')
    repoint(db, '100')
    const states = checkRekordbox(
      readOnly(db),
      [expectFor(a), expectFor(b, { from: '/Volumes/Music/B.aiff', to: '/Volumes/Music/B.wav' })],
      find,
    ).map((c) => c.detail.key)
    expect(states).toEqual(['rekordboxOk', 'rekordboxStillOld'])
  })

  // The check runs against the user's live collection: reading it must never change a byte.
  it('the database opens read-only', () => {
    const db = collection([{}])
    analyse(db, '100')
    const sha = () => createHash('sha1').update(readFileSync(db)).digest('hex')
    const before = snapshot(db)
    repoint(db, '100')
    const was = { sha: sha(), mtime: statSync(db).mtimeMs }
    const handle = readOnly(db)
    expect(handle.readonly).toBe(true)
    expect(checkRekordbox(handle, [expectFor(before)], find)[0].state).toBe('ok')
    expect(snapshotRekordboxRow(handle, TO, find)?.id).toBe('100')
    handle.close()
    expect({ sha: sha(), mtime: statSync(db).mtimeMs }).toEqual(was)
    expect(rekordboxRow(db, '100').cuesMs).toHaveLength(13)
  })
})
