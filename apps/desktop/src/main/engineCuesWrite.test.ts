import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WantedCue } from '../shared/cueRules'
import { emptyMetadata } from '../shared/metadata'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import { hotCueArgb } from '../shared/rekordboxCueColors'
import { buildEngineDatabase, loadSqlJs } from './engine'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { decodeQuickCues, inflateEngineBlob } from './engineBlobs'
import { readEngineTrackCues } from './engineCues'
import { applyEngineCuesBatch } from './engineCuesWrite'
import { withEngineDatabase } from './engineLibrary'
import { analysedTrack, MAIN_CUE_TAIL, quickCuesRaw } from './enginePerformanceFixture'
import { openEngineDb, readEnginePlaylist, readEngineTree } from './enginePlaylists'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { isEngineDjRunning } from './engineProcess'
import { backupOf } from './libraryBackups'
import { rekordboxMetaFrom } from './rekordboxMetadata'
import type { CuesOp, TrackOp } from './rekordboxQueueOps'
import { readEmbeddedCover } from './tags'

vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('./tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tags')>()),
  readEmbeddedCover: vi.fn(() => null),
}))
beforeEach(() => vi.mocked(isEngineDjRunning).mockResolvedValue(false))
beforeEach(() => vi.mocked(readEmbeddedCover).mockReturnValue(null))

const SLOTS = [
  { label: 'Cue 1', sample: 44100 * 8, argb: 0xfff4d338 },
  null,
  null,
  { label: 'Drop', sample: 44100 * 32, argb: 0xfff4d338 },
]

async function library(schema: '3.0.2' | '2.18' = '3.0.2'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginecuesw-'))
  const perf = analysedTrack(1, SLOTS)
  if (schema === '3.0.2') {
    writeEngineLibraryFixture(dir, {
      tracks: [{ id: 1, path: '../Music/a.mp3', title: 'a', length: 60 }],
      playlists: [],
      entities: [],
      performance: [perf],
    }).close()
    return dir
  }
  const SQL = await loadSqlJs()
  const db = new SQL.Database(
    await buildEngineDatabase(
      [
        {
          relativePath: '../Music/a.mp3',
          filename: 'a.mp3',
          fileType: 'mp3',
          fileBytes: 100,
          title: 'a',
          artist: '',
          album: '',
          genre: '',
          comment: '',
          bpm: 120,
          bpmAnalyzed: 120,
          year: null,
          durationSec: 60,
          rating: 0,
        },
      ],
      'Crate',
    ),
  )
  db.run('UPDATE Track SET trackData = ?, beatData = ?, quickCues = ? WHERE id = 1', [
    perf.trackData ?? null,
    perf.beatData ?? null,
    perf.quickCues ?? null,
  ])
  mkdirSync(join(dir, 'Database2'), { recursive: true })
  writeFileSync(join(dir, 'Database2', 'm.db'), db.export())
  db.close()
  return dir
}

const dbFile = (dir: string) => join(dir, 'Database2', 'm.db')

function current(dir: string) {
  const db = openEngineDb(dir)
  if (!db) throw new Error('library did not open')
  try {
    const read = readEngineTrackCues(db, 'engine:1', { wave: false })
    if (!read) throw new Error('track missing')
    return read
  } finally {
    db.close()
  }
}

function slotsOf(dir: string) {
  const db = new Database(dbFile(dir), { readonly: true })
  try {
    const row = db.prepare('SELECT quickCues FROM PerformanceData WHERE trackId = 1').get() as {
      quickCues: Buffer
    }
    const decoded = decodeQuickCues(inflateEngineBlob(row.quickCues))
    if (!decoded) throw new Error('quick cues unreadable')
    return decoded
  } finally {
    db.close()
  }
}

function op(dir: string, wanted: WantedCue[], over: Partial<CuesOp> = {}): CuesOp {
  return {
    id: 'op1',
    kind: 'cues',
    contentId: 'engine:1',
    path: '/m/a.mp3',
    label: 'a',
    wanted,
    fingerprint: current(dir).fingerprint,
    ...over,
  }
}

const deps = (over: Partial<Parameters<typeof applyEngineCuesBatch>[2]> = {}) => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  ...over,
})

const UNTOUCHED = { id: '0', ms: 8000, kind: 1, color: 33 }

