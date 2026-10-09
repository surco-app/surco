import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import type { TrackMetadata } from '../shared/types'
import { applyRekordboxMeta, rekordboxMetaFrom } from './rekordboxMetadata'

type Db = InstanceType<typeof Database>

const NOW = new Date('2026-10-06T18:00:00.123Z')
const ROW = '147667868'

const LOOKUP_COLUMNS = `UUID VARCHAR(255), rb_data_status INTEGER, rb_local_data_status INTEGER,
  rb_local_deleted TINYINT(1), rb_local_synced TINYINT(1), usn BIGINT, rb_local_usn BIGINT,
  created_at DATETIME, updated_at DATETIME`

let db: Db
let ids: string[]

function makeDb(): Db {
  const d = new Database(':memory:')
  d.exec(`CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, Title VARCHAR(255),
    ArtistID VARCHAR(255), AlbumID VARCHAR(255), GenreID VARCHAR(255), LabelID VARCHAR(255),
    RemixerID VARCHAR(255), Commnt TEXT, ReleaseYear INTEGER, TrackNo INTEGER, DiscNo INTEGER,
    BPM INTEGER, KeyID VARCHAR(255), Rating INTEGER, ImagePath VARCHAR(255),
    usn BIGINT, rb_local_usn BIGINT, updated_at DATETIME)`)
  d.exec(`CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
    SearchStr VARCHAR(255), ${LOOKUP_COLUMNS})`)
  d.exec(`CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
    AlbumArtistID VARCHAR(255), ImagePath VARCHAR(255), Compilation INTEGER,
    SearchStr VARCHAR(255), ${LOOKUP_COLUMNS})`)
  d.exec(
    `CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP_COLUMNS})`,
  )
  d.exec(
    `CREATE TABLE djmdLabel (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP_COLUMNS})`,
  )
  d.exec(`CREATE TABLE agentRegistry (registry_id VARCHAR(255), int_1 BIGINT, updated_at DATETIME)`)
  d.prepare(`INSERT INTO agentRegistry VALUES ('localUpdateCount', 565849, NULL)`).run()
  d.prepare(
    `INSERT INTO djmdArtist (ID, Name, rb_local_deleted) VALUES ('508225883', 'Ultra Naté', 0)`,
  ).run()
  d.prepare(
    `INSERT INTO djmdGenre (ID, Name, rb_local_deleted) VALUES ('387548602', 'Trance', 0)`,
  ).run()
  d.prepare(
    `INSERT INTO djmdContent (ID, Title, ArtistID, GenreID, Commnt, ReleaseYear, TrackNo, BPM,
       KeyID, Rating, ImagePath, rb_local_usn)
     VALUES (?, 'My rules', '508225883', '387548602', 'old comment', 2019, 0, 14500, '3898747008',
       3, '/PIONEER/Artwork/52c/artwork.jpg', 565845)`,
  ).run(ROW)
  return d
}

function row(): Record<string, unknown> {
  return db.prepare('SELECT * FROM djmdContent WHERE ID = ?').get(ROW) as Record<string, unknown>
}

function apply(meta: Partial<TrackMetadata>): void {
  applyRekordboxMeta(db, ROW, rekordboxMetaFrom({ ...emptyMetadata(), ...meta }), {
    now: NOW,
    newId: () => ids.shift() as string,
  })
}

beforeEach(() => {
  db = makeDb()
  ids = ['111', '222', '333', '444', '555']
})

