import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import {
  addToPlaylist,
  EditRefused,
  editProblem,
  insertSeparator,
  moveInPlaylist,
  removeFromPlaylist,
  resolveTracks,
  separatorContent,
} from './rekordboxPlaylistEdit'
import {
  FIXTURE_STAMP,
  ORGANISE_FIXTURE,
  type PlaylistFixture,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'

const NOW = new Date('2026-10-15T18:00:00.000Z')
const STAMP = '2026-10-15 18:00:00.000 +00:00'
const ctx = { now: NOW }

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>
let db: Db

async function openFixture(fixture: PlaylistFixture = ORGANISE_FIXTURE): Promise<Db> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbedit-')), 'master.db')
  writeRekordboxPlaylistFixture(path, fixture)
  const opened = openRekordboxDb(path)
  if (!opened) throw new Error('fixture did not open')
  return opened
}

beforeEach(async () => {
  db = await openFixture()
})
afterEach(() => db.close())

interface Row {
  ID: string
  ContentID: string
  TrackNo: number
  usn: number
  updated_at: string
}

function rows(playlistId: string): Row[] {
  return db
    .prepare(
      `SELECT ID, ContentID, TrackNo, rb_local_usn AS usn, updated_at FROM djmdSongPlaylist
        WHERE PlaylistID = ? ORDER BY TrackNo`,
    )
    .all(playlistId) as Row[]
}