describe.each(['3.0.2', '2.18'] as const)('applyEngineCuesBatch on a %s library', (schema) => {
  it('writes moved and new hot cues to their pads and leaves an untouched pad, its label and the main cue exactly as Engine stored them', async () => {
    const dir = await library(schema)
    const before = slotsOf(dir)
    const result = await applyEngineCuesBatch(
      dir,
      [
        op(dir, [
          UNTOUCHED,
          { id: '3', ms: 16000, kind: 5, color: 33 },
          { ms: 24000, kind: 2, color: 42 },
        ]),
      ],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    const after = slotsOf(dir)
    expect(after.slots[0].bytes).toEqual(before.slots[0].bytes)
    expect(after.slots.map((s) => s.cue)).toEqual([
      SLOTS[0],
      { label: '', sample: 44100 * 24, argb: hotCueArgb(42) },
      null,
      { label: 'Drop', sample: 44100 * 16, argb: 0xfff4d338 },
      null,
      null,
      null,
      null,
    ])
    expect(after.tail).toEqual(MAIN_CUE_TAIL)
  })

  it('paints a pad the DJ recoloured in the new colour, keeping its name and place', async () => {
    const dir = await library(schema)
    await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { id: '3', ms: 32000, kind: 5, color: 42 }])],
      deps(),
    )
    expect(slotsOf(dir).slots[3].cue).toEqual({
      label: 'Drop',
      sample: 44100 * 32,
      argb: hotCueArgb(42),
    })
  })

  it('empties the pad of a hot cue the DJ removed', async () => {
    const dir = await library(schema)
    await applyEngineCuesBatch(dir, [op(dir, [UNTOUCHED])], deps())
    expect(slotsOf(dir).slots.map((s) => s.cue)).toEqual([
      SLOTS[0],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ])
  })
})

describe('applyEngineCuesBatch', () => {
  it('writes no CALL, since Engine has none, and names the ones left out so the DJ is told', async () => {
    const dir = await library()
    const result = await applyEngineCuesBatch(
      dir,
      [
        op(dir, [
          UNTOUCHED,
          { id: '3', ms: 32000, kind: 5, color: 33 },
          { ms: 4000, kind: 0, color: null },
          { ms: 12000, kind: 0, color: null },
        ]),
      ],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        {
          id: 'op1',
          applied: true,
          notices: [{ code: 'cues-calls-dropped', track: 'a', calls: [4000, 12000] }],
        },
      ],
    })
    expect(slotsOf(dir).slots.map((s) => s.cue)).toEqual(quickCuesRawSlots())
  })

  it('backs up the library before writing, both the run’s copy and the fixed one next to m.db', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const d = deps()
    await applyEngineCuesBatch(dir, [op(dir, [UNTOUCHED])], d)
    expect(d.sessionBackup).toHaveBeenCalledWith(dbFile(dir))
    expect(readFileSync(backupOf(dbFile(dir), 'backup'))).toEqual(original)
  })

  it('refuses a save made on pads that changed in Engine since, so the DJ’s newer cues are never overwritten', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED], { fingerprint: 'stale' })],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: false, notices: [{ code: 'cues-changed', track: 'a' }] }],
    })
    expect(readFileSync(dbFile(dir))).toEqual(original)
    expect(existsSync(backupOf(dbFile(dir), 'backup'))).toBe(false)
  })

  it('reads the library again after Engine DJ quits, so what Engine saved on quitting is kept', async () => {
    const dir = await library()
    const savedOnQuit = () => {
      const db = new Database(dbFile(dir))
      db.prepare("UPDATE Track SET title = 'Saved by Engine' WHERE id = 1").run()
      db.close()
    }
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { ms: 24000, kind: 2, color: 42 }])],
      deps({
        ensureClosed: vi.fn(async () => {
          savedOnQuit()
          return true
        }),
      }),
    )
    expect(result).toMatchObject({ ok: true, wrote: true })
    const db = new Database(dbFile(dir), { readonly: true })
    const title = (db.prepare('SELECT title FROM Track WHERE id = 1').get() as { title: string })
      .title
    db.close()
    expect(title).toBe('Saved by Engine')
    expect(slotsOf(dir).slots[1].cue).toEqual({
      label: '',
      sample: 44100 * 24,
      argb: hotCueArgb(42),
    })
  })

  it('refuses a save on pads Engine DJ changed as it quit', async () => {
    const dir = await library()
    const movedOnQuit = () => {
      const db = new Database(dbFile(dir))
      db.prepare('UPDATE PerformanceData SET quickCues = ? WHERE trackId = 1').run(
        Buffer.from(
          analysedTrack(1, [{ label: 'Moved', sample: 44100 * 12, argb: 0xfff4d338 }])
            .quickCues as Uint8Array,
        ),
      )
      db.close()
    }
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { ms: 24000, kind: 2, color: 42 }])],
      deps({
        ensureClosed: vi.fn(async () => {
          movedOnQuit()
          return true
        }),
      }),
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ applied: false, notices: [{ code: 'cues-changed' }] }],
    })
    expect(slotsOf(dir).slots[0].cue).toEqual({
      label: 'Moved',
      sample: 44100 * 12,
      argb: 0xfff4d338,
    })
  })

  it('refuses a set that names a pad Engine does not have, rather than writing part of it', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { ms: 9000, kind: 10, color: 22 }])],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: false, notices: [{ code: 'cues-invalid', track: 'a' }] }],
    })
    expect(readFileSync(dbFile(dir))).toEqual(original)
  })

  it('leaves the library alone and keeps waiting while Engine DJ is open, since Engine would write its own copy back over it', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    vi.mocked(isEngineDjRunning).mockResolvedValue(true)
    const result = await applyEngineCuesBatch(dir, [op(dir, [UNTOUCHED])], deps())
    expect(result).toEqual({ ok: false, reason: 'rekordbox-running' })
    expect(readFileSync(dbFile(dir))).toEqual(original)
  })

  it('does nothing when the DJ declines to close Engine', async () => {
    const dir = await library()
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED])],
      deps({ ensureClosed: vi.fn(async () => false) }),
    )
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('writes nothing when the pads already hold what was asked', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { id: '3', ms: 32000, kind: 5, color: 33 }])],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    expect(readFileSync(dbFile(dir))).toEqual(original)
  })
})

