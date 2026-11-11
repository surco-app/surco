import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RekordboxPlaylistEdit, SourceNode } from '../shared/types'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { applyEngineCuesBatch } from './engineCuesWrite'
import { openEngineDb, readEnginePlaylist, readEngineTree } from './enginePlaylists'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { isEngineDjRunning } from './engineProcess'
import type { EditOp } from './rekordboxQueueOps'

vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
beforeEach(() => vi.mocked(isEngineDjRunning).mockResolvedValue(false))

const deps = () => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
})

const dbFile = (dir: string) => join(dir, 'Database2', 'm.db')

async function library(triggers: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-engineedits-'))
  const db = writeEngineLibraryFixture(dir, {
    tracks: [
      { id: 1, path: '../Music/a.mp3', title: 'a' },
      { id: 2, path: '../Music/b.mp3', title: 'b' },
      { id: 3, path: '../Music/c.mp3', title: 'c' },
      { id: 4, path: '../Music/d.mp3', title: 'd' },
      { id: 5, path: '../Music/../Music/d.mp3', title: 'd again' },
    ],
    playlists: [
      { id: 1, title: 'Bases', parentListId: 0, nextListId: 5 },
      { id: 2, title: '2K', parentListId: 1, nextListId: 3 },
      { id: 3, title: '24', parentListId: 1, nextListId: 0 },
      { id: 5, title: 'House', parentListId: 0, nextListId: 6 },
      { id: 6, title: 'Warm up', parentListId: 0, nextListId: 0 },
    ],
    entities: [
      { id: 1, listId: 5, trackId: 2, nextEntityId: 2 },
      { id: 2, listId: 5, trackId: 1, nextEntityId: 0 },
      { id: 3, listId: 2, trackId: 1, nextEntityId: 0 },
      { id: 4, listId: 1, trackId: 1, nextEntityId: 6, ref: 1 },
      { id: 5, listId: 3, trackId: 3, nextEntityId: 0 },
      { id: 6, listId: 1, trackId: 3, nextEntityId: 0, ref: 1 },
    ],
  })
  if (triggers)
    for (const trigger of ENGINE_3_SCHEMA.match(
      /CREATE TRIGGER trigger_(before|after)_insert_List [\s\S]*?END;/g,
    ) ?? [])
      db.exec(trigger)
  else db.exec('DROP TRIGGER trigger_after_delete_List')
  db.close()
  return dir
}

const op = (edit: RekordboxPlaylistEdit, id = 'e1'): EditOp => ({
  id,
  kind: 'edit',
  edit,
  stamps: {},
})

const at = (dir: string, file: string) => resolve(dir, '../Music', file)

