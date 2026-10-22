import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { analysedTrack } from './enginePerformanceFixture'
import { createEngineUsbDb, putEngineUsbTracks } from './engineUsbDb'

const DESKTOP_UUID = 'desktop-uuid'
const ENGINE_4_USER_VERSION = 4194305

function desktopDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(ENGINE_3_SCHEMA)
  db.pragma(`user_version = ${ENGINE_4_USER_VERSION}`)
  db.prepare(
    `INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch,
      currentPlayedIndiciator) VALUES (?, 3, 0, 2, 6751382725677446100)`,
  ).run(DESKTOP_UUID)
  return db
}

const HASH_A = Buffer.from('b7a057ad5c5b65167845a8ca06a198f55a4a9fe2', 'hex')

function addDesktopTrack(
  db: Database.Database,
  t: { id: number; title: string; path: string; albumArtId?: number | null },
): void {
  db.prepare(
    `INSERT INTO Track (id, path, filename, title, artist, length, bpmAnalyzed, key, rating,
      fileBytes, fileType, isAnalyzed, albumArtId, dateAdded, lastEditTime, playedIndicator,
      originDatabaseUuid, originTrackId)
     VALUES (?, ?, ?, ?, 'Artist', 256, 124.5, 7, 80, 1000, 'aiff', 1, ?, 1790098586,
      1791205141, 6751382725677446100, ?, ?)`,
  ).run(t.id, t.path, t.path.split('/').pop(), t.title, t.albumArtId ?? null, DESKTOP_UUID, t.id)
  const perf = analysedTrack(t.id, [{ label: 'Drop', sample: 44100, argb: 0xff0000ff }])
  db.prepare(
    `UPDATE PerformanceData SET trackData = ?, beatData = ?, quickCues = ?,
      overviewWaveFormData = ?, loops = ?, thirdPartySourceId = 3, activeOnLoadLoops = 2
      WHERE trackId = ?`,
  ).run(
    perf.trackData,
    perf.beatData,
    perf.quickCues,
    perf.overviewWaveFormData,
    Buffer.from([9, 9, 9]),
    t.id,
  )
}

function desktopWithTracks(): Database.Database {
  const db = desktopDb()
  db.prepare('INSERT INTO AlbumArt (id, hash, albumArt) VALUES (1, ?, NULL)').run(HASH_A)
  addDesktopTrack(db, { id: 1, title: 'Surrender', path: '../Music/Lasgo/Surrender.aiff' })
  addDesktopTrack(db, {
    id: 2,
    title: 'Inside of me',
    path: '../Music/Glen/Inside.aiff',
    albumArtId: 1,
  })
  addDesktopTrack(db, { id: 3, title: 'Bongo', path: '../Music/Safri/Bongo.aiff', albumArtId: 1 })
  return db
}