function quickCuesRawSlots() {
  return decodeQuickCues(quickCuesRaw(SLOTS))?.slots.map((s) => s.cue)
}

describe('applyEngineCuesBatch alongside another write to the same library', () => {
  it('waits for it, so a track that write adds is still there after the cues are saved', async () => {
    const dir = await library()
    let release = () => {}
    const held = withEngineDatabase(dbFile(dir), async () => {
      await new Promise<void>((r) => {
        release = r
        setTimeout(r, 300)
      })
      const db = new Database(dbFile(dir))
      db.prepare(
        "INSERT INTO Track (id, path, filename) VALUES (2, '../Music/b.mp3', 'b.mp3')",
      ).run()
      db.close()
    })
    const saved = applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { ms: 16000, kind: 2, color: 33 }])],
      deps({ sessionBackup: vi.fn(async () => release()) }),
    )
    await held
    expect(await saved).toMatchObject({ ok: true, wrote: true })
    const db = new Database(dbFile(dir), { readonly: true })
    const paths = (
      db.prepare('SELECT path FROM Track ORDER BY id').all() as { path: string }[]
    ).map((r) => r.path)
    db.close()
    expect(paths).toEqual(['../Music/a.mp3', '../Music/b.mp3'])
    expect(slotsOf(dir).slots[1].cue?.label).toBe('')
  })
})

