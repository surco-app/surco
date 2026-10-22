import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it, vi } from 'vitest'
import type { UsbExportEvent, UsbExportRequest, UsbVolume } from '../shared/types'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { chainOrder, readEngineTree } from './enginePlaylists'
import {
  createEngineUsbExporter,
  ENGINE_USB_QUIT_DETAIL,
  type EngineUsbExporterDeps,
  engineLibraryHolder,
} from './engineUsbExport'
import { createMenuT } from './i18n'
import { createUsbMemory } from './usbExportMemory'

const UUID = 'B10C96EF-51C2-344E-B78D-DAFC319D973E'
const HASH = Buffer.from('f8a7dcaa49e456914f24038b5a9f36c5fcf921b7', 'hex')
const COVER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

interface DesktopTrack {
  id: number
  title: string
  path: string | null
  bytes?: number
  art?: boolean
}

const TRACKS: DesktopTrack[] = [
  { id: 1, title: 'Night Train', path: '../Tracks/night.aiff', bytes: 3000, art: true },
  { id: 2, title: 'Play', path: '../Tracks/play.mp3', bytes: 2000 },
  { id: 3, title: 'Gone', path: '../Tracks/gone.flac' },
  { id: 4, title: 'Streamed', path: null },
  { id: 5, title: 'Play again', path: '../Other/Play.MP3', bytes: 1000 },
  { id: 6, title: 'What', path: '../Tracks/What?.aiff', bytes: 500 },
]

const LISTS: { id: number; title: string; parent: number; tracks: number[] }[] = [
  { id: 1, title: 'Warm up', parent: 0, tracks: [2, 1, 3, 4] },
  { id: 2, title: 'Sets', parent: 0, tracks: [] },
  { id: 3, title: 'Peak', parent: 2, tracks: [1] },
  { id: 4, title: 'Dupes', parent: 0, tracks: [2, 5, 6] },
]

async function desktopLibrary(home: string): Promise<string> {
  const dir = join(home, 'Music', 'Engine Library')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  await mkdir(join(dir, 'Artwork'), { recursive: true })
  await writeFile(join(dir, 'Artwork', `${HASH.toString('base64url')}.jpg`), COVER)
  const db = new Database(join(dir, 'Database2', 'm.db'))
  db.exec(ENGINE_3_SCHEMA)
  db.pragma('user_version = 4194305')
  db.prepare(
    `INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch)
     VALUES ('desktop-uuid', 3, 0, 2)`,
  ).run()
  db.prepare('INSERT INTO AlbumArt (id, hash, albumArt) VALUES (1, ?, NULL)').run(HASH)
  for (const t of TRACKS) {
    db.prepare(
      'INSERT INTO Track (id, path, filename, title, artist, albumArtId) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(t.id, t.path, t.path?.split('/').pop() ?? null, t.title, 'Artist', t.art ? 1 : null)
    db.prepare('UPDATE PerformanceData SET quickCues = ? WHERE trackId = ?').run(
      Buffer.from([t.id, 7, 7]),
      t.id,
    )
    if (t.path && t.bytes) {
      const file = join(dir, t.path)
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, Buffer.alloc(t.bytes, t.id))
    }
  }
  for (const l of LISTS) {
    db.prepare(
      'INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, isExplicitlyExported) VALUES (?, ?, 1, 0, 1)',
    ).run(l.title, l.parent)
    let previous: number | null = null
    for (const trackId of l.tracks) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId,
              membershipReference) VALUES (?, ?, 'desktop-uuid', 0, 0)`,
          )
          .run(l.id, trackId).lastInsertRowid,
      )
      if (previous !== null)
        db.prepare('UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?').run(id, previous)
      previous = id
    }
  }
  db.close()
  return dir
}

const volume = (mountPoint: string): UsbVolume => ({
  uuid: UUID,
  name: 'Surco',
  mountPoint,
  filesystem: 'fat32',
  partitionScheme: 'mbr',
  totalBytes: 8e9,
  freeBytes: 4e9,
  holder: { by: 'empty', at: null },
  remembered: null,
  stickPlaylists: null,
})

async function world(over: Partial<EngineUsbExporterDeps> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'surco-engine-usb-'))
  const libraryDir = await desktopLibrary(home)
  const usb = join(home, 'usb')
  await mkdir(usb)
  const events: UsbExportEvent[] = []
  const memory = createUsbMemory(join(home, 'usb-engine-exports.json'))
  const deps: EngineUsbExporterDeps = {
    platform: 'darwin',
    libraryDir: () => libraryDir,
    volumes: async () => [volume(usb)],
    idAt: async () => UUID,
    devOf: async () => 1,
    realPath: async (p) => p,
    freeBytes: async () => 4e9,
    engineRunning: async () => false,
    ensureEngineClosed: async () => true,
    memory,
    send: (e) => events.push(e),
    now: () => 1_000,
    log: () => {},
    pollMs: 5,
    ...over,
  }
  return { home, libraryDir, usb, events, memory, deps, exporter: createEngineUsbExporter(deps) }
}

const request = (playlistIds: string[]): UsbExportRequest => ({
  playlistIds,
  target: { kind: 'volume', uuid: UUID },
  prune: false,
  settings: false,
  source: 'engine',
})

async function finished(events: UsbExportEvent[]) {
  await vi.waitFor(() => {
    if (!events.some((e) => e.type === 'finished')) throw new Error('not finished')
  })
  return events.find((e) => e.type === 'finished')
}

const engineDir = (usb: string) => join(usb, 'Engine Library')

function usbDb(usb: string): Database.Database {
  return new Database(join(engineDir(usb), 'Database2', 'm.db'), { readonly: true })
}

function playlistTitles(db: Database.Database, listId: number): string[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.nextEntityId AS next, t.title FROM PlaylistEntity e
         JOIN Track t ON t.id = e.trackId WHERE e.listId = ?`,
    )
    .all(listId) as { id: number; next: number; title: string }[]
  return chainOrder(rows).map((r) => r.title)
}