const row = (db: Database.Database, sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .safeIntegers()
    .get(...args) as Record<string, unknown>

const schemaOf = (db: Database.Database) =>
  db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid').all()

describe('createEngineUsbDb', () => {
  it('repeats every table, index, trigger and view of the desktop library in its order, so the player reads the USB with the schema of the Engine DJ that made it', () => {
    const desktop = desktopDb()
    const usb = createEngineUsbDb(desktop)
    expect(schemaOf(usb)).toEqual(schemaOf(desktop))
    expect(usb.pragma('user_version', { simple: true })).toBe(ENGINE_4_USER_VERSION)
  })

  it('gives the USB library a uuid of its own with the desktop schema version, because Engine tells libraries apart by that uuid', () => {
    const usb = createEngineUsbDb(desktopDb())
    const info = usb.prepare('SELECT * FROM Information').safeIntegers().all() as Record<
      string,
      unknown
    >[]
    expect(info).toHaveLength(1)
    expect(info[0]).toMatchObject({
      schemaVersionMajor: 3n,
      schemaVersionMinor: 0n,
      schemaVersionPatch: 2n,
      currentPlayedIndiciator: 6751382725677446100n,
    })
    expect(info[0].uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(info[0].uuid).not.toBe(DESKTOP_UUID)
  })

  it('starts with no tracks or playlists, so the USB carries only what is exported', () => {
    const usb = createEngineUsbDb(desktopDb())
    for (const table of ['Track', 'PerformanceData', 'AlbumArt', 'Playlist', 'PlaylistEntity'])
      expect(usb.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
  })
})

describe('putEngineUsbTracks', () => {
  it('copies the desktop row with the path, file name and size of the copy on the USB, so the player finds the file and keeps every tag Engine had', () => {
    const desktop = desktopWithTracks()
    const usb = createEngineUsbDb(desktop)
    const ids = putEngineUsbTracks(usb, desktop, [
      { desktopId: 2, path: 'Music/Inside (2).aiff', fileBytes: 1234 },
    ])
    const usbId = ids.get(2)
    const copied = row(usb, 'SELECT * FROM Track WHERE id = ?', usbId)
    const source = row(desktop, 'SELECT * FROM Track WHERE id = 2')
    const { id: _a, path: _b, filename: _c, fileBytes: _d, albumArtId: _e, ...same } = source
    expect(copied).toMatchObject(same)
    expect(copied).toMatchObject({
      path: 'Music/Inside (2).aiff',
      filename: 'Inside (2).aiff',
      fileBytes: 1234n,
    })
  })

  it('points the copy back at the desktop track by uuid and id, which is how Engine links a USB track to the one in the collection', () => {
    const desktop = desktopWithTracks()
    const usb = createEngineUsbDb(desktop)
    const ids = putEngineUsbTracks(usb, desktop, [
      { desktopId: 3, path: 'Music/Bongo.aiff', fileBytes: 1 },
    ])
    expect(row(usb, 'SELECT * FROM Track WHERE id = ?', ids.get(3))).toMatchObject({
      originDatabaseUuid: DESKTOP_UUID,
      originTrackId: 3n,
    })
  })

  it('carries the analysis byte for byte, so the player does not analyse again and keeps the cues, grid and waveform', () => {
    const desktop = desktopWithTracks()
    const usb = createEngineUsbDb(desktop)
    const ids = putEngineUsbTracks(usb, desktop, [
      { desktopId: 1, path: 'Music/Surrender.aiff', fileBytes: 1 },
    ])
    const { trackId: _u, ...copied } = row(
      usb,
      'SELECT * FROM PerformanceData WHERE trackId = ?',
      ids.get(1),
    )
    const { trackId: _d, ...source } = row(
      desktop,
      'SELECT * FROM PerformanceData WHERE trackId = 1',
    )
    expect(copied).toEqual(source)
    expect(usb.prepare('SELECT count(*) AS n FROM PerformanceData').get()).toEqual({ n: 1 })
  })

  it('stores a cover two tracks share once, with its hash intact, because the hash names the image file Engine looks for', () => {
    const desktop = desktopWithTracks()
    const usb = createEngineUsbDb(desktop)
    const ids = putEngineUsbTracks(usb, desktop, [
      { desktopId: 1, path: 'Music/Surrender.aiff', fileBytes: 1 },
      { desktopId: 2, path: 'Music/Inside.aiff', fileBytes: 1 },
      { desktopId: 3, path: 'Music/Bongo.aiff', fileBytes: 1 },
    ])
    const art = usb.prepare('SELECT * FROM AlbumArt').all() as { id: number; hash: Buffer }[]
    expect(art).toHaveLength(1)
    expect(Buffer.compare(art[0].hash, HASH_A)).toBe(0)
    const artOf = (id: number | undefined) =>
      (usb.prepare('SELECT albumArtId FROM Track WHERE id = ?').get(id) as { albumArtId: number })
        .albumArtId
    expect(artOf(ids.get(1))).toBeNull()
    expect(artOf(ids.get(2))).toBe(art[0].id)
    expect(artOf(ids.get(3))).toBe(art[0].id)
  })

  it('updates the copy already on the USB instead of adding a second one, since the same desktop track twice would show twice on the player', () => {
    const desktop = desktopWithTracks()
    const usb = createEngineUsbDb(desktop)
    const first = putEngineUsbTracks(usb, desktop, [
      { desktopId: 1, path: 'Music/Surrender.aiff', fileBytes: 1 },
    ])
    desktop.prepare("UPDATE Track SET title = 'Surrender (Edit)' WHERE id = 1").run()
    desktop.prepare('UPDATE PerformanceData SET loops = ? WHERE trackId = 1').run(Buffer.from([7]))
    desktop.prepare('UPDATE Track SET lastEditTime = 1791300000 WHERE id = 1').run()
    const again = putEngineUsbTracks(usb, desktop, [
      { desktopId: 1, path: 'Music/Surrender.aiff', fileBytes: 2 },
    ])
    expect(again.get(1)).toBe(first.get(1))
    expect(usb.prepare('SELECT count(*) AS n FROM Track').get()).toEqual({ n: 1 })
    expect(row(usb, 'SELECT * FROM Track WHERE id = ?', first.get(1))).toMatchObject({
      title: 'Surrender (Edit)',
      fileBytes: 2n,
      lastEditTime: 1791300000n,
    })
    expect(row(usb, 'SELECT loops FROM PerformanceData WHERE trackId = ?', first.get(1))).toEqual({
      loops: Buffer.from([7]),
    })
  })
})
