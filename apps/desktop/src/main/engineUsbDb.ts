import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import type { EngineDb } from './enginePlaylists'

export function createEngineUsbDb(desktop: EngineDb): Database.Database {
  const usb = new Database(':memory:')
  const statements = desktop
    .prepare(
      `SELECT sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid`,
    )
    .pluck()
    .all() as string[]
  for (const sql of statements) usb.exec(sql)
  usb.pragma(`user_version = ${Number(desktop.pragma('user_version', { simple: true }))}`)
  const info = desktop
    .prepare('SELECT * FROM Information ORDER BY id LIMIT 1')
    .safeIntegers()
    .get() as Record<string, unknown>
  const columns = Object.keys(info).filter((c) => c !== 'id' && c !== 'uuid')
  usb
    .prepare(
      `INSERT INTO Information (uuid, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
    )
    .run(randomUUID(), ...columns.map((c) => info[c]))
  return usb
}