const listId = (db: Database.Database, title: string): number =>
  (db.prepare('SELECT id FROM Playlist WHERE title = ?').get(title) as { id: number }).id

describe('engine USB plan', () => {
  it('sums what is new for the USB and names what cannot go, without writing anything to it', async () => {
    const w = await world()
    const r = await w.exporter.plan(request(['1']))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan).toMatchObject({
      trackCount: 2,
      newCount: 2,
      newBytes: 5000,
      keptCount: 0,
      removedSinceLast: null,
    })
    expect(r.plan.tracks.map((t) => [t.title, t.size, t.onStick])).toEqual([
      ['Play', 2000, false],
      ['Night Train', 3000, false],
    ])
    expect(r.plan.tracks[1].cover).toBe(`data:image/jpeg;base64,${COVER.toString('base64')}`)
    expect(r.plan.warnings).toEqual([
      {
        kind: 'unexportable',
        tracks: [
          { title: 'Gone', reason: 'missing-file' },
          { title: 'Streamed', reason: 'streaming' },
        ],
      },
    ])
    expect(await readdir(w.usb)).toEqual([])
  })

  it('warns that Engine DJ is open, since the export will ask to close it before writing', async () => {
    const w = await world({ engineRunning: async () => true })
    const r = await w.exporter.plan(request(['1']))
    expect(r.ok && r.plan.warnings).toContainEqual({ kind: 'engineOpen' })
  })

  it('says the music does not fit before anything is copied', async () => {
    const w = await world({ freeBytes: async () => 100 })
    const r = await w.exporter.plan(request(['1']))
    expect(r.ok && r.plan.warnings).toContainEqual({
      kind: 'noSpace',
      neededBytes: 5000 + COVER.length,
      freeBytes: 100,
    })
    expect(await w.exporter.start(request(['1']))).toEqual({
      ok: false,
      reason: 'no-space',
      neededBytes: 5000 + COVER.length,
      freeBytes: 100,
    })
    expect(await readdir(w.usb)).toEqual([])
  })

  it('has no library to read when Engine DJ has none on this computer', async () => {
    const w = await world({ libraryDir: () => '' })
    expect(await w.exporter.plan(request(['1']))).toEqual({ ok: false, reason: 'engine-missing' })
  })
})