// rekordbox shows what its own collection says, never what the file's tags say: a title
// fixed in Surco stayed wrong in rekordbox until the user reloaded tags there by hand.
describe('applyRekordboxMeta', () => {
  it('writes the text and number fields onto the collection entry', () => {
    apply({
      title: 'My Rules (Original Mix)',
      comment: 'from Surco',
      year: '2026',
      trackNumber: '4',
      discNumber: '2',
    })
    expect(row()).toMatchObject({
      Title: 'My Rules (Original Mix)',
      Commnt: 'from Surco',
      ReleaseYear: 2026,
      TrackNo: 4,
      DiscNo: 2,
    })
  })

  // A second "Ultra Naté" row would split the artist in rekordbox's browser into two
  // entries, each listing half of the tracks.
  it('reuses the artist rekordbox already has under that name', () => {
    apply({ artist: 'Ultra Naté' })
    expect(row().ArtistID).toBe('508225883')
    expect(db.prepare('SELECT count(*) n FROM djmdArtist').get()).toEqual({ n: 1 })
  })

  it('matches an existing name regardless of case', () => {
    apply({ artist: 'ULTRA NATÉ', genre: 'trance' })
    expect(row()).toMatchObject({ ArtistID: '508225883', GenreID: '387548602' })
  })

  // New rows are stamped the way rekordbox stamps its own: a UUID, the next local update
  // number, and the counter moved on so rekordbox never hands that number out again.
  it('creates a missing artist the way rekordbox creates one', () => {
    apply({ artist: 'B.F.I.' })
    const artist = db.prepare(`SELECT * FROM djmdArtist WHERE Name = 'B.F.I.'`).get() as Record<
      string,
      unknown
    >
    expect(artist).toMatchObject({
      ID: '111',
      rb_local_deleted: 0,
      rb_local_synced: 0,
      rb_data_status: 0,
      rb_local_data_status: 0,
    })
    expect(artist.UUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(artist.created_at).toBe('2026-10-06 18:00:00.123 +00:00')
    expect(row().ArtistID).toBe('111')
    const counter = db
      .prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`)
      .get() as { int_1: number }
    expect(Number(artist.rb_local_usn)).toBeGreaterThan(565849)
    expect(counter.int_1).toBeGreaterThanOrEqual(Number(artist.rb_local_usn))
  })

  it('marks the entry itself as changed', () => {
    apply({ title: 'My Rules' })
    expect(Number(row().rb_local_usn)).toBeGreaterThan(565849)
    expect(row().updated_at).toBe('2026-10-06 18:00:00.123 +00:00')
  })

  // Surco often has a field empty that rekordbox has filled (a genre set in rekordbox, a
  // comment typed at the decks). Syncing must not erase it.
  it('leaves a field alone when Surco has nothing for it', () => {
    apply({ title: 'My Rules' })
    expect(row()).toMatchObject({
      ArtistID: '508225883',
      GenreID: '387548602',
      Commnt: 'old comment',
      ReleaseYear: 2019,
    })
  })

  // BPM, key, rating and artwork belong to rekordbox's analysis and its own editor: the
  // beatgrid and the cues are built on that BPM.
  it('never touches BPM, key, rating or artwork', () => {
    apply({
      title: 'My Rules',
      artist: 'B.F.I.',
      album: 'Free',
      genre: 'Hard Trance',
      publisher: 'Tidy Trax',
      year: '2026',
      trackNumber: '4',
      bpm: '128',
      key: 'Am',
      rating: '5',
    })
    expect(row()).toMatchObject({
      BPM: 14500,
      KeyID: '3898747008',
      Rating: 3,
      ImagePath: '/PIONEER/Artwork/52c/artwork.jpg',
    })
  })

  it('points the entry at new artwork when it is given one', () => {
    applyRekordboxMeta(db, ROW, rekordboxMetaFrom(emptyMetadata()), {
      now: NOW,
      imagePath: '/PIONEER/Artwork/992/bdc59/artwork.jpg',
    })
    expect(row()).toMatchObject({
      ImagePath: '/PIONEER/Artwork/992/bdc59/artwork.jpg',
      updated_at: '2026-10-06 18:00:00.123 +00:00',
    })
  })

  it('reads the year out of a full release date', () => {
    apply({ year: '2020-12-01' })
    expect(row().ReleaseYear).toBe(2020)
  })

  // Vinyl positions (A1, B2) are track numbers in the tags but not numbers rekordbox can
  // hold; writing 0 would wipe the one it has.
  it('leaves the track number alone when it is not a number', () => {
    db.prepare('UPDATE djmdContent SET TrackNo = 7 WHERE ID = ?').run(ROW)
    apply({ trackNumber: 'A1' })
    expect(row().TrackNo).toBe(7)
  })

  it('takes the track number out of a "3/12" pair', () => {
    apply({ trackNumber: '3/12' })
    expect(row().TrackNo).toBe(3)
  })

  it('files genre, label and remixer under their own lists', () => {
    apply({ genre: 'Hard Trance', publisher: 'Tidy Trax', remixArtist: 'Lisa Lashes' })
    const genre = db.prepare(`SELECT ID FROM djmdGenre WHERE Name = 'Hard Trance'`).get()
    const label = db.prepare(`SELECT ID FROM djmdLabel WHERE Name = 'Tidy Trax'`).get()
    const remixer = db.prepare(`SELECT ID FROM djmdArtist WHERE Name = 'Lisa Lashes'`).get()
    expect(row()).toMatchObject({
      GenreID: (genre as { ID: string }).ID,
      LabelID: (label as { ID: string }).ID,
      RemixerID: (remixer as { ID: string }).ID,
    })
  })

  // Two different records can share a title ("Greatest Hits"); rekordbox keeps them apart
  // by album artist, so matching on the name alone would merge them.
  it('keeps albums with the same name apart by album artist', () => {
    apply({ album: 'Greatest Hits', albumArtist: 'Ultra Naté' })
    const first = row().AlbumID
    apply({ album: 'Greatest Hits', albumArtist: 'B.F.I.' })
    expect(row().AlbumID).not.toBe(first)
    apply({ album: 'Greatest Hits', albumArtist: 'Ultra Naté' })
    expect(row().AlbumID).toBe(first)
  })

  it('files the album under the track artist when it has no album artist', () => {
    apply({ artist: 'Ultra Naté', album: 'Free' })
    const album = db.prepare(`SELECT AlbumArtistID FROM djmdAlbum WHERE Name = 'Free'`).get()
    expect(album).toEqual({ AlbumArtistID: '508225883' })
  })

  it('skips an id rekordbox already uses', () => {
    ids = ['508225883', '999']
    apply({ artist: 'B.F.I.' })
    expect(row().ArtistID).toBe('999')
  })

  // A row rekordbox marked deleted is gone from its library; reusing it would point the
  // track at an artist rekordbox does not show.
  it('does not reuse a deleted artist', () => {
    db.prepare(`UPDATE djmdArtist SET rb_local_deleted = 1`).run()
    apply({ artist: 'Ultra Naté' })
    expect(row().ArtistID).toBe('111')
  })
})