describe('playlists chosen in the editor for a track, written to Engine DJ', () => {
  async function crates(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-enginelists-'))
    const db = writeEngineLibraryFixture(dir, {
      tracks: [
        { id: 1, path: '../Music/a.mp3', title: 'a' },
        { id: 2, path: '../Music/b.mp3', title: 'b' },
      ],
      playlists: [
        { id: 1, title: 'Bases', parentListId: 0, nextListId: 2 },
        { id: 2, title: 'House', parentListId: 0, nextListId: 0 },
      ],
      entities: [
        { id: 1, listId: 1, trackId: 2, nextEntityId: 2 },
        { id: 2, listId: 1, trackId: 1, nextEntityId: 0 },
        { id: 3, listId: 2, trackId: 2, nextEntityId: 0 },
      ],
    })
    for (const trigger of ENGINE_3_SCHEMA.match(
      /CREATE TRIGGER trigger_(before|after)_insert_List [\s\S]*?END;/g,
    ) ?? [])
      db.exec(trigger)
    db.close()
    return dir
  }
  const track = (dir: string, over: Partial<TrackOp> = {}): TrackOp => ({
    id: 't1',
    kind: 'track',
    path: resolve(dir, '../Music/a.mp3'),
    label: 'a',
    facts: null,
    wanted: [],
    known: [],
    stamps: {},
    ...over,
  })
  const listed = (dir: string, title: string) => {
    const db = openEngineDb(dir)
    if (!db) throw new Error('library did not open')
    try {
      const id = (
        db.prepare('SELECT id FROM Playlist WHERE title = ?').get(title) as { id: number }
      ).id
      return readEnginePlaylist(db, dir, String(id), join(dir, 'art')).map((e) => e.preview?.title)
    } finally {
      db.close()
    }
  }

  it('adds the track at the end of a list the DJ picked and takes it out of one the DJ dropped, keeping both lists in order', async () => {
    const dir = await crates()
    const result = await applyEngineCuesBatch(
      dir,
      [track(dir, { wanted: [{ id: '2', name: 'House' }], known: ['1'] })],
      deps(),
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: true,
      outcomes: [{ applied: true, notices: [] }],
    })
    expect(listed(dir, 'House')).toEqual(['b', 'a'])
    expect(listed(dir, 'Bases')).toEqual(['b'])
  })

  it('keeps a list the DJ put the track in from Engine after opening it in Surco, and says so', async () => {
    const dir = await crates()
    const result = await applyEngineCuesBatch(dir, [track(dir)], deps())
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ notices: [{ code: 'playlist-changed', track: 'a', playlist: 'Bases' }] }],
    })
    expect(listed(dir, 'Bases')).toEqual(['b', 'a'])
  })

  it('finds the track by the file it was converted from while Engine still names that one', async () => {
    const dir = await crates()
    await applyEngineCuesBatch(
      dir,
      [
        track(dir, {
          path: resolve(dir, '../Music/a.flac'),
          from: resolve(dir, '../Music/a.mp3'),
          wanted: [
            { id: '1', name: 'Bases' },
            { id: '2', name: 'House' },
          ],
          known: ['1'],
        }),
      ],
      deps(),
    )
    expect(listed(dir, 'House')).toEqual(['b', 'a'])
  })

  it('creates a list the DJ typed at the top of the tree and puts the track in it', async () => {
    const dir = await crates()
    await applyEngineCuesBatch(dir, [track(dir, { wanted: [{ name: 'Nueva' }] })], deps())
    expect(listed(dir, 'Nueva')).toEqual(['a'])
    const db = openEngineDb(dir)
    expect(db && readEngineTree(db).map((n) => n.name)).toEqual(['Bases', 'House', 'Nueva'])
    db?.close()
  })

  it('says a list is gone instead of adding the track to nothing', async () => {
    const dir = await crates()
    const result = await applyEngineCuesBatch(
      dir,
      [
        track(dir, {
          wanted: [
            { id: '1', name: 'Bases' },
            { id: '9', name: 'Old' },
          ],
          known: ['1'],
        }),
      ],
      deps(),
    )
    expect(result).toMatchObject({
      outcomes: [{ notices: [{ code: 'playlist-gone', track: 'a', playlist: 'Old' }] }],
    })
  })

  it('adds a converted track Engine does not have yet and puts it in the list the DJ picked, as rekordbox does', async () => {
    const dir = await crates()
    vi.mocked(readEmbeddedCover).mockReturnValue(Buffer.from('cover'))
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), artist: 'Danny Gibson', title: 'Love Ya' })
    const result = await applyEngineCuesBatch(
      dir,
      [
        track(dir, {
          path: resolve(dir, '../Music/z.flac'),
          label: 'Danny Gibson - Love Ya',
          meta,
          wanted: [{ id: '2', name: 'House' }],
        }),
      ],
      deps(),
    )
    expect(result).toMatchObject({ ok: true, wrote: true, outcomes: [{ applied: true }] })
    expect(listed(dir, 'House')).toEqual(['b', 'Love Ya'])
    const db = openEngineDb(dir)
    if (!db) throw new Error('library did not open')
    try {
      const row = db
        .prepare(
          'SELECT t.path, t.artist, a.albumArt FROM Track t JOIN AlbumArt a ON a.id = t.albumArtId WHERE t.title = ?',
        )
        .get('Love Ya') as { path: string; artist: string; albumArt: Buffer }
      expect(row).toMatchObject({ path: '../Music/z.flac', artist: 'Danny Gibson' })
      expect(Buffer.from(row.albumArt).toString()).toBe('cover')
      expect(
        readEnginePlaylist(db, dir, RECENTLY_ADDED_ID, join(dir, 'art')).map((e) => e.path),
      ).toContain(resolve(dir, '../Music/z.flac'))
    } finally {
      db.close()
    }
  })

  it('adds the track only once when it goes to two lists', async () => {
    const dir = await crates()
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), title: 'Love Ya' })
    await applyEngineCuesBatch(
      dir,
      [
        track(dir, {
          path: resolve(dir, '../Music/z.flac'),
          meta,
          wanted: [
            { id: '1', name: 'Bases' },
            { id: '2', name: 'House' },
          ],
        }),
      ],
      deps(),
    )
    expect(listed(dir, 'Bases')).toEqual(['b', 'a', 'Love Ya'])
    expect(listed(dir, 'House')).toEqual(['b', 'Love Ya'])
    const db = openEngineDb(dir)
    expect(db?.prepare('SELECT count(*) AS n FROM Track').get()).toEqual({ n: 3 })
    db?.close()
  })

  it('adds an Engine track for an add op with no playlists, so a conversion made while Engine was open still lands in its collection', async () => {
    const dir = await crates()
    vi.mocked(readEmbeddedCover).mockReturnValue(Buffer.from('cover'))
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), artist: 'Danny Gibson', title: 'Love Ya' })
    const result = await applyEngineCuesBatch(
      dir,
      [track(dir, { path: resolve(dir, '../Music/z.flac'), meta, add: true })],
      deps(),
    )
    expect(result).toMatchObject({ ok: true, wrote: true, outcomes: [{ applied: true }] })
    const db = openEngineDb(dir)
    if (!db) throw new Error('library did not open')
    try {
      const row = db
        .prepare(
          'SELECT t.path, a.albumArt FROM Track t JOIN AlbumArt a ON a.id = t.albumArtId WHERE t.title = ?',
        )
        .get('Love Ya') as { path: string; albumArt: Buffer }
      expect(row.path).toBe('../Music/z.flac')
      expect(Buffer.from(row.albumArt).toString()).toBe('cover')
    } finally {
      db.close()
    }
  })

  it('leaves an Engine track already in the library untouched for an add op, so a track registered at conversion is never added twice', async () => {
    const dir = await crates()
    const before = readFileSync(join(dir, 'Database2', 'm.db'))
    const ensureClosed = vi.fn(async () => true)
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), title: 'a' })
    const result = await applyEngineCuesBatch(
      dir,
      [track(dir, { meta, add: true })],
      deps({ ensureClosed }),
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ applied: true, notices: [] }],
    })
    expect(ensureClosed).not.toHaveBeenCalled()
    expect(readFileSync(join(dir, 'Database2', 'm.db')).equals(before)).toBe(true)
  })

  it('adds nothing for an add op when Engine holds the file twice, since a third row would only be another duplicate', async () => {
    const dir = await crates()
    const db = new Database(join(dir, 'Database2', 'm.db'))
    db.prepare(
      "INSERT INTO Track (id, path, title) VALUES (3, '../Music/../Music/a.mp3', 'a again')",
    ).run()
    db.close()
    const before = readFileSync(join(dir, 'Database2', 'm.db'))
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), title: 'a' })
    const result = await applyEngineCuesBatch(dir, [track(dir, { meta, add: true })], deps())
    expect(result).toMatchObject({ ok: true, wrote: false, outcomes: [{ applied: true }] })
    expect(readFileSync(join(dir, 'Database2', 'm.db')).equals(before)).toBe(true)
  })

  it('adds the converted file for an add op even while Engine still names the file it came from, since nothing moves that row onto it', async () => {
    const dir = await crates()
    const meta = rekordboxMetaFrom({ ...emptyMetadata(), title: 'Love Ya' })
    await applyEngineCuesBatch(
      dir,
      [
        track(dir, {
          path: resolve(dir, '../Music/a.flac'),
          from: resolve(dir, '../Music/a.mp3'),
          meta,
          add: true,
        }),
      ],
      deps(),
    )
    const db = openEngineDb(dir)
    expect(db?.prepare("SELECT path FROM Track WHERE title = 'Love Ya'").get()).toEqual({
      path: '../Music/a.flac',
    })
    db?.close()
  })

  it('writes nothing for a track Engine does not have, and says so', async () => {
    const dir = await crates()
    const ensureClosed = vi.fn(async () => true)
    const result = await applyEngineCuesBatch(
      dir,
      [track(dir, { path: resolve(dir, '../Music/z.mp3'), wanted: [{ id: '2', name: 'House' }] })],
      deps({ ensureClosed }),
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ applied: false, notices: [{ code: 'not-in-library', track: 'a' }] }],
    })
    expect(ensureClosed).not.toHaveBeenCalled()
  })
})