describe('engine USB export', () => {
  it('copies the music under Engine Library and writes a library whose paths lead to the copies, so a player opens every track', async () => {
    const w = await world()
    expect(await w.exporter.start(request(['1']))).toEqual({ ok: true })
    expect(await finished(w.events)).toMatchObject({ outcome: 'done', tracks: 2, failed: 0 })
    const db = usbDb(w.usb)
    const tracks = db.prepare('SELECT path, fileBytes, title FROM Track ORDER BY id').all() as {
      path: string
      fileBytes: number
      title: string
    }[]
    expect(tracks.map((t) => t.path)).toEqual(['Music/play.mp3', 'Music/night.aiff'])
    for (const t of tracks) {
      const copy = join(engineDir(w.usb), t.path)
      expect((await stat(copy)).size).toBe(t.fileBytes)
      const source = TRACKS.find((x) => x.title === t.title)?.path as string
      expect(Buffer.compare(await readFile(copy), await readFile(join(w.libraryDir, source)))).toBe(
        0,
      )
    }
    expect(playlistTitles(db, listId(db, 'Warm up'))).toEqual(['Play', 'Night Train'])
    db.close()
  })

  it('carries the covers Engine DJ 4 keeps beside the database, named by their hash', async () => {
    const w = await world()
    await w.exporter.start(request(['1']))
    await finished(w.events)
    const name = `${HASH.toString('base64url')}.jpg`
    expect(await readFile(join(engineDir(w.usb), 'Artwork', name))).toEqual(COVER)
  })

  it('touches nothing on the drive outside Engine Library', async () => {
    const w = await world()
    await writeFile(join(w.usb, 'notes.txt'), 'mine')
    await w.exporter.start(request(['1', '2']))
    await finished(w.events)
    expect((await readdir(w.usb)).sort()).toEqual(['Engine Library', 'notes.txt'])
    expect(await readFile(join(w.usb, 'notes.txt'), 'utf8')).toBe('mine')
  })

  it('keeps the folders of a ticked folder, so the player shows the same tree', async () => {
    const w = await world()
    await w.exporter.start(request(['2']))
    await finished(w.events)
    const db = usbDb(w.usb)
    expect(readEngineTree(db)).toMatchObject([
      { name: 'Sets', kind: 'folder', children: [{ name: 'Peak', kind: 'playlist', count: 1 }] },
    ])
    db.close()
  })

  it('gives two files of the same name their own place, even when only the case differs, because USB drives ignore case', async () => {
    const w = await world()
    await w.exporter.start(request(['4']))
    await finished(w.events)
    const db = usbDb(w.usb)
    const paths = db.prepare('SELECT path FROM Track ORDER BY id').pluck().all()
    expect(paths).toEqual(['Music/play.mp3', 'Music/Play (2).MP3', 'Music/What_.aiff'])
    for (const p of paths) await stat(join(engineDir(w.usb), p as string))
    db.close()
  })

  it('reports each track as it lands and the database last, the events the progress view already draws', async () => {
    const w = await world()
    await w.exporter.start(request(['1']))
    await finished(w.events)
    const kinds = w.events.filter((e) => e.type !== 'progress').map((e) => e.type)
    expect(kinds).toEqual(['started', 'track', 'track', 'database', 'finished'])
    expect(w.events[0]).toMatchObject({ type: 'started', targetName: 'Surco' })
  })

  it('remembers the export per drive apart from rekordbox, so the next time starts ticked', async () => {
    const w = await world()
    await w.exporter.start(request(['1']))
    await finished(w.events)
    expect(w.memory.get(`volume:${UUID}`)).toMatchObject({
      playlistIds: ['1'],
      trackIds: ['2', '1'],
    })
  })

  it('asks to close Engine DJ first and writes nothing when it stays open, since Engine would overwrite the library on the drive', async () => {
    const ensure = vi.fn(async () => false)
    const w = await world({ engineRunning: async () => true, ensureEngineClosed: ensure })
    expect(await w.exporter.start(request(['1']))).toEqual({ ok: false, reason: 'engine-open' })
    expect(ensure).toHaveBeenCalledOnce()
    expect(await readdir(w.usb)).toEqual([])
  })

  it('writes nothing when another drive is mounted where the chosen one was', async () => {
    const w = await world({ idAt: async () => 'OTHER' })
    expect(await w.exporter.start(request(['1']))).toEqual({
      ok: false,
      reason: 'volume-changed',
    })
    expect(await readdir(w.usb)).toEqual([])
  })

  it('refuses an Engine Library it did not make and leaves it as it was', async () => {
    const w = await world()
    await mkdir(join(engineDir(w.usb), 'Database2'), { recursive: true })
    const theirs = join(engineDir(w.usb), 'Database2', 'm.db')
    await writeFile(theirs, 'engine made this')
    expect(await w.exporter.plan(request(['1']))).toEqual({ ok: false, reason: 'engine-foreign' })
    expect(await w.exporter.start(request(['1']))).toEqual({
      ok: false,
      reason: 'engine-foreign',
    })
    expect(await readFile(theirs, 'utf8')).toBe('engine made this')
    expect(await readdir(engineDir(w.usb))).toEqual(['Database2'])
  })

  it('stops after the track being copied when cancelled and leaves the drive without a new library', async () => {
    const holder: { cancel: () => boolean } = { cancel: () => false }
    const w = await world({
      send: (e) => {
        if (e.type === 'track') holder.cancel()
        events.push(e)
      },
    })
    const events = w.events
    holder.cancel = w.exporter.cancel
    await w.exporter.start(request(['1']))
    expect(await finished(events)).toEqual({ type: 'finished', outcome: 'cancelled' })
    expect(events.filter((e) => e.type === 'track')).toHaveLength(1)
    await expect(stat(join(engineDir(w.usb), 'Database2', 'm.db'))).rejects.toThrow()
  })

  it('runs one export at a time', async () => {
    const w = await world()
    const first = w.exporter.start(request(['1']))
    expect(await w.exporter.start(request(['1']))).toEqual({ ok: false, reason: 'busy' })
    expect(await w.exporter.plan(request(['1']))).toEqual({ ok: false, reason: 'busy' })
    expect(await first).toEqual({ ok: true })
    await finished(w.events)
    expect(w.exporter.busy()).toBe(false)
  })
})