const ids = (playlistId: string): string[] => rows(playlistId).map((r) => r.ID)
const contents = (playlistId: string): string[] => rows(playlistId).map((r) => r.ContentID)
const trackNos = (playlistId: string): number[] => rows(playlistId).map((r) => r.TrackNo)
const counter = (): number =>
  (
    db.prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`).get() as {
      int_1: number
    }
  ).int_1

describe('resolveTracks', () => {
  // The user's music is reached through ~/Music/Music, a symlink to the volume rekordbox
  // also stored directly: a track Surco loaded through one spelling must still be found.
  it('finds a track by path through the symlinked music folder', () => {
    expect(resolveTracks(db, [{ paths: ['/Users/dj/Music/Music/Gowan.wav'] }], TWIN_PATHS)).toEqual(
      { contentIds: ['103'], notInCollection: 0, ambiguous: 0 },
    )
  })

  // Two collection rows for one file differ in size and in the playlists they sit in;
  // choosing one would be a guess about the user's library, so neither is added.
  it('refuses to guess between the two rows of a symlinked twin', () => {
    expect(resolveTracks(db, [{ paths: ['/Volumes/Public/Music/Ekkah.wav'] }], TWIN_PATHS)).toEqual(
      { contentIds: [], notInCollection: 0, ambiguous: 1 },
    )
  })

  // A row copied from an open rekordbox playlist names its exact entry: copying a twin from
  // one playlist to another is not a guess.
  it('takes the entry a playlist row already names, twin or not', () => {
    expect(
      resolveTracks(
        db,
        [{ contentId: '201', paths: ['/Volumes/Public/Music/Ekkah.wav'] }],
        TWIN_PATHS,
      ).contentIds,
    ).toEqual(['201'])
  })

  // Giving rekordbox a track it does not know means creating its entry, with an analysis
  // still to run: not this phase.
  it('counts a track the collection does not have', () => {
    expect(resolveTracks(db, [{ paths: ['/Volumes/Public/Music/new.wav'] }], TWIN_PATHS)).toEqual({
      contentIds: [],
      notInCollection: 1,
      ambiguous: 0,
    })
  })

  it('never takes the separator file as a track', () => {
    expect(resolveTracks(db, [{ contentId: '109', paths: [] }], TWIN_PATHS).notInCollection).toBe(1)
  })

  // A conversion that wrote elsewhere moves the collection entry to the new file, so the
  // source path no longer finds it but the converted one does.
  it('finds a converted track by its output when the source is not in the collection', () => {
    expect(
      resolveTracks(
        db,
        [{ paths: ['/Volumes/Public/Music/Gowan.mp3', '/Volumes/Public/Music/Gowan.wav'] }],
        TWIN_PATHS,
      ).contentIds,
    ).toEqual(['103'])
  })

  it('adds a track named twice only once', () => {
    expect(
      resolveTracks(
        db,
        [{ paths: ['/Volumes/Public/Music/Gowan.wav'] }, { contentId: '103', paths: [] }],
        TWIN_PATHS,
      ).contentIds,
    ).toEqual(['103'])
  })
})

describe('addToPlaylist', () => {
  // rekordbox appends a dropped track at the end of the playlist and keeps TrackNo 1..N,
  // which is what the measured collection shows in every playlist.
  it('appends the tracks in the order given, numbered on from the last row', () => {
    expect(addToPlaylist(db, '3000', ['103', '101'], ctx)).toEqual({ added: 2, already: 0 })
    expect(contents('3000')).toEqual(['102', '110', '103', '101'])
    expect(trackNos('3000')).toEqual([1, 2, 3, 4])
  })

  // The list shows each file once; a second link would be a row the user can never see.
  it('skips a track the playlist already holds', () => {
    expect(addToPlaylist(db, '3000', ['102'], ctx)).toEqual({ added: 0, already: 1 })
    expect(contents('3000')).toEqual(['102', '110'])
  })

  // A row rekordbox cannot tell from its own: UUID ids, the next change number, now.
  it('writes the new row the way rekordbox writes one', () => {
    addToPlaylist(db, '3000', ['103'], ctx)
    const row = db
      .prepare(`SELECT * FROM djmdSongPlaylist WHERE PlaylistID = '3000' AND ContentID = '103'`)
      .get() as Record<string, unknown>
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(row.ID).toMatch(uuid)
    expect(row.UUID).toMatch(uuid)
    expect(row).toMatchObject({
      TrackNo: 3,
      rb_local_usn: 501,
      rb_local_deleted: 0,
      rb_local_synced: 0,
      usn: null,
      created_at: STAMP,
      updated_at: STAMP,
    })
    expect(counter()).toBe(501)
  })

  it('refuses a folder as a playlist, so tracks never hang off a folder', () => {
    expect(() => addToPlaylist(db, '1000', ['103'], ctx)).toThrow(EditRefused)
  })
})

describe('removeFromPlaylist', () => {
  // The list shows a track once; removing that row must take every link of the track, or
  // the hidden one brings the row straight back on the re-read.
  it('removes every occurrence of the track the row stands for', () => {
    expect(removeFromPlaylist(db, '2000', ['f3'], ctx)).toBe(2)
    expect(contents('2000')).toEqual(['101', '109', '201', '109', '104'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5])
  })

  // A separator is placed by hand; removing one break must leave the others.
  it('removes a separator by its own row only', () => {
    removeFromPlaylist(db, '2000', ['f2'], ctx)
    expect(ids('2000')).toEqual(['f1', 'f3', 'f4', 'f5', 'f6', 'f7'])
  })

  it('never touches the collection entries themselves', () => {
    const before = db.prepare('SELECT count(*) AS n FROM djmdContent').get()
    removeFromPlaylist(db, '2000', ['f1', 'f2'], ctx)
    expect(db.prepare('SELECT count(*) AS n FROM djmdContent').get()).toEqual(before)
  })

  it('refuses a row that is no longer there', () => {
    expect(() => removeFromPlaylist(db, '2000', ['gone'], ctx)).toThrow(EditRefused)
    expect(ids('2000')).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
  })
})

describe('moveInPlaylist', () => {
  it('moves rows before the row they were dropped on', () => {
    moveInPlaylist(db, '2000', ['f6'], 'f1', ctx)
    expect(ids('2000')).toEqual(['f6', 'f1', 'f2', 'f3', 'f4', 'f5', 'f7'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('moves rows to the end when dropped after the last one', () => {
    moveInPlaylist(db, '2000', ['f1'], null, ctx)
    expect(ids('2000')).toEqual(['f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f1'])
  })

  // Separators move like rows, and two of them may end up side by side.
  it('moves a separator next to another one', () => {
    moveInPlaylist(db, '2000', ['f5'], 'f3', ctx)
    expect(ids('2000')).toEqual(['f1', 'f2', 'f5', 'f3', 'f4', 'f6', 'f7'])
  })

  // Rows Surco does not show (a missing file, the hidden duplicate) are still in the
  // playlist; a move must leave them where they were relative to each other.
  it('keeps the rows it was not asked to move in their order', () => {
    moveInPlaylist(db, '2000', ['f2', 'f6'], 'f1', ctx)
    expect(ids('2000')).toEqual(['f2', 'f6', 'f1', 'f3', 'f4', 'f5', 'f7'])
  })

  // Measured on the real collection: a reorder stamps every moved row with one change
  // number. Rows whose place did not change keep theirs.
  it('stamps the rows whose place changed with one change number', () => {
    moveInPlaylist(db, '2000', ['f6'], 'f4', ctx)
    const byId = Object.fromEntries(rows('2000').map((r) => [r.ID, r]))
    expect([byId.f6.usn, byId.f4.usn, byId.f5.usn]).toEqual([501, 501, 501])
    expect(byId.f6.updated_at).toBe(STAMP)
    expect(byId.f1).toMatchObject({ usn: 1, updated_at: FIXTURE_STAMP })
    expect(counter()).toBe(501)
  })

  it('writes nothing for a drop onto the row being moved', () => {
    moveInPlaylist(db, '2000', ['f3'], 'f3', ctx)
    expect(ids('2000')).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
    expect(counter()).toBe(500)
  })

  it('refuses a target row that is gone', () => {
    expect(() => moveInPlaylist(db, '2000', ['f1'], 'gone', ctx)).toThrow(EditRefused)
  })
})

describe('insertSeparator', () => {
  // Above a row that already has a separator over it, the new one goes right above the
  // row: two breaks side by side, both kept.
  it('puts the collection separator right above the row, even next to another', () => {
    insertSeparator(db, '2000', 'f6', ctx)
    expect(contents('2000')).toEqual(['101', '109', '102', '201', '109', '109', '104', '102'])
    expect(trackNos('2000')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  // The user's collection has one separator linked 345 times; another blank file used once
  // is more likely a stray than the DJ's separator.
  it('uses the separator the collection links most', () => {
    insertSeparator(db, '3000', 'h1', ctx)
    expect(contents('3000')).toEqual(['109', '102', '110'])
  })

  it('refuses when the collection has no separator to copy', async () => {
    db.close()
    db = await openFixture({
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.filter((c) => c.ID !== '109' && c.ID !== '110'),
      links: ORGANISE_FIXTURE.links.filter((l) => l.ContentID !== '109' && l.ContentID !== '110'),
    })
    expect(separatorContent(db)).toBeNull()
    expect(() => insertSeparator(db, '2000', 'f1', ctx)).toThrow(EditRefused)
  })
})

describe('editProblem', () => {
  // Checked before rekordbox is asked to close: an edit that cannot apply must not cost
  // the user a closed rekordbox.
  it('flags a row or a playlist that is gone', () => {
    expect(
      editProblem(db, { kind: 'move', playlistId: '2000', linkIds: ['gone'], beforeLinkId: null }),
    ).toBe('stale')
    expect(editProblem(db, { kind: 'remove', playlistId: '1000', linkIds: ['f1'] })).toBe('stale')
    expect(editProblem(db, { kind: 'create', parentId: '3000', name: 'x', folder: false })).toBe(
      'stale',
    )
  })

  it('passes an edit that can apply', () => {
    expect(
      editProblem(db, { kind: 'move', playlistId: '2000', linkIds: ['f6'], beforeLinkId: 'f1' }),
    ).toBeNull()
    expect(
      editProblem(db, { kind: 'create', parentId: 'root', name: 'x', folder: true }),
    ).toBeNull()
    expect(
      editProblem(db, { kind: 'insertSeparator', playlistId: '2000', beforeLinkId: 'f1' }),
    ).toBeNull()
  })

  // Without a separator to copy, asking rekordbox to close would cost the user for nothing.
  it('flags a separator insert when the collection has none to copy', async () => {
    db.close()
    db = await openFixture({
      ...ORGANISE_FIXTURE,
      content: ORGANISE_FIXTURE.content.filter((c) => c.ID !== '109' && c.ID !== '110'),
      links: ORGANISE_FIXTURE.links.filter((l) => l.ContentID !== '109' && l.ContentID !== '110'),
    })
    expect(
      editProblem(db, { kind: 'insertSeparator', playlistId: '2000', beforeLinkId: 'f1' }),
    ).toBe('no-separator')
  })
})
