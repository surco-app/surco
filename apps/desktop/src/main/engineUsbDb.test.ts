import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { createEngineUsbDb } from './engineUsbDb'

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