function read<T>(dir: string, fn: (db: NonNullable<ReturnType<typeof openEngineDb>>) => T): T {
  const db = openEngineDb(dir)
  if (!db) throw new Error('library did not open')
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const names = (nodes: SourceNode[]) => nodes.map((n) => n.name)
const tree = (dir: string) => read(dir, readEngineTree)
const titles = (dir: string, id: string) =>
  read(dir, (db) => readEnginePlaylist(db, dir, id, join(dir, 'art')).map((e) => e.preview?.title))

function raw<T>(dir: string, sql: string): T[] {
  const db = new Database(dbFile(dir), { readonly: true })
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

const refs = (dir: string) =>
  raw(
    dir,
    'SELECT listId, trackId, membershipReference AS ref FROM PlaylistEntity WHERE membershipReference > 0 ORDER BY listId, trackId',
  )

describe.each([
  ['with', true],
  ['without', false],
])('Engine DJ playlist edits on a library %s Engine’s own list triggers', (_label, triggers) => {
  it('creates a playlist at the end of the top level with its tracks in order, and reports what it could not find', async () => {
    const dir = await library(triggers)
    const result = await applyEngineCuesBatch(
      dir,
      [
        op({
          kind: 'create',
          parentId: 'root',
          name: 'Session',
          folder: false,
          tracks: [
            { contentId: 'engine:3', paths: [] },
            { paths: [at(dir, 'a.mp3')] },
            { paths: [at(dir, 'missing.mp3')] },
            { paths: [at(dir, 'd.mp3')] },
          ],
        }),
      ],
      deps(),
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: true,
      outcomes: [
        {
          applied: true,
          createdId: '7',
          report: { added: 2, already: 0, notInCollection: 1, ambiguous: 1 },
        },
      ],
    })
    expect(names(tree(dir))).toEqual(['Bases', 'House', 'Warm up', 'Session'])
    expect(titles(dir, '7')).toEqual(['c', 'a'])
    expect(
      raw(dir, 'SELECT id, nextListId FROM Playlist WHERE parentListId = 0 ORDER BY id'),
    ).toEqual([
      { id: 1, nextListId: 5 },
      { id: 5, nextListId: 6 },
      { id: 6, nextListId: 7 },
      { id: 7, nextListId: 0 },
    ])
  })

  it('creates a playlist last inside a folder and files its tracks in the folder too, as Engine counts them', async () => {
    const dir = await library(triggers)
    await applyEngineCuesBatch(
      dir,
      [
        op({
          kind: 'create',
          parentId: '1',
          name: 'Session',
          folder: false,
          tracks: [{ paths: [at(dir, 'a.mp3')] }, { paths: [at(dir, 'b.mp3')] }],
        }),
      ],
      deps(),
    )
    const bases = tree(dir)[0]
    expect(names(bases.children ?? [])).toEqual(['2K', '24', 'Session'])
    expect(refs(dir)).toEqual([
      { listId: 1, trackId: 1, ref: 2 },
      { listId: 1, trackId: 2, ref: 1 },
      { listId: 1, trackId: 3, ref: 1 },
    ])
  })

  it('creates an empty playlist when no tracks are given and hands back its id', async () => {
    const dir = await library(triggers)
    const result = await applyEngineCuesBatch(
      dir,
      [op({ kind: 'create', parentId: 'root', name: 'Empty', folder: false })],
      deps(),
    )
    expect(result).toMatchObject({ outcomes: [{ applied: true, createdId: '7' }] })
    expect(tree(dir).at(-1)).toEqual({ id: '7', name: 'Empty', kind: 'playlist', count: 0 })
  })

  it('creates two playlists queued together one after the other, keeping the top level one chain', async () => {
    const dir = await library(triggers)
    const result = await applyEngineCuesBatch(
      dir,
      [
        op({ kind: 'create', parentId: 'root', name: 'One', folder: false }, 'e1'),
        op({ kind: 'create', parentId: 'root', name: 'Two', folder: false }, 'e2'),
        op({ kind: 'create', parentId: 'root', name: 'One', folder: false }, 'e3'),
      ],
      deps(),
    )
    expect(result).toMatchObject({
      outcomes: [
        { applied: true, createdId: '7' },
        { applied: true, createdId: '8' },
        { applied: false, reason: 'bad-name' },
      ],
    })
    expect(names(tree(dir))).toEqual(['Bases', 'House', 'Warm up', 'One', 'Two'])
  })

  it('deletes a playlist in the middle of its level and links its neighbours to each other', async () => {
    const dir = await library(triggers)
    const result = await applyEngineCuesBatch(
      dir,
      [op({ kind: 'delete', playlistId: '5' })],
      deps(),
    )
    expect(result).toMatchObject({ ok: true, wrote: true, outcomes: [{ applied: true }] })
    expect(names(tree(dir))).toEqual(['Bases', 'Warm up'])
    expect(raw(dir, 'SELECT nextListId FROM Playlist WHERE id = 1')).toEqual([{ nextListId: 6 }])
    expect(raw(dir, 'SELECT id FROM PlaylistEntity WHERE listId = 5')).toEqual([])
  })
})

describe('Engine DJ playlist edits', () => {
  it('deletes a folder with every list in it and the folder’s own track entries', async () => {
    const dir = await library(true)
    await applyEngineCuesBatch(dir, [op({ kind: 'delete', playlistId: '1' })], deps())
    expect(names(tree(dir))).toEqual(['House', 'Warm up'])
    expect(raw(dir, 'SELECT id FROM Playlist ORDER BY id')).toEqual([{ id: 5 }, { id: 6 }])
    expect(raw(dir, 'SELECT DISTINCT listId FROM PlaylistEntity')).toEqual([{ listId: 5 }])
  })

  it('takes a deleted list’s tracks out of the folder count, keeping the ones its sibling still holds', async () => {
    const dir = await library(true)
    await applyEngineCuesBatch(dir, [op({ kind: 'delete', playlistId: '2' })], deps())
    expect(names(tree(dir)[0].children ?? [])).toEqual(['24'])
    expect(refs(dir)).toEqual([{ listId: 1, trackId: 3, ref: 1 }])
  })

  it('adds tracks at the end of a playlist, counting the ones already in it', async () => {
    const dir = await library(true)
    const result = await applyEngineCuesBatch(
      dir,
      [
        op({
          kind: 'add',
          playlistId: '5',
          tracks: [
            { paths: [at(dir, 'c.mp3')] },
            { contentId: 'engine:1', paths: [] },
            { paths: [at(dir, 'missing.mp3')] },
          ],
        }),
      ],
      deps(),
    )
    expect(result).toMatchObject({
      outcomes: [
        { applied: true, report: { added: 1, already: 1, notInCollection: 1, ambiguous: 0 } },
      ],
    })
    expect(titles(dir, '5')).toEqual(['b', 'a', 'c'])
  })

  it('files tracks added to a list inside a folder in the folder too', async () => {
    const dir = await library(true)
    await applyEngineCuesBatch(
      dir,
      [op({ kind: 'add', playlistId: '3', tracks: [{ paths: [at(dir, 'b.mp3')] }] })],
      deps(),
    )
    expect(titles(dir, '3')).toEqual(['c', 'b'])
    expect(refs(dir)).toEqual([
      { listId: 1, trackId: 1, ref: 1 },
      { listId: 1, trackId: 2, ref: 1 },
      { listId: 1, trackId: 3, ref: 1 },
    ])
  })

  it('writes nothing when every track is already in the playlist, and says why', async () => {
    const dir = await library(true)
    const before = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op({ kind: 'add', playlistId: '5', tracks: [{ contentId: 'engine:2', paths: [] }] })],
      deps(),
    )
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [
        {
          applied: false,
          reason: 'nothing-to-add',
          report: { added: 0, already: 1, notInCollection: 0, ambiguous: 0 },
        },
      ],
    })
    expect(readFileSync(dbFile(dir)).equals(before)).toBe(true)
  })

  it.each<[string, RekordboxPlaylistEdit, string]>([
    [
      'a folder, which Engine only shows once something is in it',
      { kind: 'create', parentId: 'root', name: 'F', folder: true },
      'read-only',
    ],
    [
      'a name another list at that level has, which Engine’s schema forbids',
      { kind: 'create', parentId: 'root', name: 'House', folder: false },
      'bad-name',
    ],
    ['an empty name', { kind: 'create', parentId: 'root', name: '  ', folder: false }, 'bad-name'],
    [
      'a list inside a parent that is gone',
      { kind: 'create', parentId: '99', name: 'X', folder: false },
      'stale',
    ],
    [
      'a list inside a playlist, which would turn its tracks into a folder',
      { kind: 'create', parentId: '5', name: 'X', folder: false },
      'read-only',
    ],
    [
      'tracks for a playlist that is gone',
      { kind: 'add', playlistId: '99', tracks: [{ contentId: 'engine:1', paths: [] }] },
      'stale',
    ],
    [
      'tracks for a folder',
      { kind: 'add', playlistId: '1', tracks: [{ contentId: 'engine:2', paths: [] }] },
      'read-only',
    ],
    ['a delete of a list that is gone', { kind: 'delete', playlistId: '99' }, 'stale'],
    [
      'a rename, not written to Engine yet',
      { kind: 'rename', playlistId: '5', name: 'X' },
      'read-only',
    ],
    [
      'a move of a list, not written to Engine yet',
      { kind: 'moveNode', playlistId: '5', parentId: 'root', beforeId: null },
      'read-only',
    ],
  ])('refuses %s and leaves the library untouched', async (_what, edit, reason) => {
    const dir = await library(true)
    const before = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(dir, [op(edit)], deps())
    expect(result).toMatchObject({ ok: true, wrote: false, outcomes: [{ applied: false, reason }] })
    expect(readFileSync(dbFile(dir)).equals(before)).toBe(true)
  })

  it('keeps the edit waiting and the library untouched while Engine DJ is open', async () => {
    const dir = await library(true)
    vi.mocked(isEngineDjRunning).mockResolvedValue(true)
    const before = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op({ kind: 'create', parentId: 'root', name: 'Session', folder: false })],
      deps(),
    )
    expect(result).toEqual({ ok: false, reason: 'rekordbox-running' })
    expect(readFileSync(dbFile(dir)).equals(before)).toBe(true)
  })
})