describe('engine USB export onto a drive Surco exported to before', () => {
  async function exported(w: Awaited<ReturnType<typeof world>>, ids: string[]) {
    w.events.length = 0
    expect(await w.exporter.start(request(ids))).toEqual({ ok: true })
    return finished(w.events)
  }

  it('copies nothing again and adds no track twice when the same playlist goes again', async () => {
    const w = await world()
    await exported(w, ['1'])
    const before = await stat(join(engineDir(w.usb), 'Music', 'play.mp3'))
    expect(await exported(w, ['1'])).toMatchObject({ outcome: 'done', tracks: 2 })
    expect(
      w.events.filter((e) => e.type === 'track').map((e) => e.type === 'track' && e.state),
    ).toEqual(['kept', 'kept'])
    expect((await stat(join(engineDir(w.usb), 'Music', 'play.mp3'))).mtimeMs).toBe(before.mtimeMs)
    const db = usbDb(w.usb)
    expect(db.prepare('SELECT count(*) FROM Track').pluck().get()).toBe(2)
    expect(db.prepare('SELECT count(*) FROM Playlist').pluck().get()).toBe(1)
    db.close()
  })

  it('keeps the playlists already on the drive and shares the tracks they have in common', async () => {
    const w = await world()
    await exported(w, ['1'])
    await exported(w, ['4'])
    const db = usbDb(w.usb)
    expect(readEngineTree(db).map((n) => n.name)).toEqual(['Warm up', 'Dupes'])
    expect(playlistTitles(db, listId(db, 'Warm up'))).toEqual(['Play', 'Night Train'])
    expect(playlistTitles(db, listId(db, 'Dupes'))).toEqual(['Play', 'Play again', 'What'])
    expect(db.prepare('SELECT path FROM Track ORDER BY id').pluck().all()).toEqual([
      'Music/play.mp3',
      'Music/night.aiff',
      'Music/Play (2).MP3',
      'Music/What_.aiff',
    ])
    db.close()
    expect((await readdir(join(engineDir(w.usb), 'Music'))).sort()).toEqual([
      'Play (2).MP3',
      'What_.aiff',
      'night.aiff',
      'play.mp3',
    ])
  })

  it('replaces the playlist with what it holds now on the desktop and counts what left it', async () => {
    const w = await world()
    await exported(w, ['1'])
    const desktop = new Database(join(w.libraryDir, 'Database2', 'm.db'))
    desktop.prepare('DELETE FROM PlaylistEntity WHERE listId = 1 AND trackId = 1').run()
    desktop.close()
    const plan = await w.exporter.plan(request(['1']))
    expect(plan.ok && plan.plan.removedSinceLast).toBe(1)
    await exported(w, ['1'])
    const db = usbDb(w.usb)
    expect(playlistTitles(db, listId(db, 'Warm up'))).toEqual(['Play'])
    db.close()
  })

  it('copies a file again when the one on the drive is no longer the same size, as after a new conversion', async () => {
    const w = await world()
    await exported(w, ['1'])
    await writeFile(join(w.libraryDir, '../Tracks/play.mp3'), Buffer.alloc(2500, 9))
    await exported(w, ['1'])
    expect(
      (await readFile(join(engineDir(w.usb), 'Music', 'play.mp3'))).equals(Buffer.alloc(2500, 9)),
    ).toBe(true)
    const db = usbDb(w.usb)
    expect(
      db.prepare("SELECT fileBytes FROM Track WHERE path = 'Music/play.mp3'").pluck().get(),
    ).toBe(2500)
    expect(db.prepare('SELECT count(*) FROM Track').pluck().get()).toBe(2)
    db.close()
  })

  it('treats a library whose database Surco did not write as someone else’s, even with Surco’s note beside it', async () => {
    const w = await world()
    await exported(w, ['1'])
    const db = new Database(join(engineDir(w.usb), 'Database2', 'm.db'))
    db.prepare("UPDATE Information SET uuid = 'made-by-engine'").run()
    db.close()
    expect(await w.exporter.plan(request(['1']))).toEqual({ ok: false, reason: 'engine-foreign' })
  })

  it('refuses a library on the drive from another Engine DJ version rather than mix two schemas', async () => {
    const w = await world()
    await exported(w, ['1'])
    const db = new Database(join(engineDir(w.usb), 'Database2', 'm.db'))
    db.prepare('UPDATE Information SET schemaVersionMinor = 1').run()
    db.close()
    expect(await w.exporter.plan(request(['1']))).toEqual({ ok: false, reason: 'engine-schema' })
    expect(await w.exporter.start(request(['1']))).toEqual({ ok: false, reason: 'engine-schema' })
  })
})