describe('playlists chosen for a track inside an Engine DJ folder', () => {
  async function folder(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'surco-enginefolder-'))
    writeEngineLibraryFixture(dir, {
      tracks: [
        { id: 1, path: '../Music/a.mp3', title: 'a' },
        { id: 2, path: '../Music/b.mp3', title: 'b' },
      ],
      playlists: [
        { id: 2, title: 'Bases', parentListId: 0, nextListId: 0 },
        { id: 3, title: '2K', parentListId: 2, nextListId: 4 },
        { id: 4, title: '24', parentListId: 2, nextListId: 8 },
        { id: 8, title: 'All', parentListId: 2, nextListId: 0 },
      ],
      entities: [
        { id: 1, listId: 2, trackId: 2, nextEntityId: 2, ref: 1 },
        { id: 2, listId: 2, trackId: 1, nextEntityId: 0, ref: 2 },
        { id: 3, listId: 4, trackId: 1, nextEntityId: 0 },
        { id: 4, listId: 8, trackId: 2, nextEntityId: 5 },
        { id: 5, listId: 8, trackId: 1, nextEntityId: 0 },
      ],
    }).close()
    return dir
  }
  const refs = (dir: string) => {
    const db = new Database(join(dir, 'Database2', 'm.db'), { readonly: true })
    try {
      return db
        .prepare(
          'SELECT listId, trackId, membershipReference AS ref FROM PlaylistEntity ORDER BY listId, trackId',
        )
        .all()
    } finally {
      db.close()
    }
  }
  const op = (dir: string, over: Partial<TrackOp>): TrackOp => ({
    id: 't1',
    kind: 'track',
    path: resolve(dir, '../Music/a.mp3'),
    label: 'a',
    facts: null,
    wanted: [],
    known: [],
    stamps: {},
    ...over,
  })

  it('counts a new child list in the folder entry, as Engine keeps it', async () => {
    const dir = await folder()
    await applyEngineCuesBatch(
      dir,
      [
        op(dir, {
          wanted: [
            { id: '3', name: '2K' },
            { id: '4', name: '24' },
            { id: '8', name: 'All' },
          ],
          known: ['4', '8'],
        }),
      ],
      deps(),
    )
    expect(refs(dir)).toEqual([
      { listId: 2, trackId: 1, ref: 3 },
      { listId: 2, trackId: 2, ref: 1 },
      { listId: 3, trackId: 1, ref: 0 },
      { listId: 4, trackId: 1, ref: 0 },
      { listId: 8, trackId: 1, ref: 0 },
      { listId: 8, trackId: 2, ref: 0 },
    ])
  })

  it('takes the folder entry away with the last child list, and leaves the other tracks there', async () => {
    const dir = await folder()
    await applyEngineCuesBatch(dir, [op(dir, { wanted: [], known: ['4', '8'] })], deps())
    expect(refs(dir)).toEqual([
      { listId: 2, trackId: 2, ref: 1 },
      { listId: 8, trackId: 2, ref: 0 },
    ])
  })

  it('never takes the track out of the folder entry when the DJ only changes another list', async () => {
    const dir = await folder()
    await applyEngineCuesBatch(
      dir,
      [op(dir, { wanted: [{ id: '8', name: 'All' }], known: ['4', '8'] })],
      deps(),
    )
    expect(refs(dir)).toEqual([
      { listId: 2, trackId: 1, ref: 1 },
      { listId: 2, trackId: 2, ref: 1 },
      { listId: 8, trackId: 1, ref: 0 },
      { listId: 8, trackId: 2, ref: 0 },
    ])
  })
})