describe('engineLibraryHolder', () => {
  it('tells an empty drive, one Surco exported to and one with an Engine Library of someone else apart, for the drive list', async () => {
    const w = await world()
    expect(await engineLibraryHolder(w.usb)).toEqual({ by: 'empty', at: null })
    await w.exporter.start(request(['1']))
    await finished(w.events)
    const written = (await stat(join(engineDir(w.usb), 'Database2', 'm.db'))).mtimeMs
    expect(await engineLibraryHolder(w.usb)).toEqual({ by: 'surco', at: written })
    const db = new Database(join(engineDir(w.usb), 'Database2', 'm.db'))
    db.prepare("UPDATE Information SET uuid = 'made-by-engine'").run()
    db.close()
    expect(await engineLibraryHolder(w.usb)).toMatchObject({ by: 'other' })
  })
})

describe('closing Engine DJ for a USB export', () => {
  it('asks with words about the USB export, not about a conversion, in every language', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt-BR']) {
      const t = createMenuT(locale)
      const text = t(ENGINE_USB_QUIT_DETAIL)
      expect(text).toContain('USB')
      expect(text).toContain('Engine DJ')
      expect(text).not.toBe(t('engineQuitDetail'))
      expect(text).not.toMatch(/[—:]/)
    }
  })
})
